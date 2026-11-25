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
} from 'lucide-vue-next'
import type { SlideImage } from '../types/slideshow'

const props = defineProps<{
  slides: SlideImage[]
  activeSlideIndex: number
}>()

const emit = defineEmits<{
  (e: 'addMore'): void
  (e: 'jumpTo', index: number): void
  (e: 'remove', id: string): void
  (e: 'rotate', id: string): void
  (e: 'reorder', fromIndex: number, toIndex: number): void
  (e: 'sort', mode: 'name' | 'date-asc' | 'date-desc' | 'reverse' | 'shuffle'): void
  (e: 'clearAll'): void
}>()

const expanded = ref(false)
const draggedIndex = ref<number | null>(null)
const dragOverIndex = ref<number | null>(null)
const sortMenuOpen = ref(false)

function onDragStart(e: DragEvent, index: number) {
  draggedIndex.value = index
  if (e.dataTransfer) {
    e.dataTransfer.effectAllowed = 'move'
    e.dataTransfer.setData('text/plain', String(index))
  }
}

function onDragOver(e: DragEvent, index: number) {
  e.preventDefault()
  if (draggedIndex.value === null) return
  dragOverIndex.value = index
}

function onDrop(e: DragEvent, index: number) {
  e.preventDefault()
  if (draggedIndex.value !== null && draggedIndex.value !== index) {
    emit('reorder', draggedIndex.value, index)
  }
  draggedIndex.value = null
  dragOverIndex.value = null
}

function onDragEnd() {
  draggedIndex.value = null
  dragOverIndex.value = null
}

function applySort(mode: 'name' | 'date-asc' | 'date-desc' | 'reverse' | 'shuffle') {
  emit('sort', mode)
  sortMenuOpen.value = false
}
</script>

<template>
  <section
    class="flex shrink-0 flex-col border-t border-zinc-800/80 bg-zinc-950 transition-all"
    :class="expanded ? 'h-80' : 'h-44'"
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
            @click="sortMenuOpen = !sortMenuOpen"
          >
            <ArrowUpDown class="h-3.5 w-3.5" />
            Sort
          </button>

          <div
            v-if="sortMenuOpen"
            class="absolute right-0 bottom-full z-30 mb-1.5 w-40 rounded-lg border border-zinc-800 bg-zinc-900 py-1 shadow-xl"
          >
            <button
              type="button"
              class="block w-full px-3 py-1.5 text-left text-xs text-zinc-200 hover:bg-zinc-800"
              @click="applySort('name')"
            >
              Filename (A–Z)
            </button>
            <button
              type="button"
              class="block w-full px-3 py-1.5 text-left text-xs text-zinc-200 hover:bg-zinc-800"
              @click="applySort('date-asc')"
            >
              Date (Oldest first)
            </button>
            <button
              type="button"
              class="block w-full px-3 py-1.5 text-left text-xs text-zinc-200 hover:bg-zinc-800"
              @click="applySort('date-desc')"
            >
              Date (Newest first)
            </button>
            <button
              type="button"
              class="block w-full px-3 py-1.5 text-left text-xs text-zinc-200 hover:bg-zinc-800"
              @click="applySort('reverse')"
            >
              Reverse Order
            </button>
            <button
              type="button"
              class="flex w-full items-center gap-1.5 px-3 py-1.5 text-left text-xs text-zinc-200 hover:bg-zinc-800"
              @click="applySort('shuffle')"
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
          :title="expanded ? 'Compact strip' : 'Expand grid'"
          @click="expanded = !expanded"
        >
          <Minimize2 v-if="expanded" class="h-3.5 w-3.5" />
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
        expanded
          ? 'grid grid-cols-3 gap-2.5 overflow-y-auto sm:grid-cols-5 md:grid-cols-7 lg:grid-cols-9'
          : 'flex items-center gap-2.5 overflow-x-auto overflow-y-hidden'
      "
    >
      <div
        v-for="(slide, idx) in props.slides"
        :key="slide.id"
        draggable="true"
        class="group relative shrink-0 cursor-pointer overflow-hidden rounded-lg border bg-zinc-900 transition"
        :class="[
          expanded ? 'aspect-[4/3] w-full' : 'h-24 w-32',
          idx === props.activeSlideIndex
            ? 'border-indigo-500 ring-2 ring-indigo-500/40'
            : 'border-zinc-800 hover:border-zinc-600',
          dragOverIndex === idx && draggedIndex !== idx ? 'ring-2 ring-amber-400 scale-[1.03]' : '',
          draggedIndex === idx ? 'opacity-40' : '',
        ]"
        @click="emit('jumpTo', idx)"
        @dragstart="onDragStart($event, idx)"
        @dragover="onDragOver($event, idx)"
        @drop="onDrop($event, idx)"
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
          {{ idx + 1 }}
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
