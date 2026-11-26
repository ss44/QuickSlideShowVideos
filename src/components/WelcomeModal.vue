<script setup lang="ts">
import { nextTick, onMounted, ref, watch, type Component } from 'vue'
import { ArrowRight, Check, EyeOff, ShieldCheck, Sparkles, Zap } from 'lucide-vue-next'
import BrandMark from './BrandMark.vue'
import {
  WELCOME_FEATURE_HIGHLIGHTS,
  WELCOME_TRUST_PILLS,
  type WelcomeFeatureIcon,
} from '../config/welcomeFeatures'

const props = defineProps<{
  open: boolean
}>()

const emit = defineEmits<{
  (e: 'getStarted'): void
}>()

const WELCOME_FEATURE_ICONS: Record<WelcomeFeatureIcon, Component> = {
  shield: ShieldCheck,
  'eye-off': EyeOff,
  zap: Zap,
  sparkles: Sparkles,
}

const getStartedButtonRef = ref<HTMLButtonElement | null>(null)

async function focusPrimaryAction() {
  await nextTick()
  getStartedButtonRef.value?.focus()
}

onMounted(() => {
  if (props.open) {
    void focusPrimaryAction()
  }
})

watch(
  () => props.open,
  (isOpen) => {
    if (isOpen) {
      void focusPrimaryAction()
    }
  },
)
</script>

<template>
  <Teleport to="body">
    <Transition appear name="welcome-modal">
      <div
        v-if="props.open"
        class="welcome-modal-backdrop fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-3 backdrop-blur-sm sm:p-4"
        role="dialog"
        aria-modal="true"
        aria-labelledby="welcome-modal-title"
        aria-describedby="welcome-modal-subtitle"
      >
        <div
          class="welcome-modal-card relative flex max-h-[92dvh] w-full max-w-xl flex-col overflow-hidden rounded-2xl border border-zinc-800 bg-zinc-950 shadow-2xl shadow-black/80"
        >
          <!-- Subtle sunset brand accent bar -->
          <div
            class="h-1 w-full shrink-0 bg-gradient-to-r from-orange-500 via-pink-500 to-indigo-500"
            aria-hidden="true"
          />

          <!-- Scrollable Card Body -->
          <div class="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 pt-5 pb-4 sm:px-7 sm:pt-7 sm:pb-6">
            <!-- Header -->
            <div class="flex flex-col items-center text-center">
              <div class="mb-3.5 flex items-center justify-center">
                <BrandMark class="h-12 w-12 rounded-2xl shadow-lg shadow-pink-500/20 sm:h-13 sm:w-13" />
              </div>

              <span
                class="inline-flex items-center rounded-full border border-indigo-500/30 bg-indigo-500/10 px-2.5 py-0.5 text-[11px] font-medium text-indigo-300"
              >
                Welcome to Quick Slide Show
              </span>

              <h2
                id="welcome-modal-title"
                class="mt-2.5 text-lg font-semibold tracking-tight text-zinc-100 sm:text-xl"
              >
                Turn your photos into a video — right on your device
              </h2>

              <p
                id="welcome-modal-subtitle"
                class="mt-1.5 max-w-md text-xs leading-relaxed text-zinc-400 sm:text-sm"
              >
                No complicated tools, no waiting for uploads, and no accounts. Here is the quick
                plain-English scoop before you dive in:
              </p>

              <!-- At-a-Glance Trust Pills -->
              <div class="mt-4 flex flex-wrap items-center justify-center gap-1.5">
                <span
                  v-for="pill in WELCOME_TRUST_PILLS"
                  :key="pill"
                  class="inline-flex items-center gap-1 rounded-full border border-zinc-800 bg-zinc-900/90 px-2.5 py-1 text-[11px] font-medium text-zinc-300"
                >
                  <Check class="h-3 w-3 text-emerald-400" aria-hidden="true" />
                  {{ pill }}
                </span>
              </div>
            </div>

            <!-- ELI5 Feature Highlights Grid -->
            <div class="mt-5 grid grid-cols-1 gap-2.5 sm:mt-6 sm:grid-cols-2 sm:gap-3">
              <div
                v-for="feature in WELCOME_FEATURE_HIGHLIGHTS"
                :key="feature.id"
                class="flex flex-col gap-2 rounded-xl border border-zinc-800/90 bg-zinc-900/50 p-3.5 text-left"
              >
                <div class="flex items-center gap-2.5">
                  <span
                    class="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border"
                    :class="feature.accentClasses"
                  >
                    <component
                      :is="WELCOME_FEATURE_ICONS[feature.icon]"
                      class="h-4 w-4"
                      aria-hidden="true"
                    />
                  </span>
                  <h3 class="text-xs font-semibold leading-snug text-zinc-100 sm:text-[13px]">
                    {{ feature.title }}
                  </h3>
                </div>
                <p class="text-xs leading-relaxed text-zinc-400">
                  {{ feature.description }}
                </p>
              </div>
            </div>
          </div>

          <!-- Pinned Footer CTA -->
          <div
            class="flex shrink-0 flex-col items-center justify-between gap-2.5 border-t border-zinc-800/80 bg-zinc-900/40 px-5 py-4 sm:flex-row sm:px-7"
          >
            <p class="text-center text-[11px] text-zinc-500 sm:text-left">
              Works completely in your browser — this note won&apos;t pop up again.
            </p>
            <button
              ref="getStartedButtonRef"
              type="button"
              class="inline-flex w-full shrink-0 items-center justify-center gap-2 rounded-xl bg-indigo-600 px-5 py-2.5 text-sm font-semibold text-white shadow-md shadow-indigo-600/30 transition hover:bg-indigo-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400 focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-950 active:scale-[0.98] sm:w-auto"
              @click="emit('getStarted')"
            >
              <span>Get Started</span>
              <ArrowRight class="h-4 w-4" aria-hidden="true" />
            </button>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.welcome-modal-enter-active {
  transition: opacity 220ms ease-out;
}

.welcome-modal-leave-active {
  transition: opacity 180ms ease-in;
}

.welcome-modal-enter-from,
.welcome-modal-leave-to {
  opacity: 0;
}

.welcome-modal-enter-active .welcome-modal-card {
  transition:
    transform 260ms cubic-bezier(0.16, 1, 0.3, 1),
    opacity 220ms ease-out;
}

.welcome-modal-leave-active .welcome-modal-card {
  transition:
    transform 180ms ease-in,
    opacity 160ms ease-in;
}

.welcome-modal-enter-from .welcome-modal-card {
  opacity: 0;
  transform: translateY(12px) scale(0.96);
}

.welcome-modal-leave-to .welcome-modal-card {
  opacity: 0;
  transform: translateY(6px) scale(0.97);
}

@media (prefers-reduced-motion: reduce) {
  .welcome-modal-enter-from .welcome-modal-card,
  .welcome-modal-leave-to .welcome-modal-card {
    transform: none;
  }
}
</style>
