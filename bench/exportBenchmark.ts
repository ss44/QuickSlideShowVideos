/**
 * Reproducible export throughput benchmark (dev-only, not part of the production build).
 *
 * Generates synthetic high-resolution camera-sized JPEGs (mixed landscape/portrait so `blur-fill`
 * backdrops are exercised), builds a real timeline with the app's default transitions and effects,
 * and runs `exportSlideshowVideo()` end-to-end. Results are logged as a single `BENCH_RESULT` JSON line.
 *
 * Usage: `npm run dev`, then open `/bench/export-benchmark.html?photos=12&slideSeconds=5`.
 * See `bench/runExportBenchmark.sh` for a headless Chromium runner.
 */
import { exportSlideshowVideo } from '../src/engine/exporter'
import { computeTimeline } from '../src/engine/timeline'
import type {
  FitMode,
  MusicConfig,
  OutputConfig,
  SlideImage,
  SmartEffectsConfig,
} from '../src/types/slideshow'

const UNIQUE_SOURCE_PHOTO_COUNT = 6
const SOURCE_PHOTO_LONG_EDGE_PX = 4032
const SOURCE_PHOTO_SHORT_EDGE_PX = 3024

const query = new URLSearchParams(location.search)
const readNumberParam = (name: string, fallback: number) => {
  const parsed = Number(query.get(name))
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
}

const logElement = document.getElementById('log')!
function logLine(message: string) {
  console.log(message)
  logElement.textContent += `${message}\n`
}

/**
 * Paints a deterministic, texture-rich synthetic photo so JPEG decode/encode costs resemble real
 * camera output (smooth gradients alone would compress unrealistically well).
 */
async function createSyntheticPhotoBlob(seed: number, isPortrait: boolean): Promise<Blob> {
  const width = isPortrait ? SOURCE_PHOTO_SHORT_EDGE_PX : SOURCE_PHOTO_LONG_EDGE_PX
  const height = isPortrait ? SOURCE_PHOTO_LONG_EDGE_PX : SOURCE_PHOTO_SHORT_EDGE_PX
  const canvas = new OffscreenCanvas(width, height)
  const ctx = canvas.getContext('2d')!

  let randomState = seed * 9301 + 49297
  const nextRandom = () => {
    randomState = (randomState * 9301 + 49297) % 233280
    return randomState / 233280
  }

  const gradient = ctx.createLinearGradient(0, 0, width, height)
  gradient.addColorStop(0, `hsl(${seed * 57} 60% 45%)`)
  gradient.addColorStop(1, `hsl(${seed * 57 + 140} 55% 30%)`)
  ctx.fillStyle = gradient
  ctx.fillRect(0, 0, width, height)

  for (let shapeIndex = 0; shapeIndex < 400; shapeIndex++) {
    ctx.fillStyle = `hsla(${nextRandom() * 360} 70% ${30 + nextRandom() * 50}% / 0.5)`
    ctx.beginPath()
    ctx.arc(nextRandom() * width, nextRandom() * height, 10 + nextRandom() * 220, 0, Math.PI * 2)
    ctx.fill()
  }

  // Sensor-like grain so the JPEG carries realistic high-frequency detail
  const grain = ctx.getImageData(0, 0, width, height)
  for (let byteIndex = 0; byteIndex < grain.data.length; byteIndex += 4) {
    const noise = (nextRandom() - 0.5) * 36
    grain.data[byteIndex] += noise
    grain.data[byteIndex + 1] += noise
    grain.data[byteIndex + 2] += noise
  }
  ctx.putImageData(grain, 0, 0)

  return canvas.convertToBlob({ type: 'image/jpeg', quality: 0.9 })
}

async function buildSlides(photoCount: number): Promise<SlideImage[]> {
  const sourceBlobs: Blob[] = []
  for (let sourceIndex = 0; sourceIndex < Math.min(photoCount, UNIQUE_SOURCE_PHOTO_COUNT); sourceIndex++) {
    // Every third photo is portrait so the default `blur-fill` mode renders blurred backdrops
    sourceBlobs.push(await createSyntheticPhotoBlob(sourceIndex + 1, sourceIndex % 3 === 2))
  }

  return Array.from({ length: photoCount }, (_unused, slideIndex) => {
    const blob = sourceBlobs[slideIndex % sourceBlobs.length]
    const isPortrait = slideIndex % sourceBlobs.length % 3 === 2
    const file = new File([blob], `bench-${slideIndex}.jpg`, { type: 'image/jpeg' })
    return {
      id: `bench-slide-${slideIndex}`,
      file,
      name: file.name,
      size: file.size,
      lastModified: 0,
      width: isPortrait ? SOURCE_PHOTO_SHORT_EDGE_PX : SOURCE_PHOTO_LONG_EDGE_PX,
      height: isPortrait ? SOURCE_PHOTO_LONG_EDGE_PX : SOURCE_PHOTO_SHORT_EDGE_PX,
      thumbnailUrl: null,
      rotation: 0,
      cropPosition: { offsetX: 0, offsetY: 0 },
      effectOverrides: {},
      contentHash: null,
      perceptualFingerprint: null,
      sharpnessScore: null,
    }
  })
}

async function runBenchmark() {
  const photoCount = readNumberParam('photos', 12)
  const slideSeconds = readNumberParam('slideSeconds', 5)
  const output: OutputConfig = {
    format: query.get('format') === 'webm' ? 'webm' : 'mp4',
    presetId: 'bench',
    width: readNumberParam('width', 1920),
    height: readNumberParam('height', 1080),
    fps: readNumberParam('fps', 30) === 60 ? 60 : 30,
    quality: 'standard',
  }
  const effects: SmartEffectsConfig = {
    kenBurns: query.get('kenBurns') !== '0',
    kenBurnsIntensity: 0.08,
    fitMode: (query.get('fitMode') as FitMode | null) ?? 'blur-fill',
    beatSync: false,
    colorLook: 'none',
    vignette: true,
  }
  const music: MusicConfig = {
    sourceType: 'none',
    name: '',
    url: '',
    duration: 0,
    loop: true,
    fadeIn: true,
    fadeOut: true,
    startOffset: 0,
    volume: 0.85,
    audioBuffer: null,
    beatTimes: [],
    loading: false,
    error: null,
  }

  logLine(`BENCH: generating ${photoCount} synthetic photos…`)
  const slides = await buildSlides(photoCount)
  const timeline = computeTimeline(
    slides,
    { slideDuration: slideSeconds, transitionDuration: 0.7, matchMusicLength: false },
    ['crossfade', 'zoom-in', 'slide-left'],
    'cycle',
    music,
    false,
  )

  logLine(`BENCH: exporting ${timeline.totalDuration.toFixed(1)}s…`)
  const startTimeMs = performance.now()
  let lastLoggedPercent = -1
  let totalFrames = 0
  const result = await exportSlideshowVideo({
    slides,
    timeline,
    effects,
    music,
    output,
    signal: new AbortController().signal,
    onProgress: (progress) => {
      totalFrames = progress.totalFrames
      if (progress.percent >= lastLoggedPercent + 10) {
        lastLoggedPercent = progress.percent
        logLine(`BENCH: ${progress.percent}% ${progress.message}`)
      }
    },
  })
  const elapsedMs = performance.now() - startTimeMs

  const uploadUrl = query.get('uploadUrl')
  if (uploadUrl) {
    await fetch(`${uploadUrl}?name=${encodeURIComponent(`slideshow.${output.format}`)}`, {
      method: 'POST',
      body: result.blob,
    })
  }

  logLine(
    `BENCH_RESULT ${JSON.stringify({
      photoCount,
      slideSeconds,
      format: output.format,
      resolution: `${output.width}x${output.height}`,
      fps: output.fps,
      totalFrames,
      elapsedSeconds: Number((elapsedMs / 1000).toFixed(1)),
      framesPerSecond: Number((totalFrames / (elapsedMs / 1000)).toFixed(1)),
      fileSizeMB: Number((result.blob.size / 1024 / 1024).toFixed(1)),
      hardwareConcurrency: navigator.hardwareConcurrency,
    })}`,
  )
}

runBenchmark().catch((err) => {
  logLine(`BENCH_ERROR ${err instanceof Error ? `${err.name}: ${err.message}` : String(err)}`)
})
