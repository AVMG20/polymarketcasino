import { GAMES } from '#shared/games/registry'
import { CASINO_ICON } from '#shared/icon'
import { CASINO_GAME_SLUG, STAR_LEVELS } from '#shared/stars'
import type { HubManifest } from './hub'
import { casinoEnv } from './env'

/** What the casino declares to the hub: one game, `casino`, with its ten star levels (one per casino goal reached). */
export function casinoManifest(): HubManifest {
    const { publicUrl } = casinoEnv()
    return {
        games: [
            {
                slug: CASINO_GAME_SLUG,
                visibility: 'public',
                name: 'Polynux Casino',
                tagline: 'Slots, tables and high rollers',
                description: `${GAMES.map(game => game.name).join(', ')}. `
                    + 'Claim coins (your casino\'s cashier cage, converted gems), win chips and build your own casino. Ten casino goals earn the stars: casino levels, every game built, played and maxed, every special and every chip cosmetic.',
                playPath: '/',
                icon: CASINO_ICON,
                cover: `${publicUrl}/images/casino-cover.svg`,
                accent: '#e0a100',
                stars: STAR_LEVELS.map(({ key, name, description }) => ({ key, name, description }))
            }
        ]
    }
}
