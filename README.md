# MiniLedger

[![CI](https://github.com/Drunal999/miniledger/actions/workflows/ci.yml/badge.svg)](https://github.com/Drunal999/miniledger/actions/workflows/ci.yml)

Track money you've lent to friends: who owes you, how much, and who's late.

- **API:** Node.js, TypeScript, Hono, Zod, PostgreSQL
- **App:** React Native (Expo)
- **Demo video:** _link here_

<!-- screenshots: login, list with an overdue loan, add form -->

## Run it

You need Node 24 (it runs TypeScript directly, no build step).

**1. API**

```bash
cd server
npm install
npm run dev
```

The API starts on `http://localhost:4000`. When you log in, the OTP is printed in this terminal:

```
[OTP] +919876543210 -> 482913 (valid 5 min)
```

No database setup needed. Without `DATABASE_URL` the API uses [PGlite](https://pglite.dev), which is real Postgres compiled to WebAssembly, and keeps data in `server/.data`. To use a normal Postgres instead:

```bash
docker compose up -d
DATABASE_URL=postgres://miniledger:miniledger@localhost:5432/miniledger npm run dev
```

**2. App**

```bash
cd app
npm install
EXPO_PUBLIC_API_URL=http://<your-laptop-ip>:4000 npx expo start
```

Scan the QR code with Expo Go on your phone (same Wi-Fi as the laptop). Use your laptop's Wi-Fi IP, not `localhost`, because on the phone `localhost` is the phone. Press `w` to run it in a browser instead.

**3. Tests**

```bash
cd server
npm test        # 12 tests, about 25 seconds
npm run typecheck
```

CI runs the same tests on every push, once on PGlite and once on a real Postgres 17.

## What it does

- Log in with your phone number and a one-time code
- Add a loan: friend's name, amount, due date, and optionally a photo of the receipt
- See every loan, with overdue ones in red ("Overdue by 4 days")
- Mark a loan as repaid (with a small vibration on the phone)
- A summary card at the top: still to get back, total lent, repaid, overdue, and how much has come back so far
- Filter the list: all, overdue, repaid
- Loans due in the next 3 days are marked "Due in 2 days" in amber, before they turn red
- "Remind on WhatsApp" opens WhatsApp with a polite reminder ready to send. You pick the chat, so the app never needs your friend's number

The app also handles the unhappy paths: loading spinners, a clear message when the server says no, an empty state, pull to refresh, and an offline banner that keeps the last list on screen and disables changes until you're back online.

## Decisions worth explaining

**Money is stored in paise, as whole numbers.** In JavaScript `19.99 * 100` is `1998.9999999999998`. For a money app that is a bug waiting to happen, so amounts arrive as strings ("1500.50"), get parsed into integer paise (150050) without any float maths, and are stored as `BIGINT`. The summary is summed in SQL, so totals are exact.

**"Overdue" means past the due date in India, not in UTC.** A loan due on the 22nd becomes overdue at 00:00 IST on the 23rd. The server decides what "today" is (in `Asia/Kolkata`) so every phone sees the same answer. There's a test for the minute before and after midnight.

**The OTP is mocked, but handled like a real one.** It is printed to the log, as asked, but:
- only a hash of it is stored;
- it expires after 5 minutes;
- it works once;
- it locks after 5 wrong tries;
- you can't request a new one for 30 seconds;
- comparison is constant-time.

Swapping in a real SMS provider means changing one `console.log` line.

**You can only touch your own loans.** Every query is scoped by the user id from the login token. Asking for someone else's loan returns 404, not 403, so the API doesn't even confirm it exists. Tests check this for listing, repaying and the summary.

**Repaying twice is safe.** `repaid_at = COALESCE(repaid_at, now())` keeps the first repayment time, so a double tap or a retried request can't change history.

**Validation lives at the edge.** Zod checks every request body and returns the first readable message ("Amount must be more than 0, with at most 2 decimals"), which the app shows as is. The database has `CHECK` constraints as a second line of defence.

**Receipts.** JPEG, PNG or WebP up to 5 MB, stored with a random file name, and only served back to the loan's owner. The server decides the type from the file's first bytes, not from what the client says, so a script renamed to `receipt.png` is rejected.

**Other hardening.**
- Login endpoints are rate-limited per IP: 10 code requests and 30 attempts per 10 minutes. That's on top of the per-phone limits.
- Every response gets security headers (`nosniff`, frame protection and others).
- Request bodies over 6 MB are refused before they're read.
- The server refuses to start in production without a real `JWT_SECRET`.

## API

All `/loans` routes need `Authorization: Bearer <token>`.

| Method | Path | Body | Returns |
|---|---|---|---|
| POST | `/auth/otp` | `{ phone }` | Prints the code to the server log |
| POST | `/auth/verify` | `{ phone, code }` | `{ token }` (valid 7 days) |
| GET | `/loans` | | `{ today, loans: [...] }`, each with `status`: `due`, `overdue` or `repaid` |
| POST | `/loans` | `{ friendName, amount: "1500.50", dueDate: "2026-11-01" }` | `{ loan }` |
| PATCH | `/loans/:id/repay` | | `{ loan }` |
| GET | `/loans/summary` | | `{ totalLentPaise, totalRepaidPaise, overduePaise, overdueCount }` |
| POST | `/loans/:id/receipt` | multipart, field `receipt` | `{ loan }` |
| GET | `/loans/:id/receipt` | | the image |

Phone numbers can be 10-digit Indian numbers (`9876543210`) or full international numbers (`+919876543210`). They are stored in the international form.

## Project layout

```
server/
  src/schema.sql   tables and constraints
  src/db.ts        Postgres or PGlite, same interface
  src/money.ts     rupees -> paise without floats
  src/otp.ts       create and check one-time codes
  src/rateLimit.ts per-IP limit for the login endpoints
  src/app.ts       routes, auth middleware, validation
  src/index.ts     starts the server
  test/            API tests (node:test)
app/
  App.tsx              logged in? home : login
  src/api.ts           fetch wrapper, token storage, money formatting
  src/LoginScreen.tsx  phone, then code
  src/HomeScreen.tsx   summary card, list, repay, receipts, offline banner
  src/AddLoanSheet.tsx the add-loan form and receipt photo
```

## What I'd do next

- Partial repayments (a `payments` table instead of a single `repaid_at`)
- Reminders: a daily job that notifies you about loans due tomorrow
- Store receipts in S3 or R2 instead of the local disk
- Move the rate limiter to Redis so it works across several servers
- Refresh tokens, so you aren't logged out after 7 days
