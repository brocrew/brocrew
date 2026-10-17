/**
 * The part of this app that `app.getAppMetrics()` cannot see (053).
 *
 * ## Why this exists
 *
 * 052 built the memory watchdog on `app.getAppMetrics()` and documented it as watching "the WHOLE
 * process tree, not just main". It does not. It watches the whole **Chromium** tree — browser,
 * renderers, GPU, utilities — and BroBot2's entire purpose is to run coding agents, which it starts
 * with `child_process.spawn` (`codex-transport.ts`). A spawned binary is not a Chromium process and
 * does not appear in that list.
 *
 * Measured, not inferred: an Electron main process spawned a child that held **860 MB** by `ps`,
 * and `getAppMetrics()` moved by 0 MB for it — the only delta was the GPU and utility processes
 * starting up. The probe is in the 053 response.
 *
 * That made the instrument **worse than absent**. The 26 GB was read off Activity Monitor, which
 * shows the OS tree; the watchdog reports Chromium only. Had it been running during the incident it
 * would have printed a low, reassuring total and named nothing — and it would have been blindest to
 * the class of process most likely to be holding gigabytes, since an agent is the thing that reads
 * a 1.43 GB transcript.
 *
 * ⚑ **Since 2026-10-03 the watchdog counts the app itself again, and this module's figure is said
 * apart in the same line** (`memory-watch.ts`): added to the app's own, the agents' test runs read as
 * the app growing — 63–95% of every total it reported was theirs. ⚑ It also has a line of its own,
 * past a floor only a runaway reaches, naming the agents holding the most ({@link SpawnedProcess.head}
 * says whose each process is).
 *
 * ## What it does, and what it deliberately does not
 *
 * One `ps` per sample, parsed once into a parent→children map and walked from our own pid. One fork
 * every 30 seconds costs nothing. Forking per process — the shape the soak script used, which is
 * fine for a script — would not be, and this runs inside the app being measured.
 *
 * It does **not** kill, throttle or report anything itself. It is a source of numbers for
 * {@link startMemoryWatch}, which is the thing with a policy — ⚑ and, since D-018, for the agent
 * cards' memory line, which reads the same columns for its conversations' own pids alone
 * ({@link psArgsFor}).
 *
 * ## ⚠️ Its figure is another metric than the app's own
 *
 * `getAppMetrics()` reports `workingSetSize`, which on macOS is Chromium's `phys_footprint`:
 * dirty pages, with shared clean pages excluded. `ps rss` counts every resident page, shared library
 * text included — so N agents each get charged for the same copy of the Node runtime and libSystem,
 * and this figure OVERSTATES, by roughly the shared footprint of each spawned process.
 *
 * That is accepted deliberately and is worth stating rather than hiding. At the scale that matters —
 * a process holding tens of gigabytes — the overstatement is a rounding error against anonymous
 * dirty memory, and a figure that is high by 100 MB and RIGHT about which process grew beats a figure
 * that is perfectly consistent and silent. ⚑ The watchdog says the two apart, never summed; neither
 * should be compared against Activity Monitor's Memory column to the megabyte.
 */

/**
 * `ps` columns: pid, parent pid, resident size, command — no headers, so every line is data. The
 * shape {@link parseProcessTable} reads, for both listings below.
 */
const PS_COLUMNS = 'pid=,ppid=,rss=,comm='

/**
 * `ps` arguments for the whole table, in {@link PS_COLUMNS}.
 *
 * **`x` is the load-bearing flag**, and this was measured rather than reasoned: a GUI app has no
 * controlling terminal, so neither do the agents it spawns. `ps -a` sees 152 processes on this
 * machine and CANNOT see our own `codex` child; `ps -ax` sees 1,089 and can. `-e` would do just as
 * well — it returns the same set as `-ax`, with only process churn between the two calls to tell
 * them apart — so `-ax` here is a convention, not a requirement.
 */
export const PS_ARGS: readonly string[] = ['-axo', PS_COLUMNS]

/**
 * 🔴 **D-018 · the same columns, for the named pids only** — `-p` and never `-ax`: the provider
 * processes this app started for its conversations, and no other process's row. ⚑ One fork for all
 * of them — measured at about 3 ms (max 5 ms over 20 reads), against 65–573 ms for the whole table.
 */
export function psArgsFor(pids: readonly number[]): string[] {
  return ['-o', PS_COLUMNS, '-p', pids.join(',')]
}

/** macOS and Linux both report `rss` in kilobytes. */
const RSS_UNIT_BYTES = 1024

/**
 * Two seconds. NOT to protect the main thread — the caller runs this asynchronously and the main
 * thread is never blocked by it. The timeout exists because a `ps` that never returns would leave
 * the caller's in-flight guard set, and the reading would stop happening at all.
 *
 * It is deliberately generous relative to the median because **`ps` cost scales with machine load**:
 * 65 ms on a quiet machine, median 573 ms and p95 1.3 s on a busy one (measured, 1,114 processes).
 * A timeout tight enough to look reasonable on an idle laptop would fire constantly on the machine
 * that is actually in trouble — which is the only machine this feature exists for.
 */
export const PS_TIMEOUT_MS = 2_000

/**
 * 8 MiB against a measured 110 KB listing (1,114 processes) — about 74× headroom. Sized so that
 * overflowing it means something is wrong that we would want the failure for, not a machine that is
 * merely busier than the one this was written on.
 */
export const PS_MAX_BUFFER_BYTES = 8 * 1024 * 1024

/**
 * How long a reading may be outstanding before the next tick starts another regardless.
 *
 * Longer than {@link PS_TIMEOUT_MS} because the timeout is the normal way a slow `ps` ends and that
 * path resets the flag by itself; this is the backstop for the abnormal way, where the child never
 * exits and the callback therefore never runs. Ten seconds is under one watchdog tick, so at most
 * one sample is skipped before readings resume.
 */
export const PS_READ_DEADLINE_MS = 10_000

export interface ProcessRow {
  pid: number
  ppid: number
  rssBytes: number
  /** Basename of the executable — `codex`, `claude`, `node`. Something a human can act on. */
  name: string
}

export interface SpawnedProcess {
  pid: number
  rssBytes: number
  name: string
  /**
   * ⚑ **The process straight under ours it descends from** — itself, for one we started; the
   * agent's own process, for a command the agent runs — so what an agent holds is its own and its
   * commands' together.
   */
  head: number
}

/**
 * Parse a {@link PS_COLUMNS} listing — the whole table ({@link PS_ARGS}) or named pids
 * ({@link psArgsFor}).
 *
 * The command is LAST on purpose: it is the only field that can contain spaces, so everything else
 * can be split on whitespace and the remainder taken verbatim. Splitting the whole line would lose
 * `Electron Helper (Renderer)`.
 *
 * A line that does not parse is skipped rather than thrown on — this is diagnostics, and one odd
 * row from a process that exited mid-listing must not cost us the other several hundred.
 */
export function parseProcessTable(text: string): ProcessRow[] {
  const rows: ProcessRow[] = []
  for (const line of text.split('\n')) {
    const match = /^\s*(\d+)\s+(\d+)\s+(\d+)\s+(.*)$/.exec(line)
    if (match === null) continue
    const [, pid, ppid, rss, command] = match
    const name = (command ?? '').trim()
    rows.push({
      pid: Number(pid),
      ppid: Number(ppid),
      rssBytes: Number(rss) * RSS_UNIT_BYTES,
      name: name.slice(name.lastIndexOf('/') + 1) || 'unknown',
    })
  }
  return rows
}

/**
 * ⚑ **D-018 · each named pid's resident size off {@link psArgsFor}'s listing — or `null` when there
 * is no listing**: a `ps` that could not start, overflowed, or was killed at its timeout.
 * ⚠️ **An exit status is an answer**: `ps -p` exits 1 and prints nothing when none of the pids is
 * running any more (measured on macOS; a list with one live pid exits 0 with that row), so the
 * listing is read whenever `ps` exited with a code.
 */
export function residentSizesIn(
  error: { readonly code?: unknown } | null,
  listing: string,
): ReadonlyMap<number, number> | null {
  if (error !== null && typeof error.code !== 'number') return null
  return new Map(parseProcessTable(listing).map((row) => [row.pid, row.rssBytes]))
}

/**
 * Every descendant of `rootPid`, minus the pids given in `alreadyCounted`.
 *
 * ## The double-count this exists to prevent
 *
 * Chromium's renderer, GPU and utility processes ARE operating-system children of the main process.
 * Summing `getAppMetrics()` and then adding every OS descendant would count each of them twice and
 * report roughly double the real figure — for a watchdog whose entire job is to state a number
 * accurately, that is a worse failure than the blindness it fixes. `ProcessMetric` carries a `pid`,
 * so the caller passes those in and they are skipped here.
 *
 * Breadth-first from the root, with a `seen` set: a `ps` snapshot is not atomic and pid reuse
 * during it could otherwise produce a cycle and spin this forever.
 *
 * ## What it does NOT see, which matters after the fact
 *
 * A process whose own parent died is re-parented to `launchd` (ppid 1) and leaves this walk, because
 * it is no longer a descendant of ours. The Codex transport spawns `detached: true`, so an agent —
 * and anything the agent itself spawned — can outlive us exactly that way. Such a process keeps its
 * memory and becomes invisible here, which is the same shape of blindness this module exists to fix,
 * one level further out. Fixing it needs a durable record of the pids we started, not a tree walk.
 */
export function spawnedDescendants(
  rows: readonly ProcessRow[],
  rootPid: number,
  alreadyCounted: ReadonlySet<number>,
): SpawnedProcess[] {
  const childrenOf = new Map<number, ProcessRow[]>()
  for (const row of rows) {
    const siblings = childrenOf.get(row.ppid)
    if (siblings === undefined) childrenOf.set(row.ppid, [row])
    else siblings.push(row)
  }

  const found: SpawnedProcess[] = []
  const seen = new Set<number>([rootPid])
  const queue: number[] = [rootPid]
  // ⚑ Each process's head, inherited down the walk: a child of the root heads its own subtree.
  const headOf = new Map<number, number>()
  while (queue.length > 0) {
    const pid = queue.shift() as number
    for (const child of childrenOf.get(pid) ?? []) {
      if (seen.has(child.pid)) continue
      seen.add(child.pid)
      queue.push(child.pid)
      // ⚑ Under a Chromium process it heads its own: that one is counted already, and never named.
      const head =
        pid === rootPid || alreadyCounted.has(pid) ? child.pid : (headOf.get(pid) ?? child.pid)
      headOf.set(child.pid, head)
      // Walk THROUGH a counted process — a Chromium utility could itself have spawned something,
      // and skipping its subtree would reopen the same blindness one level down.
      if (alreadyCounted.has(child.pid)) continue
      found.push({ pid: child.pid, rssBytes: child.rssBytes, name: child.name, head })
    }
  }
  return found
}

export const totalBytes = (spawned: readonly Pick<SpawnedProcess, 'rssBytes'>[]): number =>
  spawned.reduce((sum, p) => sum + p.rssBytes, 0)

/**
 * `codex:12.40GB` — the same shape as the app's own breakdown in the line before it, so the two
 * lists read alike.
 *
 * Processes are ordered LARGEST FIRST and the tail is dropped: the message exists to name the one
 * that grew, and a hundred small children would push it off the end of the line.
 *
 * ⛔ **But the dropped tail is COUNTED, and its bytes are stated** (175 §3). `173` measured this app
 * at **5.25 GB** at the end of a full smoke run, reproducibly, with a breakdown beside it naming
 * about **1.8 GB** — so the one sentence 052 exists to produce was silent about 3.4 GB of the number
 * in its own first clause. Nothing was wrong with the list; `limit` was doing exactly what the
 * paragraph above says. What was wrong is that a reader cannot tell "the rest is a long tail of
 * small children" from "something we are not naming is holding most of it", and those are opposite
 * conclusions about the same line. `086`: the app must not state something it cannot back.
 *
 * A count and a sum, not a process dump (`031`): the tail is one field, whatever its length.
 */
export function describeSpawned(
  spawned: readonly Pick<SpawnedProcess, 'rssBytes' | 'name'>[],
  limit = 4,
): string {
  const sorted = [...spawned].sort((a, b) => b.rssBytes - a.rssBytes)
  const named = sorted
    .slice(0, limit)
    .map((p) => `${p.name}:${(p.rssBytes / 1024 ** 3).toFixed(2)}GB`)
  const rest = sorted.slice(limit)
  if (rest.length === 0) return named.join(' ')
  return [...named, `+${rest.length}more:${(totalBytes(rest) / 1024 ** 3).toFixed(2)}GB`].join(' ')
}

export interface SpawnedReaderDeps {
  /** Injected so a test can move time without waiting. */
  now: () => number
  /** Start one listing. Calls back with the table text, or an error and no text. */
  read: (done: (error: Error | null, table: string) => void) => void
  /** The pids the caller has already accounted for by other means, read at the START of each go. */
  chromiumPids: () => ReadonlySet<number>
  rootPid: number
  /** Default {@link PS_READ_DEADLINE_MS}. */
  deadlineMs?: number
}

export interface SpawnedReader {
  /** Begin a reading unless one is already outstanding and still within its deadline. */
  refresh(): void
  /** The most recent successful reading. Empty before the first one, and after a failure. */
  snapshot(): SpawnedProcess[]
  /** Whether the last completed reading failed — which is NOT the same as finding nothing. */
  failed(): boolean
  /** ⚑ Whether any reading has completed — before the first, an empty snapshot says nothing. */
  everRead(): boolean
}

/**
 * Holds the last reading and decides when to take another (053).
 *
 * ## Why this is a unit and not four variables in `index.ts`
 *
 * It was four variables in `index.ts`, and the highest-severity defect a review found in this change
 * lived in them: the in-flight flag was cleared ONLY by the callback, and a `ps` that never exits
 * never calls back. One wedged process — `execFile`'s timeout signals the child but the callback
 * still waits for it to die — would have left the flag set for the lifetime of the app, silently
 * restoring exactly the blindness this module was written to remove. Untestable code is where that
 * kind of thing lives, so this is the testable shape of it.
 *
 * The deadline is what makes the flag self-clearing: it needs no callback, no second timer and no
 * cancellation, because it is a comparison against the clock rather than a promise anyone must keep.
 */
export function createSpawnedReader(deps: SpawnedReaderDeps): SpawnedReader {
  const deadlineMs = deps.deadlineMs ?? PS_READ_DEADLINE_MS
  let snapshot: SpawnedProcess[] = []
  let startedAt = 0
  let failed = false
  let everRead = false

  return {
    refresh(): void {
      const now = deps.now()
      if (startedAt !== 0 && now - startedAt < deadlineMs) return
      startedAt = now
      const chromiumPids = deps.chromiumPids()
      deps.read((error, table) => {
        startedAt = 0
        everRead = true
        if (error === null) {
          snapshot = spawnedDescendants(
            theAgentsRows(table, deps.rootPid),
            deps.rootPid,
            chromiumPids,
          )
          failed = false
        } else {
          snapshot = []
          failed = true
        }
      })
    },
    snapshot: () => snapshot,
    failed: () => failed,
    everRead: () => everRead,
  }
}

/**
 * ⚑ **A listing's rows, less this app's own `ps`** — the reading's probe is a child of ours, and so
 * is the one the agent cards' memory line runs ({@link psArgsFor}): a `ps` straight under our own
 * pid is ours and never an agent's. An agent's own `ps` sits under that agent, and stays.
 */
function theAgentsRows(table: string, rootPid: number): ProcessRow[] {
  return parseProcessTable(table).filter((row) => !(row.ppid === rootPid && row.name === 'ps'))
}
