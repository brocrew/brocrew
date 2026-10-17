"""3019 · F084 · a stop ends the commands its turn started, and says which — 1e2f7706.

⛔ **The subject**: what a stop ends and what is said about it. On Codex `turn/interrupt` left the
turn's commands running, so the adapter ends them itself (an explicit stop: every command the turn
started; a stop for words: the one it waits on, unless a later TOOL USE moved on from it; never an
earlier turn's). On Claude the CLI ends the waited Bash, and the turn's ending names it. The turn's
ending carries `endedCommands`; `interrupt_agent`, the `message_agent` / `answer_question` receipts,
the giver's notice and the stopped agent's next words name what the stop ended and what still runs.

⚠️ **F084 shipped with almost no tests of its own** (the commit only re-pinned five existing tests;
its report lists "new behaviour to pin with tests" for landing). So every row here is killed by a
test that ALREADY reached the line — a Fake turn stopped inside the 40 ms wait, an exact turn row,
a source pin — and the riskiest logic is mostly in the "no test reaches it" list below.

## ⚑ What a row here measures

 * ⚑ **M1, M2 are the machine's ending** (`session-machine.ts`): `endedCommands` only when a stop
   ended something — on a turn's ending and on a burst's (a turn the CLI started by itself).
 * ⚑ **M3 is Codex's explicit-stop seam** (`codex-runtime.ts`): the handle no longer has
   `endEverythingTheTurnStarted`, so a person's Stop / `interrupt_agent` never widens a stop to
   every command — caught only as a contract member gone missing (the conformance SHAPE pass).
 * ⚑ **M4–M8 are the host's wait for the stopped turn's ending** (`runtime-host.ts`): the wait
   asked before the stop, gated on a turn running, handed the ending, and carried into the receipt
   of `message_agent` with `interrupt` — so the receipt says what the stop ended ("none of its
   commands") instead of the provider's rule.
 * ⚑ **M9, M10 are the receipt's words** (`agent-tools.ts` `whatBecameOfTheStop`): facts once the
   ending is in, the rule only when it is not; "none" kept apart from a named list.
 * ⚑ **M11 is the stopped agent's line** (`withWhatItsLastStopEnded`): said only when a stop ended
   something — never as a lead on every turn's words.
 * ⚑ **M12 is the receiver's stop line** (`turn-origin.ts` `theStopBehindIt`): it defers to the
   named list, never the old "background work was not stopped".
 * ⚑ **M13–M15 are `interrupt_agent`'s description** (source pins): Codex ends EVERY command the
   stopped turn started; an earlier turn's keep running; the agent is told which commands ended.

## ⛔ What this table does not contain — no test reaches it (for the report)

 * Codex `noteWhatTheTurnMovedOnTo` — **the tool-use rule** (`TOOL_USES`, `SUB_AGENT_USES`; a
   message/reasoning/`write_stdin` does NOT move on): no test starts a command and then stops.
 * Codex `endTheCommandsOf`'s filter `turn.endsAll || !command.movedOn`, and
   `endEverythingTheTurnStarted`'s body (setting `endsAll`, the chained widening pass while the
   ending is deferred) — no Codex test interrupts a turn with a command in it.
 * Codex `interrupt()` ending commands BEFORE `turn/interrupt` (`if (turn.commands.size > 0)`), the
   **deferred ending** in `onTurnCompleted` / `completeOnceItsCommandsEnd` (bounded 1 s,
   `machine.openTurnId === turn.localId`), and the **second stop waiting on `completing`** instead
   of `forceEnd` — unreached.
 * `BackgroundTerminals.endTheseCommands`: only `{terminated:true}` named, the earlier turn's rows
   skipped (`theTurns(toolCallId)`), the `confirmedStopped` cleanup — unreached.
 * Claude `commandsWaitedOn` (main-agent Bash only, cleared at a turn's end) and `interrupt()`'s
   `!this.permissions.has(id)` (a Bash still on its card is not named) — every Claude test that
   stops during a Bash asserts the turn row loosely, so no ending's `endedCommands` is read.
 * `SessionMachine.noteWhatTheStopEnded`'s stale-turn guard (`this.turn.id === of`) and
   `beginTurn` taking the burst's list — **the stale-stop case**: no test notes ids.
 * `interrupt_agent`'s `ended` / `still_running` payload and its "The stop ended … / It still has
   … running in the background" sentences: every host test's agent has no command, so the arms are
   never taken; `whatStillRunsIn` likewise.
 * The giver's stall notice lines in `undrivenWorkText` (`cause === 'turn_interrupted' &&
   endedByTheStop.length > 0`, `stillRunning.length > 0`): both callers in tests pass `[]` and
   assert by `toContain` / paragraph slices that an extra line would not break.
 * `takeWhatItsStopEnded`'s D-039 rule (said again after a turn this app ended `failed`) and
   `stopEndedUntold` / `stopEndedSaid` — no test has a named command to say.
 * The `message_agent` / `answer_question` / `ask_question` per-provider sentences — no test pins
   them (only `interrupt_agent`'s is pinned).
 * Claude's `{"type":"ping"}` as a quiet lifecycle frame — no normalize test sends one.
"""

MACHINE = "packages/runtime/src/internal/session-machine.ts"
CODEX = "packages/runtime/src/codex/codex-runtime.ts"
HOST = "apps/desktop/src/main/runtime/runtime-host.ts"
TOOLS = "apps/desktop/src/main/runtime/agent-tools.ts"
ORIGIN = "apps/desktop/src/main/runtime/turn-origin.ts"

LIMIT = "a-limit-in-the-turns-ending.test.ts"
WAKES = "a-wakes-stop-and-the-message-that-joins-it.test.ts"
CONFORMANCE = "conformance.test.ts"
NOW = "message-now-stops-the-turn-it-reads-in.test.ts"
SEVERAL = "what-a-turn-of-several-held-messages-says-and-keeps.test.ts"
BACKGROUND = "a-backgrounded-agent-outlives-its-turn.test.ts"
SUPERVISOR = "state-a-supervisor-can-trust.test.ts"

MUTATIONS: list[tuple[str, list[tuple[str, str, str]]]] = [
    (
        "M1 · every turn's ending carries `endedCommands: []` — a stop that ended nothing reads as "
        f"one that named an empty list, on every ending · killed by `{LIMIT}` and `{WAKES}` · killed by `a-codex-stop-ends-the-commands-its-turn-started.test.ts` (named by W4.137)",
        [(MACHINE,
          "    ...(turn !== null && turn.endedCommands.length > 0\n",
          "    ...(turn !== null\n")],
    ),
    (
        "M2 · a burst's own ending (a turn the CLI started by itself) carries an empty "
        f"`endedCommands` though no stop ended anything · killed by `{WAKES}` · killed by `what-a-stop-ended-rides-its-turns-ending.test.ts` (named by W4.137)",
        [(MACHINE,
          "    if (event.endedCommands !== undefined || this.burstEndedCommands.length === 0) return event\n",
          "    if (event.endedCommands !== undefined) return event\n")],
    ),
    (
        "M3 · 🔴 Codex loses the explicit-stop widening — a person's Stop or `interrupt_agent` ends "
        "only the waited command, never every command the turn started (seen only as a contract "
        f"member missing from the handle) · killed by `{CONFORMANCE}` · killed by `a-codex-stop-ends-the-commands-its-turn-started.test.ts` (named by W4.137)",
        [(CODEX,
          "  endEverythingTheTurnStarted(): void {\n",
          "  endEverythingTheTurnStartedNever(): void {\n")],
    ),
    (
        "M4 · 🔴 the receipt never learns what the stop ended — the wait for the stopped turn's "
        f"ending is thrown away and the provider's rule is said instead · killed by `{NOW}` · killed by `a-stop-says-which-commands-it-ended.test.ts` (named by W4.137)",
        [(HOST,
          "    if (ended === undefined || stopped === undefined) return { ...asked, stop: said }\n",
          "    if (true) return { ...asked, stop: said }\n")],
    ),
    (
        "M5 · a WORKING turn's ending is not waited for — only one parked on a card is, so a stop of "
        f"a running turn is always 'unknown' · killed by `{NOW}` · killed by `a-stop-says-which-commands-it-ended.test.ts` (named by W4.137)",
        [(HOST,
          "    if (status !== 'working' && status !== 'waiting_permission') return Promise.resolve(undefined)\n",
          "    if (status !== 'waiting_permission') return Promise.resolve(undefined)\n")],
    ),
    (
        "M6 · 🔴 a turn's ending is never handed to whoever waits for it — `interrupt_agent` and the "
        f"receipts always time out and say nothing of what ended · killed by `{NOW}` · killed by `a-stop-says-which-commands-it-ended.test.ts` (named by W4.137)",
        [(HOST,
          "    for (const waiting of session.whenATurnEnds.splice(0)) waiting(ended)\n",
          "    session.whenATurnEnds.splice(0)\n")],
    ),
    (
        "M7 · 🔴 the host never reads a turn's ending for what its stop ended — no receipt, notice or "
        f"next turn learns of it · killed by `{NOW}` · killed by `a-stop-says-which-commands-it-ended.test.ts` (named by W4.137)",
        [(HOST,
          "    if (event.type === 'turn') this.takeWhatItsStopEnded(session, event)\n",
          "    if (event.type === 'turn' && false) this.takeWhatItsStopEnded(session, event)\n")],
    ),
    (
        "M8 · `message_agent` with `interrupt` drops what the stop ended on its way to the receipt, "
        f"so the receipt states the rule though the turn has ended · killed by `{NOW}` · killed by `a-stop-says-which-commands-it-ended.test.ts` (named by W4.137)",
        [(HOST,
          "      ...(stop.ended === undefined ? {} : { ended: stop.ended }),\n",
          "      ...{},\n")],
    ),
    (
        "M9 · the receipt states the provider's rule even when the stopped turn's ending is in — "
        f"facts never said · killed by `{NOW}` · killed by `a-stop-says-which-commands-it-ended.test.ts` (named by W4.137)",
        [(TOOLS,
          "        now.ended === undefined\n          ? theRuleOfAStopForWords(now.provider, called)\n",
          "        true\n          ? theRuleOfAStopForWords(now.provider, called)\n")],
    ),
    (
        "M10 · 'none' and a named list are swapped — a stop that ended nothing is said as having ended "
        f"an empty list · killed by `{NOW}` · killed by `a-stop-says-which-commands-it-ended.test.ts` (named by W4.137)",
        [(TOOLS,
          "              now.ended.length === 0\n",
          "              now.ended.length !== 0\n")],
    ),
    (
        "M11 · 🔴 every turn's words open with \"When your turn was stopped, the stop ended …\" — the "
        f"stopped agent's line is said with nothing ended · killed by `{SEVERAL}` · killed by `a-stop-says-which-commands-it-ended.test.ts` (named by W4.137)",
        [(HOST,
          "    if (names.length === 0) return words\n",
          "    if (names.length < 0) return words\n")],
    ),
    (
        "M12 · the receiver's stop line goes back to \"Work you set running in the background was not "
        "stopped\" — false after a widened stop, and no longer deferring to the named list · killed "
        f"by `{NOW}` · killed by `a-stop-says-which-commands-it-ended.test.ts` (named by W4.137)",
        [(ORIGIN,
          "    `before you go on: any of your commands the stop ended are named above, anything not named ` +\n"
          "    `there still runs, and your open questions are still open.`\n",
          "    `before you go on. Work you set running in the background was not stopped, and your open ` +\n"
          "    `questions are still open.`\n")],
    ),
    (
        "M13 · 🔴 `interrupt_agent` tells a model that on Codex a stop ends only the command the turn "
        f"waits on, not every command it started · killed by `{BACKGROUND}` · killed by `a-stop-says-which-commands-it-ended.test.ts` (named by W4.137)",
        [(TOOLS,
          "on Codex, every command that turn started, even one it left running.",
          "on Codex, the command that turn ran last, unless it has used another tool since.")],
    ),
    (
        "M14 · `interrupt_agent` tells a model a stop also ends commands an EARLIER turn left running "
        f"· killed by `{BACKGROUND}` · killed by `a-stop-says-which-commands-it-ended.test.ts` (named by W4.137)",
        [(TOOLS,
          "A command an earlier turn left running keeps running. The answer names",
          "A command an earlier turn left running is ended too. The answer names")],
    ),
    (
        "M15 · `interrupt_agent` goes back to \"The agent is told nothing by this call\" — false since "
        f"the stopped agent is told which commands ended · killed by `{SUPERVISOR}`",
        [(TOOLS,
          "The agent is not told who stopped it or why — only, the next time it is sent words, which of its commands the stop ended: to stop its turn",
          "The agent is told nothing by this call: to stop its turn")],
    ),
]
