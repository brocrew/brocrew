import {
  pluginToolActivityStages,
  type PluginCallDiagnostic,
  type PluginToolFailureReason,
} from './tool-diagnostics'
import { randomUUID } from 'node:crypto'
import { collidingToolNames, externalMcpNameRefusal } from '../../shared/external-mcp'
import { pluginSha256 } from './package-digests'
import type {
  BrokerAgent,
  BrokerAudit,
  BrokerCallCause,
  BrokerProgress,
  BrokerFailure,
  BrokerIdentity,
  BrokerInput,
  BrokerOptions,
  BrokerReply,
  BrokerRequest,
  BrokerValue,
  BrokerWorkspace,
  PluginExecution,
  PluginToolBroker,
  PublishedBrokerTool,
} from './tool-broker-types'
export type * from './tool-broker-types'

/** Running calls plus calls whose completion is unknown. */
const IN_FLIGHT_LIMIT = 64
export class PluginBrokerError extends Error {
  constructor(
    readonly code: BrokerFailure,
    readonly tool?: string,
    readonly callCause?: BrokerCallCause,
    dispatched = true,
    completionKnown = false,
    error?: unknown,
  ) {
    const message = tool
      ? !dispatched
        ? `Tool ${tool} was not started: ${code}.`
        : completionKnown
          ? `Tool ${tool} failed: ${callCause ?? code}.`
          : callCause === 'stalled'
            ? `Tool ${tool} took too long; completion is unknown. The operation may still be running.`
            : `Tool ${tool} failed: ${callCause ?? code}; completion is unknown.`
      : code === 'busy'
        ? 'Plugin busy. Try again.'
        : 'Plugin unavailable. Try again.'
    super(
      error === undefined
        ? message
        : `${message} ${error instanceof Error ? error.message : String(error)}`,
      { cause: error },
    )
    this.name = 'PluginBrokerError'
    Object.freeze(this)
  }
}
const refuse = (code: BrokerFailure): never => {
  throw new PluginBrokerError(code)
}
const identifier = (value: string): boolean =>
  typeof value === 'string' &&
  value.length > 0 &&
  value.length <= 128 &&
  ![...value].some((c) => /\s/.test(c) || c.charCodeAt(0) < 32 || c.charCodeAt(0) === 127)
const fold = (value: string): string => value.normalize('NFKC').toLowerCase()
interface Workspace {
  readonly id: string
  readonly handle: BrokerWorkspace
  valid: boolean
  readonly actors: Map<string, Actor>
}
interface Actor {
  readonly workspace: Workspace
  readonly handle: BrokerAgent
  readonly identity: BrokerIdentity
  valid: boolean
}
interface Job {
  readonly actor: Actor
  readonly name: string
  readonly input: BrokerInput
  readonly _meta?: BrokerRequest['_meta']
  readonly resolve: (value: BrokerValue) => void
  readonly reject: (error: unknown) => void
  readonly controller: AbortController
  offSignal: () => void
  state: 'running' | 'finished'
  answered: boolean
  cancelling: boolean
  callId: string
  startedAtIso: string
  lastStage: PluginCallDiagnostic['lastStage']
  execution?: PluginExecution
  quiet: boolean
  cancelSent: boolean
  readonly onprogress?: (progress: BrokerProgress) => void
  reply?: BrokerReply
}
const nothing = (): void => {}

export function createPluginToolBroker(options: BrokerOptions): PluginToolBroker {
  const binding = Object.freeze({
    pluginId: options.binding.pluginId,
    installId: options.binding.installId,
    epoch: options.binding.epoch,
  })
  const suffix =
    binding.pluginId.length <= 56
      ? binding.pluginId
      : `${binding.pluginId.slice(0, 40)}-${pluginSha256(Buffer.from(binding.pluginId)).slice(0, 16)}`
  const namespace = `plugin-${suffix}`
  if (
    !/^[a-z][a-z0-9-]{0,63}$/.test(binding.pluginId) ||
    !identifier(binding.installId) ||
    !identifier(binding.epoch) ||
    externalMcpNameRefusal(namespace, options.reservedNamespace)
  )
    return refuse('invalid')
  if (options.occupiedNamespaces.some((name) => fold(name) === fold(namespace)))
    return refuse('invalid')
  const tools = new Map(options.tools.map((tool) => [tool.name, Object.freeze({ ...tool })]))
  const offered = options.tools.map((tool) => tool.name)
  if (
    tools.size !== offered.length ||
    new Set(offered.map(fold)).size !== offered.length ||
    collidingToolNames(offered, options.hostToolNames).length > 0
  )
    return refuse('invalid')
  const occupied = new Set(options.occupiedQualifiedNames.map(fold))
  for (const name of offered)
    if (!/^[a-zA-Z][a-zA-Z0-9_-]{0,63}$/.test(name)) return refuse('invalid')
  const published = Object.freeze(
    [...tools.values()].map((tool): PublishedBrokerTool => {
      const qualifiedName = `${namespace}__${tool.name}`
      if (occupied.has(fold(qualifiedName)) || typeof tool.description !== 'string')
        return refuse('invalid')
      return {
        ...tool,
        namespace,
        qualifiedName,
      }
    }),
  )
  const server = { tool: options.server.tool.bind(options.server) }
  const audit = options.audit
  const workspaceHandles = new WeakMap<object, Workspace>()
  const actors = new WeakMap<object, Actor>()
  const workspaces = new Map<string, Workspace>()
  // Every admitted call starts at once; the plugin orders its own work.
  const running = new Set<Job>()
  // A call that ended without proof stays here until it proves quiescence or the host exits.
  const uncertain = new Set<Job>()
  let available = true

  function log(
    event: BrokerAudit['event'],
    code?: BrokerFailure,
    reason?: PluginToolFailureReason,
    call?: PluginCallDiagnostic,
  ): void {
    try {
      audit?.(
        Object.freeze({
          event,
          ...(code ? { code } : {}),
          ...(reason ? { reason } : {}),
          ...(call ? { call } : {}),
        }),
      )
    } catch {
      /* Diagnostics cannot affect admission or expose an upstream error. */
    }
  }
  function callState(job: Job, state: PluginCallDiagnostic['state']): PluginCallDiagnostic {
    return Object.freeze({
      callId: job.callId,
      tool: job.name,
      startedAt: job.startedAtIso,
      lastStage: job.lastStage,
      state,
    })
  }
  function retain(job: Job): void {
    if (job.quiet || uncertain.has(job)) return
    uncertain.add(job)
    log('call', undefined, 'call-state', callState(job, 'completion-unknown'))
  }
  function identity(capability: object): Actor {
    const actor = actors.get(capability)
    if (!available) return refuse('unavailable')
    if (!actor || !actor.valid || !actor.workspace.valid) return refuse('unauthorized')
    return actor
  }
  function inFlight(): number {
    let count = uncertain.size
    for (const job of running) if (!uncertain.has(job)) count++
    return count
  }
  function valid(job: Job): boolean {
    return available && job.actor.valid && job.actor.workspace.valid
  }
  function answer(job: Job, value: BrokerValue | undefined, code?: BrokerFailure): void {
    if (job.answered) return
    job.answered = true
    job.offSignal()
    if (code) {
      log('refused', code)
      try {
        job.reject(
          new PluginBrokerError(
            code,
            job.name,
            job.reply?.ok === false ? job.reply.cause : undefined,
            true,
            job.quiet,
            job.reply?.ok === false ? job.reply.error : undefined,
          ),
        )
      } catch (error) {
        job.reject(error)
      }
    } else job.resolve(value ?? null)
  }
  function finished(job: Job): void {
    if (job.state === 'finished') return
    job.offSignal()
    job.state = 'finished'
    running.delete(job)
    log('finished')
  }
  function unavailable(reason: PluginToolFailureReason): void {
    if (!available) return
    available = false
    log('unavailable', 'unavailable', reason)
    for (const job of [...running]) stop(job, 'unavailable')
  }
  function settle(job: Job): void {
    if (job.state !== 'running') return
    if (job.reply?.ok === false) stop(job, 'downstream')
    else if (job.quiet && job.reply) {
      if (!valid(job)) answer(job, undefined, 'unauthorized')
      else if (!job.reply.ok) answer(job, undefined, 'downstream')
      else {
        answer(job, job.reply.value)
      }
      finished(job)
    }
  }
  function requestCancel(job: Job): void {
    if (job.cancelSent || !job.execution) return
    job.cancelSent = true
    try {
      void Promise.resolve(job.execution.cancel()).catch(() =>
        log('refused', 'downstream', 'cancel-failed'),
      )
    } catch {
      log('refused', 'downstream', 'cancel-failed')
    }
  }
  function stop(job: Job, code: BrokerFailure): void {
    if (job.state === 'finished') return
    answer(job, undefined, code)
    if (job.cancelling) return
    job.cancelling = true
    retain(job)
    job.controller.abort()
    requestCancel(job)
    finished(job)
  }
  function start(job: Job): void {
    running.add(job)
    const request: BrokerRequest = Object.freeze({
      identity: job.actor.identity,
      name: job.name,
      input: job.input,
      _meta: job._meta,
    })
    try {
      job.execution = server.tool(request, job.controller.signal, (progress) => {
        if (job.state === 'running' && !job.answered) {
          const stage = pluginToolActivityStages.find((one) => one === progress.message)
          if (stage) job.lastStage = stage
          job.onprogress?.(progress)
        }
      })
      if (
        !job.execution ||
        typeof job.execution.cancel !== 'function' ||
        typeof job.execution.result?.then !== 'function' ||
        typeof job.execution.quiescent?.then !== 'function'
      )
        throw new Error()
      if (job.cancelling) requestCancel(job)
      log('started')
      void Promise.resolve(job.execution.result)
        .then(
          (reply) => {
            if (job.state !== 'running' || job.cancelling) return
            try {
              const ok = reply?.ok
              if (typeof ok !== 'boolean') {
                stop(job, 'downstream')
                return
              }
              job.reply = ok
                ? { ok: true, value: reply.value }
                : { ok: false, cause: reply.cause, error: reply.error }
              settle(job)
            } catch (error) {
              job.reply = { ok: false, error }
              stop(job, 'downstream')
            }
          },
          (error) => {
            job.reply = { ok: false, error }
            stop(job, 'downstream')
          },
        )
        .catch(() => unavailable('reply-invalid'))
      void Promise.resolve(job.execution.quiescent)
        .then(
          () => {
            job.quiet = true
            if (uncertain.delete(job))
              log('call', undefined, 'call-state', callState(job, 'completed'))
            settle(job)
          },
          (error) => {
            if (job.state === 'finished') return
            if (job.reply?.ok !== false)
              job.reply = {
                ok: false,
                cause: error instanceof PluginBrokerError ? error.callCause : undefined,
                error: error instanceof PluginBrokerError ? error.cause : error,
              }
            log('refused', 'downstream', 'proof-rejected')
            stop(job, 'downstream')
          },
        )
        .catch(() => unavailable('proof-rejected'))
    } catch (error) {
      job.reply = { ok: false, error }
      unavailable('execution-invalid')
    }
  }
  function submit(
    capability: object,
    name: string,
    supplied: BrokerInput,
    signal?: AbortSignal,
    onprogress?: (progress: BrokerProgress) => void,
    _meta?: BrokerRequest['_meta'],
  ): Promise<BrokerValue> {
    return new Promise((resolve, reject) => {
      let actor: Actor, copy: BrokerInput
      try {
        actor = identity(capability)
        if (!tools.has(name)) return refuse('denied')
        copy = supplied
        identity(capability)
        if (signal?.aborted) return refuse('cancelled')
        if (inFlight() >= IN_FLIGHT_LIMIT) return refuse('busy')
      } catch (error) {
        log('refused', error instanceof PluginBrokerError ? error.code : 'invalid')
        reject(error)
        return
      }
      const job: Job = {
        actor,
        name,
        input: copy,
        resolve,
        reject,
        controller: new AbortController(),
        offSignal: nothing,
        state: 'running',
        answered: false,
        cancelling: false,
        callId: randomUUID(),
        startedAtIso: new Date().toISOString(),
        lastStage: 'unknown',
        quiet: false,
        cancelSent: false,
        onprogress,
        _meta,
      }
      const cancel = (): void => stop(job, 'cancelled')
      signal?.addEventListener('abort', cancel, { once: true })
      job.offSignal = () => signal?.removeEventListener('abort', cancel)
      start(job)
    })
  }
  function revoke(actor: Actor): void {
    actor.valid = false
    for (const job of [...running]) if (job.actor === actor) stop(job, 'unauthorized')
  }
  function grant(handle: BrokerWorkspace, incarnation: string): BrokerAgent {
    const workspace = workspaceHandles.get(handle)
    if (!available || !workspace?.valid || !identifier(incarnation)) return refuse('unauthorized')
    const existing = workspace.actors.get(incarnation)
    if (existing) {
      if (existing.valid) return existing.handle
      return refuse('unauthorized')
    }
    const capability = Object.freeze(Object.create(null)) as BrokerAgent
    const actor: Actor = {
      workspace,
      handle: capability,
      valid: true,
      identity: Object.freeze({ ...binding, workspaceId: workspace.id, incarnation }),
    }
    workspace.actors.set(incarnation, actor)
    actors.set(capability, actor)
    return capability
  }
  void options.hostExited?.then(
    () => {
      unavailable('host-exited')
      for (const job of uncertain)
        log('call', undefined, 'call-state', callState(job, 'host-exited'))
      uncertain.clear()
    },
    () => log('refused', 'unavailable', 'host-exit-unproven'),
  )
  return Object.freeze({
    agent: Object.freeze({
      discover(capability: BrokerAgent) {
        identity(capability)
        return published
      },
      call(
        capability: BrokerAgent,
        qualifiedName: string,
        args: BrokerInput,
        signal?: AbortSignal,
        onprogress?: (progress: BrokerProgress) => void,
        _meta?: BrokerRequest['_meta'],
      ) {
        const name = published.find((tool) => tool.qualifiedName === qualifiedName)?.name ?? ''
        return submit(capability, name, args, signal, onprogress, _meta)
      },
    }),
    owner: Object.freeze({
      hasCompletionProof: () => !available && running.size === 0 && uncertain.size === 0,
      attach(workspaceId: string): BrokerWorkspace {
        if (!available || !identifier(workspaceId)) return refuse('unauthorized')
        const existing = workspaces.get(workspaceId)
        if (existing?.valid) return existing.handle
        const handle = Object.freeze(Object.create(null)) as BrokerWorkspace
        const workspace: Workspace = { id: workspaceId, handle, valid: true, actors: new Map() }
        workspaces.set(workspaceId, workspace)
        workspaceHandles.set(handle, workspace)
        return handle
      },
      grantAgent: grant,
      revoke(capability: BrokerAgent) {
        const actor = actors.get(capability)
        if (actor) revoke(actor)
      },
      detach(handle: BrokerWorkspace) {
        const workspace = workspaceHandles.get(handle)
        if (!workspace?.valid) return
        workspace.valid = false
        for (const actor of workspace.actors.values()) revoke(actor)
        if (workspaces.get(workspace.id) === workspace) workspaces.delete(workspace.id)
      },
      invalidate() {
        unavailable('owner-invalidated')
        for (const workspace of workspaces.values()) {
          workspace.valid = false
          for (const actor of workspace.actors.values()) actor.valid = false
        }
      },
    }),
    status: () =>
      Object.freeze({
        available,
        executing: running.size > 0,
        awaitingQuiescence: uncertain.size > 0,
        unknownCalls: Object.freeze(
          [...uncertain].map((job) => callState(job, 'completion-unknown')),
        ),
      }),
  })
}
