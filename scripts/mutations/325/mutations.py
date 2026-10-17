"""325 · A gate that trips on its own cleanup — each row is THE DEFECT, put back verbatim (131).

⛔ **What 325 fixed, in one sentence.** `fixture:check` removed its temp `--user-data-dir` as soon as
one TCP port read free, which is one socket of one of five processes — and the app spawns a
`codex app-server` for its provider-auth probe, `detached: true` into its own process group, which
`kill(-child.pid)` never reaches; that child writes `provider-homes/…/codex/models_cache.json` on
its way out, and when the write lands inside the removal's walk `rmSync` throws
`ENOTEMPTY, Directory not empty:` and the gate goes red for its own housekeeping.

## ⚑ The evidence, because this row set is otherwise a guess about a race

The directory from the reported failure was still on disk and held exactly that file, stamped
`"fetched_at": "2026-09-04T14:37:58.877182Z"` — the second the check was tearing down. **Six such
directories were there**, one per run whose late write landed after the removal rather than during
it: the gate had been leaving them behind, green, for as long as the probe has existed.

## 🔴 Which gate can see each row

⚠️ **Not all of them are the same gate**, and saying so here is the point — a survivor below is not
automatically a coverage gap and a reader has to be able to tell which kind it is.

| rows | the defect is caught by |
|---|---|
| `M1`-`M8` | ⚑ **`run_suite`** — `scripts/test/owned-teardown.test.mjs`, named per row |
| `M9`-`M10` | ⚑ **`run_suite`** — the same file's source pins on the check itself |
| `M11`-`M12` | ⛔ **`pnpm run fixture:check`**, and by nothing in the four vitest projects — the same
  position `301 M22`-`M26` are in, recorded here rather than left to read as a gap |

## ⚠️ What this table deliberately does NOT contain

⛔ **No row mutates `scripts/app-closes-check.mjs` or `scripts/window-opens-check.mjs`.** Both carry
the same fail-open teardown and `quit:check` additionally reports instrument latency as the app's
close time — measured, and written up in `325`'s response — but `241 M9`/`M13` anchor on
`window-opens-check.mjs`'s `process.kill(-child.pid, 'SIGKILL')` and `holding = holdersOf(port)`
verbatim. Correcting another dispatch's evidence to land a fix nobody asked for in this one is what
`301 §5` forbids; those two want a number of their own.
"""

TEARDOWN = "scripts/lib/owned-teardown.mjs"
CHECK = "scripts/fixture-follow-check.mjs"

MUTATIONS = [
    # ── the ordering itself ───────────────────────────────────────────────────────────────────
    (
        "M1 · ⛔ THE DEFECT, verbatim · the directory is removed BEFORE the reap, so the removal "
        "races whatever the launch is still doing — `324`'s merge exactly, and the state every "
        "`*:check` in this repo is still in",
        [
            (
                TEARDOWN,
                "  const outcome = lifecycle.kill9()\n  // ⛔ The one ordering",
                "  remove(directory)\n  const outcome = lifecycle.kill9()\n  // ⛔ The one ordering",
            )
        ],
    ),
    (
        "M2 · 🔴 the completeness condition is dropped, so the directory comes off whether or not "
        "anything is still alive. ⚠️ Every assertion about the RESULT still passes — `removed` is "
        "true and the reap did happen — which is why the killer has to watch the ORDER",
        [
            (
                TEARDOWN,
                "  if (!outcome.complete) return Object.freeze({ ...outcome, removed: false })",
                "  if (false) return Object.freeze({ ...outcome, removed: false })",
            )
        ],
    ),
    (
        "M3 · ⛔ the old fail-open, moved into the new place: only the ALIVE list is consulted, so a "
        "process the instrument could not verify either way counts as a gone one. ⚑ This is exactly "
        "what `holdersOf` did by returning `[]` from a `catch` — *\"I could not find out\"* and "
        "*\"nothing is there\"* as the same answer",
        [
            (
                TEARDOWN,
                "  if (!outcome.complete) return Object.freeze({ ...outcome, removed: false })",
                "  if (outcome.remaining.length > 0) return Object.freeze({ ...outcome, removed: false })",
            )
        ],
    ),
    (
        "M4 · ⚠️ the teardown asks politely instead of killing, spending `owned-process`'s ten "
        "SIGTERM attempts before it escalates — a window in which the provider child this dispatch "
        "is about goes on writing. ⛔ `quit:check` is the instrument that measures a graceful quit; "
        "this one has already asked every question it had",
        [
            (TEARDOWN, "  const outcome = lifecycle.kill9()", "  const outcome = lifecycle.stop()"),
        ],
    ),
    # ── the walk that finds what to wait for ──────────────────────────────────────────────────
    (
        "M5 · 🔴 children are offered BEFORE their parents. ⚠️ Every pid is still found, so a test "
        "that only checks membership goes green — and `createOwnedProcessLifecycle.remember()` "
        "refuses a pid whose parent it has not seen, so the whole subtree under it is never "
        "signalled and the teardown waits for processes it never told to die",
        [
            (
                TEARDOWN,
                "      found.push({ pid })\n      queue.push(pid)",
                "      found.unshift({ pid })\n      queue.push(pid)",
            )
        ],
    ),
    (
        "M6 · ⛔ the walk stops at direct children, so the Electron helpers are found and the "
        "`codex app-server`'s OWN descendants are not — the sandboxed commands `202` names as the "
        "one orphan shape its measurement does not cover",
        [
            (
                TEARDOWN,
                "      found.push({ pid })\n      queue.push(pid)",
                "      found.push({ pid })",
            )
        ],
    ),
    (
        "M7 · 🔴 the cycle guard goes, so a torn `ps` read that names a parent which is also a "
        "descendant makes the walk run forever — a teardown that hangs signals nothing, removes "
        "nothing and reports nothing. ⚠️ This row's first version mutated a `pid === parent` check "
        "instead and SURVIVED, which is how that check was found to be dead code: `seen` already "
        "covers the one-element cycle, and the test that was meant to kill it put the bad row "
        "outside the subtree where the walk never reaches it",
        [
            (
                TEARDOWN,
                "      if (seen.has(pid)) continue",
                "      if (false) continue",
            )
        ],
    ),
    (
        "M8 · ⚠️ any line at all is parsed as a pid pair, so `ps`'s own header and its error text "
        "become processes the teardown waits for. ⛔ `owned-process` would refuse to remember them "
        "and the reap could never complete — the gate fails closed, on nothing",
        [
            (
                TEARDOWN,
                "    const match = /^\\s*(\\d+)\\s+(\\d+)\\s*$/.exec(line)",
                "    const match = /^\\s*(\\S+)\\s+(\\S+)\\s*$/.exec(line)",
            )
        ],
    ),
    # ── the instrument going through the rule rather than around it ───────────────────────────
    (
        # ⛔ **RETIRED BY RULING (landing D-016a, bd70d693):** The row plants a second `rmSync` after
        # the teardown in scripts/fixture-follow-check.mjs, which the commit deleted along with
        # `fixture:check`. The same position-is-the-defect rule on the surviving gates is already
        # held by 326 M14 (window:check) and 326 M15 (quit:check), and by owned-teardown.test.mjs's
        # 'no removal BELOW the launch' pin, whose `describe.each` table now lists only those two.
        # Its anchor is left stale, so the census records it retired.
        "M9 · 🔴 the check keeps its own removal below the launch again — the one line whose "
        "position IS the defect. ⚑ It is put back exactly where `stop()` had it, after the reap, "
        "which is the version that failed `324`'s merge and passed twice afterwards",
        [
            (
                CHECK,
                "    const outcome = tearDownAndRemove({ lifecycle, directory: userDataDir })",
                "    const outcome = tearDownAndRemove({ lifecycle, directory: userDataDir })\n    rmSync(userDataDir, { recursive: true, force: true })",
            )
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-016a, bd70d693):** `discoverDescendants: descendantsOf`
        # in the deleted fixture-follow-check.mjs is gone, and the owned-teardown.test.mjs pin table
        # dropped its 'fixture:check' entry ('`fixture:check` left the chain at D-016'). The same
        # defect on the surviving gates is planted by 241 (window:check) and 326 M19 (quit:check).
        # Its anchor is left stale, so the census records it retired.
        "M10 · ⛔ the launch is owned but its family is never discovered, so the teardown waits for "
        "the `.bin/electron` shim alone and reports `complete` with four Electron processes and a "
        "provider child still coming down",
        [
            (
                CHECK,
                "      discoverDescendants: descendantsOf,",
                "      discoverDescendants: null,",
            )
        ],
    ),
    # ── seen only by the instrument itself (301 M22-M26's position) ───────────────────────────
    (
        # ⛔ **RETIRED BY RULING (landing D-016a, bd70d693):** `lifecycle.refreshDescendants()` in
        # scripts/fixture-follow-check.mjs went with that deleted file (the row was already
        # 'fixture:check only' and expected SURVIVED). The same defect on window:check and
        # quit:check is planted by 326 M16 and 326 M17 and pinned by owned-teardown.test.mjs. Its
        # anchor is left stale, so the census records it retired.
        "M11 · ⚠️ the helpers are no longer remembered while the app is UP. ⛔ `refreshDescendants` "
        "is a no-op once the launcher is gone, so a crash between the attach and the teardown "
        "leaves four Electron processes that nothing has authority to signal · **expected "
        "SURVIVED**: the teardown's own discovery covers the ordinary path, and this row is about "
        "the crash path — recorded rather than left as a gap · `fixture:check` only",
        [(CHECK, "    lifecycle.refreshDescendants()", "    void 0")],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-016a, bd70d693):** The ownership-capture retry wrapper
        # planted here was in scripts/fixture-follow-check.mjs, which is deleted, and the row was
        # 'fixture:check only' and expected SURVIVED. window-opens-check.mjs and
        # app-closes-check.mjs have the same retry loop, but no test or row pins it, so a re-anchor
        # would be a new row with no killer. Its anchor is left stale, so the census records it
        # retired.
        "M12 · ⚠️ the ownership capture stops retrying, so the `#!/bin/sh` shim's `exec` window — "
        "the few milliseconds in which one pid names two programs — makes the check throw before it "
        "has measured anything. ⛔ It fails CLOSED, which is why this is the least bad of the "
        "failures available here · `fixture:check` only",
        [
            (
                CHECK,
                "    lifecycle = await waitFor(\n      'the launched process to hold still long enough to be identified',\n      () => {\n        try {\n          return createOwnedProcessLifecycle({",
                "    lifecycle = await waitFor(\n      'the launched process to hold still long enough to be identified',\n      () => {\n        if (true) {\n          return createOwnedProcessLifecycle({",
            )
        ],
    ),
]
