import {
  type WorkspacePluginChoice,
  type ActivationRef,
  type ActivationSnapshot,
  type Installation,
  type JournalRecord,
  type Operation,
  type OperationRequest,
  type ResolutionReservation,
  type ProjectionReceipt,
  installationProjection,
  refuseState,
} from './format'

export interface LifecycleState {
  rootId: string
  epoch: string
  sequence: number
  head: string | null
  guards: Map<string, Installation>
  admitted: Map<string, Installation>
  operations: Map<string, { operation: Operation; status: 'prepared' | 'completed' | 'aborted' }>
  pending: Operation | null
  reservation: ResolutionReservation | null
  activation: ActivationRef | null
  projections: Map<string, ProjectionReceipt>
  workspaceEnabled: Map<string, WorkspacePluginChoice>
  workspaceTitlesEnabled: Map<string, WorkspacePluginChoice>
  updateReader: boolean
  usedIds: Set<string>
}
export function newLifecycle(): LifecycleState {
  return {
    rootId: '',
    epoch: '',
    sequence: -1,
    head: null,
    guards: new Map(),
    admitted: new Map(),
    operations: new Map(),
    pending: null,
    reservation: null,
    activation: null,
    projections: new Map(),
    workspaceEnabled: new Map(),
    workspaceTitlesEnabled: new Map(),
    updateReader: false,
    usedIds: new Set(),
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
  if (request.workspaces !== undefined) {
    if (
      !['install', 'update', 'uninstall'].includes(consent.action) ||
      new Set(request.workspaces).size !== request.workspaces.length ||
      (consent.action !== 'uninstall' && request.workspaces.length === 0)
    )
      refuseState('conflict')
  }
  if (consent.expectedSequence !== state.sequence) refuseState('conflict')
  let next: Installation | null = null
  if (consent.action === 'global-restore') {
    if (
      consent.pluginId !== null ||
      consent.expectedInstallId !== null ||
      consent.release !== null ||
      request.snapshot === null
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
      if ((before !== undefined && before.phase !== 'removed') || consent.release === null)
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
        if (consent.release === null || !Number.isSafeInteger(before.releaseRevision + 1))
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
export function resolvedSnapshot(state: LifecycleState, success: boolean): ActivationSnapshot {
  const operation = state.pending
  if (operation === null) refuseState('conflict')
  const restore = operation.request.consent.action === 'global-restore'
  const epoch = restore && success ? operation.allocated.epoch : state.epoch
  let entries: Installation[]
  if (restore) {
    entries = success ? operation.request.snapshot!.entries : [...state.admitted.values()]
  } else {
    const selected = new Map(state.admitted)
    const next = operation.next!
    if (success) {
      if (operation.request.consent.action === 'uninstall') selected.delete(next.pluginId)
      else selected.set(next.pluginId, { ...next, phase: 'active' })
    }
    entries = [...selected.values()]
  }
  entries.sort((left, right) =>
    left.pluginId < right.pluginId ? -1 : left.pluginId > right.pluginId ? 1 : 0,
  )
  return { format: 1, rootId: state.rootId, epoch, entries }
}
/** Apply local operation data, also used by the read-only legacy journal importer. */
export function foldRecord(state: LifecycleState, record: JournalRecord, _checksum: string): void {
  void _checksum
  const event = record.event
  if (event.kind === 'created') {
    state.rootId = event.rootId
    state.epoch = event.epoch
  } else if (event.kind === 'reader-floor') {
    // Reader floors from the old journal carry no policy into the selected format.
  } else if (event.kind === 'projected') {
    const key = `${event.workspaceId}/${event.pluginId}`
    if (event.receipt) state.projections.set(key, event.receipt)
    else state.projections.delete(key)
  } else if (event.kind === 'prepared') {
    const operation = event.operation
    state.pending = operation
    state.operations.set(operation.request.operationId, { operation, status: 'prepared' })
    if (operation.next) state.guards.set(operation.next.pluginId, operation.next)
  } else {
    const pending = state.pending
    if (!pending || pending.request.operationId !== event.operationId) refuseState('corrupt')
    const snapshot = resolvedSnapshot(state, event.kind === 'completed')
    state.epoch = snapshot.epoch
    state.admitted = new Map(snapshot.entries.map((entry) => [entry.pluginId, entry]))
    if (pending.request.consent.action === 'global-restore' && event.kind === 'completed')
      state.guards = new Map(state.admitted)
    if (pending.next) {
      const id = pending.next.pluginId
      state.guards.set(id, state.admitted.get(id) ?? { ...pending.next, phase: 'removed' })
    }
    for (const workspaceId of pending.request.workspaces ?? []) {
      const id = pending.request.consent.pluginId!
      const key = `${workspaceId}/${id}`,
        current = state.admitted.get(id)
      if (current)
        state.projections.set(
          key,
          installationProjection(state.rootId, state.epoch, workspaceId, current),
        )
      else state.projections.delete(key)
    }
    state.pending = null
    state.reservation = null
    state.operations.set(event.operationId, { operation: pending, status: event.kind })
  }
  state.sequence = record.sequence
  state.head = String(record.sequence)
}
