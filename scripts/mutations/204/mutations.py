#!/usr/bin/env python3
"""204's mutation table — each row is THE DEFECT, put back verbatim (131).

⛔ **194 H5 as it really shipped until this commit**: `provider_session.profile_id` was a free
string and nothing else, so two sessions for the exact profile `developer` were two unrelated rows
that happened to spell one name, sharing one provider home, both `rotation = 0` — and the database
could not say which of them was current. The first domain model specified the answer in Slice 1
(a profile is keyed `project + slug`; a provider session is keyed `agent_profile + rotation`), and
`schema.ts:14-18` listed the tables as a Slice-2 extension point. Nothing built them.

The rows fall into four groups:

  * `M1`-`M6`  the identity itself — the tables, the derived ids, the one place a free string
    becomes a relation.
  * `M7`-`M12` rotation, which used to be the PROVIDER's number and is now a position in a
    profile's life — including the unique key that makes two rows at one position impossible.
  * `M13`-`M18` the migration and its backfill, against a ledger that already exists.
  * `M19`-`M21` the two nulls in `profile_id`, which are two values and not one.
  * `M22`-`M23` §3's two shape-only columns.

## ⛔ What this table cannot reach, stated because a table silent about its edges is claiming them

  * **the person's own database.** Every row here runs the migration against a fixture built by
    truncating the journal to 0000-0012. The dry run in the response doc is the other instrument —
    a `cp -c` clone of the real ledger, read and deleted — and no mutation can stand in for it,
    because what it measures is 20 rows that exist exactly once.
  * ⛔ **A guard that could not be killed, named rather than counted.** The pre-check applied a row
    that deleted an `ensureProjectRow` from `session-store.ts`, and every test stayed green —
    because `0013` creates `proj:default` on every database including a fresh one, so that statement
    could never have been the thing that created it. ⚑ **The line was DELETED rather than kept and
    excused**, and `M5` now mutates the place the project row really comes from. What no row reaches
    is the hypothetical second writer: if a second project becomes reachable, whatever creates it
    owns this, and nothing here is protecting that.
  * ⛔ **The upgrade itself.** Nothing here can say that the app, launched on the person's machine, runs
    0013 successfully on its real WAL with a live window attached. The gate is `applyMigrations` on
    a temp file; the smoke is a fresh `--user-data-dir`. That is the residual risk this dispatch
    carries and it is named in the response doc rather than counted here.
  * **One-live-per-profile.** No row can kill an invariant that was deliberately not armed. What
    `M12` protects is the OPPOSITE assertion — that two live sessions for one profile are still
    allowed — so a future dispatch that arms the rule has to delete a test that says why, in the
    same commit, rather than discover the 232 refused launches on a smoke run.
  * **A second project.** `provider-homes.ts` is still pinned to `default`; a row that unpinned it
    would be building the thing §4 puts out of scope. What the schema can say is that the identity
    is keyed on a project, and `M2` is the row that says so.
  * **The `runtime`, `dom` and `scripts` projects.** 204 changes no adapter, no component and no
    script library, so only `desktop` runs. `runtime-ipc.ts` gains one exported constant that no
    renderer reads.

⚠️ **Anchors are taken from the FORMATTED source** — 147's M12 came back `DID NOT APPLY` because
`prettier --write` had reflowed the string it was anchored on. These were taken after `format` ran.

⛔ **Do not apply these by hand** — `mutate.sh` owns the tree, takes 196's repository-global lock,
and restores from a pristine copy keyed by FULL relative path.

## ⛔ What `369` did to this table

⚑ **`M1`, `M7`, `M8`, `M10`, `M12` and `M19` were RE-ANCHORED, not retired.** `369` moved `profileRowFor` to return an identity BESIDE the binding, `selectNextRotation` to key on `agent_identity_id`, and `insertAdoptedRow` to bind through `rows`. Every anchor above was corrected to the new text and **every one of the six was re-applied and re-run individually** — apply, run the suites, restore from bytes, checksum. ⛔ **A corrected anchor otherwise keeps a verdict it never earned**, which is free to do and impossible to notice.

"""

from __future__ import annotations

import sys

STORE = "apps/desktop/src/main/db/session-store.ts"
IDENTITY = "apps/desktop/src/main/db/identity.ts"
MIGRATION = "apps/desktop/src/main/db/migrations/0013_loose_nemesis.sql"
MIGRATION_0000_THE_TREE = "apps/desktop/src/main/db/migrations/0000_the_tree.sql"

MUTATIONS = [
    # ------------------------------------------------------------------ the identity itself
    (
        "M1 · ⛔ THE DEFECT, verbatim · the session row never names an identity — `profile_id` is a "
        "free string again and `agent_profile_id` is never written",
        # ⚑ Landing D-016a (bd70d693) · re-anchored in place, not retired — The rule survives
        # D-016a: a created session must name its agent_profile binding (D-016 only dropped
        # profileRowFor's third `projectSlug` argument and the project join, it did not touch what
        # createTx writes). The old anchor is stale only because the call is now one line
        # `profileRowFor(record.profileId, at)`. The corrected plant keeps the identity but writes a
        # null `agent_profile_id`, so the defect is exactly the label's (the binding is never
        # written, `identityOf` and every binding join go blind) without an FK failure from a
        # made-up identity id.
        # ⚑ Landing D-016a commit 2 (a5d66e92) · re-anchored in place, not retired — The rule (a
        # created conversation records its identity on provider_session.agent_identity_id) is
        # intact; only the statement changed from the profile-binding write to
        # spawnSql().writeIdentityOnSession in createTx. Dropping that write leaves the conversation
        # unplaced. Killed by `agent-profile-identity.test.ts`.
        [
            (STORE, '    spawnSql().writeIdentityOnSession.run(identityId, record.id)\n', '    void identityId\n'),
        ],
    ),
    (
        "M2 · the profile id forgets its PROJECT — `agp:<slug>` instead of `agp:<project>:<slug>`, so "
        "two projects' `developer` collapse into one identity in the database as well as on disk",
        [
            (
                IDENTITY,
                "  return `agp${SEP}${projectSlug}${SEP}${profileSlug}`\n",
                "  return `agp${SEP}${profileSlug}`\n",
            )
        ],
    ),
    (
        "M3 · the id is not derived at all — a per-call suffix, so one identity gets a new row every "
        "time a conversation starts in it",
        # ⚑ Landing D-016a commit 2 (a5d66e92) · re-anchored in place, not retired — a5d66e92
        # replaced agentProfileRowId(projectSlug, profileSlug) with agentIdentityRowId(profileSlug)
        # (id aid:<folded slug>); provider_session.agent_identity_id is now how a conversation is
        # found and rotation is still allocated over it, so the rule 'one identity is one stable id,
        # never a fresh row per call' survives. Re-anchor on the new function name and its
        # single-argument body. The non-empty guard keeps the 'aid:' || migration-literal test out
        # of the blast radius. Killed by `agent-profile-identity.test.ts`,
        # `profile-collision.test.ts`, `an-identity-that-outlives-a-project.test.ts`,
        # `the-grant-covers-what-it-created.test.ts`.
        [
            (IDENTITY, 'export function agentIdentityRowId(profileSlug: string): string {\n', "let seq = 0\nexport function agentIdentityRowId(profileSlug: string): string {\n  if (profileSlug !== '') return `aid${SEP}${foldProfileName(profileSlug)}${SEP}${seq++}`\n"),
        ],
    ),
    (
        "M4 · `INSERT`, not `INSERT OR IGNORE` — the second conversation in a profile throws on the "
        "identity it is supposed to reuse",
        # ⚑ Landing D-016a commit 2 (a5d66e92) · re-anchored in place, not retired — The rule (one
        # identity row per identity however many conversations ask for it) survives in
        # ensureIdentityRow, whose idempotence is INSERT OR IGNORE against the unique
        # agent_identity.id. Removing OR IGNORE makes the second ask throw a UNIQUE violation.
        # Killed by `agent-profile-identity.test.ts`.
        [
            (STORE, '      ensureIdentityRow: db.prepare(\n        `INSERT OR IGNORE INTO agent_identity\n', '      ensureIdentityRow: db.prepare(\n        `INSERT INTO agent_identity\n'),
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-016b, 5e931be8, the tree):** The commit removes the
        # project table and every project row on purpose: "the project, proposal, binding, home and
        # document tables go", and the migration is "ONE migration, 0000_the_tree, on a fresh file
        # only". 0000_the_tree.sql has no `project` table and no `proj:default` insert, so there is
        # no project INSERT left to plant on. Its anchor is left stale, so the census records it
        # retired.
        "M5 · nothing creates the PROJECT row, so the first conversation in a profile has no identity "
        "to belong to — the migration's project INSERT, removed",
        [
            (
                MIGRATION,
                "INSERT OR IGNORE INTO `project` (`id`, `slug`, `display_name`, `created_at`)\nVALUES (\n  'proj:default',",
                "INSERT OR IGNORE INTO `project` (`id`, `slug`, `display_name`, `created_at`)\nVALUES (\n  'proj:nowhere',",
            )
        ],
    ),
    (
        "M6 · `identityOf` answers for a session that has NO profile — a LEFT JOIN, so a conversation "
        "from the user's own home is reported as belonging to an identity of ours",
        # ⚑ Landing D-016a (bd70d693) · re-anchored in place, not retired — The rule holds:
        # `identityOf` must answer null for a session with no `agent_profile_id` (a conversation
        # from the user's own home), and `selectProfileIdentity` is still the one query that decides
        # it. D-016 dropped `JOIN project p`, so the old two-line anchor is gone; the corrected
        # plant turns the one remaining inner JOIN into a LEFT JOIN, which is the label's defect
        # verbatim.
        # ⚑ Landing D-016a commit 2 (a5d66e92) · re-anchored in place, not retired — The rule
        # survives: identityOf answers null for a conversation that has no identity. That is the
        # INNER JOIN agent_identity in identityOfSession; a LEFT JOIN returns a row with a null slug
        # instead of null. Killed by `agent-profile-identity.test.ts`.
        [
            (STORE, '           JOIN agent_identity identity ON identity.id = s.agent_identity_id\n          WHERE s.id = ?`', '           LEFT JOIN agent_identity identity ON identity.id = s.agent_identity_id\n          WHERE s.id = ?`'),
        ],
    ),
    # ------------------------------------------------------------------ rotation
    (
        # ⛔ **RETIRED BY RULING (landing D-016b, 5e931be8, the tree):** D-016b drops the `rotation`
        # column from provider_session: DEV's spec (c3-spec.md 1.3) lists "Gone: `rotation`,
        # `agent_profile_id` ... `provider_session_identity_rotation_uq`", and 04-tree-data-model.md
        # Q2 says "No rotation, for any conversation." `createTx` no longer allocates a position
        # (`selectNextRotation` was deleted), and agent-profile-identity.test.ts says the cases
        # about a session's position were deleted because their subject went. Its anchor is left
        # stale, so the census records it retired.
        "M7 · ⛔ THE OTHER HALF, verbatim · `rotation` is the provider's zero again — every session "
        "of a profile claims position 0 (194 H5: *\"new sessions commonly persist provider rotation 0\"*)",
        [
            (
                STORE,
                "    const rotation = (selectNextRotation().get(identityId) as { next: number }).next\n",
                "    const rotation = 0\n",
            )
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-016b, 5e931be8, the tree):** `nextRotation` (the `max +
        # 1` statement) was deleted with the `rotation` column: "`nextRotation` /
        # `selectNextRotation` ... go" (c3-spec.md) and "No rotation, for any conversation"
        # (04-tree-data-model.md Q2). No allocator remains, so there is no COUNT-versus-max defect
        # to plant. Its anchor is left stale, so the census records it retired.
        "M8 · the next position is a COUNT rather than `max + 1`, so a gap in a profile's history "
        "hands out a number that is already taken",
        [
            (
                STORE,
                "        `SELECT coalesce(max(rotation) + 1, 0) AS next FROM provider_session WHERE agent_identity_id = ?`,\n",
                "        `SELECT count(*) AS next FROM provider_session WHERE agent_identity_id = ?`,\n",
            )
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-016b, 5e931be8, the tree):** The unique key was on
        # (agent_profile_id, rotation), and both columns are gone. c3-spec.md 1.3 lists
        # `provider_session_profile_rotation_uq` and `provider_session_identity_rotation_uq` under
        # "Gone", and 0000_the_tree.sql creates no such index. The only unique indexes left on
        # provider_session are none; its indexes are status, identity, parent, parent+identity and
        # launched_as. Its anchor is left stale, so the census records it retired.
        "M9 · ⛔ the unique key is gone from the migration — `agent_profile + rotation` stops being a "
        "key and the database is back to holding two rows for one identity",
        [
            (
                MIGRATION,
                "CREATE UNIQUE INDEX `provider_session_profile_rotation_uq` ON `provider_session` (`agent_profile_id`,`rotation`);",
                "CREATE INDEX `provider_session_profile_rotation_uq` ON `provider_session` (`agent_profile_id`,`rotation`);",
            )
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-016a commit 2, a5d66e92):** The commit a5d66e92 removed
        # currentSessionFor: agent-profile-identity.test.ts now carries the comment "D-016 · *names
        # the CURRENT session of a profile* went with `currentSessionFor`, which no product code
        # called", and no currentSessionFor or `rotation DESC` remains in src. There is no code left
        # to plant on. Its anchor is left stale, so the census records it retired.
        "M10 · `currentSessionFor` answers with the OLDEST session of a profile — the domain's "
        "*\"the current one of possibly many\"*, read backwards",
        [
            (
                STORE,
                "        `SELECT id FROM provider_session WHERE agent_identity_id = ? ORDER BY rotation DESC LIMIT 1`,\n",
                "        `SELECT id FROM provider_session WHERE agent_identity_id = ? ORDER BY rotation ASC LIMIT 1`,\n",
            )
        ],
    ),
    (
        "M11 · the REF is overwritten with our position — a bundle exported at rotation 7 resumes "
        "against a handle that says 0, which is a provider fact replaced by one of ours",
        [
            (
                STORE,
                "      rotation: record.rotation ?? 0,\n    })\n",
                "      rotation: 0,\n    })\n",
            )
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-016b, 5e931be8, the tree):** The defect was an adopted
        # row taking the profile's next rotation position. `insertAdoptedRow` no longer writes a
        # rotation column (the diff drops `identityId === null ? (record.rotation ?? 0) :
        # selectNextRotation()...`), and the rotation column is "Gone" per c3-spec.md 1.3. What is
        # left, the ref keeping the rotation it arrived with, is 204 M11's row, which is not stale.
        # Its anchor is left stale, so the census records it retired.
        "M12 · ⚠️ THE REFUSAL, disarmed · an adopted row takes the profile's next position instead of "
        "the one it arrived with, so importing a bundle renumbers a life it was never part of",
        # ⚑ Landing D-016a commit 2 (a5d66e92) · re-anchored in place, not retired — The rule
        # survives: a bundle with no identity keeps the rotation it arrived with (record.rotation ??
        # 0) and only a placed one is allocated `coalesce(max(rotation)+1, 0)` per agent_identity_id
        # (a5d66e92: "rotation is still allocated"). The plant drops the null branch so the
        # allocator answers for an unplaced bundle. Killed by `agent-profile-identity.test.ts`.
        [
            (STORE, '      identityId === null\n        ? (record.rotation ?? 0)\n        : (selectNextRotation().get(identityId) as { next: number }).next,\n', '      (selectNextRotation().get(identityId) as { next: number } | undefined)?.next ?? 0,\n'),
        ],
    ),
    # ------------------------------------------------------------------ the migration and its backfill
    (
        # ⛔ **RETIRED BY RULING (landing D-016b, 5e931be8, the tree):** This is a defect in 0013's
        # backfill UPDATE against an existing ledger. The commit replaces the 0001-0047 migrations
        # with one migration that "runs on a fresh file only" and "refuses" the old file, so no
        # backfill exists. agent-profile-identity.test.ts notes that the SQL twin of an id
        # derivation was deleted ("no migration derives one now"), and the rotation half of the
        # UPDATE is gone with the column. Its anchor is left stale, so the census records it
        # retired.
        "M13 · ⛔ the backfill writes the identity and the position in TWO statements — seventeen "
        "`default` rows land on `(default, 0)` in the gap between them and the migration fails on a "
        "real ledger",
        [
            (
                MIGRATION,
                "UPDATE `provider_session`\nSET\n  `agent_profile_id` = 'agp:default:' || coalesce(`profile_id`, 'default'),\n  `rotation` = (",
                "UPDATE `provider_session`\nSET\n  `agent_profile_id` = 'agp:default:' || coalesce(`profile_id`, 'default')\nWHERE `agent_profile_id` IS NULL\n  AND NOT (`adopted_at` IS NOT NULL AND `profile_id` IS NULL);--> statement-breakpoint\nUPDATE `provider_session`\nSET\n  `rotation` = (",
            )
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-016b, 5e931be8, the tree):** The subject is 0013's
        # backfill ordering positions by created_at versus id. There is no backfill and no rotation
        # column in the one fresh-file migration, and the column is "Gone" in c3-spec.md 1.3.
        # Nothing numbers a profile's life any more ("No rotation, for any conversation"). Its
        # anchor is left stale, so the census records it retired.
        "M14 · the backfill numbers a profile's life by ID rather than by when each session STARTED, "
        "so the positions are alphabetical and the current one is whichever id sorts last",
        [
            (
                MIGRATION,
                "        earlier.`created_at` < `provider_session`.`created_at`\n        OR (earlier.`created_at` = `provider_session`.`created_at` AND earlier.`id` < `provider_session`.`id`)\n",
                "        earlier.`id` < `provider_session`.`id`\n",
            )
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-016b, 5e931be8, the tree):** The subject is the
        # backfill's `INSERT OR IGNORE INTO project`. The `project` table and the whole upgrade path
        # are removed on purpose ("the project, proposal, binding, home and document tables go"; the
        # migration "runs on a fresh file only"), so there is no idempotent repair run and no
        # project INSERT. Its anchor is left stale, so the census records it retired.
        "M15 · the project row is `INSERT`, not `INSERT OR IGNORE` — the backfill stops being "
        "idempotent and a repair run fails on the row it wrote itself",
        [
            (
                MIGRATION,
                "INSERT OR IGNORE INTO `project` (`id`, `slug`, `display_name`, `created_at`)\n",
                "INSERT INTO `project` (`id`, `slug`, `display_name`, `created_at`)\n",
            )
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-016b, 5e931be8, the tree):** The subject is 0013's
        # backfill stamping `agent_profile.created_at` from min(session created_at). The backfill
        # and the `agent_profile` binding are both removed by the one fresh-file migration ("the
        # project, proposal, binding ... tables go"). Nothing in 0000_the_tree.sql backfills a
        # profile row from existing sessions. Its anchor is left stale, so the census records it
        # retired.
        "M16 · a backfilled profile is stamped with the migration's CLOCK — the day of the upgrade "
        "recorded as the day the identity was born",
        [
            (
                MIGRATION,
                "  cast(min(`created_at`) AS integer)\nFROM `provider_session`\n",
                "  cast(strftime('%s', 'now') AS integer) * 1000\nFROM `provider_session`\n",
            )
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-016b, 5e931be8, the tree):** The label's defect is an
        # upgrade migration that stops being additive by dropping `profile_id` from a live ledger.
        # That concept is gone: the database is now "ONE migration, 0000_the_tree, on a fresh file
        # only", which creates `profile_id` directly and "refuses" the old file. A `DROP COLUMN
        # profile_id` on a table the same file just created would be a different defect that every
        # test already reddens for a missing column; see other_notes. Its anchor is left stale, so
        # the census records it retired.
        "M17 · the migration stops being additive — the free string is dropped once the relation "
        "exists, and 139 call sites plus every provider-home path lose the name of their folder",
        [
            (
                MIGRATION,
                "CREATE INDEX `provider_session_parent_idx` ON `provider_session` (`parent_session_id`);",
                "CREATE INDEX `provider_session_parent_idx` ON `provider_session` (`parent_session_id`);--> statement-breakpoint\nALTER TABLE `provider_session` DROP COLUMN `profile_id`;",
            )
        ],
    ),
    (
        "M18 · the FK is declared without a REFERENCES, so `agent_profile_id` is a free string too "
        "and a session can name an identity that does not exist",
        # ⚑ Landing D-016b (5e931be8, the tree) · re-anchored in place, not retired — The rule (a
        # session may not name an identity that does not exist, so the relation is a real FK and not
        # a free string) survives. c3-spec.md 1.3 keeps `agent_identity_id` -> agent_identity, and
        # 0000_the_tree.sql declares it as a FOREIGN KEY on provider_session. `agent_profile_id` is
        # gone, so the plant removes that FOREIGN KEY line, which is the label's defect verbatim on
        # today's column. Killed by `agent-profile-identity.test.ts`.
        [
            (MIGRATION_0000_THE_TREE, '\tFOREIGN KEY (`agent_identity_id`) REFERENCES `agent_identity`(`id`) ON UPDATE no action ON DELETE no action,\n', ''),
        ],
    ),
    # ------------------------------------------------------------------ the two nulls
    (
        "M19 · ⛔ THE COALESCING BUG, verbatim (168 L5 · 182 · 188) · an adopted row's null profile "
        "becomes `default`, so a conversation swept out of the user's OWN `~/.claude` is recorded as "
        "living in a home of ours",
        # ⚑ Landing D-016a (bd70d693) · re-anchored in place, not retired — The rule (an adopted
        # conversation from the user's own home has a null profile and must stay unbound, never
        # coalesced to the default profile) still holds at `insertAdoptedRow`; D-016 only removed
        # the third `projectSlug` argument, and the default profile is now `DEFAULT_PROFILE_ID`
        # ('brobot' since 592), not the literal `default` in the label. A single-edit plant would
        # throw a TypeError in `foldProfileName(null)` through
        # `agentIdentityHomeRowId(record.profileId as string, ...)`, so the plant coalesces both
        # sites and the red is the label's: the swept conversation is recorded as living in a home
        # of ours.
        # ⚑ Landing D-016a commit 2 (a5d66e92) · re-anchored in place, not retired — The rule
        # survives: a conversation created without a profile (the user's OWN home) gets no
        # agent_identity and stays unplaced. The plant places every such conversation under
        # DEFAULT_PROFILE_ID (already imported), which is the failure the label names. Killed by
        # `agent-profile-identity.test.ts`.
        [
            (STORE, '    const identityId = record.profileId === null ? null : identityRowFor(record.profileId, at)\n', '    const identityId = identityRowFor(record.profileId ?? DEFAULT_PROFILE_ID, at)\n'),
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-016b, 5e931be8, the tree):** The subject is 0013's
        # profile INSERT swallowing the null-profile rows during the backfill. There is no backfill
        # in the fresh-file migration ("runs on a fresh file only"), and the `agent_profile` table
        # it inserted into is removed ("binding ... tables go"). The null-profile rule itself lives
        # in `insertAdoptedRow` and is covered by 204 M19, which is not stale. Its anchor is left
        # stale, so the census records it retired.
        "M20 · …and the same bug in the MIGRATION's profile insert — every row on disk with a null "
        "profile is given the `default` identity, including the ones we never owned",
        [
            (
                MIGRATION,
                "FROM `provider_session`\nWHERE NOT (`adopted_at` IS NOT NULL AND `profile_id` IS NULL)\nGROUP BY coalesce(`profile_id`, 'default');",
                "FROM `provider_session`\nGROUP BY coalesce(`profile_id`, 'default');",
            )
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-016b, 5e931be8, the tree):** The subject is the backfill
        # UPDATE attributing pre-profile rows to `default`. The backfill is gone with the migrations
        # 0001-0047 ("ONE migration, 0000_the_tree, on a fresh file only"), and `agent_profile_id`
        # is "Gone" (c3-spec.md 1.3). The tests that read the SQL off disk and applied it to an old
        # fixture were deleted, and there is no old ledger to backfill. Its anchor is left stale, so
        # the census records it retired.
        "M21 · the OTHER null loses its home — a PRE-PROFILE row (`adopted_at` null) is left "
        "unattributed, though it ran in `default` and every read of it already resolves that way",
        [
            (
                MIGRATION,
                "WHERE `agent_profile_id` IS NULL\n  AND NOT (`adopted_at` IS NOT NULL AND `profile_id` IS NULL);",
                "WHERE `agent_profile_id` IS NULL\n  AND `profile_id` IS NOT NULL;",
            )
        ],
    ),
    # ------------------------------------------------------------------ §3's shape-only columns
    (
        # ⛔ **RETIRED BY RULING (landing D-016b, 5e931be8, the tree):** The label is about
        # `agent_profile.display_name`, the binding's column. The commit removes the binding table
        # on purpose ("the project, proposal, binding, home and document tables go"), and
        # agent-profile-identity.test.ts records that "the binding's `display_name` went with
        # `agent_profile`". `agent_identity.display_name` is a different, live column with its own
        # rows and tests (558 rename, name-minting), so it is not this row's subject. Its anchor is
        # left stale, so the census records it retired.
        "M22 · `agent_profile.display_name` is not created — the person's human name per profile has "
        "nowhere to land, and adding it later means moving ledgers",
        [
            (
                MIGRATION,
                "CREATE TABLE `agent_profile` (\n\t`id` text PRIMARY KEY NOT NULL,\n\t`project_id` text NOT NULL,\n\t`slug` text NOT NULL,\n\t`display_name` text,\n",
                "CREATE TABLE `agent_profile` (\n\t`id` text PRIMARY KEY NOT NULL,\n\t`project_id` text NOT NULL,\n\t`slug` text NOT NULL,\n",
            )
        ],
    ),
    (
        "M23 · `parent_session_id` is a free string rather than a self-FK, so the spawned-agent tree "
        "can point at a session that never existed",
        # ⚑ Landing D-016b (5e931be8, the tree) · re-anchored in place, not retired — The rule
        # (parent_session_id is a self-FK, so the spawned tree cannot point at a session that never
        # existed) survives: c3-spec.md 1.3 keeps `parent_session_id` -> provider_session, and
        # 0000_the_tree.sql declares it as a FOREIGN KEY. Only the file changed (0013 is deleted).
        # The plant removes that FOREIGN KEY line, which is the label's free-string defect on
        # today's schema. Killed by `agent-profile-identity.test.ts`.
        [
            (MIGRATION_0000_THE_TREE, '\tFOREIGN KEY (`parent_session_id`) REFERENCES `provider_session`(`id`) ON UPDATE no action ON DELETE no action,\n', ''),
        ],
    ),
]


def apply(root, index: int, dry: bool) -> int:
    name, edits = MUTATIONS[index]
    bad = 0
    for rel, find, replace in edits:
        path = root / rel
        text = path.read_text()
        hits = text.count(find)
        if hits != 1:
            print(
                f"!! {name}: anchor found {hits} times in {rel} (expected exactly 1)",
                file=sys.stderr,
            )
            bad += 1
            continue
        if not dry:
            path.write_text(text.replace(find, replace, 1))
    return 1 if bad else 0


def main() -> int:
    from pathlib import Path

    args = sys.argv[1:]
    if args[:1] == ["--count"]:
        print(len(MUTATIONS))
        return 0
    if args[:1] == ["--files"]:
        seen = []
        for _name, edits in MUTATIONS:
            for rel, _find, _replace in edits:
                if rel not in seen:
                    seen.append(rel)
        print(" ".join(seen))
        return 0
    if args[:1] == ["--name"]:
        print(MUTATIONS[int(args[1])][0])
        return 0
    if args[:1] == ["--dry-run"]:
        root = Path(args[1]).resolve()
        bad = 0
        for index in range(len(MUTATIONS)):
            bad += apply(root, index, dry=True)
        print(f"{len(MUTATIONS) - bad}/{len(MUTATIONS)} anchors found exactly once")
        return 1 if bad else 0
    root = Path(args[0]).resolve()
    return apply(root, int(args[1]), dry=False)


if __name__ == "__main__":
    raise SystemExit(main())
