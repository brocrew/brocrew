#!/usr/bin/env python3
"""240's mutation table — each row is THE DEFECT, put back verbatim (131).

240 is three residuals, all named by the dispatches that created them and all in `packages/runtime`.

**§1 — the teardown that waited for the leader.** `233` published `SpawnCodexTransport.exited` and
stated its own limit: it is the LEADER's exit. What nobody had measured is what that limit costs.
Every grace inside `doReapGroup` was an `awaitExit`, which races `exited` — already settled the
moment the leader dies — so SIGTERM and SIGKILL went out ~1 ms apart and `close()` returned without
ever asking about the group. Measured on `20110e0`: a descendant alive when `close()` resolved in
every in-group row, and **no descendant ever running its own SIGTERM handler**, including the
cooperative one that would have exited on it.

**§2 — the release that unlinked by path.** `238` fixed the BREAK and left the release
unconditional, which is two defects in one line: it could destroy a live lock another process had
taken, and — 238 §3's own residual — it could leave a lockfile whose holder had finished, stamped
with a live pid, unbreakable for the rest of that process's life.

**§3 — the error one clause poorer.** Owning the Claude spawn empties the SDK's `stderrTail`, so the
`. stderr: …` clause vanished from the fatal error a person reads. `233` named it and left it.

The row groups:

 * `M1`-`M4`   🔴 **§1: the group stops being watched** — the defect verbatim at the SIGTERM grace,
               the same at the final grace, the quiet check itself answering `true` over a live
               group, and the no-process shortcut inverted so a failed spawn waits four seconds for
               a group nobody made.
 * `M5`-`M8`   🔴 **§2: the release stops identifying anything** — the unconditional unlink verbatim,
               the stamp left on a released lock, the identity check dropped, and the
               over-correction that never unlinks at all.
 * `M9`-`M12`  ⛔ **§3: the clause** — removed from the stream-ended ending, removed from the THROWN
               ending only (the one-of-N-call-sites shape), appended when there is nothing to say,
               and let loose unbounded.
 * `M13`-`M14` ⚑ **`233`'s fact, guarded where `233`'s own table does not reach it.** ⚠️ **240
               retires NOTHING — the census says so** (1310 rows, 62 tables, 126 retired, the same
               126 as before this table existed), and the first draft of this file claimed two of
               `233`'s rows had retired here. They had not: `233` M14 anchors on `onExit`'s three
               lines, which §1 does not touch. These two mutate what no row anywhere mutates — the
               CONSTRUCTION of `exited` (a promise wired to a timer is 229 H1's *a bound became the
               receipt*, in its purest form) and its spawn-error branch.

## ⛔ What this table cannot reach, stated because a table silent about its edges is claiming them

 * ⛔ **No row makes `groupIsQuiet` read `EPERM` as quiet.** That branch exists for a process group
   id that has been recycled to somebody else's group, and nothing on this machine can construct
   one: it needs the leader's pid to be reaped, reused, AND made a group leader inside one teardown.
   The branch is conservative by construction — it reads "not ours to signal" as "still running",
   which costs a bounded wait — and it is recorded here as un-killable rather than left in the table
   as a survivor.
 * ⛔ **No row removes the `console.warn` after the final grace**, because nothing can make it fire.
   It reports a group with a member still in it after SIGKILL plus a full grace, which needs an
   unkillable process (D-state, blocked in the kernel). A row for it would be a claim wearing an
   artefact's clothes.
 * ⛔ **No row makes the SIGKILL unconditional again.** It was unconditional before 240 and skipping
   it over a group already proven empty is a pid-reuse hardening, not a behaviour any test can
   observe: the signal either lands on an empty group (ESRCH, no effect) or is not sent.
 * ⛔ **No row separates `dev` from `ino` in the release's identity check.** Both come from one
   `fstat` of a descriptor we still hold, so no construction can make them disagree — a held
   descriptor pins the inode. `M7` mutates the comparison as a whole.
 * ⚠️ **The escaped-descendant test (`setsid`) kills nothing and is not meant to.** It asserts a GAP
   — that a descendant which left the process group survives and is invisible — so every mutation
   below leaves it green. It is in the suite to pin the contract, and it is named here so its
   greenness is never read as coverage.
 * **`desktop`, `dom` and `scripts` are expected GREEN on every row.** 240 touches only
   `packages/runtime`.

## ⚑ The killing test for every row, named before the table was run, and CHECKED after

⚠️ Every entry below was verified by applying the row and watching the named test go red — 238's
lesson, where two rows stayed green beside prose saying they must die.

`M1` `240 gives an in-group descendant a real interval` **and** `does not resolve close() while a
stubborn descendant is still in the group` · `M2` `…does not resolve close() while a stubborn
descendant is still in the group` (only that one: the SIGTERM grace still waits, so the marker gets
written and the slow-clean row stays green — worth knowing, because it is what tells the two graces
apart) · `M3` the same two as `M1`, **plus** `074 stops reporting a PID once the child is gone`,
which is collateral and is recorded rather than filtered: a teardown that stops waiting returns
before the child's own `exit` has been delivered · `M4` `240 does not wait for the group of a process
that never started` (4 022 ms, which is `killGrace × 2` to the millisecond) ·
`M5` both §2 rows · `M6` `§2 a lockfile restored after its holder released does not outlive that
holder` · `M7` `§2 a release leaves a lock that somebody else took while we were inside fn()` ·
`M8` `§2 while an ordinary release still removes the lock it did create`, **plus** `027 takes an
exclusive per-home lock`, `202 a lock left by a DEAD process is broken` and `238 §2 two processes
racing an aged empty sidecar` — a release that unlinks nothing wedges the whole family, which is
what makes it the shape a careless fix produces ·
`M9` `§3 appends what the CLI said on its way out` **and** `§3 bounds the clause` ·
`M10` `§3 on the OTHER unexpected ending: a stream that throws rather than closing` ·
`M11` `§3 says nothing extra when the child said nothing` · `M12` `§3 bounds the clause` ·
`M13` `233 settles on the process, not on the teardown that would have reaped it` ·
`M14` `233 settles when no process ever ran, rather than hanging a quit forever` **and** `240 does
not wait for the group of a process that never started`.
"""

from pathlib import Path

TRANSPORT = "packages/runtime/src/codex/codex-transport.ts"
HOME = "packages/runtime/src/internal/provider-home.ts"
CLAUDE = "packages/runtime/src/claude/claude-runtime.ts"

# (name, [(file, old, new), ...])
MUTATIONS = [
    # ---- §1 · the group stops being watched -------------------------------------------------------
    (
        "M1 · 🔴 THE DEFECT, verbatim (233's stated limit) · the SIGTERM grace goes back to racing "
        "the LEADER's exit, which is already settled — so SIGTERM and SIGKILL leave together and no "
        "descendant of ours ever gets an instant to shut down",
        [
            (
                TRANSPORT,
                "    if (await this.awaitGroupQuiet(this.opts.killGraceMs)) return\n"
                "    // ⚑ **Only if something is still there.**",
                "    await this.awaitExit(this.opts.killGraceMs)\n"
                "    // ⚑ **Only if something is still there.**",
            )
        ],
    ),
    (
        "M2 · ⛔ …and the same at the FINAL grace · `close()` resolves the moment the leader is gone, "
        "over a group that is still being killed — which is what the host reads as *everything it "
        "created is confirmed down*",
        [
            (
                TRANSPORT,
                "    if (await this.awaitGroupQuiet(this.opts.killGraceMs)) return\n    console.warn(",
                "    await this.awaitExit(this.opts.killGraceMs)\n    if (false) console.warn(",
            )
        ],
    ),
    (
        "M3 · 🔴 the question is asked and the answer is thrown away · a group with a live member "
        "reads as quiet, so every grace returns at once and the teardown is back where 240 found it",
        [
            (
                TRANSPORT,
                "      process.kill(-pid, 0)\n      return false",
                "      process.kill(-pid, 0)\n      return true",
            )
        ],
    ),
    (
        "M4 · ⛔ a spawn that never produced a process waits for its group anyway · four seconds "
        "added to a quit over a child that never existed — 233's point, on the teardown's side",
        [
            (
                TRANSPORT,
                "    if (pid === undefined) return true // nothing was ever spawned",
                "    if (pid === undefined) return false // nothing was ever spawned",
            )
        ],
    ),
    # ---- §2 · the release stops identifying anything ----------------------------------------------
    (
        "M5 · 🔴 THE DEFECT, verbatim (238 §3) · the release unlinks by PATH again, so a lock its "
        "holder never created is destroyed and a lock its holder DID create is left signed by a "
        "live pid — the two halves of one unconditional line",
        [
            (
                HOME,
                "  } finally {\n    releaseLock(fd, lockPath)\n  }",
                "  } finally {\n    closeSync(fd)\n    try {\n      unlinkSync(lockPath)\n    } catch {\n"
                "      // best-effort release\n    }\n  }",
            )
        ],
    ),
    (
        "M6 · ⛔ the stamp is not retracted · a lockfile that outlives its own release still names a "
        "running process, and `ownerIsGone` asks `kill(pid, 0)` — so the home is locked for the life "
        "of the app rather than for two seconds",
        [
            (
                HOME,
                "  try {\n    ftruncateSync(fd, 0)\n  } catch {",
                "  try {\n    void fd\n  } catch {",
            )
        ],
    ),
    (
        "M7 · ⛔ the identity check is dropped and the truncate kept · the release goes back to "
        "removing whatever is at the path, including the live lock a contender took while we were "
        "inside `fn()`",
        [
            (
            # ⚑ **W4.789 · re-anchored in place, not retired** — the lock's identity is read as exact integers (`{ bigint: true }`, `isTheSameFile`), so a file number past 2^53 on Windows is not rounded; the fault is unchanged. Source-only, NOT VERIFIED (provisioning-lock code: running it needs a sealed lift).
                HOME,
                "  if (!isTheSameFile(atPath, ours)) return // not ours",
                "  if (atPath === ours) return // not ours",
            )
        ],
    ),
    (
        "M8 · ⛔ …and the over-correction, which is the failure mode a careless fix produces · a "
        "release that unlinks NOTHING leaves every home locked by its own last holder",
        [
            (
                HOME,
                "  if (ours === null || atPath === null) return // nothing to identify",
                "  if (ours !== null || atPath === null) return // nothing to identify",
            )
        ],
    ),
    # ---- §3 · the clause ---------------------------------------------------------------------------
    (
        "M9 · ⛔ the clause is gone again (233's residual, restored) · the CLI explains itself on the "
        "way out and the user is shown a sentence that does not say it",
        [
            (
                CLAUDE,
                "        this.finishUnexpected(`the provider stream ended unexpectedly${this.stderrClause()}`)",
                "        this.finishUnexpected('the provider stream ended unexpectedly')",
            )
        ],
    ),
    (
        "M10 · ⛔ THE ONE-OF-N-CALL-SITES SHAPE · the clause is restored at the ending that CLOSES "
        "and not at the ending that THROWS, so the fix reaches one of `runLoop`'s two exits",
        [
            (
                CLAUDE,
                "        this.finishUnexpected(`${errorMessage(error)}${this.stderrClause()}`)",
                "        this.finishUnexpected(errorMessage(error))",
            )
        ],
    ),
    (
        "M11 · ⛔ the clause is appended when there is nothing to append · every ordinary failure in "
        "the product ends with a dangling `. stderr: `",
        [
            (
                CLAUDE,
                "    return tail === '' ? '' : `. stderr: ${tail.slice(-STDERR_CLAUSE_BYTES)}`",
                "    return `. stderr: ${tail.slice(-STDERR_CLAUSE_BYTES)}`",
            )
        ],
    ),
    (
        "M12 · ⛔ the clause is unbounded · 4 KiB of a provider's stderr in the one sentence a person "
        "reads when a session dies",
        [
            (
                CLAUDE,
                "    return tail === '' ? '' : `. stderr: ${tail.slice(-STDERR_CLAUSE_BYTES)}`",
                "    return tail === '' ? '' : `. stderr: ${tail}`",
            )
        ],
    ),
    # ---- carried forward ---------------------------------------------------------------------------
    (
        "M13 · ⚑ `exited` settles on a TIMER rather than on the process — 229 H1's *a bound became "
        "the receipt* in its purest form · no row in any table mutates the construction of this "
        "promise, and §1 leans on it being a fact",
        [
            (
                TRANSPORT,
                "    this.exited = new Promise<void>((resolve) => {\n      this.markExited = resolve\n    })",
                "    this.exited = new Promise<void>((resolve) => {\n      this.markExited = () => {}\n"
                "      setTimeout(resolve, 0)\n    })",
            )
        ],
    ),
    (
        "M14 · ⚑ a spawn that never produced a process never settles `exited` — so the launch id "
        "stays refused for the rest of the app run over a child that never existed (233's own "
        "branch, on the Codex side, which 233's table guards only for Claude)",
        [
            (
                TRANSPORT,
                "    this.markExited() // no process ever ran",
                "    void 0 // no process ever ran",
            )
        ],
    ),
]


def apply(root: Path, index: int, dry: bool) -> int:
    name, edits = MUTATIONS[index]
    bad = 0
    for rel, find, replace in edits:
        path = Path(root) / rel
        text = path.read_text()
        hits = text.count(find)
        if hits != 1:
            print(f"!! {name}: anchor found {hits} times in {rel} (expected exactly 1)")
            bad += 1
            continue
        if not dry:
            path.write_text(text.replace(find, replace))
    return bad


def main() -> int:
    import sys

    args = sys.argv[1:]
    if args[:1] == ["--count"]:
        print(len(MUTATIONS))
        return 0
    if args[:1] == ["--files"]:
        seen = []
        for _name, edits in MUTATIONS:
            for rel, _find, _replace in edits:
                if rel not in seen:
                    seen.append(rel)
        print(" ".join(seen))
        return 0
    if args[:1] == ["--name"]:
        print(MUTATIONS[int(args[1])][0])
        return 0
    if args[:1] == ["--dry-run"]:
        root = Path(args[1]).resolve()
        bad = 0
        for index in range(len(MUTATIONS)):
            bad += apply(root, index, dry=True)
        print(f"{len(MUTATIONS) - bad}/{len(MUTATIONS)} anchors found exactly once")
        return 1 if bad else 0
    root = Path(args[0]).resolve()
    return apply(root, int(args[1]), dry=False)


if __name__ == "__main__":
    raise SystemExit(main())
