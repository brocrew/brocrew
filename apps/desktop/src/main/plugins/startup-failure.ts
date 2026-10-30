import { randomUUID } from 'node:crypto'
import { rename, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import {
  pluginUnavailableNotice,
  pluginStartupDiagnosticNotice,
  type PluginStartupDiagnostic,
  type PluginUnavailableReason,
} from '../../shared/plugin-settings'
import { StringDecoder } from 'node:string_decoder'
import type { ChildProcess } from 'node:child_process'
import { PluginSupervisorError } from './supervisor/protocol'

/** Keep one error line, excluding launch capabilities and terminal control characters. */
export function pluginStartupStderr(text: string, secrets: readonly string[] = []): string | null {
  for (const secret of secrets) if (secret) text = text.split(secret).join('[redacted]')
  text = text
    .replace(/Bearer\s+[^\s]+/gi, 'Bearer [redacted]')
    .replace(
      /((?:token|secret|password|personKey|authorization)["']?\s*[:=]\s*["']?)[^\s"',;]+/gi,
      '$1[redacted]',
    )
    .replace(/[a-f0-9]{32,}/gi, '[redacted]')
    .replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '')
  return (
    text
      .split(/\r?\n/)
      .find((line) => line.trim())
      ?.replace(/[\p{Cc}\p{Cs}\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069]/gu, ' ')
      .trim()
      .slice(0, 512) || null
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
export function pluginStartupDiagnostic(error: unknown): PluginStartupDiagnostic | undefined {
  for (let depth = 0; depth < 6 && error && typeof error === 'object'; depth++) {
    if (error instanceof PluginSupervisorLaunchFailure) return error.diagnostic
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
  child.stderr?.on('error', () => {})
  ;(child.stderr as (NodeJS.ReadableStream & { unref?(): void }) | null)?.unref?.()
  return () =>
    new PluginSupervisorLaunchFailure({
      exitCode: child.exitCode,
      signal: child.signalCode,
      stderr: pluginStartupStderr(stderr, secrets),
    })
}
/** A failed startup phase; no launch configuration or provider data is part of its message. */
export class PluginStartupError extends PluginSupervisorError {
  constructor(
    readonly reason: PluginUnavailableReason,
    cause: unknown,
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
  let code: string | undefined
  for (let depth = 0; depth < 6 && error && typeof error === 'object'; depth++) {
    const one = error as { code?: unknown; cause?: unknown }
    if (
      typeof one.code === 'string' &&
      /^(?:EACCES|EPERM|ENOENT|ENOSPC|EBUSY|ECONNREFUSED|ECONNRESET|ETIMEDOUT)$/.test(one.code)
    )
      code = one.code
    error = one.cause
  }
  const line = `[plugins] ${reason}: ${pluginUnavailableNotice(reason)}${code ? ` (${code})` : ''}${diagnostic ? ` ${pluginStartupDiagnosticNotice(diagnostic)}` : ''}`
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
