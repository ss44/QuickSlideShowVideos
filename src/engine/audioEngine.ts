import type { MusicConfig } from '../types/slideshow'

let sharedAudioCtx: AudioContext | null = null

export function getAudioContext(): AudioContext {
  if (!sharedAudioCtx) {
    sharedAudioCtx = new AudioContext()
  }
  return sharedAudioCtx
}

export async function decodeAudioFromFile(file: File): Promise<AudioBuffer> {
  const arrayBuffer = await file.arrayBuffer()
  const ctx = getAudioContext()
  return await ctx.decodeAudioData(arrayBuffer.slice(0))
}

export async function decodeAudioFromUrl(url: string): Promise<AudioBuffer> {
  let response: Response
  try {
    response = await fetch(url, { mode: 'cors' })
  } catch {
    throw new Error(
      'Could not load this URL directly in the browser (blocked by CORS or network error). Download the MP3 and upload it directly, or use a CORS-enabled direct audio link.',
    )
  }

  if (!response.ok) {
    throw new Error(`Audio link returned HTTP ${response.status}. Make sure it points directly to an MP3/WAV/OGG file.`)
  }

  const contentType = response.headers.get('content-type') || ''
  if (contentType.includes('text/html')) {
    throw new Error(
      'This link points to a webpage rather than a direct audio file (e.g. .mp3 / .wav). Upload an MP3 file or paste a direct audio URL.',
    )
  }

  const arrayBuffer = await response.arrayBuffer()
  const ctx = getAudioContext()
  try {
    return await ctx.decodeAudioData(arrayBuffer)
  } catch {
    throw new Error('Could not decode audio from this URL. Ensure it is a valid MP3, WAV, M4A, or OGG file.')
  }
}

/**
 * Lightweight client-side beat/onset detector using short-time energy flux.
 * Runs in <100ms for a typical 3-5 minute song.
 */
export function detectBeats(buffer: AudioBuffer): number[] {
  const sampleRate = buffer.sampleRate
  const length = buffer.length
  const numChannels = buffer.numberOfChannels

  // Downmix to mono
  const mono = new Float32Array(length)
  for (let c = 0; c < numChannels; c++) {
    const ch = buffer.getChannelData(c)
    for (let i = 0; i < length; i++) {
      mono[i] += ch[i] / numChannels
    }
  }

  // Compute RMS energy in ~23ms windows (1024 samples at 44.1kHz)
  const hopSize = Math.max(512, Math.round(sampleRate * 0.023))
  const frameCount = Math.floor(length / hopSize)
  if (frameCount < 10) return []

  const energies = new Float32Array(frameCount)
  for (let f = 0; f < frameCount; f++) {
    let sum = 0
    const start = f * hopSize
    const end = Math.min(start + hopSize, length)
    for (let i = start; i < end; i++) {
      const s = mono[i]
      sum += s * s
    }
    energies[f] = Math.sqrt(sum / (end - start))
  }

  // Compute positive energy flux (onset strength)
  const flux = new Float32Array(frameCount)
  for (let f = 1; f < frameCount; f++) {
    flux[f] = Math.max(0, energies[f] - energies[f - 1])
  }

  // Adaptive local threshold over ~1 second window
  const windowHalf = Math.max(8, Math.round(0.5 / (hopSize / sampleRate)))
  const minPeakIntervalFrames = Math.max(6, Math.round(0.28 / (hopSize / sampleRate))) // max ~210 BPM
  const beats: number[] = []
  let lastBeatFrame = -minPeakIntervalFrames

  for (let f = 2; f < frameCount - 2; f++) {
    const val = flux[f]
    if (val <= 0.005) continue
    // Local maximum check
    if (val < flux[f - 1] || val < flux[f + 1]) continue

    const wStart = Math.max(0, f - windowHalf)
    const wEnd = Math.min(frameCount - 1, f + windowHalf)
    let localMean = 0
    for (let k = wStart; k <= wEnd; k++) {
      localMean += flux[k]
    }
    localMean /= wEnd - wStart + 1

    if (val > localMean * 1.65 && f - lastBeatFrame >= minPeakIntervalFrames) {
      beats.push((f * hopSize) / sampleRate)
      lastBeatFrame = f
    }
  }

  return beats
}

/**
 * Synchronized Web Audio preview player that handles offset, looping, volume, and fade-in/out.
 */
export class PreviewAudioPlayer {
  private source: AudioBufferSourceNode | null = null
  private gainNode: GainNode | null = null

  stop() {
    if (this.source) {
      try {
        this.source.stop()
      } catch {
        // already stopped
      }
      this.source.disconnect()
      this.source = null
    }
    if (this.gainNode) {
      this.gainNode.disconnect()
      this.gainNode = null
    }
  }

  start(music: MusicConfig, timelineTime: number, totalDuration: number, muted: boolean) {
    this.stop()
    if (!music.audioBuffer || totalDuration <= 0) return

    const ctx = getAudioContext()
    if (ctx.state === 'suspended') {
      void ctx.resume()
    }

    const buffer = music.audioBuffer
    const startOffset = Math.min(music.startOffset, Math.max(0, buffer.duration - 0.1))
    const playableTrackDuration = Math.max(0.1, buffer.duration - startOffset)

    if (!music.loop && timelineTime >= playableTrackDuration) {
      return
    }

    const source = ctx.createBufferSource()
    source.buffer = buffer
    source.loop = music.loop
    if (music.loop) {
      source.loopStart = startOffset
      source.loopEnd = buffer.duration
    }

    const gain = ctx.createGain()
    const targetVol = muted ? 0 : music.volume
    const now = ctx.currentTime
    const remainingVideo = Math.max(0.05, totalDuration - timelineTime)

    gain.gain.setValueAtTime(targetVol, now)

    // Apply fade-in if starting near the beginning
    if (music.fadeIn && timelineTime < 1.5 && !muted) {
      const fadeLeft = 1.5 - timelineTime
      const currentRatio = timelineTime / 1.5
      gain.gain.setValueAtTime(targetVol * currentRatio, now)
      gain.gain.linearRampToValueAtTime(targetVol, now + fadeLeft)
    }

    // Apply fade-out near the end of the video
    if (music.fadeOut && !muted) {
      const fadeDur = Math.min(2.5, totalDuration * 0.25)
      const fadeStartInVideo = totalDuration - fadeDur
      if (timelineTime >= fadeStartInVideo) {
        const ratio = Math.max(0, (totalDuration - timelineTime) / fadeDur)
        gain.gain.setValueAtTime(targetVol * ratio, now)
        gain.gain.linearRampToValueAtTime(0, now + remainingVideo)
      } else {
        const delayToFade = fadeStartInVideo - timelineTime
        gain.gain.setValueAtTime(targetVol, now + delayToFade)
        gain.gain.linearRampToValueAtTime(0, now + remainingVideo)
      }
    }

    source.connect(gain)
    gain.connect(ctx.destination)

    const offsetInTrack = music.loop
      ? startOffset + (timelineTime % playableTrackDuration)
      : startOffset + timelineTime

    source.start(now, offsetInTrack, remainingVideo)
    this.source = source
    this.gainNode = gain
  }

  setVolume(volume: number, muted: boolean) {
    if (this.gainNode) {
      const ctx = getAudioContext()
      this.gainNode.gain.setTargetAtTime(muted ? 0 : volume, ctx.currentTime, 0.03)
    }
  }
}

/**
 * Renders the final mixed stereo AudioBuffer for MP4/WebM export using OfflineAudioContext.
 */
export async function renderExportAudioBuffer(
  music: MusicConfig,
  totalDuration: number,
  sampleRate = 48000,
): Promise<AudioBuffer | null> {
  if (!music.audioBuffer || totalDuration <= 0) return null

  const totalFrames = Math.ceil(totalDuration * sampleRate)
  const offline = new OfflineAudioContext(2, totalFrames, sampleRate)

  const buffer = music.audioBuffer
  const startOffset = Math.min(music.startOffset, Math.max(0, buffer.duration - 0.1))

  const source = offline.createBufferSource()
  source.buffer = buffer
  source.loop = music.loop
  if (music.loop) {
    source.loopStart = startOffset
    source.loopEnd = buffer.duration
  }

  const gain = offline.createGain()
  const vol = Math.max(0, Math.min(1, music.volume))
  gain.gain.setValueAtTime(vol, 0)

  if (music.fadeIn) {
    const fadeInDur = Math.min(1.5, totalDuration * 0.25)
    gain.gain.setValueAtTime(0, 0)
    gain.gain.linearRampToValueAtTime(vol, fadeInDur)
  }

  if (music.fadeOut) {
    const fadeOutDur = Math.min(2.5, totalDuration * 0.25)
    const fadeOutStart = Math.max(0, totalDuration - fadeOutDur)
    gain.gain.setValueAtTime(vol, fadeOutStart)
    gain.gain.linearRampToValueAtTime(0, totalDuration)
  }

  source.connect(gain)
  gain.connect(offline.destination)

  const playLen = music.loop
    ? totalDuration
    : Math.min(totalDuration, Math.max(0.05, buffer.duration - startOffset))

  source.start(0, startOffset, playLen)
  return await offline.startRendering()
}
