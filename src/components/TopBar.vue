<script setup lang="ts">
import {
  Check,
  Clock,
  Download,
  FolderOpen,
  HardDrive,
  Images,
  Loader2,
  MonitorDown,
  Save,
  Share,
  X,
} from 'lucide-vue-next'
import BrandMark from './BrandMark.vue'
import { formatEstimatedSizeMB, formatTime } from '../utils/formatters'
import type { OutputConfig } from '../types/slideshow'

const props = defineProps<{
  slideCount: number
  totalDuration: number
  estimatedSizeMB: number
  output: OutputConfig
  canExport: boolean
  beatSnapped: boolean
  canOfferInstall: boolean
  isInstalling: boolean
  isIosInstructionsOpen: boolean
  activeProjectName: string
  hasUnsavedChanges: boolean
  savedProjectCount: number
  isSavingProject: boolean
  justSavedFeedback: boolean
}>()

const emit = defineEmits<{
  (e: 'export'): void
  (e: 'install'): void
  (e: 'close-ios-instructions'): void
  (e: 'save-project'): void
  (e: 'open-projects'): void
}>()
</script>

<template>
  <header
    class="relative z-30 flex h-14 shrink-0 items-center justify-between gap-2 border-b border-zinc-800/80 bg-zinc-950/90 px-4 backdrop-blur"
  >
    <!-- Brand -->
    <div class="flex min-w-0 items-center gap-2.5">
      <BrandMark class="h-8 w-8 shrink-0 rounded-lg shadow-sm shadow-pink-500/20" />
      <div class="min-w-0 leading-tight">
        <h1 class="text-sm font-semibold tracking-tight text-zinc-100">Quick Slide Show</h1>
        <p v-if="props.activeProjectName" class="flex items-center gap-1.5 truncate text-[11px] text-zinc-400">
          <span class="truncate">{{ props.activeProjectName }}</span>
          <span
            v-if="props.hasUnsavedChanges"
            class="h-1.5 w-1.5 shrink-0 rounded-full bg-amber-400"
            title="Unsaved changes"
          />
        </p>
        <p v-else class="text-[11px] text-zinc-500">100% In-Browser Video Studio</p>
      </div>
    </div>

    <!-- Live Estimates Pill -->
    <div
      class="hidden items-center gap-4 rounded-full border border-zinc-800 bg-zinc-900/80 px-4 py-1.5 text-xs text-zinc-300 lg:flex"
    >
      <div class="flex items-center gap-1.5" title="Total photos">
        <Images class="h-3.5 w-3.5 text-zinc-400" />
        <span class="font-medium text-zinc-100">{{ props.slideCount }}</span>
        <span class="text-zinc-500">{{ props.slideCount === 1 ? 'photo' : 'photos' }}</span>
      </div>

      <span class="h-3 w-px bg-zinc-800" />

      <div class="flex items-center gap-1.5" title="Estimated video duration">
        <Clock class="h-3.5 w-3.5 text-indigo-400" />
        <span class="font-mono font-medium text-zinc-100">{{ formatTime(props.totalDuration) }}</span>
        <span
          v-if="props.beatSnapped"
          class="rounded bg-indigo-500/15 px-1.5 py-0.5 text-[10px] font-medium text-indigo-300"
        >
          Beat Sync
        </span>
      </div>

      <span class="h-3 w-px bg-zinc-800" />

      <div class="flex items-center gap-1.5" title="Estimated output file size">
        <HardDrive class="h-3.5 w-3.5 text-zinc-400" />
        <span class="font-mono text-zinc-200">
          ~{{ formatEstimatedSizeMB(props.estimatedSizeMB) }}
        </span>
        <span class="text-zinc-500">
          · {{ props.output.width }}×{{ props.output.height }} {{ props.output.fps }}fps
        </span>
      </div>
    </div>

    <!-- Actions: Projects + Save + Install PWA + Export CTA -->
    <div class="relative flex shrink-0 items-center gap-2">
      <button
        type="button"
        title="Open or manage saved local projects"
        class="inline-flex items-center gap-1.5 rounded-lg border border-zinc-700/80 bg-zinc-900 px-3 py-2 text-xs font-medium text-zinc-200 transition hover:border-zinc-600 hover:bg-zinc-800 hover:text-white active:scale-[0.98]"
        @click="emit('open-projects')"
      >
        <FolderOpen class="h-3.5 w-3.5 text-indigo-400" />
        <span class="hidden sm:inline">Projects</span>
        <span
          v-if="props.savedProjectCount > 0"
          class="rounded-full bg-zinc-800 px-1.5 py-0.25 font-mono text-[10px] text-zinc-300"
        >
          {{ props.savedProjectCount }}
        </span>
      </button>

      <button
        type="button"
        :disabled="props.slideCount === 0 || props.isSavingProject"
        :title="
          props.activeProjectName
            ? `Save changes to '${props.activeProjectName}' (Ctrl+S)`
            : 'Save project locally in this browser (Ctrl+S)'
        "
        class="relative inline-flex items-center gap-1.5 rounded-lg border px-3 py-2 text-xs font-medium transition active:scale-[0.98] disabled:cursor-not-allowed disabled:border-zinc-800 disabled:bg-zinc-900/50 disabled:text-zinc-600"
        :class="
          props.justSavedFeedback
            ? 'border-emerald-500/50 bg-emerald-500/15 text-emerald-300'
            : 'border-zinc-700/80 bg-zinc-900 text-zinc-200 hover:border-zinc-600 hover:bg-zinc-800 hover:text-white'
        "
        @click="emit('save-project')"
      >
        <Loader2 v-if="props.isSavingProject" class="h-3.5 w-3.5 animate-spin text-indigo-400" />
        <Check v-else-if="props.justSavedFeedback" class="h-3.5 w-3.5 text-emerald-400" />
        <Save v-else class="h-3.5 w-3.5 text-indigo-400" />
        <span class="hidden sm:inline">
          {{ props.isSavingProject ? 'Saving…' : props.justSavedFeedback ? 'Saved' : 'Save' }}
        </span>
        <span
          v-if="props.hasUnsavedChanges && props.slideCount > 0 && !props.isSavingProject && !props.justSavedFeedback"
          class="h-1.5 w-1.5 rounded-full bg-amber-400"
        />
      </button>

      <button
        v-if="props.canOfferInstall"
        type="button"
        :disabled="props.isInstalling"
        title="Install Quick Slide Show locally for offline desktop & mobile use"
        class="inline-flex items-center gap-1.5 rounded-lg border border-zinc-700/80 bg-zinc-900 px-3 py-2 text-xs font-medium text-zinc-200 transition hover:border-zinc-600 hover:bg-zinc-800 hover:text-white active:scale-[0.98] disabled:cursor-wait disabled:opacity-60"
        @click="emit('install')"
      >
        <MonitorDown class="h-3.5 w-3.5 text-indigo-400" />
        <span class="hidden md:inline">{{ props.isInstalling ? 'Installing…' : 'Install App' }}</span>
      </button>

      <!-- iOS Safari Add-to-Home-Screen Popover -->
      <div
        v-if="props.isIosInstructionsOpen"
        class="absolute right-0 top-12 z-40 w-72 rounded-xl border border-zinc-800 bg-zinc-900/95 p-3.5 text-xs text-zinc-300 shadow-2xl shadow-black/60 backdrop-blur"
        role="dialog"
        aria-label="Install Quick Slide Show on iOS"
      >
        <div class="mb-2 flex items-center justify-between">
          <span class="font-semibold text-zinc-100">Install Quick Slide Show</span>
          <button
            type="button"
            class="rounded p-0.5 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200"
            aria-label="Close install instructions"
            @click="emit('close-ios-instructions')"
          >
            <X class="h-3.5 w-3.5" />
          </button>
        </div>
        <p class="leading-relaxed text-zinc-400">
          Tap <Share class="mx-0.5 inline h-3.5 w-3.5 text-indigo-400" /> <strong class="text-zinc-200">Share</strong> in Safari, then choose
          <strong class="text-zinc-200">Add to Home Screen</strong> to use Quick Slide Show offline like a native app.
        </p>
      </div>

      <button
        type="button"
        :disabled="!props.canExport"
        class="inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-3.5 py-2 text-xs font-semibold text-white shadow-sm shadow-indigo-600/25 transition hover:bg-indigo-500 active:scale-[0.98] disabled:cursor-not-allowed disabled:bg-zinc-800 disabled:text-zinc-500 disabled:shadow-none"
        @click="emit('export')"
      >
        <Download class="h-3.5 w-3.5" />
        <span>Export {{ props.output.format.toUpperCase() }}</span>
      </button>
    </div>
  </header>
</template>
