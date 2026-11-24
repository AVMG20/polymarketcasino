/**
 * The slim top bar over every page but My Casino (the floor's HUD carries its
 * buttons there). `height` is what it takes off the top of the screen, for
 * panels laid over the page.
 */
export function useTopBar() {
    const route = useRoute()
    const { embedded } = useHubBridge()
    const shown = computed(() => route.path !== '/')
    // The bar's height plus its 1px bottom border.
    const height = computed(() => (!shown.value ? '0px' : embedded.value ? 'calc(2.75rem + 1px)' : 'calc(3.5rem + 1px)'))
    return { shown, height }
}
