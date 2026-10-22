export const colors = {
  bg: '#F6F7F9',
  card: '#FFFFFF',
  ink: '#111827',
  muted: '#6B7280',
  line: '#E5E7EB',
  brand: '#4F46E5',
  brandSoft: '#EEF2FF',
  danger: '#DC2626',
  dangerBg: '#FEF2F2',
  dangerPill: '#FEE2E2',
  ok: '#059669',
  okBg: '#ECFDF5',
  warn: '#D97706',
  warnBg: '#FEF3C7',
  whatsapp: '#128C7E',
}

export const tones = {
  ok: { fg: colors.ok, bg: colors.okBg },
  danger: { fg: colors.danger, bg: colors.dangerPill },
  warn: { fg: colors.warn, bg: colors.warnBg },
  muted: { fg: colors.muted, bg: '#F3F4F6' },
}

// Digits all take the same width, so amounts line up in lists (like banking apps).
export const money = { fontVariant: ['tabular-nums' as const] }
