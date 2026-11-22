<script setup lang="ts">
import { ArrowRight } from 'lucide-vue-next'
import { toast } from 'vue-sonner'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { formatCoins, parseAmount } from '#shared/money'

/** Gems → coins. One-way; presets stay small (players earn 10 gems a day). */
const { wallet, convert } = useWallet()
const open = ref(false)
const text = ref('5')
const busy = ref(false)

// Gems are whole: `2,5` reads as nothing to convert rather than rounding.
const gems = computed(() => {
    const amount = parseAmount(text.value)
    return amount !== null && Number.isInteger(amount) ? amount : 0
})
const limits = computed(() => wallet.value?.convert ?? { min: 1, max: 100 })
const have = computed(() => wallet.value?.gems ?? null)
const maxGems = computed(() => Math.min(limits.value.max, have.value ?? limits.value.max))
const coins = computed(() => gems.value * (wallet.value?.coinsPerGem ?? 1_000))
const presets = [1, 5, 10]
const valid = computed(() => gems.value >= limits.value.min && gems.value <= maxGems.value)
const available = computed(() => !!wallet.value?.hubAccount)

async function submit() {
    if (!valid.value) return
    busy.value = true
    try {
        await convert(gems.value)
        open.value = false
    } catch (error) {
        toast.error(apiErrorMessage(error, 'Conversion failed'))
    } finally {
        busy.value = false
    }
}
</script>

<template>
  <Dialog v-model:open="open">
    <DialogTrigger as-child>
      <slot :available="available">
        <Button size="sm" variant="secondary" :disabled="!available">
          <CasinoGemIcon class="size-4 text-gem" />
          Convert
        </Button>
      </slot>
    </DialogTrigger>
    <DialogContent class="sm:max-w-sm">
      <DialogHeader>
        <DialogTitle class="font-display">Convert gems</DialogTitle>
        <DialogDescription>1 gem = {{ formatCoins(wallet?.coinsPerGem ?? 1000) }} coins. Coins never turn back into gems.</DialogDescription>
      </DialogHeader>

      <div class="space-y-4">
        <div class="flex flex-wrap gap-2">
          <Button v-for="preset in presets" :key="preset" size="sm" variant="outline" :disabled="preset > maxGems" @click="text = String(preset)">
            {{ preset }}
          </Button>
          <Button size="sm" variant="outline" :disabled="maxGems < 1" @click="text = String(maxGems)">Max</Button>
        </div>
        <div class="flex items-center gap-3">
          <div class="relative flex-1">
            <Input v-model="text" inputmode="numeric" class="pr-12 font-mono" @keydown.enter="submit" />
            <CasinoGemIcon class="absolute top-1/2 right-3 size-4 -translate-y-1/2 text-gem" />
          </div>
          <ArrowRight class="size-4 text-muted-foreground" />
          <CasinoCoinChip :amount="coins" />
        </div>
        <p v-if="have === null" class="text-xs font-medium text-destructive">Gems unavailable right now</p>
        <p v-else class="text-xs text-muted-foreground">You have {{ have }} gems.</p>
        <Button class="w-full font-display" :disabled="!valid || busy || have === null" @click="submit">
          Convert {{ gems }} {{ gems === 1 ? 'gem' : 'gems' }}
        </Button>
      </div>
    </DialogContent>
  </Dialog>
</template>
