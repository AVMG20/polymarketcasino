<script setup lang="ts">
import { FastForward, Loader2, Play, Square, Zap } from 'lucide-vue-next'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { formatCoins } from '#shared/money'

/**
 * The casino's control strip for the bespoke slots: a bet field, turbo,
 * autoplay and spin button, plus a buy
 * dialog with one or more options. Games keep their own round logic and react
 * to the events. Space spins, stops or skips unless `spaceBlocked`.
 */
export interface SlotBuyOption {
    id: string
    title: string
    /** One short line: what the player gets. */
    description: string
    /** Coins. */
    cost: number
}

/** What the spin button does now: spin, stop the reels, skip the reveal, or wait. */
export type SlotSpinMode = 'spin' | 'stop' | 'skip' | 'wait'

const props = withDefaults(defineProps<{
    min: number
    max: number
    /** Bet and buys are locked while a round or autoplay runs. */
    locked: boolean
    spinMode: SlotSpinMode
    /** Only applies to spinMode 'spin' (not loaded yet, can't afford). */
    spinDisabled?: boolean
    autoLeft: number
    autoDisabled?: boolean
    buys?: SlotBuyOption[]
    buyDisabled?: boolean
    /** A game dialog is open: leave Space alone. */
    spaceBlocked?: boolean
}>(), {
    spinDisabled: false,
    autoDisabled: false,
    buys: () => [],
    buyDisabled: false,
    spaceBlocked: false
})

const emit = defineEmits<{
    'spin': []
    'auto-start': []
    'auto-stop': []
    'buy': [id: string]
}>()

const bet = defineModel<number>('bet', { required: true })
const turbo = defineModel<boolean>('turbo', { required: true })
const { coins } = useCasinoSession()
const buyOpen = ref(false)

const autoOn = computed(() => props.autoLeft > 0)
const spinBlocked = computed(() => props.spinMode === 'wait' || (props.spinMode === 'spin' && props.spinDisabled))

function press() {
    if (spinBlocked.value) return
    emit('spin')
}

function buy(id: string) {
    buyOpen.value = false
    emit('buy', id)
}

function onKey(event: KeyboardEvent) {
    if (event.code !== 'Space' || event.repeat || props.spaceBlocked || buyOpen.value) return
    if (event.target !== document.body) return
    event.preventDefault()
    press()
}
onMounted(() => window.addEventListener('keydown', onKey))
onBeforeUnmount(() => window.removeEventListener('keydown', onKey))

/** Games with their own buy button in the art open the same dialog. */
function openBuy() {
    if (props.locked || autoOn.value || props.buyDisabled || !props.buys.length) return
    buyOpen.value = true
}
defineExpose({ openBuy })
</script>

<template>
  <div class="grid grid-cols-1 gap-3 rounded-2xl border bg-card p-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end sm:p-4">
    <GameBetInput v-model="bet" :min="min" :max="max" :disabled="locked || autoOn" />
    <div class="grid grid-cols-[auto_auto_1fr] gap-2 sm:flex">
      <Button size="icon-lg" :variant="turbo ? 'default' : 'outline'" class="size-12" title="Turbo" @click="turbo = !turbo">
        <Zap class="size-5" />
      </Button>
      <Button v-if="autoOn" size="icon-lg" variant="outline" class="size-12" title="Stop autoplay" @click="emit('auto-stop')">
        <Square class="size-5" />
      </Button>
      <Button v-else size="lg" variant="outline" class="h-12 font-mono" :disabled="locked || autoDisabled || spinDisabled" title="Autoplay 10 spins" @click="emit('auto-start')">
        Auto 10
      </Button>
      <Button
        size="lg"
        class="h-12 min-w-32 font-display text-base shadow-[0_3px_0_0_color-mix(in_oklch,var(--primary)_60%,black)] active:translate-y-[2px] active:shadow-none"
        :disabled="spinBlocked"
        @click="press"
      >
        <template v-if="autoOn">
          <Loader2 v-if="spinMode === 'wait'" class="size-4 animate-spin" />
          <FastForward v-else-if="spinMode === 'skip'" class="size-4" />
          <Play v-else class="size-4" />
          {{ autoLeft }} left
        </template>
        <template v-else-if="spinMode === 'stop'">
          <Square class="size-4" /> Stop
        </template>
        <template v-else-if="spinMode === 'skip'">
          <FastForward class="size-4" /> Skip
        </template>
        <template v-else-if="spinMode === 'wait'">
          <Loader2 class="size-4 animate-spin" /> Spin
        </template>
        <template v-else>
          <Play class="size-4" /> Spin
        </template>
      </Button>
    </div>
    <slot />
    <Button v-if="buys.length" variant="secondary" class="h-11 sm:col-span-2" :disabled="locked || autoOn || buyDisabled" @click="buyOpen = true">
      <template v-if="buys.length === 1">Buy {{ buys[0]!.title }} · {{ formatCoins(buys[0]!.cost) }}</template>
      <template v-else>Buy feature</template>
    </Button>

    <Dialog v-model:open="buyOpen">
      <DialogContent class="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle class="font-display">Buy feature</DialogTitle>
          <DialogDescription class="sr-only">Pick a feature to buy</DialogDescription>
        </DialogHeader>
        <div class="space-y-2">
          <button
            v-for="option in buys"
            :key="option.id"
            type="button"
            class="flex min-h-14 w-full items-center justify-between gap-3 rounded-xl border bg-background px-3 py-2 text-left hover:bg-accent disabled:opacity-50"
            :disabled="coins < option.cost"
            @click="buy(option.id)"
          >
            <span class="min-w-0">
              <span class="block font-display font-bold">{{ option.title }}</span>
              <span class="block text-xs text-muted-foreground">{{ option.description }}</span>
            </span>
            <span class="shrink-0 font-mono text-sm tabular-nums">{{ formatCoins(option.cost) }}</span>
          </button>
        </div>
      </DialogContent>
    </Dialog>
  </div>
</template>
