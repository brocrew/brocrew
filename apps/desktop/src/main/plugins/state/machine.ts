import { pluginSha256 } from '../package-digests'
import {
  type ActivationRef,
  type ActivationSnapshot,
  type Installation,
  type JournalRecord,
  type Operation,
  type OperationRequest,
  type ResolutionReservation,
  type ProjectionReceipt,
  STATE_LIMITS,
  installationProjection,
  encodeState,
  equalState,
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
    updateReader: false,
    usedIds: new Set(),
  }
}
function reserve(state: LifecycleState, ids: readonly string[]): void {
  if (new Set(ids).size !== ids.length || ids.some((id) => state.usedIds.has(id)))
    refuseState('corrupt')
  for (const id of ids) state.usedIds.add(id)
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
    const additions =
      consent.action !== 'uninstall'
        ? request.workspaces.filter((id) => !state.projections.has(`${id}/${consent.pluginId}`))
            .length
        : 0
    if (state.projections.size + additions > STATE_LIMITS.projections) refuseState('limit')
  }
  if (consent.expectedSequence !== state.sequence) refuseState('conflict')
  if (consent.release !== null) {
    for (const { operation } of state.operations.values()) {
      const prior = operation.request.consent
      if (
        prior.pluginId === consent.pluginId &&
        prior.release?.version === consent.release.version &&
        (prior.release.archiveSha256 !== consent.release.archiveSha256 ||
          prior.release.manifestSha256 !== consent.release.manifestSha256)
      )
        refuseState('conflict')
    }
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
export function resolvedSnapshot(state: LifecycleState, success: boolean): ActivationSnapshot {
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
export function snapshotReference(snapshot: ActivationSnapshot, sequence: number): ActivationRef {
  const sha256 = pluginSha256(encodeState(snapshot))
  return { name: `${String(sequence).padStart(8, '0')}-${sha256}.json`, sha256 }
}
export function foldRecord(state: LifecycleState, record: JournalRecord, checksum: string): void {
  if (record.sequence !== state.sequence + 1 || record.previous !== state.head)
    refuseState('corrupt')
  const event = record.event
  if (event.kind === 'created') {
    if (state.sequence !== -1) refuseState('corrupt')
    reserve(state, [event.rootId, event.epoch])
    state.rootId = event.rootId
    state.epoch = event.epoch
  } else {
    if (state.sequence === -1) refuseState('corrupt')
    if (event.kind === 'reader-floor') {
      if (state.pending || state.updateReader) refuseState('corrupt')
      state.updateReader = true
    } else if (event.kind === 'projected') {
      if (state.pending !== null) refuseState('corrupt')
      const key = `${event.workspaceId}/${event.pluginId}`
      if (event.receipt === null) state.projections.delete(key)
      else {
        const current = state.admitted.get(event.pluginId)
        const receipt = event.receipt
        if (
          !current ||
          receipt.rootId !== state.rootId ||
          receipt.epoch !== state.epoch ||
          receipt.workspaceId !== event.workspaceId ||
          receipt.pluginId !== event.pluginId ||
          receipt.installId !== current.installId ||
          receipt.incarnation !== current.incarnation ||
          receipt.lifecycleSequence !== current.lifecycleSequence ||
          receipt.releaseRevision !== current.releaseRevision ||
          receipt.configRevision !== current.configRevision
        )
          refuseState('corrupt')
        if (!state.projections.has(key) && state.projections.size >= STATE_LIMITS.projections)
          refuseState('limit')
        state.projections.set(key, receipt)
      }
    } else if (event.kind === 'prepared') {
      const operation = event.operation
      if (state.operations.has(operation.request.operationId)) refuseState('corrupt')
      const expected = planOperation(state, operation.request, operation.allocated)
      if (!equalState(expected, operation)) refuseState('corrupt')
      reserve(state, Object.values(operation.allocated))
      state.pending = operation
      state.reservation = event.reservation ?? null
      state.operations.set(operation.request.operationId, { operation, status: 'prepared' })
      if (operation.next !== null) state.guards.set(operation.next.pluginId, operation.next)
      if (event.reservation) {
        const reservation = event.reservation
        const complete = snapshotReference(resolvedSnapshot(state, true), record.sequence + 1)
        const abort = snapshotReference(resolvedSnapshot(state, false), record.sequence + 1)
        const sizes = [
          encodeState({
            sequence: record.sequence + 1,
            previous: checksum,
            publicationId: reservation.id,
            event: {
              kind: 'completed',
              operationId: operation.request.operationId,
              activation: complete,
            },
          }).length,
          encodeState({
            sequence: record.sequence + 1,
            previous: checksum,
            publicationId: reservation.id,
            event: {
              kind: 'aborted',
              operationId: operation.request.operationId,
              activation: abort,
            },
          }).length,
        ]
        if (
          record.sequence + reservation.records >= STATE_LIMITS.records ||
          !equalState(complete, reservation.complete) ||
          !equalState(abort, reservation.abort) ||
          Math.max(...sizes) !== reservation.recordBytes
        )
          refuseState('corrupt')
      }
    } else {
      const pending = state.pending
      if (pending === null || pending.request.operationId !== event.operationId)
        refuseState('corrupt')
      const snapshot = resolvedSnapshot(state, event.kind === 'completed')
      if (!equalState(snapshotReference(snapshot, record.sequence), event.activation))
        refuseState('corrupt')
      if (pending.next !== null)
        state.guards.set(pending.next.pluginId, {
          ...pending.next,
          phase:
            event.kind === 'completed' && pending.request.consent.action !== 'uninstall'
              ? 'active'
              : 'removed',
        })
      state.epoch = snapshot.epoch
      state.admitted = new Map(snapshot.entries.map((entry) => [entry.pluginId, entry]))
      state.activation = event.activation
      for (const workspaceId of pending.request.workspaces ?? []) {
        const pluginId = pending.request.consent.pluginId!
        const key = `${workspaceId}/${pluginId}`
        const current = state.admitted.get(pluginId)
        if (
          event.kind === 'completed' &&
          ['install', 'update'].includes(pending.request.consent.action) &&
          current
        )
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
  }
  state.sequence = record.sequence
  state.head = checksum
}
