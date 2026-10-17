"""668 · *Who called whom*, drawn as generations — and every node opens.

⚑ **the person, 2026-09-23:** *"can we have it display vertically? a row with all brobots, next row with
all agents created by brobot, then the agents creted by those agents etc.. in a graph."* — and
*"when a conversation is closed and in this teams screen I click on an agent, it does not show me the
conversation. nothing happens. when I open the conversation manually, and go back to that page: i
see dotted lines around the agent. then I navigate away and back.. and I can see the correct
status."*

## 🔴 What has to be killable

 * `M1`–`M8` 🔴 **every node opens**: the dead click back (a closed node presses *open*); a press
   another window's node has no act for; the page routing a closed node to *open*; the page's old
   one-verb routing back; a node with no gesture drawn as a button; the screen's handler unbound; a
   refusal returned silently; the library's `readable` ignored.
 * `M9`–`M12` 🔴 **the dotted ring**: the live plate ignored by the fold; the screen handing none;
   the forest not re-read when conversations or work move.
 * `M13`–`M20` ⚑ **the generations**: a parent drawn at its first slot rather than its centre; tasks
   drawn on the root; children drawn on their parent's row; nodes packed left by grid auto-place; the
   graph scrolling the PAGE; every task shown behind a *2 more*; siblings reversed by the walk; the
   line drawn from the child to the parent.
 * `M21`, `M22` ⚠️ the closed press promising a reopen it may not do; a task's project chip repeated
   under a node already naming it.
 * `M23`–`M27` 🔴 **what `668`'s review found in the closed press** (`lib/closed-press.ts`): a held
   conversation reopened again; a double press starting two reopens; a person pulled back after
   moving; a failed reopen unsaid; an empty refusal said as an empty notice. `M28` the spawn reason
   gone from the card; `M29` the three OLDEST tasks shown; `M30` the screen telling the press it
   holds nothing.

## ⛔ What this table cannot reach

 * ⚠️ **No row for the card's paint** (`--line`, `--panel`) — shared tokens; `M17` breaks the one
   layout property this dispatch's claims rest on instead.
 * ⚠️ **No row for the Team tick** (`ROSTER_EVERY_MS`) — unchanged by `668`.

## ⚑ WRITTEN, not run as a table

⛔ **Writing rows is routine, RUNNING a table is rare and deliberate.** Each row was verified RED
individually — one row, its killer file, restore-from-bytes — in an isolated worktree, never the
tree the person's dev server watches, and no `mutations.txt` exists.
"""

from __future__ import annotations

LIB = "apps/desktop/src/renderer/src/lib"
COMPONENTS = "apps/desktop/src/renderer/src/components"
RUNTIMESCREEN = "apps/desktop/src/renderer/src/components/RuntimeScreen.vue"
TEAMFOREST = "apps/desktop/src/renderer/src/components/TeamForest.vue"
FORESTCARD = "apps/desktop/src/renderer/src/components/ForestCard.vue"
THE_FOREST = "apps/desktop/src/renderer/src/lib/the-forest.ts"
TAKING_OVER = "apps/desktop/src/renderer/src/lib/taking-over.ts"

FOLD = f"{LIB}/the-forest.ts"
GRAPH = f"{LIB}/forest-graph.ts"
CLOSED = f"{LIB}/closed-threads.ts"
PRESS = f"{LIB}/closed-press.ts"
FOREST = f"{COMPONENTS}/TeamForest.vue"
TEAM = f"{COMPONENTS}/TeamWorkspace.vue"
SCREEN = f"{COMPONENTS}/RuntimeScreen.vue"

MUTATIONS: list[tuple[str, list[tuple[str, str, str]]]] = [
    (
        "M1 · 🔴 **THE DEAD CLICK, put back** · a closed conversation's node presses *open*, and the "
        "screen can only open what this window holds — *\"nothing happens\"*",
        # ⚑ Landing D-017b (3af91dcb) · re-anchored in place, not retired — The rule survives
        # D-017b: every node presses the one open, and a conversation this window does not feed must
        # be looked at, not treated as unopenable (the old FOLD `recorded`/`open` gesture is gone,
        # but the same dead click now lives in `RuntimeScreen.openConversation`). The plant makes
        # the screen open only what it already holds, so a closed or other-window node opens
        # nothing.
        [
            (RUNTIMESCREEN, 'store.isLive(sessionId) ? sessionId : await store.look(sessionId)', 'store.isLive(sessionId) ? sessionId : null'),
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-017b, 3af91dcb):** D-017b (3af91dcb, "a conversation is a
        # conversation, on screen too") deleted `forestGestureOf`/`ForestGesture` and the
        # `open-in-another-window` to gesture map, so there is no press-with-no-act to plant. The
        # card says one press, "Open the conversation", for every node, and another window's
        # conversation is refused `held-elsewhere` in words when sent to, not by a missing verb. Its
        # anchor is left stale, so the census records it retired.
        "M2 · ⛔ **a press with no act** · another window's node offers *open*, which this app has no "
        "verb for",
        [(FOLD, "    case 'open-in-another-window':\n      return null\n",
          "    case 'open-in-another-window':\n      return 'open'\n")],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-017b, 3af91dcb):** The closed node's `openClosed` emit
        # that this row flipped is gone: `TeamWorkspace` now only emits `openConversation`, and
        # `pressForest` and `pressRow` both do exactly that. The row's premise (a gesture the
        # dispatch can drop onto the wrong act) was removed with the gestures, and
        # `who-called-whom-as-generations.test.ts` now pins that the old route no longer exists
        # (`not.toMatch(/@open-closed=/)`). Its anchor is left stale, so the census records it
        # retired.
        "M3 · 🔴 **the page routes a closed node to open** · the gesture is right and the dispatch drops "
        "it on the one act that cannot serve it",
        # ⚑ ANCHOR CORRECTED IN PLACE BY 725 — a node the quit left open is raised as `openKeptOpen`
        # first; the closed node's `openClosed` this row flips is unchanged.
        [(TEAM, "      return emit('openClosed', row.conversation)\n",
          "      return emit('openConversation', row.conversation)\n")],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-016a, bd70d693):** The defect ('every node raises open,
        # whatever its gesture') is now the design: commit 3af91dcb (D-017b) says "one press, 'Open
        # the conversation'", and pressForest's comment reads "one act: the screen opens it in its
        # full view, whatever it is doing". The current pressForest already emits openConversation
        # for every row, so the plant is equivalent to the code and can never go red. Its anchor is
        # left stale, so the census records it retired.
        "M4 · 🔴 **the one-verb routing, back** · every node raises *open*, whatever its gesture — "
        "`641`'s wiring",
        [(TEAM, '        @press="pressForest"\n',
          "        @press=\"(row) => emit('openConversation', row.conversation)\"\n")],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-017b, 3af91dcb):** D-017b makes `.head` one unconditional
        # `<button data-cy="forest-open">` on every node, so "a node with no gesture is drawn as a
        # button anyway" is now the design. The `:is="...gesture ? 'button' : 'div'"` anchor and the
        # gesture field no longer exist, and the dom §2 test asserts that every node presses open.
        # Its anchor is left stale, so the census records it retired.
        "M5 · ⛔ **a control that cannot act** · a node with no gesture is drawn as a button anyway",
        [(FOREST, ":is=\"node.row.conversationRow?.gesture ? 'button' : 'div'\"",
          ":is=\"'button'\"")],
    ),
    (
        "M6 · 🔴 **the screen hears nothing** · the page raises `openClosed` and no handler is bound — "
        "the dead click one hop up",
        # ⚑ Landing D-017b (3af91dcb) · re-anchored in place, not retired — The rule survives one
        # hop up: the page emits `openConversation` and the screen must bind a handler, or the click
        # is dead (the `@open-closed` binding this row removed no longer exists). Unbinding
        # `@open-conversation="select"` on `<TeamWorkspace>` plants the label's defect, and nothing
        # throws because an emit with no listener is silent.
        [
            (RUNTIMESCREEN, '          @open-conversation="select"\n', ''),
        ],
    ),
    (
        "M7 · ⛔ **a refusal returned in silence** · a conversation that can neither reopen nor be read "
        "says nothing — `ProjectWorkspace`'s *\"must not fall silently into nothing happens\"*",
        # ⚑ Landing D-017b (3af91dcb) · re-anchored in place, not retired — The rule survives: a
        # conversation the host will not hand over must say so and must not fall silently into
        # nothing happening. The say now lives in `openConversation` (`say(store.lookError.value ??
        # ...)`), because the closed press and its `doors.say` were deleted with `closed-press.ts`.
        # Removing that line returns `false` in silence.
        # ⚑ Landing D-027, the ui stretch to 3ef68f7f and D-038 · re-anchored in place, not retired
        # — The rule survives: UI-007 (1603fe2e) routes the screen's one open door's refusal through
        # `refusedToOpen(store.lookError.value)` (the host's words, or 'That conversation could not
        # be opened.'), still inside `openConversation` where the previous
        # `say(store.lookError.value ?? …)` was. Removing the say leaves a refusal returned in
        # silence, which is the label's defect. Both killers read the door's source, which is the
        # only way to reach it because RuntimeScreen is mounted by no test. Killed by
        # `a-refusal-with-no-words-is-said-in-words.test.ts`,
        # `compact-now-and-what-main-now-carries.render.test.ts`.
        [
            (RUNTIMESCREEN, '  if (opened === null) {\n    say(refusedToOpen(store.lookError.value))\n    return false\n  }', '  if (opened === null) {\n    return false\n  }'),
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-017b, 3af91dcb):** The library's `readable` flag and the
        # `hasTranscript` input to the closed press (`closed-press.ts`, `closed-threads.ts`) were
        # deleted by D-017b. The card removes the split ("no Reopen / Take it over / Read the
        # recording presses"), and every conversation has one full view opened by `look`, so no
        # state remains in which a recording offers nothing. Its anchor is left stale, so the census
        # records it retired.
        "M8 · ⚠️ **the library's `readable` ignored** · a conversation with a recording and no reopen "
        "offers nothing at all",
        [(CLOSED, "hasTranscript: entry.readable })", "hasTranscript: false })")],
    ),
    (
        "M9 · 🔴 **THE DOTTED RING, put back** · the fold ignores the window's own record and draws the "
        "poll's no-DOING face on a conversation the person just reopened",
        # When the rail supplies a live row, its plate outranks the polled fallback. Force the
        # fallback instead to expose a reopened node incorrectly retaining the no-work dashed ring.
        # The graph-state tests exercise that sequence.
        [
            (THE_FOREST, '      input.said === undefined || input.said === null\n', '      true\n'),
        ],
    ),
    (
        "M10 · 🔴 **the screen hands no live plate** · the fold would use one; nothing gives it one",
        # ⚑ Landing D-027, the ui stretch to 3ef68f7f and D-038 · re-anchored in place, not retired
        # — The rule survives in UI-004's form: 79a82f05 replaced the screen's `live: new
        # Map(recordFacets…)` hand with `said: cast.railSays.value` ('668's live plate for a held
        # conversation is the rail's own derivation of it'), so the screen must still hand the fold
        # the plates for what it holds, now the rail rows. The plant hands none (`said: null`, which
        # the fold reads as no rail on screen), so the poll's dashed face comes back. RuntimeScreen
        # is mounted by no test, so the killer is the source-read of foldTheForest in §4. Killed by
        # `who-called-whom-as-generations.test.ts`.
        [
            (RUNTIMESCREEN, '    said: cast.railSays.value,\n', '    said: null,\n'),
        ],
    ),
    (
        "M11 · ⚠️ **the forest not re-read when conversations move** · *\"then I navigate away and "
        "back.. and I can see the correct status\"*",
        [(SCREEN,
          "      // Refresh the Team forest when a conversation opens, ends or is spawned, rather than waiting for arrival or its periodic tick. `readWhoIsWorking` runs only while the page is visible.\n      void readWhoIsWorking()\n",
          "      // Refresh the Team forest when a conversation opens, ends or is spawned, rather than waiting for arrival or its periodic tick. `readWhoIsWorking` runs only while the page is visible.\n")],
    ),
    (
        "M12 · ⚠️ **the forest not re-read when work moves** · a task's line keeps its old word for the "
        "rest of the tick",
        [(SCREEN,
          "      // 🔴 **668 · the forest draws every task too** — the same reason as the `conversations` arm.\n"
          "      void readWhoIsWorking()\n",
          "      // 🔴 **668 · the forest draws every task too** — the same reason as the `conversations` arm.\n")],
    ),
    (
        "M13 · ⚑ **a parent at its first slot** · the second BroBot sits over Ana instead of over its "
        "whole family",
        [(GRAPH, "    node.centre = left + node.span / 2\n", "    node.centre = left + 0.5\n")],
    ),
    (
        "M14 · 🔴 **tasks drawn on the root** · every task in a family lands on its eldest ancestor's card",
        [(GRAPH, "      last?.tasks.push(row)\n", "      ;(open[0] ?? last)?.tasks.push(row)\n")],
    ),
    (
        "M15 · 🔴 **children on their parent's row** · no generation below the first — the layout "
        "the person asked for, flattened",
        [(GRAPH, "      generation: parent === null ? 0 : parent.generation + 1,\n",
          "      generation: parent === null ? 0 : parent.generation,\n")],
    ),
    (
        "M16 · ⚑ **nodes packed left** · the grid places each card in the next free column, so no child "
        "sits under its parent",
        # ⚑ Landing ui f1fa1e2e…70aaa954 (the card panel and the Vue Flow forest) · re-anchored in
        # place, not retired — 2053fd25 replaced the CSS-grid placement (`columnOf`) with Vue Flow,
        # but kept the rule: "The placement is still forest-graph.ts's tidy tree (generations top to
        # bottom, each parent centred over its children)". The one line that now carries it is the
        # node's `position.x`, derived from `node.centre`. The plant sets it to the node's index in
        # its generation, which is the next-free-column (packed-left) layout the label names, so no
        # child sits under its parent. Killed by `who-called-whom-as-generations.dom.test.ts`.
        [
            (TEAMFOREST, 'x: node.centre * SLOT - CARD / 2', 'x: (generation.indexOf(node) + 0.5) * SLOT - CARD / 2'),
        ],
    ),
    (
        "M17 · ⛔ **the PAGE scrolls sideways** · a wide family overflows the Team page instead of its "
        "own box",
        # ⚑ Landing ui f1fa1e2e…70aaa954 (the card panel and the Vue Flow forest) · re-anchored in
        # place, not retired — The `max-width: 100%; overflow-x: auto` box is gone (2053fd25: "a
        # wide family is panned inside its box"), but the rule survives and is still tested: the
        # page never scrolls sideways when a family is wider than the box. Containment now comes
        # from Vue Flow's own stylesheet, which clips twice (`.vue-flow` overflow:hidden,
        # `.vue-flow__viewport` overflow:clip). The plant inserts a scoped override that unclips
        # both, so the drawing spills out of its own box. Killed by
        # `who-called-whom-as-generations.dom.test.ts`.
        [
            (TEAMFOREST, '.flow.fill {\n  height: auto;', '.flow :deep(.vue-flow),\n.flow :deep(.vue-flow__viewport) {\n  overflow: visible;\n}\n\n.flow.fill {\n  height: auto;'),
        ],
    ),
    (
        "M18 · ⚠️ **every task shown behind a *2 earlier*** · the press says some are hidden and none are",
        # ⚑ Landing ui f1fa1e2e…70aaa954 (the card panel and the Vue Flow forest) · re-anchored in
        # place, not retired — The rule survives and the anchor text is unchanged; 2053fd25 only
        # moved the card into ForestCard.vue, where `shown` is `props.opened ? props.node.tasks :
        # props.node.tasks.slice(-TASKS_SHOWN)`. The plant shows every task while the `N earlier`
        # press still renders (its `v-if` is `tasks.length > TASKS_SHOWN`), so the press says some
        # are hidden and none are. Only the file changes, from TeamForest.vue to ForestCard.vue.
        # Killed by `who-called-whom-as-generations.dom.test.ts`.
        [
            (FORESTCARD, 'node.tasks.slice(-TASKS_SHOWN)', 'node.tasks'),
        ],
    ),
    (
        "M19 · ⚠️ **siblings reversed** · the walk pushes children first-first, so a family is drawn in "
        "the opposite order to the one it was started in",
        [(FOLD, "    for (let i = kin.length - 1; i >= 0; i -= 1) pending.push([kin[i]!, depth + 1])\n",
          "    for (let i = 0; i < kin.length; i += 1) pending.push([kin[i]!, depth + 1])\n")],
    ),
    (
        "M20 · ⚑ **the line drawn backwards** · it leaves from the child's column and arrives at the "
        "parent's",
        # ⚑ Landing ui f1fa1e2e…70aaa954 (the card panel and the Vue Flow forest) · re-anchored in
        # place, not retired — The hand-drawn SVG path (`M from 0 V … H to V BAND`) was replaced by
        # Vue Flow edges (2053fd25: "lines from each parent to each child"), and the rule that the
        # line runs parent to child is now pinned by the edge's measured ends. The line's direction
        # is now the `source`/`target` pair in `edges`. Swapping them draws the line from the
        # child's bottom to the parent's top, and both ends are on real handles, so the edge still
        # renders, backwards. Killed by `who-called-whom-as-generations.dom.test.ts`,
        # `the-graph-draws-each-agent-as-the-rail-does-and-opens-only-what-opens.dom.test.ts`.
        [
            (TEAMFOREST, 'source: node.parent,\n              target: node.row.conversation,', 'source: node.row.conversation,\n              target: node.parent,'),
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-017b, 3af91dcb):** The label is a title promising "Open
        # the conversation" on a closed press that may not reopen, and D-017b removed the promise's
        # counterpart. The single press is "Open the conversation" for every conversation, and the
        # card says "No sentence says whether a process runs", so there is no reopen to promise. The
        # `SHOW_THIS_CONVERSATION` title anchor is gone too. Its anchor is left stale, so the census
        # records it retired.
        "M21 · ⚠️ **a closed press that promises a reopen** · the title says *Open the conversation* "
        "on a node that may be read instead",
        [(FOLD, "      return SHOW_THIS_CONVERSATION\n", "      return openingAction(true)\n")],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-016a, bd70d693):** The chip was removed on purpose: the
        # D-016a diff deletes the whole 'A task in ANOTHER project than its holder says which'
        # button (data-cy=forest-project, emit openProject) from TeamForest.vue, and the file has 0
        # hits for forest-project or projectSlug. bd70d693: "Projects stop being something a person
        # or a model meets"; a task now reads "Task #N". Its anchor is left stale, so the census
        # records it retired.
        "M22 · ⚑ **a project chip on every task** · a task in its holder's own project repeats the "
        "chip its card already carries",
        [(FOREST, 'v-if="task.projectSlug && task.projectSlug !== node.row.projectSlug"',
          'v-if="task.projectSlug"')],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-017b, 3af91dcb):** The library route and the
        # `doors.holds` branch this row deleted no longer exist, so a held conversation can no
        # longer be sent to a refused reopen. D-017b makes asking the host about it the design:
        # `look` "attaches if held here", and `store.look` returns early on `isLive`. A plant on
        # `openConversation`'s isLive ternary would be behaviour-neutral (only a text pin), so it
        # does not carry this row's label. Its anchor is left stale, so the census records it
        # retired.
        "M23 · 🔴 **a held conversation reopened again** · the forest's gesture is older than the press, "
        "and a conversation already open is sent to the library and a reopen the host refuses",
        [(PRESS, "    if (doors.holds(sessionId)) {\n      doors.open(sessionId)\n      return\n    }\n", "")],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-017b, 3af91dcb):** The reopen this row raced (`resume`
        # with its `inFlight` set in `closed-press.ts`) was deleted, and nothing in D-017b resumes
        # on a press: the card says `look` "starts nothing" and only a sent message continues via
        # `startAndSend`. Two presses now both `look`, which `store.look` brackets with a `handover`
        # counter so both resolve to the same record, so the label's defect (two reopens racing
        # records) cannot occur. Its anchor is left stale, so the census records it retired.
        "M24 · 🔴 **the double click, back** · two reopens of one conversation race each other's "
        "records and both report failure over a session the host resumed",
        [(PRESS, "    if (inFlight.has(sessionId)) return\n", "")],
    ),
    (
        "M25 · ⚠️ **a person pulled back** · the answer lands on a screen they have left",
        # ⚑ Landing D-017b (3af91dcb) · re-anchored in place, not retired — The rule survives and is
        # now carried by `openConversation`: `from = view()` is captured before the await and
        # `showConversation(opened, from)` shows the answer only if the person has not moved (the
        # old `wanted()` guard went with the closed press). The plant writes `activeId` and `place`
        # directly, so the answer lands on whatever screen the person moved to while the look was in
        # flight.
        [
            (RUNTIMESCREEN, '  showConversation(opened, from)\n  return place.value === null && activeId.value === opened\n', '  activeId.value = opened\n  place.value = null\n  return place.value === null && activeId.value === opened\n'),
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-017b, 3af91dcb):** The label is "the rail marks its own
        # row, and the Team page is silent", and D-017b removed the rail's per-row reopen failure
        # state (no `resumeError`, `reopenError` or `pressClosed` remains in `SideRail.vue`). What
        # is left is the single `say(store.lookError...)` in `openConversation`, which is exactly
        # what re-anchored M7 already kills, so a second row would duplicate it. Its anchor is left
        # stale, so the census records it retired.
        "M26 · ⛔ **a failed reopen, unsaid** · the rail marks its own row, and the Team page is silent",
        [(PRESS, "            if (said !== null) doors.say(said)\n", "")],
    ),
    (
        # ⚠️ **RETIRED BY FILE GONE, and an OPEN FINDING (landing D-017b, 3af91dcb):** the anchor's
        # file `closed-press.ts` is gone, BUT the rule is not: an empty refusal must never be said
        # as an empty notice, and D-017b's successor at `RuntimeScreen.vue` (`store.lookError.value
        # ?? 'That conversation could not be opened.'`) uses `??`, which keeps `''`. Raised in L-001
        # as an OPEN FINDING (change `??` to `||`); re-anchor there once DEV fixes it.
        "M27 · ⚠️ **an empty refusal said as an empty notice** · `??` keeps `''`, and the notice says "
        "nothing",
        # ⚑ Landing D-027, the ui stretch to 3ef68f7f and D-038 · re-anchored in place, not retired
        # — Retired as file-gone when D-017b deleted closed-press.ts, and recorded then as an open
        # finding: its successor kept `''` with `??`. UI-007 (1603fe2e) fixed it on purpose, 'a
        # conversation that could not be opened always says so in words', in `refusedToOpen`, so the
        # row's subject is back and it is re-anchored there. Killed by
        # `a-refusal-with-no-words-is-said-in-words.test.ts`.
        [
            (TAKING_OVER, '  return reason?.trim() || COULD_NOT_BE_OPENED', '  return reason ?? COULD_NOT_BE_OPENED'),
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-016b, 5e931be8, the tree):** The subject was removed on
        # purpose: the spawn reason went with spawn_agent. TeamForest.vue's own docblock reads: 'Why
        # it was started was the card's `title` until D-016 took the spawn reason away with
        # `spawn_agent`: a conversation now starts with the piece it was given, which is on it.' The
        # card's title is now just OPEN_THE_CONVERSATION, and spawnReason no longer exists anywhere
        # in apps/desktop/src. Its anchor is left stale, so the census records it retired.
        "M28 · 🔴 **why it was started, gone** · the card's press says what it does and nothing says why "
        "the conversation exists — `641`'s row carried it",
        # ⚑ Landing D-017b (3af91dcb) · re-anchored in place, not retired — The rule survives: a
        # card's one press must still carry why the conversation was started, as `641`'s row did.
        # The reason is now inline in `TeamForest`'s `:title`
        # (`node.row.conversationRow?.spawnReason ?? OPEN_THE_CONVERSATION`), so the plant drops the
        # spawn reason and leaves the press saying only what it does.
        [
            (TEAMFOREST, 'node.row.conversationRow?.spawnReason ?? OPEN_THE_CONVERSATION', 'OPEN_THE_CONVERSATION'),
        ],
    ),
    (
        "M29 · ⚠️ **the three OLDEST tasks** · the one an agent is on now is the one hidden",
        # ⚑ Landing ui f1fa1e2e…70aaa954 (the card panel and the Vue Flow forest) · re-anchored in
        # place, not retired — The rule survives (the card shows the three newest tasks, because the
        # fold lists oldest first and the one an agent is on is the last), and the anchor text is
        # unchanged. 2053fd25 moved it to ForestCard.vue's `shown` computed, so only the file
        # changes. The plant shows the first three, so the task the agent is on now is the one
        # hidden. Killed by `who-called-whom-as-generations.dom.test.ts`.
        [
            (FORESTCARD, 'node.tasks.slice(-TASKS_SHOWN)', 'node.tasks.slice(0, TASKS_SHOWN)'),
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-017b, 3af91dcb):** The `holds` door the screen handed to
        # the closed press (`holds: (sessionId) => store.get(sessionId) !== null`) was deleted along
        # with `closed-press.ts`, so there is no press that can be told the screen holds nothing.
        # D-017b's single `look` press decides attach, claim or ledger in the host, and it answers
        # the isLive case before asking. Its anchor is left stale, so the census records it retired.
        "M30 · ⚠️ **the screen says it holds nothing** · every closed press goes to the library, even "
        "for a conversation already open here",
        [(SCREEN, "  holds: (sessionId) => store.get(sessionId) !== null,\n", "  holds: () => false,\n")],
    ),
]
