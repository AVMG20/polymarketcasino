<script setup lang="ts">
import { Toaster } from '@/components/ui/sonner'
import { TooltipProvider } from '@/components/ui/tooltip'

const { status } = useCasinoSession()

useHead({ titleTemplate: title => (title ? `${title} · Polynux Casino` : 'Polynux Casino') })
</script>

<template>
  <TooltipProvider :delay-duration="150">
    <div v-if="status === 'loading'" class="grid min-h-dvh place-items-center">
      <div class="size-10 animate-spin rounded-full border-4 border-primary border-t-transparent" />
    </div>
    <CasinoSignIn v-else-if="status === 'signed-out'" />
    <NuxtLayout v-else>
      <NuxtPage />
    </NuxtLayout>
    <CasinoStarCelebration />
  </TooltipProvider>
  <Toaster rich-colors position="top-center" />
</template>
