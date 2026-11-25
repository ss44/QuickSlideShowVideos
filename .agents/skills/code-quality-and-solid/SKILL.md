---
name: code-quality-and-solid
description: Mandatory SOLID architecture principles, self-documenting naming conventions, DRY abstraction rules, and commenting standards for all code changes.
---

# Code Quality, Maintainability & SOLID Principles

Every contribution to QuickSlideShowVideos must prioritize **readability**, **maintainability**, and **self-explaining code**. Follow these rules whenever writing or reviewing code.

---

## 1. SOLID Principles in Practice

- **Single Responsibility Principle (SRP):**
  - Each module, class, and function must do **one well-defined job**.
  - Decompose multi-stage pipelines (such as timeline scheduling, beat detection, frame rendering, and WebCodecs export) into small, focused helper functions that operate at a single level of abstraction.
  - Keep Vue components focused on presentation and user interaction; business rules, media decoding, and math belong in `src/engine/` or `src/utils/`.
- **Open/Closed Principle (OCP):**
  - Prefer declarative strategy maps/registries over sprawling `switch` or `if/else` chains when behavior varies by type (e.g., `TRANSITION_COMPOSERS` for transitions, `COLOR_LOOK_FILTERS` for color grading, and option constants in `src/types/slideshow.ts`).
  - Adding a new transition, color look, or resolution preset should only require registering a new entry.
- **Liskov Substitution & Interface Segregation (LSP / ISP):**
  - Keep interfaces narrow and purpose-built. Functions should only accept the slice of configuration they actually read.
- **Dependency Inversion Principle (DIP):**
  - High-level orchestrators (like `exportSlideshowVideo`) should depend on unified abstractions (such as `MediaContainerMuxer`) rather than branching on concrete muxer implementations (`Mp4Muxer` vs `WebmMuxer`) throughout the loop.

---

## 2. Contextual, Self-Reading Naming

- **No cryptic abbreviations:** Avoid single-letter or ambiguous names like `bmp`, `s`, `t`, `c`, `v`, `lo`, `hi`, `dt`, `w`, `h` outside trivial 1-line lambdas.
- **Include units or domain context in variable names:**
  - Use `timeSeconds`, `durationSeconds`, `elapsedMs`, `timestampMicroseconds`, `sampleRateHz`, `rotationDegrees`, `rotationRadians`, `canvasWidth`, `canvasHeight`, `slideIndex`.
- **Method names must state intent clearly:**
  - Boolean checks start with `is`, `has`, `can`, or `should` (e.g., `isImageFile`, `isWebCodecsSupported`, `shouldRenderBlurredBackdrop`).
  - Pure computations start with `compute`, `resolve`, `select`, `estimate`, or `format` (e.g., `computeBeatSnappedStartTimes`, `computeKenBurnsTransform`, `formatDurationClock`).
  - Side-effecting actions use clear verbs (`scheduleAudioFadeEnvelope`, `ensureSlideWindowLoaded`, `encodeAudioTrackToMuxer`).

---

## 3. Eliminating Redundant Logic (DRY)

- **Single source of truth for algorithms:**
  - Timeline lookup (`findSlideIndexAtTime`) lives only in `src/engine/timeline.ts`.
  - Sliding-window bitmap preloading (`ensureSlideWindowLoaded`) lives only on `BitmapCache` in `src/engine/imageCache.ts`.
  - Audio loop bounds and fade-in/fade-out gain scheduling (`configureAudioSourceLoop`, `scheduleAudioFadeEnvelope`) are shared between live preview and offline export in `src/engine/audioEngine.ts`.
  - Human-readable time and file-size formatting lives in `src/utils/formatters.ts`.
- Before writing a helper in a component or engine file, check whether `src/engine/` or `src/utils/` already provides it.

---

## 4. Commenting Non-Intuitive Logic

- **Do not comment the obvious** (e.g., `// increment index`).
- **Always comment the *why* and the underlying math/constraints** for non-intuitive logic:
  - Binary search boundaries and clamping invariants (e.g., why transition duration is capped at 45% of adjacent slide durations).
  - WebCodecs constraints (even-pixel dimension alignment, `latencyMode: 'realtime'` to prevent B-frame timestamp reordering in `mp4-muxer`, `'f32-planar'` audio sample layout, and backpressure queue limits).
  - Canvas rendering optimizations (why backdrop blur is performed on a downsampled `96×96` scratch canvas instead of full 1080p/4K resolution, and why rotated 90°/270° images swap width/height before aspect-fit scaling).
  - Audio signal processing (RMS window size, positive energy-flux onset thresholding, and minimum beat separation).
