#!/usr/bin/env python3
"""224's mutation table — each row is THE DEFECT, put back verbatim (131).

⛔ **Four of the last five live-smoke failures were the model declining to do something it was never
obliged to do**: `219`'s step `68`, `221`'s `68` again, `221`'s `19`, `221`'s `12`. Zero app defects
between them. `173`, `177 §3.13` and `174 §4a` all named the reason, and one of them wrote it INSIDE
step 68's own comment — *"a step that is red for the model's mood teaches people to ignore reds"* —
where it sat, quoted and unspent, while the step went on reporting `FAIL`.

The rows fall into four groups:

  * `M1`-`M6`   **the three numbers.** `riskOf` refusing a step nobody classified rather than
    defaulting it to app-only; `censusNumbers` counting an exposed step AGAINST the instrument;
    `censusLine` naming the exposed steps individually instead of counting them; and `224 §4`'s two
    halves — the exposed steps a control could reclassify, and the ones with nothing to reclassify
    them with — kept apart.
  * `M7`-`M10`  **the parser the whole guard rests on.** It REFUSES what it cannot read: a version
    that returned what it managed would report a census with twelve holes in it as complete, which
    is `196`'s own failure mode one level down.

    ⚠️ **`M8` SURVIVED its first run, and the reason is worth writing down.** The parser has two
    defences against prose — a narrow call pattern and a comment blanker — and the narrow pattern
    alone handles everything `ui-live-smoke.mjs` actually contains. So disarming the blanker changed
    nothing measurable: the guard was real, and no test could tell. ⛑ **The repair is not in this
    table**, it is in `step-census.test.mjs`: the fixture now includes the shape the blanker is
    genuinely for — a COMMENT that shows the call, `// await step('99 …', …)`, which documentation
    naturally writes and which the narrow pattern matches happily. Hand-checked both ways before the
    table was re-run whole.
  * `M11`-`M18` **the census as data.** A step that leaves the list, a step that never existed
    joining it, a guarded entry that describes an intention the code does not have, a `why` that is
    a shrug, a `cause` nobody defined, an exposed step that will not say whether it could be
    reclassified.
  * `M19`-`M33` **the reclassifications themselves, and the CONTROLS that earn them.** `M19`-`M21`
    put the three reds back; `M22` stops the run printing the number. ⛔ **`M23`-`M32` are the
    important ones** (with `M33`): each deletes one discriminator a reclassified step uses to tell *"the provider
    declined"* from *"the app is broken"*, which is `224 §4`'s whole subject — *"a change that lets
    a real defect hide is worse than the reds it removes."*

    ⚠️ **Eight of those twelve rows exist because an adversarial pass over this dispatch's own diff
    found the gaps they close** — a Grep row ending in `error` (164's own regression) blanking, a
    `Bash` row left running for the whole budget blanking with a claim its own evidence contradicted,
    a plan turn PARKED on a card nobody could answer (055, exactly) reported as a quiet model, and
    two `.catch`es swallowing more than the wait's own timeout. Every one of them was a real defect
    written by the change that exists to prevent that shape.

    ⚠️ **`M33` SURVIVED its first run, and it is `M8`'s lesson again one layer along.** The row drops
    the `.filter` that keeps the three human-facing tools out of `CONTROL 2` — and every assertion
    held: the set was still DECLARED, the control still read `settleable`, and the step would have
    reddened on a healthy app whose model went straight to planning. ⛑ **The repair is in the test**:
    it now asserts the filter is APPLIED, not merely that the set exists. A guard named and not used
    is a guard nobody can see is gone.

## ⛔ What this table cannot reach, stated because a table silent about its edges is claiming them

  * ⛔ **A real run.** Every row is killed by a test that reads `ui-live-smoke.mjs` as SOURCE, because
    `pnpm run ci` cannot drive a live app. That step `68` really reports two claims instead of
    throwing is 224's full smoke and only that.
  * ⛔ **`ledgerRows` refusing an unmounted event log.** The `rows === null` guard (093's lesson at
    the one read where it is worst — an absent list and an empty one are the same answer) has no
    test that can see it: nothing in the `scripts` project can mount a drawer. Named here rather
    than left to look covered.
  * ⚠️ **The judgement itself.** Whether step `34`'s subject really needs a provider to volunteer is
    not a syntactic property and no row here checks it. What the table protects is that the
    classification stays COMPLETE, current, and never silently contradicted by the code.
  * ⚠️ **One project.** 224's diff is entirely inside `scripts/`, so `desktop`, `dom`, `shared` and
    `runtime` do not run: no file this table touches is imported by any of their tests.

## ⚑ ANCHOR CORRECTED IN PLACE BY 420 — `M2`, and why this table is now partial

⛔ **`420` added a FOURTH cell to `censusNumbers`**: `withdrawn`, a step whose SUBJECT the product
removed, which can go red for nobody (`420` §4, from `417` deleting the launcher's settings block).
So `appDefectOnly` subtracts two lists instead of one, and `M2`'s anchor stopped matching any line
in the file. ⚠️ **The row's subject is unchanged** — the mutant is still `risks.length`, it still
claims every step can go red only for an app defect, and it is still killed by
`scripts/test/step-census.test.mjs`.

⚑ **The corrected row was applied ALONE and watched go red** against that file before this note was
written; re-running the table is the only thing that makes the artefact's verdict current.
⛔ **The suffix on the label is what moves this table to `partial-or-invalid`**, and that is the
honest state: the artefact was produced against a definition this file no longer has. ⚠️ The cost
is per TABLE and not per row — every other row here is downgraded with it, which is a fact about
the instrument rather than about those rows (`211`'s measurement, and its wording).
"""

from pathlib import Path

LIB = "scripts/lib/step-census.mjs"
SMOKE = "scripts/ui-live-smoke.mjs"

# Step 68's two unreached halves, as 224 leaves them. A row that removes ONE is not a kill: the guard
# asks whether the step reports an unreached claim AT ALL, so both go in one row — which is also what
# "the defect put back" means here, since before 224 it reported neither.
STEP_68_NO_SEARCH = """        : unasserted(
            `the model never reached for a search tool: no Grep or Glob row on screen and none in ` +
              `the event log (it called ${JSON.stringify(called)})`,
          ),"""

# ⚑ **728 · re-anchored in place, not retired** — 728 (R93) removed the plan floor step 68's Bash half asserted, and its blank now names the CLI's own ask; the row still turns that blank into a pass
STEP_68_NO_BASH = "        : unasserted(\n            `the model never attempted Bash, or the CLI's own plan mode asked about it and nobody ` +\n              `answered (it called ${JSON.stringify(called)})`,\n          ),"

# ⚑ **727 · corrected in place** (rule 27): step 12's reasoning half gained a middle arm — the
# PROVIDER sent no summary words, and round 2 a fourth, unproven — so "the reasoning half stops
# being a claim" is now EVERY unasserted arm turning into one assertion; replacing only the last left the step guarded and
# the row survived (measured). Re-verified RED alone.
STEP_12_NO_REASONING = """        : codexWordless === 'the-provider'
          ? unasserted(
              `the PROVIDER's: Codex reasoned (${codexThinkingPill.length} pill(s) drawn) and sent no ` +
                `summary words — every reasoning item in its own rollout for these turns has an empty ` +
                `summary, the app's ledger holds no worded thinking for them, and an earlier Codex turn ` +
                'in this run DID get words, so the flip works on this build. A pill with nothing to open ' +
                "is the honest drawing of that; 027's flip cannot be read off a turn Codex summarised with nothing",
            )
          : codexWordless === 'unproven'
            ? unasserted(
                `Codex reasoned (${codexThinkingPill.length} pill(s) drawn) and every reasoning item in ` +
                  `its own rollout for these turns has an empty summary, with none in the app's ledger ` +
                  `either — Codex's choice (722's second batch), or 027's flip lost on the wire; no ` +
                  'earlier Codex turn in this run has shown words, so this step cannot tell the two apart',
              )
            : unasserted(
                `Codex reasoned nowhere this run: no thinking entry on screen and ${codexThinkingEvents} ` +
                  `thinking event(s) in the app's own event log, over turns whose activity phases ` +
                  `[${[...codexActivity].join(', ')}] the app did show. 027's summary flip cannot be ` +
                  'read off a turn that produced no reasoning to summarise',
              ),"""

# (name, [(file, old, new), ...])
MUTATIONS = [
    # ---- §5 · the three numbers -------------------------------------------------------------------
    (
        "M1 · ⛔ `riskOf` answers 'app' for a step nobody has classified instead of refusing — the "
        "number this file exists to state drifts upwards every time somebody writes a new step",
        [(LIB, "  if (!census.includes(token)) {", "  if (false) {")],
    ),
    (
        "M2 · an EXPOSED step is counted towards the instrument's strength — the headline claims a "
        "step that can still go red for a mood as one that can only go red for the app "
        "⚑ ANCHOR CORRECTED IN PLACE BY 420",
        [
            (
                LIB,
                "    appDefectOnly: risks.length - exposed.length - withdrawn.length,",
                "    appDefectOnly: risks.length,",
            )
        ],
    ),
    (
        "M3 · the line stops NAMING the exposed steps — 224 §5 asks for them individually because a "
        "count of dangerous steps is not something anybody can act on",
        [
            (
                LIB,
                "      ? `⛔ ${n.exposed.length} still go red for a provider's choice${named(n.exposed)}, ` +",
                "      ? `⛔ ${n.exposed.length} still go red for a provider's choice, ` +",
            )
        ],
    ),
    (
        "M4 · the line's exposed branch is never taken, so a run with thirty steps that can go red "
        "for a provider's choice reports that none of them can",
        [(LIB, "    (n.exposed.length > 0", "    (false")],
    ),
    (
        "M5 · a claim outside a live step's REACH is counted as model-dependent — two different "
        "facts summed into one excuse (an OS-owned dialog is not a mood)",
        [
            (
                LIB,
                "      (token) => (exposedBy[token] ?? guardedBy[token]).cause === 'provider',",
                "      () => true,",
            )
        ],
    ),
    (
        "M6 · ⛔ 224 §4's two halves collapse: every exposed step is reported as reclassifiable, so "
        "the list of steps that CANNOT be told from a defect — the finding — disappears",
        [
            (
                LIB,
                "    reclassifiable: exposed.filter((token) => exposedBy[token].control === 'available'),",
                "    reclassifiable: exposed,",
            )
        ],
    ),
    # ---- the parser the guard rests on ------------------------------------------------------------
    (
        "M7 · ⛔ the parser returns what it managed instead of refusing what it cannot read — a "
        "census with holes in it reports as complete, which is 196's failure one level down",
        [
            (
                LIB,
                "    if (title === null) {\n      throw new Error(",
                "    if (title === null) {\n      continue\n    }\n    if (false) {\n      throw new Error(",
            )
        ],
    ),
    (
        "M8 · comments are no longer blanked, so the word `step()` in a sentence is read as a step "
        "registration and the parser refuses the whole file over prose",
        [
            (
                LIB,
                "    return trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*')",
                "    return false && trimmed.startsWith('//')",
            )
        ],
    ),
    (
        "M9 · the call pattern widens back to a bare `step(`, which also matches the English inside "
        "a template literal — `${steps.length} step(s)` becomes a step",
        [
            (
                LIB,
                r"    const call = line.match(/(?:\bawait |^\s*)step\(\s*(.*)$/)",
                r"    const call = line.match(/\bstep\(\s*(.*)$/)",
            )
        ],
    ),
    (
        "M10 · a step named by a CONSTANT stops resolving — the twelve steps registered that way "
        "become unreadable, and a census that skipped them silently would be twelve short",
        [(LIB, "  return constants.get(ident[1]) ?? null", "  return null")],
    ),
    # ---- the census as data -----------------------------------------------------------------------
    (
        "M11 · a step leaves the census, so a step the run offers has no stated meaning for its reds",
        [(LIB, "  '72',\n]", "]")],
    ),
    (
        "M12 · …and the other direction: the census names a step nothing registers, so the "
        "instrument's strength is claimed over a check that does not exist",
        [(LIB, "  '72',\n]", "  '72',\n  '73',\n]")],
    ),
    (
        "M13 · ⛔ step 68 leaves GUARDED while still answering `unasserted(...)` — the census counts "
        "it as a step that can only go red for the app, which overstates the instrument",
        [
            (
                LIB,
                "  68: {\n    cause: 'provider',\n    why: 'either half is the model\u2019s to give \u2014 it may search and never attempt Bash (219, 221), or neither. A row that did not finish, or a call in the ledger with no row on screen, is still RED (224)',\n  },\n",
                "",
            )
        ],
    ),
    (
        "M14 · ⛔ a step that still THROWS is claimed as guarded — the census describing an intention "
        "the code does not have, which is the headline saying a red cannot happen when it can",
        [
            (
                LIB,
                "export const GUARDED = {\n",
                "export const GUARDED = {\n  1: { cause: 'provider', why: 'step 1 is claimed to report a claim it could not reach' },\n",
            )
        ],
    ),
    (
        "M15 · a step is in BOTH lists, so what a red from it means depends on which list you read",
        [
            (
                LIB,
                "export const EXPOSED = {\n",
                "export const EXPOSED = {\n  68: { cause: 'provider', control: 'none', why: 'step 68 listed twice, in two states at once' },\n",
            )
        ],
    ),
    (
        "M16 · a reason becomes a shrug — `flaky` is the word this whole dispatch exists to replace",
        [
            (
                LIB,
                "    why: 'Codex may run the whole task without ever sending a plan (193)',",
                "    why: 'flaky',",
            )
        ],
    ),
    (
        "M17 · a `cause` nobody defined, so a step is neither a provider's choice nor a limit of the "
        "instrument and is silently absent from both numbers",
        [
            (
                LIB,
                "  17: { cause: 'provider', why: 'a run may produce no collab row to read' },",
                "  17: { cause: 'mood', why: 'a run may produce no collab row to read' },",
            )
        ],
    ),
    (
        "M18 · an exposed step stops saying whether a control exists — 224 §4 asks for exactly that "
        "list, and an entry with no answer joins the half that could be reclassified",
        [
            (
                LIB,
                "    control: 'none',\n    why: 'the composer freeze is only observed",
                "    why: 'the composer freeze is only observed",
            )
        ],
    ),
    # ---- §3 · the three reds, put back -------------------------------------------------------------
    (
        "M19 · ⛔ THE DEFECT · step 68 stops reporting either half as an unreached claim, so a model "
        "that proposes a plan without attempting Bash is a FAIL again — 219 and 221, twice over",
        [
            (SMOKE, STEP_68_NO_SEARCH, "        : asserted('no search tool ran'),"),
            (SMOKE, STEP_68_NO_BASH, "        : asserted('no Bash attempt'),"),
        ],
    ),
    (
        "M20 · ⛔ THE DEFECT · step 19 throws for a model that answered in prose — 221's red, on a "
        "step whose own comments say four times over that this is a fact about the model",
        [
            (
                SMOKE,
                "        return notAsserted(\n          `the model never proposed a plan:",
                "        throw new Error(\n          `the model never proposed a plan:",
            )
        ],
    ),
    (
        "M21 · ⛔ THE DEFECT · step 12's reasoning half stops being a claim, so a Codex turn that "
        "reasoned nowhere reds a step that asserted a dozen other things correctly (221)",
        [(SMOKE, STEP_12_NO_REASONING, "        : asserted('no reasoning this run'),")],
    ),
    # ---- §4 · the controls, which are what earn the blanks -----------------------------------------
    (
        "M22 · the run stops PRINTING the census line — §5's number lives only in a response doc, "
        "which is where the last three numbers this project quoted went stale",
        [(SMOKE, "  console.log(`  ${censusLine()}`)\n", "")],
    ),
    (
        "M23 · 🔴 224 §4's TRAP, opened · step 68 stops reading the ledger at all, so \"the model "
        "never called it\" is decided by the one surface that could have stopped drawing",
        [
            (
                SMOKE,
                "    assertCountersVisible(after68, 'what the planning turn actually produced')\n"
                "    const called = await toolCallsRecorded(cdp)",
                "    assertCountersVisible(after68, 'what the planning turn actually produced')\n"
                "    const called = []",
            )
        ],
    ),
    (
        "M24 · 🔴 the same for step 19 · an ExitPlanMode the app RECORDED and never rendered is 030 "
        "failing, and it becomes a blank — the card asking you to approve what you were never shown",
        [(SMOKE, "        if (called.includes('ExitPlanMode')) {", "        if (false) {")],
    ),
    (
        "M25 · 🔴 and step 12 · reasoning that arrived and cannot be OPENED is the summary flip being "
        "off, and it becomes a blank — 027's whole subject, hidden behind the new label",
        [
            (
                SMOKE,
                "    if (codexThinkingText.length === 0 && codexThinkingPill.length > 0) {",
                "    if (false) {",
            )
        ],
    ),
    (
        "M26 · 🔴 step 19's blank swallows every throw and not just the wait's timeout, so a turn "
        "still raising cards at the approval cap — 031's re-prompting pathology, the one thing that "
        "counter exists to catch — is reported as a model that never proposed a plan",
        [
            (
                SMOKE,
                "        if (!/^timed out waiting for /.test(error.message)) throw error",
                "        if (false) throw error",
            )
        ],
    ),
    (
        "M27 · 🔴 step 68's CONTROL 1 goes, so a planning turn that produced nothing at all — and a "
        "dead app is one way to produce nothing — reports a blank instead of a red",
        [
            (
                SMOKE,
                "    if (after68.events === 0 || (after68.messages === 0 && after68.tools === 0)) {",
                "    if (false) {",
            )
        ],
    ),
    (
        "M28 · 🔴 step 68's CONTROL 2 goes, so a ledger full of tool calls beside a transcript that "
        "carried none to an outcome — the renderer dropping rows — becomes a blank about the model",
        [
            (
                SMOKE,
                "    if (settleable.length > 0 && seen.finished.length === 0) {",
                "    if (false) {",
            )
        ],
    ),
    (
        "M29 · 🔴 164's OWN REGRESSION becomes a blank · a Grep row that ends in error — the "
        "plan-mode floor refusing the search tool, which is the whole of 164 — stops being red",
        [(SMOKE, "    if (!ran && searchRows.length > 0) {", "    if (false) {")],
    ),
    (
        "M30 · 🔴 a Bash row left running for the whole budget becomes a blank — the app took the "
        "command and never showed an outcome, and the step would report that the model never tried",
        [(SMOKE, "    } else if (bashRows.length > 0) {", "    } else if (false) {")],
    ),
    (
        "M31 · 🔴 step 19's CONTROL 1 goes, so a session that produced nothing at all reports \"the "
        "model never proposed a plan\" — a blank claimed over a dead app",
        [
            (
                SMOKE,
                "        if (now.events === 0 || (now.messages === 0 && now.tools === 0)) {",
                "        if (false) {",
            )
        ],
    ),
    (
        "M33 · 🔴 the three tools that ask a HUMAN stop being excluded from CONTROL 2, so a model "
        "that goes straight to planning — EnterPlanMode then ExitPlanMode, both parked on a card "
        "nothing here may answer — reds this step on a perfectly healthy app",
        [
            (
                SMOKE,
                "    const settleable = called.filter((name) => !USER_INPUT_TOOLS.has(name))",
                "    const settleable = called",
            )
        ],
    ),
    (
        "M34 · 🔴 step 12 stops asking the LEDGER, so reasoning the app recorded and never drew — the "
        "renderer dropping thinking entries — is reported as a Codex turn that reasoned nowhere",
        [
            (
                SMOKE,
                # ⚑ **727 · corrected in place** (rule 27): the check now says exactly what its
                # message says — no thinking entry AT ALL, so a drawn pill is excluded — and prettier
                # wraps it. Same defect, re-verified RED alone.
                "    if (\n      codexThinkingText.length === 0 &&\n      codexThinkingPill.length === 0 &&\n      codexThinkingEvents > 0\n    ) {",
                "    if (false) {",
            )
        ],
    ),
    (
        "M32 · 🔴 step 19's CONTROL 3 goes, so a plan turn PARKED on a card nobody could answer — "
        "055's measured failure, exactly — is reported as a model that chose not to plan",
        [
            (
                SMOKE,
                "        if (now.status === 'waiting_permission' || stuck > 0 || now.openCards.length > 0) {",
                "        if (false) {",
            )
        ],
    ),
]


def apply(root, index: int, dry: bool) -> int:
    name, edits = MUTATIONS[index]
    bad = 0
    for rel, find, replace in edits:
        path = Path(root) / rel
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
