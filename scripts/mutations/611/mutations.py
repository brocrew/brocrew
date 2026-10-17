"""611 · A question names who it is for — the recipient, the union, and the hop that carries words.

⛔ **The ruling is `HO-088` §2 and it is one sentence:** *"A question carries its recipient. The
app routes what the agent DECLARED and infers nothing."*

## 🔴 What this dispatch ADDED and what it REMOVED, because that decides what these rows kill

⚑ **Three things landed together and each is a different kind of guard.**

 - ⚠️ **A DECLARATION.** `ask_parent` became `ask_question` with a required `who_answers`, and the
   app defaults it nowhere. ⛔ The rows for it are about what happens when the app decides
   instead — which is the shape `HO-088` §2.2 ruled against by name.
 - ⚠️ **A SHAPE.** `RoutedRequest.to` + `.because` became one three-armed union, because every
   reader in this app spelled *the parent's* as `because === null` and `HO-088` §2 makes that
   wrong about the first row it meets. ⛔ **A mutation cannot express *this was two fields*** — the
   census in `a-question-names-who-it-is-for.test.ts` §2 guards that — so the rows here restore
   the READINGS the old spelling would have given.
 - ⚠️ **A VERB.** `pass_question_up` carries a child's question one hop further. ⛔ Its whole
   ruling is that the words are not an argument, so its rows are about the words changing.

## ⛔ A · the declaration, which is the whole of §2

⚑ **`M1` is the sharpest row in the table.** ⚠️ It does not refuse anything and it does not
crash: the call succeeds, the worker is told its question was routed, and the app quietly sent it
to the parent instead of to the person the agent named. ⛔ **That is `HO-088` §1's four hops
restored with a green test suite over them.**

⚠️ **`M2` is the same defect one window later.** A question already addressed to a person is
handed to the parent as well AND armed with a deadline — so the parent is summoned about a
question it was not asked, and thirty seconds later the ledger records that it failed to answer
one.

## 🔴 B · the two readers that decide whose a question is

⛔ **`M3` and `M4` are the two halves of `HO-090` §4's *same queue item*, and they fail in
OPPOSITE directions.** ⚠️ `M3` lets the deadline stamp a row that was a person's from birth;
`M4` leaves that row in no population at all — not the question queue, not the decision queue —
which is the hole this dispatch exists to close. ⚑ Neither is visible as an error: both produce a
person's queue that simply says less than it should.

## ⚠️ C · the union's own arms

⛔ **`M5`, `M6` and `M7` restore the three readings the old `because === null` spelling gave.**
⚑ `M7` is the one that matters most for the census: `permissionShaped` is criterion 10's
INSTRUMENT, and widening it to `to === 'a-person'` makes *"has anything permission-shaped arrived
here?"* start answering yes about ordinary questions — which is
`a-filter-can-blind-the-instrument-that-justifies-it` pointed the other way.

## 🔴 D · the hop, and the words it may not change

⛔ **`M8` is `HO-088` §3.1 undone in one expression**: the passer's own context replaces the
asker's question. ⚠️ **`M9` loses it entirely** — the context is dropped, which is the other way a
hop can lie about what it added. ⚑ **`M10` deletes the JOIN** that makes *the original words
travelled* checkable at all.

⚠️ **`M11` is the silent redirect.** A conversation nothing spawned asks to pass a question to its
parent and the app sends it to a person instead — *"the app routes what the agent declared and
infers nothing"*, broken in the direction that looks helpful.

## ⛔ E · the sentences

⚑ **`M12` merges the direction line into the sender line**, which is `439`'s argument at this
venue: a reader that learns two facts as one string cannot tell which half went missing.
⚠️ **`M13` takes the line off the person's arm only**, so the agent arm keeps it — the shape a
one-sided sweep leaves behind.

## ⛔ What has NO row, said rather than left out

⚠️ **No row on the RENAME.** `ask_parent` → `ask_question` is a name, and a mutation that renamed
it back would fail to compile everywhere rather than measure anything — which is not a test.
⚑ The roster census in `the-five-tools.test.ts` is what guards it.

⚠️ **No row on the two new RAILS' permanence or remedy.** `425`'s biconditional is walked over
every vocabulary by `a-refusal-carries-its-remedy.test.ts`, which already fails if either row's
`permanence` and `remedy` stop agreeing — a row here would measure that table.

⚠️ **No row on `ESCALATION_WINDOW_MS`.** `HO-088` §3.1 removes it and that is `612`'s; nothing
here turns on the number, and a row that changed it would measure `398`'s table.

⛔ **No row restoring the old `to` + `because` PAIR.** It is four files of edits and what it
would measure is whether the compiler is on.
"""

from __future__ import annotations

HOST = "apps/desktop/src/main/runtime/runtime-host.ts"
STORE = "apps/desktop/src/main/db/session-store.ts"
QUESTIONS = "apps/desktop/src/shared/questions.ts"
RAILS = "apps/desktop/src/main/runtime/question-rails.ts"
ORIGIN = "apps/desktop/src/main/runtime/turn-origin.ts"
DIGEST = "apps/desktop/src/main/runtime/digest.ts"

MUTATIONS: list[tuple[str, list[tuple[str, str, str]]]] = [
    # ── A · the declaration ────────────────────────────────────────────────────────────────────
    (
        "M1 · 🔴 **the app decides where a question goes** · the routing row records `the-parent` "
        "whatever the asker declared, and the call still answers `ok`. ⛔ `HO-088` §2: *the app "
        "routes what the agent DECLARED and infers nothing* — and this is the failure the PO "
        "described by name, with a success payload over it: Ali's question for the person goes to Ada, "
        "who cannot answer it, which is the four hops `HO-088` §1 watched",
                # ⚑ **T-003 · re-anchored in place, not retired** — D-009 writes `parent: answerer` beside it; the row still records `the-parent` whatever was declared. Re-verified RED alone.
        # ⚑ Landing D-016b (5e931be8, the tree) · re-anchored in place, not retired — raiseAQuestion
        # still writes request_routed with to: went, where went is what the asker declared (or
        # a-person for a root's the-parent). The plant records 'the-parent' whatever was declared,
        # so a question addressed to a named person is logged as going to the parent. Killed by
        # `a-question-names-who-it-is-for.test.ts`.
        [
            (HOST, "      to: went,\n      // ⚑ **611 · omitted when there is none** — a root's question, which no conversation gave.\n", "      to: 'the-parent',\n      // ⚑ **611 · omitted when there is none** — a root's question, which no conversation gave.\n"),
        ],
    ),
    (
        "M2 · ⛔ **an addressed question summons the parent AND arms a deadline** · the guard that "
        "says *deliver upward only when upward is where it is going* is opened. ⚠️ The parent gets "
        "a turn about a question it was not asked, and one window later the ledger records "
        "`request_escalated` — *a parent did not answer in time* about a parent nobody asked. ⚑ It "
        "is the shape `escalationsDue`'s own skip exists to prevent, reached from the writer end",
        # ⚑ **T-003 · re-anchored in place, not retired** — D-009 widened the guard to a named agent; the row still opens it for every end. Re-verified RED alone.
        # ⚠️ **T-003's review: the label's deadline half (*arms a deadline … `request_escalated`*) is gone
        # since `612`** (`608 M3`, which deleted the arming, is retired by 612). The row plants the summons
        # half only: the parent gets a turn about a question it was not asked.
        # ⚑ Landing D-016b (5e931be8, the tree) · re-anchored in place, not retired — The delivery
        # guard still limits deliverQuestion to recipients that are the parent or an agent, so a
        # question meant for a person is never pushed into the parent's conversation. The plant
        # opens it to every recipient that has an answerer (a null-safe form, since the original 'if
        # (true)' would call deliverQuestion with a null answerer). Killed by
        # `a-question-names-who-it-is-for.test.ts`.
        [
            (HOST, "    if (answerer !== null && (went === 'the-parent' || went === 'an-agent')) {\n", '    if (answerer !== null) {\n'),
        ],
    ),
    # ── B · whose question is it ───────────────────────────────────────────────────────────────
    # ── ⛔ RETIRED BY 612, one dispatch later, and the correction was not wasted ───────────────
    #
    # 🔴 **This row guarded a skip inside `escalationsDueNow`**, and `HO-088` §3.1 deleted that
    # sweep entire — the loop, its guard, its push and its stamp. ⛔ **The subject is dead, not
    # moved**: there is no surviving line that decides which requests a deadline may stamp, because
    # no deadline stamps anything.
    #
    # ⚠️ **The RULE it carried outlived it and is measured elsewhere.** *A request that was always a
    # person's has nothing an escalation would record* is now `612 M5` at
    # `questionsAPersonMustAnswer`, which is the reader that carries the whole of criterion 10's
    # negative once the sweep's half is gone, and `611 M4` at the admission beside it.
    (
        "M3 · ⛔ RETIRED BY 612 (the sweep is deleted) · **the deadline stamps a question that was a person's from birth** · the skip "
        "narrows back to the REFUSED arm, which is exactly the `because !== null` spelling this "
        "dispatch replaced. ⛔ *A request that was ALWAYS a person's has no parent that failed to "
        "answer in time and nothing an escalation would record* — `403`'s own argument, which "
        "`HO-088` §2 gives a second population",
        [
            (
                STORE,
                "        if (request.went.to === 'a-person') continue",
                "        if (request.went.is === 'the-person-the-channel-left-it-with') continue",
            )
        ],
    ),
    (
        "M4 · ⛔ **a question addressed to a person reaches NO population at all** · the reader "
        "admits only what a deadline stamped. ⚠️ It is not in `decisionsAwaitingAPerson` either — "
        "that one selects on the channel's refusal — so the row is open, durable, listed to its "
        "parent, and invisible to the person it names. 🔴 **That hole is the whole of `HO-090` "
        "§4's *same queue item***, and this restores it",
        [
            (
                STORE,
                "              (request.escalatedAt !== null || request.went.is === 'the-person-the-asker-named') &&",
                "              request.escalatedAt !== null &&",
            )
        ],
    ),
    # ── C · the union's arms ───────────────────────────────────────────────────────────────────
    (
        "M5 · ⚠️ **the queue's age reads one clock where there are two** · an addressed question "
        "reports no instant at all, so a person's queue draws *no time recorded* over every row an "
        "agent aimed at them and sorts them last. ⛔ The ordering is criterion 17's *oldest-blocked "
        "first*, and a population that always answers `null` is a population that can never be "
        "oldest",
        [
            (
                QUESTIONS,
                "  if (request.escalatedAt !== null) return request.escalatedAt\n"
                "  return request.went.to === 'a-person' ? request.at : null",
                "  return request.escalatedAt",
            )
        ],
    ),
    (
        "M6 · 🔴 **the fold reads `to` before the refusal** · a row carrying BOTH a refusal and a "
        "recipient is read as *the asker addressed it*, which hands a permission's text to a "
        "parent and admits it to the question queue. ⛔ The order is a fail-closed choice — *a row "
        "carrying a `ChannelRefusal` is a person's whatever else it says* — and this is the one "
        "direction that costs something",
        [
            (
                QUESTIONS,
                "  if (event.because !== undefined) {\n"
                "    return { is: 'the-person-the-channel-left-it-with', to: 'a-person', because: event.because }\n"
                "  }\n"
                "  if (event.to === 'a-person') return { is: 'the-person-the-asker-named', to: 'a-person' }",
                "  if (event.to === 'a-person') {\n"
                "    return { is: 'the-person-the-asker-named', to: 'a-person' }\n"
                "  }\n"
                "  if (event.because !== undefined) {\n"
                "    return { is: 'the-person-the-channel-left-it-with', to: 'a-person', because: event.because }\n"
                "  }",
            )
        ],
    ),
    (
        "M7 · ⛔ **criterion 10's instrument starts counting questions** · `permissionShaped` "
        "widens from the arm that CARRIES a refusal to every routing aimed at a person. ⚑ *Has "
        "anything permission-shaped ever arrived here?* is the one question this fold exists to "
        "answer, and it now says yes about an ordinary question an agent addressed — "
        "`a-filter-can-blind-the-instrument-that-justifies-it`, with the blinding done by widening "
        "instead of narrowing",
        [
            (
                QUESTIONS,
                "      one.went.is === 'the-person-the-channel-left-it-with',",
                "      one.went.to === 'a-person',",
            )
        ],
    ),
    # ── D · the hop ────────────────────────────────────────────────────────────────────────────
    (
        "M8 · 🔴 **the passer's context REPLACES the question** · the words a next hop reads are "
        "the parent's summary rather than the asker's question. ⛔ `HO-088` §3.1 in one "
        "expression: *a question reworded at every hop arrives as something nobody asked*, and the "
        "row it writes claims to be a verbatim copy while being a paraphrase",
        [
            (
                HOST,
                "      passedUpFrom: request.requestId,\n      prompt: raised.prompt,",
                "      passedUpFrom: request.requestId,\n      prompt: input.context ?? raised.prompt,",
            )
        ],
    ),
    (
        "M9 · ⚠️ **the context a hop added is dropped** · the question travels verbatim and "
        "everything the passer knew about it does not. ⛔ *The parent MAY add context* is half of "
        "the same ruling, and losing it silently is what makes a chain of three hops read as one "
        "question asked three times",
        [(RAILS, "    lines.push(`Context added by the conversation that passed it on:", "    void (`")],
    ),
    (
        "M10 · ⛔ **the join is not written** · the row carries the original words and no record of "
        "where they came from. ⚑ **`passedUpFrom` is what makes *the original words travelled* "
        "CHECKABLE rather than promised** — without it a reader has two questions with the same "
        "text in two ledgers and nothing saying one is a copy of the other, which is "
        "`HO-088` §6's chain with its edge removed",
        [(HOST, "      passedUpFrom: request.requestId,\n", "")],
    ),
    (
        "M11 · 🔴 **a conversation with no parent is silently redirected to the person** · the "
        "refusal goes and the call succeeds, having sent the question somewhere the caller did not "
        "name. ⛔ **It is the most tempting version of this defect**, because the redirect is "
        "where the question was going to end up anyway — and *the app routes what the agent "
        "declared and infers nothing* is a rule about the app never choosing, not about the app "
        "choosing well",
        [
            (
                HOST,
                "    if (input.who === 'the-parent' && parent === null) {\n"
                "      return {\n"
                "        ok: false,\n"
                "        refusal: refuseQuestion('nobody-to-pass-it-up-to', { question: input.requestId }),\n"
                "      }\n"
                "    }\n",
                "",
            )
        ],
    ),
    # ── E · the sentences ──────────────────────────────────────────────────────────────────────
    (
        "M12 · ⚑ **the direction line is merged into the sender line** · one paragraph carrying "
        "who sent it and what to do about it. ⚠️ `439`'s argument at this venue: *a reader that "
        "learns the two as one string cannot tell which half went missing when one of them does* "
        "— and the sender line is the one every surface in this app quotes",
        [
            (
                ORIGIN,
                "    return withTheLine(`${A_PERSON_SENT_IT}\\n\\n${theDirectionLine('a person')}`, text)",
                "    return withTheLine(`${A_PERSON_SENT_IT} ${theDirectionLine('a person')}`, text)",
            )
        ],
    ),
    (
        "M13 · ⚠️ **the person's turn loses the direction line and the agent's keeps it** · which "
        "is the shape a one-sided sweep leaves behind (standing rule 8.1: *a sweep scoped to one "
        "audience will pass its own review*). ⛔ `HO-088` §4 says EVERY message an agent receives "
        "carries it, and the arm this removes it from is the one a person's own words arrive on",
        [
            (
                ORIGIN,
                "    return withTheLine(`${A_PERSON_SENT_IT}\\n\\n${theDirectionLine('a person')}`, text)",
                "    return withTheLine(A_PERSON_SENT_IT, text)",
            )
        ],
    ),
    (
        "M14 · ⛔ **the digest counts an addressed question as one that TRAVELLED** · so a person "
        "reading the night's summary is told a question went to a parent when it was aimed at "
        "them, and the `question-without-work` gap then asks which work it named. ⚑ `466`'s "
        "ruling one population over: *a person cannot name what happened from a count that folded "
        "two things into one*",
        [
            (
                DIGEST,
                # ⚑ **T-003 · re-anchored in place, not retired** — D-009 counts a question to a named agent as travelled; the row counts one addressed to a PERSON as travelled too. Re-verified RED alone.
                "        if (went.is === 'the-parent' || went.is === 'the-agent-the-asker-named') {",
                "        if (went.is !== 'the-person-the-channel-left-it-with') {",
            )
        ],
    ),
]
