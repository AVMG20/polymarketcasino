import { GAMES } from '#shared/games/registry'
import { CASINO_ICON } from '#shared/icon'
import { CASINO_GAME_SLUG, CASINO_STARS } from '#shared/stars'
import type { HubManifest } from './hub'
import { casinoEnv } from './env'

/** What the casino declares to the hub: one game, `casino`, with its ten stars. */
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
                    + 'Convert gems into coins, claim a free daily allowance, and hold coins for stars: lose them and the stars go too.',
                playPath: '/',
                icon: CASINO_ICON,
                cover: `${publicUrl}/images/casino-cover.svg`,
                accent: '#e0a100',
                stars: CASINO_STARS.map(({ key, name, description }) => ({ key, name, description }))
            }
        ]
    }
}
