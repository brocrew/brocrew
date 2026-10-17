"""674 · the budgets by the rule, and the two tools every seat rebuilds — what `674` newly carries.

⛔ **Ordered by the PM on `669`'s Inbox 1 and 2 (R20) and rule 39's standing debt.** R20 put steps 81
and 82 back on `042`'s rule: each step states the worst case its own waits can spend — a literal —
and `scripts/lib/step-wait-census.mjs` recomputes it from the step's call sites, so the budgets
(margin × worst case, plus a derived launch) cannot drift from the code; a fake-timer model spends
the step's own clock (`budgetClock`) through four stalled rows. Then the single-row RED verifier nine
seats each rebuilt, landed as `scripts/mutations/verify_row.py` with its guards; and `662`'s
CLI-origin probe, landed as `scripts/lib/claude-cli-origin.mjs` and a test that turns red on an SDK
bump that moves the rule.

## ⚠️ What a row here measures

 * ⚑ **M1–M12 and M50 are R20** — the stated worst cases, the budgets' derivations, what the run spends
   outside the step, the margin, the clock and the gate witness's bound — killed by
   `step-budgets.test.mjs` and `step-census.test.mjs`. ⛔ Neither step was run: a row proves the
   census notices the edit, never that the budget is long enough for a provider. That is a run.
 * ⚑ **M13–M16, M28–M31 and M41–M43 break the step-wait census itself**; M32 is R20's figure
   outside the step, killed by its planted steps.
 * ⚑ **M17–M22, M33–M37 and M44–M46 break the verifier**, killed by `verify-row.test.mjs`, which runs the
   mutated script against a planted table in a throwaway directory.
 * ⚑ **M23–M27, M38–M40 and M47–M49 break the CLI-origin probe**, killed by `claude-cli-origin.test.mjs`'s
   planted binaries — and M27 by the guard that stops a skip hiding the platform this gate runs on.
 * ⚑ **M28–M40 were added for the review's first round, M41–M50 for its second**, each killed by the
   plant that round added.
 * ⚠️ **Two of the second round's fixes have no row:** the verifier's restore held against a second
   signal (only a signal landing inside a few milliseconds would show it), and an unparseable vitest
   report read as NOT MEASURED (no plant makes vitest write one).

## ⛔ What this table cannot reach

 * 🔴 **Whether the Claude CLI's rule has moved in a shape the probe still reads as clean.** It reads
   shape, not meaning; `662`'s table is still the thing to re-read on a bump.
 * ⚠️ **The verifier's `ps`/`lsof` discovery of a real dev server.** The tests plant a process; the
   machine's own table was read once, by hand, and named the frontend seat's live server.
"""

SMOKE = "scripts/ui-live-smoke.mjs"
CLOCK = "scripts/lib/step-budget.mjs"
WITNESS = "scripts/lib/host-gate-witness.mjs"
CENSUS = "scripts/lib/step-wait-census.mjs"
VERIFIER = "scripts/mutations/verify_row.py"
PROBE = "scripts/lib/claude-cli-origin.mjs"

UI_LIVE_SMOKE = "scripts/ui-live-smoke.mjs"
MUTATIONS: list[tuple[str, list[tuple[str, str, str]]]] = [
    (
        "M1 · 🔴 R20 · a row's stated worst case stops being the sum its code makes — the budget "
        "follows a number no wait spends · killed by `step-budgets.test.mjs`",
        # ⚑ 738 · anchor corrected in place: the row grew to 3,070,000 (the model-bytes branch's two reads).
        # ⚑ Landing D-016b (5e931be8, the tree) · re-anchored in place, not retired — The rule
        # survives: step 82's stated `row` worst case must equal the sum `stepWorstCase` recomputes
        # from its call sites. The literal is now `row: 2_810_000,` in `PERMISSION_MATRIX_WORST_MS`;
        # the old `3_070_000` was corrected by later rounds. Any other value drifts it from the
        # census. Killed by `step-budgets.test.mjs`, `step-census.test.mjs`.
        [
            (UI_LIVE_SMOKE, '  row: 2_810_000,\n', '  row: 2_620_000,\n'),
        ],
    ),
    (
        "M2 · 🔴 R20 · a wait in a row grows and nobody re-sums the row — the budget no longer covers "
        "what the row can spend · killed by `step-budgets.test.mjs`",
        [
            (
                SMOKE,
                "              budget(30_000),\n              250,\n            )\n"
                "            const fileAfterFirstTurn = readText(path)",
                "              budget(90_000),\n              250,\n            )\n"
                "            const fileAfterFirstTurn = readText(path)",
            ),
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-016a, bd70d693):** `PERSONS_GESTURE_WORST_MS` went with
        # step 81 (the proposal gesture bd70d693 removes). Step 82's equivalent, a stated worst case
        # that drops a charged read, is already rowed by 674 M1 (`row: 3_070_000` lowered) and M28
        # (a read never charged). Both are held by step-budgets.test.mjs. Its anchor is left stale,
        # so the census records it retired.
        "M3 · ⛔ R20 · step 81's stated worst case drops its reads — the figure before a SQLite read "
        "outside a poll was charged · killed by `step-budgets.test.mjs`",
        [(SMOKE, "const PERSONS_GESTURE_WORST_MS = 815_250\n", "const PERSONS_GESTURE_WORST_MS = 745_250\n")],
    ),
    (
        "M4 · 🔴 R20 · step 81's budget typed back as nine minutes — below its own 815 s of waits · "
        "killed by `step-budgets.test.mjs`",
        # ⚑ Landing D-016a (bd70d693) · re-anchored in place, not retired — Step 81's budget is
        # gone, but the rule that a step budget is derived (worst case x margin) and never a typed
        # figure holds for `PERMISSION_MATRIX_STEP_BUDGET_MS`, and no row types that one back (M9
        # and M8 plant other defects). Plant `9 * 60_000` over the whole derivation. It is nine
        # minutes against a 57,081,000 ms derived budget.
        [
            (UI_LIVE_SMOKE, 'const PERMISSION_MATRIX_STEP_BUDGET_MS = Math.ceil(\n  STEP_BUDGET_MARGIN *\n    (PERMISSION_MATRIX_WORST_MS.setup +\n      PERMISSION_MATRIX_UNITS.rows *\n        (PERMISSION_MATRIX_WORST_MS.row + PERMISSION_MATRIX_WORST_MS.recovery) +\n      PERMISSION_MATRIX_UNITS.criterion17 *\n        (PERMISSION_MATRIX_WORST_MS.criterion17 + PERMISSION_MATRIX_WORST_MS.recovery)),\n)\n', 'const PERMISSION_MATRIX_STEP_BUDGET_MS = 9 * 60_000\n'),
        ],
    ),
    (
        "M5 · ⛔ R20 · a failed row's recovery drops out of the budget — a run of stalled rows spends "
        "eight recoveries the step never priced · killed by `step-budgets.test.mjs`",
        [
            (
                SMOKE,
                "        (PERMISSION_MATRIX_WORST_MS.row + PERMISSION_MATRIX_WORST_MS.recovery) +\n",
                "        PERMISSION_MATRIX_WORST_MS.row +\n",
            ),
        ],
    ),
    (
        "M6 · ⛔ R20 · the run forgets `main()`'s own waits outside the step and the step wrapper's "
        "failure path — the review's findings: attach, reload, settle and reset on no clock · killed "
        "by `step-budgets.test.mjs`",
        [
            (
                SMOKE,
                "    (LAUNCH_WORST_MS.isolatedLaunch + LAUNCH_WORST_MS.outsideSteps + LAUNCH_WORST_MS.stepWrapper),\n",
                "    LAUNCH_WORST_MS.isolatedLaunch,\n",
            ),
        ],
    ),
    (
        "M7 · ⛔ R20 · `launchApp` waits longer than the launch budget counts — a literal in place of "
        "its named bound · killed by `step-budgets.test.mjs`",
        [(SMOKE, "            LAUNCH_MOUNT_WAIT_MS,\n", "            180_000,\n")],
    ),
    (
        "M8 · ⛔ R20 · the margin drifts from `042`'s — every budget stops being the helper's rule · "
        "killed by `step-budgets.test.mjs`",
        [(SMOKE, "const STEP_BUDGET_MARGIN = 1.5\n", "const STEP_BUDGET_MARGIN = 1.25\n")],
    ),
    (
        "M9 · 🔴 R20 · `665`'s one good run becomes the budget's input again · killed by "
        "`step-census.test.mjs`",
        [
            (
                SMOKE,
                "const PERMISSION_MATRIX_STEP_BUDGET_MS = Math.ceil(\n  STEP_BUDGET_MARGIN *\n",
                "const PERMISSION_MATRIX_STEP_BUDGET_MS = Math.ceil(\n"
                "  PERMISSION_MATRIX_LONGEST_UNIT_MS +\n  STEP_BUDGET_MARGIN *\n",
            ),
        ],
    ),
    (
        "M10 · 🔴 the clock never expires — a wait asked for past the deadline starts anyway · killed "
        "by `step-budgets.test.mjs`",
        [(CLOCK, "    if (left <= 0) throw expire()\n", "")],
    ),
    (
        "M11 · ⛔ the clock hands out the whole wish, past what is left · killed by "
        "`step-budgets.test.mjs`",
        [(CLOCK, "    return Math.min(wanted, left)", "    return wanted")],
    ),
    (
        "M12 · ⛔ the gate witness's socket wait moves and the launch budget does not · killed by "
        "`step-budgets.test.mjs`",
        [(WITNESS, "export const GATE_SOCKET_WAIT_MS = 10_000\n", "export const GATE_SOCKET_WAIT_MS = 20_000\n")],
    ),
    (
        "M13 · ⛔ the census ignores a loop's literal bound — a wait inside `for (… i < 3 …)` is "
        "charged once · killed by `step-budgets.test.mjs`",
        [(CENSUS, "      factor *= bound\n", "      factor *= 1\n")],
    ),
    (
        "M14 · ⛔ a stated total drops the loops INSIDE it — the review's finding: three tries of each "
        "child charged as one · killed by `step-budgets.test.mjs`",
        [
            (
                CENSUS,
                "        return factor * iterations[at.expression.getText(file)]\n",
                "        return iterations[at.expression.getText(file)]\n",
            ),
        ],
    ),
    (
        "M15 · 🔴 a wait inside a `waitFor` predicate is charged once, not refused — it runs an "
        "unknown number of times · killed by `step-budgets.test.mjs`",
        [(CENSUS, "            if (inside.ms > 0 || inside.params.length > 0) {\n", "            if (false) {\n")],
    ),
    (
        "M16 · 🔴 a bound a caller passes as a LITERAL is charged nowhere — the review's finding · "
        "killed by `step-budgets.test.mjs`",
        [(CENSUS, "          chargeBound(argument, node, label)\n", "")],
    ),
    (
        "M17 · 🔴 a baseline that is red before any row is taken as a kill · killed by "
        "`verify-row.test.mjs`",
        [
            (
                VERIFIER,
                '        if baseline["exit"] != 0 or baseline["failed"] or baseline["unloaded"]:\n',
                "        if False:\n",
            ),
        ],
    ),
    (
        "M18 · 🔴 a tree a live dev server watches is verified anyway — every byte hot-loads into "
        "the person's window · killed by `verify-row.test.mjs`",
        [(VERIFIER, "    if watching:\n", "    if False:\n")],
    ),
    (
        "M19 · ⛔ a Node 20 shell is let through — a file green on 24 turns red for the wrong reason · "
        "killed by `verify-row.test.mjs`",
        [(VERIFIER, "    if major < MINIMUM_NODE:\n", "    if major < 20:\n")],
    ),
    (
        "M20 · 🔴 the tree is not written back — the row stays applied, and the hash check is all that "
        "stands between it and a commit · killed by `verify-row.test.mjs`",
        [(VERIFIER, "                    (root / rel).write_bytes(before)\n", "                    pass\n")],
    ),
    (
        "M21 · 🔴 a row nothing noticed is reported RED · killed by `verify-row.test.mjs`",
        [
            (
                VERIFIER,
                '        else:\n            outcome["verdict"] = "SURVIVED"\n        report["rows"].append(outcome)',
                '        else:\n            outcome["verdict"] = "RED"\n        report["rows"].append(outcome)',
            ),
        ],
    ),
    (
        "M22 · ⛔ an ambiguous anchor is found only after the baselines ran, not refused up front · "
        "killed by `verify-row.test.mjs`",
        [(VERIFIER, "            table_contract.apply_row(rows, root, index, dry=True)\n", "            pass\n")],
    ),
    # RETIREMENT APPROVED — 674 M23: file-gone; removed by e504ff460ce1a0b5cf1e8b8de9daf5aa46dc0aae.
    # Guarded parser and its test were deliberately removed under the standing rule forbidding
    # reading inside Claude Code; retained loopback wire probe does not replace these parser guarantees,
    # and none are wanted. Definition retained as historical evidence; no row execution.
    (
        "M23 · 🔴 `662`'s strict predicate confirmed by any mention of `kind==\"human\"` — a widened "
        "one reads as clean · killed by `claude-cli-origin.test.mjs`",
        [
            (
                PROBE,
                '  const STRICT_BODY = /^function [\\w$]+\\(([\\w$]+)\\)\\{return \\1\\??\\.kind==="human"\\}$/',
                '  const STRICT_BODY = /kind==="human"/',
            ),
        ],
    ),
    # RETIREMENT APPROVED — 674 M24: file-gone; removed by e504ff460ce1a0b5cf1e8b8de9daf5aa46dc0aae.
    # Guarded parser and its test were deliberately removed under the standing rule forbidding
    # reading inside Claude Code; retained loopback wire probe does not replace these parser guarantees,
    # and none are wanted. Definition retained as historical evidence; no row execution.
    (
        "M24 · 🔴 only the FIRST keyword reader is read — a second, ungated one reads as clean · killed "
        "by `claude-cli-origin.test.mjs`",
        [
            (
                PROBE,
                "  for (const { line, condition } of keyword.readers) {",
                "  for (const { line, condition } of keyword.readers.slice(0, 1)) {",
            )
        ],
    ),
    # RETIREMENT APPROVED — 674 M25: file-gone; removed by e504ff460ce1a0b5cf1e8b8de9daf5aa46dc0aae.
    # Guarded parser and its test were deliberately removed under the standing rule forbidding
    # reading inside Claude Code; retained loopback wire probe does not replace these parser guarantees,
    # and none are wanted. Definition retained as historical evidence; no row execution.
    (
        "M25 · ⛔ a string left only in the binary's string table counts as code — a rule nothing "
        "reads passes · killed by `claude-cli-origin.test.mjs`",
        [
            (
                PROBE,
                "      if (/[=(){}&?:,]/.test(around.replace(wanted, ''))) code.push(around)",
                "      code.push(around)",
            ),
        ],
    ),
    # RETIREMENT APPROVED — 674 M26: file-gone; removed by e504ff460ce1a0b5cf1e8b8de9daf5aa46dc0aae.
    # Guarded parser and its test were deliberately removed under the standing rule forbidding
    # reading inside Claude Code; retained loopback wire probe does not replace these parser guarantees,
    # and none are wanted. Definition retained as historical evidence; no row execution.
    (
        "M26 · 🔴 a stable string gone from the binary is not a finding · killed by "
        "`claude-cli-origin.test.mjs`",
        [
            (
                PROBE,
                "  for (const wanted of STABLE_STRINGS) {\n    if (strings[wanted].code.length === 0) {",
                "  for (const wanted of []) {\n    if (strings[wanted].code.length === 0) {",
            ),
        ],
    ),
    # RETIREMENT APPROVED — 674 M27: file-gone; removed by e504ff460ce1a0b5cf1e8b8de9daf5aa46dc0aae.
    # Guarded parser and its test were deliberately removed under the standing rule forbidding
    # reading inside Claude Code; retained loopback wire probe does not replace these parser guarantees,
    # and none are wanted. Definition retained as historical evidence; no row execution.
    (
        "M27 · 🔴 the resolver calls this machine's platform unpublished — the installed-binary test "
        "SKIPS, and silence reads as clean · killed by `claude-cli-origin.test.mjs`",
        [
            (
                PROBE,
                "  const published = Object.hasOwn(sdk.optionalDependencies ?? {}, platformPackage)",
                "  const published = false",
            ),
        ],
    ),
    (
        "M28 · 🔴 a read is never charged — even outside a poll, where nothing else bounds it (the "
        "review's finding) · killed by `step-budgets.test.mjs`",
        [
            (
                CENSUS,
                "        if (called !== null && inPoll && reads.includes(called)) return\n",
                "        if (called !== null && reads.includes(called)) return\n",
            ),
        ],
    ),
    (
        "M29 · 🔴 a static method is not followed — `Cdp.attach`'s wait counted 0 (the review's "
        "finding) · killed by `step-budgets.test.mjs`",
        [
            (
                CENSUS,
                "          if (method !== null) chargeCall(node, callee.getText(file), worstOf(method, inPoll))",
                "          if (false) chargeCall(node, callee.getText(file), worstOf(method, inPoll))",
            ),
        ],
    ),
    (
        "M30 · ⛔ a synchronous child's `timeout` is not charged — a SQLite read that blocks the loop "
        "counted 0 · killed by `step-budgets.test.mjs`",
        [(CENSUS, "          if (timeout !== undefined) {\n", "          if (false) {\n")],
    ),
    (
        "M31 · ⛔ every timer counts as a wait — a watchdog over some OTHER wait is charged, and its "
        "deadline arithmetic refused · killed by `step-budgets.test.mjs`",
        [
            (
                CENSUS,
                "        return true\n      }\n    }\n    return false\n  }\n",
                "        return true\n      }\n    }\n    return true\n  }\n",
            ),
        ],
    ),
    (
        "M32 · 🔴 the stated wait outside the step drifts from `main()`'s own · killed by "
        "`step-budgets.test.mjs`",
        [
            (
                SMOKE,
                "const LAUNCH_WORST_MS = { isolatedLaunch: 320_100, outsideSteps: 91_500, stepWrapper: 180_000 }",
                "const LAUNCH_WORST_MS = { isolatedLaunch: 320_100, outsideSteps: 61_500, stepWrapper: 180_000 }",
            ),
        ],
    ),
    (
        "M33 · 🔴 the saved bytes are kept only in memory — a SIGKILL mid-row loses the only copy (the "
        "review's HIGH finding) · killed by `verify-row.test.mjs`",
        [(VERIFIER, "            (rescue / rel).write_bytes(before)\n", "            pass\n")],
    ),
    (
        "M34 · 🔴 a SIGTERM ends the verifier without its `finally` — the row stays applied · killed "
        "by `verify-row.test.mjs`",
        [
            (
                VERIFIER,
                "    for signum in SIGNALS:\n        signal.signal(signum, _interrupt)\n",
                "",
            ),
        ],
    ),
    (
        "M35 · 🔴 a killer that did not load is counted as a kill · killed by `verify-row.test.mjs`",
        [
            (
                VERIFIER,
                "            # non-zero with every test passing. The table runner would not count it; neither does this.\n"
                '            outcome["verdict"] = "NOT MEASURED"\n',
                "            # non-zero with every test passing. The table runner would not count it; neither does this.\n"
                '            outcome["verdict"] = "RED"\n',
            ),
        ],
    ),
    (
        "M36 · ⛔ an unreadable process table reads as one with no dev server · killed by "
        "`verify-row.test.mjs`",
        [(VERIFIER, "    if listing.returncode != 0 or not any(\n", "    if False and not any(\n")],
    ),
    (
        "M37 · ⛔ a dev server started without the `dev` verb — its own default — escapes the guard · "
        "killed by `verify-row.test.mjs`",
        [
            (
                VERIFIER,
                '    r"(?:^|[\\s/])(?:electron-vite|vite)(?:\\.m?js)?(?=\\s|$)(?!\\s+(?:build|preview|optimize)\\b)"\n',
                '    r"(?:^|[\\s/])(?:electron-vite|vite)(?:\\.m?js)?\\s+dev\\b"\n',
            ),
        ],
    ),
    # RETIREMENT APPROVED — 674 M38: file-gone; removed by e504ff460ce1a0b5cf1e8b8de9daf5aa46dc0aae.
    # Guarded parser and its test were deliberately removed under the standing rule forbidding
    # reading inside Claude Code; retained loopback wire probe does not replace these parser guarantees,
    # and none are wanted. Definition retained as historical evidence; no row execution.
    (
        "M38 · 🔴 only the FIRST `isHumanTypedPrompt` site is confirmed — a second stamping every "
        "turn human-typed reads as clean · killed by `claude-cli-origin.test.mjs`",
        [(PROBE, "  for (const site of strict.sites) {", "  for (const site of strict.sites.slice(0, 1)) {")],
    ),
    # RETIREMENT APPROVED — 674 M39: file-gone; removed by e504ff460ce1a0b5cf1e8b8de9daf5aa46dc0aae.
    # Guarded parser and its test were deliberately removed under the standing rule forbidding
    # reading inside Claude Code; retained loopback wire probe does not replace these parser guarantees,
    # and none are wanted. Definition retained as historical evidence; no row execution.
    (
        "M39 · ⛔ a definition that widens AROUND the strict call reads as clean · killed by "
        "`claude-cli-origin.test.mjs`",
        [
            (
                PROBE,
                "  const shape = expression === null ? null : expression.match(/^[\\w$]+&&([\\w$]+)\\([\\w$.?]+\\)$/)",
                "  const shape = expression === null ? null : expression.match(/([\\w$]+)\\([\\w$.?]+\\)/)",
            ),
        ],
    ),
    # RETIREMENT APPROVED — 674 M40: file-gone; removed by e504ff460ce1a0b5cf1e8b8de9daf5aa46dc0aae.
    # Guarded parser and its test were deliberately removed under the standing rule forbidding
    # reading inside Claude Code; retained loopback wire probe does not replace these parser guarantees,
    # and none are wanted. Definition retained as historical evidence; no row execution.
    (
        "M40 · ⛔ the keyword reader need only MENTION the strict predicate, not gate on it · killed "
        "by `claude-cli-origin.test.mjs`",
        [
            (
                PROBE,
                "      /^[\\w$]+\\??\\.isHumanTypedPrompt(?:&&.+)?$/.test(condition) && !/\\|\\||\\?\\?/.test(topLevel)",
                "      /isHumanTypedPrompt/.test(condition)",
            )
        ],
    ),
    (
        "M41 · ⛔ round 2 · a loop is bounded by the leftmost `<` of its condition, not its own "
        "counter's · killed by `step-budgets.test.mjs`",
        [(CENSUS, "            test.left.text === counter &&\n", "")],
    ),
    (
        "M42 · ⛔ round 2 · a `budget(…)` handed to a helper that loops over it is charged once · "
        "killed by `step-budgets.test.mjs`",
        [(CENSUS, "          if (factor > 1)\n", "          if (false)\n")],
    ),
    (
        "M43 · 🔴 round 2 · an untimed synchronous child — an unbounded wait — is charged 0 · killed "
        "by `step-budgets.test.mjs`",
        [
            (
                CENSUS,
                "            if (named === null || !untimedChildren.includes(named)) {",
                "            if (false) {",
            )
        ],
    ),
    (
        "M44 · 🔴 round 2 · the verifier runs beside the table runner in its own tree · killed by "
        "`verify-row.test.mjs`",
        [(VERIFIER, '    if (root / "scripts/mutations/.tree-lock").exists():', "    if False:")],
    ),
    (
        "M45 · 🔴 round 2 · a killed run's rescue is ignored — the next run saves the MUTATED bytes as "
        "its before, and proves it restored them · killed by `verify-row.test.mjs`",
        [(VERIFIER, "        if os.path.realpath(recorded).casefold() == canonical:", "        if False:")],
    ),
    (
        "M46 · ⛔ round 2 · two verifiers run in one tree at once · killed by `verify-row.test.mjs`",
        [(VERIFIER, "        if holder is not None and _alive(holder):", "        if False:")],
    ),
    # RETIREMENT APPROVED — 674 M47: file-gone; removed by e504ff460ce1a0b5cf1e8b8de9daf5aa46dc0aae.
    # Guarded parser and its test were deliberately removed under the standing rule forbidding
    # reading inside Claude Code; retained loopback wire probe does not replace these parser guarantees,
    # and none are wanted. Definition retained as historical evidence; no row execution.
    (
        "M47 · 🔴 round 2 · a keyword reader in another shape is skipped, not a finding · killed by "
        "`claude-cli-origin.test.mjs`",
        [(PROBE, "  for (const unread of keyword.unread) {", "  for (const unread of []) {")],
    ),
    # RETIREMENT APPROVED — 674 M48: file-gone; removed by e504ff460ce1a0b5cf1e8b8de9daf5aa46dc0aae.
    # Guarded parser and its test were deliberately removed under the standing rule forbidding
    # reading inside Claude Code; retained loopback wire probe does not replace these parser guarantees,
    # and none are wanted. Definition retained as historical evidence; no row execution.
    (
        "M48 · 🔴 round 2 · the flag ASSIGNED outside its computing site reads as clean · killed by "
        "`claude-cli-origin.test.mjs`",
        [
            (
                PROBE,
                "  for (const assigned of text.matchAll(/[\\w$)\\]]\\.isHumanTypedPrompt=(?!=)/g)) {",
                "  for (const assigned of []) {",
            )
        ],
    ),
    # RETIREMENT APPROVED — 674 M49: file-gone; removed by e504ff460ce1a0b5cf1e8b8de9daf5aa46dc0aae.
    # Guarded parser and its test were deliberately removed under the standing rule forbidding
    # reading inside Claude Code; retained loopback wire probe does not replace these parser guarantees,
    # and none are wanted. Definition retained as historical evidence; no row execution.
    (
        "M49 · ⛔ round 2 · `??` is taken for the ternary — a defaulted gate reads as clean · killed by "
        "`claude-cli-origin.test.mjs`",
        [
            (
                PROBE,
                "(around[end + 1] === '?' || around[end + 1] === '.')",
                "(around[end + 1] === '.')",
            )
        ],
    ),
    (
        "M50 · ⛔ round 2 · the gate witness's poll moves and the launch figure does not · killed by "
        "`step-budgets.test.mjs`",
        [(WITNESS, "export const GATE_POLL_MS = 100\n", "export const GATE_POLL_MS = 200\n")],
    ),
]
