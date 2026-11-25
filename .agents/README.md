# Agent Guide — QuickSlideShowVideos

QuickSlideShowVideos is a **100% browser-based slideshow video editor** built with **Vue 3, TypeScript, Vite, and Tailwind CSS v4**. Users drop in dozens or hundreds of images, tweak timing/transitions/smart effects, attach music, preview in real time, and export an `.mp4` or `.webm` directly in the browser with zero server-side processing.

## Non-Negotiable Invariants

1. **100% Client-Side**: Never introduce server-side rendering, upload endpoints, or backend video processing. The app must deploy as a static bundle (`dist/`).
2. **WYSIWYG Parity**: Preview (`src/components/PreviewStage.vue`) and Export (`src/engine/exporter.ts`) **must** share `SlideshowRenderer` (`src/engine/renderer.ts`) and `computeTimeline` (`src/engine/timeline.ts`). Never duplicate rendering math.
3. **Hundreds-of-Photos Memory Safety**: Never decode all images eagerly or store full-resolution `ImageBitmap` / data URLs in Vue reactive state. Always use `thumbnailQueue` for UI thumbnails and `BitmapCache` (LRU with `.close()` on eviction) for rendering.
4. **Simplicity First**: Keep the interface single-screen, uncluttered, and immediately understandable. Avoid adding heavy timeline tracks or NLE complexity unless explicitly requested.
5. **SOLID & Self-Reading Code**: Follow Single Responsibility and Open/Closed patterns, use contextual self-documenting variable/method names (with units where helpful), abstract redundant logic into shared helpers, and comment non-intuitive math or browser API constraints. See [`code-quality-and-solid`](./skills/code-quality-and-solid/SKILL.md).

## Architecture Map

```
src/
├── types/slideshow.ts        # All shared domain types, transition & preset registries
├── utils/
│   ├── fileDrop.ts           # Drag-and-drop image + nested folder extraction
│   └── formatters.ts         # Shared clock duration & file-size formatters
├── engine/
│   ├── imageCache.ts         # Concurrency-limited thumbnail queue + LRU ImageBitmap cache & window preloader
│   ├── timeline.ts           # Deterministic slide timing, beat snapping, O(log N) lookup, size estimate
│   ├── audioEngine.ts        # Audio decode (File + CORS URL), beat detection, shared fade envelope, preview & offline mix
│   ├── renderer.ts           # Shared Canvas 2D renderer (Open/Closed transition map, Ken Burns, blur-fill, looks)
│   └── exporter.ts           # WebCodecs encoder + unified MediaContainerMuxer adapter (MP4 & WebM)
├── composables/
│   └── useSlideshow.ts       # Central reactive state & actions (uses markRaw for AudioBuffer)
└── components/
    ├── TopBar.vue            # Live estimates (count, duration, size) & Export CTA
    ├── PreviewStage.vue      # Empty drop zone + real-time synced canvas preview player
    ├── SettingsSidebar.vue   # Collapsible controls (Timing, Transitions, Effects, Music, Output)
    ├── Filmstrip.vue         # Reorderable thumbnail strip / expandable grid + sorting
    └── ExportModal.vue       # Progress bar, ETA, cancellation, and download trigger
```

## Build & Verification Commands

This environment uses `mise` for Node.js:

```bash
mise exec node -- npm install
mise exec node -- npm run dev       # Local dev server
mise exec node -- npm run build     # vue-tsc -b type-check + Vite production build
mise exec node -- npm run preview   # Serve production dist/
```

## Skills & Decision Records

- Read [DECISIONS.md](./DECISIONS.md) before changing core tech choices or architecture.
- Load the relevant skill under `.agents/skills/` before modifying a subsystem:
  - [`code-quality-and-solid`](./skills/code-quality-and-solid/SKILL.md) — SOLID principles, contextual naming, DRY abstractions, and commenting rules.
  - [`slideshow-renderer`](./skills/slideshow-renderer/SKILL.md) — Transitions, Ken Burns, framing, color looks, WYSIWYG rules.
  - [`webcodecs-export`](./skills/webcodecs-export/SKILL.md) — MP4/WebM encoding, codec probing, audio muxing, backpressure.
  - [`large-photo-performance`](./skills/large-photo-performance/SKILL.md) — Memory management for 100–500+ images.
  - [`audio-and-beat-sync`](./skills/audio-and-beat-sync/SKILL.md) — Web Audio playback, offline mixing, CORS URLs, beat detection.
