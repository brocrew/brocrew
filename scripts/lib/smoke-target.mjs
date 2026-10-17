/**
 * Verify a CDP listener belongs to a process whose executable lives in this repository
 * before attaching or driving it. A shared port can otherwise point at another checkout's
 * app. The OS ownership check happens before any page connection touches the target.
 */
import { execFileSync } from 'node:child_process'

/** A port nobody should be driving by accident — the shared default that caused the 049 incident. */
export const FORBIDDEN_DEFAULT_PORT = 9222
/**
 * The person's running BroBot uses this protected port. Measurement launches must never inspect or
 * attach to it.
 */
export const FORBIDDEN_PERSON_PORT = 9444

/**
 * The PIDs listening on `port`, or `[]` when nothing is. Read-only: `lsof` only observes.
 * Injectable so the guard is testable without binding real ports.
 */
export function defaultListenerPids(port) {
  try {
    const out = execFileSync('lsof', ['-nP', `-iTCP:${port}`, '-sTCP:LISTEN', '-t'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    })
    return out
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
  } catch {
    return [] // nothing listening (lsof exits non-zero when it finds nothing)
  }
}

/** The executable path of `pid`, or '' when it cannot be read. Read-only. */
export function defaultExecutablePath(pid) {
  try {
    return execFileSync('ps', ['-p', String(pid), '-o', 'comm='], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim()
  } catch {
    return ''
  }
}

/**
 * Throw unless the process listening on `port` belongs to `repoRoot`.
 *
 * Called BEFORE attaching, so a foreign or unidentifiable target is refused with **no side
 * effects on it**. `listeners`/`executablePath` are seams so the guard can be tested against a
 * foreign path without standing up another app.
 */
export function assertPortOwnedByTree({
  port,
  repoRoot,
  listeners = defaultListenerPids,
  executablePath = defaultExecutablePath,
}) {
  const pids = listeners(port)
  if (pids.length === 0) {
    throw new Error(`nothing is listening on CDP port ${port} — the smoke could not reach its app`)
  }
  const root = repoRoot.endsWith('/') ? repoRoot : `${repoRoot}/`
  const foreign = []
  for (const pid of pids) {
    const path = executablePath(pid)
    if (path && path.startsWith(root)) return { pid, path } // ours — safe to drive
    foreign.push(`${pid}=${path || '(unreadable)'}`)
  }
  throw new Error(
    `CDP port ${port} is held by an app OUTSIDE this tree (${foreign.join(', ')}); ` +
      `expected an executable under ${root}. Refusing to attach — it is not this build, and ` +
      `driving it would disturb someone else's session. Use a different port (BROBOT_CDP_PORT) ` +
      `or stop that app.`,
  )
}

/** Refuse the shared well-known port outright: it is the one that collided across trees (049). */
export function assertPortNotShared(port) {
  if (port === FORBIDDEN_DEFAULT_PORT) {
    throw new Error(
      `CDP port ${FORBIDDEN_DEFAULT_PORT} is the shared default other tools/worktrees use; ` +
        `the smoke must own a dedicated port. Unset BROBOT_CDP_PORT to auto-pick one.`,
    )
  }
  if (port === FORBIDDEN_PERSON_PORT) {
    throw new Error(
      `CDP port ${FORBIDDEN_PERSON_PORT} belongs to the person's running BroBot; the smoke must never ` +
        `read, reload, seed or attach to it. Unset BROBOT_CDP_PORT to auto-pick an isolated port.`,
    )
  }
}
