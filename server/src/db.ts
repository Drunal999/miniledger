import { readFile } from 'node:fs/promises'
import pg from 'pg'
import { PGlite } from '@electric-sql/pglite'

export type Db = {
  query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]>
  close(): Promise<void>
}

// DATE stays a 'YYYY-MM-DD' string (no timezone shifts); BIGINT becomes a number (paise fit easily).
const DATE = 1082
const INT8 = 20

/**
 * Real Postgres when DATABASE_URL is set; otherwise PGlite, which is Postgres compiled to
 * WebAssembly running inside Node. Same SQL either way, and zero setup for reviewers.
 * dataDir undefined = in-memory (tests); a path = persisted on disk (local dev).
 */
export async function openDb(opts: { url?: string; dataDir?: string } = {}): Promise<Db> {
  let db: Db
  if (opts.url) {
    pg.types.setTypeParser(DATE, (v) => v)
    pg.types.setTypeParser(INT8, (v) => Number(v))
    const pool = new pg.Pool({ connectionString: opts.url })
    db = {
      query: async (sql, params) => (await pool.query(sql, params)).rows,
      close: () => pool.end(),
    }
  } else {
    const lite = new PGlite(opts.dataDir)
    const parsers = { [DATE]: (v: string) => v, [INT8]: (v: string) => Number(v) }
    db = {
      query: async (sql, params) => (await lite.query(sql, params, { parsers })).rows as never,
      close: () => lite.close(),
    }
  }
  const schema = await readFile(new URL('./schema.sql', import.meta.url), 'utf8')
  // Strip "-- comments" first, so a semicolon inside a comment can't split a statement in half.
  const statements = schema.replace(/--.*$/gm, '').split(';').map((s) => s.trim()).filter(Boolean)
  for (const stmt of statements) await db.query(stmt)
  return db
}
