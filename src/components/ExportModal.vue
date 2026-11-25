<script setup lang="ts">
import { computed } from 'vue'
import { Download, X, CheckCircle2, AlertCircle, Loader2 } from 'lucide-vue-next'
import type { ExportProgress, OutputConfig } from '../types/slideshow'
import { formatBytesToMB, formatTime } from '../utils/formatters'

const props = defineProps<{
  open: boolean
  progress: ExportProgress | null
  output: OutputConfig
  slideCount: number
  totalDuration: number
}>()

const emit = defineEmits<{
  (e: 'cancel'): void
  (e: 'close'): void
  (e: 'downloadAgain'): void
}>()

const isEncodingInProgress = computed(() => {
  const phase = props.progress?.phase
  return (
    phase === 'preparing' ||
    phase === 'audio' ||
    phase === 'rendering' ||
    phase === 'finalizing'
  )
})

const formattedFileSize = computed(() => formatBytesToMB(props.progress?.fileSizeBytes))

const estimatedRemainingText = computed(() => {
  const remainingMs = props.progress?.estimatedRemainingMs
  if (remainingMs === null || remainingMs === undefined) return 'Calculating…'
  return `~${formatTime(Math.ceil(remainingMs / 1000))} remaining`
})
</script>

<template>
  <Teleport to="body">
    <div
      v-if="props.open && props.progress"
      class="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4 backdrop-blur-sm"
    >
      <div
        class="w-full max-w-md rounded-2xl border border-zinc-800 bg-zinc-950 p-6 shadow-2xl"
      >
        <div class="flex items-start justify-between">
          <div>
            <h3 class="text-base font-semibold text-zinc-100">
              <span v-if="props.progress.phase === 'done'">Video Ready!</span>
              <span v-else-if="props.progress.phase === 'error'">Export Failed</span>
              <span v-else-if="props.progress.phase === 'cancelled'">Export Cancelled</span>
              <span v-else>Rendering {{ props.output.format.toUpperCase() }}</span>
            </h3>
            <p class="mt-0.5 text-xs text-zinc-400">
              {{ props.slideCount }} photos · {{ formatTime(props.totalDuration) }} ·
              {{ props.output.width }}×{{ props.output.height }} @ {{ props.output.fps }}fps
            </p>
          </div>
          <button
            v-if="!isEncodingInProgress"
            type="button"
            class="rounded-lg p-1 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200"
            @click="emit('close')"
          >
            <X class="h-4 w-4" />
          </button>
        </div>

        <!-- Active Progress -->
        <div v-if="isEncodingInProgress" class="mt-6 space-y-3">
          <div class="flex items-center justify-between text-xs">
            <span class="flex items-center gap-2 text-zinc-300">
              <Loader2 class="h-3.5 w-3.5 animate-spin text-indigo-400" />
              {{ props.progress.message }}
            </span>
            <span class="font-mono font-semibold text-indigo-300">{{ props.progress.percent }}%</span>
          </div>

          <div class="h-2.5 w-full overflow-hidden rounded-full bg-zinc-800">
            <div
              class="h-full rounded-full bg-gradient-to-r from-indigo-500 to-violet-500 transition-[width] duration-150"
              :style="{ width: `${props.progress.percent}%` }"
            />
          </div>

          <div class="flex items-center justify-between text-[11px] text-zinc-500">
            <span>Elapsed: {{ formatTime(Math.floor(props.progress.elapsedMs / 1000)) }}</span>
            <span>{{ estimatedRemainingText }}</span>
          </div>

          <p class="rounded-lg bg-zinc-900/80 p-2.5 text-[11px] text-zinc-400">
            Everything is encoding directly in your browser. Keep this tab open until complete.
          </p>

          <div class="flex justify-end pt-1">
            <button
              type="button"
              class="rounded-lg border border-zinc-700 bg-zinc-900 px-3.5 py-1.5 text-xs font-medium text-zinc-300 hover:bg-zinc-800"
              @click="emit('cancel')"
            >
              Cancel Export
            </button>
          </div>
        </div>

        <!-- Done -->
        <div v-else-if="props.progress.phase === 'done'" class="mt-6 space-y-4">
          <div
            class="flex items-center gap-3 rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-3.5"
          >
            <CheckCircle2 class="h-6 w-6 shrink-0 text-emerald-400" />
            <div class="min-w-0 text-xs">
              <div class="truncate font-semibold text-emerald-200">{{ props.progress.fileName }}</div>
              <div class="mt-0.5 text-emerald-300/80">
                {{ formattedFileSize }} · Rendered in
                {{ formatTime(Math.max(1, Math.round(props.progress.elapsedMs / 1000))) }}
              </div>
            </div>
          </div>

          <div class="flex items-center justify-end gap-2">
            <button
              type="button"
              class="rounded-lg border border-zinc-700 bg-zinc-900 px-3.5 py-2 text-xs font-medium text-zinc-300 hover:bg-zinc-800"
              @click="emit('close')"
            >
              Done
            </button>
            <button
              type="button"
              class="inline-flex items-center gap-1.5 rounded-lg bg-indigo-600 px-4 py-2 text-xs font-semibold text-white hover:bg-indigo-500"
              @click="emit('downloadAgain')"
            >
              <Download class="h-3.5 w-3.5" />
              Download Again
            </button>
          </div>
        </div>

        <!-- Error / Cancelled -->
        <div v-else class="mt-6 space-y-4">
          <div
            class="flex items-start gap-2.5 rounded-xl border border-red-500/30 bg-red-500/10 p-3.5 text-xs text-red-200"
          >
            <AlertCircle class="mt-0.5 h-4 w-4 shrink-0 text-red-400" />
            <p class="leading-relaxed">{{ props.progress.message }}</p>
          </div>

          <div class="flex justify-end">
            <button
              type="button"
              class="rounded-lg bg-zinc-800 px-4 py-2 text-xs font-medium text-zinc-200 hover:bg-zinc-700"
              @click="emit('close')"
            >
              Close
            </button>
          </div>
        </div>
      </div>
    </div>
  </Teleport>
</template>
