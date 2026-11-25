<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue'
import TopBar from './components/TopBar.vue'
import PreviewStage from './components/PreviewStage.vue'
import SettingsSidebar from './components/SettingsSidebar.vue'
import Filmstrip from './components/Filmstrip.vue'
import ExportModal from './components/ExportModal.vue'
import { useSlideshow } from './composables/useSlideshow'
import { usePwaInstall } from './composables/usePwaInstall'
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

function onGlobalKeyDown(event: KeyboardEvent) {
  if (isEditableFormElement(event.target) || isExportModalOpen.value) return
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
      @export="startExport"
      @install="promptInstall"
      @close-ios-instructions="closeIosInstructions"
    />

    <div class="flex min-h-0 flex-1 flex-col lg:flex-row">
      <!-- Left/Center Workspace: Preview + Filmstrip -->
      <main class="flex min-h-0 min-w-0 flex-1 flex-col">
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
          @update:current-time="currentTime = $event"
          @update:is-playing="isPlaying = $event"
          @update:is-muted="isMuted = $event"
          @add-files="addFiles"
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
          @clear-all="clearAllSlides"
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
  </div>
</template>
