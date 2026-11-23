/**
 * Short synthesized effects for the quick games (Pegfall, Gem Dig, Card Climb,
 * Dice, Limbo, Wheel): Web Audio only, no files. Quiet by default, through a
 * soft compressor so ten balls on the pegs never pile up into noise, and on
 * the casino's one mute switch (`casino:muted`).
 *
 * Browsers only let audio start after a user gesture: the context is made on
 * the first tap or key press anywhere, and effects asked for before that are
 * skipped.
 */
const MUTE_KEY = 'casino:muted'
/** Everything plays through this. */
const MASTER = 0.5

let context: AudioContext | null = null
let master: GainNode | null = null
let unlocked = false
let listening = false

function unlock() {
    if (unlocked) return
    try {
        context ??= new AudioContext()
        const squash = context.createDynamicsCompressor()
        squash.threshold.value = -18
        squash.knee.value = 12
        squash.ratio.value = 4
        squash.connect(context.destination)
        master ??= context.createGain()
        master.gain.value = MASTER
        master.connect(squash)
        if (context.state === 'suspended') void context.resume()
        unlocked = true
        window.removeEventListener('pointerdown', unlock, true)
        window.removeEventListener('keydown', unlock, true)
    } catch {
        // No Web Audio: the games stay silent.
    }
}

function listen() {
    if (listening || !import.meta.client) return
    listening = true
    window.addEventListener('pointerdown', unlock, true)
    window.addEventListener('keydown', unlock, true)
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

function tone(ctx: AudioContext, dest: AudioNode, { freq, to, type = 'sine', at = 0, length = 0.12, gain = 0.1, attack = 0.006 }: Tone) {
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
    // Cosmetic only: noise for dirt, a whoosh, a blast.
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1
    const src = ctx.createBufferSource()
    const filter = ctx.createBiquadFilter()
    const amp = ctx.createGain()
    filter.type = type
    filter.Q.value = q
    filter.frequency.setValueAtTime(freq, start)
    if (sweep) filter.frequency.exponentialRampToValueAtTime(sweep, start + length)
    amp.gain.setValueAtTime(0.0001, start)
    amp.gain.exponentialRampToValueAtTime(gain, start + (swell ? length * 0.45 : 0.004))
    amp.gain.exponentialRampToValueAtTime(0.0001, start + length)
    src.buffer = buffer
    src.connect(filter).connect(amp).connect(dest)
    src.start(start)
}

/** A small bell: the note and an inharmonic shimmer above it. */
function bell(ctx: AudioContext, dest: AudioNode, freq: number, at = 0, length = 0.45, gain = 0.07) {
    tone(ctx, dest, { freq, at, length, gain })
    tone(ctx, dest, { freq: freq * 2.76, at, length: length * 0.35, gain: gain * 0.22 })
}

/** A major pentatonic run from C6: step n of a streak, so every gem or right call rings a little higher. */
function streakNote(n: number) {
    const STEPS = [0, 2, 4, 7, 9]
    const i = Math.max(0, n)
    const semis = Math.floor(i / 5) * 12 + STEPS[i % 5]!
    return 1_046.5 * 2 ** (Math.min(semis, 26) / 12)
}

const C5 = 523.25
const E5 = 659.25
const G5 = 783.99
const C6 = 1_046.5
const E6 = 1_318.5
const G6 = 1_568

let lastPeg = 0
let lastTick = 0

export function useGameSound() {
    const muted = useState('casino:muted', () => {
        try {
            return localStorage.getItem(MUTE_KEY) === '1'
        } catch {
            return false
        }
    })
    listen()

    /** Runs `draw` on the live context, unless muted or not yet unlocked. */
    function run(draw: (ctx: AudioContext, dest: AudioNode) => void) {
        if (muted.value || !unlocked || !context || !master) return
        if (context.state === 'suspended') void context.resume()
        try {
            draw(context, master)
        } catch {
            // A browser that refuses a node: no sound, nothing else breaks.
        }
    }

    return {
        muted,
        toggle() {
            muted.value = !muted.value
            try {
                localStorage.setItem(MUTE_KEY, muted.value ? '1' : '0')
            } catch {
                // Private mode: the switch still works for this visit.
            }
            if (!muted.value) {
                unlock()
                run((ctx, dest) => tone(ctx, dest, { freq: 720, to: 520, length: 0.05, gain: 0.05 }))
            }
        },
        /** A ball on a peg: a soft tick, a little higher down the board. At most one every 45 ms, whatever is in the air. */
        peg(row: number, rows: number) {
            run((ctx, dest) => {
                const now = performance.now()
                if (now - lastPeg < 45) return
                lastPeg = now
                // Cosmetic jitter so a run of ticks doesn't sound like a metronome.
                const f = (1_500 + (row / Math.max(1, rows)) * 700) * (0.96 + Math.random() * 0.08)
                tone(ctx, dest, { freq: f, to: f * 0.82, type: 'triangle', length: 0.035, gain: 0.035, attack: 0.002 })
            })
        },
        /** A ball drops into its slot: a wooden thunk, with a bell that brightens with the multiplier. */
        slot(multiplier: number) {
            run((ctx, dest) => {
                tone(ctx, dest, { freq: 190, to: 85, type: 'triangle', length: 0.11, gain: 0.1 })
                noise(ctx, dest, { length: 0.04, gain: 0.04, freq: 900, type: 'lowpass' })
                if (multiplier < 1) return
                const level = multiplier >= 100 ? 4 : multiplier >= 20 ? 3 : multiplier >= 5 ? 2 : multiplier >= 2 ? 1 : 0
                bell(ctx, dest, [G5, C6, E6, G6, 2_093][level]!, 0.02, 0.3 + level * 0.08, 0.04 + level * 0.008)
                if (level >= 2) bell(ctx, dest, [G5, C6, E6, G6, 2_093][level]! * 1.5, 0.09, 0.35, 0.035)
            })
        },
        /** A win: a rising arpeggio, longer and fuller for bigger multiples. */
        win(multiple: number) {
            run((ctx, dest) => {
                const notes = multiple >= 5 ? [C5, E5, G5, C6, E6] : multiple >= 2 ? [C5, E5, G5, C6] : [E5, G5, C6]
                notes.forEach((f, i) => tone(ctx, dest, { freq: f, type: 'triangle', at: i * 0.075, length: i === notes.length - 1 ? 0.45 : 0.14, gain: 0.07 }))
                const end = notes.length * 0.075
                if (multiple >= 5) {
                    for (const f of [C5, E5, G5, C6]) tone(ctx, dest, { freq: f, type: 'sawtooth', at: end, length: 0.7, gain: 0.014, attack: 0.03 })
                    ;[2_093, 2_637, 3_136, 2_637, 3_520].forEach((f, i) => tone(ctx, dest, { freq: f, type: 'triangle', at: end + 0.05 + i * 0.05, length: 0.1, gain: 0.025 }))
                }
                if (multiple >= 20) bell(ctx, dest, G6, end + 0.3, 0.8, 0.05)
            })
        },
        /** A miss: two soft low notes, down. */
        lose() {
            run((ctx, dest) => {
                tone(ctx, dest, { freq: 330, to: 300, type: 'triangle', length: 0.14, gain: 0.05 })
                tone(ctx, dest, { freq: 247, to: 196, type: 'triangle', at: 0.12, length: 0.28, gain: 0.05 })
            })
        },
        /** A spade into the dirt. */
        dig() {
            run((ctx, dest) => {
                noise(ctx, dest, { length: 0.09, gain: 0.12, freq: 650, q: 0.8 })
                noise(ctx, dest, { at: 0.035, length: 0.07, gain: 0.07, freq: 1_400, q: 1.2 })
                tone(ctx, dest, { freq: 130, to: 70, type: 'triangle', length: 0.08, gain: 0.08 })
            })
        },
        /** A gem: a chime that climbs with every gem in a row (`n` = gems so far, from 1). */
        gem(n: number) {
            run((ctx, dest) => {
                const f = streakNote(n - 1)
                bell(ctx, dest, f, 0, 0.5, 0.07)
                bell(ctx, dest, f * 1.5, 0.06, 0.4, 0.035)
                tone(ctx, dest, { freq: f * 2, type: 'triangle', at: 0.12, length: 0.08, gain: 0.02 })
            })
        },
        /** A bomb: a low boom and a blast of grit. */
        bomb() {
            run((ctx, dest) => {
                tone(ctx, dest, { freq: 110, to: 32, length: 0.7, gain: 0.3, attack: 0.004 })
                noise(ctx, dest, { length: 0.8, gain: 0.25, freq: 1_600, sweep: 90, q: 0.7, type: 'lowpass' })
                noise(ctx, dest, { length: 0.25, gain: 0.08, freq: 3_000, type: 'highpass' })
            })
        },
        /** Cash out: the register drawer, then its bell. */
        register() {
            run((ctx, dest) => {
                tone(ctx, dest, { freq: 150, to: 70, type: 'triangle', length: 0.1, gain: 0.11 })
                noise(ctx, dest, { length: 0.12, gain: 0.06, freq: 3_200, q: 1.5 })
                noise(ctx, dest, { at: 0.03, length: 0.16, gain: 0.035, freq: 6_500, type: 'highpass' })
                bell(ctx, dest, 2_093, 0.07, 0.55, 0.065)
                bell(ctx, dest, 2_637, 0.15, 0.7, 0.075)
            })
        },
        /** A card off the deck: a whoosh, then the snap as it turns face up (`flipAt` seconds later). */
        deal(flipAt = 0.26) {
            run((ctx, dest) => {
                noise(ctx, dest, { length: 0.16, gain: 0.07, freq: 900, sweep: 3_200, q: 0.9, swell: true })
                noise(ctx, dest, { at: flipAt, length: 0.035, gain: 0.08, freq: 3_800, q: 1.4 })
                tone(ctx, dest, { freq: 700, to: 1_000, at: flipAt, length: 0.05, gain: 0.025 })
            })
        },
        /** A right call: a ding that climbs with the streak (`n` = right calls so far, from 1). */
        ding(n: number) {
            run((ctx, dest) => {
                const f = streakNote(n - 1)
                bell(ctx, dest, f, 0, 0.4, 0.075)
                tone(ctx, dest, { freq: f * 1.25, type: 'triangle', at: 0.07, length: 0.3, gain: 0.04 })
            })
        },
        /** A wrong call: a dull thud. */
        thud() {
            run((ctx, dest) => {
                tone(ctx, dest, { freq: 150, to: 55, length: 0.3, gain: 0.2 })
                noise(ctx, dest, { length: 0.12, gain: 0.09, freq: 500, type: 'lowpass' })
                tone(ctx, dest, { freq: 220, to: 160, type: 'triangle', at: 0.08, length: 0.3, gain: 0.04 })
            })
        },
        /** A ratchet tick (a wheel peg, a dice counter): pitch 0..1, at most one every 30 ms. */
        tick(pitch = 0.5) {
            run((ctx, dest) => {
                const now = performance.now()
                if (now - lastTick < 30) return
                lastTick = now
                const f = 900 + pitch * 900
                tone(ctx, dest, { freq: f, to: f * 0.7, type: 'square', length: 0.025, gain: 0.018, attack: 0.002 })
                noise(ctx, dest, { length: 0.02, gain: 0.03, freq: 4_000, q: 2 })
            })
        },
        /** A rocket launch: a rumble and a rising whine over `seconds`. */
        launch(seconds: number) {
            run((ctx, dest) => {
                const s = Math.max(0.2, seconds)
                noise(ctx, dest, { length: s + 0.15, gain: 0.07, freq: 300, sweep: 2_400, q: 0.8, swell: true })
                tone(ctx, dest, { freq: 220, to: 880, type: 'triangle', length: s, gain: 0.03, attack: 0.05 })
            })
        }
    }
}
