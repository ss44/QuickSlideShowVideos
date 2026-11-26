import type {
  DuplicateAnalysis,
  DuplicateDetectionConfig,
  DuplicateMatchKind,
  PerceptualFingerprint,
  SlideImage,
} from '../types/slideshow'

const HASH_MAX_CONCURRENCY = 4
const PHASH_SAMPLE_DIMENSION = 32
const PHASH_DCT_DIMENSION = 8
const PHASH_AC_BIT_COUNT = PHASH_DCT_DIMENSION * PHASH_DCT_DIMENSION - 1 // 63 AC coefficients (excluding DC)
const MAX_RGB_EUCLIDEAN_DISTANCE = Math.sqrt(255 * 255 * 3)

export const DUPLICATE_THRESHOLD_MIN_PERCENT = 75
export const DUPLICATE_THRESHOLD_MAX_PERCENT = 100
export const DEFAULT_DUPLICATE_THRESHOLD_PERCENT = 95

type SlideHashCandidate = Pick<SlideImage, 'id' | 'file' | 'size' | 'contentHash'>
type SlideDuplicateCandidate = Pick<
  SlideImage,
  'id' | 'size' | 'width' | 'height' | 'contentHash' | 'perceptualFingerprint'
> & { sharpnessScore?: number | null }
type ContentHashCompletionCallback = (contentHash: string) => void

/** Minimum sharpness delta required to break an exact pixel-resolution tie in favor of a sharper copy. */
const EQUAL_RESOLUTION_SHARPNESS_TIEBREAK_DELTA = 5

interface ContentHashJob {
  slide: SlideHashCandidate
  onComplete: ContentHashCompletionCallback
}

/**
 * Precomputed Type-II DCT cosine table for frequencies 0..7 across 32 spatial samples.
 * Evaluating only the top-left 8x8 low-frequency block keeps perceptual hashing under ~0.1ms per photo.
 */
const DCT_COSINE_TABLE: Float64Array[] = Array.from({ length: PHASH_DCT_DIMENSION }, (_, freq) => {
  const row = new Float64Array(PHASH_SAMPLE_DIMENSION)
  for (let sample = 0; sample < PHASH_SAMPLE_DIMENSION; sample++) {
    row[sample] = Math.cos(((2 * sample + 1) * freq * Math.PI) / (2 * PHASH_SAMPLE_DIMENSION))
  }
  return row
})

let sharedPhashScratchCanvas: HTMLCanvasElement | null = null
let sharedPhashScratchCtx: CanvasRenderingContext2D | null = null

function getPhashScratchContext(): CanvasRenderingContext2D | null {
  if (sharedPhashScratchCtx) return sharedPhashScratchCtx
  if (typeof document === 'undefined') return null

  sharedPhashScratchCanvas = document.createElement('canvas')
  sharedPhashScratchCanvas.width = PHASH_SAMPLE_DIMENSION
  sharedPhashScratchCanvas.height = PHASH_SAMPLE_DIMENSION
  sharedPhashScratchCtx = sharedPhashScratchCanvas.getContext('2d', { willReadFrequently: true })
  if (sharedPhashScratchCtx) {
    // High-quality downsampling prevents aliasing differences between high-res originals and small copies
    sharedPhashScratchCtx.imageSmoothingEnabled = true
    sharedPhashScratchCtx.imageSmoothingQuality = 'high'
  }
  return sharedPhashScratchCtx
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
 * Computes a 63-bit DCT perceptual hash (pHash) plus average RGB color from a 32x32 RGBA pixel buffer.
 * Excluding the DC component (`[0, 0]`) makes the hash invariant to uniform brightness/exposure shifts,
 * while retaining average RGB prevents distinct solid-color or heavily recolored frames from colliding.
 */
export function computePerceptualFingerprintFromRgba(
  rgbaPixels: Uint8ClampedArray,
  sampleWidth = PHASH_SAMPLE_DIMENSION,
  sampleHeight = PHASH_SAMPLE_DIMENSION,
): PerceptualFingerprint {
  const pixelCount = sampleWidth * sampleHeight
  const luminanceGrid = new Float64Array(pixelCount)
  let sumRed = 0
  let sumGreen = 0
  let sumBlue = 0

  for (let pixelIndex = 0; pixelIndex < pixelCount; pixelIndex++) {
    const channelOffset = pixelIndex * 4
    const red = rgbaPixels[channelOffset]
    const green = rgbaPixels[channelOffset + 1]
    const blue = rgbaPixels[channelOffset + 2]
    sumRed += red
    sumGreen += green
    sumBlue += blue
    // Rec. 601 luma weights
    luminanceGrid[pixelIndex] = 0.299 * red + 0.587 * green + 0.114 * blue
  }

  // Separable 2D Type-II DCT: horizontal pass across rows (32 -> 8 frequencies)
  const horizontalDct = new Float64Array(PHASH_SAMPLE_DIMENSION * PHASH_DCT_DIMENSION)
  for (let y = 0; y < PHASH_SAMPLE_DIMENSION; y++) {
    const rowPixelOffset = y * PHASH_SAMPLE_DIMENSION
    const rowDctOffset = y * PHASH_DCT_DIMENSION
    for (let freqU = 0; freqU < PHASH_DCT_DIMENSION; freqU++) {
      const cosineRow = DCT_COSINE_TABLE[freqU]
      let weightedSum = 0
      for (let x = 0; x < PHASH_SAMPLE_DIMENSION; x++) {
        weightedSum += luminanceGrid[rowPixelOffset + x] * cosineRow[x]
      }
      horizontalDct[rowDctOffset + freqU] = weightedSum
    }
  }

  // Vertical pass across columns (32 -> 8 frequencies), skipping DC [0, 0]
  const acCoefficients = new Float64Array(PHASH_AC_BIT_COUNT)
  let acWriteIndex = 0
  for (let freqV = 0; freqV < PHASH_DCT_DIMENSION; freqV++) {
    const cosineCol = DCT_COSINE_TABLE[freqV]
    for (let freqU = 0; freqU < PHASH_DCT_DIMENSION; freqU++) {
      if (freqU === 0 && freqV === 0) continue
      let weightedSum = 0
      for (let y = 0; y < PHASH_SAMPLE_DIMENSION; y++) {
        weightedSum += horizontalDct[y * PHASH_DCT_DIMENSION + freqU] * cosineCol[y]
      }
      acCoefficients[acWriteIndex++] = weightedSum
    }
  }

  // Median threshold over the 63 AC coefficients splits bits evenly for natural photos
  const sortedCoefficients = Float64Array.from(acCoefficients).sort()
  const medianCoefficient = sortedCoefficients[Math.floor(PHASH_AC_BIT_COUNT / 2)]

  let hashHigh = 0
  let hashLow = 0
  for (let bitIndex = 0; bitIndex < PHASH_AC_BIT_COUNT; bitIndex++) {
    if (acCoefficients[bitIndex] > medianCoefficient) {
      if (bitIndex < 32) {
        hashLow = (hashLow | (1 << bitIndex)) >>> 0
      } else {
        hashHigh = (hashHigh | (1 << (bitIndex - 32))) >>> 0
      }
    }
  }

  return {
    hashHigh,
    hashLow,
    avgRed: Math.round(sumRed / pixelCount),
    avgGreen: Math.round(sumGreen / pixelCount),
    avgBlue: Math.round(sumBlue / pixelCount),
  }
}

/**
 * Computes a perceptual fingerprint from an already-decoded `ImageBitmap` by drawing onto a
 * reusable 32x32 scratch canvas. Designed to piggyback on `ThumbnailQueue` with zero extra decodes.
 */
export function computePerceptualFingerprintFromBitmap(
  bitmap: ImageBitmap,
): PerceptualFingerprint | null {
  const scratchCtx = getPhashScratchContext()
  if (!scratchCtx) return null

  scratchCtx.clearRect(0, 0, PHASH_SAMPLE_DIMENSION, PHASH_SAMPLE_DIMENSION)
  scratchCtx.drawImage(bitmap, 0, 0, PHASH_SAMPLE_DIMENSION, PHASH_SAMPLE_DIMENSION)
  const imageData = scratchCtx.getImageData(0, 0, PHASH_SAMPLE_DIMENSION, PHASH_SAMPLE_DIMENSION)
  return computePerceptualFingerprintFromRgba(
    imageData.data,
    PHASH_SAMPLE_DIMENSION,
    PHASH_SAMPLE_DIMENSION,
  )
}

function countSetBits32(unsignedInt: number): number {
  let bits = unsignedInt >>> 0
  bits = bits - ((bits >>> 1) & 0x55555555)
  bits = (bits & 0x33333333) + ((bits >>> 2) & 0x33333333)
  return (((bits + (bits >>> 4)) & 0x0f0f0f0f) * 0x01010101) >>> 24
}

export function computePerceptualHammingDistance(
  fingerprintA: PerceptualFingerprint,
  fingerprintB: PerceptualFingerprint,
): number {
  return (
    countSetBits32(fingerprintA.hashHigh ^ fingerprintB.hashHigh) +
    countSetBits32(fingerprintA.hashLow ^ fingerprintB.hashLow)
  )
}

/**
 * Determines whether two slides visually match at `similarityThresholdPercent` (75..99).
 * Combines structural 63-bit pHash similarity (75% weight) and average RGB similarity (25% weight)
 * with aspect-ratio and color-divergence guards to avoid false positives on unrelated scenes or solid colors.
 */
export function areSlidesPerceptuallySimilar(
  slideA: SlideDuplicateCandidate,
  slideB: SlideDuplicateCandidate,
  similarityThresholdPercent: number,
): boolean {
  const fingerprintA = slideA.perceptualFingerprint
  const fingerprintB = slideB.perceptualFingerprint
  if (!fingerprintA || !fingerprintB) return false

  const clampedThreshold = Math.max(
    DUPLICATE_THRESHOLD_MIN_PERCENT,
    Math.min(DUPLICATE_THRESHOLD_MAX_PERCENT, similarityThresholdPercent),
  )
  const allowedDivergenceRatio = (100 - clampedThreshold) / 100

  // Aspect-ratio guard: allows small crops as threshold lowers while blocking portrait-vs-landscape matches
  if (slideA.width > 0 && slideA.height > 0 && slideB.width > 0 && slideB.height > 0) {
    const aspectA = slideA.width / slideA.height
    const aspectB = slideB.width / slideB.height
    const aspectRatioSimilarity = Math.min(aspectA, aspectB) / Math.max(aspectA, aspectB)
    const minRequiredAspectSimilarity = Math.max(0.65, 1 - allowedDivergenceRatio * 1.5)
    if (aspectRatioSimilarity < minRequiredAspectSimilarity) return false
  }

  // Color-divergence guard: prevents flat or solid-color images of different hues from matching
  const rgbDistance = Math.hypot(
    fingerprintA.avgRed - fingerprintB.avgRed,
    fingerprintA.avgGreen - fingerprintB.avgGreen,
    fingerprintA.avgBlue - fingerprintB.avgBlue,
  )
  const colorSimilarity = 1 - rgbDistance / MAX_RGB_EUCLIDEAN_DISTANCE
  const minRequiredColorSimilarity = Math.max(0.6, 1 - allowedDivergenceRatio * 2.0)
  if (colorSimilarity < minRequiredColorSimilarity) return false

  const hammingDistance = computePerceptualHammingDistance(fingerprintA, fingerprintB)
  const structuralSimilarity = 1 - hammingDistance / PHASH_AC_BIT_COUNT

  // Ensure structural similarity itself is close to the requested threshold so color alone cannot force a match
  if (structuralSimilarity * 100 < clampedThreshold - 5) return false

  const combinedSimilarityPercent = (structuralSimilarity * 0.75 + colorSimilarity * 0.25) * 100
  return combinedSimilarityPercent >= clampedThreshold
}

export function formatSimilarityThresholdLabel(thresholdPercent: number): string {
  if (thresholdPercent >= 100) return 'Exact Only'
  if (thresholdPercent >= 95) return 'Strict'
  if (thresholdPercent >= 86) return 'Balanced'
  return 'Loose'
}

export function describeSimilarityThreshold(thresholdPercent: number): string {
  if (thresholdPercent >= 100) return 'Only byte-identical image files'
  if (thresholdPercent >= 95) return 'Exact copies, resizes & re-compressed saves'
  if (thresholdPercent >= 86) return 'Light edits, filters & slight crops'
  return 'Heavier edits & similar burst shots'
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
 * Chooses the best slide to keep inside a duplicate group:
 * 1. Always prefers the highest pixel resolution (`width * height`, with max-dimension tie-break).
 * 2. When pixel resolutions are identical, prefers the noticeably sharper image (delta >= 5),
 *    then the largest file byte size (less compression), and finally the earliest slide in timeline order.
 */
export function selectBestSlideIndexInGroup(
  slides: ReadonlyArray<SlideDuplicateCandidate>,
  memberIndices: number[],
): number {
  let bestIndex = memberIndices[0]

  for (let i = 1; i < memberIndices.length; i++) {
    const candidateIndex = memberIndices[i]
    const bestSlide = slides[bestIndex]
    const candidateSlide = slides[candidateIndex]

    const bestPixelArea = bestSlide.width * bestSlide.height
    const candidatePixelArea = candidateSlide.width * candidateSlide.height

    if (candidatePixelArea !== bestPixelArea) {
      if (candidatePixelArea > bestPixelArea) {
        bestIndex = candidateIndex
      }
      continue
    }

    const bestLongestSide = Math.max(bestSlide.width, bestSlide.height)
    const candidateLongestSide = Math.max(candidateSlide.width, candidateSlide.height)
    if (candidateLongestSide !== bestLongestSide) {
      if (candidateLongestSide > bestLongestSide) {
        bestIndex = candidateIndex
      }
      continue
    }

    const bestSharpness = bestSlide.sharpnessScore ?? null
    const candidateSharpness = candidateSlide.sharpnessScore ?? null
    if (
      bestSharpness !== null &&
      candidateSharpness !== null &&
      Math.abs(candidateSharpness - bestSharpness) >= EQUAL_RESOLUTION_SHARPNESS_TIEBREAK_DELTA
    ) {
      if (candidateSharpness > bestSharpness) {
        bestIndex = candidateIndex
      }
      continue
    }

    if (candidateSlide.size > bestSlide.size) {
      bestIndex = candidateIndex
    }
  }

  return bestIndex
}

function createEmptyDuplicateAnalysis(): DuplicateAnalysis {
  return {
    duplicateSlideIds: new Set<string>(),
    removableDuplicateIds: new Set<string>(),
    copyCountBySlideId: new Map<string, number>(),
    matchKindBySlideId: new Map<string, DuplicateMatchKind>(),
    removableCount: 0,
  }
}

/**
 * Identifies duplicate slide groups using exact SHA-256 content hashes (always when enabled)
 * and perceptual similarity matching (when `similarityThresholdPercent < 100`).
 * Keeps the highest-resolution copy in each group and marks all redundant copies for removal.
 */
export function analyzeSlideDuplicates(
  slides: ReadonlyArray<SlideDuplicateCandidate>,
  config: DuplicateDetectionConfig = {
    enabled: true,
    similarityThresholdPercent: DEFAULT_DUPLICATE_THRESHOLD_PERCENT,
  },
): DuplicateAnalysis {
  if (!config.enabled || slides.length < 2) {
    return createEmptyDuplicateAnalysis()
  }

  const slideCount = slides.length
  const parentIndices = Array.from({ length: slideCount }, (_, index) => index)

  const findRoot = (index: number): number => {
    let root = index
    while (parentIndices[root] !== root) {
      root = parentIndices[root]
    }
    let cursor = index
    while (cursor !== root) {
      const next = parentIndices[cursor]
      parentIndices[cursor] = root
      cursor = next
    }
    return root
  }

  const unionSlides = (indexA: number, indexB: number) => {
    const rootA = findRoot(indexA)
    const rootB = findRoot(indexB)
    if (rootA !== rootB) {
      parentIndices[rootB] = rootA
    }
  }

  const exactDuplicateIndices = new Set<number>()

  // Tier 1: Exact byte-identical matches via contentHash
  const firstIndexByContentHash = new Map<string, number>()
  for (let index = 0; index < slideCount; index++) {
    const contentHash = slides[index].contentHash
    if (!contentHash) continue
    const firstIndex = firstIndexByContentHash.get(contentHash)
    if (firstIndex !== undefined) {
      unionSlides(firstIndex, index)
      exactDuplicateIndices.add(firstIndex)
      exactDuplicateIndices.add(index)
    } else {
      firstIndexByContentHash.set(contentHash, index)
    }
  }

  // Tier 2: Perceptual similarity matches when threshold is below 100% (Exact Only)
  if (config.similarityThresholdPercent < DUPLICATE_THRESHOLD_MAX_PERCENT) {
    for (let indexA = 0; indexA < slideCount; indexA++) {
      const slideA = slides[indexA]
      if (!slideA.perceptualFingerprint) continue

      for (let indexB = indexA + 1; indexB < slideCount; indexB++) {
        if (findRoot(indexA) === findRoot(indexB)) continue
        const slideB = slides[indexB]
        if (!slideB.perceptualFingerprint) continue

        if (areSlidesPerceptuallySimilar(slideA, slideB, config.similarityThresholdPercent)) {
          unionSlides(indexA, indexB)
        }
      }
    }
  }

  const groupedMemberIndices = new Map<number, number[]>()
  for (let index = 0; index < slideCount; index++) {
    const root = findRoot(index)
    const members = groupedMemberIndices.get(root)
    if (members) {
      members.push(index)
    } else {
      groupedMemberIndices.set(root, [index])
    }
  }

  const duplicateSlideIds = new Set<string>()
  const removableDuplicateIds = new Set<string>()
  const copyCountBySlideId = new Map<string, number>()
  const matchKindBySlideId = new Map<string, DuplicateMatchKind>()

  for (const memberIndices of groupedMemberIndices.values()) {
    if (memberIndices.length < 2) continue

    const keptIndex = selectBestSlideIndexInGroup(slides, memberIndices)

    for (const memberIndex of memberIndices) {
      const slideId = slides[memberIndex].id
      duplicateSlideIds.add(slideId)
      copyCountBySlideId.set(slideId, memberIndices.length)
      matchKindBySlideId.set(slideId, exactDuplicateIndices.has(memberIndex) ? 'exact' : 'similar')

      if (memberIndex !== keptIndex) {
        removableDuplicateIds.add(slideId)
      }
    }
  }

  return {
    duplicateSlideIds,
    removableDuplicateIds,
    copyCountBySlideId,
    matchKindBySlideId,
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
