import type { ExportProgress, SlideImage } from '../types/slideshow'
import type { EncodedVideo, VideoRenderInputs } from './exporter'

export type PreparationCommand =
  | { type: 'start'; inputs: VideoRenderInputs }
  | { type: 'pause' | 'resume' | 'finish' }
  | { type: 'edit'; slideIndex: number; appearance: Pick<SlideImage, 'rotation' | 'cropPosition' | 'effectOverrides'> }

export type PreparationUpdate =
  | { type: 'progress'; progress: ExportProgress }
  | { type: 'ready' | 'cache-full' | 'invalidated' | 'unavailable' }
  | { type: 'finished'; video: EncodedVideo }
