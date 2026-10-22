import { useEffect, useState } from 'react'
import { ActivityIndicator, KeyboardAvoidingView, Platform, Pressable, StyleSheet, Text, TextInput, View } from 'react-native'
import { api } from './api'
import { colors } from './theme'

const RESEND_SECONDS = 30 // matches the server's resend rule

export function LoginScreen({ onLogin }: { onLogin: (token: string) => void }) {
  const [digits, setDigits] = useState('') // the 10 digits after +91
  const [code, setCode] = useState('')
  const [step, setStep] = useState<'phone' | 'code'>('phone')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [resendIn, setResendIn] = useState(0)
  const phone = `+91${digits}`

  useEffect(() => {
    if (resendIn <= 0) return
    const t = setTimeout(() => setResendIn((s) => s - 1), 1000)
    return () => clearTimeout(t)
  }, [resendIn])

  async function run(fn: () => Promise<void>) {
    setBusy(true)
    setError(null)
    try {
      await fn()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const sendCode = () =>
    run(async () => {
      await api('/auth/otp', { method: 'POST', body: JSON.stringify({ phone }) })
      setStep('code')
      setCode('')
      setResendIn(RESEND_SECONDS)
    })

  const verify = (c: string) =>
    run(async () => {
      const { token } = await api<{ token: string }>('/auth/verify', { method: 'POST', body: JSON.stringify({ phone, code: c }) })
      onLogin(token)
    })

  // Log in as soon as the 6th digit is typed, like most OTP screens.
  const onCode = (t: string) => {
    const c = t.replace(/\D/g, '')
    setCode(c)
    if (c.length === 6 && !busy) verify(c)
  }

  return (
    <KeyboardAvoidingView style={styles.screen} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <Text style={styles.logo}>₹</Text>
      <Text style={styles.brand}>MiniLedger</Text>
      <Text style={styles.tagline}>Remember who owes you, and get it back.</Text>

      {step === 'phone' ? (
        <>
          <Text style={styles.label}>Your phone number</Text>
          <View style={styles.phoneRow}>
            <Text style={styles.prefix}>+91</Text>
            <TextInput
              style={styles.phoneInput}
              value={digits.replace(/(\d{5})(\d+)/, '$1 $2')}
              onChangeText={(t) => setDigits(t.replace(/\D/g, '').slice(0, 10))}
              placeholder="98765 43210"
              keyboardType="number-pad"
              textContentType="telephoneNumber"
              autoFocus
              accessibilityLabel="Phone number"
            />
          </View>
        </>
      ) : (
        <>
          <Text style={styles.label}>Enter the 6-digit code sent to +91 {digits.replace(/(\d{5})(\d+)/, '$1 $2')}</Text>
          <TextInput
            style={[styles.input, styles.code]}
            value={code}
            onChangeText={onCode}
            placeholder="------"
            keyboardType="number-pad"
            textContentType="oneTimeCode"
            autoFocus
            maxLength={6}
            accessibilityLabel="One-time code"
          />
          <Text style={styles.hint}>Demo: the code is printed in the server log.</Text>
        </>
      )}

      {error && <Text style={styles.error} accessibilityLiveRegion="polite">{error}</Text>}

      {step === 'phone' ? (
        <Pressable
          style={[styles.button, (digits.length !== 10 || busy) && styles.buttonDisabled]}
          disabled={digits.length !== 10 || busy}
          onPress={sendCode}
          accessibilityRole="button"
          accessibilityLabel="Send code"
        >
          {busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.buttonText}>Send code</Text>}
        </Pressable>
      ) : (
        <>
          {busy && <ActivityIndicator style={{ marginTop: 20 }} color={colors.brand} />}
          <View style={styles.codeLinks}>
            <Pressable onPress={() => { setStep('phone'); setError(null) }} accessibilityRole="button">
              <Text style={styles.link}>Change number</Text>
            </Pressable>
            <Pressable disabled={resendIn > 0 || busy} onPress={sendCode} accessibilityRole="button">
              <Text style={[styles.link, resendIn > 0 && { color: colors.muted }]}>
                {resendIn > 0 ? `Resend in ${resendIn}s` : 'Resend code'}
              </Text>
            </Pressable>
          </View>
        </>
      )}
    </KeyboardAvoidingView>
  )
}

const styles = StyleSheet.create({
  screen: { flex: 1, justifyContent: 'center', padding: 24, backgroundColor: colors.bg },
  logo: { width: 56, height: 56, borderRadius: 16, backgroundColor: colors.brand, color: '#fff', fontSize: 30, fontWeight: '800', textAlign: 'center', lineHeight: 56, overflow: 'hidden', marginBottom: 16 },
  brand: { fontSize: 32, fontWeight: '800', color: colors.ink },
  tagline: { fontSize: 15, color: colors.muted, marginTop: 4, marginBottom: 32 },
  label: { fontSize: 14, color: colors.ink, marginBottom: 8, fontWeight: '600' },
  phoneRow: { flexDirection: 'row', borderWidth: 1, borderColor: colors.line, borderRadius: 12, backgroundColor: '#fff', overflow: 'hidden' },
  prefix: { paddingHorizontal: 14, paddingVertical: 14, fontSize: 18, color: colors.muted, backgroundColor: '#F3F4F6', fontWeight: '600' },
  phoneInput: { flex: 1, padding: 14, fontSize: 18, letterSpacing: 0 },
  input: { borderWidth: 1, borderColor: colors.line, borderRadius: 12, padding: 14, fontSize: 18, backgroundColor: '#fff' },
  code: { letterSpacing: 10, textAlign: 'center', fontSize: 26 },
  hint: { fontSize: 12, color: colors.muted, marginTop: 8 },
  error: { color: colors.danger, marginTop: 12 },
  button: { backgroundColor: colors.brand, borderRadius: 12, padding: 16, alignItems: 'center', marginTop: 20 },
  buttonDisabled: { opacity: 0.4 },
  buttonText: { color: '#fff', fontSize: 16, fontWeight: '700' },
  codeLinks: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 20 },
  link: { color: colors.brand, fontWeight: '600' },
})
