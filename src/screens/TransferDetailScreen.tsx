import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../navigation';
import { getMessages } from '../api/messages';
import { describeApiError } from '../api/errors';
import { logApiError } from '../api/logging';
import { useSocket } from '../context/SocketContext';
import MessageBubble from '../components/MessageBubble';
import { colors, spacing } from '../theme';
import type { NewMessagePayload, StatusUpdatePayload } from '../ws/types';
import type { WhatomateMessage } from '../types';

type Props = NativeStackScreenProps<RootStackParamList, 'TransferDetail'>;

/** Read-only by design — a manager watching a conversation should never
 * accidentally become a second person replying in it without realizing.
 * Reassigning to themselves is the intended path if they need to actually
 * take it over. This screen serves two different moments (deciding who
 * to assign an unassigned chat to, and watching an already-assigned one)
 * rather than being two separate screens, since both just need "read the
 * conversation" as the shared foundation. */
export default function TransferDetailScreen({ route, navigation }: Props) {
  const { transfer } = route.params;
  const { subscribe } = useSocket();
  const [messages, setMessages] = useState<WhatomateMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const listRef = useRef<FlatList<WhatomateMessage>>(null);

  const fetchMessages = useCallback(async () => {
    try {
      const result = await getMessages(transfer.contact_id);
      const sorted = [...result.messages].sort(
        (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
      );
      setMessages(sorted);
      setErrorMessage(null);
    } catch (err) {
      logApiError('Failed to load conversation preview:', err);
      // A 404 here almost always means a permission gap, not a missing
      // contact — GetMessages scopes to "assigned to you" unless the
      // account also has Contacts: Read, which an unassigned queue item
      // by definition isn't yet. Worth saying plainly rather than
      // repeating Whatomate's generic "Contact not found" verbatim,
      // which reads as if the contact doesn't exist at all.
      const message = describeApiError(err);
      setErrorMessage(
        message.toLowerCase().includes('not found')
          ? "Could not load this conversation — your account may need the Contacts: Read " +
              'permission to preview chats not yet assigned to you.'
          : message
      );
    }
  }, [transfer.contact_id]);

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

  // Live updates while watching — same filtering the agent's own chat
  // screen does, just without set_contact (that's specifically for the
  // "currently replying here" case, which a read-only viewer isn't).
  useEffect(() => {
    const unsubNewMessage = subscribe('new_message', (payload) => {
      const msg = payload as NewMessagePayload;
      if (msg.contact_id !== transfer.contact_id) return;
      setMessages((prev) => {
        if (prev.some((m) => m.id === msg.id)) return prev;
        const inserted: WhatomateMessage = {
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
        };
        return [...prev, inserted].sort(
          (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
        );
      });
    });

    const unsubStatusUpdate = subscribe('status_update', (payload) => {
      const update = payload as StatusUpdatePayload;
      // contact_id is absent on the (far more common) async delivery/read
      // webhook path — see the comment on StatusUpdatePayload. Only skip
      // when it's present and clearly a different contact; a mismatch by
      // message_id alone is already a safe no-op via .map() below.
      if (update.contact_id && update.contact_id !== transfer.contact_id) return;
      setMessages((prev) =>
        prev.map((m) =>
          m.id === update.message_id
            ? {
                ...m,
                status: update.status,
                error_message: update.error_message ?? m.error_message,
              }
            : m
        )
      );
    });

    return () => {
      unsubNewMessage();
      unsubStatusUpdate();
    };
  }, [transfer.contact_id, subscribe]);

  const isAssigned = Boolean(transfer.agent_id);

  return (
    <View style={styles.container}>
      <View style={styles.readOnlyBanner}>
        <Ionicons name="eye-outline" size={16} color={colors.textSecondary} />
        <Text style={styles.readOnlyBannerText}>
          Read-only — you're watching this conversation, not part of it
        </Text>
      </View>

      {errorMessage ? <Text style={styles.error}>{errorMessage}</Text> : null}

      {loading ? (
        <ActivityIndicator style={styles.loadingIndicator} size="large" />
      ) : (
        <FlatList
          ref={listRef}
          data={messages}
          keyExtractor={(item) => item.id}
          renderItem={({ item }) => <MessageBubble message={item} />}
          contentContainerStyle={styles.listContent}
          onContentSizeChange={() => listRef.current?.scrollToEnd({ animated: false })}
          ListEmptyComponent={
            !errorMessage ? <Text style={styles.empty}>No messages yet.</Text> : null
          }
        />
      )}

      <View style={styles.actionBar}>
        {isAssigned && (
          <Text style={styles.assignedToText}>Assigned to {transfer.agent_name ?? 'agent'}</Text>
        )}
        <TouchableOpacity
          style={styles.actionButton}
          onPress={() => navigation.navigate('AssignAgent', { transfer })}
        >
          <Text style={styles.actionButtonText}>
            {isAssigned ? 'Reassign' : 'Assign to Agent'}
          </Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.chatBackground },
  readOnlyBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacing.sm,
    backgroundColor: colors.chipBackground,
  },
  readOnlyBannerText: {
    marginLeft: spacing.xs,
    fontSize: 12,
    color: colors.textSecondary,
  },
  error: {
    color: colors.error,
    textAlign: 'center',
    padding: spacing.md,
    backgroundColor: '#fff',
  },
  loadingIndicator: { marginTop: 40 },
  listContent: { padding: spacing.md },
  empty: { textAlign: 'center', color: colors.textSecondary, marginTop: 40 },
  actionBar: {
    padding: spacing.md,
    backgroundColor: colors.headerBackground,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.divider,
  },
  assignedToText: {
    fontSize: 13,
    color: colors.textSecondary,
    textAlign: 'center',
    marginBottom: spacing.sm,
  },
  actionButton: {
    backgroundColor: colors.brandGreenDark,
    borderRadius: 10,
    paddingVertical: 14,
    alignItems: 'center',
  },
  actionButtonText: { color: '#fff', fontSize: 16, fontWeight: '600' },
});
