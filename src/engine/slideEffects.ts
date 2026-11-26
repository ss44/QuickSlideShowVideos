import type {
  ColorLook,
  FitMode,
  SlideEffectOverrides,
  SlideImage,
  SmartEffectsConfig,
} from '../types/slideshow'
import { COLOR_LOOK_OPTIONS, FIT_MODE_OPTIONS } from '../types/slideshow'

const VALID_FIT_MODES = new Set<FitMode>(FIT_MODE_OPTIONS.map((option) => option.id))
const VALID_COLOR_LOOKS = new Set<ColorLook>(COLOR_LOOK_OPTIONS.map((option) => option.id))

const FIT_MODE_LABELS: Record<FitMode, string> = Object.fromEntries(
  FIT_MODE_OPTIONS.map((option) => [option.id, option.label]),
) as Record<FitMode, string>

const FIT_MODE_SHORT_BADGE_LABELS: Record<FitMode, string> = {
  'blur-fill': 'Blur',
  cover: 'Crop',
  contain: 'Bars',
}

const COLOR_LOOK_LABELS: Record<ColorLook, string> = Object.fromEntries(
  COLOR_LOOK_OPTIONS.map((option) => [option.id, option.label]),
) as Record<ColorLook, string>

/**
 * Validates and clones a raw `SlideEffectOverrides` object into a plain structured-cloneable object,
 * stripping unknown values and undefined keys so IndexedDB persistence and state comparisons stay clean.
 */
export function sanitizeSlideEffectOverrides(
  rawOverrides: SlideEffectOverrides | undefined | null,
): SlideEffectOverrides {
  if (!rawOverrides || typeof rawOverrides !== 'object') {
    return {}
  }

  const sanitized: SlideEffectOverrides = {}

  if (rawOverrides.fitMode !== undefined && VALID_FIT_MODES.has(rawOverrides.fitMode)) {
    sanitized.fitMode = rawOverrides.fitMode
  }
  if (typeof rawOverrides.kenBurns === 'boolean') {
    sanitized.kenBurns = rawOverrides.kenBurns
  }
  if (rawOverrides.colorLook !== undefined && VALID_COLOR_LOOKS.has(rawOverrides.colorLook)) {
    sanitized.colorLook = rawOverrides.colorLook
  }
  if (typeof rawOverrides.vignette === 'boolean') {
    sanitized.vignette = rawOverrides.vignette
  }

  return sanitized
}

/**
 * Counts how many per-slide effect properties are explicitly overridden.
 */
export function countSlideEffectOverrides(
  overrides: SlideEffectOverrides | undefined | null,
): number {
  if (!overrides) return 0
  let count = 0
  if (overrides.fitMode !== undefined) count++
  if (overrides.kenBurns !== undefined) count++
  if (overrides.colorLook !== undefined) count++
  if (overrides.vignette !== undefined) count++
  return count
}

/**
 * Returns true when at least one effect property is overridden on a slide.
 */
export function hasSlideEffectOverrides(
  overrides: SlideEffectOverrides | undefined | null,
): boolean {
  return countSlideEffectOverrides(overrides) > 0
}

/**
 * Resolves the effective `FitMode` for a single slide, falling back to the global sequence mode.
 */
export function resolveSlideFitMode(
  slide: Pick<SlideImage, 'effectOverrides'> | undefined | null,
  globalEffects: Pick<SmartEffectsConfig, 'fitMode'>,
): FitMode {
  return slide?.effectOverrides?.fitMode ?? globalEffects.fitMode
}

/**
 * Resolves the full effective `SmartEffectsConfig` for a single slide by overlaying any
 * per-slide overrides onto the global sequence settings.
 */
export function resolveSlideEffects(
  slide: Pick<SlideImage, 'effectOverrides'> | undefined | null,
  globalEffects: SmartEffectsConfig,
): SmartEffectsConfig {
  const overrides = slide?.effectOverrides
  if (!overrides || !hasSlideEffectOverrides(overrides)) {
    return globalEffects
  }

  return {
    ...globalEffects,
    fitMode: overrides.fitMode ?? globalEffects.fitMode,
    kenBurns: overrides.kenBurns ?? globalEffects.kenBurns,
    colorLook: overrides.colorLook ?? globalEffects.colorLook,
    vignette: overrides.vignette ?? globalEffects.vignette,
  }
}

/**
 * Produces a stable serialization key for dirty-state tracking without deep-watching nested objects.
 */
export function serializeSlideEffectOverrides(
  overrides: SlideEffectOverrides | undefined | null,
): string {
  if (!overrides) return ''
  return [
    overrides.fitMode ?? '',
    overrides.kenBurns === undefined ? '' : overrides.kenBurns ? '1' : '0',
    overrides.colorLook ?? '',
    overrides.vignette === undefined ? '' : overrides.vignette ? '1' : '0',
  ].join('|')
}

export function getFitModeLabel(fitMode: FitMode): string {
  return FIT_MODE_LABELS[fitMode] ?? fitMode
}

export function getColorLookLabel(colorLook: ColorLook): string {
  return COLOR_LOOK_LABELS[colorLook] ?? colorLook
}

/**
 * Formats a compact badge label for filmstrip thumbnails (e.g., `Blur`, `Crop`, `Bars`, `Blur+`, `FX`).
 */
export function formatSlideOverrideBadgeLabel(
  overrides: SlideEffectOverrides | undefined | null,
): string {
  const overrideCount = countSlideEffectOverrides(overrides)
  if (overrideCount === 0 || !overrides) return ''

  if (overrides.fitMode !== undefined) {
    const framingTag = FIT_MODE_SHORT_BADGE_LABELS[overrides.fitMode]
    return overrideCount > 1 ? `${framingTag}+` : framingTag
  }

  return overrideCount > 1 ? `FX ${overrideCount}` : 'FX'
}

/**
 * Formats a compact button summary for the preview stage transport bar.
 */
export function formatSlideOverrideSummaryLabel(
  overrides: SlideEffectOverrides | undefined | null,
): string {
  const overrideCount = countSlideEffectOverrides(overrides)
  if (overrideCount === 0 || !overrides) return 'Slide FX'

  if (overrideCount === 1) {
    if (overrides.fitMode !== undefined) return getFitModeLabel(overrides.fitMode)
    if (overrides.colorLook !== undefined) return getColorLookLabel(overrides.colorLook)
    if (overrides.kenBurns !== undefined) return overrides.kenBurns ? 'Motion On' : 'Motion Off'
    if (overrides.vignette !== undefined) return overrides.vignette ? 'Vignette On' : 'Vignette Off'
  }

  if (overrides.fitMode !== undefined) {
    return `${getFitModeLabel(overrides.fitMode)} +${overrideCount - 1}`
  }

  return `Custom (${overrideCount})`
}

/**
 * Builds a human-readable description of all active per-slide effect overrides for tooltips.
 */
export function describeSlideEffectOverrides(
  overrides: SlideEffectOverrides | undefined | null,
): string {
  if (!overrides) return ''
  const parts: string[] = []

  if (overrides.fitMode !== undefined) {
    parts.push(`Framing: ${getFitModeLabel(overrides.fitMode)}`)
  }
  if (overrides.kenBurns !== undefined) {
    parts.push(`Ken Burns: ${overrides.kenBurns ? 'On' : 'Off'}`)
  }
  if (overrides.colorLook !== undefined) {
    parts.push(`Look: ${getColorLookLabel(overrides.colorLook)}`)
  }
  if (overrides.vignette !== undefined) {
    parts.push(`Vignette: ${overrides.vignette ? 'On' : 'Off'}`)
  }

  return parts.join(' · ')
}
