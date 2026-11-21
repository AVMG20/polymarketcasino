<script setup lang="ts">
import '~/assets/css/candy-madness.css'
// Rules and paytable for Candy Madness. Every figure comes from the live game
// constants, so this panel can't drift from the maths. Nuxt UI's UModal
// rebuilt on reka-ui's dialog with the same overlay, panel and sizes.
import { XIcon } from 'lucide-vue-next'
import { DialogContent, DialogOverlay, DialogPortal, DialogRoot, DialogTitle } from 'reka-ui'
import {
    candyMadnessStake,
    CM_BONUS_HUNT_COST,
    CM_BUY_FREESPINS_COST,
    CM_COLS,
    CM_FREE_SPINS,
    CM_MAX_WIN_MULT,
    CM_MIN_CLUSTER,
    CM_MULT_CAP,
    CM_MULT_START,
    CM_ROWS,
    CM_SCATTER_TRIGGER
} from '#shared/games/candymadness'
import { findGame } from '#shared/games/registry'
import { CANDY_INFO, candyDataUrl } from '~/utils/slots/candymadness-art'
import {
    CANDY_BONUS_ODDS,
    CANDY_HUNT_BONUS_ODDS,
    CANDY_PAY_SIZES,
    candyPaytable,
    formatPayMult
} from '~/utils/slots/candymadness-ui'

const open = defineModel<boolean>('open', { default: false })
defineProps<{ bet: number }>()

const rtp = Math.round(findGame('candymadness')!.rtp * 1000) / 10
const rows = candyPaytable()
const tab = ref<'rules' | 'pays'>('rules')
</script>

<template>
  <DialogRoot v-model:open="open">
    <DialogPortal>
      <DialogOverlay class="fixed inset-0 z-[100] bg-background/80 backdrop-blur-sm data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=closed]:animate-out data-[state=closed]:fade-out-0" />
      <DialogContent
        class="candy-theme fixed top-1/2 left-1/2 z-[101] flex max-h-[calc(100dvh-2rem)] w-[calc(100vw-2rem)] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-2xl bg-background shadow-lg ring ring-border focus:outline-none data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95 sm:max-h-[calc(100dvh-4rem)] max-w-[620px]"
        :aria-describedby="undefined"
      >
        <DialogTitle class="sr-only">
          Candy Madness rules
        </DialogTitle>
      <div class="cmr__panel">
        <header class="cmr__head">
          <div class="cmr__tabs">
            <button
              :class="{ on: tab === 'rules' }"
              :aria-pressed="tab === 'rules'"
              @click="tab = 'rules'"
            >
              How to play
            </button>
            <button
              :class="{ on: tab === 'pays' }"
              :aria-pressed="tab === 'pays'"
              @click="tab = 'pays'"
            >
              Paytable
            </button>
          </div>
          <button
            class="cmr__close"
            aria-label="Close"
            @click="open = false"
          >
            <XIcon />
          </button>
        </header>

        <div
          v-if="tab === 'rules'"
          class="cmr__body"
        >
          <section class="cmr__step">
            <span class="cmr__num">1</span>
            <div>
              <h3>Match clusters</h3>
              <p>
                The board is {{ CM_COLS }}×{{ CM_ROWS }}. Connect <b>{{ CM_MIN_CLUSTER }} or more</b> of the same candy
                side by side (not diagonally) to win. Bigger clusters pay more.
              </p>
            </div>
          </section>
          <section class="cmr__step">
            <span class="cmr__num">2</span>
            <div>
              <h3>Tumbles</h3>
              <p>
                Winning candies pop, everything above falls down and new candies drop in. This repeats until
                nothing new matches, so one spin can win several times.
              </p>
            </div>
          </section>
          <section class="cmr__step">
            <span class="cmr__num">3</span>
            <div>
              <h3>Multiplier spots</h3>
              <p>
                Each square where a candy pops lights up as a <b>×{{ CM_MULT_START }}</b> spot. Every later pop on the
                same square doubles it, up to <b>×{{ formatNumber(CM_MULT_CAP, false) }}</b>. When the tumbles stop,
                all spots are <b>added together</b> and your spin's total win is multiplied by that sum.
              </p>
            </div>
          </section>
          <section class="cmr__step cmr__step--bonus">
            <img
              :src="candyDataUrl('scatter', 96)"
              alt=""
              class="cmr__lolly"
            >
            <div>
              <h3>Free spins</h3>
              <p>
                Land <b>{{ CM_SCATTER_TRIGGER }} or more lollipops</b> anywhere for <b>{{ CM_FREE_SPINS }} free spins</b>
                (about 1 in {{ formatNumber(CANDY_BONUS_ODDS, false) }} spins). During free spins the multiplier spots
                <b>stay on the board</b> and keep growing, so late spins can pay far more than early ones.
              </p>
            </div>
          </section>

          <div class="cmr__grid">
            <div class="cmr__card">
              <h4>Buy Free Spins</h4>
              <p>Costs <b>{{ CM_BUY_FREESPINS_COST }}× bet</b>. Skips the base game and starts {{ CM_FREE_SPINS }} free spins.</p>
              <span class="cmr__price">{{ formatNumber(candyMadnessStake(bet, 'buyFreeSpins')) }}</span>
            </div>
            <div class="cmr__card">
              <h4>Bonus Hunter</h4>
              <p>
                Each spin costs <b>{{ CM_BONUS_HUNT_COST }}× bet</b> and always drops at least one lollipop. Free spins
                land about 1 in {{ formatNumber(CANDY_HUNT_BONUS_ODDS, false) }} spins.
              </p>
              <span class="cmr__price">{{ formatNumber(candyMadnessStake(bet, 'bonusHunt')) }} / spin</span>
            </div>
          </div>

          <ul class="cmr__facts">
            <li><span>Return to player</span><b>{{ rtp }}%</b></li>
            <li><span>Max win</span><b>{{ formatNumber(CM_MAX_WIN_MULT, false) }}× bet</b></li>
            <li><span>Controls</span><b>Space spins</b></li>
          </ul>
        </div>

        <div
          v-else
          class="cmr__body"
        >
          <p class="cmr__note">
            Wins per cluster, in × your bet, before multiplier spots. Multiplier spots boost the final coin win.
          </p>
          <div class="cmr__table-wrap">
            <table class="cmr__table">
              <thead>
                <tr>
                  <th />
                  <th
                    v-for="n in CANDY_PAY_SIZES"
                    :key="n"
                  >
                    {{ n }}{{ n === CANDY_PAY_SIZES[CANDY_PAY_SIZES.length - 1] ? '+' : '' }}
                  </th>
                </tr>
              </thead>
              <tbody>
                <tr
                  v-for="row in rows"
                  :key="row.sym"
                >
                  <th>
                    <img
                      :src="candyDataUrl(row.sym, 96)"
                      :alt="CANDY_INFO[row.sym].name"
                      :title="CANDY_INFO[row.sym].name"
                    >
                  </th>
                  <td
                    v-for="(p, i) in row.pays"
                    :key="i"
                    :class="{ top: i === row.pays.length - 1 }"
                  >
                    {{ formatPayMult(p) }}×
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
          <p class="cmr__note">
            At your current bet of {{ formatNumber(bet) }}, a 15+ cluster of hearts pays
            {{ formatNumber(bet * (rows[0]?.pays[CANDY_PAY_SIZES.length - 1] ?? 0)) }} before multipliers.
          </p>
        </div>
      </div>
      </DialogContent>
    </DialogPortal>
  </DialogRoot>
</template>

<style scoped>
.cmr__panel {
  width: 100%;
  max-height: inherit;
  min-height: 0;
  display: flex;
  flex-direction: column;
  color: var(--cmx-text);
  background: var(--candy-surface);
  overflow: hidden;
}

.cmr__head {
  display: flex;
  flex: none;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 16px 18px;
  border-bottom: 1px solid var(--candy-border);
}

.cmr__tabs {
  display: flex;
  gap: 4px;
  padding: 4px;
  border-radius: 10px;
  background: var(--candy-bg);
}

.cmr__tabs button {
  padding: 7px 14px;
  border-radius: 7px;
  font-weight: 500;
  font-size: 14px;
  color: var(--cmx-text-muted);
  cursor: pointer;
}

.cmr__tabs button.on {
  color: var(--cmx-text-highlighted);
  background: var(--candy-soft);
}

.cmr__close {
  display: grid;
  place-items: center;
  width: 36px;
  height: 36px;
  border-radius: 9px;
  color: var(--cmx-text-muted);
  background: var(--candy-bg);
  cursor: pointer;
}

.cmr__close:hover {
  color: var(--cmx-text-highlighted);
  background: var(--candy-soft);
}

.cmr__body {
  min-height: 0;
  overflow-y: auto;
  padding: 18px;
  display: flex;
  flex-direction: column;
  gap: 18px;
}

.cmr__step {
  display: flex;
  gap: 12px;
  align-items: flex-start;
}

.cmr__step h3 {
  font-family: 'Lilita One', system-ui, sans-serif;
  font-size: 19px;
  letter-spacing: 0.01em;
  color: var(--cmx-text-highlighted);
}

.cmr__step p {
  font-size: 14px;
  line-height: 1.6;
  color: var(--cmx-text-muted);
}

.cmr__step b {
  color: var(--cmx-text);
}

.cmr__num {
  flex: none;
  display: grid;
  place-items: center;
  width: 28px;
  height: 28px;
  margin-top: 2px;
  border-radius: 50%;
  font-weight: 600;
  color: var(--cmx-text-highlighted);
  background: var(--candy-soft);
  border: 1px solid var(--candy-border);
}

.cmr__step--bonus {
  padding: 14px;
  border-radius: 12px;
  background: var(--candy-soft);
  border: 1px solid var(--candy-border);
}

.cmr__lolly {
  width: 48px;
  height: 48px;
  flex: none;
}

.cmr__grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 10px;
}

@media (max-width: 520px) {
  .cmr__grid { grid-template-columns: 1fr; }
}

.cmr__card {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 14px;
  border-radius: 12px;
  background: var(--candy-bg);
  border: 1px solid var(--candy-border);
}

.cmr__card h4 {
  font-weight: 600;
  color: var(--cmx-text-highlighted);
}

.cmr__card p {
  font-size: 13px;
  line-height: 1.5;
  color: var(--cmx-text-muted);
}

.cmr__price {
  align-self: flex-start;
  margin-top: auto;
  padding: 3px 9px;
  border-radius: 6px;
  font-size: 13px;
  font-weight: 500;
  color: var(--cmx-text-highlighted);
  background: var(--candy-soft);
}

.cmr__facts {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 8px;
}

.cmr__facts li {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 3px;
  padding: 10px 4px;
  border-radius: 10px;
  background: var(--candy-elevated);
  text-align: center;
}

.cmr__facts span {
  font-size: 10px;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: var(--cmx-text-muted);
}

.cmr__facts b {
  font-size: 14px;
  color: var(--cmx-text-highlighted);
}

.cmr__note {
  font-size: 13px;
  line-height: 1.5;
  color: var(--cmx-text-muted);
}

.cmr__table-wrap {
  overflow-x: auto;
  border-radius: 12px;
  border: 1px solid var(--candy-border);
  background: var(--candy-bg);
}

.cmr__table {
  width: 100%;
  border-collapse: collapse;
  font-variant-numeric: tabular-nums;
}

.cmr__table thead th {
  padding: 10px 6px;
  font-size: 12px;
  font-weight: 600;
  color: var(--cmx-text-highlighted);
  text-align: right;
  white-space: nowrap;
}

.cmr__table tbody th {
  padding: 4px 8px;
}

.cmr__table tbody th img {
  width: 40px;
  height: 40px;
  display: block;
}

.cmr__table tbody tr:nth-child(odd) {
  background: var(--candy-elevated);
}

.cmr__table td {
  padding: 6px 8px;
  text-align: right;
  font-size: 13px;
  color: var(--cmx-text);
  white-space: nowrap;
}

.cmr__table td.top {
  font-weight: 600;
  color: var(--cmx-text-highlighted);
}

</style>
