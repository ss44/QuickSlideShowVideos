import type { SlideImage, SlideSortMode } from '../types/slideshow'

type SlideSortStrategy = (slides: SlideImage[]) => SlideImage[]

const MAX_NON_IDENTITY_SHUFFLE_ATTEMPTS = 6

function compareSlidesByNaturalName(firstSlide: SlideImage, secondSlide: SlideImage): number {
  return firstSlide.name.localeCompare(secondSlide.name, undefined, { numeric: true })
}

function compareSlidesByDateAscending(firstSlide: SlideImage, secondSlide: SlideImage): number {
  return firstSlide.lastModified - secondSlide.lastModified
}

function compareSlidesByDateDescending(firstSlide: SlideImage, secondSlide: SlideImage): number {
  return secondSlide.lastModified - firstSlide.lastModified
}

/**
 * Randomly permutes slides using an unbiased Fisher-Yates shuffle.
 * When 2+ slides are present and a draw happens to preserve the existing order
 * (common for 2-3 slides), re-samples so choosing "Random" always visibly changes the timeline.
 */
function computeRandomizedSlides(slides: SlideImage[]): SlideImage[] {
  if (slides.length <= 1) return slides.slice()

  const originalSlideIds = slides.map((slide) => slide.id)
  const shuffledSlides = slides.slice()

  for (let attempt = 0; attempt < MAX_NON_IDENTITY_SHUFFLE_ATTEMPTS; attempt++) {
    for (let currentIndex = shuffledSlides.length - 1; currentIndex > 0; currentIndex--) {
      const swapIndex = Math.floor(Math.random() * (currentIndex + 1))
      ;[shuffledSlides[currentIndex], shuffledSlides[swapIndex]] = [
        shuffledSlides[swapIndex],
        shuffledSlides[currentIndex],
      ]
    }

    const hasOrderChanged = shuffledSlides.some(
      (slide, slideIndex) => slide.id !== originalSlideIds[slideIndex],
    )
    if (hasOrderChanged) {
      return shuffledSlides
    }
  }

  // Fallback for degenerate RNG sequences: swap the first two slides so the timeline still changes.
  ;[shuffledSlides[0], shuffledSlides[1]] = [shuffledSlides[1], shuffledSlides[0]]
  return shuffledSlides
}

const SLIDE_SORT_STRATEGIES: Record<SlideSortMode, SlideSortStrategy> = {
  name: (slides) => slides.slice().sort(compareSlidesByNaturalName),
  'date-asc': (slides) => slides.slice().sort(compareSlidesByDateAscending),
  'date-desc': (slides) => slides.slice().sort(compareSlidesByDateDescending),
  reverse: (slides) => slides.slice().reverse(),
  random: computeRandomizedSlides,
}

export function computeSortedSlides(slides: SlideImage[], sortMode: SlideSortMode): SlideImage[] {
  return SLIDE_SORT_STRATEGIES[sortMode](slides)
}
