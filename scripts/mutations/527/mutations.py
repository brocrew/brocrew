#!/usr/bin/env python3
"""527's mutation table — each row is THE DEFECT, put back verbatim (131).

⛔ **`HO-050` §1.1 ruled the subject question, and it ruled it as a TEST a person can apply:**
*"Close the conversation. What goes with it was the session's; what remains was the agent's."*
The rails it comes with are two sentences:

> ⛔ **"The index may list both. The surfaces may not mix them."**
> ⛔ **"What must not happen is one sheet headed with a fact from each."**

⚠️ **`SessionInfo` had grown straight through both** — one `<dl>` with the conversation's working
directory four rows above the agent's memory — and `525` measured what that cost: 2.1 screens of
8.5 px prose in a 368 px column, with four `DocumentBody` mounts and a 253-character paragraph
inside the index.

## ⚑ What this dispatch changed, because the rows are about the shape

 1. ⚑ **`SessionInstructions` became independently mountable** — `525`'s named refactor cost. It
    emitted `<dt>`/`<dd>` fragments for somebody else's `<dl>`, laid out by a grid it did not
    declare and sized by a `font-size` it did not choose. It has a root, a face and a scale now.
 2. ⚑ **The Info tab became an INDEX whose grouping teaches §0's table** — two headed groups, each
    carrying `data-subject` and a second line stating its own lifetime, because *"the grouping in
    the index is where the distinction gets taught."*
 3. ⚑ **The agent's side opens WIDE** — `AgentInstructionsSheet`, raised by `ConversationPane` on
    the app's own `OverlayHost`, at `min(780px, 100% - 2 × --lane-clear)` = the mock's 760 px at
    1200. ⛔ **Not a screen, a route or a `place`**: the pane, the transcript and the drawer stay
    mounted underneath, which is the PO's *"an index entry that opens wide satisfies both."*
 4. ⚑ **The sizes `526` F9 left named** — measured before anything was touched, **65 of 65 visible
    text elements on the shut Info tab were below the 9 px floor**. ⛔ Not one token VALUE moved.

## ⛔ What kills each row

Unless a row says otherwise its killer is
`apps/desktop/test/dom/the-thread-a-person-does-not-leave.dom.test.ts`, which mounts the real
drawer and the real pane in Chromium, walks every element that carries a fact, and asks the ENGINE
which subject HEADS it and what size it came out at — never the stylesheet's source. (`389`: six
`SessionShelf` cells, one `toContain`, and the mutation on the fifth survived on its three
neighbours.)

 * `M1`-`M5`   🔴 **the RULING, reversed one fact at a time** — a session fact filed under the pile
                that survives the conversation and the reverse, plus the surface-level version of
                the same defect: a group that stops declaring a subject, which is *one sheet headed
                with a fact from each* rebuilt out of one attribute.
 * `M6`-`M8`   ⛔ **the TEACHING** — the sentence that makes the grouping mean something, deleted,
                duplicated, and demoted to a label size.
 * `M9`-`M12`  🔴 **the THREAD** — the four ways an index entry that opens wide becomes a separate
                screen he has to navigate to: no host, no guard, no way back, no door.
 * `M13`-`M18` ⛔ **the SIZES** — `525`'s measured defect put back, one surface at a time, plus the
                two edits that move a whole ROLE at once (`526 M25`'s shape).
 * `M19`-`M21` ⚑ **the ROSTER as a census** — the two ways a roster lies, and the family matcher
                that makes one entry cover a `v-for`.
 * `M22`-`M23` ⛔ **the WALK** — a hook that left the drawer body left back under a tab, and the
                door that must not.

⚠️ **The table is NOT RUN.** Every row was applied ALONE, watched red against its killer and
restored from bytes with a SHA-256 re-check — `verify-each-mutation-row-without-running-the-table`.
The seat that runs tables is the PM's.
"""

INFO = "apps/desktop/src/renderer/src/components/SessionInfo.vue"
SHEET = "apps/desktop/src/renderer/src/components/AgentInstructionsSheet.vue"
BLOCK = "apps/desktop/src/renderer/src/components/SessionInstructions.vue"
PANE = "apps/desktop/src/renderer/src/components/ConversationPane.vue"
WHOSE = "apps/desktop/src/renderer/src/lib/what-survives-the-conversation.ts"
FLOW = "scripts/lib/tab-flow.mjs"

# (name, [(file, old, new), ...])
MUTATIONS = [
    # ---- the ruling, reversed ---------------------------------------------------------------------
    (
        "M1 · 🔴 THE RULING REVERSED ON ITS NAMED ROW · the working directory is filed as the agent's "
        "— `HO-009` §5 says *cwd is a property of the session* by name, and this is the fact that "
        "dies with the conversation standing in the pile that outlives it",
        [
            (
                WHOSE,
                "  { cy: 'session-cwd', subject: 'conversation', role: 'value' },",
                "  { cy: 'session-cwd', subject: 'agent', role: 'value' },",
            )
        ],
    ),
    (
        "M2 · 🔴 the HOME is filed as the conversation's · the isolated per-profile home is the one "
        "thing on this panel that is still on disk tomorrow, and this says it closes with the window",
        [
            (
                WHOSE,
                "  { cy: 'session-home', subject: 'agent', role: 'value' },",
                "  { cy: 'session-home', subject: 'conversation', role: 'value' },",
            )
        ],
    ),
    (
        "M3 · ⛔ the AGENT group stops declaring its subject · both piles then sit under one head, "
        "which is *one sheet headed with a fact from each* built out of a missing attribute",
        [
            (
                INFO,
                '<section class="group" data-cy="session-subject-agent" data-subject="agent">',
                '<section class="group" data-cy="session-subject-agent">',
            )
        ],
    ),
    (
        "M4 · ⛔ the WIDE SURFACE stops declaring its subject · the sheet is the thing the ruling "
        "names — *what must not happen is one sheet headed with a fact from each* — and an unheaded "
        "sheet is one nothing can measure",
        [
            (
                BLOCK,
                '<div class="told-and-told-with" data-cy="agent-instructions" data-subject="agent">',
                '<div class="told-and-told-with" data-cy="agent-instructions">',
            )
        ],
    ),
    (
        "M5 · ⛔ the provider's running facts are filed as the agent's · `liveness.agent` is what "
        "this conversation reports it is RUNNING, and a family entry is the one row that can "
        "mis-file a whole `v-for` at once",
        [
            (
                WHOSE,
                "  { cy: 'session-agent-', subject: 'conversation', role: 'value', sometimes: true },",
                "  { cy: 'session-agent-', subject: 'agent', role: 'value', sometimes: true },",
            )
        ],
    ),
    # ---- the teaching -----------------------------------------------------------------------------
    (
        "M6 · ⛔ the group heading loses the sentence that TEACHES it · a group headed with a word "
        "teaches a vocabulary, not a rule — the PO's *the grouping in the index is where the "
        "distinction gets taught*, undone",
        [
            (
                INFO,
                '      <p class="group-says">{{ SUBJECT_WORDS.conversation.says }}</p>\n',
                "",
            )
        ],
    ),
    (
        "M7 · ⛔ both groups are taught the SAME sentence · two heads that say one thing distinguish "
        "nothing, and every assertion about a heading being present still passes",
        [
            (
                WHOSE,
                "  agent: {\n    title: 'this agent',\n    says: 'These are still here after it closes.',\n  },",
                "  agent: {\n    title: 'this agent',\n    says: 'Closing it takes these with it.',\n  },",
            )
        ],
    ),
    (
        "M8 · ⛔ the teaching line is demoted to a micro label · it is the one SENTENCE on the index "
        "and `tokens.css` §9 reserves what this gives it for *tiny uppercase field labels* · killed by `press-read-and-a-word.dom.test.ts` · killed by `the-thread-a-person-does-not-leave.dom.test.ts`",
        [
            (
                WHOSE,
                # ⚑ **W4.205 · re-anchored in place, not retired** — W4.205 · prose moved from --text-xs to --text-sm in the type unification; the plant still demotes the teaching line to the micro label size, which now equals the label size, so the killer's label-below-prose check fails
                "  prose: '--text-sm',\n}",
                "  prose: '--text-6xs',\n}",
            )
        ],
    ),
    # ---- the thread -------------------------------------------------------------------------------
    (
        "M9 · 🔴 the sheet is raised WITHOUT the overlay host · it then draws inside the drawer's own "
        "scroller with no backdrop, no focus trap, no Escape and none of the emergency stop `390` "
        "hosts there — the sheet stops being a layer and becomes a very wide row · killed by `the-thread-a-person-does-not-leave.dom.test.ts`",
        [
            (
                PANE,
                # ⚑ **W4.205 · re-anchored in place, not retired** — W4.205 · the overlay host for the instructions sheet now carries a dialog name and spans several lines; the plant still raises the sheet in a plain div with no host, backdrop or Escape
                "    <OverlayHost\n      v-if=\"instructionsOpen\"\n      label=\"What this agent was told\"\n      @close=\"instructionsFor = null\"\n    >\n      <AgentInstructionsSheet",
                "    <div v-if=\"instructionsOpen\">\n      <AgentInstructionsSheet",
            ),
            (
                PANE,
                '        @close="instructionsFor = null"\n      />\n    </OverlayHost>',
                '        @close="instructionsFor = null"\n      />\n    </div>',
            ),
        ],
    ),
    (
        "M10 · ⛔ the sheet forgets WHICH conversation it is about · `067`'s guard, removed: switching "
        "conversation leaves one conversation's composed instructions floating over another's "
        "transcript, under the sentence that says they are what THIS agent was told",
        [
            (
                PANE,
                "  instructionsFor.value === props.record.sessionId ? props.record.meta : null,",
                "  instructionsFor.value !== null ? props.record.meta : null,",
            )
        ],
    ),
    (
        "M11 · ⛔ the index entry stops opening anything · the door is drawn and dead, which makes the "
        "block a surface a person can only reach by not being able to — and `525`'s whole finding "
        "was that the wide material has nowhere to go",
        [
            (
                INFO,
                '        data-cy="told-index"\n        @click="emit(\'openInstructions\')"',
                '        data-cy="told-index"',
            )
        ],
    ),
    (
        "M12 · ⛔ the drawer swallows the press · the entry emits and the drawer does not pass it on, "
        "so the tab has a door that reports nothing — the one hop in the chain nothing else covers",
        [
            (
                "apps/desktop/src/renderer/src/components/SessionDrawer.vue",
                '        @refresh-config="emit(\'refreshConfig\')"\n        @open-instructions="emit(\'openInstructions\')"',
                '        @refresh-config="emit(\'refreshConfig\')"',
            )
        ],
    ),
    # ---- the sizes --------------------------------------------------------------------------------
    (
        "M13 · 🔴 525'S MEASURED DEFECT, PUT BACK · the index's root returns to `--text-4xs`, the "
        "8.5 px that made 65 of 65 visible elements on this tab micro material",
        [
            (
                INFO,
                # ⚑ **token plumbing · re-anchored in place, not retired** — NOT VERIFIED. The token codemod rewrote this line to read tokens; the replacement is unchanged and makes the same defect.
                "  font-family: var(--font-mono);\n  font-size: var(--type-caption);\n  gap: var(--space-7);",
                "  font-family: var(--font-mono);\n  font-size: var(--text-4xs);\n  gap: var(--space-7);",
            )
        ],
    ),
    (
        "M14 · ⛔ the moved prose returns to 8 px · `356` moved these paragraphs behind a fold rather "
        "than deleting them, and a paragraph at the smallest size in the file is deleted in the only "
        "way that matters · killed by `the-thread-a-person-does-not-leave.dom.test.ts`",
        [
            (
                INFO,
                # ⚑ **W4.205 · re-anchored in place, not retired** — W4.205 · the .note prose moved from --text-xs to --text-sm in the type unification; the plant still drops the moved paragraphs to the micro size, off the prose size their role names
                # ⚑ **token plumbing · re-anchored in place, not retired** — NOT VERIFIED. The token codemod rewrote this line to read tokens; the replacement is unchanged and makes the same defect.
                "  margin-top: var(--space-3);\n  color: var(--muted);\n  font-family: var(--font-sans);\n  font-size: var(--type-small);",
                "  margin-top: var(--space-3);\n  color: var(--muted);\n  font-family: var(--font-sans);\n  font-size: var(--text-5xs);",
            )
        ],
    ),
    (
        "M15 · 🔴 the block goes back to wearing somebody else's clothes · its root stops declaring a "
        "size, so it inherits whatever mounts it — which is exactly what made every sentence in it a "
        "micro-label for four dispatches",
        [
            (
                BLOCK,
                # ⚑ **token plumbing · re-anchored in place, not retired** — NOT VERIFIED. The token codemod rewrote this line to read tokens; the replacement is unchanged and makes the same defect.
                "  font-family: var(--font-sans);\n  font-size: var(--type-body);\n  gap: var(--space-7);",
                "  font-family: var(--font-sans);\n  gap: var(--space-7);",
            )
        ],
    ),
    (
        "M16 · ⛔ the paths go proportional · with a root of its own the block is sans, so a `.path` "
        "that does not NAME the mono face renders a terminal path in a reading face — the defect a "
        "move creates and nothing but a mount can see",
        [
            (
                BLOCK,
                # ⚑ **token plumbing · re-anchored in place, not retired** — NOT VERIFIED. The token codemod rewrote this line to read tokens; the replacement is unchanged and makes the same defect.
                "  cursor: text;\n  font-family: var(--font-mono);\n  font-size: var(--type-small);\n  overflow-wrap: anywhere;",
                "  cursor: text;\n  font-size: var(--text-sm);\n  overflow-wrap: anywhere;",
            )
        ],
    ),
    (
        "M17 · 🔴 a whole ROLE moves at once · every path, value and row name on the index drops "
        "below the floor from one line — `526 M25`'s shape, and the row every assertion that read "
        "`ROLE_SIZE` to decide what `ROLE_SIZE` should be would have passed",
        [
            (
                WHOSE,
                "  label: '--text-3xs',\n  value: '--text-3xs',",
                "  label: '--text-5xs',\n  value: '--text-5xs',",
            )
        ],
    ),
    (
        "M18 · ⛔ the group heading stops being a micro-LABEL · it keeps the micro size and loses the "
        "uppercase that is the whole of `--text-6xs`'s stated use, so the one exemption the floor "
        "grants becomes a hole anything could be pushed through",
        [
            (
                INFO,
                "  letter-spacing: 0.08em;\n  text-transform: uppercase;\n}",
                "  letter-spacing: 0.08em;\n}",
            )
        ],
    ),
    # ---- the roster as a census -------------------------------------------------------------------
    (
        "M19 · ⛔ the roster stops covering the index entry's title · a fact on the surface that no "
        "line classifies, which is the hole a roster exists to close",
        [
            (
                WHOSE,
                "  { cy: 'told-index-title', subject: 'agent', role: 'entry' },\n",
                "",
            )
        ],
    ),
    (
        "M20 · ⛔ the roster keeps a line for a fact nothing draws · the other direction, and the one "
        "that goes stale silently — `525` F8 found exactly this in the design map",
        [
            (
                WHOSE,
                "  { cy: 'session-ref', subject: 'conversation', role: 'value' },",
                "  { cy: 'session-ref', subject: 'conversation', role: 'value' },\n  { cy: 'session-thread-id', subject: 'conversation', role: 'value' },",
            )
        ],
    ),
    (
        "M21 · ⛔ the family matcher stops matching families · a trailing dash is what makes an entry "
        "cover a `v-for`, and without it every `session-agent-<label>` row falls out of the census "
        "while the entry that names them still reads as covering something",
        [
            (
                WHOSE,
                "    if (entry.cy.endsWith('-') ? cy.startsWith(entry.cy) : cy === entry.cy) return entry",
                "    if (cy === entry.cy) return entry",
            )
        ],
    ),
    # ---- the walk ---------------------------------------------------------------------------------
    (
        "M22 · ⛔ a hook that left the drawer body is filed back under a tab · the walk would then "
        "send a live step to Info for something no tab mounts, the read would find nothing, and the "
        "step would assert against an absence it caused — 097's class, with the sign flipped",
        [
            (
                FLOW,
                "  'told-index': 'info',",
                "  'told-index': 'info',\n  'told-sentence': 'info',",
            )
        ],
    ),
    (
        "M23 · ⛔ the DOOR falls out of the table · the one hook on this tab that still belongs to it, "
        "unclaimed — so a step could press the entry from Events, where it is not on screen",
        [
            (
                FLOW,
                "  'told-index': 'info',\n",
                "",
            )
        ],
    ),
]
