import type { Loan } from './api'

/** Paise to "₹1,500.50" with Indian digit grouping (₹1,50,000). */
export const formatINR = (paise: number) =>
  new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', minimumFractionDigits: paise % 100 ? 2 : 0 }).format(paise / 100)

/** "1500.5" -> 150050 paise, or null if it isn't a valid amount yet. Same rules as the server. */
export function parsePaise(a: string): number | null {
  const m = /^(\d{1,9})(?:\.(\d{1,2}))?$/.exec(a.trim())
  return m ? Number(m[1]) * 100 + Number((m[2] ?? '').padEnd(2, '0')) : null
}

export const daysBetween = (from: string, to: string) => Math.round((Date.parse(to) - Date.parse(from)) / 86_400_000)
export const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`
export const prettyDate = (iso: string) =>
  new Date(`${iso.slice(0, 10)}T00:00:00`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })
export const prettyDateTime = (iso: string) =>
  new Date(iso).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })

// Same name -> same colour every time, so a friend is easy to spot.
const AVATAR_COLORS = ['#6366F1', '#0EA5E9', '#14B8A6', '#F59E0B', '#EC4899', '#8B5CF6', '#10B981', '#F97316']
export const avatarColor = (name: string) =>
  AVATAR_COLORS[[...name.toLowerCase()].reduce((h, ch) => h + ch.charCodeAt(0), 0) % AVATAR_COLORS.length]
export const initials = (name: string) => name.trim().split(/\s+/).slice(0, 2).map((w) => w[0]?.toUpperCase()).join('')

export const pendingOf = (l: Loan) => l.amountPaise - l.paidPaise

export const DUE_SOON_DAYS = 3

/** The short status shown in the coloured pill, plus its colours. */
export function statusPill(l: Loan, today: string) {
  const daysLeft = daysBetween(today, l.dueDate)
  if (l.status === 'repaid') return { text: 'Repaid', tone: 'ok' as const }
  if (l.status === 'overdue') return { text: `${plural(-daysLeft, 'day')} late`, tone: 'danger' as const }
  if (daysLeft === 0) return { text: 'Due today', tone: 'warn' as const }
  if (daysLeft <= DUE_SOON_DAYS) return { text: `Due in ${plural(daysLeft, 'day')}`, tone: 'warn' as const }
  return { text: 'Upcoming', tone: 'muted' as const }
}

/** The WhatsApp message: friendly, says what's still pending, and how to pay if you've saved a UPI ID. */
export function reminderText(l: Loan, today: string, upiId: string | null) {
  const pending = pendingOf(l)
  const what = l.paidPaise > 0
    ? `the ${formatINR(l.amountPaise)} I lent you (${formatINR(pending)} still pending)`
    : `the ${formatINR(l.amountPaise)} I lent you`
  const when = l.dueDate < today ? `which was due on ${prettyDate(l.dueDate)}` : `which is due on ${prettyDate(l.dueDate)}`
  const pay = upiId ? ` You can pay me on UPI: ${upiId}` : ''
  return `Hi ${l.friendName}, a gentle reminder about ${what}, ${when}.${pay} Thanks!`
}
