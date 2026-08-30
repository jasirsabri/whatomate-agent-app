import React, { useCallback, useEffect, useState } from 'react';
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
import { listTeamMembers } from '../api/teams';
import { assignTransfer } from '../api/transfers';
import { describeApiError } from '../api/errors';
import { logApiError } from '../api/logging';
import { useSocket } from '../context/SocketContext';
import { colors, spacing } from '../theme';
import type { TeamMember } from '../api/teams';

type Props = NativeStackScreenProps<RootStackParamList, 'AssignAgent'>;

export default function AssignAgentScreen({ route, navigation }: Props) {
  const { transfer } = route.params;
  const { subscribe } = useSocket();
  const [members, setMembers] = useState<TeamMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [assigningId, setAssigningId] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  // Whatomate's AssignAgentTransfer handler has no guard against two
  // managers assigning the same transfer at once beyond checking
  // status=="active" — it never checks whether agent_id is already set
  // before overwriting it, so a second, near-simultaneous assign silently
  // wins with no conflict error. Can't fix that server-side (third-party
  // product), so this is a client-side mitigation: listen for the same
  // live events Queue already reacts to, and if this exact transfer gets
  // assigned or resumed by anyone while this screen is open, stop letting
  // it be picked further rather than let someone submit into a race
  // they can't see.
  const [staleReason, setStaleReason] = useState<string | null>(null);

  useEffect(() => {
    const unsubAssigned = subscribe('agent_transfer_assign', (payload) => {
      const p = payload as { id?: string };
      if (p.id === transfer.id) {
        setStaleReason('Someone else just assigned this conversation.');
      }
    });
    const unsubResumed = subscribe('agent_transfer_resume', (payload) => {
      const p = payload as { id?: string };
      if (p.id === transfer.id) {
        setStaleReason('This conversation was just resumed — it’s no longer waiting for an agent.');
      }
    });
    return () => {
      unsubAssigned();
      unsubResumed();
    };
  }, [subscribe, transfer.id]);

  const fetchMembers = useCallback(async () => {
    try {
      setErrorMessage(null);
      // The transfer already carries which team it belongs to — it only
      // ever reached this screen via the Queue tab, which fetched it
      // pre-filtered by team, so team_id should always be present here.
      if (!transfer.team_id) {
        setErrorMessage('This queue item has no team set — cannot look up its members.');
        setMembers([]);
        return;
      }
      const list = await listTeamMembers(transfer.team_id);
      setMembers(list);
    } catch (err) {
      logApiError('Failed to load team members:', err);
      setErrorMessage(describeApiError(err));
    }
  }, [transfer.team_id]);

  useFocusEffect(
    useCallback(() => {
      let isActive = true;
      setLoading(true);
      fetchMembers().finally(() => {
        if (isActive) setLoading(false);
      });
      return () => {
        isActive = false;
      };
    }, [fetchMembers])
  );

  const handleAssign = async (member: TeamMember) => {
    if (staleReason) return;
    setAssigningId(member.user_id);
    setErrorMessage(null);
    try {
      await assignTransfer(transfer.id, member.user_id);
      navigation.goBack();
    } catch (err) {
      logApiError('Failed to assign transfer:', err);
      setErrorMessage(describeApiError(err));
    } finally {
      setAssigningId(null);
    }
  };

  const renderItem = ({ item }: { item: TeamMember }) => {
    const isAssigning = assigningId === item.user_id;
    return (
      <TouchableOpacity
        style={[styles.row, !item.is_available && styles.rowDisabled]}
        activeOpacity={0.6}
        onPress={() => handleAssign(item)}
        disabled={!item.is_available || assigningId !== null}
      >
        <View style={styles.avatar}>
          <Text style={styles.avatarText}>{item.full_name.charAt(0).toUpperCase()}</Text>
        </View>
        <View style={styles.rowMain}>
          <Text style={styles.name} numberOfLines={1}>
            {item.full_name}
          </Text>
          <Text style={item.is_available ? styles.available : styles.unavailable}>
            {item.is_available ? 'Available' : 'Away'}
          </Text>
        </View>
        {isAssigning ? (
          <ActivityIndicator size="small" color={colors.brandGreenDark} />
        ) : (
          item.is_available && (
            <Ionicons name="checkmark-circle-outline" size={24} color={colors.brandGreenDark} />
          )
        )}
      </TouchableOpacity>
    );
  };

  return (
    <View style={styles.container}>
      <View style={styles.contactBanner}>
        <Text style={styles.contactBannerText} numberOfLines={1}>
          Assigning: {transfer.contact_name || transfer.phone_number}
        </Text>
      </View>

      {errorMessage ? <Text style={styles.error}>{errorMessage}</Text> : null}

      {staleReason ? (
        <View style={styles.staleContainer}>
          <Ionicons name="information-circle-outline" size={32} color={colors.textSecondary} />
          <Text style={styles.staleText}>{staleReason}</Text>
          <TouchableOpacity style={styles.staleButton} onPress={() => navigation.goBack()}>
            <Text style={styles.staleButtonText}>Go Back</Text>
          </TouchableOpacity>
        </View>
      ) : loading ? (
        <ActivityIndicator style={styles.loadingIndicator} size="large" />
      ) : (
        <FlatList
          data={members}
          keyExtractor={(item) => item.id}
          renderItem={renderItem}
          ListEmptyComponent={
            !errorMessage ? (
              <Text style={styles.empty}>No agents are members of this team yet.</Text>
            ) : null
          }
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.screenBackground },
  staleContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.xl,
  },
  staleText: {
    fontSize: 15,
    color: colors.textSecondary,
    textAlign: 'center',
    marginTop: spacing.md,
    marginBottom: spacing.lg,
  },
  staleButton: {
    backgroundColor: colors.brandGreenDark,
    borderRadius: 10,
    paddingVertical: 12,
    paddingHorizontal: 24,
  },
  staleButtonText: { color: '#fff', fontSize: 15, fontWeight: '600' },
  contactBanner: {
    backgroundColor: colors.chipBackground,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  contactBannerText: { fontSize: 14, fontWeight: '600', color: colors.textPrimary },
  error: { color: colors.error, textAlign: 'center', margin: spacing.lg },
  loadingIndicator: { marginTop: 40 },
  empty: { textAlign: 'center', color: colors.textSecondary, marginTop: 40, paddingHorizontal: 24 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.divider,
  },
  rowDisabled: { opacity: 0.5 },
  avatar: {
    width: 44,
    height: 44,
    borderRadius: 999,
    backgroundColor: colors.brandGreenDark,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: spacing.md,
  },
  avatarText: { color: '#fff', fontWeight: '700', fontSize: 17 },
  rowMain: { flex: 1 },
  name: { fontSize: 16, fontWeight: '600', color: colors.textPrimary, marginBottom: 2 },
  available: { fontSize: 13, color: colors.brandGreenDark, fontWeight: '600' },
  unavailable: { fontSize: 13, color: colors.textSecondary },
});
