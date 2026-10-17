"""506 · a report that names a conversation and will not take you there — each row is THE DEFECT, put back (131).

🔴 **the person, from live use:** *"when a task is done or reports something to the conversation, can we
have a link/button to take the user to the conversation where the task is running?"* ⚠️ He was
reading a real row: *"Task #5 (`task_23bfe5a1…`) with `sess_93185480…` is not being worked on: the
turn it was running in was stopped, by `sess_6c6b5c64…`."* — **two session ids and a task id, and
no route to any of them.**

## ⛔ The one property these rows guard

⚑ **The route is DERIVED FROM THE REPORT and never from the sentence beside it.**
`work-report.ts`'s standing rule is *"Nothing here is computed from the words … a renderer that
read the outcome out of the prose would be a second reading of a fold it cannot see"*, so the
conversation had to become a FIELD before it could become a control. ⛔ `WorkReport` carried no
session id of any kind; `406`'s review had removed `to` for the stated reason *nothing rendered
it*, which is a CONDITION and not a ruling — and `506` is the reader.

## ⚠️ The asymmetry this closed, which nobody had written down

⛔ **The answered reply has carried the child's id since `439`, as `carriedFor` → `relayedFrom`.**
The undriven notice carries none and must not: `carriedFor` says *whose WORDS these are*, and a
stall is BroBot's sentence about a child that wrote nothing. ⚑ So the field `506` added is a
SUBJECT — *the conversation the work is with* — and it is on both halves of one surface.

## 🔴 The fork is `held` and nothing else, and that is a LIMIT

⚠️ **A transcript row has no per-session read of `RunningState`.** It is exposed on three LIST
payloads and there is no per-session door on the bridge; this report carries no project slug to
ask the room with either. ⛔ So *not held* is a residue of three states — another window has it,
nobody has it, nothing is running it — and the row may not name any one of them.

⚑ **The person's queue has exactly this limit and answers it exactly this way**: `openingAction`'s
two sentences, `store.claim` when the row is not held, and the host's own refusal when the claim is
refused, over a population that is *"mostly conversations nobody is holding"*. ⛔ **This dispatch
imported that answer rather than minting a second one** — `169` §1, and the reason `taking-over.ts`
exists at all.

## 🔴 The gate map — which file kills which row

| rows | killer |
|---|---|
| M1, M2 | `apps/desktop/test/a-report-that-names-a-conversation.test.ts` §1, and `finished-and-finished-with-a-question.test.ts` §2's key census |
| M3, M4, M5, M6 | `apps/desktop/test/a-report-that-names-a-conversation.test.ts` §2 |
| M7 | …the same file's §4 — the census that says the words are asked for and not spelled |
| M8, M9 | `apps/desktop/test/a-report-that-names-a-conversation.render.test.ts`, and `dom/work-report.dom.test.ts` §6 |
| M10, M11 | `apps/desktop/test/dom/work-report.dom.test.ts` §6 |
| M12, M13 | `apps/desktop/test/a-report-that-names-a-conversation.test.ts` §4 — the wiring census |
| M14, M15 | …the same file's §5, and `idle-truth.test.ts`'s panel-body equality |

⛔ **The table was NOT run.** Every row below was applied ALONE, watched go red against the gate
named above, and restored from bytes with a SHA-256 check — which is what
`verify-each-mutation-row` is for and is not the same claim as a table run.

## ⚠️ What is deliberately NOT here

 - ⛔ **No row on `484` F3 — the ACTOR as a fact on the report.** `WorkReport` still carries no
   `stalledBy`, so the person reads *who stopped it* in the prose and nowhere else. ⚑ That is
   reported as a finding, not built: the notice is composed ONCE (`tellIfNobodyHasYet`) and the
   task row goes on moving, so a pill in the at-a-glance position would widen a divergence the PO
   is already holding a ruling request about.
 - ⛔ **No row that makes `assignedTo` REQUIRED on the wire.** A type-only edit changes no
   behaviour, every test that deletes the key would still pass, and *a mutation that changes
   nothing reports as a survivor*.
 - ⚠️ **No row on `carriedFor` at `runtime-host.ts:5393`.** That is `439 M?`'s line and `439`
   already guards it; pinning one rule in two tables is how a verdict comes to be inherited
   rather than earned.
 - ⚠️ **No row on the `.go-to-conversation` CSS.** The declarations are `places.ts`'s
   `.go-to-project`, to the token, and the dom file measures the two things a person could notice
   — the row's height and the clock's slot. A colour row here would fall back to a state
   indistinguishable at the one width the pane mounts (*a style mutation's control is the state it
   falls back to*).
 - ⛔ **No row on this dispatch's own census regeneration.** *A mutation on a census is invisible
   to that census.*
"""

RAILS = "apps/desktop/src/main/runtime/reply-rails.ts"
LIB = "apps/desktop/src/renderer/src/lib/where-the-work-is.ts"
ENTRY = "apps/desktop/src/renderer/src/components/WorkReportEntry.vue"
VIEW = "apps/desktop/src/renderer/src/components/TranscriptView.vue"
SCREEN = "apps/desktop/src/renderer/src/components/RuntimeScreen.vue"
PANEL = "apps/desktop/src/renderer/src/lib/session-panel.ts"
PANEL_VUE = "apps/desktop/src/renderer/src/components/SessionPanel.vue"
CARD = "apps/desktop/src/renderer/src/components/AgentCard.vue"

MUTATIONS = [
    # ── the field: what the parent's ledger records ─────────────────────────────────────────────
    (
        "M1 · ⛔ the STALL notice goes back to naming the conversation only in its sentence · the "
        "half that never had the id loses it again, so the row a person reads about work that "
        "stopped can be parsed but not pressed — which is the exact state the person photographed",
        # ⚑ Landing D-016b (5e931be8, the tree) · re-anchored in place, not retired — The report
        # must name the conversation the work is with, on the stall half as well as in its sentence.
        # That survives: `workUndriven` still carries `owner: piece.owner`, which replaces the old
        # `assignedTo`. The plant drops it, so the stall notice can be parsed but not pressed.
        # Killed by `a-report-that-names-a-conversation.test.ts`,
        # `finished-and-finished-with-a-question.test.ts`.
        [
            (RAILS, "    owner: piece.owner,\n    state: 'stalled',", "    state: 'stalled',"),
        ],
    ),
    (
        "M2 · ⚠️ the ANSWERED reply drops it too · `relayedFrom` still carries the same id on this "
        "half, so the defect is invisible to anything reading the event and visible only to the "
        "row — which is how one of two reports about one task came to be pressable and the other "
        "not",
        # ⚑ Landing D-016b (5e931be8, the tree) · re-anchored in place, not retired — The answered
        # half of the report must name the conversation as well, and `workAnswered` still carries
        # `owner: piece.owner` (formerly `assignedTo`). The plant drops it. `relayedFrom` still
        # carries the id, so only the row-level owner check sees it. Killed by
        # `a-report-that-names-a-conversation.test.ts`,
        # `finished-and-finished-with-a-question.test.ts`.
        [
            (RAILS, "    owner: piece.owner,\n    state: 'answered',", "    state: 'answered',"),
        ],
    ),
    # ── the fold: what the row may offer ────────────────────────────────────────────────────────
    (
        # ⛔ **RETIRED BY RULING (landing D-017b, 3af91dcb):** The row plants an inverted take-over
        # fork, but D-017b removed the fork on purpose: where-the-work-is.ts no longer imports
        # openingAction and always returns action OPEN_THE_CONVERSATION. The commit says "no Reopen
        # / Take it over / Read the recording presses: one press, 'Open the conversation'", and the
        # killer test now asserts the same press for held and not held. Its anchor is left stale, so
        # the census records it retired.
        "M3 · 🔴 the fork inverts · a conversation this window HOLDS is offered *Take it over and "
        "open it* and one it does not is offered *Open the conversation*, so the one sentence that "
        "discloses an adoption is on the row where no adoption happens",
        [(LIB, "  return { conversation, held: mine, action: openingAction(mine) }", "  return { conversation, held: mine, action: openingAction(!mine) }")],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-017b, 3af91dcb):** `const mine = held.has(conversation)`
        # no longer exists, and neither does the silent-adoption disclosure this row guards. The lib
        # returns `held: held.has(conversation)` only for `data-held` and the words never fork, so a
        # press that "never says it takes over" is now the intended design ("no sentence says
        # whether a process runs"). Its anchor is left stale, so the census records it retired.
        "M4 · ⛔ every row claims to be held · the press never says it takes the conversation over, "
        "which is the silent adoption `taking-over.ts` exists to prevent — *"
        "a control a person has to try rather than predict*",
        [(LIB, "  const mine = held.has(conversation)", "  const mine = true")],
    ),
    (
        "M5 · ⚠️ the surface that cannot answer is treated as one that holds nothing · a recording "
        "in `ReadingPane` grows a press that reaches no runtime at all — `106`, and the difference "
        "between *this window holds none* and *this window cannot say* collapsed into one answer",
        [(LIB, " || held === null) return null", ") return null")],
    ),
    (
        "M6 · ⛔ an empty id becomes a destination · a `.brobot` bundle is written through "
        "`.passthrough()` and `toPersistedEvents` CASTS, so `assignedTo: ''` is bytes rather than a "
        "hypothesis — and the row then offers *take over the conversation called nothing*",
        [(LIB, " || conversation.length === 0", "")],
    ),
    (
        "M7 · 🔴 the words are spelled here instead of asked for · behaviourally identical today "
        "and a second copy of `403`'s fork for ever, which is how two surfaces come to name one "
        "gesture differently — the row exists to prove the census carries that rule rather than "
        "describes it",
        # ⚑ Landing D-017b (3af91dcb) · re-anchored in place, not retired — The rule that the lib
        # asks taking-over.ts for the words instead of spelling them survives. It is now pinned by
        # §4 of a-report-that-names-a-conversation.test.ts, which requires `action:
        # OPEN_THE_CONVERSATION` and forbids `action: 'Open the conversation'`. The plant spells the
        # constant's value inline, which is behaviourally identical and leaves the import unused,
        # and only that census sees it.
        [
            (LIB, 'action: OPEN_THE_CONVERSATION }', "action: 'Open the conversation' }"),
        ],
    ),
    # ── the row: what a person sees ─────────────────────────────────────────────────────────────
    (
        "M8 · ⛔ the press is deleted · the report still names the conversation, as a field, and "
        "the row still will not take anybody there — `506` undone at the surface while every wire "
        "assertion stays green",
        [
            (
                ENTRY,
                "        <button\n          v-if=\"where\"\n          class=\"go-to-conversation\"\n          type=\"button\"\n          data-cy=\"work-report-where\"\n          :data-held=\"String(where.held)\"\n          @click=\"emit('openConversation', where.conversation)\"\n        >\n          {{ where.action }}\n        </button>\n",
                "",
            )
        ],
    ),
    (
        "M9 · ⚠️ the entry invents an answer for a surface that has none · `?? null` becomes `?? "
        "new Set()`, so a recording reads as a window holding nothing and every work report in "
        "`ReadingPane` offers to take a conversation over through a bridge that is not there",
        # ⚑ ANCHOR CORRECTED IN PLACE BY 725 — `701` F-4: the row also hands `workIsWith` the ids
        # the quit left open, as a third argument; the `?? null` this row flips is unchanged.
        # ⚑ Landing D-017b (3af91dcb) · re-anchored in place, not retired — The rule that an absent
        # held prop means 'this surface cannot answer', not 'holds nothing', still holds. D-017b
        # only dropped the third `keptOpen` argument from the call, so the anchor shrinks to
        # `workIsWith(props.item.report, props.held ?? null)`. The plant still puts an Open the
        # conversation press on ReadingPane and ChildWorkViewer, which have no runtime behind them.
        [
            (ENTRY, 'workIsWith(props.item.report, props.held ?? null)', 'workIsWith(props.item.report, props.held ?? new Set())'),
        ],
    ),
    (
        "M10 · ⛔ the transcript stops handing the row what the window holds · the prop is dropped "
        "at the one mount that has a runtime behind it, so the press disappears from the live pane "
        "and survives nowhere — the `canOpenStore` default applied to the case it was not written "
        "for",
        [
            (
                'apps/desktop/src/renderer/src/components/TranscriptView.vue',
                '          :item="row.item"\n          :held="heldIds"\n',
                '          :item="row.item"\n',
            ),
        ],
    ),
    (
        "M11 · ⚠️ absent becomes empty one layer up · `heldIds` stops distinguishing *no answer* "
        "from *holds nothing*, which puts the press back on every read-only transcript by a route "
        "`M9` does not cover — two spellings of one guard, and this is the other one",
        [(VIEW, "  props.held === undefined ? null : new Set(props.held),", "  new Set(props.held),")],
    ),
    # ── the door: what the press actually does ──────────────────────────────────────────────────
    (
        "M12 · 🔴 the press stops claiming · a conversation this window does not hold is selected "
        "without being taken over, so the reader lands on a record that does not exist and "
        "`assertMayAnswer` refuses every card on it — the navigation half of `336`'s door without "
        "the door",
                # ⚑ ANCHOR CORRECTED IN PLACE BY 701 — the refusal arm now opens a conversation the quit
                # left open before it says the refusal, so the block is longer; the defect planted is
                # unchanged: the whole claim block is gone.
        # ⚑ Landing D-017 (45a11477) · re-anchored in place, not retired — The claim-before-navigate
        # rule the row protects moved from goToQuestion (which D-017/557 rewired onto `row.held`
        # instead of `heldHere.value.includes`) to goToTheWork, the sibling function 557 introduced
        # for work-report links. The file's own docblock above goToTheWork explicitly records that
        # 506's M12/M13 went anchor-ambiguous when a near-duplicate body appeared, and that the
        # duplicate copy was since removed — goToTheWork is now the sole match for the row's anchor
        # text.
        # ⚑ Landing D-017b (3af91dcb) · re-anchored in place, not retired — The
        # claim-before-navigate rule survives as the look door: `openConversation` must ask the host
        # to `store.look` a conversation this window is not fed before it shows it. Otherwise the
        # reader lands on a record that does not exist. goToTheWork now just calls
        # `openConversation`, so the plant removes the look there and selects the id directly.
        [
            (SCREEN, 'const opened = store.isLive(sessionId) ? sessionId : await store.look(sessionId)', 'const opened = sessionId'),
        ],
    ),
    (
        "M13 · ⚠️ the view is sampled AFTER the await · a person who pressed ⌘N or went Home while "
        "the claim was in flight has that taken away when it lands, which is the race `095` "
        "measured and `goToQuestion`'s own comment names in as many words",
        # ⚑ Landing D-017 (45a11477) · re-anchored in place, not retired — Same re-target as M12:
        # goToTheWork is 557's second caller of the pattern M13 protects (view() sampled before the
        # await, not after), and it still reads `const from = view()` before `store.claim` and
        # passes `from` (not a re-sampled `view()`) into showConversation. goToQuestion no longer
        # matches this shape at all since it was rewired onto `row.held`.
        # ⚑ Landing D-017b (3af91dcb) · re-anchored in place, not retired — The race rule (sample
        # `view()` before the await, so a person who pressed ⌘N or went Home is not moved back)
        # survives, moved into `openConversation`. That function is now the one door goToTheWork and
        # goToQuestion go through. The plant drops `const from = view()` and samples `view()` at
        # `showConversation` after the look returns.
        [
            (SCREEN, '  const from = view()\n  const opened = store.isLive(sessionId)', '  const opened = store.isLive(sessionId)'),
            (SCREEN, '  showConversation(opened, from)\n  return place.value === null && activeId.value === opened', '  showConversation(opened, view())\n  return place.value === null && activeId.value === opened'),
        ],
    ),
    # ── the word: what the panel promised ───────────────────────────────────────────────────────
    (
        "M14 · ⛔ the empty paragraph promises *running agents* again · the sentence that sent "
        "the person looking for his own agents in a band that lists a provider's sub-agents, six inches "
        "from a rail section headed `Agents` about the other population — `492`'s one word, two "
        "claims, restored. "
        "⚑ ANCHOR CORRECTED IN PLACE BY 577 · the sentence lost its first three nouns to the "
        "heading (`EXT-010` §3.1) and `sub-agents` became its first word, so the anchor is the same "
        "phrase with the capital English gave it. ⛔ The word under test is unchanged and the row "
        "was re-verified RED.",
        [(PANEL, "Running sub-agents, workflows and the checklist", "Running agents, workflows and the checklist")],
    ),
    (
        "M15 · ⚠️ the band's heading goes back to `Agents` · the paragraph and the rows' own "
        "untitled fallback still say *sub-agent*, so one surface names one population two ways and "
        "the most prominent of the three is the wrong one",
        # ⚑ Landing ui batch 1 · re-anchored in place, not retired — `bb5ab496` moved the section
        # list into AgentCard.vue; the heading and the rule are unchanged.
        [(CARD, "label: 'Sub-agents'", "label: 'Agents'")],
    ),
]
