export const STORAGE_KEY = 'tj-local-appearance-v1'
export const DEFAULT_APPEARANCE = Object.freeze({ mode: 'frosted', cards: 'glass', blur: 3, tint: 8 })

const bounded = (value, fallback, max) => {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback
  return Math.round(Math.min(max, Math.max(0, value)))
}

export function normalizeAppearance(value) {
  const input = value && typeof value === 'object' ? value : {}
  return {
    mode: input.mode === 'original' ? 'original' : 'frosted',
    // Older saved preferences gain glass cards without losing their blur/tint.
    cards: input.cards === 'solid' ? 'solid' : 'glass',
    blur: bounded(input.blur, DEFAULT_APPEARANCE.blur, 20),
    tint: bounded(input.tint, DEFAULT_APPEARANCE.tint, 100)
  }
}

export function readAppearance(storage, key = STORAGE_KEY) {
  try { return normalizeAppearance(JSON.parse(storage.getItem(key))) }
  catch { return { ...DEFAULT_APPEARANCE } }
}

export function saveAppearance(storage, value, key = STORAGE_KEY) {
  try { storage.setItem(key, JSON.stringify(normalizeAppearance(value))); return true }
  catch { return false }
}
