<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue'
import TopBar from './components/TopBar.vue'
import PreviewStage from './components/PreviewStage.vue'
import SettingsSidebar from './components/SettingsSidebar.vue'
import Filmstrip from './components/Filmstrip.vue'
import ExportModal from './components/ExportModal.vue'
import { useSlideshow } from './composables/useSlideshow'
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
  addFiles,
  removeSlide,
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

const previewRef = ref<InstanceType<typeof PreviewStage> | null>(null)
const exportModalOpen = ref(false)
const exportProgress = ref<ExportProgress | null>(null)
let abortController: AbortController | null = null

function triggerDownload(url: string, fileName: string) {
  const a = document.createElement('a')
  a.href = url
  a.download = fileName
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
}

async function startExport() {
  if (slides.value.length === 0) return

  // Pause preview during export
  isPlaying.value = false

  if (exportProgress.value?.blobUrl) {
    URL.revokeObjectURL(exportProgress.value.blobUrl)
  }

  abortController = new AbortController()
  exportModalOpen.value = true
  const startMs = performance.now()

  try {
    const result = await exportSlideshowVideo({
      slides: slides.value,
      timeline: timeline.value,
      effects: { ...effects },
      music: { ...music },
      output: { ...output },
      signal: abortController.signal,
      onProgress: (p) => {
        exportProgress.value = p
      },
    })

    const blobUrl = URL.createObjectURL(result.blob)
    exportProgress.value = {
      phase: 'done',
      currentFrame: exportProgress.value?.totalFrames ?? 0,
      totalFrames: exportProgress.value?.totalFrames ?? 0,
      percent: 100,
      elapsedMs: performance.now() - startMs,
      estimatedRemainingMs: 0,
      message: 'Export complete!',
      blobUrl,
      fileName: result.fileName,
      fileSizeBytes: result.blob.size,
    }
    triggerDownload(blobUrl, result.fileName)
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') {
      exportProgress.value = {
        phase: 'cancelled',
        currentFrame: 0,
        totalFrames: 0,
        percent: 0,
        elapsedMs: performance.now() - startMs,
        estimatedRemainingMs: null,
        message: 'Export was cancelled.',
      }
    } else {
      exportProgress.value = {
        phase: 'error',
        currentFrame: 0,
        totalFrames: 0,
        percent: 0,
        elapsedMs: performance.now() - startMs,
        estimatedRemainingMs: null,
        message: err instanceof Error ? err.message : 'An unexpected error occurred during export.',
      }
    }
  } finally {
    abortController = null
  }
}

function cancelExport() {
  abortController?.abort()
}

function closeExportModal() {
  exportModalOpen.value = false
}

function downloadAgain() {
  if (exportProgress.value?.blobUrl && exportProgress.value?.fileName) {
    triggerDownload(exportProgress.value.blobUrl, exportProgress.value.fileName)
  }
}

function onKeyDown(e: KeyboardEvent) {
  const tag = (e.target as HTMLElement | null)?.tagName
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return
  if (exportModalOpen.value) return

  if (e.code === 'Space' && slides.value.length > 0) {
    e.preventDefault()
    isPlaying.value = !isPlaying.value
  } else if (e.code === 'ArrowRight' && slides.value.length > 0) {
    e.preventDefault()
    jumpToSlide(Math.min(slides.value.length - 1, activeSlideIndex.value + 1))
  } else if (e.code === 'ArrowLeft' && slides.value.length > 0) {
    e.preventDefault()
    jumpToSlide(Math.max(0, activeSlideIndex.value - 1))
  }
}

onMounted(() => {
  window.addEventListener('keydown', onKeyDown)
})

onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKeyDown)
  if (exportProgress.value?.blobUrl) {
    URL.revokeObjectURL(exportProgress.value.blobUrl)
  }
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
      @export="startExport"
    />

    <div class="flex min-h-0 flex-1 flex-col lg:flex-row">
      <!-- Left/Center Workspace: Preview + Filmstrip -->
      <main class="flex min-h-0 min-w-0 flex-1 flex-col">
        <PreviewStage
          ref="previewRef"
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
          @add-more="previewRef?.openFilePicker()"
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
      :open="exportModalOpen"
      :progress="exportProgress"
      :output="output"
      :slide-count="slides.length"
      :total-duration="timeline.totalDuration"
      @cancel="cancelExport"
      @close="closeExportModal"
      @download-again="downloadAgain"
    />
  </div>
</template>
