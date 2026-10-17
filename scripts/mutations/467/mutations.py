"""467 · the roster a window can read — HO-024 criterion 22's other half.

⛔ **What this table is aimed at.** `467` made two facts readable by a window that had never been
able to read them, and every rule it added is one a mutation can delete without breaking a type:

 1. **Which conversations this app PLACED in a project** — the crossing `452` F1 asked for, built
    on the BINDING rather than on any ledger-keyed candidate set. ⚑ `M1` is the defect restored:
    the roster narrowed to conversations that were given work, which under-reports exactly the
    quiet ones and reads as *"nothing is running in this project"* — `452` §5.1's forbidden
    sentence, arrived at by a query plan rather than by a filter.
 2. **What `[]` MEANS** — three empties, three words (`M2`, `M12`), and the FOLD that decides which
    one a person is looking at (`M3`: a capital turns *this project's list* into *there is no such
    project*).
 3. **What only the host can know** — `M4` and `M5` are the two ways the row's `running` and the
    walk's `rowsUnread` stop being measurements and become restatements of something already on
    the row.
 4. **One derivation of *what work is this conversation holding*** — `M9`/`M10`/`M11`. ⚠️ `452` F7
    found `openWorkOf` cited by a docblock and absent from the repo; it exists now, and these rows
    are the three ways a second copy of the predicate comes back.

⚠️ **Two rows are aimed at a SENTENCE and they earn their place.** `M7` and `M8` are `role`'s two
failure modes — not selected at all, and selected without its fold — and the second is the one that
would hand a surface a word this app cannot spell, which `370` ruled against by name.

⛔ **Evidence this table is honest about what it can reach.** Every row was applied alone, its own
killer file run, and the tree restored from bytes and hashed — the whole table has NOT been run
under the driver, so `CENSUS.md` records it `unrun` and no verdict is claimed here.
"""

STORE = "apps/desktop/src/main/db/session-store.ts"
HOST = "apps/desktop/src/main/runtime/runtime-host.ts"
IPC = "apps/desktop/src/main/runtime/ipc.ts"
WIRE = "apps/desktop/src/shared/runtime-ipc.ts"
THE_WHOLE_FOREST = "apps/desktop/src/shared/the-whole-forest.ts"

# ⚑ The statement's tail, whole, so a row can narrow the candidate set without touching its joins.
THE_CANDIDATE_SET = (
    "      WHERE proj.slug = ?\n"
    "      ORDER BY provider_session.created_at, provider_session.id`,"
)

# ⚑ The existence question, as its own block — the thing that makes a third empty sayable.
THE_EXISTENCE_CHECK = (
    "      if (readProject(slug) === null) {\n"
    "        return { rows: [], walk: 'no-such-project', ledgers: 0, rowsUnread: 0 }\n"
    "      }\n"
)

# ⚑ The host's carry-through, anchored past the three siblings that spell the same two lines.
THE_CARRY_THROUGH = (
    "      rowsUnread: walked.rowsUnread,\n"
    "      // ⛔ **Every field spelled out** — `a-spread-writes-past-a-declared-type`: a spread into an"
)

MUTATIONS: list[tuple[str, list[tuple[str, str, str]]]] = [
    # ── §1 · the candidate set, which is the whole crossing ─────────────────────────────────────
    (
        "M1 · 🔴 THE DEFECT, restored · the roster is narrowed to conversations that were GIVEN "
        "WORK — `selectTaskedSessionsInProject`'s question wearing this one's name. ⛔ A "
        "conversation nobody has given work to, and one with nothing waiting on anybody, drop off "
        "the list, which is `452` §5.1's *nothing is running in this project* produced by a query "
        "plan instead of by a guess ⚑ ANCHOR CORRECTED IN PLACE BY 504",
        # ⚑ Landing D-016a (bd70d693) · re-anchored in place, not retired — The defect is a reader
        # that narrows its list to conversations that were given work, so a conversation nobody has
        # tasked, or one with nothing waiting, drops off. The project roster is gone, but its
        # successor, `selectEveryPlacedConversation` behind `theWholeForest`, carries the same rule:
        # every placed conversation is drawn. The plant adds the EXISTS filter to that SELECT.
        [
            (STORE, '      ORDER BY provider_session.updated_at DESC, provider_session.id DESC\n      LIMIT ?', "      WHERE EXISTS (SELECT 1 FROM events e\n                     WHERE e.session_id = provider_session.id\n                       AND e.type = 'task_assigned')\n      ORDER BY provider_session.updated_at DESC, provider_session.id DESC\n      LIMIT ?"),
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-016a, bd70d693):** The row's subject is the `project`
        # existence question in `projectToWalk`, which no longer exists. Commit bd70d693
        # 'refactor(D-016): projects and proposals go' says 'Projects stop being something a person
        # or a model meets: create_project and list_projects, the project rooms, board, sheet and
        # picker ... are removed', and the 'default' project row stays only to number tasks. Nothing
        # says 'this project has no conversations' any more, so no empty is left to collapse. Its
        # anchor is left stale, so the census records it retired.
        "M2 · ⛔ the third empty collapses into the second · the existence question goes, so a slug "
        "no `project` row spells is answered *this project has no conversations* — a claim about a "
        "project this app does not have, said in the register reserved for one it does" 
        "⚑ ANCHOR CORRECTED IN PLACE BY 466·relay-1: the digest read needed this same question "
        "and reused this word for it, so the check moved into `projectToWalk` and is asked once "
        "for both readers. Same defect, same killer, one call further in",
        [(STORE, "    return readProject(folded) === null ? null : folded\n", "    return folded\n")],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-016a, bd70d693):** The row planted a missing slug fold in
        # `projectToWalk`, the shared existence and fold check for the project roster and the
        # digest. D-016 deleted the roster and made 'the digest one window over every conversation
        # an agent holds', so `projectToWalk` and the slug argument are gone. The commit says 'the
        # project argument on spawn_agent and list_agents are removed'. Its anchor is left stale, so
        # the census records it retired.
        "M3 · ⚠️ the slug is not FOLDED · `digestWindow`'s rule dropped and `tasksIn`'s defect "
        "inherited — `'Default'` finds no `project` row, so the surface a person is looking at is "
        "told there is no such project. ⛔ The worst empty of the three, reached by a capital letter" 
        "⚑ ANCHOR CORRECTED IN PLACE BY 466·relay-1: the fold moved into `projectToWalk`, which "
        "the digest reader now shares. ⛔ The site is `438 M17`'s as well — that row defends the "
        "digest's reading of it and this one the roster's, and one line answering to both is why "
        "it was worth extracting",
        [(STORE, "    const folded = foldProfileName(projectSlug)\n", "    const folded = projectSlug\n")],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-016a, bd70d693):** The row defended the roster's
        # creation-order `ORDER BY created_at, id`, which a project's list grew in and a cursor sat
        # in. That list was removed with projects ('the project rooms, board, sheet and picker ...
        # are removed'). Its successor, the forest, orders `updated_at DESC, id DESC` on purpose,
        # and table 637 M4 already plants that. Its anchor is left stale, so the census records it
        # retired.
        "M13 · ⚠️ the order becomes the id's · creation order is what a project GREW in and what a "
        "person's cursor sits in; ordering by anything else re-sorts the list under them "
        "⚑ ANCHOR CORRECTED IN PLACE BY 504",
        [(STORE, "      ORDER BY provider_session.created_at, provider_session.id`,",
          "      ORDER BY provider_session.id DESC`,")],
    ),
    (
        "M14 · ⛔ the tie-break goes · two rows stamped in one millisecond is what a real clock "
        "produces, and without a second key the order of those two is SQLite's to choose — a list "
        "that can shuffle between two reads of a database nobody wrote to "
        "⚑ ANCHOR CORRECTED IN PLACE BY 504",
        # ⚑ Landing D-016a (bd70d693) · re-anchored in place, not retired (a second reviewer refuted
        # its retirement) — The tie-break moved to `selectEveryPlacedConversation`
        # (session-store.ts:6242), which is now `ORDER BY updated_at DESC, id DESC LIMIT ?`; the
        # plant drops only the `id DESC` key. The killer exists: 'the `id DESC` tiebreak decides
        # ties, and a clock with ms resolution makes them' stamps sess_aaa, sess_bbb and sess_ccc
        # with one `updated_at` and expects ['sess_ccc','sess_bbb'] twice. There is no index on
        # `updated_at`, so tied rows should come back in scan (insertion) order,
        # ['sess_aaa','sess_bbb'], and that test should go red on its first `toEqual`. I have not
        # run it.
        [
            (STORE, 'provider_session.updated_at DESC, provider_session.id DESC', 'provider_session.updated_at DESC'),
        ],
    ),
    # ── §2 · the columns, and the folds that keep each one honest ───────────────────────────────
    (
        "M6 · 🔴 identity comes off `provider_session.profile_id` · the DIRECTORY name, which keeps "
        "the caller's spelling verbatim, in place of the binding's folded slug. ⛔ Every identity "
        "somebody typed with a capital joins to nothing in `agentIdentities`, so the roster draws a "
        "name for some rows and a slug for others ⚑ ANCHOR CORRECTED IN PLACE BY 504",
        # ⚑ Landing D-016a commit 2 (a5d66e92) · re-anchored in place, not retired — The rule
        # survives: the forest names a conversation by its identity (the folded slug), not by the
        # exact spelling it ran under. The plant reads provider_session.profile_id instead of
        # identity.slug. Killed by `the-whole-forest.test.ts`.
        [
            (STORE, '    `SELECT provider_session.id AS id, identity.slug AS profile_slug,', '    `SELECT provider_session.id AS id, provider_session.profile_id AS profile_slug,'),
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-014, 010f9426):** Roles were removed on purpose. The
        # commit says 'roles, the seeded grants, role templates and the staffing carve-out are gone.
        # The role, can_spawn, ... columns stay in the schema, unread and unwritten'. Its anchor is
        # left stale, so the census records it retired.
        "M7 · 🔴 `role` is not selected · `423`'s finding, put back: the column exists, two writers "
        "fill it, a person picks it in the create sheet — and the record that comes back carries "
        "`undefined`, so every identity reads *nobody has said*",
        [(STORE,
          "  const IDENTITY_COLUMNS = `id, slug, display_name, role, provider, created_at,",
          "  const IDENTITY_COLUMNS = `id, slug, display_name, provider, created_at,")],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-014, 010f9426):** D-014 deleted parseAgentRole and
        # AgentRole together with roles, and the record has no `role` field any more. The column is
        # 'unread and unwritten', so no fold is left to cast around. Its anchor is left stale, so
        # the census records it retired.
        "M8 · ⛔ `role` is cast instead of FOLDED · `370`'s narrow direction deleted — a word this "
        "app cannot spell reaches a surface as a role, and a hand-edited database can promote an "
        "identity to project manager by typing one",
        [(STORE, "      role: parseAgentRole(row.role),",
          "      role: row.role as AgentRole | null,")],
    ),
    # ── §3 · what only the host knows, and what only the walk knows ─────────────────────────────
    (
        "M4 · 🔴 `running` is derived from the COLUMN · `421`'s measurement undone: "
        "`settleOrphanRuns` settles a crashed run to `idle`, so this reads *unwatched* for a "
        "conversation a power cut ended three weeks ago and *not-running* for one this window is "
        "holding open",
        # ⚑ **543 · ANCHOR CORRECTED IN PLACE, not retired — it went AMBIGUOUS rather than
        # absent.** `543`'s relationship read publishes the same word on a child row, more deeply
        # indented, so the old eight-space anchor became a SUBSTRING of the new code and the
        # harness's first-occurrence replace would have mutated the roster while the census counted
        # it as measured — `534` F2 exactly, arriving a second time. ⛔ The anchor now carries the
        # `509` comment that only the ROSTER's publisher has beneath it, which is unique; the
        # SUBJECT — *`running` derived from the column rather than from the slot map* — is
        # unchanged, and the row was re-verified RED by hand.
        # ⚑ Landing D-016a (bd70d693) · re-anchored in place, not retired — Rule 421 survives:
        # `running` must be the slot map's answer (`runningStateOf`), never derived from the
        # `status` column, because `settleOrphanRuns` settles a crashed run to `idle`. Only the
        # surface moved: the roster row in `conversationsInProject` is gone and the same field is
        # now built in `theWholeForest()` in runtime-host.ts. The forest test pins it.
        [
            (HOST, '            : {\n                ...row,\n                running: this.runningStateOf(row.conversation),\n', "            : {\n                ...row,\n                running: row.status === 'idle' ? 'unwatched' : 'not-running',\n"),
        ],
    ),
    (
        "M5 · ⛔ the host states the partial load as ZERO · the walk's own count replaced by a "
        "literal, which is the disclosure `453` built turned back into the silence `150` "
        "backlogged — the work beside a conversation is short and nothing says by how much",
        # ⚑ Landing D-017 (3d295083) · re-anchored in place, not retired — D-017 inserted
        # `...ledgersSkippedOf(walked.ledgersSkipped)` between `rowsUnread: walked.rowsUnread` and
        # the 'every field spelled out' comment, but conversationsInProject still carries the
        # store's own `rowsUnread` straight through per 453's rule. Hardcoding it to 0 still
        # restates a measurement as a literal, exactly the defect
        # the-roster-a-window-can-read.test.ts's carry-through test targets.
        # ⚑ Landing D-016a (bd70d693) · re-anchored in place, not retired — The disclosure rule
        # survives. The host must carry the walk's own `rowsUnread` count and never state a partial
        # load as zero. `conversationsInProject` is gone, but `theWholeForest()` still carries
        # `rowsUnread: walked.rowsUnread`, and the R18 five-counts census in
        # what-main-hands-the-cards.test.ts reads `host.theWholeForest().nodes.rowsUnread`.
        [
            (HOST, '        rowsUnread: walked.rowsUnread,\n        ...ledgersSkippedOf(walked.ledgersSkipped),\n        // 🔴 **The fact the database cannot hold**', '        rowsUnread: 0,\n        ...ledgersSkippedOf(walked.ledgersSkipped),\n        // 🔴 **The fact the database cannot hold**'),
        ],
    ),
    (
        # ⚑ Landing D-016a (bd70d693) · killer:
        # `a-torn-reply-in-a-holders-own-ledger-is-counted-by-the-forest.test.ts` (the landing added
        # it; no existing test observed this plant).
        "M11 · ⚠️ the skip counter is not threaded · the fold reads the ledger without a counter, "
        "so an unparseable row is skipped exactly as it has been since `150` and `rowsUnread` is "
        "zero for a roster whose work is missing a task",
        # ⚑ Landing D-016a (bd70d693) · re-anchored in place, not retired (a second reviewer refuted
        # its retirement) — The rule survives in `everyPlacedConversation`, the forest fold that
        # succeeded the roster. Its per-holder fold hands `tasksOfSession` the walk's noteSkip
        # (session-store.ts:10439), and the plant drops it. I expect NO existing case to go red. The
        # only torn-row cases (one-task-one-reading 'one unparseable assignment elsewhere' and the
        # what-main-hands-the-cards R18 five-counts) tear a `task_assigned`, which the open holder's
        # wait read also counts through `selectSessionsAssignedBy` under the same (ledger, ordinal)
        # key, and the torn `user_input_request` case is never selected by the task fold. A killer
        # needs a torn `task_replied` (or `task_withdrawn`) at a late ordinal in an open holder's
        # own ledg
        # ⚑ Landing D-016b (5e931be8, the tree) · re-anchored in place, not retired — The rule
        # survives: the forest hands each drawn conversation's piece fold the walk's skip counter,
        # so an unreadable row is skipped AND counted in nodes.rowsUnread. The site is
        # everyPlacedConversation's per-owner fold, piecesOfSession(sessionId, noteSkip), and the
        # plant drops the counter so the fold skips silently as before. The killer file was added by
        # the landing for exactly this plant. Killed by
        # `a-torn-reply-in-a-holders-own-ledger-is-counted-by-the-forest.test.ts`.
        [
            (STORE, '            ...composeWhatEachPieceIsWaitingOn(piecesOfSession(sessionId, noteSkip), waiting).map(', '            ...composeWhatEachPieceIsWaitingOn(piecesOfSession(sessionId), waiting).map('),
        ],
    ),
    # ── §4 · one derivation of what a conversation is holding ───────────────────────────────────
    (
        "M9 · ⛔ the store spells the predicate by hand · a second reading of *open*, free to "
        "disagree with the one a person's queue draws. ⚠️ **It is `TASK_IS_OPEN` today and a "
        "`withdrawn` row away from not being**, which is why the killer is a SOURCE census: the two "
        "readings agree on every world this suite builds, and the day they stop agreeing the "
        "divergence is already shipped",
        # ⚑ Landing D-016a (bd70d693) · re-anchored in place, not retired — D-016 removed the
        # per-project roster fold but kept the rule that the store must spell 'open work' through
        # `openWorkOf`, the one predicate. The store's remaining call is the wait read's `aWorker`
        # in `whatThisConversationIsWaitingOn`. The commit re-aimed the census in
        # `the-roster-a-window-can-read.test.ts` §5 at that call, so the source-census defect (a
        # hand-written second predicate) now plants there.
        # ⚑ Landing D-016b (5e931be8, the tree) · re-anchored in place, not retired — The rule
        # survives: the store spells no hand-written second reading of 'open work'; the roster test
        # section 5 censuses the store source for a TASK_IS_OPEN filter followed by a non-parent
        # map. The store's old aWorker call went with D-016 (the test comment says so), so the plant
        # re-aims at the store's remaining open filter, openPiecesOf, and adds an identity-copy map
        # after it. The reading is unchanged, as this row's label expects, and the source census is
        # what goes red. Killed by `the-roster-a-window-can-read.test.ts`.
        [
            (STORE, '      return piecesOfSession(owner, unread?.in(owner)).filter((piece) => TASK_IS_OPEN[piece.state])', '      return piecesOfSession(owner, unread?.in(owner))\n        .filter((piece) => TASK_IS_OPEN[piece.state])\n        .map((piece) => ({ ...piece }))'),
        ],
    ),
    (
        "M10 · ⛔ the HOST grows its copy back · the two-step filter `434` wrote and `467` replaced, "
        "returned to the queue's reader — the same class as `M9` from the other end, and the shape "
        "`452` F7 found a docblock already claiming was shared",
        # ⚑ **474 put the `tasksOf` read behind `oneTaskReadPerAnswer`**, so two folds share one
        # ledger read. ⛔ The predicate is still spelled once and this row still grows the second
        # copy back — corrected in place, not retired.
        # ⚑ Landing D-016b (5e931be8, the tree) · re-anchored in place, not retired — The rule
        # survives: the host derives 'what work is this conversation holding' through openWorkOf and
        # does not grow a hand-written filter and map back. The site is now the memoised reader that
        # composes the root label with openWorkOf(pieces(id)), and the plant replaces the call with
        # the two-step TASK_IS_OPEN filter and a label map, which behaves the same but is the copy
        # the census hunts. Killed by `the-roster-a-window-can-read.test.ts`.
        [
            (HOST, '      const open = [...(root === null ? [] : [{ label: root.label }]), ...openWorkOf(pieces(id))]', '      const open = [\n        ...(root === null ? [] : [{ label: root.label }]),\n        ...pieces(id)\n          .filter((one) => TASK_IS_OPEN[one.state])\n          .map((one) => ({ label: one.label })),\n      ]'),
        ],
    ),
    # ── §5 · the register, the door, and the shape ──────────────────────────────────────────────
    (
        "M12 · 🔴 a store with no database claims it WALKED · `no-ledger` replaced by the ordinary "
        "word, which is the exact defect `453` exists for — *this project has no conversations* "
        "drawn out of *I have no database*",
        # ⚑ Landing D-016a (bd70d693) · re-anchored in place, not retired — The 'no database is not
        # an empty answer' rule survives D-016. The project reader's NULL entry is gone, but the
        # NULL store's `everyPlacedConversation` still answers `no-ledger`. The plant gives it the
        # walk's ordinary word, which is the same defect (a store with no database claims it
        # walked).
        [
            (STORE, "  everyPlacedConversation: () => ({ rows: [], walk: 'no-ledger', ledgers: 0, rowsUnread: 0 }),", "  everyPlacedConversation: () => ({\n    rows: [],\n    walk: 'every-conversation-this-app-placed',\n    ledgers: 0,\n    rowsUnread: 0,\n  }),"),
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-016a, bd70d693):** The row planted an optional `by?:
        # Caller` parameter on `conversationsInProject`, which is gone. The 'takes no Caller' census
        # lived in the roster test, which D-016 deleted (the commit says 'tests whose subject was a
        # deleted feature are deleted'). Its anchor is left stale, so the census records it retired.
        "M15 · ⚠️ a person's reader grows a caller · the entitlement axis `449` ruled against, "
        "arriving as an optional parameter — harmless today and the seam through which a window's "
        "list becomes shaped by what some identity may message",
        [(HOST, "  conversationsInProject(projectSlug: string): LedgerWalk<ProjectConversation> {",
          "  conversationsInProject(\n"
          "    projectSlug: string,\n"
          "    by?: Caller,\n"
          "  ): LedgerWalk<ProjectConversation> {\n"
          "    void by")],
    ),
    (
        # ⚑ Landing D-016a (bd70d693) · killer:
        # `a-conversation-row-in-the-forest-has-no-name-of-its-own.test.ts` (the landing added it;
        # no existing test observed this plant).
        "M16 · ⛔ the row carries its own display name · a second answer to *what is this identity "
        "called*, beside `agentName` — which is `449`'s measured defect exactly: one identity under "
        "its name in one list and under its slug in another",
        # ⚑ Landing D-016a (bd70d693) · re-anchored in place, not retired (a second reviewer refuted
        # its retirement) — The rule holds and moved: the conversation-list row is now
        # `ForestConversation` (the-whole-forest.ts:165-166). It carries the binding's folded slug
        # as `identity` and no display name, so `agentName` stays the one naming function.
        # `ProjectConversation` was deleted by bd70d693 together with its census
        # (`expect(row).not.toContain('displayName')` in the-roster-a-window-can-read.test.ts). The
        # plant is a type-only field, so no runtime test can see it and the row will SURVIVE today;
        # vitest does not typecheck the missing field. A kill needs a source census in
        # the-whole-forest.test.ts, which already reads FOREST_SRC, that extracts the
        # `ForestConversation` body, asserts `identity: string` is present an
        [
            (THE_WHOLE_FOREST, '  readonly identity: string\n  readonly provider: Provider', '  readonly identity: string\n  readonly displayName: string | null\n  readonly provider: Provider'),
        ],
    ),
    (
        "M17 · ⚠️ the quit door answers it · a store read — one lookup, one statement and a task "
        "fold per conversation — admitted into a quit, for a window that is going away and rows "
        "that are all durable",
        # ⚑ Landing D-016a (bd70d693) · re-anchored in place, not retired — The rule that a store
        # read must be refused once a quit has begun survives. The roster's command is gone, but its
        # successor `theWholeForest` (a store walk over every conversation) sits in the same
        # quit-door map as `'refused'`. The generic killer in shutdown-door.test.ts covers every
        # command of that map. No other mutation table flips this entry.
        [
            (IPC, "  theWholeForest: 'refused',", "  theWholeForest: 'answered',"),
        ],
    ),
]
