<script setup lang="ts">
import { Check, Crown, Glasses, Lock, Palette, PaintRoller, Scissors, Shirt, Smile } from 'lucide-vue-next'
import { AUTO, LOOK_SLOTS, cosmeticsIn, findCosmetic, isFree, type AvatarLook, type AvatarSlot, type CosmeticDef, type LookSlot, type WearSlot } from '#shared/cosmetics'
import { ZONES, type ZoneId } from '#shared/tycoon'
import { nameLookIds } from '~/utils/floor/art/characters'
import type { WardrobeTab } from '~/composables/useCosmetics'

/**
 * The wardrobe: your avatar turning on a spotlight, wearing what you try on.
 * Look (free: hair style, hair colour, skin tone; tap to try, one button
 * wears the lot), tabs for hats, outfits and accessories (tap to try, then
 * wear or buy with gems or chips), and Rooms: a skin for each zone you own,
 * previewed live on the floor. Opened by tapping your own avatar on the
 * floor, or from the shop.
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
    { value: 'look', label: 'Look', icon: Scissors, color: '#ff7ab8' },
    { value: 'hat', label: 'Hats', icon: Crown, color: '#ffc93a' },
    { value: 'outfit', label: 'Outfits', icon: Shirt, color: '#4aa6ff' },
    { value: 'accessory', label: 'Extras', icon: Glasses, color: '#ff5470' },
    { value: 'rooms', label: 'Rooms', icon: PaintRoller, color: '#3fd25a' }
]

function dropTrial(key: AvatarSlot) {
    const next = { ...trial.value }
    delete next[key]
    trial.value = next
}

// ---- Look: hair style, hair colour, skin tone (all free) ----

/** What the player's name gives them: what `auto` (never changed) shows. */
const nameIds = computed(() => nameLookIds(name.value))
const resolve = (avatar: AvatarLook, slot: LookSlot) => (avatar[slot] === AUTO ? nameIds.value[slot] : avatar[slot])
const hairs = cosmeticsIn('hair')
const hairColors = cosmeticsIn('haircolor')
const skinTones = cosmeticsIn('skintone')
/** The look slots tried on that differ from what's worn. */
const lookChanges = computed(() => LOOK_SLOTS.filter(slot => trial.value[slot] !== undefined && trial.value[slot] !== resolve(worn.value, slot)))
/** The preview on this tab drops the hat, so the hair shows. */
const lookPreview = computed<AvatarLook>(() => ({ ...look.value, hat: 'none' }))
const saving = ref(false)

function tryLook(slot: LookSlot, id: string) {
    if (id === resolve(worn.value, slot)) dropTrial(slot)
    else trial.value = { ...trial.value, [slot]: id }
}

const shownIs = (slot: LookSlot, id: string) => resolve(look.value, slot) === id
const wornIs = (slot: LookSlot, id: string) => resolve(worn.value, slot) === id

/** Wear every changed look slot (one equip each: there's no bulk call). */
async function wearLook() {
    if (saving.value || !lookChanges.value.length) return
    saving.value = true
    try {
        for (const slot of lookChanges.value) {
            if (!(await cosmetics.equip(`${slot}:${trial.value[slot]}`))) break
            dropTrial(slot)
        }
    } finally {
        saving.value = false
    }
}

// ---- Hats, outfits, extras ----

const slot = computed<WearSlot | null>(() => (tab.value === 'hat' || tab.value === 'outfit' || tab.value === 'accessory' ? tab.value : null))
const items = computed(() => (slot.value ? cosmeticsIn(slot.value) : []))
/** The item of this tab on the preview (tried on, or worn). */
const selected = computed<CosmeticDef | null>(() => (slot.value ? findCosmetic(`${slot.value}:${look.value[slot.value]}`) ?? null : null))
const shake = ref(0)
const isWorn = (item: CosmeticDef) => worn.value[item.slot as WearSlot] === item.id
const priceOf = (item: CosmeticDef) => (item.gems ? { amount: item.gems, currency: 'gems' as const } : { amount: item.chips, currency: 'chips' as const })

function tryOn(item: CosmeticDef) {
    if (item.slot === 'skin') return
    trial.value = { ...trial.value, [item.slot]: item.id }
}

async function act() {
    const item = selected.value
    if (!item || item.slot === 'skin') return
    if (isWorn(item)) return
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

// Rooms: the zones you own; the one picked is framed on the floor while its skins show.
// On phones the drawer stays low on this tab, so the framed zone (its live skin) shows above it.
const ROOMS_HEIGHT = '58dvh'
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
  <TycoonDrawer :open="open" title="Wardrobe" :icon="Shirt" color="#a879ff" :height="tab === 'rooms' ? ROOMS_HEIGHT : '78dvh'" @close="cosmetics.hide()">
    <div class="sticky top-0 z-10 grid grid-cols-5 gap-1.5 bg-gradient-to-b from-[#33264f] from-80% to-transparent px-3 pt-1 pb-3">
      <button
        v-for="t in TABS"
        :key="t.value"
        type="button"
        class="g-btn h-14 min-w-0 flex-col gap-0.5! rounded-2xl px-0! text-[11px] uppercase"
        :class="tab === t.value ? '' : 'g-dark opacity-90'"
        :style="tab === t.value ? { '--face': t.color, '--edge': `color-mix(in oklab, ${t.color} 55%, black)` } : undefined"
        :aria-pressed="tab === t.value"
        :title="t.label"
        @click="tab = t.value"
      >
        <component :is="t.icon" class="size-6 shrink-0" :stroke-width="2.75" />
        <span class="max-w-full truncate">{{ t.label }}</span>
      </button>
    </div>

    <!-- Look: free hair style, hair colour and skin tone. -->
    <div v-if="tab === 'look'" class="space-y-3 px-3 pb-4">
      <div class="stage relative flex items-end justify-center overflow-hidden rounded-[22px] px-3 pt-2 pb-3">
        <div class="spot absolute inset-x-0 bottom-2 mx-auto h-8 w-40 rounded-[50%]" />
        <TycoonAvatarPortrait :name="name" :avatar="lookPreview" crop="full" :size="150" animate class="relative" />
      </div>

      <section aria-label="Hair style">
        <h3 class="label"><Scissors class="size-3.5" :stroke-width="3" /> Hair</h3>
        <div class="grid grid-cols-4 gap-2">
          <button
            v-for="h in hairs"
            :key="h.key"
            type="button"
            class="item relative flex flex-col items-center rounded-2xl p-1 transition-transform active:scale-95"
            :class="shownIs('hair', h.id) ? 'picked' : ''"
            :aria-pressed="shownIs('hair', h.id)"
            :aria-label="`${h.name} hair${wornIs('hair', h.id) ? ' (worn)' : ''}`"
            :title="h.name"
            @click="tryLook('hair', h.id)"
          >
            <span class="relative grid aspect-square w-full place-items-center overflow-hidden rounded-xl bg-black/30">
              <TycoonAvatarPortrait :name="name" :avatar="{ ...lookPreview, hair: h.id }" crop="bust" :size="80" class="size-full!" />
              <span v-if="wornIs('hair', h.id)" class="worn"><Check class="size-3 text-white" :stroke-width="4" /></span>
            </span>
          </button>
        </div>
      </section>

      <section aria-label="Hair colour">
        <h3 class="label"><Palette class="size-3.5" :stroke-width="3" /> Colour</h3>
        <div class="grid grid-cols-6 gap-2">
          <button
            v-for="c in hairColors"
            :key="c.key"
            type="button"
            class="swatch"
            :class="shownIs('haircolor', c.id) ? 'picked' : ''"
            :style="{ '--sw': c.color }"
            :aria-pressed="shownIs('haircolor', c.id)"
            :aria-label="`${c.name} hair${wornIs('haircolor', c.id) ? ' (worn)' : ''}`"
            :title="c.name"
            @click="tryLook('haircolor', c.id)"
          >
            <span v-if="wornIs('haircolor', c.id)" class="worn"><Check class="size-3 text-white" :stroke-width="4" /></span>
          </button>
        </div>
      </section>

      <section aria-label="Skin tone">
        <h3 class="label"><Smile class="size-3.5" :stroke-width="3" /> Skin</h3>
        <div class="-mx-1 grid grid-cols-7 gap-[3px]">
          <button
            v-for="c in skinTones"
            :key="c.key"
            type="button"
            class="swatch"
            :class="shownIs('skintone', c.id) ? 'picked' : ''"
            :style="{ '--sw': c.color }"
            :aria-pressed="shownIs('skintone', c.id)"
            :aria-label="`${c.name} skin${wornIs('skintone', c.id) ? ' (worn)' : ''}`"
            :title="c.name"
            @click="tryLook('skintone', c.id)"
          >
            <span v-if="wornIs('skintone', c.id)" class="worn"><Check class="size-3 text-white" :stroke-width="4" /></span>
          </button>
        </div>
      </section>

      <div class="sticky bottom-0 z-10 -mx-3 bg-gradient-to-t from-[#2a1f40] from-75% to-transparent px-3 pt-4 pb-1">
        <button
          v-if="lookChanges.length"
          type="button"
          class="g-btn g-green h-14 w-full rounded-2xl text-xl uppercase"
          :disabled="saving || tycoon.busy.value"
          @click="wearLook"
        >
          <Check class="size-6" :stroke-width="3" /> Wear
        </button>
        <div v-else class="g-btn g-dark h-14 w-full rounded-2xl text-lg" aria-disabled="true">
          <Check class="size-6" :stroke-width="3" /> Your look
        </div>
      </div>
    </div>

    <div v-else-if="slot" class="space-y-3 px-3 pb-4">
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
          :aria-label="`${item.name}${isWorn(item) ? ' (worn)' : !isFree(item) && cosmetics.owns(item.key) ? ' (owned)' : ''}`"
          :title="item.name"
          @click="tryOn(item)"
        >
          <span class="relative grid aspect-square w-full place-items-center overflow-hidden rounded-xl" :class="item.premium ? 'premium g-gem-glow' : 'bg-black/30'">
            <TycoonAvatarPortrait :name="name" :avatar="{ ...look, [item.slot]: item.id }" :crop="item.slot === 'hat' ? 'bust' : 'upper'" :size="80" />
            <span v-if="isWorn(item)" class="worn"><Check class="size-3 text-white" :stroke-width="4" /></span>
          </span>
          <span class="mt-1 w-full truncate text-center text-[12px] leading-4 font-semibold">{{ item.name }}</span>
          <span class="mt-0.5 flex h-5 items-center text-[13px]">
            <span v-if="isFree(item) || cosmetics.owns(item.key)" class="text-[11px] font-semibold text-[var(--g-muted)] uppercase">{{ isFree(item) ? 'Free' : 'Owned' }}</span>
            <TycoonCost v-else v-bind="priceOf(item)" compact />
          </span>
        </button>
      </div>

      <!-- The one action for the item tried on: always in reach under the grid. -->
      <div v-if="selected" class="sticky bottom-0 z-10 -mx-3 bg-gradient-to-t from-[#2a1f40] from-75% to-transparent px-3 pt-4 pb-1">
        <div v-if="isWorn(selected)" class="g-btn g-dark h-14 w-full rounded-2xl text-lg" aria-disabled="true">
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
          :class="[cosmetics.blocker(selected) ? 'g-off' : selected.gems ? 'g-gem' : 'g-blue', shake ? 'shake' : '']"
          :disabled="tycoon.busy.value"
          :aria-disabled="!!cosmetics.blocker(selected)"
          :title="cosmetics.blocker(selected) ?? `Buy and wear the ${selected.name}`"
          :aria-label="`Buy the ${selected.name}`"
          @click="act"
        >
          <Lock v-if="selected.gems && !tycoon.state.value?.gemsEnabled" class="size-5 shrink-0" :stroke-width="3" />
          <span class="truncate">{{ selected.name }}</span>
          <span class="ml-auto flex items-center rounded-xl bg-black/25 px-3 py-1.5"><TycoonCost v-bind="priceOf(selected)" /></span>
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
/* The dearest pieces sit on a lit backdrop. */
.premium { background: radial-gradient(circle at 50% 35%, rgb(255 225 140 / 0.3), transparent 70%), rgb(0 0 0 / 0.3); }
.worn {
  position: absolute;
  top: 0.25rem;
  right: 0.25rem;
  display: grid;
  width: 1.25rem;
  height: 1.25rem;
  place-items: center;
  border-radius: 9999px;
  border: 2px solid rgb(0 0 0 / 0.5);
  background: #3fd25a;
}
.label {
  display: flex;
  align-items: center;
  gap: 0.3rem;
  margin: 0 0 0.45rem 0.15rem;
  font-size: 11px;
  font-weight: 700;
  line-height: 1;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--g-muted);
}
/* A chunky round paint pot: the colour, a gloss on top, a dark rim and a drop shadow. */
.swatch {
  position: relative;
  justify-self: center;
  width: 100%;
  max-width: 3.25rem;
  min-height: 2.75rem;
  aspect-ratio: 1;
  border-radius: 9999px;
  border: 3px solid #120c1d;
  background: radial-gradient(circle at 35% 30%, rgb(255 255 255 / 0.55), transparent 32%), radial-gradient(circle at 50% 120%, rgb(0 0 0 / 0.35), transparent 60%), var(--sw);
  box-shadow: 0 3px 0 #120c1d;
  transition: transform 0.12s ease;
}
.swatch:active { transform: scale(0.9); }
.swatch.picked { box-shadow: 0 3px 0 #120c1d, 0 0 0 3px #ffc93a, 0 0 14px rgb(255 201 58 / 0.6); transform: scale(1.06); }
.swatch .worn { top: -0.35rem; right: -0.35rem; }
.shake { animation: shake 0.36s ease; }
@keyframes shake {
  20% { transform: translateX(-6px); }
  40% { transform: translateX(6px); }
  60% { transform: translateX(-4px); }
  80% { transform: translateX(3px); }
}
@media (prefers-reduced-motion: reduce) {
  .shake { animation: none; }
  .swatch { transition: none; }
}
</style>
