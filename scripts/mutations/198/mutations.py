#!/usr/bin/env python3
"""198's mutation table — each row is THE DEFECT, put back verbatim (131).

⛔ **Two rows here exist because two OLD rows died in this dispatch.** `163 M5` and `163 M6` anchored
on the signal-handler registration in `index.ts`, which 198 moved inside `start()` — so the block is
indented two spaces further and `mutations:check` failed CI and named them. 188's rule is
retire-in-place-and-carry-the-protection-forward, not delete: rows **M23-M24** below are those two
defects restored in the code that replaced them, so nothing 163 proved stops being proved.

⚠️ **What this table cannot reach**, stated because a table silent about its edges is claiming them:

  * **The lock itself.** `requestSingleInstanceLock` is Chromium's, and every fact about it that
    this dispatch rests on — per-`userData` keying, and a stale `SingletonLock` being broken rather
    than honoured — was measured with a real Electron binary before any of this was built (see
    `single-instance.ts`). What the rows below mutate is the POLICY around it: who calls it, what
    happens to the loser, and whether anything of ours could go stale beside it.
  * **`index.ts` runs in no test.** It imports `electron` as a value, so the two rows that touch it
    are caught by tests that read it as TEXT (`app-lifetime.test.ts`, `one-app.test.ts`). That is
    weaker than executing it and it is what there is; it is also exactly how `163` proved the same
    two rows.
  * **The COUNT in `whileBuilding`.** A `Set` would behave identically for every derive `pnpm run
    ci` can drive, because nothing in the suite overlaps two derives of ONE session. The count is
    there for the case 186 names — a guard failing in the direction that hides the defect — and it
    is unproved. M13 mutates whether the tracking happens at all, not how it counts.
  * **`sweep.ts`'s own derive.** `runSweep` calls `deriveLedgerFromArchive` inside the sweep, where
    the host cannot name the session it is on, so a sweep's `building` marker is NOT reported by
    `workInFlight`. Reachable only with two hosts in one process AND a concurrent sweep; ranked in
    the response doc's §4 beside 191 M6 rather than closed here.
  * **`apps/desktop/src/renderer/**` and `packages/**` — nothing moved there, so projects `dom`,
    `runtime` and `shared` are not run. Every file this table touches is under `apps/desktop/src`.

⛔ **One row was written, came back GREEN, and deleted the code it was aimed at.** The first M12 was
*"leaving the directory does nothing"* — and it was right: `RuntimeHost.closeAll()` used to leave,
described as tidy-up, and nothing could observe whether it did. Worse, the one window where it COULD
have been observed is one where it would have been WRONG — a derive that outlives `closeAll` is still
writing, and a host that had left would have stopped reporting it. The call is gone; `live-hosts.ts`
carries the argument, and the slot in this table now holds a row that kills a test.


The shape is 163's `(name, [(file, old, new), …])` rather than 197's four-tuple, because M23 has to
delete a block in one place and put it back in another — a single edit cannot express "moved".
⛔ **Do not apply these by hand** — `mutate.sh` owns the tree, takes 196's repository-global lock,
and restores from a pristine copy keyed by FULL relative path.
"""

from __future__ import annotations

import sys

SINGLE = "apps/desktop/src/main/single-instance.ts"
LIVE = "apps/desktop/src/main/runtime/live-hosts.ts"
HOST = "apps/desktop/src/main/runtime/runtime-host.ts"
STORE = "apps/desktop/src/main/db/session-store.ts"
UNAVAIL = "apps/desktop/src/main/runtime/session-unavailable.ts"
INDEX = "apps/desktop/src/main/index.ts"

REGISTRATION = """      for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP'] as const) {
        process.on(signal, () => lifetime.quitSignal(signal))
      }
"""

CLASSIFY = "    if (host === self || host.ledger !== self.ledger) continue\n"

# (name, [(file, old, new), …])
MUTATIONS = [
    # ---- §1 · the lock ---------------------------------------------------------------------
    (
        "M1  · ⛔ THE DEFECT · there is no lock at all — every launch starts a second database, a "
        "second set of homes and a second host, which is 191 H6/H7/H8 and 194 H1/H2 at once",
        [
            (
                SINGLE,
                """  if (!deps.requestLock()) {
    deps.log(STOOD_DOWN_NOTICE)
    deps.standDown()
    return 'already-running'
  }
""",
                "",
            )
        ],
    ),
    (
        "M2  · ⛔ the loser stands down and starts the app anyway — a quit is not a fence, and "
        "constructing the host is 194 H1's whole mechanism",
        [
            (
                SINGLE,
                # ⚑ Re-anchored at 236 §3: the gate added a SECOND stand-down with the same two
                # lines, so the anchor now carries the lock's own `if` to stay unique. The defect
                # is unchanged — this row is re-run in `scripts/mutations/236`.
                "  if (!deps.requestLock()) {\n"
                "    deps.log(STOOD_DOWN_NOTICE)\n    deps.standDown()\n",
                "  if (!deps.requestLock()) {\n"
                "    deps.log(STOOD_DOWN_NOTICE)\n    deps.start()\n    deps.standDown()\n",
            )
        ],
    ),
    (
        "M3  · ⛔ 106 IS BACK · a second launch does nothing visible: no window comes forward",
        [(SINGLE, "    deps.focusExisting()\n", "")],
    ),
    (
        "M4  · ⛔ …and nothing is said, so a double-click that looks like a no-op IS one",
        [(SINGLE, "    deps.announce(SECOND_LAUNCH_NOTICE)\n", "")],
    ),
    (
        "M5  · ⛔ no `second-instance` handler at all — the running app never hears the launch",
        [
            (
                SINGLE,
                """  deps.onSecondLaunch(() => {
    deps.focusExisting()
    deps.announce(SECOND_LAUNCH_NOTICE)
  })
""",
                "",
            )
        ],
    ),
    (
        "M6  · ⛔ a SECOND GATE of our own, which is the thing 191 M5 reports going stale: a "
        "sticky refusal that outlives the process that earned it",
        [
            (
                SINGLE,
                # ⚑ Re-anchored at 236 §3: the function is async now, because the cross-process
                # gate is awaited inside it. The defect — a sticky refusal of our own, which is
                # what 191 M5 reports going stale — is unchanged, and re-run in `236`.
                "export async function runAsSoleInstance(deps: SoleInstanceDeps): "
                "Promise<InstanceVerdict> {\n"
                "  if (!deps.requestLock()) {\n",
                "let everStoodDown = false\n"
                "export async function runAsSoleInstance(deps: SoleInstanceDeps): "
                "Promise<InstanceVerdict> {\n"
                "  if (everStoodDown || !deps.requestLock()) {\n"
                "    everStoodDown = true\n",
            )
        ],
    ),
    (
        "M7  · ⛔ the notice stops naming what a second copy would share, so the sentence is a "
        "refusal with no reason in it (151/169's register)",
        [
            (
                SINGLE,
                "  'BroCrew is already running — this is that window. A second copy would share one database and ' +\n"
                "  'the same sign-ins with this one, so it was not started.'",
                "  'BroCrew could not be started.'",
            )
        ],
    ),
    # ---- §2 · the ownership test, which holds with no lock in it ------------------------------
    (
        "M8  · ⛔ THE DEFECT · the directory answers 'nothing is running' whatever is running, so "
        "startup repair walks over a live conversation exactly as 194 H1 describes",
        [(LIVE, "    for (const id of host.workInFlight()) elsewhere.add(id)\n", "")],
    ),
    (
        "M9  · ⛔ the ledger stops mattering, so a host over ANOTHER database strands a row here — "
        "074's defect, reintroduced by its own guard",
        [(LIVE, CLASSIFY, "    if (host === self) continue\n")],
    ),
    (
        "M10 · ⛔ a host is asked about ITSELF, so the guard becomes permanent rather than about "
        "other hosts",
        [(LIVE, CLASSIFY, "    if (host.ledger !== self.ledger) continue\n")],
    ),
    (
        "M11 · ⛔ joining the directory does nothing, so every host is invisible to every other",
        [(LIVE, "  directory.add(host)\n", "")],
    ),
    (
        "M12 · ⛔ the running window is told before it is raised, so the sheet arrives on a window "
        "still behind whatever the user was looking at",
        [
            (
                SINGLE,
                "    deps.focusExisting()\n    deps.announce(SECOND_LAUNCH_NOTICE)\n",
                "    deps.announce(SECOND_LAUNCH_NOTICE)\n    deps.focusExisting()\n",
            )
        ],
    ),
    (
        "M13 · ⛔ 194 H1's SECOND failure · a rebuild in flight is invisible, because "
        "`rebuildLedger` refuses a session in `slots` and so no slot ever names one",
        [
            (
                HOST,
                "    this.building.set(sessionId, (this.building.get(sessionId) ?? 0) + 1)\n",
                "",
            )
        ],
    ),
    (
        "M14 · ⛔ …and the other half: a session in a slot is invisible, so a live conversation is "
        "settled while its provider is mid-answer",
        [
            (
                HOST,
                "    return [...this.slots.keys(), ...this.building.keys()]",
                "    return [...this.building.keys()]",
            )
        ],
    ),
    (
        "M15 · ⛔ 062 IS BACK · only REGISTERED sessions count, so the window between reserving an "
        "id and the provider arriving is one a second host repairs straight through",
        [
            (
                HOST,
                "    return [...this.slots.keys(), ...this.building.keys()]",
                "    return [...this.sessionIds, ...this.building.keys()]",
            )
        ],
    ),
    (
        "M16 · ⛔ the constructor asks nobody and hands the repair an empty set — the guard exists "
        "and is not wired, which is `orphan-runs.test.ts`'s own lesson about its own repair",
        [
            (
                HOST,
                '    const elsewhere = workRunningElsewhere(this)\n    // ⚑ **The moment this launch began**, before any repair writes a row: what a restart stopped is\n    // timed by the ledger as it stood then ({@link wakeWhatTheRestartStopped}).\n    const launchedAt = this.now()',
                '    const elsewhere: ReadonlySet<string> = new Set()\n    // ⚑ **The moment this launch began**, before any repair writes a row: what a restart stopped is\n    // timed by the ledger as it stood then ({@link wakeWhatTheRestartStopped}).\n    const launchedAt = this.now()',
            )
        ],
    ),
    (
        "M17 · ⛔ the STORE ignores what is running and settles every busy-looking row",
        [(STORE, "    const stranded = rows.filter((row) => !running.has(row.id))\n", "")],
    ),
    (
        "M18 · ⛔ …and reports rows SCANNED as rows settled, so the launch log claims repairs the "
        "app deliberately did not make",
        [(STORE, "    return stranded.length\n", "    return rows.length\n")],
    ),
    (
        "M19 · ⛔ the rebuild marker of a live build is cleared again — the caller is then told the "
        "import succeeded while the old projection stays active",
        [(STORE, "      if (running.has(row.session_id)) continue\n", "")],
    ),
    # ---- §3 · resume ownership (191 H7 / 194 H2) ----------------------------------------------
    (
        "M20 · ⛔ two hosts can reserve one conversation again [anchor corrected in place by 336: the diagnostic now spells an absent owner through `ownerName`, because `ownerId` became `string | null`. The mutation — deleting the whole guard — is unchanged]: both read the same `nextOrdinal`, "
        "one loses the unique-index race and stops recording for the rest of that session's life",
        [
            (
                HOST,
                """    if (workRunningElsewhere(this).has(id)) {
      throw new SessionUnavailable(
        'run-by-another-host',
        `session ${id} is being run by another RuntimeHost in this process (asked for by ` +
          `${ownerName(ownerId)})`,
      )
    }
""",
                "",
            )
        ],
    ),
    (
        "M21 · ⛔ the refusal loses its way forward, so a person is told no and given nothing to do "
        "(151's register, and `session-unavailable.test.ts`'s rule)",
                # ⚑ **716 · re-anchored in place, not retired** — `710` F-5 rewrote the sentence's way forward (*"It can be reopened here once that part has closed it"*, no longer *"Try again in a moment"*); the mutation still drops it.
        # ⚑ Landing D-017b (3af91dcb) · re-anchored in place, not retired — The rule survives: the
        # run-by-another-host refusal must still give a way forward instead of a bare no. D-017b
        # reworded its last sentence from 'It can be reopened here once that part has closed it.' to
        # 'It can continue here once that part has let it go.', so the plant drops that new
        # sentence.
        [
            (UNAVAIL, "      return 'This conversation is already being run by another part of BroCrew, and only one part can drive it at a time, so it was not opened here. It can continue here once that part has let it go.'", "      return 'This conversation is already being run by another part of BroCrew, and only one part can drive it at a time, so it was not opened here.'"),
        ],
    ),
    (
        "M22 · ⛔ 191 H8 · a second host rebuilds a conversation the first is running, promoting a "
        "new active generation underneath a live writer",
        [
            (
                HOST,
                "    if (this.slots.has(sessionId) || workRunningElsewhere(this).has(sessionId)) {\n",
                "    if (this.slots.has(sessionId)) {\n",
            )
        ],
    ),
    # ---- §4 · carried forward from 163, whose anchors this dispatch moved ----------------------
    (
        "M23 · ⚑ 163 M5, restored · 075 IS BACK · the listeners move to module scope, where "
        "Chromium overwrites them and they never fire",
        [
            (INDEX, REGISTRATION, ""),
            (
                INDEX,
                "app.on('before-quit', (event) => lifetime.beforeQuit(event))\n",
                "for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP'] as const) {\n"
                "  process.on(signal, () => lifetime.quitSignal(signal))\n}\n"
                "app.on('before-quit', (event) => lifetime.beforeQuit(event))\n",
            ),
        ],
    ),
    (
        "M24 · ⚑ 163 M6, restored · …or they go entirely, leaving Chromium's one-shot handler in "
        "charge again",
        [(INDEX, REGISTRATION, "")],
    ),
]


def apply(root, index: int, dry: bool) -> int:
    name, edits = MUTATIONS[index]
    bad = 0
    for rel, find, replace in edits:
        path = root / rel
        text = path.read_text()
        hits = text.count(find)
        if hits != 1:
            print(
                f"!! {name}: anchor found {hits} times in {rel} (expected exactly 1)",
                file=sys.stderr,
            )
            bad += 1
            continue
        if not dry:
            path.write_text(text.replace(find, replace, 1))
    return 1 if bad else 0


def main() -> int:
    from pathlib import Path

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
