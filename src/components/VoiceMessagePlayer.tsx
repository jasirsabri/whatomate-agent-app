import React, { useEffect, useMemo, useRef, useState } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useAudioPlayer, useAudioPlayerStatus, type AudioPlayer } from 'expo-audio';
import { ensureFreshAccessToken } from '../api/client';
import { getServerUrl } from '../config';
import { logApiError } from '../api/logging';
import { colors, spacing } from '../theme';

const BAR_COUNT = 28;

/** Only one voice note should ever play at once — module-level rather
 * than React state/context since bubbles are otherwise fully independent
 * and this is the one place they need to coordinate. */
let activePlayer: AudioPlayer | null = null;
function claimActivePlayer(player: AudioPlayer) {
  if (activePlayer && activePlayer !== player) {
    activePlayer.pause();
  }
  activePlayer = player;
}

function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00';
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

/** Deterministic per-message bar heights — this app has no real waveform
 * data (Whatomate doesn't provide amplitude info, and analyzing the
 * audio client-side to generate one felt like a lot of complexity for a
 * decorative touch), so this fakes WhatsApp's waveform look with a
 * stable pattern seeded from the message id, rather than random heights
 * that would look different every re-render. */
function useBarHeights(seed: string): number[] {
  return useMemo(() => {
    let hash = 0;
    for (let i = 0; i < seed.length; i++) {
      hash = (hash * 31 + seed.charCodeAt(i)) & 0xffffffff;
    }
    const heights: number[] = [];
    let x = hash || 1;
    for (let i = 0; i < BAR_COUNT; i++) {
      // xorshift — cheap, deterministic, good enough spread for a
      // decorative pattern, not for anything cryptographic.
      x ^= x << 13;
      x ^= x >>> 17;
      x ^= x << 5;
      heights.push(4 + (Math.abs(x) % 14)); // 4–18px
    }
    return heights;
  }, [seed]);
}

export default function VoiceMessagePlayer({
  messageId,
  isOutgoing,
}: {
  messageId: string;
  isOutgoing: boolean;
}) {
  const player = useAudioPlayer(null);
  const status = useAudioPlayerStatus(player);
  const [sourceReady, setSourceReady] = useState(false);
  const [failed, setFailed] = useState(false);
  const barHeights = useBarHeights(messageId);
  const [trackWidth, setTrackWidth] = useState(0);

  useEffect(() => {
    let isActive = true;
    ensureFreshAccessToken()
      .then((token) => {
        if (!isActive) return;
        if (!token) {
          setFailed(true);
          return;
        }
        player.replace({
          uri: `${getServerUrl()}/api/media/${messageId}`,
          headers: { Authorization: `Bearer ${token}` },
        });
        setSourceReady(true);
      })
      .catch((err) => {
        logApiError('Failed to load voice message:', err);
        if (isActive) setFailed(true);
      });
    return () => {
      isActive = false;
      player.pause();
      if (activePlayer === player) activePlayer = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messageId]);

  const handleTogglePlay = () => {
    if (!sourceReady) return;
    if (status.playing) {
      player.pause();
    } else {
      claimActivePlayer(player);
      // Restart from the beginning once it's played through, matching
      // WhatsApp's own behavior — otherwise tapping play again on a
      // finished note does nothing (already at the end).
      if (status.duration > 0 && status.currentTime >= status.duration - 0.05) {
        player.seekTo(0);
      }
      player.play();
    }
  };

  const handleSeek = (x: number) => {
    if (!sourceReady || !trackWidth || !status.duration) return;
    const fraction = Math.min(1, Math.max(0, x / trackWidth));
    player.seekTo(fraction * status.duration);
  };

  const progress = status.duration > 0 ? status.currentTime / status.duration : 0;
  const playedBars = Math.round(progress * BAR_COUNT);
  const iconColor = isOutgoing ? colors.brandGreenDark : colors.brandGreenDark;

  return (
    <View style={styles.row}>
      <TouchableOpacity
        onPress={handleTogglePlay}
        disabled={!sourceReady && !failed}
        style={styles.playButton}
        hitSlop={8}
      >
        {failed ? (
          <Ionicons name="alert-circle-outline" size={22} color={colors.error} />
        ) : !sourceReady ? (
          <Ionicons name="ellipsis-horizontal" size={20} color={colors.iconGray} />
        ) : (
          <Ionicons
            name={status.playing ? 'pause' : 'play'}
            size={20}
            color={iconColor}
            style={!status.playing ? styles.playIconNudge : undefined}
          />
        )}
      </TouchableOpacity>

      <View style={styles.trackColumn}>
        <TouchableOpacity
          activeOpacity={1}
          style={styles.waveform}
          onLayout={(e) => setTrackWidth(e.nativeEvent.layout.width)}
          onPress={(e) => handleSeek(e.nativeEvent.locationX)}
        >
          {barHeights.map((h, i) => (
            <View
              key={i}
              style={[
                styles.bar,
                { height: h },
                i < playedBars ? styles.barPlayed : styles.barUnplayed,
              ]}
            />
          ))}
        </TouchableOpacity>
        <Text style={styles.time}>
          {failed
            ? "Couldn't load"
            : `${formatTime(status.currentTime)} / ${formatTime(status.duration)}`}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 4,
    minWidth: 220,
  },
  playButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: colors.chipBackground,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: spacing.sm,
  },
  playIconNudge: { marginLeft: 2 }, // optically centers the play triangle
  trackColumn: { flex: 1 },
  waveform: {
    flexDirection: 'row',
    alignItems: 'center',
    height: 22,
  },
  bar: {
    flex: 1,
    marginHorizontal: 1,
    borderRadius: 2,
  },
  barPlayed: { backgroundColor: colors.brandGreenDark },
  barUnplayed: { backgroundColor: colors.divider },
  time: { fontSize: 11, color: colors.textSecondary, marginTop: 2 },
});
