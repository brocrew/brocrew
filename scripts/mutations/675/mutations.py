"""675 · Every refusal says what is true, and what to do, where it is read.

⛔ **Ordered from the sentence debt five seats found**: `644` F2, `659` F2, `661` F1/F2, `663` F3/F4/F7
and `670` F-c.

## 🔴 A · who reads a refusal's row, measured

⚑ **The model reads the whole answer on both providers; a PERSON reads the transcript row, cut at
`TOOL_SUMMARY_MAX` (200); a parent reads none of a child's refusal.** ⛔ **On Claude the row was not
the sentence at all until `675`**: the app answered `content` + `structuredContent`, and
`probe:claude-tool-answer` measured the pinned CLI handing the model `JSON.stringify` of that field
INSTEAD of the text — so the row read `{"outcome":"refused",…`. ⚑ Two text blocks — the prose, then
the JSON — put the sentence first on both providers (M1, M2).

## ⚑ B · the act inside the cut

⚑ Every sentence leads with what stopped it and the act, then the why; `the-act-inside-the-cut`
measures where each act ends. 52 of 91 rows had it past the cut; none do now. M24-M26 put three back.

## ⚑ C · the seven sentences

`#1` interrupt's `already-ended` (M21) · `#2` has-gone while the words are held (M14, M15) · `#3`
`abandoned` and the listing (M18-M20) · `#4` / `#5` said per caller, asking the wake's own questions
(M7-M13) · `#6` the wake's own fold word (M16, M17) · `#7` too-many-for-this-parent (M22, M23).

## ⚑ D · `670` F-c — a class name at the IPC door (M3-M6)

## ⚠️ E · rows this dispatch corrected elsewhere, and why none was retired

⚑ **Twenty-six anchors moved and every subject survived**: twenty-two rows on refusal sentences
reordered so their act fits the row (`341 M34`, `347 M28`, `366 M7`, `415 M11`, `424 M18`/`M19`/`M20`,
`425 M13`/`M14`, `428 M6`/`M7`, `459 M18`, `496 M8`/`M9`, `517 M8`/`M9`, `553 M14`, `590 M7`,
`628 M7`/`M10`, `629 M7`, `663 M54` — twenty-two rows); the question listing reads its rows in a loop (`396 M13`); the
ended checks name the asker (`661 M9`/`M10`); and `663 M3`'s line is now also asked by
`aWakeWouldBeAsked`, so its anchor carries the comment beneath it in `wakeSession`. ⛔ Each was
re-verified RED by hand against the test that pins its subject.

## ⚠️ T-003 · after D-010 (`8bc565fa`) and D-011 (`79245533`)

D-010 deleted `MessageAlreadyHeld` with the singleton: M6 is retired by ruling, and §D's (M3–M6) reads
M3–M5.
"""

HOST = "apps/desktop/src/main/runtime/runtime-host.ts"
TOOLS = "apps/desktop/src/main/runtime/agent-tools.ts"
IPC = "apps/desktop/src/main/runtime/ipc.ts"
HELD = "apps/desktop/src/main/runtime/queued-message.ts"
SPAWN = "apps/desktop/src/main/runtime/spawn-rails.ts"
INTERRUPT = "apps/desktop/src/main/runtime/interrupt-rails.ts"
CLAUDE_TOOLS = "packages/runtime/src/claude/agent-tools.ts"
CLAUDE_NORMALIZE = "packages/runtime/src/claude/normalize.ts"

# There is no cwd-outside-parent sentence to mutate. Retain its absent anchor as retired because the
# planted behavior is now intended.
MUTATIONS: list[tuple[str, list[tuple[str, str, str]]]] = [
    # ── A · the Claude transport ───────────────────────────────────────────────────────────────
    # Re-anchored, NOT VERIFIED; no mutant or killer was run.
    (
        "M1 · 🔴 **the Claude answer goes back to `structuredContent`** · the shape the CLI replaces "
        "with its own JSON: a Claude model never reads the prose, and a person's row is our JSON",
        [('packages/runtime/src/claude/agent-tools.ts', "              content: [{ type: 'text' as const, text: answer.text }],", "              content: [{ type: 'text' as const, text: answer.text }],\n              ...(answer.structured === undefined ? {} : { structuredContent: answer.structured }),")],
    ),
    # RETIRED: the former JSON/order/echo contract was removed.
    (
        "M2 · ⚠️ **the payload goes FIRST** · two blocks, the wrong way round: the row a person reads "
        "is the JSON again, with the sentence behind it",
        [
            (
                CLAUDE_TOOLS,
                "              content: [\n                { type: 'text' as const, text: answer.text },\n                ...(answer.structured === undefined\n                  ? []\n                  : [{ type: 'text' as const, text: JSON.stringify(answer.structured) }]),\n              ],\n",
                "              content: [\n                ...(answer.structured === undefined\n                  ? []\n                  : [{ type: 'text' as const, text: JSON.stringify(answer.structured) }]),\n                { type: 'text' as const, text: answer.text },\n              ],\n",
            )
        ],
    ),
    # ── D · the IPC door ───────────────────────────────────────────────────────────────────────
    (
        "M3 · 🔴 **the runtime door stops re-throwing** · `670` F-c put back: a person reads "
        "*\"MessageAlreadyHeld: …\"* at the Queue button, and at a send that lost its race",
        [
            (
                IPC,
                "    executeRuntimeCommand(options.host, options.sinkFor(event), raw).catch((error: unknown) => {\n      throw withoutItsClassName(error)\n    }),\n",
                "    executeRuntimeCommand(options.host, options.sinkFor(event), raw),\n",
            )
        ],
    ),
    (
        "M4 · ⚠️ **the re-throw keeps the class** · the door is wired and does nothing",
        [
            (
                IPC,
                "  if (!(error instanceof Error) || error.name === 'Error') return error\n  return new Error(error.message, { cause: error })\n",
                "  return error\n",
            )
        ],
    ),
    (
        "M5 · ⚠️ **the re-throw drops the original** · the log loses the class and every "
        "`instanceof` downstream of the door loses what it was asked about",
        [
            (
                IPC,
                "  return new Error(error.message, { cause: error })\n",
                "  return new Error(error.message)\n",
            )
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (T-003): D-010 (8bc565fa).** D-010 deleted the sentence along with
        # its class. Its anchor is left stale, so the census records it retired (`anchor-absent`).
        "M6 · ⚠️ **the held sentence says QUEUEING again** · since `670` a person who pressed Send "
        "meets it too, and is told about a button they did not press",
        [
            (
                HELD,
                "cancel it, or wait for it to go, before adding another",
                "cancel it, or wait for it to go, before queueing another",
            )
        ],
    ),
    # ── C #4 · agent-cannot-take-a-message, per caller ─────────────────────────────────────────
    (
        # ⛔ **RETIRED BY RULING (landing D-017, 45a11477):** The whole hint mechanism this row
        # protects — `aWakeWouldBeAsked` and the `THIS_ONE_IS_YOURS_TO_WAKE` reason it attached to a
        # `cannot`-type refusal — is deleted outright by 45a11477 (git show:
        # `-aWakeWouldBeAsked(sessionId: string, by: Caller): boolean { ... }` removed with no
        # replacement). D-017 replaces 'refuse and hint that resume_agent could wake it' with
        # actually starting the recipient (`ensureRunning`), so nothing computes this hint any more.
        # Its anchor is left stale, so the census records it retired.
        "M7 · 🔴 **every caller is told a person must put it right** · `663` F3 put back: the parent "
        "that started it and holds its work is told nothing it can do, while `resume_agent` would wake it",
        [
            (
                TOOLS,
                "              host.aWakeWouldBeAsked(agent, by)\n                ? { ...cannot, reason: THIS_ONE_IS_YOURS_TO_WAKE }\n                : cannot,\n",
                "              cannot,\n",
            )
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-017, 45a11477):** Same deletion as M7:
        # `aWakeWouldBeAsked` and `THIS_ONE_IS_YOURS_TO_WAKE` no longer exist anywhere in
        # agent-tools.ts or runtime-host.ts (verified by grep — zero hits). The commit message's
        # `'Still starting' and 'still closing' are no longer refusals` is the design change that
        # removes this sentence's reason to exist. Its anchor is left stale, so the census records
        # it retired.
        "M8 · ⛔ **every caller is told to wake it** · a sentence naming `resume_agent` to a caller "
        "that door refuses — `402`'s defect, said to everyone who is not the parent",
        [
            (
                TOOLS,
                "              host.aWakeWouldBeAsked(agent, by)\n                ? { ...cannot, reason: THIS_ONE_IS_YOURS_TO_WAKE }\n                : cannot,\n",
                "              { ...cannot, reason: THIS_ONE_IS_YOURS_TO_WAKE },\n",
            )
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-017, 45a11477):** This line (`if
        # (this.runningStateOf(sessionId) !== 'not-running') return false`) lived inside
        # `aWakeWouldBeAsked`, which is deleted whole in this commit's diff. The fact it guarded (a
        # running conversation is not woken) is still enforced, but at a different door with a
        # different purpose — `wakeSession`'s own `if (this.runsNow(sessionId)) { ... return
        # said('that-conversation-is-running') }` — not as a hint predicate feeding a `resume_agent`
        # sentence, which no longer exists. Its anchor is left stale, so the census records it
        # retired.
        'M9 · 🔴 **the predicate forgets that a RUNNING conversation is not woken** · a parent with work in its own running child is told *resume_agent can wake it*, and that door answers *it is running*',
        [
            (
                HOST,
                "      if (this.runningStateOf(sessionId) !== 'not-running') return false\n",
                '',
            ),
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-017, 45a11477):** Targets a line inside the deleted
        # `aWakeWouldBeAsked` (`if (this.reachRefusalOf('message', sessionId, by) !== null) return
        # false`). The function, and every refusal that consulted it, is gone from 45a11477; reach
        # is still asked when an actual wake happens (`aReachRefusal` inside
        # `whyThisCallerMayNotWakeIt`), but that is a different, still-applying path with no row
        # assigned to it here. Its anchor is left stale, so the census records it retired.
        'M10 · ⛔ **the predicate asks the fold and not REACH** · a parent a person narrowed is still told to wake it, and the door refuses it `may-not-message`',
        [
            (
                HOST,
                "    if (this.reachRefusalOf('message', sessionId, by) !== null) return false\n",
                '',
            ),
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-017, 45a11477):** Plants a defect across both lines of
        # `aWakeWouldBeAsked`'s fold+reach check; the whole method is deleted in this commit. Its
        # replacement, `whyThisCallerMayNotWakeIt`, asks the equivalent two questions but for the
        # real wake (`wakeSession`/`resume_agent`), not for a hint attached to someone else's
        # refusal — a different rule with its own (unaffected) row family (M16/M17), not this one.
        # Its anchor is left stale, so the census records it retired.
        "M11 · ⛔ **the predicate asks nothing past the state** · any caller that may reach a stopped conversation is told to wake it — a person's conversation, another agent's child",
        [
            (
                HOST,
                "    if (!this.theWakesFoldAdmits(me, sessionId)) return false\n    if (this.reachRefusalOf('message', sessionId, by) !== null) return false\n",
                '    return true\n',
            ),
        ],
    ),
    # ── C #5 · has-ended, per caller ───────────────────────────────────────────────────────────
    (
        # ⛔ **RETIRED BY RULING (landing D-017, 45a11477):** `aWakeWouldBeAsked` and
        # `THE_ASKER_IS_YOURS_TO_WAKE` are deleted with `theAskerHasEnded`, the method this line
        # lived in. DEV's own test comment says it outright:
        # `what-a-close-does-that-a-reopen-never-undoes.test.ts` — "#5 and its two controls retired
        # with their subject (D-017)... the rail and its sentences are gone: an answer to a stopped
        # asker is taken and starts it." Its anchor is left stale, so the census records it retired.
        "M12 · 🔴 **the answer door tells every caller somebody else must reopen it** · `663` F3 at "
        "the question door: the parent that can wake the asker is not told so",
        [
            (
                HOST,
                "    return this.aWakeWouldBeAsked(askedBy, by)\n      ? { ...refusal, reason: THE_ASKER_IS_YOURS_TO_WAKE }\n      : refusal\n",
                "    return refusal\n",
            )
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-017, 45a11477):** Same subject as M12 (`theAskerHasEnded`
        # / `THE_ASKER_IS_YOURS_TO_WAKE`), same deletion, same DEV comment confirming it was retired
        # on purpose: an answer to a stopped asker is now taken and starts it (D-017 R1), so there
        # is no 'somebody else must reopen it' sentence left to plant a wrong caller into. Its
        # anchor is left stale, so the census records it retired.
        "M13 · ⛔ **the answer door tells every caller to wake the asker** · `402`'s defect at the "
        "question door",
        [
            (
                HOST,
                "    return this.aWakeWouldBeAsked(askedBy, by)\n      ? { ...refusal, reason: THE_ASKER_IS_YOURS_TO_WAKE }\n      : refusal\n",
                "    return { ...refusal, reason: THE_ASKER_IS_YOURS_TO_WAKE }\n",
            )
        ],
    ),
    # ── C #2 · has-gone while the words are held ───────────────────────────────────────────────
    (
        # ⛔ **RETIRED BY RULING (landing D-017, 45a11477):** `questionsThisAppHolds` and
        # `theAskerHasEnded` no longer exist anywhere in runtime-host.ts. `answerQuestion` now only
        # refuses `the-conversation-that-asked-has-gone` when both the held words (`theWordsOf`) are
        # undefined AND nothing is running — a stopped-but-recorded asker is started and answered,
        # per D-017 R1/D-009: "a person's answer reaches the asker like any other message, starting
        # the asker if needed, and the question closes." Its anchor is left stale, so the census
        # records it retired.
        "M14 · 🔴 **a question this app raised is GONE again while its words are held** · `661` F1 "
        "put back: *\"Retrying this will never succeed\"*, and the reopen then takes the identical answer",
        [
            (
                HOST,
                # ⚠️ **RE-ANCHORED at 679, not retired.** The held words are asked by the ASKER and the id (`questionKey`, 675 F-b); the DEFECT this row plants is unchanged.
                "      if (this.questionsThisAppHolds.has(questionKey(request.askedBy, request.requestId))) {\n        return {\n          ok: false,\n          refusal: this.theAskerHasEnded(request.requestId, request.askedBy, by),\n        }\n      }\n",
                "",
            )
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-017, 45a11477):** Same `questionsThisAppHolds` gate as
        # M14, now gone; there is no more 'ended vs not-yet-ended' branch to corrupt with
        # `request.requestId !== ''`. The commit's rule (only a request the conversation's own
        # PROVIDER raised is `abandoned` by a stop; an app-raised question outlives it) is enforced
        # by the new `words`/`session` check, not by this deleted map. Its anchor is left stale, so
        # the census records it retired.
        "M15 · ⚠️ **every asker that is not running is ENDED, not gone** · a question its PROVIDER "
        "raised died with its child, and the caller is told a reopen will bring it back",
        [
            (
                HOST,
                # ⚠️ **RE-ANCHORED at 679, not retired** — M14's line, keyed by the asker; the DEFECT this row plants is unchanged.
                "      if (this.questionsThisAppHolds.has(questionKey(request.askedBy, request.requestId))) {\n",
                "      if (request.requestId !== '') {\n",
            )
        ],
    ),
    # ── C #6 · the wake's own fold word ────────────────────────────────────────────────────────
    (
        "M16 · 🔴 **the wake's fold answers `no-such-agent` again** · `663` F4 put back: the caller is "
        "sent to `list_agents`, which lists running conversations — and the one it could wake is not",
        # ⚑ Landing D-017 (5206d835) · re-anchored in place, not retired — This is exactly the risk
        # D-017 rule 6 and R12 are about, and it is central to THIS commit's own new mechanism, not
        # the deleted wake fold: `RuntimeHost.whyItIsOutOfReach` / `outOfReachAnswer` in
        # agent-tools.ts is the one place that must answer `no-such-agent` ONLY for an id no
        # conversation has, and the reach rail for one that exists but is out of reach. Folding the
        # 'outside-its-reach' arm back into `no-such-agent` reproduces the row's defect at the new,
        # unified door.
        # ⚑ Landing D-016b (5e931be8, the tree) · re-anchored in place, not retired — The rule
        # survives at D-017's single out-of-reach door: `no-such-agent` is said only for an id no
        # conversation has, and a real conversation outside the caller's reach gets the reach rail.
        # Only the anchor drifted (`...facts` was dropped from the refusal call). The plant folds
        # the `outside-its-reach` arm back into `no-such-agent`, as the row's prior D-017 landing
        # already did. Killed by `a-reach-you-can-see.test.ts`.
        [
            (TOOLS, "  if (out.is === 'no-such-agent') return refusalAnswer(refuseTool('no-such-agent', { agent }))\n", "  if (out.is === 'no-such-agent' || out.is === 'outside-its-reach') return refusalAnswer(refuseTool('no-such-agent', { agent }))\n"),
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-017, 5206d835):** The refusal sentence this row protects
        # is `no-conversation-of-yours-to-wake`'s own text, naming `resume_agent` by name
        # ('resume_agent wakes one you started that still holds work you gave it'). Both the rail
        # and `resume_agent` are gone — grep confirms zero remaining occurrences of that rail or
        # sentence anywhere in the tree — and the policy it expressed (only a holder of open work is
        # wakeable) is itself retired (see 663 M6/M7). Its anchor is left stale, so the census
        # records it retired.
        "M17 · ⚠️ **the new word points at `list_agents`** · the door that never holds a wakeable id",
        [
            (
                TOOLS,
                "    'nothing by that id is yours to wake, so nothing was done. list_tasks names each holder as given_to; resume_agent wakes one you started that still holds work you gave it.',",
                "    'nothing by that id is yours to wake, so nothing was done. list_agents names the ones you can reach; resume_agent wakes one you started that still holds work you gave it.',",
            )
        ],
    ),
    # ── C #3 · the listing ─────────────────────────────────────────────────────────────────────
    (
        "M18 · 🔴 **the listing shows every routing again** · `661` F2 put back: a question a reopen "
        "brought back is listed twice, `abandoned` beside `open`",
        [
            (
                HOST,
                "      latest.delete(key)\n      latest.set(key, one)\n",
                "      latest.set(`${key}\\u0000${latest.size}`, one)\n",
            )
        ],
    ),
    (
        "M19 · ⛔ **the listing is keyed by the id ALONE** · two children's questions with one "
        "session-local provider id merge into one — measured by this dispatch's own first draft",
        [
            (
                HOST,
                # ⚠️ **RE-ANCHORED at 679, not retired.** The listing's key is `questionKey`, now shared with both answer doors; the DEFECT this row plants — the id alone — is unchanged.
                "      const key = questionKey(one.askedBy, one.requestId)\n",
                "      const key = one.requestId\n",
            )
        ],
    ),
    (
        # ⚑ Landing D-017 (45a11477) · killer:
        # `abandoned-prints-its-reason-not-the-bare-word.test.ts` (the landing added it; the row
        # named none).
        "M20 · ⚠️ **`abandoned` prints as the bare word again** · a reader is left to guess whether "
        "it will come back",
        # ⚑ Landing D-017 (45a11477) · re-anchored in place, not retired — The `abandoned` entry in
        # `QUESTION_STATE_SENTENCE` still exists — only its wording changed (D-017 R4 rewrote it to
        # say the request stopped with its conversation and does not come back, dropping the old 'if
        # it comes back, it is listed here again as open' since it never does now). The row's defect
        # (deleting the entry so the state prints bare) still applies verbatim to the new entry.
        [
            (TOOLS, "  abandoned:\n    'the conversation that raised it stopped while it was waiting, and the request stopped with it, so it cannot be answered',\n", ''),
        ],
    ),
    # ── C #1 and #7 ────────────────────────────────────────────────────────────────────────────
    (
        # ⛔ **RETIRED BY RULING (landing D-017, 5206d835):** `interruptAgent` no longer answers a
        # stopped/stopping conversation with a REFUSAL sentence at all. `nothingToInterrupt` now
        # returns a SUCCESS outcome (`{ ok: true, asked: false, state: ... }`), matching the card's
        # own words ('an idle target answers that there was nothing to interrupt'); the code's own
        # comment says the state is read from the one derivation and is 'never a word of this door's
        # own.' There is no 'is over' vs 'has stopped or is being stopped' sentence left to get
        # wrong. Its anchor is left stale, so the census records it retired.
        "M21 · 🔴 **`interrupt_agent` says the conversation is OVER while it is still ending** · "
        "`659` F2 put back, in the same instant the card says `ending`",
        [
            (
                INTERRUPT,
                "    'that conversation has stopped or is being stopped, so this interrupted nothing: whatever it was doing ends with it. Retrying this will never succeed; the detail gives its state.',",
                "    'that conversation is over, so there was nothing running to interrupt. Retrying this will never succeed; the detail says how it ended.',",
            )
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-014, 010f9426):** `too-many-for-this-parent`,
        # `too-many-live-spawns` and their "held up … raises the limit" sentences are deleted from
        # spawn-rails.ts along with the fan-out cap ("with no fan-out cap"; max_concurrent is
        # unread). No count limit is left: the only limit refusal remaining is `too-deep`, and
        # nothing a caller does lowers a depth, so this clause has no sentence to live in. Its
        # anchor is left stale, so the census records it retired.
        "M22 · 🔴 **the limit says nothing the caller does lowers it** · `663` F7 put back — and the "
        "parent's own `end_agent` does",
        [
            (
                SPAWN,
                "        'held up. The number falls when one you started finishes ending, or when a person raises ' +\n        'the limit.'",
                "        'held up. Nothing you do here lowers that number: a person raises the limit or closes one.'",
            )
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-014, 010f9426):** This is the same deleted sentence as
        # M22: the fan-out cap's refusal no longer exists ("no fan-out cap", card and commit). The
        # only limit refusal left is `too-deep` (a depth, not a count), and neither of its sentences
        # (spawn or wake) could name end_agent as a remedy. Its anchor is left stale, so the census
        # records it retired.
        "M23 · ⛔ **the limit recommends `end_agent`** · `424`'s line: a bound must not teach destruction — and `402`'s, since that door refuses a caller a person narrowed",
        [
            (
                SPAWN,
                "        'held up. The number falls when one you started finishes ending, or when a person raises ' +\n        'the limit.'",
                "        'held up. The number falls when one you started finishes ending, or when a person raises ' +\n        'the limit. End one you started with end_agent and it falls.'",
            ),
        ],
    ),
    # ── B · the act inside the cut ─────────────────────────────────────────────────────────────
    (
        "M24 · 🔴 **`that-is-work-you-hold`'s act goes back past the cut** · `644` F2's own exemplar: "
        "the two verbs sit after the rule, where no person reads them",
        # ⚑ Landing D-016b (5e931be8, the tree) · re-anchored in place, not retired —
        # `that-is-work-you-hold` survives as a `TOOL_REFUSALS` sentence that now says 'piece'
        # instead of 'task' and drops the `message_agent speaks about...` clause. It is still an ACT
        # row in the-act-inside-the-cut census (act: 'call ask_question naming that piece; to hand
        # it back finished, call reply_to_parent'). The plant moves the explanation ahead of the two
        # verbs, so the act ends at about char 349, past the 200-char cut. Killed by
        # `the-act-inside-the-cut.test.ts`.
        [
            (TOOLS, 'that is a piece you are HOLDING, so nothing was sent. To ask about it, call ask_question naming that piece; to hand it back finished, call reply_to_parent. A follow-up is about a piece you gave to somebody else; with ask_question the work stays yours and stays open, and reply_to_parent ends it.', 'that is a piece you are HOLDING, not one you gave out, so nothing was sent. A follow-up is about a piece you gave to somebody else; with ask_question the work stays yours and stays open, and reply_to_parent ends it. To ask about it, call ask_question naming that piece; to hand it back finished, call reply_to_parent.'),
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-016a, bd70d693):** The `not-your-project` refusal and its
        # 'Leave the project out' sentence were removed from `spawn-rails.ts` by bd70d693. D-016a
        # drops 'same-project reach and the project argument on spawn_agent and list_agents', and no
        # `not-your-project` string remains in apps/desktop/src. Its anchor is left stale, so the
        # census records it retired.
        "M25 · ⚠️ **`not-your-project`'s act goes back after the slugs** · two 64-character names "
        "push *leave the project out* out of the row",
        [
            (
                SPAWN,
                "        'A conversation you start may not work in that project, so nothing was started. Leave the ' +\n        'project out and it works where you do. It may work in the project you are working in, or ' +",
                "        'A conversation you start may not work in that project, so nothing was started. It may ' +\n        'work in the project you are working in, or ' +",
            ),
            (
                SPAWN,
                "        'This tells you nothing about whether the project you named exists.'",
                "        'This tells you nothing about whether the project you named exists. Leave the ' +\n        'project out and it works where you do.'",
            ),
        ],
    ),
    (
        "M26 · ⚠️ **`cwd-outside-parent`'s act goes back after the paths** · a path has no length "
        "limit, so the folder to ask for can fall out of the row whole",
        [
            (
                SPAWN,
                "            'neither, so nothing was started. Ask for your folder, or for one under it. You are ' +\n            `working in “${detail.boundCwd ?? '?'}”, and you asked for “${detail.requestedCwd ?? '?'}”. ` +",
                "            `neither, so nothing was started. You are working in “${detail.boundCwd ?? '?'}”, and you ` +\n            `asked for “${detail.requestedCwd ?? '?'}”. Ask for your folder, or for one under it. ` +",
            )
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-017, 45a11477):** `A_WAKE_WAITS_OUT_A_COUNT` and the line
        # it guarded are deleted along with `aWakeWouldBeAsked` (git show: both the constant's
        # declaration and `return refusal === null ||
        # A_WAKE_WAITS_OUT_A_COUNT.includes(refusal.rail)` are removed, no replacement). This was
        # the hint function mirroring `admitWake`'s launch rails for a `resume_agent` sentence that
        # no longer exists; the real wake's own rail check (`admitWake` inside `resumeSession`'s
        # synchronous window) is untouched and unrelated to this row. Its anchor is left stale, so
        # the census records it retired.
        "M27 · 🔴 **the predicate skips the launch rails a PERSON sets** · the review's finding put back: a parent whose `canSpawn` a person emptied is told *resume_agent can wake it*, and that door refuses it `not-in-can-spawn`",
        [
            (
                HOST,
                '    return refusal === null || A_WAKE_WAITS_OUT_A_COUNT.includes(refusal.rail)\n',
                '    return true\n',
            ),
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-017, 45a11477):** Same deleted line as M27
        # (`A_WAKE_WAITS_OUT_A_COUNT.includes(refusal.rail)` inside `aWakeWouldBeAsked`), same
        # wholesale removal. The COUNT-waiting nuance it plants against (a dying child's in-flight
        # profile reservation) has no hint-sentence consumer left to corrupt. Its anchor is left
        # stale, so the census records it retired.
        'M28 · ⚠️ **a COUNT the dying child still holds takes the sentence away** · the wake waits that teardown out, and the parent is told a person must put it right',
        [
            (
                HOST,
                '    return refusal === null || A_WAKE_WAITS_OUT_A_COUNT.includes(refusal.rail)\n',
                '    return refusal === null\n',
            ),
        ],
    ),
    (
        'M29 · 🔴 **the Claude row joins the blocks again** · every short app-tool answer ends in our JSON: `…listed in the detail.{"outcome":…`',
        [
            (
                CLAUDE_NORMALIZE,
                "  const first = textParts(content).find((part) => part.trim() !== '')\n  return first === undefined ? 'done' : truncate(first)\n",
                "  const text = textParts(content).join('')\n  return text ? truncate(text) : 'done'\n",
            ),
        ],
    ),
    (
        "M30 · ⚠️ **`read_document` says the document twice** · the model's context doubles, and the CLI moves a large answer out of line at half the size",
        [
            (
                TOOLS,
                "                read.content.as === 'not-for-a-model'\n                  ? { ...read.content }\n                  : { as: read.content.as },\n",
                '                { ...read.content },\n',
            ),
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing PE-006, D-018 and D-025):** Retire. The sentence this row
        # defended was removed on purpose: PE-006 (3c0c4280, 'feat(PE-006): orient refusals and keep
        # replies short') replaced 'somebody else has to put that conversation right' with 'ask a
        # person to inspect why that conversation cannot take a message; do what you can here', and
        # re-pinned the-act-inside-the-cut's ACT entry to that wording. The row's premise, that a
        # parent is told `resume_agent` instead, went with D-017 (5206d835, 'end_agent and
        # resume_agent are gone (21 tools)'). The rail stays priced `until-a-person-changes-it`, so
        # naming a person is now the product's intended behaviour, and the plant would restate it.
        # Its anchor is left stale, so the census records it retired.
        'M31 · ⚠️ **`agent-cannot-take-a-message` says a PERSON must put it right again** · false since `663` for every caller but the parent, who is told `resume_agent` instead',
        [
            (
                TOOLS,
                'somebody else has to put that conversation right, and coming back',
                'a person has to put that conversation right, and coming back',
            ),
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-014, 010f9426):** `not-in-can-spawn` and its case in the
        # refusal text are deleted. The card says "no `can_spawn` / `not-in-can-spawn`" and the
        # commit says "Any agent may start a conversation as any existing profile". Its anchor is
        # left stale, so the census records it retired.
        'M32 · ⚠️ **`not-in-can-spawn` says what the caller ASKED for** · at the wake door the caller named an id and no profile, so the clause is false there',
        [
            (
                SPAWN,
                "'start is a person’s decision and cannot be widened from here. The one it may not start is ' +",
                "'start is a person’s decision and cannot be widened from here. It asked for ' +",
            ),
        ],
    ),
]
