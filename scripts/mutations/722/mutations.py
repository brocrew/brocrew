"""722 · One conversation listed once, and a smoke that follows the product.

⚑ **Ordered by** the PM — runtime-dev-2's `717` F-1 (ruled R79), F-3 and F-6.

## 🔴 A · R79 — a launch names its conversation before the CLI runs (M1-M5, M16-M19)

⚑ `ClaudeRuntime.start` mints the id and passes it as `Options.sessionId`; a close before
`system/init` announces it, in the folder the CLI RECORDED, when the CLI's transcript under it names
one; the host's adoption scan knows the id while the launch is live (`probe:claude-launch-id`
measured the CLI naming the transcript by it, a symlinked launch folder recorded as its real path,
and a reopen by the announced ref taking a turn — CLI 2.1.281). Each row takes one half away.

## ⚑ B · the census that every page-side template parses (M6-M8, M20-M21, M28)

## ⚑ C · step 38's second signal (M9-M10)

## ⚑ D · `717` F-6 — the desktop gate-only test asks `mustNameScratch` (M11-M12)

## ⚑ E · the probe's verdict reads each arm's premise off the child (M13-M15, M22-M24, M26-M27)

## ⚑ F · the delegation-tools reader is pinned by the gate, not by a live batch (M25)

## ⛔ What this table deliberately does NOT contain

⛔ **No row on the smoke's re-aimed steps' live halves** (13, 16, 16b, 17, 18, 32, 35, 57, 58, 78, 80,
81, 14, 15, 44b, 68, 69, 71, 10, 11b, 9): only a live batch runs them, and no table runs a live batch.
Their cheap pins are step 35's home path (`step-census.test.mjs`) and the parse census above.
"""

RT = "packages/runtime/src/claude/claude-runtime.ts"
SMOKE = "scripts/ui-live-smoke.mjs"
PARSE = "scripts/test/every-page-template-parses.test.mjs"
OWNED = "scripts/lib/owned-process.mjs"
DESK = "apps/desktop/gate-only/a-clean-base-leaves-no-profiles.test.ts"
EVID = "packages/runtime/smoke/claude-launch-id-evidence.ts"
HOST = "apps/desktop/src/main/runtime/runtime-host.ts"
APP_SOURCE = "scripts/lib/app-source.mjs"
SOURCE = "scripts/lib/app-source.mjs"

MUTATIONS: list[tuple[str, list[tuple[str, str, str]]]] = [
    # ── A · R79 — a conversation this app launched is never adopted as someone else's ─────────
    (
        "M1 · 🔴 **the launch names no id of its own again** · a Claude conversation closed "
        "before init keeps no ref, and the next scan lists this app's launch as a second "
        "conversation (`717` step 10) — killed by `adopt-sessions.test.ts`, and in the adapter "
        "killed by `claude-runtime.test.ts`",
        [(RT, "    options.sessionId = launchedAs\n", "")],
    ),
    (
        "M2 · 🔴 **the close forgets the id it launched with** · the CLI names its transcript by "
        "it, and the row still keeps none — killed by `adopt-sessions.test.ts`, and in the "
        "adapter killed by `claude-runtime.test.ts`",
        [(RT, "    this._ref ??= await this.launchRefIfRecorded()\n", "")],
    ),
    (
        "M3 · 🔴 **the ref carries the folder as it was TYPED** · a `/tmp` or symlinked launch "
        "is recorded by the CLI as its real path, and a reopen's first init then fails the "
        "barrier (*resume mismatch*) — killed by `claude-runtime.test.ts`, and at the host "
        "killed by `adopt-sessions.test.ts`",
        [(RT, "      launchTranscriptCwd(launchedAs, opts.cwd, opts.providerHome),\n", "      launchTranscriptCwd(launchedAs, opts.cwd, opts.providerHome) && opts.cwd,\n")],
    ),
    (
        "M4 · 🔴 **a resume names a session id too** · the CLI refuses `--session-id` beside "
        "`--resume`, and every reopen ends — killed by `claude-runtime.test.ts`",
        [(RT, "        resume: ref.sessionId,\n", "        resume: ref.sessionId,\n        sessionId: randomUUID(),\n")],
    ),
    (
        "M5 · ⚠️ **the close asks the provider about another id** · the question that decides "
        "the announcement is about a conversation this launch never named — killed by "
        "`claude-runtime.test.ts`, and at the host killed by `adopt-sessions.test.ts`",
        [(RT, "      launchTranscriptCwd(launchedAs, opts.cwd, opts.providerHome),\n", "      launchTranscriptCwd(randomUUID(), opts.cwd, opts.providerHome),\n")],
    ),
    (
        "M16 · ⚠️ **a transcript that names no folder is announced** · a ref the scan could never "
        "have listed, offering a reopen of nothing — killed by `claude-runtime.test.ts`",
        [(RT, "      if (cwd === null) return null\n", "")],
    ),
    (
        "M17 · ⚠️ **a transcript whose records name another session is taken as this launch's** "
        "· discovery skips it; the close announced it — killed by `claude-runtime.test.ts`",
        [(RT, "      if (typeof named === 'string' && named !== sessionId) return null\n", "")],
    ),
    (
        # 🔴 **RETIRED BY RULING at `727` (R87), in the honest direction: this row's key is gone
        # because the ROW now carries what it guarded.** ⚑ R87 records the id a launch asked for in
        # `provider_session.launched_as` before the CLI can write, and `findByProviderRef` answers it
        # before the scan ever reads the live set — so a live pre-init launch is known by the store,
        # and the key this row deleted was removed as redundant (the `727` review found this row
        # unkillable). ⚑ The defect it guarded is measured again by `727` M1-M3 and by the `722`
        # live-scan test in `adopt-sessions.test.ts`. Its anchor is the pre-`727` key.
        "M18 · 🔴 **the scan's live-set forgets the launch id** · a scan while a launch is live "
        "before init, in a folder the CLI resolved, lists its transcript as a second "
        "conversation (the `722` review) — killed by `adopt-sessions.test.ts`",
        [(HOST, "          ...(session.handle.launchedAs\n            ? [`${session.provider}\\u0000${session.handle.launchedAs}`]\n            : []),\n", "")],
    ),
    (
        "M19 · 🔴 **the handle hides the id it launched with** · the scan has nothing to "
        "recognise it by — killed by `adopt-sessions.test.ts`, and in the adapter killed by "
        "`claude-runtime.test.ts`",
        [(RT, "    return this.launch?.sessionId ?? null\n", "    return null\n")],
    ),
    # ── B · the census that every page-side template parses ───────────────────────────────────
    (
        "M6 · 🔴 **step 78's page script stops parsing again** · the red it held from `587` to "
        "`717`, unseen by anything but a live batch — killed by "
        "`every-page-template-parses.test.mjs`",
        [(SMOKE, "        // every full batch from 587 to 717. every-page-template-parses.test.mjs parses each page now.\n        const collapsed = document.querySelectorAll('[data-cy=tool-run]').length\n        return {\n", "        // every full batch from 587 to 717. every-page-template-parses.test.mjs parses each page now.\n        return {\n        const collapsed = document.querySelectorAll('[data-cy=tool-run]').length\n")],
    ),
    (
        "M7 · ⚠️ **a hole filled from fixed text becomes a stand-in** · a page whose code "
        "arrives through `${paperFields('surface')}` reads as broken when it is not — killed by "
        "`every-page-template-parses.test.mjs`",
        [(PARSE, "            text + (textsOf(span.expression, next)?.[0] ?? INTERPOLATION) + span.literal.text,\n", "            text + INTERPOLATION + span.literal.text,\n")],
    ),
    (
        "M8 · ⚠️ **an anonymous callback's pages go unread** · `assertTabFlow`'s reader has "
        "pages nothing checks — killed by `every-page-template-parses.test.mjs`",
        [(PARSE, "    else if (ts.isCallExpression(fn.parent) && ts.isIdentifier(fn.parent.expression)) {\n", "    else if (false) {\n")],
    ),
    (
        "M20 · ⚠️ **a page is compiled inside a padded stand-in, not its executor's text** · a "
        "page ending in a `//` comment passes and is a SyntaxError where it runs (the `722` "
        "review) — killed by `every-page-template-parses.test.mjs`",
        [(PARSE, "    const [before, after] = page.outer\n", "    const [before, after] = { async: ['(async () => {\\n', '\\n})'], plain: ['(() => {\\n', '\\n})'], script: ['', ''] }[page.wrapper]\n")],
    ),
    (
        "M21 · ⛔ **a file's own channel template counts as its yield** · a file whose every "
        "executor call is missed reads as covered (the `722` review) — killed by "
        "`every-page-template-parses.test.mjs`",
        [(PARSE, "    yielded.set(file, own.size > 0 ? throughCalls : direct)\n", "    yielded.set(file, throughCalls + direct)\n")],
    ),
    (
        "M28 · ⛔ **a channel a parameter carries is counted as its own template** · a `const` "
        "that wraps the parameter, a class-field arrow, a `+` — each hands its callers' pages to "
        "nothing that reads them (the `722` review, round 2) — killed by "
        "`every-page-template-parses.test.mjs`",
        [(PARSE, "        if (name === null || !own.has(name)) {\n", "        if (false) {\n")],
    ),
    # ── C · step 38 — the second signal reaches the app ───────────────────────────────────────
    (
        "M9 · ⚠️ **a remembered pid is signalled without the orphan's authority** · an app its "
        "launcher left behind reads `exiting`, and the second ⌘Q is refused — killed by "
        "`owned-process.test.mjs`",
        [(OWNED, "    const result = signalSaved(saved, signal, { allowInitReparent: true })\n", "    const result = signalSaved(saved, signal)\n")],
    ),
    (
        "M10 · 🔴 **step 38's second signal goes to the group again** · the launcher it reaches "
        "has already exited, and 068's claim is never exercised — killed by "
        "`owned-process.test.mjs`",
        [(SMOKE, "        own.signalApp('SIGINT')\n", "        own.signal('SIGINT')\n")],
    ),
    # ── D · `717` F-6 — the desktop gate-only test asks the guard ─────────────────────────────
    (
        "M11 · 🔴 **the desktop test's start of a userData stops asking** · `clean-base` starts "
        "on whatever `--dir` it is handed — killed by "
        "`clean-base-starts-only-on-scratch.test.mjs`",
        [(DESK, "  mustNameScratch(['--dir', userData, ...flags])\n", "")],
    ),
    (
        "M12 · 🔴 **…and its refusal start** — killed by "
        "`clean-base-starts-only-on-scratch.test.mjs`",
        [(DESK, "  mustNameScratch(['--dir', target, ...flags])\n", "")],
    ),
    # ── E · `probe:claude-launch-id`'s premises ───────────────────────────────────────────────
    (
        "M13 · ⛔ **an init read before the close still counts as closed before init** · a "
        "subject that measured nothing reads as R79 holding or failing — killed by "
        "`claude-launch-id-evidence.test.ts`",
        [(EVID, "    if (early.initBeforeClose !== false) {\n", "    if (false) {\n")],
    ),
    (
        "M14 · ⛔ **a CLI that wrote nothing is judged** · there was nothing to name, and it "
        "reads as the product failing — killed by `claude-launch-id-evidence.test.ts`",
        [(EVID, "    if (early.transcripts.length === 0) {\n", "    if (false) {\n")],
    ),
    (
        "M15 · 🔴 **the product's announcement is not read** · a row that keeps no ref would "
        "read as R79 holding — killed by `claude-launch-id-evidence.test.ts`",
        [(EVID, "  if (closed.announced !== closed.asked) {\n", "  if (false) {\n")],
    ),
    (
        "M22 · ⛔ **an init that landed DURING the close still counts as closed before init** · "
        "the ordinary init path named it, and it reads as R79 holding (the `722` review) — "
        "killed by `claude-launch-id-evidence.test.ts`",
        [(EVID, "    if (early.initId !== null) {\n", "    if (false) {\n")],
    ),
    (
        "M23 · ⚠️ **an announcement on any door passes** · a `started` ref is the init path's, "
        "not R79's — killed by `claude-launch-id-evidence.test.ts`",
        [(EVID, "  if (closed.announcedOn !== 'ended') {\n", "  if (false) {\n")],
    ),
    (
        "M24 · 🔴 **a reopen that took no turn under the ref passes** · the preflight alone "
        "reads as the CLI taking the id (the `722` review) — killed by "
        "`claude-launch-id-evidence.test.ts`",
        [(EVID, "  if (closed.resumed !== true) {\n", "  if (false) {\n")],
    ),
    (
        "M26 · ⛔ **a CLI that recorded the folder as launched still counts** · the subject no "
        "longer tests the recorded spelling, and reads as R79 holding (the `722` review, round 2) "
        "— killed by `claude-launch-id-evidence.test.ts`",
        [(EVID, "  if (closed.cwdRecorded === null || closed.cwdRecorded === closed.cwdLaunched) {\n", "  if (false) {\n")],
    ),
    (
        "M27 · 🔴 **the product's announced folder is not read** · a ref carrying the folder as "
        "TYPED would read as R79 holding — killed by `claude-launch-id-evidence.test.ts`",
        [(EVID, "  if (closed.cwdAnnounced !== closed.cwdRecorded) {\n", "  if (false) {\n")],
    ),
    # ── F · the delegation-tools reader ───────────────────────────────────────────────────────
    (
        "M25 · ⚠️ **the reader of the provider's delegation tools reads nothing** · steps 57, "
        "58 and 80 would find out in a live batch — killed by `front-door.test.mjs`",
        # ⚑ Landing D-014 · re-anchored in place, not retired (landing review) — the reader is now a
        # written list (`nativeDelegationTools()`), still pinned by front-door.test.mjs. Re-verified
        # RED alone.
        [
            (APP_SOURCE, "  return ['Agent', 'Workflow', 'Task']\n", '  return []\n'),
        ],
    ),
]
