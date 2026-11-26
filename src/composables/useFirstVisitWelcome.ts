import { ref } from 'vue'

const WELCOME_DISMISSED_STORAGE_KEY = 'quick-slideshow:welcome-dismissed:v1'

function readWelcomeDismissedFlag(): boolean {
  if (typeof window === 'undefined') return false
  try {
    return window.localStorage.getItem(WELCOME_DISMISSED_STORAGE_KEY) === 'true'
  } catch {
    // Restricted storage contexts (e.g., strict private browsing) fall back to showing once per session
    return false
  }
}

function persistWelcomeDismissedFlag(): void {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(WELCOME_DISMISSED_STORAGE_KEY, 'true')
  } catch {
    // Non-fatal: the welcome card still closes for the current session
  }
}

/**
 * Manages the one-time first-visit welcome modal state, persisted in localStorage
 * so once the user clicks "Get Started" it never reappears on subsequent visits.
 */
export function useFirstVisitWelcome() {
  const isWelcomeOpen = ref(!readWelcomeDismissedFlag())

  function dismissWelcome() {
    isWelcomeOpen.value = false
    persistWelcomeDismissedFlag()
  }

  return {
    isWelcomeOpen,
    dismissWelcome,
  }
}
