import { shallowRef, type ShallowRef } from 'vue'
import type { UpdatesSettingsChange, UpdatesSnapshot } from '../../../shared/updates'

/**
 * 🔴 **B2 · where updates stand, for the rail's footer and its menu** (`window.api.updates`, B1).
 *
 * ⚑ **One snapshot for the whole window**, read once and kept by `onChanged`: the footer's avatar
 * carries a dot while an update is offered, so the snapshot must be held while the menu is closed.
 * ⚑ Every call answers the new snapshot, which replaces the one held.
 *
 * ⚠️ `null` until the first answer, and for good where no bridge carries updates (a window built
 * before B1, a test that gave none): the footer then draws no dot and the menu says only the version
 * it knows.
 */
export interface Updates {
  readonly snapshot: ShallowRef<UpdatesSnapshot | null>
  checkNow(): Promise<void>
  download(): Promise<void>
  restartWhenQuiet(): Promise<void>
  cancelRestart(): Promise<void>
  set(change: UpdatesSettingsChange): Promise<void>
  /** ⚑ Read again — for a first read that never answered. */
  refresh(): Promise<void>
}

type UpdatesBridge = Window['api']['updates']

let held: Updates | null = null

/** ⚑ The window's one {@link Updates}. */
export function useUpdates(): Updates {
  held ??= updatesOver(bridgeOrNull())
  return held
}

/** ⚑ For tests: forget the window's one, so the next {@link useUpdates} reads a new bridge. */
export function forgetUpdates(): void {
  held = null
}

function bridgeOrNull(): UpdatesBridge | null {
  if (typeof window === 'undefined') return null
  return (window as Partial<Window>).api?.updates ?? null
}

function updatesOver(bridge: UpdatesBridge | null): Updates {
  const snapshot = shallowRef<UpdatesSnapshot | null>(null)
  if (bridge !== null) {
    bridge.onChanged((next) => {
      snapshot.value = next
    })
    void bridge.read().then(
      (next) => {
        snapshot.value ??= next
      },
      () => {},
    )
  }
  const take = async (call: (() => Promise<UpdatesSnapshot>) | undefined): Promise<void> => {
    if (call === undefined) return
    snapshot.value = await call()
  }
  return {
    snapshot,
    checkNow: () => take(bridge?.checkNow),
    download: () => take(bridge?.download),
    restartWhenQuiet: () => take(bridge?.restartWhenQuiet),
    cancelRestart: () => take(bridge?.cancelRestart),
    set: (change) => take(bridge === null ? undefined : () => bridge.set(change)),
    refresh: () => take(bridge?.read).catch(() => {}),
  }
}
