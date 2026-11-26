<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import {
  Play,
  Pause,
  SkipBack,
  SkipForward,
  Volume2,
  VolumeX,
  Upload,
  FolderOpen,
  Sparkles,
  Images,
  Loader2,
  AlertTriangle,
  X,
} from 'lucide-vue-next'
import type {
  ComputedTimeline,
  ImageQualityAnalysis,
  MusicConfig,
  OutputConfig,
  SlideImage,
  SmartEffectsConfig,
} from '../types/slideshow'
import type { SavedProjectSummary } from '../types/project'
import { BitmapCache } from '../engine/imageCache'
import {
  describeSlideQualityIssues,
  formatQualityIssueBadgeLabel,
} from '../engine/imageQualityAnalyzer'
import { SlideshowRenderer } from '../engine/renderer'
import { PreviewAudioPlayer } from '../engine/audioEngine'
import { computeSlideSeekTimeSeconds, findSlideIndexAtTime } from '../engine/timeline'
import { formatRelativeTimestamp, formatTime } from '../utils/formatters'
import { extractFilesFromDrop, SUPPORTED_IMAGE_INPUT_ACCEPT } from '../utils/fileDrop'

const PREVIEW_MAX_RENDER_DIMENSION_PX = 960
const PREVIEW_LOOKAHEAD_SLIDE_COUNT = 3
const EXTERNAL_SEEK_EPSILON_SECONDS = 0.0005

const props = defineProps<{
  slides: SlideImage[]
  timeline: ComputedTimeline
  effects: SmartEffectsConfig
  music: MusicConfig
  output: OutputConfig
  currentTime: number
  isPlaying: boolean
  isMuted: boolean
  activeSlideIndex: number
  qualityAnalysis: ImageQualityAnalysis
  savedProjects: SavedProjectSummary[]
  openingProjectId: string | null
  rejectedFilesNotice: string | null
}>()

const emit = defineEmits<{
  (e: 'update:currentTime', timeSeconds: number): void
  (e: 'update:isPlaying', playing: boolean): void
  (e: 'update:isMuted', muted: boolean): void
  (e: 'addFiles', files: File[]): void
  (e: 'dismissRejectedFilesNotice'): void
  (e: 'openSavedProject', projectId: string): void
  (e: 'openProjectsModal'): void
}>()

const canvasRef = ref<HTMLCanvasElement | null>(null)
const canvasViewportRef = ref<HTMLElement | null>(null)
const fileInputRef = ref<HTMLInputElement | null>(null)
const folderInputRef = ref<HTMLInputElement | null>(null)
const isDraggingOver = ref(false)
const canvasViewportSize = ref({ width: 0, height: 0 })

const renderer = new SlideshowRenderer()
const bitmapCache = new BitmapCache(12, 1280)
const audioPlayer = new PreviewAudioPlayer()

let animationFrameId: number | null = null
let previousFrameWallTimeMs = 0
let playbackClockSeconds = 0
let latestRenderRequestId = 0
let viewportResizeObserver: ResizeObserver | null = null

/**
 * Scales the preview canvas internal resolution to at most 960px on its longest side
 * so live preview maintains a smooth 60fps even when output is set to 4K UHD.
 */
const previewCanvasDimensions = computed(() => {
  const downscaleFactor = Math.min(
    1,
    PREVIEW_MAX_RENDER_DIMENSION_PX / Math.max(props.output.width, props.output.height),
  )
  return {
    width: Math.max(2, Math.round((props.output.width * downscaleFactor) / 2) * 2),
    height: Math.max(2, Math.round((props.output.height * downscaleFactor) / 2) * 2),
  }
})

/**
 * Computes exact aspect-ratio-fitted pixel dimensions inside the available stage viewport
 * so 16:9, 9:16, 1:1, and 4:5 frames never clip or stretch on portrait mobile screens.
 */
const stageFrameStyle = computed(() => {
  const { width: availableWidth, height: availableHeight } = canvasViewportSize.value
  if (availableWidth <= 0 || availableHeight <= 0) {
    return {
      aspectRatio: `${props.output.width} / ${props.output.height}`,
      width: '100%',
      maxHeight: '100%',
    }
  }

  const outputAspectRatio = props.output.width / props.output.height
  const viewportAspectRatio = availableWidth / availableHeight

  if (viewportAspectRatio > outputAspectRatio) {
    const fittedHeight = Math.floor(availableHeight)
    const fittedWidth = Math.floor(fittedHeight * outputAspectRatio)
    return { width: `${fittedWidth}px`, height: `${fittedHeight}px` }
  }

  const fittedWidth = Math.floor(availableWidth)
  const fittedHeight = Math.floor(fittedWidth / outputAspectRatio)
  return { width: `${fittedWidth}px`, height: `${fittedHeight}px` }
})

watch(canvasViewportRef, (viewportElement) => {
  viewportResizeObserver?.disconnect()
  viewportResizeObserver = null

  if (!viewportElement) {
    canvasViewportSize.value = { width: 0, height: 0 }
    return
  }

  const updateMeasuredSize = (width: number, height: number) => {
    canvasViewportSize.value = { width, height }
  }

  const initialRect = viewportElement.getBoundingClientRect()
  updateMeasuredSize(initialRect.width, initialRect.height)

  if (typeof ResizeObserver !== 'undefined') {
    viewportResizeObserver = new ResizeObserver((entries) => {
      const entry = entries[0]
      if (entry) {
        updateMeasuredSize(entry.contentRect.width, entry.contentRect.height)
      }
    })
    viewportResizeObserver.observe(viewportElement)
  }
})

const timelineProgressPercent = computed(() => {
  if (props.timeline.totalDuration <= 0) return 0
  return Math.min(100, Math.max(0, (props.currentTime / props.timeline.totalDuration) * 100))
})

const activeSlideQualityWarning = computed(() => {
  const activeSlide = props.slides[props.activeSlideIndex]
  if (!activeSlide) return null
  const assessment = props.qualityAnalysis.assessmentBySlideId.get(activeSlide.id)
  if (!assessment || assessment.issues.length === 0) return null
  return {
    label: formatQualityIssueBadgeLabel(assessment),
    details: describeSlideQualityIssues(activeSlide, assessment, props.output),
  }
})

async function renderFrameAtTime(timeSeconds: number) {
  const renderRequestId = ++latestRenderRequestId
  const canvas = canvasRef.value
  if (!canvas) return

  const { width, height } = previewCanvasDimensions.value
  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width
    canvas.height = height
  }

  const ctx = canvas.getContext('2d', { alpha: false })
  if (!ctx) return

  if (props.timeline.slides.length === 0) {
    ctx.fillStyle = '#09090b'
    ctx.fillRect(0, 0, width, height)
    return
  }

  const activeTimelineIndex = findSlideIndexAtTime(props.timeline, timeSeconds)
  await bitmapCache.ensureSlideWindowLoaded(props.slides, props.timeline, activeTimelineIndex, {
    lookaheadCount: PREVIEW_LOOKAHEAD_SLIDE_COUNT,
    awaitActiveBitmaps: !props.isPlaying,
  })

  // Discard stale async renders if a newer seek or animation frame occurred while decoding
  if (renderRequestId !== latestRenderRequestId) return

  renderer.renderFrame(
    ctx,
    width,
    height,
    timeSeconds,
    props.timeline,
    props.slides,
    (slideId) => bitmapCache.getSync(slideId),
    props.effects,
  )
}

function animationFrameLoop(currentWallTimeMs: number) {
  if (!props.isPlaying) return

  // Clamp frame delta to 100ms so background tab throttling does not cause large time jumps
  const deltaSeconds = Math.min(0.1, (currentWallTimeMs - previousFrameWallTimeMs) / 1000)
  previousFrameWallTimeMs = currentWallTimeMs
  playbackClockSeconds += deltaSeconds

  if (playbackClockSeconds >= props.timeline.totalDuration) {
    playbackClockSeconds = props.timeline.totalDuration
    emit('update:currentTime', playbackClockSeconds)
    emit('update:isPlaying', false)
    void renderFrameAtTime(playbackClockSeconds)
    return
  }

  emit('update:currentTime', playbackClockSeconds)
  void renderFrameAtTime(playbackClockSeconds)
  animationFrameId = requestAnimationFrame(animationFrameLoop)
}

function startPlayback() {
  if (props.slides.length === 0 || props.timeline.totalDuration <= 0) return

  const isAtEndOfTimeline = props.currentTime >= props.timeline.totalDuration - 0.05
  playbackClockSeconds = isAtEndOfTimeline ? 0 : props.currentTime
  if (playbackClockSeconds === 0) emit('update:currentTime', 0)

  previousFrameWallTimeMs = performance.now()
  audioPlayer.start(props.music, playbackClockSeconds, props.timeline.totalDuration, props.isMuted)
  animationFrameId = requestAnimationFrame(animationFrameLoop)
}

function stopPlayback() {
  if (animationFrameId !== null) {
    cancelAnimationFrame(animationFrameId)
    animationFrameId = null
  }
  audioPlayer.stop()
}

function togglePlay() {
  if (props.slides.length === 0) return
  emit('update:isPlaying', !props.isPlaying)
}

function stepToAdjacentSlide(indexDelta: number) {
  if (props.timeline.slides.length === 0) return
  const targetIndex = Math.max(
    0,
    Math.min(props.timeline.slides.length - 1, props.activeSlideIndex + indexDelta),
  )
  const targetTimeSeconds = computeSlideSeekTimeSeconds(props.timeline, targetIndex)
  if (targetTimeSeconds === null) return

  seekToTime(targetTimeSeconds)
}

function syncPlaybackToTime(targetTimeSeconds: number, shouldEmitTimeUpdate: boolean) {
  const clampedTimeSeconds = Math.max(0, Math.min(props.timeline.totalDuration, targetTimeSeconds))
  playbackClockSeconds = clampedTimeSeconds
  previousFrameWallTimeMs = performance.now()

  if (shouldEmitTimeUpdate) {
    emit('update:currentTime', clampedTimeSeconds)
  }

  if (props.isPlaying) {
    audioPlayer.start(props.music, clampedTimeSeconds, props.timeline.totalDuration, props.isMuted)
  }
  void renderFrameAtTime(clampedTimeSeconds)
}

function seekToTime(targetTimeSeconds: number) {
  syncPlaybackToTime(targetTimeSeconds, true)
}

function onScrubberInput(event: Event) {
  const targetTimeSeconds = Number((event.target as HTMLInputElement).value)
  seekToTime(targetTimeSeconds)
}

watch(
  () => props.isPlaying,
  (playing) => {
    if (playing) {
      startPlayback()
    } else {
      stopPlayback()
      void renderFrameAtTime(playbackClockSeconds)
    }
  },
)

watch(
  () => props.currentTime,
  (newTimeSeconds) => {
    // Sync external seeks (e.g. clicking a filmstrip thumbnail or pressing arrow keys)
    // whether playback is paused or actively running, while ignoring echoes from our own clock.
    if (Math.abs(newTimeSeconds - playbackClockSeconds) <= EXTERNAL_SEEK_EPSILON_SECONDS) {
      return
    }
    syncPlaybackToTime(newTimeSeconds, false)
  },
)

watch(
  () => [props.isMuted, props.music.volume],
  () => {
    audioPlayer.setVolume(props.music.volume, props.isMuted)
  },
)

watch(
  () => [
    props.music.audioBuffer,
    props.music.loop,
    props.music.startOffset,
    props.music.fadeIn,
    props.music.fadeOut,
  ],
  () => {
    if (props.isPlaying) {
      audioPlayer.start(
        props.music,
        playbackClockSeconds,
        props.timeline.totalDuration,
        props.isMuted,
      )
    }
  },
)

watch(
  () => [props.slides, props.timeline, props.effects, props.output.width, props.output.height],
  () => {
    if (!props.isPlaying) {
      playbackClockSeconds = props.currentTime
      void renderFrameAtTime(props.currentTime)
    }
  },
  { deep: true },
)

async function onDrop(event: DragEvent) {
  event.preventDefault()
  isDraggingOver.value = false
  if (!event.dataTransfer) return
  const droppedFiles = await extractFilesFromDrop(event.dataTransfer)
  if (droppedFiles.length > 0) emit('addFiles', droppedFiles)
}

function onDragOver(event: DragEvent) {
  event.preventDefault()
  isDraggingOver.value = true
}

function onDragLeave(event: DragEvent) {
  if (event.currentTarget === event.target) {
    isDraggingOver.value = false
  }
}

function onFileChange(event: Event) {
  const input = event.target as HTMLInputElement
  if (input.files && input.files.length > 0) {
    emit('addFiles', Array.from(input.files))
    input.value = ''
  }
}

function openFilePicker() {
  fileInputRef.value?.click()
}

function openFolderPicker() {
  folderInputRef.value?.click()
}

function clearBitmapCache() {
  bitmapCache.clear()
}

onMounted(() => {
  void renderFrameAtTime(props.currentTime)
})

onBeforeUnmount(() => {
  viewportResizeObserver?.disconnect()
  viewportResizeObserver = null
  stopPlayback()
  bitmapCache.clear()
})

defineExpose({ openFilePicker, clearBitmapCache })
</script>

<template>
  <section
    class="relative flex min-h-0 flex-1 flex-col items-center justify-center overflow-hidden bg-zinc-950 p-2.5 select-none sm:p-4"
    @dragover="onDragOver"
    @dragleave="onDragLeave"
    @drop="onDrop"
  >
    <!-- Hidden File Inputs -->
    <input
      ref="fileInputRef"
      type="file"
      :accept="SUPPORTED_IMAGE_INPUT_ACCEPT"
      multiple
      class="hidden"
      @change="onFileChange"
    />
    <input
      ref="folderInputRef"
      type="file"
      :accept="SUPPORTED_IMAGE_INPUT_ACCEPT"
      webkitdirectory
      multiple
      class="hidden"
      @change="onFileChange"
    />

    <!-- Skipped / Unsupported Files Notice -->
    <div
      v-if="props.rejectedFilesNotice"
      role="status"
      aria-live="polite"
      class="absolute top-3 left-1/2 z-30 flex w-[calc(100%-1.5rem)] max-w-lg -translate-x-1/2 items-start gap-2.5 rounded-xl border border-amber-500/40 bg-zinc-900/95 px-3.5 py-2.5 text-xs text-amber-100 shadow-xl shadow-black/60 backdrop-blur"
    >
      <AlertTriangle class="mt-0.5 h-4 w-4 shrink-0 text-amber-400" />
      <p class="min-w-0 flex-1 leading-relaxed">{{ props.rejectedFilesNotice }}</p>
      <button
        type="button"
        class="shrink-0 rounded p-0.5 text-amber-300/80 transition hover:bg-amber-500/15 hover:text-amber-100"
        aria-label="Dismiss unsupported files notice"
        @click="emit('dismissRejectedFilesNotice')"
      >
        <X class="h-3.5 w-3.5" />
      </button>
    </div>

    <!-- Empty Drop State -->
    <div
      v-if="props.slides.length === 0"
      class="flex h-full w-full items-center justify-center overflow-y-auto overscroll-contain"
    >
      <div
        class="my-auto flex w-full max-w-xl flex-col items-center justify-center rounded-2xl border-2 border-dashed px-4 py-6 text-center transition sm:px-8 sm:py-14"
        :class="
          isDraggingOver
            ? 'border-indigo-400 bg-indigo-500/10 scale-[1.01]'
            : 'border-zinc-800 bg-zinc-900/40 hover:border-zinc-700'
        "
      >
        <div
          class="mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-indigo-500/10 text-indigo-400 ring-1 ring-indigo-500/20 sm:mb-4 sm:h-14 sm:w-14"
        >
          <Upload class="h-6 w-6 sm:h-7 sm:w-7" />
        </div>
        <h2 class="text-base font-semibold text-zinc-100 sm:text-lg">Drop your photos here</h2>
        <p class="mt-1 max-w-sm text-xs text-zinc-400 sm:mt-1.5 sm:text-sm">
          Drag in dozens or hundreds of images—or an entire folder. Everything runs locally in your
          browser with zero uploads.
        </p>

        <div class="mt-4 flex flex-wrap items-center justify-center gap-2.5 sm:mt-6 sm:gap-3">
          <button
            type="button"
            class="inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-3.5 py-2 text-xs font-medium text-white shadow-sm shadow-indigo-600/25 transition hover:bg-indigo-500 sm:px-4 sm:py-2.5 sm:text-sm"
            @click="openFilePicker"
          >
            <Upload class="h-4 w-4" />
            Choose Photos
          </button>
          <button
            type="button"
            class="inline-flex items-center gap-2 rounded-lg border border-zinc-700 bg-zinc-900 px-3.5 py-2 text-xs font-medium text-zinc-200 transition hover:bg-zinc-800 sm:px-4 sm:py-2.5 sm:text-sm"
            @click="openFolderPicker"
          >
            <FolderOpen class="h-4 w-4" />
            Choose Folder
          </button>
        </div>

        <div
          class="mt-4 flex items-center justify-center gap-1.5 text-[11px] text-zinc-500 sm:mt-6 sm:text-xs"
        >
          <Sparkles class="h-3.5 w-3.5 shrink-0 text-indigo-400" />
          <span>Supports JPG, PNG, WebP, AVIF · Instant preview · Direct MP4 export</span>
        </div>

        <!-- Recent Saved Projects Quick-Reopen Strip -->
        <div
          v-if="props.savedProjects.length > 0"
          class="mt-5 w-full border-t border-zinc-800/80 pt-4 text-left sm:mt-6 sm:pt-5"
        >
          <div class="mb-2.5 flex items-center justify-between text-xs">
            <span class="font-medium text-zinc-300">Recent Saved Projects</span>
            <button
              type="button"
              class="text-indigo-400 transition hover:text-indigo-300"
              @click="emit('openProjectsModal')"
            >
              Manage all ({{ props.savedProjects.length }})
            </button>
          </div>

          <div class="grid grid-cols-1 gap-2 sm:grid-cols-3">
            <button
              v-for="project in props.savedProjects.slice(0, 3)"
              :key="project.id"
              type="button"
              :disabled="props.openingProjectId !== null"
              class="group flex items-center gap-2.5 rounded-xl border border-zinc-800 bg-zinc-900/70 p-2 text-left transition hover:border-indigo-500/60 hover:bg-zinc-900 disabled:opacity-60"
              @click="emit('openSavedProject', project.id)"
            >
              <div
                class="flex h-10 w-12 shrink-0 items-center justify-center overflow-hidden rounded-md border border-zinc-800 bg-zinc-950"
              >
                <Loader2
                  v-if="props.openingProjectId === project.id"
                  class="h-4 w-4 animate-spin text-indigo-400"
                />
                <img
                  v-else-if="project.coverThumbnailUrl"
                  :src="project.coverThumbnailUrl"
                  :alt="project.name"
                  class="h-full w-full object-cover"
                />
                <Images v-else class="h-4 w-4 text-zinc-600" />
              </div>
              <div class="min-w-0 flex-1">
                <div class="truncate text-xs font-medium text-zinc-100 group-hover:text-indigo-200">
                  {{ project.name }}
                </div>
                <div class="mt-0.5 truncate text-[10px] text-zinc-500">
                  {{ project.slideCount }} {{ project.slideCount === 1 ? 'photo' : 'photos' }} ·
                  {{ formatRelativeTimestamp(project.updatedAt) }}
                </div>
              </div>
            </button>
          </div>
        </div>
      </div>
    </div>

    <!-- Preview Stage (When Photos Are Loaded) -->
    <div v-else class="flex h-full min-h-0 w-full flex-col items-center justify-between gap-2.5 sm:gap-3">
      <!-- Canvas Container -->
      <div
        ref="canvasViewportRef"
        class="relative flex min-h-0 w-full flex-1 items-center justify-center overflow-hidden"
      >
        <div
          class="relative overflow-hidden rounded-xl bg-black shadow-2xl shadow-black/70 ring-1 ring-zinc-800"
          :style="stageFrameStyle"
        >
          <canvas
            ref="canvasRef"
            class="block h-full w-full cursor-pointer object-contain"
            @click="togglePlay"
          />

          <!-- Top-left status pill -->
          <div
            class="pointer-events-none absolute top-2 left-2 flex items-center gap-1.5 rounded-md bg-black/65 px-2 py-0.5 text-[10px] font-medium text-zinc-200 backdrop-blur-sm sm:top-3 sm:left-3 sm:gap-2 sm:px-2.5 sm:py-1 sm:text-[11px]"
          >
            <span>Slide {{ props.activeSlideIndex + 1 }} / {{ props.slides.length }}</span>
            <span class="text-zinc-500">·</span>
            <span class="text-zinc-400">{{ props.output.width }}×{{ props.output.height }}</span>
          </div>

          <!-- Top-right quality warning pill (editor overlay only; never rendered onto exported video) -->
          <div
            v-if="activeSlideQualityWarning"
            :title="activeSlideQualityWarning.details"
            class="absolute top-2 right-2 flex items-center gap-1 rounded-md border border-yellow-400/50 bg-black/75 px-2 py-0.5 text-[10px] font-semibold text-yellow-300 backdrop-blur-sm sm:top-3 sm:right-3 sm:gap-1.5 sm:px-2.5 sm:py-1 sm:text-[11px]"
          >
            <AlertTriangle class="h-3 w-3 shrink-0 text-yellow-400" />
            <span>{{ activeSlideQualityWarning.label }}</span>
          </div>
        </div>
      </div>

      <!-- Playback Controls Bar -->
      <div
        class="flex w-full max-w-3xl shrink-0 flex-col gap-1.5 rounded-xl border border-zinc-800/80 bg-zinc-900/80 px-3 py-2 backdrop-blur sm:gap-2 sm:px-4 sm:py-2.5"
      >
        <!-- Scrubber (generous 28px touch target with crisp visual track and non-clipping full timers) -->
        <div class="relative flex items-center gap-2.5 sm:gap-3">
          <span
            class="min-w-[2.5rem] shrink-0 font-mono text-[11px] whitespace-nowrap tabular-nums text-zinc-300"
          >
            {{ formatTime(props.currentTime) }}
          </span>
          <div class="relative flex h-7 flex-1 items-center">
            <div class="h-1.5 w-full overflow-hidden rounded-full bg-zinc-800">
              <div
                class="h-full rounded-full bg-indigo-500 transition-[width] duration-75"
                :style="{ width: `${timelineProgressPercent}%` }"
              />
            </div>
            <div
              class="pointer-events-none absolute h-3 w-3 -translate-x-1/2 rounded-full bg-white shadow ring-2 ring-indigo-500 transition-[left] duration-75"
              :style="{ left: `${timelineProgressPercent}%` }"
            />
            <input
              type="range"
              min="0"
              :max="Math.max(0.01, props.timeline.totalDuration)"
              step="0.02"
              :value="props.currentTime"
              class="absolute inset-0 h-full w-full cursor-pointer opacity-0"
              aria-label="Seek timeline"
              @input="onScrubberInput"
            />
          </div>
          <span
            class="min-w-[2.5rem] shrink-0 text-right font-mono text-[11px] whitespace-nowrap tabular-nums text-zinc-300"
          >
            {{ formatTime(props.timeline.totalDuration) }}
          </span>
        </div>

        <!-- Transport Buttons (3-column grid keeps Play/Pause centered regardless of track name length) -->
        <div class="grid grid-cols-[1fr_auto_1fr] items-center gap-2">
          <div class="flex min-w-0 items-center gap-1 text-xs text-zinc-400">
            <button
              type="button"
              class="flex h-8 w-8 shrink-0 items-center justify-center rounded-md transition hover:bg-zinc-800 hover:text-zinc-100"
              :title="props.isMuted ? 'Unmute' : 'Mute'"
              :aria-label="props.isMuted ? 'Unmute audio' : 'Mute audio'"
              @click="emit('update:isMuted', !props.isMuted)"
            >
              <VolumeX v-if="props.isMuted || !props.music.audioBuffer" class="h-4 w-4" />
              <Volume2 v-else class="h-4 w-4 text-indigo-400" />
            </button>
            <span
              v-if="props.music.audioBuffer"
              class="min-w-0 truncate text-[11px] text-zinc-400"
            >
              {{ props.music.name }}
            </span>
            <span v-else class="hidden truncate text-[11px] text-zinc-500 sm:inline">No audio</span>
          </div>

          <div class="flex items-center gap-1 sm:gap-1.5">
            <button
              type="button"
              class="flex h-8 w-8 items-center justify-center rounded-lg text-zinc-300 transition hover:bg-zinc-800 hover:text-white"
              title="Previous slide (Left Arrow)"
              aria-label="Previous slide"
              @click="stepToAdjacentSlide(-1)"
            >
              <SkipBack class="h-4 w-4" />
            </button>
            <button
              type="button"
              class="flex h-9 w-9 items-center justify-center rounded-full bg-indigo-600 text-white shadow-sm shadow-indigo-600/30 transition hover:bg-indigo-500 active:scale-95"
              title="Play / Pause (Space)"
              :aria-label="props.isPlaying ? 'Pause slideshow' : 'Play slideshow'"
              @click="togglePlay"
            >
              <Pause v-if="props.isPlaying" class="h-4 w-4 fill-current" />
              <Play v-else class="h-4 w-4 translate-x-0.5 fill-current" />
            </button>
            <button
              type="button"
              class="flex h-8 w-8 items-center justify-center rounded-lg text-zinc-300 transition hover:bg-zinc-800 hover:text-white"
              title="Next slide (Right Arrow)"
              aria-label="Next slide"
              @click="stepToAdjacentSlide(1)"
            >
              <SkipForward class="h-4 w-4" />
            </button>
          </div>

          <div class="text-right text-[11px] whitespace-nowrap tabular-nums text-zinc-500">
            {{ props.timeline.effectiveSlideDuration.toFixed(1) }}s<span class="hidden sm:inline">
              /</span
            ><span class="sm:hidden">/</span>slide
          </div>
        </div>
      </div>
    </div>

    <!-- Drag-Over Overlay when photos already exist -->
    <div
      v-if="isDraggingOver && props.slides.length > 0"
      class="pointer-events-none absolute inset-3 z-20 flex flex-col items-center justify-center rounded-2xl border-2 border-dashed border-indigo-400 bg-zinc-950/85 backdrop-blur-sm"
    >
      <Upload class="mb-2 h-8 w-8 text-indigo-400" />
      <p class="text-sm font-semibold text-zinc-100">Drop photos to add to slideshow</p>
    </div>
  </section>
</template>
