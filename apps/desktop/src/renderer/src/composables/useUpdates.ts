import { shallowRef, type ShallowRef } from 'vue'
import type {
  UpdateRestartWorkspace,
  UpdatesBridge,
  UpdatesSettingsChange,
  UpdatesSnapshot,
} from '../../../shared/updates'
import type { ClientApi } from '../../../shared/client-api'
import { useClientApi } from '../client-provider/injection'

/**
 * 🔴 **B2 · where updates stand, for the rail's footer and its menu** (desktop updates, B1).
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
  restartPlan(): Promise<readonly UpdateRestartWorkspace[]>
  restartNow(): Promise<void>
  cancelRestart(): Promise<void>
  set(change: UpdatesSettingsChange): Promise<void>
  /** ⚑ Read again — for a first read that never answered. */
  refresh(): Promise<void>
}

interface UpdatesHolder {
  readonly updates: Updates
  readonly stop: () => void
}

// The footer and its menu share one subscription for the same client.
const holders = new Map<ClientApi, UpdatesHolder>()

export function useUpdates(): Updates {
  const client = useClientApi()
  let holder = holders.get(client)
  if (holder === undefined) {
    holder = updatesOver(client.desktop?.updates ?? null)
    holders.set(client, holder)
  }
  return holder.updates
}

/** Release the subscriptions on test teardown or hot reload. */
export function forgetUpdates(): void {
  for (const holder of holders.values()) holder.stop()
  holders.clear()
}

import.meta.hot?.dispose(forgetUpdates)

function updatesOver(bridge: UpdatesBridge | null): UpdatesHolder {
  const snapshot = shallowRef<UpdatesSnapshot | null>(null)
  let stop = (): void => {}
  if (bridge !== null) {
    stop = bridge.onChanged((next) => {
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
    snapshot.value = await call.call(bridge)
  }
  return {
    updates: {
      snapshot,
      checkNow: () => take(bridge?.checkNow),
      download: () => take(bridge?.download),
      restartWhenQuiet: () => take(bridge?.restartWhenQuiet),
      restartPlan: () => bridge?.restartPlan() ?? Promise.resolve([]),
      restartNow: () => take(bridge?.restartNow),
      cancelRestart: () => take(bridge?.cancelRestart),
      set: (change) => take(bridge === null ? undefined : () => bridge.set(change)),
      refresh: () => take(bridge?.read).catch(() => {}),
    },
    stop,
  }
}
