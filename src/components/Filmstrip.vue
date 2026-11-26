<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue'
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
  AlertTriangle,
} from 'lucide-vue-next'
import type {
  ComputedTimeline,
  DuplicateAnalysis,
  ImageQualityAnalysis,
  OutputConfig,
  SlideImage,
  SlideSortMode,
} from '../types/slideshow'
import { SLIDE_SORT_OPTIONS } from '../types/slideshow'
import {
  describeSlideQualityIssues,
  formatQualityIssueBadgeLabel,
} from '../engine/imageQualityAnalyzer'
import { computeSlideSeekTimeSeconds } from '../engine/timeline'
import { formatTime } from '../utils/formatters'

const props = defineProps<{
  slides: SlideImage[]
  timeline: ComputedTimeline
  activeSlideIndex: number
  duplicateAnalysis: DuplicateAnalysis
  qualityAnalysis: ImageQualityAnalysis
  output: OutputConfig
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
const sortDropdownRef = ref<HTMLElement | null>(null)

function handleDocumentPointerDown(event: PointerEvent) {
  if (!isSortMenuOpen.value) return
  if (sortDropdownRef.value && !sortDropdownRef.value.contains(event.target as Node)) {
    isSortMenuOpen.value = false
  }
}

onMounted(() => {
  document.addEventListener('pointerdown', handleDocumentPointerDown)
})

onBeforeUnmount(() => {
  document.removeEventListener('pointerdown', handleDocumentPointerDown)
})

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

function isQualityFlaggedSlide(slideId: string): boolean {
  return props.qualityAnalysis.flaggedSlideIds.has(slideId)
}

function getQualityBadgeLabel(slideId: string): string {
  const assessment = props.qualityAnalysis.assessmentBySlideId.get(slideId)
  return assessment ? formatQualityIssueBadgeLabel(assessment) : ''
}

function getQualitySummaryTooltip(): string {
  const { flaggedCount, lowResCount, blurryCount } = props.qualityAnalysis
  const parts: string[] = []
  if (lowResCount > 0) parts.push(`${lowResCount} low-res`)
  if (blurryCount > 0) parts.push(`${blurryCount} blurry`)
  const breakdown = parts.length > 0 ? ` (${parts.join(', ')})` : ''
  return `${flaggedCount} ${flaggedCount === 1 ? 'photo' : 'photos'} may look soft at ${props.output.width}×${props.output.height}${breakdown} — click to inspect`
}

function jumpToNextFlaggedSlide() {
  if (props.qualityAnalysis.flaggedCount === 0 || props.slides.length === 0) return
  for (let offset = 1; offset <= props.slides.length; offset++) {
    const candidateIndex = (props.activeSlideIndex + offset) % props.slides.length
    if (isQualityFlaggedSlide(props.slides[candidateIndex].id)) {
      emit('jumpTo', candidateIndex)
      return
    }
  }
}

function getSlideSeekTimestampLabel(slideIndex: number): string | null {
  const seekTimeSeconds = computeSlideSeekTimeSeconds(props.timeline, slideIndex)
  return seekTimeSeconds === null ? null : formatTime(seekTimeSeconds)
}

function getSlideTooltip(slide: SlideImage, slideIndex: number): string {
  const timestampLabel = getSlideSeekTimestampLabel(slideIndex)
  const timestampSuffix = timestampLabel ? ` (${timestampLabel})` : ''
  const details: string[] = []
  if (slide.width > 0 && slide.height > 0) {
    details.push(`${slide.width}×${slide.height}`)
  }

  const qualityAssessment = props.qualityAnalysis.assessmentBySlideId.get(slide.id)
  if (qualityAssessment && qualityAssessment.issues.length > 0) {
    details.push(describeSlideQualityIssues(slide, qualityAssessment, props.output))
  }

  const copyCount = props.duplicateAnalysis.copyCountBySlideId.get(slide.id)
  if (copyCount) {
    const matchKind = props.duplicateAnalysis.matchKindBySlideId.get(slide.id)
    const isRemovable = props.duplicateAnalysis.removableDuplicateIds.has(slide.id)
    const disposition = isRemovable ? 'will remove' : 'highest res, kept'
    if (matchKind === 'similar') {
      details.push(`Similar photo (${copyCount} matches · ${disposition})`)
    } else {
      details.push(`Exact duplicate (${copyCount} copies · ${disposition})`)
    }
  }

  return details.length > 0
    ? `${slide.name}${timestampSuffix} — ${details.join(' | ')}`
    : `${slide.name}${timestampSuffix}`
}

function getSlideAriaLabel(slide: SlideImage, slideIndex: number): string {
  const timestampLabel = getSlideSeekTimestampLabel(slideIndex)
  return timestampLabel
    ? `Jump to slide ${slideIndex + 1} (${slide.name}) at ${timestampLabel}`
    : `Jump to slide ${slideIndex + 1} (${slide.name})`
}

function getDuplicateBadgeLabel(slideId: string): string {
  return props.duplicateAnalysis.matchKindBySlideId.get(slideId) === 'similar' ? 'Sim' : 'Dup'
}

function getSlideCardBorderClass(slide: SlideImage, slideIndex: number): string {
  const isActive = slideIndex === props.activeSlideIndex
  const isLowQuality = isQualityFlaggedSlide(slide.id)
  const isDuplicate = isDuplicateSlide(slide.id)

  if (isLowQuality && isActive) {
    return 'border-2 border-yellow-400 ring-2 ring-indigo-500/70'
  }
  if (isLowQuality) {
    return 'border-2 border-yellow-400 ring-1 ring-yellow-400/35 hover:border-yellow-300'
  }
  if (isDuplicate && isActive) {
    return 'border-2 border-amber-500 ring-2 ring-indigo-500/70'
  }
  if (isDuplicate) {
    return 'border-2 border-amber-500/90 ring-1 ring-amber-500/30 hover:border-amber-400'
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
    :class="isGridExpanded ? 'h-60 md:h-80' : 'h-32 md:h-44'"
  >
    <!-- Filmstrip Header -->
    <div
      class="flex h-10 shrink-0 items-center justify-between gap-2 border-b border-zinc-800/60 px-2.5 sm:px-4"
    >
      <div class="flex min-w-0 items-center gap-1.5 text-xs sm:gap-2">
        <span class="font-semibold text-zinc-200">Slides</span>
        <span class="rounded-full bg-zinc-800 px-2 py-0.5 font-mono text-[11px] text-zinc-300">
          {{ props.slides.length }}
        </span>
        <button
          v-if="props.qualityAnalysis.flaggedCount > 0"
          type="button"
          class="inline-flex items-center gap-1 rounded-full border border-yellow-400/45 bg-yellow-400/15 px-2 py-0.5 text-[11px] font-medium text-yellow-300 transition hover:bg-yellow-400/25 hover:text-yellow-200"
          :title="getQualitySummaryTooltip()"
          @click="jumpToNextFlaggedSlide"
        >
          <AlertTriangle class="h-3 w-3 shrink-0 text-yellow-400" />
          <span class="font-mono font-semibold">{{ props.qualityAnalysis.flaggedCount }}</span>
          <span class="hidden sm:inline">low quality</span>
        </button>
        <span v-if="props.slides.length > 1" class="hidden text-[11px] text-zinc-500 md:inline">
          Click to jump · Drag to reorder
        </span>
      </div>

      <div class="flex shrink-0 items-center gap-1 sm:gap-1.5">
        <button
          v-if="props.duplicateAnalysis.removableCount > 0"
          type="button"
          class="inline-flex items-center gap-1 rounded-md border border-amber-500/40 bg-amber-500/15 px-2 py-1 text-xs font-medium text-amber-300 transition hover:bg-amber-500/25 hover:text-amber-200 sm:gap-1.5 sm:px-2.5"
          :title="`Remove ${props.duplicateAnalysis.removableCount} duplicate ${props.duplicateAnalysis.removableCount === 1 ? 'photo' : 'photos'} (keeps the highest-resolution copy of each)`"
          @click="emit('removeDuplicates')"
        >
          <CopyMinus class="h-3.5 w-3.5 shrink-0" />
          <span class="hidden sm:inline">Remove Duplicates</span>
          <span class="sm:hidden">Dupes</span>
          <span
            class="rounded-full bg-amber-500/25 px-1.5 py-0.25 font-mono text-[10px] font-semibold text-amber-200"
          >
            {{ props.duplicateAnalysis.removableCount }}
          </span>
        </button>

        <button
          type="button"
          class="inline-flex items-center gap-1 rounded-md bg-zinc-800 px-2 py-1 text-xs font-medium text-zinc-200 transition hover:bg-zinc-700 sm:gap-1.5 sm:px-2.5"
          @click="emit('addMore')"
        >
          <Plus class="h-3.5 w-3.5 shrink-0" />
          <span class="hidden sm:inline">Add Photos</span>
          <span class="sm:hidden">Add</span>
        </button>

        <!-- Sort Dropdown -->
        <div v-if="props.slides.length > 1" ref="sortDropdownRef" class="relative">
          <button
            type="button"
            aria-label="Sort slides"
            :aria-expanded="isSortMenuOpen"
            class="inline-flex items-center gap-1 rounded-md border border-zinc-800 bg-zinc-900 px-2 py-1 text-xs text-zinc-300 transition hover:bg-zinc-800"
            @click="isSortMenuOpen = !isSortMenuOpen"
          >
            <ArrowUpDown class="h-3.5 w-3.5" />
            <span class="hidden sm:inline">Sort</span>
          </button>

          <div
            v-if="isSortMenuOpen"
            class="absolute right-0 bottom-full z-20 mb-1.5 w-44 rounded-lg border border-zinc-800 bg-zinc-900 py-1 shadow-xl"
          >
            <button
              v-for="sortOption in SLIDE_SORT_OPTIONS"
              :key="sortOption.id"
              type="button"
              class="flex w-full items-center gap-1.5 px-3 py-2 text-left text-xs text-zinc-200 hover:bg-zinc-800 sm:py-1.5"
              @click="applySortMode(sortOption.id)"
            >
              <Shuffle v-if="sortOption.id === 'random'" class="h-3 w-3 shrink-0 text-indigo-400" />
              {{ sortOption.label }}
            </button>
          </div>
        </div>

        <button
          v-if="props.slides.length > 0"
          type="button"
          class="rounded-md border border-zinc-800 bg-zinc-900 p-1.5 text-zinc-400 transition hover:bg-zinc-800 hover:text-zinc-200"
          :title="isGridExpanded ? 'Compact strip' : 'Expand grid'"
          :aria-label="isGridExpanded ? 'Compact filmstrip' : 'Expand slide grid'"
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
          aria-label="Clear all photos"
          @click="emit('clearAll')"
        >
          <Trash2 class="h-3.5 w-3.5" />
        </button>
      </div>
    </div>

    <!-- Thumbnail List / Grid -->
    <div
      v-if="props.slides.length === 0"
      class="flex flex-1 items-center justify-center px-4 text-center text-xs text-zinc-500"
    >
      Your photo timeline will appear here once you add images.
    </div>

    <div
      v-else
      class="flex-1 p-2 sm:p-3"
      :class="
        isGridExpanded
          ? 'grid grid-cols-3 gap-2 overflow-y-auto overscroll-contain sm:grid-cols-5 sm:gap-2.5 md:grid-cols-7 lg:grid-cols-9'
          : 'flex items-center gap-2 overflow-x-auto overflow-y-hidden overscroll-x-contain sm:gap-2.5'
      "
    >
      <div
        v-for="(slide, slideIndex) in props.slides"
        :key="slide.id"
        role="button"
        tabindex="0"
        draggable="true"
        :title="getSlideTooltip(slide, slideIndex)"
        :aria-label="getSlideAriaLabel(slide, slideIndex)"
        :aria-current="slideIndex === props.activeSlideIndex ? 'true' : undefined"
        class="group relative shrink-0 cursor-pointer overflow-hidden rounded-lg bg-zinc-900 transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400"
        :class="[
          isGridExpanded ? 'aspect-[4/3] w-full' : 'h-18 w-24 md:h-24 md:w-32',
          getSlideCardBorderClass(slide, slideIndex),
          dragTargetSlideIndex === slideIndex && draggedSlideIndex !== slideIndex
            ? 'scale-[1.03] ring-2 ring-sky-400'
            : '',
          draggedSlideIndex === slideIndex ? 'opacity-40' : '',
        ]"
        @click="emit('jumpTo', slideIndex)"
        @keydown.enter.self.prevent="emit('jumpTo', slideIndex)"
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

        <!-- Quality & Duplicate Indicator Badges -->
        <div
          v-if="isQualityFlaggedSlide(slide.id) || isDuplicateSlide(slide.id)"
          class="pointer-events-none absolute right-1 bottom-1 flex items-center gap-0.5"
        >
          <span
            v-if="getQualityBadgeLabel(slide.id)"
            class="rounded bg-yellow-400 px-1.5 py-0.5 text-[9px] font-semibold tracking-wide text-zinc-950 uppercase shadow-xs"
          >
            {{ getQualityBadgeLabel(slide.id) }}
          </span>
          <span
            v-if="isDuplicateSlide(slide.id)"
            class="rounded bg-amber-500/90 px-1.5 py-0.5 text-[9px] font-semibold tracking-wide text-zinc-950 uppercase shadow-xs"
          >
            {{ getDuplicateBadgeLabel(slide.id) }}
          </span>
        </div>

        <!-- Drag Handle Indicator (desktop hover only; touch devices do not support HTML5 drag) -->
        <span
          class="absolute top-1 left-1 hidden rounded bg-black/60 p-0.5 text-zinc-400 opacity-0 transition group-hover:opacity-100 md:inline-flex"
        >
          <GripVertical class="h-3 w-3" />
        </span>

        <!-- Slide Actions (visible on active slide on mobile touchscreens, hover-revealed on desktop) -->
        <div
          class="absolute top-1 right-1 flex items-center gap-1 transition"
          :class="
            slideIndex === props.activeSlideIndex
              ? 'opacity-100 md:opacity-0 md:group-hover:opacity-100'
              : 'pointer-events-none opacity-0 md:pointer-events-auto md:group-hover:opacity-100'
          "
        >
          <button
            type="button"
            class="rounded bg-black/80 p-1.5 text-zinc-200 hover:bg-indigo-600 md:p-1"
            title="Rotate 90°"
            aria-label="Rotate slide 90 degrees"
            @click.stop="emit('rotate', slide.id)"
          >
            <RotateCw class="h-3 w-3" />
          </button>
          <button
            type="button"
            class="rounded bg-black/80 p-1.5 text-zinc-200 hover:bg-red-600 md:p-1"
            title="Remove slide"
            aria-label="Remove slide"
            @click.stop="emit('remove', slide.id)"
          >
            <Trash2 class="h-3 w-3" />
          </button>
        </div>
      </div>
    </div>
  </section>
</template>
