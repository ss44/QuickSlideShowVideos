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
