"""464 · The grant a person meant to give — the owner axis, and the verb `456` left behind.

⛔ **What this table is about.** `460` cleared the explanation everybody reached for first — *"the
permission change has not reached this conversation"* — and measured that it HAD: *"After a
successful `setCapabilities` call returns, the next BroBot-governed `spawn_agent` call from the
same live conversation reads the newly stored `canSpawn` grant. There is no post-commit
stale-admission window, and no restart is required."* 🔴 **So what cost the person two turns is the
surface**: the grant is plausible to give on the wrong field, or the right field on the wrong
identity.

## 🔴 The measurement this dispatch adds, and it is about `456`

`456` renamed `canSpawn`'s label from *May create agents as* to **May start conversations as** and
pinned that rename on the MODEL's side — the tool descriptions, and the grant block
`factory-text.ts` renders, where `the-text-a-child-is-actually-told.test.ts` reads the label out of
`CAPABILITY_FIELDS` rather than typing it. ⛔ **Nothing pinned the person's side.** Four sentences a
person reads about the same grant were literals and all four stayed on the retired verb:
`SPAWN_RAIL_MEANS`, `SPAWN_NATIVE_DELEGATION_MEANS`, the sheet header, and the rail's agent rows.
⚠️ **The second of those is the one that got worse rather than merely stale**: *"an identity that
may create agents"* stopped naming `canSpawn` and started reading as the field one row down, whose
label really is *May add new agents*. ⚑ `M1`, `M2`, `M3` and `M15` are those sentences put back.

## ⛔ The owner axis, which is the half a single-identity fixture cannot see

`464 §1.3`: *"A test that sets both to the same identity measures nothing — so the owner and the
target must differ in the fixture."* ⚑ `M13` is that rule as a defect: the sheet saves onto the
first row of the roster instead of the identity it was opened for. **The existing
`capabilities-sheet.dom.test.ts` cannot see it** — its fixture opens `pm`'s sheet over a roster
whose first row is `pm` — and it is caught only by the reversed orientation this dispatch added.

## 🔴 Which gate can see each row

| rows | the defect is caught by |
|---|---|
| `M1`-`M3`, `M5`, `M6`, `M10`, `M12`, `M15` | ⚑ **`apps/desktop/test/the-grant-a-person-meant-to-give.test.ts`** — ⚑ `M5` since `712`, which measured it SURVIVING the DOM file below on `main` (that file never reads the clause) and RED here, where §3 asserts *open its own sheet* |
| `M1`-`M2`, `M15` | ⚑ **`apps/desktop/test/consent-never-containment.test.ts`** |
| `M3` | ⚑ **`apps/desktop/test/the-drawing-arrives.test.ts`** §5 — `SPAWN_RAIL_MEANS`'s pinned length, one character longer with *creates* |
| `M4`, `M7`-`M9`, `M11`-`M14` | ⚑ **`apps/desktop/test/dom/the-grant-a-person-meant-to-give.dom.test.ts`** |
| `M10`-`M12` | ⚑ **`apps/desktop/test/dom/spawning-switch.dom.test.ts`** |
| `M17`, `M18` | ⚑ **`scripts/test/capabilities-probe-reach.test.mjs`** — the cheap gate that holds the live probe |

## ⛔ What this table deliberately does NOT contain

⚠️ **No row on the `RETIRED` list in `the-grant-a-person-meant-to-give.test.ts` §1.** That list IS
the census; editing it would be mutating a census with that census
(`a-mutation-on-a-census-is-invisible-to-that-census`). ⚑ Every row below mutates the PRODUCT
string the census reads instead.

⚠️ **No row making the DOM fixture's owner equal its target.** That is the test's own premise, and
a mutation there measures the fixture rather than the sheet — the same rule one artefact over.

⚠️ **No row on `spawn-safety.ts`' three switch sentences** — *"Agents may create conversations"*,
*"Press again to allow agents to create conversations"*, *"No agent can create a conversation"*.
🔴 **They carry the same retired verb and this dispatch did not change them**, deliberately: the
app-wide stop is not a grant, and `464 §2` scopes this dispatch to the grant surface. ⛔ A row here
would pin copy nothing in this dispatch owns. It is a finding in the response instead.

⚠️ **No row reverting `canSpawn`'s label itself.** `456` owns that string and
`two-verbs-one-sentence.test.ts` §4 already holds it; a row here would be a second table pinning
one line (`a-source-census-that-pins-a-line-kills-every-row-on-it`, one artefact over).
"""

from __future__ import annotations

CAPS = "apps/desktop/src/shared/capabilities.ts"
SHEET = "apps/desktop/src/renderer/src/components/CapabilitiesSheet.vue"
RAIL = "apps/desktop/src/renderer/src/components/SideRail.vue"
# 🔴 **570 · the AGENTS section left the navigation column** (`EXT-008` §4.4), and the roster
# row it drew is `TeamWorkspace`'s card. ⛔ **Every row below that pointed into that block is
# CORRECTED IN PLACE and re-verified RED one at a time, never retired** — the subject moved and
# only the bytes changed (`a-corrected-anchor-keeps-a-verdict-it-never-earned`).
TEAM = "apps/desktop/src/renderer/src/components/TeamWorkspace.vue"
PROBE = "scripts/capabilities-sheet-probe.mjs"

# ⚑ OWNER and DIRECTION CORRECTED IN PLACE BY 712 — R41 (`707` GAP-5): both sentences name the
# identity (`called`, `agentName` over the roster) where they printed the slug; every row below
# plants the defect it always did.
OWNER = (
    "        <small v-if=\"identity\" data-cy=\"capabilities-owner\"\n"
    "          >This is {{ called }}’s own row: every grant below is stored on it and read when a\n"
    "          conversation is running as {{ called }}. Any other identity named among them is one these\n"
    "          grants point at — to change what that one may do, open its own sheet.</small\n"
    "        >\n"
)

DIRECTION = (
    "        <p\n"
    "          v-if=\"field.editor === 'profile-list'\"\n"
    "          class=\"identity-note\"\n"
    "          :data-cy=\"`grant-${field.key}-direction`\"\n"
    "        >\n"
    "          Tick the identities {{ called }} {{ field.label.toLowerCase() }}. Saving writes\n"
    "          {{ called }}’s row and changes nothing about the identities you tick.\n"
    "        </p>\n"
)

MUTATIONS: list[tuple[str, list[tuple[str, str, str]]]] = [
    # ── §1 · the four sentences that kept the retired verb ──────────────────────────────────────
    (
        # ⛔ **RETIRED BY RULING (landing D-014, 010f9426):** The sentence it plants into,
        # SPAWN_NATIVE_DELEGATION_MEANS, was deleted on purpose. Its anchor is left stale, so the
        # census records it retired.
        "M1 · 🔴 THE SHIPPED DEFECT, PUT BACK: the native-delegation disclosure names the grant "
        "*may create agents* again · it is keyed on `canSpawn` — `nativeDelegationContext` answers "
        "on `capabilities.canSpawn.length > 0` — and that was `canSpawn`'s label when `408` wrote "
        "it. ⛔ After `456` the same words read as `canCreateAgents`, whose label really is *May "
        "add new agents*, so the sheet's own disclosure pointed at the field one row down",
        [
            (
                CAPS,
                "  'A conversation running as an identity that may start conversations as somebody has ' +\n",
                "  'A conversation running as an identity that may create agents has provider-native ' +\n",
            )
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-014, 010f9426):** This is the same deleted constant,
        # SPAWN_NATIVE_DELEGATION_MEANS, and its free-tier clause ('An identity granted nobody to
        # start') went with canSpawn. The card says 'no can_spawn' and 'the CLIs' own sub-agents
        # stay on for every agent', so no tier keeps or loses delegation. Its anchor is left stale,
        # so the census records it retired.
        "M2 · ⛔ the FREE tier's clause keeps the retired verb · the positive half of the same "
        "sentence — *an identity granted nobody* — and a disclosure that named the grant correctly "
        "in one clause and by its old name in the other is the shape a half-done rename leaves",
        [
            (
                CAPS,
                "  '`disallowedTools` excluding Agent, Workflow and Task. An identity granted nobody to start ' +\n",
                "  '`disallowedTools` excluding Agent, Workflow and Task. An identity granted nobody to ' +\n",
            )
        ],
    ),
    (
        "M3 · 🔴 `SPAWN_RAIL_MEANS` opens on the retired verb again · *A conversation an agent "
        "CREATES*, rendered directly above the control labelled *May start conversations as* — "
        "which is `460` F1's two-creation-like-sentences defect rebuilt out of the sentence that "
        "survived `456`. ⚑ It is also the row that puts the v2.7 copy difference back to a "
        "reproduction, so two independent gates see it",
        [
            (
                CAPS,
                # ⚑ ANCHOR CORRECTED IN PLACE BY 499 — `HO-036` rewrote the clause after the verb
                # and left the verb alone, which is exactly the rule this row is about. ⛔ Table
                # `464` is `unrun`; re-verified RED after the correction.
                # ⚑ Landing D-014 · re-anchored in place, not retired — D-014 moved the line break
                # (the dash now opens the next line) and kept the verb, and `456`'s split between
                # *creating* an agent and *starting* a conversation stands. ⚠️ Two things in the label
                # are no longer true: the *May start conversations as* control under the sentence is
                # gone, and the drawing's first clause has differed since `499`, so
                # the row no longer reproduces a v2.7 copy difference. D-014 also deleted its main
                # killer (the RETIRED sweep); the landing added a verb assertion in
                # `consent-never-containment.test.ts` §1. Re-verified RED alone.
                "  'A conversation an agent starts runs the way that agent does and can never be given more ' +\n",
                "  'A conversation an agent creates runs the way that agent does and can never be given more ' +\n",
            )
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-014, 010f9426):** This is the same deleted
        # SPAWN_NATIVE_DELEGATION_MEANS as M1. With no launch-time delegation switch left (D-014:
        # 'no Agent/Task/Workflow deny list for Claude, no agents.enabled=false for Codex'), no
        # disclosure is left to name a neighbouring grant. Its anchor is left stale, so the census
        # records it retired.
        "M15 · ⛔ the disclosure names the NEIGHBOURING grant, by its current label · the version a "
        "reviewer would wave through: *may add new agents* is a real label of a real field, and it "
        "is the wrong one — the launch reads `canSpawn` and nothing else. ⚠️ The shape `460` "
        "predicted a person would fall for, written into the app's own words",
        [
            (
                CAPS,
                "  'A conversation running as an identity that may start conversations as somebody has ' +\n",
                "  'A conversation running as an identity that may add new agents has provider-native ' +\n",
            )
        ],
    ),
    # ── §2 · the owner axis on the sheet ────────────────────────────────────────────────────────
    (
        "M4 · 🔴 the owner sentence names a slug instead of the prop · it reads correctly on the "
        "one sheet somebody tested and names the wrong identity on every other — the defect a "
        "fixture with a single identity in it could never show",
        [
            (
                SHEET,
                # ⚑ ANCHOR CORRECTED IN PLACE BY 712 — R41 (`707` GAP-5): the sentence names the identity
                # (`called`, `agentName`) where it printed the slug; the defect planted is unchanged.
                "          >This is {{ called }}’s own row: every grant below is stored on it and read when a\n",
                "          >This is pm’s own row: every grant below is stored on it and read when a\n",
            )
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-014, 010f9426):** The clause 'Any other identity named
        # among them ... open its own sheet' was removed on purpose. D-014's §3 test says 'the
        # second sentence is gone ... Its anchor is left stale, so the census records it retired.
        "M5 · ⛔ the sentence drops the clause that says where to change the OTHER identity · "
        "*to change what that one may do, open its own sheet* is the two turns the person lost: "
        "`admitSpawn` spends the live parent's grant, so granting on the target's sheet changes "
        "the target's own future spawns and refuses the caller exactly as before (`460` §4)",
        [
            (
                SHEET,
                # ⚑ ANCHOR CORRECTED IN PLACE BY 712 — R41 (`707` GAP-5): the sentence names the identity
                # (`called`, `agentName`) where it printed the slug; the defect planted is unchanged.
                "          conversation is running as {{ called }}. Any other identity named among them is one these\n"
                "          grants point at — to change what that one may do, open its own sheet.</small\n",
                "          conversation is running as {{ called }}.</small\n",
            )
        ],
    ),
    (
        "M14 · ⛔ the owner sentence is deleted and the header says nothing about whose grant this "
        "is · the state the sheet was in before this dispatch, minus the false sentence it had "
        "instead — which is the honest baseline: no owner axis at all",
        # ⚑ Landing D-014 · re-anchored in place, not retired — The owner sentence survives. D-014
        # rewrote its second clause but kept 'This is {{ called }}’s own row: every grant below is
        # stored on it...', and §3 of its test still pins it. Re-verified RED alone.
        [
            (SHEET, '        <small v-if="identity" data-cy="capabilities-owner"\n          >This is {{ called }}’s own row: every grant below is stored on it and read when a\n          conversation is running as {{ called }}. Any agent may start a conversation as\n          {{ called }}, and that conversation holds these grants.</small\n        >\n', ''),
        ],
    ),
    (
        "M16 · ⛔ the owner sentence loses its `v-if` and draws over the NO-ROW state · the header "
        "sits outside the body's `v-else` chain, so *this is `ghost`'s own row* renders directly "
        "above the paragraph saying there is no agent identity called `ghost` — a surface claiming "
        "a row the app has just refused to create (`009`). ⚑ Found reviewing this dispatch's own "
        "diff, and the sentence it replaced was vague enough to survive that state",
        [
            (
                SHEET,
                '        <small v-if="identity" data-cy="capabilities-owner"\n',
                '        <small data-cy="capabilities-owner"\n',
            )
        ],
    ),
    # ── §3 · the direction line, and whether it is DERIVED ──────────────────────────────────────
    (
        # ⛔ **RETIRED BY RULING (landing D-014, 010f9426):** The direction line 'Tick the identities
        # ...' was drawn only for the `profile-list` editor, which was canSpawn's. D-014 deleted
        # both: 'the sheet's grant picker and its direction line ... were DELETED'. Its anchor has
        # count 0 in CapabilitiesSheet.vue. Its anchor is left stale, so the census records it
        # retired.
        "M6 · 🔴 the direction line spells today's label instead of reading it · the value on "
        "screen is IDENTICAL, so every DOM assertion still passes and only the source census sees "
        "it. ⚑ That is the row's whole point: what `456` broke was not a wrong word on screen but "
        "a literal that could not follow a rename, and a test that only reads the screen cannot "
        "tell a derivation from a copy of its current output",
        [
            (
                SHEET,
                # ⚑ ANCHOR CORRECTED IN PLACE BY 712 — R41 (`707` GAP-5): the sentence names the identity
                # (`called`, `agentName`) where it printed the slug; the defect planted is unchanged.
                "          Tick the identities {{ called }} {{ field.label.toLowerCase() }}. Saving writes\n",
                "          Tick the identities {{ called }} may start conversations as. Saving writes\n",
            )
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-014, 010f9426):** Same deleted direction line as M6. The
        # canSpawn picker and its 'Tick the identities' sentence were removed with the grant (D-014:
        # 'the sheet's grant picker and its direction line ... were DELETED'). Its anchor is left
        # stale, so the census records it retired.
        "M7 · ⛔ …and the same literal, one rename behind · the direction line says *may create "
        "agents as*, which is what a hand-written sentence would say today if `456` had moved the "
        "label under it — the state the three sentences around it were actually in",
        [
            (
                SHEET,
                # ⚑ ANCHOR CORRECTED IN PLACE BY 712 — R41 (`707` GAP-5): the sentence names the identity
                # (`called`, `agentName`) where it printed the slug; the defect planted is unchanged.
                "          Tick the identities {{ called }} {{ field.label.toLowerCase() }}. Saving writes\n",
                "          Tick the identities {{ called }} may create agents as. Saving writes\n",
            )
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-014, 010f9426):** The clause 'changes nothing about the
        # identities you tick' belonged to the deleted canSpawn picker's direction line. No checkbox
        # list of identities is left on the sheet. Its anchor is left stale, so the census records
        # it retired.
        "M8 · ⛔ the direction line drops the clause that says a tick changes nothing about the "
        "identity ticked · the wrong-OWNER half of `460` F1: a tick writes the row of the sheet "
        "that is open and no other, and without the clause a list of checkboxes reads as a list of "
        "permissions being handed out",
        [
            (
                SHEET,
                # ⚑ ANCHOR CORRECTED IN PLACE BY 712 — R41 (`707` GAP-5): the sentence names the identity
                # (`called`, `agentName`) where it printed the slug; the defect planted is unchanged.
                "          {{ called }}’s row and changes nothing about the identities you tick.\n",
                "          {{ called }}’s row.\n",
            )
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-014, 010f9426):** The `profile-list` editor kind was
        # deleted from CapabilityEditor ('One word from a closed vocabulary. Every other field.'),
        # along with the paragraph it gated. There is no identity-ticking paragraph left to escape
        # onto other controls. Its anchor is left stale, so the census records it retired.
        "M9 · ⚠️ the direction line is drawn under EVERY capability · a sentence about ticking "
        "identities under a `<select>` of three words, which is the failure mode of a component "
        "that enumerates a schema: a control written for one editor kind escaping to the others",
        [
            (
                SHEET,
                "        <p\n          v-if=\"field.editor === 'profile-list'\"\n          class=\"identity-note\"\n",
                "        <p\n          v-if=\"field.label !== ''\"\n          class=\"identity-note\"\n",
            )
        ],
    ),
    # ── §4 · the rail, where a person chooses whose sheet to open ───────────────────────────────
    (
        # ⛔ **RETIRED BY RULING (landing D-014, 010f9426):** D-014 deleted the Team card's grant
        # pair: the `v-for="field in STARTS_A_CONVERSATION_FIELDS"` block and its `grantLine(...)`
        # small. Its test says 'the Team card's grant pair were DELETED — any agent may start a
        # conversation as any identity'. Its anchor is left stale, so the census records it retired.
        "M10 · 🔴 the rail row spells the grant again · *May create* on the row a person presses "
        "to open the sheet where the same grant is labelled *May start conversations as*. ⛔ One "
        "grant, two surfaces, two verbs — and this surface is where the WRONG-IDENTITY half of "
        "`460` F1 begins",
        # ⚑ **485 · the row's line gained the VALUE beside the label**, so the anchor was the whole
        # line; **530 · the row draws a PAIR of grants through one shared `grantLine`**, so it is
        # the rendered expression. ⛔ **The mutation is unchanged in both moves** — a verb is spelled
        # onto the row instead of read off the schema, and it is spelled onto BOTH grants now, which
        # is strictly more of what this row has twice been wrong about.
        # ⚑ **544 · re-anchored, not retired** (standing rule 27 / `528`). ⛔ `grantLine` takes a
        # third argument now — WHICH question is being asked, the grant a person edits or what one
        # conversation may do — and this row's subject is untouched: a verb spelled onto the row
        # instead of read off the schema.
        [
            (
                # ⚑ **570 · MOVED.** The row a person presses to choose whose sheet to open is
                # `TeamWorkspace`'s card (`EXT-008` §4.4); the spelling is unchanged and only the
                # file and the loop variable moved with it.
                TEAM,
                # ⚑ ANCHOR CORRECTED IN PLACE BY 714 — R41: the Team card hands `grantLine` the grant as a
                # person reads it (`namedGrants`, every identity NAMED); the defect planted is unchanged.
                # ⚠️ **And MEASURED SURVIVING on `main` `c56b27d2`** against its named killer (and against
                # `two-verbs-one-sentence` and `spawning-switch.dom`): the census found the call's substring
                # beside the typed label. 714 made the census pin the element's whole text; RED since.
                "              >{{ grantLine(field, namedGrants(member.identity.capabilities), null) }}</small\n",
                "              >May create: {{ grantLine(field, namedGrants(member.identity.capabilities), null) }}</small\n",
            )
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-014, 010f9426):** The `says` it empties was canSpawn's
        # list word ('none by name'), and canSpawn was deleted by the card ('no can_spawn'). The
        # test states 'the empty word went with the grant that had one (`canSpawn`, a list)'. Its
        # anchor is left stale, so the census records it retired.
        "M11 · ⚠️ an identity granted nobody prints an empty tail · *May start conversations as:* "
        "with nothing after the colon, which reads as a value the app failed to render rather than "
        "as the narrowest grant there is — and since 485 the same word is what the MODEL reads, so "
        "one edit empties the tail on the rail and in every agent's instructions at once",
        # 🔴 **485 · the word moved off this surface and the row followed it.** ⚠️ The label's last
        # clause used to end *"so the rail would be the only reader of this grant that says nothing
        # at all"*, and that is no longer true in the direction that matters: `CapabilityField.says`
        # is the single author, so emptying it reaches both readers. ⛔ **Corrected in place rather
        # than retired** — the defect it measures is the same one, and it now measures it on more
        # surfaces than it could before.
        #
        # ⚑ **590 · RE-ANCHORED, not retired.** The empty word gained two — `none by name` — after
        # BroBot read a bare `none` beside a staffing rule and reported the pair as a contradiction.
        # ⛔ **The subject is untouched**: this row still empties the tail, on the rail and in every
        # agent's instructions at once, and `a-corrected-anchor-keeps-a-verdict-it-never-earned` is
        # why it is re-verified rather than carried.
        [
            (
                CAPS,
                "    says: (held) => (held.length === 0 ? 'none by name' : held.join(', ')),",
                "    says: (held) => (held.length === 0 ? '' : held.join(', ')),",
            )
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-014, 010f9426):** STARTS_A_CONVERSATION_FIELDS, the
        # canSpawn/canStaff filter, was deleted together with both grants (D-014: 'the staffing
        # carve-out' and can_spawn are gone). No starting grants are left for a neighbour to be
        # substituted into. Its anchor is left stale, so the census records it retired.
        "M12 · 🔴 the rail reads the NEIGHBOURING field's label · the row summarises `canSpawn`'s "
        "value under `canCreateAgents`' name, so the rail tells a person that an identity *May add "
        "new agents: worker* when what it may do is start a conversation as `worker`. ⛔ `460`'s "
        "two adjacent creation-like grants, collapsed into one line",
        # 🔴 **530 · re-aimed onto the SCHEMA, because the rail stopped naming a grant at all.**
        # ⛔ The row used to hold `capabilityField('canSpawn').label` in a `const`; it now walks
        # `STARTS_A_CONVERSATION_FIELDS`, so the place a neighbouring creation-like grant can be
        # substituted is the filter that builds that pair. ⚑ **The claim is untouched**: the row
        # summarises one grant under the name of the field beside it, and `460`'s two adjacent
        # creation-like grants end up collapsed onto one line.
        [
            (
                CAPS,
                "  (field) => field.key === 'canSpawn' || field.key === 'canStaff',\n",
                "  (field) => field.key === 'canSpawn' || field.key === 'canCreateAgents',\n",
            )
        ],
    ),
    # ── §4b · the LIVE instrument, which is the reader the cheap gate caught ────────────────────
    (
        # ⛔ **RETIRED BY RULING (landing D-014, 010f9426):** D-014 deleted
        # scripts/capabilities-sheet-probe.mjs (652 lines) and its `probe:capabilities` package
        # script. The probe ticked a canSpawn grant (`[data-cy=capability-canSpawn]`,
        # `team-pm-grant-canSpawn`) and asserted the rail sentence as 'above the canSpawn control'.
        # Its anchor is left stale, so the census records it retired.
        "M17 · 🔴 the live probe goes back to expecting the retired sentence · `368`'s "
        "`assertTheRailIsDisclosed` asserts `SPAWN_RAIL_MEANS` on the real screen by LITERAL, and "
        "`464` moved that sentence — so the probe was a FIFTH reader of the renamed grant and the "
        "one `pnpm run ci` found. ⚑ It is a literal on purpose: a probe that imported the schema "
        "could not fail when the schema and the screen disagreed, which is the whole of what it is "
        "for",
        [
            (
                PROBE,
                # ⚑ ANCHOR CORRECTED IN PLACE BY 499 — the probe's literal moved with the
                # sentence, which is the fifth reader this row exists to name.
                "    const buys = 'A conversation an agent starts runs the way that agent does and can never be given more'\n",
                "    const buys = 'A conversation an agent creates runs the way that agent does and can never be given more'\n",
            )
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-014, 010f9426):** The same deleted probe as M17. Its
        # `UNGRANTED = 'May start conversations as: none'` read the canSpawn grant pair on the Team
        # card, and D-014 removed that pair and the grant. Its anchor is left stale, so the census
        # records it retired.
        "M18 · ⛔ the probe's rail expectation goes back to the retired line · *May create no "
        "agents* on the live screen, which is the string `456` made stale and nothing caught. ⚠️ "
        "**And the pin that should have caught it was satisfied by a COMMENT**: the docblock in "
        "`SideRail.vue` recording the removal kept `capabilities-probe-reach.test.mjs`' row green "
        "until `464` taught it to strip prose",
        # ⚑ **530 · the probe reads the PAIR now and its sentences moved into named constants**,
        # because it compares two of them. ⛔ **The mutation is the same one**: the expectation goes
        # back to the string `456` retired, on the live screen.
        [
            (
                PROBE,
                "const UNGRANTED = 'May start conversations as: none'\n",
                "const UNGRANTED = 'May create no agents'\n",
            )
        ],
    ),
    # ── §5 · the owner, on the wire ─────────────────────────────────────────────────────────────
    (
        "M13 · 🔴 SAVE WRITES ONTO THE FIRST ROW OF THE ROSTER, not the identity the sheet was "
        "opened for · the wrong-owner grant as code. ⛔ **The existing sheet test cannot see it**: "
        "its fixture opens `pm`'s sheet over a roster whose first row is `pm`, so owner and target "
        "agree and the comparison measures nothing. ⚑ Only the reversed orientation this dispatch "
        "added — `worker`'s sheet, `pm` ticked — separates them. ⚠️ **Re-anchored by `516`**, which "
        "gave the save a third argument; the row writes onto the wrong identity exactly as before",
        [
            (
                SHEET,
                "  saveRefusal.value = await store.save(props.profileSlug, grant(), grantedServers.value)\n",
                "  saveRefusal.value = await store.save(\n"
                "    store.identities.value?.identities[0]?.slug ?? props.profileSlug,\n"
                "    grant(),\n"
                "    grantedServers.value,\n"
                "  )\n",
            )
        ],
    ),
]
