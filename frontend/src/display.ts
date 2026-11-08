// Display settings: colour theme and motion. Stored in this browser only; they hold no
// personal data. index.html applies the stored values before the first paint (no flash
// of the wrong theme); this module keeps them applied and follows device changes.
import { useSyncExternalStore } from 'react'

export type ThemeChoice = 'system' | 'light' | 'dark'
export type MotionChoice = 'system' | 'reduce'
export type DisplaySettings = { theme: ThemeChoice; motion: MotionChoice }

// Keep in step with the inline script in index.html.
const STORAGE_KEY = 'boardwise.display'
const DEFAULTS: DisplaySettings = { theme: 'system', motion: 'system' }

const darkQuery = window.matchMedia('(prefers-color-scheme: dark)')
const reduceQuery = window.matchMedia('(prefers-reduced-motion: reduce)')
const listeners = new Set<() => void>()

function read(): DisplaySettings {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}')
    const value = parsed && typeof parsed === 'object' ? (parsed as Partial<DisplaySettings>) : {}
    return {
      theme: value.theme === 'light' || value.theme === 'dark' ? value.theme : 'system',
      motion: value.motion === 'reduce' ? 'reduce' : 'system',
    }
  } catch {
    return DEFAULTS
  }
}

let settings = read()

function apply() {
  const root = document.documentElement
  const dark = settings.theme === 'dark' || (settings.theme === 'system' && darkQuery.matches)
  root.dataset.colorScheme = dark ? 'dark' : 'light'
  if (settings.motion === 'reduce' || reduceQuery.matches) {
    root.dataset.motion = 'reduce'
  } else {
    delete root.dataset.motion
  }
}

function notify() {
  apply()
  listeners.forEach((listener) => listener())
}

export function updateDisplaySettings(changes: Partial<DisplaySettings>) {
  settings = { ...settings, ...changes }
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings))
  } catch {
    // Without storage the choice lasts for this visit only.
  }
  notify()
}

/** True when the device itself asks for reduced motion, whatever the app setting. */
export function deviceReducesMotion(): boolean {
  return reduceQuery.matches
}

// Follow the device when it changes (for example, automatic dark mode at sunset).
darkQuery.addEventListener('change', notify)
reduceQuery.addEventListener('change', notify)
// Keep other open tabs in step.
window.addEventListener('storage', (event) => {
  if (event.key === STORAGE_KEY) {
    settings = read()
    notify()
  }
})
apply()

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function useDisplaySettings(): DisplaySettings {
  return useSyncExternalStore(subscribe, () => settings)
}
