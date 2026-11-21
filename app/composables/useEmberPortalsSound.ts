// Ember Portals sound playback. Every effect is synthesized on the fly
// (app/utils/slots/emberportals-synth.ts); nothing is fetched. Per-event
// levels, cooldowns and voice caps; the casino's mute switch (shared with
// every game, see useSlotSound) turns it all off.
//
// Signal chain: voice (level) -> master gain -> compressor -> speakers. The
// music has its own gain into the compressor.

import {
    EP_SOUND_COOLDOWNS,
    EP_SOUND_DEFAULT_VOICE_CAP,
    EP_SOUND_LEVELS,
    EP_SOUND_MAX_VOICES,
    EP_SOUND_VOICE_CAPS,
    EP_SYNTH_DEFAULT_JITTER,
    EP_SYNTH_JITTER,
    EP_SYNTH_RECIPES,
    EpMusic,
    EpSynthVoice,
    epSynthWarmUp,
    type EpSoundEvent
} from '~/utils/slots/emberportals-synth'

export type { EpSoundEvent }

const soundEnabled = ref(true)
const SOUND_LEVEL = 0.7

const MUSIC_LEVEL = 0.45

interface MasterBus {
    input: GainNode
    music: GainNode
    compressor: DynamicsCompressorNode
}

interface ActiveVoice {
    event: EpSoundEvent
    voice: EpSynthVoice
}

let ctx: AudioContext | null = null
let bus: MasterBus | null = null
const voices: ActiveVoice[] = []
const lastPlayedAt = new Map<EpSoundEvent, number>()
let music: EpMusic | null = null
let musicWanted = false
let bonusMode = false

function ensureContext(): AudioContext | null {
    if (!import.meta.client) return null
    if (!ctx) {
        const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
        if (!Ctx) return null
        ctx = new Ctx()
    }
    return ctx
}

function masterLevel(): number {
    return SOUND_LEVEL
}

function musicLevel(): number {
    return SOUND_LEVEL
}

function ensureBus(context: AudioContext): MasterBus {
    if (bus) return bus
    const input = context.createGain()
    input.gain.value = masterLevel()
    const compressor = context.createDynamicsCompressor()
    compressor.threshold.value = -12
    compressor.knee.value = 10
    compressor.ratio.value = 8
    compressor.attack.value = 0.003
    compressor.release.value = 0.25
    const musicGain = context.createGain()
    musicGain.gain.value = musicLevel()
    input.connect(compressor)
    musicGain.connect(compressor)
    compressor.connect(context.destination)
    bus = { input, music: musicGain, compressor }
    return bus
}

/** A running context, resumed if a gesture allows it. Null while it can't play yet. */
function runningContext(): AudioContext | null {
    if (!import.meta.client || !soundEnabled.value) return null
    const context = ensureContext()
    if (!context) return null
    if (context.state !== 'running') {
        void context.resume().catch(() => {})
        return null
    }
    return context
}

function removeVoice(entry: ActiveVoice) {
    const index = voices.indexOf(entry)
    if (index !== -1) voices.splice(index, 1)
}

function steal(entry: ActiveVoice) {
    removeVoice(entry)
    entry.voice.release()
}

function play(event: EpSoundEvent, intensity = 0, delay = 0) {
    const context = runningContext()
    if (!context) return
    const now = performance.now()
    // A delayed sound is scheduled ahead, so it doesn't count against the
    // cooldown of the next immediate one (e.g. scatters queued per column).
    if (delay <= 0) {
        if (now - (lastPlayedAt.get(event) ?? -Infinity) < EP_SOUND_COOLDOWNS[event]) return
        lastPlayedAt.set(event, now)
    }

    const cap = EP_SOUND_VOICE_CAPS[event] ?? EP_SOUND_DEFAULT_VOICE_CAP
    let same = 0
    for (const entry of voices) if (entry.event === event) same++
    if (same >= cap) {
        const oldest = voices.find(entry => entry.event === event)
        if (oldest) steal(oldest)
    }
    while (voices.length >= EP_SOUND_MAX_VOICES) steal(voices[0]!)

    const jitter = EP_SYNTH_JITTER[event] ?? EP_SYNTH_DEFAULT_JITTER
    const voice = new EpSynthVoice(context, ensureBus(context).input, {
        level: EP_SOUND_LEVELS[event],
        pitch: 1 + (Math.random() * 2 - 1) * jitter,
        start: context.currentTime + 0.005 + Math.max(0, delay)
    })
    const entry: ActiveVoice = { event, voice }
    voice.onDone = () => removeVoice(entry)
    voices.push(entry)
    try {
        EP_SYNTH_RECIPES[event](voice, intensity)
    } catch {
        voice.release(0)
    }
    voice.seal()
}

function startMusic() {
    musicWanted = true
    if (!import.meta.client || !soundEnabled.value || music) return
    const context = ensureContext()
    if (!context) return
    if (context.state !== 'running') {
        void context.resume().catch(() => {})
        return
    }
    epSynthWarmUp(context)
    music = new EpMusic(context, ensureBus(context).music, MUSIC_LEVEL)
    music.setBonus(bonusMode)
}

function silenceMusic() {
    music?.stop()
    music = null
}

function stopMusic() {
    musicWanted = false
    bonusMode = false
    silenceMusic()
}

function setBonusMusic(on: boolean) {
    bonusMode = on
    music?.setBonus(on)
}

/** Resume the context from a user gesture, then start anything waiting on it. */
function unlock() {
    if (!soundEnabled.value) return
    const context = ensureContext()
    if (!context) return
    const go = () => {
        epSynthWarmUp(context)
        if (musicWanted) startMusic()
    }
    if (context.state === 'running') go()
    else void context.resume().then(go).catch(() => {})
}

function stopEffects() {
    lastPlayedAt.clear()
    for (const entry of voices.splice(0)) entry.voice.release(0.03)
}

function stopAll() {
    stopEffects()
    silenceMusic()
    if (!ctx || !bus) return
    const old = bus
    bus = null
    const now = ctx.currentTime
    old.input.gain.cancelScheduledValues(now)
    old.input.gain.setValueAtTime(old.input.gain.value, now)
    old.input.gain.linearRampToValueAtTime(0, now + 0.02)
    setTimeout(() => {
        old.input.disconnect()
        old.music.disconnect()
        old.compressor.disconnect()
    }, 80)
}

export function useEmberPortalsSound() {
    const shell = useSlotSound({})
    // The casino's one mute switch drives this game's synth too.
    soundEnabled.value = !shell.muted.value
    watch(shell.muted, (muted) => {
        soundEnabled.value = !muted
        if (muted) stopAll()
        else unlock()
    })

    return {
        muted: shell.muted,
        toggleMute: shell.toggle,
        play,
        startMusic,
        stopMusic,
        setBonusMusic,
        unlock,
        stopEffects,
        stopAll
    }
}
