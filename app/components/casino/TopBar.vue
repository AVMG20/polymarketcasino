<script setup lang="ts">
import { ChartNoAxesColumn, ChevronLeft, LogOut, Trophy } from 'lucide-vue-next'
import { Button } from '@/components/ui/button'

/**
 * The slim bar over every page but My Casino (the floor's HUD has its
 * buttons there): the way back to your casino, the leaderboard, your game
 * stats and the balances. Gems convert in the Build menu's Gems tab.
 * Slimmer when embedded in the hub (the hub's own bar shows the player and gems).
 */
const { player, coins, signOut } = useCasinoSession()
const { wallet } = useWallet()
const { embedded } = useHubBridge()
const tycoon = useTycoon()
const route = useRoute()
const onStats = computed(() => route.path === '/stats')
const casinoStats = useCasinoStats()
// Visiting another casino: the bar blends into that floor.
const onFloor = computed(() => route.path.startsWith('/visit/'))
const leaderboard = useLeaderboard()
</script>

<template>
  <header class="sticky top-0 z-40 border-b" :class="onFloor ? 'dark border-white/10 bg-[#1c1424] text-white' : 'bg-background/85 backdrop-blur'">
    <div class="mx-auto flex max-w-7xl items-center gap-2 px-3 sm:gap-3 sm:px-4" :class="embedded ? 'h-11' : 'h-14'">
      <NuxtLink to="/" class="-ml-1.5 inline-flex h-11 min-w-11 items-center gap-1 rounded-lg px-1.5 text-sm font-medium text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50">
        <ChevronLeft class="size-5 shrink-0 sm:size-4" />
        <span class="truncate max-sm:sr-only">My Casino</span>
      </NuxtLink>

      <div class="ml-auto flex shrink-0 items-center gap-1.5 sm:gap-2">
        <CasinoStarTrack v-if="wallet && !embedded" :level="wallet.stars.level" size="sm" class="mr-1 hidden md:flex" />
        <Button size="icon" variant="ghost" class="max-sm:size-11" title="Leaderboard" aria-label="Leaderboard" :aria-expanded="leaderboard.open.value" @click="leaderboard.toggle()">
          <Trophy class="size-4 text-[#ffc93a]" :stroke-width="2.5" />
        </Button>
        <!-- Your game stats. The casino's guests and income charts open from the guests popover. -->
        <Button v-if="!onStats" as-child size="icon" variant="ghost" class="max-sm:size-11" title="Game stats">
          <NuxtLink to="/stats" aria-label="Game stats" @click="casinoStats.close()">
            <ChartNoAxesColumn class="size-4" />
          </NuxtLink>
        </Button>
        <CasinoCoinChip :amount="coins" />
        <CasinoChipPill v-if="tycoon.ready.value" :amount="tycoon.chips.value" />
        <!-- Phones keep coins and chips; the gem count and sign-out wait for sm. -->
        <CasinoGemChip v-if="!embedded && wallet?.hubAccount" :amount="wallet.gems" class="max-sm:hidden" />
        <template v-if="!embedded && player">
          <span class="hidden text-sm font-medium sm:inline">{{ player.name }}</span>
          <Button size="icon-sm" variant="ghost" class="max-sm:hidden" title="Sign out" aria-label="Sign out" @click="signOut">
            <LogOut class="size-4" />
          </Button>
        </template>
      </div>
    </div>
  </header>
</template>
