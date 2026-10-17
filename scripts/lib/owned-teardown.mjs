/**
 * Remove a launch's data directory only after owned processes are verified gone, including
 * processes still in the table during teardown. A released debug port describes one listener,
 * not renderer, GPU, utility or detached provider children still flushing into the directory.
 * Observation failures cannot count as an empty process set.
 *
 * `owned-process.mjs` captures launch identities, revalidates before signalling, and waits
 * on `pid` plus `lstart` to recognise dying processes whose names changed. If teardown cannot
 * establish completion, keep the directory and report it. Retrying removal before completion
 * would hide the ownership and ordering failure.
 */
import { execFileSync } from 'node:child_process'
import { lstatSync, readdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'

/**
 * How many surviving entries a failed removal names. ⚠️ **A cap the sentence has to admit to**: the
 * count below is uncapped and the list is not, so the message says how many it is SHOWING of how
 * many there are rather than pointing at a list as if it were the set.
 */
const MAX_SURVIVORS_SHOWN = 25

/**
 * 🔴 **The millisecond `Date.now()` throws away, and which of the two claims has to pay for it**
 * (387).
 *
 * ⛔ **`Date.now()` floors to the integer millisecond and an mtime does not**, so the two sides of
 * `mtimeMs >= askedAt` are not on the same scale. The ask happened at some real instant inside
 * `[askedAt, askedAt + 1)`, and an entry stamped anywhere in that same millisecond is **written
 * before the ask as often as after it** — the comparison cannot tell which.
 *
 * ⚠️ Measured on this machine, 200 files each written and then immediately followed by a
 * `Date.now()` reading: **193 of 200 carried an `mtimeMs` at or above a stamp taken AFTER the
 * write** (median `+0.49ms`, max `+0.98ms`), on Node 20 and Node 24 alike. ⛔ Every one of those
 * would have been reported as *"written 0ms AFTER the removal was asked — so something was still
 * WRITING"*, which is 360's false accusation arriving by arithmetic instead of by directories.
 *
 * ## ⚑ Headroom on the accusation, none on the exoneration
 *
 * ⛔ **Only the FILE rule gets the millisecond**, and the asymmetry is the point rather than an
 * oversight:
 *
 * - A file's late mtime **accuses**, so it has to be certain: `mtimeMs >= askedAt + 1` is the whole
 *   of *"strictly later than any instant the ask could have been"*.
 * - A directory's late mtime **explains** — *"this removal emptied it, and it is evidence of
 *   nothing"* (360). Being generous there accuses nobody; being strict there would drop the clause
 *   on exactly the fast failures where the survivor list most needs it. Measured: with the
 *   millisecond applied to both, the real-directory fixture below lost the clause in **4 of 10 runs
 *   on Node 24**, because the whole removal fit inside one millisecond.
 *
 * ⚑ **Both errors fall the same way — toward accusing nobody** — which is the rule the
 * unreadable-mtime branch of {@link defaultSurvivors} already follows. ⛔ And the headroom costs
 * nothing real: the removal is asked seconds after a reap that waited for the process table, and a
 * writer racing that walk keeps writing for as long as the walk lasts.
 */
const A_WHOLE_MILLISECOND = 1

/**
 * The `ppid` edges of the whole process table.
 *
 * ⚠️ Two fields, not `command`: this is the input to a BFS, and a command string with embedded
 * whitespace is exactly what makes such a parse silently drop rows.
 */
export function readProcessTable() {
  return execFileSync('ps', ['-A', '-o', 'pid=,ppid='], { encoding: 'utf8' })
}

/**
 * Every descendant of `root`, **parents before children**.
 *
 * ⛔ The order is a contract, not a detail: `createOwnedProcessLifecycle`'s `remember()` accepts a
 * pid only when its parent is already remembered or it shares the launcher's group, so a child
 * offered before its parent is refused and the helper it leads is never signalled.
 *
 * ⚠️ Electron is five processes and none of them carries the user-data-dir in its argv below the
 * browser, so an enumeration by command line — the shape three instruments used — cannot see the
 * helpers at all. Ancestry can.
 */
export function descendantsOf(root, { readTable = readProcessTable } = {}) {
  const children = new Map()
  for (const line of readTable().split('\n')) {
    const match = /^\s*(\d+)\s+(\d+)\s*$/.exec(line)
    if (match === null) continue
    const pid = Number(match[1])
    const parent = Number(match[2])
    if (!children.has(parent)) children.set(parent, [])
    children.get(parent).push(pid)
  }
  const found = []
  // ⛔ **`seen` is what makes this terminate**, and it is not defensive dressing: the table is TEXT
  // read from a live `ps`, so a torn read can name a parent that is also a descendant, and a walk
  // without it never returns — a teardown that hangs removes nothing and reports nothing. ⚠️ A
  // separate `pid === parent` guard was written here first and a mutation row proved it dead: the
  // self-parent case is the one-element cycle this already covers.
  const seen = new Set([root])
  const queue = [root]
  while (queue.length > 0) {
    for (const pid of children.get(queue.shift()) ?? []) {
      if (seen.has(pid)) continue
      seen.add(pid)
      found.push({ pid })
      queue.push(pid)
    }
  }
  return found
}

/**
 * ⛔ **Reap what we launched, and only then remove where it was writing.**
 *
 * Returns the lifecycle's own outcome with `removed` added, so a caller can report the two facts
 * separately: whether the app is gone, and whether its directory came off. ⚠️ They are not the same
 * fact, and a gate that reports only the second is the gate that started this dispatch.
 *
 * @param {object} options
 * @param {{ kill9: () => { complete: boolean } }} options.lifecycle a lifecycle handle
 * @param {string} options.directory the user-data directory the launch was writing into
 * @param {(path: string) => void} [options.remove] injected for the test; default is the real one
 * @param {(path: string) => { path: string, mtimeMs: number, isDirectory?: boolean }[]}
 *   [options.survivors] what is left after a removal that threw; injected for the test, and only
 *   ever called on that path. ⚠️ `isDirectory` decides whether an entry's mtime can carry the
 *   writer claim at all — see {@link describeFailedRemoval}
 * @param {() => number} [options.now] the clock the survivor ages are measured from
 */
export function tearDownAndRemove({
  lifecycle,
  directory,
  remove = defaultRemove,
  survivors = defaultSurvivors,
  now = () => Date.now(),
}) {
  const outcome = lifecycle.kill9()
  // ⛔ The one ordering this module exists for. The removal sits below the reap and behind its
  // verdict, so a reader asking *"when does the directory come off?"* finds the condition on the
  // line above the answer.
  //
  // ⚑ **`complete` now carries a third way of being false** (360): `outcome.refused` is non-empty
  // when the reap could not freeze the tree it was about to enumerate, so it cannot say what it
  // owns. ⚠️ The condition below is unchanged and that is the point — a teardown that does not know
  // what it owns must not remove anything, and it did not need a new branch here to say so.
  if (!outcome.complete) return Object.freeze({ ...outcome, removed: false })
  // ⚠️ Stamped when the removal is ASKED, never when it answers (326): every survivor's age below
  // is measured from this line, and a walk that took two seconds would otherwise make a file
  // written before the removal look like one written during it.
  const askedAt = now()
  try {
    remove(directory)
  } catch (error) {
    throw new Error(describeFailedRemoval(directory, askedAt, error, survivors), { cause: error })
  }
  return Object.freeze({ ...outcome, removed: true })
}

/**
 * 🔴 **A removal that failed, said in the only terms that can settle why** (333).
 *
 * ## ⛔ What this replaces, and why a bare `ENOTEMPTY` was not enough to act on
 *
 * The message this gate used to print was the whole of `rmSync`'s: *"ENOTEMPTY, Directory not empty:
 * …/brobot2-window-oAuZlk"*. Three re-runs were green, so it read as flake — and a gate that cries
 * wolf on its own cleanup is how the next real red gets waved through.
 *
 * ⚠️ **On Node 24 that path is the one `rmSync` was HANDED, never the directory whose `rmdir`
 * failed** — so it carries no information about where the race was, and reading it as if it did is
 * how an investigation starts in the wrong place. Measured on this machine, same fixture, a writer
 * racing the walk one level down:
 *
 * ```
 *   v22.22.0   ENOTEMPTY: directory not empty, rmdir '/tmp/rmv-I7qEso/deep'   ← the failing directory
 *   v24.0.2    ENOTEMPTY, Directory not empty: /tmp/rmv-6TaHm4 '/tmp/rmv-6TaHm4'
 * ```
 *
 * ⛔ `fs.rmSync` is the JS `rimraf` on 20 and 22 and a C++ binding on 24; the rewrite is where the
 * location went. This repo is on 24, and the second line is the shape of the message that opened
 * this dispatch, character for character.
 *
 * ⚑ **What does carry it is what is left and when it was written.** The reap has already reported
 * complete — which since 333 means every pid it owns has left the process table — so a FILE written
 * **certainly after** the moment the removal was asked is a WRITER, and one written before it is a
 * slow unlink. Those are different failures and they were arriving as one sentence. ⚠️ *Certainly*
 * is doing work in that sentence and 387 is why: `Date.now()` floors and an mtime does not, so the
 * millisecond the ask lands in belongs to neither side — see {@link A_WHOLE_MILLISECOND}.
 *
 * ## ⛔ A DIRECTORY's mtime is not that fact, and this said it was (360)
 *
 * Until 360 the filter below ran over every surviving entry, directories included, and the sentence
 * it printed was *"N of them written AT OR AFTER the moment it was asked — so something was still
 * WRITING"*. ⚠️ **Removing an entry from a directory sets that directory's mtime**, so a removal
 * that gets part-way through leaves a fresh mtime on every directory it emptied — its OWN work,
 * indistinguishable from a writer's. Measured on this machine, one fixture, **no process involved at
 * all**: a tree whose deepest directory is `0500` so the `unlink` inside it fails `EACCES`.
 *
 * ```
 *   rmSync threw: ENOTEMPTY, Directory not empty: …/A
 *     -1106ms  dir   <root>          ← untouched
 *   ← AFTER  +20ms  dir   B          ← rmSync removed D and E from it
 *     -1104ms  dir   B/C
 *     -1104ms  file  B/C/locked      ← the one thing that actually blocked the removal
 * ```
 *
 * ⛔ **One of four survivors reported as a writer, with nothing running.** On a tree the size of a
 * `codex` provider home — `skills/.system` alone is dozens of directories — that arithmetic is most
 * of the count, and the sentence it produced sent 360 looking for a process on the strength of its
 * own footprints. ⚑ **A file's mtime is untouched by unlinking its siblings**, so files are the only
 * survivors that can carry this claim, and directories are now reported as what they are.
 *
 * ⛔ **It says a writer, and stops there.** Whose it is, this cannot know: a descendant that appeared
 * after the last discovery is the reason to suspect first, but nothing here establishes that the
 * process was ours rather than something else on the machine reaching into a temp directory. ⚠️ The
 * two want different next steps, so the line names the fact and hands over the pids to look at.
 */
function describeFailedRemoval(directory, askedAt, error, survivors) {
  const left = survivors(directory)
  // ⛔ **Files only** — see the note above for the measurement that made this a filter rather than a
  // sentence about every entry. ⚠️ An entry with NO kind counts as a file: the only producer that
  // can omit it is an injected `survivors` double, and this keeps such a double saying what it said
  // before 360 rather than silently losing the claim.
  //
  // ⛔ **And the two thresholds differ on purpose** (387) — {@link A_WHOLE_MILLISECOND} carries the
  // measurement. A file's late mtime ACCUSES, so it has to clear the millisecond `Date.now()`
  // floors away; a directory's EXPLAINS, and being generous there accuses nobody.
  const written = left.filter(
    (entry) => entry.isDirectory !== true && entry.mtimeMs >= askedAt + A_WHOLE_MILLISECOND,
  )
  const stamped = left.filter((entry) => entry.isDirectory === true && entry.mtimeMs >= askedAt)
  // ⛔ **The writers first, because the cap is real** (360). `MAX_SURVIVORS_SHOWN` is 25 and a
  // `codex` provider home is dozens of directories — so the ONE file that carries the claim can sit
  // past the cut and never be printed, in the message somebody reads to find out what happened. The
  // rest keep their walk order, which is parents before children.
  const shown = [...written, ...left.filter((entry) => !written.includes(entry))].slice(
    0,
    MAX_SURVIVORS_SHOWN,
  )
  return (
    `could not remove ${directory}: ${error instanceof Error ? error.message : String(error)}\n` +
    `   ⛔ the reap reported COMPLETE and ${String(left.length)} entr${left.length === 1 ? 'y' : 'ies'} ` +
    `survived the removal` +
    (written.length > 0
      ? `, ${String(written.length)} of them FILES written AT OR AFTER the moment it was asked — so ` +
        `something was still WRITING, which the reap is supposed to have ruled out. Look for a ` +
        `process it never owned: a provider child spawned after the last descendant scan leads its ` +
        `own group and is reached by neither the group signal nor a remember() (241).` +
        (stamped.length > 0
          ? ` ⚠️ ${String(stamped.length)} more ` +
            `${stamped.length === 1 ? 'survivor is a directory' : 'survivors are directories'} whose ` +
            `mtime this removal moved itself, which is evidence of nothing (360).`
          : ``)
      : left.length === 0
        ? ``
        : ` and NO surviving file was written after it was asked, so this is a slow unlink rather ` +
          `than a writer` +
          (stamped.length > 0
            ? ` — the ${String(stamped.length)} ` +
              `${stamped.length === 1 ? 'directory carrying a later mtime is' : 'directories carrying a later mtime are'} ` +
              `this removal's own unlinks and say${stamped.length === 1 ? 's' : ''} nothing about a ` +
              `writer (360)`
            : ``) +
          `.`) +
    `\n` +
    (left.length === 0
      ? `   ⚠️ …and nothing is left under it now, so whatever held it let go between the throw and ` +
        `this line. The removal is still a failure: it is the state at the throw that matters.`
      : shown
          .map(
            (entry) =>
              `   · ${entry.path}${
                // ⛔ **The line is derived from the two lists the summary counted** (387), not from
                // a third reading of the same mtimes. A per-entry rule written out again is a
                // second place for the answer to live, and 360's M17 is the row that says what it
                // costs: a summary and a list under it that say different things.
                written.includes(entry)
                  ? ` ← written ${String(Math.round(entry.mtimeMs - askedAt))}ms AFTER the removal was asked`
                  : stamped.includes(entry)
                    ? ` ← a directory whose mtime moved ${String(Math.round(entry.mtimeMs - askedAt))}ms after the ask; our own unlinks do that (360)`
                    : ''
              }`,
          )
          .join('\n') +
        (left.length > shown.length
          ? `\n   … ${String(left.length - shown.length)} more, counted but not shown`
          : '')) +
    `\n   ⛔ The directory is LEFT IN PLACE. Do not re-run and call it green: this failure is ` +
    `intermittent by construction, and a second run proves nothing about the first.`
  )
}

/**
 * Every path still under `directory`, with its mtime, parents before their children.
 *
 * ⚠️ **It must not be able to throw**: this runs inside the report for a failure that has already
 * happened, and an instrument that fails while describing a failure replaces the subject with
 * itself — 325's defect, one layer in. A directory that cannot be read is named as such and the
 * walk goes on.
 */
function defaultSurvivors(directory) {
  const found = []
  const walk = (dir, relative) => {
    let entries
    try {
      entries = readdirSync(dir)
    } catch (error) {
      found.push({
        path: `${relative}/ (could not be listed: ${errorCode(error)})`,
        mtimeMs: 0,
        isDirectory: true,
      })
      return
    }
    for (const name of entries) {
      const full = join(dir, name)
      const path = relative === '' ? name : `${relative}/${name}`
      let stats
      try {
        stats = lstatSync(full)
      } catch (error) {
        found.push({
          path: `${path} (gone while being listed: ${errorCode(error)})`,
          mtimeMs: 0,
          isDirectory: false,
        })
        continue
      }
      found.push({ path, mtimeMs: stats.mtimeMs, isDirectory: stats.isDirectory() })
      if (stats.isDirectory()) walk(full, path)
    }
  }
  walk(directory, '')
  return found
}

function errorCode(error) {
  return error && typeof error === 'object' && 'code' in error ? String(error.code) : 'unknown'
}

/**
 * ⛔ **No `maxRetries`, and that is the point** (333 §3.2). `rmSync(..., { maxRetries })` sleeps and
 * tries again, which would turn every one of these failures green while the directory of a live app
 * came off underneath it — the same defect, hidden, and `241`/`066` are what it costs. The remedy is
 * upstream: `complete` now means the processes are out of the table, so there is nothing left to
 * race. `force` stays for `ENOENT` alone.
 */
function defaultRemove(directory) {
  rmSync(directory, { recursive: true, force: true })
}
