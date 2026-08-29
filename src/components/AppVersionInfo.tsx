import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import * as Application from 'expo-application';
import * as Updates from 'expo-updates';
import { colors, spacing } from '../theme';

/** What's actually running, not what was built — an OTA update means the
 * JS bundle can be newer than the native version/build number alone
 * suggests, which is exactly the ambiguity that made earlier bug reports
 * hard to pin down without asking the reporter several rounds of "which
 * build are you on?" first. */
function formatUpdateLine(): string {
  if (Updates.isEmbeddedLaunch) {
    return 'Running the build\'s original bundle — no update applied yet';
  }
  const publishedAt = Updates.createdAt
    ? Updates.createdAt.toLocaleString(undefined, {
        month: 'short',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
      })
    : 'unknown time';
  const shortId = Updates.updateId ? Updates.updateId.slice(0, 8) : 'unknown';
  return `Update ${shortId} · published ${publishedAt}`;
}

export default function AppVersionInfo() {
  const version = Application.nativeApplicationVersion ?? '?';
  const build = Application.nativeBuildVersion ?? '?';

  return (
    <View style={styles.container}>
      <Text style={styles.primary}>
        Whatomate Agent v{version} (build {build})
      </Text>
      <Text style={styles.secondary}>{formatUpdateLine()}</Text>
      {Updates.channel ? <Text style={styles.secondary}>Channel: {Updates.channel}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { alignItems: 'center', paddingVertical: spacing.md },
  primary: { fontSize: 12, fontWeight: '600', color: colors.textSecondary },
  secondary: { fontSize: 11, color: colors.textSecondary, marginTop: 2 },
});
