"""485 · what am I allowed to do — HO-031 §2.3, the instruction half.

⛔ **One question, in three parts, and every row is one way an agent stops being able to answer
it.**

 1. **The sentence is a FIELD of the grant.** ⚠️ Until this dispatch the VALUE on every line a
    model reads came out of `CAPABILITY_VALUES`, a `Record<CapabilityKey, (allowed:
    ProfileCapabilities) => string>` living in `factory-text.ts` — a sentence about a grant, kept
    where the grant cannot see it, keyed by a spelling. ⛔ That is `464`'s defect in the one place
    every agent reads, and `470` had already closed the same class for `whenItTakesEffect`.
    ⚑ §1's rows are the ways the pairing can come apart again.
 2. **A first launch is told what it may do.** ⛔ `instructionContext` composes before
    `store.create` writes the identity row (`402` F3's ordering, unchanged), and it used to pass
    the store's `null` on as though it were an answer. ⚠️ `409` seeded BroBot `can_spawn`, so what
    shipped was a first session told *You may start no conversation of your own* while
    `admitSpawn` would have admitted the spawn — **`409`'s own table pinned that disagreement as a
    test and left it open**, and HO-031 §1 is a person watching it happen. ⚑ §2's rows put each
    half of the repair back.
 3. **The one fact the capability shape cannot carry.** `app_policy.spawning_enabled` is one
    CHECK-pinned row for the whole app; while it is off, `May start conversations as: …` is a
    promise this app will not keep. §4's rows are the disclosure and its condition.

🔴 **Every row is one sentence an agent reads, or one rule that decides what that sentence says.**

⚠️ **What this table deliberately does NOT contain.**

 - ⛔ **No row on `canSpawn`'s empty-grant word.** `464` M11 already anchors it, and 485 corrected
   that anchor onto `CapabilityField.says` when the word moved there. ⚑ Adding a second row on the
   same bytes would be this table claiming a measurement another table earned
   (`a-corrected-anchor-keeps-a-verdict-it-never-earned`).
 - ⛔ **No row on the two reach fields' admits sentence.** Same reason: `449` M4 and M5 moved with
   the sentence and still say exactly what they said.
 - ⛔ **No row on the rail's label.** `464` M10.
 - ⛔ **No row on `says`' narrow signature or on `grantSays`' cast.** *A field is handed its own
   value and can reach no neighbour* is a fact about a TYPE; no edit to the text can express its
   absence, and a row that could not fail is not carrying its rule
   (`a-line-no-mutation-can-kill-is-not-carrying-its-rule`). ⚑ `M3` reaches the nearest reachable
   half — the call site passing the wrong value — and the property itself is measured at runtime
   by §10's neighbour test.
 - ⛔ **No row on the preamble's *read when this conversation started* clause.** Nothing in this
   app pushes a grant into a running conversation (`460` F3, unclosed), so a row deleting that
   clause would leave a sentence that is still true today and measure nothing
   (`a-true-mutation-measures-nothing`).
   ⚑ **573 · that is no longer true and `M18` is the row.** ⛔ The clause used to be the WHOLE of
   what the preamble said about time, so deleting it removed a true sentence; HO-068 §2 added the
   half that says the checks are NOT a photograph, and deleting that leaves a bundle whose only
   temporal claim is the stale one — which is exactly what BroBot reasoned from and got wrong.

⛔ **Evidence this table is honest about what it can reach.** Every row was applied alone, its own
killer file run, and the tree restored from bytes and hashed — the whole table has NOT been run
under the driver, so `CENSUS.md` records it `unrun` and no verdict is claimed here.

🔴 **The gate map** — which file kills which row:

| rows | killer |
|---|---|
| M1, M2, M3 | `apps/desktop/test/the-text-a-child-is-actually-told.test.ts` §10, the line and the neighbour |
| M4, M5, M6 | …and §10's distinctness test, which is the half a layout test cannot see |
| M7 | `apps/desktop/test/the-grant-a-person-meant-to-give.test.ts` §2, the source census |
| M8, M9, M10 | `apps/desktop/test/a-top-tier-that-can-delegate.test.ts` §5 and `…told.test.ts` §8 |
| M11 | `…told.test.ts` §8, the narrowing a person made |
| M12, M13 | `…told.test.ts` §3, the no-identity branch |
| M14, M15, M16 | `…told.test.ts` §10's switch test, and §8 for the wiring |
| M17 | `…told.test.ts` §10, the preamble |
"""

CAPS = "apps/desktop/src/shared/capabilities.ts"
FACTORY = "apps/desktop/src/main/runtime/factory-text.ts"
HOST = "apps/desktop/src/main/runtime/runtime-host.ts"
STORE = "apps/desktop/src/main/db/session-store.ts"
RAIL = "apps/desktop/src/renderer/src/components/SideRail.vue"
# 🔴 **570 · the AGENTS section left the navigation column** (`EXT-008` §4.4), and the roster
# row it drew is `TeamWorkspace`'s card. ⛔ **Every row below that pointed into that block is
# CORRECTED IN PLACE and re-verified RED one at a time, never retired** — the subject moved and
# only the bytes changed (`a-corrected-anchor-keeps-a-verdict-it-never-earned`).
TEAM = "apps/desktop/src/renderer/src/components/TeamWorkspace.vue"

# ⚑ The three word-valued grants share one body — one sentence, three fields — so each anchor
# carries the comment line above it. An anchor has to resolve exactly once.
CREATE_AGENTS_SAYS = (
    "    // the toolset the model is handed; the grant is what this line is about.\n"
    "    says: (held) => held,"
)
TAKES_WORK_SAYS = "    // stakes of a security sentence.\n    says: (held) => held,"
CREATE_PROJECTS_SAYS = (
    "    // toolset it is handed, and a sentence here claiming one would go false the day it moved.\n"
    "    says: (held) => held,"
)

HOST_FALLBACK = (
    "      capabilities:\n"
    "        profileSlug === null\n"
    "          ? null\n"
    "          : (this.deps.store.capabilitiesOf(profileSlug) ??\n"
    "            grantsThisLaunchWillRecord(profileSlug)),"
)

MUTATIONS = [
    # ─────────────────────────────── §1 · the sentence is a field of the grant it describes
    # Re-anchored, NOT VERIFIED and HELD; its test publishes provider-home files.
    ('M1 · 🔴 the line loses its value · every grant prints as a label and a bullet, so an agent reads the NAMES of eight things it may or may not do and the value of none of them. ⛔ This is the state a `says` that returned nothing would produce, reached from the layout instead', [('apps/desktop/src/main/runtime/factory-text.ts', 'function capabilityLines(allowed: ProfileCapabilities, at: ConversationAtLaunch): string[] {\n  const lines = [\n    allowed.canMessage === \'any\'\n      ? \'- You may message any conversation.\'\n      : \'- You may not send messages to other conversations.\',\n    allowed.canAssignWork === \'any\'\n      ? \'- You may give work to any agent, through your own conversation with it.\'\n      : \'- You may not give work to other agents.\',\n    allowed.canCreateAgents === \'any\'\n      ? \'- You may create agents and give them their initial rules.\'\n      : \'- You may not create agents.\',\n    `- ${RULE_WRITING_POLICY}`,\n  ]\n  const remaining = allowed.maxDepth - at.depth\n  if (allowed.canAssignWork === \'any\' && remaining <= 1) {\n    lines.push(\n      remaining > 0\n        ? "- You may give work one level below this conversation; the helper\'s own limit decides what it may give."\n        : \'- You have reached your delegation limit and cannot give work from this conversation.\',\n    )\n  }\n  return lines\n}\n', "function capabilityLines(allowed: ProfileCapabilities, at: ConversationAtLaunch): string[] {\n  void allowed\n  void at\n  return ['- Messaging', '- Giving work', '- Creating agents', '- Writing rules']\n}")]),
    (
        "M2 · ⛔ every line says the FIRST grant's value · the labels still walk the schema and the "
        "values stop following them, so `Deepest chain` reads `project-manager`. ⚠️ A census that "
        "asked only whether each label appears would pass this",
        # 🔴 **530 · re-aimed onto `grantLine` in the schema, where the pairing lives now.** ⛔ The
        # split this row measures — labels walking the schema while the values stop following them
        # — cannot be written in `factory-text.ts` any more, because that file no longer holds the
        # two halves apart. ⚑ **The claim is the same and it now covers both audiences**: `Deepest
        # chain` reads `project-manager`, in the block a model is given AND on the row a person
        # presses.
        # ⚑ **544 · re-anchored for the third argument** (standing rule 27 / `528`); the split this
        # row measures is untouched.
        [
            (
                CAPS,
                "  return `${field.label}: ${grantSays(field, allowed, at)}`",
                "  return `${field.label}: ${grantSays(CAPABILITY_FIELDS[0], allowed, at)}`",
            )
        ],
    ),
    (
        "M3 · 🔴 the reader hands every field the SAME grant's value · `464`'s defect at the one "
        "call site that pairs a field with what it is about — the sentence is right and it is "
        "attached to the wrong thing, which is the failure a `Record` keyed by a spelling made "
        "possible and a narrow signature was supposed to end",
        # ⚑ **544 · re-anchored for the third argument** (standing rule 27 / `528`).
        [
            (
                CAPS,
                "  return says(allowed[field.key], at)",
                "  return says(allowed.canSpawn, at)",
            )
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-014, 010f9426):** 'At once' (maxConcurrent,
        # perParent/global) was removed on purpose. The commit says 'with no fan-out cap' and
        # 'max_concurrent … columns stay in the schema, unread and unwritten'. The field and its
        # `says` no longer exist in CAPABILITY_FIELDS. Its anchor is left stale, so the census
        # records it retired.
        "M4 · ⛔ `At once` answers one of its two questions · the per-parent bound is printed and "
        "the app-wide one is dropped, so a model reads a single number for a field whose own help "
        "says it is *two different questions* — `341`'s reason for splitting the column, undone "
        "in the sentence",
        [
            (
                CAPS,
                "    says: (held) => `${held.perParent} from one conversation, ${held.global} in this app at once`,",
                "    says: (held) => `${held.perParent} from one conversation`,",
            )
        ],
    ),
    (
        "M5 · ⚠️ `Deepest chain` says the same thing whatever it holds · a sentence that ignores "
        "its grant, which is exactly what standing rule 8 distinguishes from one rendered FROM it "
        "— and the one that goes stale the first time somebody narrows the bound. 🔴 544 · and it "
        "now ignores the CONVERSATION too, so a chain at the bound is told it may start another "
        "and the door refuses it",
        # 🔴 **544 · re-anchored, and the row got STRICTER rather than weaker** (standing rule 27 /
        # `528`). ⛔ The old replacement froze one axis; this grant has two now — the value a person
        # set, and where the conversation asking sits — and a constant ignores both. ⚠️ **The
        # killer moved with it**: `what-a-chain-is-told-about-its-own-depth.test.ts` §2 puts the
        # sentence beside the rail's own answer for the same conversation, so a frozen arm is a
        # sentence the door contradicts rather than one that merely goes stale.
        [
            (
                CAPS,
                """    says: (held, at) =>
      at === null ? String(held) : at.depth >= held ? CHAIN_ENDS_HERE : CHAIN_MAY_GO_ON,""",
                "    says: () => CHAIN_MAY_GO_ON,",
            )
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-014, 010f9426):** The 'May propose new projects' grant
        # (canCreateProjects) was removed. The commit says 'Any agent may … propose projects' and
        # 'can_create_projects … unread and unwritten'. There is no grant a person can set to none,
        # so the defect this row planted is now the decision. Its anchor is left stale, so the
        # census records it retired.
        "M6 · ⛔ `May propose new projects` always reads `any` · the grant a person set to `none` "
        "is printed as granted, which is criterion 15's family said in prose: a surface telling an "
        "agent it holds a door the rails will refuse",
        [(CAPS, CREATE_PROJECTS_SAYS, CREATE_PROJECTS_SAYS.replace("(held) => held,", "() => 'any',"))],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-014, 010f9426):** The Team card's grant pair was deleted
        # by D-014, so the surface this row planted on is gone. The pair walked
        # STARTS_A_CONVERSATION_FIELDS (canSpawn and canStaff, both removed), and the TeamWorkspace
        # diff removes the import, `namedGrants` and the `grant-pair` span. Its anchor is left
        # stale, so the census records it retired.
        "M7 · 🔴 the rail draws the NEIGHBOURING grant's sentence · `canCreateAgents`' value under "
        "`canSpawn`'s label, on the row a person presses to choose whose sheet to open. ⛔ `460` "
        "F1's wrong-identity half, arriving through the field that was supposed to make it "
        "impossible",
        # 🔴 **530 · re-aimed, and the hazard it was written for is now unwritable on this row.**
        # ⛔ The rail held the label and the value in two `const`s and this row swapped one of them;
        # it walks `STARTS_A_CONVERSATION_FIELDS` through `grantLine` now, and `grantSays` reads
        # `allowed[field.key]`, so a label cannot be paired with a neighbour's value here at all.
        # ⚑ **So the row keeps the OTHER half of the sentence it was always about** — its own text
        # names it: *"`460` F1's wrong-identity half, on the row a person presses to choose whose
        # sheet to open"*. ⚠️ The row now draws the FIRST identity's grants under every identity's
        # name, which is that half exactly, and `the-grant-a-person-meant-to-give.dom.test.ts` §3 —
        # the file whose whole premise is that the owner and the target differ — is what refuses it.
        [
            (
                # ⚑ **570 · MOVED.** Same row, same defect, on the card `EXT-008` §4.4 sent it
                # to — and the neighbour it steals from is now read off the fold the page already
                # holds rather than off the prop, which is the same *wrong identity* in scope.
                TEAM,
                # ⚑ **Anchor corrected at 593** — `EXT-012` §2 sent the grant pair off the card's
                # FACE and behind a `<details>`, so the two lines moved two levels deeper and the
                # anchor's leading whitespace went with them. ⛔ **The SUBJECT is untouched**: the
                # pair is still walked from `STARTS_A_CONVERSATION_FIELDS` through `grantLine` in
                # this file, which is what `capabilities-probe-reach.test.mjs` reads. ⚠️ Corrected
                # rather than retired, and RE-VERIFIED RED — a corrected anchor keeps a verdict it
                # never earned until somebody runs it again.
                # ⚑ **Anchor corrected AGAIN at 641, for the reason it was corrected at 593** —
                # `641` wrapped the whole directory in its own `role="tabpanel"` so a second tab
                # could sit beside it, and prettier re-indented every line under it by two. ⛔ **The
                # SUBJECT is untouched** and the pair is still walked from
                # `STARTS_A_CONVERSATION_FIELDS` through `grantLine` in this file. ⚠️ Corrected
                # rather than retired, and RE-VERIFIED RED.
                # ⚑ ANCHOR CORRECTED IN PLACE BY 714 — R41: the Team card hands `grantLine` the grant as a
                # person reads it (`namedGrants`, every identity NAMED); the defect planted is unchanged.
                '                    :title="grantLine(field, namedGrants(member.identity.capabilities), null)"\n'
                "                    >{{ grantLine(field, namedGrants(member.identity.capabilities), null) }}</small\n",
                '                    :title="grantLine(field, namedGrants(view.members[0].identity.capabilities), null)"\n'
                "                    >{{ grantLine(field, namedGrants(view.members[0].identity.capabilities), null) }}</small\n",
            )
        ],
    ),
    # ─────────────────────────────── §2 · a first launch is told what it may do
    (
        "M8 · 🔴 THE DEFECT HO-031 §1 WATCHED · the first conversation ever run as an identity is "
        "handed the store's `null`, so a shipped BroBot is told *You may start no conversation of "
        "your own* and is given no grant section at all — while `admitSpawn` would admit the "
        "spawn on its very next tool call",
        # ⚑ Landing D-014 · re-anchored in place, not retired — The first-launch fallback survives.
        # D-014 kept it and changed only its value: instructionContext now answers
        # `capabilitiesOf(slug) ?? DEFAULT_CAPABILITIES` ('No row yet is the one default set').
        # Re-verified RED alone.
        [
            (HOST, '      capabilities:\n        profileSlug === null\n          ? null\n          : (this.deps.store.capabilitiesOf(profileSlug) ?? DEFAULT_CAPABILITIES),', '      capabilities: profileSlug === null ? null : this.deps.store.capabilitiesOf(profileSlug),'),
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-014, 010f9426):** The row protected SEEDED_GRANTS against
        # DEFAULT_CAPABILITIES in a spread, and D-014 removed the seed ('the seeded grants … are
        # gone'). grantsThisLaunchWillRecord, grantAtCreation and seededRoleFor are all deleted, so
        # there is no spread order left to reverse. Its anchor is left stale, so the census records
        # it retired.
        "M9 · ⛔ the fallback forgets the seed · the spread runs the other way, so "
        "`DEFAULT_CAPABILITIES` overwrites what `SEEDED_GRANTS` insists on and BroBot's first "
        "launch reads `May start conversations as: none`. ⚠️ A spread whose order is its whole "
        "meaning (`a-spread-writes-past-a-declared-type`, one seam over)",
        [
            (
                STORE,
                "  return { ...DEFAULT_CAPABILITIES, ...grantAtCreation(profileSlug, seededRoleFor(profileSlug)) }",
                "  return { ...grantAtCreation(profileSlug, seededRoleFor(profileSlug)), ...DEFAULT_CAPABILITIES }",
            )
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-014, 010f9426):** The row's defect is now D-014's
        # decision. The commit says 'roles, the seeded grants, role templates … are gone … A new
        # identity row is all NULL', and the told test §8 says 'no code seeds a column for any
        # identity, so what a first launch is told is the ruled defaults'. Its anchor is left stale,
        # so the census records it retired.
        "M10 · ⚠️ the fallback drops the seed entirely · every first launch is told the ruled "
        "defaults, which is right for an identity the app insists on nothing for and wrong for "
        "the one identity it does — a rule measured only where both readings agree",
        [
            (
                STORE,
                "  return { ...DEFAULT_CAPABILITIES, ...grantAtCreation(profileSlug, seededRoleFor(profileSlug)) }",
                "  return { ...DEFAULT_CAPABILITIES }",
            )
        ],
    ),
    (
        "M11 · 🔴 the fallback OUTRANKS the stored row · a launch renders what creation would have "
        "written instead of what the row says, so a grant a person narrowed is read back to the "
        "model as the seeded one. ⛔ Standing rule 11 broken in the text rather than in the "
        "database, where nothing would show it",
        # ⚑ Landing D-014 · re-anchored in place, not retired — Standing rule 11 at the reader
        # survives: the stored row must outrank the launch fallback. D-014 only changed the fallback
        # from grantsThisLaunchWillRecord to DEFAULT_CAPABILITIES. Re-verified RED alone.
        [
            (HOST, '          : (this.deps.store.capabilitiesOf(profileSlug) ?? DEFAULT_CAPABILITIES),', '          : DEFAULT_CAPABILITIES,'),
        ],
    ),
    # ─────────────────────────────── §3 · the conversation this app cannot place
    (
        "M12 · ⛔ the no-identity branch claims a record exists · a conversation this app cannot "
        "name is told *these are the grants this app has recorded for your profile* and then "
        "shown none, which reads as a grant of nothing. ⚑ The brief's own distinction: *an empty "
        "list reads as you may do nothing, and that is a different claim*",
        [
            (
                FACTORY,
                "    context.capabilities === null ? NO_IDENTITY_SO_NO_GRANTS : GRANTS_AS_THEY_STOOD,",
                "    GRANTS_AS_THEY_STOOD,",
            )
        ],
    ),
    # Re-anchored, NOT VERIFIED and HELD; its test publishes provider-home files.
    ('M13 · ⚠️ the paragraph loses the clause that makes it an ANSWER · *it holds no grants for it* on its own is the empty list said in words; the sentence after it is the one that says this is the app not knowing. ⛔ `465` and HO-029 §2.2 ruled the shape — unknown, and the surface says so', [('apps/desktop/src/main/runtime/factory-text.ts', '"The app cannot identify this conversation\'s profile, so it cannot list its permissions. Read each tool\'s response."', '"This conversation has no permissions."')]),
    # ─────────────────────────────── §4 · the switch a grant cannot carry
    (
        "M14 · 🔴 the switch is never disclosed · spawning is off for the whole app and the "
        "instructions still read `May start conversations as: project-manager`, which is a "
        "promise this app will not keep — `368`'s rule is that a protection is disclosed with its "
        "limit, and this is the limit",
        [
            (
                FACTORY,
                # ⚑ **583 · the grant section builds its own block list**, so the bound on it is
                # pushed onto `granted` rather than onto `sections`. Same line, same defect.
                "  if (!context.spawningEnabled) granted.push(SPAWNING_IS_OFF)",
                "  if (false) granted.push(SPAWNING_IS_OFF)",
            )
        ],
    ),
    (
        "M15 · ⛔ the disclosure is inverted · every conversation on a working app is told spawning "
        "is switched off, and the one that really cannot spawn is told nothing. ⚠️ A condition "
        "tested only where both readings agree would pass this",
        [
            (
                FACTORY,
                # ⚑ **583 · the grant section builds its own block list**, so the bound on it is
                # pushed onto `granted` rather than onto `sections`. Same line, same defect.
                "  if (!context.spawningEnabled) granted.push(SPAWNING_IS_OFF)",
                "  if (context.spawningEnabled) granted.push(SPAWNING_IS_OFF)",
            )
        ],
    ),
    # Retired: the edited operation or wording was deleted, rather than moved.
    # RETIREMENT APPROVED — 485 M16: anchor-absent; removed by 972f27788. Factory text deliberately
    # stopped sharing describeRail and CAPABILITY_FIELDS/grantLine. It now prints approved direct
    # permission sentences and a separately worded app-wide switch line. The mutation's shared-
    # descriptor/string rule is no longer a product property; re-targeting current values would measure a
    # different property. Definition retained as historical evidence; no row execution.
    (
        "M16 · ⚠️ the sentence stops being the rail's own · a second wording for one fact, so the "
        "line a model reads at launch and the refusal it meets at the door can drift apart — "
        "`433` F8's shape, and the reason the label was made one string in the first place",
        [
            (
                FACTORY,
                "const SPAWNING_IS_OFF = describeRail('spawning-disabled')",
                "const SPAWNING_IS_OFF = 'Spawning is switched off for this whole app right now.'",
            )
        ],
    ),
    # ─────────────────────────────── §5 · the preamble
    # Re-anchored, NOT VERIFIED and HELD; its test publishes provider-home files.
    ("M17 · ⛔ the section claims a PERSON set them · false in both directions on the identity this app ships — some of BroBot's grants are the app insisting through `SEEDED_GRANTS` and the rest are NULL columns nobody has chosen. ⚑ HO-015 §2's own class, inside the section written to replace exactly those", [('apps/desktop/src/main/runtime/factory-text.ts', "As of this launch, for ${PRODUCT_NAME}'s agent tools", "A person set these, for ${PRODUCT_NAME}'s agent tools")]),
    # ─────────────────────────────── §6 · 573 · the clause 485 could not reach
    # Re-anchored, NOT VERIFIED and HELD; its test publishes provider-home files.
    ('M18 · ⛔ the preamble drops the half that says the CHECKS are live · an agent that reads *this list is a photograph* and is told nothing else concludes its tools are a photograph too — which is HO-068 §2 verbatim, and what BroBot actually did', [('apps/desktop/src/main/runtime/factory-text.ts', ' (the tools always check the current rules)', '')]),
]
