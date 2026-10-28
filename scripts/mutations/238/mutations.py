#!/usr/bin/env python3
"""238's mutation table — each row is THE DEFECT, put back verbatim (131).

238 is two findings from `208`, both unspent since round 2.

**H1 — two names, one home.** `0013` keyed a profile on `(project_id, slug)` under SQLite's default
BINARY collation and derived `agent_profile.id` from the stored spelling. `Developer` and
`developer` are ONE directory on the shipped macOS volume format — measured, not assumed — so the
ledger could hold two identities, two rotation sequences and two answers to *"which session is
current"* over one home, one memory and one set of credentials. `166` makes that consequential:
memory follows the PROFILE.

**M1 — the stale-lock race.** `202` taught the provisioning lock to break a dead owner's lockfile,
and carried the judged file's BYTES to check the break afterwards. An owner-less lockfile has no
bytes, so two contenders meeting the same aged empty sidecar both judged with nothing to compare and
the second renamed away the LIVE lock the first had just stamped — then unlinked it and entered the
critical section beside it. The protected sections are home creation and the Codex credential copy.

The row groups:

 * `M1`-`M4`   🔴 **the identity stops folding**, at each of the four places that now perform it: the
               derived id, the slug on the row, the table's own `NOCASE` index, and the fold itself
               drifting away from the one SQLite performs.
 * `M5`-`M12`  ⛔ **the migration**, which is the half that runs against ledgers that already exist:
               variants left behind, groups renumbered that never collided, the two-phase park
               removed, the merged birth taken from the wrong spelling, the merged order taken from
               ids rather than from when the sessions started, the directory name folded along with
               the identity, idempotence, and the journal timestamp that makes a migration silently
               never apply.
 * `M13`-`M15` 🔴 **the break that does not check what it moved** — the defect verbatim, the
               judgement assembled out of two different files again, and the put-back removed.
 * `M16`-`M17` ⛔ **`202`'s M17 and M18, carried forward.** Both anchored on
               `ownerIsGone(lockPath, owner)`, a line this dispatch replaces, so they retire in place
               (142) — and the behaviour they guard does not, so it is guarded here instead.
 * `M18`-`M21` ⛔ **what an adversarial pass over this dispatch's OWN diff found**: a parked range
               resting on an unstated bound; the two shapes of unreadable lock path that a
               one-descriptor judgement made permanently unbreakable; and **`204` M2**, retired by
               the same line `M1` mutates and missed by the first draft of this file — which named
               only `202`'s two casualties, when the census reports three.

## ⛔ What this table cannot reach, stated because a table silent about its edges is claiming them

 * ⛔ **No row separates `size`/`mtimeMs`/`text` from `dev`+`ino` in `isSameFile`, and the reason is
   the FILESYSTEM rather than the fields** (review corrected this paragraph). All five are
   load-bearing: in the branch the check exists for, the judged corpse has already been unlinked by
   the winning contender, so its inode number is free and a filesystem that recycles them (ext4) can
   hand it straight to the winner's fresh lock — there the comparison is carried entirely by the
   other three. APFS hands out monotonically increasing file ids and does not recycle, which is why
   no construction on this machine can build that state, and therefore why the row would SURVIVE.
   `M13` mutates the comparison as a whole; `M15` mutates the put-back.
 * ⛔ **No row makes the two folds disagree on a name that can reach the database.** They fold
   differently outside ASCII on purpose — `profileAlreadyNamed` folds the way the VOLUME does
   (measured: a Kelvin sign and `k` are one dirent, so are `Éx` and `éx`), `foldProfileName` folds
   the way SQLite does — and `isPathSegment` bounds every writer to ASCII, where they agree. The
   guards that make that true are asserted in `profile-collision.test.ts` §1 rather than mutated,
   because they are `provider-homes.ts`'s and `read-bundle.ts`'s rather than this dispatch's.
 * **No row reaches the real ledger.** The migration was run against a `cp -c` clone of the person's own
   database — 24 sessions, 2 profiles, zero case-variant groups, every row mapped one to one, then
   deleted. A ledger with no collision cannot prove a merge, so the merge rows below run against the
   constructed one in `profile-collision.test.ts` §2.
 * ⛔ **No row mutates `agent_profile_id IS NOT NULL` out of statement 4, because nothing would
   die.** It was a row until the parked range went NEGATIVE, and the negative range subsumes it: an
   unattributed row keeps a rotation the migration cannot mistake for one it parked, whatever its
   size. The clause stays because it makes the statement say what it means, and it is recorded here
   as un-killable rather than left in the table as a survivor. ⚑ `M18` mutates the range itself,
   which is the assumption that was actually wrong.
 * ⚠️ **`§2 is additive and consistent` never fires as an ASSERTION.** Every row it kills (`M5`,
   `M7`, `M11`) does so by making `applyMigrations` throw before its three checks run. It is a guard
   against a migration that completes and leaves the ledger inconsistent, and nothing in this table
   constructs one — said here rather than left to look like coverage.
 * **`dom` and `scripts` are expected GREEN on every row.** 238 touches no renderer file and no
   harness file; a project that stays green throughout is the honest way to say the change did not
   reach it.

## ⚑ The killing test for every row, named before the table was run, and CHECKED after

⚠️ Two of these were wrong in the first draft and were corrected by measurement rather than by
re-reading: `M2` was attributed to a `§2` test that never constructs a store, and `M4` to a `§2` test
that compared the fold against a corpus SQL had already folded — both stayed green under their own
rows until the tests were rewritten. Every entry below has been run.

`M1` `§1 two spellings are ONE profile` · `M2` `§1 two spellings are ONE profile` (it mutates the
STORE, which `§2` never builds) · `M3` `§1 the TABLE refuses the second spelling` ·
`M4` `§1 the fold is ASCII` ×2 (the `§2` derivation test does NOT kill it — its corpus is ASCII,
where the two folds agree, and saying otherwise was the first draft's mistake) · `M5`/`M11` `§2 merges the
two spellings into one identity` · `M6` `§2 a lone variant is re-pointed and NOT renumbered` ·
`M7` `§2 positions are one life` · `M8` `§2 keeps the EARLIER birth` · `M9` `§2 in the order they
started` · `M10` `§3 the legacy shape, end to end` · `M12` `§2 (all — the migration never applies)` ·
`M13`/`M14`/`M15` `race §1 breaks nothing when the file at the path is not the file it judged` ·
`M16` `provider-home.test.ts a lock left by a DEAD process is broken` · `M17` `…and a lock held by a
LIVE process is still honoured` · `M18` `§2 completes whatever NON-NEGATIVE rotations the ledger already holds` ·
`M19` `provider-home.test.ts an aged (mode-0000 file | dangling symlink) is still broken by age` ·
`M20` `…an aged directory is still broken by age` · `M21` `§2 derives the same id this app does` and
`agent-profile-identity.test.ts spells its ids the same way the migration does`.

## ⛔ What `369` did to this table

⚑ **`M2` was RE-ANCHORED, not retired.** `369` made `profileRowFor` take the project from the session, so `DEFAULT_PROJECT_ROW_ID` became `projectRowId(projectSlug)` on this line. The anchor was corrected and **the row was re-applied and re-run** rather than merely re-matched.
⛔ **A corrected anchor otherwise keeps a verdict it never earned**, which is free to do and
impossible to notice afterwards.
"""

from pathlib import Path

ID = "apps/desktop/src/main/db/identity.ts"
STORE = "apps/desktop/src/main/db/session-store.ts"
IPC = "apps/desktop/src/shared/runtime-ipc.ts"
MIG = "apps/desktop/src/main/db/migrations/0015_quick_iceman.sql"
JOURNAL = "apps/desktop/src/main/db/migrations/meta/_journal.json"
HOME = "packages/runtime/src/internal/provider-home.ts"
MIGRATION_0000_THE_TREE = "apps/desktop/src/main/db/migrations/0000_the_tree.sql"

# (name, [(file, old, new), ...])
MUTATIONS = [
    # ---- the identity stops folding ---------------------------------------------------------------
    (
        "M1 · 🔴 THE DEFECT, verbatim (208 H1) · the derived id keeps the caller's spelling, so "
        "`Developer` and `developer` are two relational identities over one physical home",
        [
            (
                ID,
                "  return `agp${SEP}${projectSlug}${SEP}${foldProfileName(profileSlug)}`",
                "  return `agp${SEP}${projectSlug}${SEP}${profileSlug}`",
            )
        ],
    ),
    (
        "M2 · ⛔ the row's own name disagrees with its key · the slug is stored as the caller spelled "
        "it, so `id` and `slug` can no longer be re-derived from each other",
        # ⚑ Landing D-016a (bd70d693) · re-anchored in place, not retired — The rule (an
        # agent_profile row's slug is folded, so `id` and `slug` re-derive from each other) is
        # unchanged; D-016 only replaced `projectRowId(projectSlug)` with
        # `projectRowId(DEFAULT_PROJECT_ID)` in `ensureProfileRow.run`, because every binding lives
        # in the default project now. The corrected plant stores the slug as the caller spelled it.
        # ⚑ Landing D-016a commit 2 (a5d66e92) · re-anchored in place, not retired — The rule
        # survives: agent_identity.slug is the FOLDED profile name (CHECK
        # agent_identity_slug_folded_ck, slug = lower(slug)); the plant writes the spelling as
        # given. The red is by consequence, not by a slug assertion (see other_notes). Killed by
        # `profile-collision.test.ts`.
        [
            (STORE, '      agentIdentityRowId(profileSlug),\n      foldProfileName(profileSlug),\n      said.displayName,\n', '      agentIdentityRowId(profileSlug),\n      profileSlug,\n      said.displayName,\n'),
        ],
    ),
    (
        "M3 · ⛔ the TABLE stops answering · the unique index goes back to BINARY, so the rule lives "
        "only in whichever writer remembers it — which is the state 208 H1 found",
        # ⚑ Landing D-016b (5e931be8, the tree) · re-anchored in place, not retired — The rule (the
        # TABLE refuses a second spelling of one home, past every caller) survives: agent_profile's
        # NOCASE unique index became `agent_identity_slug_uq` (NOCASE) plus
        # `agent_identity_slug_folded_ck` in 0000_the_tree.sql, and profile-collision.test.ts "the
        # TABLE refuses the second spelling, past every caller" measures it. Both guards overlap, so
        # the plant removes both; changing only the index would survive on the CHECK. Killed by
        # `profile-collision.test.ts`.
        [
            (MIGRATION_0000_THE_TREE, 'CREATE UNIQUE INDEX `agent_identity_slug_uq` ON `agent_identity` ("slug" COLLATE NOCASE);', 'CREATE UNIQUE INDEX `agent_identity_slug_uq` ON `agent_identity` (`slug`);'),
            (MIGRATION_0000_THE_TREE, '\tCONSTRAINT "agent_identity_slug_folded_ck" CHECK("agent_identity"."slug" = lower("agent_identity"."slug")),\n', ''),
        ],
    ),
    (
        "M4 · ⛔ the fold drifts away from SQLite's · Unicode `toLowerCase` derives `dév` for a row "
        "the migration and the index key as `dÉv`, which is the same split identity one alphabet over",
        [
            (
                IPC,
                "  return name.replace(/[A-Z]/g, (letter) => letter.toLowerCase())",
                "  return name.toLowerCase()",
            )
        ],
    ),
    # ---- the migration ----------------------------------------------------------------------------
    (
        # ⛔ **RETIRED BY RULING (landing D-016b, 5e931be8, the tree):** The subject is the DELETE of
        # variant agent_profile rows in 0015's merge, and the agent_profile table and that migration
        # no longer exist. Commit 5e931be8: "The database is ONE migration, 0000_the_tree, on a
        # fresh file only: the project, proposal, binding, home and document tables go"; "The old
        # file is refused untouched: 0000 fails on its first CREATE and rolls back." There is no old
        # ledger for a merge to leave variant rows in. Its anchor is left stale, so the census
        # records it retired.
        "M5 · ⛔ the variant rows are left behind · the merge moves the sessions and then keeps both "
        "identities, so the ledger still holds two names for one home",
        [
            (
                MIG,
                "DELETE FROM `agent_profile`\nWHERE `id` <> (",
                "DELETE FROM `agent_profile`\nWHERE 0 AND `id` <> (",
            )
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-016b, 5e931be8, the tree):** The subject is the `> 1`
        # collided-groups filter in 0015's rotation renumber, and neither that migration nor
        # `rotation` exists. Commit 5e931be8: "The database is ONE migration, 0000_the_tree, on a
        # fresh file only"; "Runs on a fresh database only." The reset (commit 4) moves an old
        # userData onto the tree, so no SQL renumbers an existing ledger. Its anchor is left stale,
        # so the census records it retired.
        "M6 · ⛔ every group is renumbered, not only the collided ones · a profile whose middle "
        "session was deleted holds 0 and 2 legitimately (`max + 1`), and a count-based renumber "
        "silently closes that gap and hands out a position the next launch will collide with",
        [(MIG, "   ) > 1\n", "   ) >= 1\n")],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-016b, 5e931be8, the tree):** The subject is the two-phase
        # park of `rotation` in 0015 (`-1 - rowid`), removed with the migration and the column.
        # Commit 5e931be8: "The database is ONE migration, 0000_the_tree, on a fresh file only: the
        # project, proposal, binding, home and document tables go". A fresh file has no rows to
        # merge, so a one-statement renumber into a unique index cannot fail on it. Its anchor is
        # left stale, so the census records it retired.
        "M7 · ⛔ THE 204 M13 SHAPE, one migration later · the two-phase park is removed and final "
        "positions are assigned in one statement, into a unique index that is already in force — so "
        "a merge of two spellings that each ran three sessions fails on a real ledger",
        [
            (
                MIG,
                "  `rotation` = -1 - `provider_session`.`rowid`",
                "  `rotation` = (\n"
                "    SELECT count(*) FROM `provider_session` AS `earlier`\n"
                "     WHERE `earlier`.`agent_profile_id` = `provider_session`.`agent_profile_id`\n"
                "       AND (\n"
                "         `earlier`.`created_at` < `provider_session`.`created_at`\n"
                "         OR (`earlier`.`created_at` = `provider_session`.`created_at` AND `earlier`.`id` < `provider_session`.`id`)\n"
                "       )\n"
                "  )",
            )
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-016b, 5e931be8, the tree):** The subject is
        # `min(created_at)` in 0015's merged agent_profile insert, and both the migration and the
        # agent_profile table are gone. Commit 5e931be8: "The database is ONE migration,
        # 0000_the_tree, on a fresh file only: the project, proposal, binding, home and document
        # tables go"; "The old file is refused untouched". No merge of two spellings happens in SQL
        # any more. Its anchor is left stale, so the census records it retired.
        "M8 · ⛔ the merged identity is born on the wrong day · `created_at` is taken from the LATER "
        "spelling, so a profile's history starts after conversations it already held",
        [
            (
                MIG,
                "    SELECT min(`g`.`created_at`) FROM `agent_profile` AS `g`",
                "    SELECT max(`g`.`created_at`) FROM `agent_profile` AS `g`",
            )
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-016b, 5e931be8, the tree):** The subject is the `earlier`
        # created_at/id ordering in 0015's rotation renumber, and both the migration and `rotation`
        # are gone. Commit 5e931be8: "The database is ONE migration, 0000_the_tree, on a fresh file
        # only"; "Runs on a fresh database only. The old file is refused untouched: 0000 fails on
        # its first CREATE and rolls back." Its anchor is left stale, so the census records it
        # retired.
        "M9 · ⛔ the merged life is ordered by id · two spellings interleave in TIME, and ordering "
        "the union by anything else makes `rotation` a sort key rather than a position",
        [
            (
                MIG,
                "       `earlier`.`created_at` < `provider_session`.`created_at`\n"
                "       OR (`earlier`.`created_at` = `provider_session`.`created_at` AND `earlier`.`id` < `provider_session`.`id`)",
                "       `earlier`.`id` < `provider_session`.`id`",
            )
        ],
    ),
    (
        "M10 · 🔴 the DIRECTORY name is folded too · `provider_session.profile_id` is what four path "
        "derivations read, so folding it sends a conversation recorded under `Developer` to a folder "
        "it never ran in — 149's failure shape, arriving as the fix for a different one",
        # ⚑ Landing D-016b (5e931be8, the tree) · re-anchored in place, not retired — The migration
        # UPDATE this row planted is gone with 0015, but the rule survives:
        # `provider_session.profile_id` is still the DIRECTORY name (free text, kept beside the
        # folded `agent_identity.slug`), and profile-collision.test.ts still asserts "the free
        # string keeps every spelling, because it is the DIRECTORY name". The same fold can now only
        # arrive from the writer, `createTx`'s insertSession, so the plant moves there. Killed by
        # `profile-collision.test.ts`.
        [
            # ⚑ **4004 · re-anchored in place, not retired** — Recorded storage adds an optional address; preserve the same legacy defect and killer.
            (STORE, "      record.approvalMode,\n      record.profileId,\n      ...(locationStatements === null ? [] : [record.providerLocation ?? null]),\n      // Null, not a default: \"nobody chose\" and \"chose medium\" are different facts, and only\n", "      record.approvalMode,\n      record.profileId.toLowerCase(),\n      ...(locationStatements === null ? [] : [record.providerLocation ?? null]),\n      // Null, not a default: \"nobody chose\" and \"chose medium\" are different facts, and only\n"),
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-016b, 5e931be8, the tree):** The subject is the backfill
        # in migration 0015_quick_iceman.sql (INSERT OR IGNORE INTO agent_profile), and that file,
        # the agent_profile table and the whole 0001-0042 chain are gone. Commit 5e931be8: "The
        # database is ONE migration, 0000_the_tree, on a fresh file only: the project, proposal,
        # binding, home and document tables go"; "Runs on a fresh database only. The old file is
        # refused untouched". A migration that runs on an empty file has no existing identity to
        # collide with. Its anchor is left stale, so the census records it retired.
        "M11 · ⛔ the backfill stops being idempotent · a plain INSERT over an identity whose "
        "canonical row already exists throws, and a migration whose second run cannot complete is "
        "one nobody can repair a half-applied database with (0013's own rule)",
        [
            (
                MIG,
                "INSERT OR IGNORE INTO `agent_profile` (`id`, `project_id`, `slug`, `display_name`, `created_at`)",
                "INSERT INTO `agent_profile` (`id`, `project_id`, `slug`, `display_name`, `created_at`)",
            )
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-016b, 5e931be8, the tree):** The subject is the `when`
        # stamp of the 0015 journal entry against the previous entry. Commit 5e931be8: "The database
        # is ONE migration, 0000_the_tree, on a fresh file only"; _journal.json now has a single
        # entry (idx 0), so there is no previous stamp to fall behind and the plant cannot fail for
        # the row's reason. The general monotonic-stamp rule stays with a-stamp-that-skips.test.ts.
        # Its anchor is left stale, so the census records it retired.
        "M12 · ⛔ the migration is silently NEVER APPLIED · drizzle decides by timestamp, not by name "
        "or hash, so a `when` that is not after the previous entry's skips the file forever on every "
        "database that has already migrated — with no error anywhere",
        [(JOURNAL, '      "when": 1787938389059,', '      "when": 1787676315545,')],
    ),
    # ---- the break that does not check what it moved ----------------------------------------------
    (
        "M13 · 🔴 THE DEFECT, verbatim (208 M1) · the restore is decided by BYTES again, so a "
        "contender that judged an empty corpse never puts back the live lock it renamed away — and "
        "two processes provision one home at once",
        [
            (
                HOME,
                "  if (moved === null || !isSameFile(moved, judged)) {",
                "  if (judged.owner !== null && (moved === null || moved.text !== judged.text)) {",
            )
        ],
    ),
    (
        "M14 · ⛔ the judgement is assembled out of two different files again · the age comes from a "
        "fresh `lstat` of the PATH rather than from the descriptor the bytes were read through, so "
        "'this file said nothing' and 'this file is old' stop being facts about one file",
        [
            (
            # ⚑ **W4.789 · re-anchored in place, not retired** — the lock's identity is read as exact integers (`{ bigint: true }`, `isTheSameFile`), so a file number past 2^53 on Windows is not rounded; the fault is unchanged. Source-only, NOT VERIFIED (provisioning-lock code: running it needs a sealed lift).
                HOME,
                "    const stat = fstatSync(fd, { bigint: true })\n"
                "    let text = ''\n"
                "    try {\n"
                "      text = readFileSync(fd, 'utf8')\n"
                "    } catch {\n"
                "      // unreadable: identified by its inode all the same, and judged by age like any unstamped lock\n"
                "    }\n",
                "    let text = ''\n"
                "    try {\n"
                "      text = readFileSync(fd, 'utf8')\n"
                "    } catch {\n"
                "      // unreadable\n"
                "    }\n"
                "    const stat = lstatSync(path, { bigint: true })\n",
            )
        ],
    ),
    (
        "M15 · ⛔ the put-back is gone · the break checks what it moved, finds somebody else's live "
        "lock, and destroys it anyway — the check without the consequence",
        [
            (
                HOME,
                "      linkSync(stolen, lockPath) // only if the path is free — never clobber a live holder",
                "      void lockPath // the file is not put back",
            )
        ],
    ),
    # ---- 202's M17 and M18, retired in place there and carried forward here -----------------------
    (
        "M16 · 🔒 (202 M17, re-anchored) a stale lock is never broken, whatever it says about itself "
        "— 198's *'most likely way to brick the app'*, back",
        [
            (
                HOME,
                "      if (judged !== null && steals < MAX_LOCK_STEALS && ownerIsGone(judged)) {",
                "      if (false as boolean) {",
            )
        ],
    ),
    (
        "M17 · 🔒 (202 M18, re-anchored) every lock is broken, alive or not — a lock that breaks "
        "itself for everybody is not a lock, and this one serializes credential writes into one home",
        [
            (
                HOME,
                "      if (judged !== null && steals < MAX_LOCK_STEALS && ownerIsGone(judged)) {",
                "      if (judged !== null && steals < MAX_LOCK_STEALS) {",
            )
        ],
    ),
    # ---- what an adversarial pass over this dispatch's OWN diff found ----------------------------
    (
        # ⛔ **RETIRED BY RULING (landing D-016b, 5e931be8, the tree):** The subject is the parked
        # rotation range inside 0015's renumbering UPDATE, and both that migration and
        # `provider_session.rotation` / `agent_profile_id` are gone from schema.ts. Commit 5e931be8:
        # "The database is ONE migration, 0000_the_tree, on a fresh file only: the project,
        # proposal, binding, home and document tables go" and "The old file is refused untouched".
        # Nothing renumbers an existing ledger any more. Its anchor is left stale, so the census
        # records it retired.
        "M18 · ⛔ the parked range goes back to resting on an unstated bound · `1000000000 + rowid` "
        "assumes no ledger holds a rotation that big, and one row that does collides with the park "
        "itself — inside drizzle's single transaction, which is an app that will not start",
        [
            (
                MIG,
                "  `rotation` = -1 - `provider_session`.`rowid`",
                "  `rotation` = 1000000000 + `provider_session`.`rowid`",
            ),
            (
                MIG,
                "WHERE `rotation` < 0 AND `agent_profile_id` IS NOT NULL;",
                "WHERE `rotation` >= 1000000000 AND `agent_profile_id` IS NOT NULL;",
            ),
        ],
    ),
    (
        "M19 · ⛔ a lock path that will not OPEN yields no judgement · a file at mode 0000 left by a "
        "run under another uid, or a dangling symlink, can then never be broken and every later "
        "provisioning of that home times out forever — 191 M5's *fails forever*, arriving as the fix "
        "for a different finding",
        [
            (
            # ⚑ **W4.789 · re-anchored in place, not retired** — the lock's identity is read as exact integers (`{ bigint: true }`, `isTheSameFile`), so a file number past 2^53 on Windows is not rounded; the fault is unchanged. Source-only, NOT VERIFIED (provisioning-lock code: running it needs a sealed lift).
                HOME,
                "    const stat = exactLstatOrNull(path)\n"
                "    if (stat === null) return null // it is not there at all — nothing to judge, and nothing to break\n"
                "    return {\n"
                "      dev: stat.dev,\n"
                "      ino: stat.ino,\n"
                "      size: stat.size,\n"
                "      mtimeNs: stat.mtimeNs,\n"
                "      mtimeMs: Number(stat.mtimeMs),\n"
                "      text: '',\n"
                "      owner: null,\n"
                "    }\n",
                "    return null\n",
            )
        ],
    ),
    (
        "M20 · ⛔ …and the same for a path that opens but will not READ · a DIRECTORY at the lock "
        "path becomes unbreakable, which is the half the first repair covered and the half a "
        "one-branch fix would have left",
        [
            (
                HOME,
                "    let text = ''\n"
                "    try {\n"
                "      text = readFileSync(fd, 'utf8')\n"
                "    } catch {\n"
                "      // unreadable: identified by its inode all the same, and judged by age like any unstamped lock\n"
                "    }\n",
                "    const text = readFileSync(fd, 'utf8')\n",
            )
        ],
    ),
    (
        "M21 · 🔒 (204 M2, re-anchored) the profile id forgets its PROJECT — `agp:<slug>` instead of "
        "`agp:<project>:<slug>` · 204's row anchored on the line 238 M1 replaces, so it retires in "
        "place (142) and the behaviour it guarded is carried here",
        [
            (
                ID,
                "  return `agp${SEP}${projectSlug}${SEP}${foldProfileName(profileSlug)}`",
                "  return `agp${SEP}${foldProfileName(profileSlug)}`",
            )
        ],
    ),
]


def apply(root: Path, index: int, dry: bool) -> int:
    name, edits = MUTATIONS[index]
    bad = 0
    for rel, find, replace in edits:
        path = Path(root) / rel
        text = path.read_text()
        hits = text.count(find)
        if hits != 1:
            print(f"!! {name}: anchor found {hits} times in {rel} (expected exactly 1)")
            bad += 1
            continue
        if not dry:
            path.write_text(text.replace(find, replace))
    return bad


def main() -> int:
    import sys

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
