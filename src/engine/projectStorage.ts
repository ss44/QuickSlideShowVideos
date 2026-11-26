import type {
  ProjectSavePayload,
  ProjectSaveProgress,
  ProjectStorageRepository,
  RestoredProjectData,
  RestoredSlideEntry,
  SavedMusicRecord,
  SavedProjectRecord,
  SavedProjectSettings,
  SavedSlideRecord,
  StorageQuotaInfo,
} from '../types/project'
import { PROJECT_SCHEMA_VERSION } from '../types/project'
import type { SlideImage } from '../types/slideshow'

const DATABASE_NAME = 'QuickSlideShowProjectsDB'
const DATABASE_VERSION = 1
const PROJECTS_STORE_NAME = 'projects'
const ASSETS_STORE_NAME = 'assets'
const PROJECTS_UPDATED_AT_INDEX = 'by_updatedAt'
const ASSETS_PROJECT_ID_INDEX = 'by_projectId'

const LOCAL_STORAGE_INDEX_KEY = 'quick-slideshow:projects-index:v1'
const LOCAL_STORAGE_LAST_PROJECT_KEY = 'quick-slideshow:last-project-id:v1'

/**
 * Write media blobs in small transactions so saving 200-500 high-resolution photos
 * keeps IndexedDB responsive and lets the UI report incremental progress.
 */
const ASSET_WRITE_BATCH_SIZE = 12

interface StoredMediaAsset {
  key: string
  projectId: string
  kind: 'slide' | 'music'
  blob: Blob
  name: string
  mimeType: string
  lastModified: number
}

interface LocalStorageProjectIndexEntry {
  id: string
  name: string
  updatedAt: number
  slideCount: number
  totalDurationSeconds: number
  totalMediaBytes: number
}

function generateProjectId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `proj-${crypto.randomUUID()}`
  }
  return `proj-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`
}

function buildAssetKey(projectId: string, assetId: string): string {
  return `${projectId}::${assetId}`
}

function toFriendlyStorageError(err: unknown, fallbackMessage: string): Error {
  if (err instanceof DOMException) {
    if (err.name === 'QuotaExceededError') {
      return new Error(
        'Not enough local browser storage space for this project. Delete an older saved project or free up disk space and try again.',
      )
    }
    if (err.name === 'SecurityError' || err.name === 'InvalidStateError') {
      return new Error(
        'Local browser storage is unavailable in this browsing mode (for example, restricted private browsing).',
      )
    }
  }
  if (err instanceof Error) return err
  return new Error(fallbackMessage)
}

function requestToPromise<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error('IndexedDB request failed'))
  })
}

function transactionToPromise(transaction: IDBTransaction): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    transaction.oncomplete = () => resolve()
    transaction.onabort = () =>
      reject(transaction.error ?? new Error('Local storage transaction was aborted'))
    transaction.onerror = () =>
      reject(transaction.error ?? new Error('Local storage transaction failed'))
  })
}

/**
 * Converts reactive Vue objects into plain structured-cloneable records before writing to IndexedDB.
 * Passing Vue Proxy objects directly to `IDBObjectStore.put()` throws `DataCloneError`.
 */
function toPlainSavedSettings(settings: SavedProjectSettings): SavedProjectSettings {
  return {
    timing: {
      slideDuration: settings.timing.slideDuration,
      transitionDuration: settings.timing.transitionDuration,
      matchMusicLength: settings.timing.matchMusicLength,
    },
    selectedTransitions: [...settings.selectedTransitions],
    transitionOrder: settings.transitionOrder,
    effects: {
      kenBurns: settings.effects.kenBurns,
      kenBurnsIntensity: settings.effects.kenBurnsIntensity,
      fitMode: settings.effects.fitMode,
      beatSync: settings.effects.beatSync,
      colorLook: settings.effects.colorLook,
      vignette: settings.effects.vignette,
    },
    output: {
      format: settings.output.format,
      presetId: settings.output.presetId,
      width: settings.output.width,
      height: settings.output.height,
      fps: settings.output.fps,
      quality: settings.output.quality,
    },
    duplicateDetection: {
      enabled: settings.duplicateDetection.enabled,
      similarityThresholdPercent: settings.duplicateDetection.similarityThresholdPercent,
    },
  }
}

function toPlainSavedSlideRecord(slide: SlideImage): SavedSlideRecord {
  return {
    id: slide.id,
    name: slide.name,
    size: slide.size,
    mimeType: slide.file.type || 'image/jpeg',
    lastModified: slide.lastModified,
    width: slide.width,
    height: slide.height,
    rotation: slide.rotation,
    cropPosition: {
      offsetX: slide.cropPosition.offsetX,
      offsetY: slide.cropPosition.offsetY,
    },
    contentHash: slide.contentHash,
    perceptualFingerprint: slide.perceptualFingerprint
      ? {
          hashHigh: slide.perceptualFingerprint.hashHigh,
          hashLow: slide.perceptualFingerprint.hashLow,
          avgRed: slide.perceptualFingerprint.avgRed,
          avgGreen: slide.perceptualFingerprint.avgGreen,
          avgBlue: slide.perceptualFingerprint.avgBlue,
        }
      : null,
  }
}

function toPlainSavedMusicRecord(music: SavedMusicRecord): SavedMusicRecord {
  return {
    sourceType: music.sourceType,
    assetId: music.assetId,
    name: music.name,
    url: music.url,
    mimeType: music.mimeType,
    duration: music.duration,
    loop: music.loop,
    fadeIn: music.fadeIn,
    fadeOut: music.fadeOut,
    startOffset: music.startOffset,
    volume: music.volume,
    beatTimes: [...music.beatTimes],
  }
}

async function extractCoverThumbnailBlob(
  firstSlide: SlideImage | undefined,
  existingRecord: SavedProjectRecord | null,
): Promise<Blob | null> {
  if (!firstSlide) return null

  if (firstSlide.thumbnailUrl) {
    try {
      const response = await fetch(firstSlide.thumbnailUrl)
      if (response.ok) {
        return await response.blob()
      }
    } catch {
      // Ignore transient blob URL fetch failures and fall back below
    }
  }

  // Reuse existing saved cover if the leading slide has not changed and its thumbnail is still loading
  if (existingRecord && existingRecord.slides[0]?.id === firstSlide.id) {
    return existingRecord.coverThumbnailBlob
  }

  return null
}

function syncLocalStorageIndexMirror(records: SavedProjectRecord[]) {
  if (typeof window === 'undefined' || !window.localStorage) return
  try {
    const indexEntries: LocalStorageProjectIndexEntry[] = records.map((record) => ({
      id: record.id,
      name: record.name,
      updatedAt: record.updatedAt,
      slideCount: record.slideCount,
      totalDurationSeconds: record.totalDurationSeconds,
      totalMediaBytes: record.totalMediaBytes,
    }))
    window.localStorage.setItem(LOCAL_STORAGE_INDEX_KEY, JSON.stringify(indexEntries))
  } catch {
    // Non-fatal: IndexedDB remains authoritative even if localStorage is restricted
  }
}

export class BrowserProjectStorageRepository implements ProjectStorageRepository {
  private databasePromise: Promise<IDBDatabase> | null = null

  isSupported(): boolean {
    return typeof indexedDB !== 'undefined'
  }

  private openDatabase(): Promise<IDBDatabase> {
    if (!this.isSupported()) {
      return Promise.reject(
        new Error('Local project storage (IndexedDB) is not supported in this browser.'),
      )
    }

    if (!this.databasePromise) {
      this.databasePromise = new Promise<IDBDatabase>((resolve, reject) => {
        const openRequest = indexedDB.open(DATABASE_NAME, DATABASE_VERSION)

        openRequest.onupgradeneeded = () => {
          const database = openRequest.result

          if (!database.objectStoreNames.contains(PROJECTS_STORE_NAME)) {
            const projectsStore = database.createObjectStore(PROJECTS_STORE_NAME, {
              keyPath: 'id',
            })
            projectsStore.createIndex(PROJECTS_UPDATED_AT_INDEX, 'updatedAt', { unique: false })
          }

          if (!database.objectStoreNames.contains(ASSETS_STORE_NAME)) {
            const assetsStore = database.createObjectStore(ASSETS_STORE_NAME, { keyPath: 'key' })
            assetsStore.createIndex(ASSETS_PROJECT_ID_INDEX, 'projectId', { unique: false })
          }
        }

        openRequest.onsuccess = () => {
          const database = openRequest.result
          database.onversionchange = () => {
            database.close()
            this.databasePromise = null
          }
          resolve(database)
        }

        openRequest.onerror = () => {
          this.databasePromise = null
          reject(
            toFriendlyStorageError(
              openRequest.error,
              'Could not open local browser storage for projects.',
            ),
          )
        }
      })
    }

    return this.databasePromise
  }

  async listProjectRecords(): Promise<SavedProjectRecord[]> {
    const database = await this.openDatabase()
    const transaction = database.transaction(PROJECTS_STORE_NAME, 'readonly')
    const store = transaction.objectStore(PROJECTS_STORE_NAME)
    const records = await requestToPromise<SavedProjectRecord[]>(store.getAll())
    records.sort((first, second) => second.updatedAt - first.updatedAt)
    syncLocalStorageIndexMirror(records)
    return records
  }

  async saveProject(
    payload: ProjectSavePayload,
    onProgress?: (progress: ProjectSaveProgress) => void,
  ): Promise<SavedProjectRecord> {
    const database = await this.openDatabase()
    const trimmedName = payload.name.trim() || 'Untitled Slideshow'

    const existingRecord = payload.projectId
      ? await this.readProjectRecord(database, payload.projectId)
      : null
    const isNewProject = !existingRecord
    const projectId = existingRecord ? existingRecord.id : generateProjectId()
    const savedAtMs = Date.now()

    const desiredAssets = this.buildDesiredAssets(projectId, payload)
    const existingAssetKeys = existingRecord
      ? await this.listAssetKeysForProject(database, projectId)
      : new Set<string>()

    const desiredKeySet = new Set(desiredAssets.map((asset) => asset.key))
    const assetsToWrite = desiredAssets.filter((asset) => !existingAssetKeys.has(asset.key))
    const orphanedAssetKeys = Array.from(existingAssetKeys).filter((key) => !desiredKeySet.has(key))

    onProgress?.({
      completedAssets: 0,
      totalAssets: assetsToWrite.length,
      message:
        assetsToWrite.length > 0
          ? `Saving ${assetsToWrite.length} media ${assetsToWrite.length === 1 ? 'file' : 'files'}…`
          : 'Updating project settings…',
    })

    try {
      await this.writeAssetsInBatches(database, assetsToWrite, onProgress)

      const coverThumbnailBlob = await extractCoverThumbnailBlob(payload.slides[0], existingRecord)
      const totalSlidesBytes = payload.slides.reduce((sum, slide) => sum + slide.size, 0)
      const musicBytes =
        payload.music.sourceType !== 'none' && payload.musicSourceBlob
          ? payload.musicSourceBlob.size
          : 0

      const projectRecord: SavedProjectRecord = {
        schemaVersion: PROJECT_SCHEMA_VERSION,
        id: projectId,
        name: trimmedName,
        createdAt: existingRecord ? existingRecord.createdAt : savedAtMs,
        updatedAt: savedAtMs,
        slideCount: payload.slides.length,
        totalDurationSeconds: payload.totalDurationSeconds,
        totalMediaBytes: totalSlidesBytes + musicBytes,
        hasMusic: payload.music.sourceType !== 'none',
        musicName: payload.music.sourceType !== 'none' ? payload.music.name : '',
        coverThumbnailBlob,
        settings: toPlainSavedSettings(payload.settings),
        slides: payload.slides.map(toPlainSavedSlideRecord),
        music: toPlainSavedMusicRecord(payload.music),
      }

      const manifestTransaction = database.transaction(PROJECTS_STORE_NAME, 'readwrite')
      manifestTransaction.objectStore(PROJECTS_STORE_NAME).put(projectRecord)
      await transactionToPromise(manifestTransaction)

      if (orphanedAssetKeys.length > 0) {
        await this.deleteAssetKeys(database, orphanedAssetKeys)
      }

      this.setLastOpenedProjectId(projectId)
      const allRecords = await this.listProjectRecords()
      syncLocalStorageIndexMirror(allRecords)

      return projectRecord
    } catch (err) {
      // Roll back partially written blobs if creating a brand-new project fails (e.g. QuotaExceededError)
      if (isNewProject) {
        await this.cleanupAssetsBestEffort(database, projectId)
      }
      throw toFriendlyStorageError(err, 'Failed to save project to local browser storage.')
    }
  }

  async loadProject(projectId: string): Promise<RestoredProjectData> {
    const database = await this.openDatabase()
    const projectRecord = await this.readProjectRecord(database, projectId)
    if (!projectRecord) {
      throw new Error('This saved project could not be found in local storage.')
    }

    const assetTransaction = database.transaction(ASSETS_STORE_NAME, 'readonly')
    const assetsByProjectIndex = assetTransaction
      .objectStore(ASSETS_STORE_NAME)
      .index(ASSETS_PROJECT_ID_INDEX)
    const storedAssets = await requestToPromise<StoredMediaAsset[]>(
      assetsByProjectIndex.getAll(projectId),
    )

    const assetsByKey = new Map<string, StoredMediaAsset>()
    for (const asset of storedAssets) {
      assetsByKey.set(asset.key, asset)
    }

    const restoredSlides: RestoredSlideEntry[] = []
    for (const slideRecord of projectRecord.slides) {
      const asset = assetsByKey.get(buildAssetKey(projectId, slideRecord.id))
      if (!asset) continue

      const reconstructedFile = new File([asset.blob], slideRecord.name, {
        type: slideRecord.mimeType || asset.mimeType || 'image/jpeg',
        lastModified: slideRecord.lastModified || asset.lastModified,
      })

      restoredSlides.push({
        record: slideRecord,
        file: reconstructedFile,
      })
    }

    if (projectRecord.slides.length > 0 && restoredSlides.length === 0) {
      throw new Error(
        'Saved photo files for this project were cleared by the browser and could not be restored.',
      )
    }

    let restoredMusicBlob: Blob | null = null
    if (projectRecord.music.sourceType !== 'none' && projectRecord.music.assetId) {
      const musicAsset = assetsByKey.get(buildAssetKey(projectId, projectRecord.music.assetId))
      if (musicAsset) {
        restoredMusicBlob = musicAsset.blob
      }
    }

    this.setLastOpenedProjectId(projectRecord.id)

    return {
      id: projectRecord.id,
      name: projectRecord.name,
      settings: projectRecord.settings,
      slides: restoredSlides,
      music: {
        record: projectRecord.music,
        sourceBlob: restoredMusicBlob,
      },
    }
  }

  async renameProject(projectId: string, newName: string): Promise<SavedProjectRecord> {
    const trimmedName = newName.trim()
    if (!trimmedName) {
      throw new Error('Project name cannot be empty.')
    }

    const database = await this.openDatabase()
    const existingRecord = await this.readProjectRecord(database, projectId)
    if (!existingRecord) {
      throw new Error('Project not found.')
    }

    const updatedRecord: SavedProjectRecord = {
      ...existingRecord,
      name: trimmedName,
      updatedAt: Date.now(),
    }

    const transaction = database.transaction(PROJECTS_STORE_NAME, 'readwrite')
    transaction.objectStore(PROJECTS_STORE_NAME).put(updatedRecord)
    await transactionToPromise(transaction)

    const allRecords = await this.listProjectRecords()
    syncLocalStorageIndexMirror(allRecords)
    return updatedRecord
  }

  async deleteProject(projectId: string): Promise<void> {
    const database = await this.openDatabase()
    const assetKeysToDelete = await this.listAssetKeysForProject(database, projectId)

    const transaction = database.transaction(
      [PROJECTS_STORE_NAME, ASSETS_STORE_NAME],
      'readwrite',
    )
    transaction.objectStore(PROJECTS_STORE_NAME).delete(projectId)
    const assetsStore = transaction.objectStore(ASSETS_STORE_NAME)
    for (const assetKey of assetKeysToDelete) {
      assetsStore.delete(assetKey)
    }
    await transactionToPromise(transaction)

    if (this.getLastOpenedProjectId() === projectId) {
      this.setLastOpenedProjectId(null)
    }

    const remainingRecords = await this.listProjectRecords()
    syncLocalStorageIndexMirror(remainingRecords)
  }

  async getStorageEstimate(records?: SavedProjectRecord[]): Promise<StorageQuotaInfo> {
    const projectRecords = records ?? (await this.listProjectRecords())
    const projectsTotalBytes = projectRecords.reduce(
      (sum, record) => sum + (record.totalMediaBytes || 0),
      0,
    )

    let browserUsedBytes: number | null = null
    let browserQuotaBytes: number | null = null

    if (typeof navigator !== 'undefined' && navigator.storage?.estimate) {
      try {
        const estimate = await navigator.storage.estimate()
        if (typeof estimate.usage === 'number') browserUsedBytes = estimate.usage
        if (typeof estimate.quota === 'number') browserQuotaBytes = estimate.quota
      } catch {
        // Ignore storage estimate unavailability in restricted browsers
      }
    }

    return {
      projectsTotalBytes,
      browserUsedBytes,
      browserQuotaBytes,
    }
  }

  getLastOpenedProjectId(): string | null {
    if (typeof window === 'undefined' || !window.localStorage) return null
    try {
      return window.localStorage.getItem(LOCAL_STORAGE_LAST_PROJECT_KEY)
    } catch {
      return null
    }
  }

  setLastOpenedProjectId(projectId: string | null): void {
    if (typeof window === 'undefined' || !window.localStorage) return
    try {
      if (projectId) {
        window.localStorage.setItem(LOCAL_STORAGE_LAST_PROJECT_KEY, projectId)
      } else {
        window.localStorage.removeItem(LOCAL_STORAGE_LAST_PROJECT_KEY)
      }
    } catch {
      // Non-fatal in restricted storage environments
    }
  }

  private async readProjectRecord(
    database: IDBDatabase,
    projectId: string,
  ): Promise<SavedProjectRecord | null> {
    const transaction = database.transaction(PROJECTS_STORE_NAME, 'readonly')
    const record = await requestToPromise<SavedProjectRecord | undefined>(
      transaction.objectStore(PROJECTS_STORE_NAME).get(projectId),
    )
    return record ?? null
  }

  private async listAssetKeysForProject(
    database: IDBDatabase,
    projectId: string,
  ): Promise<Set<string>> {
    const transaction = database.transaction(ASSETS_STORE_NAME, 'readonly')
    const index = transaction.objectStore(ASSETS_STORE_NAME).index(ASSETS_PROJECT_ID_INDEX)
    const keys = await requestToPromise<IDBValidKey[]>(index.getAllKeys(projectId))
    return new Set(keys.map((key) => String(key)))
  }

  private buildDesiredAssets(projectId: string, payload: ProjectSavePayload): StoredMediaAsset[] {
    const assets: StoredMediaAsset[] = payload.slides.map((slide) => ({
      key: buildAssetKey(projectId, slide.id),
      projectId,
      kind: 'slide',
      blob: slide.file,
      name: slide.name,
      mimeType: slide.file.type || 'image/jpeg',
      lastModified: slide.lastModified,
    }))

    if (payload.music.sourceType !== 'none' && payload.music.assetId && payload.musicSourceBlob) {
      assets.push({
        key: buildAssetKey(projectId, payload.music.assetId),
        projectId,
        kind: 'music',
        blob: payload.musicSourceBlob,
        name: payload.music.name,
        mimeType: payload.music.mimeType || payload.musicSourceBlob.type || 'audio/mpeg',
        lastModified: Date.now(),
      })
    }

    return assets
  }

  private async writeAssetsInBatches(
    database: IDBDatabase,
    assetsToWrite: StoredMediaAsset[],
    onProgress?: (progress: ProjectSaveProgress) => void,
  ): Promise<void> {
    if (assetsToWrite.length === 0) return

    let completedCount = 0
    for (
      let batchStart = 0;
      batchStart < assetsToWrite.length;
      batchStart += ASSET_WRITE_BATCH_SIZE
    ) {
      const batch = assetsToWrite.slice(batchStart, batchStart + ASSET_WRITE_BATCH_SIZE)
      const transaction = database.transaction(ASSETS_STORE_NAME, 'readwrite')
      const store = transaction.objectStore(ASSETS_STORE_NAME)
      for (const asset of batch) {
        store.put(asset)
      }
      await transactionToPromise(transaction)

      completedCount += batch.length
      onProgress?.({
        completedAssets: completedCount,
        totalAssets: assetsToWrite.length,
        message: `Saved ${completedCount} of ${assetsToWrite.length} media files…`,
      })
    }
  }

  private async deleteAssetKeys(database: IDBDatabase, keys: string[]): Promise<void> {
    if (keys.length === 0) return
    const transaction = database.transaction(ASSETS_STORE_NAME, 'readwrite')
    const store = transaction.objectStore(ASSETS_STORE_NAME)
    for (const key of keys) {
      store.delete(key)
    }
    await transactionToPromise(transaction)
  }

  private async cleanupAssetsBestEffort(database: IDBDatabase, projectId: string): Promise<void> {
    try {
      const orphanedKeys = await this.listAssetKeysForProject(database, projectId)
      await this.deleteAssetKeys(database, Array.from(orphanedKeys))
    } catch {
      // Best-effort rollback only
    }
  }
}

export const projectStorageRepository: ProjectStorageRepository =
  new BrowserProjectStorageRepository()
