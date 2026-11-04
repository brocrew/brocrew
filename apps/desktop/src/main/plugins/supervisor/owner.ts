import { randomUUID } from 'node:crypto'
import { chmodSync, lstatSync } from 'node:fs'
import { createServer, type Server, type Socket } from 'node:net'
import { PluginFence } from '../state/fence'
import { SupervisorStorage } from './storage'
import { isSocketFile } from '../local-endpoint'
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
  /** Trusted in-process consumers only. Omitted means a physical process/descendant obligation. */
  readonly inProcess?: true
  stop(): void | Promise<void>
  exited: Promise<void>
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
  /** Trusted standalone bootstrap only. Runs inside the unchanged predecessor fence. */
  recoverPrevious?: (previous: OwnerRecord | null) => Promise<boolean>
  traceDrain?: (event: DrainTrace) => void
  /** Standalone bootstrap only: exit synchronously with the fence still held. Never admission. */
  onBlockedWithoutProcesses?: () => void
}
declare global {
  var __brobotPluginOwnersV1: Set<string> | undefined
}
const owners = (globalThis.__brobotPluginOwnersV1 ??= new Set<string>())
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

/** A stop attempt is not exit evidence, and no child can skip another child's cleanup. */
async function stopAndProveChild(child: OwnedPluginChild): Promise<boolean> {
  const exited = Promise.resolve()
    .then(() => child.exited)
    .then(
      () => true,
      () => false,
    )
  const stopped = Promise.resolve()
    .then(() => child.stop())
    .catch(() => undefined)
  // Even a rejected exit witness still runs the descendant check. Wait for an actual exit
  // before probing a healthy child so a process still shutting down is not counted as a leak.
  const descendantsGone = exited.then(() =>
    Promise.resolve()
      .then(() => child.descendantsGone())
      .then(
        (gone) => gone === true,
        () => false,
      ),
  )
  const [, didExit, areGone] = await Promise.all([stopped, exited, descendantsGone])
  return didExit && areGone
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

/** Single process-tree owner. A successor proves every prior run under the same OS fence. */
export class PluginSupervisor {
  private readonly leases = new Map<string, WorkspaceLease>()
  private readonly children = new Set<OwnedPluginChild>()
  private readonly starting = new Set<Promise<OwnedPluginChild>>()
  private readonly sockets = new Set<Socket>()
  private readonly revocations = new Set<Promise<void>>()
  private agentBridge?: {
    routes(
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
  /** Remaining wall-clock time in the owner's bounded cleanup, for trusted child teardown. */
  remainingDrainMs(): number {
    return this.drainDeadline === undefined
      ? (this.options.drainWithin ?? OWNER_LIMITS.cleanup)
      : Math.max(0, this.drainDeadline - performance.now())
  }
  private revocationFailed = false
  private startFailed = false
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
    if (owners.has(storage.identity)) {
      storage.close()
      refuse('busy')
    }
    owners.add(storage.identity)
    const owner = new PluginSupervisor(storage, options, {
      version: 1,
      epoch: randomUUID(),
      key: secret(),
      phase: 'accepting',
      wire: options.wire ?? OWNER_WIRE,
    })
    try {
      let existingLock = false
      try {
        lstatSync(storage.lock)
        existingLock = true
      } catch (error) {
        if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error
      }
      owner.fence = PluginFence.acquire(storage.lock)
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
      const previous = storage.read()
      if ((!previous && existingLock) || (previous && previous.phase !== 'stopped')) {
        owner.fence.check(storage.lock)
        if (!(await options.recoverPrevious?.(previous))) refuse('cleanup-pending')
        owner.fence.check(storage.lock)
        storage.check()
        if (previous) storage.write({ ...previous, phase: 'stopped' })
      }
      storage.clearSocket()
      owner.server = createServer((socket) => owner.accept(socket))
      await new Promise<void>((resolve, reject) => {
        owner.server!.once('error', reject)
        owner.server!.listen(storage.endpoint(owner.record), resolve)
      })
      if (isSocketFile()) chmodSync(storage.socket, 0o600)
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
      owners.delete(storage.identity)
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
  private async publishBlockedBeforeExit(): Promise<void> {
    let attempt = 1
    for (;;) {
      attempt++
      try {
        this.trace({ stage: 'blocked-write', state: 'waiting', attempt })
        this.storage.write(this.record)
        this.trace({ stage: 'blocked-write', state: 'complete', attempt })
        return
      } catch (error) {
        this.trace({
          stage: 'blocked-write',
          state: 'failed',
          attempt,
          errno: drainWriteErrno(error),
        })
        await new Promise((resolve) => setTimeout(resolve, 1000))
      }
    }
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
    if (this.sockets.size >= 64) {
      socket.destroy()
      return
    }
    this.sockets.add(socket)
    const deadline = setTimeout(() => socket.destroy(), OWNER_LIMITS.request)
    socket.on('close', () => {
      clearTimeout(deadline)
      this.sockets.delete(socket)
    })
    socket.on('error', () => socket.destroy())
    const challenge = secret()
    socket.write(`${JSON.stringify({ challenge })}\n`)
    let bytes = Buffer.alloc(0),
      answered = false
    socket.on('data', (chunk: Buffer) => {
      if (answered) {
        socket.destroy()
        return
      }
      bytes = Buffer.concat([bytes, chunk])
      if (bytes.length > OWNER_LIMITS.packet) {
        socket.destroy()
        return
      }
      const end = bytes.indexOf(10)
      if (end < 0) return
      answered = true
      let request: Request
      try {
        if (end !== bytes.length - 1) refuse()
        request = Request.parse(unpack(this.record.key, 'request', bytes.toString('utf8', 0, end)))
        if (request.epoch !== this.record.epoch || request.challenge !== challenge) refuse()
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
          void bridge
            .routes(Object.freeze({ ...lease }), command)
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
        reason: 'proof-pending',
      })
    const now = this.clock()
    if (command.kind === 'hello') {
      const negotiated = compatible(this.record.wire, command.wire)
      if (!negotiated) refuse('incompatible')
      const duplicate = [...this.leases.values()].some(
        (lease) => lease.workspace === command.workspace,
      )
      if (duplicate || this.leases.size >= OWNER_LIMITS.leases)
        refuse('busy', {
          phase: 'accepting',
          stage: 'hello',
          probe: 'live',
          reason: duplicate ? 'duplicate-workspace' : 'capacity',
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
      // The next renewal, or the last one again when its reply was lost. The fresh challenge
      // proves a retry is not a captured packet; an older counter, or another renewal under
      // the last counter, is refused. A renew without a renewal, as a client without
      // RENEW_RETRY sends it, can only be the next counter.
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
    this.storage.write(this.record)
  }
  private remove(lease: WorkspaceLease, reason: StopReason): void {
    this.leases.delete(lease.id)
    try {
      this.agentBridge?.revoke(lease)
    } catch {
      this.revocationFailed = true
    }
    const work: Promise<void> = Promise.resolve()
      .then(() => this.options.revoke?.(Object.freeze({ ...lease })))
      .then(() => undefined)
      .catch(() => {
        this.revocationFailed = true
      })
      .finally(() => this.revocations.delete(work))
    this.revocations.add(work)
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
    // Retain the witness until drain: parent exit alone is not descendant-exit proof.
  }
  /** Reserve the drain barrier before an asynchronous host can start a child. */
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
      .then(
        (child) => {
          this.children.add(child)
          return child
        },
        () => {
          // A rejected asynchronous start is not evidence that it left no descendant behind.
          // Keep this negative proof after the settled promise leaves the pending set.
          this.startFailed = true
          this.fail()
          refuse('cleanup-pending')
        },
      )
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
      void Promise.resolve()
        .then(() => this.agentBridge?.close?.())
        .catch(() => {
          // Cleanup notification cannot hold or replace actual physical child drain.
        })
      const result = await (async () => {
        if ((await bounded(Promise.all(this.revocations), this.remainingDrainMs())) === undefined)
          this.revocationFailed = true
        await Promise.all(this.starting)
        return Promise.all(
          [...this.children].map(async (child) => ({
            inProcess: child.inProcess === true,
            // A consumer timeout is not exit proof. Only actual process death can end its work,
            // and self-exit still requires separate positive proof for every physical child.
            proven:
              child.inProcess === true
                ? (await bounded(stopAndProveChild(child), this.remainingDrainMs())) === true
                : await stopAndProveChild(child),
          })),
        )
      })().catch(() => undefined)
      if (
        !result ||
        this.startFailed ||
        this.revocationFailed ||
        !result.every((child) => child.proven)
      ) {
        this.trace({ stage: 'child-proofs', state: 'failed' })
        const published = this.fail()
        // A failed consumer can leave this process's own async work unresolved. Do not unlock
        // and let a successor overlap it. Only process death ends that work and releases the OS
        // fence. Every physical child must still supply its exact exit and descendant proof.
        // A rejected/unfinished start or an unknown physical witness never reaches this seam.
        if (
          this.options.onBlockedWithoutProcesses &&
          !this.startFailed &&
          result?.every((child) => child.inProcess || child.proven)
        ) {
          // A sharing refusal must not turn a blocked owner into a durable draining record.
          // Retain the same fence and all physical proofs until publication succeeds.
          if (!published) await this.publishBlockedBeforeExit()
          this.options.onBlockedWithoutProcesses()
        }
        return false
      }
      this.trace({ stage: 'child-proofs', state: 'complete' })
      this.trace({ stage: 'server.close', state: 'waiting' })
      await new Promise<void>((resolve) => this.server!.close(() => resolve()))
      this.trace({ stage: 'server.close', state: 'complete' })
      // The proofs already arrived. Retain the same fence until their durable publication succeeds.
      let attempt = 0
      for (;;) {
        attempt++
        try {
          this.trace({ stage: 'stopped-write', state: 'waiting', attempt })
          this.storage.write({ ...this.record, phase: 'stopped' })
          this.trace({ stage: 'stopped-write', state: 'complete', attempt })
          break
        } catch (error) {
          this.trace({
            stage: 'stopped-write',
            state: 'failed',
            attempt,
            errno: drainWriteErrno(error),
          })
          await new Promise((resolve) => setTimeout(resolve, 1000))
        }
      }
      clearInterval(this.timer)
      this.record.phase = 'stopped'
      this.release()
      await this.releaseDone
      this.fence!.release()
      owners.delete(this.storage.identity)
      this.storage.close()
      this.trace({ stage: 'closed', state: 'complete' })
      this.stopped()
      return true
    })().catch(() => {
      this.fail()
      return false
    })
    // A caller's deadline ends only its wait; the captured exit work continues under the fence.
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
