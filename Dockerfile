# Bun for build and runtime (see CLAUDE.md, "Runtime").
FROM oven/bun:1.4-alpine AS build
WORKDIR /app

COPY package.json bun.lock ./
# --ignore-scripts skips the postinstall `nuxt prepare`; `nuxt build` redoes it.
RUN bun install --frozen-lockfile --ignore-scripts

COPY . .
# No network past the install: fonts are self-hosted (@fontsource), so a build
# that tries to fetch anything fails here instead of depending on it.
RUN --network=none bun --bun nuxt build


FROM oven/bun:1.4-alpine
WORKDIR /app

# Migrations run at container start against the mounted database, so the
# runtime image keeps the migrator: drizzle-orm (the locked version from the
# build stage; it has no dependencies), the schema, the coin-unit helpers the
# schema imports (shared/money.ts has no imports of its own) and the SQL files.
COPY --from=build /app/node_modules/drizzle-orm ./node_modules/drizzle-orm
COPY --from=build /app/.output ./.output
COPY drizzle ./drizzle
COPY server/database ./server/database
COPY shared/money.ts ./shared/money.ts
COPY scripts/migrate.ts ./scripts/migrate.ts
COPY --chmod=755 docker-entrypoint.sh ./

ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=3000 \
    DATABASE_PATH=/data/casino.sqlite \
    MIGRATIONS_PATH=/app/drizzle

RUN mkdir -p /data && chown bun:bun /data
VOLUME /data
EXPOSE 3000
USER bun

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s CMD wget -qO- "http://127.0.0.1:${PORT}/healthz" || exit 1

ENTRYPOINT ["/app/docker-entrypoint.sh"]
