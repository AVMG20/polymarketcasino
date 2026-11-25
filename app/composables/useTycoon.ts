import { toast } from 'vue-sonner'
import { casinoLevel, gameUnlockLevel, type CasinoLevel } from '#shared/casino-level'
import type { CosmeticBuyBody } from '#shared/cosmetics'
import { placedSpecials, specialBonus, type BuyDecorBody, type OwnedDecor, type PlaceBody, type SpecialBonus } from '#shared/decor'
import { normalizeCoins } from '#shared/money'
import type { MissionKey, MissionView, WelcomeBack } from '#shared/missions'
import {
    activeCampaigns, buildBlocker, campaignsOf, cageAt, campaignBlocker, campaignBoost, campaignCost, CAMPAIGNS, findCampaign, findTycoonGame, findUpgrade, findZone,
    floorView, levelOf, newGameSpot, nextCost, RUSH_GEMS, rushGems, skipGems, TYCOON_GAMES, UPGRADES, ZONES,
    type BuildBody, type BuildKind, type CampaignDef, type CampaignId, type Construction, type Cost, type GemBody, type GemItem,
    type TycoonActionResponse, type TycoonState, type ZoneId
} from '#shared/tycoon'
import { campaignGain, emptyCounts, type CampaignGain, type FloorNow, type HouseState, type RulesBody, type VisitorCounts } from '#shared/visitors'

export interface QueuedConstruction extends Construction {
    leftMs: number
    total: number
}

/** Everything the build UI shows about one item, from the live state. */
export interface BuildView {
    kind: BuildKind
    id: string
    name: string
    /** Current level (0 = not built; a zone is 0 or 1). */
    level: number
    maxLevel: number
    /** Next step's cost, or null when maxed. */
    cost: Cost | null
    running: QueuedConstruction | null
    /** Name of the zone that must be opened first, or null (rooms and upgrades; games unlock by level). */
    lockZone: string | null
    /** Id of that zone, or null. */
    lockZoneId: ZoneId | null
    /** A game not built yet whose casino level is still too low: the level it needs, else null. */
    lockLevel: number | null
    /** A new game with no free spot in any room you own. */
    noRoom: boolean
    /** A built game put away (arrange mode's storage): place it to upgrade it or let guests play it. */
    stored: boolean
    /** Every builder is busy (and this item is not one of them). */
    buildersFull: boolean
    maxed: boolean
    missingChips: number
    affordable: boolean
    /** Can start right now (not counting a request already in flight). */
    canStart: boolean
}

/** The ad campaign running now. */
export interface RunningCampaign {
    def: CampaignDef
    until: number
    leftMs: number
    /** Time left as a share of one run (a campaign extended past one run reads 1). */
    fuel: number
}

/** Everything the campaign picker shows about one campaign, from the live state. */
export interface CampaignView {
    def: CampaignDef
    /** Price now, chips. */
    cost: number
    /** A guests campaign: the share of the empty seats it fills at the current Marketing level (0 for a wealth one). */
    boost: number
    /** Marketing level it needs, when it is still locked; else null. */
    lockedAt: number | null
    /** This one is running (buying it again extends it), and its queue's time left. */
    running: boolean
    leftMs: number
    /** Why it can't start now (locked, a week queued), or null. */
    blocker: string | null
    affordable: boolean
    /** What a run adds on top of what runs now, over its whole run (luck averaged): guests, rich guests, coins, the tier counts. */
    gain: CampaignGain
}

/** Every buildable item, in menu order. */
export const BUILD_ITEMS: readonly { kind: BuildKind, id: string }[] = [
    ...ZONES.filter(zone => zone.requires !== null).map(zone => ({ kind: 'zone' as const, id: zone.id })),
    ...TYCOON_GAMES.map(game => ({ kind: 'game' as const, id: game.slug })),
    ...UPGRADES.map(upgrade => ({ kind: 'upgrade' as const, id: upgrade.id }))
]

let ticker: ReturnType<typeof setInterval> | null = null
let refreshing: Promise<void> | null = null
let inflight: Promise<unknown> | null = null
let lastRefresh = 0
/**
 * The next read asks for "while you were away": the first read after the app
 * loads (whoever makes it), and the first after the tab comes back.
 */
let askWelcome = true
let roundTimer: ReturnType<typeof setTimeout> | null = null
/** While the page is open and visible, read the casino this often: the server counts it as a visit. */
const HEARTBEAT_MS = 4 * 60_000

/**
 * My Casino's state: chips, built games, zones, the construction queue and the
 * cage. One copy shared through useState. Timers and the cage are computed
 * live from the server clock (state.serverNow + a clock offset), so the HUD
 * counts down without polling; when a construction's time is up the state is
 * re-read (the server applies finished builds on every read) and the floor
 * hears about it.
 */
export function useTycoon() {
    const session = useCasinoSession()
    const wallet = useWallet()
    const floorEvents = useFloorEvents()
    const state = useState<TycoonState | null>('tycoon:state', () => null)
    const offset = useState('tycoon:offset', () => 0)
    const clock = useState('tycoon:clock', () => Date.now())
    const busy = useState('tycoon:busy', () => false)
    /** The first read failed and there is nothing to show yet: pages offer "Try again". */
    const loadFailed = useState('tycoon:load-failed', () => false)
    const lastBuilt = useState<{ kind: BuildKind, id: string, level: number, at: number } | null>('tycoon:last-built', () => null)
    /** "While you were away", until the card is closed. */
    const welcome = useState<WelcomeBack | null>('tycoon:welcome', () => null)
    /** The latest mission that just reached its target (for a chime and a nudge). */
    const missionDone = useState<{ id: MissionKey, at: number } | null>('tycoon:mission-done', () => null)
    /** Chips handed back for the removed Decor upgrade (once, on the read that paid them), until the note is closed. */
    const decorRefund = useState<number | null>('tycoon:decor-refund', () => null)
    /** The casino level just went up (for a celebration). */
    const levelUp = useState<{ level: number, at: number } | null>('tycoon:level-up', () => null)
    const sound = useTycoonSound()

    /** Server time now (ms). */
    const serverTime = computed(() => clock.value + offset.value)
    const chips = computed(() => state.value?.chips ?? 0)
    const ready = computed(() => state.value !== null)
    const gems = computed(() => wallet.wallet.value?.gems ?? null)

    /** Coins in the cage right now: what the server stored plus what has come in since. */
    const cageStored = computed(() => (state.value ? cageAt(state.value, serverTime.value) : 0))
    const cageFill = computed(() => {
        const s = state.value
        return s && s.cage.capacity > 0 ? Math.min(1, cageStored.value / s.cage.capacity) : 0
    })
    const rushActive = computed(() => !!state.value?.rushUntil && state.value.rushUntil > serverTime.value)
    const rushLeftMs = computed(() => (state.value?.rushUntil ? Math.max(0, state.value.rushUntil - serverTime.value) : 0))
    /** Gems a guest rush costs now (priced from the casino, like the server does at purchase). */
    const rushPrice = computed(() => (state.value ? rushGems(state.value) : RUSH_GEMS))

    /** The casino level, from what is built (XP from every finished build step). */
    const casino = computed<CasinoLevel>(() => (state.value ? casinoLevel(state.value) : { level: 1, xp: 0, levelXp: 0, nextXp: null }))
    /** Every decoration the casino owns; put-away ones have x = y = null. */
    const decor = computed<OwnedDecor[]>(() => state.value?.decor ?? [])
    /** Where every game on the floor stands (origin tiles). */
    const placements = computed<Record<string, { x: number, y: number }>>(() => state.value?.placements ?? {})
    /** Built games put away (not on the floor). */
    const storedGames = computed<string[]>(() => state.value?.storedGames ?? [])
    /** Games not on the floor yet that no owned room has a free spot for (read once per state, not per tick). */
    const roomless = computed(() => {
        const s = state.value
        const out = new Set<string>()
        if (!s) return out
        for (const game of TYCOON_GAMES) {
            if ((s.games[game.slug] ?? 0) === 0 && !s.constructions.some(c => c.kind === 'game' && c.id === game.slug) && !newGameSpot(s, game.slug)) out.add(game.slug)
        }
        return out
    })
    /** What the specials standing on the floor add. */
    const specials = computed<SpecialBonus>(() => specialBonus(placedSpecials(state.value?.decor ?? [])))

    /** The floor this tick: seated guests per tier, seats, the tick's rate and the expected one. */
    const floorNow = computed<FloorNow | null>(() => state.value?.floor ?? null)
    /** House rules (owner reads only). */
    const house = computed<HouseState | null>(() => state.value?.house ?? null)

    // The floor changes every tick (TICK_MS): the ticker re-reads the state when one ends.
    const seats = computed(() => floorNow.value?.seats ?? 0)
    /** Seated guests per tier. */
    const visitorTiers = computed<VisitorCounts>(() => floorNow.value?.visitors ?? emptyCounts())
    const visitors = computed(() => countTotal(visitorTiers.value))
    /** Guests turned away at the door this tick (no seat, or the door policy). */
    const waiting = computed(() => floorNow.value?.turnedAway ?? 0)
    /** Share of the seats in use, 0..1. */
    const occupied = computed(() => (seats.value > 0 ? Math.min(1, visitors.value / seats.value) : 0))
    /** Coins an hour this tick (luck included, rule costs taken off; a rush doubles it). */
    const perHour = computed(() => floorNow.value?.perHour ?? 0)
    /** Coins an hour on average for this build and these rules (no luck). */
    const expectedPerHour = computed(() => floorNow.value?.expectedPerHour ?? 0)
    /** Every campaign running now, soonest to end first. */
    const runningCampaigns = computed<RunningCampaign[]>(() => {
        const s = state.value
        if (!s) return []
        return activeCampaigns(s, serverTime.value).map((c) => {
            const leftMs = Math.max(0, c.until - serverTime.value)
            return { def: findCampaign(c.id)!, until: c.until, leftMs, fuel: Math.min(1, leftMs / c.ms) }
        })
    })
    /** The running campaign that ends first (the HUD's ring), or null. */
    const campaign = computed<RunningCampaign | null>(() => runningCampaigns.value[0] ?? null)

    /**
     * What each campaign would add over its run (good and quiet hours averaged),
     * and what of it a player collecting every four hours keeps with this cage.
     * Read at the state's clock: it only changes with a new state.
     */
    const campaignGains = computed(() => {
        const s = state.value
        if (!s) return null
        const view = floorView(s)
        return Object.fromEntries(CAMPAIGNS.map(def => [def.id, campaignGain(view, def.id, s.serverNow, { capacity: s.cage.capacity })])) as Record<CampaignId, CampaignGain>
    })

    function campaignView(def: CampaignDef): CampaignView {
        const s = state.value
        const now = serverTime.value
        const marketing = s?.upgrades.marketing ?? 0
        const cost = s ? campaignCost(s, def.id, serverTime.value) : 0
        const run = runningCampaigns.value.find(c => c.def.id === def.id)
        return {
            def,
            cost,
            boost: campaignBoost(def.id, marketing),
            lockedAt: marketing < def.requiresMarketing ? def.requiresMarketing : null,
            running: !!run,
            leftMs: run?.leftMs ?? 0,
            blocker: s ? campaignBlocker(s, def.id, now) : 'Loading',
            affordable: chips.value >= cost,
            gain: campaignGains.value?.[def.id] ?? { guests: 0, richGuests: 0, coins: 0, before: emptyCounts(), after: emptyCounts(), kept: 0, cageFullMs: null, from: now, until: now }
        }
    }
    const campaigns = computed(() => CAMPAIGNS.map(campaignView))

    /** The queue with the time left on each, soonest first. */
    const queue = computed<QueuedConstruction[]>(() => (state.value?.constructions ?? [])
        .map(c => ({ ...c, leftMs: Math.max(0, c.readyAt - serverTime.value), total: Math.max(1, c.readyAt - c.startedAt) }))
        .sort((a, b) => a.readyAt - b.readyAt))

    function apply(next: TycoonState) {
        const previous = state.value
        offset.value = next.serverNow - Date.now()
        clock.value = Date.now()
        state.value = next
        wallet.followChips(next.chips)
        wallet.followStars(next.starGoals)
        if (next.welcome) welcome.value = next.welcome
        if (next.decorRefund && next.decorRefund > 0) decorRefund.value = next.decorRefund
        if (previous) {
            // Back after a while: the welcome card lists what finished instead.
            if (!next.welcome) announceFinished(previous.constructions, next)
            announceMissions(previous, next)
            const before = casinoLevel(previous).level
            const after = casinoLevel(next).level
            if (after > before) levelUp.value = { level: after, at: Date.now() }
        }
    }

    /** A mission that was short of its target and now isn't (same day): chime. */
    function announceMissions(before: TycoonState, next: TycoonState) {
        const was = before.missions
        const now = next.missions
        if (!was || !now || was.day !== now.day) return
        const done = (m: MissionView) => m.progress >= m.target && !m.claimed
        for (const m of now.missions) {
            const old = was.missions.find(o => o.id === m.id)
            if (old && !done(old) && !old.claimed && done(m)) {
                missionDone.value = { id: m.id, at: Date.now() }
                sound.play('mission')
                return
            }
        }
    }

    const missions = computed(() => state.value?.missions ?? null)
    /** Missions (and the bonus) ready to claim. */
    const claimable = computed(() => {
        const m = missions.value
        if (!m) return 0
        return m.missions.filter(x => x.progress >= x.target && !x.claimed).length + (m.bonus.progress >= m.bonus.target && !m.bonus.claimed ? 1 : 0)
    })

    /** Constructions that were running and are gone (and now built) just finished. */
    function announceFinished(before: Construction[], next: TycoonState) {
        for (const c of before) {
            if (next.constructions.some(n => n.kind === c.kind && n.id === c.id && n.level === c.level)) continue
            const done = c.kind === 'zone' ? next.zones.includes(c.id as never)
                : c.kind === 'game' ? (next.games[c.id] ?? 0) >= c.level
                    : (next.upgrades[c.id as keyof typeof next.upgrades] ?? 0) >= c.level
            if (!done) continue
            const event = { kind: c.kind, id: c.id, level: c.level }
            lastBuilt.value = { ...event, at: Date.now() }
            floorEvents.emitBuilt(event)
        }
    }

    /** Read the casino. `welcome`: also ask what happened while the player was away. */
    async function refresh(options: { welcome?: boolean } = {}): Promise<void> {
        if (options.welcome) askWelcome = true
        if (refreshing) {
            // A read already on its way may not carry the welcome flag: read again after it.
            if (options.welcome) return refreshing.then(() => (askWelcome ? refresh() : undefined))
            return refreshing
        }
        refreshing = (async () => {
            lastRefresh = Date.now()
            const query = askWelcome ? { welcome: '1' } : undefined
            askWelcome = false
            try {
                const next = await $fetch<TycoonState>('/api/tycoon', { query })
                apply(next)
                // A read can confirm a star change too (a build that finished reached a goal).
                wallet.applyStars(next.stars)
                loadFailed.value = false
            } catch (error) {
                if (!session.handleUnauthorized(error) && !state.value) {
                    loadFailed.value = true
                    toast.error(apiErrorMessage(error, 'Could not load your casino'))
                }
            } finally {
                refreshing = null
            }
        })()
        return refreshing
    }

    async function act(path: string, body?: BuildBody | GemBody | { id: CampaignId | MissionKey } | CosmeticBuyBody | RulesBody | BuyDecorBody | PlaceBody): Promise<TycoonActionResponse | null> {
        if (busy.value) return null
        busy.value = true
        const run = (async () => {
            try {
                const response = await $fetch<TycoonActionResponse>(path, { method: 'POST', body })
                apply(response.state)
                if (response.coins !== null) session.setCoins(response.coins)
                if (response.gems !== null) wallet.setGems(response.gems)
                // A build, a special or a cosmetic can reach a casino goal.
                wallet.applyStars(response.stars)
                return response
            } catch (error) {
                if (!session.handleUnauthorized(error)) toast.error(apiErrorMessage(error, 'That did not go through'))
                void refresh()
                return null
            } finally {
                busy.value = false
            }
        })()
        inflight = run
        return run
    }

    /**
     * Empty the cage into the coins. A tap while another action is running waits
     * for it and then collects (the buttons that start builds are disabled while busy).
     * Resolves with the coins collected (0 when it failed).
     */
    async function collect(): Promise<number> {
        if (busy.value && inflight) await inflight.catch(() => null)
        const response = await act('/api/tycoon/collect')
        return response?.collected ?? 0
    }

    async function build(kind: BuildKind, id: string) {
        const response = await act('/api/tycoon/build', { kind, id })
        if (response) sound.play('hammer')
        return response
    }
    const buyGem = (item: GemItem, target?: string) => act('/api/tycoon/gems', { item, target })
    /** Buy a cosmetic priced in chips (a zone skin), with `zone` also putting it on that zone. */
    const buyCosmetic = (key: string, zone?: ZoneId) => act('/api/tycoon/cosmetics/buy', { key, zone })
    /** Wear an owned avatar item, or put an owned skin on `zone` (free). */
    const equipCosmetic = (key: string, zone?: ZoneId) => act('/api/tycoon/cosmetics/equip', { key, zone })
    /** Run (or extend) an ad campaign for chips. */
    async function startCampaign(id: CampaignId) {
        if (!findCampaign(id)) return null
        const response = await act('/api/tycoon/campaign', { id })
        if (response) sound.play('campaign')
        return response
    }
    /**
     * Run an action after the one in flight (arrange-mode saves queue behind
     * each other instead of being dropped silently). The busy check and the
     * start happen in the same tick, so two waiters can't both start.
     */
    async function queued(path: string, body: BuyDecorBody | PlaceBody) {
        for (;;) {
            while (busy.value && inflight) await inflight.catch(() => null)
            if (!busy.value || !inflight) return act(path, body)
        }
    }
    /** Buy a decoration: with x and y it is placed there at once, else it goes to storage. Null when it failed (a toast says why). */
    const buyDecor = (body: BuyDecorBody) => queued('/api/tycoon/decor', body)
    /** Move a built game, or place, move or put away a decoration (free). Null when it failed (a toast says why). */
    const place = (body: PlaceBody) => queued('/api/tycoon/place', body)
    /** Change house rules (only the given keys). Resolves with the response, or null when it failed (a toast says why). */
    const setRules = (body: RulesBody) => act('/api/tycoon/rules', body)
    /** Claim a finished mission (or the bonus): coins. Resolves with the coins paid (0 when it failed). */
    async function claimMission(id: MissionKey): Promise<number> {
        if (busy.value && inflight) await inflight.catch(() => null)
        const response = await act('/api/tycoon/mission', { id })
        if (response?.reward) sound.play('collect')
        return response?.reward ?? 0
    }

    /**
     * A round just settled somewhere: mission progress moved on the server.
     * Read it a moment after the last round of a burst, and only while a
     * mission is still short of its target.
     */
    function refreshSoon() {
        const m = missions.value
        if (!m || !m.missions.some(x => !x.claimed && x.progress < x.target)) return
        if (roundTimer) clearTimeout(roundTimer)
        roundTimer = setTimeout(() => {
            roundTimer = null
            void refresh()
        }, 2_500)
    }

    /** The chip balance after a round, a table payout or an optimistic stake. */
    function setChips(next: number) {
        const value = normalizeCoins(Math.max(0, next))
        if (state.value && state.value.chips !== value) state.value = { ...state.value, chips: value }
        wallet.followChips(value)
    }

    const blocker = (kind: BuildKind, id: string): string | null => (state.value ? buildBlocker(state.value, kind, id) : 'Loading')
    const cost = (kind: BuildKind, id: string): Cost | null => (state.value ? nextCost(state.value, kind, id) : null)
    const skipPrice = (leftMs: number) => skipGems(leftMs)

    /** The zone `kind:id` waits for, or null. */
    function requiredZone(s: TycoonState, kind: BuildKind, id: string): ZoneId | null {
        if (kind === 'zone') return findZone(id)?.requires ?? null
        // Games unlock by the casino level and stand in any room you own.
        if (kind === 'game') return null
        const upgrade = findUpgrade(id)
        return upgrade ? upgrade.requiresZone[s.upgrades[upgrade.id] ?? 0] ?? null : null
    }

    /**
     * One build item as the menus show it. `live` reads the ticking clock for
     * the running countdown; pass false where only "is it running" matters, so
     * the computed doesn't recompute four times a second.
     */
    function view(kind: BuildKind, id: string, live = true): BuildView {
        const s = state.value
        const level = s ? levelOf(s, kind, id) : 0
        const maxLevel = kind === 'game' ? findTycoonGame(id)?.levels.length ?? 1
            : kind === 'upgrade' ? findUpgrade(id)?.levels.length ?? 1 : 1
        const cost = s ? nextCost(s, kind, id) : null
        const running = live
            ? queue.value.find(c => c.kind === kind && c.id === id) ?? null
            : (() => {
                    const c = s?.constructions.find(row => row.kind === kind && row.id === id)
                    return c ? { ...c, leftMs: 0, total: Math.max(1, c.readyAt - c.startedAt) } : null
                })()
        const zone = s ? requiredZone(s, kind, id) : null
        const lockZoneId = s && zone && !s.zones.includes(zone) ? zone : null
        const lockZone = lockZoneId ? findZone(lockZoneId)?.name ?? lockZoneId : null
        const needs = kind === 'game' && level === 0 && !running ? gameUnlockLevel(id) : 0
        const lockLevel = s && needs > casino.value.level ? needs : null
        const noRoom = kind === 'game' && level === 0 && !running && !lockLevel && roomless.value.has(id)
        const stored = kind === 'game' && level >= 1 && !running && storedGames.value.includes(id)
        const buildersFull = !!s && !running && s.constructions.length >= s.builders
        const missingChips = cost ? Math.max(0, cost.chips - chips.value) : 0
        const affordable = missingChips === 0
        return {
            kind, id, name: buildName(kind, id), level, maxLevel, cost, running, lockZone, lockZoneId, lockLevel, noRoom, stored, buildersFull,
            maxed: !cost && !running,
            missingChips, affordable,
            canStart: !!s && !!cost && affordable && !running && !buildBlocker(s, kind, id)
        }
    }

    /** Items that can start right now, cheapest first. */
    const startable = computed(() => BUILD_ITEMS
        .map(item => view(item.kind, item.id, false))
        .filter(item => item.canStart)
        .sort((a, b) => (a.cost?.chips ?? 0) - (b.cost?.chips ?? 0)))
    /** The item the menu nudges toward: the cheapest one that can start. */
    const suggestion = computed(() => {
        const first = startable.value[0]
        return first ? `${first.kind}:${first.id}` : null
    })


    /**
     * The floor's tick ended after the state was read: a second's grace for the
     * server's clock, plus 0-30 s of jitter so every open casino doesn't read
     * at the same moment each quarter hour.
     */
    const tickJitter = useState('tycoon:tick-jitter', () => Math.floor(Math.random() * 30_000))
    function floorTickDue(s: TycoonState): boolean {
        const end = s.floor?.tickEndsAt
        return !!end && s.serverNow < end && end <= serverTime.value - 1000 - tickJitter.value
    }

    function start() {
        if (!import.meta.client || ticker) return
        // Back from another tab or app: say what happened while the player was away.
        document.addEventListener('visibilitychange', () => {
            if (document.visibilityState === 'visible' && state.value) void refresh({ welcome: true })
        })
        ticker = setInterval(() => {
            clock.value = Date.now()
            const s = state.value
            if (!s || refreshing || Date.now() - lastRefresh < 1500) return
            // Still here: a read now and then keeps "last seen" honest.
            if (document.visibilityState === 'visible' && Date.now() - lastRefresh > HEARTBEAT_MS) void refresh()
            // A build whose time is up: the server applies it on the next read.
            if (s.constructions.some(c => c.readyAt <= serverTime.value - 200)) void refresh()
            // The rush ran out: the server's rate (and cage) no longer include it.
            else if (s.rushUntil && s.rushUntil <= serverTime.value - 200 && s.serverNow < s.rushUntil) void refresh()
            // Same for a campaign: its visitors go home.
            else if (campaignsOf(s).some(c => c.until <= serverTime.value - 200 && s.serverNow < c.until)) void refresh()
            // A new tick: new guests came in (and the rate with them).
            else if (document.visibilityState === 'visible' && floorTickDue(s)) void refresh()
        }, 250)
    }

    onMounted(start)

    return {
        state, ready, loadFailed, chips, gems, busy, lastBuilt, serverTime, offset, welcome, missions, claimable, missionDone, levelUp, decorRefund,
        level: casino, decor, placements, storedGames, specials,
        cageStored, cageFill, rushActive, rushLeftMs, rushPrice, queue,
        seats, visitors, visitorTiers, waiting, occupied, perHour, expectedPerHour, floorNow, house, campaign, runningCampaigns, campaigns,
        startable, suggestion,
        refresh, refreshSoon, collect, build, buyDecor, place, buyGem, buyCosmetic, equipCosmetic, startCampaign, claimMission, setRules, setChips, blocker, cost, skipPrice, view
    }
}
