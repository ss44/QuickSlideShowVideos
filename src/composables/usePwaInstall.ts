import { computed, onBeforeUnmount, onMounted, ref } from 'vue'

interface BeforeInstallPromptEvent extends Event {
  readonly platforms: string[]
  readonly userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>
  prompt(): Promise<void>
}

interface StandaloneNavigator extends Navigator {
  standalone?: boolean
}

function detectStandaloneDisplayMode(): boolean {
  if (typeof window === 'undefined') return false
  const matchesMediaQuery = window.matchMedia?.('(display-mode: standalone)').matches ?? false
  const isIosStandalone = (window.navigator as StandaloneNavigator).standalone === true
  return matchesMediaQuery || isIosStandalone
}

function detectIosSafari(): boolean {
  if (typeof window === 'undefined') return false
  const userAgent = window.navigator.userAgent
  const isIosDevice = /iPad|iPhone|iPod/.test(userAgent)
  const isWebKit = /WebKit/.test(userAgent)
  const isThirdPartyIosBrowser = /CriOS|FxiOS|EdgiOS|OPiOS/.test(userAgent)
  return isIosDevice && isWebKit && !isThirdPartyIosBrowser
}

/**
 * Manages Progressive Web App (PWA) installation state across Chromium-based
 * browsers (`beforeinstallprompt`) and iOS Safari ("Add to Home Screen").
 */
export function usePwaInstall() {
  const deferredInstallPrompt = ref<BeforeInstallPromptEvent | null>(null)
  const isInstalled = ref(detectStandaloneDisplayMode())
  const isIosSafari = ref(detectIosSafari())
  const isInstalling = ref(false)
  const isIosInstructionsOpen = ref(false)

  const canTriggerNativePrompt = computed(() => deferredInstallPrompt.value !== null && !isInstalled.value)
  const canOfferInstall = computed(() => !isInstalled.value && (canTriggerNativePrompt.value || isIosSafari.value))

  let displayModeMediaQuery: MediaQueryList | null = null

  function handleBeforeInstallPrompt(event: Event) {
    event.preventDefault()
    deferredInstallPrompt.value = event as BeforeInstallPromptEvent
  }

  function handleAppInstalled() {
    isInstalled.value = true
    deferredInstallPrompt.value = null
    isIosInstructionsOpen.value = false
  }

  function handleDisplayModeChange(event: MediaQueryListEvent) {
    if (event.matches) {
      isInstalled.value = true
      deferredInstallPrompt.value = null
      isIosInstructionsOpen.value = false
    }
  }

  async function promptInstall(): Promise<void> {
    if (isInstalled.value) return

    if (deferredInstallPrompt.value) {
      isInstalling.value = true
      try {
        await deferredInstallPrompt.value.prompt()
        const choice = await deferredInstallPrompt.value.userChoice
        if (choice.outcome === 'accepted') {
          isInstalled.value = true
        }
        // A deferred prompt can only be invoked once per browser specification
        deferredInstallPrompt.value = null
      } finally {
        isInstalling.value = false
      }
      return
    }

    if (isIosSafari.value) {
      isIosInstructionsOpen.value = !isIosInstructionsOpen.value
    }
  }

  function closeIosInstructions() {
    isIosInstructionsOpen.value = false
  }

  onMounted(() => {
    window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt)
    window.addEventListener('appinstalled', handleAppInstalled)

    displayModeMediaQuery = window.matchMedia?.('(display-mode: standalone)') ?? null
    displayModeMediaQuery?.addEventListener('change', handleDisplayModeChange)
  })

  onBeforeUnmount(() => {
    window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt)
    window.removeEventListener('appinstalled', handleAppInstalled)
    displayModeMediaQuery?.removeEventListener('change', handleDisplayModeChange)
  })

  return {
    isInstalled,
    isIosSafari,
    isInstalling,
    isIosInstructionsOpen,
    canTriggerNativePrompt,
    canOfferInstall,
    promptInstall,
    closeIosInstructions,
  }
}
