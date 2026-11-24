<script setup lang="ts">
import { ArrowRight, Check, Timer } from 'lucide-vue-next'
import { formatCoins } from '#shared/money'
import type { MissionId, MissionKey, MissionView } from '#shared/missions'
import type { IlloName } from '~/utils/tycoon-art'

/**
 * Today's three missions and the bonus for clearing them: a progress bar
 * and the coin reward each, a Claim button once done, and a Go button that
 * takes the player to where the mission is done.
 */
const emit = defineEmits<{ go: [id: MissionId] }>()
const tycoon = useTycoon()
const missions = computed(() => tycoon.missions.value)

const LOOK: Record<MissionId, { illo: IlloName, color: string }> = {
    'rounds': { illo: 'dice', color: '#4aa6ff' },
    'slot-wins': { illo: 'cherry', color: '#ff5470' },
    'big-win': { illo: 'bigwin', color: '#ff9a2e' },
    'table-hands': { illo: 'cards', color: '#3fd25a' },
    'collects': { illo: 'coins', color: '#ffc93a' },
    'build': { illo: 'crew', color: '#3fd25a' },
    'campaign': { illo: 'marketing', color: '#4aa6ff' },
    'visit': { illo: 'visit', color: '#a879ff' }
}

const done = (m: MissionView) => m.progress >= m.target
const leftMs = computed(() => Math.max(0, (missions.value?.endsAt ?? 0) - tycoon.serverTime.value))

// The row that was just claimed pops; the coins fly up from its button.
const claiming = ref<MissionKey | null>(null)
const popped = ref<MissionKey | null>(null)
async function claim(m: MissionView) {
    if (claiming.value || m.claimed || !done(m)) return
    claiming.value = m.id
    const paid = await tycoon.claimMission(m.id)
    claiming.value = null
    if (paid > 0) {
        popped.value = m.id
        setTimeout(() => popped.value === m.id && (popped.value = null), 900)
    }
}
</script>

<template>
  <div v-if="missions" class="space-y-2.5 px-3 pb-3">
    <p class="flex items-center justify-end gap-1 text-xs font-semibold text-[var(--g-muted)]" title="New missions at midnight (Amsterdam)">
      <Timer class="size-3.5" :stroke-width="3" /><span class="g-num text-sm text-white">{{ formatCountdown(leftMs) }}</span>
    </p>

    <ul class="space-y-2">
      <li
        v-for="m in missions.missions"
        :key="m.id"
        class="row relative flex items-center gap-2.5 rounded-[20px] p-2"
        :class="[m.claimed ? 'row-claimed' : done(m) ? 'row-done' : '', popped === m.id ? 'g-pop' : '']"
      >
        <span class="badge grid size-12 shrink-0 place-items-center rounded-2xl border-2 border-black/45" :style="{ '--tone': LOOK[m.id as MissionId]?.color ?? '#4a3a6b' }">
          <TycoonIllo :name="LOOK[m.id as MissionId]?.illo ?? 'chest'" :color="LOOK[m.id as MissionId]?.color" plain class="size-9! drop-shadow-[0_2px_0_rgb(0_0_0/0.3)]" />
        </span>
        <span class="min-w-0 flex-1">
          <span class="g-title line-clamp-2 text-[15px] leading-5 sm:text-base">{{ m.title }}</span>
          <span class="mt-1 flex items-center gap-2">
            <span class="g-well block h-2.5 min-w-0 flex-1 overflow-hidden rounded-full">
              <span class="block h-full rounded-full bg-gradient-to-r transition-[width] duration-500" :class="done(m) ? 'from-[#1fb84a] to-[#7ef09a]' : 'from-[#f08a00] to-[#ffe066]'" :style="{ width: `${(m.progress / m.target) * 100}%` }" />
            </span>
            <span class="g-num shrink-0 text-xs leading-none">{{ m.progress }}/{{ m.target }}</span>
            <span class="g-num flex shrink-0 items-center gap-0.5 text-sm leading-none text-[#ffe066]" :title="`Pays ${formatCoins(m.reward)} coins`"><CasinoCoinIcon class="size-4" />+{{ formatCoins(m.reward) }}</span>
          </span>
        </span>
        <span v-if="m.claimed" class="grid h-11 w-[5.5rem] shrink-0 place-items-center rounded-xl bg-black/25" title="Claimed">
          <Check class="size-6 text-[#7ef09a]" :stroke-width="3.5" />
        </span>
        <button
          v-else-if="done(m)"
          type="button"
          class="g-btn g-green claim h-11 w-[5.5rem] shrink-0 rounded-xl px-1 text-[15px]"
          :disabled="claiming !== null"
          :title="`Claim ${formatCoins(m.reward)} coins`"
          @click="claim(m)"
        >
          Claim
        </button>
        <button
          v-else
          type="button"
          class="g-btn g-dark h-11 w-[5.5rem] shrink-0 rounded-xl px-1 text-[15px]"
          title="Take me there"
          :aria-label="`${m.title}: go`"
          @click="emit('go', m.id as MissionId)"
        >
          Go<ArrowRight class="size-4 shrink-0" :stroke-width="3.5" />
        </button>
      </li>
    </ul>

    <!-- The bonus chest for clearing all three. -->
    <div class="bonus flex items-center gap-2.5 rounded-[20px] p-2" :class="[missions.bonus.claimed ? 'row-claimed' : done(missions.bonus) ? 'row-done' : '', popped === 'bonus' ? 'g-pop' : '']">
      <span class="grid size-12 shrink-0 place-items-center rounded-2xl border-2 border-black/45 bg-gradient-to-b from-[#ffd65c] to-[#e88a00] shadow-[0_3px_0_rgb(0_0_0/0.4),inset_0_2px_0_rgb(255_255_255/0.45)]" :class="done(missions.bonus) && !missions.bonus.claimed ? 'g-bounce' : ''">
        <TycoonIllo name="chest" color="#ffc93a" plain class="size-9! drop-shadow-[0_2px_0_rgb(0_0_0/0.3)]" />
      </span>
      <span class="min-w-0 flex-1">
        <span class="g-title block truncate text-[15px] leading-5 sm:text-base">{{ missions.bonus.title }}</span>
        <span class="mt-1 flex items-center gap-1">
          <span v-for="i in missions.bonus.target" :key="i" class="block h-2.5 flex-1 rounded-full" :class="i <= missions.bonus.progress ? 'bg-gradient-to-r from-[#f08a00] to-[#ffe066]' : 'g-well'" />
          <span class="g-num ml-1 flex shrink-0 items-center gap-0.5 text-sm leading-none text-[#ffe066]" :title="`Pays ${formatCoins(missions.bonus.reward)} coins`"><CasinoCoinIcon class="size-4" />+{{ formatCoins(missions.bonus.reward) }}</span>
        </span>
      </span>
      <span v-if="missions.bonus.claimed" class="grid h-11 w-[5.5rem] shrink-0 place-items-center rounded-xl bg-black/25" title="Claimed">
        <Check class="size-6 text-[#7ef09a]" :stroke-width="3.5" />
      </span>
      <button
        v-else
        type="button"
        class="g-btn h-11 w-[5.5rem] shrink-0 rounded-xl px-1 text-[15px]"
        :class="done(missions.bonus) ? 'g-gold claim' : 'g-off'"
        :aria-disabled="!done(missions.bonus)"
        :disabled="claiming !== null"
        :title="done(missions.bonus) ? `Claim ${formatCoins(missions.bonus.reward)} coins` : 'Claim all three missions first'"
        @click="claim(missions.bonus)"
      >
        Claim
      </button>
    </div>
  </div>
</template>

<style scoped>
.badge {
  background: radial-gradient(circle at 30% 22%, color-mix(in oklab, var(--tone) 55%, white), var(--tone) 50%, color-mix(in oklab, var(--tone) 60%, black));
  box-shadow: 0 3px 0 rgb(0 0 0 / 0.4), inset 0 2px 0 rgb(255 255 255 / 0.35);
}
.row, .bonus {
  background: linear-gradient(180deg, #45356a, #33264f 70%);
  border: 2px solid #120c1d;
  box-shadow: 0 4px 0 #120c1d, inset 0 2px 0 rgb(255 255 255 / 0.12);
}
.bonus { background: linear-gradient(180deg, #5a4426, #3b2c58 80%); }
.row-done {
  border-color: #1b8a33;
  box-shadow: 0 4px 0 #120c1d, 0 0 0 2px rgb(63 210 90 / 0.55), 0 0 18px rgb(63 210 90 / 0.35), inset 0 2px 0 rgb(255 255 255 / 0.12);
}
.row-claimed { opacity: 0.6; }
.claim { animation: claim-glow 1.3s ease-in-out infinite; }
@keyframes claim-glow {
  0%, 100% { filter: brightness(1); }
  50% { filter: brightness(1.18); }
}
@media (prefers-reduced-motion: reduce) {
  .claim { animation: none; }
}
</style>
