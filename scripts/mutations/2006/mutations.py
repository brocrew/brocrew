"""2006 · the `ui` stretch from `f1fa1e2e` to `128203e6`, rowed once on what survived it.

⚑ **Why `2006`**: the landing's tables for the frontend's `ui` batches are `2001`–`2005`; this is the
sixth. The stretch landed over seven landings (L-001, 2026-10-01). It added a chosen-agent card and
removed it (UI-006), a double-click and its revert (UI-005), and the Spawn path strip's removal. Its
rows were deferred to this one table, on the code that holds today, as the frontend's note asked: no row
on the machinery UI-006 removed.

## What it built

* **The agent card** (`M1`–`M15`): the right panel as this agent's card, the way up at its top, the
  chips' profile and state words, Current task showing the piece a person gave, the card's files, the
  Images heading, the memory line.
* **The Graph** (`M20`–`M34`): the Team forest on Vue Flow, everyone from BroBot down; each card as its
  rail row; a dashed line while a parent holds an open piece it gave; a press selecting an agent; the
  file counts.
* **Files and cards** (`M40`–`M54`): the Files tab, the cards' file rows, the viewer's header, the
  take-on card, and UI-011's cut brief opening whole in the helper's conversation.
* **The rail, the header and the waits** (`M60`–`M74`): the side menu split, the header without its
  warnings row, refusals in words, UI-009's question answered where it is asked, UI-010's Jump to latest.

Killed mostly by four landing DOM files (`the-card-says-the-work-a-person-gave-and-what-it-holds`,
`the-graph-is-moved-by-hand-grows-with-its-cards-and-is-fed-by-the-screen`,
`a-cut-brief-opens-to-its-whole-and-a-card-lists-only-its-own-files`,
`a-question-is-answered-where-it-is-asked-and-the-words-around-it-are-plain`), and by the frontend's own.

Designed read-only by Sonnet 5.5 agents from the commits and today's code; each row verified alone by
the landing agent.

## Verification

- **RED: 60 of 60.** Each row alone by `verify_row.py` with its named killer, on `landing` over
  `2ec060e0` (the merge of `128203e6`, the stretch's last `ui` commit), none by a syntax, reference or
  type error. Each killer file ran green unmutated first.
"""

AGENT_CARD_VUE = "apps/desktop/src/renderer/src/components/AgentCard.vue"
AGENT_PANEL_TS = "apps/desktop/src/renderer/src/lib/agent-panel.ts"
CANONICAL_DOCUMENT_VIEWER_VUE = "apps/desktop/src/renderer/src/components/CanonicalDocumentViewer.vue"
CONVERSATION_PANE_VUE = "apps/desktop/src/renderer/src/components/ConversationPane.vue"
FOREST_CARD_VUE = "apps/desktop/src/renderer/src/components/ForestCard.vue"
OUTGOING_ENTRY_VUE = "apps/desktop/src/renderer/src/components/OutgoingEntry.vue"
QUESTION_CARD_VUE = "apps/desktop/src/renderer/src/components/QuestionCard.vue"
RELAYED_ENTRY_VUE = "apps/desktop/src/renderer/src/components/RelayedEntry.vue"
RUNTIME_SCREEN_VUE = "apps/desktop/src/renderer/src/components/RuntimeScreen.vue"
SESSION_DRAWER_VUE = "apps/desktop/src/renderer/src/components/SessionDrawer.vue"
SESSION_HEADER_VUE = "apps/desktop/src/renderer/src/components/SessionHeader.vue"
SESSION_PANEL_VUE = "apps/desktop/src/renderer/src/components/SessionPanel.vue"
SIDE_RAIL_VUE = "apps/desktop/src/renderer/src/components/SideRail.vue"
TASK_LIST_VUE = "apps/desktop/src/renderer/src/components/TaskList.vue"
TEAM_FOREST_VUE = "apps/desktop/src/renderer/src/components/TeamForest.vue"
TRANSCRIPT_VIEW_VUE = "apps/desktop/src/renderer/src/components/TranscriptView.vue"
WORKING_TOGETHER_VUE = "apps/desktop/src/renderer/src/components/WorkingTogether.vue"
USE_STICK_TO_BOTTOM = "apps/desktop/src/renderer/src/composables/useStickToBottom.ts"
AGENT_STATE = "apps/desktop/src/renderer/src/lib/agent-state.ts"
FILES_KEPT = "apps/desktop/src/renderer/src/lib/files-kept.ts"
FOREST_GRAPH = "apps/desktop/src/renderer/src/lib/forest-graph.ts"
HOME_ATTENTION = "apps/desktop/src/renderer/src/lib/home-attention.ts"
OUTGOING_CARD = "apps/desktop/src/renderer/src/lib/outgoing-card.ts"
PERSONS_QUEUE = "apps/desktop/src/renderer/src/lib/persons-queue.ts"
QUESTION_CARD = "apps/desktop/src/renderer/src/lib/question-card.ts"
RAIL_SECTIONS = "apps/desktop/src/renderer/src/lib/rail-sections.ts"
THE_FOREST = "apps/desktop/src/renderer/src/lib/the-forest.ts"
TRANSCRIPT = "apps/desktop/src/renderer/src/lib/transcript.ts"
USAGE_LIMIT = "apps/desktop/src/renderer/src/lib/usage-limit.ts"
WORKING_TOGETHER = "apps/desktop/src/renderer/src/lib/working-together.ts"

MUTATIONS: list[tuple[str, list[tuple[str, str, str]]]] = [
    (
        "M1 · 🔴 the card's word under the plate says the DOING over a person's wait · a conversation that needs a person's permission or answer reads 'using a tool' or 'idle' under its plate while the rail, the pill and the tools say 'needs you' (UI-008, F051) — killed by `session-panel.render.test.ts`, `agent-state.test.ts`, the new file — killed by `session-panel.render.test.ts`, `agent-state.test.ts`, `the-card-says-the-work-a-person-gave-and-what-it-holds.dom.test.ts`",
        [
            # ⚑ W4.83 (F036) · re-anchored in place: `owes` now follows `waiting` in the list; the plant
            # still drops the person's wait from it.
            (AGENT_STATE, "  return standing === 'waiting' ||\n    standing === 'owes' ||", "  return standing === 'owes' ||"),
        ],
    ),
    (
        "M2 · 🔴 any named piece is drawn as the work a person gave · a conversation named by a sub-piece its parent gave it (W1.2) wears a root line 'W1.2 · for you', claiming a person gave it work they never did — killed by the new file — killed by `the-card-says-the-work-a-person-gave-and-what-it-holds.dom.test.ts`",
        [
            (WORKING_TOGETHER, "  return pieceNumbersOf(named.label)?.length === 1 ? named : null", "  return named"),
        ],
    ),
    (
        "M3 · 🔴 the drawer does not hand the work that names the conversation on to its card · the Current task box never draws the piece a person gave and says 'No current task' over the work the person gave it — killed by the new file — killed by `the-card-says-the-work-a-person-gave-and-what-it-holds.dom.test.ts`",
        [
            (SESSION_DRAWER_VUE, "        :named=\"props.named ?? null\"\n", "        :named=\"null\"\n"),
        ],
    ),
    (
        "M4 · 🔴 a root does not count as an open task · a conversation that owns only the work a person gave it is told 'No current task' under the line that shows that very work — killed by the new file — killed by `the-card-says-the-work-a-person-gave-and-what-it-holds.dom.test.ts`",
        [
            (AGENT_CARD_VUE, "  () => root.value !== null || (props.tasks?.some((one) => one.piece.open) ?? false),", "  () => props.tasks?.some((one) => one.piece.open) ?? false,"),
        ],
    ),
    (
        "M5 · ⛔ the root takes no line of the five · five open pieces and a root draw six lines and none is counted as left out, so Current task grows past its bound — killed by the new file — killed by `the-card-says-the-work-a-person-gave-and-what-it-holds.dom.test.ts`",
        [
            (TASK_LIST_VUE, "  const room = AT_MOST - latest.length - (props.root ? 1 : 0)", "  const room = AT_MOST - latest.length"),
        ],
    ),
    (
        "M6 · ⚑ the root is always drawn as the current piece · beside a piece still open it takes the accent well and file icon the open piece should have, so two lines claim to be the one being worked on — killed by the new file — killed by `the-card-says-the-work-a-person-gave-and-what-it-holds.dom.test.ts`",
        [
            (TASK_LIST_VUE, "const rootIsCurrent = computed(() => current.value === null)", "const rootIsCurrent = computed(() => true)"),
        ],
    ),
    (
        "M7 · 🔴 the card's Files run oldest first · the newest file sinks to the bottom of the box instead of leading it — killed by `the-card-lists-the-files-its-agent-added.dom.test.ts`",
        # ⚑ **W4.188 · re-anchored, file moved** — 85caae17 (the v3 Agent panel) dropped the card's
        # grouping by piece (`filesByPieceNewestFirst`); the Files box now orders its tiles newest
        # first in `agent-panel.ts`. Same defect, one file over; `files-kept.test.ts` lost its group
        # cases, so the DOM test alone kills it.
        [
            (AGENT_PANEL_TS, "  const allFiles = [...(input.files ?? [])].sort((a, b) => b.keptAt - a.keptAt)", "  const allFiles = [...(input.files ?? [])].sort((a, b) => a.keptAt - b.keptAt)"),
        ],
    ),
    (
        "M8 · ⛔ the card draws the files read for another agent · after a selection moves, a Files box holding the last agent's files sits under this agent's name until its own read lands — killed by `the-card-lists-the-files-its-agent-added.dom.test.ts` — killed by `the-card-lists-the-files-its-agent-added.dom.test.ts`",
        [
            (SESSION_DRAWER_VUE, "  return read !== null && read.conversation === props.session.sessionId ? read : null", "  return read"),
        ],
    ),
    (
        "M9 · 🔴 the pane does not hand the work that names the conversation to its drawer · the header is titled by the root but the card beside it says 'No current task' over the work a person gave — killed by the new file — killed by `the-card-says-the-work-a-person-gave-and-what-it-holds.dom.test.ts`",
        [
            # ⚑ **source-restoration · re-anchored in place, not retired** — NOT VERIFIED; source targeting only. d96cd5232 added a limit prop between state and root work; preserve it while omitting only the drawer naming work.
            (CONVERSATION_PANE_VUE, "        :agent-state=\"agentState\"\n        :provider-limit=\"providerLimit\"\n        :named=\"props.named ?? null\"\n        :work=\"props.work ?? null\"", "        :agent-state=\"agentState\"\n        :provider-limit=\"providerLimit\"\n        :named=\"null\"\n        :work=\"props.work ?? null\""),
        ],
    ),
    (
        "M10 · ⚑ the pictures section is headed Resources again · the word UI-002 reserved for the files kept on an agent's work heads a section of generated images, so Files and Resources mean two things — killed by `the-card-draws-what-its-agent-made.dom.test.ts` — killed by `the-card-draws-what-its-agent-made.dom.test.ts`, `the-agent-card-frames-what-it-knows-and-nothing-more.dom.test.ts`",
        [
            (AGENT_CARD_VUE, "<template #title>Images</template>", "<template #title>Resources</template>"),
        ],
    ),
    (
        "M11 · 🔴 a conversation whose process does not run is given a memory figure · the card says '0 MB in use' for an agent holding nothing, a claim about a process that is not there — killed by the new file — killed by `the-card-says-the-work-a-person-gave-and-what-it-holds.dom.test.ts`",
        [
            # ⚑ W4.183 re-anchor: the card's memory figure is the v3 fold's now (`agent-panel.ts`), the same defect.
            # ⚑ **source-restoration · re-anchored in place, not retired** — NOT VERIFIED; source targeting only. 08371e44e made the missing-memory word configurable; still invent a measured zero when the process has no reading.
            (AGENT_PANEL_TS, "      memory:\n        bytes === undefined\n          ? missing(input.memoryUnmeasured ?? NOT_RUNNING_NOW)\n          : known(processMemoryWords(bytes)),", "      memory: known(processMemoryWords(bytes ?? 0)),"),
        ],
    ),
    (
        "M12 · 🔴 a chip's state word is not clamped · a long wait ('waiting on an answer from <a long name>') grows its chip to six lines and the row grows with it, instead of stopping at two lines with the whole word on its title — killed by `the-first-picture-of-who-called-whom.dom.test.ts` — killed by `the-first-picture-of-who-called-whom.dom.test.ts`",
        [
            (WORKING_TOGETHER_VUE, "  -webkit-box-orient: vertical;\n  -webkit-line-clamp: 2;\n}", "  -webkit-box-orient: vertical;\n  -webkit-line-clamp: none;\n}"),
        ],
    ),
    (
        "M13 · 🔴 chips in a row stop sharing one height · the li stops stretching its chip, so a chip with a state word stands taller than its neighbour that has none and the row is ragged — killed by `the-card-says-what-the-rail-says.dom.test.ts` — killed by `the-card-says-what-the-rail-says.dom.test.ts` · killed by `chips-side-by-side-share-one-height-whatever-each-reports.dom.test.ts`",
        [
            # ⚑ **W4.188 · re-anchored in place, not retired** — W4.188 · 27c6769e added `min-width: 0` to the same rule. DOUBT: the state word now sits beside the name (.team-top), so a card with a word may be no taller than one without; killer the-card-says-what-the-rail-says.dom.test.ts still asserts a.height === b.height but may not discriminate — verify_row decides.
            (WORKING_TOGETHER_VUE, ".agent-chips > li {\n  display: flex;\n  min-width: 0;\n}", ".agent-chips > li {\n  display: block;\n  min-width: 0;\n}"),
        ],
    ),
    (
        "M14 · 🔴 the way up names its own conversation, not the parent's · a press on the ↑ opens the conversation already on screen, so nobody can climb to the agent that spawned it — killed by `the-main-panel-shows-the-conversation-or-its-graph.dom.test.ts` — killed by `the-main-panel-shows-the-conversation-or-its-graph.dom.test.ts`",
        [
            (SESSION_PANEL_VUE, "@click=\"emit('openConversation', parent.conversation)\"", "@click=\"emit('openConversation', props.conversation ?? '')\""),
        ],
    ),
    (
        "M15 · ⛔ the way up's name no longer gives way inside its own box · at 320 px a long parent name runs past the pill and the panel clips it from outside, so the pill's own ellipsis and title no longer tell it whole — killed by the new file — killed by `the-card-says-the-work-a-person-gave-and-what-it-holds.dom.test.ts`",
        [
            (SESSION_PANEL_VUE, ".came-name {\n  overflow: hidden;\n  min-width: 0;", ".came-name {\n  overflow: visible;\n  min-width: 0;"),
        ],
    ),
    (
        "M20 · The + press zooms out: both zoom buttons shrink the drawing, so a person can never bring a card closer — killed by `the-graph-is-moved-by-hand-grows-with-its-cards-and-is-fed-by-the-screen.dom.test.ts` — killed by `the-graph-is-moved-by-hand-grows-with-its-cards-and-is-fed-by-the-screen.dom.test.ts`",
        [
            (TEAM_FOREST_VUE, "@click=\"flow.zoomIn()\"", "@click=\"flow.zoomOut()\""),
        ],
    ),
    (
        "M21 · A scroll over the drawing zooms it instead of panning it (zoom-on-scroll and pan-on-scroll swapped), so the cards change size and stay put when a person scrolls — killed by `the-graph-is-moved-by-hand-grows-with-its-cards-and-is-fed-by-the-screen.dom.test.ts` — killed by `the-graph-is-moved-by-hand-grows-with-its-cards-and-is-fed-by-the-screen.dom.test.ts`",
        [
            (TEAM_FOREST_VUE, ":zoom-on-scroll=\"false\"\n          :pan-on-scroll=\"true\"", ":zoom-on-scroll=\"true\"\n          :pan-on-scroll=\"false\""),
        ],
    ),
    (
        "M22 · A generation's row height ignores the measured cards (always the 96px first-frame guess), so a card that is taller than the guess is drawn over the generation below it — killed by `the-graph-is-moved-by-hand-grows-with-its-cards-and-is-fed-by-the-screen.dom.test.ts` — killed by `the-graph-is-moved-by-hand-grows-with-its-cards-and-is-fed-by-the-screen.dom.test.ts`",
        [
            (TEAM_FOREST_VUE, "tallest = Math.max(tallest, heights.value.get(id) ?? UNMEASURED)", "tallest = Math.max(tallest, UNMEASURED)"),
        ],
    ),
    (
        "M23 · The first view is taken again every time the nodes are initialised, so a conversation arriving in a re-read throws away the zoom a person set (the `viewed` guard dropped) — killed by `the-graph-is-moved-by-hand-grows-with-its-cards-and-is-fed-by-the-screen.dom.test.ts` — killed by `the-graph-is-moved-by-hand-grows-with-its-cards-and-is-fed-by-the-screen.dom.test.ts`",
        [
            (TEAM_FOREST_VUE, "if (viewed || nodes.value.length === 0) return", "if (nodes.value.length === 0) return"),
        ],
    ),
    (
        "M24 · A line is dashed for any open piece the child holds, whoever gave it — the parent-must-be-the-giver check is gone, so a piece another conversation gave dashes the parent's line — killed by `who-called-whom-as-generations.test.ts` and the graph DOM test — killed by `who-called-whom-as-generations.test.ts`, `the-graph-draws-each-agent-as-the-rail-does-and-opens-only-what-opens.dom.test.ts`",
        [
            (FOREST_GRAPH, "task.taskRow?.open === true && task.taskRow.giver === node.parent", "task.taskRow?.open === true"),
        ],
    ),
    (
        "M25 · A running turn says its standing key 'working' again instead of the one state's 'active', so the rail row, the Graph card and the plate word go back to three words for one fact — killed by `agent-state.test.ts` — killed by `agent-state.test.ts`",
        [
            (AGENT_STATE, "  if (standing === 'working') return agentStateWords({ is: 'active' })\n", ""),
        ],
    ),
    (
        "M26 · A conversation the rail does not name draws the poll's plate (the idle it recorded) instead of the faceless one, so a Graph card claims a state nothing told it — killed by the graph DOM test and `who-called-whom-as-generations.test.ts` §3 — killed by `the-graph-draws-each-agent-as-the-rail-does-and-opens-only-what-opens.dom.test.ts`, `who-called-whom-as-generations.test.ts`",
        [
            (THE_FOREST, "const facets: AgentFacets = polled?.facets ?? railed?.facets ?? {}", "const facets: AgentFacets =\n      polled?.facets ??\n      railed?.facets ??\n      plateFor(node, atWork?.get(node.conversation) ?? null, input.waits).facets"),
        ],
    ),
    (
        "M27 · Every Graph card draws its plate at the compact 24px size instead of the rail row's 40px, so the avatars the person asked to be bigger shrink back — killed by the graph DOM test — killed by `the-graph-draws-each-agent-as-the-rail-does-and-opens-only-what-opens.dom.test.ts`",
        [
            (FOREST_CARD_VUE, "<AgentState size=\"row\" v-bind=\"props.node.row.facets\" :label=\"props.node.row.name\" />", "<AgentState size=\"compact\" v-bind=\"props.node.row.facets\" :label=\"props.node.row.name\" />"),
        ],
    ),
    (
        "M28 · The conversation on screen's root-file count is handed to every card, so each conversation in the forest claims the files kept on this one's root — killed by `a-piece-on-the-graph-counts-its-files.dom.test.ts` — killed by `a-piece-on-the-graph-counts-its-files.dom.test.ts`",
        [
            (TEAM_FOREST_VUE, "props.rootFiles?.conversation === node.row.conversation ? props.rootFiles : null", "props.rootFiles"),
        ],
    ),
    (
        "M29 · A piece's file count no longer stops its click, so counting files also presses the card: it selects the agent and raises the right panel — killed by `a-piece-on-the-graph-counts-its-files.dom.test.ts` and `a-graph-card-can-be-pressed.dom.test.ts` — killed by `a-piece-on-the-graph-counts-its-files.dom.test.ts`, `a-graph-card-can-be-pressed.dom.test.ts`",
        [
            (FOREST_CARD_VUE, "@click.stop=\"emit('files', task.taskRow!.piece)\"", "@click=\"emit('files', task.taskRow!.piece)\""),
        ],
    ),
    (
        "M30 · A press on a Graph card selects the agent but never raises the right panel on its card, so the person must open the drawer by hand to see who they chose — killed by the main-panel DOM test — killed by `the-main-panel-shows-the-conversation-or-its-graph.dom.test.ts`, `a-piece-on-the-graph-counts-its-files.dom.test.ts`",
        [
            (CONVERSATION_PANE_VUE, "            showTheBand()\n", ""),
        ],
    ),
    (
        "M31 · A press on the conversation already on screen asks the door for it again, which re-reads a recorded conversation's page and drops the history the person had loaded above it — killed by the main-panel DOM test — killed by `the-main-panel-shows-the-conversation-or-its-graph.dom.test.ts`",
        [
            (CONVERSATION_PANE_VUE, "if (conversation !== props.record.sessionId) goToConversation(conversation)", "goToConversation(conversation)"),
        ],
    ),
    (
        "M32 · The way up is drawn under the agent card (flex order) instead of at the top of the right panel, so it is in the card's clipped end and a person must scroll to find it — killed by the main-panel DOM test — killed by `the-main-panel-shows-the-conversation-or-its-graph.dom.test.ts`",
        [
            (SESSION_PANEL_VUE, ".came-from {\n  display: flex;\n  min-width: 0;\n  max-width: 100%;\n  flex: 0 0 auto;\n", ".came-from {\n  display: flex;\n  min-width: 0;\n  max-width: 100%;\n  flex: 0 0 auto;\n  order: 1;\n"),
        ],
    ),
    (
        "M33 · The follow no longer re-pins when its box is revealed or resized, so a conversation selected from the Graph opens at its first line when the Conversation tab is shown — killed by the main-panel DOM test — killed by `the-main-panel-shows-the-conversation-or-its-graph.dom.test.ts`",
        [
            (USE_STICK_TO_BOTTOM, "resized = new ResizeObserver(toNewest)", "resized = new ResizeObserver(() => undefined)"),
        ],
    ),
    (
        "M34 · RuntimeScreen hands the conversation pane no forest, so the Graph tab of every conversation says 'Nothing has been read about this workspace yet.' for ever — killed by the new source test in `the-graph-is-moved-by-hand-grows-with-its-cards-and-is-fed-by-the-screen.dom.test.ts` — killed by `the-graph-is-moved-by-hand-grows-with-its-cards-and-is-fed-by-the-screen.dom.test.ts`",
        [
            # Source-only reanchor to the lazy forest getter; NOT VERIFIED.
            (RUNTIME_SCREEN_VUE, "            :record=\"active\"\n            :forest=\"readConversationForest\"\n", "            :record=\"active\"\n"),
        ],
    ),
    (
        "M40 · A Files-tab line says *passed up from W1.10.1* even when the SAME conversation kept its own bytes again on the piece above — the condition 'another conversation' is dropped, so a conversation re-keeping its own file reads as a hand-up instead of *same file as on …* — killed by `files-kept.test.ts`, `the-files-tab-lists-every-file-on-the-work.dom.test.ts`",
        [
            (FILES_KEPT, "origin.addedBy?.conversation !== file.addedBy?.conversation", "true"),
        ],
    ),
    (
        "M41 · A give card lists an input its giver added to the piece AFTER the give — the bound on when it was kept is dropped, so the card claims it was handed over with the give — killed by `the-cards-name-the-files-they-hand-over.dom.test.ts`",
        [
            (FILES_KEPT, "(until === undefined || file.keptAt <= until),", "true,"),
        ],
    ),
    (
        "M42 · A reply's file the tree HAS read is drawn as a row AND keeps its 'Open the file kept with this reply' press — the presses are taken from every resource the reply names, not only the unread ones — killed by `the-cards-name-the-files-they-hand-over.dom.test.ts`",
        [
            (OUTGOING_ENTRY_VUE, "v-for=\"(resource, index) in handedBack.unread\"", "v-for=\"(resource, index) in card.resources\""),
        ],
    ),
    (
        "M43 · A later (new) brief on a piece lists only the inputs kept when the piece was first given — the brief's own arrival time is no longer taken into account, so inputs its giver added since vanish from the brief that carries them — killed by `a-cut-brief-opens-to-its-whole-and-a-card-lists-only-its-own-files.dom.test.ts`",
        [
            (RELAYED_ENTRY_VUE, "const until = edge === undefined ? undefined : Math.max(edge.givenAt, props.item.at ?? 0)", "const until = edge === undefined ? undefined : edge.givenAt"),
        ],
    ),
    (
        "M44 · A give whose edge the cast has not read lists every input on its piece, including ones added after the give's result landed — the fallback to the result's own time is dropped — killed by `a-cut-brief-opens-to-its-whole-and-a-card-lists-only-its-own-files.dom.test.ts`",
        [
            (OUTGOING_ENTRY_VUE, "card.value.inputsUntil ?? props.item.result?.at,", "card.value.inputsUntil ?? undefined,"),
        ],
    ),
    (
        "M45 · The viewer's header names a title and who made the file, for which piece and when, from a row that is for ANOTHER file — the check that the row names the file this panel read is dropped — killed by `the-viewer-says-what-a-file-is.dom.test.ts`",
        [
            (CANONICAL_DOCUMENT_VIEWER_VUE, " && file.resourceId === props.result.resourceId", ""),
        ],
    ),
    (
        "M46 · A take-on that was refused, errored or has not finished still reads *BroBot took on* in its heading — the joiner is 'took on' on every state, not only once the piece was taken on — killed by `a-request-taken-on-is-a-card.test.ts`",
        [
            (OUTGOING_CARD, "joiner: state === 'taken-on' ? TOOK_ON_WORD : '',", "joiner: TOOK_ON_WORD,"),
        ],
    ),
    (
        "M47 · A take-on's host row pairs by position alone — it no longer carries its title as a pairing key, so a row that comes ahead of its call lands on an older take-on whose run died, and two taken on in one batch cannot be told apart — killed by `a-request-taken-on-is-a-card.test.ts`",
        [
            (TRANSCRIPT, "      : { key: 'title', ids: [words.taken.title], labelUnknown: false }", "      : null"),
        ],
    ),
    (
        "M48 · The reply that finishes a piece taken on leaves the piece's last status line standing on its take-on card — its summary is no longer the last word — killed by `a-request-taken-on-is-a-card.test.ts`",
        [
            (TRANSCRIPT, "if (taken !== null) delete taken.status", "if (taken !== null) void taken"),
        ],
    ),
    (
        "M49 · A blank status line replaces the standing one on a take-on's card — a line of spaces wipes 'Running test 2 of 5' and the card draws a blank where the status was — killed by `a-cut-brief-opens-to-its-whole-and-a-card-lists-only-its-own-files.dom.test.ts`",
        [
            (TRANSCRIPT, " || event.line.trim() === ''", ""),
        ],
    ),
    (
        "M50 · A give card's cut note keeps the plain 'this much of it is shown here' words even where its brief could be read whole in the helper's conversation — the note no longer says where the rest is — killed by `a-cut-brief-opens-to-its-whole-and-a-card-lists-only-its-own-files.dom.test.ts`",
        [
            (OUTGOING_CARD, "said: readItWholeIn(recipient)", "said: BODY_WAS_CUT"),
        ],
    ),
    (
        "M51 · The cut note's press opens the helper's conversation without naming the piece, so the screen has no label to land on and the reader stays at the conversation's newest line — killed by `a-cut-brief-opens-to-its-whole-and-a-card-lists-only-its-own-files.dom.test.ts`",
        [
            (OUTGOING_ENTRY_VUE, "@click=\"emit('openConversation', card.wholeBrief.conversation, card.wholeBrief.label)\"", "@click=\"emit('openConversation', card.wholeBrief.conversation)\""),
        ],
    ),
    (
        "M52 · A give card's cut note lands on the NEWEST brief of its piece (a later brief) instead of the one the giver gave — the scan for the brief's row runs from the end of the conversation — killed by `a-cut-brief-opens-to-its-whole-and-a-card-lists-only-its-own-files.dom.test.ts`",
        [
            (TRANSCRIPT, "  for (const item of state.items) {\n    if (item.kind === 'relayed' && item.opened?.label === label) return item.id", "  for (const item of [...state.items].reverse()) {\n    if (item.kind === 'relayed' && item.opened?.label === label) return item.id"),
        ],
    ),
    (
        "M53 · goToTheWork looks for the brief even when the door refused to open the conversation — the refusal no longer ends the press, so a brief is searched for (and a 'further back' sentence said) in a conversation that did not open — killed by `a-cut-brief-opens-to-its-whole-and-a-card-lists-only-its-own-files.dom.test.ts`",
        [
            (RUNTIME_SCREEN_VUE, "  if (!(await openConversation(sessionId)) || briefOf === undefined) return\n", "  await openConversation(sessionId)\n  if (briefOf === undefined) return\n"),
        ],
    ),
    (
        "M54 · The follow writes scrollTop where the box is already at its end — the distance-from-the-end check is dropped, so the mount's pin, the resize observer's first call and every quiet signal rewrite the same value and cancel a press's smooth scroll in flight — killed by `a-cut-brief-opens-to-its-whole-and-a-card-lists-only-its-own-files.dom.test.ts`",
        [
            (USE_STICK_TO_BOTTOM, " && node.scrollHeight - node.clientHeight - node.scrollTop >= 1)", ")"),
        ],
    ),
    (
        "M60 · a typed spelling of BroBot's profile is not BroBot's · railSectionOf compares the profile unfolded, so a conversation run as `BroBot` (the spelling a person typed, kept on its record's meta) is filed under the other agents while the host's own rows of that identity are BroBot's — killed by `a-row-is-brobots-only-when-brobot-runs-it.test.ts`, `brobot-and-the-other-agents-fold-apart.dom.test.ts`",
        [
            (RAIL_SECTIONS, "  return foldProfileName(profile) === DEFAULT_PROFILE_ID ? 'brobot' : 'agents'", "  return profile === DEFAULT_PROFILE_ID ? 'brobot' : 'agents'"),
        ],
    ),
    (
        "M61 · a conversation this app ran as nobody is filed under BroBot · a held row's section reads its meta's profileId instead of the profile it RUNS as, so a person's own conversation (whose meta carries BroBot's id only for the type's sake) joins BroBot's section — killed by `brobot-and-the-other-agents-fold-apart.dom.test.ts`",
        [
            (SIDE_RAIL_VUE, "        section: railSectionOf(profileItRunsAs(record.meta)),", "        section: railSectionOf(record.meta?.profileId),"),
        ],
    ),
    (
        "M62 · the list's error line loses its lead · the rail says the bare reason ('the database is locked') with no words about what could not be read — killed by `a-question-is-answered-where-it-is-asked-and-the-words-around-it-are-plain.dom.test.ts`",
        [
            (SIDE_RAIL_VUE, "          Could not read the conversations: {{ listError }}", "          {{ listError }}"),
        ],
    ),
    (
        "M63 · the hand-back sentence is drawn again under the bar · the header draws a row beneath itself only for a conversation that can be handed back, so the page under it moves from one agent to the next — killed by `the-conversation-header.dom.test.ts`",
        [
            # Re-anchored in place, not retired. Source-only, NOT VERIFIED: the line under the bar now
            # opens on the header's counted reason; the defect and its killer are unchanged.
            (SESSION_HEADER_VUE, "  <p v-if=\"livenessDetail && liveness?.state !== 'live'\" class=\"liveness-detail\">", "  <p v-if=\"handBack\" class=\"liveness-detail\" data-cy=\"hand-it-back-line\">\n    This window lets go of it, exactly as closing the window would.\n  </p>\n  <p v-if=\"livenessDetail && liveness?.state !== 'live'\" class=\"liveness-detail\">"),
        ],
    ),
    (
        "M64 · the hand-back sentence moves onto the press as a tooltip · the words nobody understood come back as a title on Hand it back — killed by `the-conversation-header.dom.test.ts`",
        [
            (SESSION_HEADER_VUE, "        data-cy=\"hand-it-back\"\n        @click=\"emit('handBack')\"", "        :title=\"'This window lets go of it, exactly as closing the window would.'\"\n        data-cy=\"hand-it-back\"\n        @click=\"emit('handBack')\""),
        ],
    ),
    (
        "M65 · an open section's chevron stops turning · the fold state is carried by a class and no paint, so open and folded headers look the same — killed by `a-question-is-answered-where-it-is-asked-and-the-words-around-it-are-plain.dom.test.ts`",
        [
            (SIDE_RAIL_VUE, "  transform: rotate(90deg);", "  transform: rotate(0deg);"),
        ],
    ),
    (
        "M66 · the host's words for an answer it did not take never reach the queue card · the press stays 'answer sent' over a question that is still open and dark — killed by `a-question-is-answered-where-it-is-asked-and-the-words-around-it-are-plain.dom.test.ts`",
        [
            # ⚑ **W4.493 · re-anchored in place, not retired** — Source-only, NOT VERIFIED. The Move addition changed the surrounding text; the original defect and killer stay. No plant or table run.
            (PERSONS_QUEUE, "      if (said !== null) presses.set(row.key, { is: 'refused', said })\n    },\n    async move(row, decision) {", "    },\n    async move(row, decision) {"),
        ],
    ),
    (
        "M67 · a part that takes an answer off the list is drawn with no box · allowOther is ignored, so beside options a person can only pick — killed by `a-question-is-answered-where-it-is-asked-and-the-words-around-it-are-plain.dom.test.ts`",
        [
            (QUESTION_CARD, "    typed: part.options.length === 0 || part.allowOther === true,", "    typed: part.options.length === 0,"),
        ],
    ),
    (
        "M68 · a blank is accepted as an answer · answerOf files an empty list for a part nobody answered, so Send is on from the first read and Enter sends nothing-as-an-answer — killed by `a-question-is-answered-where-it-is-asked-and-the-words-around-it-are-plain.dom.test.ts`",
        [
            (QUESTION_CARD, "    if (values.length === 0) return null\n", ""),
        ],
    ),
    (
        "M69 · an answer in the asker's ledger does not settle its card · the user_decision row never marks the asked question answered, so the card goes on offering presses after the person answered — killed by `a-question-is-answered-where-it-is-asked-and-the-words-around-it-are-plain.dom.test.ts`",
        [
            (TRANSCRIPT, "          asked.answered = event.outcome", ""),
        ],
    ),
    (
        "M70 · a limit that has stopped work is said as near · the stopped standing borrows the approaching standing's word, so a wall reads 'is near its weekly limit' — killed by `a-question-is-answered-where-it-is-asked-and-the-words-around-it-are-plain.dom.test.ts`",
        [
            (USAGE_LIMIT, "  stopped: 'has reached',", "  stopped: 'is near',"),
        ],
    ),
    (
        "M71 · several items are said in the singular · the page intro reads '3 items below is waiting on you.' — killed by `a-question-is-answered-where-it-is-asked-and-the-words-around-it-are-plain.dom.test.ts`",
        [
            (HOME_ATTENTION, "${items(onlyYou)} below ${onlyYou === 1 ? 'is' : 'are'} waiting on you.", "${items(onlyYou)} below is waiting on you."),
        ],
    ),
    (
        "M72 · a reader who scrolled up a window that still holds the tail is offered no way back · the Jump to latest pill is gated on the window alone, so it never shows while the newest message is merely out of view — killed by `a-question-is-answered-where-it-is-asked-and-the-words-around-it-are-plain.dom.test.ts`",
        [
            (TRANSCRIPT_VIEW_VUE, "      v-if=\"props.jumpToLatest && (!props.atTail || !endInView)\"", "      v-if=\"props.jumpToLatest && !props.atTail\""),
        ],
    ),
    (
        "M73 · the follow's own scroll pages back · a short page whose newest line is on screen loads older history by itself, so the window can let go of the tail with nobody scrolling — killed by `a-question-is-answered-where-it-is-asked-and-the-words-around-it-are-plain.dom.test.ts`",
        [
            (TRANSCRIPT_VIEW_VUE, "  if (props.loadOlder && !endInView.value) older.onScroll()", "  if (props.loadOlder) older.onScroll()"),
        ],
    ),
    (
        "M74 · the folded words are clamped at forty lines · a long question on the page never folds, so *more* is never offered and the card sets its row's height — killed by `a-question-is-answered-where-it-is-asked-and-the-words-around-it-are-plain.dom.test.ts`",
        [
            (QUESTION_CARD_VUE, "  -webkit-line-clamp: 4;", "  -webkit-line-clamp: 40;"),
        ],
    ),
]
