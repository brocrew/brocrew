"""396 · nothing waits on somebody looking — each row is THE DEFECT, put back (131).

🔴 **One principle, and three findings that turned out to be it.**

> ⛔ **Whether work happens must never depend on whether anybody is looking at it.**

`395` §6, `394` §6.1 and `394` §6.2 each measured one instance and each stated it rather than fixing
it. ⚑ **This table is shaped by the fact that they are ONE subject**: a gate about ATTENTION decides
nothing about WORK (`M1`), a launch WRITES the ending a crash could not (`M2`-`M9`), and a reader
exists for the question a message could not carry (`M10`-`M16`).

⚠️ **Two of the rows below are assertions this dispatch DELETED, put back as code.** `395` recorded
the mailbox defect as a MEASUREMENT so that the day it was repaired the test would go red, and `394`
did the same for the crash. Both went red, both were replaced by their opposite, and `M1` and `M2`
are what re-break them.

## 🔴 Which gate can see each row

| rows | the defect is caught by |
|---|---|
| `M1` | ⚑ **`run_suite`** — `apps/desktop/test/nothing-waits-on-somebody-looking.test.ts` §1, §5 |
| `M2`-`M9` | ⚑ **`run_suite`** — the same file's §2 and §4, and `a-question-finds-a-person.test.ts` §5 |
| `M10`-`M14` | ⚑ **`run_suite`** — the same file's §3, and `the-five-tools.test.ts` §5 |
| `M15` | ⚑ **`run_suite`** — `the-text-a-child-is-actually-told.test.ts` §1 |

## ⛔ What this table deliberately does NOT contain

⛔ **No row moving the flush ABOVE the emits**, which is the ordering hazard `395` named when it
refused to move the call. ⚠️ **It records as a survivor and it would mean nothing**: `runFlush`
awaits `recheckHandedPaths` before its first publish, so nothing it does can overtake a synchronous
`emit` whatever line the call sits on. ⚑ *A mutation whose replacement changes no answer is a
phantom.* The position is still the belt — `deliver`'s own note says why, and `§5`'s census pins the
gate rather than the ordering.

⛔ **No row on `NO_SURFACE.alive`.** `349` argued there is none — flipping it changes no observable
behaviour — and `395` restated it. What this dispatch changed is the SHAPE of the reader, not the
constant, and `M1` is that.

⛔ **No row making `list_questions` take a destination.** There is no argument to remove: the
caller's id is minted by the toolset, and a row would have to ADD a parameter, which is a feature
this dispatch did not build rather than a rule it shipped. ⚑ The claim is asserted as the tool's own
empty `input` in §3.

⛔ **No row on `settleStrandedMessages` or `settleOrphanRuns`.** `354`/`379` and `074` own those;
`396` added a third sweep beside them and changed neither.

## 🔴 The row that was WRITTEN, run, and removed — and what it found

⛔ **`M13` was *"the store reads PERMISSION requests too"*, and it SURVIVED.** ⚠️ That is not a gap in
the suite; the mutation is a NO-OP, and finding out which is the reason a row is verified rather than
reasoned about.

⚑ **A `permission_request` carries no `prompt` and no `questions`** — `events.ts` gives it `kind`,
`action` and `detail` — so widening `selectQuestionsRaised`'s `type` filter to admit one returns a
row whose two fields are SQL `NULL`, and the reader skips a row it cannot read. ⛔ **So the type
filter is not independently load-bearing**, and the docblocks that said *"two narrowings, either
alone is a gate with a hole in it"* were wrong in the half they were proudest of. Both were corrected
in this commit.

⚠️ **What the type filter IS for stands**: `053`'s narrow read, so a conversation's approval cards are
never decoded to find a question. ⚑ **What keeps a permission's words from a parent is `M12`** — the
`because` gate — and that one is measured, on a Codex-shaped grant arriving on `user_input_request`
WITH a prompt and parts, which is the case no type filter can see.

⚠️ **No row on the `to: 'the-parent'` arm of `routeRequest`.** `394` `M?`-space owns the routing; this
dispatch reads it and does not write it.
"""

STORE = "apps/desktop/src/main/db/session-store.ts"
HOST = "apps/desktop/src/main/runtime/runtime-host.ts"
FOLD = "apps/desktop/src/shared/questions.ts"
TOOLS = "apps/desktop/src/main/runtime/agent-tools.ts"
FACTORY = "apps/desktop/src/main/runtime/factory-text.ts"
ASK_AND_WAIT = "apps/desktop/resources/built-in-skills/ask-and-wait/SKILL.md"

# ⚠️ **The flush is anchored BY ITS OWN LINE and not by the bare call**, because
# `this.flushQueued(session)` occurs twice in the host — the other is `sendInterrupting`'s `finally`
# — and an anchor that matched both would prove nothing about which line moved. ⛔ **Two hunks and
# not one**: the block's closing brace and the flush are separated by the paragraph that argues why
# the flush is outside it, and an anchor spanning that prose would die the next time somebody edits
# a comment (`a-source-census-that-pins-a-line-kills-every-row-on-it`).
FLUSH_LINE = "    if (event.type === 'status' && event.state === 'idle') this.flushQueued(session)"
GATE_CLOSES = "      if (routed !== null) this.emit(session, routed)\n    }\n"

MUTATIONS: list[tuple[str, list[tuple[str, str, str]]]] = [
    # ── §1 · a gate about attention decides nothing about work ────────────────────────────────
    (
        "M1 · 🔴 the flush goes back UNDER the attention gate · a message queued to a busy child "
        "nobody is watching is never sent, because the one trigger — the target going idle — never "
        "runs for exactly the conversations a mailbox exists for; `395` measured this and this row "
        "is that measurement put back · killed by `nothing-waits-on-somebody-looking.test.ts` (named by W4.78)",
        [
            (
                HOST,
                GATE_CLOSES,
                "      if (routed !== null) this.emit(session, routed)\n"
                "      if (event.type === 'status' && event.state === 'idle') this.flushQueued(session)\n"
                "    }\n",
            ),
            # ⚑ **W4.78 · re-anchored in place, not retired** — e0e93e6e added the reopen-for-what-waits
            # lines after the flush, so the flush no longer ends the method; the anchor is the flush and the
            # comment line under it, still unique once edit 0 has put an indented copy inside the gate.
            (
                HOST,
                FLUSH_LINE
                + "\n    // ⚑ **Work that ran in the background is one thing a reopen on the current sign-in waits for**\n",
                "    // ⚑ **Work that ran in the background is one thing a reopen on the current sign-in waits for**\n",
            ),
        ],
    ),
    # ── §2 · a launch writes the ending a crash could not ─────────────────────────────────────
    (
        "M2 · 🔴 the launch settles NOTHING · a routed request reads `open` for ever while the "
        "provider that raised it is gone, so `list_questions` OFFERS a question nobody is waiting "
        "on and the answer door admits it — `394` §6.1's finding, restored",
                # ⚑ **T-003 · re-anchored in place, not retired** — D-009 hands the sweep `stillOpen` (askers a quit left open are skipped); the row still removes the launch sweep. Re-verified RED alone.
        # ⚑ Landing D-017 (3d295083) · re-anchored in place, not retired — The block still exists as
        # one self-contained launch write (now threading `askedSkipped` through sayTheSweep),
        # unrelated to D-009's stillOpen exclusion which was already folded in before this commit
        # (T-003's prior re-anchor). Deleting the whole block again removes the launch's only repair
        # for a routed request whose provider is gone, restoring `394` §6.1's finding.
        [
            (HOST, '    const askedSkipped = rowsUnreadOnce()\n    const asked = this.deps.store.settleStrandedRequests(this.now(), stillOpen, askedSkipped)\n    sayTheSweep(\n      asked,\n      askedSkipped,\n      `questions: settled ${asked} left waiting for an answer by a previous run`,\n    )\n', ''),
        ],
    ),
    (
        "M3 · ⛔ the sweep ignores `running` · a second host in one process strands a request the "
        "first is still holding, so a live question is told it is over and the conversation blocked "
        "on it waits for an answer nobody may now send — `198`'s rule, third venue",
        [(STORE, "        if (running.has(asker.id)) continue\n", "")],
    ),
    (
        "M4 · ⚠️ the sweep settles requests that already ENDED · every answered question is "
        "re-stranded at every launch, so a parent's own answer is overwritten by a row saying "
        "nobody ever gave one, and the ledger grows a strand per relaunch for ever",
        [
            (
                STORE,
                "          if (!REQUEST_IS_OPEN[request.state]) continue\n",
                "",
            )
        ],
    ),
    (
        "M5 · 🔴 the ordinal is read once for the whole conversation · two open requests collide on "
        "`unique(session_id, generation, ordinal)`, the transaction aborts, and a launch that was "
        "supposed to repair the ledger repairs nothing and throws on its way past",
        # ⛔ **Two hunks, and the prose between them is why** — the paragraph that argues *"re-read
        # per row and not hoisted"* sits exactly where a single span would have to cross, and an
        # anchor over a comment dies the next time somebody edits one.
        # ⚑ Landing D-017 (3d295083) · re-anchored in place, not retired — settleStrandedRequestsTx
        # still re-reads selectMaxOrdinal per open request rather than hoisting it once for the
        # whole conversation, so the ordinal-collision invariant it protects still holds. D-017's
        # outer try/catch reindented the block (8/10→10/12 spaces) and routedRequestsOfSession now
        # also takes unread?.in(asker.id), so the old two-hunk anchor no longer matches; the
        # hoist-the-max defect itself is unchanged.
        # ⚑ Landing D-017 (45a11477) · re-anchored in place, not retired —
        # `settleStrandedRequestsTx` still deliberately re-reads `selectMaxOrdinal` per request
        # rather than hoisting it, for the same reason (a hoisted read would collide on
        # `unique(session_id, generation, ordinal)` for two open requests). D-017 only inserted an
        # extra `launched`/`raised` computation between `generation` and the loop, breaking the
        # second edit's old anchor; hoisting the read to just before the loop (after the new lines)
        # reproduces the identical defect.
        [
            (STORE, '            const max = selectMaxOrdinal.get(asker.id, generation) as\n              { max_ordinal: number | null } | undefined\n', ''),
            (STORE, '          const raised = launched ? questionsRaisedInSession(asker.id, unread?.in(asker.id)) : null\n          for (const request of routedRequestsOfSession(asker.id, unread?.in(asker.id))) {', '          const raised = launched ? questionsRaisedInSession(asker.id, unread?.in(asker.id)) : null\n          const max = selectMaxOrdinal.get(asker.id, generation) as\n            { max_ordinal: number | null } | undefined\n          for (const request of routedRequestsOfSession(asker.id, unread?.in(asker.id))) {'),
        ],
    ),
    (
        "M6 · 🔴 the fold cannot see the ending · the row is written at every launch and the state "
        "never moves, so the repair is invisible to every surface and the ledger grows a strand per "
        "relaunch — the shape `379` calls a write nobody reads",
        [
            # ⚠️ **The branch is KEPT and emptied**, rather than deleted or renamed: a branch on a
            # type that is not in the union would be red for a TYPE error rather than for the
            # defect, and an anchor spanning the branch would have to cross the docblock inside it.
            (
                FOLD,
                "      settle(event.requestId, 'stranded', entry.at)\n      continue\n",
                "      continue\n",
            )
        ],
    ),
    (
        "M7 · ⛔ the store's narrow read does not SELECT the ending · the fold acts on a type the "
        "reader never hands it, so the stranding is visible in the live process and gone after a "
        "restart — silently, and only on the replayed path, which is the path every launch takes",
                # ⚑ **Re-anchored in place by `397`, by `398` and again by `591`** (142's rule):
                # the list gained `request_interrupted`, then `request_escalated`, then
                # `request_work_withdrawn` — which also pushed `status` onto a line of its own.
                # ⛔ The row still removes `request_stranded` and nothing else, so the defect it
                # expresses is exactly the one it always did. Re-verified RED individually each time.
                # ⚑ **T-003 · re-anchored in place, not retired** — D-009 appended two question types to the list; the anchor is now its first two lines, and the row still drops `request_stranded`. Re-verified RED alone.
        # ⚑ Landing D-016b (5e931be8, the tree) · re-anchored in place, not retired — The rule
        # survives: the narrow read of routed requests (`selectRoutedRequestEvents` in
        # session-store.ts) must select the ending, or the fold acts on a type the reader never
        # hands it after a restart. The plant drops `'request_stranded'` from the outer `AND type IN
        # (...)` list, which is the one the a-question-finds-a-person census reads. The stranding is
        # then visible live and gone after replay. The two-line anchor keeps the count at 1. Killed
        # by `a-question-finds-a-person.test.ts`, `nothing-waits-on-somebody-looking.test.ts`.
        # ⚑ Landing D-016c (72b78a37, the giver's verbs) · re-anchored in place, not retired — The
        # rule holds: the routed-request statement must select the events that end or strand a
        # question, so the fold can see them. The statement's IN list now carries work_taken_back
        # and work_closed beside request_interrupted, and the old anchor named a list that has
        # changed shape. The plant drops request_stranded from the list, so a stranded question
        # reads as never stranded on the replayed path. Killed by
        # `a-question-finds-a-person.test.ts`, `nothing-waits-on-somebody-looking.test.ts`.
        [
            # Source-only NOT VERIFIED: omit the same ending from the shared replay selection list.
            (STORE, "  'request_stranded',\n", ""),
        ],
    ),
    (
        "M8 · ⚠️ a stranded request counts as still SOMEBODY'S TO ANSWER · `admitAnswer` reads this "
        "table, so the door admits an answer for a request whose provider process no longer exists "
        "and the caller is told it succeeded",
        [(FOLD, "  stranded: false,", "  stranded: true,")],
    ),
    (
        "M9 · ⛔ the stranding is folded as `abandoned` · a parent is told the conversation ENDED "
        "underneath its question when the conversation is still there and can be asked again, which "
        "is the one wrong thing it could do about a child it can resume",
        [
            (
                FOLD,
                "      settle(event.requestId, 'stranded', entry.at)",
                "      settle(event.requestId, 'abandoned', entry.at)",
            )
        ],
    ),
    # ── §3 · the question a parent was never told about ───────────────────────────────────────
    (
        "M10 · 🔴 the reader is not published · a question routed to a parent that was not running "
        "reaches it nowhere at all — no message, therefore no id, therefore no answer — and the "
        "only way back is a person answering the card on the child, which is `394` §6.2 exactly",
        [(TOOLS, "  'list_questions',\n", "")],
    ),
    (
        "M11 · 🔴 the reader hands back IDS and no words · the parent learns a question exists and "
        "still cannot answer it, because `answer_question` takes one entry per PART and the parts "
        "are on the request — a reader that names a thing nobody can act on · killed by `nothing-waits-on-somebody-looking.test.ts` (named by W4.139)",
                # ⚑ **474 · the memo became `oneQuestionReadPerAnswer`**, which a second reader
                # needed; the lookup, the rule and this row's target are unchanged.
        # ⚑ Landing D-017 (3d295083) · re-anchored in place, not retired — The reader's body was
        # restructured to route through readOrSkip (D-017's per-conversation skip net), but its job
        # is unchanged: look up the asker's question and hand back its words. Collapsing it to
        # always return `{ request, words: null }` still plants 'the parent learns a question exists
        # and cannot answer it' exactly as the original row intended.
        # ⚑ Landing D-016c commits 6–7 and D-022 (4a7f0fec, c1a79abe, 37228461) · re-anchored in
        # place, not retired — The rule survives: the reader that lists a parent's waiting questions
        # must hand back their words, or the parent knows a question exists and cannot answer it.
        # The body now routes through `readOrSkip` (D-017 outer net), and the plant collapses it to
        # always return `{ request, words: null }`. Killed by
        # `nothing-waits-on-somebody-looking.test.ts`, `the-five-tools.test.ts`.
        [
            # ⚑ **W4.136 · re-anchored in place, not retired** — F033: the reader also hands back what its line calls the asker, by the piece the question was asked under, and names a wordless one only when it is wordless; the plant still collapses every question to no words
            (HOST, "      const read = readOrSkip(request.askedBy, unread?.in(request.askedBy), null, () => {\n        const asked = raised(request.askedBy).get(request.requestId)\n        if (asked === undefined) return null\n        const asker = askerOf(request.askedBy, asked.piece)\n        return {\n          request,\n          words: questionText(asker, { ...asked, id: request.requestId }),\n          askerCalled: asker.called,\n        }\n      })\n      // 🔴 **D-017 · R8 — the outer net**: words the asker's record cannot give are absent, and a\n      // counted answer says it skipped that record.\n      return read ?? { request, words: null, askerCalled: askerOf(request.askedBy, null).called }\n", "      return { request, words: null, askerCalled: askerOf(request.askedBy, null).called }\n"),
        ],
    ),
    (
        "M12 · 🔴 the words are handed back for a request the parent may NOT answer · a secret a "
        "person was asked to type, and on Codex a grant of access, reach an AGENT as prose — the "
        "narrowing `394` made structural, removed at the one door that reads the text · killed by `nothing-waits-on-somebody-looking.test.ts` (named by W4.139)",
        [
            (
                HOST,
                # ⚠️ **611 · CORRECTED IN PLACE, never retired** — `to` + `because` became one
                # union (HO-088 §2). The row's subject is unchanged; only the spelling moved.
                # ⚑ **W4.136 · re-anchored in place, not retired** — F033: the refused arm also hands back what its line calls the asker; the plant still removes the gate, so a request the parent may not answer reaches it as prose
                "      if (request.went.is === 'the-person-the-channel-left-it-with') {\n        return { request, words: null, askerCalled: askerOf(request.askedBy, null).called }\n      }\n",
                "",
            )
        ],
    ),
    (
        "M13 · ⚠️ the reader FILTERS the permission-shaped rows out · the refusal "
        "`a-person-answers-this-one` becomes unreachable and `permissionShaped` reports zero for "
        "ever, honestly and wrongly — `394` §2's anti-filter property, undone by a reader instead "
        "of by the gate it was written about",
        [
            # ⚠️ **RE-ANCHORED at 675, not retired.** The reader now lists one entry per question (675 §2, 661 F2), reading the rows in a loop; The DEFECT this row plants is unchanged.
            (
                HOST,
                # ⚑ 676 · anchor CORRECTED again, not retired: the loop's read takes `list_questions`'
                # unread set.
                '    for (const one of this.questionsVisibleTo(sessionId, unread)) {',
                '    for (const one of this.questionsVisibleTo(sessionId, unread).filter((row) => row.because === null)) {',
            ),
        ],
    ),
    (
        "M14 · ⚠️ the line drops what `stranded` MEANS · a model reads a word that could as easily "
        "mean its child has gone away, and the right move — ask that conversation again — is the "
        "one it will not make",
        [
            (
                TOOLS,
                # ⚑ **Re-anchored in place by `397`** (142's rule): the sentence moved out of a
                # ternary and into `QUESTION_STATE_SENTENCE`, because a SECOND state now needs one.
                # ⛔ The row still removes what `stranded` means and touches nothing else — dropping
                # the key leaves the word printed bare, which is exactly the old replacement's effect.
                "  stranded:\n"
                "    'the app restarted while it was waiting — that conversation is still there, ask it again',\n",
                "",
            )
        ],
    ),
    (
        "M15 · ⛔ the PM is never told the reader exists · the tool ships and nothing instructs the "
        "one role that receives questions to look at it, so a question raised while a parent was "
        "down waits for a model to guess — `393`'s precedent, unmet",
        [
            # ⚑ **RE-ANCHORED at `628`**: the line was EXTRACTED into
            # `ANSWER_WHAT_YOUR_AGENTS_ASKED` when `HO-095` §3.1 put the same rule on BroBot too
            # (`402`'s *a rule made at one of two depths is a rule nobody can rely on*).
            # ⛔ **CORRECTED, not retired** — the subject is *the PM is never told the reader
            # exists* and it is exactly where it was; what moved is that the words now live in a
            # constant two tiers share. ⚠️ **Anchored on the PM's USE with the comment above it**,
            # because there are two use sites now and the other is BroBot's — a bare
            # `ANSWER_WHAT_YOUR_AGENTS_ASKED,` would match twice
            # (`a-file-level-contains-cannot-tell-sibling-declarations-apart`).
            # ⚑ Re-verified RED by hand against `the-text-a-child-is-actually-told.test.ts`.
            # ⚑ **T-002 · re-anchored in place, not retired** — PE-003 put the sentence in the one
            # set every agent reads, so it has one use site again. The row still takes it away,
            # from every agent that receives questions. Re-verified RED alone.
            # ⚑ **W4.481 · re-homed onto the skill that carries the rule, not retired** — the v6 core leaves this rule to the ask-and-wait skill, so the plant takes the sentence that names the reader there. NOT VERIFIED. Killed by `built-in-skills-rules.test.ts`.
            (
                ASK_AND_WAIT,
                # ⚑ **W4.643 · re-anchored in place, not retired** — NOT VERIFIED; source-only. v21 rewrote the sentence this row's defect lives in; the same defect, applied to the v21 sentence that carries it
                "Use list_questions for questions awaiting your answer; your own questions may appear in the turn block or on the work piece.",
                "",
            )
        ],
    ),
]
