import { test, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openDb, type Db } from '../src/db.ts'
import { createApp } from '../src/app.ts'
import { rupeesToPaise } from '../src/money.ts'

// A fixed clock: 22 Oct 2026, 10:00 in India. Tests move it forward when they need to.
let clock = new Date('2026-10-22T04:30:00Z')
let db: Db
let app: ReturnType<typeof createApp>
let codes: string[]

// CI also runs this file against real Postgres (TEST_DATABASE_URL); locally it uses in-memory PGlite.
afterEach(() => db.close())

beforeEach(async () => {
  clock = new Date('2026-10-22T04:30:00Z')
  db = await openDb({ url: process.env.TEST_DATABASE_URL }) // fresh database per test
  if (process.env.TEST_DATABASE_URL) await db.query('TRUNCATE users, otp_codes, loans, payments RESTART IDENTITY CASCADE')
  app = createApp({ db, jwtSecret: 'test', uploadsDir: await mkdtemp(join(tmpdir(), 'ml-')), now: () => clock })
  codes = []
  console.log = (msg: string) => { const m = /-> (\d{6})/.exec(msg); if (m) codes.push(m[1]) }
})

const call = (method: string, path: string, body?: unknown, token?: string) =>
  app.request(path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  })

async function login(phone = '9876543210') {
  assert.equal((await call('POST', '/auth/otp', { phone })).status, 200)
  const res = await call('POST', '/auth/verify', { phone, code: codes.at(-1) })
  assert.equal(res.status, 200)
  return ((await res.json()) as { token: string }).token
}

test('money: rupees become exact paise', () => {
  assert.equal(rupeesToPaise('19.99'), 1999) // 19.99 * 100 would be 1998.9999999999998
  assert.equal(rupeesToPaise('1500.5'), 150050)
  assert.equal(rupeesToPaise('7'), 700)
  assert.throws(() => rupeesToPaise('-5'))
  assert.throws(() => rupeesToPaise('1.234'))
})

test('otp: wrong code fails, right code logs in, code is single-use', async () => {
  await call('POST', '/auth/otp', { phone: '9876543210' })
  const code = codes[0]
  const wrong = code === '000000' ? '111111' : '000000'
  assert.equal((await call('POST', '/auth/verify', { phone: '9876543210', code: wrong })).status, 401)
  assert.equal((await call('POST', '/auth/verify', { phone: '9876543210', code })).status, 200)
  assert.equal((await call('POST', '/auth/verify', { phone: '9876543210', code })).status, 401)
})

test('otp: expires after 5 minutes and cannot be re-requested within 30 seconds', async () => {
  await call('POST', '/auth/otp', { phone: '9876543210' })
  assert.equal((await call('POST', '/auth/otp', { phone: '9876543210' })).status, 429)
  clock = new Date(clock.getTime() + 6 * 60_000)
  assert.equal((await call('POST', '/auth/verify', { phone: '9876543210', code: codes[0] })).status, 401)
})

test('otp: locks after 5 wrong tries even if the 6th is right', async () => {
  await call('POST', '/auth/otp', { phone: '9876543210' })
  const code = codes[0]
  const wrong = code === '000000' ? '111111' : '000000'
  for (let i = 0; i < 5; i++) await call('POST', '/auth/verify', { phone: '9876543210', code: wrong })
  assert.equal((await call('POST', '/auth/verify', { phone: '9876543210', code })).status, 401)
})

test('rate limit: one client cannot request codes for many numbers', async () => {
  for (let i = 0; i < 10; i++) {
    assert.equal((await call('POST', '/auth/otp', { phone: `90000000${String(i).padStart(2, '0')}` })).status, 200)
  }
  const res = await call('POST', '/auth/otp', { phone: '9000000099' })
  assert.equal(res.status, 429)
  clock = new Date(clock.getTime() + 11 * 60_000) // window resets after 10 minutes
  assert.equal((await call('POST', '/auth/otp', { phone: '9000000099' })).status, 200)
})

test('security headers are set on every response', async () => {
  const res = await call('GET', '/health')
  assert.equal(res.headers.get('X-Content-Type-Options'), 'nosniff')
  assert.equal(res.headers.get('X-Frame-Options'), 'SAMEORIGIN')
})

test('loans need a token', async () => {
  assert.equal((await call('GET', '/loans')).status, 401)
  assert.equal((await call('GET', '/loans', undefined, 'not-a-token')).status, 401)
})

test('validation: bad loan input is rejected with a clear message', async () => {
  const t = await login()
  for (const bad of [
    { friendName: '', amount: '100', dueDate: '2026-11-01' },
    { friendName: 'Asha', amount: '0', dueDate: '2026-11-01' },
    { friendName: 'Asha', amount: '10.555', dueDate: '2026-11-01' },
    { friendName: 'Asha', amount: '100', dueDate: '01/11/2026' },
  ]) {
    const res = await call('POST', '/loans', bad, t)
    assert.equal(res.status, 400)
    assert.ok(((await res.json()) as { error: string }).error.length > 0)
  }
})

test('summary: totals and overdue are exact, and repaying is idempotent', async () => {
  const t = await login()
  const add = async (friendName: string, amount: string, dueDate: string) =>
    ((await (await call('POST', '/loans', { friendName, amount, dueDate }, t)).json()) as { loan: { id: number } }).loan.id

  await add('Asha', '0.10', '2026-10-01') // overdue
  const b = await add('Ravi', '0.20', '2026-10-10') // overdue, will be repaid
  await add('Meena', '1500.50', '2026-10-22') // due today: not overdue yet
  await add('Kiran', '200', '2026-11-30') // due later

  assert.equal((await call('PATCH', `/loans/${b}/repay`, undefined, t)).status, 200)
  const again = (await (await call('PATCH', `/loans/${b}/repay`, undefined, t)).json()) as { loan: { repaidAt: string } }
  clock = new Date(clock.getTime() + 3_600_000)
  const third = (await (await call('PATCH', `/loans/${b}/repay`, undefined, t)).json()) as { loan: { repaidAt: string } }
  assert.equal(third.loan.repaidAt, again.loan.repaidAt) // first repaid time is kept

  const s = await (await call('GET', '/loans/summary', undefined, t)).json()
  assert.deepEqual(s, { totalLentPaise: 170080, totalRepaidPaise: 20, overduePaise: 10, overdueCount: 1 })

  const { loans } = (await (await call('GET', '/loans', undefined, t)).json()) as { loans: { friendName: string; status: string }[] }
  assert.deepEqual(loans.map((l) => [l.friendName, l.status]), [
    ['Asha', 'overdue'], ['Meena', 'due'], ['Kiran', 'due'], ['Ravi', 'repaid'],
  ])
})

test('undo and delete: both work, and only on your own loans', async () => {
  const t = await login('9000000001')
  clock = new Date(clock.getTime() + 31_000)
  const other = await login('9000000002')
  const { loan } = (await (await call('POST', '/loans', { friendName: 'Asha', amount: '100', dueDate: '2026-11-01' }, t)).json()) as { loan: { id: number } }

  await call('PATCH', `/loans/${loan.id}/repay`, undefined, t)
  const undone = (await (await call('DELETE', `/loans/${loan.id}/payments/last`, undefined, t)).json()) as { loan: { repaidAt: string | null; paidPaise: number; status: string } }
  assert.equal(undone.loan.repaidAt, null)
  assert.equal(undone.loan.paidPaise, 0)
  assert.equal(undone.loan.status, 'due')
  assert.equal((await call('DELETE', `/loans/${loan.id}/payments/last`, undefined, t)).status, 400) // nothing left to undo

  assert.equal((await call('DELETE', `/loans/${loan.id}/payments/last`, undefined, other)).status, 404)
  assert.equal((await call('DELETE', `/loans/${loan.id}`, undefined, other)).status, 404)
  assert.equal((await call('DELETE', `/loans/${loan.id}`, undefined, t)).status, 204)
  assert.deepEqual(((await (await call('GET', '/loans', undefined, t)).json()) as { loans: unknown[] }).loans, [])
})

test('part payments: running total, history, and no overpaying', async () => {
  const t = await login()
  const { loan } = (await (await call('POST', '/loans', { friendName: 'Ravi', amount: '800', dueDate: '2026-10-10' }, t)).json()) as { loan: { id: number } }
  const pay = (amount: string) => call('POST', `/loans/${loan.id}/payments`, { amount }, t)

  const first = (await (await pay('300')).json()) as { loan: { paidPaise: number; status: string } }
  assert.equal(first.loan.paidPaise, 30000)
  assert.equal(first.loan.status, 'overdue') // still owes 500, and the due date has passed

  const s1 = (await (await call('GET', '/loans/summary', undefined, t)).json()) as { totalRepaidPaise: number; overduePaise: number }
  assert.equal(s1.totalRepaidPaise, 30000)
  assert.equal(s1.overduePaise, 50000) // only what's still pending counts as overdue

  const tooMuch = await pay('500.01')
  assert.equal(tooMuch.status, 400)
  assert.match(((await tooMuch.json()) as { error: string }).error, /500\.00 still pending/)

  const last = (await (await pay('500')).json()) as { loan: { paidPaise: number; status: string; repaidAt: string } }
  assert.equal(last.loan.status, 'repaid')
  assert.ok(last.loan.repaidAt)

  const detail = (await (await call('GET', `/loans/${loan.id}`, undefined, t)).json()) as { payments: { amountPaise: number }[] }
  assert.deepEqual(detail.payments.map((p) => p.amountPaise), [50000, 30000]) // newest first
})

test('two payments at the same moment cannot overpay', async () => {
  const t = await login()
  const { loan } = (await (await call('POST', '/loans', { friendName: 'Asha', amount: '800', dueDate: '2026-11-01' }, t)).json()) as { loan: { id: number } }
  // Both ask for 500 of an 800 loan at once; only one can fit.
  const results = await Promise.all([0, 1].map(() => call('POST', `/loans/${loan.id}/payments`, { amount: '500' }, t)))
  assert.deepEqual(results.map((r) => r.status).sort(), [201, 400])
  const detail = (await (await call('GET', `/loans/${loan.id}`, undefined, t)).json()) as { loan: { paidPaise: number }; payments: unknown[] }
  assert.equal(detail.loan.paidPaise, 50000)
  assert.equal(detail.payments.length, 1)
})

test('profile: save a UPI ID, reject a bad one, clear it', async () => {
  const t = await login()
  const save = (upiId: string) => call('PATCH', '/me', { upiId }, t)
  assert.deepEqual(await (await save('runal@okaxis')).json(), { phone: '+919876543210', upiId: 'runal@okaxis' })
  assert.equal((await save('not a upi id')).status, 400)
  assert.equal(((await (await save('')).json()) as { upiId: string | null }).upiId, null)
  assert.equal((await call('GET', '/me')).status, 401) // needs a token
})

test('overdue flips at midnight India time, not UTC', async () => {
  const t = await login()
  await call('POST', '/loans', { friendName: 'Asha', amount: '100', dueDate: '2026-10-22' }, t)
  clock = new Date('2026-10-22T18:29:00Z') // 23:59 IST on the 22nd
  assert.equal(((await (await call('GET', '/loans/summary', undefined, t)).json()) as { overdueCount: number }).overdueCount, 0)
  clock = new Date('2026-10-22T18:31:00Z') // 00:01 IST on the 23rd
  assert.equal(((await (await call('GET', '/loans/summary', undefined, t)).json()) as { overdueCount: number }).overdueCount, 1)
})

test("privacy: a user can't see or repay someone else's loan", async () => {
  const alice = await login('9000000001')
  clock = new Date(clock.getTime() + 31_000)
  const bob = await login('9000000002')
  const { loan } = (await (await call('POST', '/loans', { friendName: 'X', amount: '50', dueDate: '2026-11-01' }, alice)).json()) as { loan: { id: number } }

  assert.equal((await call('PATCH', `/loans/${loan.id}/repay`, undefined, bob)).status, 404)
  assert.deepEqual(((await (await call('GET', '/loans', undefined, bob)).json()) as { loans: unknown[] }).loans, [])
  assert.equal(((await (await call('GET', '/loans/summary', undefined, bob)).json()) as { totalLentPaise: number }).totalLentPaise, 0)
})

test('receipt: accepts an image, rejects other files, serves it back only to the owner', async () => {
  const t = await login()
  const { loan } = (await (await call('POST', '/loans', { friendName: 'Asha', amount: '10', dueDate: '2026-11-01' }, t)).json()) as { loan: { id: number } }
  const upload = (file: File) => {
    const form = new FormData()
    form.append('receipt', file)
    return app.request(`/loans/${loan.id}/receipt`, { method: 'POST', headers: { Authorization: `Bearer ${t}` }, body: form })
  }
  const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0])
  assert.equal((await upload(new File(['hi'], 'a.txt', { type: 'text/plain' }))).status, 400)
  // A script that *claims* to be a PNG is still rejected: we check the file's bytes, not its label.
  assert.equal((await upload(new File(['<script>alert(1)</script>'], 'r.png', { type: 'image/png' }))).status, 400)
  assert.equal((await upload(new File([png], 'r.png', { type: 'image/png' }))).status, 200)

  const res = await call('GET', `/loans/${loan.id}/receipt`, undefined, t)
  assert.equal(res.status, 200)
  assert.equal(res.headers.get('Content-Type'), 'image/png')
})
