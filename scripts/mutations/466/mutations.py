#!/usr/bin/env python3
"""466 · the night the digest could not describe — each row is THE DEFECT, put back (131).

🔴 **`463` rehearsed a night and read it the way the person would: digest first, queue second,
transcript only as a failure. Criterion 16 came back 1 yes · 3 partly · 3 no.** In each of the
three `no`s the digest drew its honest silent sentence over something that had happened, and the
worst of the three is `453`'s lesson arriving one surface over:

> ⛔ *"a row that could not be read is being reported as nothing happened."*

⚑ **So every row below is one sentence a person reads made false**, or one count made to answer a
question it was not asked.

## ⛔ The shape of the fix, and therefore the shape of this table

- **§1 · the silent sentence, made unreachable** (`M1`–`M6`) — `463` F3's load-bearing half. A
  closed silence vocabulary, one derivation, the torn arm asked FIRST, and a gap with the count of
  rows on it. Every row here reaches the false sentence again, or deletes the true one.
- **§2 · the walk, reused rather than forked** (`M7`–`M11`) — `453`'s three facts on the digest
  read: which candidate set, how many ledgers, how many rows unread. Every row makes one of them
  answer from the RESULT instead of from the QUERY, which is `453`'s own `M1` on a second reader.
- **§3 · the vocabulary a night actually needs** (`M12`–`M19`) — `463` F6. Whose tool, which
  proposal, which work a question was about, and the two closed vocabularies the fold used to
  throw away.
- **§4 · the two lists that must move together** (`M20`, `M21`) — the SQL and the shared
  vocabulary, and the draw order that `466` stopped retyping.
- **§5 · relay 1 · the register two dispatches extended at once** (`M22`–`M27`) — `467` landed a
  project's conversation ROSTER in `453`'s walk register while `466` was landing a project's
  DIGEST in it, and the two accounts of it could not be unioned. ⛔ Every row here makes the
  reconciled register say something that is not true of both readers, or lets the two readers of
  ONE candidate set answer the same emptiness differently.

## 🔴 What relay 1 changed about this table beyond adding rows

⚠️ **`M22`'s anchor and three rows in OTHER tables moved, because the fix was an extraction.**
`digestWindow` and `conversationsInProject` had a copy each of *fold the slug, then refuse a slug
no `project` row spells*; they now share {@link projectToWalk}. ⛔ **`438 M17`, `467 M2` and
`467 M3` were corrected in place rather than retired** — `correct-a-stale-mutation-anchor-dont-
retire-it` — and each was re-verified RED afterwards, because a corrected anchor otherwise keeps
a verdict it never earned.

⚑ **`438 M17` and `467 M3` are now the same line.** One defends the digest's reading of the fold
and the other the roster's, and each is still killed by its own dispatch's test as well as by the
other's. That widened blast radius is the honest one: written twice, neither copy could be killed
alone.

## ⚑ Which gate can see each row

| rows | the defect is caught by |
|---|---|
| `M1`–`M6`, `M12`–`M19` | ⚑ `apps/desktop/test/the-night-the-digest-could-not-describe.test.ts` |
| `M7`–`M9`, `M11` | ⚑ the same file's §2 — the store's own walk over a real database |
| `M10`, `M21` | ⚑ `apps/desktop/test/a-nights-backlog-rehearsed.render.test.ts` — `463`'s night, re-run |
| `M20` | ⚑ `apps/desktop/test/the-digest-and-its-window.test.ts` §6, and `scripts/test/digest-read-probe-reach.test.mjs` |
| `M22`–`M27` | ⚑ the first file's §2 and §5 — the store over a real database, and the register censused against its own account |

## ⛔ What this table deliberately does NOT contain

⚠️ **No row makes the digest claim a project is COMPLETE.** There is no such field — `453`'s own
table says why, and `466` inherited the rule rather than restating it: completeness is not a
property this app can state about a database it did not write.

⚠️ **No row touches the rumour** — *"1 request was answered by a person"* over an actorless
`user_decision` is `463` F1 and `465`'s dispatch, and a row here would claim a fix `466` did not
make.

⚠️ **Nothing here is RUN.** Every row was applied ALONE, its own killer file run, and the tree
restored from bytes and asserted byte-identical —
`verify-each-mutation-row-without-running-the-table`.
"""

SHARED = "apps/desktop/src/shared/digest.ts"
FOLD = "apps/desktop/src/main/runtime/digest.ts"
VIEW = "apps/desktop/src/renderer/src/lib/digest.ts"
ACTIVITY_LIB = "apps/desktop/src/renderer/src/lib/recent-activity.ts"
STORE = "apps/desktop/src/main/db/session-store.ts"
REGISTER = "apps/desktop/src/shared/questions.ts"
HOST = "apps/desktop/src/main/runtime/runtime-host.ts"

# ⛔ **Anchored on the code and never on the paragraph above it** — a docblock that argues for a
# line is edited far more often than the line (`a-source-census-that-pins-a-line-kills-every-row`).
TORN_FIRST = (
    "  if (project.read.rowsUnread > 0) return 'the-record-is-torn'\n"
    "  if (drawn > 0) return 'it-says-what-happened'\n"
)
OUR_TOOL = (
    "  for (const naming of [CLAUDE_TOOL_NAMING, CODEX_TOOL_NAMING]) {\n"
    "    const split = splitQualified(naming, name)\n"
    "    if (split !== null && split.server === AGENT_TOOL_SERVER) return split.tool\n"
    "  }\n"
)
# ⚠️ **Anchor CORRECTED at `475`, not retired** — that dispatch admitted `message_unqueued` to the
# same statement, so the list this row aims at has one more member. ⛔ `M20`'s subject is
# untouched: the two TOOL types leave the SQL and stay in the vocabulary. ⚑ Its verdict was
# RE-EARNED against the corrected anchor (`a-corrected-anchor-keeps-a-verdict-it-never-earned`).
IN_LIST = (
    "                       'sub_agent', 'workflow_run', 'project_proposed', 'proposal_ended',\n"
    "                       'tool_call', 'tool_result', 'message_unqueued')\n"
)

MUTATIONS: list[tuple[str, list[tuple[str, str, str]]]] = [
    # ── §1 · the silent sentence, made unreachable ─────────────────────────────────────────────
    (
        "M1 · 🔴 THE DEFECT 463 MEASURED, put back · the torn record is asked LAST instead of "
        "first, so a project whose only eligible row could not be parsed falls through every arm "
        "to `nothing-was-recorded` and the card says *Nothing this digest reads was recorded here "
        "in this window* over a row this app dropped. ⛔ 453's strongest-first rule, inverted: "
        "*at zero-with-a-hole, the all-clear is the strongest false thing this app can say*",
        # ⚑ Landing D-017 (3d295083) · re-anchored in place, not retired — 463's strongest-first
        # rule ("rowsUnread asked BEFORE anything else") is unchanged by D-017; only the torn
        # condition grew an `|| ledgersSkipped` clause. Re-anchor swaps the two `if` blocks exactly
        # as before, now over the widened condition, reaching `it-says-what-happened` before the
        # torn check.
        # ⚑ Landing D-016a (bd70d693) · re-anchored in place, not retired — The rule (the torn arm
        # is asked before the drawn arm, 453's strongest-first) is untouched by D-016; only
        # `project` became `digest` in silenceOf's signature. Same swap of the two `if` blocks as
        # 466's original row, over today's text.
        # ⚑ **Recent activity replaced the digest card · re-anchored in place, not retired** — the strongest-first rule moved to Recent activity's `activitySays`: read in part is asked before lines; the plant still asks it after.
        # Imported skill notices join the lines; the partial-read arm must still be first.
        [(ACTIVITY_LIB, "  if (reading.read.rowsUnread > 0 || (reading.read.ledgersSkipped ?? 0) > 0) return 'read-in-part'\n  return reading.lines.length === 0 &&\n    !reading.transcriptsCleared?.length &&\n    !reading.skillImports?.length\n    ? 'nothing-recorded'\n    : 'lines'\n", "  if (reading.lines.length > 0 || reading.transcriptsCleared?.length || reading.skillImports?.length) return 'lines'\n  if (reading.read.rowsUnread > 0 || (reading.read.ledgersSkipped ?? 0) > 0) return 'read-in-part'\n  return 'nothing-recorded'\n")],
    ),
    (
        "M2 · ⛔ the torn arm fires on EVERY project · `> 0` becomes `>= 0`, so a whole record is "
        "reported torn and the true silent sentence is never drawn at all — the same omission in "
        "the other direction, which HO-024 §5.3 calls the worse of the two: *omission is "
        "indistinguishable from nothing-happened*",
        # ⚑ Landing D-017 (3d295083) · re-anchored in place, not retired — HO-024 §5.3's rule that
        # the torn arm must not fire unconditionally still holds; the arm just gained a second,
        # D-017 disjunct. Widening the first disjunct's `>` to `>=` still makes the whole OR always
        # true, planting the same 'fires on every project' defect.
        # ⚑ Landing D-016a (bd70d693) · re-anchored in place, not retired — The torn arm's `> 0`
        # guard still exists in silenceOf, only `project` became `digest`. `>= 0` on the first
        # disjunct makes the whole OR always true, as before.
        # ⚑ **Recent activity replaced the digest card · re-anchored in place, not retired** — the `> 0` guard moved to Recent activity's `activitySays`; the plant still makes it fire on every reading.
        [(ACTIVITY_LIB, "  if (reading.read.rowsUnread > 0 || (reading.read.ledgersSkipped ?? 0) > 0) return 'read-in-part'\n", "  if (reading.read.rowsUnread >= 0 || (reading.read.ledgersSkipped ?? 0) > 0) return 'read-in-part'\n")],
    ),
    (
        # ⛔ **RETIRED (Recent activity, in "Show Recent activity and what finished since you were last here"):** the digest view and its silence words are deleted; Recent activity says not read, read in part, nothing recorded or lines, pinned by the-night-the-digest-could-not-describe §1.
        "M3 · ⚠️ the silent sentence is deleted rather than withheld · the one word that owes a "
        "sentence answers `null`, so a project that genuinely recorded nothing says nothing — "
        "and *this window looked and found none of it* becomes indistinguishable from *this "
        "window has not looked*, which is the pair `digestView`'s own docblock exists to keep apart",
        [
            (
                VIEW,
                "  'nothing-was-recorded': {\n    hook: 'digest-silent',\n",
                "  'nothing-was-recorded': null as unknown as { hook: string; says: string },\n  'unused-was-recorded': {\n    hook: 'digest-silent',\n",
            )
        ],
    ),
    (
        # ⛔ **RETIRED (Recent activity, in "Show Recent activity and what finished since you were last here"):** the digest view and its silence words are deleted; Recent activity says not read, read in part, nothing recorded or lines, pinned by the-night-the-digest-could-not-describe §1.
        "M4 · ⚠️ the drawn count is asked before the rows · the `rows-drew-no-line` arm moves "
        "above `it-says-what-happened`, so a project with five lines ALSO draws *none of it "
        "became a line* beside them — `304`'s shape: two sentences on one card denying each other",
        [
            (
                VIEW,
                "  if (drawn > 0) return 'it-says-what-happened'\n",
                "  if (project.sessions > 0) return 'rows-drew-no-line'\n",
            )
        ],
    ),
    (
        "M5 · 🔴 the hole is counted and never drawn · the `source-unreadable` gap is not built, "
        "so the walk knows how many rows it could not read and no surface says it — which is "
        "`150`'s silent skip restored on the one reader that had somewhere to put it",
        [
            (
                FOLD,
                "    gap('source-unreadable', read.rowsUnread),\n",
                "    gap('source-unreadable', 0),\n",
            )
        ],
    ),
    (
        "M6 · ⛔ the gap counts what the walk FOUND instead of what it missed · `rows.length` for "
        "`rowsUnread`, so a healthy project reports every row it read as a row it could not — "
        "`LedgerWalk.rowsUnread`'s own rule: *this number and the rows do not add up to anything "
        "and must not be drawn as if they did*",
        [
            (
                FOLD,
                "    gap('source-unreadable', read.rowsUnread),",
                "    gap('source-unreadable', read.rows.length),",
            )
        ],
    ),
    # ── §2 · the walk, reused rather than forked ───────────────────────────────────────────────
    (
        "M7 · 🔴 the ledger count is taken from the RESULT · `453` M1, on the reader `463` F3 "
        "asked for: a project with forty-seven conversations and a quiet night reports `1` "
        "because one row came back, and the two facts `ledgers` and `sessions` collapse into one",
        # ⚑ Landing D-016a (bd70d693) · re-anchored in place, not retired — The rule survives:
        # `ledgers` is the candidate query's count and never derived from the rows returned. Only
        # the query moved (`selectDigestLedgers.get(slug)` became `countPlacedConversations.get()`).
        # To plant the label's defect (count taken from the RESULT), the return field is changed to
        # the distinct sessions of the rows, which is a one-line edit with no TDZ issue.
        [
            (STORE, "        walk: 'one-window-over-every-agents-conversation',\n        ledgers,\n        rowsUnread,\n", "        walk: 'one-window-over-every-agents-conversation',\n        ledgers: new Set(rows.map((row) => row.session_id)).size,\n        rowsUnread,\n"),
        ],
    ),
    (
        "M8 · ⛔ the digest's own skip goes back to being silent · the counter never increments, "
        "so `rowsUnread` is always zero, the gap never fires and the silent sentence is reachable "
        "again through the back door — the defect M1 puts back at the other end of the same wire · killed by `the-night-the-digest-could-not-describe.test.ts`",
        [
            (
                STORE,
                # ⚑ **W4.205 · re-anchored in place, not retired** — W4.205 · the digest now keeps its rows per conversation between reads and counts a torn one while it collects the window; the plant still never increments that count, so a torn record reads as a quiet one
                "          if (one.row === null) rowsUnread += 1\n",
                "          if (one.row === null) rowsUnread += 0\n",
            )
        ],
    ),
    (
        "M9 · ⛔ a store with NO DATABASE claims it walked a project · `NULL_SESSION_STORE` "
        "answers the ordinary word, so an empty digest out of an app with no ledger is the same "
        "payload as a quiet night — `453` M3's defect, arriving on the fourth reader",
        [
            (
                STORE,
                "  digestWindow: () => ({ rows: [], walk: 'no-ledger', ledgers: 0, rowsUnread: 0 }),",
                "  digestWindow: () => ({\n    rows: [],\n    walk: 'one-window-over-every-conversation-in-that-project',\n    ledgers: 0,\n    rowsUnread: 0,\n  }),",
            )
        ],
    ),
    (
        "M10 · ⚠️ the host re-derives the walk instead of carrying it · `453`'s rule is that *the "
        "party that WALKED is the only one that can say what it walked*; a second derivation one "
        "layer up answers a number the walk never used, and here it answers `sessions` under a "
        "second name",
        # ⚑ Landing D-017 (3d295083) · re-anchored in place, not retired — D-017 only added a
        # `...ledgersSkippedOf(read.ledgersSkipped)` field beside the three carried-through walk
        # facts; `ledgers: read.ledgers` is still the one line carrying '453's rule that the party
        # that walked is the only one that can say what it walked'. Re-deriving it as `new
        # Set(read.rows.map(row => row.sessionId)).size` still makes it answer the same number as
        # `sessions` two lines up, under a second name.
        [
            (HOST, '        read: {\n          walk: read.walk,\n          ledgers: read.ledgers,\n          rowsUnread: read.rowsUnread,\n          ...ledgersSkippedOf(read.ledgersSkipped),\n        },\n', '        read: {\n          walk: read.walk,\n          ledgers: new Set(read.rows.map((row) => row.sessionId)).size,\n          rowsUnread: read.rowsUnread,\n          ...ledgersSkippedOf(read.ledgersSkipped),\n        },\n'),
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-016a, bd70d693):** The row's subject is the per-project
        # split of the digest, which D-016a removed on purpose: commit message 'The digest is one
        # window over every conversation an agent holds', card 'the digest's per-project split (one
        # window now)'. `digestView` now has one `covers: walkCovers(digest.read.walk)` string, so
        # there is no first project whose sentence could be printed for the others. Its anchor is
        # left stale, so the census records it retired.
        "M11 · ⚠️ the reading names ONE walk for every project · the first project's sentence is "
        "printed for all of them, so a reading whose projects were walked two different ways "
        "tells a person about one of them and says nothing about the other",
        [
            (
                VIEW,
                "    covers: [...new Set(reading.projects.map((project) => WALK_COVERS[project.read.walk]))],",
                "    covers: reading.projects.slice(0, 1).map((project) => WALK_COVERS[project.read.walk]),",
            )
        ],
    ),
    # ── §3 · the vocabulary a night actually needs ─────────────────────────────────────────────
    (
        "M12 · 🔴 only ONE provider's spelling is recognised · the prefixed naming is dropped, so "
        "every `mcp__brobot__…` call is read as somebody else's tool and a whole provider's "
        "conversations go silent — *a join that compared BARE names would match nothing on Claude "
        "and would look exactly like a conversation whose tools did not arrive*",
        [
            ("apps/desktop/src/main/providers/claude/transcripts.ts", "  splitToolName: (name) => splitQualified(CLAUDE_TOOL_NAMING, name),", "  splitToolName: () => null,"),
        ],
    ),
    (
        "M13 · ⛔ every tool is this app's tool · the server is not compared, so the agent's own "
        "`Bash` output lands in a digest — which is `405` §2's rule broken by the surface that "
        "exists to replace the transcript, and a summary of the WORK rather than of an act in the "
        "workspace",
        [
            ("apps/desktop/src/main/runtime/digest.ts", "  for (const provider of SUPPORTED_PROVIDERS) {\n    const split = providerDefinitions[provider].transcripts.splitToolName?.(name) ?? null\n    if (split !== null && split.server === AGENT_TOOL_SERVER) return split.tool\n  }\n", "  for (const provider of SUPPORTED_PROVIDERS) {\n    const split = providerDefinitions[provider].transcripts.splitToolName?.(name) ?? null\n    if (split !== null) return split.tool\n  }\n"),
        ],
    ),
    (
        "M14 · 🔴 463 F2's collision, created fresh on tool ids · the result is matched on the "
        "provider's bare call id, so a receipt in one conversation is drawn under a tool name "
        "from another — *provider request IDs are only session-local*, and `466` added a second "
        "population keyed the same way",
        [
            (
                FOLD,
                "        const called = tally.ourCalls.get(key(row.sessionId, event.id))",
                "        const called = tally.ourCalls.get(event.id)",
            )
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-016a, bd70d693):** Proposals were removed end to end by
        # D-016a ('Proposals go end to end'). The `project_proposed` case, its `“${event.name}”,
        # proposed by …` line and `agentCalled(event.proposedBy)` are deleted from the fold; the
        # remaining `proposedBy` hits are the unrelated instruction-proposal feature. Its anchor is
        # left stale, so the census records it retired.
        "M15 · ⛔ the agent's REASONING is drawn as an observation · `why` in place of `name`, "
        "under the `observed` chip — HO-024 §5.1 verbatim: *an outcome an agent declared is the "
        "agent's claim and a digest may report it as such; it may never restate a claim as an "
        "observation*. ⚑ The field's own declaration calls it *a CLAIM* in those words",
        [
            (
                FOLD,
                # ⚠️ **Anchor CORRECTED at `475`, not retired** — that dispatch moved the shape
                # clause off this detail and onto the counted breakdown beside it, so the line
                # this row aims at is one interpolation shorter. ⛔ The row's subject is
                # untouched: `why` in place of `name`. ⚑ Its verdict was RE-EARNED against the
                # corrected anchor (`a-corrected-anchor-keeps-a-verdict-it-never-earned`).
                # ⚑ **707 · re-anchored in place, not retired** — R41 names the proposer (`agentCalled`); the row still draws the agent's reasoning as the observation.
                "          `“${event.name}”, proposed by ${agentCalled(event.proposedBy)}`,",
                "          `“${event.why}”, proposed by ${agentCalled(event.proposedBy)}`,",
            )
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-016a, bd70d693):** Proposals are gone: `proposal_ended`,
        # `proposalEndedSays` and `PROPOSAL_ENDED_SAYS` were deleted with `shared/proposals.ts`
        # (commit: 'Proposals go end to end'). No fold arm reads an ending any more, so an unknown
        # ending cannot print as `undefined`. Its anchor is left stale, so the census records it
        # retired.
        "M16 · ⚠️ an ending this build does not know prints as `undefined` · the guard goes, so a "
        "ledger written by a later build tells a person their proposal ended `undefined` — "
        "`permanenceSaid`'s rule, which exists because a row is `JSON.parse`d and cast with no "
        "schema between the database and the fold",
        [
            (
                FOLD,
                "        bump(tally, 'proposal-settled', row.at, proposalEndedSays(event.ending))",
                "        bump(tally, 'proposal-settled', row.at, PROPOSAL_ENDED_SAYS[event.ending])",
            )
        ],
    ),
    (
        "M17 · ⚠️ the work a question names is drawn as its INTERNAL ID · `437`'s edge reaches a "
        "person as `task_7f3c…` instead of `#2`, which is a number nobody quotes and a string the "
        "app promised never to show — the number is the thing a person says out loud",
                # ⚠️ **611 · CORRECTED IN PLACE** — the bump is guarded, because a PASSED-UP
                # question names no task (HO-088 §3.2). The row's subject is unchanged.
                # ⚠️ **697 · CORRECTED IN PLACE again** — the number is spelled `taskCalled(number)`
                # (`672` H1: *Task #2*, not a bare `#2`). The subject — the number, not the id — is
                # unchanged.
        # ⚑ Landing D-016b (5e931be8, the tree) · re-anchored in place, not retired — The rule
        # survives: the question-about-work line names the work by its label whenever the piece was
        # given. The plant names the line by the raw piece id (work_...) instead of the label, so
        # the line no longer says which work in words a person reads. Killed by
        # `the-night-the-digest-could-not-describe.test.ts`.
        [
            (FOLD, "          bump(tally, 'question-about-work', row.at, event.label ?? null)", "          bump(tally, 'question-about-work', row.at, event.piece)"),
        ],
    ),
    (
        "M18 · 🔴 the five reasons collapse back into one count · `463`: *the digest collapses all "
        "five reasons into one count*, which is the sentence this dispatch was written to delete. "
        "⛔ A person reading *5 requests came up* cannot name what happened, which is criterion 16",
        [
            (
                FOLD,
                "      return `${many(group.count, 'request', 'requests')} came up that only a person can settle: ${eachWord(",
                "      return `${many(group.count, 'request', 'requests')} came up that only a person can settle.${String(",
            )
        ],
    ),
    (
        "M19 · ⛔ the permanences are dropped from the refusal line · the word is ON the row — "
        "`405` records it *beside `permanence` even though every door DERIVES it* precisely so a "
        "reader need not — and the digest goes back to counting refusals without saying which of "
        "them can never succeed",
        [
            (
                FOLD,
                "refused — the most recent was ${group.detail ?? 'unnamed'}. How long each is expected to hold: ${eachWord(",
                "refused — the most recent was ${group.detail ?? 'unnamed'}.${String(",
            )
        ],
    ),
    # ── §4 · the two lists that must move together ─────────────────────────────────────────────
    (
        "M20 · 🔴 the SQL stops selecting the two tool types while the vocabulary keeps them · "
        "`selectTaskEvents`' rule, on this statement: *a type the fold branches on and the "
        "statement omits reads as that event never happened, silently*. ⚑ The census asserts the "
        "pair in both directions and the `.mjs` reach test asserts it again from outside",
        # ⚑ Landing D-016a (bd70d693) · re-anchored in place, not retired — The rule (the SQL type
        # list and the shared vocabulary must move together) is unchanged; D-016 only removed
        # `project_proposed` and `proposal_ended` from both lists. The plant drops the two tool
        # types from today's statement while DIGEST_EVENT_TYPES keeps them.
        [
            (STORE, "                       'sub_agent', 'workflow_run',\n                       'tool_call', 'tool_result', 'message_unqueued')\n", "                       'sub_agent', 'workflow_run',\n                       'message_unqueued')\n"),
        ],
    ),
    (
        "M21 · ⚠️ the draw order goes back to being a second list of the same words · ⚑ ANCHOR "
        "CORRECTED IN PLACE when 466 rebased onto 465, which had narrowed the list's element type "
        "to `ObservedLineKind` and renamed one member; the derivation now reads 465's own "
        "`LINE_REGISTERS` and the row puts back the literal 465 left. A literal, "
        "short by the four kinds `466` added, so the fold composes four sentences no surface ever "
        "emits and nothing is red — `a-loop-over-a-literal-variant-list-is-not-exhaustive`, which "
        "is the hazard the derivation was written to delete",
        [
            (
                FOLD,
                "const OBSERVED_ORDER: readonly ObservedLineKind[] = DIGEST_LINE_KINDS.filter(\n"
                "  (kind): kind is ObservedLineKind =>\n"
                "    (LINE_REGISTERS[kind] as readonly DigestRegister[]).includes('observed'),\n"
                ")",
                "const OBSERVED_ORDER: readonly ObservedLineKind[] = [\n"
                "  'work-handed-out',\n"
                "  'work-taken-back',\n"
                "  'question-travelled',\n"
                "  'decision-raised',\n"
                "  'question-escalated',\n"
                "  'question-lost',\n"
                "  'request-answered',\n"
                "  'work-interrupted',\n"
                "  'work-restarted',\n"
                "  'tool-refused',\n"
                "  'turn-ended',\n"
                "]",
            )
        ],
    ),
    # ── §5 · 466 · relay 1 · the register 467 and 466 both extended ────────────────────────────
    (
        # ⛔ **RETIRED BY RULING (landing D-016a, bd70d693):** The row's subject is a digest asked
        # about a project slug no `project` row spells. D-016a removed projects as something a
        # person or model meets and made `digestWindow(from, to)` take no project: `projectToWalk`,
        # `noSuchProject` and the per-project slug are gone from the store ('The digest is one
        # window over every conversation an agent holds'). Its anchor is left stale, so the census
        # records it retired.
        "M22 · 🔴 THE DEFECT THE RELAY FOUND, put back · a project this app does not hold is "
        "answered with the PROJECT word · `digestWindow` says *this project's conversations were "
        "read and they said nothing* about a slug no `project` row spells. ⛔ `467` had already "
        "given that empty a word one reader over, and two readers of ONE candidate set answering "
        "it two different ways is the disagreement the register exists to prevent",
        [
            (
                STORE,
                "      const slug = projectToWalk(projectSlug)\n"
                "      if (slug === null) return noSuchProject()\n"
                "      const ledgers = (selectDigestLedgers.get(slug) as { n: number }).n\n",
                "      const slug = foldProfileName(projectSlug)\n"
                "      const ledgers = (selectDigestLedgers.get(slug) as { n: number }).n\n",
            )
        ],
    ),
    (
        "M23 · ⛔ the account's table keeps the name the register was renamed FROM · the docblock "
        "promises *the six words, and what each one narrowed* and then names a word that is not "
        "in the array — `a-pointer-clause-is-a-claim`, and the claim is that this table covers "
        "the register",
        # ⚑ Landing D-016a (bd70d693) · re-anchored in place, not retired — The rule (the docblock
        # table names every word and invents none) still holds and is asserted by §5. The table row
        # for the digest's word is now `one-window-over-every-agents-conversation`; the plant puts
        # the retired name (the one the register was renamed FROM in D-016) back in the table.
        [
            (REGISTER, ' * | `one-window-over-every-agents-conversation` |', ' * | `one-window-over-every-conversation-in-that-project` |'),
        ],
    ),
    (
        # Same defect on its current subject; source-only, NOT VERIFIED.
        "M24 · ⚠️ the count the account spells goes stale · *eleven* becomes *ten* while the "
        "array holds eleven. ⛔ `458`'s rule is that a number in prose outlives the derivation that made "
        "it true; the census derives the numeral from the array so the prose cannot drift alone",
        # ⚑ **508 re-anchored this and the ROW is unchanged** — that dispatch added a seventh walk
        # word, so the heading this row makes go stale now says *seven*. ⛔ The rule is exactly the
        # one it was written for, and this correction IS the rule being paid: the census derives the
        # numeral from the array, so moving the array moved the prose and this anchor with it.
        # ⚑ **533 · ANCHOR CORRECTED IN PLACE, not retired.** `every-provider-wall-recently-
        # recorded` made the register eight members long, so the heading this row drifts reads
        # *eight* now. ⛔ The SUBJECT is untouched — *the count the account spells goes stale while
        # the array holds one more* — and it is the very drift this row is about, which is why it
        # is a repair (`correct-a-stale-mutation-anchor-dont-retire-it`) and not a retirement.
        # ⚑ **543 · ANCHOR CORRECTED IN PLACE, not retired** — the third correction of this row
        # and the third time it IS the rule being paid. `543` added three members (a spawn walk, a
        # conversation's own work walk and `no-such-conversation`), so the heading this row drifts
        # now reads *eleven*. ⛔ The SUBJECT is untouched: *the count the account spells goes stale
        # while the array holds one more*. ⚠️ Re-verified RED by hand against
        # `the-night-the-digest-could-not-describe.test.ts`, which derives the numeral from the
        # array — `a-corrected-anchor-keeps-a-verdict-it-never-earned`.
        #
        # ⚑ **ANCHOR CORRECTED IN PLACE BY 557 — the fourth time, and the rule is paying itself.**
        # `every-conversation-that-was-given-work` is a twelfth member, so the heading now reads
        # *twelve*. ⛔ The subject is unchanged and the row was re-verified RED by hand against the
        # same file. ⚠️ **The row's own TITLE still says *six* becomes *five***, which is a third
        # spelling of this count in prose and is exactly what this row exists to catch one level
        # down; it is corrected here rather than left, because a description that disagrees with
        # its own edit is `a-number-can-survive-the-death-of-its-derivation` inside the instrument.
        #
        # ⚑ **ANCHOR CORRECTED IN PLACE BY 637 — the fifth time.** `every-conversation-this-app-placed`
        # is a thirteenth member, so the heading now reads *thirteen*. ⛔ The subject is unchanged —
        # the numeral in the prose against the length of the array — and the row was re-verified RED
        # by hand against the same file. ⚠️ **Corrected and not retired**: the anchor moved because
        # the list grew, which is the fact this row exists to notice
        # (`correct-a-stale-mutation-anchor-dont-retire-it`).
        # ⚑ Landing D-016a (bd70d693) · re-anchored in place, not retired — The count in the
        # account's heading is still derived from the array by §5
        # (SPELLED[LEDGER_WALK_KINDS.length]). The array holds ten words now, so the heading reads
        # *ten*; the plant makes it *nine*.
        [
            (REGISTER, ' * ## 🔴 The eleven words', ' * ## 🔴 The ten words'),
        ],
    ),
    (
        "M25 · 🔴 the two words over ONE candidate set become substrings of one another · the "
        "roster's word is shortened, so `an-assertion-can-be-satisfied-by-a-neighbouring-element` "
        "is live on the first pair in this register close enough for it. ⚑ Caught by the "
        "distinctness census, and by the register's own exhaustiveness census beside it",
        # ⚑ Landing D-016a (bd70d693) · re-anchored in place, not retired — The rule (two words over
        # ONE candidate set must not be substrings of one another) survives on the pair that is
        # left: the digest's word and the forest's word. The roster's word is gone, so the plant
        # shortens the forest's word to `every-agents-conversation`, a substring of the digest's
        # word.
        [
            (REGISTER, "  'every-conversation-this-app-placed',\n", "  'every-agents-conversation',\n"),
        ],
    ),
    (
        "M26 · ⚠️ the roster's sentence drops the generation clause it landed without · `467`'s "
        "words restored verbatim. ⛔ `conversationsInProject` folds open work through "
        "`tasksOfSession`, which passes `activeGeneration`, so a conversation whose task rows "
        "live only in a replaced projection is drawn with NO open work beside it and the sentence "
        "promises the read was not narrowed",
        # ⚑ Landing D-016a (bd70d693) · re-anchored in place, not retired — The roster sentence is
        # gone, but the rule (a walk sentence over a read folded through tasksOfSession at
        # activeGeneration must carry the generation clause) survives, and the test now applies it
        # to the forest's sentence. That sentence ends with the same clause, so the plant removes it
        # there.
        [
            (REGISTER, " is in no forest and is counted separately. Only each conversation’s live projection is read, so work that exists solely in one this app has replaced is not drawn beside it.',", " is in no forest and is counted separately.',"),
        ],
    ),
    (
        "M27 · ⛔ the digest's candidate count stops opening the conversations · the "
        "`provider_session` join goes, so `ledgers` counts the project's BINDINGS. 🔴 The register "
        "holds two words for one population on the ground that both open the same ledgers; "
        "narrow one and that justification is gone with nothing red in the docblock that states it",
        # ⚑ Landing D-016a (bd70d693) · re-anchored in place, not retired — The rule survives: the
        # digest's `ledgers` is a count of conversations (provider_session joined to their binding),
        # not of bindings. Today that count is `countPlacedConversations`, so the plant drops the
        # provider_session join and counts agent_profile rows.
        # ⚑ Landing D-016a commit 2 (a5d66e92) · re-anchored in place, not retired — The rule
        # survives: the digest's ledger count is the number of placed CONVERSATIONS, not of
        # identities ("they agree on the COUNT, where bindings and conversations differ"). The plant
        # counts agent_identity rows, which is the old bindings-versus-conversations confusion.
        # Killed by `the-night-the-digest-could-not-describe.test.ts`.
        [
            (STORE, '    `SELECT count(*) AS n FROM provider_session WHERE agent_identity_id IS NOT NULL`,\n', '    `SELECT count(*) AS n FROM agent_identity`,\n'),
        ],
    ),
]
