#!/usr/bin/env python3
"""294's mutation table — each row is THE DEFECT, put back verbatim (131).

⛔ **`quit:check` failed 2 runs in 3 for the PM, and the answer is not the gate.** Measured here on
`main`, twenty runs at a time, with the load recorded beside every one:

| tree | load | passed |
|---|---|---|
| incumbent | 111–253 | **0 / 10** |
| this table's tree | 164–289 | **20 / 20** |
| this table's tree | 55–123 | **20 / 20** |

## 🔴 What was actually wrong, in three parts

 * `§1` **Electron 43.2.0 emits `quit` and then does not exit.** The four ordered steps finish and
   report at **+1 ms**, `will-quit` and `quit` arrive at **+106 ms**, the window goes at **+350 ms**,
   and the process then sits in `mach_msg2_trap` with zero children, indefinitely — the state `270`
   measured at **60.489 s**. ⚠️ **It is not ours**: twenty lines of bare Electron with one window and
   no BroBot code hang in **5 of 6** loaded quits with the identical signature.
 * `§2` **`271`'s bound for exactly this could never fire.** It was `setTimeout(…, 2000).unref()`
   after `app.quit()`. Armed on every run, fired on none. Nor does a **ref**'d timer, nor a
   `setInterval` armed a line earlier, nor a worker thread — because once Electron begins its quit,
   main-process JavaScript stops running. Only a **detached child process** fires: 6/6, at
   +2.15–2.23 s. That is `last-resort-exit.ts`.
 * `§3` **The app's last three lines were being lost.** `console.error` to a pipe is asynchronous;
   the loop stops before libuv drains it. So the shutdown report — `271`'s own instrument, written
   last — was the line most likely never to arrive, which is part of why `270`'s minute could not be
   attributed at all.

## ⚠️ What this table deliberately does NOT contain

⛔ **Rows whose only kill is a live gate are guaranteed survivors, and writing them would be a claim
this harness cannot support.** `mutate.sh` runs `runtime`, `desktop`, `dom` and `scripts`; it does
not launch Electron, so nothing here can die in `quit:check` or `window:check`. Named rather than
written:

 * *the check reads the app's output from a PIPE again* — which is how it blinded itself: the probe
   asks 27,000 times a second and Electron logs five lines per refusal, so a loaded quit produced
   **6,000–23,000 lines**, the pipe saturated, and the report was lost on the way out.
 * *`WINDOW_LAG_MS` back to 2,500* — which fires on the fix working rather than on the disease. The
   PM's own marginal failure was **2,502 ms**.
 * *the last resort firing is a FAILURE again* — which puts the flakiness back, on the fix.

⚑ **And two defects belong to `271`'s table, not this one**, because that is where their property
was first bought: *nothing bounds Electron's own shutdown* is `271 M12`, corrected in place by 294
to remove the call that arms the closer; *a stop that says nothing looks like a crash* is `271 M14`,
re-aimed at the sentence the closer prints because its old site — `deps.exit(0)` — no longer exists
in any form. ⚠️ **A wedged process cannot be made to exit 0 from outside**, so an app that had to be
stopped now goes by signal and carries no exit code. That cost is real and is stated in the response.

⛔ **294 wrote this table and did NOT run it.** Its dispatch §4 says so: *"Write, do not run."* So
`mutations.txt` does not exist at 294's HEAD and its absence is the honest state. All anchors were
verified present exactly once (`mutations.py --dry-run .`), which is the whole of what can be checked
without running.
"""

from pathlib import Path

CLOSER = "apps/desktop/src/main/last-resort-exit.ts"
LIFETIME = "apps/desktop/src/main/app-lifetime.ts"
ROOT_FILE = "apps/desktop/src/main/index.ts"

MUTATIONS = [
    # ── §1 · when the deadline is armed ─────────────────────────────────────────────────────────
    (
        "M1 · 🔴 the deadline is armed AFTER `app.quit()` · which is where 271 armed it, and is the "
        "one position from which it can never be armed at all: the call does not return until "
        "Electron has begun a quit that stops this process's JavaScript",
        [
            (
                LIFETIME,
                "          try {\n            deps.armLastResort(ELECTRON_EXIT_GRACE_MS)\n"
                "          } catch (error) {\n            deps.log('BroCrew could not arm its last-resort exit:', error)\n"
                "          }\n          askElectronToQuit('BroCrew failed to quit:')",
                "          askElectronToQuit('BroCrew failed to quit:')\n"
                "          try {\n            deps.armLastResort(ELECTRON_EXIT_GRACE_MS)\n"
                "          } catch (error) {\n            deps.log('BroCrew could not arm its last-resort exit:', error)\n"
                "          }",
            )
        ],
    ),
    (
        "M2 · 🔴 the deadline is armed at the GESTURE · so it takes the process out from under the "
        "archive drain, which is the one step with no bound of its own and the write the whole "
        "ordered teardown exists to protect",
        [
            (
                LIFETIME,
                "      quitStartedAt = deps.now()\n",
                "      quitStartedAt = deps.now()\n      deps.armLastResort(ELECTRON_EXIT_GRACE_MS)\n",
            )
        ],
    ),
    (
        "M3 · ⚠️ a quit that cannot arm its deadline does not quit · spawning is the one thing the "
        "closer needs and the one thing that fails late, and an app that refuses to leave because it "
        "could not arrange to be stopped is this dispatch's own defect wearing the fix's clothes",
        [
            (
                LIFETIME,
                "          try {\n            deps.armLastResort(ELECTRON_EXIT_GRACE_MS)\n"
                "          } catch (error) {\n            deps.log('BroCrew could not arm its last-resort exit:', error)\n"
                "          }\n",
                "          deps.armLastResort(ELECTRON_EXIT_GRACE_MS)\n",
            )
        ],
    ),
    # ── §2 · what the closer promises ───────────────────────────────────────────────────────────
    (
        "M4 · 🔴 the closer kills nothing · it starts, it waits, it says its piece and it leaves the "
        "app exactly where 270 found it — running, holding the port, refusing the relaunch",
        [
            (
                CLOSER,
                '`try{process.kill(target,"SIGKILL")}catch(e){}` +',
                "`try{}catch(e){}` +",
            )
        ],
    ),
    (
        "M5 · 🔴 THE ONE THAT CAN DO DAMAGE · the parent check is gone, so the deadline is a promise "
        "about a NUMBER: an app that left on time, a pid the kernel handed to somebody else, and a "
        "SIGKILL two seconds later into a process this app has never heard of",
        [
            (
                CLOSER,
                "`if(process.ppid!==target){clearInterval(tick);process.exit(0)}` +",
                "",
            )
        ],
    ),
    (
        "M6 · 🔴 the deadline is RELATIVE again · `Date.now()+2000` is evaluated once the closer has "
        "finished booting, so the app's two-second promise silently becomes two seconds plus a "
        "process start — ~200 ms idle and ~3 s at load 252, which is the one failure in twenty this "
        "correction removed",
        [
            (
                CLOSER,
                "    `const target=${String(targetPid)},due=${String(deadlineAt)};` +",
                "    `const target=${String(targetPid)},due=Date.now()+${String(withinMs)};` +",
            )
        ],
    ),
    (
        "M7 · ⚠️ the closer sleeps instead of watching · so a healthy quit is shadowed by a process "
        "that outlives it for the whole budget, holding the app's stderr open after the app is gone",
        [
            (
                CLOSER,
                "const WATCH_INTERVAL_MS = 100",
                "const WATCH_INTERVAL_MS = 60_000",
            )
        ],
    ),
    (
        "M8 · 🔴 the closer boots the APPLICATION · `process.execPath` in the main process is the "
        "Electron binary, so without `ELECTRON_RUN_AS_NODE` the last thing a quit does is start a "
        "second BroBot on the userData the first one is in the middle of releasing",
        [
            (
                CLOSER,
                "    env: { ...deps.env, ELECTRON_RUN_AS_NODE: '1' },",
                "    env: { ...deps.env },",
            )
        ],
    ),
    (
        "M9 · ⚠️ the closer holds the app open · unreferenced is the whole difference between a "
        "bound and a delay: referenced, the mechanism that exists to make the app leave sooner is "
        "the reason it stays for its own budget",
        [
            (
                CLOSER,
                "  closer.unref()",
                "  void closer",
            )
        ],
    ),
    # ── §3 · the app's last words ───────────────────────────────────────────────────────────────
    (
        "M10 · 🔴 the shutdown notices go back to `console.error` · asynchronous on a pipe, written "
        "in the last instants of the process's life, and therefore lost exactly when they are the "
        "only evidence — the report, the will-quit and the quit all missing, which is a third of why "
        "270's minute could not be attributed to anything",
        [
            (
                ROOT_FILE,
                "      const bytes = Buffer.from(`${line}\\n`, 'utf8')\n      for (let written = 0; written < bytes.length;) {\n        written += writeSync(STDERR_FD, bytes, written, bytes.length - written)\n      }",
                "      console.error(line)",
            )
        ],
    ),
    (
        "M11 · ⚠️ the synchronous write starts from zero every time · `writeSync` to a pipe may take "
        "only part of the line and return a short count, so a loop that re-sends the whole buffer "
        "repeats what already went out — and the line this carries most often is the shutdown report, "
        "which the gate matches with a regex. Half a report reads as the app having said something else",
        [
            (
                ROOT_FILE,
                "        written += writeSync(STDERR_FD, bytes, written, bytes.length - written)",
                "        written += writeSync(STDERR_FD, bytes, 0, bytes.length)",
            )
        ],
    ),
]


def apply(root: Path, index: int, dry: bool) -> int:
    name, edits = MUTATIONS[index]
    bad = 0
    for rel, find, replace in edits:
        path = root / rel
        text = path.read_text()
        hits = text.count(find)
        if hits != 1:
            print(f"!! {name}: anchor found {hits} times in {rel} (expected exactly 1)")
            bad += 1
            continue
        # ⛔ **A replacement equal to its original records as SURVIVED and proves nothing** — the
        # phantom survivor 252 found. Checked here rather than by eye, on every row, every run.
        if find == replace:
            print(f"!! {name}: the replacement is identical to the anchor — this row is a no-op")
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
