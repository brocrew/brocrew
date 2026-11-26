import {
  existsSync,
  lstatSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  GATE_SOCKET,
  KEPT_MARK,
  SUN_PATH_MAX,
  beginSmokeRun,
  checkProbeGatePath,
  smokeTmpRoot,
  smokeUserDataDir,
} from '../lib/smoke-run.mjs'

/**
 * The run-scoping and the lock the live smokes share. The module is what is tested, not the smokes:
 * this covers the branches a passing smoke never takes (a lock already held, a prune that has
 * something to drop, the ordering the run id promises).
 */
const roots = []

/**
 * Short names: `beginSmokeRun` refuses a run whose gate socket would not fit `sun_path`, and
 * `<os.tmpdir()>/brobot2-smoke-run-test-XXXXXX/evidence/<run id>/user-data/one-host.sock` came to
 * 142 bytes against a limit of 103.
 *
 * This file's own base, never a shared one: the ownership test pushes the parent onto `roots`, where
 * `afterEach` removes it, and the same base as `host-gate-witness.test.mjs` would let this teardown
 * delete directories that file binds live sockets in (both run in parallel forks). Own your own
 * name, and only remove what you made under it.
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
  vi.unstubAllEnvs()
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
    // The paired positive for the prune test below: `latest` moves, and is never itself a run.
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
    // The refused run created nothing: a second tree beside the first is the failure the lock exists to
    // prevent, and "it threw" alone would not prove that.
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
 * The gate socket has to fit: `<userData>/one-host.sock` is copied into a 104-byte macOS `sun_path`,
 * and `os.tmpdir()` alone takes 48 bytes before the run id. When it did not fit, `bind` failed
 * `EINVAL` and the gate answered `unknown`. Both the shape that fits and the one that did not are
 * asserted.
 */
describe('242 · the gate socket has to FIT, and the root is what decides', () => {
  const RUN = '2026-08-19T10-20-30-400Z-4242'
  const LONGEST = 'user-data-sole-instance'
  // A Mac's default `os.tmpdir()`, `/var/folders/<2>/<28>/T`.
  const MAC_TMPDIR_BYTES = 48
  const LIVE_LEAF = 'brobot2-ui-smoke'

  it('🔴 the OLD root could not hold a socket, and the NEW one can', (ctx) => {
    // darwin only: the premise is the Mac's long `tmpdir()` against a 104-byte socket path.
    // CI runs on Linux and skips it.
    ctx.skip(process.platform !== 'darwin')
    // Both halves run with `TMPDIR` as long as a Mac's default, in a directory this case makes
    // without `smokeTmpRoot` (the code under test) and `afterEach` removes. A machine with a short
    // `TMPDIR` can then neither pass the negative for the wrong reason nor hide, from the positive, a
    // root that went back to `tmpdir()`.
    const owned = mkdtempSync('/tmp/b2t-tmp-')
    roots.push(owned)
    const longTmp = join(owned, 'T'.padStart(MAC_TMPDIR_BYTES - owned.length - 1, 'x'))
    mkdirSync(longTmp)
    vi.stubEnv('TMPDIR', longTmp)
    expect(tmpdir()).toBe(longTmp)
    expect(longTmp).toHaveLength(MAC_TMPDIR_BYTES)
    // As long as the live smoke's leaf, and this run's own through the `mkdtemp` suffix:
    // `smokeTmpRoot` creates and `chmod`s what it is given, a test may not touch a live instrument's
    // evidence root, and two runs at once must not remove each other's.
    const leaf = `b2t-sock-${owned.slice(-6)}`.padEnd(LIVE_LEAF.length, '-')

    // The old root, refused by the budget every smoke goes through. Computed, never created.
    expect(() => smokeUserDataDir(join(tmpdir(), leaf, RUN), LONGEST)).toThrow(/sun_path holds 103/)

    // ...and the paired positive, on the root the smokes use, budgeted as it is returned.
    const root = smokeTmpRoot(leaf)
    roots.push(root)
    const userData = smokeUserDataDir(join(root, RUN), LONGEST)
    // ...and how little is left: the tightest of the three smokes has 5 bytes spare on this machine,
    // which is why the budget is checked rather than reasoned about.
    expect(SUN_PATH_MAX - 1 - join(userData, GATE_SOCKET).length).toBeLessThan(10)
  })

  it('⛔ is a per-user directory we own, not a shared one anybody can plant in', () => {
    // A name nothing else uses: this assertion is about a root rather than a child, and `afterEach`
    // removes what it is given.
    const root = smokeTmpRoot('b2t-own')
    roots.push(root)
    const seen = lstatSync(root)
    expect(seen.isDirectory()).toBe(true)
    expect(seen.isSymbolicLink()).toBe(false)
    // Windows has no POSIX uid or mode bits; the root still has to exist as a real directory.
    if (process.platform === 'win32') return
    // `/tmp` is world-writable (1777) and a smoke's evidence tree holds copied provider auth, so the
    // root is narrowed rather than inherited.
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
   * Pinned to the two halves of the repair by source grep, since neither can be observed without
   * launching an app: an evidence root built with `join(tmpdir(), ...)`, or a `launchApp` that stops
   * witnessing, would put every script back to reporting green over a feature that cannot run.
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
   * The host's out-of-order alarm is a bare `console.error` in the main process, which is on no CDP
   * target, so a smoke has to write the app's output to a file and sweep it.
   * `ui-live-smoke.mjs` and `resume-live-smoke.mjs` do; `packaged-smoke.mjs` accumulates the app's
   * stderr into `output` but nothing reads it.
   */
  describe("the app's output has somewhere to land (345)", () => {
    const smoke = (name) => readFileSync(join(import.meta.dirname, '..', name), 'utf8')

    /**
     * Windowed on the app's own spawn, not on the file: both smokes spawn other things with output
     * discarded on purpose (`caffeinate`, a diagnostic shell redirecting to its own path), so a
     * whole-file `stdio: 'ignore'` grep fails correct lines. `owned-process.test.mjs`'s `indexOf`
     * windowing is the house answer.
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
        // By the call rather than a variable's name: `APP_LOG` and `logPath` are both spelled in the tree.
        expect(smoke(name), `${name} opens no file for the app to write to`).toContain('openSync(')
      },
    )

    it.each(['ui-live-smoke.mjs', 'resume-live-smoke.mjs'])(
      '⛔ %s reads what it captured, rather than only capturing it',
      (name) => {
        expect(smoke(name), `${name} never looks for an out-of-order publish`).toContain(
          'went out after',
        )
        // And says how much it read: "0 out-of-order publishes" is what a healthy run and a run with an
        // empty log both report; the byte count is what separates them.
        expect(smoke(name), `${name} sweeps without saying how much it swept`).toContain(
          'B of host log swept',
        )
      },
    )

    /**
     * The grep is bound to the product's own words: the hand-typed sentence in the instrument is pinned
     * to its source, so a rewording fails `ci` instead of turning both sweeps into permanent all-clears.
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

    /** Named, not fixed: the one that captures and never reads. */
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
      // Nothing was created and no lock was taken, so a refused start cannot strand the next one.
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
    // The scratch root is pruned with it: a dropped run must not leave half its evidence in the other
    // tree, where the working directories and provider homes live.
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
    // The dispatch reading a run is the one that makes new ones. Six runs are planted, the oldest is
    // marked the way a dispatch marks it, and a seventh run prunes.
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
    // The marked run is still there, in both roots: a kept run keeps its scratch too.
    expect(runs).toContain(made[0].runId)
    expect(existsSync(made[0].scratch)).toBe(true)
    // ...and it did not count against `keep`: the five newest unmarked runs are all there too.
    expect(runs).toEqual([made[0], ...made.slice(2)].map((run) => run.runId))
    // The paired positive: the prune still ran, and took the oldest unmarked run.
    expect(existsSync(made[1].evidence)).toBe(false)
    expect(existsSync(made[1].scratch)).toBe(false)
  })

  it('🔴 708 · a kept run INSIDE the newest `keep` does not cost an unkept run its place', () => {
    // Marking the oldest cannot tell "does not count against keep" from "counts, but is not deleted":
    // both leave the same runs. Marking one of the newest can: if it counted, one more would go.
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
      // The second-newest, so the last run's prune meets a kept run inside its window.
      if (hour === 6) writeFileSync(join(run.evidence, KEPT_MARK), '')
    }
    const runs = readdirSync(evidenceRoot)
      .filter((name) => name !== 'latest')
      .sort()
    // The marked 6th and the three newest unmarked (4, 5, 7): four in all. A prune that counted the
    // mark against `keep` would have taken the 4th at the last run.
    expect(runs).toEqual([made[3], made[4], made[5], made[6]].map((run) => run.runId))
    expect(existsSync(made[2].evidence)).toBe(false)
  })
})

it.each([104, 105])(
  'preserves the probe socket boundary at %i characters and removes only refused trees',
  (length) => {
    const { evidenceRoot } = makeRoots()
    const dir = join(
      evidenceRoot,
      'x'.repeat(length - evidenceRoot.length - GATE_SOCKET.length - 2),
    )
    mkdirSync(dir, { recursive: true })
    expect(join(dir, GATE_SOCKET)).toHaveLength(length)
    if (length === 104) {
      expect(() => checkProbeGatePath(dir)).not.toThrow()
      expect(existsSync(dir)).toBe(true)
    } else {
      expect(() => checkProbeGatePath(dir)).toThrow(
        'the one-host gate socket path would exceed 104 bytes.',
      )
      expect(existsSync(dir)).toBe(false)
      expect(existsSync(evidenceRoot)).toBe(true)
    }
  },
)
