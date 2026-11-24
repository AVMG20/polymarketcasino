<script setup lang="ts">
import { ArrowBigUpDash, Hammer, LayoutGrid, Store } from 'lucide-vue-next'
import { TYCOON_GAMES, UPGRADES, ZONES, type BuildKind } from '#shared/tycoon'

/** The build menu: icon tabs over a grid of tiles; a tile opens its detail card in place. */
const props = defineProps<{ open: boolean, tab?: string }>()
const emit = defineEmits<{ close: [], play: [slug: string] }>()

const tycoon = useTycoon()
const tab = ref('games')
const selected = ref<{ kind: BuildKind, id: string } | null>(null)
/** The builders list under the header (tap the crane). */
const buildersOpen = ref(false)
watch(() => props.open, (open) => {
    if (open) {
        tab.value = props.tab || 'games'
        selected.value = null
        buildersOpen.value = false
    }
})
watch(tab, () => (selected.value = null))

const TABS = [
    { value: 'zones', label: 'Zones', icon: Store, color: '#ff9f1c', kind: 'zone' as BuildKind },
    { value: 'games', label: 'Games', icon: LayoutGrid, color: '#4aa6ff', kind: 'game' as BuildKind },
    { value: 'upgrades', label: 'Upgrades', icon: ArrowBigUpDash, color: '#ff5470', kind: 'upgrade' as BuildKind },
    { value: 'gems', label: 'Gems', icon: null, color: '#2fe0d0', kind: null }
]

const items = computed(() => {
    if (tab.value === 'zones') return ZONES.filter(z => z.requires !== null).map(z => ({ kind: 'zone' as const, id: z.id }))
    if (tab.value === 'upgrades') return UPGRADES.map(u => ({ kind: 'upgrade' as const, id: u.id }))
    return TYCOON_GAMES.map(g => ({ kind: 'game' as const, id: g.slug }))
})
const ready = computed(() => {
    const counts: Record<string, number> = { zone: 0, game: 0, upgrade: 0 }
    for (const item of tycoon.startable.value) counts[item.kind]!++
    return counts
})

const builders = computed(() => tycoon.state.value?.builders ?? 1)
const working = computed(() => tycoon.queue.value.length)

/** From the builders list: open one item (the Construction Crew, a running build) in place. */
async function openItem(kind: BuildKind, id: string) {
    buildersOpen.value = false
    tab.value = kind === 'zone' ? 'zones' : kind === 'upgrade' ? 'upgrades' : 'games'
    await nextTick()
    selected.value = { kind, id }
}
</script>

<template>
  <TycoonDrawer :open="open" title="Build" :icon="Hammer" color="#3fd25a" height="66dvh" @close="emit('close')">
    <template #extra>
      <!-- Builders: a crane that works while something is built, and how many builders are busy. Tap for the list. -->
      <button
        type="button"
        class="g-btn h-11 shrink-0 gap-1! rounded-full pr-3 pl-1.5"
        :class="buildersOpen ? 'g-purple' : 'g-dark'"
        :title="`Builders busy: ${working} of ${builders}`"
        :aria-expanded="buildersOpen"
        :aria-label="`Builders, ${working} of ${builders} busy`"
        @click="buildersOpen = !buildersOpen"
      >
        <TycoonCrane :active="working > 0" class="size-8" />
        <span class="g-num text-base leading-none" :class="working >= builders ? 'text-[#ffc93a]' : ''">{{ working }}/{{ builders }}</span>
      </button>
    </template>

    <Transition name="pop">
      <div v-if="buildersOpen" class="px-3 pb-3">
        <TycoonBuilders @build="buildersOpen = false; tab = 'games'; selected = null" @open="openItem" />
      </div>
    </Transition>

    <div class="sticky top-0 z-10 grid grid-cols-4 gap-2 bg-gradient-to-b from-[#33264f] from-80% to-transparent px-3 pt-1 pb-3">
      <button
        v-for="t in TABS"
        :key="t.value"
        type="button"
        class="g-btn relative h-14 flex-col gap-0.5! rounded-2xl text-[11px] uppercase"
        :class="tab === t.value ? '' : 'g-dark opacity-90'"
        :style="tab === t.value ? { '--face': t.color, '--edge': `color-mix(in oklab, ${t.color} 55%, black)` } : undefined"
        :aria-pressed="tab === t.value"
        @click="tab = t.value"
      >
        <component :is="t.icon" v-if="t.icon" class="size-6" :stroke-width="2.75" />
        <CasinoGemIcon v-else class="size-6 text-[#bff8f2]" />
        {{ t.label }}
        <span v-if="t.kind && ready[t.kind]" class="absolute -top-1.5 -right-1.5 grid size-5 place-items-center rounded-full border-2 border-white bg-[#ff3b5c] text-[10px] leading-none">{{ ready[t.kind] }}</span>
      </button>
    </div>

    <TycoonGemShop v-if="tab === 'gems'" />
    <TycoonBuildDetail v-else-if="selected" :kind="selected.kind" :id="selected.id" back @back="selected = null" @started="selected = null" @play="slug => emit('play', slug)" @open="openItem" />
    <div v-else class="grid grid-cols-3 gap-2 px-3 pb-4 sm:gap-2.5">
      <TycoonBuildTile
        v-for="item in items"
        :key="`${item.kind}:${item.id}`"
        :kind="item.kind"
        :id="item.id"
        :suggested="tycoon.suggestion.value === `${item.kind}:${item.id}`"
        @open="selected = item"
      />
    </div>
  </TycoonDrawer>
</template>

<style scoped>
.pop-enter-active { transition: transform 0.18s cubic-bezier(0.3, 1.4, 0.5, 1), opacity 0.15s ease; }
.pop-leave-active { transition: opacity 0.12s ease; }
.pop-enter-from, .pop-leave-to { opacity: 0; transform: scale(0.96); }
</style>
