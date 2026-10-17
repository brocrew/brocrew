/**
 * One launch's processes on Windows, which has no `ps`, no process groups and no signals: the
 * process table read through CIM, the launch known by the pid and creation time of each process it
 * started, and a teardown that ends that tree by pid with `taskkill` and then waits until none of
 * it is left in the table.
 *
 * A pid is only an address, as on any system: a process is ended only while its pid still carries
 * the creation time it had when it was seen as part of the launch, and nothing is ever found by
 * name. The lifecycle has the shape `tearDownAndRemove` (`owned-teardown.mjs`) reads: `kill9()`
 * answers `complete` only when every process it saw is gone and the table could be read.
 */
import { execFileSync } from 'node:child_process'
import { rmSync } from 'node:fs'

/** The process table as CIM gives it: pid, parent, creation time (FILETIME, UTC), program, args. */
const TABLE_COMMAND =
  'Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId,' +
  "@{n='Created';e={$_.CreationDate.ToFileTimeUtc()}},ExecutablePath,CommandLine | " +
  'ConvertTo-Json -Compress'

/** Rows of {@link TABLE_COMMAND}'s output: `{ pid, parentPid, created, executable, command }`. */
export function parseProcessTable(json) {
  const parsed = JSON.parse(json)
  const rows = Array.isArray(parsed) ? parsed : [parsed]
  return rows.flatMap((row) => {
    const pid = Number(row?.ProcessId)
    if (!Number.isSafeInteger(pid) || pid <= 0) return []
    return [
      {
        pid,
        parentPid: Number(row.ParentProcessId),
        created: String(row.Created ?? ''),
        executable: String(row.ExecutablePath ?? ''),
        command: String(row.CommandLine ?? ''),
      },
    ]
  })
}

export function readWindowsProcessTable() {
  const out = execFileSync(
    'powershell.exe',
    ['-NoProfile', '-NonInteractive', '-Command', TABLE_COMMAND],
    { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, timeout: 30_000, windowsHide: true },
  )
  return parseProcessTable(out)
}

/**
 * Every row descended from `root` in `table`, parents before children. A parent pid alone is not
 * enough on Windows, which reuses pids and never rewrites a child's parent: a row counts only when
 * it was created no earlier than the parent it names.
 */
export function descendantsIn(table, root) {
  const byParent = new Map()
  for (const row of table) {
    if (!byParent.has(row.parentPid)) byParent.set(row.parentPid, [])
    byParent.get(row.parentPid).push(row)
  }
  const found = []
  const seen = new Set([root.pid])
  const queue = [root]
  while (queue.length > 0) {
    const parent = queue.shift()
    for (const row of byParent.get(parent.pid) ?? []) {
      if (seen.has(row.pid) || BigInt(row.created || 0) < BigInt(parent.created || 0)) continue
      seen.add(row.pid)
      found.push(row)
      queue.push(row)
    }
  }
  return found
}

/** The pids `netstat -ano -p TCP` shows listening on `port`. */
export function listenersIn(netstat, port) {
  const pids = new Set()
  for (const line of netstat.split(/\r?\n/)) {
    const match = /^\s*TCP\s+(\S+):(\d+)\s+\S+\s+LISTENING\s+(\d+)\s*$/.exec(line)
    if (match !== null && Number(match[2]) === port) pids.add(Number(match[3]))
  }
  return [...pids]
}

/** Who listens on `port`, in `whoHoldsPort`'s shape (`port-probe.mjs`). */
export function whoHoldsPortOnWindows(port) {
  const out = execFileSync('netstat', ['-ano', '-p', 'TCP'], {
    encoding: 'utf8',
    timeout: 30_000,
    windowsHide: true,
  })
  const pids = listenersIn(out, port)
  return pids.length === 0 ? { state: 'free', pids } : { state: 'held', pids }
}

function blockingPause(milliseconds) {
  const cell = new Int32Array(new SharedArrayBuffer(Int32Array.BYTES_PER_ELEMENT))
  Atomics.wait(cell, 0, 0, milliseconds)
}

function taskkill(pid) {
  try {
    execFileSync('taskkill', ['/PID', String(pid), '/T', '/F'], {
      stdio: 'ignore',
      timeout: 30_000,
      windowsHide: true,
    })
  } catch {
    // Gone already, or going: the wait below is what says whether it went.
  }
}

/**
 * A lifecycle around the process this script spawned. Throws while that process is not yet in the
 * table, so a caller can try again for a bounded time.
 */
export function createWindowsLifecycle({
  launcherPid,
  readTable = readWindowsProcessTable,
  kill = taskkill,
  pause = blockingPause,
  attempts = 80,
  intervalMs = 250,
}) {
  const first = readTable().find((row) => row.pid === launcherPid)
  if (first === undefined) throw new Error(`process ${String(launcherPid)} is not in the table`)
  const launcher = Object.freeze({ pid: first.pid, created: first.created })
  const remembered = new Map([[launcher.pid, launcher]])
  const isOurs = (row) => remembered.get(row.pid)?.created === row.created

  /** The launch's processes in `table`: the launcher and what it started, parents first. */
  const treeIn = (table) => {
    const root = table.find(isOurs)
    if (root === undefined || root.pid !== launcher.pid) return table.filter(isOurs)
    return [root, ...descendantsIn(table, root)]
  }

  const refreshDescendants = () => {
    try {
      for (const row of treeIn(readTable())) {
        if (!remembered.has(row.pid)) {
          remembered.set(row.pid, Object.freeze({ pid: row.pid, created: row.created }))
        }
      }
      return true
    } catch {
      return false
    }
  }

  /** The launch's processes as they are now, with their program and arguments. */
  const processes = () => {
    refreshDescendants()
    return readTable().filter(isOurs)
  }

  const kill9 = () => {
    const discovered = refreshDescendants()
    let table
    try {
      table = readTable()
    } catch (error) {
      return Object.freeze({ complete: false, alive: [], unverifiable: [String(error)] })
    }
    // The launcher first, so its tree goes with it; then any process of it that outlived it.
    for (const row of table.filter(isOurs)) kill(row.pid)
    let alive = []
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      try {
        alive = readTable()
          .filter(isOurs)
          .map((row) => row.pid)
      } catch (error) {
        return Object.freeze({ complete: false, alive, unverifiable: [String(error)] })
      }
      if (alive.length === 0) break
      for (const pid of alive) kill(pid)
      pause(intervalMs)
    }
    return Object.freeze({
      complete: discovered && alive.length === 0,
      alive,
      unverifiable: discovered ? [] : ['the launch tree could not be read before the teardown'],
    })
  }

  return Object.freeze({
    launcher,
    refreshDescendants,
    processes,
    kill9,
    get identities() {
      return Object.freeze([...remembered.values()])
    },
  })
}

/**
 * Removes a launch's folder once its processes are gone. Windows may still hold a file open for a
 * moment after a process ends (an indexer, a virus scan), so the removal is tried again for about
 * eleven seconds; a folder that never frees throws, and the run fails.
 */
export function removeOnceFree(path) {
  rmSync(path, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 })
}
