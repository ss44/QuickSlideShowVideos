<script setup lang="ts">
import { ref } from 'vue'
import {
  Clock,
  Wand2,
  Sparkles,
  ScanSearch,
  Music,
  Sliders,
  Upload,
  Link2,
  Trash2,
  Repeat,
  ChevronDown,
  Loader2,
} from 'lucide-vue-next'
import type {
  DuplicateDetectionConfig,
  MusicConfig,
  OutputConfig,
  SmartEffectsConfig,
  TimingConfig,
  TransitionOrderMode,
  TransitionType,
} from '../types/slideshow'
import {
  COLOR_LOOK_OPTIONS,
  FIT_MODE_OPTIONS,
  FRAME_RATE_OPTIONS,
  OUTPUT_FORMAT_OPTIONS,
  RESOLUTION_PRESETS,
  TRANSITION_OPTIONS,
  VIDEO_QUALITY_OPTIONS,
} from '../types/slideshow'
import {
  DUPLICATE_THRESHOLD_MAX_PERCENT,
  DUPLICATE_THRESHOLD_MIN_PERCENT,
  describeSimilarityThreshold,
  formatSimilarityThresholdLabel,
} from '../engine/duplicateDetector'
import { formatTime } from '../utils/formatters'

const props = defineProps<{
  timing: TimingConfig
  selectedTransitions: TransitionType[]
  transitionOrder: TransitionOrderMode
  effects: SmartEffectsConfig
  music: MusicConfig
  output: OutputConfig
  duplicateDetection: DuplicateDetectionConfig
  removableDuplicateCount: number
  slideCount: number
  totalDuration: number
}>()

const emit = defineEmits<{
  (e: 'toggleTransition', type: TransitionType): void
  (e: 'selectAllTransitions'): void
  (e: 'update:transitionOrder', order: TransitionOrderMode): void
  (e: 'loadMusicFile', file: File): void
  (e: 'loadMusicUrl', url: string): void
  (e: 'clearMusic'): void
  (e: 'setResolutionPreset', presetId: string): void
}>()

const openSections = ref<Record<string, boolean>>({
  timing: true,
  transitions: true,
  effects: false,
  music: false,
  duplicates: false,
  output: false,
})

const musicUrlInput = ref('')
const musicFileRef = ref<HTMLInputElement | null>(null)

function toggleSection(sectionKey: string) {
  openSections.value[sectionKey] = !openSections.value[sectionKey]
}

function onMusicFileChange(event: Event) {
  const input = event.target as HTMLInputElement
  const selectedFile = input.files?.[0]
  if (selectedFile) {
    emit('loadMusicFile', selectedFile)
    input.value = ''
  }
}

function submitMusicUrl() {
  const trimmedUrl = musicUrlInput.value.trim()
  if (!trimmedUrl) return
  emit('loadMusicUrl', trimmedUrl)
}
</script>

<template>
  <aside
    class="flex w-full shrink-0 flex-col border-t border-zinc-800/80 bg-zinc-950 md:h-full md:w-[300px] md:overflow-y-auto md:border-t-0 md:border-l lg:w-[340px]"
  >
    <!-- 1. TIMING -->
    <div class="border-b border-zinc-800/80">
      <button
        type="button"
        class="flex w-full items-center justify-between px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-zinc-300 hover:bg-zinc-900/50"
        @click="toggleSection('timing')"
      >
        <span class="flex items-center gap-2">
          <Clock class="h-3.5 w-3.5 text-indigo-400" />
          Timing
        </span>
        <ChevronDown
          class="h-3.5 w-3.5 text-zinc-500 transition-transform"
          :class="{ '-rotate-90': !openSections.timing }"
        />
      </button>

      <div v-if="openSections.timing" class="space-y-4 px-4 pb-4">
        <!-- Match music length toggle -->
        <label
          v-if="props.music.audioBuffer"
          class="flex cursor-pointer items-center justify-between rounded-lg border border-zinc-800 bg-zinc-900/60 px-3 py-2"
        >
          <div>
            <div class="text-xs font-medium text-zinc-200">Match Music Length</div>
            <div class="text-[11px] text-zinc-500">Auto-fit slides to song duration</div>
          </div>
          <input
            v-model="props.timing.matchMusicLength"
            type="checkbox"
            class="h-4 w-4 rounded accent-indigo-500"
          />
        </label>

        <!-- Slide duration -->
        <div :class="{ 'pointer-events-none opacity-45': props.timing.matchMusicLength }">
          <div class="mb-1.5 flex items-center justify-between text-xs">
            <span class="text-zinc-300">Slide Duration</span>
            <span class="font-mono text-zinc-100">{{ props.timing.slideDuration.toFixed(1) }}s</span>
          </div>
          <input
            v-model.number="props.timing.slideDuration"
            type="range"
            min="0.5"
            max="10"
            step="0.1"
            class="w-full cursor-pointer"
          />
        </div>

        <!-- Transition duration -->
        <div>
          <div class="mb-1.5 flex items-center justify-between text-xs">
            <span class="text-zinc-300">Transition Speed</span>
            <span class="font-mono text-zinc-100">{{ props.timing.transitionDuration.toFixed(2) }}s</span>
          </div>
          <input
            v-model.number="props.timing.transitionDuration"
            type="range"
            min="0.1"
            max="2.5"
            step="0.05"
            class="w-full cursor-pointer"
          />
        </div>
      </div>
    </div>

    <!-- 2. TRANSITIONS -->
    <div class="border-b border-zinc-800/80">
      <button
        type="button"
        class="flex w-full items-center justify-between px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-zinc-300 hover:bg-zinc-900/50"
        @click="toggleSection('transitions')"
      >
        <span class="flex items-center gap-2">
          <Wand2 class="h-3.5 w-3.5 text-indigo-400" />
          Transitions
          <span class="rounded-full bg-zinc-800 px-1.5 py-0.5 text-[10px] font-medium text-zinc-300">
            {{ props.selectedTransitions.length }}
          </span>
        </span>
        <ChevronDown
          class="h-3.5 w-3.5 text-zinc-500 transition-transform"
          :class="{ '-rotate-90': !openSections.transitions }"
        />
      </button>

      <div v-if="openSections.transitions" class="space-y-3 px-4 pb-4">
        <div class="flex flex-wrap gap-1.5">
          <button
            v-for="option in TRANSITION_OPTIONS"
            :key="option.id"
            type="button"
            class="rounded-md border px-2.5 py-1 text-xs font-medium transition"
            :class="
              props.selectedTransitions.includes(option.id)
                ? 'border-indigo-500/70 bg-indigo-500/20 text-indigo-200'
                : 'border-zinc-800 bg-zinc-900/60 text-zinc-400 hover:border-zinc-700 hover:text-zinc-200'
            "
            @click="emit('toggleTransition', option.id)"
          >
            {{ option.label }}
          </button>
        </div>

        <div class="flex items-center justify-between pt-1 text-[11px]">
          <div class="inline-flex rounded-md border border-zinc-800 bg-zinc-900 p-0.5">
            <button
              type="button"
              class="rounded px-2 py-0.5 font-medium transition"
              :class="
                props.transitionOrder === 'cycle'
                  ? 'bg-zinc-800 text-zinc-100'
                  : 'text-zinc-500 hover:text-zinc-300'
              "
              @click="emit('update:transitionOrder', 'cycle')"
            >
              Cycle
            </button>
            <button
              type="button"
              class="rounded px-2 py-0.5 font-medium transition"
              :class="
                props.transitionOrder === 'random'
                  ? 'bg-zinc-800 text-zinc-100'
                  : 'text-zinc-500 hover:text-zinc-300'
              "
              @click="emit('update:transitionOrder', 'random')"
            >
              Random
            </button>
          </div>

          <button
            type="button"
            class="text-indigo-400 hover:text-indigo-300"
            @click="emit('selectAllTransitions')"
          >
            Select all smooth
          </button>
        </div>
      </div>
    </div>

    <!-- 3. SMART EFFECTS -->
    <div class="border-b border-zinc-800/80">
      <button
        type="button"
        class="flex w-full items-center justify-between px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-zinc-300 hover:bg-zinc-900/50"
        @click="toggleSection('effects')"
      >
        <span class="flex items-center gap-2">
          <Sparkles class="h-3.5 w-3.5 text-indigo-400" />
          Smart Effects
        </span>
        <ChevronDown
          class="h-3.5 w-3.5 text-zinc-500 transition-transform"
          :class="{ '-rotate-90': !openSections.effects }"
        />
      </button>

      <div v-if="openSections.effects" class="space-y-3.5 px-4 pb-4">
        <!-- Framing / Fit Mode -->
        <div>
          <label class="mb-1.5 block text-xs text-zinc-300">Smart Framing</label>
          <div class="grid grid-cols-3 gap-1.5">
            <button
              v-for="mode in FIT_MODE_OPTIONS"
              :key="mode.id"
              type="button"
              class="rounded-md border px-2 py-1.5 text-xs font-medium transition"
              :class="
                props.effects.fitMode === mode.id
                  ? 'border-indigo-500/70 bg-indigo-500/20 text-indigo-200'
                  : 'border-zinc-800 bg-zinc-900/60 text-zinc-400 hover:text-zinc-200'
              "
              @click="props.effects.fitMode = mode.id"
            >
              {{ mode.label }}
            </button>
          </div>
        </div>

        <!-- Ken Burns -->
        <div class="rounded-lg border border-zinc-800/80 bg-zinc-900/40 p-2.5">
          <label class="flex cursor-pointer items-center justify-between">
            <div>
              <div class="text-xs font-medium text-zinc-200">Ken Burns Motion</div>
              <div class="text-[11px] text-zinc-500">Subtle auto pan & zoom per photo</div>
            </div>
            <input
              v-model="props.effects.kenBurns"
              type="checkbox"
              class="h-4 w-4 rounded accent-indigo-500"
            />
          </label>
          <div v-if="props.effects.kenBurns" class="mt-2.5">
            <div class="mb-1 flex justify-between text-[11px] text-zinc-400">
              <span>Motion Intensity</span>
              <span class="font-mono">{{ Math.round(props.effects.kenBurnsIntensity * 100) }}%</span>
            </div>
            <input
              v-model.number="props.effects.kenBurnsIntensity"
              type="range"
              min="0.03"
              max="0.18"
              step="0.01"
              class="w-full cursor-pointer"
            />
          </div>
        </div>

        <!-- Beat Sync -->
        <label
          class="flex items-center justify-between rounded-lg border border-zinc-800/80 bg-zinc-900/40 p-2.5"
          :class="props.music.audioBuffer ? 'cursor-pointer' : 'cursor-not-allowed opacity-50'"
        >
          <div>
            <div class="flex items-center gap-1.5 text-xs font-medium text-zinc-200">
              <span>Beat Sync</span>
              <span
                v-if="props.music.beatTimes.length > 0"
                class="rounded bg-indigo-500/20 px-1.5 py-0.5 text-[10px] text-indigo-300"
              >
                {{ props.music.beatTimes.length }} beats
              </span>
            </div>
            <div class="text-[11px] text-zinc-500">
              {{
                props.music.audioBuffer
                  ? 'Snap slide changes to music beats'
                  : 'Add a music track to enable'
              }}
            </div>
          </div>
          <input
            v-model="props.effects.beatSync"
            type="checkbox"
            :disabled="!props.music.audioBuffer"
            class="h-4 w-4 rounded accent-indigo-500"
          />
        </label>

        <!-- Color Look -->
        <div>
          <label class="mb-1.5 block text-xs text-zinc-300">Color Look</label>
          <div class="grid grid-cols-3 gap-1.5">
            <button
              v-for="look in COLOR_LOOK_OPTIONS"
              :key="look.id"
              type="button"
              class="rounded-md border px-2 py-1 text-xs font-medium transition"
              :class="
                props.effects.colorLook === look.id
                  ? 'border-indigo-500/70 bg-indigo-500/20 text-indigo-200'
                  : 'border-zinc-800 bg-zinc-900/60 text-zinc-400 hover:text-zinc-200'
              "
              @click="props.effects.colorLook = look.id"
            >
              {{ look.label }}
            </button>
          </div>
        </div>

        <!-- Vignette -->
        <label class="flex cursor-pointer items-center justify-between px-0.5">
          <span class="text-xs text-zinc-300">Subtle Vignette</span>
          <input
            v-model="props.effects.vignette"
            type="checkbox"
            class="h-4 w-4 rounded accent-indigo-500"
          />
        </label>
      </div>
    </div>

    <!-- 4. MUSIC -->
    <div class="border-b border-zinc-800/80">
      <button
        type="button"
        class="flex w-full items-center justify-between px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-zinc-300 hover:bg-zinc-900/50"
        @click="toggleSection('music')"
      >
        <span class="flex items-center gap-2">
          <Music class="h-3.5 w-3.5 text-indigo-400" />
          Music
        </span>
        <ChevronDown
          class="h-3.5 w-3.5 text-zinc-500 transition-transform"
          :class="{ '-rotate-90': !openSections.music }"
        />
      </button>

      <div v-if="openSections.music" class="space-y-3 px-4 pb-4">
        <input
          ref="musicFileRef"
          type="file"
          accept="audio/*,.mp3,.wav,.m4a,.ogg,.aac"
          class="hidden"
          @change="onMusicFileChange"
        />

        <!-- Loaded Track Card -->
        <div
          v-if="props.music.audioBuffer"
          class="rounded-lg border border-indigo-500/30 bg-indigo-500/10 p-3"
        >
          <div class="flex items-start justify-between gap-2">
            <div class="min-w-0">
              <div class="truncate text-xs font-semibold text-zinc-100">{{ props.music.name }}</div>
              <div class="mt-0.5 text-[11px] text-indigo-300/80">
                {{ formatTime(props.music.duration) }} · {{ props.music.beatTimes.length }} beats detected
              </div>
            </div>
            <button
              type="button"
              class="rounded p-1 text-zinc-400 transition hover:bg-zinc-800 hover:text-red-400"
              title="Remove music"
              @click="emit('clearMusic')"
            >
              <Trash2 class="h-3.5 w-3.5" />
            </button>
          </div>

          <div class="mt-3 space-y-2.5">
            <!-- Loop + Fades -->
            <div class="flex flex-wrap gap-2">
              <label
                class="inline-flex cursor-pointer items-center gap-1.5 rounded-md border border-zinc-800 bg-zinc-950/70 px-2 py-1 text-[11px] text-zinc-200"
              >
                <input v-model="props.music.loop" type="checkbox" class="h-3.5 w-3.5 accent-indigo-500" />
                <Repeat class="h-3 w-3 text-indigo-400" />
                Loop
              </label>
              <label
                class="inline-flex cursor-pointer items-center gap-1.5 rounded-md border border-zinc-800 bg-zinc-950/70 px-2 py-1 text-[11px] text-zinc-200"
              >
                <input v-model="props.music.fadeIn" type="checkbox" class="h-3.5 w-3.5 accent-indigo-500" />
                Fade In
              </label>
              <label
                class="inline-flex cursor-pointer items-center gap-1.5 rounded-md border border-zinc-800 bg-zinc-950/70 px-2 py-1 text-[11px] text-zinc-200"
              >
                <input v-model="props.music.fadeOut" type="checkbox" class="h-3.5 w-3.5 accent-indigo-500" />
                Fade Out
              </label>
            </div>

            <!-- Start Offset -->
            <div>
              <div class="mb-1 flex justify-between text-[11px] text-zinc-300">
                <span>Start At</span>
                <span class="font-mono">{{ formatTime(props.music.startOffset) }}</span>
              </div>
              <input
                v-model.number="props.music.startOffset"
                type="range"
                min="0"
                :max="Math.max(0, Math.floor(props.music.duration - 1))"
                step="0.5"
                class="w-full cursor-pointer"
              />
            </div>

            <!-- Volume -->
            <div>
              <div class="mb-1 flex justify-between text-[11px] text-zinc-300">
                <span>Volume</span>
                <span class="font-mono">{{ Math.round(props.music.volume * 100) }}%</span>
              </div>
              <input
                v-model.number="props.music.volume"
                type="range"
                min="0"
                max="1"
                step="0.05"
                class="w-full cursor-pointer"
              />
            </div>
          </div>
        </div>

        <!-- Upload / URL Controls -->
        <button
          type="button"
          :disabled="props.music.loading"
          class="flex w-full items-center justify-center gap-2 rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-xs font-medium text-zinc-200 transition hover:bg-zinc-800 disabled:opacity-50"
          @click="musicFileRef?.click()"
        >
          <Loader2 v-if="props.music.loading" class="h-3.5 w-3.5 animate-spin" />
          <Upload v-else class="h-3.5 w-3.5" />
          <span>{{ props.music.audioBuffer ? 'Replace Audio File' : 'Upload MP3 / Audio' }}</span>
        </button>

        <form class="flex gap-1.5" @submit.prevent="submitMusicUrl">
          <div class="relative flex-1">
            <Link2 class="pointer-events-none absolute top-1/2 left-2.5 h-3.5 w-3.5 -translate-y-1/2 text-zinc-500" />
            <input
              v-model="musicUrlInput"
              type="url"
              placeholder="Direct .mp3 / .wav URL…"
              class="w-full rounded-lg border border-zinc-800 bg-zinc-900 py-1.5 pr-2 pl-8 text-xs text-zinc-200 placeholder-zinc-500 focus:border-indigo-500 focus:outline-none"
            />
          </div>
          <button
            type="submit"
            :disabled="props.music.loading || !musicUrlInput.trim()"
            class="rounded-lg border border-zinc-700 bg-zinc-800 px-2.5 text-xs font-medium text-zinc-200 transition hover:bg-zinc-700 disabled:opacity-40"
          >
            Load
          </button>
        </form>

        <p v-if="props.music.error" class="rounded-md bg-red-500/10 p-2 text-[11px] leading-relaxed text-red-300">
          {{ props.music.error }}
        </p>
      </div>
    </div>

    <!-- 5. DUPLICATE DETECTION -->
    <div class="border-b border-zinc-800/80">
      <button
        type="button"
        class="flex w-full items-center justify-between px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-zinc-300 hover:bg-zinc-900/50"
        @click="toggleSection('duplicates')"
      >
        <span class="flex items-center gap-2">
          <ScanSearch class="h-3.5 w-3.5 text-amber-400" />
          Duplicate Finder
          <span
            v-if="props.duplicateDetection.enabled && props.removableDuplicateCount > 0"
            class="rounded-full bg-amber-500/20 px-1.5 py-0.5 text-[10px] font-medium text-amber-300"
          >
            {{ props.removableDuplicateCount }}
          </span>
        </span>
        <ChevronDown
          class="h-3.5 w-3.5 text-zinc-500 transition-transform"
          :class="{ '-rotate-90': !openSections.duplicates }"
        />
      </button>

      <div v-if="openSections.duplicates" class="px-4 pb-4">
        <div class="rounded-lg border border-zinc-800/80 bg-zinc-900/40 p-2.5">
          <label class="flex cursor-pointer items-center justify-between">
            <div>
              <div class="text-xs font-medium text-zinc-200">Scan for Duplicates</div>
              <div class="text-[11px] text-zinc-500">Highlight matching photos in filmstrip</div>
            </div>
            <input
              v-model="props.duplicateDetection.enabled"
              type="checkbox"
              class="h-4 w-4 rounded accent-indigo-500"
            />
          </label>

          <div v-if="props.duplicateDetection.enabled" class="mt-3 space-y-2">
            <div class="flex items-center justify-between text-[11px]">
              <span class="text-zinc-400">Similarity Threshold</span>
              <span class="font-mono text-zinc-100">
                {{ props.duplicateDetection.similarityThresholdPercent }}%
                <span class="font-sans text-amber-300">
                  · {{ formatSimilarityThresholdLabel(props.duplicateDetection.similarityThresholdPercent) }}
                </span>
              </span>
            </div>

            <input
              v-model.number="props.duplicateDetection.similarityThresholdPercent"
              type="range"
              :min="DUPLICATE_THRESHOLD_MIN_PERCENT"
              :max="DUPLICATE_THRESHOLD_MAX_PERCENT"
              step="1"
              class="w-full cursor-pointer"
              aria-label="Duplicate similarity threshold"
            />

            <div class="flex items-center justify-between text-[10px] text-zinc-500">
              <span>Loose ({{ DUPLICATE_THRESHOLD_MIN_PERCENT }}%)</span>
              <span>Balanced (88%)</span>
              <span>Exact ({{ DUPLICATE_THRESHOLD_MAX_PERCENT }}%)</span>
            </div>

            <p class="text-[11px] text-zinc-400">
              {{ describeSimilarityThreshold(props.duplicateDetection.similarityThresholdPercent) }}
            </p>
          </div>
        </div>
      </div>
    </div>

    <!-- 6. OUTPUT -->
    <div>
      <button
        type="button"
        class="flex w-full items-center justify-between px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-zinc-300 hover:bg-zinc-900/50"
        @click="toggleSection('output')"
      >
        <span class="flex items-center gap-2">
          <Sliders class="h-3.5 w-3.5 text-indigo-400" />
          Output Format
        </span>
        <ChevronDown
          class="h-3.5 w-3.5 text-zinc-500 transition-transform"
          :class="{ '-rotate-90': !openSections.output }"
        />
      </button>

      <div v-if="openSections.output" class="space-y-3.5 px-4 pb-5">
        <!-- Container Format -->
        <div>
          <label class="mb-1.5 block text-xs text-zinc-300">Container</label>
          <div class="grid grid-cols-2 gap-1.5">
            <button
              v-for="formatOption in OUTPUT_FORMAT_OPTIONS"
              :key="formatOption.id"
              type="button"
              class="rounded-md border px-2.5 py-1.5 text-xs font-medium transition"
              :class="
                props.output.format === formatOption.id
                  ? 'border-indigo-500/70 bg-indigo-500/20 text-indigo-200'
                  : 'border-zinc-800 bg-zinc-900/60 text-zinc-400 hover:text-zinc-200'
              "
              @click="props.output.format = formatOption.id"
            >
              {{ formatOption.label }}
            </button>
          </div>
        </div>

        <!-- Resolution Presets -->
        <div>
          <label class="mb-1.5 block text-xs text-zinc-300">Resolution & Aspect</label>
          <div class="grid grid-cols-2 gap-1.5">
            <button
              v-for="preset in RESOLUTION_PRESETS"
              :key="preset.id"
              type="button"
              class="flex flex-col items-start rounded-lg border px-2.5 py-2 text-left transition"
              :class="
                props.output.presetId === preset.id
                  ? 'border-indigo-500/70 bg-indigo-500/20 text-indigo-100'
                  : 'border-zinc-800 bg-zinc-900/60 text-zinc-300 hover:border-zinc-700'
              "
              @click="emit('setResolutionPreset', preset.id)"
            >
              <div class="flex w-full items-center justify-between text-xs font-medium">
                <span>{{ preset.label }}</span>
                <span class="text-[10px] text-zinc-400">{{ preset.aspect }}</span>
              </div>
              <span class="mt-0.5 font-mono text-[10px] text-zinc-500">{{ preset.sublabel }}</span>
            </button>
          </div>
        </div>

        <!-- FPS & Quality -->
        <div class="grid grid-cols-2 gap-2">
          <div>
            <label class="mb-1 block text-xs text-zinc-300">Frame Rate</label>
            <div class="grid grid-cols-2 gap-1">
              <button
                v-for="fpsOption in FRAME_RATE_OPTIONS"
                :key="fpsOption"
                type="button"
                class="rounded-md border py-1 text-xs font-medium transition"
                :class="
                  props.output.fps === fpsOption
                    ? 'border-indigo-500/70 bg-indigo-500/20 text-indigo-200'
                    : 'border-zinc-800 bg-zinc-900/60 text-zinc-400'
                "
                @click="props.output.fps = fpsOption"
              >
                {{ fpsOption }} fps
              </button>
            </div>
          </div>

          <div>
            <label class="mb-1 block text-xs text-zinc-300">Quality</label>
            <div class="grid grid-cols-2 gap-1">
              <button
                v-for="qualityOption in VIDEO_QUALITY_OPTIONS"
                :key="qualityOption.id"
                type="button"
                class="rounded-md border py-1 text-xs font-medium transition"
                :class="
                  props.output.quality === qualityOption.id
                    ? 'border-indigo-500/70 bg-indigo-500/20 text-indigo-200'
                    : 'border-zinc-800 bg-zinc-900/60 text-zinc-400'
                "
                @click="props.output.quality = qualityOption.id"
              >
                {{ qualityOption.label }}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  </aside>
</template>
