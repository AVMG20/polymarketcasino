<script setup lang="ts">
import { ArrowBigUpDash, Check, PaintRoller } from 'lucide-vue-next'
import { UPGRADES, type ZoneId } from '#shared/tycoon'

/**
 * What a zone opens besides its floor space (the rows above say that): the
 * upgrade levels that wait for it, and, once the zone is open, its skins
 * (previewed live on the floor). Games don't belong to a room: they unlock
 * with the casino level and stand in any room you own.
 */
const props = defineProps<{ id: ZoneId }>()
const tycoon = useTycoon()

/** Upgrades with a level that needs this zone: the first such level. */
const upgrades = computed(() => UPGRADES.flatMap((upgrade) => {
    const index = upgrade.requiresZone.indexOf(props.id)
    if (index < 0) return []
    const have = tycoon.state.value?.upgrades[upgrade.id] ?? 0
    return [{ id: upgrade.id, name: upgrade.name, level: index + 1, reached: have > index }]
}))
const owned = computed(() => !!tycoon.state.value?.zones.includes(props.id))
</script>

<template>
  <div class="space-y-3">
    <div v-if="upgrades.length" class="g-well rounded-2xl p-2">
      <p class="mb-1.5 flex items-center gap-1.5 px-1 text-[11px] font-semibold tracking-wider text-[var(--g-muted)] uppercase"><ArrowBigUpDash class="size-3.5" :stroke-width="3" /> Opens upgrades</p>
      <div class="grid grid-cols-3 gap-1.5 sm:grid-cols-4">
        <div v-for="u in upgrades" :key="u.id" class="flex min-w-0 flex-col items-center gap-1 rounded-xl p-1" :title="`${u.name} level ${u.level} needs this room`">
          <span class="relative block aspect-square w-full overflow-hidden rounded-xl border-2 border-black/50">
            <TycoonItemArt kind="upgrade" :id="u.id" />
            <span class="g-num absolute bottom-0.5 left-0.5 rounded-full border-2 border-black/50 bg-[#1b1329]/90 px-1 text-[10px] leading-3.5">Lv {{ u.level }}</span>
            <span v-if="u.reached" class="absolute top-0.5 right-0.5 grid size-4 place-items-center rounded-full border-[1.5px] border-black/50 bg-[#3fd25a]"><Check class="size-2.5 text-white" :stroke-width="4" /></span>
          </span>
          <span class="w-full truncate text-center text-[11px] leading-3.5 font-semibold">{{ u.name }}</span>
        </div>
      </div>
    </div>

    <div v-if="owned" class="space-y-2">
      <p class="flex items-center gap-1.5 px-1 text-[11px] font-semibold tracking-wider text-[var(--g-muted)] uppercase"><PaintRoller class="size-3.5" :stroke-width="3" /> Skin</p>
      <TycoonSkinPicker :zone="id" />
    </div>
  </div>
</template>
