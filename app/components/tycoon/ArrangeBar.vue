<script setup lang="ts">
import { Check, Hand, Package, ShoppingBag, Undo2, Users, X } from 'lucide-vue-next'
import { findGame } from '#shared/games/registry'
import { findDecor, type DecorType } from '#shared/decor'
import { formatCoins } from '#shared/money'
import { seatsOf } from '#shared/tycoon'
import type { ArrangeItem } from '~/utils/floor/types'
import { decorName } from '~/utils/decor-art'
import { gameIncomePerHour, specialGain, specialLift } from '~/utils/tycoon-art'

/**
 * Arrange mode's controls over the floor: a hint and Done at the top; at the
 * bottom the storage tray (put-away games and decorations, and the shop), or,
 * while something is in hand, a bar with its name, its price when it is a new
 * one, what a game's seats are worth, why it can't go where it hovers, Put
 * away and Cancel.
 */
const props = defineProps<{
    carrying: ArrangeItem | null
    /** Why the ghost can't stand where it is (from the floor), or null. */
    problem: string | null
    busy?: boolean
}>()
const emit = defineEmits<{ done: [], cancel: [], store: [], shop: [], take: [item: ArrangeItem] }>()

const tycoon = useTycoon()

/** Put-away decorations, one tile per type (tap: take one out). */
const stored = computed(() => {
    const groups = new Map<DecorType, { type: DecorType, ids: number[] }>()
    for (const d of tycoon.decor.value) {
        if (d.x !== null) continue
        const group = groups.get(d.type) ?? { type: d.type, ids: [] }
        group.ids.push(d.id)
        groups.set(d.type, group)
    }
    return [...groups.values()]
})
/** Put-away games (tap: place one). */
const storedGames = computed(() => tycoon.storedGames.value.filter(slug => (tycoon.state.value?.games[slug] ?? 0) >= 1))
const storedCount = computed(() => storedGames.value.length + stored.value.reduce((n, g) => n + g.ids.length, 0))

/**
 * A game in hand: its seats and what it earns on the floor, and whether it
 * can be put away (built, not under construction) or comes from storage.
 */
const game = computed(() => {
    const item = props.carrying
    const st = tycoon.state.value
    if (item?.kind !== 'game' || !st) return null
    const level = st.games[item.id] ?? 0
    const building = st.constructions.some(c => c.kind === 'game' && c.id === item.id)
    return {
        seats: seatsOf(item.id, level),
        earns: level >= 1 ? gameIncomePerHour(st, item.id, level, st.serverNow) : 0,
        building,
        fromStorage: !building && tycoon.storedGames.value.includes(item.id)
    }
})

const name = computed(() => {
    const item = props.carrying
    if (!item) return ''
    return item.kind === 'game' ? findGame(item.id)?.name ?? item.id : decorName(item.type)
})
/** A new decoration: dropping it buys it. */
const price = computed(() => (props.carrying?.kind === 'new' ? findDecor(props.carrying.type)?.chips ?? 0 : null))
const short = computed(() => price.value !== null && tycoon.chips.value < price.value)
/** A special in hand: what it adds on the floor, in coins an hour, and the kind of lift. */
const special = computed(() => {
    const item = props.carrying
    const st = tycoon.state.value
    if (!item || item.kind === 'game' || !st) return null
    const lift = specialLift(st, item.type, st.serverNow)
    return lift ? { gain: specialGain(st, item.type, st.serverNow), lift } : null
})

/** Touch screens drag the item; a mouse carries it and clicks where it goes. */
const touch = import.meta.client && window.matchMedia('(pointer: coarse)').matches
const hint = computed(() => {
    if (!props.carrying) return touch ? 'Tap something to lift it' : 'Click something to move it'
    const buy = props.carrying.kind === 'new'
    if (touch) return buy ? 'Tap a spot, then tap it again to buy' : 'Tap a spot, then tap it again to place'
    return buy ? 'Click a free spot to buy it' : 'Click a free spot'
})

/** The problem line shakes when it changes. */
const problemKey = ref(0)
watch(() => props.problem, (now, before) => now && now !== before && problemKey.value++)
</script>

<template>
  <div class="g-ui pointer-events-none absolute inset-0 z-10 flex flex-col p-2 sm:p-3">
    <div class="flex items-start justify-between gap-2">
      <span class="pill pointer-events-auto" title="Chips: build and decorate with them">
        <CasinoChipIcon class="size-6" />
        <TycoonCounter :value="tycoon.chips.value" class="g-num text-[15px] sm:text-lg" />
      </span>
      <button type="button" class="g-btn g-green pointer-events-auto h-11 rounded-full px-5 text-lg uppercase" @click="emit('done')">
        <Check class="size-5" :stroke-width="3.5" /> Done
      </button>
    </div>
    <div class="mt-2 flex justify-center">
      <Transition name="hint" mode="out-in">
        <p :key="hint" class="hint g-title flex items-center gap-2 rounded-full px-4 py-2 text-[15px] leading-none sm:text-lg">
          <Hand class="size-4.5 shrink-0 text-[#ffc93a]" :stroke-width="2.75" />{{ hint }}
        </p>
      </Transition>
    </div>
    <!-- What the specials on the floor do (and would, with the one in hand). Below the hint, so it never covers it or Done. -->
    <div class="mt-2 flex">
      <TycoonSpecialsPanel :carrying="carrying" @shop="emit('shop')" />
    </div>

    <div class="mt-auto flex justify-center">
      <Transition name="bar" mode="out-in">
        <!-- In hand -->
        <div v-if="carrying" key="carry" class="g-panel pointer-events-auto w-full max-w-[28rem] space-y-2 rounded-[24px] p-2.5">
          <div class="flex items-center gap-2.5">
            <span class="block size-12 shrink-0 overflow-hidden rounded-xl border-2 border-black/50">
              <TycoonGameArt v-if="carrying.kind === 'game'" :slug="carrying.id" />
              <TycoonDecorArt v-else :type="carrying.type" />
            </span>
            <span class="min-w-0 flex-1">
              <span class="g-title block truncate text-lg leading-tight">{{ name }}</span>
              <span v-if="problem" :key="problemKey" class="problem block truncate text-[13px] leading-4 font-semibold text-[#ff8a8a]">{{ problem }}</span>
              <TycoonSpecialStat v-else-if="special" class="mt-0.5" :lifts="[special.lift]" :gain="special.gain" />
              <span v-else-if="game && !game.building" class="block truncate text-[13px] leading-4 font-semibold" :class="game.fromStorage ? 'text-[#7ee08f]' : 'text-[#ffb35c]'" :title="game.fromStorage ? 'Placed, its seats take guests again' : 'Put away, its seats take no guests (it stays yours, and you can still play it)'">
                {{ game.fromStorage ? 'Place it' : 'Put away' }}: {{ game.fromStorage ? '+' : '−' }}{{ game.seats }} seat{{ game.seats === 1 ? '' : 's' }}<template v-if="game.earns > 0">, {{ game.fromStorage ? '+' : '−' }}{{ formatCoins(game.earns) }}/h</template>
              </span>
              <span v-else class="block truncate text-[13px] leading-4 font-semibold text-[var(--g-muted)]">{{ carrying.kind === 'game' ? 'Any room you own' : 'Any free spot in your rooms' }}</span>
            </span>
            <span v-if="price !== null" class="flex shrink-0 items-center rounded-xl bg-black/30 px-2.5 py-1.5 text-lg" :class="short ? 'text-[#ff8a8a]' : ''" :title="short ? 'Not enough chips' : 'Drop it to buy it'">
              <TycoonCost :amount="price" />
            </span>
          </div>
          <div class="flex gap-2">
            <button v-if="carrying.kind === 'decor'" type="button" class="g-btn g-dark h-11 flex-1 rounded-xl text-base" :disabled="busy" title="Back into storage (its bonus stops while it is away)" @click="emit('store')">
              <Package class="size-4.5" :stroke-width="2.75" /> Put away
            </button>
            <button
              v-else-if="game && !game.fromStorage"
              type="button"
              class="g-btn g-dark h-11 flex-1 rounded-xl text-base"
              :disabled="busy || game.building"
              :title="game.building ? 'A game under construction can\'t be put away' : `Into storage: ${game.seats} fewer seats until you place it again`"
              @click="emit('store')"
            >
              <Package class="size-4.5" :stroke-width="2.75" /> Put away
              <span v-if="!game.building" class="g-num flex items-center gap-0.5 rounded-full bg-black/30 px-1.5 text-[12px] leading-5 text-[#ffb35c]" :aria-label="`${game.seats} fewer seats`">−{{ game.seats }}<Users class="size-3.5" :stroke-width="3" /></span>
            </button>
            <button type="button" class="g-btn g-dark h-11 flex-1 rounded-xl text-base" @click="emit('cancel')">
              <component :is="carrying.kind === 'new' ? X : Undo2" class="size-4.5" :stroke-width="2.75" /> Cancel
            </button>
          </div>
        </div>

        <!-- Storage tray -->
        <div v-else key="tray" class="g-panel pointer-events-auto w-full max-w-[34rem] rounded-[24px] p-2.5">
          <p class="mb-1.5 flex items-center gap-1.5 px-0.5 text-[11px] font-bold tracking-wider text-[var(--g-muted)] uppercase">
            <Package class="size-3.5" :stroke-width="3" /> Storage
            <span v-if="storedCount" class="g-num ml-auto">{{ storedCount }}</span>
          </p>
          <div class="tray flex gap-2 overflow-x-auto pb-0.5">
            <button type="button" class="slot shop shrink-0" title="Buy decorations" @click="emit('shop')">
              <ShoppingBag class="size-6" :stroke-width="2.75" />
              <span class="text-[11px] leading-none uppercase">Shop</span>
            </button>
            <button
              v-for="slug in storedGames"
              :key="`game:${slug}`"
              type="button"
              class="slot relative shrink-0 overflow-hidden"
              :title="`${findGame(slug)?.name ?? slug}: tap to place it`"
              :aria-label="`Place ${findGame(slug)?.name ?? slug}`"
              :disabled="busy"
              @click="emit('take', { kind: 'game', id: slug })"
            >
              <TycoonGameArt :slug="slug" />
            </button>
            <button
              v-for="g in stored"
              :key="g.type"
              type="button"
              class="slot relative shrink-0 overflow-hidden"
              :title="`${decorName(g.type)}: tap to place it`"
              :disabled="busy"
              @click="emit('take', { kind: 'decor', id: g.ids[0]!, type: g.type })"
            >
              <TycoonDecorArt :type="g.type" />
              <span v-if="g.ids.length > 1" class="g-num absolute right-0.5 bottom-0.5 rounded-full border-2 border-black/50 bg-[#1b1329]/90 px-1 text-[11px] leading-3.5">×{{ g.ids.length }}</span>
            </button>
            <p v-if="!storedCount" class="flex min-w-0 items-center px-1 text-[12.5px] leading-4 text-[var(--g-muted)]">Put-away games and decorations wait here.</p>
          </div>
        </div>
      </Transition>
    </div>
  </div>
</template>

<style scoped>
.pill {
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  height: 2.75rem;
  padding: 0 0.9rem 0 0.4rem;
  border-radius: 999px;
  background: linear-gradient(180deg, #1b1329, #241a36);
  border: 2px solid #0e0917;
  box-shadow: 0 3px 0 #0e0917, inset 0 2px 0 rgb(0 0 0 / 0.35);
}
.hint {
  background: rgb(18 12 29 / 0.82);
  border: 2px solid rgb(0 0 0 / 0.5);
  box-shadow: 0 3px 0 rgb(0 0 0 / 0.35);
}
.slot {
  display: grid;
  place-items: center;
  width: 3.5rem;
  height: 3.5rem;
  border-radius: 0.9rem;
  border: 2px solid rgb(0 0 0 / 0.5);
  box-shadow: 0 3px 0 rgb(0 0 0 / 0.35);
  transition: transform 0.12s ease;
}
.slot:active { transform: translateY(2px) scale(0.95); }
.slot.shop {
  gap: 0.2rem;
  align-content: center;
  background: linear-gradient(180deg, #ff9ac4, #ff7ab0 55%, #e0558f);
  border-color: #9c2f62;
  font-family: var(--font-game);
  color: #fff;
  text-shadow: 0 1.5px 0 rgb(0 0 0 / 0.35);
}
.tray { scrollbar-width: none; }
.problem { animation: nudge 0.3s ease; }
@keyframes nudge {
  25% { transform: translateX(-3px); }
  75% { transform: translateX(3px); }
}
.hint-enter-active, .hint-leave-active { transition: opacity 0.14s ease, transform 0.14s ease; }
.hint-enter-from, .hint-leave-to { opacity: 0; transform: translateY(-4px); }
.bar-enter-active { transition: transform 0.24s cubic-bezier(0.3, 1.4, 0.5, 1), opacity 0.15s ease; }
.bar-leave-active { transition: transform 0.12s ease, opacity 0.12s ease; }
.bar-enter-from, .bar-leave-to { opacity: 0; transform: translateY(14px); }
@media (prefers-reduced-motion: reduce) {
  .problem { animation: none; }
  .bar-enter-active, .bar-leave-active, .hint-enter-active, .hint-leave-active { transition: opacity 0.12s ease; }
  .bar-enter-from, .bar-leave-to, .hint-enter-from, .hint-leave-to { transform: none; }
}
</style>
