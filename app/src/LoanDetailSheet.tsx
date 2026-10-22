import { useCallback, useEffect, useState } from 'react'
import { ActivityIndicator, Alert, Image, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native'
import * as Haptics from 'expo-haptics'
import * as ImagePicker from 'expo-image-picker'
import { api, API_URL, uploadReceipt, type Loan, type Payment } from './api'
import { formatINR, parsePaise, pendingOf, prettyDate, prettyDateTime, statusPill } from './format'
import { colors, money } from './theme'
import { Avatar, Button, Pill, ProgressBar } from './ui'

const toInput = (p: number) => (p % 100 ? (p / 100).toFixed(2) : String(p / 100))
const buzz = () => { if (Platform.OS !== 'web') Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success) }

/** Native confirm dialog on phones; the browser's confirm() on web, where Alert buttons don't exist. */
export function confirmAsync(title: string, message: string, action: string) {
  if (Platform.OS === 'web') return Promise.resolve(window.confirm(`${title}\n\n${message}`))
  return new Promise<boolean>((resolve) =>
    Alert.alert(title, message, [
      { text: 'Cancel', style: 'cancel', onPress: () => resolve(false) },
      { text: action, style: 'destructive', onPress: () => resolve(true) },
    ]),
  )
}

export function LoanDetailSheet({ loanId, token, today, offline, onClose, onChanged, onRemind }: {
  loanId: number | null
  token: string
  today: string
  offline: boolean
  onClose: () => void
  onChanged: () => void
  onRemind: (loan: Loan) => void
}) {
  const [loan, setLoan] = useState<Loan | null>(null)
  const [payments, setPayments] = useState<Payment[]>([])
  const [amount, setAmount] = useState('')
  const [busy, setBusy] = useState<string | null>(null) // which action is running
  const [error, setError] = useState<string | null>(null)
  const [showReceipt, setShowReceipt] = useState(false)

  const load = useCallback(async () => {
    if (loanId === null) return
    try {
      const r = await api<{ loan: Loan; payments: Payment[] }>(`/loans/${loanId}`, {}, token)
      setLoan(r.loan)
      setPayments(r.payments)
    } catch (e) {
      setError((e as Error).message)
    }
  }, [loanId, token])

  useEffect(() => {
    setLoan(null); setPayments([]); setAmount(''); setError(null); setShowReceipt(false)
    load()
  }, [load])

  async function run(name: string, fn: () => Promise<unknown>) {
    setBusy(name)
    setError(null)
    try {
      await fn()
      await load()
      onChanged()
    } catch (e) {
      setError((e as Error).message) // e.g. "That's more than the ₹500.00 still pending"
    } finally {
      setBusy(null)
    }
  }

  const recordPayment = () =>
    run('pay', async () => {
      await api(`/loans/${loanId}/payments`, { method: 'POST', body: JSON.stringify({ amount: amount.trim() }) }, token)
      setAmount('')
      buzz()
    })
  const repayAll = () => run('repay', async () => { await api(`/loans/${loanId}/repay`, { method: 'PATCH' }, token); buzz() })
  const undoLast = () => run('undo', () => api(`/loans/${loanId}/payments/last`, { method: 'DELETE' }, token))

  async function addReceipt() {
    const r = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.6 })
    if (!r.canceled) await run('receipt', () => uploadReceipt(loanId!, r.assets[0], token))
  }

  async function remove() {
    if (!loan) return
    const ok = await confirmAsync('Delete this loan?', `${loan.friendName}, ${formatINR(loan.amountPaise)}. Its payment history goes too. This can't be undone.`, 'Delete')
    if (!ok) return
    await run('delete', () => api(`/loans/${loanId}`, { method: 'DELETE' }, token))
    onClose()
  }

  const pending = loan ? pendingOf(loan) : 0
  const typed = parsePaise(amount)
  const pill = loan ? statusPill(loan, today) : null

  return (
    <Modal visible={loanId !== null} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <ScrollView style={{ backgroundColor: colors.bg }} contentContainerStyle={styles.sheet} keyboardShouldPersistTaps="handled">
        <View style={styles.header}>
          <Text style={styles.title}>Loan details</Text>
          <Pressable onPress={onClose} hitSlop={12} accessibilityRole="button" accessibilityLabel="Close">
            <Text style={styles.close}>Done</Text>
          </Pressable>
        </View>

        {!loan ? (
          error ? <Text style={styles.error}>{error}</Text> : <ActivityIndicator style={{ marginTop: 40 }} color={colors.brand} />
        ) : (
          <>
            <View style={styles.hero}>
              <Avatar name={loan.friendName} size={56} />
              <Text style={styles.friend}>{loan.friendName}</Text>
              {pill && <Pill text={pill.text} tone={pill.tone} />}
              <Text style={[styles.big, money, loan.status === 'overdue' && { color: colors.danger }]}>
                {loan.status === 'repaid' ? formatINR(loan.amountPaise) : formatINR(pending)}
              </Text>
              <Text style={styles.bigLabel}>
                {loan.status === 'repaid' ? 'Fully repaid' : loan.paidPaise > 0 ? `still pending · ${formatINR(loan.paidPaise)} received of ${formatINR(loan.amountPaise)}` : 'still pending'}
              </Text>
              <View style={{ alignSelf: 'stretch', marginTop: 14 }}>
                <ProgressBar share={loan.paidPaise / loan.amountPaise} />
              </View>
            </View>

            <View style={styles.card}>
              <Info label="Lent on" value={prettyDate(loan.createdAt)} />
              <Info label="Due on" value={prettyDate(loan.dueDate)} />
              <View style={styles.infoRow}>
                <Text style={styles.infoLabel}>Receipt</Text>
                {loan.hasReceipt ? (
                  <Pressable onPress={() => setShowReceipt((v) => !v)} accessibilityRole="button">
                    <Text style={styles.link}>{showReceipt ? 'Hide' : 'View'}</Text>
                  </Pressable>
                ) : (
                  <Pressable onPress={addReceipt} disabled={offline || busy !== null} accessibilityRole="button">
                    <Text style={styles.link}>{busy === 'receipt' ? 'Uploading…' : '+ Add photo'}</Text>
                  </Pressable>
                )}
              </View>
              {showReceipt && (
                <Image
                  source={{ uri: `${API_URL}/loans/${loan.id}/receipt`, headers: { Authorization: `Bearer ${token}` } }}
                  style={styles.receipt}
                  resizeMode="contain"
                  accessibilityLabel="Receipt photo"
                />
              )}
            </View>

            {loan.status !== 'repaid' && (
              <View style={styles.card}>
                <Text style={styles.cardTitle}>Got some money back?</Text>
                <View style={styles.amountRow}>
                  <Text style={styles.rupee}>₹</Text>
                  <TextInput
                    style={[styles.amountInput, money]}
                    value={amount}
                    onChangeText={(t) => setAmount(t.replace(/[^\d.]/g, ''))}
                    placeholder="Amount received"
                    keyboardType="decimal-pad"
                    accessibilityLabel="Amount received"
                  />
                </View>
                <View style={styles.chips}>
                  {pending >= 2 && <Chip label={`Half · ${formatINR(Math.floor(pending / 2))}`} onPress={() => setAmount(toInput(Math.floor(pending / 2)))} />}
                  <Chip label={`All · ${formatINR(pending)}`} onPress={() => setAmount(toInput(pending))} />
                </View>
                {typed !== null && typed > pending && <Text style={styles.warn}>That's more than the {formatINR(pending)} pending.</Text>}
                <Button
                  label={typed ? `Record ${formatINR(typed)}` : 'Record payment'}
                  onPress={recordPayment}
                  disabled={offline || !typed || typed > pending}
                  busy={busy === 'pay'}
                  style={{ marginTop: 12 }}
                />
                <Button label="Mark fully repaid" kind="ok" onPress={repayAll} disabled={offline} busy={busy === 'repay'} style={{ marginTop: 8 }} />
              </View>
            )}

            <View style={styles.card}>
              <Text style={styles.cardTitle}>Payments</Text>
              {payments.length === 0 ? (
                <Text style={styles.muted}>Nothing received yet.</Text>
              ) : (
                payments.map((p, i) => (
                  <View key={p.id} style={styles.payment}>
                    <View style={styles.dot} />
                    <View style={{ flex: 1 }}>
                      <Text style={[styles.payAmount, money]}>{formatINR(p.amountPaise)} received</Text>
                      <Text style={styles.payDate}>{prettyDateTime(p.paidAt)}</Text>
                    </View>
                    {i === 0 && (
                      <Pressable onPress={undoLast} disabled={offline || busy !== null} accessibilityRole="button" accessibilityLabel="Undo this payment">
                        <Text style={styles.link}>{busy === 'undo' ? 'Undoing…' : 'Undo'}</Text>
                      </Pressable>
                    )}
                  </View>
                ))
              )}
            </View>

            {error && <Text style={styles.error} accessibilityLiveRegion="polite">{error}</Text>}

            {loan.status !== 'repaid' && (
              <Button label="Remind on WhatsApp" kind="whatsapp" onPress={() => onRemind(loan)} style={{ marginTop: 4 }} />
            )}
            <Button label="Delete loan" kind="danger" onPress={remove} disabled={offline} busy={busy === 'delete'} style={{ marginTop: 10 }} />
          </>
        )}
      </ScrollView>
    </Modal>
  )
}

const Info = ({ label, value }: { label: string; value: string }) => (
  <View style={styles.infoRow}>
    <Text style={styles.infoLabel}>{label}</Text>
    <Text style={styles.infoValue}>{value}</Text>
  </View>
)

const Chip = ({ label, onPress }: { label: string; onPress: () => void }) => (
  <Pressable onPress={onPress} style={({ pressed }) => [styles.chip, pressed && { opacity: 0.6 }]} accessibilityRole="button" accessibilityLabel={label}>
    <Text style={[styles.chipText, money]}>{label}</Text>
  </Pressable>
)

const styles = StyleSheet.create({
  sheet: { padding: 20, paddingBottom: 48 },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 },
  title: { fontSize: 17, fontWeight: '700', color: colors.muted },
  close: { color: colors.brand, fontSize: 16, fontWeight: '700' },
  hero: { alignItems: 'center', backgroundColor: colors.card, borderRadius: 20, padding: 20, borderWidth: 1, borderColor: colors.line, gap: 6 },
  friend: { fontSize: 20, fontWeight: '800', color: colors.ink, marginTop: 4 },
  big: { fontSize: 36, fontWeight: '800', color: colors.ink, marginTop: 6 },
  bigLabel: { color: colors.muted, textAlign: 'center' },
  card: { backgroundColor: colors.card, borderRadius: 16, padding: 16, borderWidth: 1, borderColor: colors.line, marginTop: 12 },
  cardTitle: { fontSize: 15, fontWeight: '700', color: colors.ink, marginBottom: 10 },
  infoRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 8 },
  infoLabel: { color: colors.muted },
  infoValue: { color: colors.ink, fontWeight: '600' },
  link: { color: colors.brand, fontWeight: '700' },
  receipt: { width: '100%', height: 260, borderRadius: 12, marginTop: 8, backgroundColor: '#F3F4F6' },
  amountRow: { flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderColor: colors.line, borderRadius: 12, backgroundColor: '#fff' },
  rupee: { paddingLeft: 14, fontSize: 20, fontWeight: '700', color: colors.muted },
  amountInput: { flex: 1, padding: 14, fontSize: 20, fontWeight: '700', letterSpacing: 0 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 10 },
  chip: { paddingVertical: 6, paddingHorizontal: 12, borderRadius: 16, backgroundColor: colors.brandSoft },
  chipText: { color: colors.brand, fontWeight: '700', fontSize: 13 },
  warn: { color: colors.danger, marginTop: 8 },
  muted: { color: colors.muted },
  payment: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 8 },
  dot: { width: 10, height: 10, borderRadius: 5, backgroundColor: colors.ok },
  payAmount: { fontWeight: '700', color: colors.ink },
  payDate: { color: colors.muted, fontSize: 12, marginTop: 2 },
  error: { color: colors.danger, marginTop: 12, textAlign: 'center' },
})
