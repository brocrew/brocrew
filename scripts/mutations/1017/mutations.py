"""1017 · D-017 · an agent is never dead — the landing's table, from its first commit on.

⚑ **Why `1017`**: card D-00N's table is `100N`. D-017 lands in four commits; this table grows with
each, and the first, `3d295083`, takes the rows below.

## `3d295083` · one bad row never stops the app, and an empty transcript is gone for good

A fold that throws for one conversation's ledger no longer takes down a read over many or the launch
sweep: the per-ledger folds skip that ledger, warn naming it, and count it; single-ledger write doors
still throw; `new RuntimeHost` starts over a bad row. Every list that reports unread rows says
*"N conversations' records could not be read"*, and the digest degrades the same way.
`instructionAsksWaiting` guards torn rows with `json_valid`. Claude: a transcript with no user or
assistant record counts as gone for good (`noSuchSession`).

DEV wrote no new tests (the work model), so each group comes with the landing's new test file:

 * `M1`–`M19`   **skip, warn, count** — `a-bad-row-never-stops-the-app.test.ts`.
 * `M20`–`M29`  **the sentence and the digest** — `a-record-skipped-whole-says-so-everywhere.test.ts`.
 * `M30`–`M35`  **the torn-row guard** — `a-torn-instruction-row-does-not-stop-the-ledger.test.ts`.
 * `M40`–`M46`  **an empty transcript is gone** — `a-transcript-with-no-user-or-assistant-record-is-gone.test.ts`.

## `45a11477` · every delivery starts its recipient, and a person can answer a question that survived a quit

One start door (`ensureRunning`): every delivery to a stopped conversation starts it and delivers in
arrival order, every rail asked before the start; *still starting* and *still closing* are no longer
refusals. A stop is not an ending: held messages go at the next start, and only a cut handover is
abandoned. A person answers this app's questions from the asker's record, from the queue. *Waiting on
you* comes from the host's reads over every conversation. Stopped conversations are reachable and
listed within the caller's grant.

 * `M50`–`M59`  **one start door** — `a-start-that-costs-one-launch-or-none.test.ts`.
 * `M60`–`M69`  **a stop is not an ending** — `a-stop-is-not-an-ending.test.ts`.
 * `M70`–`M79`  **an answer a quit cannot lose** — `an-answer-a-quit-cannot-lose.test.ts`.
 * `M80`–`M89`  **Waiting on you from the host** — `waiting-on-you-draws-from-the-hosts-reads.dom.test.ts`.
 * `M90`–`M99`  **stopped conversations within reach** — `the-cap-on-stopped-conversations-a-caller-can-see.test.ts`.

## `5206d835` + `5bb7ff7f` · an agent is never dead

`end_agent` and `resume_agent` are gone: a message starts a stopped conversation, `interrupt_agent` stops
a turn. A conversation that can never be reopened is replaced by a new one of the same agent, project,
folder and parent. One state, derived once in `shared/agent-state.ts`. One list, newest first, 50 at
most, the caller's own first (`5bb7ff7f`); `no-such-agent` means only an id with no conversation.

 * `M100`–`M109`  **no ending, and what interrupt does** — `a-question-a-grandchild-asked-is-not-yours-to-cut-into.test.ts`.
 * `M110`–`M119`  **the replacement** — `what-a-replacement-carries-and-what-it-leaves-behind.test.ts`.
 * `M120`–`M129`  **one state** — `the-one-state-ranks-its-six-facts-in-one-order.test.ts`.
 * `M130`–`M139`, `M150`  **one list** — `one-list-newest-first-wherever-its-read.test.ts`, and DEV's re-aimed cap test.
 * `M140`–`M149`  **the rest** — `a-projects-agent-list-is-a-page-with-a-true-count.test.ts`.

## `3af91dcb` · D-017b, a conversation is a conversation, on screen too

Every conversation opens in one full view through the host's `look` door (attached, claimed, or a
recorded hand-over; nothing starts), a message continues it through `startAndSend`, one Conversations
list replaces the open / closed / kept-open split, and no press or sentence says whether a process runs.

 * `M160`–`M169`  **the look door** — `a-look-takes-what-a-press-may-take-and-nothing-else.test.ts`.
 * `M170`–`M179`  **sending continues it** — `a-message-from-a-conversations-view-goes-where-the-host-ruled.test.ts`.
 * `M180`–`M189`  **one list** — `the-one-list-says-what-the-host-says-newest-first.dom.test.ts`.
 * `M190`–`M199`  **one view** — `a-view-drawn-from-its-ledger-says-what-the-host-says.dom.test.ts`.

Designed read-only by Sonnet agents from each commit, the card and today's code; each row verified
alone by the landing agent.

## Verification

The landing agent verified every row alone with `verify_row.py` (applied, its own killer files run,
restored from bytes). The table has not been run.
- **RED: 41 of 41.** Each killer file ran green unmutated first.
- ⚠️ **Not rowed: the outer catch in `settleRestartedWork`'s per-candidate loop.** A plant that rethrows
  there SURVIVED (it was designed as `may-survive`): `tasksOfSession` already skips its own fold with
  `readOrSkip`, so nothing today reaches that catch. It is a second net, and a row on it would survive
  by construction. `M11` is therefore unused.
- **`45a11477`'s rows (M50–M99): RED 47 of 47** on their killers, after a second pass that found or wrote
  killers for five survivors.
- ⚠️ **Not rowed, with reasons:** `M51` (the arrival chain's FIFO) is masked by `ensureRunning`'s
  single-flight map for every caller shape today; `M55` (`itStoppedUnder`'s `||`) needs a close whose
  finalize has not begun at the catch, which the landing's test does not reach reliably, though
  `a-close-before-its-own-finalize-still-counts-as-a-stop.test.ts` still pins that path; `M67`
  (`whyItNoLongerGoes`'s withdrawn branch) is unreachable: every withdrawal ends its waiting message at
  once.
- **`5206d835` + `5bb7ff7f`'s rows (M100–M150): RED 49 of 49**, after a second pass that wrote the killer
  for `M141` (`a-same-project-caller-that-did-not-start-it-is-refused-before-a-launch.test.ts`: the tool
  layer's own reach check hides the host's, so the test calls the host door directly) and named DEV's
  re-aimed cap test for `M139`.
- ⚠️ **Not rowed:** `M119` (a second replacement for an id already replaced): every path to it resolves
  the replaced id first, so the check it plants into is never reached.
- ⚑ Commit 3 re-anchored `M18`, `M50`, `M90` and retired `M56`, `M61`, `M64`, `M91` (their comments
  say why).
- **`3af91dcb`'s rows (M160–M199): RED 36 of 36** on their killers. D-017b re-anchored `M96` and retired
  `M95` and `M98` (their comments say why).
"""

SESSION_STORE = "apps/desktop/src/main/db/session-store.ts"
AGENT_TOOLS = "apps/desktop/src/main/runtime/agent-tools.ts"
DIGEST = "apps/desktop/src/main/runtime/digest.ts"
INTERRUPT_RAILS = "apps/desktop/src/main/runtime/interrupt-rails.ts"
IPC = "apps/desktop/src/main/runtime/ipc.ts"
QUESTION_RAILS = "apps/desktop/src/main/runtime/question-rails.ts"
REPLY_RAILS = "apps/desktop/src/main/runtime/reply-rails.ts"
RUNTIME_HOST = "apps/desktop/src/main/runtime/runtime-host.ts"
SPAWN_RAILS = "apps/desktop/src/main/runtime/spawn-rails.ts"
CONVERSATION_PANE_VUE = "apps/desktop/src/renderer/src/components/ConversationPane.vue"
RUNTIME_SCREEN_VUE = "apps/desktop/src/renderer/src/components/RuntimeScreen.vue"
SIDE_RAIL_VUE = "apps/desktop/src/renderer/src/components/SideRail.vue"
ATTENTION = "apps/desktop/src/renderer/src/lib/attention.ts"
DIGEST_LIB = "apps/desktop/src/renderer/src/lib/digest.ts"
ACTIVITY_LIB = "apps/desktop/src/renderer/src/lib/recent-activity.ts"
ENDING_A_CONVERSATION = "apps/desktop/src/renderer/src/lib/ending-a-conversation.ts"
KEPT_OPEN = "apps/desktop/src/renderer/src/lib/kept-open.ts"
LOST_REPLY = "apps/desktop/src/renderer/src/lib/lost-reply.ts"
PERSONS_QUEUE = "apps/desktop/src/renderer/src/lib/persons-queue.ts"
ROWS_UNREAD = "apps/desktop/src/renderer/src/lib/rows-unread.ts"
SESSION_STORE_LIB = "apps/desktop/src/renderer/src/lib/session-store.ts"
THE_FOREST = "apps/desktop/src/renderer/src/lib/the-forest.ts"
WORK_GIVEN_OUT = "apps/desktop/src/renderer/src/lib/work-given-out.ts"
WORK_REPORT = "apps/desktop/src/renderer/src/lib/work-report.ts"
WORKING_TOGETHER = "apps/desktop/src/renderer/src/lib/working-together.ts"
AGENT_STATE = "apps/desktop/src/shared/agent-state.ts"
CLOCK = "apps/desktop/src/shared/clock.ts"
TASKS = "apps/desktop/src/shared/tasks.ts"
CLAUDE_RUNTIME = "packages/runtime/src/claude/claude-runtime.ts"

MUTATIONS: list[tuple[str, list[tuple[str, str, str]]]] = [
    (
        "M1 · a whole-ledger skip is also miscounted as one of its own unread rows — killed by `a-bad-row-never-stops-the-app.test.ts`",
        [
            (SESSION_STORE, "      if (ordinal === THE_WHOLE_LEDGER) {\n        skipped.add(sessionId)\n        return\n      }\n", "      if (ordinal === THE_WHOLE_LEDGER) {\n        skipped.add(sessionId)\n      }\n"),
        ],
    ),
    (
        "M2 · ledgersSkipped is read off the wrong Set (row-count instead of skip-count) — killed by `a-bad-row-never-stops-the-app.test.ts`",
        [
            (SESSION_STORE, "    get ledgersSkipped() {\n      return skipped.size\n    },\n", "    get ledgersSkipped() {\n      return seen.size\n    },\n"),
        ],
    ),
    (
        "M3 · skipTheLedger warns but never actually counts the ledger it names — killed by `a-bad-row-never-stops-the-app.test.ts`",
        [
            (SESSION_STORE, "  noteSkip?.(THE_WHOLE_LEDGER)\n}\n", "}\n"),
        ],
    ),
    (
        "M4 · a single-ledger write door no longer throws — it silently swallows the error instead — killed by `a-bad-row-never-stops-the-app.test.ts`",
        [
            (SESSION_STORE, "  if (noteSkip === undefined) return fold()\n  try {\n", "  try {\n"),
        ],
    ),
    (
        "M5 · readOrSkip's recovery rethrows instead of returning the fallback — killed by `a-bad-row-never-stops-the-app.test.ts`",
        [
            (SESSION_STORE, "    skipTheLedger(sessionId, error, noteSkip)\n    return nothing\n", "    skipTheLedger(sessionId, error, noteSkip)\n    throw error\n"),
        ],
    ),
    (
        "M6 · eachOrSkipped stops catching per-row — one throwing row crashes the whole list again — killed by `a-bad-row-never-stops-the-app.test.ts`",
        [
            (SESSION_STORE, "  return rows.flatMap((row) => readOrSkip(row[key], unread.in(row[key]), [], () => [build(row)]))\n", "  return rows.flatMap((row) => readOrSkip(row[key], undefined, [], () => [build(row)]))\n"),
        ],
    ),
    (
        "M7 · ledgersSkippedOf includes the key even at zero — killed by `a-bad-row-never-stops-the-app.test.ts`",
        [
            (SESSION_STORE, "  return count !== undefined && count > 0 ? { ledgersSkipped: count } : {}\n", "  return count !== undefined && count >= 0 ? { ledgersSkipped: count } : {}\n"),
        ],
    ),
    (
        "M8 · walkLedgers stops wrapping each candidate's fold — one bad candidate crashes the whole walk again — killed by `a-bad-row-never-stops-the-app.test.ts`",
        [
            (SESSION_STORE, "  const rows = candidates.flatMap((candidate) => {\n    const noteSkip = unread.in(candidate.id)\n    // 🔴 **D-017 · R8 — the outer net**: whatever else throws in one candidate's fold skips it.\n    return [\n      ...readOrSkip(candidate.id, noteSkip, [], () => foldOne(candidate.id, noteSkip, candidate)),\n    ]\n  })\n", "  const rows = candidates.flatMap((candidate) => {\n    const noteSkip = unread.in(candidate.id)\n    return [...foldOne(candidate.id, noteSkip, candidate)]\n  })\n"),
        ],
    ),
    (
        "M9 · instructionAsksWaiting's json_valid guard is inverted — every row is misread — killed by `the-layer-a-person-writes.test.ts`, `a-bad-row-never-stops-the-app.test.ts`",
        [
            # ⚑ **W4.506 · re-anchored in place, not retired** — an agent's request to register an MCP server is read the same way beside it, so the anchor now carries a line only this read has; the same defect. NOT VERIFIED
            (SESSION_STORE, "        // 🔴 **D-017 · R8 — one torn row is skipped, never the whole read** (`noteUnreadRow`).\n        if (row.readable === 0) {\n", "        // 🔴 **D-017 · R8 — one torn row is skipped, never the whole read** (`noteUnreadRow`).\n        if (row.readable === 1) {\n"),
        ],
    ),
    (
        "M10 · a row with no ask id is silently admitted as a phantom ask — killed by `a-bad-row-never-stops-the-app.test.ts`",
        [
            (SESSION_STORE, "if (typeof event?.askId !== 'string') throw new Error('an instruction row with no ask id')", "if (false && typeof event?.askId !== 'string') throw new Error('an instruction row with no ask id')"),
        ],
    ),
    (
        "M12 · the sweep's line is suppressed on an ordinary settle (guard AND turned into OR) — killed by `a-bad-row-never-stops-the-app.test.ts`",
        [
            (RUNTIME_HOST, "  if (settled === 0 && skipped.ledgersSkipped === 0) return\n", "  if (settled === 0 || skipped.ledgersSkipped === 0) return\n"),
        ],
    ),
    (
        "M13 · the sweep's message and its skipped-count suffix are on the wrong branches — killed by `a-bad-row-never-stops-the-app.test.ts`",
        [
            (RUNTIME_HOST, "    skipped.ledgersSkipped === 0\n      ? line\n      : `${line}; ${String(skipped.ledgersSkipped)} ledger(s) skipped`,\n", "    skipped.ledgersSkipped === 0\n      ? `${line}; ${String(skipped.ledgersSkipped)} ledger(s) skipped`\n      : line,\n"),
        ],
    ),
    (
        "M14 · the constructor stops handing settleStrandedRequests its skip counter — killed by `nothing-waits-on-somebody-looking.test.ts`",
        [
            (RUNTIME_HOST, "    const asked = this.deps.store.settleStrandedRequests(this.now(), stillOpen, askedSkipped)\n", "    const asked = this.deps.store.settleStrandedRequests(this.now(), stillOpen)\n"),
        ],
    ),
    (
        "M15 · walkLedgers reports the row-tear count as if it were the ledger-skip count — killed by `a-bad-row-never-stops-the-app.test.ts`",
        [
            (SESSION_STORE, "    ...ledgersSkippedOf(unread.ledgersSkipped),\n", "    ...ledgersSkippedOf(unread.count),\n"),
        ],
    ),
    (
        "M16 · recordsOf's singular/plural boundary is off by one — killed by `a-bad-row-never-stops-the-app.test.ts`",
        [
            (AGENT_TOOLS, "  count === 1 ? \"1 conversation's record\" : `${String(count)} conversations' records`\n", "  count === 0 ? \"1 conversation's record\" : `${String(count)} conversations' records`\n"),
        ],
    ),
    (
        "M17 · one skipped-ledger sentence is silently dropped from a tool's answer — killed by `a-bad-row-never-stops-the-app.test.ts`",
        # ⚑ Landing D-016a (bd70d693) · re-anchored in place, not retired — The line M17 planted on was
        # list_projects' `whenSkipped(reading.ledgersSkipped, ...)`, which is gone. The rule survives at
        # the two readers that still splice the sentence: list_tasks and list_questions. The plant now
        # drops list_tasks' line (count 1).
        # ⚑ Landing D-016b (5e931be8, the tree) · re-anchored in place, not retired — list_tasks
        # still splices the skipped-records sentence through `unreadLines`, and the source census in
        # the killer pins that line; only the indent changed (12 spaces, not 14). The plant comments
        # the `whenSkipped` line out. Killed by `a-bad-row-never-stops-the-app.test.ts`.
        [
            (AGENT_TOOLS, "            ...whenSkipped(ledgersSkipped, skippedRecordsSentence),\n", "            // ...whenSkipped(ledgersSkipped, skippedRecordsSentence),\n"),
        ],
    ),
    (
        "M18 · a child that left claims its record could not be read exactly when it COULD — killed by `a-bad-row-never-stops-the-app.test.ts`",
        # ⚑ Landing D-017 (5206d835) · re-anchored in place, not retired — The `cardText` suffix logic
        # in D-017's code is unchanged in behavior; only the local variable was renamed from `one` to
        # `card` (agent-tools.ts:3582), which is why the exact old text no longer matches. The defect —
        # a healthy conversation's line falsely claiming its record could not be read — is exactly what
        # `a-bad-row-never-stops-the-app.test.ts` §7 (lines 697-710) pins today.
        [
            (AGENT_TOOLS, "  (card.ledgersSkipped === 0 ? '' : ' · its record could not be read')\n", "  (card.ledgersSkipped === 0 ? ' · its record could not be read' : '')\n"),
        ],
    ),
    (
        "M19 · a live agent's card claims its record could not be read exactly when it COULD — killed by `a-bad-row-never-stops-the-app.test.ts`",
        [
            (AGENT_TOOLS, "  (card.ledgersSkipped === 0 ? '' : ' · its record could not be read')\n", "  (card.ledgersSkipped === 0 ? ' · its record could not be read' : '')\n"),
        ],
    ),
    (
        "M20 · a single skipped ledger never gets its own work-may-be-missing sentence (the threshold needs two, not one) — killed by `a-record-skipped-whole-says-so-everywhere.test.ts`",
        [
            (ROWS_UNREAD, "ledgersSkipped !== undefined && ledgersSkipped > 0\n      ? `${recordsOf(ledgersSkipped)} could not be read, so a piece of work may be missing here, or its state may be wrong.`", "ledgersSkipped !== undefined && ledgersSkipped > 1\n      ? `${recordsOf(ledgersSkipped)} could not be read, so a piece of work may be missing here, or its state may be wrong.`"),
        ],
    ),
    (
        "M21 · a single skipped ledger never gets its own WAITING sentence either (same off-by-one, the other composer) — killed by `a-record-skipped-whole-says-so-everywhere.test.ts`",
        [
            (ROWS_UNREAD, "ledgersSkipped !== undefined && ledgersSkipped > 0\n      ? `${recordsOf(ledgersSkipped)} could not be read, so a conversation shown here may be waiting without saying so.`", "ledgersSkipped !== undefined && ledgersSkipped > 1\n      ? `${recordsOf(ledgersSkipped)} could not be read, so a conversation shown here may be waiting without saying so.`"),
        ],
    ),
    (
        "M22 · a digest project is read as torn only when BOTH an unread row and a skipped ledger occurred, instead of either alone — killed by `a-record-skipped-whole-says-so-everywhere.test.ts`",
        # ⚑ Landing D-016a (bd70d693) · re-anchored in place, not retired — The rule survives in
        # `silenceOf`. The digest is now one window, so the per-project loop variable is `digest` and
        # not `project`. The read is torn when an unread row OR a skipped ledger occurred, and the plant
        # turns that `||` into `&&` at the new line (count 1).
        # ⚑ **Recent activity replaced the digest card · re-anchored in place, not retired** — the either-or rule moved to Recent activity's `activitySays`, unchanged; the plant still turns `||` into `&&`.
        [(ACTIVITY_LIB, "if (reading.read.rowsUnread > 0 || (reading.read.ledgersSkipped ?? 0) > 0) return 'read-in-part'", "if (reading.read.rowsUnread > 0 && (reading.read.ledgersSkipped ?? 0) > 0) return 'read-in-part'")],
    ),
    (
        "M23 · the digest's source-skipped gap counts unread ROWS instead of whole ledgers skipped — killed by `a-record-skipped-whole-says-so-everywhere.test.ts`",
        [
            (DIGEST, "gap('source-skipped', read.ledgersSkipped ?? 0),", "gap('source-skipped', read.rowsUnread),"),
        ],
    ),
    (
        "M24 · the source-skipped gap's singular/plural wording is swapped — killed by `a-record-skipped-whole-says-so-everywhere.test.ts`",
        [
            (DIGEST, "many(count, 'conversation’s record', 'conversations’ records')", "many(count, 'conversations’ records', 'conversation’s record')"),
        ],
    ),
    (
        "M25 · the D-017 guard on `empty` is effectively disabled, so a conversation reads as having given nobody work even while a ledger was skipped whole — killed by `a-record-skipped-whole-says-so-everywhere.test.ts`",
        [
            (WORK_GIVEN_OUT, "!((reading.walk.ledgersSkipped ?? 0) > 0)", "!((reading.walk.ledgersSkipped ?? 0) > 999999)"),
        ],
    ),
    (
        "M26 · working-together.ts offers a row count for a list even when one of its ledgers was skipped whole — killed by `a-record-skipped-whole-says-so-everywhere.test.ts`",
        [
            (WORKING_TOGETHER, "answered && doubt === null && walk.rowsUnread === 0 && (walk.ledgersSkipped ?? 0) === 0", "answered && doubt === null && walk.rowsUnread === 0"),
        ],
    ),
    (
        "M27 · working-together.ts's list never reports how many of its own ledgers were skipped — killed by `a-record-skipped-whole-says-so-everywhere.test.ts`",
        [
            (WORKING_TOGETHER, "skipped: walk.ledgersSkipped ?? 0,", "skipped: 0,"),
        ],
    ),
    (
        "M28 · distilSkipping keeps the bad ledger's rows in its retry instead of dropping them, so an isolable single bad ledger is wrongly escalated to 'skip everything', losing the good conversation's own work too — killed by `a-record-skipped-whole-says-so-everywhere.test.ts`",
        [
            (DIGEST, "rows: read.rows.filter((row) => !skipped.has(row.sessionId)),", "rows: read.rows,"),
        ],
    ),
    (
        "M29 · the forest's coverage sentence drops a whole record skipped and reports only unread rows — killed by `a-record-skipped-whole-says-so-everywhere.test.ts`",
        [
            (THE_FOREST, "short: unreadSays(forest.nodes.rowsUnread, forest.nodes.ledgersSkipped),", "short: unreadSays(forest.nodes.rowsUnread, undefined),"),
        ],
    ),
    (
        "M30 · a readable instruction row is treated as torn and dropped, so every real ask silently disappears from a person's queue — killed by `a-torn-instruction-row-does-not-stop-the-ledger.test.ts`, `the-layer-a-person-writes.test.ts`",
        [
            (SESSION_STORE, "        // 🔴 **D-017 · R8 — one torn row is skipped, never the whole read** (`noteUnreadRow`).\n        if (row.readable === 0) {", "        // 🔴 **D-017 · R8 — one torn row is skipped, never the whole read** (`noteUnreadRow`).\n        if (row.readable === 1) {"),
        ],
    ),
    (
        "M31 · the missing-askId guard is inverted: a real ask is thrown out as unreadable while a row with no askId is accepted — killed by `a-torn-instruction-row-does-not-stop-the-ledger.test.ts`, `the-layer-a-person-writes.test.ts`",
        [
            (SESSION_STORE, "if (typeof event?.askId !== 'string') throw new Error('an instruction row with no ask id')", "if (typeof event?.askId === 'string') throw new Error('an instruction row with no ask id')"),
        ],
    ),
    (
        "M32 · the missing-askId guard is disabled, so a malformed instruction row is folded in with an undefined askId instead of being skipped — killed by `a-torn-instruction-row-does-not-stop-the-ledger.test.ts`",
        [
            (SESSION_STORE, "if (typeof event?.askId !== 'string') throw new Error('an instruction row with no ask id')", "if (false) throw new Error('an instruction row with no ask id')"),
        ],
    ),
    (
        "M33 · a torn instruction row's catch rethrows instead of skipping it, so one malformed row crashes the whole waiting-on-a-person read — killed by `a-torn-instruction-row-does-not-stop-the-ledger.test.ts`",
        [
            # ⚑ **W4.506 · re-anchored in place, not retired** — an agent's request to register an MCP server is read the same way beside it, so the anchor now carries a line only this read has; the same defect. NOT VERIFIED
            (SESSION_STORE, "          if (typeof event?.askId !== 'string') throw new Error('an instruction row with no ask id')\n          return [{ conversation: row.conversation, at: row.at, event }]\n        } catch (error) {\n          console.warn(\n            `session ledger: ${row.conversation} ordinal ${String(row.ordinal)} could not be read ` +\n              `and was skipped (${error instanceof Error ? error.message : String(error)})`,\n          )\n          return []\n        }\n", "          if (typeof event?.askId !== 'string') throw new Error('an instruction row with no ask id')\n          return [{ conversation: row.conversation, at: row.at, event }]\n        } catch (error) {\n          console.warn(\n            `session ledger: ${row.conversation} ordinal ${String(row.ordinal)} could not be read ` +\n              `and was skipped (${error instanceof Error ? error.message : String(error)})`,\n          )\n          throw error\n        }\n"),
        ],
    ),
    (
        "M34 · instruction_settled rows are no longer read, so an approved or refused ask is never removed from the waiting list — killed by `the-layer-a-person-writes.test.ts`",
        [
            (SESSION_STORE, "      WHERE type IN ('instruction_proposed', 'instruction_settled')", "      WHERE type IN ('instruction_proposed')"),
        ],
    ),
    (
        "M35 · a waiting ask's timestamp is read off its ordinal instead of its clock time, misordering a person's queue — killed by `a-torn-instruction-row-does-not-stop-the-ledger.test.ts`",
        [
            # ⚑ **W4.506 · re-anchored in place, not retired** — an agent's request to register an MCP server is read the same way beside it, so the anchor now carries a line only this read has; the same defect. NOT VERIFIED
            (SESSION_STORE, "          if (typeof event?.askId !== 'string') throw new Error('an instruction row with no ask id')\n          return [{ conversation: row.conversation, at: row.at, event }]", "          if (typeof event?.askId !== 'string') throw new Error('an instruction row with no ask id')\n          return [{ conversation: row.conversation, at: row.ordinal, event }]"),
        ],
    ),
    (
        "M40 · the transcript-content check (holdsAConversation) is dropped — any merely-existing file counts as a held conversation — killed by `a-transcript-with-no-user-or-assistant-record-is-gone.test.ts`",
        [
            (CLAUDE_RUNTIME, "      return stillThere(path) && holdsAConversation(path)", "      return stillThere(path)"),
        ],
    ),
    (
        "M41 · an unreadable transcript file is read as gone instead of present — killed by `a-transcript-with-no-user-or-assistant-record-is-gone.test.ts`",
        [
            (CLAUDE_RUNTIME, "  try {\n    fd = openSync(path, 'r')\n  } catch {\n    return true\n  }", "  try {\n    fd = openSync(path, 'r')\n  } catch {\n    return false\n  }"),
        ],
    ),
    (
        "M42 · the 1 MB budget being spent is read as gone instead of present — killed by `a-transcript-with-no-user-or-assistant-record-is-gone.test.ts`",
        [
            (CLAUDE_RUNTIME, "    return true\n  } catch {\n    return true\n  } finally {", "    return false\n  } catch {\n    return true\n  } finally {"),
        ],
    ),
    (
        "M43 · reaching the end of the transcript always answers present, regardless of content — killed by `a-transcript-with-no-user-or-assistant-record-is-gone.test.ts`",
        [
            (CLAUDE_RUNTIME, "      if (read === 0) return isAConversationRecord(partial + decoder.end())", "      if (read === 0) return true"),
        ],
    ),
    (
        "M44 · a line that fails to parse as JSON is read as a conversation record instead of being skipped — killed by `a-transcript-with-no-user-or-assistant-record-is-gone.test.ts`",
        [
            (CLAUDE_RUNTIME, "    record = JSON.parse(line)\n  } catch {\n    return false\n  }", "    record = JSON.parse(line)\n  } catch {\n    return true\n  }"),
        ],
    ),
    (
        "M45 · a bare JSON null record is treated as a conversation instead of a non-object — killed by `a-transcript-with-no-user-or-assistant-record-is-gone.test.ts`",
        [
            (CLAUDE_RUNTIME, "  if (record === null || typeof record !== 'object') return false", "  if (typeof record !== 'object') return false"),
        ],
    ),
    (
        "M46 · any record with a string type field counts as a conversation, not just user/assistant — killed by `a-transcript-with-no-user-or-assistant-record-is-gone.test.ts`",
        [
            (CLAUDE_RUNTIME, "  return type === 'user' || type === 'assistant'", "  return typeof type === 'string'"),
        ],
    ),
    (
        "M50 · A delivery to a conversation that is not running is handed straight to the send, skipping its own start. — killed by `agents-ask-each-other.test.ts`, `who-can-i-talk-to.test.ts`, `a-start-that-costs-one-launch-or-none.test.ts`",
        # ⚑ Landing D-017 (5206d835) · re-anchored in place, not retired — D-017 rule 1 is still 'every
        # rail is asked before the start, and a stopped conversation is started by the message that
        # reaches it' — `deliverWhenItRuns`'s `inLine` closure still gates delivery on `runsNow(to)`,
        # calling `ensureRunning` only in the else arm (runtime-host.ts ~14832-14837). Inverting that
        # condition hands a stopped conversation straight to `deliver` with no start, exactly the row's
        # defect, just moved from a top-level `refuseBeforeAStart` guard into this closure's branch.
        [
            (RUNTIME_HOST, "      if (this.runsNow(to)) {\n        this.aPersonsWindowTakesIt(to, theSurfaceAsking(by))\n        return deliver(to)\n      }\n      await this.refuseBeforeAStart(to, text, by, attachments, says)", "      if (!this.runsNow(to)) {\n        this.aPersonsWindowTakesIt(to, theSurfaceAsking(by))\n        return deliver(to)\n      }\n      await this.refuseBeforeAStart(to, text, by, attachments, says)"),
        ],
    ),
    (
        "M52 · A caller outside a conversation's reach is admitted to start and message it, because the reach check that runs before the start is disabled. — killed by `send-refusals.test.ts`, `a-start-that-costs-one-launch-or-none.test.ts`",
        [
            (RUNTIME_HOST, "if (!this.withinMessagingReach(sessionId, by, me)) {\n        throw new Error(`unknown session: ${sessionId}`)", "if (false) {\n        throw new Error(`unknown session: ${sessionId}`)"),
        ],
    ),
    (
        "M53 · A delivery's start no longer waits for a conversation still on its way out (or mid-reservation) to settle before attempting to reopen it. — killed by `the-promise-a-rail-could-not-keep.test.ts`",
        [
            (RUNTIME_HOST, "while (slot !== undefined && !this.runsNow(sessionId)) {", "while (slot !== undefined && !this.runsNow(sessionId) && false) {"),
        ],
    ),
    (
        "M54 · A reply the giver was actually SENT is recorded as though it never landed. — killed by `a-question-is-not-work.test.ts`",
        [
            (REPLY_RAILS, "  sent: true,\n  held: true,\n  'not-delivered': false,", "  sent: false,\n  held: true,\n  'not-delivered': false,"),
        ],
    ),
    (
        "M56 · end_agent's answer claims the conversation was permanently ended rather than merely stopped. — killed by `the-card-a-third-party-was-holding.test.ts`, `the-project-a-spawn-lands-in.test.ts`",
        # ⛔ **RETIRED BY RULING (landing D-017, 5206d835):** Commit message: "end_agent and resume_agent
        # are gone (21 tools). Nothing ends a conversation." There is no `end_agent` tool handler left
        # in agent-tools.ts at all — no `'outcome: ok', agent, state: 'stopped'` (or 'ended') answer
        # shape exists anymore to plant this defect in. Its anchor is left stale, so the census records
        # it retired.
        [
            (AGENT_TOOLS, "{ outcome: 'ok', agent, state: 'stopped' },", "{ outcome: 'ok', agent, state: 'ended' },"),
        ],
    ),
    (
        "M57 · An empty/whitespace-only message to a conversation that is not running is no longer refused before the start — the conversation is started for nothing to send. — killed by `send-refusals.test.ts`, `a-first-message-starts-it-in-one-act.test.ts`",
        [
            (RUNTIME_HOST, "if (!hasSomethingToSend(text, attachments.length)) throw new Error(NOTHING_TO_SEND)", "if (false) throw new Error(NOTHING_TO_SEND)"),
        ],
    ),
    (
        "M58 · A message whose attachment vanished is no longer refused before starting the stopped conversation it was addressed to. — killed by `send-refusals.test.ts`, `a-first-message-starts-it-in-one-act.test.ts`",
        [
            (RUNTIME_HOST, "const handed = await recheckHandedPaths(attachments, cwd)\n    if ('refusal' in handed) throw new Error(handed.refusal)\n  }", "const handed = await recheckHandedPaths(attachments, cwd)\n    if (false) throw new Error(handed.refusal)\n  }"),
        ],
    ),
    (
        "M59 · A message to an id this app has no row for, or cannot start, is no longer refused as unknown before a start is attempted. — killed by `send-refusals.test.ts`",
        [
            (RUNTIME_HOST, "} else if (row === null || this.startable(sessionId) === null) {\n      throw new Error(`unknown session: ${sessionId}`)", "} else if (false) {\n      throw new Error(`unknown session: ${sessionId}`)"),
        ],
    ),
    (
        "M60 · the routed-request fold never sees `question_asked`/`launched`, so this app's own question no longer outlives a stop — every open request is abandoned on a terminal status again, as if D-017 never shipped — killed by `a-models-own-question-stays-the-models.test.ts`",
        [
            # The shared routing mask still selects both kinds; omit them from that same read.
            (SESSION_STORE, "  'question_recipient_ended',\n  'question_asked',\n  'launched',\n  'status',\n", "  'question_recipient_ended',\n  'status',\n"),
        ],
    ),
    (
        "M61 · `end_agent`'s own stop no longer drops what it held — with the AND turned into an OR, a message is handed to the next start even when its own parent ended the conversation — killed by `what-a-close-does-that-a-reopen-never-undoes.test.ts`",
        # ⛔ **RETIRED BY RULING (landing D-017, 5206d835):** This row plants a defect in `end_agent`'s
        # own stop logic (`cut && endedByItsParent`), and `end_agent` is one of the two tools the commit
        # removes on purpose (card: "end_agent and resume_agent are gone"). `endedByItsParent` has zero
        # occurrences anywhere in the current tree — the field and the mechanic it gated are both gone,
        # not renamed. Its anchor is left stale, so the census records it retired.
        [
            (RUNTIME_HOST, "if (!cut && !endedByItsParent) {", "if (!cut || !endedByItsParent) {"),
        ],
    ),
    (
        "M62 · mid-handover detection is disabled — a message actually in flight when its conversation stops is silently handed to the next start instead of being recorded as an uncertain 'abandoned' — killed by `queued-message.test.ts`",
        # ⚑ Landing D-027, the ui stretch to 3ef68f7f and D-038 · re-anchored in place, not retired —
        # handingOver went from a single QueuedMessage to a turn's worth (D-027), so the cut is read as
        # `session.handingOver.includes(queued)`. The rule survives: a message in flight when its
        # conversation stops is abandoned with the 'may have reached the agent' sentence, and the plant
        # disables that detection so it is handed on instead. Killed by `queued-message.test.ts`.
        [
            (RUNTIME_HOST, "const cut = session.handingOver.includes(queued)", "const cut = false"),
        ],
    ),
    (
        "M63 · `messagesWaitingIn`'s own filter is inverted — it never finds the message a quit left open, so the next start never takes it back — killed by `the-message-that-has-no-name.test.ts`",
        [
            # ⚑ **W4.205 · re-anchored in place, not retired** — W4.205 · the held messages are now read in one pass and paired in code; the plant inverts the same filter there, so a message a quit left open is never found
            (SESSION_STORE, "          row.message_id !== null &&\n", "          row.message_id === null &&\n"),
        ],
    ),
    (
        "M64 · the asker-told-it-ended guard is inverted — every OTHER stop (Close, quit, provider failure) now falsely tells an asker its recipient's conversation ended, and `end_agent` itself falls silent — killed by `agents-ask-each-other.test.ts`, `a-models-own-question-stays-the-models.test.ts`",
        # ⛔ **RETIRED BY RULING (landing D-017, 5206d835):** `tellTheAskersItEnded`/`endedByItsParent`
        # no longer exist anywhere in runtime-host.ts (zero grep hits). The concept they served —
        # telling an asker its recipient's conversation "ended" — is deliberately gone:
        # `agents-ask-each-other.test.ts`'s re-aimed test now asserts the OPPOSITE, that a stop tells
        # the asker nothing (`toldIn(ada.id)... .includes("${bo.id}'s conversation
        # ended")).toBe(false)`), since "a Close is a STOP, and a stop ends nothing" (D-017 R3). The
        # only 'told once' left is the unrelated, one-time could-not-be-reopened replacement notice. Its
        # anchor is left stale, so the census records it retired.
        [
            (RUNTIME_HOST, "if (session.endedByItsParent !== null) this.tellTheAskersItEnded(session.id)", "if (session.endedByItsParent === null) this.tellTheAskersItEnded(session.id)"),
        ],
    ),
    (
        "M65 · the automatic restart-for-what-it-held is disabled at its call site — a Close hands a message on in the ledger, but nothing ever starts the conversation again to send it — killed by `the-message-that-has-no-name.test.ts`",
        [
            # Disable the held-message wake while leaving its positive exit-proof barrier in place.
            (RUNTIME_HOST, "        if (\n          this.heldAtAStop\n            .get(session.id)\n            ?.some(\n              (queued) => queued.authorship.appNotice !== 'a-scheduled-job-that-will-not-run',\n            ) &&\n          !this.signInStops.has(session) &&\n          session.diedOnAStaleSignIn !== true\n        ) {", "        if (false) {"),
        ],
    ),
    (
        "M66 · a resumed (second-generation) conversation writes no `launched` row of its own — only the very first life ever gets one — killed by `a-stop-is-not-an-ending.test.ts`",
        [
            (RUNTIME_HOST, "    this.publishOurs(session, {\n      type: 'launched',\n", "    if (false) this.publishOurs(session, {\n      type: 'launched',\n"),
        ],
    ),
    (
        "M68 · the notice-suppression rule for a stopped-but-startable holder is inverted — a worker that came back open (and that a message could still start) is now treated as gone for good, and vice versa, so the wrong 'not being worked on' sentence is chosen — killed by `what-a-close-does-that-a-reopen-never-undoes.test.ts`",
        # ⛔ **RETIRED BY RULING (landing D-016c, 8d54d6dc, a stop changes nothing about a piece):**
        # The plant is on itCanStillBeStarted / aNoticeIsOwed, which were removed together with the
        # kept-open receipt and its notices. Commit 8d54d6dc: "Gone with it: the kept-open receipt
        # and notices, the window's left-open and idle words ... and the unwind of an ending"; a
        # start now tells nobody anything, so there is no notice to owe or gate. Its anchor is left
        # stale, so the census records it retired.
        [
            (SESSION_STORE, "return row !== undefined && aRowADeliveryCanStart(recordedOf(row))", "return row !== undefined && !aRowADeliveryCanStart(recordedOf(row))"),
        ],
    ),
    (
        "M69 · the startup repair sweep's skip is inverted — a provider's own stranded request is skipped (left open forever) while this app's own questions get wrongly stranded — killed by `a-question-finds-a-person.test.ts`",
        [
            (SESSION_STORE, "if (raised?.get(request.requestId)?.raisedBy === 'this-app') continue", "if (raised?.get(request.requestId)?.raisedBy !== 'this-app') continue"),
        ],
    ),
    (
        "M70 · an answer kept for its stopped asker says only that it is recorded, dropping that it is KEPT — killed by `an-answer-a-quit-cannot-lose.test.ts`",
        # ⚑ Landing D-016c commits 6–7 and D-022 (4a7f0fec, c1a79abe, 37228461) · re-anchored in
        # place, not retired — The answer-kept sentence lives in `anAnswerKeptForItsStart`, and its
        # current text is `The answer is recorded and kept for ${asker}: it goes to that
        # conversation first when it next starts. ...` (the old 'it goes to ${asker} first when that
        # conversation next starts' wording is gone). The plant drops 'and kept', which is the
        # label's defect: the sentence says only that the answer is recorded. The killer asserts
        # 'The answer is recorded and kept for' at line 340. Killed by
        # `an-answer-a-quit-cannot-lose.test.ts`.
        [
        # ⚑ W4.172 · re-anchored in place: the sentence now adds that a usage limit can only make it
        # later. The plant still drops 'and kept'.
            (RUNTIME_HOST, "`The answer is recorded and kept for ${asker}: it goes to that conversation first when it next starts, or later if its provider’s usage limit holds then. It could not be started now — ${why}`", "`The answer is recorded for ${asker}: it goes to that conversation first when it next starts, or later if its provider’s usage limit holds then. It could not be started now — ${why}`"),
        ],
    ),
    (
        "M71 · a failed restart after an answer loses the words instead of holding them for the asker's next start — killed by `an-answer-a-quit-cannot-lose.test.ts`",
        [
            # ⚑ **W4.78 · re-anchored in place, not retired** — c118ae04 gave holdUntilItStarts a lane and a callback recording the held id (heldAs), and 0c50fe0b dropped ensureRunning's third argument; the anchor is the not-running branch (4-space indent; the 8-space hold in the catch above stays). Killer 'when the stopped asker cannot be started again, the answer is kept' still applies.
            (RUNTIME_HOST, "    this.holdUntilItStarts(asker, text, facts, undefined, (_where, id) => {\n      heldAs.id = id\n    })\n    try {\n      await this.ensureRunning(asker, window)", "    try {\n      await this.ensureRunning(asker, window)"),
        ],
    ),
    (
        "M72 · a person's answer to this app's own question is refused even when the question is a person's to answer — killed by `an-answer-a-quit-cannot-lose.test.ts`",
        [
            (RUNTIME_HOST, "    if (!aPersonIsAsking(by) || (!aPersons && !inTheirWindow)) {", "    if (!aPersonIsAsking(by) || (!aPersons && !inTheirWindow) || true) {"),
        ],
    ),
    (
        "M73 · answering this app's question from the queue quietly needs the conversation held again — the take-over comes back — killed by `an-answer-a-quit-cannot-lose.test.ts`",
        [
            (RUNTIME_HOST, "    if (!aPersonIsAsking(by) || (!aPersons && !inTheirWindow)) {", "    if (!aPersonIsAsking(by) || !inTheirWindow) {"),
        ],
    ),
    (
        "M74 · a second answer to a question this app already closed is accepted instead of refused — killed by `an-answer-a-quit-cannot-lose.test.ts`",
        [
            (RUNTIME_HOST, "    if (admitAnswer(request) !== null) {", "    if (false) {"),
        ],
    ),
    (
        "M75 · a person cannot answer this app's own question once its asker has stopped — killed by `an-answer-a-quit-cannot-lose.test.ts`",
        [
            (RUNTIME_HOST, "    const asked = this.theWordsOf(sessionId, requestId)\n    if (asked !== undefined) {", "    const asked = this.theWordsOf(sessionId, requestId)\n    if (asked !== undefined && this.slots.get(sessionId)?.session != null) {"),
        ],
    ),
    (
        "M76 · a provider request in a conversation nobody spawned is never routed to the person — back to being silently dropped — killed by `a-question-finds-a-person.test.ts`",
        [
            (RUNTIME_HOST, "    if (parent === null) {\n      return this.recordOurs(session, {\n        type: 'request_routed',\n        requestId: verdict.id,\n        to: 'a-person',\n        ...(verdict.travels ? {} : { because: verdict.because }),\n      })\n    }", "    if (parent === null) {\n      return null\n    }"),
        ],
    ),
    (
        "M77 · a person told their already-answered question reads a shortened, wrong-shaped sentence — killed by `a-second-answer-hears-the-apps-own-full-sentence.test.ts`",
        [
            (QUESTION_RAILS, "  answered: 'That question was already answered, so your answer was not sent.',", "  answered: 'That question was already answered.',"),
        ],
    ),
    (
        "M78 · a root a delivery started with no window can never be taken by a person's window — R5 disabled everywhere — killed by `an-answer-a-quit-cannot-lose.test.ts`",
        [
            (RUNTIME_HOST, "    if (window === null || !this.aPersonsWindowMayTakeIt(sessionId, window)) return null", "    if (true) return null"),
        ],
    ),
    (
        "M79 · a person answering a permission card in a conversation nobody spawned no longer takes it first — killed by `an-answer-a-quit-cannot-lose.test.ts`",
        [
            (RUNTIME_HOST, "  async respondPermission(\n    sessionId: string,\n    requestId: string,\n    decision: PermissionDecision,\n    by: Caller,\n  ): Promise<ProviderAnswerAck> {\n    // ⚑ **D-017 · R5** — a person answering a card in a conversation nobody spawned takes it.\n    this.aPersonsWindowTakesIt(sessionId, theSurfaceAsking(by))", "  async respondPermission(\n    sessionId: string,\n    requestId: string,\n    decision: PermissionDecision,\n    by: Caller,\n  ): Promise<ProviderAnswerAck> {"),
        ],
    ),
    (
        "M80 · listedNowhereElse stops excluding a routed card — it is drawn a second time in the live queue — killed by `waiting-on-you-draws-from-the-hosts-reads.dom.test.ts`",
        [
            (ATTENTION, "request.routed !== true", "request.routed !== false"),
        ],
    ),
    (
        "M81 · listedNowhereElse keeps only proposals — every permission and question disappears from the live queue — killed by `waiting-on-you-draws-from-the-hosts-reads.dom.test.ts`",
        # ⚑ Landing D-016a (bd70d693) · re-anchored in place, not retired — The rule survives:
        # listedNowhereElse must keep the permission and question cards that nothing routed. D-016
        # removed the `kind !== 'proposal'` clause and the kind is now only 'permission' | 'question',
        # so the function is `request.routed !== true`. The plant keeps only what is neither a
        # permission nor a question, so every card vanishes from the live queue. The label's word
        # 'proposals' is historical.
        [
            (ATTENTION, "  return requests.filter((request) => request.routed !== true)", "  return requests.filter((request) => request.routed !== true && request.kind !== 'permission' && request.kind !== 'question')"),
        ],
    ),
    (
        "M82 · instructionAsksView swallows a genuinely failed read as 'nobody has looked yet' — killed by `waiting-on-you-draws-from-the-hosts-reads.dom.test.ts`",
        [
            (PERSONS_QUEUE, "if (instructionAsksForAPerson === null && lastLookAnswered) return null", "if (instructionAsksForAPerson === null) return null"),
        ],
    ),
    (
        "M83 · instructionAsksView never marks a stopped-answering read as stale — killed by `waiting-on-you-draws-from-the-hosts-reads.dom.test.ts`",
        [
            # ⚑ **W4.506 · re-anchored in place, not retired** — the agents' requests to register an MCP server have a view of the same shape beside it, so the anchor now carries a line only this view has; the same defect. NOT VERIFIED
            (PERSONS_QUEUE, "    partial: instructionAsksForAPerson === null,\n    stale: !lastLookAnswered,", "    partial: instructionAsksForAPerson === null,\n    stale: false,"),
        ],
    ),
    (
        "M84 · cornerHead treats a short (unread) queue view as all-clear, letting the asks' hole override the queue's own — killed by `waiting-on-you-draws-from-the-hosts-reads.dom.test.ts`",
        [
            (PERSONS_QUEUE, "const allClear = view.count === 0 && !view.mayBeShort", "const allClear = view.count === 0"),
        ],
    ),
    (
        "M85 · asksCounted always says 'asks', even for exactly one — killed by `waiting-on-you-draws-from-the-hosts-reads.dom.test.ts`",
        [
            (PERSONS_QUEUE, "return count === 1 ? \"1 ask to set an agent's rules\" : `${count} asks to set agents' rules`", "return `${count} asks to set agents' rules`"),
        ],
    ),
    (
        "M86 · supply() ignores whatever asks it is given — the queue never learns about an instruction ask — killed by `waiting-on-you-draws-from-the-hosts-reads.dom.test.ts`",
        [
            (PERSONS_QUEUE, "asked.value = nextAsks ?? NOBODY_HAS_LOOKED_FOR_AN_ASK", "asked.value = NOBODY_HAS_LOOKED_FOR_AN_ASK"),
        ],
    ),
    (
        "M87 · mayBeShort stops noticing a stopped-answering look for asks — killed by `waiting-on-you-draws-from-the-hosts-reads.dom.test.ts`",
        [
            (PERSONS_QUEUE, "      asks.value?.stale === true ||", ""),
        ],
    ),
    (
        "M88 · decideInstruction hands the door its askId and approve swapped — killed by `waiting-on-you-draws-from-the-hosts-reads.dom.test.ts`",
        [
            (PERSONS_QUEUE, "doors?.decideInstruction?.(askId, approve)", "doors?.decideInstruction?.(approve, askId)"),
        ],
    ),
    (
        "M89 · instructionAsksView swaps who asked for whose rules on every row — killed by `waiting-on-you-draws-from-the-hosts-reads.dom.test.ts`",
        [
            (PERSONS_QUEUE, "askedBy: nameOf(one.asked.proposedBy),\n      about: nameOf(one.asked.about),", "askedBy: nameOf(one.asked.about),\n      about: nameOf(one.asked.proposedBy),"),
        ],
    ),
    (
        "M90 · withinMessagingReach reintroduces the retired commander-only clause for a stopped conversation, refusing a wide-grant caller that did not command it — killed by `who-can-i-talk-to.test.ts`, `a-second-project-and-the-grant.test.ts`",
        # ⚑ Landing D-017 (5206d835) · re-anchored in place, not retired — `withinMessagingReach` still
        # exists with the same shape, just reading `mayCommand(this.commandedNow(target), by)` instead
        # of `mayCommand(target, by)`. Re-inserting a `this.slots.has(sessionId)`-gated clause right
        # after the commander check reintroduces exactly the retired commander-only restriction, because
        # a stopped conversation's slot is deleted from `this.slots` the moment it stops
        # (runtime-host.ts:5508), so a wide-grant non-commander caller would be wrongly refused.
        [
            (RUNTIME_HOST, "    if (mayCommand(this.commandedNow(target), by)) return true\n    const speaking = sessionSpeakingAs(by)", "    if (mayCommand(this.commandedNow(target), by)) return true\n    if (!this.slots.has(sessionId)) return false\n    const speaking = sessionSpeakingAs(by)"),
        ],
    ),
    (
        "M91 · agentsVisibleTo lists one more stopped conversation than STOPPED_CONVERSATIONS_LISTED promises — killed by `the-cap-on-stopped-conversations-a-caller-can-see.test.ts`",
        # ⛔ **RETIRED BY RULING (landing D-017, 5206d835):** `STOPPED_CONVERSATIONS_LISTED` is gone from
        # agent-tools.ts entirely; D-017 rule 6 replaces the two-tier cap (unbounded running list + a
        # separate cap just for stopped conversations, D-007's split) with ONE list cut at ONE cap,
        # `CONVERSATIONS_LISTED`, applied uniformly in `listedFrom` (runtime-host.ts ~2748). The row's
        # own designated killer, `the-cap-on-stopped-conversations-a-caller-can-see.test.ts`, still
        # imports the now-deleted `STOPPED_CONVERSATIONS_LISTED` constant and is one of the four tests
        # the task explicitly says DEV will re-aim next commit and forbids naming as a killer; no other
        # current test exercises the real (unmocked) slice cut in `listedFrom` — the two other files
        # that reference `CONVERSATIONS_LISTED`/`notListed` both stub `agentsVisibleTo` directly and
        # never run the real cap logic. Its anchor is left stale, so the census records it retired.
        [
            (RUNTIME_HOST, ".slice(0, STOPPED_CONVERSATIONS_LISTED)", ".slice(0, STOPPED_CONVERSATIONS_LISTED + 1)"),
        ],
    ),
    (
        "M92 · a reply that lands nowhere never records the translated reason on the replier's ledger row — killed by `a-question-is-not-work.test.ts`",
        [
            (RUNTIME_HOST, "        ...(attempt.why === null ? {} : { detail: attempt.why }),", "        ...({}),"),
        ],
    ),
    (
        "M93 · reply_to_parent refuses a merely-stopped giver as not-delivered without attempting to start it — killed by `a-question-is-not-work.test.ts`, `a-reply-and-its-absence.test.ts`",
        [
            # ⚑ **W4.78 · re-anchored in place, not retired** — 038b7f1b (D-030) rewrote the delivery as deliverReplyTo returning WhereAReplyWent, and the giver is now `piece.giver` (D-016) instead of task.assignedBy. Killers still drive a stopped giver (a-reply-and-its-absence 'reply is kept for its next start'; a-question-is-not-work D-017 R14 'a parent that has merely STOPPED is started by the reply').
            (RUNTIME_HOST, "  ): Promise<WhereAReplyWent> {\n    // ⚑ **D-030 · the words, once composed** — composed inside the `try`, so a read that fails is\n", "  ): Promise<WhereAReplyWent> {\n    if (!this.slots.has(piece.giver)) {\n      return { delivered: 'not-delivered', why: 'that conversation was not running' }\n    }\n    // ⚑ **D-030 · the words, once composed** — composed inside the `try`, so a read that fails is\n"),
        ],
    ),
    (
        "M94 · lostReplySentence joins the reason and the translated detail with the wrong punctuation — killed by `the-three-sentences-beside-the-cards.test.ts`",
        [
            (LOST_REPLY, "why.length === 0 ? said : `${said}: ${why.join(' — ')}`", "why.length === 0 ? said : `${said}: ${why.join(', ')}`"),
        ],
    ),
    (
        "M95 · the Close confirmation claims a held message is sent when it is actually still described as dropped — killed by `the-button-between-looking-and-killing-it.test.ts`",
        # ⛔ **RETIRED BY RULING (landing D-017b, 3af91dcb):** The subject was removed on purpose.
        # `ending-a-conversation.ts` was deleted and the End conversation button and its Close
        # confirmation are gone. Commit 3af91dcb: 'No End conversation button, no kept-open pane, no
        # reading-only pane...'. The card says: 'no End conversation button'. The sentence 'again and is
        # sent. The recording stays.' appears nowhere in src now, and the killer test no longer covers
        # it. Its anchor is left stale, so the census records it retired.
        [
            (ENDING_A_CONVERSATION, "again and is sent. The recording stays.", "again and is dropped. The recording stays."),
        ],
    ),
    (
        "M96 · the Work tab's frozen snapshot reading of a stopped holder shows the LIVE word instead of the past-tense one — killed by `what-main-handed-and-nobody-drew.render.test.ts`",
        # ⚑ Landing D-017b (3af91dcb) · re-anchored in place, not retired — The rule survives in
        # `work-report.ts`. A frozen 'as-reported' reading must say the past-tense word, not the live
        # one that 'now' says. The words changed: `IT_HAD_STOPPED` became `IT_WAS_IDLE` ('it was idle'),
        # and the live word became `IDLE`. The plant gives the snapshot the live `IDLE` word, so the
        # frozen row claims the live state.
        # ⛔ **RETIRED BY RULING (landing D-016c, 8d54d6dc, a stop changes nothing about a piece):**
        # The plant is on the window's left-open / idle words in work-report.ts (IT_WAS_IDLE, IDLE,
        # LEFT_OPEN_WORDS, WorkReadAt, leftOpenByTheQuit, WorkReading.title), all deleted on
        # purpose. Commit 8d54d6dc: "Gone with it: ... the window's left-open and idle words"; a
        # stop changes nothing about a piece, so the window has nothing to word. Its anchor is left
        # stale, so the census records it retired.
        [
            (WORK_REPORT, "'as-reported': { word: IT_WAS_IDLE, title: null },", "'as-reported': { word: IDLE, title: null },"),
        ],
    ),
    (
        "M97 · reply_to_parent's own tool answer never carries the why field, even when the delivery failed — killed by `a-reply-and-its-absence.test.ts`",
        [
            (AGENT_TOOLS, "              ...(replied.why === undefined ? {} : { why: replied.why }),", "              ...(true ? {} : { why: replied.why }),"),
        ],
    ),
    (
        "M98 · the first-message pane says a TAKEN conversation was STARTED here, when it ended before opening — killed by `the-cap-on-stopped-conversations-a-caller-can-see.test.ts`",
        # ⛔ **RETIRED BY RULING (landing D-017b, 3af91dcb):** The kept-open pane and its `kept-open.ts`
        # (`whatTheFirstMessagePaneSays`, `IT_WAS_TAKEN_AND_ENDED_BEFORE_IT_OPENED_HERE`) were deleted
        # on purpose, along with the kept-open pane. The killer test's own docblock now says: 'its §2
        # went with kept-open.ts… There is no such pane any more… a message's refusal is the host's own
        # sentence, said on the conversation's record'. Its second describe block was removed, so no
        # sentence still separates a taken conversation from a started one. Its anchor is left stale, so
        # the census records it retired.
        [
            (KEPT_OPEN, "refusal.running.handover === 'attached'", "refusal.running.handover !== 'attached'"),
        ],
    ),
    (
        "M99 · agentCard refuses every stopped conversation outright instead of answering its stopped card — killed by `who-can-i-talk-to.test.ts`, `a-reply-and-its-absence.test.ts`",
        [
            (RUNTIME_HOST, "if (slot === undefined) return this.stoppedCardFor(sessionId, by, me)", "if (slot === undefined) return null"),
        ],
    ),
    (
        "M100 · the not-below-you gate never fires — any caller may interrupt any conversation, not only those below it in the spawn chain — killed by `a-stop-reaches-down-the-whole-chain.test.ts`, `the-interruption-that-looks-like-a-fault.test.ts`, `anyone-may-ask-work-needs-a-relationship.test.ts`, `two-withdrawals-open-what-was-scoped.test.ts`",
        # ⚑ Landing D-016c commits 6–7 and D-022 (4a7f0fec, c1a79abe, 37228461) · re-anchored in
        # place, not retired — The gate is now `if (!this.mayInterrupt(sessionId, by)) {` in
        # `RuntimeHost.interruptAgent`; `mayInterrupt` is a private method and the old local `const
        # mayInterrupt` is gone. The plant replaces the condition with `false`, so `not-below-you`
        # never fires and any caller may interrupt any conversation. All four named killers exist
        # and assert `not-below-you`. Killed by `a-stop-reaches-down-the-whole-chain.test.ts`,
        # `the-interruption-that-looks-like-a-fault.test.ts`,
        # `anyone-may-ask-work-needs-a-relationship.test.ts`,
        # `two-withdrawals-open-what-was-scoped.test.ts`.
        [
            (RUNTIME_HOST, "    if (!this.mayInterrupt(sessionId, by)) {\n", "    if (false) {\n"),
        ],
    ),
    (
        "M101 · nothingToInterrupt claims an ask went out even though nothing was running — asked is always true — killed by `state-a-supervisor-can-trust.test.ts`, `a-restart-keeps-what-was-open.test.ts`, `the-interruption-that-looks-like-a-fault.test.ts`",
        [
            (RUNTIME_HOST, "  private nothingToInterrupt(sessionId: string): InterruptOutcome {\n    return {\n      ok: true,\n      agent: sessionId,\n      asked: false,", "  private nothingToInterrupt(sessionId: string): InterruptOutcome {\n    return {\n      ok: true,\n      agent: sessionId,\n      asked: true,"),
        ],
    ),
    (
        "M102 · it-is-waiting-on-an-answer is unreachable — a card routed to another AGENT is always answered a-person-is-being-asked instead — killed by `a-question-a-grandchild-asked-is-not-yours-to-cut-into.test.ts`",
        [
            (INTERRUPT_RAILS, "askedOf === null", "true"),
        ],
    ),
    (
        "M103 · withdrawing work from a stopped conversation writes the withdrawal against the wrong task id, so the real task never shows withdrawn — killed by `a-restart-keeps-what-was-open.test.ts`",
        # ⚑ Landing D-016b (5e931be8, the tree) · re-anchored in place, not retired — Taking work
        # back from a stopped conversation survives as `takeBackPiece` writing `work_taken_back`
        # into the owner's ledger (`writeIntoItsLedger` when nothing runs), and the fold settles by
        # piece id. The plant writes the row against the wrong piece id, so the real piece never
        # shows `withdrawn`. Killed by `a-restart-keeps-what-was-open.test.ts`.
        [
            (RUNTIME_HOST, "      type: 'work_taken_back',\n      piece: piece.piece,\n      by: asAgent,", "      type: 'work_taken_back',\n      piece: `${piece.piece}x`,\n      by: asAgent,"),
        ],
    ),
    (
        "M104 · withdraw_task's own declaration claims it destroys work in flight — false, it stops nothing — killed by `the-doors-our-own-verbs-do-not-need.test.ts`",
        # ⚑ Landing D-016b (5e931be8, the tree) · re-anchored in place, not retired —
        # `withdraw_task` still declares `nothing-its-rails-do-not-cover` (it stops nothing), and
        # `the-doors-our-own-verbs-do-not-need.test.ts` reads that split off the real toolset. The
        # plant declares the take-back as destroying work in flight; only the anchor moved (the
        # comment above it was rewritten for pieces). Killed by
        # `the-doors-our-own-verbs-do-not-need.test.ts`.
        [
            (AGENT_TOOLS, "*nothing it is doing is stopped*.\n       */\n      beyondItsRails: 'nothing-its-rails-do-not-cover',", "*nothing it is doing is stopped*.\n       */\n      beyondItsRails: 'it-destroys-work-in-flight',"),
        ],
    ),
    (
        "M105 · not-below-you is priced as retryable (while-this-holds) though who started a conversation never changes — killed by `the-interruption-that-looks-like-a-fault.test.ts`, `a-refusal-carries-its-remedy.test.ts`",
        [
            (INTERRUPT_RAILS, "  'not-below-you': 'permanent',", "  'not-below-you': 'while-this-holds',"),
        ],
    ),
    (
        "M106 · no-such-agent's existence check is inverted — it fires for ids that DO exist and never fires for ids that do not — killed by `the-interruption-that-looks-like-a-fault.test.ts`",
        [
            (RUNTIME_HOST, "if (slot === undefined && this.deps.store.recordedOne(sessionId) === null) {", "if (slot === undefined && this.deps.store.recordedOne(sessionId) !== null) {"),
        ],
    ),
    (
        "M108 · an agent above the direct parent can no longer interrupt a grandchild — only the immediate parent can, breaking the HO-095 chain reach — killed by `a-stop-reaches-down-the-whole-chain.test.ts`",
        [
            (RUNTIME_HOST, "  return speaking !== null && above.includes(speaking)", "  return speaking !== null && above[0] === speaking"),
        ],
    ),
    (
        "M109 · it-is-waiting-on-an-answer is given a remedy word though nothing the caller can do ends the wait — only the named conversation's own answer does — killed by `a-refusal-carries-its-remedy.test.ts`",
        [
            (INTERRUPT_RAILS, "  'it-is-waiting-on-an-answer': null,", "  'it-is-waiting-on-an-answer': 'make-the-same-call-when-this-settles',"),
        ],
    ),
    (
        "M110 · a provider that has forgotten the conversation (ResumeError.noSuchSession) is treated as just another failed attempt — nothing is ever replaced — killed by `a-first-message-starts-it-in-one-act.test.ts`, `a-shortage-that-clears-by-itself.test.ts`",
        [
            (RUNTIME_HOST, "    if (seen instanceof ResumeError && seen.noSuchSession) return true", "    if (seen instanceof ResumeError && seen.noSuchSession) return false"),
        ],
    ),
    (
        "M111 · the old ledger's replaced_by row names itself instead of the conversation that took its place — killed by `a-first-message-starts-it-in-one-act.test.ts`",
        [
            (RUNTIME_HOST, "    this.appendIntoItsLedger(old, { type: 'replaced_by', sessionId })", "    this.appendIntoItsLedger(old, { type: 'replaced_by', sessionId: old })"),
        ],
    ),
    (
        "M112 · the new conversation's replaces row names itself instead of the one it replaced — killed by `a-first-message-starts-it-in-one-act.test.ts`",
        [
            (RUNTIME_HOST, "      this.publishOurs(next, { type: 'replaces', sessionId: old })", "      this.publishOurs(next, { type: 'replaces', sessionId })"),
        ],
    ),
    (
        "M113 · a could_not_be_reopened stall is no longer final — a later row could re-word it — killed by `never-close-what-you-did-not-see-finish.test.ts`",
        [
            (TASKS, "    if (held.row.stalledBecause === 'could_not_be_reopened') return", "    if (false) return"),
        ],
    ),
    (
        "M114 · an ask can ride beside a could_not_be_reopened stall, as if it named who asked for it — killed by `never-close-what-you-did-not-see-finish.test.ts`",
        # ⚑ Landing D-016c (8d54d6dc, a stop changes nothing) · re-anchored in place, not retired —
        # The rule (a piece stalled on could_not_be_reopened is not an ask that rides on:
        # AN_ASK_RIDES_ON is true only for turn_ended and turn_interrupted) still holds in
        # shared/tasks.ts, but the map lost its conversation_ended key, so the old two-line anchor
        # `conversation_ended: false,\n  could_not_be_reopened: false,\n}` matches 0 times. The new
        # anchor is the three last keys plus the closing brace of AN_ASK_RIDES_ON (count 1); the
        # plant flips could_not_be_reopened to true, so the census
        # toEqual(['turn_ended','turn_interrupted']) fails. Killed by
        # `never-close-what-you-did-not-see-finish.test.ts`.
        [
            # ⚑ **W4.78 · re-anchored in place, not retired** — AN_ASK_RIDES_ON gained background_stopped (and F074/F076 entries) after could_not_be_reopened, so the table no longer closes with `}` there; anchored on the neighbour instead.
            (TASKS, "  message_never_sent: false,\n  could_not_be_reopened: false,\n  background_stopped: false,\n", "  message_never_sent: false,\n  could_not_be_reopened: true,\n  background_stopped: false,\n"),
        ],
    ),
    (
        "M115 · the owner starting its turn again drives a could_not_be_reopened stall back to working, as if the replaced conversation could still run — killed by `a-turn-on-its-owner-drives-its-work.test.ts`",
        [
            # ⚑ **W4.78 · re-anchored in place, not retired** — ITS_OWNER_RUNNING_AGAIN_DRIVES_IT gained background_stopped/provider_limited/login_refused after this entry, so the closing `}` moved away; same entry.
            (TASKS, "  // ⚑ **D-017 · R10** — nothing runs the old conversation again.\n  could_not_be_reopened: false,\n", "  // ⚑ **D-017 · R10** — nothing runs the old conversation again.\n  could_not_be_reopened: true,\n"),
        ],
    ),
    (
        "M116 · a replaced conversation's open work is never stalled — it is left open forever, with nothing that will ever run it again to close it — killed by `what-a-replacement-carries-and-what-it-leaves-behind.test.ts`",
        # ⚑ Landing D-016b (5e931be8, the tree) · re-anchored in place, not retired — A replaced
        # conversation's open pieces still stall `could_not_be_reopened` in the `replaced_by` arm of
        # the fold in `shared/tasks.ts`; only the loop variable was renamed from `taskId` to
        # `piece`. The plant disables that stall. Killed by
        # `what-a-replacement-carries-and-what-it-leaves-behind.test.ts`.
        [
            (TASKS, "        if (TASK_IS_OPEN[held.row.state]) stall(piece, 'could_not_be_reopened', entry.at)", "        if (false && TASK_IS_OPEN[held.row.state]) stall(piece, 'could_not_be_reopened', entry.at)"),
        ],
    ),
    (
        "M117 · a replacement is never started by the parent that gave the old conversation its work — killed by `what-a-replacement-carries-and-what-it-leaves-behind.test.ts`",
        # ⚑ Landing D-016b (5e931be8, the tree) · re-anchored in place, not retired — A replacement
        # is still started in its old conversation's parent's care in
        # `replaceWhatCanNeverBeReopened`; the lookup is now `store.parentOf(old)` then
        # `theOneInItsPlace(recorded)`, since spawn provenance is gone. The plant forgets the
        # parent. Killed by `what-a-replacement-carries-and-what-it-leaves-behind.test.ts`.
        [
            (RUNTIME_HOST, "    const parent = recorded === null ? null : this.theOneInItsPlace(recorded)", "    const parent = null"),
        ],
    ),
    (
        "M118 · a replacement always runs as the default agent, never the identity of the conversation it replaces — killed by `what-a-replacement-carries-and-what-it-leaves-behind.test.ts`",
        [
            (RUNTIME_HOST, "    const profileId = identity?.profileSlug ?? row.profileId ?? DEFAULT_PROFILE_ID", "    const profileId = DEFAULT_PROFILE_ID"),
        ],
    ),
    (
        "M120 · agentStateArm: the schedule outranks the background, reversing R11's fourth and fifth rungs — killed by `the-losing-detail-says-nothing.render.test.ts`, `three-surfaces-read-the-new-field.test.ts`, `the-one-state-ranks-its-six-facts-in-one-order.test.ts`",
        [
            (AGENT_STATE, "  if (facts.inTheBackground) return 'in-the-background'\n  if (facts.scheduled) return 'scheduled'\n", "  if (facts.scheduled) return 'scheduled'\n  if (facts.inTheBackground) return 'in-the-background'\n"),
        ],
    ),
    (
        "M121 · agentStateArm: active outranks needs-you, reversing R11's top two rungs — killed by `the-one-state-ranks-its-six-facts-in-one-order.test.ts`",
        [
            (AGENT_STATE, "  if (facts.needsYou) return 'needs-you'\n  if (facts.active) return 'active'\n", "  if (facts.active) return 'active'\n  if (facts.needsYou) return 'needs-you'\n"),
        ],
    ),
    (
        "M122 · agentStateArm: the background outranks waiting-on-an-answer, reversing R11's third and fourth rungs — killed by `three-surfaces-read-the-new-field.test.ts`, `the-one-state-ranks-its-six-facts-in-one-order.test.ts`",
        [
            # ⚑ **W4.91 · re-anchored in place, not retired** — 80bff428 put owes-an-answer between waiting-on-an-answer and the background; the background still jumps above the wait
            (AGENT_STATE, "  if (facts.waitingOnAnAnswer) return 'waiting-on-an-answer'\n  if (facts.owesAnAnswer === true) return 'owes-an-answer'\n  if (facts.inTheBackground) return 'in-the-background'\n", "  if (facts.inTheBackground) return 'in-the-background'\n  if (facts.waitingOnAnAnswer) return 'waiting-on-an-answer'\n  if (facts.owesAnAnswer === true) return 'owes-an-answer'\n"),
        ],
    ),
    (
        "M123 · agentStateWords says 'waiting for' instead of 'waiting on' for the waiting-on-an-answer arm — killed by `the-one-state-ranks-its-six-facts-in-one-order.test.ts`",
        # ⚑ Landing D-016c commits 6–7 and D-022 (4a7f0fec, c1a79abe, 37228461) · re-anchored in
        # place, not retired — `agentStateWords` now words the waiting-on-an-answer arm as `waiting
        # on an answer from ${state.from}`, so the old `waiting on ${state.from}'s answer` anchor is
        # gone. The plant says 'waiting for' instead of 'waiting on', which is the label's defect.
        # The killer asserts `'waiting on an answer from BroBot'` at line 104. Killed by
        # `the-one-state-ranks-its-six-facts-in-one-order.test.ts`.
        [
            (AGENT_STATE, "      return `waiting on an answer from ${state.from}`", "      return `waiting for an answer from ${state.from}`"),
        ],
    ),
    (
        "M124 · agentStateWords joins the background arm's detail with a colon instead of the vocabulary's own ' · ' — killed by `one-state-everywhere.test.ts`, `the-losing-detail-says-nothing.render.test.ts`, `the-one-state-ranks-its-six-facts-in-one-order.test.ts`",
        [
            (AGENT_STATE, "return state.what === null ? IN_THE_BACKGROUND : `${IN_THE_BACKGROUND} · ${state.what}`", "return state.what === null ? IN_THE_BACKGROUND : `${IN_THE_BACKGROUND}: ${state.what}`"),
        ],
    ),
    (
        "M125 · clockTime rejects the boundary instant itself (>= instead of > against MAX_INSTANT) — killed by `clock-format.test.ts`",
        [
            (CLOCK, "Math.abs(at) > MAX_INSTANT", "Math.abs(at) >= MAX_INSTANT"),
        ],
    ),
    (
        "M126 · nextWake picks the LATEST job across the set instead of the soonest — killed by `one-state-everywhere.test.ts`",
        [
            (AGENT_STATE, "soonest === null || at < soonest", "soonest === null || at > soonest"),
        ],
    ),
    (
        "M127 · inTheBackground's '+N more' count is off by one — drops the '-1' for the row already named — killed by `one-state-everywhere.test.ts`, `the-losing-detail-says-nothing.render.test.ts`",
        [
            (AGENT_STATE, "const more = level.running.length - 1 + level.dropped", "const more = level.running.length + level.dropped"),
        ],
    ),
    (
        "M128 · agentStateOf drops the in-the-background arm's own detail, always reporting what: null — killed by `the-losing-detail-says-nothing.render.test.ts`, `the-one-state-ranks-its-six-facts-in-one-order.test.ts`",
        [
            (AGENT_STATE, "if (arm === 'in-the-background') return { is: arm, what: inTheBackground(facts.background) }", "if (arm === 'in-the-background') return { is: arm, what: null }"),
        ],
    ),
    (
        "M129 · main's stateOf never wires a live session's background level into the one state — it is always reported empty — killed by `the-one-state-ranks-its-six-facts-in-one-order.test.ts`",
        [
            (RUNTIME_HOST, "        background: session?.background ?? NOTHING_IN_THE_BACKGROUND,", "        background: NOTHING_IN_THE_BACKGROUND,"),
        ],
    ),
    (
        "M130 · the one list is sorted oldest-first instead of newest-first — killed by `one-list-newest-first-wherever-its-read.test.ts`",
        [
            (RUNTIME_HOST, "    ].sort((one, other) => (one.id === me ? -1 : other.id === me ? 1 : other.at - one.at))", "    ].sort((one, other) => (one.id === me ? -1 : other.id === me ? 1 : one.at - other.at))"),
        ],
    ),
    (
        "M131 · whyItIsOutOfReach answers no-such-agent for every stopped id out of reach, real or nonexistent alike — killed by `one-list-newest-first-wherever-its-read.test.ts`",
        [
            (RUNTIME_HOST, "if (row === null) return { is: 'no-such-agent' }", "return { is: 'no-such-agent' }"),
        ],
    ),
    (
        "M132 · agentCard refuses every stopped conversation outright instead of reading its stopped card — killed by `who-can-i-talk-to.test.ts`",
        [
            (RUNTIME_HOST, "if (slot === undefined) return this.stoppedCardFor(sessionId, by, me)", "if (slot === undefined) return null"),
        ],
    ),
    (
        "M133 · agentsVisibleTo's project filter is inverted — it filters when no project is named and skips filtering when one is — killed by `a-reach-you-can-see.test.ts`",
        # ⛔ **RETIRED BY RULING (landing D-016a, bd70d693):** agentsVisibleTo's project filter went with
        # the project argument: commit bd70d693 says "same-project reach and the project argument on
        # spawn_agent and list_agents are removed". agentsVisibleTo(by, me) now takes no project and
        # conversationsVisibleTo has no project filter, so there is nothing to invert. Its anchor is
        # left stale, so the census records it retired.
        [
            (RUNTIME_HOST, "      project === null\n        ? reachable\n        : reachable.filter((one) => this.targetAsItWillRun(one.id)?.projectSlug === project),", "      project !== null\n        ? reachable\n        : reachable.filter((one) => this.targetAsItWillRun(one.id)?.projectSlug === project),"),
        ],
    ),
    (
        "M134 · conversationsVisibleTo lists every RUNNING slot regardless of the caller's reach — killed by `a-reach-you-can-see.test.ts`",
        [
            (RUNTIME_HOST, "      ...[...this.slots.values()]\n        .filter((slot) => this.withinMessagingReach(slot.id, by, me))", "      ...[...this.slots.values()]\n        .filter(() => true)"),
        ],
    ),
    (
        "M135 · conversationsVisibleTo lists every STOPPED conversation regardless of the caller's reach — killed by `one-list-newest-first-wherever-its-read.test.ts`",
        [
            (RUNTIME_HOST, "      ...this.everythingStartable()\n        .filter(({ startable }) => this.withinMessagingReach(startable.id, by, me))", "      ...this.everythingStartable()\n        .filter(() => true)"),
        ],
    ),
    (
        "M136 · a project's agent list (list_projects) is inverted — it shows every conversation NOT in that project — killed by `brobot-answers-about-projects.test.ts`",
        # ⛔ **RETIRED BY RULING (landing D-016a, bd70d693):** list_projects was removed on purpose
        # ("create_project and list_projects ... are removed"). The per-project agent list, the
        # `placed.filter(each.in === slug)` line and the project reports are gone from runtime-host.ts,
        # and brobot-answers-about-projects.test.ts no longer tests any project report. Its anchor is
        # left stale, so the census records it retired.
        [
            (RUNTIME_HOST, "      const { agents, notListed } = listedFrom(\n        placed.filter((each) => each.in === slug).map((each) => each.one),\n      )", "      const { agents, notListed } = listedFrom(\n        placed.filter((each) => each.in !== slug).map((each) => each.one),\n      )"),
        ],
    ),
    (
        "M137 · the cut's 'N more' sentence is inverted — silent when there is a cut, printed when there is none — killed by `who-can-i-talk-to.test.ts`",
        # ⚑ Landing D-016c commits 6–7 and D-022 (4a7f0fec, c1a79abe, 37228461) · re-anchored in
        # place, not retired — The cut's 'N more' sentence in `list_agents` now ends 'take the label
        # of a piece it owns (W1.2), or its id.', so the old whole-sentence anchor is gone. The
        # plant inverts the condition (`notListed !== 0`) on the `const more` head, which is
        # unchanged, so the sentence is silent when there is a cut and printed when there is none.
        # The killer asserts the whole text with the '5 more' cut at about line 676. Killed by
        # `who-can-i-talk-to.test.ts`.
        [
            (AGENT_TOOLS, "          const more =\n            notListed === 0\n              ? ''\n", "          const more =\n            notListed !== 0\n              ? ''\n"),
        ],
    ),
    (
        "M138 · list_agents reports the hidden count as the listed count — killed by `a-second-project-and-the-grant.test.ts`",
        [
            (AGENT_TOOLS, "            { outcome: 'ok', agents: agents.map(cardPayload), count: agents.length, notListed },", "            { outcome: 'ok', agents: agents.map(cardPayload), count: notListed, notListed },"),
        ],
    ),
    (
        "M139 · the one list's cut is off by one — a 51st reachable conversation is listed as if it made the cut — killed by `the-cap-on-stopped-conversations-a-caller-can-see.test.ts`",
        [
            (RUNTIME_HOST, "    agents: reachable.slice(0, CONVERSATIONS_LISTED).map((one) => one.card()),", "    agents: reachable.slice(0, CONVERSATIONS_LISTED + 1).map((one) => one.card()),"),
        ],
    ),
    (
        "M140 · profile-already-live stops counting a STOPPED child — only a live/closing slot blocks a second spawn of that identity (reverts to pre-D-017 behaviour) — killed by `two-sessions-of-one-agent.demo.test.ts`",
        # ⚑ Landing D-016b (5e931be8, the tree) · re-anchored in place, not retired —
        # `profile-already-live` went with `spawn_agent` ("spawn_agent is gone"), but its rule
        # survives as R2 step 5: `helperAs` finds the giver's conversation with that agent, running
        # or stopped, so no second one opens. The plant makes the lookup see only a live or closing
        # slot. Killed by `two-sessions-of-one-agent.demo.test.ts`.
        [
            (RUNTIME_HOST, "    const found =\n      reserved?.id ?? this.deps.store.newestChildAs(parents, profileSlug, provider, except)\n", "    const found = reserved?.id ?? null\n"),
        ],
    ),
    (
        "M141 · message_agent's reach wall (withinMessagingReach) is no longer checked before a stopped conversation is started — a caller outside its reach can spend a start before being refused — killed by `a-same-project-caller-that-did-not-start-it-is-refused-before-a-launch.test.ts`",
        [
            (RUNTIME_HOST, "      if (!this.withinMessagingReach(sessionId, by, me)) {\n        throw new Error(`unknown session: ${sessionId}`)\n      }", "      if (!this.withinMessagingReach(sessionId, by, me) && false) {\n        throw new Error(`unknown session: ${sessionId}`)\n      }"),
        ],
    ),
    (
        "M142 · message_agent's assign-work wall (assertMayAssign) is no longer checked before a stopped conversation is started — killed by `a-restart-keeps-what-was-open.test.ts`",
        # ⚑ Landing D-016a (bd70d693) · re-anchored in place, not retired — The rule survives:
        # refuseBeforeAStart still asks assertMayAssign before a stopped conversation is started. Only
        # the `breadth = howManyCallersItTakesWorkFrom` line above it went, with takes_work_from. The
        # plant now anchors on the assertMayAssign line and the OPENS_A_TASK line after it (count 1).
        # ⚑ Landing D-016b (5e931be8, the tree) · re-anchored in place, not retired — The
        # assign-work wall now sits at R2 step 3 of `admitGive` (`may-not-assign-work`, asked of the
        # caller alone), before any start; `assertMayAssign` and its pre-start call no longer exist.
        # The plant stops that wall from refusing. Killed by
        # `a-restart-keeps-what-was-open.test.ts`.
        [
            (SPAWN_RAILS, "  const wall = facts.mayGiveWork()\n  if (wall !== null) return { ok: false, refusal: wall }", "  const wall = facts.mayGiveWork()\n  if (wall !== null && false) return { ok: false, refusal: wall }"),
        ],
    ),
    (
        "M143 · message_agent's work-already-open check is no longer asked before a stopped conversation is started — killed by `a-restart-keeps-what-was-open.test.ts`",
        # ⚑ Landing D-016a (bd70d693) · re-anchored in place, not retired — The rule survives:
        # refuseBeforeAStart still throws WorkAlreadyOpen before a stopped conversation is started. The
        # rail now refuses on any open task, so the throw lost its `open.projectSlug` argument and
        # `workAlreadyOpenIn` its breadth argument. The plant disables that throw at its new shape
        # (count 1).
        # ⛔ **RETIRED BY RULING (landing D-016b, 5e931be8, the tree):** The check the plant
        # disables, `if (open !== null) throw new WorkAlreadyOpen(...)` before a start, was deleted
        # with the rail: `a-restart-keeps-what-was-open.test.ts` says "`its parent re-sending work
        # the child still holds is refused before any start` is gone with its subject (D-016):
        # `agent-already-has-work-open` - the one-open-task rail - left the product, and a give to a
        # child the quit stopped is admitted and starts it". Its anchor is left stale, so the census
        # records it retired.
        [
            (RUNTIME_HOST, "        if (open !== null) throw new WorkAlreadyOpen(open.taskId, open.number)", "        if (open !== null && false) throw new WorkAlreadyOpen(open.taskId, open.number)"),
        ],
    ),
    (
        "M144 · list_projects's per-project conversations are reported under the old key `running` instead of `agents` — killed by `a-restart-keeps-what-was-open.test.ts`, `brobot-answers-about-projects.test.ts`",
        # ⛔ **RETIRED BY RULING (landing D-016a, bd70d693):** list_projects was removed on purpose, so
        # its per-project `agents` key, `report.agents.map(cardPayload)`, no longer exists in
        # agent-tools.ts. The key on list_agents (`agents: agents.map(cardPayload)`) is a different tool
        # and a different site. Its anchor is left stale, so the census records it retired.
        [
            (AGENT_TOOLS, "agents: report.agents.map(cardPayload),", "running: report.agents.map(cardPayload),"),
        ],
    ),
    (
        "M145 · list_projects's counts.agents reports only the returned PAGE length, not the true total, once a project's agents are cut — killed by `a-projects-agent-list-is-a-page-with-a-true-count.test.ts`",
        # ⛔ **RETIRED BY RULING (landing D-016a, bd70d693):** The counts.agents total (`agents.length +
        # notListed`) lived only in list_projects' per-project report, which D-016 deleted
        # ("create_project and list_projects ... are removed").
        # a-projects-agent-list-is-a-page-with-a-true-count.test.ts was deleted in the same commit. Its
        # anchor is left stale, so the census records it retired.
        [
            (RUNTIME_HOST, "        counts: {\n          agents: agents.length + notListed,", "        counts: {\n          agents: agents.length,"),
        ],
    ),
    (
        "M146 · the shared per-list cut (listedFrom) stops slicing — a project's `agents` array is never capped at CONVERSATIONS_LISTED — killed by `a-projects-agent-list-is-a-page-with-a-true-count.test.ts`",
        [
            (RUNTIME_HOST, "agents: reachable.slice(0, CONVERSATIONS_LISTED).map((one) => one.card()),", "agents: reachable.slice(0, reachable.length).map((one) => one.card()),"),
        ],
    ),
    (
        "M147 · list_projects's agents_not_listed is always emitted, even at 0, breaking the absent-when-zero contract every other 'how many more' field in this file follows — killed by `a-projects-agent-list-is-a-page-with-a-true-count.test.ts`",
        # ⛔ **RETIRED BY RULING (landing D-016a, bd70d693):** `agents_not_listed` was a list_projects
        # field and went with the tool, and its killer test file
        # a-projects-agent-list-is-a-page-with-a-true-count.test.ts was deleted by bd70d693. The
        # surviving list_agents always emits `notListed`, even at 0, so the absent-when-zero contract
        # does not carry over to it. Its anchor is left stale, so the census records it retired.
        [
            (AGENT_TOOLS, "            ...(report.agentsNotListed === 0 ? {} : { agents_not_listed: report.agentsNotListed }),", "            ...({ agents_not_listed: report.agentsNotListed }),"),
        ],
    ),
    (
        "M148 · cardPayload stops converting a card's state to its rendered words — list_projects (and every other reader of cardPayload) leaks the raw AgentState shape instead of the one-word string — killed by `a-restart-keeps-what-was-open.test.ts`",
        [
            (AGENT_TOOLS, "const cardPayload = (card: AgentCard) => ({ ...card, state: agentStateWords(card.state) })", "const cardPayload = (card: AgentCard) => ({ ...card })"),
        ],
    ),
    (
        "M149 · list_projects stops scoping a project's agents to that project — every project's report lists every reachable conversation, from any project — killed by `brobot-answers-about-projects.test.ts`",
        # ⛔ **RETIRED BY RULING (landing D-016a, bd70d693):** Scoping a project's agents to that project
        # is the project report itself, which D-016a removed ("create_project and list_projects ... are
        # removed"). There is no `placed` list or `each.in === slug` in runtime-host.ts any more. Its
        # anchor is left stale, so the census records it retired.
        [
            (RUNTIME_HOST, "placed.filter((each) => each.in === slug).map((each) => each.one)", "placed.map((each) => each.one)"),
        ],
    ),
    (
        "M150 · `5bb7ff7f` · the caller's own conversation is not put first, so the cap can cut it from the list that promises *including your own* — killed by `the-cap-on-stopped-conversations-a-caller-can-see.test.ts`",
        [
            (RUNTIME_HOST, "    ].sort((one, other) => (one.id === me ? -1 : other.id === me ? 1 : other.at - one.at))", "    ].sort((one, other) => other.at - one.at)"),
        ],
    ),
    (
        "M160 · look's wait arm forgets a stream that FAILED - an errored life is handed over live (attached) instead of being waited out and drawn from the ledger - killed by a-look-takes-what-a-press-may-take-and-nothing-else.test.ts — killed by `a-look-takes-what-a-press-may-take-and-nothing-else.test.ts`",
        [
            (RUNTIME_HOST, "      if (status === 'ended' || status === 'errored') {\n        await settledWithin(session.pump, this.closeDrainTimeoutMs)", "      if (status === 'ended') {\n        await settledWithin(session.pump, this.closeDrainTimeoutMs)"),
        ],
    ),
    (
        "M161 · look's wait arm forgets a provider that ENDED on its own - an ended life is handed over live (attached) instead of being waited out and drawn from the ledger - killed by a-look-takes-what-a-press-may-take-and-nothing-else.test.ts — killed by `a-look-takes-what-a-press-may-take-and-nothing-else.test.ts`",
        [
            (RUNTIME_HOST, "      if (status === 'ended' || status === 'errored') {\n        await settledWithin(session.pump, this.closeDrainTimeoutMs)", "      if (status === 'errored') {\n        await settledWithin(session.pump, this.closeDrainTimeoutMs)"),
        ],
    ),
    (
        "M162 · look does not wait the dead stream's pump before settling the teardown - the teardown is not yet running when it is asked about, so the record is handed over while the dying life is still registered (no liveFrom, slot still in the host) - killed by a-look-takes-what-a-press-may-take-and-nothing-else.test.ts — killed by `a-look-takes-what-a-press-may-take-and-nothing-else.test.ts`",
        [
            (RUNTIME_HOST, "        await settledWithin(session.pump, this.closeDrainTimeoutMs)\n        await this.settleTeardown(sessionId)", "        await this.settleTeardown(sessionId)"),
        ],
    ),
    (
        "M163 · a look that is not a press claims a conversation no window holds (the claim arm ignores its `claim` flag) - killed by a-look-takes-what-a-press-may-take-and-nothing-else.test.ts — killed by `a-look-takes-what-a-press-may-take-and-nothing-else.test.ts`",
        [
            (RUNTIME_HOST, "          : claim\n            ? this.attachHeldSession(sessionId, sink, 'claim')\n            : null", "          : true\n            ? this.attachHeldSession(sessionId, sink, 'claim')\n            : null"),
        ],
    ),
    (
        "M164 · a press never takes a conversation running with no window (the claim arm is gone) - it is drawn recorded and stays unclaimed - killed by a-look-takes-what-a-press-may-take-and-nothing-else.test.ts and two-sessions-of-one-agent.demo.test.ts — killed by `a-look-takes-what-a-press-may-take-and-nothing-else.test.ts`, `two-sessions-of-one-agent.demo.test.ts`",
        [
            (RUNTIME_HOST, "          : claim\n            ? this.attachHeldSession(sessionId, sink, 'claim')\n            : null", "          : null"),
        ],
    ),
    (
        "M165 · the claim is tried before the owner's attach - the window that already holds a conversation is refused its own claim (mayClaim needs a null owner) and is handed a RECORDED view of its own live conversation - killed by a-look-takes-what-a-press-may-take-and-nothing-else.test.ts — killed by `a-look-takes-what-a-press-may-take-and-nothing-else.test.ts`",
        [
            (RUNTIME_HOST, "        const handed = mayControl(slot, sink)\n          ? this.attachHeldSession(sessionId, sink, 'attach')\n          : claim\n            ? this.attachHeldSession(sessionId, sink, 'claim')\n            : null", "        const handed = claim\n          ? this.attachHeldSession(sessionId, sink, 'claim')\n          : mayControl(slot, sink)\n            ? this.attachHeldSession(sessionId, sink, 'attach')\n            : null"),
        ],
    ),
    (
        "M166 · the wire treats an ABSENT claim flag as a press (`claim !== false`) - a look sent with no flag takes a conversation no window holds - killed by a-look-takes-what-a-press-may-take-and-nothing-else.test.ts — killed by `a-look-takes-what-a-press-may-take-and-nothing-else.test.ts`",
        [
            (IPC, "host.look(command.sessionId, sink, command.claim === true)", "host.look(command.sessionId, sink, command.claim !== false)"),
        ],
    ),
    (
        "M167 · the renderer sends every look as a press (`claim: true`) - the look again after a release or a fold's end takes the conversation back from nobody - killed by a-look-takes-what-a-press-may-take-and-nothing-else.test.ts — killed by `a-look-takes-what-a-press-may-take-and-nothing-else.test.ts`",
        [
            (SESSION_STORE_LIB, "claim: by === 'press'", "claim: true"),
        ],
    ),
    (
        "M168 · a look that was itself the look again may ask again (mayLookAgain = looked) - a window sent events past a recorded page is asked about it in a chain, for as long as events keep arriving - killed by a-look-takes-what-a-press-may-take-and-nothing-else.test.ts — killed by `a-look-takes-what-a-press-may-take-and-nothing-else.test.ts`",
        [
            (SESSION_STORE_LIB, "settleHeld(holding, looked && by === 'press')", "settleHeld(holding, looked)"),
        ],
    ),
    (
        "M169 · a press the host REFUSED still looks again with what it held (mayLookAgain ignores whether the look succeeded) - a host that refuses the look is asked again the moment it answers - killed by a-look-takes-what-a-press-may-take-and-nothing-else.test.ts — killed by `a-look-takes-what-a-press-may-take-and-nothing-else.test.ts`",
        [
            (SESSION_STORE_LIB, "settleHeld(holding, looked && by === 'press')", "settleHeld(holding, by === 'press')"),
        ],
    ),
    (
        "M170 · the undo runs for a conversation the message only attached or took: a refused message stops an idle conversation this window already ran (killed by a-message-from-a-conversations-view-goes-where-the-host-ruled.test.ts) — killed by `a-message-from-a-conversations-view-goes-where-the-host-ruled.test.ts`",
        [
            (RUNTIME_HOST, "      if (resumed.handover !== 'attached') {\n        await this.undoAStartNoMessageReached(sessionId, started)\n      }\n", "      await this.undoAStartNoMessageReached(sessionId, started)\n"),
        ],
    ),
    (
        "M171 · the third ask inside the arrivals entry is gone: a start another window made while the message waited is answered the-start, not held-elsewhere (killed by a-message-from-a-conversations-view-goes-where-the-host-ruled.test.ts) — killed by `a-message-from-a-conversations-view-goes-where-the-host-ruled.test.ts`",
        [
            (RUNTIME_HOST, "        // ⚑ **Asked once more**: a delivery that arrived first may have started it meanwhile.\n        if (this.heldByAnotherWindow(at, sink)) return notSent('held-elsewhere', HELD_ELSEWHERE)\n", "        // ⚑ **Asked once more**: a delivery that arrived first may have started it meanwhile.\n"),
        ],
    ),
    (
        "M172 · a Cancel is said as a refusal beside the box: the cancelled launch's sentence is written on the recorded conversation instead of nothing (killed by a-message-from-a-conversations-view-goes-where-the-host-ruled.test.ts) — killed by `a-message-from-a-conversations-view-goes-where-the-host-ruled.test.ts`",
        [
            (SESSION_STORE_LIB, "        const said = refusal.launch === 'cancelled' ? null : refusal.said\n", "        const said = refusal.said\n"),
        ],
    ),
    (
        "M173 · the previous refusal is not cleared when a new message starts: an old sentence stays beside the box after the next message is sent (killed by a-message-from-a-conversations-view-goes-where-the-host-ruled.test.ts) — killed by `a-message-from-a-conversations-view-goes-where-the-host-ruled.test.ts`",
        [
            (SESSION_STORE_LIB, "      starting.error = null\n      starting.handover += 1\n", "      starting.handover += 1\n"),
        ],
    ),
    (
        "M174 · the conversation that took its place is never named: a message to one that could not be reopened is adopted into the old record and tookItsPlace is dropped (killed by a-message-from-a-conversations-view-goes-where-the-host-ruled.test.ts) — killed by `a-message-from-a-conversations-view-goes-where-the-host-ruled.test.ts`",
        [
            (SESSION_STORE_LIB, "          handed.sessionId === sessionId ? null : handed.sessionId\n", "          null\n"),
        ],
    ),
    (
        "M175 · a rejected send says nothing beside the recorded conversation: the wire's own sentence is dropped instead of set on the record's error (killed by a-message-from-a-conversations-view-goes-where-the-host-ruled.test.ts) — killed by `a-message-from-a-conversations-view-goes-where-the-host-ruled.test.ts`",
        [
            (SESSION_STORE_LIB, "          else if (resumeError.value !== null) starting.error = resumeError.value\n", "          else if (resumeError.value !== null) starting.error = null\n"),
        ],
    ),
    (
        "M180 · the rail lists its rows oldest activity first instead of newest first — killed by `the-one-list-says-what-the-host-says-newest-first.dom.test.ts`",
        [
            (SIDE_RAIL_VUE, "  return [...drawn.values()].sort((one, other) => other.at - one.at).map(({ row }) => row)", "  return [...drawn.values()].sort((one, other) => one.at - other.at).map(({ row }) => row)"),
        ],
    ),
    (
        "M181 · a conversation this window holds that the host has not listed yet sorts last instead of first — killed by `the-one-list-says-what-the-host-says-newest-first.dom.test.ts`",
        [
            (SIDE_RAIL_VUE, "      at: host?.updatedAt ?? Number.POSITIVE_INFINITY,", "      at: host?.updatedAt ?? 0,"),
        ],
    ),
    (
        "M182 · the conversation on screen never shows how it was opened: its host row draws no opening line — killed by `the-one-list-says-what-the-host-says-newest-first.dom.test.ts`",
        [
            (SIDE_RAIL_VUE, "        opening: shownHere?.opening ?? null,", "        opening: null,"),
        ],
    ),
    (
        "M183 · the on-screen record's opening line is drawn on every host row, not only its own — killed by `the-one-list-says-what-the-host-says-newest-first.dom.test.ts`",
        [
            (SIDE_RAIL_VUE, "    const shownHere = shown?.sessionId === host.sessionId ? shown : null", "    const shownHere = shown"),
        ],
    ),
    (
        "M184 · a failed re-read of the list wipes the rows an earlier read drew — killed by `the-one-list-says-what-the-host-says-newest-first.dom.test.ts`",
        [
            (SIDE_RAIL_VUE, "    listError.value = readableError(cause)\n", "    listError.value = readableError(cause)\n    hostResumable.value = []\n    hostUnresumable.value = []\n"),
        ],
    ),
    (
        "M185 · the rail tells its palette the list has answered from the start, so a list that has not answered yet is described as searched — killed by `the-one-list-says-what-the-host-says-newest-first.dom.test.ts`",
        [
            (SIDE_RAIL_VUE, "      :looked=\"looked\"", "      :looked=\"true\""),
        ],
    ),
    (
        "M186 · the rail withholds its list failure from its palette, which then says the list has not answered yet — killed by `the-one-list-says-what-the-host-says-newest-first.dom.test.ts`",
        [
            (SIDE_RAIL_VUE, "      :list-error=\"listError\"", "      :list-error=\"null\""),
        ],
    ),
    (
        "M187 · a row the host lists says the state's bare word and drops its detail: who owes the answer, what runs in the background, and 'needs you' reads 'waiting' — killed by `the-one-list-says-what-the-host-says-newest-first.dom.test.ts`",
        [
            # ⚑ **source-restoration · re-anchored in place, not retired** — NOT VERIFIED; source targeting only. d96cd5232 added a provider-limit word override; retain it while replacing only the original host-state detail with the bare standing.
            # ⚑ **W4.638 · re-anchored in place, not retired** — a listed row idle with a piece waiting on purpose now says that wait first; the plant still replaces the host state's detail with the bare standing
            (SIDE_RAIL_VUE, "        word: limit?.short ?? purpose?.word ?? agentStateWords(host.state),", "        word: limit?.short ?? purpose?.word ?? standingWord(facets),"),
        ],
    ),
    (
        "M188 · the screen ignores whether another window took or released the conversation on screen: only the row's last activity makes it look again — killed by `the-one-list-says-what-the-host-says-newest-first.dom.test.ts`",
        [
            (RUNTIME_SCREEN_VUE, "    listed.inAnotherWindow === toldItWasElsewhere\n", "    true\n"),
        ],
    ),
    (
        "M189 · the screen hands the rail no record of the conversation it is drawing, so a recorded conversation on screen loses its opening line and its palette agent — killed by `the-one-list-says-what-the-host-says-newest-first.dom.test.ts`",
        [
            (RUNTIME_SCREEN_VUE, "        :on-screen=\"active\"", "        :on-screen=\"null\""),
        ],
    ),
    (
        "M190 · a view drawn from its ledger with an open card freezes its composer (the recorded arm sits under the cards) — killed by `a-view-drawn-from-its-ledger-says-what-the-host-says.dom.test.ts` — killed by `a-view-drawn-from-its-ledger-says-what-the-host-says.dom.test.ts`",
        [
            (CONVERSATION_PANE_VUE, "  // ⚑ **D-017b · a conversation drawn from its ledger takes its next message**, whatever its fold", "  if (props.record.phase === 'recorded' && panel.value.permissions.length + panel.value.questions.length > 0) return 'frozen'\n  // ⚑ **D-017b · a conversation drawn from its ledger takes its next message**, whatever its fold"),
        ],
    ),
    (
        "M191 · a view drawn from its ledger ignores the host's refusal, so Send is lit over 'already open in another window' — killed by `a-view-drawn-from-its-ledger-says-what-the-host-says.dom.test.ts` — killed by `a-view-drawn-from-its-ledger-says-what-the-host-says.dom.test.ts`",
        [
            (CONVERSATION_PANE_VUE, "  const cannot = props.record.meta?.cannotTakeAMessage ?? null", "  const cannot = props.record.meta?.cannotTakeAMessage ?? null\n  if (props.record.phase === 'recorded') return null"),
        ],
    ),
    (
        "M192 · every conversation draws the host's listed state on its plate, live ones included (the recorded guard on `hostSays` gone) — killed by `a-view-drawn-from-its-ledger-says-what-the-host-says.dom.test.ts` — killed by `a-view-drawn-from-its-ledger-says-what-the-host-says.dom.test.ts`",
        [
            (CONVERSATION_PANE_VUE, "  props.record.phase === 'recorded' ? (props.listedState ?? null) : null,", "  props.listedState ?? null,"),
        ],
    ),
    (
        "M193 · a live conversation's settings are statements (the recorded guard on `settingsFixed` gone) — killed by `a-view-drawn-from-its-ledger-says-what-the-host-says.dom.test.ts` — killed by `a-view-drawn-from-its-ledger-says-what-the-host-says.dom.test.ts`",
        [
            (CONVERSATION_PANE_VUE, "  () => props.record.phase === 'recorded' && props.record.meta?.settingsFixed !== false,", "  () => props.record.meta?.settingsFixed !== false,"),
        ],
    ),
    (
        "M194 · a message that is starting a recorded conversation leaves its composer idle, with no Stop (`launching` counts only off a recorded view) — killed by `a-view-drawn-from-its-ledger-says-what-the-host-says.dom.test.ts` — killed by `a-view-drawn-from-its-ledger-says-what-the-host-says.dom.test.ts`",
        [
            (CONVERSATION_PANE_VUE, "  if (props.launching === true) return 'busy'", "  if (props.launching === true && props.record.phase !== 'recorded') return 'busy'"),
        ],
    ),
    (
        "M195 · the pane tells its transcript that nobody takes the turns (`takenWithoutThisWindow` not forwarded), so a card no window answers offers no explanation — killed by `a-view-drawn-from-its-ledger-says-what-the-host-says.dom.test.ts` — killed by `a-view-drawn-from-its-ledger-says-what-the-host-says.dom.test.ts`",
        [
            (CONVERSATION_PANE_VUE, "          :taken-without-this-window=\"takenWithoutThisWindow\"", "          :taken-without-this-window=\"null\""),
        ],
    ),
    (
        "M196 · the take-over press on a card reaches nothing (the pane swallows `takeItOver`) — killed by `a-view-drawn-from-its-ledger-says-what-the-host-says.dom.test.ts` — killed by `a-view-drawn-from-its-ledger-says-what-the-host-says.dom.test.ts`",
        [
            (CONVERSATION_PANE_VUE, "          @take-it-over=\"emit('takeItOver')\"", "          @take-it-over=\"() => undefined\""),
        ],
    ),
    (
        "M197 · a held message in a view drawn from its ledger offers Cancel it (the pane stops telling its transcript the view is recorded) — killed by `a-view-drawn-from-its-ledger-says-what-the-host-says.dom.test.ts` — killed by `a-view-drawn-from-its-ledger-says-what-the-host-says.dom.test.ts`",
        [
            (CONVERSATION_PANE_VUE, "          :can-take-a-message=\"canTakeAMessage\"\n          :recorded=\"props.record.phase === 'recorded'\"", "          :can-take-a-message=\"canTakeAMessage\"\n          :recorded=\"false\""),
        ],
    ),
    (
        "M198 · the screen never tells the pane a message is starting the conversation (`:launching` fixed to false) — killed by `a-view-drawn-from-its-ledger-says-what-the-host-says.dom.test.ts` — killed by `a-view-drawn-from-its-ledger-says-what-the-host-says.dom.test.ts`",
        [
            (RUNTIME_SCREEN_VUE, "          :launching=\"store.isLaunching(active.sessionId)\"", "          :launching=\"false\""),
        ],
    ),
    (
        "M199 · Stop while a message is starting the conversation asks the runtime to interrupt instead of cancelling the start — killed by `a-view-drawn-from-its-ledger-says-what-the-host-says.dom.test.ts` — killed by `a-view-drawn-from-its-ledger-says-what-the-host-says.dom.test.ts`",
        [
            (RUNTIME_SCREEN_VUE, "  if (store.isLaunching(sessionId)) void store.cancelLaunch(sessionId)", "  if (store.isLaunching(sessionId)) void store.interrupt(sessionId)"),
        ],
    ),
]
