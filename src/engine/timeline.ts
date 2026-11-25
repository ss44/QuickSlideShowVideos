import type {
  ComputedTimeline,
  MusicConfig,
  OutputConfig,
  SlideImage,
  TimelineSlide,
  TimingConfig,
  TransitionOrderMode,
  TransitionType,
} from '../types/slideshow'
export {
  formatBytesToMB,
  formatEstimatedSizeMB,
  formatTime,
  formatTimeDetailed,
} from '../utils/formatters'

const MIN_SLIDE_DURATION_SECONDS = 0.4
const MIN_TIMELINE_SEGMENT_SECONDS = 0.3
/**
 * Maximum fraction of a slide's duration that a single incoming transition may occupy.
 * Capping at 45% ensures the incoming and outgoing transitions of a slide never overlap.
 */
const MAX_TRANSITION_FRACTION_OF_SLIDE = 0.45

/**
 * Beat-snapping tolerance window relative to the target slide duration.
 * Prevents beat sync from picking beats that cut faster than 65% or slower than 185% of the user's speed.
 */
const BEAT_SNAP_MIN_DURATION_RATIO = 0.65
const BEAT_SNAP_MAX_DURATION_RATIO = 1.85

/**
 * Deterministic pseudo-random generator returning a float in `[0, 1)`.
 * Using a pure function of the slide index ensures that "Random" transition order
 * produces the exact same sequence during live preview scrubbing and final video export.
 */
function seededUnitRandom(seed: number): number {
  const sineHash = Math.sin(seed * 9301 + 49297) * 233280
  return sineHash - Math.floor(sineHash)
}

/**
 * Resolves the target duration per slide, either from the user's manual slider
 * or by dividing the playable music length evenly across all slides.
 */
function resolveBaseSlideDurationSeconds(
  slideCount: number,
  timing: TimingConfig,
  music: MusicConfig,
): number {
  const manualDurationSeconds = Math.max(MIN_SLIDE_DURATION_SECONDS, timing.slideDuration)
  const hasLoadedAudio = Boolean(music.audioBuffer && music.duration > 0)
  if (!timing.matchMusicLength || !hasLoadedAudio || slideCount === 0) {
    return manualDurationSeconds
  }

  const playableMusicDurationSeconds = Math.max(1, music.duration - music.startOffset)
  return Math.max(MIN_SLIDE_DURATION_SECONDS, playableMusicDurationSeconds / slideCount)
}

/**
 * Shifts raw track beat timestamps by `music.startOffset` and tiles them across
 * multiple loop iterations when `music.loop` is enabled.
 */
function expandBeatTimestampsAcrossTimeline(
  music: MusicConfig,
  maxNeededTimelineSeconds: number,
): number[] {
  const offsetShiftedBeats = music.beatTimes
    .map((beatTimeSeconds) => beatTimeSeconds - music.startOffset)
    .filter((beatTimeSeconds) => beatTimeSeconds > 0.15)

  const playableLoopDurationSeconds = Math.max(1, music.duration - music.startOffset)
  const loopCount = music.loop
    ? Math.ceil(maxNeededTimelineSeconds / playableLoopDurationSeconds)
    : 1

  const expandedBeats: number[] = []
  for (let loopIndex = 0; loopIndex < loopCount; loopIndex++) {
    const loopTimeOffset = loopIndex * playableLoopDurationSeconds
    for (const beatTime of offsetShiftedBeats) {
      expandedBeats.push(beatTime + loopTimeOffset)
    }
  }
  return expandedBeats
}

/**
 * Attempts to snap each slide transition start time to the nearest detected musical beat
 * within `[0.65x, 1.85x]` of `baseSlideDurationSeconds`.
 */
function computeBeatSnappedStartTimes(
  slideCount: number,
  baseSlideDurationSeconds: number,
  music: MusicConfig,
): number[] | null {
  if (!music.audioBuffer || music.beatTimes.length < 2) {
    return null
  }

  const estimatedHorizonSeconds = slideCount * baseSlideDurationSeconds * 2 + 10
  const candidateBeats = expandBeatTimestampsAcrossTimeline(music, estimatedHorizonSeconds)
  if (candidateBeats.length < 2) {
    return null
  }

  const startTimes: number[] = [0]
  let currentCutTimeSeconds = 0
  let beatSearchCursor = 0
  const minAllowedGapSeconds = Math.max(
    0.45,
    baseSlideDurationSeconds * BEAT_SNAP_MIN_DURATION_RATIO,
  )
  const maxAllowedGapSeconds = baseSlideDurationSeconds * BEAT_SNAP_MAX_DURATION_RATIO

  for (let slideIndex = 1; slideIndex < slideCount; slideIndex++) {
    const idealNextCutSeconds = currentCutTimeSeconds + baseSlideDurationSeconds

    // Advance cursor past beats that would make the current slide too short
    while (
      beatSearchCursor < candidateBeats.length &&
      candidateBeats[beatSearchCursor] < currentCutTimeSeconds + minAllowedGapSeconds
    ) {
      beatSearchCursor++
    }

    if (beatSearchCursor < candidateBeats.length) {
      // Find the beat closest to idealNextCutSeconds
      let closestBeatIndex = beatSearchCursor
      while (
        closestBeatIndex + 1 < candidateBeats.length &&
        Math.abs(candidateBeats[closestBeatIndex + 1] - idealNextCutSeconds) <
          Math.abs(candidateBeats[closestBeatIndex] - idealNextCutSeconds)
      ) {
        closestBeatIndex++
      }

      const gapToCandidateBeat = candidateBeats[closestBeatIndex] - currentCutTimeSeconds
      if (gapToCandidateBeat <= maxAllowedGapSeconds) {
        currentCutTimeSeconds = candidateBeats[closestBeatIndex]
        beatSearchCursor = closestBeatIndex + 1
      } else {
        currentCutTimeSeconds = idealNextCutSeconds
      }
    } else {
      currentCutTimeSeconds = idealNextCutSeconds
    }

    startTimes.push(currentCutTimeSeconds)
  }

  return startTimes
}

function computeUniformStartTimes(slideCount: number, baseSlideDurationSeconds: number): number[] {
  const startTimes: number[] = []
  for (let slideIndex = 0; slideIndex < slideCount; slideIndex++) {
    startTimes.push(slideIndex * baseSlideDurationSeconds)
  }
  return startTimes
}

function selectTransitionForSlide(
  slideIndex: number,
  activeTransitions: TransitionType[],
  transitionOrder: TransitionOrderMode,
): TransitionType {
  if (slideIndex === 0) return 'cut'
  if (transitionOrder === 'random') {
    const randomIndex = Math.floor(seededUnitRandom(slideIndex + 17) * activeTransitions.length)
    return activeTransitions[randomIndex]
  }
  return activeTransitions[(slideIndex - 1) % activeTransitions.length]
}

/**
 * Computes the complete, deterministic slide timeline from user settings.
 */
export function computeTimeline(
  slides: SlideImage[],
  timing: TimingConfig,
  selectedTransitions: TransitionType[],
  transitionOrder: TransitionOrderMode,
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
  const baseSlideDurationSeconds = resolveBaseSlideDurationSeconds(slides.length, timing, music)
  const requestedTransitionDurationSeconds = Math.max(0, timing.transitionDuration)

  const beatSnappedStartTimes = beatSyncEnabled
    ? computeBeatSnappedStartTimes(slides.length, baseSlideDurationSeconds, music)
    : null

  const slideStartTimes =
    beatSnappedStartTimes ?? computeUniformStartTimes(slides.length, baseSlideDurationSeconds)
  const isBeatSnapped = beatSnappedStartTimes !== null

  const timelineSlides: TimelineSlide[] = []
  for (let index = 0; index < slides.length; index++) {
    const startTime = slideStartTimes[index]
    const nextStartTime =
      index + 1 < slides.length
        ? slideStartTimes[index + 1]
        : startTime + baseSlideDurationSeconds
    const slideDuration = Math.max(MIN_TIMELINE_SEGMENT_SECONDS, nextStartTime - startTime)

    const transitionIn = selectTransitionForSlide(index, activeTransitions, transitionOrder)
    let transitionInDuration = 0

    if (index > 0 && transitionIn !== 'cut') {
      const previousSlideDuration = timelineSlides[index - 1].duration
      transitionInDuration = Math.min(
        requestedTransitionDurationSeconds,
        slideDuration * MAX_TRANSITION_FRACTION_OF_SLIDE,
        previousSlideDuration * MAX_TRANSITION_FRACTION_OF_SLIDE,
      )
    }

    timelineSlides.push({
      slideIndex: index,
      slideId: slides[index].id,
      startTime,
      endTime: startTime + slideDuration,
      duration: slideDuration,
      transitionIn,
      transitionInDuration,
      kenBurnsSeed: index + 1,
    })
  }

  const totalDuration =
    timelineSlides.length > 0 ? timelineSlides[timelineSlides.length - 1].endTime : 0

  return {
    slides: timelineSlides,
    totalDuration,
    effectiveSlideDuration: totalDuration / slides.length,
    beatSnapped: isBeatSnapped,
  }
}

/**
 * Finds the active slide index at `timeSeconds` in O(log N) time via binary search.
 * Centralized here so reactive UI state, canvas preview, and video export share identical lookup logic.
 */
export function findSlideIndexAtTime(timeline: ComputedTimeline, timeSeconds: number): number {
  const timelineSlides = timeline.slides
  if (timelineSlides.length === 0) return -1
  if (timeSeconds <= 0) return 0
  if (timeSeconds >= timeline.totalDuration) return timelineSlides.length - 1

  let lowIndex = 0
  let highIndex = timelineSlides.length - 1
  while (lowIndex <= highIndex) {
    const midIndex = (lowIndex + highIndex) >> 1
    const candidateSlide = timelineSlides[midIndex]
    if (timeSeconds < candidateSlide.startTime) {
      highIndex = midIndex - 1
    } else if (timeSeconds >= candidateSlide.endTime) {
      lowIndex = midIndex + 1
    } else {
      return midIndex
    }
  }
  return Math.min(timelineSlides.length - 1, Math.max(0, lowIndex))
}

/**
 * Calculates target video encoder bitrate (bits per second) scaled by resolution, frame rate, and quality tier.
 */
export function getVideoBitrate(output: OutputConfig): number {
  const pixelCount = output.width * output.height
  const frameRateMultiplier = output.fps === 60 ? 1.45 : 1.0
  const qualityTierMultiplier = output.quality === 'high' ? 1.5 : 1.0

  const is4kOrAbove = pixelCount >= 3840 * 2160 * 0.9
  const is720pOrBelow = pixelCount <= 1280 * 720 * 1.1

  let baseBitrateBps = 6_000_000 // 1080p standard baseline (~6 Mbps)
  if (is4kOrAbove) {
    baseBitrateBps = 18_000_000
  } else if (is720pOrBelow) {
    baseBitrateBps = 3_500_000
  }

  return Math.round(baseBitrateBps * frameRateMultiplier * qualityTierMultiplier)
}

/**
 * Estimates output video file size in megabytes.
 * Slideshows with still images and smooth motion typically compress to ~65% of peak target bitrate.
 */
export function estimateFileSizeMB(
  durationSeconds: number,
  output: OutputConfig,
  hasAudioTrack: boolean,
): number {
  if (durationSeconds <= 0) return 0
  const peakVideoBitsPerSecond = getVideoBitrate(output)
  const averageSlideshowCompressionRatio = 0.65
  const audioBitsPerSecond = hasAudioTrack ? 160_000 : 0

  const estimatedTotalBytes =
    ((peakVideoBitsPerSecond * averageSlideshowCompressionRatio + audioBitsPerSecond) *
      durationSeconds) /
    8
  return estimatedTotalBytes / (1024 * 1024)
}
