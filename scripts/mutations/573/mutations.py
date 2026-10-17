"""573 · Creating an agent you cannot start.

⛔ **HO-068 §1.2:** *"An agent that may create an identity may start a conversation as it."*
⚠️ **Measured, not designed.** the person asked BroBot for real names; BroBot asked him to rule the
project-manager tier's name; he answered `nadia`; `create_agent` SUCCEEDED and `spawn_agent` was
refused `not-in-can-spawn · until somebody changes it · retryable: false`. 🔴 **The tier whose job
is creating identities was the one tier that could not use what it created.**

## 🔴 A · the seed, and the two ways a repair could have got the SHAPE wrong

⛔ **`M1` removes the field**, which is the state HO-068 was filed about — the row is the whole
dispatch and it goes red on the live run reproduced in
`create-without-the-right-to-start.test.ts` §1. ⚑ **`M2` narrows it to `'none'`** rather than
removing it, so the anchor that matters is the WORD and not the presence of a key: a seed written
with the narrowest value is a seed that says nothing, and `INSERT OR IGNORE` would then write
`'none'` into the column where NULL would at least have followed a later ruling.

🔴 **`M3` and `M4` are the two shapes this dispatch REFUSED, planted so the refusal is measured
rather than argued.** ⛔ `M3` replaces the word with a literal list — the shape `511` refused one
tier down, and the one that cannot learn a name minted tomorrow. ⚠️ **It is written as a LONG list
on purpose**: a row naming one slug could be read as a smaller version of the same answer, and a
row naming four makes it plain that no list is the answer. ⛔ `M4` drops `canSpawn` and keeps only
the reach, which reads like a simplification and takes `project-manager` with it —
{@link thisAppSeedsThatName} excludes exactly the names this app ships, so the wide word cannot
reach the one name this seed already names.

## ⛔ B · the rail, and the bound the wide word carries

⚑ **`M5` makes {@link staffingAdmits} admit everything**, which is the widening that looks like the
grant and is not: it would let BroBot start a conversation as an identity this app SEEDS, and
*a grant that can be spent to become a wider identity is that identity's grant*. ⛔ **`M6` reads the
TARGET's row at rail 7**, which is the door `canStaff`'s docblock exists to keep shut — *entitlement
before existence* (341) — and the cost is a FALSE refusal rather than a leak: a name the reach
admits is told it is not in the caller's grant because nothing has run as it yet.

⚠️ **One row was WRITTEN HERE AND WITHDRAWN, and the reason is worth more than the row.** ⛔ It asked
rail 7's second arm UNFOLDED — `staffingAdmits(spawner.canStaff, asked.profileId)` — expecting
`Default` and `default` to stop being one identity at this door. 🔴 **It came back a survivor
because {@link thisAppSeedsThatName} FOLDS its own argument**, so the `foldProfileName` at that call
site changes no answer for any input (`a-true-mutation-measures-nothing`). ⚑ **The fold stays in the
code** — the arm above it genuinely needs one, and a predicate that folds today may not tomorrow —
but it is defence rather than enforcement, and this table says so instead of pretending a row
covers it (`a-line-no-mutation-can-kill-is-not-carrying-its-rule`).

## ⚠️ C · the census, which is the instrument that stops the shape coming back

⛔ **`M7` makes the census read `canSpawn`**, so a creation grant whose only starting half is a
literal list passes it — the exact regression §3.3 of the brief asked for a red on. ⚑ **`M8` asks
`canStaff !== 'none'` instead of the rail's own function**, which is `REACHES_WHAT_IT_DID_NOT_START`'s
argument at a census: a third word added to `STAFFING_REACH` would be admitted by a comparison
nobody revisited. ⛔ **`M9` walks only `SEEDED_GRANTS`**, so the CATEGORY table — the other place
this app seeds a creation grant — stops being asked at all; that is `a-payload-census-must-read-call-sites-not-types`
one table over, and it is how `532`'s row would have gone unguarded.

## 🔴 D · the migration, and each guarantee separately

⛔ **`M10` drops `AND can_staff IS NULL`**, which re-grants what a person removed — standing rule 11,
and the one clause that makes an `UPDATE` on an existing install safe to ship. ⚑ **`M11` keys it on
the ROLE instead of the slug**, which is HO-052 §1.4's measured hazard: it would widen every
identity anybody ever described as a `brobot` on a word they chose when it granted nothing.
⚠️ **`M12` ties the journal stamp to `0036`'s** rather than putting it above, which is `522`'s
measurement — the applier's comparison is STRICT, so a tie is skipped on every already-migrated
database, silently and with no error.

## ⛔ E · the prose HO-068 §2 asked for, and the clause `485` could not reach

⚑ **`M13` puts the timing claim back on the GRANTS instead of on the list**, which is BroBot's own
reading of the old sentence: it concluded its tools might be stale because the only thing the
paragraph scoped was the grants. ⛔ **`M14` removes the door that answers** — HO-068 §2.2's *"`list_profiles`
is the surface that should have settled it"* — leaving an agent told its picture is old and not
told what to ask. ⚠️ **The third clause of that family has its own row in `485`'s table**, `M18`,
because that is where the sentence lives and where the row that could not be written is recorded.

## ⛔ What this table does NOT cover

 1. **`create_agent`'s success sentence.** It already states the RULE rather than the caller's list
    and points at `list_profiles`; `456` and `532` own its rows, and this dispatch did not change a
    byte of it. ⚑ That it stayed true through a grant change is the property those rows measure.
 2. **`profilesVisibleTo`'s fold.** `511` relay 2 built it and owns its rows. This dispatch widened
    what it returns for one caller by changing that caller's GRANT, which is the subject of `M1`.
 3. **`producesAConversationOfItsOwn`.** `530` owns it. ⚠️ **No row here weakens it, and the reason
    is that a mutation on either disjunct is invisible for BroBot** — the row satisfies both, so
    dropping one changes no answer for this identity (`a-true-mutation-measures-nothing`). ⛔ The
    consequence a person meets is a TEST instead:
    `a-top-tier-that-can-delegate.test.ts` §3 pins each half alone, both directions.
## 🔴 584 · `M4` RETIRED, `M1`–`M3` re-anchored (`HO-078` §1)

⛔ **`M4` was *the list is dropped and only the reach is kept — reads as a simplification and takes
`project-manager` with it*.** ⚑ **`HO-078` §1 did exactly that, deliberately**, and the clause that
made it a defect is the one that changed: the target is no longer pre-made, so dropping the list
takes nothing with it. 🔴 **A row whose mutation is the production code measures nothing**
(`a-true-mutation-measures-nothing`), and correcting its anchor would have made it green for ever
while reading as coverage.

⚑ **`M1`–`M3` are re-anchored and their subjects are untouched** — see the note on `SEED` below.
"""

WIRE = "apps/desktop/src/shared/runtime-ipc.ts"
RAILS = "apps/desktop/src/main/runtime/spawn-rails.ts"
FACTORY = "apps/desktop/src/main/runtime/factory-text.ts"
CENSUS = "apps/desktop/test/create-without-the-right-to-start.test.ts"
MIGRATION = "apps/desktop/src/main/db/migrations/0037_create_implies_the_right_to_start.sql"
JOURNAL = "apps/desktop/src/main/db/migrations/meta/_journal.json"

# ⚑ **Re-anchored by `584`, not retired** (`HO-078` §1). ⛔ **`canSpawn` LEFT this grant**: the
# seeded list was also the identity roster `mintIdentity` walks, so removing the pre-made project
# manager meant removing the list. ⚠️ **The word above it is what the anchor carried the list FOR**
# — `canStaff` appears twice in this file, here and in `ROLE_TEMPLATES`' project-manager entry —
# **so the disambiguator is now the line above rather than the line below**, and `canAssignWork` is
# a field `584` did not touch.
#
# 🔴 **M4 is NOT re-anchored and is RETIRED**, because its subject is what `584` DID: *the list is
# dropped and only the reach is kept*. ⛔ A row whose mutation is the production code measures
# nothing (`a-true-mutation-measures-nothing`), and correcting its anchor would have made it green
# for ever while reading as coverage.
# ⚑ **RE-ANCHORED at `598`, not retired**: `HO-084` §1 narrowed the seeded word from
# `any-this-app-does-not-seed` to `created-by-me`. ⛔ Every row that spends this constant names the
# SEED rather than a value, and what each of them does to it is unchanged.
SEED = "      canAssignWork: 'any',\n      canStaff: 'created-by-me',\n"

MUTATIONS = [
    # ---- A · the seed ---------------------------------------------------------------------------
    (
        # ⛔ **RETIRED BY RULING (landing D-014, 010f9426):** The subject, the seeded staffing reach,
        # was removed on purpose. The commit says "the seeded grants ... and the staffing carve-out
        # are gone ... can_staff ... unread and unwritten", and the diff deletes SEEDED_GRANTS, the
        # `canStaff: 'created-by-me'` seed and `not-in-can-spawn`. Its anchor is left stale, so the
        # census records it retired.
        "M1 · ⛔ **the staffing reach is not seeded at all** · the state HO-068 §1 was filed about: "
        "BroBot creates `nadia` and `spawn_agent` answers `not-in-can-spawn`, permanently, on an "
        "identity the same conversation just made",
        [(WIRE, SEED, "      canAssignWork: 'any',\n")],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-014, 010f9426):** The seed this row narrows no longer
        # exists. D-014 deleted SEEDED_GRANTS and the `canStaff: 'created-by-me'` line ("the seeded
        # grants ... are gone ... A new identity row is all NULL"). can_staff is "unread and
        # unwritten", so no seed word can be planted. Its anchor is left stale, so the census
        # records it retired.
        "M2 · ⚠️ **the seed names the field and chooses the narrowest word** · a seed that says "
        "nothing, and worse than absence: `INSERT OR IGNORE` writes `'none'` into a column where "
        "NULL would still follow a later ruling",
        # ⚠️ **The anchor carries `canSpawn`'s line too**, because the word alone appears twice in
        # this file — here and in {@link ROLE_TEMPLATES}' project-manager entry — and a row that
        # matches twice applies to nothing (`470`'s M5, the same defect one file over).
        [(WIRE, SEED, "      canAssignWork: 'any',\n      canStaff: 'none',\n")],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-014, 010f9426):** The subject, the seed's starting half,
        # was removed along with SEEDED_GRANTS and canSpawn (card: "no `can_spawn` /
        # `not-in-can-spawn`"; commit: "can_spawn ... unread and unwritten"). A literal list in a
        # seed that no longer exists, for a column nothing reads, measures nothing. Its anchor is
        # left stale, so the census records it retired.
        "M3 · 🔴 **the starting half is a LITERAL LIST** · the shape `511` refused one tier down — "
        "a seed is written once, at creation, so a list cannot learn a name minted tomorrow and "
        "every identity BroBot creates lands outside it",
        [
            (
                WIRE,
                SEED,
                "      canAssignWork: 'any',\n"
                "      canSpawn: ['project-manager', 'worker', 'tester', 'archivist'],\n",
            )
        ],
    ),
    (
        "M4 · ⛔ **the list is dropped and only the reach is kept** · reads as a simplification and "
        "takes `project-manager` with it — `thisAppSeedsThatName` excludes exactly the names this "
        "app ships, so the wide word cannot reach the one name this seed already names",
        # 🔴 **584 · RETIRED, and its anchor is deliberately NOT moved to the new `SEED`.**
        # ⛔ This row's subject is *dropping the list*, and `HO-078` §1 dropped it — on purpose, and
        # safely, because the target it used to take with it is no longer pre-made. ⚑ **So the row
        # points at the bytes it has always pointed at**, which are gone, and the census records it
        # as retired rather than as a row that still measures something.
        # ⚠️ **Re-anchoring it onto the new `SEED` would have changed what it MEANS** — with
        # `canAssignWork` as the disambiguator, the same replacement deletes an assignment grant,
        # which is `553 M7`'s subject and not this one (`a-corrected-anchor-keeps-a-verdict-it-never-earned`).
        [
            (
                WIRE,
                "      canSpawn: [PROJECT_MANAGER_PROFILE_ID],\n"
                "      canStaff: 'any-this-app-does-not-seed',\n",
                "      canStaff: 'any-this-app-does-not-seed',\n",
            )
        ],
    ),
    # ---- B · the rail ---------------------------------------------------------------------------
    (
        # ⛔ **RETIRED BY RULING (landing D-014, 010f9426):** `staffingAdmits` and
        # `thisAppSeedsThatName` were deleted from spawn-rails.ts and runtime-ipc.ts. The commit
        # says "the staffing carve-out are gone" and "Any agent may start a conversation as any
        # existing profile". Its anchor is left stale, so the census records it retired.
        "M5 · ⛔ **the wide word admits a name this app SEEDS** · a grant that can be spent to "
        "become a wider identity is that identity's grant — BroBot could start a conversation "
        "holding whatever this app seeds, and a project manager could run as BroBot",
        [
            (
                RAILS,
                # ⚑ **RE-ANCHORED at `598`, not retired.** `HO-084` §1 gave this vocabulary two
                # more words and HOISTED {@link thisAppSeedsThatName} in front of the `switch`, so
                # the exclusion is asked ONCE for four arms instead of inside one of them. ⛔ **The
                # subject is unchanged and is the exclusion itself**: without it a grant can be
                # spent to become a wider identity, which is this row's whole sentence — and it is
                # now true of every reach rather than of the wide word alone. ⚠️ `598`'s own table
                # deliberately carries NO row here, because a second spelling of *the exclusion is
                # gone* would be two rows for one rule.
                "  if (thisAppSeedsThatName(foldedProfileId)) return false\n",
                "  if (false) return false\n",
            )
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-014, 010f9426):** Rail 7
        # (`!staffingAdmits(spawner.canStaff, ...)` → `not-in-can-spawn`) was deleted. The card says
        # "no `can_spawn` / `not-in-can-spawn`", and the commit says "the staffing carve-out are
        # gone". There is no staffing arm left in which to fold the target's existence. Its anchor
        # is left stale, so the census records it retired.
        "M6 · ⛔ **rail 7's second arm reads the TARGET's row** · the door {@link ProfileCapabilities.canStaff} "
        "says must stay shut — entitlement before existence (341) — and the cost is a FALSE refusal: "
        "a name the reach admits is told it is not in the caller's grant because no conversation "
        "has run as it yet",
        [
            (
                RAILS,
                # ⚑ **RE-ANCHORED at `598`, not retired**: `staffingAdmits` gained a facts
                # argument, so the call spans five lines. ⛔ The defect is unchanged — the
                # EXISTENCE of the target is folded into rail 7's condition, which is the door
                # `341` ordered these two rails to keep shut.
                "      !staffingAdmits(\n        spawner.canStaff,\n",
                "      facts.capabilitiesOf(asked.profileId) === null ||\n      !staffingAdmits(\n        spawner.canStaff,\n",
            )
        ],
    ),
    # ---- C · the census -------------------------------------------------------------------------
    (
        # ⛔ **RETIRED BY RULING (landing D-014, 010f9426):** The census this row weakens (the
        # creation-grant walk over SEEDED_GRANTS/ROLE_TEMPLATES through staffingAdmits) was deleted
        # from create-without-the-right-to-start.test.ts. That file went from 1033 lines to 257
        # (876 deleted, 100 added) and now holds only the §2 prose tests. Its anchor is left stale, so the census records it retired.
        "M7 · 🔴 **the census accepts a literal list as the starting half** · the regression this "
        "instrument exists to catch: a creation grant could ship with a `canSpawn` naming slugs "
        "and nothing that learns, and the census would go green over it",
        [
            (
                CENSUS,
                "    .filter(\n      (one) =>\n        !staffingAdmits(\n",
                "    .filter((one) => (one.grant.canSpawn ?? []).length === 0)\n    .filter(\n      (one) =>\n        !staffingAdmits(\n",
            )
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-014, 010f9426):** Same deleted census. Neither
        # `staffingAdmits`, STAFFING_REACH, DEFAULT_CAPABILITIES.canStaff nor the census block
        # exists any more (D-014: "the staffing carve-out are gone ... can_staff ... unread"). There
        # is no rail function for a census to bypass. Its anchor is left stale, so the census
        # records it retired.
        "M8 · ⛔ **the census decides with `!==` instead of the rail's own function** · a third word "
        "added to `STAFFING_REACH` is admitted here silently, while `staffingAdmits`' own `switch` "
        "would have refused to compile until somebody decided what it admits",
        [
            (
                CENSUS,
                # ⚑ **RE-ANCHORED at `598`, not retired**: the census now plants a HOLDER and a
                # creator beside the word, because `HO-084` §1 made *who created it* part of the
                # question. ⛔ The defect is unchanged — the census deciding with a `===` of its own
                # instead of asking the rail's function.
                "        !staffingAdmits(\n          // ⛔ **An unnamed field is NULL, which is *nobody has chosen* and resolves to the ruled\n          // default** — the store's own rule, so the census reads a seed the way a launch does.\n          one.grant.canStaff ?? DEFAULT_CAPABILITIES.canStaff,\n          A_HOLDER_AND_WHAT_IT_MADE,\n          A_NAME_THIS_APP_DOES_NOT_SEED,\n        ),\n",
                "        (one.grant.canStaff ?? DEFAULT_CAPABILITIES.canStaff) === 'none',\n",
            )
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-014, 010f9426):** ROLE_TEMPLATES, the category table, was
        # deleted in D-014 ("roles, the seeded grants, role templates ... are gone"), and so was the
        # census entry that walked it. There is no category seed left to leave unguarded. Its anchor
        # is left stale, so the census records it retired.
        "M9 · ⚠️ **the census walks only the SLUG table** · the CATEGORY table is the other place "
        "this app seeds a creation grant (HO-052 §1), so `532`'s row would ship unguarded and a "
        "template could grant creation with no starting half at all",
        [
            (
                CENSUS,
                "    ...Object.entries(ROLE_TEMPLATES).map(([role, template]) => ({\n      where: `ROLE_TEMPLATES[${role}]`,\n      grant: template.grant,\n    })),\n",
                "",
            )
        ],
    ),
    # ---- D · the migration ----------------------------------------------------------------------
    (
        # ⛔ **RETIRED BY RULING (landing D-016b, 5e931be8, the tree):** The subject is migration
        # 0037's UPDATE ... WHERE slug = 'default' AND can_staff IS NULL. 5e931be8: 'The database is
        # ONE migration, 0000_the_tree, on a fresh file only'; migrations/ holds only
        # 0000_the_tree.sql, there are no existing installs to UPDATE, and can_staff was already
        # removed by D-014. Its anchor is left stale, so the census records it retired.
        "M10 · ⛔ **the migration re-grants what a person removed** · standing rule 11, and the one "
        "clause that makes an `UPDATE` on an existing install safe to ship: `'none'` is a decision "
        "and NOT NULL, so without the guard a release overwrites it",
        [
            (
                MIGRATION,
                "WHERE `slug` = 'default' AND `can_staff` IS NULL;",
                "WHERE `slug` = 'default';",
            )
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-016b, 5e931be8, the tree):** The subject is migration
        # 0037's keying of its UPDATE (role vs slug), which no longer exists. 5e931be8: 'The
        # database is ONE migration, 0000_the_tree, on a fresh file only', and the can_staff column
        # the statement wrote to is gone. Its anchor is left stale, so the census records it
        # retired.
        "M11 · 🔴 **the migration is keyed on the ROLE** · HO-052 §1.4's measured hazard — it would "
        "widen every identity anybody ever described as a `brobot`, on a word they chose when it "
        "granted nothing, which is standing rule 24's shape exactly",
        [
            (
                MIGRATION,
                "WHERE `slug` = 'default' AND `can_staff` IS NULL;",
                "WHERE `role` = 'brobot' AND `can_staff` IS NULL;",
            )
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-016b, 5e931be8, the tree):** The subject is the journal
        # stamp of 0037 tying with 0036's under the applier's strict comparison. meta/_journal.json
        # now holds a single entry, 0000_the_tree (when 1790676652301), on a fresh file only ('The
        # database is ONE migration, 0000_the_tree, on a fresh file only'), so there is no earlier
        # stamp to tie with and no already-migrated database to skip. Its anchor is left stale, so
        # the census records it retired.
        "M12 · ⚠️ **the journal stamp TIES with `0036`'s** · `522`'s measurement — the applier's "
        "comparison is `Number(last.created_at) < migration.folderMillis`, STRICT — so this file "
        "is skipped on every already-migrated database, silently, with no error",
        [
            (
                JOURNAL,
                '"when": 1789928391321,\n      "tag": "0037_create_implies_the_right_to_start"',
                '"when": 1789928391320,\n      "tag": "0037_create_implies_the_right_to_start"',
            )
        ],
    ),
    # ---- E · the prose --------------------------------------------------------------------------
    # Re-anchored, NOT VERIFIED and HELD; its test publishes provider-home files.
    ('M13 · ⛔ **the timing claim is put back on the GRANTS instead of on the LIST** · BroBot\'s own reading of the old sentence, verbatim: *"widening the list may not reach this conversation until BroBot is relaunched"* — which `574` measured to be false', [('apps/desktop/src/main/runtime/factory-text.ts', 'As of this launch,', 'These grants cannot change while this conversation runs,')]),
    (
        # ⛔ **RETIRED BY RULING (landing D-014, 010f9426):** The row's mutation is now the
        # production code. D-014 rewrote GRANTS_AS_THEY_STOOD to end "was taken is already in
        # force." and deleted ", and list_profiles tells you what the record says now."
        # (factory-text.ts diff). Its anchor is left stale, so the census records it retired.
        "M14 · ⚠️ **the door that answers is taken out of the sentence** · HO-068 §2.2 — *`list_profiles` "
        "is the surface that should have settled it* — leaving an agent told its picture is old and "
        "not told what to ask instead",
        [
            (
                FACTORY,
                "  'was taken is already in force, and list_profiles tells you what the record says now.'",
                "  'was taken is already in force.'",
            )
        ],
    ),
]
