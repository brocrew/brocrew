"""2004 · ui batch 4 — the give card, JSON's two readings, the wider panel, and the agent card.

⚑ **Why `2004`**: the landing's tables for the frontend's `ui` batches are `2001`, `2002`, `2003`; this is
the fourth, for `3e73c885` through `ac1918b1` (landed through the frontend's merges `8ca7d969` and
`f2ca4890`).

## What the batch built

 * `M1`–`M15` **the agent card** — its header (plate on the left, name and profile, state, latest
   words), its Current task under the agent, its Resources (one tile each), its Sub agents (the strip
   as a counted box, plate, dot and name side by side), and the open agent's card framed as a card of
   its own. Killed by `the-agent-card-frames-what-it-knows-and-nothing-more.dom.test.ts` and the
   frontend's own tests.
 * `M20`–`M34` **the give card, JSON's two readings, the wider panel** — a piece an agent gives drawn
   as a card reading D-022's receipt, a message whose words carry JSON read Readable and Raw, and the
   460px right panel where the window has room. Killed by
   `a-card-draws-what-it-read-and-nothing-it-guessed.dom.test.ts` and the frontend's own tests.

Designed read-only by Sonnet 5.5 agents from the commits and today's code; each row verified alone by
the landing agent.

## Verification

- **RED: 30 of 30.** Each row alone by `verify_row.py` with its named killer, on `landing` over
  `e9079be2` (the `ui` batch through `ac1918b1`), none by a syntax, reference or type error. Each killer
  file ran green unmutated first.
- **Landing `f1fa1e2e`…`70aaa954` (merge `08517549`):** `M10` re-anchored on the card on screen, RED
  alone; `M14` retired (the open agent's framed card went with `f1fa1e2e`).
"""

AGENT_CARD_VUE = "apps/desktop/src/renderer/src/components/AgentCard.vue"
CARD_SECTION_VUE = "apps/desktop/src/renderer/src/components/CardSection.vue"
CONVERSATION_PANE_VUE = "apps/desktop/src/renderer/src/components/ConversationPane.vue"
OUTGOING_ENTRY_VUE = "apps/desktop/src/renderer/src/components/OutgoingEntry.vue"
READABLE_WORDS_VUE = "apps/desktop/src/renderer/src/components/ReadableWords.vue"
RELAYED_ENTRY_VUE = "apps/desktop/src/renderer/src/components/RelayedEntry.vue"
SESSION_BOT_VUE = "apps/desktop/src/renderer/src/components/SessionBot.vue"
TASK_LIST_VUE = "apps/desktop/src/renderer/src/components/TaskList.vue"
WORDS_VIEWS_VUE = "apps/desktop/src/renderer/src/components/WordsViews.vue"
WORKING_TOGETHER_VUE = "apps/desktop/src/renderer/src/components/WorkingTogether.vue"
LATEST_WORDS = "apps/desktop/src/renderer/src/lib/latest-words.ts"
OUTGOING_CARD = "apps/desktop/src/renderer/src/lib/outgoing-card.ts"
WORDS_WITH_JSON = "apps/desktop/src/renderer/src/lib/words-with-json.ts"

MUTATIONS: list[tuple[str, list[tuple[str, str, str]]]] = [
    (
        "M1 · 🔴 the bubble drops its title · a message cut at three lines has its whole words nowhere on the card — killed by `the-agent-card-frames-what-it-knows-and-nothing-more.dom.test.ts`",
        [
            (AGENT_CARD_VUE, ":title=\"latest.text\"", ":title=\"undefined\""),
        ],
    ),
    (
        "M2 · 🔴 a press on a bubble whose message is not on screen still navigates · it shows a message the conversation is not showing — killed by `the-agent-card-frames-what-it-knows-and-nothing-more.dom.test.ts`",
        [
            (AGENT_CARD_VUE, "if (latest.value && canReach(latest.value.itemId)) emit('navigate', latest.value.itemId)", "if (latest.value) emit('navigate', latest.value.itemId)"),
        ],
    ),
    (
        "M3 · 🔴 the bubble is always a button · a message that is not on screen is drawn as a control that does nothing — killed by `the-agent-card-frames-what-it-knows-and-nothing-more.dom.test.ts`",
        [
            (AGENT_CARD_VUE, ":is=\"canReach(latest.itemId) ? 'button' : 'p'\"", ":is=\"'button'\""),
        ],
    ),
    (
        "M4 · 🔴 a turn with no text is not passed over · the bubble is drawn empty over the words the agent last said — killed by `the-agent-card-frames-what-it-knows-and-nothing-more.dom.test.ts`",
        [
            (LATEST_WORDS, "    if (text === '') continue\n", ""),
        ],
    ),
    (
        "M5 · 🔴 code fence lines are kept in the bubble's paragraph · the words show ``` marks a person did not say — killed by `the-agent-card-frames-what-it-knows-and-nothing-more.dom.test.ts`",
        [
            (LATEST_WORDS, "    .filter((line) => !FENCE.test(line))\n", ""),
        ],
    ),
    (
        "M6 · 🔴 the bubble's words are not clamped · a long message grows the header instead of being cut at three lines — killed by `the-agent-card-frames-what-it-knows-and-nothing-more.dom.test.ts`",
        [
            (AGENT_CARD_VUE, "  -webkit-line-clamp: 3;\n  line-height: 1.45;", "  -webkit-line-clamp: none;\n  line-height: 1.45;"),
        ],
    ),
    (
        "M7 · 🔴 a message with no clock is given the epoch as its time · the bubble claims it was said tens of thousands of days ago — killed by `the-agent-card-frames-what-it-knows-and-nothing-more.dom.test.ts`",
        [
            (AGENT_CARD_VUE, "latest.value?.at == null ? null : agoWords(latest.value.at, minute.value)", "agoWords(latest.value?.at ?? 0, minute.value)"),
        ],
    ),
    (
        "M8 · 🔴 the dot before the state word is one fixed colour · it stops agreeing with the plate beside it — killed by `the-agent-card-frames-what-it-knows-and-nothing-more.dom.test.ts`",
        [
            (SESSION_BOT_VUE, "'--_c': `var(${dot})`", "'--_c': 'var(--faint)'"),
        ],
    ),
    (
        "M9 · 🔴 the profile pill is drawn for an agent with no profile · an empty accent pill sits beside the name — killed by `the-agent-card-frames-what-it-knows-and-nothing-more.dom.test.ts`",
        [
            (SESSION_BOT_VUE, "v-if=\"props.profile\"", "v-if=\"true\""),
        ],
    ),
    (
        "M10 · 🔴 the quiet box is offered only when no work exists at all · an agent whose every piece is finished is not told it has no current task — killed by `the-agent-card-frames-what-it-knows-and-nothing-more.dom.test.ts`",
        # ⚑ Landing ui f1fa1e2e…70aaa954 (the card panel and the Vue Flow forest) · re-anchored in place,
        # not retired — The rule survives on the card of the conversation on screen: 'work that is all
        # finished still draws the quiet box (No current task)' is asserted by the card-frames test with
        # its open-piece pair. 70aaa954 put a 'not read yet' line before it, turning `v-if="!hasOpenTask"`
        # into `v-else-if="!hasOpenTask"`; the quoted `"!hasOpenTask"` matches once today and would still
        # match once if UI-006 turns it back into `v-if`, and it sits on `AgentCard`, outside the
        # chosen-agent machinery. With `!hasTasks` the all-finished card draws no `card-task-empty`.
        # Killed by `the-agent-card-frames-what-it-knows-and-nothing-more.dom.test.ts`.
        [
            (AGENT_CARD_VUE, "\"!hasOpenTask\"", "\"!hasTasks\""),
        ],
    ),
    (
        "M11 · 🔴 the current piece is the newest piece, open or not · a finished piece takes the well and the brief from the one still being worked on — killed by `the-agent-card-frames-what-it-knows-and-nothing-more.dom.test.ts`",
        [
            (TASK_LIST_VUE, "shown.value.filter((one) => one.piece.open).at(-1) ?? null", "shown.value.at(-1) ?? null"),
        ],
    ),
    (
        "M12 · 🔴 a strip chip's dot is coloured from the band's own reading, not the rail's · the dot and the plate beside it say two things — killed by `the-agent-card-frames-what-it-knows-and-nothing-more.dom.test.ts`",
        [
            (WORKING_TOGETHER_VUE, "'--_c': `var(${priorityDotToken(asTheRailSays(card.conversation, card.facets).facets)})`", "'--_c': `var(${priorityDotToken(card.facets)})`"),
        ],
    ),
    (
        "M13 · 🔴 a Resources tile's name loses its title · a file name cut to one line is nowhere in full — killed by `the-agent-card-frames-what-it-knows-and-nothing-more.dom.test.ts`",
        [
            (AGENT_CARD_VUE, "<span class=\"tile-name\" :title=\"asset.name\">", "<span class=\"tile-name\">"),
        ],
    ),
    (
        "M14 · 🔴 the open agent's card is drawn without its frame · it melts into the panel instead of standing as a card of its own — killed by `the-agent-card-frames-what-it-knows-and-nothing-more.dom.test.ts`",
        # ⛔ **RETIRED BY RULING (landing ui f1fa1e2e…70aaa954):** The frame (`.agent`: border, radius-lg,
        # panel fill) belonged to the open agent's card under the strip, deleted by f1fa1e2e ('The open
        # child's card under the Sub agents strip is gone'); the CSS block itself was removed from
        # WorkingTogether. The card-frames test's header records it: 'the frame around the open agent's
        # card went with that card (f1fa1e2e: "only the card of the parent")'. The card on screen fills
        # the panel and `.agent-card` has no frame by design; the surviving frame rule is the sections',
        # which is 2004 M15. Its anchor is left stale, so the census records it retired.
        [
            (WORKING_TOGETHER_VUE, "  padding-bottom: var(--space-1);\n  border: 1px solid var(--line);\n  border-radius: var(--radius-lg);\n  background: var(--panel);", "  padding-bottom: var(--space-1);\n  border: 0;\n  border-radius: var(--radius-lg);\n  background: var(--panel);"),
        ],
    ),
    (
        "M15 · 🔴 a card section's frame is removed · Current task, Sub agents and Resources lose their box — killed by `the-agent-card-frames-what-it-knows-and-nothing-more.dom.test.ts`",
        [
            # ⚑ **theme host · re-anchored in place, not retired** — NOT VERIFIED. Theme border widths now use tokens; the same defect retains all other declarations.
            # ⚑ **Re-anchored in place, not retired** — NOT VERIFIED. The row guards the card section's frame, which the panel's cards are boxed by; the border now reads a theme's card line, falling back to the same line, and the plant still removes it.
            (CARD_SECTION_VUE, "  border: var(--border-width) solid var(--drawer-card-line, var(--line));\n  border-radius: var(--radius-lg);", "  border: 0;\n  border-radius: var(--radius-lg);"),
        ],
    ),
    (
        "M20 · a held give reads as sent and a sent give as held · the delivery word is chosen backwards from the receipt's 'went to … straight away' / 'is held until … is free', so the card says the opposite of what happened — killed by `a-piece-given-is-a-card.test.ts`, `the-give-card-on-the-givers-page.dom.test.ts`, `a-card-draws-what-it-read-and-nothing-it-guessed.dom.test.ts`",
        [
            (OUTGOING_CARD, "return { label, delivery: went.startsWith('went') ? 'sent' : 'held' }", "return { label, delivery: went.startsWith('went') ? 'held' : 'sent' }"),
        ],
    ),
    (
        "M21 · a give whose title the 200-character bound cut is drawn as a half-title · the card draws 'Make the rail ' as if it were the piece's name — killed by `a-card-draws-what-it-read-and-nothing-it-guessed.dom.test.ts`",
        [
            (OUTGOING_CARD, "title === null || title.cut || title.text.trim() === '' ? null : title.text,", "title === null || title.text.trim() === '' ? null : title.text,"),
        ],
    ),
    (
        "M22 · a give whose profile the bound cut is named as if the head were the agent · the recipient reads 'de' where the summary was cut inside 'dev', instead of 'another agent' — killed by `a-card-draws-what-it-read-and-nothing-it-guessed.dom.test.ts`",
        [
            (OUTGOING_CARD, "profile === null || profile.cut || profile.text.trim() === ''", "profile === null || profile.text.trim() === ''"),
        ],
    ),
    (
        "M23 · a held give's state word loses its explanation · 'held · goes when its turn ends' is drawn as a bare 'held', so the giver is not told when the work will go — killed by `a-card-draws-what-it-read-and-nothing-it-guessed.dom.test.ts`",
        [
            (OUTGOING_CARD, "  held: 'held · goes when its turn ends',", "  held: 'held',"),
        ],
    ),
    (
        "M24 · the sender card's Readable | Raw toggle no longer rides the meta row's right edge · `.views` loses its auto margin, so the toggle and the clock huddle after the heading and the clock leaves the card's edge — killed by `a-card-draws-what-it-read-and-nothing-it-guessed.dom.test.ts`",
        [
            (OUTGOING_ENTRY_VUE, ".views {\n  margin-left: auto;\n}", ".views {\n  margin-left: 0;\n}"),
        ],
    ),
    (
        "M25 · the recipient card's clock keeps its own auto margin beside the toggle · `.time.beside` stops zeroing it, so the free space is split and the toggle floats mid-row away from the clock — killed by `a-card-draws-what-it-read-and-nothing-it-guessed.dom.test.ts`",
        [
            (RELAYED_ENTRY_VUE, ".time.beside {\n  margin-left: 0;\n}", ".time.beside {\n  margin-left: auto;\n}"),
        ],
    ),
    (
        "M26 · the Raw button reports the wrong pressed state · aria-pressed on Raw follows Readable, so both buttons read pressed at once and a screen reader cannot tell the view — killed by `a-card-draws-what-it-read-and-nothing-it-guessed.dom.test.ts`",
        [
            (WORDS_VIEWS_VUE, ":aria-pressed=\"view === 'raw'\"", ":aria-pressed=\"view === 'readable'\""),
        ],
    ),
    (
        "M27 · the Readable button's on-state follows the Raw view · the painted pill is on the wrong button (or on neither), so the toggle shows the opposite of the view drawn — killed by `a-card-draws-what-it-read-and-nothing-it-guessed.dom.test.ts`",
        [
            (WORDS_VIEWS_VUE, ":class=\"{ on: view === 'readable' }\"", ":class=\"{ on: view === 'raw' }\""),
        ],
    ),
    (
        "M28 · Readable keeps the line breaks that touch a JSON block · the prose after a block starts with the blank lines that separated it, so a paragraph opens with empty space inside its own box — killed by `a-card-draws-what-it-read-and-nothing-it-guessed.dom.test.ts`",
        [
            (READABLE_WORDS_VUE, "    if (before) text = text.trimStart()\n", "    if (before) text = text\n"),
        ],
    ),
    (
        "M29 · Readable draws an empty paragraph for whitespace-only words between blocks · two payloads separated by a space and a line break get a blank line-height gap between them — killed by `a-card-draws-what-it-read-and-nothing-it-guessed.dom.test.ts`",
        [
            (READABLE_WORDS_VUE, "return text === '' ? [] : [{ kind: 'words', text }]", "return [{ kind: 'words', text }]"),
        ],
    ),
    (
        "M30 · the scan bound on the words' length is gone · a 100,001-character message is scanned for JSON and offers the toggle, so a pathological text costs unbounded work on every render — killed by `a-card-draws-what-it-read-and-nothing-it-guessed.dom.test.ts`",
        [
            (WORDS_WITH_JSON, "  if (text.length > LONGEST_WORDS_READ) return null\n", ""),
        ],
    ),
    (
        "M31 · the cap on brackets tried is gone · after 200 prose brackets the scan keeps going and finds a payload the bound says stays words — killed by `a-card-draws-what-it-read-and-nothing-it-guessed.dom.test.ts`",
        [
            (WORDS_WITH_JSON, "while (at < text.length && tried < MOST_STARTS_TRIED) {", "while (at < text.length) {"),
        ],
    ),
    (
        "M32 · a bracket run that does not parse swallows the JSON inside it · after a failed candidate the scan resumes past its close instead of one character in, so a payload wrapped in '[note …]' is drawn as words — killed by `a-card-draws-what-it-read-and-nothing-it-guessed.dom.test.ts`",
        [
            (WORDS_WITH_JSON, "      at = open + 1\n      continue", "      at = close < 0 ? open + 1 : close + 1\n      continue"),
        ],
    ),
    (
        "M33 · a cut brief that carries JSON loses its 'cut' sentence in the Readable view · the notice is only drawn when the words have no JSON, so Readable presents the head of a longer text as the whole — killed by `a-card-draws-what-it-read-and-nothing-it-guessed.dom.test.ts`",
        # ⚑ Landing ui bb5b9b7e…128203e6 (UI-009 to UI-011) · re-anchored in place, not retired — UI-011
        # (128203e6) reshaped the cut paragraph: `<p v-if="card.bodyIsCut" class="cut"
        # data-cy="outgoing-cut">` now holds either the whole-brief press or `{{ BODY_WAS_CUT }}`, so the
        # old one-line text is gone. The rule that a cut brief carrying JSON still says it was cut, in
        # both Readable and Raw, survives. The plant makes the paragraph's guard also require that the
        # words carry no JSON. Killed by `a-card-draws-what-it-read-and-nothing-it-guessed.dom.test.ts`.
        [
            (OUTGOING_ENTRY_VUE, "<p v-if=\"card.bodyIsCut\" class=\"cut\" data-cy=\"outgoing-cut\">", "<p v-if=\"card.bodyIsCut && !jsonParts\" class=\"cut\" data-cy=\"outgoing-cut\">"),
        ],
    ),
    (
        # ⚑ W4.183 re-anchor: the three fixed tracks became one fluid docked track (360–560px), the same defect.
        # ⚑ Re-anchored in place, NOT VERIFIED — targets `ConversationPane.vue`'s docked full-grid rule, which now sizes the drawer's track from the transcript's comfortable width (`--transcript-comfort`). The anchor matches one place, and the mutant still deletes that same rule.
        "M34 · the docked right panel's grid rule is gone · docked, the drawer takes no track and falls to a second row at the full width — killed by `first-paint.dom.test.ts`",
        [
            (CONVERSATION_PANE_VUE, ".pane-body[data-drawer='true'][data-fit='docked'] {\n  grid-template-columns:\n    minmax(0, 1fr)\n    clamp(var(--drawer-w-min), calc(100% - var(--transcript-comfort)), var(--drawer-w-max));\n}\n\n", ""),
        ],
    ),
]
