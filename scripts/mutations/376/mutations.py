"""376 · A second project, and the grant the app gives itself.

⛔ **Two subjects, and each has a way of failing that reads as working.**

1. **A second project.** A person can create one, a conversation is created in it, and one identity
   works in both while keeping one memory. ⚑ The defects here are all the same shape: two spellings
   of one project becoming two rows, or a placement quietly landing somewhere the person did not
   choose.
2. **The grant the app gives itself** (HO-016 §2). BroBot ships holding `can_message: any`, seeded
   **at creation** and never re-granted. 🔴 **The whole risk is that a seed and a re-seed are
   indistinguishable from the outside** until somebody narrows the grant and restarts — which is
   why more rows below are about the SEED-ONCE mechanism than about the value.

## 🔴 Which gate can see each row

| rows | the defect is caught by |
|---|---|
| `M1`-`M4` | ⚑ **`apps/desktop/test/a-second-project-and-the-grant.test.ts`** §1 — the fold |
| `M5`-`M9` | ⚑ **`apps/desktop/test/a-second-project-and-the-grant.test.ts`** §2 — the placement |
| `M10`-`M13` | ⚑ **`apps/desktop/test/a-second-project-and-the-grant.test.ts`** §3/§4 — the seed |
| `M14` | ⚠️ **`apps/desktop/test/a-category-seeds.test.ts`** §4, plus `a-top-tier-that-can-delegate.test.ts` §1/§7 |
| `M15`, `M16` | ⚑ **`apps/desktop/test/a-second-project-and-the-grant.test.ts`** §6 — the migration |
| `M17`, `M18` | ⚑ **`apps/desktop/test/a-second-project-and-the-grant.test.ts`** §5 — `list_agents` |
| `M19`-`M23` | ⚑ **`apps/desktop/test/dom/a-second-project.dom.test.ts`** — the rail and the sheet |
| `M24` | ⚑ **`apps/desktop/test/launch-draft.test.ts`** — the draft |
| `M25` | ⚑ **`apps/desktop/test/the-rails-a-message-passes.test.ts`** — criterion 6 re-pointed |

## ⛔ What this table deliberately does NOT contain

⛔ **No row deleting the `no-such-project` door's `input.projectSlug !== undefined` guard.** Widening
it to the RESOLVED slug refuses every launch on `NULL_SESSION_STORE` — 66 host tests go red at once,
which is a break with no diagnostic value: the row would be indistinguishable from a broken harness.
⚑ The clause is instead carried by a positive: §2's *"one fact over"* opens a session with no project
named, on the same host, immediately after the refusal.

⛔ **No row on `projects()`'s `ORDER BY created_at, slug`.** ⚠️ The tiebreak is real — two projects
made in one millisecond are reachable, `created_at` is `Date.now()` — and no test in this repo can
produce that state, because the suite's clock is a monotone counter. ⚑ **A row nothing can kill is
not carrying its rule**, so it is recorded here as absent rather than written as a survivor.

⛔ **No row on the rail's `.section-add` styling.** A wrong hover colour is a cosmetic defect on a
surface whose other defects are placements a person did not choose.

## ⚠️ Two rows were re-anchored, and both were RE-RUN rather than merely re-matched

⚑ **`M8`** — the project door's `if` was reformatted onto one line when the fold moved to the top of
`startSessionInProfile` (see §2 of the response doc). ⛔ **A corrected anchor otherwise keeps a
verdict it never earned**, which is free to do and impossible to notice afterwards, so the row was
applied again and its killer run again.

⚑ **`M3` and `M26` SURVIVED the first pass**, and each moved a TEST rather than the row. `M3`: nothing
asserted the `project.slug` COLUMN holds the folded value — every fixture used a slug that was
already folded, so the two readings agreed everywhere. `M26`: nothing asserted the roster is
re-read after a create — the bridge was called and the sentence was absent, which is all the DOM
test looked at.
"""

ID = "apps/desktop/src/main/db/identity.ts"
STORE = "apps/desktop/src/main/db/session-store.ts"
HOST = "apps/desktop/src/main/runtime/runtime-host.ts"
WIRE = "apps/desktop/src/shared/runtime-ipc.ts"
IPC = "apps/desktop/src/main/runtime/ipc.ts"
MIGRATION = "apps/desktop/src/main/db/migrations/0020_lonely_speed_demon.sql"
RAIL = "apps/desktop/src/renderer/src/components/SideRail.vue"
# ⚑ **572 · where the rail's project list went** — `EXT-008` §1, *"counts, `+` buttons, lists
# and explanations go into Projects, Agents and Tools as PAGES"*.
BOARD = "apps/desktop/src/renderer/src/components/ProjectsBoard.vue"
SHEET = "apps/desktop/src/renderer/src/components/NewProject.vue"
DRAFT = "apps/desktop/src/renderer/src/lib/launch-draft.ts"
PROJECT_STORE = "apps/desktop/src/renderer/src/lib/project-store.ts"

MUTATIONS = [
    # ── §1 · the fold, in both derivations ────────────────────────────────────────────────────
    (
        # ⛔ **RETIRED BY RULING (landing D-016b, 5e931be8, the tree):** The subject is the project
        # id (`proj:<slug>`, folded through `foldProfileName`), and 5e931be8 removed projects on
        # purpose: "the project, proposal, binding, home and document tables go". `projectRowId` no
        # longer exists anywhere under apps/desktop/src and identity.ts has no project derivation
        # left, so there is no two-spellings-of-one-directory rule to re-anchor. Its anchor is left
        # stale, so the census records it retired.
        "M1 · 🔴 the project id stops folding · `Default` derives `proj:Default`, so two spellings "
        "of one directory become two project rows — 208 H1 one axis over",
        [
            (
                ID,
                "  return `proj${SEP}${foldProfileName(projectSlug)}`",
                "  return `proj${SEP}${projectSlug}`",
            )
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-016a commit 2, a5d66e92):** agentProfileRowId was deleted
        # with the binding code: a5d66e92 says 'Nothing writes agent_profile rows, agent_profile_id
        # or home_project_segment any more, and the profile binding code goes.' The fold rule the
        # row protected still has live rows: 376 M1 (projectRowId, proj:<folded>) and 369 M5
        # (aid:<folded slug> in agentIdentityRowId), both anchors still count 1. Its anchor is left
        # stale, so the census records it retired.
        "M2 · 🔴 the BINDING's project half stops folding · the foreign key still passes, and "
        "`agp:Other:explorer` lands beside `agp:other:explorer` — two bindings over one row",
        [
            (
                ID,
                "  return `agp${SEP}${foldProfileName(projectSlug)}${SEP}${foldProfileName(profileSlug)}`",
                "  return `agp${SEP}${projectSlug}${SEP}${foldProfileName(profileSlug)}`",
            )
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-016a, bd70d693):** The label is about the project column
        # keeping the caller's spelling instead of the folded slug, and the create-project path
        # (`createProject`, `projectSql`) was removed from `session-store.ts`. Nothing lets a person
        # or a model name a project now. Commit bd70d693: "create_project and list_projects, the
        # project rooms, board, sheet and picker ... are removed." Its anchor is left stale, so the
        # census records it retired.
        "M3 · ⛔ the COLUMN keeps the caller's spelling · `id` and `slug` can no longer be "
        "re-derived from each other, which is the invariant 238 bought for profiles",
        [
            (
                STORE,
                "      projectSql().insert.run(\n        projectRowId(slug),\n        slug,",
                "      projectSql().insert.run(\n        projectRowId(slug),\n        projectSlug,",
            )
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-016a, bd70d693):** The label is about the duplicate-slug
        # check in project creation, and `createProject` and its `TAKEN` check are gone from the
        # store. Only the built-in `'default'` project row remains, to number tasks and documents,
        # and nothing can create a second one. Commit bd70d693: "create_project and list_projects
        # ... are removed." Its anchor is left stale, so the census records it retired.
        "M4 · ⛔ the duplicate check reads the caller's spelling · `TAKEN` finds no row and a "
        "second project is created over one directory",
        [
            (
                STORE,
                "      if (projectSql().select.get(slug) !== undefined) return null",
                "      if (projectSql().select.get(projectSlug) !== undefined) return null",
            )
        ],
    ),
    # ── §2 · the placement ────────────────────────────────────────────────────────────────────
    (
        # ⛔ **RETIRED BY RULING (landing D-016a, bd70d693):** The label is about the session's
        # project being dropped on the way to the row, and `store.create` no longer takes or records
        # a project. A conversation's project attribution was removed, and commit 2 of D-016
        # replaces it with finding a conversation by its agent. Commit bd70d693: "Projects stop
        # being something a person or a model meets". Its anchor is left stale, so the census
        # records it retired.
        "M5 · 🔴 the session's project is dropped on the way to the row · every conversation is "
        "attributed to the pinned project with a menu on screen saying otherwise",
        [
            (
                STORE,
                "    const { bindingId: agentProfileId, identityId } = profileRowFor(\n      record.profileId,\n      at,\n      record.projectSlug,\n    )",
                "    const { bindingId: agentProfileId, identityId } = profileRowFor(\n      record.profileId,\n      at,\n    )",
            )
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-016a, bd70d693):** The label is about the launch's
        # project being dropped at the IPC boundary, and the launch input in `ipc.ts` and
        # `shared/runtime-ipc.ts` no longer carries a project field. The project picker that sent it
        # is gone from the launcher. Commit bd70d693: "the project rooms, board, sheet and picker
        # ... are removed." Its anchor is left stale, so the census records it retired.
        "M6 · 🔴 the launch's project is dropped at the boundary · the schema takes it, the "
        "launcher sends it, and the rebuilt input loses it — 102's dead Cancel, one field over",
        [
            (
                IPC,
                # ⚑ **716 · re-anchored in place, not retired** — `716` put the createSession call inside a `try` (`710` F-7's answered refusal), two spaces deeper.
                "            projectSlug: command.projectSlug,\n            reasoningEffort: command.reasoningEffort,",
                "            reasoningEffort: command.reasoningEffort,",
            )
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-016a, bd70d693):** The label is about reading a
        # conversation's folder from the pinned project instead of its own, and D-016a removed
        # project folders (`projectFolderFor`) from start-session. A conversation now starts in the
        # cwd it was given. Commit bd70d693: "project folders and their rails ... are removed." Its
        # anchor is left stale, so the census records it retired.
        "M7 · ⛔ the folder is read from the PINNED project · a conversation in a second project "
        "starts in another project's directory",
        [
            (
                HOST,
                # ⚠️ **RE-ANCHORED at 424, not retired.** `projectCwd` grew a caller —
                # `projectFolderFor`, which answers `undefined` for BroBot's own conversation
                # (HO-023 §3) — so the line reads through it now. ⚑ The DEFECT is unchanged and is
                # still measured on the identity this row's killer uses: a conversation in a second
                # project starting in the pinned project's directory.
                "    const cwd = this.deps.resolveCwd(id, input.cwd ?? this.projectFolderFor(profileId, projectSlug))",
                "    const cwd = this.deps.resolveCwd(id, input.cwd ?? this.projectFolderFor(profileId, DEFAULT_PROJECT_ID))",
            )
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-016a, bd70d693):** The label is about a nonexistent
        # project being admitted at start, and the `no-such-project` door was removed from
        # start-session together with the project argument. A start has no project to fail to find.
        # Commit bd70d693: "the project argument on spawn_agent and list_agents ... removed." Its
        # anchor is left stale, so the census records it retired.
        "M8 · 🔴 a project that does not exist is admitted · `store.create` fails inside `record`, "
        "which CATCHES — a live conversation with no row in the ledger, reported afterwards",
        [
            (
                HOST,
                "    if (input.projectSlug !== undefined && this.deps.store.project(projectSlug) === null) {",
                "    if (false) {",
            )
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-016a, bd70d693):** The label is about a spawn no longer
        # inheriting its parent's project, which fed 374's same-project rail. Both the inheritance
        # and the same-project rail are gone, so a child can no longer be placed outside its
        # parent's reach by project. Commit bd70d693: "same-project reach and the project argument
        # on spawn_agent and list_agents are removed." Its anchor is left stale, so the census
        # records it retired.
        "M9 · 🔴 a spawn stops inheriting its parent's project · a PM working in a second project "
        "creates a child in the pinned one and 374's rail then refuses it its own child",
        [
            (
                HOST,
                "        ...(projectSlug === undefined ? {} : { projectSlug }),",
                "",
            )
        ],
    ),
    # ── §3/§4 · the seed, and the mechanism that makes it a seed ──────────────────────────────
    (
        # ⛔ **RETIRED BY RULING (landing D-014, 010f9426):** The subject is the seeded grant, and
        # D-014 removed it on purpose (commit: "roles, the seeded grants ... are gone ... A new
        # identity row is all NULL"). ensureIdentityRow now writes no capability column, so there is
        # no seed left to re-apply. ⚠️ The RULE survives: a person can still narrow a grant, and a
        # restart must never overwrite it. That rule is carried by `558` `M21` (`INSERT OR REPLACE`),
        # which is live. D-014 deleted this table's §4 tests (*a narrowing survives a restart*).
        # Its anchor is left stale, so the census records it retired.
        "M10 · 🔴 the seed is RE-APPLIED on every launch · a narrowing a person made is silently "
        "restored by a restart, which is exactly what HO-016 §2 condition 2 forbids",
        [
            (
                STORE,
                "      ensureIdentityRow: db.prepare(\n        `INSERT OR IGNORE INTO agent_identity",
                "      ensureIdentityRow: db.prepare(\n        `INSERT INTO agent_identity",
            ),
            (
                STORE,
                # ⚠️ **Anchor corrected by `377`**, which added the `role` column to this same
                # `INSERT OR IGNORE` — the seed and the role ride one statement, by design. ⛔ The row
                # is unchanged: it still turns the seed into a re-seed on every launch.
                # ⚑ **RE-ANCHORED at 419, not retired**: `display_name` and `provider` became `?`s when the
                # creation door started writing them, so the `NULL` this line used to hold is gone.
                # The rule and the defect are unchanged.
                # ⚑ **RE-ANCHORED at `598`, not retired**: `HO-084` §1 added `created_by` to the
                # row this statement writes, so the placeholder list is one `?` longer. ⛔ The
                # defect is unchanged — the seed becomes a RE-seed on every launch.
                "         VALUES (?, ?, ?, ?, ?, ?, ?, ${CAPABILITY_COLUMNS.map(() => '?').join(', ')})`,",
                "         VALUES (?, ?, NULL, ?, ?, ?, ?, ${CAPABILITY_COLUMNS.map(() => '?').join(', ')})\n         ON CONFLICT(id) DO UPDATE SET can_message = excluded.can_message`,",
            ),
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-014, 010f9426):** SEEDED_GRANTS and seededGrantFor were
        # deleted (commit: "the seeded grants ... are gone"). canMessage's default is now 'any' for
        # every agent, so the defect "BroBot ships un-granted and cannot reach a PM" can no longer
        # happen: shipping with no seed is D-014's decision. Its anchor is left stale, so the census
        # records it retired.
        "M11 · ⛔ nothing is seeded at all · BroBot ships with the ruled `same-project` and cannot "
        "reach a PM in another project — HO-016 §2: shipping it un-granted is shipping it broken",
        [
            (
                WIRE,
                # ⚠️ **Anchor corrected by `409`**, which added `canSpawn` to the same entry — the
                # line this row has always pointed at, one field wider. ⛔ The row is unchanged: it
                # removes the whole grant, and what it measures is that the app insists on
                # something. ⚑ Correcting it is free; retiring it would have taken HO-016 §2's
                # first condition out of the table for an edit that never touched the rule.
                # ⚑ **RE-ANCHORED at 419 and again at 441, not retired**: the seed gained
                # `canCreateAgents` and then `canCreateProjects`. The defect is unchanged — nothing
                # is seeded at all. ⚠️ `441` also lifted its field's docblock OUT of this literal and
                # onto the `grant:` key above it, so this anchor stays four lines of CODE: an anchor
                # that spans prose goes stale every time somebody edits a sentence.
                # ⚑ **RE-ANCHORED at `553`, not retired**: the seed gained `canAssignWork` when
                # HO-060 §2.2 split assigning off messaging — *BroBot holds that grant by seed, so
                # its global role is untouched*. ⛔ The defect is unchanged and is now WIDER: with
                # the whole grant gone, BroBot can neither reach a PM in another project nor give
                # it work, which is HO-016 §2 and HO-060 §2.2 failing together.
                # ⚑ **RE-ANCHORED at `573`, not retired**: the seed gained `canStaff` when HO-068
                # §1.2 ruled that *an agent that may create an identity may start a conversation as
                # it*. ⛔ The defect is unchanged and is wider again — with the whole grant gone,
                # BroBot also cannot start the identities it creates, which is the run `573` was
                # dispatched on. ⚠️ **The anchor stays SIX lines of CODE**, for `441`'s stated
                # reason: `573` put its field's docblock on the `grant:` key rather than inside the
                # literal, so no prose was pulled into this match.
                # ⚑ **Re-anchored by `584`, not retired** (`HO-078` §1). ⛔ `canSpawn` LEFT this
                # grant — the list was also the identity roster `mintIdentity` walks — so the
                # object is five lines of code now. ⚠️ **The defect is unchanged and is wider
                # still**: with the whole grant gone BroBot cannot message, assign, staff, create
                # an agent or propose a project, on a fresh install, on the one identity it ships.
                "    grant: {\n"
                "      canMessage: 'any',\n"
                "      canAssignWork: 'any',\n"
                # ⚑ **RE-ANCHORED at `598`, not retired**: `HO-084` §1 narrowed the seeded
                # word from `any-this-app-does-not-seed` to `created-by-me`. ⛔ The defect
                # this row names is unchanged; only the value it quotes moved.
                "      canStaff: 'created-by-me',\n"
                "      canCreateAgents: 'any',\n"
                "      canCreateProjects: 'any',\n"
                "    },",
                "    grant: {},",
            )
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-014, 010f9426):** The seed lookup is gone
        # (SEEDED_GRANTS.find removed from runtime-ipc.ts). D-014 gives one default set to every
        # agent ("One default set for every agent, and no rule names an agent"), so "the same grants
        # on every identity" is now the product's rule, not a defect. Its anchor is left stale, so
        # the census records it retired.
        "M12 · ⛔ the seed is given to EVERY identity · a grant nobody asked for on every agent "
        "that has ever run, which is the opposite of a capability",
        [
            (
                WIRE,
                "  const folded = foldProfileName(profileSlug)\n  return SEEDED_GRANTS.find((seed) => seed.slug === folded)?.grant ?? null",
                "  return SEEDED_GRANTS[0]?.grant ?? null",
            )
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-014, 010f9426):** This row tested the fold inside
        # seededGrantFor, which D-014 deleted along with SEEDED_GRANTS. With no per-slug seed,
        # nobody can be "brought into being un-granted" because of how a slug is spelled. Its anchor
        # is left stale, so the census records it retired.
        "M13 · ⛔ the seed stops folding the slug · a launch recorded as `Default` — which a "
        "restore or a repair can still write — brings BroBot into being un-granted",
        [
            (
                WIRE,
                # ⚠️ **Anchor corrected by `377`**, which added `seededRoleFor` beside this
                # function — an identical fold line, so the bare one now matches twice. ⛔ The row is
                # unchanged: it is still about the GRANT's fold, and the `SEEDED_GRANTS` line below is
                # what pins which of the two it means.
                "  const folded = foldProfileName(profileSlug)\n  return SEEDED_GRANTS.find((seed) => seed.slug === folded)?.grant ?? null",
                "  const folded = profileSlug\n  return SEEDED_GRANTS.find((seed) => seed.slug === folded)?.grant ?? null",
            )
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-014, 010f9426):** seededColumns and the grant.canSpawn
        # write are gone. The commit says the can_spawn column stays "unread and unwritten" and a
        # new identity row is all NULL. Its anchor is left stale, so the census records it retired.
        "M14 · 🔴 the seed fills in EVERY capability column · today's defaults are frozen into "
        "BroBot's row, so `Use the default` on any field is a lie — `0017`'s refusal to backfill. "
        "⚠️ **RE-ANCHORED at 532** — `seededColumns` now composes BOTH seed tables, so `grant` "
        "stopped being nullable and the `?.` in this line went with it; the DEFECT is byte-for-byte "
        "what it was. ⛔ **And its KILLER moved without anybody noticing**: driving the row by hand "
        "at `532` found `a-second-project-and-the-grant.test.ts` green under it and four other "
        "files red, so the gate map above is corrected rather than left naming a file that no "
        "longer holds the assertion",
        [
            (
                STORE,
                "      canSpawn: grant.canSpawn === undefined ? null : JSON.stringify([...grant.canSpawn]),",
                "      canSpawn: JSON.stringify([...(grant.canSpawn ?? DEFAULT_CAPABILITIES.canSpawn)]),",
            )
        ],
    ),
    # ── §6 · the migration ────────────────────────────────────────────────────────────────────
    (
        # ⛔ **RETIRED BY RULING (landing D-016b, 5e931be8, the tree):** The subject is the
        # `can_message` backfill inside migration 0020, and 5e931be8 deleted every old migration:
        # "The database is ONE migration, 0000_the_tree, on a fresh file only". There is no upgrade
        # path left to overwrite a narrowed grant, and the tree's tests state there is no `0020` and
        # no upgrade path. Its anchor is left stale, so the census records it retired.
        "M15 · 🔴 the migration overwrites a NARROWED grant · an upgrade re-grants what a person "
        "took away, which is condition 2 broken through the upgrade instead of through a launch",
        [
            (
                MIGRATION,
                "UPDATE `agent_identity` SET `can_message` = 'any' WHERE `slug` = 'default' AND `can_message` IS NULL;",
                "UPDATE `agent_identity` SET `can_message` = 'any' WHERE `slug` = 'default';",
            )
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-016b, 5e931be8, the tree):** Same subject as M15, the
        # `UPDATE agent_identity SET can_message = 'any' ...` in migration 0020, one clause over.
        # That file is gone with all of 0001-0042; "Runs on a fresh database only. The old file is
        # refused untouched", so no upgrade can grant every identity global reach. Its anchor is
        # left stale, so the census records it retired.
        "M16 · ⛔ the migration grants EVERY identity · every agent in an upgraded database gets "
        "global reach, silently, with nobody able to see who decided it",
        [
            (
                MIGRATION,
                "UPDATE `agent_identity` SET `can_message` = 'any' WHERE `slug` = 'default' AND `can_message` IS NULL;",
                "UPDATE `agent_identity` SET `can_message` = 'any' WHERE `can_message` IS NULL;",
            )
        ],
    ),
    # ── §5 · list_agents ──────────────────────────────────────────────────────────────────────
    (
        # ⛔ **RETIRED BY RULING (landing D-016a, bd70d693):** The label is about
        # `list_agents(project)` ignoring its filter. D-016a removed the project argument from
        # `list_agents`, and `agentsVisibleTo` is now `listedFrom(conversationsVisibleTo(by, me))`
        # with no project filter to ignore. Commit bd70d693: "the project argument on spawn_agent
        # and list_agents ... removed." Its anchor is left stale, so the census records it retired.
        "M17 · ⛔ the project filter is ignored · `list_agents(project)` answers every agent the "
        "caller can see whatever it was asked, which is a disclosure claiming a narrowing",
        # ⚑ Landing D-017 (5206d835) · re-anchored in place, not retired — `list_agents`'s project
        # filter still must actually narrow the list, but the filtering code moved out of
        # agent-tools.ts and into `RuntimeHost.agentsVisibleTo` (`project === null ? reachable :
        # reachable.filter(...)`), which is now the one walk both `list_agents` and `list_projects`
        # share (D-017 · R12). Dropping the filter there reproduces the identical disclosure defect:
        # a project argument is silently ignored.
        [
            (HOST, '    return listedFrom(\n      project === null\n        ? reachable\n        : reachable.filter((one) => this.targetAsItWillRun(one.id)?.projectSlug === project),\n    )', '    return listedFrom(reachable)'),
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-016a, bd70d693):** The label is about an agent card
        # reporting the pinned project instead of the session's, and the card no longer has a
        # `project` field (`agent-roster` and the card shape dropped it). There is nothing to
        # mis-report. Commit bd70d693: "Projects stop being something a person or a model meets".
        # Its anchor is left stale, so the census records it retired.
        "M18 · ⛔ a card reports the PINNED project rather than the session's · every agent looks "
        "as though it works in `default`, and the filter then selects the wrong ones",
        [
            (
                HOST,
                "      project: identity?.projectSlug ?? null,",
                "      project: DEFAULT_PROJECT_ID,",
            )
        ],
    ),
    # ── the surfaces ──────────────────────────────────────────────────────────────────────────
    (
        # ⛔ **RETIRED BY RULING (landing D-016a, bd70d693):** The label plants a bug in
        # ProjectsBoard.vue, which the commit deleted. No board draws projects any more. Commit
        # bd70d693: "the project rooms, board, sheet and picker ... are removed." Its anchor is left
        # stale, so the census records it retired.
        "M19 · ⛔ the board draws only the FIRST project · a person who created a second one cannot "
        "see it, and the count beside the heading says two",
        # ⚑ **Re-anchored by 452.** The real project row became two controls — the row press still
        # opens the sheet and a sibling arrow opens the workspace — so a button cannot be the
        # repeated element any more and the `v-for` moved onto the box around them. Same defect,
        # same line, one element out. Verified RED alone after the correction.
        # ⚑ **Re-anchored AGAIN by 572**, and it is a MOVE rather than a rewrite: `EXT-008` §1 took
        # the list out of the navigation column, so the `v-for` is `ProjectsBoard`'s. Same defect,
        # same sentence, one surface over. Verified RED alone after the correction.
        [
            (
                BOARD,
                '<li v-for="row in view.rows" :key="row.project.id" class="row-wrap">',
                '<li v-for="row in view.rows.slice(0, 1)" :key="row.project.id" class="row-wrap">',
            )
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-016a, bd70d693):** The label is about the rail's projects
        # section saying 'No projects yet' over an empty roster, and SideRail.vue no longer has a
        # projects section at all. The companion DOM test a-second-project.dom.test.ts was deleted
        # with it. Commit bd70d693: "the project rooms, board, sheet and picker ... are removed."
        # Its anchor is left stale, so the census records it retired.
        "M20 · 🔴 an empty roster empties the SECTION · a cold window says *No projects yet* over a "
        "database that has one — 086's absence nobody established, on the app's first screen",
        [
            (
                RAIL,
                "const realProjectRows = computed<readonly ProjectDetails[]>(() =>\n  props.realProjects.length > 0 ? props.realProjects : props.project ? [props.project] : [],\n)",
                "const realProjectRows = computed<readonly ProjectDetails[]>(() => props.realProjects)",
            )
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-016a, bd70d693):** The label is about a project row
        # opening the first project's sheet, and both ProjectsBoard.vue and the project sheet were
        # deleted. There is no row to click and no sheet to open. Commit bd70d693: "the project
        # rooms, board, sheet and picker ... are removed." Its anchor is left stale, so the census
        # records it retired.
        "M21 · ⛔ a row opens the FIRST project's sheet whatever was clicked · every project on the "
        "board edits the pinned one. ⚑ **Re-anchored at `572`** — `EXT-008` §1 moved the list and "
        "the gesture out of the rail; the sheet is now a NAMED button on the row rather than the "
        "row press, which is the half `452` reported as an open product question and this "
        "dispatch answered by giving both doors a word",
        [
            (
                BOARD,
                "              @click=\"emit('settings', row.slug)\"",
                "              @click=\"emit('settings', view.rows[0]!.slug)\"",
            )
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-016a, bd70d693):** The label is about the create sheet
        # sending what was typed instead of the folded slug, and NewProject.vue was deleted.
        # Creating a project is no longer something a person can do. Commit bd70d693:
        # "create_project and list_projects, the project rooms, board, sheet and picker ... are
        # removed." Its anchor is left stale, so the census records it retired.
        "M22 · 🔴 the create sheet sends what was TYPED rather than what will be stored · a person "
        "creates `Ticket-1` and the rail then shows a project they cannot find",
        [
            (
                SHEET,
                "  createRefusal.value = await store.create(folded.value, edit())",
                "  createRefusal.value = await store.create(slug.value.trim(), edit())",
            )
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-016a, bd70d693):** The label is about the create sheet
        # not refusing a taken slug before the press, and NewProject.vue was deleted with the
        # creation flow. No surface checks slugs any more. Commit bd70d693: "create_project and
        # list_projects, the project rooms, board, sheet and picker ... are removed." Its anchor is
        # left stale, so the census records it retired.
        "M23 · ⛔ a taken slug is not refused before the press · the refusal still arrives from the "
        "store, but the button was lit over a name this surface already knew was taken",
        [
            (
                SHEET,
                "  if (store.projects.value.some((project) => project.slug === folded.value)) {\n    return `There is already a project called ${folded.value}.`\n  }",
                "",
            )
        ],
    ),
    (
        "M24 · ⛔ the project a launcher was left on is not part of the draft · leaving the "
        "launcher and coming back sends the right prompt to the wrong project — 210 finding 1",
        [
            (
                DRAFT,
                "    projectChoice: DEFAULT_PROJECT_ID,",
                "    projectChoice: 'a-project-nobody-chose',",
            )
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-016a, bd70d693):** The label is about the one
        # `store.create` call site no longer naming a project, and it is now correct that it does
        # not: the call passes id, provider, cwd, approvalMode and profileId and no project.
        # Criterion 6 (a conversation attributed to its project) was removed with projects, and
        # commit 2 of D-016 replaces it with finding a conversation by its agent. Commit bd70d693:
        # "Projects stop being something a person or a model meets". Its anchor is left stale, so
        # the census records it retired.
        "M25 · 🔴 criterion 6 is unreachable again · the one `store.create` call site stops naming "
        "a project, and 374's §4 census — re-pointed by this dispatch — says so",
        [
            (
                HOST,
                "            projectSlug,\n            // Recorded like the mode and the profile,",
                "            // Recorded like the mode and the profile,",
            )
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-016a, bd70d693):** The label is about the roster not
        # being refreshed after a project create, and `renderer/src/lib/project-store.ts` was
        # deleted. Projects have no roster or create step in the renderer. Commit bd70d693: "the
        # project rooms, board, sheet and picker ... are removed." Its anchor is left stale, so the
        # census records it retired.
        "M26 · ⛔ the roster is not refreshed after a create · the sheet closes on success and the "
        "rail keeps the list it had, so a project a person just made is not there",
        [
            (
                PROJECT_STORE,
                # ⚑ ANCHOR CORRECTED IN PLACE BY 427 — `save` gained the same re-read
            # (it was missing, and `StartAsAgent` was lying about a folder because of
            # it), so this text now appears twice; the tail pins it to `create`.
            "        await readAll()\n        return null\n      } catch (error) {\n        return readableError(error)\n      }\n    },\n\n    async save(projectSlug, edit) {",
                "        return null\n      } catch (error) {\n        return readableError(error)\n      }\n    },\n\n    async save(projectSlug, edit) {",
            )
        ],
    ),
]
