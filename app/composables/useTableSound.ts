/**
 * Small synthesized effects for the live tables (no audio files): chips,
 * cards, a win chime and a timer tick. Shares the casino's mute switch.
 */
type Effect = 'chip' | 'card' | 'flip' | 'win' | 'lose' | 'tick' | 'turn'

let context: AudioContext | null = null

function audio(): AudioContext | null {
    if (!import.meta.client) return null
    try {
        context ??= new AudioContext()
        if (context.state === 'suspended') void context.resume()
        return context
    } catch {
        return null
    }
}

function tone(ctx: AudioContext, { freq, to, type = 'sine', at = 0, length = 0.12, gain = 0.12 }: { freq: number, to?: number, type?: OscillatorType, at?: number, length?: number, gain?: number }) {
    const start = ctx.currentTime + at
    const osc = ctx.createOscillator()
    const amp = ctx.createGain()
    osc.type = type
    osc.frequency.setValueAtTime(freq, start)
    if (to) osc.frequency.exponentialRampToValueAtTime(to, start + length)
    amp.gain.setValueAtTime(0.0001, start)
    amp.gain.exponentialRampToValueAtTime(gain, start + 0.01)
    amp.gain.exponentialRampToValueAtTime(0.0001, start + length)
    osc.connect(amp).connect(ctx.destination)
    osc.start(start)
    osc.stop(start + length + 0.02)
}

function noise(ctx: AudioContext, length = 0.06, gain = 0.08, at = 0) {
    const buffer = ctx.createBuffer(1, Math.floor(ctx.sampleRate * length), ctx.sampleRate)
    const data = buffer.getChannelData(0)
    // Cosmetic only: a burst of noise for a card sliding on felt.
    for (let i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / data.length)
    const src = ctx.createBufferSource()
    const amp = ctx.createGain()
    const filter = ctx.createBiquadFilter()
    filter.type = 'bandpass'
    filter.frequency.value = 2_400
    amp.gain.value = gain
    src.buffer = buffer
    src.connect(filter).connect(amp).connect(ctx.destination)
    src.start(ctx.currentTime + at)
}

export function useTableSound() {
    const muted = useState('casino:muted', () => {
        try {
            return localStorage.getItem('casino:muted') === '1'
        } catch {
            return false
        }
    })

    function play(effect: Effect) {
        if (muted.value) return
        const ctx = audio()
        if (!ctx) return
        switch (effect) {
            case 'chip':
                tone(ctx, { freq: 2_200, to: 1_600, type: 'triangle', length: 0.05, gain: 0.08 })
                tone(ctx, { freq: 2_900, type: 'triangle', at: 0.03, length: 0.04, gain: 0.05 })
                break
            case 'card':
                noise(ctx, 0.07, 0.09)
                break
            case 'flip':
                noise(ctx, 0.05, 0.07)
                tone(ctx, { freq: 600, to: 900, type: 'sine', length: 0.06, gain: 0.04 })
                break
            case 'win':
                for (const [i, f] of [660, 880, 1_320].entries()) tone(ctx, { freq: f, type: 'triangle', at: i * 0.09, length: 0.22, gain: 0.1 })
                break
            case 'lose':
                tone(ctx, { freq: 300, to: 180, type: 'sine', length: 0.3, gain: 0.08 })
                break
            case 'tick':
                tone(ctx, { freq: 1_400, type: 'square', length: 0.03, gain: 0.03 })
                break
            case 'turn':
                tone(ctx, { freq: 880, type: 'sine', length: 0.12, gain: 0.08 })
                tone(ctx, { freq: 1_175, type: 'sine', at: 0.1, length: 0.16, gain: 0.08 })
                break
        }
    }

    function toggle() {
        muted.value = !muted.value
        try {
            localStorage.setItem('casino:muted', muted.value ? '1' : '0')
        } catch {
            // Private mode: the switch still works for this visit.
        }
    }

    return { muted, play, toggle }
}
