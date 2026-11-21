export * from './types'
export { evaluateGrid, payFor } from './evaluate'
export { playSlot, slotPayout, triggerCount, MAX_FREE_SPINS } from './engine'
export { spinata, SPINATA_LINES } from './games/spinata'
export { trashpanda } from './games/trashpanda'
export { candyrush } from './games/candyrush'

import { candyrush } from './games/candyrush'
import { spinata } from './games/spinata'
import { trashpanda } from './games/trashpanda'
import type { SlotConfig } from './types'

export const SLOT_CONFIGS: Readonly<Record<string, SlotConfig>> = { spinata, trashpanda, candyrush }
