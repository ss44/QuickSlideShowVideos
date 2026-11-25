import { Muxer as Mp4Muxer, ArrayBufferTarget as Mp4Target } from 'mp4-muxer'
import { Muxer as WebmMuxer, ArrayBufferTarget as WebmTarget } from 'webm-muxer'
import type {
  ComputedTimeline,
  ExportProgress,
  MusicConfig,
  OutputConfig,
  SlideImage,
  SmartEffectsConfig,
} from '../types/slideshow'
import { BitmapCache } from './imageCache'
import { SlideshowRenderer } from './renderer'
import { getVideoBitrate } from './timeline'
import { renderExportAudioBuffer } from './audioEngine'

export function isWebCodecsSupported(): boolean {
  return typeof VideoEncoder !== 'undefined' && typeof VideoFrame !== 'undefined'
}

async function pickVideoCodec(
  format: 'mp4' | 'webm',
  width: number,
  height: number,
  fps: number,
  bitrate: number,
): Promise<{ codec: string; muxerCodec: 'avc' | 'V_VP9' | 'V_VP8' }> {
  const candidates: Array<{ codec: string; muxerCodec: 'avc' | 'V_VP9' | 'V_VP8' }> =
    format === 'mp4'
      ? [
          { codec: 'avc1.640033', muxerCodec: 'avc' }, // High L5.1 (4K)
          { codec: 'avc1.640028', muxerCodec: 'avc' }, // High L4.0 (1080p)
          { codec: 'avc1.4d0028', muxerCodec: 'avc' }, // Main L4.0
          { codec: 'avc1.42001f', muxerCodec: 'avc' }, // Baseline L3.1
        ]
      : [
          { codec: 'vp09.00.10.08', muxerCodec: 'V_VP9' },
          { codec: 'vp8', muxerCodec: 'V_VP8' },
        ]

  for (const cand of candidates) {
    try {
      const support = await VideoEncoder.isConfigSupported({
        codec: cand.codec,
        width,
        height,
        bitrate,
        framerate: fps,
        latencyMode: 'realtime',
      })
      if (support.supported) {
        return cand
      }
    } catch {
      // try next
    }
  }

  throw new Error(
    `Your browser does not support ${format.toUpperCase()} hardware/WebCodecs encoding at ${width}×${height}. Try Chrome, Edge, or Safari, or lower the resolution.`,
  )
}

async function pickAudioCodec(
  format: 'mp4' | 'webm',
  sampleRate: number,
): Promise<{ codec: string; muxerCodec: 'aac' | 'opus' | 'A_OPUS' } | null> {
  if (typeof AudioEncoder === 'undefined' || typeof AudioData === 'undefined') {
    return null
  }
  // MP4 prefers AAC for widest player support, falling back to Opus (supported by mp4-muxer)
  // when AAC AudioEncoder is unavailable (e.g. Linux Chromium).
  const candidates: Array<{ codec: string; muxerCodec: 'aac' | 'opus' | 'A_OPUS' }> =
    format === 'mp4'
      ? [
          { codec: 'mp4a.40.2', muxerCodec: 'aac' },
          { codec: 'opus', muxerCodec: 'opus' },
        ]
      : [{ codec: 'opus', muxerCodec: 'A_OPUS' }]

  for (const cand of candidates) {
    try {
      const support = await AudioEncoder.isConfigSupported({
        codec: cand.codec,
        numberOfChannels: 2,
        sampleRate,
        bitrate: 160_000,
      })
      if (support.supported) return cand
    } catch {
      // try next
    }
  }
  return null
}

function yieldToMain(ms = 0): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export async function exportSlideshowVideo(params: {
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

  // Ensure even dimensions for H.264 / VP9
  const width = output.width - (output.width % 2)
  const height = output.height - (output.height % 2)
  const fps = output.fps
  const totalFrames = Math.max(1, Math.ceil(timeline.totalDuration * fps))
  const bitrate = getVideoBitrate(output)
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

  const videoCodecInfo = await pickVideoCodec(output.format, width, height, fps, bitrate)
  const sampleRate = 48000
  const hasMusic = Boolean(music.audioBuffer)
  const audioCodecInfo = hasMusic ? await pickAudioCodec(output.format, sampleRate) : null

  // Render offline audio first if music is attached
  let renderedAudio: AudioBuffer | null = null
  if (hasMusic && audioCodecInfo) {
    onProgress({
      phase: 'audio',
      currentFrame: 0,
      totalFrames,
      percent: 2,
      elapsedMs: performance.now() - startTimeMs,
      estimatedRemainingMs: null,
      message: 'Mixing audio track…',
    })
    renderedAudio = await renderExportAudioBuffer(music, timeline.totalDuration, sampleRate)
  }

  if (signal.aborted) throw new DOMException('Cancelled', 'AbortError')

  // Create muxer
  const isMp4 = output.format === 'mp4'
  const mp4Target = isMp4 ? new Mp4Target() : null
  const webmTarget = !isMp4 ? new WebmTarget() : null

  const mp4Muxer = isMp4
    ? new Mp4Muxer({
        target: mp4Target!,
        video: {
          codec: 'avc',
          width,
          height,
        },
        audio:
          renderedAudio && audioCodecInfo
            ? {
                codec: audioCodecInfo.muxerCodec === 'opus' ? 'opus' : 'aac',
                numberOfChannels: 2,
                sampleRate,
              }
            : undefined,
        fastStart: 'in-memory',
        firstTimestampBehavior: 'offset',
      })
    : null

  const webmMuxer = !isMp4
    ? new WebmMuxer({
        target: webmTarget!,
        video: {
          codec: videoCodecInfo.muxerCodec === 'V_VP8' ? 'V_VP8' : 'V_VP9',
          width,
          height,
          frameRate: fps,
        },
        audio:
          renderedAudio && audioCodecInfo
            ? {
                codec: 'A_OPUS',
                numberOfChannels: 2,
                sampleRate,
              }
            : undefined,
        firstTimestampBehavior: 'offset',
      })
    : null

  let encoderError: Error | null = null

  const videoEncoder = new VideoEncoder({
    output: (chunk, meta) => {
      try {
        if (mp4Muxer) mp4Muxer.addVideoChunk(chunk, meta)
        if (webmMuxer) webmMuxer.addVideoChunk(chunk, meta)
      } catch (err) {
        encoderError = err instanceof Error ? err : new Error(String(err))
      }
    },
    error: (err) => {
      encoderError = err instanceof Error ? err : new Error(String(err))
    },
  })

  videoEncoder.configure({
    codec: videoCodecInfo.codec,
    width,
    height,
    bitrate,
    framerate: fps,
    latencyMode: 'realtime',
    avc: isMp4 ? { format: 'avc' } : undefined,
  })

  // Encode audio track if present
  let audioEncoder: AudioEncoder | null = null
  if (renderedAudio && audioCodecInfo) {
    audioEncoder = new AudioEncoder({
      output: (chunk, meta) => {
        try {
          if (mp4Muxer) mp4Muxer.addAudioChunk(chunk, meta)
          if (webmMuxer) webmMuxer.addAudioChunk(chunk, meta)
        } catch (err) {
          encoderError = err instanceof Error ? err : new Error(String(err))
        }
      },
      error: (err) => {
        encoderError = err instanceof Error ? err : new Error(String(err))
      },
    })

    audioEncoder.configure({
      codec: audioCodecInfo.codec,
      numberOfChannels: 2,
      sampleRate,
      bitrate: 160_000,
    })

    const left = renderedAudio.getChannelData(0)
    const right = renderedAudio.numberOfChannels > 1 ? renderedAudio.getChannelData(1) : left
    const chunkSamples = 4096
    const totalSamples = renderedAudio.length

    for (let offset = 0; offset < totalSamples; offset += chunkSamples) {
      if (signal.aborted) {
        audioEncoder.close()
        videoEncoder.close()
        throw new DOMException('Cancelled', 'AbortError')
      }
      if (encoderError) throw encoderError

      const count = Math.min(chunkSamples, totalSamples - offset)
      // Planar float32 layout: all channel 0 samples followed by all channel 1 samples
      const planar = new Float32Array(count * 2)
      planar.set(left.subarray(offset, offset + count), 0)
      planar.set(right.subarray(offset, offset + count), count)

      const audioData = new AudioData({
        format: 'f32-planar',
        sampleRate,
        numberOfFrames: count,
        numberOfChannels: 2,
        timestamp: Math.round((offset / sampleRate) * 1_000_000),
        data: planar,
      })

      audioEncoder.encode(audioData)
      audioData.close()

      while (
        audioEncoder.encodeQueueSize > 16 &&
        !signal.aborted &&
        !encoderError &&
        audioEncoder.state === 'configured'
      ) {
        await yieldToMain(5)
      }
    }

    await audioEncoder.flush()
    audioEncoder.close()
  }

  // Dedicated render canvas & sliding-window bitmap cache for export
  const renderCanvas = document.createElement('canvas')
  renderCanvas.width = width
  renderCanvas.height = height
  const renderCtx = renderCanvas.getContext('2d', { alpha: false })!
  const renderer = new SlideshowRenderer()
  const exportCache = new BitmapCache(6, Math.max(width, height))

  const frameDurationUs = Math.round(1_000_000 / fps)
  const keyFrameInterval = fps * 2 // keyframe every 2 seconds

  try {
    let lastReportTime = 0

    for (let frameIdx = 0; frameIdx < totalFrames; frameIdx++) {
      if (signal.aborted) {
        throw new DOMException('Cancelled', 'AbortError')
      }
      if (encoderError) {
        throw encoderError
      }

      const timeSec = frameIdx / fps
      const activeIdx = renderer.findSlideAtTime(timeline, timeSec)

      // Ensure current and previous slide bitmaps are decoded
      if (activeIdx >= 0) {
        const currSlide = slides[timeline.slides[activeIdx].slideIndex]
        if (currSlide && !exportCache.getSync(currSlide.id)) {
          await exportCache.get(currSlide)
        }
        if (activeIdx > 0) {
          const prevSlide = slides[timeline.slides[activeIdx - 1].slideIndex]
          if (prevSlide && !exportCache.getSync(prevSlide.id)) {
            await exportCache.get(prevSlide)
          }
        }
        // Preload next 2 slides asynchronously
        const upcoming: SlideImage[] = []
        for (let k = 1; k <= 2; k++) {
          if (activeIdx + k < timeline.slides.length) {
            upcoming.push(slides[timeline.slides[activeIdx + k].slideIndex])
          }
        }
        if (upcoming.length > 0) exportCache.preload(upcoming)
      }

      renderer.renderFrame(
        renderCtx,
        width,
        height,
        timeSec,
        timeline,
        slides,
        (id) => exportCache.getSync(id),
        effects,
      )

      const timestampUs = Math.round((frameIdx * 1_000_000) / fps)
      const videoFrame = new VideoFrame(renderCanvas, {
        timestamp: timestampUs,
        duration: frameDurationUs,
      })

      videoEncoder.encode(videoFrame, { keyFrame: frameIdx % keyFrameInterval === 0 })
      videoFrame.close()

      // Backpressure so browser memory never spikes
      while (
        videoEncoder.encodeQueueSize > 12 &&
        !signal.aborted &&
        !encoderError &&
        videoEncoder.state === 'configured'
      ) {
        await yieldToMain(8)
      }

      const now = performance.now()
      if (now - lastReportTime > 120 || frameIdx === totalFrames - 1) {
        lastReportTime = now
        const elapsedMs = now - startTimeMs
        const doneFraction = (frameIdx + 1) / totalFrames
        const estimatedRemainingMs =
          frameIdx > 5 ? Math.max(0, (elapsedMs / doneFraction) * (1 - doneFraction)) : null

        onProgress({
          phase: 'rendering',
          currentFrame: frameIdx + 1,
          totalFrames,
          percent: Math.min(96, Math.round(4 + doneFraction * 92)),
          elapsedMs,
          estimatedRemainingMs,
          message: `Encoding frame ${frameIdx + 1} of ${totalFrames}…`,
        })
        await yieldToMain()
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
    videoEncoder.close()

    if (mp4Muxer && mp4Target) {
      mp4Muxer.finalize()
      const blob = new Blob([mp4Target.buffer], { type: 'video/mp4' })
      const timestamp = new Date().toISOString().slice(0, 16).replace(/[T:]/g, '-')
      return { blob, fileName: `slideshow-${timestamp}.mp4` }
    } else if (webmMuxer && webmTarget) {
      webmMuxer.finalize()
      const blob = new Blob([webmTarget.buffer], { type: 'video/webm' })
      const timestamp = new Date().toISOString().slice(0, 16).replace(/[T:]/g, '-')
      return { blob, fileName: `slideshow-${timestamp}.webm` }
    }

    throw new Error('Muxer initialization failed.')
  } catch (err) {
    try {
      if (videoEncoder.state !== 'closed') videoEncoder.close()
    } catch {
      // ignore
    }
    throw err
  } finally {
    exportCache.clear()
  }
}
