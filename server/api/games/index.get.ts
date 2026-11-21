import { GAMES } from '#shared/games/registry'

export default defineEventHandler(() => ({ games: GAMES }))
