"""462 · The answer a person can actually read — a second surface for what a tool said.

⛔ **`457` measured this and handed it over in one sentence:** *"The structured half of a tool
answer is durable nowhere and has no surface."* `ToolEntry.vue` draws one ≤200-character string,
the raw Events tab shows **less**, and a sub-agent's result summary is never drawn at all.

🔴 **And it measured the size of the gap, through the app's own tools:**

| call | prose | structured payload |
|---|---|---|
| `list_projects`, six projects | **353 chars** | **3 691 chars** |
| `list_agents`, one agent | 31 chars | 169 chars |

⛔ **The bound stays at 200**, because `457` closed that door with numbers: a bound large enough to
carry the payload *"puts a 4 KB blob on every tool row in the transcript, writes it to the ledger,
and clones it across IPC for the life of the session — and it still is not readable."* ⚑ **So this
is a SECOND place** — a bounded hold each adapter fills off its own stream, keyed by the call id the
row already carries, read once when a person presses a button, and never durable.

## ⚠️ Where the bytes come from, which is `462` §2.2's question

**The provider's own receipt**, in each adapter's currency, keyed by the row's own id:

- **Codex** — `item/completed` echoes `contentItems`, and since `457` the app's own tools put the
  prose at index 0 and the payload at index 1. `457`'s probe measured `contentItems` `null` on
  `item/started` and populated on completion; that is the array the reader takes.
- **Claude** — every `tool_result` block's `content`, kept as PARTS where `summarizeToolResult`
  welds them into one line.

⛔ **Nothing is persisted, and the surface DRAWS that**: a conversation reopened from the ledger has
every row and none of what its tools said, and the row says so where the button would be.

## 🔴 Which gate can see each row

| rows | the defect is caught by |
|---|---|
| `M1`-`M7` | ⚑ **`packages/runtime/test/the-answer-a-person-can-read.test.ts`** §1 — the hold |
| `M8`-`M14` | ⚑ **…the same file** §2 — the Codex reader |
| `M15`-`M17` | ⚑ **`packages/runtime/test/codex-runtime.test.ts`** — the adapter's wiring |
| `M18`-`M21` | ⚑ **…`the-answer-a-person-can-read.test.ts`** §3 — the Claude receipt |
| `M22`-`M29` | ⚑ **`apps/desktop/test/the-answer-a-person-can-read.render.test.ts`** §1-§4 |
| `M30`-`M38` | ⚑ **`apps/desktop/test/dom/the-answer-a-person-can-read.dom.test.ts`** |

## ⛔ What this table deliberately does NOT contain

⚠️ **No row on the Claude structural claim in §4 of the runtime suite.** That test pins what
`claudeMcpServersFor` SENDS — one text block plus a `structuredContent` — and the only mutation that
could move it is the one-line change this dispatch names as a finding and does not make. A row that
applied the finding would be this table asserting a product decision nobody has taken.

⚠️ **No row deleting the `item/completed` feed entirely.** `300 M1` already anchors on the two lines
immediately below it and a third line in that block would retire a row still protecting something
real — which is why the capture is written ABOVE them rather than between them, and why the deletion
is covered by `M15`'s re-aim instead.

⚠️ **No row on `partsDroppedNote` / `partDroppedNote`'s wording.** The render suite asserts those
strings exactly, so a wording edit is a mutation on a census of itself
(`a-mutation-on-a-census-is-invisible-to-that-census`) rather than a defect a person would meet.

⚠️ **No row making `toolAnswer` clear on `close()`.** There is no such line to mutate: the hold is
deliberately NOT swept, and the reason is written where `commandTails.clear()` is not called.
"""

HOLD = "packages/runtime/src/tool-answer.ts"
CODEX = "packages/runtime/src/codex/normalize.ts"
ADAPTER = "packages/runtime/src/codex/codex-runtime.ts"
CLAUDE = "packages/runtime/src/claude/normalize.ts"
LIB = "apps/desktop/src/renderer/src/lib/tool-answer.ts"
ROW = "apps/desktop/src/renderer/src/components/ToolEntry.vue"
PANEL = "apps/desktop/src/renderer/src/components/ToolAnswerViewer.vue"
CHILD = "apps/desktop/src/renderer/src/components/SubAgentEntry.vue"
PANE = "apps/desktop/src/renderer/src/components/ConversationPane.vue"

MUTATIONS = [
    # ── §1 · the hold ───────────────────────────────────────────────────────────────────────────
    (
        "M1 · 🔴 THE HOLD KEEPS THE TAIL INSTEAD OF THE HEAD · an answer is a document whose first "
        "sentence 448 ordered first so it would survive a cut; keeping the end throws away the half "
        "this surface exists to show, and the panel opens mid-payload",
        [
            (
                HOLD,
                "        text: over === 0 ? text : points.slice(0, MAX_TOOL_ANSWER_PART).join(''),",
                "        text: over === 0 ? text : points.slice(over).join(''),",
            )
        ],
    ),
    (
        "M2 · ⛔ the cut is SILENT · 092's rule inverted — a person is shown the first 16 000 "
        "characters of a longer answer with nothing saying the rest was ever there",
        [(HOLD, "        dropped: over,", "        dropped: 0,")],
    ),
    (
        "M3 · ⚠️ cut by UTF-16 unit rather than by CODE POINT · 251's lesson, on a payload a person "
        "may copy: a slice at an odd offset splits a surrogate pair and puts � inside a string value",
        [
            (
                HOLD,
                "      const points = [...text]",
                "      const points = Array.from({ length: text.length }, (_, i) => text[i] as string)",
            )
        ],
    ),
    (
        "M4 · ⛔ parts past the ceiling vanish without a word · the panel numbers four of six and "
        "the numbering simply stops, which is the silent truncation 092 forbids at the other scale",
        [
            (
                HOLD,
                "      partsDropped: Math.max(0, parts.length - kept.length),",
                "      partsDropped: 0,",
            )
        ],
    ),
    (
        "M5 · 🔴 a receipt that carried NO WORDS is not held · 074's rule collapsed — *the receipt "
        "arrived and said nothing* becomes *this app is not holding it*, and a person cannot tell a "
        "picture from a hole",
        [(HOLD, "    if (id === '') return", "    if (id === '' || parts.length === 0) return")],
    ),
    (
        "M6 · ⚠️ a re-written call does not move to the back of the eviction order · the correction "
        "for a call answered twice is the FIRST thing evicted, so a long turn loses its newest answers",
        [
            (
                HOLD,
                "    // Re-inserted rather than mutated in place, so the key moves to the back of the eviction order.\n    this.answers.delete(id)\n",
                "",
            )
        ],
    ),
    (
        "M7 · ⛔ nothing is ever evicted · the ceiling that keeps a session's hold bounded stops "
        "biting, and a conversation running hundreds of tool calls holds every answer for its life",
        [
            (
                HOLD,
                "    while (this.answers.size > MAX_TOOL_ANSWERS) {",
                "    while (this.answers.size > MAX_TOOL_ANSWERS * 100) {",
            )
        ],
    ),
    # ── §2 · the Codex reader ───────────────────────────────────────────────────────────────────
    (
        "M8 · 🔴 THE TWO HALVES ARE WELDED BACK TOGETHER · 457 made the boundary an ARRAY INDEX on "
        "purpose; joining them puts the prose and the JSON in one block again and the panel is a "
        "longer row with a border round it",
        [
            (
                CODEX,
                "      if (typeof one['text'] === 'string') parts.push(one['text'])\n    }\n    return parts\n  }",
                "      if (typeof one['text'] === 'string') parts.push(one['text'])\n    }\n    return parts.length > 1 ? [parts.join('\\n')] : parts\n  }",
            )
        ],
    ),
    (
        "M9 · ⛔ a picture's data: URL becomes a PART · NON_TEXT_ANSWER's own argument, reversed — a "
        "megabyte of base64 held in memory for a panel about what a tool SAID",
        [
            (
                CODEX,
                "      if (!isRecord(one) || one['type'] !== 'inputText') continue\n      if (typeof one['text'] === 'string') parts.push(one['text'])",
                "      if (!isRecord(one)) continue\n      const said = one['text'] ?? one['imageUrl'] ?? one['audioUrl']\n      if (typeof said === 'string') parts.push(said)",
            )
        ],
    ),
    (
        "M10 · ⚠️ a call that has not answered yet is held as an EMPTY answer · the probe measured "
        "`contentItems` null on every item/started, so this says *the receipt carried no words* "
        "about a call still running",
        [
            (
                CODEX,
                "    const content = item['contentItems']\n    if (!Array.isArray(content)) return null",
                "    const content = item['contentItems']\n    if (!Array.isArray(content)) return []",
            )
        ],
    ),
    (
        "M11 · ⛔ the machine's copy goes FIRST on the MCP arm · mcpResultSummary's ordering "
        "inverted, so the panel's *what it said* heading sits over the JSON and the words are filed "
        "under *what it sent with it*",
        [
            (
                CODEX,
                "        if (encoded !== undefined) parts.push(encoded)",
                "        if (encoded !== undefined) parts.unshift(encoded)",
            )
        ],
    ),
    (
        "M12 · 🔴 the structured half is dropped on the MCP arm · the one kind of answer on this "
        "provider that really does carry a `structuredContent` loses it, and the panel shows the "
        "text blocks as though they were the whole receipt",
        [
            (
                CODEX,
                "    const machineHalf = readField(result, 'structuredContent')",
                "    const machineHalf = undefined",
            )
        ],
    ),
    (
        "M13 · ⚠️ a COMMAND's output is held as a tool answer · two accounts of one thing — 300's "
        "tail already owns those bytes, and command-output.ts §4 is the note about what happens when "
        "two surfaces describe one fact",
        [
            (
                CODEX,
                "  if (item['type'] === 'mcpToolCall') {",
                "  if (item['type'] === 'commandExecution') {\n    const out = item['aggregatedOutput']\n    return typeof out === 'string' ? [out] : []\n  }\n  if (item['type'] === 'mcpToolCall') {",
            )
        ],
    ),
    (
        "M14 · ⛔ an MCP call that never produced a result is held as an empty answer · the transport "
        "failure 327 measured — `result: null`, the reason on `error.message` — reads as *the tool "
        "answered and said nothing*",
        [
            (
                CODEX,
                "    if (result === undefined || result === null) return null",
                "    if (result === undefined || result === null) return []",
            )
        ],
    ),
    # ── §3 · the Codex adapter's wiring ─────────────────────────────────────────────────────────
    (
        "M15 · 🔴 THE FEED IS AIMED AT item/started · the phase the probe measured `contentItems` "
        "null on, so every hold is created empty and never filled — the panel says *the receipt "
        "carried no words* about every call on this provider",
        [
            (
                ADAPTER,
                "    if (method === 'item/completed') this.noteToolAnswer(params)",
                "    if (method === 'item/started') this.noteToolAnswer(params)",
            )
        ],
    ),
    (
        "M16 · ⛔ the FRAME is read where the ITEM is meant · `params` carries threadId/turnId and "
        "the item beside them, so the reader sees no `type` at all and every answer is dropped",
        [
            (
                ADAPTER,
                "    const item = isRecord(params) ? params['item'] : undefined\n    const parts = codexToolAnswerParts(item)",
                "    const item = params\n    const parts = codexToolAnswerParts(item)",
            )
        ],
    ),
    (
        "M17 · ⚠️ the hold is keyed by the TURN rather than by the call · every answer in a turn "
        "lands under one key and overwrites the last, and no row can find its own",
        [
            (
                ADAPTER,
                "    this.toolAnswers.write(readString(item, 'id'), parts)",
                "    this.toolAnswers.write(readString(params, 'turnId'), parts)",
            )
        ],
    ),
    # ── §4 · the Claude receipt ─────────────────────────────────────────────────────────────────
    (
        "M18 · 🔴 the hold gets the SUMMARY instead of the answer · the whole point inverted: the "
        "panel shows the same ≤200 characters the row already shows, with a border round them",
        [
            (
                CLAUDE,
                # ⚑ **source-restoration · re-anchored in place, not retired** — NOT VERIFIED; source targeting only. 32981d722 also reads parts for structured message receipts; replace only the held full answer with its summary.
                "            answers.write(block['tool_use_id'], parts)",
                "            answers.write(block['tool_use_id'], [summarizeToolResult(block['content'])])",
            )
        ],
    ),
    (
        "M19 · ⛔ the receipt's blocks are welded · joinText's own concatenation, applied where the "
        "structure is the only thing a receipt has — 457's array-index boundary lost on this provider",
        [
            (
                CLAUDE,
                # ⚑ **source-restoration · re-anchored in place, not retired** — NOT VERIFIED; source targeting only. 32981d722 names the parts once; weld only the held answer blocks while leaving the structured receipt reader intact.
                "            answers.write(block['tool_use_id'], parts)",
                "            answers.write(block['tool_use_id'], [parts.join('')])",
            )
        ],
    ),
    (
        "M20 · ⚠️ a STRING receipt is zero parts · the shape every built-in tool answers in, read as "
        "*the receipt carried no words* about one that carried them all",
        [
            (
                CLAUDE,
                "  if (typeof content === 'string') return [content]",
                "  if (typeof content === 'string') return []",
            )
        ],
    ),
    (
        "M21 · ⛔ a CHILD's answer is filed under its parent · 029's misattribution in a new place: "
        "the dispatch row would answer for every tool its child ran, and the child's own rows would "
        "find nothing",
        [
            (
                CLAUDE,
                # ⚑ **source-restoration · re-anchored in place, not retired** — NOT VERIFIED; source targeting only. 32981d722 names the parts once; still file the same child's answer under its parent.
                "            answers.write(block['tool_use_id'], parts)",
                "            answers.write(parent ?? block['tool_use_id'], parts)",
            )
        ],
    ),
    # ── §5 · the renderer's reading ─────────────────────────────────────────────────────────────
    (
        "M22 · 🔴 the halves are named by their CHARACTERS rather than by their order · the last part "
        "becomes *what it said*, which is 405's forbidden derivation arriving in a heading",
        [(LIB, "  if (index === 0) return 'What it said'", "  if (index === total - 1) return 'What it said'")],
    ),
    (
        "M23 · ⛔ a bare number or string is *formatted* · `353` and `\"a string\"` are valid JSON, so "
        "the panel claims to have indented something and shows exactly what it was handed",
        [
            (
                LIB,
                "  if (typeof parsed !== 'object' || parsed === null) return null",
                "  if (parsed === undefined) return null",
            )
        ],
    ),
    (
        "M24 · ⚠️ a part that is not JSON is blanked instead of shown · the formatter becomes a place "
        "content can disappear, which is the one thing a Raw view exists to make impossible",
        [(LIB, "  try {\n    parsed = JSON.parse(text)\n  } catch {\n    return null\n  }", "  try {\n    parsed = JSON.parse(text)\n  } catch {\n    return ''\n  }")],
    ),
    (
        "M25 · ⛔ the Raw view joins the parts with NOTHING · prose runs into payload with no "
        "boundary — the defect 457 measured on the wire, reproduced on the surface that shows it",
        [(LIB, "  return answer.parts.map((part) => part.text).join('\\n')", "  return answer.parts.map((part) => part.text).join('')")],
    ),
    (
        "M26 · 🔴 THE GAP IS NEVER DRAWN · a replayed conversation's panel says *this app is not "
        "holding the answer* instead of *this conversation is not running*, so a person reads a bug "
        "where 462 §2.2 requires a property of the app",
        # ⚑ Landing D-017b (3af91dcb) · re-anchored in place, not retired — The rule survives: a
        # replayed conversation's panel must say the answer is no longer held (a property of the
        # app), not 'this app is not holding the answer'. D-017b only rewrote the sentence (no
        # process word), so the anchor `'This conversation is not running,` moved to `'What this
        # tool said is no longer held`; the plant restores the null-first ordering that hides the
        # gap.
        [
            (LIB, "  if (!canAsk) {\n    return 'What this tool said is no longer held", "  if (answer === null) return 'This app is not holding the answer to this one.'\n  if (!canAsk) {\n    return 'What this tool said is no longer held"),
        ],
    ),
    (
        "M27 · ⛔ *not holding it* and *it carried no words* become one sentence · 074's rule, and "
        "the difference between a fact about this app and a fact about the answer",
        [
            (
                LIB,
                "  if (answer.parts.length === 0) return 'The receipt arrived and carried no words.'",
                "  if (answer.parts.length === 0) return 'This app is not holding the answer to this one.'",
            )
        ],
    ),
    (
        "M28 · ⚠️ the row's sentence names the bound · a number whose derivation lives in another "
        "package, printed in the renderer — 458's defect, planted where it would go stale silently",
        # ⚑ Landing D-017b (3af91dcb) · re-anchored in place, not retired — The rule (the row's
        # sentence must not name the bound, a number derived in another package) survives:
        # ANSWER_NOT_HELD is still 'This is the short form of what the tool answered.', now on one
        # line beside `export const ANSWER_NOT_HELD =`. Only the leading two-space continuation
        # indent of the old anchor is gone.
        [
            (LIB, "ANSWER_NOT_HELD = 'This is the short form of what the tool answered.", "ANSWER_NOT_HELD = 'This is the first 200 characters of what the tool answered."),
        ],
    ),
    (
        "M29 · ⛔ the size note reports what is KEPT rather than what arrived · a reader just told "
        "that 4 312 characters were dropped is then shown the size of what is left",
        [
            (
                LIB,
                "  const whole = [...part.text].length + part.dropped",
                "  const whole = [...part.text].length",
            )
        ],
    ),
    # ── §6 · the surfaces ───────────────────────────────────────────────────────────────────────
    (
        "M30 · 🔴 the door is offered on a conversation that cannot answer · 106's control that "
        "cannot act, and the gap 462 §2.2 requires is replaced by a button onto nothing",
        [(ROW, '        v-if="props.canReadAnswer"', '        v-if="true"')],
    ),
    (
        "M31 · ⛔ the gap sentence is deleted · a replayed conversation goes quiet, and a person "
        "reads the 200-character receipt as the whole of what the tool said",
        [
            (
                ROW,
                '      <p v-else class="answer-gone" :data-cy="`tool-answer-gone-${item.id}`">\n        {{ ANSWER_NOT_HELD }}\n      </p>\n',
                "",
            )
        ],
    ),
    (
        "M32 · ⚠️ the door escapes the fold · 300 put the Stop outside deliberately because it is a "
        "control over running work; this is not one, and a button on every collapsed tool row is the "
        "noise the fold exists to prevent",
        [
            (
                ROW,
                ".tool-entry.folded .answer-ask {\n  display: none;\n}",
                ".tool-entry.folded .answer-ask {\n  display: flex;\n}",
            )
        ],
    ),
    (
        "M33 · ⛔ the PANE's gate stops reading this conversation's liveness · every replayed "
        "conversation offers a door onto a handle that no longer exists",
        [
            (
                PANE,
                "    props.record.meta?.liveness.canReadToolAnswer === true && props.onReadToolAnswer !== undefined,",
                "    props.onReadToolAnswer !== undefined,",
            )
        ],
    ),
    (
        "M34 · ⛔ …and the other half: the gate stops asking whether there is a reader at all · a "
        "window with no channel behind it draws a button whose press does nothing",
        [
            (
                PANE,
                "    props.record.meta?.liveness.canReadToolAnswer === true && props.onReadToolAnswer !== undefined,",
                "    props.record.meta?.liveness.canReadToolAnswer === true,",
            )
        ],
    ),
    (
        "M35 · 🔴 the panel asks the ANSWER whether the conversation is live · `null` covers four "
        "states and only one of them is *not running*, so every missing answer reads as a closed "
        "conversation and the one real hole stops being nameable",
        [
            (
                PANEL,
                "const absence = computed(() => answerAbsence(props.answer, props.canAsk))",
                "const absence = computed(() => answerAbsence(props.answer, props.answer !== null))",
            )
        ],
    ),
    (
        "M36 · ⚠️ the panel shrink-wraps to its content · measured at 400px of the 900 it is allowed, "
        "because a pretty-printed payload's longest LINE is short — the row's problem again in a "
        "bigger box",
        [(PANEL, "  width: min(900px, 92vw);", "  max-width: min(900px, 92vw);")],
    ),
    (
        "M37 · ⛔ a payload value with no break opportunity runs off the side · a 600-character slug "
        "widens the paper and the stage gains a second, horizontal scroller",
        [(PANEL, "  overflow-wrap: anywhere;\n}", "}")],
    ),
    (
        "M38 · ⚠️ the CHILD's row loses the only control on it · `.row-ask` shrinks with the two "
        "clipping siblings beside it, and on a row with a long summary there is nothing left to press",
        [(CHILD, ".row-ask {\n  flex: none;", ".row-ask {\n  flex: 1 1 auto;\n  min-width: 0;\n  overflow: hidden;")],
    ),
]
