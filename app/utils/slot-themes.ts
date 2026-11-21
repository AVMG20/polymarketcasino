import type { Component } from 'vue'
import { CupSoda, Donut, Fish, PawPrint, Pizza, Trash2 } from 'lucide-vue-next'

/**
 * How each slot looks and sounds. The engine (shared/slots) knows symbols by
 * id; a theme gives every id a picture: an image, a lucide icon, or a card
 * rank in type.
 */
export interface SymbolSkin {
    label: string
    image?: string
    icon?: Component
    text?: string
    /** Tile background and glyph colour. */
    bg: string
    fg: string
}

export interface SlotSounds {
    spin?: string
    stop?: string
    win?: string
    bigWin?: string
    scatter?: string
    feature?: string
    buy?: string
}

export interface SlotTheme {
    /** Page background behind the reels. */
    backdrop: string
    /** The reel window. */
    frame: string
    accent: string
    /** Display font for the win counter and banners. */
    font: string
    featureName: string
    symbols: Record<string, SymbolSkin>
    sounds?: SlotSounds
}

const card = (text: string, bg: string, fg: string): SymbolSkin => ({ label: text, text, bg, fg })

const spinataImage = (name: string, label: string): SymbolSkin => ({ label, image: `/slots/spinata/${name}.png`, bg: 'transparent', fg: '#fff' })
const SPINATA_SOUND = '/slots/spinata/sound'

export const SLOT_THEMES: Record<string, SlotTheme> = {
    spinata: {
        backdrop: 'url(/slots/spinata/bg.jpg) center / cover',
        frame: 'linear-gradient(180deg, rgb(255 244 214 / .92), rgb(255 226 170 / .92))',
        accent: '#ff3d7f',
        font: '\'Bricolage Grotesque\', sans-serif',
        featureName: 'Festival of Spins',
        symbols: {
            ten: spinataImage('ten', '10'),
            jack: spinataImage('jack', 'J'),
            queen: spinataImage('queen', 'Q'),
            king: spinataImage('king', 'K'),
            ace: spinataImage('ace', 'A'),
            maracas: spinataImage('maracas', 'Maracas'),
            cactus: spinataImage('cactus', 'Cactus'),
            sombrero: spinataImage('sombrero', 'Sombrero'),
            flower: spinataImage('flower', 'Flower'),
            wild: spinataImage('wild', 'Piñata wild'),
            scatter: spinataImage('scatter', 'Scatter')
        },
        sounds: {
            spin: `${SPINATA_SOUND}/sfx_generic_start_spin.mp3`,
            stop: `${SPINATA_SOUND}/sp_sfx_reel_stop.mp3`,
            win: `${SPINATA_SOUND}/sp_sfx_low_symbol_win.mp3`,
            bigWin: `${SPINATA_SOUND}/sp_sfx_big_win_intro.mp3`,
            scatter: `${SPINATA_SOUND}/sp_sfx_scatter_stop_1.mp3`,
            feature: `${SPINATA_SOUND}/sp_sfx_free_spins_popup.mp3`,
            buy: `${SPINATA_SOUND}/sfx_buy_feature_click.mp3`
        }
    },

    trashpanda: {
        backdrop: 'radial-gradient(circle at 30% 0%, #2f3b52, #121722 70%)',
        frame: 'linear-gradient(180deg, #1c2333, #151a26)',
        accent: '#9ae66e',
        font: '\'Bricolage Grotesque\', sans-serif',
        featureName: 'The Heist',
        symbols: {
            ten: card('10', '#232b3d', '#8fa3c7'),
            jack: card('J', '#232b3d', '#7fc8d8'),
            queen: card('Q', '#232b3d', '#d89be0'),
            king: card('K', '#232b3d', '#f0b56b'),
            ace: card('A', '#232b3d', '#ef7f7f'),
            can: { label: 'Soda can', icon: CupSoda, bg: '#2b3a4f', fg: '#6ec3ff' },
            fish: { label: 'Fish bones', icon: Fish, bg: '#2e4140', fg: '#7ee0c4' },
            pizza: { label: 'Cold pizza', icon: Pizza, bg: '#4a3626', fg: '#ffc35a' },
            donut: { label: 'Donut', icon: Donut, bg: '#4b2b3f', fg: '#ff8ac4' },
            wild: { label: 'Panda wild', icon: PawPrint, bg: '#f5f5f0', fg: '#1a1a1a' },
            scatter: { label: 'Dumpster', icon: Trash2, bg: '#3f7a3a', fg: '#dfffd0' }
        }
    }
}
