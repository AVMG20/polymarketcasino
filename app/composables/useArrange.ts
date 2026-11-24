import type { DecorType } from '#shared/decor'
import type { ArrangeItem } from '~/utils/floor/types'

/**
 * Arrange mode on My Casino's floor (move games, place decorations), the
 * decor shop and the casino level sheet: page-wide switches any panel can
 * flip (a build card with no room for its game offers "Move things", the
 * shop hands over the decoration to place). The page (index.vue) owns what
 * happens; this only holds the requests.
 */
export function useArrange() {
    /** Arrange mode is on. */
    const active = useState('tycoon:arrange', () => false)
    /** Something to pick up as soon as arrange mode is on (from the shop: a new one to buy, or one from storage). */
    const pending = useState<ArrangeItem | null>('tycoon:arrange-pending', () => null)
    /** The decor shop drawer. */
    const shopOpen = useState('tycoon:decor-shop', () => false)
    /** The casino level sheet. */
    const levelOpen = useState('tycoon:level-open', () => false)

    function start() {
        active.value = true
    }
    /** Carry a decoration to the floor: a new one (dropping it buys it) or one from storage. */
    function carry(item: ArrangeItem) {
        shopOpen.value = false
        pending.value = item
        active.value = true
    }
    const buy = (type: DecorType) => carry({ kind: 'new', type })

    return { active, pending, shopOpen, levelOpen, start, carry, buy }
}
