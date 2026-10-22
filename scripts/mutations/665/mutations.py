"""665 · the matrix step's one stale read, and the run — what the free half of `665` newly carries.

⛔ **Ordered by the PM on `660`'s findings.** `660`'s one paid run died at 75 s on
`durable.request.because`, a field `611` had moved into the `went` union; step 81 carried the same
line. `665` fixed both reads (the WHOLE arm, not one field of it) and built the census that would
have caught it for $0 — every field a live smoke reads, page-side, off the preload bridge, type-checked
against the renderer's own declaration of `window.api`. It then made the run's record trustworthy:
C17 through the rows' own catch (F6), no exit 0 for a run that measured nothing (F7), the record
kept outside `/tmp` by an include-list that can never take `user-data/` (F8), every unit's wall clock
in the record (F9), and a price that says UNPRICED rather than `$0.0000` for Codex. The PM's two
rulings: §6 reaches the live agents as their OWN INSTRUCTIONS, written by the harness, so no model
transcribes it (R14); and every live smoke grants the `'default'` it creates exactly what its steps
use (R15).

## ⚠️ What a row here measures

 * ⚑ **Most rows are killed by a source census** — `step-census.test.mjs`,
   `permission-matrix-security.test.mjs` — which proves the cheap gate NOTICES the edit, never that
   the edited step would still measure. ⛔ That is the live run, and `665` ran it once.
 * 🔴 **M1–M3 are killed by the COMPILER, not by text** — `page-ipc-census.test.mjs` type-checks
   the edited page template and finds the read its type does not declare. They are the rows the
   census exists for: `660`'s defect, verbatim, and its two siblings.
 * ⚑ **M4–M7 and M39–M41 break the census itself**; its planted control (seven drifts, three
   pages) and its candidate-sorting control are what kill them.
 * ⚑ **M24–M29, M37 and M38 are killed by BEHAVIOUR** — `matrix-record.test.mjs` and
   `smoke-price.test.mjs` run the keeper, the exit table, the record count and the pricer on
   planted fixtures.

## ⛔ What this table cannot reach

 * 🔴 **Whether the live identity actually heeds its instructions.** `the-layer-a-person-writes`
   pins, for $0, that the door's bytes reach the bundle file both providers read; the run reads each
   launch's bundle back. ⚠️ Neither is a model's obedience to the text.
 * ⚠️ **Steps 81, 35, 64 and the lifecycle stage are NOT RUN** — R15 and `592`'s drift there are code
   changes a census pins, by the dispatch's own order.

## ⚑ Changed by `669`

 * ⛔ **M23's recorded RED was measured against the OLD text** — `finishPermissionMatrixRun(…)`. `669`
   F-c renamed the finisher `finishSelectedRun` and gave it the step; the row is corrected in place
   and `669` re-verified it red before recording it.
 * ⛔ **M16's recorded RED was measured against the OLD comment** above the line it edits — R17
   rewrote that comment's last line, which the anchor spelled to be unique. Corrected in place, and
   re-verified red.
 * ⛔ **M2 and M14 are RETIRED, `anchor-absent`, with their subject.** `669` R16 removed step 81's
   take-over gesture — the routed request M2 read — and step 81 grants `'default'` nothing now,
   because it runs as BroBot on its SEED, which holds `canCreateProjects` (M14). Step 82's half of
   M2's read stands as M1.
"""

SMOKE = "scripts/ui-live-smoke.mjs"
RESUME = "scripts/resume-live-smoke.mjs"
LIFECYCLE = "apps/desktop/smoke/lifecycle-stage.smoke.ts"
UI_LIVE_SMOKE = "scripts/ui-live-smoke.mjs"
CENSUS = "scripts/lib/page-ipc-census.mjs"
RECORD = "scripts/lib/matrix-record.mjs"
PRICE = "scripts/lib/smoke-price.mjs"
BLOCK = "scripts/lib/security-block.txt"

MUTATIONS: list[tuple[str, list[tuple[str, str, str]]]] = [
    (
        "M1 · 🔴 `660`'s DEFECT, verbatim · step 82 reads `durable.request.because` again — "
        "`undefined` since `611`, and the paid run dies at C17 · killed by `page-ipc-census.test.mjs`",
        [
            (
                SMOKE,
                "                  went: durable.request.went,\n                  state: durable.request.state,",
                "                  because: durable.request.because,\n                  state: durable.request.state,",
            ),
        ],
    ),
    (
        "M2 · 🔴 the same read, step 81 · killed by `page-ipc-census.test.mjs`",
        [
            (
                SMOKE,
                "              askedBy: durable.request.askedBy,\n              went: durable.request.went,",
                "              askedBy: durable.request.askedBy,\n              because: durable.request.because,",
            ),
        ],
    ),
    (
        "M3 · ⚠️ the third stale read the census found on `main` — an error-path diagnostic printing "
        "`undefined` for every unresumable row · killed by `page-ipc-census.test.mjs`",
        [
            (
                SMOKE,
                "unresumable: no.map((r) => ({ id: r.sessionId, status: r.status, reason: r.reason })),",
                "unresumable: no.map((r) => ({ id: r.id, status: r.status, reason: r.reason })),",
            ),
        ],
    ),
    (
        "M4 · ⛔ the census goes blind to a zod-INFERRED shape — `AppInfo`'s fields are declared in "
        "zod's own types, so a filter on `node_modules` excludes them · killed by "
        "`page-ipc-census.test.mjs` (the planted control)",
        [
            (
                CENSUS,
                r"const THE_LANGUAGE = /[\\/]node_modules[\\/]typescript[\\/]lib[\\/]/",
                r"const THE_LANGUAGE = /[\\/]node_modules[\\/]/",
            ),
        ],
    ),
    (
        "M5 · ⛔ the census forgets destructuring — `const { field } = value` reads a field too · "
        "killed by `page-ipc-census.test.mjs` (the planted control)",
        [
            (
                CENSUS,
                "      } else if (\n"
                "        ts.isBindingElement(node.parent) &&\n"
                "        ts.isObjectBindingPattern(node.parent.parent)\n"
                "      ) {",
                "      } else if (false) {",
            ),
        ],
    ),
    (
        "M6 · 🔴 the census types `window.api` as nothing — without the renderer's own declaration "
        "every read is `any` and the census passes everything · killed by `page-ipc-census.test.mjs`",
        [
            (
                CENSUS,
                "ts.createProgram([name, rendererWindow], options, host)",
                "ts.createProgram([name], options, host)",
            ),
        ],
    ),
    (
        "M7 · ⛔ page code handed to `evaluate` that does not parse is filed as PROSE — the census "
        "goes quiet on it instead of refusing · killed by `page-ipc-census.test.mjs`",
        [
            (
                CENSUS,
                "else if (isTemplate || isInsideAnEvaluate(ts, node)) unparsed.push(found)",
                "else if (isTemplate) unparsed.push(found)",
            ),
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-016a, bd70d693):** The wait (now.surface === 'waiting' &&
        # ...) was inside step 81, 'a person's No from their queue' on a proposal BroBot made
        # (PersonsQueue.vue's No, proposal_ended). D-016a deleted step 81 and its machinery from
        # ui-live-smoke.mjs ("Proposals go end to end"); neither 'waiting' nor 'home' is compared
        # against now.surface anywhere in the file. Its anchor is left stale, so the census records
        # it retired.
        "M8 · ⛔ F3 · step 81 waits on 'home' again — a surface its reader has not answered since "
        "`606`, so the wait can never pass · killed by `step-census.test.mjs`",
        [
            (
                SMOKE,
                "              return now.surface === 'waiting' &&",
                "              return now.surface === 'home' &&",
            ),
        ],
    ),
    (
        "M9 · 🔴 R14 · a prompt carries §6 again — the child's work, relayed through the controller, "
        "is ~7,000 characters a MODEL must re-type byte-exact · killed by "
        "`permission-matrix-security.test.mjs`",
        [
            (
                SMOKE,
                "            return instruction\n",
                "            return `${instruction}\\n\\n${SECURITY_BLOCK}`\n",
            ),
        ],
    ),
    (
        "M10 · 🔴 R14 · the children's identity is never given §6 — only the controller carries it · "
        "killed by `permission-matrix-security.test.mjs`",
        [
            (
                SMOKE,
                "            [matrixController, 'project-manager'],\n",
                "            [matrixController],\n",
            ),
        ],
    ),
    (
        "M11 · ⛔ R14 · a child's launch is never read back for §6 · killed by "
        "`permission-matrix-security.test.mjs`",
        [
            (
                SMOKE,
                "            await blockCarriedBy('project-manager', provider, `${provider}/${outcome} child`)\n",
                "",
            ),
        ],
    ),
    (
        "M12 · ⛔ R14 · the carrier stops comparing the bytes it wrote — any text would pass · killed "
        "by `permission-matrix-security.test.mjs`",
        [
            (
                SMOKE,
                "        byteEqual: newest?.text === block,",
                "        byteEqual: true,",
            ),
        ],
    ),
    (
        "M13 · 🔴 R14 · the smoke's copy of §6 drifts one clause from the dispatch's bytes · killed "
        "by `permission-matrix-security.test.mjs` (the fixture census)",
        [
            (
                BLOCK,
                "NEVER READ, COPY OR WRITE A CREDENTIAL",
                "NEVER READ OR WRITE A CREDENTIAL",
            ),
        ],
    ),
    (
        "M14 · 🔴 R15 · step 81's `default` loses `create_project` — ruled `'none'`, so its first "
        "gesture is refused by a rail and reads as the model failing · killed by `step-census.test.mjs`",
        [
            (
                SMOKE,
                "            canCreateProjects: 'any',\n",
                "",
            ),
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-014, 010f9426):** The `grantExactly` helper, and its
        # `moved: Object.keys(granted).sort(),` read-back, were deleted from ui-live-smoke.mjs by
        # D-014. The '665 · R15' test that pinned it was removed and replaced by
        # `expect(smoke).not.toContain('async function grantExactly(')`. Its anchor is left stale,
        # so the census records it retired.
        "M15 · ⛔ R15 · `grantExactly` stops checking that nothing else moved — a WIDENED grant passes · "
        "killed by `permission-matrix-security.test.mjs`",
        [
            (
                SMOKE,
                "    moved: Object.keys(granted).sort(),",
                "    moved: answer?.moved,",
            ),
        ],
    ),
    (
        "M16 · 🔴 R15 · the lifecycle stage opens as `'default'` again — an identity that line alone "
        "creates, ungranted, beside a stage that ran as BroBot · killed by `step-census.test.mjs` "
        "⚑ ANCHOR CORRECTED IN PLACE BY 669",
                # ⚑ **Re-anchored by `669`, not retired** (142's rule): R17 made the call the comment
                # above this line deferred to the PM, and rewrote its last line. Same line, same kill.
        # ⚑ Landing D-016b (5e931be8, the tree) · re-anchored in place, not retired — R15 survives:
        # the lifecycle stage opens BroBot's first conversation as DEFAULT_PROFILE_ID ('brobot'),
        # not as a literal 'default' identity created nowhere else. The line is unchanged, but the
        # comment above it now ends 'by that give itself since D-016. NOT RUN.' and the old anchor's
        # tail 'rows 2 and 4. NOT RUN.' is gone. Re-anchored on the new tail, which is unique.
        # Killed by `step-census.test.mjs`.
        [
            (LIFECYCLE, 'by that give itself since D-016. NOT RUN.\n        profileId: DEFAULT_PROFILE_ID,', "by that give itself since D-016. NOT RUN.\n        profileId: 'default',"),
        ],
    ),
    (
        "M17 · ⛔ `resume-live-smoke` restates the front door's profile as `'default'` — step 1's home "
        "check throws on every run since `592` · killed by `step-census.test.mjs`",
        [
            (
                RESUME,
                "const PROFILE = constantFrom('DEFAULT_PROFILE_ID')",
                "const PROFILE = 'default'",
            ),
        ],
    ),
    (
        "M18 · ⛔ step 64's negative names `/default/claude` again — a home nothing writes, so the "
        "check can never fire · killed by `step-census.test.mjs`",
        [
            (
                SMOKE,
                "      if (said.home.includes(`/${BROBOT_PROFILE_ID}/claude`)) {",
                "      if (said.home.includes('/default/claude')) {",
            ),
        ],
    ),
    (
        "M19 · 🔴 F6 · a stall BEFORE the handoff is FAIL again — rule 13 says NOT PERFORMED · killed "
        "by `permission-matrix-security.test.mjs`",
        [
            (
                SMOKE,
                "                if (error instanceof MatrixStop && error.kind === 'not-performed') {",
                "                if (false) {",
            ),
        ],
    ),
    (
        "M20 · 🔴 F6 · a failed C17 is filed as a DONE C17 — `repairRetakesComplete` counts it and the "
        "step can pass without it · killed by `permission-matrix-security.test.mjs`",
        [
            (
                SMOKE,
                "              if (failed) retakes.push({ kind: 'criterion-17-failed', ...record })",
                "              if (failed) retakes.push({ ...record, kind: 'criterion-17-undisplayable-command' })",
            ),
        ],
    ),
    (
        "M21 · ⛔ F9 · a recovered failure is kept with no clock · killed by "
        "`permission-matrix-security.test.mjs`",
        [
            (
                SMOKE,
                "              }\n              failure.clock = clockNow()\n              keep(failure, true)\n              preserve()\n              console.log(",
                "              }\n              keep(failure, true)\n              preserve()\n              console.log(",
            ),
        ],
    ),
    (
        "M22 · ⚠️ F9 · a C20 unit loses its own clock and folds into its Codex row's · killed by "
        "`permission-matrix-security.test.mjs`",
        [
            (
                SMOKE,
                "              criterion20.clock = {\n",
                "              criterion20.clockNotKept = {\n",
            ),
        ],
    ),
    (
        "M23 · 🔴 F7 · `660`'s DEFECT, verbatim · a selected run that hits its deadline exits 0 — "
        "`REAL_EXIT` reads the same as a pass · killed by `permission-matrix-security.test.mjs` "
        "⚑ ANCHOR CORRECTED IN PLACE BY 669",
                # ⚑ **Re-anchored by `669`, not retired** (142's rule): F-c renamed the finisher and
                # gave it the step, so step 81's deadline ends through it too. Same defect, same kill.
        # ⚑ Landing D-016a (bd70d693) · re-anchored in place, not retired — The rule still holds:
        # the step-82 deadline reporter must end through finishSelectedRun, never process.exit(0).
        # The finisher lost its step argument when step 81 was deleted, so the old call text moved;
        # plant process.exit(0) on the current call.
        [
            (UI_LIVE_SMOKE, "    process.exit(finishSelectedRun('the selected run hit its deadline'))", '    process.exit(0)'),
        ],
    ),
    (
        "M24 · 🔴 F7 · the exit table calls NOT PERFORMED a pass · killed by `matrix-record.test.mjs`",
        [
            (
                RECORD,
                "  return verdict === 'PASS' ? 0 : MATRIX_NOT_MEASURED_EXIT",
                "  return verdict === 'PASS' || verdict === 'NOT PERFORMED' ? 0 : MATRIX_NOT_MEASURED_EXIT",
            ),
        ],
    ),
    (
        "M25 · 🔒 F8 · the keeper follows a symlink — a link planted beside the record reaches the "
        "app's copy of `auth.json` · killed by `matrix-record.test.mjs`",
        [
            (
                RECORD,
                "    .filter((entry) => entry.isFile() && !entry.isSymbolicLink())",
                "    .filter((entry) => !entry.isDirectory())",
            ),
        ],
    ),
    (
        "M26 · 🔒 F8 · an include pattern loses its start anchor — it now matches inside longer names · "
        "killed by `matrix-record.test.mjs`",
        [
            (
                RECORD,
                "  /^[a-z0-9-]+\\.png$/,",
                "  /[a-z0-9-]+\\.png$/,",
            ),
        ],
    ),
    (
        "M27 · ⛔ F8 · the record is kept in `/tmp` again — pruned, and gone at the next reboot · "
        "killed by `matrix-record.test.mjs`",
        [
            (
                RECORD,
                "export const MATRIX_RECORD_ROOT = join(homedir(), 'brobot2-scratch', 'permission-matrix-records')",
                "export const MATRIX_RECORD_ROOT = join('/tmp', 'brobot2-scratch', 'permission-matrix-records')",
            ),
        ],
    ),
    (
        "M28 · 🔴 the price · Codex transcripts are not counted — `660`'s `$0.0000` for a run that "
        "spent · killed by `smoke-price.test.mjs`",
        [
            (
                PRICE,
                "    codexFiles: perFile.filter(isCodexRollout).length,",
                "    codexFiles: 0,",
            ),
        ],
    ),
    (
        "M29 · ⛔ the price · the UNPRICED line is never said, even when every transcript is Codex · "
        "killed by `smoke-price.test.mjs`",
        [
            (
                PRICE,
                "  if (answer.priced.length === 0 && answer.unpriced.length === 0 && codexFiles > 0) {",
                "  if (answer.priced.length === 0 && answer.unpriced.length === 0 && codexFiles < 0) {",
            ),
        ],
    ),
    (
        "M30 · ⛔ a refused permission answer is read as SENT — the step waits out a decision row that "
        "can never come · killed by `permission-matrix-security.test.mjs`",
        [
            (
                SMOKE,
                "            decision: { outcome: 'allow' },\n"
                "          }).then((ack) => ack.outcome === 'taken' ? true : 'REFUSED: ' + JSON.stringify(ack))",
                "            decision: { outcome: 'allow' },\n          }).then(() => true)",
            ),
        ],
    ),
    (
        "M31 · 🔴 R14 · THE DEFECT the review found · the relay stops saying the child already holds "
        "§6 — the controller's own instructions tell it to put §6 into every spawned agent's prompt, "
        "so an obedient controller breaks the byte-exact relay · killed by "
        "`permission-matrix-security.test.mjs`",
        # ⚑ Landing D-016b (5e931be8, the tree) · re-anchored in place, not retired — R14 survives:
        # the controller's prompt must say the child already holds section 6, or an obedient
        # controller appends the block to the brief and breaks the byte-exact relay. The sentence is
        # still in the give prompt, reworded for D-016 ('it is written there before any conversation
        # of it starts'; 'to the brief'). The old anchor's text no longer exists. Killed by
        # `permission-matrix-security.test.mjs`.
        [
            (UI_LIVE_SMOKE, "              'That agent already holds the security block from your own instructions, verbatim, as its ' +\n              'own instructions — it is written there before any conversation of it starts — so do not ' +\n              'add that block, or anything else, to the brief. ' +\n", ''),
        ],
    ),
    (
        "M32 · 🔴 F6 · THE DEFECT the review found · a row's stop bypasses `endedEarly` — a product "
        "failure an earlier row MEASURED is reported as NOT PERFORMED, exit 3 · killed by "
        "`permission-matrix-security.test.mjs`",
        [(SMOKE, "              if (row.stop) return endedEarly(row.stop)", "              if (row.stop) return row.stop")],
    ),
    (
        "M33 · ⛔ F6 · `endedEarly` never throws — FAIL no longer outranks a stop · killed by "
        "`permission-matrix-security.test.mjs`",
        [
            (
                SMOKE,
                "          const endedEarly = (stop) => {\n            if (productFailures.length > 0) {",
                "          const endedEarly = (stop) => {\n            if (productFailures.length > 1e9) {",
            ),
        ],
    ),
    (
        "M34 · ⛔ F6 · a provider that did something else before the handoff is FAIL again, not NOT "
        "ASSERTED · killed by `permission-matrix-security.test.mjs`",
        [
            (
                SMOKE,
                "                if (error instanceof MatrixStop) return { stop: claims(unasserted(why)) }\n",
                "",
            ),
        ],
    ),
    (
        "M35 · 🔴 F7 · the finisher ignores the failures the record MEASURED — a deadline after a "
        "product failure exits 3 · killed by `permission-matrix-security.test.mjs`",
        [
            (
                SMOKE,
                "const exit = crashed ? 1 : matrixRunExitCode({ failed, verdict, measuredFailures })",
                "const exit = crashed ? 1 : matrixRunExitCode({ failed, verdict })",
            ),
        ],
    ),
    (
        "M36 · ⛔ F7 · a crash records an exit status the process does not return · killed by "
        "`permission-matrix-security.test.mjs`",
        [
            (
                SMOKE,
                "const exit = crashed ? 1 : matrixRunExitCode({ failed, verdict, measuredFailures })",
                "const exit = matrixRunExitCode({ failed, verdict, measuredFailures })",
            ),
        ],
    ),
    (
        "M37 · 🔴 F7 · the exit table lets a deadline outrank a measured failure · killed by "
        "`matrix-record.test.mjs`",
        [(RECORD, "  if (failed > 0 || measuredFailures > 0) return 1", "  if (failed > 0) return 1")],
    ),
    (
        "M38 · ⛔ F7 · the record count finds no product failure it holds · killed by "
        "`matrix-record.test.mjs`",
        [
            (
                RECORD,
                "(unit) => unit?.classification === 'product-failure',",
                "(unit) => unit?.classification === 'product-failed',",
            ),
        ],
    ),
    (
        "M39 · ⛔ F10 · the census stops checking the bridge's INPUTS — a renamed input key launches on "
        "a default, silently · killed by `page-ipc-census.test.mjs` (the planted control)",
        [
            (
                CENSUS,
                "(diagnostic.code === 2353 || diagnostic.code === 2561 || diagnostic.code === 2322) &&",
                "(diagnostic.code === 0) &&",
            ),
        ],
    ),
    (
        "M40 · ⛔ F10 · the census stops checking comparisons — `ack.outcome === 'taken'` against a "
        "renamed literal is never true, and nothing says so · killed by `page-ipc-census.test.mjs`",
        [(CENSUS, "    if (diagnostic.code === 2367) {", "    if (diagnostic.code === -2367) {")],
    ),
    (
        "M41 · ⚠️ F10 · only a call named exactly `evaluate` counts as a page executor — "
        "`evaluateInPage`'s unparseable page code is filed as prose · killed by "
        "`page-ipc-census.test.mjs`",
        [(CENSUS, "const EXECUTOR = /^#?evaluate/", "const EXECUTOR = /^#?evaluate$/")],
    ),
]
