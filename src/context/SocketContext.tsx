import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { getWsUrl } from '../config';
import { ensureFreshAccessToken } from '../api/client';
import { decodeJwtPayload } from '../ws/decodeJwt';
import { notifyNewMessage, getExpoPushToken } from '../notifications';
import { sendPushHeartbeat } from '../api/pushBridge';
import type { WsEnvelope, NewMessagePayload } from '../ws/types';
import { useAuth } from './AuthContext';

type Handler = (payload: unknown) => void;

interface SocketContextValue {
  isConnected: boolean;
  myUserId: string | null;
  /** Registers a listener for a WS event type (e.g. "new_message"). Returns
   * an unsubscribe function — call it in the effect's cleanup. */
  subscribe: (type: string, handler: Handler) => () => void;
  /** Tells the server which contact is currently open, matching the
   * set_contact protocol message. Pass null when leaving a chat screen. */
  setActiveContact: (contactId: string | null) => void;
}

const SocketContext = createContext<SocketContextValue | undefined>(undefined);

const APP_PING_INTERVAL_MS = 20000;
const INITIAL_BACKOFF_MS = 1000;
const MAX_BACKOFF_MS = 30000;

export function SocketProvider({ children }: { children: React.ReactNode }) {
  const { isAuthenticated } = useAuth();
  const [isConnected, setIsConnected] = useState(false);
  const [myUserId, setMyUserId] = useState<string | null>(null);

  const wsRef = useRef<WebSocket | null>(null);
  const listenersRef = useRef<Map<string, Set<Handler>>>(new Map());
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pingTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const backoffRef = useRef(INITIAL_BACKOFF_MS);
  const activeRef = useRef(false); // whether we *should* be connected right now
  const activeContactRef = useRef<string | null>(null);

  function clearTimers() {
    if (reconnectTimerRef.current) {
      clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }
    if (pingTimerRef.current) {
      clearInterval(pingTimerRef.current);
      pingTimerRef.current = null;
    }
  }

  function dispatch(type: string, payload: unknown) {
    const handlers = listenersRef.current.get(type);
    if (!handlers || handlers.size === 0) return;
    handlers.forEach((handler) => {
      try {
        handler(payload);
      } catch (err) {
        console.error(`[socket] listener for "${type}" threw:`, err);
      }
    });
  }

  function scheduleReconnect() {
    if (reconnectTimerRef.current || !activeRef.current) return;
    const delay = backoffRef.current;
    backoffRef.current = Math.min(backoffRef.current * 2, MAX_BACKOFF_MS);
    reconnectTimerRef.current = setTimeout(() => {
      reconnectTimerRef.current = null;
      connect();
    }, delay);
  }

  async function connect() {
    if (!activeRef.current || wsRef.current) return;

    // Use our own access token directly — it's a valid JWT for the same
    // secret the WS handler checks, with fuller claims than the narrow
    // 30-second ws-token Whatomate mints for browser clients, and this
    // skips an extra network round trip on every (re)connect.
    const token = await ensureFreshAccessToken();
    if (!token) {
      // No valid session to connect with — apiClient's own 401 handler
      // will have already signed us out if the refresh token was the
      // problem; otherwise this is a transient failure, retry with backoff.
      console.error('[socket] no valid access token available to connect with');
      scheduleReconnect();
      return;
    }

    const claims = decodeJwtPayload(token);
    if (claims?.user_id) setMyUserId(claims.user_id);
    // Captured locally (not read from React state) since onmessage below
    // is a closure set once per connection — a ref would work too, but
    // this value never changes mid-connection, so a plain const is simpler.
    const currentUserId = claims?.user_id ?? null;

    const socket = new WebSocket(getWsUrl());
    wsRef.current = socket;

    socket.onopen = () => {
      socket.send(JSON.stringify({ type: 'auth', payload: { token } }));
      // There's no explicit auth-success ack in Whatomate's protocol — we
      // find out about failure via onclose instead (server closes with
      // ClosePolicyViolation on bad/expired tokens), which already
      // triggers the same reconnect-with-fresh-token path as a network
      // drop. So it's safe to treat this as connected right away.
      setIsConnected(true);
      backoffRef.current = INITIAL_BACKOFF_MS;

      getExpoPushToken().then((pushToken) => {
        if (pushToken) sendPushHeartbeat(pushToken);
      });

      if (activeContactRef.current) {
        socket.send(
          JSON.stringify({
            type: 'set_contact',
            payload: { contact_id: activeContactRef.current },
          })
        );
      }

      pingTimerRef.current = setInterval(() => {
        if (socket.readyState === WebSocket.OPEN) {
          socket.send(JSON.stringify({ type: 'ping' }));
        }
        // Tells the bridge service this device is actively connected —
        // it skips pushing to any device with a recent heartbeat, since
        // the local notification above already covers it (with smarter
        // suppression than the bridge could ever do server-side). Fires
        // on the same cadence as the WS ping since there's no reason for
        // a separate timer; the bridge's staleness window is generous
        // enough to tolerate this interval comfortably.
        getExpoPushToken().then((token) => {
          if (token) sendPushHeartbeat(token);
        });
      }, APP_PING_INTERVAL_MS);
    };

    socket.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data) as WsEnvelope;
        if (msg.type === 'pong') return;

        if (msg.type === 'new_message') {
          const payload = msg.payload as NewMessagePayload;
          const isMine = Boolean(currentUserId) && payload.assigned_user_id === currentUserId;
          const isIncoming = payload.direction === 'incoming';
          const isOpenChat = activeContactRef.current === payload.contact_id;
          // Only sound-notify for a real incoming customer message assigned
          // to this agent, and only if they're not already looking at that
          // exact conversation (activeContactRef mirrors the set_contact
          // protocol message ChatScreen sends while a thread is open).
          if (isMine && isIncoming && !isOpenChat) {
            notifyNewMessage(
              payload.profile_name || 'New message',
              payload.content?.body ?? '',
              payload.contact_id
            ).catch((err) => {
              console.error('[socket] failed to schedule notification:', err);
            });
          }
        }

        dispatch(msg.type, msg.payload);
      } catch (err) {
        console.error('[socket] failed to parse message:', err, event.data);
      }
    };

    socket.onerror = (err) => {
      console.error('[socket] connection error:', err);
    };

    socket.onclose = () => {
      wsRef.current = null;
      setIsConnected(false);
      clearTimers();
      scheduleReconnect();
    };
  }

  function disconnect() {
    activeRef.current = false;
    clearTimers();
    backoffRef.current = INITIAL_BACKOFF_MS;
    setIsConnected(false);
    setMyUserId(null);
    if (wsRef.current) {
      const socket = wsRef.current;
      wsRef.current = null;
      socket.onclose = null; // avoid firing our own reconnect logic
      socket.close();
    }
  }

  useEffect(() => {
    if (isAuthenticated) {
      activeRef.current = true;
      connect();
    } else {
      disconnect();
    }
    return () => {
      disconnect();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAuthenticated]);

  const subscribe = useCallback((type: string, handler: Handler) => {
    let handlers = listenersRef.current.get(type);
    if (!handlers) {
      handlers = new Set();
      listenersRef.current.set(type, handlers);
    }
    handlers.add(handler);
    return () => {
      handlers?.delete(handler);
    };
  }, []);

  const setActiveContact = useCallback((contactId: string | null) => {
    activeContactRef.current = contactId;
    const socket = wsRef.current;
    if (socket && socket.readyState === WebSocket.OPEN) {
      socket.send(
        JSON.stringify({ type: 'set_contact', payload: { contact_id: contactId ?? '' } })
      );
    }
  }, []);

  return (
    <SocketContext.Provider value={{ isConnected, myUserId, subscribe, setActiveContact }}>
      {children}
    </SocketContext.Provider>
  );
}

export function useSocket(): SocketContextValue {
  const ctx = useContext(SocketContext);
  if (!ctx) {
    throw new Error('useSocket must be used within a SocketProvider');
  }
  return ctx;
}
