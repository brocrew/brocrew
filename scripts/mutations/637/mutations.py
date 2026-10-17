"""637 · The whole forest, from the person down.

⚑ **the person's ask, ordered directly:** *"we see the user at the top, followed by all brobot
conversations right after, and each brobot converation with its own children etc.. each of them
represent a task or converation."*

## 🔴 A · what was already built, and what the measurement changed

⚠️ **Rule 38, and it narrowed the work in one place and widened it in another.**

| the brief's ask | the answer |
|---|---|
| *"the existing read is PER-CONVERSATION"* | ⚑ **true of the SPAWN GRAPH and of nothing else.** `whoCalledWhom` takes one `sessionId`; every SQL read of `parent_session_id` is anchored on one id. |
| §1's *"`useWhoCalledWhom` holds a `CastReading`"* | ⛔ **the brief cited the wrong file.** `CastReading` is a RENDERER box; the host's shape is `WhoCalledWhom` and `SpawnEdge`/`WorkEdge` live in `shared/who-called-whom.ts`. |
| §3's *"`621`'s per-conversation read of all three waits"* | 🔴 **it is POPULATION-WIDE already** — `whatEachConversationIsWaitingOn` takes no arguments at all, and so does `575`'s `whatIsBeingDone`. |
| §3's *"`632`'s child `doing` state"* | ⛔ **`632` added no vocabulary.** It is a RENDERER wiring dispatch that made the cast band the THIRD caller of `whatAPlateCanDraw`. |
| §3's *"five states, not two"* | ⚠️ **eight.** `TASK_STATES` holds eight members, six of them open; `deriveTasks` writes five and the three `waiting-on-*` are composed a layer up. |

⛔ **So the forest carries the EDGES and the durable node facts, and folds in neither doing nor
waiting** — both already have a population-wide door, and a second reader of one fact is `HO-095`
§4's *never two sources of truth*. ⚑ `M13` is the ONE live fact that survives the subtraction.

## ⛔ B · the bound, and why it is a truncation rather than a refusal

🔴 **The population is not what the brief expected.** ⚠️ the person's own machine holds **2,027**
conversations (`session-library.ts:217`) and almost none of them are this app's: they were swept out
of his own `~/.claude` and `~/.codex`, they carry `agent_profile_id IS NULL`, and the forest excludes
them by a JOIN and DISCLOSES the count — `438`'s number, read rather than recomputed.

⛔ **`read-bundle.ts`' discipline is *"Nothing is silently truncated"* and this honours it the
LIBRARY's way.** ⚑ A bundle past its bound is refused whole because half a bundle is not a bundle; a
forest past `MAX_FOREST_CONVERSATIONS` is the newest 500 of it, with the population counted beside
the walk. 🔴 **Standing rule 8.4 is why**: a person with six hundred conversations would meet a wall
they could never clear, and *"the LIMIT is the finding rather than the test."*

⚠️ **And the tree stays a tree.** A drawn conversation whose parent fell past the bound reads
`a-conversation-this-reading-did-not-draw`, which is a WORD rather than an id pointing at nothing —
`M5`, `M6`.

## ⚠️ C · what has NO row, said rather than left out

⛔ **No row on `readAt` being stamped LAST.** ⚑ Every statement between the first read and the stamp
is synchronous, so moving the stamp up changes no value any test can observe — it would be a row
whose replacement is still true (`a-true-mutation-measures-nothing`). ⚠️ The property is held by the
docblock and by the absence of an `await`, which `the-whole-forest.test.ts` §6 asserts through the
dispatcher instead.

⛔ **No row on the `GENERATION_JOIN` this SELECT does not have.** ⚑ Adding one would change nothing:
every column it returns is on `provider_session` itself, and the ledger fold asks
`activeGeneration` for itself. ⚠️ `a-line-no-mutation-can-kill-is-not-carrying-its-rule`, recognised
before it was written.

🔴 **`M15`'s only killer is a CENSUS, and that is stated rather than hidden.** ⛔ The reply site's
announcement is not driven by a fixture — driving it needs a child mid-turn with an open task — so
what goes red is §5's count of `theWorldMoved('conversations')` occurrences. ⚑ A census kill is a
weaker verdict than a behavioural one and it is the honest one available here; `M14` drives the
SAME decision's sibling through the host and a real `runtime:changed`, so the pair is not
census-only.

🔴 **TWO rows SURVIVED their first run and both were defects in the INSTRUMENT.** ⛔ `M7` mutated
one of the two joins and the other still excluded the row — the rule is enforced twice, so a row
against half of it changes nothing. ⛔ `M9` compared two counts in fixtures that all sat UNDER the
bound, where the two are equal by construction — `a-comparison-tested-where-both-sides-agree-measures-nothing`,
at a number. ⚑ **Both are recorded rather than repaired quietly**, because the second one is also
how this dispatch got its cost measurement: the fixture that kills `M9` is the one that crosses the
bound.

🔴 **NO ROW ON THE LIVE-UPDATE HALF, AND IT USED TO HAVE THREE.** ⛔ `M14`, `M15` and `M17` pinned
four `runtime:changed` announcements this dispatch added on the `conversations` subject, in answer
to the person's *"the live update of the ui is important"*. ⚠️ **`638` is the dispatch that owns that
question and it had already landed** — a THIRD subject, `work`, at THIRTEEN sites, measured over
all 22 ledger-append sites. ⚑ **Its shape is better**: a window that draws work re-reads on `work`
alone rather than on every conversation-lifecycle event. 🔴 **Two mechanisms for one fact is
`HO-095` §4**, so `637` backed its own four sites out rather than arriving beside them, and the row
numbers keep their gap.

⛔ **No row removing a `turn`'s effect on a task.** ⚑ Neither dispatch announces on a turn ending —
*"one re-read per provider event is not a channel, it is a storm"* — and a row against `deriveTasks`
would be `379`'s table and not this one.
"""

from __future__ import annotations

STORE = "apps/desktop/src/main/db/session-store.ts"
HOST = "apps/desktop/src/main/runtime/runtime-host.ts"

THE_PERSON_ARM = "  if (parent === null) return { is: 'the-person' }"
UNDER_RETURN = "  return drawn.has(parent)"
THE_TRIPLE = (
    "          row.parent_session_id === null || row.spawned_at === null || "
    "row.spawn_reason === null"
)
THE_ORDER = (
    "      ORDER BY provider_session.updated_at DESC, provider_session.id DESC\n      LIMIT ?`,"
)
THE_DRAWN_SET = "      const drawn = new Set(placed.map((row) => row.id))"
THE_JOIN = (
    "       FROM provider_session\n"
    "       JOIN agent_profile binding ON binding.id = provider_session.agent_profile_id\n"
    "       JOIN project proj ON proj.id = binding.project_id\n"
    "      ORDER BY provider_session.updated_at DESC"
)
THE_IDENTITY = "              identity: row.profile_slug,\n              projectSlug: row.project_slug,"
# ⛔ **BOTH joins, and the first draft mutated only the binding one and SURVIVED.** ⚑ The exclusion
# is enforced TWICE — a row with no binding has no `project_id` either, so the project join drops it
# even after the binding join has admitted it. ⚠️ Either join alone suffices on today's data, which
# is why a row against one of them is a mutation that changes nothing
# (`a-true-mutation-measures-nothing`); the RULE is the pair, so the row is the pair.
THE_JOIN_LEFT = THE_JOIN.replace("       JOIN agent_profile", "       LEFT JOIN agent_profile").replace(
    "       JOIN project proj", "       LEFT JOIN project proj"
)
TASK_UNDER = "            under: { is: 'a-conversation' as const, conversation: row.id },"
TASK_IDENTITY = "            work: workEdge(task, row.profile_slug),"
# ⚠️ **RE-ANCHORED at 711, not retired.** `711` adds the kept-open fact to each conversation node
# (`701` F-1), so prettier splits the one-line ternary; the anchor is its conversation arm now. The
# DEFECT M13 plants is unchanged: `running` a constant.
THE_RUNNING = (
    "            : {\n"
    "                ...row,\n"
    "                running: this.runningStateOf(row.conversation),\n"
)
# ⚑ **F098 · re-anchored in place, not retired** — the count leaves archived conversations out, as the walk does; the plant still derives it from the walk.
THE_POPULATION = "      conversations: this.deps.store.placedConversations(archived),"
THE_EXCLUDED = "      outsideEveryProject: this.deps.store.conversationsInNoProject(),"
# ⛔ **Two methods now end with the announcement and a brace**, so this row carries the DOCBLOCK
# that follows it — `a-sibling-read-makes-its-neighbours-anchors-ambiguous`, avoided at the point
# the second site was written rather than discovered by the gate.
REPLY_ANNOUNCES = (
    "    this.theWorldMoved('conversations')\n"
    "    const delivered = await this.deliverReply(task, input, documentId, session)"
)

MUTATIONS: list[tuple[str, list[tuple[str, str, str]]]] = [
    # ── A · the person is a KIND, which is §3.1's whole ruling ─────────────────────────────────
    (
        "M1 · 🔴 **the person stops being a root** · a conversation nothing spawned reads as one "
        "whose parent this reading did not reach. ⛔ **§4 criterion 2 is what breaks**: *the person "
        "is a NAMED root kind, not a null*. ⚠️ **The graph would have no top at all** — every "
        "conversation the person opened himself would draw as an orphan waiting for a parent that is "
        "never coming, which is the exact guess `a-value-beside-a-word-or-a-union-of-arms` exists "
        "to stop a renderer having to make",
        [
            (
                STORE,
                THE_PERSON_ARM,
                "  if (parent === null)\n"
                "    return { is: 'a-conversation-this-reading-did-not-draw', conversation: '' }",
            )
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-016b, 5e931be8, the tree):** The subject was removed on
        # purpose: the commit message says 'spawn_agent is gone' and 'the project, proposal,
        # binding, home and document tables go'. The spawn triple (`parent_session_id`,
        # `spawned_at`, `spawn_reason`) no longer exists: `spawned_at` and `spawn_reason` are not in
        # `0000_the_tree` or schema.ts, and `spawnProvenance` became `parentOf`, which reads
        # `parent_session_id` alone. With no triple there is no half-written spawn edge to draw or
        # refuse, so the rule 'all three columns or none' has no subject. Its anchor is left stale,
        # so the census records it retired.
        "M2 · ⛔ **a HALF-WRITTEN spawn becomes a spawn** · the triple stops being read as a "
        "triple and the parent column alone decides. ⚠️ **`spawnProvenance`'s rule is *all three "
        "columns or none*** and `spawnedBy` applies it at the other end, so this app would draw an "
        "edge it REFUSES TO NAME on the breadcrumb two files over — two readers of one edge "
        "disagreeing about whether it exists. ⚑ Reachable through a hand-edited database or a "
        "restored bundle, which is the population the rails cannot make and the fixture plants "
        "with an UPDATE",
        [(STORE, THE_TRIPLE, "          row.parent_session_id === null")],
    ),
    # ── B · the bound, and the word it needs ───────────────────────────────────────────────────
    (
        "M3 · 🔴 **the bound goes** · the SELECT takes every placed conversation there is. "
        "⛔ **§4 criterion 4 is what breaks** — *a bound, with what happens past it SAID* — and the "
        "cost is not the rows: it is one LEDGER FOLD PER ROW, which is `conversationsInProject`'s "
        "price paid across every project at once. ⚠️ **A workspace with a year in it would hand a "
        "window every conversation it has ever held**, and the sentence a person reads would still "
        "say 500",
        # ⛔ **The parameter is KEPT and multiplied, and the first draft removed `LIMIT ?` whole.**
        # ⚠️ That mutant declared zero parameters, was handed one, and better-sqlite3 threw
        # *"Too many parameter values were provided"* before a single row was read — so what went
        # red was an ARITY error and not one assertion about truncation
        # (`one-failure-is-not-the-failure-shape`). ⚑ `? * 1000000` keeps the arity and removes the
        # bound, which is the fact the row is about.
        [
            (
                STORE,
                THE_ORDER,
                "      ORDER BY provider_session.updated_at DESC, provider_session.id DESC\n"
                "      LIMIT ? * 1000000`,",
            )
        ],
    ),
    (
        "M4 · ⚠️ **the bound keeps the LEAST RECENTLY ACTIVE instead of the most** · `DESC` "
        "becomes `ASC`. "
        "⛔ **The order is what DECIDES WHAT IS DROPPED here**, which is why this read's order is a "
        "rule and its neighbour's is a presentation. ⚑ A person past the bound would open the Team "
        "graph and see the first five hundred conversations they ever had, and none of today's — "
        "the failure that looks like a working feature",
        [
            (
                STORE,
                THE_ORDER,
                "      ORDER BY provider_session.updated_at ASC, provider_session.id ASC\n"
                "      LIMIT ?`,",
            )
        ],
    ),
    (
        "M5 · ⛔ **every parent reads as one this reading did not draw** · the drawn set is built "
        "empty. ⚠️ **The tree would flatten**: every spawned conversation becomes a root with a "
        "marker, and the shape the person asked for — *each brobot conversation with its own children* "
        "— would have no children in it at all. 🔴 A failure that DRAWS SOMETHING, which is why "
        "the control for the third arm is a test of its own rather than a paragraph",
        [(STORE, THE_DRAWN_SET, "      const drawn = new Set<string>()")],
    ),
    (
        "M6 · 🔴 **a parent past the bound reads as one that is drawn** · the set is stopped "
        "being consulted. ⛔ **The renderer is then handed an id that is not in `nodes`**, and "
        "every reader of this shape has to write the same missing-parent check — "
        "`an-unenumerated-state-counts-as-success` with a tree drawn on it. ⚠️ Distinct from `M5`: "
        "that one draws no edges, this one draws edges to nothing",
        [(STORE, UNDER_RETURN, "  return drawn.has(parent) || true")],
    ),
    # ── C · what the forest is ABOUT, and what it discloses ────────────────────────────────────
    (
        "M7 · ⛔ **the never-placed population walks into the forest** · both joins become "
        "LEFT ones. ⚠️ **On the person's own machine that is 2,027 conversations** swept out of his "
        "own `~/.claude` and `~/.codex` — every one of them would hang under the person, and the "
        "graph he asked for would be his entire Claude history rather than BroBot's work. "
        "🔴 **And they cannot be NAMED**: `agent_profile_id IS NULL` has no slug, so `agentName` "
        "would be handed the one input `449` forbids it. ⚑ **BOTH joins, because either one alone "
        "still excludes** — the first draft mutated the binding join and SURVIVED, which is the "
        "rule being enforced twice rather than the rule being absent",
        # ⚑ Landing D-016a (bd70d693) · re-anchored in place, not retired — The rule (never-placed
        # conversations stay out of the forest) survives, but D-016 removed the `JOIN project proj`
        # and its select columns, so the forest candidate set now has ONE inner join on the binding,
        # and that single join is the whole rule. Re-anchored on it with the ORDER BY/LIMIT tail so
        # it does not match `countPlacedConversations`' similar join.
        # ⚑ Landing D-016a commit 2 (a5d66e92) · re-anchored in place, not retired — The rule
        # survives: a conversation this app never placed is in NO forest and the count says how
        # many. It is now one join (the old label said "both joins"), and the plant turns that INNER
        # JOIN into LEFT. Killed by `the-whole-forest.test.ts`.
        [
            (STORE, '       FROM provider_session\n       JOIN agent_identity identity ON identity.id = provider_session.agent_identity_id\n      ORDER BY provider_session.updated_at DESC, provider_session.id DESC\n      LIMIT ?`,', '       FROM provider_session\n       LEFT JOIN agent_identity identity ON identity.id = provider_session.agent_identity_id\n      ORDER BY provider_session.updated_at DESC, provider_session.id DESC\n      LIMIT ?`,'),
        ],
    ),
    (
        "M8 · ⚠️ **the exclusion stops being disclosed** · the count of conversations outside every "
        "project is reported as zero. ⛔ **`HO-024` §5.3 applied to a READ**: an omission nobody "
        "counts is indistinguishable from nothing having happened, and this is the single biggest "
        "omission this app makes about its own workspace",
        # ⚑ Landing D-016a (bd70d693) · re-anchored in place, not retired — The disclosure survives,
        # renamed: `outsideEveryProject`/`conversationsInNoProject` became
        # `heldByNoAgent`/`conversationsHeldByNoAgent` (bd70d693 host diff). The forest's site has a
        # twin in `digest()`, so the anchor carries the following `LAST.` comment line to stay
        # unique. The label's words 'outside every project' are now stale and should be corrected in
        # a `#` comment, not relabelled, so the recorded run is not orphaned.
        [
            (HOST, '      heldByNoAgent: this.deps.store.conversationsHeldByNoAgent(),\n      // ⛔ **LAST.**', '      heldByNoAgent: 0,\n      // ⛔ **LAST.**'),
        ],
    ),
    (
        "M9 · 🔴 **how many there ARE becomes how many were DRAWN** · the population count is "
        "derived from the walk. ⛔ **`conversationsInProject`'s rule is what breaks** — *the party "
        "that WALKED is the only one that can say what it walked* — and `rows.length` answers "
        "*what was found* to a question that asked *what was read*. ⚑ **Past the bound the two "
        "numbers are exactly what differ**, so this mutation makes the forest report itself as "
        "complete however short it is. 🔴 **It SURVIVED its first run** — every fixture sat under "
        "the bound, where the two numbers agree — which is "
        "`a-comparison-tested-where-both-sides-agree-measures-nothing` arriving at a count. "
        "⚠️ The killer is now a fixture that CROSSES the bound, which is also this dispatch's cost "
        "measurement",
        [(HOST, THE_POPULATION, "      conversations: walked.ledgers,")],
    ),
    # ── D · a node is a conversation or a task ─────────────────────────────────────────────────
    (
        "M10 · ⛔ **a task hangs off the conversation that GAVE it** · `under` names the giver. "
        "⚠️ **The narrow arm stops being sound**: the fold is scoped to the HOLDER's ledger, so "
        "the giver may be a conversation this reading never drew — and a task would then hang off "
        "a node that is not in `nodes`, which is the one thing `ForestTask.under`'s type promises "
        "cannot happen. ⚑ The giver is a FIELD for exactly this reason (`WorkEdge.from`)",
        [
            (
                STORE,
                TASK_UNDER,
                "            under: { is: 'a-conversation' as const, conversation: task.assignedBy },",
            )
        ],
    ),
    (
        "M11 · ⚠️ **the work stops naming the identity holding it** · `toIdentity` goes null. "
        "⛔ **Null on that field means *this app has no binding for that conversation***, and here "
        "it would be a lie: the row was selected THROUGH that binding. ⚑ `workThisOneWasGiven`'s "
        "rule is that the recipient's identity is read where the binding lives, which is exactly "
        "this line",
        # ⚑ Landing D-016b (5e931be8, the tree) · re-anchored in place, not retired — The rule
        # survives: a forest task node's `work.toIdentity` is the identity of the conversation that
        # holds the piece, read where the identity lives. The line is now `work: workEdge(piece,
        # row.profile_slug, identityOfGiver(piece.giver)),` (D-016 gave `workEdge` a piece and both
        # identities). The plant passes `null` for the recipient's identity. Killed by
        # `the-whole-forest.test.ts`.
        [
            (STORE, '                work: workEdge(piece, row.profile_slug, identityOfGiver(piece.giver)),', '                work: workEdge(piece, null, identityOfGiver(piece.giver)),'),
        ],
    ),
    (
        "M12 · ⛔ **the identity becomes the caller's spelling instead of the binding's** · the "
        "folded slug is replaced by the project's. ⚠️ **`agentName` joins on the FOLDED slug**, so "
        "a graph built on anything else names nobody — and this is the very defect `637` found one "
        "reading over, where `ConversationAtWork.identity` carries the launcher's raw spelling and "
        "its docblock claimed the two lists join. 🔴 The claim is corrected there; this row is what "
        "stops the same mistake being made here",
        # ⚑ Landing D-016a (bd70d693) · re-anchored in place, not retired — The rule survives: a
        # forest node's `identity` must be the binding's folded slug, because `agentName` joins on
        # it. D-016 dropped `project_slug` from the forest row, so the old plant would only yield
        # `undefined`. The label's headline defect (the caller's raw spelling,
        # `provider_session.profile_id`) is still plantable in the SELECT alias, which is exactly
        # what the test at the-whole-forest.test.ts:267 measures with a 'Dev' directory bound to
        # slug 'dev'.
        # ⚑ Landing D-016a commit 2 (a5d66e92) · re-anchored in place, not retired — The rule
        # survives: the forest row's profile_slug is the identity's folded slug. The plant on the
        # same SELECT as 467:M6 reads the raw profile_id spelling. Killed by
        # `the-whole-forest.test.ts`.
        [
            (STORE, 'SELECT provider_session.id AS id, identity.slug AS profile_slug,', 'SELECT provider_session.id AS id, provider_session.profile_id AS profile_slug,'),
        ],
    ),
    # ── E · the one live fact ──────────────────────────────────────────────────────────────────
    #
    # ⛔ **This section HELD the live-update rows and they are backed out.** ⚑ `638` owns that
    # question and landed a THIRD change subject — `work`, at thirteen sites — where this table had
    # four on `conversations`. ⚠️ Two mechanisms for one fact is `HO-095` §4, so `M14`, `M15` and
    # `M17` are gone and the numbering keeps its gap rather than closing it
    # (`a-number-can-survive-the-death-of-its-derivation`, applied to a row id).
    (
        "M13 · 🔴 **every conversation reads as one this app is not running** · the slot map stops "
        "being asked. ⛔ **`status` is a COLUMN that `settleOrphanRuns` settles to `idle`**, so a "
        "crashed run and a live one say the same word — `running` is the only field that tells "
        "them apart, and `421` is where that was measured. ⚑ Every plate on the graph would draw "
        "faceless",
        [(HOST, THE_RUNNING, "            : {\n                ...row,\n                running: 'not-running',\n")],
    ),
    (
        "M16 · 🔴 **a task's GIVER becomes a bare id again** · the giver stops being asked whether "
        "this reading drew it. ⛔ **`work.from` alone is a DANGLING POINTER**, and two things reach "
        "it: the bound cutting an older parent, and a giver this app never placed. ⚠️ **The first "
        "draft of this shape gave the spawn edge a word and left the handoff edge an id** — the "
        "same `an-unenumerated-state-counts-as-success` one arrow over, found by review rather "
        "than by a test. ⚑ Every renderer drawing the handoff would write the membership check "
        "this field exists to make unnecessary",
        # ⚑ Landing D-016b (5e931be8, the tree) · re-anchored in place, not retired — The rule
        # survives: a task node's `givenBy` is a word (`a-conversation` or
        # `a-conversation-this-reading-did-not-draw`) and never a bare id, because the giver can
        # fall outside the bound. The line is now `givenBy: underWhat(piece.giver, drawn),`. The
        # plant returns `a-conversation` for any giver. Killed by `the-whole-forest.test.ts`.
        [
            (STORE, '                givenBy: underWhat(piece.giver, drawn),', "                givenBy: { is: 'a-conversation' as const, conversation: piece.giver },"),
        ],
    ),
]
