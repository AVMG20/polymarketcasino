#!/bin/sh
set -e

# Apply pending migrations to $DATABASE_PATH, then serve. A failed migration
# stops the container instead of serving a broken schema.
bun scripts/migrate.ts

exec bun .output/server/index.mjs
