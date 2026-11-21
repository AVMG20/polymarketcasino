# Polynux Casino

The casino app of the Polynux platform. Players hold casino-local **coins** (whole integers) and play
slots, roulette and originals. The hub (`polymarketcore`, `CORE_URL`) owns accounts, gems and stars;
`docs/platform-contract.md` is the binding contract and `docs/casino-economy.md` the binding economy.

## Stack

- Nuxt 4 SPA (`ssr: false`), Vue 3, Tailwind v4, shadcn-vue (`app/components/ui`, generated: don't
  hand-edit beyond imports), `lucide-vue-next`, `vue-sonner`.
- Fonts are self-hosted `@fontsource/*` packages imported in `app/assets/css/main.css`. The build must not
  touch the network (the Dockerfile runs `nuxt build` with `--network=none`): no Google Fonts, no CDN.
- SQLite through `bun:sqlite` + Drizzle (`server/database/schema.ts`), migrations in `drizzle/`.
- `jose` for launch tokens, h3 sealed-cookie sessions.
- **bun only** (`bun.lock`). Never npm, pnpm or yarn.

## Runtime: Bun everywhere

Dev, build, tests and production all run on Bun (`bun --bun nuxt dev`, `bun --bun nuxt build`,
`bun --bun vitest`, `bun .output/server/index.mjs`), because the database is `bun:sqlite`, which only
exists under Bun. The old site ran its dev server on Node after `bun --bun nuxt dev` leaked a TCP
connection per request there. We checked this project on Bun 1.4.0 / Nuxt 4.5.1 (2026-11-21): 300
sequential API calls, 300 sequential page loads, 600 + 2,000 parallel requests (50-64 at a time) and
20 keep-alive clients × 100 requests. The dev process never held more than one TCP socket (its
listener) and its unix sockets to the Nitro worker settled at a bounded pool (~40), then stayed flat; the
server kept answering in ~2 ms. The full production build takes ~3 s and peaks at ~1.7 GB RSS. If the
leak ever comes back, check `lsof -p <dev pid>` for growing TCP/unix sockets first, and report it with
the Bun and Nuxt versions; don't move the dev server to Node (bun:sqlite would not load).

## Layout

- `shared/`: rules and math used by both sides. `rng.ts` (CSPRNG + seeded), `money.ts`, `economy.ts`,
  `stars.ts`, `games/` (registry, dice, limbo, roulette), `slots/` (the slot engine and slot configs).
- `server/utils/`: `ledger.ts` (the only way coins move), `stars.ts`, `wallet.ts` (convert, allowance),
  `rounds.ts` (play and settle a round), `games.ts` (server half of every game), `hub.ts` (hub client),
  `launch.ts`, `session.ts`, `env.ts`.
- `server/api/`: `auth/launch`, `auth/logout`, `dev/login`, `config`, `me`, `wallet/*`,
  `games/[slug]/play`, `games`. `server/routes/healthz`. `server/plugins/hub-sync.ts` (manifest,
  heartbeat, retry sweeps). `server/middleware/`: `frame-ancestors` (CSP on pages), `same-origin`
  (refuses cross-site API writes, see below).
- `app/`: `composables/` (`useCasinoSession`, `useWallet`, `useHubBridge`, `useGameRound`,
  `useSlotSound`), `components/casino/` (shell and lobby), `components/game/` (shared game UI),
  `components/games/` (one component per game; `SlotGame.vue` plays every slot), `utils/slot-themes.ts`,
  `utils/game-components.ts`.
- `scripts/`: `migrate.ts` and `<game>-rtp.ts` balance simulations (`bun scripts/<name>.ts`). Feature buys
  are high variance: judge a buy price on 100k+ buys (the slot scripts take `[buys]` as a 4th argument).

## Adding a game

1. Rules in `shared/` (pure, take an `Rng`). A slot is a `SlotConfig` in `shared/slots/games/` plus a
   theme in `app/utils/slot-themes.ts`; no new engine code unless the mechanic is new.
2. Server half in `server/utils/games.ts`: validate options (throw `RangeError` for bad input), return
   `{ stake, payout, result, summary }`. `rounds.ts` settles it.
3. Client in `app/components/games/`, registered in `app/utils/game-components.ts`.
4. A `scripts/<game>-rtp.ts` simulation; tune until it reads right.
5. Only then add it to `GAMES` in `shared/games/registry.ts`: the lobby lists only complete games.

## Coins and the ledger

- Coins are whole integers. Payouts are `floor(bet × multiple)`.
- **Every coin change goes through `coinTransaction` in `server/utils/ledger.ts`**: one `BEGIN
  IMMEDIATE` transaction whose body is synchronous, then a star-level report for every player whose
  level moved. Never write `players.coins` anywhere else, and never `await` inside the work function.
  Other writes that belong to the same unit go through `coins.tx`.
- Coins never become gems. Only the hub creates gems; the casino only spends them (convert) at
  1 gem = 1,000 coins.
- Ledger category = the game's plain lowercase name (`'dice'`, `'spinata'`, `'convert'`, `'allowance'`).
  Returned money passes `{ refund: true }`.

## Concurrency (SQLite, one writer)

Assume every value-changing endpoint gets a burst of parallel requests.

- The mutation is the guard: `UPDATE … WHERE coins >= ? RETURNING`, `INSERT … ON CONFLICT DO NOTHING
  RETURNING` (allowance, launch jti), conditional status flips (`pending → done`). No read-then-write.
- Value-changing work runs in `writeTx`/`coinTransaction` (`BEGIN IMMEDIATE`), synchronously.
- **Never hold a transaction across a hub call.** Convert is: pending row → hub spend → settle in a
  separate guarded transaction; a stale pending row retries with the same idempotency key. A row is
  marked `failed` only when the hub's refusal proves nothing was spent (`spendNeverLanded`: a 400, or any
  4xx on the first attempt); a refused retry stays pending, because the first attempt may have landed.
- `writeTx` throws if the work returns a promise (an `async` body would commit at its first `await`).
- API writes (non-GET `/api/**`) must come from the casino's own pages: `server/middleware/same-origin.ts`
  checks `Sec-Fetch-Site` (falling back to `Origin`). SameSite=Lax alone would let any `*.avmg.nl` page
  post with the player's cookie.
- Request input is typed, not coerced: a bet is a JSON number (`'100'` is a 400), roulette amounts and
  numbers too.
- `busy_timeout` covers a second process; tests cover parallel claims, converts and bets.

## Stars

A level 0-10 from the **current** balance (`shared/stars.ts`), set at the hub with `PUT /api/v1/stars`
and `seq` = the latest ledger row id. It goes down as well as up. `players.stars_reported/stars_seq` hold
what the hub confirmed. A change that moves the level reports it before the response (so the client can
celebrate it); a level still due from a failed report retries in the background on the next balance
change, and on the next wallet read and the ten-minute sweep. Dev-login players never touch the hub.
Because `seq` is a ledger id, a casino database that starts over behind a hub that kept its data reports
`applied: false` until the new ids pass the old ones.

## Randomness

Outcomes use `cryptoRng` from `shared/rng.ts` on the server. `seededRng` is for tests and scripts only.
`Math.random()` only for cosmetics (idle reels, blur while spinning).

## Client

- `useCasinoSession()`: `player`, `coins`, `setCoins`. `useWallet()`: wallet, convert, allowance,
  star level and celebrations. `useGameRound(slug)`: `play()` then `settle()` **after** the animation and
  win reveal (it applies the balance and stars; leaving mid-round settles too). Don't refetch the
  session per round.
- `formatCoins` for every coin or gem amount; `parseAmount` (via `GameBetInput`) for amount fields
  (accepts `10k`, `2.5m`).
- Toasts are for errors and failures only. No success toasts.
- Layouts must work at phone width inside the hub iframe: no horizontal scroll (use `grid-cols-1` /
  `minmax(0,1fr)` so wide children can't widen a track), thumb-sized controls (44 px+).
- In the hub iframe (`useHubBridge().embedded`) post `wallet`, `star` (`{ game: 'casino', stars }`),
  `title` and, when the session expires, `relaunch` to `CORE_URL`.

## Code style

- `server/`, `shared/`, `scripts/`, `test/`: 4-space indent. Vue files: 2-space templates, 4-space script.
- No semicolons, single quotes, no trailing commas, 1tbs braces.

## Workflow

- `bun run typecheck` and `bun run test` must pass before any commit.
- Schema change: edit `schema.ts`, `bun run db:generate`, commit the SQL, `bun run db:migrate`.
  Never `drizzle-kit push` in a deploy path.
- Balance checks and simulations go in `scripts/`, never in tests.
- Commits only when asked; short imperative subject.
- Changing `docs/platform-contract.md` means changing the copy in `polymarketcore` too.
