import { resolve } from 'node:path'
import { defineConfig } from 'vitest/config'

// Runs under Bun (`bun --bun vitest run`): the database layer uses bun:sqlite.
export default defineConfig({
    test: {
        include: ['test/**/*.spec.ts'],
        setupFiles: ['test/setup/env.ts'],
        // Every file gets its own SQLite file (see setup), so files can run in parallel.
        pool: 'forks',
        server: { deps: { external: [/^bun:/] } }
    },
    resolve: {
        alias: {
            '#shared': resolve(import.meta.dirname, 'shared'),
            '#server': resolve(import.meta.dirname, 'server')
        }
    }
})
