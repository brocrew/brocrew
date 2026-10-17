"""3021 · F084's per-provider stop logic, reached since W4.137 — 1e2f7706.

⛔ **The subject**: the half of F084 that table 3019 could only list as "no test reaches it". Four
test files written in W4.137 now reach it: the Codex adapter over an app-server double with a
process table, the Claude adapter over a CLI double, the session machine directly, and the host
over the fake runtime. On Codex the adapter ends the commands a stopped turn started. An explicit
stop ends every one. A stop for words ends only the one the turn waits on, unless a later TOOL USE
moved on from it. An earlier turn's commands are never ended. On Claude the turn's ending names the
main agent's waited-on Bash. The host says what ended and what still runs.

## ⚑ What a row here measures

 * ⚑ **M1, M2 are Codex's tool-use rule** (`codex-runtime.ts` `TOOL_USES`, `SUB_AGENT_USES`). A
   message (which is all a `write_stdin` poll looks like) does not move on; a sub-agent spawned does.
 * ⚑ **M3, M4 are `endTheCommandsOf`'s filter**: an explicit stop ends every command the turn
   started, and no stop ends an earlier turn's.
 * ⚑ **M5–M7 are the two passes and the deferred ending** (`onTurnCompleted`, `interrupt()`,
   `endEverythingTheTurnStarted`). A stopped turn's ending waits for its second pass. A second stop
   during that wait waits too, rather than forcing an ending. An explicit stop asked during it
   widens it.
 * ⚑ **M8 is the machine's stale-stop guard** (`session-machine.ts` `noteWhatTheStopEnded`): a note
   for a turn that already ended lands nowhere.
 * ⚑ **M9 is `BackgroundTerminals.endTheseCommands`**: only `{terminated:true}` is named.
 * ⚑ **M10–M12 are Claude's `commandsWaitedOn`** (`claude-runtime.ts`): a backgrounded Bash
   (answered at once), a sub-agent's Bash and a Bash still on its approval card are not named.
 * ⚑ **M13, M14 are `interrupt_agent`'s answer**: `ended` (`agent-tools.ts`) and `still_running`
   (`runtime-host.ts` `whatStillRunsIn`).
 * ⚑ **M15 is the giver's notice** (`reply-rails.ts` `undrivenWorkText`): "The stop ended …" only
   when a stop stalled the piece.
 * ⚑ **M16 is the stopped agent's next-words line** (`runtime-host.ts` `takeWhatItsStopEnded`):
   said again after a turn this app ended `failed` (D-039).

## ⛔ What this table does not contain

 * ⚠️ Anything table 3019 already mutates. Its anchors are not reused: `endedCommands` on the
   machine's endings, the `endEverythingTheTurnStarted` member, the host's wait for the ending, the
   receipt's words, `withWhatItsLastStopEnded`'s empty guard, `theStopBehindIt`, and the
   `interrupt_agent` description pins.
 * ⛔ `completeOnceItsCommandsEnd`'s `machine.openTurnId === turn.localId` — EQUIVALENT (W4.139):
   while the ending waits nothing can open another turn, and the only things that take the turn
   away (`close()`, a fatal error) leave the machine terminal first (`doClose` calls `forceEnd`
   and `closeSession` with no await between), so `completeTurn` returns at once anyway.
 * ⚠️ Its widening loop: redundant wherever a test widens, because the pass in flight reads
   `endsAll` after its list answers. Removing the loop's exit would only risk a hang.
 * ⛔ `endTheCommandsOf`'s `isShuttingDown` return — EQUIVALENT (W4.139): `closing` is set one
   statement after `backgroundTerminals.close()` turns the watch off, so `endTheseCommands`
   already answers `[]` with no request sent, and noting an empty list does nothing.
 * ⚑ `answer_question`'s receipt arm is M17 (W4.139), killed by the new §2b cases.
 * ⚠️ The per-provider description sentences and Claude's `ping`: pins rather than logic. Kept off
   the 16-row budget. The same goes for the first pass before `turn/interrupt`, an unstopped turn's
   pass, `confirmedStopped`'s cleanup, Claude's turn-end `clear()`, the "said once" splice and a sub-agent's own
   ending not moving on. Each
   is reached (see /tmp/w4137/NOTES.md), but a stronger row above covers its subject.

⚠️ The four killer files are uncommitted in the repo as this is drafted, so `git ls-files` finds
them only once they are committed. Each basename is unique among tracked and untracked files.
"""

CODEX = "packages/runtime/src/codex/codex-runtime.ts"
TERMINALS = "packages/runtime/src/codex/background-terminals.ts"
MACHINE = "packages/runtime/src/internal/session-machine.ts"
CLAUDE = "packages/runtime/src/claude/claude-runtime.ts"
TOOLS = "apps/desktop/src/main/runtime/agent-tools.ts"
HOST = "apps/desktop/src/main/runtime/runtime-host.ts"
RAILS = "apps/desktop/src/main/runtime/reply-rails.ts"

CODEX_STOP = "a-codex-stop-ends-the-commands-its-turn-started.test.ts"
CLAUDE_STOP = "a-claude-stop-names-the-bash-it-waited-on.test.ts"
RIDES = "what-a-stop-ended-rides-its-turns-ending.test.ts"
SAYS = "a-stop-says-which-commands-it-ended.test.ts"

MUTATIONS: list[tuple[str, list[tuple[str, str, str]]]] = [
    (
        "M1 · 🔴 **a message moves on** · a model polling its command (`write_stdin` shows as "
        "nothing but its words) has 'moved on' from it, so a stop for words leaves the waited "
        f"command running · killed by `{CODEX_STOP}`",
        [(CODEX,
          "const TOOL_USES: ReadonlySet<string> = new Set([\n",
          "const TOOL_USES: ReadonlySet<string> = new Set([\n  'agentMessage',\n")],
    ),
    (
        "M2 · a sub-agent SPAWNED is not a tool use, so a stop for words still ends the command the "
        f"model left running to spawn it · killed by `{CODEX_STOP}`",
        [(CODEX,
          "const SUB_AGENT_USES: ReadonlySet<string> = new Set(['started', 'interacted'])",
          "const SUB_AGENT_USES: ReadonlySet<string> = new Set(['interacted'])")],
    ),
    (
        "M3 · 🔴 **an explicit stop is a words stop** · a person's Stop or `interrupt_agent` ends "
        "only the waited command; the one the turn moved on from runs on · killed by "
        f"`{CODEX_STOP}`",
        [(CODEX,
          "        return command !== undefined && (turn.endsAll || !command.movedOn)\n",
          "        return command !== undefined && !command.movedOn\n")],
    ),
    (
        "M4 · 🔴 **a stop ends an EARLIER turn's command** · every listed command the turn did not "
        f"start is ended too, the dev server an earlier turn left running included · killed by `{CODEX_STOP}`",
        [(CODEX,
          "        return command !== undefined && (turn.endsAll || !command.movedOn)\n",
          "        return command === undefined || turn.endsAll || !command.movedOn\n")],
    ),
    (
        "M5 · 🔴 a stopped turn's ending is written at once: no second pass, so a command started "
        "between the stop and Codex's ending runs on unnamed, and the next turn can start over it · "
        f"killed by `{CODEX_STOP}`",
        [(CODEX,
          "    if (ended?.interruptAsked === true && ended.commands.size > 0) {\n",
          "    if (false) {\n")],
    ),
    (
        "M6 · 🔴 a second stop during the deferred ending forces one of this app's own "
        "(`wordOf`), which loses the names and lets the real ending land on the next turn · killed "
        f"by `{CODEX_STOP}`",
        [(CODEX,
          "    if (!this.currentTurn && this.completing !== null) {\n",
          "    if (false) {\n")],
    ),
    (
        "M7 · an explicit stop asked while the ending waits on its commands does not widen it, so the "
        f"command the turn moved on from runs on · killed by `{CODEX_STOP}`",
        [(CODEX,
          "    if (ending === undefined || ending.endsAll) return\n",
          "    if (true) return\n")],
    ),
    (
        "M8 · 🔴 **the stale stop** · a pass that answers after its turn ended names its commands on "
        f"the NEXT turn's ending · killed by `{RIDES}` and `{CODEX_STOP}`",
        [(MACHINE,
          "        : this.turn !== null && this.turn.id === of\n",
          "        : this.turn !== null\n")],
    ),
    (
        "M9 · a command that had finished by itself (`{terminated:false}`) is named as one the stop "
        f"ended · killed by `{CODEX_STOP}`",
        [(TERMINALS,
          "        if (terminated) ended.push({ id: row.id, toolCallId })\n",
          "        ended.push({ id: row.id, toolCallId })\n")],
    ),
    (
        "M10 · 🔴 a Claude stop names the Bash it sent to the background (and one whose result came "
        f"back), which the CLI spares · killed by `{CLAUDE_STOP}`",
        [(CLAUDE,
          "    if (event.type === 'tool_result') this.commandsWaitedOn.delete(event.id)\n",
          "    if (false) this.commandsWaitedOn.delete(event.id)\n")],
    ),
    (
        "M11 · a Claude stop names a SUB-AGENT's Bash as the turn's own · killed by "
        f"`{CLAUDE_STOP}`",
        [(CLAUDE,
          "      event.parentToolCallId === undefined\n",
          "      true\n")],
    ),
    (
        "M12 · a Claude stop names a Bash still on its approval card, which never ran and which the "
        f"stop refuses · killed by `{CLAUDE_STOP}`",
        [(CLAUDE,
          "    const running = [...this.commandsWaitedOn].filter((id) => !this.permissions.has(id))\n",
          "    const running = [...this.commandsWaitedOn]\n")],
    ),
    (
        "M13 · `interrupt_agent`'s answer drops `ended`, so a supervisor reads the sentence but not "
        f"the list · killed by `{SAYS}`",
        [(TOOLS,
          "                ...(outcome.ended === undefined ? {} : { ended: outcome.ended }),\n",
          "                ...{},\n")],
    ),
    (
        "M14 · 🔴 nothing is ever 'still running' after a stop · `interrupt_agent`, the receipt and "
        "the giver's notice never name the earlier turn's command the stop left running · killed by "
        f"`{SAYS}`",
        [(HOST,
          "    return (slot.session?.background.running ?? []).map((row) => backgroundWhat(row).text)\n",
          "    return []\n")],
    ),
    (
        "M15 · the giver's notice says \"The stop ended …\" on a piece that no stop stalled · killed "
        f"by `{SAYS}`",
        [(RAILS,
          "  if (cause === 'turn_interrupted' && endedByTheStop.length > 0) {\n",
          "  if (endedByTheStop.length > 0) {\n")],
    ),
    (
        "M16 · 🔴 **D-039** · the stopped agent's line is spent by a turn this app ended `failed`, "
        f"so the agent is never told what the stop ended · killed by `{SAYS}`",
        [(HOST,
          "    if (event.state !== 'failed' || event.wordOf !== 'this-app') {\n",
          "    if (true) {\n")],
    ),
    (
        "M17 · `answer_question`'s receipt forgets what the stop ended and says only the provider's "
        "rule · killed by `a-stop-says-which-commands-it-ended.test.ts` (§2b, W4.139)",
        [("apps/desktop/src/main/runtime/agent-tools.ts",
          '              : whatBecameOfTheStop(\n                  answered.stop,\n',
          '              : whatBecameOfTheStop(\n                  { stop: answered.stop.stop, askedOf: answered.stop.askedOf, provider: answered.stop.provider },\n')],
    ),
]
