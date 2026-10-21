import { useState } from 'react'
import { ActivityIndicator, KeyboardAvoidingView, Platform, Pressable, StyleSheet, Text, TextInput, View } from 'react-native'
import { api } from './api'
import { colors } from './theme'

export function LoginScreen({ onLogin }: { onLogin: (token: string) => void }) {
  const [phone, setPhone] = useState('')
  const [code, setCode] = useState('')
  const [step, setStep] = useState<'phone' | 'code'>('phone')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

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
    })

  const verify = () =>
    run(async () => {
      const { token } = await api<{ token: string }>('/auth/verify', { method: 'POST', body: JSON.stringify({ phone, code }) })
      onLogin(token)
    })

  const ready = step === 'phone' ? phone.replace(/\D/g, '').length >= 10 : code.length === 6

  return (
    <KeyboardAvoidingView style={styles.screen} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <Text style={styles.brand}>MiniLedger</Text>
      <Text style={styles.tagline}>Keep track of money you've lent to friends.</Text>

      {step === 'phone' ? (
        <>
          <Text style={styles.label}>Phone number</Text>
          <TextInput
            style={styles.input}
            value={phone}
            onChangeText={setPhone}
            placeholder="98765 43210"
            keyboardType="phone-pad"
            autoFocus
            maxLength={15}
          />
        </>
      ) : (
        <>
          <Text style={styles.label}>Enter the 6-digit code sent to {phone}</Text>
          <TextInput
            style={[styles.input, styles.code]}
            value={code}
            onChangeText={(t) => setCode(t.replace(/\D/g, ''))}
            placeholder="------"
            keyboardType="number-pad"
            textContentType="oneTimeCode"
            autoFocus
            maxLength={6}
          />
          <Text style={styles.hint}>Demo: the code is printed in the server log.</Text>
        </>
      )}

      {error && <Text style={styles.error}>{error}</Text>}

      <Pressable
        style={[styles.button, (!ready || busy) && styles.buttonDisabled]}
        disabled={!ready || busy}
        onPress={step === 'phone' ? sendCode : verify}
      >
        {busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.buttonText}>{step === 'phone' ? 'Send code' : 'Log in'}</Text>}
      </Pressable>

      {step === 'code' && (
        <Pressable onPress={() => { setStep('phone'); setCode(''); setError(null) }}>
          <Text style={styles.link}>Change number</Text>
        </Pressable>
      )}
    </KeyboardAvoidingView>
  )
}

const styles = StyleSheet.create({
  screen: { flex: 1, justifyContent: 'center', padding: 24, backgroundColor: colors.bg },
  brand: { fontSize: 32, fontWeight: '800', color: colors.ink },
  tagline: { fontSize: 15, color: colors.muted, marginTop: 4, marginBottom: 32 },
  label: { fontSize: 14, color: colors.ink, marginBottom: 8, fontWeight: '600' },
  input: { borderWidth: 1, borderColor: colors.line, borderRadius: 12, padding: 14, fontSize: 18, backgroundColor: '#fff' },
  code: { letterSpacing: 8, textAlign: 'center', fontSize: 24 },
  hint: { fontSize: 12, color: colors.muted, marginTop: 8 },
  error: { color: colors.danger, marginTop: 12 },
  button: { backgroundColor: colors.brand, borderRadius: 12, padding: 16, alignItems: 'center', marginTop: 20 },
  buttonDisabled: { opacity: 0.4 },
  buttonText: { color: '#fff', fontSize: 16, fontWeight: '700' },
  link: { color: colors.brand, textAlign: 'center', marginTop: 16 },
})
