#!/usr/bin/env python3
"""531 · Every assertion that reads text a browser clipped.

⛔ **The defect class, verbatim from `530` F1:**

> ⛔ **"`textContent` is identical whether a browser drew a string or clipped it, and every
> assertion this app makes about rail rows reads `textContent`."**

🔴 **`530` measured one row. `531` measured the whole dom project** — an instrumented run of all
117 suites — and found **84 distinct text carriers cut with no gesture that brings the rest back**,
only three of which put the whole string on a `title`. ⚑ At the
rail's two SHIPPED widths (208 px / 220 px), three of them were sentences somebody wrote to be
read:

| the sentence | ink | column @208 | cut by |
|---|---:|---:|---:|
| *Dashboard across active projects* | 147 px | **94 px** | 56 px |
| *Conversations from here, and from Claude's and Codex's own folders* | 308 px | 131 px | 182 px |
| *Agents may create conversations. Press to stop that.* | 231 px | 131 px | 105 px |

⚠️ **The columns differ**, and the first draft of this table said 131 px for all three: Home's row
puts a `soon` chip in `.rail-item`'s third grid track, so its copy column is **94 px**. Found in
review.

⚠️ **Two of the three were asserted nowhere at all** — grep `test/` for *Dashboard across active
projects* and the only hit is `531`'s own suite — and four suites mount this rail and assert
`scrollWidth <= clientWidth` on the rail's own box, which fitted, because an ellipsized child does
not widen its parent. ⛔ **Containing it is what `overflow: hidden` is FOR**, so a fit assertion aimed at a
container can never see a string inside it.

## ⚑ Why half the rows below are declarations

**The repair is a class and three `:title`s, and the rule lives in the declarations.** `530`
established the discriminant on this same component one dispatch earlier — *a line with nothing
under it in its row may wrap; a line whose neighbours must stay in the row may not* — so these
three sentences wrap and clamp while the status line above them still does not. ⛔ **A rule a
declaration carries is a rule a mutation has to be able to break**
(`a-line-no-mutation-can-kill-is-not-carrying-its-rule`).

## ⛔ What this table does NOT cover

 1. **The sensor itself.** `test/dom/drawn.ts` is a test module; mutations are for product code.
    Its three separations are proven in `every-string-a-rail-row-does-not-draw.dom.test.ts` §0, by
    planting each case and by planting one that must NOT match.
 2. **The other 84 carriers.** They are ranked in `531`'s response and in the ledger
    `test/every-assertion-that-reads-clipped-text.test.ts` holds; none is repaired here.
 3. **The eleven suites of twelve that mount this rail at 200 px, 240 px or 320 px** — widths the
    app never draws (`531` F5). Pinned by that ledger's §3, repaired by nobody yet.
"""

from pathlib import Path

RAIL = "apps/desktop/src/renderer/src/components/SideRail.vue"

HOME = '            <small class="says" title="Dashboard across active projects"\n'
SPAWN = '          <small class="says" data-cy="rail-spawning-line" :title="safety.view.value.line">{{\n'

# (name, [(file, old, new), ...])
MUTATIONS = [
    # ---- the three sentences, each put back the way a person actually read it ---------------------
    (
        "M1 · 🔴 THE SHIPPED DEFECT, PUT BACK · the switch's own line loses the class, so "
        "*Agents may create conversations. Press to stop that.* goes back to one `nowrap` line in a "
        "131 px column and a person reads *Agents may create conv…* — the half that names the STATE "
        "and not the GESTURE, on the one control in this app whose job is to be pressed in a hurry",
        [
            (
                RAIL,
                SPAWN,
                '          <small data-cy="rail-spawning-line" :title="safety.view.value.line">{{\n',
            )
        ],
    ),
    (
        "M2 · ⛔ …and the first sentence a person meets in this app goes with it · Home's subtitle "
        "reverts to *Dashboard across active pro…* in a 94 px column — the narrowest in the rail, "
        "because that row's third grid track holds the `soon` chip",
        [(RAIL, HOME, '            <small title="Dashboard across active projects"\n')],
    ),
    (
        "M3 · ⛔ …and so does the sentence `153` and `154` both spent a ticket writing · "
        "*Conversations from here, and f…*, which is 40% of an explanation that exists because a "
        "user could not work out what the page behind the link was",
        [
            (
                RAIL,
                # The approved subtitle changed and formatting compacted the tag; the plant still removes wrapping from its explanation.
                "            <small class=\"says\" title=\"Includes chats from Claude and Codex on this computer.\"\n",
                "            <small title=\"Includes chats from Claude and Codex on this computer.\"\n",
            )
        ],
    ),
    # ---- the recovery, which is what makes a clamp a decision rather than a loss ------------------
    (
        "M4 · ⚠️ the switch's line is clamped and the whole of it is nowhere · a sentence that "
        "grows past three lines is then simply gone, which is the state `531` found and the reason "
        "the clamp needed a hatch beside it",
        [(RAIL, ' :title="safety.view.value.line"', "")],
    ),
    (
        "M5 · ⚠️ …and the title says something else · a tooltip that paraphrases the line under it "
        "is a second copy of a string, which is the shape `485` and `530` both removed from this "
        "component",
        [
            (
                RAIL,
                ':title="safety.view.value.line">{{\n',
                ':title="safety.view.value.heading">{{\n',
            )
        ],
    ),
    # ---- the four declarations that make the clamp a clamp ----------------------------------------
    #
    # ⚑ **Each is here because `a-line-no-mutation-can-kill-is-not-carrying-its-rule`.** Three of
    # the four look like boilerplate around `-webkit-line-clamp`; every one is load-bearing.
    (
        "M6 · ⛔ the wrap goes · `white-space: normal` is what lets the sentence use a second line "
        "at all, so the element inherits `nowrap` from the rule above and all three sentences "
        "ellipsize again with the class still on them. ⚠️ The repair is not the class"
        ". 🔴 **570 · the box is no longer SHARED, and this row got its own subject back.** ⛔ `531` relay 1 folded it with `530`'s `.grant` because two classes needed one box; `EXT-008` §4.4 took the AGENTS section out of the rail, `.grant` left this file with the element that wore it, and `570` wrote the one-member rule back into `.rail-copy small.says`. ⚑ **So this edit now breaks exactly the three sentences `531` is about**, which is what it was written to do. ⚠️ `530 M8` still sits on this anchor and is still an equivalent mutant of it — the base `.rail-copy small` rule already declares `nowrap` — and both are kept because each table is scored on its own run. ⛔ **The clause about `531 M12`/`M13` putting an asymmetry back is withdrawn**: both were retired at `570`, there being no list left to take a member out of. · killed by `every-string-a-rail-row-does-not-draw.dom.test.ts`",
        # ⚑ **W4.205 · re-anchored in place, not retired** — W4.205 · 2ca719c5 added a second `white-space: normal;` (`.rail-copy strong`); widened to the `.rail-copy small.says` rule. Killed by every-string-a-rail-row-does-not-draw.dom.test.ts 'is drawn whole' — but that file's clamp pin is red on HEAD (see M9).
        [(RAIL, ".rail-copy small.says {\n  display: -webkit-box;\n  white-space: normal;\n", ".rail-copy small.says {\n  display: -webkit-box;\n")],
    ),
    (
        "M7 · ⚠️ the box goes · the element falls back to `display: block`, `-webkit-line-clamp` "
        "binds to nothing, and a sentence somebody lengthens can grow the rail without limit"
        ". 🔴 **570 · see `M6` above** — the box is a one-member rule again and this edit breaks the three sentences `531` owns. ⛔ `530 M14` is the same edit in the other table, kept for the bookkeeping reason, and the withdrawn `531 M12`/`M13` clause is gone with those rows. · killed by `every-string-a-rail-row-does-not-draw.dom.test.ts`",
        # ⚑ **W4.205 · re-anchored in place, not retired** — W4.205 · the rail titles now clamp with their own display: -webkit-box line, so the anchor is widened to the explanatory-copy rule; the plant still drops the box and leaves the four-line clamp bound to nothing
        [(RAIL, ".rail-copy small.says {\n  display: -webkit-box;\n", ".rail-copy small.says {\n")],
    ),
    (
        "M8 · ⚠️ the box orients the other way · the clamp counts COLUMNS instead of lines, so it "
        "stops bounding the height. ⛔ The vendor pair is a pair"
        ". 🔴 **570 · see `M6`** — one-member rule, three sentences, `530 M15` the same edit in the other table. · killed by `every-string-a-rail-row-does-not-draw.dom.test.ts`",
        # ⚑ **W4.205 · re-anchored in place, not retired** — W4.205 · the rail titles now clamp with their own -webkit-box-orient line, so the anchor is widened to the explanatory-copy rule; the plant still turns the box sideways so the four-line clamp stops bounding the height
        [(RAIL, ".rail-copy small.says {\n  display: -webkit-box;\n  white-space: normal;\n  -webkit-box-orient: vertical;\n", ".rail-copy small.says {\n  display: -webkit-box;\n  white-space: normal;\n  -webkit-box-orient: horizontal;\n")],
    ),
    (
        "M9 · 🔴 the clamp is one line short · three is DERIVED — the longest of the three "
        "sentences is 308 px of ink in a 131 px column, which is 2.35 lines — so two cuts the "
        "sentence `153` wrote and leaves the other two whole. ⛔ A number chosen instead of "
        "measured is a number that is wrong for one row and right for the rest · killed by `every-string-a-rail-row-does-not-draw.dom.test.ts`",
        # ⚑ **W4.205 · re-anchored in place, not retired** — W4.205 · 2ca719c5 raised the clamp 3 → 4 because 12px captions need four lines for the folder sentence; one line short is now 3. ⚠️ every-string-a-rail-row-does-not-draw.dom.test.ts still pins webkitLineClamp '3' and clientHeight <= 3 lines, so it is red on HEAD; once it reads 4, its pin and the 'is drawn whole' tests kill this.
        [(RAIL, "  -webkit-line-clamp: 4;\n", "  -webkit-line-clamp: 3;\n")],
    ),
    (
        "M10 · ⛔ the RULE loses its element · it is written and nothing wears it — "
        "`scoped-css-is-unmeasurable-until-something-mounts-it`. "
        "🔴 **570 · this description has now been wrong in BOTH directions and is corrected a "
        "second time.** ⛔ Before `531` relay 1 it said *every declaration above*; the relay "
        "folded the box out into a shared `:is()` rule and narrowed it to *the BOUND and not the "
        "wrap*; `570` removed `.grant` from this file and wrote the box back in, so the rule "
        "holds all FOUR declarations again and the mutant makes the wrap inert as well. ⚠️ **What "
        "it does now**: the three sentences fall back to the base rule\'s `nowrap` and ellipsize "
        "— the row stops growing with its text rather than growing without a bound, the opposite "
        "outcome from the one the middle version of this sentence claimed.** ⚑ Killed by "
        "`every-string-a-rail-row-does-not-draw.dom.test.ts` §2 (*a sentence six times as long leaves "
        "the row height where it was*), confirmed by hand at the relay "
        "⚑ ANCHOR CORRECTED IN PLACE BY 531 relay 1",
        [(RAIL, ".rail-copy small.says {\n", ".rail-copy small.saysnothing {\n")],
    ),
    # ---- and the rule the repair had to leave standing --------------------------------------------
    (
        "M11 · ⚠️ the wrap spreads to every line in a rail row · `449`'s rule goes with it: a "
        "status line that wraps pushes the word saying whether the conversation is waiting on you "
        "out of the row. ⛔ `531` repaired three sentences, not a component. "
        "🔴 **RE-POINTED AT THE SHARED RULE, and the old anchor was MEASURED SURVIVING** (`531` relay "
        "1): before the fold this row widened the block that carried the wrap; after it, the same "
        "anchor widened a block holding only `-webkit-line-clamp: 3`, and a clamp without "
        "`display: -webkit-box` binds to nothing — so the edit changed the stylesheet and changed "
        "NOTHING a browser draws. ⛔ **Applied alone it survived both killer suites**, which is "
        "`a-mutation-that-changes-nothing-reports-as-a-survivor` arriving from a repair rather than "
        "from a bad row. ⚑ The anchor is now the rule the wrap actually lives in, and it is RED again "
        "⚑ ANCHOR CORRECTED IN PLACE BY 531 relay 1",
        # 🔴 **570 · CORRECTED IN PLACE, and this is the second time this row has followed its
        # rule.** ⛔ `EXT-008` §4.4 took the AGENTS section out of the navigation column, so
        # `.grant` left this file with the element that wore it and a one-member `:is()` is
        # written as one selector. ⚑ **The subject is unchanged** — the block that carries the
        # wrap — and widening it to every `small` still puts `449`'s status line into a wrapping
        # row, which is what this row has always measured. ⚠️ Re-verified RED by hand at `570`.
        [(RAIL, ".rail-copy small.says {\n", ".rail-copy small {\n")],
    ),
    # ---- and the two the FOLD owes, because a fold can quietly merge two rules into one ----------
    #
    # ⛔ **Before `531` relay 1, `530 M8/M14/M15` broke the box for `.grant` alone and `M6/M7/M8`
    # above broke it for `.says` alone — six rows carrying two independent propositions.** ⚠️ After
    # the fold all six edit one shared rule and every one of them breaks both classes, so the
    # asymmetry stopped being measured by anything. ⚑ **These two put it back**, and they are the
    # only rows in either table that can: the member list is the one token that still tells the two
    # classes apart. 🔴 **Measured at the relay, and the pair is NOT symmetric**: `M13` is red on
    # `531`'s suite and GREEN on `530`'s, which is the one-sided verdict that shows the classes are
    # still separable. ⛔ **`M12` is red on both, and not because the fold merged the two rules** —
    # `531` §1 sweeps the WHOLE rail and reports any new cut in it, including one on a row `531` does
    # not own, so that file goes red for anything that shortens anything. ⚠️ The asymmetry lives in
    # `M13`; `M12`'s value is that it breaks the box for `.grant` ALONE in the rendered page, which
    # the sweep's own output names row by row.
    (
        "M12 · 🔴 **RETIRED AT 570 — `anchor-absent`, and the SUBJECT IS GONE rather than moved.** "
        "⛔ This row and `M13` exist only because the box was SHARED: each takes ONE member out of "
        "the `:is()` list, so the rule breaks for one class at a time and the fold is proved not "
        "to have merged two propositions into one. ⚑ `EXT-008` §4.4 took the AGENTS section out "
        "of the navigation column, `.grant` left this file with the element that wore it, and "
        "**a one-member list cannot have a member taken out of it** — every remaining edit to "
        "that selector is *the rule matches nothing*, which is `M10`. ⚠️ **There is no asymmetry "
        "left to measure**, so this is a retirement and not a correction. ⛔ It read: the grant "
        "pair falls out of the shared box · `.grant` stops matching the rule that "
        "carries `display: -webkit-box`, so `530`'s two grant lines go back to one `nowrap` line "
        "ellipsizing at *May start conversations as…* while `531`'s three sentences keep wrapping. "
        "⚑ **This is `530` F1 put back by the FOLD rather than by `530`'s own class.** ⚠️ Measured "
        "at the relay: RED on both suites — `530`'s on the grant pair, and `531`'s because its §1 "
        "roster sweeps the whole rail and any new cut anywhere in it is undeclared. ⛔ **That is not "
        "the fold merging two rules**; the one-sided proof is `M13`",
        [
            (
                RAIL,
                ".rail-copy small:is(.grant, .says) {\n",
                ".rail-copy small:is(.says) {\n",
            )
        ],
    ),
    (
        "M13 · 🔴 **RETIRED AT 570 with `M12`, and for the same reason.** ⛔ With `.grant` gone "
        "from this file the edit makes the rule match nothing at all, which is exactly `M10`'s "
        "mutant — and two rows with one mutant measure one thing while reporting two. ⚠️ It "
        "read: …and the other way · `.says` stops matching it, so the three sentences ellipsize "
        "again — *Dashboard across active pro…* — while `530`'s grant pair keeps wrapping. ⚑ The "
        "pair of this row and `M12` is the whole guarantee that one rule is still serving two "
        "decisions rather than one. 🔴 **Measured at the relay: RED on `531`'s suite and GREEN on "
        "`530`'s** — the only one-sided verdict either table produces, and the thing that would stop "
        "being true if the fold had collapsed the two propositions into one",
        [
            (
                RAIL,
                ".rail-copy small:is(.grant, .says) {\n",
                ".rail-copy small:is(.grant) {\n",
            )
        ],
    ),
]


def apply(root: Path, index: int, dry: bool) -> int:
    """Apply one mutation. Returns the number of anchors that were not found exactly once."""
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
