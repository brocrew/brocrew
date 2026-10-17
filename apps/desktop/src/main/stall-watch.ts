import { performance, PerformanceObserver } from 'node:perf_hooks'

/**
 * Records when the main thread stops answering, and what it was doing.
 *
 * On macOS the window's events are handled on the main process's JavaScript thread, so any
 * synchronous work there longer than a second or two shows as the spinning wheel. A timer checks
 * every {@link STALL_TICK_MS} how late it fired; a lateness of {@link STALL_FLOOR_MS} or more is
 * logged. The timer only fires after the work that blocked it ended, so the work itself is timed as
 * it runs ({@link MainThreadWork}) and the line names what ran since the previous tick.
 *
 * A late tick that used the CPU is a stall. One that used little CPU is a wait — a child process,
 * a file or a lock the thread sat on — unless the computer slept or the window was out of sight
 * for most of it, when the system may have paused the timer (App Nap) and nobody saw a wheel
 * ({@link WhatTheAppWasDoing}). Those are only counted. Ticks each late by less than the floor, back to back, are one run, logged
 * when they add up to the floor: blocks of work just under it, one after another, freeze the window
 * as one long one does. Nothing is written while the thread keeps up, so a separate health line
 * ({@link startWatchHealth}) says the watch is still running.
 */

/** How often the watch checks how late it is. */
export const STALL_TICK_MS = 100

/** The lateness that counts as a stall. */
export const STALL_FLOOR_MS = 500

/** How many kinds of work a stall's line names, longest first. */
const NAMED_AT_MOST = 6

/** How far back collections are kept, for the line of a long stall or run. */
const GC_HORIZON_MS = 30_000

/** A tick late by this much or more, under the floor, joins a run of late ticks. */
export const RUN_STEP_MS = 100

/** How often the health line is written. */
export const HEALTH_EVERY_MS = 10 * 60_000

/** Write a line; a log that throws loses the line, never the watch. */
function sayingTo(log: (line: string) => void): (line: string) => void {
  return (line) => {
    try {
      log(line)
    } catch {
      // The next line is tried as this one was.
    }
  }
}

interface Tally {
  count: number
  ms: number
  longest: number
}

/** What the main thread did since the last tick, totalled by name. */
export class MainThreadWork {
  private tallies = new Map<string, Tally>()
  private readonly now: () => number

  constructor(now: () => number = () => performance.now()) {
    this.now = now
  }

  /** Run `work`, adding the time its synchronous part took under `what`. */
  timed<T>(what: string, work: () => T): T {
    const finish = this.start(what)
    try {
      return work()
    } finally {
      finish()
    }
  }

  /** Finish a synchronous span before yielding to a promise or timer. */
  start(what: string): () => void {
    const started = this.now()
    let finished = false
    return () => {
      if (finished) return
      finished = true
      this.add(what, this.now() - started)
    }
  }

  add(what: string, ms: number): void {
    const tally = this.tallies.get(what)
    if (tally === undefined) this.tallies.set(what, { count: 1, ms, longest: ms })
    else {
      tally.count += 1
      tally.ms += ms
      tally.longest = Math.max(tally.longest, ms)
    }
  }

  /** Forget what was recorded. */
  clear(): void {
    if (this.tallies.size > 0) this.tallies = new Map()
  }

  /** Everything recorded since the last call, longest total first; starts afresh. */
  take(): { what: string; count: number; ms: number; longest: number }[] {
    const taken = [...this.tallies].map(([what, tally]) => ({ what, ...tally }))
    this.tallies = new Map()
    return taken.sort((a, b) => b.ms - a.ms)
  }
}

/** A stall's line: how long, and the longest work since the previous tick. */
export function aStallSays(
  blockedMs: number,
  during: readonly { what: string; count: number; ms: number; longest: number }[],
  gcMs = 0,
): string {
  return `main thread blocked for up to ${Math.round(blockedMs)} ms; frozen; ${whatRanInIt(blockedMs, during, gcMs)}`
}

/** A wait's line: how long, how little CPU, and the work since the previous tick. */
export function aWaitSays(
  waitedMs: number,
  cpuMs: number,
  during: readonly { what: string; count: number; ms: number; longest: number }[],
  gcMs = 0,
): string {
  return (
    `main thread waited up to ${Math.round(waitedMs)} ms using ${Math.round(cpuMs)} ms of CPU; ` +
    whatRanInIt(waitedMs, during, gcMs)
  )
}

/** A run's line: late ticks back to back, how late in all, and the work since the run began. */
export function aRunSays(
  spanMs: number,
  ticks: number,
  lateMs: number,
  cpuMs: number,
  during: readonly { what: string; count: number; ms: number; longest: number }[],
  gcMs = 0,
): string {
  return (
    `main thread fell behind ${ticks} times in a row over ${Math.round(spanMs)} ms, ` +
    `${Math.round(lateMs)} ms late in all, using ${Math.round(cpuMs)} ms of CPU; ` +
    whatRanInIt(lateMs, during, gcMs)
  )
}

function whatRanInIt(
  lateMs: number,
  during: readonly { what: string; count: number; ms: number; longest: number }[],
  gcMs: number,
): string {
  const named = during
    .filter((work) => work.ms >= 1)
    .slice(0, NAMED_AT_MOST)
    .map(
      (work) =>
        `${work.what} ${Math.round(work.ms)} ms` +
        (work.count > 1 ? ` (${work.count}×, longest ${Math.round(work.longest)} ms)` : ''),
    )
  if (gcMs >= 1) named.push(`garbage collection ${Math.round(gcMs)} ms`)
  // Timed work nests (a command's time includes its store calls), so the longest single total says
  // how much of the stall the timed work covers.
  const covered = Math.max(gcMs, ...during.map((work) => work.ms))
  const untimed =
    covered < lateMs / 2
      ? '; most of it ran outside the timed work (event delivery or a timer)'
      : ''
  return (
    (named.length === 0 ? 'no timed work ran in it' : `during it: ${named.join(', ')}`) + untimed
  )
}

/** Why a late timer is no wait a person saw, or `null` when it is one. */
export type QuietBecause = 'asleep' | 'out-of-sight'

/**
 * Whether the computer slept and whether the window was in sight — shown, in front and not covered —
 * as the system says it: a timer late while either held may have been paused by the system (sleep,
 * App Nap, which never applies to the app in front), and nobody was looking at the window. Fed by
 * main from the power monitor, the window's own events and the page's visibility.
 */
export class WhatTheAppWasDoing {
  /** The latest sleep and the latest time out of sight, each with its end, or `null` while it lasts. */
  private slept: { from: number; to: number | null } | null = null
  private hidden: { from: number; to: number | null } | null
  private readonly now: () => number

  constructor(inSight: boolean, now: () => number = () => performance.now()) {
    this.now = now
    this.hidden = inSight ? null : { from: now(), to: null }
  }

  asleep(): void {
    if (this.slept === null || this.slept.to !== null) this.slept = { from: this.now(), to: null }
  }

  awake(): void {
    if (this.slept !== null && this.slept.to === null)
      this.slept = { ...this.slept, to: this.now() }
  }

  outOfSight(): void {
    if (this.hidden === null || this.hidden.to !== null)
      this.hidden = { from: this.now(), to: null }
  }

  inSight(): void {
    if (this.hidden !== null && this.hidden.to === null)
      this.hidden = { ...this.hidden, to: this.now() }
  }

  /** Whether the computer slept, or the window was out of sight, for most of `from` to `to`. */
  quietBetween(from: number, to: number): QuietBecause | null {
    const most = (span: { from: number; to: number | null } | null): boolean => {
      if (span === null) return false
      const overlap = Math.min(to, span.to ?? to) - Math.max(from, span.from)
      return overlap > 0 && overlap >= (to - from) / 2
    }
    if (most(this.slept)) return 'asleep'
    if (most(this.hidden)) return 'out-of-sight'
    return null
  }
}

/** What the watch saw since the health line last read it. */
export interface WatchCounts {
  readonly ticks: number
  readonly stalls: number
  readonly waits: number
  readonly asleep: number
  readonly outOfSight: number
  /** The longest lateness of any tick, logged or not. */
  readonly longestLateMs: number
  /** When the watch last ticked, on its clock, or `null` before its first tick. */
  readonly lastTickAt: number | null
}

/** A running watch: stop it, or take what it counted since the last take. */
export interface StallWatch {
  stop(): void
  takeCounts(): WatchCounts
}

/**
 * Start the watch.
 *
 * A late tick that used the CPU for at least half its lateness is a stall. One that used less is a
 * wait, unless {@link WhatTheAppWasDoing} says the computer slept or the window was out of sight
 * for most of it. The line is written on the next turn of the event loop, once the runtime has
 * delivered its garbage-collection entries, which the line counts when they started inside it.
 */
export function startStallWatch(options: {
  readonly work: MainThreadWork
  readonly log: (line: string) => void
  /** The computer's sleep and the window's sight; none means every low-CPU gap is a wait. */
  readonly lifecycle?: WhatTheAppWasDoing
  readonly now?: () => number
  /** Microseconds of CPU the process has used (`process.cpuUsage`, user + system). */
  readonly cpuMicros?: () => number
  readonly tickMs?: number
  readonly floorMs?: number
  readonly setInterval?: (tick: () => void, ms: number) => unknown
  readonly clearInterval?: (handle: unknown) => void
  readonly later?: (run: () => void) => void
  readonly observeGc?: boolean
}): StallWatch {
  const now = options.now ?? (() => performance.now())
  const cpuMicros =
    options.cpuMicros ??
    (() => {
      const used = process.cpuUsage()
      return used.user + used.system
    })
  const tickMs = options.tickMs ?? STALL_TICK_MS
  const floorMs = options.floorMs ?? STALL_FLOOR_MS
  const later = options.later ?? ((run: () => void) => void setImmediate(run))
  const say = sayingTo(options.log)
  // Work done before the watch began is not a stall's.
  options.work.clear()
  let last = now()
  let lastCpu = cpuMicros()
  let collections: { startTime: number; duration: number }[] = []
  let counts = {
    ticks: 0,
    stalls: 0,
    waits: 0,
    asleep: 0,
    outOfSight: 0,
    longestLateMs: 0,
    lastTickAt: null as number | null,
  }
  // Ticks each late by less than the floor, back to back: one block of work after another, which
  // the person sees as one freeze.
  let run: { from: number; cpuFrom: number; lateMs: number; ticks: number } | null = null
  const report = (span: {
    from: number
    to: number
    cpuMs: number
    lateMs: number
    ticks: number
  }): void => {
    const during = options.work.take()
    later(() => {
      const gcMs = collections
        .filter((entry) => entry.startTime >= span.from && entry.startTime <= span.to)
        .reduce((sum, entry) => sum + entry.duration, 0)
      collections = collections.filter((entry) => entry.startTime > span.to)
      const spanMs = span.to - span.from
      if (span.cpuMs >= span.lateMs / 2) {
        counts.stalls += 1
        say(
          span.ticks === 1
            ? aStallSays(spanMs, during, gcMs)
            : aRunSays(spanMs, span.ticks, span.lateMs, span.cpuMs, during, gcMs),
        )
        return
      }
      const quiet = options.lifecycle?.quietBetween(span.from, span.to) ?? null
      if (quiet === 'asleep') counts.asleep += 1
      else if (quiet === 'out-of-sight') counts.outOfSight += 1
      else {
        counts.waits += 1
        say(
          span.ticks === 1
            ? aWaitSays(spanMs, span.cpuMs, during, gcMs)
            : aRunSays(spanMs, span.ticks, span.lateMs, span.cpuMs, during, gcMs),
        )
      }
    })
  }
  const tick = (): void => {
    const at = now()
    const cpu = cpuMicros()
    const lateMs = at - last - tickMs
    const from = last
    const cpuBefore = lastCpu
    last = at
    lastCpu = cpu
    counts.ticks += 1
    counts.lastTickAt = at
    counts.longestLateMs = Math.max(counts.longestLateMs, lateMs)
    if (lateMs >= floorMs) {
      const started = run ?? { from, cpuFrom: cpuBefore, lateMs: 0, ticks: 0 }
      run = null
      report({
        from: started.from,
        to: at,
        cpuMs: (cpu - started.cpuFrom) / 1000,
        lateMs: started.lateMs + lateMs,
        ticks: started.ticks + 1,
      })
      return
    }
    if (lateMs >= RUN_STEP_MS) {
      run ??= { from, cpuFrom: cpuBefore, lateMs: 0, ticks: 0 }
      run.lateMs += lateMs
      run.ticks += 1
      return
    }
    // A tick on time ends a run, and what ran in a run that never added up is nobody's.
    if (run !== null && run.lateMs >= floorMs) {
      report({
        from: run.from,
        to: from,
        cpuMs: (cpuBefore - run.cpuFrom) / 1000,
        lateMs: run.lateMs,
        ticks: run.ticks,
      })
    } else options.work.clear()
    run = null
  }
  const every =
    options.setInterval ??
    ((run: () => void, ms: number): unknown => {
      const timer = setInterval(run, ms)
      // Never the reason the process stays alive.
      timer.unref()
      return timer
    })
  const handle = every(tick, tickMs)
  let gc: PerformanceObserver | null = null
  if (options.observeGc ?? true) {
    gc = new PerformanceObserver((list) => {
      const horizon = now() - GC_HORIZON_MS
      collections = collections.filter((entry) => entry.startTime >= horizon)
      for (const entry of list.getEntries()) {
        collections.push({ startTime: entry.startTime, duration: entry.duration })
      }
    })
    gc.observe({ entryTypes: ['gc'] })
  }
  return {
    stop: () => {
      ;(options.clearInterval ?? ((timer) => clearInterval(timer as NodeJS.Timeout)))(handle)
      gc?.disconnect()
    },
    takeCounts: () => {
      const taken = counts
      counts = {
        ticks: 0,
        stalls: 0,
        waits: 0,
        asleep: 0,
        outOfSight: 0,
        longestLateMs: 0,
        lastTickAt: taken.lastTickAt,
      }
      return taken
    },
  }
}

/** The health line: what the watch counted in the last period, so a quiet log means no stalls. */
export function watchHealthSays(counts: WatchCounts, periodMs: number, at: number): string {
  const minutes = Math.round(periodMs / 60_000)
  if (counts.ticks === 0) {
    const last =
      counts.lastTickAt === null
        ? 'it has never ticked'
        : `it last ticked ${Math.round((at - counts.lastTickAt) / 1000)} s ago`
    return `the stall watch did not tick in the last ${minutes} min; ${last}`
  }
  const quiet = counts.asleep + counts.outOfSight
  return (
    `the stall watch ticked ${counts.ticks} times in the last ${minutes} min: ` +
    `${counts.stalls} ${counts.stalls === 1 ? 'stall' : 'stalls'}, ` +
    `${counts.waits} ${counts.waits === 1 ? 'wait' : 'waits'}, ` +
    `${quiet} late while asleep or out of sight; ` +
    `longest late tick ${Math.round(Math.max(0, counts.longestLateMs))} ms`
  )
}

/**
 * Write the health line every {@link HEALTH_EVERY_MS}, on a timer of its own: a watch whose timer
 * stopped cannot say so itself.
 */
export function startWatchHealth(options: {
  readonly watch: Pick<StallWatch, 'takeCounts'>
  readonly log: (line: string) => void
  /** More to say on the same line — the page's own recorder, once it reports. */
  readonly andAlso?: () => string | null
  readonly now?: () => number
  readonly everyMs?: number
  readonly setInterval?: (run: () => void, ms: number) => unknown
}): void {
  const now = options.now ?? (() => performance.now())
  const everyMs = options.everyMs ?? HEALTH_EVERY_MS
  const say = sayingTo(options.log)
  const every =
    options.setInterval ??
    ((run: () => void, ms: number): unknown => {
      const timer = setInterval(run, ms)
      timer.unref()
      return timer
    })
  every(() => {
    const said = watchHealthSays(options.watch.takeCounts(), everyMs, now())
    say(withMore(said, options.andAlso))
  }, everyMs)
}

/**
 * The same object, each method timed under `<name>.<method>` — for the session store, whose
 * synchronous SQLite work is most of what the main thread does. One wrapper per method, made once.
 */
export function timedMethods<T extends object>(target: T, name: string, work: MainThreadWork): T {
  const wrappers = new Map<string, (...args: unknown[]) => unknown>()
  return new Proxy(target, {
    get(object, key, receiver) {
      const value: unknown = Reflect.get(object, key, receiver)
      if (typeof value !== 'function' || typeof key !== 'string') return value
      let wrapper = wrappers.get(key)
      if (wrapper === undefined) {
        const label = `${name}.${key}`
        const method = value as (...args: unknown[]) => unknown
        wrapper = (...args: unknown[]) => work.timed(label, () => method.apply(object, args))
        wrappers.set(key, wrapper)
      }
      return wrapper
    },
  })
}

/** A line with what `more` adds, or the line alone when it adds nothing or throws. */
function withMore(said: string, more: (() => string | null) | undefined): string {
  try {
    const added = more?.() ?? null
    return added === null ? said : `${said}; ${added}`
  } catch {
    return said
  }
}
