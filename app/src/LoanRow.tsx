import { Pressable, StyleSheet, Text, View } from 'react-native'
import type { Loan } from './api'
import { formatINR, pendingOf, prettyDate, statusPill } from './format'
import { colors, money } from './theme'
import { Avatar, Button, Pill, ProgressBar } from './ui'

/** One loan in the list. Tap for details; the two most common actions are right on the row. */
export function LoanRow({ loan, today, offline, onOpen, onRepay, onRemind }: {
  loan: Loan
  today: string
  offline: boolean
  onOpen: () => void
  onRepay: () => void
  onRemind: () => void
}) {
  const pill = statusPill(loan, today)
  const repaid = loan.status === 'repaid'
  const overdue = loan.status === 'overdue'
  const partPaid = !repaid && loan.paidPaise > 0

  return (
    <Pressable
      onPress={onOpen}
      accessibilityRole="button"
      accessibilityLabel={`${loan.friendName}, ${formatINR(pendingOf(loan))} pending of ${formatINR(loan.amountPaise)}, ${pill.text}`}
      accessibilityHint="Opens the loan details"
      style={({ pressed }) => [
        styles.row,
        overdue && styles.rowOverdue,
        pill.tone === 'warn' && styles.rowSoon,
        repaid && styles.rowRepaid,
        pressed && { opacity: 0.7 },
      ]}
    >
      <View style={styles.top}>
        <Avatar name={loan.friendName} />
        <View style={{ flex: 1 }}>
          <Text style={[styles.name, repaid && styles.strike]} numberOfLines={1}>{loan.friendName}</Text>
          <View style={styles.meta}>
            <Pill text={pill.text} tone={pill.tone} />
            <Text style={styles.date} numberOfLines={1}>{prettyDate(loan.dueDate)}</Text>
          </View>
        </View>
        <View style={{ alignItems: 'flex-end' }}>
          <Text style={[styles.amount, money, overdue && { color: colors.danger }]}>
            {formatINR(repaid ? loan.amountPaise : pendingOf(loan))}
          </Text>
          {partPaid && <Text style={[styles.of, money]}>left of {formatINR(loan.amountPaise)}</Text>}
        </View>
      </View>

      {partPaid && (
        <View style={styles.progress}>
          <ProgressBar share={loan.paidPaise / loan.amountPaise} />
        </View>
      )}

      {!repaid && (
        <View style={styles.actions}>
          <Button small kind="ok" label="✓ Repaid" onPress={onRepay} disabled={offline} />
          <Button small kind="whatsapp" label="Remind" onPress={onRemind} />
        </View>
      )}
    </Pressable>
  )
}

const styles = StyleSheet.create({
  row: { backgroundColor: colors.card, borderRadius: 16, padding: 14, marginBottom: 10, borderWidth: 1, borderColor: colors.line },
  rowOverdue: { backgroundColor: colors.dangerBg, borderColor: '#FECACA', borderLeftWidth: 4, borderLeftColor: colors.danger },
  rowSoon: { borderLeftWidth: 4, borderLeftColor: colors.warn },
  rowRepaid: { opacity: 0.6 },
  top: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  name: { fontSize: 16, fontWeight: '700', color: colors.ink },
  strike: { textDecorationLine: 'line-through' },
  meta: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 4 },
  date: { fontSize: 12, color: colors.muted, flexShrink: 1 },
  amount: { fontSize: 17, fontWeight: '800', color: colors.ink },
  of: { fontSize: 11, color: colors.muted, marginTop: 2 },
  progress: { marginTop: 12, marginLeft: 52 },
  actions: { flexDirection: 'row', gap: 8, marginTop: 12, marginLeft: 52 },
})
