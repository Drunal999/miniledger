import { createHmac, randomInt, timingSafeEqual } from 'node:crypto'
import type { Db } from './db.ts'

export const OTP_TTL_MS = 5 * 60_000
export const RESEND_AFTER_MS = 30_000
export const MAX_ATTEMPTS = 5

const hash = (secret: string, phone: string, code: string) =>
  createHmac('sha256', secret).update(`${phone}:${code}`).digest('hex')

type Row = { code_hash: string; expires_at: Date; attempts: number; created_at: Date }

/** Creates a 6-digit code and "sends" it by printing to the server log (mock SMS). */
export async function requestOtp(db: Db, secret: string, phone: string, now: Date) {
  const [existing] = await db.query<Row>('SELECT created_at FROM otp_codes WHERE phone = $1', [phone])
  if (existing && now.getTime() - new Date(existing.created_at).getTime() < RESEND_AFTER_MS) {
    return { ok: false as const, error: 'Please wait 30 seconds before asking for a new code' }
  }
  const code = String(randomInt(0, 1_000_000)).padStart(6, '0')
  await db.query(
    `INSERT INTO otp_codes (phone, code_hash, expires_at, attempts, created_at) VALUES ($1, $2, $3, 0, $4)
     ON CONFLICT (phone) DO UPDATE SET code_hash = $2, expires_at = $3, attempts = 0, created_at = $4`,
    [phone, hash(secret, phone, code), new Date(now.getTime() + OTP_TTL_MS), now],
  )
  console.log(`[OTP] ${phone} -> ${code} (valid 5 min)`)
  return { ok: true as const, code }
}

/** Checks a code. Codes are single-use, expire, and lock after 5 wrong tries. */
export async function verifyOtp(db: Db, secret: string, phone: string, code: string, now: Date) {
  const [row] = await db.query<Row>('SELECT * FROM otp_codes WHERE phone = $1', [phone])
  if (!row || new Date(row.expires_at) <= now) return { ok: false as const, error: 'Code expired, request a new one' }
  if (row.attempts >= MAX_ATTEMPTS) return { ok: false as const, error: 'Too many wrong tries, request a new code' }

  const expected = Buffer.from(row.code_hash, 'hex')
  const given = Buffer.from(hash(secret, phone, code), 'hex')
  if (!timingSafeEqual(expected, given)) {
    await db.query('UPDATE otp_codes SET attempts = attempts + 1 WHERE phone = $1', [phone])
    return { ok: false as const, error: 'Wrong code' }
  }
  await db.query('DELETE FROM otp_codes WHERE phone = $1', [phone])
  return { ok: true as const }
}
