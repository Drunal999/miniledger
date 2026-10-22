import { mkdir } from 'node:fs/promises'
import { serve } from '@hono/node-server'
import { openDb } from './db.ts'
import { createApp } from './app.ts'

const port = Number(process.env.PORT ?? 4000)
const jwtSecret = process.env.JWT_SECRET ?? 'dev-only-secret-change-me'
if (!process.env.JWT_SECRET) {
  // Anyone who knows the default secret could forge login tokens, so never run production with it.
  if (process.env.NODE_ENV === 'production') throw new Error('JWT_SECRET must be set in production')
  console.warn('JWT_SECRET not set: using a dev-only secret')
}

await mkdir('./.data', { recursive: true })
const db = await openDb({ url: process.env.DATABASE_URL, dataDir: process.env.DATABASE_URL ? undefined : './.data/pg' })
const app = createApp({ db, jwtSecret, uploadsDir: './.data/uploads' })

// 0.0.0.0 so the phone (Expo Go) on the same Wi-Fi can reach it.
serve({ fetch: app.fetch, port, hostname: '0.0.0.0' }, () => {
  console.log(`MiniLedger API on http://localhost:${port} (${process.env.DATABASE_URL ? 'Postgres' : 'PGlite'})`)
})
