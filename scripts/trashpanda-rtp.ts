// `bun scripts/trashpanda-rtp.ts [rounds] [bet] [seed] [buys]`: RTP, hit rate, feature rate and max win.
import { SLOT_CONFIGS } from '../shared/slots'
import { runSlotSim } from './lib/slot-sim'

runSlotSim(SLOT_CONFIGS.trashpanda!)
