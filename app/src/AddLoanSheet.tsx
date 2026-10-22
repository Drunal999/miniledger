import { useState } from 'react'
import { ActivityIndicator, Image, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native'
import DateTimePicker from '@react-native-community/datetimepicker'
import * as ImagePicker from 'expo-image-picker'
import { api, uploadReceipt, type Loan, type Photo } from './api'
import { formatINR, parsePaise } from './format'
import { colors } from './theme'

const toISODate = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
const inDays = (n: number) => new Date(Date.now() + n * 86_400_000)

/** "Sat, 21 Nov · in 30 days" instead of the raw "Sat Nov 21 2026". */
function friendlyDue(d: Date) {
  const start = new Date(); start.setHours(0, 0, 0, 0)
  const day = new Date(d); day.setHours(0, 0, 0, 0)
  const n = Math.round((day.getTime() - start.getTime()) / 86_400_000)
  const rel = n === 0 ? 'today' : n === 1 ? 'tomorrow' : n > 1 ? `in ${n} days` : `${-n} day${n === -1 ? '' : 's'} ago`
  return `${d.toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' })} · ${rel}`
}

const DUE_PRESETS: [string, number][] = [['1 week', 7], ['2 weeks', 14], ['1 month', 30]]

/** "1500.5" -> "₹1,500.50" while typing, or null if it isn't a valid amount yet. */
function previewAmount(a: string) {
  const paise = parsePaise(a)
  return paise ? formatINR(paise) : null
}

export function AddLoanSheet({ visible, token, recentFriends, onClose, onSaved }: {
  visible: boolean
  token: string
  recentFriends: string[]
  onClose: () => void
  onSaved: () => void
}) {
  const [name, setName] = useState('')
  const [amount, setAmount] = useState('')
  const [due, setDue] = useState(inDays(7))
  const [dueText, setDueText] = useState(toISODate(inDays(7)))
  const [showPicker, setShowPicker] = useState(false)
  const [photo, setPhoto] = useState<Photo | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const reset = () => {
    setName(''); setAmount(''); setDue(inDays(7)); setDueText(toISODate(inDays(7))); setPhoto(null); setError(null)
  }

  async function pick(fromCamera: boolean) {
    if (fromCamera && !(await ImagePicker.requestCameraPermissionsAsync()).granted) {
      setError('Camera permission is needed to take a photo')
      return
    }
    const opts: ImagePicker.ImagePickerOptions = { mediaTypes: ['images'], quality: 0.6 }
    const r = fromCamera ? await ImagePicker.launchCameraAsync(opts) : await ImagePicker.launchImageLibraryAsync(opts)
    if (!r.canceled) setPhoto(r.assets[0])
  }

  async function save() {
    setBusy(true)
    setError(null)
    try {
      const dueDate = Platform.OS === 'web' ? dueText : toISODate(due)
      const { loan } = await api<{ loan: Loan }>(
        '/loans',
        { method: 'POST', body: JSON.stringify({ friendName: name, amount: amount.trim(), dueDate }) },
        token,
      )
      if (photo) await uploadReceipt(loan.id, photo, token)
      reset()
      onSaved()
    } catch (e) {
      setError((e as Error).message) // the server's Zod message, e.g. "Amount must be more than 0..."
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <ScrollView contentContainerStyle={styles.sheet} keyboardShouldPersistTaps="handled">
        <View style={styles.header}>
          <Text style={styles.title}>New loan</Text>
          <Pressable onPress={() => { reset(); onClose() }} hitSlop={12}><Text style={styles.cancel}>Cancel</Text></Pressable>
        </View>

        <Text style={styles.label}>Friend's name</Text>
        <TextInput style={styles.input} value={name} onChangeText={setName} placeholder="Asha" maxLength={80} autoFocus accessibilityLabel="Friend's name" />
        {recentFriends.length > 0 && (
          <View style={styles.chips}>
            {recentFriends.slice(0, 5).map((f) => (
              <Pressable key={f} style={[styles.chip, name === f && styles.chipActive]} onPress={() => setName(f)} accessibilityRole="button" accessibilityLabel={`Use ${f}`}>
                <Text style={[styles.chipText, name === f && styles.chipTextActive]}>{f}</Text>
              </Pressable>
            ))}
          </View>
        )}

        <Text style={styles.label}>Amount</Text>
        <View style={styles.amountRow}>
          <Text style={styles.rupee}>₹</Text>
          <TextInput style={styles.amountInput} value={amount} onChangeText={(t) => setAmount(t.replace(/[^\d.]/g, ''))} placeholder="1500" keyboardType="decimal-pad" accessibilityLabel="Amount in rupees" />
        </View>
        {previewAmount(amount) && <Text style={styles.preview}>{previewAmount(amount)}</Text>}

        <Text style={styles.label}>Due date</Text>
        <View style={styles.chips}>
          {DUE_PRESETS.map(([label, days]) => (
            <Pressable
              key={label}
              style={styles.chip}
              onPress={() => { setDue(inDays(days)); setDueText(toISODate(inDays(days))) }}
              accessibilityRole="button"
              accessibilityLabel={`Due in ${label}`}
            >
              <Text style={styles.chipText}>{label}</Text>
            </Pressable>
          ))}
        </View>
        {Platform.OS === 'web' ? (
          <TextInput style={styles.input} value={dueText} onChangeText={setDueText} placeholder="YYYY-MM-DD" />
        ) : (
          <>
            <Pressable style={styles.input} onPress={() => setShowPicker(true)}>
              <Text style={styles.inputText}>{friendlyDue(due)}</Text>
            </Pressable>
            {showPicker && (
              <DateTimePicker
                value={due}
                mode="date"
                onChange={(_, d) => { setShowPicker(Platform.OS === 'ios'); if (d) setDue(d) }}
              />
            )}
          </>
        )}

        <Text style={styles.label}>Receipt photo (optional)</Text>
        {photo ? (
          <View style={styles.photoRow}>
            <Image source={{ uri: photo.uri }} style={styles.thumb} />
            <Pressable onPress={() => setPhoto(null)}><Text style={styles.cancel}>Remove</Text></Pressable>
          </View>
        ) : (
          <View style={styles.photoRow}>
            {Platform.OS !== 'web' && (
              <Pressable style={styles.secondary} onPress={() => pick(true)}><Text style={styles.secondaryText}>Take photo</Text></Pressable>
            )}
            <Pressable style={styles.secondary} onPress={() => pick(false)}><Text style={styles.secondaryText}>Choose photo</Text></Pressable>
          </View>
        )}

        {error && <Text style={styles.error}>{error}</Text>}

        <Pressable style={({ pressed }) => [styles.button, busy && { opacity: 0.5 }, pressed && { opacity: 0.7 }]} disabled={busy} onPress={save} accessibilityRole="button" accessibilityLabel="Save loan">
          {busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.buttonText}>Save loan</Text>}
        </Pressable>
      </ScrollView>
    </Modal>
  )
}

const styles = StyleSheet.create({
  sheet: { padding: 24, backgroundColor: colors.bg, flexGrow: 1 },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 },
  title: { fontSize: 24, fontWeight: '800', color: colors.ink },
  cancel: { color: colors.brand, fontSize: 16 },
  label: { fontSize: 14, fontWeight: '600', color: colors.ink, marginTop: 16, marginBottom: 6 },
  input: { borderWidth: 1, borderColor: colors.line, borderRadius: 12, padding: 14, fontSize: 16, backgroundColor: '#fff', letterSpacing: 0 },
  inputText: { fontSize: 16, color: colors.ink },
  amountRow: { flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderColor: colors.line, borderRadius: 12, backgroundColor: '#fff' },
  rupee: { paddingLeft: 14, fontSize: 20, fontWeight: '700', color: colors.muted },
  amountInput: { flex: 1, padding: 14, fontSize: 20, fontWeight: '700', letterSpacing: 0 },
  preview: { color: colors.muted, marginTop: 6 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 8, marginBottom: 4 },
  chip: { paddingVertical: 6, paddingHorizontal: 12, borderRadius: 16, backgroundColor: '#fff', borderWidth: 1, borderColor: colors.line },
  chipActive: { backgroundColor: colors.brand, borderColor: colors.brand },
  chipText: { color: colors.ink, fontSize: 13, fontWeight: '600' },
  chipTextActive: { color: '#fff' },
  photoRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  thumb: { width: 64, height: 64, borderRadius: 8 },
  secondary: { borderWidth: 1, borderColor: colors.brand, borderRadius: 10, paddingVertical: 10, paddingHorizontal: 14 },
  secondaryText: { color: colors.brand, fontWeight: '600' },
  error: { color: colors.danger, marginTop: 16 },
  button: { backgroundColor: colors.brand, borderRadius: 12, padding: 16, alignItems: 'center', marginTop: 24 },
  buttonText: { color: '#fff', fontSize: 16, fontWeight: '700' },
})
