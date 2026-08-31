import React, { useRef, useState } from 'react';
import { Animated, Modal, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Image } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, spacing } from '../theme';

const DOUBLE_TAP_MS = 300;
const ZOOMED_SCALE = 2.2;

/** Full-screen viewer for a chat image — tap the thumbnail to open, tap
 * the close button (or double-tap the image again) to dismiss.
 * Deliberately simpler than WhatsApp's own pinch-zoom viewer: a
 * double-tap zoom toggle covers the "let me look closer" need without
 * a custom pinch-gesture system (PanResponder-based pinch math is
 * notoriously fiddly, and this app has no gesture library installed —
 * pulling one in just for this felt like more risk than the feature
 * warranted). Shows the message time in the header rather than
 * WhatsApp's sender chrome — in a 1:1 support chat, incoming vs
 * outgoing is already obvious from which side sent it. */
export default function ImageViewerModal({
  visible,
  onClose,
  uri,
  timestampLabel,
}: {
  visible: boolean;
  onClose: () => void;
  uri: string;
  timestampLabel: string;
}) {
  const [zoomed, setZoomed] = useState(false);
  const scale = useRef(new Animated.Value(1)).current;
  const lastTapRef = useRef(0);

  const toggleZoom = () => {
    const next = !zoomed;
    setZoomed(next);
    Animated.timing(scale, {
      toValue: next ? ZOOMED_SCALE : 1,
      duration: 200,
      useNativeDriver: true,
    }).start();
  };

  const handleTap = () => {
    const now = Date.now();
    if (now - lastTapRef.current < DOUBLE_TAP_MS) {
      toggleZoom();
    }
    lastTapRef.current = now;
  };

  const handleClose = () => {
    // Always hand back a non-zoomed view next time it opens.
    if (zoomed) {
      setZoomed(false);
      scale.setValue(1);
    }
    onClose();
  };

  return (
    <Modal visible={visible} animationType="fade" onRequestClose={handleClose} transparent={false}>
      <View style={styles.container}>
        <View style={styles.header}>
          <TouchableOpacity onPress={handleClose} hitSlop={12} style={styles.closeButton}>
            <Ionicons name="close" size={28} color="#fff" />
          </TouchableOpacity>
          <Text style={styles.timestamp}>{timestampLabel}</Text>
          <View style={styles.headerSpacer} />
        </View>
        <TouchableOpacity
          activeOpacity={1}
          style={styles.imageWrapper}
          onPress={handleTap}
        >
          <Animated.Image
            source={{ uri }}
            resizeMode="contain"
            style={[styles.image, { transform: [{ scale }] }]}
          />
        </TouchableOpacity>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.md,
    paddingTop: 50,
    paddingBottom: spacing.sm,
  },
  closeButton: { padding: 4 },
  timestamp: { color: '#fff', fontSize: 13, opacity: 0.85 },
  headerSpacer: { width: 36 },
  imageWrapper: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  image: { width: '100%', height: '100%' },
});
