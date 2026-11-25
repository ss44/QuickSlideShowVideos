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
import { formatTime } from '../engine/timeline'
import { extractImagesFromDrop } from '../utils/fileDrop'

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
  (e: 'update:currentTime', val: number): void
  (e: 'update:isPlaying', val: boolean): void
  (e: 'update:isMuted', val: boolean): void
  (e: 'addFiles', files: File[]): void
}>()

const canvasRef = ref<HTMLCanvasElement | null>(null)
const fileInputRef = ref<HTMLInputElement | null>(null)
const folderInputRef = ref<HTMLInputElement | null>(null)
const isDraggingOver = ref(false)

const renderer = new SlideshowRenderer()
const bitmapCache = new BitmapCache(12, 1280)
const audioPlayer = new PreviewAudioPlayer()

let rafId: number | null = null
let lastFrameWallTime = 0
let localTime = 0

// Preview internal render dimensions (scaled to <= 960px max side for silky 60fps preview)
const previewDimensions = computed(() => {
  const maxSide = 960
  const scale = Math.min(1, maxSide / Math.max(props.output.width, props.output.height))
  return {
    width: Math.max(2, Math.round((props.output.width * scale) / 2) * 2),
    height: Math.max(2, Math.round((props.output.height * scale) / 2) * 2),
  }
})

const aspectRatioStyle = computed(() => ({
  aspectRatio: `${props.output.width} / ${props.output.height}`,
}))

const progressPercent = computed(() => {
  if (props.timeline.totalDuration <= 0) return 0
  return Math.min(100, Math.max(0, (props.currentTime / props.timeline.totalDuration) * 100))
})

async function ensureBitmapsAndDraw(time: number) {
  const canvas = canvasRef.value
  if (!canvas) return
  const { width, height } = previewDimensions.value
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

  const idx = renderer.findSlideAtTime(props.timeline, time)
  if (idx >= 0) {
    const currSlide = props.slides[props.timeline.slides[idx].slideIndex]
    const prevSlide = idx > 0 ? props.slides[props.timeline.slides[idx - 1].slideIndex] : null

    const missing: Promise<unknown>[] = []
    if (currSlide && !bitmapCache.getSync(currSlide.id)) {
      missing.push(bitmapCache.get(currSlide))
    }
    if (prevSlide && !bitmapCache.getSync(prevSlide.id)) {
      missing.push(bitmapCache.get(prevSlide))
    }

    // Preload next 3 slides in background
    const preloadList: SlideImage[] = []
    for (let k = 1; k <= 3; k++) {
      if (idx + k < props.timeline.slides.length) {
        preloadList.push(props.slides[props.timeline.slides[idx + k].slideIndex])
      }
    }
    if (preloadList.length > 0) bitmapCache.preload(preloadList)

    if (missing.length > 0 && !props.isPlaying) {
      await Promise.all(missing)
    }
  }

  renderer.renderFrame(
    ctx,
    width,
    height,
    time,
    props.timeline,
    props.slides,
    (id) => bitmapCache.getSync(id),
    props.effects,
  )
}

function tick(now: number) {
  if (!props.isPlaying) return
  const dt = Math.min(0.1, (now - lastFrameWallTime) / 1000)
  lastFrameWallTime = now
  localTime += dt

  if (localTime >= props.timeline.totalDuration) {
    localTime = props.timeline.totalDuration
    emit('update:currentTime', localTime)
    emit('update:isPlaying', false)
    void ensureBitmapsAndDraw(localTime)
    return
  }

  emit('update:currentTime', localTime)
  void ensureBitmapsAndDraw(localTime)
  rafId = requestAnimationFrame(tick)
}

function startPlayback() {
  if (props.slides.length === 0 || props.timeline.totalDuration <= 0) return
  localTime = props.currentTime >= props.timeline.totalDuration - 0.05 ? 0 : props.currentTime
  if (localTime === 0) emit('update:currentTime', 0)
  lastFrameWallTime = performance.now()
  audioPlayer.start(props.music, localTime, props.timeline.totalDuration, props.isMuted)
  rafId = requestAnimationFrame(tick)
}

function stopPlayback() {
  if (rafId !== null) {
    cancelAnimationFrame(rafId)
    rafId = null
  }
  audioPlayer.stop()
}

function togglePlay() {
  if (props.slides.length === 0) return
  emit('update:isPlaying', !props.isPlaying)
}

function stepSlide(delta: number) {
  if (props.timeline.slides.length === 0) return
  const targetIdx = Math.max(
    0,
    Math.min(props.timeline.slides.length - 1, props.activeSlideIndex + delta),
  )
  const slide = props.timeline.slides[targetIdx]
  if (!slide) return
  const t = slide.startTime + Math.min(slide.transitionInDuration, slide.duration * 0.35)
  seekTo(t)
}

function seekTo(t: number) {
  const clamped = Math.max(0, Math.min(props.timeline.totalDuration, t))
  localTime = clamped
  emit('update:currentTime', clamped)
  if (props.isPlaying) {
    audioPlayer.start(props.music, clamped, props.timeline.totalDuration, props.isMuted)
  }
  void ensureBitmapsAndDraw(clamped)
}

function onScrubInput(e: Event) {
  const val = Number((e.target as HTMLInputElement).value)
  seekTo(val)
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

// Restart audio sync if music config changes while playing
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
      audioPlayer.start(props.music, localTime, props.timeline.totalDuration, props.isMuted)
    }
  },
)

// Re-render current frame whenever settings, slides, timeline, or scrubbed time changes
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
      localTime = props.currentTime
      void ensureBitmapsAndDraw(props.currentTime)
    }
  },
  { deep: true },
)

async function onDrop(e: DragEvent) {
  e.preventDefault()
  isDraggingOver.value = false
  if (!e.dataTransfer) return
  const files = await extractImagesFromDrop(e.dataTransfer)
  if (files.length > 0) emit('addFiles', files)
}

function onDragOver(e: DragEvent) {
  e.preventDefault()
  isDraggingOver.value = true
}

function onDragLeave(e: DragEvent) {
  if (e.currentTarget === e.target) {
    isDraggingOver.value = false
  }
}

function onFileChange(e: Event) {
  const input = e.target as HTMLInputElement
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
  void ensureBitmapsAndDraw(props.currentTime)
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
    <!-- Hidden Inputs -->
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
    <div v-else class="flex h-full w-full flex-col items-center justify-between gap-3 min-h-0">
      <!-- Canvas Container -->
      <div class="relative flex min-h-0 w-full flex-1 items-center justify-center">
        <div
          class="relative max-h-full max-w-full overflow-hidden rounded-xl bg-black shadow-2xl shadow-black/70 ring-1 ring-zinc-800"
          :style="aspectRatioStyle"
          style="height: 100%; width: auto"
        >
          <canvas
            ref="canvasRef"
            class="h-full w-full object-contain block cursor-pointer"
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
                :style="{ width: `${progressPercent}%` }"
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
              @input="onScrubInput"
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
            <span v-if="props.music.audioBuffer" class="max-w-[180px] truncate text-[11px] text-zinc-400">
              {{ props.music.name }}
            </span>
            <span v-else class="text-[11px] text-zinc-500">No audio</span>
          </div>

          <div class="flex items-center gap-1.5">
            <button
              type="button"
              class="rounded-lg p-1.5 text-zinc-300 transition hover:bg-zinc-800 hover:text-white"
              title="Previous slide (Left Arrow)"
              @click="stepSlide(-1)"
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
              @click="stepSlide(1)"
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
