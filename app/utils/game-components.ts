import type { Component } from 'vue'
import { GAMES } from '#shared/games/registry'

/**
 * The client half of every listed game, loaded on demand. Slots share one
 * component, skinned by app/utils/slot-themes.ts.
 */
const slot = (slug: string) => defineAsyncComponent(async () => {
    const SlotGame = (await import('~/components/games/SlotGame.vue')).default
    return defineComponent({ name: `Slot-${slug}`, render: () => h(SlotGame, { slug }) })
})

export const GAME_COMPONENTS: Record<string, Component> = {
    'dice': defineAsyncComponent(() => import('~/components/games/DiceGame.vue')),
    'limbo': defineAsyncComponent(() => import('~/components/games/LimboGame.vue')),
    'roulette': defineAsyncComponent(() => import('~/components/games/RouletteGame.vue')),
    'blackjack': defineAsyncComponent(() => import('~/components/games/BlackjackGame.vue')),
    'baccarat': defineAsyncComponent(() => import('~/components/games/BaccaratGame.vue')),
    'casino-holdem': defineAsyncComponent(() => import('~/components/games/CasinoHoldemGame.vue')),
    'three-card-poker': defineAsyncComponent(() => import('~/components/games/ThreeCardPokerGame.vue')),
    'spinata': slot('spinata'),
    'trashpanda': slot('trashpanda'),
    'candyrush': slot('candyrush')
}

if (import.meta.dev) {
    for (const game of GAMES) if (!GAME_COMPONENTS[game.slug]) console.warn(`[casino] ${game.slug} has no client component`)
}
