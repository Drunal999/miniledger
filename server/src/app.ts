import { Hono, type Context, type MiddlewareHandler } from 'hono'
import { cors } from 'hono/cors'
import { secureHeaders } from 'hono/secure-headers'
import { bodyLimit } from 'hono/body-limit'
import { getConnInfo } from '@hono/node-server/conninfo'
import { SignJWT, jwtVerify } from 'jose'
import { z } from 'zod'
import { randomUUID } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { Db } from './db.ts'
import { rupeesToPaise } from './money.ts'
import { requestOtp, verifyOtp } from './otp.ts'
import { rateLimiter } from './rateLimit.ts'

export type Deps = {
  db: Db
  jwtSecret: string
  uploadsDir: string
  now?: () => Date // injectable clock so tests can control "today"
}

type Env = { Variables: { userId: number } }

// Accepts "+919876543210" or a 10-digit Indian number ("9876543210"), stores E.164.
const phoneSchema = z
  .string()
  .trim()
  .transform((p) => (/^\d{10}$/.test(p) ? `+91${p}` : p))
  .pipe(z.string().regex(/^\+[1-9]\d{9,14}$/, 'Enter a valid phone number'))

const loanSchema = z.object({
  friendName: z.string().trim().min(1, 'Friend name is required').max(80),
  amount: z.string().transform((a, ctx) => {
    try {
      const paise = rupeesToPaise(a)
      if (paise > 0) return paise
    } catch {}
    ctx.addIssue({ code: 'custom', message: 'Amount must be more than 0, with at most 2 decimals' })
    return z.NEVER
  }),
  dueDate: z.iso.date('Due date must be YYYY-MM-DD'),
})

const RECEIPT_TYPES: Record<string, string> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' }
const MAX_RECEIPT_BYTES = 5 * 1024 * 1024

/**
 * Decide the image type from the file's first bytes, not from what the client claims.
 * A script renamed to receipt.png still starts with its own bytes, so it gets rejected here.
 */
export function sniffImage(b: Uint8Array): string | null {
  const starts = (sig: number[], at = 0) => sig.every((v, i) => b[at + i] === v)
  if (starts([0xff, 0xd8, 0xff])) return 'image/jpeg'
  if (starts([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'image/png'
  if (starts([0x52, 0x49, 0x46, 0x46]) && starts([0x57, 0x45, 0x42, 0x50], 8)) return 'image/webp' // "RIFF....WEBP"
  return null
}

const clientIp = (c: Context) => {
  try {
    return getConnInfo(c).remote.address ?? 'unknown'
  } catch {
    return 'unknown' // in-process test requests have no socket
  }
}

/** "Today" in India, as YYYY-MM-DD. Overdue means due_date is before this. */
export const todayIn = (d: Date, timeZone = 'Asia/Kolkata') =>
  new Intl.DateTimeFormat('en-CA', { timeZone }).format(d)

export function createApp({ db, jwtSecret, uploadsDir, now = () => new Date() }: Deps) {
  const key = new TextEncoder().encode(jwtSecret)
  const app = new Hono<Env>()
  app.use('*', cors())
  app.use('*', secureHeaders())
  // Big enough for a 5 MB receipt plus form overhead; anything larger is refused before we read it.
  app.use('*', bodyLimit({ maxSize: 6 * 1024 * 1024, onError: (c) => c.json({ error: 'Request too large' }, 413) }))
  // Requests per IP per 10 minutes. Per-phone limits live in otp.ts; these stop one client hammering many numbers.
  const otpLimit = rateLimiter(10, 10 * 60_000)
  const verifyLimit = rateLimiter(30, 10 * 60_000)
  const limited = (limit: ReturnType<typeof rateLimiter>): MiddlewareHandler => async (c, next) => {
    if (!limit(clientIp(c), now().getTime())) return c.json({ error: 'Too many attempts, try again in a few minutes' }, 429)
    await next()
  }

  app.onError((err, c) => {
    if (err instanceof z.ZodError) return c.json({ error: err.issues[0]?.message ?? 'Invalid input' }, 400)
    console.error(err)
    return c.json({ error: 'Something went wrong' }, 500)
  })

  app.get('/health', (c) => c.json({ ok: true }))

  // ---- Auth: phone + mock OTP -> JWT ----
  app.post('/auth/otp', limited(otpLimit), async (c) => {
    const { phone } = z.object({ phone: phoneSchema }).parse(await c.req.json())
    const r = await requestOtp(db, jwtSecret, phone, now())
    return r.ok ? c.json({ sent: true, phone }) : c.json({ error: r.error }, 429)
  })

  app.post('/auth/verify', limited(verifyLimit), async (c) => {
    const { phone, code } = z
      .object({ phone: phoneSchema, code: z.string().regex(/^\d{6}$/, 'Code is 6 digits') })
      .parse(await c.req.json())
    const r = await verifyOtp(db, jwtSecret, phone, code, now())
    if (!r.ok) return c.json({ error: r.error }, 401)
    const [user] = await db.query<{ id: number }>(
      `INSERT INTO users (phone) VALUES ($1) ON CONFLICT (phone) DO UPDATE SET phone = EXCLUDED.phone RETURNING id`,
      [phone],
    )
    const token = await new SignJWT({ phone })
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject(String(user.id))
      .setIssuedAt()
      .setExpirationTime('7d')
      .sign(key)
    return c.json({ token })
  })

  // ---- Everything under /loans needs a valid token ----
  const requireUser: MiddlewareHandler<Env> = async (c, next) => {
    const token = c.req.header('Authorization')?.replace(/^Bearer /, '')
    try {
      const { payload } = await jwtVerify(token ?? '', key)
      c.set('userId', Number(payload.sub))
    } catch {
      return c.json({ error: 'Please log in again' }, 401)
    }
    await next()
  }
  app.use('/loans', requireUser)
  app.use('/loans/*', requireUser)

  const loanFields = `id, friend_name AS "friendName", amount_paise AS "amountPaise", due_date AS "dueDate",
    repaid_at AS "repaidAt", receipt_file IS NOT NULL AS "hasReceipt", created_at AS "createdAt"`

  app.get('/loans', async (c) => {
    const today = todayIn(now())
    const rows = await db.query<{ repaidAt: string | null; dueDate: string }>(
      `SELECT ${loanFields} FROM loans WHERE user_id = $1
       ORDER BY (repaid_at IS NOT NULL), due_date, id`,
      [c.get('userId')],
    )
    const loans = rows.map((l) => ({
      ...l,
      status: l.repaidAt ? 'repaid' : l.dueDate < today ? 'overdue' : 'due',
    }))
    return c.json({ today, loans })
  })

  app.post('/loans', async (c) => {
    const body = loanSchema.parse(await c.req.json())
    const [loan] = await db.query(
      `INSERT INTO loans (user_id, friend_name, amount_paise, due_date) VALUES ($1, $2, $3, $4)
       RETURNING ${loanFields}`,
      [c.get('userId'), body.friendName, body.amount, body.dueDate],
    )
    return c.json({ loan }, 201)
  })

  // Idempotent: repaying twice keeps the first repaid_at. Other users' loans look like "not found".
  app.patch('/loans/:id/repay', async (c) => {
    const id = z.coerce.number().int().positive().parse(c.req.param('id'))
    const [loan] = await db.query(
      `UPDATE loans SET repaid_at = COALESCE(repaid_at, $3) WHERE id = $1 AND user_id = $2
       RETURNING ${loanFields}`,
      [id, c.get('userId'), now()],
    )
    return loan ? c.json({ loan }) : c.json({ error: 'Loan not found' }, 404)
  })

  app.get('/loans/summary', async (c) => {
    const [s] = await db.query(
      `SELECT
         COALESCE(SUM(amount_paise), 0)::bigint AS "totalLentPaise",
         COALESCE(SUM(amount_paise) FILTER (WHERE repaid_at IS NOT NULL), 0)::bigint AS "totalRepaidPaise",
         COALESCE(SUM(amount_paise) FILTER (WHERE repaid_at IS NULL AND due_date < $2), 0)::bigint AS "overduePaise",
         COUNT(*) FILTER (WHERE repaid_at IS NULL AND due_date < $2) AS "overdueCount"
       FROM loans WHERE user_id = $1`,
      [c.get('userId'), todayIn(now())],
    )
    return c.json(s)
  })

  // ---- Bonus: receipt photo per loan ----
  app.post('/loans/:id/receipt', async (c) => {
    const id = z.coerce.number().int().positive().parse(c.req.param('id'))
    const body = await c.req.parseBody()
    const file = body.receipt
    if (!(file instanceof File)) return c.json({ error: 'Attach an image as "receipt"' }, 400)
    if (file.size > MAX_RECEIPT_BYTES) return c.json({ error: 'Receipt must be under 5 MB' }, 400)
    const bytes = new Uint8Array(await file.arrayBuffer())
    const type = sniffImage(bytes) // trust the bytes, not the client's Content-Type
    if (!type) return c.json({ error: 'Receipt must be a JPEG, PNG or WebP image' }, 400)

    const name = `${randomUUID()}.${RECEIPT_TYPES[type]}`
    const [loan] = await db.query(
      `UPDATE loans SET receipt_file = $3 WHERE id = $1 AND user_id = $2 RETURNING ${loanFields}`,
      [id, c.get('userId'), name],
    )
    if (!loan) return c.json({ error: 'Loan not found' }, 404)
    await mkdir(uploadsDir, { recursive: true })
    await writeFile(join(uploadsDir, name), bytes)
    return c.json({ loan })
  })

  app.get('/loans/:id/receipt', async (c) => {
    const id = z.coerce.number().int().positive().parse(c.req.param('id'))
    const [row] = await db.query<{ receipt_file: string | null }>(
      'SELECT receipt_file FROM loans WHERE id = $1 AND user_id = $2',
      [id, c.get('userId')],
    )
    if (!row?.receipt_file) return c.json({ error: 'No receipt' }, 404)
    const type = Object.entries(RECEIPT_TYPES).find(([, e]) => row.receipt_file!.endsWith(e))![0]
    return c.body(await readFile(join(uploadsDir, row.receipt_file)), 200, { 'Content-Type': type })
  })

  return app
}
