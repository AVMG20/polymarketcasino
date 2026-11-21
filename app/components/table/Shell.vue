<script setup lang="ts">
import { DoorOpen, Eye, Loader2, Volume2, VolumeX } from 'lucide-vue-next'
import { Button } from '@/components/ui/button'
import { formatCoins } from '#shared/money'
import type { ScoreEntry } from '#shared/tables/protocol'
import type { TableFeedItem } from '~/composables/useLiveTable'

/**
 * The page around a live table: the felt (status line, phase clock, the
 * game's own layout), the controls under it, and a side column with the
 * table chat and the session scoreboard.
 */
const props = defineProps<{
    slug: string
    felt: 'green' | 'red' | 'blue' | 'purple'
    connected: boolean
    message: string
    seconds: number | null
    progress: number | null
    nextRoundIn: number | null
    watching: number
    seated: boolean
    leaving: boolean
    feed: TableFeedItem[]
    scoreboard: ScoreEntry[]
}>()
defineEmits<{ chat: [text: string], leave: [] }>()
const sound = useTableSound()

const felts = {
    green: 'radial-gradient(ellipse at 50% 0%, #23a06a 0%, #116b43 45%, #0a3f29 100%)',
    red: 'radial-gradient(ellipse at 50% 0%, #a3294f 0%, #6d1734 45%, #330a19 100%)',
    blue: 'radial-gradient(ellipse at 50% 0%, #2f6fc0 0%, #1a467f 45%, #0b2141 100%)',
    purple: 'radial-gradient(ellipse at 50% 0%, #7b45b5 0%, #4f2580 45%, #1f0d36 100%)'
}
const feltStyle = computed(() => ({ background: felts[props.felt] }))
</script>

<template>
  <GameFrame :slug="slug">
    <template #actions>
      <span class="mr-1 hidden items-center gap-1 text-xs text-muted-foreground sm:flex" title="Watching"><Eye class="size-3.5" />{{ watching }}</span>
      <Button size="icon" variant="ghost" :title="sound.muted.value ? 'Sound on' : 'Mute'" @click="sound.toggle()">
        <VolumeX v-if="sound.muted.value" class="size-5" />
        <Volume2 v-else class="size-5" />
      </Button>
    </template>

    <div class="grid grid-cols-1 gap-3 lg:grid-cols-[minmax(0,1fr)_17rem]">
      <div class="min-w-0 space-y-3">
        <section class="relative overflow-hidden rounded-[1.75rem] border-[6px] border-[#3b2416] p-2.5 text-white shadow-[inset_0_0_60px_rgba(0,0,0,.45)] sm:p-4" :style="feltStyle">
          <div class="pointer-events-none absolute inset-0 opacity-[.07]" style="background-image: radial-gradient(#fff 1px, transparent 1px); background-size: 14px 14px" />
          <div class="relative mb-2 flex min-h-10 items-center gap-2">
            <p class="min-w-0 flex-1 truncate rounded-full bg-black/30 px-3 py-1.5 text-center font-display text-sm font-bold sm:text-base">
              <template v-if="!connected"><Loader2 class="mr-1 inline size-4 animate-spin" />Connecting</template>
              <template v-else-if="nextRoundIn !== null">{{ message }} · next round in {{ nextRoundIn }}</template>
              <template v-else>{{ message }}</template>
            </p>
            <TableTimer v-if="nextRoundIn === null" :seconds="seconds" :progress="progress" />
          </div>
          <div class="relative">
            <slot name="felt" />
          </div>
        </section>

        <section class="space-y-3 rounded-2xl border bg-card p-3 sm:p-4">
          <slot name="controls" />
          <div v-if="seated" class="flex justify-end">
            <Button variant="ghost" size="sm" class="h-9 text-muted-foreground" :disabled="leaving" @click="$emit('leave')">
              <DoorOpen class="size-4" /> {{ leaving ? 'Leaving after this hand' : 'Leave seat' }}
            </Button>
          </div>
        </section>
      </div>

      <aside class="min-w-0 space-y-3">
        <section class="rounded-2xl border bg-card p-3">
          <h2 class="mb-2 font-display text-sm font-bold">Table</h2>
          <TableFeed :items="feed" :can-chat="connected" @chat="$emit('chat', $event)" />
        </section>
        <section v-if="scoreboard.length" class="rounded-2xl border bg-card p-3">
          <h2 class="mb-2 font-display text-sm font-bold">This session</h2>
          <ol class="space-y-1.5">
            <li v-for="(row, i) in scoreboard.slice(0, 8)" :key="row.playerId" class="flex items-center gap-2 text-xs" :class="row.seated ? '' : 'opacity-60'">
              <span class="w-4 font-mono text-muted-foreground">{{ i + 1 }}</span>
              <TableAvatar :name="row.name" :image="row.image" :size="20" />
              <span class="min-w-0 flex-1 truncate">{{ row.name }}</span>
              <span class="font-mono font-semibold tabular-nums" :class="row.net > 0 ? 'text-success' : row.net < 0 ? 'text-muted-foreground' : ''">{{ row.net > 0 ? '+' : row.net < 0 ? '−' : '' }}{{ formatCoins(Math.abs(row.net)) }}</span>
            </li>
          </ol>
        </section>
      </aside>
    </div>

    <template #rules>
      <slot name="rules" />
      <p class="text-muted-foreground">
        A live table: up to five players share each round. Chips on the layout are taken when betting closes and held until the hand settles.
        If you drop out mid-hand, the clock plays for you (stand or fold) and the hand still settles; if the casino restarts mid-hand, every bet comes back.
      </p>
    </template>
  </GameFrame>
</template>
