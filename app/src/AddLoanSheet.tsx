import { useState } from 'react'
import { ActivityIndicator, Image, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native'
import DateTimePicker from '@react-native-community/datetimepicker'
import * as ImagePicker from 'expo-image-picker'
import { api, type Loan } from './api'
import { colors } from './theme'

type Photo = { uri: string; mimeType?: string; fileName?: string | null }

const toISODate = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
const inDays = (n: number) => new Date(Date.now() + n * 86_400_000)

/** Uploads the photo as multipart form data. Native takes {uri,name,type}; web needs a real Blob. */
async function uploadReceipt(loanId: number, photo: Photo, token: string) {
  const form = new FormData()
  const type = photo.mimeType ?? 'image/jpeg'
  if (Platform.OS === 'web') {
    form.append('receipt', await (await fetch(photo.uri)).blob(), photo.fileName ?? 'receipt.jpg')
  } else {
    form.append('receipt', { uri: photo.uri, name: photo.fileName ?? 'receipt.jpg', type } as unknown as Blob)
  }
  return api<{ loan: Loan }>(`/loans/${loanId}/receipt`, { method: 'POST', body: form }, token)
}

export function AddLoanSheet({ visible, token, onClose, onSaved }: {
  visible: boolean
  token: string
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
        <TextInput style={styles.input} value={name} onChangeText={setName} placeholder="Asha" maxLength={80} autoFocus />

        <Text style={styles.label}>Amount (₹)</Text>
        <TextInput style={styles.input} value={amount} onChangeText={setAmount} placeholder="1500" keyboardType="decimal-pad" />

        <Text style={styles.label}>Due date</Text>
        {Platform.OS === 'web' ? (
          <TextInput style={styles.input} value={dueText} onChangeText={setDueText} placeholder="YYYY-MM-DD" />
        ) : (
          <>
            <Pressable style={styles.input} onPress={() => setShowPicker(true)}>
              <Text style={styles.inputText}>{due.toDateString()}</Text>
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

        <Pressable style={[styles.button, busy && { opacity: 0.5 }]} disabled={busy} onPress={save}>
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
  input: { borderWidth: 1, borderColor: colors.line, borderRadius: 12, padding: 14, fontSize: 16, backgroundColor: '#fff' },
  inputText: { fontSize: 16, color: colors.ink },
  photoRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  thumb: { width: 64, height: 64, borderRadius: 8 },
  secondary: { borderWidth: 1, borderColor: colors.brand, borderRadius: 10, paddingVertical: 10, paddingHorizontal: 14 },
  secondaryText: { color: colors.brand, fontWeight: '600' },
  error: { color: colors.danger, marginTop: 16 },
  button: { backgroundColor: colors.brand, borderRadius: 12, padding: 16, alignItems: 'center', marginTop: 24 },
  buttonText: { color: '#fff', fontSize: 16, fontWeight: '700' },
})
