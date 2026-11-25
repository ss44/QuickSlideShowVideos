# Design & Architecture Decisions

All significant architectural decisions for QuickSlideShowVideos are tracked here so future contributors and agents understand *why* things are built this way.

---

## ADR-001: Vue 3 + TypeScript + Vite + Tailwind CSS v4

- **Decision:** Use Vue 3 (`<script setup lang="ts">`), TypeScript (strict), Vite, and Tailwind CSS v4 (`@tailwindcss/vite`).
- **Rationale:** User explicitly preferred Vue over React. Vue's fine-grained reactivity pairs cleanly with a single composable (`useSlideshow.ts`) and avoids extra state-management boilerplate.
- **Caveat:** Heavy native objects like `AudioBuffer` must be wrapped in `markRaw()` before storing on reactive objects so Vue's `Proxy` does not interfere with Web Audio API internals.

## ADR-002: WebCodecs + `mp4-muxer` / `webm-muxer` over FFmpeg.wasm

- **Decision:** Render frames onto `<canvas>` and encode with browser-native `VideoEncoder` / `AudioEncoder` (WebCodecs), muxing with `mp4-muxer` (H.264 + AAC) and `webm-muxer` (VP9/VP8 + Opus).
- **Rationale:**
  - **Bundle size:** ~50 KB vs ~30 MB WASM binary for FFmpeg.wasm.
  - **Speed:** Hardware-accelerated encoding, often faster than real time.
  - **Hosting simplicity:** No `SharedArrayBuffer` or `COOP`/`COEP` HTTP headers required — deploys to any static host.
  - **Memory with hundreds of images:** Deterministic frame-by-frame streaming avoids FFmpeg.wasm's 2 GB virtual filesystem/heap ceiling.
- **Trade-off / Future Migration Note:** Both `mp4-muxer` and `webm-muxer` are stable and work great today, though upstream has deprecated them in favor of `mediabunny`. Migrating to `mediabunny` is a clean future option once needed.

## ADR-003: Shared WYSIWYG Canvas 2D Renderer

- **Decision:** Both live preview (`PreviewStage.vue`) and video export (`exporter.ts`) invoke the exact same `SlideshowRenderer.renderFrame()` method.
- **Rationale:** Guarantees that transitions, Ken Burns trajectories, blurred backdrops, rotation, and color looks in the exported MP4 match the preview frame-for-frame.
- **Implementation Detail:** `SlideshowRenderer` pre-allocates two reusable scratch canvases (`scratchA`, `scratchB`) and a tiny `96×96` blur canvas so per-frame garbage collection stays near zero.

## ADR-004: Sliding-Window LRU `ImageBitmap` Cache & Lazy Thumbnails

- **Decision:** Keep original `File` handles in state, generate ~220px JPEG Blob URLs via a 4-worker `ThumbnailQueue`, and decode render-resolution `ImageBitmap`s through an LRU `BitmapCache` (6–12 entries) that calls `bitmap.close()` on eviction.
- **Rationale:** Dropping 300+ 12MP phone photos would otherwise consume gigabytes of GPU/RAM and crash the browser tab. Explicit `.close()` and `URL.revokeObjectURL()` keep memory flat.

## ADR-005: Client-Side Web Audio Engine, Beat Sync & CORS URL Handling

- **Decision:** Decode uploaded audio files and direct audio URLs via `AudioContext.decodeAudioData()`, run an energy-flux onset detector (`detectBeats`) for Beat Sync, play live previews with `AudioBufferSourceNode`, and render export audio via `OfflineAudioContext`.
- **Rationale:** Enables sample-accurate looping, start-offset trimming, and fade-in/fade-out in both preview and export.
- **Constraint:** Browsers block reading cross-origin audio URLs without `Access-Control-Allow-Origin` headers (including YouTube/Spotify). The UI surfaces a clear CORS message when a URL cannot be read directly.

## ADR-006: Deterministic Timeline Scheduling

- **Decision:** `computeTimeline()` in `src/engine/timeline.ts` is a pure function with a deterministic seeded PRNG (`seededRandom`) for `'random'` transition order and Ken Burns motion direction (`kenBurnsSeed`).
- **Rationale:** Ensures scrubbing back and forth in preview and exporting the final MP4 always produce identical transition choices and camera motions.

## ADR-007: SOLID Architecture, DRY Abstractions & Self-Documenting Code Standards

- **Decision:** Enforce SOLID design principles, contextual unit-explicit variable and function naming, shared cross-engine helpers, and explanatory comments on non-intuitive math/browser constraints.
- **Key Abstractions:**
  - **Open/Closed Strategy Registries:** Transitions (`TRANSITION_COMPOSERS`) and Color Looks (`COLOR_LOOK_FILTERS`) in `src/engine/renderer.ts` use declarative strategy tables rather than monolithic conditional branches.
  - **Dependency Inversion for Muxing:** `MediaContainerMuxer` in `src/engine/exporter.ts` abstracts `Mp4Muxer` and `WebmMuxer` behind a single interface so encoding loops are container-agnostic.
  - **Shared Engine Utilities:** Binary timeline lookup (`findSlideIndexAtTime`), sliding-window bitmap preloading (`BitmapCache.ensureSlideWindowLoaded`), audio loop/fade envelope scheduling (`scheduleAudioFadeEnvelope`), and display formatters (`src/utils/formatters.ts`) are centralized in single locations.
- **Rationale:** Keeps the codebase easy to read, reason about, and extend without regression risk between live preview and offline export.

## ADR-008: Local Browser Project Persistence (IndexedDB + `localStorage` Index Mirror)

- **Decision:** Store saved projects (settings, slide order, rotations, duplicate hashes, and raw binary photo/audio `Blob`s) in browser-local IndexedDB (`QuickSlideShowProjectsDB`) behind a `ProjectStorageRepository` interface (`src/engine/projectStorage.ts`), paired with a lightweight `localStorage` metadata mirror (`quick-slideshow:projects-index:v1` and `quick-slideshow:last-project-id:v1`).
- **Rationale:**
  - `window.localStorage` alone is capped at ~5 MB of UTF-16 text and would immediately fail with `QuotaExceededError` on projects containing multiple smartphone photos or an MP3 track.
  - IndexedDB natively persists binary `Blob`/`File` assets without base64 bloat, scales to hundreds of megabytes, and runs asynchronously off the main thread.
  - Incremental asset persistence (keyed by `${projectId}::${assetId}` and diffed via `IDBIndex.getAllKeys`) makes re-saving a 200+ photo project after tweaking settings near-instant while deleting removed assets cleanly.
  - All Vue reactive proxies are converted to plain structured-cloneable objects prior to `put()` to prevent `DataCloneError`, and cover thumbnail Blob URLs are explicitly revoked on refresh/unmount.
