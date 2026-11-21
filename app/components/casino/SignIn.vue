<script setup lang="ts">
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

/**
 * Shown without a session. Inside the hub the session plugin has already asked
 * the hub for a fresh launch, so this only offers to ask again. Standalone it
 * offers the hub sign-in (and the dev login when it is on).
 */
const { config, connectUrl, devLogin } = useCasinoSession()
const { embedded, relaunch } = useHubBridge()
const name = ref('Alice')
</script>

<template>
  <div class="grid min-h-dvh place-items-center px-4">
    <div class="w-full max-w-sm space-y-5 rounded-2xl border bg-card p-6 text-center">
      <h1 class="font-display text-2xl font-extrabold">Polynux <span class="text-primary">Casino</span></h1>
      <template v-if="embedded">
        <p class="text-sm text-muted-foreground">Reconnecting to Polynux…</p>
        <Button class="h-11 w-full font-display" variant="secondary" @click="relaunch()">Try again</Button>
      </template>
      <Button v-else as="a" :href="connectUrl()" class="h-11 w-full font-display">Sign in with Polynux</Button>
      <form v-if="config?.devLogin" class="space-y-2 border-t pt-5 text-left" @submit.prevent="devLogin(name)">
        <p class="text-xs font-semibold text-muted-foreground uppercase">Dev login</p>
        <div class="flex gap-2">
          <Input v-model="name" placeholder="Name" class="h-11" />
          <Button type="submit" variant="secondary" class="h-11">Play</Button>
        </div>
      </form>
    </div>
  </div>
</template>
