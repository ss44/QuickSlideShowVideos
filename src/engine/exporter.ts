import { createRenderCanvas, getRenderContext } from './renderCanvas'
import { Muxer as Mp4Muxer, ArrayBufferTarget as Mp4Target } from 'mp4-muxer'
import { Muxer as WebmMuxer, ArrayBufferTarget as WebmTarget } from 'webm-muxer'
import type {
  ComputedTimeline,
  ExportProgress,
  MusicConfig,
  OutputConfig,
  OutputFormat,
  SlideImage,
  SmartEffectsConfig,
} from '../types/slideshow'
import { BitmapCache } from './imageCache'
import { SlideshowRenderer } from './renderer'
import { getVideoBitrate } from './timeline'
import { renderExportAudioBuffer } from './audioEngine'
import {
  createMonotonicTimestampNormalizer,
  resolveVideoChunkSchedule,
  type BufferedVideoChunk,
} from './videoChunkTimestamps'

const EXPORT_AUDIO_SAMPLE_RATE_HZ = 48000
const EXPORT_AUDIO_BITRATE_BPS = 160_000
const AUDIO_CHUNK_FRAME_COUNT = 4096
const MAX_AUDIO_ENCODE_QUEUE_SIZE = 16
const MAX_VIDEO_ENCODE_QUEUE_SIZE = 12
const PROGRESS_REPORT_INTERVAL_MS = 120

export interface VideoCodecSelection {
  webCodecsCodec: string
  muxerCodec: 'avc' | 'V_VP9' | 'V_VP8'
}

interface AudioCodecSelection {
  webCodecsCodec: string
  muxerCodec: 'aac' | 'opus' | 'A_OPUS'
}

/**
 * Container-agnostic muxer abstraction (Dependency Inversion Principle).
 * Decouples the WebCodecs audio/video encoding loops from container-specific (`Mp4Muxer` vs `WebmMuxer`) APIs.
 */
interface MediaContainerMuxer {
  addVideoChunkRaw(params: {
    data: Uint8Array
    type: 'key' | 'delta'
    presentationTimestampMicroseconds: number
    decodeTimestampMicroseconds: number
    durationMicroseconds: number
    compositionTimeOffsetMicroseconds: number
    meta?: EncodedVideoChunkMetadata
  }): void
  addAudioChunk(
    chunk: EncodedAudioChunk,
    meta: EncodedAudioChunkMetadata | undefined,
    timestampMicroseconds: number,
  ): void
  finalizeToBlob(): Blob
}

export function isWebCodecsSupported(): boolean {
  return typeof VideoEncoder !== 'undefined' && typeof VideoFrame !== 'undefined'
}

function yieldToMainThread(delayMs = 0): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, delayMs))
}

/**
 * Probes `VideoEncoder.isConfigSupported()` to pick the highest-quality supported codec profile.
 * Requests `latencyMode: 'realtime'` to minimize B-frame reordering when the encoder supports it;
 * if an encoder still emits B-frames in decode order, `resolveVideoChunkSchedule()` reconstructs
 * monotonic DTS and MP4 `ctts` composition offsets during muxing.
 */
async function selectSupportedVideoCodec(
  format: OutputFormat,
  width: number,
  height: number,
  fps: number,
  bitrate: number,
): Promise<VideoCodecSelection> {
  const candidates: VideoCodecSelection[] =
    format === 'mp4'
      ? [
          { webCodecsCodec: 'avc1.640033', muxerCodec: 'avc' }, // H.264 High Profile L5.1 (4K)
          { webCodecsCodec: 'avc1.640028', muxerCodec: 'avc' }, // H.264 High Profile L4.0 (1080p)
          { webCodecsCodec: 'avc1.4d0028', muxerCodec: 'avc' }, // H.264 Main Profile L4.0
          { webCodecsCodec: 'avc1.42001f', muxerCodec: 'avc' }, // H.264 Baseline Profile L3.1
        ]
      : [
          { webCodecsCodec: 'vp09.00.10.08', muxerCodec: 'V_VP9' },
          { webCodecsCodec: 'vp8', muxerCodec: 'V_VP8' },
        ]

  for (const candidate of candidates) {
    try {
      const support = await VideoEncoder.isConfigSupported({
        codec: candidate.webCodecsCodec,
        width,
        height,
        bitrate,
        framerate: fps,
        latencyMode: 'realtime',
      })
      if (support.supported) {
        return candidate
      }
    } catch {
      // Probe next candidate profile
    }
  }

  throw new Error(
    `Your browser does not support ${format.toUpperCase()} hardware/WebCodecs encoding at ${width}×${height}. Try Chrome, Edge, or Safari, or lower the resolution.`,
  )
}

/**
 * Probes `AudioEncoder.isConfigSupported()`.
 * For MP4, prefers AAC (`mp4a.40.2`) and gracefully falls back to Opus (`opus` in MP4 ISO BMFF)
 * on platforms like Linux Chromium that ship without a proprietary AAC encoder.
 */
async function selectSupportedAudioCodec(
  format: OutputFormat,
  sampleRateHz: number,
): Promise<AudioCodecSelection | null> {
  if (typeof AudioEncoder === 'undefined' || typeof AudioData === 'undefined') {
    return null
  }

  const candidates: AudioCodecSelection[] =
    format === 'mp4'
      ? [
          { webCodecsCodec: 'mp4a.40.2', muxerCodec: 'aac' },
          { webCodecsCodec: 'opus', muxerCodec: 'opus' },
        ]
      : [{ webCodecsCodec: 'opus', muxerCodec: 'A_OPUS' }]

  for (const candidate of candidates) {
    try {
      const support = await AudioEncoder.isConfigSupported({
        codec: candidate.webCodecsCodec,
        numberOfChannels: 2,
        sampleRate: sampleRateHz,
        bitrate: EXPORT_AUDIO_BITRATE_BPS,
      })
      if (support.supported) return candidate
    } catch {
      // Probe next candidate
    }
  }
  return null
}

/**
 * Factory creating a unified `MediaContainerMuxer` for either MP4 or WebM output.
 */
function createContainerMuxer(params: {
  format: OutputFormat
  width: number
  height: number
  fps: number
  videoCodec: VideoCodecSelection
  audioCodec: AudioCodecSelection | null
  hasAudioTrack: boolean
}): MediaContainerMuxer {
  const { format, width, height, fps, videoCodec, audioCodec, hasAudioTrack } = params

  if (format === 'mp4') {
    const target = new Mp4Target()
    const muxer = new Mp4Muxer({
      target,
      video: { codec: 'avc', width, height },
      audio:
        hasAudioTrack && audioCodec
          ? {
              codec: audioCodec.muxerCodec === 'opus' ? 'opus' : 'aac',
              numberOfChannels: 2,
              sampleRate: EXPORT_AUDIO_SAMPLE_RATE_HZ,
            }
          : undefined,
      fastStart: 'in-memory',
      firstTimestampBehavior: 'offset',
    })

    return {
      addVideoChunkRaw: ({
        data,
        type,
        presentationTimestampMicroseconds,
        durationMicroseconds,
        compositionTimeOffsetMicroseconds,
        meta,
      }) => {
        muxer.addVideoChunkRaw(
          data,
          type,
          presentationTimestampMicroseconds,
          durationMicroseconds,
          meta,
          compositionTimeOffsetMicroseconds,
        )
      },
      addAudioChunk: (chunk, meta, timestampMicroseconds) => {
        const audioData = new Uint8Array(chunk.byteLength)
        chunk.copyTo(audioData)
        muxer.addAudioChunkRaw(
          audioData,
          chunk.type,
          timestampMicroseconds,
          chunk.duration ?? 0,
          meta,
        )
      },
      finalizeToBlob: () => {
        muxer.finalize()
        return new Blob([target.buffer], { type: 'video/mp4' })
      },
    }
  }

  const target = new WebmTarget()
  const muxer = new WebmMuxer({
    target,
    video: {
      codec: videoCodec.muxerCodec === 'V_VP8' ? 'V_VP8' : 'V_VP9',
      width,
      height,
      frameRate: fps,
    },
    audio:
      hasAudioTrack && audioCodec
        ? {
            codec: 'A_OPUS',
            numberOfChannels: 2,
            sampleRate: EXPORT_AUDIO_SAMPLE_RATE_HZ,
          }
        : undefined,
    firstTimestampBehavior: 'offset',
  })

  return {
    addVideoChunkRaw: ({ data, type, decodeTimestampMicroseconds, meta }) => {
      // WebM does not use MP4 `ctts` boxes; passing the monotonic decode timestamp guarantees
      // chunks stay in decode order without failing `webm-muxer`'s monotonicity check.
      muxer.addVideoChunkRaw(data, type, decodeTimestampMicroseconds, meta)
    },
    addAudioChunk: (chunk, meta, timestampMicroseconds) =>
      muxer.addAudioChunk(chunk, meta, timestampMicroseconds),
    finalizeToBlob: () => {
      muxer.finalize()
      return new Blob([target.buffer], { type: 'video/webm' })
    },
  }
}

/**
 * Packs a slice of stereo `AudioBuffer` channels into WebCodecs `'f32-planar'` layout:
 * all left-channel samples occupy `[0 .. frameCount - 1]`, followed contiguously by
 * all right-channel samples in `[frameCount .. 2 * frameCount - 1]`.
 */
function packStereoChunkAsPlanarFloat32(
  leftChannel: Float32Array,
  rightChannel: Float32Array,
  sampleOffset: number,
  frameCount: number,
): Float32Array {
  const planarBuffer = new Float32Array(frameCount * 2)
  planarBuffer.set(leftChannel.subarray(sampleOffset, sampleOffset + frameCount), 0)
  planarBuffer.set(rightChannel.subarray(sampleOffset, sampleOffset + frameCount), frameCount)
  return planarBuffer
}

/**
 * Encodes a rendered stereo `AudioBuffer` into `containerMuxer` using WebCodecs `AudioEncoder`.
 */
async function encodeAudioTrackToMuxer(params: {
  renderedAudio: AudioBuffer
  audioCodec: AudioCodecSelection
  containerMuxer: MediaContainerMuxer
  signal: AbortSignal
}): Promise<void> {
  const { renderedAudio, audioCodec, containerMuxer, signal } = params
  let encoderError: Error | null = null
  const normalizeAudioTimestamp = createMonotonicTimestampNormalizer()

  const audioEncoder = new AudioEncoder({
    output: (chunk, meta) => {
      try {
        const normalizedTimestampMicroseconds = normalizeAudioTimestamp(chunk.timestamp)
        containerMuxer.addAudioChunk(chunk, meta, normalizedTimestampMicroseconds)
      } catch (err) {
        encoderError = err instanceof Error ? err : new Error(String(err))
      }
    },
    error: (err) => {
      encoderError = err instanceof Error ? err : new Error(String(err))
    },
  })

  audioEncoder.configure({
    codec: audioCodec.webCodecsCodec,
    numberOfChannels: 2,
    sampleRate: EXPORT_AUDIO_SAMPLE_RATE_HZ,
    bitrate: EXPORT_AUDIO_BITRATE_BPS,
  })

  const leftChannel = renderedAudio.getChannelData(0)
  const rightChannel =
    renderedAudio.numberOfChannels > 1 ? renderedAudio.getChannelData(1) : leftChannel
  const totalSamples = renderedAudio.length

  try {
    for (
      let sampleOffset = 0;
      sampleOffset < totalSamples;
      sampleOffset += AUDIO_CHUNK_FRAME_COUNT
    ) {
      if (signal.aborted) {
        throw new DOMException('Cancelled', 'AbortError')
      }
      if (encoderError) {
        throw encoderError
      }

      const frameCount = Math.min(AUDIO_CHUNK_FRAME_COUNT, totalSamples - sampleOffset)
      const planarData = packStereoChunkAsPlanarFloat32(
        leftChannel,
        rightChannel,
        sampleOffset,
        frameCount,
      )
      const timestampMicroseconds = Math.round(
        (sampleOffset / EXPORT_AUDIO_SAMPLE_RATE_HZ) * 1_000_000,
      )

      const audioData = new AudioData({
        format: 'f32-planar',
        sampleRate: EXPORT_AUDIO_SAMPLE_RATE_HZ,
        numberOfFrames: frameCount,
        numberOfChannels: 2,
        timestamp: timestampMicroseconds,
        data: planarData,
      })

      audioEncoder.encode(audioData)
      audioData.close()

      while (
        audioEncoder.encodeQueueSize > MAX_AUDIO_ENCODE_QUEUE_SIZE &&
        !signal.aborted &&
        !encoderError &&
        audioEncoder.state === 'configured'
      ) {
        await yieldToMainThread(5)
      }
    }

    await audioEncoder.flush()
    if (encoderError) throw encoderError
  } finally {
    try {
      if (audioEncoder.state !== 'closed') audioEncoder.close()
    } catch {
      // Ignore close errors on aborted encoder
    }
  }
}

export interface VideoRenderInputs {
  slides: SlideImage[]
  timeline: ComputedTimeline
  effects: SmartEffectsConfig
  output: OutputConfig
}

export interface EncodedVideo {
  codec: VideoCodecSelection
  chunks: BufferedVideoChunk[]
}

export async function encodeVideoFrames(params: VideoRenderInputs & {
  startTimeMs: number
  signal: AbortSignal
  onProgress: (progress: ExportProgress) => void
  beforeFrame?: (frameIndex: number) => Promise<void>
  requireDecodedImages?: boolean
  onChunkBytes?: (byteLength: number) => void
}, videoCodec: VideoCodecSelection): Promise<BufferedVideoChunk[]> {
  const {
    slides,
    timeline,
    effects,
    output,
    startTimeMs,
    signal,
    onProgress,
  } = params

  const { width, height, bitrate, totalFrames } = videoDimensions(output, timeline)
  let encoderError: Error | null = null
  const frameDurationMicroseconds = Math.round(1_000_000 / output.fps)
  const keyFrameIntervalFrames = output.fps * 2 // Insert an IDR keyframe every 2 seconds

  // Buffer encoded video chunks in decode order until `videoEncoder.flush()` completes so we
  // can reconstruct monotonic DTS and non-negative MP4 `ctts` offsets if the encoder emits
  // B-frames. `Mp4Muxer` (`fastStart: 'in-memory'`) already retains all sample buffers until
  // `finalize()`, and `addVideoChunkRaw` takes `Uint8Array` by reference (zero extra copy).
  const bufferedVideoChunks: BufferedVideoChunk[] = []

  const videoEncoder = new VideoEncoder({
    output: (chunk, meta) => {
      try {
        params.onChunkBytes?.(chunk.byteLength)
        const data = new Uint8Array(chunk.byteLength)
        chunk.copyTo(data)
        const durationMicroseconds =
          chunk.duration !== null && Number.isFinite(chunk.duration) && chunk.duration >= 0
            ? chunk.duration
            : frameDurationMicroseconds

        bufferedVideoChunks.push({
          data,
          type: chunk.type,
          presentationTimestampMicroseconds: chunk.timestamp,
          durationMicroseconds,
          meta,
        })
      } catch (err) {
        encoderError = err instanceof Error ? err : new Error(String(err))
      }
    },
    error: (err) => {
      encoderError = err instanceof Error ? err : new Error(String(err))
    },
  })

  videoEncoder.configure({
    codec: videoCodec.webCodecsCodec,
    width,
    height,
    bitrate,
    framerate: output.fps,
    latencyMode: 'realtime',
    avc: output.format === 'mp4' ? { format: 'avc' } : undefined,
  })

  const renderCanvas = createRenderCanvas()
  renderCanvas.width = width
  renderCanvas.height = height
  const renderCtx = getRenderContext(renderCanvas)
  const renderer = new SlideshowRenderer()
  const exportBitmapCache = new BitmapCache(6, Math.max(width, height))

  const getBitmap = (slideId: string) => {
    const bitmap = exportBitmapCache.getSync(slideId)
    if (!bitmap && params.requireDecodedImages) {
      throw new Error('Unable to decode a prepared slide.')
    }
    return bitmap
  }

  try {
    let lastProgressReportTimeMs = 0
    let staticSlideIndex: number | null = null

    for (let frameIndex = 0; frameIndex < totalFrames; frameIndex++) {
      if (signal.aborted) {
        throw new DOMException('Cancelled', 'AbortError')
      }
      if (encoderError) {
        throw encoderError
      }

      if (params.beforeFrame) await params.beforeFrame(frameIndex)
      const frameTimeSeconds = frameIndex / output.fps
      const activeTimelineIndex = renderer.findSlideAtTime(timeline, frameTimeSeconds)

      if (activeTimelineIndex !== staticSlideIndex) {
        await exportBitmapCache.ensureSlideWindowLoaded(slides, timeline, activeTimelineIndex, {
          lookaheadCount: 2,
          awaitActiveBitmaps: true,
        })

        const isStatic = renderer.renderFrame(
          renderCtx,
          width,
          height,
          frameTimeSeconds,
          timeline,
          slides,
          getBitmap,
          effects,
        )
        staticSlideIndex = isStatic ? activeTimelineIndex : null
      }

      const timestampMicroseconds = Math.round((frameIndex * 1_000_000) / output.fps)
      const videoFrame = new VideoFrame(renderCanvas, {
        timestamp: timestampMicroseconds,
        duration: frameDurationMicroseconds,
      })

      const isKeyFrame = frameIndex % keyFrameIntervalFrames === 0
      try {
        videoEncoder.encode(videoFrame, { keyFrame: isKeyFrame })
      } finally {
        videoFrame.close()
      }

      // Enforce encoder queue backpressure so GPU/RAM usage remains flat on long exports
      while (
        videoEncoder.encodeQueueSize > MAX_VIDEO_ENCODE_QUEUE_SIZE &&
        !signal.aborted &&
        !encoderError &&
        videoEncoder.state === 'configured'
      ) {
        await yieldToMainThread(8)
      }

      const nowMs = performance.now()
      const shouldReportProgress =
        nowMs - lastProgressReportTimeMs > PROGRESS_REPORT_INTERVAL_MS ||
        frameIndex === totalFrames - 1

      if (shouldReportProgress) {
        lastProgressReportTimeMs = nowMs
        const elapsedMs = nowMs - startTimeMs
        const completedFraction = (frameIndex + 1) / totalFrames
        const estimatedRemainingMs =
          frameIndex > 5
            ? Math.max(0, (elapsedMs / completedFraction) * (1 - completedFraction))
            : null

        onProgress({
          phase: 'rendering',
          currentFrame: frameIndex + 1,
          totalFrames,
          percent: Math.min(96, Math.round(4 + completedFraction * 92)),
          elapsedMs,
          estimatedRemainingMs,
          message: `Encoding frame ${frameIndex + 1} of ${totalFrames}…`,
        })
        await yieldToMainThread(0)
      }
    }

    onProgress({
      phase: 'finalizing',
      currentFrame: totalFrames,
      totalFrames,
      percent: 98,
      elapsedMs: performance.now() - startTimeMs,
      estimatedRemainingMs: 500,
      message: `Finalizing ${output.format.toUpperCase()} file…`,
    })

    await videoEncoder.flush()
    if (signal.aborted) {
      throw new DOMException('Cancelled', 'AbortError')
    }
    if (encoderError) throw encoderError

    return bufferedVideoChunks
  } finally {
    exportBitmapCache.clear()
    try {
      if (videoEncoder.state !== 'closed') videoEncoder.close()
    } catch {
      // Ignore close errors on aborted encoder
    }
  }
}

function muxVideoChunks(containerMuxer: MediaContainerMuxer, chunks: BufferedVideoChunk[]) {
  const chunkSchedule = resolveVideoChunkSchedule(chunks)
  for (let index = 0; index < chunks.length; index++) {
    const chunk = chunks[index]
    const timing = chunkSchedule.timings[index]
    containerMuxer.addVideoChunkRaw({
      data: chunk.data,
      type: chunk.type,
      presentationTimestampMicroseconds: timing.presentationTimestampMicroseconds,
      decodeTimestampMicroseconds: timing.decodeTimestampMicroseconds,
      durationMicroseconds: chunk.durationMicroseconds,
      compositionTimeOffsetMicroseconds: timing.compositionTimeOffsetMicroseconds,
      meta: chunk.meta,
    })
  }
}

function videoDimensions(output: OutputConfig, timeline: ComputedTimeline) {
  // H.264 and VP9 require even dimensions.
  return {
    width: output.width - output.width % 2,
    height: output.height - output.height % 2,
    bitrate: getVideoBitrate(output),
    totalFrames: Math.max(1, Math.ceil(timeline.totalDuration * output.fps)),
  }
}

export function selectExportVideoCodec({ output, timeline }: VideoRenderInputs) {
  const { width, height, bitrate } = videoDimensions(output, timeline)
  return selectSupportedVideoCodec(output.format, width, height, output.fps, bitrate)
}

/**
 * Orchestrates full client-side slideshow export (audio mixing + WebCodecs encoding + MP4/WebM muxing).
 */
export async function exportSlideshowVideo(params: {
  acquirePreparedVideo?: () => Promise<EncodedVideo | null>
  slides: SlideImage[]
  timeline: ComputedTimeline
  effects: SmartEffectsConfig
  music: MusicConfig
  output: OutputConfig
  signal: AbortSignal
  onProgress: (progress: ExportProgress) => void
}): Promise<{ blob: Blob; fileName: string }> {
  const { slides, timeline, effects, music, output, signal, onProgress } = params

  if (!isWebCodecsSupported()) {
    throw new Error(
      'WebCodecs is not available in this browser. Please use a modern version of Chrome, Edge, Safari, or Firefox.',
    )
  }

  if (slides.length === 0 || timeline.totalDuration <= 0) {
    throw new Error('Add at least one photo before exporting.')
  }

  const { width, height, totalFrames } = videoDimensions(output, timeline)
  const startTimeMs = performance.now()

  onProgress({
    phase: 'preparing',
    currentFrame: 0,
    totalFrames,
    percent: 0,
    elapsedMs: 0,
    estimatedRemainingMs: null,
    message: 'Initializing video encoder…',
  })

  const hasMusicBuffer = Boolean(music.audioBuffer)
  const audioCodec = hasMusicBuffer
    ? await selectSupportedAudioCodec(output.format, EXPORT_AUDIO_SAMPLE_RATE_HZ)
    : null

  let renderedAudio: AudioBuffer | null = null
  if (hasMusicBuffer && audioCodec) {
    onProgress({
      phase: 'audio',
      currentFrame: 0,
      totalFrames,
      percent: 2,
      elapsedMs: performance.now() - startTimeMs,
      estimatedRemainingMs: null,
      message: 'Mixing audio track…',
    })
    renderedAudio = await renderExportAudioBuffer(
      music,
      timeline.totalDuration,
      EXPORT_AUDIO_SAMPLE_RATE_HZ,
    )
  }

  if (signal.aborted) {
    throw new DOMException('Cancelled', 'AbortError')
  }

  const prepared = await params.acquirePreparedVideo?.()
  signal.throwIfAborted()
  const videoCodec = prepared?.codec ?? await selectExportVideoCodec(params)
  const containerMuxer = createContainerMuxer({
    format: output.format,
    width,
    height,
    fps: output.fps,
    videoCodec,
    audioCodec,
    hasAudioTrack: Boolean(renderedAudio && audioCodec),
  })

  if (renderedAudio && audioCodec) {
    await encodeAudioTrackToMuxer({
      renderedAudio,
      audioCodec,
      containerMuxer,
      signal,
    })
  }

  const chunks = prepared?.chunks ?? await encodeVideoFrames({
    slides, timeline, effects, output, signal, startTimeMs, onProgress,
  }, videoCodec)
  signal.throwIfAborted()
  muxVideoChunks(containerMuxer, chunks)

  const blob = containerMuxer.finalizeToBlob()
  const timestampLabel = new Date().toISOString().slice(0, 16).replace(/[T:]/g, '-')
  return {
    blob,
    fileName: `slideshow-${timestampLabel}.${output.format}`,
  }
}
