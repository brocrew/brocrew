#!/usr/bin/env python3
"""526's mutation table — each row is THE DEFECT, put back verbatim (131).

⛔ **`525` measured the Events tab at 3.72 screens, 241 text elements and 7.5 px for every single
one of them.** `--text-6xs`'s own line in `tokens.css` says what it is for — *tiny uppercase field
labels* — over a scale whose §9 says *"Most product text lives at 9–12px; sizes < 9px are
micro-labels/badges/table-heads only."* One tab broke that contract 241 times, and the loudest
breach was a 298-character explanation standing over the list on every visit.

## ⚑ What this dispatch actually changed, because the rows are about the shape

**Nothing in `tokens.css`.** ⛔ Not one token value moved. What moved is which ROLE a piece of text
plays and which existing token that role takes — `lib/raw-stream-roles.ts`, whose token map `529`
lifted into `lib/text-roles.ts` when two more tabs needed it — plus two things that made the sizes
affordable:

 1. ⚑ **The head split into a FACT and an EXPLANATION.** The count and `237 §1`'s reach sentence
    stay on the visible line; the paragraph explaining what a raw event is sits behind a `.why`
    disclosure, shut by default — `SessionInfo`'s gesture, copied as declarations.
    🔴 **Neither fact may ever go inside it**: `scripts/ui-live-smoke.mjs` refuses a run whose
    `[data-cy=event-log-reach]` does not say *whole ledger* in words, and a fold that could swallow
    it would be `237`'s defect rebuilt as a gesture.
 2. ⚑ **`ROLE_SIZE` reaches the stylesheet as four custom properties.** `EventStream.vue` binds
    `--role-prose`/`--role-label`/`--role-value`/`--role-meta` onto its own root from the module
    (`ROLE_PROPERTIES`, in `text-roles.ts` since 529),
    and every rule names a ROLE rather than a size — so which token a role takes is stated once.
    ⛔ **The first draft did not do this and the module's own `169` docblock was false as
    shipped**; the adversarial pass over this diff found it. ⚠️ What is still in two places is
    which ROLE an element has — the selector in the stylesheet and the selector in the roster —
    and the test is what binds them.
 3. ⚑ **The row's line box became a fixed LENGTH** — `--row-line`, `--leading-tight` of
    `--text-xs` = 12 px — so a row costs 33 px whatever size the text inside it is. ⛔ That is what
    let the type go 7.5 → 10.5 px and the detail 7.5 → 9 px while the tab got SHORTER: 3.72 screens
    → **3.41**, measured with `525`'s method on `525`'s fixture, before and after.

⚠️ **Chromium lays out in 1/64 px**: line boxes round to the nearest unit and a `height` floors to
one. A unitless leading over two different font sizes produced two independently-rounded boxes
whose sum `--row-px` could not name — measured at 0.015625 px a row, 78 px of lie over a full
window, and `measureRow`'s 0.25 px tolerance is deliberately too loose to correct it. The fixed
length is what makes the `calc()` true, and `event-fold.dom.test.ts` is what makes that a fact.

## ⛔ What kills each row

Unless a row says otherwise its killer is
`apps/desktop/test/dom/the-tab-with-241-things.dom.test.ts`, which mounts the real `SessionDrawer`
at 368×1000 in Chromium and asks the ENGINE, per element, what size it came out at — never the
stylesheet's source. (`389`: six `SessionShelf` cells, one `toContain`, and the mutation on the
fifth survived on its three neighbours. `373`: a census that pins the text of the
lines it censuses reddens through the census rather than through the behaviour.)

 * `M1`-`M7`   🔴 **the ROLE ASSIGNMENT** — each of the tab's kinds of text given the wrong role,
                which under the bridge below is the only way an element can end up at the wrong
                size. `M1` is the 525 defect itself: prose at the micro role, at the head of the
                tab. ⚑ **They name roles and not tokens, because the stylesheet does** — see the
                bridge note above.
 * `M8`-`M12`  ⛔ **the roster and the token map** — the two ways a roster lies (an element in no
                role, and roles that are not a scale), plus the two rows that move a TOKEN rather
                than an assignment: `M10` and `M12` edit `ROLE_SIZE` itself, which is the one place
                a size is chosen and therefore the one place a whole role can drift at once.
 * `M13`-`M17` 🔴 **the disclosure** — the four ways a fold can swallow something it must not, plus
                the state it opens in.
 * `M18`-`M21` ⛔ **the geometry** — the row height is the budget, and five thousand folded rows
                are sized from its arithmetic.
 * `M22`        ⛔ **the roster's sixth row**, filed here because `.empty` needs its own mount.
 * `M23`-`M24` ⚑ **the tooltip** — the only route to the half of a detail that does not fit, and
                the price that keeps it off the hot path.
 * `M25`-`M26` 🔴 **the token map and the bridge** — the two edits that move a whole ROLE at once,
                and the two the first draft of this table could not see. ⛔ `M25` is `525`'s exact
                defect on 75 elements and **every assertion in the repo passed it**, because they
                all read `ROLE_SIZE` to decide what `ROLE_SIZE` should be.

⚠️ **The table is NOT RUN.** Every row was applied ALONE, watched red against its killer and
restored from bytes with a SHA-256 re-check — `verify-each-mutation-row-without-running-the-table`.
The seat that runs tables is the PM's.

⛔ **And one row that is NOT here.** `526` made the drawn row 33 px — a whole number — which
disarmed `255 M5` (`getBoundingClientRect` → `offsetHeight`): at 35.5 px the two readings differed
and at 33 px they agree, so the mutation became a no-op. ⚑ That is *a comparison tested where both
sides agree measures nothing*, and standing rule 3's answer is coverage where they DIVERGE, not a
retired row — `event-fold.dom.test.ts` now plants a fractional row and watches the write-back keep
its fraction. `255 M5` was re-run alone against it and reddens.
"""

from pathlib import Path

STREAM = "apps/desktop/src/renderer/src/components/EventStream.vue"
ROLES = "apps/desktop/src/renderer/src/lib/raw-stream-roles.ts"
# ⚑ **529 lifted the five-role vocabulary out of `raw-stream-roles.ts`** so a second and a third
# tab could read it without a second copy of the map. ⛔ The rows below that anchor inside
# `ROLE_SIZE` / `ROLE_ORDER` were RE-ANCHORED onto the new path rather than retired — a row that
# stops counting is a row that stops measuring (`HO-050` §3), and each killer is unchanged.
# ⚠️ **Re-anchoring changes a row's DEFINITION, so any recorded verdict would stop being earned**
# (`a-corrected-anchor-keeps-a-verdict-it-never-earned`). ⚑ This table has none — it is `unrun`
# in `CENSUS.md` — so nothing was invalidated; instead each moved row was verified BY HAND after
# the move: 526 M10/M11/M12/M25/M26/M27 applied alone, watched RED against its killer, and restored
# from bytes with a SHA-256 re-check.
VOCAB = "apps/desktop/src/renderer/src/lib/text-roles.ts"

# (name, [(file, old, new), ...])
MUTATIONS = [
    # ---- the roles --------------------------------------------------------------------------------
    (
        "M1 · 🔴 525'S DEFECT, PUT BACK AT THE HEAD OF THE TAB · the count and the reach sentence take "
        "the MICRO role — the two facts a reader needs before they read anything else, at the size "
        "the scale reserves for a tiny uppercase field label",
        [
            (
                STREAM,
                "  color: var(--faint);\n  font-size: var(--role-prose);\n  line-height: var(--leading-normal);\n}\n\n.stream-note strong {",
                "  color: var(--faint);\n  font-size: var(--role-meta);\n  line-height: var(--leading-normal);\n}\n\n.stream-note strong {",
            )
        ],
    ),
    (
        "M2 · 🔴 every row's detail takes the MICRO role · this is 90 of the 241 things `525` measured, "
        "and the one that carries what the event actually said",
        [(STREAM, "  color: var(--faint);\n  font-size: var(--role-value);\n  text-overflow: ellipsis;", "  color: var(--faint);\n  font-size: var(--role-meta);\n  text-overflow: ellipsis;")],
    ),
    (
        "M3 · 🔴 the event's NAME takes the MICRO role · the scan target of a ledger of thousands, "
        "drawn at the size the scale reserves for a clock",
        [(STREAM, "  color: var(--mono-text);\n  font-size: var(--role-label);\n  text-overflow: ellipsis;", "  color: var(--mono-text);\n  font-size: var(--role-meta);\n  text-overflow: ellipsis;")],
    ),
    (
        "M4 · ⛔ the clock leaves its role · it is the ONE thing on this tab the micro end of the "
        "scale is for, and a row that names a token it is not on is a roster that means nothing",
        [(STREAM, "  flex: none;\n  color: var(--faint);\n  font-size: var(--role-meta);", "  flex: none;\n  color: var(--faint);\n  font-size: var(--role-label);")],
    ),
    (
        "M5 · ⛔ the explanation is a field label · the one reading block on the tab takes the MICRO "
        "role, which is roughly the size it was standing over the list at before anything folded",
        [
            (
                STREAM,
                # ⚑ **theme host · re-anchored in place, not retired** — NOT VERIFIED. Theme border widths now use tokens; the same defect retains all other declarations.
                ".stream-explain {\n  margin: 0;\n  padding: var(--space-4) var(--space-7);\n  border-bottom: var(--border-width) solid var(--line);\n  color: var(--faint);\n  font-size: var(--role-prose);",
                ".stream-explain {\n  margin: 0;\n  padding: var(--space-4) var(--space-7);\n  border-bottom: var(--border-width) solid var(--line);\n  color: var(--faint);\n  font-size: var(--role-meta);",
            )
        ],
    ),
    (
        "M6 · ⛔ the disclosure's own caption takes the MICRO role · a control nobody can read is a "
        "control nobody presses, and this one is the only way to the explanation",
        [(STREAM, "  font-family: var(--font-sans);\n  font-size: var(--role-label);\n  gap: var(--space-2);", "  font-family: var(--font-sans);\n  font-size: var(--role-meta);\n  gap: var(--space-2);")],
    ),
    (
        "M7 · ⛔ the empty tab's one sentence takes the MICRO role · the whole of what this surface "
        "says when there is nothing in it, at a clock's size",
        [(STREAM, "  font-family: var(--font-sans);\n  font-size: var(--role-prose);\n}", "  font-family: var(--font-sans);\n  font-size: var(--role-meta);\n}")],
    ),
    # ---- the roster as a census -------------------------------------------------------------------
    (
        "M8 · 🔴 the roster stops covering the clock · an element on the tab that no role names, "
        "which is the hole a roster exists to close — 241 things were once exactly that",
        [(ROLES, "  { selector: '.rts', role: 'meta', what: 'the clock time, repeated on every row' },\n", "")],
    ),
    (
        "M9 · ⛔ the inline emphases fall out of the roster · `<code>` inside the explanation owns "
        "text and would be in no role — the correction the completeness walk forced in the first "
        "place",
        [
            (
                ROLES,
                "    selector: '[data-cy=\"event-log-explanation\"] code',",
                "    selector: '[data-cy=\"event-log-explanation\"] pre',",
            )
        ],
    ),
    (
        "M10 · ⛔ two roles collapse onto one token · a roster whose roles all name one size passes "
        "every per-element equality for the wrong reason — 389's four shelf cells, as a scale",
        [(VOCAB, "  value: '--text-3xs',", "  value: '--text-sm',")],
    ),
    (
        "M11 · ⛔ the scale is not a scale · a timestamp is declared louder than what the event "
        "SAID, and nothing about the four tokens themselves has changed",
        [(VOCAB, "export const ROLE_ORDER: readonly TextRole[] = ['prose', 'label', 'value', 'meta', 'field']", "export const ROLE_ORDER: readonly TextRole[] = ['prose', 'label', 'meta', 'value', 'field']")],
    ),
    (
        "M12 · ⛔ prose leaves the reading size · the role that exists to take one, taking the "
        "default UI label instead — and the body default is 11.5 px, so this is the mutation a "
        "test that compared against the inherited value could not see",
        [(VOCAB, "  prose: '--text-base',", "  prose: '--text-sm',")],
    ),
    # ---- the disclosure ---------------------------------------------------------------------------
    (
        "M13 · 🔴 237 §1'S DEFECT, REBUILT AS A GESTURE · the reach sentence moves inside the fold, "
        "so whether this is the whole ledger or a window onto it is a thing you have to press for "
        "— and `ui-live-smoke.mjs` refuses the run on a screen that does not say it",
        [
            (
                STREAM,
                '      <span data-cy="event-log-reach">{{ reach }}</span>\n      <button',
                '      <button',
            ),
            (
                STREAM,
                "      Raw normalized <code>RuntimeEvent</code>s, unfiltered and in arrival order with the host's",
                '      <span data-cy="event-log-reach">{{ reach }}</span>\n      Raw normalized <code>RuntimeEvent</code>s, unfiltered and in arrival order with the host\'s',
            ),
        ],
    ),
    (
        "M14 · ⛔ the explanation ships open · the four lines are back over the list on every visit, "
        "the viewport loses what the fold bought it, and the tab is taller than `525` measured it",
        [(STREAM, '      v-show="explained"', "      v-show=\"true\"")],
    ),
    (
        "M15 · ⛔ the fold removes rather than hides · `v-if`, so the words are not in the "
        "server-rendered markup at all and every reader that asks the DOM rather than the screen "
        "loses them",
        [(STREAM, '      v-show="explained"', '      v-if="explained"')],
    ),
    (
        "M16 · ⛔ the disclosure ships OPEN by state · the drawer's rule is that every disclosure "
        "starts closed, and this is the one whose whole purpose is to not be standing there",
        [(STREAM, "const explained = ref(false)", "const explained = ref(true)")],
    ),
    (
        "M17 · ⛔ the trigger stops saying which way it is facing · `aria-expanded` is the only "
        "thing that tells a reader who cannot see the chevron whether the block is open",
        [(STREAM, '        :aria-expanded="explained"\n', "")],
    ),
    # ---- the geometry -----------------------------------------------------------------------------
    # ⛔ **The replacement is 9.5 px and not the unitless ratio, and the difference is the whole
    # point of the row.** ⚠️ `--row-line: var(--leading-tight)` makes `--row-px` a `<number> +
    # <length>`, which is invalid at computed-value time — the folded row collapses to ~9 px,
    # `measureRow` sees a 23 px gap and DOES write back, and the row dies on the assertion whose
    # failure its own text denies. ⚑ `--leading-tight × --text-2xs` = 11.4 px is exact in neither
    # direction: each line box rounds to 730/64 and `height: 31.8px` floors to 2035/64, leaving
    # **0.015625 px a row — one layout unit, under `measureRow`'s 0.25 px tolerance**, so nothing
    # is written back and only the 5,000-row sum can see it. That is the defect, reproduced.
    (
        "M18 · 🔴 the line box stops landing on a whole layout unit · each of a row's two boxes "
        "rounds to a different 1/64th and `--row-px` names neither, so five thousand folded rows "
        "are each 0.015625 px wrong — UNDER `measureRow`'s 0.25 px tolerance, so nothing is "
        "written back, nothing is logged, and only a sum over the whole window can see it · killed by `event-fold.dom.test.ts`",
        [
            (
                STREAM,
                # ⚑ **W4.205 · re-anchored in place, not retired** — W4.205 · The old plant swapped --text-xs for --text-2xs, but since 2ca719c5 both alias --type-caption (12px), and 602e204e wrapped the line box in round(nearest, ..., 1px), so the anchor is gone and that swap would change nothing. The plant drops the rounding: 1.2 x 12px = 14.4px, each line box rounds to 922/64 while --row-px (37.8px) floors to 2419/64, so a drawn row is 2420/64 and every folded row is 0.015625px short, under measureRow's 0.25px tolerance. Over 5000 rows that is 78px, which event-fold.dom.test.ts 'the scrollbar measures the whole window' catches (bound 1px).
                # ⚑ **token plumbing · re-anchored in place, not retired** — NOT VERIFIED. The token codemod rewrote this line to read tokens; the replacement is unchanged and makes the same defect.
                "  --row-line: round(nearest, calc(var(--leading-tight) * var(--type-caption)), 1px);",
                "  --row-line: calc(var(--leading-tight) * var(--text-xs));",
            )
        ],
    ),
    # ⛔ **This row used to drop the padding term from `--row-px` — the SAME anchor and the SAME
    # killer as `255 M8`, which 526 had just re-pointed at that line.** A row that measures nothing
    # its neighbour does not is a row that measures nothing. ⚑ Replaced with the thing round two
    # actually added and nothing was mutating: the bridge itself.
    (
        "M19 · 🔴 THE BRIDGE GOES · the panel stops carrying the four role properties, so every "
        "rule that names one falls back to whatever it inherits — and `prose` inherits `body`'s "
        "`--text-base`, which is the right answer for the wrong reason, so three of the four roles "
        "look correct while the module decides nothing at all",
        [(STREAM, '  <div class="event-stream" :style="ROLE_PROPERTIES" data-cy="event-stream">', '  <div class="event-stream" data-cy="event-stream">')],
    ),
    (
        "M20 · ⛔ the row's padding grows back · the type and the detail keep their new sizes and "
        "the tab costs more scroll than it did at 7.5 px — the trade the brief forbids",
        [(STREAM, "  display: block;\n  padding: var(--space-2) var(--space-6);", "  display: block;\n  padding: var(--space-3) var(--space-6);")],
    ),
    (
        "M21 · ⛔ a detail is allowed to wrap · a row whose height depends on what is in it, which "
        "is the one thing `--row-px` cannot be a `calc()` for",
        [
            (
                STREAM,
                "  font-size: var(--role-value);\n  text-overflow: ellipsis;\n  white-space: nowrap;",
                "  font-size: var(--role-value);\n  text-overflow: ellipsis;",
            )
        ],
    ),
    # ⚑ **`align-items: baseline` is NOT a row here, and that is a measurement.** It was written as
    # one and it SURVIVED: once both children inherit one line-height LENGTH, Chromium's flex
    # baseline arithmetic lands on exactly that length, so `center` and `baseline` measure
    # identically at 33 px. ⛔ A row whose replacement changes nothing reports as a survivor and
    # measures nothing — so the claim was withdrawn from the stylesheet's comment instead of being
    # dressed as coverage.
    (
        "M22 · ⛔ the roster drops the one ENTRY a populated tab never draws · `.empty` only renders "
        "over a window with nothing in it, so it is what a census written against the screen in "
        "front of it loses first. ⚠️ Its ROLE is `prose`, which a populated tab draws three times "
        "— the entry is the thing that is invisible, not the role",
        [
            (
                ROLES,
                "  {\n    selector: '.empty',\n    role: 'prose',\n    what: 'the whole of what the tab says when there is nothing in it',\n  },\n",
                "",
            )
        ],
    ),
    # ---- the tooltip ------------------------------------------------------------------------------
    (
        "M23 · ⛔ the truncated half becomes unreachable again · roughly half of `describeEvent`'s "
        "50 arms overflow this column, about a dozen of them whatever they carry, and there is no "
        "tooltip, no copy and no second surface — a folded row's text cannot even be selected",
        [(STREAM, '<span class="rdetail" :title="row.detail">{{ row.detail }}</span>', '<span class="rdetail">{{ row.detail }}</span>')],
    ),
    (
        "M24 · ⛔ the tooltip goes onto the folded branch too · an attribute on all five thousand "
        "rows, on the append path `263` measured at 9-10 ms an event, to serve rows the engine is "
        "not rendering and a pointer cannot reach",
        [(STREAM, '<span v-else class="rdetail">{{ row.detail }}</span>', '<span v-else class="rdetail" :title="row.detail">{{ row.detail }}</span>')],
    ),
    # ---- the token map, where a whole role can drift at once ----------------------------------------
    (
        "M25 · 🔴 525'S DEFECT, EXACTLY, ON SEVENTY-FIVE ELEMENTS · the clock's role takes "
        "`--text-6xs` — the token `525` measured the whole tab at. ⛔ It is the one role with no "
        "collision below it: every per-element assertion reads the same map, the 9 px floor "
        "EXEMPTS meta, and distinctness and descent both still hold. Nothing in this repo caught "
        "it until 526's own review did, and the floors in `§2` are the answer",
        [(VOCAB, "  meta: '--text-5xs',", "  meta: '--text-6xs',")],
    ),
    (
        "M26 · ⛔ one bridge key points at the wrong role · `--role-value` is fed `meta`'s token, "
        "so every detail on the tab reads at the clock's size while the module, the roster and the "
        "stylesheet all still say `value`",
        [(VOCAB, "  '--role-value': `var(${ROLE_SIZE.value})`,", "  '--role-value': `var(${ROLE_SIZE.meta})`,")],
    ),
    (
        "M27 · ⛔ the LABEL role drifts down · the event's own name — the thing a reader scans a "
        "ledger of thousands for — put back below the floor `tokens.css` §9 declares, which is "
        "where 525 found it. ⚑ It is here so that all four roles have a downward row, not only "
        "the two the first draft of this table happened to move",
        [(VOCAB, "  label: '--text-sm',", "  label: '--text-6xs',")],
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
