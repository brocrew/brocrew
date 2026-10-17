"""310 · One null that means three things — what the suite would notice if each finding came back.

# The finding this table exists to protect

⛔ **One `null`, at least four facts, one screen.** `ProviderModelMap` was
`Record<Provider, ModelChoice[] | null>`, and that `null` was returned by three different branches of
`RuntimeHost.models` plus one renderer state:

 1. **not asked** — the profile does not exist yet (deliberate, and not an error);
 2. **refused** — we asked and the provider said no: no login, no binary;
 3. **closing** — a quit had started, so no probe was allowed to open;
 4. **in flight** — nobody has answered yet.

⚑ **All four rendered identically**, and identically to a fifth state — *there IS a list and you have
not opened it*. the person met #1 on `+ New profile…`, read a plain box under a healthy Codex, and
reported the provider as having no model dropdown. Its catalogue was seven rows with efforts up to
`ultra`.

⚠️ **The guard that produces #1 is correct and is not what this table attacks.** `prepareProviderHome`
CREATES the home and, for Codex, copies the machine credential into it — so probing a name somebody is
still typing would be `098`'s *"asking a question wrote a credential to disk"*, held by `257 §2`. The
rows below break the SAYING, never the guard.

# The groups

* **M1-M4 · the reason must cross the boundary.** The host's three branches collapsed back to one
  answer each: the profile guard, the registry refusal, and the caught rejection.
* **M5-M9 · the field must say WHICH.** Each state's sentence, deleted or replaced by its neighbour.
* **M10-M11 · the `[]` trap** (310 §4). A provider that answered with nothing must not be reported
  as one we could not ask — and must still draw no dropdown onto emptiness.
* **M12-M13 · the remedy, in the button's own words.** The capability lookup, and the shared label.
* **M14-M15 · precedence.** A catalogue for another profile, and the profile-list guard that decides
  whether an unanswered field is *asking* or *not asked*.
* **M16-M17 · the drawer, which had drifted to its own wrong sentence.** The shared field, and the
  claim it used to make about a provider it never reached.
* **M18-M19, M22 · the reasoning half** (310 §3.3), which rides on the same probe — including the
  branch that told a person their provider had declined to name its levels for a question nobody had
  asked it, found on the running app rather than in a test.
* **M20 · the layout.** A note that lands beside the fields instead of under them.
* **M21 · the probe a quit CUT OFF.** The one thing the union made newly wrong, found reviewing the
  diff: the `launch === null` branch was already a quit, and the ABORTED branch was not.

# ⚠️ What this table cannot reach

⛔ **The live probe.** No row can make `listModels` really fail against a real login. Whether the
`refused` arm ever carries a useful `detail` is a live-smoke question, and step 31 is where it is
asked — see below.

⛔ **The live smoke itself.** `scripts/ui-live-smoke.mjs` is executed by no vitest project (277's
`NO-ROWS.md`, 241 M10, 275 M28). Step 31 gained the `+ New profile…` assertion in this dispatch and
**no row here can redden on it**.

⛔ **The provider adapters' own words.** `remedyFor` returns `reprovisionAuth.reason` for a provider
that declares neither gesture — Claude's *"run `claude` in a terminal once"*. That sentence lives in
`packages/runtime/src/claude/capabilities.ts`, which no row below touches: the point of reading it
from there is that this app owns no second copy to break.

# ⛔ NOT MEASURED

**SEVEN rows were measured and fifteen were not**, and the labels say which is which rather than
presenting reasoning as a figure. Seven were applied by hand against **the files that cover them**,
the covering test files were run, the tree was restored and hash-checked; the rest are left for
`mutate.sh` on an idle machine.

⚠️ **A targeted measurement is not a project measurement, and the labels say so.** `M1`'s cell reads
`desktop N red (targeted: model-field.test)`. It means that file was run with the row applied and N
tests died; it does **not** claim the whole project was run. ⛔ Reading it as a project figure would
be the over-claim `279` M3 made in the other direction.

```
M1  M5  M13  M14  M20  M21  M22              MEASURED (targeted files, tree restored + hash-checked)
M2 … M4, M6 … M12, M15 … M19                 EXPECTED (NOT MEASURED)
```

⛔ **M20 is the row to read the labels for.** It was measured GREEN in both projects the first time
— the note it moves wraps inside the flex row and still lands under the box, so both geometric
assertions survived it. The DOM test now asserts the structure the placement is actually about, and
the row dies. ⚑ **That is `279` M3's lesson arriving from the other direction**: a prediction of
`dom 1 red` that the machine refused, caught here only because the row was measured rather than
reasoned about.

**⛔ The baseline is taken by `mutate.sh` at `M0`, from the same channel the verdicts come from
(235/264) — and this docstring deliberately does not restate it as a figure.** A per-project count
written here would be one nobody measured on the tree the run actually happens on, which is the
shape of over-claim every label in this table is careful about. What WAS measured at 310's HEAD:
`pnpm run test` reported **5,858 tests across 302 files**, of which 5,857 passed and one external
instrument failed. Dispatch 311 established both hidden inputs: the test ran registry-latest Vitest
5 from a TEMP directory, not the repo's installed 4.1.10, and inherited `FORCE_COLOR`, whose ANSI
bytes split the stdout phrase its premise grepped. The repaired test and harness execute the
worktree's absolute pnpm-installed Vitest and prove the premise from Vitest's JSON report. ⚑
**`run_suite`'s verdict was already unaffected** — since `235` it reads that JSON report rather than
stdout.

When reached, `runtime`, `scripts` and `shared` execute no file this table touches and are expected
GREEN; a project the frozen reachability derivation proves cannot reach a row is recorded as `NOT
RUN (out of reach)`, never GREEN. `mutations.py --files` makes the inputs checkable, and `M0` still
refuses any unhealthy baseline before a row can be applied.

**All anchors are verified present exactly once** (`mutations.py --dry-run .`), after prettier had
formatted the tree — a step `296` learned the hard way, because formatting moves anchors.
"""

from pathlib import Path

FIELD = "apps/desktop/src/renderer/src/lib/model-field.ts"
HOST = "apps/desktop/src/main/runtime/runtime-host.ts"
LAUNCH = "apps/desktop/src/renderer/src/components/NewConversation.vue"
LIVE = "apps/desktop/src/renderer/src/components/SessionSettings.vue"

# The `no-profile` guard's whole return, with enough of its shape to be unique in the file.
PROFILE_FIRST = """  if (!world.profileExists) {
    return {
      ...silent,
      state: 'no-profile',"""

MUTATIONS = [
    # ── M1-M4 · the reason must cross the boundary ────────────────────────────
    (
        "M1 · 🔴 THE DEFECT, verbatim · the host's profile guard collapses back to a bare silence, "
        "so `+ New profile…` is indistinguishable from a provider that refused and the launcher goes "
        "back to a plain box under a healthy Codex "
        "· MEASURED: desktop 1 red (targeted: model-field.test), dom GREEN (targeted: "
        "model-silence.dom — that file drives the RENDERER's guard, which is M14, so this row "
        "cannot reach it; the host arm has one covering assertion and it dies)",
        [
            (
                FIELD,
                "  if (held.reason === 'no-profile') {\n    return { ...silent, state: 'no-profile', message: comingWithTheProfile() }\n  }",
                "  if (held.reason === 'no-profile') {\n    return { ...silent, state: 'asking', message: comingWithTheProfile() }\n  }",
            )
        ],
    ),
    (
        "M2 · ⛔ the HOST stops saying which silence it is · `no-profile` becomes `refused` on the "
        "wire, so a profile nobody has a home for is reported as a provider that turned us down — a "
        "fact about a provider invented out of a fact about us "
        "· EXPECTED (NOT MEASURED): desktop 2 red of 3,148, dom GREEN",
        [
            (
                HOST,
                # ⚠️ **ANCHOR CORRECTED IN PLACE BY 689** — one provider's catalogue per call now, so the
                # silence is written as the arm itself; the row still names the wrong one.
                "      return Promise.resolve({ ok: false, reason: 'no-profile' })",
                "      return Promise.resolve({ ok: false, reason: 'closing' })",
            )
        ],
    ),
    (
        "M3 · ⚠️ a quit is reported as a provider failure again · the registry refusal and the caught "
        "rejection give one answer, which is exactly what `askProviderForModels`' own comment has "
        "argued against since 070 while both branches returned the same `null` "
        "· EXPECTED (NOT MEASURED): desktop 1 red of 3,148, dom GREEN",
        [
            (
                HOST,
                "      if (launch === null) return { ok: false, reason: 'closing' }",
                "      if (launch === null) return { ok: false, reason: 'refused', detail: 'no probe' }",
            )
        ],
    ),
    (
        "M4 · ⛔ the provider's own diagnostic stops crossing · the refusal arrives with no `detail`, "
        "so the launcher can say that something failed and never what — which is 098's *accurate and "
        "useless* with the accurate half removed too "
        "· EXPECTED (NOT MEASURED): desktop 3 red of 3,148, dom GREEN — ⚠️ every `dom` fixture "
        "builds its own catalogue and none of them calls the host, so no HOST row can reach that "
        "project. Saying so is the claim; a predicted red there would have been a guess",
        [
            # ⚠️ **Anchor CORRECTED IN PLACE BY 682** — a second `refused` return arrived (inbox 9: a
            # home that could not be prepared is `refused` in its own words, not `closing`), so the anchor
            # names the line before this one; the defect (the provider's own diagnostic dropped) is
            # unchanged.
            (
                HOST,
                # ⚑ **710 · re-anchored in place, not retired** — `710`'s review routed this `detail` through `howAFailureReads` (a shortage is said, not its errno); the row still drops the provider's own diagnostic.
                "      if (launch.signal.aborted) return { ok: false, reason: 'closing' }\n      // 🔴 **710 · review** — a probe the machine ran short for says so, never its errno.\n      return { ok: false, reason: 'refused', detail: this.howAFailureReads(error) }",
                "      if (launch.signal.aborted) return { ok: false, reason: 'closing' }\n      // 🔴 **710 · review** — a probe the machine ran short for says so, never its errno.\n      return { ok: false, reason: 'refused', detail: '' }",
            )
        ],
    ),
    # ── M5-M9 · the field must say WHICH ──────────────────────────────────────
    (
        "M5 · 🔴 the launcher goes silent again · the sentence beside the model box is not drawn in "
        "ANY state, so five different situations render the same plain field — the screen that was "
        "reported as *Codex has no model dropdown* "
        "· MEASURED: desktop 6 red of 8 (targeted: model-silence.render), dom 4 red of 4 "
        "(targeted: model-silence.dom)",
        [(LAUNCH, '                v-if="modelState.message"', '                v-if="false"')],
    ),
    (
        "M6 · ⛔ `not asked` is drawn as an ERROR · the normal first launch into a new profile gets "
        "the amber register this page reserves for something being wrong, which is the half that "
        "decides whether a person reports a healthy provider as broken "
        "· EXPECTED (NOT MEASURED): desktop 3 red of 3,148, dom 2 red of 862",
        [
            (
                LAUNCH,
                ":class=\"modelState.tone === 'warn' ? 'warn' : 'advice'\"",
                ":class=\"'warn'\"",
            )
        ],
    ),
    (
        "M7 · ⚠️ `still asking` becomes `we could not ask` · a probe that is out gets the sentence "
        "for one that came back refused, so a slow launcher accuses a provider that has not answered "
        "yet · EXPECTED (NOT MEASURED): desktop 2 red of 3,148, dom GREEN",
        [
            (
                FIELD,
                "      message: `Asking ${world.provider} what it can run…`,",
                "      message: `${world.provider} could not be asked what it can run.`,",
            )
        ],
    ),
    (
        "M8 · ⛔ the not-asked sentence stops saying what WILL happen · it becomes a bare denial, "
        "which is the wording the fix rejected: *this is not an error* is a claim a person has to "
        "take on trust, and a next step is one they can act on "
        "· EXPECTED (NOT MEASURED): desktop 4 red of 3,148, dom 1 red of 862",
        [
            (
                FIELD,
                "    'The model list arrives once this profile exists — it is created when the conversation ' +\n    'starts, not now.'",
                "    'No model list.'",
            )
        ],
    ),
    (
        "M9 · ⚠️ a quit blames the provider · `BroBot2 is closing` becomes the provider's failure, "
        "putting *unavailable* against the one cause that has nothing to do with a provider "
        "· EXPECTED (NOT MEASURED): desktop 2 red of 3,148, dom GREEN",
        [
            (
                FIELD,
                # ⚑ **W4.428 · re-anchored in place, not retired** — the window's words now name the product BroCrew, or say "This app" for the app's own acts; the row plants the same defect in the renamed text.
                "      message: `BroCrew is closing, so ${world.provider} was not asked what it can run.`,",
                "      message: `${world.provider} could not be asked what it can run.`,",
            )
        ],
    ),
    # ── M10-M11 · the `[]` trap (310 §4) ──────────────────────────────────────
    (
        "M10 · 🔴 310 §4's TRAP, verbatim · a provider that answered with ZERO rows is reported as "
        "one we could not ask — we could, and it said none. This is the mistake the ticket warned "
        "the fix would make, in the exact words it warned about "
        "· EXPECTED (NOT MEASURED): desktop 4 red of 3,148, dom GREEN",
        [
            (
                FIELD,
                "          message: `${world.provider} listed no models for this profile, so there is no menu.`,",
                "          message: `${world.provider} could not be asked what it can run.`,",
            )
        ],
    ),
    (
        "M11 · ⛔ the empty list becomes a DATALIST again · `[]` is truthy, so a provider that "
        "answered with nothing draws a dropdown arrow that opens onto emptiness — 058's review, and "
        "the one rule this refactor had to carry across unchanged "
        "· EXPECTED (NOT MEASURED): desktop 2 red of 3,148, dom GREEN",
        [
            (
                FIELD,
                "    return held.models.length > 0\n      ? { state: 'listed', choices: held.models, message: null, tone: 'note', remedy: null }",
                "    return held.models.length >= 0\n      ? { state: 'listed', choices: held.models, message: null, tone: 'note', remedy: null }",
            )
        ],
    ),
    # ── M12-M13 · the remedy, in the button's own words ───────────────────────
    (
        "M12 · ⛔ the remedy stops being asked of the CAPABILITIES · every provider is offered the "
        "profile sign-in, so a Claude user whose machine login expired is pointed at a button that "
        "does not exist on that provider — 098 review finding 15, arriving through the model field "
        "· EXPECTED (NOT MEASURED): desktop 2 red of 3,148, dom GREEN",
        [
            (
                FIELD,
                "  if (world.signIn.state === 'available') {",
                "  if (world.signIn.state !== 'zzz') {",
            )
        ],
    ),
    (
        "M13 · ⚠️ the model field invents its own wording for a gesture the panel already names · "
        "one button, two phrasings, which teaches a person there are two gestures — 308 §5's mistake "
        "in the other direction, and the reason `credential-words.ts` exists at all. ⛔ **It mutates "
        "the READER, not the constant**: changing `SIGN_IN_HERE` moves the button and the sentence "
        "together, so a row that did that would be a survivor dressed as a check "
        "· MEASURED: desktop 3 red (targeted: model-silence.render + model-field.test), dom 1 red "
        "(targeted: model-silence.dom)",
        [
            (
                FIELD,
                "return `If this profile is not signed in: ${SIGN_IN_HERE}.`",
                "return 'If this profile is not signed in, sign in.'",
            )
        ],
    ),
    # ── M14-M15 · precedence ──────────────────────────────────────────────────
    (
        "M14 · 🔴 a catalogue OUT-VOTES a profile that does not exist · the launcher goes on offering "
        "the previous profile's rows under the new name, which is 256 H1 — *a second profile's "
        "launcher quietly presenting the default profile's catalogue* — and it is the row this "
        "dispatch's own DOM test found rather than predicted "
        "· MEASURED: desktop 4 red (targeted: model-field.test) + 2 red (targeted: "
        "model-silence.render), dom 3 red (targeted: model-silence.dom)",
        [(FIELD, PROFILE_FIRST, "  if (false) {\n    return {\n      ...silent,\n      state: 'no-profile',")],
    ),
    (
        "M15 · ⛔ an unarrived profile LIST is read as *your profile does not exist* · the launcher "
        "tells a person their profile is missing because we had not finished looking — and it is the "
        "`Array.isArray` trap this file's own `canCreateProfile` documents "
        "· EXPECTED (NOT MEASURED): desktop 1 red of 3,148, dom GREEN",
        [
            (
                LAUNCH,
                # ⚠️ **Anchor corrected in place by 329, label untouched** (142). The expression was
                # inline inside `modelField({…})` at six spaces; 329 lifted it into a named
                # `profileExists` computed — because the credential line it added decides
                # *"nothing has been written for this name yet"* off the SAME question — and
                # prettier reindented it to four. The row still mutates the same predicate and
                # still says the same thing; only where it lives changed.
                "    (!Array.isArray(props.profiles) || props.profiles.includes(chosenProfile.value)),",
                "    (props.profiles ?? []).includes(chosenProfile.value),",
            )
        ],
    ),
    # ── M16-M17 · the drawer's own wrong sentence ─────────────────────────────
    (
        "M16 · ⛔ the drawer stops reading the shared field · it goes back to deriving *is there a "
        "menu* from an empty array, which is the second predicate this dispatch removed — and the "
        "one that had already drifted to a different wrong sentence "
        "· EXPECTED (NOT MEASURED): desktop 4 red of 3,148, dom GREEN",
        [(LIVE, "const rows = computed(() => catalogue.value.choices ?? [])", "const rows = computed(() => [])")],
    ),
    (
        "M17 · 🔴 the drawer's OWN defect, verbatim · a refused probe is announced as *this provider "
        "named no models* — a claim about a provider that was never reached, which the component's "
        "own comment admitted it could not tell apart "
        "· EXPECTED (NOT MEASURED): desktop 3 red of 3,148, dom GREEN · killed by `an-agents-model-on-screen.dom.test.ts` (named by W4.78)",
        [
            (
                "apps/desktop/src/renderer/src/components/ModelPicker.vue",
                # ⚑ **W4.78 · re-anchored in place, not retired** — 6d2d195d moved the drawer's model sentence into ModelPicker (which SessionSettings mounts); the picker hands modelField the list's notAsked refusal. Dropping it turns a refused list into ok-with-no-provider-rows, so the section says 'X listed no models for this profile' instead of 'could not be asked' - the same false claim about an unreached provider. Killer is a DOM test now (label's 'dom GREEN' expectation no longer holds). (moved from SessionSettings.vue)
                "                : (list.notAsked ?? {\n",
                "                : ({\n",
            )
        ],
    ),
    # ── M18-M19 · the reasoning half (310 §3.3) ───────────────────────────────
    (
        "M18 · ⚠️ the reasoning menu goes back to saying nobody has answered without saying WHY · "
        "the levels ride on the same probe as the models, so this is 310 §3.3 — *reasoning follows "
        "the same null, and it is the same fix* — undone "
        "· EXPECTED (NOT MEASURED): desktop 1 red of 3,148, dom GREEN",
        [
            (
                LAUNCH,
                "so ${menu}. ${why} Changeable later",
                "so ${menu}. Changeable later",
            )
        ],
    ),
    (
        "M19 · ⛔ the launcher stops saying its box still takes anything · the one sentence that is "
        "true in all five silent states is dropped, so a person with no menu is told what happened "
        "and not that 038's free-text field is still there "
        "· EXPECTED (NOT MEASURED): desktop 2 red of 3,148, dom 1 red of 862",
        [
            (
                LAUNCH,
                '                  <span data-cy="model-still-free">{{ MODEL_STILL_FREE }}</span>',
                '                  <span v-if="false" data-cy="model-still-free">{{ MODEL_STILL_FREE }}</span>',
            )
        ],
    ),
    # ── M20 · the layout ──────────────────────────────────────────────────────
    (
        "M20 · ⛔ the sentence moves INSIDE the wrapping flex row · it lands beside the model and "
        "reasoning fields instead of under them, which is the 101 §2 overflow that clipped `plan` "
        "off the right — the shape no SSR assertion can see, because the markup is identical "
        "· MEASURED: dom 1 red (targeted: model-silence.dom), desktop GREEN (model-field.test, "
        "model-silence.render and live-settings.render, all three whole). ⛔ **This row was GREEN "
        "in the BROWSER too on its first measurement**: the note wraps inside the flex row and "
        "still lands under the box and inside the fold, so `top >= bottom` and `right <= "
        "fold.right` both survived it. The test asserts the STRUCTURE now — the row's children are "
        "the two controls and nothing else — which is the claim that was actually being made",
        [
            (
                LAUNCH,
                '              </div>\n              <!-- 🔴 **Why there is no menu, ON SCREEN** (310)',
                '              <!-- 🔴 **Why there is no menu, ON SCREEN** (310)',
            ),
            (
                LAUNCH,
                '              <!-- Where the description lives now. The provider\'s own words, unedited (076 §2) —',
                '              </div>\n              <!-- Where the description lives now. The provider\'s own words, unedited (076 §2) —',
            ),
        ],
    ),
    # ── M21 · the probe a quit cut off ────────────────────────────────────────
    (
        "M21 · 🔴 a probe the QUIT aborted is reported as a provider that REFUSED · so closing the "
        "window mid-launcher tells a person their provider turned them down and offers them a "
        "sign-in for it — the one thing this dispatch's own union made newly wrong, and the branch "
        "`askProviderForModels` has claimed *reads correctly* since 070 "
        "· MEASURED: desktop 1 red (targeted: runtime-host.test), dom GREEN (targeted: "
        "model-silence.dom)",
        [
            (
                HOST,
                "      if (launch.signal.aborted) return { ok: false, reason: 'closing' }",
                "      if (false) return { ok: false, reason: 'closing' }",
            )
        ],
    ),
    # ── M22 · the reasoning tooltip's own false claim ─────────────────────────
    (
        "M22 · 🔴 the reasoning tooltip claims the PROVIDER declined again · with no catalogue and "
        "no remembered rung — every fresh launcher since 292 §3 — it reports that a provider *did "
        "not say which reasoning levels it accepts* for a question nobody asked it, which is 179 "
        "§4's invented limit and the reasoning half of this dispatch's own defect "
        "· MEASURED: desktop 2 red (targeted: model-silence.render), dom GREEN (targeted: "
        "model-silence.dom)",
        [
            (
                LAUNCH,
                "  const why = modelState.value.message\n  if (why !== null) {",
                "  const why = modelState.value.message\n  if (why !== null && false) {",
            )
        ],
    ),
]


def apply(root: Path, index: int, dry: bool) -> int:
    name, edits = MUTATIONS[index]
    bad = 0
    for rel, find, replace in edits:
        path = root / rel
        text = path.read_text()
        hits = text.count(find)
        if hits != 1:
            print(f"!! {name}: anchor found {hits} times in {rel} (expected exactly 1)")
            bad += 1
            continue
        # ⛔ **A replacement equal to its original records as SURVIVED and proves nothing** — the
        # phantom survivor 252 found, and 268 §2 found one that had reached a committed table.
        if find == replace:
            print(f"!! {name}: the replacement is identical to the anchor — this row is a no-op")
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
        edits = sum(len(edits) for _name, edits in MUTATIONS)
        for index in range(len(MUTATIONS)):
            bad += apply(root, index, dry=True)
        print(
            f"{len(MUTATIONS) - bad}/{len(MUTATIONS)} rows apply exactly once ({edits} edit anchors)"
        )
        return 1 if bad else 0
    root = Path(args[0]).resolve()
    return apply(root, int(args[1]), dry=False)


if __name__ == "__main__":
    raise SystemExit(main())
