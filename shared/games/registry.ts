import { TABLE_MAX_BET, TABLE_MIN_BET } from '../tables/chips'

/**
 * Every game the lobby lists. A game appears here only when it is complete:
 * rules in shared/, a server implementation in server/utils/games.ts (or, for
 * a live table, server/utils/tables/) and a client in app/components/games/.
 * The lobby, the routes and the server all read this.
 */

export type GameKind = 'slot' | 'table' | 'original'

export interface GameInfo {
    slug: string
    name: string
    kind: GameKind
    tagline: string
    /** Cover art under public/. */
    cover: string
    /** Return to player, as a fraction (0.96 = 96%). */
    rtp: number
    volatility: 'low' | 'medium' | 'high'
    minBet: number
    maxBet: number
    /**
     * A multiplayer live table: played over /api/tables/<slug>/ws (seats,
     * shared rounds, escrow) instead of POST /api/games/<slug>/play. `minBet`
     * and `maxBet` are per betting spot.
     */
    live?: true
}

/**
 * Payouts are whole coins, rounded down. Below ~100 coins that rounding eats
 * a visible slice of a fractional multiplier (dice 1.96× on 10 pays 19), so
 * games with fractional pays start at 100. Roulette pays whole multiples and
 * starts at 10.
 */
export const MIN_BET = 100
export const MAX_BET = 1_000_000

export const GAMES: readonly GameInfo[] = [
    {
        slug: 'spinata',
        name: 'Spiñata',
        kind: 'slot',
        tagline: '20 lines and a wild multiplier that keeps climbing in free spins',
        cover: '/images/games/spinata.jpg',
        rtp: 0.96,
        volatility: 'medium',
        minBet: MIN_BET,
        maxBet: MAX_BET
    },
    {
        slug: 'trashpanda',
        name: 'Trash Panda Heist',
        kind: 'slot',
        tagline: '1,024 ways and sticky panda wilds in the heist',
        cover: '/images/games/trashpanda.jpg',
        rtp: 0.96,
        volatility: 'high',
        minBet: MIN_BET,
        maxBet: MAX_BET
    },
    {
        slug: 'candyrush',
        name: 'Candy Rush',
        kind: 'slot',
        tagline: 'Cluster pops on a 7×7 grid with a multiplier that never resets in free spins',
        cover: '/images/games/candyrush.svg',
        rtp: 0.96,
        volatility: 'high',
        minBet: MIN_BET,
        maxBet: MAX_BET
    },
    {
        slug: 'aethergates',
        name: 'Aethergates',
        kind: 'slot',
        tagline: '8 of a kind anywhere, tumbles and a multiplier meter that never resets in free spins',
        cover: '/images/games/aethergates.jpg',
        rtp: 0.96,
        volatility: 'high',
        minBet: MIN_BET,
        maxBet: MAX_BET
    },
    {
        slug: 'emberportals',
        name: 'Ember Portals',
        kind: 'slot',
        tagline: 'Clusters on a 7×7 grid open portal wilds that grow, jump and merge',
        cover: '/images/games/emberportals.jpg',
        rtp: 0.96,
        volatility: 'high',
        minBet: MIN_BET,
        maxBet: MAX_BET
    },
    {
        slug: 'xenoslot',
        name: 'Xeno Slot',
        kind: 'slot',
        tagline: '5 lines and a Hold & Win where UFOs collect every coin on the board',
        cover: '/images/games/xenoslot.jpg',
        rtp: 0.962,
        volatility: 'high',
        minBet: MIN_BET,
        maxBet: MAX_BET
    },
    {
        slug: 'bookofshadows',
        name: 'Book of Shadows',
        kind: 'slot',
        tagline: 'Zigzag connections on a 5×6 grid and sticky wild columns in free spins',
        cover: '/images/games/bookofshadows.jpg',
        rtp: 0.96,
        volatility: 'high',
        minBet: MIN_BET,
        maxBet: MAX_BET
    },
    {
        slug: 'fireinthehole',
        name: 'Fire in the Hole',
        kind: 'slot',
        tagline: 'Cascading mine clusters, bombs that open new rows and a coin-collecting bonus',
        cover: '/images/games/fireinthehole.jpg',
        rtp: 0.96,
        volatility: 'high',
        minBet: MIN_BET,
        maxBet: MAX_BET
    },
    {
        slug: 'candymadness',
        name: 'Candy Madness',
        kind: 'slot',
        tagline: 'Cluster pops on a 7×7 board leave multiplier spots that double and stack',
        cover: '/images/games/candymadness.jpg',
        rtp: 0.96,
        volatility: 'high',
        minBet: MIN_BET,
        maxBet: MAX_BET
    },
    {
        slug: 'roulette',
        name: 'Roulette',
        kind: 'table',
        tagline: 'Single-zero European wheel',
        cover: '/images/games/roulette.jpg',
        rtp: 0.973,
        volatility: 'low',
        minBet: 10,
        maxBet: MAX_BET
    },
    {
        slug: 'blackjack',
        name: 'Blackjack',
        kind: 'table',
        tagline: 'Live table for five: 3:2 blackjack, insurance, splits and two side bets',
        cover: '/images/games/blackjack.svg',
        rtp: 0.996,
        volatility: 'low',
        minBet: TABLE_MIN_BET,
        maxBet: TABLE_MAX_BET,
        live: true
    },
    {
        slug: 'baccarat',
        name: 'Baccarat',
        kind: 'table',
        tagline: 'Live punto banco: back the Player, the Banker or a Tie, with the roads on the wall',
        cover: '/images/games/baccarat.svg',
        rtp: 0.989,
        volatility: 'low',
        minBet: TABLE_MIN_BET,
        maxBet: TABLE_MAX_BET,
        live: true
    },
    {
        slug: 'casino-holdem',
        name: "Casino Hold'em",
        kind: 'table',
        tagline: 'Live table: two cards and the flop, then call or fold against the dealer',
        cover: '/images/games/casino-holdem.svg',
        rtp: 0.978,
        volatility: 'medium',
        minBet: TABLE_MIN_BET,
        maxBet: TABLE_MAX_BET,
        live: true
    },
    {
        slug: 'three-card-poker',
        name: 'Three Card Poker',
        kind: 'table',
        tagline: 'Live table: three cards each, play or fold, Pair Plus pays up to 40 to 1',
        cover: '/images/games/three-card-poker.svg',
        rtp: 0.966,
        volatility: 'medium',
        minBet: TABLE_MIN_BET,
        maxBet: TABLE_MAX_BET,
        live: true
    },
    {
        slug: 'dice',
        name: 'Dice',
        kind: 'original',
        tagline: 'Pick your odds, roll over or under',
        cover: '/images/games/dice.jpg',
        rtp: 0.98,
        volatility: 'low',
        minBet: MIN_BET,
        maxBet: MAX_BET
    },
    {
        slug: 'limbo',
        name: 'Limbo',
        kind: 'original',
        tagline: 'Name a multiplier and hope the result clears it',
        cover: '/images/games/limbo.jpg',
        rtp: 0.98,
        volatility: 'high',
        minBet: MIN_BET,
        maxBet: MAX_BET
    },
    {
        slug: 'polymasters',
        name: 'Poly Masters',
        kind: 'original',
        tagline: 'Fly through multipliers and rockets, then land on the island',
        cover: '/images/games/polymasters.jpg',
        rtp: 0.96,
        volatility: 'high',
        minBet: MIN_BET,
        maxBet: MAX_BET
    },
    {
        slug: 'wheel',
        name: 'Wheel',
        kind: 'original',
        tagline: 'Pick a risk and spin for up to 5×',
        cover: '/images/games/wheel.jpg',
        rtp: 0.96,
        volatility: 'medium',
        minBet: MIN_BET,
        maxBet: MAX_BET
    },
    {
        slug: 'magichands',
        name: 'Magic Hands',
        kind: 'original',
        tagline: 'Place hands on the grid and chase stacking multipliers',
        cover: '/images/games/magichands.jpg',
        rtp: 0.96,
        volatility: 'high',
        // Per hand. Tiles pay whole multiples, so a hand starts at 10 like roulette.
        minBet: 10,
        maxBet: MAX_BET
    }
]

export const GAME_KINDS: readonly { kind: GameKind, label: string }[] = [
    { kind: 'slot', label: 'Slots' },
    { kind: 'table', label: 'Tables' },
    { kind: 'original', label: 'Originals' }
]

export function findGame(slug: string): GameInfo | undefined {
    return GAMES.find(game => game.slug === slug)
}
