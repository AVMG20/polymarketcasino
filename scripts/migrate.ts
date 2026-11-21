// Applies drizzle/ migrations to DATABASE_PATH. Run with `bun run db:migrate`;
// the Docker entrypoint runs it before the server starts.
import { resolve } from 'node:path'
import { migrate } from 'drizzle-orm/bun-sqlite/migrator'
import { db, DATABASE_PATH } from '../server/database'

migrate(db, { migrationsFolder: resolve(process.env.MIGRATIONS_PATH || './drizzle') })
console.log(`[migrate] ${DATABASE_PATH} is up to date`)
