import { mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { Database } from 'bun:sqlite'
import { drizzle } from 'drizzle-orm/bun-sqlite'
import * as schema from './schema'

/**
 * One SQLite file, one connection per process. bun:sqlite is synchronous, and
 * so are Drizzle transactions on it: a transaction body never awaits, which is
 * what keeps a hub call (or any other await) from ever running while a write
 * lock is held.
 */

export const DATABASE_PATH = resolve(process.env.DATABASE_PATH || './data/casino.sqlite')

function open() {
    mkdirSync(dirname(DATABASE_PATH), { recursive: true })
    const sqlite = new Database(DATABASE_PATH, { create: true, strict: true })
    sqlite.exec('PRAGMA journal_mode = WAL')
    // Another process holding the write lock (a second instance, a migration)
    // makes us wait this long before SQLITE_BUSY.
    sqlite.exec('PRAGMA busy_timeout = 5000')
    sqlite.exec('PRAGMA foreign_keys = ON')
    sqlite.exec('PRAGMA synchronous = NORMAL')
    return sqlite
}

export const sqlite = open()
export const db = drizzle({ client: sqlite, schema })

export type Db = typeof db
export type Tx = Parameters<Parameters<Db['transaction']>[0]>[0]
/** The connection or an open transaction. Inside a transaction, pass `tx`. */
export type DbExecutor = Db | Tx

/**
 * Run a value-changing unit of work as `BEGIN IMMEDIATE`: the write lock is
 * taken up front, so two processes can't both read and then both write. The
 * body must be synchronous (no awaits); conditional updates inside it are
 * still the guard.
 */
export function writeTx<T>(work: (tx: Tx) => T): T {
    return db.transaction((tx) => {
        const result = work(tx)
        // An async body would commit at its first await and run the rest
        // outside the transaction: refuse it, which rolls back what it did.
        if (result && typeof (result as { then?: unknown }).then === 'function') {
            throw new TypeError('writeTx work must be synchronous')
        }
        return result
    }, { behavior: 'immediate' })
}
