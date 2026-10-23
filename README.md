# MiniLedger

[![CI](https://github.com/Drunal999/miniledger/actions/workflows/ci.yml/badge.svg)](https://github.com/Drunal999/miniledger/actions/workflows/ci.yml)

Track money you've lent to friends: who owes you, how much, and who's late.

- **API:** Node.js, TypeScript, Hono, Zod, PostgreSQL
- **App:** React Native (Expo)
- **Demo video:** [watch on Google Drive](https://drive.google.com/file/d/1RxoO5HP1OjOX1vNcbpk97iYnW2uLog2U/view?usp=drivesdk)

<p>
  <img src="docs/screenshots/home.jpg" width="230" alt="Home: what you'll get back, status pills, a part-paid loan with a progress bar">
  <img src="docs/screenshots/friends.jpg" width="230" alt="Friends: who owes you the most, with overdue counts and settled friends">
  <img src="docs/screenshots/add-loan.jpg" width="230" alt="Add a loan: recent friends, rupee amount, due-date presets, receipt photo">
</p>

## Run it

You need Node 24 (it runs TypeScript directly, no build step).

**1. API**

```bash
cd server
npm install
npm run dev
```

Want to see a full app straight away? Before starting the API, run `npm run seed -- 9999999999`. It fills that number's account with five sample loans: overdue, due soon, due later and repaid. Then log in with that number.

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
npm test        # 17 tests, about 25 seconds
npm run typecheck
```

CI runs the same tests on every push, once on PGlite and once on a real Postgres 17.

## What it does

- Log in with your phone number and a one-time code. The code submits itself when the 6th digit is typed, and "Resend" counts down from 30 seconds to match the server's rule
- Add a loan: friend's name, amount, the day you lent it (defaults to today, can be backdated), due date, and optionally a photo of the receipt. The date pickers won't let you lend in the future or set a due date before the lent date, and the server checks the same rules
  - your recent friends appear as one-tap buttons
  - the amount shows back as you type it ("₹1,500.50")
  - due date presets: 1 week, 2 weeks, 1 month
- See every loan with a short status pill: "12 days late" in red, "Due in 2 days" in amber, "Upcoming", "Repaid"
- **Money often comes back in parts.** Record "got ₹500 back" on a loan and it shows what's left, with a progress bar. Paying more than what's pending is refused
- Tap a loan for its **details**:
  - what's pending;
  - when it was lent and when it's due;
  - the receipt (view it, or add one later);
  - the full **payment history**, with undo for the last payment;
  - delete, with a confirmation
- Mark a loan as fully repaid in one tap (with a small vibration), and **undo** it for 5 seconds
- **Friends** tab: one line per person with what they owe you in total, how many loans, and how many are late. Biggest first. Tap a friend to see just their loans
- **Search** by name, and filter: all, overdue, repaid
- A "You'll get back" card at the top: still to get back, total lent, received, overdue, and how much has come back so far
- **Remind on WhatsApp** opens WhatsApp with a polite message ready to send, including what's still pending. Save your **UPI ID** in your profile and the reminder tells your friend where to pay. You pick the chat, so the app never needs your friend's number
- **Face ID lock**, like a banking app: turn it on in your profile. It asks when you open the app, and again if you were away for more than a minute

Every button has an accessibility label, so the app works with VoiceOver and TalkBack.

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

**Payments are a ledger.** Each repayment is its own row in a `payments` table, and each loan keeps a running `paid_paise` total. Nothing is overwritten, so the history is always there, and undo just removes the last row.

**You can't pay more than is owed, even with two taps at the same moment.** Recording a payment is a single SQL statement. It adds to the running total and writes the history row together, and its `WHERE paid_paise + amount <= amount_paise` refuses anything above what's pending. Postgres locks the row while it updates, so a second payment that arrives at the same instant re-checks against the new total and is refused. There's a test that fires two payments at once, and CI runs it on real Postgres.

**Repaying twice is safe.** "Mark repaid" pays whatever is left. If nothing is left, it changes nothing and keeps the original repaid time, so a double tap or a retried request can't rewrite history.

**Validation lives at the edge.** Zod checks every request body and returns the first readable message ("Amount must be more than 0, with at most 2 decimals"), which the app shows as is. The database has `CHECK` constraints as a second line of defence.

**Receipts.** JPEG, PNG or WebP up to 5 MB, stored with a random file name, and only served back to the loan's owner. The server decides the type from the file's first bytes, not from what the client says, so a script renamed to `receipt.png` is rejected.

**Other hardening.**
- Login endpoints are rate-limited per IP: 10 code requests and 30 attempts per 10 minutes. That's on top of the per-phone limits.
- Every response gets security headers (`nosniff`, frame protection and others).
- Request bodies over 6 MB are refused before they're read.
- The server refuses to start in production without a real `JWT_SECRET`.

## API

All `/loans` and `/me` routes need `Authorization: Bearer <token>`.

| Method | Path | Body | Returns |
|---|---|---|---|
| POST | `/auth/otp` | `{ phone }` | Prints the code to the server log |
| POST | `/auth/verify` | `{ phone, code }` | `{ token }` (valid 7 days) |
| GET | `/loans` | | `{ today, loans: [...] }`, each with `status`: `due`, `overdue` or `repaid` |
| POST | `/loans` | `{ friendName, amount: "1500.50", lentOn?: "2026-10-01", dueDate: "2026-11-01" }` | `{ loan }`. `lentOn` defaults to today, or to the due date for an old loan |
| GET | `/loans/:id` | | `{ loan, payments }` (history, newest first) |
| POST | `/loans/:id/payments` | `{ amount: "500" }` | `{ loan }`, or 400 if it's more than what's pending |
| PATCH | `/loans/:id/repay` | | `{ loan }` (pays whatever is left) |
| DELETE | `/loans/:id/payments/last` | | `{ loan }` (undo the last payment) |
| DELETE | `/loans/:id` | | 204 (payments and receipt file go too) |
| GET | `/loans/summary` | | `{ totalLentPaise, totalRepaidPaise, overduePaise, overdueCount }` (overdue counts only what's still pending) |
| GET / PATCH | `/me` | `{ upiId: "name@bank" }` | `{ phone, upiId }` |
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
  src/seed.ts      sample data for a demo account
  test/            API tests (node:test)
app/
  App.tsx                 logged in? home : login, plus the Face ID lock
  src/api.ts              fetch wrapper, secure storage, receipt upload
  src/format.ts           money, dates, status pills, the reminder message
  src/ui.tsx              shared Avatar, Pill, ProgressBar, Button
  src/LoginScreen.tsx     phone, then code
  src/HomeScreen.tsx      summary card, Loans/Friends tabs, search, undo
  src/LoanRow.tsx         one loan in the list
  src/LoanDetailSheet.tsx details, part payments, history, delete
  src/FriendsList.tsx     loans grouped by friend
  src/ProfileSheet.tsx    UPI ID, Face ID lock, log out
  src/AddLoanSheet.tsx    the add-loan form and receipt photo
```

## What I'd do next

- A notification on the due date (local notifications), and a daily digest
- Dark mode
- A UPI payment link in the reminder, once UPI apps can open it from WhatsApp reliably
- Store receipts in S3 or R2 instead of the local disk
- Move the rate limiter to Redis so it works across several servers
- Refresh tokens, so you aren't logged out after 7 days
