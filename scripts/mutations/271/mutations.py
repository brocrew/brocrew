#!/usr/bin/env python3
"""271's mutation table — each row is THE DEFECT, put back verbatim (131).

⛔ **One finding, and 271 could not reproduce it.** `270` pressed ⌘Q on a fresh, idle instance and
measured the window blanked, the process alive and `:9444` held **60.489 s** later. Eight quits
measured here — SIGTERM ×7 and two real ⌘Q presses, one of them on `270`'s own surviving instance —
came back at **0.4–2.6 s**, and with the report below wired up the four ordered steps measured
**1–2 ms**. So this table does not protect a fix for a cause; it protects three properties the app
did not have, each of which is a reason that state was possible to be in and impossible to get out
of:

 * `§1` **nothing said where a quit went.** `270` spent a whole exploration run on a number it could
   not attribute to a step, because the app wrote nothing down about its own shutdown.
 * `§2` **the window was told nothing.** It went on drawing an ordinary, usable application for the
   whole teardown and then vanished — *"it looks crashed, not closing"*.
 * `§3` **a person could not insist.** The impatience clock hung off `quitSignal` alone, so an app
   that would not close could be got rid of from a terminal and not from the keyboard; and nothing
   at all bounded what Electron did after our own teardown finished.

The row groups:

 * `M1`-`M5`   ⚑ **§1 · the instrument** — that a report is written, that it is written on the fast
                path too, that a step which THREW still reports what it spent, and that Electron's
                own late phases are stamped against the gesture rather than against the epoch.
 * `M6`-`M8`   🔴 **§2 · the announcement** — that it happens BEFORE the first step, that it happens
                once, and that a window which cannot be told is not able to stop the app closing.
 * `M9`-`M11`  🔴 **§3 · a quit a person can insist on** — the ⌘Q door, the discrimination that
                keeps 163's "a reaper's SIGTERM is not impatience", and the deadline no further
                press may extend.
 * `M12`-`M14` 🔴 **§3 · the deadline on Electron** — that it exists, that it is armed only AFTER
                the four steps, and that it reports a successful quit rather than a failure.
 * `M15`-`M19` 🔴 **§2 · what a person actually sees** — the shade covering the window, swallowing
                the press, being translucent rather than the black `270` reported, and the
                subscription that puts it on screen at all.
 * `M20`-`M22` ⚑ **the wiring no test can execute** — every window told rather than the first,
                Electron's phases registered, and the preload's forward and its `off`.
 * `M23`-`M27` ⛔ **the four rows this dispatch retired, restored at their new spelling** — see below.
 * `M28`       ⚠️ **the per-window guard**, found reviewing 271's own diff and therefore numbered
                last: one `try` around the whole walk lets the first destroyed window take the
                closing notice away from every window after it.

## ⛔ Four rows in older tables retired at this commit, and every property is re-covered

`163 M1`, `163 M2`, `163 M4` and `241 M10` went stale here. Retired in place (142) rather than
edited, because a past table's recorded run was made by the script as it stood — and none of them
was weakened, only respelled:

 * `163 M1`/`M2` anchored on `if (forcedExit !== null) return` inside `quitSignal`. 271 moved that
   guard into `beImpatient`, because ⌘Q now starts the same clock a repeat signal does. → `M24`
   and `M25`, which carry the same pair — exits at once, and never exits — at the new home, and now
   cover the keyboard door as well as the signal.
 * `163 M4` anchored on the inline `try { deps.quit() }` of the first signal, which became
   `askElectronToQuit` so that the `before-quit` it raises is not mistaken for a person pressing
   again. → `M23`.
 * `241 M10` anchored on `' && pnpm run window:check",'` — the END of the `ci` chain, which 271
   lengthened by appending `quit:check`. → `M26`, which removes both, and `M27`, which removes only
   the new one and is the likelier real-world regression.

## ⚑ `M26` and `M27` re-anchored at 306, and the pattern that broke them BOTH is worth naming

`306` appended `fixture:check` to the same chain, and both rows went stale for the same reason `241
M10` did the previous time the chain grew — which was 271 itself: **each anchored on text ending
`",`**, the closing quote of the `ci` value, so each was really saying *"…and these are the LAST
things in the chain"*. That is a claim about position, and the end of a chain is the one place a gate
is ever appended. ⛔ **Three rows, in two tables, broken by the only two times the chain has grown.**

⛔ **Corrected in place, not retired (142), and neither is weakened**: the trailing `",` is gone from
both anchors and the replacement is the empty string, so `M26` still removes `window:check` and
`quit:check` and `M27` still removes `quit:check` alone — the same two propositions, now independent
of what follows them.

⚠️ **And there was no verdict to preserve**: this table has never been run (see the section below —
it is written against `264`'s harness contract and cannot run at 271's own HEAD), so `M26` and `M27`
carry a proposition and no artefact. That makes the correction cheaper than it would otherwise be
and is said here so nobody reads a re-anchored row as a re-attested one.

⚠️ **`306`'s own brief named `M26` and not `M27`.** `M27` is here because a sweep of every row
anchoring `package.json` found it, which is the check to make when a chain changes shape.

## ⛔ This table is written against 264's harness contract and CANNOT be run at 271's own HEAD

`271` branches off `main` @ `810e555`. `264`-`269` rebuilt the shared harness on `mla/mutations`,
which at `8b62c34` is **not an ancestor of that commit** — `require_healthy_baselines`,
`begin_mutation_control` and `require_healthy_control` do not exist in this tree. ⚠️ `265` shipped a
table with the same problem and recorded it; `mutate.sh` here **refuses with a sentence** instead of
dying on `command not found`, which is the one thing that improved between the two.

## ⛔ What this table cannot reach, stated because a table silent about its edges is claiming them

 * ⚠️ **No row reaches `270`'s sixty seconds**, because nothing here knows what spent them. Every
   row below is about the app being legible and bounded while it closes, not about the cause.
 * ⚠️ **No row reaches Electron's own shutdown.** `M12` proves the deadline exists and `M13` proves
   it is armed in the right place; whether Chromium actually needs it is not a property any test in
   this repository can hold, and `quit:check` asserts only that an idle quit does NOT need it.
 * ⚠️ **`M22` is killed by a SOURCE SCAN and not by execution.** The preload imports `electron` as a
   value, so nothing here can load it — the same limit `app-lifetime.test.ts` records for
   `index.ts`, and `M20`/`M21` are in the same position.

## ⚑ 294 · three rows corrected in place, and what their recorded results now mean

⛔ **`294` replaced this dispatch's §3 mechanism entirely, and the reason is that §3 never worked.**
`ELECTRON_EXIT_GRACE_MS` was a `setTimeout` armed after `app.quit()`, and 294 measured it firing
**zero** times across 25–45 second hangs — because once Electron begins its quit, main-process
JavaScript stops running. A ref'd timer, a `setInterval` armed a line earlier, and a worker thread
all also produced zero ticks; only a detached child process fires. The bound now lives in
`last-resort-exit.ts`.

 * **`M6`** — anchor only. It matched `readyToExit` and the quit call as one string, and 294 arms the
   closer between them. Same defect, same kill.
 * **`M12`** — same defect, new site. It used to disable a `setTimeout`; it now removes the call that
   arms the closer, which is the only thing that bounds Electron's shutdown.
 * **`M14`** — ⚠️ **re-aimed**, because its site no longer exists in any form. A wedged process
   cannot be made to exit 0 from outside, so *"a successful quit exits 1"* has no modern spelling;
   the closest live property is that a stop must SAY it was a stop, or it is indistinguishable from a
   crash.

⚠️ **This table has never been run** — `CENSUS.md` records it `unrun`, 0 artefact rows — so nothing
recorded was invalidated by these corrections and no artefact has been rewritten (142). The
corrections change what a future run will measure, and that run is still owed.
"""

from pathlib import Path

LIFETIME = "apps/desktop/src/main/app-lifetime.ts"
ROOT_FILE = "apps/desktop/src/main/index.ts"
APP_VUE = "apps/desktop/src/renderer/src/App.vue"
SHADE = "apps/desktop/src/renderer/src/components/ClosingShade.vue"
# ⚑ Added by 294: §3's deadline moved out of this process entirely. See M12/M14.
CLOSER = "apps/desktop/src/main/last-resort-exit.ts"
PRELOAD = "apps/desktop/src/preload/index.ts"

MUTATIONS = [
    # ── §1 · the instrument ─────────────────────────────────────────────────────────────────────
    (
        "M1 · ⚑ the shutdown says nothing again · the one-line report is gone, which is the state "
        "270 measured a minute in and could not attribute a millisecond of to a step",
        [
            (
                LIFETIME,
                "    deps.log(\n      total > SLOW_TEARDOWN_MS",
                "    void report\n    if (false as boolean)\n      deps.log(\n      total > SLOW_TEARDOWN_MS",
            )
        ],
    ),
    (
        "M2 · ⚠️ the report is written ONLY when it is slow · so nobody has ever seen a fast one, "
        "and 'is this normal?' becomes unanswerable at the exact moment it is asked",
        [
            (
                LIFETIME,
                "    deps.log(\n      total > SLOW_TEARDOWN_MS\n        ? `${report}",
                "    if (total > SLOW_TEARDOWN_MS)\n      deps.log(\n      total > SLOW_TEARDOWN_MS\n        ? `${report}",
            )
        ],
    ),
    (
        "M3 · 🔴 a step that THREW reports nothing · stamped inside the try, so the most interesting "
        "row a report can have — a failure that took forty seconds — is the one it drops",
        [
            (
                LIFETIME,
                "      try {\n        await run()\n      } catch (error) {\n        deps.log(`BroCrew failed to ${what}:`, error)\n      }\n      // ⚠️ Stamped in the `finally` sense",
                "      try {\n        await run()\n        spent.push(`${what} ${String(deps.now() - began)}ms`)\n      } catch (error) {\n        deps.log(`BroCrew failed to ${what}:`, error)\n        continue\n      }\n      // ⚠️ Stamped in the `finally` sense",
            )
        ],
    ),
    (
        "M4 · ⚠️ Electron's late phases are stamped against the EPOCH · `will-quit at +1774040000000ms` "
        "is the same event and no finding at all — the number only means something against the gesture",
        [
            (
                LIFETIME,
                "          ? 'without a quit this module started'\n          : `at +${String(deps.now() - quitStartedAt)}ms`",
                "          ? 'without a quit this module started'\n          : `at +${String(deps.now())}ms`",
            )
        ],
    ),
    (
        "M5 · ⚠️ a phase with no quit behind it is dressed up as `+0ms` · Electron shutting the app "
        "down through a door this module never saw is the most interesting thing the line can say",
        [
            (
                LIFETIME,
                "        quitStartedAt === null\n          ? 'without a quit this module started'\n          : `at +${String(deps.now() - quitStartedAt)}ms`",
                "        quitStartedAt === null\n          ? 'at +0ms'\n          : `at +${String(deps.now() - quitStartedAt)}ms`",
            )
        ],
    ),
    # ── §2 · the announcement ───────────────────────────────────────────────────────────────────
    (
        "M6 · 🔴 the window is told AFTER the teardown · which on an idle app is after the window has "
        "already gone: the whole four steps finish inside one microtask drain (270 finding 1). "
        "⚑ ANCHOR CORRECTED IN PLACE BY 294 — the second edit anchored on `readyToExit` AND the "
        "quit call as one string; 294 arms the last-resort exit between them. Same defect, same kill.",
        [
            (
                LIFETIME,
                "      try {\n        deps.announceClosing()\n      } catch (error) {\n        deps.log('BroCrew could not tell its windows it is closing:', error)\n      }\n",
                "",
            ),
            (
                LIFETIME,
                "          readyToExit = true\n",
                "          try {\n            deps.announceClosing()\n          } catch (error) {\n            deps.log('BroBot2 could not tell its windows it is closing:', error)\n          }\n          readyToExit = true\n",
            ),
        ],
    ),
    (
        "M7 · ⚠️ every deferred press announces again · one IPC send per impatient ⌘Q into a window "
        "already showing the shade — harmless, and exactly the kind of harmless nobody notices growing",
        [
            (
                LIFETIME,
                "      if (shutdown) {\n        if (!issuingQuit) beImpatient('a quit gesture')\n        return\n      }\n      quitStartedAt = deps.now()",
                "      if (shutdown) {\n        if (!issuingQuit) beImpatient('a quit gesture')\n        try {\n          deps.announceClosing()\n        } catch {\n          // swallowed\n        }\n        return\n      }\n      quitStartedAt = deps.now()",
            )
        ],
    ),
    (
        "M8 · 🔴 a window that cannot be told stops the app closing · the announcement is the first "
        "statement of the quit, so an unguarded throw here skips all four ordered steps",
        [
            (
                LIFETIME,
                "      try {\n        deps.announceClosing()\n      } catch (error) {\n        deps.log('BroCrew could not tell its windows it is closing:', error)\n      }",
                "      deps.announceClosing()",
            )
        ],
    ),
    # ── §3 · a quit a person can insist on ──────────────────────────────────────────────────────
    (
        "M9 · 🔴 the second ⌘Q buys nothing again · absorbed and unanswered, which is 270's person "
        "pressing the one key that could have helped and being told nothing at all",
        [
            (
                LIFETIME,
                "        if (!issuingQuit) beImpatient('a quit gesture')\n        return",
                "        return",
            )
        ],
    ),
    (
        "M10 · ⚠️ a reaper's first SIGTERM counts as impatience · which quietly shortens 163's "
        "measured 'shut down properly, take as long as that takes' to twenty seconds",
        [
            (
                LIFETIME,
                "        if (!issuingQuit) beImpatient('a quit gesture')",
                "        beImpatient('a quit gesture')",
            )
        ],
    ),
    (
        "M11 · ⚠️ every further press restarts the clock · a budget any repeat can extend is not a "
        "budget, and impatience is exactly the state in which a person presses repeatedly",
        [
            (
                LIFETIME,
                "  const beImpatient = (asked: string): void => {\n    if (forcedExit !== null) return\n",
                "  const beImpatient = (asked: string): void => {\n    if (forcedExit !== null) clearTimeout(forcedExit)\n",
            )
        ],
    ),
    # ── §3 · the deadline on Electron ───────────────────────────────────────────────────────────
    (
        "M12 · 🔴 nothing bounds Electron's own shutdown · the app's four steps finish in 1–2 ms and "
        "everything after `app.quit()` is unbounded again, which is where 270's minute has to have been. "
        "⚑ ANCHOR CORRECTED IN PLACE BY 294 — the bound is no longer a `setTimeout` in this process "
        "(it never once fired; see 294), so the row now removes the call that arms the closer. The "
        "DEFECT is unchanged and is now the one 270 actually reported.",
        [
            (
                LIFETIME,
                "            deps.armLastResort(ELECTRON_EXIT_GRACE_MS)\n",
                "",
            )
        ],
    ),
    (
        "M13 · 🔴 the deadline is armed at the GESTURE · so it fires over a teardown still in flight "
        "and abandons the archive write the whole ordered shutdown exists to protect",
        [
            (
                LIFETIME,
                "      quitStartedAt = deps.now()\n      // ⛔ **Before the first `await`",
                "      quitStartedAt = deps.now()\n      setTimeout(() => deps.exit(0), ELECTRON_EXIT_GRACE_MS).unref?.()\n      // ⛔ **Before the first `await`",
            )
        ],
    ),
    (
        "M14 · ⚠️ a stop that says nothing looks like a crash · every reaper, smoke and agent on this "
        "machine reads how the app went, and a shutdown whose engine tail was CUT must be "
        "distinguishable from one that died. ⚑ RE-AIMED IN PLACE BY 294 — its old site is gone: the "
        "cut is no longer `deps.exit(0)` in this process but a SIGKILL from the closer, which cannot "
        "carry an exit code at all (see 294 on what that costs). The nearest live form of the same "
        "property is the sentence the closer prints; without it the stop is silent and unattributable.",
        [
            (
                CLOSER,
                '    `console.error("BroCrew asked Electron to exit ${String(withinMs)}ms ago and is still running; ` +\n'
                "    `everything of ours is closed, so it is being stopped now\");` +\n",
                "",
            )
        ],
    ),
    # ── §2 · what a person actually sees ────────────────────────────────────────────────────────
    (
        "M15 · 🔴 the shade lets the press through · every control behind it is about to lose its "
        "database, and a press that reaches one gets better-sqlite3's own message — what 270 saw",
        [
            (
                SHADE,
                "  background: var(--closing-shade-bg);\n  /* ⛔ NOT `pointer-events: none`.",
                "  background: var(--closing-shade-bg);\n  pointer-events: none;\n  /* ⛔ NOT `pointer-events: none`.",
            )
        ],
    ),
    (
        "M16 · 🔴 the shade is positioned against its parent · so it covers the transcript and leaves "
        "the titlebar and the rail live beside a message saying the app is closing",
        [
            (
                SHADE,
                ".closing-shade {\n  position: fixed;",
                ".closing-shade {\n  position: absolute;",
            )
        ],
    ),
    (
        "M17 · 🔴 the shade is solid black · which is 270's own finding wearing the fix's clothes: "
        "*'the entire BroBot window became black'*, now on purpose",
        [
            (
                SHADE,
                "  background: var(--closing-shade-bg);",
                "  background: rgb(0, 0, 0);",
            )
        ],
    ),
    (
        "M18 · 🔴 nothing subscribes · the channel, the preload and the shade all exist and the "
        "window is never told, which is the app exactly as 270 found it",
        [
            (
                APP_VUE,
                "  return window.api?.onClosing?.(onClosing) ?? ((): void => {})",
                "  void onClosing\n  return (): void => {}",
            )
        ],
    ),
    (
        "M19 · ⚠️ the unsubscribe is dropped · every re-mounted renderer stacks another listener on a "
        "channel that fires exactly once, and nothing on screen ever differs",
        [
            (
                APP_VUE,
                "  return window.api?.onClosing?.(onClosing) ?? ((): void => {})",
                "  window.api?.onClosing?.(onClosing)\n  return (): void => {}",
            )
        ],
    ),
    # ── the wiring no test can execute ──────────────────────────────────────────────────────────
    (
        "M20 · 🔴 only the first window is told · a second window goes on drawing an ordinary "
        "application beside one that says the app is closing — two answers to one fact (076 §3, 187 §1)",
        [
            (
                ROOT_FILE,
                # ⚑ **534 · the anchor carries its `try {` now, and that is a REPAIR rather than a
                # retirement** (standing rule 27, `anchor-ambiguous`). `534` gave `index.ts` a
                # SECOND walk over `BrowserWindow.getAllWindows()` — the `runtime:changed`
                # announcement, which is deliberately `announceClosing`'s loop in shape and for its
                # stated reasons. ⛔ It is indented six rather than four, so the old anchor was a
                # SUBSTRING of it: a first-occurrence replace would have mutated the new loop, and
                # this row's killer scans the `createAppLifetime({…})` seam — so it would have come
                # back SURVIVED having measured nothing.
                # ⚠️ **The defect is unchanged and so is the kill**: `app-lifetime.test.ts` asserts
                # `announceClosing`'s loop is over every window, and the `try {` on the next line is
                # the same seam's own assertion one line down.
                "    for (const window of BrowserWindow.getAllWindows()) {\n      try {",
                "    for (const window of BrowserWindow.getAllWindows().slice(0, 1)) {\n      try {",
            )
        ],
    ),
    (
        "M21 · ⚑ Electron's phases are not registered · `noteQuitPhase` stays perfectly correct and "
        "is never called, so 'was the minute ours or the engine's?' is unanswerable again",
        [
            (
                ROOT_FILE,
                "  app.on('will-quit', () => lifetime.noteQuitPhase('will-quit'))\n  app.on('quit', () => lifetime.noteQuitPhase('quit'))\n",
                "",
            )
        ],
    ),
    (
        "M22 · ⚠️ the preload never lets go · `off` removed from the forwarder, so the renderer's own "
        "unsubscribe returns a function that unsubscribes nothing",
        [
            (
                PRELOAD,
                "    return () => {\n      ipcRenderer.off(APP_CLOSING_CHANNEL, forward)\n    }",
                "    return () => {\n      // let go of nothing\n    }",
            )
        ],
    ),
    # ── restored from tables this dispatch retired ──────────────────────────────────────────────
    (
        "M23 · 🔴 the first quit signal does not quit at all · the listeners exist and the app "
        "ignores them, which is 094/095 — restores `163 M4`, whose anchor 271 moved into "
        "`askElectronToQuit`",
        [
            (
                LIFETIME,
                "        askElectronToQuit(`BroCrew failed to quit on ${signal}:`)\n        return",
                "        void signal\n        return",
            )
        ],
    ),
    (
        "M24 · 🔴 068 finding 1 IS BACK · a repeat exits at once, through the middle of the "
        "teardown — what the kernel used to do for us. Restores `163 M1` at 271's spelling, where "
        "the guard now lives in `beImpatient` and serves ⌘Q as well as a signal",
        [
            (
                LIFETIME,
                "  const beImpatient = (asked: string): void => {\n    if (forcedExit !== null) return",
                "  const beImpatient = (asked: string): void => {\n    deps.exit(1)\n    if (forcedExit !== null) return",
            )
        ],
    ),
    (
        "M25 · 🔴 …and the opposite: the repeat is absorbed FOREVER, so nothing can insist — SIGTERM "
        "stops working (094/095) and so does the second ⌘Q 271 added. Restores `163 M2`",
        [
            (
                LIFETIME,
                "    forcedExit = setTimeout(() => {\n      deps.log(`BroCrew did not finish shutting down",
                "    if (true as boolean) return\n    forcedExit = setTimeout(() => {\n      deps.log(`BroCrew did not finish shutting down",
            )
        ],
    ),
    (
        "M26 · ⛔ BOTH instruments leave the ci chain · `window:check` and `quit:check` still exist, "
        "still pass when run by hand, and guard nothing — *'a correct policy that nothing calls "
        "leaves the defect exactly where it was'*. Restores `241 M10`, whose anchor 271 lengthened",
        [
            (
                "package.json",
                # ⚑ **Re-anchored by `306`, which appended `fixture:check` to the chain** — see the
                # note at the head of this file. The trailing `",` went with it: an anchor that ends
                # at the closing quote means "the END of the chain", and the end of the chain is the
                # one place a new gate is ever added. The row's proposition is unchanged — BOTH
                # instruments leave — and it no longer depends on their being last.
                " && pnpm run window:check && pnpm run quit:check",
                "",
            )
        ],
    ),
    (
        "M28 · ⚠️ one `try` around the whole walk · the first window whose `webContents` has already "
        "gone takes the shutdown notice away from every window after it — the defect the per-window "
        "guard exists to avoid, reintroduced by catching in the tidier place. ⚑ Found reviewing "
        "271's own diff, which is why it is numbered last rather than beside `M20`",
        [
            (
                ROOT_FILE,
                "    for (const window of BrowserWindow.getAllWindows()) {\n      try {\n        if (!window.isDestroyed() && !window.webContents.isDestroyed()) {\n          window.webContents.send(APP_CLOSING_CHANNEL)\n        }\n      } catch (error) {\n        console.error('BroCrew could not tell a window it is closing:', error)\n      }\n    }",
                "    try {\n      for (const window of BrowserWindow.getAllWindows()) {\n        if (!window.isDestroyed() && !window.webContents.isDestroyed()) {\n          window.webContents.send(APP_CLOSING_CHANNEL)\n        }\n      }\n    } catch (error) {\n      console.error('BroCrew could not tell a window it is closing:', error)\n    }",
            )
        ],
    ),
    (
        "M27 · 🔴 only the CLOSING instrument leaves the chain · the narrower half of `M26`, and the "
        "one that reads as tidying rather than as removal: an app that opens is still proved and an "
        "app that closes is not, which is the repository exactly as 270 found it",
        [
            (
                "package.json",
                # Re-anchored by `306` for the same reason as `M26`, and this row is the one the
                # dispatch's own brief did not name: it ended at the closing quote too.
                " && pnpm run quit:check",
                "",
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
