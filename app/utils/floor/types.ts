import type { AvatarLook, SkinId } from '#shared/cosmetics'
import type { Archetype, ZoneId } from '#shared/tycoon'
import type { VisitorCounts } from '#shared/visitors'

/**
 * What the casino floor draws. The page builds a FloorScene from the tycoon
 * state and the live table occupancy; the Pixi engine (app/utils/floor/)
 * renders it and never reads app state itself. Times are server ms; the
 * engine adds `clockOffset` to Date.now() to get server time.
 */

export type PlotStatus =
    | 'locked' // its zone is not owned yet (or not affordable/allowed): shown dim or hidden behind the zone
    | 'available' // zone owned, can be built: an empty plot with a "build" sign
    | 'building' // under construction: scaffolding and a countdown
    | 'built'

export interface FloorPlot {
    /** The game slug. */
    id: string
    archetype: Archetype
    accent: string
    zone: ZoneId
    status: PlotStatus
    /** 0 when not built, else 1..5. Higher levels draw a bigger, shinier machine. */
    level: number
    golden: boolean
    /** Set while status is 'building' (a new build or a level upgrade of a built game). */
    construction: { startedAt: number, readyAt: number } | null
    /** Live tables only: who sits there now (avatars around the table). */
    occupancy: { seated: { name: string, image: string | null, avatar?: AvatarLook }[], seats: number } | null
}

export interface FloorZone {
    id: ZoneId
    owned: boolean
    /** Can be bought next (its required zone is owned). Draw a "for sale" sign. */
    available: boolean
    construction: { startedAt: number, readyAt: number } | null
    /** The zone's skin (owned zones; missing = classic). A picker previews one by setting it here. */
    skin?: SkinId
}

export interface FloorScene {
    zones: FloorZone[]
    plots: FloorPlot[]
    cage: {
        /** 0..1; a full cage glows and bounces. */
        fill: number
        stored: number
    }
    /** Decor upgrade level 0..5: carpet, walls, lights, chandeliers. */
    decor: number
    /** Guest coins an hour: what the playing guests' coin pops add up to (and how busy the floor is without `visitors`). */
    guestsPerHour: number
    /**
     * Seated guests per tier (FloorNow.visitors): each tier walks in its own
     * clothes with a ring in its colour, a Whale glows. When set, it wins over
     * the guestsPerHour estimate. At most MAX_GUESTS are drawn (scaled down per tier).
     */
    visitors?: VisitorCounts
    /** Guests turned away at the door this tick (FloorNow.turnedAway): the floor may draw a queue at the entrance. */
    queue?: number
    /** The ad campaign running (flyers, billboard, tv), or null: the floor may show it (a billboard, a TV). */
    campaign?: string | null
    /** Guest rush active: extra guests, party lights. */
    rush: boolean
    /** `avatar`: what the player's figure wears (missing = the defaults). */
    player: { name: string, image: string | null, avatar?: AvatarLook | null }
    /**
     * Visit mode (someone else's casino, read-only): its owner. While they are
     * on the floor (a FloorRemote with `owner`) that live figure is them; else
     * they idle, dozing, by the builder desk. Unset on your own floor.
     */
    owner?: { name: string, image: string | null, avatar?: AvatarLook | null } | null
    /** Server time minus Date.now(), ms. */
    clockOffset: number
}

/** Another player on this floor right now (live presence), drawn walking with a name tag. */
export interface FloorRemote {
    id: string
    name: string
    avatar: AvatarLook | null
    /** The casino's owner: stands in for the idle owner figure. */
    owner: boolean
    /** The tile they walk to (`walk`) or stand on. */
    tile: { x: number, y: number }
    walk: boolean
    /** Bumps on every move, so the same tile twice is still a move. */
    seq: number
}

/** Your own avatar set off for a tile (`walk`) or was put there (join, teleport): what the room hears. */
export interface FloorMove {
    x: number
    y: number
    walk: boolean
}

/** At most this many NPC guests walk the floor (a phone's budget). */
export const MAX_GUESTS = 60

/** At most this many other players are drawn (the owner first). */
export const MAX_REMOTES = 20

/** What the player walked up to and clicked. */
export type FloorTarget =
    | { kind: 'game', id: string }
    | { kind: 'cage' }
    | { kind: 'zone', id: ZoneId }
    | { kind: 'builder' } // the architect's desk near the entrance: opens the build menu
    | { kind: 'self' } // the player's own avatar: opens the wardrobe

/** Imperative calls the page makes on the floor (exposed by CasinoFloor.vue). */
export interface FloorApi {
    /** Walk the avatar to a target; emits `interact` on arrival. */
    walkTo(target: FloorTarget): void
    /**
     * Put the avatar at a target at once (a game opened from the Games list
     * opens right away): no walk and no `interact`. `poof` shows a puff where
     * it leaves and lands (skip it when a full-screen game pauses the floor).
     */
    teleportTo(target: FloorTarget, poof?: boolean): void
    /** Pan the camera to a plot (or the cage); a zone is framed whole, beside a panel covering `options`. */
    focus(target: FloorTarget, options?: FloorFocusOptions): void
    /** A round finished at this game: the payout (chips) pops above the machine, guests cheer on a big win. */
    celebrate(slug: string, info: { payout: number, stake: number, chipsEarned: number, big: boolean }): void
    /** A round is playing at this game (lights spin / reels blur on the floor). */
    playing(slug: string, on: boolean): void
    /**
     * Money flying from the cage to the HUD after a collect. The cage pays
     * coins (economy v2); `to` is the HUD pill to fly to, in viewport
     * (client) pixels. Without options: chips to the top right, as before.
     */
    collected(amount: number, options?: FloorCollectOptions): void
}

/** Screen px a panel covers at the bottom (phone drawer) or the right (desktop side panel). */
export interface FloorFocusOptions {
    bottom?: number
    right?: number
}

export interface FloorCollectOptions {
    currency?: 'coins' | 'chips'
    to?: { x: number, y: number }
}

/** When the first coins of a collect reach the HUD pill (ms after `collected`): the pill counts up from then. */
export const COLLECT_LAND_MS = 520
