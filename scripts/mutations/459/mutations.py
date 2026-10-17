"""459 · the project a spawn lands in — HO-027 §2.

⛔ **What this table is aimed at.** `459` did three things and each is a rule a mutation can delete
without breaking a type:

 1. **The live-session rail keys on parent + identity + PROJECT** (HO-027 §2.1). `428` keyed it to
    parent + identity and the PO withdrew that trade themselves — *"BroBot is the same parent for
    every project, so it can hold one live `project-manager` ever."*
 2. **A parent may place a child in a project it created, or one it is itself in. Nowhere else**
    (HO-027 §2.2) — a NARROWING of `HO-010` ruling 6, carried by the `not-your-project` rail.
 3. **`spawn_agent` may say which project**, and the default did not move: absent still inherits.

⚠️ **The provenance is DERIVED and has no column**, so the rows below aim at the derivation: the
`approved` clause, the `SHAPE_CREATES` clause and the folding are each one edit away from a rule that
still compiles and still passes its own happy path.

⛔ **Evidence this table is honest about what it can reach.** Every row was applied alone, its own
killer run, and the tree restored from bytes and hashed — the whole table has NOT been run under the
driver, so `CENSUS.md` records it `unrun` and no verdict is claimed here.
"""

RAILS = "apps/desktop/src/main/runtime/spawn-rails.ts"
HOST = "apps/desktop/src/main/runtime/runtime-host.ts"
TOOLS = "apps/desktop/src/main/runtime/agent-tools.ts"

# ⚑ The three-way key, as one line, so a row can take exactly one third of it away.
# ⚑ **RE-ANCHORED at `681`, not retired** — PM ruling R30a reads the blocker's project off its
# reservation until its row exists (`targetAsItWillRun`), so the first line is spelled through that
# reader. ⛔ M1's DEFECT is unchanged: the project clause goes. Re-applied and re-run after it.
THE_KEY = "          const its = this.targetAsItWillRun(slot.id)?.projectSlug ?? null\n          return its === null || projectSlug === null || its === projectSlug"

# ⚑ The placement test, whole.
MAY_PLACE = (
    "    const mayPlace =\n"
    "      (inProject !== null && named === foldProfileName(inProject)) ||\n"
    "      facts.projectsCreatedBy(parent.sessionId).includes(named)"
)

MUTATIONS: list[tuple[str, list[tuple[str, str, str]]]] = [
    # ── §1 · the third key ──────────────────────────────────────────────────────────────────────
    (
        # ⛔ **RETIRED BY RULING (landing D-016a, bd70d693):** D-016 removed the project third key on
        # purpose: `liveChildAs` is now `(parentSessionId, profileSlug)` and the anchor
        # (`targetAsItWillRun(...).projectSlug` clause) is gone from runtime-host.ts. The
        # spawn-rails.ts comment says '`459` added the project as a third key and it went with
        # projects', and `the-project-a-spawn-lands-in.test.ts` says the same. The label's defect, a
        # key without the project clause, is now the design. Its anchor is left stale, so the census
        # records it retired.
        "M1 · 🔴 THE DEFECT HO-027 §2 NAMES, restored · the project clause goes and the key is "
        "`428`'s again, so one BroBot may hold ONE live `project-manager` ever — the cap the PO "
        "corrected their own rail to remove",
        [(HOST, THE_KEY, "          return true")],
    ),
    (
        # ⚑ **RELABELLED at `681`, not retired** — PM ruling R30a gave a starting blocker its
        # project, so the arm this row opens is no longer the blocker's: it is the REQUESTER's, a
        # parent in no project that names none. ⛔ The anchor and the replacement are unchanged;
        # what they plant is described truly now, and its killer moved to the test that plants
        # that parent. Re-verified RED alone against it.
        # ⛔ **RETIRED BY RULING (landing D-016a, bd70d693):** The unknown-project arm (`its === null
        # || projectSlug === null || its === projectSlug`) was deleted with projects. There is no
        # placement to be null, and `liveChildAs` takes no project. The parent-plus-identity half of
        # the rail survives, but it is pinned by the 428 and D-017 tables and by
        # `a-starting-child-is-already-in-its-project.test.ts` §4, not by this row's defect. Its
        # anchor is left stale, so the census records it retired.
        "M2 · ⚠️ the unknown-project arm FAILS OPEN · a parent in NO project that names none hands "
        "the key a `null` placement, and it no longer blocks — so that parent holds a second live "
        "conversation of one identity · killed by `a-starting-child-is-already-in-its-project.test.ts`",
        # ⚑ Landing D-017 (5206d835) · re-anchored in place, not retired — The live/held-slot arm's
        # project check is still exactly this shape, but D-017 R15 added a second, structurally
        # identical `return its === null || projectSlug === null || its === projectSlug` line for
        # the stopped-child arm, so the old single-line anchor now matches twice and the row
        # darkened on that account, not because the rule moved. Anchoring on the held arm's own
        # `const its = this.targetAsItWillRun(slot.id)...` line restores uniqueness and keeps the
        # row's actual subject (the LIVE slot check, not the stopped-child one).
        [
            (HOST, '          const its = this.targetAsItWillRun(slot.id)?.projectSlug ?? null\n          return its === null || projectSlug === null || its === projectSlug', '          const its = this.targetAsItWillRun(slot.id)?.projectSlug ?? null\n          return its !== null && projectSlug !== null && its === projectSlug'),
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-016a, bd70d693):** The row swaps the project argument of
        # `facts.liveChildAs(parent.sessionId, asked.profileId, projectSlug)`. Today's call is
        # `facts.liveChildAs(parent.sessionId, asked.profileId)`, and neither `projectSlug` nor
        # `inProject` exists in spawn-rails.ts (D-016 diff: `-const alreadyLive =
        # facts.liveChildAs(..., projectSlug)`). A key that reads the wrong project has no meaning
        # once there are no projects. Its anchor is left stale, so the census records it retired.
        "M3 · ⚠️ the key reads the PARENT's project instead of the child's · identical for every "
        "spawn that names none, and wrong for exactly the calls this dispatch added — two children "
        "of one identity in two projects both pass, and two in ONE project also pass",
        [(RAILS, "facts.liveChildAs(parent.sessionId, asked.profileId, projectSlug)",
          "facts.liveChildAs(parent.sessionId, asked.profileId, inProject)")],
    ),
    # ── §2 · the placement rail ─────────────────────────────────────────────────────────────────
    (
        # ⛔ **RETIRED BY RULING (landing D-016a, bd70d693):** The `not-your-project` rail is deleted
        # whole: `mayPlace`, `inProject` and `facts.projectOf` no longer exist, and the D-016 diff
        # removes the rail code, its refusal-table entries and `projectsCreatedBy` from SpawnFacts.
        # The commit message lists 'the project argument on spawn_agent'. The prohibition on placing
        # a child in another project has no subject when nothing is placed in a project. Its anchor
        # is left stale, so the census records it retired.
        "M4 · 🔴 THE PROHIBITION HO-010 ruling 6 EXISTS FOR, deleted · the rail never refuses, so an "
        "agent may put a child in any project it can name — including one a person made and one it "
        "has never heard of",
        [(RAILS, "    if (!mayPlace) {", "    if (false) {")],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-016a, bd70d693):** The `mayPlace` test, its 'created' arm
        # and `facts.projectsCreatedBy` were deleted with `create_project` and proposals (D-016
        # diff: `-readonly projectsCreatedBy`, `-const mayPlace = ...`). Card item 1 removes the
        # project rails and the proposals end to end. The 'BroBot cannot staff the project it made'
        # refusal has no path to arrive through. Its anchor is left stale, so the census records it
        # retired.
        "M5 · ⚠️ only the project the parent is IN · the created arm goes, so BroBot making a second "
        "project and being unable to staff it is the refusal the person met, arriving through the new door",
        [(RAILS, MAY_PLACE,
          "    const mayPlace = inProject !== null && named === foldProfileName(inProject)")],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-016a, bd70d693):** The own-project arm of `mayPlace` is
        # gone with the whole placement rail and `spawn_agent`'s `project` argument. The
        # default-project destination is no longer nameable by design.
        # `the-project-a-spawn-lands-in.test.ts` states 'D-016 deleted projects, and with them the
        # argument, the placement, `not-your-project`'. Its anchor is left stale, so the census
        # records it retired.
        "M6 · ⚠️ only the projects the parent CREATED · the own-project arm goes, so a parent may "
        "not place a child beside itself — the default's own destination becomes unnameable",
        [(RAILS, MAY_PLACE,
          "    const mayPlace = facts.projectsCreatedBy(parent.sessionId).includes(named)")],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-016a, bd70d693):** `const named =
        # foldProfileName(asked.project)` is gone. `spawnRequestSchema` has no `project` key, and
        # spawn-rails.ts no longer imports `foldProfileName` (D-016 diff: `-import { foldProfileName
        # } ...`). Folding the case of a project name has no subject. Its anchor is left stale, so
        # the census records it retired.
        "M7 · ⛔ the comparison stops folding · `Alpha` and `alpha` are one project everywhere else "
        "in this app — `projectRowId` folds and `agent_profile_project_slug_uq` collates NOCASE — so "
        "a parent is refused its own project spelled in another case",
        [(RAILS, "    const named = foldProfileName(asked.project)", "    const named = asked.project")],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-016a, bd70d693):** The row plants an existence oracle in
        # the `not-your-project` rail, and that rail and `facts.projectOf` are deleted (grep of src
        # finds no `not-your-project`, `mayPlace` or `projectOf`). The general rule 'entitlement
        # before existence' lives in 341's own rows, which anchor elsewhere. This row's clause no
        # longer exists in any form. Its anchor is left stale, so the census records it retired.
        "M8 · 🔴 the rail asks the PROJECT TABLE · `not-your-project` becomes an existence oracle: a "
        "caller learns which projects are real by spelling names at a door it is refused at, which "
        "is `341`'s *entitlement before existence* deleted",
        [(RAILS, "    if (!mayPlace) {\n",
          "    if (!mayPlace && facts.projectOf(named) !== null) {\n")],
    ),
    # ── §3 · the derivation that replaces a column ──────────────────────────────────────────────
    (
        # ⛔ **RETIRED BY RULING (landing D-016a, bd70d693):** Proposals go 'end to end' (commit
        # message), and `proposalsOf`, `projectsCreatedBy`, the `approved` clause and
        # `SHAPE_CREATES` are removed from runtime-host.ts (D-016 diff lines `-projectsCreatedBy:
        # (sessionId) => ... proposal.state === 'approved' && ...`). Placement derived from an
        # approved proposal has no subject. Criterion 21's approval gate went with proposal cards.
        # Its anchor is left stale, so the census records it retired.
        "M9 · 🔴 a proposal nobody approved places a child · the `approved` clause goes, so an agent "
        "places into a project it merely PROPOSED — criterion 21's gate is his approval, and this "
        "row is that gate routed around by the placement rule instead of by the creation one",
        [(HOST, "              proposal.state === 'approved' && SHAPE_CREATES[proposal.shape] === 'a project',",
          "              SHAPE_CREATES[proposal.shape] === 'a project',")],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-016a, bd70d693):** The `SHAPE_CREATES[proposal.shape] ===
        # 'a project'` clause and the constant were deleted with proposals, and the `standing-agent`
        # shape has no proposal path. The commit message says 'Proposals go end to end'. Nothing
        # counts a slug as a created project now. Its anchor is left stale, so the census records it
        # retired.
        "M10 · ⚠️ a `standing-agent` name places a child · the `SHAPE_CREATES` clause goes, so an "
        "approved AGENT slug counts as a project this parent created — criterion 28's shape, which "
        "creates no project at all, becomes a placement",
        [(HOST, "              proposal.state === 'approved' && SHAPE_CREATES[proposal.shape] === 'a project',",
          "              proposal.state === 'approved',")],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-016a, bd70d693):** `.map((proposal) =>
        # foldProfileName(proposal.slug))` sat in the deleted `projectsCreatedBy` derivation, which
        # is not in runtime-host.ts any more. Its only source was `proposalsOf`, and proposals are
        # gone (D-016). The slug-folding divergence has no code to live in. Its anchor is left
        # stale, so the census records it retired.
        "M11 · ⛔ the created list stops folding · a project proposed as `Beta` is stored `beta`, so "
        "the slug the ledger carries and the slug the rail compares come apart and a parent is "
        "refused the project it just made",
        [(HOST, "          .map((proposal) => foldProfileName(proposal.slug)),",
          "          .map((proposal) => proposal.slug),")],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-016a, bd70d693):** The `projectsCreatedBy: (sessionId) =>
        # this.deps.store.proposalsOf(sessionId)` fact is deleted from the SpawnFacts wiring along
        # with `SessionStore.proposalsOf` use. There are no per-conversation created-project claims
        # to leak between conversations. Its anchor is left stale, so the census records it retired.
        "M12 · ⚠️ the created list is read from ANOTHER conversation · `me` becomes the parent's "
        "child, so a conversation inherits a placement claim it never made — the per-identity "
        "widening the rail deliberately did not take",
        [(HOST, "      projectsCreatedBy: (sessionId) =>\n        this.deps.store\n          .proposalsOf(sessionId)",
          "      projectsCreatedBy: (_sessionId) =>\n        this.deps.store\n          .proposalsOf('sess_1')")],
    ),
    # ── §4 · the default, and the argument ──────────────────────────────────────────────────────
    (
        # ⛔ **RETIRED BY RULING (landing D-016a, bd70d693):** `let projectSlug: string | null =
        # inProject` is gone. `admitSpawn` has no project resolution, and the tools note says 'there
        # is no `project` argument, because there are no projects'. The 'absent means the parent's'
        # default has no subject. Its anchor is left stale, so the census records it retired.
        "M13 · 🔴 the default INVERTS · an absent `project` stops meaning *the parent's* and starts "
        "meaning *the pinned one*, so every spawn that exists today lands in `default` — `376`'s "
        "defect restored, and the one the person's PM actually hit",
        [(RAILS, "  let projectSlug: string | null = inProject", "  let projectSlug: string | null = null")],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-016a, bd70d693):** `const projectSlug =
        # admitted.projectSlug ?? undefined` was removed in `spawnSession` (D-016 diff `-const
        # projectSlug = admitted.projectSlug ?? undefined`), so the admitted token carries no
        # placement. The 'token versus row' double read is impossible when nothing is placed. The
        # card says every provider home lives under `default`. Its anchor is left stale, so the
        # census records it retired.
        "M14 · ⚠️ the token stops carrying the placement · `spawnSession` falls back to the row "
        "again, so the project the rail CHECKED and the project the launch USES are two reads and "
        "may differ for exactly the calls this dispatch added",
        [(HOST, "    const projectSlug = admitted.projectSlug ?? undefined",
          "    const projectSlug = this.deps.store.identityOf(admitted.parentSessionId)?.projectSlug")],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-016a, bd70d693):** The `project: z.string()...optional()`
        # line in the spawn request schema is deleted on purpose (commit message: 'the project
        # argument on spawn_agent ... removed'). The schema is now `.strict()` with no `project`
        # key, and agent-tools.ts also stops advertising it. The label's defect, advertised but
        # refused, is now the intended state, since neither door mentions it. Its anchor is left
        # stale, so the census records it retired.
        "M15 · ⛔ the argument is advertised and the door does not take it · `371`'s disclosure "
        "defect, reintroduced from the other side — a documented key that is refused, which is "
        "criterion 9's shape and not criterion 10's",
        [(RAILS, "    project: z.string().refine(isPathSegment, `must be ${PATH_SEGMENT_RULE}`).optional(),", "")],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-016a, bd70d693):** The `project: 'project'` entry in
        # agent-tools.ts was deleted in D-016 (diff `-  project: 'project',`), together with the
        # argument's advertisement. Not advertising a key the door does not accept is now correct.
        # The 'accepted but not advertised' defect cannot be planted because the door accepts
        # nothing named `project`. Its anchor is left stale, so the census records it retired.
        "M16 · ⚠️ the tool stops advertising it · the door accepts `project` and no caller is told, "
        "so the capability exists and is undiscoverable — the half of `371`'s rule that is about "
        "what a model can find out",
        [(TOOLS, "  project: 'project',", "")],
    ),
    # ── §5 · the rail's own row ─────────────────────────────────────────────────────────────────
    (
        # ⛔ **RETIRED BY RULING (landing D-016a, bd70d693):** The `'not-your-project': 'permanent'`
        # entry was removed from the refusal-permanence table (D-016 diff `-  'not-your-project':
        # 'permanent',`), as was the rail id itself. Only stale comments in
        # a-refusal-carries-its-remedy.test.ts still mention it. There is no permanence mapping left
        # to mislabel. Its anchor is left stale, so the census records it retired.
        "M17 · ⚠️ the permanence says a person can fix it · there is no grant anywhere in this app "
        "that widens placement, so `until-a-person-changes-it` sends a caller to ask for something "
        "nobody can give — `366`'s measured lie, at a second door",
        [(RAILS, "  'not-your-project': 'permanent',", "  'not-your-project': 'until-a-person-changes-it',")],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-016a, bd70d693):** The `not-your-project` sentence ('This
        # tells you nothing about whether the project you named exists.') was deleted with the rail,
        # and no such string remains in spawn-rails.ts. A refusal about a project name has no
        # subject once projects are not something a caller meets. Its anchor is left stale, so the
        # census records it retired.
        "M18 · ⛔ the sentence claims the project does not exist · indistinguishable from the honest "
        "one under an equality test, and false about every project that is really there — the "
        "reason §5 pins the clause by name as well as comparing the pair",
        [
            # ⚠️ **RE-ANCHORED at 675, not retired.** The sentence was reordered so its act fits the 200-character row a person reads (675 §1); The DEFECT this row plants is unchanged.
            (
                RAILS,
                "        'This tells you nothing about whether the project you named exists.'",
                "        'There is no project by that name here.'",
            ),
        ],
    ),
]
