import { createHmac, randomBytes } from 'node:crypto'
import { isAbsolute, resolve } from 'node:path'

export type AuthVerb = 'login' | 'logout' | 'status'

export interface FakeAuthCommand {
  readonly args: readonly ['auth', AuthVerb]
  readonly env: Readonly<{ CLAUDE_CONFIG_DIR: string }>
  readonly output: 'discard' | 'status-only'
  readonly signal: AbortSignal
}

/** A fixture port only; there is no native process implementation or release binding. */
export interface FakeClaudeAuthCli {
  readonly kind: 'fake-cli'
  run(command: FakeAuthCommand): Promise<{ readonly exitCode: number; readonly stdout?: string }>
}

export interface SafeNativeAuthStatus {
  readonly signedIn: boolean
  readonly accountSignal: 'present' | 'absent'
  readonly change: 'initial' | 'same' | 'changed'
}

export type NativeAuthPreparationResult =
  | { readonly kind: 'disabled' | 'busy' }
  | {
      readonly kind: 'failed'
      readonly stage: AuthVerb
      readonly reason:
        | 'command'
        | 'status-schema'
        | 'account-signal'
        | 'logout-not-confirmed'
        | 'login-not-confirmed'
        | 'cancelled'
        | 'timeout'
    }
  | { readonly kind: 'status'; readonly status: SafeNativeAuthStatus }
  | {
      readonly kind: 'switched'
      readonly status: Pick<SafeNativeAuthStatus, 'signedIn' | 'accountSignal'>
      readonly accountChange: 'same' | 'changed' | 'unknown'
      readonly requiresResumeConfirmation: true
    }

export interface ClaudeNativeAuthPreparation {
  readonly enabled: boolean
  status(signal?: AbortSignal): Promise<NativeAuthPreparationResult>
  switchAccount(signal?: AbortSignal): Promise<NativeAuthPreparationResult>
}

export interface NativeAuthPreparationFixtures {
  readonly cli: FakeClaudeAuthCli
  readonly configDirectory: string
  readonly apiKeySelected?: boolean
}

type FailureReason = Extract<NativeAuthPreparationResult, { kind: 'failed' }>['reason']
class PreparationFailure extends Error {
  constructor(
    readonly stage: AuthVerb,
    readonly reason: FailureReason,
  ) {
    super('Claude auth preparation could not complete')
  }
}

function checkedHome(home: string): string {
  if (typeof home !== 'string' || !isAbsolute(home) || home.includes('\0'))
    throw new Error('Invalid auth preparation directory')
  return home
}

const DISABLED = Object.freeze({ kind: 'disabled' } as const)
const BUSY = Object.freeze({ kind: 'busy' } as const)
const COMMAND_BOUND_MS = 120_000
const STATUS_LIMIT = 16_384
const reservations = new Map<
  string,
  { readonly kind: 'status' | 'switch'; readonly result: Promise<NativeAuthPreparationResult> }
>()

/** No production transport is installed; omission retains the disabled preparation. */
export function createClaudeNativeAuthPreparation(
  fixtures?: NativeAuthPreparationFixtures,
): ClaudeNativeAuthPreparation {
  if (fixtures === undefined || fixtures.apiKeySelected === true) {
    return Object.freeze({
      enabled: false,
      status: async () => DISABLED,
      switchAccount: async () => DISABLED,
    })
  }
  if (fixtures.cli.kind !== 'fake-cli') throw new Error('Invalid auth preparation fixture')
  const home = checkedHome(fixtures.configDirectory)
  const lockKey = resolve(home)
  const run = fixtures.cli.run.bind(fixtures.cli)
  const salt = randomBytes(32)
  let previous: string | undefined

  interface Operation {
    readonly signal: AbortSignal
    readonly timedOut: () => boolean
  }

  function invoke(verb: AuthVerb, operation: Operation): ReturnType<FakeClaudeAuthCli['run']> {
    const { signal } = operation
    return new Promise((resolve, reject) => {
      const cancelled = () => {
        signal.removeEventListener('abort', cancelled)
        reject(new PreparationFailure(verb, operation.timedOut() ? 'timeout' : 'cancelled'))
      }
      signal.addEventListener('abort', cancelled, { once: true })
      if (signal.aborted) {
        cancelled()
        return
      }
      const command: FakeAuthCommand = Object.freeze({
        args: Object.freeze(['auth', verb] as const),
        env: Object.freeze({ CLAUDE_CONFIG_DIR: home }),
        output: verb === 'status' ? 'status-only' : 'discard',
        signal,
      })
      Promise.resolve()
        .then(() => {
          if (signal.aborted)
            throw new PreparationFailure(verb, operation.timedOut() ? 'timeout' : 'cancelled')
          return run(command)
        })
        .then(
          (reply) => {
            signal.removeEventListener('abort', cancelled)
            if (signal.aborted) cancelled()
            else resolve(reply)
          },
          () => {
            signal.removeEventListener('abort', cancelled)
            if (signal.aborted) cancelled()
            else reject(new PreparationFailure(verb, 'command'))
          },
        )
    })
  }

  async function readStatus(operation: Operation): Promise<{
    status: SafeNativeAuthStatus
    identity: string | null
  }> {
    const reply = await invoke('status', operation)
    let body: Record<string, unknown>
    try {
      const stdout = reply.stdout
      if (
        typeof stdout !== 'string' ||
        stdout.length > STATUS_LIMIT ||
        Buffer.byteLength(stdout, 'utf8') > STATUS_LIMIT
      )
        throw new Error('Invalid status size')
      const parsed: unknown = JSON.parse(stdout)
      if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed))
        throw new Error('Invalid status shape')
      body = parsed as Record<string, unknown>
    } catch {
      throw new PreparationFailure('status', 'status-schema')
    }
    if (body.configDirectory !== home) throw new PreparationFailure('status', 'status-schema')
    let identity: string | null
    if (body.loggedIn === false && body.authMethod === 'none' && reply.exitCode === 1) {
      identity = null
    } else if (body.loggedIn === true && body.authMethod === 'claude.ai' && reply.exitCode === 0) {
      if (typeof body.email !== 'string' || body.email.trim() === '')
        throw new PreparationFailure('status', 'account-signal')
      if (body.orgId !== undefined && typeof body.orgId !== 'string')
        throw new PreparationFailure('status', 'status-schema')
      identity = createHmac('sha256', salt)
        .update(JSON.stringify([body.email, body.orgId ?? null]))
        .digest('hex')
    } else {
      throw new PreparationFailure('status', 'status-schema')
    }
    const observation = identity ?? 'signed-out'
    const change =
      previous === undefined ? 'initial' : previous === observation ? 'same' : 'changed'
    previous = observation
    return {
      identity,
      status: Object.freeze({
        signedIn: identity !== null,
        accountSignal: identity === null ? 'absent' : 'present',
        change,
      }),
    }
  }

  function operate(
    kind: 'status' | 'switch',
    action: (operation: Operation) => Promise<NativeAuthPreparationResult>,
    requested?: AbortSignal,
  ): Promise<NativeAuthPreparationResult> {
    if (reservations.has(lockKey)) return Promise.resolve(BUSY)
    const controller = new AbortController()
    let timedOut = false
    const cancel = () => controller.abort()
    requested?.addEventListener('abort', cancel, { once: true })
    if (requested?.aborted) cancel()
    const timer = setTimeout(() => {
      timedOut = true
      controller.abort()
    }, COMMAND_BOUND_MS)
    const result: Promise<NativeAuthPreparationResult> = Promise.resolve()
      .then(() => action({ signal: controller.signal, timedOut: () => timedOut }))
      .catch((error: unknown): NativeAuthPreparationResult => {
        const failure =
          error instanceof PreparationFailure ? error : new PreparationFailure('status', 'command')
        return Object.freeze({ kind: 'failed', stage: failure.stage, reason: failure.reason })
      })
      .finally(() => {
        clearTimeout(timer)
        requested?.removeEventListener('abort', cancel)
        if (reservations.get(lockKey)?.result === result) reservations.delete(lockKey)
      })
    reservations.set(lockKey, { kind, result })
    return result
  }

  return Object.freeze({
    enabled: true,
    status: (signal?: AbortSignal) =>
      operate(
        'status',
        async (operation) => {
          const observation = await readStatus(operation)
          return Object.freeze({ kind: 'status', status: observation.status })
        },
        signal,
      ),
    switchAccount(signal?: AbortSignal): Promise<NativeAuthPreparationResult> {
      const existing = reservations.get(lockKey)
      if (existing?.kind === 'switch') return existing.result
      return operate(
        'switch',
        async (operation) => {
          const before = await readStatus(operation)
          const logout = await invoke('logout', operation)
          if (logout.exitCode !== 0) throw new PreparationFailure('logout', 'command')
          const unsigned = await readStatus(operation)
          if (unsigned.status.signedIn)
            throw new PreparationFailure('logout', 'logout-not-confirmed')
          const login = await invoke('login', operation)
          if (login.exitCode !== 0) throw new PreparationFailure('login', 'command')
          const after = await readStatus(operation)
          if (!after.status.signedIn) throw new PreparationFailure('login', 'login-not-confirmed')
          return Object.freeze({
            kind: 'switched',
            status: Object.freeze({
              signedIn: after.status.signedIn,
              accountSignal: after.status.accountSignal,
            }),
            accountChange:
              before.identity === null
                ? 'unknown'
                : before.identity === after.identity
                  ? 'same'
                  : 'changed',
            requiresResumeConfirmation: true,
          })
        },
        signal,
      )
    },
  })
}

/** The supplied legacy resolver owns adopted and default-profile compatibility. */
export function claudeLegacyResumeRoute(
  recordedHome: string | null | undefined,
  legacyHome: () => string,
): { readonly providerHome: string; readonly authHome: string } {
  const home = checkedHome(recordedHome ?? legacyHome())
  return Object.freeze({ providerHome: home, authHome: home })
}
