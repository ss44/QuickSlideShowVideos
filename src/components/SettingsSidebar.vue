<script setup lang="ts">
import { ref, type Component } from 'vue'
import {
  ChevronDown,
  Clock,
  Info,
  Music,
  ScanSearch,
  Sliders,
  Sparkles,
  Wand2,
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
import { SETTINGS_SECTIONS, type SettingsSectionId } from '../config/settingsSections'
import SettingsSectionPanel from './SettingsSectionPanel.vue'

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

const SECTION_ICONS: Record<SettingsSectionId, Component> = {
  timing: Clock,
  transitions: Wand2,
  effects: Sparkles,
  music: Music,
  duplicates: ScanSearch,
  output: Sliders,
  about: Info,
}

const openSections = ref<Record<SettingsSectionId, boolean>>({
  timing: true,
  transitions: true,
  effects: false,
  music: false,
  duplicates: false,
  output: false,
  about: false,
})

function toggleSection(sectionKey: SettingsSectionId) {
  openSections.value[sectionKey] = !openSections.value[sectionKey]
}
</script>

<template>
  <!-- Desktop-only right sidebar; mobile uses MobileSettingsBar + MobileSettingsDrawer -->
  <aside
    class="hidden h-full w-[300px] shrink-0 flex-col overflow-y-auto border-l border-zinc-800/80 bg-zinc-950 md:flex lg:w-[340px]"
  >
    <div
      v-for="(section, index) in SETTINGS_SECTIONS"
      :key="section.id"
      :class="index < SETTINGS_SECTIONS.length - 1 ? 'border-b border-zinc-800/80' : ''"
    >
      <button
        type="button"
        class="flex w-full items-center justify-between px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-zinc-300 hover:bg-zinc-900/50"
        :aria-expanded="openSections[section.id]"
        @click="toggleSection(section.id)"
      >
        <span class="flex items-center gap-2">
          <component
            :is="SECTION_ICONS[section.id]"
            class="h-3.5 w-3.5"
            :class="section.id === 'duplicates' ? 'text-amber-400' : 'text-indigo-400'"
          />
          {{ section.title }}
          <span
            v-if="section.id === 'transitions'"
            class="rounded-full bg-zinc-800 px-1.5 py-0.5 text-[10px] font-medium text-zinc-300"
          >
            {{ props.selectedTransitions.length }}
          </span>
          <span
            v-else-if="
              section.id === 'duplicates' &&
              props.duplicateDetection.enabled &&
              props.removableDuplicateCount > 0
            "
            class="rounded-full bg-amber-500/20 px-1.5 py-0.5 text-[10px] font-medium text-amber-300"
          >
            {{ props.removableDuplicateCount }}
          </span>
        </span>
        <ChevronDown
          class="h-3.5 w-3.5 text-zinc-500 transition-transform"
          :class="{ '-rotate-90': !openSections[section.id] }"
        />
      </button>

      <div
        v-if="openSections[section.id]"
        class="px-4"
        :class="section.id === 'output' || section.id === 'about' ? 'pb-5' : 'pb-4'"
      >
        <SettingsSectionPanel
          :section="section.id"
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
    </div>
  </aside>
</template>
