"""409 · a top tier that can delegate — each row is THE DEFECT, put back (131).

🔴 **One subject: the grant the app gives ITSELF so BroBot can do the job it is told to do.** `402`
measured the defect live — BroBot's factory text says *"delegate that to a project manager"* and this
app's own rail refused exactly that for every BroBot it shipped: `not-in-can-spawn`,
`until-a-person-changes-it`, `retryable: false`. ⚠️ Claude passed the same smoke step on the same
commit by **disobeying the same sentence**.

⛔ **HO-016 §2 ruled this shape once already, for `can_message`:** *"Shipping it un-granted means
shipping it broken, and a person granting it by hand is a setup step nobody should have to know
about."* ⚑ This table is that ruling's own argument reaching `can_spawn`, and its three conditions —
visible in the sheet, seeded once and never re-seeded, assertable — are what most of these rows
break.

## 🔴 The one thing that makes this more than a seed

⛔ **`can_spawn` holds profile SLUGS, and `admitSpawn` asks entitlement and THEN existence.** A
seeded grant naming an identity nothing has ever run as passes `not-in-can-spawn` and is refused
`unknown-profile` one line later — **the same permanent refusal, one rail over, with BroBot's
instructions now claiming it may delegate.** ⚑ So the grant and its target are ONE decision, and
`M2`, `M7` and `M8` are the three ways to ship half of it.

## ⛔ Which gate can see each row

| rows | the defect is caught by |
|---|---|
| `M1`–`M4` | ⚑ **`run_suite`** — `apps/desktop/test/a-top-tier-that-can-delegate.test.ts` |
| `M5`–`M9` | ⚑ **`run_suite`** — `apps/desktop/test/a-top-tier-that-can-delegate.test.ts` |
| `M10` | ⚑ **`run_suite`** — `apps/desktop/test/the-text-a-child-is-actually-told.test.ts` |
| `M11` | ⚑ **`run_suite`** — `apps/desktop/test/a-top-tier-that-can-delegate.test.ts` |

⚠️ **`M1` is also seen by `only-the-delegating-tiers.test.ts` §3 and
`a-second-project-and-the-grant.test.ts` §3**, which is where `408` and `376` each pin what the seed
holds; the row is verified against the file that OWNS the subject.

## ⚠️ What this table deliberately does NOT contain

⛔ **No row that renames the seeded slug.** ⚑ `PROJECT_MANAGER_PROFILE_ID` is read by the seed, by
the role list, by the migration's two statements and by every test here, so a rename is a consistent
world with a different name in it — a mutation whose behaviour never differs is a phantom survivor
(`a-mutation-that-changes-nothing-reports-as-a-survivor`). ⚠️ What CAN differ is the migration's SQL
literal drifting from the constant, and that is `M9`.

⛔ **No row keying anything on `role`.** HO-016 §3 is standing and `374` already refused it; the
seeded role is written and read by nothing that gates, which is `M10`'s whole point.

⛔ **No row on `nativeDelegationContext`.** `408` owns that predicate and its table covers it. ⚑ What
`409` changed is the DATA the predicate reads, and `M1` is the row that takes it away.
## 🔴 584 · THREE ROWS RETIRED, and the ruling is what retired them (`HO-078` §1)

⛔ **`M1`, `M2` and `M10` all rested on BroBot's seeded `canSpawn` naming `project-manager`.**
⚑ **`HO-078` §1 removed the list, and removing it removed the identity** — a seeded `canSpawn` is
also the roster `mintIdentity` walks, which is the tangle §1.1 names.

- ⚠️ **`M1` · *the seed says nothing about spawning*** — there is no seeded spawn line to take away.
  🔴 **The subject it protected did NOT go with it**: *BroBot ships unable to delegate* is now
  `573 M1`'s, on {@link ProfileCapabilities.canStaff}, which is the field that carries delegation.
- ⚠️ **`M10` · *the seeded identity gets no role*** — the `SEEDED_ROLES` row it deleted is gone.
  ⚑ `584 M2` is its successor in the opposite direction: putting that row BACK is now the defect.
- 🔴 **`M2` · *the grant names an identity nothing creates*** — ⛔ **the loop is still in the file
  and nothing reaches it.** No seeded grant names a target, so deleting the loop changes no answer
  for any input (`a-true-mutation-measures-nothing`), and re-anchoring it would have made it green
  for ever while reading as coverage. ⚑ `584 M1` is what reaches it: a row that restores the list
  is also the row that re-animates the loop.
"""

WIRE = "apps/desktop/src/shared/runtime-ipc.ts"
STORE = "apps/desktop/src/main/db/session-store.ts"
MIGRATION = "apps/desktop/src/main/db/migrations/0025_striking_the_hood.sql"
RAILS = "apps/desktop/src/main/runtime/spawn-rails.ts"

# ⛔ **Anchored on the code lines alone and never on the comment above them**
# (`a-source-census-that-pins-a-line-kills-every-row-on-it`).
# ⚑ **RE-ANCHORED at 419, not retired.** The seed gained `canCreateAgents` and the literal went
# multi-line, so `M1` now removes the ONE line it was always about rather than rewriting the grant.
SEED = "      canSpawn: [PROJECT_MANAGER_PROFILE_ID],\n"
SEED_WITHOUT_SPAWNING = ""

# ⚑ **RE-ANCHORED at 419, not retired.** `419` extracted the row write into `writeIdentityRow` so a
# third creation door could not become a third spelling of it — see that function. ⛔ The loop is the
# same loop and `M2` deletes the same decision: the grant and the identity it names are written
# together, or the grant is a sentence.
# ⚑ **Re-anchored at 433, NOT retired** — `correct-a-stale-mutation-anchor-dont-retire-it`. The loop
# is the same loop and the defect is the same defect: a grant that names an identity nothing creates.
# ⛔ What moved is one argument — `433` resolves each target's own seeded provider here rather than
# passing `null` — so the shape wrapped onto four lines.
# ⚑ **Re-anchored a SECOND time at 538, still not retired.** `538` gave the target its own seeded
# DISPLAY NAME on the line above the provider, for `433`'s reason exactly — a target is minted on
# the facts the app knows about the TARGET's slug. ⛔ The loop, the row and the defect are all
# unchanged: delete it and BroBot's seeded grant names an identity nothing brings into being.
BRINGS_INTO_BEING = (
    "    for (const target of seededGrantFor(profileSlug)?.canSpawn ?? []) {\n"
    "      writeIdentityRow(target, at, {\n"
    "        displayName: seededDisplayNameFor(target),\n"
    "        role: null,\n"
    "        provider: seededProviderFor(target),\n"
    "      })\n"
    "    }\n"
)

INSERT_TARGET = (
    "INSERT OR IGNORE INTO `agent_identity` (`id`, `slug`, `display_name`, `role`, `created_at`)\n"
    "SELECT 'aid:project-manager', 'project-manager', NULL, 'project-manager', `b`.`created_at`\n"
    "  FROM `agent_identity` AS `b` WHERE `b`.`slug` = 'default';--> statement-breakpoint\n"
)

GRANT_ON_UPGRADE = (
    "UPDATE `agent_identity` SET `can_spawn` = '[\"project-manager\"]' "
    "WHERE `slug` = 'default' AND `can_spawn` IS NULL;\n"
)

SEEDED_ROLE = (
    "    slug: PROJECT_MANAGER_PROFILE_ID,\n"
    "    role: 'project-manager',\n"
    "    why: 'This identity exists because BroBot is granted the right to create a project manager.',\n"
)

EXISTENCE_RAIL = (
    "  if (facts.capabilitiesOf(asked.profileId) === null) {\n"
    "    return no('unknown-profile', { profileId: asked.profileId })\n"
    "  }\n"
)

MUTATIONS = [
    # ── §1 · the grant, and the identity it names ─────────────────────────────────────────────
    (
        "M1 · 🔴 the seed says nothing about spawning · BroBot ships exactly as `402` measured it — "
        "told to delegate to a project manager by its own factory text and refused by this app's "
        "own rail, permanently, on the one door a person can open. ⚠️ It is also `408`'s predicate "
        "losing its only shipped subject: the tier the person named first goes back to being the one "
        "tier that keeps the provider's native delegation",
        [
            (
                WIRE,
                SEED,
                SEED_WITHOUT_SPAWNING,
            )
        ],
    ),
    (
        "M2 · 🔴 the grant names an identity nothing creates · the seed is written and its target is "
        "not, so `admitSpawn` passes `not-in-can-spawn` and refuses `unknown-profile` one line "
        "later — ⛔ the same permanent refusal one rail over, while BroBot's instructions have "
        "started saying it may delegate. ⚑ A grant naming an identity that does not exist is not a "
        "capability; it is a sentence",
        [
            (
                STORE,
                BRINGS_INTO_BEING,
                "",
            )
        ],
    ),
    (
        "M3 · ⛔ every minted identity is created CONFIGURED · the row is written with the DEFAULT "
        "profile's seeded columns, so the project manager arrives holding `can_message: 'any'` and a "
        "`can_spawn` naming itself — a grant nobody wrote, on an identity the app invented, and "
        "`0017`'s refusal to backfill broken at the creation door. ⚠️ **RE-ANCHORED at 419 and the "
        "defect is now WIDER than the one this row was written for**: `419` merged the two call "
        "sites into `writeIdentityRow`, where the target's slug is the parameter — so *the target "
        "gets the SPAWNER's seed* has no one-line spelling any more. ⛔ The nearest honest "
        "expression is one level down and hits every minted row rather than only the grant's "
        "target; the sentence the killer suite checks — the target arrives with nothing chosen — is "
        "unchanged",
        # ⚑ Landing D-014 · re-anchored in place, not retired (landing review) — D-014 removed
        # `seededColumns`, not the rule (a minted identity arrives with nothing chosen): the row
        # plants a configured column at the insert. Killed by creating-an-agent.test.ts. Re-verified
        # RED alone.
        [
            (STORE, '           (id, slug, display_name, provider, created_at, created_by)\n         VALUES (?, ?, ?, ?, ?, ?)`,', "           (id, slug, display_name, provider, created_at, created_by, can_create_agents)\n         VALUES (?, ?, ?, ?, ?, ?, 'any')`,"),
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-014, 010f9426):** The subject, a seeded `canSpawn` grant
        # bringing its targets into being at launch, was removed with `seededGrantFor` and
        # `can_spawn`. Commit 010f9426: "the seeded grants … are gone. The role, can_spawn … columns
        # stay in the schema, unread and unwritten". Its anchor is left stale, so the census records
        # it retired.
        "M4 · ⛔ every launch brings BroBot's targets into being · the loop reads the DEFAULT "
        "profile's grant instead of the launching one, so opening any profile at all creates the "
        "project manager. ⚠️ The rule is *a seeded grant creates ITS OWN target*, and this makes it "
        "*one identity's grant creates its targets on every launch in the app*",
        [
            (
                STORE,
                "    for (const target of seededGrantFor(profileSlug)?.canSpawn ?? []) {\n",
                "    for (const target of seededGrantFor('default')?.canSpawn ?? []) {\n",
            )
        ],
    ),
    # ── §2 · seeded once — HO-016 §2 condition 2 ──────────────────────────────────────────────
    (
        # ⛔ **RETIRED BY RULING (landing D-016b, 5e931be8, the tree):** Commit 5e931be8
        # ('feat(D-016): the tree') deleted the migration this row mutates
        # (apps/desktop/src/main/db/migrations/0025_striking_the_hood.sql, with its snapshot) and
        # replaced the migration history with one file. DEV's c3-spec.md says 'Gone: `role` with
        # `agent_identity_role_ck`, `can_spawn`, `max_concurrent`, ...' and 04-tree-data-model.md
        # says 'The build holds **one** migration', so there is no upgrade door left to re-grant
        # through. Its anchor is left stale, so the census records it retired.
        "M5 · 🔴 the upgrade re-grants what a person took away · `can_spawn = '[]'` is a DECISION "
        "and this reads it as *nobody has chosen*, so an install that narrowed BroBot gets its "
        "delegation handed back by a migration. ⛔ HO-016 §2 condition 2, broken through the "
        "upgrade door instead of through a launch",
        [
            (
                MIGRATION,
                GRANT_ON_UPGRADE,
                "UPDATE `agent_identity` SET `can_spawn` = '[\"project-manager\"]' "
                "WHERE `slug` = 'default';\n",
            )
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-016b, 5e931be8, the tree):** Commit 5e931be8
        # ('feat(D-016): the tree') deleted 0025_striking_the_hood.sql; c3-spec.md line 42 lists
        # `can_spawn` as 'Gone', and 04-tree-data-model.md line 128 says 'The build holds **one**
        # migration, generated from the final `schema.ts` once the old migrations and snapshots are
        # removed.' The UPDATE that granted every identity no longer exists. Its anchor is left
        # stale, so the census records it retired.
        "M6 · ⛔ the upgrade grants every identity · an `UPDATE` with no `slug` clause hands "
        "BroBot's own grant to every agent that has ever run, which is the opposite of a "
        "capability — and it is invisible until somebody reads the grant sheet",
        [
            (
                MIGRATION,
                GRANT_ON_UPGRADE,
                "UPDATE `agent_identity` SET `can_spawn` = '[\"project-manager\"]' "
                "WHERE `can_spawn` IS NULL;\n",
            )
        ],
    ),
    # ── §3 · the two doors, and the halves of one decision ────────────────────────────────────
    (
        # ⛔ **RETIRED BY RULING (landing D-016b, 5e931be8, the tree):** The subject is the upgrade's
        # INSERT of the project-manager identity next to a can_spawn grant. Commit 5e931be8 deleted
        # 0025_striking_the_hood.sql and dropped the `can_spawn` column (c3-spec.md: 'Gone: `role`
        # ..., `can_spawn`, ...'), and 04-tree-data-model.md says the build now holds one migration,
        # so there is no grant and no upgrade path to be half-written. Its anchor is left stale, so
        # the census records it retired.
        "M7 · 🔴 the upgrade writes the grant and not its target · an upgraded install holds a "
        "`can_spawn` naming a project manager that does not exist, so BroBot is refused "
        "`unknown-profile` — ⚑ the same half-decision as `M2`, arriving through the other door",
        [
            (
                MIGRATION,
                INSERT_TARGET,
                "",
            )
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-016b, 5e931be8, the tree):** The row plants an empty
        # `can_spawn = '[]'` in the 0025 upgrade UPDATE. Commit 5e931be8 deleted that migration and
        # the `can_spawn` column (c3-spec.md line 42: 'Gone: ... `can_spawn`, `max_concurrent` ...';
        # 04-tree-data-model.md line 128: 'The build holds **one** migration'). R3 decides
        # delegation by profile existence, so 'nobody has chosen' no longer has a column to be
        # stored in. Its anchor is left stale, so the census records it retired.
        "M8 · 🔴 the upgrade writes an EMPTY grant · the identity is created and BroBot may not "
        "spawn it, so `402`'s refusal is unchanged — and it is worse than `M7`, because the column "
        "is no longer NULL. ⛔ *Nobody has chosen* is the only state a later seed or migration can "
        "fill, so this records a decision the person never made AND closes the door behind it",
        [
            (
                MIGRATION,
                GRANT_ON_UPGRADE,
                "UPDATE `agent_identity` SET `can_spawn` = '[]' "
                "WHERE `slug` = 'default' AND `can_spawn` IS NULL;\n",
            )
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-016b, 5e931be8, the tree):** The row removes the upgrade
        # INSERT's guard in 0025_striking_the_hood.sql, which commit 5e931be8 deleted together with
        # its snapshot. Per 04-tree-data-model.md line 128, 'The build holds **one** migration', and
        # there is no second door beside creation for the two to drift apart through. SEEDED_GRANTS
        # and can_spawn are gone with the column (c3-spec.md line 42). Its anchor is left stale, so
        # the census records it retired.
        "M9 · ⛔ the upgrade's INSERT loses the guard that makes it the upgrade path · it fires on "
        "every FRESH database too, so the creation door — `SEEDED_GRANTS`, the code a person "
        "actually reads — becomes a line nothing reaches, and the two doors can drift apart "
        "unmeasured (`a-line-no-mutation-can-kill-is-not-carrying-its-rule`)",
        [
            (
                MIGRATION,
                INSERT_TARGET,
                "INSERT OR IGNORE INTO `agent_identity` "
                "(`id`, `slug`, `display_name`, `role`, `created_at`)\n"
                "VALUES ('aid:project-manager', 'project-manager', NULL, 'project-manager', 0);"
                "--> statement-breakpoint\n",
            )
        ],
    ),
    # ── §4 · the role, which is a SAYING and not an inference ─────────────────────────────────
    (
        "M10 · ⛔ the seeded identity gets no role · a slug that reads like a role is left to speak "
        "for itself, which is exactly the *choosing from a SLUG, a DEPTH or a `can_spawn` list* "
        "`370` refused — and the factory text then renders no role section for the one identity the "
        "app created to be a project manager",
        [
            (
                WIRE,
                SEEDED_ROLE,
                "",
            )
        ],
    ),
    # ── §5 · the rail this seed works WITH ────────────────────────────────────────────────────
    (
        "M11 · 🔴 the grant is made spendable by deleting the existence rail · the tempting repair "
        "for `M2`, and it is HO-005 criterion 12 removed: a misspelt `profile_slug` would mint a "
        "durable identity with an empty memory and its own provider home. ⚑ 409 satisfies that rail "
        "by creating one row; this satisfies it by refusing nobody",
        # ⚑ Landing D-016b (5e931be8, the tree) · re-anchored in place, not retired — The rule
        # (HO-005 criterion 12) still holds under R3: naming an unknown profile in give_work is
        # refused as `no-such-profile` unless the caller asked for `new: true`. The line survives in
        # spawn-rails.ts. The plant deletes the refusal, so an unknown profile goes through
        # unchecked. Killed by `the-rails-before-anything-can-reach-them.test.ts`,
        # `creating-an-agent.test.ts`, `the-five-tools.test.ts`, `seed-one-name-the-rest.test.ts`.
        [
            (RAILS, "  if (!known && asked.new !== true) return no('no-such-profile', { profileId: asked.profile })\n", ''),
        ],
    ),
]
