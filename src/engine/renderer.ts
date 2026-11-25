import type {
  ColorLook,
  ComputedTimeline,
  SlideImage,
  SmartEffectsConfig,
  TimelineSlide,
  TransitionType,
} from '../types/slideshow'

function easeInOutCubic(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2
}

function getColorFilter(look: ColorLook): string {
  switch (look) {
    case 'warm':
      return 'sepia(0.18) saturate(1.18) brightness(1.03)'
    case 'crisp':
      return 'contrast(1.12) saturate(1.14) brightness(1.02)'
    case 'vintage':
      return 'sepia(0.32) contrast(0.92) brightness(1.04) saturate(0.85)'
    case 'cinematic':
      return 'contrast(1.16) saturate(0.92) brightness(0.96)'
    case 'bw':
      return 'grayscale(1) contrast(1.14)'
    case 'none':
    default:
      return 'none'
  }
}

/**
 * Shared WYSIWYG Canvas 2D renderer used by BOTH the live Preview and the MP4/WebM Exporter.
 * Reuses two offscreen scratch canvases so there are zero per-frame allocations.
 */
export class SlideshowRenderer {
  private scratchA: HTMLCanvasElement
  private ctxA: CanvasRenderingContext2D
  private scratchB: HTMLCanvasElement
  private ctxB: CanvasRenderingContext2D
  private blurCanvas: HTMLCanvasElement
  private blurCtx: CanvasRenderingContext2D

  constructor() {
    this.scratchA = document.createElement('canvas')
    this.ctxA = this.scratchA.getContext('2d', { alpha: false })!
    this.scratchB = document.createElement('canvas')
    this.ctxB = this.scratchB.getContext('2d', { alpha: false })!
    // Small dedicated canvas for fast blurred backdrop generation
    this.blurCanvas = document.createElement('canvas')
    this.blurCanvas.width = 96
    this.blurCanvas.height = 96
    this.blurCtx = this.blurCanvas.getContext('2d', { alpha: false })!
  }

  private ensureSize(width: number, height: number) {
    if (this.scratchA.width !== width || this.scratchA.height !== height) {
      this.scratchA.width = width
      this.scratchA.height = height
      this.scratchB.width = width
      this.scratchB.height = height
    }
  }

  /**
   * Finds the active slide index for a given timestamp.
   */
  findSlideAtTime(timeline: ComputedTimeline, time: number): number {
    const slides = timeline.slides
    if (slides.length === 0) return -1
    if (time <= 0) return 0
    if (time >= timeline.totalDuration) return slides.length - 1

    // Binary search for fast lookup with hundreds of slides
    let lo = 0
    let hi = slides.length - 1
    while (lo <= hi) {
      const mid = (lo + hi) >> 1
      const s = slides[mid]
      if (time < s.startTime) {
        hi = mid - 1
      } else if (time >= s.endTime) {
        lo = mid + 1
      } else {
        return mid
      }
    }
    return Math.min(slides.length - 1, Math.max(0, lo))
  }

  /**
   * Renders a single frame at `time` (seconds) onto `ctx`.
   */
  renderFrame(
    ctx: CanvasRenderingContext2D,
    width: number,
    height: number,
    time: number,
    timeline: ComputedTimeline,
    slides: SlideImage[],
    getBitmap: (slideId: string) => ImageBitmap | null,
    effects: SmartEffectsConfig,
  ) {
    this.ensureSize(width, height)

    ctx.save()
    ctx.fillStyle = '#09090b'
    ctx.fillRect(0, 0, width, height)

    if (timeline.slides.length === 0) {
      ctx.restore()
      return
    }

    const idx = this.findSlideAtTime(timeline, time)
    if (idx < 0) {
      ctx.restore()
      return
    }

    const current = timeline.slides[idx]
    const currentSlide = slides[current.slideIndex]
    const currentBmp = currentSlide ? getBitmap(currentSlide.id) : null

    const localTime = Math.max(0, time - current.startTime)
    const inTransition =
      idx > 0 &&
      current.transitionIn !== 'cut' &&
      current.transitionInDuration > 0 &&
      localTime < current.transitionInDuration

    if (inTransition) {
      const prev = timeline.slides[idx - 1]
      const prevSlide = slides[prev.slideIndex]
      const prevBmp = prevSlide ? getBitmap(prevSlide.id) : null

      const prevProgress = Math.min(1, (time - prev.startTime) / Math.max(0.01, prev.duration))
      const currProgress = Math.min(1, localTime / Math.max(0.01, current.duration))

      this.drawSingleSlide(this.ctxA, width, height, prevBmp, prevSlide, prev, prevProgress, effects)
      this.drawSingleSlide(this.ctxB, width, height, currentBmp, currentSlide, current, currProgress, effects)

      const rawT = Math.max(0, Math.min(1, localTime / current.transitionInDuration))
      const t = easeInOutCubic(rawT)
      this.composeTransition(ctx, width, height, current.transitionIn, t)
    } else {
      const progress = Math.min(1, localTime / Math.max(0.01, current.duration))
      this.drawSingleSlide(ctx, width, height, currentBmp, currentSlide, current, progress, effects)
    }

    // Optional subtle cinematic vignette
    if (effects.vignette) {
      const cx = width / 2
      const cy = height / 2
      const rOuter = Math.hypot(cx, cy)
      const grad = ctx.createRadialGradient(cx, cy, rOuter * 0.42, cx, cy, rOuter)
      grad.addColorStop(0, 'rgba(0,0,0,0)')
      grad.addColorStop(1, 'rgba(0,0,0,0.48)')
      ctx.fillStyle = grad
      ctx.fillRect(0, 0, width, height)
    }

    ctx.restore()
  }

  private drawSingleSlide(
    ctx: CanvasRenderingContext2D,
    width: number,
    height: number,
    bmp: ImageBitmap | null,
    slide: SlideImage | undefined,
    tSlide: TimelineSlide,
    progress: number,
    effects: SmartEffectsConfig,
  ) {
    ctx.save()
    ctx.fillStyle = '#09090b'
    ctx.fillRect(0, 0, width, height)

    if (!bmp || !slide) {
      ctx.restore()
      return
    }

    const rotDeg = slide.rotation || 0
    const rotRad = (rotDeg * Math.PI) / 180
    const swapped = rotDeg === 90 || rotDeg === 270
    const imgW = swapped ? bmp.height : bmp.width
    const imgH = swapped ? bmp.width : bmp.height

    const colorFilter = getColorFilter(effects.colorLook)

    // Ken Burns smooth scale & pan
    let kbScale = 1
    let kbOffsetX = 0
    let kbOffsetY = 0
    if (effects.kenBurns) {
      const intensity = effects.kenBurnsIntensity
      const mode = tSlide.kenBurnsSeed % 4
      if (mode === 0) {
        // Gentle zoom in
        kbScale = 1 + intensity * progress
      } else if (mode === 1) {
        // Gentle zoom out
        kbScale = 1 + intensity * (1 - progress)
      } else if (mode === 2) {
        // Pan left to right while slightly zoomed
        kbScale = 1 + intensity
        kbOffsetX = (progress - 0.5) * width * intensity * 0.55
      } else {
        // Pan right to left while slightly zoomed
        kbScale = 1 + intensity
        kbOffsetX = (0.5 - progress) * width * intensity * 0.55
      }
      kbOffsetY = ((tSlide.kenBurnsSeed % 3) - 1) * height * intensity * 0.12 * (progress - 0.5)
    }

    // 1. Blurred Backdrop when fitMode === 'blur-fill' and aspect ratios differ noticeably
    const canvasAspect = width / height
    const imgAspect = imgW / imgH
    const needsBackdrop = effects.fitMode === 'blur-fill' && Math.abs(canvasAspect - imgAspect) > 0.04

    if (needsBackdrop) {
      // Draw downscaled to tiny blurCanvas first for super fast GPU blur
      const bw = this.blurCanvas.width
      const bh = this.blurCanvas.height
      this.blurCtx.save()
      this.blurCtx.fillStyle = '#09090b'
      this.blurCtx.fillRect(0, 0, bw, bh)
      this.blurCtx.translate(bw / 2, bh / 2)
      this.blurCtx.rotate(rotRad)
      const bgScale = Math.max(bw / imgW, bh / imgH) * 1.15
      const drawW = bmp.width * bgScale
      const drawH = bmp.height * bgScale
      this.blurCtx.drawImage(bmp, -drawW / 2, -drawH / 2, drawW, drawH)
      this.blurCtx.restore()

      ctx.save()
      ctx.filter = colorFilter !== 'none' ? `blur(24px) brightness(0.55) ${colorFilter}` : 'blur(24px) brightness(0.55)'
      // Overscan slightly so blurred edges never show black border
      const pad = 40
      ctx.drawImage(this.blurCanvas, -pad, -pad, width + pad * 2, height + pad * 2)
      ctx.restore()
    }

    // 2. Foreground photo
    ctx.save()
    if (colorFilter !== 'none') {
      ctx.filter = colorFilter
    }

    let baseScale: number
    if (effects.fitMode === 'cover') {
      baseScale = Math.max(width / imgW, height / imgH)
    } else {
      baseScale = Math.min(width / imgW, height / imgH)
    }

    const finalScale = baseScale * kbScale
    const drawW = bmp.width * finalScale
    const drawH = bmp.height * finalScale

    ctx.translate(width / 2 + kbOffsetX, height / 2 + kbOffsetY)
    ctx.rotate(rotRad)

    if (needsBackdrop) {
      ctx.shadowColor = 'rgba(0, 0, 0, 0.55)'
      ctx.shadowBlur = Math.max(16, Math.round(width * 0.02))
    }

    ctx.drawImage(bmp, -drawW / 2, -drawH / 2, drawW, drawH)
    ctx.restore()
    ctx.restore()
  }

  private composeTransition(
    ctx: CanvasRenderingContext2D,
    width: number,
    height: number,
    type: TransitionType,
    t: number,
  ) {
    ctx.save()
    switch (type) {
      case 'crossfade': {
        ctx.drawImage(this.scratchA, 0, 0)
        ctx.globalAlpha = t
        ctx.drawImage(this.scratchB, 0, 0)
        break
      }
      case 'slide-left': {
        ctx.drawImage(this.scratchA, 0, 0)
        ctx.drawImage(this.scratchB, width * (1 - t), 0)
        break
      }
      case 'slide-right': {
        ctx.drawImage(this.scratchA, 0, 0)
        ctx.drawImage(this.scratchB, -width * (1 - t), 0)
        break
      }
      case 'slide-up': {
        ctx.drawImage(this.scratchA, 0, 0)
        ctx.drawImage(this.scratchB, 0, height * (1 - t))
        break
      }
      case 'push-left': {
        ctx.drawImage(this.scratchA, -width * t, 0)
        ctx.drawImage(this.scratchB, width * (1 - t), 0)
        break
      }
      case 'zoom-in': {
        ctx.drawImage(this.scratchA, 0, 0)
        const s = 0.82 + 0.18 * t
        ctx.globalAlpha = t
        ctx.translate(width / 2, height / 2)
        ctx.scale(s, s)
        ctx.drawImage(this.scratchB, -width / 2, -height / 2)
        break
      }
      case 'zoom-out': {
        ctx.drawImage(this.scratchB, 0, 0)
        const s = 1 + 0.18 * t
        ctx.globalAlpha = 1 - t
        ctx.translate(width / 2, height / 2)
        ctx.scale(s, s)
        ctx.drawImage(this.scratchA, -width / 2, -height / 2)
        break
      }
      case 'blur-dissolve': {
        const blurAmt = Math.sin(t * Math.PI) * 14
        ctx.filter = `blur(${blurAmt.toFixed(1)}px)`
        ctx.drawImage(this.scratchA, 0, 0)
        ctx.globalAlpha = t
        ctx.drawImage(this.scratchB, 0, 0)
        break
      }
      case 'dip-black': {
        ctx.fillStyle = '#000000'
        ctx.fillRect(0, 0, width, height)
        if (t < 0.5) {
          ctx.globalAlpha = 1 - t * 2
          ctx.drawImage(this.scratchA, 0, 0)
        } else {
          ctx.globalAlpha = (t - 0.5) * 2
          ctx.drawImage(this.scratchB, 0, 0)
        }
        break
      }
      case 'wipe-left': {
        ctx.drawImage(this.scratchA, 0, 0)
        ctx.beginPath()
        ctx.rect(0, 0, width * t, height)
        ctx.clip()
        ctx.drawImage(this.scratchB, 0, 0)
        break
      }
      case 'cut':
      default: {
        ctx.drawImage(this.scratchB, 0, 0)
        break
      }
    }
    ctx.restore()
  }
}
