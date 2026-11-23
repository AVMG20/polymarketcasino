<script setup lang="ts">
import type { Component } from 'vue'
import { Heart } from 'lucide-vue-next'
import { formatCoins, formatCoinsExact } from '#shared/money'
import type { LeaderboardEntry } from '#shared/social'

/** One casino on the leaderboard: rank, owner, the zones they opened, value and hearts. */
defineProps<{
    entry: LeaderboardEntry
    me: boolean
    /** Medal colour for the top three, else null. */
    medal: string | null
    zones: { id: string, name: string, art: { icon: Component, color: string } }[]
}>()
const emit = defineEmits<{ select: [] }>()
</script>

<template>
  <button
    type="button"
    class="row flex min-h-[60px] w-full items-center gap-2.5 rounded-2xl px-2.5 py-2 text-left transition-transform active:scale-[0.98]"
    :class="me ? 'mine' : ''"
    :aria-label="`#${entry.rank} ${entry.owner.name}${me ? ' (you)' : ''}: ${formatCoinsExact(entry.value)} chips, ${entry.likes} ${entry.likes === 1 ? 'heart' : 'hearts'}`"
    @click="emit('select')"
  >
    <span
      class="g-num grid size-9 shrink-0 place-items-center rounded-full leading-none"
      :class="medal ? 'border-2 border-black/50 text-[17px] text-[#2a1b30] shadow-[0_3px_0_rgb(0_0_0/0.45),inset_0_2px_0_rgb(255_255_255/0.5)] [text-shadow:0_1px_0_rgb(255_255_255/0.45)]' : 'text-lg text-[var(--g-muted)]'"
      :style="medal ? { background: medal } : undefined"
    >{{ entry.rank }}</span>
    <span class="grid size-[38px] shrink-0 place-items-center overflow-hidden rounded-full border-2" :class="me ? 'avatar-mine' : 'border-black/50 bg-[#2a1f3f]'">
      <TycoonAvatarPortrait :name="entry.owner.name" :avatar="entry.owner.avatar" :size="36" />
    </span>
    <span class="min-w-0 flex-1">
      <span class="flex items-center gap-1.5">
        <span class="truncate text-[15px] leading-5 font-semibold">{{ entry.owner.name }}</span>
        <span v-if="me" class="shrink-0 rounded-full bg-[#ffc93a] px-1.5 text-[11px] leading-4 font-bold text-[#4a2a00]">YOU</span>
      </span>
      <span class="mt-1 flex items-center gap-[3px]" :aria-label="`${entry.zones.length} of ${zones.length} zones`">
        <span
          v-for="zone in zones"
          :key="zone.id"
          class="grid size-[18px] place-items-center rounded-[6px] border-[1.5px]"
          :class="entry.zones.includes(zone.id as never) ? 'border-black/50' : 'border-white/10 bg-black/25'"
          :style="entry.zones.includes(zone.id as never) ? { background: zone.art.color } : undefined"
          :title="zone.name"
        >
          <component :is="zone.art.icon" class="size-[11px]" :class="entry.zones.includes(zone.id as never) ? 'text-white' : 'text-white/20'" :stroke-width="3" />
        </span>
      </span>
    </span>
    <span class="flex shrink-0 flex-col items-end gap-0.5">
      <span class="g-num flex items-center gap-1 text-[17px] leading-5" :title="`${formatCoinsExact(entry.value)} chips`">
        <CasinoChipIcon class="size-4" />{{ formatCoins(entry.value) }}
      </span>
      <span class="flex items-center gap-1 text-[13px] leading-4 font-semibold text-[#ff8fa3]" :title="`${entry.likes} ${entry.likes === 1 ? 'heart' : 'hearts'}`">
        <Heart class="size-3.5 fill-current" :stroke-width="2.5" />{{ entry.likes }}
      </span>
    </span>
  </button>
</template>

<style scoped>
.row {
  background: linear-gradient(180deg, #45356a, #33264f 70%);
  border: 2px solid #120c1d;
  box-shadow: 0 3px 0 #120c1d, inset 0 2px 0 rgb(255 255 255 / 0.1);
}
.row.mine {
  background: linear-gradient(180deg, #6a4f2a, #4a3520 70%);
  border-color: #2a1a08;
  box-shadow: 0 3px 0 #2a1a08, 0 0 0 2px #ffc93a, inset 0 2px 0 rgb(255 255 255 / 0.15);
}
/* Your own avatar on the brown row: a light disc in a gold ring, so it doesn't sink into the row. */
.avatar-mine {
  border-color: #ffc93a;
  background: radial-gradient(circle at 50% 40%, #fff3d0, #e8c98f);
  box-shadow: 0 0 0 2px #2a1a08, 0 2px 0 3px rgb(0 0 0 / 0.35);
}
</style>
