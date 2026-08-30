import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../navigation';
import { useAuth } from '../context/AuthContext';
import { describeApiError } from '../api/errors';
import { logApiError } from '../api/logging';
import { getServerUrl } from '../config';
import { clearCredentials, loadCredentials, saveCredentials } from '../api/savedCredentials';
import { colors } from '../theme';

type Props = NativeStackScreenProps<RootStackParamList, 'Login'>;

export default function LoginScreen({ navigation }: Props) {
  const { signIn, sessionExpiredMessage } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [rememberMe, setRememberMe] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // Prefill from a previous "remember me" — doesn't auto-submit, just
  // saves retyping. A picked-up phone still needs someone to tap Sign In.
  useEffect(() => {
    (async () => {
      const saved = await loadCredentials();
      if (saved) {
        setEmail(saved.email);
        setPassword(saved.password);
        setRememberMe(true);
      }
    })();
  }, []);

  const handleSubmit = async () => {
    if (!getServerUrl()) {
      setError('Set your Whatomate server address first — tap "Server settings" below.');
      return;
    }
    if (!email.trim() || !password) {
      setError('Enter your email and password.');
      return;
    }
    setError(null);
    setSubmitting(true);
    try {
      await signIn(email.trim(), password);
      if (rememberMe) {
        await saveCredentials(email.trim(), password);
      } else {
        await clearCredentials();
      }
    } catch (err: unknown) {
      logApiError('Login error:', err);
      setError(describeApiError(err));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <Text style={styles.title}>Whatomate Agent</Text>
      <Text style={styles.subtitle}>Sign in with your Whatomate account</Text>
      <Text style={styles.serverHint}>
        {getServerUrl() ? getServerUrl().replace(/^https?:\/\//, '') : 'No server configured yet — tap "Server settings" below'}
      </Text>

      {sessionExpiredMessage ? (
        <Text style={styles.sessionExpired}>{sessionExpiredMessage}</Text>
      ) : null}

      <TextInput
        style={styles.input}
        placeholder="Email"
        placeholderTextColor={colors.iconGray}
        autoCapitalize="none"
        autoCorrect={false}
        keyboardType="email-address"
        value={email}
        onChangeText={setEmail}
      />
      <TextInput
        style={styles.input}
        placeholder="Password"
        placeholderTextColor={colors.iconGray}
        secureTextEntry
        value={password}
        onChangeText={setPassword}
      />

      <TouchableOpacity
        style={styles.rememberRow}
        onPress={() => setRememberMe((v) => !v)}
        activeOpacity={0.7}
      >
        <Ionicons
          name={rememberMe ? 'checkbox' : 'square-outline'}
          size={20}
          color={rememberMe ? colors.brandGreenDark : colors.iconGray}
          style={styles.rememberCheckbox}
        />
        <Text style={styles.rememberLabel}>Remember my email and password</Text>
      </TouchableOpacity>

      {error ? <Text style={styles.error}>{error}</Text> : null}

      <TouchableOpacity
        style={[styles.button, submitting && styles.buttonDisabled]}
        onPress={handleSubmit}
        disabled={submitting}
      >
        {submitting ? (
          <ActivityIndicator color="#fff" />
        ) : (
          <Text style={styles.buttonText}>Sign In</Text>
        )}
      </TouchableOpacity>

      <TouchableOpacity
        style={styles.settingsLink}
        onPress={() => navigation.navigate('Settings')}
      >
        <Text style={styles.settingsLinkText}>Server settings</Text>
      </TouchableOpacity>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: 24,
    backgroundColor: colors.screenBackground,
  },
  title: {
    fontSize: 28,
    fontWeight: '700',
    textAlign: 'center',
    marginBottom: 4,
    color: colors.textPrimary,
  },
  subtitle: {
    fontSize: 14,
    color: colors.textSecondary,
    textAlign: 'center',
    marginBottom: 4,
  },
  serverHint: {
    fontSize: 12,
    color: colors.iconGray,
    textAlign: 'center',
    marginBottom: 32,
  },
  sessionExpired: {
    fontSize: 13,
    color: '#a15c00',
    backgroundColor: '#fff4dd',
    textAlign: 'center',
    borderRadius: 8,
    paddingVertical: 8,
    paddingHorizontal: 12,
    marginBottom: 16,
  },
  input: {
    borderWidth: 1,
    borderColor: colors.divider,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    marginBottom: 12,
    fontSize: 16,
    color: colors.textPrimary,
  },
  rememberRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 16,
    paddingVertical: 4,
  },
  rememberCheckbox: {
    marginRight: 8,
  },
  rememberLabel: {
    fontSize: 14,
    color: colors.textPrimary,
  },
  error: {
    color: colors.error,
    marginBottom: 12,
    textAlign: 'center',
  },
  button: {
    backgroundColor: colors.brandGreenDark,
    borderRadius: 10,
    paddingVertical: 14,
    alignItems: 'center',
    marginTop: 8,
  },
  buttonDisabled: {
    opacity: 0.6,
  },
  buttonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  settingsLink: {
    marginTop: 20,
    alignItems: 'center',
  },
  settingsLinkText: {
    color: colors.iconGray,
    fontSize: 13,
    textDecorationLine: 'underline',
  },
});
