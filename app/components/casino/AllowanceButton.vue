<script setup lang="ts">
import { Gift } from 'lucide-vue-next'
import { Button } from '@/components/ui/button'
import { formatCoins } from '#shared/money'

const { wallet, claimAllowance } = useWallet()
const claiming = ref(false)
const allowance = computed(() => wallet.value?.allowance)

const nextLabel = computed(() => {
    if (!allowance.value) return ''
    const ms = new Date(allowance.value.nextAt).getTime() - Date.now()
    const hours = Math.max(0, Math.floor(ms / 3_600_000))
    const minutes = Math.max(0, Math.floor((ms % 3_600_000) / 60_000))
    return hours ? `${hours}h ${minutes}m` : `${minutes}m`
})

async function claim() {
    claiming.value = true
    await claimAllowance()
    claiming.value = false
}
</script>

<template>
  <Button v-if="allowance?.available" size="sm" :disabled="claiming" class="font-display" @click="claim">
    <Gift class="size-4" />
    Claim {{ formatCoins(allowance.amount) }}
  </Button>
  <span v-else-if="allowance" class="text-xs text-muted-foreground">Next allowance in {{ nextLabel }}</span>
</template>
