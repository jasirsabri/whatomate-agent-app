// Design tokens matching WhatsApp's current (2024+) look: a white top bar
// with green used selectively (badges, the send button, active states)
// rather than a solid green header, rounded bubbles with light shadow,
// and WhatsApp's specific near-black/gray text colors rather than pure
// black/gray. Verified against WhatsApp's actual current design before
// building this, not assumed from memory of the older all-green look.

export const colors = {
  brandGreen: '#25D366', // accent — send button, unread badges, active states
  brandGreenDark: '#075E54', // used sparingly (e.g. header icon tint)
  headerBackground: '#FFFFFF',
  headerBorder: '#E9EDEF',
  screenBackground: '#FFFFFF',
  chatBackground: '#EFEAE2', // chat wallpaper beige
  bubbleIncoming: '#FFFFFF',
  bubbleOutgoing: '#D9FDD3',
  textPrimary: '#111B21',
  textSecondary: '#667781',
  iconGray: '#8696A0',
  divider: '#E9EDEF',
  unreadBadge: '#25D366',
  error: '#D33',
  chipBackground: '#F0F2F5',
  chipBackgroundActive: '#075E54',
  chipTextActive: '#FFFFFF',
  chipText: '#111B21',
  checkSent: '#8696A0',
  checkRead: '#53BDEB',
  // Queue status sections — attention (red), waiting (amber), in
  // progress (green). Reuses brandGreenDark for consistency elsewhere.
  statusAttention: '#D33',
  statusAttentionBg: '#FDEDEC',
  statusWaiting: '#B7791F',
  statusWaitingBg: '#FEF6E7',
  statusInProgressBg: '#E8F5E9',
} as const;

export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
} as const;

export const radii = {
  bubble: 8,
  chip: 16,
  avatar: 999,
  input: 24,
} as const;
