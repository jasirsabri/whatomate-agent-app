import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  RefreshControl,
  SectionList,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import type { CompositeScreenProps } from '@react-navigation/native';
import type { BottomTabScreenProps } from '@react-navigation/bottom-tabs';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { RootStackParamList, MainTabParamList } from '../navigation/types';
import { listTeamQueue, resumeTransfer } from '../api/transfers';
import { resolveTeamIdByName } from '../api/teams';
import { describeApiError } from '../api/errors';
import { logApiError } from '../api/logging';
import { useSocket } from '../context/SocketContext';
import { getTeamName } from '../config';
import { colors, spacing } from '../theme';
import type { AgentTransfer } from '../api/transfers';

type Props = CompositeScreenProps<
  BottomTabScreenProps<MainTabParamList, 'QueueTab'>,
  NativeStackScreenProps<RootStackParamList>
>;

type SectionKey = 'attention' | 'waiting' | 'inProgress';

interface Section {
  key: SectionKey;
  title: string;
  data: AgentTransfer[];
}

/** Short relative duration ("12m", "3h", "2d") — used for both "waiting
 * since" and "picked up ago", just with a different label wrapped around
 * it depending on the section. */
function formatDuration(dateStr: string): string {
  const then = new Date(dateStr).getTime();
  if (Number.isNaN(then)) return '';
  const minutes = Math.max(0, Math.round((Date.now() - then) / 60000));
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.round(hours / 24);
  return `${days}d`;
}

function attentionReasons(item: AgentTransfer): string[] {
  const reasons: string[] = [];
  if (item.sla_breached) reasons.push('SLA breached');
  if (item.escalation_level > 0) reasons.push(`Escalated (Level ${item.escalation_level})`);
  return reasons;
}

export default function QueueScreen({ navigation }: Props) {
  const { subscribe } = useSocket();
  const [transfers, setTransfers] = useState<AgentTransfer[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [resolvingId, setResolvingId] = useState<string | null>(null);

  const fetchQueue = useCallback(async () => {
    try {
      setErrorMessage(null);
      const teamName = getTeamName();
      const teamId = await resolveTeamIdByName(teamName);
      if (!teamId) {
        setErrorMessage(
          `Could not find a team named "${teamName}". Check the Team Name ` +
            `in Settings matches exactly (ask your manager if unsure), and ` +
            `that this account is a member of it or has Teams: Read.`
        );
        setTransfers([]);
        return;
      }
      const items = await listTeamQueue(teamId);
      setTransfers(items);
    } catch (err) {
      logApiError('Failed to load queue:', err);
      setErrorMessage(describeApiError(err));
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      let isActive = true;
      setLoading(true);
      fetchQueue().finally(() => {
        if (isActive) setLoading(false);
      });
      return () => {
        isActive = false;
      };
    }, [fetchQueue])
  );

  // Live updates — this screen previously only refreshed on focus/pull,
  // per the "Queue has no live updates yet" limitation. Event names
  // verified directly against Whatomate's source
  // (internal/handlers/agent_transfers.go's broadcast* functions), same
  // as ConversationListScreen's identical subscription.
  useEffect(() => {
    const unsubCreated = subscribe('agent_transfer', () => fetchQueue());
    const unsubAssigned = subscribe('agent_transfer_assign', () => fetchQueue());
    const unsubResumed = subscribe('agent_transfer_resume', () => fetchQueue());
    return () => {
      unsubCreated();
      unsubAssigned();
      unsubResumed();
    };
  }, [subscribe, fetchQueue]);

  const handleRefresh = async () => {
    setRefreshing(true);
    await fetchQueue();
    setRefreshing(false);
  };

  const doResolve = useCallback(async (transfer: AgentTransfer) => {
    setResolvingId(transfer.id);
    try {
      await resumeTransfer(transfer.id);
      // No further status transition ever comes back for this transfer —
      // resuming is terminal, so removing it locally rather than waiting
      // on a refetch is accurate, not just an optimistic guess.
      setTransfers((prev) => prev.filter((t) => t.id !== transfer.id));
    } catch (err) {
      logApiError('Failed to mark transfer resolved:', err);
      Alert.alert('Could not mark resolved', describeApiError(err));
    } finally {
      setResolvingId(null);
    }
  }, []);

  const handleMarkResolved = useCallback(
    (transfer: AgentTransfer) => {
      Alert.alert(
        'Mark as resolved?',
        `${transfer.contact_name || transfer.phone_number} will be closed out of the queue. ` +
          `This can't be undone from here.`,
        [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Mark Resolved', onPress: () => doResolve(transfer) },
        ]
      );
    },
    [doResolve]
  );

  // Needs Attention takes priority regardless of assignment — an assigned
  // transfer that's breached its resolution SLA is more urgent than a
  // freshly-waiting unassigned one. Only once neither applies does
  // whether it's been picked up (agent_id) decide Waiting vs In Progress.
  const sections = useMemo((): Section[] => {
    const attention: AgentTransfer[] = [];
    const waiting: AgentTransfer[] = [];
    const inProgress: AgentTransfer[] = [];

    for (const t of transfers) {
      if (t.sla_breached || t.escalation_level > 0) {
        attention.push(t);
      } else if (t.agent_id) {
        inProgress.push(t);
      } else {
        waiting.push(t);
      }
    }

    const result: Section[] = [];
    if (attention.length) result.push({ key: 'attention', title: 'Needs Attention', data: attention });
    if (waiting.length) result.push({ key: 'waiting', title: 'Waiting', data: waiting });
    if (inProgress.length) result.push({ key: 'inProgress', title: 'In Progress', data: inProgress });
    return result;
  }, [transfers]);

  // Tab badge for anything that needs a manager's action — Waiting (no
  // agent yet) and Needs Attention (breached/escalated, regardless of
  // assignment). In Progress items don't need a new decision, so they
  // don't count. This is the gap this screen previously had relative to
  // the Chats tab: with manual assignment strategy, a new queue item sits
  // silently until someone happens to open this tab — no in-app signal
  // at all unless the app is backgrounded/closed (push-bridge notifies
  // managers only in that case). A badge means noticing it doesn't
  // depend on which screen happens to be open right now.
  const pendingCount = useMemo(
    () =>
      sections
        .filter((s) => s.key !== 'inProgress')
        .reduce((sum, s) => sum + s.data.length, 0),
    [sections]
  );
  useEffect(() => {
    navigation.setOptions({
      tabBarBadge: pendingCount > 0 ? pendingCount : undefined,
      tabBarBadgeStyle: { backgroundColor: colors.brandGreen },
    });
  }, [pendingCount, navigation]);

  const renderSectionHeader = ({ section }: { section: Section }) => {
    const dotColor =
      section.key === 'attention'
        ? colors.statusAttention
        : section.key === 'waiting'
          ? colors.statusWaiting
          : colors.brandGreenDark;
    const bgColor =
      section.key === 'attention'
        ? colors.statusAttentionBg
        : section.key === 'waiting'
          ? colors.statusWaitingBg
          : colors.statusInProgressBg;
    return (
      <View style={[styles.sectionHeader, { backgroundColor: bgColor }]}>
        <View style={[styles.sectionDot, { backgroundColor: dotColor }]} />
        <Text style={styles.sectionTitle}>
          {section.title} ({section.data.length})
        </Text>
      </View>
    );
  };

  const renderItem = ({ item, section }: { item: AgentTransfer; section: Section }) => {
    let subtitle: string;
    if (section.key === 'attention') {
      const base = item.agent_id
        ? `Assigned to ${item.agent_name ?? 'agent'}`
        : `Waiting ${formatDuration(item.transferred_at)}`;
      subtitle = `${base} · ${attentionReasons(item).join(' · ')}`;
    } else if (section.key === 'inProgress') {
      subtitle = `Assigned to ${item.agent_name ?? 'agent'} · picked up ${formatDuration(
        item.picked_up_at ?? item.transferred_at
      )} ago`;
    } else {
      subtitle = `Waiting ${formatDuration(item.transferred_at)}`;
    }

    const isResolving = resolvingId === item.id;

    return (
      <View style={styles.row}>
        <TouchableOpacity
          style={styles.rowTappable}
          activeOpacity={0.6}
          onPress={() => navigation.navigate('TransferDetail', { transfer: item })}
        >
          <View style={styles.avatar}>
            <Text style={styles.avatarText}>{item.contact_name.charAt(0).toUpperCase()}</Text>
          </View>
          <View style={styles.rowMain}>
            <Text style={styles.name} numberOfLines={1}>
              {item.contact_name || item.phone_number}
            </Text>
            <Text
              style={[styles.subtitle, section.key === 'attention' && styles.subtitleAttention]}
              numberOfLines={1}
            >
              {subtitle}
            </Text>
          </View>
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.resolveButton}
          onPress={() => handleMarkResolved(item)}
          disabled={isResolving}
          hitSlop={8}
        >
          {isResolving ? (
            <ActivityIndicator size="small" color={colors.brandGreenDark} />
          ) : (
            <Ionicons name="checkmark-done-circle-outline" size={26} color={colors.brandGreenDark} />
          )}
        </TouchableOpacity>
      </View>
    );
  };

  return (
    <View style={styles.container}>
      {errorMessage ? <Text style={styles.error}>{errorMessage}</Text> : null}

      {loading ? (
        <ActivityIndicator style={styles.loadingIndicator} size="large" />
      ) : (
        <SectionList
          sections={sections}
          keyExtractor={(item) => item.id}
          renderItem={renderItem}
          renderSectionHeader={renderSectionHeader}
          stickySectionHeadersEnabled={false}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={handleRefresh} />}
          ListEmptyComponent={
            !errorMessage ? <Text style={styles.empty}>Queue is empty.</Text> : null
          }
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.screenBackground },
  error: { color: colors.error, textAlign: 'center', margin: spacing.lg },
  loadingIndicator: { marginTop: 40 },
  empty: { textAlign: 'center', color: colors.textSecondary, marginTop: 40 },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
  },
  sectionDot: { width: 8, height: 8, borderRadius: 4, marginRight: spacing.sm },
  sectionTitle: { fontSize: 13, fontWeight: '700', color: colors.textPrimary },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.divider,
  },
  rowTappable: { flex: 1, flexDirection: 'row', alignItems: 'center' },
  avatar: {
    width: 46,
    height: 46,
    borderRadius: 999,
    backgroundColor: colors.brandGreenDark,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: spacing.md,
  },
  avatarText: { color: '#fff', fontWeight: '700', fontSize: 18 },
  rowMain: { flex: 1, marginRight: spacing.sm },
  name: { fontSize: 16, fontWeight: '600', color: colors.textPrimary, marginBottom: 2 },
  subtitle: { fontSize: 13, color: colors.textSecondary },
  subtitleAttention: { color: colors.statusAttention, fontWeight: '600' },
  resolveButton: { paddingLeft: spacing.sm },
});
