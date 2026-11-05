import { randomUUID } from 'node:crypto'
import { createServer, type Server, type Socket } from 'node:net'
import { PluginFence } from '../state/fence'
import { SupervisorStorage } from './storage'
import type { DrainTrace } from './drain-trace'
import {
  compatible,
  OWNER_LIMITS,
  OWNER_WIRE,
  OWNER_RECOVERY,
  pack,
  PluginSupervisorError,
  refuse,
  Request,
  secret,
  unpack,
  type Command,
  type OwnerRecord,
  type StopReason,
  type WireVersion,
} from './protocol'

export interface WorkspaceLease {
  readonly id: string
  readonly workspace: string
  readonly generation: string
  readonly epoch: string
  readonly minor: number
  readonly features: readonly string[]
  counter: number
  /** The renewal that set counter; only that one may come again. */
  renewal?: string
  renewedAt: number
}
/** Supplied only by the trusted process host, never over workspace IPC. */
export interface OwnedPluginChild {
  /** Compatibility marker for non-process cleanup callbacks. These never hold the writer lock. */
  readonly inProcess?: true
  stop(): void | Promise<void>
  exited: Promise<void>
  /** Deprecated acknowledgement; actual exit comes from the captured process handle. */
  descendantsGone(): Promise<boolean>
}
export interface OwnerOptions {
  root: string
  workspaceRoots: readonly string[]
  wire?: WireVersion
  /** Must be monotonic, as performance.now is. */
  now?: () => number
  /** Revokes broker/UI authority before waiting for child exit. */
  revoke?: (lease: Readonly<WorkspaceLease>) => Promise<void>
  drainWithin?: number
  tickEvery?: number
  traceDrain?: (event: DrainTrace) => void
  /** Deprecated compatibility input. Synthetic cleanup failure no longer blocks the owner. */
  onBlockedWithoutProcesses?: () => void
}
const bounded = async <T>(work: Promise<T>, within: number): Promise<T | undefined> => {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      work,
      new Promise<undefined>((resolve) => {
        timer = setTimeout(() => resolve(undefined), within)
      }),
    ])
  } finally {
    clearTimeout(timer)
  }
}

/** Stop only the captured child. The actual exit event completes ownership, not stop's reply. */
async function stopOwnedChild(child: OwnedPluginChild): Promise<boolean> {
  notify(() => child.stop())
  try {
    await child.exited
    return true
  } catch {
    return false
  }
}

/** Consumer notifications are best effort; a UI acknowledgement cannot own a physical process. */
function notify(work: () => void | Promise<void>): void {
  void Promise.resolve()
    .then(work)
    .catch(() => undefined)
}

function drainWriteErrno(error: unknown): string {
  try {
    const code = (error as NodeJS.ErrnoException | null)?.code
    if (
      typeof code === 'string' &&
      /^(EACCES|EPERM|ENOENT|ENOSPC|EBUSY|EIO|EROFS|EMFILE|ENFILE|ENOMEM|EINVAL)$/.test(code)
    )
      return code
  } catch {
    /* An error's custom properties are not diagnostic authority. */
  }
  return 'UNKNOWN'
}

/** One service owner per selected root, serialized by the ordinary SQLite writer transaction. */
export class PluginSupervisor {
  private readonly leases = new Map<string, WorkspaceLease>()
  private readonly children = new Set<OwnedPluginChild>()
  private readonly starting = new Set<Promise<OwnedPluginChild>>()
  private readonly sockets = new Set<Socket>()
  private effectDrain?: { beginClose(): void; settled(): Promise<void> }
  private agentBridge?: {
    routes(
      lease: Readonly<WorkspaceLease>,
      request: Extract<Command, { kind: 'agent-routes' }>,
    ): Promise<unknown>
    /** The reply naming each plugin, for a lease that negotiated it. */
    agentRoutes?(
      lease: Readonly<WorkspaceLease>,
      request: Extract<Command, { kind: 'agent-routes' }>,
    ): Promise<unknown>
    revoke(lease: Readonly<WorkspaceLease>): void
    /** Lifecycle cleanup notification, independent of physical child exit. */
    close?(): Promise<void>
  }
  /** Only the trusted lifecycle bootstrap installs this agent-only command handler. */
  bindAgentBridge(bridge: NonNullable<PluginSupervisor['agentBridge']>): void {
    if (this.agentBridge) refuse()
    this.agentBridge = bridge
  }
  /** Queued filesystem effects settle before this owner releases its lifetime transaction. */
  bindLifecycleEffects(drain: { beginClose(): void; settled(): Promise<void> }): void {
    if (this.effectDrain || !this.fence || this.record.phase !== 'accepting') refuse()
    this.effectDrain = drain
  }
  /** Remaining wall-clock time in the owner's bounded cleanup, for trusted child teardown. */
  remainingDrainMs(): number {
    return this.drainDeadline === undefined
      ? (this.options.drainWithin ?? OWNER_LIMITS.cleanup)
      : Math.max(0, this.drainDeadline - performance.now())
  }
  private server: Server | undefined
  private timer: ReturnType<typeof setInterval> | undefined
  private drainWork: Promise<boolean> | undefined
  private drainDeadline: number | undefined
  private release!: () => void
  private releaseDone!: Promise<void>
  private stopped!: () => void
  readonly closed = new Promise<void>((resolve) => {
    this.stopped = resolve
  })
  private fence: PluginFence | undefined
  private readonly marker = {}
  private readonly now: () => number
  private lastTime: number
  private readonly born: number
  private constructor(
    private readonly storage: SupervisorStorage,
    private readonly options: OwnerOptions,
    private record: OwnerRecord,
  ) {
    this.now = options.now ?? (() => performance.now())
    this.lastTime = this.now()
    this.born = this.lastTime
  }
  static async start(options: OwnerOptions): Promise<PluginSupervisor> {
    const storage = new SupervisorStorage(options.root, options.workspaceRoots, true)
    const owner = new PluginSupervisor(storage, options, {
      version: 1,
      epoch: randomUUID(),
      key: secret(),
      phase: 'accepting',
      wire: options.wire ?? OWNER_WIRE,
    })
    try {
      owner.fence = PluginFence.acquire(storage.lock)
      // In-process callers share the connection. Fail busy instead of queuing a second owner
      // behind an indefinite lifetime transaction (including alternate paths to the same DB).
      owner.fence.sync(owner.marker, () => undefined)
      let held!: () => void
      const ready = new Promise<void>((resolve) => {
        held = resolve
      })
      const untilRelease = new Promise<void>((resolve) => {
        owner.release = resolve
      })
      owner.releaseDone = owner.fence.async(owner.marker, async () => {
        held()
        await untilRelease
      })
      await Promise.race([ready, owner.releaseDone])
      storage.clearSocket()
      storage.clearPersonSocket()
      owner.server = createServer((socket) => owner.accept(socket))
      await new Promise<void>((resolve, reject) => {
        owner.server!.once('error', reject)
        owner.server!.listen(storage.endpoint(owner.record), resolve)
      })
      storage.write(owner.record)
      owner.timer = setInterval(() => {
        void owner.tick().catch(() => owner.fail())
      }, options.tickEvery ?? 1_000)
      return owner
    } catch (error) {
      owner.server?.close()
      owner.release?.()
      await owner.releaseDone?.catch(() => undefined)
      owner.fence?.release()
      storage.close()
      if (error instanceof PluginSupervisorError) throw error
      if (error instanceof Error && 'code' in error && error.code === 'busy') refuse('busy')
      refuse()
    }
  }
  private fail(): boolean {
    this.record.phase = 'blocked'
    let published = false
    try {
      this.storage.write(this.record)
      published = true
    } catch (error) {
      /* Retain the lock even if the record cannot be updated. */
      this.trace({
        stage: 'blocked-write',
        state: 'failed',
        attempt: 1,
        errno: drainWriteErrno(error),
      })
    }
    clearInterval(this.timer)
    return published
  }
  private clock(): number {
    const current = this.now()
    if (!Number.isFinite(current) || current < this.lastTime) {
      this.fail()
      refuse()
    }
    this.lastTime = current
    return current
  }
  private accept(socket: Socket): void {
    this.sockets.add(socket)
    const deadline = setTimeout(() => socket.destroy(), OWNER_LIMITS.request)
    socket.on('close', () => {
      clearTimeout(deadline)
      this.sockets.delete(socket)
    })
    socket.on('error', () => socket.destroy())
    let bytes = Buffer.alloc(0),
      answered = false
    socket.on('data', (chunk: Buffer) => {
      if (answered) {
        socket.destroy()
        return
      }
      bytes = Buffer.concat([bytes, chunk])
      const end = bytes.indexOf(10)
      if (end < 0) return
      answered = true
      let request: Request
      try {
        if (end !== bytes.length - 1) refuse()
        request = Request.parse(unpack(this.record.key, 'request', bytes.toString('utf8', 0, end)))
        if (request.epoch !== this.record.epoch) refuse()
      } catch {
        socket.destroy()
        return
      }
      let result: unknown
      try {
        this.storage.check()
        if (request.command.kind === 'agent-routes') {
          const command = request.command
          this.expire()
          const lease = this.leases.get(command.lease)
          const hash = command.workspace
          const workspaceId = `${hash.slice(0, 8)}-${hash.slice(8, 12)}-5${hash.slice(13, 16)}-a${hash.slice(17, 20)}-${hash.slice(20, 32)}`
          if (
            !lease ||
            lease.workspace !== command.workspace ||
            lease.generation !== command.generation ||
            command.workspaceId !== workspaceId ||
            !this.valid(lease.id, lease.epoch) ||
            !this.agentBridge
          )
            refuse()
          const bridge = this.agentBridge
          const named = undefined as typeof bridge.agentRoutes
          void (named ?? bridge.routes.bind(bridge))(Object.freeze({ ...lease }), command)
            .then((value) =>
              named === undefined ? value : { format: 2, ...(value as Record<string, unknown>) },
            )
            .then((value) => {
              if (!this.valid(lease.id, lease.epoch)) refuse()
              socket.end(
                pack(this.record.key, 'response', {
                  nonce: request.nonce,
                  epoch: this.record.epoch,
                  ok: true,
                  value,
                }),
              )
            })
            .catch(() => {
              socket.end(
                pack(this.record.key, 'response', {
                  nonce: request.nonce,
                  epoch: this.record.epoch,
                  ok: false,
                  code: 'unavailable',
                }),
              )
            })
          return
        }
        result = { ok: true, value: this.command(request.command) }
      } catch (error) {
        result = {
          ok: false,
          code: error instanceof PluginSupervisorError ? error.code : 'unavailable',
          ...(error instanceof PluginSupervisorError &&
          error.diagnostic &&
          request.command.kind === 'hello' &&
          request.command.wire.features.includes(OWNER_RECOVERY)
            ? { diagnostic: error.diagnostic }
            : {}),
        }
      }
      socket.end(
        pack(this.record.key, 'response', {
          nonce: request.nonce,
          epoch: this.record.epoch,
          ...(result as object),
        }),
      )
      // Never await a drain inside its own release socket; close must be able to finish.
      if (this.record.phase === 'draining') void this.drain()
    })
  }
  private command(command: Command): unknown {
    if (command.kind === 'probe') return { phase: this.record.phase }
    this.expire()
    if (this.record.phase !== 'accepting')
      refuse('busy', {
        phase: this.record.phase,
        stage: 'hello',
        probe: 'live',
        reason: 'unknown',
      })
    const now = this.clock()
    if (command.kind === 'hello') {
      const negotiated = compatible(this.record.wire, command.wire)
      if (!negotiated) refuse('incompatible')
      const duplicate = [...this.leases.values()].some(
        (lease) => lease.workspace === command.workspace,
      )
      if (duplicate)
        refuse('busy', {
          phase: 'accepting',
          stage: 'hello',
          probe: 'live',
          reason: 'duplicate-workspace',
        })
      const lease: WorkspaceLease = {
        id: secret(),
        workspace: command.workspace,
        generation: command.generation,
        epoch: this.record.epoch,
        ...negotiated,
        counter: 0,
        renewedAt: now,
      }
      this.leases.set(lease.id, lease)
      return {
        lease: lease.id,
        minor: lease.minor,
        features: lease.features,
        heartbeat: OWNER_LIMITS.heartbeat,
        expires: OWNER_LIMITS.expires,
      }
    }
    const lease = this.leases.get(command.lease)
    if (!lease || lease.workspace !== command.workspace || lease.generation !== command.generation)
      refuse()
    if (command.kind === 'renew') {
      // The next renewal, or the last request again after a lost reply. Counters correlate
      // retries within the current workspace registration; they are not admission proofs.
      const retry =
        command.renewal !== undefined &&
        command.counter === lease.counter &&
        command.renewal === lease.renewal
      if (!retry && command.counter !== lease.counter + 1) refuse()
      lease.counter = command.counter
      lease.renewal = command.renewal
      lease.renewedAt = now
      return { counter: lease.counter }
    }
    this.remove(lease, 'released')
    return { remaining: this.leases.size > 0 }
  }
  private drainFor(reason: StopReason): void {
    this.record.phase = 'draining'
    try {
      this.storage.writeStop({ epoch: this.record.epoch, reason })
    } catch {
      /* The reason is for reading afterwards; it never holds up the drain. */
    }
    try {
      this.storage.write(this.record)
    } catch {
      /* Discovery IO must not cancel actual child teardown. */
    }
  }
  private remove(lease: WorkspaceLease, reason: StopReason): void {
    this.leases.delete(lease.id)
    notify(() => this.agentBridge?.revoke(lease))
    notify(() => this.options.revoke?.(Object.freeze({ ...lease })))
    if (this.leases.size === 0) this.drainFor(reason)
  }
  private expire(): void {
    if (this.record.phase !== 'accepting') return
    const now = this.clock()
    for (const lease of this.leases.values())
      if (now - lease.renewedAt >= OWNER_LIMITS.expires) this.remove(lease, 'lease-expired')
  }
  /** Consumers recheck this on dispatch; expiry never resurrects an old capability. */
  valid(id: string, epoch: string): boolean {
    this.expire()
    return this.record.phase === 'accepting' && epoch === this.record.epoch && this.leases.has(id)
  }
  adopt(child: OwnedPluginChild): void {
    this.expire()
    if (this.record.phase !== 'accepting' || this.leases.size === 0) refuse()
    this.children.add(child)
    // Keep the captured handle for shutdown; never reconstruct a process from saved PIDs.
    void child.exited.catch(() => undefined)
  }
  /** A start reservation keeps the writer until the host returns its actual handle or rejects. */
  /** Trusted in-process controller only, not an IPC command. */
  acceptsStarts(): boolean {
    this.expire()
    return this.record.phase === 'accepting' && this.leases.size > 0
  }
  async startChild(start: () => Promise<OwnedPluginChild>): Promise<OwnedPluginChild> {
    this.expire()
    if (this.record.phase !== 'accepting' || this.leases.size === 0) refuse()
    const pending = Promise.resolve()
      .then(start)
      .then((child) => {
        this.children.add(child)
        void child.exited.catch(() => undefined)
        return child
      })
    this.starting.add(pending)
    try {
      return await pending
    } finally {
      this.starting.delete(pending)
    }
  }
  async tick(): Promise<void> {
    this.expire()
    if (
      this.record.phase === 'accepting' &&
      this.leases.size === 0 &&
      this.clock() - this.born >= OWNER_LIMITS.expires
    )
      this.drainFor('drain')
    if (this.record.phase === 'draining') await this.drain()
  }
  private drain(): Promise<boolean> {
    this.drainWork ??= (async () => {
      this.trace({ stage: 'child-proofs', state: 'waiting' })
      this.drainDeadline = performance.now() + (this.options.drainWithin ?? OWNER_LIMITS.cleanup)
      this.effectDrain?.beginClose()
      notify(() => this.agentBridge?.close?.())
      // A host reserves before spawning and must return/register a handle for every physical
      // child it creates. A rejection with no handle is an ordinary plugin start failure.
      await Promise.allSettled([...this.starting])
      const physical: OwnedPluginChild[] = []
      for (const child of this.children) {
        if (child.inProcess) notify(() => child.stop())
        else physical.push(child)
      }
      const result = await Promise.all(physical.map(stopOwnedChild))
      if (!result.every(Boolean)) {
        this.trace({ stage: 'child-proofs', state: 'failed' })
        this.fail()
        return false
      }
      await this.effectDrain?.settled()
      this.trace({ stage: 'child-proofs', state: 'complete' })
      this.trace({ stage: 'server.close', state: 'waiting' })
      await new Promise<void>((resolve) => this.server!.close(() => resolve()))
      this.trace({ stage: 'server.close', state: 'complete' })
      // Discovery publication is informational. Once the actual children are gone, a failed
      // record write must not keep a zero-child service holding the writer indefinitely.
      this.trace({ stage: 'stopped-write', state: 'waiting', attempt: 1 })
      try {
        this.storage.write({ ...this.record, phase: 'stopped' })
        this.trace({ stage: 'stopped-write', state: 'complete', attempt: 1 })
      } catch (error) {
        this.trace({
          stage: 'stopped-write',
          state: 'failed',
          attempt: 1,
          errno: drainWriteErrno(error),
        })
      }
      clearInterval(this.timer)
      this.record.phase = 'stopped'
      this.release()
      await this.releaseDone
      this.fence!.release()
      this.storage.close()
      this.trace({ stage: 'closed', state: 'complete' })
      this.stopped()
      return true
    })().catch(() => {
      this.fail()
      return false
    })
    // A caller deadline ends its wait; actual child exit work continues under the same writer.
    return bounded(this.drainWork, this.options.drainWithin ?? OWNER_LIMITS.drain).then(
      (result) => result === true,
    )
  }
  private trace(event: DrainTrace): void {
    try {
      this.options.traceDrain?.(event)
    } catch {
      /* Diagnostics cannot change the drain. */
    }
  }
  async shutdown(): Promise<boolean> {
    if (this.record.phase === 'stopped') return true
    if (this.record.phase === 'blocked') return false
    for (const lease of this.leases.values()) this.remove(lease, 'shutdown')
    if (this.record.phase === 'accepting') this.drainFor('shutdown')
    return this.drain()
  }
}
