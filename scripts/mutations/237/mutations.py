#!/usr/bin/env python3
"""237's mutation table — each row is THE DEFECT, put back verbatim (131).

⛔ **This table is unusual, and the reason is the dispatch's own subject.** Most of 237 lives in
`ui-live-smoke.mjs`, a file `pnpm run ci` cannot run — which is precisely why the defects it fixes
survived every green run since they were written. So the rows below mutate the smoke and are killed
by the two suites that read its SOURCE (`step-census.test.mjs`, `smoke-claims.test.mjs`). ⚑ That is
the only channel a gate has into a file it cannot execute, and this table is how we find out whether
it is a real one.

The row groups:

 * `M1`-`M10`  ⛔ **§1 · the completeness answer** (`230` H1). The verdict and both halves it is made
               of, the attributes it rides on, the sentence a person reads, and the smoke's refusal
               to conclude from a window at each of the four absence sites.
 * `M11`-`M20`, `M35` ⛔ **§2 · the census's memory** (`230` H2). The departure arithmetic, the frozen list
               pinned by CONTENT rather than size, the ledger's control field, and the one-way door.
 * `M21`-`M22` ⚠️ **§3 · the reciprocal swap**. Step 7 out of EXPOSED and step 56 into it.
 * `M23`-`M27` 🔴 **§4 · step 7's reasoning shape**. The ban, the two branches, the disclosure that
               gets OPENED, and the caption hook.
 * `M28`-`M34` ⛔ **§5 · 235's erasure marker**, written by the dispatch that could touch this file.

## ⛔ What this table cannot reach, stated because a table silent about its edges is claiming them

 * 🔴 **No row proves that any of this WORKS against a running app.** Every smoke row here dies in a
   source-side grep, which measures that the code is present and not that it does what it says. The
   instrument for that is the live run in §8, and the two things it settled that no grep could —
   that `data-whole` is really rendered and readable over CDP, and that the sentence and the
   attribute agree — are named in the response rather than claimed here.
 * ⛔ **`EVER_AT_LEAST` has no row.** It is the ratchet's release lever: lowering it is *meant* to be
   a visible, reviewed edit, and a mutation that lowers it is indistinguishable from the legitimate
   act. What a test can hold is that the union may not fall below it, which `M20`'s neighbour covers.
 * ⚠️ **The forgery residual on `235`'s marker has no row**, because closing it means changing the
   marker and `237` §7 forbids reopening it. A provider label CONTAINING ` · degraded:tool_call`
   satisfies the suffix; the direction is a false RED rather than a hidden defect, and it is named
   in the response instead.
 * ⛔ **The WORDING of step 7's two contradicting claims has no row.** What was wrong was the English
   of two sentences printed side by side, and no assertion this repository can write decides that a
   report contradicts itself. `M27` covers the structural half — that the third reasoning state has
   its own branch — which is what makes the contradiction unrepresentable; the sentences themselves
   are read by a person.
 * ⚠️ **`whole` reading the two EDGES and not a hole in the middle has no row**, deliberately: a gap
   is a different fault with a different owner (`SessionRecord.nextOrdinal` reports one), and a row
   asserting this attribute covered it would be pinning a claim the code correctly declines to make.
"""

from pathlib import Path

STREAM = "apps/desktop/src/renderer/src/components/EventStream.vue"
THINKING = "apps/desktop/src/renderer/src/components/ThinkingEntry.vue"
SMOKE = "scripts/ui-live-smoke.mjs"
CENSUS = "scripts/lib/step-census.mjs"
TABS = "scripts/lib/tab-flow.mjs"

# (name, [(file, old, new), ...])
MUTATIONS = [
    # ---- §1 · the completeness answer --------------------------------------------------------
    (
        "M1  · ⛔ THE DEFECT, verbatim (230 H1) · the tab promises everything again — the verdict is "
        "hard-coded true, so a released or frozen window reports itself as the whole session and "
        "every absence conclusion in the smoke is read off a partial list",
        [
            (
                STREAM,
                "const whole = computed(() => !props.window.hasOlder && props.window.atTail)",
                "const whole = computed(() => true)",
            )
        ],
    ),
    (
        "M2  · ⛔ only the RELEASE half — a window the reader has scrolled off the tail of claims to "
        "be complete, which is the cheaper of the two states and the silent one",
        [
            (
                STREAM,
                "const whole = computed(() => !props.window.hasOlder && props.window.atTail)",
                "const whole = computed(() => !props.window.hasOlder)",
            )
        ],
    ),
    (
        "M3  · ⛔ only the TAIL half — a window whose oldest 1,251 events were released claims to be "
        "complete, which is 230 H1's headline case",
        [
            (
                STREAM,
                "const whole = computed(() => !props.window.hasOlder && props.window.atTail)",
                "const whole = computed(() => props.window.atTail)",
            )
        ],
    ),
    (
        "M4  · ⛔ the fact stops riding on the list — `data-whole` is not rendered, so the one read "
        "every refusal in the smoke rests on has nothing to read",
        [
            (
                STREAM,
                "      :data-whole=\"whole ? 'true' : 'false'\"\n",
                "",
            )
        ],
    ),
    (
        "M5  · ⚠️ the count of what is missing is not rendered — `data-behind`, which is the only "
        "number distinguishing a frozen window from a quiet session",
        [
            (
                STREAM,
                '      :data-behind="props.window.behind"\n',
                "",
            )
        ],
    ),
    (
        "M6  · ⛔ the sentence a PERSON reads is gone — the attribute survives, so the machine half "
        "still passes while the panel is back to saying nothing about what it holds",
        [
            (
                STREAM,
                '      <span data-cy="event-log-reach">{{ reach }}</span>',
                "",
            )
        ],
    ),
    (
        "M7  · ⚠️ the singular loses its verb again — “1 newer event have arrived”, the value between "
        "the two the other cases cover",
        [
            (
                STREAM,
                "          ? '1 newer event has arrived and is not in this list'",
                "          ? '1 newer event have arrived and is not in this list'",
            )
        ],
    ),
    (
        "M8  · 🔴 the smoke TRUSTS the attribute instead of deriving the verdict from the two facts "
        "it is made of — so one lost binding refuses four steps with a message saying the window is "
        "fine (found by 237's adversarial pass over its own diff)",
        [
            (
                SMOKE,
                "    whole: reach.hasOlder === 'false' && reach.atTail === 'true',",
                "    whole: reach.whole === 'true',",
            )
        ],
    ),
    (
        "M9  · ⚠️ the rows are counted by being `li` again — the empty state is one too, so a session "
        "with nothing in it refuses with “1 row(s) from ordinal 0” and misdescribes its own evidence",
        [
            (
                SMOKE,
                "      shown: log.querySelectorAll('li[data-type]').length,",
                "      shown: log.querySelectorAll('li').length,",
            )
        ],
    ),
    (
        "M10 · ⛔ step 19 concludes that the model never proposed a plan without asking whether the "
        "list it read was the whole session",
        [
            (
                SMOKE,
                '        await refuseIfLedgerWindowed(cdp, \'concluding that the model never proposed a plan\')\n',
                "",
            )
        ],
    ),
    # ---- §2 · the census's memory --------------------------------------------------------------
    (
        "M11 · ⛔ THE DEFECT one level up (230 H2) · `departed` is computed the wrong way round, so a "
        "step that LEFT the exposed list is invisible and one that stayed is reported as gone",
        [
            (
                CENSUS,
                "  const departed = published.filter((token) => !Object.hasOwn(exposedBy, token))",
                "  const departed = published.filter((token) => Object.hasOwn(exposedBy, token))",
            )
        ],
    ),
    (
        "M12 · ⛔ nothing is ever unexplained — the ledger becomes decoration and a departure needs no "
        "entry at all",
        [
            (
                CENSUS,
                "    unexplained: departed.filter((token) => !Object.hasOwn(departedBy, token)),",
                "    unexplained: [],",
            )
        ],
    ),
    (
        "M13 · ⚠️ the run stops PRINTING what left — the census keeps the number and no reader ever "
        "sees it, which is the trap this file's own docstring names",
        [
            (
                CENSUS,
                "    ` · ${n.departed.length} step(s) have left the exposed list they were frozen on` +",
                "    '' +",
            )
        ],
    ),
    (
        "M14 · 🔴 the frozen baseline is paired with a CALLER's inventory again — every synthetic "
        "classification in the suite reports all thirty as departed, and the arithmetic tests start "
        "measuring the real repository's history (found by 237's adversarial pass over its own diff)",
        [
            (
                CENSUS,
                "    classification.published ?? (classification.exposed === undefined ? EXPOSED_EVER : [])",
                "    classification.published ?? EXPOSED_EVER",
            )
        ],
    ),
    (
        "M15 · ⛔ a token nobody has classified answers `app` instead of throwing — the default that "
        "would raise the number this file exists to state, every time somebody wrote a new step",
        [
            (
                CENSUS,
                "  if (!census.includes(token)) {\n    throw new Error(",
                "  if (false) {\n    throw new Error(",
            )
        ],
    ),
    (
        "M16 · ⛔ the departure names a control that is not in the step — the reclassification moved a "
        "label and built nothing, which is 224 §4's list going back to being an intention",
        [
            (
                CENSUS,
                "    control: \"const reasoningEvents = (await ledgerRows(cdp, 'thinking')).length\",",
                '    control: "const reasoningEvents = 0",',
            )
        ],
    ),
    (
        "M17 · ⛔ the ledger says the step went somewhere it did not — `to: 'app'` while it sits in "
        "GUARDED, which is the silent improvement §2 exists to stop, one field over",
        [
            (
                CENSUS,
                "  7: {\n    at: '237',\n    to: 'guarded',",
                "  7: {\n    at: '237',\n    to: 'app',",
            )
        ],
    ),
    (
        "M18 · ⛔ the step 237 itself exposed is dropped from the frozen list, so it can leave again in "
        "silence — the residual named in §2, put back",
        [
            (
                CENSUS,
                "  '56', // 237 §3 — step 45's class: the live half holds only while the catalogue leaves haiku undescribed\n",
                "",
            )
        ],
    ),
    (
        "M19 · ⛔ the baseline is edited to match today — `7` removed, so the one real departure "
        "reports as none and the list goes on looking untouched",
        [
            (
                CENSUS,
                "  '6b',\n  '7',\n  '7e',",
                "  '6b',\n  '7e',",
            )
        ],
    ),
    (
        "M20 · ⚠️ a step may leave the census without being retired — the roster ratchet is released "
        "while the floor still reads 97",
        [
            (
                CENSUS,
                "  '11h',\n",
                "",
            )
        ],
    ),
    (
        "M35 · ⛔ the frozen list drifts to a SUBSET of today's exposed list — `69` is still exposed "
        "and in no baseline, so the ratchet quietly stops ratcheting on it and its departure would "
        "be free",
        [
            (
                CENSUS,
                "  '67',\n  '69',\n",
                "  '67',\n",
            )
        ],
    ),
    # ---- §3 · the reciprocal swap --------------------------------------------------------------
    (
        "M21 · ⚠️ step 7 falls out of GUARDED into the app default — the census counts a step that "
        "reports two unreached claims as one that can only go red for an app defect, and the ledger "
        "goes on saying it went to GUARDED",
        [
            (
                CENSUS,
                "  7: {\n    cause: 'provider',\n    why: '⛔ moved out of EXPOSED by 237 §4",
                "  '7zz': {\n    cause: 'provider',\n    why: '⛔ moved out of EXPOSED by 237 §4",
            )
        ],
    ),
    (
        "M22 · ⚠️ step 56 goes back to the app default — the catalogue-dependent half is counted as a "
        "step that can only go red for an app defect",
        [
            (
                CENSUS,
                "  56: {\n    cause: 'provider',\n    control: 'none',",
                "  '56zz': {\n    cause: 'provider',\n    control: 'none',",
            )
        ],
    ),
    # ---- §4 · step 7's reasoning shape ---------------------------------------------------------
    (
        "M23 · 🔴 THE DEFECT, verbatim (231/237 §4) · the ban is back — step 7 throws the moment a "
        "reasoning disclosure is on screen, which is the renderer doing the right thing",
        [
            (
                SMOKE,
                "    const withText = thinking.filter((block) => block.toggle !== null)\n    let opened = null",
                "    const withText = thinking.filter((block) => block.toggle !== null)\n"
                "    if (withText.length > 0) {\n"
                "      throw new Error(\n"
                "        `Claude is offering to expand thinking TEXT it does not have: ${JSON.stringify(withText)}`,\n"
                "      )\n"
                "    }\n"
                "    let opened = null",
            )
        ],
    ),
    (
        "M24 · ⛔ the two branches stop being checked for being exactly one — an entry drawing BOTH a "
        "pill and a disclosure, or neither, is the renderer having lost its v-if/v-else and passes",
        [
            (
                SMOKE,
                "    const bothOrNeither = thinking.filter(",
                "    const neverMind = thinking.filter(",
            )
        ],
    ),
    (
        "M25 · ⛔ the disclosure is never OPENED — the claim that an offer to expand has something "
        "behind it goes back to being made by banning the offer",
        [
            (
                SMOKE,
                "        entry?.querySelector('[data-cy=thinking-toggle]')?.click()\n        return true`)\n      opened = await waitFor(",
                "        return true`)\n      opened = await waitFor(",
            )
        ],
    ),
    (
        "M26 · ⚠️ 027's caption is read off a presentational class again, so a stylesheet rename reds "
        "the step with “the app misleads users about whose words these are”",
        [
            (
                SMOKE,
                "entry.querySelector('[data-cy=thinking-caption]')?.textContent",
                "entry.querySelector('.caption')?.textContent",
            )
        ],
    ),
    (
        "M27 · ⛔ the third reasoning state loses its own branch — a quiet turn prints “no reasoning "
        "this session” and “reasoning without words this run” side by side, in one report",
        [
            (
                SMOKE,
                "      thinking.length === 0\n        ? unasserted(\n            'and with no reasoning on screen at all there was no disclosure to open either — see ' +",
                "      false\n        ? unasserted(\n            'and with no reasoning on screen at all there was no disclosure to open either — see ' +",
            )
        ],
    ),
    # ---- §5 · 235's erasure marker -------------------------------------------------------------
    (
        "M28 · ⛔ THE DEFECT (235 §3) · the marker the smoke matches is not the one the runtime "
        "writes, so the control reports an all-clear it never checked",
        [
            (
                SMOKE,
                "  const marker = ' · degraded:'",
                "  const marker = ' · erased:'",
            )
        ],
    ),
    (
        "M29 · ⛔ an erasure that lost its own NAME stops counting — which is exactly the shape a "
        "`tool_call` whose `type` field was dropped arrives in",
        [
            (
                SMOKE,
                "      detail.endsWith(`${marker}<unnamed>`) ||\n",
                "",
            )
        ],
    ),
    (
        "M30 · ⚠️ the type-less form matches nothing — 235's note 4 (“was anything of ours erased at "
        "all”) becomes a filter on the string `undefined`",
        [
            (
                SMOKE,
                "      (type === undefined ? detail.includes(marker) : detail.endsWith(`${marker}${type}`)),",
                "      detail.endsWith(`${marker}${type}`),",
            )
        ],
    ),
    (
        "M31 · ⛔ step 19 blanks on a plan tool the WIRE erased — the silence is reported as the "
        "model's choice",
        [
            (
                SMOKE,
                "        await refuseIfFramesErased(cdp, \"this step's silence about the plan tool\")\n",
                "",
            )
        ],
    ),
    (
        "M32 · ⛔ step 68 blanks on a search or Bash frame the WIRE erased",
        [
            (
                SMOKE,
                "    await refuseIfFramesErased(cdp, \"this step's silence about search and Bash\")\n",
                "",
            )
        ],
    ),
    (
        "M33 · ⛔ step 7 blanks on reasoning the WIRE erased — the one absence site 237 §5's own "
        "instruction did not name, because 224's three are not the same three",
        [
            (
                SMOKE,
                "    await refuseIfFramesErased(cdp, 'concluding that Claude returned no reasoning', 'thinking')\n",
                "",
            )
        ],
    ),
    (
        "M34 · ⛔ step 12 stops reading the ledger for reasoning at all — `codexThinkingEvents` stays "
        "at zero, the control that makes its blank honest can never fire, and step 7's copy of the "
        "same line keeps the file-wide grep green",
        [
            (
                SMOKE,
                "      codexThinkingEvents += (await ledgerRows(cdp, 'thinking')).length\n",
                "",
            )
        ],
    ),
]


def apply(root: Path, index: int, dry: bool = False) -> int:
    """Apply one mutation. Returns the number of edits that did not apply cleanly."""
    _name, edits = MUTATIONS[index]
    name = _name.split(" ")[0]
    bad = 0
    for rel, find, replace in edits:
        path = root / rel
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
