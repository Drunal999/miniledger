import { useEffect, useState } from 'react'
import { Modal, Platform, Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, View } from 'react-native'
import * as LocalAuthentication from 'expo-local-authentication'
import { api, LOCK_KEY, secure, type Profile } from './api'
import { colors } from './theme'
import { Avatar, Button } from './ui'

/** Your number, UPI ID (used in reminders), the Face ID lock, and log out. */
export function ProfileSheet({ visible, token, onClose, onLogout, onProfile }: {
  visible: boolean
  token: string
  onClose: () => void
  onLogout: () => void
  onProfile: (p: Profile) => void
}) {
  const [profile, setProfile] = useState<Profile | null>(null)
  const [upi, setUpi] = useState('')
  const [lock, setLock] = useState(false)
  const [canLock, setCanLock] = useState(false)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<{ text: string; ok: boolean } | null>(null)

  useEffect(() => {
    if (!visible) return
    setMsg(null)
    api<Profile>('/me', {}, token).then((p) => { setProfile(p); setUpi(p.upiId ?? '') }).catch((e) => setMsg({ text: e.message, ok: false }))
    secure.get(LOCK_KEY).then((v) => setLock(v === '1'))
    if (Platform.OS !== 'web') {
      Promise.all([LocalAuthentication.hasHardwareAsync(), LocalAuthentication.isEnrolledAsync()]).then(([hw, enrolled]) => setCanLock(hw && enrolled))
    }
  }, [visible, token])

  async function saveUpi() {
    setBusy(true)
    setMsg(null)
    try {
      const p = await api<Profile>('/me', { method: 'PATCH', body: JSON.stringify({ upiId: upi }) }, token)
      setProfile(p)
      onProfile(p)
      setMsg({ text: p.upiId ? 'Saved. Reminders will include your UPI ID.' : 'UPI ID removed.', ok: true })
    } catch (e) {
      setMsg({ text: (e as Error).message, ok: false })
    } finally {
      setBusy(false)
    }
  }

  // Turning the lock on asks for Face ID once, so you can't lock yourself out by accident.
  async function toggleLock(on: boolean) {
    if (on) {
      const r = await LocalAuthentication.authenticateAsync({ promptMessage: 'Turn on Face ID lock' })
      if (!r.success) return
      await secure.set(LOCK_KEY, '1')
    } else {
      await secure.del(LOCK_KEY)
    }
    setLock(on)
  }

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <ScrollView style={{ backgroundColor: colors.bg }} contentContainerStyle={styles.sheet} keyboardShouldPersistTaps="handled">
        <View style={styles.header}>
          <Text style={styles.title}>Profile</Text>
          <Pressable onPress={onClose} hitSlop={12} accessibilityRole="button" accessibilityLabel="Close">
            <Text style={styles.close}>Done</Text>
          </Pressable>
        </View>

        <View style={styles.hero}>
          <Avatar name="Me" size={56} />
          <Text style={styles.phone}>{profile?.phone ?? ' '}</Text>
        </View>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>Get paid faster</Text>
          <Text style={styles.help}>Add your UPI ID and every WhatsApp reminder will tell your friend exactly where to pay.</Text>
          <TextInput
            style={styles.input}
            value={upi}
            onChangeText={setUpi}
            placeholder="yourname@okaxis"
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="email-address"
            accessibilityLabel="Your UPI ID"
          />
          {msg && <Text style={[styles.msg, { color: msg.ok ? colors.ok : colors.danger }]}>{msg.text}</Text>}
          <Button label="Save UPI ID" onPress={saveUpi} busy={busy} disabled={upi === (profile?.upiId ?? '')} style={{ marginTop: 12 }} />
        </View>

        {Platform.OS !== 'web' && (
          <View style={styles.card}>
            <View style={styles.switchRow}>
              <View style={{ flex: 1 }}>
                <Text style={styles.cardTitle}>Face ID lock</Text>
                <Text style={styles.help}>
                  {canLock ? 'Ask for Face ID or your passcode when you open the app.' : 'Set up Face ID or a passcode on your phone to use this.'}
                </Text>
              </View>
              <Switch value={lock} onValueChange={toggleLock} disabled={!canLock} accessibilityLabel="Face ID lock" />
            </View>
          </View>
        )}

        <Button label="Log out" kind="danger" onPress={onLogout} style={{ marginTop: 20 }} />
      </ScrollView>
    </Modal>
  )
}

const styles = StyleSheet.create({
  sheet: { padding: 20, paddingBottom: 48 },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 },
  title: { fontSize: 17, fontWeight: '700', color: colors.muted },
  close: { color: colors.brand, fontSize: 16, fontWeight: '700' },
  hero: { alignItems: 'center', gap: 8, marginVertical: 12 },
  phone: { fontSize: 18, fontWeight: '700', color: colors.ink },
  card: { backgroundColor: colors.card, borderRadius: 16, padding: 16, borderWidth: 1, borderColor: colors.line, marginTop: 12 },
  cardTitle: { fontSize: 15, fontWeight: '700', color: colors.ink, marginBottom: 4 },
  help: { color: colors.muted, fontSize: 13, lineHeight: 18 },
  input: { borderWidth: 1, borderColor: colors.line, borderRadius: 12, padding: 14, fontSize: 16, backgroundColor: '#fff', marginTop: 12 },
  msg: { marginTop: 8 },
  switchRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
})
