# Front-end handoff

The shell and lobby are functional and on-theme but plain. The next pass restyles them. Logic lives in
composables, so the pass can rebuild any component in `app/components/casino/` freely. Leave the games
(`app/components/games/`, `app/components/game/`) alone unless asked, apart from the shared pieces listed
below.

## Composables

| | Gives you |
|---|---|
| `useCasinoSession()` | `status` (`loading` / `ready` / `signed-out`), `config` (`coreUrl`, `appId`, `devLogin`), `player` (`id, name, image, title, coins, peakCoins`), `coins`, `setCoins(n)`, `connectUrl()`, `devLogin(name)`, `signOut()`, `handleUnauthorized(error)` |
| `useWallet()` | `wallet` (shape below), `level` (current star level), `celebrations` (queue of star rises), `refresh()`, `convert(gems)` (throws; show the error), `claimAllowance()`, `applyStars(change)`, `setGems(n)` |
| `useHubBridge()` | `embedded` (inside the hub iframe), `postWallet(gems)`, `postStars(level)`, `postTitle(title)`, `relaunch()`, `onHello(cb)` |
| `useGameRound(slug)` | `busy`, `play({ bet, options })`, `settle()`. Games call `settle()` after their reveal. |
| `useSlotSound(sounds)` | `enabled`, `muted`, `play(name)`, `toggle()` (mute is remembered per browser) |
| `useLiveTable(slug, onGameEvent?)` | A live table's socket: `state` (snapshot), `me`, `mySeat`, `phase`, `connected`, `feed`, `secondsLeft`, `phaseProgress`, `nextRoundIn`, `sit`, `leave`, `voteStart`, `chat`, `act(action)`. Applies pushed balances and stars itself. |
| `useTableSound()` | Synthesized chip, card, flip, win, lose and turn effects; shares the mute switch. |

Coins and gems are whole numbers. Show them with `formatCoins(value, compact = true)` from
`#shared/money` (12.3K, 4.56M; never rounds up). Amount inputs go through `GameBetInput` (accepts `10k`,
`2.5m`, shows what it read).

## API shapes

`GET /api/wallet`

```json
{
  "coins": 9396,
  "peakCoins": 12500,
  "gems": 491,
  "hubAccount": true,
  "coinsPerGem": 1000,
  "convert": { "min": 1, "max": 100 },
  "allowance": { "amount": 2500, "available": false, "nextAt": "2026-11-21T23:00:00.000Z" },
  "stars": {
    "level": 0, "max": 10, "reported": 0,
    "current": null,
    "next": { "name": "Pocket change", "threshold": 10000 }
  },
  "starChange": null
}
```

- `gems` is `null` when the hub can't be reached ("Gems unavailable right now") or for a dev player.
- `hubAccount: false` for dev-login players: hide gems and convert.
- `stars.current` is the star you'd lose by dropping below its threshold; `stars.next` the one you get at
  its threshold. The level follows the **current** balance and can go down.

`POST /api/wallet/convert { gems }` → `{ conversionId, gems, coins, balance, gemsLeft, stars }`.
400 can't afford / bad amount, 503 hub down (the conversion is retried later on its own).

`POST /api/wallet/allowance` → `{ day, amount, balance, stars, nextAt }`. 400 when already claimed.

`GET /api/wallet/history?limit=50` → `{ entries: [{ id, amount, type, category, refund, balanceAfter, createdAt }] }`.

`POST /api/games/:slug/play { bet, options }` → `{ roundId, game, stake, payout, result, balance, stars }`.

`stars` in any response is `null` or `{ playerId, level, previous, bounty }` (a change the hub confirmed;
`bounty` = gems paid for a new best). `useWallet().applyStars` queues a celebration for a rise and posts
`{ type: 'star', game: 'casino', stars }` to the hub either way.

`GET /api/games` → `{ games: GameInfo[] }` (same as `GAMES` in `#shared/games/registry`).

## Shell components (`app/components/casino/`)

| Component | Today | For the pass |
|---|---|---|
| `TopBar` | Slim (44 px) inside the hub iframe: back link, coins, convert (the allowance lives in the lobby hero). Standalone adds the logo, mini star track, gems, name and sign-out. | Keep the embedded bar slim; the hub's own bar already shows gems and stars. |
| `Lobby` | Balance hero (allowance, convert, "best ever"), star level with progress to the next threshold and the drop line, then tiles grouped Slots / Tables / Originals from `GAMES`. | The main restyle target. |
| `GameTile` | Cover, name, tagline, RTP; springy hover. | Cover art: `public/images/games/<slug>.jpg` (`candyrush.svg` is a drawn cover). The other covers are screenshots of the old games: `spinata.jpg` still shows "Piñata Slots" and `trashpanda.jpg` advertises 98.1% RTP and a 10,000× max, so they need new art too. |
| `ConvertDialog` | Presets 1, 5, 10, Max; preview of coins; "Gems unavailable right now". | Gems flying into the coin chip would fit here. |
| `AllowanceButton` | Claim button or "Next allowance in …". | Coins flying into the chip on claim. |
| `StarTrack` | 10 rounded squares, the first `level` filled amber, tooltips with names and thresholds. | Same component on profile-like spots. |
| `StarCelebration` | One modal card per rise; drops are silent. | |
| `CoinChip`, `GemChip`, `CoinIcon`, `GemIcon` | Chips per `docs/design.md`. | |
| `SignIn` | Shown only when the dev login is on and there's no session. | |

Live tables (`app/components/table/`): `TableShell` (felt, status line, clock, controls, chat and
scoreboard), `TableSeat`, `TablePlayingCard` (deals in, turns over in place), `TableChipStack`,
`TableChipRack`, `TableBetSpot`, `TableBetBar`, `TableTimer`, `TableFeed`, `TableAvatar`.

Shared game UI (`app/components/game/`): `GameFrame` (title, RTP, rules dialog), `GameBetInput`,
`GameRoundHistory`, `GameSlotSymbol`, `GameRouletteWheel`. Restyling these touches every game, so do it
deliberately.

## Constraints

- Phone width inside the hub iframe: no horizontal scroll, controls 44 px or larger.
- Light and dark both work; dark is the default.
- Toasts for errors only. One celebratory moment per action, nothing ambient, respect
  `prefers-reduced-motion`.
