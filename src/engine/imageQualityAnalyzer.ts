import type {
  ImageQualityAnalysis,
  ImageQualityIssue,
  OutputConfig,
  SlideImage,
  SlideQualityAssessment,
  SmartEffectsConfig,
} from '../types/slideshow'

/**
 * Maximum longest-side dimension used when sampling an ImageBitmap for sharpness analysis.
 * Keeps per-image CPU cost around ~2–4ms while preserving enough resolution to detect
 * real optical defocus, motion blur, and upscaled low-res saves.
 */
const QUALITY_ANALYSIS_MAX_DIMENSION_PX = 640
const MIN_ANALYZABLE_DIMENSION_PX = 32
const SHARPNESS_TILE_GRID_SIZE = 8

/**
 * A slide scaled linearly by 1.45x or more (less than ~48% pixel density relative to the rendered
 * foreground size) will look noticeably soft or pixelated at the selected output resolution.
 */
export const LOW_RES_UPSCALE_THRESHOLD = 1.45

/**
 * Base normalized sharpness threshold (0–100 scale) below which an image is considered blurry
 * at native 1:1 output scale. Sharp camera photos, bokeh portraits, low-contrast scenes, and
 * high-ISO sharp photos typically score 75–100; visibly out-of-focus or motion-blurred photos
 * fall below 40.
 */
export const BASE_BLUR_SHARPNESS_THRESHOLD = 40
const MAX_UPSCALE_ADJUSTED_BLUR_THRESHOLD = 52
const UPSCALE_BLUR_SENSITIVITY_WEIGHT = 24

/**
 * Minimum 4x-downsampled peak Sobel edge strength required for a tile to participate in sharpness
 * scoring. Prevents flat skies, smooth gradients, or solid-color slides from being flagged as blurry.
 */
const MIN_TILE_PEAK_COARSE_GRADIENT = 10.0
const MIN_DIRECTIONAL_PEAK_COARSE_GRADIENT = 8.0

/** Mapping range from raw multi-scale peak Sobel ratio to the 0–100 sharpness score. */
const RAW_SHARPNESS_FLOOR = 0.25
const RAW_SHARPNESS_SPAN = 0.80

type SlideResolutionCandidate = Pick<
  SlideImage,
  'id' | 'width' | 'height' | 'rotation' | 'sharpnessScore'
>
type OutputDimensionConfig = Pick<OutputConfig, 'width' | 'height'>
type FramingEffectsConfig = Pick<
  SmartEffectsConfig,
  'fitMode' | 'kenBurns' | 'kenBurnsIntensity'
>

let sharedQualityScratchCanvas: HTMLCanvasElement | null = null
let sharedQualityScratchCtx: CanvasRenderingContext2D | null = null

function getQualityScratchContext(
  targetWidth: number,
  targetHeight: number,
): CanvasRenderingContext2D | null {
  if (typeof document === 'undefined') return null
  if (!sharedQualityScratchCanvas) {
    sharedQualityScratchCanvas = document.createElement('canvas')
    sharedQualityScratchCtx = sharedQualityScratchCanvas.getContext('2d', {
      willReadFrequently: true,
    })
  }
  if (!sharedQualityScratchCtx) return null

  if (
    sharedQualityScratchCanvas.width !== targetWidth ||
    sharedQualityScratchCanvas.height !== targetHeight
  ) {
    sharedQualityScratchCanvas.width = targetWidth
    sharedQualityScratchCanvas.height = targetHeight
  }
  sharedQualityScratchCtx.imageSmoothingEnabled = true
  sharedQualityScratchCtx.imageSmoothingQuality = 'high'
  return sharedQualityScratchCtx
}

function downsampleLumaByTwo(
  sourceLuma: Float32Array,
  sourceWidth: number,
  sourceHeight: number,
): { luma: Float32Array; width: number; height: number } {
  const targetWidth = Math.floor(sourceWidth / 2)
  const targetHeight = Math.floor(sourceHeight / 2)
  const downsampled = new Float32Array(targetWidth * targetHeight)

  for (let y = 0; y < targetHeight; y++) {
    const srcRowTop = y * 2 * sourceWidth
    const srcRowBottom = srcRowTop + sourceWidth
    const dstRow = y * targetWidth
    for (let x = 0; x < targetWidth; x++) {
      const srcX = x * 2
      downsampled[dstRow + x] =
        0.25 *
        (sourceLuma[srcRowTop + srcX] +
          sourceLuma[srcRowTop + srcX + 1] +
          sourceLuma[srcRowBottom + srcX] +
          sourceLuma[srcRowBottom + srcX + 1])
    }
  }

  return { luma: downsampled, width: targetWidth, height: targetHeight }
}

/**
 * Estimates per-pixel sensor noise standard deviation using Immerkaer's fast 3x3 high-pass mask.
 * Subtracting this noise floor prevents grainy high-ISO blurry shots from masquerading as sharp.
 */
function estimateSensorNoiseSigma(
  luma: Float32Array,
  width: number,
  height: number,
): number {
  let absoluteResponseSum = 0
  let sampleCount = 0

  for (let y = 1; y < height - 1; y += 2) {
    const rowPrev = (y - 1) * width
    const rowCurr = y * width
    const rowNext = (y + 1) * width
    for (let x = 1; x < width - 1; x += 2) {
      const highPassResponse = Math.abs(
        luma[rowPrev + x - 1] -
          2 * luma[rowPrev + x] +
          luma[rowPrev + x + 1] -
          2 * luma[rowCurr + x - 1] +
          4 * luma[rowCurr + x] -
          2 * luma[rowCurr + x + 1] +
          luma[rowNext + x - 1] -
          2 * luma[rowNext + x] +
          luma[rowNext + x + 1],
      )
      absoluteResponseSum += highPassResponse
      sampleCount++
    }
  }

  if (sampleCount === 0) return 0
  return (absoluteResponseSum / sampleCount) * (Math.sqrt(Math.PI / 2) / 6)
}

/**
 * Computes a contrast-invariant, edge-sparsity-invariant, bokeh-safe, noise-compensated sharpness
 * score (0–100) from RGBA pixels.
 *
 * Algorithm:
 * 1. Compares top peak 3x3 Sobel edge magnitudes at native (1x) scale against top peak Sobel edge
 *    magnitudes at 4x-downsampled coarse scale across an 8x8 tile grid. Using peak magnitudes rather
 *    than tile means eliminates both contrast bias and sparse-edge bias (e.g. a crisp silhouette or
 *    geometric pattern on a clean background).
 * 2. Subtracts an Immerkaer-estimated noise floor so grainy high-ISO blurry shots cannot mimic sharp
 *    edges, while preserving sharp high-ISO photos.
 * 3. Evaluates only tiles containing meaningful coarse structure and averages the top 20% sharpest
 *    tiles so shallow depth-of-field portraits (creamy bokeh backgrounds) are NOT falsely flagged.
 * 4. Blends combined peak ratio (45%) with the weaker directional axis (55%) when both axes have
 *    coarse edges so 1D camera-shake motion blur is also detected.
 *
 * Returns `null` for tiny images or completely featureless frames (e.g. solid color / smooth sky).
 */
export function computeSharpnessScoreFromRgba(
  rgbaPixels: Uint8ClampedArray,
  sampleWidth: number,
  sampleHeight: number,
): number | null {
  if (sampleWidth < MIN_ANALYZABLE_DIMENSION_PX || sampleHeight < MIN_ANALYZABLE_DIMENSION_PX) {
    return null
  }

  const pixelCount = sampleWidth * sampleHeight
  const luma = new Float32Array(pixelCount)
  for (let pixelIndex = 0; pixelIndex < pixelCount; pixelIndex++) {
    const channelOffset = pixelIndex * 4
    // Rec. 601 luminance weights
    luma[pixelIndex] =
      0.299 * rgbaPixels[channelOffset] +
      0.587 * rgbaPixels[channelOffset + 1] +
      0.114 * rgbaPixels[channelOffset + 2]
  }

  const estimatedNoiseSigma = estimateSensorNoiseSigma(luma, sampleWidth, sampleHeight)
  const sobelNoiseFloor = estimatedNoiseSigma * 2.5

  const halfScale = downsampleLumaByTwo(luma, sampleWidth, sampleHeight)
  const quarterScale = downsampleLumaByTwo(halfScale.luma, halfScale.width, halfScale.height)
  if (quarterScale.width < 4 || quarterScale.height < 4) return null

  const tileWidth = Math.floor(sampleWidth / SHARPNESS_TILE_GRID_SIZE)
  const tileHeight = Math.floor(sampleHeight / SHARPNESS_TILE_GRID_SIZE)
  const activeTileRatios: number[] = []

  for (let tileY = 0; tileY < SHARPNESS_TILE_GRID_SIZE; tileY++) {
    for (let tileX = 0; tileX < SHARPNESS_TILE_GRID_SIZE; tileX++) {
      const fineStartX = Math.max(1, tileX * tileWidth)
      const fineStartY = Math.max(1, tileY * tileHeight)
      const fineEndX = Math.min(sampleWidth - 1, (tileX + 1) * tileWidth)
      const fineEndY = Math.min(sampleHeight - 1, (tileY + 1) * tileHeight)

      // Track top-4 Sobel magnitudes per axis to stay robust against single-pixel hot/noise outliers
      let topFineX1 = 0
      let topFineX2 = 0
      let topFineX3 = 0
      let topFineX4 = 0
      let topFineY1 = 0
      let topFineY2 = 0
      let topFineY3 = 0
      let topFineY4 = 0

      for (let y = fineStartY; y < fineEndY; y++) {
        const rowPrev = (y - 1) * sampleWidth
        const rowCurr = y * sampleWidth
        const rowNext = (y + 1) * sampleWidth
        for (let x = fineStartX; x < fineEndX; x++) {
          const sobelX = Math.max(
            0,
            Math.abs(
              -luma[rowPrev + x - 1] +
                luma[rowPrev + x + 1] -
                2 * luma[rowCurr + x - 1] +
                2 * luma[rowCurr + x + 1] -
                luma[rowNext + x - 1] +
                luma[rowNext + x + 1],
            ) *
              0.25 -
              sobelNoiseFloor,
          )
          const sobelY = Math.max(
            0,
            Math.abs(
              -luma[rowPrev + x - 1] -
                2 * luma[rowPrev + x] -
                luma[rowPrev + x + 1] +
                luma[rowNext + x - 1] +
                2 * luma[rowNext + x] +
                luma[rowNext + x + 1],
            ) *
              0.25 -
              sobelNoiseFloor,
          )

          if (sobelX > topFineX4) {
            if (sobelX > topFineX1) {
              topFineX4 = topFineX3
              topFineX3 = topFineX2
              topFineX2 = topFineX1
              topFineX1 = sobelX
            } else if (sobelX > topFineX2) {
              topFineX4 = topFineX3
              topFineX3 = topFineX2
              topFineX2 = sobelX
            } else if (sobelX > topFineX3) {
              topFineX4 = topFineX3
              topFineX3 = sobelX
            } else {
              topFineX4 = sobelX
            }
          }

          if (sobelY > topFineY4) {
            if (sobelY > topFineY1) {
              topFineY4 = topFineY3
              topFineY3 = topFineY2
              topFineY2 = topFineY1
              topFineY1 = sobelY
            } else if (sobelY > topFineY2) {
              topFineY4 = topFineY3
              topFineY3 = topFineY2
              topFineY2 = sobelY
            } else if (sobelY > topFineY3) {
              topFineY4 = topFineY3
              topFineY3 = sobelY
            } else {
              topFineY4 = sobelY
            }
          }
        }
      }

      const peakFineX = (topFineX1 + topFineX2 + topFineX3 + topFineX4) * 0.25
      const peakFineY = (topFineY1 + topFineY2 + topFineY3 + topFineY4) * 0.25

      const coarseStartX = Math.max(1, Math.floor(fineStartX / 4))
      const coarseStartY = Math.max(1, Math.floor(fineStartY / 4))
      const coarseEndX = Math.min(quarterScale.width - 1, Math.floor(fineEndX / 4))
      const coarseEndY = Math.min(quarterScale.height - 1, Math.floor(fineEndY / 4))

      let topCoarseX1 = 0
      let topCoarseX2 = 0
      let topCoarseY1 = 0
      let topCoarseY2 = 0

      for (let y = coarseStartY; y < coarseEndY; y++) {
        const rowPrev = (y - 1) * quarterScale.width
        const rowCurr = y * quarterScale.width
        const rowNext = (y + 1) * quarterScale.width
        for (let x = coarseStartX; x < coarseEndX; x++) {
          const coarseSobelX =
            Math.abs(
              -quarterScale.luma[rowPrev + x - 1] +
                quarterScale.luma[rowPrev + x + 1] -
                2 * quarterScale.luma[rowCurr + x - 1] +
                2 * quarterScale.luma[rowCurr + x + 1] -
                quarterScale.luma[rowNext + x - 1] +
                quarterScale.luma[rowNext + x + 1],
            ) * 0.25
          const coarseSobelY =
            Math.abs(
              -quarterScale.luma[rowPrev + x - 1] -
                2 * quarterScale.luma[rowPrev + x] -
                quarterScale.luma[rowPrev + x + 1] +
                quarterScale.luma[rowNext + x - 1] +
                2 * quarterScale.luma[rowNext + x] +
                quarterScale.luma[rowNext + x + 1],
            ) * 0.25

          if (coarseSobelX > topCoarseX2) {
            if (coarseSobelX > topCoarseX1) {
              topCoarseX2 = topCoarseX1
              topCoarseX1 = coarseSobelX
            } else {
              topCoarseX2 = coarseSobelX
            }
          }

          if (coarseSobelY > topCoarseY2) {
            if (coarseSobelY > topCoarseY1) {
              topCoarseY2 = topCoarseY1
              topCoarseY1 = coarseSobelY
            } else {
              topCoarseY2 = coarseSobelY
            }
          }
        }
      }

      const peakCoarseX = (topCoarseX1 + topCoarseX2) * 0.5
      const peakCoarseY = (topCoarseY1 + topCoarseY2) * 0.5
      const maxCoarsePeak = Math.max(peakCoarseX, peakCoarseY)

      if (maxCoarsePeak > MIN_TILE_PEAK_COARSE_GRADIENT) {
        const combinedRatio = (peakFineX + peakFineY) / (peakCoarseX + peakCoarseY + 1e-6)
        const hasStrongX = peakCoarseX > MIN_DIRECTIONAL_PEAK_COARSE_GRADIENT
        const hasStrongY = peakCoarseY > MIN_DIRECTIONAL_PEAK_COARSE_GRADIENT
        if (hasStrongX && hasStrongY) {
          const weakestAxisRatio = Math.min(peakFineX / peakCoarseX, peakFineY / peakCoarseY)
          activeTileRatios.push(combinedRatio * 0.45 + weakestAxisRatio * 0.55)
        } else {
          activeTileRatios.push(combinedRatio)
        }
      }
    }
  }

  if (activeTileRatios.length === 0) return null

  activeTileRatios.sort((first, second) => second - first)
  const topTileCount = Math.max(1, Math.ceil(activeTileRatios.length * 0.2))
  let topRatioSum = 0
  for (let index = 0; index < topTileCount; index++) {
    topRatioSum += activeTileRatios[index]
  }
  const topMeanRatio = topRatioSum / topTileCount

  return Math.max(
    0,
    Math.min(100, Math.round(((topMeanRatio - RAW_SHARPNESS_FLOOR) / RAW_SHARPNESS_SPAN) * 100)),
  )
}

/**
 * Computes a sharpness score from an already-decoded `ImageBitmap` on a reusable scratch canvas.
 * Designed to piggyback on `ThumbnailQueue` with zero additional image decodes.
 */
export function computeSharpnessScoreFromBitmap(bitmap: ImageBitmap): number | null {
  const longestSide = Math.max(bitmap.width, bitmap.height)
  if (longestSide < MIN_ANALYZABLE_DIMENSION_PX) return null

  const downscaleFactor = Math.min(1, QUALITY_ANALYSIS_MAX_DIMENSION_PX / longestSide)
  const sampleWidth = Math.max(1, Math.round(bitmap.width * downscaleFactor))
  const sampleHeight = Math.max(1, Math.round(bitmap.height * downscaleFactor))
  if (sampleWidth < MIN_ANALYZABLE_DIMENSION_PX || sampleHeight < MIN_ANALYZABLE_DIMENSION_PX) {
    return null
  }

  const scratchCtx = getQualityScratchContext(sampleWidth, sampleHeight)
  if (!scratchCtx) return null

  scratchCtx.clearRect(0, 0, sampleWidth, sampleHeight)
  scratchCtx.drawImage(bitmap, 0, 0, sampleWidth, sampleHeight)
  const imageData = scratchCtx.getImageData(0, 0, sampleWidth, sampleHeight)
  return computeSharpnessScoreFromRgba(imageData.data, sampleWidth, sampleHeight)
}

/**
 * Computes the exact peak linear upscale factor applied to a slide when rendered onto the current
 * output canvas, mirroring `SlideshowRenderer.renderForegroundPhoto()` (rotation swap, fit mode,
 * and Ken Burns maximum zoom).
 */
export function computeEffectiveUpscaleFactor(
  slide: Pick<SlideImage, 'width' | 'height' | 'rotation'>,
  output: OutputDimensionConfig,
  effects: FramingEffectsConfig,
): number {
  if (slide.width <= 0 || slide.height <= 0 || output.width <= 0 || output.height <= 0) {
    return 0
  }

  const isQuarterTurnRotated = slide.rotation === 90 || slide.rotation === 270
  const orientedWidth = isQuarterTurnRotated ? slide.height : slide.width
  const orientedHeight = isQuarterTurnRotated ? slide.width : slide.height

  const baseFitScale =
    effects.fitMode === 'cover'
      ? Math.max(output.width / orientedWidth, output.height / orientedHeight)
      : Math.min(output.width / orientedWidth, output.height / orientedHeight)

  const kenBurnsPeakZoom = effects.kenBurns ? 1 + effects.kenBurnsIntensity : 1
  return baseFitScale * kenBurnsPeakZoom
}

/**
 * Tightens the blur sharpness threshold slightly when an image is being upscaled for output,
 * because enlarging a marginally soft photo makes optical blur visibly worse in the rendered video.
 */
export function computeEffectiveBlurThreshold(effectiveUpscaleFactor: number): number {
  const upscalePenalty = Math.max(0, effectiveUpscaleFactor - 1) * UPSCALE_BLUR_SENSITIVITY_WEIGHT
  return Math.min(MAX_UPSCALE_ADJUSTED_BLUR_THRESHOLD, BASE_BLUR_SHARPNESS_THRESHOLD + upscalePenalty)
}

export function assessSlideQuality(
  slide: SlideResolutionCandidate,
  output: OutputDimensionConfig,
  effects: FramingEffectsConfig,
): SlideQualityAssessment {
  const effectiveUpscaleFactor = computeEffectiveUpscaleFactor(slide, output, effects)
  const isLowRes = effectiveUpscaleFactor >= LOW_RES_UPSCALE_THRESHOLD

  const blurThreshold = computeEffectiveBlurThreshold(effectiveUpscaleFactor)
  const isBlurry = slide.sharpnessScore !== null && slide.sharpnessScore < blurThreshold

  const issues: ImageQualityIssue[] = []
  if (isLowRes) issues.push('low-res')
  if (isBlurry) issues.push('blurry')

  return {
    slideId: slide.id,
    isLowRes,
    isBlurry,
    issues,
    effectiveUpscaleFactor,
    sharpnessScore: slide.sharpnessScore,
  }
}

/**
 * Analyzes all slides against the current render output resolution, framing mode, and Ken Burns zoom.
 */
export function analyzeSlidesQuality(
  slides: ReadonlyArray<SlideResolutionCandidate>,
  output: OutputDimensionConfig,
  effects: FramingEffectsConfig,
): ImageQualityAnalysis {
  const flaggedSlideIds = new Set<string>()
  const assessmentBySlideId = new Map<string, SlideQualityAssessment>()
  let lowResCount = 0
  let blurryCount = 0

  for (const slide of slides) {
    const assessment = assessSlideQuality(slide, output, effects)
    assessmentBySlideId.set(slide.id, assessment)

    if (assessment.issues.length > 0) {
      flaggedSlideIds.add(slide.id)
      if (assessment.isLowRes) lowResCount++
      if (assessment.isBlurry) blurryCount++
    }
  }

  return {
    flaggedSlideIds,
    assessmentBySlideId,
    flaggedCount: flaggedSlideIds.size,
    lowResCount,
    blurryCount,
  }
}

export function formatQualityIssueBadgeLabel(assessment: SlideQualityAssessment): string {
  if (assessment.isLowRes && assessment.isBlurry) return 'Low+Blur'
  if (assessment.isLowRes) return 'Low Res'
  if (assessment.isBlurry) return 'Blurry'
  return ''
}

export function describeSlideQualityIssues(
  slide: Pick<SlideImage, 'width' | 'height'>,
  assessment: SlideQualityAssessment,
  output: OutputDimensionConfig,
): string {
  const reasons: string[] = []
  if (assessment.isLowRes) {
    reasons.push(
      `Low resolution (${slide.width}×${slide.height}, stretched ${assessment.effectiveUpscaleFactor.toFixed(1)}× for ${output.width}×${output.height} output)`,
    )
  }
  if (assessment.isBlurry) {
    const sharpnessDetail =
      assessment.sharpnessScore !== null ? ` (sharpness ${assessment.sharpnessScore}/100)` : ''
    reasons.push(`Blurry / soft focus${sharpnessDetail}`)
  }
  return reasons.join(' · ')
}
