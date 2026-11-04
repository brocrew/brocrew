import { randomUUID } from 'node:crypto'
import {
  type WorkspacePluginEnabled,
  workspacePluginKey,
  ActivationSnapshot,
  Event,
  installationProjection,
  OperationRequest,
  ProjectionReceipt,
  equalState,
  frozen,
  refuseState,
  stateInput,
  Operation,
  type ProjectionReceipt as Receipt,
} from './format'
import { PluginStateDisk, readInstalledPluginDescriptor, type PluginDiskOptions } from './disk'
import { newLifecycle, planOperation, type LifecycleState } from './machine'

/** Persistent installation selection and independent workspace preferences. */
export class GlobalPluginState {
  private constructor(private readonly disk: PluginStateDisk) {}
  static create(options: PluginDiskOptions): GlobalPluginState {
    const disk = new PluginStateDisk(options, true)
    try {
      disk.append(newLifecycle(), { kind: 'created', rootId: randomUUID(), epoch: randomUUID() })
      return new GlobalPluginState(disk)
    } catch (error) {
      disk.close()
      throw error
    }
  }
  static open(options: PluginDiskOptions): GlobalPluginState {
    const disk = new PluginStateDisk(options)
    try {
      disk.reclaim()
      return new GlobalPluginState(disk)
    } catch (error) {
      disk.close()
      throw error
    }
  }
  /** Read-only installation display; never repairs or starts a plugin. */
  static observeInstallations(options: PluginDiskOptions) {
    const disk = new PluginStateDisk(options, false, true)
    try {
      const state = disk.loadForObservation()
      return {
        installed: [...state.admitted.keys()],
        pending: state.pending?.request.consent.pluginId ?? null,
      }
    } finally {
      disk.close()
    }
  }
  /** Read the selected release without mutating state or executing plugin code. */
  static readInstalledPackage(options: PluginDiskOptions, id: string) {
    return readInstalledPluginDescriptor(options, id)
  }
  close(): void {
    this.disk.close()
  }
  /** FIFO async ownership; synchronous calls by this owner stay reentrant across awaits. */
  withExclusive<T>(run: () => Promise<T>): Promise<T> {
    return this.disk.withExclusive(run)
  }
  inspect() {
    const state = this.disk.load()
    const current = frozen({
      rootId: state.rootId,
      epoch: state.epoch,
      sequence: state.sequence,
      guards: [...state.guards.values()],
      pending: state.pending,
      reservation: state.reservation,
    })
    const disk = this.disk
    let history: ReturnType<PluginStateDisk['operationHistory']> | undefined
    return Object.freeze({
      ...current,
      get operations() {
        return frozen((history ??= disk.operationHistory(state)))
      },
    })
  }
  getEnabled(workspaceId: string, pluginId: string): WorkspacePluginEnabled {
    return this.workspaceChoice('workspaceEnabled', workspaceId, pluginId)
  }
  setEnabled(workspaceId: string, pluginId: string, enabled: boolean): WorkspacePluginEnabled {
    return frozen(this.disk.setWorkspaceChoice('workspaceEnabled', workspaceId, pluginId, enabled))
  }
  getTitlesEnabled(workspaceId: string, pluginId: string): WorkspacePluginEnabled {
    return this.workspaceChoice('workspaceTitlesEnabled', workspaceId, pluginId)
  }
  setTitlesEnabled(
    workspaceId: string,
    pluginId: string,
    enabled: boolean,
  ): WorkspacePluginEnabled {
    return frozen(
      this.disk.setWorkspaceChoice('workspaceTitlesEnabled', workspaceId, pluginId, enabled),
    )
  }
  private workspaceChoice(
    field: 'workspaceEnabled' | 'workspaceTitlesEnabled',
    workspaceId: string,
    pluginId: string,
  ): WorkspacePluginEnabled {
    const row = this.disk.load()[field].get(workspacePluginKey(workspaceId, pluginId))
    return frozen(
      row
        ? { enabled: row.enabled, revision: row.revision }
        : {
            enabled: field === 'workspaceEnabled',
            revision: 0,
          },
    )
  }
  /** Indexed retry lookup; ordinary operations do not scan retained history. */
  operation(operationId: string) {
    return frozen(this.disk.operation(operationId))
  }
  /** Only each plugin's latest selected operation can need filesystem recovery. */
  recoveryOperations() {
    return frozen(this.disk.recoveryOperations())
  }

  /** Kept for callers upgrading from the journal format; no reader floor is written. */
  requireUpdateReader(): void {}
  /** Persist the operation and its allocation before installer effects. */
  prepare(input: unknown): Readonly<Operation> {
    const request = stateInput(input, OperationRequest)
    const state = this.disk.load()
    const previous = this.disk.operation(request.operationId)
    if (previous !== undefined) {
      if (!equalState(previous.operation.request, request)) refuseState('conflict')
      if (
        previous.status === 'prepared' &&
        state.pending &&
        state.pending.request.operationId !== request.operationId
      )
        refuseState('busy')
      if (previous.status === 'prepared' && !state.pending) {
        if (
          request.consent.action === 'global-restore' &&
          request.consent.expectedSequence !== state.sequence
        )
          refuseState('conflict')
        const planned = Operation.parse(
          planOperation(
            state,
            { ...request, consent: { ...request.consent, expectedSequence: state.sequence } },
            previous.operation.allocated,
          ),
        )
        if (!equalState(planned.next, previous.operation.next)) refuseState('conflict')
        this.disk.prepare(state, previous.operation)
      }
      return frozen(previous.operation)
    }
    if (request.consent.action !== 'global-restore') this.active(state)
    const allocated = { installId: randomUUID(), incarnation: randomUUID(), epoch: randomUUID() }
    const operation = planOperation(state, request, allocated)
    this.disk.prepare(state, operation)
    return frozen(operation)
  }
  /** Select a completed installation after its caller finishes the filesystem operation. */
  complete(operationId: string): void {
    this.resolve(operationId, true)
  }
  /** Abort keeps the previous selected installation; caller cleans only its unpublished code. */
  abort(operationId: string): void {
    this.resolve(operationId, false)
  }
  private resolve(operationId: string, success: boolean): void {
    const state = this.disk.load()
    if (state.pending?.request.operationId === operationId) {
      this.disk.resolve(state, success)
      return
    }
    const operation = this.disk.operation(operationId)
    if (operation?.status === (success ? 'completed' : 'aborted')) return
    refuseState('conflict')
  }

  private active(state: LifecycleState): ActivationSnapshot {
    if (state.pending !== null) refuseState('busy')
    return {
      format: 1,
      rootId: state.rootId,
      epoch: state.epoch,
      entries: [...state.admitted.values()],
    }
  }
  /** Export the selected installations for backup. */
  exportActivation(): Readonly<ActivationSnapshot> {
    const state = this.disk.load()
    return frozen(this.active(state))
  }
  emptyProjection(workspaceId: string, pluginId: string): Receipt | null {
    const state = this.disk.load()
    const current = this.active(state).entries.find((entry) => entry.pluginId === pluginId)
    if (current === undefined) return null
    return frozen(
      stateInput(
        installationProjection(state.rootId, state.epoch, workspaceId, current),
        ProjectionReceipt,
      ),
    )
  }
  /** Preview the workspace installation binding for a pending operation. */
  previewProjection(operationId: string, workspaceId: string): Receipt {
    const state = this.disk.load(),
      operation = state.pending
    if (
      !operation ||
      operation.request.operationId !== operationId ||
      !['install', 'update'].includes(operation.request.consent.action) ||
      !operation.request.workspaces?.includes(workspaceId) ||
      !operation.next
    )
      refuseState('conflict')
    return frozen(installationProjection(state.rootId, state.epoch, workspaceId, operation.next))
  }

  /** Transient workspace installation bindings are persisted for reconciliation. */
  projections(workspaceId: string): readonly Receipt[] {
    if (!ProjectionReceipt.shape.workspaceId.safeParse(workspaceId).success) refuseState('conflict')
    return frozen(
      [...this.disk.load().projections.values()].filter((one) => one.workspaceId === workspaceId),
    )
  }
  recordProjection(workspaceId: string, pluginId: string, receipt: Receipt | null): void {
    const state = this.disk.load()
    this.active(state)
    const event = stateInput({ kind: 'projected', workspaceId, pluginId, receipt }, Event)
    if (event.kind !== 'projected') refuseState('conflict')
    if (receipt && (receipt.pluginId !== pluginId || !this.matchesProjection(receipt, workspaceId)))
      refuseState('conflict')
    const key = `${workspaceId}/${pluginId}`
    if (equalState(state.projections.get(key) ?? null, receipt)) return
    this.disk.append(state, event)
  }
  /** Compare a workspace binding with the current installation. */
  matchesProjection(input: unknown, workspaceId: string): boolean {
    const parsed = ProjectionReceipt.safeParse(input)
    if (!parsed.success || parsed.data.workspaceId !== workspaceId) return false
    const current = this.emptyProjection(workspaceId, parsed.data.pluginId)
    return current !== null && equalState(current, parsed.data)
  }
  reconcileProjection(input: unknown, workspaceId: string, pluginId: string) {
    const before = ProjectionReceipt.safeParse(input)
    const receipt = this.emptyProjection(workspaceId, pluginId)
    const sameInstallation =
      before.success &&
      before.data.workspaceId === workspaceId &&
      before.data.rootId === receipt?.rootId &&
      before.data.pluginId === pluginId &&
      before.data.installId === receipt?.installId
    return frozen({
      receipt,
      revoke: before.success && !equalState(before.data, receipt),
      selectionPolicy: sameInstallation ? 'preserve-surviving' : 'off',
    })
  }
}
