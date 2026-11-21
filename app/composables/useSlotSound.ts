/** A game's short effects, by name. */
export interface SlotSounds {
    spin?: string
    stop?: string
    win?: string
    bigWin?: string
    scatter?: string
    feature?: string
    buy?: string
}

const MUTE_KEY = 'casino:muted'

function readMuted() {
    try {
        return localStorage.getItem(MUTE_KEY) === '1'
    } catch {
        return false
    }
}

/** Plays a theme's short effects; the mute switch is remembered per browser. */
export function useSlotSound(sounds: SlotSounds | undefined) {
    const muted = useState('casino:muted', readMuted)
    const cache = new Map<string, HTMLAudioElement>()

    function play(name: keyof SlotSounds, volume = 0.6) {
        const src = sounds?.[name]
        if (!src || muted.value) return
        let audio = cache.get(src)
        if (!audio) {
            audio = new Audio(src)
            cache.set(src, audio)
        }
        audio.volume = volume
        audio.currentTime = 0
        void audio.play().catch(() => {})
    }

    function toggle() {
        muted.value = !muted.value
        try {
            localStorage.setItem(MUTE_KEY, muted.value ? '1' : '0')
        } catch {
            // Private mode: the switch still works for this visit.
        }
    }

    return { enabled: !!sounds, muted, play, toggle }
}
