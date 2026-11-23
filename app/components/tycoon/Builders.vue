<script setup lang="ts">
import { ArrowRight, HardHat, LayoutGrid, Lock, Plus } from 'lucide-vue-next'
import { BUILDER_GEMS, MAX_BUILDERS, type BuildKind } from '#shared/tycoon'
import type { QueuedConstruction } from '~/composables/useTycoon'

/**
 * One row per builder slot. A busy builder shows what it builds (art, name,
 * the level it reaches), a progress bar with the time left and the gem skip;
 * an idle one an empty "Free" slot that opens the build menu; a slot not
 * hired yet says how to get it: the Construction Crew (chips, after the Slot
 * Lounge) or the gem builder.
 */
const emit = defineEmits<{ build: [], open: [kind: BuildKind, id: string] }>()
const tycoon = useTycoon()
const state = computed(() => tycoon.state.value)
const builders = computed(() => state.value?.builders ?? 1)
const gems = computed(() => tycoon.gems.value ?? 0)
const crew = computed(() => tycoon.view('upgrade', 'crew'))

type Slot =
    | { kind: 'busy', item: QueuedConstruction }
    | { kind: 'free' }
    | { kind: 'crew' }
    | { kind: 'gem' }

const slots = computed<Slot[]>(() => {
    const out: Slot[] = Array.from({ length: builders.value }, (_, i) => {
        const item = tycoon.queue.value[i]
        return item ? { kind: 'busy' as const, item } : { kind: 'free' as const }
    })
    // The slots still to hire, one per missing source.
    if ((state.value?.upgrades.crew ?? 0) < 1) out.push({ kind: 'crew' })
    if (!state.value?.gemBuilder) out.push({ kind: 'gem' })
    return out.slice(0, MAX_BUILDERS)
})

const gemBlocker = computed(() => {
    if (!state.value?.gemsEnabled) return 'Gems need a Polynux account'
    if (gems.value < BUILDER_GEMS) return 'Not enough gems'
    return null
})

function hire() {
    if (gemBlocker.value || tycoon.busy.value) return
    void tycoon.buyGem('builder')
}
</script>

<template>
  <ul class="space-y-2">
    <li
      v-for="(slot, i) in slots"
      :key="slot.kind === 'busy' ? `${slot.item.kind}:${slot.item.id}` : `${slot.kind}-${i}`"
      class="flex min-h-[4.25rem] items-center gap-2.5 rounded-2xl p-2"
      :class="slot.kind === 'busy' || slot.kind === 'free' ? 'g-well' : 'border-2 border-dashed border-white/12'"
    >
      <!-- The builder -->
      <span
        class="avatar grid size-10 shrink-0 place-items-center rounded-full"
        :class="slot.kind === 'busy' || slot.kind === 'free' ? 'avatar-on' : 'avatar-off'"
        :title="slot.kind === 'busy' || slot.kind === 'free' ? `Builder ${i + 1}` : 'Not hired yet'"
      >
        <HardHat v-if="slot.kind === 'busy' || slot.kind === 'free'" class="size-5 text-[#7a4a00]" :stroke-width="2.75" />
        <Lock v-else class="size-4 text-white/45" :stroke-width="3" />
      </span>

      <!-- Building something -->
      <template v-if="slot.kind === 'busy'">
        <button type="button" class="size-12 shrink-0 overflow-hidden rounded-xl border-2 border-black/50" :aria-label="`${buildName(slot.item.kind, slot.item.id)} details`" @click="emit('open', slot.item.kind, slot.item.id)">
          <TycoonItemArt :kind="slot.item.kind" :id="slot.item.id" />
        </button>
        <span class="min-w-0 flex-1 space-y-1.5">
          <span class="flex items-center gap-1.5">
            <span class="truncate text-sm font-semibold">{{ buildName(slot.item.kind, slot.item.id) }}</span>
            <span v-if="slot.item.kind !== 'zone' && slot.item.id !== 'crew'" class="g-num flex shrink-0 items-center gap-0.5 text-xs text-[#ffc93a]"><ArrowRight class="size-3" :stroke-width="3" />Lv {{ slot.item.level }}</span>
          </span>
          <TycoonBuildBar :progress="1 - slot.item.leftMs / slot.item.total" :left-ms="slot.item.leftMs" size="sm" />
        </span>
        <TycoonSkipButton class="h-11 shrink-0 rounded-xl px-2.5 text-base" :left-ms="slot.item.leftMs" :target="`${slot.item.kind}:${slot.item.id}`" />
      </template>

      <!-- Idle -->
      <template v-else-if="slot.kind === 'free'">
        <span class="grid h-12 min-w-0 flex-1 place-items-center rounded-xl border-2 border-dashed border-white/20 text-sm font-semibold text-[var(--g-muted)]">Free</span>
        <button type="button" class="g-btn g-green h-11 shrink-0 rounded-xl px-3 text-base" title="Build menu" @click="emit('build')">
          <LayoutGrid class="size-4" :stroke-width="3" /> Build
        </button>
      </template>

      <!-- Not hired: the Construction Crew (chips) -->
      <template v-else-if="slot.kind === 'crew'">
        <span class="min-w-0 flex-1">
          <span class="block truncate text-sm font-semibold">Construction Crew</span>
          <span class="block truncate text-xs text-[var(--g-muted)]">{{ crew.running ? 'On its way' : crew.lockZone ? `Open the ${crew.lockZone} first` : 'Build it with chips' }}</span>
        </span>
        <button
          type="button"
          class="g-btn h-11 shrink-0 rounded-xl px-2.5 text-base"
          :class="crew.lockZone || crew.running || !crew.affordable ? 'g-off' : 'g-green'"
          :title="crew.lockZone ? `Opens with the ${crew.lockZone}` : 'Construction Crew: one more builder'"
          @click="emit('open', 'upgrade', 'crew')"
        >
          <HardHat class="size-4 shrink-0" :stroke-width="2.75" />
          <TycoonCost v-if="crew.cost" :amount="crew.cost.chips" compact />
        </button>
      </template>

      <!-- Not hired: the gem builder -->
      <template v-else>
        <span class="min-w-0 flex-1">
          <span class="block truncate text-sm font-semibold">Gem builder</span>
          <span class="block truncate text-xs text-[var(--g-muted)]">Hire one for good</span>
        </span>
        <button
          type="button"
          class="g-btn h-11 shrink-0 rounded-xl px-2.5 text-base"
          :class="gemBlocker ? 'g-off' : 'g-gem'"
          :aria-disabled="!!gemBlocker"
          :disabled="tycoon.busy.value"
          :title="gemBlocker ?? `Hire a builder for ${BUILDER_GEMS} gems`"
          @click="hire"
        >
          <Plus class="size-4" :stroke-width="3.5" /><TycoonCost :amount="BUILDER_GEMS" currency="gems" />
        </button>
      </template>
    </li>
  </ul>
</template>

<style scoped>
.avatar-on {
  background: radial-gradient(circle at 35% 28%, #ffe08a, #ffc93a 55%, #e0a21c);
  border: 2px solid rgb(0 0 0 / 0.5);
  box-shadow: inset 0 2px 0 rgb(255 255 255 / 0.45), 0 2px 0 rgb(0 0 0 / 0.35);
}
.avatar-off {
  border: 2px dashed rgb(255 255 255 / 0.25);
}
</style>
