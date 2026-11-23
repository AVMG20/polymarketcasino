import type { Component } from 'vue'
import { GAMES } from '#shared/games/registry'

/** The client half of every listed game, loaded on demand. */

export const GAME_COMPONENTS: Record<string, Component> = {
    'dice': defineAsyncComponent(() => import('~/components/games/DiceGame.vue')),
    'limbo': defineAsyncComponent(() => import('~/components/games/LimboGame.vue')),
    'wheel': defineAsyncComponent(() => import('~/components/games/WheelGame.vue')),
    'plinko': defineAsyncComponent(() => import('~/components/games/PlinkoGame.vue')),
    'mines': defineAsyncComponent(() => import('~/components/games/MinesGame.vue')),
    'hilo': defineAsyncComponent(() => import('~/components/games/HiLoGame.vue')),
    'magichands': defineAsyncComponent(() => import('~/components/games/MagicHandsGame.vue')),
    'polymasters': defineAsyncComponent(() => import('~/components/games/PolyMastersGame.vue')),
    'candymadness': defineAsyncComponent(() => import('~/components/games/CandyMadnessGame.vue')),
    'roulette': defineAsyncComponent(() => import('~/components/games/RouletteGame.vue')),
    'blackjack': defineAsyncComponent(() => import('~/components/games/BlackjackGame.vue')),
    'baccarat': defineAsyncComponent(() => import('~/components/games/BaccaratGame.vue')),
    'casino-holdem': defineAsyncComponent(() => import('~/components/games/CasinoHoldemGame.vue')),
    'three-card-poker': defineAsyncComponent(() => import('~/components/games/ThreeCardPokerGame.vue')),
    'spinata': defineAsyncComponent(() => import('~/components/games/SpinataGame.vue')),
    'trashpanda': defineAsyncComponent(() => import('~/components/games/TrashPandaGame.vue')),
    'aethergates': defineAsyncComponent(() => import('~/components/games/AethergatesGame.vue')),
    'emberportals': defineAsyncComponent(() => import('~/components/games/EmberPortalsGame.vue')),
    'xenoslot': defineAsyncComponent(() => import('~/components/games/XenoSlotGame.vue')),
    'bookofshadows': defineAsyncComponent(() => import('~/components/games/BookOfShadowsGame.vue')),
    'fireinthehole': defineAsyncComponent(() => import('~/components/games/FireInTheHoleGame.vue'))
}

if (import.meta.dev) {
    for (const game of GAMES) if (!GAME_COMPONENTS[game.slug]) console.warn(`[casino] ${game.slug} has no client component`)
}
