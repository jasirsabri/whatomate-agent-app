import React, { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  StyleSheet,
  Switch,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { getCurrentUser, updateAvailability } from '../api/me';
import { describeApiError } from '../api/errors';
import { logApiError } from '../api/logging';
import { useAuth } from '../context/AuthContext';
import AppVersionInfo from '../components/AppVersionInfo';
import {
  getNotificationPermissionStatus,
  isSoundEnabled,
  requestNotificationPermission,
  setSoundEnabled,
} from '../notifications';
import { colors, spacing } from '../theme';
import type { CurrentUser } from '../api/me';

export default function ProfileScreen() {
  const { signOut } = useAuth();
  const [user, setUser] = useState<CurrentUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [updatingAvailability, setUpdatingAvailability] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [infoMessage, setInfoMessage] = useState<string | null>(null);
  const [soundOn, setSoundOn] = useState(isSoundEnabled());
  const [updatingSound, setUpdatingSound] = useState(false);
  const [permissionDenied, setPermissionDenied] = useState(false);

  useFocusEffect(
    useCallback(() => {
      setSoundOn(isSoundEnabled());
      getNotificationPermissionStatus().then((status) => {
        setPermissionDenied(status !== 'granted');
      });
    }, [])
  );

  const fetchUser = useCallback(async () => {
    try {
      setErrorMessage(null);
      const current = await getCurrentUser();
      setUser(current);
    } catch (err) {
      logApiError('Failed to load profile:', err);
      setErrorMessage(describeApiError(err));
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      let isActive = true;
      setLoading(true);
      fetchUser().finally(() => {
        if (isActive) setLoading(false);
      });
      return () => {
        isActive = false;
      };
    }, [fetchUser])
  );

  const handleToggleAvailability = async (nextValue: boolean) => {
    if (!user) return;
    setUpdatingAvailability(true);
    setErrorMessage(null);
    setInfoMessage(null);
    try {
      const result = await updateAvailability(nextValue);
      setUser({ ...user, is_available: result.is_available });
      if (!result.is_available && result.transfers_to_queue > 0) {
        setInfoMessage(
          `You're marked away. ${result.transfers_to_queue} conversation${
            result.transfers_to_queue === 1 ? '' : 's'
          } assigned to you ${result.transfers_to_queue === 1 ? 'was' : 'were'} returned to the queue.`
        );
      }
    } catch (err) {
      logApiError('Failed to update availability:', err);
      setErrorMessage(describeApiError(err));
    } finally {
      setUpdatingAvailability(false);
    }
  };

  const handleToggleSound = async (nextValue: boolean) => {
    setUpdatingSound(true);
    setErrorMessage(null);
    try {
      if (nextValue) {
        const granted = await requestNotificationPermission();
        if (!granted) {
          setErrorMessage(
            'Notifications are turned off for this app at the phone level — ' +
              'enable them in your phone\'s Settings app to use this.'
          );
          setUpdatingSound(false);
          return;
        }
      }
      await setSoundEnabled(nextValue);
      setSoundOn(nextValue);
    } finally {
      setUpdatingSound(false);
    }
  };

  const handleRetryPermission = async () => {
    setUpdatingSound(true);
    try {
      const granted = await requestNotificationPermission();
      setPermissionDenied(!granted);
    } finally {
      setUpdatingSound(false);
    }
  };

  const handleSignOut = async () => {
    setSigningOut(true);
    try {
      await signOut();
    } finally {
      setSigningOut(false);
    }
  };

  if (loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {user && (
        <View style={styles.profileHeader}>
          <View style={styles.avatar}>
            <Text style={styles.avatarText}>{user.full_name.charAt(0).toUpperCase()}</Text>
          </View>
          <Text style={styles.name}>{user.full_name}</Text>
          <Text style={styles.email}>{user.email}</Text>
          {user.role && <Text style={styles.role}>{user.role.name}</Text>}
        </View>
      )}

      <View style={styles.section}>
        <View style={styles.availabilityRow}>
          <View style={styles.availabilityLabelBlock}>
            <Text style={styles.availabilityLabel}>Available</Text>
            <Text style={styles.availabilityHint}>
              {user?.is_available
                ? "You'll receive new assignments."
                : 'Marked away — no new assignments, and anything currently assigned to you moves back to the queue.'}
            </Text>
          </View>
          {updatingAvailability ? (
            <ActivityIndicator color={colors.brandGreenDark} />
          ) : (
            <Switch
              value={user?.is_available ?? false}
              onValueChange={handleToggleAvailability}
              trackColor={{ true: colors.brandGreenDark, false: colors.divider }}
              thumbColor="#fff"
            />
          )}
        </View>
      </View>

      <View style={styles.section}>
        <View style={styles.availabilityRow}>
          <View style={styles.availabilityLabelBlock}>
            <Text style={styles.availabilityLabel}>Notification Sound</Text>
            <Text style={styles.availabilityHint}>
              Play a sound for new messages assigned to you while the app is
              open. Messages while the app is closed or backgrounded are
              covered separately by push notifications, which need a push
              bridge server configured in Settings to work.
            </Text>
          </View>
          {updatingSound ? (
            <ActivityIndicator color={colors.brandGreenDark} />
          ) : (
            <Switch
              value={soundOn}
              onValueChange={handleToggleSound}
              trackColor={{ true: colors.brandGreenDark, false: colors.divider }}
              thumbColor="#fff"
            />
          )}
        </View>
        {soundOn && permissionDenied && (
          <View style={styles.permissionWarning}>
            <Text style={styles.permissionWarningText}>
              This is on, but notifications are blocked for this app at the
              phone level, so nothing will actually play. Check your phone's
              Settings app, or try requesting again below.
            </Text>
            <TouchableOpacity onPress={handleRetryPermission} disabled={updatingSound}>
              <Text style={styles.permissionRetryLink}>Request permission again</Text>
            </TouchableOpacity>
          </View>
        )}
      </View>

      {errorMessage ? <Text style={styles.error}>{errorMessage}</Text> : null}
      {infoMessage ? <Text style={styles.info}>{infoMessage}</Text> : null}

      <View style={styles.signOutSection}>
        <TouchableOpacity
          style={styles.signOutButton}
          onPress={handleSignOut}
          disabled={signingOut}
        >
          {signingOut ? (
            <ActivityIndicator color={colors.error} />
          ) : (
            <Text style={styles.signOutButtonText}>Sign Out</Text>
          )}
        </TouchableOpacity>
        <AppVersionInfo />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.screenBackground, padding: spacing.lg },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  profileHeader: { alignItems: 'center', paddingVertical: spacing.lg },
  avatar: {
    width: 72,
    height: 72,
    borderRadius: 999,
    backgroundColor: colors.brandGreenDark,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.sm,
  },
  avatarText: { color: '#fff', fontWeight: '700', fontSize: 28 },
  name: { fontSize: 19, fontWeight: '700', color: colors.textPrimary },
  email: { fontSize: 13, color: colors.textSecondary, marginTop: 2 },
  role: {
    fontSize: 12,
    color: colors.brandGreenDark,
    fontWeight: '600',
    marginTop: 6,
    backgroundColor: colors.chipBackground,
    paddingHorizontal: 10,
    paddingVertical: 3,
    borderRadius: 999,
  },
  section: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderColor: colors.divider,
    paddingVertical: spacing.md,
  },
  availabilityRow: { flexDirection: 'row', alignItems: 'center' },
  availabilityLabelBlock: { flex: 1, marginRight: spacing.md },
  availabilityLabel: { fontSize: 16, fontWeight: '600', color: colors.textPrimary },
  availabilityHint: { fontSize: 13, color: colors.textSecondary, marginTop: 2, lineHeight: 18 },
  permissionWarning: {
    marginTop: spacing.sm,
    backgroundColor: colors.statusWaitingBg,
    borderRadius: 8,
    padding: spacing.sm,
  },
  permissionWarningText: { fontSize: 13, color: colors.statusWaiting, lineHeight: 18 },
  permissionRetryLink: {
    fontSize: 13,
    color: colors.brandGreenDark,
    fontWeight: '600',
    marginTop: spacing.xs,
  },
  error: { color: colors.error, textAlign: 'center', marginTop: spacing.md },
  info: {
    color: colors.brandGreenDark,
    textAlign: 'center',
    marginTop: spacing.md,
    fontSize: 13,
  },
  signOutSection: { marginTop: 'auto', paddingBottom: spacing.lg },
  signOutButton: {
    borderWidth: 1,
    borderColor: colors.error,
    borderRadius: 10,
    paddingVertical: 14,
    alignItems: 'center',
  },
  signOutButtonText: { color: colors.error, fontSize: 16, fontWeight: '600' },
});
