<script setup lang="ts">
/**
 * Every page but My Casino gets the slim top bar (the way back to the floor).
 * The wallet, the casino and the hub's greeting load here, so they load on
 * the floor too, where the bar is gone.
 */
const topBar = useTopBar()
const { wallet, refresh, setGems } = useWallet()
const { onHello } = useHubBridge()
const tycoon = useTycoon()

onMounted(() => {
    if (!wallet.value) void refresh()
    if (!tycoon.ready.value) void tycoon.refresh()
    // The hub greets the iframe with the player's gem count.
    onHello(gems => setGems(gems))
})
</script>

<template>
  <!-- The floor pages fill exactly what the bar leaves (no page scrollbar). -->
  <div class="flex min-h-dvh flex-col" :style="{ '--topbar-h': topBar.height.value }">
    <CasinoTopBar v-if="topBar.shown.value" />
    <main class="flex-1">
      <slot />
    </main>
  </div>
  <TycoonLeaderboard />
  <TycoonStatsSheet />
</template>
