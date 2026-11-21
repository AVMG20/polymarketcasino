<script setup lang="ts">
import '~/assets/css/live-table.css'
import { Eye, Loader2, Volume2, VolumeX } from 'lucide-vue-next'
import { Button } from '@/components/ui/button'
import { formatCoins } from '#shared/money'
import type { ScoreEntry } from '#shared/tables/protocol'
import type { TableFeedItem } from '~/composables/useLiveTable'

/**
 * The page around a live table, the old site's one-piece table: the felt (the
 * game's own stage or canvas) with the control band under it on the same dark
 * rail, and a column with the table chat and the session scoreboard beside it
 * on a wide screen, under it otherwise.
 */
const props = defineProps<{
    slug: string
    connected: boolean
    message: string
    seconds: number | null
    progress: number | null
    nextRoundIn: number | null
    watching: number
    seated: boolean
    leaving: boolean
    /** First open seat, for the band's sit button; null when the table is full. */
    openSeat: number | null
    feed: TableFeedItem[]
    scoreboard: ScoreEntry[]
    /** Hides the chat and session column (a single-player table). */
    solo?: boolean
    /** The felt's width over its height, to size the table to the screen. */
    aspect?: number
}>()
defineEmits<{ chat: [text: string], leave: [], sit: [seat: number] }>()
const sound = useTableSound()

// The felt plus the band's first row of controls fits the viewport height;
// whatever room is left beside it goes to the chat column.
const tableStyle = computed(() => ({
    flex: '100 1 640px',
    maxWidth: `max(20rem, calc((100dvh - 250px) * ${props.aspect ?? 1720 / 980}))`
}))
</script>

<template>
  <GameFrame :slug="slug" wide>
    <template #actions>
      <span v-if="!solo" class="mr-1 hidden items-center gap-1 text-xs text-muted-foreground sm:flex" title="Watching"><Eye class="size-3.5" />{{ watching }}</span>
      <Button size="icon" variant="ghost" :title="sound.muted.value ? 'Sound on' : 'Mute'" @click="sound.toggle()">
        <VolumeX v-if="sound.muted.value" class="size-5" />
        <Volume2 v-else class="size-5" />
      </Button>
    </template>

    <div class="flex flex-wrap items-start justify-center gap-3">
      <div class="lt-table min-w-0 overflow-hidden rounded-3xl bg-[#120c08] shadow-[0_18px_40px_-18px_rgba(0,0,0,.7)] ring-1 ring-white/10" :style="tableStyle">
        <slot name="felt" />

        <div class="lt-band">
          <div class="lt-band-status lg:hidden">
            <p class="msg">
              <template v-if="!connected"><Loader2 class="mr-1 inline size-4 animate-spin" />Connecting</template>
              <template v-else-if="nextRoundIn !== null">{{ message }} · next round {{ nextRoundIn }}</template>
              <template v-else>{{ message }}</template>
            </p>
            <TableTimer v-if="nextRoundIn === null" :seconds="seconds" :progress="progress" />
          </div>

          <slot name="controls" />

          <div class="flex flex-wrap items-center gap-2 text-[11px]">
            <button v-if="connected && !seated && openSeat !== null" type="button" class="lb-tile lb-tile-green" @click="$emit('sit', openSeat)">TAKE A SEAT</button>
            <slot name="footer" />
            <button v-if="seated" type="button" class="lb-tile lb-tile-ghost ml-auto min-h-9 px-3 py-1 text-[11px]" :disabled="leaving" @click="$emit('leave')">
              {{ leaving ? 'STANDING UP AFTER THIS HAND' : 'LEAVE SEAT' }}
            </button>
          </div>
        </div>
      </div>

      <aside v-if="!solo" class="@container min-w-0" style="flex: 1 1 18rem">
        <div class="grid grid-cols-1 gap-3 @2xl:grid-cols-2">
        <section class="rounded-2xl border bg-card p-3">
          <h2 class="mb-2 font-display text-sm font-bold">Table</h2>
          <TableFeed :items="feed" :can-chat="connected" @chat="$emit('chat', $event)" />
        </section>
        <section class="rounded-2xl border bg-card p-3">
          <h2 class="mb-2 font-display text-sm font-bold">This session</h2>
          <p v-if="!scoreboard.length" class="text-xs text-muted-foreground">Nobody has played yet.</p>
          <ol class="space-y-1.5">
            <li v-for="(row, i) in scoreboard.slice(0, 8)" :key="row.playerId" class="flex items-center gap-2 text-xs" :class="row.seated ? '' : 'opacity-60'">
              <span class="w-4 font-mono text-muted-foreground">{{ i + 1 }}</span>
              <TableAvatar :name="row.name" :image="row.image" :size="20" />
              <span class="min-w-0 flex-1 truncate">{{ row.name }}</span>
              <span v-if="row.winStreak > 1" class="rounded bg-warning/20 px-1 text-[10px] font-bold text-warning">W{{ row.winStreak }}</span>
              <span class="font-mono font-semibold tabular-nums" :class="row.net > 0 ? 'text-success' : row.net < 0 ? 'text-muted-foreground' : ''">{{ row.net > 0 ? '+' : row.net < 0 ? '−' : '' }}{{ formatCoins(Math.abs(row.net)) }}</span>
            </li>
          </ol>
        </section>
        </div>
      </aside>
    </div>

    <template #rules>
      <slot name="rules" />
      <p v-if="!solo" class="text-muted-foreground">
        A live table: up to five players share each round. Chips on the layout are taken when betting closes and held until the hand settles.
        If you drop out mid-hand, the clock plays for you (stand or fold) and the hand still settles; if the casino restarts mid-hand, every bet comes back.
      </p>
    </template>
  </GameFrame>
</template>
