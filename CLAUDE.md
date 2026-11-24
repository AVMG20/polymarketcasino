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
  `tables/` (cards and shoe, chips and limits, the socket protocol, one rules file per live table),
  `floor/` (the My Casino floor plan and walk grid: the client draws it, the floor socket checks moves on it),
  `tycoon.ts` (My Casino: catalog, economy numbers, pure helpers and the API shapes), `visitors.ts` (guest tiers, the
  per-tick visitor model, house rules, history shapes).
- `server/utils/`: `ledger.ts` (the only way coins move), `stars.ts`, `wallet.ts` (convert, wallet state),
  `rounds.ts` (play and settle a round), `games.ts` (server half of every game), `steps.ts` (multi-step
  rounds: start, move, cash out, abandoned-round sweep), `hub.ts` (hub client),
  `launch.ts`, `session.ts`, `env.ts`, `tables/` (the live tables: `table.ts` base, `escrow.ts`,
  `socket.ts`, one file per game, `index.ts` registry), `chips.ts` (the only way chips move),
  `tycoon.ts` (casino profile, constructions, cage, build, campaigns, house rules, history), `tycoon-gems.ts` (gem purchases),
  `floor-presence.ts` (live floor rooms, pure) + `floor-socket.ts` (its upgrade auth, DB source and the
  process's rooms), `socket-auth.ts` (Origin + session checks every socket shares), `rate-limit.ts`.
- `server/api/`: `auth/launch`, `auth/logout`, `dev/login`, `config`, `me`, `wallet/*`,
  `games/[slug]/play`, `games/[slug]/{start,act,cashout,round}` (multi-step games), `games`, `tables` (occupancy), `tables/[slug]/ws` (WebSocket), `floor/[casinoId]/ws` (who walks
  around a casino floor: positions and looks, no money, no writes), `tycoon`
  (state), `tycoon/collect`, `tycoon/build`, `tycoon/campaign`, `tycoon/gems`, `tycoon/rules`, `tycoon/history`. `server/routes/healthz`.
  `server/plugins/hub-sync.ts` (manifest, heartbeat, retry sweeps), `server/plugins/tables.ts` (escrow
  refunds at boot, shutdown and every five minutes), `server/plugins/step-rounds.ts` (settles multi-step
  rounds idle for a day). `server/middleware/`: `frame-ancestors` (CSP on pages), `same-origin`
  (refuses cross-site API writes, see below).
- `app/`: `composables/` (`useCasinoSession`, `useWallet`, `useHubBridge`, `useGameRound`,
  `useSlotSound`, `useLiveTable`, `useTableSound`, `useFloorPresence`: the floor socket, feeding
  CasinoFloor's `remotes` and sending its `move`s), `components/casino/` (shell and lobby),
  `components/game/` (shared game UI), `components/live-table/` (the live tables: shell, stage, seats/plates, phase ring, chip rack, bet bar; `components/table/` keeps Avatar, Bankroll, Feed),
  `components/games/` (one component per game; ported slots sit on the old site's slot shell in
  `components/slots/` + `useSlotGame`, see `docs/slot-porting.md`), `utils/slots/` (slot art, synths,
  control-bar themes), `utils/game-components.ts`, `components/tycoon/` + `utils/floor/` (the My Casino
  floor; `utils/floor/types.ts` is its contract).
- `scripts/`: `migrate.ts`, `tycoon-sim.ts` (My Casino pace) and `<game>-rtp.ts` balance simulations (`bun scripts/<name>.ts`). Feature buys
  are high variance: judge a buy price on 100k+ buys (the slot scripts take `[buys]` as a 4th argument).

## Adding a game

1. Rules in `shared/` (pure, take an `Rng`). A slot is its own module in `shared/slots/<game>/`, ported
   from the old site (`docs/slot-porting.md`).
2. Server half in `server/utils/games.ts`: validate options (throw `RangeError` for bad input), return
   `{ stake, payout, result, summary }`. `rounds.ts` settles it.
3. Client in `app/components/games/`, registered in `app/utils/game-components.ts`.
4. A `scripts/<game>-rtp.ts` simulation; tune until it reads right.
5. Only then add it to `GAMES` in `shared/games/registry.ts`: the lobby lists only complete games. Give
   it a place in `TYCOON_GAMES` (`shared/tycoon.ts`) too: a game nobody can build can't be played.

A live table instead subclasses `LiveTable` in `server/utils/tables/`, registers in `tables/index.ts`, and
is listed with `live: true` (no `games.ts` entry, no play endpoint).

A multi-step game (Gem Dig, Card Climb: start, moves, cash out) instead implements `StepGame` in
`shared/games/` (a pure state machine; secrets stay in the state, `view()` hides them until the round ends),
registers in `STEP_GAMES` in `server/utils/steps.ts` and is listed with `steps: true` (no `games.ts` entry,
no play endpoint). The client uses `useStepRound(slug)`. Its cash-out must return the RTP at every point (no
strategy beats the edge) and a round with no progress can't be cashed out (it would be a free refund).

## Live tables

Multiplayer tables over WebSockets (`nitro.experimental.websocket`), one in-memory instance per game
(the app runs as one process). See `server/utils/tables/table.ts`.

- **Socket auth** happens in the upgrade hook (`authorizeTableUpgrade`): `Origin` must equal
  `PUBLIC_URL` exactly (else 403), the URL must name a table (else 404), and the `pnx_casino` cookie must
  unseal to an existing player (`playerIdFromCookieHeader`, else 401). Names and avatars come from the
  `players` row (the launch token's `name`/`image`).
- **Money**: chips on the layout are table state only; they are escrowed when betting closes, and
  doubles, splits, insurance, play and call bets when taken. A stake is a split debit (coins first, then
  chips: `coins.stake`) plus an `open` `table_wagers` row with its chip part (`amount_chips`) in one
  transaction; settling flips the round's rows `open → settled` and credits the payout **in chips** in one
  transaction (a partial claim refunds instead); refunds flip `open → refunded` and hand each part back in
  its own currency (coins with `{ refund: true }`, chips as `refund:<slug>`). The flip is the guard. Tables never call the ledger directly: they go
  through `stake()` / `settle()` / `refund()` on the base, which use `escrow.ts`.
- Tables use `commitCoins` (same transaction as `coinTransaction`, star report in the background), so
  the whole table is synchronous: a socket message or a timer runs start to finish without awaiting,
  and messages can't interleave. Balances (`{ t: 'balance', balance: coins, chips }`) and star changes are
  pushed to the player's sockets.
- A player who disconnects keeps their seat while money is on the round; the clocks act for them
  (stand, fold) and the hand settles. Restart: the boot sweep refunds every `open` row; shutdown
  refunds open hands; a five-minute sweep refunds open rows older than 30 minutes no table holds.
- Snapshots are per viewer (`seatGame`): hole cards of other seats and the dealer stay redacted until
  the showdown. Shuffles use `Shoe` from `shared/tables/cards.ts` with `cryptoRng`.

## My Casino

The home page is the player's own casino floor (`docs/casino-economy.md`, "My Casino"). It starts with
the backroom (Pegfall, Spiñata); everything else is built with **chips**, and a game must be built to play it
(403) or to sit at its live table (watching stays open).

- Economy v2, "claim coins, win chips": coins come only from the cashier cage (guest income,
  **coins**, collected at the cage) and gem converts; every payout is **chips** (solo and live). Chips build
  (zones, games, levels, upgrades, ad campaigns) and can be bet; they never turn back into coins. Gems never
  buy chips (chips set the star level).
- Every stake is paid coins first, then chips for the rest (`splitStake` in `shared/tycoon.ts`;
  `coins.stake(...)` on the server, two guarded debits). There is no currency choice: the play endpoint
  ignores a `funding` field. `game_rounds.stake_chips` / `table_wagers.amount_chips` hold the chip part.
- Chips move only through `creditChips` / `debitChips` (`server/utils/chips.ts`), and only inside a
  `coinTransaction` / `commitCoins` unit (`coins.creditChips`, `coins.debitChips`, or the raw functions on
  `coins.tx`): the unit watches chip moves to report stars, and a chip move outside one throws. Each
  writes a `chip_transactions` row. Never write `casino_profiles.chips` elsewhere.
- The profile is created lazily (insert … on conflict do nothing). Every read and action starts with
  `advanceCasino(tx, …)`: it deletes finished constructions (`… RETURNING` is the guard) and applies
  them, accruing the cage at the old rate up to each one. The cage is `cage_stored` coins at `cage_at`
  plus guest income since; collect is a compare-and-set on `cage_at` and credits coins (`'cage'`).
- Guest income is the visitor model in `shared/visitors.ts`: every 15-minute tick guests arrive (crowd from
  the seats, prestige, Marketing, Hospitality, the guests ads, a random hour/day mood), roll a tier (Tourist,
  Regular, High Roller, Whale; richer with prestige: Decor, Hospitality, rooms, top machine levels, wealth ads;
  Whales stay 1-3 hours) and take seats; the luck is a pure function of (state, player seed, tick), so
  `runFloor` is reproducible and additive. The seed is the player id salted with a server-only secret
  (`luckSeed`, `PNX_LUCK_SALT`): never send it to the client. Prices, rewards and previews (`campaignGain`) read
  `expectedPerHour` / the full floor, never a lucky tick. Anything that changes the rate (a build finishing, a
  rush, a campaign, a house rule) must `accrueCage` up to that moment first; `runFloor` splits at rush and
  campaign ends itself. Persisted accruals write `casino_history` (hour by hour) when the casino is saved
  (`flushHistory`).
- An idle floor is never full; each guests ad adds its own share of the seats (several kinds run at once,
  `casino_profiles.campaigns`, one per kind), so only all of them fill it; wealth ads raise prestige and Whales. House rules (door, VIP; `POST /api/tycoon/rules`) unlock with the Lounge and High Limit Room
  (locked: 403), change once per ten minutes (guarded on `rules_at`: 429), and only the owner's reads carry
  `house`. Every rule and ad must lose in some realistic situation, and no build step may lower expected
  income under any rules and ads (tested).
- Gem purchases (`server/utils/tycoon-gems.ts`: skip, rush, builder, golden) follow the convert flow:
  pending row (checked and priced in the same transaction; one pending per player, item and target) → hub
  spend → guarded settle that delivers. Retried by the hub-sync sweep.
- A rush is priced from the best full floor (`rushGems`: every seat taken under the richest rules and every
  wealth ad the casino can run, for its four hours, × 1.25 at the convert rate), never from the occupancy,
  rules or ads at purchase: a rush must never be a cheaper way to coins than converting (tested).
- Tune numbers in `shared/tycoon.ts` (`CHIP_SCALE`, `GUEST_SCALE`, the catalog, campaign `costHours`),
  `shared/visitors.ts` (tier spends, `VISITOR_MODEL`) and the star thresholds in `shared/stars.ts` with
  `bun scripts/tycoon-sim.ts [days] [seed] [days after max]` (pace, stars, campaign net, rules by stage, luck)
  and update the tables in the economy doc.

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
- Bets are 10 to 1,000,000 with at most four decimals (live tables: their table-chip minimum), paid coins
  first, then chips; payouts are chips.
- **Every coin change goes through `coinTransaction` in `server/utils/ledger.ts`**: one `BEGIN
  IMMEDIATE` transaction whose body is synchronous, then a star-level report for every player whose
  chip level moved (`commitCoins` is the same unit with the star report returned as a promise; the live
  tables use it). Chips move in the same unit. Never write `players.coins` anywhere else, and never `await` inside the work function.
  Other writes that belong to the same unit go through `coins.tx`.
- Coins never become gems. Only the hub creates gems; the casino only spends them (convert) at
  1 gem = 1,000 coins.
- Ledger category = the game's plain lowercase name (`'dice'`, `'spinata'`, `'convert'`, `'cage'` (old rows: `'allowance'`),
  `'cage'`); the live tables use their slug (`'blackjack'`, `'baccarat'`, `'casino-holdem'`,
  `'three-card-poker'`). Returned money passes `{ refund: true }`. Chip reasons: `bet:<slug>`,
  `win:<slug>`, `refund:<slug>`, `build:<kind>:<id>`, `campaign:<id>`.

## Concurrency (SQLite, one writer)

Assume every value-changing endpoint gets a burst of parallel requests.

- The mutation is the guard: `UPDATE … WHERE coins >= ? RETURNING`, `INSERT … ON CONFLICT DO NOTHING
  RETURNING` (launch jti, likes), conditional status flips (`pending → done`). No read-then-write.
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

A level 0-10 from the **current chip balance** (`shared/stars.ts`, 1k to 1M chips; coins never count), set at the hub
with `PUT /api/v1/stars` and `seq = STAR_SEQ_BASE (1e9) + the latest chip_transactions id` (the offset
keeps every chip seq above the coin ledger ids sent before economy v2). It goes down as well as up.
`players.stars_reported/stars_seq` hold what the hub confirmed. A chip change that moves the level reports
it before the response (so the client can celebrate it); a level still due from a failed report retries
in the background on the next coin or chip change, and on the next wallet read and the ten-minute sweep.
Dev-login players never touch the hub. Because `seq` is a ledger id, a casino database that starts over
behind a hub that kept its data reports `applied: false` until the new ids pass the old ones.

## Randomness

Outcomes use `cryptoRng` from `shared/rng.ts` on the server. `seededRng` is for tests and scripts only.
`Math.random()` only for cosmetics (idle reels, blur while spinning).

## Client

- `useCasinoSession()`: `player`, `coins`, `setCoins`. `useWallet()`: wallet, convert,
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
