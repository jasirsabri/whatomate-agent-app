import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Image, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { ensureFreshAccessToken } from '../api/client';
import { getServerUrl } from '../config';
import { logApiError } from '../api/logging';
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

/** Non-image media (video/audio/document/location/contact) — this app has
 * no player/viewer for these yet, just an honest "here's what this is"
 * placeholder instead of a blank bubble. Icon-only, no attempt at inline
 * playback. */
function mediaFallback(message: WhatomateMessage): { icon: keyof typeof Ionicons.glyphMap; label: string } {
  switch (message.message_type) {
    case 'video':
      return { icon: 'videocam-outline', label: 'Video' };
    case 'audio':
      return { icon: 'musical-notes-outline', label: 'Voice message' };
    case 'document':
      return { icon: 'document-text-outline', label: message.media_filename || 'Document' };
    case 'location':
      return { icon: 'location-outline', label: 'Location shared' };
    case 'contact':
      return { icon: 'person-outline', label: 'Contact shared' };
    case 'reaction':
      return { icon: 'happy-outline', label: 'Reaction' };
    default:
      return { icon: 'help-circle-outline', label: `[${message.message_type}]` };
  }
}

/** GET /api/media/{message_id} requires the same Bearer auth as every
 * other endpoint (verified against Whatomate's ServeMedia handler) — the
 * message's own media_url field is just an internal storage path, never
 * a fetchable URL by itself. RN's Image supports a headers dict on its
 * source, so this fetches a fresh token once and renders once it's in
 * hand, rather than trying to attach auth to a plain <Image uri=...>. */
function MediaImage({ messageId }: { messageId: string }) {
  const [authHeader, setAuthHeader] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let isActive = true;
    ensureFreshAccessToken()
      .then((token) => {
        if (isActive) {
          if (token) setAuthHeader(`Bearer ${token}`);
          else setFailed(true);
        }
      })
      .catch((err) => {
        logApiError('Failed to get token for media image:', err);
        if (isActive) setFailed(true);
      });
    return () => {
      isActive = false;
    };
  }, [messageId]);

  if (failed) {
    return (
      <View style={[styles.mediaImage, styles.mediaImageFallback]}>
        <Ionicons name="image-outline" size={28} color={colors.iconGray} />
        <Text style={styles.mediaFallbackText}>Couldn't load image</Text>
      </View>
    );
  }

  if (!authHeader) {
    return (
      <View style={[styles.mediaImage, styles.mediaImageFallback]}>
        <ActivityIndicator size="small" color={colors.iconGray} />
      </View>
    );
  }

  return (
    <Image
      style={styles.mediaImage}
      resizeMode="cover"
      source={{
        uri: `${getServerUrl()}/api/media/${messageId}`,
        headers: { Authorization: authHeader },
      }}
      onError={() => setFailed(true)}
    />
  );
}

export default function MessageBubble({ message }: { message: WhatomateMessage }) {
  const isOutgoing = message.direction === 'outgoing';
  const isFailed = message.status === 'failed';
  const hasMedia = Boolean(message.media_url);
  const isImage = hasMedia && message.message_type === 'image';
  // No omitempty on the Go side for content.body — a captionless media
  // message serializes as "" (present, empty), not omitted, so `??`
  // never falls back and previously rendered a genuinely blank bubble.
  // Trim-and-check catches that; falls back to the media placeholder (or
  // the raw type as a last resort) instead of an empty string.
  const caption = message.content?.body?.trim();

  return (
    <View style={styles.bubbleRow}>
      <View style={[styles.bubble, isOutgoing ? styles.bubbleOutgoing : styles.bubbleIncoming]}>
        {isImage ? (
          <MediaImage messageId={message.id} />
        ) : hasMedia ? (
          (() => {
            const fallback = mediaFallback(message);
            return (
              <View style={styles.mediaFallbackRow}>
                <Ionicons name={fallback.icon} size={20} color={colors.textSecondary} />
                <Text style={styles.mediaFallbackLabel}>{fallback.label}</Text>
              </View>
            );
          })()
        ) : null}
        {caption || !hasMedia ? (
          <Text style={styles.bubbleText}>{caption || `[${message.message_type}]`}</Text>
        ) : null}
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
  mediaImage: {
    width: 220,
    height: 220,
    borderRadius: radii.bubble - 4,
    marginTop: 2,
    marginBottom: 4,
    backgroundColor: colors.chipBackground,
  },
  mediaImageFallback: { alignItems: 'center', justifyContent: 'center' },
  mediaFallbackText: { fontSize: 12, color: colors.iconGray, marginTop: 6 },
  mediaFallbackRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 6,
  },
  mediaFallbackLabel: {
    marginLeft: spacing.sm,
    fontSize: 14,
    color: colors.textSecondary,
    flexShrink: 1,
  },
});
