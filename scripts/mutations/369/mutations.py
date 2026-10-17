"""369 · An identity that outlives a project — each row is THE DEFECT, put back verbatim (131).

A global profile such as `notes-app-explorer` retains its workspace and memory across
tickets. A project-scoped identity would create a fresh explorer with empty memory.
The mutations below check that identity is independent of the current piece of work.

⚑ **The shape, and every row below breaks one part of it:** a global `agent_identity` row carrying
what accumulates, an explicit `agent_identity_home` locator replacing path-derivation-by-convention,
today's `agent_profile` rows re-read as execution-project BINDINGS, and a SESSION supplying the
project. 🔴 **The hard constraint every row is measured against: every existing id and every existing
provider-home path stays byte-identical.**

## 🔴 Which gate can see each row

| rows | the defect is caught by |
|---|---|
| `M1`, `M2`, `M4`, `M5`, `M9` | ⚑ **`run_suite desktop`** — `an-identity-that-outlives-a-project.test.ts` §1/§2/§4/§6 |
| `M3`, `M8` | ⚑ **`run_suite desktop`** — §2's composition-root census and its resume A/B |
| `M6`, `M7`, `M10`, `M12` | ⚑ **`run_suite desktop`** — §3, against a staged pre-`0018` ledger |
| `M11`, `M13` | ⚑ **`run_suite desktop`** — §7, the role vocabulary and its fold |

⚑ **Thirteen rows, and all thirteen were applied and run ONE AT A TIME** — apply, run the suites,
restore from bytes, checksum — rather than by running the table. `M8` survived the first pass and the
gap it named is closed in §2; nothing else survived.

## ⛔ What this table deliberately does NOT contain

⛔ **No row that puts `projectSlug` back on `agentIdentities` or `setCapabilities`.** The parameter is
gone from the command union, the bridge, the preload and the host, so re-introducing it is a COMPILE
error rather than a red suite — this harness's gates are the vitest projects, so such a row is
unkillable here by construction (`361`'s rule). The types are the guard.

⛔ **No row on the migration's `'default'` home segment becoming a join on `project.slug`.** Every
`agent_profile` row any version of this app has written is under `proj:default`, so the literal and
the join are the SAME VALUE on every reachable ledger — the row would change nothing and report as a
survivor (`a-mutation-that-changes-nothing-reports-as-a-survivor`). ⚠️ The line still earns its
comment: the segment has never come from the project row, and `M2` is where that is measured on the
path a second project can actually reach.

⛔ **No row on the SECOND reader of the session's own segment, `providerHomeFor`.** It carries the
same rule `M8` measures — a conversation's files are where it ran, not where its identity lives now —
three lines away in the same file. ⚠️ **Its only callers are the private Codex-child readers**
(`readCodexChild` and the archive path), which this harness's gates reach only through a live Codex
conversation, so a row there would be unkillable by construction (`361`'s rule). ⚑ `M8` was written
with both edits in one row and this dispatch's own review caught it: a row's edits are applied
together, so killing either kills the row and the second was never measured.

⛔ **No row on creating `provider_session_identity_rotation_uq` BEFORE the backfill.** SQLite treats
NULLs as distinct, so the CREATE succeeds on an empty column and the same collision then aborts the
UPDATE instead — the migration still refuses the impossible ledger and §3's rollback assertions still
pass. A row that cannot change the outcome measures nothing.
"""

from __future__ import annotations

STORE = "apps/desktop/src/main/db/session-store.ts"
IDENTITY = "apps/desktop/src/main/db/identity.ts"
ROOT = "apps/desktop/src/main/index.ts"
HOST = "apps/desktop/src/main/runtime/runtime-host.ts"
SQL = "apps/desktop/src/main/db/migrations/0018_light_gideon.sql"
CAPS = "apps/desktop/src/shared/capabilities.ts"

MUTATIONS: list[tuple[str, list[tuple[str, str, str]]]] = [
    (
        "M1 · 🔴 THE DEFECT, verbatim: the identity is derived from the BINDING again, so the same "
        "name in two projects is two agents with two memories and two grants — HO-009 §4's whole "
        "subject, and the state the schema was in before this dispatch",
        [
            (
                STORE,
                "    const identityId = agentIdentityRowId(profileSlug)\n"
                "    // ⛔ **The identity FIRST**, because the binding points at it and foreign keys are ON.\n"
                "    spawnSql().ensureIdentityRow.run(identityId, foldProfileName(profileSlug), at)\n",
                "    const identityId = `aid:${projectSlug}:${foldProfileName(profileSlug)}`\n"
                "    spawnSql().ensureIdentityRow.run(\n"
                "      identityId,\n"
                "      `${projectSlug}:${foldProfileName(profileSlug)}`,\n"
                "      at,\n"
                "    )\n",
            )
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-016a commit 2, a5d66e92):** The commit a5d66e92 says "the
        # home rows, the per-session and per-identity segment lookups and the segment argument on
        # prepareProviderHome/providerHomePath go", and an-identity-that-outlives-a-project.test.ts
        # now notes that D-016 commit 2 removed its §1/§2 ("§2, which measured the locator, went
        # whole"). deriveProviderHome joins HOME_FOLDER, profileId and provider with no projectId,
        # so the planted rule no longer exists. Its anchor is left stale, so the census records it
        # retired.
        "M2 · 🔴 THE OTHER HALF, verbatim: the home segment a session records comes from the project "
        "it is WORKING IN rather than from the identity's recorded address — the same defect moved "
        "from the database to the disk, so every ticket opens a fresh empty provider home",
        [
            (
                STORE,
                "    const homeSegment = (\n"
                "      spawnSql().readHome.get(identityId, record.provider) as { project_segment: string }\n"
                "    ).project_segment\n",
                "    const homeSegment = record.projectSlug ?? DEFAULT_PROJECT_ID\n",
            )
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-016a commit 2, a5d66e92):** The row plants the
        # homeAddress / store.homeSegmentOf lookup in apps/desktop/src/main/index.ts, and a5d66e92
        # deleted both on purpose: the commit message says 'Every provider home lives under the one
        # folder HOME_FOLDER ('default'): the home rows, the per-session and per-identity segment
        # lookups and the segment argument on prepareProviderHome/providerHomePath go.' The anchor
        # now counts 0 in index.ts; the seam is a plain (provider, profileId) call, so there is no
        # segment lookup left to mutate. Its anchor is left stale, so the census records it retired.
        "M3 · ⛔ the composition root derives the first path segment from the constant again · the "
        "plausible mistake: every recorded address says `default`, so the lookup looks like a "
        "no-op — and it is exactly the line that stops a second project forking one identity's home",
        [
            (
                ROOT,
                "    projectId: projectSegment ?? store.homeSegmentOf(profileId, provider) ?? DEFAULT_PROJECT_ID,",
                "    projectId: projectSegment ?? DEFAULT_PROJECT_ID,",
            )
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-016b, 5e931be8, the tree):** The subject is per-identity
        # `rotation` allocation, and rotation was removed on purpose: DEV's c3-spec lists "Gone:
        # `rotation`, `agent_profile_id`, ... `provider_session_identity_rotation_uq`", and
        # 04-tree-data-model Q2 says "No rotation, for any conversation." `provider_session` in
        # `0000_the_tree` has no rotation column and `selectNextRotation` is deleted from
        # session-store.ts. Only the ref's own `rotation` inside `external_ref` remains, and it is
        # never allocated. Its anchor is left stale, so the census records it retired.
        "M4 · ⛔ `rotation` is allocated per BINDING again · the plausible mistake: the older index "
        "is still there and still says `agent_profile_id` — and two bindings of one identity then "
        "each begin at 0, so *which session is this agent's second* has two answers",
        [
            (
                STORE,
                "        `SELECT coalesce(max(rotation) + 1, 0) AS next FROM provider_session WHERE agent_identity_id = ?`,",
                "        `SELECT coalesce(max(rotation) + 1, 0) AS next FROM provider_session WHERE agent_profile_id = ?`,",
            ),
            (
                STORE,
                "    const rotation = (selectNextRotation().get(identityId) as { next: number }).next",
                "    const rotation = (selectNextRotation().get(agentProfileId) as { next: number }).next",
            ),
        ],
    ),
    (
        "M5 · ⛔ the identity id is not FOLDED · the plausible mistake: the slug column is folded "
        "beside it, so folding here reads like doing it twice — and `Explorer` then keys a row that "
        "`capabilitiesOf('explorer')` cannot find, which is 208 H1 one table over",
        [
            (
                IDENTITY,
                "  return `aid${SEP}${foldProfileName(profileSlug)}`",
                "  return `aid${SEP}${profileSlug}`",
            )
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-016b, 5e931be8, the tree):** The subject is migration
        # 0018's backfill deriving the identity per project. The commit says "The database is ONE
        # migration, 0000_the_tree, on a fresh file only: the project, proposal, binding, home and
        # document tables go", and 0018_light_gideon.sql no longer exists. There is no upgrade
        # backfill left to mutate, and the fresh schema has no project to spell into an id. Its
        # anchor is left stale, so the census records it retired.
        "M6 · 🔴 the MIGRATION derives the identity per project · the plausible mistake: `0013` and "
        "`0015` both spell the project into the id, so copying that shape reads like consistency — "
        "and the backfill then mints one identity per binding, which is the defect this file exists "
        "to remove, arriving through the upgrade instead of through the writer",
        [
            (
                SQL,
                "  'aid:' || lower(`a`.`slug`),\n  lower(`a`.`slug`),",
                "  'aid:' || replace(`a`.`project_id`, 'proj:', '') || ':' || lower(`a`.`slug`),\n"
                "  replace(`a`.`project_id`, 'proj:', '') || ':' || lower(`a`.`slug`),",
            )
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-016b, 5e931be8, the tree):** The subject is 0018's
        # backfill carrying `agent_profile.can_spawn` forward into `agent_identity`. Every old
        # migration 0001-0042 was deleted ("The database is ONE migration, 0000_the_tree, on a fresh
        # file only"), `can_spawn` is in c3-spec's "Gone" list for agent_identity, and the old
        # `agent_profile` table is dropped. The old file is refused untouched, and the reset moves
        # old data in commit 4, so no migration backfill remains. Its anchor is left stale, so the
        # census records it retired.
        "M7 · ⛔ the migration carries no GRANT forward · the plausible mistake: the columns are "
        "still on `agent_profile`, so leaving the new ones NULL looks lossless — and every capability "
        "a person had configured silently reverts to the ruled default on the upgrade, `can_spawn` "
        "included, which turns a working spawn door off",
        [
            (
                SQL,
                "  (SELECT `g`.`can_spawn` FROM `agent_profile` AS `g`\n"
                "    WHERE lower(`g`.`slug`) = lower(`a`.`slug`) AND `g`.`can_spawn` IS NOT NULL\n"
                "    ORDER BY `g`.`created_at`, `g`.`id` LIMIT 1),",
                "  NULL,",
            )
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-016a commit 2, a5d66e92):** The row's plant text (resume
        # without sessionHomeSegment) is exactly the current resume code, because the per-session
        # segment lookup was removed by a5d66e92 with the rest of the segment machinery (same commit
        # message line as 369 M3). I rejected re-anchoring to 'resume via the identity's folded
        # slug': no existing runnable test would go red, since the darwin-only case tests only
        # assert dirent names, so the row would be born dark. Its anchor is left stale, so the
        # census records it retired.
        "M8 · 🔴 a RESUME resolves its home through the identity's current address · the plausible "
        "mistake: one address per identity sounds like the whole point of the locator — and `238` "
        "merged two spellings into one identity, so a conversation comes back to a folder it was "
        "never in, which is 149's failure shape",
        [
            (
                HOST,
                "    const providerHome = await this.deps.prepareProviderHome(\n"
                "      row.provider,\n"
                "      profileId,\n"
                "      this.deps.store.sessionHomeSegment(sessionId) ?? undefined,\n"
                "    )",
                "    const providerHome = await this.deps.prepareProviderHome(row.provider, profileId)",
            )
        ],
    ),
    (
        "M9 · ⛔ the store reads a capability off the BINDING again · the plausible mistake: the four "
        "columns are still there and still hold the pre-upgrade values, so the old table name still "
        "compiles and still returns rows — and a grant made after the upgrade is then written to one "
        "table and read from another",
        [
            (
                STORE,
                "        `SELECT ${CAPABILITY_COLUMNS.join(', ')} FROM agent_identity WHERE id = ?`,",
                "        `SELECT ${CAPABILITY_COLUMNS.join(', ')} FROM agent_profile WHERE id = ?`,",
            )
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-016b, 5e931be8, the tree):** The subject is 0018's
        # backfill giving a conversation swept out of the user's own home a managed home address
        # (`home_project_segment IS NULL`). The commit removes the migration and the home tables
        # ("the project, proposal, binding, home and document tables go"), and c3-spec's "Gone" list
        # names `home_project_segment` on provider_session. There is no such column or UPDATE left.
        # Its anchor is left stale, so the census records it retired.
        "M10 · ⚠️ THE TWO NULLS, collapsed (168 L5 · 182 · 188) · the migration gives a conversation "
        "swept out of the user's OWN home a managed address · the plausible mistake: `IS NULL` alone "
        "reads like *every row that has not got one* — and it claims a directory of ours holds bytes "
        "we never owned, which is the coalescing bug three dispatches have each found once",
        [
            (
                SQL,
                "WHERE `home_project_segment` IS NULL AND `agent_profile_id` IS NOT NULL;",
                "WHERE `home_project_segment` IS NULL;",
            )
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-016b, 5e931be8, the tree):** The subject is the
        # DATABASE-level CHECK on `agent_identity.role`, and the role itself was removed: c3-spec
        # says "Gone: `role` with `agent_identity_role_ck`, `can_spawn`, `max_concurrent`..." and
        # 04-tree-data-model says agent_identity "loses `role`". `0000_the_tree.sql`'s
        # agent_identity has no role column, so there is no vocabulary to close. The surviving
        # CHECKs on capability columns are different rules and belong to other rows. Its anchor is
        # left stale, so the census records it retired.
        "M11 · ⛔ the role vocabulary is not closed in the DATABASE · the plausible mistake: `0017` "
        "ruled that a vocabulary is closed in the READER — and that ruling is about a CHECK on an "
        "EXISTING table, which this one is not: on a new table it is free, and without it a "
        "hand-written INSERT can put any word at all where three are legal",
        [
            (
                SQL,
                "\tCONSTRAINT \"agent_identity_role_ck\" CHECK(\"agent_identity\".\"role\" IS NULL OR \"agent_identity\".\"role\" IN ('brobot', 'project-manager', 'worker')),\n",
                "",
            )
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-016b, 5e931be8, the tree):** The subject is 0018's
        # backfill writing a `'worker'` role into every existing identity. Both the migration ("ONE
        # migration, 0000_the_tree, on a fresh file only") and the `role` column ("Gone: `role` with
        # `agent_identity_role_ck`", c3-spec) were removed on purpose. Nothing is left to backfill,
        # so the plant has no home. Its anchor is left stale, so the census records it retired.
        "M12 · ⚠️ the migration BACKFILLS a role · the plausible mistake: every identity needs one for "
        "the factory text to render, so `worker` looks like the harmless answer — and it records a "
        "decision nobody made into every row that existed before the question was asked, which is "
        "then indistinguishable from a person who chose it (`0016`'s argument about `project.cwd`)",
        [
            (
                SQL,
                "INSERT OR IGNORE INTO `agent_identity` (`id`, `slug`, `display_name`, `can_spawn`, `max_depth`, `max_concurrent`, `can_message`, `created_at`)\nSELECT\n  'aid:' || lower(`a`.`slug`),\n  lower(`a`.`slug`),",
                "INSERT OR IGNORE INTO `agent_identity` (`id`, `slug`, `role`, `display_name`, `can_spawn`, `max_depth`, `max_concurrent`, `can_message`, `created_at`)\nSELECT\n  'aid:' || lower(`a`.`slug`),\n  lower(`a`.`slug`),\n  'worker',",
            )
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-014, 010f9426):** D-014 removed roles on purpose. The
        # commit says 'roles, the seeded grants, role templates and the staffing carve-out are
        # gone', and the diff deletes `AGENT_ROLES = ['brobot','project-manager','worker']`,
        # `ROLE_SAYS` and `parseAgentRole` from shared/capabilities.ts. Its anchor is left stale, so
        # the census records it retired.
        "M13 · ⛔ an unreadable role folds to the commonest one instead of to NOTHING · the plausible "
        "mistake: a factory text has to render something, so falling back beats rendering nothing — "
        "and a typo in a hand-edited column then names an agent, which is the widening `capabilitiesOf` "
        "folds the other way to prevent",
        [
            (
                CAPS,
                "  return AGENT_ROLES.includes(stored as AgentRole) ? (stored as AgentRole) : null",
                "  return AGENT_ROLES.includes(stored as AgentRole) ? (stored as AgentRole) : 'worker'",
            )
        ],
    ),
]
