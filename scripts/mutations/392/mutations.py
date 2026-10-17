"""392 · The inventory workbench — each row is one way the surface stops being honest about what a
conversation has.

⛔ **The subject is TWO vocabularies and THREE absences, on one browsable list.** A reading —
`untold` / `unpublished` / `published` — is a fact about the whole inventory. A standing —
`confirmed` / `offered` / `unconfirmable` — is a fact about one entry, and only about an entry
BroBot declared. ⚠️ **Deriving either from the other, or giving one of them the other's word, is the
defect this table is mostly about**; the rest of it is an absence being drawn as a different absence.

## 🔴 Which gate can see each row

| rows | the defect is caught by |
|---|---|
| `M2`, `M3`, `M6`, `M9`, `M10`, `M13`, `M19`-`M21` | ⚑ **`apps/desktop/test/tool-inventory.test.ts`** — the pure half |
| `M1`, `M4`, `M5`, `M7`, `M8`, `M11`, `M12`, `M14`-`M18`, `M22`, `M23` | ⚑ **`apps/desktop/test/dom/session-tools.dom.test.ts`** |

## ⚑ 444 corrected two anchors in place, and this table has no artefact to invalidate

⛔ **`M11` and `M13` are `444`'s doing and neither row's DEFECT changed.** `444` §item-5 wrote the
sheet's `220px` gutter as `var(--lane-clear)` — the same number, derived from the lane's own band
instead of shadowing it — so `M11`'s anchor moved from the literal to the token. `444` relay 1
corrected a FALSE clause in the `unpublished` sentence (*"when it started"*, which a reopened
conversation makes untrue), so `M13`'s anchor and its replacement both carry the corrected wording;
the promise the row restores — *"the agent can call them"* — is untouched.

⚠️ **This table is `unrun`: there is no `mutations.txt` and no recorded verdict here**, so unlike
the usual correction there is nothing that was measured against the old text. ⛔ **Both corrected
rows were nevertheless applied ALONE and watched go RED against their named killer file before
being recorded** (444 §7), because a corrected anchor that still applies is not a corrected row.

## 🔴 §6 is what an adversarial review of this dispatch's own diff found

⛔ **Six of these twenty-three rows exist because a read-only review read the diff before it was
committed, and every one of the six was a sentence contradicting another sentence on the same
screen.** `M19` is the sharpest: a name the child listed under BroBot's own server that BroBot never
declared was filed as BroBot's own, so the row sat under a heading reading *"declared by BroBot"*
and a detail cell reading *"BroBot's own toolset"*, beside its own sentence saying BroBot did not
declare it. ⚠️ **`unclaimed` was added by this dispatch to make that state visible, and the first
rendering of it made the same conflation one level out.**

⚑ **`M18` is the one a person would have hit first**: a configured MCP server that fails or needs a
sign-in publishes a status row and contributes no tool name, and a catalogue with a row per TOOL drew
nothing for it — the server somebody opens this sheet BECAUSE of.

## ⛔ Two rows survived their first verification, and both were gaps in the tests

⛔ **`M22`** — the way back drawn only beside a selection. Every narrow-layout case had one, so the
state the control exists for — the filter emptying the list while the detail is showing — was never
reached. ⛔ **`M23`** — standing chips on a reading that can carry none. Every fixture had a
declaration, so `own === null` was never drawn. Both have their own case now.

## ⛔ One row survived its first WRITING, and the row was wrong rather than the gate

⚠️ **`M12` was first written as *"the narrow layout keeps both columns"*, deleting `display: block`
from `.inventory-browser` inside the media query.** It survived — and correctly: the panes are made
mutually exclusive by `.tool-detail { display: none }` and `.show-detail .catalog-pane { display:
none }`, neither of which that edit touched, so the layout it produced was still one pane at a time.
⛔ **The mutation did not express the defect its own sentence claimed.**

⚑ **It is now the BREAKPOINT**, which is the number the defect actually lives in: at v2.5.1's 620px
this sheet is a 274px catalogue beside a 146px detail pane between 620 and 1000, measured, and the
overflow sweep at 900×800 is what says so. ⚑ **And the sentence the first version claimed is now
`M17`**, which removes the rule that really makes the panes exclusive.

## ⚠️ Two rows are about a number a person reads, and both were nearly not written

⛔ **`M8`** — the count line's denominator following the filter. `inventorySummary`'s docblock has
carried the rule since `358`: *"counted off the INVENTORY and never off a filtered view… there is no
filter on this surface today; the rule is written here so adding one cannot quietly change what the
number means."* `392` is the dispatch that added the filter, so this is the row that rule was left
for.

⛔ **`M9`** — the names the child listed under BroBot's OWN server that BroBot never declared. They
fell out of every list at `358` and `dropped` did not count them either; the catalogue's conservation
law is what found them, and this row is what keeps them found.

## ⛔ What this table deliberately does NOT contain

⛔ **No row on the `origin` field.** There is nothing to mutate: `382` measured that the field never
crosses into this app and nothing here holds one. The rule is enforced by a census over the rendered
surface with a planted control, in the DOM test's §6, rather than by a mutation on a line that does
not exist. ⚑ **A line no mutation can kill is not carrying its rule** — so the rule is carried by an
assertion instead.

⛔ **No row on the search's own case-folding, the chip radii, or the group order.** The first is
covered by an ordinary assertion and is not a claim about what the conversation has; the second is
cosmetic on a surface whose other defects are false statements; the third would be killed by the same
test as `M14` and would measure nothing new.

⛔ **No row inverting `catalogue`'s three-way `source`.** Every arm is asserted by name in the pure
half, and a mutation that swapped two of them is `M2` with a different spelling.
"""

LIB = "apps/desktop/src/renderer/src/lib/tool-inventory.ts"
SHEET = "apps/desktop/src/renderer/src/components/SessionTools.vue"

MUTATIONS: list[tuple[str, list[tuple[str, str, str]]]] = [
    # ── §1 · the two vocabularies cross ──────────────────────────────────────────────────────────
    (
        "M1 · 🔴 THE DEFECT `388` §2.3 NAMED, verbatim · the `unconfirmable` chip goes back to "
        "reading `offered` — the FORMAL name of a different standing, so every row on a Codex "
        "conversation wears the word for the Claude failure state and a person reading the "
        "vocabulary key beside it is told two incompatible things",
        [
            (
                SHEET,
                "  unconfirmable: {\n    label: 'unconfirmable',",
                "  unconfirmable: {\n    label: 'offered',",
            )
        ],
    ),
    (
        "M2 · ⛔ a row BroBot never declared is given a standing anyway · a tool the CHILD published "
        "under its own MCP server reads as `confirmed`, which is the one standing that is evidence "
        "— it would say BroBot's declaration arrived for a tool BroBot never declared",
        [
            (
                LIB,
                "        serverStatus: server.status === '' ? null : server.status,\n        description: null,\n        parameters: null,\n        standing: null,",
                "        serverStatus: server.status === '' ? null : server.status,\n        description: null,\n        parameters: null,\n        standing: 'confirmed',",
            )
        ],
    ),
    (
        "M3 · ⛔ every reading offers every standing · the filter bar draws `confirmed` on a "
        "provider that publishes no inventory, which is a control that can only ever empty the list "
        "and, worse, implies the provider might one day confirm something",
        [
            (
                LIB,
                "    case 'unpublished':\n      return ['unconfirmable']",
                "    case 'unpublished':\n      return ['confirmed', 'offered', 'unconfirmable']",
            )
        ],
    ),
    # ── §2 · an absence drawn as a different absence ─────────────────────────────────────────────
    (
        "M4 · 🔴 the child ANSWERING with an empty list is drawn as the provider that never answers "
        "· `392` §4's three sentences collapse to two, and the one that is lost is the only reading "
        "in which the agent has actually told us something",
        [
            (
                SHEET,
                "  return reading.value.kind === 'published'\n    ? 'The agent answered and named no tool at all",
                "  return false\n    ? 'The agent answered and named no tool at all",
            )
        ],
    ),
    (
        "M5 · ⛔ `null` parameters are normalised to `[]` · *'no argument list is published for it "
        "anywhere'* becomes *'it takes no arguments'*, so the provider's silence is drawn as "
        "BroBot's own answer — `279` §2's rule, one level below the one it was written for",
        [
            (
                LIB,
                "      source: 'builtin',\n      server: null,\n      serverStatus: null,\n      description: null,\n      parameters: null,",
                "      source: 'builtin',\n      server: null,\n      serverStatus: null,\n      description: null,\n      parameters: [],",
            )
        ],
    ),
    (
        "M6 · ⛔ a server the child named with NO status row keeps the empty string · the detail "
        "pane prints a blank where *'Not reported by the agent'* belongs, and `''` is the one value "
        "a template renders as nothing at all rather than as an absence",
        [
            (
                LIB,
                "        serverStatus: server.status === '' ? null : server.status,",
                "        serverStatus: server.status,",
            )
        ],
    ),
    (
        "M7 · ⛔ the `untold` reading gets a search box and a filter bar · controls over a list that "
        "does not exist, whose only possible answer is *'no matches'* — an absence dressed as an "
        "empty result",
        [
            (
                SHEET,
                '          <template v-if="entries.length > 0">',
                '          <template v-if="true">',
            )
        ],
    ),
    # ── §3 · the numbers, and what each one counts ───────────────────────────────────────────────
    (
        "M8 · 🔴 the count line's denominator follows the filter · `Showing 1 of 1` for every "
        "search, so the one number that says how much of the inventory is hidden says nothing — the "
        "anti-pattern `inventorySummary`'s docblock has named since `358`, arriving in the dispatch "
        "that added the filter it was written for",
        [
            (
                SHEET,
                "              Showing {{ shown.length }} of {{ entries.length }}",
                "              Showing {{ shown.length }} of {{ shown.length }}",
            )
        ],
    ),
    (
        "M9 · 🔴 the names the child listed under BroBot's OWN server that BroBot never declared go "
        "back to being invisible · they are in no list, and `dropped` never counted them either, so "
        "the surface whose whole job is to say what a conversation has understates it in silence",
        [
            (
                LIB,
                "  const unclaimed = [...listedUnderOurs].filter((name) => !declaredQualified.has(name))",
                "  const unclaimed: string[] = []",
            )
        ],
    ),
    (
        "M10 · ⛔ the search reaches a third field · a row's `source` joins its name and its "
        "description, so typing `builtin` returns thirty-two rows that contain the word nowhere — "
        "which is `382`'s origin defect with the one field we do have",
        [
            (
                LIB,
                "      entry.name.toLowerCase().includes(needle) ||",
                "      entry.source.toLowerCase().includes(needle) ||\n      entry.name.toLowerCase().includes(needle) ||",
            )
        ],
    ),
    # ── §4 · the geometry, and the control it can cover ──────────────────────────────────────────
    (
        "M11 · 🔴 the sheet takes v2.5.1's own 964px · at `--app-min-w` it starts at 108px and "
        "`SpawnStopLane` owns the leftmost 210px, so the emergency stop `390` put on this layer is "
        "behind the panel — and `390`'s own `reachable()` still passes, because the lane's "
        "`z-index: 2` keeps it painting on top of what it is now inside "
        "⚑ ANCHOR CORRECTED IN PLACE BY 444",
        [
            (
                SHEET,
                "  width: min(940px, calc(100% - 2 * var(--lane-clear)));",
                "  width: min(964px, calc(100% - 2 * 16px));",
            )
        ],
    ),
    (
        "M12 · ⛔ the breakpoint goes back to v2.5.1's own 620px · this sheet gives 220px of gutter "
        "back to the emergency stop at each edge, so between 620 and 1000 it is a 274px catalogue "
        "beside a 146px detail pane in which every argument row, every evidence cell and the "
        "standing line overflow — measured at 900×800 before the number moved",
        [(SHEET, "@media (max-width: 1000px) {", "@media (max-width: 620px) {")],
    ),
    (
        "M17 · ⛔ the two panes stop being mutually exclusive at the narrow width · the detail is "
        "drawn under the list instead of instead-of it, so there is no list/detail navigation and "
        "the Back button goes back to something that never left",
        [
            (
                SHEET,
                "  .tool-detail {\n    display: none;\n    height: 100%;\n  }",
                "  .tool-detail {\n    height: 100%;\n  }",
            )
        ],
    ),
    # ── §5 · the sentences a person could act on ─────────────────────────────────────────────────
    (
        "M13 · 🔴 *'the agent can call them'* returns to the `unpublished` sentence · two promises "
        "at once, and neither is knowable from this window — that the declaration ARRIVED, which is "
        "exactly what an unpublished provider cannot report, and that a call would be ADMITTED, "
        "which is a capability's answer ⚑ ANCHOR CORRECTED IN PLACE BY 444",
        [
            (
                LIB,
                "          'this conversation at its most recent launch; nothing here is a confirmation that the ' +",
                "          'this conversation at its most recent launch — the agent can call them, and nothing here is a confirmation that the ' +",
            )
        ],
    ),
    (
        "M14 · ⛔ a group keeps its heading after every row under it was filtered out · an empty "
        "`github` heading under a search reads as *'this server has no tools'*, which is a claim "
        "about the server rather than about the search",
        [
            (
                SHEET,
                "  const under = (test: (entry: CatalogEntry) => boolean): CatalogEntry[] => shown.value.filter(test)",
                "  const under = (test: (entry: CatalogEntry) => boolean): CatalogEntry[] => entries.value.filter(test)",
            )
        ],
    ),
    (
        "M15 · ⛔ the provider's own built-ins are given a SERVER's connection sentence · *'the "
        "agent did not list this server'* over thirty-two tools that belong to no server, which is "
        "an answer to a question with no subject",
        [
            (SHEET, "      status: 'none',\n      entries: builtins,", "      status: null,\n      entries: builtins,"),
        ],
    ),
    (
        "M16 · ⛔ the detail pane keeps a selection the filter has hidden · everything on screen "
        "agrees except the thing it is about, which is `279`'s name-for-an-absence on a pane rather "
        "than on a field",
        [
            (
                SHEET,
                "  () => shown.value.find((entry) => entry.key === selectedKey.value) ?? shown.value[0] ?? null,",
                "  () => entries.value.find((entry) => entry.key === selectedKey.value) ?? shown.value[0] ?? null,",
            )
        ],
    ),
   # ── §6 · the six review found, and every one of them was a sentence contradicting itself ────
    (
        "M18 · 🔴 a server the agent NAMED and listed no tool under vanishes from the workbench · "
        "the catalogue has a row per TOOL, so a configured MCP server that failed or needs a "
        "sign-in draws nothing at all — while the provenance sentence directly above the list "
        "promises *'every MCP server it connected to'*, and it is the server a person opens this "
        "sheet BECAUSE of",
        [
            (
                SHEET,
                "    const empty = server.tools.length === 0 && !filtered.value\n    if (rows.length > 0 || empty)",
                "    const empty = false\n    if (rows.length > 0 || empty)",
            )
        ],
    ),
    (
        "M19 · 🔴 what the agent named under BroBot's own server that BroBot never declared is filed "
        "as BroBot's own · the row then sits under a heading reading *'declared by BroBot'* and a "
        "detail cell reading *'BroBot's own toolset'*, beside its own sentence saying BroBot did "
        "not declare it — one row saying both, which is the conflation `unclaimed` exists to refuse",
        [(LIB, "        source: 'unclaimed',", "        source: 'brobot',")],
    ),
    (
        "M20 · ⛔ an empty status word is normalised on every server EXCEPT BroBot's own · `''` is "
        "legal on the wire, and the one value a template renders as nothing at all rather than as "
        "an absence — the exception made at one depth of a walk",
        [
            (
                LIB,
                "  const ownStatus = own === null || own.status === '' ? null : own.status",
                "  const ownStatus = own === null ? null : own.status",
            )
        ],
    ),
    (
        "M21 · ⛔ a name the provider published twice becomes two rows under one `:key` · nothing "
        "upstream deduplicates — the wire types a name list, the bound filters and slices, the fold "
        "copies — so the field documented *'unique across every source'* is not, and the count line "
        "and the selection both read the duplicate as information",
        [(LIB, "    if (seen.has(row.key)) return", "    if (false) return")],
    ),
    (
        "M22 · ⛔ the way back is drawn only when something is selected · below the breakpoint the "
        "catalogue is hidden while the detail shows, so a filter that empties the list leaves a "
        "person on a pane with no exit — the control disappears exactly when it is needed",
        [
            (
                SHEET,
                '          <button\n            class="link-button tool-back"',
                '          <button\n            v-if="selected !== null"\n            class="link-button tool-back"',
            )
        ],
    ),
    (
        "M23 · ⛔ standing chips are offered on a reading where nothing can carry one · `353`'s "
        "negative control — a launch with the toolset detached — is a `published` reading with no "
        "declaration, in which every row has no standing, so both chips can only ever empty the "
        "list",
        [
            (
                SHEET,
                "  reading.value.own === null ? [] : standingChoices(reading.value.kind),",
                "  standingChoices(reading.value.kind),",
            )
        ],
    ),
]
