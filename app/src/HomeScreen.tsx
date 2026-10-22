import { useCallback, useEffect, useMemo, useState } from 'react'
import { ActivityIndicator, FlatList, Linking, Platform, Pressable, RefreshControl, StyleSheet, Text, TextInput, View } from 'react-native'
import { useNetInfo } from '@react-native-community/netinfo'
import * as Haptics from 'expo-haptics'
import { api, ApiError, type Loan, type Profile, type Summary } from './api'
import { AddLoanSheet } from './AddLoanSheet'
import { FriendRow, groupByFriend } from './FriendsList'
import { LoanDetailSheet } from './LoanDetailSheet'
import { LoanRow } from './LoanRow'
import { ProfileSheet } from './ProfileSheet'
import { formatINR, reminderText } from './format'
import { colors, money } from './theme'
import { Avatar, ProgressBar } from './ui'

type Tab = 'loans' | 'friends'
type Filter = 'all' | 'overdue' | 'repaid'

export function HomeScreen({ token, onLogout }: { token: string; onLogout: () => void }) {
  const [loans, setLoans] = useState<Loan[] | null>(null)
  const [today, setToday] = useState('')
  const [summary, setSummary] = useState<Summary | null>(null)
  const [profile, setProfile] = useState<Profile | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [refreshing, setRefreshing] = useState(false)
  const [tab, setTab] = useState<Tab>('loans')
  const [filter, setFilter] = useState<Filter>('all')
  const [search, setSearch] = useState('')
  const [adding, setAdding] = useState(false)
  const [openLoan, setOpenLoan] = useState<number | null>(null)
  const [showProfile, setShowProfile] = useState(false)
  const [undo, setUndo] = useState<{ id: number; name: string } | null>(null)
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
  useEffect(() => { api<Profile>('/me', {}, token).then(setProfile).catch(() => {}) }, [token])

  // The "Undo" bar disappears after 5 seconds.
  useEffect(() => {
    if (!undo) return
    const t = setTimeout(() => setUndo(null), 5000)
    return () => clearTimeout(t)
  }, [undo])

  const refresh = async () => {
    setRefreshing(true)
    await load()
    setRefreshing(false)
  }

  // Optimistic: show "repaid" instantly, roll back if the server says no.
  async function markRepaid(loan: Loan) {
    const before = loans
    setLoans((ls) => ls?.map((l) => (l.id === loan.id ? { ...l, status: 'repaid', paidPaise: l.amountPaise } : l)) ?? null)
    if (Platform.OS !== 'web') Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)
    try {
      await api(`/loans/${loan.id}/repay`, { method: 'PATCH' }, token)
      setUndo({ id: loan.id, name: loan.friendName })
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
      await api(`/loans/${id}/payments/last`, { method: 'DELETE' }, token)
      await load()
    } catch (e) {
      setError((e as Error).message)
    }
  }

  const remind = (loan: Loan) =>
    Linking.openURL(`https://wa.me/?text=${encodeURIComponent(reminderText(loan, today, profile?.upiId ?? null))}`)

  const counts = {
    all: loans?.length ?? 0,
    overdue: loans?.filter((l) => l.status === 'overdue').length ?? 0,
    repaid: loans?.filter((l) => l.status === 'repaid').length ?? 0,
  }
  const q = search.trim().toLowerCase()
  const shownLoans = (loans ?? []).filter((l) => (filter === 'all' || l.status === filter) && (!q || l.friendName.toLowerCase().includes(q)))
  const friends = useMemo(() => groupByFriend(loans ?? []).filter((f) => !q || f.name.toLowerCase().includes(q)), [loans, q])
  // Most recently added friends first, no duplicates: one tap to reuse a name in the add form.
  const recentFriends = [...new Set([...(loans ?? [])].sort((a, b) => b.id - a.id).map((l) => l.friendName))]

  if (!loans && !error) {
    return <View style={styles.center}><ActivityIndicator size="large" color={colors.brand} /></View>
  }

  const header = (
    <>
      <View style={styles.topBar}>
        <View>
          <Text style={styles.brand}>MiniLedger</Text>
          {today ? (
            <Text style={styles.today}>{new Date(`${today}T00:00:00`).toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long' })}</Text>
          ) : null}
        </View>
        <Pressable onPress={() => setShowProfile(true)} accessibilityRole="button" accessibilityLabel="Profile and settings" hitSlop={8}>
          <Avatar name="Me" size={38} />
        </Pressable>
      </View>

      {summary && <SummaryCard s={summary} />}

      {error && (
        <Pressable style={styles.errorBox} onPress={refresh} accessibilityRole="button">
          <Text style={styles.errorText}>{error} Tap to retry.</Text>
        </Pressable>
      )}

      <View style={styles.segment}>
        {(['loans', 'friends'] as const).map((t) => (
          <Pressable
            key={t}
            onPress={() => setTab(t)}
            style={[styles.segmentItem, tab === t && styles.segmentActive]}
            accessibilityRole="tab"
            accessibilityState={{ selected: tab === t }}
          >
            <Text style={[styles.segmentText, tab === t && styles.segmentTextActive]}>{t === 'loans' ? 'Loans' : 'Friends'}</Text>
          </Pressable>
        ))}
      </View>

      {(loans?.length ?? 0) > 0 && (
        <View style={styles.search}>
          <Text style={styles.searchIcon}>⌕</Text>
          <TextInput
            style={styles.searchInput}
            value={search}
            onChangeText={setSearch}
            placeholder={tab === 'loans' ? 'Search loans by name' : 'Search friends'}
            autoCorrect={false}
            accessibilityLabel="Search"
          />
          {search ? (
            <Pressable onPress={() => setSearch('')} hitSlop={10} accessibilityRole="button" accessibilityLabel="Clear search">
              <Text style={styles.clear}>✕</Text>
            </Pressable>
          ) : null}
        </View>
      )}

      {tab === 'loans' && (
        <View style={styles.tabs}>
          {(['all', 'overdue', 'repaid'] as const).map((f) => (
            <Pressable
              key={f}
              style={({ pressed }) => [styles.tab, filter === f && styles.tabActive, pressed && { opacity: 0.7 }]}
              onPress={() => setFilter(f)}
              accessibilityRole="button"
              accessibilityState={{ selected: filter === f }}
            >
              <Text style={[styles.tabText, filter === f && styles.tabTextActive]}>
                {f[0].toUpperCase() + f.slice(1)} ({counts[f]})
              </Text>
            </Pressable>
          ))}
        </View>
      )}
    </>
  )

  const empty = (
    <View style={styles.empty}>
      <Text style={styles.emptyEmoji}>{q ? '🔍' : '🤝'}</Text>
      <Text style={styles.emptyTitle}>
        {q ? `Nothing matches "${search.trim()}"` : (loans?.length ?? 0) === 0 ? 'No loans yet' : `No ${filter} loans`}
      </Text>
      <Text style={styles.muted}>
        {q ? 'Try another name.' : (loans?.length ?? 0) === 0 ? 'Tap "+ Add loan" to record money you lent a friend.' : 'Nothing here right now.'}
      </Text>
    </View>
  )

  return (
    <View style={styles.screen}>
      {offline && <Text style={styles.offline}>You're offline. Showing the last saved list.</Text>}

      {tab === 'loans' ? (
        <FlatList
          data={shownLoans}
          keyExtractor={(l) => String(l.id)}
          contentContainerStyle={styles.list}
          keyboardShouldPersistTaps="handled"
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} />}
          ListHeaderComponent={header}
          ListEmptyComponent={empty}
          renderItem={({ item }) => (
            <LoanRow
              loan={item}
              today={today}
              offline={offline}
              onOpen={() => setOpenLoan(item.id)}
              onRepay={() => markRepaid(item)}
              onRemind={() => remind(item)}
            />
          )}
        />
      ) : (
        <FlatList
          data={friends}
          keyExtractor={(f) => f.name.toLowerCase()}
          contentContainerStyle={styles.list}
          keyboardShouldPersistTaps="handled"
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} />}
          ListHeaderComponent={header}
          ListEmptyComponent={empty}
          // Tapping a friend shows just their loans.
          renderItem={({ item }) => <FriendRow friend={item} onPress={() => { setSearch(item.name); setFilter('all'); setTab('loans') }} />}
        />
      )}

      {undo ? (
        <View style={styles.toast} accessibilityLiveRegion="polite">
          <Text style={styles.toastText} numberOfLines={1}>Marked {undo.name}'s loan as repaid</Text>
          <Pressable onPress={undoRepaid} hitSlop={10} accessibilityRole="button" accessibilityLabel="Undo">
            <Text style={styles.toastUndo}>UNDO</Text>
          </Pressable>
        </View>
      ) : (
        <Pressable
          style={({ pressed }) => [styles.fab, offline && { opacity: 0.4 }, pressed && { opacity: 0.8 }]}
          disabled={offline}
          onPress={() => setAdding(true)}
          accessibilityRole="button"
          accessibilityLabel="Add loan"
        >
          <Text style={styles.fabText}>+ Add loan</Text>
        </Pressable>
      )}

      <AddLoanSheet visible={adding} token={token} recentFriends={recentFriends} onClose={() => setAdding(false)} onSaved={() => { setAdding(false); load() }} />
      <LoanDetailSheet
        loanId={openLoan}
        token={token}
        today={today}
        offline={offline}
        onClose={() => setOpenLoan(null)}
        onChanged={load}
        onRemind={remind}
      />
      <ProfileSheet visible={showProfile} token={token} onClose={() => setShowProfile(false)} onLogout={onLogout} onProfile={setProfile} />
    </View>
  )
}

/** The headline card, Khatabook-style: "You'll get back" first, then the breakdown. */
function SummaryCard({ s }: { s: Summary }) {
  const outstanding = s.totalLentPaise - s.totalRepaidPaise
  const share = s.totalLentPaise ? s.totalRepaidPaise / s.totalLentPaise : 0
  return (
    <View style={styles.card} accessible accessibilityLabel={`You'll get back ${formatINR(outstanding)}. ${Math.round(share * 100)} percent repaid.`}>
      <Text style={styles.cardLabel}>You'll get back</Text>
      <Text style={[styles.cardBig, money]}>{formatINR(outstanding)}</Text>
      <ProgressBar share={share} color="#34D399" track="#374151" />
      <Text style={styles.barLabel}>{Math.round(share * 100)}% of everything you lent has come back</Text>
      <View style={styles.cardRow}>
        <Stat label="Total lent" value={formatINR(s.totalLentPaise)} />
        <Stat label="Received" value={formatINR(s.totalRepaidPaise)} />
        <Stat label={`Overdue${s.overdueCount ? ` (${s.overdueCount})` : ''}`} value={formatINR(s.overduePaise)} danger={s.overduePaise > 0} />
      </View>
    </View>
  )
}

const Stat = ({ label, value, danger }: { label: string; value: string; danger?: boolean }) => (
  <View style={{ flex: 1 }}>
    <Text style={styles.statLabel}>{label}</Text>
    <Text style={[styles.statValue, money, danger && { color: '#FCA5A5' }]}>{value}</Text>
  </View>
)

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.bg },
  list: { padding: 16, paddingBottom: 150 },
  offline: { backgroundColor: '#FEF3C7', color: '#92400E', padding: 10, textAlign: 'center' },
  topBar: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16, marginTop: 8 },
  brand: { fontSize: 24, fontWeight: '800', color: colors.ink },
  today: { fontSize: 13, color: colors.muted, marginTop: 2 },
  card: { backgroundColor: colors.ink, borderRadius: 22, padding: 20 },
  cardLabel: { color: '#9CA3AF', fontSize: 13 },
  cardBig: { color: '#fff', fontSize: 36, fontWeight: '800', marginTop: 4, marginBottom: 12 },
  barLabel: { color: '#9CA3AF', fontSize: 12, marginTop: 6 },
  cardRow: { flexDirection: 'row', marginTop: 16, gap: 8 },
  statLabel: { color: '#9CA3AF', fontSize: 12 },
  statValue: { color: '#fff', fontSize: 15, fontWeight: '700', marginTop: 2 },
  errorBox: { backgroundColor: colors.dangerBg, borderRadius: 12, padding: 12, marginTop: 12 },
  errorText: { color: colors.danger },
  segment: { flexDirection: 'row', backgroundColor: '#E5E7EB', borderRadius: 12, padding: 4, marginTop: 20 },
  segmentItem: { flex: 1, paddingVertical: 9, borderRadius: 9, alignItems: 'center' },
  segmentActive: { backgroundColor: colors.card },
  segmentText: { fontWeight: '700', color: colors.muted },
  segmentTextActive: { color: colors.ink },
  search: { flexDirection: 'row', alignItems: 'center', backgroundColor: colors.card, borderRadius: 12, borderWidth: 1, borderColor: colors.line, paddingHorizontal: 12, marginTop: 12 },
  searchIcon: { fontSize: 18, color: colors.muted, marginRight: 6 },
  searchInput: { flex: 1, paddingVertical: 11, fontSize: 15 },
  clear: { color: colors.muted, fontSize: 14, padding: 4 },
  tabs: { flexDirection: 'row', gap: 8, marginTop: 12, marginBottom: 12 },
  tab: { paddingVertical: 8, paddingHorizontal: 14, borderRadius: 20, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.line },
  tabActive: { backgroundColor: colors.ink, borderColor: colors.ink },
  tabText: { color: colors.ink, fontWeight: '600', fontSize: 13 },
  tabTextActive: { color: '#fff' },
  empty: { alignItems: 'center', padding: 32 },
  emptyEmoji: { fontSize: 40, marginBottom: 8 },
  emptyTitle: { fontSize: 18, fontWeight: '700', color: colors.ink, marginBottom: 4, textAlign: 'center' },
  muted: { color: colors.muted, textAlign: 'center' },
  fab: { position: 'absolute', bottom: 32, alignSelf: 'center', backgroundColor: colors.brand, borderRadius: 28, paddingVertical: 16, paddingHorizontal: 28, elevation: 4, shadowColor: colors.brand, shadowOpacity: 0.3, shadowRadius: 10, shadowOffset: { width: 0, height: 4 } },
  fabText: { color: '#fff', fontWeight: '800', fontSize: 16 },
  toast: { position: 'absolute', bottom: 32, left: 16, right: 16, backgroundColor: colors.ink, borderRadius: 14, paddingVertical: 14, paddingHorizontal: 18, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', elevation: 6 },
  toastText: { color: '#fff', flex: 1, marginRight: 12 },
  toastUndo: { color: '#A5B4FC', fontWeight: '800' },
})
