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
} from 'lucide-vue-next'
import type {
  ComputedTimeline,
  MusicConfig,
  OutputConfig,
  SlideImage,
  SmartEffectsConfig,
} from '../types/slideshow'
import { BitmapCache } from '../engine/imageCache'
import { SlideshowRenderer } from '../engine/renderer'
import { PreviewAudioPlayer } from '../engine/audioEngine'
import { findSlideIndexAtTime } from '../engine/timeline'
import { formatTime } from '../utils/formatters'
import { extractImagesFromDrop } from '../utils/fileDrop'

const PREVIEW_MAX_RENDER_DIMENSION_PX = 960
const PREVIEW_LOOKAHEAD_SLIDE_COUNT = 3

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
}>()

const emit = defineEmits<{
  (e: 'update:currentTime', timeSeconds: number): void
  (e: 'update:isPlaying', playing: boolean): void
  (e: 'update:isMuted', muted: boolean): void
  (e: 'addFiles', files: File[]): void
}>()

const canvasRef = ref<HTMLCanvasElement | null>(null)
const fileInputRef = ref<HTMLInputElement | null>(null)
const folderInputRef = ref<HTMLInputElement | null>(null)
const isDraggingOver = ref(false)

const renderer = new SlideshowRenderer()
const bitmapCache = new BitmapCache(12, 1280)
const audioPlayer = new PreviewAudioPlayer()

let animationFrameId: number | null = null
let previousFrameWallTimeMs = 0
let playbackClockSeconds = 0

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

const aspectRatioStyle = computed(() => ({
  aspectRatio: `${props.output.width} / ${props.output.height}`,
}))

const timelineProgressPercent = computed(() => {
  if (props.timeline.totalDuration <= 0) return 0
  return Math.min(100, Math.max(0, (props.currentTime / props.timeline.totalDuration) * 100))
})

async function renderFrameAtTime(timeSeconds: number) {
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
  const targetSlide = props.timeline.slides[targetIndex]
  if (!targetSlide) return

  const postTransitionOffset = Math.min(
    targetSlide.transitionInDuration,
    targetSlide.duration * 0.35,
  )
  seekToTime(targetSlide.startTime + postTransitionOffset)
}

function seekToTime(targetTimeSeconds: number) {
  const clampedTimeSeconds = Math.max(0, Math.min(props.timeline.totalDuration, targetTimeSeconds))
  playbackClockSeconds = clampedTimeSeconds
  emit('update:currentTime', clampedTimeSeconds)

  if (props.isPlaying) {
    audioPlayer.start(props.music, clampedTimeSeconds, props.timeline.totalDuration, props.isMuted)
  }
  void renderFrameAtTime(clampedTimeSeconds)
}

function onScrubberInput(event: Event) {
  const targetTimeSeconds = Number((event.target as HTMLInputElement).value)
  seekToTime(targetTimeSeconds)
}

watch(
  () => props.isPlaying,
  (playing) => {
    if (playing) startPlayback()
    else stopPlayback()
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
  () => [
    props.currentTime,
    props.slides,
    props.timeline,
    props.effects,
    props.output.width,
    props.output.height,
  ],
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
  const droppedFiles = await extractImagesFromDrop(event.dataTransfer)
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

onMounted(() => {
  void renderFrameAtTime(props.currentTime)
})

onBeforeUnmount(() => {
  stopPlayback()
  bitmapCache.clear()
})

defineExpose({ openFilePicker })
</script>

<template>
  <section
    class="relative flex min-h-0 flex-1 flex-col items-center justify-center overflow-hidden bg-zinc-950 p-4 select-none"
    @dragover="onDragOver"
    @dragleave="onDragLeave"
    @drop="onDrop"
  >
    <!-- Hidden File Inputs -->
    <input
      ref="fileInputRef"
      type="file"
      accept="image/*"
      multiple
      class="hidden"
      @change="onFileChange"
    />
    <input
      ref="folderInputRef"
      type="file"
      accept="image/*"
      webkitdirectory
      multiple
      class="hidden"
      @change="onFileChange"
    />

    <!-- Empty Drop State -->
    <div
      v-if="props.slides.length === 0"
      class="flex w-full max-w-xl flex-col items-center justify-center rounded-2xl border-2 border-dashed px-8 py-14 text-center transition"
      :class="
        isDraggingOver
          ? 'border-indigo-400 bg-indigo-500/10 scale-[1.01]'
          : 'border-zinc-800 bg-zinc-900/40 hover:border-zinc-700'
      "
    >
      <div
        class="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-indigo-500/10 text-indigo-400 ring-1 ring-indigo-500/20"
      >
        <Upload class="h-7 w-7" />
      </div>
      <h2 class="text-lg font-semibold text-zinc-100">Drop your photos here</h2>
      <p class="mt-1.5 max-w-sm text-sm text-zinc-400">
        Drag in dozens or hundreds of images—or an entire folder. Everything runs locally in your
        browser with zero uploads.
      </p>

      <div class="mt-6 flex flex-wrap items-center justify-center gap-3">
        <button
          type="button"
          class="inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2.5 text-sm font-medium text-white shadow-sm shadow-indigo-600/25 transition hover:bg-indigo-500"
          @click="openFilePicker"
        >
          <Upload class="h-4 w-4" />
          Choose Photos
        </button>
        <button
          type="button"
          class="inline-flex items-center gap-2 rounded-lg border border-zinc-700 bg-zinc-900 px-4 py-2.5 text-sm font-medium text-zinc-200 transition hover:bg-zinc-800"
          @click="openFolderPicker"
        >
          <FolderOpen class="h-4 w-4" />
          Choose Folder
        </button>
      </div>

      <div class="mt-6 flex items-center gap-1.5 text-xs text-zinc-500">
        <Sparkles class="h-3.5 w-3.5 text-indigo-400" />
        <span>Supports JPG, PNG, WebP, AVIF · Instant preview · Direct MP4 export</span>
      </div>
    </div>

    <!-- Preview Stage (When Photos Are Loaded) -->
    <div v-else class="flex h-full min-h-0 w-full flex-col items-center justify-between gap-3">
      <!-- Canvas Container -->
      <div class="relative flex min-h-0 w-full flex-1 items-center justify-center">
        <div
          class="relative max-h-full max-w-full overflow-hidden rounded-xl bg-black shadow-2xl shadow-black/70 ring-1 ring-zinc-800"
          :style="aspectRatioStyle"
          style="height: 100%; width: auto"
        >
          <canvas
            ref="canvasRef"
            class="block h-full w-full cursor-pointer object-contain"
            @click="togglePlay"
          />

          <!-- Top-left status pill -->
          <div
            class="pointer-events-none absolute top-3 left-3 flex items-center gap-2 rounded-md bg-black/60 px-2.5 py-1 text-[11px] font-medium text-zinc-200 backdrop-blur-sm"
          >
            <span>Slide {{ props.activeSlideIndex + 1 }} / {{ props.slides.length }}</span>
            <span class="text-zinc-500">·</span>
            <span class="text-zinc-400">{{ props.output.width }}×{{ props.output.height }}</span>
          </div>
        </div>
      </div>

      <!-- Playback Controls Bar -->
      <div
        class="flex w-full max-w-3xl shrink-0 flex-col gap-2 rounded-xl border border-zinc-800/80 bg-zinc-900/80 px-4 py-2.5 backdrop-blur"
      >
        <!-- Scrubber -->
        <div class="relative flex items-center gap-3">
          <span class="w-11 shrink-0 font-mono text-[11px] text-zinc-400">
            {{ formatTime(props.currentTime) }}
          </span>
          <div class="relative flex flex-1 items-center">
            <div class="h-1.5 w-full overflow-hidden rounded-full bg-zinc-800">
              <div
                class="h-full rounded-full bg-indigo-500 transition-[width] duration-75"
                :style="{ width: `${timelineProgressPercent}%` }"
              />
            </div>
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
          <span class="w-11 shrink-0 text-right font-mono text-[11px] text-zinc-400">
            {{ formatTime(props.timeline.totalDuration) }}
          </span>
        </div>

        <!-- Transport Buttons -->
        <div class="flex items-center justify-between">
          <div class="flex items-center gap-1 text-xs text-zinc-400">
            <button
              type="button"
              class="rounded-md p-1.5 transition hover:bg-zinc-800 hover:text-zinc-100"
              :title="props.isMuted ? 'Unmute' : 'Mute'"
              @click="emit('update:isMuted', !props.isMuted)"
            >
              <VolumeX v-if="props.isMuted || !props.music.audioBuffer" class="h-4 w-4" />
              <Volume2 v-else class="h-4 w-4 text-indigo-400" />
            </button>
            <span
              v-if="props.music.audioBuffer"
              class="max-w-[180px] truncate text-[11px] text-zinc-400"
            >
              {{ props.music.name }}
            </span>
            <span v-else class="text-[11px] text-zinc-500">No audio</span>
          </div>

          <div class="flex items-center gap-1.5">
            <button
              type="button"
              class="rounded-lg p-1.5 text-zinc-300 transition hover:bg-zinc-800 hover:text-white"
              title="Previous slide (Left Arrow)"
              @click="stepToAdjacentSlide(-1)"
            >
              <SkipBack class="h-4 w-4" />
            </button>
            <button
              type="button"
              class="flex h-9 w-9 items-center justify-center rounded-full bg-indigo-600 text-white shadow-sm shadow-indigo-600/30 transition hover:bg-indigo-500 active:scale-95"
              title="Play / Pause (Space)"
              @click="togglePlay"
            >
              <Pause v-if="props.isPlaying" class="h-4 w-4 fill-current" />
              <Play v-else class="h-4 w-4 translate-x-0.5 fill-current" />
            </button>
            <button
              type="button"
              class="rounded-lg p-1.5 text-zinc-300 transition hover:bg-zinc-800 hover:text-white"
              title="Next slide (Right Arrow)"
              @click="stepToAdjacentSlide(1)"
            >
              <SkipForward class="h-4 w-4" />
            </button>
          </div>

          <div class="text-right text-[11px] text-zinc-500">
            {{ props.timeline.effectiveSlideDuration.toFixed(1) }}s / slide
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
