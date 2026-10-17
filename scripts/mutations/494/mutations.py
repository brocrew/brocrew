"""494 · the act this app knows the author of — `492` F2, repaired at the READER.

⚠️ **`724` · R82 — the wire key these labels call `stalled_by` is `asked_to_stop_by` since `724`.**
The labels are the ones this table's run artefact (`mutations.txt`) records, so they are kept as
written; no anchor here spells the key, so nothing in this table was re-anchored for it.

🔴 **The defect, in `492`'s words:** *"`respondPermission` writes only `user_decision`. So
`howWorkStopped` answers `who: null` and `list_tasks` reports `stalled_by: null` for an act this app
knows the author of."*

⛔ **`492` priced the wrong repair and the PM corrected it before this was built.** The proposal was
a second `WorkInterruptedEvent` written from `RuntimeHost.respondPermission`. ⚑ **The actor was
already recorded**: `UserDecisionEvent.by` has carried it since `477` — derived from the caller,
written unconditionally, by the one writer that can spell `cancel` — and `how-work-stopped.ts` read
three event types, none of which was that one. 🔴 **So nothing new is written.** `491`'s assertion —
*a cancel writes no `work_interrupted`* — is still true and is asserted beside every repaired
reading, and HO-029 §2.2's *do not backfill* was never in the way.

## ⚠️ Three readers, one derivation, and a vocabulary that had to widen

`whoCancelledIt` is the shared derivation. ⛔ It is shared because `AgentCard` carries
`lastEndedTurn` and `lastAskToStop` on ONE payload while `list_tasks` reports `stalled_by` about the
same press: three spellings would be three chances to disagree about who pressed one button.

⚑ **`WHO_STOPPED_IT` is new and DERIVED** — `WHO_DID_IT` minus `the-app-itself`. The event
vocabularies are untouched: `WorkInterruptedEvent.by` stays at `WHO_ASKED_IT_TO_STOP`'s two members,
because `recordTheAsk` writes exactly two words. ⛔ What widened is what a READING may name, and it
widened because the reading acquired a second producer whose vocabulary is four words wide.
⚠️ `the-app-itself` is excluded by a RAIL rather than by preference — `mayAnswerAsAHuman` opens with
`by !== THE_APP_ITSELF`, so `respondPermission` never writes a row whose actor is the app.

⛔ **SUPERSEDED BY `501`, and the paragraph above is left as this dispatch wrote it.** That dispatch
repaired `recordTheAsk` — it asks `whoDidIt` now and refuses the app — so `WorkInterruptedEvent.by`
takes `WhoStoppedIt` and `WHO_ASKED_IT_TO_STOP` no longer exists. ⚑ **No row here moved**: every
anchor and every replacement in this table is byte-identical, and `M5`'s title still names the
retired constant because a row id is not rewritten for prose. ⚠️ `494` F4 predicted this repair and
filed it; `501` is the dispatch that took it.

## ⛔ The emptied field, measured rather than asserted

`whoCancelledIt` hard-wired to `return null` — the whole join, at its one derivation — turns **11
tests RED across 3 files, all in the `desktop` project**: `the-act-this-app-knows-the-author-of`
(9), `state-a-supervisor-can-trust` §7 (1), `the-interruption-that-looks-like-a-fault` §3 (1).
⚑ `runtime`, `dom` and `render` are 0 and cannot be otherwise — both folds live in
`apps/desktop/src/shared`, which no package test imports.

## 🔴 The gate map — which file kills which row

| rows | killer |
|---|---|
| M1–M6 | `apps/desktop/test/the-act-this-app-knows-the-author-of.test.ts` §1 and §4 |
| M7, M8 | …the same file's §2, the `howWorkStopped` arms |
| M9, M10 | …§2's `deriveTasks` arms; M10 also `state-a-supervisor-can-trust.test.ts` §7 |
| M11 | `apps/desktop/test/a-task-you-can-see.test.ts` §7, and §5 of this dispatch's file |
| M12–M15 | `the-act-this-app-knows-the-author-of.test.ts` §5, off a real store |

## ⛔ What this table deliberately does NOT contain

 - ⛔ **No row on `stalled_because`.** The cause is read off the TURN's own terminal and has said
   `turn_interrupted` for a cancel since `400`; `494` adds no member and changes no sentence, so a
   row here would restore a defect this dispatch did not create. `400` owns that line.
 - ⛔ **No row on the flat producer's reading.** `484` anchors on
   `asker: asked.by === 'an-agent' && …` and `494` left that line byte-identical when it moved into
   `actorOfTheAsk` — verified by dry-running every table after the edit, not assumed.
 - ⛔ **No row on the `user_turn` boundary.** `491` owns it. ⚑ It is load-bearing for `494` — the
   product test names the person rather than the earlier agent BECAUSE the boundary cleared the idle
   ask — and a row here would double-count a rule somebody else already restores.
 - ⚠️ **No row on `492` F1's double latch.** The command-approval path calls `requestInterrupt()`
   twice and either line alone is a no-op; `492 M10` covers both lines, and the PM has explicitly
   deferred the repair.
 - ⛔ **No row on the `respondPermission` writer.** `477` owns `by: whoDidIt(by)`, and this dispatch
   changed no writer at all — which is the whole of its argument.

⛔ **Evidence standard.** Every row was applied ALONE against a byte-exact snapshot, its own killer
file run, and the tree restored and `cmp`-verified before the next. ⚠️ The table has NOT been run
under the driver, so `CENSUS.md` records it `unrun` and no driver verdict is claimed here.
"""

STOPPED = "apps/desktop/src/shared/how-work-stopped.ts"
TASKS = "apps/desktop/src/shared/tasks.ts"
STORE = "apps/desktop/src/main/db/session-store.ts"

MUTATIONS = [
    # ── §1 · the shared derivation ──────────────────────────────────────────────────────────────
    (
        "M1 · 🔴 THE OLD POPULATION, backfilled · a decision written before `477` carries no actor, "
        "and this names a person for it — HO-029 §2.2's *every event written before this answers "
        "unknown* turned into a guess about rows nobody can ever check",
        [
            (
                STOPPED,
                "  if (by === undefined) return null\n",
                "  if (by === undefined) return { by: 'a-person', asker: null }\n",
            )
        ],
    ),
    (
        "M2 · ⛔ the asking CONVERSATION is dropped · an agent's cancel reports the bare word, so a "
        "parent reading `stalled_by` can no longer join the row to the ledger that made the press "
        "— `WorkInterruptedEvent.agent`'s whole reason, one producer over",
        [
            (
                STOPPED,
                "    return { by: 'an-agent', asker: typeof by.agent === 'string' ? by.agent : null }\n",
                "    return { by: 'an-agent', asker: null }\n",
            )
        ],
    ),
    (
        "M3 · ⚠️ THE APP IS NAMED AS A PERSON · the member `mayAnswerAsAHuman` makes unreachable is "
        "reported as the one actor this app cannot claim on somebody's behalf — the false sentence "
        "`222` shipped, arriving through a row the app never writes",
        [
            (
                STOPPED,
                "  if (by.who === 'the-app-itself') return null\n",
                "  if (by.who === 'the-app-itself') return { by: 'a-person', asker: null }\n",
            )
        ],
    ),
    (
        "M4 · ⛔ the LEDGER boundary is removed · a word from a build whose vocabulary has moved is "
        "reported as itself rather than dropped, so a reading prints an actor this build has no "
        "sentence for — `isWhoDidIt`'s rule, and criterion 18's confident claim",
        [
            (
                STOPPED,
                "  if (!(WHO_STOPPED_IT as readonly string[]).includes(by.who)) return null\n",
                "",
            )
        ],
    ),
    (
        "M5 · ⚠️ the reading vocabulary stops being DERIVED · `the-app-itself` is admitted as a "
        "member, so a census walking the list reports a coverage no producer can reach — the exact "
        "test `WHO_ASKED_IT_TO_STOP`'s removed third member failed",
        [
            (
                STOPPED,
                "  (who): who is WhoStoppedIt => who !== 'the-app-itself',\n",
                "  (who): who is WhoStoppedIt => true,\n",
            )
        ],
    ),
    (
        "M6 · ⛔ one phrasing becomes two · every non-agent actor is spelled as a person, so the "
        "caller this app has no word for is reported as one — `stoppedBy`'s own rule that a surface "
        "wanting its own phrasing would be the second vocabulary",
        [
            (
                STOPPED,
                "  return by === 'an-agent' ? (agent ?? WHO_DID_IT_SAYS['an-agent']) : WHO_DID_IT_SAYS[by]\n",
                "  return by === 'an-agent' ? (agent ?? WHO_DID_IT_SAYS['an-agent']) : WHO_DID_IT_SAYS['a-person']\n",
            )
        ],
    ),
    # ── §2 · the turn fold ──────────────────────────────────────────────────────────────────────
    (
        "M7 · 🔴 every decision becomes an ask · `allow` and `deny` name their answerer as the "
        "author of whatever ended the turn next, so a person who approved a tool is reported as "
        "having stopped the work — the join reading the event TYPE instead of the one outcome",
        [
            (
                STOPPED,
                "      if (event.outcome !== 'cancel') continue\n",
                "      if (event.outcome === 'deny') continue\n",
            )
        ],
    ),
    (
        "M8 · ⛔ a cancel this app cannot name INHERITS the last ask · an agent that asked earlier in "
        "the same turn is reported as the author of a press it never made — `491`'s defect, moved "
        "from the turn boundary onto the actor itself",
        [
            (
                STOPPED,
                "      asked = cancelled?.by ?? null\n      asker = cancelled?.asker ?? null\n",
                "      asked = cancelled?.by ?? asked\n      asker = cancelled?.asker ?? asker\n",
            )
        ],
    ),
    # ── §3 · the task fold ──────────────────────────────────────────────────────────────────────
    (
        "M9 · ⚠️ the task fold remembers every outcome · `stalled_by` names whoever allowed a tool, "
        "for a turn something else stopped — the same defect as M7 in the field `492` measured, and "
        "the one a parent reads in `list_tasks`",
        [
            (
                TASKS,
                "      if (event.outcome === 'cancel') asked = whoCancelledIt(event.by)\n",
                "      asked = whoCancelledIt(event.by)\n",
            )
        ],
    ),
    (
        "M10 · ⛔ the FIRST ask wins · an agent's earlier Stop outranks the person's Cancel that "
        "actually ended the turn, so `stalled_by` names the agent — `394`'s *the last ask wins*, "
        "inverted, and measured where the two producers DIVERGE",
        [
            (
                TASKS,
                "      if (event.outcome === 'cancel') asked = whoCancelledIt(event.by)\n",
                "      if (event.outcome === 'cancel') asked = asked ?? whoCancelledIt(event.by)\n",
            )
        ],
    ),
    # ── §4 · the replayed path ──────────────────────────────────────────────────────────────────
    (
        "M11 · 🔴 the task query forgets the new type · a task a person cancelled derives "
        "`stalled_by: null` after a restart while a live host names them — *live-correct and "
        "replay-wrong*, the fourth time that is the shape and the reason the fold and the statement "
        "are censused against each other",
        # ⚑ Landing D-016b (5e931be8, the tree) · re-anchored in place, not retired — The rule (the
        # narrow read must include `user_decision`, or a person's cancel derives `stalled_by: null`
        # after a restart) survives: `selectPieceEvents` still lists it. The list was reflowed onto
        # one line with the piece types, so the old standalone `'user_decision',` line went dark.
        # The plant removes it from the current line. Killed by `a-task-you-can-see.test.ts`,
        # `the-act-this-app-knows-the-author-of.test.ts`.
        [
            (STORE, "'user_decision', 'reopened', 'reply_undelivered', 'message_queued',", "'reopened', 'reply_undelivered', 'message_queued',"),
        ],
    ),
    (
        "M12 · ⛔ the turn-ending query forgets it · `lastEndedTurn` answers `who: null` for the "
        "same press the task row names, so one `AgentCard` carries two answers about one act — "
        "`484`'s own defect, restored on the reader `484` built",
        [
            (
                STORE,
                "        AND type IN ('turn', 'error', 'work_interrupted', 'user_decision')\n",
                "        AND type IN ('turn', 'error', 'work_interrupted')\n",
            )
        ],
    ),
    (
        "M13 · ⚠️ the conversation-level ask forgets it · `lastAskToStop` reports *no row says* "
        "beside a `lastEndedTurn` that names a person, which is the pair a reader has to choose "
        "between and the reason this query moved at all",
        [
            (
                STORE,
                "        AND (type = 'work_interrupted'\n             OR (type = 'user_decision' AND json_extract(payload, '$.outcome') = 'cancel'))\n",
                "        AND type = 'work_interrupted'\n",
            )
        ],
    ),
    (
        "M14 · ⛔ the outcome narrowing goes · every decision becomes a conversation-level ask, so "
        "`lastAskToStop` reports the person who pressed *Allow* as the last one who asked this "
        "work to stop — M7's defect in the SQL rather than in the fold",
        [
            (
                STORE,
                "             OR (type = 'user_decision' AND json_extract(payload, '$.outcome') = 'cancel'))\n",
                "             OR type = 'user_decision')\n",
            )
        ],
    ),
    (
        "M15 · ⚠️ the two row SHAPES are read as one · a decision row falls into the flat reader, "
        "whose `by` is an object rather than a word, so it is dropped — the repaired field answers "
        "`null` again and only for this one reader, which is the half-fix HO-030 §2 argues against",
        [
            (
                STORE,
                "    if (row.type === 'user_decision') return whoCancelledIt(asked.by as ActedBy | undefined)\n",
                "",
            )
        ],
    ),
]
