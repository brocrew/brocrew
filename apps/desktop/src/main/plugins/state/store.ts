import { randomUUID } from 'node:crypto'
import {
  OperationRequest,
  equalState,
  frozen,
  refuseState,
  stateInput,
  type ActivationSnapshot,
  type Operation,
} from './format'
import { PluginStateDisk, readInstalledPluginDescriptor, type PluginDiskOptions } from './disk'
import { newLifecycle, planOperation, type LifecycleState } from './machine'

/** Storage only. The later person-command controller owns authentication and consent collection. */
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
  /** Display evidence only: no repair, reclaim, prepare, activation or admission. Busy refuses. */
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
  /** Authenticated display snapshot only. No reclaim, mutation or execution; busy refuses. */
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
    return frozen({
      rootId: state.rootId,
      epoch: state.epoch,
      sequence: state.sequence,
      guards: [...state.guards.values()],
      pending: state.pending,
      reservation: state.reservation,
      operations: [...state.operations.values()],
    })
  }
  /** Older readers must refuse before any update can reach their removal recovery. */
  requireUpdateReader(): void {
    const state = this.disk.load()
    if (state.pending) refuseState('busy')
    if (!state.updateReader) this.disk.append(state, { kind: 'reader-floor', version: 2 })
  }
  /** Persist exact structured consent and stable identity allocation before any installer effect. */
  prepare(input: unknown): Readonly<Operation> {
    const request = stateInput(input, OperationRequest)
    const state = this.disk.load()
    const previous = state.operations.get(request.operationId)
    if (previous !== undefined) {
      if (!equalState(previous.operation.request, request)) refuseState('conflict')
      if (previous.status === 'prepared' && state.reservation === null) refuseState('corrupt')
      return frozen(previous.operation)
    }
    if (request.consent.action !== 'global-restore') this.active(state)
    const allocated = { installId: randomUUID(), incarnation: randomUUID(), epoch: randomUUID() }
    const operation = planOperation(state, request, allocated)
    this.disk.prepare(state, operation)
    return frozen(operation)
  }
  /** Caller must finish required readiness/drain work first. This starts/stops no consumer. */
  complete(operationId: string): void {
    this.resolve(operationId, true)
  }
  /** Fail closed rather than reviving the prior installation after an interrupted mutation. */
  abort(operationId: string): void {
    this.resolve(operationId, false)
  }
  private resolve(operationId: string, success: boolean): void {
    const state = this.disk.load()
    const operation = state.operations.get(operationId)
    if (operation === undefined) refuseState('conflict')
    if (operation.status !== 'prepared') {
      if (operation.status === (success ? 'completed' : 'aborted')) return
      refuseState('conflict')
    }
    if (state.pending?.request.operationId !== operationId) refuseState('conflict')
    this.disk.resolve(state, success)
  }
  private active(state: LifecycleState): ActivationSnapshot {
    const snapshot = this.activation(state)
    if (this.disk.load().head !== state.head) refuseState('conflict')
    return snapshot
  }
  private activation(state: LifecycleState): ActivationSnapshot {
    if (state.pending !== null) refuseState('busy')
    if (state.activation === null) {
      if (state.guards.size !== 0) refuseState('corrupt')
      return { format: 1, rootId: state.rootId, epoch: state.epoch, entries: [] }
    }
    const snapshot = this.disk.activationSnapshot(state.activation)
    if (
      snapshot.rootId !== state.rootId ||
      snapshot.epoch !== state.epoch ||
      new Set(snapshot.entries.map((entry) => entry.pluginId)).size !== snapshot.entries.length ||
      snapshot.entries.some(
        (entry) => entry.phase !== 'active' || !equalState(state.guards.get(entry.pluginId), entry),
      )
    )
      refuseState('corrupt')
    return snapshot
  }
  /** Back up only this data. lifecycle-guard is explicitly excluded from every restore set. */
  exportActivation(): Readonly<ActivationSnapshot> {
    const state = this.disk.load()
    return frozen(this.active(state))
  }
  /** One state snapshot for a synchronous workspace admission decision. Never retain it. */
  readWorkspaceAdmission() {
    return this.withWorkspaceAdmission((read) => read)
  }
  /** Authority exists only within this synchronous computation; validate again before return. */
  withWorkspaceAdmission<T>(
    decide: (read: WorkspaceAdmission) => T extends PromiseLike<unknown> ? never : T,
  ): T {
    const state = this.disk.load()
    const installations = state.pending ? [] : this.activation(state).entries
    const read = frozen({
      sequence: state.sequence,
      pending: state.pending !== null,
      guardIds: [...state.guards.keys()],
      installations,
    })
    const result = decide(read)
    if (result && typeof (result as { then?: unknown }).then === 'function') refuseState('conflict')
    const after = this.disk.load()
    if (
      after.rootId !== state.rootId ||
      after.epoch !== state.epoch ||
      after.sequence !== state.sequence ||
      after.head !== state.head ||
      !equalState(after.pending, state.pending) ||
      !equalState(after.activation, state.activation)
    )
      refuseState('conflict')
    return result
  }
}

export interface WorkspaceAdmission {
  readonly sequence: number
  readonly pending: boolean
  readonly guardIds: readonly string[]
  readonly installations: readonly ActivationSnapshot['entries'][number][]
}
