import { logInfo, logWarn } from '../logging/log'
import {
  pluginUnavailableNotice,
  PluginStartupDiagnosticSchema,
  pluginStartupDiagnosticNotice,
  type PluginStartupDiagnostic,
  type PluginUnavailableReason,
} from '../../shared/plugin-settings'
import { StringDecoder } from 'node:string_decoder'
import type { ChildProcess } from 'node:child_process'
import { PluginSupervisorError, ownerDiagnosticLine, type Refusal } from './supervisor/protocol'
import { managedPluginFailure, ManagedPluginFailure } from '@brobot2/runtime/plugin-failure'

export function pluginStartupStderr(text: string): string | null {
  text = text.replace(new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*[a-zA-Z]`, 'g'), '')
  const line =
    text
      .split(/\r?\n/)
      .find((one) => one.trim())
      ?.replace(/[\p{Cc}\p{Cs}\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069]/gu, ' ')
      .trim() ?? ''
  let bounded = ''
  for (const character of line) {
    if (bounded.length + character.length > 512) break
    bounded += character
  }
  if (bounded.length < line.length)
    bounded = bounded.slice(0, 511).replace(/[\uD800-\uDBFF]$/, '') + '…'
  return PluginStartupDiagnosticSchema.shape.stderr.safeParse(bounded).success ? bounded : null
}

export function pluginStartupOutput(text: string): string {
  return text
    .replace(new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*[a-zA-Z]`, 'g'), '')
    .replace(/[\p{Cc}\p{Cs}\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069]/gu, (one) =>
      one === '\n' ? '\n' : ' ',
    )
    .slice(-16 * 1024)
    .trim()
}

/** One bounded cause chain for local diagnostic logs: each error's real message, plus its stage. */
export function pluginFailureCause(error: unknown, seen = new Set<unknown>()): string {
  const lines: string[] = []
  for (let depth = 0; depth < 6 && error != null && !seen.has(error); depth++) {
    seen.add(error)
    try {
      const message = typeof error === 'string' ? error : (error as Error).message
      if (typeof message === 'string') {
        const one = error as { code?: unknown }
        const code =
          error instanceof PluginSupervisorError
            ? error.code
            : typeof one.code === 'string' && /^E[A-Z0-9_]{1,30}$/.test(one.code)
              ? one.code
              : undefined
        const name = error instanceof Error ? error.name : ''
        const stage = error instanceof PluginStartupError ? error.detailStage : undefined
        const origin =
          error instanceof ManagedPluginFailure
            ? ` origin=${error.pluginStage} cause=${error.pluginCause}`
            : ''
        const label = `${name}${code ? ` code=${code}` : ''}${stage ? ` detail=${stage}` : ''}${origin}`
        const line = pluginStartupStderr(
          `${label ? `${label}: ` : ''}${message.replace(/\r?\n/g, ' ')}`,
        )
        if (line) lines.push(line)
      }
      // An aggregate names each of its failures; then the chain continues through its cause.
      if (error instanceof AggregateError)
        for (const one of error.errors.slice(0, 4)) {
          const each = seen.has(one) ? '' : pluginFailureCause(one, seen)
          if (each) lines.push(each)
        }
      error = typeof error === 'object' ? (error as Error).cause : undefined
    } catch {
      break // A diagnostic property must not replace the failure being reported.
    }
  }
  const budget = Math.floor(480 / Math.max(1, lines.length))
  return (
    pluginStartupStderr(
      lines.map((line) => line.slice(0, budget).replace(/[\uD800-\uDBFF]$/, '')).join(' <- '),
    ) ?? 'Unknown failure'
  )
}

export class PluginSupervisorLaunchFailure extends Error {
  constructor(
    readonly diagnostic: PluginStartupDiagnostic,
    cause?: unknown,
    readonly stderrOutput?: string,
  ) {
    super('Plugin service launch failed', { cause })
  }
}
export function pluginStartupDiagnostic(error: unknown): PluginStartupDiagnostic | undefined {
  for (let depth = 0; depth < 6 && error && typeof error === 'object'; depth++) {
    if (error instanceof PluginSupervisorLaunchFailure) return error.diagnostic
    if (error instanceof PluginSupervisorError && error.diagnostic)
      return {
        exitCode: null,
        signal: null,
        stderr: ownerDiagnosticLine(
          error.diagnostic.reason === 'restart-required'
            ? { ...error.diagnostic, reason: 'proof-pending' }
            : error.diagnostic,
        ),
      }
    error = (error as { cause?: unknown }).cause
  }
  return undefined
}
/** Keep the stderr tail and its real error line without keeping Electron alive. */
export function observePluginSupervisorLaunch(child: ChildProcess) {
  let stderr = ''
  let firstLine: string | undefined
  let errorLine: string | undefined
  const decoder = new StringDecoder('utf8')
  child.stderr?.on('data', (chunk: Buffer | string) => {
    stderr += typeof chunk === 'string' ? chunk : decoder.write(chunk)
    const first = stderr.match(/[^\r\n]*\S[^\r\n]*\r?\n/)?.[0]
    const error = stderr.match(/^[\w.]*Error(?:\s*\[[^\]\n]+\])?:[^\n]*\n/m)?.[0]
    if (first) firstLine ??= pluginStartupStderr(first) ?? undefined
    if (error) errorLine ??= pluginStartupStderr(error) ?? undefined
    stderr = stderr.slice(-16 * 1024)
  })
  let ended = !child.stderr || child.stderr.readableEnded || child.stderr.destroyed
  const drained = new Promise<void>((resolve) => {
    const finish = () => {
      ended = true
      resolve()
    }
    if (ended) finish()
    else {
      child.stderr!.once('end', finish)
      child.stderr!.once('close', finish)
      child.stderr!.once('error', finish)
    }
  })
  ;(child.stderr as (NodeJS.ReadableStream & { unref?(): void }) | null)?.unref?.()
  const snapshot = () =>
    new PluginSupervisorLaunchFailure(
      {
        exitCode: child.exitCode !== null && child.exitCode < 0 ? null : child.exitCode,
        signal: child.signalCode,
        stderr: pluginStartupStderr(errorLine ?? firstLine ?? stderr),
      },
      undefined,
      pluginStartupOutput(stderr),
    )
  return Object.assign(snapshot, {
    async drainUntil(deadline: number): Promise<void> {
      if (ended) return
      let timer: ReturnType<typeof setTimeout> | undefined
      try {
        await Promise.race([
          drained,
          new Promise<void>((resolve) => {
            timer = setTimeout(resolve, Math.max(0, deadline - performance.now()))
          }),
        ])
      } finally {
        clearTimeout(timer)
      }
    },
  })
}

/** A failed startup phase; no launch configuration or provider data is part of its message. */
export type PluginOwnerCheckStage =
  | 'owner-local-state'
  | 'owner-features'
  | 'owner-mutation-status'
  | 'owner-response'
  | 'owner-generation'
export class PluginStartupError extends PluginSupervisorError {
  constructor(
    readonly reason: PluginUnavailableReason,
    cause: unknown,
    readonly catalogueStage?: 'owner-check' | 'rpc' | 'schema' | 'composition',
    readonly detailStage?: PluginOwnerCheckStage,
  ) {
    super('unavailable', { cause })
    if (detailStage) this.message = managedPluginFailure(cause, detailStage).message
  }
}
export function pluginStartupReason(
  error: unknown,
  fallback: PluginUnavailableReason,
): PluginUnavailableReason {
  for (let depth = 0; depth < 6 && error && typeof error === 'object'; depth++) {
    if (error instanceof PluginStartupError) return error.reason
    if (
      error instanceof PluginSupervisorError &&
      error.code === 'busy' &&
      error.ownerEpoch &&
      error.diagnostic?.reason === 'released-owner-stalled' &&
      error.diagnostic.stage === 'attach-record' &&
      error.diagnostic.probe === 'live' &&
      (error.diagnostic.phase === 'draining' || error.diagnostic.phase === 'blocked')
    )
      return 'previous-service-stopping'
    const one = error as { code?: unknown; cause?: unknown }
    if (one.code === 'runtime') return 'runtime'
    if (one.code === 'busy' || one.code === 'cleanup-pending') return 'cleanup-pending'
    if (one.code === 'incompatible') return 'service-version'
    error = one.cause
  }
  return fallback
}
export function createPluginStartupTrace(now = () => performance.now()) {
  const launch = new Date().toISOString(),
    began = now()
  let ordinal = 0
  const active = new Set<(error?: unknown) => void>()
  const mark = (phase: string, state: string, attempt = ordinal) => {
    const facts = { launch, elapsed: Math.round(now() - began), attempt }
    if (state.startsWith('failure')) logWarn('plugin-startup', `${phase} ${state}`, facts)
    else logInfo('plugin-startup', `${phase} ${state}`, facts)
  }
  return {
    attempt() {
      ordinal++
    },
    begin(phase: string) {
      const attempt = ordinal
      mark(phase, 'start', attempt)
      let ended = false
      const finish = (error?: unknown) => {
        if (!ended) mark(phase, error === undefined ? 'end' : 'failure', attempt)
        ended = true
        active.delete(finish)
      }
      active.add(finish)
      return finish
    },
    failure(phase: string, error?: unknown) {
      for (const finish of active) finish(error ?? phase)
      let stderr = ''
      for (let cause = error, depth = 0; depth < 6 && cause && typeof cause === 'object'; depth++) {
        if (cause instanceof PluginSupervisorLaunchFailure) {
          stderr = cause.stderrOutput ?? ''
          break
        }
        cause = (cause as Error).cause
      }
      const diagnostic = pluginStartupDiagnostic(error)
      mark(
        phase,
        `failure ${diagnostic ? pluginStartupDiagnosticNotice(diagnostic) : ''} ${phase === 'catalogue-response' ? pluginFailureCause(error) : ''}${stderr ? `\n${stderr}` : ''}`,
      )
    },
  }
}
export const pluginStartupTrace = createPluginStartupTrace()

export type PluginReviewStage = 'download' | 'verify' | 'installed-disclosure' | 'owner-prepare'
export function recordPluginReviewFailure(
  action: 'install' | 'update',
  stage: PluginReviewStage,
  code: Refusal,
  cause: Refusal | 'integrity' | 'transport' | 'verification' | 'unknown',
): void {
  logWarn('plugin-review', `${action} ${stage}`, { code, cause })
}
/** Log one readable failure, with the plugin's own stderr when it printed any. */
export function recordPluginStartupFailure(reason: PluginUnavailableReason, error?: unknown): void {
  const diagnostic = pluginStartupDiagnostic(error)
  let stderrOutput: string | undefined
  for (let cause = error, depth = 0; depth < 6 && cause && typeof cause === 'object'; depth++) {
    if (cause instanceof PluginSupervisorLaunchFailure) {
      stderrOutput = cause.stderrOutput
      break
    }
    cause = (cause as Error).cause
  }
  const original = error
  let stage: PluginStartupError['catalogueStage']
  let detail: PluginOwnerCheckStage | undefined
  let code: string | undefined
  for (let depth = 0; depth < 6 && error && typeof error === 'object'; depth++) {
    if (error instanceof PluginStartupError && error.catalogueStage) stage = error.catalogueStage
    if (error instanceof PluginStartupError && error.detailStage) detail = error.detailStage
    const one = error as { code?: unknown; cause?: unknown }
    if (
      typeof one.code === 'string' &&
      /^(?:EACCES|EPERM|ENOENT|ENOSPC|EBUSY|ECONNREFUSED|ECONNRESET|ETIMEDOUT)$/.test(one.code)
    )
      code = one.code
    error = one.cause
  }
  const cause = reason === 'catalogue-response' || stage ? pluginFailureCause(original) : undefined
  const line = `[plugins] ${reason}: ${pluginUnavailableNotice(reason)}${code ? ` (${code})` : ''}${diagnostic ? ` ${pluginStartupDiagnosticNotice(diagnostic)}` : ''}${cause ? ` stage=${stage ?? 'rpc'}${detail ? ` detail=${detail}` : ''} cause=${cause}` : ''}`
  logWarn('plugin-startup', stderrOutput ? `${line}\n${stderrOutput}` : line)
}
