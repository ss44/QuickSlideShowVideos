import { computed, markRaw, reactive, ref, watch } from 'vue'
import type {
  DuplicateDetectionConfig,
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
import type {
  ProjectSavePayload,
  RestoredProjectData,
  SavedMusicRecord,
  SavedProjectSettings,
} from '../types/project'
import { RESOLUTION_PRESETS, TRANSITION_OPTIONS } from '../types/slideshow'
import { thumbnailQueue } from '../engine/imageCache'
import {
  DEFAULT_DUPLICATE_THRESHOLD_PERCENT,
  DUPLICATE_THRESHOLD_MAX_PERCENT,
  DUPLICATE_THRESHOLD_MIN_PERCENT,
  analyzeSlideDuplicates,
  contentHashQueue,
  findSlidesRequiringHash,
} from '../engine/duplicateDetector'
import {
  computeSlideSeekTimeSeconds,
  computeTimeline,
  estimateFileSizeMB,
  findSlideIndexAtTime,
} from '../engine/timeline'
import {
  decodeAudioFromFile,
  detectBeats,
  fetchAndDecodeAudioFromUrl,
} from '../engine/audioEngine'
import {
  formatRejectedFilesNotice,
  partitionSupportedImageFiles,
} from '../utils/fileDrop'
import { computeSortedSlides } from '../utils/slideSort'

const REJECTED_FILES_NOTICE_DURATION_MS = 7000

let slideIdSequence = 1
let musicAssetIdSequence = 1

function generateUniqueSlideId(): string {
  return `slide-${Date.now().toString(36)}-${slideIdSequence++}`
}

function generateUniqueMusicAssetId(): string {
  return `music-${Date.now().toString(36)}-${musicAssetIdSequence++}`
}

const VALID_TRANSITION_IDS = new Set<TransitionType>(
  TRANSITION_OPTIONS.map((option) => option.id),
)

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
    contentHash: null,
    perceptualFingerprint: null,
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
  const rejectedFilesNotice = ref<string | null>(null)
  let accumulatedRejectedFiles: File[] = []
  let rejectedNoticeTimerId: ReturnType<typeof setTimeout> | null = null

  function dismissRejectedFilesNotice() {
    if (rejectedNoticeTimerId !== null) {
      clearTimeout(rejectedNoticeTimerId)
      rejectedNoticeTimerId = null
    }
    accumulatedRejectedFiles = []
    rejectedFilesNotice.value = null
  }

  function reportRejectedFiles(rejectedFiles: File[]) {
    if (rejectedFiles.length === 0) return

    if (rejectedFilesNotice.value === null) {
      accumulatedRejectedFiles = []
    }
    accumulatedRejectedFiles.push(...rejectedFiles)
    rejectedFilesNotice.value = formatRejectedFilesNotice(accumulatedRejectedFiles)

    if (rejectedNoticeTimerId !== null) {
      clearTimeout(rejectedNoticeTimerId)
    }
    rejectedNoticeTimerId = setTimeout(() => {
      dismissRejectedFilesNotice()
    }, REJECTED_FILES_NOTICE_DURATION_MS)
  }

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

  const duplicateDetection = reactive<DuplicateDetectionConfig>({
    enabled: true,
    similarityThresholdPercent: DEFAULT_DUPLICATE_THRESHOLD_PERCENT,
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

  const duplicateAnalysis = computed(() =>
    analyzeSlideDuplicates(slides.value, duplicateDetection),
  )

  function clampPlaybackStateAfterRemoval() {
    if (currentTime.value > timeline.value.totalDuration) {
      currentTime.value = Math.max(0, timeline.value.totalDuration - 0.01)
    }
    if (slides.value.length === 0) {
      isPlaying.value = false
      currentTime.value = 0
    }
  }

  function scheduleDuplicateDetectionForSlides() {
    if (!duplicateDetection.enabled) return
    const slidesNeedingHash = findSlidesRequiringHash(slides.value)
    for (const candidateSlide of slidesNeedingHash) {
      contentHashQueue.enqueue(candidateSlide, (contentHash) => {
        const targetSlide = slides.value.find((item) => item.id === candidateSlide.id)
        if (targetSlide) {
          targetSlide.contentHash = contentHash
        }
      })
    }
  }

  watch(
    () => duplicateDetection.enabled,
    (isEnabled) => {
      if (isEnabled) {
        scheduleDuplicateDetectionForSlides()
      }
    },
  )

  function enqueueThumbnailsForSlides(targetSlides: SlideImage[]) {
    for (const slide of targetSlides) {
      thumbnailQueue.enqueue(
        slide,
        (thumbnailBlobUrl, naturalWidth, naturalHeight, perceptualFingerprint) => {
          const targetSlide = slides.value.find((item) => item.id === slide.id)
          if (targetSlide) {
            targetSlide.thumbnailUrl = thumbnailBlobUrl
            targetSlide.width = naturalWidth
            targetSlide.height = naturalHeight
            if (perceptualFingerprint) {
              targetSlide.perceptualFingerprint = perceptualFingerprint
            }
          } else {
            // Slide was removed before its asynchronous thumbnail completed
            URL.revokeObjectURL(thumbnailBlobUrl)
          }
        },
        () => {
          // Reject files the browser cannot decode (e.g. corrupt files or renamed RAW images)
          // so they never persist as broken thumbnails or black video frames.
          const failedSlide = slides.value.find((item) => item.id === slide.id)
          if (failedSlide) {
            removeSlide(failedSlide.id)
            reportRejectedFiles([failedSlide.file])
          }
        },
      )
    }
  }

  function addFiles(inputFiles: FileList | File[]) {
    const { supportedFiles, rejectedFiles } = partitionSupportedImageFiles(Array.from(inputFiles))
    if (rejectedFiles.length > 0) {
      reportRejectedFiles(rejectedFiles)
    }
    if (supportedFiles.length === 0) return

    const newSlides = supportedFiles.map(createSlideImageFromFile)
    slides.value = [...slides.value, ...newSlides]

    scheduleDuplicateDetectionForSlides()
    enqueueThumbnailsForSlides(newSlides)
  }

  function removeSlide(slideId: string) {
    const indexToRemove = slides.value.findIndex((slide) => slide.id === slideId)
    if (indexToRemove === -1) return

    revokeSlideThumbnail(slides.value[indexToRemove])
    const updatedSlides = slides.value.slice()
    updatedSlides.splice(indexToRemove, 1)
    slides.value = updatedSlides

    clampPlaybackStateAfterRemoval()
  }

  function removeDuplicateSlides() {
    const removableIds = duplicateAnalysis.value.removableDuplicateIds
    if (removableIds.size === 0) return

    const remainingSlides: SlideImage[] = []
    for (const slide of slides.value) {
      if (removableIds.has(slide.id)) {
        revokeSlideThumbnail(slide)
      } else {
        remainingSlides.push(slide)
      }
    }

    slides.value = remainingSlides
    clampPlaybackStateAfterRemoval()
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
    slides.value = computeSortedSlides(slides.value, sortMode)
  }

  function clearAllSlides() {
    isPlaying.value = false
    currentTime.value = 0
    dismissRejectedFilesNotice()
    thumbnailQueue.clear()
    contentHashQueue.clear()
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

  // Kept outside reactive state so Vue never proxies raw binary Blob internals
  let musicSourceBlob: Blob | null = null
  let musicAssetId: string | null = null

  function applyLoadedAudioBuffer(
    buffer: AudioBuffer,
    sourceType: Exclude<MusicSourceType, 'none'>,
    trackName: string,
    sourceUrl: string,
    sourceBlob: Blob | null,
    options?: {
      assetId?: string | null
      preserveStartOffset?: number
      existingBeatTimes?: number[]
    },
  ) {
    music.audioBuffer = markRaw(buffer)
    music.sourceType = sourceType
    music.name = trackName
    music.url = sourceUrl
    music.duration = buffer.duration
    music.startOffset =
      options?.preserveStartOffset !== undefined
        ? Math.min(Math.max(0, options.preserveStartOffset), Math.max(0, buffer.duration - 0.5))
        : 0
    music.beatTimes =
      options?.existingBeatTimes && options.existingBeatTimes.length > 0
        ? [...options.existingBeatTimes]
        : detectBeats(buffer)
    musicSourceBlob = sourceBlob
    musicAssetId = options?.assetId ?? generateUniqueMusicAssetId()
  }

  async function loadMusicFile(file: File) {
    music.loading = true
    music.error = null
    try {
      const decodedBuffer = await decodeAudioFromFile(file)
      applyLoadedAudioBuffer(decodedBuffer, 'file', file.name, '', file)
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
      const { buffer: decodedBuffer, audioBlob } = await fetchAndDecodeAudioFromUrl(trimmedUrl)
      applyLoadedAudioBuffer(
        decodedBuffer,
        'url',
        extractTrackNameFromUrl(trimmedUrl),
        trimmedUrl,
        audioBlob,
      )
    } catch (err) {
      music.error = err instanceof Error ? err.message : 'Could not load audio from URL.'
    } finally {
      music.loading = false
    }
  }

  function resetMusicState() {
    music.audioBuffer = null
    music.sourceType = 'none'
    music.name = ''
    music.url = ''
    music.duration = 0
    music.startOffset = 0
    music.beatTimes = []
    music.error = null
    music.loading = false
    musicSourceBlob = null
    musicAssetId = null
  }

  function clearMusic() {
    resetMusicState()
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
    const targetTimeSeconds = computeSlideSeekTimeSeconds(timeline.value, slideIndex)
    if (targetTimeSeconds === null) return
    currentTime.value = targetTimeSeconds
  }

  function captureProjectSnapshot(name: string, projectId?: string): ProjectSavePayload {
    const settings: SavedProjectSettings = {
      timing: { ...timing },
      selectedTransitions: [...selectedTransitions.value],
      transitionOrder: transitionOrder.value,
      effects: { ...effects },
      output: { ...output },
      duplicateDetection: { ...duplicateDetection },
    }

    const savedMusic: SavedMusicRecord = {
      sourceType: music.sourceType,
      assetId: music.sourceType !== 'none' ? musicAssetId : null,
      name: music.name,
      url: music.url,
      mimeType: musicSourceBlob?.type || 'audio/mpeg',
      duration: music.duration,
      loop: music.loop,
      fadeIn: music.fadeIn,
      fadeOut: music.fadeOut,
      startOffset: music.startOffset,
      volume: music.volume,
      beatTimes: [...music.beatTimes],
    }

    return {
      projectId,
      name,
      slides: slides.value,
      music: savedMusic,
      musicSourceBlob: music.sourceType !== 'none' ? musicSourceBlob : null,
      settings,
      totalDurationSeconds: timeline.value.totalDuration,
    }
  }

  async function restoreProject(restored: RestoredProjectData): Promise<void> {
    clearAllSlides()
    resetMusicState()

    const { settings } = restored

    timing.slideDuration = Math.min(10, Math.max(0.5, settings.timing.slideDuration || 3.0))
    timing.transitionDuration = Math.min(
      2.5,
      Math.max(0.1, settings.timing.transitionDuration || 0.7),
    )
    timing.matchMusicLength = Boolean(settings.timing.matchMusicLength)

    const sanitizedTransitions = (settings.selectedTransitions || []).filter((transition) =>
      VALID_TRANSITION_IDS.has(transition),
    )
    selectedTransitions.value =
      sanitizedTransitions.length > 0 ? sanitizedTransitions : ['crossfade']
    transitionOrder.value = settings.transitionOrder === 'random' ? 'random' : 'cycle'

    effects.kenBurns = Boolean(settings.effects.kenBurns)
    effects.kenBurnsIntensity = Math.min(
      0.18,
      Math.max(0.03, settings.effects.kenBurnsIntensity || 0.08),
    )
    effects.fitMode = settings.effects.fitMode || 'blur-fill'
    effects.beatSync = Boolean(settings.effects.beatSync)
    effects.colorLook = settings.effects.colorLook || 'none'
    effects.vignette = Boolean(settings.effects.vignette)

    output.format = settings.output.format === 'webm' ? 'webm' : 'mp4'
    const matchedPreset = RESOLUTION_PRESETS.find((preset) => preset.id === settings.output.presetId)
    if (matchedPreset) {
      output.presetId = matchedPreset.id
      output.width = matchedPreset.width
      output.height = matchedPreset.height
    } else {
      output.presetId = settings.output.presetId || '1080p'
      output.width = settings.output.width || 1920
      output.height = settings.output.height || 1080
    }
    output.fps = settings.output.fps === 60 ? 60 : 30
    output.quality = settings.output.quality === 'high' ? 'high' : 'standard'

    duplicateDetection.enabled = Boolean(settings.duplicateDetection.enabled)
    duplicateDetection.similarityThresholdPercent = Math.min(
      DUPLICATE_THRESHOLD_MAX_PERCENT,
      Math.max(
        DUPLICATE_THRESHOLD_MIN_PERCENT,
        Math.round(
          settings.duplicateDetection.similarityThresholdPercent ??
            DEFAULT_DUPLICATE_THRESHOLD_PERCENT,
        ),
      ),
    )

    const restoredSlides: SlideImage[] = restored.slides.map(({ record, file }) => ({
      id: record.id,
      file,
      name: record.name,
      size: record.size || file.size,
      lastModified: record.lastModified || file.lastModified,
      width: record.width || 0,
      height: record.height || 0,
      thumbnailUrl: null,
      rotation: record.rotation || 0,
      contentHash: record.contentHash ?? null,
      perceptualFingerprint: record.perceptualFingerprint ?? null,
    }))

    slides.value = restoredSlides
    enqueueThumbnailsForSlides(restoredSlides)
    scheduleDuplicateDetectionForSlides()

    const savedMusic = restored.music.record
    if (savedMusic.sourceType !== 'none') {
      music.loop = Boolean(savedMusic.loop)
      music.fadeIn = Boolean(savedMusic.fadeIn)
      music.fadeOut = Boolean(savedMusic.fadeOut)
      music.volume = Math.min(1, Math.max(0, savedMusic.volume ?? 0.85))
      music.loading = true
      music.error = null

      try {
        if (restored.music.sourceBlob) {
          const decodedBuffer = await decodeAudioFromFile(restored.music.sourceBlob)
          applyLoadedAudioBuffer(
            decodedBuffer,
            savedMusic.sourceType,
            savedMusic.name,
            savedMusic.url,
            restored.music.sourceBlob,
            {
              assetId: savedMusic.assetId,
              preserveStartOffset: savedMusic.startOffset,
              existingBeatTimes: savedMusic.beatTimes,
            },
          )
        } else if (savedMusic.sourceType === 'url' && savedMusic.url) {
          const { buffer: decodedBuffer, audioBlob } = await fetchAndDecodeAudioFromUrl(
            savedMusic.url,
          )
          applyLoadedAudioBuffer(
            decodedBuffer,
            'url',
            savedMusic.name || extractTrackNameFromUrl(savedMusic.url),
            savedMusic.url,
            audioBlob,
            {
              assetId: savedMusic.assetId,
              preserveStartOffset: savedMusic.startOffset,
              existingBeatTimes: savedMusic.beatTimes,
            },
          )
        } else {
          timing.matchMusicLength = false
          effects.beatSync = false
        }
      } catch (err) {
        timing.matchMusicLength = false
        effects.beatSync = false
        music.error =
          err instanceof Error
            ? `Saved music could not be restored: ${err.message}`
            : 'Saved music track could not be restored.'
      } finally {
        music.loading = false
      }
    } else {
      timing.matchMusicLength = false
      effects.beatSync = false
    }
  }

  return {
    slides,
    currentTime,
    isPlaying,
    isMuted,
    rejectedFilesNotice,
    timing,
    selectedTransitions,
    transitionOrder,
    effects,
    music,
    output,
    duplicateDetection,
    timeline,
    estimatedSizeMB,
    activeSlideIndex,
    duplicateAnalysis,
    addFiles,
    dismissRejectedFilesNotice,
    removeSlide,
    removeDuplicateSlides,
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
    captureProjectSnapshot,
    restoreProject,
  }
}
