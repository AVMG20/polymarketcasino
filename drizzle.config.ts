import { defineConfig } from 'drizzle-kit'

// Only `drizzle-kit generate` uses this; migrations are applied by
// scripts/migrate.ts through bun:sqlite.
export default defineConfig({
    out: './drizzle',
    schema: './server/database/schema.ts',
    dialect: 'sqlite',
    dbCredentials: {
        url: process.env.DATABASE_PATH || './data/casino.sqlite'
    }
})
