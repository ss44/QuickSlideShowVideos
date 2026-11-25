import { computed, markRaw, reactive, ref } from 'vue'
import type {
  MusicConfig,
  MusicSourceType,
  OutputConfig,
  SlideImage,
  SlideRotationDegrees,
  SlideSortMode,
  SmartEffectsConfig,
  TimingConfig,
  TransitionOrderMode,
  TransitionType,
} from '../types/slideshow'
import { RESOLUTION_PRESETS, TRANSITION_OPTIONS } from '../types/slideshow'
import { thumbnailQueue } from '../engine/imageCache'
import {
  computeTimeline,
  estimateFileSizeMB,
  findSlideIndexAtTime,
} from '../engine/timeline'
import { decodeAudioFromFile, decodeAudioFromUrl, detectBeats } from '../engine/audioEngine'
import { isImageFile } from '../utils/fileDrop'

let slideIdSequence = 1

function generateUniqueSlideId(): string {
  return `slide-${Date.now().toString(36)}-${slideIdSequence++}`
}

function createSlideImageFromFile(file: File): SlideImage {
  return {
    id: generateUniqueSlideId(),
    file,
    name: file.name,
    size: file.size,
    lastModified: file.lastModified,
    width: 0,
    height: 0,
    thumbnailUrl: null,
    rotation: 0,
  }
}

function revokeSlideThumbnail(slide: SlideImage) {
  if (slide.thumbnailUrl) {
    URL.revokeObjectURL(slide.thumbnailUrl)
  }
}

function extractTrackNameFromUrl(url: string): string {
  const pathSegments = url.split('/')
  const rawFilename = pathSegments[pathSegments.length - 1] || 'Audio Link'
  return decodeURIComponent(rawFilename).split('?')[0]
}

export function useSlideshow() {
  const slides = ref<SlideImage[]>([])
  const currentTime = ref(0)
  const isPlaying = ref(false)
  const isMuted = ref(false)

  const timing = reactive<TimingConfig>({
    slideDuration: 3.0,
    transitionDuration: 0.7,
    matchMusicLength: false,
  })

  const selectedTransitions = ref<TransitionType[]>(['crossfade', 'zoom-in', 'slide-left'])
  const transitionOrder = ref<TransitionOrderMode>('cycle')

  const effects = reactive<SmartEffectsConfig>({
    kenBurns: true,
    kenBurnsIntensity: 0.08,
    fitMode: 'blur-fill',
    beatSync: false,
    colorLook: 'none',
    vignette: true,
  })

  // Wrap decoded AudioBuffer instances in markRaw() before assignment so Vue does not deep-proxy Web Audio internals
  const music = reactive<MusicConfig>({
    sourceType: 'none',
    name: '',
    url: '',
    duration: 0,
    loop: true,
    fadeIn: true,
    fadeOut: true,
    startOffset: 0,
    volume: 0.85,
    audioBuffer: null,
    beatTimes: [],
    loading: false,
    error: null,
  })

  const output = reactive<OutputConfig>({
    format: 'mp4',
    presetId: '1080p',
    width: 1920,
    height: 1080,
    fps: 30,
    quality: 'standard',
  })

  const timeline = computed(() =>
    computeTimeline(
      slides.value,
      timing,
      selectedTransitions.value,
      transitionOrder.value,
      music,
      effects.beatSync,
    ),
  )

  const estimatedSizeMB = computed(() =>
    estimateFileSizeMB(timeline.value.totalDuration, output, Boolean(music.audioBuffer)),
  )

  const activeSlideIndex = computed(() =>
    findSlideIndexAtTime(timeline.value, currentTime.value),
  )

  function addFiles(inputFiles: FileList | File[]) {
    const validImageFiles = Array.from(inputFiles).filter(isImageFile)
    if (validImageFiles.length === 0) return

    const newSlides = validImageFiles.map(createSlideImageFromFile)
    slides.value = [...slides.value, ...newSlides]

    for (const slide of newSlides) {
      thumbnailQueue.enqueue(slide, (thumbnailBlobUrl, naturalWidth, naturalHeight) => {
        const targetSlide = slides.value.find((item) => item.id === slide.id)
        if (targetSlide) {
          targetSlide.thumbnailUrl = thumbnailBlobUrl
          targetSlide.width = naturalWidth
          targetSlide.height = naturalHeight
        } else {
          // Slide was removed before its asynchronous thumbnail completed
          URL.revokeObjectURL(thumbnailBlobUrl)
        }
      })
    }
  }

  function removeSlide(slideId: string) {
    const indexToRemove = slides.value.findIndex((slide) => slide.id === slideId)
    if (indexToRemove === -1) return

    revokeSlideThumbnail(slides.value[indexToRemove])
    const updatedSlides = slides.value.slice()
    updatedSlides.splice(indexToRemove, 1)
    slides.value = updatedSlides

    if (currentTime.value > timeline.value.totalDuration) {
      currentTime.value = Math.max(0, timeline.value.totalDuration - 0.01)
    }
    if (slides.value.length === 0) {
      isPlaying.value = false
      currentTime.value = 0
    }
  }

  function rotateSlide(slideId: string) {
    const targetSlide = slides.value.find((slide) => slide.id === slideId)
    if (!targetSlide) return
    targetSlide.rotation = (((targetSlide.rotation || 0) + 90) % 360) as SlideRotationDegrees
  }

  function reorderSlides(fromIndex: number, toIndex: number) {
    const isOutOfBounds =
      fromIndex === toIndex ||
      fromIndex < 0 ||
      toIndex < 0 ||
      fromIndex >= slides.value.length ||
      toIndex >= slides.value.length
    if (isOutOfBounds) return

    const reordered = slides.value.slice()
    const [movedSlide] = reordered.splice(fromIndex, 1)
    reordered.splice(toIndex, 0, movedSlide)
    slides.value = reordered
  }

  function sortSlides(sortMode: SlideSortMode) {
    const sorted = slides.value.slice()
    if (sortMode === 'name') {
      sorted.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }))
    } else if (sortMode === 'date-asc') {
      sorted.sort((a, b) => a.lastModified - b.lastModified)
    } else if (sortMode === 'date-desc') {
      sorted.sort((a, b) => b.lastModified - a.lastModified)
    } else if (sortMode === 'reverse') {
      sorted.reverse()
    } else if (sortMode === 'shuffle') {
      for (let i = sorted.length - 1; i > 0; i--) {
        const randomIndex = Math.floor(Math.random() * (i + 1))
        ;[sorted[i], sorted[randomIndex]] = [sorted[randomIndex], sorted[i]]
      }
    }
    slides.value = sorted
  }

  function clearAllSlides() {
    isPlaying.value = false
    currentTime.value = 0
    thumbnailQueue.clear()
    for (const slide of slides.value) {
      revokeSlideThumbnail(slide)
    }
    slides.value = []
  }

  function toggleTransition(transitionType: TransitionType) {
    const isCurrentlySelected = selectedTransitions.value.includes(transitionType)
    if (isCurrentlySelected) {
      if (selectedTransitions.value.length === 1) return // Ensure at least one transition remains active
      selectedTransitions.value = selectedTransitions.value.filter(
        (item) => item !== transitionType,
      )
    } else {
      selectedTransitions.value = [...selectedTransitions.value, transitionType]
    }
  }

  function selectAllTransitions() {
    selectedTransitions.value = TRANSITION_OPTIONS.filter((opt) => opt.id !== 'cut').map(
      (opt) => opt.id,
    )
  }

  function setSingleTransition(transitionType: TransitionType) {
    selectedTransitions.value = [transitionType]
  }

  function applyLoadedAudioBuffer(
    buffer: AudioBuffer,
    sourceType: Exclude<MusicSourceType, 'none'>,
    trackName: string,
    sourceUrl: string,
  ) {
    music.audioBuffer = markRaw(buffer)
    music.sourceType = sourceType
    music.name = trackName
    music.url = sourceUrl
    music.duration = buffer.duration
    music.startOffset = 0
    music.beatTimes = detectBeats(buffer)
  }

  async function loadMusicFile(file: File) {
    music.loading = true
    music.error = null
    try {
      const decodedBuffer = await decodeAudioFromFile(file)
      applyLoadedAudioBuffer(decodedBuffer, 'file', file.name, '')
    } catch (err) {
      music.error =
        err instanceof Error
          ? err.message
          : 'Failed to decode audio file. Try MP3, WAV, M4A, or OGG.'
    } finally {
      music.loading = false
    }
  }

  async function loadMusicUrl(rawUrl: string) {
    const trimmedUrl = rawUrl.trim()
    if (!trimmedUrl) return

    music.loading = true
    music.error = null
    try {
      const decodedBuffer = await decodeAudioFromUrl(trimmedUrl)
      applyLoadedAudioBuffer(
        decodedBuffer,
        'url',
        extractTrackNameFromUrl(trimmedUrl),
        trimmedUrl,
      )
    } catch (err) {
      music.error = err instanceof Error ? err.message : 'Could not load audio from URL.'
    } finally {
      music.loading = false
    }
  }

  function clearMusic() {
    music.audioBuffer = null
    music.sourceType = 'none'
    music.name = ''
    music.url = ''
    music.duration = 0
    music.startOffset = 0
    music.beatTimes = []
    music.error = null
    timing.matchMusicLength = false
    effects.beatSync = false
  }

  function setResolutionPreset(presetId: string) {
    const preset = RESOLUTION_PRESETS.find((item) => item.id === presetId)
    if (!preset) return
    output.presetId = preset.id
    output.width = preset.width
    output.height = preset.height
  }

  function jumpToSlide(slideIndex: number) {
    const timelineSlide = timeline.value.slides[slideIndex]
    if (!timelineSlide) return
    // Seek just past the incoming transition so the selected slide is immediately visible
    const postTransitionOffset = Math.min(
      timelineSlide.transitionInDuration,
      timelineSlide.duration * 0.4,
    )
    currentTime.value = timelineSlide.startTime + postTransitionOffset
  }

  return {
    slides,
    currentTime,
    isPlaying,
    isMuted,
    timing,
    selectedTransitions,
    transitionOrder,
    effects,
    music,
    output,
    timeline,
    estimatedSizeMB,
    activeSlideIndex,
    addFiles,
    removeSlide,
    rotateSlide,
    reorderSlides,
    sortSlides,
    clearAllSlides,
    toggleTransition,
    selectAllTransitions,
    setSingleTransition,
    loadMusicFile,
    loadMusicUrl,
    clearMusic,
    setResolutionPreset,
    jumpToSlide,
  }
}
