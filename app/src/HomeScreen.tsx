import { useCallback, useEffect, useState } from 'react'
import { ActivityIndicator, Alert, FlatList, Image, Linking, Modal, Platform, Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native'
import { useNetInfo } from '@react-native-community/netinfo'
import * as Haptics from 'expo-haptics'
import { api, API_URL, ApiError, formatINR, type Loan, type Summary } from './api'
import { AddLoanSheet } from './AddLoanSheet'
import { colors } from './theme'

const daysBetween = (from: string, to: string) => Math.round((Date.parse(to) - Date.parse(from)) / 86_400_000)
const prettyDate = (iso: string) =>
  new Date(`${iso}T00:00:00`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })

const DUE_SOON_DAYS = 3
type Filter = 'all' | 'overdue' | 'repaid'

// Same name -> same colour every time, so a friend is easy to spot in the list.
const AVATAR_COLORS = ['#6366F1', '#0EA5E9', '#14B8A6', '#F59E0B', '#EC4899', '#8B5CF6', '#10B981', '#F97316']
const avatarColor = (name: string) => AVATAR_COLORS[[...name].reduce((h, ch) => h + ch.charCodeAt(0), 0) % AVATAR_COLORS.length]
const initials = (name: string) => name.trim().split(/\s+/).slice(0, 2).map((w) => w[0]?.toUpperCase()).join('')

/** Opens WhatsApp with a polite reminder. The user picks the chat; we never need the friend's number. */
function remindOnWhatsApp(loan: Loan, today: string) {
  const when = loan.dueDate < today ? `was due on ${prettyDate(loan.dueDate)}` : `is due on ${prettyDate(loan.dueDate)}`
  const text = `Hi ${loan.friendName}, a gentle reminder about the ${formatINR(loan.amountPaise)} I lent you, which ${when}. Thanks!`
  Linking.openURL(`https://wa.me/?text=${encodeURIComponent(text)}`)
}

/** Native confirm dialog on phones; the browser's confirm() on web, where Alert buttons don't exist. */
function confirmAsync(title: string, message: string, action: string) {
  if (Platform.OS === 'web') return Promise.resolve(window.confirm(`${title}\n\n${message}`))
  return new Promise<boolean>((resolve) =>
    Alert.alert(title, message, [
      { text: 'Cancel', style: 'cancel', onPress: () => resolve(false) },
      { text: action, style: 'destructive', onPress: () => resolve(true) },
    ]),
  )
}

export function HomeScreen({ token, onLogout }: { token: string; onLogout: () => void }) {
  const [loans, setLoans] = useState<Loan[] | null>(null)
  const [today, setToday] = useState('')
  const [summary, setSummary] = useState<Summary | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [refreshing, setRefreshing] = useState(false)
  const [adding, setAdding] = useState(false)
  const [receiptFor, setReceiptFor] = useState<number | null>(null)
  const [filter, setFilter] = useState<Filter>('all')
  const [undo, setUndo] = useState<{ id: number; name: string } | null>(null)

  // The "Undo" bar disappears after 5 seconds.
  useEffect(() => {
    if (!undo) return
    const t = setTimeout(() => setUndo(null), 5000)
    return () => clearTimeout(t)
  }, [undo])
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
    if (Platform.OS !== 'web') Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)
    try {
      await api(`/loans/${id}/repay`, { method: 'PATCH' }, token)
      setUndo({ id, name: before?.find((l) => l.id === id)?.friendName ?? '' })
      await load()
    } catch (e) {
      setLoans(before)
      setError((e as Error).message)
    }
  }

  async function undoRepaid() {
    if (!undo) return
    const { id } = undo
    setUndo(null)
    try {
      await api(`/loans/${id}/unrepay`, { method: 'PATCH' }, token)
      await load()
    } catch (e) {
      setError((e as Error).message)
    }
  }

  async function deleteLoan(loan: Loan) {
    const ok = await confirmAsync('Delete this loan?', `${loan.friendName}, ${formatINR(loan.amountPaise)}. This can't be undone.`, 'Delete')
    if (!ok) return
    try {
      await api(`/loans/${loan.id}`, { method: 'DELETE' }, token)
      await load()
    } catch (e) {
      setError((e as Error).message)
    }
  }

  if (!loans && !error) {
    return <View style={styles.center}><ActivityIndicator size="large" color={colors.brand} /></View>
  }

  const counts = {
    all: loans?.length ?? 0,
    overdue: loans?.filter((l) => l.status === 'overdue').length ?? 0,
    repaid: loans?.filter((l) => l.status === 'repaid').length ?? 0,
  }
  const shown = (loans ?? []).filter((l) => filter === 'all' || l.status === filter)
  // Most recently added friends first, no duplicates: one tap to reuse a name.
  const recentFriends = [...new Set([...(loans ?? [])].sort((a, b) => b.id - a.id).map((l) => l.friendName))]

  return (
    <View style={styles.screen}>
      {offline && <Text style={styles.offline}>You're offline. Showing the last saved list.</Text>}

      <FlatList
        data={shown}
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
            <View style={styles.tabs}>
              {(['all', 'overdue', 'repaid'] as const).map((f) => (
                <Pressable key={f} style={[styles.tab, filter === f && styles.tabActive]} onPress={() => setFilter(f)}>
                  <Text style={[styles.tabText, filter === f && styles.tabTextActive]}>
                    {f[0].toUpperCase() + f.slice(1)} ({counts[f]})
                  </Text>
                </Pressable>
              ))}
            </View>
          </>
        }
        ListEmptyComponent={
          <View style={styles.empty}>
            <Text style={styles.emptyTitle}>{filter === 'all' ? 'No loans yet' : `No ${filter} loans`}</Text>
            <Text style={styles.muted}>
              {filter === 'all' ? 'Tap "+ Add loan" to record money you lent a friend.' : 'Nothing here right now.'}
            </Text>
          </View>
        }
        renderItem={({ item }) => (
          <LoanRow
            loan={item}
            today={today}
            disabled={offline}
            onRepay={() => markRepaid(item.id)}
            onRemind={() => remindOnWhatsApp(item, today)}
            onReceipt={() => setReceiptFor(item.id)}
            onDelete={() => deleteLoan(item)}
          />
        )}
        ListFooterComponent={(loans?.length ?? 0) > 0 ? <Text style={styles.footerHint}>Tip: press and hold a loan to delete it.</Text> : null}
      />

      {undo && (
        <View style={styles.toast} accessibilityLiveRegion="polite">
          <Text style={styles.toastText} numberOfLines={1}>Marked {undo.name}'s loan as repaid</Text>
          <Pressable onPress={undoRepaid} hitSlop={10} accessibilityRole="button" accessibilityLabel="Undo">
            <Text style={styles.toastUndo}>UNDO</Text>
          </Pressable>
        </View>
      )}

      {!undo && (
        <Pressable style={[styles.fab, offline && { opacity: 0.4 }]} disabled={offline} onPress={() => setAdding(true)} accessibilityRole="button" accessibilityLabel="Add loan">
          <Text style={styles.fabText}>+ Add loan</Text>
        </Pressable>
      )}

      <AddLoanSheet visible={adding} token={token} recentFriends={recentFriends} onClose={() => setAdding(false)} onSaved={() => { setAdding(false); load() }} />

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
  const repaidShare = s.totalLentPaise ? s.totalRepaidPaise / s.totalLentPaise : 0
  return (
    <View style={styles.card}>
      <Text style={styles.cardLabel}>Still to get back</Text>
      <Text style={styles.cardBig}>{formatINR(outstanding)}</Text>
      <View style={styles.bar}>
        <View style={[styles.barFill, { width: `${Math.round(repaidShare * 100)}%` }]} />
      </View>
      <Text style={styles.barLabel}>{Math.round(repaidShare * 100)}% repaid</Text>
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

function LoanRow({ loan, today, disabled, onRepay, onRemind, onReceipt, onDelete }: {
  loan: Loan
  today: string
  disabled: boolean
  onRepay: () => void
  onRemind: () => void
  onReceipt: () => void
  onDelete: () => void
}) {
  const overdue = loan.status === 'overdue'
  const repaid = loan.status === 'repaid'
  const daysLeft = daysBetween(today, loan.dueDate)
  const dueSoon = !repaid && !overdue && daysLeft <= DUE_SOON_DAYS
  const late = overdue ? -daysLeft : 0
  const sub = repaid
    ? 'Repaid'
    : overdue
      ? `Overdue by ${late} day${late === 1 ? '' : 's'} · was due ${prettyDate(loan.dueDate)}`
      : daysLeft === 0 ? 'Due today' : dueSoon ? `Due in ${daysLeft} day${daysLeft === 1 ? '' : 's'}` : `Due ${prettyDate(loan.dueDate)}`

  return (
    <Pressable
      onLongPress={disabled ? undefined : onDelete}
      delayLongPress={500}
      accessibilityLabel={`${loan.friendName}, ${formatINR(loan.amountPaise)}, ${sub}`}
      accessibilityHint="Press and hold to delete"
      style={[styles.row, overdue && styles.rowOverdue, dueSoon && styles.rowSoon, repaid && styles.rowRepaid]}
    >
      <View style={[styles.avatar, { backgroundColor: avatarColor(loan.friendName) }]}>
        <Text style={styles.avatarText}>{initials(loan.friendName)}</Text>
      </View>
      <View style={{ flex: 1 }}>
        <Text style={[styles.name, repaid && styles.strike]}>{loan.friendName}</Text>
        <Text style={[styles.sub, overdue && { color: colors.danger, fontWeight: '600' }, dueSoon && { color: colors.warn, fontWeight: '600' }, repaid && { color: colors.ok }]}>{sub}</Text>
        <View style={styles.actions}>
          {loan.hasReceipt && <Pressable onPress={onReceipt} hitSlop={8}><Text style={styles.link}>Receipt</Text></Pressable>}
          {!repaid && <Pressable onPress={onRemind} hitSlop={8}><Text style={styles.link}>Remind on WhatsApp</Text></Pressable>}
        </View>
      </View>
      <View style={{ alignItems: 'flex-end', gap: 8 }}>
        <Text style={[styles.amount, overdue && { color: colors.danger }]}>{formatINR(loan.amountPaise)}</Text>
        {!repaid && (
          <Pressable style={[styles.repay, disabled && { opacity: 0.4 }]} disabled={disabled} onPress={onRepay} accessibilityRole="button" accessibilityLabel={`Mark ${loan.friendName}'s loan as repaid`}>
            <Text style={styles.repayText}>Mark repaid</Text>
          </Pressable>
        )}
      </View>
    </Pressable>
  )
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.bg },
  offline: { backgroundColor: '#FEF3C7', color: '#92400E', padding: 10, textAlign: 'center' },
  topBar: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16, marginTop: 8 },
  brand: { fontSize: 24, fontWeight: '800', color: colors.ink },
  link: { color: colors.brand, fontWeight: '600', fontSize: 13 },
  card: { backgroundColor: colors.ink, borderRadius: 20, padding: 20 },
  cardLabel: { color: '#9CA3AF', fontSize: 13 },
  cardBig: { color: '#fff', fontSize: 34, fontWeight: '800', marginVertical: 6 },
  bar: { height: 6, backgroundColor: '#374151', borderRadius: 3, overflow: 'hidden', marginTop: 4 },
  barFill: { height: 6, backgroundColor: '#34D399', borderRadius: 3 },
  barLabel: { color: '#9CA3AF', fontSize: 12, marginTop: 6 },
  cardRow: { flexDirection: 'row', marginTop: 14, gap: 8 },
  statLabel: { color: '#9CA3AF', fontSize: 12 },
  statValue: { color: '#fff', fontSize: 15, fontWeight: '700', marginTop: 2 },
  errorBox: { backgroundColor: colors.dangerBg, borderRadius: 12, padding: 12, marginTop: 12 },
  errorText: { color: colors.danger },
  tabs: { flexDirection: 'row', gap: 8, marginTop: 20, marginBottom: 12 },
  tab: { paddingVertical: 8, paddingHorizontal: 14, borderRadius: 20, backgroundColor: '#fff', borderWidth: 1, borderColor: colors.line },
  tabActive: { backgroundColor: colors.ink, borderColor: colors.ink },
  tabText: { color: colors.ink, fontWeight: '600', fontSize: 13 },
  tabTextActive: { color: '#fff' },
  empty: { alignItems: 'center', padding: 32 },
  emptyTitle: { fontSize: 18, fontWeight: '700', color: colors.ink, marginBottom: 4 },
  muted: { color: colors.muted, textAlign: 'center' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: '#fff', borderRadius: 14, padding: 14, marginBottom: 10, borderWidth: 1, borderColor: colors.line },
  rowOverdue: { backgroundColor: colors.dangerBg, borderColor: '#FECACA', borderLeftWidth: 4, borderLeftColor: colors.danger },
  rowSoon: { borderLeftWidth: 4, borderLeftColor: colors.warn },
  rowRepaid: { opacity: 0.6 },
  avatar: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  avatarText: { color: '#fff', fontWeight: '800' },
  name: { fontSize: 16, fontWeight: '700', color: colors.ink },
  strike: { textDecorationLine: 'line-through' },
  sub: { fontSize: 13, color: colors.muted, marginTop: 2 },
  actions: { flexDirection: 'row', gap: 14, marginTop: 6 },
  amount: { fontSize: 17, fontWeight: '800', color: colors.ink },
  repay: { backgroundColor: colors.ok, borderRadius: 8, paddingVertical: 6, paddingHorizontal: 10 },
  repayText: { color: '#fff', fontWeight: '700', fontSize: 12 },
  fab: { position: 'absolute', bottom: 32, alignSelf: 'center', backgroundColor: colors.brand, borderRadius: 28, paddingVertical: 16, paddingHorizontal: 28, elevation: 4 },
  fabText: { color: '#fff', fontWeight: '800', fontSize: 16 },
  footerHint: { color: colors.muted, textAlign: 'center', fontSize: 12, marginTop: 8 },
  toast: { position: 'absolute', bottom: 32, left: 16, right: 16, backgroundColor: colors.ink, borderRadius: 14, paddingVertical: 14, paddingHorizontal: 18, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', elevation: 6 },
  toastText: { color: '#fff', flex: 1, marginRight: 12 },
  toastUndo: { color: '#A5B4FC', fontWeight: '800' },
  viewer: { flex: 1, backgroundColor: 'rgba(0,0,0,0.9)', justifyContent: 'center', alignItems: 'center' },
  receipt: { width: '90%', height: '75%' },
  viewerHint: { color: '#fff', marginTop: 12 },
})
