import { useSyncExternalStore } from 'react'

export const FONT_SIZE_STORAGE_KEY = 'app-font-scale-v1'
export const DEFAULT_FONT_SCALE = 1
export const FONT_SIZE_OPTIONS = [
  { label: '较小', scale: 0.9 },
  { label: '标准', scale: 1 },
  { label: '较大', scale: 1.1 },
  { label: '大号', scale: 1.2 },
  { label: '特大', scale: 1.3 }
] as const

let currentScale: number = DEFAULT_FONT_SCALE
const listeners = new Set<() => void>()

function normalizeScale(value: unknown): number {
  return FONT_SIZE_OPTIONS.find((option) => option.scale === value)?.scale ?? DEFAULT_FONT_SCALE
}

function loadFontScale(): number {
  try {
    return normalizeScale(JSON.parse(window.localStorage.getItem(FONT_SIZE_STORAGE_KEY) ?? 'null'))
  } catch {
    return DEFAULT_FONT_SCALE
  }
}

function applyFontScale(scale: number): void {
  document.documentElement.style.setProperty('--app-font-scale', String(scale))
  currentScale = scale
  listeners.forEach((listener) => listener())
}

// Run before React mounts so a saved size also applies to the first rendered frame.
export function initializeFontSize(): () => void {
  applyFontScale(loadFontScale())
  const syncStorage = (event: StorageEvent): void => {
    if (event.key === FONT_SIZE_STORAGE_KEY || event.key === null) {
      applyFontScale(loadFontScale())
    }
  }
  window.addEventListener('storage', syncStorage)
  return () => window.removeEventListener('storage', syncStorage)
}

export function saveFontScale(value: number): boolean {
  const scale = normalizeScale(value)
  applyFontScale(scale)
  try {
    window.localStorage.setItem(FONT_SIZE_STORAGE_KEY, JSON.stringify(scale))
    return true
  } catch {
    // The setting still works for this session when local storage is unavailable.
    return false
  }
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function useFontScale(): number {
  return useSyncExternalStore(
    subscribe,
    () => currentScale,
    () => DEFAULT_FONT_SCALE
  )
}
