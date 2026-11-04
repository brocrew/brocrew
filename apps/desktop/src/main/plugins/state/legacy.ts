import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import {
  ActivationSnapshot,
  decodeState,
  equalState,
  installationProjection,
  JournalRecord,
  refuseState,
  type Installation,
} from './format'
import { foldRecord, newLifecycle, type LifecycleState } from './machine'

/** Import historical selections without enforcing the old seals, floors or reservation proofs. */
export function readLegacyPluginState(root: string): LifecycleState {
  const state = newLifecycle(),
    folder = join(root, 'lifecycle-guard')
  if (!existsSync(folder)) return state
  for (const name of readdirSync(folder)
    .filter((name) => /^\d+\.json$/.test(name))
    .sort((a, b) => Number(a.slice(0, -5)) - Number(b.slice(0, -5)))) {
    const record = decodeState(readFileSync(join(folder, name)), JournalRecord),
      event = record.event
    if (event.kind !== 'completed' && event.kind !== 'aborted') {
      foldRecord(state, record, '')
      continue
    }
    const pending = state.pending
    if (!pending || pending.request.operationId !== event.operationId) refuseState('corrupt')
    let entries: Installation[]
    const completed = event.kind === 'completed'
    if (pending.request.consent.action === 'global-restore') {
      entries = completed
        ? pending.request.snapshot!.entries.filter((entry) =>
            equalState(state.guards.get(entry.pluginId), entry),
          )
        : []
      state.epoch = pending.allocated.epoch
    } else {
      const next = pending.next!
      const selected = new Map(state.admitted)
      const resolved = {
        ...next,
        phase:
          completed && pending.request.consent.action !== 'uninstall'
            ? ('active' as const)
            : ('removed' as const),
      }
      state.guards.set(next.pluginId, resolved)
      if (resolved.phase === 'active') selected.set(next.pluginId, resolved)
      else selected.delete(next.pluginId)
      entries = [...selected.values()]
    }
    // Old activation files contain selected data, not authority for a new launch.
    if (event.activation && /^\d+-[a-f0-9]+\.json$/.test(event.activation.name)) {
      const path = join(root, 'activations', event.activation.name)
      if (existsSync(path)) {
        const snapshot = decodeState(readFileSync(path), ActivationSnapshot)
        entries = snapshot.entries
        state.epoch = snapshot.epoch
      }
    }
    state.admitted = new Map(entries.map((entry) => [entry.pluginId, entry]))
    for (const workspaceId of pending.request.workspaces ?? []) {
      const id = pending.request.consent.pluginId!,
        key = `${workspaceId}/${id}`,
        current = state.admitted.get(id)
      if (completed && ['install', 'update'].includes(pending.request.consent.action) && current)
        state.projections.set(
          key,
          installationProjection(state.rootId, state.epoch, workspaceId, current),
        )
      else state.projections.delete(key)
    }
    state.operations.set(event.operationId, { operation: pending, status: event.kind })
    state.pending = null
    state.sequence = record.sequence
    state.head = String(record.sequence)
  }
  return state
}
