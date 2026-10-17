"""477 · who did it — HO-029 §2, and the actor that had been computed and thrown away.

⛔ **What this table is aimed at.** `463` measured the digest saying *"1 request was answered by a
person"* about a question a parent AGENT had answered; `465` narrowed the sentence because the row
did not know; `477` makes the row know. ⚑ Every rule it adds is one a mutation can delete without
breaking a type, and they fall into five groups:

 1. **The DERIVATION.** ⛔ `whoDidIt` asks three POSITIVE questions of the caller and names the
    residue. `M2` is the defect row: it turns the person arm into a fall-through, which is `413`
    §3's measured mistake — *"the dangerous default is the one that credits a person with words
    they never wrote"* — and is how `recordTheAsk` still spells the same question one row over.
    `M1` loses the app arm, `M3` writes the `agent:` caller id where a session id belongs.
 2. **The WRITE, at every door.** 🔴 HO-029 §2.1: *recorded by whoever performs the act, at the
    moment it happens.* ⛔ Seven doors write an actor and `M4`–`M10` delete it at one door each,
    because one failure is not the failure shape: the field surviving at four of five answer doors
    is a ledger that answers *unknown* for whichever door a reader happens to hit. `M11` is the
    eighth writer, the launch sweep, which is the one place *the app itself* is the actor.
 3. **The SENTENCE, and the discontinuity HO-029 §2.2 refuses to smooth.** ⛔ `M14` retires `465`'s
    sentence, which is the ruling read backwards — old rows must go on saying *nothing records
    who* for ever. `M12` counts the absence off the GROUP instead of the silent rows, so a mixed
    window lends one row's silence to a row that names somebody. `M13` and `M16` stop naming the
    actor at all; `M15` folds the absent arm into the counter and invents a person for it.
 4. **The VOCABULARY.** ⛔ `M17` drops the replayed-word guard so a build one vocabulary behind
    prints `undefined` into a sentence about somebody's project. `M18` makes *no row records this*
    read as *a person*. `M19` prints the word where the conversation belongs. `M20` gives the app
    arm a SECOND literal, which is the `a-mutation-that-changes-nothing` hazard inverted: one
    spelling in the tree is what makes a mutation on it visible to every writer.
 5. **The RAW STREAM.** ⚑ `M21` and `M22` take the actor back off the two Events-tab lines — the
    one surface that draws the answering CONVERSATION rather than its kind.

⚠️ **What this table deliberately does NOT contain.**

 - ⛔ **No row on `answer_question`'s `satisfies` device.** Removing it leaves valid code that every
    assertion still passes, and adding an actor argument with it in place does not COMPILE — so
    neither direction is a measurement (`472` M22's lesson). ⚑ It is a build-time rail and the
    table says so here rather than carrying a row nothing can kill.
 - ⛔ **No row on `ActedBy`'s union arms.** `{who:'a-person', agent}` and a bare `{who:'an-agent'}`
    are both compile errors, held by `@ts-expect-error` with a construction that still works
    beside them.
 - ⛔ **No row aimed at `WHO_DID_IT`'s membership.** Deleting a member is a compile error at
    `WHO_DID_IT_SAYS`, which is the point of an exhaustive `Record`.
 - ⛔ **No row on `work_interrupted`'s negative test.** `477` reports it and does not repair it: a
    two-member vocabulary has nowhere honest to put the residue, so a mutation there would be
    measuring a defect this dispatch deliberately left standing.

⛔ **Evidence this table is honest about what it can reach.** Every row was applied alone, its own
killer file run, and the tree restored from bytes and compared — the whole table has NOT been run
under the driver, so `CENSUS.md` records it `unrun` and no verdict is claimed here.

🔴 **The gate map** — which file kills which row:

| rows | killer |
|---|---|
| M1–M22 | `apps/desktop/test/who-did-it.test.ts` — every row was verified against this ONE file, alone |
| M5 | **also** `apps/desktop/test/a-person-who-never-answered.test.ts` and `apps/desktop/test/a-nights-backlog-rehearsed.render.test.ts`, whose agent door writes the row |
| M6, M8 | **also** `apps/desktop/test/every-answer-through-the-persons-queue.test.ts`, which asserts the exact row for every answer a person can give |
| M6 | **also** `apps/desktop/test/session-persistence.test.ts`, where the row is replayed after a resume |
| M9 | **also** `apps/desktop/test/every-answer-through-the-persons-queue.test.ts`, the proposal pair |
| M12, M14 | **also** `apps/desktop/test/the-night-the-digest-could-not-describe.test.ts`, whose planted rows are the old population |

⚠️ **Three rows SURVIVED the first verification and the test file grew rather than the rows
shrinking.** `M4`, `M6` and `M7` are the three writers no case in this file reached — a permission
card, and the two branches that settle a question THIS APP holds rather than one a provider raised.
⛔ **One failure is not the failure shape, and the first pass proved it about my own suite**: five
answer doors, two of them unmeasured, and the field could have been missing at either without a
single assertion moving.
"""

HOST = "apps/desktop/src/main/runtime/runtime-host.ts"
FOLD = "apps/desktop/src/main/runtime/digest.ts"
STORE = "apps/desktop/src/main/db/session-store.ts"
WORDS = "apps/desktop/src/shared/who-did-it.ts"
STREAM = "apps/desktop/src/renderer/src/lib/describe-event.ts"

MUTATIONS: list[tuple[str, list[tuple[str, str, str]]]] = [
    # ── §1 · the derivation ─────────────────────────────────────────────────────────────────────
    (
        "M1 \u00b7 \u26d4 the app arm is gone \u00b7 `THE_APP_ITSELF` falls through both positive "
        "tests and lands on the residue, so every act the runtime performs on its own \u2014 the "
        "launch sweep, a teardown \u2014 is recorded as a caller this app has no word for. \u26a0\ufe0f "
        "*The app itself* is an ANSWER and not an omission (HO-029 \u00a73); this row makes the app "
        "unnameable while leaving the field present, which reads as an unknown caller rather than as "
        "the engine",
        [(HOST, "  if (by === THE_APP_ITSELF) return THE_APP_DID_IT\n", "")],
    ),
    (
        "M2 \u00b7 \U0001f534 THE DEFECT \u00b7 the person arm becomes a FALL-THROUGH \u00b7 the "
        "positive window test is deleted and every caller that is not the app and not a conversation "
        "is recorded as a person. \u26d4 `413` \u00a73 measured exactly this shape and named it: "
        "*\"the dangerous default is the one that credits a person with words they never wrote\"* "
        "\u2014 and a durable row saying a person answered, about a caller nobody has met, is that "
        "defect written down for ever",
        [(HOST,
          "  if (aPersonTypedIt(by)) return { who: 'a-person' }\n  return { who: 'a-caller-this-app-cannot-name' }",
          "  return { who: 'a-person' }")],
    ),
    (
        "M3 \u00b7 \u26d4 the agent arm names the CALLER id \u00b7 `agent:<session>` is written where "
        "the session id belongs, so a reader cannot join the row to the conversation's own ledger "
        "without knowing how a caller id is spelled. \u26a1 `WorkInterruptedEvent.agent`'s own stated "
        "rule, broken one row over",
        [(HOST, "  if (speaking !== null) return { who: 'an-agent', agent: speaking }",
          "  if (speaking !== null) return { who: 'an-agent', agent: by.ownerId }")],
    ),
    # ── §2 · the write, at every door ───────────────────────────────────────────────────────────
    (
        "M4 \u00b7 \u26d4 `answerQuestion` stops recording it on the question THIS APP holds \u00b7 "
        "an `ask_parent` settled by the parent agent leaves a row indistinguishable from one written "
        "before `477`, so a reader is told nothing was recorded about an answer this app watched "
        "happen",
        # ⚑ Landing D-017 (45a11477) · re-anchored in place, not retired — answerQuestion's app-held
        # 'answered' branch still records an actor at the moment of decision — the write moved into
        # the shared `decideAQuestionThisAppAsked(askedBy, requestId, outcome, by)` helper, so `by`
        # is now a positional call argument rather than a labeled `by: whoDidIt(by)` object field.
        # Swapping the argument to THE_APP_ITSELF (instead of deleting a field) reproduces the same
        # category of defect: the row is written but the true answerer (the parent agent) is lost.
        [
            (HOST, "      this.decideAQuestionThisAppAsked(request.askedBy, request.requestId, 'answered', by)\n", "      this.decideAQuestionThisAppAsked(request.askedBy, request.requestId, 'answered', THE_APP_ITSELF)\n"),
        ],
    ),
    (
        "M5 \u00b7 \u26d4 `answerQuestion` stops recording it on the FORWARDED branch \u00b7 the "
        "same door, the other half: a provider-raised question answered by a parent agent records "
        "nobody. \u26a0\ufe0f One failure is not the failure shape \u2014 a field present on one "
        "branch of one method is a ledger that answers differently depending on which kind of "
        "question was asked",
        [(HOST,
          "      // beside it gives: one row, and now it says which of the two doors wrote it.\n      by: whoDidIt(by),\n",
          "      // beside it gives: one row, and now it says which of the two doors wrote it.\n")],
    ),
    (
        "M6 \u00b7 \u26d4 `respondPermission` stops recording it \u00b7 the door a person presses "
        "Allow or Deny at, and the one `465` \u00a72 drove to show the two doors were "
        "indistinguishable. \u26a1 `requireToAnswer` has already proved `mayAnswerAsAHuman`; this row "
        "throws the proof away again",
        [(HOST,
          "      outcome: decision.outcome,\n      by: whoDidIt(by),\n",
          "      outcome: decision.outcome,\n")],
    ),
    (
        "M7 \u00b7 \u26d4 `respondUserInput` stops recording it on the question THIS APP holds "
        "\u00b7 the escalation chain's last step: a question that ran past its deadline, reached a "
        "person and was answered by one, recorded as nobody",
        # ⚑ Landing D-017 (45a11477) · re-anchored in place, not retired — respondUserInput's
        # escalation-chain branch (a person answering a question this app asked, via
        # aPersonAnswersAQuestionThisAppAsked) still records who answered — the write moved into the
        # same shared `decideAQuestionThisAppAsked` helper, with `by` now the last positional
        # argument rather than a labeled object field, and the '477' comment marking it survives
        # verbatim right above the argument.
        [
            (HOST, "    this.decideAQuestionThisAppAsked(\n      askedBy,\n      requestId,\n      response.kind === 'answer' ? 'answered' : 'rejected',\n      // 🔴 **477** — the escalation chain's last step, and now the ledger says a person took it.\n      by,\n    )\n", "    this.decideAQuestionThisAppAsked(\n      askedBy,\n      requestId,\n      response.kind === 'answer' ? 'answered' : 'rejected',\n      // 🔴 **477** — the escalation chain's last step, and now the ledger says a person took it.\n      THE_APP_ITSELF,\n    )\n"),
        ],
    ),
    (
        "M8 \u00b7 \u26d4 `respondUserInput` stops recording it on the FORWARDED branch \u00b7 the "
        "ordinary provider card, answered by the window that owns the conversation \u2014 the "
        "commonest answer in the app, and the one a person is most likely to be asking about later",
        [(HOST,
          "      // \U0001f534 **477** \u2014 see the held branch above.\n      by: whoDidIt(by),\n",
          "")],
    ),
    (
        # ⚑ Landing D-016a (bd70d693) · killer:
        # `a-person-who-settles-an-agents-ask-is-the-one-the-ledger-names.test.ts` (the landing
        # added it; no existing test observed this plant).
        "M9 \u00b7 \U0001f534 `decideProposal` stops recording it \u00b7 `ProposalCard.vue` has drawn "
        "*\"You approved this\"* since `441` with nothing in the ledger behind the *\"you\"*, and "
        "this row puts it back to being a RAIL's claim rather than a recorded fact. \u26d4 A durable "
        "creation with a person's decision attached, and no row that says a person decided it",
        # ⚑ Landing D-016a (bd70d693) · re-anchored in place, not retired (a second reviewer refuted
        # its retirement) — `decideProposal` is now `decideInstruction`, and its `const actor =
        # whoDidIt(by)` feeds both the written version's `by` and `endInstructionAsk(..., actor)`;
        # the two-line anchor is unique, because the bare one-line form occurs twice (the
        # `instructAgent` supersede site is a separate call). The plant makes a person's decision at
        # the sheet record as the app itself, which is the label's defect that no row says a person
        # decided it. Nothing asserts the actor today (the approve and refuse tests in
        # `the-layer-a-person-writes.test.ts` map versions to text, whoWroteIt and conversation
        # only), so the landing must add `by` assertions there, `{ who: 'a-person' }` on the version
        # and on the `instruction_sett
        [
            (HOST, '    const actor = whoDidIt(by)\n    if (approve) {\n', '    const actor = whoDidIt(THE_APP_ITSELF)\n    if (approve) {\n'),
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-016a, bd70d693):** `releaseProposalsOf` and its
        # `withdrawn` arm are gone. grep finds no releaseProposalsOf, decideProposal or
        # ProposalEnded anywhere in src, and bd70d693 says "Proposals go end to end". DEV's
        # who-did-it.test.ts now says "Two until D-016, which took `proposal_ended` out with
        # proposals" and asserts 477 changed only `user_decision`. Its anchor is left stale, so the
        # census records it retired.
        "M10 \u00b7 \u26d4 `releaseProposalsOf` stops recording it \u00b7 the `withdrawn` arm, which "
        "is the one the retired *\"each word names its own author\"* sentence was most wrong about: "
        "four upstream actors reach it, and this row takes the ledger back to naming none of them",
        [(HOST,
          "        // teardown path nothing did, and that is the half this closes.\n        by: whoDidIt(by),\n",
          "        // teardown path nothing did, and that is the half this closes.\n")],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-016a, bd70d693):** The launch sweep that settled a
        # stranded proposal (`ending: 'stranded'`, `by: THE_APP_DID_IT`) was removed with proposals,
        # and `ending: 'stranded'` has no anchor left in session-store.ts. The instruction-ask store
        # door (`settleInstructionAskTx`) is a different feature (582) that never had a 477 row. Its
        # anchor is left stale, so the census records it retired.
        "M11 \u00b7 \u26d4 the LAUNCH SWEEP stops recording it \u00b7 a proposal the app died holding "
        "is settled `stranded` with no actor, so the one case where *the app itself* is "
        "unambiguously the answer reads as a row written before this app recorded one \u2014 which is "
        "the discontinuity HO-029 \u00a72.2 says must stay a fact about WHEN rather than about WHO",
        # ⚑ Landing D-017 (3d295083) · re-anchored in place, not retired — The launch sweep for
        # stranded proposals still names THE_APP_DID_IT as the actor on the row it writes (HO-029
        # §2.1's eighth writer). D-017's try/catch wrap moved this same pair of lines from 14 to 16
        # spaces indent, so the old anchor no longer matches; the actor-recording rule itself is
        # unchanged.
        [
            (STORE, "                ending: 'stranded',\n                by: THE_APP_DID_IT,\n", "                ending: 'stranded',\n"),
        ],
    ),
    # ── §3 · the sentence ───────────────────────────────────────────────────────────────────────
    (
        "M12 \u00b7 \U0001f534 the absence is counted off the GROUP \u00b7 a mixed window says "
        "*nothing records who answered them* about every request in it, including the ones that name "
        "a person. \u26d4 HO-029 \u00a72.2's *\"nothing in between, nothing guessed\"* broken in "
        "the direction that looks conservative and is not: it reports a recorded fact as an absence",
        [(FOLD, "      )}${nobodyClause(tally.answeredByNobodyRecorded, 'answered')}`",
          "      )}${nobodyClause(group.count, 'answered')}`")],
    ),
    (
        "M13 \u00b7 \u26d4 the answered line stops naming anybody \u00b7 the clause is dropped and "
        "the digest is back to `465`'s sentence for every row, including the ones that record an "
        "actor \u2014 criterion 16's *Rumour* row un-moved, with the field sitting unread on disk",
        [(FOLD, "      return `${many(group.count, 'request was', 'requests were')} answered.${whoClause(\n        tally.answerers,\n        'Who answered',\n      )}",
          "      return `${many(group.count, 'request was', 'requests were')} answered.${(() => '')(\n        tally.answerers,\n        'Who answered',\n      )}")],
    ),
    (
        "M14 \u00b7 \U0001f534 `465`'s sentence is RETIRED \u00b7 the absence clause is dropped, so a "
        "window holding only rows written before `477` says *\"1 request was answered.\"* and stops. "
        "\u26d4 HO-029 \u00a72.2 exactly inverted \u2014 *\"every event written before this answers "
        "unknown, and the digest must keep saying so\"* \u2014 and it is the smoothing the PO named: "
        "a record that pretends to have always known",
        # ⚑ **RE-ANCHORED at `503`**, which moved the sentence's bytes to `shared/who-did-it.ts`
        # so a request card and the digest could not compose it differently. ⛔ The ROW is
        # unchanged: the absence clause dropped, and a window of rows written before `477`
        # saying *"1 request was answered."* and stopping. ⚠️ What is mutated is still the
        # digest's own frame, which is where the decision to say it at all lives. Re-verified
        # RED individually.
        [(FOLD, "  return count === 0 ? '' : ` ${nothingRecordsWho(verb, count)}.`\n",
          "  void count\n  void verb\n  return ''\n")],
    ),
    (
        "M15 \u00b7 \u26d4 the absent arm is folded into the counter as a PERSON \u00b7 a row written "
        "before this app recorded an actor is counted as one that names a person, which is `463`'s "
        "original false sentence reached by a different route \u2014 and this time it would be "
        "durable, because the fold is what every window reads",
        [(FOLD, "        if (event.by === undefined) tally.answeredByNobodyRecorded += 1\n        else countWord(tally.answerers, event.by.who)",
          "        countWord(tally.answerers, event.by?.who ?? 'a-person')")],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-016a, bd70d693):** The digest's proposal line and its
        # `tally.settlers` and `Who settled it` clauses were deleted with proposals (no `settlers`
        # remains in digest.ts). Commit bd70d693: "Proposals go end to end". The answered-line rows
        # M12–M15 still cover the surviving who-clauses. Its anchor is left stale, so the census
        # records it retired.
        "M16 \u00b7 \u26d4 the proposal line stops naming who settled it \u00b7 both clauses go, so "
        "*approved* is once again a word a reader has to infer an author from \u2014 which is the "
        "inference `ProposalEndedEvent`'s docblock made and `477` withdrew",
        [(FOLD, "}.${whoClause(\n        tally.settlers,\n        // \u26a0\ufe0f **The pronoun follows the COUNT**, which is `465 M4`'s rule one clause over: a line\n        // whose grammar is right for one proposal and wrong for a busy night fails only on the\n        // reading a person actually opens a digest for.\n        group.count === 1 ? 'Who settled it' : 'Who settled them',\n      )}${nobodyClause(tally.settledByNobodyRecorded, 'settled')}`",
          "}.`")],
    ),
    # ── §4 · the vocabulary ─────────────────────────────────────────────────────────────────────
    (
        "M17 \u00b7 \u26d4 a replayed word this build cannot spell prints as `undefined` \u00b7 the "
        "guard is dropped, so a ledger written by a build whose vocabulary has moved composes *\"Who "
        "answered: 1 \u00b7 undefined\"* on a card about somebody's night. \u26a1 `permanenceSaid`'s "
        "rule, and the one place a digest must not print `undefined`",
        [(WORDS, "  return isWhoDidIt(said) ? WHO_DID_IT_SAYS[said] : said",
          "  return WHO_DID_IT_SAYS[said as WhoDidIt]")],
    ),
    (
        "M18 \u00b7 \U0001f534 *no row records this* is said as *a person* \u00b7 the one phrasing "
        "every surface reads an actor through starts naming a person for a row that carries nobody, "
        "so the Events tab claims a person answered every request written before `477`",
        [(WORDS, "  if (actor === undefined) return 'nobody this ledger records'",
          "  if (actor === undefined) return WHO_DID_IT_SAYS['a-person']")],
    ),
    (
        "M19 \u00b7 \u26d4 the agent arm prints the WORD instead of the conversation \u00b7 the raw "
        "stream loses the one id a reader can join to the answering conversation's own ledger, and "
        "the digest's grouped kinds become the only thing this app records about who",
        # ⚑ **RE-ANCHORED at `503`**, which routed the bare-word arm through `whoDidItSays` so a
        # word off a replayed ledger this build has no sentence for is said as itself instead of
        # drawing `undefined`. ⛔ The ROW is unchanged — the agent arm printing the WORD where
        # the id belongs. Re-verified RED individually.
        [(WORDS, "  return actor.who === 'an-agent' ? actor.agent : whoDidItSays(actor.who)",
          "  return whoDidItSays(actor.who)")],
    ),
    (
        "M20 \u00b7 \u26a0\ufe0f the app arm becomes a SECOND literal \u00b7 `whoDidIt` builds its "
        "own object instead of returning the one the launch sweep also writes, so the two spellings "
        "are free to drift and a mutation on either is invisible to the other half of the app. "
        "\u26d4 One spelling in the tree is the rule `a-mutation-that-changes-nothing-reports-as-a-"
        "survivor` exists to protect",
        [(HOST, "  if (by === THE_APP_ITSELF) return THE_APP_DID_IT",
          "  if (by === THE_APP_ITSELF) return { who: 'the-app-itself' }")],
    ),
    # ── §5 · the raw stream ─────────────────────────────────────────────────────────────────────
    (
        "M21 \u00b7 \u26d4 the Events tab stops naming who answered \u00b7 the one surface that "
        "draws the answering CONVERSATION rather than its kind goes back to the id and the outcome, "
        "so the field is recorded and no surface in the app can show which conversation it names",
        # ⚑ **723 · re-anchored in place, not retired** — 723 (R81) put `asked nothing` into this line; the row still drops who answered
        [(STREAM, "      return `${event.requestId} · ${event.outcome}${event.stopsNothing === true ? ' · asked nothing' : ''} · ${didIt(event.by)} (ours)`",
          "      return `${event.requestId} · ${event.outcome}${event.stopsNothing === true ? ' · asked nothing' : ''} (ours)`")],
    ),
    (
        # ⚑ Landing D-016a (bd70d693) · killer:
        # `the-events-tab-names-who-settled-an-instruction-ask.test.ts` (the landing added it; no
        # existing test observed this plant).
        "M22 \u00b7 \u26d4 the Events tab stops naming who settled a proposal \u00b7 the ending word "
        "is left to imply its own author, which is the sentence this line carried until `477` and the "
        "one the interface's docblock withdrew",
        # ⚑ Landing D-016a (bd70d693) · re-anchored in place, not retired (a second reviewer refuted
        # its retirement) — The rule survives in the `instruction_settled` case of `describeEvent`
        # (proposals are gone; the event is 582's instruction ask), and the plant drops the actor
        # word from that Events-tab line; `didIt` is still used at line 100, so there is no
        # unused-import error. No existing test goes red, because D-016 deleted the only
        # `instruction_settled`-style `describeEvent` assertion and what is left covers
        # `user_decision` alone. The landing must add one assertion to `who-did-it.test.ts`,
        # `expect(describeEvent({ type: 'instruction_settled', askId, ending: 'approved', by: { who:
        # 'a-person' } })).toContain('a person')`, and the plant is expected red on that assertion
        # alone.
        [
            (STREAM, '      return `${event.askId} · ${event.ending} · ${didIt(event.by)} (ours)`', '      return `${event.askId} · ${event.ending} (ours)`'),
        ],
    ),
]
