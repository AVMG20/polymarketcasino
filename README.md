# Polynux Casino

The casino app of the Polynux platform: slots, roulette and originals on a play-money coin balance.
It plugs into the hub (`polymarketcore`) through `docs/platform-contract.md`: players arrive with a
launch token, gems are spent at the hub to buy coins, and the star level is reported back.

Stack: Nuxt 4 (SPA) on Bun, SQLite through `bun:sqlite` + Drizzle, Tailwind v4, shadcn-vue.

## Setup

```sh
bun install
cp .env.example .env          # then set NUXT_SESSION_PASSWORD to 32+ random characters
bun run db:migrate            # creates ./data/casino.sqlite
bun run dev                   # http://localhost:3200
```

| | |
|---|---|
| Casino | `http://localhost:3200` |
| Hub | `http://localhost:3100` (`CORE_URL`) |
| Database | `./data/casino.sqlite` (`DATABASE_PATH`), WAL mode |
| Health | `GET /healthz` |

## Playing without the hub

With `PNX_DEV_LOGIN=true` (never in production) a signed-out visitor gets a sign-in screen with a dev
login, or go straight to `http://localhost:3200/api/dev/login?name=Alice`. Dev players are local only: no
gems, no convert, no star reports. They still get the daily allowance (2,500 coins).

## Connecting to the hub

1. Run the hub on port 3100 and seed it (`bun run db:seed` there). The seed registers app `casino` with
   key `pnx_dev_casino_key_change_me`, the default `PNX_APP_KEY` here.
2. Start the casino. On boot it pushes its manifest (`PUT /api/v1/manifest`); the log says
   `[hub] manifest accepted`. If the hub is down it retries every minute and the casino keeps working.
3. Open `http://localhost:3100/play/casino` (signed in at the hub): the hub frames the casino with a
   launch token. Visiting `http://localhost:3200` directly without a session redirects through
   `{CORE_URL}/connect`.

## Commands

| | |
|---|---|
| `bun run dev` | Dev server on Bun, port 3200 |
| `bun run build` | Production build (`.output/`) |
| `bun run start` | Serve the build |
| `bun run typecheck` | vue-tsc over app, server, shared, tests and scripts |
| `bun run test` | vitest under Bun (each test file gets its own temporary SQLite file) |
| `bun run db:generate` | New migration from `server/database/schema.ts` |
| `bun run db:migrate` | Apply migrations to `DATABASE_PATH` |
| `bun scripts/<game>-rtp.ts [rounds] [bet] [seed]` | RTP, hit rate and max win for one game |

## Production

`docker build -t pnx-casino .` gives a Bun image that listens on `HOST=0.0.0.0`, `PORT=3000`, keeps the
database at `/data/casino.sqlite` (mount a volume on `/data`) and runs migrations on every start. Only
`bun install` reaches the network; `nuxt build` runs with `--network=none` (fonts are self-hosted).
With `NODE_ENV=production` (set by the image) the dev login is off whatever `PNX_DEV_LOGIN` says, the
session cookie is always `Secure`, and the `.env.example` session password is refused. Set
`CORE_URL=https://core.avmg.nl`, `PNX_APP_ID`, `PNX_APP_KEY` (the key of the casino entry in the hub's `BOOTSTRAP_APPS`), `NUXT_SESSION_PASSWORD`,
`PNX_COOKIE_SAMESITE=lax`, `PNX_DEV_LOGIN=false` and `PUBLIC_URL`. See `.env.example`.

## Docs

- `docs/platform-contract.md`: the contract with the hub (shared with `polymarketcore`).
- `docs/casino-economy.md`: coins, convert, allowance, star levels.
- `docs/design.md`: theme and UI stack.
- `docs/frontend-handoff.md`: composables, API shapes and what the front-end pass builds.
- `CLAUDE.md`: architecture and conventions.
