import type { ReactNode } from 'react'
import { ActivityIndicator, Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native'
import { avatarColor, initials } from './format'
import { colors, tones } from './theme'

export const Avatar = ({ name, size = 40 }: { name: string; size?: number }) => (
  <View style={[styles.avatar, { width: size, height: size, borderRadius: size / 2, backgroundColor: avatarColor(name) }]}>
    <Text style={[styles.avatarText, { fontSize: size * 0.38 }]}>{initials(name)}</Text>
  </View>
)

export const Pill = ({ text, tone }: { text: string; tone: keyof typeof tones }) => (
  <Text style={[styles.pill, { color: tones[tone].fg, backgroundColor: tones[tone].bg }]}>{text}</Text>
)

export const ProgressBar = ({ share, color = colors.ok, track = '#E5E7EB' }: { share: number; color?: string; track?: string }) => (
  <View style={[styles.track, { backgroundColor: track }]}>
    <View style={[styles.fill, { backgroundColor: color, width: `${Math.min(100, Math.round(share * 100))}%` }]} />
  </View>
)

type ButtonProps = {
  label: string
  onPress: () => void
  kind?: 'primary' | 'ghost' | 'ok' | 'danger' | 'whatsapp'
  disabled?: boolean
  busy?: boolean
  small?: boolean
  style?: StyleProp<ViewStyle>
  icon?: ReactNode
}

/** One button component, so every button in the app looks and behaves the same (press feedback, labels). */
export function Button({ label, onPress, kind = 'primary', disabled, busy, small, style, icon }: ButtonProps) {
  const k = kinds[kind]
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled || busy}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: disabled || busy }}
      style={({ pressed }) => [
        styles.button,
        small && styles.buttonSmall,
        { backgroundColor: k.bg, borderColor: k.border },
        (disabled || busy) && { opacity: 0.45 },
        pressed && { opacity: 0.7 },
        style,
      ]}
    >
      {busy ? (
        <ActivityIndicator color={k.fg} />
      ) : (
        <View style={styles.buttonInner}>
          {icon}
          <Text style={[styles.buttonText, small && styles.buttonTextSmall, { color: k.fg }]}>{label}</Text>
        </View>
      )}
    </Pressable>
  )
}

const kinds = {
  primary: { bg: colors.brand, border: colors.brand, fg: '#fff' },
  ghost: { bg: colors.card, border: colors.line, fg: colors.ink },
  ok: { bg: colors.okBg, border: '#A7F3D0', fg: colors.ok },
  danger: { bg: colors.card, border: '#FECACA', fg: colors.danger },
  whatsapp: { bg: '#E7F7F0', border: '#B7E4D3', fg: colors.whatsapp },
}

const styles = StyleSheet.create({
  avatar: { alignItems: 'center', justifyContent: 'center' },
  avatarText: { color: '#fff', fontWeight: '800' },
  pill: { fontSize: 12, fontWeight: '700', paddingVertical: 2, paddingHorizontal: 8, borderRadius: 10, overflow: 'hidden' },
  track: { height: 6, borderRadius: 3, overflow: 'hidden' },
  fill: { height: 6, borderRadius: 3 },
  button: { borderRadius: 12, paddingVertical: 14, paddingHorizontal: 16, alignItems: 'center', justifyContent: 'center', borderWidth: 1 },
  buttonSmall: { borderRadius: 9, paddingVertical: 7, paddingHorizontal: 12 },
  buttonInner: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  buttonText: { fontSize: 16, fontWeight: '700' },
  buttonTextSmall: { fontSize: 13 },
})
