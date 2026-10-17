"""326 · The last two gates that report the machine — each row is THE DEFECT, put back verbatim (131).

⛔ **What 326 fixed, in two sentences.** `quit:check` read its three observations in one pass in
written order and stamped each when its own answer came back, so *"has the app gone?"* — which costs
nothing — could not be sampled until a CDP probe **and** an `lsof` had both returned; and its port
budget was measured from the moment we asked the app to quit, so the app was charged for the time
this check spent asking. `window:check` still reaped by chasing the debug port and removed its
`--user-data-dir` on that fact, which is `325`'s defect character for character.

## ⚑ The evidence, because otherwise these rows are a story about a race

Instrumented on this machine at load ≈ 66, `quit:check`'s own sampling loop:

```
PROBE #1 at +0ms · targets 9ms · holdersOf 21295ms · alive 0ms || port=21304 proc=21304 · stat="(none)"
⛔ THE APP DID NOT CLOSE. pid 76042 … still running 21304ms later (budget 5000ms).
BroBot2 shut down in 2005ms — … · BroBot2 reached Electron's quit at +110ms
```

⚠️ **`stat="(none)"` is the whole finding**: the same iteration's `ps` found no such process, so the
app was already gone before that `lsof` was issued. **Nineteen instrumented runs of the incumbent
went RED 4 times** (21,304 / 14,313 / 14,409 / 12,399 ms), and in six of the seven runs where the app
was already gone at the first sample **100.0 % of the reported close time was the instrument**. The
two logs `quit:check` left in `os.tmpdir()` from its two red runs that day show a perfect quit in
both — every step named, `will-quit`/`quit` at +107 ms and +110 ms, both refusals present.

⛔ **And `lsof` cannot say *"I do not know"*.** `lsof -t` exits **1 when it matches nothing**, so the
ordinary answer arrives as a thrown `Command failed` and the `holdersOf` these gates shared returned
`[]` from that catch: **every *"the port is free"* this repository ever printed came out of a
`catch` block.** Measured at the same moment under load, 25 samples each — `lsof` p50 277 ms / max
622 ms; binding the port p50 **0 ms** / max **2 ms**, and it is also the question a person
relaunching actually asks.

## 🔴 Which instrument can see each row

⚠️ **Every row below is killed by `pnpm run test`.** That is deliberate and it is not the usual shape
for a gate repair: the three-state classification is a module with a unit test, and everything in the
two `.mjs` files is held by source pins in `one-app.test.ts`, `owned-teardown.test.mjs` and
`port-probe.test.mjs` — because `ci` covers a gate going red when the product breaks and covers
nothing at all about the gate being quietly rewritten.

⚑ **`M20` is the exception worth naming**: it is killed only by the ONE test that talks to the real
`lsof`, which is what stops the other five classification rows being a closed loop between this
file's model of `lsof` and this file's test of that model (`a-test-that-plants-and-finds-with-one-
derivation`).

## ⚠️ What this table deliberately does NOT contain

⛔ **No row mutates `scripts/mutations/241/mutations.py`.** Three of its anchors — `M9`, `M13`, `M14`
— were reddened by this dispatch's edits and are corrected IN PLACE beside the rows, with the reason
written there (142, the way `314` handled `170 M7`). ⚠️ **`241 M10` was already stale on `main` at
`73a2afa`** and is left alone and disclosed: correcting another dispatch's evidence to land a fix
nobody asked for is what `301 §5` forbids.
"""

from pathlib import Path

PROBE = "scripts/lib/port-probe.mjs"
QUIT = "scripts/app-closes-check.mjs"
WINDOW = "scripts/window-opens-check.mjs"

MUTATIONS = [
    # ── §1 · the third answer, which neither instrument used to be able to give ───────────────
    (
        "M1 · ⛔ THE DEFECT, verbatim · `lsof` exiting 1 becomes *\"nothing is listening\"* again "
        "whatever it said on stderr, so a complaining or a killed `lsof` is indistinguishable from "
        "an empty port. ⚑ This is the fail-open rebuilt one layer in from where it was removed — "
        "and `stderr` is the discriminator the old `holdersOf` threw away (`stdio: […, 'ignore']`)",
        [
            (
                PROBE,
                "    if (\n"
                "      error.status === 1 &&\n"
                "      error.signal === null &&\n"
                "      error.code === undefined &&\n"
                "      complaint === ''\n"
                "    ) {",
                "    if (error.status === 1) {",
            )
        ],
    ),
    (
        "M2 · 🔴 a FAILURE is reported as a free port. ⚠️ `325` measured what this costs: a stand-in "
        "`lsof` that exits non-zero declares a held port free in 4 ms, 3 of 3, with every Electron "
        "process still in the table",
        [
            (
                PROBE,
                "  if (result.failed !== undefined) return unknown(result.failed)",
                "  if (result.failed !== undefined) return FREE",
            )
        ],
    ),
    (
        "M3 · ⛔ a zero exit whose pids this cannot parse becomes an empty port — but a zero exit "
        "means `lsof` MATCHED, so this is the check failing to read an answer being reported as the "
        "kernel saying there is nobody there",
        [
            (
                PROBE,
                "  if (pids.length === 0) {\n"
                "    return unknown(\n"
                "      `lsof matched something on port ${String(port)} that this check could not read: ` +\n"
                "        `${JSON.stringify(String(result.found))}`,\n"
                "    )\n"
                "  }",
                "  if (pids.length === 0) return FREE",
            )
        ],
    ),
    (
        "M4 · ⛔ every bind failure that is not `EADDRINUSE` is read as a free port. ⚠️ `EACCES` on a "
        "privileged port and `EMFILE` on a machine out of descriptors are this check being unable to "
        "ask — and a machine out of descriptors is a LOADED machine, which is when every failure in "
        "this family happens",
        [
            (
                PROBE,
                "          : unknown(`binding 127.0.0.1:${String(port)} failed with ${error.code ?? error.message}`),",
                "          : FREE,",
            )
        ],
    ),
    (
        "M5 · 🔴 the allocator probe can no longer see a HELD port at all, so it answers `unknown` "
        "while the app is up and `free` the moment it is not. ⛔ Without the positive half, "
        "`quit:check`'s port assertion is satisfied by an instrument that never says held",
        [
            (
                PROBE,
                "        error.code === 'EADDRINUSE'",
                "        error.code === 'EADDRINUSE-NEVER'",
            )
        ],
    ),
    (
        "M6 · ⚠️ the fast DECISION starts carrying an empty `pids`, so a caller can print an "
        "identification it never made. ⛔ Keeping the two shapes apart is what stops `couldBindPort` "
        "being mistaken for `whoHoldsPort`; an empty list reads as *\"held by nobody\"*",
        [
            (
                PROBE,
                "          ? Object.freeze({ state: 'held' })",
                "          ? Object.freeze({ state: 'held', pids: [] })",
            )
        ],
    ),
    # ── §2 · the sampling loop that reported the machine ──────────────────────────────────────
    (
        "M7 · ⛔ THE DEFECT, verbatim · the free fact is sampled LAST again, so *\"has the app "
        "gone?\"* cannot be answered until a CDP probe and a port probe have both returned. ⚑ This "
        "is the shape that produced `still running 21304ms later` about an app that had already "
        "exited — and every timestamp in the loop is still taken correctly, which is why the killer "
        "has to be about ORDER",
        [
            (
                QUIT,
                "    const askingProcess = Date.now()\n"
                "    if (processGoneAt === null && !alive(appPid)) processGoneAt = askingProcess\n"
                "    if (portFreeAt === null) {\n"
                "      // ⚑ The kernel's own allocator",
                "    if (portFreeAt === null) {\n      // ⚑ The kernel's own allocator",
            ),
            (
                QUIT,
                "    if (windowGoneAt !== null && portFreeAt !== null && processGoneAt !== null) break",
                "    const askingProcess = Date.now()\n"
                "    if (processGoneAt === null && !alive(appPid)) processGoneAt = askingProcess\n"
                "    if (windowGoneAt !== null && portFreeAt !== null && processGoneAt !== null) break",
            ),
        ],
    ),
    (
        "M8 · 🔴 the process fact is stamped when the ANSWER came back rather than when it was "
        "asked, so the cost of everything before it in the iteration is charged to the app again. "
        "⚠️ Sampling first is only half the repair: on the 21 s run the reported number would still "
        "have been the `lsof`",
        [
            (
                QUIT,
                "    if (processGoneAt === null && !alive(appPid)) processGoneAt = askingProcess",
                "    if (processGoneAt === null && !alive(appPid)) processGoneAt = Date.now()",
            )
        ],
    ),
    (
        "M9 · ⚠️ …and the same for the port, which is the one an unbounded probe can move furthest",
        [
            (
                QUIT,
                "      if (answer.state === 'free') portFreeAt = askingPort",
                "      if (answer.state === 'free') portFreeAt = Date.now()",
            )
        ],
    ),
    (
        "M10 · ⛔ the port budget goes back to being measured from the GESTURE, so the app is "
        "charged for the time this check spent asking — `326` §1's second half, and the reason "
        "moving `alive()` up on its own was measured and reverted by `325`",
        [
            (
                QUIT,
                "  if (portFreeAt - processGoneAt > PORT_RELEASE_MS) {",
                "  if (portFreeAt - askedAt > QUIT_BUDGET_MS) {",
            )
        ],
    ),
    (
        "M11 · 🔴 *\"I do not know\"* becomes *\"free\"* at the one place it decides a timestamp. ⛔ "
        "The third state is worth nothing if a caller collapses it: this is `holdersOf`'s `catch` "
        "wearing a `state` field",
        [
            (
                QUIT,
                "      if (answer.state === 'free') portFreeAt = askingPort",
                "      if (answer.state !== 'held') portFreeAt = askingPort",
            )
        ],
    ),
    (
        "M12 · ⛔ the port instrument is never proved able to see THIS app, so every assertion about "
        "the port being released passes over a probe that might answer `free` unconditionally — "
        "241's vacuity, aimed at the instrument 326 introduced",
        [
            (
                QUIT,
                "  if (heldWhileUp.state !== 'held') {",
                "  if (heldWhileUp.state === 'never') {",
            )
        ],
    ),
    (
        "M13 · ⚠️ an unreadable port stops being reported as the INSTRUMENT and is reported as the "
        "app holding the port. ⛔ It is still red, which is why this row is about the message and "
        "not about the verdict: a person debugging a broken `lsof` would be sent to look at the "
        "product, which is 326's own subject in miniature",
        [
            (
                QUIT,
                "    if (portUnreadable.length > 0 && holdingNow.state !== 'held') {\n"
                "      await fail(\n"
                "        `⛔ THIS CHECK COULD NOT FIND OUT whether port ${String(port)} was released.\\n` +",
                "    if (false) {\n"
                "      await fail(\n"
                "        `⛔ the port was not released.\\n` +",
            )
        ],
    ),
    # ── §3 · the teardowns, which are 325's rule in the two files it declined ──────────────────
    (
        "M14 · ⛔ `window:check` keeps its own removal below the launch again — the one line whose "
        "POSITION is the defect. ⚑ It is put back exactly where the old `stop()` had it, after a "
        "wait on the port, which is the version that failed `324`'s merge with ENOTEMPTY",
        [
            (
                WINDOW,
                "    const outcome = tearDownAndRemove({ lifecycle, directory: userDataDir })\n    child.stdout.destroy()",
                "    const outcome = tearDownAndRemove({ lifecycle, directory: userDataDir })\n"
                "    rmSync(userDataDir, { recursive: true, force: true })\n    child.stdout.destroy()",
            )
        ],
    ),
    (
        "M15 · ⛔ …and the same in `quit:check`, which spawns the provider children that made this "
        "a dispatch: `325` found `provider-homes/…/codex/models_cache.json` written into the temp "
        "home at the second the check was tearing down",
        [
            (
                QUIT,
                "  const outcome = reap()\n  // ⚠️ Only on the way out clean:",
                "  const outcome = reap()\n"
                "  rmSync(userDataDir, { recursive: true, force: true })\n"
                "  // ⚠️ Only on the way out clean:",
            )
        ],
    ),
    (
        "M16 · ⚠️ `window:check` no longer remembers the Electron helpers while the app is UP. ⛔ "
        "`refreshDescendants` is a no-op once the launcher is gone and `remember()` refuses a pid "
        "whose parent it never saw, so a crash between the window appearing and the teardown leaves "
        "four processes that nothing has authority to signal",
        [(WINDOW, "  lifecycle.refreshDescendants()", "  void 0")],
    ),
    (
        "M17 · ⚠️ …and the same in `quit:check`, where the gap is wider: it settles for three "
        "seconds with a live app before it asks anything",
        [(QUIT, "  lifecycle.refreshDescendants()", "  void 0")],
    ),
    (
        "M18 · 🔴 a teardown that THROWS replaces the failure being reported instead of being "
        "appended to it. ⛔ That is the exact shape of the merge failure `325` was dispatched for: "
        "the run would name its own `rmSync` where it should have named what the app did",
        [
            (
                QUIT,
                "    let aside = ''\n"
                "    try {\n"
                "      const outcome = reap()\n"
                "      if (!outcome.complete) aside = `   ${unreaped(outcome)}\\n`\n"
                "    } catch (teardownFailure) {\n"
                "      aside = `   ⛔ …and the teardown itself failed: ${teardownFailure.message}\\n`\n"
                "    }",
                "    let aside = ''\n"
                "    const outcome = reap()\n"
                "    if (!outcome.complete) aside = `   ${unreaped(outcome)}\\n`",
            )
        ],
    ),
    (
        "M19 · ⛔ `quit:check` owns its launch but never discovers its family, so the teardown waits "
        "for the `.bin/electron` shim alone and reports `complete` with four Electron processes and "
        "a provider child still coming down",
        [
            (
                QUIT,
                "        discoverDescendants: descendantsOf,",
                "        discoverDescendants: null,",
            )
        ],
    ),
    # ── the row that keeps the five above from being a closed loop ─────────────────────────────
    (
        "M20 · ⚠️ `lsof` is bounded so tightly that it can never answer, so `whoHoldsPort` returns "
        "`unknown` for every port on every machine and `quit:check` cannot find the app to ask it to "
        "quit. ⚑ Killed ONLY by the one test that talks to the real binary — the five classification "
        "rows above are this file's model of `lsof` checked against this file's model of `lsof`, and "
        "this is the row that proves the oracle beside them is doing work",
        [(PROBE, "const LSOF_TIMEOUT_MS = 30_000", "const LSOF_TIMEOUT_MS = 1")],
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
