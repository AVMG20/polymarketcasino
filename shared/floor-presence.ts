import type { AvatarLook } from './cosmetics'

/**
 * Live presence on a casino floor: who walks around it right now. One room
 * per casino (its owner's player id), over /api/floor/<casinoId>/ws. Nothing
 * here moves money or writes the database; positions are grid tiles of the
 * floor plan (shared/floor/layout.ts).
 */

/** Someone on the floor. `x`/`y` is null until they sent where they stand. */
export interface PresenceMember {
    id: string
    name: string
    image: string | null
    avatar: AvatarLook
    /** The casino's owner (the room is theirs). */
    owner: boolean
    x: number | null
    y: number | null
    /** Walking to x/y (true) or standing there already (false: placed, teleported). */
    walk: boolean
}

export type PresenceClientMessage =
    /** Where you are walking to (`walk`), or where you stand now (a join, a teleport). */
    | { t: 'move', x: number, y: number, walk: boolean }
    /** Your look changed (wardrobe): the server reads it again and tells the others. */
    | { t: 'look' }

export type PresenceServerMessage =
    /** Sent once on join: everyone else in the room. */
    | { t: 'snapshot', you: string, members: PresenceMember[] }
    | { t: 'join', member: PresenceMember }
    | { t: 'move', id: string, x: number, y: number, walk: boolean }
    | { t: 'look', id: string, avatar: AvatarLook }
    | { t: 'leave', id: string }

/** Close codes the client acts on (no reconnect storm into a full room). */
export const PRESENCE_CLOSE = {
    /** The room holds as many players as it may. */
    full: 4429,
    /** The upgrade was fine but the context went missing (should not happen). */
    unauthorized: 4401
} as const
