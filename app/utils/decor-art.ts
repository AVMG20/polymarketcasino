import type { Component } from 'vue'
import { Armchair, BadgeDollarSign, CarFront, Coins, Diamond, Droplets, Fence, Fish, Flower2, LampFloor, Martini, Music, Piano, PersonStanding, RectangleHorizontal, Snowflake, Sofa, Sprout, Square, TreePalm, Trophy, Waves, Wine, Zap } from 'lucide-vue-next'
import { findDecor, type DecorType } from '#shared/decor'

/** A decoration's picture in the menus until the floor's own art is used: an icon on its colour. */
export const DECOR_ICONS: Record<DecorType, { icon: Component, color: string }> = {
    'plant': { icon: Sprout, color: '#3fae5a' },
    'flowers': { icon: Flower2, color: '#ff7ab0' },
    'palm': { icon: TreePalm, color: '#2f9e6e' },
    'lamp': { icon: LampFloor, color: '#e8a33a' },
    'rope': { icon: Fence, color: '#c23a55' },
    'rug': { icon: Square, color: '#9a3b5e' },
    'neon': { icon: Zap, color: '#ff4fd8' },
    'sofa': { icon: Sofa, color: '#7a4fd0' },
    'statue': { icon: PersonStanding, color: '#a9a2b8' },
    'fountain': { icon: Droplets, color: '#3aa0e8' },
    'piano': { icon: Piano, color: '#3a3150' },
    'bar': { icon: Wine, color: '#8a4a2a' },
    'golden-statue': { icon: Trophy, color: '#e8a800' },
    'jackpot-sign': { icon: BadgeDollarSign, color: '#ff3b5c' },
    'aquarium': { icon: Fish, color: '#1f8fd0' },
    'grand-piano': { icon: Music, color: '#2a2140' },
    'grand-fountain': { icon: Waves, color: '#2fb8d8' },
    'champagne-bar': { icon: Martini, color: '#d8a040' },
    'red-carpet': { icon: RectangleHorizontal, color: '#d0233c' },
    'diamond-display': { icon: Diamond, color: '#5fd0f0' },
    'showcase-car': { icon: CarFront, color: '#e83a3a' },
    'vip-booth': { icon: Armchair, color: '#8a2a5a' },
    'gold-slot': { icon: Coins, color: '#e8b400' },
    'ice-sculpture': { icon: Snowflake, color: '#9ad8f0' }
}

export function decorName(type: DecorType): string {
    return findDecor(type)?.name ?? type
}
