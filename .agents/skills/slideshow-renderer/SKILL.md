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
2. Add a `case` in `SlideshowRenderer.composeTransition()` in `src/engine/renderer.ts`.
   - `this.scratchA` holds the outgoing slide at `width × height`.
   - `this.scratchB` holds the incoming slide at `width × height`.
   - `t` is eased (`easeInOutCubic`) in `[0, 1]`.
3. Verify the transition works at both landscape (`1920×1080`) and portrait (`1080×1920`) aspect ratios using `width` and `height` proportionally (no hardcoded pixel distances).

## Adding a New Smart Effect or Color Look

- For global color looks, extend `ColorLook` / `COLOR_LOOK_OPTIONS` and `getColorFilter()` in `src/engine/renderer.ts`.
- Remember that `ctx.filter` is supported in modern Chromium, Safari, and Firefox; keep filter strings standard CSS filter syntax.
- For blurred backdrops (`fitMode === 'blur-fill'`), render into the tiny `96×96` `this.blurCanvas` first before upscaling with `blur(24px)` — blurring a full 4K image directly is 100× slower.
