// Fills one account with sample loans so you can see a full app in seconds.
// Usage: npm run seed -- 9876543210   (then log in with that number in the app)
import { mkdir } from 'node:fs/promises'
import { openDb } from './db.ts'
import { todayIn } from './app.ts'

const phoneArg = process.argv[2] ?? '9999999999'
const phone = /^\d{10}$/.test(phoneArg) ? `+91${phoneArg}` : phoneArg

const shift = (days: number) => {
  const d = new Date(`${todayIn(new Date())}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

await mkdir('./.data', { recursive: true })
const db = await openDb({ url: process.env.DATABASE_URL, dataDir: process.env.DATABASE_URL ? undefined : './.data/pg' })
const [user] = await db.query<{ id: number }>(
  `INSERT INTO users (phone) VALUES ($1) ON CONFLICT (phone) DO UPDATE SET phone = EXCLUDED.phone RETURNING id`,
  [phone],
)
await db.query('DELETE FROM loans WHERE user_id = $1', [user.id])

const loans: [string, number, number, number[]][] = [
  // friend, amount in paise, due in N days (negative = past), payments already received (paise)
  ['Asha Rao', 250_000, -12, []],
  ['Ravi Kumar', 80_000, -3, [30_000]], // part paid
  ['Meena Iyer', 150_050, 2, []],
  ['Kiran', 50_000, 14, []],
  ['Asha Rao', 40_000, 25, []],
  ['Arjun Shah', 120_000, -20, [70_000, 50_000]], // paid back in two parts
]
for (const [name, paise, days, payments] of loans) {
  const paid = payments.reduce((a, b) => a + b, 0)
  const lentOn = shift(Math.min(0, days - 14)) // lent two weeks before the due date, never in the future
  const [loan] = await db.query<{ id: number }>(
    `INSERT INTO loans (user_id, friend_name, amount_paise, paid_paise, lent_on, due_date, repaid_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
    [user.id, name, paise, paid, lentOn, shift(days), paid === paise ? new Date() : null],
  )
  for (const p of payments) await db.query('INSERT INTO payments (loan_id, amount_paise) VALUES ($1, $2)', [loan.id, p])
}
console.log(`Seeded ${loans.length} loans for ${phone}. Log in with that number; the code prints in the server log.`)
await db.close()
