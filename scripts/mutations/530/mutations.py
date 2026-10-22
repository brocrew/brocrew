"""530 · The roster row that draws one of two grants.

⛔ **The defect, verbatim from the dispatch that found it** (`511` relay 2 F1, found there and
deliberately not fixed):

> ⛔ **`SideRail.vue` draws ONE of the two grants that start a conversation, and it is the row a
> person presses to choose whose sheet to open.** ⚑ It renders `capabilityField('canSpawn').says(…)`
> and nothing else — **so the agent-roster row for a shipped project manager reads `May start
> conversations as: none`**, while the same identity holds *"May also start conversations as: any
> agent this app did not set up itself"*.

🔴 **The family, named by the finding:** `464`'s defect one grant over, and `460` F1's exact surface
— *one grant, two surfaces, two verbs* becoming **two grants, one surface, one of them.**

## ⚠️ What this dispatch MEASURED before it changed anything, because it changes what the rows are for

⛔ **The copy column of an agent row is 131 px** at `--rail-w: 208px` and 143 px at the ≥1400px
width; one `--text-2xs` line holds about 27 characters; and *May start conversations as:* is 27
characters on its own. 🔴 **So `.rail-copy small`'s `white-space: nowrap` meant every roster row
ellipsized AT THE LABEL** — measured on the unchanged component, `scrollWidth` 152 px against a
`clientWidth` of 131 px — **and the VALUE, the only part of that line that differs between
identities, was never on screen in any of the four states.** ⚑ A picture of the four rows before
this dispatch shows *May start conversations as…* four times and nothing else.

⚠️ **That is why half the rows below are about LAYOUT.** The repair is not one line of template: a
row that gained a second grant and kept `nowrap` would have drawn two identical ellipsized labels,
which is worse than what it replaced. ⛔ **So the layout declarations carry the rule now**, and a
rule a declaration carries is a rule a mutation has to be able to break.

## 🔴 The four states, and the one nothing produces

An identity may hold a LIST, a REACH, both, or neither. ⚑ **`511` relay 2 F2 records that *both* is
currently unreachable** — BroBot holds `canCreateAgents` and the project manager holds `canStaff`,
so nothing holds both — and it is drawn and asserted anyway:
`a-guard-that-only-a-live-run-can-trip-is-dark-by-default`.

## ⛔ What this table does NOT cover

 1. **The live probe's own run.** `scripts/capabilities-sheet-probe.mjs` reads both grant hooks off a
    windowed app and `464 M18` is the row that says its expectation is real; nothing here launches
    Electron.
 2. **Whether 131 px is the right column.** The rail's width is `385`'s and `390`'s, pinned by five
    tests; this dispatch measured it and designed to it rather than moving it.
"""

CAPS = "apps/desktop/src/shared/capabilities.ts"
FACTORY = "apps/desktop/src/main/runtime/factory-text.ts"
RAIL = "apps/desktop/src/renderer/src/components/SideRail.vue"

# 🔴 **570 · THE ROW MOVED, AND THIS TABLE MOVED WITH IT** (`EXT-008` §4.4).
#
# ⛔ **The surface a person chooses a sheet from is `TeamWorkspace`'s card**, not the rail's AGENTS
# section — that section is out of the navigation column. ⚑ **Every markup row below is CORRECTED
# IN PLACE and re-verified RED one at a time**: the subject is the same row with the same
# expressions, and only the file and the loop variable moved
# (`a-corrected-anchor-keeps-a-verdict-it-never-earned`).
#
# ⚠️ **Two rows are NOT corrected and are genuinely retired — `M9` and `M10`, the clamp.** Their
# subject is `-webkit-line-clamp: 2`, which was a BOUND on a 131 px navigation column, and a card
# on a page is not that column. See the note above each.
TEAM = "apps/desktop/src/renderer/src/components/TeamWorkspace.vue"

# ⚑ **544 · one argument longer** — `grantLine` is asked which audience it is rendering for, and
# the roster row answers `null` because it draws an identity rather than a conversation. ⛔ Every
# row below keeps its own subject; only the anchor moved (standing rule 27 / `528`).
# ⚑ ANCHOR CORRECTED IN PLACE BY 714 — R41: the Team card hands `grantLine` the grant as a
# person reads it (`namedGrants`, every identity NAMED); the defect planted is unchanged.
RENDER = "              >{{ grantLine(field, namedGrants(member.identity.capabilities), null) }}</small\n"
WALK = '              v-for="field in STARTS_A_CONVERSATION_FIELDS"\n'
PAIR = "  (field) => field.key === 'canSpawn' || field.key === 'canStaff',\n"

MUTATIONS = [
    # ---- one of two, which is the whole dispatch --------------------------------------------------
    (
        # ⛔ **RETIRED BY RULING (landing D-014, 010f9426):** The team card's grant pair was deleted
        # with the can_spawn/can_staff grants. The card says "no roles, no fan-out cap, and no
        # `can_spawn`", and the commit says "Any agent may start a conversation as any existing
        # profile". Its anchor is left stale, so the census records it retired.
        "M1 · 🔴 THE SHIPPED DEFECT, PUT BACK · the row draws the first grant and stops, so a "
        "project manager that may staff its project reads *May start conversations as: none* on the "
        "surface a person chooses a sheet from. ⚠️ **The source census cannot see this one** — the "
        "`v-for` still names the pair — and only the drawing can",
        [(TEAM, WALK, WALK.replace("FIELDS\"", "FIELDS.slice(0, 1)\""))],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-014, 010f9426):** STARTS_A_CONVERSATION_FIELDS, and the
        # canSpawn and canStaff fields it filtered, were deleted from capabilities.ts by D-014 ("no
        # `can_spawn` / `not-in-can-spawn`"; "the staffing carve-out [is] gone"). Its anchor is left
        # stale, so the census records it retired.
        "M2 · ⛔ the PAIR loses its second member at the source · every reader of "
        "`STARTS_A_CONVERSATION_FIELDS` goes back to one grant at once — the row, and anything that "
        "asks what answers this question later. ⚑ This is `511`'s world before the relay",
        [(CAPS, PAIR, "  (field) => field.key === 'canSpawn',\n")],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-014, 010f9426):** The ordered pair list
        # (STARTS_A_CONVERSATION_FIELDS) and the canStaff label built around "the grant above it"
        # were both deleted with can_spawn/can_staff. The commit says any agent may start a
        # conversation as any existing profile, so no grant pair is left to order. Its anchor is
        # left stale, so the census records it retired.
        "M3 · ⚠️ the pair is drawn in the other order · *May ALSO start conversations as* comes "
        "first, and the word `canStaff`'s label is built around — *the grant above it is the one a "
        "reader meets first* — points at nothing. ⛔ The order is the SCHEMA's and not this list's",
        [
            (
                CAPS,
                "export const STARTS_A_CONVERSATION_FIELDS: readonly AnyCapabilityField[] = CAPABILITY_FIELDS.filter(\n",
                "export const STARTS_A_CONVERSATION_FIELDS: readonly AnyCapabilityField[] = [...CAPABILITY_FIELDS].reverse().filter(\n",
            )
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-014, 010f9426):** This row draws canSpawn's line twice on
        # the team card. D-014 deleted the card's grant lines and the canSpawn field itself ("no
        # `can_spawn`"), and TeamWorkspace no longer imports grantLine. Its anchor is left stale, so
        # the census records it retired.
        "M4 · 🔴 the row draws the SAME grant twice · both lines read `canSpawn`'s sentence under "
        "`canSpawn`'s label, so the pair is a pair in the markup and one grant on the screen. ⛔ A "
        "test that counted the elements and stopped there would pass this",
        [
            (
                TEAM,
                RENDER,
                # ⚑ ANCHOR CORRECTED IN PLACE BY 714 — R41: the Team card hands `grantLine` the grant as a
                # person reads it (`namedGrants`, every identity NAMED); the defect planted is unchanged.
                "              >{{ grantLine(STARTS_A_CONVERSATION_FIELDS[0], namedGrants(member.identity.capabilities), null) }}</small\n",
            )
        ],
    ),
    # ---- the rule that says these two fields are the ones ------------------------------------------
    (
        # ⛔ **RETIRED BY RULING (landing D-014, 010f9426):** producesAConversationOfItsOwn was
        # deleted along with canSpawn and canStaff. Its anchor is left stale, so the census records
        # it retired.
        "M5 · ⛔ the rails and the row stop agreeing about what starts a conversation · "
        "`producesAConversationOfItsOwn` drops the staffing grant, so the app refuses a delegation "
        "it draws a sentence promising. ⚑ The list is only honest while it is the set this function "
        "reads, and nothing but a test can say so",
        [
            (
                CAPS,
                "  return held.canSpawn.length > 0 || held.canStaff !== 'none'\n",
                "  return held.canSpawn.length > 0\n",
            )
        ],
    ),
    # ---- one line, two audiences -------------------------------------------------------------------
    (
        # ⛔ **RETIRED BY RULING (landing D-014, 010f9426):** The line this row re-spells, the team
        # card's `grantLine(field, namedGrants(...), null)` interpolation, was deleted with the
        # grant pair and with `namedGrants`/`grantsAsAPersonReadsThem`. No renderer file calls
        # grantLine any more; only factory-text.ts does. Its anchor is left stale, so the census
        # records it retired.
        "M6 · ⚠️ the rail pairs the label and the value itself again · it renders exactly the same "
        "characters, so NOTHING a person or a DOM test can see changes — and the next rewording of "
        "one audience's line leaves the other behind. ⛔ This is the row the source census exists "
        "for, and `464` is what it costs",
        [
            (
                TEAM,
                RENDER,
                # ⚑ ANCHOR CORRECTED IN PLACE BY 714 — R41: the Team card hands `grantLine` the grant as a
                # person reads it (`namedGrants`, every identity NAMED); the defect planted is unchanged.
                "              >{{ field.label }}: {{ field.says(namedGrants(member.identity.capabilities)[field.key], null) }}</small\n",
            )
        ],
    ),
    # Retired: the edited operation or wording was deleted, rather than moved.
    # RETIREMENT APPROVED — 530 M7: anchor-absent; removed by 972f27788. Factory text deliberately stopped
    # sharing describeRail and CAPABILITY_FIELDS/grantLine. It now prints approved direct permission
    # sentences and a separately worded app-wide switch line. The mutation's shared-descriptor/string rule
    # is no longer a product property; re-targeting current values would measure a different property.
    # Definition retained as historical evidence; no row execution.
    (
        "M7 · ⛔ the instruction bundle stops sharing the line · a model reads the raw stored value "
        "instead of the field's own sentence, so `May start conversations as:` is followed by an "
        "array and `At once` by an object. ⚑ `485` moved that sentence onto the descriptor and this "
        "is the block walking around it",
        [
            (
                FACTORY,
                "  return CAPABILITY_FIELDS.map((field) => `- ${grantLine(field, allowed, at)}`)",
                "  return CAPABILITY_FIELDS.map((field) => `- ${field.label}: ${String(allowed[field.key])}`)",
            )
        ],
    ),
    # ---- the layout, because the layout is carrying the rule ---------------------------------------
    (
        "M8 · 🔴 THE DEFECT UNDER THE DEFECT, PUT BACK · the pair stops wrapping, so both lines "
        "ellipsize at the label in a 131 px column and a person reads *May start conversations as…* "
        "twice. ⛔ Every state, both widths, and `textContent` is identical either way — which is "
        "why nothing caught it for the whole life of this row"
        ". 🔴 **570 · THE SUBJECT OF THIS ANCHOR CHANGED AND THE ROW WAS KEPT — read this before trusting the sentence above.** ⛔ `EXT-008` §4.4 took the AGENTS section out of the navigation column, so `.grant` left `SideRail.vue` with the element that wore it and `570` wrote the shared box back into `.rail-copy small.says` as one rule. ⚠️ **What this edit now breaks is `531`'s three sentences and NOT the grant pair** — the pair is on `TeamWorkspace`'s card under a `.grant` rule of its own, unclamped and measured drawn-whole. ⛔ **So this row is a duplicate of `531 M6` in every respect except which table scores it**, kept for that bookkeeping reason alone: a table that dropped it would report the declaration uncovered for its own dispatch. ⚑ It is NOT retired, because the declaration it edits is still in this file and the edit is still a world a person can see — three rail sentences ellipsizing. ⚠️ **The clause about `531 M12`/`M13` putting the asymmetry back is withdrawn**: both were retired at `570`, because a one-member list cannot have a member taken out of it, and there is no asymmetry left to cover. · killed by `every-string-a-rail-row-does-not-draw.dom.test.ts`",
        # ⚑ **W4.205 · re-anchored in place, not retired** — W4.205 · 2ca719c5 added a second `white-space: normal;` (the rail's fixed destination names, `.rail-copy strong`); widened by the selector and its first line to land on `.rail-copy small.says` only. Killed by every-string-a-rail-row-does-not-draw.dom.test.ts 'is drawn whole' — but that file's clamp pin is red on HEAD (see 531 M9).
        [(RAIL, ".rail-copy small.says {\n  display: -webkit-box;\n  white-space: normal;\n", ".rail-copy small.says {\n  display: -webkit-box;\n  white-space: nowrap;\n")],
    ),
    (
        "M9 · ⛔ the clamp goes · a grant's sentence sets the height of a navigation row, so the one "
        "identity holding a 158-character staffing reach costs four lines more than its neighbours. "
        "⚑ `526`'s lever, removed: *a row's height stopped depending on the size of the text inside "
        "it*"
        ". 🔴 **RETIRED AT 570 — `anchor-absent`, and the subject is GONE rather than moved.** ⛔ "
        "`EXT-008` §1 sent these lines to a page *where there is room for them*, and `EXT-008` §4.4 "
        "took the section out of the rail; `TeamWorkspace`'s card draws the pair UNCLAMPED and "
        "`the-row-that-draws-one-of-two-grants.dom.test.ts` §2 measures every character of the "
        "158-character sentence painted with `drawn.ts`. ⚠️ **There is no `-webkit-line-clamp` on "
        "this pair anywhere in the tree**, so this row has nothing to make inert — it is not a "
        "moved anchor and correcting it would invent a clamp to have an opinion about.",
        # Keep this retired row bound to the deleted grant selector, not another two-line heading.
        [(RAIL, ".rail-copy small.grant {\n  -webkit-line-clamp: 2;\n}", ".rail-copy small.grant {\n}")],
    ),
    (
        "M10 · ⚠️ the clamp tightens to one line · the value falls off the bottom instead of the "
        "end, which is the same defect wearing the repair's own mechanism. ⛔ A bound is only a "
        "bound at the number it was measured at"
        ". 🔴 **RETIRED AT 570 with `M9`, and for the same reason** — a number that no longer "
        "exists cannot be tightened. ⚑ The bound it measured was arithmetic about a **131 px** "
        "column; the page has room and the sentence is drawn whole there, measured rather than "
        "assumed.",
        # The grant selector and the pair it bounded remain deleted.
        [(RAIL, ".rail-copy small.grant {\n  -webkit-line-clamp: 2;\n}", ".rail-copy small.grant {\n  -webkit-line-clamp: 1;\n}")],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-014, 010f9426):** The `:title` hatch belonged to the
        # canSpawn/canStaff grant pair on the TeamWorkspace card, and D-014 deleted that whole
        # `<span class="grant-pair">` block along with the two grants ("no `can_spawn`"; any agent
        # starts any profile). Its anchor is left stale, so the census records it retired.
        "M11 · ⛔ the sentence loses its hatch · the `:title` goes, so the whole of *any agent "
        "this app did not set up itself, including ones created after this was granted* is "
        "reachable only at whatever width it happens to fit. "
        "🔴 **570 · CORRECTED IN PLACE, and the SUBJECT narrowed — said plainly, because `M9` and "
        "`M10` beside it were RETIRED on the same fact.** ⛔ There is no clamp on `TeamWorkspace`, "
        "so nothing *ends four words in* and this row no longer measures a recovery. ⚑ **What it "
        "measures now is that the hatch deliberately OUTLIVED the clamp it used to recover from** "
        "— `526`'s pairing, kept because it costs nothing and a window narrower than either "
        "measured width exists. ⚠️ A correction and not a retirement, because the `:title` is "
        "really there and really asserted; the clamp is not.",
        # ⚑ ANCHOR CORRECTED IN PLACE BY 714 — R41: the Team card hands `grantLine` the grant as a
        # person reads it (`namedGrants`, every identity NAMED); the defect planted is unchanged.
        [(TEAM, '              :title="grantLine(field, namedGrants(member.identity.capabilities), null)"\n', "")],
    ),
    # ---- the address three suites and a live probe read ---------------------------------------------
    (
        # ⛔ **RETIRED BY RULING (landing D-014, 010f9426):** The `team-<slug>-line` hook was on the
        # grant-pair span that D-014 removed with can_spawn/can_staff. The commit also deleted
        # `scripts/capabilities-sheet-probe.mjs` and the suites that read the hook, so no element
        # and no reader is left. Its anchor is left stale, so the census records it retired.
        "M12 · ⚠️ the pair loses the hook · `rail-agent-<slug>-line` was one `<small>` and is the "
        "box around two, and three suites plus `capabilities-sheet-probe.mjs` address the row "
        "through it. ⛔ A hook that moves quietly takes every reader of it with it",
        [
            (
                TEAM,
                '          <span class="grant-pair" :data-cy="`team-${member.identity.slug}-line`">\n',
                '          <span class="grant-pair">\n',
            )
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-014, 010f9426):** The per-field `team-<slug>-grant-<key>`
        # hook family addressed the two start-a-conversation grants (canSpawn, canStaff). D-014
        # deleted both grants and the markup that drew them ("no `can_spawn`"; the staffing
        # carve-out is gone), so there is no family left to collapse. Its anchor is left stale, so
        # the census records it retired.
        "M13 · ⛔ the two grants share one address · the `data-cy` drops the field, so both lines "
        "answer to the same hook and a probe reading *the staffing line* is handed whichever came "
        "first. ⚑ `a-hook-family-must-be-built-from-a-template-literal`, and a family with one name "
        "is not a family",
        [
            (
                TEAM,
                '              :data-cy="`team-${member.identity.slug}-grant-${field.key}`"\n',
                '              :data-cy="`team-${member.identity.slug}-grant`"\n',
            )
        ],
    ),
    # ---- the other three declarations that make the block a block ----------------------------------
    #
    # ⚑ **Each of these is here because `a-line-no-mutation-can-kill-is-not-carrying-its-rule`.** The
    # clamp is FOUR declarations plus a class, and three of them look like boilerplate around
    # `-webkit-line-clamp`. ⛔ Every one of them is load-bearing: remove any and the row goes back to
    # growing with its text, which is the thing `526`'s lever exists to stop.
    (
        "M14 · ⚠️ the box goes · the element falls back to the `display: block` of the rule above, "
        "so `-webkit-line-clamp` binds to nothing and a 158-character grant sets the height of a "
        "navigation row. ⛔ A clamp is not one declaration"
        ". 🔴 **570 · SUBJECT CHANGED, ROW KEPT** — see `M8` above for the whole argument. ⛔ `.grant` left this file with the AGENTS section (`EXT-008` §4.4), so what this edit breaks is `531`'s three rail sentences and not the grant pair, which is unclamped on `TeamWorkspace`. ⚑ A duplicate of `531 M7` kept for bookkeeping, and the withdrawn clause about `531 M12`/`M13` covering the asymmetry is gone with those rows. · killed by `every-string-a-rail-row-does-not-draw.dom.test.ts`",
        # ⚑ **W4.205 · re-anchored in place, not retired** — W4.205 · the rail titles now clamp with their own display: -webkit-box line, so the anchor is widened to the explanatory-copy rule; the plant still drops the box and leaves the four-line clamp bound to nothing
        [(RAIL, ".rail-copy small.says {\n  display: -webkit-box;\n", ".rail-copy small.says {\n")],
    ),
    (
        "M15 · ⚠️ the box orients the other way · the clamp counts COLUMNS, so it stops counting "
        "lines and the row grows again. ⛔ The vendor pair is a pair"
        ". 🔴 **570 · SUBJECT CHANGED, ROW KEPT** — the vendor pair is one shared declaration on `.rail-copy small.says` now, so this breaks `531`'s three sentences. ⛔ A duplicate of `531 M8`, kept for the bookkeeping reason `530 M8` gives. · killed by `every-string-a-rail-row-does-not-draw.dom.test.ts`",
        # ⚑ **W4.205 · re-anchored in place, not retired** — W4.205 · the rail titles now clamp with their own -webkit-box-orient line, so the anchor is widened to the explanatory-copy rule; the plant still turns the box sideways so the four-line clamp stops bounding the height
        [(RAIL, ".rail-copy small.says {\n  display: -webkit-box;\n  white-space: normal;\n  -webkit-box-orient: vertical;\n", ".rail-copy small.says {\n  display: -webkit-box;\n  white-space: normal;\n  -webkit-box-orient: horizontal;\n")],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-014, 010f9426):** The `.grant` class and its `display:
        # block` rule were deleted together with the grant pair (the CSS block
        # `.grant-pair`/`.grant` is gone in the TeamWorkspace diff). Its measuring suite
        # `the-row-that-draws-one-of-two-grants.dom.test.ts` was deleted as a test of deleted code.
        # Its anchor is left stale, so the census records it retired.
        "M16 · ⛔ the element stops matching ANY of the rules · a stylesheet is only reachable "
        "through the class that mounts it — "
        "`scoped-css-is-unmeasurable-until-something-mounts-it`. "
        "🔴 **570 · CORRECTED IN PLACE, and the MECHANISM changed with the surface.** ⛔ On the "
        "rail this class matched a two-line clamp and a shared `-webkit-box`, so removing it sent "
        "the line back to `nowrap` and an ellipsis. ⚑ On `TeamWorkspace` the page's own `.grant` "
        "rule carries `display: block`, and that is the load-bearing declaration: without the "
        "class the two `<small>`s go inline and the pair runs together into ONE sentence a person "
        "reads as one grant — `530` F1 in a different mechanism, on the surface a person chooses "
        "a sheet from. ⚠️ **The row is only a measurement because the suite asserts the two "
        "grants STACK** (`the-row-that-draws-one-of-two-grants.dom.test.ts` §1); a `toEqual` over "
        "their text would not have noticed. ⚑ Confirmed RED by hand at `570`.",
        [(TEAM, '              class="grant"\n', "")],
    ),
]
