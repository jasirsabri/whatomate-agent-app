import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { useHeaderHeight } from '@react-navigation/elements';
import { Ionicons } from '@expo/vector-icons';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../navigation';
import { getContact } from '../api/contacts';
import { getMessages, sendTextMessage } from '../api/messages';
import { resolveTeamIdByName } from '../api/teams';
import { findActiveTransferForContact, resumeTransfer } from '../api/transfers';
import { describeApiError } from '../api/errors';
import { logApiError } from '../api/logging';
import { useSocket } from '../context/SocketContext';
import MessageBubble from '../components/MessageBubble';
import { getTeamName } from '../config';
import { colors, radii, spacing } from '../theme';
import type { NewMessagePayload, StatusUpdatePayload } from '../ws/types';
import type { AgentTransfer } from '../api/transfers';
import type { WhatomateMessage } from '../types';

type Props = NativeStackScreenProps<RootStackParamList, 'Chat'>;

export default function ChatScreen({ route, navigation }: Props) {
  const { contact } = route.params;
  const { subscribe, setActiveContact } = useSocket();
  const headerHeight = useHeaderHeight();
  const [messages, setMessages] = useState<WhatomateMessage[]>([]);
  const [draft, setDraft] = useState('');
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  // Seeded from the nav param (a snapshot from whenever the contact list
  // was last fetched), then refreshed on focus below — closes most of the
  // gap where the 24h window could tick over while this exact chat is
  // already open, without needing to poll it continuously.
  const [windowOpen, setWindowOpen] = useState(contact.service_window_open);
  // The transfer this contact is tied to, if any — drives the "Mark
  // Resolved" header button. null both while unresolved-and-loading and
  // for the legitimate case of no matching transfer (e.g. assigned some
  // other way) — the button just doesn't appear in either case, which is
  // the right failure mode for a non-essential action like this.
  const [activeTransfer, setActiveTransfer] = useState<AgentTransfer | null>(null);
  const [resolvingTransfer, setResolvingTransfer] = useState(false);
  const listRef = useRef<FlatList<WhatomateMessage>>(null);
  // Sends fail (or succeed) asynchronously on the server — the WebSocket
  // status_update correction can arrive before the optimistic "add this
  // message to the list" step finishes, since they're two independent
  // async paths racing each other. When that happens, remember the
  // update here and apply it the moment the message actually appears,
  // instead of silently dropping it (which previously left messages
  // stuck showing a stale "sent" checkmark even after they'd genuinely
  // failed — e.g. the 24-hour-window case).
  const pendingStatusUpdatesRef = useRef<Map<string, StatusUpdatePayload>>(new Map());
  // Set the instant a live "new_message" event tells us the window just
  // reopened (see that handler below). getContact() below and this live
  // update are two independent async paths that can race: reopening a
  // chat right as the reopening message itself arrives kicks off a
  // getContact() call that reflects the server's pre-message state, which
  // can resolve *after* the live update already set windowOpen(true) —
  // silently flipping it back to closed and leaving the agent stuck
  // behind the banner despite the window genuinely being open. Reset per
  // focus session so a stale "open" doesn't survive into a later,
  // legitimately-closed one.
  const windowReopenedLiveRef = useRef(false);

  const applyPendingStatus = useCallback((message: WhatomateMessage): WhatomateMessage => {
    const pending = pendingStatusUpdatesRef.current.get(message.id);
    if (!pending) return message;
    pendingStatusUpdatesRef.current.delete(message.id);
    return {
      ...message,
      status: pending.status,
      error_message: pending.error_message ?? message.error_message,
    };
  }, []);

  const fetchMessages = useCallback(async () => {
    try {
      const result = await getMessages(contact.id);
      const sorted = [...result.messages].sort(
        (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
      );
      setMessages(sorted);
      setErrorMessage(null);
    } catch (err) {
      logApiError('Failed to load messages:', err);
      setErrorMessage(describeApiError(err));
    }
  }, [contact.id]);

  // Initial load, and a refetch whenever we return to this screen — a
  // fallback in case a live event was missed (e.g. right after
  // reconnecting from a dropped connection).
  useFocusEffect(
    useCallback(() => {
      let isActive = true;
      (async () => {
        setLoading(true);
        await fetchMessages();
        if (isActive) setLoading(false);
      })();
      return () => {
        isActive = false;
      };
    }, [fetchMessages])
  );

  // Refresh just the 24-hour window status on focus — see the comment on
  // windowOpen's declaration above for why this matters.
  useFocusEffect(
    useCallback(() => {
      let isActive = true;
      windowReopenedLiveRef.current = false;
      getContact(contact.id)
        .then((fresh) => {
          // A live update that arrived while this was in flight already
          // knows better than this now-possibly-stale response — don't
          // let it re-close a window that's actually open.
          if (isActive && !windowReopenedLiveRef.current) {
            setWindowOpen(fresh.service_window_open);
          }
        })
        .catch((err) => {
          logApiError('Failed to refresh window status:', err);
        });
      return () => {
        isActive = false;
      };
    }, [contact.id])
  );

  // Look up whether this contact has a matching active transfer, to know
  // whether to offer "Mark Resolved" at all — fails silently (no error
  // shown) since this is a nice-to-have, not core chat functionality, and
  // a legitimate "no team configured" or "not found" result looks the
  // same to the person using the app either way (button just isn't there).
  useFocusEffect(
    useCallback(() => {
      let isActive = true;
      (async () => {
        try {
          const teamId = await resolveTeamIdByName(getTeamName());
          if (!teamId) {
            if (isActive) setActiveTransfer(null);
            return;
          }
          const transfer = await findActiveTransferForContact(teamId, contact.id);
          if (isActive) setActiveTransfer(transfer);
        } catch (err) {
          logApiError('Failed to look up active transfer:', err);
          if (isActive) setActiveTransfer(null);
        }
      })();
      return () => {
        isActive = false;
      };
    }, [contact.id])
  );

  // Tell the server which contact we're viewing (set_contact protocol
  // message) while this screen is focused, and clear it on the way out.
  useFocusEffect(
    useCallback(() => {
      setActiveContact(contact.id);
      return () => setActiveContact(null);
    }, [contact.id, setActiveContact])
  );

  // The keyboard opening shrinks the list's visible height without
  // changing its content size, so onContentSizeChange (below) never
  // fires for it — the list stayed at its old scroll position, leaving
  // the latest message hidden behind the keyboard/input row. Explicitly
  // re-scroll once the keyboard's actually shown (keyboardWillShow on
  // iOS syncs with the animation; Android has no "will" variant).
  useEffect(() => {
    const showEvent = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const subscription = Keyboard.addListener(showEvent, () => {
      requestAnimationFrame(() => {
        listRef.current?.scrollToEnd({ animated: true });
      });
    });
    return () => subscription.remove();
  }, []);

  // Live updates for this specific thread. new_message/status_update are
  // broadcast org-wide by the server, so we filter to this contact
  // ourselves. new_message is deduped by id, since a message we just sent
  // via handleSend is already appended locally — if the server also
  // echoes it back over the socket, this avoids a visible duplicate.
  useEffect(() => {
    const unsubNewMessage = subscribe('new_message', (payload) => {
      const msg = payload as NewMessagePayload;
      if (msg.contact_id !== contact.id) return;

      // A fresh incoming message unambiguously means the 24-hour window
      // just (re)opened — service_window_open is computed server-side
      // from exactly this (last_inbound_at within 24h), so there's no
      // need to wait for the next focus-triggered refetch to find out.
      // Without this, staying on an open chat while the customer replies
      // left the "window closed" banner stuck showing even after they'd
      // genuinely written back.
      if (msg.direction === 'incoming') {
        windowReopenedLiveRef.current = true;
        setWindowOpen(true);
      }

      setMessages((prev) => {
        if (prev.some((m) => m.id === msg.id)) return prev;
        const inserted: WhatomateMessage = applyPendingStatus({
          id: msg.id,
          contact_id: msg.contact_id,
          direction: msg.direction,
          message_type: msg.message_type,
          content: msg.content,
          media_url: msg.media_url,
          media_mime_type: msg.media_mime_type,
          media_filename: msg.media_filename,
          status: msg.status,
          wamid: msg.wamid,
          created_at: msg.created_at,
          updated_at: msg.updated_at,
          is_reply: msg.is_reply,
          reply_to_message_id: msg.reply_to_message_id,
        });
        return [...prev, inserted].sort(
          (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
        );
      });
    });

    const unsubStatusUpdate = subscribe('status_update', (payload) => {
      const update = payload as StatusUpdatePayload;
      if (update.contact_id !== contact.id) return;
      setMessages((prev) => {
        const exists = prev.some((m) => m.id === update.message_id);
        if (!exists) {
          // Arrived before the message it's about was added — remember
          // it and apply the moment that message does appear, rather
          // than silently losing the correction (see the ref's comment).
          pendingStatusUpdatesRef.current.set(update.message_id, update);
          return prev;
        }
        return prev.map((m) =>
          m.id === update.message_id
            ? { ...m, status: update.status, error_message: update.error_message ?? m.error_message }
            : m
        );
      });
    });

    return () => {
      unsubNewMessage();
      unsubStatusUpdate();
    };
  }, [contact.id, subscribe, applyPendingStatus]);

  const doResolveTransfer = useCallback(async () => {
    if (!activeTransfer) return;
    setResolvingTransfer(true);
    try {
      await resumeTransfer(activeTransfer.id);
      setActiveTransfer(null);
      Alert.alert('Marked as resolved', 'This conversation has been closed out of the queue.');
    } catch (err) {
      logApiError('Failed to mark transfer resolved:', err);
      Alert.alert('Could not mark resolved', describeApiError(err));
    } finally {
      setResolvingTransfer(false);
    }
  }, [activeTransfer]);

  const handleMarkResolved = useCallback(() => {
    Alert.alert(
      'Mark as resolved?',
      'This closes the conversation out of the team queue.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Mark Resolved', onPress: doResolveTransfer },
      ]
    );
  }, [doResolveTransfer]);

  // Agent-initiated resolution, from the chat itself — the primary place
  // for this action, since the agent handling the conversation is the
  // one who actually knows it's done (Queue's own Mark Resolved button
  // stays too, for manager oversight/cleanup, but isn't the main path).
  useEffect(() => {
    navigation.setOptions({
      headerRight: activeTransfer
        ? () => (
            <TouchableOpacity
              onPress={handleMarkResolved}
              disabled={resolvingTransfer}
              hitSlop={8}
            >
              {resolvingTransfer ? (
                <ActivityIndicator size="small" color={colors.brandGreenDark} />
              ) : (
                <Ionicons
                  name="checkmark-done-circle-outline"
                  size={26}
                  color={colors.brandGreenDark}
                />
              )}
            </TouchableOpacity>
          )
        : undefined,
    });
  }, [activeTransfer, resolvingTransfer, navigation, handleMarkResolved]);

  const handleSend = async () => {
    const text = draft.trim();
    if (!text || sending) return;

    setSending(true);
    setDraft('');
    try {
      const sent = await sendTextMessage(contact.id, text);
      setMessages((prev) =>
        prev.some((m) => m.id === sent.id) ? prev : [...prev, applyPendingStatus(sent)]
      );
    } catch (err) {
      logApiError('Failed to send message:', err);
      setErrorMessage(describeApiError(err));
      setDraft(text);
    } finally {
      setSending(false);
    }
  };

  const renderItem = ({ item }: { item: WhatomateMessage }) => <MessageBubble message={item} />;

  if (loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" />
      </View>
    );
  }

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      keyboardVerticalOffset={headerHeight}
    >
      {errorMessage ? <Text style={styles.error}>{errorMessage}</Text> : null}

      <FlatList
        ref={listRef}
        data={messages}
        keyExtractor={(item) => item.id}
        renderItem={renderItem}
        contentContainerStyle={styles.listContent}
        onContentSizeChange={() => listRef.current?.scrollToEnd({ animated: false })}
      />

      {windowOpen ? (
        <View style={styles.inputRow}>
          <View style={styles.inputWrapper}>
            <TextInput
              style={styles.input}
              placeholder="Type a message"
              placeholderTextColor={colors.iconGray}
              value={draft}
              onChangeText={setDraft}
              multiline
            />
          </View>
          <TouchableOpacity
            style={[styles.sendButton, (!draft.trim() || sending) && styles.sendButtonDisabled]}
            onPress={handleSend}
            disabled={!draft.trim() || sending}
          >
            {sending ? (
              <ActivityIndicator size="small" color="#fff" />
            ) : (
              <Ionicons name="send" size={18} color="#fff" />
            )}
          </TouchableOpacity>
        </View>
      ) : (
        <View style={styles.windowClosedBanner}>
          <Ionicons name="time-outline" size={18} color={colors.statusWaiting} />
          <Text style={styles.windowClosedText}>
            WhatsApp's 24-hour reply window has closed for this chat. You
            can't send a message until the customer writes again — a
            template message can re-open it from the Whatomate web
            dashboard.
          </Text>
        </View>
      )}
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.chatBackground },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  listContent: { padding: spacing.md },
  error: {
    color: colors.error,
    textAlign: 'center',
    paddingVertical: 6,
    backgroundColor: '#fff',
  },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    padding: spacing.sm,
    backgroundColor: colors.headerBackground,
  },
  inputWrapper: {
    flex: 1,
    backgroundColor: colors.chipBackground,
    borderRadius: radii.input,
    marginRight: spacing.sm,
    paddingHorizontal: spacing.md,
    justifyContent: 'center',
  },
  input: {
    fontSize: 15,
    color: colors.textPrimary,
    maxHeight: 100,
    paddingVertical: 10,
  },
  sendButton: {
    width: 42,
    height: 42,
    borderRadius: 999,
    backgroundColor: colors.brandGreenDark,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sendButtonDisabled: { opacity: 0.4 },
  windowClosedBanner: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    padding: spacing.md,
    backgroundColor: colors.statusWaitingBg,
  },
  windowClosedText: {
    flex: 1,
    marginLeft: spacing.sm,
    fontSize: 13,
    lineHeight: 18,
    color: colors.statusWaiting,
  },
});
