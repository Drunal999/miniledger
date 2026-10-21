import { useCallback, useEffect, useState } from 'react'
import { ActivityIndicator, FlatList, Image, Modal, Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native'
import { useNetInfo } from '@react-native-community/netinfo'
import { api, API_URL, ApiError, formatINR, type Loan, type Summary } from './api'
import { AddLoanSheet } from './AddLoanSheet'
import { colors } from './theme'

const daysBetween = (from: string, to: string) => Math.round((Date.parse(to) - Date.parse(from)) / 86_400_000)
const prettyDate = (iso: string) =>
  new Date(`${iso}T00:00:00`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })

export function HomeScreen({ token, onLogout }: { token: string; onLogout: () => void }) {
  const [loans, setLoans] = useState<Loan[] | null>(null)
  const [today, setToday] = useState('')
  const [summary, setSummary] = useState<Summary | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [refreshing, setRefreshing] = useState(false)
  const [adding, setAdding] = useState(false)
  const [receiptFor, setReceiptFor] = useState<number | null>(null)
  const { isConnected } = useNetInfo()
  const offline = isConnected === false

  const load = useCallback(async () => {
    try {
      const [l, s] = await Promise.all([
        api<{ today: string; loans: Loan[] }>('/loans', {}, token),
        api<Summary>('/loans/summary', {}, token),
      ])
      setLoans(l.loans)
      setToday(l.today)
      setSummary(s)
      setError(null)
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) return onLogout() // token expired
      setError((e as Error).message) // keep showing the last data we had
    }
  }, [token, onLogout])

  useEffect(() => { load() }, [load])

  const refresh = async () => {
    setRefreshing(true)
    await load()
    setRefreshing(false)
  }

  // Optimistic: show "repaid" instantly, roll back if the server says no.
  async function markRepaid(id: number) {
    const before = loans
    setLoans((ls) => ls?.map((l) => (l.id === id ? { ...l, status: 'repaid', repaidAt: new Date().toISOString() } : l)) ?? null)
    try {
      await api(`/loans/${id}/repay`, { method: 'PATCH' }, token)
      await load()
    } catch (e) {
      setLoans(before)
      setError((e as Error).message)
    }
  }

  if (!loans && !error) {
    return <View style={styles.center}><ActivityIndicator size="large" color={colors.brand} /></View>
  }

  return (
    <View style={styles.screen}>
      {offline && <Text style={styles.offline}>You're offline. Showing the last saved list.</Text>}

      <FlatList
        data={loans ?? []}
        keyExtractor={(l) => String(l.id)}
        contentContainerStyle={{ padding: 16, paddingBottom: 120 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} />}
        ListHeaderComponent={
          <>
            <View style={styles.topBar}>
              <Text style={styles.brand}>MiniLedger</Text>
              <Pressable onPress={onLogout} hitSlop={12}><Text style={styles.link}>Log out</Text></Pressable>
            </View>
            {summary && <SummaryCard s={summary} />}
            {error && (
              <Pressable style={styles.errorBox} onPress={refresh}>
                <Text style={styles.errorText}>{error} Tap to retry.</Text>
              </Pressable>
            )}
            <Text style={styles.section}>Loans</Text>
          </>
        }
        ListEmptyComponent={
          <View style={styles.empty}>
            <Text style={styles.emptyTitle}>No loans yet</Text>
            <Text style={styles.muted}>Tap "+ Add loan" to record money you lent a friend.</Text>
          </View>
        }
        renderItem={({ item }) => (
          <LoanRow
            loan={item}
            today={today}
            disabled={offline}
            onRepay={() => markRepaid(item.id)}
            onReceipt={() => setReceiptFor(item.id)}
          />
        )}
      />

      <Pressable style={[styles.fab, offline && { opacity: 0.4 }]} disabled={offline} onPress={() => setAdding(true)}>
        <Text style={styles.fabText}>+ Add loan</Text>
      </Pressable>

      <AddLoanSheet visible={adding} token={token} onClose={() => setAdding(false)} onSaved={() => { setAdding(false); load() }} />

      <Modal visible={receiptFor !== null} transparent animationType="fade" onRequestClose={() => setReceiptFor(null)}>
        <Pressable style={styles.viewer} onPress={() => setReceiptFor(null)}>
          {receiptFor !== null && (
            <Image
              source={{ uri: `${API_URL}/loans/${receiptFor}/receipt`, headers: { Authorization: `Bearer ${token}` } }}
              style={styles.receipt}
              resizeMode="contain"
            />
          )}
          <Text style={styles.viewerHint}>Tap anywhere to close</Text>
        </Pressable>
      </Modal>
    </View>
  )
}

function SummaryCard({ s }: { s: Summary }) {
  const outstanding = s.totalLentPaise - s.totalRepaidPaise
  return (
    <View style={styles.card}>
      <Text style={styles.cardLabel}>Still to get back</Text>
      <Text style={styles.cardBig}>{formatINR(outstanding)}</Text>
      <View style={styles.cardRow}>
        <Stat label="Total lent" value={formatINR(s.totalLentPaise)} />
        <Stat label="Repaid" value={formatINR(s.totalRepaidPaise)} />
        <Stat label={`Overdue${s.overdueCount ? ` (${s.overdueCount})` : ''}`} value={formatINR(s.overduePaise)} danger={s.overduePaise > 0} />
      </View>
    </View>
  )
}

const Stat = ({ label, value, danger }: { label: string; value: string; danger?: boolean }) => (
  <View style={{ flex: 1 }}>
    <Text style={styles.statLabel}>{label}</Text>
    <Text style={[styles.statValue, danger && { color: '#FCA5A5' }]}>{value}</Text>
  </View>
)

function LoanRow({ loan, today, disabled, onRepay, onReceipt }: {
  loan: Loan
  today: string
  disabled: boolean
  onRepay: () => void
  onReceipt: () => void
}) {
  const overdue = loan.status === 'overdue'
  const repaid = loan.status === 'repaid'
  const late = overdue ? daysBetween(loan.dueDate, today) : 0
  const sub = repaid
    ? 'Repaid'
    : overdue
      ? `Overdue by ${late} day${late === 1 ? '' : 's'} · was due ${prettyDate(loan.dueDate)}`
      : loan.dueDate === today ? 'Due today' : `Due ${prettyDate(loan.dueDate)}`

  return (
    <View style={[styles.row, overdue && styles.rowOverdue, repaid && styles.rowRepaid]}>
      <View style={{ flex: 1 }}>
        <Text style={[styles.name, repaid && styles.strike]}>{loan.friendName}</Text>
        <Text style={[styles.sub, overdue && { color: colors.danger, fontWeight: '600' }, repaid && { color: colors.ok }]}>{sub}</Text>
        {loan.hasReceipt && <Pressable onPress={onReceipt}><Text style={styles.link}>View receipt</Text></Pressable>}
      </View>
      <View style={{ alignItems: 'flex-end', gap: 8 }}>
        <Text style={[styles.amount, overdue && { color: colors.danger }]}>{formatINR(loan.amountPaise)}</Text>
        {!repaid && (
          <Pressable style={[styles.repay, disabled && { opacity: 0.4 }]} disabled={disabled} onPress={onRepay}>
            <Text style={styles.repayText}>Mark repaid</Text>
          </Pressable>
        )}
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.bg },
  offline: { backgroundColor: '#FEF3C7', color: '#92400E', padding: 10, textAlign: 'center' },
  topBar: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16, marginTop: 8 },
  brand: { fontSize: 24, fontWeight: '800', color: colors.ink },
  link: { color: colors.brand, marginTop: 4 },
  card: { backgroundColor: colors.ink, borderRadius: 20, padding: 20 },
  cardLabel: { color: '#9CA3AF', fontSize: 13 },
  cardBig: { color: '#fff', fontSize: 34, fontWeight: '800', marginVertical: 6 },
  cardRow: { flexDirection: 'row', marginTop: 12, gap: 8 },
  statLabel: { color: '#9CA3AF', fontSize: 12 },
  statValue: { color: '#fff', fontSize: 15, fontWeight: '700', marginTop: 2 },
  errorBox: { backgroundColor: colors.dangerBg, borderRadius: 12, padding: 12, marginTop: 12 },
  errorText: { color: colors.danger },
  section: { fontSize: 16, fontWeight: '700', color: colors.ink, marginTop: 24, marginBottom: 8 },
  empty: { alignItems: 'center', padding: 32 },
  emptyTitle: { fontSize: 18, fontWeight: '700', color: colors.ink, marginBottom: 4 },
  muted: { color: colors.muted, textAlign: 'center' },
  row: { flexDirection: 'row', backgroundColor: '#fff', borderRadius: 14, padding: 14, marginBottom: 10, borderWidth: 1, borderColor: colors.line },
  rowOverdue: { backgroundColor: colors.dangerBg, borderColor: '#FECACA', borderLeftWidth: 4, borderLeftColor: colors.danger },
  rowRepaid: { opacity: 0.6 },
  name: { fontSize: 16, fontWeight: '700', color: colors.ink },
  strike: { textDecorationLine: 'line-through' },
  sub: { fontSize: 13, color: colors.muted, marginTop: 2 },
  amount: { fontSize: 17, fontWeight: '800', color: colors.ink },
  repay: { backgroundColor: colors.ok, borderRadius: 8, paddingVertical: 6, paddingHorizontal: 10 },
  repayText: { color: '#fff', fontWeight: '700', fontSize: 12 },
  fab: { position: 'absolute', bottom: 32, alignSelf: 'center', backgroundColor: colors.brand, borderRadius: 28, paddingVertical: 16, paddingHorizontal: 28, elevation: 4 },
  fabText: { color: '#fff', fontWeight: '800', fontSize: 16 },
  viewer: { flex: 1, backgroundColor: 'rgba(0,0,0,0.9)', justifyContent: 'center', alignItems: 'center' },
  receipt: { width: '90%', height: '75%' },
  viewerHint: { color: '#fff', marginTop: 12 },
})
