---
name: webcodecs-export
description: Guide for maintaining and extending the client-side WebCodecs MP4/WebM video and audio export pipeline.
---

# WebCodecs Video & Audio Export

## Key Files

- `src/engine/exporter.ts` — `exportSlideshowVideo()`, codec probing, muxing, backpressure
- `src/engine/timeline.ts` — `getVideoBitrate()`, `estimateFileSizeMB()`
- `src/components/ExportModal.vue` — Progress UI and download trigger

## Pipeline Overview

1. **Dimension Alignment:** H.264 and VP9 encoders require even dimensions (`width - (width % 2)`).
2. **Codec Probing (`pickVideoCodec`):** Probes `VideoEncoder.isConfigSupported()` from High profile down to Baseline (for MP4) or VP9 -> VP8 (for WebM) so exports succeed across Chrome, Edge, Safari, and Firefox.
3. **Audio Mixing & Encoding:**
   - Uses `renderExportAudioBuffer()` (`OfflineAudioContext`) to bake volume, looping, start offset, and fade-in/out into stereo 48 kHz PCM.
   - Encodes PCM in `4096`-sample chunks using `format: 'f32-planar'` (channel 0 followed by channel 1 in a single `Float32Array`).
   - Always call `audioData.close()` immediately after `audioEncoder.encode(audioData)`.
4. **Frame-by-Frame Video Encoding:**
   - Uses a dedicated `BitmapCache(6, maxDim)` isolated from the preview cache so export cleans up all bitmaps in `finally`.
   - Creates `new VideoFrame(renderCanvas, { timestamp, duration })`, encodes with a keyframe every `fps * 2` frames, and immediately calls `videoFrame.close()`.
   - Enforces backpressure (`while (videoEncoder.encodeQueueSize > 8) await yieldToMain()`) so GPU memory never grows unbounded on long slideshows.
5. **Cancellation & Cleanup:** Always check `signal.aborted` inside audio and video loops, close encoders safely on error/cancel, and call `exportCache.clear()` in `finally`.

## Common Pitfalls

- **Forgetting `videoFrame.close()` or `audioData.close()`:** Rapidly exhausts browser GPU/media memory and stalls `VideoEncoder`.
- **Non-monotonic timestamps:** Frame timestamps must strictly increase (`Math.round((frameIdx * 1_000_000) / fps)`).
- **Revoking Blob URLs too early:** Keep the finished `blobUrl` alive in `App.vue` until a new export starts or the component unmounts so "Download Again" keeps working.
