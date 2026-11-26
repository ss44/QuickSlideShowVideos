<script setup lang="ts">
import { computed } from 'vue'
import { RotateCcw, X } from 'lucide-vue-next'
import type {
  ColorLook,
  FitMode,
  LabeledOption,
  SlideEffectOverrides,
  SmartEffectsConfig,
} from '../types/slideshow'
import { COLOR_LOOK_OPTIONS, FIT_MODE_OPTIONS } from '../types/slideshow'
import {
  getColorLookLabel,
  getFitModeLabel,
  hasSlideEffectOverrides,
} from '../engine/slideEffects'

type ToggleOverrideChoice = 'default' | 'on' | 'off'

const TOGGLE_OVERRIDE_CHOICES: LabeledOption<ToggleOverrideChoice>[] = [
  { id: 'default', label: 'Default' },
  { id: 'on', label: 'On' },
  { id: 'off', label: 'Off' },
]

const props = defineProps<{
  overrides: SlideEffectOverrides
  globalEffects: SmartEffectsConfig
  slideNumber: number
  slideName: string
}>()

const emit = defineEmits<{
  (e: 'update', overrides: SlideEffectOverrides): void
  (e: 'reset'): void
  (e: 'close'): void
}>()

const hasAnyOverride = computed(() => hasSlideEffectOverrides(props.overrides))
const effectiveFitMode = computed<FitMode>(
  () => props.overrides.fitMode ?? props.globalEffects.fitMode,
)

/**
 * Emits a new overrides object with `key` set, or removed entirely when `value` is undefined,
 * so "Default" always means "inherit the sequence-wide setting" rather than a pinned copy of it.
 */
function applyOverridePatch<TKey extends keyof SlideEffectOverrides>(
  key: TKey,
  value: SlideEffectOverrides[TKey] | undefined,
) {
  const nextOverrides: SlideEffectOverrides = { ...props.overrides }
  if (value === undefined) {
    delete nextOverrides[key]
  } else {
    nextOverrides[key] = value
  }
  emit('update', nextOverrides)
}

function resolveToggleChoice(overrideValue: boolean | undefined): ToggleOverrideChoice {
  if (overrideValue === undefined) return 'default'
  return overrideValue ? 'on' : 'off'
}

function convertToggleChoiceToOverride(choice: ToggleOverrideChoice): boolean | undefined {
  if (choice === 'default') return undefined
  return choice === 'on'
}

function formatToggleDefaultLabel(globalValue: boolean): string {
  return `Default (${globalValue ? 'On' : 'Off'})`
}

function optionButtonClass(isSelected: boolean): string {
  return isSelected
    ? 'border-indigo-500/70 bg-indigo-500/20 text-indigo-200'
    : 'border-zinc-800 bg-zinc-900/60 text-zinc-400 hover:border-zinc-700 hover:text-zinc-200'
}
</script>

<template>
  <div
    role="dialog"
    aria-label="Effects for this slide"
    class="flex max-h-[min(70vh,30rem)] w-72 flex-col overflow-hidden rounded-xl border border-zinc-800 bg-zinc-950/95 text-left shadow-2xl shadow-black/70 backdrop-blur"
  >
    <!-- Header -->
    <div class="flex shrink-0 items-start justify-between gap-2 border-b border-zinc-800/80 px-3 py-2.5">
      <div class="min-w-0">
        <div class="text-xs font-semibold text-zinc-100">Slide {{ props.slideNumber }} Effects</div>
        <div class="truncate text-[11px] text-zinc-500" :title="props.slideName">
          {{ props.slideName }}
        </div>
      </div>
      <button
        type="button"
        class="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-zinc-400 transition hover:bg-zinc-800 hover:text-zinc-100"
        aria-label="Close slide effects"
        @click="emit('close')"
      >
        <X class="h-3.5 w-3.5" />
      </button>
    </div>

    <div class="min-h-0 flex-1 space-y-3 overflow-y-auto overscroll-contain px-3 py-3">
      <p class="text-[11px] leading-relaxed text-zinc-500">
        Overrides apply to this photo only. "Default" follows the Smart Effects settings.
      </p>

      <!-- Framing -->
      <div>
        <div class="mb-1.5 text-[11px] font-medium text-zinc-300">Framing</div>
        <div class="grid grid-cols-2 gap-1.5">
          <button
            type="button"
            class="col-span-2 rounded-md border px-2 py-1.5 text-[11px] font-medium transition"
            :class="optionButtonClass(props.overrides.fitMode === undefined)"
            @click="applyOverridePatch('fitMode', undefined)"
          >
            Default ({{ getFitModeLabel(props.globalEffects.fitMode) }})
          </button>
          <button
            v-for="fitOption in FIT_MODE_OPTIONS"
            :key="fitOption.id"
            type="button"
            class="rounded-md border px-2 py-1.5 text-[11px] font-medium transition"
            :class="optionButtonClass(props.overrides.fitMode === fitOption.id)"
            @click="applyOverridePatch('fitMode', fitOption.id)"
          >
            {{ fitOption.label }}
          </button>
        </div>
        <p v-if="effectiveFitMode === 'cover'" class="mt-1.5 text-[10px] text-zinc-500">
          Drag the photo in the preview to reframe the crop.
        </p>
      </div>

      <!-- Ken Burns -->
      <div>
        <div class="mb-1.5 text-[11px] font-medium text-zinc-300">Ken Burns Motion</div>
        <div class="grid grid-cols-3 gap-1.5">
          <button
            v-for="choice in TOGGLE_OVERRIDE_CHOICES"
            :key="choice.id"
            type="button"
            class="rounded-md border px-1.5 py-1.5 text-[11px] font-medium whitespace-nowrap transition"
            :class="optionButtonClass(resolveToggleChoice(props.overrides.kenBurns) === choice.id)"
            :title="choice.id === 'default' ? formatToggleDefaultLabel(props.globalEffects.kenBurns) : undefined"
            @click="applyOverridePatch('kenBurns', convertToggleChoiceToOverride(choice.id))"
          >
            {{ choice.label }}
          </button>
        </div>
      </div>

      <!-- Color Look -->
      <div>
        <div class="mb-1.5 text-[11px] font-medium text-zinc-300">Color Look</div>
        <div class="grid grid-cols-3 gap-1.5">
          <button
            type="button"
            class="col-span-3 rounded-md border px-2 py-1.5 text-[11px] font-medium transition"
            :class="optionButtonClass(props.overrides.colorLook === undefined)"
            @click="applyOverridePatch('colorLook', undefined)"
          >
            Default ({{ getColorLookLabel(props.globalEffects.colorLook) }})
          </button>
          <button
            v-for="lookOption in COLOR_LOOK_OPTIONS"
            :key="lookOption.id"
            type="button"
            class="rounded-md border px-1.5 py-1.5 text-[11px] font-medium transition"
            :class="optionButtonClass(props.overrides.colorLook === lookOption.id)"
            @click="applyOverridePatch('colorLook', lookOption.id as ColorLook)"
          >
            {{ lookOption.label }}
          </button>
        </div>
      </div>

      <!-- Vignette -->
      <div>
        <div class="mb-1.5 text-[11px] font-medium text-zinc-300">Vignette</div>
        <div class="grid grid-cols-3 gap-1.5">
          <button
            v-for="choice in TOGGLE_OVERRIDE_CHOICES"
            :key="choice.id"
            type="button"
            class="rounded-md border px-1.5 py-1.5 text-[11px] font-medium whitespace-nowrap transition"
            :class="optionButtonClass(resolveToggleChoice(props.overrides.vignette) === choice.id)"
            :title="choice.id === 'default' ? formatToggleDefaultLabel(props.globalEffects.vignette) : undefined"
            @click="applyOverridePatch('vignette', convertToggleChoiceToOverride(choice.id))"
          >
            {{ choice.label }}
          </button>
        </div>
      </div>
    </div>

    <!-- Footer -->
    <div class="flex shrink-0 items-center justify-end border-t border-zinc-800/80 px-3 py-2">
      <button
        type="button"
        :disabled="!hasAnyOverride"
        class="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-medium text-indigo-300 transition hover:bg-indigo-500/15 hover:text-indigo-100 disabled:pointer-events-none disabled:opacity-40"
        @click="emit('reset')"
      >
        <RotateCcw class="h-3 w-3" />
        Reset to defaults
      </button>
    </div>
  </div>
</template>
