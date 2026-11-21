// Procedural Web Audio voice shared by the bespoke slots' synth recipes (from the old
// site's SHAPEZZ synth). Each effect schedules a handful of nodes (oscillators, filtered
// noise, envelopes) on a SynthVoice, which cleans them up once every source has ended.
// Noise uses Math.random: cosmetic only.

interface SynthKit {
    white: AudioBuffer
    pink: AudioBuffer
    curves: Map<number, Float32Array<ArrayBuffer>>
}

const kits = new WeakMap<BaseAudioContext, SynthKit>()

function makeNoise(ctx: BaseAudioContext, pink: boolean): AudioBuffer {
    const length = Math.floor(ctx.sampleRate * 2)
    const buffer = ctx.createBuffer(1, length, ctx.sampleRate)
    const data = buffer.getChannelData(0)
    let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0
    for (let i = 0; i < length; i++) {
        const white = Math.random() * 2 - 1
        if (!pink) {
            data[i] = white
            continue
        }
        // Paul Kellet's pink filter.
        b0 = 0.99886 * b0 + white * 0.0555179
        b1 = 0.99332 * b1 + white * 0.0750759
        b2 = 0.96900 * b2 + white * 0.1538520
        b3 = 0.86650 * b3 + white * 0.3104856
        b4 = 0.55000 * b4 + white * 0.5329522
        b5 = -0.7616 * b5 - white * 0.0168980
        data[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + white * 0.5362) * 0.11
        b6 = white * 0.115926
    }
    return buffer
}

/** Build (once per context) the noise buffers the recipes share. */
export function synthWarmUp(ctx: BaseAudioContext): SynthKit {
    let kit = kits.get(ctx)
    if (!kit) {
        kit = { white: makeNoise(ctx, false), pink: makeNoise(ctx, true), curves: new Map() }
        kits.set(ctx, kit)
    }
    return kit
}

function driveCurve(kit: SynthKit, amount: number): Float32Array<ArrayBuffer> {
    let curve = kit.curves.get(amount)
    if (!curve) {
        curve = new Float32Array(1024)
        const norm = Math.tanh(amount)
        for (let i = 0; i < curve.length; i++) {
            const x = (i / (curve.length - 1)) * 2 - 1
            curve[i] = Math.tanh(x * amount) / norm
        }
        kit.curves.set(amount, curve)
    }
    return curve
}

/** Frequency of a note `semis` semitones from A4 (440 Hz). */
export function synthNote(semis: number): number {
    return 440 * Math.pow(2, semis / 12)
}

const PENTATONIC = [0, 3, 5, 7, 10]

/** Semitone offset of step `step` on the A minor pentatonic scale. */
export function synthPentatonic(step: number): number {
    const octave = Math.floor(step / 5)
    return octave * 12 + PENTATONIC[((step % 5) + 5) % 5]!
}

interface Envelope {
    /** Seconds after the voice start. */
    at?: number
    attack?: number
    /** Seconds held at peak before the decay. */
    hold?: number
    /** Exponential decay time to silence. */
    dur: number
    gain?: number
    dest?: AudioNode
    /** WaveShaper drive (tanh amount) before the envelope. */
    drive?: number
}

export interface SynthToneSpec extends Envelope {
    type?: OscillatorType
    freq: number
    /** Exponential sweep target. */
    to?: number
    /** Sweep time, defaults to the full sound. */
    glide?: number
    detune?: number
    /** Pitch LFO: rate in Hz, depth in Hz. */
    wobble?: { rate: number, depth: number, type?: OscillatorType }
    /** Amplitude LFO: rate in Hz, depth 0..1. */
    tremolo?: { rate: number, depth: number }
    /** Ignore the voice pitch multiplier. */
    fixed?: boolean
}

export interface SynthNoiseSpec extends Envelope {
    color?: 'white' | 'pink'
    filter?: BiquadFilterType
    freq: number
    to?: number
    glide?: number
    q?: number
    /** Amplitude LFO: rate in Hz, depth 0..1 (square for crackle). */
    tremolo?: { rate: number, depth: number, type?: OscillatorType }
}

export interface SynthFilterSpec {
    type?: BiquadFilterType
    freq: number
    to?: number
    at?: number
    glide?: number
    q?: number
    dest?: AudioNode
}

export interface SynthVoiceSetup {
    /** Output gain of the voice. */
    level: number
    pan?: number
    pitch?: number
    /** Context time the recipe starts at. */
    start: number
}

/** One playing sound: owns every node its recipe created. */
export class SynthVoice {
    readonly t: number
    readonly pitch: number
    readonly output: GainNode
    onDone: (() => void) | null = null
    private readonly kit: SynthKit
    private readonly nodes: AudioNode[] = []
    private readonly sources: AudioScheduledSourceNode[] = []
    private pending = 0
    private sealed = false
    private done = false

    constructor(readonly ctx: BaseAudioContext, destination: AudioNode, setup: SynthVoiceSetup) {
        this.kit = synthWarmUp(ctx)
        this.t = setup.start
        this.pitch = setup.pitch ?? 1
        this.output = this.track(ctx.createGain())
        this.output.gain.value = setup.level
        const pan = Math.max(-1, Math.min(1, setup.pan ?? 0))
        if (pan !== 0 && typeof ctx.createStereoPanner === 'function') {
            const panner = this.track(ctx.createStereoPanner())
            panner.pan.value = pan
            this.output.connect(panner)
            panner.connect(destination)
        } else {
            this.output.connect(destination)
        }
    }

    /** Random factor 1 ± amount (cosmetic variation). */
    vary(amount: number): number {
        return 1 + (Math.random() * 2 - 1) * amount
    }

    tone(spec: SynthToneSpec): OscillatorNode {
        const { start, end } = this.span(spec)
        const osc = this.track(this.ctx.createOscillator())
        osc.type = spec.type ?? 'sine'
        const scale = spec.fixed ? 1 : this.pitch
        osc.frequency.setValueAtTime(this.hz(spec.freq * scale), start)
        if (spec.to !== undefined) {
            osc.frequency.exponentialRampToValueAtTime(this.hz(spec.to * scale), start + (spec.glide ?? end - start))
        }
        if (spec.detune) osc.detune.value = spec.detune
        if (spec.wobble) this.lfo(spec.wobble.rate, spec.wobble.depth * scale, osc.frequency, start, end, spec.wobble.type)
        let head: AudioNode = this.envelope(spec, start)
        if (spec.drive) head = this.shaper(spec.drive, head)
        if (spec.tremolo) head = this.tremolo(spec.tremolo.rate, spec.tremolo.depth, head, start, end)
        osc.connect(head)
        this.schedule(osc, start, end)
        return osc
    }

    noise(spec: SynthNoiseSpec): AudioBufferSourceNode {
        const { start, end } = this.span(spec)
        const src = this.track(this.ctx.createBufferSource())
        const buffer = spec.color === 'pink' ? this.kit.pink : this.kit.white
        src.buffer = buffer
        src.loop = true
        let head: AudioNode = this.envelope(spec, start)
        if (spec.drive) head = this.shaper(spec.drive, head)
        if (spec.tremolo) head = this.tremolo(spec.tremolo.rate, spec.tremolo.depth, head, start, end, spec.tremolo.type)
        const filter = this.filter({
            type: spec.filter ?? 'lowpass',
            freq: spec.freq,
            to: spec.to,
            at: spec.at,
            glide: spec.glide ?? end - start,
            q: spec.q,
            dest: head
        })
        src.connect(filter)
        this.schedule(src, start, end, Math.random() * (buffer.duration - 0.1))
        return src
    }

    filter(spec: SynthFilterSpec): BiquadFilterNode {
        const start = this.t + (spec.at ?? 0)
        const filter = this.track(this.ctx.createBiquadFilter())
        filter.type = spec.type ?? 'lowpass'
        filter.frequency.setValueAtTime(this.hz(spec.freq * this.pitch), start)
        if (spec.to !== undefined) {
            filter.frequency.exponentialRampToValueAtTime(this.hz(spec.to * this.pitch), start + (spec.glide ?? 0.2))
        }
        filter.Q.value = spec.q ?? 0.7
        filter.connect(spec.dest ?? this.output)
        return filter
    }

    shaper(amount: number, dest: AudioNode = this.output): WaveShaperNode {
        const shaper = this.track(this.ctx.createWaveShaper())
        shaper.curve = driveCurve(this.kit, amount)
        shaper.connect(dest)
        return shaper
    }

    gain(value: number, dest: AudioNode = this.output): GainNode {
        const gain = this.track(this.ctx.createGain())
        gain.gain.value = value
        gain.connect(dest)
        return gain
    }

    lfo(rate: number, depth: number, param: AudioParam, start: number, end: number, type: OscillatorType = 'sine') {
        const osc = this.track(this.ctx.createOscillator())
        osc.type = type
        osc.frequency.value = rate
        const amount = this.track(this.ctx.createGain())
        amount.gain.value = depth
        osc.connect(amount)
        amount.connect(param)
        this.schedule(osc, start, end)
    }

    /** Fade out quickly and stop every source (voice stealing / stop()). */
    release(fade = 0.015) {
        if (this.done) return
        const now = this.ctx.currentTime
        const gain = this.output.gain
        gain.cancelScheduledValues(now)
        gain.setValueAtTime(gain.value, now)
        gain.linearRampToValueAtTime(0, now + fade)
        for (const src of this.sources) {
            try {
                src.stop(now + fade + 0.005)
            } catch {
                // Already stopped.
            }
        }
    }

    /** Call once the recipe finished scheduling. */
    seal() {
        this.sealed = true
        if (this.pending === 0) this.finish()
    }

    private track<T extends AudioNode>(node: T): T {
        this.nodes.push(node)
        return node
    }

    private hz(freq: number): number {
        return Math.max(10, Math.min(this.ctx.sampleRate / 2 - 100, freq))
    }

    private span(env: Envelope) {
        const start = this.t + (env.at ?? 0)
        const end = start + (env.attack ?? 0.002) + (env.hold ?? 0) + env.dur
        return { start, end }
    }

    private envelope(env: Envelope, start: number): GainNode {
        const attack = env.attack ?? 0.002
        const hold = env.hold ?? 0
        const peak = Math.max(0.0002, env.gain ?? 1)
        const node = this.track(this.ctx.createGain())
        const p = node.gain
        p.setValueAtTime(0, start)
        p.linearRampToValueAtTime(peak, start + attack)
        if (hold > 0) p.setValueAtTime(peak, start + attack + hold)
        p.exponentialRampToValueAtTime(0.0001, start + attack + hold + env.dur)
        node.connect(env.dest ?? this.output)
        return node
    }

    private tremolo(rate: number, depth: number, dest: AudioNode, start: number, end: number, type: OscillatorType = 'sine'): GainNode {
        const node = this.gain(1 - depth / 2, dest)
        this.lfo(rate, depth / 2, node.gain, start, end, type)
        return node
    }

    private schedule(src: AudioScheduledSourceNode, start: number, end: number, offset?: number) {
        this.sources.push(src)
        this.pending++
        src.onended = () => {
            this.pending--
            if (this.sealed && this.pending === 0) this.finish()
        }
        if (offset !== undefined && src instanceof AudioBufferSourceNode) src.start(start, offset)
        else src.start(start)
        src.stop(end + 0.02)
    }

    private finish() {
        if (this.done) return
        this.done = true
        for (const src of this.sources) src.onended = null
        for (const node of this.nodes) node.disconnect()
        this.sources.length = 0
        this.nodes.length = 0
        this.onDone?.()
    }
}
