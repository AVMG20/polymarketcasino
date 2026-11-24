import type { Component } from 'vue'
import { Crown, DoorOpen } from 'lucide-vue-next'
import type { HouseRuleId, HouseRuleOption, RulesBody } from '#shared/visitors'

/** What the rules panel calls each rule. */
export const RULE_INFO: Record<HouseRuleId, { name: string, icon: Component, color: string }> = {
    door: { name: 'Door policy', icon: DoorOpen, color: '#4aa6ff' },
    vip: { name: 'VIP room', icon: Crown, color: '#ffc93a' }
}

const SEEN_KEY = 'tycoon:rules-seen'

/**
 * House rules (state.house): the rules this casino has unlocked, their
 * options with the live expected change, the cooldown, and which rules the
 * player has not seen yet (a "New" bubble, remembered in localStorage).
 */
export function useHouseRules() {
    const tycoon = useTycoon()
    const seen = useState<HouseRuleId[] | null>('tycoon:rules-seen', () => null)
    /** The rules panel is open (index.vue shows it; the HUD opens it). */
    const open = useState('tycoon:rules-open', () => false)

    if (import.meta.client && seen.value === null) {
        try {
            const raw = JSON.parse(localStorage.getItem(SEEN_KEY) ?? '[]')
            seen.value = Array.isArray(raw) ? raw.filter((x): x is HouseRuleId => x in RULE_INFO) : []
        } catch {
            seen.value = []
        }
    }

    const house = tycoon.house
    const unlocked = computed(() => house.value?.unlocked ?? [])
    /** The first unlocked rule the player has not looked at yet, or null. */
    const fresh = computed<HouseRuleId | null>(() => (seen.value ? unlocked.value.find(id => !seen.value!.includes(id)) ?? null : null))

    function markSeen() {
        const next = [...new Set([...(seen.value ?? []), ...unlocked.value])]
        seen.value = next
        try {
            localStorage.setItem(SEEN_KEY, JSON.stringify(next))
        } catch {
            // Private mode: the bubble shows again next time.
        }
    }

    /** Time left before a rule can change again (ms), 0 when it can now. */
    const cooldownMs = computed(() => {
        const until = house.value?.cooldownUntil
        return until ? Math.max(0, until - tycoon.serverTime.value) : 0
    })

    /** The unlocked rules with their options, in unlock order. */
    const groups = computed(() => unlocked.value.map(rule => ({
        rule,
        ...RULE_INFO[rule],
        options: (house.value?.options ?? []).filter(o => o.rule === rule)
    })))

    async function pick(option: HouseRuleOption) {
        if (option.active || cooldownMs.value > 0) return null
        return tycoon.setRules({ [option.rule]: option.value } as RulesBody)
    }

    function show() {
        open.value = true
        markSeen()
    }

    return { house, unlocked, fresh, groups, cooldownMs, open, show, markSeen, pick }
}
