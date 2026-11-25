<script setup lang="ts">
import { ref } from 'vue'
import {
  Plus,
  Trash2,
  RotateCw,
  ArrowUpDown,
  Shuffle,
  Maximize2,
  Minimize2,
  GripVertical,
  CopyMinus,
} from 'lucide-vue-next'
import type { DuplicateAnalysis, SlideImage, SlideSortMode } from '../types/slideshow'
import { SLIDE_SORT_OPTIONS } from '../types/slideshow'

const props = defineProps<{
  slides: SlideImage[]
  activeSlideIndex: number
  duplicateAnalysis: DuplicateAnalysis
}>()

const emit = defineEmits<{
  (e: 'addMore'): void
  (e: 'removeDuplicates'): void
  (e: 'jumpTo', index: number): void
  (e: 'remove', id: string): void
  (e: 'rotate', id: string): void
  (e: 'reorder', fromIndex: number, toIndex: number): void
  (e: 'sort', mode: SlideSortMode): void
  (e: 'clearAll'): void
}>()

const isGridExpanded = ref(false)
const draggedSlideIndex = ref<number | null>(null)
const dragTargetSlideIndex = ref<number | null>(null)
const isSortMenuOpen = ref(false)

function onDragStart(event: DragEvent, index: number) {
  draggedSlideIndex.value = index
  if (event.dataTransfer) {
    event.dataTransfer.effectAllowed = 'move'
    event.dataTransfer.setData('text/plain', String(index))
  }
}

function onDragOver(event: DragEvent, index: number) {
  event.preventDefault()
  if (draggedSlideIndex.value === null) return
  dragTargetSlideIndex.value = index
}

function onDrop(event: DragEvent, targetIndex: number) {
  event.preventDefault()
  if (draggedSlideIndex.value !== null && draggedSlideIndex.value !== targetIndex) {
    emit('reorder', draggedSlideIndex.value, targetIndex)
  }
  draggedSlideIndex.value = null
  dragTargetSlideIndex.value = null
}

function onDragEnd() {
  draggedSlideIndex.value = null
  dragTargetSlideIndex.value = null
}

function applySortMode(sortMode: SlideSortMode) {
  emit('sort', sortMode)
  isSortMenuOpen.value = false
}

function isDuplicateSlide(slideId: string): boolean {
  return props.duplicateAnalysis.duplicateSlideIds.has(slideId)
}

function getSlideTooltip(slide: SlideImage): string {
  const copyCount = props.duplicateAnalysis.copyCountBySlideId.get(slide.id)
  if (!copyCount) return slide.name
  const matchKind = props.duplicateAnalysis.matchKindBySlideId.get(slide.id)
  if (matchKind === 'similar') {
    return `${slide.name} — Similar photo (${copyCount} matches)`
  }
  return `${slide.name} — Exact duplicate (${copyCount} copies)`
}

function getDuplicateBadgeLabel(slideId: string): string {
  return props.duplicateAnalysis.matchKindBySlideId.get(slideId) === 'similar' ? 'Sim' : 'Dup'
}

function getSlideCardBorderClass(slide: SlideImage, slideIndex: number): string {
  const isActive = slideIndex === props.activeSlideIndex
  const isDuplicate = isDuplicateSlide(slide.id)

  if (isDuplicate && isActive) {
    return 'border-2 border-amber-400 ring-2 ring-indigo-500/70'
  }
  if (isDuplicate) {
    return 'border-2 border-amber-400/90 ring-1 ring-amber-500/30 hover:border-amber-300'
  }
  if (isActive) {
    return 'border border-indigo-500 ring-2 ring-indigo-500/40'
  }
  return 'border border-zinc-800 hover:border-zinc-600'
}
</script>

<template>
  <section
    class="flex shrink-0 flex-col border-t border-zinc-800/80 bg-zinc-950 transition-all"
    :class="isGridExpanded ? 'h-80' : 'h-44'"
  >
    <!-- Filmstrip Header -->
    <div class="flex h-10 shrink-0 items-center justify-between border-b border-zinc-800/60 px-4">
      <div class="flex items-center gap-2 text-xs">
        <span class="font-semibold text-zinc-200">Slides</span>
        <span class="rounded-full bg-zinc-800 px-2 py-0.5 font-mono text-[11px] text-zinc-300">
          {{ props.slides.length }}
        </span>
        <span v-if="props.slides.length > 1" class="hidden text-[11px] text-zinc-500 sm:inline">
          Drag thumbnails to reorder
        </span>
      </div>

      <div class="flex items-center gap-1.5">
        <button
          v-if="props.duplicateAnalysis.removableCount > 0"
          type="button"
          class="inline-flex items-center gap-1.5 rounded-md border border-amber-500/40 bg-amber-500/15 px-2.5 py-1 text-xs font-medium text-amber-300 transition hover:bg-amber-500/25 hover:text-amber-200"
          :title="`Remove ${props.duplicateAnalysis.removableCount} duplicate ${props.duplicateAnalysis.removableCount === 1 ? 'photo' : 'photos'} (keeps the highest-resolution copy of each)`"
          @click="emit('removeDuplicates')"
        >
          <CopyMinus class="h-3.5 w-3.5" />
          <span>Remove Duplicates</span>
          <span
            class="rounded-full bg-amber-500/25 px-1.5 py-0.25 font-mono text-[10px] font-semibold text-amber-200"
          >
            {{ props.duplicateAnalysis.removableCount }}
          </span>
        </button>

        <button
          type="button"
          class="inline-flex items-center gap-1.5 rounded-md bg-zinc-800 px-2.5 py-1 text-xs font-medium text-zinc-200 transition hover:bg-zinc-700"
          @click="emit('addMore')"
        >
          <Plus class="h-3.5 w-3.5" />
          Add Photos
        </button>

        <!-- Sort Dropdown -->
        <div v-if="props.slides.length > 1" class="relative">
          <button
            type="button"
            class="inline-flex items-center gap-1 rounded-md border border-zinc-800 bg-zinc-900 px-2 py-1 text-xs text-zinc-300 transition hover:bg-zinc-800"
            @click="isSortMenuOpen = !isSortMenuOpen"
          >
            <ArrowUpDown class="h-3.5 w-3.5" />
            Sort
          </button>

          <div
            v-if="isSortMenuOpen"
            class="absolute right-0 bottom-full z-30 mb-1.5 w-40 rounded-lg border border-zinc-800 bg-zinc-900 py-1 shadow-xl"
          >
            <button
              v-for="sortOption in SLIDE_SORT_OPTIONS"
              :key="sortOption.id"
              type="button"
              class="block w-full px-3 py-1.5 text-left text-xs text-zinc-200 hover:bg-zinc-800"
              @click="applySortMode(sortOption.id)"
            >
              {{ sortOption.label }}
            </button>
            <button
              type="button"
              class="flex w-full items-center gap-1.5 px-3 py-1.5 text-left text-xs text-zinc-200 hover:bg-zinc-800"
              @click="applySortMode('shuffle')"
            >
              <Shuffle class="h-3 w-3 text-indigo-400" />
              Shuffle
            </button>
          </div>
        </div>

        <button
          v-if="props.slides.length > 0"
          type="button"
          class="rounded-md border border-zinc-800 bg-zinc-900 p-1.5 text-zinc-400 transition hover:bg-zinc-800 hover:text-zinc-200"
          :title="isGridExpanded ? 'Compact strip' : 'Expand grid'"
          @click="isGridExpanded = !isGridExpanded"
        >
          <Minimize2 v-if="isGridExpanded" class="h-3.5 w-3.5" />
          <Maximize2 v-else class="h-3.5 w-3.5" />
        </button>

        <button
          v-if="props.slides.length > 0"
          type="button"
          class="rounded-md border border-zinc-800 bg-zinc-900 p-1.5 text-zinc-400 transition hover:bg-red-950/60 hover:text-red-400"
          title="Clear all photos"
          @click="emit('clearAll')"
        >
          <Trash2 class="h-3.5 w-3.5" />
        </button>
      </div>
    </div>

    <!-- Thumbnail List / Grid -->
    <div
      v-if="props.slides.length === 0"
      class="flex flex-1 items-center justify-center text-xs text-zinc-500"
    >
      Your photo timeline will appear here once you add images.
    </div>

    <div
      v-else
      class="flex-1 p-3"
      :class="
        isGridExpanded
          ? 'grid grid-cols-3 gap-2.5 overflow-y-auto sm:grid-cols-5 md:grid-cols-7 lg:grid-cols-9'
          : 'flex items-center gap-2.5 overflow-x-auto overflow-y-hidden'
      "
    >
      <div
        v-for="(slide, slideIndex) in props.slides"
        :key="slide.id"
        draggable="true"
        :title="getSlideTooltip(slide)"
        class="group relative shrink-0 cursor-pointer overflow-hidden rounded-lg bg-zinc-900 transition"
        :class="[
          isGridExpanded ? 'aspect-[4/3] w-full' : 'h-24 w-32',
          getSlideCardBorderClass(slide, slideIndex),
          dragTargetSlideIndex === slideIndex && draggedSlideIndex !== slideIndex
            ? 'scale-[1.03] ring-2 ring-sky-400'
            : '',
          draggedSlideIndex === slideIndex ? 'opacity-40' : '',
        ]"
        @click="emit('jumpTo', slideIndex)"
        @dragstart="onDragStart($event, slideIndex)"
        @dragover="onDragOver($event, slideIndex)"
        @drop="onDrop($event, slideIndex)"
        @dragend="onDragEnd"
      >
        <img
          v-if="slide.thumbnailUrl"
          :src="slide.thumbnailUrl"
          :alt="slide.name"
          loading="lazy"
          decoding="async"
          class="h-full w-full object-cover transition-transform"
          :style="{ transform: slide.rotation ? `rotate(${slide.rotation}deg)` : undefined }"
          draggable="false"
        />
        <div
          v-else
          class="flex h-full w-full items-center justify-center bg-zinc-900 text-[10px] text-zinc-600"
        >
          Loading…
        </div>

        <!-- Slide Number Badge -->
        <span
          class="absolute bottom-1 left-1 rounded bg-black/70 px-1.5 py-0.5 font-mono text-[10px] font-medium text-zinc-200 backdrop-blur-xs"
        >
          {{ slideIndex + 1 }}
        </span>

        <!-- Duplicate Indicator Badge -->
        <span
          v-if="isDuplicateSlide(slide.id)"
          class="pointer-events-none absolute right-1 bottom-1 rounded bg-amber-500/90 px-1.5 py-0.5 text-[9px] font-semibold tracking-wide text-zinc-950 uppercase shadow-xs"
        >
          {{ getDuplicateBadgeLabel(slide.id) }}
        </span>

        <!-- Drag Handle Indicator -->
        <span
          class="absolute top-1 left-1 rounded bg-black/60 p-0.5 text-zinc-400 opacity-0 transition group-hover:opacity-100"
        >
          <GripVertical class="h-3 w-3" />
        </span>

        <!-- Hover Actions -->
        <div
          class="absolute top-1 right-1 flex items-center gap-1 opacity-0 transition group-hover:opacity-100"
        >
          <button
            type="button"
            class="rounded bg-black/75 p-1 text-zinc-200 hover:bg-indigo-600"
            title="Rotate 90°"
            @click.stop="emit('rotate', slide.id)"
          >
            <RotateCw class="h-3 w-3" />
          </button>
          <button
            type="button"
            class="rounded bg-black/75 p-1 text-zinc-200 hover:bg-red-600"
            title="Remove slide"
            @click.stop="emit('remove', slide.id)"
          >
            <Trash2 class="h-3 w-3" />
          </button>
        </div>
      </div>
    </div>
  </section>
</template>
