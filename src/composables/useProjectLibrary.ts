import { onBeforeUnmount, onMounted, ref, watch, type Ref } from 'vue'
import type {
  ProjectSaveProgress,
  ProjectStorageRepository,
  RestoredProjectData,
  SavedProjectRecord,
  SavedProjectSummary,
  StorageQuotaInfo,
} from '../types/project'
import type {
  DuplicateDetectionConfig,
  MusicConfig,
  OutputConfig,
  SlideImage,
  SmartEffectsConfig,
  TimingConfig,
  TransitionOrderMode,
  TransitionType,
} from '../types/slideshow'
import { projectStorageRepository } from '../engine/projectStorage'
import { serializeSlideEffectOverrides } from '../engine/slideEffects'

const SAVED_BADGE_RESET_DELAY_MS = 2600

export interface ProjectLibraryBindings {
  slides: Ref<SlideImage[]>
  timing: TimingConfig
  selectedTransitions: Ref<TransitionType[]>
  transitionOrder: Ref<TransitionOrderMode>
  effects: SmartEffectsConfig
  music: MusicConfig
  output: OutputConfig
  duplicateDetection: DuplicateDetectionConfig
  captureProjectSnapshot: (
    name: string,
    projectId?: string,
  ) => {
    projectId?: string
    name: string
    slides: SlideImage[]
    music: {
      sourceType: MusicConfig['sourceType']
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
    musicSourceBlob: Blob | null
    settings: {
      timing: TimingConfig
      selectedTransitions: TransitionType[]
      transitionOrder: TransitionOrderMode
      effects: SmartEffectsConfig
      output: OutputConfig
      duplicateDetection: DuplicateDetectionConfig
    }
    totalDurationSeconds: number
  }
  restoreProject: (restored: RestoredProjectData) => Promise<void>
  onBeforeProjectRestore?: () => void
  repository?: ProjectStorageRepository
}

function createDefaultProjectName(): string {
  const formattedDate = new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
  }).format(new Date())
  return `Slideshow – ${formattedDate}`
}

export function useProjectLibrary(bindings: ProjectLibraryBindings) {
  const repository = bindings.repository ?? projectStorageRepository

  const isStorageSupported = ref(repository.isSupported())
  const savedProjects = ref<SavedProjectSummary[]>([])
  const activeProjectId = ref<string | null>(null)
  const activeProjectName = ref<string>('')
  const hasUnsavedChanges = ref(false)
  const isProjectsModalOpen = ref(false)
  const isLoadingList = ref(false)
  const isSaving = ref(false)
  const isOpeningProjectId = ref<string | null>(null)
  const saveProgress = ref<ProjectSaveProgress | null>(null)
  const storageError = ref<string | null>(null)
  const justSavedFeedback = ref(false)
  const storageQuota = ref<StorageQuotaInfo>({
    projectsTotalBytes: 0,
    browserUsedBytes: null,
    browserQuotaBytes: null,
  })

  let suppressDirtyTracking = false
  let savedFeedbackTimeoutId: ReturnType<typeof setTimeout> | null = null

  function revokeCoverThumbnailUrls(summaries: SavedProjectSummary[]) {
    for (const summary of summaries) {
      if (summary.coverThumbnailUrl) {
        URL.revokeObjectURL(summary.coverThumbnailUrl)
      }
    }
  }

  function toProjectSummaries(records: SavedProjectRecord[]): SavedProjectSummary[] {
    return records.map((record) => ({
      id: record.id,
      name: record.name,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
      slideCount: record.slideCount,
      totalDurationSeconds: record.totalDurationSeconds,
      totalMediaBytes: record.totalMediaBytes,
      hasMusic: record.hasMusic,
      musicName: record.musicName,
      coverThumbnailUrl: record.coverThumbnailBlob
        ? URL.createObjectURL(record.coverThumbnailBlob)
        : null,
    }))
  }

  function triggerSavedFeedback() {
    if (savedFeedbackTimeoutId !== null) {
      clearTimeout(savedFeedbackTimeoutId)
    }
    justSavedFeedback.value = true
    savedFeedbackTimeoutId = setTimeout(() => {
      justSavedFeedback.value = false
      savedFeedbackTimeoutId = null
    }, SAVED_BADGE_RESET_DELAY_MS)
  }

  async function refreshProjectList() {
    if (!isStorageSupported.value) return
    isLoadingList.value = true
    storageError.value = null
    try {
      const records = await repository.listProjectRecords()
      const previousSummaries = savedProjects.value
      savedProjects.value = toProjectSummaries(records)
      revokeCoverThumbnailUrls(previousSummaries)
      storageQuota.value = await repository.getStorageEstimate(records)
    } catch (err) {
      storageError.value =
        err instanceof Error ? err.message : 'Could not load saved projects from local storage.'
    } finally {
      isLoadingList.value = false
    }
  }

  function openProjectsModal() {
    storageError.value = null
    isProjectsModalOpen.value = true
    void refreshProjectList()
  }

  function closeProjectsModal() {
    if (isSaving.value || isOpeningProjectId.value !== null) return
    isProjectsModalOpen.value = false
    storageError.value = null
  }

  async function saveCurrentProject(options: { name: string; saveAsNew?: boolean }): Promise<boolean> {
    if (bindings.slides.value.length === 0) {
      storageError.value = 'Add at least one photo before saving a project.'
      return false
    }

    isSaving.value = true
    storageError.value = null
    saveProgress.value = {
      completedAssets: 0,
      totalAssets: 0,
      message: 'Preparing project…',
    }

    try {
      const targetProjectId = options.saveAsNew ? undefined : activeProjectId.value ?? undefined
      const payload = bindings.captureProjectSnapshot(options.name, targetProjectId)
      const savedRecord = await repository.saveProject(payload, (progress) => {
        saveProgress.value = progress
      })

      activeProjectId.value = savedRecord.id
      activeProjectName.value = savedRecord.name
      hasUnsavedChanges.value = false
      triggerSavedFeedback()
      await refreshProjectList()
      return true
    } catch (err) {
      storageError.value =
        err instanceof Error ? err.message : 'Failed to save project locally.'
      return false
    } finally {
      isSaving.value = false
      saveProgress.value = null
    }
  }

  async function quickSaveProject() {
    if (bindings.slides.value.length === 0 || isSaving.value) return

    if (activeProjectId.value && activeProjectName.value) {
      const succeeded = await saveCurrentProject({
        name: activeProjectName.value,
        saveAsNew: false,
      })
      if (!succeeded) {
        isProjectsModalOpen.value = true
      }
      return
    }

    openProjectsModal()
  }

  async function openSavedProject(projectId: string): Promise<boolean> {
    if (isOpeningProjectId.value !== null || isSaving.value) return false
    isOpeningProjectId.value = projectId
    storageError.value = null

    try {
      const restored = await repository.loadProject(projectId)
      suppressDirtyTracking = true
      try {
        bindings.onBeforeProjectRestore?.()
        await bindings.restoreProject(restored)
        activeProjectId.value = restored.id
        activeProjectName.value = restored.name
        hasUnsavedChanges.value = false
      } finally {
        // Keep suppression through the microtask flush triggered by reactive updates during restore
        queueMicrotask(() => {
          suppressDirtyTracking = false
        })
      }
      isProjectsModalOpen.value = false
      return true
    } catch (err) {
      storageError.value =
        err instanceof Error ? err.message : 'Could not open this saved project.'
      return false
    } finally {
      isOpeningProjectId.value = null
    }
  }

  async function renameSavedProject(projectId: string, newName: string): Promise<boolean> {
    storageError.value = null
    try {
      const updatedRecord = await repository.renameProject(projectId, newName)
      if (activeProjectId.value === projectId) {
        activeProjectName.value = updatedRecord.name
      }
      await refreshProjectList()
      return true
    } catch (err) {
      storageError.value =
        err instanceof Error ? err.message : 'Could not rename project.'
      return false
    }
  }

  async function deleteSavedProject(projectId: string): Promise<boolean> {
    storageError.value = null
    try {
      await repository.deleteProject(projectId)
      if (activeProjectId.value === projectId) {
        activeProjectId.value = null
        activeProjectName.value = ''
        hasUnsavedChanges.value = bindings.slides.value.length > 0
      }
      await refreshProjectList()
      return true
    } catch (err) {
      storageError.value =
        err instanceof Error ? err.message : 'Could not delete saved project.'
      return false
    }
  }

  function detachActiveProject() {
    activeProjectId.value = null
    activeProjectName.value = ''
    hasUnsavedChanges.value = false
    storageError.value = null
  }

  function suggestProjectName(): string {
    if (activeProjectName.value.trim()) return activeProjectName.value
    return createDefaultProjectName()
  }

  // Watch meaningful project state changes to track unsaved edits without deep-watching File/AudioBuffer internals
  watch(
    () => [
      bindings.slides.value
        .map(
          (slide) =>
            `${slide.id}:${slide.rotation}:${slide.cropPosition.offsetX.toFixed(4)}:${slide.cropPosition.offsetY.toFixed(4)}:${serializeSlideEffectOverrides(slide.effectOverrides)}`,
        )
        .join(','),
      bindings.timing.slideDuration,
      bindings.timing.transitionDuration,
      bindings.timing.matchMusicLength,
      bindings.selectedTransitions.value.join(','),
      bindings.transitionOrder.value,
      bindings.effects.kenBurns,
      bindings.effects.kenBurnsIntensity,
      bindings.effects.fitMode,
      bindings.effects.beatSync,
      bindings.effects.colorLook,
      bindings.effects.vignette,
      bindings.music.sourceType,
      bindings.music.name,
      bindings.music.url,
      bindings.music.loop,
      bindings.music.fadeIn,
      bindings.music.fadeOut,
      bindings.music.startOffset,
      bindings.music.volume,
      bindings.output.format,
      bindings.output.presetId,
      bindings.output.width,
      bindings.output.height,
      bindings.output.fps,
      bindings.output.quality,
      bindings.duplicateDetection.enabled,
      bindings.duplicateDetection.similarityThresholdPercent,
    ],
    () => {
      if (suppressDirtyTracking) return
      if (bindings.slides.value.length === 0) {
        if (!activeProjectId.value) {
          hasUnsavedChanges.value = false
        } else {
          hasUnsavedChanges.value = true
        }
        return
      }
      hasUnsavedChanges.value = true
    },
  )

  onMounted(() => {
    void refreshProjectList()
  })

  onBeforeUnmount(() => {
    if (savedFeedbackTimeoutId !== null) {
      clearTimeout(savedFeedbackTimeoutId)
    }
    revokeCoverThumbnailUrls(savedProjects.value)
  })

  return {
    isStorageSupported,
    savedProjects,
    activeProjectId,
    activeProjectName,
    hasUnsavedChanges,
    isProjectsModalOpen,
    isLoadingList,
    isSaving,
    isOpeningProjectId,
    saveProgress,
    storageError,
    justSavedFeedback,
    storageQuota,
    refreshProjectList,
    openProjectsModal,
    closeProjectsModal,
    saveCurrentProject,
    quickSaveProject,
    openSavedProject,
    renameSavedProject,
    deleteSavedProject,
    detachActiveProject,
    suggestProjectName,
  }
}
