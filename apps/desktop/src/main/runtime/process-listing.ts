import { execFile } from 'node:child_process'
import { withDeadline } from '@brobot2/runtime'
import type { Provider } from '@brobot2/shared'
import type { ProviderResources } from '../../shared/runtime-ipc'
import { PS_MAX_BUFFER_BYTES, PS_READ_DEADLINE_MS, PS_TIMEOUT_MS } from '../process-tree'

/**
 * ⚑ **What the agent processes this app started use** — for a person's Providers screen.
 *
 * ⛔ **Cheap above all.** One process listing per sample, never one per pid; a sample only when a
 * screen asks, at most every five seconds and one at a time (`RuntimeHost.providerResources`); and
 * nothing on any other path. ⛔ **By pid, never by name**: the roots are the pids this app's own
 * adapters hold for the children they spawned (`SessionHandle.providerPid`), and a process counts
 * only as one of them or as one they started in turn — a tool command, found by its parent pid.
 *
 * ⚑ `process-tree.ts` reads the same table for the memory watchdog, with the command where this
 * reads the CPU; its bounds are this listing's too, for its reasons.
 */

/** One process, as one line of the listing says it. */
export interface ListedProcess {
  readonly pid: number
  readonly ppid: number
  /** Resident memory, in KiB: `ps`'s resident size, or the working set on Windows. */
  readonly rssKb: number
  /**
   * Its CPU — 100 is one full core: `ps`'s own average, or on Windows the CPU time it used over its
   * whole life, divided by that life.
   */
  readonly cpu: number
}

/** What a person reads when a listing that can be made failed this once. */
export const NOT_LISTED_JUST_NOW = 'This computer did not list its processes just now.'

/**
 * The same, where the listing is asked again within seconds: the Providers screen, which samples
 * for as long as it is looked at. ⛔ Not for a reader nothing asks again soon.
 */
export const NOT_LISTED_AND_ASKED_AGAIN =
  'This computer did not list its processes just now; it is asked again in a moment.'

/** Runs a PowerShell command and answers what it printed. */
export type RunPowerShell = (command: string) => Promise<string>

/**
 * ⚑ **One listing of every process**: `ps -axo pid=,ppid=,rss=,%cpu=` — four numbers a line, no
 * command, no arguments and no environment. ⛔ Rejects when `ps` could not answer, and the caller
 * says so.
 *
 * ⚑ **On Windows, which has no `ps`, the same four facts from CIM's `Win32_Process`**
 * ({@link WINDOWS_LISTING}), through PowerShell as `other-brobots.ts` reads it.
 *
 * ⚠️ **`LC_ALL=C`, or the CPU column is unreadable**: under a locale that writes a decimal comma,
 * `ps` prints `%cpu` as `1,5`, and every line would be skipped. A listing with no readable line is
 * a failure for the same reason: this app's own process is always in it.
 *
 * ⚑ SIGKILL at its timeout, as the watchdog's: `ps` has nothing to clean up. ⚑ And the deadline
 * releases the caller if the callback never comes, so a wedged `ps` cannot hold every later sample.
 */
export function listProcesses(
  platform: NodeJS.Platform = process.platform,
  runPowerShell: RunPowerShell = powerShell,
): Promise<readonly ListedProcess[]> {
  return platform === 'win32' ? listWithCim(runPowerShell) : listWithPs()
}

/**
 * Each pid's resident memory, in bytes, from one listing; a pid the listing does not hold is left
 * out, as `ps -p` leaves out one that is not running.
 */
export function memoryOf(
  pids: readonly number[],
  rows: readonly ListedProcess[],
): ReadonlyMap<number, number> {
  const asked = new Set(pids)
  return new Map(rows.filter((row) => asked.has(row.pid)).map((row) => [row.pid, row.rssKb * 1024]))
}

/**
 * Every process as `pid ppid working-set cpu-time created now`: bytes, then the CPU time used in
 * kernel and user mode and the two instants, all in 100-nanosecond units. A process with no
 * creation time (the system's own) is given 0, and its CPU is then read as 0.
 */
export const WINDOWS_LISTING =
  '$now = [DateTime]::UtcNow.ToFileTimeUtc(); ' +
  'Get-CimInstance Win32_Process | ForEach-Object { ' +
  '$born = if ($_.CreationDate) { $_.CreationDate.ToFileTimeUtc() } else { 0 }; ' +
  '"$($_.ProcessId) $($_.ParentProcessId) $($_.WorkingSetSize) ' +
  '$($_.KernelModeTime + $_.UserModeTime) $born $now" }'

/** PowerShell starts slower than `ps` answers: its own bounds, inside the same kind of deadline. */
const WINDOWS_LISTING_TIMEOUT_MS = 15_000
const WINDOWS_LISTING_DEADLINE_MS = 20_000

function powerShell(command: string): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-Command', command],
      {
        timeout: WINDOWS_LISTING_TIMEOUT_MS,
        maxBuffer: PS_MAX_BUFFER_BYTES,
        encoding: 'utf8',
        windowsHide: true,
      },
      (error, stdout) => (error ? reject(error) : resolve(stdout)),
    )
  })
}

async function listWithCim(run: RunPowerShell): Promise<readonly ListedProcess[]> {
  const listing = await withDeadline(
    run(WINDOWS_LISTING),
    WINDOWS_LISTING_DEADLINE_MS,
    'the process listing',
  )
  const rows = parseWindowsListing(listing)
  if (rows.length === 0) throw new Error('the process listing had no line it could read')
  return rows
}

/** {@link WINDOWS_LISTING}'s lines as rows; a line that is not six whole numbers is skipped. */
export function parseWindowsListing(listing: string): ListedProcess[] {
  return listing.split(/\r?\n/).flatMap((line) => {
    const fields = line.trim().split(/\s+/)
    if (fields.length !== 6 || !fields.every((field) => /^\d+$/.test(field))) return []
    const [pid, ppid, workingSet, cpuTime, born, now] = fields.map(Number) as [
      number,
      number,
      number,
      number,
      number,
      number,
    ]
    const lived = now - born
    const cpu = born > 0 && lived > 0 ? Math.round((cpuTime / lived) * 1000) / 10 : 0
    return [{ pid, ppid, rssKb: Math.round(workingSet / 1024), cpu }]
  })
}

function listWithPs(): Promise<readonly ListedProcess[]> {
  return withDeadline(
    new Promise<readonly ListedProcess[]>((resolve, reject) => {
      execFile(
        'ps',
        ['-axo', 'pid=,ppid=,rss=,%cpu='],
        {
          env: { ...process.env, LC_ALL: 'C' },
          timeout: PS_TIMEOUT_MS,
          killSignal: 'SIGKILL',
          maxBuffer: PS_MAX_BUFFER_BYTES,
          encoding: 'utf8',
        },
        (error, stdout) => {
          if (error) {
            reject(error)
            return
          }
          const rows = parseProcessListing(stdout)
          if (rows.length === 0) reject(new Error('the process listing had no line it could read'))
          else resolve(rows)
        },
      )
    }),
    PS_READ_DEADLINE_MS,
    'the process listing',
  )
}

/** The listing's lines as rows; a line that is not four numbers is skipped. */
function parseProcessListing(listing: string): ListedProcess[] {
  return listing.split('\n').flatMap((line) => {
    const fields = line.trim().split(/\s+/)
    if (fields.length !== 4) return []
    const [pid, ppid, rssKb, cpu] = fields.map(Number)
    if (
      pid === undefined ||
      ppid === undefined ||
      rssKb === undefined ||
      cpu === undefined ||
      ![pid, ppid, rssKb, cpu].every(Number.isFinite)
    ) {
      return []
    }
    return [{ pid, ppid, rssKb, cpu }]
  })
}

/**
 * ⚑ **Each provider's sum, from one listing** — its roots that are still in the listing, and every
 * process under them, each counted once. ⚑ `running` is how many roots the listing still holds.
 */
export function resourcesFromTheListing(
  rows: readonly ListedProcess[],
  roots: Readonly<Record<Provider, readonly number[]>>,
  at: number,
): Readonly<Record<Provider, ProviderResources>> {
  const byPid = new Map(rows.map((row) => [row.pid, row]))
  const children = new Map<number, number[]>()
  for (const row of rows) {
    if (row.ppid === row.pid) continue
    const siblings = children.get(row.ppid)
    if (siblings === undefined) children.set(row.ppid, [row.pid])
    else siblings.push(row.pid)
  }
  const counted = new Set<number>()
  const sum = (provider: Provider): ProviderResources => {
    let running = 0
    let rssKb = 0
    let cpu = 0
    for (const root of roots[provider]) {
      if (!byPid.has(root)) continue
      running += 1
      const waiting = [root]
      while (waiting.length > 0) {
        const pid = waiting.pop()
        if (pid === undefined || counted.has(pid)) continue
        const row = byPid.get(pid)
        if (row === undefined) continue
        counted.add(pid)
        rssKb += row.rssKb
        cpu += row.cpu
        waiting.push(...(children.get(pid) ?? []))
      }
    }
    return { running, rssBytes: rssKb * 1024, cpuPercent: Math.round(cpu * 10) / 10, at }
  }
  return { claude: sum('claude'), codex: sum('codex') }
}
