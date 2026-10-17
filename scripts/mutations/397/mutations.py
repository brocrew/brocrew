"""397 · the word for a question nobody stopped — each row is THE DEFECT, put back (131).

🔴 **One subject: an interruption kills every open card and writes nothing about any of them.**

Both adapters call `settleRequests()` inside `interrupt()`; `RequestBroker.settleAll` safe-rejects
every pending request — a permission as `{outcome:'deny'}`, a question as `{kind:'reject'}` — and
emits no `user_decision`, no `request_resolved` and no row of any kind. ⛔ So a routed request went on
reading `open`: *nobody has ended this*, about a thing this app had just ended.

⚠️ **And `396`'s launch sweep did not repair it, it MISLABELLED it.** A row still open at the next
launch is closed `stranded` — *the app had stopped* — and the app had not stopped: somebody pressed
Stop and it kept running. ⚑ `M9` is that wrong word, put back as code.

## 🔴 Which gate can see each row

| rows | the defect is caught by |
|---|---|
| `M1`-`M6`, `M15`, `M16` | ⚑ **`run_suite`** — `apps/desktop/test/the-word-for-a-question-nobody-stopped.test.ts` §1-§4, §7 |
| `M7`-`M10`, `M12` | ⚑ **`run_suite`** — the same file's §1, §5, §6, §7, and `a-question-finds-a-person.test.ts` §4 |
| `M11` | ⚑ **`run_suite`** — the same file's §5 and `a-question-finds-a-person.test.ts` §6's fold-vs-select census |
| `M13`, `M14` | ⚑ **`run_suite`** — the same file's §1 |

## ⛔ What this table deliberately does NOT contain

⛔ **No row moving the endings from `askTheWorkToStop` into `settleRequests` on either adapter.** The
adapter knows a card was settled; only the app knows the card was a ROUTED REQUEST, and `settleAll`
is also called by `close()` and by `finishUnexpected`, whose endings are `abandoned`. ⚑ A row there
would be a different repair rather than this one broken, and `§7`'s census pins the runtime package
never naming the event at all.

⛔ **No row flipping the fold to close on `work_interrupted` instead.** ⚠️ **It would record as a
survivor and it would mean nothing**: `selectRoutedRequestEvents` does not select that type, so every
reader that goes through the store — which is every reader — folds a ledger the row is absent from.
⚑ *A mutation whose replacement changes no answer is a phantom.* The design decision it would test is
`M6` instead, which puts the endings where that fold would have put them: on `endAgent` as well.

⛔ **No row on `admitInterrupt`'s `a-person-is-being-asked`.** `395` owns that rail and this dispatch
reads it; §3 measures that it is what keeps an AGENT from reaching a card, with the control one fact
over, and breaking it here would be re-testing `395`'s table from `397`'s.

⛔ **No row on `settleStrandedRequests`.** `396` owns it. What `397` changes about it is that it now
finds nothing to do after an interruption, which is `M1`'s consequence and is asserted in §5.

## ⚑ Why `M4` is a row at all, when the fold makes it harmless

⚠️ **`settle` is a no-op for a row that is already closed**, so writing an ending for a CLOSED request
moves no state — and that is exactly why it needs a row. ⛔ The damage is in the LEDGER: one
`request_interrupted` per already-answered question per interruption, for ever, and a reader
enumerating what an act destroyed would list questions somebody answered days ago. ⚑ It is caught by
the idempotence test, which is a claim about rows written and not about states derived.
"""

HOST = "apps/desktop/src/main/runtime/runtime-host.ts"
FOLD = "apps/desktop/src/shared/questions.ts"
STORE = "apps/desktop/src/main/db/session-store.ts"
TOOLS = "apps/desktop/src/main/runtime/agent-tools.ts"

# ⛔ **The whole loop, anchored on its own three code lines and never on the paragraph above it.**
# The comment that argues *"the FOLD decides which are still open"* sits between `recordTheAsk` and
# the loop, and an anchor spanning it dies the next time somebody edits a comment
# (`a-source-census-that-pins-a-line-kills-every-row-on-it`).
# ⚑ **W4.78 · re-anchored in place, not retired** — ec9ac862 added the `raised` skip inside the loop
# (a stop that only makes way for words keeps this app's own questions open).
THE_LOOP = (
    "    for (const request of this.deps.store.routedRequestsOf(session.id)) {\n"
    "      if (!REQUEST_IS_OPEN[request.state]) continue\n"
    "      if (raised?.get(request.requestId)?.raisedBy === 'this-app') continue\n"
    "      this.publishOurs(session, { type: 'request_interrupted', requestId: request.requestId })\n"
    "    }\n"
)

MUTATIONS: list[tuple[str, list[tuple[str, str, str]]]] = [
    # ── §1 · the ending is written where the act happens ───────────────────────────────────────
    (
        "M1 · 🔴 the interruption writes NO ending · every routed request the stop threw away goes "
        "on reading `open`, `list_questions` offers a parent a question that was safe-rejected to "
        "the provider minutes ago, and the next launch closes it `stranded` — the residue `396` §7 "
        "reported, restored exactly · killed by `the-word-for-a-question-nobody-stopped.test.ts` (named by W4.78)",
        # ⚑ **source-restoration · re-anchored in place, not retired** — NOT VERIFIED; source targeting only. 13e975809 added the earlier-turn app-question exemption; omit the ending loop without changing that exemption.
        [(HOST, "    for (const request of this.deps.store.routedRequestsOf(session.id)) {\n      if (!REQUEST_IS_OPEN[request.state]) continue\n      if (raised?.get(request.requestId)?.raisedBy === 'this-app') continue\n      if (leftOpen?.has(request.requestId) === true) continue\n      this.publishOurs(session, { type: 'request_interrupted', requestId: request.requestId })\n    }\n", "")],
    ),
    (
        "M2 · ⛔ only the FIRST open request gets an ending · `settleAll` kills every card and this "
        "records one, so a conversation parked on two questions has one closed and one left saying "
        "nobody has ended it — the defect standing rule 12 exists to catch, on the reader that "
        "enumerates what an act destroyed",
        [
            (
                HOST,
                "      this.publishOurs(session, { type: 'request_interrupted', requestId: request.requestId })\n"
                "    }\n",
                "      this.publishOurs(session, { type: 'request_interrupted', requestId: request.requestId })\n"
                "      break\n"
                "    }\n",
            )
        ],
    ),
    (
        "M3 · 🔴 the endings are written AFTER the provider answers · Codex's `interrupt()` awaits "
        "its `turn/interrupt` answer UNBOUNDED, so an app-server that never answers leaves the rows "
        "unwritten for ever (709 corrected *accepts the RPC and never completes*) — on exactly the "
        "session somebody is trying to "
        "explain, and `395` wrote the ask above this line for this reason · killed by `the-word-for-a-question-nobody-stopped.test.ts` (named by W4.78)",
        [
            (
                HOST,
                # ⚑ **W4.78 · re-anchored in place, not retired** — ec9ac862 made the signature multi-line (keepsWhatThisAppAsked) with a `raised` read before the ask; the plant still makes it async and awaits the provider right after the ask, before the endings. Edit 1 removes the trailing return. Killer: §4 'a provider whose interrupt() NEVER returns still gets its questions ended'.
                # ⚑ **source-restoration · re-anchored in place, not retired** — NOT VERIFIED; source targeting only. Keep the original move of interrupt before writing endings; the unchanged signature anchor still matches once.
                "  private askTheWorkToStop(\n    session: HostedSession,\n    by: Caller,\n    /** Questions this app asked for it stay open: the stop only makes way for words to it. */\n    keepsWhatThisAppAsked = false,\n  ): Promise<void> {\n    const raised = keepsWhatThisAppAsked ? this.deps.store.questionsRaisedIn(session.id) : null\n    this.recordTheAsk(session, by)\n",
                "  private async askTheWorkToStop(\n    session: HostedSession,\n    by: Caller,\n    /** Questions this app asked for it stay open: the stop only makes way for words to it. */\n    keepsWhatThisAppAsked = false,\n  ): Promise<void> {\n    const raised = keepsWhatThisAppAsked ? this.deps.store.questionsRaisedIn(session.id) : null\n    this.recordTheAsk(session, by)\n    await session.handle.interrupt()\n",
            ),
            # ⚑ **source-restoration · re-anchored in place, not retired** — NOT VERIFIED; source targeting only. 13e975809 added the earlier-turn exemption; preserve it in the ending loop after the moved interrupt.
            (HOST, "    for (const request of this.deps.store.routedRequestsOf(session.id)) {\n      if (!REQUEST_IS_OPEN[request.state]) continue\n      if (raised?.get(request.requestId)?.raisedBy === 'this-app') continue\n      if (leftOpen?.has(request.requestId) === true) continue\n      this.publishOurs(session, { type: 'request_interrupted', requestId: request.requestId })\n    }\n    return session.handle.interrupt()\n", "    for (const request of this.deps.store.routedRequestsOf(session.id)) {\n      if (!REQUEST_IS_OPEN[request.state]) continue\n      if (raised?.get(request.requestId)?.raisedBy === 'this-app') continue\n      if (leftOpen?.has(request.requestId) === true) continue\n      this.publishOurs(session, { type: 'request_interrupted', requestId: request.requestId })\n    }\n"),
        ],
    ),
    (
        "M4 · ⚠️ an ending is written for requests that ALREADY ENDED · the fold ignores them, so no "
        "state moves and nothing looks wrong — while every interruption appends one row per "
        "answered question for ever, and a reader enumerating what the stop destroyed lists "
        "questions a parent answered days ago · killed by `the-word-for-a-question-nobody-stopped.test.ts` (named by W4.78)",
        [
            (
                HOST,
                # ⚑ **Re-anchored in place by `591`** (142's rule). ⛔ The bare predicate stopped
                # being unique the moment `RuntimeHost.endTheQuestionsAbout` needed the same
                # question — *is this one still somebody's to answer* is `396`'s rule and every
                # writer of an ending asks it — so the anchor now carries the `publishOurs` beneath
                # it, which is this row's own subject. ⚠️ The row is unchanged and was re-verified
                # RED individually.
                # ⚑ **W4.78 · re-anchored in place, not retired** — ec9ac862 inserted the this-app skip between the open check and the publish; the plant drops only the REQUEST_IS_OPEN guard. Killer: §1 'a SECOND interruption over a repaired ledger changes nothing' counts request_interrupted rows (1).
                "      if (!REQUEST_IS_OPEN[request.state]) continue\n      if (raised?.get(request.requestId)?.raisedBy === 'this-app') continue\n",
                "      if (raised?.get(request.requestId)?.raisedBy === 'this-app') continue\n",
            )
        ],
    ),
    (
        "M5 · 🔴 the FOURTH door goes back to a bare provider call · `runSendInterrupting` — *type "
        "while it is working*, the most ordinary interruption in the app — stops the turn, records "
        "no ask and ends no question, which is precisely the door `395`'s *“exactly ONE place "
        "records the ask”* census counted three of and missed",
        # ⚑ **Re-anchored in place by `709`** — the door now races the ask against
        # `interruptWaitMs` (`704` H-8) instead of awaiting it; the six-space `const asked` is this
        # door's alone, and going back to a bare provider call is the same defect.
        [
            (
                HOST,
                "      const asked = this.askTheWorkToStop(session, by)\n",
                "      const asked = session.handle.interrupt()\n",
            )
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-017, 5206d835):** The row's premise is a teardown that
        # BOTH stops a turn AND ends the conversation, where the open routed requests should read
        # `abandoned` (an ending) rather than `interrupted` (resumable) — exactly the `end_agent`
        # teardown, which `RequestState.interrupted`'s own current docblock says outright:
        # "end_agent, until D-017, recorded the ask and never wrote this ending."
        # `askTheWorkToStop`'s `request_interrupted` loop is now reached only by true interrupts
        # (person's Stop, interrupt-and-send, `interrupt_agent`) that never end the conversation, so
        # writing `interrupted` there is now simply correct — there is no more call site where this
        # loop runs inside an ending. Its anchor is left stale, so the census records it retired.
        "M6 · ⛔ `endAgent` writes the endings too · a teardown ENDS the conversation, so its open "
        "questions are `abandoned`; labelling them `interrupted` tells a parent *that conversation "
        "is still there, ask it again* about a conversation that no longer exists — the design this "
        "dispatch rejected, put back",
        [
            (
                HOST,
                "    if (slot.session !== null) this.recordTheAsk(slot.session, by)\n",
                "    if (slot.session !== null) {\n"
                "      this.recordTheAsk(slot.session, by)\n"
                "      for (const request of this.deps.store.routedRequestsOf(slot.session.id)) {\n"
                "        if (!REQUEST_IS_OPEN[request.state]) continue\n"
                "        this.publishOurs(slot.session, {\n"
                "          type: 'request_interrupted',\n"
                "          requestId: request.requestId,\n"
                "        })\n"
                "      }\n"
                "    }\n",
            )
        ],
    ),
    # ── §2 · the fold that reads it ────────────────────────────────────────────────────────────
    (
        "M7 · 🔴 the fold cannot SEE the ending · the rows are written at every stop and the state "
        "never moves, so the repair is invisible to every surface and the ledger grows one row per "
        "interruption that nothing ever reads — the shape `379` calls a write nobody reads",
        # ⚠️ **The branch is KEPT and emptied**, rather than deleted: a fold with no branch for a
        # type in the union is a TYPE error on some shapes and would go red for the wrong reason,
        # and an anchor spanning the branch would have to cross the docblock inside it.
        [
            (
                FOLD,
                "      settle(event.requestId, 'interrupted', entry.at)\n      continue\n",
                "      continue\n",
            )
        ],
    ),
    (
        "M8 · ⛔ folded as `abandoned` · a parent is told the conversation ENDED underneath its "
        "question, so it stops asking a child that is idle and waiting for something to do — the "
        "word `396` chose `stranded` over for the same reason, one act along",
        [
            (
                FOLD,
                "      settle(event.requestId, 'interrupted', entry.at)",
                "      settle(event.requestId, 'abandoned', entry.at)",
            )
        ],
    ),
    (
        "M9 · 🔴 folded as `stranded` · the row claims THE APP STOPPED about a session somebody "
        "pressed Stop in and which is still running, which is the wrong word `396`'s launch sweep "
        "would have given it — and a reader is sent looking for a crash that never happened",
        [
            (
                FOLD,
                "      settle(event.requestId, 'interrupted', entry.at)",
                "      settle(event.requestId, 'stranded', entry.at)",
            )
        ],
    ),
    (
        "M10 · ⛔ `interrupted` counts as still somebody's to answer · `list_questions` says a "
        "question is waiting on a parent when the provider was told *no* on that parent's behalf, "
        "and `admitAnswer` admits an answer that can only bounce off the adapter — *nothing unwired "
        "implies a working state*, which is the rule this ending exists to keep",
        [(FOLD, "  interrupted: false,\n", "  interrupted: true,\n")],
    ),
    (
        "M11 · ⛔ the store's narrow read does not SELECT the ending · the fold branches on a type "
        "the reader never hands it, so the ending is written and then invisible — and the launch "
        "sweep, finding the request still open, closes it `stranded` at the next start",
                # ⚑ **Re-anchored in place by `398` and again by `591`** — `398` added
                # `request_escalated` between this type and `status`, and `591` added
                # `request_work_withdrawn` beside it and wrapped `status` onto its own line.
                # ⛔ The row is unchanged: it removes `request_interrupted` and nothing else.
                # Re-verified RED individually each time.
                # ⚑ **T-003 · re-anchored in place, not retired** — D-009 appended two question types after this line; the row still drops `request_interrupted`. Re-verified RED alone.
        # ⚑ Landing D-016b (5e931be8, the tree) · re-anchored in place, not retired — The rule
        # survives: the routed-request read must select the interruption ending, or the ending is
        # written and then invisible and the launch sweep closes the request as stranded. The plant
        # drops `'request_interrupted'` from the `selectRoutedRequestEvents` outer list. The
        # single-line anchor occurs once in the file. Killed by `a-question-finds-a-person.test.ts`,
        # `the-question-every-teardown-asks.test.ts`.
        # ⚑ Landing D-016c (72b78a37, the giver's verbs) · re-anchored in place, not retired — The
        # rule holds: a question interrupted by an ending must still be read from the ledger. The IN
        # list in selectRoutedRequestEvents now carries work_closed after work_taken_back, so the
        # old line-end anchor no longer matches but the line exists once. The plant drops
        # request_interrupted, and an interrupted question reads as still open after a replay.
        # Killed by `a-question-finds-a-person.test.ts`, `the-question-every-teardown-asks.test.ts`,
        # `the-word-for-a-question-nobody-stopped.test.ts`.
        [
            # Source-only NOT VERIFIED: omit the same ending from the shared replay selection list.
            (STORE, "  'request_stranded',\n  'request_interrupted',\n  'work_taken_back',\n", "  'request_stranded',\n  'work_taken_back',\n"),
        ],
    ),
    (
        "M12 · ⚠️ the fold closes EVERY open request rather than the one the row names · one "
        "interruption in a conversation that raised three questions and answered two closes rows "
        "the act never touched, and an id that belongs to another life closes a live one — the "
        "difference between an ending and a broadcast",
        [
            (
                FOLD,
                "      settle(event.requestId, 'interrupted', entry.at)",
                "      for (const id of [...open.keys()]) settle(id, 'interrupted', entry.at)",
            )
        ],
    ),
    # ── §3 · what a parent is actually told ────────────────────────────────────────────────────
    (
        "M13 · ⛔ the line drops the sentence · a parent reads the bare word `interrupted` and has "
        "no way to know the conversation is still there and can be asked again — `396`'s ruling for "
        "`stranded`, and a word cannot carry it either",
        [
            (
                TOOLS,
                # ⚑ **Re-anchored in place by `709`** (R43): the sentence says the ASK now, in
                # `ASKED_TO_STOP`'s words; the row still drops it.
                "  interrupted: `the work it was raised in was ${ASKED_TO_STOP}, so it was never answered — that conversation is still there, ask it again`,\n",
                "",
            )
        ],
    ),
    (
        "M14 · 🔴 the line NAMES an actor · *“a person stopped it”* is false whenever an agent did — "
        "and it is as often the reading agent's own `interrupt_agent` — which is `222`'s shipped "
        "false sentence reappearing in a tool payload after `395` spent a dispatch removing it",
        [
            (
                TOOLS,
                # ⚑ **Re-anchored in place by `709`** (R43) — the same actor, planted in the new words.
                "`the work it was raised in was ${ASKED_TO_STOP}, so it was never answered",
                "`a person stopped the work it was raised in, so it was never answered",
            )
        ],
    ),
    # ── §4 · the actor, and the neighbour ordering that carries it ─────────────────────────────
    (
        "M15 · 🔴 the ask is not recorded · the endings say a question was thrown away and NOTHING "
        "in the ledger says who threw it, so the Sessions row reads *it was stopped, and this ledger "
        "does not say by whom* about a stop this app performed and knew the author of · killed by `the-word-for-a-question-nobody-stopped.test.ts` (named by W4.78)",
        # ⚑ **W4.78 · re-anchored in place, not retired** — ec9ac862 put the `raised` read between the (now multi-line) signature and the ask; the plant drops only the recordTheAsk call. Killer: §7 'the ROWS are neighbours' expects the work_interrupted row to exist.
        [(HOST, "    const raised = keepsWhatThisAppAsked ? this.deps.store.questionsRaisedIn(session.id) : null\n    this.recordTheAsk(session, by)\n", "    const raised = keepsWhatThisAppAsked ? this.deps.store.questionsRaisedIn(session.id) : null\n")],
    ),
    (
        "M16 · ⚠️ the ask is written AFTER the endings · *what happened* and *who did it* stop being "
        "neighbouring rows at consecutive ordinals, so a reader that joins them has to search — and "
        "the claim that the word never needs to name an actor rests on that adjacency · killed by `the-word-for-a-question-nobody-stopped.test.ts` (named by W4.78)",
        [
            (
                HOST,
                # ⚑ **W4.78 · re-anchored in place, not retired** — ec9ac862 put the `raised` read between the (now multi-line) signature and the ask; edit 0 drops the ask at the top, edit 1 re-inserts it after the endings. Killer: §7 'the ROWS are neighbours' (endings at ask.ordinal+1, +2).
                # ⚑ **source-restoration · re-anchored in place, not retired** — NOT VERIFIED; source targeting only. Keep removal of the ask before the endings; this first edit still matches once.
                "    const raised = keepsWhatThisAppAsked ? this.deps.store.questionsRaisedIn(session.id) : null\n    this.recordTheAsk(session, by)\n",
                "    const raised = keepsWhatThisAppAsked ? this.deps.store.questionsRaisedIn(session.id) : null\n",
            ),
            (
                HOST,
                # ⚑ **source-restoration · re-anchored in place, not retired** — NOT VERIFIED; source targeting only. 13e975809 added the earlier-turn exemption; preserve it while moving only the ask after the endings.
                "    for (const request of this.deps.store.routedRequestsOf(session.id)) {\n      if (!REQUEST_IS_OPEN[request.state]) continue\n      if (raised?.get(request.requestId)?.raisedBy === 'this-app') continue\n      if (leftOpen?.has(request.requestId) === true) continue\n      this.publishOurs(session, { type: 'request_interrupted', requestId: request.requestId })\n    }\n    return session.handle.interrupt()\n",
                "    for (const request of this.deps.store.routedRequestsOf(session.id)) {\n      if (!REQUEST_IS_OPEN[request.state]) continue\n      if (raised?.get(request.requestId)?.raisedBy === 'this-app') continue\n      if (leftOpen?.has(request.requestId) === true) continue\n      this.publishOurs(session, { type: 'request_interrupted', requestId: request.requestId })\n    }\n    this.recordTheAsk(session, by)\n    return session.handle.interrupt()\n",
            ),
        ],
    ),
]
