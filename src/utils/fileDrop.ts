const SUPPORTED_IMAGE_EXTENSIONS = /\.(jpe?g|png|webp|gif|bmp|avif|tiff?|heic|heif)$/i

export function isImageFile(file: File): boolean {
  if (file.type && file.type.startsWith('image/')) return true
  return SUPPORTED_IMAGE_EXTENSIONS.test(file.name)
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
        (file) => resolve(isImageFile(file) ? [file] : []),
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
 * Extracts image files from a drag-and-drop `DataTransfer`, supporting both flat file drops
 * and recursively nested folder drops.
 */
export async function extractImagesFromDrop(dataTransfer: DataTransfer): Promise<File[]> {
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

  return Array.from(dataTransfer.files || []).filter(isImageFile)
}
