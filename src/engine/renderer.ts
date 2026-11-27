import { createRenderCanvas, getRenderContext, type RenderCanvas, type RenderContext } from './renderCanvas'
import type {
  ColorLook,
  ComputedTimeline,
  FitMode,
  SlideCropPosition,
  SlideImage,
  SlideRotationDegrees,
  SmartEffectsConfig,
  TimelineSlide,
  TransitionType,
} from '../types/slideshow'
import { findSlideIndexAtTime } from './timeline'
import { resolveSlideEffects } from './slideEffects'

const CANVAS_BACKGROUND_COLOR = '#09090b'
const BLUR_SCRATCH_DIMENSION_PX = 96
const ASPECT_MISMATCH_TOLERANCE = 0.04
const CROP_PAN_MIN_OVERFLOW_PX = 1
const CROP_CUSTOM_POSITION_EPSILON = 0.001

export const DEFAULT_SLIDE_CROP_POSITION: Readonly<SlideCropPosition> = {
  offsetX: 0,
  offsetY: 0,
}

export interface CoverCropGeometry {
  baseFitScale: number
  maxShiftX: number
  maxShiftY: number
  canPanX: boolean
  canPanY: boolean
  canPan: boolean
}

/**
 * Clamps a normalized crop axis offset to `[-1, 1]`, guarding against non-finite values.
 */
export function clampCropOffset(rawOffset: number): number {
  if (!Number.isFinite(rawOffset)) return 0
  return Math.max(-1, Math.min(1, rawOffset))
}

/**
 * Returns true when a slide's crop framing has been shifted away from center.
 */
export function hasCustomCropPosition(cropPosition: SlideCropPosition | undefined): boolean {
  if (!cropPosition) return false
  return (
    Math.abs(cropPosition.offsetX) > CROP_CUSTOM_POSITION_EPSILON ||
    Math.abs(cropPosition.offsetY) > CROP_CUSTOM_POSITION_EPSILON
  )
}

/**
 * Resolves effective image dimensions after applying quarter-turn (90° or 270°) rotation.
 */
export function computeOrientedImageDimensions(
  imageWidth: number,
  imageHeight: number,
  rotationDegrees: SlideRotationDegrees | number,
): { orientedWidth: number; orientedHeight: number } {
  const isQuarterTurnRotated = rotationDegrees === 90 || rotationDegrees === 270
  return {
    orientedWidth: isQuarterTurnRotated ? imageHeight : imageWidth,
    orientedHeight: isQuarterTurnRotated ? imageWidth : imageHeight,
  }
}

/**
 * Computes the base `cover` (Crop Fill) scale and maximum safe pan range along each axis
 * before exposing canvas edges. Shared between `SlideshowRenderer` and interactive preview dragging
 * so preview repositioning and final video export stay pixel-accurate.
 */
export function computeCoverCropGeometry(
  canvasWidth: number,
  canvasHeight: number,
  orientedImageWidth: number,
  orientedImageHeight: number,
): CoverCropGeometry {
  if (
    canvasWidth <= 0 ||
    canvasHeight <= 0 ||
    orientedImageWidth <= 0 ||
    orientedImageHeight <= 0
  ) {
    return {
      baseFitScale: 1,
      maxShiftX: 0,
      maxShiftY: 0,
      canPanX: false,
      canPanY: false,
      canPan: false,
    }
  }

  const baseFitScale = Math.max(
    canvasWidth / orientedImageWidth,
    canvasHeight / orientedImageHeight,
  )
  const maxShiftX = Math.max(0, (orientedImageWidth * baseFitScale - canvasWidth) / 2)
  const maxShiftY = Math.max(0, (orientedImageHeight * baseFitScale - canvasHeight) / 2)
  const canPanX = maxShiftX > CROP_PAN_MIN_OVERFLOW_PX
  const canPanY = maxShiftY > CROP_PAN_MIN_OVERFLOW_PX

  return {
    baseFitScale,
    maxShiftX,
    maxShiftY,
    canPanX,
    canPanY,
    canPan: canPanX || canPanY,
  }
}

/**
 * Computes the active Ken Burns zoom multiplier for a slide at `timeSeconds` so interactive
 * drag deltas in the preview canvas map 1:1 to on-screen image motion even when Ken Burns is active.
 */
export function computeEffectiveKenBurnsScale(
  timeline: ComputedTimeline,
  timelineIndex: number,
  timeSeconds: number,
  effects: SmartEffectsConfig,
): number {
  const timelineSlide = timeline.slides[timelineIndex]
  if (!timelineSlide || !effects.kenBurns) return 1
  const slideProgress = computeSlideMotionProgress(timeline, timelineIndex, timeSeconds)
  return computeKenBurnsTransform(timelineSlide.kenBurnsSeed, slideProgress, 1, 1, effects)
    .scaleMultiplier
}

/**
 * Converts a pointer drag delta (in canvas pixels) into an updated clamped `SlideCropPosition`.
 */
export function applyDragDeltaToCropPosition(params: {
  currentCropPosition: SlideCropPosition
  deltaCanvasX: number
  deltaCanvasY: number
  coverGeometry: CoverCropGeometry
  scaleMultiplier: number
}): SlideCropPosition {
  const { currentCropPosition, deltaCanvasX, deltaCanvasY, coverGeometry, scaleMultiplier } = params
  const effectiveScale = Math.max(1, scaleMultiplier)

  const nextOffsetX = coverGeometry.canPanX
    ? clampCropOffset(
        currentCropPosition.offsetX + deltaCanvasX / (coverGeometry.maxShiftX * effectiveScale),
      )
    : clampCropOffset(currentCropPosition.offsetX)

  const nextOffsetY = coverGeometry.canPanY
    ? clampCropOffset(
        currentCropPosition.offsetY + deltaCanvasY / (coverGeometry.maxShiftY * effectiveScale),
      )
    : clampCropOffset(currentCropPosition.offsetY)

  return {
    offsetX: nextOffsetX,
    offsetY: nextOffsetY,
  }
}

/**
 * Cubic ease-in-out curve (`[0, 1] -> [0, 1]`) for smooth, natural transition acceleration and deceleration.
 */
function easeInOutCubic(linearProgress: number): number {
  return linearProgress < 0.5
    ? 4 * linearProgress * linearProgress * linearProgress
    : 1 - Math.pow(-2 * linearProgress + 2, 3) / 2
}

/**
 * Declarative map of ColorLook presets to standard CSS canvas filter strings (Open/Closed Principle).
 */
const COLOR_LOOK_FILTERS: Record<ColorLook, string> = {
  none: 'none',
  warm: 'sepia(0.18) saturate(1.18) brightness(1.03)',
  crisp: 'contrast(1.12) saturate(1.14) brightness(1.02)',
  vintage: 'sepia(0.32) contrast(0.92) brightness(1.04) saturate(0.85)',
  cinematic: 'contrast(1.16) saturate(0.92) brightness(0.96)',
  bw: 'grayscale(1) contrast(1.14)',
}

/**
 * Computes normalized `[0, 1]` Ken Burns motion progress for the slide at `timelineIndex`
 * across its entire visible lifespan: from its own `startTime` (including its incoming transition)
 * through the end of the following slide's incoming transition (when this slide finishes exiting).
 * Spanning the outgoing transition keeps the outgoing slide moving at constant velocity instead of
 * freezing at `1.0` when `timeSeconds >= endTime`, while staying in `[0, 1]` so zoom-out and pan
 * transforms never underscale below `1.0` or expose frame edges.
 */
export function computeSlideMotionProgress(
  timeline: ComputedTimeline,
  timelineIndex: number,
  timeSeconds: number,
): number {
  const timelineSlide = timeline.slides[timelineIndex]
  if (!timelineSlide) return 0

  const nextTimelineSlide = timeline.slides[timelineIndex + 1]
  const visibleEndTimeSeconds =
    nextTimelineSlide &&
    nextTimelineSlide.transitionIn !== 'cut' &&
    nextTimelineSlide.transitionInDuration > 0
      ? Math.max(
          timelineSlide.endTime,
          nextTimelineSlide.startTime + nextTimelineSlide.transitionInDuration,
        )
      : timelineSlide.endTime

  const totalVisibleDurationSeconds = Math.max(
    0.01,
    visibleEndTimeSeconds - timelineSlide.startTime,
  )
  const elapsedVisibleSeconds = timeSeconds - timelineSlide.startTime

  return Math.max(0, Math.min(1, elapsedVisibleSeconds / totalVisibleDurationSeconds))
}

interface KenBurnsTransform {
  scaleMultiplier: number
  offsetX: number
  offsetY: number
}

/**
 * Computes a deterministic Ken Burns pan-and-zoom transform for a slide at `slideProgress` (`0..1`).
 * Cycles through 4 distinct camera trajectories based on `kenBurnsSeed` so consecutive slides
 * alternate motion direction naturally while remaining 100% reproducible between preview and export.
 */
function computeKenBurnsTransform(
  kenBurnsSeed: number,
  slideProgress: number,
  canvasWidth: number,
  canvasHeight: number,
  effects: SmartEffectsConfig,
): KenBurnsTransform {
  if (!effects.kenBurns) {
    return { scaleMultiplier: 1, offsetX: 0, offsetY: 0 }
  }

  const intensity = effects.kenBurnsIntensity
  const motionMode = kenBurnsSeed % 4
  let scaleMultiplier = 1
  let offsetX = 0

  if (motionMode === 0) {
    // Mode 0: Slow zoom in toward center
    scaleMultiplier = 1 + intensity * slideProgress
  } else if (motionMode === 1) {
    // Mode 1: Slow zoom out from pre-zoomed frame
    scaleMultiplier = 1 + intensity * (1 - slideProgress)
  } else if (motionMode === 2) {
    // Mode 2: Gentle pan from left to right while zoomed in
    scaleMultiplier = 1 + intensity
    offsetX = (slideProgress - 0.5) * canvasWidth * intensity * 0.55
  } else {
    // Mode 3: Gentle pan from right to left while zoomed in
    scaleMultiplier = 1 + intensity
    offsetX = (0.5 - slideProgress) * canvasWidth * intensity * 0.55
  }

  // Add subtle vertical drift (-1, 0, or +1 direction) for organic camera movement
  const verticalDirection = (kenBurnsSeed % 3) - 1
  const offsetY = verticalDirection * canvasHeight * intensity * 0.12 * (slideProgress - 0.5)

  return { scaleMultiplier, offsetX, offsetY }
}

/**
 * Determines whether a slide needs a blurred background fill because its aspect ratio
 * differs noticeably from the output video frame.
 */
function shouldRenderBlurredBackdrop(
  fitMode: FitMode,
  canvasWidth: number,
  canvasHeight: number,
  orientedImageWidth: number,
  orientedImageHeight: number,
): boolean {
  if (fitMode !== 'blur-fill') return false
  const canvasAspect = canvasWidth / canvasHeight
  const imageAspect = orientedImageWidth / orientedImageHeight
  return Math.abs(canvasAspect - imageAspect) > ASPECT_MISMATCH_TOLERANCE
}

type TransitionComposer = (
  targetCtx: RenderContext,
  outgoingCanvas: RenderCanvas,
  incomingCanvas: RenderCanvas,
  canvasWidth: number,
  canvasHeight: number,
  easedProgress: number,
) => void

/**
 * Strategy registry mapping each `TransitionType` to its canvas compositing implementation.
 * Following the Open/Closed Principle, new transitions can be added as declarative entries here.
 */
const TRANSITION_COMPOSERS: Record<TransitionType, TransitionComposer> = {
  cut: (targetCtx, _outgoing, incomingCanvas) => {
    targetCtx.drawImage(incomingCanvas, 0, 0)
  },

  crossfade: (targetCtx, outgoingCanvas, incomingCanvas, _w, _h, easedProgress) => {
    targetCtx.drawImage(outgoingCanvas, 0, 0)
    targetCtx.globalAlpha = easedProgress
    targetCtx.drawImage(incomingCanvas, 0, 0)
  },

  'slide-left': (targetCtx, outgoingCanvas, incomingCanvas, canvasWidth, _h, easedProgress) => {
    targetCtx.drawImage(outgoingCanvas, 0, 0)
    targetCtx.drawImage(incomingCanvas, canvasWidth * (1 - easedProgress), 0)
  },

  'slide-right': (targetCtx, outgoingCanvas, incomingCanvas, canvasWidth, _h, easedProgress) => {
    targetCtx.drawImage(outgoingCanvas, 0, 0)
    targetCtx.drawImage(incomingCanvas, -canvasWidth * (1 - easedProgress), 0)
  },

  'slide-up': (targetCtx, outgoingCanvas, incomingCanvas, _w, canvasHeight, easedProgress) => {
    targetCtx.drawImage(outgoingCanvas, 0, 0)
    targetCtx.drawImage(incomingCanvas, 0, canvasHeight * (1 - easedProgress))
  },

  'push-left': (targetCtx, outgoingCanvas, incomingCanvas, canvasWidth, _h, easedProgress) => {
    targetCtx.drawImage(outgoingCanvas, -canvasWidth * easedProgress, 0)
    targetCtx.drawImage(incomingCanvas, canvasWidth * (1 - easedProgress), 0)
  },

  'zoom-in': (
    targetCtx,
    outgoingCanvas,
    incomingCanvas,
    canvasWidth,
    canvasHeight,
    easedProgress,
  ) => {
    targetCtx.drawImage(outgoingCanvas, 0, 0)
    const incomingScale = 0.82 + 0.18 * easedProgress
    targetCtx.globalAlpha = easedProgress
    targetCtx.translate(canvasWidth / 2, canvasHeight / 2)
    targetCtx.scale(incomingScale, incomingScale)
    targetCtx.drawImage(incomingCanvas, -canvasWidth / 2, -canvasHeight / 2)
  },

  'zoom-out': (
    targetCtx,
    outgoingCanvas,
    incomingCanvas,
    canvasWidth,
    canvasHeight,
    easedProgress,
  ) => {
    targetCtx.drawImage(incomingCanvas, 0, 0)
    const outgoingScale = 1 + 0.18 * easedProgress
    targetCtx.globalAlpha = 1 - easedProgress
    targetCtx.translate(canvasWidth / 2, canvasHeight / 2)
    targetCtx.scale(outgoingScale, outgoingScale)
    targetCtx.drawImage(outgoingCanvas, -canvasWidth / 2, -canvasHeight / 2)
  },

  'blur-dissolve': (targetCtx, outgoingCanvas, incomingCanvas, _w, _h, easedProgress) => {
    // Peak blur occurs at transition midpoint (sin(pi * 0.5) = 1.0) and settles back to 0px at completion
    const blurRadiusPx = Math.sin(easedProgress * Math.PI) * 14
    targetCtx.filter = `blur(${blurRadiusPx.toFixed(1)}px)`
    targetCtx.drawImage(outgoingCanvas, 0, 0)
    targetCtx.globalAlpha = easedProgress
    targetCtx.drawImage(incomingCanvas, 0, 0)
  },

  'dip-black': (targetCtx, outgoingCanvas, incomingCanvas, canvasWidth, canvasHeight, easedProgress) => {
    targetCtx.fillStyle = '#000000'
    targetCtx.fillRect(0, 0, canvasWidth, canvasHeight)
    if (easedProgress < 0.5) {
      targetCtx.globalAlpha = 1 - easedProgress * 2
      targetCtx.drawImage(outgoingCanvas, 0, 0)
    } else {
      targetCtx.globalAlpha = (easedProgress - 0.5) * 2
      targetCtx.drawImage(incomingCanvas, 0, 0)
    }
  },

  'wipe-left': (
    targetCtx,
    outgoingCanvas,
    incomingCanvas,
    canvasWidth,
    canvasHeight,
    easedProgress,
  ) => {
    targetCtx.drawImage(outgoingCanvas, 0, 0)
    targetCtx.beginPath()
    targetCtx.rect(0, 0, canvasWidth * easedProgress, canvasHeight)
    targetCtx.clip()
    targetCtx.drawImage(incomingCanvas, 0, 0)
  },
}

/**
 * Shared WYSIWYG Canvas 2D renderer used by BOTH the live Preview and the MP4/WebM Exporter.
 * Pre-allocates two reusable scratch canvases and a downsampled blur canvas so rendering
 * performs zero per-frame DOM allocations.
 */
export class SlideshowRenderer {
  private outgoingScratchCanvas: RenderCanvas
  private outgoingScratchCtx: RenderContext
  private incomingScratchCanvas: RenderCanvas
  private incomingScratchCtx: RenderContext
  private vignetteCanvas = createRenderCanvas()
  private blurScratchCanvas: RenderCanvas
  private blurScratchCtx: RenderContext

  // Outside transitions the outgoing surface is free to hold the fully scaled backdrop.
  private backdropKey: { bitmap: ImageBitmap; rotation: number; filter: string } | null = null

  constructor() {
    this.vignetteCanvas.width = 0
    this.outgoingScratchCanvas = createRenderCanvas()
    this.outgoingScratchCtx = getRenderContext(this.outgoingScratchCanvas)
    this.incomingScratchCanvas = createRenderCanvas()
    this.incomingScratchCtx = getRenderContext(this.incomingScratchCanvas)

    this.blurScratchCanvas = createRenderCanvas()
    this.blurScratchCanvas.width = BLUR_SCRATCH_DIMENSION_PX
    this.blurScratchCanvas.height = BLUR_SCRATCH_DIMENSION_PX
    this.blurScratchCtx = getRenderContext(this.blurScratchCanvas)
  }

  private ensureScratchCanvasSize(width: number, height: number) {
    if (
      this.outgoingScratchCanvas.width !== width ||
      this.outgoingScratchCanvas.height !== height
    ) {
      this.backdropKey = null
      this.outgoingScratchCanvas.width = width
      this.outgoingScratchCanvas.height = height
      this.incomingScratchCanvas.width = width
      this.incomingScratchCanvas.height = height
    }
  }

  /**
   * Finds the active slide index for a given timestamp in O(log N) time.
   */
  findSlideAtTime(timeline: ComputedTimeline, timeSeconds: number): number {
    return findSlideIndexAtTime(timeline, timeSeconds)
  }

  /**
   * Renders one frame. Returns true when later timestamps on this slide have identical pixels
   * with the same inputs (no remaining transition or camera motion).
   */
  renderFrame(
    targetCtx: RenderContext,
    canvasWidth: number,
    canvasHeight: number,
    timeSeconds: number,
    timeline: ComputedTimeline,
    slides: SlideImage[],
    getBitmapById: (slideId: string) => ImageBitmap | null,
    effects: SmartEffectsConfig,
  ) {
    this.ensureScratchCanvasSize(canvasWidth, canvasHeight)

    targetCtx.save()
    targetCtx.fillStyle = CANVAS_BACKGROUND_COLOR
    targetCtx.fillRect(0, 0, canvasWidth, canvasHeight)

    const activeTimelineIndex = findSlideIndexAtTime(timeline, timeSeconds)
    if (activeTimelineIndex < 0) {
      targetCtx.restore()
      return false
    }

    const currentTimelineSlide = timeline.slides[activeTimelineIndex]
    const currentSlideImage = slides[currentTimelineSlide.slideIndex]
    const currentBitmap = currentSlideImage ? getBitmapById(currentSlideImage.id) : null
    // Per-slide overrides (framing, Ken Burns, color look, vignette) layered over the global settings
    const currentSlideEffects = resolveSlideEffects(currentSlideImage, effects)
    let vignetteOpacity = currentSlideEffects.vignette ? 1 : 0

    const elapsedInCurrentSlide = Math.max(0, timeSeconds - currentTimelineSlide.startTime)
    const isWithinIncomingTransition =
      activeTimelineIndex > 0 &&
      currentTimelineSlide.transitionIn !== 'cut' &&
      currentTimelineSlide.transitionInDuration > 0 &&
      elapsedInCurrentSlide < currentTimelineSlide.transitionInDuration

    if (isWithinIncomingTransition) {
      this.backdropKey = null
      const previousTimelineIndex = activeTimelineIndex - 1
      const previousTimelineSlide = timeline.slides[previousTimelineIndex]
      const previousSlideImage = slides[previousTimelineSlide.slideIndex]
      const previousBitmap = previousSlideImage ? getBitmapById(previousSlideImage.id) : null
      const previousSlideEffects = resolveSlideEffects(previousSlideImage, effects)

      const previousSlideProgress = computeSlideMotionProgress(
        timeline,
        previousTimelineIndex,
        timeSeconds,
      )
      const currentSlideProgress = computeSlideMotionProgress(
        timeline,
        activeTimelineIndex,
        timeSeconds,
      )

      this.drawSingleSlide(
        this.outgoingScratchCtx,
        canvasWidth,
        canvasHeight,
        previousBitmap,
        previousSlideImage,
        previousTimelineSlide,
        previousSlideProgress,
        previousSlideEffects,
      )
      this.drawSingleSlide(
        this.incomingScratchCtx,
        canvasWidth,
        canvasHeight,
        currentBitmap,
        currentSlideImage,
        currentTimelineSlide,
        currentSlideProgress,
        currentSlideEffects,
      )

      const linearTransitionProgress = Math.max(
        0,
        Math.min(1, elapsedInCurrentSlide / currentTimelineSlide.transitionInDuration),
      )
      const easedTransitionProgress = easeInOutCubic(linearTransitionProgress)

      this.composeTransition(
        targetCtx,
        canvasWidth,
        canvasHeight,
        currentTimelineSlide.transitionIn,
        easedTransitionProgress,
      )

      // The vignette stays a fixed frame-level overlay (it never slides/pushes with the photo),
      // so when only one side of a transition has it enabled we fade its strength across the transition.
      const previousVignetteOpacity = previousSlideEffects.vignette ? 1 : 0
      vignetteOpacity =
        previousVignetteOpacity + (vignetteOpacity - previousVignetteOpacity) * easedTransitionProgress
    } else {
      const currentSlideProgress = computeSlideMotionProgress(
        timeline,
        activeTimelineIndex,
        timeSeconds,
      )
      this.drawSingleSlide(
        targetCtx,
        canvasWidth,
        canvasHeight,
        currentBitmap,
        currentSlideImage,
        currentTimelineSlide,
        currentSlideProgress,
        currentSlideEffects,
        true,
      )
    }

    if (vignetteOpacity > 0) {
      this.renderVignetteOverlay(targetCtx, canvasWidth, canvasHeight, vignetteOpacity)
    }

    targetCtx.restore()
    return !!currentBitmap && !isWithinIncomingTransition && !currentSlideEffects.kenBurns
  }

  private drawSingleSlide(
    targetCtx: RenderContext,
    canvasWidth: number,
    canvasHeight: number,
    imageBitmap: ImageBitmap | null,
    slide: SlideImage | undefined,
    timelineSlide: TimelineSlide,
    slideProgress: number,
    effects: SmartEffectsConfig,
    cacheBackdrop = false,
  ) {
    targetCtx.save()
    targetCtx.fillStyle = CANVAS_BACKGROUND_COLOR
    targetCtx.fillRect(0, 0, canvasWidth, canvasHeight)

    if (!imageBitmap || !slide) {
      targetCtx.restore()
      return
    }

    const rotationDegrees = slide.rotation || 0
    const rotationRadians = (rotationDegrees * Math.PI) / 180
    // When rotated 90° or 270°, the image's effective horizontal and vertical dimensions swap
    const { orientedWidth: orientedImageWidth, orientedHeight: orientedImageHeight } =
      computeOrientedImageDimensions(imageBitmap.width, imageBitmap.height, rotationDegrees)

    const colorFilter = COLOR_LOOK_FILTERS[effects.colorLook] ?? 'none'
    const needsBackdrop = shouldRenderBlurredBackdrop(
      effects.fitMode,
      canvasWidth,
      canvasHeight,
      orientedImageWidth,
      orientedImageHeight,
    )

    if (needsBackdrop) {
      const cached = this.backdropKey
      if (
        !cacheBackdrop ||
        cached?.bitmap !== imageBitmap ||
        cached.rotation !== rotationRadians ||
        cached.filter !== colorFilter
      ) {
        this.renderBlurredBackdrop(
          cacheBackdrop ? this.outgoingScratchCtx : targetCtx,
          canvasWidth,
          canvasHeight,
          imageBitmap,
          orientedImageWidth,
          orientedImageHeight,
          rotationRadians,
          colorFilter,
        )
        if (cacheBackdrop) {
          this.backdropKey = { bitmap: imageBitmap, rotation: rotationRadians, filter: colorFilter }
        }
      }
      if (cacheBackdrop) targetCtx.drawImage(this.outgoingScratchCanvas, 0, 0)
    }

    const kenBurnsTransform = computeKenBurnsTransform(
      timelineSlide.kenBurnsSeed,
      slideProgress,
      canvasWidth,
      canvasHeight,
      effects,
    )

    this.renderForegroundPhoto(
      targetCtx,
      canvasWidth,
      canvasHeight,
      imageBitmap,
      orientedImageWidth,
      orientedImageHeight,
      rotationRadians,
      colorFilter,
      effects.fitMode,
      needsBackdrop,
      kenBurnsTransform,
      slide.cropPosition ?? DEFAULT_SLIDE_CROP_POSITION,
    )

    targetCtx.restore()
  }

  /**
   * Renders a soft, darkened blurred copy of the image to fill letterbox/pillarbox bars.
   * Optimization: blurs on a tiny 96x96 scratch canvas and upscales with high-quality bilinear
   * smoothing (~20x faster than applying a 24px Gaussian filter across a full 1080p/4K frame).
   */
  private renderBlurredBackdrop(
    targetCtx: RenderContext,
    canvasWidth: number,
    canvasHeight: number,
    imageBitmap: ImageBitmap,
    orientedImageWidth: number,
    orientedImageHeight: number,
    rotationRadians: number,
    colorFilter: string,
  ) {
    const scratchWidth = this.blurScratchCanvas.width
    const scratchHeight = this.blurScratchCanvas.height

    this.blurScratchCtx.save()
    this.blurScratchCtx.fillStyle = CANVAS_BACKGROUND_COLOR
    this.blurScratchCtx.fillRect(0, 0, scratchWidth, scratchHeight)
    this.blurScratchCtx.filter =
      colorFilter !== 'none'
        ? `blur(5px) brightness(0.55) ${colorFilter}`
        : 'blur(5px) brightness(0.55)'
    this.blurScratchCtx.translate(scratchWidth / 2, scratchHeight / 2)
    this.blurScratchCtx.rotate(rotationRadians)

    const backdropCoverScale =
      Math.max(scratchWidth / orientedImageWidth, scratchHeight / orientedImageHeight) * 1.25
    const scaledWidth = imageBitmap.width * backdropCoverScale
    const scaledHeight = imageBitmap.height * backdropCoverScale
    this.blurScratchCtx.drawImage(
      imageBitmap,
      -scaledWidth / 2,
      -scaledHeight / 2,
      scaledWidth,
      scaledHeight,
    )
    this.blurScratchCtx.restore()

    targetCtx.save()
    targetCtx.imageSmoothingEnabled = true
    targetCtx.imageSmoothingQuality = 'high'
    // Overscan by 6% so blurred edges never bleed dark vignette borders at the frame perimeter
    const overscanPaddingX = Math.round(canvasWidth * 0.06)
    const overscanPaddingY = Math.round(canvasHeight * 0.06)
    targetCtx.drawImage(
      this.blurScratchCanvas,
      -overscanPaddingX,
      -overscanPaddingY,
      canvasWidth + overscanPaddingX * 2,
      canvasHeight + overscanPaddingY * 2,
    )
    targetCtx.restore()
  }

  private renderForegroundPhoto(
    targetCtx: RenderContext,
    canvasWidth: number,
    canvasHeight: number,
    imageBitmap: ImageBitmap,
    orientedImageWidth: number,
    orientedImageHeight: number,
    rotationRadians: number,
    colorFilter: string,
    fitMode: FitMode,
    hasBlurredBackdrop: boolean,
    kenBurns: KenBurnsTransform,
    cropPosition: SlideCropPosition,
  ) {
    targetCtx.save()
    if (colorFilter !== 'none') {
      targetCtx.filter = colorFilter
    }

    const coverGeometry =
      fitMode === 'cover'
        ? computeCoverCropGeometry(
            canvasWidth,
            canvasHeight,
            orientedImageWidth,
            orientedImageHeight,
          )
        : null

    const baseFitScale = coverGeometry
      ? coverGeometry.baseFitScale
      : Math.min(canvasWidth / orientedImageWidth, canvasHeight / orientedImageHeight)

    const finalScale = baseFitScale * kenBurns.scaleMultiplier
    const drawWidth = imageBitmap.width * finalScale
    const drawHeight = imageBitmap.height * finalScale

    let translateOffsetX = kenBurns.offsetX
    let translateOffsetY = kenBurns.offsetY

    if (coverGeometry) {
      // Scale the user's crop shift by Ken Burns zoom so zooming stays centered on the user's chosen
      // focal point, then clamp combined crop + Ken Burns translation inside the scaled overflow bounds
      // so edge-aligned crops never expose empty background strips.
      const cropShiftX =
        clampCropOffset(cropPosition.offsetX) * coverGeometry.maxShiftX * kenBurns.scaleMultiplier
      const cropShiftY =
        clampCropOffset(cropPosition.offsetY) * coverGeometry.maxShiftY * kenBurns.scaleMultiplier
      const maxTotalOffsetX = Math.max(0, (orientedImageWidth * finalScale - canvasWidth) / 2)
      const maxTotalOffsetY = Math.max(0, (orientedImageHeight * finalScale - canvasHeight) / 2)

      translateOffsetX = Math.max(
        -maxTotalOffsetX,
        Math.min(maxTotalOffsetX, cropShiftX + kenBurns.offsetX),
      )
      translateOffsetY = Math.max(
        -maxTotalOffsetY,
        Math.min(maxTotalOffsetY, cropShiftY + kenBurns.offsetY),
      )
    }

    targetCtx.translate(canvasWidth / 2 + translateOffsetX, canvasHeight / 2 + translateOffsetY)
    targetCtx.rotate(rotationRadians)

    if (hasBlurredBackdrop) {
      targetCtx.shadowColor = 'rgba(0, 0, 0, 0.55)'
      targetCtx.shadowBlur = Math.max(16, Math.round(canvasWidth * 0.02))
    }

    targetCtx.drawImage(imageBitmap, -drawWidth / 2, -drawHeight / 2, drawWidth, drawHeight)
    targetCtx.restore()
  }

  private renderVignetteOverlay(
    targetCtx: RenderContext,
    canvasWidth: number,
    canvasHeight: number,
    opacity: number,
  ) {
    targetCtx.save()
    targetCtx.globalAlpha = Math.max(0, Math.min(1, opacity))
    if (this.vignetteCanvas.width !== canvasWidth || this.vignetteCanvas.height !== canvasHeight) {
      this.vignetteCanvas.width = canvasWidth
      this.vignetteCanvas.height = canvasHeight
      const overlayCtx = getRenderContext(this.vignetteCanvas, true)
      const centerX = canvasWidth / 2
      const centerY = canvasHeight / 2
      const cornerRadius = Math.hypot(centerX, centerY)
      const radialGradient = overlayCtx.createRadialGradient(
        centerX,
        centerY,
        cornerRadius * 0.42,
        centerX,
        centerY,
        cornerRadius,
      )
      radialGradient.addColorStop(0, 'rgba(0,0,0,0)')
      radialGradient.addColorStop(1, 'rgba(0,0,0,0.48)')
      overlayCtx.fillStyle = radialGradient
      overlayCtx.fillRect(0, 0, canvasWidth, canvasHeight)
    }
    targetCtx.drawImage(this.vignetteCanvas, 0, 0)
    targetCtx.restore()
  }

  private composeTransition(
    targetCtx: RenderContext,
    canvasWidth: number,
    canvasHeight: number,
    transitionType: TransitionType,
    easedProgress: number,
  ) {
    targetCtx.save()
    const composer = TRANSITION_COMPOSERS[transitionType] ?? TRANSITION_COMPOSERS.cut
    composer(
      targetCtx,
      this.outgoingScratchCanvas,
      this.incomingScratchCanvas,
      canvasWidth,
      canvasHeight,
      easedProgress,
    )
    targetCtx.restore()
  }
}
