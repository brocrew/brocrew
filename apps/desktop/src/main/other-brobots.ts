import { execFile } from 'node:child_process'
import { win32 } from 'node:path'

/**
 * 🔴 **W4.109 · B1 — other BroBot workspaces running on this computer**, so an update never
 * installs under them. ⚑ On Windows the installer replaces files another workspace still runs from,
 * and would stop it; BroBot waits instead, and never stops one itself. ⚑ Windows only: it is the
 * one system where an update installs on a restart (the Mac's is guided).
 *
 * ⚑ Read from the process table: every main process of this executable's name but this app's own.
 * Each workspace is one process (one per data folder); Electron's helper processes carry `--type=`.
 * ⛔ **Counted by name, not by path**, and a process whose command line cannot be read (another
 * person's, or one run as administrator) counts too: Windows PowerShell writes its output in the
 * console's code page, so a path with letters outside it never matches the one Node holds, and a
 * workspace missed here is one the installer stops. Waiting for one that was not is the safe side.
 * ⚠️ Until the workspace list exists (A2) this is the only place they can be found.
 */

/**
 * How many lines of `listing` (`<pid> <command line>`, one per process of this executable's name)
 * are other BroBot workspaces.
 */
export function otherBroBotsIn(listing: string, own: ReadonlySet<number>): number {
  let count = 0
  for (const line of listing.split(/\r?\n/)) {
    const match = /^\s*(\d+)(?:\s+(.*))?$/.exec(line)
    if (match === null) continue
    if (own.has(Number(match[1])) || (match[2] ?? '').includes('--type=')) continue
    count += 1
  }
  return count
}

/** The command that lists the processes named like `executable`, as `<pid> <command line>` lines. */
export function listingCommand(executable: string): {
  readonly file: string
  readonly args: readonly string[]
} {
  const name = win32.basename(executable).replace(/'/g, "''")
  return {
    file: 'powershell.exe',
    args: [
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      `Get-CimInstance Win32_Process -Filter "Name='${name}'" | ForEach-Object { "$($_.ProcessId) $($_.CommandLine)" }`,
    ],
  }
}

/**
 * How many other BroBot workspaces run now, or `null` when the process table cannot be read — an
 * update then waits, rather than guess that nothing else is running.
 */
export function otherBroBotsRunning(
  executable: string,
  own: ReadonlySet<number>,
): Promise<number | null> {
  const { file, args } = listingCommand(executable)
  return new Promise((resolve) => {
    execFile(
      file,
      [...args],
      { timeout: 15_000, maxBuffer: 16 * 1024 * 1024, windowsHide: true },
      (error, stdout) => {
        resolve(error ? null : otherBroBotsIn(String(stdout), own))
      },
    )
  })
}
