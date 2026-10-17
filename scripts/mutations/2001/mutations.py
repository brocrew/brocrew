"""2001 · the landing's table for `ui` batch 1: the 18 frontend commits `cfa0d4b9`…`cb5bd7de`.

⚑ **Why `2001`**: a table id must be a positive integer. Card D-00N's table is `100N`; a `ui` batch has
no card, so the landing numbers its batches `2000 + n`.

The frontend seat changes the window only ("small UI changes with no logic change, iterated with
the person"), fixes the tests it breaks, and writes some of its own. This table and five new test files
complete the coverage of what the 18 commits introduced and what still exists at `cb5bd7de`.

## The row groups

 * `M1`–`M16`   **the task list** (TaskList.vue): the latest three plus the newest earlier OPEN task,
                the "N earlier tasks: …" count in each task's own word, markdown marks dropped from
                a line, `showsWho`, and which end a press opens. New tests:
                `the-list-keeps-its-own-count-and-its-own-words.dom.test.ts`.
 * `M20`–`M31`  **the agents strip** (WorkingTogether.vue): who counts as active, one agent open at a
                time, a chip picks and opens nothing, the chip's stacked plate and name, the order.
                New tests: `the-strip-picks-the-agent-that-is-doing-something.dom.test.ts`.
 * `M40`–`M50`  **the agent card** (AgentCard.vue, SessionBot.vue): the context reading, the Stop
                beside a running sub-agent, a card that stops at what this window holds. New tests:
                `the-card-stops-at-what-it-holds.render.test.ts`.
 * `M60`–`M69`  **the reading size** (`2760914e`): 14px / 1.5 on every message body, and headings and
                code sized from the text they sit in. New tests:
                `the-conversations-own-reading-size.dom.test.ts`.
 * `M70`–`M85`  **F023**: the standing word's detail (*scheduled · HH:MM*, *running in the background
                · <command>*), the cron reading, and the avatar's mark. New tests:
                `the-losing-detail-says-nothing.render.test.ts`.

Designed read-only by Sonnet agents from the commits and today's code; each row verified alone by the
landing agent.

## Verification

The landing agent verified every row alone with `verify_row.py` (applied, its own killer files run,
restored from bytes), in a scratch worktree at `ded0afce` with this table and its tests added. The
table has not been run.
- **RED: 65 of 65.** Each killer file ran green unmutated first.
- `M66` turns every test of `the-conversations-own-reading-size.dom.test.ts` red, which is its
  label: the one token every message body reads shrinks, so every body follows. No other row fails
  a whole file.
"""

BASE_CSS = "apps/desktop/src/renderer/src/assets/base.css"
TOKENS_CSS = "apps/desktop/src/renderer/src/assets/tokens.css"
AGENT_CARD_VUE = "apps/desktop/src/renderer/src/components/AgentCard.vue"
AGENT_STATE_VUE = "apps/desktop/src/renderer/src/components/AgentState.vue"
APP_NOTICE_ENTRY_VUE = "apps/desktop/src/renderer/src/components/AppNoticeEntry.vue"
ASSISTANT_MESSAGE_VUE = "apps/desktop/src/renderer/src/components/AssistantMessage.vue"
CONTINUATION_ENTRY_VUE = "apps/desktop/src/renderer/src/components/ContinuationEntry.vue"
QUEUED_MESSAGE_VUE = "apps/desktop/src/renderer/src/components/QueuedMessage.vue"
RELAYED_ENTRY_VUE = "apps/desktop/src/renderer/src/components/RelayedEntry.vue"
SESSION_BOT_VUE = "apps/desktop/src/renderer/src/components/SessionBot.vue"
TASK_LIST_VUE = "apps/desktop/src/renderer/src/components/TaskList.vue"
USER_MESSAGE_VUE = "apps/desktop/src/renderer/src/components/UserMessage.vue"
WORKING_TOGETHER_VUE = "apps/desktop/src/renderer/src/components/WorkingTogether.vue"
AGENT_STATE = "apps/desktop/src/renderer/src/lib/agent-state.ts"
BACKGROUND_WORK = "apps/desktop/src/renderer/src/lib/background-work.ts"
SCHEDULED_WORK = "apps/desktop/src/renderer/src/lib/scheduled-work.ts"
AGENT_STATE_ = "apps/desktop/src/shared/agent-state.ts"
THE_FOREST = "apps/desktop/src/renderer/src/lib/the-forest.ts"

MUTATIONS: list[tuple[str, list[tuple[str, str, str]]]] = [
    (
        "M1 · the list shows the OLDEST three as 'latest', not the newest three — killed by `the-first-picture-of-who-called-whom.dom.test.ts`",
        [
            (TASK_LIST_VUE, "props.tasks.slice(-LATEST)", "props.tasks.slice(0, LATEST)"),
        ],
    ),
    (
        "M2 · a finished task can fill the extra line too — the 'still open' guard is gone — killed by `the-first-picture-of-who-called-whom.dom.test.ts`",
        [
            (TASK_LIST_VUE, "const earlierOpen = props.tasks.slice(0, -LATEST).filter((one) => one.piece.open)", "const earlierOpen = props.tasks.slice(0, -LATEST)"),
        ],
    ),
    (
        "M3 · a long history blinds the earlier-open slot entirely — killed by `the-first-picture-of-who-called-whom.dom.test.ts`",
        [
            (TASK_LIST_VUE, "const room = AT_MOST - latest.length", "const room = AT_MOST - props.tasks.length"),
        ],
    ),
    (
        "M4 · the extra slot keeps the OLDEST open task left behind, not the newest — killed by `the-list-keeps-its-own-count-and-its-own-words.dom.test.ts`",
        [
            (TASK_LIST_VUE, "earlierOpen.slice(-room)", "earlierOpen.slice(0, room)"),
        ],
    ),
    (
        "M5 · one fewer line than the rule promises — a task that would have fit is hidden — killed by `the-list-keeps-its-own-count-and-its-own-words.dom.test.ts`",
        [
            (TASK_LIST_VUE, "const AT_MOST = 5", "const AT_MOST = 4"),
        ],
    ),
    (
        "M6 · two different left-out reasons run together with no comma — killed by `the-list-keeps-its-own-count-and-its-own-words.dom.test.ts`",
        [
            (TASK_LIST_VUE, ".join(', ')", ".join(' ')"),
        ],
    ),
    (
        "M7 · the count is always plural, even for one task — killed by `the-list-keeps-its-own-count-and-its-own-words.dom.test.ts`",
        # ⚑ Landing D-016b (5e931be8, the tree) · re-anchored in place, not retired — TaskList.vue
        # still draws the earlier-count line and still picks the singular for one hidden item. The
        # commit re-pointed the word from task/tasks to piece/pieces, so the template expression is
        # now `hidden.length === 1 ? 'piece' : 'pieces'`. The test 'the earlier count says ONE piece
        # in the singular, not "pieces"' expects `1 earlier piece: 1 answered`. Killed by
        # `the-list-keeps-its-own-count-and-its-own-words.dom.test.ts`.
        [
            (TASK_LIST_VUE, "${hidden.length === 1 ? 'piece' : 'pieces'}", 'pieces'),
        ],
    ),
    (
        "M8 · a heading, quote or bullet lead is no longer dropped from the line — killed by `the-list-keeps-its-own-count-and-its-own-words.dom.test.ts`",
        [
            (TASK_LIST_VUE, "const LEAD = new RegExp('^\\\\s{0,3}(?:#{1,6}\\\\s+|>\\\\s*|[-*+]\\\\s+)')", "const LEAD = new RegExp('(?!)')"),
        ],
    ),
    (
        "M9 · italic emphasis is no longer dropped from the line — killed by `the-list-keeps-its-own-count-and-its-own-words.dom.test.ts`",
        [
            (TASK_LIST_VUE, "const ITALIC = new RegExp('(^|\\\\s)[*_](\\\\S(?:[^*_]*\\\\S)?)[*_](?=\\\\s|[.,;:!?)]|$)', 'g')", "const ITALIC = new RegExp('(?!)', 'g')"),
        ],
    ),
    (
        "M10 · the printed line is the whole request, not its first line — the newline nobody draws leaks onto the row — killed by `the-first-picture-of-who-called-whom.dom.test.ts`",
        [
            (TASK_LIST_VUE, "plainLine(one.piece.said)", "plainLine(one.piece.request)"),
        ],
    ),
    (
        "M11 · showsWho's default flips back to false — the giver's dot and name silently drop again — killed by `a-dot-says-one-thing.render.test.ts`, `the-list-keeps-its-own-count-and-its-own-words.dom.test.ts`",
        # ⚑ Landing D-027, the ui stretch to 3ef68f7f and D-038 · re-anchored in place, not retired
        # — 4f5d9d7a removed TaskList's `showsWho` prop and its default on purpose, but the label's
        # rule holds, now unconditionally: every taken line names its giver with a dot and a name
        # (4f5d9d7a: 'every row … names its giver'). The plant drops both, and the two killers
        # 4f5d9d7a re-pointed still pin them. A second agent refuted the retirement. Killed by
        # `the-list-keeps-its-own-count-and-its-own-words.dom.test.ts`,
        # `a-dot-says-one-thing.render.test.ts`.
        [
            (TASK_LIST_VUE, '          <AgentState v-if="one.facets" size="dot" v-bind="one.facets" :label="one.toName" />\n          <span class="tto" data-cy="cast-work-to" :title="one.toName">{{ one.toName }}</span>\n', ''),
        ],
    ),
    (
        "M12 · a taken line's press opens the wrong end — itself, not its giver — killed by `the-first-picture-of-who-called-whom.dom.test.ts`",
        # ⚑ Landing D-027, the ui stretch to 3ef68f7f and D-038 · re-anchored in place, not retired
        # — Contrary to the frontend's note, the rule survives: 4f5d9d7a removed the ROW table but a
        # press on a taken line still emits the giver (`one.piece.from!`), which is what this row
        # guards ('which end a press opens'). The plant emits the piece's other end (`to`, the
        # holder itself), which is exactly the defect the killer's own comment names ('a component
        # that emitted piece.to … passes'). Killed by
        # `the-first-picture-of-who-called-whom.dom.test.ts`.
        [
            (TASK_LIST_VUE, "onClick: () => emit('openConversation', one.piece.from!),", "onClick: () => emit('openConversation', one.piece.to!),"),
        ],
    ),
    (
        "M13 · the earlier count no longer distinguishes hidden tasks from shown ones — killed by `the-first-picture-of-who-called-whom.dom.test.ts`",
        [
            (TASK_LIST_VUE, "!shown.value.includes(one)", "shown.value.includes(one)"),
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-027, the ui stretch to 3ef68f7f and D-038):** 4f5d9d7a
        # removed the `<template v-if="props.showsWho">` gate together with the prop: 'TaskList's
        # `direction`, `showsWho` and `ROW` indirection (every row is `cast-taken-work`, names its
        # giver…)'. The who is drawn on every row by design now, so 'the gate is gone' has no
        # subject. Its anchor is left stale, so the census records it retired.
        "M14 · showsWho's own gate is gone — the who is drawn regardless of the prop — killed by `a-dot-says-one-thing.render.test.ts`, `the-list-keeps-its-own-count-and-its-own-words.dom.test.ts`",
        [
            (TASK_LIST_VUE, "v-if=\"props.showsWho\"", ""),
        ],
    ),
    (
        "M15 · an empty earlier-count line is drawn even when nothing was left out — killed by `the-first-picture-of-who-called-whom.dom.test.ts`",
        [
            (TASK_LIST_VUE, "<li v-if=\"earlier\" class=\"earlier\">", "<li class=\"earlier\">"),
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-027, the ui stretch to 3ef68f7f and D-038):** 4f5d9d7a
        # deleted the given-out arm of TaskList: 'the given-out list for an agent drawn under it
        # went with that card in f1fa1e2e. Out: AgentCard's `direction` and its given arm,
        # TaskList's `direction`… `ROW` indirection'. No given-out line exists to open the wrong
        # end. Its anchor is left stale, so the census records it retired.
        "M16 · a given-out line's press opens the wrong end — the giver, not the recipient — killed by `the-first-picture-of-who-called-whom.dom.test.ts`",
        [
            (TASK_LIST_VUE, "given: { cy: 'cast-work', opens: 'to' },", "given: { cy: 'cast-work', opens: 'from' },"),
        ],
    ),
    (
        "M20 · the 'Assigned by it' heading is drawn even when nothing was left unread — killed by `one-count-one-sentence.dom.test.ts`",
        [
            (WORKING_TOGETHER_VUE, "<p v-if=\"view.gaveOutShort\" class=\"tgroup\" data-cy=\"cast-tasks-heading\">Assigned by it</p>", "<p class=\"tgroup\" data-cy=\"cast-tasks-heading\">Assigned by it</p>"),
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing ui f1fa1e2e…70aaa954):** The whole 'active within ten
        # minutes' rule (`activeNow`, `ACTIVE_WITHIN_MS`) existed only to pick which agent was open
        # under the strip, and f1fa1e2e removed that pick: 'the default-open pick and the open
        # card's own sub-agents went with the card, and their tests with them.' Nothing in the tree
        # computes 'active' any more (grep for `activeNow`, `ACTIVE_WITHIN_MS`, `recent(one` finds
        # nothing), and the strip test's header says its four pick tests went with the pick. Its
        # anchor is left stale, so the census records it retired.
        "M21 · a conversation spawned inside the 10-minute window is no longer counted as active — killed by `the-strip-picks-the-agent-that-is-doing-something.dom.test.ts`",
        # ⚑ Landing D-016b (5e931be8, the tree) · re-anchored in place, not retired — The commit
        # folded 'spawned' into 'given work' on purpose: the `children.rows` spawnedAt loop is gone,
        # and WorkingTogether.vue's comment says a child starts with the piece it was given, so the
        # `givenAt` arm now covers a conversation started inside the window. The strip test's
        # 'spawned inside the window' case was rewritten as 'a child given its piece inside the
        # 10-minute window opens over one given it outside it', so the rule survives on the
        # `givenAt` arm. Killed by `the-strip-picks-the-agent-that-is-doing-something.dom.test.ts`.
        [
            (WORKING_TOGETHER_VUE, 'if (recent(one.givenAt) || recent(one.endedAt)) active.add(one.to)', 'if (recent(one.endedAt)) active.add(one.to)'),
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing ui f1fa1e2e…70aaa954):** Same subject as M21: the `endedAt`
        # arm of `activeNow` fed the default-open pick, which f1fa1e2e deleted on purpose ('the
        # default-open pick ... went with the card'). The line `if (recent(one.givenAt) ||
        # recent(one.endedAt)) active.add(one.to)` no longer exists anywhere, and no surviving
        # surface (strip, graph, ForestCard) has an 'active' notion to plant into. Its anchor is
        # left stale, so the census records it retired.
        "M22 · a task that ended inside the window no longer makes its recipient 'active' — killed by `the-strip-picks-the-agent-that-is-doing-something.dom.test.ts`",
        # ⚑ Landing D-016b (5e931be8, the tree) · re-anchored in place, not retired — The rule that
        # a piece ended inside the window makes its owner active still holds. Only the field was
        # renamed, `assignedAt` to `givenAt`, and the `endedAt` arm is intact; the strip test was
        # rewritten to 'a piece that ENDED inside the window opens its owner, even though it was
        # GIVEN long before the window'. Killed by
        # `the-strip-picks-the-agent-that-is-doing-something.dom.test.ts`.
        [
            (WORKING_TOGETHER_VUE, 'if (recent(one.givenAt) || recent(one.endedAt)) active.add(one.to)', 'if (recent(one.givenAt)) active.add(one.to)'),
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing ui f1fa1e2e…70aaa954):** The 'working/streaming/since
        # counts as active' loop was the first clause of `activeNow`, removed with the default-open
        # pick by f1fa1e2e ('the default-open pick ... went with the card'). No code reads
        # `atWork.conversations` to decide which agent is open any more, so the defect has no
        # subject. Its anchor is left stale, so the census records it retired.
        "M23 · a conversation this app is currently running (working/streaming) is no longer treated as active — killed by `the-strip-picks-the-agent-that-is-doing-something.dom.test.ts`",
        [
            (WORKING_TOGETHER_VUE, "  for (const one of reading.atWork?.conversations ?? []) {\n    if (one.status === 'working' || one.streaming || recent(one.since)) active.add(one.conversation)\n  }\n", ""),
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing ui f1fa1e2e…70aaa954):** The chosen/open toggle (`chosen`,
        # `openAgent`, `pick`) is gone: f1fa1e2e says 'The open child's card under the Sub agents
        # strip is gone' and 'A Sub agents chip opens that agent's conversation', so no chip is ever
        # 'open' and pressing one cannot close it. The first-picture test now asserts a chip press
        # opens the conversation and that no `.agent` card draws under the strip. Its anchor is left
        # stale, so the census records it retired.
        "M24 · pressing the open chip no longer closes it — killed by `the-first-picture-of-who-called-whom.dom.test.ts`",
        [
            (WORKING_TOGETHER_VUE, "chosen.value = openAgent.value?.conversation === conversation ? null : conversation", "chosen.value = conversation"),
        ],
    ),
    (
        "M25 · a chip press also opens the conversation it names, instead of only picking what the band shows — killed by `the-first-picture-of-who-called-whom.dom.test.ts`",
        # ⚑ Landing ui f1fa1e2e…70aaa954 (the card panel and the Vue Flow forest) · re-anchored in
        # place, not retired — THE RULE WAS REVERSED on purpose by f1fa1e2e ('A Sub agents chip
        # opens that agent's conversation (a way down), where a screen can open one'), so read the
        # label the other way round: the plant takes the open away and a chip press does nothing.
        # The press is the same subject on the same chip; a second agent refuted its retirement. Its
        # lasting site is WorkingTogether's chip handler (the chosen card's pick-only press in
        # SessionPanel goes with UI-006). Killed by
        # `the-first-picture-of-who-called-whom.dom.test.ts`.
        [
            (WORKING_TOGETHER_VUE, '@click="canOpen && emit(\'openConversation\', card.conversation)"', '@click="canOpen && null"'),
        ],
    ),
    (
        "M26 · an agent chip lays its plate and name side by side instead of stacked — killed by `the-strip-picks-the-agent-that-is-doing-something.dom.test.ts`",
        # ⚑ Landing ui batch 4 (3e73c885..ac1918b1) · re-anchored in place, not retired — ⚠️ THE
        # RULE WAS REVERSED by 74659e69 (the chip is now plate, dot and name side by side), and this
        # row keeps its label because a label keys the recorded run: read its 'instead of' the other
        # way round. The plant stacks the chip again, which the killer's first test (plate.right <=
        # dot.left <= name.left) refuses. Killed by
        # `the-strip-picks-the-agent-that-is-doing-something.dom.test.ts`.
        [
            # ⚑ **W4.188 · re-anchored in place, not retired** — W4.188 · 27c6769e made .agent-chip a column (identity row over telemetry); plate|name|chevron side by side now lives in .team-identity's grid. One column stacks the plate above the name; killer the-strip-picks-the-agent-that-is-doing-something.dom.test.ts still asserts plate.right <= name.left.
            (WORKING_TOGETHER_VUE, "grid-template-columns: auto minmax(0, 1fr) auto;", "grid-template-columns: minmax(0, 1fr);"),
        ],
    ),
    (
        "M27 · a chip's name is no longer recoverable once it is clipped — killed by `the-first-picture-of-who-called-whom.dom.test.ts`",
        # ⚑ Landing ui batch 4 (3e73c885..ac1918b1) · re-anchored in place, not retired — The rule
        # survives: the strip chip's `.chip-name` still carries `:title="card.name"`, but 74659e69
        # re-indented it (now 16 spaces) inside CardSection > ol > li > button, so the old text
        # matched 0 times. The new anchor matches exactly once. Removing the title leaves the name
        # cut and unrecoverable: at 320px the chip's name box is about 60px (about 131px track,
        # minus border and padding, the 28px plate, the 7px dot and two 8px gaps), against roughly
        # 165px of "Project manager for slice five". The §6 sweep test then sees a cut carrier with
        # no title on it or on any ancestor, and no ancestor of the strip chip carries that name in
        # a title. The `their-own` chip's `:title="row.name"` uses `row.name`, so it is not matched
        # by this plant. Killed by `the-first-picture-of-who-called-whom.dom.test.ts`.
        # ⚑ Landing D-027, the ui stretch to 3ef68f7f and D-038 · re-anchored in place, not retired
        # — The old anchor now sits at 18 spaces of indent inside `.chip-copy` (UI-004, e09644e2),
        # and the rule (a clipped chip name stays recoverable from a title) survives. Removing only
        # the name's own `:title` would now SURVIVE: the chip button carries `title: Open
        # ${card.name}` (since f1fa1e2e/b4557797) and `titleRecovers` accepts an ancestor title that
        # contains an 8+ char name. So the row removes both carriers. Killed by
        # `the-first-picture-of-who-called-whom.dom.test.ts`.
        [
            # ⚑ **W4.188 · re-anchored in place, not retired** — W4.188 · same span, re-indented by 27c6769e (now inside .team-top). Edit 1 (the button's `Open ${card.name}` title) still matches once. Killer the-first-picture-of-who-called-whom.dom.test.ts still sweeps cast-tile-name-sess_pm for clipped-but-unrecoverable ink.
            (WORKING_TOGETHER_VUE, "class=\"chip-name\"\n                      :title=\"card.name\"\n", "class=\"chip-name\"\n"),
            (WORKING_TOGETHER_VUE, 'v-bind="canOpen ? { type: \'button\', title: `Open ${card.name}` } : {}"', 'v-bind="canOpen ? { type: \'button\' } : {}"'),
        ],
    ),
    (
        "M28 · the strip lists other agents before this conversation's own children — killed by `the-first-picture-of-who-called-whom.dom.test.ts`",
        [
            (WORKING_TOGETHER_VUE, "[...view.value.children, ...view.value.others]", "[...view.value.others, ...view.value.children]"),
        ],
    ),
    (
        "M29 · the agents strip is drawn even when there are no agents to show — killed by `the-first-picture-of-who-called-whom.dom.test.ts`",
        [
            (WORKING_TOGETHER_VUE, "<ol v-if=\"agents.length\" class=\"agent-chips\" data-cy=\"cast-children-strip\">", "<ol class=\"agent-chips\" data-cy=\"cast-children-strip\">"),
        ],
    ),
    (
        "M30 · the open agent's card draws its plate before the work it was given, instead of after — killed by `the-first-picture-of-who-called-whom.dom.test.ts`",
        # ⚑ Landing D-017 (5206d835) · re-anchored in place, not retired — The rule (the work given
        # TO the agent is drawn before its plate) is untouched by this commit; AgentCard.vue still
        # renders the `taken` section then SessionBot, just with SessionBot's props changed from
        # `:details` to `:state="props.agentState"`. The row's stale old-text (which still names
        # `:details`) is why count_now is 0; the fix is a fresh anchor on today's markup with the
        # same order swapped.
        # ⚑ Landing ui batch 3 · re-anchored in place, not retired — UI-001 (`032301e7`) handed
        # SessionBot its rail row's word (`:word`); the order the row plants is unchanged.
        # ⚑ Landing ui batch 4 (3e73c885..ac1918b1) · re-anchored in place, not retired — ⚠️ THE
        # RULE WAS REVERSED by 64ad278d (the tasks moved from above the plate to under it), and this
        # row keeps its label because a label keys the recorded run: read it the other way round.
        # The plant draws the card's children in reverse, so the work comes before the plate, which
        # the killer's §3 (plate.bottom <= line.top) refuses. Killed by
        # `the-first-picture-of-who-called-whom.dom.test.ts`.
        [
            (AGENT_CARD_VUE, '  <div class="agent-card" :class="{ scrolls: props.scrolls }">\n', '  <div class="agent-card" style="display: flex; flex-direction: column-reverse" :class="{ scrolls: props.scrolls }">\n'),
        ],
    ),
    (
        "M31 · a piece of work is filed under the conversation that GAVE it rather than the one it was given TO — killed by `the-first-picture-of-who-called-whom.dom.test.ts`",
        # ⚑ Landing ui f1fa1e2e…70aaa954 (the card panel and the Vue Flow forest) · re-anchored in
        # place, not retired — The band's `tasksTo` map is gone (f1fa1e2e: what the card drew 'is
        # the main panel's Graph tab'), but the rule 'a piece of work sits on the card of the
        # conversation it was given TO' survives in the forest fold, `forestView`'s `tasksOf` in
        # the-forest.ts, and the first-picture test still asserts it on the graph
        # (`piecesOn(kidIn(m, conversation))` equals `[conversation]`, sections 0 and 4). The plant
        # files each task under its giver (`work.from`, falling back to the holder), so a
        # recipient's card draws no piece; no existing row plants this filing (grepped tables for
        # `tasksOf`/`held.push`/`under.conversation`). Killed by
        # `the-first-picture-of-who-called-whom.dom.test.ts`.
        [
            # ⚑ D-034's window half · re-anchored in place, not retired — the holder is taken at its
            # place (a replaced holder's pieces hang on its stand-in); the plant still files each
            # piece under its giver instead.
            (THE_FOREST, '    const holder = place(node.under.conversation)\n', '    const holder = place(node.work.from ?? node.under.conversation)\n'),
        ],
    ),
    (
        "M40 · the card's context line swaps 'used' and 'window' in its own sentence (\"200,000 of 90,000 tokens\" instead of \"90,000 of 200,000\") — killed by `session-panel.render.test.ts`",
        [
            # ⚑ **W4.188 · re-anchored in place, not retired** — W4.188 · 27c6769e rewrote the context line: figure = used tokens, detail = '<pct>% of <window> tokens'. The plant names the used count as the window ('45% of 90,000 tokens'); killer session-panel.render.test.ts:367 asserts `45% of ${groupTokens(200_000)} tokens`.
            (AGENT_CARD_VUE, "detail: `${percentText(reading) ?? '—'}% of ${groupTokens(reading.window)} tokens`,", "detail: `${percentText(reading) ?? '—'}% of ${groupTokens(reading.used)} tokens`,"),
        ],
    ),
    (
        "M41 · the token-only context reading says the wrong sentence (\"window size unknown\" instead of \"window size not reported\") — killed by `session-panel.render.test.ts`",
        [
            (AGENT_CARD_VUE, "detail: 'window size not reported',", "detail: 'window size unknown',"),
        ],
    ),
    (
        "M42 · the context bar never marks the redline — a session past 90% still reads as ordinary, never as danger — killed by `the-card-stops-at-what-it-holds.render.test.ts`",
        [
            (AGENT_CARD_VUE, "limit: isRedline(reading),", "limit: false,"),
        ],
    ),
    (
        "M43 · the agent's plate reverts to the old 96px size instead of the 77px one the person asked for — killed by `session-panel.render.test.ts`",
        [
            (SESSION_BOT_VUE, "const PLATE = 77", "const PLATE = 96"),
        ],
    ),
    (
        "M44 · the plate's outer block drops the whole-name title, so a long spawned agent's name is only ever visible clipped — killed by `the-card-stops-at-what-it-holds.render.test.ts`",
        [
            (SESSION_BOT_VUE, "<div class=\"session-bot\" data-cy=\"session-bot\" :title=\"name\">", "<div class=\"session-bot\" data-cy=\"session-bot\">"),
        ],
    ),
    (
        "M45 · the right-panel Stop appears beside a sub-agent even when the provider has not listed it as live background work — killed by `background-stop.dom.test.ts`",
        # ⚑ Landing D-027, the ui stretch to 3ef68f7f and D-038 · re-anchored in place, not retired
        # — 8ad072f7 made the card's `state` required and dropped the `?.` read, so the anchor lost
        # its question mark; the rule (Stop beside a sub-agent only when the provider lists it as
        # live background work) is unchanged. The plant returns the id unconditionally. Killed by
        # `background-stop.dom.test.ts`.
        [
            (AGENT_CARD_VUE, 'return props.state.background.running.some((row) => row.id === id) ? id : null', 'return id'),
        ],
    ),
    (
        "M46 · the sub-agent Stop claims the work has already \"Stopped\" the moment it is asked, instead of the honest \"Stopping…\" — killed by `background-stop.dom.test.ts`",
        [
            (AGENT_CARD_VUE, "{{ asked.has(stopIdOf(section.key, entry)!) ? 'Stopping…' : 'Stop' }}", "{{ asked.has(stopIdOf(section.key, entry)!) ? 'Stopped' : 'Stop' }}"),
        ],
    ),
    (
        "M47 · a sub-agent Stop that did not go out never gives the control back — the button reads \"Stopping…\" forever — killed by `background-stop.dom.test.ts`",
        [
            (AGENT_CARD_VUE, "  if (!(await props.onStopBackgroundWork!(id))) {\n    const next = new Set(asked.value)\n    next.delete(id)\n    asked.value = next\n  }\n", "  await props.onStopBackgroundWork!(id)\n"),
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing ui batch 4, 64ad278d):** 64ad278d removed `v-if="panel ||
        # $slots.default"` from `.panel-body` on purpose, because the Current task box (card-task,
        # or its `card-task-empty` box) now always lives in that body. Its message: "Where no piece
        # is open, a quiet box says so". The killer's assertion was flipped from
        # `not.toContain('data-cy="panel-body"')` to `toContain('data-cy="card-task"')` plus a check
        # that no other `panel-*` section is drawn. The label's defect (always drawing a panel body
        # for a transcript-less agent) is now the shipped behaviour. The still-live rule, no
        # transcript-derived sections without a panel, has no planting that avoids a TypeError.
        # `<template v-if="panel">` guards `panel.todo` and the other `panel` field reads, so
        # forcing it true would throw on null. Its anchor is left stale, so the census records it
        # retired.
        "M48 · the agent card always draws a panel body, even for an agent this window holds no transcript of — the open agent's card no longer stops at its avatar — killed by `the-card-stops-at-what-it-holds.render.test.ts`",
        [
            (AGENT_CARD_VUE, "<div v-if=\"panel || $slots.default\" class=\"panel-body\" data-cy=\"panel-body\">", "<div v-if=\"true\" class=\"panel-body\" data-cy=\"panel-body\">"),
        ],
    ),
    (
        "M49 · a card with nothing reported yet draws garbled figures instead of an em-dash — killed by `session-panel.render.test.ts`",
        # ⚑ Landing D-027, the ui stretch to 3ef68f7f and D-038 · re-anchored in place, not retired
        # — 8ad072f7 made `props.state` required, so `reading` is never undefined.
        # ⚑ W4.208 · re-anchored in place again: the figure is the Context popup's door, so a card
        # with nothing reported draws an em-dash rather than nothing. The rule kept is the one this
        # row was about — never figures made of nothing. The plant removes the unknown branch, so an
        # unknown reading falls through to the figures branch (formatTokens(undefined) gives 'NaN',
        # no throw). Killed by `session-panel.render.test.ts`.
        [
            (
                AGENT_CARD_VUE,
                "  if (reading.kind === 'unknown')\n    return { figure: '—', detail: 'no reading yet', fill: null, limit: false }\n",
                '',
            ),
        ],
    ),
    (
        "M50 · the card's own running-work bar never offers Stop, regardless of what the pane says it can do — killed by `background-stop.dom.test.ts`",
        [
            (AGENT_CARD_VUE, ":can-stop=\"props.canStopBackgroundWork ?? false\"", ":can-stop=\"false\""),
        ],
    ),
    (
        "M60 · AssistantMessage's replies shrink back to the pre-2760914e body size (11.5px/1.55), losing the reading size — killed by `the-conversations-own-reading-size.dom.test.ts`",
        [
            # ⚑ **token plumbing · re-anchored in place, not retired** — NOT VERIFIED. The token codemod rewrote this line to read tokens; the replacement is unchanged and makes the same defect.
            (ASSISTANT_MESSAGE_VUE, "font-size: var(--type-reading);", "font-size: var(--text-base);"),
            (ASSISTANT_MESSAGE_VUE, "line-height: var(--leading-reading);", "line-height: var(--leading-relaxed);"),
        ],
    ),
    (
        "M61 · UserMessage's bubble shrinks back to the pre-2760914e body size — killed by `the-conversations-own-reading-size.dom.test.ts`",
        [
            # ⚑ **token plumbing · re-anchored in place, not retired** — NOT VERIFIED. The token codemod rewrote this line to read tokens; the replacement is unchanged and makes the same defect.
            (USER_MESSAGE_VUE, "font-size: var(--type-reading);", "font-size: var(--text-base);"),
            (USER_MESSAGE_VUE, "line-height: var(--leading-reading);", "line-height: var(--leading-relaxed);"),
        ],
    ),
    (
        "M62 · QueuedMessage's waiting text shrinks back to the pre-2760914e body size — killed by `the-conversations-own-reading-size.dom.test.ts`",
        [
            # ⚑ **token plumbing · re-anchored in place, not retired** — NOT VERIFIED. The token codemod rewrote this line to read tokens; the replacement is unchanged and makes the same defect.
            (QUEUED_MESSAGE_VUE, "font-size: var(--type-reading);", "font-size: var(--text-base);"),
            (QUEUED_MESSAGE_VUE, "line-height: var(--leading-reading);", "line-height: var(--leading-relaxed);"),
        ],
    ),
    (
        "M63 · AppNoticeEntry's notice text shrinks back to the pre-2760914e body size — killed by `the-conversations-own-reading-size.dom.test.ts`",
        [
            # ⚑ **token plumbing · re-anchored in place, not retired** — NOT VERIFIED. The token codemod rewrote this line to read tokens; the replacement is unchanged and makes the same defect.
            (APP_NOTICE_ENTRY_VUE, "font-size: var(--type-reading);", "font-size: var(--text-base);"),
            (APP_NOTICE_ENTRY_VUE, "line-height: var(--leading-reading);", "line-height: var(--leading-relaxed);"),
        ],
    ),
    (
        "M64 · ContinuationEntry's sent-for-you text shrinks back to the pre-2760914e body size — killed by `the-conversations-own-reading-size.dom.test.ts`",
        [
            # ⚑ **token plumbing · re-anchored in place, not retired** — NOT VERIFIED. The token codemod rewrote this line to read tokens; the replacement is unchanged and makes the same defect.
            (CONTINUATION_ENTRY_VUE, "font-size: var(--type-reading);", "font-size: var(--text-base);"),
            (CONTINUATION_ENTRY_VUE, "line-height: var(--leading-reading);", "line-height: var(--leading-relaxed);"),
        ],
    ),
    (
        "M65 · RelayedEntry's relayed text shrinks back to the pre-2760914e body size — killed by `the-conversations-own-reading-size.dom.test.ts`",
        [
            # ⚑ **token plumbing · re-anchored in place, not retired** — NOT VERIFIED. The token codemod rewrote this line to read tokens; the replacement is unchanged and makes the same defect.
            (RELAYED_ENTRY_VUE, "font-size: var(--type-reading);", "font-size: var(--text-base);"),
            (RELAYED_ENTRY_VUE, "line-height: var(--leading-reading);", "line-height: var(--leading-relaxed);"),
        ],
    ),
    (
        "M66 · the whole conversation's reading size (--text-reading) shrinks back to 11.5px, and every message body follows it down at once — killed by `the-conversations-own-reading-size.dom.test.ts`",
        [
            # ⚑ **W4.205 · re-anchored in place, not retired** — W4.205 · 2ca719c5 made --text-reading an alias of --type-reading (15px) and --leading-reading 1.6; the plant still shrinks only the conversation's reading token. ⚠️ The killer the-conversations-own-reading-size.dom.test.ts still pins 14px / 21px (and p = 14), but HEAD computes 15px / 24px, so it is red on HEAD and cannot score this row until its numbers move to 15 / 24.
            (TOKENS_CSS, "  --text-reading: var(--type-reading);", "  --text-reading: 11.5px;"),
        ],
    ),
    (
        "M67 · an h1 inside a reply goes back to a fixed 13px, smaller than the 14px paragraph it introduces — killed by `the-conversations-own-reading-size.dom.test.ts`",
        [
            # ⚑ **token plumbing · re-anchored in place, not retired** — NOT VERIFIED. The token codemod rewrote this line to read tokens; the replacement is unchanged and makes the same defect.
            (BASE_CSS, "font-size: var(--type-md-h1);", "font-size: var(--text-lg);"),
        ],
    ),
    (
        "M68 · inline code inside a reply goes back to a fixed size instead of scaling with the text it sits in — killed by `the-conversations-own-reading-size.dom.test.ts`",
        [
            # ⚑ **W4.205 · re-anchored in place, not retired** — W4.205 · 2ca719c5 floored inline code at max(--type-caption, 0.88em); at today's 15px reading size that is 13.2px and the fixed plant gives 13px (--text-sm), 0.2px off, which toBeCloseTo(…, 1) still catches. ⚠️ Same killer as M66, red on HEAD because it pins the paragraph at 14px.
            # ⚑ **W4.275 · re-anchored in place, not retired** — W4.275 · 619f250d gave the path link in a message the same font-size line, so the anchor now takes the inline-code rule's line-height too; the plant still puts inline code in a reply back to a fixed 13px.
            # ⚑ **token plumbing · re-anchored in place, not retired** — NOT VERIFIED. The token codemod rewrote this line to read tokens; the replacement is unchanged and makes the same defect.
            (BASE_CSS, "  font-family: var(--font-mono);\n  font-size: var(--type-code-inline);\n  line-height: var(--leading-normal);", "  font-family: var(--font-mono);\n  font-size: var(--text-sm);\n  line-height: var(--leading-normal);"),
        ],
    ),
    (
        "M69 · the heading ladder stops descending: h2 reads the same size as h3 — killed by `the-conversations-own-reading-size.dom.test.ts`",
        [
            # ⚑ **token plumbing · re-anchored in place, not retired** — NOT VERIFIED. The token codemod rewrote this line to read tokens; the replacement is unchanged and makes the same defect.
            (BASE_CSS, "font-size: var(--type-md-h2);", "font-size: 1.05em;"),
        ],
    ),
    (
        "M70 · detached (background) work reads as `scheduled`, not `background` — killed by `idle-truth.test.ts`, `idle-truth.render.test.ts`, `status-agreement.dom.test.ts`, `agent-state.test.ts`",
        # ⚑ Landing D-017 (5206d835) · re-anchored in place, not retired — D-017 R11 moved the
        # window's if-chain into `shared/agent-state.ts`'s `agentStateArm`, which every reader
        # (standingOf, workLeftBehind, agentStateOf) now asks in one place; the priority rule itself
        # (background beats a mere schedule) is untouched. Making the `inTheBackground` branch
        # return `'scheduled'` reproduces exactly "detached work reads as scheduled, not background"
        # in today's single source of truth.
        [
            (AGENT_STATE_, "  if (facts.inTheBackground) return 'in-the-background'\n", "  if (facts.inTheBackground) return 'scheduled'\n"),
        ],
    ),
    (
        "M71 · the background phrase drops its preposition — 'running the background' — killed by `idle-truth.test.ts`, `idle-truth.render.test.ts`, `status-agreement.dom.test.ts`, `agent-state.test.ts`",
        # ⚑ Landing D-017 (5206d835) · re-anchored in place, not retired — `IN_THE_BACKGROUND` moved
        # verbatim from the renderer's `agent-state.ts` to `shared/agent-state.ts` (same string,
        # same name, D-017 R11's whole-file move), so the constant just needs its file corrected.
        # Dropping the preposition still gives 'running the background' instead of 'running in the
        # background', which every surface reading this constant renders.
        [
            (AGENT_STATE_, "export const IN_THE_BACKGROUND = 'running in the background'\n", "export const IN_THE_BACKGROUND = 'running the background'\n"),
        ],
    ),
    (
        "M72 · the schedule word loses its participle — 'schedule' instead of 'scheduled' — killed by `schedule-words.test.ts`",
        # ⚑ Landing D-017 (5206d835) · re-anchored in place, not retired — `SCHEDULE_WORD` (renderer
        # scheduled-work.ts) was renamed `SCHEDULED` and moved to `shared/agent-state.ts` under
        # D-017 R11, but it is still the one word `scheduleHead`, `STANDING_LABEL` and
        # `agentStateWords` all read. Dropping the participle to 'schedule' is the same defect on
        # its new name and location.
        [
            (AGENT_STATE_, "export const SCHEDULED = 'scheduled'\n", "export const SCHEDULED = 'schedule'\n"),
        ],
    ),
    (
        "M73 · the background detail's separator becomes a dash instead of a middle dot — killed by `one-state-everywhere.test.ts`, `status-agreement.dom.test.ts`",
        # ⚑ Landing D-017 (5206d835) · re-anchored in place, not retired — The hand-built
        # `${IN_THE_BACKGROUND} · ${details.backgroundAs}` template moved into
        # `shared/agent-state.ts`'s `agentStateWords`, `in-the-background` arm, with the identical
        # middle-dot separator. Swapping it to a dash is the same defect in the one function every
        # surface now calls for this sentence.
        [
            (AGENT_STATE_, '      return state.what === null ? IN_THE_BACKGROUND : `${IN_THE_BACKGROUND} · ${state.what}`\n', '      return state.what === null ? IN_THE_BACKGROUND : `${IN_THE_BACKGROUND} - ${state.what}`\n'),
        ],
    ),
    (
        "M74 · the scheduled detail's separator becomes a dash instead of a middle dot — killed by `one-state-everywhere.test.ts`, `the-losing-detail-says-nothing.render.test.ts`",
        # ⚑ Landing D-017 (5206d835) · re-anchored in place, not retired — Same move as M73, one arm
        # over: the `scheduled` case of `agentStateWords` in `shared/agent-state.ts` builds
        # `${SCHEDULED} · ${clockTime(state.dueAt)}` with the same middle dot. Swapping it to a dash
        # reproduces the separator defect in the sentence `standingWord`/`plateWord` now both read.
        [
            (AGENT_STATE_, '      return state.dueAt === null ? SCHEDULED : `${SCHEDULED} · ${clockTime(state.dueAt)}`\n', '      return state.dueAt === null ? SCHEDULED : `${SCHEDULED} - ${clockTime(state.dueAt)}`\n'),
        ],
    ),
    (
        "M75 · theDetails writes the wake-up time under the wrong key, so it never reaches the scheduled word — killed by `the-losing-detail-says-nothing.render.test.ts`",
        # ⚑ Landing D-017 (5206d835) · re-anchored in place, not retired — The old
        # `theDetails`-with-`wakesAt`/`backgroundAs` keys is gone, but the same shape survives as
        # `agentStateOf`'s discriminated-union arms in `shared/agent-state.ts`: `dueAt` for
        # `scheduled`, `what` for `in-the-background`. Writing the wake time under `what` instead of
        # `dueAt` on the `scheduled` arm loses it the same way — `agentStateWords` reads
        # `state.dueAt` (now `undefined`, not `null`), takes the non-null branch and prints
        # `scheduled · ` with the time silently gone via `clockTime(undefined)` → `''`.
        [
            (AGENT_STATE_, "  if (arm === 'scheduled') return { is: arm, dueAt: nextWake(facts.scheduled.jobs, now) }\n", "  if (arm === 'scheduled') return { is: arm, what: nextWake(facts.scheduled.jobs, now) }\n"),
        ],
    ),
    (
        "M76 · theDetails writes the background command under the wrong key, so it never reaches the background word — killed by `status-agreement.dom.test.ts`, `the-losing-detail-says-nothing.render.test.ts`",
        # ⚑ Landing D-017 (5206d835) · re-anchored in place, not retired — Mirror of M75 on the
        # other arm: writing the background command under `dueAt` instead of `what` on
        # `agentStateOf`'s `in-the-background` branch means `agentStateWords` never sees it
        # (`state.what` is `undefined`, not `null`) and prints 'running in the background ·
        # undefined' instead of the command — the command never reaches the background word.
        [
            (AGENT_STATE_, "  if (arm === 'in-the-background') return { is: arm, what: inTheBackground(facts.background) }\n", "  if (arm === 'in-the-background') return { is: arm, dueAt: inTheBackground(facts.background) }\n"),
        ],
    ),
    (
        "M77 · the avatar mark checks `scheduled` before `detached`, so a schedule wins the corner when both hold — killed by `one-state-everywhere.render.test.ts`",
        # ⚑ Landing D-017 (5206d835) · re-anchored in place, not retired — The component's own
        # ternary was replaced by `workLeftBehind` (renderer `lib/agent-state.ts`), which now
        # delegates priority to `agentStateArm` (background checked before schedule). Feeding the
        # two facts into `agentStateArm` swapped, with the return mapped back, makes only the
        # both-true case pick `scheduled` over `background` while leaving each single-fact case
        # correct — exactly 'schedule wins the corner when both hold'.
        # ⚑ Landing D-029, D-036, D-031 and D-039 through 7d54be3b · re-anchored in place, not
        # retired — D-036 (ea3cf258) added `waitingOnAWorker: false,` as the sixth fact in
        # workLeftBehind's agentStateArm call, so the old function-body anchor no longer matches.
        # The rule survives (the background wins the corner when both facets hold, via the one
        # order); the plant is the same swap of the two facts with the return mapped back, now
        # including the new fact line. Killed by `one-state-everywhere.render.test.ts`.
        [
            (AGENT_STATE, "export function workLeftBehind(\n  facets: Pick<AgentFacets, 'detached' | 'scheduled'>,\n): 'background' | 'scheduled' | null {\n  const arm = agentStateArm({\n    needsYou: false,\n    active: false,\n    waitingOnAnAnswer: false,\n    inTheBackground: facets.detached === true,\n    scheduled: facets.scheduled === true,\n    waitingOnAWorker: false,\n  })\n  return arm === 'in-the-background' ? 'background' : arm === 'scheduled' ? 'scheduled' : null\n}", "export function workLeftBehind(\n  facets: Pick<AgentFacets, 'detached' | 'scheduled'>,\n): 'background' | 'scheduled' | null {\n  const arm = agentStateArm({\n    needsYou: false,\n    active: false,\n    waitingOnAnAnswer: false,\n    inTheBackground: facets.scheduled === true,\n    scheduled: facets.detached === true,\n    waitingOnAWorker: false,\n  })\n  return arm === 'in-the-background' ? 'scheduled' : arm === 'scheduled' ? 'background' : null\n}"),
        ],
    ),
    (
        "M78 · the avatar mark's two glyphs are swapped — a clock for background, a terminal for a schedule — killed by `one-state-everywhere.render.test.ts`",
        # ⚑ Landing D-017 (5206d835) · re-anchored in place, not retired — The component's ternary
        # chain is gone; the glyph choice is now the `WORK_MARK` lookup object in `AgentState.vue`,
        # fed by `workLeftBehind`'s priority (M77) and left untouched here. Swapping its two values
        # reproduces 'a clock for background, a terminal for a schedule' with the priority order
        # left correct.
        [
            (AGENT_STATE_VUE, "const WORK_MARK = { background: '#i-terminal', scheduled: '#i-clock' } as const\n", "const WORK_MARK = { background: '#i-clock', scheduled: '#i-terminal' } as const\n"),
        ],
    ),
    (
        "M79 · the work-mark badge is no longer hidden from a screen reader — killed by `one-state-everywhere.render.test.ts`",
        [
            # ⚑ **source-restoration · re-anchored in place, not retired** — NOT VERIFIED; source targeting only. The needs-mark glyph now also uses aria-hidden; scope the edit to the work-mark badge named by this row.
            (AGENT_STATE_VUE, "          :title=\"cornerSays ?? undefined\"\n          aria-hidden=\"true\"\n", "          :title=\"cornerSays ?? undefined\"\n          data-hidden=\"true\"\n"),
        ],
    ),
    (
        "M80 · the work-mark's `data-mark` names the wrong fact — 'scheduled' for background work and vice versa — killed by `one-state-everywhere.render.test.ts`",
        # ⚑ Landing D-017 (5206d835) · re-anchored in place, not retired — The template's own
        # ternary for `data-mark` is gone; the attribute now binds straight to `workLeft` (the fact
        # name from `workLeftBehind`), while the glyph is a separate lookup (M78). Flipping only the
        # attribute's fact name — never the glyph it sits beside — reproduces 'data-mark names the
        # wrong fact' independently of which icon is drawn.
        [
            # ⚑ **W4.275 · re-anchored in place, not retired** — W4.275 · bda8b1be let the corner mark say 'waiting' for a wait on another agent and split the span over several lines; the plant still swaps 'scheduled' and 'background' on the work-left mark.
            # ⚑ **source-restoration · re-anchored in place, not retired** — NOT VERIFIED; source targeting only. b73c3ce41 added an owes corner kind; preserve waiting and owes while swapping only background/scheduled, as the original work-mark mutation did.
            (AGENT_STATE_VUE, "          :data-mark=\"cornerKind\"\n", "          :data-mark=\"cornerKind === 'background' ? 'scheduled' : cornerKind === 'scheduled' ? 'background' : cornerKind\"\n"),
        ],
    ),
    (
        "M81 · the cron day rule becomes AND instead of OR when both day-of-month and day-of-week are restricted — killed by `the-losing-detail-says-nothing.render.test.ts`",
        # ⚑ Landing D-017 (5206d835) · re-anchored in place, not retired — `nextFire`'s cron day
        # rule moved whole from `scheduled-work.ts` into `shared/agent-state.ts` (D-017 R11), body
        # unchanged including cron's OR-when-both-restricted rule. Flipping `||` to `&&` is the
        # identical defect on the relocated function, still caught by the same dual-restricted-field
        # fixture.
        # ⚑ Landing D-029, D-036, D-031 and D-039 through 7d54be3b · re-anchored in place, not
        # retired — D-031 (4c8d494b) rewrote the cron walk on the Mac's wall clock (`walkTo`),
        # renaming `dayMatches || weekdayMatches` to `dom.has(date) || dow.has(day)` inside
        # `dayMatches`. The rule is unchanged: when both day fields are restricted either one
        # matching is enough. Flipping `||` to `&&` is the same defect, and the killer's `0 3 5 * 2`
        # fixture (5 Oct is a Monday, so Tuesday 29 Sept must win) still separates OR from AND.
        # Killed by `the-losing-detail-says-nothing.render.test.ts`.
        [
            # ⚑ **source-restoration · re-anchored in place, not retired** — NOT VERIFIED; source targeting only. 7767d7951 moved cron matching into clean-room scheduling; retain star-origin handling and turn only the both-restricted OR into AND.
            ("apps/desktop/src/shared/schedule-wake.ts", "  return cron.day.starOrigin || cron.weekday.starOrigin ? day && weekday : day || weekday", "  return cron.day.starOrigin || cron.weekday.starOrigin ? day && weekday : day && weekday"),
        ],
    ),
    (
        "M82 · inTheBackground's '+N' drops the rows the provider sent but this app cannot list — killed by `the-losing-detail-says-nothing.render.test.ts`",
        # ⚑ Landing D-017 (5206d835) · re-anchored in place, not retired — `inTheBackground`'s '+N'
        # arithmetic moved from the renderer's `background-work.ts` into `shared/agent-state.ts`,
        # keeping `running.length - 1 + dropped`. Dropping `+ level.dropped` still silently
        # undercounts a dropped-only registry (something the level held but this app cannot name),
        # the exact case the losing-detail test's dropped-only fixture exercises.
        [
            (AGENT_STATE_, '  const more = level.running.length - 1 + level.dropped\n', '  const more = level.running.length - 1\n'),
        ],
    ),
    (
        "M83 · nextWake picks the LATEST firing across jobs instead of the soonest — killed by `one-state-everywhere.test.ts`",
        # ⚑ Landing D-017 (5206d835) · re-anchored in place, not retired — `nextWake`'s
        # soonest-across-jobs fold moved whole from `scheduled-work.ts` into
        # `shared/agent-state.ts`, same loop and same comparison. Flipping `<` to `>` still makes it
        # pick the latest firing instead of the soonest, caught by the same three-job fixture (a
        # one-shot due sooner than a daily recurrence).
        [
            # ⚑ **source-restoration · re-anchored in place, not retired** — NOT VERIFIED; source targeting only. 7767d7951 made nominalAt authoritative; preserve unknown/past suppression and choose only the latest instead of earliest known future firing.
            ("apps/desktop/src/shared/agent-state.ts", "    if (at !== undefined && at > now && (soonest === null || at < soonest)) soonest = at\n", "    if (at !== undefined && at > now && (soonest === null || at > soonest)) soonest = at\n"),
        ],
    ),
    (
        "M84 · standingOf checks `scheduled` before `detached`, so a mere schedule outranks work actually running now — killed by `the-losing-detail-says-nothing.render.test.ts`",
        # ⚑ Landing D-017 (5206d835) · re-anchored in place, not retired — `standingOf`'s own
        # if-chain is gone, replaced by `agentStateArm(armFactsOf(facets))` plus a switch, but the
        # same priority rule (background outranks a mere schedule) is what `armFactsOf` feeds and
        # the switch reads back out — and the-losing-detail-says-nothing.render.test.ts §3 tests
        # exactly this precedence today. Swapping which local fact feeds
        # `inTheBackground`/`scheduled` in `armFactsOf`, and swapping the switch's two return values
        # to match, reproduces 'a mere schedule outranks work actually running now' only when both
        # hold, leaving each single-fact case (and `stateHere`'s separate, unaffected read of the
        # real registries) correct.
        [
            # ⚑ W4.83 (F036's window half) · re-anchored in place: `owesAnAnswer` now sits between the
            # wait and the background line; the plant still swaps the background and the schedule.
            (AGENT_STATE, "    owesAnAnswer: facets.owes !== undefined,\n    inTheBackground: facets.detached === true,\n    scheduled: facets.scheduled === true,\n  }\n}", "    owesAnAnswer: facets.owes !== undefined,\n    inTheBackground: facets.scheduled === true,\n    scheduled: facets.detached === true,\n  }\n}"),
            (AGENT_STATE, "    case 'in-the-background':\n      return 'background'\n    case 'scheduled':\n      return 'scheduled'", "    case 'in-the-background':\n      return 'scheduled'\n    case 'scheduled':\n      return 'background'"),
        ],
    ),
    (
        "M85 · plateWord stops treating `scheduled` as a standing with a second fact to tell, falling back to the bare DOING word — killed by `one-state-everywhere.test.ts`",
        # ⚑ Landing D-029, D-036, D-031 and D-039 through 7d54be3b · re-anchored in place, not
        # retired — UI-008 (c37e0fd1) put `standing === 'waiting' ||` first in plateWord's list, so
        # the old anchor starting at `return standing === 'background' ||` is gone. The rule
        # survives: a scheduled plate must say its schedule, not the bare DOING word. The
        # re-anchored text starts at the `background` line and drops `scheduled`. Killed by
        # `one-state-everywhere.test.ts`.
        [
            (AGENT_STATE, "    standing === 'background' ||\n    standing === 'scheduled' ||\n    standing === 'elsewhere' ||", "    standing === 'background' ||\n    standing === 'elsewhere' ||"),
        ],
    ),
]
