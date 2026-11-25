---
name: slideshow-renderer
description: Rules and workflow for modifying Canvas 2D rendering, transitions, Ken Burns motion, smart framing, and color looks while preserving Preview/Export WYSIWYG parity.
---

# Slideshow Renderer & Transitions

## Key Files

- `src/types/slideshow.ts` — `TransitionType`, `TRANSITION_OPTIONS`, `FitMode`, `ColorLook`, `COLOR_LOOK_OPTIONS`, `SmartEffectsConfig`
- `src/engine/renderer.ts` — `SlideshowRenderer`
- `src/engine/timeline.ts` — `computeTimeline()`

## Golden Rules

1. **Never put rendering logic inside Vue components.** All visual effects belong in `SlideshowRenderer` so `PreviewStage.vue` and `exporter.ts` produce identical frames.
2. **Keep motion deterministic.** Any per-slide variation (like Ken Burns pan/zoom direction) must derive from `tSlide.kenBurnsSeed` or `slideIndex`, never `Math.random()`.
3. **Avoid per-frame allocations.** Reuse `this.scratchA`, `this.scratchB`, and `this.blurCanvas`. Creating new `<canvas>` elements inside `renderFrame()` will cause GC stutter during 60fps preview and slow down export.
4. **Always `ctx.save()` / `ctx.restore()`** around filters, transforms, clipping paths, alpha, and shadows.

## Adding a New Transition

1. Add the union member to `TransitionType` and label to `TRANSITION_OPTIONS` in `src/types/slideshow.ts`.
2. Add an entry to the declarative `TRANSITION_COMPOSERS` strategy map in `src/engine/renderer.ts`:
   - `outgoingCanvas` holds the outgoing slide rendered at `canvasWidth × canvasHeight`.
   - `incomingCanvas` holds the incoming slide rendered at `canvasWidth × canvasHeight`.
   - `easedProgress` is cubic-eased (`easeInOutCubic`) in `[0, 1]`.
3. Verify the transition works at both landscape (`1920×1080`) and portrait (`1080×1920`) aspect ratios using `canvasWidth` and `canvasHeight` proportionally (no hardcoded pixel distances).

## Adding a New Smart Effect or Color Look

- For global color looks, extend `ColorLook` / `COLOR_LOOK_OPTIONS` in `src/types/slideshow.ts` and add the CSS filter string to `COLOR_LOOK_FILTERS` in `src/engine/renderer.ts`.
- Remember that `ctx.filter` is supported in modern Chromium, Safari, and Firefox; keep filter strings standard CSS filter syntax.
- For blurred backdrops (`fitMode === 'blur-fill'`), `renderBlurredBackdrop()` renders and blurs directly on the tiny `96×96` `this.blurScratchCanvas` before upscaling with high-quality bilinear smoothing — blurring a full 4K image directly is ~20× slower.
