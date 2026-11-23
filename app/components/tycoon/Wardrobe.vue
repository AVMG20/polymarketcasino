<script setup lang="ts">
import { Check, Crown, Glasses, Lock, PaintRoller, Shirt } from 'lucide-vue-next'
import { cosmeticsIn, findCosmetic, isFree, type AvatarLook, type AvatarSlot, type CosmeticDef } from '#shared/cosmetics'
import { ZONES, type ZoneId } from '#shared/tycoon'
import type { WardrobeTab } from '~/composables/useCosmetics'

/**
 * The wardrobe: your avatar turning on a spotlight, wearing what you try on.
 * Tabs for hats, outfits and accessories (tap to try, then wear or buy), and
 * Rooms: a skin for each zone you own, previewed live on the floor.
 * Opened by tapping your own avatar on the floor, or from the shop.
 */
const tycoon = useTycoon()
const cosmetics = useCosmetics()
const session = useCasinoSession()

const open = computed(() => cosmetics.wardrobe.value.open)
const tab = computed({
    get: () => cosmetics.wardrobe.value.tab,
    set: (value: WardrobeTab) => (cosmetics.wardrobe.value = { ...cosmetics.wardrobe.value, tab: value })
})
const name = computed(() => session.player.value?.name ?? 'You')
const worn = computed(() => cosmetics.state.value.avatar)
/** Items being tried on, per slot (not bought or worn yet). */
const trial = ref<Partial<AvatarLook>>({})
const look = computed<AvatarLook>(() => ({ ...worn.value, ...trial.value }))

watch(open, (value) => {
    if (value) trial.value = {}
    else cosmetics.preview.value = null
})

const TABS: { value: WardrobeTab, label: string, icon: typeof Crown, color: string }[] = [
    { value: 'hat', label: 'Hats', icon: Crown, color: '#ffc93a' },
    { value: 'outfit', label: 'Outfits', icon: Shirt, color: '#4aa6ff' },
    { value: 'accessory', label: 'Extras', icon: Glasses, color: '#ff5470' },
    { value: 'rooms', label: 'Rooms', icon: PaintRoller, color: '#3fd25a' }
]
const slot = computed<AvatarSlot | null>(() => (tab.value === 'rooms' ? null : tab.value))
const items = computed(() => (slot.value ? cosmeticsIn(slot.value) : []))
/** The item of this tab on the preview (tried on, or worn). */
const selected = computed<CosmeticDef | null>(() => (slot.value ? findCosmetic(`${slot.value}:${look.value[slot.value]}`) ?? null : null))
const shake = ref(0)

function tryOn(item: CosmeticDef) {
    if (item.slot === 'skin') return
    trial.value = { ...trial.value, [item.slot]: item.id }
}

async function act() {
    const item = selected.value
    if (!item || item.slot === 'skin') return
    if (worn.value[item.slot] === item.id) return
    if (cosmetics.owns(item.key)) {
        if (await cosmetics.equip(item.key)) dropTrial(item.slot)
        return
    }
    if (cosmetics.blocker(item)) {
        shake.value++
        return
    }
    if (await cosmetics.buy(item)) dropTrial(item.slot)
}

function dropTrial(key: AvatarSlot) {
    const next = { ...trial.value }
    delete next[key]
    trial.value = next
}

// Rooms: the zones you own; the one picked is framed on the floor while its skins show.
const ownedZones = computed(() => ZONES.filter(zone => tycoon.state.value?.zones.includes(zone.id)))
const room = computed<ZoneId>({
    get: () => {
        const z = cosmetics.wardrobe.value.zone
        return z && ownedZones.value.some(o => o.id === z) ? z : ownedZones.value[ownedZones.value.length - 1]?.id ?? 'backroom'
    },
    set: (value: ZoneId) => (cosmetics.wardrobe.value = { ...cosmetics.wardrobe.value, zone: value })
})
</script>

<template>
  <TycoonDrawer :open="open" title="Wardrobe" :icon="Shirt" color="#a879ff" height="78dvh" @close="cosmetics.hide()">
    <div class="sticky top-0 z-10 grid grid-cols-4 gap-2 bg-gradient-to-b from-[#33264f] from-80% to-transparent px-3 pt-1 pb-3">
      <button
        v-for="t in TABS"
        :key="t.value"
        type="button"
        class="g-btn h-14 flex-col gap-0.5! rounded-2xl text-[11px] uppercase"
        :class="tab === t.value ? '' : 'g-dark opacity-90'"
        :style="tab === t.value ? { '--face': t.color, '--edge': `color-mix(in oklab, ${t.color} 55%, black)` } : undefined"
        :aria-pressed="tab === t.value"
        @click="tab = t.value"
      >
        <component :is="t.icon" class="size-6" :stroke-width="2.75" />
        {{ t.label }}
      </button>
    </div>

    <div v-if="slot" class="space-y-3 px-3 pb-4">
      <!-- The preview: your avatar on a spotlight, wearing what you try on. -->
      <div class="stage relative flex items-end justify-center gap-3 overflow-hidden rounded-[22px] px-3 pt-2 pb-3">
        <div class="spot absolute inset-x-0 bottom-2 mx-auto h-8 w-40 rounded-[50%]" />
        <TycoonAvatarPortrait :name="name" :avatar="look" crop="full" :size="150" animate class="relative" />
      </div>

      <div class="grid grid-cols-3 gap-2 sm:grid-cols-4">
        <button
          v-for="item in items"
          :key="item.key"
          type="button"
          class="item relative flex flex-col items-center rounded-2xl p-1 pb-1.5 transition-transform active:scale-95"
          :class="selected?.key === item.key ? 'picked' : ''"
          :aria-pressed="selected?.key === item.key"
          :aria-label="`${item.name}${worn[item.slot as AvatarSlot] === item.id ? ' (worn)' : cosmetics.owns(item.key) ? ' (owned)' : ''}`"
          :title="item.name"
          @click="tryOn(item)"
        >
          <span class="relative grid aspect-square w-full place-items-center overflow-hidden rounded-xl bg-black/30" :class="item.premium ? 'g-gem-glow' : ''">
            <TycoonAvatarPortrait :name="name" :avatar="{ ...worn, [item.slot]: item.id }" :size="80" />
            <span v-if="worn[item.slot as AvatarSlot] === item.id" class="absolute top-1 right-1 grid size-5 place-items-center rounded-full border-2 border-black/50 bg-[#3fd25a]"><Check class="size-3 text-white" :stroke-width="4" /></span>
          </span>
          <span class="mt-1 w-full truncate text-center text-[12px] leading-4 font-semibold">{{ item.name }}</span>
          <span class="mt-0.5 flex h-5 items-center text-[13px]">
            <span v-if="isFree(item) || cosmetics.owns(item.key)" class="text-[11px] font-semibold text-[var(--g-muted)] uppercase">{{ isFree(item) ? 'Free' : 'Owned' }}</span>
            <TycoonCost v-else :amount="item.gems" currency="gems" compact />
          </span>
        </button>
      </div>

      <!-- The one action for the item tried on: always in reach under the grid. -->
      <div v-if="selected" class="sticky bottom-0 z-10 -mx-3 bg-gradient-to-t from-[#2a1f40] from-75% to-transparent px-3 pt-4 pb-1">
        <div v-if="worn[selected.slot as AvatarSlot] === selected.id" class="g-btn g-dark h-14 w-full rounded-2xl text-lg" aria-disabled="true">
          <Check class="size-6" :stroke-width="3" /> {{ selected.name }}
        </div>
        <button v-else-if="cosmetics.owns(selected.key)" type="button" class="g-btn g-green h-14 w-full rounded-2xl text-xl uppercase" :disabled="tycoon.busy.value" @click="act">
          <Check class="size-6" :stroke-width="3" /> Wear
        </button>
        <button
          v-else
          :key="shake"
          type="button"
          class="g-btn h-14 w-full rounded-2xl px-4 text-xl"
          :class="[cosmetics.blocker(selected) ? 'g-off' : 'g-gem', shake ? 'shake' : '']"
          :disabled="tycoon.busy.value"
          :aria-disabled="!!cosmetics.blocker(selected)"
          :title="cosmetics.blocker(selected) ?? `Buy and wear the ${selected.name}`"
          :aria-label="`Buy the ${selected.name}`"
          @click="act"
        >
          <Lock v-if="!tycoon.state.value?.gemsEnabled" class="size-5 shrink-0" :stroke-width="3" />
          <span class="truncate">{{ selected.name }}</span>
          <span class="ml-auto flex items-center rounded-xl bg-black/25 px-3 py-1.5"><TycoonCost :amount="selected.gems" currency="gems" /></span>
        </button>
      </div>
    </div>

    <div v-else class="space-y-3 px-3 pb-4">
      <div class="flex gap-1.5 overflow-x-auto pb-1">
        <button
          v-for="zone in ownedZones"
          :key="zone.id"
          type="button"
          class="g-btn h-11 shrink-0 rounded-xl px-3 text-sm"
          :class="room === zone.id ? '' : 'g-dark opacity-90'"
          :style="room === zone.id ? { '--face': zoneArt(zone.id).color, '--edge': `color-mix(in oklab, ${zoneArt(zone.id).color} 55%, black)` } : undefined"
          :aria-pressed="room === zone.id"
          @click="room = zone.id"
        >
          <component :is="zoneArt(zone.id).icon" class="size-4" :stroke-width="3" /> {{ zone.name }}
        </button>
      </div>
      <TycoonSkinPicker :zone="room" />
    </div>
  </TycoonDrawer>
</template>

<style scoped>
.stage {
  background: radial-gradient(ellipse at 50% 100%, rgb(255 214 120 / 0.28), transparent 65%), linear-gradient(180deg, #2a1f3f, #1b1329);
  border: 2px solid #120c1d;
  box-shadow: inset 0 2px 0 rgb(255 255 255 / 0.08);
}
.spot { background: radial-gradient(ellipse, rgb(255 230 160 / 0.45), transparent 70%); }
.item {
  background: linear-gradient(180deg, #45356a, #33264f 70%);
  border: 2px solid #120c1d;
  box-shadow: 0 3px 0 #120c1d, inset 0 2px 0 rgb(255 255 255 / 0.1);
}
.item.picked {
  border-color: #ffc93a;
  box-shadow: 0 3px 0 #7a4a00, 0 0 0 2px #ffc93a, 0 0 14px rgb(255 201 58 / 0.5);
}
.shake { animation: shake 0.36s ease; }
@keyframes shake {
  20% { transform: translateX(-6px); }
  40% { transform: translateX(6px); }
  60% { transform: translateX(-4px); }
  80% { transform: translateX(3px); }
}
@media (prefers-reduced-motion: reduce) {
  .shake { animation: none; }
}
</style>
