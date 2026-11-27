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
import { PluginStateDisk, type PluginDiskOptions } from './disk'
import {
  admitOperation,
  keepLatestPerPlugin,
  planOperation,
  resolveOperation,
  type LifecycleState,
} from './machine'

/** Storage only. The later person-command controller owns authentication and consent collection. */
export class GlobalPluginState {
  private constructor(private readonly disk: PluginStateDisk) {}
  static create(options: PluginDiskOptions): GlobalPluginState {
    return new GlobalPluginState(PluginStateDisk.create(options))
  }
  static open(options: PluginDiskOptions): GlobalPluginState {
    return new GlobalPluginState(PluginStateDisk.open(options))
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
      operations: [...state.operations.values()],
    })
  }
  /** Persist exact structured consent and stable identity allocation before any installer effect. */
  prepare(input: unknown): Readonly<Operation> {
    const request = stateInput(input, OperationRequest)
    const state = this.disk.load()
    const previous = state.operations.get(request.operationId)
    if (previous !== undefined) {
      if (!equalState(previous.operation.request, request)) refuseState('conflict')
      return frozen(previous.operation)
    }
    // Workspace receipts are no longer kept, so no new operation may ask for them.
    if (request.workspaces !== undefined) refuseState('conflict')
    if (request.consent.action !== 'global-restore') this.active(state)
    const allocated = { installId: randomUUID(), incarnation: randomUUID(), epoch: randomUUID() }
    const operation = planOperation(state, request, allocated)
    const next = structuredClone(state)
    admitOperation(next, operation)
    keepLatestPerPlugin(next)
    this.disk.update(state, next)
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
    const next = structuredClone(state)
    resolveOperation(next, success)
    this.disk.update(state, next)
  }
  private active(state: LifecycleState): ActivationSnapshot {
    if (state.pending !== null) refuseState('busy')
    return committed(state)
  }
  /** Back up only this data. The plugin state is explicitly excluded from every restore set. */
  exportActivation(): Readonly<ActivationSnapshot> {
    return frozen(this.active(this.disk.load()))
  }
  /** What agents and the Plugins page may read while another plugin's operation is pending. */
  committedActivation(): Readonly<ActivationSnapshot> {
    return frozen(committed(this.disk.load()))
  }
  /** Display evidence from this owner's current state, without reading the file again. */
  installationEvidence() {
    const state = this.disk.loadForAdmission()
    return {
      installed: [...state.admitted.keys()],
      pending: state.pending?.request.consent.pluginId ?? null,
    }
  }
  /** One state snapshot for a synchronous workspace admission decision. Never retain it. */
  readWorkspaceAdmission() {
    return this.withWorkspaceAdmission((read) => read)
  }
  /** Authority exists only within this synchronous computation; validate again before return. */
  withWorkspaceAdmission<T>(
    decide: (read: WorkspaceAdmission) => T extends PromiseLike<unknown> ? never : T,
  ): T {
    const state = this.disk.loadForAdmission()
    const read = frozen({
      sequence: state.sequence,
      pendingPlugin: pendingPlugin(state),
      pending: state.pending,
      guardIds: [...state.guards.keys()],
      installations: committed(state).entries,
    })
    const result = decide(read)
    if (result && typeof (result as { then?: unknown }).then === 'function') refuseState('conflict')
    const after = this.disk.loadForAdmission()
    if (after.rootId !== state.rootId || after.sequence !== state.sequence) refuseState('conflict')
    return result
  }
}

export interface WorkspaceAdmission {
  readonly sequence: number
  /** The plugin a pending operation is changing, '*' for one that names none, or null. */
  readonly pendingPlugin: string | null
  readonly pending: Readonly<Operation> | null
  readonly guardIds: readonly string[]
  readonly installations: readonly ActivationSnapshot['entries'][number][]
}

function pendingPlugin(state: LifecycleState): string | null {
  return state.pending ? (state.pending.request.consent.pluginId ?? '*') : null
}
/**
 * The admitted plugins, less what a pending operation is changing: its plugin, whose guard already
 * names the next state, or every plugin for one that names none (a global restore). Every other
 * plugin is exactly as committed until the operation resolves.
 */
function committed(state: LifecycleState): ActivationSnapshot {
  const changing = pendingPlugin(state)
  const entries = [...state.admitted.values()].filter(
    (entry) => changing === null || (changing !== '*' && entry.pluginId !== changing),
  )
  return { format: 1, rootId: state.rootId, epoch: state.epoch, entries }
}
