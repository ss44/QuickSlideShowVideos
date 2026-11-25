<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue'
import TopBar from './components/TopBar.vue'
import PreviewStage from './components/PreviewStage.vue'
import SettingsSidebar from './components/SettingsSidebar.vue'
import Filmstrip from './components/Filmstrip.vue'
import ExportModal from './components/ExportModal.vue'
import ProjectsModal from './components/ProjectsModal.vue'
import { useSlideshow } from './composables/useSlideshow'
import { usePwaInstall } from './composables/usePwaInstall'
import { useProjectLibrary } from './composables/useProjectLibrary'
import { exportSlideshowVideo } from './engine/exporter'
import type { ExportProgress } from './types/slideshow'

const {
  slides,
  currentTime,
  isPlaying,
  isMuted,
  timing,
  selectedTransitions,
  transitionOrder,
  effects,
  music,
  output,
  duplicateDetection,
  timeline,
  estimatedSizeMB,
  activeSlideIndex,
  duplicateAnalysis,
  addFiles,
  removeSlide,
  removeDuplicateSlides,
  rotateSlide,
  reorderSlides,
  sortSlides,
  clearAllSlides,
  toggleTransition,
  selectAllTransitions,
  loadMusicFile,
  loadMusicUrl,
  clearMusic,
  setResolutionPreset,
  jumpToSlide,
  captureProjectSnapshot,
  restoreProject,
} = useSlideshow()

const {
  canOfferInstall,
  isInstalling,
  isIosInstructionsOpen,
  promptInstall,
  closeIosInstructions,
} = usePwaInstall()

const previewStageRef = ref<InstanceType<typeof PreviewStage> | null>(null)
const isExportModalOpen = ref(false)
const exportProgress = ref<ExportProgress | null>(null)
let activeExportAbortController: AbortController | null = null

const {
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
  openProjectsModal,
  closeProjectsModal,
  saveCurrentProject,
  quickSaveProject,
  openSavedProject,
  renameSavedProject,
  deleteSavedProject,
  detachActiveProject,
  suggestProjectName,
} = useProjectLibrary({
  slides,
  timing,
  selectedTransitions,
  transitionOrder,
  effects,
  music,
  output,
  duplicateDetection,
  captureProjectSnapshot,
  restoreProject,
  onBeforeProjectRestore: () => {
    previewStageRef.value?.clearBitmapCache()
  },
})

function triggerBrowserDownload(blobUrl: string, fileName: string) {
  const downloadAnchor = document.createElement('a')
  downloadAnchor.href = blobUrl
  downloadAnchor.download = fileName
  document.body.appendChild(downloadAnchor)
  downloadAnchor.click()
  document.body.removeChild(downloadAnchor)
}

function revokePreviousExportBlobUrl() {
  if (exportProgress.value?.blobUrl) {
    URL.revokeObjectURL(exportProgress.value.blobUrl)
  }
}

function isEditableFormElement(target: EventTarget | null): boolean {
  const tagName = (target as HTMLElement | null)?.tagName
  return tagName === 'INPUT' || tagName === 'TEXTAREA' || tagName === 'SELECT'
}

async function startExport() {
  if (slides.value.length === 0) return

  // Pause live preview playback before starting offline WebCodecs render
  isPlaying.value = false
  revokePreviousExportBlobUrl()

  activeExportAbortController = new AbortController()
  isExportModalOpen.value = true
  const exportStartTimeMs = performance.now()

  try {
    const exportResult = await exportSlideshowVideo({
      slides: slides.value,
      timeline: timeline.value,
      effects: { ...effects },
      music: { ...music },
      output: { ...output },
      signal: activeExportAbortController.signal,
      onProgress: (progressUpdate) => {
        exportProgress.value = progressUpdate
      },
    })

    const blobUrl = URL.createObjectURL(exportResult.blob)
    exportProgress.value = {
      phase: 'done',
      currentFrame: exportProgress.value?.totalFrames ?? 0,
      totalFrames: exportProgress.value?.totalFrames ?? 0,
      percent: 100,
      elapsedMs: performance.now() - exportStartTimeMs,
      estimatedRemainingMs: 0,
      message: 'Export complete!',
      blobUrl,
      fileName: exportResult.fileName,
      fileSizeBytes: exportResult.blob.size,
    }
    triggerBrowserDownload(blobUrl, exportResult.fileName)
  } catch (err) {
    const isCancelled = err instanceof DOMException && err.name === 'AbortError'
    exportProgress.value = {
      phase: isCancelled ? 'cancelled' : 'error',
      currentFrame: 0,
      totalFrames: 0,
      percent: 0,
      elapsedMs: performance.now() - exportStartTimeMs,
      estimatedRemainingMs: null,
      message: isCancelled
        ? 'Export was cancelled.'
        : err instanceof Error
          ? err.message
          : 'An unexpected error occurred during export.',
    }
  } finally {
    activeExportAbortController = null
  }
}

function cancelExport() {
  activeExportAbortController?.abort()
}

function closeExportModal() {
  isExportModalOpen.value = false
}

function downloadExportAgain() {
  if (exportProgress.value?.blobUrl && exportProgress.value?.fileName) {
    triggerBrowserDownload(exportProgress.value.blobUrl, exportProgress.value.fileName)
  }
}

function handleClearAllSlides() {
  clearAllSlides()
  detachActiveProject()
}

function onGlobalKeyDown(event: KeyboardEvent) {
  const isSaveShortcut = (event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 's'
  if (isSaveShortcut && !isExportModalOpen.value) {
    if (slides.value.length > 0) {
      event.preventDefault()
      void quickSaveProject()
    }
    return
  }

  if (event.code === 'Escape' && isProjectsModalOpen.value) {
    closeProjectsModal()
    return
  }

  if (isEditableFormElement(event.target) || isExportModalOpen.value || isProjectsModalOpen.value) {
    return
  }
  if (slides.value.length === 0) return

  if (event.code === 'Space') {
    event.preventDefault()
    isPlaying.value = !isPlaying.value
  } else if (event.code === 'ArrowRight') {
    event.preventDefault()
    jumpToSlide(Math.min(slides.value.length - 1, activeSlideIndex.value + 1))
  } else if (event.code === 'ArrowLeft') {
    event.preventDefault()
    jumpToSlide(Math.max(0, activeSlideIndex.value - 1))
  }
}

onMounted(() => {
  window.addEventListener('keydown', onGlobalKeyDown)
})

onBeforeUnmount(() => {
  window.removeEventListener('keydown', onGlobalKeyDown)
  revokePreviousExportBlobUrl()
})
</script>

<template>
  <div class="flex h-screen w-screen flex-col overflow-hidden bg-zinc-950 text-zinc-100">
    <TopBar
      :slide-count="slides.length"
      :total-duration="timeline.totalDuration"
      :estimated-size-m-b="estimatedSizeMB"
      :output="output"
      :can-export="slides.length > 0"
      :beat-snapped="timeline.beatSnapped"
      :can-offer-install="canOfferInstall"
      :is-installing="isInstalling"
      :is-ios-instructions-open="isIosInstructionsOpen"
      :active-project-name="activeProjectName"
      :has-unsaved-changes="hasUnsavedChanges"
      :saved-project-count="savedProjects.length"
      :is-saving-project="isSaving"
      :just-saved-feedback="justSavedFeedback"
      @export="startExport"
      @install="promptInstall"
      @close-ios-instructions="closeIosInstructions"
      @save-project="quickSaveProject"
      @open-projects="openProjectsModal"
    />

    <div class="flex min-h-0 flex-1 flex-col overflow-y-auto md:flex-row md:overflow-hidden">
      <!-- Left/Center Workspace: Preview + Filmstrip -->
      <main class="flex min-h-[480px] min-w-0 shrink-0 flex-1 flex-col md:min-h-0 md:shrink">
        <PreviewStage
          ref="previewStageRef"
          :slides="slides"
          :timeline="timeline"
          :effects="effects"
          :music="music"
          :output="output"
          :current-time="currentTime"
          :is-playing="isPlaying"
          :is-muted="isMuted"
          :active-slide-index="activeSlideIndex"
          :saved-projects="savedProjects"
          :opening-project-id="isOpeningProjectId"
          @update:current-time="currentTime = $event"
          @update:is-playing="isPlaying = $event"
          @update:is-muted="isMuted = $event"
          @add-files="addFiles"
          @open-saved-project="openSavedProject"
          @open-projects-modal="openProjectsModal"
        />

        <Filmstrip
          :slides="slides"
          :active-slide-index="activeSlideIndex"
          :duplicate-analysis="duplicateAnalysis"
          @add-more="previewStageRef?.openFilePicker()"
          @remove-duplicates="removeDuplicateSlides"
          @jump-to="jumpToSlide"
          @remove="removeSlide"
          @rotate="rotateSlide"
          @reorder="reorderSlides"
          @sort="sortSlides"
          @clear-all="handleClearAllSlides"
        />
      </main>

      <!-- Right Sidebar: Controls -->
      <SettingsSidebar
        :timing="timing"
        :selected-transitions="selectedTransitions"
        :transition-order="transitionOrder"
        :effects="effects"
        :music="music"
        :output="output"
        :duplicate-detection="duplicateDetection"
        :removable-duplicate-count="duplicateAnalysis.removableCount"
        :slide-count="slides.length"
        :total-duration="timeline.totalDuration"
        @toggle-transition="toggleTransition"
        @select-all-transitions="selectAllTransitions"
        @update:transition-order="transitionOrder = $event"
        @load-music-file="loadMusicFile"
        @load-music-url="loadMusicUrl"
        @clear-music="clearMusic"
        @set-resolution-preset="setResolutionPreset"
      />
    </div>

    <ExportModal
      :open="isExportModalOpen"
      :progress="exportProgress"
      :output="output"
      :slide-count="slides.length"
      :total-duration="timeline.totalDuration"
      @cancel="cancelExport"
      @close="closeExportModal"
      @download-again="downloadExportAgain"
    />

    <ProjectsModal
      :open="isProjectsModalOpen"
      :is-storage-supported="isStorageSupported"
      :saved-projects="savedProjects"
      :active-project-id="activeProjectId"
      :active-project-name="activeProjectName"
      :suggested-project-name="suggestProjectName()"
      :has-unsaved-changes="hasUnsavedChanges"
      :slide-count="slides.length"
      :total-duration="timeline.totalDuration"
      :is-loading-list="isLoadingList"
      :is-saving="isSaving"
      :is-opening-project-id="isOpeningProjectId"
      :save-progress="saveProgress"
      :storage-error="storageError"
      :just-saved-feedback="justSavedFeedback"
      :storage-quota="storageQuota"
      @close="closeProjectsModal"
      @save="saveCurrentProject"
      @open-project="openSavedProject"
      @rename-project="({ projectId, name }) => renameSavedProject(projectId, name)"
      @delete-project="deleteSavedProject"
    />
  </div>
</template>
