import { computed, onBeforeUnmount, onMounted, ref, toRaw, watch, type Ref } from 'vue'
import type { EncodedVideo, VideoRenderInputs } from '../engine/exporter'
import type { PreparationCommand, PreparationUpdate } from '../engine/preparationMessages'
import type { ExportProgress } from '../types/slideshow'

const IDLE_DELAY_MS = 2000

// Read the reactive visual settings and send plain, cloneable data to the worker.
// Image files are immutable. Thumbnail URLs and duplicate-analysis data aren't used for export.
function videoSnapshot(inputs: VideoRenderInputs): VideoRenderInputs {
  return {
    output: { ...inputs.output },
    effects: { ...inputs.effects },
    timeline: { ...inputs.timeline, slides: inputs.timeline.slides.map(entry => ({ ...entry })) },
    slides: inputs.slides.map(slide => ({
      ...toRaw(slide),
      id: slide.id,
      file: slide.file,
      rotation: slide.rotation,
      cropPosition: { ...slide.cropPosition },
      effectOverrides: { ...slide.effectOverrides },
      thumbnailUrl: null,
      perceptualFingerprint: null,
    })),
  }
}

export function useExportPreparation(readInputs: () => VideoRenderInputs, playing: Ref<boolean>) {
  const supported = typeof Worker !== 'undefined' && typeof OffscreenCanvas !== 'undefined' &&
    typeof VideoEncoder !== 'undefined'
  const enabled = ref(false)
  const status = ref('')
  const snapshot = computed(() => enabled.value ? videoSnapshot(readInputs()) : null)
  let worker: Worker | null = null
  let workerInputs: VideoRenderInputs | null = null
  let timer: ReturnType<typeof setTimeout> | undefined
  let claimed = false
  let paused = false
  let parked = false
  let percent = 0
  let settle: ((video: EncodedVideo | null) => void) | undefined
  let report: ((progress: ExportProgress) => void) | undefined

  function send(command: PreparationCommand) {
    worker?.postMessage(command)
  }

  function discard() {
    clearTimeout(timer)
    worker?.terminate()
    worker = null
    workerInputs = null
    settle?.(null)
    settle = undefined
    paused = false
    parked = false
    percent = 0
  }

  function toggle() {
    discard()
    enabled.value = !enabled.value && supported
    status.value = ''
    if (enabled.value) waitForIdle()
  }

  function unavailable() {
    discard()
    enabled.value = false
    status.value = 'Preparation unavailable. Export is still available.'
  }

  function start(inputs: VideoRenderInputs) {
    try {
      const current = new Worker(new URL('../engine/exportPreparation.worker.ts', import.meta.url), { type: 'module' })
      worker = current
      workerInputs = inputs
      current.onerror = current.onmessageerror = () => { if (current === worker) unavailable() }
      current.onmessage = ({ data }: MessageEvent<PreparationUpdate>) => {
        if (worker !== current) return
        switch (data.type) {
          case 'progress':
            percent = Math.floor(100 * data.progress.currentFrame / data.progress.totalFrames)
            if (claimed) report?.(data.progress)
            else if (!paused && !parked) status.value = `Preparing video · ${percent}%`
            break
          case 'cache-full':
          case 'ready':
            parked = true
            status.value = data.type === 'ready' ? 'Video prepared' : `Cache limit reached · ${percent}% prepared`
            break
          case 'invalidated':
            discard()
            if (!claimed) waitForIdle()
            break
          case 'unavailable':
            unavailable()
            break
          case 'finished':
            settle?.(data.video)
            settle = undefined
            discard()
            break
        }
      }
      send({ type: 'start', inputs })
    } catch {
      unavailable()
    }
  }

  function waitForIdle() {
    if (!enabled.value || claimed) return
    clearTimeout(timer)
    if (worker && !paused && !parked) {
      send({ type: 'pause' })
      paused = true
    }
    if (!parked) status.value = worker ? `Paused · ${percent}% prepared` : 'Waiting for idle'
    if (playing.value || document.hidden || parked) return
    timer = setTimeout(() => {
      if (!snapshot.value?.slides.length || claimed || playing.value || document.hidden) return
      if (worker) send({ type: 'resume' })
      else start(snapshot.value)
      paused = false
      if (worker) status.value = `Preparing video · ${percent}%`
    }, IDLE_DELAY_MS)
  }

  function synchronize(next: VideoRenderInputs) {
    const previous = workerInputs
    if (!previous) return
    const changedLayout = JSON.stringify(previous.timeline) !== JSON.stringify(next.timeline) ||
      JSON.stringify(previous.effects) !== JSON.stringify(next.effects) ||
      JSON.stringify(previous.output) !== JSON.stringify(next.output) ||
      previous.slides.length !== next.slides.length ||
      previous.slides.some((slide, index) => slide.id !== next.slides[index].id || slide.file !== next.slides[index].file)
    if (changedLayout) {
      discard()
      return
    }
    next.slides.forEach(({ rotation, cropPosition, effectOverrides }, slideIndex) => {
      const old = previous.slides[slideIndex]
      if (rotation !== old.rotation || JSON.stringify(cropPosition) !== JSON.stringify(old.cropPosition) ||
          JSON.stringify(effectOverrides) !== JSON.stringify(old.effectOverrides)) {
        send({ type: 'edit', slideIndex, appearance: { rotation, cropPosition, effectOverrides } })
      }
    })
    workerInputs = next
  }

  watch(snapshot, next => {
    if (!next || claimed) return
    if (!next.slides.length) {
      discard()
      enabled.value = false
      status.value = ''
      return
    }
    synchronize(next)
    waitForIdle()
  })
  watch(playing, waitForIdle, { flush: 'sync' })

  function acquire(signal: AbortSignal, onProgress: (update: ExportProgress) => void) {
    if (snapshot.value) synchronize(snapshot.value)
    const exportStart = performance.now()
    claimed = true
    clearTimeout(timer)
    signal.addEventListener('abort', discard, { once: true })
    return async () => {
      if (!worker || signal.aborted) return null
      const resumeTime = performance.now()
      let firstFrame: number | undefined
      report = update => {
        firstFrame ??= update.currentFrame
        const framesSinceResume = update.currentFrame - firstFrame
        const now = performance.now()
        onProgress({
          ...update,
          elapsedMs: now - exportStart,
          estimatedRemainingMs: framesSinceResume > 5
            ? (update.totalFrames - update.currentFrame) * (now - resumeTime) / framesSinceResume
            : null,
        })
      }
      return new Promise<EncodedVideo | null>(resolve => {
        settle = resolve
        send({ type: 'finish' })
      })
    }
  }

  function finish() {
    discard()
    enabled.value = false
    claimed = false
    report = undefined
    status.value = ''
  }

  function onDrag(event: PointerEvent) {
    if (event.buttons) waitForIdle()
  }
  const interactionEvents = ['pointerdown', 'keydown', 'input', 'wheel'] as const
  onMounted(() => {
    document.addEventListener('visibilitychange', waitForIdle)
    window.addEventListener('pointermove', onDrag)
    for (const event of interactionEvents) window.addEventListener(event, waitForIdle, { capture: true, passive: true })
  })
  onBeforeUnmount(() => {
    finish()
    document.removeEventListener('visibilitychange', waitForIdle)
    window.removeEventListener('pointermove', onDrag)
    for (const event of interactionEvents) window.removeEventListener(event, waitForIdle, true)
  })
  return { supported, enabled, status, toggle, acquire, finish }
}
