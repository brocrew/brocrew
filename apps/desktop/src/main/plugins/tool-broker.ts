import { collidingToolNames, externalMcpNameRefusal } from '../../shared/external-mcp'
import { pluginSha256 } from './package-digests'
import { strictPluginJson } from './strict-json'
import type {
  BrokerAgent,
  BrokerAudit,
  BrokerClock,
  BrokerFailure,
  BrokerIdentity,
  BrokerInput,
  BrokerOptions,
  BrokerPerson,
  BrokerReply,
  BrokerRequest,
  BrokerValue,
  BrokerWorkspace,
  PluginExecution,
  PluginToolBroker,
  PublishedBrokerTool,
  ResourceUse,
} from './tool-broker-types'
export type * from './tool-broker-types'

export const PLUGIN_BROKER_LIMITS = Object.freeze({
  total: 64,
  workspace: 8,
  agent: 2,
  queueMs: 120_000,
  callMs: 120_000,
  cancelProofMs: 1000,
  inputBytes: 64 * 1024,
  outputBytes: 8 * 1024 * 1024,
})
const failureCodes = new Set<BrokerFailure>([
  'invalid',
  'unauthorized',
  'unavailable',
  'denied',
  'busy',
  'cancelled',
  'deadline',
  'downstream',
])
const errorCodes = new WeakMap<object, BrokerFailure>()
export class PluginBrokerError extends Error {
  readonly code: BrokerFailure
  constructor(code: BrokerFailure) {
    code = failureCodes.has(code) ? code : 'invalid'
    super(code === 'busy' ? 'Plugin busy. Try again.' : 'Plugin unavailable. Try again.')
    this.name = 'PluginBrokerError'
    this.code = code
    errorCodes.set(this, code)
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
function frozen<T>(value: T): T {
  if (value !== null && typeof value === 'object') {
    Object.values(value).forEach(frozen)
    Object.freeze(value)
  }
  return value
}
function data(value: unknown, max: number): BrokerValue {
  const encoded = JSON.stringify(value)
  if (encoded === undefined) return refuse('invalid')
  return frozen(strictPluginJson(Buffer.from(encoded), max) as BrokerValue)
}
function input(value: unknown): BrokerInput {
  const copy = data(value, PLUGIN_BROKER_LIMITS.inputBytes)
  if (copy === null || typeof copy !== 'object' || Array.isArray(copy)) return refuse('invalid')
  return copy as BrokerInput
}
const defaultClock: BrokerClock = {
  now: () => performance.now(),
  after: (ms, callback) => {
    const timer = setTimeout(callback, ms)
    timer.unref?.()
    return () => clearTimeout(timer)
  },
}
interface Workspace {
  readonly id: string
  readonly handle: BrokerWorkspace
  valid: boolean
  readonly actors: Map<string, Actor>
}
interface Actor {
  readonly workspace: Workspace
  readonly handle: BrokerAgent | BrokerPerson
  readonly identity: BrokerIdentity
  readonly key: string
  valid: boolean
}
interface Job {
  readonly actor: Actor
  readonly operation: 'tool' | 'admin'
  readonly name: string
  readonly input: BrokerInput
  readonly queuedAt: number
  readonly resolve: (value: BrokerValue) => void
  readonly reject: (error: PluginBrokerError) => void
  readonly controller: AbortController
  offQueue: () => void
  offCall: () => void
  offProof: () => void
  offSignal: () => void
  state: 'queued' | 'running' | 'finished'
  answered: boolean
  cancelling: boolean
  startedAt: number
  proofUntil: number
  execution?: PluginExecution
  quiet: boolean
  cancelSent: boolean
  reply?: BrokerReply
}
interface Queue {
  readonly actors: Map<string, Job[]>
  readonly ring: string[]
}
const nothing = (): void => {}

/** One installed release/epoch. Only its owner can mint local attachment capabilities. */
export function createPluginToolBroker(options: BrokerOptions): PluginToolBroker {
  try {
    return makeBroker(options)
  } catch {
    return refuse('invalid')
  }
}
function makeBroker(options: BrokerOptions): PluginToolBroker {
  const binding = frozen({
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
  const tools = new Map(
    options.tools.map((tool) => [
      tool.name,
      Object.freeze({ ...tool, inputSchema: input(tool.inputSchema) }),
    ]),
  )
  const offered = options.tools.map((tool) => tool.name)
  const admin = new Set(options.adminOperations)
  if (
    tools.size !== offered.length ||
    admin.size !== options.adminOperations.length ||
    new Set(offered.map(fold)).size !== offered.length ||
    collidingToolNames(offered, options.hostToolNames).length > 0
  )
    return refuse('invalid')
  const occupied = new Set(options.occupiedQualifiedNames.map(fold))
  for (const name of [...offered, ...admin]) {
    if (!/^[a-zA-Z][a-zA-Z0-9_-]{0,63}$/.test(name)) return refuse('invalid')
    if (tools.has(name) && admin.has(name)) return refuse('invalid')
  }
  const published = frozen(
    [...tools.values()].map((tool): PublishedBrokerTool => {
      const qualifiedName = `${namespace}__${tool.name}`
      if (
        occupied.has(fold(qualifiedName)) ||
        typeof tool.description !== 'string' ||
        tool.description.length > 2000
      )
        return refuse('invalid')
      return {
        namespace,
        qualifiedName,
        name: tool.name,
        description: tool.description,
        inputSchema: tool.inputSchema,
      }
    }),
  )
  const resources = new Map(
    options.resources.map((resource) => [resource.id, Object.freeze({ ...resource })]),
  )
  if (
    [...resources.values()].some(
      (resource) => typeof resource.read !== 'boolean' || typeof resource.write !== 'boolean',
    )
  )
    return refuse('invalid')
  if (
    resources.size !== options.resources.length ||
    [...resources.keys()].some((id) => !identifier(id))
  )
    return refuse('invalid')
  const clock = options.clock ?? defaultClock
  const server = {
    tool: options.server.tool.bind(options.server),
    admin: options.server.admin.bind(options.server),
  }
  const allowed = options.isAllowed
  const audit = options.audit
  const workspaceHandles = new WeakMap<object, Workspace>()
  const actors = new WeakMap<object, Actor>()
  const workspaces = new Map<string, Workspace>()
  const queues = new Map<string, Queue>()
  const ring: string[] = []
  const lastActor = new Map<string, string>()
  let lastWorkspace = ''
  let count = 0
  let active: Job | undefined
  let available = true
  let scheduled = false

  function log(
    event: BrokerAudit['event'],
    operation: Job['operation'],
    code?: BrokerFailure,
  ): void {
    try {
      audit?.(Object.freeze({ event, operation, queued: count, ...(code ? { code } : {}) }))
    } catch {
      /* Diagnostics cannot affect admission or expose an upstream error. */
    }
  }
  function identity(capability: object, kind: Actor['identity']['kind']): Actor {
    const actor = actors.get(capability)
    if (!available) return refuse('unavailable')
    if (!actor || !actor.valid || !actor.workspace.valid || actor.identity.kind !== kind)
      return refuse('unauthorized')
    return actor
  }
  function valid(job: Job): boolean {
    return available && job.actor.valid && job.actor.workspace.valid
  }
  function answer(job: Job, value: BrokerValue | undefined, code?: BrokerFailure): void {
    if (job.answered) return
    job.answered = true
    job.offSignal()
    if (code) job.reject(new PluginBrokerError(code))
    else job.resolve(value ?? null)
  }
  function remove(job: Job): void {
    const workspace = job.actor.workspace.id
    const queue = queues.get(workspace)
    const jobs = queue?.actors.get(job.actor.key)
    if (!queue || !jobs) return
    const index = jobs.indexOf(job)
    if (index < 0) return
    jobs.splice(index, 1)
    count--
    if (jobs.length === 0) {
      queue.actors.delete(job.actor.key)
      queue.ring.splice(queue.ring.indexOf(job.actor.key), 1)
    }
    if (queue.ring.length === 0) {
      queues.delete(workspace)
      ring.splice(ring.indexOf(workspace), 1)
    }
  }
  function finished(job: Job): void {
    if (job.state === 'finished') return
    job.offQueue()
    job.offCall()
    job.offProof()
    job.offSignal()
    job.state = 'finished'
    if (active === job) active = undefined
    log('finished', job.operation)
    schedule()
  }
  function drop(job: Job, code: BrokerFailure): void {
    remove(job)
    answer(job, undefined, code)
    finished(job)
  }
  function unavailable(operation: Job['operation']): void {
    if (!available) return
    available = false
    log('unavailable', operation, 'unavailable')
    const waiting = [...queues.values()].flatMap((q) => [...q.actors.values()].flat())
    for (const job of waiting) drop(job, 'unavailable')
    if (active) stop(active, 'unavailable')
  }
  function settle(job: Job): void {
    if (job.state !== 'running') return
    if (job.cancelling) {
      if (!job.quiet) return
      if (clock.now() >= job.proofUntil) unavailable(job.operation)
      finished(job)
    } else if (clock.now() >= job.startedAt + PLUGIN_BROKER_LIMITS.callMs) stop(job, 'deadline')
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
      void Promise.resolve(job.execution.cancel()).catch(() => unavailable(job.operation))
    } catch {
      unavailable(job.operation)
    }
  }
  function stop(job: Job, code: BrokerFailure): void {
    if (job.state === 'finished') return
    if (job.state === 'queued') {
      drop(job, code)
      return
    }
    answer(job, undefined, code)
    if (job.cancelling) return
    job.cancelling = true
    job.offCall()
    job.proofUntil = clock.now() + PLUGIN_BROKER_LIMITS.cancelProofMs
    if (job.quiet) {
      finished(job)
      return
    }
    job.offProof = clock.after(PLUGIN_BROKER_LIMITS.cancelProofMs, () => unavailable(job.operation))
    job.controller.abort()
    requestCancel(job)
  }
  function claims(job: Job): { input: BrokerInput; resources: readonly ResourceUse[] } {
    if (job.operation === 'admin') return { input: job.input, resources: [] }
    const prepared = tools.get(job.name)!.prepare(job.input)
    if (!Array.isArray(prepared.resources) || prepared.resources.length > 128)
      return refuse('denied')
    const normalized = input(prepared.input)
    const uses = prepared.resources.map((use): ResourceUse => {
      const { resource, key, mode } = use
      if (!identifier(resource) || !identifier(key) || (mode !== 'read' && mode !== 'write'))
        return refuse('denied')
      return Object.freeze({ resource, key, mode })
    })
    for (const use of uses) {
      const resource = resources.get(use.resource)
      if (!resource || resource[use.mode] !== true || allowed(job.actor.identity, use) !== true)
        return refuse('denied')
    }
    return { input: normalized, resources: Object.freeze(uses) }
  }
  function start(job: Job): void {
    if (job.state !== 'queued') return
    if (!valid(job)) {
      drop(job, 'unauthorized')
      return
    }
    if (clock.now() >= job.queuedAt + PLUGIN_BROKER_LIMITS.queueMs) {
      drop(job, 'deadline')
      return
    }
    let prepared: ReturnType<typeof claims>
    try {
      prepared = claims(job)
    } catch {
      drop(job, 'denied')
      return
    }
    if (job.state !== 'queued') return
    if (!valid(job)) {
      drop(job, 'unauthorized')
      return
    }
    if (clock.now() >= job.queuedAt + PLUGIN_BROKER_LIMITS.queueMs) {
      drop(job, 'deadline')
      return
    }
    job.offQueue()
    job.state = 'running'
    job.startedAt = clock.now()
    active = job
    job.offCall = clock.after(PLUGIN_BROKER_LIMITS.callMs, () => stop(job, 'deadline'))
    const request: BrokerRequest = Object.freeze({
      identity: job.actor.identity,
      name: job.name,
      input: prepared.input,
      resources: prepared.resources,
    })
    try {
      job.execution =
        job.operation === 'tool'
          ? server.tool(request, job.controller.signal)
          : server.admin(request, job.controller.signal)
      if (
        !job.execution ||
        typeof job.execution.cancel !== 'function' ||
        typeof job.execution.result?.then !== 'function' ||
        typeof job.execution.quiescent?.then !== 'function'
      )
        throw new Error()
      if (job.cancelling) requestCancel(job)
      log('started', job.operation)
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
                ? {
                    ok: true,
                    value: data(
                      (reply as { ok: true; value: unknown }).value,
                      PLUGIN_BROKER_LIMITS.outputBytes,
                    ),
                  }
                : { ok: false }
              settle(job)
            } catch {
              stop(job, 'downstream')
            }
          },
          () => stop(job, 'downstream'),
        )
        .catch(() => unavailable(job.operation))
      void Promise.resolve(job.execution.quiescent)
        .then(
          () => {
            job.quiet = true
            settle(job)
          },
          () => unavailable(job.operation),
        )
        .catch(() => unavailable(job.operation))
    } catch {
      unavailable(job.operation)
    }
  }
  function take(): Job | undefined {
    if (ring.length > 1 && ring[0] === lastWorkspace) ring.push(ring.shift()!)
    const workspace = ring[0]
    if (workspace === undefined) return undefined
    const queue = queues.get(workspace)!
    if (queue.ring.length > 1 && queue.ring[0] === lastActor.get(workspace))
      queue.ring.push(queue.ring.shift()!)
    const actor = queue.ring[0]!
    const job = queue.actors.get(actor)![0]!
    remove(job)
    if (queues.has(workspace)) ring.push(ring.shift()!)
    const remaining = queue.actors.get(actor)
    if (remaining) queue.ring.push(queue.ring.shift()!)
    lastWorkspace = workspace
    lastActor.set(workspace, actor)
    return job
  }
  function schedule(): void {
    if (scheduled || active || !available) return
    scheduled = true
    queueMicrotask(() => {
      scheduled = false
      if (active || !available) return
      const job = take()
      if (job) start(job)
    })
  }
  function submit(
    capability: object,
    kind: 'agent' | 'person',
    operation: Job['operation'],
    name: string,
    supplied: BrokerInput,
    signal?: AbortSignal,
  ): Promise<BrokerValue> {
    return new Promise((resolve, reject) => {
      let actor: Actor, copy: BrokerInput
      try {
        actor = identity(capability, kind)
        if (
          (operation === 'tool' && !tools.has(name)) ||
          (operation === 'admin' && !admin.has(name))
        )
          return refuse('denied')
        copy = input(supplied)
        identity(capability, kind)
        if (signal?.aborted) return refuse('cancelled')
        const q = queues.get(actor.workspace.id)
        const workspaceCount = q
          ? [...q.actors.values()].reduce((n, jobs) => n + jobs.length, 0)
          : 0
        if (
          count >= PLUGIN_BROKER_LIMITS.total ||
          workspaceCount >= PLUGIN_BROKER_LIMITS.workspace ||
          (q?.actors.get(actor.key)?.length ?? 0) >= PLUGIN_BROKER_LIMITS.agent
        )
          return refuse('busy')
      } catch (error) {
        const code =
          error !== null && typeof error === 'object'
            ? (errorCodes.get(error) ?? 'invalid')
            : 'invalid'
        log('refused', operation, code)
        reject(new PluginBrokerError(code))
        return
      }
      const job: Job = {
        actor,
        operation,
        name,
        input: copy,
        queuedAt: clock.now(),
        resolve,
        reject,
        controller: new AbortController(),
        offQueue: nothing,
        offCall: nothing,
        offProof: nothing,
        offSignal: nothing,
        state: 'queued',
        answered: false,
        cancelling: false,
        startedAt: 0,
        proofUntil: 0,
        quiet: false,
        cancelSent: false,
      }
      const cancel = (): void => stop(job, 'cancelled')
      signal?.addEventListener('abort', cancel, { once: true })
      job.offSignal = () => signal?.removeEventListener('abort', cancel)
      job.offQueue = clock.after(PLUGIN_BROKER_LIMITS.queueMs, () => stop(job, 'deadline'))
      let q = queues.get(actor.workspace.id)
      if (!q) {
        q = { actors: new Map(), ring: [] }
        queues.set(actor.workspace.id, q)
        ring.push(actor.workspace.id)
      }
      let jobs = q.actors.get(actor.key)
      if (!jobs) {
        jobs = []
        q.actors.set(actor.key, jobs)
        q.ring.push(actor.key)
      }
      jobs.push(job)
      count++
      log('queued', operation)
      schedule()
    })
  }
  function revoke(actor: Actor): void {
    actor.valid = false
    for (const queue of [...queues.values()])
      for (const jobs of [...queue.actors.values()])
        for (const job of [...jobs]) if (job.actor === actor) stop(job, 'unauthorized')
    if (active?.actor === actor) stop(active, 'unauthorized')
  }
  function grant(
    handle: BrokerWorkspace,
    incarnation: string,
    kind: 'agent' | 'person',
  ): BrokerAgent | BrokerPerson {
    const workspace = workspaceHandles.get(handle)
    if (!available || !workspace?.valid || !identifier(incarnation)) return refuse('unauthorized')
    const key = `${kind}:${incarnation}`
    const existing = workspace.actors.get(key)
    if (existing) {
      if (existing.valid) return existing.handle
      return refuse('unauthorized')
    }
    const capability = Object.freeze(Object.create(null)) as BrokerAgent | BrokerPerson
    const actor: Actor = {
      workspace,
      handle: capability,
      key,
      valid: true,
      identity: Object.freeze({ ...binding, workspaceId: workspace.id, kind, incarnation }),
    }
    workspace.actors.set(key, actor)
    actors.set(capability, actor)
    return capability
  }
  return Object.freeze({
    agent: Object.freeze({
      discover(capability: BrokerAgent) {
        identity(capability, 'agent')
        return published
      },
      call(
        capability: BrokerAgent,
        qualifiedName: string,
        args: BrokerInput,
        signal?: AbortSignal,
      ) {
        const name = published.find((tool) => tool.qualifiedName === qualifiedName)?.name ?? ''
        return submit(capability, 'agent', 'tool', name, args, signal)
      },
    }),
    person: Object.freeze({
      call: (
        capability: BrokerPerson,
        operation: string,
        args: BrokerInput,
        signal?: AbortSignal,
      ) => submit(capability, 'person', 'admin', operation, args, signal),
    }),
    owner: Object.freeze({
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
      grantAgent: (workspace: BrokerWorkspace, incarnation: string) =>
        grant(workspace, incarnation, 'agent') as BrokerAgent,
      grantPerson: (workspace: BrokerWorkspace, incarnation: string) =>
        grant(workspace, incarnation, 'person') as BrokerPerson,
      revoke(capability: BrokerAgent | BrokerPerson) {
        const actor = actors.get(capability)
        if (actor) revoke(actor)
      },
      detach(handle: BrokerWorkspace) {
        const workspace = workspaceHandles.get(handle)
        if (!workspace?.valid) return
        workspace.valid = false
        for (const actor of workspace.actors.values()) revoke(actor)
        if (workspaces.get(workspace.id) === workspace) workspaces.delete(workspace.id)
        lastActor.delete(workspace.id)
      },
      invalidate() {
        unavailable('tool')
        for (const workspace of workspaces.values()) {
          workspace.valid = false
          for (const actor of workspace.actors.values()) actor.valid = false
        }
      },
    }),
    status: () =>
      Object.freeze({
        available,
        queued: count,
        executing: active !== undefined,
        awaitingQuiescence: active?.cancelling === true && !active.quiet,
      }),
  })
}
