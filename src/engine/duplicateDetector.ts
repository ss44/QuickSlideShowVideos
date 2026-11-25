import type { DuplicateAnalysis, SlideImage } from '../types/slideshow'

const HASH_MAX_CONCURRENCY = 4

type SlideHashCandidate = Pick<SlideImage, 'id' | 'file' | 'size' | 'contentHash'>
type SlideHashSummary = Pick<SlideImage, 'id' | 'contentHash'>
type ContentHashCompletionCallback = (contentHash: string) => void

interface ContentHashJob {
  slide: SlideHashCandidate
  onComplete: ContentHashCompletionCallback
}

function formatBytesAsHex(bytes: Uint8Array): string {
  let hexString = ''
  for (let byteIndex = 0; byteIndex < bytes.length; byteIndex++) {
    hexString += bytes[byteIndex].toString(16).padStart(2, '0')
  }
  return hexString
}

/**
 * Fallback deterministic 64-bit hash (two independent 32-bit FNV-1a passes with distinct seeds)
 * used only when Web Crypto (`crypto.subtle`) is unavailable in non-secure HTTP contexts.
 */
function computeFallbackDualFnv1aHex(bytes: Uint8Array): string {
  let hashHigh = 0x811c9dc5
  let hashLow = 0x050c5d1f

  for (let byteIndex = 0; byteIndex < bytes.length; byteIndex++) {
    const byteValue = bytes[byteIndex]
    hashHigh ^= byteValue
    hashHigh = Math.imul(hashHigh, 0x01000193)
    hashLow ^= byteValue ^ (byteIndex & 0xff)
    hashLow = Math.imul(hashLow, 0x01000193)
  }

  return `${(hashHigh >>> 0).toString(16).padStart(8, '0')}${(hashLow >>> 0).toString(16).padStart(8, '0')}`
}

/**
 * Computes a content fingerprint for an image file prefixed with its exact byte length.
 * Uses native Web Crypto SHA-256 when available so byte-identical files are detected regardless
 * of filename or modification timestamp.
 */
export async function computeFileContentHash(file: File): Promise<string> {
  const fileBuffer = await file.arrayBuffer()

  if (typeof globalThis.crypto !== 'undefined' && globalThis.crypto.subtle) {
    const digestBuffer = await globalThis.crypto.subtle.digest('SHA-256', fileBuffer)
    return `${file.size}:${formatBytesAsHex(new Uint8Array(digestBuffer))}`
  }

  return `${file.size}:${computeFallbackDualFnv1aHex(new Uint8Array(fileBuffer))}`
}

/**
 * Returns only slides that share an identical byte size with at least one other slide and have
 * not been hashed yet. Because two byte-identical files must have the exact same byte length,
 * unique-sized photos require zero file reads.
 */
export function findSlidesRequiringHash<T extends Pick<SlideImage, 'size' | 'contentHash'>>(
  slides: ReadonlyArray<T>,
): T[] {
  const countByFileSize = new Map<number, number>()
  for (const slide of slides) {
    countByFileSize.set(slide.size, (countByFileSize.get(slide.size) ?? 0) + 1)
  }

  return slides.filter(
    (slide) => slide.contentHash === null && (countByFileSize.get(slide.size) ?? 0) >= 2,
  )
}

/**
 * Groups slides by their computed `contentHash` to identify all duplicate slides and which extra
 * copies can be safely removed while keeping the first occurrence of each image in current order.
 */
export function analyzeSlideDuplicates(
  slides: ReadonlyArray<SlideHashSummary>,
): DuplicateAnalysis {
  const slideIdsByContentHash = new Map<string, string[]>()

  for (const slide of slides) {
    if (!slide.contentHash) continue
    const matchingSlideIds = slideIdsByContentHash.get(slide.contentHash)
    if (matchingSlideIds) {
      matchingSlideIds.push(slide.id)
    } else {
      slideIdsByContentHash.set(slide.contentHash, [slide.id])
    }
  }

  const duplicateSlideIds = new Set<string>()
  const removableDuplicateIds = new Set<string>()
  const copyCountBySlideId = new Map<string, number>()

  for (const matchingSlideIds of slideIdsByContentHash.values()) {
    if (matchingSlideIds.length < 2) continue

    for (let occurrenceIndex = 0; occurrenceIndex < matchingSlideIds.length; occurrenceIndex++) {
      const slideId = matchingSlideIds[occurrenceIndex]
      duplicateSlideIds.add(slideId)
      copyCountBySlideId.set(slideId, matchingSlideIds.length)
      if (occurrenceIndex > 0) {
        removableDuplicateIds.add(slideId)
      }
    }
  }

  return {
    duplicateSlideIds,
    removableDuplicateIds,
    copyCountBySlideId,
    removableCount: removableDuplicateIds.size,
  }
}

/**
 * Concurrency-limited asynchronous content hashing queue.
 * Caps simultaneous file reads at 4 (matching `ThumbnailQueue`) and deduplicates in-flight
 * slide IDs so dropping hundreds of large photos never spikes memory or stalls the UI.
 */
export class ContentHashQueue {
  private pendingJobs: ContentHashJob[] = []
  private enqueuedSlideIds = new Set<string>()
  private activeWorkerCount = 0

  enqueue(slide: SlideHashCandidate, onComplete: ContentHashCompletionCallback) {
    if (slide.contentHash !== null || this.enqueuedSlideIds.has(slide.id)) return
    this.enqueuedSlideIds.add(slide.id)
    this.pendingJobs.push({ slide, onComplete })
    this.processNextJobs()
  }

  clear() {
    this.pendingJobs = []
    this.enqueuedSlideIds.clear()
  }

  private processNextJobs() {
    while (this.activeWorkerCount < HASH_MAX_CONCURRENCY && this.pendingJobs.length > 0) {
      const nextJob = this.pendingJobs.shift()!
      this.activeWorkerCount++

      computeFileContentHash(nextJob.slide.file)
        .then((contentHash) => {
          nextJob.onComplete(contentHash)
        })
        .catch(() => {
          // Leave slide unhashed if file reading fails so the queue continues uninterrupted
        })
        .finally(() => {
          this.enqueuedSlideIds.delete(nextJob.slide.id)
          this.activeWorkerCount--
          this.processNextJobs()
        })
    }
  }
}

export const contentHashQueue = new ContentHashQueue()
