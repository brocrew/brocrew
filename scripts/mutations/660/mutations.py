"""660 · 495's paid half, the matrix step re-taken — what landing `495` on today's `main` newly carries.

⛔ **Ordered by the PM after `649` landed the free half.** `660` applied `495`'s matrix step as a
patch, resolved its 79-line conflict with `main`'s inline PersonsQueue press by keeping `495`'s
three-surface helper and folding `main`'s two checks into it (the row is an `a-decision`; the preload
is frozen), moved the helper to today's screens (`rail-waiting`, `data-place=in-flow`), closed a
vacuous absence read in the settlement wait, and replaced two TYPED bounds — the smoke's 47 minutes
and the census's pin of 50 — with a DERIVATION from the cases step 82 runs. ⚑ Its read-only review
then found two drifts that would have failed the paid run before its first row, both since `495`'s
base: `592` made `'default'` an ordinary identity nothing lets spawn `project-manager` (the step now
grants that one capability through `setCapabilities` and reads it back), and `545` added
`relayedFromProfile` to every relayed turn (the exact relay check now expects it). It also made the
settlement wait read the card's word, derived from the card.

## ⚠️ What a row here measures

 * ⚑ **Every row is killed by a source census** — `scripts/test/step-census.test.mjs` for the
   budget and the step's run-time count checks, `scripts/test/permission-matrix-security.test.mjs`
   for the screens. ⛔ A census proves the cheap gate NOTICES the edit, never that the edited step
   would still measure: that is the live run, and `660` ran it once.
 * 🔴 **Three budget rows are killed by COUNTING — M3, M4, M5.** The census counts the providers
   from `contracts.ts`, the outcomes from `permission-offer.ts`, the C17 retakes and the C20
   surfaces from step 82's own body, and stated 47 and 50 as literals on their own lines
   (`a-bound-written-as-the-constant-cannot-pin-it`) — since `674`, `step-budgets.test.mjs` states
   the figures `042`'s rule derives instead. ⛔ **The rest are killed by the TEXT of the
   line they edit** — M1, M2, M6, M7, M18 and M19 among the budget rows — which proves the gate
   notices the edit and nothing more. ⚠️ M7 in particular guards a check that is true whenever it
   is reached today (the C17 retake is awaited once, unconditionally); it earns its place the day
   the budget and the step disagree about how many C17 retakes there are.
 * ⚠️ **M13 mutates the product, not the smoke** — it is the row that proves the screens census
   reads the renderer's own hook rather than the smoke's copy of it.

## ⚑ Corrected in place by `669`

 * ⛔ **M4's recorded RED was measured against the OLD text** — the typed `3.5 * 60_000`. `669` F-e
   derived the allowance from `665`'s measured clocks, so the row now moves the longest measured
   unit, and `669` re-verified it red against `step-census.test.mjs` before recording it.

## ⚑ Corrected in place by `674`

 * ⛔ **M1, M2 and M19's recorded REDs were measured against the OLD text** — `660`'s allocation
   (the controller plus one allowance per unit). `674` R20 made the step budget `042`'s rule over
   each unit's worst case, so each row now edits that derivation: M1 types it back as 47 minutes,
   M2 drops the shared launch budget, M19 appends a typed term inside its `Math.ceil`. `674`
   re-verified each red with `scripts/mutations/verify_row.py`. ⚠️ M19's label still says *"the
   census's own 47"*; the figure the census states is 45,294,000 ms now.
 * ⚠️ **M3 and M5's labels describe a budget term `674` removed.** Criterion 20's retakes are priced
   inside a Codex row's worst case now, not as units of their own; both rows still go red, on the
   census's independent count of the surfaces step 82 runs — not on any budget figure.
 * ⚠️ **M4 now moves the TYPICAL cost only.** Since `674` the longest measured unit is printed beside
   the budget and is no input to it; the row still goes red on the pin that holds it to `665`'s
   clocks, and its label's minutes describe the allocation `674` retired.

## ⛔ What this table cannot reach

 * 🔴 **Whether the budget is long enough for a provider.** Only a run can say. ⚑ Since `674` it
   is `042`'s rule over every wait a unit can make, not a per-unit allowance; `665`'s measured
   clocks are kept beside it as the typical cost.
 * ⚠️ **Whether Waiting on you draws both queues at the moment the step reads them** — the census
   holds the hooks; the run held the screen.
"""

SMOKE = "scripts/ui-live-smoke.mjs"
PERSONS_QUEUE = "apps/desktop/src/renderer/src/components/PersonsQueue.vue"

MUTATIONS: list[tuple[str, list[tuple[str, str, str]]]] = [
    (
        "M1 · 🔴 THE DEFECT, verbatim · the step budget typed back as `495` typed it — 47 minutes "
        "that no unit moves · killed by `step-census.test.mjs` ⚑ ANCHOR CORRECTED IN PLACE BY 674",
        [
            (
                SMOKE,
                # ⚑ Re-anchored by `674` (142's rule): R20 replaced the allocation with `042`'s rule
                # over each unit's worst case. The defect put back is the same typed 47 minutes.
                (
                    "const PERMISSION_MATRIX_STEP_BUDGET_MS = Math.ceil(\n"
                    "  STEP_BUDGET_MARGIN *\n"
                    "    (PERMISSION_MATRIX_WORST_MS.setup +\n"
                    "      PERMISSION_MATRIX_UNITS.rows *\n"
                    "        (PERMISSION_MATRIX_WORST_MS.row + PERMISSION_MATRIX_WORST_MS.recovery) +\n"
                    "      PERMISSION_MATRIX_UNITS.criterion17 *\n"
                    "        (PERMISSION_MATRIX_WORST_MS.criterion17 + PERMISSION_MATRIX_WORST_MS.recovery)),\n"
                    ")\n"
                ),
                "const PERMISSION_MATRIX_STEP_BUDGET_MS = 47 * 60_000\n",
            ),
        ],
    ),
    (
        "M2 · ⛔ the run forgets the launch — the owned timer's bound becomes the step's own, and the "
        "isolated launch before step 82 runs on no clock · killed by `step-census.test.mjs` "
        "⚑ ANCHOR CORRECTED IN PLACE BY 674",
        [
            (
                SMOKE,
                # ⚑ Re-anchored by `674`: the launch is now the one `LAUNCH_BUDGET_MS` both steps share.
                "const PERMISSION_MATRIX_RUN_BUDGET_MS = PERMISSION_MATRIX_STEP_BUDGET_MS + LAUNCH_BUDGET_MS",
                "const PERMISSION_MATRIX_RUN_BUDGET_MS = PERMISSION_MATRIX_STEP_BUDGET_MS",
            ),
        ],
    ),
    (
        "M3 · 🔴 the budget stops counting a unit the step still runs — criterion 20's three Cancel "
        "retakes priced as two · killed by `step-census.test.mjs` (the census counts three surfaces "
        "in step 82's own map)",
        [
            (
                SMOKE,
                # ⚑ 739 · ANCHOR CORRECTED IN PLACE — the rows are `2 * 5` since `739` put *Always
                # allow* in the row (`736` F-1); the subject, a C20 retake the budget stops counting,
                # is unchanged.
                "const PERMISSION_MATRIX_UNITS = { rows: 2 * 5, criterion17: 1, criterion20: 3 }",
                "const PERMISSION_MATRIX_UNITS = { rows: 2 * 5, criterion17: 1, criterion20: 2 }",
            ),
        ],
    ),
    (
        "M4 · ⚠️ the allowance moves and nothing else does — every unit a minute shorter, the step "
        "41 minutes · killed by `step-census.test.mjs` (the figures, stated as literals) "
        "⚑ ANCHOR CORRECTED IN PLACE BY 669",
        [
            (
                SMOKE,
                # ⚑ **Re-anchored by `669`, not retired** (142's rule). `669` F-e derived the unit from
                # `665`'s longest measured clock × `042`'s margin, so the allowance moves where that
                # clock is stated. ⚠️ 10,154 ms is the figure that makes EVERY unit exactly a minute
                # shorter (75,231 → 15,231); the step is then 8.05 minutes, not the 41 the label says.
                "const PERMISSION_MATRIX_LONGEST_UNIT_MS = 50_154",
                "const PERMISSION_MATRIX_LONGEST_UNIT_MS = 10_154",
            ),
        ],
    ),
    (
        "M5 · 🔴 the step runs a C20 surface fewer than its budget prices — `deny` loses its "
        "PersonsQueue door · killed by `step-census.test.mjs` (units ≠ the map it counts)",
        [
            (
                SMOKE,
                (
                    "                    allow_for_session: 'permission-card',\n"
                    "                    deny: 'persons-queue',\n"
                ),
                "                    allow_for_session: 'permission-card',\n",
            ),
        ],
    ),
    (
        "M6 · ⛔ step 82 stops refusing a row count its budget did not price · killed by "
        "`step-census.test.mjs`",
        [
            (
                SMOKE,
                "          if (providers.length * outcomes.length !== PERMISSION_MATRIX_UNITS.rows) {",
                "          if (providers.length * outcomes.length !== providers.length * outcomes.length) {",
            ),
        ],
    ),
    (
        "M7 · ⚠️ the run-time C17 count stops comparing against the budget — a budget that priced "
        "a different number of C17 retakes than the step runs would still read complete · killed by "
        "`step-census.test.mjs` (by text: today the count is 1 whenever it is reached)",
        [
            (
                SMOKE,
                "              .length === PERMISSION_MATRIX_UNITS.criterion17 &&",
                "              .length >= 0 &&",
            ),
        ],
    ),
    (
        "M8 · 🔴 THE DEFECT the conflict hid · the helper reads Home, where both queues were before "
        "`EXT-008` §3 — the click succeeds and the queue is never there · killed by "
        "`permission-matrix-security.test.mjs`",
        [
            (
                SMOKE,
                (
                    "            await clickWhenReady(cdp, 'rail-waiting')\n"
                    "            const home = await waitFor(\n"
                    "              `${outcome} owned request on PersonsQueue and AttentionQueue`,"
                ),
                (
                    "            await clickWhenReady(cdp, 'rail-home')\n"
                    "            const home = await waitFor(\n"
                    "              `${outcome} owned request on PersonsQueue and AttentionQueue`,"
                ),
            ),
        ],
    ),
    (
        "M9 · 🔴 the helper names the queue's place by what it was before `606` — `home`, a value "
        "no queue carries now · killed by `permission-matrix-security.test.mjs`",
        [
            (
                SMOKE,
                (
                    "              const queue = document.querySelector('[data-cy=persons-queue][data-place=in-flow]')\n"
                    "              const personsMatches"
                ),
                (
                    "              const queue = document.querySelector('[data-cy=persons-queue][data-place=home]')\n"
                    "              const personsMatches"
                ),
            ),
        ],
    ),
    (
        "M10 · ⛔ `main`'s first check dropped in the merge — the row is no longer required to be an "
        "`a-decision` when it is read · killed by `permission-matrix-security.test.mjs`",
        [
            (
                SMOKE,
                "              home.persons.kind !== 'a-decision' ||\n",
                "",
            ),
        ],
    ),
    (
        "M11 · ⛔ `main`'s second check dropped in the merge — the preload is no longer required to "
        "be frozen when the answer is read · killed by `permission-matrix-security.test.mjs`",
        [
            (
                SMOKE,
                "              !home.persons.runtimeFrozen ||\n",
                "",
            ),
        ],
    ),
    (
        "M12 · 🔴 the settlement wait reads an absence without the surface that could contradict it "
        "— on any screen but Waiting on you, both rows are *gone* at once · killed by "
        "`permission-matrix-security.test.mjs`",
        [
            (
                SMOKE,
                "              if (!document.querySelector('[data-cy=waiting-on-you]')) return null\n",
                "",
            ),
        ],
    ),
    (
        "M13 · ⚠️ the PRODUCT renames the place the helper selects on — the screens census reads the "
        "renderer's hook, not the smoke's copy of it · killed by "
        "`permission-matrix-security.test.mjs`",
        [
            (
                PERSONS_QUEUE,
                ":data-place=\"props.floating ? 'overlay' : 'in-flow'\"",
                ":data-place=\"props.floating ? 'overlay' : 'inline'\"",
            ),
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-014, 010f9426):** D-014 removed both the grant and the
        # rail it fed. Its anchor is left stale, so the census records it retired.
        "M14 · 🔴 THE DEFECT the review found, verbatim · the controller is not granted its spawn — "
        "since `592` rail 7 refuses the first spawn (`not-in-can-spawn`) and the paid run ends at "
        "C17 · ⚑ re-anchored by `665`, which moved the grant into the shared `grantExactly` · "
        "killed by `permission-matrix-security.test.mjs`",
        [
            (
                SMOKE,
                "          await grantExactly(cdp, matrixController, { canSpawn: ['project-manager'] })\n",
                "",
            ),
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-014, 010f9426):** The `grantExactly(cdp,
        # matrixController, { canSpawn: [...] })` call this row widens was deleted by D-014,
        # together with canSpawn/canStaff (unread columns, no staffing carve-out). The test pins
        # that no grant is made, so there is nothing to widen. Its anchor is left stale, so the
        # census records it retired.
        "M15 · ⛔ the grant WIDENS — the controller may also start any identity, so a spawn the step "
        "did not ask for would be admitted · ⚑ re-anchored by `665` onto the `grantExactly` call · "
        "killed by `permission-matrix-security.test.mjs`",
        [
            (
                SMOKE,
                "          await grantExactly(cdp, matrixController, { canSpawn: ['project-manager'] })\n",
                "          await grantExactly(cdp, matrixController, {\n"
                "            canSpawn: ['project-manager'],\n"
                "            canStaff: 'any',\n"
                "          })\n",
            ),
        ],
    ),
    (
        "M16 · 🔴 THE DEFECT the review found, verbatim · the exact relay check forgets `545`'s "
        "`relayedFromProfile`, so no relayed turn can ever equal it · killed by "
        "`permission-matrix-security.test.mjs`",
        [
            (
                SMOKE,
                "              relayedFromProfile: matrixController,\n",
                "",
            ),
        ],
    ),
    (
        "M17 · ⚠️ the settlement wait takes any settled word — a teardown's `Not answered` reads as "
        "a Cancel receipt · killed by `permission-matrix-security.test.mjs`",
        [
            (
                SMOKE,
                "            if (card.verdict !== cardVerdicts[outcome] || card.note) {",
                "            if (card.note) {",
            ),
        ],
    ),
    (
        "M18 · ⛔ the step's deadline is armed with step 81's figure — the derivation stays intact "
        "and nothing reads it · killed by `step-census.test.mjs`",
        [
            (
                SMOKE,
                "    const localStepDeadline = Date.now() + PERMISSION_MATRIX_STEP_BUDGET_MS",
                "    const localStepDeadline = Date.now() + PERSONS_GESTURE_STEP_BUDGET_MS",
            ),
        ],
    ),
    (
        "M19 · ⚠️ a typed term appended to the derivation — every counted unit still in it, and the "
        "census's own 47 still 47 · killed by `step-census.test.mjs` (the end anchor) "
        "⚑ ANCHOR CORRECTED IN PLACE BY 674",
        [
            (
                SMOKE,
                # ⚑ Re-anchored by `674`: the term is appended inside R20's `Math.ceil`, after every
                # unit's worst case — the same typed term at the same end of the derivation.
                "        (PERMISSION_MATRIX_WORST_MS.criterion17 + PERMISSION_MATRIX_WORST_MS.recovery)),\n)\n",
                "        (PERMISSION_MATRIX_WORST_MS.criterion17 + PERMISSION_MATRIX_WORST_MS.recovery)) +\n"
                "    2 * 60_000,\n)\n",
            ),
        ],
    ),
]
