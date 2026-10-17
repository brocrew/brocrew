/**
 * Leave a trail when the app itself starts growing (052) — or its agents climb as only a runaway does.
 *
 * ## Why this exists
 *
 * A running instance reached **>26 GB** and had to be killed by hand. Everything needed to explain
 * it was in memory, and the kill took it: there is no crash report (a manual kill produces none),
 * the dev server's console went to a terminal nobody kept, and the app itself recorded nothing —
 * the database's last write was seven minutes before the growth even started. 052 reproduced the
 * suspected payload twice, end to end, and peaked at 0.72 GB, so the cause is still open. The next
 * occurrence must not be equally silent.
 *
 * ## What it is, and what it deliberately is not
 *
 * It samples a figure and logs each time it crosses a NEW step above a floor: what the app itself
 * holds, from 2 GiB by each further gigabyte, and in a line of their own what its agents hold, past a
 * floor only a runaway reaches. It does not kill anything, does not tell the user anything, and does
 * not appear in the UI: a watchdog that acts on a number it cannot interpret would be guessing with
 * the user's session.
 *
 * **It watches the app's OWN processes — main, its window and their helpers — and shows its agents
 * apart.** Which process actually held the 26 GB was never established — Activity Monitor was read
 * as one "Electron" figure, and an Electron app is a tree of them — so every line carries the
 * breakdown by process, which is the line that would say *which* one grew.
 *
 * ⚠️ **053 had it count the agents too, and what that cost was measured on 2026-10-03.** 052 summed
 * `app.getAppMetrics()`, which is Chromium's processes and only those, and 053 added every process
 * the app spawned, so that an agent holding gigabytes could not hide. ⛔ **It then said *"BroBot2 is
 * holding 7 GB — far above normal"* about its agents' test runs.** Across the 94 lines of this
 * machine's log over sixteen days that are not a test forcing a window to grow, the app's own
 * processes held 0.4–1.0 GB together (main at most 0.4 GB), and the agents held 63–95% of every
 * total: Claude itself at up to 0.6 GB each, and the commands the agents run — test workers and
 * headless browsers at up to 1.6 GB each. ⚑ So the floor measures the app itself again, which is
 * what *"far above what it normally holds"* can be true of, and the agents' processes are named apart
 * in the same line. ⚑ **And an agent, or a command it runs, that alone climbs to many gigabytes writes
 * a line of its own** ({@link agentsMemoryFloorFor}), naming the agents holding the most
 * ({@link theAgentsDetail}): an agents' total that test runs reach every day says nothing.
 *
 * **Silent until it matters.** The floor is above every measured normal figure — the app itself held
 * at most about 1 GB beside a working team, and a full reproduction peaked at 0.72 GB — and each
 * threshold reports ONCE, on the way up. A healthy run produces no output at all, which is what keeps
 * this from being the ticking clock that describes nothing (035): it describes something only when
 * there is something.
 */

import { describeSpawned, totalBytes, type SpawnedProcess } from './process-tree'

export interface MemoryWatchOptions {
  /**
   * The resident bytes the line counts — what the app itself holds (main, its window and their
   * helpers), or for the agents' own line what they hold. Injected so a test drives the numbers.
   */
  sample: () => number
  /**
   * Optional breakdown appended to the message — the part that says WHICH process grew, which is
   * the single fact the incident lacked, and what the agents hold apart. Absent means the figure
   * alone, which is still a trail.
   */
  detail?: () => string
  log: (message: string) => void
  /**
   * ⚑ **What the line says the figure is** — the app itself, by default
   * ({@link theAppItselfHeadline}); the agents' own watch says theirs ({@link theAgentsHeadline}).
   */
  headline?: (bytes: number) => string
  setInterval: (fn: () => void, ms: number) => unknown
  clearInterval: (handle: unknown) => void
  /** Report nothing below this. Default {@link MEMORY_FLOOR_BYTES}. */
  floorBytes?: number
  /** Report again after each further step. Default {@link MEMORY_STEP_BYTES}. */
  stepBytes?: number
  /**
   * ⚑ **Begin again below this** — a figure that fell this low ended its episode, and the next climb
   * is reported from the floor. ⚠️ Left out for the app itself, one process whose climb is one
   * episode for its life; set for its agents, whose processes come and go.
   */
  rearmBelowBytes?: number
  intervalMs?: number
}

/**
 * 2 GiB. Above what the app itself has been measured holding, and above the heaviest reproduction
 * (0.72 GB peak), so crossing it is already abnormal — but far below the point where the machine is
 * in trouble, so the log starts early enough to show the SHAPE of the climb rather than only its end.
 *
 * ⚑ **Measured on what it counts, the app itself** (2026-10-03): 0.46–0.6 GB across 33 minutes of a
 * window beside five and six working agents, and 0.4–1.0 GB in sixteen days of this machine's log.
 * ⛔ Never the agents: they pushed the old total past 2 GB on every test run.
 *
 * Left at 2 GiB rather than lowered on a guess. Crossing it costs one log line and nothing else — no
 * kill, no UI, no user-visible alarm — so the cost of firing early is a line in a file, while the
 * cost of a floor set too high is the silence 052 was written to end.
 */
export const MEMORY_FLOOR_BYTES = 2 * 1024 ** 3
export const MEMORY_STEP_BYTES = 1024 ** 3

/**
 * ⚑ **16 GiB at most, for the agents' own line** — what they and the commands they run hold
 * together. Measured on this machine (2026-10-03): up to about 9.7 GB in sixteen days of a team
 * running its test suites, and 1.5–6.7 GB across half an hour of six agents. ⚑ Well above that, so a
 * test run never writes it, and far below a machine in trouble — the 26 GB this watchdog was made for
 * crosses it. Then each further {@link AGENTS_MEMORY_STEP_BYTES}, once an episode.
 */
export const AGENTS_MEMORY_FLOOR_BYTES = 16 * 1024 ** 3
export const AGENTS_MEMORY_STEP_BYTES = 4 * 1024 ** 3

/**
 * ⚑ **The agents' floor on this machine** — {@link AGENTS_MEMORY_FLOOR_BYTES}, or three quarters of
 * its memory where that is less. ⚠️ `ps` counts what is resident and never what is compressed or
 * swapped, so on a Mac with 16 GB the agents could never be seen holding 16 GiB, however far they ran
 * away — and a smaller Mac is in trouble first.
 */
export function agentsMemoryFloorFor(machineBytes: number): number {
  return Math.min(AGENTS_MEMORY_FLOOR_BYTES, Math.floor(machineBytes * 0.75))
}

/**
 * ⚑ **How long after the app's own line the agents' line looks** — the app's line starts the one
 * listing of what it spawned each tick, which settles within `PS_TIMEOUT_MS` (2 s), so a look 5 s
 * later reads that tick's listing and not the one before.
 */
export const AGENTS_LINE_LAG_MS = 5_000
/** Every 30s: fine enough to catch a climb of minutes, coarse enough to cost nothing. */
export const MEMORY_INTERVAL_MS = 30_000

export interface MemoryWatch {
  stop(): void
}

export function startMemoryWatch(options: MemoryWatchOptions): MemoryWatch {
  const floor = options.floorBytes ?? MEMORY_FLOOR_BYTES
  const step = options.stepBytes ?? MEMORY_STEP_BYTES
  /**
   * The highest threshold already reported. Monotonic ON PURPOSE: memory that falls back and
   * climbs again is the same episode, and re-reporting every oscillation across one boundary would
   * bury the climb it is there to show.
   */
  let reported = 0

  const tick = (): void => {
    const rss = options.sample()
    if (options.rearmBelowBytes !== undefined && rss < options.rearmBelowBytes) reported = 0
    if (rss < floor) return
    const crossed = floor + Math.floor((rss - floor) / step) * step
    if (crossed <= reported) return
    reported = crossed
    const detail = options.detail?.()
    options.log((options.headline ?? theAppItselfHeadline)(rss) + (detail ? ` ${detail}` : ''))
  }

  const handle = options.setInterval(tick, options.intervalMs ?? MEMORY_INTERVAL_MS)
  return {
    stop(): void {
      options.clearInterval(handle)
    },
  }
}

/** ⚑ **The app's own line** — what it holds, and what to do before quitting it. */
export function theAppItselfHeadline(bytes: number): string {
  return (
    `[memory] BroCrew itself — its main process, its window and their helpers — is holding ` +
    `${gb(bytes)} GB, far above what it normally holds (about 1 GB at most). If it keeps climbing, ` +
    'capture a heap snapshot before quitting it: a quit or a kill takes the evidence with it.'
  )
}

/**
 * ⚑ **The agents' own line** — what they and the commands they run hold together, which only a
 * runaway reaches ({@link AGENTS_MEMORY_FLOOR_BYTES}).
 */
export function theAgentsHeadline(bytes: number): string {
  return (
    `[memory] BroCrew's agents and the commands they run are holding ${gb(bytes)} GB, far above ` +
    'what they normally hold (about 10 GB at most, test runs included).'
  )
}

/**
 * ⚑ **Who among the agents holds the most, and what the app itself holds beside them** — the agents'
 * line's detail. Each agent's figure is its own process and the commands it runs together, the
 * largest first, named as a sentence of this app names its conversation — ⚑ asked only for the ones
 * the line names (`nameThem`, by the pid of each agent's own process) — with its largest processes
 * and the rest counted. ⚠️ A process this app started that is no agent's is named by what it is.
 */
export function theAgentsDetail(
  spawned: readonly SpawnedProcess[],
  nameThem: (heads: readonly number[]) => ReadonlyMap<number, string>,
  itselfBytes: number,
  limit = 3,
): string {
  const groups = new Map<number, SpawnedProcess[]>()
  for (const one of spawned) {
    const group = groups.get(one.head)
    if (group === undefined) groups.set(one.head, [one])
    else group.push(one)
  }
  const ranked = [...groups].sort(([, a], [, b]) => totalBytes(b) - totalBytes(a))
  const named = ranked.slice(0, limit)
  const names =
    named.length === 0 ? new Map<number, string>() : nameThem(named.map(([head]) => head))
  const said = named.map(([head, group]) => {
    const own = group.find((one) => one.pid === head)
    const who = names.get(head) ?? `a process BroCrew started (${own?.name ?? 'unnamed'})`
    const largest = [...group].sort((a, b) => b.rssBytes - a.rssBytes)
    const parts = largest.slice(0, 3).map((one) => `${one.name} ${gb(one.rssBytes)} GB`)
    const others = largest.slice(3)
    if (others.length > 0) parts.push(`and ${others.length} more ${gb(totalBytes(others))} GB`)
    return `${who} holds ${gb(totalBytes(group))} GB (${parts.join(', ')})`
  })
  const rest = ranked.slice(limit)
  if (rest.length > 0) {
    const held = rest.reduce((sum, [, group]) => sum + totalBytes(group), 0)
    said.push(`${rest.length} more ${rest.length === 1 ? 'holds' : 'hold'} ${gb(held)} GB`)
  }
  const most = said.length === 0 ? '' : `Holding the most: ${said.join('; ')}. `
  return `${most}BroCrew itself holds ${gb(itselfBytes)} GB.`
}

/**
 * ⚑ **One of the app's own processes, as Electron's metrics describe it** — `app.getAppMetrics()`,
 * which lists Chromium's processes (main, its window, the GPU and the utility helpers) and none it
 * spawned.
 */
export interface OwnProcess {
  readonly type: string
  /** A utility process's name — `Network Service`. */
  readonly name?: string
  /** ⚠️ In KILOBYTES — Electron's unit. */
  readonly memory: { readonly workingSetSize: number }
}

/**
 * ⚑ **What the app itself holds** — the bytes {@link startMemoryWatch} counts, and each process by
 * a plain name in the order Electron lists them, `main:0.29GB graphics:0.07GB network:0.04GB
 * window:0.19GB`, in the shape `describeSpawned` gives the agents.
 */
export function whatTheAppItselfHolds(processes: readonly OwnProcess[]): {
  readonly bytes: number
  readonly said: string
} {
  return {
    bytes: processes.reduce((total, one) => total + one.memory.workingSetSize * 1024, 0),
    said: processes
      .map((one) => `${plainNameOf(one)}:${gb(one.memory.workingSetSize * 1024)}GB`)
      .join(' '),
  }
}

/**
 * ⚑ **What the app's agents hold, said apart from the app itself** — every process it spawned, the
 * agents' own and the commands they run, with the largest named (`describeSpawned`). ⚑ A listing not
 * read yet, and one that could not be read, are said as such: neither is one that found nothing.
 */
export function whatItsAgentsHoldApart(
  spawned: readonly SpawnedProcess[] | 'not-read-yet' | 'unreadable',
): string {
  if (spawned === 'not-read-yet') return 'What its agents hold has not been read yet.'
  if (spawned === 'unreadable') return 'What its agents hold could not be read.'
  if (spawned.length === 0) return 'None of its agents is running.'
  return (
    `Apart from this, its agents and the commands they run hold ${gb(totalBytes(spawned))} GB ` +
    `[${describeSpawned(spawned)}].`
  )
}

function plainNameOf(one: OwnProcess): string {
  if (one.type === 'Browser') return 'main'
  if (one.type === 'Tab') return 'window'
  if (one.type === 'GPU') return 'graphics'
  if (one.type === 'Utility' && one.name !== undefined && one.name !== '') {
    return one.name
      .toLowerCase()
      .replace(/ service$/, '')
      .replace(/\s+/g, '-')
  }
  return one.type.toLowerCase().replace(/\s+/g, '-')
}

const gb = (bytes: number): string => (bytes / 1024 ** 3).toFixed(2)
