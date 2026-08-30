import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  SectionList,
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
import { findActiveTransferForContact } from '../api/transfers';
import { describeApiError } from '../api/errors';
import { logApiError } from '../api/logging';
import { useSocket } from '../context/SocketContext';
import MessageBubble from '../components/MessageBubble';
import { getTeamName } from '../config';
import { colors, radii, spacing } from '../theme';
import { dateSectionKey, formatDateSeparator } from '../utils/formatTimestamp';
import type { NewMessagePayload, StatusUpdatePayload } from '../ws/types';
import type { AgentTransfer } from '../api/transfers';
import type { WhatomateMessage } from '../types';

/** A synthetic row spliced into a section's data alongside real messages
 * — distinguished from WhatomateMessage by the isUnreadDivider tag rather
 * than a wrapper, so keyExtractor/etc. keep working on both uniformly
 * (both have a stable `id`). */
interface UnreadDividerRow {
  id: 'unread-divider';
  isUnreadDivider: true;
  count: number;
}

type ChatRow = WhatomateMessage | UnreadDividerRow;

interface DateSection {
  key: string;
  title: string;
  data: ChatRow[];
}

type Props = NativeStackScreenProps<RootStackParamList, 'Chat'>;

/** "Aug 28, 3:45 PM (14h ago)" — the absolute time so it's checkable
 * against WhatsApp's real 24h rule, the relative time so it's readable at
 * a glance. */
function formatLastInbound(dateStr: string | null): string | null {
  if (!dateStr) return null;
  const date = new Date(dateStr);
  if (Number.isNaN(date.getTime())) return null;

  const absolute = date.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
  const hoursAgo = (Date.now() - date.getTime()) / 3600000;
  const relative =
    hoursAgo < 1
      ? `${Math.max(0, Math.round(hoursAgo * 60))}m ago`
      : hoursAgo < 48
        ? `${Math.round(hoursAgo)}h ago`
        : `${Math.round(hoursAgo / 24)}d ago`;
  return `${absolute} (${relative})`;
}

export default function ChatScreen({ route }: Props) {
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
  // Surfaced in the closed-window banner below so a "why is this still
  // blocked?" report comes with the actual timestamp the server is using,
  // instead of just the boolean — the one piece of evidence that tells us
  // whether a stuck banner is a stale flag (recent last_inbound_at, window
  // still marked closed) or the window is genuinely >24h old.
  const [lastInboundAt, setLastInboundAt] = useState(contact.last_inbound_at ?? null);
  // Whether this contact currently has a live, unresolved transfer —
  // drives the "chatbot may also respond" caution below, not an action.
  // Resolving/reassigning a transfer is a manager decision made from
  // Queue, not something exposed here: this app previously had a
  // "Mark Resolved" button right in the chat, but that button's own
  // premise didn't hold up — tapping it resumes the transfer (handing the
  // conversation back to the chatbot), yet doesn't clear the contact's
  // own assigned_user_id, so the chat kept sitting in "My Chats" anyway.
  // An agent tapping what looks like "close this out" while actually
  // reactivating the bot, with no visible change to show for it, is a
  // worse failure mode than not offering the action at all.
  const [activeTransfer, setActiveTransfer] = useState<AgentTransfer | null>(null);
  // Distinguishes "haven't checked yet" from "checked, genuinely none" —
  // without this, the caution banner below would flash on for every chat
  // for the split second before the check resolves.
  const [transferChecked, setTransferChecked] = useState(false);
  const listRef = useRef<SectionList<ChatRow, DateSection>>(null);
  // Sends fail (or succeed) asynchronously on the server — the WebSocket
  // status_update correction can arrive before the optimistic "add this
  // message to the list" step finishes, since they're two independent
  // async paths racing each other. When that happens, remember the
  // update here and apply it the moment the message actually appears,
  // instead of silently dropping it (which previously left messages
  // stuck showing a stale "sent" checkmark even after they'd genuinely
  // failed — e.g. the 24-hour-window case).
  const pendingStatusUpdatesRef = useRef<Map<string, StatusUpdatePayload>>(new Map());
  // Frozen at mount from the nav param's snapshot (from whenever the list
  // was last fetched, before opening this chat marked anything read) —
  // deliberately never updated afterward. Once you're actively viewing
  // the chat, "unread" stops meaning anything for where the divider
  // should sit; it should stay put where it first appeared, not slide
  // around as new messages arrive.
  const initialUnreadCountRef = useRef(contact.unread_count);

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
  // windowOpen's declaration above for why this matters. This is purely
  // "what did the server's contact record say" — it's combined with the
  // message-derived signal below at render time rather than here, so a
  // stale/buggy response here can never clobber a correct read from the
  // messages themselves (see effectiveWindowOpen).
  useFocusEffect(
    useCallback(() => {
      let isActive = true;
      getContact(contact.id)
        .then((fresh) => {
          if (isActive) {
            setWindowOpen(fresh.service_window_open);
            setLastInboundAt(fresh.last_inbound_at ?? null);
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

  // Whatomate's own service_window_open/last_inbound_at fields have been
  // observed lagging behind reality — a message visible via GetMessages
  // with the contact record's window-tracking fields still reflecting no
  // inbound at all (last_inbound_at came back entirely absent, which is
  // omitempty for "unset" server-side, despite an inbound message minutes
  // old sitting right there in the thread). The message list itself is
  // trustworthy, so it's combined with the contact-record signal at the
  // point of use (effectiveWindowOpen/effectiveLastInboundAt below) as a
  // pure OR rather than one side effect overwriting the other — a
  // stateful "whichever update ran last wins" approach was exactly what
  // let a correct open state flip back to an incorrect closed one the
  // next time getContact() resolved with the server's stale value.
  const lastIncomingMessage = useMemo(() => {
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].direction === 'incoming') return messages[i];
    }
    return undefined;
  }, [messages]);

  const messagesSayWindowOpen = useMemo(() => {
    if (!lastIncomingMessage) return false;
    const inboundAt = new Date(lastIncomingMessage.created_at).getTime();
    return !Number.isNaN(inboundAt) && Date.now() - inboundAt < 24 * 60 * 60 * 1000;
  }, [lastIncomingMessage]);

  const effectiveWindowOpen = windowOpen || messagesSayWindowOpen;

  const effectiveLastInboundAt = useMemo(() => {
    if (!lastIncomingMessage) return lastInboundAt;
    if (!lastInboundAt) return lastIncomingMessage.created_at;
    const fromMessages = new Date(lastIncomingMessage.created_at).getTime();
    const fromServer = new Date(lastInboundAt).getTime();
    return fromMessages > fromServer ? lastIncomingMessage.created_at : lastInboundAt;
  }, [lastIncomingMessage, lastInboundAt]);

  // Look up whether this contact has a matching active transfer, to
  // decide whether the "chatbot may also respond" caution below applies —
  // fails silently (no error shown) since this is advisory, not core chat
  // functionality, and a legitimate "no team configured" or "not found"
  // result looks the same to the person using the app either way (no
  // caution shown in either case, which is the safer failure mode: it
  // stays quiet rather than risk a false alarm from an unrelated error).
  useFocusEffect(
    useCallback(() => {
      let isActive = true;
      setTransferChecked(false);
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
        } finally {
          if (isActive) setTransferChecked(true);
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

  // Where the "N unread messages" divider goes — counting back from the
  // newest message through the last `initialUnreadCountRef.current`
  // *incoming* ones, matching WhatsApp's own read-cursor convention
  // rather than needing any per-message read flag from the server (the
  // API only exposes an aggregate unread_count, not which specific
  // messages it covers). null if there's nothing unread, or if fewer
  // incoming messages are loaded than the count claims (can't place it
  // accurately, so it's better to show nothing than guess wrong).
  const unreadDividerBeforeId = useMemo(() => {
    const count = initialUnreadCountRef.current;
    if (!count || count <= 0) return null;
    let remaining = count;
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].direction === 'incoming') {
        remaining -= 1;
        if (remaining === 0) return messages[i].id;
      }
    }
    return null;
  }, [messages]);

  // Grouped into WhatsApp-style date sections — messages arrive already
  // sorted ascending by created_at (see fetchMessages/the live-append
  // above), so a single consecutive pass is enough; no need to re-sort
  // within groups. The unread divider is spliced in as its own row right
  // before the message it belongs before, within whichever date section
  // that message ends up in.
  const sections = useMemo((): DateSection[] => {
    const groups: DateSection[] = [];
    for (const message of messages) {
      const key = dateSectionKey(message.created_at);
      let current = groups[groups.length - 1];
      if (!current || current.key !== key) {
        current = { key, title: formatDateSeparator(message.created_at), data: [] };
        groups.push(current);
      }
      if (message.id === unreadDividerBeforeId) {
        current.data.push({
          id: 'unread-divider',
          isUnreadDivider: true,
          count: initialUnreadCountRef.current,
        });
      }
      current.data.push(message);
    }
    return groups;
  }, [messages, unreadDividerBeforeId]);

  // SectionList has no scrollToEnd (unlike FlatList — its items span
  // sections, so RN only gives it scrollToLocation by section+item index).
  // viewPosition: 1 pins the target item to the bottom of the viewport,
  // the closest equivalent to "scrolled to the end."
  const scrollToBottom = useCallback(
    (animated: boolean) => {
      const lastSectionIndex = sections.length - 1;
      if (lastSectionIndex < 0) return;
      const lastItemIndex = sections[lastSectionIndex].data.length - 1;
      listRef.current?.scrollToLocation({
        sectionIndex: lastSectionIndex,
        itemIndex: lastItemIndex,
        viewPosition: 1,
        animated,
      });
    },
    [sections]
  );

  // On first open, land on the unread divider (viewPosition: 0 pins it to
  // the top of the viewport, revealing it rather than scrolling past it)
  // instead of jumping straight past unread messages to the very latest —
  // matches WhatsApp's own "pick up where you left off" behavior. Falls
  // back to the bottom when there's no divider to show.
  const scrollToInitialPosition = useCallback(
    (animated: boolean) => {
      for (let s = 0; s < sections.length; s++) {
        const itemIndex = sections[s].data.findIndex((row) => 'isUnreadDivider' in row);
        if (itemIndex !== -1) {
          listRef.current?.scrollToLocation({
            sectionIndex: s,
            itemIndex,
            viewPosition: 0,
            animated,
          });
          return;
        }
      }
      scrollToBottom(animated);
    },
    [sections, scrollToBottom]
  );
  const initialScrollDoneRef = useRef(false);

  // Without getItemLayout (impractical here — bubble height varies with
  // message length), scrollToLocation targeting a row outside the
  // currently-measured window doesn't just warn, it throws — RN's
  // VirtualizedList requires onScrollToIndexFailed to be present at all
  // before it'll degrade to a retry instead of a hard invariant crash.
  // This was crashing the screen on open for any chat long enough that
  // the last message isn't already within the initial render window.
  // Capped so a pathological case (never converging) can't retry forever.
  const scrollRetriesRef = useRef(0);
  const handleScrollToIndexFailed = useCallback(() => {
    if (scrollRetriesRef.current >= 5) return;
    scrollRetriesRef.current += 1;
    setTimeout(() => scrollToBottom(false), 300);
  }, [scrollToBottom]);

  // The keyboard opening shrinks the list's visible height without
  // changing its content size, so onContentSizeChange (below) never
  // fires for it — the list stayed at its old scroll position, leaving
  // the latest message hidden behind the keyboard/input row. Explicitly
  // re-scroll once the keyboard's actually shown (keyboardWillShow on
  // iOS syncs with the animation; Android has no "will" variant).
  useEffect(() => {
    const showEvent = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const subscription = Keyboard.addListener(showEvent, () => {
      requestAnimationFrame(() => scrollToBottom(true));
    });
    return () => subscription.remove();
  }, [scrollToBottom]);

  // Live updates for this specific thread. new_message/status_update are
  // broadcast org-wide by the server, so we filter to this contact
  // ourselves. new_message is deduped by id, since a message we just sent
  // via handleSend is already appended locally — if the server also
  // echoes it back over the socket, this avoids a visible duplicate.
  useEffect(() => {
    const unsubNewMessage = subscribe('new_message', (payload) => {
      const msg = payload as NewMessagePayload;
      if (msg.contact_id !== contact.id) return;

      // No explicit windowOpen handling needed here for an incoming
      // message — appending it to `messages` below already feeds
      // messagesSayWindowOpen (see above), which reopens the banner the
      // instant it arrives without waiting for a focus-triggered refetch.

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
      // contact_id is only present on the synchronous send-result path
      // (an agent's own send attempt succeeding/failing immediately) —
      // verified against source: the async delivery/read webhook path
      // (which is where nearly every delivered/read tick and some
      // failures actually come from) never includes it at all. Early-
      // returning on a strict mismatch meant almost every real status
      // update was silently dropped, since undefined !== contact.id is
      // always true — ticks only ever caught up on the next refetch,
      // never live. When contact_id IS present, still use it to skip
      // other contacts' events outright; when it's absent, fall through
      // and match by message_id alone.
      if (update.contact_id && update.contact_id !== contact.id) return;

      setMessages((prev) => {
        const exists = prev.some((m) => m.id === update.message_id);
        if (!exists) {
          // Arrived before the message it's about was added — remember
          // it and apply the moment that message does appear, rather
          // than silently losing the correction (see the ref's comment).
          // Capped: BroadcastToOrg means every other contact's status
          // updates land here too now that contact_id can't gate them
          // out up front, and most will never match anything in this
          // screen's own messages — bound the map so an org-wide flood
          // can't grow it for this screen's entire lifetime.
          if (pendingStatusUpdatesRef.current.size >= 50) {
            const oldestKey = pendingStatusUpdatesRef.current.keys().next().value;
            if (oldestKey !== undefined) pendingStatusUpdatesRef.current.delete(oldestKey);
          }
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

  const renderItem = ({ item }: { item: ChatRow }) => {
    if ('isUnreadDivider' in item) {
      return (
        <View style={styles.unreadDividerRow}>
          <View style={styles.unreadDividerPill}>
            <Text style={styles.unreadDividerText}>
              {item.count} unread message{item.count === 1 ? '' : 's'}
            </Text>
          </View>
        </View>
      );
    }
    return <MessageBubble message={item} />;
  };

  const renderSectionHeader = ({ section }: { section: DateSection }) => (
    <View style={styles.dateSeparatorRow}>
      <View style={styles.dateSeparatorPill}>
        <Text style={styles.dateSeparatorText}>{section.title}</Text>
      </View>
    </View>
  );

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

      {transferChecked && !activeTransfer ? (
        <View style={styles.transferCautionBanner}>
          <Ionicons name="information-circle-outline" size={16} color={colors.textSecondary} />
          <Text style={styles.transferCautionText}>
            No active handoff found for this conversation — the chatbot may also respond.
          </Text>
        </View>
      ) : null}

      <SectionList
        ref={listRef}
        sections={sections}
        keyExtractor={(item) => item.id}
        renderItem={renderItem}
        renderSectionHeader={renderSectionHeader}
        stickySectionHeadersEnabled
        contentContainerStyle={styles.listContent}
        onContentSizeChange={() => {
          if (!initialScrollDoneRef.current) {
            initialScrollDoneRef.current = true;
            scrollToInitialPosition(false);
          } else {
            scrollToBottom(false);
          }
        }}
        onScrollToIndexFailed={handleScrollToIndexFailed}
      />

      {effectiveWindowOpen ? (
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
          <View style={styles.windowClosedTextGroup}>
            <Text style={styles.windowClosedText}>
              WhatsApp's 24-hour reply window has closed for this chat. You
              can't send a message until the customer writes again — a
              template message can re-open it from the Whatomate web
              dashboard.
            </Text>
            {formatLastInbound(effectiveLastInboundAt) ? (
              <Text style={styles.windowClosedDetail}>
                Their last message: {formatLastInbound(effectiveLastInboundAt)}
              </Text>
            ) : null}
          </View>
        </View>
      )}
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.chatBackground },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  listContent: { padding: spacing.md },
  // The row itself stays transparent (no background) so it can sit
  // "stuck" at the top via stickySectionHeadersEnabled without painting
  // a solid bar over the messages scrolling underneath — only the pill
  // inside it is visible, matching WhatsApp's floating date label.
  dateSeparatorRow: {
    alignItems: 'center',
    paddingVertical: spacing.sm,
  },
  dateSeparatorPill: {
    backgroundColor: colors.chipBackground,
    borderRadius: radii.chip,
    paddingHorizontal: spacing.md,
    paddingVertical: 5,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.08,
    shadowRadius: 1,
    elevation: 1,
  },
  dateSeparatorText: {
    fontSize: 12,
    fontWeight: '600',
    color: colors.textSecondary,
  },
  // Same shape/shadow as the date pill, but a green tint distinguishes it
  // from a date separator at a glance — not "stuck" like the date
  // header, since it's a one-time marker for where you left off, not a
  // recurring section boundary you'd want pinned while scrolling past it.
  unreadDividerRow: {
    alignItems: 'center',
    paddingVertical: spacing.sm,
  },
  unreadDividerPill: {
    backgroundColor: colors.statusInProgressBg,
    borderRadius: radii.chip,
    paddingHorizontal: spacing.md,
    paddingVertical: 5,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.08,
    shadowRadius: 1,
    elevation: 1,
  },
  unreadDividerText: {
    fontSize: 12,
    fontWeight: '600',
    color: colors.brandGreenDark,
  },
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
  // Deliberately quieter than windowClosedBanner below — this is a soft
  // caution (it also fires for contacts that were always assigned some
  // other way and never had a transfer at all), not an alarm, so it
  // shouldn't compete visually with a banner that actually blocks an
  // action.
  transferCautionBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 6,
    paddingHorizontal: spacing.md,
    backgroundColor: colors.chipBackground,
  },
  transferCautionText: {
    flex: 1,
    marginLeft: spacing.sm,
    fontSize: 12,
    color: colors.textSecondary,
  },
  windowClosedBanner: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    padding: spacing.md,
    backgroundColor: colors.statusWaitingBg,
  },
  windowClosedTextGroup: {
    flex: 1,
    marginLeft: spacing.sm,
  },
  windowClosedText: {
    fontSize: 13,
    lineHeight: 18,
    color: colors.statusWaiting,
  },
  windowClosedDetail: {
    fontSize: 12,
    lineHeight: 16,
    marginTop: 4,
    color: colors.statusWaiting,
    opacity: 0.85,
  },
});
