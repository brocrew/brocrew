"""727 · A launch named before it writes.

⚑ **Ordered by** the PM — runtime-dev-2's `722` §2 (ruled R87) and its second batch's three reds.

## 🔴 A · R87 — the id a launch asked for is recorded with its row (M1-M5, M13-M14)

⚑ `store.create` writes `provider_session.launched_as` (migration `0048`) from `onRegistered`, before
the host sends anything, so before the CLI can write; the adoption scan asks it after the ref, and
names a row that holds no ref with the one it read off the transcript. Each row takes one half away.

## ⚑ B · the smoke's three reds (M6-M12, M15-M17)

Step 37's read, and the census blind spot it hid in; steps 12 and 57 saying the provider's red
themselves, pinned by `step-census.test.mjs`.

## ⛔ What this table deliberately does NOT contain

⛔ **No row on the live halves of steps 12, 37 and 57**: only a live batch runs them, and no table
runs a live batch. ⚠️ M8-M12 and M17 are pins of the source's text, `224` M25's kind — they prove
the discriminator is still written, not that a live run reaches it. ⚑ M15-M16 are the logic itself,
moved into `scripts/lib/turn-query.mjs` and run by its unit test (the `727` review, round 2).
"""

HOST = "apps/desktop/src/main/runtime/runtime-host.ts"
STORE = "apps/desktop/src/main/db/session-store.ts"
TABFLOW = "scripts/lib/tab-flow.mjs"
TURNQ = "scripts/lib/turn-query.mjs"
SMOKE = "scripts/ui-live-smoke.mjs"

MUTATIONS: list[tuple[str, list[tuple[str, str, str]]]] = [
    # ── A · R87 ────────────────────────────────────────────────────────────────────────────────
    (
        "M1 · 🔴 **the host stops recording the id its launch asked for** · a launch killed before "
        "init leaves a transcript no row names, and the next scan adopts it as another's — killed "
        "by `adopt-sessions.test.ts`",
        # ⚑ **the service dispatcher · re-anchored in place, not retired** — NOT VERIFIED: re-anchored source-only on the text L4a moved or repeated; the mutant makes the same change as before; no table run. held: running it needs W4’s written lift.
        [(HOST, "            // an error before init or a timed-out close can no longer leave one no row names.\n            ...(handle.launchedAs ? { launchedAs: handle.launchedAs } : {}),\n", "            // an error before init or a timed-out close can no longer leave one no row names.\n")],
    ),
    (
        "M2 · 🔴 **the store drops it** · the same, one layer down — killed by "
        "`adopt-sessions.test.ts`",
        # ⚑ **the service dispatcher · re-anchored in place, not retired** — NOT VERIFIED: re-anchored source-only on the text L4a moved or repeated; the mutant makes the same change as before; no table run. held: running it needs W4’s written lift.
        [(STORE, "    // and the app learns it only from the init that follows (`721`, R75) — see the 727 response.\n    if (record.launchedAs !== undefined) launchSql().write.run(record.launchedAs, record.id)\n", "    // and the app learns it only from the init that follows (`721`, R75) — see the 727 response.\n")],
    ),
    (
        "M3 · 🔴 **the scan's lookup forgets the launch id** · recorded, and never asked — killed "
        "by `adopt-sessions.test.ts`",
        [(STORE, "      const launched = launchSql().select.get(provider, sessionId) as { id: string } | undefined\n      return launched?.id ?? null\n", "      return null\n")],
    ),
    (
        "M4 · ⚠️ **the scan names nothing** · a killed launch is known and unreachable — not "
        "adopted, and not reopenable as its own — killed by `adopt-sessions.test.ts`",
        [(HOST, "        this.deps.store.nameItsLaunch(known, {\n", "        void ({\n")],
    ),
    (
        "M5 · ⛔ **the scan renames a conversation that already has a ref** · a `/clear`'d "
        "conversation is taken back to its first life — killed by `adopt-sessions.test.ts`",
        [(STORE, "          WHERE id = ? AND external_ref IS NULL AND launched_as = ?`,\n", "          WHERE id = ? AND launched_as = ?`,\n")],
    ),
    (
        "M13 · ⚠️ **the scan names a LIVE launch** · a conversation running right now before its "
        "init is announced as one that *can be reopened again* (the `727` review, round 2) — "
        "killed by `adopt-sessions.test.ts`",
        [(HOST, "          this.runningStateOf(known) === 'not-running' &&\n", "")],
    ),
    (
        "M14 · ⚠️ **a scan that only NAMED rows announces nothing** · a rail that did not press it "
        "keeps calling a reopenable conversation unreachable (the `727` review) — killed by "
        "`adopt-sessions.test.ts`",
        [(HOST, "    if (adopted > 0 || named > 0) this.theWorldMoved('conversations')\n", "    if (adopted > 0) this.theWorldMoved('conversations')\n")],
    ),
    # ── B · the smoke's three reds ─────────────────────────────────────────────────────────────
    (
        "M6 · 🔴 **a JSON-quoted hole reads as a hook again** · step 37's read hid in that gap from "
        "`105` to `722` — killed by `hook-reach.test.mjs`",
        [(TABFLOW, "    /^\\s*JSON\\.stringify\\(/.test(hole) ? JSON_HOLE_STANDS_FOR : HOLE_STANDS_FOR,\n", "    HOLE_STANDS_FOR,\n")],
    ),
    (
        "M7 · ⚠️ **step 37's read goes back to the built hook** · every run that reaches the Rebuild "
        "half is red on the step's own read — killed by `hook-reach.test.mjs`",
        [(SMOKE, "            `return ([...document.querySelectorAll('[data-cy^=library-outcome-]')].find((el) => el.dataset.cy === 'library-outcome-' + ${JSON.stringify(target.id)}) || {}).textContent ?? ''`,\n", "            `return (document.querySelector('[data-cy=\"library-outcome-' + ${JSON.stringify(target.id)} + '\"]') || {}).textContent ?? ''`,\n")],
    ),
    (
        "M8 · ⛔ **step 12 calls every wordless pill the provider's** · a ledger holding worded "
        "thinking the screen could not open — the renderer — reads as Codex's — killed by "
        "`step-census.test.mjs`",
        [(SMOKE, "        worded !== 0 ||\n", "")],
    ),
    (
        "M10 · ⛔ **step 12 stops asking Codex's own rollout** · summary words Codex sent and the "
        "app LOST read as Codex sending none (the `727` review) — killed by `step-census.test.mjs`",
        [(SMOKE, "        summarised.worded !== 0\n", "        false\n")],
    ),
    (
        "M11 · 🔴 **step 12's \"no thinking entry at all\" widens back over a drawn pill** · the "
        "provider arm is unreachable again, and Codex's red is blamed on the renderer (the `727` "
        "review) — killed by `step-census.test.mjs`",
        [(SMOKE, "      codexThinkingPill.length === 0 &&\n      codexThinkingEvents > 0\n", "      codexThinkingEvents > 0\n")],
    ),
    (
        "M12 · ⛔ **step 57 stops asking that each tree is a different run** · a fold that drew one "
        "run twice passes whenever the model called Workflow twice (the `727` review) — killed by "
        "`step-census.test.mjs`",
        [(SMOKE, "      const doubled = oneTreePerRun(entries.runs)\n      if (doubled !== null) throw new Error(doubled)\n", "")],
    ),
    (
        "M15 · 🔴 **a worded summary in Codex's rollout is not counted** · step 12 reads words the "
        "app lost as Codex sending none — killed by `turn-query.test.mjs`",
        [(TURNQ, "      worded += 1\n", "      worded += 0\n")],
    ),
    (
        "M16 · 🔴 **one run drawn twice passes as two trees** · step 57's fold check waves it "
        "through whenever the model called Workflow twice — killed by `turn-query.test.mjs`",
        [(TURNQ, "  if (new Set(runs).size !== runs.length) {\n", "  if (false) {\n")],
    ),
    (
        "M17 · ⛔ **step 12 names the provider without this run having shown the flip working** · "
        "a flip lost on the wire reads as Codex's choice (the `727` review, round 2) — killed by "
        "`step-census.test.mjs`",
        [(SMOKE, "      codexWordless = codexWordedThinking(null) > 0 ? 'the-provider' : 'unproven'\n", "      codexWordless = 'the-provider'\n")],
    ),
    (
        "M9 · ⛔ **step 57 takes any number of trees** · a fold that drew a tree per frame passes "
        "as the provider calling Workflow again — killed by `step-census.test.mjs`",
        [(SMOKE, "      if (entries.trees < 1 || entries.trees > (workflowCalls ?? 1)) {\n", "      if (entries.trees < 1) {\n")],
    ),
]
