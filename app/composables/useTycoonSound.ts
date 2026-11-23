/**
 * My Casino's short effects, synthesized with Web Audio (no files, no
 * network): coins from the cage, the hammer of a new build, a fanfare when
 * it is done, a level-up jingle, the crowd of an ad campaign, a mission
 * chime and a soft tap for buttons. Quiet by default and sharing the
 * casino's one mute switch (`casino:muted`, the games use it too).
 *
 * Browsers only let audio start after a user gesture: the context is made on
 * the first tap or key press anywhere, and effects asked for before that are
 * skipped (a build that finishes before the first tap stays silent).
 */
export type TycoonEffect = 'tap' | 'collect' | 'kaching' | 'hammer' | 'fanfare' | 'levelUp' | 'campaign' | 'mission' | 'zone'

const MUTE_KEY = 'casino:muted'
/** Everything plays through this: quiet next to the games. */
const MASTER = 0.55

let context: AudioContext | null = null
let master: GainNode | null = null
let unlocked = false
let listening = false

function unlock() {
    if (unlocked) return
    try {
        context ??= new AudioContext()
        master ??= context.createGain()
        master.gain.value = MASTER
        master.connect(context.destination)
        if (context.state === 'suspended') void context.resume()
        unlocked = true
        window.removeEventListener('pointerdown', unlock, true)
        window.removeEventListener('keydown', unlock, true)
    } catch {
        // No Web Audio: the casino stays silent.
    }
}

function listen() {
    if (listening || !import.meta.client) return
    listening = true
    window.addEventListener('pointerdown', unlock, true)
    window.addEventListener('keydown', unlock, true)
}

function out(): { ctx: AudioContext, dest: GainNode } | null {
    if (!unlocked || !context || !master) return null
    if (context.state === 'suspended') void context.resume()
    return { ctx: context, dest: master }
}

interface Tone {
    freq: number
    to?: number
    type?: OscillatorType
    at?: number
    length?: number
    gain?: number
    attack?: number
}

function tone(ctx: AudioContext, dest: AudioNode, { freq, to, type = 'sine', at = 0, length = 0.12, gain = 0.1, attack = 0.008 }: Tone) {
    const start = ctx.currentTime + at
    const osc = ctx.createOscillator()
    const amp = ctx.createGain()
    osc.type = type
    osc.frequency.setValueAtTime(freq, start)
    if (to) osc.frequency.exponentialRampToValueAtTime(to, start + length)
    amp.gain.setValueAtTime(0.0001, start)
    amp.gain.exponentialRampToValueAtTime(gain, start + attack)
    amp.gain.exponentialRampToValueAtTime(0.0001, start + length)
    osc.connect(amp).connect(dest)
    osc.start(start)
    osc.stop(start + length + 0.03)
}

/** A burst of filtered noise. */
interface Noise {
    at?: number
    length?: number
    gain?: number
    freq?: number
    /** Move the band to this frequency over the length (a whoosh). */
    sweep?: number
    q?: number
    type?: BiquadFilterType
    /** Fade in over the first half instead of a hit. */
    swell?: boolean
}

function noise(ctx: AudioContext, dest: AudioNode, { at = 0, length = 0.08, gain = 0.08, freq = 2_000, sweep, q = 1, type = 'bandpass', swell = false }: Noise) {
    const start = ctx.currentTime + at
    const buffer = ctx.createBuffer(1, Math.max(1, Math.floor(ctx.sampleRate * length)), ctx.sampleRate)
    const data = buffer.getChannelData(0)
    // Cosmetic only: noise for a hammer, a whoosh, a crowd.
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1
    const src = ctx.createBufferSource()
    const filter = ctx.createBiquadFilter()
    const amp = ctx.createGain()
    filter.type = type
    filter.Q.value = q
    filter.frequency.setValueAtTime(freq, start)
    if (sweep) filter.frequency.exponentialRampToValueAtTime(sweep, start + length)
    amp.gain.setValueAtTime(0.0001, start)
    amp.gain.exponentialRampToValueAtTime(gain, start + (swell ? length * 0.45 : 0.005))
    amp.gain.exponentialRampToValueAtTime(0.0001, start + length)
    src.buffer = buffer
    src.connect(filter).connect(amp).connect(dest)
    src.start(start)
}

const C5 = 523.25
const E5 = 659.25
const G5 = 783.99
const C6 = 1_046.5
const E6 = 1_318.5
const G6 = 1_568

function render(effect: TycoonEffect, ctx: AudioContext, dest: AudioNode) {
    switch (effect) {
        case 'tap':
            tone(ctx, dest, { freq: 720, to: 520, length: 0.05, gain: 0.05 })
            break
        case 'collect': {
            // A cascade of coins: bright pings that tumble down and thin out.
            const pings = [2_637, 3_136, 2_349, 2_794, 3_520, 2_093, 2_637, 3_136, 2_349]
            pings.forEach((f, i) => {
                const at = i * 0.045 + (i % 2) * 0.012
                tone(ctx, dest, { freq: f, type: 'triangle', at, length: 0.09, gain: 0.07 * (1 - i / 14) })
                tone(ctx, dest, { freq: f * 1.5, type: 'sine', at: at + 0.005, length: 0.05, gain: 0.025 })
            })
            tone(ctx, dest, { freq: C6, type: 'triangle', at: 0.42, length: 0.3, gain: 0.06 })
            tone(ctx, dest, { freq: E6, type: 'triangle', at: 0.47, length: 0.32, gain: 0.05 })
            break
        }
        case 'kaching':
            // The coins land in the pill: a register drawer (a thump and a rattle), then the bell.
            tone(ctx, dest, { freq: 150, to: 70, type: 'triangle', length: 0.1, gain: 0.12 })
            noise(ctx, dest, { length: 0.12, gain: 0.07, freq: 3_200, q: 1.5 })
            noise(ctx, dest, { at: 0.03, length: 0.16, gain: 0.04, freq: 6_500, type: 'highpass' })
            tone(ctx, dest, { freq: 2_093, at: 0.07, length: 0.55, gain: 0.07 })
            tone(ctx, dest, { freq: 2_093 * 2.76, at: 0.07, length: 0.18, gain: 0.018 })
            tone(ctx, dest, { freq: 2_637, at: 0.15, length: 0.7, gain: 0.08 })
            tone(ctx, dest, { freq: 2_637 * 2.76, at: 0.15, length: 0.2, gain: 0.02 })
            break
        case 'hammer':
            // Three taps on wood: a thud and a click each.
            for (const at of [0, 0.17, 0.34]) {
                tone(ctx, dest, { freq: 170, to: 90, type: 'triangle', at, length: 0.09, gain: 0.14 })
                noise(ctx, dest, { at, length: 0.05, gain: 0.1, freq: 1_400, q: 2 })
            }
            break
        case 'fanfare':
            [C5, E5, G5].forEach((f, i) => tone(ctx, dest, { freq: f, type: 'square', at: i * 0.11, length: 0.13, gain: 0.035 }))
            for (const f of [C5, E5, G5, C6]) {
                tone(ctx, dest, { freq: f, type: 'sawtooth', at: 0.36, length: 0.75, gain: 0.022, attack: 0.03 })
                tone(ctx, dest, { freq: f, type: 'triangle', at: 0.36, length: 0.8, gain: 0.04, attack: 0.02 })
            }
            noise(ctx, dest, { at: 0.36, length: 0.5, gain: 0.03, freq: 7_000, type: 'highpass' })
            break
        case 'zone':
            // Bigger than a build: a drum roll into the fanfare, an octave up at the end.
            for (let i = 0; i < 8; i++) noise(ctx, dest, { at: i * 0.045, length: 0.05, gain: 0.04 + i * 0.008, freq: 300, q: 0.8, type: 'lowpass' })
            ;[C5, E5, G5, C6].forEach((f, i) => tone(ctx, dest, { freq: f, type: 'square', at: 0.38 + i * 0.1, length: 0.12, gain: 0.035 }))
            for (const f of [C5, E5, G5, C6, E6]) {
                tone(ctx, dest, { freq: f, type: 'sawtooth', at: 0.8, length: 1.1, gain: 0.02, attack: 0.04 })
                tone(ctx, dest, { freq: f, type: 'triangle', at: 0.8, length: 1.2, gain: 0.04, attack: 0.03 })
            }
            noise(ctx, dest, { at: 0.8, length: 0.9, gain: 0.035, freq: 6_000, type: 'highpass' })
            break
        case 'levelUp':
            [C5, E5, G5, C6, E6].forEach((f, i) => tone(ctx, dest, { freq: f, type: 'triangle', at: i * 0.07, length: i === 4 ? 0.5 : 0.14, gain: 0.08 }))
            tone(ctx, dest, { freq: G6, type: 'sine', at: 0.35, length: 0.6, gain: 0.04 })
            break
        case 'campaign':
            // A whoosh, then the crowd: wide noise that swells and fades, and two horn toots.
            noise(ctx, dest, { length: 0.45, gain: 0.07, freq: 300, sweep: 3_500, q: 1.2, swell: true })
            noise(ctx, dest, { at: 0.3, length: 1.1, gain: 0.05, freq: 1_100, q: 0.6, swell: true })
            noise(ctx, dest, { at: 0.35, length: 0.9, gain: 0.03, freq: 2_400, q: 0.9, swell: true })
            tone(ctx, dest, { freq: 440, type: 'square', at: 0.38, length: 0.12, gain: 0.03 })
            tone(ctx, dest, { freq: 554, type: 'square', at: 0.52, length: 0.2, gain: 0.03 })
            break
        case 'mission':
            // A bell: two clear partials with a long tail, then a sparkle.
            tone(ctx, dest, { freq: E6, at: 0, length: 0.7, gain: 0.07 })
            tone(ctx, dest, { freq: E6 * 2.76, at: 0, length: 0.25, gain: 0.015 })
            tone(ctx, dest, { freq: G6, at: 0.13, length: 0.8, gain: 0.07 })
            tone(ctx, dest, { freq: G6 * 2.76, at: 0.13, length: 0.25, gain: 0.015 })
            ;[2_093, 2_637, 3_136].forEach((f, i) => tone(ctx, dest, { freq: f, type: 'triangle', at: 0.3 + i * 0.05, length: 0.1, gain: 0.03 }))
            break
    }
}

export function useTycoonSound() {
    const muted = useState('casino:muted', () => {
        try {
            return localStorage.getItem(MUTE_KEY) === '1'
        } catch {
            return false
        }
    })
    listen()

    function play(effect: TycoonEffect) {
        if (muted.value) return
        const audio = out()
        if (!audio) return
        try {
            render(effect, audio.ctx, audio.dest)
        } catch {
            // A browser that refuses a node: no sound, nothing else breaks.
        }
    }

    function toggle() {
        muted.value = !muted.value
        try {
            localStorage.setItem(MUTE_KEY, muted.value ? '1' : '0')
        } catch {
            // Private mode: the switch still works for this visit.
        }
        if (!muted.value) play('tap')
    }

    return { muted, play, toggle }
}
