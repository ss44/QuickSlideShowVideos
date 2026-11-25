import { computed, markRaw, reactive, ref } from 'vue'
import type {
  MusicConfig,
  OutputConfig,
  SlideImage,
  SmartEffectsConfig,
  TimingConfig,
  TransitionType,
} from '../types/slideshow'
import { RESOLUTION_PRESETS, TRANSITION_OPTIONS } from '../types/slideshow'
import { thumbnailQueue } from '../engine/imageCache'
import { computeTimeline, estimateFileSizeMB } from '../engine/timeline'
import { decodeAudioFromFile, decodeAudioFromUrl, detectBeats } from '../engine/audioEngine'
import { isImageFile } from '../utils/fileDrop'

let idCounter = 1
function nextId(): string {
  return `slide-${Date.now().toString(36)}-${idCounter++}`
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
  const transitionOrder = ref<'cycle' | 'random'>('cycle')

  const effects = reactive<SmartEffectsConfig>({
    kenBurns: true,
    kenBurnsIntensity: 0.08,
    fitMode: 'blur-fill',
    beatSync: false,
    colorLook: 'none',
    vignette: true,
  })

  // Use markRaw on AudioBuffer when assigning so Vue doesn't proxy Web Audio internals
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

  const activeSlideIndex = computed(() => {
    const list = timeline.value.slides
    if (list.length === 0) return -1
    const t = currentTime.value
    if (t <= 0) return 0
    if (t >= timeline.value.totalDuration) return list.length - 1
    let lo = 0
    let hi = list.length - 1
    while (lo <= hi) {
      const mid = (lo + hi) >> 1
      const s = list[mid]
      if (t < s.startTime) hi = mid - 1
      else if (t >= s.endTime) lo = mid + 1
      else return mid
    }
    return Math.min(list.length - 1, Math.max(0, lo))
  })

  function addFiles(input: FileList | File[]) {
    const valid = Array.from(input).filter(isImageFile)
    if (valid.length === 0) return

    const newSlides: SlideImage[] = valid.map((file) => ({
      id: nextId(),
      file,
      name: file.name,
      size: file.size,
      lastModified: file.lastModified,
      width: 0,
      height: 0,
      thumbnailUrl: null,
      rotation: 0,
    }))

    slides.value = [...slides.value, ...newSlides]

    for (const slide of newSlides) {
      thumbnailQueue.enqueue(slide, (url, w, h) => {
        const target = slides.value.find((s) => s.id === slide.id)
        if (target) {
          target.thumbnailUrl = url
          target.width = w
          target.height = h
        } else {
          URL.revokeObjectURL(url)
        }
      })
    }
  }

  function removeSlide(id: string) {
    const idx = slides.value.findIndex((s) => s.id === id)
    if (idx === -1) return
    const removed = slides.value[idx]
    if (removed.thumbnailUrl) URL.revokeObjectURL(removed.thumbnailUrl)
    const next = slides.value.slice()
    next.splice(idx, 1)
    slides.value = next
    if (currentTime.value > timeline.value.totalDuration) {
      currentTime.value = Math.max(0, timeline.value.totalDuration - 0.01)
    }
    if (slides.value.length === 0) {
      isPlaying.value = false
      currentTime.value = 0
    }
  }

  function rotateSlide(id: string) {
    const target = slides.value.find((s) => s.id === id)
    if (!target) return
    target.rotation = (((target.rotation || 0) + 90) % 360) as 0 | 90 | 180 | 270
  }

  function reorderSlides(fromIndex: number, toIndex: number) {
    if (
      fromIndex === toIndex ||
      fromIndex < 0 ||
      toIndex < 0 ||
      fromIndex >= slides.value.length ||
      toIndex >= slides.value.length
    ) {
      return
    }
    const next = slides.value.slice()
    const [moved] = next.splice(fromIndex, 1)
    next.splice(toIndex, 0, moved)
    slides.value = next
  }

  function sortSlides(mode: 'name' | 'date-asc' | 'date-desc' | 'reverse' | 'shuffle') {
    const next = slides.value.slice()
    if (mode === 'name') {
      next.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }))
    } else if (mode === 'date-asc') {
      next.sort((a, b) => a.lastModified - b.lastModified)
    } else if (mode === 'date-desc') {
      next.sort((a, b) => b.lastModified - a.lastModified)
    } else if (mode === 'reverse') {
      next.reverse()
    } else if (mode === 'shuffle') {
      for (let i = next.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1))
        ;[next[i], next[j]] = [next[j], next[i]]
      }
    }
    slides.value = next
  }

  function clearAllSlides() {
    isPlaying.value = false
    currentTime.value = 0
    thumbnailQueue.clear()
    for (const s of slides.value) {
      if (s.thumbnailUrl) URL.revokeObjectURL(s.thumbnailUrl)
    }
    slides.value = []
  }

  function toggleTransition(type: TransitionType) {
    const exists = selectedTransitions.value.includes(type)
    if (exists) {
      if (selectedTransitions.value.length === 1) return // always keep at least one
      selectedTransitions.value = selectedTransitions.value.filter((t) => t !== type)
    } else {
      selectedTransitions.value = [...selectedTransitions.value, type]
    }
  }

  function selectAllTransitions() {
    selectedTransitions.value = TRANSITION_OPTIONS.filter((t) => t.id !== 'cut').map((t) => t.id)
  }

  function setSingleTransition(type: TransitionType) {
    selectedTransitions.value = [type]
  }

  async function loadMusicFile(file: File) {
    music.loading = true
    music.error = null
    try {
      const buffer = await decodeAudioFromFile(file)
      music.audioBuffer = markRaw(buffer)
      music.sourceType = 'file'
      music.name = file.name
      music.url = ''
      music.duration = buffer.duration
      music.startOffset = 0
      music.beatTimes = detectBeats(buffer)
    } catch (err) {
      music.error =
        err instanceof Error ? err.message : 'Failed to decode audio file. Try MP3, WAV, M4A, or OGG.'
    } finally {
      music.loading = false
    }
  }

  async function loadMusicUrl(rawUrl: string) {
    const trimmed = rawUrl.trim()
    if (!trimmed) return
    music.loading = true
    music.error = null
    try {
      const buffer = await decodeAudioFromUrl(trimmed)
      music.audioBuffer = markRaw(buffer)
      music.sourceType = 'url'
      const urlParts = trimmed.split('/')
      music.name = decodeURIComponent(urlParts[urlParts.length - 1] || 'Audio Link').split('?')[0]
      music.url = trimmed
      music.duration = buffer.duration
      music.startOffset = 0
      music.beatTimes = detectBeats(buffer)
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
    const preset = RESOLUTION_PRESETS.find((p) => p.id === presetId)
    if (!preset) return
    output.presetId = preset.id
    output.width = preset.width
    output.height = preset.height
  }

  function jumpToSlide(index: number) {
    const item = timeline.value.slides[index]
    if (!item) return
    // Jump slightly past transitionIn so the slide is clearly visible when scrubbing
    currentTime.value = item.startTime + Math.min(item.transitionInDuration, item.duration * 0.4)
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
