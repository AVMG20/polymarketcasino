# Porting a slot from the old site

The old site (`nuxtpolymarket`) is the source of truth. A ported slot is the old game with new plumbing,
not a remake: copy its component, sub-components, composables, utils, assets and sounds, keep the file
names, layout, colours, sizes, copy, animations, autoplay, big win and paytable. Spiñata is the reference
port (`app/components/games/SpinataGame.vue`, `shared/slots/spinata/`).

## The shell (ported from the old site, same names)

| Old site | Here | What changed |
|---|---|---|
| `composables/useSlotGame.ts` | same | Plays through `useGameRound(slug)`. `bet` starts at the registry `minBet`. |
| `composables/slot-autoplay.ts` (`useSlotAutoplay`) | same | Also stops when the game unmounts. |
| `composables/amount-input.ts` (`useAmountInput`, `amountShorthand`) | same | Parses with `parseAmount` from `#shared/money` (whole coins). |
| `utils/amount-preview.ts`, `utils/format-number.ts` (`formatNumber`) | same | `formatNumber` is the casino's `formatCoins` for whole amounts (en-US, `12.3K` from 10,000); fractions keep 2 decimals below 1,000, as before. |
| `utils/slots/slot-controls.ts`, `utils/slots/reel-suspense.ts` | same | None. |
| `components/slots/SlotControlBar, SlotAutoSpinDialog, SlotBuyDialog, SlotDialog` | same | `UIcon` → lucide icons. |
| `components/AutoSpinModal, BetControls, BigWinOverlay, SlotVolatility` | same | `UModal`/`UButton`/`UInput`/`UTooltip` rebuilt (see below). |
| `utils/shapezz-synth.ts` voice | `utils/slots/synth-voice.ts` | Import it under the old names: `import { SynthVoice as ShapezzSynthVoice, synthNote as shapezzNote, synthWarmUp as shapezzSynthWarmUp }`. |
| `utils/slot-pixi.ts` | same | Never renders below native resolution on dpr 1. |

## Adapter points

- **Balance.** `useSlotGame().balance` is `useCasinoSession().coins`. The game's own calls stay as they were:
  `setBalance(before - cost)` in `onStart` (optimistic debit), `setBalance(before)` on a failed spin, and
  `setBalance(data.balance)` **after the reveal**. While a round is waiting, that last call is
  `useGameRound().settle()` (balance + star celebration); otherwise it is `setCoins`. Leaving mid-round
  settles on its own. Never refetch the session per spin.
- **Rounds.** `spin(cost, options, onStart)` posts `{ bet, options }` to `/api/games/<slug>/play` and
  returns `{ gameData: response.result, balance, stake, payout }`, so code reading `data.gameData` ports unchanged; a result
  that no longer carries the old `bet`/`payout`/`cost` fields rebuilds them from `stake` and `payout` (Candy Madness).
  A failure sets `errorMsg` (the server's message) and `useGameRound` toasts it.
- **Bets.** Bounds come from the registry (`findGame(slug).minBet/maxBet`, 100 to 1,000,000), not the old
  1 to 100B. Build the old 1-2-5 ladder inside those bounds.
- **Sound.** Keep the game's own sound composable with its per-game `localStorage` keys (mute, effects,
  music), every access in try/catch. Module-level watchers belong in a detached `effectScope(true)`, or
  they stop when the game first unmounts.
- **Nuxt UI.** None here. `UIcon name="i-lucide-x"` → `<XIcon />` from `lucide-vue-next` (dynamic names →
  `<component :is>`). `UModal`/`UButton`/`UInput` → shadcn-vue `Dialog` or plain elements with the old
  classes' look (`AutoSpinModal`, `BetControls`). `UTooltip` → reka-ui `Tooltip*` with Nuxt UI's chip
  look (`SlotVolatility`). Nuxt UI colour classes: `text-muted` → `text-muted-foreground`,
  `var(--ui-text-muted)` → `var(--muted-foreground)`. Google Fonts → `@fontsource/<font>` import in the
  component (the build is offline).
- **Page.** No `pages/games/<slug>.vue`: register the component in `app/utils/game-components.ts`; set
  `useHead({ title })` and `useHubBridge().postTitle()`. The RTP badge reads the registry `rtp`.
- **Style.** Templates and CSS verbatim. Scripts are re-indented to 4 spaces (casino style); no other edits.

## Server math

1. Port `shared/utils/gamelogic/<game>.ts` verbatim into `shared/slots/<game>/index.ts`: same constants,
   tables and result shape (the client reads it), with an `rng: Rng` parameter instead of `randomFloat`
   (never `Math.random`), `RangeError` instead of `createError`.
2. Pay whole coins: `payout = floor(bet × win)`; keep the old cap. Add `parse<Game>Options` (unknown keys
   and bad values throw `RangeError`) and `<game>Stake`.
3. Add the entry in `server/utils/games.ts` (`stake`, `payout`, `result`, `summary`).
4. `scripts/<game>-rtp.ts` runs the real module with `seededRng`. Target ≈96% for spins and buys; if the
   old game sits higher, change one weight or one pay scale, record old → new next to the constant, and
   put the measured paid-spin RTP in the registry.
5. Tests: pays, features, cap, options validation, stake bounds and settling through `playRound`.
