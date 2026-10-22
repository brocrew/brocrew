import {
  existsSync,
  lstatSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

import {
  GATE_SOCKET,
  KEPT_MARK,
  SUN_PATH_MAX,
  beginSmokeRun,
  smokeTmpRoot,
  smokeUserDataDir,
} from '../lib/smoke-run.mjs'

/**
 * 188 §2, from 182 M7 — the run-scoping and the lock the live smokes share.
 *
 * ⚠️ **The module is what is tested, not the smokes.** `ui-live-smoke.mjs` exercises it live on
 * every run (188 ran a full pass); this is what covers the branches a passing smoke never takes —
 * a lock already held, a prune that has something to drop, and the ordering the run id promises.
 */
const roots = []

/**
 * ⚠️ **These names are cryptic on purpose, and that is TWO findings rather than a style choice**
 * (242 §1).
 *
 * **Short**, because `beginSmokeRun` now refuses a run whose gate socket would not fit `sun_path`,
 * and it refused this file's own roots: `<os.tmpdir()>/brobot2-smoke-run-test-XXXXXX/evidence/
 * <run id>/user-data/one-host.sock` came to **142 bytes** against a limit of 103. ⛔ **The rule
 * caught its first caller inside the commit that introduced it**, which is the argument for making
 * it unconditional — the budget is small enough that ordinary, readable naming spends all of it
 * without anyone noticing.
 *
 * **And this file's OWN, never a shared one** (found by an adversarial pass over this diff).
 *
 * 🔴 The first version took `smokeTmpRoot('b2t')` — the same base `host-gate-witness.test.mjs` uses —
 * and the ownership test below pushed that PARENT onto `roots`, where `afterEach` `rm -rf`s it. Both
 * files are in the `scripts` project and vitest runs them in parallel forks, so this file's teardown
 * could delete the directories the other file was binding live UNIX sockets in. ⚠️ **Reproduced: a
 * sentinel planted under `/private/tmp/b2t` was gone after one run of this file alone**, and racing
 * the wipe against the witness suite fails all 6 of its tests with `ENOENT`.
 *
 * ⚑ **This is 241 §7's rule one directory over** — a test that deletes a tree it does not own — and
 * the fix is the same shape: own your own name, and only ever remove what you made under it.
 */
const BASE = 'b2t-run'

function makeRoots() {
  const base = mkdtempSync(join(smokeTmpRoot(BASE), 'r'))
  roots.push(base)
  return { evidenceRoot: join(base, 'e'), scratchRoot: join(base, 's') }
}

/** A fixed clock, so run ids are chosen rather than raced. */
function at(iso) {
  return () => new Date(iso)
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

describe('a smoke run owns a directory of its own', () => {
  it('creates both roots under one run id and reports where they are', () => {
    const { evidenceRoot, scratchRoot } = makeRoots()
    const run = beginSmokeRun({
      evidenceRoot,
      scratchRoot,
      now: at('2026-08-19T10:20:30.400Z'),
      pid: 4242,
    })

    expect(run.runId).toBe('2026-08-19T10-20-30-400Z-4242')
    expect(run.evidence).toBe(join(evidenceRoot, run.runId))
    expect(run.scratch).toBe(join(scratchRoot, run.runId))
    expect(existsSync(run.evidence)).toBe(true)
    expect(existsSync(run.scratch)).toBe(true)
    run.release()
  })

  it('points `latest` at this run, so one stable path still opens something', () => {
    const { evidenceRoot, scratchRoot } = makeRoots()
    const run = beginSmokeRun({ evidenceRoot, scratchRoot, now: at('2026-08-19T01:00:00.000Z') })
    const latest = join(evidenceRoot, 'latest')

    expect(lstatSync(latest).isSymbolicLink()).toBe(true)
    expect(readdirSync(latest)).toEqual([]) // it resolves to this run's (empty) directory
    run.release()

    const next = beginSmokeRun({ evidenceRoot, scratchRoot, now: at('2026-08-19T02:00:00.000Z') })
    // ⚑ The paired positive for the prune test below: `latest` MOVES, and is never itself a run.
    expect(lstatSync(latest).isSymbolicLink()).toBe(true)
    expect(readdirSync(evidenceRoot).filter((name) => name === next.runId)).toHaveLength(1)
    next.release()
  })
})

describe('only one run at a time', () => {
  it('refuses a second run while the first holds the lock, and names the owner', () => {
    const { evidenceRoot, scratchRoot } = makeRoots()
    const first = beginSmokeRun({ evidenceRoot, scratchRoot, pid: 111 })

    expect(() => beginSmokeRun({ evidenceRoot, scratchRoot, pid: 222 })).toThrow(
      /another smoke run owns .*pid 111/s,
    )
    // ⛔ …and the refused run created NOTHING: a second tree beside the first is the failure this
    // whole lock exists to prevent, and "it threw" would not have proved that on its own.
    expect(readdirSync(evidenceRoot).filter((name) => name.endsWith('-222'))).toEqual([])

    first.release()
    // The paired positive: once released, the next run starts normally.
    const second = beginSmokeRun({ evidenceRoot, scratchRoot, pid: 222 })
    expect(existsSync(second.evidence)).toBe(true)
    second.release()
  })

  it('leaves the owner readable while held, rather than an empty marker', () => {
    const { evidenceRoot, scratchRoot } = makeRoots()
    const run = beginSmokeRun({ evidenceRoot, scratchRoot, pid: 909 })

    const owner = readFileSync(join(evidenceRoot, '.lock', 'owner'), 'utf8')
    expect(owner).toContain('pid 909')
    expect(owner).toContain(run.runId)
    run.release()
    expect(existsSync(join(evidenceRoot, '.lock'))).toBe(false)
  })
})

/**
 * 🔴 **242 §1 — the environment that switched a shipped feature off.**
 *
 * ⛔ **The measurement, and it is the whole dispatch**: `236` §3's one-host gate binds
 * `<userData>/one-host.sock`, macOS copies that name into a 104-byte `sun_path`, and every live
 * instrument in this repository put its `--user-data-dir` under `os.tmpdir()` — 48 bytes of
 * `/var/folders/…/T` before the run id is even reached. ⚠️ **So `bind` failed `EINVAL`, the gate
 * answered `unknown` at ~4 ms, and the smokes have been green over a feature that could not
 * execute since the day it shipped.**
 *
 * ⚑ **Both halves are asserted here** — the shape that fits and the shape that did not — because a
 * budget test with only the passing half proves the arithmetic and not the finding.
 */
describe('242 · the gate socket has to FIT, and the root is what decides', () => {
  const RUN = '2026-08-19T10-20-30-400Z-4242'
  const LONGEST = 'user-data-sole-instance'

  it('🔴 the OLD root could not hold a socket, and the NEW one can', (ctx) => {
    // ⚠️ **darwin only** (T-001): its premise is the Mac's long `tmpdir()` against a 104-byte socket path.
    // CI runs on Linux and skips it; the Mac's own gate runs it.
    ctx.skip(process.platform !== 'darwin')
    // ⛔ **Computed, never created** (241 §7 — a test that built this path once deleted a real
    // instrument's evidence tree). These are strings and the filesystem is not touched.
    const wasAt = join(tmpdir(), 'brobot2-ui-smoke', RUN, LONGEST, GATE_SOCKET)
    expect(
      wasAt.length,
      'this machine’s tmpdir is short enough that the smokes were NOT masked — re-derive 241 §3',
    ).toBeGreaterThanOrEqual(SUN_PATH_MAX)

    // …and the paired positive, on the root the smokes use now — ⚠️ **built from `dirname` rather
    // than by asking for `brobot2-ui-smoke`**, because `smokeTmpRoot` CREATES and `chmod`s what it
    // is given, and a test may not touch a live instrument's evidence root (241 §7).
    const base = dirname(smokeTmpRoot(BASE))
    const nowAt = join(base, 'brobot2-ui-smoke', RUN, LONGEST, GATE_SOCKET)
    expect(nowAt.length).toBeLessThan(SUN_PATH_MAX)
    // ⛔ …and how little is left, stated: the tightest of the three smokes has 5 bytes spare on this
    // machine, which is why the budget is CHECKED rather than reasoned about.
    expect(SUN_PATH_MAX - 1 - nowAt.length).toBeLessThan(10)
  })

  it('⛔ is a per-user directory we own, not a shared one anybody can plant in', () => {
    // ⚠️ **A name nothing else uses**, because this is the one assertion that has to be made about a
    // ROOT rather than a child — and `afterEach` removes what it is given.
    const root = smokeTmpRoot('b2t-own')
    roots.push(root)
    const seen = lstatSync(root)
    expect(seen.isDirectory()).toBe(true)
    expect(seen.isSymbolicLink()).toBe(false)
    // Windows has no POSIX uid or mode bits; the root still has to exist as a real directory.
    if (process.platform === 'win32') return
    // `/tmp` is world-writable (1777) where `os.tmpdir()` was not, and a smoke's evidence tree holds
    // copied provider auth — so the root the move landed on is narrowed rather than inherited.
    expect(seen.uid).toBe(process.getuid())
    expect(seen.mode & 0o777).toBe(0o700)
  })

  it('⛔ refuses a name whose socket would not fit, and names both numbers', () => {
    const evidence = join('/private/tmp/brobot2-ui-smoke', RUN)
    expect(() => smokeUserDataDir(evidence, 'user-data', 'darwin')).not.toThrow()
    expect(() => smokeUserDataDir(evidence, `user-data-${'x'.repeat(60)}`, 'darwin')).toThrow(
      /is \d+ bytes and sun_path holds 103/,
    )
  })

  it('⚑ on Windows the gate is a named pipe, so a long evidence root is no refusal', () => {
    // A GitHub Windows runner's `%TEMP%` and a run id: the socket's path would be 109 bytes.
    const evidence = join('C:\\Users\\RUNNER~1\\AppData\\Local\\Temp\\brobot2-probe-runs', RUN)
    expect(smokeUserDataDir(evidence, 'user-data', 'win32')).toBe(join(evidence, 'user-data'))
    // …and the same root still refused anywhere a socket is a path.
    expect(() => smokeUserDataDir(evidence, 'user-data', 'darwin')).toThrow(/sun_path holds 103/)
    expect(() => smokeUserDataDir(evidence, 'user-data', 'linux')).toThrow(/sun_path holds 103/)
  })

  /**
   * ⛔ **The three instruments, pinned to the two halves of the repair** (242 §1).
   *
   * ⚠️ **A source grep, and it is the right shape here.** Both halves are things a smoke has to DO
   * at launch, and neither can be observed from a unit test that does not launch an app: an
   * evidence root built with `join(tmpdir(), …)` again, or a `launchApp` that stops witnessing,
   * would put every one of these scripts back to reporting green over a feature that cannot run —
   * with nothing failing to say so, which is the entire content of 241 §3.
   */
  it('🔴 all three live smokes take the short root AND witness the gate', () => {
    for (const name of ['ui-live-smoke.mjs', 'resume-live-smoke.mjs', 'packaged-smoke.mjs']) {
      const source = readFileSync(join(import.meta.dirname, '..', name), 'utf8')
      expect(source, `${name} builds its evidence root itself`).toContain('smokeTmpRoot(')
      expect(source, `${name} still roots its evidence in os.tmpdir()`).not.toMatch(
        /evidenceRoot: join\(tmpdir\(\)/,
      )
      expect(source, `${name} does not budget its userData`).toContain('smokeUserDataDir(')
      expect(source, `${name} never asks whether the gate engaged`).toContain('await witnessGate(')
    }
  })

  /**
   * 🔴 **The host's own alarm has somewhere to land, and something reads it** (345 §3, from 342).
   *
   * ## ⛔ A guard nothing could hear
   *
   * `runtime-host.ts`'s `emit` compares every ordinal against the highest it has already sent and
   * reports a regression — F6's only tripwire for an event published from inside another event's
   * window. It reports on a bare `console.error` in the MAIN process, and ⛔ **every live smoke
   * spawned the app with stdout and stderr discarded**, so the line has never been observable by a
   * live run at all. `342` reported a clean negative for event ordering and said of it: *"the
   * instrument could not have written one."*
   *
   * ⚠️ **CDP is not the missing piece.** It attaches to the RENDERER target; this line is written
   * in the main process, which is on no CDP target.
   *
   * ## ⚠️ Two of three, and saying which
   *
   * `ui-live-smoke.mjs` and `resume-live-smoke.mjs` now write the app's output to a file in their
   * own evidence tree and sweep it. ⛔ **`packaged-smoke.mjs` is NOT fixed here**: it already pipes
   * and accumulates the app's stderr into `output` and no step has ever read it, which is a
   * different repair and is named rather than absorbed.
   */
  describe("the app's output has somewhere to land (345)", () => {
    const smoke = (name) => readFileSync(join(import.meta.dirname, '..', name), 'utf8')

    /**
     * ⛔ **Windowed on the APP's own spawn, not on the file.** Both smokes spawn other things with
     * their output discarded and are right to — `caffeinate`, and a diagnostic shell that redirects
     * to its own path — so a whole-file `stdio: 'ignore'` grep fails two correct lines. The first
     * draft of this test did exactly that. `owned-process.test.mjs`'s `indexOf` windowing is the
     * house answer.
     */
    const appSpawnIn = (name) => {
      const source = smoke(name)
      const at = source.indexOf("'electron-vite',")
      expect(
        at,
        `${name} no longer spawns electron-vite — this window reads nothing`,
      ).toBeGreaterThan(0)
      return source.slice(at, source.indexOf('detached: true', at))
    }

    it.each(['ui-live-smoke.mjs', 'resume-live-smoke.mjs'])(
      '⛔ %s does not throw the app’s stdout and stderr away',
      (name) => {
        const spawnBlock = appSpawnIn(name)
        expect(spawnBlock, `${name} declares no stdio at all in its app spawn`).toContain('stdio:')
        expect(spawnBlock, `${name} still spawns the app with all output ignored`).not.toMatch(
          /stdio: (\['ignore', 'ignore', 'ignore'|'ignore')/,
        )
        // ⚠️ By the CALL rather than by a variable's name: `APP_LOG` and `logPath` are the two
        // spellings in the tree and a `[Ll]og` pattern would read only one of them.
        expect(smoke(name), `${name} opens no file for the app to write to`).toContain('openSync(')
      },
    )

    it.each(['ui-live-smoke.mjs', 'resume-live-smoke.mjs'])(
      '⛔ %s reads what it captured, rather than only capturing it',
      (name) => {
        expect(smoke(name), `${name} never looks for an out-of-order publish`).toContain(
          'went out after',
        )
        // ⛔ **And says how much it read.** *"0 out-of-order publishes"* is what a healthy run
        // reports AND what a run whose log was empty reports; the byte count is the only thing
        // that separates them, which is the same pairing 342 says every clean negative needs.
        expect(smoke(name), `${name} sweeps without saying how much it swept`).toContain(
          'B of host log swept',
        )
      },
    )

    /**
     * ⛔ **The grep is bound to the product's own words, or it is a control that matches nothing.**
     * This is the `DEGRADED_LABEL_PREFIX` shape `step-census.test.mjs` records: a hand-typed
     * sentence in an instrument, pinned to the source it was copied from, so a rewording there fails
     * `ci` instead of silently turning both sweeps into permanent all-clears.
     */
    it('🔴 the sentence both sweeps look for is still the sentence the host writes', () => {
      const host = readFileSync(
        join(import.meta.dirname, '../../apps/desktop/src/main/runtime/runtime-host.ts'),
        'utf8',
      )
      expect(
        host,
        'the out-of-order tripwire no longer says "went out after" — both live sweeps are now matching nothing',
      ).toContain('went out after')
    })

    /** ⚠️ Named, not fixed: the one that captures and never reads. */
    it('⚠️ packaged-smoke still accumulates the app’s output without reading it', () => {
      const source = smoke('packaged-smoke.mjs')
      expect(source).toContain('child.stderr?.on(')
      expect(
        source,
        'packaged-smoke started sweeping — update this test and 345’s response',
      ).not.toContain('went out after')
    })
  })

  // Windows uses named pipes and has no Unix socket path limit.
  it.skipIf(process.platform === 'win32')(
    '🔴 a RUN whose gate could not fit does not start — before the lock, before any mkdir',
    () => {
      const { evidenceRoot, scratchRoot } = makeRoots()
      expect(() =>
        beginSmokeRun({
          evidenceRoot,
          scratchRoot,
          pid: 4242,
          now: at('2026-08-19T10:20:30.400Z'),
          longestUserData: `user-data-${'x'.repeat(120)}`,
        }),
      ).toThrow(/one-host gate would fail open/)
      // ⛔ **Nothing was created and no lock was taken**, which is the half that makes this safe to
      // put in front of every run: a refused start must not strand the next one.
      expect(existsSync(join(evidenceRoot, '.lock'))).toBe(false)
      expect(existsSync(join(evidenceRoot, RUN))).toBe(false)

      // …and the paired positive: the same run with a declaration that fits starts normally.
      const run = beginSmokeRun({
        evidenceRoot,
        scratchRoot,
        pid: 4242,
        now: at('2026-08-19T10:20:30.400Z'),
        longestUserData: 'user-data',
      })
      expect(existsSync(run.evidence)).toBe(true)
      run.release()
    },
  )
})

describe('provenance is kept for a while, not forever', () => {
  it('keeps the newest runs and drops the oldest from BOTH roots', () => {
    const { evidenceRoot, scratchRoot } = makeRoots()
    const made = []
    for (let hour = 1; hour <= 5; hour++) {
      const run = beginSmokeRun({
        evidenceRoot,
        scratchRoot,
        keep: 3,
        now: at(`2026-08-19T0${hour}:00:00.000Z`),
        pid: 1000 + hour,
      })
      made.push(run)
      run.release()
    }

    const kept = readdirSync(evidenceRoot).filter((name) => name !== 'latest')
    expect(kept).toHaveLength(3)
    // The three newest, by the timestamp the run id starts with.
    expect(kept.sort()).toEqual(made.slice(2).map((run) => run.runId))
    // ⛔ The scratch root is pruned WITH it: a dropped run must not leave half its evidence behind
    // in the other tree, which is where the working directories and provider homes live.
    expect(readdirSync(scratchRoot).sort()).toEqual(
      made
        .slice(2)
        .map((run) => run.runId)
        .sort(),
    )
    // …and the paired positive: the newest run's directories are still there and still empty of
    // anyone else's work.
    expect(existsSync(made[4].evidence)).toBe(true)
    expect(existsSync(made[0].evidence)).toBe(false)
  })

  it('🔴 708 · a run marked kept survives every prune, and does not cost a newer run its place', () => {
    // ⚑ `704` H-7: the dispatch reading a run is the one that makes new ones. Six runs are planted,
    // the OLDEST is marked the way a dispatch marks it, and a seventh run prunes.
    const { evidenceRoot, scratchRoot } = makeRoots()
    const made = []
    for (let hour = 1; hour <= 7; hour++) {
      const run = beginSmokeRun({
        evidenceRoot,
        scratchRoot,
        keep: 5,
        now: at(`2026-09-24T0${hour}:00:00.000Z`),
        pid: 2000 + hour,
      })
      made.push(run)
      run.release()
      if (hour === 1) writeFileSync(join(run.evidence, KEPT_MARK), '')
    }
    const runs = readdirSync(evidenceRoot)
      .filter((name) => name !== 'latest')
      .sort()
    // ⛔ The marked run is still there, in BOTH roots — a kept run keeps its scratch too.
    expect(runs).toContain(made[0].runId)
    expect(existsSync(made[0].scratch)).toBe(true)
    // ⚑ …and it did not count against `keep`: the five newest unmarked runs are all there too.
    expect(runs).toEqual([made[0], ...made.slice(2)].map((run) => run.runId))
    // ⚑ The paired positive: the prune still ran, and took the oldest UNMARKED run.
    expect(existsSync(made[1].evidence)).toBe(false)
    expect(existsSync(made[1].scratch)).toBe(false)
  })

  it('🔴 708 · a kept run INSIDE the newest `keep` does not cost an unkept run its place', () => {
    // ⚠️ Marking the OLDEST cannot tell "does not count against keep" from "counts, but is not
    // deleted" — both leave the same runs (708's review). Marking one of the newest can: if it
    // counted, one more unmarked run would go.
    const { evidenceRoot, scratchRoot } = makeRoots()
    const made = []
    for (let hour = 1; hour <= 7; hour++) {
      const run = beginSmokeRun({
        evidenceRoot,
        scratchRoot,
        keep: 3,
        now: at(`2026-09-24T1${hour}:00:00.000Z`),
        pid: 3000 + hour,
      })
      made.push(run)
      run.release()
      // ⚑ The SECOND-newest, so the last run's prune meets a kept run inside its window.
      if (hour === 6) writeFileSync(join(run.evidence, KEPT_MARK), '')
    }
    const runs = readdirSync(evidenceRoot)
      .filter((name) => name !== 'latest')
      .sort()
    // ⚑ The marked 6th and the THREE newest unmarked (4, 5, 7) — four in all. ⛔ A prune that counted
    // the mark against `keep` would have taken the 4th at the last run.
    expect(runs).toEqual([made[3], made[4], made[5], made[6]].map((run) => run.runId))
    expect(existsSync(made[2].evidence)).toBe(false)
  })
})
