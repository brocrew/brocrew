#!/usr/bin/env python3
"""446 · a proposal is something waiting on him — each row is THE DEFECT, put back (131).

🔴 **A live defect the person found while testing `441`.** He asked BroBot for a weather app; the
proposal card rendered with Approve and No, and then he looked at the rest of the screen:

| the surface said | the measurement |
|---|---|
| ⛔ *"Nothing is waiting"* in the attention panel | zero mentions of `proposal` in `persons-queue.ts` or `attention.ts` |
| ⛔ `Working · using a tool · running mcp__brobot__create_project` | the proposal path emitted no `status` at all |
| ⚠️ *"claude is working — type to queue a message"* | the composer read `panel.waiting`, which counted cards only |

⚑ **`441` and `434` were each right in isolation and neither is at fault.** `434` folded the queue
over the two populations that existed when it was written; `441` refused the question channel on
three measured grounds and was right about all three. ⛔ **What nobody built is the seam** — and
`441` predicted it twice, in `proposals.ts`' header (*"that is a gap and not a design"*) and in
`transcript.ts`' `project_proposed` arm (*"a proposal is visible in the conversation it was made in
and nowhere else"*). Standing rule 14: a prediction inside a response is a finding.

## ⚑ The two rulings these rows are written around

1. 🔴 **The app does not PUBLISH a status; it joins the count.** `042` measured three writers of a
   session's status and `122` removed them, leaving one derivation in `SessionMachine`. `441`'s
   parked call now enters the SAME wait count the permission and question brokers use, through
   `SessionHandle.waitForAPerson` — so the status publishes on the 0 → 1 and 1 → 0 edges exactly as
   it does for a card, and `admitInterrupt`'s `a-person-is-being-asked` rail follows by construction.
2. ⛔ **What is BLOCKED and what is OWED are two facts, and `441`'s bound separates them.** The bound
   releases the CALL and leaves the card answerable, so a proposal is owed long after it stops
   blocking anything. The status carries the first; the queue, the panel and the badge carry the
   second; and the composer reads the status rather than the count because of it.

## 🔴 Which gate can see each row

| rows | the defect is caught by |
|---|---|
| `M1`-`M6` | `apps/desktop/test/everything-a-person-must-answer-is-in-the-queue.test.ts` |
| `M7`-`M11` | `apps/desktop/test/a-proposal-is-something-waiting.test.ts` |
| `M12`-`M16` | `apps/desktop/test/persons-queue.test.ts` |
| `M17`-`M18` | `apps/desktop/test/dom/persons-queue.dom.test.ts` |
| `M19` | `apps/desktop/test/persons-queue.test.ts` |
| `M20`-`M22` | `apps/desktop/test/dom/a-proposal-is-something-waiting.dom.test.ts` |
| `M23`-`M24` | `packages/runtime/test/fake-runtime.test.ts` |
| `M26` | `apps/desktop/test/one-word-and-what-it-drops.test.ts` |
| `M27` | `apps/desktop/test/the-bar-and-the-shelf.test.ts` |

⛔ **The table was NOT run.** Every row below was applied ALONE, watched go red against the gate
named above, and restored from bytes with a SHA-256 check — which is what `verify-each-mutation-row`
is for and is not the same claim as a table run.

## ⚠️ What is deliberately NOT here

⛔ **No row on the digest.** `438` is merged and a proposal is an OBSERVED fact its registers could
carry; this dispatch was told to say so and stop, and a mutation row would be claiming a surface it
did not build.

⛔ **No row that weakens `decideProposal`'s rail or `441`'s verb.** Those are `441`'s and this
dispatch re-opened neither.
"""

PANEL = "apps/desktop/src/renderer/src/lib/session-panel.ts"
LIVE = "apps/desktop/src/renderer/src/lib/attention.ts"
QUEUE = "apps/desktop/src/renderer/src/lib/persons-queue.ts"
FOLD = "apps/desktop/src/renderer/src/lib/transcript.ts"
OFFER = "apps/desktop/src/renderer/src/lib/user-input-offer.ts"
PROPOSAL_OFFER = "apps/desktop/src/renderer/src/lib/proposal-offer.ts"
PANE = "apps/desktop/src/renderer/src/components/ConversationPane.vue"
# ⚑ Landing ui batch 1: `bb5ab496` moved the top agent's sections from SessionPanel.vue into
# AgentCard.vue, list and all; only `M4` reads this.
CARD_LIST = "apps/desktop/src/renderer/src/components/AgentCard.vue"
ROW_WORDS = "apps/desktop/src/renderer/src/components/PersonsQueue.vue"
SCREEN = "apps/desktop/src/renderer/src/components/RuntimeScreen.vue"
HOST = "apps/desktop/src/main/runtime/runtime-host.ts"
STORE = "apps/desktop/src/main/db/session-store.ts"
HANDLE = "packages/runtime/src/runtime.ts"
CLAUDE = "packages/runtime/src/claude/claude-runtime.ts"
FAKE = "packages/runtime/src/fake-runtime.ts"
FACETS = "apps/desktop/src/renderer/src/lib/agent-state.ts"
SHELF = "apps/desktop/src/renderer/src/components/SessionShelf.vue"

MUTATIONS: list[tuple[str, str, list[tuple[str, str, str]]]] = [
    # ── §1 · the seam: a card that waits reaches every surface that counts them ────────────────
    (
        "M1 · 🔴 the fold stops counting a proposal · `441`'s deliberate omission put back, which "
        "is the exact line that made the defect: `attentionQueue` gates on this counter, so a "
        "conversation whose only waiting thing is a proposal is skipped before any walk sees it",
        "node",
        # ⚑ Landing D-016a (bd70d693) · re-anchored in place, not retired (a second reviewer refuted
        # its retirement) — The proposal arm is gone but the rule is not. Every fold arm that pushes
        # a card a person must answer must end in recountPending, or attentionQueue's O(1) gate
        # skips the conversation. The plant drops it from the user_input_request arm, the last card
        # arm before request_resolved. Expected red: the seam test's per-kind userInput case
        # (pending.questions is 0, not 1) and its all-at-once case (sum 1, not 2).
        [
            (FOLD, "      state.requestItems.set(event.id, id)\n      recountPending(state)\n      return\n    }\n\n    case 'request_resolved': {", "      state.requestItems.set(event.id, id)\n      return\n    }\n\n    case 'request_resolved': {"),
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-016a, bd70d693):** `state.proposalItems` and the second
        # walk in `recountPending` were removed; the recount now walks only the request map for
        # permissions and questions. The row's defect ('walks only the request map') is the
        # deliberate present state. Its anchor is left stale, so the census records it retired.
        "M2 · ⛔ the recount walks only the request map · the third counter is always zero, so every "
        "surface that reads `pending` is blind to a proposal while the panel beside it lists one — "
        "two folds of one fact, which is what a full RECOUNT exists to make impossible",
        "node",
        [(FOLD, "  for (const itemId of state.proposalItems.values()) {", "  for (const itemId of new Map<string, string>().values()) {")],
    ),
    (
        "M3 · 🔴 the panel stops counting it as blocked on you · *\"Nothing is waiting\"* is drawn "
        "over a durable creation the person is looking at, the drawer badge stays dark and the Open "
        "tab wears no dot — the sentence the person read, restored",
        "node",
        # ⚑ Landing D-016a (bd70d693) · re-anchored in place, not retired (a second reviewer refuted
        # its retirement) — The rule that the panel's blocked-on-you count sums every population a
        # person must answer survives with two terms. The plant drops the last one, permissions.
        # Expected red: the seam test's per-kind permission case (panel.waiting is 0, not 1) and its
        # all-at-once case, and session-panel.test.ts's waiting assertions (line 115 expects 2 and
        # gets 1, line 326 expects 2).
        [
            (PANEL, 'const waiting = questions.length + permissions.length', 'const waiting = questions.length'),
        ],
    ),
    (
        "M4 · ⛔ the panel lists it nowhere · the row is counted and has no home, so the badge says "
        "one thing is waiting and the column it points at shows nothing — `106` from both ends at "
        "once",
        "node",
        # ⚑ Landing D-016a (bd70d693) · re-anchored in place, not retired (a second reviewer refuted
        # its retirement) — The rule that a counted card has a home in the card's SECTIONS list
        # survives; only the proposals entry is gone. The plant removes the questions entry, so the
        # card is counted by sessionPanel and listed nowhere. Expected red:
        # session-panel.render.test.ts 'names each open thing' (no data-cy="panel-questions") and
        # its per-section facet test.
        [
            (CARD_LIST, "  { key: 'questions', label: 'Questions', cy: 'panel-questions' },\n", ''),
        ],
    ),
    (
        "M5 · ⛔ the live queue's gate reverts to two populations · Home's overview skips a "
        "conversation whose only waiting thing is a proposal, which is the O(1) gate doing exactly "
        "what it is for over a number that no longer means what it says",
        "node",
        # ⚑ Landing D-016a (bd70d693) · re-anchored in place, not retired (a second reviewer refuted
        # its retirement) — The O(1) gate over the pending counters still has to count every
        # population, or Home's overview skips a conversation whose only waiting card is the
        # uncounted kind. The plant drops the last term, questions. Expected red: the seam test's
        # per-kind userInput case (attentionQueue returns 0 rows, expected 1), plus any
        # attention-queue.test.ts case with a question-only conversation. 205 M4 removes the whole
        # gate, which is a different defect.
        [
            (LIVE, '    if (state.pending.permissions + state.pending.questions === 0) continue', '    if (state.pending.permissions === 0) continue'),
        ],
    ),
    (
        "M6 · ⛔ the live walk skips the proposal item · the gate lets the conversation through and "
        "the walk finds nothing in it, so the count and the list disagree about one session",
        "node",
        # ⚑ Landing D-016a (bd70d693) · re-anchored in place, not retired (a second reviewer refuted
        # its retirement) — The walk's item-kind filter is still an enumeration of the kinds a
        # person answers, now two. The plant drops the last, userInput. The gate (pending.questions
        # is 1) lets the conversation through, the walk finds no item, and the count and the list
        # disagree. Expected red: the seam test's per-kind userInput case (attentionQueue length 0,
        # expected 1) and its all-at-once case (1, not 2).
        [
            (LIVE, "      if (item.kind !== 'permission' && item.kind !== 'userInput') continue", "      if (item.kind !== 'permission') continue"),
        ],
    ),
    # ── §2 · the status: the app joins the count rather than publishing one ────────────────────
    (
        "M7 · 🔴 the parked call takes no wait · the conversation reads `working` with a decision in "
        "front of a person, the composer offers to queue a message that answers nothing, and "
        "`admitInterrupt` lets an agent cut in and withdraw the proposal — the whole of the defect",
        "node",
        [(HOST, "    const answered = session.handle.waitForAPerson()", "    const answered = (): void => {}")],
    ),
    (
        "M8 · ⛔ the wait is never released · the session says a person is being asked for the rest "
        "of its life, the stall watchdog stays disarmed and every agent's interrupt is refused by a "
        "rail describing a decision that was taken minutes ago",
        "node",
        [(HOST, "      stopClock()\n      answered()", "      stopClock()")],
    ),
    (
        "M9 · ⚠️ the release stops being idempotent · a second call spends the NEXT waiter's slot, "
        "so the card raised after a proposal fails to publish `waiting_permission` at all — the "
        "silently-unblocked trade `endWait` refuses in the other direction",
        "node",
        [(FAKE, "      if (!held) return\n      held = false\n      this.machine.endWait()", "      held = false\n      this.machine.endWait()")],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-016a, bd70d693):** `shared/proposals.ts`,
        # `PROPOSAL_IS_WAITING` and the store's proposal reader were deleted with proposals
        # (bd70d693); grep finds no `PROPOSAL_IS_WAITING` anywhere. The row's subject was removed on
        # purpose. Its anchor is left stale, so the census records it retired.
        "M10 · ⛔ the store's reader admits an ENDED proposal · a decision a person took an hour ago "
        "is listed as still owed, and *clearing it there clears it everywhere* stops holding ⚑ ANCHOR "
        "CORRECTED IN PLACE BY 453",
        "node",
        [(STORE, "            .filter((proposal) => PROPOSAL_IS_WAITING[proposal.state])", "            .filter((proposal) => proposal.state !== 'stranded')")],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-016a, bd70d693):** `waiting.proposal.proposedBy` and the
        # proposal reader in runtime-host.ts are gone with proposals. The surviving
        # `decisionReading(request.askedBy, name)` already takes the asker's conversation id, so the
        # 'profile slug instead of conversation' defect does not exist there. Its anchor is left
        # stale, so the census records it retired.
        "M11 · 🔴 the reader names the AGENT rather than the conversation · the row's one hop is a "
        "profile slug, so the button takes a person to a conversation id that does not exist and the "
        "sentence names a thing that cannot be waiting",
        "node",
        [(HOST, "      const reading = decisionReading(waiting.session, name)", "      const reading = decisionReading(waiting.proposal.proposedBy, name)")],
    ),
    # ── §3 · the queue: one list, one order, one count over three populations ─────────────────
    (
        "M12 · ⛔ the view drops the third population · the reader answers, the rows exist and the "
        "queue draws two of three — an omission, which is the direction criterion 17 costs most in ⚑ "
        "ANCHOR CORRECTED IN PLACE BY 453",
        "node",
        # ⚑ Landing D-016a (bd70d693) · re-anchored in place, not retired (a second reviewer refuted
        # its retirement) — The rule that the view draws every population its reads returned
        # survives with two populations (asked and settled). The plant makes the decisions read
        # return rows that the view never draws, which is the omission direction. Expected red: the
        # persons-queue.test.ts case 'a refusal on one population draws the other' (count 0, not 1,
        # and rows [] not ['a-decision']), and the seam test's a-decision ONE_OF_EACH case.
        [
            (QUEUE, '  const settled = decisionsForAPerson?.rows ?? []', '  const settled: readonly PersonsDecision[] = []'),
        ],
    ),
    (
        "M13 · 🔴 the tie-break reverts to a ternary · `compare(proposal, escalated)` and "
        "`compare(escalated, proposal)` both answer 1, so the order is not total and the list "
        "re-orders itself between two five-second looks",
        "node",
        [(QUEUE, "    return BLOCKED_ORDER_OF_KIND[left.kind] - BLOCKED_ORDER_OF_KIND[right.kind]", "    return left.kind === 'a-decision' ? -1 : 1")],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-016a, bd70d693):** The proposal row's `'proposed'`
        # instant argument is gone from persons-queue.ts along with the `a-proposal` kind. The card
        # says proposals go, so the field whose spelling this row guarded is removed. Its anchor is
        # left stale, so the census records it retired.
        "M14 · ⛔ a proposal's instant is spelled `routed` · the surface says *waiting since* about a "
        "row with no routing behind it, which is the app's own word used for the opposite of what the "
        "app means by it — the second meaning `403`'s review refused for this exact field",
        "node",
        [(QUEUE, "        'proposed',\n        one.work,", "        'routed',\n        one.work,")],
    ),
    (
        "M15 · ⛔ `partial` stops watching the third read · a proposal list that never answers reads "
        "as an all-clear, and *\"nothing is waiting on you\"* is drawn out of a dropped IPC call",
        "node",
        # ⚑ Landing D-016a (bd70d693) · re-anchored in place, not retired (a second reviewer refuted
        # its retirement) — partial still watches each read for never having answered. The plant
        # drops the decisions term, so a decisions list that never answers reads as an all-clear. No
        # other row plants partial, so the rule is not carried elsewhere. Expected red:
        # persons-queue.test.ts 'a refusal on one population draws the other, and discloses the
        # hole' (noDecisions.partial is false, expected true), and the both-holes case in section
        # 9.4 for the questions-null variant is unaffected.
        [
            (QUEUE, '  const partial = questionsForAPerson === null || decisionsForAPerson === null', '  const partial = questionsForAPerson === null'),
        ],
    ),
    (
        "M16 · ⚠️ `stale` stops watching it too · a read that ANSWERED once and has been failing "
        "since is drawn from that minute with nothing saying so — `434`'s reachable hole, reopened "
        "for the one population where nothing else can pick the row up",
        "node",
        # ⚑ Landing D-016a (bd70d693) · re-anchored in place, not retired (a second reviewer refuted
        # its retirement) — stale still watches each read's last-answered flag. The plant drops the
        # decisions term, so a decisions read that answered once and has failed since is drawn with
        # no disclosure. Expected red: persons-queue.test.ts section 9.4 'at zero rows a stale list
        # may not say nothing is waiting' (heading is 'Nothing is waiting on you', not 'One list has
        # stopped answering'). The questions:false cases stay green, so the plant is per-read.
        [
            (QUEUE, '  const stale = !world.lastLookAnswered.questions || !world.lastLookAnswered.decisions', '  const stale = !world.lastLookAnswered.questions'),
        ],
    ),
    # ── §4 · the words a person reads, and the gesture they press ─────────────────────────────
    (
        # ⛔ **RETIRED BY RULING (landing D-016a, bd70d693):** The `'a-proposal'` kind and its
        # row-claim sentence ("Nothing exists until you decide.") are deleted from persons-queue.ts;
        # proposals were removed end to end in bd70d693. The defect swaps one proposal sentence for
        # another, and neither exists. Its anchor is left stale, so the census records it retired.
        "M17 · ⛔ the row's claim becomes a decision's · *\"These never travelled to anybody else\"* "
        "is true of a proposal and is about the wrong thing: nothing travelled because nothing was "
        "MADE, and a person reads that as work already running",
        "node",
        [(QUEUE, "  'a-proposal': 'Nothing exists until you decide.',", "  'a-proposal': 'These never travelled to anybody else.',")],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-016a, bd70d693):** The `{ kind: 'proposal' }` member of
        # `AttentionDecision` and its `isRefusal` arm were deleted in bd70d693 (diff of
        # user-input-offer.ts). `isRefusal` now covers only reject, answer, approve and permission
        # outcomes, so 'No on a proposal stops reading as a refusal' cannot occur. Its anchor is
        # left stale, so the census records it retired.
        "M18 · 🔴 No stops reading as a refusal · `isRefusal` falls through and the negative gesture "
        "is drawn as the loud button on the queue while the card beside it draws it quietly — two "
        "surfaces describing one gesture two ways, which is `214` §3",
        "node",
        [(OFFER, "  if (decision.kind === 'proposal') return !decision.approve", "  if (decision.kind === 'proposal') return false")],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-016a, bd70d693):** `proposal-offer.ts` was deleted
        # (count_now -1) along with `PROPOSAL_REFUSE` and the proposal offer; proposals and their
        # decision surfaces are removed by D-016a. Its anchor is left stale, so the census records
        # it retired.
        "M19 · ⛔ the queue offers only Approve · a person can create what was proposed from the "
        "summons and cannot decline it there, so the one surface built for *clearing it there* can "
        "only ever clear it one way",
        "node",
        [(PROPOSAL_OFFER, "    { kind: 'proposal', label: PROPOSAL_REFUSE, approve: false },", "")],
    ),
    # ── §5 · the composer, and the two facts it must not fold into one ───────────────────────
    (
        "M20 · 🔴 the composer stops reading the status · *\"claude is working — type to queue a "
        "message\"* comes back over a conversation whose call is parked on a person — the sentence "
        "from the defect, restored",
        "node",
        [(PANE, "  if (control.value.status === 'waiting_permission') return 'frozen'\n", "")],
    ),
    (
        "M21 · ⛔ the composer reads the OWED count instead · a proposal left undecided past its "
        "bound holds the box shut under *\"The agent is frozen\"* while the agent is demonstrably "
        "working, which is the fold `441`'s bound made false",
        "node",
        [(PANE, "  if (panel.value.permissions.length + panel.value.questions.length > 0) return 'frozen'", "  if (panel.value.waiting > 0) return 'frozen'")],
    ),
    (
        "M22 · ⚠️ the panel's empty paragraph goes short a third time · it enumerates what appears "
        "*\"while it is open\"* and stops naming the population that does — the sentence `250` and "
        "`258` each found false, for the same reason a third time. "
        "⚑ ANCHOR CORRECTED IN PLACE BY 506 · the same sentence, one word truer: the band lists "
        "PROVIDER sub-agents and said `agents`, which is the reading that sent the person looking for "
        "his own here. The row is unchanged — it still drops `proposals, ` — and was re-verified RED. "
        "⚑ ANCHOR CORRECTED IN PLACE AGAIN BY 577 · `EXT-010` §3.1 moved the three COUNTED nouns "
        "into the heading, which now says what the column counts, so the body names only what is "
        "HAPPENING — and `577` found that list had been short of `workflows` since `108`. The row "
        "is the same defect on the same sentence: it drops one population that does appear here. "
        "⛔ Re-verified RED against `idle-truth.test.ts`, not carried on the verdict it earned "
        "against the old shape.",
        "node",
        [(PANEL, "    body: 'Running sub-agents, workflows and the checklist appear here too, while they are open.',", "    body: 'Running sub-agents and the checklist appear here too, while they are open.',")],
    ),
    # ── §6 · the runtime seam ─────────────────────────────────────────────────────────────────
    (
        "M23 · ⛔ the app's park publishes nothing · `beginWait` is skipped, so the one derivation "
        "`122` left standing never hears about it and every reader of the status is back where "
        "`441` left them",
        "node",
        [(FAKE, "    this.machine.beginWait()\n    let held = true", "    let held = true")],
    ),
    (
        "M24 · 🔴 the app's release clears the whole count · a card open underneath is silently "
        "unblocked, so a session frozen on a real permission reports itself free the moment the app "
        "lets go of a proposal — `042`'s three writers, arriving from outside the package",
        "node",
        [(FAKE, "      held = false\n      this.machine.endWait()", "      held = false\n      while (this.machine.waiting > 0) this.machine.endWait()")],
    ),
    (
        "M26 · ⛔ a proposal stops summoning attention · the ONE place the closed set is written "
        "loses its third member, so the plate, the rail's word, the shelf's attention row and the "
        "priority dot all go quiet together about a decision a person is looking at — which is the "
        "whole of `063`/`079` §5's guarantee broken from the one line that states it",
        "desktop",
        # ⚑ Landing D-016a (bd70d693) · re-anchored in place, not retired (a second reviewer refuted
        # its retirement) — summonsAttention is still the one place the closed set is written, with
        # two members. The plant drops its last member, question. The row's own gate does go red:
        # its blocking slice still includes needing 'question', and standingOf reaches 'waiting'
        # through armFactsOf.needsYou, which reads summonsAttention. So question facets with no
        # waiting-on-a-person wait no longer read 'waiting' (the mapped gate needs no remapping).
        # The pins in the-bar-and-the-shelf (summonsAttention('question') is false) and the-heading
        # (NEEDINGS.filter(summonsAttention) no longer equals the counted set) go red too.
        [
            (FACETS, "  return needing === 'permission' || needing === 'question'", "  return needing === 'permission'"),
        ],
    ),
    (
        "M27 · ⚠️ the shelf decides for itself again · the attention row re-grows its own copy of "
        "the closed set, which is the state `446` found this app in: two spellings of one rule, in "
        "step only for as long as nobody adds a member — and `441` added one",
        "desktop",
        [(SHELF, "  return needing !== undefined && summonsAttention(needing) ? NEEDING_WORD[needing] : null", "  return needing === 'permission' || needing === 'question' ? NEEDING_WORD[needing] : null")],
    ),
    (
        "M25 · 🔴 the release ABANDONS the wait instead of ending it · the count comes down and "
        "nothing publishes, so the session says a person is being asked for ever — `abandonWait` is "
        "the exit taken when a session is SHUTTING DOWN, where not publishing is the entire point, "
        "and taking it on an ordinary release is that judgement applied to the wrong moment",
        "runtime",
        [(FAKE, "      held = false\n      this.machine.endWait()", "      held = false\n      this.machine.abandonWait()")],
    ),
]
