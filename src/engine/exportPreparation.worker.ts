import { encodeVideoFrames, selectExportVideoCodec, type EncodedVideo, type VideoRenderInputs } from './exporter'
import type { PreparationCommand, PreparationUpdate } from './preparationMessages'

const CACHE_LIMIT_BYTES = 64 * 1024 * 1024
// Leave room for chunks already in the encoder queue when submissions pause.
const PAUSE_AT_BYTES = CACHE_LIMIT_BYTES * 0.75
let inputs: VideoRenderInputs
let lastFrameStarted = -1
let cachedBytes = 0
let paused = false
let finishing = false
let wake: (() => void) | undefined
let completed: EncodedVideo | undefined

function notify(message: PreparationUpdate, transfer: Transferable[] = []) {
  self.postMessage(message, { transfer })
}

function deliverVideo() {
  if (!completed || !finishing) return
  notify({ type: 'finished', video: completed }, completed.chunks.map(chunk => chunk.data.buffer as ArrayBuffer))
  completed = undefined
}

async function beforeFrame(frameIndex: number) {
  if (!finishing && frameIndex % 3 === 0) {
    const scheduler = (globalThis as typeof globalThis & {
      scheduler?: { postTask: (task: () => void, options: { priority: string; delay: number }) => Promise<void> }
    }).scheduler
    if (scheduler) await scheduler.postTask(() => {}, { priority: 'background', delay: 20 })
    else await new Promise(resolve => setTimeout(resolve, 20))
  }
  while (!finishing && (paused || cachedBytes >= PAUSE_AT_BYTES)) {
    await new Promise<void>(resolve => { wake = resolve })
  }
  // Include in-flight bitmap decoding in the prefix that must be invalidated after an edit.
  lastFrameStarted = frameIndex
}

async function prepare() {
  try {
    const codec = await selectExportVideoCodec(inputs)
    const chunks = await encodeVideoFrames({
      ...inputs,
      startTimeMs: performance.now(),
      signal: new AbortController().signal,
      beforeFrame,
      requireDecodedImages: true,
      onChunkBytes(bytes) {
        const previousBytes = cachedBytes
        cachedBytes += bytes
        if (!finishing && cachedBytes > CACHE_LIMIT_BYTES) {
          notify({ type: 'unavailable' })
          throw new Error('Preparation cache exceeded')
        }
        if (!finishing && previousBytes < PAUSE_AT_BYTES && cachedBytes >= PAUSE_AT_BYTES) {
          notify({ type: 'cache-full' })
        }
      },
      onProgress: progress => notify({ type: 'progress', progress }),
    }, codec)
    completed = { codec, chunks }
    if (finishing) deliverVideo()
    else notify({ type: 'ready' })
  } catch {
    notify({ type: 'unavailable' })
  }
}

self.onmessage = ({ data }: MessageEvent<PreparationCommand>) => {
  switch (data.type) {
    case 'start':
      inputs = data.inputs
      void prepare()
      break
    case 'edit': {
      const entry = inputs.timeline.slides.find(slide => slide.slideIndex === data.slideIndex)
      if (!entry || lastFrameStarted / inputs.output.fps >= entry.startTime) {
        notify({ type: 'invalidated' })
      } else {
        Object.assign(inputs.slides[data.slideIndex], data.appearance)
      }
      break
    }
    case 'pause':
      paused = true
      break
    case 'resume':
      paused = false
      wake?.()
      break
    case 'finish':
      finishing = true
      wake?.()
      deliverVideo()
      break
  }
}
