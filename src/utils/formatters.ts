/**
 * Formats a duration in seconds into `M:SS` or `H:MM:SS` clock notation.
 */
export function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00'
  const totalWholeSeconds = Math.floor(seconds)
  const hours = Math.floor(totalWholeSeconds / 3600)
  const minutes = Math.floor((totalWholeSeconds % 3600) / 60)
  const remainingSeconds = totalWholeSeconds % 60

  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, '0')}:${String(remainingSeconds).padStart(2, '0')}`
  }
  return `${minutes}:${String(remainingSeconds).padStart(2, '0')}`
}

/**
 * Formats a duration in seconds with tenths of a second (`M:SS.d`).
 */
export function formatTimeDetailed(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00.0'
  const minutes = Math.floor(seconds / 60)
  const remainingSeconds = seconds % 60
  return `${minutes}:${remainingSeconds < 10 ? '0' : ''}${remainingSeconds.toFixed(1)}`
}

/**
 * Formats an estimated megabyte size cleanly (e.g. `0.8 MB` for < 1 MB, `14 MB` for >= 1 MB).
 */
export function formatEstimatedSizeMB(sizeMegabytes: number): string {
  if (!Number.isFinite(sizeMegabytes) || sizeMegabytes <= 0) return '0.0 MB'
  const formattedNumber = sizeMegabytes < 1 ? sizeMegabytes.toFixed(1) : String(Math.round(sizeMegabytes))
  return `${formattedNumber} MB`
}

/**
 * Converts a raw byte count into a human-readable megabyte string (e.g. `4.2 MB`).
 */
export function formatBytesToMB(sizeBytes: number | undefined): string {
  if (!sizeBytes || sizeBytes <= 0) return ''
  const megabytes = sizeBytes / (1024 * 1024)
  return `${megabytes.toFixed(1)} MB`
}

/**
 * Formats any byte count into KB, MB, or GB for storage indicators and project cards.
 */
export function formatBytesReadable(sizeBytes: number): string {
  if (!Number.isFinite(sizeBytes) || sizeBytes <= 0) return '0 KB'
  const kilobytes = sizeBytes / 1024
  if (kilobytes < 1024) {
    return `${Math.max(1, Math.round(kilobytes))} KB`
  }
  const megabytes = kilobytes / 1024
  if (megabytes < 1024) {
    return `${megabytes < 10 ? megabytes.toFixed(1) : Math.round(megabytes)} MB`
  }
  const gigabytes = megabytes / 1024
  return `${gigabytes.toFixed(2)} GB`
}

/**
 * Formats an epoch timestamp in milliseconds as a concise relative label or calendar date.
 */
export function formatRelativeTimestamp(timestampMs: number): string {
  if (!Number.isFinite(timestampMs) || timestampMs <= 0) return ''
  const elapsedSeconds = Math.max(0, Math.floor((Date.now() - timestampMs) / 1000))
  if (elapsedSeconds < 45) return 'Just now'
  const elapsedMinutes = Math.floor(elapsedSeconds / 60)
  if (elapsedMinutes < 60) return `${elapsedMinutes}m ago`
  const elapsedHours = Math.floor(elapsedMinutes / 60)
  if (elapsedHours < 24) return `${elapsedHours}h ago`
  const elapsedDays = Math.floor(elapsedHours / 24)
  if (elapsedDays < 7) return `${elapsedDays}d ago`

  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    year: new Date(timestampMs).getFullYear() === new Date().getFullYear() ? undefined : 'numeric',
  }).format(new Date(timestampMs))
}
