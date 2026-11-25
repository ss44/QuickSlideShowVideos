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

1. **Dimension Alignment:** H.264 and VP9 encoders require even dimensions (`output.width - (output.width % 2)`).
2. **Codec Probing (`selectSupportedVideoCodec` & `selectSupportedAudioCodec`):**
   - Probes `VideoEncoder.isConfigSupported()` with `latencyMode: 'realtime'` (disables out-of-order B-frame reordering required by `mp4-muxer`) from High profile down to Baseline (for MP4) or VP9 -> VP8 (for WebM).
   - For MP4 audio, probes `mp4a.40.2` (AAC) first and falls back to `opus` (`mp4-muxer` supports Opus in MP4) so exports retain audio even on Linux Chromium builds without a native AAC encoder.
3. **Unified Container Muxer (`MediaContainerMuxer` / `createContainerMuxer`):**
   - Wraps `Mp4Muxer` and `WebmMuxer` behind a single polymorphic interface (`addVideoChunk`, `addAudioChunk`, `finalizeToBlob`) so encoding pipelines remain container-agnostic (Dependency Inversion Principle).
4. **Audio Mixing & Encoding (`encodeAudioTrackToMuxer`):**
   - Uses `renderExportAudioBuffer()` (`OfflineAudioContext`) to bake volume, looping, start offset, and fade-in/out into stereo 48 kHz PCM.
   - Packs PCM in `4096`-sample chunks via `packStereoChunkAsPlanarFloat32()` using `format: 'f32-planar'` (channel 0 followed contiguously by channel 1).
   - Always call `audioData.close()` immediately after `audioEncoder.encode(audioData)`.
5. **Frame-by-Frame Video Encoding (`encodeVideoFramesToMuxer`):**
   - Uses a dedicated `BitmapCache(6, maxDim)` isolated from the preview cache and calls `exportBitmapCache.ensureSlideWindowLoaded(...)` per frame.
   - Creates `new VideoFrame(renderCanvas, { timestamp, duration })`, encodes with a keyframe every `fps * 2` frames, and immediately calls `videoFrame.close()`.
   - Enforces backpressure (`while (videoEncoder.encodeQueueSize > MAX_VIDEO_ENCODE_QUEUE_SIZE ...) await yieldToMainThread(8)`) so GPU memory never grows unbounded on long slideshows.
6. **Cancellation & Cleanup:** Always check `signal.aborted` and `encoderError` inside audio and video loops, close encoders safely in `finally`, and call `exportBitmapCache.clear()`.

## Common Pitfalls

- **Forgetting `videoFrame.close()` or `audioData.close()`:** Rapidly exhausts browser GPU/media memory and stalls `VideoEncoder`.
- **Non-monotonic timestamps:** Frame timestamps must strictly increase (`Math.round((frameIdx * 1_000_000) / fps)`).
- **Revoking Blob URLs too early:** Keep the finished `blobUrl` alive in `App.vue` until a new export starts or the component unmounts so "Download Again" keeps working.
