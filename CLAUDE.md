# Polynux Casino

The casino app of the Polynux platform. Players hold casino-local **coins** (up to four decimals) and play
slots, roulette, originals and multiplayer live tables (blackjack, baccarat, casino hold'em, three card poker). The hub (`polymarketcore`, `CORE_URL`) owns accounts, gems and stars;
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
  `stars.ts`, `games/` (registry, dice, limbo, roulette), `slots/` (one rules module per slot),
  `tables/` (cards and shoe, chips and limits, the socket protocol, one rules file per live table).
- `server/utils/`: `ledger.ts` (the only way coins move), `stars.ts`, `wallet.ts` (convert, allowance),
  `rounds.ts` (play and settle a round), `games.ts` (server half of every game), `hub.ts` (hub client),
  `launch.ts`, `session.ts`, `env.ts`, `tables/` (the live tables: `table.ts` base, `escrow.ts`,
  `socket.ts`, one file per game, `index.ts` registry).
- `server/api/`: `auth/launch`, `auth/logout`, `dev/login`, `config`, `me`, `wallet/*`,
  `games/[slug]/play`, `games`, `tables/[slug]/ws` (WebSocket). `server/routes/healthz`.
  `server/plugins/hub-sync.ts` (manifest, heartbeat, retry sweeps), `server/plugins/tables.ts` (escrow
  refunds at boot, shutdown and every five minutes). `server/middleware/`: `frame-ancestors` (CSP on pages), `same-origin`
  (refuses cross-site API writes, see below).
- `app/`: `composables/` (`useCasinoSession`, `useWallet`, `useHubBridge`, `useGameRound`,
  `useSlotSound`, `useLiveTable`, `useTableSound`), `components/casino/` (shell and lobby),
  `components/game/` (shared game UI), `components/table/` (felt, seats, cards, chips for live tables),
  `components/games/` (one component per game; ported slots sit on the old site's slot shell in
  `components/slots/` + `useSlotGame`, see `docs/slot-porting.md`), `utils/slots/` (slot art, synths,
  control-bar themes), `utils/game-components.ts`.
- `scripts/`: `migrate.ts` and `<game>-rtp.ts` balance simulations (`bun scripts/<name>.ts`). Feature buys
  are high variance: judge a buy price on 100k+ buys (the slot scripts take `[buys]` as a 4th argument).

## Adding a game

1. Rules in `shared/` (pure, take an `Rng`). A slot is its own module in `shared/slots/<game>/`, ported
   from the old site (`docs/slot-porting.md`).
2. Server half in `server/utils/games.ts`: validate options (throw `RangeError` for bad input), return
   `{ stake, payout, result, summary }`. `rounds.ts` settles it.
3. Client in `app/components/games/`, registered in `app/utils/game-components.ts`.
4. A `scripts/<game>-rtp.ts` simulation; tune until it reads right.
5. Only then add it to `GAMES` in `shared/games/registry.ts`: the lobby lists only complete games.

A live table instead subclasses `LiveTable` in `server/utils/tables/`, registers in `tables/index.ts`, and
is listed with `live: true` (no `games.ts` entry, no play endpoint).

## Live tables

Multiplayer tables over WebSockets (`nitro.experimental.websocket`), one in-memory instance per game
(the app runs as one process). See `server/utils/tables/table.ts`.

- **Socket auth** happens in the upgrade hook (`authorizeTableUpgrade`): `Origin` must equal
  `PUBLIC_URL` exactly (else 403), the URL must name a table (else 404), and the `pnx_casino` cookie must
  unseal to an existing player (`playerIdFromCookieHeader`, else 401). Names and avatars come from the
  `players` row (the launch token's `name`/`image`).
- **Money**: chips on the layout are table state only; they are escrowed when betting closes, and
  doubles, splits, insurance, play and call bets when taken. A stake is a debit plus an `open`
  `table_wagers` row in one transaction; settling flips the round's rows `open → settled` and credits
  the payout in one transaction (a partial claim refunds instead); refunds flip `open → refunded` and
  credit with `{ refund: true }`. The flip is the guard. Tables never call the ledger directly: they go
  through `stake()` / `settle()` / `refund()` on the base, which use `escrow.ts`.
- Tables use `commitCoins` (same transaction as `coinTransaction`, star report in the background), so
  the whole table is synchronous: a socket message or a timer runs start to finish without awaiting,
  and messages can't interleave. Balances and star changes are pushed to the player's sockets.
- A player who disconnects keeps their seat while money is on the round; the clocks act for them
  (stand, fold) and the hand settles. Restart: the boot sweep refunds every `open` row; shutdown
  refunds open hands; a five-minute sweep refunds open rows older than 30 minutes no table holds.
- Snapshots are per viewer (`seatGame`): hole cards of other seats and the dealer stay redacted until
  the showdown. Shuffles use `Shoe` from `shared/tables/cards.ts` with `cryptoRng`.

## Coins and the ledger

- Coins carry up to four decimals. The database stores **units of 1/10,000 coin** as integers: every
  coin column in `schema.ts` is a `coins()` column that converts on the way in and out, so code reads and
  writes coins. Raw `sql` fragments are not converted: bind `toUnits(x)` yourself (as `ledger.ts` does),
  and read sums back with `fromUnits`. The schema imports `shared/money.ts`, so the runtime image copies
  that file for the migrator; keep it free of imports.
- Money math goes through `#shared/money`: `payFor(bet, multiple)` (rounded down to 0.0001),
  `costFor(bet, cost)` (feature prices, rounded up), `roundCoins` (a summed coin total, rounded down),
  `sumCoins` / `sameCoins` / `normalizeCoins` (add and compare without float noise: 0.1 + 0.2),
  `isCoinAmount` (validates input: at most four decimals). Never `Math.floor(bet * x)`.
- Bets are 10 to 1,000,000 coins with at most four decimals (live tables: their chip minimum).
- **Every coin change goes through `coinTransaction` in `server/utils/ledger.ts`**: one `BEGIN
  IMMEDIATE` transaction whose body is synchronous, then a star-level report for every player whose
  level moved (`commitCoins` is the same unit with the star report returned as a promise; the live
  tables use it). Never write `players.coins` anywhere else, and never `await` inside the work function.
  Other writes that belong to the same unit go through `coins.tx`.
- Coins never become gems. Only the hub creates gems; the casino only spends them (convert) at
  1 gem = 1,000 coins.
- Ledger category = the game's plain lowercase name (`'dice'`, `'spinata'`, `'convert'`, `'allowance'`);
  the live tables use their slug (`'blackjack'`, `'baccarat'`, `'casino-holdem'`, `'three-card-poker'`).
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
- Numbers are Dutch (nl-NL). `formatCoins(value)` for every coin or gem amount in the casino's own UI:
  whole coins with `.` thousands (`2.137`), up to two decimals only under 10 coins (`2,5`), never
  rounded up; put `formatCoinsExact(value)` (`2.137,5`) in a `title`. `formatCoins(value, true)` is the
  compact form for chips (`25K`). Ported games keep the old site's `formatNumber` (`2,14K`).
- `parseAmount` (via `GameBetInput` / `useAmountInput`) for amount fields, Dutch first: `2.137` is
  2137, `2,5` is 2.5, `2,137.5` is 2137.5, plus `10k` / `2,5m`. The rules are on `parseAmount`.
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
