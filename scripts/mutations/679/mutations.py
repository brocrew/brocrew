"""679 · A question is known by who asked it.

⛔ **Ordered by `675` F-b**: the answer door and the pass-up door found a routed question by its id
ALONE, across every child of the caller — and a provider's request id is session-local.

## 🔴 A · measured, both halves

⚑ **The app, on `main` @ `44c6f029`** (`a-question-is-known-by-who-asked-it.test.ts`): two children's
first questions carried one id, and `answer_question` naming it answered the NEWER child with the
older one's answer (`{"outcome":"ok","agent":"sess_5"}`); `pass_question_up` carried the newer child's
words under the older child's id. ⚑ **The provider** (`probe:codex-request-ids`, Codex 0.146.0): every
connection numbers its `item/tool/call` server requests from `0`, so two conversations' first are
both `number:0` — and on one connection the two ids differ, the control. ⚠️ Whether a QUESTION draws on
that counter was not read.

## ⚑ B · one key, `questionKey` — the doors (M1-M12), the held words (M13-M15)

## ⚑ C · what the caller is told (M16-M22)

## 🔴 D · what the review found (M23-M28)

⚑ An `asked_by` that raised nothing by a live id was told `no-question-by-that-name` — *nobody is
waiting* — and got its own word (M23, M24); two children's cards of one kind under one id are a
person's either way (M25, M26); an ANSWERED question still shares its id (M27); and the fourth reader
of the held words, the slotless asker, had no test the key could fail (M28).

## ⚠️ E · rows this dispatch corrected elsewhere, and why none was retired

⚑ **Nine anchors moved and every subject survived**: both doors now find their row through
`theQuestionNamed`, so `394 M12` and `661 M11` plant the oldest/first routing of the question found,
at THEIR door alone and keeping the asker the caller named (the review caught a first draft that
re-looked-up by the id alone, planting `675` F-b as well);
the held words are keyed by `questionKey`, so `437 M7`, `608 M5`, `661 M6`, `675 M14` and `675 M15`
anchor on the keyed lookups; the person's door lost `holding.asked === sessionId` — a comparison the
key made always true — so `591 M2` opens on `holding !== undefined`; and `675 M19`'s listing key is
the shared function. ⛔ Each was re-verified RED alone with `verify_row.py`.

⚠️ **Not a row: the smoke harness's `queueListed`** (`lifecycle-stage.smoke.ts`), re-keyed here — no
suite `pnpm run ci` runs can kill a mutation in a smoke.
"""

HOST = "apps/desktop/src/main/runtime/runtime-host.ts"
TOOLS = "apps/desktop/src/main/runtime/agent-tools.ts"
RAILS = "apps/desktop/src/main/runtime/question-rails.ts"

KILLER = "killed by `a-question-is-known-by-who-asked-it.test.ts`"

# ⛔ A lookup that forgets the ASKER and matches the id alone — the old key, spelled against the new map.
BY_THE_ID_ALONE = (
    "[...this.questionsThisAppHolds.keys()].find((key) => key.endsWith(`\\u0000${THE_ID}`)) ?? ''"
)

MUTATIONS: list[tuple[str, list[tuple[str, str, str]]]] = [
    # ── B · the doors ──────────────────────────────────────────────────────────────────────────
    (
        f"M1 · 🔴 **an id two children share is never refused** · the door takes the newest routing, "
        f"and the older child's answer goes to the newer one — `675` F-b, back · {KILLER}",
        [
            (
                HOST,
                "    if (askers.length > 1 && !this.oneKindOfPersonsRequest(underTheId, askers)) {\n",
                "    if (askers.length > 99) {\n",
            )
        ],
    ),
    (
        f"M2 · 🔴 **the asker a caller names is ignored** · `asked_by` narrows nothing, so the call "
        f"the refusal names reaches the newest routing — the older child's answer to the newer · "
        f"{KILLER}",
        [
            (
                HOST,
                "      const theirs = underTheId.filter((one) => one.askedBy === askedBy)\n",
                "      const theirs = underTheId\n",
            )
        ],
    ),
    (
        f"M3 · ⛔ **the FIRST routing under the id, not the last** · a resumed provider reuses its ids "
        f"(`396` §3), so a live question is refused by quoting the answered one before it · {KILLER}",
        [
            (
                HOST,
                "    return { is: 'found', request: underTheId[underTheId.length - 1] }\n",
                "    return { is: 'found', request: underTheId[0] }\n",
            )
        ],
    ),
    (
        f"M4 · 🔴 **the key forgets the asker** · one function, so every reader goes back to the id "
        f"alone at once: a provider's card is answered as a sibling's held words · {KILLER}",
        [(RAILS, "  return `${askedBy}\\u0000${requestId}`\n", "  return requestId\n")],
    ),
    (
        f"M5 · ⛔ **the answer door lets the lookup's refusal through** · with no row to take it "
        f"answers `no-question-by-that-name` — a question the caller WAS asked, called nothing · "
        f"{KILLER}",
        [
            (
                HOST,
                "    const named = this.theQuestionNamed(speaking, input.questionId, input.askedBy ?? null)\n    if (named.is === 'refused') return",
                "    const named = this.theQuestionNamed(speaking, input.questionId, input.askedBy ?? null)\n    if (named.is === 'refused' && input.questionId === '') return",
            )
        ],
    ),
    (
        f"M6 · ⛔ **the pass-up door lets the lookup's refusal through** · the same, one door over · "
        f"{KILLER}",
        [
            (
                HOST,
                "    const named = this.theQuestionNamed(speaking, input.requestId, input.askedBy ?? null)\n    if (named.is === 'refused') return",
                "    const named = this.theQuestionNamed(speaking, input.requestId, input.askedBy ?? null)\n    if (named.is === 'refused' && input.requestId === '') return",
            )
        ],
    ),
    (
        f"M7 · 🔴 **the answer door drops the asker the caller named** · the refusal's own act is "
        f"refused again, for ever · {KILLER}",
        [
            (
                HOST,
                "this.theQuestionNamed(speaking, input.questionId, input.askedBy ?? null)",
                "this.theQuestionNamed(speaking, input.questionId, null)",
            )
        ],
    ),
    (
        f"M8 · 🔴 **the pass-up door drops the asker the caller named** · the same, and the older "
        f"child's words can never be carried · {KILLER}",
        [
            (
                HOST,
                "this.theQuestionNamed(speaking, input.requestId, input.askedBy ?? null)",
                "this.theQuestionNamed(speaking, input.requestId, null)",
            )
        ],
    ),
    (
        f"M9 · ⛔ **`answer_question` never hands the host `asked_by`** · the field is advertised and "
        f"read nowhere · {KILLER}",
        # ⚑ Landing D-016c commits 6–7 and D-022 (4a7f0fec, c1a79abe, 37228461) · re-anchored in
        # place, not retired — answer_question still hands the host asked_by, but commit 7 resolves
        # it through host.theConversationAddressed over three lines, so the one-line anchor is gone.
        # The plant passes askedBy: null, so the id is looked up alone and a shared id is refused
        # even when the caller named the asker. Killed by
        # `a-question-is-known-by-who-asked-it.test.ts`.
        [
            (TOOLS, "              answers,\n              askedBy:\n                typeof askedBy === 'string'\n                  ? host.theConversationAddressed(askedBy, by, me, 'answering')\n                  : null,\n", '              answers,\n              askedBy: null,\n'),
        ],
    ),
    (
        f"M10 · ⛔ **`pass_question_up` never hands the host `asked_by`** · the same, one verb over · "
        f"{KILLER}",
        # ⚑ Landing D-016c commits 6–7 and D-022 (4a7f0fec, c1a79abe, 37228461) · re-anchored in
        # place, not retired — pass_question_up still hands the host asked_by, now through
        # host.theConversationAddressed over three lines. The plant passes askedBy: null, so a
        # shared id is refused at the pass-up door even when the caller named the asker. Killed by
        # `a-question-is-known-by-who-asked-it.test.ts`.
        [
            (TOOLS, "              context: typeof context === 'string' ? context : null,\n              askedBy:\n                typeof askedBy === 'string'\n                  ? host.theConversationAddressed(askedBy, by, me, 'answering')\n                  : null,\n", "              context: typeof context === 'string' ? context : null,\n              askedBy: null,\n"),
        ],
    ),
    (
        f"M11 · ⚠️ **an `asked_by` that is not a name falls back to the id alone** · at "
        f"`answer_question`, silently — the lookup it was written to narrow · {KILLER}",
        [
            (
                TOOLS,
                "          // otherwise fall back to the id alone — the lookup it was written to narrow.\n          if (askedBy !== undefined && (typeof askedBy !== 'string' || askedBy.length === 0)) {\n",
                "          // otherwise fall back to the id alone — the lookup it was written to narrow.\n          if (askedBy === '\\u0000') {\n",
            )
        ],
    ),
    (
        f"M12 · ⚠️ **the same at `pass_question_up`** · {KILLER}",
        [
            (
                TOOLS,
                "          // ⛔ **679** — the answer door's own check, for its reason.\n          if (askedBy !== undefined && (typeof askedBy !== 'string' || askedBy.length === 0)) {\n",
                "          // ⛔ **679** — the answer door's own check, for its reason.\n          if (askedBy === '\\u0000') {\n",
            )
        ],
    ),
    # ── B · the held words ─────────────────────────────────────────────────────────────────────
    (
        # ⛔ **RETIRED BY RULING (landing D-017, 45a11477):** The row's subject — the in-memory
        # `questionsThisAppHolds` Map and its `.get(questionKey(askedBy, requestId))` fast path in
        # `theWordsOf` — no longer exists anywhere in the file; `theWordsOf` now reads only
        # `this.deps.store.questionsRaisedIn(askedBy).get(requestId)` (D-017 · R6). Two OTHER,
        # still-green test files assert this by name: `the-turn-that-no-longer-waits.test.ts`
        # ("D-017 · R6: so did the map itself — `questionsThisAppHolds` is gone... the asker's
        # LEDGER (`theWordsOf`), which replaced the map") and
        # `a-question-does-not-expire-on-a-clock.test.ts` ("gone with the remember/bring-back"),
        # both with `expect(hostCode).not.toContain('questionsThisAppHolds')`. Since `askedBy` is
        # now a mandatory function parameter into a per-session store read rather than a joinable
        # string key, the exact 'reads by id alone' defect is not reproducible by a
        # comparably-scoped edit. Its anchor is left stale, so the census records it retired.
        f"M13 · 🔴 **the answer door reads the held words by the id alone** · a provider's question "
        f"whose id spells a sibling's app question is taken SILENTLY as that sibling's words — `ok`, "
        f"and its own provider never told · {KILLER}",
        [
            (
                HOST,
                # ⚑ **T-003 · re-anchored in place, not retired** — D-009 moved the keyed lookup into
                # `theWordsOf(askedBy, requestId)`, which the answer door now calls. The row still reads
                # the held words by the id alone. Re-verified RED alone.
                "    const held = this.questionsThisAppHolds.get(questionKey(askedBy, requestId))",
                "    const held = this.questionsThisAppHolds.get("
                + BY_THE_ID_ALONE.replace("THE_ID", "requestId")
                + ")",
            )
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-017, 45a11477):** The whole mechanism this row protected
        # — `rememberTheQuestionsItLeftOpen`, `questionsOpenWhenItEnded`, and
        # `bringBackTheQuestionsItWasAsking` (the `661` 'remember on end, re-route on reopen'
        # machinery) — is deleted outright; none of those identifiers exist in `runtime-host.ts` any
        # more. This is the deliberate consequence of D-017's own ruling that 'a stop is not an
        # ending... only a cut handover is abandoned': a question this app asked simply stays `open`
        # in the ledger across a stop, so there is nothing left to 'remember' or 'bring back' on a
        # reopen. `a-question-is-known-by-who-asked-it.test.ts` §3 says so directly: "D-017 · R4: a
        # question this app asked outlives the stop... so the reopen has nothing to route again
        # (`661`'s second routing is gone with the bring-back)." Its anchor is left stale, so the
        # census records it retired.
        f"M14 · 🔴 **a close remembers by the id alone** · a dead provider card is routed again on "
        f"the reopen, because a sibling's app question shares its id · {KILLER}",
        [
            (
                HOST,
                "        if (!this.questionsThisAppHolds.has(questionKey(session.id, request.requestId))) continue\n",
                "        if (![...this.questionsThisAppHolds.keys()].some((key) => key.endsWith(`\\u0000${request.requestId}`))) continue\n",
            )
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-017, 45a11477):** Same removal as M13: the person's door
        # (`respondUserInput`) used to check `questionsThisAppHolds.get(questionKey(sessionId,
        # requestId))` directly; it now calls the same `theWordsOf(sessionId, requestId)` that the
        # agent door uses, which reads the asker's ledger row and never a cross-session-keyed Map.
        # There is no compound key left at this call site to collapse to 'id alone', and the removal
        # is the same D-017 · R6 ruling quoted for M13 ("the asker's LEDGER (`theWordsOf`), which
        # replaced the map"). Its anchor is left stale, so the census records it retired.
        f"M15 · ⛔ **the person's door reads the held words by the id alone** · with the comparison "
        f"the key replaced gone, a person's answer to a provider's card is taken as a sibling's "
        f"words · {KILLER}",
        [
            (
                HOST,
                "    const holding = this.questionsThisAppHolds.get(questionKey(sessionId, requestId))\n",
                "    const holding = this.questionsThisAppHolds.get("
                + BY_THE_ID_ALONE.replace("THE_ID", "requestId")
                + ")\n",
            )
        ],
    ),
    # ── C · what the caller is told ────────────────────────────────────────────────────────────
    (
        f"M16 · ⛔ **the shared-id refusal names no askers** · the sentence sends the caller to the "
        f"detail for the conversations to choose from, and the detail is empty · {KILLER}",
        [
            (
                HOST,
                "        refusal: refuseQuestion('more-than-one-question-has-that-id', {\n          question: questionId,\n          askers,\n",
                "        refusal: refuseQuestion('more-than-one-question-has-that-id', {\n          question: questionId,\n",
            )
        ],
    ),
    (
        f"M17 · ⚠️ **the rail says a retry will pass** · `while-this-holds` over an id that stays "
        f"shared for good — `422` row 10's shape · {KILLER}",
        [
            (
                RAILS,
                "  'more-than-one-question-has-that-id': 'permanent',\n",
                "  'more-than-one-question-has-that-id': 'while-this-holds',\n",
            )
        ],
    ),
    (
        f"M18 · ⛔ **the sentence loses its act** · a caller is told the id is shared and not what to "
        f"send instead · {KILLER}",
        [
            (
                RAILS,
                "    'name which one you mean: make the same call again with asked_by set to one of the conversations the detail lists. More than one",
                "    'More than one",
            )
        ],
    ),
    (
        f"M19 · 🔴 **the words a parent is handed forget the asker** · it quotes the id alone, and a "
        f"shared one is refused the first time round · {KILLER}",
        # ⚑ Landing D-016c commits 6–7 and D-022 (4a7f0fec, c1a79abe, 37228461) · re-anchored in
        # place, not retired — The words a parent is handed still quote the asker beside the id, but
        # commit 7 spells it ${asker.address} (a piece label, or the id) instead of ${asked}. The
        # plant drops the asked_by clause, so the parent is told to quote the id alone and a shared
        # one is refused the first time round. Killed by
        # `a-question-is-known-by-who-asked-it.test.ts`.
        [
            (RAILS, 'Answer it with answer_question, quoting ${request.id} with asked_by ${asker.address}.`,', 'Answer it with answer_question, quoting ${request.id}.`,'),
        ],
    ),
    (
        f"M20 · ⚠️ **the STRUCTURED half of a pass-up's answer drops the asker it carried** · a model "
        f"reading the payload has only the bare id; the prose half still names it — that is M22 · "
        f"{KILLER}",
        [(TOOLS, "              asked_by: passed.carried.askedBy,\n", "")],
    ),
    (
        "M21 · ⛔ **`answer_question` stops advertising `asked_by`** · a model is never told the "
        "field exists — neither the argument list nor its sentence — though the loose shape would "
        "still pass one through: what goes is the advertisement · killed by `who-did-it.test.ts`",
        [
            (
                TOOLS,
                # NOT VERIFIED: typed input wrapping shifted indentation; the same defect is retained.
                "          // above and went false with it.\n          [ASKED_BY_ARGUMENT]: z.string().optional().describe(ASKED_BY_SAYS),\n",
                "          // above and went false with it.\n",
            )
        ],
    ),
    (
        f"M22 · ⚠️ **the PROSE of a pass-up's answer drops the asker it carried** · the passer is "
        f"told to answer with `answer_question` and not which child — the half a model reads first · "
        f"{KILLER}",
        # ⚑ Landing D-016c commits 6–7 and D-022 (4a7f0fec, c1a79abe, 37228461) · re-anchored in
        # place, not retired — The prose half of a pass-up's answer still tells the passer which
        # child to answer for; commit 7 quotes the asker's address through host.addressOf(...)
        # rather than the raw id. The plant drops the asked_by clause, so the passer is told to
        # answer with answer_question and not which child. Killed by
        # `a-question-is-known-by-who-asked-it.test.ts`.
        [
            # ⚑ **W4.136 · re-anchored in place, not retired** — F033: the receipt quotes the asker by the label the carried question's own words gave it, the piece it was asked under
            (TOOLS, "answer_question with asked_by ${host.addressOfUnder(passed.carried.askedBy, passed.carried.piece)} is how it gets back", 'answer_question is how it gets back'),
        ],
    ),
    # ── D · what the review found ──────────────────────────────────────────────────────────────
    (
        f"M23 · 🔴 **a wrong `asked_by` on a LIVE id is called nothing** · `no-question-by-that-name` "
        f"— *no conversation you started is waiting… will never succeed* — about a question a child "
        f"IS waiting on · {KILLER}",
        [
            (
                HOST,
                "      if (theirs.length > 0 || askers.length === 0) {\n",
                "      if (true) {\n",
            )
        ],
    ),
    (
        f"M24 · ⛔ **that refusal names no askers** · its sentence sends the caller to the detail, "
        f"and the detail is empty · {KILLER}",
        [
            (
                HOST,
                "        refusal: refuseQuestion('that-conversation-did-not-ask-that', {\n          question: questionId,\n          askers,\n",
                "        refusal: refuseQuestion('that-conversation-did-not-ask-that', {\n          question: questionId,\n",
            )
        ],
    ),
    (
        f"M25 · ⚠️ **two children's cards of one kind under one id are refused as shared** · "
        f"`asked_by` would be refused for every asker the sentence lists, and the sentence calls "
        f"two permissions questions · {KILLER}",
        [
            (
                HOST,
                "    if (askers.length > 1 && !this.oneKindOfPersonsRequest(underTheId, askers)) {\n",
                "    if (askers.length > 1) {\n",
            )
        ],
    ),
    (
        f"M26 · 🔴 **a card and a QUESTION under one id collapse as a person's** · the caller that "
        f"meant the question is told it is a person's to settle, and nothing reaches the child · "
        f"{KILLER}",
        [
            (
                HOST,
                "    return kinds.size === 1 && !kinds.has(null)\n",
                "    return kinds.size > 0\n",
            )
        ],
    ),
    (
        f"M27 · 🔴 **only OPEN routings count as sharing the id** · the door guesses the one still "
        f"open, and an answer meant for the answered one is taken by its sibling · {KILLER}",
        [
            (
                HOST,
                "    const askers = [...new Set(underTheId.map((one) => one.askedBy))]\n",
                "    const askers = [\n      ...new Set(underTheId.filter((one) => REQUEST_IS_OPEN[one.state]).map((one) => one.askedBy)),\n    ]\n",
            )
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-017, 45a11477):** The old 'slotless asker' branch that
        # separately re-checked `questionsThisAppHolds.has(questionKey(...))` to choose between an
        # 'ended' vs 'has-gone' refusal is gone; `answerQuestion` now decides this with one
        # already-scoped read, `words = this.theWordsOf(request.askedBy, request.requestId)`, and
        # refuses `the-conversation-that-asked-has-gone` only when `words === undefined && session
        # === null` — no separate holds-check exists to plant an id-alone bug into. This is the same
        # deliberate R6 removal as M13/M14/M15 (confirmed by the two non-810 test files asserting
        # `questionsThisAppHolds` is gone for good). Its anchor is left stale, so the census records
        # it retired.
        f"M28 · ⚠️ **the slotless asker's held-words check reads the id alone** · a provider card "
        f"that died with its stream is called *ended — answer it after a reopen*, because a sibling's "
        f"app question shares its id · {KILLER}",
        [
            (
                HOST,
                "      if (this.questionsThisAppHolds.has(questionKey(request.askedBy, request.requestId))) {\n",
                "      if ([...this.questionsThisAppHolds.keys()].some((key) => key.endsWith(`\\u0000${request.requestId}`))) {\n",
            )
        ],
    ),
]
