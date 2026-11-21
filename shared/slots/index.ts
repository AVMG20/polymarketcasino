export * from './types'
export { evaluateGrid, payFor } from './evaluate'
export { playSlot, slotPayout, triggerCount, MAX_FREE_SPINS } from './engine'
export { trashpanda } from './games/trashpanda'

import { trashpanda } from './games/trashpanda'
import type { SlotConfig } from './types'

export const SLOT_CONFIGS: Readonly<Record<string, SlotConfig>> = { trashpanda }
