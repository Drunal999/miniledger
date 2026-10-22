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

const loans: [string, number, number, boolean][] = [
  // friend, amount in paise, due in N days (negative = past), repaid?
  ['Asha Rao', 250_000, -12, false],
  ['Ravi Kumar', 80_000, -3, false],
  ['Meena Iyer', 150_050, 2, false],
  ['Kiran', 50_000, 14, false],
  ['Arjun Shah', 120_000, -20, true],
]
for (const [name, paise, days, repaid] of loans) {
  await db.query(
    `INSERT INTO loans (user_id, friend_name, amount_paise, due_date, repaid_at) VALUES ($1, $2, $3, $4, $5)`,
    [user.id, name, paise, shift(days), repaid ? new Date() : null],
  )
}
console.log(`Seeded ${loans.length} loans for ${phone}. Log in with that number; the code prints in the server log.`)
await db.close()
