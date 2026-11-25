---
name: large-photo-performance
description: Memory and UI responsiveness discipline for handling 100-500+ high-resolution user photos in the browser.
---

# Performance & Memory for Hundreds of Images

## Key Files

- `src/engine/imageCache.ts` — `ThumbnailQueue`, `BitmapCache`
- `src/utils/fileDrop.ts` — Recursive folder/file drop extraction
- `src/components/Filmstrip.vue` — Thumbnail strip & expandable grid

## Mandatory Rules

1. **Never keep full-res decoded images for the whole project.** Only store lightweight `File` references in `slides`.
2. **Always close evicted `ImageBitmap`s.** `BitmapCache` calls `bitmap.close()` whenever an entry is evicted or cleared. Any new bitmap cache must do the same.
3. **Always revoke Blob URLs.** When removing a slide (`removeSlide`) or clearing all (`clearAllSlides`), call `URL.revokeObjectURL(slide.thumbnailUrl)`.
4. **Limit concurrent thumbnail decoding.** `ThumbnailQueue` caps concurrency at `4` and scales thumbnails to `220px` max side (`image/jpeg`, quality `0.78`). Do not use `FileReader.readAsDataURL` on raw multi-megabyte photos.
5. **Respect EXIF orientation.** Always pass `{ imageOrientation: 'from-image' }` to `createImageBitmap()` so smartphone photos are never rotated sideways.
6. **Binary search the timeline.** `findSlideIndexAtTime()` in `src/engine/timeline.ts` uses O(log N) binary search and is shared across `useSlideshow.ts`, `PreviewStage.vue`, `SlideshowRenderer`, and `exporter.ts`.
7. **Use `BitmapCache.ensureSlideWindowLoaded()` for sliding-window preloading.** Both `PreviewStage.vue` and `exporter.ts` call `bitmapCache.ensureSlideWindowLoaded(...)` to load the active and outgoing slides while preloading the next 2–3 slides asynchronously.
