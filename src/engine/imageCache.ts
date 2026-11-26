import type { ComputedTimeline, PerceptualFingerprint, SlideImage } from '../types/slideshow'
import { computePerceptualFingerprintFromBitmap } from './duplicateDetector'

const THUMBNAIL_MAX_DIMENSION_PX = 220
const THUMBNAIL_JPEG_QUALITY = 0.78
const THUMBNAIL_MAX_CONCURRENCY = 4

/**
 * Slight overscan multiplier (1.25x output dimension) so Ken Burns zoom-ins up to 18%
 * remain sharp without decoding full 12-50MP camera originals into GPU memory.
 */
const BITMAP_OVERSCAN_SCALE = 1.25

type ThumbnailCompletionCallback = (
  thumbnailBlobUrl: string,
  naturalWidth: number,
  naturalHeight: number,
  perceptualFingerprint: PerceptualFingerprint | null,
) => void

type ThumbnailErrorCallback = () => void

interface ThumbnailGenerationJob {
  slide: SlideImage
  onComplete: ThumbnailCompletionCallback
  onError?: ThumbnailErrorCallback
}

/**
 * Decodes an image file into an `ImageBitmap` while honoring EXIF orientation.
 * Retries once without options only if the browser rejects the `imageOrientation` option itself;
 * throws for undecodable or corrupted files so callers can reject them cleanly.
 */
async function decodeOrientedImageBitmap(file: Blob): Promise<ImageBitmap> {
  try {
    return await createImageBitmap(file, { imageOrientation: 'from-image' })
  } catch (err) {
    if (err instanceof TypeError) {
      return await createImageBitmap(file)
    }
    throw err
  }
}

/**
 * Generates lightweight ~220px JPEG thumbnail Blob URLs and reads natural image dimensions.
 * Concurrency-limited to 4 simultaneous decodes so dropping 300+ photos never freezes the UI thread.
 */
class ThumbnailQueue {
  private pendingJobs: ThumbnailGenerationJob[] = []
  private activeWorkerCount = 0

  enqueue(
    slide: SlideImage,
    onComplete: ThumbnailCompletionCallback,
    onError?: ThumbnailErrorCallback,
  ) {
    this.pendingJobs.push({ slide, onComplete, onError })
    this.processNextJobs()
  }

  clear() {
    this.pendingJobs = []
  }

  private processNextJobs() {
    while (this.activeWorkerCount < THUMBNAIL_MAX_CONCURRENCY && this.pendingJobs.length > 0) {
      const nextJob = this.pendingJobs.shift()!
      this.activeWorkerCount++

      this.generateThumbnail(nextJob.slide)
        .then((result) => {
          if (result) {
            nextJob.onComplete(
              result.thumbnailBlobUrl,
              result.naturalWidth,
              result.naturalHeight,
              result.perceptualFingerprint,
            )
          } else {
            nextJob.onError?.()
          }
        })
        .catch(() => {
          // Do not fall back to raw object URLs: undecodable files (e.g. RAW/corrupt files)
          // would render as broken thumbnails and blank frames during preview/export.
          nextJob.onError?.()
        })
        .finally(() => {
          this.activeWorkerCount--
          this.processNextJobs()
        })
    }
  }

  private async generateThumbnail(slide: SlideImage): Promise<{
    thumbnailBlobUrl: string
    naturalWidth: number
    naturalHeight: number
    perceptualFingerprint: PerceptualFingerprint | null
  } | null> {
    const decodedBitmap = await decodeOrientedImageBitmap(slide.file)
    const naturalWidth = decodedBitmap.width
    const naturalHeight = decodedBitmap.height

    if (naturalWidth <= 0 || naturalHeight <= 0) {
      decodedBitmap.close()
      return null
    }

    const downscaleFactor = Math.min(
      1,
      THUMBNAIL_MAX_DIMENSION_PX / Math.max(naturalWidth, naturalHeight),
    )
    const thumbWidth = Math.max(1, Math.round(naturalWidth * downscaleFactor))
    const thumbHeight = Math.max(1, Math.round(naturalHeight * downscaleFactor))

    const thumbCanvas = document.createElement('canvas')
    thumbCanvas.width = thumbWidth
    thumbCanvas.height = thumbHeight
    const thumbCtx = thumbCanvas.getContext('2d')
    if (!thumbCtx) {
      decodedBitmap.close()
      return null
    }

    thumbCtx.drawImage(decodedBitmap, 0, 0, thumbWidth, thumbHeight)
    // Piggyback perceptual fingerprinting on the already-decoded EXIF-oriented bitmap (zero extra decodes)
    const perceptualFingerprint = computePerceptualFingerprintFromBitmap(decodedBitmap)
    decodedBitmap.close()

    const jpegBlob = await new Promise<Blob | null>((resolve) =>
      thumbCanvas.toBlob((blob) => resolve(blob), 'image/jpeg', THUMBNAIL_JPEG_QUALITY),
    )
    if (!jpegBlob) return null

    return {
      thumbnailBlobUrl: URL.createObjectURL(jpegBlob),
      naturalWidth,
      naturalHeight,
      perceptualFingerprint,
    }
  }
}

export const thumbnailQueue = new ThumbnailQueue()

/**
 * Sliding-window Least-Recently-Used (LRU) `ImageBitmap` cache.
 * Decodes photos scaled to the target render resolution and explicitly calls `.close()` on evicted
 * bitmaps so hundreds of high-resolution photos never exhaust browser GPU/RAM memory.
 */
export class BitmapCache {
  private lruCache = new Map<string, ImageBitmap>()
  private inflightDecodes = new Map<string, Promise<ImageBitmap | null>>()
  private maxCachedEntries: number
  private targetMaxDimensionPx: number

  constructor(maxCachedEntries = 10, targetMaxDimensionPx = 1920) {
    this.maxCachedEntries = maxCachedEntries
    this.targetMaxDimensionPx = targetMaxDimensionPx
  }

  setMaxDimension(dimensionPx: number) {
    const clampedDimension = Math.max(720, Math.min(3840, dimensionPx))
    if (Math.abs(clampedDimension - this.targetMaxDimensionPx) > 200) {
      this.targetMaxDimensionPx = clampedDimension
      this.clear()
    }
  }

  /**
   * Returns a cached `ImageBitmap` synchronously if present, refreshing its LRU recency order.
   */
  getSync(slideId: string): ImageBitmap | null {
    const existingBitmap = this.lruCache.get(slideId)
    if (existingBitmap) {
      // Re-insert key at the end of Map iteration order to mark as most-recently used
      this.lruCache.delete(slideId)
      this.lruCache.set(slideId, existingBitmap)
      return existingBitmap
    }
    return null
  }

  /**
   * Decodes or retrieves the `ImageBitmap` for `slide`, deduplicating concurrent requests for the same slide.
   */
  async get(slide: SlideImage): Promise<ImageBitmap | null> {
    const cachedBitmap = this.getSync(slide.id)
    if (cachedBitmap) return cachedBitmap

    const pendingDecode = this.inflightDecodes.get(slide.id)
    if (pendingDecode) return pendingDecode

    const decodePromise = this.decodeScaledBitmap(slide)
      .then((bitmap) => {
        this.inflightDecodes.delete(slide.id)
        if (bitmap) {
          this.storeInLruCache(slide.id, bitmap)
        }
        return bitmap
      })
      .catch(() => {
        this.inflightDecodes.delete(slide.id)
        return null
      })

    this.inflightDecodes.set(slide.id, decodePromise)
    return decodePromise
  }

  /**
   * Starts background decoding for upcoming slides without blocking the caller.
   */
  preload(slidesToPreload: SlideImage[]) {
    for (const slide of slidesToPreload) {
      if (!this.lruCache.has(slide.id) && !this.inflightDecodes.has(slide.id)) {
        void this.get(slide)
      }
    }
  }

  /**
   * Ensures the active slide (and the outgoing previous slide during transitions) are loaded,
   * while kicking off asynchronous preloading for the next `lookaheadCount` slides.
   * Shared by both live Preview and WebCodecs Export to avoid duplicate sliding-window logic.
   */
  async ensureSlideWindowLoaded(
    slides: SlideImage[],
    timeline: ComputedTimeline,
    activeTimelineIndex: number,
    options: { lookaheadCount: number; awaitActiveBitmaps: boolean },
  ): Promise<void> {
    if (activeTimelineIndex < 0 || activeTimelineIndex >= timeline.slides.length) {
      return
    }

    const activeSlide = slides[timeline.slides[activeTimelineIndex].slideIndex]
    const previousSlide =
      activeTimelineIndex > 0
        ? slides[timeline.slides[activeTimelineIndex - 1].slideIndex]
        : null

    const requiredDecodes: Promise<ImageBitmap | null>[] = []
    if (activeSlide && !this.getSync(activeSlide.id)) {
      requiredDecodes.push(this.get(activeSlide))
    }
    if (previousSlide && !this.getSync(previousSlide.id)) {
      requiredDecodes.push(this.get(previousSlide))
    }

    const upcomingSlides: SlideImage[] = []
    for (let offset = 1; offset <= options.lookaheadCount; offset++) {
      const lookaheadIndex = activeTimelineIndex + offset
      if (lookaheadIndex < timeline.slides.length) {
        const upcomingSlide = slides[timeline.slides[lookaheadIndex].slideIndex]
        if (upcomingSlide) upcomingSlides.push(upcomingSlide)
      }
    }
    if (upcomingSlides.length > 0) {
      this.preload(upcomingSlides)
    }

    if (options.awaitActiveBitmaps && requiredDecodes.length > 0) {
      await Promise.all(requiredDecodes)
    }
  }

  evict(slideId: string) {
    const bitmap = this.lruCache.get(slideId)
    if (bitmap) {
      bitmap.close()
      this.lruCache.delete(slideId)
    }
  }

  clear() {
    for (const bitmap of this.lruCache.values()) {
      bitmap.close()
    }
    this.lruCache.clear()
    this.inflightDecodes.clear()
  }

  private storeInLruCache(slideId: string, newBitmap: ImageBitmap) {
    if (this.lruCache.has(slideId)) {
      const previousBitmap = this.lruCache.get(slideId)!
      if (previousBitmap !== newBitmap) previousBitmap.close()
      this.lruCache.delete(slideId)
    }
    this.lruCache.set(slideId, newBitmap)

    // Evict oldest entries (at the head of Map iteration order) when capacity is exceeded
    while (this.lruCache.size > this.maxCachedEntries) {
      const oldestKey = this.lruCache.keys().next().value
      if (oldestKey !== undefined) {
        const evictedBitmap = this.lruCache.get(oldestKey)
        evictedBitmap?.close()
        this.lruCache.delete(oldestKey)
      }
    }
  }

  private async decodeScaledBitmap(slide: SlideImage): Promise<ImageBitmap | null> {
    const fullBitmap = await decodeOrientedImageBitmap(slide.file)
    const maxAllowedDimensionPx = Math.round(this.targetMaxDimensionPx * BITMAP_OVERSCAN_SCALE)

    if (
      fullBitmap.width <= maxAllowedDimensionPx &&
      fullBitmap.height <= maxAllowedDimensionPx
    ) {
      return fullBitmap
    }

    const scaleFactor = maxAllowedDimensionPx / Math.max(fullBitmap.width, fullBitmap.height)
    const targetWidth = Math.max(1, Math.round(fullBitmap.width * scaleFactor))
    const targetHeight = Math.max(1, Math.round(fullBitmap.height * scaleFactor))

    try {
      const resizedBitmap = await createImageBitmap(fullBitmap, {
        resizeWidth: targetWidth,
        resizeHeight: targetHeight,
        resizeQuality: 'high',
      })
      fullBitmap.close()
      return resizedBitmap
    } catch {
      return fullBitmap
    }
  }
}
