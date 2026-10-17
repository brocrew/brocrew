import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest'
import { createSSRApp, h, type Component } from 'vue'
import { renderToString } from 'vue/server-renderer'
import { FakeProviderSessions, FakeRuntime } from '@brobot2/runtime'
import type { FakeSessionHandle, ResumeOptions, SessionRef, StartOptions } from '@brobot2/runtime'
import type { Provider } from '@brobot2/shared'
import { nativeExportPath } from '../src/main/archive/export-session'
import { type AppDatabase, openDatabase } from '../src/main/db/connection'
import { applyMigrations } from '../src/main/db/migrate'
import { createSessionStore, type SessionStore } from '../src/main/db/session-store'
import { NO_DISCOVERY } from '../src/main/adopt/discover-sessions'
import { RuntimeHost } from '../src/main/runtime/runtime-host'
import type { RuntimeEventSink } from '../src/main/runtime/runtime-host'
import { resourcesRoot } from '../src/main/resources/resources'
import { resolveSessionCwd } from '../src/main/runtime/scratch-cwd'
import { keepTheSystemZone } from '../src/main/system-zone'
import { sinceWords } from '../src/renderer/src/lib/recent-activity'
import { createWindow, openAt, type WindowState } from '../src/renderer/src/lib/transcript-window'
import { hostCalendar } from '../src/main/runtime/schedule-evidence'
import { agentStateWords } from '../src/shared/agent-state'
import { nextCronOccurrence } from '../src/shared/schedule-wake'
import { clockTime, clockTimeFrom } from '../src/shared/clock'
import {
  LOCAL_ZONE_MOVED_CHANNEL,
  localFields,
  readLocalTimeFrom,
  sameLocalDay,
  type LocalZone,
} from '../src/shared/local-time'
import type {
  LibraryEntry,
  PersistedEventInfo,
  RuntimeEventMessage,
  RuntimeStatesMessage,
} from '../src/shared/runtime-ipc'
import type { AgentState } from '../src/shared/agent-state'
import { calendarDay, fullTime } from '../src/renderer/src/lib/clock'
import { proseSpans } from './lib/prose-spans'

/**
 * ⛔ **The zone file is NEVER the machine's own in this file** — `main/system-zone.ts` reads
 * `/etc/localtime` and the files under `/usr/share/zoneinfo`, and every read of one of those paths
 * lands HERE: a path nobody served throws `ENOENT`, so no assertion below can pass or fail on what
 * the machine running it happens to be set to. ⚑ Every other path is the real filesystem's, which
 * the host half (a real SQLite ledger and a scratch folder) needs.
 *
 * ⚠️ **`vi.spyOn(fs, …)` is not available** ("Module namespace is not configurable in ESM"), which
 * is why this is a `vi.mock` factory that delegates, and why `realpathSync` is rebuilt rather than
 * replaced: `.native` is a property of the function and a bare arrow would drop it.
 */
interface FakeWatcher {
  readonly dir: string
  readonly options: unknown
  readonly listener: (kind: string, file: string | null) => void
  readonly handlers: Map<string, ((...given: unknown[]) => void)[]>
  closed: boolean
}

const disk = vi.hoisted(() => ({
  /** ⚑ What a served path holds: its bytes, or the error a read of it raises. */
  files: new Map<string, Buffer | Error>(),
  /** ⚑ Every served path a read was made of, in order. */
  reads: [] as string[],
  /** ⚑ Every watch main started on a folder it owns, in order. */
  watched: [] as FakeWatcher[],
  /** ⚑ When set, a watch cannot start. */
  watchThrows: false,
}))

vi.mock('node:fs', async (importOriginal) => {
  const real = await importOriginal<typeof import('node:fs')>()
  type Any = (...given: unknown[]) => unknown
  const served = (path: unknown): path is string =>
    typeof path === 'string' &&
    (path === '/etc/localtime' || path.startsWith('/usr/share/zoneinfo/'))
  const watchedFolder = (path: unknown): path is string =>
    path === '/etc' || path === '/var/db/timezone'
  const realpathSync = Object.assign(
    (path: unknown, ...rest: unknown[]): unknown =>
      watchedFolder(path) ? path : (real.realpathSync as Any)(path, ...rest),
    { native: real.realpathSync.native },
  )
  const patched = {
    ...real,
    readFileSync: (path: unknown, ...rest: unknown[]): unknown => {
      if (!served(path)) return (real.readFileSync as Any)(path, ...rest)
      disk.reads.push(path)
      const file = disk.files.get(path)
      if (file === undefined) {
        throw Object.assign(new Error(`ENOENT: no such file or directory, open '${path}'`), {
          code: 'ENOENT',
        })
      }
      if (file instanceof Error) throw file
      return Buffer.from(file)
    },
    realpathSync,
    watch: (path: unknown, ...rest: unknown[]): unknown => {
      if (!watchedFolder(path)) return (real.watch as Any)(path, ...rest)
      if (disk.watchThrows) throw new Error('EMFILE: too many open files, watch')
      const watcher: FakeWatcher = {
        dir: path,
        options: rest[0],
        listener: rest[1] as FakeWatcher['listener'],
        handlers: new Map(),
        closed: false,
      }
      disk.watched.push(watcher)
      const fake = {
        on(event: string, handler: (...given: unknown[]) => void) {
          watcher.handlers.set(event, [...(watcher.handlers.get(event) ?? []), handler])
          return fake
        },
        close() {
          watcher.closed = true
        },
      }
      return fake
    },
  }
  return { ...patched, default: patched }
})

/**
 * # D-031 · a time the app says is the time on the Mac's clock
 *
 * ## What this file pins, and why it is its own file
 *
 * D-031 made every time the app says or reads the Mac's own (`shared/local-time.ts`, `system-zone.ts`):
 * the zone data bundled with Node and Electron can be older than macOS's (Morocco moved to GMT+0 in
 * the Mac's 2026c; Electron's copy still says GMT+1), so a time said through `Date`'s own methods is
 * an hour off the menu bar. ⛔ **No other test file hands the module a zone**, so every other file
 * sees the runtime's own offset and a defect that ignores the zone it was handed passes all of
 * them. This one hands zones, and expects the answer from something that is NOT the code under test:
 * a literal offset (checked against the system's own tz database for Paris, New York and Santiago),
 * a `Date.UTC`, or an `Intl.DateTimeFormat` in UTC on the instant moved by that offset.
 *
 * ⚑ **Two odd zones, +05:45 and -03:30**, are used wherever the answer must differ from every
 * runtime zone used by these tests (including UTC in CI): a defect that falls back to
 * the runtime's own offset cannot pass by being right about a zone it never read.
 *
 *  §1 **the zone** — a POSIX rule's two changes, on the minute and in any year, in both
 *     hemispheres; a zone's own changes before its rule; the interval it keeps answers as a fresh
 *     read does;
 *  §2 **every surface that says a time** — `clockTime`, `clockTimeFrom`, `fullTime`, `calendarDay`,
 *     the state's words, the day a conversation falls on, D-029's cron walk and its one-shot rule,
 *     the digest's window end, the reading pane's date and a Codex export's name;
 *  §3 **a census** that no source says a local time through `Date`'s own methods;
 *  §4 **the reader** — `keepTheSystemZone` over synthetic TZif bytes: the shapes, `TZ`, what it
 *     refuses, a move told once, a failure said once, no watch that holds the process open;
 *  §5 **the wiring** — the window subscribes before it asks and redraws on a move, a missing bridge
 *     is the runtime's own zone, `main`'s order, the preload's doors and the screen's mount, which
 *     no test starts;
 *  §6 **the host** re-places a job's wake-up in the new zone, and a running conversation's word.
 *
 * ## ⚠️ What a source census here reads
 *
 * Every source read goes through {@link code}, which blanks each comment with `prose-spans.ts`'
 * parser, so a docblock that quotes the code cannot satisfy or defeat a census. Every predicate is
 * run on the real source and on planted copies (standing rule 12), so it can fail.
 *
 * ⚠️ **Two `.vue` modules and the window's `local-zone.ts` are loaded by a computed specifier**
 * (`moduleOf`): the node typecheck holds no declaration for `*.vue` or for `Window['api']`, and a
 * `.render.test.ts` is where a test that imports one by name belongs — this file's name is fixed by
 * the design it was written from.
 */

const here = dirname(fileURLToPath(import.meta.url))
const SRC = join(here, '../src')
const migrationsFolder = join(here, '../src/main/db/migrations')

afterEach(() => {
  readLocalTimeFrom(() => null)
})

// ─── Shared fixtures ───────────────────────────────────────────────────────────────────────────

const H = 3_600_000
const DAY = 24 * H

/** UTC. */
const Z_UTC: LocalZone = { before: 0, changes: [], rule: null }
/** +05:45 — Nepal, no daylight time. */
const Z_NP: LocalZone = { before: 20_700_000, changes: [], rule: null }
/** -03:30 — Newfoundland's standard time, with no daylight time. */
const Z_NL: LocalZone = { before: -12_600_000, changes: [], rule: null }
const PARIS: LocalZone = {
  before: 3_600_000,
  changes: [],
  rule: {
    standard: 3_600_000,
    daylight: {
      offset: 7_200_000,
      starts: { month: 3, week: 5, weekday: 0, time: 7_200_000 },
      ends: { month: 10, week: 5, weekday: 0, time: 10_800_000 },
    },
  },
}
const NEW_YORK: LocalZone = {
  before: -18_000_000,
  changes: [],
  rule: {
    standard: -18_000_000,
    daylight: {
      offset: -14_400_000,
      starts: { month: 3, week: 2, weekday: 0, time: 7_200_000 },
      ends: { month: 11, week: 1, weekday: 0, time: 7_200_000 },
    },
  },
}
/** ⚑ Southern: daylight time spans the new year, and a rule's time is 24:00. */
const SANTIAGO: LocalZone = {
  before: -14_400_000,
  changes: [],
  rule: {
    standard: -14_400_000,
    daylight: {
      offset: -10_800_000,
      starts: { month: 9, week: 1, weekday: 6, time: 86_400_000 },
      ends: { month: 4, week: 1, weekday: 6, time: 86_400_000 },
    },
  },
}
/** ⚑ The D-031 story: +1 until the new year 2026, GMT+0 for good after it. */
const MOROCCO: LocalZone = {
  before: 3_600_000,
  changes: [{ at: Date.UTC(2026, 0, 1), offset: 0 }],
  rule: { standard: 0, daylight: null },
}
/** ⚑ Changes only, no rule: after the last, the last offset. */
const STEPS: LocalZone = {
  before: 3_600_000,
  changes: [
    { at: Date.UTC(2020, 0, 1), offset: 0 },
    { at: Date.UTC(2022, 0, 1), offset: 7_200_000 },
    { at: Date.UTC(2024, 0, 1), offset: 3_600_000 },
  ],
  rule: null,
}
/** ⚑ A zone whose rule governs only from its last change on: before that, `before` holds. */
const HANDOVER: LocalZone = {
  before: 0,
  changes: [{ at: Date.UTC(2000, 0, 1), offset: 3_600_000 }],
  rule: PARIS.rule,
}

/**
 * ⚠️ **The one runtime zone that cannot tell +05:45 from itself** — Nepal's. Every "differs from
 * the zone that was handed" below is a check that "both sides equal" is not vacuous, and there is
 * nothing to differ from there; it is skipped, and the equalities beside it still run.
 */
const RUNTIME_IS_NEPAL = new Date(Date.UTC(2026, 9, 1, 12)).getTimezoneOffset() === -345

/** An ISO instant, in ms — a table of edges reads better as text than as `Date.UTC`'s month-from-zero. */
const iso = (text: string): number => Date.parse(text)

/**
 * ⚑ **How far local time is from UTC at `at`, in hours, as `localFields` says it** — the wall clock
 * read as if it were UTC, less the instant (to the second).
 */
function offsetHoursAt(at: number): number {
  const wall = localFields(at)
  return (
    (Date.UTC(wall.year, wall.month, wall.date, wall.hours, wall.minutes, wall.seconds) -
      Math.floor(at / 1000) * 1000) /
    H
  )
}

/**
 * ⚑ **What a time must read, derived WITHOUT the code under test** — an `Intl` formatter in UTC on
 * the instant moved by the offset the zone names. Locale-agnostic: the product's formatter and this
 * one take the person's own locale.
 */
function said(options: Intl.DateTimeFormatOptions, at: number, offsetMs: number): string {
  return new Intl.DateTimeFormat(undefined, { ...options, timeZone: 'UTC' }).format(at + offsetMs)
}

/** The four option sets the app's formatters are built from (`shared/clock.ts`, `lib/clock.ts`). */
const CLOCK: Intl.DateTimeFormatOptions = { hour: '2-digit', minute: '2-digit' }
const DAY_AND_CLOCK: Intl.DateTimeFormatOptions = {
  day: 'numeric',
  month: 'short',
  hour: '2-digit',
  minute: '2-digit',
}
const FULL: Intl.DateTimeFormatOptions = {
  year: 'numeric',
  month: 'numeric',
  day: 'numeric',
  hour: 'numeric',
  minute: 'numeric',
  second: 'numeric',
}
const DAY_ONLY: Intl.DateTimeFormatOptions = { year: 'numeric', month: 'numeric', day: 'numeric' }

/** A change: the first instant of its new offset, the offset (hours) just before and just after. */
type Edge = readonly [at: string, before: number, after: number]

const PARIS_EDGES: readonly Edge[] = [
  ['2026-03-29T01:00:00Z', 1, 2],
  ['2026-10-25T01:00:00Z', 2, 1],
  ['2027-03-28T01:00:00Z', 1, 2],
  ['2027-10-31T01:00:00Z', 2, 1],
  ['2040-03-25T01:00:00Z', 1, 2],
  ['2040-10-28T01:00:00Z', 2, 1],
]
const NEW_YORK_EDGES: readonly Edge[] = [
  ['2026-03-08T07:00:00Z', -5, -4],
  ['2026-11-01T06:00:00Z', -4, -5],
  ['2027-03-14T07:00:00Z', -5, -4],
  ['2027-11-07T06:00:00Z', -4, -5],
  ['2040-03-11T07:00:00Z', -5, -4],
  ['2040-11-04T06:00:00Z', -4, -5],
]
const SANTIAGO_EDGES: readonly Edge[] = [
  ['2026-09-06T04:00:00Z', -4, -3],
  ['2027-04-04T03:00:00Z', -3, -4],
  ['2040-09-02T04:00:00Z', -4, -3],
]
const STEPS_EDGES: readonly Edge[] = [
  ['2020-01-01T00:00:00Z', 1, 0],
  ['2022-01-01T00:00:00Z', 0, 2],
  ['2024-01-01T00:00:00Z', 2, 1],
]
const MOROCCO_EDGES: readonly Edge[] = [['2026-01-01T00:00:00Z', 1, 0]]
const HANDOVER_EDGES: readonly Edge[] = [
  ['2000-01-01T00:00:00Z', 0, 1],
  ['2000-03-26T01:00:00Z', 1, 2],
  ['2000-10-29T01:00:00Z', 2, 1],
]
const EVERY_ZONE: readonly (readonly [string, LocalZone, readonly Edge[]])[] = [
  ['Paris', PARIS, PARIS_EDGES],
  ['New York', NEW_YORK, NEW_YORK_EDGES],
  ['Santiago', SANTIAGO, SANTIAGO_EDGES],
  ['STEPS', STEPS, STEPS_EDGES],
  ['Morocco', MOROCCO, MOROCCO_EDGES],
  ['HANDOVER', HANDOVER, HANDOVER_EDGES],
]

// ─── Source readers ────────────────────────────────────────────────────────────────────────────

/**
 * Every comment blanked, newlines kept, so a docblock quoting the code cannot stand in for it.
 *
 * ⚠️ Blanked line by line, where each span says it starts: a run of `//` lines is one span joined
 * WITHOUT the indentation between them, so an indented run is not in the source as one string and
 * replacing the span whole would leave it standing.
 */
function code(file: string, source: string): string {
  const lines = source.split('\n')
  for (const span of proseSpans(file, source)) {
    span.text.split('\n').forEach((said, offset) => {
      const at = span.line - 1 + offset
      const from = lines[at]?.indexOf(said) ?? -1
      if (from < 0) throw new Error(`${file}:${at + 1} does not hold the comment ${said}`)
      const line = lines[at] ?? ''
      lines[at] = line.slice(0, from) + ' '.repeat(said.length) + line.slice(from + said.length)
    })
  }
  return lines.join('\n')
}

/** One source under `src/`, comments blanked. */
const sourceOf = (path: string): string => code(path, readFileSync(join(SRC, path), 'utf8'))

/** A marker that is in the source exactly once, replaced — and a replacement that changed something. */
function planted(source: string, marker: string, instead: string): string {
  const at = source.indexOf(marker)
  expect(at, `${JSON.stringify(marker)} is no longer in the source`).toBeGreaterThan(-1)
  expect(source.indexOf(marker, at + 1), `${JSON.stringify(marker)} is in the source twice`).toBe(
    -1,
  )
  return source.slice(0, at) + instead + source.slice(at + marker.length)
}

const escapeRegex = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
/** Stands for any stretch of source between two fragments of {@link inOrder}. */
const ANYTHING = Symbol('anything')
/**
 * ⚑ **Fragments of source, each exactly as written, in this order and with nothing between them but
 * whitespace** (a blanked comment is whitespace) — or {@link ANYTHING}.
 */
function inOrder(...parts: (string | typeof ANYTHING)[]): RegExp {
  return new RegExp(
    parts.map((part) => (part === ANYTHING ? '[\\s\\S]*?' : escapeRegex(part))).join('\\s*'),
  )
}

/**
 * A module under `src/`, by a specifier no typechecker reads — see the docblock: a `.vue`, and the
 * window's `local-zone.ts`, whose `Window['api']` the node program has no declaration of.
 */
async function moduleOf(path: string): Promise<Record<string, unknown>> {
  const file = join(SRC, path)
  return (await import(/* @vite-ignore */ file)) as Record<string, unknown>
}

/** A `.vue` module's component. */
async function component(name: string): Promise<Component> {
  return (await moduleOf(`renderer/src/components/${name}`)).default as Component
}

// ─── §1 · the rule, the changes, the interval ──────────────────────────────────────────────────

describe('§1 · a zone answers the offset at any instant, on the minute its data names', () => {
  it('Paris and New York change on the minute their rules name, in 2026, 2027 and 2040', () => {
    for (const [name, zone, edges] of [
      ['Paris', PARIS, PARIS_EDGES],
      ['New York', NEW_YORK, NEW_YORK_EDGES],
    ] as const) {
      readLocalTimeFrom(() => zone)
      for (const [text, before, after] of edges) {
        const edge = iso(text)
        // ⚑ Both sides of every edge, so a rule that never changes, or changes an hour early or
        // late, fails one of the pair.
        expect(offsetHoursAt(edge - 1000), `${name}, the second before ${text}`).toBe(before)
        expect(offsetHoursAt(edge), `${name}, ${text}`).toBe(after)
      }
    }

    // Between the edges: Paris in July is summer time and in January winter time.
    readLocalTimeFrom(() => PARIS)
    expect(offsetHoursAt(iso('2026-07-01T12:00:00Z'))).toBe(2)
    expect(offsetHoursAt(iso('2026-01-15T12:00:00Z'))).toBe(1)
    // The edges' own wall clock: 02:xx is skipped in spring, and the second 02:59 comes in autumn.
    expect(localFields(iso('2026-03-29T01:00:00Z')).hours).toBe(3)
    expect(localFields(iso('2026-03-29T00:59:59Z')).hours).toBe(1)
    const autumn = localFields(iso('2026-10-25T00:59:59Z'))
    expect([autumn.hours, autumn.minutes]).toEqual([2, 59])

    // ⚑ October 2026 and March 2027 are the years whose "last Sunday" (week 5) overflows the month
    // and must fold back (Oct 1 2026 is a Thursday, Mar 1 2027 a Monday): both are in the table above,
    // and the day they land on is the last Sunday, not the first of the next month.
    expect(new Date(iso('2026-10-25T01:00:00Z')).getUTCDay()).toBe(0)
    expect(new Date(iso('2027-03-28T01:00:00Z')).getUTCDay()).toBe(0)
    expect(new Date(iso('2026-10-25T01:00:00Z') + 7 * DAY).getUTCMonth()).toBe(10)
  })

  it('a southern zone has its daylight time across the new year', () => {
    readLocalTimeFrom(() => SANTIAGO)
    for (const [text, hours] of [
      ['2026-09-06T03:59:59Z', -4],
      ['2026-09-06T04:00:00Z', -3],
      ['2026-12-25T12:00:00Z', -3],
      ['2027-02-01T12:00:00Z', -3],
      ['2027-04-04T02:59:59Z', -3],
      ['2027-04-04T03:00:00Z', -4],
      ['2026-07-01T12:00:00Z', -4],
      // ⚑ Sept 1 2040 is the first Saturday, so the rule's 24:00 lands on Sept 2.
      ['2040-09-02T03:59:59Z', -4],
      ['2040-09-02T04:00:00Z', -3],
    ] as const) {
      expect(offsetHoursAt(iso(text)), text).toBe(hours)
    }
    // One zone object, July and the turn of the year: a rule that read every instant as one offset,
    // or a window that did not wrap the new year, fails here.
    expect(offsetHoursAt(iso('2026-07-01T12:00:00Z'))).not.toBe(
      offsetHoursAt(iso('2026-12-25T12:00:00Z')),
    )
  })

  it('a zone answers from its own changes, and from its rule only after the last', () => {
    readLocalTimeFrom(() => STEPS)
    for (const [text, hours] of [
      ['2019-12-31T23:59:59.999Z', 1],
      ['2020-01-01T00:00:00Z', 0],
      ['2021-06-01T00:00:00Z', 0],
      ['2021-12-31T23:59:59Z', 0],
      ['2022-01-01T00:00:00Z', 2],
      ['2023-06-01T00:00:00Z', 2],
      ['2024-01-01T00:00:00Z', 1],
      // After the last change, and no rule: the last offset.
      ['2035-07-01T00:00:00Z', 1],
    ] as const) {
      expect(offsetHoursAt(iso(text)), `STEPS ${text}`).toBe(hours)
    }

    readLocalTimeFrom(() => MOROCCO)
    expect(offsetHoursAt(iso('2025-12-31T23:59:59Z'))).toBe(1)
    expect(offsetHoursAt(iso('2026-01-01T00:00:00Z'))).toBe(0)
    // A rule with no daylight time is its standard.
    expect(offsetHoursAt(iso('2040-07-01T12:00:00Z'))).toBe(0)

    readLocalTimeFrom(() => HANDOVER)
    // ⚑ BEFORE the first change it is `before` — the rule does not govern it, and would say +2…
    expect(offsetHoursAt(iso('1999-07-01T12:00:00Z'))).toBe(0)
    // …and from the last change on the rule governs, summer and winter.
    expect(offsetHoursAt(iso('2000-01-15T12:00:00Z'))).toBe(1)
    expect(offsetHoursAt(iso('2000-07-01T12:00:00Z'))).toBe(2)
    expect(offsetHoursAt(iso('2000-10-29T00:59:59Z'))).toBe(2)
    expect(offsetHoursAt(iso('2000-10-29T01:00:00Z'))).toBe(1)
  })

  it('the interval a zone keeps answers as a fresh read does, at and either side of every edge', () => {
    /** Every instant around a zone's edges: ±1 ms, the edge, and a 15-minute sweep three days each side. */
    const around = (edges: readonly Edge[]): number[] => {
      const found = new Set<number>()
      for (const [text] of edges) {
        const edge = iso(text)
        for (const at of [edge - 1, edge, edge + 1]) found.add(at)
        for (let at = edge - 3 * DAY; at <= edge + 3 * DAY; at += 15 * 60_000) found.add(at)
      }
      return [...found].sort((a, b) => a - b)
    }
    /** A fixed pseudo-random order (a seeded shuffle), so a failure is the same failure each run. */
    const scrambled = (instants: readonly number[]): number[] => {
      const out = [...instants]
      let seed = 20_261_001
      for (let at = out.length - 1; at > 0; at -= 1) {
        seed = (seed * 1_103_515_245 + 12_345) % 2_147_483_648
        const other = seed % (at + 1)
        const kept = out[at] ?? 0
        out[at] = out[other] ?? 0
        out[other] = kept
      }
      return out
    }
    /** ⚑ One zone object throughout (so the kept interval is used), or a fresh copy per read (so nothing is). */
    const answers = (zone: LocalZone, instants: readonly number[], keeps: boolean): number[] => {
      readLocalTimeFrom(keeps ? () => zone : () => ({ ...zone }))
      return instants.map((at) => offsetHoursAt(at))
    }

    for (const [name, zone, edges] of EVERY_ZONE) {
      const forward = around(edges)
      expect(forward.length, `${name} has instants to read`).toBeGreaterThan(edges.length * 3)
      for (const [order, instants] of [
        ['forward', forward],
        ['backward', [...forward].reverse()],
        ['scrambled', scrambled(forward)],
      ] as const) {
        const cached = answers(zone, instants, true)
        const fresh = answers(zone, instants, false)
        const differing = instants.filter((_, at) => cached[at] !== fresh[at])
        expect(
          differing.map((at) => new Date(at).toISOString()),
          `${name}, ${order}`,
        ).toEqual([])
      }

      // ⚑ The fresh side is the literal table's too, so both sides cannot be wrong the same way.
      for (const [text, before, after] of edges) {
        const edge = iso(text)
        expect(answers(zone, [edge - 1, edge, edge + 1], false), `${name} ${text}`).toEqual([
          before,
          after,
          after,
        ])
        // …and the one object, visited across the edge the other way round, says the same.
        expect(
          answers(zone, [edge, edge - 1, edge + 1, edge - 1], true),
          `${name} ${text}`,
        ).toEqual([after, before, after, before])
      }
    }
  })

  it('with no zone handed, every answer is the runtime own', () => {
    readLocalTimeFrom(() => null)
    for (const at of [
      0,
      1_700_000_000_000,
      Date.UTC(2024, 1, 29, 12),
      Date.UTC(2026, 2, 29, 1, 30),
      Date.UTC(2026, 9, 25, 0, 30),
    ]) {
      const wall = new Date(at)
      expect(localFields(at), `at ${at}`).toEqual({
        year: wall.getFullYear(),
        month: wall.getMonth(),
        date: wall.getDate(),
        day: wall.getDay(),
        hours: wall.getHours(),
        minutes: wall.getMinutes(),
        seconds: wall.getSeconds(),
      })
    }
    // Two instants straddling the runtime's own midnights, and a day with a change in it.
    for (const midnight of [new Date(2026, 5, 15).getTime(), new Date(2026, 2, 29).getTime()]) {
      for (const [a, b] of [
        [midnight - 1, midnight],
        [midnight, midnight + 23 * H],
        [midnight - 1000, midnight - 1],
        [midnight + H, midnight + DAY + H],
      ] as const) {
        expect(sameLocalDay(a, b), `${a} ${b}`).toBe(
          new Date(a).toDateString() === new Date(b).toDateString(),
        )
      }
    }

    // ⚑ The same calls after a zone is handed: it really replaces the runtime's.
    readLocalTimeFrom(() => Z_NP)
    const wall = localFields(Date.UTC(2026, 9, 1, 12, 0))
    expect([wall.hours, wall.minutes]).toEqual([17, 45])
  })
})

// ─── §2 · every surface that says a time ───────────────────────────────────────────────────────

describe('§2 · every time the app says is the Mac’s, in the person’s own locale', () => {
  it('every time the app says is said on the Mac clock, in the person locale', () => {
    const at = Date.UTC(2026, 9, 1, 12, 0)
    readLocalTimeFrom(() => Z_NP)
    const nepal = clockTime(at)
    expect(nepal).toBe(said(CLOCK, at, 20_700_000))
    readLocalTimeFrom(() => Z_NL)
    expect(clockTime(at)).toBe(said(CLOCK, at, -12_600_000))

    // One zone, winter and summer: one formatter per offset, both right.
    readLocalTimeFrom(() => PARIS)
    const winter = Date.UTC(2026, 0, 15, 12, 0)
    const summer = Date.UTC(2026, 6, 1, 12, 0)
    expect(clockTime(winter)).toBe(said(CLOCK, winter, H))
    expect(clockTime(summer)).toBe(said(CLOCK, summer, 2 * H))
    // The D-031 story: an hour apart across the new year.
    readLocalTimeFrom(() => MOROCCO)
    expect(clockTime(Date.UTC(2025, 11, 31, 23, 0))).toBe(
      said(CLOCK, Date.UTC(2025, 11, 31, 23, 0), H),
    )
    expect(clockTime(Date.UTC(2026, 0, 1, 0, 30))).toBe(said(CLOCK, Date.UTC(2026, 0, 1, 0, 30), 0))

    readLocalTimeFrom(() => Z_NP)
    // ⚑ The day or the bare time: 22:45 on Oct 1 and 00:45 on Oct 2 are different Mac days (but one
    // UTC day), and 01:45 and 10:45 on Oct 2 are one Mac day (but two UTC days).
    const evening = Date.UTC(2026, 9, 1, 17, 0)
    expect(clockTimeFrom(evening, Date.UTC(2026, 9, 1, 19, 0))).toBe(
      said(DAY_AND_CLOCK, evening, 20_700_000),
    )
    const night = Date.UTC(2026, 9, 1, 20, 0)
    expect(clockTimeFrom(night, Date.UTC(2026, 9, 2, 5, 0))).toBe(said(CLOCK, night, 20_700_000))

    // The window's two: the tooltip's whole moment (01:45:05 on Oct 2) and the day alone (Oct 2).
    const moment = Date.UTC(2026, 9, 1, 20, 0, 5)
    expect(fullTime(moment)).toBe(said(FULL, moment, 20_700_000))
    expect(calendarDay(moment)).toBe(said(DAY_ONLY, moment, 20_700_000))
    // The state's words say the same time, and plain `scheduled` where there is none.
    expect(agentStateWords({ is: 'scheduled', dueAt: at })).toBe(
      `scheduled · ${said(CLOCK, at, 20_700_000)}`,
    )
    expect(agentStateWords({ is: 'scheduled', dueAt: null })).toBe('scheduled')
    // The guards still hold with a zone handed.
    for (const unusable of [undefined, Number.NaN, 9e15]) {
      expect(clockTime(unusable)).toBe('')
      expect(fullTime(unusable)).toBe('')
      expect(calendarDay(unusable)).toBe('')
    }

    // ⚑ The paired positive: with no zone handed, the runtime's own `Date` method — and not the
    // string above, so "both sides equal" is not vacuous.
    readLocalTimeFrom(() => null)
    expect(clockTime(at)).toBe(new Date(at).toLocaleTimeString(undefined, CLOCK))
    if (!RUNTIME_IS_NEPAL) expect(clockTime(at)).not.toBe(nepal)
  })

  it('two instants are one day when the Mac calendar says so, and the library Today band reads that', async () => {
    const recencyOf = (await moduleOf('renderer/src/components/SessionLibrary.vue')).recencyOf as (
      at: number,
      now: number,
    ) => 'today' | 'week' | 'older'

    readLocalTimeFrom(() => Z_NP)
    // 22:45 on Oct 1 and 00:45 on Oct 2: one UTC day, two Mac days.
    const evening = Date.UTC(2026, 9, 1, 17, 0)
    const after = Date.UTC(2026, 9, 1, 19, 0)
    expect(sameLocalDay(evening, after)).toBe(false)
    expect(recencyOf(evening, after)).toBe('week')
    // 01:45 and 10:45 on Oct 2: two UTC days, one Mac day.
    const night = Date.UTC(2026, 9, 1, 20, 0)
    const morning = Date.UTC(2026, 9, 2, 5, 0)
    expect(sameLocalDay(night, morning)).toBe(true)
    expect(recencyOf(night, morning)).toBe('today')
    expect(recencyOf(morning - 40 * DAY, morning)).toBe('older')

    // Paris: the midnight moves with the offset, so one pair of instants is two days in July (+2h:
    // 23:30 and 00:30) and one in January (+1h: 22:30 and 23:30) — and the reverse for the next pair.
    readLocalTimeFrom(() => PARIS)
    expect(sameLocalDay(Date.UTC(2026, 6, 1, 21, 30), Date.UTC(2026, 6, 1, 22, 30))).toBe(false)
    expect(sameLocalDay(Date.UTC(2026, 0, 15, 21, 30), Date.UTC(2026, 0, 15, 22, 30))).toBe(true)
    expect(sameLocalDay(Date.UTC(2026, 6, 1, 22, 30), Date.UTC(2026, 6, 1, 23, 30))).toBe(true)
    expect(sameLocalDay(Date.UTC(2026, 0, 15, 22, 30), Date.UTC(2026, 0, 15, 23, 30))).toBe(false)
    expect(recencyOf(Date.UTC(2026, 6, 1, 21, 30), Date.UTC(2026, 6, 1, 22, 30))).toBe('week')
    expect(recencyOf(Date.UTC(2026, 0, 15, 21, 30), Date.UTC(2026, 0, 15, 22, 30))).toBe('today')
  })

  it('a scheduled job is placed on the Mac wall clock, and another zone is another calendar', () => {
    const from = Date.UTC(2026, 9, 1, 12, 0)
    const next = (zone: typeof Z_UTC): number | null => {
      readLocalTimeFrom(() => zone)
      const found = nextCronOccurrence('0 3 * * *', {
        after: from,
        inclusive: false,
        zone: 'UTC',
        calendar: hostCalendar(zone),
      })
      return found.kind === 'known' ? found.nominalAt : null
    }
    expect(next(Z_UTC)).toBe(Date.UTC(2026, 9, 2, 3, 0))
    // ⚑ The same expression and the same `from` in another zone: 03:00 at +5:45 is 21:15 UTC.
    expect(next(Z_NP)).toBe(Date.UTC(2026, 9, 1, 21, 15))
    // ⚑ A zone that moved is another version of the calendar, so a time placed on the one before
    // is placed again; the same zone read twice is the same one.
    expect(hostCalendar(Z_NP).version).not.toBe(hostCalendar(Z_UTC).version)
    expect(hostCalendar(Z_NP).version).toBe(hostCalendar({ ...Z_NP }).version)
    expect(hostCalendar(null).version).not.toBe(hostCalendar(Z_UTC).version)
  })

  it('the time "Since you were last here" starts, the reading pane date and a Codex export name say the Mac time', async () => {
    const to = Date.UTC(2026, 9, 1, 17, 0)
    const sinceSaid = (): string =>
      sinceWords({ lines: [], finished: 0, failed: 0, partial: false, capped: false }, to, to)

    const entry: LibraryEntry = {
      id: 'sess_read',
      provider: 'claude',
      providerSessionId: 'thread-1',
      recordId: 'sess_read',
      cwd: '/work/parser',
      title: 'Fix the parser',
      preview: 'the parser drops a line',
      createdAt: 1_000,
      updatedAt: Date.UTC(2026, 9, 1, 20, 0),
      bytes: 4_096,
      origin: 'user-home',
      onDisk: true,
      readable: true,
      derived: 'current',
      lastEnding: 'completed',
      unresumableReason: 'one of the person’s own conversations',
      child: null,
    }
    const history = (): WindowState => {
      const window = createWindow()
      const events: PersistedEventInfo['event'][] = [
        { type: 'user_turn', text: 'hello there' },
        { type: 'assistant_message', text: 'hello back' },
      ]
      openAt(
        window,
        {
          entries: events.map((event, ordinal) => ({ ordinal, at: 1_000 + ordinal, event })),
          from: 0,
          hasOlder: false,
          turnAligned: true,
        },
        'sess_read',
      )
      return window
    }
    const pane = await component('ReadingPane.vue')
    const paneHtml = (): Promise<string> =>
      renderToString(
        createSSRApp({
          render: () => h(pane, { entry, history: history(), mode: 'normal' } as never),
        }),
      )
    /** The date the pane's header says, as its markup carries it (a scoped style adds an attribute). */
    const whenOf = (html: string): string | undefined =>
      /<span class="when"[^>]*>([^<]*)<\/span>/.exec(html)?.[1]
    const ref: SessionRef = { provider: 'codex', sessionId: 'th_1', cwd: '/w', rotation: 0 }

    // (a) when the box starts — 22:45 at +5:45.
    readLocalTimeFrom(() => Z_NP)
    const words = sinceSaid()
    expect(words).toBe(`Today, since ${said(CLOCK, to, 20_700_000)} · nothing finished or failed`)
    // (b) the pane's date — 01:45:00 on Oct 2.
    const html = await paneHtml()
    expect(html).toContain('hello there')
    expect(whenOf(html)).toBe(said(FULL, entry.updatedAt, 20_700_000))
    // (c) a Codex export's name: the Mac's date and clock, and the same path for Claude in any zone.
    const recorded = join('/src', 'projects', '-work', 'th_1.jsonl')
    expect(nativeExportPath('codex', '/h', ref, Date.UTC(2026, 9, 1, 20, 0, 30), recorded)).toBe(
      join('/h', 'sessions', '2026', '10', '02', 'rollout-2026-10-02T01-45-30-th_1.jsonl'),
    )
    const claude = nativeExportPath('claude', '/h', { ...ref, provider: 'claude' }, 5, recorded)
    readLocalTimeFrom(() => Z_NL)
    expect(nativeExportPath('codex', '/h', ref, Date.UTC(2026, 9, 1, 2, 0, 30), recorded)).toBe(
      join('/h', 'sessions', '2026', '09', '30', 'rollout-2026-09-30T22-30-30-th_1.jsonl'),
    )
    expect(nativeExportPath('claude', '/h', { ...ref, provider: 'claude' }, 5, recorded)).toBe(
      claude,
    )

    // ⚑ The paired positive: with no zone handed, each is the old `Date`-method output — and none
    // is what the zone above said.
    readLocalTimeFrom(() => null)
    const own = sinceSaid()
    expect(own).toBe(
      `Today, since ${new Date(to).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} · nothing finished or failed`,
    )
    if (!RUNTIME_IS_NEPAL) expect(own).not.toBe(words)
    const ownHtml = await paneHtml()
    expect(whenOf(ownHtml)).toBe(new Date(entry.updatedAt).toLocaleString())
    if (!RUNTIME_IS_NEPAL) expect(whenOf(ownHtml)).not.toBe(whenOf(html))
    const startedAt = Date.UTC(2026, 9, 1, 20, 0, 30)
    const wall = new Date(startedAt)
    const two = (value: number): string => String(value).padStart(2, '0')
    expect(nativeExportPath('codex', '/h', ref, startedAt, recorded)).toBe(
      join(
        '/h',
        'sessions',
        String(wall.getFullYear()),
        two(wall.getMonth() + 1),
        two(wall.getDate()),
        `rollout-${wall.getFullYear()}-${two(wall.getMonth() + 1)}-${two(wall.getDate())}T${two(wall.getHours())}-${two(wall.getMinutes())}-${two(wall.getSeconds())}-th_1.jsonl`,
      ),
    )
  })
})

// ─── §3 · no source says a local time its own way ──────────────────────────────────────────────

describe('§3 · no source says a local time through the Date’s own methods', () => {
  /** What a source that says a time the runtime's own way looks like. */
  const PATTERNS: readonly (readonly [name: string, pattern: RegExp])[] = [
    ['toLocale…String', /\.(toLocaleDateString|toLocaleTimeString|toDateString|toTimeString)\(/],
    ['new Date(…).toLocaleString', /new Date\([^()]*(\([^()]*\))*[^()]*\)\.toLocaleString\(/],
    [
      'a local getter or setter',
      /\.(getFullYear|getMonth|getDate|getDay|getHours|getMinutes|getSeconds|getMilliseconds|setFullYear|setMonth|setDate|setHours|setMinutes|setSeconds|setMilliseconds)\(/,
    ],
    ['getTimezoneOffset', /\.getTimezoneOffset\(/],
    ['Intl.DateTimeFormat', /\bIntl\.DateTimeFormat\b/],
  ]
  /** ⚑ The one module that owns the runtime's offset and builds the formatters. */
  const OWNER = 'shared/local-time.ts'
  const OWNER_MAY = new Set(['getTimezoneOffset', 'Intl.DateTimeFormat'])
  /**
   * The schedule planner can build a calendar for a zone a caller names. This app's own planning
   * never asks it to: it hands the planner the Mac's calendar (`hostCalendar`), and no other source
   * names that builder.
   */
  const NAMED_ZONE = 'shared/schedule-wake.ts'

  /** Which patterns a source (comments blanked) matches, with the line each is on. */
  const matches = (blanked: string): [string, number][] =>
    PATTERNS.flatMap(([name, pattern]) =>
      blanked
        .split('\n')
        .flatMap((line, at) => (pattern.test(line) ? [[name, at + 1] as [string, number]] : [])),
    )

  const sourcesUnder = (dir: string): string[] =>
    readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
      const path = join(dir, entry.name)
      if (entry.isDirectory()) return entry.name === 'node_modules' ? [] : sourcesUnder(path)
      return /\.(ts|vue)$/.test(entry.name) ? [path] : []
    })

  it('no source outside the clock module says a local time through the Date own methods', () => {
    const files = sourcesUnder(SRC).map((path) => relative(SRC, path).replaceAll('\\', '/'))
    // ⚑ Non-vacuity: the walk reaches the tree, the surfaces D-031 moved, and the owner.
    expect(files.length).toBeGreaterThan(300)
    for (const surface of [
      'renderer/src/lib/recent-activity.ts',
      'renderer/src/components/SessionLibrary.vue',
      'renderer/src/components/CapabilitiesSheet.vue',
      'renderer/src/components/OwnInstructions.vue',
      'renderer/src/components/ReadingPane.vue',
      'main/archive/export-session.ts',
      'shared/clock.ts',
      OWNER,
    ]) {
      expect(files, `${surface} is not in the walk`).toContain(surface)
    }
    expect(
      [...new Set(matches(sourceOf(OWNER)).map(([name]) => name))].sort(),
      'the owner holds exactly the two things it is allowed',
    ).toEqual([...OWNER_MAY].sort())

    const found = files.flatMap((file) =>
      file === OWNER
        ? []
        : matches(sourceOf(file))
            .filter(([name]) => !(file === NAMED_ZONE && name === 'Intl.DateTimeFormat'))
            .map(([name, line]) => `${file}:${String(line)} ${name}`),
    )
    expect(found).toEqual([])
    expect(matches(sourceOf(NAMED_ZONE)).map(([name]) => name)).toEqual([
      'Intl.DateTimeFormat',
      'Intl.DateTimeFormat',
    ])
    expect(
      files.filter((file) => file !== NAMED_ZONE && /\bcreateIntlCalendar\b/.test(sourceOf(file))),
      'a source builds a calendar from a zone name, not from the Mac zone',
    ).toEqual([])
  })

  it('…and the predicate flags the spellings D-031 removed, and not a docblock that quotes them', () => {
    // Standing rule 12: the same predicate over copies carrying each old spelling.
    const digest = sourceOf('renderer/src/lib/recent-activity.ts')
    expect(matches(digest)).toEqual([])
    expect(
      matches(
        planted(
          digest,
          'Today, since ${clockTime(since)}',
          "Today, since ${new Date(since).toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'})}",
        ),
      ).map(([name]) => name),
    ).toEqual(['toLocale…String'])

    const sheet = sourceOf('renderer/src/components/CapabilitiesSheet.vue')
    expect(
      matches(
        planted(
          sheet,
          '{{ calendarDay(identity.createdAt) }}',
          '{{ new Date(identity.createdAt).toLocaleDateString() }}',
        ),
      ).map(([name]) => name),
    ).toEqual(['toLocale…String'])

    const own = sourceOf('renderer/src/components/OwnInstructions.vue')
    expect(
      matches(
        planted(own, 'fullTime(reading.readAt)', 'new Date(reading.readAt).toLocaleString()'),
      ).map(([name]) => name),
    ).toEqual(['new Date(…).toLocaleString'])

    // A docblock that merely quotes `toLocaleDateString` is not a source that says a time.
    const quoted = '/** says `d.toLocaleDateString()` and `d.getHours()` */\nexport const x = 1\n'
    expect(matches(code('quoted.ts', quoted))).toEqual([])
    expect(
      matches(code('said.ts', 'export const y = new Date(1).toLocaleDateString()\n')).length,
    ).toBe(1)
  })
})

// ─── §4 · the file the Mac's clock reads ───────────────────────────────────────────────────────

/**
 * ⚑ **A TZif file** (RFC 8536), version 2 by default, as bytes — the one shape `system-zone.ts`
 * reads. A version-1 block with one type and one abbreviation byte, then the 64-bit block: the
 * changes (ms, written as seconds), the type each selects, the types (type 0 is `before`), one
 * abbreviation byte, and the footer. ⚠️ A `version` of `\0` is the version-1 file a reader of 2 and
 * 3 refuses.
 */
function tzif(zone: {
  readonly version?: string
  readonly before: number
  readonly changes: readonly { at: number; offset: number }[]
  readonly footer: string
}): Buffer {
  const header = (times: number, types: number, version: string): Buffer => {
    const bytes = Buffer.alloc(44)
    bytes.write('TZif', 0, 'latin1')
    bytes.write(version, 4, 'latin1')
    ;[0, 0, 0, times, types, 1].forEach((count, at) => bytes.writeUInt32BE(count, 20 + at * 4))
    return bytes
  }
  const offsets = [zone.before]
  for (const change of zone.changes)
    if (!offsets.includes(change.offset)) offsets.push(change.offset)
  const times = Buffer.alloc(zone.changes.length * 8)
  zone.changes.forEach((change, at) => times.writeBigInt64BE(BigInt(change.at / 1000), at * 8))
  const kinds = Buffer.from(zone.changes.map((change) => offsets.indexOf(change.offset)))
  const types = Buffer.alloc(offsets.length * 6)
  offsets.forEach((offset, at) => types.writeInt32BE(offset / 1000, at * 6))
  return Buffer.concat([
    header(0, 1, zone.version ?? '2'),
    Buffer.alloc(7),
    header(zone.changes.length, offsets.length, '2'),
    times,
    kinds,
    types,
    Buffer.alloc(1),
    Buffer.from(`\n${zone.footer}\n`, 'latin1'),
  ])
}

const PARIS_FILE = tzif({ before: 3_600_000, changes: [], footer: 'CET-1CEST,M3.5.0,M10.5.0/3' })
const SANTIAGO_FILE = tzif({
  before: -14_400_000,
  changes: [],
  footer: '<-04>4<-03>,M9.1.6/24,M4.1.6/24',
})
const MOROCCO_FILE = tzif({
  before: 3_600_000,
  changes: [{ at: Date.UTC(2026, 0, 1), offset: 0 }],
  footer: '<+00>0',
})
const NEW_YORK_FILE = tzif({
  before: -18_000_000,
  changes: [],
  footer: 'EST5EDT,M3.2.0,M11.1.0',
})

describe('§4 · the zone file the Mac’s clock reads', () => {
  let savedTz: string | undefined
  let warn: MockInstance<typeof console.warn>

  beforeEach(() => {
    savedTz = process.env.TZ
    delete process.env.TZ
    disk.files.clear()
    disk.reads.length = 0
    disk.watched.length = 0
    disk.watchThrows = false
    warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
  })

  afterEach(() => {
    if (savedTz === undefined) delete process.env.TZ
    else process.env.TZ = savedTz
    readLocalTimeFrom(() => null)
    warn.mockRestore()
  })

  /** Main's start: the reader, and what it told. */
  const launch = (): { reader: () => LocalZone | null; moved: ReturnType<typeof vi.fn> } => {
    const moved = vi.fn<(zone: LocalZone) => void>()
    return { reader: keepTheSystemZone(moved), moved }
  }
  const warned = (): string[] => warn.mock.calls.map((call) => String(call[0]))
  /** A folder's watcher, and an event it reports. */
  const watcherOf = (dir: string): FakeWatcher => {
    const found = disk.watched.find((one) => one.dir === dir)
    if (found === undefined) throw new Error(`nothing is watching ${dir}`)
    return found
  }
  const reports = (dir: string, file: string | null): void =>
    watcherOf(dir).listener('rename', file)

  it('the file the clock reads is parsed: Paris, Santiago and a zone that changed', () => {
    // A rule only; a rule with a southern wrap and a 24-hour time; a change and a rule with no daylight time.
    disk.files.set('/etc/localtime', PARIS_FILE)
    const paris = launch()
    expect(paris.reader()).toEqual(PARIS)
    expect(paris.moved).not.toHaveBeenCalled()

    disk.files.set('/etc/localtime', SANTIAGO_FILE)
    expect(launch().reader()).toEqual(SANTIAGO)

    disk.files.set('/etc/localtime', MOROCCO_FILE)
    expect(launch().reader()).toEqual(MOROCCO)

    // ⚑ And as offsets, end to end: a parser that returns the right shape with the wrong sign is
    // caught here.
    disk.files.set('/etc/localtime', PARIS_FILE)
    readLocalTimeFrom(launch().reader)
    expect(offsetHoursAt(iso('2026-03-29T00:59:59Z'))).toBe(1)
    expect(offsetHoursAt(iso('2026-03-29T01:00:00Z'))).toBe(2)
    disk.files.set('/etc/localtime', SANTIAGO_FILE)
    readLocalTimeFrom(launch().reader)
    expect(offsetHoursAt(iso('2026-12-25T12:00:00Z'))).toBe(-3)
    expect(offsetHoursAt(iso('2026-07-01T12:00:00Z'))).toBe(-4)
    disk.files.set('/etc/localtime', MOROCCO_FILE)
    readLocalTimeFrom(launch().reader)
    expect(offsetHoursAt(iso('2025-12-31T23:59:59Z'))).toBe(1)
    expect(offsetHoursAt(iso('2026-01-01T00:00:00Z'))).toBe(0)
    expect(warned()).toEqual([])
  })

  it('TZ is read as a zone name and nothing else', () => {
    disk.files.set('/etc/localtime', SANTIAGO_FILE)
    disk.files.set('/usr/share/zoneinfo/Europe/Paris', PARIS_FILE)
    disk.files.set('/usr/share/zoneinfo/EST5EDT', NEW_YORK_FILE)
    const withTz = (tz: string | undefined): LocalZone | null => {
      disk.reads.length = 0
      warn.mockClear()
      if (tz === undefined) delete process.env.TZ
      else process.env.TZ = tz
      return launch().reader()
    }

    // The zone NAME, plain or with the leading colon, and a name that is itself a rule's.
    expect(withTz('Europe/Paris')).toEqual(PARIS)
    expect(disk.reads).toContain('/usr/share/zoneinfo/Europe/Paris')
    expect(disk.reads).not.toContain('/etc/localtime')
    expect(withTz(':Europe/Paris')).toEqual(PARIS)
    expect(withTz('EST5EDT')).toEqual(NEW_YORK)
    // An empty name, or a bare colon, is UTC, and no file is read for it.
    for (const empty of ['', ':']) {
      expect(withTz(empty)).toEqual({
        before: 0,
        changes: [],
        rule: { standard: 0, daylight: null },
      })
      expect(disk.reads).toEqual([])
    }
    // A path is refused: absolute, or climbing out of the zone files. Nothing is read, and it is said once.
    for (const path of ['/usr/share/zoneinfo/Europe/Paris', '../../etc/localtime']) {
      expect(withTz(path)).toBeNull()
      expect(disk.reads).toEqual([])
      expect(warned()).toHaveLength(1)
      expect(warned()[0]).toMatch(/not a zone name/)
    }
    // A POSIX rule that names no zone file: nothing to read, said once.
    expect(withTz('CET-1CEST')).toBeNull()
    expect(warned()).toHaveLength(1)
    expect(warned()[0]).toMatch(/ENOENT/)

    // ⚑ Without a `TZ` the same harness reads the link (Santiago), so the branch above was the one taken.
    expect(withTz(undefined)).toEqual(SANTIAGO)
    expect(disk.reads).toEqual(['/etc/localtime'])
    expect(warned()).toEqual([])
  })

  it('a file this reader does not know whole is refused, not guessed', () => {
    const refusedFor = (bytes: Buffer): string[] => {
      warn.mockClear()
      disk.files.set('/etc/localtime', bytes)
      expect(launch().reader()).toBeNull()
      return warned()
    }
    const notAZoneFile = refusedFor(Buffer.from('hello'))
    expect(notAZoneFile).toHaveLength(1)
    expect(notAZoneFile[0]).toMatch(/not a zone file/)
    const version1 = refusedFor(
      tzif({ version: '\0', before: 3_600_000, changes: [], footer: 'CET-1CEST,M3.5.0,M10.5.0/3' }),
    )
    expect(version1).toHaveLength(1)
    expect(version1[0]).toMatch(/version other than 2 or 3/)
    const julian = refusedFor(
      tzif({ before: 3_600_000, changes: [], footer: 'CET-1CEST,J60,J300' }),
    )
    expect(julian).toHaveLength(1)
    expect(julian[0]).toMatch(/zone rule this app does not read/)

    // ⚑ The accepted Paris file parses in the same harness, and says nothing.
    warn.mockClear()
    disk.files.set('/etc/localtime', PARIS_FILE)
    expect(launch().reader()).toEqual(PARIS)
    expect(warned()).toEqual([])
  })

  it('a move of the link or of the data is told once, and a re-read of the same zone says nothing', () => {
    disk.files.set('/etc/localtime', PARIS_FILE)
    const { reader, moved } = launch()
    expect(reader()).toEqual(PARIS)
    expect(moved).not.toHaveBeenCalled()

    disk.files.set('/etc/localtime', SANTIAGO_FILE)
    // (a) A different name in the folder is not the link: nothing is read, nothing is told.
    const readsBefore = disk.reads.length
    reports('/etc', 'resolv.conf')
    expect(moved).not.toHaveBeenCalled()
    expect(disk.reads).toHaveLength(readsBefore)
    expect(reader()).toEqual(PARIS)
    // (b) The same watcher with the link's own name: told once, with the zone it moved to.
    reports('/etc', 'localtime')
    expect(moved).toHaveBeenCalledTimes(1)
    expect(moved).toHaveBeenLastCalledWith(SANTIAGO)
    expect(reader()).toEqual(SANTIAGO)
    // (c) A re-pointed link is reported more than once: still told once.
    reports('/etc', 'localtime')
    expect(moved).toHaveBeenCalledTimes(1)
    // (d) An update of the data that leaves the Mac's zone as it was: still once; one that moves it, twice.
    reports('/var/db/timezone', 'zoneinfo')
    expect(moved).toHaveBeenCalledTimes(1)
    disk.files.set('/etc/localtime', MOROCCO_FILE)
    reports('/var/db/timezone', 'zoneinfo')
    expect(moved).toHaveBeenCalledTimes(2)
    expect(moved).toHaveBeenLastCalledWith(MOROCCO)
    expect(reader()).toEqual(MOROCCO)
  })

  it('a zone that cannot be read is said once, and the one held is kept', () => {
    disk.files.set('/etc/localtime', Object.assign(new Error('EACCES'), { code: 'EACCES' }))
    const { reader, moved } = launch()
    expect(reader()).toBeNull()
    expect(warned()).toHaveLength(1)
    expect(warned()[0]).toMatch(
      /could not be read \(.*\), so times are said in this app's own zone data/,
    )
    expect(warned()[0]).toMatch(/^the system's time zone could not be read /)
    // Still failing: still one warning.
    reports('/etc', 'localtime')
    reports('/etc', 'localtime')
    expect(warned()).toHaveLength(1)
    expect(moved).not.toHaveBeenCalled()

    // A zone missed at launch is picked up.
    disk.files.set('/etc/localtime', PARIS_FILE)
    reports('/etc', 'localtime')
    expect(moved).toHaveBeenCalledTimes(1)
    expect(moved).toHaveBeenLastCalledWith(PARIS)
    expect(reader()).toEqual(PARIS)
    expect(warned()).toHaveLength(1)

    // …and one that stops being readable keeps the zone it read, and says so once.
    disk.files.set('/etc/localtime', Object.assign(new Error('EACCES'), { code: 'EACCES' }))
    reports('/etc', 'localtime')
    expect(reader()).toEqual(PARIS)
    expect(moved).toHaveBeenCalledTimes(1)
    expect(warned()).toHaveLength(2)
    expect(warned()[1]).toMatch(/could not be read again .* the zone it read before/)
    expect(warned()[1]).toMatch(/^the system's time zone could not be read again /)
    reports('/etc', 'localtime')
    expect(warned()).toHaveLength(2)
    // A success in between says nothing and tells nothing (the same zone), and resets the once.
    disk.files.set('/etc/localtime', PARIS_FILE)
    reports('/etc', 'localtime')
    expect(warned()).toHaveLength(2)
    expect(moved).toHaveBeenCalledTimes(1)
    disk.files.set('/etc/localtime', Object.assign(new Error('EACCES'), { code: 'EACCES' }))
    reports('/etc', 'localtime')
    expect(warned()).toHaveLength(3)

    // A watch that cannot start leaves the zone read and says so, for the link and for the data.
    warn.mockClear()
    disk.files.set('/etc/localtime', PARIS_FILE)
    disk.watched.length = 0
    disk.watchThrows = true
    expect(launch().reader()).toEqual(PARIS)
    expect(warned()).toHaveLength(2)
    expect(warned()[0]).toMatch(/time zone cannot be watched/)
    expect(warned()[1]).toMatch(/time-zone data cannot be watched/)
    expect(disk.watched).toEqual([])

    // A watch that fails is closed, and said once.
    warn.mockClear()
    disk.watchThrows = false
    launch()
    const failing = watcherOf('/etc')
    expect(failing.closed).toBe(false)
    for (const handler of failing.handlers.get('error') ?? []) handler(new Error('gone'))
    expect(failing.closed).toBe(true)
    expect(warned()).toHaveLength(1)
    expect(warned()[0]).toMatch(/no longer watched/)
    expect(watcherOf('/var/db/timezone').closed).toBe(false)
  })

  it('no watch holds the process open, and none is on the link when TZ is set', () => {
    disk.files.set('/etc/localtime', PARIS_FILE)
    disk.files.set('/usr/share/zoneinfo/Europe/Paris', PARIS_FILE)
    launch()
    expect(disk.watched.map((one) => one.dir)).toEqual(['/etc', '/var/db/timezone'])
    for (const one of disk.watched) expect(one.options).toEqual({ persistent: false })

    disk.watched.length = 0
    process.env.TZ = 'Europe/Paris'
    launch()
    expect(disk.watched.map((one) => one.dir)).toEqual(['/var/db/timezone'])
    for (const one of disk.watched) expect(one.options).toEqual({ persistent: false })
  })
})

// ─── §5 · the wiring ───────────────────────────────────────────────────────────────────────────

describe('§5 · the window, main and the host agree on the zone', () => {
  afterEach(() => {
    vi.resetModules()
  })

  /** A bridge with the two doors, held open so a test chooses when each answers. */
  const aBridge = (): {
    calls: string[]
    moveTo: (zone: LocalZone) => void
    answerWith: (zone: LocalZone | null) => void
    bridge: {
      onLocalZone: (listener: (zone: LocalZone) => void) => () => void
      localZone: () => Promise<LocalZone | null>
    }
  } => {
    const calls: string[] = []
    let listener: (zone: LocalZone) => void = () => {}
    let answer: (zone: LocalZone | null) => void = () => {}
    return {
      calls,
      moveTo: (zone) => listener(zone),
      answerWith: (zone) => answer(zone),
      bridge: {
        onLocalZone: (heard) => {
          calls.push('subscribe')
          listener = heard
          return () => {}
        },
        localZone: () => {
          calls.push('ask')
          return new Promise((resolve) => {
            answer = resolve
          })
        },
      },
    }
  }

  /** A fresh module graph: the window's zone is a module-level ref, so one would carry a zone between tests. */
  const freshGraph = async (): Promise<{
    localTime: typeof import('../src/shared/local-time')
    clock: typeof import('../src/shared/clock')
    keepTheMacZone: (bridge: unknown) => Promise<void>
    computed: typeof import('vue').computed
  }> => {
    vi.resetModules()
    const localTime = await import('../src/shared/local-time')
    const clock = await import('../src/shared/clock')
    const { keepTheMacZone } = await moduleOf('renderer/src/lib/local-zone.ts')
    const { computed } = await import('vue')
    return {
      localTime,
      clock,
      keepTheMacZone: keepTheMacZone as (bridge: unknown) => Promise<void>,
      computed,
    }
  }

  it('the window subscribes before it asks, the answer supersedes an earlier move, and a later move redraws what drew a time', async () => {
    const { localTime, clock, keepTheMacZone, computed } = await freshGraph()
    const { calls, moveTo, answerWith, bridge } = aBridge()
    const at = Date.UTC(2026, 9, 1, 12, 0)
    const wall = (): [number, number] => {
      const fields = localTime.localFields(at)
      return [fields.hours, fields.minutes]
    }

    const done = keepTheMacZone(bridge)
    expect(calls).toEqual(['subscribe', 'ask'])
    // A move sent BEFORE the answer is superseded by it: one ordered pipe.
    moveTo(Z_NL)
    answerWith(Z_NP)
    await done
    expect(wall()).toEqual([17, 45])
    // …and one sent after arrives after it.
    moveTo(Z_NL)
    expect(wall()).toEqual([8, 30])

    // ⚑ Reactive: whatever drew a time read the zone, so a move redraws it (a plain variable would
    // leave the computed stale).
    moveTo(Z_NP)
    const shown = computed(() => clock.clockTime(at))
    const first = shown.value
    expect(first).toBe(said(CLOCK, at, 20_700_000))
    moveTo(Z_UTC)
    expect(shown.value).toBe(said(CLOCK, at, 0))
    expect(shown.value).not.toBe(first)
  })

  it('no bridge, a bridge without the doors or a refused ask leaves the runtime own zone, and never throws', async () => {
    const at = Date.UTC(2026, 9, 1, 12, 0)
    const bridges: [string, unknown][] = [
      ['no bridge', undefined],
      // A preload built before the doors: no `onLocalZone`, so a TypeError inside the try.
      ['a bridge without the doors', { localZone: () => Promise.resolve(null) }],
      [
        'a refused ask',
        { onLocalZone: () => () => {}, localZone: () => Promise.reject(new Error('refused')) },
      ],
      [
        'main could not read it',
        { onLocalZone: () => () => {}, localZone: () => Promise.resolve(null) },
      ],
    ]
    for (const [name, bridge] of bridges) {
      const { localTime, keepTheMacZone } = await freshGraph()
      await expect(keepTheMacZone(bridge), name).resolves.toBeUndefined()
      const own = new Date(at)
      const fields = localTime.localFields(at)
      expect([fields.hours, fields.minutes], name).toEqual([own.getHours(), own.getMinutes()])
    }

    // ⚑ The paired positive: a bridge that answers a zone is said in it — so the four above are
    // shown to differ from a zone that was handed.
    const { localTime, keepTheMacZone } = await freshGraph()
    await keepTheMacZone({ onLocalZone: () => () => {}, localZone: () => Promise.resolve(Z_NP) })
    const fields = localTime.localFields(at)
    expect([fields.hours, fields.minutes]).toEqual([17, 45])
  })

  it('main reads the zone before it says a time, tells every window of a move and places the wake-ups again', () => {
    const main = sourceOf('main/index.ts')
    const PREDICATES: Record<string, RegExp> = {
      // The read is before the host is built and before any window, every window is told with each
      // send guarded, and the wake-ups are placed again.
      'the zone is read first and every window is told': inOrder(
        'const localZone = keepTheSystemZone((moved) => {',
        'for (const window of BrowserWindow.getAllWindows()) {',
        'try {',
        'if (!window.isDestroyed() && !window.webContents.isDestroyed()) {',
        'window.webContents.send(LOCAL_ZONE_MOVED_CHANNEL, moved)',
        ANYTHING,
        'host?.placeTheWakeUpsAgain()',
        '})',
        'readLocalTimeFrom(localZone)',
        'themes = new ThemeStore({',
        ANYTHING,
        'await themes.start()',
        'stopThemeIpc = registerThemeIpc(ipcMain, themes, (change) => {',
        ANYTHING,
        'host = createRuntimeHost(initDatabase())',
        'registerIpc(host, localZone)',
      ),
      'the window asks main for it': inOrder("ipcMain.handle('app:local-zone', () => localZone())"),
      'the doors are handed it': inOrder(
        'function registerIpc(runtimeHost: RuntimeHost, localZone: () => LocalZone | null)',
      ),
    }
    const failing = (source: string): string[] =>
      Object.entries(PREDICATES)
        .filter(([, predicate]) => !predicate.test(source))
        .map(([name]) => name)

    expect(failing(main)).toEqual([])
    // Standing rule 12: each way of breaking it fails the predicate it breaks, and only that.
    const first = 'the zone is read first and every window is told'
    expect(failing(planted(main, 'host?.placeTheWakeUpsAgain()', ''))).toEqual([first])
    expect(
      failing(
        planted(
          planted(main, 'readLocalTimeFrom(localZone)\n', ''),
          'registerIpc(host, localZone)',
          'readLocalTimeFrom(localZone)\n      registerIpc(host, localZone)',
        ),
      ),
    ).toEqual([first])
    expect(
      failing(
        planted(
          main,
          "ipcMain.handle('app:local-zone', () => localZone())",
          "ipcMain.handle('app:local-zone', () => null)",
        ),
      ),
    ).toEqual(['the window asks main for it'])
    // The guard on the send, dropped: the one before the send is this one's, never `announce`'s.
    const send = main.indexOf('window.webContents.send(LOCAL_ZONE_MOVED_CHANNEL, moved)')
    expect(send).toBeGreaterThan(-1)
    const guard = 'if (!window.isDestroyed() && !window.webContents.isDestroyed()) {'
    const guardAt = main.lastIndexOf(guard, send)
    expect(guardAt).toBeGreaterThan(-1)
    expect(send - guardAt, 'the guard is the line before the send').toBeLessThan(120)
    expect(
      failing(main.slice(0, guardAt) + 'if (true) {' + main.slice(guardAt + guard.length)),
    ).toEqual([first])
  })

  it('the preload knocks on the same doors by the same names, and the screen mounts after the zone is known', () => {
    expect(LOCAL_ZONE_MOVED_CHANNEL).toBe('app:local-zone-moved')
    const preload = sourceOf('preload/index.ts')
    const main = sourceOf('main/index.ts')
    const screen = sourceOf('renderer/src/main.ts')
    const PRELOAD: Record<string, RegExp> = {
      'it asks for the zone': inOrder(
        'localZone: (): Promise<LocalZone | null> =>',
        "ipcRenderer.invoke('app:local-zone')",
      ),
      'it subscribes on the moved channel': inOrder(
        'ipcRenderer.on(LOCAL_ZONE_MOVED_CHANNEL, forward)',
      ),
      'it unsubscribes from it': inOrder('ipcRenderer.off(LOCAL_ZONE_MOVED_CHANNEL, forward)'),
    }
    // The workspace's theme is waited for beside the zone, never instead of it.
    const MOUNT = inOrder(
      'void Promise.all([keepTheMacZone(window.api), themeBeforeDrawing(windowTheme)]).then(() =>',
      'savedDraftsBeforeDrawing(window.api?.savedDrafts).then((saved) => {',
      "createApp(App).provide(SAVED_DRAFTS, handOver(saved)).mount('#app')",
    )
    const failing = (source: string): string[] =>
      Object.entries(PRELOAD)
        .filter(([, predicate]) => !predicate.test(source))
        .map(([name]) => name)

    expect(failing(preload)).toEqual([])
    expect(MOUNT.test(screen)).toBe(true)
    // The two files agree on the door's name.
    const asked = /localZone: \(\)[^=]*=>\s*ipcRenderer\.invoke\('([^']+)'\)/.exec(preload)?.[1]
    const handled = /ipcMain\.handle\('([^']+)', \(\) => localZone\(\)\)/.exec(main)?.[1]
    expect(asked).toBe('app:local-zone')
    expect(handled).toBe(asked)

    // Standing rule 12: planted copies fail the predicate the real file passes.
    expect(
      failing(
        planted(preload, "ipcRenderer.invoke('app:local-zone')", "ipcRenderer.invoke('app:zone')"),
      ),
    ).toEqual(['it asks for the zone'])
    expect(
      failing(
        planted(
          preload,
          'ipcRenderer.on(LOCAL_ZONE_MOVED_CHANNEL, forward)',
          'ipcRenderer.on(SOME_OTHER_CHANNEL, forward)',
        ),
      ),
    ).toEqual(['it subscribes on the moved channel'])
    expect(
      MOUNT.test(
        planted(
          screen,
          'void Promise.all([keepTheMacZone(window.api), themeBeforeDrawing(windowTheme)]).then(() =>',
          'void Promise.all([keepTheMacZone(window.api), themeBeforeDrawing(windowTheme)])\n;(() =>',
        ),
      ),
    ).toBe(false)
  })
})

// ─── The host half ─────────────────────────────────────────────────────────────────────────────

class RecordingSink implements RuntimeEventSink {
  readonly aPersonIsBehindIt = true
  readonly messages: RuntimeEventMessage[] = []
  alive = true
  constructor(readonly ownerId: string) {}
  send(message: RuntimeEventMessage): void {
    this.messages.push(message)
  }
  sendLiveness(): void {}
}

class ProviderDouble extends FakeRuntime {
  constructor(
    provider: Provider,
    private readonly handles: FakeSessionHandle[],
    sessions: FakeProviderSessions,
  ) {
    super(provider, { sessions })
  }
  override async start(options: StartOptions): Promise<FakeSessionHandle> {
    const handle = await super.start(options)
    this.handles.push(handle)
    return handle
  }
  override async resume(ref: SessionRef, options: ResumeOptions): Promise<FakeSessionHandle> {
    const handle = await super.resume(ref, options)
    this.handles.push(handle)
    return handle
  }
}

async function waitFor(predicate: () => boolean, what: string): Promise<void> {
  for (let attempt = 0; attempt < 400; attempt++) {
    if (predicate()) return
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
  throw new Error(`timed out waiting for ${what}`)
}

/** A stretch of the event loop long enough for everything a provider row starts to have run. */
async function settle(): Promise<void> {
  for (let round = 0; round < 2; round++) {
    for (let turn = 0; turn < 5; turn++) await new Promise((resolve) => setImmediate(resolve))
    await new Promise((resolve) => setTimeout(resolve, 30))
  }
}

describe('§6 · the host puts a job’s time in the zone the Mac moved to', () => {
  let userData: string
  let root: string
  let db: AppDatabase
  let store: SessionStore
  let host: RuntimeHost
  let hosts: RuntimeHost[]
  let handles: FakeSessionHandle[]
  let issued: FakeProviderSessions
  let counter: number
  let clock: number
  let window: RecordingSink
  /** Every message the host pushed on `runtime:states`, in order. */
  let pushed: RuntimeStatesMessage[]
  /** The zone the Mac is in: what the host's calendar and every clock read are made from. */
  let zone: LocalZone
  const moveTo = (to: LocalZone): void => {
    zone = to
    readLocalTimeFrom(() => zone)
  }
  const tick = (): number => clock++

  const buildHost = (): RuntimeHost => {
    const built = new RuntimeHost({
      store,
      discoverSessions: NO_DISCOVERY,
      nativeTranscriptPath: () => null,
      exportDirectory: () => join(userData, 'exports'),
      resourcesRoot: () => resourcesRoot(userData),
      createRuntime: (provider: Provider) => new ProviderDouble(provider, handles, issued),
      prepareProviderHome: (provider: Provider, profileId?: string) => {
        const home = join(userData, 'provider-homes', profileId ?? 'default', provider)
        mkdirSync(home, { recursive: true })
        return home
      },
      providerHomePath: (provider: Provider) => join(userData, 'provider-homes', provider),
      resolveCwd: (sessionId, requested) => resolveSessionCwd(userData, sessionId, requested),
      newSessionId: () => `sess_${++counter}`,
      now: tick,
      interruptWaitMs: 40,
      readProviderConfig: (provider, home) => ({
        home,
        homeEnv: 'CLAUDE_CONFIG_DIR',
        model: 'm',
        authNote: null,
        files: [],
      }),
      // ⚑ **The dep that makes a host push, and start a stopped conversation for its job** — a host
      // nobody listens to arms no wake-up.
      statesMoved: (message) => {
        pushed.push(message)
      },
    })
    hosts.push(built)
    return built
  }

  beforeEach(() => {
    userData = mkdtempSync(join(tmpdir(), 'brobot2-macclock-'))
    root = mkdtempSync(join(tmpdir(), 'brobot2-macclock-root-'))
    db = openDatabase(join(userData, 'brobot2.sqlite'))
    applyMigrations(db, migrationsFolder)
    // 1970-01-01 02:30 UTC: ahead of a 03:00 UTC job, and 08:15 in a +5:45 zone.
    clock = 9_000_000
    store = createSessionStore(db, tick)
    counter = 0
    hosts = []
    handles = []
    pushed = []
    issued = new FakeProviderSessions()
    host = buildHost()
    window = new RecordingSink('webContents:1')
  })

  afterEach(async () => {
    readLocalTimeFrom(() => null)
    for (const built of hosts) await built.closeAll()
    db.close()
    for (const dir of [userData, root]) rmSync(dir, { recursive: true, force: true })
  })

  const opens = async (profileId: string): Promise<string> => {
    const { sessionId } = await host.createSession(
      { provider: 'claude', profileId, approvalMode: 'ask', cwd: root },
      window,
    )
    return sessionId
  }
  const handleOf = (nth: number): FakeSessionHandle => {
    const handle = handles[nth]
    if (handle === undefined) throw new Error(`no provider handle ${String(nth)} has been issued`)
    return handle
  }
  const pushedFor = (id: string): { conversation: string; state: AgentState }[] =>
    pushed.flatMap((message) => message.moved).filter((one) => one.conversation === id)
  const lastPushed = (id: string): AgentState | undefined => pushedFor(id).at(-1)?.state
  /** Whether a conversation's last pushed word is *scheduled* for that moment. */
  const isScheduledFor = (id: string, dueAt: number): boolean => {
    const state = lastPushed(id)
    return state?.is === 'scheduled' && state.dueAt === dueAt
  }
  /** ⚠️ The private map of wake-ups, read as a-race-seen-after-the-disk-read reads `arrivals`. */
  const wakeUpsOf = (): Map<string, { startAt: number; failed: number }> =>
    (host as unknown as { wakeUps: Map<string, { startAt: number; failed: number }> }).wakeUps
  const DAILY = {
    id: 'job_daily',
    schedule: '0 3 * * *',
    recurring: true,
    prompt: 'check the build',
  }
  /** The provider makes the daily job, as its tool hooks report it, and lists it at the turn's end. */
  const schedulesTheDailyJob = (handle: FakeSessionHandle): void => {
    handle.simulateScheduledWork({
      jobs: undefined,
      receipt: {
        tool: 'CronCreate',
        toolUseId: 'toolu_daily',
        calledAt: clock,
        answeredAt: clock + 2,
        input: { cron: DAILY.schedule, recurring: true },
        result: { id: DAILY.id, recurring: true },
      },
    })
    handle.simulateScheduledWork({ jobs: [DAILY] })
  }

  it('a running conversation holding a job is told the new zone time when the zone moves', async () => {
    moveTo(Z_UTC)
    const a = await opens('agent-a')
    const b = await opens('agent-b')
    await settle()

    schedulesTheDailyJob(handleOf(0))
    await waitFor(
      () => lastPushed(a)?.is === 'scheduled' && isScheduledFor(a, 10_800_000),
      'the job to be pushed as scheduled',
    )
    expect(lastPushed(a)).toEqual({ is: 'scheduled', dueAt: 10_800_000 })

    // The zone moves, and nothing marks a state on its own: nothing is pushed…
    const aBefore = pushedFor(a).length
    const bBefore = pushedFor(b).length
    moveTo(Z_NP)
    await settle()
    expect(pushedFor(a)).toHaveLength(aBefore)

    // …until main places the wake-ups again, which reads the job of the conversation that holds one
    // on the new calendar: 03:00 at +5:45 is 21:15 UTC.
    host.placeTheWakeUpsAgain()
    await waitFor(
      () => lastPushed(a)?.is === 'scheduled' && pushedFor(a).length > aBefore,
      'the new time',
    )
    expect(lastPushed(a)).toEqual({ is: 'scheduled', dueAt: 76_500_000 })
    await settle()
    // The one that holds no job is not named.
    expect(pushedFor(b)).toHaveLength(bBefore)
  })

  it('a stopped conversation is woken just before its job, and at once when the zone moves under it', async () => {
    moveTo(Z_UTC)
    const a = await opens('agent-a')
    await settle()
    schedulesTheDailyJob(handleOf(0))
    await waitFor(() => isScheduledFor(a, 10_800_000), 'the job to be pushed as scheduled')

    // The premise first, so a harness that arms nothing fails loudly: the stop arms the wake-up,
    // half a minute before the job's own minute.
    await host.close(a, window)
    await waitFor(() => wakeUpsOf().has(a), 'the stop to arm the conversation’s wake-up')
    const armed = wakeUpsOf().get(a)
    expect(armed?.startAt).toBe(10_800_000 - 30_000)

    // The zone moves: the job was placed on the calendar before, so one start is asked for now, to
    // let its provider place it again — and the time its state says is the new zone's.
    moveTo(Z_NP)
    host.placeTheWakeUpsAgain()
    const placed = wakeUpsOf().get(a)
    expect(placed).toBeDefined()
    expect(placed).not.toBe(armed)
    expect(placed!.startAt).toBeLessThanOrEqual(clock)
    await waitFor(() => isScheduledFor(a, 76_500_000), 'the stopped conversation’s new time')

    // A start already owed is not planned again: it plans its jobs when it begins.
    host.placeTheWakeUpsAgain()
    expect([undefined, placed]).toContain(wakeUpsOf().get(a))
  })
})
