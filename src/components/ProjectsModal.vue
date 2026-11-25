<script setup lang="ts">
import { nextTick, ref, watch } from 'vue'
import {
  AlertCircle,
  Check,
  Clock,
  CopyPlus,
  FolderOpen,
  HardDrive,
  Images,
  Loader2,
  Music,
  Pencil,
  Save,
  Trash2,
  X,
} from 'lucide-vue-next'
import type {
  ProjectSaveProgress,
  SavedProjectSummary,
  StorageQuotaInfo,
} from '../types/project'
import {
  formatBytesReadable,
  formatRelativeTimestamp,
  formatTime,
} from '../utils/formatters'

const props = defineProps<{
  open: boolean
  isStorageSupported: boolean
  savedProjects: SavedProjectSummary[]
  activeProjectId: string | null
  activeProjectName: string
  suggestedProjectName: string
  hasUnsavedChanges: boolean
  slideCount: number
  totalDuration: number
  isLoadingList: boolean
  isSaving: boolean
  isOpeningProjectId: string | null
  saveProgress: ProjectSaveProgress | null
  storageError: string | null
  justSavedFeedback: boolean
  storageQuota: StorageQuotaInfo
}>()

const emit = defineEmits<{
  (e: 'close'): void
  (e: 'save', payload: { name: string; saveAsNew: boolean }): void
  (e: 'openProject', projectId: string): void
  (e: 'renameProject', payload: { projectId: string; name: string }): void
  (e: 'deleteProject', projectId: string): void
}>()

const projectNameInput = ref('')
const nameInputRef = ref<HTMLInputElement | null>(null)
const pendingDeleteProjectId = ref<string | null>(null)
const pendingOpenConfirmProjectId = ref<string | null>(null)
const editingProjectId = ref<string | null>(null)
const editingProjectName = ref('')

watch(
  () => props.open,
  async (isOpen) => {
    if (!isOpen) {
      pendingDeleteProjectId.value = null
      pendingOpenConfirmProjectId.value = null
      editingProjectId.value = null
      return
    }
    projectNameInput.value = props.suggestedProjectName
    await nextTick()
    if (props.slideCount > 0 && !props.activeProjectId) {
      nameInputRef.value?.focus()
      nameInputRef.value?.select()
    }
  },
)

watch(
  () => props.activeProjectName,
  (updatedName) => {
    if (props.open && updatedName) {
      projectNameInput.value = updatedName
    }
  },
)

function submitSave(saveAsNew: boolean) {
  if (props.isSaving || props.slideCount === 0) return
  const normalizedName = projectNameInput.value.trim() || props.suggestedProjectName
  projectNameInput.value = normalizedName
  emit('save', { name: normalizedName, saveAsNew })
}

function requestOpenProject(project: SavedProjectSummary) {
  if (props.isOpeningProjectId !== null || props.isSaving) return
  pendingDeleteProjectId.value = null

  const needsUnsavedConfirmation =
    props.slideCount > 0 &&
    props.hasUnsavedChanges &&
    pendingOpenConfirmProjectId.value !== project.id

  if (needsUnsavedConfirmation) {
    pendingOpenConfirmProjectId.value = project.id
    return
  }

  pendingOpenConfirmProjectId.value = null
  emit('openProject', project.id)
}

function startInlineRename(project: SavedProjectSummary) {
  pendingDeleteProjectId.value = null
  pendingOpenConfirmProjectId.value = null
  editingProjectId.value = project.id
  editingProjectName.value = project.name
}

function confirmInlineRename(projectId: string) {
  const trimmed = editingProjectName.value.trim()
  if (!trimmed) return
  emit('renameProject', { projectId, name: trimmed })
  editingProjectId.value = null
}

function cancelInlineRename() {
  editingProjectId.value = null
  editingProjectName.value = ''
}

function requestDeleteProject(projectId: string) {
  pendingOpenConfirmProjectId.value = null
  editingProjectId.value = null
  pendingDeleteProjectId.value = projectId
}

function confirmDeleteProject(projectId: string) {
  pendingDeleteProjectId.value = null
  emit('deleteProject', projectId)
}

function onBackdropClick(event: MouseEvent) {
  if (event.target === event.currentTarget) {
    emit('close')
  }
}
</script>

<template>
  <Teleport to="body">
    <div
      v-if="props.open"
      class="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-label="Local Saved Projects"
      @click="onBackdropClick"
    >
      <div
        class="flex max-h-[88vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-zinc-800 bg-zinc-950 shadow-2xl"
      >
        <!-- Header -->
        <div class="flex items-start justify-between border-b border-zinc-800/80 px-6 py-4">
          <div>
            <h3 class="flex items-center gap-2 text-base font-semibold text-zinc-100">
              <FolderOpen class="h-4.5 w-4.5 text-indigo-400" />
              Local Projects
            </h3>
            <p class="mt-0.5 text-xs text-zinc-400">
              Save your slideshow photos, music, and settings directly in this browser to reopen anytime.
            </p>
          </div>
          <button
            type="button"
            :disabled="props.isSaving || props.isOpeningProjectId !== null"
            class="rounded-lg p-1 text-zinc-400 transition hover:bg-zinc-800 hover:text-zinc-200 disabled:opacity-40"
            aria-label="Close projects dialog"
            @click="emit('close')"
          >
            <X class="h-4 w-4" />
          </button>
        </div>

        <!-- Storage Unsupported Notice -->
        <div
          v-if="!props.isStorageSupported"
          class="m-6 flex items-start gap-2.5 rounded-xl border border-amber-500/30 bg-amber-500/10 p-4 text-xs text-amber-200"
        >
          <AlertCircle class="mt-0.5 h-4 w-4 shrink-0 text-amber-400" />
          <p class="leading-relaxed">
            Local browser storage (IndexedDB) is disabled or unavailable in this browser window.
            Switch out of restricted private browsing to save projects locally.
          </p>
        </div>

        <template v-else>
          <!-- Save Current Project Section -->
          <div class="border-b border-zinc-800/80 bg-zinc-900/35 px-6 py-4">
            <div class="mb-2 flex items-center justify-between">
              <span class="text-xs font-semibold uppercase tracking-wider text-zinc-300">
                Save Current Workspace
              </span>
              <span v-if="props.slideCount > 0" class="text-[11px] text-zinc-400">
                {{ props.slideCount }} {{ props.slideCount === 1 ? 'photo' : 'photos' }} ·
                {{ formatTime(props.totalDuration) }}
              </span>
            </div>

            <div
              v-if="props.slideCount === 0"
              class="rounded-lg border border-dashed border-zinc-800 bg-zinc-950/60 px-3.5 py-3 text-xs text-zinc-500"
            >
              Add photos to your slideshow to save a new project, or open a saved project below.
            </div>

            <form
              v-else
              class="flex flex-col gap-2.5 sm:flex-row sm:items-center"
              @submit.prevent="submitSave(false)"
            >
              <input
                ref="nameInputRef"
                v-model="projectNameInput"
                type="text"
                maxlength="80"
                :disabled="props.isSaving"
                placeholder="Project name (e.g. Summer Vacation)"
                class="min-w-0 flex-1 rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-2 text-xs text-zinc-100 placeholder-zinc-500 focus:border-indigo-500 focus:outline-none disabled:opacity-60"
              />

              <div class="flex shrink-0 items-center gap-2">
                <button
                  type="submit"
                  :disabled="props.isSaving || props.isOpeningProjectId !== null"
                  class="inline-flex items-center justify-center gap-1.5 rounded-lg bg-indigo-600 px-3.5 py-2 text-xs font-semibold text-white shadow-sm shadow-indigo-600/25 transition hover:bg-indigo-500 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <Loader2 v-if="props.isSaving" class="h-3.5 w-3.5 animate-spin" />
                  <Save v-else class="h-3.5 w-3.5" />
                  <span>{{ props.activeProjectId ? 'Update Project' : 'Save Project' }}</span>
                </button>

                <button
                  v-if="props.activeProjectId"
                  type="button"
                  :disabled="props.isSaving || props.isOpeningProjectId !== null"
                  title="Save a separate copy as a new project"
                  class="inline-flex items-center justify-center gap-1.5 rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-xs font-medium text-zinc-200 transition hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-50"
                  @click="submitSave(true)"
                >
                  <CopyPlus class="h-3.5 w-3.5 text-zinc-400" />
                  <span>Save as New</span>
                </button>
              </div>
            </form>

            <!-- Save Progress -->
            <div
              v-if="props.isSaving && props.saveProgress"
              class="mt-2.5 flex items-center gap-2 text-[11px] text-indigo-300"
            >
              <Loader2 class="h-3.5 w-3.5 animate-spin" />
              <span>{{ props.saveProgress.message }}</span>
            </div>

            <!-- Save Success Feedback -->
            <div
              v-else-if="props.justSavedFeedback && !props.storageError"
              class="mt-2.5 flex items-center gap-1.5 text-[11px] text-emerald-300"
            >
              <Check class="h-3.5 w-3.5 text-emerald-400" />
              <span>Project saved locally in this browser.</span>
            </div>

            <!-- Storage Error Banner -->
            <div
              v-if="props.storageError"
              class="mt-3 flex items-start gap-2 rounded-lg border border-red-500/30 bg-red-500/10 p-2.5 text-xs text-red-200"
            >
              <AlertCircle class="mt-0.5 h-3.5 w-3.5 shrink-0 text-red-400" />
              <p class="leading-relaxed">{{ props.storageError }}</p>
            </div>
          </div>

          <!-- Saved Projects List -->
          <div class="min-h-0 flex-1 overflow-y-auto px-6 py-4">
            <div class="mb-3 flex items-center justify-between">
              <span class="text-xs font-semibold uppercase tracking-wider text-zinc-400">
                Saved in This Browser
                <span
                  v-if="props.savedProjects.length > 0"
                  class="ml-1.5 rounded-full bg-zinc-800 px-2 py-0.5 font-mono text-[10px] text-zinc-300"
                >
                  {{ props.savedProjects.length }}
                </span>
              </span>
            </div>

            <div
              v-if="props.isLoadingList && props.savedProjects.length === 0"
              class="flex items-center justify-center gap-2 py-12 text-xs text-zinc-400"
            >
              <Loader2 class="h-4 w-4 animate-spin text-indigo-400" />
              Loading saved projects…
            </div>

            <div
              v-else-if="props.savedProjects.length === 0"
              class="flex flex-col items-center justify-center rounded-xl border border-dashed border-zinc-800/90 bg-zinc-900/20 px-6 py-10 text-center"
            >
              <FolderOpen class="mb-2.5 h-7 w-7 text-zinc-600" />
              <p class="text-xs font-medium text-zinc-300">No saved projects yet</p>
              <p class="mt-1 max-w-xs text-[11px] text-zinc-500">
                Save your current slideshow above to keep your photo order, transitions, effects,
                and music ready to reopen later.
              </p>
            </div>

            <div v-else class="space-y-2.5">
              <div
                v-for="project in props.savedProjects"
                :key="project.id"
                class="rounded-xl border p-3 transition"
                :class="
                  project.id === props.activeProjectId
                    ? 'border-indigo-500/50 bg-indigo-500/8'
                    : 'border-zinc-800/90 bg-zinc-900/45 hover:border-zinc-700'
                "
              >
                <div class="flex items-center gap-3.5">
                  <!-- Cover Thumbnail -->
                  <div
                    class="flex h-14 w-20 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-zinc-800 bg-zinc-950"
                  >
                    <img
                      v-if="project.coverThumbnailUrl"
                      :src="project.coverThumbnailUrl"
                      :alt="project.name"
                      class="h-full w-full object-cover"
                    />
                    <Images v-else class="h-5 w-5 text-zinc-600" />
                  </div>

                  <!-- Project Info -->
                  <div class="min-w-0 flex-1">
                    <!-- Inline Rename Mode -->
                    <form
                      v-if="editingProjectId === project.id"
                      class="flex items-center gap-1.5"
                      @submit.prevent="confirmInlineRename(project.id)"
                    >
                      <input
                        v-model="editingProjectName"
                        type="text"
                        maxlength="80"
                        class="min-w-0 flex-1 rounded-md border border-indigo-500 bg-zinc-950 px-2 py-1 text-xs text-zinc-100 focus:outline-none"
                        @keydown.esc.stop="cancelInlineRename"
                      />
                      <button
                        type="submit"
                        class="rounded-md bg-indigo-600 p-1 text-white hover:bg-indigo-500"
                        title="Save name"
                      >
                        <Check class="h-3.5 w-3.5" />
                      </button>
                      <button
                        type="button"
                        class="rounded-md border border-zinc-700 bg-zinc-900 p-1 text-zinc-400 hover:text-zinc-200"
                        title="Cancel rename"
                        @click="cancelInlineRename"
                      >
                        <X class="h-3.5 w-3.5" />
                      </button>
                    </form>

                    <!-- Normal Title Row -->
                    <div v-else class="flex items-center gap-2">
                      <span class="truncate text-sm font-semibold text-zinc-100">
                        {{ project.name }}
                      </span>
                      <span
                        v-if="project.id === props.activeProjectId"
                        class="shrink-0 rounded-full bg-indigo-500/20 px-2 py-0.5 text-[10px] font-medium text-indigo-300"
                      >
                        Open
                      </span>
                    </div>

                    <div
                      class="mt-1 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[11px] text-zinc-400"
                    >
                      <span class="inline-flex items-center gap-1">
                        <Images class="h-3 w-3 text-zinc-500" />
                        {{ project.slideCount }} {{ project.slideCount === 1 ? 'photo' : 'photos' }}
                      </span>
                      <span class="inline-flex items-center gap-1 font-mono">
                        <Clock class="h-3 w-3 text-zinc-500" />
                        {{ formatTime(project.totalDurationSeconds) }}
                      </span>
                      <span class="font-mono text-zinc-500">
                        {{ formatBytesReadable(project.totalMediaBytes) }}
                      </span>
                      <span class="text-zinc-500">
                        · {{ formatRelativeTimestamp(project.updatedAt) }}
                      </span>
                    </div>

                    <div
                      v-if="project.hasMusic && project.musicName"
                      class="mt-1 flex items-center gap-1 text-[11px] text-indigo-300/80"
                    >
                      <Music class="h-3 w-3 shrink-0" />
                      <span class="truncate">{{ project.musicName }}</span>
                    </div>
                  </div>

                  <!-- Row Actions -->
                  <div class="flex shrink-0 items-center gap-1.5">
                    <button
                      type="button"
                      :disabled="props.isSaving || props.isOpeningProjectId !== null"
                      class="inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium transition disabled:cursor-not-allowed disabled:opacity-50"
                      :class="
                        pendingOpenConfirmProjectId === project.id
                          ? 'border-amber-500/60 bg-amber-500/20 text-amber-200 hover:bg-amber-500/30'
                          : 'border-zinc-700 bg-zinc-800 text-zinc-100 hover:border-indigo-500/60 hover:bg-indigo-600 hover:text-white'
                      "
                      @click="requestOpenProject(project)"
                    >
                      <Loader2
                        v-if="props.isOpeningProjectId === project.id"
                        class="h-3.5 w-3.5 animate-spin"
                      />
                      <span>
                        {{
                          props.isOpeningProjectId === project.id
                            ? 'Opening…'
                            : pendingOpenConfirmProjectId === project.id
                              ? 'Confirm Open'
                              : 'Open'
                        }}
                      </span>
                    </button>

                    <button
                      type="button"
                      :disabled="props.isSaving || props.isOpeningProjectId !== null"
                      class="rounded-lg border border-zinc-800 bg-zinc-900 p-1.5 text-zinc-400 transition hover:bg-zinc-800 hover:text-zinc-200 disabled:opacity-40"
                      title="Rename project"
                      @click="startInlineRename(project)"
                    >
                      <Pencil class="h-3.5 w-3.5" />
                    </button>

                    <button
                      type="button"
                      :disabled="props.isSaving || props.isOpeningProjectId !== null"
                      class="rounded-lg border border-zinc-800 bg-zinc-900 p-1.5 text-zinc-400 transition hover:border-red-500/40 hover:bg-red-950/60 hover:text-red-400 disabled:opacity-40"
                      title="Delete saved project"
                      @click="requestDeleteProject(project.id)"
                    >
                      <Trash2 class="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>

                <!-- Unsaved Changes Open Confirmation Strip -->
                <div
                  v-if="pendingOpenConfirmProjectId === project.id"
                  class="mt-2.5 flex items-center justify-between gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-[11px] text-amber-200"
                >
                  <span>Current slideshow has unsaved changes. Click "Confirm Open" to replace it.</span>
                  <button
                    type="button"
                    class="shrink-0 font-medium text-zinc-300 hover:text-white"
                    @click="pendingOpenConfirmProjectId = null"
                  >
                    Cancel
                  </button>
                </div>

                <!-- Delete Confirmation Strip -->
                <div
                  v-if="pendingDeleteProjectId === project.id"
                  class="mt-2.5 flex items-center justify-between gap-2 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-[11px] text-red-200"
                >
                  <span>Delete "{{ project.name }}" from local browser storage?</span>
                  <div class="flex shrink-0 items-center gap-2">
                    <button
                      type="button"
                      class="font-medium text-zinc-300 hover:text-white"
                      @click="pendingDeleteProjectId = null"
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      class="rounded-md bg-red-600 px-2.5 py-1 font-semibold text-white hover:bg-red-500"
                      @click="confirmDeleteProject(project.id)"
                    >
                      Delete
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <!-- Footer Storage Status -->
          <div
            class="flex flex-wrap items-center justify-between gap-2 border-t border-zinc-800/80 bg-zinc-900/35 px-6 py-3 text-[11px] text-zinc-500"
          >
            <div class="flex items-center gap-1.5">
              <HardDrive class="h-3.5 w-3.5 text-zinc-400" />
              <span>
                Projects stored:
                <strong class="font-mono font-medium text-zinc-300">
                  {{ formatBytesReadable(props.storageQuota.projectsTotalBytes) }}
                </strong>
              </span>
              <span
                v-if="
                  props.storageQuota.browserUsedBytes !== null &&
                  props.storageQuota.browserQuotaBytes !== null
                "
                class="hidden sm:inline"
              >
                · Browser quota:
                {{ formatBytesReadable(props.storageQuota.browserUsedBytes) }} /
                {{ formatBytesReadable(props.storageQuota.browserQuotaBytes) }}
              </span>
            </div>
            <span>100% local in this browser · Zero uploads</span>
          </div>
        </template>
      </div>
    </div>
  </Teleport>
</template>
