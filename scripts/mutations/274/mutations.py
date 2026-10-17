#!/usr/bin/env python3
"""274's mutation table — each row is THE DEFECT, put back verbatim (131).

⛔ **One finding, measured live before a line was written.** `272` reported a launcher that offered
no reasoning choice for `haiku` and a header that then read `medium (requested)`. Driven on this
worktree's own app over CDP — its own free port, the real Claude catalogue, zero provider tokens —
reading the control and the launcher's own `settings` computed at one instant:

```
                       options        shows       ref      would send
before the list lands  ['']           (nothing)   medium   medium
model "haiku"          [''] DISABLED  (nothing)   medium   medium
model "sonnet"         ['',low…max]   medium      medium   medium     ← the only correct one
"xhigh" then "haiku"   [''] DISABLED  (nothing)   xhigh    xhigh
```

⚠️ **The cause is not the one the dispatch suspected, and the correction is bigger than the fix.**
`272` and the brief both read it as a RESTORED draft surviving into a model that cannot express it.
That is one of two ways in. `emptyLaunchDraft` **pre-selects `medium`**, so the first launcher on a
brand-new machine is already in this state before the model list has arrived — and `props.models` is
`null` at every mount, permanently for the `+new` profile sentinel, and permanently after a failed
probe (`RuntimeScreen.vue`'s `askModels` catch is silent and never retried). Three of four measured
states were wrong, and only one of the three involved a restore.

⚑ **The mechanism is Vue's.** A `<select>` whose bound value matches none of its options is set to
`selectedIndex = -1` by `setSelected` on `mounted`/`updated` — the control renders BLANK. ⚠️ **SSR is
NOT blind to that**, which is worth stating because the obvious claim is the opposite:
`@vue/compiler-ssr`'s `ssrTransformModel` pushes a conditional ` selected` onto every `<option>`
whose value `ssrLooseEqual`s the model (`compiler-ssr.cjs.js:1110-1130`), `v-for` rows included, so a
string render does show which option is chosen — a `.render.test.ts` could have caught the DISPLAY
half and nobody wrote one. What SSR cannot do is the rest: it renders once, so nothing types into the
model box after mount, presses Send, or reads the payload that leaves. Every row below therefore dies
in `dom`, except `M14`, which mutates a column only the main-side test reads.

The row groups:

 * `M1`-`M6`   🔴 **§2 · what ships** — that the payload reads the value the control is SHOWING, that
                the gate exists at all, that the menu and the gate read ONE list, and that the setter
                still writes a choice through in both directions.
 * `M7`-`M8`   🔴 **§2 · silence narrows nothing** — that a rung survives an unanswered probe, and
                that it does NOT survive a provider that answered. These are the two halves of the
                one judgement 274 had to make, and they fail in opposite directions.
 * `M9`-`M12`  ⚠️ **§2 · what is said** — the held-back sentence, the two independent things that
                keep it out of 179's slot, and the tooltip that has its own copy of the empty claim.
 * `M13`-`M15` ⛔ **the corpus, which is the seam** — `fixtures/effort-launches.ts` is read by a
                real-browser test of the control and a main-side test of the host, and it is the
                only thing that carries one launcher state through to the sentence it prints.
 * `M16`-`M18` ⚑ **what the adversarial pass over 274's own diff added** — a pooled absence
                attributed to a model the catalogue never mentioned, and the two doors that keep
                `undefined` out of the ref.

## ⛔ Written against 264's harness contract and NOT runnable at this commit — and it says so

`274` branches off `main` @ `42d952d`. `264`-`269` rebuilt the shared harness on `mla/mutations`,
which at `8b62c34` is **not an ancestor of that commit** — `require_healthy_baselines`,
`begin_mutation_control` and `require_healthy_control` do not exist in
`scripts/mutations/lib/harness.sh` here. ⚠️ **The dispatch's §3 says the harness changed; in this
tree it has not yet**, which is the same state `265` and `271` both recorded. `mutate.sh` refuses
with a sentence rather than dying on `command not found`.

## ⚑ Eight rows measured by hand, by ordinary edits to the working tree

`274` wrote the table and did not run it (§3: *"Write, do not run."*), so `mutations.txt` does not
exist and its absence is the honest state. What WAS done is putting eight of the defects into the
tree by hand and running `vitest run --project dom effort-asked effort-menu` (**16 tests**) — an
ordinary edit, no harness, no tree lock. Recorded as measured, not as expected:

```
M1   the payload reads the ref again          4 red of 16
M2+M3 the pre-fix control, whole              9 red of 16   ← and the 7 green are the paired positives
M9   the held-back sentence removed           2 red of 16
M10  the chain swapped AND the guard dropped  3 red of 16
M11  the guard dropped alone                  0 red — SURVIVOR, and that is the finding
M16  a pooled absence blamed on the typed id  1 red of 16
M17  both doors on `undefined` removed        1 red of 16 — and it reproduces the live observation
                                              exactly: options ['provider default', '']
M18  the setter stops normalising             1 red of 16
```

## ⛔ One row is an expected SURVIVOR, and it is the most useful row here

`M11` drops {@link effortHeldBack}'s `effortOptions.value.length === 0` clause and **nothing changes
on screen** — because the template's `v-else-if` chain gives `effortSilence` the slot first. Measured,
not assumed. ⚠️ **That is why `M10` carries two edits**: swapping the two `<p>` blocks alone is also a
no-op (the computed already returns null wherever `effortSilence` speaks), so a row that only swapped
them would record SURVIVED while its label claimed a kill — the phantom this table's own adversarial
pass caught. The pair is the point: **two independent guards, and you have to remove both.**

⚑ `M17` is the same shape and is written the same way. `effortOptions`' truthiness test alone cannot
be reached while the setter normalises, so the row removes **both** doors — and then reproduces, in a
test, the two-option control that was seen on the running app.

## ⛔ What this table cannot reach, stated because a table silent about its edges is claiming them

 * ⚠️ **No row reaches the real catalogue.** Every `dom` row uses `MEASURED_CLAUDE`, a fixture whose
   shape came from `pnpm run probe:model-effort` and was re-measured live for 274. That the provider
   still answers that way is a live fact and `ui-live-smoke.mjs` step 56 is where it is checked.
 * ⚠️ **No row reaches the live smoke.** 274 changed one line of it — step 45 now waits on the
   `model-choices` datalist rather than on the effort menu being non-empty, because since 274 an
   unanswered probe still offers the held rung. Nothing in the `scripts` project executes that step.
 * ⚠️ **No row mutates `runtime-host.ts`.** `describeReasoning` is unchanged by 274, and `179 M4`
   already anchors `settings.reasoningEffort === null ? '…' : …`.

🔴 **`435` REANIMATED two of this table's rows, and one of them had to be re-aimed** (HO-025 §5).

⛔ **`417` deleted the launcher's fold and fourteen of these eighteen rows have been stale since.**
`435` put the control back, so `M1` and `M12`'s ANCHORS came back verbatim and the census un-retired
both. ⚠️ **Neither was runnable as written**, and the census cannot see that: `--dry-run` checks the
ANCHOR and never the REPLACEMENT.

- **`M1`** reverted to `reasoningEffort.value`, a ref that went with `lib/launch-draft.ts`. Applying
  it produced a `ReferenceError` on first render — a guaranteed red for the wrong reason, counted as
  live protection. **Re-pointed at the prop that holds the answer now; the defect is unchanged.**
- **`M12`**'s PREMISE was overturned by the same dispatch. It reverted the tooltip to
  `effortChoices` — the catalogue-scoped list — so it would claim *there is no menu* over a one-rung
  menu; `435` deleted `effortChoices` (the pooling rule is `effort-menu.ts`'s) and, in review, gave
  `effortTitle` the *has anybody ANSWERED* branch it never had, which makes that state unreachable.
  ⚑ **Re-aimed at the half of the rule that survived — the branch ORDER** — which still produces the
  same false sentence, attributing a silence of ours to the provider (`179 §4`).

⚠️ **Both were applied alone and watched go red** against
`apps/desktop/test/dom/a-front-door-that-offers-everything.dom.test.ts` §5 and §3. ⛔ **No
`ANCHOR CORRECTED IN PLACE` suffix**: this table is `unrun`, so there is no verdict for a correction
to invalidate — the `MEASURED:` notes in these labels are per-row verifications, not a table run.
"""

from pathlib import Path

NEW_CONV = "apps/desktop/src/renderer/src/components/NewConversation.vue"
FIXTURE = "apps/desktop/test/fixtures/effort-launches.ts"
DOM_TEST = "apps/desktop/test/dom/effort-asked.dom.test.ts"

HELD_BACK_GUARD = """  if (
    reasoningEffort.value === '' ||
    effortAsked.value !== '' ||
    effortOptions.value.length === 0
  ) {"""
HELD_BACK_GUARD_WEAK = """  if (
    reasoningEffort.value === '' ||
    effortAsked.value !== ''
  ) {"""

MUTATIONS = [
    # ── §2 · what ships ─────────────────────────────────────────────────────────────────────────
    (
        "M1 · 🔴 THE DEFECT, verbatim · the payload reads the ref again, so a rung the control has "
        "no option for ships from a blank box — 272's finding, at the line that produced it",
        # ⚑ **Replacement re-pointed by `435`.** The anchor came back verbatim (HO-025 §5 put the
        # control back and the payload writes the same omission), but the identifier this row
        # reverted TO — the old `reasoningEffort` ref — went with `lib/launch-draft.ts` at `417`.
        # ⛔ **A row whose replacement names a dead identifier is unrunnable and the census cannot
        # see it**: `--dry-run` checks the ANCHOR and never the NEW side, so this would have counted
        # as live protection while throwing `ReferenceError` on first render. The held answer now
        # lives on the prop; the DEFECT and the kill are unchanged.
        [
            (
                NEW_CONV,
                "  ...(effortAsked.value === '' ? {} : { reasoningEffort: effortAsked.value }),",
                "  ...(props.choices.reasoningEffort === ''\n    ? {}\n    : { reasoningEffort: props.choices.reasoningEffort }),",
            )
        ],
    ),
    (
        "M2 · 🔴 the gate is gone · `effortAsked` hands back whatever is remembered, so the control "
        "goes blank on every model that cannot express it and the launch asks for it anyway",
        [
            (
                NEW_CONV,
                "  get: () =>\n    effortOptions.value.some((rung) => rung.id === reasoningEffort.value)\n      ? reasoningEffort.value\n      : '',",
                "  get: () => reasoningEffort.value,",
            )
        ],
    ),
    (
        "M3 · 🔴 the MENU and the gate read two lists again · the options come from the provider's "
        "list while the gate reads the offered one, which is the disagreement the whole fix removes",
        [
            (
                NEW_CONV,
                '                      v-for="effort in effortOptions"',
                '                      v-for="effort in effortChoices"',
            )
        ],
    ),
    (
        "M4 · ⚠️ the same disagreement, the other way round · the option is rendered and the gate "
        "refuses it, so a rung sits in the menu that pressing Send will not ask for",
        [
            (
                NEW_CONV,
                "    effortOptions.value.some((rung) => rung.id === reasoningEffort.value)",
                "    effortChoices.value.some((rung) => rung.id === reasoningEffort.value)",
            )
        ],
    ),
    (
        "M5 · ⛔ the setter is inert · the menu shows the right thing and choosing from it does "
        "nothing, which satisfies every assertion about what is DISPLAYED",
        [(NEW_CONV, "    reasoningEffort.value = picked || ''", "    void picked")],
    ),
    (
        "M6 · ⚠️ the setter will not clear · turning a rung back OFF leaves it on screen and in the "
        "payload, which is the direction a gate swallows silently — `''` is a choice, not an absence",
        [
            (
                NEW_CONV,
                "    reasoningEffort.value = picked || ''",
                "    if (picked !== '') reasoningEffort.value = picked",
            )
        ],
    ),
    # ── §2 · silence narrows nothing, and an answer does ────────────────────────────────────────
    (
        "M7 · 🔴 an unanswered probe DROPS the rung · so what a launch asks for depends on whether "
        "the model list had landed yet — 024's pre-selection evaporating on a race nobody can see",
        [
            (
                NEW_CONV,
                "  if (modelChoices.value !== null) return effortChoices.value",
                "  return effortChoices.value",
            )
        ],
    ),
    (
        "M8 · 🔴 the fallback applied where the provider ANSWERED · the OTHER resolution 272 allowed, "
        "and the one §2 forbids: haiku offers `medium` on a DISABLED control and ships it",
        [
            (
                NEW_CONV,
                "  if (modelChoices.value !== null) return effortChoices.value",
                "  if (modelChoices.value !== null && effortChoices.value.length > 0)\n    return effortChoices.value",
            )
        ],
    ),
    # ── §2 · what is said ───────────────────────────────────────────────────────────────────────
    (
        "M9 · 🔴 the held-back sentence is gone · a rung the launcher stops asking for stops applying "
        "with no word said, which is the silent half of the same defect · MEASURED: 2 red of 16",
        [
            (
                NEW_CONV,
                '              <p v-else-if="effortHeldBack" class="reason-hint" data-cy="reasoning-held-back">\n                {{ effortHeldBack }}\n              </p>\n',
                "",
            )
        ],
    ),
    (
        "M10 · ⚠️ BOTH guards on the hint chain removed · the computed's own clause AND the template "
        "order, so held-back takes 179's slot and a model reporting no levels stops saying so "
        "· MEASURED: 3 red of 16, where either edit alone is a no-op (see M11)",
        [
            (
                NEW_CONV,
                '              <p v-else-if="effortSilence" class="reason-hint" data-cy="reasoning-silence">\n                {{ effortSilence }}\n              </p>\n              <!-- …and when there WAS something to offer and the remembered rung was not among it\n                   (274 §2). ⛔ **Last in the chain, and that is a SECOND guard rather than a\n                   restatement of `effortHeldBack`\'s own**: the computed already returns null where\n                   `effortSilence` speaks, so in the committed tree this order changes nothing — it\n                   is what keeps 179\'s sentence in its slot if that clause is ever weakened. -->\n              <p v-else-if="effortHeldBack" class="reason-hint" data-cy="reasoning-held-back">\n                {{ effortHeldBack }}\n              </p>',
                '              <p v-else-if="effortHeldBack" class="reason-hint" data-cy="reasoning-held-back">\n                {{ effortHeldBack }}\n              </p>\n              <p v-else-if="effortSilence" class="reason-hint" data-cy="reasoning-silence">\n                {{ effortSilence }}\n              </p>',
            ),
            (NEW_CONV, HELD_BACK_GUARD, HELD_BACK_GUARD_WEAK),
        ],
    ),
    (
        "M11 · ⚠️ EXPECTED SURVIVOR, measured (0 red of 16) · the computed's clause dropped ALONE, "
        "and nothing changes on screen because the template's chain still gives 179 the slot — the "
        "row that proves the two guards are independent rather than one written twice",
        [(NEW_CONV, HELD_BACK_GUARD, HELD_BACK_GUARD_WEAK)],
    ),
    (
        "M12 · ⚠️ the tooltip makes an empty-menu claim in a state the provider never answered · "
        "'this provider did not say which efforts it accepts' while no catalogue has arrived at "
        "all — 179 put the sentence on screen and left this one behind",
        # 🔴 **RE-AIMED by `435`, because its PREMISE was overturned by the same dispatch that
        # brought its anchor back.** This row reverted the tooltip to `effortChoices` — the
        # catalogue-scoped list — so it would claim *there is no menu* while a one-rung menu was on
        # screen. ⛔ **`435` deleted `effortChoices`** (the pooling rule is `effort-menu.ts`'s now)
        # and, in review, gave `effortTitle` the *has anybody ANSWERED* branch it never had, which
        # makes the old state unreachable: the no-catalogue case is answered before any length test.
        # ⚑ **Re-aimed at the half of the rule that survived — the ORDER** (142: correct, never
        # delete). Putting the length test first makes the tooltip attribute a silence of OURS to
        # the provider, which is `179 §4`'s defect and the same false sentence this row was
        # written about.
        [
            (
                NEW_CONV,
                "  if (modelChoices.value === null) {\n    return effortOptions.value.length === 0",
                "  if (effortOptions.value.length === 0) {\n    return modelChoices.value === null",
            )
        ],
    ),
    # ── the corpus, which is the seam ───────────────────────────────────────────────────────────
    (
        "M13 · ⛔ the corpus says the haiku launch DOES ask for medium · the one column BOTH ends "
        "read, so this is the row expected to kill in `dom` AND `desktop` at once · killed by `reasoning-asked.test.ts` (named by W4.78)",
        [
            (
                FIXTURE,
                # ⚑ **W4.78 · re-anchored in place, not retired** — 6d2d195d (UI-012) dropped the held/shows/says columns along with the browser end. The haiku case 'the model reports no levels' (the one that held medium) now goes straight from model to asks. Only reasoning-asked.test.ts reads `asks`, so the row now kills in desktop alone: the DOM test imports only MEASURED_CLAUDE. With model and effort both named, theSelectedModel sends the effort as named, so the header reads 'medium (requested)' where '…' is expected.
                "    why: '🔴 272 finding 2, exactly: the control offered nothing and the launch asked for medium',\n    models: MEASURED_CLAUDE,\n    model: 'haiku',\n    asks: undefined,\n",
                "    why: '🔴 272 finding 2, exactly: the control offered nothing and the launch asked for medium',\n    models: MEASURED_CLAUDE,\n    model: 'haiku',\n    asks: 'medium',\n",
            )
        ],
    ),
    (
        "M14 · ⛔ the corpus's HEADER column is weakened · the row that must read `…` claims "
        "`medium (requested)`, the sentence 272 actually saw · ⚠️ only `reasoning-asked.test.ts` "
        "reads this column, so this row is expected to kill in `desktop` alone and be GREEN in `dom` · killed by `reasoning-asked.test.ts` (named by W4.78)",
        [
            (
                FIXTURE,
                # ⚑ **W4.78 · re-anchored in place, not retired** — 6d2d195d (UI-012) removed the `says` column, so the old anchor's `says: 'silence',` line is gone. Same case, same weakening. This case is not in D042_HEADER, so headerOf reads the corpus value, the host prints '…', and that case goes red. The both-endings guard still sees two headers.
                "    asks: undefined,\n    header: '…',\n  },\n  {\n    name: 'the model reports no levels, carrying a different rung',",
                "    asks: undefined,\n    header: 'medium (requested)',\n  },\n  {\n    name: 'the model reports no levels, carrying a different rung',",
            )
        ],
    ),
    (
        "M15 · ⚠️ the browser test stops restoring a draft · every case falls back to the launcher's "
        "own pre-selected medium, so the corpus's `held` column stops reaching the component at all",
        [
            (
                DOM_TEST,
                "  const draft: LaunchDraft = { ...emptyLaunchDraft('claude'), fineTuneOpen: true, ...over }",
                "  const draft: LaunchDraft = { ...emptyLaunchDraft('claude'), fineTuneOpen: true }",
            )
        ],
    ),
    # ── what the adversarial pass over 274's own diff added ─────────────────────────────────────
    (
        "M16 · ⚠️ a POOLED absence blamed on the model in the box · the sentence names an id the "
        "catalogue never mentioned, which is 177 §4's undisclosed-pooling defect arriving on the "
        "launcher side · MEASURED: 1 red of 16",
        [
            (
                NEW_CONV,
                "  const named = typed !== '' && (modelChoices.value ?? []).some((row) => row.id === typed)",
                "  const named = typed !== ''",
            )
        ],
    ),
    (
        "M17 · 🔴 BOTH doors on `undefined` removed · Vue's select handler assigns `undefined` when a "
        "`change` fires with nothing selected, and the launcher then grows a second, BLANK option — "
        "seen on the running app · MEASURED: 1 red of 16, reproducing ['provider default', '']",
        [
            (
                NEW_CONV,
                "  return held ? [{ id: held, label: held }] : []",
                "  return held === '' ? [] : [{ id: held, label: held }]",
            ),
            (NEW_CONV, "    reasoningEffort.value = picked || ''", "    reasoningEffort.value = picked"),
        ],
    ),
    (
        "M18 · ⚠️ the setter stops normalising · the FIRST of those two doors alone, so the memory "
        "the draft carries out of this component can hold a value its own type forbids "
        "· MEASURED: 1 red of 16",
        [
            (
                NEW_CONV,
                "    reasoningEffort.value = picked || ''",
                "    reasoningEffort.value = picked",
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
        # phantom survivor 252 found. Checked here rather than by eye, on every row, every run.
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
        for index in range(len(MUTATIONS)):
            bad += apply(root, index, dry=True)
        print(f"{len(MUTATIONS) - bad}/{len(MUTATIONS)} anchors found exactly once")
        return 1 if bad else 0
    root = Path(args[0]).resolve()
    return apply(root, int(args[1]), dry=False)


if __name__ == "__main__":
    raise SystemExit(main())
