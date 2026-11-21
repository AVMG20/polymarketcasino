// Nitro auto-imports createError at runtime; vitest does not.
import { mkdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { createError } from 'h3'
import { afterAll } from 'vitest'

Object.assign(globalThis, { createError })

// A fresh SQLite file per test file, migrated from drizzle/ like production.
const dir = join(tmpdir(), 'pnxcasino-tests')
mkdirSync(dir, { recursive: true })
process.env.DATABASE_PATH = join(dir, `${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}.sqlite`)
process.env.CORE_URL = 'http://hub.test'
process.env.PNX_APP_ID = 'casino'
process.env.PNX_APP_KEY = 'test-key'
process.env.NUXT_SESSION_PASSWORD = 'test-session-password-that-is-long-enough'

const { migrate } = await import('drizzle-orm/bun-sqlite/migrator')
const { db, sqlite } = await import('../../server/database')
migrate(db, { migrationsFolder: resolve(import.meta.dirname, '../../drizzle') })

// The file is only this test file's scratch space.
afterAll(() => {
    sqlite.close()
    for (const suffix of ['', '-wal', '-shm']) rmSync(`${process.env.DATABASE_PATH}${suffix}`, { force: true })
})
