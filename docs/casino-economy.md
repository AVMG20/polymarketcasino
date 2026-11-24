# Casino economy

The casino is one app (`appId = casino`) that registers one game in the hub manifest:
slug `casino`, name "Polynux Casino", playPath `/`, visibility `public`. All slots and tables live inside it.

## Economy v2 in one paragraph: claim coins, win chips

**Coins are claimed, never won**: the cashier cage of the player's own casino (guest
income), daily mission rewards and gems converted at the hub. Coins can only be bet. **Every win pays chips**: a stake is paid from
coins first, then chips for whatever coins don't cover, and the whole payout (stake included) comes back as
chips; a loss is gone. Chips build the casino (My Casino, below) and can be bet again; they never turn back
into coins. The star level follows the chip balance. Chips come only from round payouts and every game's
RTP is below 1, so chips made ≤ coins claimed × RTP in expectation; coins come only from the
capped cage, the capped daily missions and gem converts. Nothing else mints either currency.

## Coins

- Coins are casino-local. They never leave the casino and never turn back into gems.
- Coins carry **up to four decimals**. The database counts them in units of 1/10,000 coin (SQLite
  `INTEGER` columns, so sums stay exact); the API and the client carry decimal coins (`2137.5`).
  Payouts are `bet × multiple` rounded down to 0.0001 coin (`payFor`), so rounding never creates coins
  and costs no visible RTP at small bets; feature prices round up to 0.0001 (`costFor`). Bets may have
  decimals too. Slots, originals and roulette take 10 to 1,000,000 per bet. Gems stay whole.
- Every change goes through `coinTransaction` in `server/utils/ledger.ts` (or `commitCoins`, the same
  transaction with the star report left in the background, used by the live tables) and writes a
  `coin_transactions` row (category = the game's plain lowercase name: `'spinata'`, `'dice'`,
  `'roulette'`, `'blackjack'`, `'convert'`, `'allowance'`, `'cage'`, `'mission'`). Nothing else writes `players.coins`.
- **Stakes**: every stake (solo rounds and live tables) is split by `splitStake` (shared/tycoon.ts): coins
  first, then chips for the rest (100 with 60 coins = 60 coins + 40 chips). Both debits run in the round's
  immediate transaction, each guarded (`coins >= part`, `chips >= part`); coins and chips together short of
  the stake is a 400 `Not enough coins or chips`. `game_rounds.stake_chips` and `table_wagers.amount_chips`
  record the chip part (the rest was coins). The payout is credited as chips (`win:<slug>`).
- **Live tables** (blackjack, baccarat, casino hold'em, three card poker): table chips from 100, at most
  1,000,000 per betting spot. Stakes (split coins first, then chips) are held in escrow (`table_wagers`)
  from the moment betting closes (or a double, split, call or play is taken) until the hand settles, which
  pays once, in chips. Open escrow is refunded when the casino restarts, each part in its own currency
  (coins with `refund: true`, chips as `refund:<slug>`). Sitting down needs 100 coins and chips together, and makes the player's casino profile if they never opened it (a visitor seated at a host's table; every payout is chips). RTP: blackjack 99.6% with basic strategy (Perfect
  Pairs 93.9%, 21+3 95.4%, insurance 92.6%), baccarat banker 98.9% / player 98.8% / tie 85.6% / pairs 89.6%,
  casino hold'em 97.8% of the ante with optimal play (AA bonus 93.7%), three card poker 96.6% of the ante
  with Q-6-4 play (pair plus 97.7%). `scripts/<table>-rtp.ts` simulates each.
- **Multi-step rounds** (Gem Dig `mines`, Card Climb `hilo`; `server/utils/steps.ts`, table `step_rounds`):
  `POST /api/games/<slug>/start` stakes the bet (split coins first, then chips) in the transaction that
  inserts the `open` row; one open round per player and game (a partial unique index, so a second start is
  a 409 and rolls its debit back). The whole outcome lives on the server: Gem Dig places its bombs at the
  start (CSPRNG) and never sends them before the round ends; Card Climb draws each card when the move is
  made. `POST …/act { step, action }` makes one move in an immediate transaction, guarded by
  `status = 'open' AND step = <the step the client saw>` (a stale or repeated tap is a 409); a bust settles
  with nothing. `POST …/cashout` flips `open → settled` and pays bet × multiplier (rounded down) in chips with
  its `game_rounds` row, in one transaction: parallel cash-outs and moves serialise on the write lock and the
  flip, so a round pays once. Clearing the board or reaching the 1,000,000× cap cashes out on the player's
  behalf. A cash-out (like any solo payout) pays at most `MAX_COINS` (~900 billion: the cap on the top bet
  would pass it, and the chip ledger refuses more). **Abandoned rounds** stay open: `GET …/round` hands the open round back, so the player plays on or
  cashes out later. A round nobody moved for 24 hours is settled by the sweep (`server/plugins/step-rounds.ts`,
  every ten minutes): with progress (a gem, a right call) it is cashed out at its current multiplier, exactly
  what the player could have taken; without any it is refunded, each part of the stake in its own currency.
  Each round settles in its own transaction; one that fails is logged and left open for the next sweep.
- **Originals RTP**: Pegfall (plinko) 97.0-97.8% for every risk and row count (`scripts/plinko-rtp.ts`
  works each table out exactly); Gem Dig and Card Climb 97.5% for every strategy, because the house share
  is taken once per round (Gem Dig pays 0.975 × the inverse chance of the gems dug; Card Climb's multiplier
  starts at 0.975 and every right call multiplies by the fair 13 ÷ winning ranks). Payouts round down, so
  real returns sit a hair under (`scripts/mines-rtp.ts`, `scripts/hilo-rtp.ts`).
- **Convert**: 1 gem = 1,000 coins (`COINS_PER_GEM`). One-way. 1 to 100 gems per conversion (the hub caps a
  player's pile at 100). Flow: insert a `gem_conversions` row (`status = 'pending'`, `idempotency_key = uuid`)
  → call hub `POST /api/v1/gems/spend` (no transaction is open during the call) → on success credit coins
  and mark `done` in one immediate transaction guarded by `status = 'pending'`. Mark it `failed` only on a
  refusal that proves no gems moved: a 400 (decided after the hub's idempotency lookup), or any 4xx on the
  very first attempt. Everything else stays pending: a timeout, a 5xx, and a 401/403/404/409/429 on a retry,
  since the first attempt may have spent the gems before its answer got lost. A pending row older than a
  minute is retried with the same idempotency key (the hub replays, it never double-charges) on the
  player's next wallet read or convert and in the ten-minute sweep.
- **No daily allowance** (removed): the cashier cage pays coins all day, so the casino is playable with
  zero gems. `allowance_claims` and old `'allowance'` ledger rows stay for history.
- Players earn 10 gems a day at the hub, so gem-funded play is about 10,000 coins a day next to the cage.

## Stars (a level the casino sets at the hub)

The casino's stars are a **level from 0 to 10 that follows the current chip balance** (My Casino chips): the
number of thresholds at or below `casino_profiles.chips`. Spend or lose the chips and the stars go with
them. Coins never count.

| # | key | name | hold |
|---|---|---|---|
| 1 | `hold-1k` | Pocket change | 1,000 chips |
| 2 | `hold-2500` | Fat wallet | 2,500 |
| 3 | `hold-5k` | Chip stack | 5,000 |
| 4 | `hold-10k` | High roller | 10,000 |
| 5 | `hold-20k` | Whale watch | 20,000 |
| 6 | `hold-40k` | Velvet rope | 40,000 |
| 7 | `hold-75k` | Penthouse | 75,000 |
| 8 | `hold-120k` | House money | 120,000 |
| 9 | `hold-300k` | Casino royalty | 300,000 |
| 10 | `hold-1m` | First million | 1,000,000 |

The thresholds are sized on the simulation's chip balances (`bun scripts/tycoon-sim.ts`, which plays on
for three weeks after max): stars 1-3 come in the first session, 4-6 in the first week while saving
between builds (the Lounge, the Crew), 7 while saving for the High Limit Room (day ~11 regular, ~15
casual), 8 while saving for the Penthouse (it costs 132,000: day ~21 casual, ~14.5 regular), 9 around
max (a maxed casino wins 100-200k chips a day) and 10 about a week of play after max (casual: max + ~8-10
days, regular + ~6-7, whale + ~4-5). A regular who converts the 50 starting gems holds ~48,000 chips for a
moment on day 0 (star 6) and spends them on builds. Star 8 was 150k until the polish pass: nothing in the
catalog costs that much, so it only came at max and left casual players 13 days without a star (day 15 to
28); at 120k it lands a week earlier. The thresholds changed with the catalog (they were 10k … 100M from
the coin era); the hub takes the new keys from the next manifest and retires the old ones.

- Chips only move inside a `coinTransaction` / `commitCoins` unit (`server/utils/chips.ts` throws
  otherwise), which watches every chip move. After every committed unit whose chip level moved:
  `PUT /api/v1/stars { playerId, game: 'casino', stars, seq }` with `seq = 1,000,000,000 + the player's
  latest chip_transactions.id` (`STAR_SEQ_BASE`). Before v2 the seq was the coin ledger id; the hub only
  applies a seq above the stored one, so the offset puts every chip-based seq above every coin id ever
  sent, and ids only grow, so a stale set that arrives late is dropped. `players.stars_reported` /
  `stars_seq` hold what the hub confirmed; a level that differs is retried on the next coin or chip change,
  the next wallet read and the ten-minute sweep. No call when the level did not change.
- Dev-login players never exist at the hub: no star reports, no gems, no convert.
- `players.peak_coins` is kept as a stat ("best ever") only.

Thresholds live in `shared/stars.ts`; balance scripts in `scripts/` import them.

## My Casino

Every player owns a casino floor (`/`, "My Casino"). It starts with the backroom holding Pegfall and
Spiñata, and the rest is built with **chips**: zones, games (levels 1-5) and five casino upgrades, each with
one purpose: Cashier Cage (storage, 5 levels), Marketing (more guests, 5), Decor (richer guests, 12 levels gated
by the rooms), Hospitality (more and richer guests, 5 dear levels from the Table Pit) and the one-level
Construction Crew (builders); the House Cut upgrade left with v2 and its levels are ignored. Rules and numbers
live in `shared/tycoon.ts` (chip prices and cage sizes are written small and scaled by `CHIP_SCALE` 5
and `GUEST_SCALE` 30, which size the economy against the fixed convert rate and star
thresholds) and the guests in `shared/visitors.ts`; `bun scripts/tycoon-sim.ts [days] [seed] [days after max]`
plays it day by day for three kinds of player (pace, stars, what each campaign netted, the house rules by stage,
the floor's luck) and is how the numbers were tuned.

- **Chips** are stored like coins (units of 1/10,000) in `casino_profiles.chips`; every change writes a
  `chip_transactions` row (reason `bet:<slug>`, `win:<slug>`, `refund:<slug>`, `build:<kind>:<id>`,
  `campaign:<id>`) through `server/utils/chips.ts`, inside a coin unit (so the stars follow). A debit is
  guarded (`chips >= amount`).
- **A game must be built to play it.** A round of an unbuilt game is a 403 (`Build <name> in your casino
  first`). Live tables stay shared: anyone can watch, sitting down needs the game built.

### Coins in: the cashier cage (visitor tiers)

The cage fills with **coins** from the guests on the floor. The model is `shared/visitors.ts` (the same code on
the server, the client and in the simulation); `server/utils/tycoon.ts` runs it.

**Seats.** Every built game has seats (2-5 by kind, +1 per level). Guests spread over the seats; a guest at a
game spends ×1 / 1.02 / 1.04 / 1.06 / 1.08 by its level. A game earns by its seats: Pegfall (3 seats) brings
half again what Spiñata (2 seats) does at the same level.

**Tiers.**

| tier | spends an hour | comes from | colour |
|---|---|---|---|
| Tourist | 38 | the start | `#38bdf8` |
| Regular | 50 | the Main Floor | `#34d399` |
| High Roller | 66 | the Table Pit | `#c084fc` |
| Whale | 500 | the High Limit Room | `#fbbf24` |

The odds of tier k are weight_k × P^k over the unlocked tiers, normalised (weights 1, 0.2, 0.006, 0.00001).
The casino's **prestige** P multiplies up: × 1.09 per Decor level, × 1.045 per Hospitality level, × 1.05 per
zone past the Backroom, × (1 + 0.002 / 0.004 / 0.008 / 0.02) per game at level 2 / 3 / 4 / 5 (the top machine
levels draw richer guests; `richerLevel` marks 4 and 5), × 1.15 with Tourists limited at the door and × 1.35
with them kept out, and × the wealth ads. P reaches 6.8 at max: 38% Tourists, 51% Regulars, 10% High Rollers,
0.12% Whales. **Whales stay** one to three hours (4-12 ticks, rolled from their arrival tick): the floor at a
tick holds the Whales who arrived in the last three hours and haven't left, worked out from (state, seed,
arrival tick) only, so a tick stays a pure function of (state, seed, tick); after a change the stayers are those
the new casino would have drawn, and a Whale already in keeps its seat first. About 0.1 visits a day when the
High Limit Room opens, 1.4 a day at max, ~2 hours and ~1,000 coins each; with both wealth ads at max Whales are
2.9% of arrivals.

**The crowd** follows prestige: seats × 0.41 × P^0.08 × a small-floor bonus (× 1 + 0.3 × 20 ÷ (20 + seats)) ×
(1 + 0.045 × Marketing) × (1 + 0.04 × Hospitality), plus each guests ad's share of the seats, times a mood (a
random good or quiet hour ±30%, day ±10%, tick ±15%; no time-of-day curve). Idle, a floor runs 47-54% full
early and 65-73% late: never full. Each guests ad adds its own share (Flyers 12% of the seats, Billboard 18%,
TV Ad 25%), so only all of them together fill a late floor (98-99%). Each guest rolls a tier, the door filters
them, High Rollers and Whales take a VIP seat when the VIP room runs, everyone else a free seat; no seat,
turned away. The tick's rate = Σ seated spend × level factor (× 1.6 in the VIP room), doubled in a gem rush,
minus the VIP staff, never below 0. The luck is a pure function of (casino state, seed, tick); the seed is
FNV-1a of the player id salted with a server-only secret (`PNX_LUCK_SALT`, else the session secret), so the good
hours can't be worked out from a player id. Income between two moments is reproducible and **additive** (a tick
earns whole 1/10,000 coins, part of a tick floor(units × elapsed / tick); tested). Accrual splits where a rush
or any campaign ends; builds finishing and rule changes accrue up to that moment first. `TycoonState.floor`
carries the tick's seated guests, its rate, what each tier brings (`income`, bonuses and a rush in) and the
rule costs (`costs`): Σ income − costs = perHour, to the cent. Visitors of a casino get only who is on the floor
(visitors, seats, turned away), never the owner's income.

**Expected income** (`expectedPerHour`, `floor.expectedPerHour`) is the same model with fractional tier counts
and the moods averaged out: campaign previews (`campaignGain`), the rush price, mission rewards and the rules
panel read it (or the full floor), never a lucky tick. `cage.perHour` = `floor.perHour`, the current tick's
rate. Building or levelling anything never lowers expected income, under any rules and any mix of ads (a test
walks every build step of 54 stages × the rules × 7 ad mixes).

| stage (every game at the level) | expected/h | seated T/R/H/W |
|---|---|---|
| new casino (Backroom L1) | 187 | 100/0/0/0% |
| Main Floor L1 / L5 | 462 / 1,236 | 80/20/0/0% |
| Table Pit L1 / L5 | 774 / 1,959 | 75/24/1/0% |
| Slot Lounge L1 / L5 | 1,056 / 2,859 | 69/29/2/0% |
| High Limit L1 / L5 | 1,591 / 4,227 | 59/37/4/0.1% |
| Penthouse L1 / max | 2,008 / 5,422 | 38/51/10/0.1% at max |

A maxed casino earns about 130,000 coins a day idle (134,000 under the best idle rules) and 179,000 with every
seat full at the default rules; with every ad running 240,000 (default rules) to 320,000 (no Tourists and the
VIP room). A day stays within 0.89-1.15 of the mean (±6-7% sd); an hour's 10th and 90th percentile are about
±25% from the median. The cage holds 9,000 coins at Cashier Cage 0 (a new casino's 7,500 starter coins leave
room, so it never reads "full" in the first minute), then 12,000 / 18,000 / 25,500 / 33,000 / 42,000; income
over the capacity is lost (and recorded as lost). Collect: `POST /api/tycoon/collect` (whole coins, a `'cage'`
row; parallel collects pay once).

**Upgrades for guests.** Marketing: +4.5% guests a level, stronger wealth ads (+10% a level). Decor: 12 levels
(1-2 at the Main Floor, 3-4 Table Pit, 5-6 Slot Lounge, 7-9 High Limit, 10-12 Penthouse; 750 to 18,500 chips, 3
minutes to 9 hours): richer guests. Casinos from before the 12 levels moved with migration 0011: old Decor 1 / 2
/ 3 / 4 / 5 → 2 / 4 / 6 / 9 / 12 (the most each old level's room allows, the same floor look through
`decorLook`, no more chips than were spent; a running Decor construction moves the same way). Hospitality
(free drinks, snacks, a buffet, fine dining, a champagne bar; Table Pit, Lounge, High Limit ×2, Penthouse;
4,500 to 37,500 chips): +4% guests and prestige × 1.045 a level. The build cards list every open tier's share
now → next (▲ green, ▼ red) and the next tier still to open with the share it will have.

**House rules** (`POST /api/tycoon/rules`, `RulesBody`: some of `door`, `vip`; typed strictly, anything else a
400). They unlock one at a time; a new casino sees none (`house.unlocked` empty), and only the owner's reads
carry `house`.

| rule | unlocks with | what it does | costs |
|---|---|---|---|
| `door: 'limit'` | Slot Lounge | Tourists take at most a third of the seats; prestige × 1.15 | Tourists turned away on a quiet floor |
| `door: 'closed'` | Slot Lounge | no Tourists; prestige × 1.35 | a floor that is far from full |
| `vip` | High Limit Room | the High Limit Room seats only High Rollers and Whales (×1.6 there); its seats stop drawing the everyday crowd | 10 coins an hour per VIP guest |

Expected change against the default rules (idle / with the Flyers / with every ad): the limit -2% to -22% at the
Lounge, about even idle and +6-7% with every ad from High Limit up; no Tourists -17% to -52% idle, +4% to +24%
with every ad from High Limit up; the VIP room -10% to -19% idle, +10-14% with every ad from High Limit L5 up.
So the Lounge runs the open door, High Limit the limit, and a casino running every ad at the top closes the
door and opens the VIP room. A locked rule is a 403; a change is allowed ten minutes after the last
(`RULES_COOLDOWN_MS`, a 429 before; guarded on `rules_at`); the same rules again change nothing.

**History** (`GET /api/tycoon/history?range=24h|3d`, `HistoryResponse`). Every persisted accrual adds its hour
pieces to `casino_history` (player, hour: guest-hours per tier, ms covered, income before the cage cap, lost;
insert … on conflict add); a read adds the stretch since (replayed from the later of the last accrual and the
range's start, the cage before it filled in one quick pass); empty hours are zeros. Rows older than four days
are pruned on write.

**Ad campaigns** (`POST /api/tycoon/campaign`, chips). Different kinds run side by side
(`casino_profiles.campaigns`, one entry per kind, a JSON list read leniently; the old `campaign` columns keep
the first one ending), the same kind again extends its queue (×1.5 per run still queued, a week at most). Price:
hours of the floor's full income at the default rules (at least 100 chips).

| campaign | goal | runs | needs | effect | price (h) | at max |
|---|---|---|---|---|---|---|
| Flyers | guests | 2 h | – | +12% of the seats in guests | 0.17 | 1,300 |
| Billboard | guests | 8 h | Marketing 2 | +18% | 0.75 | 5,600 |
| TV Ad | guests | 24 h | Marketing 4 | +25% | 2.8 | 20,900 |
| VIP Invitations | wealth | 8 h | High Limit, Marketing 1 | prestige × 1.45 (+10% a Marketing level): High Rollers, and with Marketing Whales | 0.5 | 3,700 |
| Private Jet | wealth | 12 h | High Limit, Marketing 3 | Whale odds × 4, prestige × 1.15 (+10% a Marketing level) | 1.0 | 7,500 |

Coins back × RTP 0.97 ÷ chips, run on its own, collected every two hours at the rules that suit it (sim "Ad
return"): Flyers ×1.3-1.4 (×0.9 on a brand-new five-seat floor), Billboard ×1.4-1.9, TV Ad ×1.5-1.8, VIP
Invitations ×1.2-1.4 at High Limit and ×1.6 at the Penthouse, Private Jet ×0.4-0.8 at High Limit and ×0.9-1.3
at the Penthouse. Guests ads are the pick until the Penthouse, wealth ads at the top; on a floor the guests ads
keep full a wealth ad beats one more guests ad, and one more guests ad on a floor the others fill doesn't pay
(tested). On a casual three-sessions-a-day schedule the long ones lose to a full cage. The previews
(`campaignGain`) show each run's extra guests (or High Rollers and Whales), the tier counts without → with it,
the coins over the run and what collecting every four hours keeps with the player's cage (with how soon the
cage fills). A rush is priced from the full floor under every rule and wealth ad the casino can run, so a rush
with every ad and rule pays at most 0.67× converting at max (tested over every stage, ad mix and rule).
Campaigns stay chips: paid in coins they would be a coin-in, coin-out loop with no RTP in between at
×1.2-1.9, and the campaign sink (the regular spends ~730,000 chips on ads in the sim, the whale ~1.3 million,
against a 1.46 million catalog) would leave the chip economy.

### Chips in and out

- In: round payouts only (solo and live, every win, stake included).
- Out: building (about 1,459,000 chips for everything; 410 build hours), ad campaigns, and losing bets.
  Builds cost chips only (`Cost.coins` is always 0) and take time: seconds for the first ones (Limbo 10 s,
  Wheel 45 s, the starters' level 2 two minutes), 25 minutes for the Main Floor, level-ups from minutes early
  to hours late (level 4 at least an hour, level 5 at least three; at most 9 hours per construction). A
  construction applies when its timer runs out, on the next read or action.

### Builders

One construction runs per builder. A casino starts with one and can add two more, each bought once and in
any order, so at most three (`MAX_BUILDERS`, `builderCount`):

- **Construction Crew** (an upgrade, chips): one level, 40,000 chips and 4 hours, opens with the Slot
  Lounge. It is the mid-game goal: more than the Lounge (35,000), less than the High Limit Room (70,000). It
  takes a builder while it is built, and adds one the moment it is done (`upgrades.crew = 1`).
- **Gem builder** (`builder`, 60 gems): bought any time, also before the Crew.

`casino_profiles.builders` stores 1, or 2 with the gem builder hired; the Crew's builder is added on read
(`TycoonState.builders` is the total, `TycoonState.gemBuilder` says whether the gem one is hired). The gem
purchase checks the gem builder itself, never the total, so the Crew can't use it up and it can't be bought
twice; a second purchase that settles anyway (left pending from before) is refunded.

### Daily missions (`shared/missions.ts`, `server/utils/missions.ts`)

Three missions a player per Amsterdam day, drawn on the day's first read or event: one to play (20 rounds,
3 slot wins, a 5× win, 5 live-table hands), one for the casino (collect the cage twice, start a build, run a
campaign), and one more of anything left, a visit included (3 rounds at someone else's casino). A mission
the casino can't do isn't drawn (no live table built, nothing left to build, a week of ads queued, no other
casino). A 5× win is one bet paying 5× (or more) itself: one Pegfall ball, one Magic Hands hand, one roulette
spot, one blackjack hand or side bet, a baccarat spot, the pair plus or AA bonus; a single-bet game, the round. Rewards are
**coins**, fixed when the day's missions are drawn: 0.5-1 hour of the casino's full guest income each
(`missionReward`: hours of `fullIncomePerHour`, every seat taken at the default rules, at least 3,500 coins an
hour, so a new casino gets 1,750-3,500 a mission and about 9,000 for the first day), plus 0.75 hours for
clearing all three (the bonus). The floor was 1,500 before the visitor tiers: a young floor is half empty now,
so the missions carry the first days. Coins, so they are bet before they become chips.

- Progress counts the real events, in the same transaction as the event: a settled round (solo, step and
  live table rounds, each counted once when it settles; a visit counts when a solo round settles or a step
  round starts at the host, and when a hand settles at a live table the player sat down at as a visitor), a
  collect that paid, a build started, a campaign run. It is capped at the target and stops once claimed.
  Rounds count whatever paid the stake (coins or chips): missions reward play, so a chip-only player
  can still earn a few hundred coins a day this way. That and ad campaigns (chips for more guests, bounded
  by the floor's seats and the cage) are the only paths from chips to coins; missions are bounded by three
  and a bonus a day.
- `daily_missions` holds one row per player, day and mission (`bonus` included, primary key = the draw
  guard). `POST /api/tycoon/mission { id }` flips `claimed_at` from null, guarded by `progress >= target`,
  and credits the coins (category `'mission'`) in the same coin transaction, so a burst of claims pays once.
  The stats page lists them as a coin flow next to the cage and converts (`FLOW_CATEGORIES`).
  A mission claim moves the bonus one step. Missions of a past day can't be claimed.

### While you were away

Every read of the owner's casino stores when it happened and a snapshot (zones, build, running constructions,
campaign, rush, house rules, coins in the cage) in `casino_profiles.last_seen_at` / `last_seen`. The first read
after the app opens or the tab comes back (`GET /api/tycoon?welcome=1`) that is ten minutes or more after the
last one replays the floor from the snapshot tick by tick (the same seeded luck the cage ran on, split where each
construction finished) and returns `welcome`: coins the cage gained, guest income a full cage turned away,
constructions that finished, the campaign that ended, the visitors now, the hours while away (`hours`, the
history's whole hours, at most the last three days) and the whales that came by (`notable`: the eight biggest
spenders, oldest first). The page reads every four minutes while visible, so a player
watching the floor is never "away". A plain read under a minute after the stored one skips the write only
while the snapshot still replays to now: same zones, build, constructions, campaign, rush and rules, and no
fewer coins in the cage. A collect, a rush or a campaign always stores a fresh one, so collected coins never show up
as "turned away".

### Gem items (`POST /api/tycoon/gems`)

Gems are scarce (10 a day at the hub), so they buy speed, priced on the dear side of the platform guide.
Gems never buy chips: chips set the star level, and the platform contract forbids selling star levels for
gems (the old chip pack is gone; a pack still pending from before v2 is refunded).

| item | gems | what |
|---|---|---|
| `skip` | 1-200, `ceil(0.71 × minutes^0.69)` (10 min: 4, 1 h: 12, 4 h: 32, 8 h: 51) | finish one construction now |
| `rush` | 5-100, `ceil(best full-floor income × 4 h / 1,000 × 1.25)` (every rule and wealth ad the casino can run) (a new casino: 5; maxed: 81) | high rollers: every guest spends double for 4 hours; priced from the floor with every seat taken at the richest mix any rules the casino has unlocked let in (not from the occupancy at purchase, which a campaign started next would raise, nor from the rules now, which can change after), so a rush with or without a campaign, under any rules, is never a cheaper way to coins than converting (at most 800 coins a gem) |
| `builder` | 60 | a permanent extra builder (one more construction at once; once, next to the Crew) |
| `golden` | 30 | a golden skin for one built game (cosmetic) |
| `cosmetic` | 5-200 (target: the item key, `hat:crown`) | an avatar item or a premium zone skin (`shared/cosmetics.ts`; cosmetic only) |

Purchases follow the convert flow exactly: a `gem_purchases` row (`pending`, its own idempotency key) is
inserted in the same immediate transaction that checks the purchase against the casino, the hub spends,
and a separate guarded transaction flips it `pending → done` and delivers the item. One pending purchase
per player, item and target (a partial unique index), so a double tap gets a 409. The failure rules are
the convert's (`spendNeverLanded`); a stale pending row is retried with its key on the player's next
purchase and by the ten-minute sweep. A purchase with nothing left to deliver (a skip that finished on its
own, a builder or cosmetic owned already) goes `done → refund_due`; the hub refund flips it `refunded`, and
the sweep retries a refund that didn't get an answer. A refund the hub refuses (refunded already, past its
24 h window) becomes `refund_failed` and is logged for a person. Dev-login players can't buy anything (403). Without gems the
casino is fully playable; gems only make it faster.

Gems against progress (converted at 1,000 coins a gem, then won at RTP ≈ 0.97): a new account's 50
starting gems ≈ 48,500 chips = 2.9% of the catalog (a nice early boost, not a skip); a day's 10 gems ≈ 9,700
chips ≈ 10% of a regular player's mid-game day (about 95,000 chips won a day on days 5-11).

### Cosmetics (`shared/cosmetics.ts`)

Avatar items (hats, outfits, accessories) and zone skins never change odds, income, seats or the casino
value. The avatar's own look is free: hair style, hair colour and skin tone (each slot defaults to `auto`,
what the player's name gives). A few hats, outfits and accessories are free (the defaults among them). The
others cost gems (5-50; premium Crown 90, Gold Suit 100, Diamond Suit 200) or, the mid and late game
pieces, chips: Fedora 40,000, Velvet Blazer 120,000, Ice Chain 250,000, Royal Robe 600,000 and Golden
Laurel 750,000 (a maxed casino wins 100-200k chips a day, so the dearest are days of winnings and a star
level or two given up: an end-game sink). Zone skins: Art Deco, Tropical and Wild West cost chips (2,400 /
4,800 / 7,200), Ice Palace 35,000 (mid game), Vegas Gold 150,000 and Cosmic 500,000 (late and end game);
Royal, Midnight and Jade Temple gems (40 / 60 / 150). A chip buy is a chip sink, so it can lower the star
level. Bought once, owned for good; equipping is free (a skin goes on any owned zone). Chip buys are one
`coinTransaction`: the `casino_cosmetics` insert (primary key = the double-buy guard) and the chip debit;
gem buys use the gem flow
(item `cosmetic`). Visitors see the owner's look and zone skins; nobody sees what anyone owns.

### Pace (simulation, seed 7)

Casual: the cage only, no gems, three short sessions a day. Regular: converts its 50 starting gems at once,
saves its daily 10 for the gem builder, then converts them; four sessions. Whale: buys ~100 gems a day on top
of the daily 10, buys the gem builder, skips anything with more than 30 minutes left, rushes, converts the
rest; seven sessions. All save for the Construction Crew once the Lounge is open, bet their coins at RTP 0.97
with dice-like variance, re-bet a share of spare chips and, at each session start, buy every campaign not yet
running that returns a fifth over its price on top of the others (against their own collect times, each side
at the rules that suit it), then run the rules that earn the most until their next session (the casual player
once a day). The sim credits each ad with what the cage would have lacked without that one ad. Daily
missions: casual two a day, regular and whale all three and the bonus. Day each milestone was reached
(`bun scripts/tycoon-sim.ts 60 7 21`):

| profile | 8 builds | main | pit | lounge | crew | high limit | penthouse | 50% | 90% | max |
|---|---|---|---|---|---|---|---|---|---|---|
| casual | 0 | 0.5 | 2.9 | 6.3 | 8.9 | 15.9 | 22.3 | 11.9 | 23.3 | 26.3 |
| regular | 0 | 0.5 | 0.8 | 0.9 | 6.5 | 11.8 | 15.9 | 7.8 | 16.8 | 18.9 |
| whale | 0 | 0.4 | 1.3 | 3.3 | 3.5 | 6.6 | 10.3 | 3.5 | 10.8 | 12.6 |

Over seeds 1, 2, 3, 7 and 11: casual maxes on day 26.3 on every seed (the Table Pit 2.6, the Lounge 5.1, the
Crew 9.0 on average), regular 18.3-18.9, whale 12.3-12.6. Before the visitor tiers: 25.3-27.3, 18.3-19.3 and
12.3-12.4.

Day each star was first held (same run; 10 comes 4-9 days after max; star 8 stays at 120,000: the casual
player holds it on day ~22):

| profile | 1-3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 |
|---|---|---|---|---|---|---|---|---|
| casual | 0.3 | 1.9 | 3.9 | 5.9 | 15.3 | 21.9 | 28.3 | 34.9 |
| regular | 0.3 | 0.3 | 0.3 | 0.3 | 11.3 | 15.3 | 20.3 | 24.3 |
| whale | 0.3 | 1.3 | 1.3 | 1.3 | 6.6 | 9.9 | 13.4 | 16.3 |

Payback of single steps (chips ÷ expected coins an hour gained, at the stage they are bought; sim "Payback"):
Limbo 11 h, Roulette 17 h; Decor 110-234 h; Hospitality 110-173 h; Marketing 181-338 h; game levels 3→4 and
4→5 337-672 h (before the rework a level 4→5 took ~1,000 h and Decor 4 ~1,020 h); zones are gateways (the
Lounge and the Penthouse ~2,300-2,700 h on their own).

The first session lands 7-12 builds (a casual player's 15 minutes: 7-9, the Main Floor among them), all under
half an hour: the starter coins (7,500), the first day's missions (~9,000) and cheap first steps. Then it slows:
the median build takes 20-70 minutes in week one, two to seven hours in week two, four to eight in week three.

**The first hour and day.** A new player who plays the first hour through (Main Floor first, then the
quickest step it can pay) has 10 builds by minute 36: the Main Floor (25 minutes, 3,600 chips), Limbo,
Wheel, both starters to level 2-3, Cage and Marketing 1. After that the cage brings 500-800 coins an hour
and the next steps cost 580-2,400 chips, so the rest of that hour is play and saving (the next goal, Decor 1
or a Main Floor game, is an evening's cage). From the second session on every session pays for 1-4 builds
(Main Floor games at 1,500-2,000 chips, 5-14 minutes). The polish pass made three changes for that: the
missions' floor went from 800 to 1,500 coins an hour (the first day's three missions and bonus pay ~3,750
instead of ~2,000, so a casual player opens the Main Floor on day 0 instead of day 1); visitors now come
by a game's seats (0.32 per level-1 seat instead of 0.9 per game) and Limbo and the Wheel earn a third more
(the Penthouse's two games a sixth less, so a full floor stayed at ~179,000 a day), because before it a new
Wheel, Roulette or card table drew too few visitors for its seats and *lowered* the cage's income (Wheel
-15 an hour, Roulette -5, Blackjack -1). With the visitor tiers the crowd comes for the seats themselves, so
every seat a build adds draws its share, and no build step lowers expected income (tested).

A casual player is held back by build steps late and by chips in the middle: with three short sessions a
day every long step costs them about half a day whatever its timer (anything from 5 to 10 hours finishes
overnight or by the evening session), while the Lounge-to-High-Limit stretch is spent saving. The Crew's
second builder (day ~9) doubles what they get done per session; it is priced so saving for it is a real
goal (about two days of a casual mid-game). The regular is closer to chip-bound, so the late prices and its
converted gems show more there.
