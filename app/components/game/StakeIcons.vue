<script setup lang="ts">
import { splitStake } from '#shared/tycoon'

/**
 * Which money a stake comes out of: coins first, then chips for the rest.
 * A coin, a chip, or both when it takes some of each.
 */
const props = defineProps<{ amount: number }>()
const session = useCasinoSession()
const tycoon = useTycoon()
const split = computed(() => splitStake(props.amount, session.coins.value, tycoon.chips.value))
const coins = computed(() => !split.value || split.value.coins > 0)
const chips = computed(() => !!split.value && split.value.chips > 0)
</script>

<template>
  <span class="inline-flex shrink-0 items-center" :title="coins && chips ? 'Paid with coins, then chips' : chips ? 'Paid with chips' : 'Paid with coins'">
    <CasinoCoinIcon v-if="coins" class="size-[1em]" />
    <CasinoChipIcon v-if="chips" class="size-[1em]" :class="coins ? '-ml-[0.35em]' : ''" />
  </span>
</template>
