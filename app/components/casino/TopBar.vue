<script setup lang="ts">
import { ChevronLeft, LogOut } from 'lucide-vue-next'
import { Button } from '@/components/ui/button'

/**
 * Slim when embedded in the hub (the hub's own bar shows the player and
 * gems), fuller when the casino runs on its own domain.
 */
const { player, coins, signOut } = useCasinoSession()
const { wallet, refresh, setGems } = useWallet()
const { embedded, onHello } = useHubBridge()
const route = useRoute()
const inGame = computed(() => route.path.startsWith('/games/'))

onMounted(() => {
    if (!wallet.value) void refresh()
    // The hub greets the iframe with the player's gem count.
    onHello(gems => setGems(gems))
})
</script>

<template>
  <header class="sticky top-0 z-40 border-b bg-background/85 backdrop-blur">
    <div class="mx-auto flex max-w-7xl items-center gap-3 px-4" :class="embedded ? 'h-11' : 'h-14'">
      <NuxtLink v-if="inGame" to="/" class="inline-flex items-center gap-1 text-sm font-medium text-muted-foreground hover:text-foreground">
        <ChevronLeft class="size-4" />
        Lobby
      </NuxtLink>
      <NuxtLink v-else-if="!embedded" to="/" class="font-display text-lg font-extrabold tracking-tight whitespace-nowrap">
        Polynux <span class="text-primary">Casino</span>
      </NuxtLink>

      <div class="ml-auto flex items-center gap-2">
        <CasinoStarTrack v-if="wallet && !embedded" :level="wallet.stars.level" size="sm" class="mr-1 hidden md:flex" />
        <CasinoCoinChip :amount="coins" />
        <template v-if="!embedded && wallet?.hubAccount">
          <CasinoGemChip :amount="wallet.gems" />
        </template>
        <CasinoConvertDialog v-if="wallet?.hubAccount" />
        <template v-if="!embedded && player">
          <span class="hidden text-sm font-medium sm:inline">{{ player.name }}</span>
          <Button size="icon-sm" variant="ghost" title="Sign out" @click="signOut">
            <LogOut class="size-4" />
          </Button>
        </template>
      </div>
    </div>
  </header>
</template>
