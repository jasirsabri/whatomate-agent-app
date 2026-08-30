import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  RefreshControl,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import type { CompositeScreenProps } from '@react-navigation/native';
import type { BottomTabScreenProps } from '@react-navigation/bottom-tabs';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { RootStackParamList, MainTabParamList } from '../navigation/types';
import { listContacts } from '../api/contacts';
import { describeApiError } from '../api/errors';
import { logApiError } from '../api/logging';
import { useSocket } from '../context/SocketContext';
import { formatListTimestamp } from '../utils/formatTimestamp';
import { colors, radii, spacing } from '../theme';
import type { NewMessagePayload } from '../ws/types';
import type { Contact } from '../types';

type Props = CompositeScreenProps<
  BottomTabScreenProps<MainTabParamList, 'ChatsTab'>,
  NativeStackScreenProps<RootStackParamList>
>;
type FilterTab = 'active' | 'historic';

/** Live, client-side, zero-network-cost — matches whatever's already
 * loaded (name, phone, and the last message's preview text). Whatomate
 * has no message-content search endpoint at all (checked), so this is
 * "search the last thing they said," not full chat history. */
function matchesSearch(contact: Contact, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  const displayName = (contact.name || contact.profile_name || '').toLowerCase();
  const phone = contact.phone_number.toLowerCase();
  const preview = (contact.last_message_preview || '').toLowerCase();
  return displayName.includes(q) || phone.includes(q) || preview.includes(q);
}

export default function ConversationListScreen({ navigation }: Props) {
  const { subscribe, myUserId } = useSocket();
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [search, setSearch] = useState('');
  const [filterTab, setFilterTab] = useState<FilterTab>('active');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const fetchContacts = useCallback(async () => {
    try {
      setErrorMessage(null);
      const result = await listContacts(1);
      const sorted = [...result.contacts].sort((a, b) => {
        const aTime = a.last_message_at ? new Date(a.last_message_at).getTime() : 0;
        const bTime = b.last_message_at ? new Date(b.last_message_at).getTime() : 0;
        return bTime - aTime;
      });
      setContacts(sorted);
    } catch (err) {
      logApiError('Failed to load conversations:', err);
      setErrorMessage(describeApiError(err));
    }
  }, []);

  // Live updates: refresh when a message assigned to us arrives, a
  // contact record changes (reassignment, tags, etc), or a transfer is
  // created/assigned/resumed — verified directly against Whatomate's own
  // source (internal/handlers/agent_transfers.go's broadcast* functions)
  // rather than guessed: the real event names are exactly agent_transfer,
  // agent_transfer_assign, and agent_transfer_resume. None of their
  // payloads carry enough to cheaply tell "is this relevant to me" (e.g.
  // agent_transfer_resume has no agent_id at all), so — same as
  // contact_update below — this just refetches unconditionally rather
  // than risk a wrong client-side filter (see git history from earlier
  // today for exactly how that goes wrong). This only changes how
  // promptly the list refreshes; what it shows still comes entirely from
  // GET /api/contacts, whose own server-side scoping is already correct.
  // new_message is broadcast org-wide by the server, so we filter by
  // assigned_user_id ourselves — Whatomate doesn't scope this event
  // server-side.
  useEffect(() => {
    const unsubNewMessage = subscribe('new_message', (payload) => {
      const msg = payload as NewMessagePayload;
      if (myUserId && msg.assigned_user_id === myUserId) {
        fetchContacts();
      }
    });
    const unsubContactUpdate = subscribe('contact_update', () => {
      fetchContacts();
    });
    const unsubTransferCreated = subscribe('agent_transfer', () => {
      fetchContacts();
    });
    const unsubTransferAssigned = subscribe('agent_transfer_assign', () => {
      fetchContacts();
    });
    const unsubTransferResumed = subscribe('agent_transfer_resume', () => {
      fetchContacts();
    });
    return () => {
      unsubNewMessage();
      unsubContactUpdate();
      unsubTransferCreated();
      unsubTransferAssigned();
      unsubTransferResumed();
    };
  }, [subscribe, myUserId, fetchContacts]);

  // Still refetch on focus too (e.g. after sending a reply and going
  // "back") as a fallback in case a push event was ever missed, such as
  // right after reconnecting from a dropped connection.
  useFocusEffect(
    useCallback(() => {
      let isActive = true;
      setLoading(true);
      fetchContacts().finally(() => {
        if (isActive) setLoading(false);
      });
      return () => {
        isActive = false;
      };
    }, [fetchContacts])
  );

  const handleRefresh = async () => {
    setRefreshing(true);
    await fetchContacts();
    setRefreshing(false);
  };

  // Active = within WhatsApp's 24-hour customer service window (can still
  // send a free-form reply). Historic = window closed, would need a
  // template message to re-engage. See service_window_open in the API.
  const { activeContacts, historicContacts } = useMemo(() => {
    const active: Contact[] = [];
    const historic: Contact[] = [];
    for (const c of contacts) {
      (c.service_window_open ? active : historic).push(c);
    }
    return { activeContacts: active, historicContacts: historic };
  }, [contacts]);

  // Badge on the Chats tab icon itself, matching WhatsApp's own bottom-bar
  // convention — count of conversations with at least one unread message
  // (not the sum of all unread messages, which reads as more alarming
  // than useful for a tab-level badge).
  const unreadConversationCount = useMemo(
    () => contacts.filter((c) => c.unread_count > 0).length,
    [contacts]
  );
  useEffect(() => {
    navigation.setOptions({
      tabBarBadge: unreadConversationCount > 0 ? unreadConversationCount : undefined,
      tabBarBadgeStyle: { backgroundColor: colors.brandGreen },
    });
  }, [unreadConversationCount, navigation]);

  // Search stays scoped to whichever tab is open — searching Active
  // doesn't surface Historic matches and vice versa.
  const baseList = filterTab === 'active' ? activeContacts : historicContacts;
  const visibleContacts = useMemo(
    () => baseList.filter((c) => matchesSearch(c, search)),
    [baseList, search]
  );

  const renderItem = ({ item }: { item: Contact }) => {
    const displayName = item.name || item.profile_name || item.phone_number;
    const hasUnread = item.unread_count > 0;
    return (
      <TouchableOpacity
        style={styles.row}
        onPress={() => navigation.navigate('Chat', { contact: item })}
        activeOpacity={0.6}
      >
        <View style={styles.avatar}>
          <Text style={styles.avatarText}>{displayName.charAt(0).toUpperCase()}</Text>
        </View>
        <View style={styles.rowMain}>
          <View style={styles.rowTopLine}>
            <Text style={styles.name} numberOfLines={1}>
              {displayName}
            </Text>
            <Text style={[styles.timestamp, hasUnread && styles.timestampUnread]}>
              {formatListTimestamp(item.last_message_at)}
            </Text>
          </View>
          <View style={styles.rowBottomLine}>
            <Text
              style={[styles.preview, hasUnread && styles.previewUnread]}
              numberOfLines={1}
            >
              {item.last_message_preview || item.phone_number}
            </Text>
            {hasUnread && (
              <View style={styles.unreadBadge}>
                <Text style={styles.unreadBadgeText}>
                  {item.unread_count > 99 ? '99+' : item.unread_count}
                </Text>
              </View>
            )}
          </View>
        </View>
      </TouchableOpacity>
    );
  };

  const emptyMessage = search.trim()
    ? 'No matches in this tab.'
    : filterTab === 'active'
      ? 'No active conversations right now.'
      : 'No historic conversations.';

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Chats</Text>
      </View>

      <View style={styles.searchRow}>
        <Ionicons name="search" size={18} color={colors.iconGray} style={styles.searchIcon} />
        <TextInput
          style={styles.search}
          placeholder="Search name, number, or last message"
          placeholderTextColor={colors.iconGray}
          value={search}
          onChangeText={setSearch}
        />
        {search.length > 0 && (
          <TouchableOpacity onPress={() => setSearch('')} hitSlop={8}>
            <Ionicons name="close-circle" size={18} color={colors.iconGray} />
          </TouchableOpacity>
        )}
      </View>

      <View style={styles.chipsRow}>
        <TouchableOpacity
          style={[styles.chip, filterTab === 'active' && styles.chipActive]}
          onPress={() => setFilterTab('active')}
        >
          <Text style={[styles.chipText, filterTab === 'active' && styles.chipTextActive]}>
            Active {activeContacts.length > 0 ? `(${activeContacts.length})` : ''}
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.chip, filterTab === 'historic' && styles.chipActive]}
          onPress={() => setFilterTab('historic')}
        >
          <Text style={[styles.chipText, filterTab === 'historic' && styles.chipTextActive]}>
            Historic {historicContacts.length > 0 ? `(${historicContacts.length})` : ''}
          </Text>
        </TouchableOpacity>
      </View>

      {errorMessage ? <Text style={styles.error}>{errorMessage}</Text> : null}

      {loading ? (
        <ActivityIndicator style={styles.loadingIndicator} size="large" />
      ) : (
        <FlatList
          data={visibleContacts}
          keyExtractor={(item) => item.id}
          renderItem={renderItem}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={handleRefresh} />}
          ListEmptyComponent={<Text style={styles.empty}>{emptyMessage}</Text>}
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.screenBackground },
  header: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    paddingBottom: spacing.sm,
    backgroundColor: colors.headerBackground,
  },
  headerTitle: { fontSize: 24, fontWeight: '700', color: colors.textPrimary },
  searchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.chipBackground,
    borderRadius: radii.input,
    marginHorizontal: spacing.lg,
    marginBottom: spacing.sm,
    paddingHorizontal: spacing.md,
    height: 40,
  },
  searchIcon: { marginRight: spacing.sm },
  search: { flex: 1, fontSize: 15, color: colors.textPrimary, height: '100%' },
  chipsRow: {
    flexDirection: 'row',
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.sm,
  },
  chip: {
    paddingHorizontal: spacing.md,
    paddingVertical: 6,
    borderRadius: radii.chip,
    backgroundColor: colors.chipBackground,
    marginRight: spacing.sm,
  },
  chipActive: { backgroundColor: colors.chipBackgroundActive },
  chipText: { fontSize: 13, fontWeight: '600', color: colors.chipText },
  chipTextActive: { color: colors.chipTextActive },
  error: { color: colors.error, textAlign: 'center', marginBottom: spacing.sm },
  loadingIndicator: { marginTop: 40 },
  empty: { textAlign: 'center', color: colors.textSecondary, marginTop: 40 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.divider,
  },
  avatar: {
    width: 50,
    height: 50,
    borderRadius: radii.avatar,
    backgroundColor: colors.brandGreenDark,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: spacing.md,
  },
  avatarText: { color: '#fff', fontWeight: '700', fontSize: 20 },
  rowMain: { flex: 1, justifyContent: 'center' },
  rowTopLine: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 2,
  },
  name: { fontSize: 16, fontWeight: '600', color: colors.textPrimary, flex: 1, marginRight: 8 },
  timestamp: { fontSize: 12, color: colors.textSecondary },
  timestampUnread: { color: colors.brandGreenDark, fontWeight: '700' },
  rowBottomLine: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  preview: { fontSize: 14, color: colors.textSecondary, flex: 1, marginRight: 8 },
  previewUnread: { color: colors.textPrimary, fontWeight: '500' },
  unreadBadge: {
    backgroundColor: colors.unreadBadge,
    borderRadius: 999,
    minWidth: 20,
    height: 20,
    paddingHorizontal: 6,
    alignItems: 'center',
    justifyContent: 'center',
  },
  unreadBadgeText: { color: '#fff', fontSize: 11, fontWeight: '700' },
});
