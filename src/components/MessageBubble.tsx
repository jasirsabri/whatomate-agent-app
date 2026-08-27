import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, radii, spacing } from '../theme';
import type { WhatomateMessage } from '../types';

/** WhatsApp's exact convention: single gray check (sent), double gray
 * check (delivered), double blue check (read). No icon while pending, a
 * small warning for failed — matches what an agent actually needs to know
 * at a glance about whether a reply went through. */
function MessageStatusIcon({ status }: { status: string }) {
  if (status === 'read') {
    return <Ionicons name="checkmark-done" size={16} color={colors.checkRead} />;
  }
  if (status === 'delivered') {
    return <Ionicons name="checkmark-done" size={16} color={colors.checkSent} />;
  }
  if (status === 'sent') {
    return <Ionicons name="checkmark" size={16} color={colors.checkSent} />;
  }
  if (status === 'failed') {
    return <Ionicons name="alert-circle-outline" size={14} color={colors.error} />;
  }
  return <Ionicons name="time-outline" size={14} color={colors.checkSent} />;
}

function formatBubbleTime(dateStr: string): string {
  const date = new Date(dateStr);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}

export default function MessageBubble({ message }: { message: WhatomateMessage }) {
  const isOutgoing = message.direction === 'outgoing';
  const isFailed = message.status === 'failed';
  return (
    <View style={styles.bubbleRow}>
      <View style={[styles.bubble, isOutgoing ? styles.bubbleOutgoing : styles.bubbleIncoming]}>
        <Text style={styles.bubbleText}>
          {message.content?.body ?? `[${message.message_type}]`}
        </Text>
        {isFailed && (
          <Text style={styles.bubbleErrorText}>
            {message.error_message || 'Message failed to send.'}
          </Text>
        )}
        <View style={styles.bubbleMeta}>
          <Text style={styles.bubbleTime}>{formatBubbleTime(message.created_at)}</Text>
          {isOutgoing && (
            <View style={styles.bubbleStatus}>
              <MessageStatusIcon status={message.status} />
            </View>
          )}
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  bubbleRow: { marginBottom: 6 },
  bubble: {
    maxWidth: '80%',
    borderRadius: radii.bubble,
    paddingHorizontal: spacing.sm + 2,
    paddingTop: 6,
    paddingBottom: 4,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.08,
    shadowRadius: 1,
    elevation: 1,
  },
  bubbleIncoming: {
    backgroundColor: colors.bubbleIncoming,
    alignSelf: 'flex-start',
    borderBottomLeftRadius: 2,
  },
  bubbleOutgoing: {
    backgroundColor: colors.bubbleOutgoing,
    alignSelf: 'flex-end',
    borderBottomRightRadius: 2,
  },
  bubbleText: { color: colors.textPrimary, fontSize: 15, lineHeight: 20 },
  bubbleErrorText: {
    color: colors.error,
    fontSize: 12,
    lineHeight: 16,
    marginTop: 4,
  },
  bubbleMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-end',
    marginTop: 2,
  },
  bubbleTime: { fontSize: 11, color: colors.textSecondary },
  bubbleStatus: { marginLeft: 4 },
});
