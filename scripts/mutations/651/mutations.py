"""651 · The gap that let the facet through.

⛔ **Three findings `645` reported and did not fix, correctly, and this table is what makes each fix
killable.** ⚑ `645` §3.4 (*nothing goes red if a new dot-sized call site spreads a wait onto a row with
no word beside it*), §8.2 (*`636`'s table has no row that touches the component*) and §8.1 (a count
in `TeamWorkspace.vue`'s prose).

## 🔴 What the dispatch decided, and therefore what has to be killable

 * **Every dot in the app is DECLARED** — `a-dot-says-one-thing.render.test.ts` reads each
   `<AgentState>` through `vue/compiler-sfc`, resolves its size or refuses it, and requires the dots
   it finds to equal `DOTS` by file and count. ⚑ Each declaration carries PROOFS: the forest's dot
   repeats a subject whose own row says its standing (`said-on-its-own-row`); the band's dot repeats a
   card whose plate is never handed a wait, while the task's own wait is said by the line's status
   mark (`said-only-by-its-mark` — the weaker of the two, declared as such).
 * **The facet-props rule is written ONCE, over every axis** — `agent-state.render.test.ts` asks the
   plate which props it DECLARES for every `FACET_AXES` key, and checks the rendered root for a stray
   attribute by name — the check `250` and `645` each wrote BY HAND for one facet. ⛔ Not a row in
   `636`'s table: that table is `unrun`, and the component row it lacks — the forwarding line for
   `waiting` — already exists as `645 M1`, byte for byte.

## ⚠️ The finding this table exists for, measured over all 336 tables

🔴 **No row in any table had ever modelled the defect that was written three times and shipped
once** (`250` and `258` each caught it before landing; `636` shipped it). Every row that touches a
FACET in `AgentState.vue` deletes a FORWARDING line — `258 M46`, `258 M47`, `645 M1`, and `250 M23`,
now retired anchor-absent — and the file's one other row, `563 M4`, blanks the `:aria-label` binding.
⛔ **None removes a facet's DECLARATION**, which is what `636` actually shipped. ⚠️ **`258 M47`'s label
says it does** — *"declared nowhere, so every caller's `v-bind` drops it onto the root element as a
stray attribute"* — **and its edit deletes the forwarding line instead**, with the prop still
declared, so nothing falls through at all. ⚑ `645 M1`'s label made the same slip about `636` and is
corrected in that table. `M6`-`M8` are the declaration removed, at last.

⚠️ **And nothing mutated the dot's CALL SITE.** No row in any table touched `dotToken`: `645 M3` edits
`priorityDotToken` itself, so the function's NEEDING-first rule was protected and the component's
feeding of it was not. `M9` is that.

## The row groups

 * `M1`-`M2` 🔴 **the census** — a new dot, and a size nobody can read without running it.
 * `M3`-`M5` ⛔ **the proofs** — each declaration's premise, broken where it lives.
 * `M6`-`M8` ⚠️ **the defect nobody modelled** — one facet's declaration removed, three times.
 * `M9`      ⚑ **the dot hears no needing** — the one path through the component nothing protected.

## ⛔ What this table cannot reach, stated because a table silent about its edges is claiming them

 * ⚠️ **No row adds a wait source to `WorkingTogetherInput` or `CastReading`.** That pin is
   COMPILE-time (`expectTypeOf(...).toBeNever()` over a recursive walk of the input), and this
   harness runs the tests, not `vue-tsc` — a row that planted the field would compile under esbuild,
   change no runtime value and record as a SURVIVOR (`a-true-mutation-measures-nothing`). ⚑ Measured
   by hand instead: a nested `waits` reading on the reading fails `typecheck` at the census.
 * ⛔ **No row on the census's own reader.** Weakening a census passes that census
   (`a-mutation-on-a-census-is-invisible-to-that-census`); §4 of the census file plants its own
   violations hermetically instead — every import shape and tag spelling `651`'s review found
   escaping the first reader — and pins the node-type constants by finding a known tag.
 * ⚠️ **No row makes a size arrive through a spread.** Every spread on a plate is an `AgentFacets`,
   which has no `size`; the census states this bound rather than guarding it.
 * ⚠️ **No row deletes `TeamForest.vue`'s new `:needing="row.facets.needing"` on the task dot.** The
   forest reads no needing — `plateFor`'s `told` has none, so `sessionFacets` never emits one — so the
   binding is always `undefined` and deleting it renders byte-identical markup: a SURVIVOR by
   construction (`a-true-mutation-measures-nothing`). ⚑ It is consistency with the plate above it,
   and the day the forest reads a needing is the day a row for it can be killed.

## ⚑ WRITTEN, not run as a table

⛔ **Standing memory: writing rows is routine, RUNNING a table is rare and deliberate.** Each row was
verified RED individually — one row, its killer file, restore-from-bytes — and no `mutations.txt`
exists at this HEAD, which is the honest unrun state.
"""

from __future__ import annotations

PLATE = "apps/desktop/src/renderer/src/components/AgentState.vue"
SUB_AGENT = "apps/desktop/src/renderer/src/components/SubAgentEntry.vue"
FOREST = "apps/desktop/src/renderer/src/lib/the-forest.ts"
FOREST_VIEW = "apps/desktop/src/renderer/src/components/TeamForest.vue"
BAND = "apps/desktop/src/renderer/src/lib/working-together.ts"
FORESTCARD = "apps/desktop/src/renderer/src/components/ForestCard.vue"

MUTATIONS: list[tuple[str, list[tuple[str, str, str]]]] = [
    # ── A · the census ────────────────────────────────────────────────────────────────────────
    (
        "M1 · 🔴 **a NEW dot, declared nowhere** · a sub-agent's plate drops below `PLATE_FLOOR`. "
        "⚠️ Not `645` §3.4's exact shape — `subAgentFacets` never returns a wait, and this row writes "
        "its status word beside the mark — but the census asks only *is every dot declared*, and that "
        "one rule is what turns §3.4's exact shape red too; the exact shape is planted in the census's "
        "own §4",
        [
            (
                SUB_AGENT,
                '<AgentState size="compact" v-bind="facets"',
                '<AgentState size="dot" v-bind="facets"',
            )
        ],
    ),
    (
        "M2 · ⛔ **a size decided at RUN TIME** · the plate becomes a dot or a plate depending on a "
        "value the census cannot evaluate. ⚠️ The fail-closed half: a size that cannot be READ must "
        "be refused, never assumed to be a plate",
        [
            (
                SUB_AGENT,
                '<AgentState size="compact" v-bind="facets"',
                "<AgentState :size=\"card.kind ? 'dot' : 'compact'\" v-bind=\"facets\"",
            )
        ],
    ),
    # ── B · the proofs ────────────────────────────────────────────────────────────────────────
    (
        "M3 · 🔴 **the forest's task line gets facets of its OWN** · an equal copy of its holder's, "
        "which agrees today and is a second derivation tomorrow. ⛔ The `said-on-its-own-row` "
        "declaration rests on the dot REPEATING a subject, never introducing one",
        [
            (
                FOREST,
                # ⚠️ **668 · the dot this label names is GONE** — the task line sits on its holder's
                # card now. ⚑ The row still pins the VIEW-MODEL fact (a task row's facets ARE its
                # holder's), which `a-dot-says-one-thing.render.test.ts` §3 still asserts; no template
                # draws a task row's facets today.
                "        depth: depth + 1,\n        name: named(task.work.toIdentity),\n        facets,\n",
                "        depth: depth + 1,\n        name: named(task.work.toIdentity),\n        facets: { ...facets },\n",
            )
        ],
    ),
    (
        "M4 · ⛔ **the holder's row stops saying its standing** · `forest-says` draws the name "
        "instead, so the one place the forest SAYS a wait goes quiet and the task dot below it is "
        "silent about a fact nobody is told — the hazard itself. ⚠️ Nothing else in the suite "
        "notices: the DOM test asks only that the word is visible and non-empty, and a name is both",
                # ⚑ **668 re-anchored and the ROW is unchanged** — the word is on the node's card now,
                # and wrapped; ⚠️ the task line under it has no dot since `668`, so this word is the
                # ONLY place the forest says its holder's wait.
        # ⚑ Landing ui f1fa1e2e…70aaa954 (the card panel and the Vue Flow forest) · re-anchored in
        # place, not retired — The rule survives: the holder's standing word (`forest-says`) is
        # still the only place the forest says its holder's wait, and 2053fd25 moved that markup out
        # of TeamForest.vue into ForestCard.vue unchanged ("The card is its own component,
        # ForestCard.vue, unchanged in what it says and its hooks"). Only the file and the `props.`
        # prefix changed. The plant draws `row.name` where `row.says` was; the label's "nothing else
        # notices" is stale, because the SSR census now pins the word against STANDING_LABEL. Killed
        # by `a-dot-says-one-thing.render.test.ts`,
        # `a-conversation-the-quit-left-open-said-everywhere.dom.test.ts`,
        # `the-graph-draws-each-agent-as-the-rail-does-and-opens-only-what-opens.dom.test.ts`.
        [
            (FORESTCARD, 'data-cy="forest-says">{{\n        props.node.row.says\n      }}</span>', 'data-cy="forest-says">{{\n        props.node.row.name\n      }}</span>'),
        ],
    ),
    (
        "M5 · ⚠️ **a band task line gets facets of its OWN** · the band declaration's premise — a "
        "dot on the band is ITS card's plate repeated, `631`'s *the plate is the recipient card's own, "
        "never a second derivation*. ⚑ Anchor corrected at `654`, which reflowed the line to add "
        "`summonsAPerson`; the subject did not move",
        [
            (
                BAND,
                "      card.work.map((piece) => ({\n        piece,\n        facets: card.facets,\n",
                "      card.work.map((piece) => ({\n        piece,\n        facets: { ...card.facets },\n",
            )
        ],
    ),
    # ── C · the defect nobody modelled ────────────────────────────────────────────────────────
    (
        "M6 · 🔴 **the FOURTH facet is declared nowhere** · `250`'s defect exactly: every caller's "
        "`v-bind` drops `detached` onto the root element as a stray attribute and the sentence never "
        "hears it. ⛔ The first row in any table that removes a DECLARATION rather than a forwarding "
        "line",
        [(PLATE, "  detached?: boolean\n", "")],
    ),
    (
        "M7 · ⛔ **the FIFTH facet is declared nowhere** · `258`'s defect, and the one `258 M47`'s own "
        "label describes while its edit deletes the forwarding line instead",
        [(PLATE, "  scheduled?: boolean\n", "")],
    ),
    (
        "M8 · ⚠️ **the SIXTH facet is declared nowhere** · `636`'s shipped state exactly, which stood "
        "until `645` with `accessibleName`'s clause green as a pure function the whole time",
        # ⚑ Landing D-016c commits 6–7 and D-022 (4a7f0fec, c1a79abe, 37228461) · re-anchored in
        # place, not retired — AgentState.vue still declares one prop per facet AgentFacets
        # declares; D-022's fourth wait kind renamed the facet's type from TaskWait to
        # ConversationWait, so the old declaration line is gone. The plant removes the waiting prop
        # declaration, so the facet is no longer a declared prop and lands on the root as an
        # attribute. Killed by `agent-state.render.test.ts`.
        [
            (PLATE, '  waiting?: ConversationWait\n', ''),
        ],
    ),
    # ── D · the dot ───────────────────────────────────────────────────────────────────────────
    (
        "M9 · ⚑ **the dot stops hearing the NEEDING** · a plate below the floor answers a DOING colour "
        "while a permission waits — *an unanswered card with no visible trace*, the guarantee "
        "`063`/`079` §5 exist for. ⛔ No row in any table touched `dotToken` before this one",
        [
            (
                PLATE,
                # ⚑ **source-restoration · re-anchored in place, not retired** — NOT VERIFIED; source targeting only. 91f7de2f1 consolidated facet construction for glyphs and dots; omit needing only from the dot input, preserving the new glyph and other facets.
                "const dotToken = computed(() => priorityDotToken(facets.value))",
                "const dotToken = computed(() => {\n  const { needing: _ignored, ...withoutNeeding } = facets.value\n  return priorityDotToken(withoutNeeding)\n})",
            )
        ],
    ),
]
