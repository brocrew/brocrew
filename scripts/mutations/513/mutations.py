"""513 · a sheet that grants one right and withholds its pair — each row is THE DEFECT, put back (131).

🔴 **From the person, in order.** A project manager was refused `not-in-can-spawn` and told him a person
had to grant it. ⚑ He opened the capability sheet and widened `can_spawn`. ⛔ **The next call was
refused again — `may-not-create-agents`** — a second grant the sheet had never mentioned.

> ⚑ **The PO:** *"A sheet that grants one right and silently withholds its pair is a person doing
> the right thing and meeting a second wall."*

## ⚠️ The pairing was already written down, and it was addressed to the wrong reader

`SEEDED_GRANTS`' docblock in `runtime-ipc.ts` holds the rule — *"The day `canSpawn` is widened for
an identity, this is widened in the same gesture, and the dispatch that does it reads this paragraph
first."* ⛔ **That sentence is addressed to a DISPATCH AUTHOR.** The rule held for the seed and was
invisible at the one surface where a person exercises it.

## ⛔ The five properties these rows guard

 1. ⚑ **It is DRAWN, unconditionally** — a sentence that appeared only once a grant had been
    widened would be a sentence that has to predict the mistake.
 2. 🔴 **It is drawn ABOVE the first control** — `367` §2: a person is told what a thing does
    before they choose it, not in a footnote under the checkbox they already ticked.
 3. ⛔ **Both grants are named by the SCHEMA's own labels, interpolated** — `464` is the defect:
    a sentence *"keyed on the grant"* that spelled it, renamed by `456`, silently re-pointed at the
    field one row down.
 4. 🔴 **The last clause says the EFFECT of an unchosen column and never its value** — `Default` is
    stored as `null`, which is *nobody has chosen* and not *no*; the effect is the same only while
    `canCreateAgents`' ruled default is the word that allows nothing.
 5. ⛔ **It added no gate and no second write** — `HO-005`: the human is unrestricted, and an
    identity that starts existing agents and mints none is a legitimate choice.

## 🔴 The gate map — which file kills which row

| rows | killer |
|---|---|
| M1, M2, M9 | `apps/desktop/test/dom/the-right-a-sheet-withholds.dom.test.ts` §1 |
| M3 | …the same file's §1 — the geometry, above the first control |
| M4, M5, M6 | `apps/desktop/test/the-right-a-sheet-withholds.test.ts` §1 — what the sentence claims |
| M7 | …the same file's §2 — built from the descriptors, neither label spelled |
| M8 | …the same file's §1 — the clause pinned to `ruled`, asserted BY NAME |
| M10 | …the same file's §3 — `identity-note`, not the sheet's alert `note` |
| M11, M12 | `the-right-a-sheet-withholds.dom.test.ts` §2 — a real press, and one command |

⛔ **The table was NOT run.** Every row below was applied ALONE, watched go red against the gate
named above with its own controls green first, and restored from bytes with a SHA-256 re-check —
which is what `verify-each-mutation-row` is for and is not the same claim as a table run.

## ⚠️ What is deliberately NOT here

 - ⛔ **No row on `SPAWN_RAIL_MEANS` or `SPAWN_NATIVE_DELEGATION_MEANS`.** `368` and `464` own those
   two sentences and their placement; a row here would be this dispatch inheriting a verdict it
   never earned (`a-corrected-anchor-keeps-a-verdict-it-never-earned`).
 - ⛔ **No row on `canSpawn`'s or `canCreateAgents`' `help`.** Neither moved. `456` and `419` own
   their wording, and pinning one rule in two tables is how a verdict comes to be inherited.
 - ⚠️ **No row on `canCreateAgents`' `narrowest`.** It equals `ruled` on this field and the schema
   says so out loud — *"no test and no mutation on this row can tell those values apart"* — so a
   row there would be `a-true-mutation-measures-nothing` with the schema's own warning above it.
 - ⚠️ **No row on `.identity-note`'s CSS.** A deleted declaration lands on the BASE style, which at
   the one width the sheet mounts is indistinguishable (`a-style-mutations-control-is-the-fallback`).
 - ⛔ **No row on this dispatch's own census regeneration.** *A mutation on a census is invisible to
   that census.*
"""

SHEET = "apps/desktop/src/renderer/src/components/CapabilitiesSheet.vue"
SCHEMA = "apps/desktop/src/shared/capabilities.ts"

PARAGRAPH = (
    '      <p class="identity-note" data-cy="starting-is-not-adding">'
    "{{ STARTING_IS_NOT_ADDING }}</p>\n"
)

MUTATIONS = [
    # ── it is drawn, and it is drawn where a person meets it ────────────────────────────────────
    (
        # ⛔ **RETIRED BY RULING (landing D-014, 010f9426):** D-014 deleted STARTING_IS_NOT_ADDING
        # (the canSpawn/canCreateAgents pairing sentence) and its paragraph on the sheet, together
        # with the can_spawn grant it paired. Its anchor is left stale, so the census records it
        # retired.
        "M1 · ⛔ the sentence is not drawn at all · the state the person met, restored — the sheet grants "
        "one right and says nothing about its pair",
        [(SHEET, PARAGRAPH, "")],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-014, 010f9426):** The row makes the
        # starting-is-not-adding paragraph conditional. D-014 deleted the paragraph and its constant
        # along with the can_spawn grant ('no can_spawn'). Its anchor is left stale, so the census
        # records it retired.
        "M2 · 🔴 it appears only after an edit · `moved.size` is *what you have changed here*, so "
        "the disclosure arrives once the person has already ticked the box — a sentence that has to "
        "predict the mistake, which is the shape the dispatch names and refuses",
        [
            (
                SHEET,
                '      <p class="identity-note" data-cy="starting-is-not-adding">',
                '      <p v-if="moved.size > 0" class="identity-note" data-cy="starting-is-not-adding">',
            )
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-014, 010f9426):** The row moves the
        # starting-is-not-adding paragraph below the controls. D-014 deleted that paragraph and
        # STARTING_IS_NOT_ADDING together with can_spawn, so nothing is left to place. Its anchor is
        # left stale, so the census records it retired.
        "M3 · ⚠️ it moves below the controls · `367` §2 inverted — the footnote under the checkbox "
        "they already ticked, which is the placement this sheet's own comment refuses",
        [
            (SHEET, PARAGRAPH, ""),
            (
                SHEET,
                '      <p class="identity-note" data-cy="capabilities-fold-note">',
                PARAGRAPH + '      <p class="identity-note" data-cy="capabilities-fold-note">',
            ),
        ],
    ),
    # ── what the sentence claims ────────────────────────────────────────────────────────────────
    (
        # ⛔ **RETIRED BY RULING (landing D-014, 010f9426):** The row re-points the canSpawn label
        # slot in STARTING_IS_NOT_ADDING. D-014 deleted the constant and the canSpawn field it
        # interpolated: 'can_spawn … unread and unwritten'. Its anchor is left stale, so the census
        # records it retired.
        "M4 · 🔴 it points at the neighbour · `464`'s defect exactly: the slot that should name what "
        "this identity may START names what it may ADD, so the sentence is about one grant twice "
        "and the widened one is never mentioned",
        [
            (
                SCHEMA,
                "  `Widening “${capabilityField('canSpawn').label}” widens nothing else",
                "  `Widening “${capabilityField('canCreateAgents').label}” widens nothing else",
            )
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-014, 010f9426):** The subject is the clause in
        # STARTING_IS_NOT_ADDING that names canCreateAgents as the pair of the start grant. D-014
        # deleted the sentence because the start grant is gone: any agent starts any existing
        # profile. Its anchor is left stale, so the census records it retired.
        "M5 · ⛔ it stops saying WHERE the pair lives · the person is told the grant they widened "
        "buys nothing else and is not told which control does — a refusal with no remedy, which is "
        "`send-refusals.ts`' own rule inverted",
        [
            (
                SCHEMA,
                "  `into existence is “${capabilityField('canCreateAgents').label}”, and an identity nobody has `",
                "  `into existence is a separate grant, and an identity nobody has `",
            )
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-014, 010f9426):** The row adds a count ('one of the two
        # grants') to STARTING_IS_NOT_ADDING. D-014 deleted that sentence, and can_create_projects
        # went with it, so no text is left to count in. Its anchor is left stale, so the census
        # records it retired.
        "M6 · ⚠️ it counts · *the two grants* goes false the day a third creation-shaped one is "
        "added, and `canCreateProjects` is already the third — the UI twin of "
        "`never-name-a-count-of-surfaces-in-a-brief`",
        [
            (
                SCHEMA,
                "” widens nothing else — bringing a new agent `",
                "” is one of the two grants here — bringing a new agent `",
            )
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-014, 010f9426):** The row spells out the two interpolated
        # labels in STARTING_IS_NOT_ADDING. D-014 deleted the constant along with the canSpawn field
        # whose label it built. Its anchor is left stale, so the census records it retired.
        "M7 · 🔴 the labels are SPELLED instead of built · the same bytes today and `464` tomorrow: "
        "a rename moves the control and leaves the sentence pointing at the field beside it",
        [
            (
                SCHEMA,
                "  `Widening “${capabilityField('canSpawn').label}” widens nothing else — bringing a new agent ` +\n"
                "  `into existence is “${capabilityField('canCreateAgents').label}”, and an identity nobody has ` +\n",
                "  'Widening “May start conversations as” widens nothing else — bringing a new agent ' +\n"
                "  'into existence is “May add new agents”, and an identity nobody has ' +\n",
            )
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-014, 010f9426):** The row widens canCreateAgents' ruled
        # default from 'none' to 'any'. D-014 made exactly that change on purpose (the diff has `-
        # ruled: 'none',` / `+    ruled: 'any',` under '🔴 D-014 · `any` — every agent may create an
        # agent'; card: 'give/message/create_agent open'). Its anchor is left stale, so the census
        # records it retired.
        "M8 · ⛔ the ruled default is widened under the sentence · the last clause becomes false "
        "about every row that has chosen nothing, and nothing but the pin by name would notice — "
        "standing rule 5",
        [
            (
                SCHEMA,
                "    ruled: 'none',\n    narrowest: 'none',\n    vocabulary: [...CREATION_REACH],\n"
                "    whenItTakesEffect: null,\n  },\n  {\n    key: 'takesWorkFrom',",
                "    ruled: 'any',\n    narrowest: 'none',\n    vocabulary: [...CREATION_REACH],\n"
                "    whenItTakesEffect: null,\n  },\n  {\n    key: 'takesWorkFrom',",
            )
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-014, 010f9426):** The row replaces {{
        # STARTING_IS_NOT_ADDING }} with a paraphrase. D-014 deleted that constant and its paragraph
        # together with the can_spawn grant. Its anchor is left stale, so the census records it
        # retired.
        "M9 · ⚠️ the paragraph renders a paraphrase instead of the constant · the sheet authors its "
        "own copy about a grant, which is the two-authors shape `485` spent a dispatch removing",
        [
            (
                SHEET,
                "{{ STARTING_IS_NOT_ADDING }}</p>",
                "Starting and adding are separate grants.</p>",
            )
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-014, 010f9426):** The row changes the class of the
        # starting-is-not-adding paragraph. D-014 deleted that paragraph and STARTING_IS_NOT_ADDING,
        # because the can_spawn grant the sentence disclosed is gone ('no can_spawn /
        # not-in-can-spawn'). Its anchor is left stale, so the census records it retired.
        "M10 · ⛔ a disclosure drawn as an objection · this sheet's `.note` is `display: flex` with "
        "an alert glyph as its first item, so the sentence reads as a complaint about a choice the "
        "person is entitled to make — `approval-mode.ts`' rule and `367` M18's trap",
        [
            (
                SHEET,
                '      <p class="identity-note" data-cy="starting-is-not-adding">',
                '      <p class="note" data-cy="starting-is-not-adding">',
            )
        ],
    ),
    # ── it added no gate and no second write ────────────────────────────────────────────────────
    (
        # ⛔ **RETIRED BY RULING (landing D-014, 010f9426):** The row gates Save on a widened
        # 'profile-list' start grant. D-014 removed can_spawn and with it the profile-list editor
        # (the diff drops every `field.editor === 'profile-list'` branch). There is no start grant
        # left to widen, so the planted gate has nothing to read. Its anchor is left stale, so the
        # census records it retired.
        "M11 · 🔴 Save becomes a gate · the sheet refuses to write a widened start grant while the "
        "add grant is on its default — `HO-005`'s *the human is unrestricted*, reversed, and "
        "`HO-042` §4.2 says that state is the COMMON case rather than an error",
        [
            (
                SHEET,
                "const blocked = computed(() => saving.value || tooManyGrants.value !== null)",
                "const blocked = computed(\n"
                "  () =>\n"
                "    saving.value ||\n"
                "    tooManyGrants.value !== null ||\n"
                "    props.fields.some((f) => f.editor === 'profile-list' && asList(f.key).length > 0),\n"
                ")",
            )
        ],
    ),
    (
        "M12 · ⛔ one button, two commands · the sheet writes the pair as well, which is the second "
        "control its own docblock refuses: *two commands behind one button can half-succeed, and "
        "the sheet would then have to draw a state that is neither saved nor unsaved*. ⚠️ "
        "**Re-anchored by `516`**, which gave the save a third argument — and note the direction: "
        "`516` put the external-server grants ON this one command for exactly the reason this row "
        "defends, so the rule held rather than being widened",
        [
            (
                SHEET,
                "  saveRefusal.value = await store.save(props.profileSlug, grant(), grantedServers.value)\n",
                "  saveRefusal.value = await store.save(props.profileSlug, grant(), grantedServers.value)\n"
                "  if (saveRefusal.value === null)\n"
                "    saveRefusal.value = await store.save(props.profileSlug, grant(), grantedServers.value)\n",
            )
        ],
    ),
]
