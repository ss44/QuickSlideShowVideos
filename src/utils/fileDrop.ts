/**
 * Explicit allowlist of raster image MIME types reliably decodable by browser Canvas 2D /
 * `createImageBitmap` across Chromium, Firefox, and Safari.
 * Intentionally excludes wildcard `image/*` matching so camera RAW formats (e.g. `image/x-adobe-dng`,
 * `image/x-sony-arw`, `image/x-canon-cr2`, `image/x-nikon-nef`), TIFF, HEIC/HEIF, PSD, and SVG
 * do not slip through and produce broken thumbnails or blank frames.
 */
export const SUPPORTED_IMAGE_MIME_TYPES: ReadonlySet<string> = new Set([
  'image/jpeg',
  'image/jpg',
  'image/pjpeg',
  'image/png',
  'image/webp',
  'image/gif',
  'image/bmp',
  'image/x-ms-bmp',
  'image/avif',
])

export const SUPPORTED_IMAGE_EXTENSIONS: ReadonlySet<string> = new Set([
  'jpg',
  'jpeg',
  'jfif',
  'pjpeg',
  'pjp',
  'png',
  'webp',
  'gif',
  'bmp',
  'avif',
])

export const SUPPORTED_IMAGE_INPUT_ACCEPT =
  'image/jpeg,image/png,image/webp,image/gif,image/bmp,image/avif,.jpg,.jpeg,.jfif,.png,.webp,.gif,.bmp,.avif'

export const SUPPORTED_IMAGE_FORMATS_LABEL = 'JPG, PNG, WebP, GIF, BMP, AVIF'

const SYSTEM_METADATA_FILENAMES: ReadonlySet<string> = new Set([
  '.ds_store',
  'thumbs.db',
  'desktop.ini',
])

export interface PartitionedImageFiles {
  supportedFiles: File[]
  rejectedFiles: File[]
}

/**
 * Extracts the lowercase file extension without a leading dot, or `null` if the filename
 * has no extension (including dotfiles like `.DS_Store`).
 */
export function extractFileExtension(fileName: string): string | null {
  const trimmedName = fileName.trim()
  const lastDotIndex = trimmedName.lastIndexOf('.')
  if (lastDotIndex <= 0 || lastDotIndex === trimmedName.length - 1) {
    return null
  }
  return trimmedName.slice(lastDotIndex + 1).toLowerCase()
}

/**
 * Identifies OS-generated folder metadata files (e.g. `.DS_Store`, `Thumbs.db`, macOS `._*`
 * resource forks) so folder drops silently ignore them instead of warning the user.
 */
export function isSystemMetadataFile(file: File): boolean {
  const baseName = file.name.trim().toLowerCase()
  return SYSTEM_METADATA_FILENAMES.has(baseName) || baseName.startsWith('._')
}

/**
 * Determines whether a `File` is a browser-supported raster image format.
 * Requires an allowlisted extension when one is present (preventing OS-supplied `image/*` RAW
 * MIME types like `image/x-adobe-dng` or `image/x-sony-arw` from passing), and validates any
 * explicit non-generic MIME type against `SUPPORTED_IMAGE_MIME_TYPES`.
 */
export function isImageFile(file: File): boolean {
  if (isSystemMetadataFile(file)) return false

  const normalizedMimeType = (file.type || '').trim().toLowerCase().split(';')[0]
  const extension = extractFileExtension(file.name)

  if (extension !== null) {
    if (!SUPPORTED_IMAGE_EXTENSIONS.has(extension)) {
      return false
    }
    if (
      normalizedMimeType.length > 0 &&
      normalizedMimeType !== 'application/octet-stream' &&
      !SUPPORTED_IMAGE_MIME_TYPES.has(normalizedMimeType)
    ) {
      return false
    }
    return true
  }

  return normalizedMimeType.length > 0 && SUPPORTED_IMAGE_MIME_TYPES.has(normalizedMimeType)
}

/**
 * Splits incoming files into supported images and rejected unsupported files,
 * silently ignoring OS folder metadata files.
 */
export function partitionSupportedImageFiles(inputFiles: Iterable<File>): PartitionedImageFiles {
  const supportedFiles: File[] = []
  const rejectedFiles: File[] = []

  for (const file of inputFiles) {
    if (isSystemMetadataFile(file)) continue
    if (isImageFile(file)) {
      supportedFiles.push(file)
    } else {
      rejectedFiles.push(file)
    }
  }

  return { supportedFiles, rejectedFiles }
}

const MAX_DISPLAYED_REJECTED_EXTENSIONS = 4

/**
 * Formats a concise, human-readable message explaining which unsupported or undecodable files
 * were skipped during drop/selection.
 */
export function formatRejectedFilesNotice(
  rejectedFiles: ReadonlyArray<Pick<File, 'name'>>,
): string | null {
  if (rejectedFiles.length === 0) return null

  if (rejectedFiles.length === 1) {
    return `Skipped "${rejectedFiles[0].name}" — unsupported or unreadable file. Supported: ${SUPPORTED_IMAGE_FORMATS_LABEL}.`
  }

  const uniqueExtensions: string[] = []
  const seenExtensions = new Set<string>()
  for (const file of rejectedFiles) {
    const extension = extractFileExtension(file.name)
    if (!extension) continue
    const formattedExtension = `.${extension.toUpperCase()}`
    if (!seenExtensions.has(formattedExtension)) {
      seenExtensions.add(formattedExtension)
      uniqueExtensions.push(formattedExtension)
    }
  }

  let extensionSummary = ''
  if (uniqueExtensions.length > 0) {
    const visibleExtensions = uniqueExtensions.slice(0, MAX_DISPLAYED_REJECTED_EXTENSIONS)
    const remainingExtensionCount = uniqueExtensions.length - visibleExtensions.length
    const extensionList =
      remainingExtensionCount > 0
        ? `${visibleExtensions.join(', ')} +${remainingExtensionCount} more`
        : visibleExtensions.join(', ')
    extensionSummary = ` (${extensionList})`
  }

  return `Skipped ${rejectedFiles.length} unsupported files${extensionSummary}. Supported: ${SUPPORTED_IMAGE_FORMATS_LABEL}.`
}

function compareFilesByNaturalName(fileA: File, fileB: File): number {
  return fileA.name.localeCompare(fileB.name, undefined, { numeric: true })
}

/**
 * Reads all entries from a `FileSystemDirectoryEntry`.
 * Per the File and Directory Entries API spec, `reader.readEntries()` returns results in batches
 * (typically up to 100 items per call) and must be invoked repeatedly until an empty batch is returned.
 */
async function readAllDirectoryEntries(
  directoryEntry: FileSystemDirectoryEntry,
): Promise<FileSystemEntry[]> {
  const directoryReader = directoryEntry.createReader()
  const collectedEntries: FileSystemEntry[] = []

  await new Promise<void>((resolve) => {
    const readNextBatch = () => {
      directoryReader.readEntries(
        (batch) => {
          if (batch.length === 0) {
            resolve()
          } else {
            collectedEntries.push(...batch)
            readNextBatch()
          }
        },
        () => resolve(),
      )
    }
    readNextBatch()
  })

  return collectedEntries
}

async function readFilesFromFileSystemEntry(entry: FileSystemEntry): Promise<File[]> {
  if (entry.isFile) {
    return new Promise((resolve) => {
      ;(entry as FileSystemFileEntry).file(
        (file) => resolve(isSystemMetadataFile(file) ? [] : [file]),
        () => resolve([]),
      )
    })
  }

  if (entry.isDirectory) {
    const childEntries = await readAllDirectoryEntries(entry as FileSystemDirectoryEntry)
    const nestedFileLists = await Promise.all(
      childEntries.map((childEntry) => readFilesFromFileSystemEntry(childEntry)),
    )
    return nestedFileLists.flat()
  }

  return []
}

/**
 * Extracts all dropped files from a drag-and-drop `DataTransfer`, supporting both flat file drops
 * and recursively nested folder drops (excluding hidden OS metadata files).
 * Filtering into supported vs. rejected files is deferred to `partitionSupportedImageFiles()`
 * so the caller can report unsupported formats (e.g. `.dng`, `.arw`) to the user.
 */
export async function extractFilesFromDrop(dataTransfer: DataTransfer): Promise<File[]> {
  const transferItems = Array.from(dataTransfer.items || [])
  const supportsFileSystemEntryApi =
    transferItems.length > 0 && typeof transferItems[0].webkitGetAsEntry === 'function'

  if (supportsFileSystemEntryApi) {
    const rootEntries = transferItems
      .map((item) => item.webkitGetAsEntry())
      .filter((entry): entry is FileSystemEntry => entry !== null)

    if (rootEntries.length > 0) {
      const extractedFiles = (
        await Promise.all(rootEntries.map((entry) => readFilesFromFileSystemEntry(entry)))
      ).flat()
      return extractedFiles.sort(compareFilesByNaturalName)
    }
  }

  return Array.from(dataTransfer.files || []).filter((file) => !isSystemMetadataFile(file))
}
