"""2005 · the main panel's two tabs — the conversation, and its graph (`ui` `90f4a44b`, `6a7b0b46`).

⚑ **Why `2005`**: the landing's tables for the frontend's `ui` batches are `2001`–`2004`; this is the
fifth, landed through the frontend's merge `f389a5ca`.

## What it built

Under the header the main panel has two tabs: the conversation, and a graph of this agent's
conversation with its immediate parent and immediate kids, read from the right panel's own
who-called-whom reading (the parent above, this conversation in the middle, larger and outlined, the
kids side by side on one rail, each with the work it was given under it). Every node but this one opens
its conversation; the tab chosen stays; the conversation is hidden on the Graph tab, never unmounted.

 * `M1`–`M12` — `the-graph-draws-each-agent-as-the-rail-does-and-opens-only-what-opens.dom.test.ts` and the
   frontend's `the-main-panel-shows-the-conversation-or-its-graph.dom.test.ts`.

Designed read-only by a Sonnet 5.5 agent from the commits and today's code; each row verified alone by
the landing agent.

## Verification

- **RED: 12 of 12.** Each row alone by `verify_row.py` with its named killer, on `landing` over
  `5da15d28` (the merge of `6a7b0b46`), none by a syntax, reference or type error. Each killer file ran
  green unmutated first.
- **Landing `f1fa1e2e`…`70aaa954` (merge `08517549`):** `3d53e6af` deleted ConversationGraph and
  GraphNode. `M5`–`M9` and `M11` re-anchored, each RED alone (`M5` and `M11` onto the right panel's
  strip and band, after their retirement was refuted); `M3`, `M4` and `M10` retired by ruling.
"""

CONVERSATION_GRAPH_VUE = "apps/desktop/src/renderer/src/components/ConversationGraph.vue"
CONVERSATION_MAIN_VUE = "apps/desktop/src/renderer/src/components/ConversationMain.vue"
CONVERSATION_PANE_VUE = "apps/desktop/src/renderer/src/components/ConversationPane.vue"
FOREST_CARD_VUE = "apps/desktop/src/renderer/src/components/ForestCard.vue"
SESSION_DRAWER_VUE = "apps/desktop/src/renderer/src/components/SessionDrawer.vue"
WORKING_TOGETHER_VUE = "apps/desktop/src/renderer/src/components/WorkingTogether.vue"

MUTATIONS: list[tuple[str, list[tuple[str, str, str]]]] = [
    (
        "M1 · The conversation is torn down on the Graph tab (`v-if` in place of `v-show`), so its scroll, follow and half-typed message are lost on every switch — killed by `the-main-panel-shows-the-conversation-or-its-graph.dom.test.ts`",
        [
            (CONVERSATION_MAIN_VUE, "<div v-show=\"tab === 'conversation'\" class=\"main-conversation\" data-cy=\"main-conversation\">", "<div v-if=\"tab === 'conversation'\" class=\"main-conversation\" data-cy=\"main-conversation\">"),
        ],
    ),
    (
        "M2 · `showConversation` reports it changed nothing when it switched the tab back, so a row shown from the right panel is never scrolled to once the conversation is drawn again — killed by `the-graph-draws-each-agent-as-the-rail-does-and-opens-only-what-opens.dom.test.ts`",
        [
            (CONVERSATION_MAIN_VUE, "  tab.value = 'conversation'\n  return true\n", "  tab.value = 'conversation'\n  return false\n"),
        ],
    ),
    (
        "M3 · An agent the rail does not name draws its own card's reading instead of the faceless plate while a rail is on screen — killed by `the-graph-draws-each-agent-as-the-rail-does-and-opens-only-what-opens.dom.test.ts`",
        # ⛔ **RETIRED BY RULING (landing ui f1fa1e2e…70aaa954):** The rule was reversed on purpose.
        # 3d53e6af deleted ConversationGraph.vue and GraphNode.vue ("The one-off ConversationGraph and
        # GraphNode are gone") and the Graph tab now draws TeamForest's forest plate, which takes nothing
        # from the rail. The landing's port of the graph file says so itself: "'one the rail does not name
        # draws the faceless plate' (2005 M3) is gone with it: such an agent now draws the forest's
        # recorded plate". The old anchor `cast.railSays.value === null ? card.facets : {}` has no
        # counterpart anywhere in today's code. Its anchor is left stale, so the census records it
        # retired.
        [
            (CONVERSATION_GRAPH_VUE, "cast.railSays.value === null ? card.facets : {}", "card.facets"),
        ],
    ),
    (
        "M4 · Each agent's rail row is looked up by the conversation on screen instead of by its own, so no node draws the plate and word its rail row says — killed by `the-graph-draws-each-agent-as-the-rail-does-and-opens-only-what-opens.dom.test.ts`",
        # ⛔ **RETIRED BY RULING (landing ui f1fa1e2e…70aaa954):** The graph no longer reads the rail at
        # all, by design. 3d53e6af made the Graph tab "the Team page's forest — everyone from BroBot down"
        # and removed the one-off ConversationGraph that did
        # `cast.railSays.value?.get(card.conversation)`. The port's docblock records "a card draws the
        # fold's plate and its STANDING word, and the screen hands the fold the rail's own derivation for
        # what the window holds (ForestViewInput.live) — and for nothing else". The one rail lookup left,
        # `rail.get(agent)` in ConversationPane's `inspecting`, is inside the chosen-agent machinery
        # UI-006 removes, and a held conversation wearing its own record's plate is already 668 M9's rule.
        # Its anchor is left stale, so the census records it retired.
        [
            (CONVERSATION_GRAPH_VUE, "cast.railSays.value?.get(card.conversation)", "cast.railSays.value?.get(props.conversation)"),
        ],
    ),
    (
        "M5 · The agents this conversation only gave work to (never spawned) are not drawn in the graph, and neither is their work — killed by `the-graph-draws-each-agent-as-the-rail-does-and-opens-only-what-opens.dom.test.ts`",
        # ⚑ Landing ui f1fa1e2e…70aaa954 (the card panel and the Vue Flow forest) · re-anchored in place,
        # not retired — ConversationGraph's neighbourhood went with it on purpose (3d53e6af, 'we always
        # show everyone'), but the inclusion survives on the right panel's Sub agents strip under the same
        # expression: an agent this conversation only gave work to still gets a chip. Re-pointed there
        # (2001 M28 only swaps its order); the work half is the forest's (668 M14). A second agent refuted
        # the retirement. Killed by `the-first-picture-of-who-called-whom.dom.test.ts`.
        [
            (WORKING_TOGETHER_VUE, "[...view.value.children, ...view.value.others]", "[...view.value.children]"),
        ],
    ),
    (
        "M6 · The work under a kid names the kid again: each task line draws a plate and the name under the node that already names it — killed by `the-graph-draws-each-agent-as-the-rail-does-and-opens-only-what-opens.dom.test.ts`",
        # ⚑ Landing ui f1fa1e2e…70aaa954 (the card panel and the Vue Flow forest) · re-anchored in place,
        # not retired — The rule survives and the port pins it: "no task line names its holder again". The
        # card's head already names the holder, and the graph file asserts that no
        # `[data-cy="forest-task"]` line contains the card's own name, with `heldBy` making the holder's
        # name spellable. The subject moved from ConversationGraph's `:shows-who` to ForestCard's task
        # line (3d53e6af). The plant adds the holder's name to every task line. Suggested relabel: 'M6 ·
        # the work on a card names its holder again: each task line repeats the name the card's head
        # already carries'. Killed by
        # `the-graph-draws-each-agent-as-the-rail-does-and-opens-only-what-opens.dom.test.ts`.
        [
            (FOREST_CARD_VUE, "<span class=\"said\" data-cy=\"forest-task-said\">{{ task.taskRow?.said }}</span>", "<span class=\"holder\" data-cy=\"forest-task-holder\">{{ props.node.row.name }}</span>\n          <span class=\"said\" data-cy=\"forest-task-said\">{{ task.taskRow?.said }}</span>"),
        ],
    ),
    (
        "M7 · A window with no screen above it still draws every node and task line as a press that goes nowhere (`canOpen` always true) — killed by `the-graph-draws-each-agent-as-the-rail-does-and-opens-only-what-opens.dom.test.ts`",
        # ⚑ Landing ui f1fa1e2e…70aaa954 (the card panel and the Vue Flow forest) · re-anchored in place,
        # not retired — The rule survives in the `118` gate the drawer hands its card and band: no screen
        # above means no press that goes nowhere. The graph file keeps it as 'a window with no screen
        # above it offers no Open conversation on a chosen card' and the first-picture file as 'with
        # nothing able to act, no press is drawn at all'. The old subject (ConversationGraph's `canOpen`)
        # went in 3d53e6af, and a node's press now always shows the card (70aaa954), so only the drawer's
        # gate is left. The anchor is SessionDrawer's `cast.goTo.value !== null`, outside the chosen-agent
        # machinery and not touched by UI-006. Suggested relabel: 'M7 · a window with no screen above it
        # still offers presses that go nowhere (the drawer is told it can always open a conversation)'.
        # Killed by `the-graph-draws-each-agent-as-the-rail-does-and-opens-only-what-opens.dom.test.ts`,
        # `the-first-picture-of-who-called-whom.dom.test.ts`.
        [
            (SESSION_DRAWER_VUE, ":can-open-conversation=\"cast.goTo.value !== null\"", ":can-open-conversation=\"true\""),
        ],
    ),
    (
        "M8 · Every node's dot is coloured from a faceless plate, so a working agent's dot reads as the unknown grey — killed by `the-graph-draws-each-agent-as-the-rail-does-and-opens-only-what-opens.dom.test.ts`",
        # ⚑ Landing ui f1fa1e2e…70aaa954 (the card panel and the Vue Flow forest) · re-anchored in place,
        # not retired — GraphNode's own dot (`priorityDotToken(props.facets)`) is gone, but the rule
        # behind it survives on ForestCard's plate: every card is drawn from its forest row's facets. The
        # graph file's first test pins this: Ana's `data-doing` must be 'working' with a face, Rui's
        # 'unknown' faceless, Arjun's 'idle'. The plant draws every card's plate from a faceless reading,
        # so no working agent can show its state. Suggested relabel: 'M8 · every card's plate is drawn
        # from a faceless reading, so a working agent's plate says unknown'. Killed by
        # `the-graph-draws-each-agent-as-the-rail-does-and-opens-only-what-opens.dom.test.ts`.
        # ⚑ Landing D-027, the ui stretch to 3ef68f7f and D-038 · re-anchored in place, not retired —
        # 2d0fa59f (UI-004) replaced ForestCard's three bound facets (`:doing=…`) with the whole plate,
        # `v-bind="props.node.row.facets"`, so the anchor went dark; the rule (every card's plate is its
        # rail row's facets) survives. The plant draws every card's plate from a faceless reading
        # (AgentState treats an absent `doing` as unknown, so nothing throws). Killed by
        # `the-graph-draws-each-agent-as-the-rail-does-and-opens-only-what-opens.dom.test.ts`.
        [
            (FOREST_CARD_VUE, "v-bind=\"props.node.row.facets\"", "v-bind=\"{}\""),
        ],
    ),
    (
        "M9 · The conversation on screen is outlined in the ordinary hairline instead of the accent, so nothing marks which node is this one — killed by `the-graph-draws-each-agent-as-the-rail-does-and-opens-only-what-opens.dom.test.ts`",
        # ⚑ Landing ui f1fa1e2e…70aaa954 (the card panel and the Vue Flow forest) · re-anchored in place,
        # not retired — The rule survives and the port measures it as painted: 'this conversation is the
        # one outlined — in the accent, where every other card wears the hairline'. The subject moved from
        # GraphNode's `.node.here` to ForestCard's `.card.current` (3d53e6af, with 8e6f0b47 fixing a stray
        # rule). The plant is a straight CSS swap of the accent for the hairline on the current card.
        # Suggested relabel: '…so nothing marks which card is this one'. Killed by
        # `the-graph-draws-each-agent-as-the-rail-does-and-opens-only-what-opens.dom.test.ts`.
        [
            (FOREST_CARD_VUE, ".card.current {\n  border-color: var(--accent);", ".card.current {\n  border-color: var(--line);"),
        ],
    ),
    (
        "M10 · The main panel is handed the plate but not the conversation's one state, so the graph's word for this conversation drops the command the drawer names — killed by `the-graph-draws-each-agent-as-the-rail-does-and-opens-only-what-opens.dom.test.ts`",
        # ⛔ **RETIRED BY RULING (landing ui f1fa1e2e…70aaa954):** The main panel no longer receives a
        # plate or a state. The anchor (`:facets="agentFacets"` + `:agent-state="agentState"` on the main
        # panel) is gone: ConversationMain now gets only `:conversation`, `:forest` and `:selected`.
        # 3d53e6af made the Graph tab the Team page's forest, so the word on a card is the fold's STANDING
        # word. The port's docblock: "the word is the forest's STANDING (STANDING_LABEL, the Team page's),
        # not the rail's: since 3d53e6af a card says the fold's word, and the chosen card says the
        # rail's". The remaining `:agent-state="agentState"` in the pane belongs to SessionDrawer, a
        # different subject. Its anchor is left stale, so the census records it retired.
        [
            (CONVERSATION_PANE_VUE, "        :facets=\"agentFacets\"\n        :agent-state=\"agentState\"\n      >\n", "        :facets=\"agentFacets\"\n      >\n"),
        ],
    ),
    (
        "M11 · A read that did not answer draws the graph with no 'This may not be current' line — killed by `the-graph-draws-each-agent-as-the-rail-does-and-opens-only-what-opens.dom.test.ts`",
        # The right-panel band still discloses that the read may not be current. Mutate that
        # surviving line, not the graph tab, and retain the DOM test that checks the band.
        [
            (WORKING_TOGETHER_VUE, "<p v-if=\"view.refusal\" class=\"gap\" data-cy=\"cast-refusal\">", "<p v-if=\"view.refusal && false\" class=\"gap\" data-cy=\"cast-refusal\">"),
        ],
    ),
    (
        "M12 · The main panel is re-created for each conversation (keyed by it), so the chosen Graph tab is forgotten when a press walks to another conversation — killed by `the-graph-draws-each-agent-as-the-rail-does-and-opens-only-what-opens.dom.test.ts`",
        [
            (CONVERSATION_PANE_VUE, "        ref=\"main\"\n        class=\"pane-main\"\n", "        ref=\"main\"\n        :key=\"props.record.sessionId\"\n        class=\"pane-main\"\n"),
        ],
    ),
]
