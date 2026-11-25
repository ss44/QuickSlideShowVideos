<script setup lang="ts">
import { ChevronDown, ExternalLink, Globe, Info } from 'lucide-vue-next'
import { ABOUT_LINKS } from '../config/aboutLinks'

const props = defineProps<{
  isOpen: boolean
}>()

const emit = defineEmits<{
  (e: 'toggle'): void
}>()
</script>

<template>
  <div>
    <button
      type="button"
      class="flex w-full items-center justify-between px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-zinc-300 hover:bg-zinc-900/50"
      :aria-expanded="props.isOpen"
      @click="emit('toggle')"
    >
      <span class="flex items-center gap-2">
        <Info class="h-3.5 w-3.5 text-indigo-400" />
        About
      </span>
      <ChevronDown
        class="h-3.5 w-3.5 text-zinc-500 transition-transform"
        :class="{ '-rotate-90': !props.isOpen }"
      />
    </button>

    <div v-if="props.isOpen" class="space-y-3 px-4 pb-5">
      <p class="text-[11px] leading-relaxed text-zinc-400">
        100% browser-based slideshow studio. Photos and audio are processed locally on your device.
      </p>

      <div class="space-y-1.5">
        <a
          v-for="link in ABOUT_LINKS"
          :key="link.id"
          :href="link.href"
          target="_blank"
          rel="noopener noreferrer"
          class="group flex items-center justify-between gap-2.5 rounded-lg border border-zinc-800 bg-zinc-900/60 px-2.5 py-2 transition hover:border-indigo-500/50 hover:bg-zinc-900"
        >
          <span class="flex min-w-0 items-center gap-2.5">
            <span
              class="flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-zinc-800 bg-zinc-950/80 text-zinc-300 transition group-hover:border-indigo-500/40 group-hover:text-indigo-300"
            >
              <!-- GitHub mark -->
              <svg
                v-if="link.icon === 'github'"
                viewBox="0 0 24 24"
                fill="currentColor"
                class="h-3.5 w-3.5"
                aria-hidden="true"
              >
                <path
                  d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.53 1.032 1.53 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0 1 12 6.844a9.59 9.59 0 0 1 2.504.337c1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.02 10.02 0 0 0 22 12.017C22 6.484 17.522 2 12 2Z"
                />
              </svg>

              <!-- Bluesky butterfly mark -->
              <svg
                v-else-if="link.icon === 'bluesky'"
                viewBox="0 0 24 24"
                fill="currentColor"
                class="h-3.5 w-3.5"
                aria-hidden="true"
              >
                <path
                  d="M5.202 2.857C7.954 4.922 10.913 9.11 12 11.358c1.087-2.247 4.046-6.436 6.798-8.501C20.783 1.366 24 .213 24 3.883c0 .732-.42 6.156-.667 7.037-.856 3.061-3.978 3.842-6.755 3.37 4.854.826 6.089 3.562 3.422 6.299-5.065 5.196-7.28-1.304-7.847-2.97-.104-.305-.152-.448-.153-.327 0-.121-.05.022-.153.327-.568 1.666-2.782 8.166-7.847 2.97-2.667-2.737-1.432-5.473 3.422-6.3-2.777.473-5.899-.308-6.755-3.369C.42 10.04 0 4.615 0 3.883c0-3.67 3.217-2.517 5.202-1.026Z"
                />
              </svg>

              <!-- Website / project reference icon -->
              <Globe v-else class="h-3.5 w-3.5" aria-hidden="true" />
            </span>

            <span class="min-w-0">
              <span class="flex items-center gap-1.5">
                <span class="truncate text-xs font-medium text-zinc-200 group-hover:text-zinc-100">
                  {{ link.label }}
                </span>
                <span
                  v-if="link.badge"
                  class="shrink-0 rounded bg-zinc-800 px-1.5 py-0.5 text-[10px] font-medium text-zinc-400"
                >
                  {{ link.badge }}
                </span>
              </span>
              <span class="block truncate text-[11px] text-zinc-500 group-hover:text-zinc-400">
                {{ link.sublabel }}
              </span>
            </span>
          </span>

          <ExternalLink
            class="h-3.5 w-3.5 shrink-0 text-zinc-500 transition group-hover:text-indigo-400"
            aria-hidden="true"
          />
        </a>
      </div>
    </div>
  </div>
</template>
