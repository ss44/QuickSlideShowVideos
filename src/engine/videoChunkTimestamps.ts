export interface BufferedVideoChunk {
  data: Uint8Array
  type: 'key' | 'delta'
  presentationTimestampMicroseconds: number
  durationMicroseconds: number
  meta?: EncodedVideoChunkMetadata
}

export interface MuxableVideoChunkTiming {
  /**
   * Presentation timestamp (PTS) passed to the muxer in microseconds (guaranteed >= 0).
   * When B-frames are present, all presentation timestamps are uniformly shifted forward
   * by `reorderDelayMicroseconds` so every `compositionTimeOffsetMicroseconds` stays >= 0
   * as required by MP4 `ctts` version 0 (unsigned 32-bit offsets).
   */
  presentationTimestampMicroseconds: number
  /**
   * Monotonically non-decreasing decode timestamp (DTS) in microseconds (guaranteed >= 0).
   */
  decodeTimestampMicroseconds: number
  /**
   * Non-negative composition time offset (`PTS - DTS`) in microseconds for MP4 `ctts`.
   * Always `0` when the encoder already emits chunks in presentation order.
   */
  compositionTimeOffsetMicroseconds: number
}

export interface ResolvedVideoChunkSchedule {
  timings: MuxableVideoChunkTiming[]
  hasReorderedFrames: boolean
  reorderDelayMicroseconds: number
}

/**
 * Computes valid, monotonically non-decreasing decode timestamps (DTS) and non-negative
 * composition time offsets (CTS = PTS - DTS) for a decode-order sequence of encoded video chunks.
 *
 * Why this is needed:
 * WebCodecs `EncodedVideoChunk` exposes presentation time (`chunk.timestamp`) but does not
 * expose decode time (DTS). Even with `latencyMode: 'realtime'`, several H.264 High/Main
 * profile encoders still emit B-frames in decode order (e.g. I0, P4, B2, B1, B3), causing
 * raw `chunk.timestamp` values to move backward (such as 133333 -> 66667 at 30fps).
 *
 * Passing raw PTS as DTS causes `mp4-muxer` to throw a non-monotonic DTS error.
 * Reconstructing DTS from the sorted presentation timestamps and shifting PTS by the
 * maximum reorder delay preserves exact relative presentation timing while guaranteeing:
 *   1. `decodeTimestampMicroseconds` is non-negative and monotonically non-decreasing.
 *   2. `compositionTimeOffsetMicroseconds = PTS - DTS >= 0` (valid for MP4 `ctts` v0 `u32`).
 *   3. Zero overhead / zero shift when chunks are already monotonic (no B-frames).
 */
export function resolveVideoChunkSchedule(
  chunks: readonly Pick<BufferedVideoChunk, 'presentationTimestampMicroseconds'>[],
): ResolvedVideoChunkSchedule {
  if (chunks.length === 0) {
    return {
      timings: [],
      hasReorderedFrames: false,
      reorderDelayMicroseconds: 0,
    }
  }

  // Guard against encoders that emit negative initial timestamps by shifting the whole track up.
  let minPresentationTimestamp = chunks[0].presentationTimestampMicroseconds
  for (let index = 1; index < chunks.length; index++) {
    const pts = chunks[index].presentationTimestampMicroseconds
    if (pts < minPresentationTimestamp) {
      minPresentationTimestamp = pts
    }
  }
  const negativeBaseShiftMicroseconds = minPresentationTimestamp < 0 ? -minPresentationTimestamp : 0

  const normalizedPresentationTimestamps = new Array<number>(chunks.length)
  let hasReorderedFrames = false

  for (let index = 0; index < chunks.length; index++) {
    const normalizedPts =
      chunks[index].presentationTimestampMicroseconds + negativeBaseShiftMicroseconds
    normalizedPresentationTimestamps[index] = normalizedPts
    if (index > 0 && normalizedPts < normalizedPresentationTimestamps[index - 1]) {
      hasReorderedFrames = true
    }
  }

  // Fast path: encoder emitted frames in presentation order (no B-frame reordering).
  if (!hasReorderedFrames) {
    return {
      timings: normalizedPresentationTimestamps.map((timestampMicroseconds) => ({
        presentationTimestampMicroseconds: timestampMicroseconds,
        decodeTimestampMicroseconds: timestampMicroseconds,
        compositionTimeOffsetMicroseconds: 0,
      })),
      hasReorderedFrames: false,
      reorderDelayMicroseconds: 0,
    }
  }

  // In decode order, the sorted presentation timestamps form the unshifted monotonic DTS grid.
  const sortedDecodeTimestamps = [...normalizedPresentationTimestamps].sort((a, b) => a - b)

  // Find the deepest negative (PTS - DTS) offset across the stream; shifting all PTS forward
  // by this reorder delay guarantees every `ctts` entry is >= 0 without altering frame spacing.
  let minCompositionOffsetMicroseconds = 0
  for (let index = 0; index < chunks.length; index++) {
    const rawOffsetMicroseconds =
      normalizedPresentationTimestamps[index] - sortedDecodeTimestamps[index]
    if (rawOffsetMicroseconds < minCompositionOffsetMicroseconds) {
      minCompositionOffsetMicroseconds = rawOffsetMicroseconds
    }
  }

  const reorderDelayMicroseconds = -minCompositionOffsetMicroseconds
  const timings = new Array<MuxableVideoChunkTiming>(chunks.length)

  for (let index = 0; index < chunks.length; index++) {
    const decodeTimestampMicroseconds = sortedDecodeTimestamps[index]
    const presentationTimestampMicroseconds =
      normalizedPresentationTimestamps[index] + reorderDelayMicroseconds
    const compositionTimeOffsetMicroseconds =
      presentationTimestampMicroseconds - decodeTimestampMicroseconds

    timings[index] = {
      presentationTimestampMicroseconds,
      decodeTimestampMicroseconds,
      compositionTimeOffsetMicroseconds,
    }
  }

  return {
    timings,
    hasReorderedFrames: true,
    reorderDelayMicroseconds,
  }
}

/**
 * Creates a stateful timestamp normalizer for tracks without B-frame reordering (e.g. audio).
 * Shifts away negative encoder priming timestamps uniformly and clamps minor backward jitter
 * so container muxers always receive non-negative, monotonically non-decreasing timestamps.
 */
export function createMonotonicTimestampNormalizer(): (rawTimestampMicroseconds: number) => number {
  let baseShiftMicroseconds: number | null = null
  let lastTimestampMicroseconds: number | null = null

  return (rawTimestampMicroseconds: number): number => {
    const finiteTimestamp = Number.isFinite(rawTimestampMicroseconds) ? rawTimestampMicroseconds : 0

    if (baseShiftMicroseconds === null) {
      baseShiftMicroseconds = finiteTimestamp < 0 ? -finiteTimestamp : 0
    }

    const shiftedTimestamp = Math.max(0, finiteTimestamp + baseShiftMicroseconds)
    const monotonicTimestamp =
      lastTimestampMicroseconds === null
        ? shiftedTimestamp
        : Math.max(lastTimestampMicroseconds, shiftedTimestamp)

    lastTimestampMicroseconds = monotonicTimestamp
    return monotonicTimestamp
  }
}
