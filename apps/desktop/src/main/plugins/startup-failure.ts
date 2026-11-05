import { randomUUID } from 'node:crypto'
import { rename, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import {
  pluginUnavailableNotice,
  PluginStartupDiagnosticSchema,
  pluginStartupDiagnosticNotice,
  type PluginStartupDiagnostic,
  type PluginUnavailableReason,
} from '../../shared/plugin-settings'
import { StringDecoder } from 'node:string_decoder'
import type { ChildProcess } from 'node:child_process'
import { PluginSupervisorError, ownerDiagnosticLine } from './supervisor/protocol'

/** Keep one error line, excluding launch capabilities and terminal control characters. */
export function pluginStartupStderr(text: string, secrets: readonly string[] = []): string | null {
  // Strip terminal escapes before matching secrets, so normalization cannot reveal one.
  text = text.replace(new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*[a-zA-Z]`, 'g'), '')
  for (const secret of secrets) if (secret) text = text.split(secret).join('[redacted]')
  text = text
    .replace(/Bearer\s+[^\s]+/gi, 'Bearer [redacted]')
    .replace(
      /((?:token|secret|password|personKey|authorization)["']?\s*[:=]\s*["']?)[^\s"',;]+/gi,
      '$1[redacted]',
    )
    .replace(/[a-f0-9]{32,}/gi, '[redacted]')
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
  return PluginStartupDiagnosticSchema.shape.stderr.safeParse(bounded).success ? bounded : null
}

/** One bounded cause chain for local diagnostic logs; never stringify input or stacks. */
export function pluginFailureCause(error: unknown, secrets: readonly string[] = []): string {
  const lines: string[] = []
  const seen = new Set<unknown>()
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
        const label = `${name}${code ? ` code=${code}` : ''}`
        const line = pluginStartupStderr(
          `${label ? `${label}: ` : ''}${message.replace(/\r?\n/g, ' ')}`,
          secrets,
        )
        if (line) lines.push(line)
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
      secrets,
    ) ?? 'Unknown failure'
  )
}

export class PluginSupervisorLaunchFailure extends Error {
  constructor(
    readonly diagnostic: PluginStartupDiagnostic,
    cause?: unknown,
  ) {
    super('Plugin service launch failed', { cause })
  }
}
function eligibleRebootAdvice(error: PluginSupervisorError): boolean {
  return (
    error.code === 'cleanup-pending' &&
    !!error.ownerEpoch &&
    error.diagnostic?.reason === 'restart-required' &&
    error.diagnostic.stage === 'recovery' &&
    error.diagnostic.probe === 'no-answer' &&
    (error.diagnostic.phase === 'blocked' || error.diagnostic.phase === 'draining')
  )
}
export function pluginStartupDiagnostic(error: unknown): PluginStartupDiagnostic | undefined {
  for (let depth = 0; depth < 6 && error && typeof error === 'object'; depth++) {
    if (error instanceof PluginSupervisorLaunchFailure) return error.diagnostic
    if (error instanceof PluginSupervisorError && error.diagnostic)
      return {
        exitCode: null,
        signal: null,
        stderr: ownerDiagnosticLine(
          error.diagnostic.reason === 'restart-required' && !eligibleRebootAdvice(error)
            ? { ...error.diagnostic, reason: 'proof-pending' }
            : error.diagnostic,
        ),
      }
    error = (error as { cause?: unknown }).cause
  }
  return undefined
}
/** Drain stderr without retaining more than its first bounded line or keeping Electron alive. */
export function observePluginSupervisorLaunch(child: ChildProcess, secrets: readonly string[]) {
  let stderr = ''
  const decoder = new StringDecoder('utf8')
  child.stderr?.on('data', (chunk: Buffer | string) => {
    if (!/\S[^\n]*\n/.test(stderr) && stderr.length < 4096)
      stderr += (typeof chunk === 'string' ? chunk : decoder.write(chunk)).slice(
        0,
        4096 - stderr.length,
      )
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
    new PluginSupervisorLaunchFailure({
      exitCode: child.exitCode,
      signal: child.signalCode,
      stderr: pluginStartupStderr(stderr, secrets),
    })
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
export class PluginStartupError extends PluginSupervisorError {
  constructor(
    readonly reason: PluginUnavailableReason,
    cause: unknown,
    readonly catalogueStage?: 'owner-check' | 'rpc' | 'schema' | 'composition',
  ) {
    super('unavailable', { cause })
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
    if (error instanceof PluginSupervisorError && eligibleRebootAdvice(error))
      return 'restart-required'
    const one = error as { code?: unknown; cause?: unknown }
    if (one.code === 'runtime') return 'runtime'
    if (one.code === 'busy' || one.code === 'cleanup-pending') return 'cleanup-pending'
    if (one.code === 'incompatible') return 'service-version'
    error = one.cause
  }
  return fallback
}
/** Retain one bounded, readable failure. Only the bounded child diagnostic and recognized errno cross this boundary. */
export async function recordPluginStartupFailure(
  root: string | undefined,
  reason: PluginUnavailableReason,
  error?: unknown,
): Promise<void> {
  const diagnostic = pluginStartupDiagnostic(error)
  const original = error
  let stage: PluginStartupError['catalogueStage']
  let code: string | undefined
  for (let depth = 0; depth < 6 && error && typeof error === 'object'; depth++) {
    if (error instanceof PluginStartupError && error.catalogueStage) stage = error.catalogueStage
    const one = error as { code?: unknown; cause?: unknown }
    if (
      typeof one.code === 'string' &&
      /^(?:EACCES|EPERM|ENOENT|ENOSPC|EBUSY|ECONNREFUSED|ECONNRESET|ETIMEDOUT)$/.test(one.code)
    )
      code = one.code
    error = one.cause
  }
  const cause = reason === 'catalogue-response' || stage ? pluginFailureCause(original) : undefined
  const line = `[plugins] ${reason}: ${pluginUnavailableNotice(reason)}${code ? ` (${code})` : ''}${diagnostic ? ` ${pluginStartupDiagnosticNotice(diagnostic)}` : ''}${cause ? ` stage=${stage ?? 'rpc'} cause=${cause}` : ''}`
  console.warn(line)
  if (!root) return
  const temporary = join(root, `.plugin-startup-${randomUUID()}.log`)
  try {
    await writeFile(temporary, `${new Date().toISOString()} ${line}\n`, { flag: 'wx', mode: 0o600 })
    // Replacement never follows an existing diagnostic-file symlink.
    await rename(temporary, join(root, 'plugin-startup.log'))
  } catch {
    // A diagnostic write cannot prevent startup or recovery.
  } finally {
    await rm(temporary, { force: true }).catch(() => {})
  }
}
