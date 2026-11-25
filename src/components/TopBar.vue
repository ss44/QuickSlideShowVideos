<script setup lang="ts">
import { Film, Download, Clock, HardDrive, Images } from 'lucide-vue-next'
import { formatTime } from '../engine/timeline'
import type { OutputConfig } from '../types/slideshow'

const props = defineProps<{
  slideCount: number
  totalDuration: number
  estimatedSizeMB: number
  output: OutputConfig
  canExport: boolean
  beatSnapped: boolean
}>()

const emit = defineEmits<{
  (e: 'export'): void
}>()
</script>

<template>
  <header
    class="flex h-14 shrink-0 items-center justify-between border-b border-zinc-800/80 bg-zinc-950/90 px-4 backdrop-blur"
  >
    <!-- Brand -->
    <div class="flex items-center gap-2.5">
      <div
        class="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-indigo-500 to-violet-600 shadow-sm shadow-indigo-500/20"
      >
        <Film class="h-4 w-4 text-white" />
      </div>
      <div class="leading-tight">
        <h1 class="text-sm font-semibold tracking-tight text-zinc-100">QuickSlideShow</h1>
        <p class="text-[11px] text-zinc-500">100% In-Browser Video Studio</p>
      </div>
    </div>

    <!-- Live Estimates Pill -->
    <div
      class="hidden items-center gap-4 rounded-full border border-zinc-800 bg-zinc-900/80 px-4 py-1.5 text-xs text-zinc-300 md:flex"
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
          ~{{ props.estimatedSizeMB < 1 ? props.estimatedSizeMB.toFixed(1) : Math.round(props.estimatedSizeMB) }} MB
        </span>
        <span class="text-zinc-500">
          · {{ props.output.width }}×{{ props.output.height }} {{ props.output.fps }}fps
        </span>
      </div>
    </div>

    <!-- Export CTA -->
    <button
      type="button"
      :disabled="!props.canExport"
      class="inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-3.5 py-2 text-xs font-semibold text-white shadow-sm shadow-indigo-600/25 transition hover:bg-indigo-500 active:scale-[0.98] disabled:cursor-not-allowed disabled:bg-zinc-800 disabled:text-zinc-500 disabled:shadow-none"
      @click="emit('export')"
    >
      <Download class="h-3.5 w-3.5" />
      <span>Export {{ props.output.format.toUpperCase() }}</span>
    </button>
  </header>
</template>
