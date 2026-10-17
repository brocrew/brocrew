#!/usr/bin/env python3
"""273's mutation table — each row is THE DEFECT, put back verbatim (131).

⛔ **One finding, and this time it reproduced.** `272` used `271`'s new shutdown report to catch what
`271` had left as a stated residual, twice, on clean quits:

> *"After `close its database`, the old process logged one failed `runtime:command` query for
> resumable sessions and one for unresumable sessions. Both failed with `The database connection is
> not open`. The first occurrence followed 145 ms of app-owned teardown; the second followed 335 ms."*

⚑ **And it reproduces on demand now.** `scripts/app-closes-check.mjs` asks the app's own bridge for
both lists continuously across the quit; on the tree before 273 that produced exactly the pair `272`
described, and it is the assertion that turns this from prose into a gate.

The quit is what asks the question the quit cannot answer: `closeAll()` ends every conversation, each
emits its terminal event, `RuntimeScreen` watches the open list's length, and both
closed-conversation lists re-read themselves — while the fourth ordered step is closing the
connection they read through.

The row groups:

 * `M1`-`M5`   🔴 **§1 · the door** — that it exists, that it covers more than the two commands `272`
                happened to find, that it is after the PARSE, that the host's `closing` is true, and
                that admission is closed BEFORE anything is awaited rather than at the end.
 * `M6`-`M10`  ⚠️ **§2 · the ruling on each command** — the two sibling commands that look alike and
                are not, the live-slot read that looks like memory and is not, the two exemptions
                that must stay exemptions, and a table that stops being total.
 * `M11`-`M12` ⚑ **the sentence** — that it names the command, and that it stays in the family every
                other shutdown refusal is written in.
 * `M13`-`M18` 🔴 **§2 · the half that makes an ordinary quit silent** — both lists stopping, the
                flag having one writer and no way back, the subscription that feeds it, and a guard
                written under the `await` instead of over it.
 * `M19`-`M23` ⛔ **the instrument** — the probe that must keep asking, must not ask on a TIMER, must
                prove itself first, and the two assertions that make its green mean anything.

## ⛔ Why `M5` is the row to read first

273 §1 is explicit: *"Order matters and is the whole defect: the door must shut BEFORE `close its
database`, not alongside it."* `M5` moves `closeAdmission()` from `closeAll`'s opening statement to
its last one — a change that looks like tidying, leaves every refusal in place, and reopens the exact
window `272` measured, because `close its sessions` is the second ordered step and `close its
database` is the fourth.

## ⛔ Why `M2` is the row to read second

§2 asks the wider question once, and says why: *"the two it found are a floor, not the set."* `M2` is
the fix that only fixes what was reported — the door consults the two commands `272` named instead of
the table. Every other command that reaches the ledger goes back to reaching a closed one.

## ⛔ This table is written against 264's harness contract and CANNOT be run at 273's own HEAD

`273` branches off `main` @ `42d952d`. `264`-`269` rebuilt the shared harness on `mla/mutations`,
which at `8b62c34` is **not an ancestor of that commit** — `require_healthy_baselines`,
`begin_mutation_control` and `require_healthy_control` do not exist in this tree. ⚠️ `265` shipped a
table with the same problem and died on `command not found`; `271` added a guard that refuses with a
sentence instead, and `mutate.sh` here carries it forward unchanged.

## ⛔ What this table cannot reach, stated because a table silent about its edges is claiming them

 * ⚠️ **No row here is killed by `quit:check`.** It launches a real Electron and is not in any of the
   four vitest projects the harness runs, so `M19`-`M23` die in `desktop` — against
   `one-app.test.ts`'s source scan of the instrument, which is the same position `241 M10` is in.
   ⛔ **That means these five prove the ASSERTIONS are pinned, not that the check would catch the
   defect.** What proves the second is the run recorded in 273's response: the same file, red on the
   tree before the fix and green after it, with the two errors `272` named in between.
 * ⚠️ **No row reaches the REAL renderer refresh.** `M13`/`M14`/`M18` mutate `SideRail.vue` and
   `ResumableSessions.vue` and are killed by a source scan, because the trigger — a quit closing every
   conversation, each terminal event shrinking the open list — needs two provider binaries and a live
   database to raise. The door below it is what makes that untested path safe rather than merely
   quiet.
 * ⚠️ **No row proves what Electron does with a rejected handler.** That it `console.error`s one with
   a full stack is a measurement (273's response), and it is the reason the renderer half exists at
   all; nothing in this repository can assert it.
"""

from pathlib import Path

IPC = "apps/desktop/src/main/runtime/ipc.ts"
HOST = "apps/desktop/src/main/runtime/runtime-host.ts"
CLOSING = "apps/desktop/src/renderer/src/lib/app-closing.ts"
APP_VUE = "apps/desktop/src/renderer/src/App.vue"
RAIL = "apps/desktop/src/renderer/src/components/SideRail.vue"
REOPEN_LIST = "apps/desktop/src/renderer/src/components/ResumableSessions.vue"
CHECK = "scripts/app-closes-check.mjs"

DOOR = (
    "  if (host.closing && DURING_A_QUIT[command.kind] === 'refused') {\n"
    "    throw new Error(refusedDuringAQuit(command.kind))\n"
    "  }\n"
)

MUTATIONS = [
    # ── §1 · the door ───────────────────────────────────────────────────────────────────────────
    (
        "M1 · 🔴 there is no door · every renderer command reaches the host while the four ordered "
        "steps run, which is the tree 272 measured: two session-list queries answered out of a "
        "connection close-its-database had already shut",
        [(IPC, DOOR, "")],
    ),
    (
        "M2 · ⛔ the door knows only what 272 reported · the two commands it happened to catch are "
        "refused and the other twenty-nine are not — 273 §2's whole point, that 'the two it found "
        "are a floor, not the set', undone in one expression",
        [
            (
                IPC,
                "  if (host.closing && DURING_A_QUIT[command.kind] === 'refused') {",
                "  if (\n    host.closing &&\n    (command.kind === 'listResumable' || command.kind === 'listUnresumable')\n  ) {",
            )
        ],
    ),
    (
        "M3 · ⚠️ the door is BEFORE the parse · a malformed command during a quit is told the app is "
        "shutting down instead of that it is malformed, and every exempt command is refused with it",
        [
            (
                IPC,
                "  const parsed = runtimeCommandSchema.safeParse(raw)\n  if (!parsed.success) {",
                "  const parsed = runtimeCommandSchema.safeParse(raw)\n"
                "  if (host.closing) {\n"
                "    throw new Error(\n"
                "      refusedDuringAQuit(((raw as { kind?: RuntimeCommandKind }).kind ?? 'attachOpen') as RuntimeCommandKind),\n"
                "    )\n"
                "  }\n"
                "  if (!parsed.success) {",
            )
        ],
    ),
    (
        "M4 · 🔴 the host never admits it is closing · `closing` answers false forever, so the door "
        "above it is present, correct, and never once consulted — the failure mode a guard keyed on "
        "somebody else's state always has",
        [
            (
                HOST,
                "  get closing(): boolean {\n    return this.launches.closed\n  }",
                "  get closing(): boolean {\n    return false\n  }",
            )
        ],
    ),
    (
        "M5 · ⛔ THE ORDER · admission closes as closeAll's LAST act instead of its first, so the "
        "door shuts after the sessions are down — 273 §1: 'the door must shut BEFORE close its "
        "database, not alongside it', and this is what alongside looks like · killed by `process-ownership.test.ts` · killed by `shutdown-door.test.ts`",
        [
            (
                HOST,
                # ⚑ **W4.275 · re-anchored in place, not retired** — W4.275 · the quit also closes the sign-in reopens; the plant still drops closeAdmission and keeps that close
                # ⚑ **source-restoration · re-anchored in place, not retired** — NOT VERIFIED; source targeting only. 5ae6a3206 inserted limit-reader teardown after the admission fence; remove only the original admission fence here.
                '    clearInterval(this.reconciliationTimer)\n    this.launches.closeAdmission()\n',
                '    clearInterval(this.reconciliationTimer)\n',
            ),
            (
                HOST,
                # ⚑ **source-restoration · re-anchored in place, not retired** — NOT VERIFIED; source targeting only. Keep the existing second edit that closes admission only after all draining.
                "          `${this.closeDrainTimeoutMs * 2}ms — a provider process may still be running`,\n      )\n    }\n  }",
                "          `${this.closeDrainTimeoutMs * 2}ms — a provider process may still be running`,\n      )\n    }\n    this.launches.closeAdmission()\n  }",
            ),
        ],
    ),
    # ── §2 · the ruling on each command ─────────────────────────────────────────────────────────
    (
        "M6 · ⚑ resume is exempted like its sibling · it LOOKS like createSession and is not: "
        "resumeSession reaches attachHeldSession — store.findLive plus a history window — four "
        "frames before it reaches the reserve() that would have refused it",
        [
            (
                IPC,
                "  // See the asymmetry with `createSession` above — this one reads before it refuses.\n  resume: 'refused',",
                "  resume: 'answered',",
            )
        ],
    ),
    (
        "M7 · ⚠️ attachOpen is exempted as 'just the slots this window holds' · it walks them and "
        "then reads store.findLive and a history window for every one, which is the same closed "
        "database by a longer road",
        [(IPC, "  attachOpen: 'refused',", "  attachOpen: 'answered',")],
    ),
    (
        # ⛔ **RETIRED BY RULING (W4.202, D-049's rest: the `models` command is removed):** no
        # window asked it — the window asks `modelList` — so its quit ruling has nothing left to
        # rule on. The one-provider read it reached (`providerModels`) keeps its own refusal during
        # a quit, held by `runtime-host.test.ts` and `process-ownership.test.ts`. Its anchor is
        # left stale, so the census records it retired.
        "M8 · ⛔ models is refused at the door · which shadows 070's own decision (a probe already "
        "answered is a value and costs nothing to hand back) with a worse one, and leaves that "
        "branch reachable by nothing",
        # ⚠️ **ANCHOR CORRECTED IN PLACE BY 689** — `providerModels` now sits between `models` and `profiles`; the line
        # alone is unique (`providerModels` spells it with a capital), so no context is borrowed.
        [(IPC, "  models: 'answered',\n", "  models: 'refused',\n")],
    ),
    (
        "M9 · ⛔ createSession is refused at the door · so a person pressing Start during a quit gets "
        "a wire sentence instead of 'BroBot2 is shutting down, so this conversation was not opened.' "
        "— and reserve()'s shutting-down refusal becomes unreachable",
        [
            (
                IPC,
                "  createSession: 'answered',",
                "  createSession: 'refused',",
            )
        ],
    ),
    (
        "M10 · ⚠️ the table stops being TOTAL · Partial, with two rows dropped — the form of ruling "
        "273 §2 exists to prevent, where a command added later is silently exempt because nobody was "
        "made to decide",
        [
            (
                IPC,
                "const DURING_A_QUIT: Record<RuntimeCommandKind, QuitRuling> = {",
                "const DURING_A_QUIT: Partial<Record<RuntimeCommandKind, QuitRuling>> = {",
            ),
            (
                IPC,
                "  earlierHistory: 'refused',\n  latestHistory: 'refused',\n}",
                "}",
            ),
        ],
    ),
    # ── the sentence ────────────────────────────────────────────────────────────────────────────
    (
        "M11 · ⚑ the refusal stops naming the command · so a quit's output says something was "
        "refused and never which, and the next person reading a shutdown has 272's investigation "
        "back minus the stack trace",
        [
            (
                IPC,
                "  return `BroCrew is shutting down, so ${kind} was not asked of its database`",
                "  return `BroCrew is shutting down, so that was not asked of its database`",
            )
        ],
    ),
    (
        "M12 · ⚠️ the refusal leaves the family · 070/098/100/202 all open 'BroBot2 is shutting down, "
        "so …'; a sentence that does not reads, in the one place they are all read together, as a "
        "different kind of failure",
        [
            (
                IPC,
                "  return `BroCrew is shutting down, so ${kind} was not asked of its database`",
                "  return `refused: ${kind}`",
            )
        ],
    ),
    # ── §2 · the half that makes an ordinary quit silent ─────────────────────────────────────────
    (
        "M13 · 🔴 the rail goes on asking · the surface 272 actually caught, refreshing its closed "
        "list as the quit closes every conversation underneath it",
        # ⚑ Landing D-017b (3af91dcb) · re-anchored in place, not retired — The rail must not
        # re-read the conversation list while the app is closing, and D-017b kept that guard, now in
        # `refreshListed` with the `listError` / `looked` state. Only the neighbouring line changed
        # (`closedError.value = null` became `listError.value = null`). The plant removes the guard.
        [
            (RAIL, '  if (appClosing.value) return\n  listError.value = null', '  listError.value = null'),
        ],
    ),
    (
        "M14 · 🔴 the reopen list goes on asking · the other surface the same watcher drives, and the "
        "reason 272 saw the pair rather than one",
        [(REOPEN_LIST, "  if (appClosing.value) return\n  loading.value = true", "  loading.value = true")],
    ),
    (
        "M15 · ⛔ the closing flag can be cleared · a quit that has begun cannot be cancelled, so a "
        "way back is a way to put this window into a state main is not in — with the shade coming "
        "off a window whose database is already closed",
        [
            (
                CLOSING,
                "export function beginClosing(): void {\n  closing.value = true\n}",
                "export function beginClosing(): void {\n  closing.value = true\n}\n\nexport function stopClosing(): void {\n  closing.value = false\n}",
            )
        ],
    ),
    (
        "M16 · ⚠️ the flag is exported writable · any surface can now say the app is closing, or say "
        "it is not, and the one writer stops being one",
        [
            (
                CLOSING,
                "export const appClosing = readonly(closing)",
                "export const appClosing = closing",
            )
        ],
    ),
    (
        "M17 · 🔴 nothing subscribes · the announcement 271 shipped arrives at a window that has "
        "stopped listening, so the shade never appears and neither list ever stops asking",
        [
            (
                APP_VUE,
                "  stopWatching = watchClosing(beginClosing)",
                "  stopWatching = watchClosing(() => {})",
            )
        ],
    ),
    (
        "M18 · ⚠️ the guard is UNDER the await instead of over it · it matches every pattern a scan "
        "could look for and stops nothing: the two commands have already gone by the time it runs",
        # ⚑ Landing D-017b (3af91dcb) · re-anchored in place, not retired — The guard must sit over
        # the two IPC list reads, not under the await. `refreshListed` still awaits
        # `Promise.all([listResumable(), listUnresumable()])`, so the rule is unchanged, and only
        # the destructured names moved (`resumable, unresumable`). The plant moves the guard after
        # the await, which still matches every pattern scan but breaks the ordering assertion.
        [
            (RAIL, '  if (appClosing.value) return\n  listError.value = null\n  try {\n    const [resumable, unresumable] = await Promise.all([\n      window.api.runtime.listResumable(),\n      window.api.runtime.listUnresumable(),\n    ])', '  listError.value = null\n  try {\n    const [resumable, unresumable] = await Promise.all([\n      window.api.runtime.listResumable(),\n      window.api.runtime.listUnresumable(),\n    ])\n    if (appClosing.value) return'),
        ],
    ),
    # ── the instrument ──────────────────────────────────────────────────────────────────────────
    (
        "M19 · ⛔ the probe asks on a TIMER again · Chromium throttles timers in a window that is "
        "not in front, so it fires about once a second and steps clean over the ~100ms between "
        "close-its-database and will-quit — measured: the first version of this check went GREEN on "
        "the broken tree",
        [
            (
                CHECK,
                "    const askAgain = (name) => {\n      probe.asked += 1\n      runtime[name]().then(\n        () => { probe.answered += 1; askAgain(name) },\n        (error) => {\n          probe.refused += 1\n          probe.lastRefusal = String((error && error.message) || error)\n          askAgain(name)\n        },\n      )\n    }\n    askAgain('listResumable')\n    askAgain('listUnresumable')",
                "    const ask = (name) => {\n      probe.asked += 1\n      runtime[name]().then(\n        () => { probe.answered += 1 },\n        (error) => {\n          probe.refused += 1\n          probe.lastRefusal = String((error && error.message) || error)\n        },\n      )\n    }\n    setInterval(() => { ask('listResumable'); ask('listUnresumable') }, 25)",
            )
        ],
    ),
    (
        "M20 · 🔴 the check stops looking for a closed database · the one assertion that is RED on "
        "the tree before 273, deleted — and the gate goes back to proving only that an idle app "
        "nobody is talking to exits quickly",
        [
            (
                CHECK,
                "  const deadDatabase = /.*database connection is not open.*/i.exec(output)",
                "  const deadDatabase = null",
            )
        ],
    ),
    (
        "M21 · ⛔ the check no longer proves the door was REACHED · so a probe that had gone quiet — "
        "a dead bridge, a window torn down early — satisfies 'nothing reached a closed database' by "
        "asking nothing at all, which is vacuity of exactly 241's shape",
        [
            (
                CHECK,
                "  const refused = ['listResumable', 'listUnresumable'].filter((kind) =>\n    output.includes(`BroCrew is shutting down, so ${kind} was not asked of its database`),\n  )\n  if (refused.length === 0) {",
                "  const refused = []\n  if (refused.length === 0 && false) {",
            )
        ],
    ),
    (
        "M22 · ⚠️ the probe is never proved to work · a bridge that could not answer while the app "
        "was HEALTHY would make every assertion after the quit true for the wrong reason",
        [
            (
                CHECK,
                "  if (asking === null || asking.answered === 0) {\n    await fail(\n      `⛔ the app is HEALTHY and its own bridge could not answer listResumable/listUnresumable: `",
                "  if (false) {\n    await fail(\n      `⛔ the app is HEALTHY and its own bridge could not answer: `",
            )
        ],
    ),
    (
        "M23 · ⚠️ the probe's SPEED is never checked · answering four times a second passes every "
        "other assertion here and still walks straight past the window the check exists to look "
        "into",
        [
            (
                CHECK,
                "  const perSecond = (asking.answered * 1_000) / PROVE_THE_PROBE_MS\n  if (perSecond < 100) {\n    await fail(\n      `⛔ the probe answered only ${perSecond.toFixed(0)}/s while the app was healthy, and the window `",
                "  const perSecond = (asking.answered * 1_000) / PROVE_THE_PROBE_MS\n  if (false) {\n    await fail(\n      `⛔ the probe was slow: ${perSecond.toFixed(0)}/s, and the window `",
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
