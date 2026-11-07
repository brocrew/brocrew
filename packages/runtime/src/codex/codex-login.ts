import { realpathSync } from 'node:fs'
import { resolve } from 'node:path'
import { signInNotCheckedInTime, type AuthState } from '../auth-state'
import { assertCodexSqliteHomeContained } from '../internal/auth'
import {
  assertNotCancelled,
  cancelWith,
  didNotAnswerInTime,
  withDeadline,
  type LaunchCancel,
} from '../internal/bounded'
import { probeCodexAuth } from './auth-probe'
import type { CodexTransport } from './codex-transport'
import type { TransportFactory } from './codex-runtime'
import { beginCodexHomeBoot } from './home-boot'
import { transientSetupFailureOf } from '../runtime'

export interface CodexLoginStart {
  loginId: string
  authUrl: string
}

export interface CodexLoginOutcome {
  success: boolean
  error?: string
  state: AuthState
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function readString(value: unknown, key: string): string {
  return isRecord(value) && typeof value[key] === 'string' ? value[key] : ''
}

const INITIALIZE_PARAMS = {
  clientInfo: { name: 'brobot2', title: null, version: '0.0.0' },
  capabilities: { experimentalApi: true, requestAttestation: false },
}

const LOGIN_CANCEL_ACK_TIMEOUT_MS = 2_000

function canonicalPath(path: string): string {
  try {
    return realpathSync(path)
  } catch {
    return resolve(path)
  }
}

async function initializeInHome(transport: CodexTransport, providerHome: string): Promise<void> {
  assertCodexSqliteHomeContained(providerHome)
  const result = await transport.request('initialize', INITIALIZE_PARAMS)
  const reported =
    typeof result === 'object' &&
    result !== null &&
    typeof (result as Record<string, unknown>)['codexHome'] === 'string'
      ? ((result as Record<string, unknown>)['codexHome'] as string)
      : ''
  if (!reported) {
    throw new Error('codex initialize did not report a codexHome (required for home attestation)')
  }
  if (canonicalPath(reported) !== canonicalPath(providerHome)) {
    throw new Error(
      `codex did not adopt the profile home: expected ${providerHome}, got ${reported}`,
    )
  }
}

export class CodexLogin {
  private settled: ((outcome: CodexLoginOutcome) => void) | null = null
  private readonly outcome: Promise<CodexLoginOutcome>
  private loginId = ''
  private disposal: Promise<void> | null = null

  private constructor(private readonly transport: CodexTransport) {
    this.outcome = new Promise<CodexLoginOutcome>((resolve) => {
      this.settled = resolve
    })
    void this.pump()
  }

  static async start(
    transports: TransportFactory,
    providerHome: string,
    cwd: string,
    signal?: AbortSignal,
  ): Promise<{ login: CodexLogin; start: CodexLoginStart }> {
    assertNotCancelled(signal, 'codex sign-in')
    const bootSettled = await beginCodexHomeBoot(providerHome, { signal })
    let transport: CodexTransport
    try {
      transport = transports({ cwd, providerHome })
    } catch (error) {
      bootSettled()
      throw error
    }
    const spawned = transport
    const cancel = cancelWith(signal, () => spawned.close())
    const login = new CodexLogin(transport)
    try {
      await initializeInHome(transport, providerHome)
      bootSettled()
      const result = await transport.request('account/login/start', { type: 'chatgpt' })
      const loginId = readString(result, 'loginId')
      const authUrl = readString(result, 'authUrl')
      if (!loginId || !authUrl) {
        throw new Error(
          `Codex did not return a sign-in URL (got ${JSON.stringify(result)?.slice(0, 200)})`,
        )
      }
      if (cancel.cancelled) throw new Error('codex sign-in was cancelled')
      login.loginId = loginId
      return { login, start: { loginId, authUrl } }
    } catch (error) {
      await login.dispose()
      throw error
    } finally {
      bootSettled()
      cancel.release()
    }
  }

  completed(): Promise<CodexLoginOutcome> {
    return this.outcome
  }

  async cancel(): Promise<void> {
    if (this.disposal !== null) return this.disposal
    try {
      if (this.loginId)
        await withDeadline(
          this.transport.request('account/login/cancel', { loginId: this.loginId }),
          LOGIN_CANCEL_ACK_TIMEOUT_MS,
          'codex account/login/cancel',
        )
    } catch {
      // Teardown below ends sign-in even when cancellation is not acknowledged.
    }
    this.finish({
      success: false,
      error: 'canceled',
      state: { state: 'unknown', reason: 'canceled' },
    })
    await this.dispose()
  }

  private async pump(): Promise<void> {
    try {
      for await (const message of this.transport.incoming()) {
        if (message.kind !== 'notification') continue
        if (message.method !== 'account/login/completed') continue
        const success = isRecord(message.params) && message.params['success'] === true
        const error = readString(message.params, 'error')
        const state = await probeCodexAuth(this.transport)
        this.finish({ success, ...(error ? { error } : {}), state })
        await this.dispose()
        return
      }
    } catch {
      // A failed notification stream falls through to the terminal failure below.
    }
    this.finish({
      success: false,
      error: 'the Codex sign-in process ended before reporting a result',
      state: { state: 'unknown', reason: 'the sign-in process ended before reporting a result' },
    })
  }

  private finish(outcome: CodexLoginOutcome): void {
    const settle = this.settled
    this.settled = null
    settle?.(outcome)
  }

  private dispose(): Promise<void> {
    return (this.disposal ??= Promise.resolve(this.transport.close()).then(() => undefined))
  }
}

export function startCodexLogin(
  transports: TransportFactory,
  providerHome: string,
  cwd: string,
  signal?: AbortSignal,
): Promise<{ login: CodexLogin; start: CodexLoginStart }> {
  return CodexLogin.start(transports, providerHome, cwd, signal)
}

export async function probeCodexAuthInHome(
  transports: TransportFactory,
  providerHome: string,
  cwd: string,
  signal?: AbortSignal,
): Promise<AuthState> {
  let bootSettled: (() => void) | undefined
  let transport: CodexTransport | undefined
  let cancel: LaunchCancel | undefined
  try {
    assertNotCancelled(signal, 'codex sign-in check')
    bootSettled = await beginCodexHomeBoot(providerHome, { signal })
    const spawned = transports({ cwd, providerHome })
    transport = spawned
    cancel = cancelWith(signal, () => spawned.close())
    await initializeInHome(spawned, providerHome)
    bootSettled()
    const state = await probeCodexAuth(spawned)
    if (cancel.cancelled) throw new Error('codex sign-in check was cancelled')
    return state
  } catch (error) {
    const shortage = transientSetupFailureOf(error)
    if (shortage !== null) {
      return {
        state: 'unknown',
        reason:
          shortage === 'EMFILE'
            ? 'BroCrew had too many files open to start Codex and ask about this profile’s sign-in.'
            : 'This machine ran short of open files, processes or memory, so Codex could not be started to ask about this profile’s sign-in.',
      }
    }
    if (didNotAnswerInTime(error)) {
      return { state: 'unknown', reason: signInNotCheckedInTime('Codex') }
    }
    return {
      state: 'unknown',
      reason: `could not start Codex to ask about this profile's sign-in: ${
        error instanceof Error ? error.message : String(error)
      }`,
    }
  } finally {
    bootSettled?.()
    cancel?.release()
    await transport?.close()
  }
}

export type CodexKeyChange =
  { readonly to: 'the-key'; readonly apiKey: string } | { readonly to: 'no-key' }

export type CodexKeyOutcome =
  | { readonly ok: true; readonly authMethod: string | null }
  | { readonly ok: false; readonly reason: string }

export async function changeCodexKeyInHome(
  transports: TransportFactory,
  providerHome: string,
  change: CodexKeyChange,
  signal?: AbortSignal,
): Promise<CodexKeyOutcome> {
  let bootSettled: (() => void) | undefined
  let transport: CodexTransport | undefined
  let cancel: LaunchCancel | undefined
  const what = change.to === 'the-key' ? 'log this profile in with the key' : 'log this profile out'
  try {
    assertNotCancelled(signal, 'codex api key')
    bootSettled = await beginCodexHomeBoot(providerHome, { signal })
    const spawned = transports({ cwd: providerHome, providerHome })
    transport = spawned
    cancel = cancelWith(signal, () => spawned.close())
    await initializeInHome(spawned, providerHome)
    bootSettled()
    try {
      if (change.to === 'the-key') {
        await spawned.request('account/login/start', { type: 'apiKey', apiKey: change.apiKey })
      } else {
        await spawned.request('account/logout', undefined)
      }
    } catch {
      return { ok: false, reason: `Codex would not ${what}.` }
    }
    if (cancel.cancelled) return { ok: false, reason: `Codex was stopped before it could ${what}.` }
    let status: unknown
    try {
      status = await spawned.request('getAuthStatus', { includeToken: false, refreshToken: false })
    } catch {
      return {
        ok: false,
        reason: `Codex did not say what this profile runs on after it tried to ${what}.`,
      }
    }
    const method = readString(status, 'authMethod')
    return { ok: true, authMethod: method === '' ? null : method }
  } catch {
    return { ok: false, reason: `Codex could not be started to ${what}.` }
  } finally {
    bootSettled?.()
    cancel?.release()
    await transport?.close()
  }
}
