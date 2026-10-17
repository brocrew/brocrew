"""394 · a question finds a person, and a permission never travels — each row is THE DEFECT, put back.

🔴 **S4, and the interesting half is criterion 10: *permissions cannot enter the question channel —
asserted as absent, not assumed.*** ⛔ **The obvious implementation is a filter, and the brief
forbids it**: *"a filter justified by 'we never see permissions here' blinds the instrument that
would show you one. Once the gate is in, the evidence that motivated it can no longer arrive — and
the census that would have caught a provider starting to send them reports zero forever, honestly,
while being wrong."*

⚑ **So what shipped is a CLASSIFIER whose answer is recorded on both arms**, and half the rows below
put back the filter one way or another.

## 🔴 Which gate can see each row

| rows | the defect is caught by |
|---|---|
| `M1`-`M3` | ⚑ **`run_suite`** — `packages/runtime/test/the-question-channel.test.ts`, plus the wire demonstrations in `claude-runtime.test.ts` and `codex-runtime.test.ts` |
| `M4`-`M5`, `M14` | ⚑ **`run_suite`** — `apps/desktop/test/a-question-finds-a-person.test.ts` §2, §4 and §6, and `a-task-you-can-see.test.ts`'s mint census |
| `M6`-`M9` | ⚑ **`run_suite`** — `a-question-finds-a-person.test.ts` §1 and §6 |
| `M10`-`M13` | ⚑ **`run_suite`** — `a-question-finds-a-person.test.ts` §2, §3 and §5 |

## ⛔ What this table deliberately does NOT contain

⛔ **No row on `deriveRoutedRequests`'s duplicate guard** (`if (open.has(event.requestId)) continue`).
The chokepoint writes one routing per request and a second would be a bug rather than a state, so
both readings agree everywhere a product sequence can reach — *"a comparison tested where both sides
agree measures nothing"*, which is how three of `341`'s rows survived.

⛔ **No row that makes a routed question ESCALATE on a timeout.** Criterion 11 is not in this
dispatch and `394` deliberately did not rule it; a row asserting either way would pin a decision
nobody has made.

⚠️ **No row on the four `answer_question` argument checks individually.** They are one refusal with
four spellings — `malformed-request` — and four rows would be four spellings of one question. §3's
malformed test walks all four in a loop, which is where the coverage is.

⚠️ **No row on `the-conversation-that-asked-has-gone` being permanent.** It is the criterion 14
FINDING rather than a rule this dispatch built, and its permanence is an argument about resumes that
`394`'s response doc puts to the PM rather than a behaviour a mutation could contradict.

## ⚠️ T-003 · after D-010 (`8bc565fa`) and D-011 (`79245533`)

D-010 retired the singleton: M6 is retired by ruling. ⚠️ M7's anchor still applies and it is still RED
(on `a-question-finds-a-person.test.ts` §1 and §6: the kind a held message records), but its label's
defect, *every caller gets the mailbox*, is now D-010's decision. The census cannot retire a row whose
anchor applies; whether M7 retires is the PM's call. The gate line `M6`-`M9` now starts at M7.
"""

CHANNEL = "packages/runtime/src/question-channel.ts"
HOST = "apps/desktop/src/main/runtime/runtime-host.ts"
RAILS = "apps/desktop/src/main/runtime/question-rails.ts"

MUTATIONS: list[tuple[str, list[tuple[str, str, str]]]] = [
    # ── §1 · the classification · what may travel ─────────────────────────────────────────────
    (
        "M1 · 🔴 a question whose answer is a SECRET travels · a parent agent is handed a card "
        "asking for a deploy token and told to answer it — the credential half of *authority is "
        "always a person's*, which `141` measured the flag for and `143` carried it for",
        [
            (
                CHANNEL,
                "    if (question.secret === true) {\n      return { travels: false, id, because: 'a-secret-only-a-person-can-type' }\n    }",
                "    void question",
            )
        ],
    ),
    (
        "M2 · [anchor corrected in place by 478: `consent` is now classified between this branch "
        "and the admit-list walk, so the old anchor — which spanned both — no longer applies. The "
        "anchor is now the `permission` branch alone and the mutation's effect is unchanged] "
        "🔴 a Codex GRANT loses the one branch that names what it IS · the sandbox widening still "
        "does not travel, and the ledger, the refusal's `detail.because` and every census over it "
        "now say something else about a request for write access and network — `340`'s finding, in "
        "the one field criterion 10's instrument counts. ⚠️ **478 measured what it really says**: "
        "`a-shape-this-app-has-not-been-taught`, because the admit-list below sees the "
        "`permission` key — never *a consent with nothing to answer*, which is what this label "
        "claimed before anybody ran it",
        [
            (
                CHANNEL,
                "  if (Object.hasOwn(asked, 'permission') && asked['permission'] !== undefined) {\n    return { travels: false, id, because: 'a-grant-of-access' }\n  }\n",
                "",
            )
        ],
    ),
    (
        "M3 · ⛔ the admit-list becomes a deny-list · a request carrying a field no adapter here "
        "knows about is admitted to the channel instead of refused — *a shape the validator has not "
        "been taught is a refusal, never a pass*, and this is it being a pass",
        [
            (
                CHANNEL,
                "  for (const key of Object.keys(asked)) {\n    if (!ADMITTED_KEYS.has(key)) {\n      return { travels: false, id, because: 'a-shape-this-app-has-not-been-taught' }\n    }\n  }\n",
                "",
            )
        ],
    ),
    # ── §2 · the routing · the filter, put back ───────────────────────────────────────────────
    (
        "M4 · 🔴 the routing becomes a FILTER · a permission is silently not-routed and nothing "
        "records that it arrived, so `permissionShaped` answers `[]` for ever — honestly, and "
        "wrongly. ⛔ This is §2's trap built exactly as the brief describes it: the gate blinds the "
        "instrument that would show you one",
        [
            (
                HOST,
                "      return this.recordOurs(session, {\n        type: 'request_routed',\n        requestId: verdict.id,\n        to: 'a-person',\n        because: verdict.because,\n        parent,\n      })",
                "      return null",
            )
        ],
    ),
    (
        "M5 · ⛔ the routing is recorded only while a window is WATCHING · a spawned child has no "
        "window of its own, which is the ordinary case for a routed question — so the row goes "
        "missing from exactly the conversations it is about, and criterion 14 rebuilds a channel "
        "that never happened",
        [
            (
                HOST,
                "    if (wire.type !== event.type) return null\n    const verdict = askedOfTheChannel(event)",
                "    if (wire.type !== event.type || !session.sink.alive) return null\n    const verdict = askedOfTheChannel(event)",
            )
        ],
    ),
    # ── §3 · the mailbox · criterion 13, and the endings ──────────────────────────────────────
    (
        # ⛔ **RETIRED BY RULING (T-003): D-010 (8bc565fa).** The singleton this row inverts is gone.
        # D-010 deleted `theWorkAHoldWaitsBehind`, including its `return !idle && kind === 'work' ?
        # session.mailbox.find(…)` gate. It deleted every caller too: the `queueAs` hold rail and
        # the wake's `aMessageWaitsThere`. Its anchor is left stale, so the census records it
        # retired (`anchor-absent`).
        "M6 · ⛔ the singleton guards the wrong kind · a second WORK message is accepted and "
        "replaces words somebody meant to send (criterion 13, gone), while a routed QUESTION is "
        "refused and the conversation that asked waits for ever — both halves of `394` §5.1, "
        "inverted in one word",
        [
            (
                HOST,
                # ⛔ **415 · the line moved ABOVE the idle branch and gained `!idle &&`**, which
                # is what keeps it asked of a BUSY conversation only — exactly as it was when it
                # sat inside that branch. ⚑ The mutation is unchanged: the singleton reads the
                # wrong kind, so criterion 13 goes and a routed question is refused instead.
                # ⚑ **Re-anchored by `440`**, which put a second clause inside the `find` — *and
                # queued by this caller, when the receiver's grant says so* — so the expression is
                # no longer one line. ⛔ **The DEFECT is unchanged and the anchor is the same
                # word**: the GATE reads `kind === 'question'` instead of `kind === 'work'`, so
                # criterion 13 is gone and a routed question is refused. Re-verified RED
                # individually — `correct-a-stale-mutation-anchor-dont-retire-it`.
                # ⚑ **RE-ANCHORED at `698`, not retired**: the predicate moved into
                # `theWorkAHoldWaitsBehind`, which `queueAs` and the wake both ask (`690` F-1), so
                # the gate is that method's `return`. ⛔ The DEFECT is unchanged — the gate reads the
                # wrong kind — and it now reaches the wake's answer too.
                "    return !idle && kind === 'work'\n      ? session.mailbox.find(",
                "    return !idle && kind === 'question'\n      ? session.mailbox.find(",
            )
        ],
    ),
    (
        "M7 · 🔴 the widening stops being opt-in · every caller that has ever queued a message now "
        "gets the mailbox, so criterion 13 is silently loosened for the composer, for "
        "`message_agent` and for a reply — *a narrowing is opt-in at the call site too*, pointed "
        "the other way",
        [
            (
                HOST,
                "    kind: MailboxKind = 'work',",
                "    kind: MailboxKind = 'question',",
            )
        ],
    ),
    (
        "M8 · ⛔ the teardown abandons only the HEAD · every message behind it keeps a beginning "
        "with no ending — the exact state `354` measured a CRASH producing, written deliberately by "
        "a clean quit, and `394` §5.2's *a mailbox with more slots has more ways to end in silence*",
        # ⚑ Landing D-017 (45a11477) · re-anchored in place, not retired — `handOnWhatItHeld`
        # (D-017's rename of `abandonQueued`) still empties the WHOLE mailbox in one `splice` before
        # walking it, for the same 394 §5.2 reason (every slot needs an ending or a hand-on, not
        # just the head). Only the local variable name changed (`abandoned`→`held`); truncating the
        # splice to one element reproduces the exact hazard.
        [
            (HOST, '    const held = session.mailbox.splice(0, session.mailbox.length)', '    const held = session.mailbox.splice(0, 1)'),
        ],
    ),
    (
        "M9 · ⛔ the mailbox stops being a QUEUE · the flush takes the newest slot, so a question "
        "that arrived last is delivered first and the words a person wrote go last — `394` §5.3's "
        "*order is a fact, not an implementation detail*, made false",
        # ⚑ Landing D-027, the ui stretch to 3ef68f7f and D-038 · re-anchored in place, not retired
        # — D-027 replaced the one-per-turn `session.mailbox[0]` with `theTurnItTakes`, which walks
        # `session.mailbox` oldest first and builds one turn; the order rule (the mailbox is a
        # queue, a question that arrived last is delivered last) survives there. The plant walks it
        # newest first, so the person's words go last and the questions arrive in reverse. Killed by
        # `a-question-finds-a-person.test.ts`, `the-message-that-has-no-name.test.ts`.
        [
            # ⚑ **F074 · re-anchored in place, not retired** — F074 · at a usage limit the walk takes a person's own words alone; the row still walks the mailbox newest first.
            (HOST, "    for (const queued of session.mailbox) {\n      if (onlyAPersons && !aPersonsOwn(queued)) continue\n", "    for (const queued of [...session.mailbox].reverse()) {\n      if (onlyAPersons && !aPersonsOwn(queued)) continue\n"),
        ],
    ),
    # ── §4 · the answer door ──────────────────────────────────────────────────────────────────
    (
        "M10 · 🔴 an agent may answer a PERMISSION · criterion 10's rail is gone at the one door "
        "an agent can reach, and HO-005 Q2's ruling — *an agent answering another agent's "
        "permission prompt is the kill switch with extra steps; build it so no path exists* — has "
        "a path",
        [
            (
                RAILS,
                (
                # ⚠️ **611 · CORRECTED IN PLACE, not retired.** `RoutedRequest.to` and `.because`
                # became one union (HO-088 §2), so the gate is spelled by the ARM. ⛔ The row's
                # subject is unchanged: deleting the refusal lets an agent answer a permission.
                "  if (request.went.is === 'the-person-the-channel-left-it-with') {\n"
                "    return refuseQuestion('a-person-answers-this-one', {\n"
                "      question: request.requestId,\n"
                "      because: request.went.because,\n"
                "    })\n  }\n"
            ),
                "",
            )
        ],
    ),
    (
        "M11 · ⛔ the ending is asked before the KIND · a caller that named a permission somebody "
        "has already answered is told *that has already ended* — a sentence about a card it may not "
        "touch, and `340`'s finding (a reason answering with another reason's sentence) at the one "
        "door where the wrong reason implies the right to have asked",
        [
            (
                RAILS,
                (
                # ⚠️ **611 · CORRECTED IN PLACE** — see `M10`. The two blocks and their order are
                # what this row is about, and only the first block's spelling moved.
                "  if (request.went.is === 'the-person-the-channel-left-it-with') {\n"
                "    return refuseQuestion('a-person-answers-this-one', {\n"
                "      question: request.requestId,\n"
                "      because: request.went.because,\n"
                "    })\n  }\n"
                "  // ⛔ **The same table the fold settles by**, imported rather than re-listed: a rail with its own\n"
                "  // idea of which states are endings would be free to disagree with the derivation it guards.\n"
                "  if (!REQUEST_IS_OPEN[request.state]) {\n"
                "    return refuseQuestion('question-has-already-ended', {\n"
                "      question: request.requestId,\n"
                "      state: request.state,\n"
                "    })\n  }"
            ),
                (
                "  if (!REQUEST_IS_OPEN[request.state]) {\n"
                "    return refuseQuestion('question-has-already-ended', {\n"
                "      question: request.requestId,\n"
                "      state: request.state,\n"
                "    })\n  }\n"
                "  if (request.went.is === 'the-person-the-channel-left-it-with') {\n"
                "    return refuseQuestion('a-person-answers-this-one', {\n"
                "      question: request.requestId,\n"
                "      because: request.went.because,\n"
                "    })\n  }"
            ),
            )
        ],
    ),
    (
        "M12 · 🔴 the answer door reads the OLDEST routing under an id · a request id is unique per "
        "PROVIDER SESSION and a resume is a new one, so a live question is refused by quoting an "
        "ending that belongs to a request nobody is waiting on — the defect this dispatch's own §5 "
        "found",
        [
            (
                HOST,
                # ⚠️ **RE-ANCHORED at 679, not retired.** Since 679 the answer door finds its row through `theQuestionNamed` — by the ASKER and the id (675 F-b) — so this plants the OLDEST routing of the question it found, at THIS door alone, keeping the asker the caller named (the review's correction: a first draft re-looked-up by the id alone and planted 675 F-b too). The DEFECT this row plants is unchanged.
                "    const named = this.theQuestionNamed(speaking, input.questionId, input.askedBy ?? null)\n    if (named.is === 'refused') return { ok: false, refusal: named.refusal }\n    const request = named.request\n",
                "    const named = this.theQuestionNamed(speaking, input.questionId, input.askedBy ?? null)\n    if (named.is === 'refused') return { ok: false, refusal: named.refusal }\n    const found = named.request\n    const request =\n      found &&\n      this.deps.store\n        .questionsRoutedTo(speaking)\n        .find((one) => one.askedBy === found.askedBy && one.requestId === found.requestId)\n",
            )
        ],
    ),
    (
        "M13 · ⛔ an answer leaves no ending · nothing closes the routed request, so the fold reads "
        "`open` for ever, a second answer is accepted against a provider that has already spent the "
        "request, and every reader of the channel says a conversation is still waiting when it is "
        "running again",
        [
            (
                HOST,
                # \u26a1 **477 re-anchored this in place** \u2014 the row grew the actor HO-029 \u00a72.1
                # requires, and a retired row protects nothing. The rule is unchanged: this branch
                # must write the ending.
                "    this.publishOurs(session, {\n      type: 'user_decision',\n      requestId: request.requestId,\n      outcome: 'answered',\n      // \U0001f534 **477** \u2014 the same derivation as the held branch above, for the reason the comment\n      // beside it gives: one row, and now it says which of the two doors wrote it.\n      by: whoDidIt(by),\n    })",
                "    void session",
            )
        ],
    ),
    # ── §5 · the delivery ─────────────────────────────────────────────────────────────────────
    (
        # ⚑ **710 · the consequence CORRECTED** (`707` F-5's class, found by `710`'s review): since
        # `553` a message that declares no kind is a QUESTION, so the child-as-caller mints nothing;
        # what the mutant does is deliver the app's words as the child's.
        "M14 · 🔴 the question is delivered AS THE CHILD · the app's routed words arrive as the "
        "child's — its declared kind on the parent's turn, its receipt, its reach asked — `393`'s "
        "`M5` one subject over",
                # ⚠️ **RE-POINTED at 413 and again at 414, not retired** — 413 gave the call two
                # trailing arguments and 414 folded them into one named object, so the tail is one
                # line shorter again. The row's subject is unchanged: deliver AS THE CHILD.
        # ⚑ Landing D-016c commits 6–7 and D-022 (4a7f0fec, c1a79abe, 37228461) · re-anchored in
        # place, not retired — The rule survives: the routed question reaches the parent as the app,
        # not as the child that asked. The call now ends with `{ carriedFor: asked, ...about }`, so
        # the anchor takes the tail, and the plant hands `{ ownerId: agentCallerId(asked) }` in
        # place of `THE_APP_ITSELF`. Killed by `a-question-finds-a-person.test.ts`,
        # `a-task-you-can-see.test.ts`.
        [
            (HOST, "        THE_APP_ITSELF,\n        [],\n        'question',\n        { carriedFor: asked, ...about },\n      )", "        { ownerId: agentCallerId(asked) },\n        [],\n        'question',\n        { carriedFor: asked, ...about },\n      )"),
        ],
    ),
]
