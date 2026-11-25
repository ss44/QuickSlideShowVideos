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
6. **Binary search the timeline.** `findSlideAtTime()` in `renderer.ts` and `activeSlideIndex` in `useSlideshow.ts` use O(log N) binary search so scrubbing stays instant with hundreds of slides.
7. **Preload ahead by 2–3 slides.** Both `PreviewStage.vue` and `exporter.ts` preload the next 2–3 slides asynchronously while rendering the current slide to eliminate transition hitching.
