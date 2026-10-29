import { createHash, randomUUID } from 'node:crypto'
import { lstatSync, realpathSync } from 'node:fs'
import { createConnection } from 'node:net'
import { isAbsolute, join } from 'node:path'
import { z } from 'zod'
import { SupervisorStorage } from './storage'
import { isWithinOrSame } from '../private-files'
import { workspacePluginRoot } from '../root-selection'
import {
  Hex,
  OWNER_LAUNCH_MS,
  OWNER_LIMITS,
  OWNER_WIRE,
  pack,
  PluginSupervisorError,
  LOST_CHANNEL_ENDS,
  refuse,
  RENEW_RETRY,
  secret,
  unpack,
  type Command,
  type OwnerRecord,
  type WireVersion,
} from './protocol'

const Reply = z.discriminatedUnion('ok', [
  z.strictObject({ ok: z.literal(true), nonce: Hex, epoch: z.uuid(), value: z.unknown() }),
  z.strictObject({
    ok: z.literal(false),
    nonce: Hex,
    epoch: z.uuid(),
    code: z.enum(['unavailable', 'busy', 'incompatible', 'cleanup-pending', 'unsupported']),
  }),
])
const Hello = z.strictObject({
  lease: Hex,
  minor: z.number().int().nonnegative(),
  features: z.array(z.string()),
  heartbeat: z.literal(15_000),
  expires: z.literal(60_000),
})
/** A request that got no answer: the owner may or may not have acted on it. */
class NoReply extends PluginSupervisorError {
  constructor() {
    super('unavailable')
  }
}
/** How soon a renewal that got no answer is tried again, so several tries fit in the expiry. */
const RETRY_EVERY = 5_000
/** One authenticated, bounded command on a private socket. No raw error or packet leaves here. */
export function supervisorRequest(
  storage: SupervisorStorage,
  record: OwnerRecord,
  command: Command,
): Promise<unknown> {
  storage.check()
  const nonce = secret()
  return new Promise((resolve, reject) => {
    const socket = createConnection(storage.endpoint(record))
    let bytes = Buffer.alloc(0),
      challenge: string | undefined,
      done = false
    const finish = (error?: PluginSupervisorError, value?: unknown) => {
      if (done) return
      done = true
      clearTimeout(deadline)
      socket.destroy()
      if (error) reject(error)
      else resolve(value)
    }
    const deadline = setTimeout(() => finish(new NoReply()), OWNER_LIMITS.request)
    socket.on('error', () => finish(new NoReply()))
    socket.on('close', () => {
      if (!done) finish(new NoReply())
    })
    socket.on('data', (chunk: Buffer) => {
      bytes = Buffer.concat([bytes, chunk])
      if (bytes.length > OWNER_LIMITS.packet) {
        finish(new PluginSupervisorError('unavailable'))
        return
      }
      const end = bytes.indexOf(10)
      if (end < 0) return
      try {
        if (end !== bytes.length - 1) refuse()
        const line = bytes.toString('utf8', 0, end)
        bytes = Buffer.alloc(0)
        if (!challenge) {
          challenge = z.strictObject({ challenge: Hex }).parse(JSON.parse(line)).challenge
          socket.write(
            pack(record.key, 'request', { epoch: record.epoch, nonce, challenge, command }),
          )
          return
        }
        const response = Reply.parse(unpack(record.key, 'response', line))
        if (response.nonce !== nonce || response.epoch !== record.epoch) refuse()
        if (!response.ok) throw new PluginSupervisorError(response.code)
        storage.check()
        finish(undefined, response.value)
      } catch (error) {
        finish(
          error instanceof PluginSupervisorError ? error : new PluginSupervisorError('unavailable'),
        )
      }
    })
  })
}
/** Stable projection identity for the authenticated canonical workspace path. */
export function pluginWorkspaceIdentity(workspaceRoot: string): string {
  const hash = createHash('sha256').update(realpathSync(workspaceRoot)).digest('hex')
  return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-5${hash.slice(13, 16)}-a${hash.slice(17, 20)}-${hash.slice(20, 32)}`
}
export interface SupervisorClientOptions {
  /** No fallback, even in tests. All workspace copies must use this same global root. */
  root: string
  workspaceRoot: string
  generation: string
  build: string
  wire?: WireVersion
  /** Slice 6 supplies only a verified immutable supervisor/Node launcher. Never an app-bundle fallback. */
  launch?: () => Promise<void>
  onLost?: () => void
}
export class PluginWorkspaceLease {
  private counter = 0
  private renewal = secret()
  private renewedAt = performance.now()
  private timer: ReturnType<typeof setInterval> | undefined
  private retry: ReturnType<typeof setTimeout> | undefined
  private renewing: Promise<void> | undefined
  private ended = false
  readonly lease: string
  readonly minor: number
  readonly features: readonly string[]
  readonly epoch: string
  private constructor(
    private readonly storage: SupervisorStorage,
    private readonly record: OwnerRecord,
    private readonly options: SupervisorClientOptions,
    private readonly workspace: string,
    hello: z.infer<typeof Hello>,
  ) {
    this.lease = hello.lease
    this.minor = hello.minor
    this.features = hello.features
    this.epoch = record.epoch
    this.timer = setInterval(() => {
      void this.renew().catch(() => undefined)
    }, OWNER_LIMITS.heartbeat)
    this.timer.unref()
  }
  static async attach(options: SupervisorClientOptions): Promise<PluginWorkspaceLease> {
    let storage: SupervisorStorage | undefined
    try {
      const workspace = realpathSync(options.workspaceRoot)
      if (!lstatSync(workspace).isDirectory()) refuse()
      const workspaceId = createHash('sha256').update(workspace).digest('hex')
      storage = new SupervisorStorage(options.root, [workspace], !!options.launch)
      let launchError: unknown
      let record = storage.read()
      if (!record || record.phase === 'stopped') {
        if (!options.launch) refuse()
        // Exactly one attempt here. The launched service itself must acquire the OS fence.
        let timer: ReturnType<typeof setTimeout> | undefined
        const until = performance.now() + OWNER_LAUNCH_MS
        try {
          await Promise.race([
            options.launch(),
            new Promise<never>((_, reject) => {
              timer = setTimeout(
                () => reject(new PluginSupervisorError('unavailable')),
                OWNER_LAUNCH_MS,
              )
            }),
          ])
        } catch (error) {
          launchError = error
          // A simultaneous starter may have won the fence. Only its authenticated record can
          // turn this failed launch into an attachment; never launch a second time here.
        } finally {
          clearTimeout(timer)
        }
        do {
          record = storage.read()
          if (record && record.phase !== 'stopped') break
          await new Promise((resolve) => setTimeout(resolve, 10))
        } while (performance.now() < until)
      }
      if (!record || record.phase !== 'accepting')
        throw new PluginSupervisorError(
          record?.phase === 'blocked' || record?.phase === 'draining' ? 'busy' : 'unavailable',
          { cause: launchError },
        )
      const hello = Hello.parse(
        await supervisorRequest(storage, record, {
          kind: 'hello',
          workspace: workspaceId,
          generation: options.generation,
          build: options.build,
          wire: options.wire ?? OWNER_WIRE,
        }),
      )
      return new PluginWorkspaceLease(storage, record, options, workspaceId, hello)
    } catch (error) {
      storage?.close()
      if (error instanceof PluginSupervisorError) throw error
      throw new PluginSupervisorError('unavailable', { cause: error })
    }
  }
  private identity() {
    return { workspace: this.workspace, generation: this.options.generation, lease: this.lease }
  }
  /**
   * A renewal that got no answer is tried again with the same counter and renewal, which the
   * owner accepts whether or not it applied the first. An owner without RENEW_RETRY is sent no
   * renewal and accepts the retry only if it never applied the first. The lease ends on the
   * owner's refusal or a wrong answer, once its public record stops accepting this epoch, or once
   * its expiry has surely passed: the owner applied the last confirmed renewal before its reply
   * came back.
   */
  renew(): Promise<void> {
    if (this.ended) return Promise.reject(new PluginSupervisorError('unavailable'))
    this.renewing ??= (async () => {
      const counter = this.counter + 1
      try {
        const result = z.strictObject({ counter: z.number().int() }).parse(
          await supervisorRequest(this.storage, this.record, {
            kind: 'renew',
            ...this.identity(),
            counter,
            ...(this.features.includes(RENEW_RETRY) ? { renewal: this.renewal } : {}),
          }),
        )
        if (result.counter !== counter) refuse()
        this.counter = counter
        this.renewal = secret()
        this.renewedAt = performance.now()
        clearTimeout(this.retry)
        this.retry = undefined
      } catch (error) {
        if (this.ended) refuse()
        const cause = error instanceof NoReply ? this.noLongerHeld() : 'refused-or-invalid'
        if (!cause) {
          this.retry ??= setTimeout(() => {
            this.retry = undefined
            void this.renew().catch(() => undefined)
          }, RETRY_EVERY)
          this.retry.unref()
          refuse()
        }
        this.ended = true
        clearInterval(this.timer)
        clearTimeout(this.retry)
        this.storage.close()
        console.warn(`[plugins] supervisor-lease-ended ${cause}`)
        try {
          this.options.onLost?.()
        } catch {
          /* Always return the approved typed refusal. */
        }
        refuse()
      } finally {
        this.renewing = undefined
      }
    })()
    return this.renewing
  }
  /** Why a lease with no answer is over, or nothing while it may still stand. */
  private noLongerHeld(): 'expired' | 'owner-not-accepting' | 'record-unreadable' | undefined {
    if (performance.now() - this.renewedAt >= OWNER_LIMITS.expires) return 'expired'
    try {
      const record = this.storage.read()
      if (record?.epoch !== this.epoch || record.phase !== 'accepting') return 'owner-not-accepting'
    } catch {
      return 'record-unreadable'
    }
    return undefined
  }
  /** Agent-only route metadata. The owner validates this lease again on every operation. */
  async agentRoutes(input: {
    workspaceId: string
    incarnation: string
    occupied: string[]
    release?: boolean
  }): Promise<unknown> {
    if (this.ended) refuse()
    return supervisorRequest(this.storage, this.record, {
      kind: 'agent-routes',
      ...this.identity(),
      ...input,
      release: input.release ?? false,
    })
  }
  /** False once the lease has ended here, for whatever reason. */
  standing(): boolean {
    return !this.ended
  }
  /** For an owner that has stopped: there is nobody left to send a release to. */
  abandon(): void {
    this.ended = true
    clearInterval(this.timer)
    clearTimeout(this.retry)
    this.storage.close()
  }
  async close(): Promise<boolean> {
    if (this.ended) return false
    this.ended = true
    clearInterval(this.timer)
    clearTimeout(this.retry)
    try {
      // A renewal that got no answer leaves the lease standing, so it is still released.
      await this.renewing?.catch(() => undefined)
      const result = z.strictObject({ remaining: z.boolean() }).parse(
        await supervisorRequest(this.storage, this.record, {
          kind: 'release',
          ...this.identity(),
        }),
      )
      if (result.remaining) return true
      // Acknowledged release is not proof of child exit. Wait for the fenced clean-stop record.
      const until = performance.now() + OWNER_LIMITS.drain + OWNER_LIMITS.request
      while (performance.now() < until) {
        const record = this.storage.read()
        if (!record || record.epoch !== this.record.epoch || record.phase === 'blocked')
          return false
        if (record.phase === 'stopped') return true
        await new Promise((resolve) => setTimeout(resolve, 10))
      }
      return false
    } catch {
      return false
    } finally {
      this.storage.close()
    }
  }
}

/** Nonblocking app lifetime adapter; unavailable plugins never block normal conversation startup. */
export class PluginSupervisorAttachment {
  private pending: Promise<PluginWorkspaceLease | null> | undefined
  private lease: PluginWorkspaceLease | undefined
  private where: { root: string; workspaceRoot: string } | undefined
  private quitting: Promise<void> | undefined
  private ended = false
  private startError: unknown
  /** Internal diagnostics only; raw causes are never sent through plugin IPC or logs. */
  get lastStartError(): unknown {
    return this.startError
  }
  start(options: Omit<SupervisorClientOptions, 'generation'>): void {
    if (this.pending || this.ended) return
    this.startError = undefined
    this.where = { root: options.root, workspaceRoot: options.workspaceRoot }
    this.pending = PluginWorkspaceLease.attach({ ...options, generation: randomUUID() })
      .then(async (lease) => {
        if (this.ended) {
          await lease.close()
          return null
        }
        this.lease = lease
        return lease
      })
      .catch((error) => {
        this.startError = error
        console.warn('[plugins] supervisor-start-failed')
        this.pending = undefined // No local lease authority. A later person retry still faces the owner fence.
        return null
      })
  }
  supports(feature: string): boolean {
    return this.holdsLease() && Boolean(this.lease?.features.includes(feature))
  }
  async agentRoutes(input: {
    workspaceId: string
    incarnation: string
    occupied: string[]
    release?: boolean
  }): Promise<unknown> {
    const lease = await this.pending
    if (!lease || this.ended) refuse()
    return lease.agentRoutes(input)
  }
  async ready(): Promise<boolean> {
    return Boolean((await this.pending) && !this.ended)
  }
  /**
   * True when the owner this lease came from has proven a clean stop; the next start launches
   * a new one. The owner writes stopped only after every child and descendant has exited, and a
   * successor starts only over that record and under the owner lock, so a new epoch proves it too.
   */
  stoppedCleanly(): boolean {
    const lease = this.lease
    if (this.ended || !lease || !this.where) return false
    let storage: SupervisorStorage | undefined
    try {
      storage = new SupervisorStorage(this.where.root, [this.where.workspaceRoot], false)
      const record = storage.read()
      if (!record || (record.phase !== 'stopped' && record.epoch === lease.epoch)) return false
    } catch {
      return false
    } finally {
      storage?.close()
    }
    lease.abandon()
    this.lease = undefined
    this.pending = undefined
    return true
  }
  /**
   * True while this lease still stands and its owner still accepts: the app may reconnect to that
   * owner, which detaches a lost person channel's consumer by itself.
   */
  holdsLease(): boolean {
    const lease = this.lease
    if (
      this.ended ||
      !lease?.standing() ||
      !lease.features.includes(LOST_CHANNEL_ENDS) ||
      !this.where
    )
      return false
    let storage: SupervisorStorage | undefined
    try {
      storage = new SupervisorStorage(this.where.root, [this.where.workspaceRoot], false)
      const record = storage.read()
      return record?.epoch === lease.epoch && record.phase === 'accepting'
    } catch {
      return false
    } finally {
      storage?.close()
    }
  }
  quit(): Promise<void> {
    this.ended = true
    this.quitting ??= (async () => {
      const lease = await this.pending
      await lease?.close()
    })()
    return this.quitting
  }
}

/** Hidden fixtures stay explicit; normal startup may select a paired workspace opt-in. */
export function pluginSupervisorRoot(options: {
  appData: string
  hidden: boolean
  scratchRoot?: string
  /** Effective userData after routing; required at runtime for every non-hidden start. */
  workspaceRoot?: string
}): string | null {
  if (!options.hidden) {
    if (typeof options.workspaceRoot !== 'string') refuse()
    const defaultRoot = join(options.appData, '@brobot2', 'plugins')
    return workspacePluginRoot({
      appData: options.appData,
      workspaceRoot: options.workspaceRoot,
      defaultRoot,
    })
  }
  const root = options.scratchRoot
  if (!root) return null
  if (!isAbsolute(root) || isWithinOrSame(options.appData, root)) refuse()
  return root
}
