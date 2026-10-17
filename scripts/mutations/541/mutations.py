"""541 · The Changes tab — what a rewind would do to your files.

⛔ **`525` measured all seven drawer tabs and ordered the work.** Item 1 was Events (`526`), then
the Controls and Dropped tabs (`529`). ⚑ **This is item 2, in `525`'s own words:** *"its paths are
already correctly prominent, but the **416-character rewind disclosure** is assigned **8/8.5 px**
prose roles."*

## 🔴 The two defects, because the brief named one and the instrument found the other

 1. ⛔ **The disclosure.** 416 characters saying a rewind **writes to your files**, at **8 px** —
    `--text-5xs`, whose own line in `tokens.css` calls it *micro chips*, against a §9 contract
    that says *"sizes < 9px are micro-labels/badges/table-heads only"*. ⚑ `HO-050` §1.2 rules
    that a rewind is a PRESS and §2's exception keeps its disclosure beside it; `514` F1 is why
    the SIZE decides whether the caveat was given at all. **Rows M1–M19 are that repair.**
 2. 🔴 **The paths, which `525` called already correct.** `531`'s ink sensor at the shipped
    `--drawer-w` found a file NAME cut by **85.59 px** with no `title` above it — **the only text
    in the whole drawer that was cut and recoverable by nothing** — and at `--drawer-w-narrow` a
    path column collapsing to **0 px** when the row's tag is long. ⚠️ A size histogram cannot see
    either; `530` and `531` are the two dispatches that measured why. **Rows M20–M22 are that
    repair**, and it is a `title` (`531`'s own ruling: a cut without one is a sentence nobody can
    get to; a cut with one is a layout decision).

## ⚑ Where the decision lives, which is what most of these rows attack

⛔ **Not one token VALUE moves.** `lib/text-roles.ts` names the five roles and the token each takes;
`CHANGES_TEXT` in `lib/drawer-tab-roles.ts` says which role each text on this tab has; the component
puts `ROLE_PROPERTIES` on its own root and **every size rule in its stylesheet names a ROLE**.
⚠️ So a row below that edits one CSS declaration is asking whether that element is still bound to
its role, and a row that edits the ROSTER is asking whether the roster still decides.

🔴 **The trap this table is built around** (`526` M25's lesson): a per-element assertion that reads
`ROLE_SIZE` to decide what `ROLE_SIZE` should be is blind to every edit of the map. ⛔ That is why
the killer file types its FLOORS itself and why the bridge is DRIVEN rather than read — and why
`--role-*` removal rows are red through the non-prose roles: `base.css` puts `--text-base` on
`body`, so an unresolved `var(--role-prose)` looks exactly like a working `prose`.

## ⛔ What this table does NOT cover

 1. **The diff paper.** `DiffBody`'s lines, gutters and hunk heads stay on their own tokens —
    a CODE reading surface's density is its own question and `DocumentBody`'s 10.5 px mono is the
    standard to grade it against. ⚑ Only the BANNER is in, because `SessionChanges` composes that
    sentence and it is a caveat about what a revert cannot undo (M14, M15).
 2. **The grid that collapses a path column to 0 px.** Measured, reported, not repaired: the
    remedy is a track floor or a shrinkable tag, which is a layout decision on the half of the tab
    `525` measured as correct. ⛔ No row moves `grid-template-columns`.
 3. **The token scale.** `tokens.css` is untouched and no row edits it.
 4. **`529`'s two rosters.** `CONTROLS_TEXT` and `DROPPED_TEXT` are not edited by any row here;
    `OFF_THE_SCALE` was RENAMED to `DROPPED_OFF_THE_SCALE` so a fourth tab's exemption could not be
    added to a list whose test requires each entry to draw on the tab being walked.
"""

SC = "apps/desktop/src/renderer/src/components/SessionChanges.vue"
DB = "apps/desktop/src/renderer/src/components/DiffBody.vue"
ROLES = "apps/desktop/src/renderer/src/lib/drawer-tab-roles.ts"

MUTATIONS = [
    # ---- the shipped defect, put back ------------------------------------------------------------
    (
        "M1 · 🔴 THE SHIPPED DEFECT, PUT BACK · the deferred foot returns to `--text-5xs`. ⛔ 416 "
        "characters of *what a rewind would do to your files* at 8 px, which is what `525` "
        "photographed and what `514` F1 is about: a caveat placed where nobody can take it in",
        [
            (
                SC,
                "  margin: var(--space-4) 0 0;\n"
                "  color: var(--faint);\n"
                "  font-size: var(--role-prose);\n",
                "  margin: var(--space-4) 0 0;\n"
                "  color: var(--faint);\n"
                "  font-size: var(--text-5xs);\n",
            )
        ],
    ),
    (
        "M2 · ⛔ THE BRIDGE, REMOVED · the panel stops declaring `ROLE_PROPERTIES`, so the module "
        "DESCRIBES and the stylesheet decides nothing. ⚠️ Every `var(--role-*)` becomes invalid at "
        "computed-value time and the text inherits `body`'s `--text-base` — ⚑ which is exactly why "
        "the killer DRIVES the property instead of reading it: 11.5 px looks like a working `prose`",
        [
            (
                SC,
                '  <section class="changes" data-cy="session-changes" :style="ROLE_PROPERTIES">',
                '  <section class="changes" data-cy="session-changes">',
            )
        ],
    ),
    (
        "M3 · ⚠️ the head note goes back to `--text-4xs` · the sentence that says what this pane IS, "
        "read once at the top, at 8.5 px. ⛔ `525` measured 35 elements at that size on this tab and "
        "this is the longest of them after the foot",
        [
            (
                SC,
                # ⚑ **theme host · re-anchored in place, not retired** — NOT VERIFIED. Theme border widths now use tokens; the same defect retains all other declarations.
                "  border-bottom: var(--border-width) solid var(--line);\n  color: var(--faint);\n  font-size: var(--role-prose);\n  line-height: 1.55;\n",
                "  border-bottom: var(--border-width) solid var(--line);\n  color: var(--faint);\n  font-size: var(--text-4xs);\n  line-height: 1.55;\n",
            )
        ],
    ),
    (
        "M4 · ⛔ the two *we were told and did not keep* sentences go back to 8 px · files a report "
        "named beyond the cap (092 §4) and whole observations released (299 §2). ⚑ They are the two "
        "places this pane admits it is incomplete, which is the one thing it must not say quietly",
        [
            (
                SC,
                "  background: var(--wash-1);\n"
                "  color: var(--faint);\n"
                "  font-size: var(--role-prose);\n",
                "  background: var(--wash-1);\n"
                "  color: var(--faint);\n"
                "  font-size: var(--text-5xs);\n",
            )
        ],
    ),
    (
        "M5 · 🔴 the under-disclosed note goes back to `--text-6xs` · 7.5 px for 092 §3's sentence — "
        "*a file change was approved without the provider naming the files*. ⛔ The bottom of the "
        "scale, on the one paragraph that explains why a row has no path",
        [
            # ⚑ **token plumbing · re-anchored in place, not retired** — NOT VERIFIED. The token codemod rewrote this line to read tokens; the replacement is unchanged and makes the same defect.
            (
                SC,
                "  padding: 0 var(--space-4) var(--space-4) var(--space-20);\n"
                "  color: var(--faint);\n"
                "  font-size: var(--role-prose);\n",
                "  padding: 0 var(--space-4) var(--space-4) var(--space-20);\n"
                "  color: var(--faint);\n"
                "  font-size: var(--text-6xs);\n",
            )
        ],
    ),
    (
        "M6 · ⚠️ the empty state's explanation goes back to 8.5 px · *when the agent edits, adds, or "
        "removes a file, it appears here*. ⛔ This is the state a clean base is in on every first "
        "run, and `536` landed the lesson one surface over: a surface quiet about the thing a person "
        "came looking for reads as GONE",
        [
            (
                SC,
                "  max-width: 250px;\n"
                "  margin: 0;\n"
                "  color: var(--faint);\n"
                "  font-size: var(--role-prose);\n",
                "  max-width: 250px;\n"
                "  margin: 0;\n"
                "  color: var(--faint);\n"
                "  font-size: var(--text-4xs);\n",
            )
        ],
    ),
    (
        "M7 · ⚑ the empty state's headline drops to `label` · *No file changes in this conversation* "
        "becomes a control's size rather than a sentence's. ⛔ The half of the empty state a person "
        "reads FIRST, one step under the explanation below it",
        [
            (
                SC,
                "  margin: 0;\n  color: var(--muted);\n  font-size: var(--role-prose);\n",
                "  margin: 0;\n  color: var(--muted);\n  font-size: var(--role-label);\n",
            )
        ],
    ),
    (
        "M8 · ⛔ the scope switch goes back to 8.5 px · the two presses that choose what the list is "
        "ABOUT, below `tokens.css`'s own *DEFAULT UI label & button text*. ⚑ `HO-050` §1.2: controls "
        "are things you press",
        [
            (
                SC,
                "  background: transparent;\n"
                "  color: var(--muted);\n"
                "  font-size: var(--role-label);\n",
                "  background: transparent;\n"
                "  color: var(--muted);\n"
                "  font-size: var(--text-4xs);\n",
            )
        ],
    ),
    (
        "M9 · ⚠️ the revert press goes back to `--text-xs` · a control whose own name sits half a "
        "pixel under the label step. ⛔ Small enough that no screenshot would show it and exactly the "
        "drift a vocabulary exists to stop",
        [
            (
                SC,
                "  cursor: not-allowed;\n  font-size: var(--role-label);\n",
                "  cursor: not-allowed;\n  font-size: var(--text-xs);\n",
            )
        ],
    ),
    (
        "M10 · 🔴 the file NAME stops declaring its own size · the rule is deleted and the name "
        "inherits again — which is how it was on `main`, where `.path` declared `--text-sm` and the "
        "name's size was a fact about its CONTAINER. ⛔ A roster entry for `.name` would then be "
        "measured on something no rule about names had ever set",
        [
            (
                SC,
                ".name {\n  color: var(--text-soft);\n  font-size: var(--role-label);\n",
                ".name {\n  color: var(--text-soft);\n",
            )
        ],
    ),
    (
        "M11 · ⛔ the directory prefix takes `value` instead of `meta` · a plausible role and the "
        "wrong one: where a file LIVES is about the file rather than in it, and this is the half the "
        "pane sacrifices to keep the name. ⚑ It also widens the column the name is fighting for",
        [
            (
                SC,
                "  font-family: var(--font-mono);\n  font-size: var(--role-meta);\n",
                "  font-family: var(--font-mono);\n  font-size: var(--role-value);\n",
            )
        ],
    ),
    (
        "M12 · ⚠️ the status letter takes `meta` · `A`/`M`/`D`/`R`/`W` is what the provider SAID "
        "about the file, not something about the row, and `tokens.css` calls `--text-3xs` *badges* "
        "in the token's own line",
        [
            (
                SC,
                "  font: var(--fw-bold) var(--role-value) / 1 var(--font-mono);\n",
                "  font: var(--fw-bold) var(--role-meta) / 1 var(--font-mono);\n",
            )
        ],
    ),
    (
        "M13 · ⛔ the per-row counts take `meta` · `+31 −9` is a number a provider counted, which is "
        "the same kind of fact as the head's totals one block up. ⚑ Two sizes for one kind of fact "
        "is the drift `525` measured across four tabs",
        [
            (
                SC,
                ".counts {\n  font: var(--fw-semibold) var(--role-value) / 1 var(--font-mono);\n",
                ".counts {\n  font: var(--fw-semibold) var(--role-meta) / 1 var(--font-mono);\n",
            )
        ],
    ),
    (
        "M14 · ⚠️ the head's totals take `label` · the same numbers as M13's, one register up, so the "
        "aggregate and the rows disagree about what a count IS",
        [
            (
                SC,
                ".agg {\n"
                "  margin-left: auto;\n"
                "  font: var(--fw-semibold) var(--role-value) / 1 var(--font-mono);\n",
                ".agg {\n"
                "  margin-left: auto;\n"
                "  font: var(--fw-semibold) var(--role-label) / 1 var(--font-mono);\n",
            )
        ],
    ),
    (
        "M15 · ⛔ the row's tags take `field` · *deleted*, *net unchanged*, *diff not kept — long "
        "report*. ⚑ `--text-6xs` is for *tiny uppercase field labels* in its own words, and none of "
        "those three is one: they say why this row will not open",
        [
            (
                SC,
                "  font: var(--fw-semibold) var(--role-meta) / 1 var(--font-mono);\n",
                "  font: var(--fw-semibold) var(--role-field) / 1 var(--font-mono);\n",
            )
        ],
    ),
    (
        "M16 · 🔴 the file count drops onto the type scale's floor · `--text-lg` is the tab's own H2 "
        "and the reason it is listed in `CHANGES_OFF_THE_SCALE`. ⛔ An exemption that stops being "
        "LOUDER than reading text is the defect wearing an exemption — which is the half `529`'s "
        "off-scale list exists to assert",
        # ⚑ **token plumbing · re-anchored in place, not retired** — NOT VERIFIED. The token codemod rewrote this line to read tokens; the replacement is unchanged and makes the same defect.
        [(SC, "  font-size: var(--type-reading);\n", "  font-size: var(--text-3xs);\n")],
    ),
    (
        "M17 · ⛔ THE BANNER, PUT BACK at 8 px · *This file was deleted … there is nothing on disk to "
        "revert to*. ⚑ `SessionChanges` composes that sentence and `DiffBody` merely draws it, so it "
        "is a caveat about what a revert cannot undo at the size the foot was",
        [(DB, "  font-size: var(--role-prose);\n", "  font-size: var(--text-5xs);\n")],
    ),
    (
        "M18 · ⚠️ `DiffBody` stops declaring the bridge · the banner's `var(--role-prose)` then "
        "resolves against nothing and the paragraph inherits. ⛔ *A component that names a role "
        "declares the bridge* is `529`'s rule and this is the row that holds the second component to "
        "it",
        [
            (
                DB,
                '  <div class="diff-paper" data-cy="diff-body" :data-view="view" :style="ROLE_PROPERTIES">',
                '  <div class="diff-paper" data-cy="diff-body" :data-view="view">',
            )
        ],
    ),
    (
        "M19 · 🔴 the ROSTER says the disclosure is `meta` · the stylesheet is untouched and the "
        "module now disagrees with it. ⛔ This is the row that proves the roster DECIDES rather than "
        "describes: nothing in the component changed and the tab is wrong",
        [
            (
                ROLES,
                '    selector: \'[data-cy="changes-revert-why"]\',\n    role: \'prose\',\n',
                '    selector: \'[data-cy="changes-revert-why"]\',\n    role: \'meta\',\n',
            )
        ],
    ),
    (
        "M20 · ⛔ THE TITLE, REMOVED · the row stops carrying its own path, so a file NAME cut by "
        "85.59 px at the shipped `--drawer-w` is reachable by nothing again. ⚑ `531`'s ruling, and "
        "the defect a size histogram cannot see",
        [
            (
                SC,
                '          :title="rowTitle(row)"\n',
                "",
            )
        ],
    ),
    (
        "M21 · ⚠️ the title keeps the path and drops the TAG · *diff not kept — long report* is "
        "`nowrap` in the same squeezed row and says the one thing a person cannot otherwise find "
        "out. ⛔ A tooltip that recovers half a row is a tooltip nobody can rely on",
        [
            (
                SC,
                "  return tag === null ? row.path : `${row.path} — ${tag}`\n",
                "  return row.path\n",
            )
        ],
    ),
    (
        "M22 · ⛔ the title carries the NAME instead of the whole path · the shorter tooltip, which "
        "looks tidier and loses the half that was cut: the directory prefix is what `direction: rtl` "
        "ellipsises, so the pointer then recovers exactly the part that was already on screen",
        [
            (
                SC,
                "  return tag === null ? row.path : `${row.path} — ${tag}`\n",
                "  return tag === null ? basenameOf(row.path) : `${basenameOf(row.path)} — ${tag}`\n",
            )
        ],
    ),
    (
        "M23 · ⚑ the roster forgets the directory prefix · one entry deleted, nothing else touched. "
        "⛔ The completeness walk is the half that makes a roster a census rather than an inventory, "
        "and an element in no role has to be NAMED rather than skipped",
        [
            (
                ROLES,
                "  {\n"
                "    selector: '.dir',\n"
                "    role: 'meta',\n"
                "    what: 'where the file lives — the half this pane ellipsises so the name survives',\n"
                "  },\n",
                "",
            )
        ],
    ),
]
