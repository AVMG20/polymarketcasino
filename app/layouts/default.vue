<script setup lang="ts">
const { embedded } = useHubBridge()
</script>

<template>
  <!-- The bar's height plus its 1px bottom border: the floor pages fill exactly the rest (no page scrollbar). -->
  <div class="flex min-h-dvh flex-col" :style="{ '--topbar-h': embedded ? 'calc(2.75rem + 1px)' : 'calc(3.5rem + 1px)' }">
    <CasinoTopBar />
    <main class="flex-1">
      <slot />
    </main>
  </div>
</template>
