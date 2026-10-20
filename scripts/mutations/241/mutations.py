#!/usr/bin/env python3
"""241's mutation table — each row is THE DEFECT, put back verbatim (131).

⛔ **This table has a fifth column, and it is the whole point of the dispatch.** `241` is a defect
that four vitest projects and a 96/98 live smoke were all green across, because none of them opens
the shipped app. So `mutate.sh` runs `pnpm run build && pnpm run window:check` as a `window` column
beside the four suites, and the rows below are graded by whether the PRODUCT still opens — not only
by whether a test noticed.

⚑ **Read the two columns together, and they do not mean the same thing.** `desktop` RED with
`window` GREEN is a source pin being stricter than the product needs — legitimate, and worth being
able to see as different. `window` RED has two causes and the row says which: `M1` is **the app not
opening at all**, while `M6` and `M12` are the check's SECOND assertion firing because the gate
stopped working. ⚠️ Only `M1` puts a person in front of no window.

The row groups:

 * `M1`-`M3`   🔴 **§2 · where the scheme registration lives.** The defect verbatim, its absence, and
               a placement that still works today and is forbidden anyway.
 * `M4`, `M12` ⛔ **the gate 241 must not have removed** (`236` §3) — the `await` that caused this,
               and the socket-name length its own review fixed.
 * `M5`-`M9`, `M13`-`M14` ⛔ **§3 · the instrument, and what it demands.** A check that asks for less
               passes just as green as one that asks for enough.
 * `M10`-`M11` ⛔ **§3 · the wiring.** An instrument nothing runs, and one that runs too early.

## 🔴 Round 1 found two survivors and one leak, and all three were mine

⛔ **`M5` and `M9` SURVIVED the first run of this table, both on vacuous pins of my own writing** —
the exact class `193` names. `toContain('const SUN_PATH_MAX = 104')` is satisfied by `1040`, and
`toContain('process.kill(-child.pid')` is satisfied by the liveness probe two lines below the
SIGKILL it was written for. Both pins are now anchored (a regex to end-of-line, and the full call).

⛔ **And `M11` came back `dom INVALID (collected 627 of 686)` · `scripts RED 2` for a reason that had
nothing to do with `M11`**: the check had leaked a live Electron at 11:44 which was still holding
the CPU six hours later. Re-measured with it killed, `M11` is `dom 686/686` and `scripts 250/250`,
exit 0 — so the mutation is killed by the `desktop` pin alone, as designed. ⚑ `M13` and `M14` exist
because of that leak: the port chase that fixed it, and the failure that stops the next one hiding.

## ⛔ What this table cannot reach, stated because a table silent about its edges is claiming them

 * ⚠️ **`M2` and `M3` come back GREEN in `window` — see `mutations.txt` — and that is a REAL limit of
   the instrument, not a gap in this table.** A registration that never happens is not a registration
   that happens late: the app opens, and the symptom is an `<img>` that silently never loads. ⛔ The
   window check cannot see it and does not claim to; `asset-protocol.test.ts` owns the scheme's
   behaviour and the source pins own its placement.
 * ⛔ **No row proves the check FAILS on a real broken build**, because a mutation table restores the
   tree. That was measured directly instead, once, by patching the built bundle back to the 241
   defect and running the check: it exited 1 and printed the `registerSchemesAsPrivileged` stack.
   The transcript of that run is in the response, and it is evidence a table cannot carry.
 * ⚠️ **The `single-instance.ts` and `index.ts` COMMENT changes have no rows.** They are the record
   of why the boundary is where it is; no assertion decides whether prose is true, and `M1` is the
   fact the prose is about.
 * ⛔ **§4 has no rows because §4 was not taken.** See the response for the two mechanisms ruled out.
"""

from pathlib import Path

INDEX = "apps/desktop/src/main/index.ts"
SINGLE = "apps/desktop/src/main/single-instance.ts"
GATE = "apps/desktop/src/main/one-host-gate.ts"
CHECK = "scripts/window-opens-check.mjs"
PKG = "package.json"

REGISTER = "protocol.registerSchemesAsPrivileged([\n  ASSET_SCHEME_PRIVILEGES,\n  THEME_SCHEME_PRIVILEGES,\n  PLUGIN_SCHEME,\n])"

# (name, [(file, old, new), ...])
MUTATIONS = [
    # ---- §2 · where the registration lives ---------------------------------------------------
    (
        "M1  · 🔴 THE DEFECT, verbatim · the scheme registration goes back inside `start()`, where "
        "236 §3's await moved it past `ready` — it throws from the first statement and the app "
        "opens NO WINDOW, with every suite still green",
        [
            # ⚑ **plugin UI host · re-anchored in place, not retired** — NOT VERIFIED. All three schemes share the registration; deletion or late placement remains the same defect.
            (INDEX, "\nprotocol.registerSchemesAsPrivileged([\n  ASSET_SCHEME_PRIVILEGES,\n  THEME_SCHEME_PRIVILEGES,\n  PLUGIN_SCHEME,\n])\n", "\n"),
            (
                INDEX,
                # ⚑ **re-anchored in place, not retired** — `start` now takes the one-app gate's
                # answer as its parameter; the defect this edit puts back (the registration as the
                # first statement of `start`) is unchanged.
                # ⚑ **plugin UI host · re-anchored in place, not retired** — NOT VERIFIED. All three schemes share the registration; deletion or late placement remains the same defect.
                "function start(ownership: HostGateVerdict): void {\n",
                "function start(ownership: HostGateVerdict): void {\n  protocol.registerSchemesAsPrivileged([\n  ASSET_SCHEME_PRIVILEGES,\n  THEME_SCHEME_PRIVILEGES,\n  PLUGIN_SCHEME,\n])\n",
            ),
        ],
    ),
    (
        "M2  · ⛔ the registration is DELETED — the scheme is never privileged at all, so a "
        "generated image loads from nowhere and nothing is logged (067's original failure). ⚠️ "
        "GREEN in `window` by design: the app still opens",
        # ⚑ **plugin UI host · re-anchored in place, not retired** — NOT VERIFIED. All three schemes share the registration; deletion or late placement remains the same defect.
        [(INDEX, "\nprotocol.registerSchemesAsPrivileged([\n  ASSET_SCHEME_PRIVILEGES,\n  THEME_SCHEME_PRIVILEGES,\n  PLUGIN_SCHEME,\n])\n", "\n")],
    ),
    (
        "M3  · ⛔ still module scope, but BELOW `runAsSoleInstance({` — which works today only "
        "because that call's first await yields back here. A placement whose correctness depends on "
        "what the line above it does is the shape 236 already broke once",
        [
            # ⚑ **plugin UI host · re-anchored in place, not retired** — NOT VERIFIED. All three schemes share the registration; deletion or late placement remains the same defect.
            (INDEX, "\nprotocol.registerSchemesAsPrivileged([\n  ASSET_SCHEME_PRIVILEGES,\n  THEME_SCHEME_PRIVILEGES,\n  PLUGIN_SCHEME,\n])\n", "\n"),
            (
                INDEX,
                # ⚑ **plugin UI host · re-anchored in place, not retired** — NOT VERIFIED. All three schemes share the registration; deletion or late placement remains the same defect.
                "void runAsSoleInstance({",
                "protocol.registerSchemesAsPrivileged([\n  ASSET_SCHEME_PRIVILEGES,\n  THEME_SCHEME_PRIVILEGES,\n  PLUGIN_SCHEME,\n])\nvoid runAsSoleInstance({",
            ),
        ],
    ),
    # ---- the gate 241 must not have removed --------------------------------------------------
    (
        "M4  · ⛔ the `await` in front of the gate is dropped — the naive 'fix' the dispatch "
        "forbids. `start` runs before `ready` again and the app opens, and 236 §3's backstop is "
        "gone: a Promise is never 'taken', so a second live host is never refused",
        [
            (
                SINGLE,
                "const gate = await deps.claimGate().catch(() => 'unknown' as const)",
                "const gate = deps.claimGate() as unknown as 'unknown'",
            )
        ],
    ),
    # ---- §3 · the instrument, and what it demands ---------------------------------------------
    (
        "M5  · ⛔ the socket-length precondition is raised out of the way — the check may then run "
        "on a path where the gate fails open, which is the exact configuration that hid 241 from "
        "smoke:ui, smoke:resume and smoke:packaged",
        [(CHECK, "const SUN_PATH_MAX = 104", "const SUN_PATH_MAX = 1040")],
    ),
    (
        "M6  · ⛔ the check looks for a socket the gate never writes — so 'the backstop ran' is "
        "asserted about a name nothing binds",
        [(CHECK, "const GATE_SOCKET = 'one-host.sock'", "const GATE_SOCKET = 'host.sock'")],
    ),
    (
        "M7  · ⛔ the gate assertion is neutered — the check goes green on a launch whose gate "
        "failed open, and starts reporting the masked configuration as a healthy one",
        [(CHECK, "  if (!gateRan) {", "  if (false && !gateRan) {")],
    ),
    (
        "M8  · ⛔ the page filter drops back to `type === 'page'` — a target exists the moment "
        "`new BrowserWindow()` runs, so the check passes on an empty window (measured: 0.8 s, "
        "`(untitled)`) and stops meaning that the renderer loaded",
        [
            (
                CHECK,
                "          target.type === 'page' &&\n"
                "          typeof target.url === 'string' &&\n"
                "          target.url !== '' &&\n"
                "          target.url !== 'about:blank',",
                "          target.type === 'page',",
            )
        ],
    ),
    # ⚑ **ANCHOR CORRECTED IN PLACE BY 326 §2** (142), and this one is the subtle case: the old
    # text still exists in the file exactly once, so `--dry-run` stayed GREEN and the row would have
    # recorded a verdict about a different line. `326` replaced this check's teardown with
    # `owned-teardown.mjs`'s rule, and the only surviving `process.kill(-child.pid, 'SIGKILL')` is
    # now the last-resort kill on the ownership-capture failure path — which nothing tests, so the
    # row would have SURVIVED while its label still read as a claim about the reap.
    #
    # ⚑ **The PREMISE is unchanged and so is the label**: killing the launch by its own handle is
    # still killing the shim rather than the app. `tearDownAndRemove` is where the whole owned family
    # is signalled now, so that is the line the claim is about, and the same edit is written against
    # it. ⛔ Its killers are `one-app.test.ts`'s `tearDownAndRemove({ lifecycle, … })` pin and
    # `owned-teardown.test.mjs`'s positional rmSync pin, both of which go red on the replacement.
    (
        "M9  · ⛔ the app is killed by HANDLE instead of by GROUP — `.bin/electron` is a shim, so "
        "this kills the shim and not the app. ⚠️ SURVIVED round 1 on a vacuous pin: the liveness "
        "probe `process.kill(-child.pid, 0)` satisfied the same substring the SIGKILL was pinned by",
        [
            (
                CHECK,
                "    const outcome = tearDownAndRemove({ lifecycle, directory: userDataDir })",
                "    child.kill('SIGKILL')\n"
                "    const outcome = { complete: true, remaining: [], unverifiable: [] }\n"
                "    rmSync(userDataDir, { recursive: true, force: true })",
            )
        ],
    ),
    # ---- §3 · the wiring ----------------------------------------------------------------------
    # ⚠️ **THIS ROW'S ANCHOR IS STALE, and 326 deliberately did not correct it.** ` && pnpm run
    # window:check",` matched when `window:check` ended the chain; `271` appended `quit:check` and
    # `301` appended `fixture:check`, so the string has not existed since. Verified on `main` at
    # `73a2afa`, where it also matches zero times — this is not 326's drift, and `301 §5` forbids
    # correcting another dispatch's evidence to land a fix nobody asked for. ⛔ Recorded rather than
    # left to be rediscovered: as it stands this row cannot fail, which is 260's shape.
    (
        "M10 · ⛔ `window:check` is removed from the ci chain — the instrument still exists, still "
        "passes when run by hand, and guards nothing. 'A correct policy that nothing calls leaves "
        "the defect exactly where it was'",
        # ⚑ **Re-anchored by `522`**, which found the anchor dead: it ended at `window:check",`
        # and `294` then `301` appended `quit:check` and `fixture:check` after it, so the row had
        # been matching nothing for eight dispatches — `an-anchor-on-a-lists-last-member-dies-when-anything-appends`.
        # ⛔ The DEFECT is unchanged and still killed by `one-app.test.ts`'s
        # *"window:check is not in the gate — nothing runs it"*; only the neighbours it names moved.
        [
            (
                PKG,
                "pnpm run build && pnpm run window:check && pnpm run quit:check",
                "pnpm run build && pnpm run quit:check",
            )
        ],
    ),
    (
        "M11 · ⛔ …and the subtler one: it runs BEFORE `build`, so it launches whatever the last "
        "run left on disk — a green about a bundle that is not the one under test",
        [
            (
                PKG,
                "pnpm run test && pnpm run build && pnpm run window:check",
                "pnpm run test && pnpm run window:check && pnpm run build",
            )
        ],
    ),
    # ---- the gate's own length fix (236 §3, found in its review) ------------------------------
    (
        "M12 · ⛔ the gate's PRIVATE name grows past `sun_path` again — 236's review shortened it "
        "for exactly this reason. `listen` fails, the gate fails open on every ordinary directory, "
        "and the window check catches it because the socket it looks for is never written",
        [
            (
                GATE,
                # ⚑ **re-anchored in place, not retired** — the private name inside `userData` is now
                # one arm of a choice made in `posixGate`; the defect this edit puts back, a private
                # name longer than the public one, is unchanged.
                "      privateName: (token) => join(userData, `.oh-${digest(token).slice(0, 8)}`),",
                "      privateName: (token) => join(userData, `.one-host-private-claim-${digest(token)}`),",
            )
        ],
    ),
    # ---- §3 · the reaping, which round 1 got wrong -------------------------------------------
    # ⚑ **ANCHOR CORRECTED IN PLACE BY 326 §2** (142). The PREMISE stands: this row is about the
    # reap trusting the group signal and nothing else, which is what left a full Electron running for
    # six hours. ⛔ What changed is the fact the check chases INSTEAD of the group. 241 chased the
    # PORT; `325` measured that this swapped one wrong fact for another — the port is one socket of
    # one of five processes, and `lsof` exits non-zero when it finds nothing, so the wait failed OPEN
    # — and `326` replaced it with `owned-process.mjs`'s identity reap. The edit below is the same
    # defect against the same claim: the family the teardown waits for is emptied, so nothing but the
    # group signal is left. Killed by `one-app.test.ts`'s `discoverDescendants: descendantsOf` pin.
    (
        "M13 · 🔴 the PORT CHASE is removed — the check goes back to trusting the group signal, "
        "which is what left a full Electron running for six hours and turned M11's `dom` and "
        "`scripts` columns into INVALID/RED in round 1",
        [(CHECK, "        discoverDescendants: descendantsOf,", "        discoverDescendants: null,")],
    ),
    # ⚑ **ANCHOR CORRECTED IN PLACE BY 326 §2** (142). Same premise, same defect, new name for the
    # same fact: `leaked` was the list of pids still holding the port, and `outcome.complete` is now
    # *"nothing owned is alive AND nothing was unverifiable"* — a strictly stronger version of the
    # question this row disables.
    (
        "M14 · ⛔ a leak stops being a failure — the check reaps what it can, finds the app still "
        "holding its port, and prints its green anyway. ⚠️ This was the shipped behaviour in round "
        "1 (a `console.error` and exit 0), and it is why the leak went unnoticed for six hours",
        [(CHECK, "  if (!outcome.complete) {", "  if (false && !outcome.complete) {")],
    ),
]


def apply(root: Path, index: int, dry: bool = False) -> int:
    """Apply one mutation. Returns the number of edits that did not apply cleanly."""
    _name, edits = MUTATIONS[index]
    name = _name.split(" ")[0]
    bad = 0
    for rel, find, replace in edits:
        path = root / rel
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
