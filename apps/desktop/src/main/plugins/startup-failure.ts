import { randomUUID } from 'node:crypto'
import { rename, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { pluginUnavailableNotice, type PluginUnavailableReason } from '../../shared/plugin-settings'
import { PluginSupervisorError } from './supervisor/protocol'

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
/** Retain one bounded, readable failure. Unknown error messages, paths and keys are never copied. */
export async function recordPluginStartupFailure(
  root: string | undefined,
  reason: PluginUnavailableReason,
  error?: unknown,
): Promise<void> {
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
  const line = `[plugins] ${reason}: ${pluginUnavailableNotice(reason)}${code ? ` (${code})` : ''}`
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
