<script setup lang="ts">
import { Check, Paintbrush, Sparkles } from 'lucide-vue-next'
import { cosmeticsIn, findCosmetic, isFree, type CosmeticDef, type SkinId } from '#shared/cosmetics'
import type { ZoneId } from '#shared/tycoon'

/**
 * Zone skins for one zone. Hovering a skin (mouse) or tapping it shows it on
 * the floor right away; leaving the picker without buying puts the zone's
 * own skin back. One big button under the grid: Use (owned), or the price in
 * chips or gems.
 */
const props = defineProps<{ zone: ZoneId }>()

const tycoon = useTycoon()
const cosmetics = useCosmetics()
const skins = cosmeticsIn('skin')
const worn = computed(() => cosmetics.skinOn(props.zone))
/** The skin tapped (stays on the floor while the picker is open). */
const picked = ref<SkinId>(worn.value)
/** The skin under the mouse, shown on the floor until the mouse leaves. */
const hovered = ref<SkinId | null>(null)
const shown = computed(() => hovered.value ?? picked.value)
const def = computed(() => findCosmetic(`skin:${picked.value}`)!)
const shake = ref(0)

function sync() {
    cosmetics.preview.value = { zone: props.zone, skin: shown.value }
}
watch(shown, sync, { immediate: true })
watch(() => props.zone, () => {
    picked.value = worn.value
    hovered.value = null
    sync()
})
// A purchase elsewhere (or this one) changes what the zone wears: follow it.
watch(worn, (skin) => {
    if (!hovered.value) picked.value = skin
})
onBeforeUnmount(() => {
    if (cosmetics.preview.value?.zone === props.zone) cosmetics.preview.value = null
})

function pick(skin: SkinId) {
    picked.value = skin
    hovered.value = null
}
function enter(event: PointerEvent, skin: SkinId) {
    if (event.pointerType === 'mouse') hovered.value = skin
}
function leave(event: PointerEvent) {
    if (event.pointerType === 'mouse') hovered.value = null
}

const owned = (item: CosmeticDef) => cosmetics.owns(item.key)

async function act() {
    const item = def.value
    if (item.id === worn.value) return
    if (owned(item)) {
        await cosmetics.equip(item.key, props.zone)
        return
    }
    if (cosmetics.blocker(item)) {
        shake.value++
        return
    }
    await cosmetics.buy(item, props.zone)
}
</script>

<template>
  <div class="space-y-2.5">
    <div class="grid grid-cols-3 gap-2" @pointerleave="leave">
      <button
        v-for="item in skins"
        :key="item.key"
        type="button"
        class="skin relative flex min-w-0 flex-col items-center rounded-2xl p-1 pb-1.5 transition-transform active:scale-95"
        :class="[picked === item.id ? 'picked' : '', item.premium ? (item.gems ? 'premium gem' : 'premium') : '']"
        :aria-pressed="picked === item.id"
        :aria-label="`${item.name}${item.id === worn ? ' (in use)' : owned(item) ? ' (owned)' : ''}`"
        :title="item.name"
        @click="pick(item.id as SkinId)"
        @pointerenter="enter($event, item.id as SkinId)"
      >
        <span class="relative block aspect-[64/58] w-full overflow-hidden rounded-xl bg-black/30">
          <TycoonSkinSwatch :zone="zone" :skin="item.id as SkinId" />
          <span v-if="item.premium" class="shine pointer-events-none absolute inset-0" />
          <Sparkles v-if="item.premium" class="absolute top-1 left-1 size-4 drop-shadow-[0_1px_0_rgb(0_0_0/0.6)]" :class="item.gems ? 'text-[#7ff5ea]' : 'text-[#ffe08a]'" :stroke-width="2.5" />
          <span v-if="item.id === worn" class="absolute top-1 right-1 grid size-5 place-items-center rounded-full border-2 border-black/50 bg-[#3fd25a]"><Check class="size-3 text-white" :stroke-width="4" /></span>
        </span>
        <span class="mt-1 w-full truncate text-center text-[12px] leading-4 font-semibold">{{ item.name }}</span>
        <span class="mt-0.5 flex h-5 items-center text-[13px]">
          <span v-if="isFree(item) || owned(item)" class="text-[11px] font-semibold text-[var(--g-muted)] uppercase">{{ isFree(item) ? 'Free' : 'Owned' }}</span>
          <TycoonCost v-else :amount="item.gems || item.chips" :currency="item.gems ? 'gems' : 'chips'" compact />
        </span>
      </button>
    </div>

    <div class="buy sticky bottom-0 z-10 -mx-1 px-1 pt-2 pb-1">
      <div v-if="def.id === worn" class="g-btn g-dark h-14 w-full rounded-2xl text-lg" aria-disabled="true">
        <Check class="size-6" :stroke-width="3" /> In use
      </div>
      <button
        v-else-if="owned(def)"
        type="button"
        class="g-btn g-green h-14 w-full rounded-2xl text-xl uppercase"
        :disabled="tycoon.busy.value"
        @click="act"
      >
        <Paintbrush class="size-6" :stroke-width="2.75" /> Use
      </button>
      <button
        v-else
        :key="shake"
        type="button"
        class="g-btn h-14 w-full rounded-2xl px-4 text-xl"
        :class="[cosmetics.blocker(def) ? 'g-off' : def.gems ? 'g-gem' : 'g-blue', shake ? 'shake' : '']"
        :disabled="tycoon.busy.value"
        :aria-disabled="!!cosmetics.blocker(def)"
        :title="cosmetics.blocker(def) ?? `Buy ${def.name} and use it here`"
        :aria-label="`Buy ${def.name}`"
        @click="act"
      >
        <Paintbrush class="size-6 shrink-0" :stroke-width="2.75" />
        <span class="truncate">{{ def.name }}</span>
        <span class="ml-auto flex items-center rounded-xl bg-black/25 px-3 py-1.5">
          <TycoonCost :amount="def.gems || def.chips" :currency="def.gems ? 'gems' : 'chips'" compact />
        </span>
      </button>
    </div>
  </div>
</template>

<style scoped>
.skin {
  background: linear-gradient(180deg, #45356a, #33264f 70%);
  border: 2px solid #120c1d;
  box-shadow: 0 3px 0 #120c1d, inset 0 2px 0 rgb(255 255 255 / 0.1);
}
.skin.picked {
  border-color: #ffc93a;
  box-shadow: 0 3px 0 #7a4a00, 0 0 0 2px #ffc93a, 0 0 14px rgb(255 201 58 / 0.5);
}
/* Premium skins: a warm frame that glows (gold, or teal for a gem price) and a shine that sweeps the swatch. */
.skin.premium {
  --glow: rgb(255 201 58 / 0.6);
  background: linear-gradient(180deg, #5b4278, #3a2856 70%);
  border-color: #3b2508;
}
.skin.premium.gem { --glow: rgb(47 224 208 / 0.55); border-color: #0b3b38; }
.skin.premium::before {
  content: '';
  position: absolute;
  inset: -2px;
  border-radius: inherit;
  box-shadow: 0 0 12px 1px var(--glow), inset 0 0 0 1px var(--glow);
  opacity: 0.4;
  pointer-events: none;
  animation: glow 2.6s ease-in-out infinite;
}
.skin.premium.picked::before { opacity: 1; animation: none; }
@keyframes glow { 50% { opacity: 1; } }
.shine { overflow: hidden; }
.shine::after {
  content: '';
  position: absolute;
  inset: -20% auto -20% 0;
  width: 40%;
  background: linear-gradient(100deg, transparent, rgb(255 255 255 / 0.28), transparent);
  transform: translateX(-120%) skewX(-12deg);
  animation: shine 3.6s ease-in-out infinite;
}
@keyframes shine {
  0%, 55% { transform: translateX(-120%) skewX(-12deg); }
  85%, 100% { transform: translateX(320%) skewX(-12deg); }
}
/* The buy button stays in reach while the grid scrolls under it. */
.buy { background: linear-gradient(180deg, transparent, var(--g-panel) 35%); }
.shake { animation: shake 0.36s ease; }
@keyframes shake {
  20% { transform: translateX(-6px); }
  40% { transform: translateX(6px); }
  60% { transform: translateX(-4px); }
  80% { transform: translateX(3px); }
}
@media (prefers-reduced-motion: reduce) {
  .shake, .skin.premium::before, .shine::after { animation: none; }
}
</style>
