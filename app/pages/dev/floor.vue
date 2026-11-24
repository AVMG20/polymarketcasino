<script setup lang="ts">
import { PLOTS } from '#shared/floor/layout'
import { TYCOON_GAMES, ZONES, type ZoneId } from '#shared/tycoon'
import CasinoFloor from '~/components/tycoon/CasinoFloor.vue'
import type { FloorApi, FloorPlot, FloorScene, FloorTarget } from '~/utils/floor/types'

/**
 * Dev only: the casino floor on a mock scene, with controls for every state
 * and buttons for every FloorApi effect.
 */
if (!import.meta.dev) throw createError({ statusCode: 404, statusMessage: 'Not found', fatal: true })

definePageMeta({ layout: false })
useHead({ title: 'Floor (dev)' })

const zonesOwned = ref(1)
const zoneBuilding = ref(false)
const level = ref(1)
const building = ref(false)
const golden = ref(false)
const decor = ref(0)
const rush = ref(false)
const guestsPerHour = ref(40)
const cageFill = ref(0.4)
const seated = ref(2)
const paused = ref(false)
const phone = ref(false)
const log = ref<string[]>([])
const floor = ref<FloorApi | null>(null)
const playingOn = ref(false)

const NAMES = ['Alice', 'Bram', 'Chen', 'Dewi', 'Eli', 'Fenna', 'Gijs']

const scene = computed<FloorScene>(() => {
    const now = Date.now()
    const owned = new Set<ZoneId>(ZONES.slice(0, zonesOwned.value).map(z => z.id))
    const next = ZONES[zonesOwned.value]
    const zones = ZONES.map(z => ({
        id: z.id,
        owned: owned.has(z.id),
        available: !!next && z.id === next.id && !zoneBuilding.value,
        construction: zoneBuilding.value && next && z.id === next.id ? { startedAt: now - 40_000, readyAt: now + 95_000 } : null
    }))
    const plots: FloorPlot[] = TYCOON_GAMES.map((g, i) => {
        const zoneOwned = owned.has(g.zone)
        const lv = g.starter ? Math.max(1, level.value) : level.value
        const isBuilding = zoneOwned && building.value && i % 3 === 1
        let status: FloorPlot['status'] = 'locked'
        if (zoneOwned) status = isBuilding ? 'building' : lv >= 1 ? 'built' : 'available'
        if (zoneOwned && !isBuilding && lv === 0 && i % 5 === 4) status = 'locked'
        const live = g.archetype === 'cards'
        return {
            id: g.slug,
            archetype: g.archetype,
            accent: g.accent,
            zone: g.zone,
            status,
            rect: PLOTS[g.slug]?.rect ?? null,
            level: status === 'built' || status === 'building' ? (isBuilding ? Math.max(0, lv - 1) : lv) : 0,
            golden: golden.value && i % 2 === 0,
            construction: isBuilding ? { startedAt: now - 20_000, readyAt: now + 60_000 * (1 + i) } : null,
            occupancy: live ? { seated: NAMES.slice(0, seated.value).map(name => ({ name, image: null })), seats: g.slug === 'blackjack' ? 5 : 6 } : null
        }
    })
    return {
        zones,
        plots,
        decorations: [],
        cage: { fill: cageFill.value, stored: Math.round(cageFill.value * 1200) },
        decor: decor.value,
        guestsPerHour: guestsPerHour.value,
        rush: rush.value,
        player: { name: 'Arno', image: null },
        clockOffset: 0
    }
})

function onInteract(t: FloorTarget) {
    log.value = [`interact ${JSON.stringify(t)}`, ...log.value].slice(0, 8)
}

function builtSlug(): string {
    const built = scene.value.plots.filter(p => p.status === 'built')
    return built[Math.floor(Math.random() * built.length)]?.id ?? 'plinko'
}

function celebrate(big: boolean) {
    const slug = builtSlug()
    floor.value?.celebrate(slug, { payout: big ? 25_000 : 180, stake: 100, chipsEarned: big ? 0 : 3.5, big })
}

function togglePlaying() {
    playingOn.value = !playingOn.value
    for (const p of scene.value.plots) floor.value?.playing(p.id, playingOn.value)
}
</script>

<template>
  <div class="flex h-dvh flex-col bg-background text-foreground lg:flex-row">
    <div class="relative min-h-0 flex-1" :class="phone ? 'flex items-center justify-center bg-black/40' : ''">
      <div :class="phone ? 'relative h-[760px] max-h-full w-[390px] overflow-hidden rounded-2xl border border-border' : 'absolute inset-0'">
        <CasinoFloor ref="floor" class="absolute inset-0" :scene="scene" :paused="paused" @interact="onInteract" />
      </div>
    </div>
    <aside class="max-h-[45dvh] shrink-0 space-y-3 overflow-y-auto border-t border-border p-3 text-sm lg:max-h-none lg:w-80 lg:border-l lg:border-t-0">
      <h1 class="font-semibold">
        Floor (dev)
      </h1>
      <label class="block">Zones owned: {{ zonesOwned }}
        <input v-model.number="zonesOwned" type="range" min="1" max="6" class="w-full">
      </label>
      <label class="flex items-center gap-2"><input v-model="zoneBuilding" type="checkbox"> Next zone under construction</label>
      <label class="block">Game level: {{ level }}
        <input v-model.number="level" type="range" min="0" max="5" class="w-full">
      </label>
      <label class="flex items-center gap-2"><input v-model="building" type="checkbox"> Some games building</label>
      <label class="flex items-center gap-2"><input v-model="golden" type="checkbox"> Golden skins</label>
      <label class="block">Decor: {{ decor }}
        <input v-model.number="decor" type="range" min="0" max="5" class="w-full">
      </label>
      <label class="block">Guests per hour: {{ guestsPerHour }}
        <input v-model.number="guestsPerHour" type="range" min="0" max="4000" step="20" class="w-full">
      </label>
      <label class="flex items-center gap-2"><input v-model="rush" type="checkbox"> Guest rush</label>
      <label class="block">Cage fill: {{ Math.round(cageFill * 100) }}%
        <input v-model.number="cageFill" type="range" min="0" max="1" step="0.05" class="w-full">
      </label>
      <label class="block">Seated at card tables: {{ seated }}
        <input v-model.number="seated" type="range" min="0" max="6" class="w-full">
      </label>
      <label class="flex items-center gap-2"><input v-model="paused" type="checkbox"> Paused</label>
      <label class="flex items-center gap-2"><input v-model="phone" type="checkbox"> Phone frame (390px)</label>
      <div class="grid grid-cols-2 gap-2">
        <button class="rounded-lg bg-secondary px-2 py-2" @click="celebrate(false)">
          Celebrate
        </button>
        <button class="rounded-lg bg-secondary px-2 py-2" @click="celebrate(true)">
          Big win
        </button>
        <button class="rounded-lg bg-secondary px-2 py-2" @click="togglePlaying">
          Playing {{ playingOn ? 'off' : 'on' }}
        </button>
        <button class="rounded-lg bg-secondary px-2 py-2" @click="floor?.collected(350, { currency: 'coins' })">
          Collected
        </button>
        <button class="rounded-lg bg-secondary px-2 py-2" @click="floor?.walkTo({ kind: 'cage' })">
          Walk to cage
        </button>
        <button class="rounded-lg bg-secondary px-2 py-2" @click="floor?.walkTo({ kind: 'builder' })">
          Walk to desk
        </button>
        <button class="rounded-lg bg-secondary px-2 py-2" @click="floor?.walkTo({ kind: 'game', id: 'plinko' })">
          Walk to Pegfall
        </button>
        <button class="rounded-lg bg-secondary px-2 py-2" @click="ZONES[zonesOwned] && floor?.walkTo({ kind: 'zone', id: ZONES[zonesOwned]!.id })">
          Walk to sale
        </button>
        <button class="rounded-lg bg-secondary px-2 py-2" @click="floor?.focus({ kind: 'game', id: 'roulette' })">
          Focus roulette
        </button>
        <button class="rounded-lg bg-secondary px-2 py-2" @click="floor?.focus({ kind: 'cage' })">
          Focus cage
        </button>
      </div>
      <ul class="space-y-1 font-mono text-xs text-muted-foreground">
        <li v-for="(line, i) in log" :key="i">
          {{ line }}
        </li>
      </ul>
    </aside>
  </div>
</template>
