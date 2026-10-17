"""645 · The sixth facet that reaches no plate.

⛔ **`636` added `waiting` to {@link AgentFacets}, taught `accessibleName` to say it, and never
declared it as a prop on `AgentState.vue`.** ⚑ Every caller spreads the whole facets object, so the
value landed on the root element as a stray `waiting="waiting-on-a-worker"` attribute and the clause
`636` wrote was a branch **no call site could produce** — `222` §4's rule, broken by the fix for it,
for the THIRD time (`250` on `detached`, `258` on `scheduled`, this).

## ⚠️ The distinction this table is built around

🔴 **The WORD was never untested.** `three-surfaces-read-the-new-field.test.ts` has pinned
`accessibleName`'s sentence for every wait since `636`, and pins it still. ⛔ **What did not exist
was the WIRING**, and a pure-function pin is not a surface — which is why `M1` is the row that
matters and why its killers are a render test and a DOM test rather than a unit assertion.

## The rows

 * `M1` 🔴 **the component stops forwarding the facet** — the FORWARDING half of `636`'s gap, with
   the prop still declared. ⚠️ Corrected at `651`: `636` shipped with the prop declared NOWHERE,
   which is a different mutation and is `651 M8`. ⛔ Killed by
   `agent-state.render.test.ts` (*the SIXTH facet reaches the NAME and leaks no attribute*) and by
   `three-surfaces-read-the-new-field.dom.test.ts` §3, which reads the attribute off a REAL DOM at
   two call sites with two different producers.
 * `M2` ⛔ **the skip goes away** — *waiting on a person* is said beside *waiting on you
   (permission)*, so one fact is stated twice in one sentence. ⚑ Killed by the render test's
   combination case and by §3's skip case.
 * `M3` ⚠️ **the dot ruling is reversed** — a branch for the sixth facet is ADDED to
   `priorityDotToken`. ⛔ This row exists because the ruling is a DELIBERATE ABSENCE, and an absence
   with no killable row is indistinguishable from an oversight
   (`a-line-no-mutation-can-kill-is-not-carrying-its-rule`, taken from the other side: the row
   writes the line the decision refused, and the test that records the decision kills it).

## ⛔ What this table cannot reach, stated because a table silent about its edges is claiming them

 * ⚠️ **No row makes a NEW dot-sized call site spread a wait.** The dot's silence rests on `081`
   §4 — *the row's own text carries the word*. ⚠️ **`645` wrote here that `TeamForest.vue`'s task
   lines draw `forest-says` beside the mark; they do not** — it is on the holder conversation's own
   row, and the task line's dot is that row's `facets` object repeated. ⚑ **Closed at `651`**: the
   census `a-dot-says-one-thing.render.test.ts` requires every dot in the app to be declared, and
   `651 M1` is a new dot it kills.
 * ⛔ **No row on the axis registries.** Both cross-products are now exhaustive over
   `keyof AgentFacets` at compile time, and a mutation that weakens a census passes that census
   (`a-mutation-on-a-census-is-invisible-to-that-census`). ⚑ The registries are trapped BOTH ways
   by `vue-tsc`/`tsc` instead — measured, not asserted: a seventh facet and a removed axis each
   refuse to compile, in both the web and the node project.

## ⚑ WRITTEN, not run as a table

⛔ **Standing memory: writing rows is routine, RUNNING a table is rare and deliberate.** ⚑ Each row
here was verified RED individually — one row, its killer file, restore-from-bytes — and no
`mutations.txt` exists at this HEAD, which is the honest unrun state.
"""

from __future__ import annotations

PLATE = "apps/desktop/src/renderer/src/components/AgentState.vue"
STATE = "apps/desktop/src/renderer/src/lib/agent-state.ts"

MUTATIONS: list[tuple[str, list[tuple[str, str, str]]]] = [
    # ── A · the wiring ────────────────────────────────────────────────────────────────────────
    (
        "M1 · 🔴 **the sixth facet stops reaching the sentence** · the forwarding line is deleted, "
        "with the prop still DECLARED, so nothing leaks onto the root element and only the "
        "screen-reader sentence drops the wait. ⚠️ Not `636`'s shipped state — that was the prop "
        "declared nowhere, and it is `651 M8`. ⛔ `250` M23 and `258` M46/M47 are the same row, "
        "one facet along · killed by `agent-state.render.test.ts`",
        [
            (
                PLATE,
                # ⚑ **W4.275 · re-anchored in place, not retired** — W4.275 · bda8b1be moved the facet spreads into one facets computed that the accessible name reads; the plant still drops the wait facet with the prop declared, so the name stops saying the wait.
                "  ...(props.waiting !== undefined ? { waiting: props.waiting } : {}),\n",
                "",
            )
        ],
    ),
    # ── B · the one clause with a condition on it ─────────────────────────────────────────────
    (
        "M2 · ⛔ **the wait is said twice** · the skip that suppresses *waiting on a person* when a "
        "summoning NEEDING already names the card is removed, so a screen reader hears *waiting on "
        "a person, waiting on you (permission)* — one fact, two phrases, which is the collision "
        "`250` refused in `session-panel.ts`",
        [
            (
                STATE,
                "  if (\n"
                "    input.waiting !== undefined &&\n"
                "    !(waitSummonsAPerson(input.waiting) && summonsAttention(input.needing))\n"
                "  ) {\n",
                "  if (input.waiting !== undefined) {\n",
            )
        ],
    ),
    # ── C · the decision that is an absence ───────────────────────────────────────────────────
    (
        "M3 · ⚠️ **the dot takes a branch for the sixth facet** · the line `645` decided NOT to "
        "write, written. ⛔ A dot says exactly one thing and the row's own text already carries "
        "this one (`081` §4), so the branch is a second answer to a question the row has already "
        "answered — and an absence nothing can kill is indistinguishable from an oversight",
        [
            (
                STATE,
                "export function priorityDotToken(facets: AgentFacets): string {\n"
                "  if (facets.needing) return NEEDING_TOKEN[facets.needing]\n",
                "export function priorityDotToken(facets: AgentFacets): string {\n"
                "  if (facets.needing) return NEEDING_TOKEN[facets.needing]\n"
                "  if (waitSummonsAPerson(facets.waiting)) return '--waiting'\n",
            )
        ],
    ),
]
