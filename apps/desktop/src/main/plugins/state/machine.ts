import { strictPluginJson } from '../strict-json'
import {
  type ActivationSnapshot,
  type Installation,
  type Operation,
  type OperationRequest,
  STATE_LIMITS,
  StateFile,
  equalState,
  refuseState,
} from './format'

export interface LifecycleState {
  rootId: string
  epoch: string
  /** Goes up by one with every change. A consent names the sequence it was given against. */
  sequence: number
  /** Every plugin ever installed, removed ones too. */
  guards: Map<string, Installation>
  admitted: Map<string, Installation>
  /** The latest operation of each plugin, and of a global restore. */
  operations: Map<string, { operation: Operation; status: 'prepared' | 'completed' | 'aborted' }>
  pending: Operation | null
}
export function newLifecycle(rootId: string, epoch: string): LifecycleState {
  return {
    rootId,
    epoch,
    sequence: 0,
    guards: new Map(),
    admitted: new Map(),
    operations: new Map(),
    pending: null,
  }
}
/** Replayed operations keep their original allocation; retries never mint another install. */
export function planOperation(
  state: LifecycleState,
  request: OperationRequest,
  allocated: Operation['allocated'],
): Operation {
  if (state.pending !== null) refuseState('busy')
  const consent = request.consent
  if (consent.expectedSequence !== state.sequence) refuseState('conflict')
  if (consent.release !== null) {
    const known = [
      ...[...state.operations.values()].map(({ operation }) => operation.request.consent),
      ...state.guards.values(),
    ]
    if (
      known.some(
        (prior) =>
          prior.pluginId === consent.pluginId &&
          prior.release?.version === consent.release!.version &&
          (prior.release.archiveSha256 !== consent.release!.archiveSha256 ||
            prior.release.manifestSha256 !== consent.release!.manifestSha256),
      )
    )
      refuseState('conflict')
  }
  let next: Installation | null = null
  if (consent.action === 'global-restore') {
    if (
      consent.pluginId !== null ||
      consent.expectedInstallId !== null ||
      consent.release !== null ||
      request.snapshot === null ||
      request.snapshot.rootId !== state.rootId
    )
      refuseState('conflict')
    const names = request.snapshot.entries.map((entry) => entry.pluginId)
    if (
      new Set(names).size !== names.length ||
      request.snapshot.entries.some((entry) => entry.phase !== 'active')
    )
      refuseState('conflict')
  } else {
    if (consent.pluginId === null || request.snapshot !== null) refuseState('conflict')
    const before = state.guards.get(consent.pluginId)
    if (consent.expectedInstallId !== (before?.installId ?? null)) refuseState('conflict')
    const sequence = (before?.lifecycleSequence ?? 0) + 1
    if (!Number.isSafeInteger(sequence)) refuseState('limit')
    if (consent.action === 'install') {
      if (
        (before !== undefined && before.phase !== 'removed') ||
        consent.release === null ||
        (before === undefined && state.guards.size >= STATE_LIMITS.plugins)
      )
        refuseState('conflict')
      next = {
        pluginId: consent.pluginId,
        installId: allocated.installId,
        incarnation: allocated.incarnation,
        lifecycleSequence: sequence,
        releaseRevision: 1,
        configRevision: 0,
        release: consent.release,
        phase: 'prepared',
      }
    } else {
      if (before === undefined || before.phase !== 'active') refuseState('conflict')
      if (consent.action === 'uninstall') {
        if (consent.release !== null) refuseState('conflict')
        next = { ...before, lifecycleSequence: sequence, phase: 'removed' }
      } else {
        if (!state.admitted.has(consent.pluginId)) refuseState('conflict')
        if (
          consent.release === null ||
          !Number.isSafeInteger(before.releaseRevision + 1) ||
          consent.release.dataSchema !== before.release.dataSchema
        )
          refuseState('conflict')
        next = {
          ...before,
          incarnation: allocated.incarnation,
          lifecycleSequence: sequence,
          releaseRevision: before.releaseRevision + 1,
          release: consent.release,
          phase: 'prepared',
        }
      }
    }
  }
  return { request, allocated, next }
}
function resolvedSnapshot(state: LifecycleState, success: boolean): ActivationSnapshot {
  const operation = state.pending
  if (operation === null) refuseState('conflict')
  const restore = operation.request.consent.action === 'global-restore'
  const epoch = restore ? operation.allocated.epoch : state.epoch
  let entries: Installation[]
  if (restore) {
    entries = success
      ? operation.request.snapshot!.entries.filter((entry) =>
          equalState(state.guards.get(entry.pluginId), entry),
        )
      : []
  } else {
    const guards = new Map(state.admitted)
    const next = operation.next!
    guards.set(next.pluginId, {
      ...next,
      phase: success && operation.request.consent.action !== 'uninstall' ? 'active' : 'removed',
    })
    entries = [...guards.values()].filter((entry) => entry.phase === 'active')
  }
  entries.sort((left, right) =>
    left.pluginId < right.pluginId ? -1 : left.pluginId > right.pluginId ? 1 : 0,
  )
  return { format: 1, rootId: state.rootId, epoch, entries }
}
/** The operation becomes pending: its plugin's guard already names the next state. */
export function admitOperation(state: LifecycleState, operation: Operation): void {
  state.pending = operation
  state.operations.set(operation.request.operationId, { operation, status: 'prepared' })
  if (operation.next !== null) state.guards.set(operation.next.pluginId, operation.next)
}
/** The pending operation completes or aborts, and the admitted set becomes its outcome. */
export function resolveOperation(state: LifecycleState, success: boolean): void {
  const pending = state.pending
  if (pending === null) refuseState('conflict')
  const snapshot = resolvedSnapshot(state, success)
  if (pending.next !== null)
    state.guards.set(pending.next.pluginId, {
      ...pending.next,
      phase: success && pending.request.consent.action !== 'uninstall' ? 'active' : 'removed',
    })
  state.epoch = snapshot.epoch
  state.admitted = new Map(snapshot.entries.map((entry) => [entry.pluginId, entry]))
  state.pending = null
  state.operations.set(pending.request.operationId, {
    operation: pending,
    status: success ? 'completed' : 'aborted',
  })
}
/**
 * Only each plugin's latest operation is kept; retrying an earlier id is refused as a conflict.
 * Recovery loses nothing: a new operation starts only when nothing is pending, the controller
 * settles an operation's effect before completing it, and an abort leaves the plugin removed, so
 * the next operation is a fresh install whose new installId recovery never confuses with the old.
 */
export function keepLatestPerPlugin(state: LifecycleState): void {
  const latest = new Map<string, string>()
  for (const [id, { operation }] of state.operations)
    latest.set(operation.request.consent.pluginId ?? '*', id)
  const kept = new Set(latest.values())
  for (const id of [...state.operations.keys()]) if (!kept.has(id)) state.operations.delete(id)
}
export function encodeStateFile(state: LifecycleState): Buffer {
  const file: StateFile = {
    format: 2,
    rootId: state.rootId,
    epoch: state.epoch,
    sequence: state.sequence,
    plugins: [...state.guards.values()],
    active: [...state.admitted.values()],
    pending: state.pending,
    operations: [...state.operations.values()],
  }
  const bytes = Buffer.from(JSON.stringify(file))
  if (bytes.length > STATE_LIMITS.stateBytes) refuseState('limit')
  return bytes
}
export function decodeStateFile(bytes: Uint8Array): LifecycleState {
  let file: StateFile
  try {
    const parsed = StateFile.safeParse(strictPluginJson(bytes, STATE_LIMITS.stateBytes))
    if (!parsed.success) refuseState('corrupt')
    file = parsed.data
  } catch {
    return refuseState('corrupt')
  }
  return {
    rootId: file.rootId,
    epoch: file.epoch,
    sequence: file.sequence,
    guards: new Map(file.plugins.map((entry) => [entry.pluginId, entry])),
    admitted: new Map(file.active.map((entry) => [entry.pluginId, entry])),
    operations: new Map(
      file.operations.map((entry) => [entry.operation.request.operationId, entry]),
    ),
    pending: file.pending,
  }
}
