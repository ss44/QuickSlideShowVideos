export type TransitionType =
  | 'cut'
  | 'crossfade'
  | 'slide-left'
  | 'slide-right'
  | 'slide-up'
  | 'push-left'
  | 'zoom-in'
  | 'zoom-out'
  | 'blur-dissolve'
  | 'dip-black'
  | 'wipe-left'

export type TransitionOrderMode = 'cycle' | 'random'

export type SlideRotationDegrees = 0 | 90 | 180 | 270

export type SlideSortMode = 'name' | 'date-asc' | 'date-desc' | 'reverse' | 'shuffle'

export interface LabeledOption<T extends string | number> {
  id: T
  label: string
}

export type TransitionOption = LabeledOption<TransitionType>

export const TRANSITION_OPTIONS: TransitionOption[] = [
  { id: 'crossfade', label: 'Crossfade' },
  { id: 'cut', label: 'Cut' },
  { id: 'slide-left', label: 'Slide Left' },
  { id: 'slide-right', label: 'Slide Right' },
  { id: 'slide-up', label: 'Slide Up' },
  { id: 'push-left', label: 'Push' },
  { id: 'zoom-in', label: 'Zoom In' },
  { id: 'zoom-out', label: 'Zoom Out' },
  { id: 'blur-dissolve', label: 'Blur Dissolve' },
  { id: 'dip-black', label: 'Dip to Black' },
  { id: 'wipe-left', label: 'Wipe' },
]

export type FitMode = 'blur-fill' | 'cover' | 'contain'

export const FIT_MODE_OPTIONS: LabeledOption<FitMode>[] = [
  { id: 'blur-fill', label: 'Blur Fill' },
  { id: 'cover', label: 'Crop Fill' },
  { id: 'contain', label: 'Black Bars' },
]

export type ColorLook = 'none' | 'warm' | 'crisp' | 'vintage' | 'bw' | 'cinematic'

export type ColorLookOption = LabeledOption<ColorLook>

export const COLOR_LOOK_OPTIONS: ColorLookOption[] = [
  { id: 'none', label: 'Original' },
  { id: 'warm', label: 'Warm' },
  { id: 'crisp', label: 'Crisp' },
  { id: 'vintage', label: 'Vintage' },
  { id: 'cinematic', label: 'Cinematic' },
  { id: 'bw', label: 'B&W' },
]

export const SLIDE_SORT_OPTIONS: LabeledOption<SlideSortMode>[] = [
  { id: 'name', label: 'Filename (A–Z)' },
  { id: 'date-asc', label: 'Date (Oldest first)' },
  { id: 'date-desc', label: 'Date (Newest first)' },
  { id: 'reverse', label: 'Reverse Order' },
]

export interface SlideImage {
  id: string
  file: File
  name: string
  size: number
  lastModified: number
  width: number
  height: number
  thumbnailUrl: string | null
  rotation: SlideRotationDegrees
  contentHash: string | null
}

export interface DuplicateAnalysis {
  duplicateSlideIds: Set<string>
  removableDuplicateIds: Set<string>
  copyCountBySlideId: Map<string, number>
  removableCount: number
}

export interface TimingConfig {
  slideDuration: number // seconds per slide
  transitionDuration: number // seconds per transition
  matchMusicLength: boolean
}

export interface SmartEffectsConfig {
  kenBurns: boolean
  kenBurnsIntensity: number // 0.03 to 0.18
  fitMode: FitMode
  beatSync: boolean
  colorLook: ColorLook
  vignette: boolean
}

export type MusicSourceType = 'none' | 'file' | 'url'

export interface MusicConfig {
  sourceType: MusicSourceType
  name: string
  url: string
  duration: number
  loop: boolean
  fadeIn: boolean
  fadeOut: boolean
  startOffset: number
  volume: number // 0 to 1
  audioBuffer: AudioBuffer | null
  beatTimes: number[]
  loading: boolean
  error: string | null
}

export type OutputFormat = 'mp4' | 'webm'

export const OUTPUT_FORMAT_OPTIONS: LabeledOption<OutputFormat>[] = [
  { id: 'mp4', label: 'MP4 (H.264)' },
  { id: 'webm', label: 'WebM (VP9)' },
]

export type VideoFrameRate = 30 | 60

export const FRAME_RATE_OPTIONS: VideoFrameRate[] = [30, 60]

export type VideoQualityTier = 'standard' | 'high'

export const VIDEO_QUALITY_OPTIONS: LabeledOption<VideoQualityTier>[] = [
  { id: 'standard', label: 'Std' },
  { id: 'high', label: 'High' },
]

export interface ResolutionPreset {
  id: string
  label: string
  sublabel: string
  width: number
  height: number
  aspect: string
}

export const RESOLUTION_PRESETS: ResolutionPreset[] = [
  { id: '1080p', label: '1080p HD', sublabel: '1920 × 1080', width: 1920, height: 1080, aspect: '16:9' },
  { id: '720p', label: '720p HD', sublabel: '1280 × 720', width: 1280, height: 720, aspect: '16:9' },
  { id: '4k', label: '4K UHD', sublabel: '3840 × 2160', width: 3840, height: 2160, aspect: '16:9' },
  { id: 'reels', label: 'Vertical', sublabel: '1080 × 1920', width: 1080, height: 1920, aspect: '9:16' },
  { id: 'square', label: 'Square', sublabel: '1080 × 1080', width: 1080, height: 1080, aspect: '1:1' },
  { id: 'portrait', label: 'Portrait', sublabel: '1080 × 1350', width: 1080, height: 1350, aspect: '4:5' },
]

export interface OutputConfig {
  format: OutputFormat
  presetId: string
  width: number
  height: number
  fps: VideoFrameRate
  quality: VideoQualityTier
}

export interface TimelineSlide {
  slideIndex: number
  slideId: string
  startTime: number
  endTime: number
  duration: number
  transitionIn: TransitionType
  transitionInDuration: number
  kenBurnsSeed: number
}

export interface ComputedTimeline {
  slides: TimelineSlide[]
  totalDuration: number
  effectiveSlideDuration: number
  beatSnapped: boolean
}

export type ExportPhase =
  | 'preparing'
  | 'rendering'
  | 'audio'
  | 'finalizing'
  | 'done'
  | 'error'
  | 'cancelled'

export interface ExportProgress {
  phase: ExportPhase
  currentFrame: number
  totalFrames: number
  percent: number
  elapsedMs: number
  estimatedRemainingMs: number | null
  message: string
  blobUrl?: string
  fileName?: string
  fileSizeBytes?: number
}
