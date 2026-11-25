import type {
  DuplicateDetectionConfig,
  MusicSourceType,
  OutputConfig,
  PerceptualFingerprint,
  SlideImage,
  SlideRotationDegrees,
  SmartEffectsConfig,
  TimingConfig,
  TransitionOrderMode,
  TransitionType,
} from './slideshow'

export const PROJECT_SCHEMA_VERSION = 1

export interface SavedSlideRecord {
  id: string
  name: string
  size: number
  mimeType: string
  lastModified: number
  width: number
  height: number
  rotation: SlideRotationDegrees
  contentHash: string | null
  perceptualFingerprint: PerceptualFingerprint | null
}

export interface SavedMusicRecord {
  sourceType: MusicSourceType
  assetId: string | null
  name: string
  url: string
  mimeType: string
  duration: number
  loop: boolean
  fadeIn: boolean
  fadeOut: boolean
  startOffset: number
  volume: number
  beatTimes: number[]
}

export interface SavedProjectSettings {
  timing: TimingConfig
  selectedTransitions: TransitionType[]
  transitionOrder: TransitionOrderMode
  effects: SmartEffectsConfig
  output: OutputConfig
  duplicateDetection: DuplicateDetectionConfig
}

export interface SavedProjectRecord {
  schemaVersion: number
  id: string
  name: string
  createdAt: number
  updatedAt: number
  slideCount: number
  totalDurationSeconds: number
  totalMediaBytes: number
  hasMusic: boolean
  musicName: string
  coverThumbnailBlob: Blob | null
  settings: SavedProjectSettings
  slides: SavedSlideRecord[]
  music: SavedMusicRecord
}

export interface SavedProjectSummary {
  id: string
  name: string
  createdAt: number
  updatedAt: number
  slideCount: number
  totalDurationSeconds: number
  totalMediaBytes: number
  hasMusic: boolean
  musicName: string
  coverThumbnailUrl: string | null
}

export interface ProjectSavePayload {
  projectId?: string
  name: string
  slides: SlideImage[]
  music: SavedMusicRecord
  musicSourceBlob: Blob | null
  settings: SavedProjectSettings
  totalDurationSeconds: number
}

export interface RestoredSlideEntry {
  record: SavedSlideRecord
  file: File
}

export interface RestoredMusicEntry {
  record: SavedMusicRecord
  sourceBlob: Blob | null
}

export interface RestoredProjectData {
  id: string
  name: string
  settings: SavedProjectSettings
  slides: RestoredSlideEntry[]
  music: RestoredMusicEntry
}

export interface StorageQuotaInfo {
  projectsTotalBytes: number
  browserUsedBytes: number | null
  browserQuotaBytes: number | null
}

export interface ProjectSaveProgress {
  completedAssets: number
  totalAssets: number
  message: string
}

export interface ProjectStorageRepository {
  isSupported(): boolean
  listProjectRecords(): Promise<SavedProjectRecord[]>
  saveProject(
    payload: ProjectSavePayload,
    onProgress?: (progress: ProjectSaveProgress) => void,
  ): Promise<SavedProjectRecord>
  loadProject(projectId: string): Promise<RestoredProjectData>
  renameProject(projectId: string, newName: string): Promise<SavedProjectRecord>
  deleteProject(projectId: string): Promise<void>
  getStorageEstimate(records?: SavedProjectRecord[]): Promise<StorageQuotaInfo>
  getLastOpenedProjectId(): string | null
  setLastOpenedProjectId(projectId: string | null): void
}
