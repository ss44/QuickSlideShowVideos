const IMAGE_EXTENSIONS = /\.(jpe?g|png|webp|gif|bmp|avif|tiff?|heic|heif)$/i

export function isImageFile(file: File): boolean {
  if (file.type && file.type.startsWith('image/')) return true
  return IMAGE_EXTENSIONS.test(file.name)
}

async function readEntryFiles(entry: FileSystemEntry): Promise<File[]> {
  if (entry.isFile) {
    return new Promise((resolve) => {
      ;(entry as FileSystemFileEntry).file(
        (file) => resolve(isImageFile(file) ? [file] : []),
        () => resolve([]),
      )
    })
  }
  if (entry.isDirectory) {
    const reader = (entry as FileSystemDirectoryEntry).createReader()
    const entries: FileSystemEntry[] = []
    await new Promise<void>((resolve) => {
      const readBatch = () => {
        reader.readEntries(
          (batch) => {
            if (batch.length === 0) {
              resolve()
            } else {
              entries.push(...batch)
              readBatch()
            }
          },
          () => resolve(),
        )
      }
      readBatch()
    })
    const nested = await Promise.all(entries.map((e) => readEntryFiles(e)))
    return nested.flat()
  }
  return []
}

/**
 * Extracts image files from a drag-and-drop DataTransfer (supporting both files and nested folders).
 */
export async function extractImagesFromDrop(dataTransfer: DataTransfer): Promise<File[]> {
  const items = Array.from(dataTransfer.items || [])
  const hasEntryApi = items.length > 0 && typeof items[0].webkitGetAsEntry === 'function'

  if (hasEntryApi) {
    const entries = items
      .map((item) => item.webkitGetAsEntry())
      .filter((e): e is FileSystemEntry => e !== null)
    if (entries.length > 0) {
      const files = (await Promise.all(entries.map((e) => readEntryFiles(e)))).flat()
      // Sort naturally so folder drops preserve photo order
      return files.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }))
    }
  }

  return Array.from(dataTransfer.files || []).filter(isImageFile)
}
