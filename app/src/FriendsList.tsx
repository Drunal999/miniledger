import { Pressable, StyleSheet, Text, View } from 'react-native'
import type { Loan } from './api'
import { formatINR, pendingOf, plural } from './format'
import { colors, money } from './theme'
import { Avatar, ProgressBar } from './ui'

type Friend = { name: string; lent: number; pending: number; loans: number; overdue: number }

/** Groups loans by friend (case-insensitive), biggest pending amount first: "who owes me the most?" */
export function groupByFriend(loans: Loan[]): Friend[] {
  const map = new Map<string, Friend>()
  for (const l of loans) {
    const key = l.friendName.trim().toLowerCase()
    const f = map.get(key) ?? { name: l.friendName.trim(), lent: 0, pending: 0, loans: 0, overdue: 0 }
    f.lent += l.amountPaise
    f.pending += pendingOf(l)
    f.loans += 1
    if (l.status === 'overdue') f.overdue += 1
    map.set(key, f)
  }
  return [...map.values()].sort((a, b) => b.pending - a.pending || a.name.localeCompare(b.name))
}

export function FriendRow({ friend, onPress }: { friend: Friend; onPress: () => void }) {
  const settled = friend.pending === 0
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${friend.name}, ${settled ? 'all settled' : `${formatINR(friend.pending)} pending`}, ${plural(friend.loans, 'loan')}`}
      style={({ pressed }) => [styles.row, pressed && { opacity: 0.7 }]}
    >
      <Avatar name={friend.name} />
      <View style={{ flex: 1 }}>
        <Text style={styles.name} numberOfLines={1}>{friend.name}</Text>
        <Text style={styles.sub}>
          {plural(friend.loans, 'loan')}
          {friend.overdue > 0 && <Text style={{ color: colors.danger, fontWeight: '700' }}> · {friend.overdue} overdue</Text>}
        </Text>
        <View style={{ marginTop: 8 }}>
          <ProgressBar share={friend.lent ? (friend.lent - friend.pending) / friend.lent : 0} />
        </View>
      </View>
      <View style={{ alignItems: 'flex-end' }}>
        <Text style={[styles.amount, money, friend.overdue > 0 && { color: colors.danger }, settled && { color: colors.ok }]}>
          {settled ? 'Settled' : formatINR(friend.pending)}
        </Text>
        {!settled && <Text style={styles.owes}>owes you</Text>}
      </View>
    </Pressable>
  )
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: colors.card, borderRadius: 16, padding: 14, marginBottom: 10, borderWidth: 1, borderColor: colors.line },
  name: { fontSize: 16, fontWeight: '700', color: colors.ink },
  sub: { fontSize: 12, color: colors.muted, marginTop: 2 },
  amount: { fontSize: 17, fontWeight: '800', color: colors.ink },
  owes: { fontSize: 11, color: colors.muted, marginTop: 2 },
})
