import type {
  ComputedTimeline,
  MusicConfig,
  OutputConfig,
  SlideImage,
  TimelineSlide,
  TimingConfig,
  TransitionType,
} from '../types/slideshow'

/**
 * Deterministic pseudo-random helper so preview and export pick identical transitions & Ken Burns directions.
 */
function seededRandom(seed: number): number {
  const x = Math.sin(seed * 9301 + 49297) * 233280
  return x - Math.floor(x)
}

export function computeTimeline(
  slides: SlideImage[],
  timing: TimingConfig,
  selectedTransitions: TransitionType[],
  transitionOrder: 'cycle' | 'random',
  music: MusicConfig,
  beatSyncEnabled: boolean,
): ComputedTimeline {
  if (slides.length === 0) {
    return {
      slides: [],
      totalDuration: 0,
      effectiveSlideDuration: timing.slideDuration,
      beatSnapped: false,
    }
  }

  const activeTransitions: TransitionType[] =
    selectedTransitions.length > 0 ? selectedTransitions : ['cut']

  // Determine base slide duration (either user-set or matched to music)
  let baseSlideDuration = Math.max(0.4, timing.slideDuration)
  const usableMusicDuration =
    music.audioBuffer && music.duration > 0
      ? Math.max(1, music.duration - music.startOffset)
      : 0

  if (timing.matchMusicLength && usableMusicDuration > 0) {
    baseSlideDuration = Math.max(0.4, usableMusicDuration / slides.length)
  }

  const requestedTransDur = Math.max(0, timing.transitionDuration)

  // Build cut points (start times)
  let startTimes: number[] = []
  let beatSnapped = false

  if (beatSyncEnabled && music.audioBuffer && music.beatTimes.length >= 2) {
    // Shift beat times relative to startOffset, and tile if music loops
    const rawBeats = music.beatTimes
      .map((t) => t - music.startOffset)
      .filter((t) => t > 0.15)

    const beats: number[] = []
    const trackLen = Math.max(1, music.duration - music.startOffset)
    const maxNeededTime = slides.length * baseSlideDuration * 2 + 10
    const loops = music.loop ? Math.ceil(maxNeededTime / trackLen) : 1

    for (let l = 0; l < loops; l++) {
      for (const b of rawBeats) {
        beats.push(b + l * trackLen)
      }
    }

    if (beats.length >= 2) {
      beatSnapped = true
      startTimes = [0]
      let cursor = 0
      let beatIdx = 0
      const minGap = Math.max(0.45, baseSlideDuration * 0.65)

      for (let i = 1; i < slides.length; i++) {
        const target = cursor + baseSlideDuration
        // Advance beatIdx to the first beat >= cursor + minGap
        while (beatIdx < beats.length && beats[beatIdx] < cursor + minGap) {
          beatIdx++
        }
        if (beatIdx < beats.length) {
          // Pick the beat closest to `target` without going below minGap
          let bestIdx = beatIdx
          while (
            bestIdx + 1 < beats.length &&
            Math.abs(beats[bestIdx + 1] - target) < Math.abs(beats[bestIdx] - target)
          ) {
            bestIdx++
          }
          // Only snap if within reasonable distance of target
          if (beats[bestIdx] - cursor <= baseSlideDuration * 1.85) {
            cursor = beats[bestIdx]
            beatIdx = bestIdx + 1
          } else {
            cursor = target
          }
        } else {
          cursor = target
        }
        startTimes.push(cursor)
      }
    }
  }

  if (startTimes.length === 0) {
    for (let i = 0; i < slides.length; i++) {
      startTimes.push(i * baseSlideDuration)
    }
  }

  const timelineSlides: TimelineSlide[] = []
  for (let i = 0; i < slides.length; i++) {
    const startTime = startTimes[i]
    const nextStart =
      i + 1 < slides.length ? startTimes[i + 1] : startTime + baseSlideDuration
    const duration = Math.max(0.3, nextStart - startTime)

    let transitionIn: TransitionType = 'cut'
    let transitionInDuration = 0

    if (i > 0) {
      if (transitionOrder === 'random') {
        const idx = Math.floor(seededRandom(i + 17) * activeTransitions.length)
        transitionIn = activeTransitions[idx]
      } else {
        transitionIn = activeTransitions[(i - 1) % activeTransitions.length]
      }
      if (transitionIn !== 'cut') {
        // Clamp transition to at most 45% of the shorter adjacent slide
        const prevDur = timelineSlides[i - 1].duration
        transitionInDuration = Math.min(requestedTransDur, duration * 0.45, prevDur * 0.45)
      }
    }

    timelineSlides.push({
      slideIndex: i,
      slideId: slides[i].id,
      startTime,
      endTime: startTime + duration,
      duration,
      transitionIn,
      transitionInDuration,
      kenBurnsSeed: i + 1,
    })
  }

  const totalDuration =
    timelineSlides.length > 0
      ? timelineSlides[timelineSlides.length - 1].endTime
      : 0

  return {
    slides: timelineSlides,
    totalDuration,
    effectiveSlideDuration: slides.length > 0 ? totalDuration / slides.length : baseSlideDuration,
    beatSnapped,
  }
}

export function getVideoBitrate(output: OutputConfig): number {
  const pixels = output.width * output.height
  const fpsFactor = output.fps === 60 ? 1.45 : 1
  const qualityFactor = output.quality === 'high' ? 1.5 : 1

  let base = 6_000_000 // 1080p standard ~6 Mbps
  if (pixels >= 3840 * 2160 * 0.9) {
    base = 18_000_000
  } else if (pixels <= 1280 * 720 * 1.1) {
    base = 3_500_000
  }

  return Math.round(base * fpsFactor * qualityFactor)
}

export function estimateFileSizeMB(
  durationSeconds: number,
  output: OutputConfig,
  hasAudio: boolean,
): number {
  if (durationSeconds <= 0) return 0
  const videoBitsPerSec = getVideoBitrate(output)
  const audioBitsPerSec = hasAudio ? 160_000 : 0
  // Real-world slideshow video compresses better than max bitrate (~65% average)
  const totalBytes = ((videoBitsPerSec * 0.65 + audioBitsPerSec) * durationSeconds) / 8
  return totalBytes / (1024 * 1024)
}

export function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00'
  const total = Math.floor(seconds)
  const hrs = Math.floor(total / 3600)
  const mins = Math.floor((total % 3600) / 60)
  const secs = total % 60
  if (hrs > 0) {
    return `${hrs}:${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`
  }
  return `${mins}:${String(secs).padStart(2, '0')}`
}

export function formatTimeDetailed(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00.0'
  const mins = Math.floor(seconds / 60)
  const secs = seconds % 60
  return `${mins}:${secs < 10 ? '0' : ''}${secs.toFixed(1)}`
}
