---
name: audio-and-beat-sync
description: Architecture and constraints for Web Audio decoding, CORS music links, beat detection, preview synchronization, and offline export mixing.
---

# Audio Engine & Beat Sync

## Key Files

- `src/engine/audioEngine.ts` — Decode, `detectBeats`, `PreviewAudioPlayer`, `renderExportAudioBuffer`
- `src/engine/timeline.ts` — Beat-snapped cut calculation inside `computeTimeline()`
- `src/composables/useSlideshow.ts` — `music` reactive state (`markRaw(buffer)`)

## Key Details

1. **`markRaw(buffer)` is required:** Never let Vue deeply proxy an `AudioBuffer`. Always assign `music.audioBuffer = markRaw(buffer)`.
2. **Preview & Export Audio Parity:** Both `PreviewAudioPlayer.start()` and `renderExportAudioBuffer()` must honor the exact same parameters:
   - `startOffset` (where playback begins inside the track)
   - `loop` (sets `loopStart = startOffset`, `loopEnd = buffer.duration`)
   - `volume` (`0..1`)
   - `fadeIn` (1.5s linear ramp up, clamped to 25% of video duration)
   - `fadeOut` (2.5s linear ramp down at the end of the video, clamped to 25% of video duration)
3. **CORS Reality for Music Links:** `fetch(url, { mode: 'cors' })` only succeeds if the host sends `Access-Control-Allow-Origin`. Always preserve friendly, actionable error messages explaining that direct `.mp3`/`.wav` URLs require CORS and suggesting local file upload as the universal fallback.
4. **Beat Sync Algorithm:**
   - `detectBeats()` computes mono RMS energy in ~23ms hops, extracts positive energy flux, and picks local maxima exceeding `1.65×` the local 1-second mean with a minimum 0.28s spacing.
   - `computeTimeline()` shifts beat times by `startOffset`, tiles beats if `loop` is enabled, and snaps each slide boundary to the beat closest to `cursor + baseSlideDuration` (within `[0.65×, 1.85×]` of `baseSlideDuration`).
