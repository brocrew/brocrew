"""2003 · the landing's table for `ui` batch 3: `032301e7` and `2fa50d7d` (UI-001) and `fe0b0f2a`.

⚑ **Why `2003`**: `ui` batches are numbered `2000 + n` (see `2001`, `2002`).

 * `M1`–`M19`   **a sub-agent says what its rail row says** (`032301e7`): the chips, the open card's
                plate and word, and its own sub-agents are drawn from the rail row; a conversation the
                rail does not name yet is faceless. The seat's `the-card-says-what-the-rail-says.dom.test.ts`
                and the landing's `the-rail-row-is-what-every-plate-under-the-strip-draws.dom.test.ts`.
 * `M20`–`M29`  **the rail re-reads its list** (`2fa50d7d`) when the waits reading or the work moves,
                and on the half-minute tick.
 * `M30`–`M49`  **a question sent is a card** (`fe0b0f2a`): the fold pairs `question_asked` with the call
                that asked it, and OutgoingEntry says where it went and what became of it, never
                *waiting*. The seat's `a-question-sent-is-a-card` and `the-question-card-on-the-askers-page`,
                and the landing's `the-question-card-says-what-became-of-the-question.dom.test.ts`.

Designed read-only by Sonnet 5.5 agents from the commits and today's code; each row verified alone by the
landing agent.

## Verification

The landing agent verified every row alone with `verify_row.py` (applied, its own killer files run,
restored from bytes). The table has not been run.
- **RED: 42 of 42.** Each killer file ran green unmutated first.
- ⚑ `M20`–`M29` are killed by a SOURCE census (`the-rails-list-is-asked-again-when-an-agents-state-may-have-moved.test.ts`):
  nothing in either test tree mounts `RuntimeScreen.vue`, so its three re-read triggers can only be read
  there; the guard expressions are evaluated, not just matched.
"""

AGENT_CARD_VUE = "apps/desktop/src/renderer/src/components/AgentCard.vue"
OUTGOING_ENTRY_VUE = "apps/desktop/src/renderer/src/components/OutgoingEntry.vue"
QUESTION_CARD_VUE = "apps/desktop/src/renderer/src/components/QuestionCard.vue"
RUNTIME_SCREEN_VUE = "apps/desktop/src/renderer/src/components/RuntimeScreen.vue"
SESSION_BOT_VUE = "apps/desktop/src/renderer/src/components/SessionBot.vue"
SIDE_RAIL_VUE = "apps/desktop/src/renderer/src/components/SideRail.vue"
WORKING_TOGETHER_VUE = "apps/desktop/src/renderer/src/components/WorkingTogether.vue"
QUESTION_CARD = "apps/desktop/src/renderer/src/lib/question-card.ts"
TRANSCRIPT = "apps/desktop/src/renderer/src/lib/transcript.ts"

MUTATIONS: list[tuple[str, list[tuple[str, str, str]]]] = [
    (
        "M1 · 🔴 a chip under the strip draws the band's own reading again, not its rail row · Ana loses the scheduled clock and Ayo reads 'using a tool' while he waits on BroBot's answer — killed by `the-card-says-what-the-rail-says.dom.test.ts` — killed by `the-card-says-what-the-rail-says.dom.test.ts`",
        [
            (WORKING_TOGETHER_VUE, "v-bind=\"asTheRailSays(card.conversation, card.facets).facets\"", "v-bind=\"card.facets\""),
        ],
    ),
    (
        "M2 · 🔴 the open card's PLATE is the band's reading while its word is the rail's · the card says 'waiting on BroBot's answer' over a face that is busy with a tool — killed by `the-rail-row-is-what-every-plate-under-the-strip-draws.dom.test.ts` — killed by `the-rail-row-is-what-every-plate-under-the-strip-draws.dom.test.ts`",
        # The open-card plate under the strip no longer exists. Chip plate and dot behavior have
        # separate rows; redirecting this row would duplicate them or target another removed panel.
        # Leave its absent anchor recorded as retired.
        [
            (WORKING_TOGETHER_VUE, ":facets=\"openSays.facets\"", ":facets=\"openAgent.facets\""),
        ],
    ),
    (
        "M3 · ⚑ the open card is not handed its rail row's word · WorkingTogether stops passing `word`, so the card falls back to the plate's own 'scheduled' with no clock and never says whose answer it waits on — killed by `the-card-says-what-the-rail-says.dom.test.ts` — killed by `the-card-says-what-the-rail-says.dom.test.ts`",
        # ⛔ **RETIRED BY RULING (landing ui f1fa1e2e…70aaa954):** The open card handed its rail row's word
        # (`:word="openSays.word"`) is gone with the card, and the seat's test says so: 'The WORD this
        # file also read went with the card under the strip ... What stays on the right panel is the
        # chip's plate.' The only live word-from-the-rail path is the chosen-agent card of 70aaa954
        # (SessionPanel `subject.word`), which UI-006 removes, and the conversation on screen is handed no
        # `word` (`word: undefined`), so there is no stable anchor to move the row to. A second agent
        # found the rule re-applied, for now, on 70aaa954's chosen-agent card (`inspecting` in
        # ConversationPane, `subject` in SessionPanel); the frontend's note asks for no rows on that
        # machinery, which UI-006 removes, so the row is retired rather than moved onto it. Its anchor is
        # left stale, so the census records it retired.
        [
            (WORKING_TOGETHER_VUE, "        :word=\"openSays.word\"\n", ""),
        ],
    ),
    (
        "M4 · ⚑ SessionBot ignores the word it is handed · an agent under the strip wears the plate's own word, so the card and its rail row say two things — killed by `the-card-says-what-the-rail-says.dom.test.ts` — killed by `the-card-says-what-the-rail-says.dom.test.ts`",
        # ⛔ **RETIRED BY RULING (landing D-027, the ui stretch to 3ef68f7f and D-038):** 8ad072f7 removed
        # the handed-in word on purpose: '`word` goes from AgentCard and SessionBot, whose word is the
        # plate's own again' (its only source was the chosen agent's card, which UI-006 deleted).
        # `props.word ?? plateWord(...)` no longer exists. Its anchor is left stale, so the census records
        # it retired.
        [
            (SESSION_BOT_VUE, "props.word ?? plateWord(props.facets, props.state)", "plateWord(props.facets, props.state)"),
        ],
    ),
    (
        "M5 · ⚑ AgentCard swallows the word on its way to the bot · the card's plate is the rail's but the line under it is the plate's own reading — killed by `the-card-says-what-the-rail-says.dom.test.ts` — killed by `the-card-says-what-the-rail-says.dom.test.ts`",
        # ⛔ **RETIRED BY RULING (landing D-027, the ui stretch to 3ef68f7f and D-038):** Same commit,
        # 8ad072f7: the `:word="props.word"` hand-off from AgentCard to SessionBot went with the `word`
        # prop ('`word` goes from AgentCard and SessionBot, whose word is the plate's own again'). Nothing
        # is left to swallow. Its anchor is left stale, so the census records it retired.
        [
            (AGENT_CARD_VUE, "      :word=\"props.word\"\n", ""),
        ],
    ),
    (
        "M6 · ⛔ a conversation the rail does not name yet draws the band's working plate instead of the faceless one · a row not yet listed claims 'using a tool' — killed by `the-card-says-what-the-rail-says.dom.test.ts` — killed by `the-card-says-what-the-rail-says.dom.test.ts`",
        [
            (WORKING_TOGETHER_VUE, "return rail.get(conversation) ?? { facets: {} }", "return rail.get(conversation) ?? { facets: own }"),
        ],
    ),
    (
        "M7 · ⛔ with no rail on screen every plate under the strip is faceless · the band's own reading is thrown away where it is the only reading there is — killed by `the-card-says-what-the-rail-says.dom.test.ts` — killed by `the-card-says-what-the-rail-says.dom.test.ts`",
        [
            (WORKING_TOGETHER_VUE, "if (rail === null) return { facets: own }", "if (rail === null) return { facets: {} }"),
        ],
    ),
    (
        "M8 · 🔴 an open agent's own sub-agents keep the forest's reading, not their rail row · a sub-agent waiting on an answer or holding a job shows the process's busy face — killed by `the-rail-row-is-what-every-plate-under-the-strip-draws.dom.test.ts` — killed by `the-rail-row-is-what-every-plate-under-the-strip-draws.dom.test.ts`",
        # ⛔ **RETIRED BY RULING (landing ui f1fa1e2e…70aaa954):** The open agent's own sub-agents
        # (`their-own` chips with `asTheRailSays(row.conversation, row.facets)`) went with the card: the
        # rail-row test's section 2 now reads 'went with the card that drew its subject', and f1fa1e2e
        # says 'the open card's own sub-agents went with the card'. The same plant on the strip chip is
        # already 2003 M1, so a re-anchor would duplicate it. Its anchor is left stale, so the census
        # records it retired.
        [
            (WORKING_TOGETHER_VUE, "v-bind=\"asTheRailSays(row.conversation, row.facets).facets\"", "v-bind=\"row.facets\""),
        ],
    ),
    (
        "M9 · ⚑ the rail hands the card the coarse standing word instead of the row's own word · the card would read 'scheduled' without the clock and 'elsewhere' for a wait — killed by `the-rail-row-is-what-every-plate-under-the-strip-draws.dom.test.ts` — killed by `the-rail-row-is-what-every-plate-under-the-strip-draws.dom.test.ts`",
        [
            # ⚑ W4.162 · re-anchored in place, not retired — the entry now spreads the row's model and
            # effort beside its plate and word; the plant still hands the coarse standing word.
            (SIDE_RAIL_VUE, "            word: row.word,\n", "            word: row.standing,\n"),
        ],
    ),
    (
        "M10 · 🔴 the rail keys what it says by the agent's NAME, not its conversation · two conversations of one agent collapse into one entry and the cards of both lose their rows — killed by `the-rail-row-is-what-every-plate-under-the-strip-draws.dom.test.ts` — killed by `the-rail-row-is-what-every-plate-under-the-strip-draws.dom.test.ts`",
        [
            # ⚑ W4.162 · re-anchored in place, not retired — the entry is built over several lines now;
            # the plant still keys it by the agent's name.
            (SIDE_RAIL_VUE, "        return [\n          row.sessionId,\n", "        return [\n          row.label,\n"),
        ],
    ),
    (
        "M11 · 🔴 the screen stops handing the band the rail's rows · the right panel never learns what the rail says and draws the faceless plate for every agent in the running app — killed by `the-rail-row-is-what-every-plate-under-the-strip-draws.dom.test.ts` — killed by `the-rail-row-is-what-every-plate-under-the-strip-draws.dom.test.ts`",
        [
            (RUNTIME_SCREEN_VUE, "cast.railSays.value = rail.value?.says ?? null", "cast.railSays.value = null"),
        ],
    ),
    (
        "M12 · ⛔ the screen leaves the rail's rows in the band's channel when it goes · a replaced screen (HMR) or a re-mount draws the last screen's words for agents it has never heard of — killed by `the-rail-row-is-what-every-plate-under-the-strip-draws.dom.test.ts` — killed by `the-rail-row-is-what-every-plate-under-the-strip-draws.dom.test.ts`",
        [
            (RUNTIME_SCREEN_VUE, "  cast.railSays.value = null\n", ""),
        ],
    ),
    (
        "M30 · 🔴 a pass_question_up call is not recognised · a passed-up question draws as the bare tool row again — killed by `a-question-sent-is-a-card.test.ts` and the new DOM file — killed by `a-question-sent-is-a-card.test.ts`, `the-question-card-says-what-became-of-the-question.dom.test.ts`",
        [
            (TRANSCRIPT, "split.tool === 'pass_question_up'", "false"),
        ],
    ),
    (
        "M31 · 🔴 a passed-up question's row lands as an ASK · its words are looked for on ask calls, so the pass call never gets its question and stays 'sending' — killed by `a-question-sent-is-a-card.test.ts` and the new DOM file — killed by `a-question-sent-is-a-card.test.ts`, `the-question-card-says-what-became-of-the-question.dom.test.ts`",
        [
            (TRANSCRIPT, "tool: asked.passedUpFrom === undefined ? 'ask_question' : 'pass_question_up',", "tool: 'ask_question',"),
        ],
    ),
    (
        "M32 · 🔴 a passed-up question is paired by the wrong argument · two questions passed up at once are told apart by nothing, so neither card gets its words — killed by the new DOM file — killed by `the-question-card-says-what-became-of-the-question.dom.test.ts`",
        # ⚑ Landing D-016b (5e931be8, the tree) · re-anchored in place, not retired — The rule that
        # a passed-up question pairs its call by the `question` argument survives in `pairingIdOf`
        # in transcript.ts, and its test survives too ('two questions passed up at once each take
        # the context they carried, whichever row arrives first'). Only the shape changed: the
        # pairing id is now `{ key: 'question', ids: [asked.passedUpFrom], labelUnknown: false }`,
        # so the old `id:` spelling matches nothing. Killed by
        # `the-question-card-says-what-became-of-the-question.dom.test.ts`.
        [
            (TRANSCRIPT, "{ key: 'question', ids: [asked.passedUpFrom], labelUnknown: false }", "{ key: 'context', ids: [asked.passedUpFrom], labelUnknown: false }"),
        ],
    ),
    (
        "M33 · ⛔ a routing or withdrawal that arrives before its call is lost · the question's card says 'its parent' and 'asked' for a question that went to a person and was withdrawn — killed by the new DOM file — killed by `the-question-card-says-what-became-of-the-question.dom.test.ts`",
        [
            (TRANSCRIPT, "if ('asked' in words && words.asked?.requestId === requestId) return words.asked", "if ('asked' in words && words.asked?.requestId === undefined) return words.asked"),
        ],
    ),
    (
        "M34 · 🔴 a withdrawal closes the newest question, not the one named · with two or more questions on the page the wrong card says 'withdrawn' — killed by the new DOM file — killed by `the-question-card-says-what-became-of-the-question.dom.test.ts`",
        [
            (TRANSCRIPT, "if (item.outgoing.asked?.requestId === requestId) return item.outgoing.asked", "if (item.outgoing.asked !== null) return item.outgoing.asked"),
        ],
    ),
    (
        "M35 · 🔴 a recipient's ending is worded as a withdrawal (and back) · the asker reads 'withdrawn' for a question nobody took back — killed by `a-question-sent-is-a-card.test.ts` and the new DOM file — killed by `a-question-sent-is-a-card.test.ts`, `the-question-card-says-what-became-of-the-question.dom.test.ts`",
        [
            (TRANSCRIPT, "asked.closed = event.type === 'question_withdrawn' ? 'withdrawn' : 'recipient-ended'", "asked.closed = event.type === 'question_withdrawn' ? 'recipient-ended' : 'withdrawn'"),
        ],
    ),
    (
        "M36 · ⛔ a question routed on to a person keeps the press to the agent it left · the card says 'you' and still offers 'Open the conversation' on the old agent — killed by the new DOM file — killed by `the-question-card-says-what-became-of-the-question.dom.test.ts`",
        [
            (TRANSCRIPT, "else delete asked.toConversation", "else void 0"),
        ],
    ),
    (
        "M37 · 🔴 a call that errored after its question was recorded still says 'asked' · the errored ask is drawn as if it had gone fine and its receipt is hidden — killed by the new DOM file — killed by `the-question-card-says-what-became-of-the-question.dom.test.ts`",
        # ⚑ Landing ui bb5b9b7e…128203e6 (UI-009 to UI-011) · re-anchored in place, not retired — UI-009
        # moved the question's state out of outgoing-card.ts into question-card.ts
        # `stateInTheConversation`, whose last line is `return item.result?.ok === false ? 'failed' :
        # 'open'`. The rule survives: a call that errored after its row was recorded says failed and shows
        # its receipt. The plant returns 'open' unconditionally, which also hides the receipt. Killed by
        # `the-question-card-says-what-became-of-the-question.dom.test.ts`.
        [
            (QUESTION_CARD, "  return item.result?.ok === false ? 'failed' : 'open'", "  return 'open'"),
        ],
    ),
    (
        "M38 · ⛔ a sent question's state word is 'waiting' · the promise that the card never says waiting (an answer would leave it standing) is broken — killed by the new DOM file — killed by `the-question-card-says-what-became-of-the-question.dom.test.ts`",
        # ⚑ Landing ui bb5b9b7e…128203e6 (UI-009 to UI-011) · re-anchored in place, not retired — The
        # 'asked' state word is gone: UI-009 moved states to QUESTION_STATE_WORD in question-card.ts,
        # where an open question deliberately says no word (the head's verb says it was asked). The
        # promise that no card says 'waiting' survives and T2 asserts it, so the plant gives the `open`
        # state the word 'waiting'. Killed by
        # `the-question-card-says-what-became-of-the-question.dom.test.ts`.
        [
            (QUESTION_CARD, "  open: '',", "  open: 'waiting',"),
        ],
    ),
    (
        "M39 · 🔴 a one-part question draws its words twice · the part's prompt is printed under the message that already says it — killed by `a-question-sent-is-a-card.test.ts` and the new DOM file — killed by `a-question-sent-is-a-card.test.ts`, `the-question-card-says-what-became-of-the-question.dom.test.ts`",
        # ⚑ Landing ui bb5b9b7e…128203e6 (UI-009 to UI-011) · re-anchored in place, not retired — The
        # part-prompt de-duplication moved from outgoing-card.ts into `partOf` in question-card.ts, now
        # `prompt: prompt === '' || prompt === words?.trim() ? null : part.prompt`. The rule that a
        # one-part question says its words once survives. The plant drops the equality clause. Killed by
        # `a-question-sent-is-a-card.test.ts`,
        # `the-question-card-says-what-became-of-the-question.dom.test.ts`.
        [
            (QUESTION_CARD, "    prompt: prompt === '' || prompt === words?.trim() ? null : part.prompt,", "    prompt: prompt === '' ? null : part.prompt,"),
        ],
    ),
    (
        "M40 · ⛔ a free-text question draws an empty parts box · the part that repeats the body and offers nothing is kept, leaving an empty padded gap under the message — killed by the new DOM file — killed by `the-question-card-says-what-became-of-the-question.dom.test.ts`",
        # ⚑ Landing ui bb5b9b7e…128203e6 (UI-009 to UI-011) · re-anchored in place, not retired — The old
        # reading-level filter that dropped an empty part is gone. UI-009 draws free-form questions
        # through QuestionCard, whose template guards the part: `v-if="part.header || part.prompt ||
        # part.options.length > 0 || (live && part.typed)"`. T8 still asserts that a free-text question on
        # a surface that does not answer draws no part box. The plant removes the guard so the empty part
        # is drawn. Killed by `the-question-card-says-what-became-of-the-question.dom.test.ts`.
        [
            (QUESTION_CARD_VUE, "v-if=\"part.header || part.prompt || part.options.length > 0 || (live && part.typed)\"", "v-if=\"true\""),
        ],
    ),
    (
        "M41 · ⛔ a passed-up question shows its id as the words · before its row lands a pass call draws the request id it carries as if it were the question — killed by `a-question-sent-is-a-card.test.ts` — killed by `a-question-sent-is-a-card.test.ts`",
        # ⚑ Landing ui bb5b9b7e…128203e6 (UI-009 to UI-011) · re-anchored in place, not retired — The
        # words-from-arguments rule moved to `questionInTheConversation` in question-card.ts and kept its
        # shape: `recorded === null && tool === 'ask_question' ? argumentExcerpt(item.summary, 'question')
        # : null`. A pass call's `question` argument is a request id, never words, and §3's control still
        # asserts that. The plant drops the tool check. Killed by `a-question-sent-is-a-card.test.ts`.
        [
            (QUESTION_CARD, "recorded === null && tool === 'ask_question' ? argumentExcerpt(item.summary, 'question') : null", "recorded === null ? argumentExcerpt(item.summary, 'question') : null"),
        ],
    ),
    (
        "M42 · ⛔ a question cut in its call is drawn as if whole · the head of the words shows with no sentence saying it was cut — killed by the new DOM file — killed by `the-question-card-says-what-became-of-the-question.dom.test.ts`",
        # ⚑ Landing ui bb5b9b7e…128203e6 (UI-009 to UI-011) · re-anchored in place, not retired — The card
        # field `bodyIsCut` is now `wordsAreCut` on QuestionCardReading, set in question-card.ts
        # `questionInTheConversation`, and QuestionCard.vue draws the `question-cut` sentence from it. The
        # rule that a question cut in its call says so survives and T9 pins it. The plant forces
        # `wordsAreCut` false. Killed by `the-question-card-says-what-became-of-the-question.dom.test.ts`.
        [
            (QUESTION_CARD, "    wordsAreCut: recorded === null && excerpt?.cut === true,", "    wordsAreCut: false,"),
        ],
    ),
    (
        "M43 · 🔴 a passed-up question card has no question glyph · the pass card is not marked as a question while the ask card is — killed by the new DOM file — killed by `the-question-card-says-what-became-of-the-question.dom.test.ts`",
        # ⚑ Landing ui bb5b9b7e…128203e6 (UI-009 to UI-011) · re-anchored in place, not retired — UI-009
        # made the question glyph unconditional in QuestionCard.vue, so the old `tool === 'ask_question'
        # || tool === 'pass_question_up'` condition is gone. The rule survives and T1 asserts the glyph on
        # both an ask and a pass at the heading's size. The plant keys the glyph on the verb so a
        # passed-up question wears none. Killed by
        # `the-question-card-says-what-became-of-the-question.dom.test.ts`.
        [
            (QUESTION_CARD_VUE, "<svg class=\"icon\" aria-hidden=\"true\"><use href=\"#i-question\" /></svg>", "<svg v-if=\"props.reading.verb !== 'passed up to'\" class=\"icon\" aria-hidden=\"true\"><use href=\"#i-question\" /></svg>"),
        ],
    ),
    (
        "M44 · ⛔ every outgoing card wears the question glyph · a message to another agent (and a reply) gets the question mark — killed by the new DOM file — killed by `the-question-card-says-what-became-of-the-question.dom.test.ts`",
        # ⚑ Landing ui bb5b9b7e…128203e6 (UI-009 to UI-011) · re-anchored in place, not retired — The
        # question glyph's condition in OutgoingEntry.vue was replaced by UI-009. Questions go through
        # QuestionCard, and the `glyph` computed now covers only give_work (#i-send) and take_on_work
        # (#i-play), else null. The rule that a message to another agent or a reply wears no question mark
        # survives and T1 asserts `.heading svg` is null on the message card. The plant makes the fallback
        # the question glyph. Killed by `the-question-card-says-what-became-of-the-question.dom.test.ts`.
        [
            # ⚑ W4.68 · re-anchored in place: the chain now ends after D-047's new-brief glyph; the
            # plant still makes its last fallback the question glyph.
            (OUTGOING_ENTRY_VUE, "        ? '#i-refresh'\n        : null,\n", "        ? '#i-refresh'\n        : '#i-question',\n"),
        ],
    ),
    (
        "M45 · 🔴 the question glyph is drawn far too wide · the heading's glyph is ten times its size and pushes the heading apart — killed by the new DOM file — killed by `the-question-card-says-what-became-of-the-question.dom.test.ts`",
        [
            (OUTGOING_ENTRY_VUE, "width: 11px;", "width: 110px;"),
        ],
    ),
    (
        "M46 · ⛔ the option chips look pressable · a pointer cursor over chips that do nothing, against 'a person reads, not presses' — killed by the new DOM file — killed by `the-question-card-says-what-became-of-the-question.dom.test.ts`",
        # ⚑ Landing ui bb5b9b7e…128203e6 (UI-009 to UI-011) · re-anchored in place, not retired — The
        # option chips moved from OutgoingEntry.vue's `<style>` into QuestionCard.vue, where `.chip` is
        # the chip drawn for a question the surface does not answer (the comment still says 'no hover and
        # no pointer'). T7 asserts the computed cursor is not pointer. The plant puts `cursor: pointer` on
        # `.chip`. Killed by `the-question-card-says-what-became-of-the-question.dom.test.ts`.
        [
            # ⚑ **token plumbing · re-anchored in place, not retired** — NOT VERIFIED. The token codemod rewrote this line to read tokens; the replacement is unchanged and makes the same defect.
            (QUESTION_CARD_VUE, ".chip {\n  padding: var(--space-1) var(--space-3);", ".chip {\n  cursor: pointer;\n  padding: 2px var(--space-3);"),
        ],
    ),
    (
        "M47 · 🔴 what a conversation added when it passed a question up is not drawn · the note that went with the pass is lost from the card — killed by the new DOM file — killed by `the-question-card-says-what-became-of-the-question.dom.test.ts`",
        # ⚑ Landing ui bb5b9b7e…128203e6 (UI-009 to UI-011) · re-anchored in place, not retired — The note
        # a conversation added when it passed a question up is now drawn by QuestionCard.vue as `<p
        # v-if="props.reading.context && !folded" ... data-cy="question-context">`. The rule survives and
        # T1 and T6 assert 'Added: ...' on each pass card. The plant turns the guard into `false`. Killed
        # by `the-question-card-says-what-became-of-the-question.dom.test.ts`.
        [
            # ⚑ **source-restoration · re-anchored in place, not retired** — NOT VERIFIED; source targeting only. 636446c24 made the context element depend on readable mode; omit only its passed-up context in both modes.
            (QUESTION_CARD_VUE, "      v-if=\"props.reading.context && !folded\"\n      class=\"aside\"\n      data-cy=\"question-context\"", "      v-if=\"false\"\n      class=\"aside\"\n      data-cy=\"question-context\""),
        ],
    ),
    (
        "M48 · 🔴 a many-part question loses each part's prompt · the chips of several parts are drawn with nothing saying what each is answering — killed by the new DOM file — killed by `the-question-card-says-what-became-of-the-question.dom.test.ts`",
        # ⚑ Landing ui bb5b9b7e…128203e6 (UI-009 to UI-011) · re-anchored in place, not retired — Each
        # part's own prompt is now drawn by QuestionCard.vue's `<p v-if="part.header || part.prompt ||
        # (live && part.multiSelect)" class="ask">`. The rule that a many-part question draws each part's
        # prompt survives and T8 reads `.ask` per part. The plant removes `part.prompt` from the guard, so
        # the header and multi-select mode still draw and only the prompt is lost. Killed by
        # `the-question-card-says-what-became-of-the-question.dom.test.ts`.
        [
            # ⚑ **W4.205 · re-anchored in place, not retired** — W4.205 · the ask line's condition moved into a helper that also names each part's box; the plant still drops the prompt from it, so a many-part question draws its chips with nothing saying what each part asks
            (QUESTION_CARD_VUE, "  return Boolean(part.header || part.prompt || (live.value && part.multiSelect))", "  return Boolean(part.header || (live.value && part.multiSelect))"),
        ],
    ),
    (
        "M49 · ⛔ an errored question's state word is not in the failure colour · 'failed' is drawn in the faint marker ink beside a red receipt — killed by the new DOM file — killed by `the-question-card-says-what-became-of-the-question.dom.test.ts`",
        [
            (OUTGOING_ENTRY_VUE, ".outgoing .state.failed {", ".outgoing .state.gone {"),
        ],
    ),
    (
        "M20 · a question asked or answered (the waits reading moved) no longer asks the rail's list again — the rail row and the right panel's card keep the old state until the half-minute — killed by `the-rails-list-is-asked-again-when-an-agents-state-may-have-moved.test.ts` — killed by `the-rails-list-is-asked-again-when-an-agents-state-may-have-moved.test.ts`",
        # ⚑ Landing D-019 (8e47328e) · re-anchored in place, not retired — The rule is that a
        # question asked or answered changes the rail row without waiting; since D-019 it rides the
        # push: main marks the conversation and `runtime:states` carries its state, which the rail
        # keeps. The plant stops the rail keeping what it heard, so the row keeps its old state.
        # (The label's mechanism, the waits re-read, went on purpose; the rule did not.) Killed by
        # `the-rails-list-is-asked-again-when-an-agents-state-may-have-moved.test.ts`.
        [
            (SIDE_RAIL_VUE, "  said.value = next\n", ""),
        ],
    ),
    (
        "M21 · the waits reading asks the list again when NOTHING moved (every five seconds) and never when a wait did move — killed by `the-rails-list-is-asked-again-when-an-agents-state-may-have-moved.test.ts` — killed by `the-rails-list-is-asked-again-when-an-agents-state-may-have-moved.test.ts`",
        # ⛔ **RETIRED BY RULING (landing D-019, 8e47328e):** The compare `seen !== waitsSeen` is
        # gone from RuntimeScreen.vue (count 0), removed with the waits-moved re-read by D-019 ('the
        # re-read when the waits reading moved [is] gone'). The killer file's 4th test now asserts
        # `waitsSeen` no longer appears in the screen's code. The inverted-compare defect has no
        # subject left. Its anchor is left stale, so the census records it retired.
        [
            (RUNTIME_SCREEN_VUE, "seen !== waitsSeen", "seen === waitsSeen"),
        ],
    ),
    (
        "M22 · the last waits reading is never kept, so a moved wait is never seen as moved and the list is never asked again from here — killed by `the-rails-list-is-asked-again-when-an-agents-state-may-have-moved.test.ts` — killed by `the-rails-list-is-asked-again-when-an-agents-state-may-have-moved.test.ts`",
        # ⛔ **RETIRED BY RULING (landing D-019, 8e47328e):** `waitsSeen = seen` and the `waitsSeen`
        # variable were deleted by D-019 along with the waits-moved re-read ('the re-read when the
        # waits reading moved [is] gone'). Nothing keeps a last reading to compare, and the killer's
        # 4th test asserts `waitsSeen` is absent. The defect 'the last reading is never kept' has no
        # code to live in. Its anchor is left stale, so the census records it retired.
        [
            (RUNTIME_SCREEN_VUE, "  waitsSeen = seen\n", "  waitsSeen = null\n"),
        ],
    ),
    (
        "M23 · the waits compare includes the reading's own timestamp (readAt is Date.now()), so every five-second reading looks moved and the rail's list is re-read on every tick — killed by `the-rails-list-is-asked-again-when-an-agents-state-may-have-moved.test.ts` — killed by `the-rails-list-is-asked-again-when-an-agents-state-may-have-moved.test.ts`",
        # ⛔ **RETIRED BY RULING (landing D-019, 8e47328e):** `const seen =
        # JSON.stringify(reading.conversations)` no longer exists: D-019 removed the waits compare
        # and its re-read on purpose ('the re-read when the waits reading moved [is] gone'). With no
        # compare there is no readAt-in-the-compare defect to plant. The nearest live rule, that the
        # waits reading asks nothing of the rail, is what the killer's 4th test already pins. Its
        # anchor is left stale, so the census records it retired.
        [
            (RUNTIME_SCREEN_VUE, "const seen = JSON.stringify(reading.conversations)", "const seen = JSON.stringify(reading)"),
        ],
    ),
    (
        "M24 · work moving (the `work` change subject) no longer asks the rail's list again — an agent's row stays on its old state until the half-minute tick — killed by `the-rails-list-is-asked-again-when-an-agents-state-may-have-moved.test.ts` — killed by `the-rails-list-is-asked-again-when-an-agents-state-may-have-moved.test.ts`",
        # ⚑ Landing D-019 (8e47328e) · re-anchored in place, not retired — The rule survives,
        # reshaped: the `work` arm still asks the rail's list (`void
        # rail.value?.refreshResumable()`, marked 'D-016 · commit 7 · R2 ... for the work that names
        # each conversation'), and the commit says 'the re-read on work stays'. The old anchor
        # (`relist()` under 'work moving moves an agent's state') is gone, so drop the bare call
        # from the arm. The half-minute-tick clause of the old label no longer holds; suggested
        # label: 'M24 · work moving (the `work` change subject) no longer asks the rail's list
        # again, so a give, a reply, a take-back, a close or a retitle leaves the rail rows on their
        # old names, which no push carries'. Checked in memory: with the edit the arm no longer
        # matches the killer's `^\s*void rail\.value\?\.refreshResumable\(\)\s*$` and the screen
        # holds 2 rail asks, where the census expects 3. Killed by
        # `the-rails-list-is-asked-again-when-an-agents-state-may-have-moved.test.ts`.
        [
            (RUNTIME_SCREEN_VUE, "      // ({@link stopHearingStates}).\n      void rail.value?.refreshResumable()\n", "      // ({@link stopHearingStates}).\n"),
        ],
    ),
    (
        "M25 · the band's half-minute tick no longer asks the rail's list, so a state change nothing announced (a turn ended, a wake-up scheduled) is never seen unless a wait moves — killed by `the-rails-list-is-asked-again-when-an-agents-state-may-have-moved.test.ts` — killed by `the-rails-list-is-asked-again-when-an-agents-state-may-have-moved.test.ts`",
        # ⚑ Landing D-019 (8e47328e) · re-anchored in place, not retired — The rule is that a state
        # change nothing else announces (a turn ended, a wake-up scheduled) still reaches the rail;
        # since D-019 main pushes it and the screen hands every push to the rail. The plant removes
        # that hookup, so the rail never learns a turn ended. (The tick's re-read went on purpose;
        # the rule did not.) Killed by
        # `the-rails-list-is-asked-again-when-an-agents-state-may-have-moved.test.ts`.
        # ⚑ Landing D-026, PE-007 and the ui files batch · re-anchored in place, not retired — The rule
        # survives: a state change nothing else announces reaches the rail only because the screen hands
        # it every push. b57d1579 turned the one-line `stopHearingStates = ...onStates((message) =>
        # rail.value?.hearStates(message))` into a block that also reads the files, so the old whole-line
        # anchor is gone. The plant now removes just the `rail.value?.hearStates(message)` line (once), so
        # the rail never hears a push while the files read stays wired and syntactically valid. Killed by
        # `the-rails-list-is-asked-again-when-an-agents-state-may-have-moved.test.ts`.
        [
            (RUNTIME_SCREEN_VUE, "    rail.value?.hearStates(message)\n", ""),
        ],
    ),
    (
        "M26 · the half-minute tick asks the list again only while a conversation is on screen, so on Home or the Team page the rail rows go stale — killed by `the-rails-list-is-asked-again-when-an-agents-state-may-have-moved.test.ts` — killed by `the-rails-list-is-asked-again-when-an-agents-state-may-have-moved.test.ts`",
        # ⚑ Landing D-019 (8e47328e) · re-anchored in place, not retired — The rule is that the
        # rail's freshness does not depend on a conversation being open (the rail is on every
        # surface, Home and the Team page included); since D-019 it is the push's handler, which is
        # ungated. The plant gates it on an open conversation, so Home and the Team page go stale.
        # The label is kept. Killed by
        # `the-rails-list-is-asked-again-when-an-agents-state-may-have-moved.test.ts`.
        # ⚑ Landing D-026, PE-007 and the ui files batch · re-anchored in place, not retired — The rule
        # survives: the rail's freshness must not depend on a conversation being open, because the rail is
        # on Home and the Team page too, so the push's handler is ungated. The same b57d1579 block rewrite
        # removed the old whole-line anchor. The plant gates the one `rail.value?.hearStates(message)`
        # line (once) on `active.value !== null`; `active` is a ref in the same script setup (used by
        # listedStateOfActive just above). Killed by
        # `the-rails-list-is-asked-again-when-an-agents-state-may-have-moved.test.ts`.
        [
            (RUNTIME_SCREEN_VUE, "    rail.value?.hearStates(message)\n", "    if (active.value !== null) rail.value?.hearStates(message)\n"),
        ],
    ),
    (
        "M27 · relist() asks the conversations library's list instead of the rail's, so the rail row and the right panel's card stay on the old state — killed by `the-rails-list-is-asked-again-when-an-agents-state-may-have-moved.test.ts` — killed by `the-rails-list-is-asked-again-when-an-agents-state-may-have-moved.test.ts`",
        # ⚑ Landing D-019 (8e47328e) · re-anchored in place, not retired — `relist()` was deleted,
        # but the rule it carried survives in the `work` arm: the rail's list, not the library's, is
        # what a moved piece of work must re-read. Redirect that call to
        # `library.value?.refreshResumable()`; `library` is a ref in scope (line 431) and already
        # used in the `conversations` arm, so it is no ReferenceError. Suggested label: 'M27 · the
        # `work` arm asks the conversations library's list instead of the rail's, so the rail rows
        # keep the old names of the work'. Checked in memory: the arm then has no
        # `rail.value?.refreshResumable()` and the screen holds 2 asks of the rail, where the census
        # expects 3. It does not duplicate 638 M9, which redirects the band's read rather than the
        # rail's ask. Killed by
        # `the-rails-list-is-asked-again-when-an-agents-state-may-have-moved.test.ts`.
        [
            (RUNTIME_SCREEN_VUE, "      // ({@link stopHearingStates}).\n      void rail.value?.refreshResumable()\n", "      // ({@link stopHearingStates}).\n      void library.value?.refreshResumable()\n"),
        ],
    ),
    (
        "M28 · a dropped waits read (null) blanks the last good reading before it is checked, and then throws on `reading.conversations` — the exact 'rows fall back to idle' the docblock forbids — killed by `the-rails-list-is-asked-again-when-an-agents-state-may-have-moved.test.ts` — killed by `the-rails-list-is-asked-again-when-an-agents-state-may-have-moved.test.ts`",
        # ⚑ Landing D-019 (8e47328e) · re-anchored in place, not retired — The rule survives and
        # D-019 only reshaped the code: `readWhatIsWaiting` is now `const reading = await
        # store.whatEachConversationIsWaitingOn()` then `if (reading !== null)
        # conversationWaits.value = reading`, and its docblock still says a refusal keeps the last
        # good reading (`null` is 'we did not look'). The old two-line anchor is gone, so plant the
        # defect by storing unconditionally, which blanks the last good reading on a dropped read.
        # The 'throws on reading.conversations' clause of the old label no longer applies; suggested
        # label: 'M28 · a dropped waits read (null) blanks the last good reading, so every rail row
        # falls back to the word its live facets produce'. Killed by
        # `the-rails-list-is-asked-again-when-an-agents-state-may-have-moved.test.ts`.
        [
            (RUNTIME_SCREEN_VUE, "  if (reading !== null) conversationWaits.value = reading\n", "  conversationWaits.value = reading\n"),
        ],
    ),
    (
        "M29 · the queue's five-second tick stops reading what each conversation is waiting on, so the waits never move and the first trigger can never fire — killed by `the-rails-list-is-asked-again-when-an-agents-state-may-have-moved.test.ts` — killed by `the-rails-list-is-asked-again-when-an-agents-state-may-have-moved.test.ts`",
        [
            (RUNTIME_SCREEN_VUE, "    void readTheWorkspace()\n    void readWhatIsWaiting()\n  }, LOOK_EVERY_MS)", "    void readTheWorkspace()\n  }, LOOK_EVERY_MS)"),
        ],
    ),
]
