<script setup lang="ts">
import '~/assets/css/live-table.css'
import { ChevronDown, DoorOpen, Eye, Hammer, Loader2, MessageCircle, Trophy, Volume2, VolumeX } from 'lucide-vue-next'
import { Button } from '@/components/ui/button'
import { findGame } from '#shared/games/registry'
import { formatCoins } from '#shared/money'
import type { ScoreEntry } from '#shared/tables/protocol'
import type { WinShow } from '~/components/game/WinBurst.vue'
import type { TableClock, TableFeedItem } from '~/composables/useLiveTable'

/**
 * The page around a live table: the felt (the game's own stage or canvas)
 * with the control band under it on the same wooden rail, and a column with
 * the table chat and the session scoreboard beside it on a wide screen,
 * folded up under it on a phone. The player's own win bursts over the felt.
 */
const props = defineProps<{
    slug: string
    connected: boolean
    message: string
    clock: TableClock
    /** Sends a chat line; returns whether it went out. */
    sendChat: (text: string) => boolean
    watching: number
    seated: boolean
    leaving: boolean
    /** First open seat, for the band's sit button; null when the table is full. */
    openSeat: number | null
    feed: TableFeedItem[]
    scoreboard: ScoreEntry[]
    /** The felt's colour, for the band's touch spots. */
    tone?: 'green' | 'red' | 'blue' | 'teal'
    /** Taking a seat needs the game built; anyone can watch. */
    canSit?: boolean
    /** Seats taken, for the watching panel. */
    players?: number
    /** The player's own win, for the burst over the felt. */
    win?: WinShow | null
    /** Hides the chat and session column (a single-player table). */
    solo?: boolean
    /** The felt's width over its height, to size the table to the screen. */
    aspect?: number
}>()
defineEmits<{ leave: [], sit: [seat: number], build: [] }>()
const sound = useTableSound()
const name = computed(() => findGame(props.slug)?.name ?? 'this table')

// The felt and the whole control band fit the height of the screen (the
// overlay or the page): the felt's width follows the room left above the band,
// measured, since the band grows with the controls (seated, side bets).
// Whatever room is left beside it goes to the chat column.
const tableEl = ref<HTMLElement | null>(null)
const bandEl = ref<HTMLElement | null>(null)
/** Height (px) the felt may take; null until measured. */
const feltRoom = ref<number | null>(null)
let observer: ResizeObserver | null = null

function scrollerOf(el: HTMLElement): HTMLElement | null {
    for (let node = el.parentElement; node; node = node.parentElement) {
        if (/(auto|scroll)/.test(getComputedStyle(node).overflowY)) return node
    }
    return null
}

function measure() {
    const table = tableEl.value
    const band = bandEl.value
    if (!table || !band) return
    const scroller = scrollerOf(table)
    const rect = table.getBoundingClientRect()
    // The table's top within the scrolled content, and the height of the window onto it.
    const top = scroller ? rect.top - scroller.getBoundingClientRect().top + scroller.scrollTop : rect.top + window.scrollY
    const viewH = scroller ? scroller.clientHeight : window.innerHeight
    const room = Math.floor(viewH - top - band.offsetHeight - 16)
    if (room !== feltRoom.value) feltRoom.value = room
}

onMounted(() => {
    measure()
    observer = new ResizeObserver(() => measure())
    if (bandEl.value) observer.observe(bandEl.value)
    window.addEventListener('resize', measure)
})
onBeforeUnmount(() => {
    observer?.disconnect()
    window.removeEventListener('resize', measure)
})

const tableStyle = computed(() => {
    const aspect = props.aspect ?? 1720 / 980
    const room = feltRoom.value
    return {
        flex: '100 1 640px',
        maxWidth: room === null ? `max(20rem, calc((100dvh - 250px) * ${aspect}))` : `max(20rem, ${Math.max(0, room) * aspect}px)`
    }
})

// On a phone the chat folds to one line (the latest message) until opened.
const chatOpen = ref(false)
const lastChat = computed(() => [...props.feed].reverse().find(item => item.kind === 'chat' || item.kind === 'settled') ?? null)
</script>

<template>
  <GameFrame :slug="slug" wide>
    <template #actions>
      <span v-if="!solo" class="mr-1 hidden items-center gap-1 rounded-full bg-black/25 sm:flex px-2 py-1 text-xs font-semibold text-muted-foreground" :title="`${watching} at the table`"><Eye class="size-3.5" />{{ watching }}</span>
      <Button v-if="seated" size="sm" variant="ghost" class="h-11 text-muted-foreground" :disabled="leaving" :title="leaving ? 'Standing up after this hand' : 'Leave seat'" @click="$emit('leave')">
        <DoorOpen class="size-4" /><span class="hidden sm:inline">{{ leaving ? 'Leaving' : 'Leave' }}</span>
      </Button>
      <Button size="icon" variant="ghost" class="size-11" :title="sound.muted.value ? 'Sound on' : 'Mute'" @click="sound.toggle()">
        <VolumeX v-if="sound.muted.value" class="size-5" />
        <Volume2 v-else class="size-5" />
      </Button>
    </template>

    <div class="flex flex-wrap items-start justify-center gap-3">
      <div ref="tableEl" class="lt-table min-w-0 rounded-[28px] bg-[#120c08] shadow-[0_8px_0_#0a0604,0_24px_44px_-16px_rgba(0,0,0,.8)] ring-2 ring-[#3a2010] [overflow:clip]" :class="`felt-${tone ?? 'green'}`" :style="tableStyle">
        <GameWinBurst :show="win ?? null">
          <slot name="felt" />
        </GameWinBurst>

        <div ref="bandEl" class="lt-band">
          <div class="lt-band-status">
            <p class="msg">
              <template v-if="!connected"><Loader2 class="mr-1 inline size-4 animate-spin" />Connecting</template>
              <template v-else-if="clock.nextAt !== null">{{ message }} · next <LiveTableCount :clock="clock" /></template>
              <template v-else>{{ message }}</template>
            </p>
            <LiveTableRing v-if="clock.nextAt === null" :clock="clock" />
          </div>

          <!-- Watching: anyone can, sitting needs the game built. -->
          <div v-if="connected && !seated" class="lt-watch">
            <Eye class="eye size-7" :stroke-width="2.5" />
            <div class="min-w-0 flex-1">
              <p class="t">Watching</p>
              <p class="s">
                <template v-if="!canSit">Build {{ name }} to take a seat.</template>
                <template v-else-if="openSeat === null">The table is full. A seat opens when someone leaves.</template>
                <template v-else>{{ players ? `${players} playing.` : 'The table is open.' }} Pick a seat and join in.</template>
              </p>
            </div>
            <button v-if="!canSit" type="button" class="lb-tile lb-tile-green shrink-0" @click="$emit('build')">
              <Hammer class="size-5" :stroke-width="2.75" /> BUILD
            </button>
            <button v-else-if="openSeat !== null" type="button" class="lb-tile lb-tile-green shrink-0" @click="$emit('sit', openSeat)">SIT DOWN</button>
          </div>

          <slot name="controls" />

          <div class="flex flex-wrap items-center gap-2 text-[11px]">
            <slot name="footer" />
            <TableBankroll class="ml-auto" />
          </div>
        </div>
      </div>

      <aside v-if="!solo" class="g-ui @container w-full min-w-0 lg:w-auto" style="flex: 1 1 18rem">
        <div class="grid grid-cols-1 gap-3 @2xl:grid-cols-2">
          <section class="g-panel rounded-[22px]">
            <button type="button" class="flex min-h-12 w-full items-center gap-2.5 px-3 text-left lg:pointer-events-none" :aria-expanded="chatOpen" @click="chatOpen = !chatOpen">
              <span class="side-icon bg-[#4aa6ff]"><MessageCircle class="size-4" :stroke-width="2.75" /></span>
              <span class="g-title text-lg uppercase">Table</span>
              <span v-if="!chatOpen && lastChat" class="min-w-0 flex-1 truncate text-xs text-[var(--g-muted)] lg:hidden">
                <b class="text-[var(--g-ink)]">{{ lastChat.name }}</b> {{ lastChat.text }}
              </span>
              <span v-else class="flex-1" />
              <ChevronDown class="size-5 shrink-0 text-[var(--g-muted)] transition-transform lg:hidden" :stroke-width="3" :class="chatOpen ? 'rotate-180' : ''" />
            </button>
            <div class="px-3 pb-3 lg:block" :class="chatOpen ? 'block' : 'hidden'">
              <TableFeed :items="feed" :can-chat="connected" :send="sendChat" />
            </div>
          </section>
          <section v-if="scoreboard.length" class="g-panel rounded-[22px] p-3">
            <h2 class="mb-2 flex items-center gap-2.5"><span class="side-icon bg-[#ffc93a]"><Trophy class="size-4" :stroke-width="2.75" /></span><span class="g-title text-lg uppercase">This session</span></h2>
            <ol class="g-well space-y-1 rounded-2xl p-1.5">
              <li v-for="(row, i) in scoreboard.slice(0, 8)" :key="row.playerId" class="flex min-h-9 items-center gap-2 rounded-xl px-1.5 text-[13px] font-semibold" :class="[row.seated ? '' : 'opacity-60', i === 0 && row.net > 0 ? 'bg-[#ffc93a]/10' : '']">
                <span class="g-num w-5 text-center text-sm" :class="i === 0 ? 'text-[#ffc93a]' : 'text-[var(--g-muted)]'">{{ i + 1 }}</span>
                <TableAvatar :name="row.name" :image="row.image" :size="24" />
                <span class="min-w-0 flex-1 truncate">{{ row.name }}</span>
                <span v-if="row.winStreak > 1" class="g-num rounded-full bg-[#ff9a2e] px-1.5 text-[10px] leading-4 text-white" :title="`${row.winStreak} wins in a row`">W{{ row.winStreak }}</span>
                <span class="g-num inline-flex items-center gap-1 text-sm" :class="row.net > 0 ? 'text-[#7ee08f]' : 'text-[var(--g-muted)]'">
                  <CasinoChipIcon v-if="row.net > 0" class="size-4" />{{ row.net > 0 ? '+' : row.net < 0 ? '−' : '' }}{{ formatCoins(Math.abs(row.net)) }}
                </span>
              </li>
            </ol>
          </section>
        </div>
      </aside>
    </div>

    <template #rules>
      <slot name="rules" />
      <p v-if="!solo" class="text-muted-foreground">
        A live table: up to five players share each round. Bets on the layout are taken when betting closes (from your coins first, then your chips) and held until the hand settles; every win pays chips.
        If you drop out mid-hand, the clock plays for you (stand or fold) and the hand still settles; if the casino restarts mid-hand, every bet comes back.
      </p>
    </template>
  </GameFrame>
</template>

<style scoped>
.side-icon {
  display: grid;
  width: 2rem;
  height: 2rem;
  flex-shrink: 0;
  place-items: center;
  border-radius: 0.75rem;
  border: 2px solid rgb(0 0 0 / 0.4);
  color: #fff;
  box-shadow: 0 3px 0 rgb(0 0 0 / 0.4), inset 0 2px 0 rgb(255 255 255 / 0.35);
}
</style>
