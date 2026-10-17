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
 * 🔴 **325 · when the directory comes off** — the two facts `fixture:check`'s teardown was missing.
 *
 * ## ⚠️ What made this a dispatch rather than a re-run
 *
 * `fixture:check` failed a merge with `ENOTEMPTY, Directory not empty:` on its own temp directory
 * and passed twice straight afterwards. The directory from that failure was still on disk when this
 * was investigated, and it holds exactly one thing:
 *
 * ```
 *   provider-homes/default/default/codex/models_cache.json
 *     { "fetched_at": "2026-09-04T14:37:58.877182Z", "client_version": "0.146.0", … }
 * ```
 *
 * ⛔ **A `codex app-server`, writing its model cache into the check's temp home at the second the
 * check was tearing down.** The app spawns one for the provider-auth health probe; `codex-transport`
 * spawns it `detached: true`, so it leads its OWN process group and `kill(-child.pid)` never
 * reaches it. `202` measured that it still dies — cooperatively, on stdin EOF — which is the whole
 * problem: *cooperatively* means *on its own schedule*, and the removal was racing that schedule.
 *
 * ⚑ **Six such directories were on disk**, one per run whose late write landed after the removal
 * instead of during it. The gate had been leaving them behind, green, for as long as the probe has
 * existed.
 *
 * ## ⛔ Why the rule is ordering and not a retry
 *
 * A retry around `rmSync` turns the loud failure into a silent one: the gate goes green while it
 * deletes the user-data directory of a process that is still writing to it. The two functions below
 * are the ordering instead — find what we launched by ancestry, and remove the directory only once
 * every one of them is verified gone.
 */

/** `ps -A -o pid=,ppid=` output, written the way the real command lays it out. */
const table = (rows) => rows.map(([pid, ppid]) => `  ${String(pid)} ${String(ppid)}`).join('\n')

describe('descendantsOf · the whole family, parents first', () => {
  it('finds children and grandchildren, and never the root itself', () => {
    // The real shape: shim → browser → {gpu, utility, renderer, a provider child of its own}.
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
    // ⛔ **The order is the contract.** `createOwnedProcessLifecycle.remember()` accepts a pid only
    // when its parent is already remembered, so a child offered before its parent is REFUSED and
    // the subtree under it is never signalled. A depth-first or reversed walk passes the "finds
    // them all" assertion above and still leaves an Electron running.
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
    // ⛔ **A REACHABLE cycle, which is the only kind that matters.** The table is text read from a
    // live `ps`, so a torn read can name a parent that is also a descendant — here 110's parent is
    // 100 on one line and 120 on another, and 120 is 110's own child. Without the `seen` set the
    // walk never returns, and a teardown that hangs removes nothing and reports nothing.
    //
    // ⚠️ Written this way after `325 M7` SURVIVED: the first version of this test put the bad row
    // OUTSIDE the subtree, where the walk never reaches it, so it proved nothing about either
    // guard — and the row it was supposed to kill was a `pid === parent` check that the `seen` set
    // had already made dead code. The one-element cycle below is that case, reachable.
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
    // 193's pair for the three positives above: the walk is answering the table, not returning a
    // family it invented.
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

    // ⛔ The one ordering this module exists for. A removal that happens before the reap is exactly
    // the shape that failed 324's merge, and it passes every assertion about the RESULT.
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
    // ⚠️ The pid has to survive into the caller's error, or the gate reports "could not reap" and
    // names nobody — which is a line a person cannot act on.
    expect(result.remaining).toEqual([4242])
  })

  it('does NOT remove it when nothing is alive but something could not be verified', () => {
    // ⛔ The fail-open this replaces. The old teardown read `lsof` through a `catch` that returned
    // an empty list, so *"I could not find out"* and *"nothing holds the port"* were the same
    // answer — and the second one removes the directory. `complete` is false here for the reason
    // `owned-process.mjs` makes it false: an unverifiable process is not a gone one.
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
    // `quit:check` is the instrument that measures a graceful quit and it takes seconds over it.
    // Here the app has already answered every question the check had, and `stop()` would spend
    // `owned-process`'s ten SIGTERM attempts before escalating — time in which the provider child
    // this dispatch is about goes on writing.
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
 * 🔴 **333 · a removal that failed, and what the line has to say about it.**
 *
 * ## ⚠️ The message that started this dispatch, in full
 *
 * ```
 *   the window opened, but the teardown itself failed: ENOTEMPTY, Directory not empty:
 *   /var/folders/…/T/brobot2-window-oAuZlk
 * ```
 *
 * 6,310 tests and a green `build` above it, three consecutive re-runs clean below it. ⛔ **That
 * message is everything `rmSync` knew and nothing a person can act on**, and its one identifier is
 * misleading: Node's recursive `rmSync` has been C++ since v22 and names the path it was HANDED, so
 * the root appears in the error whether the race was in the root or three levels down. Measured, with
 * a writer racing a walk at depth: still the root.
 *
 * ⚑ What settles it is what is LEFT and WHEN it was written, taken at the throw. An entry whose
 * mtime is after the moment the removal was asked is a writer the reap could not see — 241's failure
 * — and one whose mtime is before it is a slow unlink, which is a different question entirely.
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
        // ⛔ **A clock that MOVES**, because a constant one cannot tell "stamped when asked" from
        // "stamped when it answered" — both would read 1,000 and the row would be a no-op that
        // recorded as a survivor. The removal walk is the slow part; these are its two ends.
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
    // ⛔ It names what to LOOK for and does not assert whose process it was — nothing here
    // establishes that, and a line that did would send a reader looking for the wrong thing.
    expect(thrown.message).toContain('a process it never owned')
    expect(thrown.message).not.toContain('this check launched')
    // ⛔ The age is per entry and measured from the ASK, so the two late writes carry their own
    // offsets and the one that predates the ask carries none.
    expect(thrown.message).toContain('logs_2.sqlite ← written 9ms AFTER the removal was asked')
    expect(thrown.message).toContain('logs_2.sqlite-wal ← written 7ms AFTER the removal was asked')
    // ⛔ …and the entry written BEFORE the ask carries no offset at all: the whole line, so this
    // cannot be satisfied by a neighbouring one that happens to end in the same word.
    expect(thrown.message).toContain('\n   · provider-homes/default/default/codex\n')
    // ⚠️ The original is not discarded — a `cause` is what a reader follows to the syscall.
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
   * 🔴 **360 · a directory's mtime is our own footprint, and the sentence used to call it a writer.**
   *
   * ⛔ **`rmSync` removing an entry sets its parent's mtime**, so a removal that gets part-way
   * through stamps every directory it emptied with a time at or after the ask. Measured on this
   * machine with no process running at all — a tree whose deepest directory is `0500` — one of four
   * survivors reported as *"written AT OR AFTER … so something was still WRITING"*. On a `codex`
   * provider home, whose `skills/.system` tree alone is dozens of directories, that arithmetic is
   * most of the count, and it is what sent this dispatch looking for a process on the strength of
   * its own footprints.
   *
   * ⚑ **The pair is the point.** The directory below carries a LATER mtime than the file, so a rule
   * that read "the latest thing wins" would still accuse it; only `isDirectory` tells them apart.
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
   * ⚑ **The paired positive, and it must differ from the default.** The same shape with the LATE
   * entry marked a file has to reach the other sentence — otherwise the test above passes over a
   * function that never accuses anything, which is not the rule being asserted.
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
   * 🔴 **387 · the millisecond `Date.now()` throws away, and who pays for it.**
   *
   * ⛔ **`Date.now()` floors to the integer millisecond and an mtime does not.** The ask happened at
   * some real instant inside `[askedAt, askedAt + 1)`, so a file stamped anywhere in that same
   * millisecond was written before the ask as often as after it — and until 387 every one of them
   * was reported as *"written 0ms AFTER the removal was asked — so something was still WRITING"*.
   *
   * ⚠️ **Measured**: 200 files, each written and then followed by a `Date.now()` reading, on Node 20
   * and Node 24 alike — **193 of 200** carried an `mtimeMs` at or above a stamp taken AFTER the
   * write (median `+0.49ms`). ⛔ That is 360's false accusation arriving by arithmetic instead of by
   * directories, and it is what made the real-directory fixture below accuse three files on a
   * runtime where the removal could not remove them.
   *
   * ⚑ **The pair below is the rule**: inside the ask's own millisecond accuses nobody, a whole
   * millisecond later still does.
   */
  it("⛔ a file stamped inside the ask's OWN millisecond is not a writer", () => {
    expect(() =>
      tearDownAndRemove({
        lifecycle: complete,
        directory: '/tmp/brobot2-window-floor',
        remove: enotempty,
        now: () => 5_000,
        // ⚠️ A fractional mtime is not a contrivance: `lstat().mtimeMs` is a float and every real
        // survivor has one. This is the value a file written 0.4ms BEFORE the ask reports.
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
   * ⛔ **387 · the headroom is on the ACCUSATION only, and this is the other half of that.**
   *
   * A directory's late mtime does not accuse anybody — it explains, *"this removal emptied it"*
   * (360). ⚠️ Applying the millisecond here as well was measured and rejected: the real-directory
   * fixture lost the clause in **4 of 10 runs on Node 24**, because a whole failed removal fits
   * inside one millisecond and the footprint it left then reads as too early to mention. ⛔ Both
   * errors have to fall the same way — toward accusing nobody — and that is not the same threshold
   * on both sides.
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
   * ⛔ **360 · the one line that carries the claim must survive the cap.**
   *
   * ⚠️ **`MAX_SURVIVORS_SHOWN` is 25 and a `codex` provider home is dozens of directories.** In walk
   * order the single late FILE can sit past the cut, so the message would say *"something was still
   * WRITING"* and then print twenty-five directories, none of which is the thing it is talking
   * about. ⚑ The writers go first; everything else keeps its walk order behind them.
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
    // ⚑ …and it says what the other forty are, rather than leaving the count to be misread as
    // forty-one writers — which is the sentence this dispatch was named after.
    expect(thrown.message).toContain('40 more survivors are directories whose mtime this removal')
    expect(thrown.message).toContain('imagegen/SKILL.md ← written 20ms AFTER')
    // ⛔ The cap still admits to itself, and it is the DIRECTORIES that fall off the end now.
    expect(thrown.message).toContain('16 more, counted but not shown')
  })

  /**
   * ⛔ **360 · a teardown that could not say what it owns removes nothing**, and the refusal is the
   * reason rather than a pid. ⚠️ The lifecycle below reports `complete: false` with EVERY pid list
   * empty, which is exactly the shape `refused` exists for: nothing is running, and the question of
   * what was running could not be asked.
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
    // ⛔ A pointer clause is a claim: *"listed below"* asserts the list is the set. This one shows
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
 * ⛔ **The hazard on the path the code walks** — a real directory, the real `rmSync`, the real walk.
 *
 * ⚠️ A fixture that hands `tearDownAndRemove` a stub `remove` proves the message and nothing about
 * the removal. This one makes the removal fail the way a filesystem makes it fail, and lets the
 * default survivor walk find what is actually left.
 */
// These refusal witnesses use POSIX chmod to prevent directory removal.
describeOnPosix('tearDownAndRemove · against a real directory it cannot empty', () => {
  const made = []

  /**
   * ⛔ **Unlock every directory under `root`, not the one this suite happens to name** (387).
   *
   * ⚠️ Until 387 this cleanup did `chmod 0700` on `<root>/locked` and nothing else, so a fixture
   * whose unremovable directory sits four levels down — the `codex` provider-home shape below — was
   * beyond it, and the `rmSync` after it threw. **A failing test therefore leaked its whole tree**,
   * and the `afterEach` failed on the way out, which reads as a second broken test.
   *
   * 🔴 Measured on this machine, 2026-09-08: `$TMPDIR` held **61 `brobot2-teardown-*` trees**, one
   * per run of this suite that went red — 22 of them from the runs that opened this dispatch and
   * the rest from its own Node 20 and 22 reproductions. ⚑ A test's cleanup has to survive the test
   * failing, or the failure grows a second symptom that outlives it.
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
    // ⛔ r-x: the entry can be listed and never unlinked, so `rmSync` throws from inside the walk
    // exactly as it does when it loses a race — and the survivor walk still has to read it.
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
    // ⛔ And nothing has been removed out from under it — 325's rule, on the failure path.
    expect(readFileSync(join(root, 'locked', 'held.sqlite'), 'utf8')).toBe('x')
  })

  /**
   * **A `codex` provider home, the shape that makes the removal fail part-way through.**
   *
   * ⚑ **Hoisted out of the test below by 387**, which needed the same tree twice — once with
   * nothing writing, and once with a writer that touched a survivor. ⛔ One copy, because two would
   * be free to disagree about what *"the same tree"* means, and the pair only measures anything if
   * the ONLY difference between them is the writer.
   *
   * ⚠️ **Every entry is pushed a minute into the past, files included.** Until 387 the three
   * `skills/*.md` files were left at their write time, and the fixture got away with it only
   * because a runtime whose `rmSync` makes partial progress removes them before the survivor walk
   * can see them. On a runtime that removes nothing they survive stamped at the ask, and the test
   * that exists to prove *"no writer is accused"* accused three — measured, `node v20.19.3`, 3 of 8
   * runs. 🔴 **A fixture must not depend on the subject removing its evidence.**
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
    // ⚠️ **`utimesSync` rather than a sleep**: a fixture written a millisecond before the ask shares
    // its clock tick — `Date.now()` floors and an mtime does not — and a test that flakes on the
    // boundary it is testing proves nothing. 387 measured that collision at 193 of 200 writes.
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
    // ⛔ r-x: `held.sqlite` can be listed and never unlinked, so the removal fails from inside the
    // walk exactly as it does when it loses a race.
    chmodSync(locked, 0o500)
    return { root, locked, held: join(locked, 'held.sqlite'), codex }
  }

  /**
   * ⛔ **The precondition this fixture cannot establish for itself, said out loud** (387 §4).
   *
   * `rmSync` is the JS `rimraf` on Node 20 and 22 and a C++ binding on 24. **The JS one throws on
   * the first failed unlink and empties nothing**; the binding carries on and empties what it can.
   * ⚠️ Measured on this machine, same fixture, `held.sqlite` locked away behind `0500`:
   *
   * ```
   *   v20.19.3 / v22.22.0   EACCES     10 survivors   0 directories emptied
   *   v24.0.2               ENOTEMPTY   6 survivors   1 directory emptied  ← the footprint to misread
   * ```
   *
   * ⛔ **So a runtime below the one this repo declares has no footprint for the test below to be
   * about**, and the test would assert its conclusion with its own premise false — which is how it
   * spent two days red while `owned-teardown.mjs` and its suite were byte-identical to the commit
   * that shipped them. ⚑ `scripts/engine-check.mjs` refuses the whole gate first; this says the
   * same thing where the dependence actually lives, so a direct `vitest` run names it too.
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
   * 🔴 **360 · the false accusation, reproduced on a real filesystem with nothing running.**
   *
   * ⛔ **`rmSync` bumps the mtime of every directory it empties**, so a removal that gets part-way
   * through leaves its own footprints looking exactly like a writer's. ⚑ There is no process in
   * this test at all — every survivor was written a minute ago, so the only entry that can carry a
   * post-ask time is one the removal itself stamped.
   *
   * ⚠️ **What this asserts is the CLASSIFICATION, and 387 took one sentence out of it.** The exact
   * wording of the clause is pinned upstairs against injected survivors, where it is a fact about
   * the message and nothing else; down here the same pin was also a bet on how far `rmSync` got.
   * ⛔ The pair that matters is this test and the one under it: **no writer accused when nothing
   * wrote, and a writer accused when something did.**
   */
  it('⛔ does not accuse a writer when the only late mtimes are directories it emptied itself', (ctx) => {
    // ⚠️ **darwin only** (T-001): its premise is how far the Mac's `rmSync` gets before a locked folder stops it; on ext4 it empties nothing.
    // CI runs on Linux and skips it; the Mac's own gate runs it.
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
    // ⛔ The claim this dispatch came from, and it must not be made here.
    expect(thrown.message).not.toContain('something was still WRITING')
    expect(thrown.message).toContain('NO surviving file was written after it was asked')
    // ⛔ **The premise, asserted rather than assumed**: the removal really did empty a directory, so
    // the line above is the answer to a question that was actually put. ⚠️ Without this the test
    // passes on a tree the removal never touched, which is the state it spent two days failing in.
    expect(thrown.message).toMatch(
      /· provider-homes\/default\/default\/codex ← a directory whose mtime moved \d+ms after the ask/,
    )
    // ⚑ …and every entry the message flags is a directory. This is the classification the title is
    // about, said over the whole list rather than over one sentence: nothing here may be flagged as
    // written, whatever the removal got through.
    const flagged = [...thrown.message.matchAll(/^ {3}· (\S+) ← (.+)$/gm)]
    expect(flagged.length).toBeGreaterThan(0)
    expect(flagged.filter(([, , tail]) => tail.startsWith('written '))).toEqual([])

    // ⚠️ This fixture's unremovable directory is deeper than the shared `afterEach` reaches, so it
    // unlocks its own — a test that leaves a `0500` tree behind takes the NEXT one down with it.
    chmodSync(locked, 0o700)
  })

  /**
   * ⚑ **387 · the paired positive, on the same real tree** — and it has to differ from the default.
   *
   * ⛔ **An assertion with no failing case is a comment.** The test above says *"no writer accused"*
   * about a function that could simply never accuse anybody; this is the same fixture with the one
   * fact changed that must flip it, so the pair measures the rule rather than the silence.
   *
   * ⚠️ **`utimesSync` into the future is what a writer looks like to this code**, and that is not a
   * shortcut: the survivor walk reads `lstat().mtimeMs` and nothing else, so *"a file stamped at or
   * after the ask"* IS the observation a live writer produces. ⛔ Spawning a process that races the
   * walk would measure the scheduler instead, and the reap has already reported complete — a real
   * process here would contradict the fixture's own premise.
   */
  it('⚑ …and a real surviving FILE stamped after the ask still is accused', (ctx) => {
    // ⚠️ **darwin only** (T-001): its premise is how far the Mac's `rmSync` gets before a locked folder stops it; on ext4 it empties nothing.
    // CI runs on Linux and skips it; the Mac's own gate runs it.
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
    // ⛔ …and it names the file, first, ahead of the directories the removal stamped itself — the
    // one line a reader needs is not allowed to sit behind the footprints.
    expect(thrown.message).toMatch(
      /· provider-homes\/default\/default\/codex\/locked\/held\.sqlite ← written \d+ms AFTER the removal was asked/,
    )
    // ⚑ …and the removal's own footprint is still named as one, in the same message: the two
    // claims coexist and are not one verdict about the latest mtime.
    expect(thrown.message).toContain('whose mtime this removal moved itself, which is evidence of')

    chmodSync(locked, 0o700)
  })

  it('names a directory it cannot even list rather than throwing while describing a failure', () => {
    const root = mkdtempSync(join(tmpdir(), 'brobot2-teardown-'))
    made.push(root)
    mkdirSync(join(root, 'locked'))
    writeFileSync(join(root, 'locked', 'held.sqlite'), 'x')
    // ⚠️ **Pushed into the past before the mode changes** (360). A fixture written a millisecond
    // before the removal is asked can share its clock tick, and this test now asserts what the
    // message does NOT say about mtimes — an assertion that must not turn on the boundary it is
    // standing next to.
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
    // ⛔ **…and it is not evidence of a process** (360). An entry whose mtime could not be read has
    // no time to compare, so it must fall on the side that accuses nobody — stamping the walk's own
    // clock here would turn a permissions problem into *"something was still WRITING"*, which is the
    // sentence this dispatch spent its first hour disproving.
    expect(thrown.message).not.toContain('something was still WRITING')
    // ⛔ …and not from the other direction either: nothing was unlinked in this fixture, so the
    // clause that explains a moved directory mtime has nothing to explain and must not appear.
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
 * ⛔ **…and the removal is still the plain one** (333 §3.2).
 *
 * The tempting fix for an intermittent `ENOTEMPTY` is `maxRetries` — and it would make every one of
 * these failures green while the directory of a live app came off underneath it. `241` is what that
 * costs and `066` is what it then perturbs. The remedy is upstream: `complete` waits for the process
 * table, so there is nothing left to race.
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
 * ⛔ **…and the instruments actually go through it** — the rule above is worth nothing if a check
 * keeps its own copy of the removal.
 *
 * ⚠️ **Being in `ci` covers a check going red when the product breaks; it does not cover the check
 * being quietly rewritten.** This is that sentence said about the teardown, which `ci` cannot see at
 * all — a green run and a run that removed a live app's directory look identical from outside.
 *
 * ⚑ **Every Electron gate, since 326.** `325` fixed `fixture:check` and wrote down why it left the
 * other two: `window:check` had the same teardown character for character, and `quit:check` had it
 * plus a sampling loop that reported the machine. Both are through this module now, so the pins are
 * a table rather than a file. ⚠️ `fixture:check` left the chain at D-016 with the demo seed it
 * followed.
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
    // ⛔ `refreshDescendants` is a no-op once the launcher is gone and `remember()` refuses a pid
    // whose parent it never saw, so a crash between the app appearing and the teardown would leave
    // Electron helpers that nothing has authority to signal.
    expect(check.split('lifecycle.refreshDescendants()').length - 1).toBe(1)
  })

  /**
   * 🔴 **360 · the third answer has to reach the person reading the red line.**
   *
   * ⛔ **A guard only a live run can trip is dark by default** (310, which broke `smoke:ui` step 31
   * where `ci` could not see it). `outcome.refused` is populated only when a real teardown cannot
   * freeze a real tree — something no unit test on this machine will ever cause and `ci` will
   * almost never see. ⚠️ So the thing `ci` CAN check is that the gate still says it: a report that
   * drops the clause turns a refusal into a bare *"could not reap"*, with the one sentence that
   * says WHY missing.
   *
   * ⚑ Asserted on the call and the arithmetic rather than on the word, because the word is in the
   * prose above it in every one of these files.
   */
  it('says what the teardown refused to decide about, not only which pids it counted', () => {
    expect(check.split('refusals(outcome)').length - 1).toBe(1)
    expect(check).toContain('outcome.refused.length === 0')
    expect(check).toContain('outcome.refused.map((why)')
  })

  it('has no removal of the user-data directory anywhere BELOW the launch', () => {
    // ⛔ Positional, not a bare absence (316): the pre-launch `sun_path` guard removes the directory
    // too and must keep doing so — nothing has been started at that point. What may not exist is a
    // second removal after the `spawn`, because that is the one that can race the app. A row that
    // puts `rmSync(userDataDir, …)` back into a teardown goes red here and only here.
    expect(launchedAt).toBeGreaterThan(0)
    const removals = [...check.matchAll(/rmSync\(userDataDir/g)].map((m) => m.index)
    expect(removals).toHaveLength(1)
    expect(removals[0]).toBeLessThan(launchedAt)
  })

  it('names a pid still on its way out as its own fact on the red line', () => {
    // ⚑ 333: `remaining` is an app still RUNNING (241) and `exiting` is one that outlasted the
    // reap's bound leaving the table. Folding the second into the first would send a reader looking
    // for a leak; dropping it would put the gate back where this dispatch found it.
    expect(check).toContain('outcome.exiting.length > 0')
    expect(check).toContain('are still in the process table on their way out')
  })

  it('does not let the teardown REPLACE the failure it was reporting', () => {
    // 🔴 325, found reviewing its own diff: an `rmSync` that threw from inside the catch would
    // overwrite the real error with itself — the exact shape of the merge failure 325 was
    // dispatched for. Every one of these calls the teardown from inside a `try`.
    expect(check).toContain('…and the teardown itself failed: ${teardownFailure.message}')
  })
})
