import { execFile, spawn } from 'node:child_process'

/**
 * A process tree on Windows, which has no process groups and no signals: what a leader started is
 * found in the process table by parent and creation time, and each process is ended through a handle
 * opened on it once its creation time says it is still the one found. ⚠️ A process keeps the number
 * of the parent that started it after that parent exits, so what an exited process started is still
 * found under its number when that process was seen running, and was started before it was last
 * seen running: after that, its number may belong to a stranger.
 *
 * ⚠️ **What this cannot find**: a program started by a process that no reading saw running — a
 * launcher that starts it and exits between two readings — or started by a seen process after the
 * last reading that saw it. Readings cannot close that; a job object that ends its processes when
 * closed would.
 */

/** One process as the table lists it. `created` is a FILETIME (100 ns since 1601), 0 when unknown. */
export interface TableRow {
  readonly pid: number
  readonly ppid: number
  readonly created: bigint
}

/** One reading: when it was taken, as a FILETIME, and every process it listed, running then. */
export interface TableReading {
  readonly at: bigint
  readonly rows: readonly TableRow[]
}

/** A process found in a tree, and the last time a reading saw it running. */
export interface KnownRow extends TableRow {
  readonly seenAt: bigint
}

/** The leader of a tree: its number, when it was started, and when it exited (null while it runs). */
export interface TreeLeader {
  readonly pid: number
  readonly startedAt: bigint
  readonly endedAt: bigint | null
}

/**
 * `at <now>`, the time just before the table is listed, then each process as `pid ppid created`,
 * the times as FILETIMEs, a creation time of 0 for the system's own.
 */
const TABLE_COMMAND =
  '"at $([DateTime]::UtcNow.ToFileTimeUtc())"; ' +
  'Get-CimInstance Win32_Process | ForEach-Object { ' +
  '$born = if ($_.CreationDate) { $_.CreationDate.ToFileTimeUtc() } else { 0 }; ' +
  '"$($_.ProcessId) $($_.ParentProcessId) $born" }'

/** A clock read just before a spawn may run a little behind the creation time the system records. */
const SLACK = 10_000_000n

/** A time in milliseconds since 1970, as a FILETIME. */
export function fileTimeOf(ms: number): bigint {
  return (BigInt(Math.trunc(ms)) + 11_644_473_600_000n) * 10_000n
}

/** The table's lines as rows; a line that is not three whole numbers is skipped. */
export function parseTable(text: string): TableRow[] {
  return text.split(/\r?\n/).flatMap((line) => {
    const fields = line.trim().split(/\s+/)
    if (fields.length !== 3 || !fields.every((field) => /^\d+$/.test(field))) return []
    return [{ pid: Number(fields[0]), ppid: Number(fields[1]), created: BigInt(fields[2]!) }]
  })
}

/** A reading's text: its time and its rows, or null without a time or a row. */
export function parseReading(text: string): TableReading | null {
  const at = /^at (\d+)\r?$/m.exec(text)?.[1]
  const rows = parseTable(text)
  return at === undefined || rows.length === 0 ? null : { at: BigInt(at), rows }
}

/** A process by its number and when it was created: what tells it from a later one with its number. */
const keyOf = (row: TableRow): string => `${String(row.pid)}:${String(row.created)}`

/**
 * The processes in one reading of the table that belong to the leader's tree: the leader while it
 * runs, every process in `known` (what earlier readings found in the tree) that still runs, and
 * everything started under the leader or under any of those.
 *
 * A child counts only when created no earlier than its parent; under a known process that no longer
 * runs, only when created no later than a reading last saw that process running; and under a leader
 * that has exited, no later than its exit. So a number reused by a stranger, and what the stranger
 * started, are not ours.
 */
export function treeOf(
  rows: readonly TableRow[],
  leader: TreeLeader,
  known: readonly KnownRow[] = [],
): TableRow[] {
  const byParent = new Map<number, TableRow[]>()
  const holder = new Map<number, TableRow>()
  for (const row of rows) {
    holder.set(row.pid, row)
    if (row.pid === row.ppid) continue
    const siblings = byParent.get(row.ppid)
    if (siblings === undefined) byParent.set(row.ppid, [row])
    else siblings.push(row)
  }
  const found = new Map<string, TableRow>()
  /** A parent to look under: its children are created from `from`, and before `before` if set. */
  const waiting: { pid: number; from: bigint; before: bigint | null }[] = []
  const itself = holder.get(leader.pid)
  const leaderRuns =
    itself !== undefined &&
    itself.created >= leader.startedAt - SLACK &&
    (leader.endedAt === null || itself.created <= leader.endedAt)
  if (leaderRuns) {
    found.set(keyOf(itself), itself)
    waiting.push({ pid: leader.pid, from: itself.created, before: null })
  } else {
    waiting.push({
      pid: leader.pid,
      from: leader.startedAt - SLACK,
      before: leader.endedAt === null ? null : leader.endedAt + SLACK + 1n,
    })
  }
  for (const one of known) {
    const now = holder.get(one.pid)
    const runs = now !== undefined && now.created === one.created
    if (runs) found.set(keyOf(now), now)
    waiting.push({ pid: one.pid, from: one.created, before: runs ? null : one.seenAt + 1n })
  }
  const looked = new Set<string>()
  for (let next = waiting.pop(); next !== undefined; next = waiting.pop()) {
    const where = `${String(next.pid)}:${String(next.from)}`
    if (looked.has(where)) continue
    looked.add(where)
    for (const row of byParent.get(next.pid) ?? []) {
      if (row.created < next.from) continue
      if (next.before !== null && row.created >= next.before) continue
      if (found.has(keyOf(row))) continue
      found.set(keyOf(row), row)
      waiting.push({ pid: row.pid, from: row.created, before: null })
    }
  }
  return [...found.values()]
}

/** One reading of the process table within `ms`, or null when it could not be read in time. */
export function readTable(ms: number): Promise<TableReading | null> {
  if (ms <= 0) return Promise.resolve(null)
  return new Promise((resolve) => {
    execFile(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-Command', TABLE_COMMAND],
      { timeout: ms, maxBuffer: 16 * 1024 * 1024, encoding: 'utf8', windowsHide: true },
      (error, stdout) => resolve(error ? null : parseReading(stdout)),
    )
  })
}

/** What became of one process asked to be ended. */
export type Ending =
  /** It was ended, and has exited. */
  | 'ended'
  /** It was ended, and still ran when the time was up. */
  | 'alive'
  /** Nothing runs under its number any more. */
  | 'gone'
  /** Its number belongs to another process now, which is left alone. */
  | 'another'
  /** It could not be opened or ended, or no answer came in time. */
  | 'failed'

/** A helper that ends processes by number and creation time, started before it is needed. */
export interface Ender {
  /** Ends each of `rows` still running as the process found, and says what became of each. */
  end(rows: readonly TableRow[], ms: number): Promise<Map<string, Ending>>
  /** Lets the helper go, ending nothing. */
  dismiss(): void
}

/**
 * Reads one line, `pid:created …|ms`. For each, opens the process by its number, and through that
 * handle checks its creation time and ends it: a number reused since is another process, which is
 * left alone. Then waits up to `ms` in all for those it ended, through the same handles. `$id`, not
 * `$pid`, which PowerShell keeps for its own number.
 */
const ENDER_COMMAND =
  '$line = [Console]::In.ReadLine(); if (-not $line) { exit 0 }; ' +
  "$parts = $line.Split('|'); $until = [DateTime]::UtcNow.AddMilliseconds([int]$parts[1]); " +
  '$ending = @(); ' +
  "foreach ($t in $parts[0].Split(' ', [StringSplitOptions]::RemoveEmptyEntries)) { " +
  "$id, $born = $t.Split(':'); " +
  'try { $p = [System.Diagnostics.Process]::GetProcessById([int]$id) } catch { "gone $t"; continue }; ' +
  'try { $null = $p.Handle; ' +
  'if ([Math]::Abs($p.StartTime.ToFileTimeUtc() - [long]$born) -ge 10) { "another $t"; continue }; ' +
  '$p.Kill(); $ending += ,@($t, $p) } ' +
  'catch { if ($p.HasExited) { "gone $t" } else { "failed $t" } } }; ' +
  'foreach ($e in $ending) { ' +
  '$left = [Math]::Max(0, [int]($until - [DateTime]::UtcNow).TotalMilliseconds); ' +
  'if ($e[1].WaitForExit($left)) { "ended $($e[0])" } else { "alive $($e[0])" } }'

/** The answers an ender printed, by process; one not answered is `failed`. */
export function endingsOf(text: string, rows: readonly TableRow[]): Map<string, Ending> {
  const said = new Map<string, Ending>()
  for (const line of text.split(/\r?\n/)) {
    const [word, key] = line.trim().split(' ')
    if (key !== undefined && /^(ended|alive|gone|another|failed)$/.test(word ?? '')) {
      said.set(key, word as Ending)
    }
  }
  return new Map(rows.map((row) => [keyOf(row), said.get(keyOf(row)) ?? 'failed']))
}

/** The ender, through PowerShell, started now so it is ready by the time it is asked. */
export function startEnder(): Ender {
  let child: ReturnType<typeof spawn> | null
  try {
    child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', ENDER_COMMAND], {
      stdio: ['pipe', 'pipe', 'ignore'],
      windowsHide: true,
    })
    child.on('error', () => {})
    child.stdin?.on('error', () => {})
  } catch {
    child = null
  }
  let printed = ''
  child?.stdout?.setEncoding('utf8')
  child?.stdout?.on('data', (chunk: string) => {
    printed += chunk
  })
  const exited =
    child === null
      ? Promise.resolve()
      : new Promise<void>((resolve) => {
          child.once('exit', () => resolve())
          child.once('error', () => resolve())
        })
  return {
    async end(rows, ms) {
      if (child === null || rows.length === 0) {
        child?.stdin?.end()
        return endingsOf('', rows)
      }
      child.stdin?.end(`${rows.map(keyOf).join(' ')}|${String(Math.max(0, Math.trunc(ms)))}\n`)
      let timer: ReturnType<typeof setTimeout> | undefined
      const late = new Promise<void>((resolve) => {
        timer = setTimeout(resolve, ms)
        timer.unref?.()
      })
      await Promise.race([exited, late])
      clearTimeout(timer)
      child.kill()
      return endingsOf(printed, rows)
    },
    dismiss() {
      child?.stdin?.end()
    },
  }
}

/** Whether some process holds this number now: a wait, never a reason to end it. */
export function isRunning(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM'
  }
}

/** How long before the end of the stop budget the ending starts, so it is done within the budget. */
export const ENDING_RESERVE_MS = 1_500

/** What ending a tree takes, and the times it has. */
export interface TreeEnding {
  readonly leader: { readonly pid: number; readonly startedAt: bigint }
  /** When the leader exited, as a FILETIME; null while it runs. */
  leaderEndedAt(): bigint | null
  /** True once the leader has exited; false if `ms` elapses first. */
  awaitLeader(ms: number): Promise<boolean>
  /** Ends the leader through the handle its spawn holds. */
  endLeader(): void
  /** What earlier readings found in the tree. */
  known(): readonly KnownRow[]
  /** Keeps what a reading taken `at` found running in the tree. */
  remember(rows: readonly TableRow[], at: bigint): void
  read(ms: number): Promise<TableReading | null>
  startEnder(): Ender
  isRunning(pid: number): boolean
  now(): number
  sleep(ms: number): Promise<void>
  /** The leader's own stop, the time what outlives it has to end on its own, and the whole budget. */
  readonly graceMs: number
  readonly killGraceMs: number
  readonly budgetMs: number
  warn(line: string): void
}

/**
 * Ends what a leader started, and the leader, within the stop budget. The table is read, and the
 * ender started, at once, while the leader is given its graceful stop; what outlives the leader is
 * given `killGraceMs` to end on its own; then, {@link ENDING_RESERVE_MS} before the budget ends at
 * the latest, the leader is ended through its own handle and every other process of the tree by
 * number and creation time. When the reading is not back by then, the processes earlier readings
 * found are ended: a slow table never takes the time the ending needs.
 */
export async function endTree(t: TreeEnding): Promise<boolean> {
  const start = t.now()
  const budgetEnd = start + t.budgetMs
  const endBy = budgetEnd - ENDING_RESERVE_MS
  const ender = t.startEnder()
  let read: TableReading | null | undefined
  const reading = t.read(Math.max(0, endBy - start)).then((answer) => {
    read = answer
  })
  const left = (until: number): number => Math.max(0, until - t.now())
  const exited = await t.awaitLeader(Math.min(t.graceMs, left(endBy)))
  const leaderPid = t.leader.pid
  /** What of the tree is not the leader, which is ended through its own handle. */
  const others = (): TableRow[] => {
    if (!read) return t.known().filter((row) => row.pid !== leaderPid)
    const tree = treeOf(read.rows, { ...t.leader, endedAt: t.leaderEndedAt() }, t.known())
    t.remember(tree, read.at)
    return tree.filter((row) => row.pid !== leaderPid)
  }
  if (exited) {
    await Promise.race([reading, t.sleep(left(endBy))])
    const outlived = others()
    const ownEnd = Math.min(t.now() + t.killGraceMs, endBy)
    while (outlived.some((row) => t.isRunning(row.pid)) && t.now() < ownEnd) {
      await t.sleep(Math.min(20, left(ownEnd)))
    }
  }
  const leaderRuns = t.leaderEndedAt() === null
  if (leaderRuns) t.endLeader()
  const cleanedReading = read
  const targets = others().filter((row) => t.isRunning(row.pid))
  if (targets.length === 0) ender.dismiss()
  const endings = targets.length === 0 ? new Map() : await ender.end(targets, left(budgetEnd))
  const leaderGone = !leaderRuns || (await t.awaitLeader(left(budgetEnd)))
  const still = [...endings]
    .filter(([, ending]) => ending === 'alive' || ending === 'failed')
    .map(([key, ending]) => `${key} ${ending}`)
  if (!cleanedReading) {
    t.warn(
      `codex app-server ${String(leaderPid)}: the process table was not read in time, so only ` +
        'the processes found before were ended; what it started since may still be running',
    )
  }
  if (!leaderGone) still.unshift(`${String(leaderPid)} (the app-server itself) alive`)
  if (still.length > 0) {
    t.warn(
      `codex app-server ${String(leaderPid)}: may still be running after ${String(t.budgetMs)}ms: ` +
        still.join(', '),
    )
  }
  return cleanedReading != null && leaderGone && still.length === 0
}
