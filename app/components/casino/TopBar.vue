<script setup lang="ts">
import { ChartNoAxesColumn, ChevronLeft, LogOut, Trophy } from 'lucide-vue-next'
import { Button } from '@/components/ui/button'

/**
 * Slim when embedded in the hub (the hub's own bar shows the player and
 * gems), fuller when the casino runs on its own domain.
 */
const { player, coins, signOut } = useCasinoSession()
const { wallet, refresh, setGems } = useWallet()
const { embedded, onHello } = useHubBridge()
const tycoon = useTycoon()
const route = useRoute()
// Every page but My Casino gets the way back to it.
const away = computed(() => route.path !== '/')
const onStats = computed(() => route.path === '/stats')
// Visiting another casino: the bar blends into that floor too.
const onFloor = computed(() => !away.value || route.path.startsWith('/visit/'))
const leaderboard = useLeaderboard()

onMounted(() => {
    if (!wallet.value) void refresh()
    if (!tycoon.ready.value) void tycoon.refresh()
    // The hub greets the iframe with the player's gem count.
    onHello(gems => setGems(gems))
})
</script>

<template>
  <!-- On My Casino the bar blends into the floor; the HUD carries coins and chips there. -->
  <header class="sticky top-0 z-40 border-b" :class="onFloor ? 'dark border-white/10 bg-[#1c1424] text-white' : 'bg-background/85 backdrop-blur'">
    <div class="mx-auto flex max-w-7xl items-center gap-2 px-3 sm:gap-3 sm:px-4" :class="embedded ? 'h-11' : 'h-14'">
      <NuxtLink v-if="away" to="/" class="-ml-1.5 inline-flex h-11 min-w-11 items-center gap-1 rounded-lg px-1.5 text-sm font-medium text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50">
        <ChevronLeft class="size-5 shrink-0 sm:size-4" />
        <span class="truncate max-sm:sr-only">My Casino</span>
      </NuxtLink>
      <NuxtLink v-else-if="!embedded" to="/" class="font-display text-lg font-extrabold tracking-tight whitespace-nowrap">
        Polynux <span class="text-primary">Casino</span>
      </NuxtLink>

      <div class="ml-auto flex shrink-0 items-center gap-1.5 sm:gap-2">
        <CasinoStarTrack v-if="wallet && !embedded" :level="wallet.stars.level" size="sm" class="mr-1 hidden md:flex" />
        <Button size="icon" variant="ghost" class="max-sm:size-11" title="Leaderboard" aria-label="Leaderboard" :aria-expanded="leaderboard.open.value" @click="leaderboard.toggle()">
          <Trophy class="size-4 text-[#ffc93a]" :stroke-width="2.5" />
        </Button>
        <Button v-if="!onStats" as-child size="icon" variant="ghost" class="max-sm:size-11" title="Stats">
          <NuxtLink to="/stats" aria-label="Stats">
            <ChartNoAxesColumn class="size-4" />
          </NuxtLink>
        </Button>
        <CasinoCoinChip v-if="away" :amount="coins" />
        <!-- On My Casino the HUD shows the chips (animated). -->
        <CasinoChipPill v-if="tycoon.ready.value && away" :amount="tycoon.chips.value" />
        <!-- Phones keep coins, chips, stats and convert; the gem count and sign-out wait for sm. -->
        <template v-if="!embedded && wallet?.hubAccount">
          <CasinoGemChip :amount="wallet.gems" class="max-sm:hidden" />
        </template>
        <CasinoConvertDialog v-if="wallet?.hubAccount">
          <template #default="{ available }">
            <Button size="sm" variant="secondary" :disabled="!available" class="max-sm:size-11 max-sm:px-0" aria-label="Convert gems">
              <CasinoGemIcon class="size-4 text-gem" />
              <span class="max-sm:sr-only">Convert</span>
            </Button>
          </template>
        </CasinoConvertDialog>
        <template v-if="!embedded && player">
          <span class="hidden text-sm font-medium sm:inline">{{ player.name }}</span>
          <Button size="icon-sm" variant="ghost" class="max-sm:hidden" title="Sign out" aria-label="Sign out" @click="signOut">
            <LogOut class="size-4" />
          </Button>
        </template>
      </div>
    </div>
  </header>
  <TycoonLeaderboard />
</template>
