import type { SlideImage } from '../types/slideshow'

const THUMB_MAX_SIZE = 220

/**
 * Generates a lightweight thumbnail Blob URL and reads natural dimensions.
 * Concurrency-limited so dropping 300+ photos stays responsive.
 */
class ThumbnailQueue {
  private queue: Array<{ slide: SlideImage; onDone: (url: string, w: number, h: number) => void }> = []
  private active = 0
  private maxConcurrency = 4

  enqueue(slide: SlideImage, onDone: (url: string, w: number, h: number) => void) {
    this.queue.push({ slide, onDone })
    this.pump()
  }

  clear() {
    this.queue = []
  }

  private pump() {
    while (this.active < this.maxConcurrency && this.queue.length > 0) {
      const job = this.queue.shift()!
      this.active++
      this.process(job.slide)
        .then((res) => {
          if (res) job.onDone(res.url, res.width, res.height)
        })
        .catch(() => {
          // Fallback: use raw object URL if createImageBitmap fails
          const fallbackUrl = URL.createObjectURL(job.slide.file)
          job.onDone(fallbackUrl, 1920, 1080)
        })
        .finally(() => {
          this.active--
          this.pump()
        })
    }
  }

  private async process(slide: SlideImage): Promise<{ url: string; width: number; height: number } | null> {
    const bitmap = await createImageBitmap(slide.file, { imageOrientation: 'from-image' })
    const origW = bitmap.width
    const origH = bitmap.height
    const scale = Math.min(1, THUMB_MAX_SIZE / Math.max(origW, origH))
    const tw = Math.max(1, Math.round(origW * scale))
    const th = Math.max(1, Math.round(origH * scale))

    const canvas = document.createElement('canvas')
    canvas.width = tw
    canvas.height = th
    const ctx = canvas.getContext('2d')
    if (!ctx) {
      bitmap.close()
      return null
    }
    ctx.drawImage(bitmap, 0, 0, tw, th)
    bitmap.close()

    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob((b) => resolve(b), 'image/jpeg', 0.78),
    )
    if (!blob) return null
    return {
      url: URL.createObjectURL(blob),
      width: origW,
      height: origH,
    }
  }
}

export const thumbnailQueue = new ThumbnailQueue()

/**
 * Sliding-window LRU ImageBitmap cache.
 * Decodes images scaled to the target render dimension and closes evicted bitmaps
 * so hundreds of high-res photos never exhaust browser memory.
 */
export class BitmapCache {
  private cache = new Map<string, ImageBitmap>()
  private inflight = new Map<string, Promise<ImageBitmap | null>>()
  private maxEntries: number
  private maxDim: number

  constructor(maxEntries = 10, maxDim = 1920) {
    this.maxEntries = maxEntries
    this.maxDim = maxDim
  }

  setMaxDimension(dim: number) {
    const clamped = Math.max(720, Math.min(3840, dim))
    if (Math.abs(clamped - this.maxDim) > 200) {
      this.maxDim = clamped
      this.clear()
    }
  }

  getSync(slideId: string): ImageBitmap | null {
    const bmp = this.cache.get(slideId)
    if (bmp) {
      // Touch for LRU
      this.cache.delete(slideId)
      this.cache.set(slideId, bmp)
      return bmp
    }
    return null
  }

  async get(slide: SlideImage): Promise<ImageBitmap | null> {
    const existing = this.getSync(slide.id)
    if (existing) return existing

    const pending = this.inflight.get(slide.id)
    if (pending) return pending

    const promise = this.decode(slide)
      .then((bmp) => {
        this.inflight.delete(slide.id)
        if (bmp) {
          this.put(slide.id, bmp)
        }
        return bmp
      })
      .catch(() => {
        this.inflight.delete(slide.id)
        return null
      })

    this.inflight.set(slide.id, promise)
    return promise
  }

  preload(slides: SlideImage[]) {
    for (const s of slides) {
      if (!this.cache.has(s.id) && !this.inflight.has(s.id)) {
        void this.get(s)
      }
    }
  }

  evict(slideId: string) {
    const bmp = this.cache.get(slideId)
    if (bmp) {
      bmp.close()
      this.cache.delete(slideId)
    }
  }

  clear() {
    for (const bmp of this.cache.values()) {
      bmp.close()
    }
    this.cache.clear()
    this.inflight.clear()
  }

  private put(id: string, bmp: ImageBitmap) {
    if (this.cache.has(id)) {
      const old = this.cache.get(id)!
      if (old !== bmp) old.close()
      this.cache.delete(id)
    }
    this.cache.set(id, bmp)

    while (this.cache.size > this.maxEntries) {
      const oldestKey = this.cache.keys().next().value
      if (oldestKey !== undefined) {
        const oldest = this.cache.get(oldestKey)
        oldest?.close()
        this.cache.delete(oldestKey)
      }
    }
  }

  private async decode(slide: SlideImage): Promise<ImageBitmap | null> {
    // First decode with EXIF orientation; downscale if larger than maxDim * 1.25
    const raw = await createImageBitmap(slide.file, { imageOrientation: 'from-image' })
    const maxAllowed = Math.round(this.maxDim * 1.25)
    if (raw.width <= maxAllowed && raw.height <= maxAllowed) {
      return raw
    }
    const scale = maxAllowed / Math.max(raw.width, raw.height)
    const targetW = Math.max(1, Math.round(raw.width * scale))
    const targetH = Math.max(1, Math.round(raw.height * scale))
    try {
      const scaled = await createImageBitmap(raw, {
        resizeWidth: targetW,
        resizeHeight: targetH,
        resizeQuality: 'high',
      })
      raw.close()
      return scaled
    } catch {
      return raw
    }
  }
}
