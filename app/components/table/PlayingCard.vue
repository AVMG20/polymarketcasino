<script setup lang="ts">
import type { Card } from '#shared/tables/cards'

/**
 * One playing card. A card keyed by its id slides in when it first appears
 * and turns over in place when a face-down card gains its rank and suit.
 */
const props = withDefaults(defineProps<{ card: Card, size?: 'xs' | 'sm' | 'md' | 'lg', delay?: number, dim?: boolean }>(), { size: 'md', delay: 0 })

const SUITS = { hearts: '♥', diamonds: '♦', clubs: '♣', spades: '♠' } as const
const faceUp = computed(() => !!props.card.rank && !!props.card.suit && !props.card.hidden)
const red = computed(() => props.card.suit === 'hearts' || props.card.suit === 'diamonds')
const glyph = computed(() => (props.card.suit ? SUITS[props.card.suit] : ''))

const sizes = {
    xs: 'h-11 w-8 rounded text-[10px]',
    sm: 'h-[3.25rem] w-9 rounded-md text-xs',
    md: 'h-[4.5rem] w-[3.25rem] rounded-lg text-sm',
    lg: 'h-24 w-[4.25rem] rounded-lg text-base'
}
const pip = { xs: 'text-base', sm: 'text-lg', md: 'text-2xl', lg: 'text-4xl' }
</script>

<template>
  <div class="deal-in relative shrink-0 [perspective:600px]" :class="[sizes[size], dim ? 'opacity-45 saturate-50' : '']" :style="{ animationDelay: `${delay}ms` }">
    <div
      class="absolute inset-0 transition-transform duration-500 ease-out [transform-style:preserve-3d] motion-reduce:transition-none"
      :class="faceUp ? '' : '[transform:rotateY(180deg)]'"
    >
      <div class="absolute inset-0 flex flex-col overflow-hidden border border-black/10 bg-[#fbfaf6] p-[0.2em] leading-none shadow-md [backface-visibility:hidden]" :class="[sizes[size], red ? 'text-[#d32f45]' : 'text-[#1b1f2a]']">
        <template v-if="faceUp">
          <span class="font-display font-extrabold">{{ card.rank }}</span>
          <span class="-mt-px">{{ glyph }}</span>
          <span class="absolute inset-0 grid place-items-center" :class="pip[size]">{{ glyph }}</span>
        </template>
      </div>
      <div
        class="absolute inset-0 border-2 border-white/90 shadow-md [backface-visibility:hidden] [transform:rotateY(180deg)]"
        :class="sizes[size]"
        style="background: repeating-linear-gradient(45deg, oklch(0.55 0.2 285) 0 5px, oklch(0.65 0.19 285) 5px 10px)"
      />
    </div>
  </div>
</template>

<style scoped>
.deal-in {
    animation: deal-in 360ms cubic-bezier(.2, .8, .3, 1.15) both;
}

@keyframes deal-in {
    from {
        opacity: 0;
        transform: translate(40px, -70px) rotate(14deg) scale(.85);
    }
}

@media (prefers-reduced-motion: reduce) {
    .deal-in {
        animation: none;
    }
}
</style>
