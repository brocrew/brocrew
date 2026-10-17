"""614 · What the child actually said — each row is THE DEFECT, put back verbatim (131).

⛔ **What this dispatch added, and what it did NOT.** `HO-088` §5.2: *"When a turn ends with its
task still OPEN, the parent is told what the child last SAID — not that it is idle."* ⚑ The stall
notice has carried what the ENGINE observed since `400`; what it never carried is the child's own
words, and `HO-092` §3 is the measurement — a header reading `Idle`, an avatar reading `idle`, a
task card reading `not being worked on`, and on the same screen *"I'm still holding on your answers
to the six trip questions… whenever you're ready."*

⚠️ **Nothing on that screen was FALSE**, which is why no row here is a repair of a lie.
`openQuestionsByWork` folds rows the question TOOL writes; the agent asked in prose, so no row
existed. 🔴 **Every row below puts back a state in which the app CARRIES LESS, or carries it with a
claim attached that this app has no standing to make.**

## 🔴 The line none of these rows crosses — and one of them tries to

⛔ **`00-backlog.md` D17 / `HO-088` §5.1, permanent: the app does NOT detect questions in prose.**
⚑ `M2` is that ruling's own mutant: a lead line that says the child *is asking about this work*,
which is the inference D17 refuses, and it is killed by §5 — the section that exists because a
promise not to infer is worth nothing until it is measured.

## 🔴 Which section kills each row — MEASURED, one row at a time

⛔ **Every row below was applied ALONE, run against the file named beside it, and restored from the
original bytes** (`verify-each-mutation-row-without-running-the-table`). ⚠️ The killers are what the
run printed, not where the code lives.

| rows | killed by |
|---|---|
| `M1` `M2` | ⚑ **§3**, **§4** and **§5** — the whole notice, the clip's own lines, and the byte-identity across six contents. ⛔ Both rows edit the ONE composition every surface uses, so every section that renders it goes red |
| `M3` `M13` `M14` | ⚑ **§3** alone — the report a parent RECEIVES, quoted whole, for all three answers |
| `M4` `M5` `M6` | ⚑ **§4** alone — the cut: declared, measured before the slice, and not at the boundary |
| `M7` `M8` `M10` | ⚑ **§2** alone — WHICH event kind, and whose words they are |
| `M9` | ⚑ **§1** and **§3** — the two absences are different facts, asked of the read and of the notice |
| `M11` `M12` | ⚑ **§1** alone — the last ENDED turn, and its LAST run |

⚠️ **Eleven of the fourteen are killed by ONE section**, which is what makes the table a
measurement rather than a suite-wide smoke test: each of those rows names a rule that exactly one
group of assertions is about.

⚑ **All of them in `apps/desktop/test/what-the-child-actually-said.test.ts`.**

## ⚠️ What this table deliberately does NOT contain

⛔ **No row on `activeGeneration`.** ⚑ Every reader in `session-store.ts` is scoped the same way
and `whatItLastSaidIn` is scoped with them; a row here would need a re-derived conversation to tell
the two readings apart, and this suite builds none — `a-line-no-mutation-can-kill-is-not-carrying-
its-rule`, refused before it was written rather than found by its own survival.

⛔ **No row removing the `lines.push(...whatItLastSaidLines(…))` call outright.** ⚠️ That mutant
leaves `lastWords` unused, so its red comes from `tsc` and not from the product — `414 M24`'s
*"a red that proves nothing"*. ⚑ **`M1` is how the same defect is measured instead**: it compiles,
it reads the value, and it reports *said nothing at all* about a conversation that spoke.

⛔ **No row on `WorkReport`.** ⚑ This dispatch put no field there, deliberately — the words are the
notice's own body and `WorkReportEntry.vue` prints that string verbatim — so there is nothing here
for a row to hold in place. ⚠️ §6 asserts the report's key set instead, which is the guard that
would go red if a later dispatch added one without deciding to.

## ⚠️ T-003 · after D-012 (`3ff53f05`) and D-013 (`74b131e2`)

D-012 deleted `how-work-stopped.ts` and `what-the-child-actually-said.test.ts`: the stall notice now
PREVIEWS the last exchange (who sent the last message and the start of it, then the start of the
answer), and `read_transcript` gives the words themselves. Several of this table's rules moved with
it: the words half, main-thread = `parentToolCallId IS NULL`, the placement, the cut measured on the
text that arrived, and the read on the holder. M1–M8 and M12–M14 are corrected in place onto
`last-exchange.ts`, the store's last-exchange read, `agent-tools.ts` and the notice. M9–M11 are
retired by ruling (the read is no longer narrowed to an ended turn, and the empty-text guard was not
carried). ⛔ The killer map above is superseded: the rows die in `a-giver-looks-closer.test.ts`,
`a-message-says-who-wrote-it.test.ts` §4 and `the-rest-of-r18-and-the-answer-with-no-bound.test.ts`
§3, and the *deliberately does NOT contain* notes name functions D-012 deleted. M3, M4's text half, M6,
M8 and M13 had no killer after D-012; T-003 added one for each.
"""

SAID = "apps/desktop/src/shared/how-work-stopped.ts"
STORE = "apps/desktop/src/main/db/session-store.ts"
RAILS = "apps/desktop/src/main/runtime/reply-rails.ts"
HOST = "apps/desktop/src/main/runtime/runtime-host.ts"
LAST_EXCHANGE = "apps/desktop/src/shared/last-exchange.ts"
AGENT_TOOLS = "apps/desktop/src/main/runtime/agent-tools.ts"

MUTATIONS = [
    # ── §1 · the words themselves ─────────────────────────────────────────────────────────────
    (
        "M1 · ⛔ THE DEFECT, verbatim · a conversation that SPOKE is reported as having said "
        "nothing — `HO-088` §5.2's whole half, and the sentence `HO-092` §3 watched a parent read "
        "beside four questions its child had just typed out",
        # ⚑ T-003 · re-anchored in place, not retired — D-012 deleted `how-work-stopped.ts` and
        # moved this rule into the last-exchange read (`last-exchange.ts`, the store, the tools and
        # the notice); earlier notes on this row describe the deleted code. Re-verified RED alone.
        [
            (LAST_EXCHANGE, '  if (exchange.answer === null) {\n', '  if (exchange.answer !== undefined) {\n'),
        ],
    ),
    (
        "M2 · 🔴 the line READS the words · *is asking about this work* is the inference "
        "`00-backlog.md` D17 rules out permanently — ⚠️ *\"inventing questions nobody asked and "
        "missing ones that were\"* — and it arrives here as a claim about a string nothing examined",
        # ⚑ T-003 · re-anchored in place, not retired — D-012 deleted `how-work-stopped.ts` and
        # moved this rule into the last-exchange read (`last-exchange.ts`, the store, the tools and
        # the notice); earlier notes on this row describe the deleted code. Re-verified RED alone.
        [
            # ⚑ **F080 · re-anchored in place, not retired** — F080 split the lead line: after a turn its provider started it says *latest words*, and the answer to a message keeps this one.
            (LAST_EXCHANGE, "      : `${holder}'s answer starts:`,\n", "      : `${holder} is asking about this work:`,\n"),
        ],
    ),
    (
        "M3 · ⛔ the two absences collapse into one sentence · *this app holds no ended turn of "
        "its* becomes *it ended one and said nothing* — `an-unenumerated-state-counts-as-success`, "
        "and the difference §5.1 of the brief names: a turn that said nothing is not a turn this "
        "app never saw",
        # ⚑ T-003 · re-anchored in place, not retired — D-012 deleted `how-work-stopped.ts` and
        # moved this rule into the last-exchange read (`last-exchange.ts`, the store, the tools and
        # the notice); earlier notes on this row describe the deleted code. Re-verified RED alone.
        [
            (LAST_EXCHANGE, '    return [`This app holds no message sent to ${holder}, so there is no exchange to show.`]\n', '    return [`${holder} said nothing back to it.`]\n'),
        ],
    ),
    (
        "M13 · ⚠️ the quotation goes LAST · a child's prose ending in something that reads like an "
        "instruction becomes the last thing the parent reads, with this app's own line above it "
        "instead of after it — the placement `whatItLastSaidLines`' docblock states as a placement "
        "rather than as a defence",
        # ⚑ **RE-POINTED at 624, not retired** — the first argument is the agent's NAME
        # now, because `HO-095` §5.3 ruled the `sess_…` handle out of a sentence a person
        # reads. ⛔ The row's subject is unchanged: the quotation stops being last.
        # `correct-a-stale-mutation-anchor-dont-retire-it`.
        # ⚑ T-003 · re-anchored in place, not retired — D-012 deleted `how-work-stopped.ts` and
        # moved this rule into the last-exchange read (`last-exchange.ts`, the store, the tools and
        # the notice); earlier notes on this row describe the deleted code. Re-verified RED alone.
        # ⚑ Landing D-016b (5e931be8, the tree) · re-anchored in place, not retired —
        # undrivenWorkText in reply-rails.ts still puts the exchange preview before this app's own
        # lines and the instruction ('It has not been answered. Read its record with list_tasks,
        # naming <label>') last, using exchangePreviewLines. The plant moves the preview to the end
        # so the instruction is no longer the last paragraph. Killed by
        # `a-message-says-who-wrote-it.test.ts`.
        # ⚑ Landing D-016c commits 6–7 and D-022 (4a7f0fec, c1a79abe, 37228461) · re-anchored in
        # place, not retired — undrivenWorkText still puts the exchange preview before this app's
        # own lines and ends on the instruction; commit 7 only changed the read_transcript line to
        # name ${piece.label} instead of ${piece.owner}. The plant moves the exchangePreviewLines
        # push to the end, so the child's quoted words become the last thing the parent reads.
        # Killed by `a-message-says-who-wrote-it.test.ts`.
        [
            (RAILS, '  lines.push(...exchangePreviewLines(holder, exchange, nameOf))\n  if (mayReadIt) {\n    lines.push(`To read more of that conversation, call read_transcript with agent ${piece.label}.`)\n  }\n  lines.push(`It has not been answered. Read its record with list_tasks, naming ${piece.label}.`)\n', '  if (mayReadIt) {\n    lines.push(`To read more of that conversation, call read_transcript with agent ${piece.label}.`)\n  }\n  lines.push(`It has not been answered. Read its record with list_tasks, naming ${piece.label}.`)\n  lines.push(...exchangePreviewLines(holder, exchange, nameOf))\n'),
        ],
    ),
    (
        "M14 · 🔴 the read is taken on the PARENT · the notice quotes the conversation that is "
        "BEING TOLD instead of the one holding the work — ⛔ the subject of every other value on "
        "the line is `task.assignedTo`, and this is the one place a plausible neighbour is in "
        "scope",
        # ⚑ **RE-POINTED at 624, not retired** — the call grew a fourth argument (the
        # agent's NAME, `HO-095` §5.3) and wrapped onto five lines. ⛔ The row's subject
        # and its defect are unchanged: the WORDS are read on the parent instead of on
        # the conversation holding the work.
        # ⚑ T-003 · re-anchored in place, not retired — D-012 deleted `how-work-stopped.ts` and
        # moved this rule into the last-exchange read (`last-exchange.ts`, the store, the tools and
        # the notice); earlier notes on this row describe the deleted code. Re-verified RED alone.
        # ⚑ Landing D-016b (5e931be8, the tree) · re-anchored in place, not retired — The stall
        # notice still previews the last exchange of the conversation that OWNS the piece
        # (store.lastExchange(piece.owner)), which is what the giver reads. The plant asks about the
        # giver's own conversation, so the preview shows the wrong exchange. Killed by
        # `a-giver-looks-closer.test.ts`.
        [
            # ⚑ **the service dispatcher · re-anchored in place, not retired** — NOT VERIFIED: re-anchored source-only on the text L4a moved or repeated; the mutant makes the same change as before; no table run.
            (HOST, "          this.theExchangeShownWith(piece),\n", "          this.deps.store.lastExchange(parent.id),\n"),
        ],
    ),
    # ── §2 · the cut ──────────────────────────────────────────────────────────────────────────
    (
        "M4 · ⛔ the cut is SILENT · the words are clipped and the parent is not told, so a parent "
        "that cannot read its child's ledger has no way to know there is more — ⚑ the reason "
        "`MEMORY_NOTE_TEXT_CAP` declares its own truncation, with the door this one does not have",
        # ⚑ T-003 · re-anchored in place, not retired — D-012 deleted `how-work-stopped.ts` and
        # moved this rule into the last-exchange read (`last-exchange.ts`, the store, the tools and
        # the notice); earlier notes on this row describe the deleted code. Re-verified RED alone.
        [
            (AGENT_TOOLS, '    : { text: words.text, ...(words.clipped ? { clipped: true } : {}) }\n', '    : { text: words.text }\n'),
            (AGENT_TOOLS, '  return words.clipped\n    ? `${words.text}\\n(cut at ${String(WORDS_CAP)} units — there was more)`\n    : words.text\n', '  return words.text\n'),
        ],
    ),
    (
        "M5 · 🔴 `clipped` is measured on the text that LEAVES · the comparison is against the "
        "sliced value, so the two sides agree at every length and the flag is false for every "
        "message — `a-comparison-tested-where-both-sides-agree-measures-nothing`, and the cut "
        "becomes silent by arithmetic instead of by omission",
        # ⚑ T-003 · re-anchored in place, not retired — D-012 deleted `how-work-stopped.ts` and
        # moved this rule into the last-exchange read (`last-exchange.ts`, the store, the tools and
        # the notice); earlier notes on this row describe the deleted code. Re-verified RED alone.
        [
            (LAST_EXCHANGE, '  return { text: text.slice(0, cap), clipped: text.length > cap }\n', '  return { text: text.slice(0, cap), clipped: text.slice(0, cap).length > cap }\n'),
        ],
    ),
    (
        "M6 · ⚠️ the boundary itself · `>=` declares a cut on a message that fits exactly, which "
        "is the same false sentence as hiding one that happened, pointed the other way — ⛔ the "
        "row that is invisible to every test taken one unit either side of the cap",
        # ⚑ T-003 · re-anchored in place, not retired — D-012 deleted `how-work-stopped.ts` and
        # moved this rule into the last-exchange read (`last-exchange.ts`, the store, the tools and
        # the notice); earlier notes on this row describe the deleted code. Re-verified RED alone.
        [
            (LAST_EXCHANGE, '  return { text: text.slice(0, cap), clipped: text.length > cap }\n', '  return { text: text.slice(0, cap), clipped: text.length >= cap }\n'),
        ],
    ),
    # ── §3 · whose words, and which kind ──────────────────────────────────────────────────────
    (
        "M7 · ⛔ a SUB-AGENT's words are handed over as the child's · `128` put "
        "`parentToolCallId` on `assistant_message` for exactly this question, and without the "
        "clause a parent is told its child said something a grandchild said — ⚑ `029`'s "
        "misattribution, on the half `128` repaired",
        # ⚑ 676 · anchor CORRECTED, not retired: the clause sits behind `json_valid` now (a
        # torn row raised and lost the notice); dropping it is still the sub-agent's words.
        # ⚑ T-003 · re-anchored in place, not retired — D-012 deleted `how-work-stopped.ts` and
        # moved this rule into the last-exchange read (`last-exchange.ts`, the store, the tools and
        # the notice); earlier notes on this row describe the deleted code. Re-verified RED alone.
        [
            (STORE, "        AND CASE WHEN json_valid(payload)\n                 THEN json_extract(payload, '$.parentToolCallId') IS NULL\n                 ELSE 1\n            END)`\n", ')`\n'),
        ],
    ),
    (
        "M8 · 🔴 a DRAFT is quoted · `assistant_delta` is admitted beside the authoritative "
        "message, and its own schema says why that is wrong — ⚠️ *\"best-effort progressive "
        "rendering and NOT guaranteed to concatenate exactly to this text\"*; the adapters "
        "coalesce and then emit one message, so the last delta is a fragment of a sentence",
        # ⚑ T-003 · re-anchored in place, not retired — D-012 deleted `how-work-stopped.ts` and
        # moved this rule into the last-exchange read (`last-exchange.ts`, the store, the tools and
        # the notice); earlier notes on this row describe the deleted code. Re-verified RED alone.
        [
            (STORE, "  const MAIN_THREAD_WORDS = `(type = 'assistant_message'\n", "  const MAIN_THREAD_WORDS = `(type IN ('assistant_message', 'assistant_delta')\n"),
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (T-003): D-012 (3ff53f05)** — the empty-text guard went with 614's
        # reader and was not carried into D-012's `wordsOf` (reported to the PM as a product line:
        # an empty answer now previews as an empty paragraph). The code this row put a defect back
        # into is deleted. Its anchor is left stale, so the census records it retired.
        "M10 · ⚠️ a quotation of NOTHING · an `assistant_message` whose text is the empty string "
        "reaches the parent as *the last thing it said was:* followed by a blank paragraph — ⛔ the "
        "LEDGER boundary, not a live producer: neither adapter writes one, and an imported or "
        "bundled row is a string this build did not write",
        [
            (
                STORE,
                "    if (typeof said.text !== 'string' || said.text === '') return IT_SAID_NOTHING\n",
                "    if (typeof said.text !== 'string') return IT_SAID_NOTHING\n",
            )
        ],
    ),
    # ── §4 · which turn ───────────────────────────────────────────────────────────────────────
    (
        # ⛔ **RETIRED BY RULING (T-003): D-012 (3ff53f05)** — D-012 reads the last exchange, not the
        # last ENDED turn: *Not narrowed to a closed turn* (its card: the words back, *including in
        # a turn that is still running*). The turn-first query this row reordered is deleted with
        # `how-work-stopped.ts`. Its anchor is left stale, so the census records it retired.
        "M9 · ⛔ the turn is no longer asked FIRST · the query's empty result answers both "
        "questions, so a conversation this app has never seen end a turn is reported as one that "
        "ended a turn silently — ⚑ `lastEndedTurnOf`'s own first move, which exists because a "
        "query that found no row can only ever produce one of the two answers",
        [
            (
                STORE,
                "    if (\n"
                "      (selectLastClosedTurn.get(sessionId, generation) as ClosedTurnRow | undefined) === undefined\n"
                "    )\n"
                "      return NO_TURN_OF_ITS_HAS_ENDED\n",
                "",
            )
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (T-003): D-012 (3ff53f05)** — its defect became the decision: D-012
        # reads a turn that is still running (*Not narrowed to a closed turn*), which is what
        # dropping `closed_at IS NOT NULL` planted. Its anchor is left stale, so the census records
        # it retired.
        "M11 · 🔴 the turn narrowing goes · `closed_at IS NOT NULL` is dropped from the "
        "sub-select, so the words of a turn that is RUNNING NOW are reported as what the "
        "conversation last said — ⛔ `HO-031` §2.2's defect (*stale or describing an older turn, "
        "unclear which*) rebuilt on the words instead of on the ending",
        [
            (
                STORE,
                # ⚑ 676 · anchor CORRECTED, not retired: the line above it is `676`'s guard now.
                "            END\n"
                "        AND turn_id = (SELECT id FROM turn\n"
                "                        WHERE session_id = ? AND generation = ? AND closed_at IS NOT NULL\n",
                "            END\n"
                "        AND turn_id = (SELECT id FROM turn\n"
                "                        WHERE session_id = ? AND generation = ?\n",
            )
        ],
    ),
    (
        "M12 · ⚠️ the FIRST run of the turn is quoted instead of the last · `normalize.ts` flushes "
        "a text run whenever a tool interrupts it, so a turn that used a tool has several — and "
        "*what it last said* becomes the sentence it opened with, which on the screen `HO-092` §3 "
        "was taken from is the one before the questions",
        # ⚑ T-003 · re-anchored in place, not retired — D-012 deleted `how-work-stopped.ts` and
        # moved this rule into the last-exchange read (`last-exchange.ts`, the store, the tools and
        # the notice); earlier notes on this row describe the deleted code. Re-verified RED alone.
        [
            (STORE, '      WHERE session_id = ? AND generation = ? AND ordinal > ? AND ${MAIN_THREAD_WORDS}\n      ORDER BY ordinal DESC LIMIT 1`,\n', '      WHERE session_id = ? AND generation = ? AND ordinal > ? AND ${MAIN_THREAD_WORDS}\n      ORDER BY ordinal ASC LIMIT 1`,\n'),
        ],
    ),
]
