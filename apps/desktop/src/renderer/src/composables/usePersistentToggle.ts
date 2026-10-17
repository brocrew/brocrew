import { ref, watch, type Ref } from 'vue'

/**
 * A boolean that survives a reload.
 *
 * The renderer is reloaded constantly during development, and a panel that springs
 * back open every time is worse than one that never collapsed. `localStorage` is
 * the right size of tool for a per-machine view preference: it is not session
 * state, so it has no business in the DB or over IPC.
 *
 * Storage is injected (and optional) because it is not guaranteed to be there —
 * a test process has none, and a renderer can have it disabled — and a view
 * preference must never be the thing that breaks the screen.
 */
export interface ToggleStorage {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
  /** Optional: a stub storage in a test may not have one, and forgetting is best-effort (344). */
  removeItem?(key: string): void
}

function defaultStorage(): ToggleStorage | null {
  try {
    return globalThis.localStorage ?? null
  } catch {
    return null // access can throw outright when storage is blocked
  }
}

/**
 * Forget a preference this app has stopped having (344).
 *
 * ⛔ **A retired key is not harmless just because nothing reads it.** `brobot2.chatLightTheme` is
 * `"true"` or `"false"` in `localStorage` on every machine that ever pressed the reading light, and
 * the build that retires the control leaves it there: a live value under a name the product no
 * longer means anything by. Removing the READ is what stops it pinning a body dark; removing the
 * KEY is what stops it being read again by accident.
 *
 * ⚠️ **Silent about a machine that never had it, and silent about storage that refuses.** Same rule
 * as the write above: a preference that cannot be forgotten is not worth failing a render over, and
 * a key that was never there is not an error — `removeItem` is a no-op on both.
 */
export function forgetPersistentPreference(
  key: string,
  storage: ToggleStorage | null = defaultStorage(),
): void {
  try {
    storage?.removeItem?.(key)
  } catch {
    // Storage can throw on access, not only on write.
  }
}

export function usePersistentToggle(
  key: string,
  initial: boolean,
  storage: ToggleStorage | null = defaultStorage(),
): Ref<boolean> {
  const stored = read(storage, key)
  const state = ref(stored ?? initial)

  watch(state, (value) => {
    try {
      storage?.setItem(key, value ? 'true' : 'false')
    } catch {
      // A preference that cannot be saved is not worth failing a render over.
    }
  })

  return state
}

function read(storage: ToggleStorage | null, key: string): boolean | null {
  // Anything we did not write is treated as "no preference" rather than guessed at.
  const raw = readRaw(storage, key)
  return raw === 'true' ? true : raw === 'false' ? false : null
}

/** What is in storage, or null. Access itself can throw when storage is blocked, not just read. */
function readRaw(storage: ToggleStorage | null, key: string): string | null {
  try {
    return storage?.getItem(key) ?? null
  } catch {
    return null
  }
}

/**
 * The same thing for a value out of a known set — which drawer tab you were last on (080).
 *
 * ⚠️ **The stored string is validated rather than trusted**, and that is the whole reason this is
 * not `ref(localStorage.getItem(key) ?? initial)`. A preference outlives the build that wrote it: a
 * tab that is renamed or retired leaves a value in storage that no longer selects anything, and the
 * drawer would open on an empty body with the cause invisible in a store nobody thinks to look at.
 * An unrecognised value means "no preference", exactly as an unrecognised boolean does above.
 */
export function usePersistentChoice<T extends string>(
  key: string,
  initial: T,
  accepts: (value: unknown) => value is T,
  storage: ToggleStorage | null = defaultStorage(),
): Ref<T> {
  const stored = readRaw(storage, key)
  const state = ref(accepts(stored) ? stored : initial) as Ref<T>

  watch(state, (value) => {
    try {
      storage?.setItem(key, value)
    } catch {
      // A preference that cannot be saved is not worth failing a render over.
    }
  })

  return state
}
