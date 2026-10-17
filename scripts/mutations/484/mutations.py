"""484 · state a supervisor can trust — HO-031 §2.1 and §2.2, and three of §3's defects.

⛔ **The measurement this table exists for is one sentence long.** A person interrupted an agent
through the UI, the app wrote `work_interrupted {"by":"a-person"}`, and `get_agent_status` answered
`lastTurn: {"how":"the-provider-faulted","who":null,"asker":null}`. ⚑ BroBot's own words: *"Absent
the user saying so, this report would have recorded that the agent spontaneously recovered."*

## 🔴 What was actually wrong, which is not what the report said

⚠️ **Nothing in the reading was false.** `lastTurnStop` narrowed to the last CLOSED turn by
`events.turn_id`, `howWorkStopped` read `work_interrupted` off that turn, and both were right about
the turn they were about. ⛔ **The hole is `turnFor`**: a row written with no turn open gets
`turn_id = null`, so the one gesture whose author this app records is unreachable from every reader
that joins on the turn. ⚑ **So the repair is a second question rather than a wider answer** — an
interruption is an act on a CONVERSATION — and `M1`–`M4` are the ways that second question can be
made to answer the first one's.

⚠️ **The same shape one field over.** `stalled_because: 'turn_interrupted'` and
`lastTurn.how: 'the-provider-faulted'` looked like a contradiction and were two readings of two
different turns: a stall latches on the first ending that reaches a `working` task and nothing ever
returns it to `working`. ⛔ **The ambiguity was the defect, not the staleness** (HO-031 §2.2), so
the values now carry their own moment — `M5`–`M7` are the ways that moment goes back to being
guessable.

## ⛔ Two rows are about a SENTENCE, and they are the ones a census cannot see

⚠️ **`M16` and `M17` restore the descriptions `interrupt_agent.reason` and `end_agent.reason` had.**
Neither argument reaches an agent and neither is written to a ledger — `RuntimeHost.interruptAgent`
and `endAgent` take an id and a caller — and *"Why you are stopping it."* is a name that implies a
channel. ⛔ **A description is the only thing a model has**, and standing rule 8's line cuts the
other way here: this is not a claim about the system that should be rendered, it is an instruction
about what this call does and does not do.

## ⚑ What this table deliberately does NOT contain

⛔ **No row on `list_questions`' `because` gate.** `394` §2 owns it and `433` bounds it — a
permission's command is the content of somebody else's work — and a mutation that widened it would
be this dispatch reversing a ruling in a file its brief does not cover. ⚠️ **The gate is asserted by
name instead**, in §6 of the suite, so a future widening is a decision rather than a drift.

⛔ **No row naming an actor on `conversation_ended`.** The fold clears the ask at every turn ending
and `status` carries no actor, so a row planting one there would be planting a guess rather than
measuring a rule. ⚑ `M8` is the nearest a row gets and it goes the other way: it lets the actor
travel to EVERY cause, which is the defect in the direction the code could actually take.

⛔ **No row on `AgentCard.state`.** It already answered *what is it doing now* correctly and was
never the thing that was wrong; `395`'s own table owns it.

## 🔴 The gate map — which file kills which row

| rows | killer |
|---|---|
| `M1`–`M4` | ⚑ **`apps/desktop/test/state-a-supervisor-can-trust.test.ts`** §1 and §2's `WHERE_AN_ASK_LANDED` case |
| `M5`, `M6` | ⚑ the same file's §2 — the moment, and what has started since |
| `M7`, `M8` | ⚑ §3's paired positive and negative, and §4's `conversation_ended` case |
| `M9` | ⚑ §4's `conversation_ended` case — the ask that outlives the turn it belonged to |
| `M10` | ⚑ **`apps/desktop/test/a-task-you-can-see.test.ts`** §7's query/fold census, and §3's live read |
| `M11`, `M12` | ⚑ §4 — the frozen row, in the payload and in the line |
| `M13`–`M15`, `M19` | ⚑ §3 — the actor on each surface that reports the act, including the notice a parent is pushed |
| `M16`, `M17` | ⚑ §5 — the two descriptions, on the bytes each provider is sent |
| `M18` | ⚑ §6 — the null that says which null it is |

## ⚑ ANCHOR CORRECTED IN PLACE BY 494

⛔ **`selectTaskEvents`' type list gained `'user_decision'`** — the second producer of an actor for
`TaskRow.stalledBy`, and a type the fold branches on has to be a type the statement selects.
⚠️ **The rule this row restores is unchanged**; only the bytes it anchors on moved. ⚑ `494` put the
new member on its OWN line so that `491 M6`, which anchors on the last two lines and is the only row
in this set whose table has been RUN, keeps the verdict it earned — *a corrected anchor keeps a
verdict it never earned*. This table is `unrun`, so the correction costs it nothing.

## ⚑ ANCHOR CORRECTED IN PLACE BY 494 (M1, M4, M10)

⛔ **`selectLastAskToStop` finds a permission answered `cancel` as well as a `work_interrupted` row
since `494`**, and `selectTaskEvents`' type list gained `'user_decision'`. ⚠️ **The rules M1, M4 and
M10 restore are unchanged** — the turn narrowing that hid an idle Stop, the newest row, and the
fold/statement pair — and only the bytes they anchor on moved. ⚑ This table is `unrun`, so
correcting in place costs no verdict; `453` measured that the label suffix is the whole price.
"""

STORE = "apps/desktop/src/main/db/session-store.ts"
TASKS = "apps/desktop/src/shared/tasks.ts"
TOOLS = "apps/desktop/src/main/runtime/agent-tools.ts"
HOST = "apps/desktop/src/main/runtime/runtime-host.ts"
STOPPED = "apps/desktop/src/shared/how-work-stopped.ts"
RAILS = "apps/desktop/src/main/runtime/reply-rails.ts"

MUTATIONS = [
    # ---------------------------------------------- §1 · the ask, and the reader that could not see it
    (
        "M1 · 🔴 the ask is narrowed by turn again · the statement joins on a turn id, which is "
        "exactly what `selectLastTurnEndingEvents` does one query up — and it is what made a Stop "
        "pressed with nothing running invisible to every reader in this app. ⚑ ANCHOR CORRECTED IN PLACE BY 494",
        [
            (
                STORE,
                # ⚑ **723 · re-anchored in place, not retired** — 723's R81 line (`stopsNothing`, the folds' exact predicate) sits between the OR and the ORDER BY; the row still narrows the ask by turn
                "             OR (type = 'user_decision' AND json_extract(payload, '$.outcome') = 'cancel'))\n        AND NOT (type = 'user_decision' AND json_type(payload, '$.stopsNothing') IS 'true')\n      ORDER BY ordinal DESC LIMIT 1`,",
                "             OR (type = 'user_decision' AND json_extract(payload, '$.outcome') = 'cancel'))\n        AND NOT (type = 'user_decision' AND json_type(payload, '$.stopsNothing') IS 'true')\n        AND turn_id IS NOT NULL\n      ORDER BY ordinal DESC LIMIT 1`,",
            )
        ],
    ),
    (
        "M2 · ⛔ every ask is reported as belonging to the last ended turn · the word that lets a "
        "reader tell *one act seen twice* from *two acts* is made constant, so an interruption of "
        "an idle conversation reads as the ending of a turn it never touched · killed by `state-a-supervisor-can-trust.test.ts` (named by W4.78)",
        [
            (
                STORE,
                # ⚑ **W4.78 · re-anchored in place, not retired** — the WhereAnAskLanded ternary was rewritten to test `row.turn_id === null` first and name 'no-turn-was-running'; the plant makes an ask with no turn read as the last ended turn, the old defect. Killer per the gate map (§1/§2 WHERE_AN_ASK_LANDED cases expecting 'no-turn-was-running').
                "        ? 'no-turn-was-running'\n",
                "        ? 'the-turn-that-ended-last'\n",
            )
        ],
    ),
    (
        "M3 · ⚠️ the asking CONVERSATION is dropped · `by` still says `an-agent` and the id goes "
        "null, which is `397`'s pair split in half — *an agent stopped it* and this app cannot say "
        "which, about a row that names one. ⚑ ANCHOR CORRECTED IN PLACE BY 501, which read the "
        "word off a narrowed local once instead of re-reading the payload field",
        [
            (
                STORE,
                "      asker: by === 'an-agent' && typeof asked.agent === 'string' ? asked.agent : null,",
                "      asker: null,",
            )
        ],
    ),
    (
        "M4 · ⛔ the FIRST ask wins instead of the last · a person stopping work an agent already "
        "asked about is reported as the agent — `howWorkStopped`'s own rule, inverted one subject "
        "up. ⚑ ANCHOR CORRECTED IN PLACE BY 494",
        [
            (
                STORE,
                # ⚑ **723 · re-anchored in place, not retired** — 723's R81 line (`stopsNothing`, the folds' exact predicate) sits between the OR and the ORDER BY; the row still makes the FIRST ask win
                "             OR (type = 'user_decision' AND json_extract(payload, '$.outcome') = 'cancel'))\n        AND NOT (type = 'user_decision' AND json_type(payload, '$.stopsNothing') IS 'true')\n      ORDER BY ordinal DESC LIMIT 1`,",
                "             OR (type = 'user_decision' AND json_extract(payload, '$.outcome') = 'cancel'))\n        AND NOT (type = 'user_decision' AND json_type(payload, '$.stopsNothing') IS 'true')\n      ORDER BY ordinal ASC LIMIT 1`,",
            )
        ],
    ),
    # ------------------------------------------------- §2 · which turn the reading is about
    (
        "M5 · 🔴 the reading never says a turn has started since · the field HO-031 §2.2 asked for "
        "is made constant, and a parent is back to resolving *stale* against *an older turn* out "
        "of a docblock it cannot see",
        [
            (
                STORE,
                "    const since: LastEndedTurn['since'] =\n"
                "      (selectOpenTurn.get(sessionId, generation) as OpenTurnRow | undefined) === undefined\n"
                "        ? 'nothing-has-started-since'\n"
                "        : 'a-turn-is-running-now'",
                "    const since: LastEndedTurn['since'] = 'nothing-has-started-since'",
            )
        ],
    ),
    (
        "M6 · ⛔ the reading is about the last turn rather than the last ENDED one · the exact "
        "ambiguity this dispatch was sent to remove, planted as the query it would have been: a "
        "running turn now has a closing time of `null` and the answer describes work in flight",
        [
            (
                STORE,
                "    const closed = selectLastClosedTurn.get(sessionId, generation) as ClosedTurnRow | undefined\n"
                "    if (closed === undefined) return null",
                "    const closed = selectLastTurn.get(sessionId, generation) as ClosedTurnRow | undefined\n"
                "    if (closed === undefined) return null",
            )
        ],
    ),
    # ------------------------------------------------- §3 · the moment and the actor on a stall
    (
        "M7 · ⚠️ a stall carries no moment · the field that lets a reader see that `stalled_because` "
        "and `lastEndedTurn` are about two different turns goes back to null, and the two readings "
        "look like one contradiction again",
        [(TASKS, "      stalledAt: at,", "      stalledAt: null,")],
    ),
    (
        "M8 · ⛔ the actor travels to every cause · a launch sweep, a quit and a conversation's own "
        "ending are all reported as somebody having performed something — HO-029 §2.2's absence "
        "turned into a name",
        [
            (
                TASKS,
                # ⚑ **720 · ANCHOR CORRECTED in place (rule 27)** — R72 moved WHICH causes an ask
                # rides on into a closed record (`AN_ASK_RIDES_ON`: both TURN causes). This row's
                # defect is unchanged and still false after R72: a launch sweep, a quit and a
                # conversation's ending named as somebody's act. Re-verified RED alone.
                # ⚑ **T-002 · re-anchored in place, not retired** — D-005a gave `stall` a `by`
                # (defaulting to the fold's ask, and a held stall's own ask). The row still lets it
                # travel to every cause. Re-verified RED alone.
                "      stalledBy: AN_ASK_RIDES_ON[cause] ? by : null,",
                "      stalledBy: by,",
            )
        ],
    ),
    (
        "M9 · 🔴 the ask is never cleared · it survives the turn it belonged to and names the "
        "author of the next one — and `SessionMachine` writes `turn: 'interrupted'` for a "
        "permission answered `cancel` with no ask at all, so the name lands on a gesture nobody "
        "performed",
        [
            (
                TASKS,
                "      // ⛔ **484 · cleared whether or not anything used it**, and the `working` guard above is why\n"
                "      // it has to be here rather than inside {@link stall}: a turn that stalled nothing has still\n"
                "      // ENDED, and an ask that survived it would name the author of the next one.\n"
                "      asked = null\n",
                "",
            )
        ],
    ),
    (
        "M10 · ⛔ the narrow read drops the ask · the fold branches on a type the statement no "
        "longer selects, so the actor is right on the live path and null after every restart — "
        "`393`'s and `429`'s shape, third time. ⚑ ANCHOR CORRECTED IN PLACE BY 494",
                # ⚑ Re-anchored by `491`, which added `user_turn`; this row still removes only
                # `work_interrupted`.
                # ⚑ Re-anchored by `724` (R84), which added `reply_undelivered` on its own line after `reopened`; the row is unchanged.
                # ⚑ **T-002 · re-anchored in place, not retired** — D-005a added `message_queued` to the list on a line of its own; the row still drops the same type. Re-verified RED alone.
                # ⚑ **T-003 · re-anchored in place, not retired** — D-013 appended `background_work` and `scheduled_work` to the list; the row still drops the same type. Re-verified RED alone.
        # ⚑ Landing D-017 (5206d835) · re-anchored in place, not retired — selectTaskEvents' type
        # filter still lists 'work_interrupted' by name; the only thing that moved is a new
        # 'replaced_by' line D-017 inserted between 'message_queued' and 'work_restarted', which
        # shifted the anchor's exact text off a byte match. The underlying defect — dropping
        # work_interrupted silently turns a live-correct read into a replay-wrong one for who asked
        # a turn to stop — is untouched.
        # ⚑ Landing D-016b (5e931be8, the tree) · re-anchored in place, not retired —
        # selectPieceEvents (the renamed selectTaskEvents) still lists work_interrupted by name, and
        # the fold still branches on it, so the actor is right live and null after a restart if the
        # narrow read drops it. The plant removes that one member from the type list, and its
        # neighbours moved onto new lines. Killed by `a-task-you-can-see.test.ts`,
        # `state-a-supervisor-can-trust.test.ts`.
        [
            (STORE, "'user_turn', 'turn', 'status', 'work_interrupted', 'background_work',\n                     'scheduled_work')", "'user_turn', 'turn', 'status', 'background_work',\n                     'scheduled_work')"),
        ],
    ),
    # ------------------------------------- §4 · the holder conversation waits on a permission
    (
        "M11 · 🔴 the task row stops saying what its holder is doing · this is BroBot's §2.5 "
        "restored exactly — *`state: working`, `stalled_because: null`* about a child frozen on "
        "somebody's permission, which the PO called the most actively misleading thing in the "
        "report",
        # ⚑ Landing D-016b (5e931be8, the tree) · re-anchored in place, not retired — list_tasks
        # still reads its holder's live state through host.agentCard and puts it in the row as
        # given_to_is (the misleading-row fix of BroBot's section 2.5). The rule stands and the
        # anchor moved: the memoised reader is now keyed on row.owner and the row is a PieceRow.
        # Killed by `state-a-supervisor-can-trust.test.ts`.
        [
            # ⚑ **a helper stopped on a person · re-anchored in place, not retired** — list_tasks now keeps each holder's whole card (its state and what its turn is stopped on) and reads the state off it; the plant still drops the holder's live state from every row
            (TOOLS, "          const ownerIs = (row: PieceRow): AgentCard['state'] | null => cardOf(row)?.state ?? null\n", "          const ownerIs = (row: PieceRow): AgentCard['state'] | null => null\n"),
        ],
    ),
    (
        "M12 · ⚠️ the line a model reads loses the conversation's permission-waiting clause · the "
        "payload still carries the holder state and the sentence does not, so a provider that "
        "renders text instead of the structured answer reads an ordinary working row",
                # ⚑ Re-anchored by `491`: retain the open-task guard and explicit conversation
                # subject, while changing only the state whose clause is printed.
        # ⚑ Landing D-017 (5206d835) · re-anchored in place, not retired — The line a model reads
        # (taskText) still gates the 'waiting for a person's decision' clause on the holder's live
        # state, but the state vocabulary changed under D-017's shared derivation: `givenToIs` is
        # now `AgentCard['state'] | null` with an `.is` discriminant, and the old
        # 'waiting_permission' string became `.is === 'needs-you'`. Swapping the checked state to a
        # wrong-but-valid one ('active') reproduces exactly M12's original hazard: the payload's
        # given_to_is still carries the true state, but the printed sentence silently disagrees with
        # it.
        # ⚑ Landing D-016b (5e931be8, the tree) · re-anchored in place, not retired — pieceText
        # still gates the 'waiting for a person's decision' clause on the holder's live state, and
        # the anchor is the same one D-017 already re-anchored, now on `piece` instead of `task`.
        # The plant checks the wrong (valid) state, 'active', so the payload keeps the true
        # given_to_is while the printed sentence disagrees. Killed by
        # `state-a-supervisor-can-trust.test.ts`.
        [
            (TOOLS, "    TASK_IS_OPEN[piece.state] && givenToIs?.is === 'needs-you'\n", "    TASK_IS_OPEN[piece.state] && givenToIs?.is === 'active'\n"),
        ],
    ),
    # ------------------------------------------------- §5 · the actor on each surface
    (
        "M13 · ⛔ `list_tasks` reports the act and not the actor · the payload says the turn was "
        "stopped and names nobody, about a gesture whose author is one row above the ending in the "
        "same ledger — HO-029 §2.1 exactly",
                # ⚑ Re-anchored by `724` (R82): the key is `asked_to_stop_by`; the row is unchanged.
        # ⚑ Landing D-016b (5e931be8, the tree) · re-anchored in place, not retired — piecePayload
        # still reports the actor beside the stall as asked_to_stop_by, which R82 named and section
        # 3 of the 484 suite classifies. The plant removes the key from the payload, and the anchor
        # moved from `task.stalledBy` to `piece.stalledBy`. Killed by
        # `state-a-supervisor-can-trust.test.ts`.
        [
            (TOOLS, '  asked_to_stop_by: piece.stalledBy,\n', ''),
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-016a, bd70d693):** The row's subject, the `list_projects`
        # payload, was removed by bd70d693 ("create_project and list_projects ... are removed"); the
        # commit diff deletes this exact `asked_to_stop_by: row.stalledBy` line. The surviving
        # surface, list_tasks' `asked_to_stop_by: task.stalledBy`, is already M13's row, so a
        # re-anchor would only duplicate it. Its anchor is left stale, so the census records it
        # retired.
        "M14 · ⚠️ `list_projects` reports the same act without it · the surface a supervisor is "
        "likelier to call, left one depth of the walk behind",
        [
            (
                TOOLS,
                # ⚑ Re-anchored by `724` (R82): the key is `asked_to_stop_by`; the row is unchanged.
                "  ...(row.stalledBy === undefined ? {} : { asked_to_stop_by: row.stalledBy }),\n",
                "",
            )
        ],
    ),
    (
        "M15 · 🔴 the one composition goes silent · both surfaces that append it — the line "
        "`list_tasks` returns and the notice a parent is PUSHED — meet *the turn it was running in "
        "was stopped* with nobody named, which is the false history in the two places a supervisor "
        "reads it",
        [
            (
                STOPPED,
                "  return ask === null ? '' : `, by ${stoppedBy(ask.by, ask.asker)}`",
                "  return ask === null ? '' : ''",
            )
        ],
    ),
    (
        "M16 · ⛔ `interrupt_agent` goes back to a name that implies a channel · *Why you are "
        "stopping it.* with nothing saying where it goes, which is the state BroBot spent a "
        "section of its report unable to settle",
        [
            (
                TOOLS,
                "        reason: z\n"
                "          .string()\n"
                "          .describe(\n"
                "            'Why you are stopping it. This is for you, not for it: the agent never sees these words and this app does not keep them. Required so that destroying work in flight is a stated decision.',\n"
                "          ),",
                "        reason: z.string().describe('Why you are stopping it.'),",
            )
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-017, 5206d835):** Commit 5206d835 says outright:
        # 'end_agent and resume_agent are gone (21 tools).' M17's whole subject — end_agent's
        # `reason` field description drifting from interrupt_agent's — no longer exists: grepping
        # agent-tools.ts finds no `name: 'end_agent'` tool left, only comments noting its removal
        # ('D-017 · since `end_agent` went...'). This is exactly the retire list's first named item.
        # Its anchor is left stale, so the census records it retired.
        "M17 · ⚠️ `end_agent` keeps the old sentence while its twin gets the new one · two "
        "identical arguments describing themselves two different ways, which is how a model learns "
        "that one of them IS a channel",
        # ⚑ Landing D-017 (45a11477) · re-anchored in place, not retired — end_agent's reason
        # argument and interrupt_agent's still share the identical opening sentence the row protects
        # ('Why you are stopping it. This is for you, not for it...'), the parity D-017 R3 preserved
        # while shifting the verb from 'ending' to 'stopping' on both. Reverting end_agent's alone
        # to the pre-R3 short form breaks that parity again, the exact 'two identical arguments
        # describing themselves two different ways' defect.
        [
            (TOOLS, "        reason: z\n          .string()\n          .describe(\n            'Why you are stopping it. This is for you, not for it: the agent never sees these words and this app does not keep them. Required so that stopping a conversation and dropping what it holds is a stated decision.',\n          ),", "        reason: z.string().describe('Why you are ending it.'),"),
        ],
    ),
    (
        "M18 · ⛔ a missing question's words go back to a bare null · *there are none* and *this app "
        "cannot find them* become one absence again, and a caller that met it would reasonably "
        "conclude the question had no parts to answer",
        [
            (
                TOOLS,
                # ⚠️ **611 · CORRECTED IN PLACE** — the gate is the REFUSED arm (HO-088 §2.3).
                "  one.request.went.is !== 'the-person-the-channel-left-it-with' && one.words === null\n"
                "    ? ' · this app does not hold the words for this one — it cannot be answered from here'\n"
                "    : ''",
                "  one.request.went.is !== 'the-person-the-channel-left-it-with' && one.words === null ? '' : ''",
            )
        ],
    ),
    (
        "M19 · ⛔ the PUSH stops appending it while the row read back keeps it · HO-018 ruled the "
        "condition is pushed rather than merely visible, so this is the surface a parent actually "
        "acts on — and two accounts of one event that disagree about who did it is the shape "
        "`stoppedBy`'s own rule exists against · killed by `state-a-supervisor-can-trust.test.ts` (named by W4.78)",
        [
            (
                RAILS,
                # ⚑ **720 · ANCHOR CORRECTED in place (rule 27)** — the push composes through
                # `theStallAndItsAsk` now (R72); the defect is the same: the PUSH drops who asked
                # while `list_tasks` keeps it. Re-verified RED alone.
                # ⚑ **F074 · re-anchored in place, not retired** — F074 hands the push the usage limit too; the row still drops who asked from the push.
                # ⚑ **F074 · re-anchored in place, not retired** — F074 · the plant's replacement follows `undrivenSentence`, which takes the cause alone; the row still drops who asked from the push.
                # ⚑ **W4.78 · re-anchored in place, not retired** — F076 added `login` to the push's call; the plant now drops only who asked (by → null) and keeps the limit/login sentences, while list_tasks' line keeps the ask. Killer per the table's gate map §3 ('the NOTICE a parent is pushed names them too').
                "): string => `${theStallAndItsAsk(cause, by, limit, login)}.`",
                "): string => `${theStallAndItsAsk(cause, null, limit, login)}.`",
            )
        ],
    ),
    # ------------------------------------------------- §6 · the sentences
]
