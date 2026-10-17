"""669 · the smokes, bounded and describing today's product — what `669` newly carries.

⛔ **Ordered by the PM on `655`'s G1/G2 and `665`'s findings.** Half A put seven more smoke files on
`smoke/probe-run-deadline.ts` in the template's shape — owned teardown before anything exists, a
refusal at start and after each bind, `deadline.testTimeoutMs` on the `it()`, each budget derived
from the file's own waits — and built the census that names every smoke file as on the helper or NOT
(G1) and measures each adopter's budget against the bound vitest applies (G2). ⚑ The four `$0`
loopback probes were run green and are fingerprinted; the two live files and the archive sweep were
not run, so their census counts the waits where they are made. Half B re-aimed step 81 at today's
product (R16: one gesture, BroBot on its seed), ended its deadline through step 82's finisher (F-c),
read step 42's planted path from the app (F-d), derived the matrix allowance from `665`'s clocks
(F-e), and made the lifecycle stage perform `584`'s seed — each tier CREATING the tier below (R17).

## ⚠️ What a row here measures

 * ⚑ **M1–M17 break the census itself** — `smoke-deadline-census.mjs` — and are killed by its
   planted controls in `smoke-deadlines.test.mjs`: a source it must catch, beside one it must pass.
 * ⛔ **M18 is G1's named debt; M19–M39 edit the live files and the sweep, and are killed by that
   census reading them** — which proves the cheap gate NOTICES the edit, never that the edited smoke
   would still measure. ⛔ Neither live file nor the sweep was run by `669`, by the dispatch's order.
 * ⚑ **M40–M50 are steps 81, 82 and 42**, killed by `step-census.test.mjs` and
   `permission-matrix-security.test.mjs` source pins. ⚠️ Steps 81 and 42 were not run.
 * ⚑ **M51–M56 are R17**, killed by `lifecycle-steps.test.mjs`'s `r17Findings`. ⚠️ The stage was not
   run: these rows prove the verdict's clause exists, not that a live model reaches it.
 * ⚑ **M57–M65 are the review's third round** — six census escapes, the sweep's setting check and
   two R17 placements — each killed by the plant that round added beside it.
 * ⛔ **The four probe files are not rowed.** Their census files end in a fingerprint of the code that
   ran green, so ANY edit to them is red — a row there would measure the fingerprint, not the pin
   its title names.

## ⚑ Changed by `674`

 * ⛔ **M47 and M48 are RETIRED, `anchor-absent`, with their subject.** `674` R20 removed `669` F-e's
   allowance — one good run's longest unit × 1.5 — and put steps 81 and 82 back on `042`'s rule over
   their own worst case. The margin M47 drifted is `STEP_BUDGET_MARGIN` now, held equal to the
   helper's by `step-budgets.test.mjs`: `674`'s own table carries that row.

## ⛔ What this table cannot reach

 * 🔴 **Whether a live smoke's derived budget is long enough for the provider it drives.** Only a run
   can say, and `669` ran none of `claude-live`, `codex-live`, step 81 or the lifecycle stage.
 * ⚠️ **R17's doubled `pmSpawn`/`workerSpawn` bounds.** They are in the stated budget's sum, which the
   existing table measures, but no measurement says a model creates and then starts within them.
"""

CENSUS = "scripts/lib/smoke-deadline-census.mjs"
DEBT = "scripts/lib/smoke-deadline-debt.mjs"
CLAUDE = "packages/runtime/smoke/claude-live.smoke.ts"
CODEX = "packages/runtime/smoke/codex-live.smoke.ts"
SWEEP = "apps/desktop/smoke/archive-sweep.smoke.ts"
SMOKE = "scripts/ui-live-smoke.mjs"
APP_SOURCE = "scripts/lib/app-source.mjs"
STAGE = "apps/desktop/smoke/lifecycle-stage.smoke.ts"
UI_LIVE_SMOKE = "scripts/ui-live-smoke.mjs"

MUTATIONS: list[tuple[str, list[tuple[str, str, str]]]] = [
    (
        "M1 · ⛔ G1 · a test registered under an ALIAS is not a test — `test as live` runs outside the "
        "deadline and the file still reads as on the helper · killed by `smoke-deadlines.test.mjs`",
        [
            (
                CENSUS,
                "      if (TEST_REGISTRARS.has(imported)) tests.add(element.name.text)",
                "      if (TEST_REGISTRARS.has(imported) && element.propertyName === undefined)\n"
                "        tests.add(element.name.text)",
            ),
        ],
    ),
    (
        "M2 · ⛔ G1 · only a `before*` hook counts as work outside the deadline — an `afterAll` or an "
        "`aroundAll` is read as a test · killed by `smoke-deadlines.test.mjs`",
        [
            (
                CENSUS,
                "    if (registrar.kind === 'hook') {\n      why.push(",
                "    if (registrar.kind === 'hook' && registrar.spelled.startsWith('before')) {\n      why.push(",
            ),
        ],
    ),
    (
        "M3 · ⛔ G1 · a top-level `await` — work at import, outside every deadline — is seen only as "
        "`for await` · killed by `smoke-deadlines.test.mjs`",
        [
            (
                CENSUS,
                "      (ts.isAwaitExpression(node) || (ts.isForOfStatement(node) && node.awaitModifier)) &&\n",
                "      ts.isForOfStatement(node) &&\n      node.awaitModifier !== undefined &&\n",
            ),
        ],
    ),
    (
        "M4 · 🔴 G2 · the budget evaluator reads the TESTER'S global object — a derivation through "
        "`globalThis.process.env` answers the shell's value, not the file's default · killed by "
        "`smoke-deadlines.test.mjs`",
        [
            (
                CENSUS,
                "  return run(runBudgetMs, sandbox, globals, globals)",
                "  return run(runBudgetMs, sandbox, globalThis, globalThis)",
            ),
        ],
    ),
    (
        "M5 · 🔴 G2 · `655`'s DEFECT, in the census · a test WITHOUT the deadline's timeout is read as "
        "carrying it — vitest's twenty minutes cut a longer budget and the census says the deadline "
        "fires first · killed by `smoke-deadlines.test.mjs`",
        [
            (
                CENSUS,
                "  const vitestMs = every ? budget.testTimeoutMs : configTimeoutMs",
                "  const vitestMs = budget.testTimeoutMs",
            ),
        ],
    ),
    (
        "M6 · 🔴 a waiting helper is charged once per place it is NAMED, not per time it RUNS — a "
        "helper called from a function called twice is charged once · killed by "
        "`smoke-deadlines.test.mjs`",
        [
            (
                CENSUS,
                "      weight = references.reduce((sum, reference) => sum + weightOfPlace(reference), 0)",
                "      weight = references.length",
            ),
        ],
    ),
    (
        "M7 · ⛔ an approval loop is charged its cap, not its cap + 1 — the terminal wait after the "
        "last card goes uncounted · killed by `smoke-deadlines.test.mjs`",
        [
            (
                CENSUS,
                "        factor *= cap + 1\n",
                "        factor *= cap\n",
            ),
        ],
    ),
    (
        "M8 · ⛔ `while (true)` is not seen as a loop that runs until it breaks — an uncapped one is "
        "never named · killed by `smoke-deadlines.test.mjs`",
        [
            (
                CENSUS,
                "    return node.expression.kind === ts.SyntaxKind.TrueKeyword",
                "    return false",
            ),
        ],
    ),
    (
        "M9 · ⚑ a timer inside `Promise.race([…])` that RESOLVES — a teardown's `settledWithin` — is "
        "no longer a race timer, and the live files' count refuses it · killed by "
        "`smoke-deadlines.test.mjs`",
        [
            (
                CENSUS,
                "      at.parent.expression.getText() === 'Promise.race'",
                "      at.parent.expression.getText() === 'Promise.all'",
            ),
        ],
    ),
    (
        "M10 · ⚑ a clocked poll's own sleeps are no longer its poll — `until = Date.now() + X` is "
        "charged where it is made, and its loop is refused as uncountable · killed by "
        "`smoke-deadlines.test.mjs`",
        [
            (
                CENSUS,
                "          if (ts.isIterationStatement(at, false) && isClockedPoll(ts, at, declared)) return\n",
                "",
            ),
        ],
    ),
    (
        "M11 · ⛔ a loop is capped by a counter it DECLARES, whether or not anything increases it · "
        "killed by `smoke-deadlines.test.mjs`",
        [
            (
                CENSUS,
                "  return [...counters].some((counter) => increased.has(counter))",
                "  return counters.size > 0",
            ),
        ],
    ),
    (
        "M12 · 🔴 a launch inside `opened` that drops the SIGNAL is not bare — a stalled handshake is "
        "given up on and its child left alive · killed by `smoke-deadlines.test.mjs`",
        [
            (
                CENSUS,
                "    if (!insideOpened || !passesSignal) bare.push(lineOf(file, node))",
                "    if (!insideOpened) bare.push(lineOf(file, node))",
            ),
        ],
    ),
    (
        "M13 · ⛔ an earlier section's refusal counts as this open's — any `deadline.refuse` anywhere "
        "before it is enough · killed by `smoke-deadlines.test.mjs`",
        [
            (
                CENSUS,
                "    if (!refusals.some((refusal) => refusal > since)) missing.push(lineOf(file, node))",
                "    if (refusals.length === 0) missing.push(lineOf(file, node))",
            ),
        ],
    ),
    (
        "M14 · 🔴 the `step(line, fn)` shape goes dark — a session handed to a PARAMETER and prompted "
        "there is never used, so nothing asks for a refusal after it opened · killed by "
        "`smoke-deadlines.test.mjs`",
        [
            (
                CENSUS,
                "        (ts.isIdentifier(callee) && (callee.text === 'waitFor' || parameters.has(callee.text)))",
                "        (ts.isIdentifier(callee) && callee.text === 'waitFor')",
            ),
        ],
    ),
    (
        "M15 · ⛔ a bound shadowed through OBJECT destructuring is not shadowed — the census charges the "
        "top-level value while the code waits on its own · killed by `smoke-deadlines.test.mjs`",
        [
            (
                CENSUS,
                "  if (ts.isObjectBindingPattern(name) || ts.isArrayBindingPattern(name)) {",
                "  if (ts.isArrayBindingPattern(name)) {",
            ),
        ],
    ),
    (
        "M16 · ⛔ each session is charged its opening and not its close · killed by "
        "`smoke-deadlines.test.mjs`",
        [
            (
                CENSUS,
                "    opened: value('OPEN_MS') + value('TEARDOWN_MS'),",
                "    opened: value('OPEN_MS'),",
            ),
        ],
    ),
    (
        "M17 · ⛔ a `node:timers/promises` sleep is charged nothing — only the bare specifier is "
        "refused · killed by `smoke-deadlines.test.mjs`",
        [
            (
                CENSUS,
                "      /^(?:node:)?timers(?:\\/promises)?$/.test(statement.moduleSpecifier.text)",
                "      statement.moduleSpecifier.text === 'timers/promises'",
            ),
        ],
    ),
    (
        "M18 · ⛔ G1 · a smoke file drops out of the named debt — neither on the helper nor named · "
        "killed by `smoke-deadlines.test.mjs`",
        [
            (
                DEBT,
                "  'apps/desktop/smoke/lifecycle-stage.smoke.ts',\n",
                "",
            ),
        ],
    ),
    (
        "M19 · 🔴 G2 · `655`'s DEFECT, verbatim · the Claude live smoke's `it()` loses the deadline's "
        "timeout — a six-hour budget cut at vitest's twenty minutes · killed by "
        "`smoke-deadlines.test.mjs`",
        [
            (
                CLAUDE,
                "  () => deadline.within('running the Claude live smoke', runClaudeSmoke),\n"
                "  deadline.testTimeoutMs,\n",
                "  () => deadline.within('running the Claude live smoke', runClaudeSmoke),\n",
            ),
        ],
    ),
    (
        "M20 · ⛔ the Claude file's table counts one driven turn fewer than its call sites make · "
        "killed by `smoke-deadlines.test.mjs`",
        [
            (
                CLAUDE,
                "const DRIVEN_TURNS = 8\n",
                "const DRIVEN_TURNS = 7\n",
            ),
        ],
    ),
    (
        "M21 · ⛔ the Codex file's table counts one session fewer than it opens · killed by "
        "`smoke-deadlines.test.mjs`",
        [
            # ⚑ 738 · anchor corrected in place: §3.1d (R96's pair) opens one more `step(` session.
            (
                CODEX,
                "const SESSIONS = 8 + 7\n",
                "const SESSIONS = 8 + 6\n",
            ),
        ],
    ),
    (
        "M22 · 🔴 an interrupt's acknowledgement waits unbounded again — a provider that never answers "
        "holds §3.4 for the run's hours · killed by `smoke-deadlines.test.mjs`",
        [
            (
                CLAUDE,
                "      await acknowledged('3.4 · the interrupt', h.interrupt())",
                "      await h.interrupt()",
            ),
        ],
    ),
    (
        "M23 · ⛔ the Claude teardown figure stops describing the runtime's close — the interrupt's "
        "two seconds dropped · killed by `smoke-deadlines.test.mjs`",
        [
            (
                CLAUDE,
                "const TEARDOWN_MS = 2_000 + 5_000\n",
                "const TEARDOWN_MS = 5_000\n",
            ),
        ],
    ),
    (
        "M24 · ⛔ the Codex teardown figure forgets the transport's second kill grace · killed by "
        "`smoke-deadlines.test.mjs`",
        [
            (
                CODEX,
                "const TEARDOWN_MS = 2_000 + 2_000 + (2_000 + 2 * 2_000)\n",
                "const TEARDOWN_MS = 2_000 + 2_000 + (2_000 + 2_000)\n",
            ),
        ],
    ),
    (
        "M25 · 🔴 §3.2's approval loop loses its cap — a card that re-prompts forever is answered "
        "forever, and the `cap + 1` the budget charges is a hope · killed by "
        "`smoke-deadlines.test.mjs`",
        [
            (
                CODEX,
                "      if (approvals >= MAX_APPROVALS_PER_TURN) {\n"
                "        throw new Error(\n"
                "          `write ${absPath}: still re-prompting after ${approvals} approvals — turn never terminalized`,\n"
                "        )\n"
                "      }\n",
                "",
            ),
        ],
    ),
    (
        "M26 · ⛔ §3.3's decline loop keeps its cap but never counts — `denials` stays 0 · killed by "
        "`smoke-deadlines.test.mjs`",
        [
            (
                CODEX,
                "      denials += 1\n",
                "",
            ),
        ],
    ),
    (
        "M27 · 🔴 a Claude step's launch drops the signal — a start that never answers is given up on "
        "and left running · killed by `smoke-deadlines.test.mjs`",
        [
            (
                CLAUDE,
                "        (signal) => runtime.start({ cwd: scratch, providerHome, model, signal }),",
                "        () => runtime.start({ cwd: scratch, providerHome, model }),",
            ),
        ],
    ),
    (
        "M28 · ⛔ a Claude step prompts a session that opened past the deadline — the refusal after "
        "the bind is gone · killed by `smoke-deadlines.test.mjs`",
        [
            (
                CLAUDE,
                "      deadline.refuse(`${line} · the session is open`)\n"
                "      const { pass, evidence } = await fn(handle, events)",
                "      const { pass, evidence } = await fn(handle, events)",
            ),
        ],
    ),
    (
        "M29 · ⛔ §3.12 opens a session with no refusal of its own since §3.11's last wait · killed by "
        "`smoke-deadlines.test.mjs`",
        [
            (
                CODEX,
                "    deadline.refuse(`starting ${line}`)\n"
                "    const owned = ownSessions()\n"
                "    try {\n"
                "      const handle = await opened(\n"
                "        line,\n"
                "        (signal) => runtime.start({ cwd: scratch, providerHome, approvalMode: 'auto', signal }),",
                "    const owned = ownSessions()\n"
                "    try {\n"
                "      const handle = await opened(\n"
                "        line,\n"
                "        (signal) => runtime.start({ cwd: scratch, providerHome, approvalMode: 'auto', signal }),",
            ),
        ],
    ),
    (
        "M30 · 🔴 a Claude step's catch records the deadline as its OWN line's FAIL — the run's "
        "NOT PERFORMED read as one step failing · killed by `smoke-deadlines.test.mjs`",
        [
            (
                CLAUDE,
                "      // ⚑ The deadline is the RUN's answer, never one line's FAIL.\n"
                "      if (e instanceof ProbeRunDeadlineExpired) throw e\n",
                "      // ⚑ The deadline is the RUN's answer, never one line's FAIL.\n",
            ),
        ],
    ),
    (
        "M31 · 🔴 the owner's teardown is no longer single-flight — a second call while one is closing "
        "finds an emptied list and returns before the child is reaped · killed by "
        "`smoke-deadlines.test.mjs`",
        [
            (
                CLAUDE,
                "      (closing ??= (async () => {",
                "      (closing = (async () => {",
            ),
        ],
    ),
    (
        "M32 · 🔴 `opened` gives up WITHOUT aborting — the Codex handshake that never answered keeps "
        "its child for the run · killed by `smoke-deadlines.test.mjs`",
        [
            (
                CODEX,
                "        timer = setTimeout(() => {\n          controller.abort()\n",
                "        timer = setTimeout(() => {\n",
            ),
        ],
    ),
    (
        "M33 · ⛔ a teardown aborts a launch and does not WAIT for it — the section's `finally` "
        "resolves while the aborted child is still being reaped · killed by "
        "`smoke-deadlines.test.mjs`",
        [
            (
                CLAUDE,
                "            await settledWithin(\n"
                "              opening.then((late) => late.close()),\n"
                "              TEARDOWN_MS,\n"
                "            )",
                "            void opening.then((late) => late.close())",
            ),
        ],
    ),
    (
        "M34 · 🔴 §3.7's isolation verdict is recorded past the deadline — the deadline's own abort "
        "throws `ResumeError`, and a run that measured nothing reads as isolation PASS · killed by "
        "`smoke-deadlines.test.mjs`",
        [
            (
                CODEX,
                "      deadline.refuse('3.7 · recording the isolation verdict')\n",
                "",
            ),
        ],
    ),
    (
        "M35 · ⛔ the sweep's budget is read at the whole-corpus rate (15.4 MB/s), not the slowest "
        "`046` measured · killed by `smoke-deadlines.test.mjs`",
        [
            (
                SWEEP,
                "const SLOWEST_MEASURED_BYTES_PER_MS = (4.4 * 1024 ** 2) / 1000",
                "const SLOWEST_MEASURED_BYTES_PER_MS = (15.4 * 1024 ** 2) / 1000",
            ),
        ],
    ),
    (
        "M36 · ⛔ a reading pass is budgeted to its byte cap, not one session past it · killed by "
        "`smoke-deadlines.test.mjs`",
        [
            (
                SWEEP,
                "  MAX_TOTAL_BYTES > 0 ? READING_PASSES * msToRead(MAX_TOTAL_BYTES + MAX_SESSION_BYTES) : 0,",
                "  MAX_TOTAL_BYTES > 0 ? READING_PASSES * msToRead(MAX_TOTAL_BYTES) : 0,",
            ),
        ],
    ),
    (
        "M37 · 🔴 an expired sweep keeps READING the person's history — the passes are no longer handed "
        "`cancelled` · killed by `smoke-deadlines.test.mjs`",
        [
            (
                SWEEP,
                "  sweepArchives(sweepDeps, { ...options, cancelled: () => stopped })",
                "  sweepArchives(sweepDeps, options)",
            ),
        ],
    ),
    (
        "M38 · 🔴 the review's own find · the normal close sets `stopped` — a healthy run cancels §6's "
        "passes before they begin · killed by `smoke-deadlines.test.mjs`",
        [
            (
                SWEEP,
                "  const closeOwnedSweep = async (): Promise<void> => {\n"
                "    if (measuring?.open === true) measuring.close()",
                "  const closeOwnedSweep = async (): Promise<void> => {\n"
                "    stopped = true\n"
                "    if (measuring?.open === true) measuring.close()",
            ),
        ],
    ),
    (
        "M39 · ⛔ a mistyped `SWEEP_*` (`NaN`) is no longer refused — a `NaN` timer fires at once and "
        "closes the database under the first pass · killed by `smoke-deadlines.test.mjs`",
        [
            (
                SWEEP,
                "  !Number.isFinite(SWEEP_BUDGET_MS) ||\n  SWEEP_BUDGET_MS <= 0 ||\n",
                "",
            ),
        ],
    ),
    (
        "M40 · 🔴 F-c · `665`'s last `process.exit(0)`, verbatim · step 81's deadline exits 0 — a "
        "gesture that measured nothing reads as a pass · killed by `step-census.test.mjs`",
        # ⚑ Landing D-016a (bd70d693) · re-anchored in place, not retired — Step 81 went with the
        # proposals, but the rule (a selected run that hits its deadline must end through the
        # finisher, never `process.exit(0)`) survives on step 82's deadline reporter, which is now
        # the one `finishSelectedRun('the selected run hit its deadline')` line. Plant
        # `process.exit(0)` there. Both named pins stay red.
        [
            (UI_LIVE_SMOKE, "    process.exit(finishSelectedRun('the selected run hit its deadline'))", '    process.exit(0)'),
        ],
    ),
    (
        "M41 · 🔴 F-c · step 81's finished run falls through to `failed === 0 ? 0 : 1` — a NOT "
        "PERFORMED gesture with no FAIL exits 0 · killed by `step-census.test.mjs`",
        # ⚑ Landing D-016a (bd70d693) · re-anchored in place, not retired — Step 81's finish block
        # is gone, but step 82's identical `if (permissionMatrixRun) {
        # process.exit(finishSelectedRun('the selected run finished', ...)) }` block stays and has
        # no row. Deleting it lets a NOT PERFORMED step 82 with no FAIL fall through to `failed ===
        # 0 ? 0 : 1`. step-census no longer pins this path, so the killer is
        # permission-matrix-security.
        [
            (UI_LIVE_SMOKE, "  if (permissionMatrixRun) {\n    process.exit(finishSelectedRun('the selected run finished', { printSpend: false }))\n  }\n", ''),
        ],
    ),
    (
        "M42 · ⛔ F-c · a crashed step-81 run is no longer selected — it ends without the finisher · "
        "killed by `step-census.test.mjs`",
        # ⚑ Landing D-016a (bd70d693) · re-anchored in place, not retired — The Map entry `['81',
        # ...]` is gone. The rule (a crashed selected run still ends through the finisher) survives
        # in `main().catch`, whose selection is now `ONLY[0] === '82'`, and no row covers it. With
        # only one selectable step left, 'no longer selected' means dropping that whole `if` block
        # so the crash ends with a bare `process.exit(1)`.
        [
            (UI_LIVE_SMOKE, "  if (!ATTACH_MODE && ONLY?.length === 1 && ONLY[0] === '82') {\n    process.exit(\n      finishSelectedRun(`the run crashed: ${error instanceof Error ? error.message : error}`, {\n        crashed: true,\n      }),\n    )\n  }\n", ''),
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-016a, bd70d693):** The row's subject was step 81 keeping
        # a matrix record it never wrote, via `const matrix = step === PERMISSION_MATRIX_STEP`. Step
        # 81 and the `matrix` flag are deleted, and `finishSelectedRun` now reads the record for
        # step 82 only, so there is no non-matrix step left to keep a record it never wrote. The
        # commit removed 'a proposal BroBot made' and step 81's gesture ('This step presses
        # PersonsQueue.vue's own No on a proposal BroBot made'). Its anchor is left stale, so the
        # census records it retired.
        "M43 · ⛔ F-c · step 81's ending reads and KEEPS a matrix record it never wrote — its missing "
        "record counts as one measured failure · killed by `permission-matrix-security.test.mjs`",
        [
            (
                SMOKE,
                "  const matrix = step === PERMISSION_MATRIX_STEP",
                "  const matrix = true",
            ),
        ],
    ),
    (
        "M44 · 🔴 F-d · the old path, verbatim · step 42 plants into `default/default` — a home no "
        "profile has read since `584` · killed by `step-census.test.mjs`",
        # ⚑ Landing D-016a commit 2 (a5d66e92) · re-anchored in place, not retired — The rule
        # survives: step 42 must plant into BroBot's own home, and a hard-coded
        # `'default','default'` is a profile nothing has read since 584. The first slot is now the
        # app's HOME_FOLDER (was DEFAULT_PROJECT_ID) and the profile slot is still
        # BROBOT_PROFILE_ID, so the plant is the same literal pair over the renamed identifiers.
        # Killed by `step-census.test.mjs`.
        [
            (UI_LIVE_SMOKE, '        PROVIDER_HOMES_DIRNAME,\n        HOME_FOLDER,\n        BROBOT_PROFILE_ID,\n', "        PROVIDER_HOMES_DIRNAME,\n        'default',\n        'default',\n"),
        ],
    ),
    (
        "M45 · ⛔ F-d · the root is typed again instead of read from the app · killed by "
        "`step-census.test.mjs`",
        [
            (
                SMOKE,
                "const PROVIDER_HOMES_DIRNAME = constantFrom('PROVIDER_HOMES_DIRNAME')",
                "const PROVIDER_HOMES_DIRNAME = 'provider-homes'",
            ),
        ],
    ),
    (
        "M46 · ⛔ F-d · the declared home names a file that does not export the constant — the smoke "
        "throws at import, on a live run only · killed by `step-census.test.mjs`",
        [
            (
                APP_SOURCE,
                "  PROVIDER_HOMES_DIRNAME: 'src/main/runtime/provider-homes.ts',",
                "  PROVIDER_HOMES_DIRNAME: 'src/main/runtime/workspace.ts',",
            ),
        ],
    ),
    (
        "M47 · ⛔ F-e · the margin drifts from `042`'s — the allowance is no longer the helper's rule · "
        "killed by `step-census.test.mjs`",
        [
            (
                SMOKE,
                "const PERMISSION_MATRIX_MARGIN = 1.5\n",
                "const PERMISSION_MATRIX_MARGIN = 1.25\n",
            ),
        ],
    ),
    (
        "M48 · ⚠️ F-e · the typed 3.5 minutes come back — an allowance no clock measured · killed by "
        "`step-census.test.mjs`",
        [
            (
                SMOKE,
                "const PERMISSION_MATRIX_UNIT_BUDGET_MS = Math.ceil(\n"
                "  PERMISSION_MATRIX_LONGEST_UNIT_MS * PERMISSION_MATRIX_MARGIN,\n"
                ")",
                "const PERMISSION_MATRIX_UNIT_BUDGET_MS = 3.5 * 60_000",
            ),
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-014, 010f9426):** D-014 deleted step 81's read-back of
        # BroBot's seeded `canCreateProjects` (`brobotHolds` is gone). Its anchor is left stale, so
        # the census records it retired.
        "M49 · 🔴 R16 · step 81 stops reading BroBot's seed back — a person's narrowed grant reads as "
        "the model failing to propose · killed by `step-census.test.mjs`",
        [
            (
                SMOKE,
                "          if (brobotHolds?.canCreateProjects !== 'any') {",
                "          if (brobotHolds === undefined) {",
            ),
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-016a, bd70d693):** The row planted §6 going to `default`
        # in step 81's `carrySecurityBlock(cdp, [BROBOT_PROFILE_ID], ...)` call, and that call left
        # with step 81 (proposal gesture, removed by D-016: 'Proposals go end to end'). Step 82's
        # carrier `[matrixController, 'project-manager']` is already rowed by 665
        # (`[matrixController]` plant) and pinned at permission-matrix-security.test.mjs. Its anchor
        # is left stale, so the census records it retired.
        "M50 · 🔴 R16 · §6 rides to `default` — an identity step 81 no longer runs as — and BroBot is "
        "told nothing · killed by `step-census.test.mjs`",
        [
            (
                SMOKE,
                "          await carrySecurityBlock(cdp, [BROBOT_PROFILE_ID], PERMISSION_MATRIX_SECURITY_BLOCK)",
                "          await carrySecurityBlock(cdp, ['default'], PERMISSION_MATRIX_SECURITY_BLOCK)",
            ),
        ],
    ),
    (
        "M51 · 🔴 R17 · row 1 reads a seed typed here instead of the app's `SEEDED_GRANTS` · killed by "
        "`lifecycle-steps.test.mjs`",
        # ⚑ Landing D-014 · re-anchored in place, not retired (landing review) — the constant
        # changed (SEEDED_GRANTS → DEFAULT_CAPABILITIES); row 1 must still read the app's own, not a
        # copy typed into the stage. Re-verified RED alone.
        [
            (STAGE, '    const theOneDefaultSet = isDeepStrictEqual(held, DEFAULT_CAPABILITIES)', "    const theOneDefaultSet = isDeepStrictEqual(held, {\n      maxDepth: 6,\n      canMessage: 'any',\n      canAssignWork: 'any',\n      canCreateAgents: 'any',\n      takesWorkFrom: 'one-caller',\n      canWriteRules: 'none',\n    })"),
        ],
    ),
    (
        "M52 · 🔴 R17 · row 2 passes a project manager BroBot did not create — any creator will do · "
        "killed by `lifecycle-steps.test.mjs`",
        [
            (
                STAGE,
                "    const createdByBroBot = isDeepStrictEqual(pmCreatedBy, {\n"
                "      by: 'an-agent',\n"
                "      agent: DEFAULT_PROFILE_ID,\n"
                "    })",
                "    const createdByBroBot = pmCreatedBy !== null",
            ),
        ],
    ),
    (
        "M53 · 🔴 R17 · row 4 passes a worker the project manager did not create · killed by "
        "`lifecycle-steps.test.mjs`",
        # ⚑ Landing D-016b (5e931be8, the tree) · re-anchored in place, not retired — R17 survives:
        # row 4 (theWorkersPiece) requires the worker to have been created by the project manager,
        # and the killer's r17Findings regex still demands exactly that isDeepStrictEqual. Only the
        # indent changed, from 8 spaces to 6, so the old anchor now counts 0. Re-anchored on the
        # unindented expression, which is unique. Killed by `lifecycle-steps.test.mjs`.
        [
            (STAGE, "isDeepStrictEqual(workerCreatedBy, { by: 'an-agent', agent: PROJECT_MANAGER_PROFILE_ID })", 'workerCreatedBy !== null'),
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-014, 010f9426):** Row 1c's old question, whether the
        # three tiers hold three different grants (`delegates` via `producesAConversationOfItsOwn`),
        # is deleted along with the helper. Its anchor is left stale, so the census records it
        # retired.
        "M54 · ⛔ R17 · row 1c asks the pre-`584` question — a spawn list — which every tier now answers "
        "`false` · killed by `lifecycle-steps.test.mjs`",
        [
            (
                STAGE,
                "        delegates: row === null ? null : producesAConversationOfItsOwn(row.capabilities),",
                "        delegates: row === null ? null : row.capabilities.canSpawn.length > 0,",
            ),
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-014, 010f9426):** Roles are gone ("roles … are gone"; the
        # role column stays "unread and unwritten"). `pmRole` and row 2's role clause were deleted
        # from the stage, so no role check remains to weaken. Its anchor is left stale, so the
        # census records it retired.
        "M55 · ⛔ R17 · row 2 passes an identity BroBot created WITHOUT the project-manager role — one "
        "whose reach nothing seeded · killed by `lifecycle-steps.test.mjs`",
        [
            (
                STAGE,
                "        pmAppShaped && pmRole === 'project-manager'\n",
                "        pmAppShaped\n",
            ),
        ],
    ),
    (
        "M56 · ⛔ R17 · row 1c is not written when no project manager ran — NOT REACHED instead of "
        "NOT PERFORMED · killed by `lifecycle-steps.test.mjs`",
        [
            (
                STAGE,
                "      noteTheTiers()\n      return await parkForTheKill('no project manager to work through')",
                "      return await parkForTheKill('no project manager to work through')",
            ),
        ],
    ),
    (
        "M57 · 🔴 round 3 · a forever-loop is charged `cap + 1` whether or not it stops itself — a "
        "poll through a helper runs forever inside a finite charge · killed by "
        "`smoke-deadlines.test.mjs`",
        [
            (
                CENSUS,
                "        if (!isCappedLoop(ts, file, at, capName)) {\n",
                "        if (false) {\n",
            ),
            (
                CENSUS,
                "      if (ts.isAwaitExpression(inner)) waits = true\n",
                "      if (\n"
                "        ts.isCallExpression(inner) &&\n"
                "        ts.isIdentifier(inner.expression) &&\n"
                "        inner.expression.text === 'waitFor'\n"
                "      ) {\n"
                "        waits = true\n"
                "      }\n",
            ),
        ],
    ),
    (
        "M58 · 🔴 round 3 · a raced timer ANYWHERE is `opened`'s — a sleep raced in a step adds its "
        "bound to the worst case and no row · killed by `smoke-deadlines.test.mjs`",
        [
            (
                CENSUS,
                "      return raced && RACE_OWNERS.has(nameOfFunction(ts, at))",
                "      return raced",
            ),
        ],
    ),
    (
        "M59 · ⛔ round 3 · a timer reached through `globalThis.` is skipped, not refused · killed by "
        "`smoke-deadlines.test.mjs`",
        [
            (
                CENSUS,
                "      ((ts.isPropertyAccessExpression(node.expression) &&\n"
                "        ['setTimeout', 'setInterval'].includes(node.expression.name.text)) ||\n"
                "        (ts.isIdentifier(node.expression) && node.expression.text === 'setInterval'))\n",
                "      ts.isIdentifier(node.expression) &&\n"
                "      node.expression.text === 'setInterval'\n",
            ),
        ],
    ),
    (
        "M60 · 🔴 round 3 · a key SPELLED `signal` passes for the signal — `signal: undefined` is an "
        "abort nothing reaches · killed by `smoke-deadlines.test.mjs`",
        [
            (
                CENSUS,
                "            (ts.isPropertyAssignment(inner) &&\n"
                "              inner.name.getText(file) === 'signal' &&\n"
                "              ts.isIdentifier(inner.initializer) &&\n"
                "              inner.initializer.text === signal))",
                "            (ts.isPropertyAssignment(inner) && inner.name.getText(file) === 'signal'))",
            ),
        ],
    ),
    (
        "M61 · ⛔ round 3 · a previous section's verdict refusal stands in for this section's own · "
        "killed by `smoke-deadlines.test.mjs`",
        [
            (
                CENSUS,
                "    let since = sectionAround(ts, node).getStart(file)",
                "    let since = body.getStart(file)",
            ),
        ],
    ),
    (
        "M62 · ⛔ round 3 · a session handed to `driveTurn` is never USED, so nothing asks for a "
        "refusal after it opened · killed by `smoke-deadlines.test.mjs`",
        [
            (
                CENSUS,
                "        (ts.isIdentifier(callee) && (callee.text === 'waitFor' || parameters.has(callee.text))) ||\n"
                "        handedToAPrompter",
                "        (ts.isIdentifier(callee) && (callee.text === 'waitFor' || parameters.has(callee.text)))",
            ),
        ],
    ),
    (
        "M63 · 🔴 round 3 · a mistyped `SWEEP_MAX_TOTAL_BYTES` (`5GB`) reads as a dry run — the real "
        "pass skipped and the run green · killed by `smoke-deadlines.test.mjs`",
        [
            (
                SWEEP,
                "  !Number.isFinite(MAX_TOTAL_BYTES) ||\n  MAX_TOTAL_BYTES < 0 ||\n",
                "",
            ),
        ],
    ),
    (
        "M64 · ⛔ round 3 · row 1b reads the project manager's row in the verdict — after the "
        "prologue's turn, where a model could have minted it · killed by `lifecycle-steps.test.mjs`",
        # ⚑ Landing D-014 · re-anchored in place, not retired — The rule survives: row 1b's verdict
        # must use `projectManagerShipped`, which is read before the prologue's turn, not a fresh
        # read of the project manager's row. D-014 only joined the verdict onto one line.
        # Re-verified RED alone.
        [
            (STAGE, '      isDeepStrictEqual(shippedIdentities, [DEFAULT_PROFILE_ID]) && !projectManagerShipped\n', '      isDeepStrictEqual(shippedIdentities, [DEFAULT_PROFILE_ID]) && store.capabilitiesOf(PROJECT_MANAGER_PROFILE_ID) === null\n'),
        ],
    ),
    (
        "M65 · ⛔ round 3 · row 4's 1c moved below the worker's park — two calls still, and a path "
        "without one · killed by `lifecycle-steps.test.mjs`",
        [
            (
                STAGE,
                "    noteTheTiers()\n    if (explorer === null) return await parkForTheKill('no worker to be mid-turn')",
                "    if (explorer === null) return await parkForTheKill('no worker to be mid-turn')\n    noteTheTiers()",
            ),
        ],
    ),
]
