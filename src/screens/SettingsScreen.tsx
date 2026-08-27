import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import {
  DEFAULT_CONTACT_TAG,
  DEFAULT_TEAM_NAME,
  DEFAULT_SERVER_URL,
  DEFAULT_PUSH_BRIDGE_URL,
  getContactTag,
  getTeamName,
  getServerUrl,
  getPushBridgeUrl,
  normalizeServerUrl,
  resetContactTagToDefault,
  resetTeamNameToDefault,
  resetServerUrlToDefault,
  resetPushBridgeUrlToDefault,
  setContactTag,
  setTeamName,
  setServerUrl,
  setPushBridgeUrl,
} from '../config';
import { clearCredentials, hasSavedCredentials } from '../api/savedCredentials';
import { colors } from '../theme';

// Only reachable from the login screen (see navigation/index.tsx) — there's
// never an authenticated session to worry about here, so no sign-out
// section, and clearing saved credentials on a server change is always
// safe to do unconditionally.
export default function SettingsScreen() {
  const [serverUrl, setServerUrlInput] = useState(getServerUrl());
  const [contactTag, setContactTagInput] = useState(getContactTag());
  const [teamName, setTeamNameInput] = useState(getTeamName());
  const [pushBridgeUrl, setPushBridgeUrlInput] = useState(getPushBridgeUrl());
  const [error, setError] = useState<string | null>(null);
  const [savedMessage, setSavedMessage] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [hasSavedLogin, setHasSavedLogin] = useState(false);
  const [clearingLogin, setClearingLogin] = useState(false);

  useEffect(() => {
    hasSavedCredentials().then(setHasSavedLogin);
  }, []);

  const handleSave = async () => {
    const trimmedUrl = serverUrl.trim();
    const trimmedTag = contactTag.trim();
    const trimmedTeam = teamName.trim();
    const trimmedBridge = pushBridgeUrl.trim();

    if (!trimmedUrl) {
      setError('Enter a server URL.');
      return;
    }
    if (!/^https?:\/\//i.test(trimmedUrl)) {
      setError('Server URL must start with http:// or https://');
      return;
    }
    if (!trimmedTag) {
      setError('Enter a contact tag.');
      return;
    }
    if (!trimmedTeam) {
      setError('Enter your team name.');
      return;
    }
    if (!trimmedBridge) {
      setError('Enter a push notification server URL.');
      return;
    }
    if (!/^https?:\/\//i.test(trimmedBridge)) {
      setError('Push notification server URL must start with http:// or https://');
      return;
    }

    setError(null);
    setSavedMessage(null);
    setSaving(true);
    try {
      const normalizedUrl = normalizeServerUrl(trimmedUrl);
      const serverChanged = normalizedUrl !== getServerUrl();

      await setServerUrl(normalizedUrl);
      await setContactTag(trimmedTag);
      await setTeamName(trimmedTeam);
      await setPushBridgeUrl(trimmedBridge);
      setServerUrlInput(normalizedUrl);
      setPushBridgeUrlInput(normalizeServerUrl(trimmedBridge));

      if (serverChanged) {
        // A saved login belongs to the old server — clear it rather than
        // prefill credentials that won't mean anything to a different one.
        await clearCredentials();
        setHasSavedLogin(false);
      }
      setSavedMessage('Saved.');
    } finally {
      setSaving(false);
    }
  };

  const handleResetToDefaults = async () => {
    setError(null);
    setSavedMessage(null);
    setSaving(true);
    try {
      const serverChanged = getServerUrl() !== DEFAULT_SERVER_URL;

      await resetServerUrlToDefault();
      await resetContactTagToDefault();
      await resetTeamNameToDefault();
      await resetPushBridgeUrlToDefault();
      setServerUrlInput(DEFAULT_SERVER_URL);
      setContactTagInput(DEFAULT_CONTACT_TAG);
      setTeamNameInput(DEFAULT_TEAM_NAME);
      setPushBridgeUrlInput(DEFAULT_PUSH_BRIDGE_URL);

      if (serverChanged) {
        await clearCredentials();
        setHasSavedLogin(false);
      }
      setSavedMessage('Reset to defaults.');
    } finally {
      setSaving(false);
    }
  };

  const handleForgetSavedLogin = async () => {
    setClearingLogin(true);
    try {
      await clearCredentials();
      setHasSavedLogin(false);
    } finally {
      setClearingLogin(false);
    }
  };

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <ScrollView contentContainerStyle={styles.scrollContent} keyboardShouldPersistTaps="handled">
        <Text style={styles.sectionLabel}>Server URL</Text>
        <Text style={styles.helpText}>
          Point the app at your organization's Whatomate instance.
        </Text>
        <TextInput
          style={styles.input}
          placeholder={DEFAULT_SERVER_URL}
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="url"
          value={serverUrl}
          onChangeText={setServerUrlInput}
        />

        <Text style={styles.sectionLabel}>Contact Tag</Text>
        <Text style={styles.helpText}>
          Only contacts with this tag show up in the conversation list —
          keeps this app scoped to your team's contacts.
        </Text>
        <TextInput
          style={styles.input}
          placeholder={DEFAULT_CONTACT_TAG}
          autoCapitalize="none"
          autoCorrect={false}
          value={contactTag}
          onChangeText={setContactTagInput}
        />

        <Text style={styles.sectionLabel}>Your Team Name</Text>
        <Text style={styles.helpText}>
          Enter the name of the team you're part of in Whatomate, exactly
          as it appears there (ask your manager if you're not sure). This
          is used to find your team's queue on the Queue tab — which only
          shows up at all if your account has Transfers: Write permission.
        </Text>
        <TextInput
          style={styles.input}
          placeholder={DEFAULT_TEAM_NAME}
          autoCapitalize="words"
          autoCorrect={false}
          value={teamName}
          onChangeText={setTeamNameInput}
        />

        <Text style={styles.sectionLabel}>Push Notification Server</Text>
        <Text style={styles.helpText}>
          A separate, self-hosted service that makes background push
          notifications work — not part of Whatomate itself. You shouldn't
          normally need to change this.
        </Text>
        <TextInput
          style={styles.input}
          placeholder={DEFAULT_PUSH_BRIDGE_URL}
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="url"
          value={pushBridgeUrl}
          onChangeText={setPushBridgeUrlInput}
        />

        {error ? <Text style={styles.error}>{error}</Text> : null}
        {savedMessage ? <Text style={styles.saved}>{savedMessage}</Text> : null}

        <TouchableOpacity
          style={[styles.button, saving && styles.buttonDisabled]}
          onPress={handleSave}
          disabled={saving}
        >
          {saving ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={styles.buttonText}>Save</Text>
          )}
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.secondaryButton}
          onPress={handleResetToDefaults}
          disabled={saving}
        >
          <Text style={styles.secondaryButtonText}>Reset all to defaults</Text>
        </TouchableOpacity>

        {hasSavedLogin && (
          <View style={styles.savedLoginSection}>
            <Text style={styles.sectionLabel}>Saved Login</Text>
            <Text style={styles.helpText}>
              Your email and password are saved on this device so you don't
              have to retype them each time your session expires. Remove
              them if this device is shared or you're no longer using it
              for this.
            </Text>
            <TouchableOpacity
              style={styles.secondaryButton}
              onPress={handleForgetSavedLogin}
              disabled={clearingLogin}
            >
              {clearingLogin ? (
                <ActivityIndicator color={colors.brandGreenDark} />
              ) : (
                <Text style={styles.secondaryButtonText}>Forget saved login</Text>
              )}
            </TouchableOpacity>
          </View>
        )}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.screenBackground },
  scrollContent: { padding: 24 },
  sectionLabel: {
    fontSize: 13,
    fontWeight: '700',
    color: colors.textSecondary,
    marginTop: 20,
    marginBottom: 6,
  },
  helpText: { fontSize: 13, color: colors.textSecondary, marginBottom: 10, lineHeight: 18 },
  input: {
    borderWidth: 1,
    borderColor: colors.divider,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 15,
    color: colors.textPrimary,
  },
  error: { color: colors.error, marginTop: 16 },
  saved: { color: '#0a5c1f', marginTop: 16 },
  button: {
    backgroundColor: colors.brandGreenDark,
    borderRadius: 10,
    paddingVertical: 14,
    alignItems: 'center',
    marginTop: 24,
  },
  buttonDisabled: { opacity: 0.6 },
  buttonText: { color: '#fff', fontSize: 16, fontWeight: '600' },
  secondaryButton: {
    marginTop: 12,
    alignItems: 'center',
    paddingVertical: 8,
  },
  secondaryButtonText: { color: colors.brandGreenDark, fontSize: 14, fontWeight: '600' },
  savedLoginSection: {
    marginTop: 24,
    paddingTop: 20,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.divider,
  },
});
