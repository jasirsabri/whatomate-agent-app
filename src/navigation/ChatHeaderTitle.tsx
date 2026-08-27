import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { colors } from '../theme';
import type { Contact } from '../types';

export default function ChatHeaderTitle({ contact }: { contact: Contact }) {
  const displayName = contact.name || contact.profile_name || contact.phone_number;
  return (
    <View style={styles.container}>
      <View style={styles.avatar}>
        <Text style={styles.avatarText}>{displayName.charAt(0).toUpperCase()}</Text>
      </View>
      <View style={styles.textBlock}>
        <Text style={styles.name} numberOfLines={1}>
          {displayName}
        </Text>
        <Text style={styles.phone} numberOfLines={1}>
          {contact.phone_number}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flexDirection: 'row', alignItems: 'center' },
  avatar: {
    width: 34,
    height: 34,
    borderRadius: 999,
    backgroundColor: colors.brandGreenDark,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 10,
  },
  avatarText: { color: '#fff', fontWeight: '700', fontSize: 14 },
  textBlock: { justifyContent: 'center' },
  name: { fontSize: 16, fontWeight: '600', color: colors.textPrimary },
  phone: { fontSize: 12, color: colors.textSecondary },
});
