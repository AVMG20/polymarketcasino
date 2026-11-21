# Casino economy

The casino is one app (`appId = casino`) that registers one game in the hub manifest:
slug `casino`, name "Polynux Casino", playPath `/`, visibility `public`. All slots and tables live inside it.

## Coins

- Coins are casino-local. They never leave the casino and never turn back into gems.
- **Whole integers** everywhere: SQLite `INTEGER` columns, the API, the client. Payouts are
  `floor(bet × multiple)`, so rounding never creates coins. Games with fractional multipliers start at a
  100-coin minimum bet, where that rounding costs well under 1% RTP (roulette pays whole multiples and
  starts at 10). Max bet 1,000,000.
- Every change goes through `coinTransaction` in `server/utils/ledger.ts` and writes a `coin_transactions`
  row (category = the game's plain lowercase name: `'spinata'`, `'dice'`, `'roulette'`, `'convert'`,
  `'allowance'`). Nothing else writes `players.coins`.
- **Convert**: 1 gem = 1,000 coins (`COINS_PER_GEM`). One-way. 1 to 100 gems per conversion (the hub caps a
  player's pile at 100). Flow: insert a `gem_conversions` row (`status = 'pending'`, `idempotency_key = uuid`)
  → call hub `POST /api/v1/gems/spend` (no transaction is open during the call) → on success credit coins
  and mark `done` in one immediate transaction guarded by `status = 'pending'`. Mark it `failed` only on a
  refusal that proves no gems moved: a 400 (decided after the hub's idempotency lookup), or any 4xx on the
  very first attempt. Everything else stays pending: a timeout, a 5xx, and a 401/403/404/409/429 on a retry,
  since the first attempt may have spent the gems before its answer got lost. A pending row older than a
  minute is retried with the same idempotency key (the hub replays, it never double-charges) on the
  player's next wallet read or convert and in the ten-minute sweep.
- **Daily allowance**: 2,500 free coins once per `Europe/Amsterdam` day, so the casino is playable with zero
  gems. The `(player, day)` primary key of `allowance_claims` is the guard.
- Players earn 10 gems a day at the hub, so gem-funded play is about 10,000 coins a day next to the
  2,500 allowance.

## Stars (a level the casino sets at the hub)

The casino's stars are a **level from 0 to 10 that follows the current coin balance**: the number of
thresholds at or below `players.coins`. Lose the coins and the stars go with them.

| # | key | name | hold |
|---|---|---|---|
| 1 | `hold-10k` | Pocket change | 10,000 |
| 2 | `hold-50k` | Fat wallet | 50,000 |
| 3 | `hold-100k` | High roller | 100,000 |
| 4 | `hold-250k` | Whale watch | 250,000 |
| 5 | `hold-500k` | Velvet rope | 500,000 |
| 6 | `hold-1m` | First million | 1,000,000 |
| 7 | `hold-5m` | Penthouse | 5,000,000 |
| 8 | `hold-10m` | House money | 10,000,000 |
| 9 | `hold-50m` | Casino royalty | 50,000,000 |
| 10 | `hold-100m` | Nine figures | 100,000,000 |

- Reporting: after every committed coin change whose level moved, `PUT /api/v1/stars { playerId, game:
  'casino', stars, seq }` with `seq` = the player's latest `coin_transactions.id` (ids only grow, so the hub
  drops a stale set that arrives late). `players.stars_reported` / `stars_seq` hold what the hub confirmed;
  a level that differs is retried on the next balance change, the next wallet read and the ten-minute
  sweep. No call when the level did not change.
- Dev-login players never exist at the hub: no star reports, no gems, no convert.
- `players.peak_coins` is kept as a stat ("best ever") only.

Thresholds live in `shared/stars.ts`; balance scripts in `scripts/` import them.
