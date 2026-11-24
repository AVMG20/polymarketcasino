import type { VisitorTierId } from '#shared/visitors'
import { darken, lighten } from '../iso'
import type { Accessory, Hat, Look, Outfit } from './characters'
import { HAIRS, SKINS } from './palette'

/**
 * How each visitor tier dresses: three outfits per tier, worn by two faces
 * each (6 looks a tier, 24 in all: the same texture budget as the old guest
 * pool). The tier's colour runs through every outfit, so a crowd reads by
 * colour first and by clothes second: Tourists casual, Regulars smart-casual,
 * High Rollers in suits with jewellery, Whales in gold, ermine and ice.
 */
interface Outfit3 {
    outfit: Outfit
    /** The shirt: the tier colour, a shade of it, or a fixed colour. */
    shirt: (color: string) => string
    pants: string
    hat: Hat
    hatColor: (color: string) => string
    accessory: Accessory
}

const same = (c: string) => c
const OUTFITS: Record<VisitorTierId, readonly Outfit3[]> = {
    tourist: [
        { outfit: 'hawaiian', shirt: same, pants: '#c9a46a', hat: 'cap', hatColor: c => darken(c, 0.25), accessory: 'none' },
        { outfit: 'stripes', shirt: same, pants: '#4a6fa5', hat: 'none', hatColor: same, accessory: 'shades' },
        { outfit: 'classic', shirt: c => lighten(c, 0.12), pants: '#5a3f2e', hat: 'beanie', hatColor: c => darken(c, 0.3), accessory: 'headphones' }
    ],
    regular: [
        { outfit: 'classic', shirt: same, pants: '#3b3552', hat: 'none', hatColor: same, accessory: 'none' },
        { outfit: 'hoodie', shirt: same, pants: '#2f4a6b', hat: 'none', hatColor: same, accessory: 'none' },
        { outfit: 'classic', shirt: c => darken(c, 0.1), pants: '#44445a', hat: 'fedora', hatColor: () => '#3b3552', accessory: 'bowtie' }
    ],
    highroller: [
        { outfit: 'velvet', shirt: same, pants: '#1a1424', hat: 'none', hatColor: same, accessory: 'goldchain' },
        { outfit: 'tuxedo', shirt: c => darken(c, 0.35), pants: '#1a1424', hat: 'fedora', hatColor: () => '#1a1424', accessory: 'none' },
        { outfit: 'velvet', shirt: c => darken(c, 0.15), pants: '#2b2236', hat: 'none', hatColor: same, accessory: 'monocle' }
    ],
    whale: [
        { outfit: 'goldsuit', shirt: same, pants: '#1a1424', hat: 'tophat', hatColor: () => '#1a1424', accessory: 'goldchain' },
        { outfit: 'robe', shirt: () => '#a3182f', pants: '#2b2236', hat: 'crown', hatColor: same, accessory: 'icechain' },
        { outfit: 'diamond', shirt: () => '#9fdcf5', pants: '#1f2a44', hat: 'tophat', hatColor: same, accessory: 'shades' }
    ]
}

/** Faces per outfit: skin and hair pairs that read well under every hat. */
const FACES: readonly { skin: number, hair: number, style: Look['style'] }[] = [
    { skin: 0, hair: 1, style: 'short' },
    { skin: 3, hair: 0, style: 'long' },
    { skin: 1, hair: 3, style: 'bun' },
    { skin: 4, hair: 4, style: 'spiky' },
    { skin: 5, hair: 2, style: 'ponytail' },
    { skin: 2, hair: 6, style: 'short' }
]

export const LOOKS_PER_TIER = OUTFITS.tourist.length * 2

const cache = new Map<string, Look[]>()

/** The looks a tier's guests wear (LOOKS_PER_TIER of them), dressed in its colour. */
export function tierLooks(tier: VisitorTierId, color: string): Look[] {
    const key = `${tier}:${color}`
    let looks = cache.get(key)
    if (looks) return looks
    const tierIndex = (['tourist', 'regular', 'highroller', 'whale'] as const).indexOf(tier)
    looks = OUTFITS[tier].flatMap((o, i) => [0, 1].map((k) => {
        const face = FACES[(i * 2 + k + tierIndex * 2) % FACES.length]!
        return {
            skin: SKINS[face.skin]!,
            hair: HAIRS[face.hair]!,
            // A covering hat hides most hair: keep the face's style anyway (it shows below the brim).
            style: face.style,
            shirt: o.shirt(color),
            pants: o.pants,
            hat: o.hat,
            hatColor: o.hatColor(color),
            outfit: o.outfit,
            accessory: o.accessory,
            npc: true
        }
    }))
    cache.set(key, looks)
    return looks
}
