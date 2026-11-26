<script setup lang="ts">
import { computed, type Component } from 'vue'
import { Clock, Info, Music, ScanSearch, Sliders, Sparkles, Wand2, X } from 'lucide-vue-next'
import type {
  DuplicateDetectionConfig,
  MusicConfig,
  OutputConfig,
  SmartEffectsConfig,
  TimingConfig,
  TransitionOrderMode,
  TransitionType,
} from '../types/slideshow'
import { SETTINGS_SECTIONS, type SettingsSectionId } from '../config/settingsSections'
import SettingsSectionPanel from './SettingsSectionPanel.vue'

const SWIPE_DISMISS_THRESHOLD_PX = 64

const props = defineProps<{
  activeSection: SettingsSectionId | null
  timing: TimingConfig
  selectedTransitions: TransitionType[]
  transitionOrder: TransitionOrderMode
  effects: SmartEffectsConfig
  music: MusicConfig
  output: OutputConfig
  duplicateDetection: DuplicateDetectionConfig
  removableDuplicateCount: number
}>()

const emit = defineEmits<{
  (e: 'close'): void
  (e: 'toggleTransition', type: TransitionType): void
  (e: 'selectAllTransitions'): void
  (e: 'update:transitionOrder', order: TransitionOrderMode): void
  (e: 'loadMusicFile', file: File): void
  (e: 'loadMusicUrl', url: string): void
  (e: 'clearMusic'): void
  (e: 'setResolutionPreset', presetId: string): void
}>()

const SECTION_ICONS: Record<SettingsSectionId, Component> = {
  timing: Clock,
  transitions: Wand2,
  effects: Sparkles,
  music: Music,
  duplicates: ScanSearch,
  output: Sliders,
  about: Info,
}

const activeSectionMeta = computed(() =>
  props.activeSection
    ? (SETTINGS_SECTIONS.find((section) => section.id === props.activeSection) ?? null)
    : null,
)

let touchStartX = 0
let touchStartY = 0
let isTrackingSwipe = false

function onDrawerTouchStart(event: TouchEvent) {
  // Ignore horizontal gestures starting on range sliders so dragging sliders never dismisses the drawer
  const targetElement = event.target as HTMLElement | null
  if (targetElement?.closest('input[type="range"]')) {
    isTrackingSwipe = false
    return
  }

  const firstTouch = event.touches[0]
  if (!firstTouch) return
  touchStartX = firstTouch.clientX
  touchStartY = firstTouch.clientY
  isTrackingSwipe = true
}

function onDrawerTouchEnd(event: TouchEvent) {
  if (!isTrackingSwipe) return
  isTrackingSwipe = false

  const changedTouch = event.changedTouches[0]
  if (!changedTouch) return
  const deltaX = changedTouch.clientX - touchStartX
  const deltaY = Math.abs(changedTouch.clientY - touchStartY)

  // Dismiss only on an intentional rightward swipe that is predominantly horizontal
  if (deltaX >= SWIPE_DISMISS_THRESHOLD_PX && deltaX > deltaY * 1.4) {
    emit('close')
  }
}
</script>

<template>
  <div class="pointer-events-none absolute inset-0 z-30 overflow-hidden md:hidden">
    <!-- Dimmed Backdrop -->
    <Transition
      enter-active-class="transition-opacity duration-200 ease-out"
      enter-from-class="opacity-0"
      enter-to-class="opacity-100"
      leave-active-class="transition-opacity duration-150 ease-in"
      leave-from-class="opacity-100"
      leave-to-class="opacity-0"
    >
      <div
        v-if="props.activeSection !== null"
        class="pointer-events-auto absolute inset-0 bg-black/55 backdrop-blur-[1px]"
        aria-hidden="true"
        @click="emit('close')"
      />
    </Transition>

    <!-- Slide-Out Right Panel -->
    <Transition
      enter-active-class="transition-transform duration-200 ease-out"
      enter-from-class="translate-x-full"
      enter-to-class="translate-x-0"
      leave-active-class="transition-transform duration-150 ease-in"
      leave-from-class="translate-x-0"
      leave-to-class="translate-x-full"
    >
      <aside
        v-if="props.activeSection !== null && activeSectionMeta"
        role="dialog"
        aria-modal="true"
        :aria-label="`${activeSectionMeta.title} settings`"
        class="pointer-events-auto absolute inset-y-0 right-0 flex w-[min(86vw,340px)] flex-col border-l border-zinc-800/90 bg-zinc-950 shadow-2xl shadow-black/80"
        @touchstart.passive="onDrawerTouchStart"
        @touchend.passive="onDrawerTouchEnd"
      >
        <!-- Drawer Header -->
        <div
          class="flex shrink-0 items-center justify-between border-b border-zinc-800/80 px-4 py-3"
        >
          <div class="flex min-w-0 items-center gap-2">
            <component
              :is="SECTION_ICONS[props.activeSection]"
              class="h-4 w-4 shrink-0"
              :class="props.activeSection === 'duplicates' ? 'text-amber-400' : 'text-indigo-400'"
            />
            <h2 class="truncate text-xs font-semibold uppercase tracking-wider text-zinc-100">
              {{ activeSectionMeta.title }}
            </h2>
            <span
              v-if="props.activeSection === 'transitions'"
              class="rounded-full bg-zinc-800 px-1.5 py-0.5 text-[10px] font-medium text-zinc-300"
            >
              {{ props.selectedTransitions.length }}
            </span>
            <span
              v-else-if="
                props.activeSection === 'duplicates' &&
                props.duplicateDetection.enabled &&
                props.removableDuplicateCount > 0
              "
              class="rounded-full bg-amber-500/20 px-1.5 py-0.5 text-[10px] font-medium text-amber-300"
            >
              {{ props.removableDuplicateCount }}
            </span>
          </div>

          <button
            type="button"
            class="flex h-8 w-8 items-center justify-center rounded-lg text-zinc-400 transition hover:bg-zinc-800 hover:text-zinc-100 active:scale-95"
            aria-label="Close settings panel"
            @click="emit('close')"
          >
            <X class="h-4 w-4" />
          </button>
        </div>

        <!-- Scrollable Settings Body (no collapsible accordions) -->
        <div class="min-h-0 flex-1 overflow-y-auto overscroll-contain p-4">
          <SettingsSectionPanel
            :section="props.activeSection"
            :timing="props.timing"
            :selected-transitions="props.selectedTransitions"
            :transition-order="props.transitionOrder"
            :effects="props.effects"
            :music="props.music"
            :output="props.output"
            :duplicate-detection="props.duplicateDetection"
            @toggle-transition="emit('toggleTransition', $event)"
            @select-all-transitions="emit('selectAllTransitions')"
            @update:transition-order="emit('update:transitionOrder', $event)"
            @load-music-file="emit('loadMusicFile', $event)"
            @load-music-url="emit('loadMusicUrl', $event)"
            @clear-music="emit('clearMusic')"
            @set-resolution-preset="emit('setResolutionPreset', $event)"
          />
        </div>
      </aside>
    </Transition>
  </div>
</template>
