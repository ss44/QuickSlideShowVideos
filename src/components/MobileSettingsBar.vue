<script setup lang="ts">
import type { Component } from 'vue'
import { Clock, Info, Music, ScanSearch, Sliders, Sparkles, Wand2 } from 'lucide-vue-next'
import { SETTINGS_SECTIONS, type SettingsSectionId } from '../config/settingsSections'

const props = defineProps<{
  activeSection: SettingsSectionId | null
  selectedTransitionCount: number
  hasMusicLoaded: boolean
  duplicateFinderEnabled: boolean
  removableDuplicateCount: number
}>()

const emit = defineEmits<{
  (e: 'toggleSection', sectionId: SettingsSectionId): void
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
</script>

<template>
  <nav
    aria-label="Slideshow settings"
    class="z-30 shrink-0 border-t border-zinc-800/90 bg-zinc-950/95 pb-[env(safe-area-inset-bottom)] backdrop-blur md:hidden"
  >
    <div class="grid grid-cols-7">
      <button
        v-for="section in SETTINGS_SECTIONS"
        :key="section.id"
        type="button"
        :aria-label="section.title"
        :aria-pressed="props.activeSection === section.id"
        class="relative flex min-h-[54px] flex-col items-center justify-center gap-1 px-0.5 py-1.5 transition active:bg-zinc-900"
        :class="
          props.activeSection === section.id
            ? 'bg-indigo-500/10 text-indigo-300'
            : 'text-zinc-400 hover:text-zinc-200'
        "
        @click="emit('toggleSection', section.id)"
      >
        <!-- Active top accent bar -->
        <span
          v-if="props.activeSection === section.id"
          class="absolute inset-x-2 top-0 h-0.5 rounded-full bg-indigo-500"
        />

        <span class="relative flex items-center justify-center">
          <component
            :is="SECTION_ICONS[section.id]"
            class="h-4 w-4"
            :class="
              section.id === 'duplicates' &&
              props.duplicateFinderEnabled &&
              props.removableDuplicateCount > 0
                ? 'text-amber-400'
                : props.activeSection === section.id
                  ? 'text-indigo-400'
                  : ''
            "
          />

          <!-- Active music indicator dot -->
          <span
            v-if="section.id === 'music' && props.hasMusicLoaded"
            class="absolute -top-0.5 -right-1 h-1.5 w-1.5 rounded-full bg-indigo-400 ring-2 ring-zinc-950"
          />

          <!-- Duplicate count badge -->
          <span
            v-else-if="
              section.id === 'duplicates' &&
              props.duplicateFinderEnabled &&
              props.removableDuplicateCount > 0
            "
            class="absolute -top-1.5 -right-2.5 flex min-w-[14px] items-center justify-center rounded-full bg-amber-500 px-1 font-mono text-[9px] leading-tight font-bold text-zinc-950"
          >
            {{ props.removableDuplicateCount > 99 ? '99+' : props.removableDuplicateCount }}
          </span>

          <!-- Selected transitions count dot when multiple selected -->
          <span
            v-else-if="section.id === 'transitions' && props.selectedTransitionCount > 1"
            class="absolute -top-1.5 -right-2.5 flex min-w-[14px] items-center justify-center rounded-full bg-zinc-800 px-1 font-mono text-[9px] leading-tight font-semibold text-zinc-200 ring-1 ring-zinc-700"
          >
            {{ props.selectedTransitionCount }}
          </span>
        </span>

        <span class="max-w-full truncate text-[10px] leading-none font-medium tracking-tight">
          {{ section.mobileLabel }}
        </span>
      </button>
    </div>
  </nav>
</template>
