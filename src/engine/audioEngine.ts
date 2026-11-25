import type { MusicConfig } from '../types/slideshow'

const FADE_IN_MAX_DURATION_SECONDS = 1.5
const FADE_OUT_MAX_DURATION_SECONDS = 2.5
const FADE_MAX_SHARE_OF_TOTAL_VIDEO = 0.25

/**
 * Signal processing constants for client-side energy-flux beat detection.
 */
const BEAT_WINDOW_DURATION_SECONDS = 0.023 // ~23ms window (~1024 samples @ 44.1kHz)
const BEAT_LOCAL_THRESHOLD_HALF_WINDOW_SECONDS = 0.5 // +/-0.5s (1.0s local moving average)
const BEAT_MIN_INTERVAL_SECONDS = 0.28 // Refractory period (~214 BPM ceiling)
const BEAT_THRESHOLD_MULTIPLIER = 1.65 // Peak must exceed local mean onset flux by 65%
const BEAT_MIN_FLUX_FLOOR = 0.005 // Ignore silent/near-silent passages

let sharedAudioContext: AudioContext | null = null

export function getAudioContext(): AudioContext {
  if (!sharedAudioContext) {
    sharedAudioContext = new AudioContext()
  }
  return sharedAudioContext
}

export async function decodeAudioFromFile(file: Blob): Promise<AudioBuffer> {
  const rawBuffer = await file.arrayBuffer()
  const audioContext = getAudioContext()
  return await audioContext.decodeAudioData(rawBuffer.slice(0))
}

export async function fetchAndDecodeAudioFromUrl(
  url: string,
): Promise<{ buffer: AudioBuffer; audioBlob: Blob }> {
  let response: Response
  try {
    response = await fetch(url, { mode: 'cors' })
  } catch {
    throw new Error(
      'Could not load this URL directly in the browser (blocked by CORS or network error). Download the MP3 and upload it directly, or use a CORS-enabled direct audio link.',
    )
  }

  if (!response.ok) {
    throw new Error(
      `Audio link returned HTTP ${response.status}. Make sure it points directly to an MP3/WAV/OGG file.`,
    )
  }

  const contentType = response.headers.get('content-type') || ''
  if (contentType.includes('text/html')) {
    throw new Error(
      'This link points to a webpage rather than a direct audio file (e.g. .mp3 / .wav). Upload an MP3 file or paste a direct audio URL.',
    )
  }

  const rawBuffer = await response.arrayBuffer()
  // Retain a Blob copy before decodeAudioData detaches the ArrayBuffer so saved projects work offline
  const audioBlob = new Blob([rawBuffer], { type: contentType || 'audio/mpeg' })
  const audioContext = getAudioContext()
  try {
    const buffer = await audioContext.decodeAudioData(rawBuffer.slice(0))
    return { buffer, audioBlob }
  } catch {
    throw new Error(
      'Could not decode audio from this URL. Ensure it is a valid MP3, WAV, M4A, or OGG file.',
    )
  }
}

export async function decodeAudioFromUrl(url: string): Promise<AudioBuffer> {
  const { buffer } = await fetchAndDecodeAudioFromUrl(url)
  return buffer
}

/**
 * Downmixes a multi-channel `AudioBuffer` into a single mono `Float32Array` for analysis.
 */
function downmixToMono(buffer: AudioBuffer): Float32Array {
  const sampleCount = buffer.length
  const channelCount = buffer.numberOfChannels
  const monoSamples = new Float32Array(sampleCount)

  for (let channelIndex = 0; channelIndex < channelCount; channelIndex++) {
    const channelData = buffer.getChannelData(channelIndex)
    for (let sampleIndex = 0; sampleIndex < sampleCount; sampleIndex++) {
      monoSamples[sampleIndex] += channelData[sampleIndex] / channelCount
    }
  }
  return monoSamples
}

/**
 * Computes Root-Mean-Square (RMS) loudness across non-overlapping ~23ms windows.
 */
function computeWindowedRmsEnergy(monoSamples: Float32Array, hopSizeSamples: number): Float32Array {
  const windowCount = Math.floor(monoSamples.length / hopSizeSamples)
  const rmsEnergies = new Float32Array(windowCount)

  for (let windowIndex = 0; windowIndex < windowCount; windowIndex++) {
    let sumOfSquares = 0
    const startSample = windowIndex * hopSizeSamples
    const endSample = Math.min(startSample + hopSizeSamples, monoSamples.length)
    for (let sampleIndex = startSample; sampleIndex < endSample; sampleIndex++) {
      const sample = monoSamples[sampleIndex]
      sumOfSquares += sample * sample
    }
    rmsEnergies[windowIndex] = Math.sqrt(sumOfSquares / (endSample - startSample))
  }
  return rmsEnergies
}

/**
 * Computes half-wave rectified energy flux (positive first-difference of RMS energy).
 * Positive energy spikes correspond to percussive note onsets (drum hits, chord attacks)
 * while ignoring energy decays.
 */
function computePositiveEnergyFlux(rmsEnergies: Float32Array): Float32Array {
  const energyFlux = new Float32Array(rmsEnergies.length)
  for (let windowIndex = 1; windowIndex < rmsEnergies.length; windowIndex++) {
    energyFlux[windowIndex] = Math.max(0, rmsEnergies[windowIndex] - rmsEnergies[windowIndex - 1])
  }
  return energyFlux
}

/**
 * Lightweight client-side beat/onset detector using short-time positive energy flux.
 * Runs in <100ms for a typical 3-5 minute song.
 */
export function detectBeats(buffer: AudioBuffer): number[] {
  const sampleRateHz = buffer.sampleRate
  const hopSizeSamples = Math.max(512, Math.round(sampleRateHz * BEAT_WINDOW_DURATION_SECONDS))
  const windowDurationSeconds = hopSizeSamples / sampleRateHz

  const monoSamples = downmixToMono(buffer)
  const rmsEnergies = computeWindowedRmsEnergy(monoSamples, hopSizeSamples)
  if (rmsEnergies.length < 10) return []

  const energyFlux = computePositiveEnergyFlux(rmsEnergies)
  const windowCount = energyFlux.length

  const thresholdHalfWindowFrames = Math.max(
    8,
    Math.round(BEAT_LOCAL_THRESHOLD_HALF_WINDOW_SECONDS / windowDurationSeconds),
  )
  const minPeakIntervalFrames = Math.max(
    6,
    Math.round(BEAT_MIN_INTERVAL_SECONDS / windowDurationSeconds),
  )

  const detectedBeatTimesSeconds: number[] = []
  let lastBeatWindowIndex = -minPeakIntervalFrames

  for (let windowIndex = 2; windowIndex < windowCount - 2; windowIndex++) {
    const currentFlux = energyFlux[windowIndex]
    if (currentFlux <= BEAT_MIN_FLUX_FLOOR) continue

    // Require a local peak relative to immediate neighbors
    const isLocalMaximum =
      currentFlux >= energyFlux[windowIndex - 1] && currentFlux >= energyFlux[windowIndex + 1]
    if (!isLocalMaximum) continue

    // Compare against local moving average (~1s window) to adapt to quiet vs loud sections
    const localStart = Math.max(0, windowIndex - thresholdHalfWindowFrames)
    const localEnd = Math.min(windowCount - 1, windowIndex + thresholdHalfWindowFrames)
    let localFluxSum = 0
    for (let neighborIndex = localStart; neighborIndex <= localEnd; neighborIndex++) {
      localFluxSum += energyFlux[neighborIndex]
    }
    const localFluxMean = localFluxSum / (localEnd - localStart + 1)

    const exceedsAdaptiveThreshold = currentFlux > localFluxMean * BEAT_THRESHOLD_MULTIPLIER
    const respectsRefractoryGap = windowIndex - lastBeatWindowIndex >= minPeakIntervalFrames

    if (exceedsAdaptiveThreshold && respectsRefractoryGap) {
      detectedBeatTimesSeconds.push(windowIndex * windowDurationSeconds)
      lastBeatWindowIndex = windowIndex
    }
  }

  return detectedBeatTimesSeconds
}

/**
 * Computes safe start offset and remaining playable duration within an `AudioBuffer`.
 */
function computePlayableTrackBounds(buffer: AudioBuffer, requestedStartOffsetSeconds: number) {
  const clampedStartOffsetSeconds = Math.min(
    Math.max(0, requestedStartOffsetSeconds),
    Math.max(0, buffer.duration - 0.1),
  )
  const playableTrackDurationSeconds = Math.max(0.1, buffer.duration - clampedStartOffsetSeconds)
  return { clampedStartOffsetSeconds, playableTrackDurationSeconds }
}

/**
 * Configures an `AudioBufferSourceNode` with consistent loop boundaries so looped tracks
 * wrap back to `clampedStartOffsetSeconds` rather than `0:00`.
 */
function configureLoopingAudioSource(
  sourceNode: AudioBufferSourceNode,
  buffer: AudioBuffer,
  clampedStartOffsetSeconds: number,
  shouldLoop: boolean,
) {
  sourceNode.buffer = buffer
  sourceNode.loop = shouldLoop
  if (shouldLoop) {
    sourceNode.loopStart = clampedStartOffsetSeconds
    sourceNode.loopEnd = buffer.duration
  }
}

/**
 * Schedules fade-in and fade-out gain ramps on an `AudioParam`.
 * Shared between live preview (`PreviewAudioPlayer`) and offline export (`renderExportAudioBuffer`)
 * so both produce identical volume envelopes, even when preview playback starts mid-timeline.
 */
function scheduleAudioFadeEnvelope(
  gainParam: AudioParam,
  params: {
    targetVolume: number
    timelineStartTimeSeconds: number
    totalVideoDurationSeconds: number
    audioContextStartTime: number
    fadeInEnabled: boolean
    fadeOutEnabled: boolean
  },
) {
  const {
    targetVolume,
    timelineStartTimeSeconds,
    totalVideoDurationSeconds,
    audioContextStartTime,
    fadeInEnabled,
    fadeOutEnabled,
  } = params

  const remainingVideoSeconds = Math.max(0.05, totalVideoDurationSeconds - timelineStartTimeSeconds)
  gainParam.setValueAtTime(targetVolume, audioContextStartTime)

  if (targetVolume <= 0) return

  const fadeInDurationSeconds = Math.min(
    FADE_IN_MAX_DURATION_SECONDS,
    totalVideoDurationSeconds * FADE_MAX_SHARE_OF_TOTAL_VIDEO,
  )
  if (fadeInEnabled && fadeInDurationSeconds > 0 && timelineStartTimeSeconds < fadeInDurationSeconds) {
    const remainingFadeInSeconds = fadeInDurationSeconds - timelineStartTimeSeconds
    const initialFadeRatio = timelineStartTimeSeconds / fadeInDurationSeconds
    gainParam.setValueAtTime(targetVolume * initialFadeRatio, audioContextStartTime)
    gainParam.linearRampToValueAtTime(
      targetVolume,
      audioContextStartTime + remainingFadeInSeconds,
    )
  }

  const fadeOutDurationSeconds = Math.min(
    FADE_OUT_MAX_DURATION_SECONDS,
    totalVideoDurationSeconds * FADE_MAX_SHARE_OF_TOTAL_VIDEO,
  )
  if (fadeOutEnabled && fadeOutDurationSeconds > 0) {
    const fadeOutStartInVideoSeconds = Math.max(
      0,
      totalVideoDurationSeconds - fadeOutDurationSeconds,
    )
    if (timelineStartTimeSeconds >= fadeOutStartInVideoSeconds) {
      const currentFadeOutRatio = Math.max(
        0,
        (totalVideoDurationSeconds - timelineStartTimeSeconds) / fadeOutDurationSeconds,
      )
      gainParam.setValueAtTime(targetVolume * currentFadeOutRatio, audioContextStartTime)
      gainParam.linearRampToValueAtTime(0, audioContextStartTime + remainingVideoSeconds)
    } else {
      const delayUntilFadeOutSeconds = fadeOutStartInVideoSeconds - timelineStartTimeSeconds
      gainParam.setValueAtTime(targetVolume, audioContextStartTime + delayUntilFadeOutSeconds)
      gainParam.linearRampToValueAtTime(0, audioContextStartTime + remainingVideoSeconds)
    }
  }
}

/**
 * Synchronized Web Audio preview player that handles start offset, looping, volume, and fade-in/out.
 */
export class PreviewAudioPlayer {
  private activeSourceNode: AudioBufferSourceNode | null = null
  private activeGainNode: GainNode | null = null

  stop() {
    if (this.activeSourceNode) {
      try {
        this.activeSourceNode.stop()
      } catch {
        // Ignore if source already completed naturally
      }
      this.activeSourceNode.disconnect()
      this.activeSourceNode = null
    }
    if (this.activeGainNode) {
      this.activeGainNode.disconnect()
      this.activeGainNode = null
    }
  }

  start(
    music: MusicConfig,
    timelineTimeSeconds: number,
    totalVideoDurationSeconds: number,
    isMuted: boolean,
  ) {
    this.stop()
    if (!music.audioBuffer || totalVideoDurationSeconds <= 0) return

    const audioContext = getAudioContext()
    if (audioContext.state === 'suspended') {
      void audioContext.resume()
    }

    const buffer = music.audioBuffer
    const { clampedStartOffsetSeconds, playableTrackDurationSeconds } =
      computePlayableTrackBounds(buffer, music.startOffset)

    if (!music.loop && timelineTimeSeconds >= playableTrackDurationSeconds) {
      return
    }

    const sourceNode = audioContext.createBufferSource()
    configureLoopingAudioSource(sourceNode, buffer, clampedStartOffsetSeconds, music.loop)

    const gainNode = audioContext.createGain()
    const targetVolume = isMuted ? 0 : Math.max(0, Math.min(1, music.volume))
    const audioContextNow = audioContext.currentTime

    scheduleAudioFadeEnvelope(gainNode.gain, {
      targetVolume,
      timelineStartTimeSeconds: timelineTimeSeconds,
      totalVideoDurationSeconds,
      audioContextStartTime: audioContextNow,
      fadeInEnabled: music.fadeIn,
      fadeOutEnabled: music.fadeOut,
    })

    sourceNode.connect(gainNode)
    gainNode.connect(audioContext.destination)

    const trackPlaybackOffsetSeconds = music.loop
      ? clampedStartOffsetSeconds + (timelineTimeSeconds % playableTrackDurationSeconds)
      : clampedStartOffsetSeconds + timelineTimeSeconds
    const remainingVideoSeconds = Math.max(0.05, totalVideoDurationSeconds - timelineTimeSeconds)

    sourceNode.start(audioContextNow, trackPlaybackOffsetSeconds, remainingVideoSeconds)
    this.activeSourceNode = sourceNode
    this.activeGainNode = gainNode
  }

  setVolume(volume: number, isMuted: boolean) {
    if (this.activeGainNode) {
      const audioContext = getAudioContext()
      const targetVolume = isMuted ? 0 : Math.max(0, Math.min(1, volume))
      this.activeGainNode.gain.setTargetAtTime(targetVolume, audioContext.currentTime, 0.03)
    }
  }
}

/**
 * Renders the final mixed stereo `AudioBuffer` for MP4/WebM export using `OfflineAudioContext`.
 */
export async function renderExportAudioBuffer(
  music: MusicConfig,
  totalVideoDurationSeconds: number,
  sampleRateHz = 48000,
): Promise<AudioBuffer | null> {
  if (!music.audioBuffer || totalVideoDurationSeconds <= 0) return null

  const totalSampleFrames = Math.ceil(totalVideoDurationSeconds * sampleRateHz)
  const offlineContext = new OfflineAudioContext(2, totalSampleFrames, sampleRateHz)

  const buffer = music.audioBuffer
  const { clampedStartOffsetSeconds, playableTrackDurationSeconds } =
    computePlayableTrackBounds(buffer, music.startOffset)

  const sourceNode = offlineContext.createBufferSource()
  configureLoopingAudioSource(sourceNode, buffer, clampedStartOffsetSeconds, music.loop)

  const gainNode = offlineContext.createGain()
  const targetVolume = Math.max(0, Math.min(1, music.volume))

  scheduleAudioFadeEnvelope(gainNode.gain, {
    targetVolume,
    timelineStartTimeSeconds: 0,
    totalVideoDurationSeconds,
    audioContextStartTime: 0,
    fadeInEnabled: music.fadeIn,
    fadeOutEnabled: music.fadeOut,
  })

  sourceNode.connect(gainNode)
  gainNode.connect(offlineContext.destination)

  const playbackDurationSeconds = music.loop
    ? totalVideoDurationSeconds
    : Math.min(totalVideoDurationSeconds, playableTrackDurationSeconds)

  sourceNode.start(0, clampedStartOffsetSeconds, playbackDurationSeconds)
  return await offlineContext.startRendering()
}
