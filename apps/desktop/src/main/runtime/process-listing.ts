import { execFile } from 'node:child_process'
import { withDeadline } from '@brobot2/runtime'
import { providerRecord, type Provider } from '@brobot2/shared'
import type { ProviderResources } from '../../shared/runtime-ipc'
import { PS_MAX_BUFFER_BYTES, PS_READ_DEADLINE_MS, PS_TIMEOUT_MS } from '../process-tree'

export interface ListedProcess {
  readonly pid: number
  readonly ppid: number
  readonly rssKb: number
  readonly cpu: number
}

export type RunPowerShell = (command: string) => Promise<string>

export function listProcesses(
  platform: NodeJS.Platform = process.platform,
  runPowerShell: RunPowerShell = powerShell,
): Promise<readonly ListedProcess[]> {
  return platform === 'win32' ? listWithCim(runPowerShell) : listWithPs()
}

export function memoryOf(
  pids: readonly number[],
  rows: readonly ListedProcess[],
): ReadonlyMap<number, number> {
  const asked = new Set(pids)
  return new Map(rows.filter((row) => asked.has(row.pid)).map((row) => [row.pid, row.rssKb * 1024]))
}

export const WINDOWS_LISTING =
  '$now = [DateTime]::UtcNow.ToFileTimeUtc(); ' +
  'Get-CimInstance Win32_Process | ForEach-Object { ' +
  '$born = if ($_.CreationDate) { $_.CreationDate.ToFileTimeUtc() } else { 0 }; ' +
  '"$($_.ProcessId) $($_.ParentProcessId) $($_.WorkingSetSize) ' +
  '$($_.KernelModeTime + $_.UserModeTime) $born $now" }'

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
  return providerRecord(sum)
}
