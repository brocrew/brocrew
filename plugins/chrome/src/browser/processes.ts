import { execFile } from 'node:child_process'
import path from 'node:path'
export type Platform = NodeJS.Platform
export type Signal = 'SIGTERM' | 'SIGKILL'
export type RunProgram = (file: string, args: readonly string[]) => Promise<string | null>
export const realRun: RunProgram = (file, args) =>
  new Promise((resolve) => {
    execFile(
      file,
      [...args],
      { maxBuffer: 16 * 1024 * 1024, timeout: 10000, windowsHide: true },
      (error, stdout) => resolve(error ? null : stdout),
    )
  })
export const BROWSER_EXE = /^(google chrome|chromium|chrome|msedge|microsoft[- ]edge)/i
export const WINDOWS_LIST_SCRIPT =
  '[Console]::OutputEncoding=[Text.Encoding]::UTF8; Get-CimInstance Win32_Process | Select-Object ProcessId,CommandLine,Name | ConvertTo-Csv -NoTypeInformation'
function csvRows(text: string): string[][] | undefined {
  const rows: string[][] = []
  let row: string[] = [],
    field = '',
    quoted = false,
    closed = false
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') {
        field += '"'
        i++
      } else if (c === '"') {
        quoted = false
        closed = true
      } else field += c
    } else if (c === ',') {
      row.push(field)
      field = ''
      closed = false
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++
      row.push(field)
      field = ''
      closed = false
      if (row.length > 1 || row[0] !== '') rows.push(row)
      row = []
    } else if (c === '"') {
      if (field !== '' || closed) return undefined
      quoted = true
    } else {
      if (closed) return undefined
      field += c
    }
  }
  if (quoted) return undefined
  if (field !== '' || row.length > 0 || closed) {
    row.push(field)
    rows.push(row)
  }
  return rows
}
export interface CimProcessRow {
  pid: number
  command: string
  name: string
}
/** Keep every CIM row, including an unquoted null CommandLine. Absence proofs need its identity. */
export function parseCimRows(csv: string): CimProcessRow[] | undefined {
  const rows = csvRows(csv.replace(/^\uFEFF/, ''))
  if (!rows?.length) return undefined
  const header = rows[0].map((field) => field.toLowerCase())
  const pidAt = header.indexOf('processid'),
    commandAt = header.indexOf('commandline'),
    nameAt = header.indexOf('name')
  if (
    pidAt < 0 ||
    commandAt < 0 ||
    new Set(header).size !== header.length ||
    header.some((field) => !['processid', 'commandline', 'name'].includes(field))
  )
    return undefined
  const result: CimProcessRow[] = []
  for (const fields of rows.slice(1)) {
    if (fields.length !== header.length || !/^\d+$/.test(fields[pidAt])) return undefined
    const pid = Number(fields[pidAt])
    if (!Number.isSafeInteger(pid) || pid < 0 || pid > 0xffffffff) return undefined
    const name = nameAt < 0 ? '' : fields[nameAt].trim()
    if (/[\r\n\0]/.test(name)) return undefined
    result.push({ pid, command: fields[commandAt].trim(), name })
  }
  return result
}
/** Command-bearing adapter for positive process matching; never use its count as an absence proof. */
export function parseCimCsv(csv: string): string {
  return (parseCimRows(csv) ?? [])
    .filter((row) => row.command)
    .map((row) => `${row.pid} ${row.command.replace(/\s+/g, ' ')}`)
    .join('\n')
}
export async function processList(
  platform: Platform = process.platform,
  run: RunProgram = realRun,
): Promise<string> {
  if (platform === 'win32') {
    const out = await run('powershell', [
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      WINDOWS_LIST_SCRIPT,
    ])
    return out === null ? '' : parseCimCsv(out)
  }
  return (await run('ps', ['-axo', 'pid=,command='])) ?? ''
}
export async function commandOfPid(pid: number, run: RunProgram = realRun): Promise<string | null> {
  const out = await run('ps', ['-p', String(pid), '-o', 'command='])
  return out === null ? null : out.trim() || null
}
export interface BrowserProcess {
  pid: number
  command: string
}
export function browserProcessesOf(
  listText: string,
  dir: string,
  platform: Platform = process.platform,
): BrowserProcess[] {
  const win = platform === 'win32'
  const flag = win ? `=${dir}`.toLowerCase() : `=${dir}`
  const quotedFlag = `="${dir.toLowerCase()}`
  const found: BrowserProcess[] = []
  for (const line of listText.split('\n')) {
    const m = /^\s*(\d+)\s+(.*)$/.exec(line)
    if (!m) continue
    const command = m[2]
    const exe = win
      ? (/^"([^"]*)"/.exec(command)?.[1] ?? command.split(' ')[0])
      : command.split(' --')[0]
    if (!BROWSER_EXE.test((win ? path.win32 : path.posix).basename(exe))) continue
    const haystack = win ? command.toLowerCase() : command
    let at = haystack.indexOf(flag)
    if (at < 0 && win) {
      at = haystack.indexOf(quotedFlag)
      if (at >= 0) at += 1
    }
    const after = at >= 0 ? haystack[at + flag.length] : undefined
    if (at >= 0 && (after === undefined || after === ' ' || (win && after === '"')))
      found.push({ pid: Number(m[1]), command })
  }
  return found
}
export const browserPidsOf = async (
  dir: string,
  list: () => Promise<string>,
  platform: Platform = process.platform,
): Promise<number[]> => browserProcessesOf(await list(), dir, platform).map((p) => p.pid)
export interface EndDeps {
  platform?: Platform
  list?: () => Promise<string>
  run?: RunProgram
  kill?: (pid: number, signal: Signal) => void
  sleep?: (ms: number) => Promise<void>
  now?: () => number
  mainWaitMs?: number
}
export const MAIN_TERM_WAIT_MS = 1500
const isMain = (p: BrowserProcess): boolean => !/ --type=/.test(p.command)
const sleepFor = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))
/**
 * Ends what still runs on this profile folder. On Windows the plugin host holds every process this
 * server starts in a job: Playwright's own force-close ends the browser through its handle, its
 * child processes end with it, and anything left ends with the job; a sweep there by process
 * number could reach a process that took a number since it was listed.
 */
export async function endBrowsersOf(
  dir: string,
  graceMs: number,
  deps: EndDeps = {},
): Promise<void> {
  const platform = deps.platform ?? process.platform
  if (platform === 'win32') return
  const run = deps.run ?? realRun
  const list = deps.list ?? (() => processList(platform, run))
  const kill = deps.kill ?? ((pid: number, signal: Signal) => process.kill(pid, signal))
  const sleep = deps.sleep ?? sleepFor
  const now = deps.now ?? Date.now
  const mine = async (): Promise<BrowserProcess[]> =>
    browserProcessesOf(await list(), dir, platform)
  const signal = (pids: number[], sig: Signal): void => {
    for (const pid of pids) {
      try {
        kill(pid, sig)
      } catch {
        /* Continue without this optional result. */
      }
    }
  }
  const mains = (await mine()).filter(isMain).map((p) => p.pid)
  if (mains.length > 0) {
    signal(mains, 'SIGTERM')
    const mainEnd = now() + (deps.mainWaitMs ?? MAIN_TERM_WAIT_MS)
    while ((await mine()).some(isMain) && now() < mainEnd) await sleep(100)
  }
  signal(
    (await mine()).map((p) => p.pid),
    'SIGTERM',
  )
  const end = now() + graceMs
  while ((await mine()).length > 0 && now() < end) await sleep(200)
  const left = (await mine()).map((p) => p.pid)
  if (left.length === 0) return
  signal(left, 'SIGKILL')
}
export async function lockfileBusy(
  file: string,
  open: (p: string) => Promise<{
    close(): Promise<void>
  }>,
): Promise<boolean> {
  let handle: {
    close(): Promise<void>
  }
  try {
    handle = await open(file)
  } catch (e) {
    const code = (e as NodeJS.ErrnoException)?.code
    return code === 'EBUSY' || code === 'EPERM' || code === 'EACCES'
  }
  await handle.close().catch(() => undefined)
  return false
}
