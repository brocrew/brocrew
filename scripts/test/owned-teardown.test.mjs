import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { descendantsOf, tearDownAndRemove } from '../lib/owned-teardown.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const describeOnPosix = process.platform === 'win32' ? describe.skip : describe

/**
 * Teardown ordering for the Electron gates. A `codex app-server` spawned by the provider-auth probe
 * is `detached`, so it leads its own process group and the group kill never reaches it; it exits
 * cooperatively, on its own schedule, and can write its model cache into the temp home while the
 * directory is being removed (`ENOTEMPTY`).
 *
 * The rule is ordering, not a retry: a retry around `rmSync` would turn the loud failure into a
 * silent one and delete the directory of a process that is still writing. Find what we launched by
 * ancestry, and remove the directory only once every one of them is verified gone.
 */

/** `ps -A -o pid=,ppid=` output, written the way the real command lays it out. */
const table = (rows) => rows.map(([pid, ppid]) => `  ${String(pid)} ${String(ppid)}`).join('\n')

describe('descendantsOf · the whole family, parents first', () => {
  it('finds children and grandchildren, and never the root itself', () => {
    const readTable = () =>
      table([
        [1, 0],
        [500, 1], // an unrelated process
        [100, 1], // the shim
        [110, 100], // the browser
        [120, 110], // gpu
        [121, 110], // utility
        [122, 110], // renderer
        [130, 122], // something the renderer spawned
        [501, 500], // an unrelated child
      ])

    const found = descendantsOf(100, { readTable })

    expect(found.map((p) => p.pid)).toEqual([110, 120, 121, 122, 130])
    // The order is the contract. `createOwnedProcessLifecycle.remember()` accepts a pid only when its
    // parent is already remembered, so a child offered before its parent is refused and the subtree
    // under it is never signalled. A depth-first or reversed walk passes the "finds them all"
    // assertion above and still leaves an Electron running.
    for (const [child, parent] of [
      [110, 100],
      [120, 110],
      [130, 122],
    ]) {
      const at = (pid) => found.findIndex((p) => p.pid === pid)
      if (parent !== 100) expect(at(parent)).toBeLessThan(at(child))
    }
  })

  it('terminates on a cycle inside the family, and names each pid once', () => {
    // A reachable cycle is the only kind that matters. The table is text read from a live `ps`, so a
    // torn read can name a parent that is also a descendant: here 110's parent is 100 on one line and
    // 120 on another, and 120 is 110's own child. Without the `seen` set the walk never returns. The
    // bad row must sit inside the subtree, or the walk never reaches it and the test proves nothing.
    const readTable = () =>
      table([
        [100, 1],
        [110, 100],
        [120, 110],
        [110, 120],
        [121, 110],
        [121, 121],
      ])

    const found = descendantsOf(100, { readTable }).map((p) => p.pid)
    expect(found).toEqual([110, 120, 121])
    expect(new Set(found).size).toBe(found.length)
  })

  it('ignores lines that are not two integers, rather than parsing them into a pid', () => {
    const readTable = () =>
      [
        '  100     1',
        'PID  PPID',
        '',
        '  110   100',
        'ps: something went wrong',
        '  ??    100',
      ].join('\n')

    expect(descendantsOf(100, { readTable }).map((p) => p.pid)).toEqual([110])
  })

  it('returns nothing when the launch has no children, and says so as an empty list', () => {
    // The pair for the three positives above: the walk answers the table, not a family it invented.
    expect(
      descendantsOf(100, {
        readTable: () =>
          table([
            [100, 1],
            [500, 1],
          ]),
      }),
    ).toEqual([])
  })
})

/** A lifecycle double that records what it was asked to do, in order. */
function fakeLifecycle(outcome, log) {
  return {
    kill9() {
      log.push('kill9')
      return Object.freeze({ remaining: [], unverifiable: [], signals: 1, ...outcome })
    },
    stop() {
      log.push('stop')
      return Object.freeze({ remaining: [], unverifiable: [], signals: 1, ...outcome })
    },
  }
}

describe('tearDownAndRemove · the directory comes off last, or not at all', () => {
  it('reaps FIRST and removes SECOND', () => {
    const log = []
    const result = tearDownAndRemove({
      lifecycle: fakeLifecycle({ complete: true }, log),
      directory: '/tmp/brobot2-fixture-XXXX',
      remove: (path) => log.push(`remove:${path}`),
    })

    // The one ordering this module exists for. A removal before the reap passes every assertion about
    // the result and is exactly the shape that failed a merge.
    expect(log).toEqual(['kill9', 'remove:/tmp/brobot2-fixture-XXXX'])
    expect(result.removed).toBe(true)
  })

  it('does NOT remove the directory when the reap is incomplete', () => {
    const log = []
    const result = tearDownAndRemove({
      lifecycle: fakeLifecycle({ complete: false, remaining: [4242] }, log),
      directory: '/tmp/brobot2-fixture-YYYY',
      remove: (path) => log.push(`remove:${path}`),
    })

    expect(log).toEqual(['kill9'])
    expect(result.removed).toBe(false)
    // The pid has to survive into the caller's error, or the gate reports "could not reap" and names
    // nobody.
    expect(result.remaining).toEqual([4242])
  })

  it('does NOT remove it when nothing is alive but something could not be verified', () => {
    // Fail-closed: a `lsof` read that failed must not look like "nothing holds the port", because the
    // second answer removes the directory. `complete` is false for the reason `owned-process.mjs`
    // makes it false: an unverifiable process is not a gone one.
    const log = []
    const result = tearDownAndRemove({
      lifecycle: fakeLifecycle({ complete: false, remaining: [], unverifiable: [4243] }, log),
      directory: '/tmp/brobot2-fixture-ZZZZ',
      remove: (path) => log.push(`remove:${path}`),
    })

    expect(log).toEqual(['kill9'])
    expect(result.removed).toBe(false)
    expect(result.unverifiable).toEqual([4243])
  })

  it('kills rather than asking politely — this gate has no graceful path to measure', () => {
    // `quit:check` measures a graceful quit and takes seconds over it. Here the app has already
    // answered every question, and `stop()` would spend `owned-process`'s ten SIGTERM attempts before
    // escalating, while the provider child goes on writing.
    const log = []
    tearDownAndRemove({
      lifecycle: fakeLifecycle({ complete: true }, log),
      directory: '/tmp/brobot2-fixture-WWWW',
      remove: () => log.push('remove'),
    })

    expect(log[0]).toBe('kill9')
    expect(log).not.toContain('stop')
  })
})

/**
 * A failed removal reports what survived and when it was written. Node's recursive `rmSync` names
 * the path it was handed, so the root appears in the error whether the race was in the root or
 * deeper. What settles it is what is left and when it was written: an entry whose mtime is after
 * the removal was asked is a writer the reap could not see; one before it is a slow unlink.
 */
describe('tearDownAndRemove · a failed removal reports what survived it', () => {
  const complete = {
    kill9: () => ({ complete: true, remaining: [], exiting: [], unverifiable: [], refused: [] }),
  }
  /** Successive readings of one clock; the last is repeated if it is asked again. */
  const nextOf = (readings) => {
    let index = 0
    return () => readings[Math.min(index++, readings.length - 1)]
  }
  const enotempty = () => {
    throw Object.assign(new Error('ENOTEMPTY, Directory not empty: /tmp/brobot2-window-oAuZlk'), {
      code: 'ENOTEMPTY',
    })
  }

  it('names the survivors written after the removal was asked, and says that is a live writer', () => {
    let thrown = null
    try {
      tearDownAndRemove({
        lifecycle: complete,
        directory: '/tmp/brobot2-window-oAuZlk',
        remove: enotempty,
        // A clock that moves: a constant one cannot tell "stamped when asked" from "stamped when it
        // answered". The removal walk is the slow part; these are its two ends.
        now: nextOf([1_000, 1_020]),
        survivors: () => [
          { path: 'provider-homes/default/default/codex', mtimeMs: 995, isDirectory: true },
          {
            path: 'provider-homes/default/default/codex/logs_2.sqlite',
            mtimeMs: 1_009,
            isDirectory: false,
          },
          {
            path: 'provider-homes/default/default/codex/logs_2.sqlite-wal',
            mtimeMs: 1_007,
            isDirectory: false,
          },
        ],
      })
    } catch (error) {
      thrown = error
    }

    expect(thrown).toBeInstanceOf(Error)
    expect(thrown.message).toContain('ENOTEMPTY, Directory not empty:')
    expect(thrown.message).toContain('3 entries survived the removal')
    expect(thrown.message).toContain('2 of them FILES written AT OR AFTER the moment it was asked')
    expect(thrown.message).toContain('something was still WRITING')
    // It names what to look for and does not assert whose process it was; nothing here establishes
    // that.
    expect(thrown.message).toContain('a process it never owned')
    expect(thrown.message).not.toContain('this check launched')
    // The age is per entry and measured from the ask, so each late write carries its own offset.
    expect(thrown.message).toContain('logs_2.sqlite ← written 9ms AFTER the removal was asked')
    expect(thrown.message).toContain('logs_2.sqlite-wal ← written 7ms AFTER the removal was asked')
    // The entry written before the ask carries no offset: the whole line, so a neighbour ending in the
    // same word cannot satisfy this.
    expect(thrown.message).toContain('\n   · provider-homes/default/default/codex\n')
    // The original error is kept as `cause`, which a reader follows to the syscall.
    expect(thrown.cause).toMatchObject({ code: 'ENOTEMPTY' })
  })

  it('says so when nothing was written after the ask, rather than accusing a process', () => {
    expect(() =>
      tearDownAndRemove({
        lifecycle: complete,
        directory: '/tmp/brobot2-window-slow',
        remove: enotempty,
        now: () => 5_000,
        survivors: () => [{ path: 'Cache/index', mtimeMs: 4_000, isDirectory: false }],
      }),
    ).toThrow(
      /1 entry survived the removal and NO surviving file was written after it was asked, so this is a slow unlink rather than a writer/,
    )
  })

  /**
   * `rmSync` removing an entry sets its parent's mtime, so a partial removal stamps every directory
   * it emptied with a time at or after the ask. That is our own footprint, not a writer. The
   * directory below has a later mtime than the file, so only `isDirectory` tells them apart.
   */
  it('⛔ a directory stamped by our own unlinks is not reported as a writer', () => {
    expect(() =>
      tearDownAndRemove({
        lifecycle: complete,
        directory: '/tmp/brobot2-window-dirs',
        remove: enotempty,
        now: () => 5_000,
        survivors: () => [
          { path: 'provider-homes', mtimeMs: 5_040, isDirectory: true },
          {
            path: 'provider-homes/default/default/codex/skills',
            mtimeMs: 5_030,
            isDirectory: true,
          },
          {
            path: 'provider-homes/default/default/codex/auth.json',
            mtimeMs: 4_000,
            isDirectory: false,
          },
        ],
      }),
    ).toThrow(
      /NO surviving file was written after it was asked, so this is a slow unlink rather than a writer — the 2 directories carrying a later mtime are this removal's own unlinks and say nothing about a writer \(360\)/,
    )
  })

  /**
   * The paired positive: the same shape with the late entry marked a file has to reach the other
   * sentence, or the test above passes over a function that never accuses anything.
   */
  it('⚑ …and the same tree with a FILE written late still is', () => {
    expect(() =>
      tearDownAndRemove({
        lifecycle: complete,
        directory: '/tmp/brobot2-window-dirs',
        remove: enotempty,
        now: () => 5_000,
        survivors: () => [
          { path: 'provider-homes', mtimeMs: 5_040, isDirectory: true },
          {
            path: 'provider-homes/default/default/codex/skills/.system/imagegen/SKILL.md',
            mtimeMs: 5_030,
            isDirectory: false,
          },
        ],
      }),
    ).toThrow(/1 of them FILES written AT OR AFTER the moment it was asked/)
  })

  /**
   * `Date.now()` floors to the integer millisecond and an mtime does not. A file stamped inside the
   * ask's own millisecond was written before the ask as often as after it (measured on Node 20 and
   * 24: 193 of 200 writes carried an `mtimeMs` at or above a later `Date.now()`). The pair below is
   * the rule: inside the ask's own millisecond accuses nobody, a whole millisecond later still does.
   */
  it("⛔ a file stamped inside the ask's OWN millisecond is not a writer", () => {
    expect(() =>
      tearDownAndRemove({
        lifecycle: complete,
        directory: '/tmp/brobot2-window-floor',
        remove: enotempty,
        now: () => 5_000,
        // A fractional mtime is realistic: `lstat().mtimeMs` is a float. This is what a file written 0.4ms
        // before the ask reports.
        survivors: () => [{ path: 'Cache/index', mtimeMs: 5_000.4, isDirectory: false }],
      }),
    ).toThrow(/NO surviving file was written after it was asked/)
  })

  it('⚑ …and one a whole millisecond later still is', () => {
    expect(() =>
      tearDownAndRemove({
        lifecycle: complete,
        directory: '/tmp/brobot2-window-floor',
        remove: enotempty,
        now: () => 5_000,
        survivors: () => [{ path: 'Cache/index', mtimeMs: 5_001, isDirectory: false }],
      }),
    ).toThrow(/1 of them FILES written AT OR AFTER the moment it was asked/)
  })

  /**
   * The headroom is on the accusation only. A directory's late mtime does not accuse anybody, it
   * explains "this removal emptied it". Applying the millisecond there as well was measured and
   * rejected: the real-directory fixture lost the clause in 4 of 10 runs on Node 24, because a whole
   * failed removal fits inside one millisecond. Both errors must fall toward accusing nobody, which
   * is not the same threshold on both sides.
   */
  it('⛔ …while a DIRECTORY stamped inside that same millisecond is still named as our own', () => {
    expect(() =>
      tearDownAndRemove({
        lifecycle: complete,
        directory: '/tmp/brobot2-window-floor',
        remove: enotempty,
        now: () => 5_000,
        survivors: () => [
          { path: 'provider-homes', mtimeMs: 5_000.4, isDirectory: true },
          { path: 'provider-homes/auth.json', mtimeMs: 4_000, isDirectory: false },
        ],
      }),
    ).toThrow(/the 1 directory carrying a later mtime is this removal's own unlinks/)
  })

  /**
   * The line that carries the writer claim must survive the cap. `MAX_SURVIVORS_SHOWN` is 25 and a
   * `codex` provider home is dozens of directories, so in walk order the late file could sit past the
   * cut. The writers go first; everything else keeps its walk order behind them.
   */
  it('⛔ shows the file that carries the writer claim even when 40 directories precede it', () => {
    let thrown = null
    try {
      tearDownAndRemove({
        lifecycle: complete,
        directory: '/tmp/brobot2-window-capped',
        remove: enotempty,
        now: () => 5_000,
        survivors: () => [
          ...Array.from({ length: 40 }, (_, index) => ({
            path: `skills/.system/dir-${String(index)}`,
            mtimeMs: 5_010,
            isDirectory: true,
          })),
          { path: 'skills/.system/imagegen/SKILL.md', mtimeMs: 5_020, isDirectory: false },
        ],
      })
    } catch (error) {
      thrown = error
    }

    expect(thrown.message).toContain('1 of them FILES written AT OR AFTER')
    // It says what the other forty are, so the count is not read as forty-one writers.
    expect(thrown.message).toContain('40 more survivors are directories whose mtime this removal')
    expect(thrown.message).toContain('imagegen/SKILL.md ← written 20ms AFTER')
    // The cap still admits to itself, and it is the directories that fall off the end.
    expect(thrown.message).toContain('16 more, counted but not shown')
  })

  /**
   * A teardown that could not say what it owns removes nothing, and the refusal is the reason rather
   * than a pid. The lifecycle below reports `complete: false` with every pid list empty, which is
   * the shape `refused` exists for: nothing is running, and what was running could not be asked.
   */
  it('⛔ leaves the directory alone when the reap refused to decide, and never calls remove', () => {
    let removals = 0
    const outcome = tearDownAndRemove({
      lifecycle: {
        kill9: () => ({
          complete: false,
          signals: 1,
          remaining: [],
          exiting: [],
          unverifiable: [],
          refused: ['pid 41 reads unsignallable (EPERM), so it could not be frozen'],
        }),
      },
      directory: '/tmp/brobot2-window-refused',
      remove: () => {
        removals += 1
      },
    })

    expect(removals).toBe(0)
    expect(outcome).toMatchObject({
      removed: false,
      complete: false,
      refused: ['pid 41 reads unsignallable (EPERM), so it could not be frozen'],
    })
  })

  it('admits its own cap instead of pointing at a list as if it were the set', () => {
    // A pointer clause is a claim: "listed below" asserts the list is the set. This one shows
    // twenty-five and says how many more it counted, so the sentence stays true at any size.
    let thrown = null
    try {
      tearDownAndRemove({
        lifecycle: complete,
        directory: '/tmp/brobot2-window-many',
        remove: enotempty,
        now: () => 0,
        survivors: () =>
          Array.from({ length: 30 }, (_, index) => ({ path: `entry-${index}`, mtimeMs: 0 })),
      })
    } catch (error) {
      thrown = error
    }
    expect(thrown.message).toContain('30 entries survived')
    expect(thrown.message).toContain('entry-24')
    expect(thrown.message).not.toContain('entry-25')
    expect(thrown.message).toContain('5 more, counted but not shown')
  })

  it('says the directory is left in place and that a re-run proves nothing', () => {
    expect(() =>
      tearDownAndRemove({
        lifecycle: complete,
        directory: '/tmp/brobot2-window-oAuZlk',
        remove: enotempty,
        now: () => 0,
        survivors: () => [],
      }),
    ).toThrow(
      /0 entries survived the removal\n[\s\S]*nothing is left under it now[\s\S]*LEFT IN PLACE[\s\S]*a second run proves nothing about the first/,
    )
  })

  it('leaves a successful removal alone — the survivor walk is only ever on the failure path', () => {
    let walked = 0
    const result = tearDownAndRemove({
      lifecycle: complete,
      directory: '/tmp/brobot2-window-fine',
      remove: () => {},
      survivors: () => {
        walked += 1
        return []
      },
    })
    expect(result).toMatchObject({ complete: true, removed: true })
    expect(walked).toBe(0)
  })
})

/**
 * A real directory, the real `rmSync`, the real walk. A stub `remove` proves the message and
 * nothing about the removal; this one makes the removal fail the way a filesystem does and lets
 * the default survivor walk find what is left.
 */
describeOnPosix('tearDownAndRemove · against a real directory it cannot empty', () => {
  const made = []

  /**
   * Unlock every directory under `root`, not just `<root>/locked`. An unremovable directory sits
   * four levels down in the `codex` provider-home shape, so a shallower cleanup threw and leaked the
   * whole tree. A test's cleanup has to survive the test failing.
   */
  const unlockEverything = (directory) => {
    let entries
    try {
      chmodSync(directory, 0o700)
      entries = readdirSync(directory, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      if (entry.isDirectory()) unlockEverything(join(directory, entry.name))
    }
  }

  afterEach(() => {
    for (const directory of made.splice(0)) {
      unlockEverything(directory)
      rmSync(directory, { recursive: true, force: true })
    }
  })

  it('throws naming the real survivors, and leaves them where they are', () => {
    const root = mkdtempSync(join(tmpdir(), 'brobot2-teardown-'))
    made.push(root)
    mkdirSync(join(root, 'locked'))
    writeFileSync(join(root, 'locked', 'held.sqlite'), 'x')
    writeFileSync(join(root, 'loose.json'), 'y')
    // r-x: the entry can be listed and never unlinked, so `rmSync` throws from inside the walk as it
    // does when it loses a race, and the survivor walk still has to read it.
    chmodSync(join(root, 'locked'), 0o500)

    let thrown = null
    try {
      tearDownAndRemove({ lifecycle: complete9(), directory: root })
    } catch (error) {
      thrown = error
    }

    expect(thrown).toBeInstanceOf(Error)
    expect(thrown.message).toContain(`could not remove ${root}`)
    expect(thrown.message).toContain('locked/held.sqlite')
    expect(thrown.message).toContain('the reap reported COMPLETE')
    // Nothing has been removed out from under it, on the failure path too.
    expect(readFileSync(join(root, 'locked', 'held.sqlite'), 'utf8')).toBe('x')
  })

  /**
   * A `codex` provider home, the shape that makes the removal fail part-way through. One copy, so the
   * two tests that use it (nothing writing, and a writer touching a survivor) differ only by the
   * writer.
   *
   * Every entry, files included, is pushed a minute into the past. On a runtime that removes nothing
   * the `skills/*.md` files would survive stamped at the ask and be accused as writers. A fixture
   * must not depend on the subject removing its evidence.
   */
  const aCodexShapedTree = () => {
    const root = mkdtempSync(join(tmpdir(), 'brobot2-teardown-'))
    made.push(root)
    const codex = join(root, 'provider-homes', 'default', 'default', 'codex')
    mkdirSync(join(codex, 'skills'), { recursive: true })
    mkdirSync(join(codex, 'locked'))
    const skills = join(codex, 'skills')
    const locked = join(codex, 'locked')
    const files = ['a.md', 'b.md', 'c.md'].map((name) => join(skills, name))
    for (const file of files) writeFileSync(file, 'x')
    writeFileSync(join(locked, 'held.sqlite'), 'x')
    // `utimesSync` rather than a sleep: a fixture written a millisecond before the ask shares its
    // clock tick (`Date.now()` floors, an mtime does not), and a test that flakes on the boundary it
    // is testing proves nothing.
    const past = new Date(Date.now() - 60_000)
    for (const path of [
      ...files,
      join(locked, 'held.sqlite'),
      locked,
      skills,
      codex,
      join(root, 'provider-homes', 'default', 'default'),
      join(root, 'provider-homes', 'default'),
      join(root, 'provider-homes'),
      root,
    ]) {
      utimesSync(path, past, past)
    }
    // r-x: `held.sqlite` can be listed and never unlinked, so the removal fails from inside the walk
    // as it does when it loses a race.
    chmodSync(locked, 0o500)
    return { root, locked, held: join(locked, 'held.sqlite'), codex }
  }

  /**
   * The precondition this fixture cannot establish for itself. `rmSync` is the JS `rimraf` on Node
   * 20 and 22 and a C++ binding on 24. The JS one throws on the first failed unlink and empties
   * nothing; the binding carries on and empties what it can. Measured with `held.sqlite` locked:
   *
   *   v20.19.3 / v22.22.0   EACCES     10 survivors   0 directories emptied
   *   v24.0.2               ENOTEMPTY   6 survivors   1 directory emptied
   *
   * A runtime below the declared one leaves no footprint for the test below to be about, and the
   * test would assert its conclusion with its premise false. `scripts/engine-check.mjs` refuses the
   * gate first; this names it where the dependence lives, so a direct `vitest` run does too.
   */
  const theRuntimeThisFixtureNeeds = () => {
    const major = Number(process.versions.node.split('.')[0])
    if (major < 24) {
      throw new Error(
        `this fixture needs the runtime the repo declares — engines.node >= 24, .nvmrc 24 — and is ` +
          `running on node ${process.versions.node}. Below 24 rmSync throws on the first failed ` +
          `unlink and empties no directory, so there is no footprint of its own for the message to ` +
          `misread and nothing here is being measured. Run it on node 24 (387).`,
      )
    }
  }

  /**
   * The false accusation, reproduced on a real filesystem with nothing running. Every survivor was
   * written a minute ago, so the only entry that can carry a post-ask time is one the removal
   * itself stamped.
   *
   * This asserts the classification. The exact wording of the clause is pinned upstairs against
   * injected survivors; down here the same pin would also be a bet on how far `rmSync` got. This test
   * and the one under it are the pair: no writer accused when nothing wrote, a writer accused when
   * something did.
   */
  it('⛔ does not accuse a writer when the only late mtimes are directories it emptied itself', (ctx) => {
    // darwin only: its premise is how far the Mac's `rmSync` gets before a locked folder stops it; on
    // ext4 it empties nothing. CI runs on Linux and skips it; the Mac's own gate runs it.
    ctx.skip(process.platform !== 'darwin')
    theRuntimeThisFixtureNeeds()
    const { root, locked } = aCodexShapedTree()

    let thrown = null
    try {
      tearDownAndRemove({ lifecycle: complete9(), directory: root })
    } catch (error) {
      thrown = error
    }

    expect(thrown).toBeInstanceOf(Error)
    // This is the claim that must not be made here.
    expect(thrown.message).not.toContain('something was still WRITING')
    expect(thrown.message).toContain('NO surviving file was written after it was asked')
    // The premise, asserted rather than assumed: the removal really did empty a directory. Without
    // this the test passes on a tree the removal never touched.
    expect(thrown.message).toMatch(
      /· provider-homes\/default\/default\/codex ← a directory whose mtime moved \d+ms after the ask/,
    )
    // Every entry the message flags is a directory: nothing here may be flagged as written, whatever
    // the removal got through.
    const flagged = [...thrown.message.matchAll(/^ {3}· (\S+) ← (.+)$/gm)]
    expect(flagged.length).toBeGreaterThan(0)
    expect(flagged.filter(([, , tail]) => tail.startsWith('written '))).toEqual([])

    // This fixture's unremovable directory is deeper than the shared `afterEach` reaches, so it
    // unlocks its own; a `0500` tree left behind takes the next test down with it.
    chmodSync(locked, 0o700)
  })

  /**
   * The paired positive on the same real tree. An assertion with no failing case is a comment: this
   * is the same fixture with the one fact changed that must flip it.
   *
   * `utimesSync` into the future is what a writer looks like to this code, since the survivor walk
   * reads `lstat().mtimeMs` and nothing else. Spawning a real process would measure the scheduler
   * instead, and would contradict the premise that the reap already reported complete.
   */
  it('⚑ …and a real surviving FILE stamped after the ask still is accused', (ctx) => {
    // darwin only: its premise is how far the Mac's `rmSync` gets before a locked folder stops it; on
    // ext4 it empties nothing. CI runs on Linux and skips it; the Mac's own gate runs it.
    ctx.skip(process.platform !== 'darwin')
    theRuntimeThisFixtureNeeds()
    const { root, locked, held } = aCodexShapedTree()
    const future = new Date(Date.now() + 60_000)
    utimesSync(held, future, future)

    let thrown = null
    try {
      tearDownAndRemove({ lifecycle: complete9(), directory: root })
    } catch (error) {
      thrown = error
    }

    expect(thrown).toBeInstanceOf(Error)
    expect(thrown.message).toContain('1 of them FILES written AT OR AFTER the moment it was asked')
    expect(thrown.message).toContain('something was still WRITING')
    // The file is named first, ahead of the directories the removal stamped itself.
    expect(thrown.message).toMatch(
      /· provider-homes\/default\/default\/codex\/locked\/held\.sqlite ← written \d+ms AFTER the removal was asked/,
    )
    // The removal's own footprint is still named in the same message: the two claims coexist.
    expect(thrown.message).toContain('whose mtime this removal moved itself, which is evidence of')

    chmodSync(locked, 0o700)
  })

  it('names a directory it cannot even list rather than throwing while describing a failure', () => {
    const root = mkdtempSync(join(tmpdir(), 'brobot2-teardown-'))
    made.push(root)
    mkdirSync(join(root, 'locked'))
    writeFileSync(join(root, 'locked', 'held.sqlite'), 'x')
    // Pushed into the past before the mode changes: a fixture written a millisecond before the ask can
    // share its clock tick, and this test asserts what the message does not say about mtimes.
    const past = new Date(Date.now() - 60_000)
    utimesSync(join(root, 'locked', 'held.sqlite'), past, past)
    utimesSync(join(root, 'locked'), past, past)
    utimesSync(root, past, past)
    chmodSync(join(root, 'locked'), 0o000)

    let thrown = null
    try {
      tearDownAndRemove({ lifecycle: complete9(), directory: root })
    } catch (error) {
      thrown = error
    }
    expect(thrown).toBeInstanceOf(Error)
    expect(thrown.message).toContain('locked/ (could not be listed: EACCES)')
    // Not evidence of a process. An entry whose mtime could not be read has no time to compare, so it
    // must fall on the side that accuses nobody; stamping the walk's own clock here would turn a
    // permissions problem into "something was still WRITING".
    expect(thrown.message).not.toContain('something was still WRITING')
    // Nothing was unlinked in this fixture, so the clause explaining a moved directory mtime has
    // nothing to explain and must not appear.
    expect(thrown.message).not.toContain("this removal's own unlinks")
    expect(thrown.message).not.toContain('a directory whose mtime moved')
  })
})

function complete9() {
  return {
    kill9: () => ({
      complete: true,
      remaining: [],
      exiting: [],
      unverifiable: [],
      refused: [],
    }),
  }
}

/**
 * The removal is still the plain one. `maxRetries` would make an intermittent `ENOTEMPTY` green
 * while the directory of a live app came off underneath it. The remedy is upstream: `complete`
 * waits for the process table, so there is nothing left to race.
 */
describe('the removal itself', () => {
  const source = readFileSync(join(HERE, '..', 'lib', 'owned-teardown.mjs'), 'utf8')

  it('passes recursive and force, and nothing that retries', () => {
    const body = source.slice(source.indexOf('function defaultRemove('))
    expect(body).toContain('rmSync(directory, { recursive: true, force: true })')
    expect(body).not.toContain('maxRetries')
    expect(body).not.toContain('retryDelay')
  })
})

/**
 * The instruments actually go through it: the rule above is worth nothing if a check keeps its own
 * copy of the removal. Being in `ci` does not cover a check being quietly rewritten. Every Electron
 * gate (`fixture:check`, `window:check`, `quit:check`) goes through this module, so the pins are a
 * table rather than a file.
 */
describe.each([
  ['window:check', 'window-opens-check.mjs'],
  ['quit:check', 'app-closes-check.mjs'],
])('…and %s removes its directory only through that rule', (_gate, file) => {
  const check = readFileSync(join(HERE, '..', file), 'utf8')
  const launchedAt = check.indexOf('const child = spawn(')

  it('takes ownership of the launch and tears down through this module, once each', () => {
    expect(check.split('createOwnedProcessLifecycle({').length - 1).toBe(1)
    expect(check.split('discoverDescendants: descendantsOf').length - 1).toBe(1)
    expect(check.split('tearDownAndRemove({ lifecycle, directory: userDataDir })').length - 1).toBe(
      1,
    )
  })

  it('remembers the family while the app is still up, not only at teardown', () => {
    // `refreshDescendants` is a no-op once the launcher is gone and `remember()` refuses a pid whose
    // parent it never saw, so a crash between the app appearing and the teardown would leave Electron
    // helpers that nothing has authority to signal.
    expect(check.split('lifecycle.refreshDescendants()').length - 1).toBe(1)
  })

  /**
   * The third answer has to reach the person reading the red line. `outcome.refused` is populated
   * only when a real teardown cannot freeze a real tree, which no unit test will cause, so what `ci`
   * can check is that the gate still says it: a report that drops the clause turns a refusal into a
   * bare "could not reap". Asserted on the call and the arithmetic rather than the word, because the
   * word is in the prose above it in every one of these files.
   */
  it('says what the teardown refused to decide about, not only which pids it counted', () => {
    expect(check.split('refusals(outcome)').length - 1).toBe(1)
    expect(check).toContain('outcome.refused.length === 0')
    expect(check).toContain('outcome.refused.map((why)')
  })

  it('has no removal of the user-data directory anywhere BELOW the launch', () => {
    // Positional, not a bare absence: the pre-launch `sun_path` guard removes the directory too and
    // must keep doing so, since nothing has been started at that point. What may not exist is a second
    // removal after the `spawn`, because that is the one that can race the app.
    expect(launchedAt).toBeGreaterThan(0)
    const removals = [...check.matchAll(/rmSync\(userDataDir/g)].map((m) => m.index)
    expect(removals).toHaveLength(1)
    expect(removals[0]).toBeLessThan(launchedAt)
  })

  it('names a pid still on its way out as its own fact on the red line', () => {
    // `remaining` is an app still running and `exiting` is one that outlasted the reap's bound leaving
    // the table. Folding the second into the first would send a reader looking for a leak.
    expect(check).toContain('outcome.exiting.length > 0')
    expect(check).toContain('are still in the process table on their way out')
  })

  it('does not let the teardown REPLACE the failure it was reporting', () => {
    // An `rmSync` that threw from inside the catch would overwrite the real error with itself. Every
    // one of these calls the teardown from inside a `try`.
    expect(check).toContain('…and the teardown itself failed: ${teardownFailure.message}')
  })
})
