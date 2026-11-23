import type { InjectionKey, Ref } from 'vue'

/**
 * Set by the game overlay on My Casino: the game is shown inside the floor page,
 * not on its own page. GameFrame then drops the page chrome and shows a compact
 * header with the close button.
 */
export interface GameEmbed {
    close: () => void
    /** GameFrame sets this when it draws its own header, so the overlay does not add a second one. */
    headerClaimed: Ref<boolean>
}

export const GAME_EMBED: InjectionKey<GameEmbed> = Symbol('game-embed')

/** Games that open as a bottom sheet with the floor still visible above. */
export const QUICK_GAMES: readonly string[] = ['dice', 'limbo', 'wheel', 'plinko', 'mines', 'hilo']
