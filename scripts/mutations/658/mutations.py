"""658 · A message from outside says whom it is to.

⚑ **the person, 2026-09-23:** *"when an agent talks to an agent and it shows in the conversation, we need
to write "Ada to Brobot" for example, and make it into a discreet card that is a bit shifted to the
right. it shows that this is an incoming message from outside the conversation. regarding the task
messages, they should be inside a card."* — then *"mcp__brobot__reply_to_parent should not be
displayed as the other mcp tools. it should be a card specific to reply to parent."* and *"same for
message_agent"*.

## 🔴 What the dispatch decided, and therefore what has to be killable

 * **Whose words a row carries** — `from-outside.ts`: a relay always, a work report or a held row
   only when it was RELAYED (named or not), never from the text.
 * **Which rows are cards, and which cards are shifted** — every row from outside and every task row
   is a card; only rows from outside are shifted, and past where the conversation's words begin.
 * **"Ada to BroBot"** — sender, the one word, and the conversation's own agent.
 * **The two messaging calls** — recognised by THIS session's naming and declared server; the host's
   row landed on the call whose own `agent`/`task_id` argument names it, or the one call left
   waiting — never a guess, never a call its arguments contradict, never a dead call once a newer
   one exists, never the parent's call for a sub-agent's row; never a line in a run; a card that
   never names BroBot for a recipient it does not know, never prints a handle, never says
   *delivered* over a lost reply, and draws LESS — never a crash — from a replayed row it cannot
   trust.
 * **Held is dashed** — `077`'s grammar, moved onto the card's edge now that no card has an avatar.

## The rows

 * `M1`–`M3` 🔴 the classification, each reaching the screen through the entry that asks it: a relay
   no longer shifted; every report shifted (the stall is the app's own words); task rows out of
   their card.
 * `M4`–`M6` 🔴 the layout: no shift; a shift that stops where the words begin; a card with no
   hairline. ⛔ **Only the DOM runner can kill these** — they change paint, not any value a fold
   returns.
 * `M7`, `M8`, `M9` ⚑ the headings: a recipient spelled as the sender, on each of the three entries,
   and `M9` the missing space the DOM test found (*"Adato BroBot"*).
 * `M10` ⛔ the fold drops the relayer on a reply again — the defect `658` found in its own diff.
 * `M11`–`M16` 🔴 the messaging calls: recognition by name alone; a guess on two open calls; a row
   held ahead that survives the receipt of a call before the window; a row held ahead cleared by an
   UNRELATED receipt (the slow-reader race); `markUndelivered` blind to the row held ahead; the card
   joining a run.
 * `M17`–`M21` ⚑ the reading: `agentName(null)` for an unnamed recipient; *delivered* before the
   call has answered; a lost reply read as delivered; a held message read as sent; a cut excerpt
   read as whole.
 * `M22` ⚑ an outgoing card shifted as though it had arrived from outside.
 * `M23`–`M26` 🔴 the pairing `658`'s review asked for: the arguments ignored (a parallel batch
   names nobody); a contradicting call kept as a candidate; a dead call that never stops waiting;
   a sub-agent's call left out, so its row lands on the parent's card.
 * `M27` ⚑ a held card drawn solid. `M28` 🔴 a receipt that prints its `sess_` handle. `M29` ⚑ a
   failed call read as answered.
 * `M30`, `M31` ⚠️ replay taken on trust: a prototype-member kind printed as a function; a lost reply
   with no reason read as delivered.

## ⛔ What this table cannot reach

 * ⚠️ **No row changes `--line` or `--wash-1` in `tokens.css`.** They are shared tokens every card in
   the app paints with; `M6` removes this card's use of them instead.
 * ⚠️ **No row for the `turn` boundary or the sub-agent receipt clearing a row held ahead.** Each is
   one of three expiries; `M13` kills the one a live ledger reaches first (a call before the
   retained suffix), and the boundary is `stopOpenToolCalls`, shared with every tool row.

## ⚑ WRITTEN, not run as a table

⛔ **Writing rows is routine, RUNNING a table is rare and deliberate.** Each row was verified RED
individually — one row, its killer file, restore-from-bytes — and no `mutations.txt` exists.
"""

from __future__ import annotations

LIB = "apps/desktop/src/renderer/src/lib"
COMPONENTS = "apps/desktop/src/renderer/src/components"
TRANSCRIPT = "apps/desktop/src/renderer/src/lib/transcript.ts"
OUTGOINGENTRY = "apps/desktop/src/renderer/src/components/OutgoingEntry.vue"

FROM_OUTSIDE = f"{LIB}/from-outside.ts"
TRANSCRIPT = f"{LIB}/transcript.ts"
TOOL_RUNS = f"{LIB}/tool-runs.ts"
CARD = f"{LIB}/outgoing-card.ts"
EXCERPT = f"{LIB}/argument-excerpt.ts"
OUTSIDE_CARD = f"{COMPONENTS}/OutsideCard.vue"
RELAYED = f"{COMPONENTS}/RelayedEntry.vue"
REPORT = f"{COMPONENTS}/WorkReportEntry.vue"
QUEUED = f"{COMPONENTS}/QueuedMessage.vue"
OUTGOING = f"{COMPONENTS}/OutgoingEntry.vue"

MUTATIONS: list[tuple[str, list[tuple[str, str, str]]]] = [
    (
        "M1 · 🔴 **a relay drawn as if it were the conversation's own** · `fromOutside` answers `null` "
        "for a relayed turn, so `RelayedEntry` stops shifting it — another conversation's words in line "
        "with the person's, the false claim `658` exists to end",
        [
            (
                FROM_OUTSIDE,
                "    case 'relayed':\n      return { sender: item.relayedFromProfile }\n",
                "    case 'relayed':\n      return null\n",
            )
        ],
    ),
    (
        "M2 · ⛔ **every report shifted** · a STALL notice — the app's own words about a child, relayed "
        "by nobody — is drawn as arriving from outside",
        [
            (
                FROM_OUTSIDE,
                "    case 'workReport':\n"
                "      return item.relayed === true ? { sender: item.relayedFromProfile } : null\n",
                "    case 'workReport':\n      return { sender: item.relayedFromProfile }\n",
            )
        ],
    ),
    (
        "M3 · 🔴 **task rows out of their card** · `inACard` stops saying a report is carded, so "
        "`WorkReportEntry` draws a report nobody relayed bare — *\"regarding the task messages, they "
        "should be inside a card\"*, unmet",
        [(FROM_OUTSIDE, "  if (item.kind === 'workReport') return true\n", "")],
    ),
    (
        "M4 · 🔴 **no shift** · the incoming card begins where the person's row begins — a card, but "
        "not *\"a bit shifted to the right\"*. ⛔ Only a measured left edge sees it",
        [
            (
                OUTSIDE_CARD,
                "  margin-left: calc(var(--avatar) + var(--space-5) + var(--space-10));\n",
                "  margin-left: 0;\n",
            )
        ],
    ),
    (
        "M5 · ⚠️ **a shift that stops where the words begin** · the card lines up with a participant's "
        "TEXT, so it reads as that participant's paragraph rather than as arriving from the side",
        [
            (
                OUTSIDE_CARD,
                "  margin-left: calc(var(--avatar) + var(--space-5) + var(--space-10));\n",
                "  margin-left: calc(var(--avatar) + var(--space-5));\n",
            )
        ],
    ),
    (
        "M6 · ⚑ **a card with no hairline** · the frame is gone and the wash alone is the card — "
        "discreet enough to be invisible. ⛔ Only a COMPUTED border sees it",
        # ⚑ **theme host · re-anchored in place, not retired** — NOT VERIFIED. Theme border widths now use tokens; the same defect retains all other declarations.
        [(OUTSIDE_CARD, "  border: var(--border-width) solid var(--line);\n", "  border: 0;\n")],
    ),
    (
        "M7 · 🔴 **the relay's recipient spelled as its sender** · *\"Ada to Ada\"* — the half of the "
        "heading `658` added, gone",
        [
            (
                RELAYED,
                # ⚑ **667 re-anchored and the ROW is unchanged** — the recipient is `recipient`,
                # the name the card is handed or *this conversation* (`658`'s G4).
                # ⚑ **source-restoration · re-anchored in place, not retired** — NOT VERIFIED; source targeting only. 89ee4f806 moved recipient words to the exchange heading; change only the relayed recipient to its sender.
                "            from: sender,\n            to: recipient,",
                "            from: sender,\n            to: sender,",
            )
        ],
    ),
    (
        "M8 · ⚑ **the reply's recipient spelled as its sender** · the same defect on the work report's "
        "from-line",
        [
            (
                REPORT,
                # ⚑ **667 re-anchored and the ROW is unchanged** — the recipient is `ownAgent` or
                # *this conversation* (`658`'s G4), and it wrapped.
                # ⚑ **source-restoration · re-anchored in place, not retired** — NOT VERIFIED; source targeting only. 89ee4f806 moved recipient words to the exchange heading; change only the work-report recipient to its sender.
                # ⚑ Re-anchored in place, NOT VERIFIED — the reply's heading moved from the template
                # into the card's computed head line; the mutant still names the sender as its recipient.
                "        from: sender.value,\n        to: props.ownAgent ?? THIS_CONVERSATION,",
                "        from: sender.value,\n        to: sender.value,",
            )
        ],
    ),
    # RETIREMENT APPROVED — 658 M9: anchor-absent; removed by 89ee4f80690d2a474e5e4505df13da59089351a5.
    # The queued row's TO_WORD interpolation and its whitespace-condensing template were removed.
    # Recipient naming now arrives in OutsideCard's separately composed arrow heading, whose spaces do not
    # depend on this Vue template node. The old Adato defect's guarded mechanism is gone. Targeting the
    # shared heading would additionally mutate unrelated exchange kinds. Definition retained as historical
    # evidence; no row execution.
    (
        "M9 · ⚠️ **the missing space** · the held row's heading reads *\"Adato BroBot\"* — the defect the "
        "DOM test found, because a template block's leading whitespace is condensed away",
        [
            (
                QUEUED,
                ">{{ ' ' + TO_WORD + ' '\n",
                ">{{ TO_WORD + ' '\n",
            )
        ],
    ),
    (
        "M10 · ⛔ **the fold drops the relayer on a reply again** · the event carries it and the report "
        "is built without it, so a child's answer is drawn as the app's own report",
        [
            (
                TRANSCRIPT,
                # ⚑ **source-restoration · re-anchored in place, not retired** — NOT VERIFIED; source targeting only. The relayer object gained navigation identity; passing null still removes the relayer from a reply.
                "          wasRelayed(event.relayedFrom)\n            ? {\n                relayedFromProfile: relayerIdentity(event.relayedFromProfile),\n                relayedFrom: event.relayedFrom,\n              }\n            : null,\n",
                "          null,\n",
            )
        ],
    ),
    (
        "M11 · 🔴 **recognised by the tool name alone** · a foreign server's `message_agent` is drawn as "
        "a message this conversation sent",
        [
            (
                TRANSCRIPT,
                # ⚑ **source-restoration · re-anchored in place, not retired** — NOT VERIFIED; source targeting only. The refusal-receipt reader now shares the server guard. Scope to the outgoing tool reader and preserve its declared-tool check.
                "  if (split === null || split.server !== set.declared.server) return null\n  if (!set.declared.tools.some((tool) => tool.name === split.tool)) return null\n",
                "  if (split === null) return null\n  if (!set.declared.tools.some((tool) => tool.name === split.tool)) return null\n",
            )
        ],
    ),
    (
        "M12 · ⛔ **a guess on two open calls** · the host's row lands on the first of a parallel batch, "
        "so one card can name the other call's recipient",
        [
            (
                TRANSCRIPT,
                "  const chosen = named.length === 1 ? named[0] : open.length === 1 ? open[0] : undefined\n",
                "  const chosen = named.length === 1 ? named[0] : open.length >= 1 ? open[0] : undefined\n",
            )
        ],
    ),
    (
        "M13 · ⛔ **a row held ahead survives a call before the window** · a later message call claims "
        "a row that was written for a call the retained suffix does not show",
        [
            (
                TRANSCRIPT,
                "      // that landed ahead was that call's, so no later call may claim it.\n"
                "      state.outgoingAhead = []\n",
                "      // that landed ahead was that call's, so no later call may claim it.\n",
            )
        ],
    ),
    (
        "M14 · ⚠️ **a row held ahead cleared by an UNRELATED receipt** · the slow-reader race: the "
        "handler wrote the row while an earlier call's receipt was still unread, and the card loses it",
        [
            (
                TRANSCRIPT,
                "    case 'tool_result': {\n",
                "    case 'tool_result': {\n      state.outgoingAhead = []\n",
            )
        ],
    ),
    (
        "M15 · ⚑ **`markUndelivered` blind to the row held ahead** · both rows written before the call "
        "row, and the card says *delivered* over a lost reply",
        # ⚑ Landing D-016b (5e931be8, the tree) · re-anchored in place, not retired — The rule
        # survives: a reply_to_parent that reached nobody says so on its card even when the words
        # are still ahead in state.outgoingAhead. transcript.ts markUndelivered still walks
        # outgoingAhead for a reply naming the piece. The plant iterates an empty list instead, so
        # the ahead fold never marks undelivered. Anchored on the two-line loop head, because a
        # second outgoingAhead loop exists. Killed by
        # `a-call-that-speaks-to-another-conversation.test.ts`.
        [
            (TRANSCRIPT, "  for (const words of state.outgoingAhead) {\n    if (words.tool === 'reply_to_parent' && words.reply?.piece === piece) {\n", "  for (const words of [] as OutgoingWords[]) {\n    if (words.tool === 'reply_to_parent' && words.reply?.piece === piece) {\n"),
        ],
    ),
    (
        "M16 · 🔴 **the card joins a run** · a settled message call is folded into a quiet line of "
        "tool calls — *\"should not be displayed as the other mcp tools\"*, unmet",
        # ⚑ W4.68 (D-047's new-brief card) · re-anchored in place: the guard now asks `drawsAsACard`,
        # the one question every surface asks of a call; the plant still drops it.
        [(TOOL_RUNS, "  if (drawsAsACard(item)) return false\n", "")],
    ),
    (
        "M17 · ⛔ **`agentName(null)` for an unnamed recipient** · a message to a conversation with no "
        "identity row is headed *\"<sender> to BroBot\"* — the default profile's name, for a recipient "
        "nobody named",
        [
            (
                CARD,
                "          : sent.toProfile === null\n",
                "          : false\n",
            )
        ],
    ),
    (
        "M18 · 🔴 **delivered before the call has answered** · the host writes `reply_undelivered` "
        "before the answer, so *delivered* read off the reply row alone is a claim nobody can make yet",
        [
            (
                CARD,
                "    if (item.result !== null) return item.result.ok ? 'delivered' : 'failed'\n",
                "    return 'delivered'\n",
            )
        ],
    ),
    (
        "M19 · ⛔ **a lost reply read as delivered** · `reply_undelivered` ignored — the one failure "
        "mode the PO named as having no signal, drawn as a success",
        [(CARD, "    if (words.reply.undelivered !== undefined) return 'not-delivered'\n", "")],
    ),
    (
        "M20 · ⚑ **a held message read as sent** · `message_sent.delivery` ignored",
        [
            (
                CARD,
                "words.sent?.delivery === 'queued') return 'held'\n",
                "words.sent?.delivery === 'queued') return 'sent'\n",
            )
        ],
    ),
    (
        "M21 · ⚑ **a cut excerpt read as whole** · the card stops saying the message was cut at the "
        "call's 200-character bound",
        [(EXCERPT, "  return { text, cut: true }\n", "  return { text, cut: false }\n")],
    ),
    (
        "M22 · ⚠️ **an outgoing card shifted** · the conversation's own agent speaking is drawn as "
        "arriving from outside",
        # ⚑ Landing ui bb5b9b7e…128203e6 (UI-009 to UI-011) · re-anchored in place, not retired —
        # UI-009 added a second OutsideCard (the question frame) to OutgoingEntry.vue, so
        # `:shifted="false"` now occurs twice and the old anchor is no longer unique. The rule
        # survives: a call of the conversation's own agent is a card that is NOT shifted. The plant
        # is re-anchored with the `v-else-if="card"` context so it hits the message, reply and give
        # frame once. Killed by `an-incoming-message-says-whom-it-is-to.dom.test.ts`.
        [
            (OUTGOINGENTRY, '    v-else-if="card"\n    class="outgoing"\n    :shifted="false"\n', '    v-else-if="card"\n    class="outgoing"\n    :shifted="true"\n'),
        ],
    ),
    (
        "M23 · 🔴 **pairing ignored** · a row lands on a call only when it is the one call waiting, so "
        "a parallel batch — BroBot messaging two agents at once — leaves both cards naming nobody",
        [
            (
                TRANSCRIPT,
                "  const chosen = named.length === 1 ? named[0] : open.length === 1 ? open[0] : undefined\n",
                "  const chosen = open.length === 1 ? open[0] : undefined\n",
            )
        ],
    ),
    (
        "M24 · ⛔ **a call its arguments contradict stays a candidate** · a row for Bea lands on the one "
        "waiting call that was addressed to Ada",
        [
            (
                TRANSCRIPT,
                "    (call) => pairing(call.summary, words) !== 'mismatch',\n",
                "    (call) => pairing(call.summary, words) !== 'match' || true,\n",
            )
        ],
    ),
    (
        "M25 · ⚠️ **a dead call never stops waiting** · a call whose turn died stands beside every later "
        "call of its tool, and every later row becomes a tie — the review's repro",
        [
            (
                TRANSCRIPT,
                "      if (item.result !== null || (item.unfinished === true && item !== newest)) return false\n",
                "      if (item.result !== null) return false\n",
            )
        ],
    ),
    (
        "M26 · ⛔ **a sub-agent's call is not a candidate** · its row lands on the parent's own call, "
        "naming a recipient the parent never wrote to",
        [
            (
                TRANSCRIPT,
                # ⚑ W4.68 · re-anchored in place: the call now hands `row.summary` too.
                "      if (outgoingToolOf(state, row.name, row.summary) === tool)\n"
                "        waiting.push({ summary: row.summary, item: null })\n",
                "",
            )
        ],
    ),
    (
        "M27 · ⚑ **a held card is solid** · the held row looks delivered — `077`'s *\"visibly a "
        "different thing\"*, lost on the card. ⛔ Only a computed border style sees it",
        [(OUTSIDE_CARD, "  border-style: dashed;\n", "  border-style: solid;\n")],
    ),
    (
        "M28 · 🔴 **a receipt prints its handle** · *\"sess_… was idle\"* on a card a person reads — a "
        "fourth sentence of the kind `624` §6 found three of",
        # ⚑ **source-restoration · re-anchored in place, not retired** — NOT VERIFIED; source targeting only. da8badc3b keeps full refused receipt text; preserve it while omitting only the handle scrubber.
        [(CARD, "      ? withoutHandles(wholeReceipt(item.result.summary, item.told))\n", "      ? wholeReceipt(item.result.summary, item.told)\n")],
    ),
    (
        "M29 · ⚑ **a failed call read as answered** · a thrown handler draws the same silent card as a "
        "refusal, with no failure word",
        [(CARD, "    return item.result.ok ? 'answered' : 'failed'\n", "    return 'answered'\n")],
    ),
    (
        "M30 · ⚠️ **a replayed kind taken on trust** · `kind: 'constructor'` indexes `MESSAGE_KIND_WORD`'s "
        "prototype and the card prints a function",
        [
            (
                TRANSCRIPT,
                # ⚑ **source-restoration · re-anchored in place, not retired** — NOT VERIFIED; source targeting only. The message_sent object moved two spaces left; keep the same field omission or trust-boundary bypass.
                "        kind: isAgentMessageKind(event.kind) ? event.kind : null,\n",
                "        kind: event.kind,\n",
            )
        ],
    ),
    (
        "M31 · ⛔ **a lost reply with no reason read as delivered** · `reply_undelivered` without "
        "`because` stores nothing, and the card says *delivered*",
        [
            (
                TRANSCRIPT,
                "isAnId(event.because) ? event.because : 'not-delivered')",
                "event.because)",
            )
        ],
    ),
]
