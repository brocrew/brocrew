"""1018 · D-018 · the app stops idle agent processes itself, and a running agent's card shows its memory.

⚑ **Why `1018`**: card D-00N's table is `100N`. D-018 is one DEV commit, `f85441b1`, landed through the
frontend's merge `1f55a270` (it conflicted with the `ui` card in `AgentCard.vue`).

## What it changed

* **The idle stop** (`05` rule 4): one countdown per running conversation, armed by D-019's flush when
  it derives the conversation idle enough to stop, and dropped by every mark. After ten minutes the fire
  re-derives all of it and stops the process through the conversation's own close, as the app itself. A
  stop changes nothing about a piece, and the next message starts it again.
* **The memory line** (`05` rule 5): `processMemory` reads each running conversation's provider
  process by its pid (`ps -o … -p`, bounded), shared between askers; the window asks with the band's
  read, and the agent card says how much is in use.

 * `M1`–`M14` — the idle stop. Killed by the landing's
   `a-quiet-conversation-is-stopped-by-the-app-and-woken-by-its-next-message.test.ts`.
 * `M20`–`M28` — the memory read, its door and the screen's ask. Killed by the landing's
   `the-memory-a-running-agent-holds-is-read-by-pid-and-never-kept.test.ts` (`M21` also by DEV's
   `the-word-the-poll-cannot-say.test.ts`).

Designed read-only by Sonnet 5.5 agents from the commit and today's code; each row verified alone by the
landing agent.

## Verification

- **RED: 23 of 23.** Each row alone by `verify_row.py` with its named killer, on `landing` over
  `1c07454c` (the merges of PE-006, `1f55a270` and `2b765d75`), none by a syntax, reference or type
  error. Each killer file ran green unmutated first.
"""

PROCESS_TREE = "apps/desktop/src/main/process-tree.ts"
IPC = "apps/desktop/src/main/runtime/ipc.ts"
RUNTIME_HOST = "apps/desktop/src/main/runtime/runtime-host.ts"
RUNTIME_SCREEN_VUE = "apps/desktop/src/renderer/src/components/RuntimeScreen.vue"
SESSION_STORE = "apps/desktop/src/renderer/src/lib/session-store.ts"

MUTATIONS: list[tuple[str, list[tuple[str, str, str]]]] = [
    (
        "M1 · a conversation whose state cannot be read when its countdown runs out is stopped anyway · the catch warns and falls through to the close, so a read that failed kills the process of an agent that may be mid-question — killed by `a-quiet-conversation-is-stopped-by-the-app-and-woken-by-its-next-message.test.ts`",
        [
            (RUNTIME_HOST, "is still idle: ${errorMessage(error)}`,\n      )\n      return\n", "is still idle: ${errorMessage(error)}`,\n      )\n"),
        ],
    ),
    (
        "M2 · the fire logs that it is stopping the process and never closes the conversation · every countdown runs out into nothing, the 300 MB is never freed — killed by `a-quiet-conversation-is-stopped-by-the-app-and-woken-by-its-next-message.test.ts`",
        [
            (RUNTIME_HOST, "      await this.close(conversation, THE_APP_ITSELF)\n", ""),
        ],
    ),
    (
        "M3 · the default quiet is ten minutes, not one · an idle agent's process keeps its memory for ten minutes after an exchange ends — killed by `a-quiet-conversation-is-stopped-by-the-app-and-woken-by-its-next-message.test.ts`",
        [
            # Re-anchored in place, not retired. Source-only, NOT VERIFIED: the default is one minute
            # now, so the row plants the old ten.
            (RUNTIME_HOST, "const DEFAULT_IDLE_STOP_AFTER_MS = 60_000", "const DEFAULT_IDLE_STOP_AFTER_MS = 10 * 60_000"),
        ],
    ),
    (
        "M4 · a conversation a person has asked to put into plan mode is still counted · the stop would drop planning and its go-ahead bar — killed by `a-quiet-conversation-is-stopped-by-the-app-and-woken-by-its-next-message.test.ts`",
        [
            (RUNTIME_HOST, "      !planning.effective &&\n      !planning.requested\n", "      !planning.effective\n"),
        ],
    ),
    (
        "M5 · a mark no longer clears the countdown it finds · the old timer stays armed (cleared() never sees it) for a conversation that is no longer idle — killed by `a-quiet-conversation-is-stopped-by-the-app-and-woken-by-its-next-message.test.ts`",
        [
            (RUNTIME_HOST, "      clearTimeout(countdown)\n      this.idleCountdowns.delete(conversation)\n", "      this.idleCountdowns.delete(conversation)\n"),
        ],
    ),
    (
        "M6 · a countdown that a later mark replaced still stops the conversation · the stale callback finds it idle and closes it, ten minutes of quiet counted from the first arming — killed by `a-quiet-conversation-is-stopped-by-the-app-and-woken-by-its-next-message.test.ts`",
        [
            (RUNTIME_HOST, "if (this.launches.closed || this.idleCountdowns.get(conversation) !== countdown) return", "if (this.launches.closed) return"),
        ],
    ),
    (
        "M7 · a flush counts the quiet only when the conversation's word moved · a mark that leaves the word as it was drops the countdown and the conversation is never counted again — killed by `a-quiet-conversation-is-stopped-by-the-app-and-woken-by-its-next-message.test.ts`",
        [
            # ⚑ **source-restoration · re-anchored in place, not retired** — NOT VERIFIED; source targeting only. 5ae6a3206 added provider-block state to the same flush comparison; preserve it while moving idle counting after unchanged-state suppression.
            (RUNTIME_HOST, "        if (this.idleEnoughToStop(conversation, state)) this.countTheIdleMinutes(conversation)\n        const limits = this.providerBlockDisclosure(conversation)\n        const said = JSON.stringify({ state, ...limits })\n        if (this.stateSaid.get(conversation) === said) continue\n", "        const limits = this.providerBlockDisclosure(conversation)\n        const said = JSON.stringify({ state, ...limits })\n        if (this.stateSaid.get(conversation) === said) continue\n        if (this.idleEnoughToStop(conversation, state)) this.countTheIdleMinutes(conversation)\n"),
        ],
    ),
    (
        "M8 · a conversation with a background command running is counted · the stop kills the command with the process — killed by `a-quiet-conversation-is-stopped-by-the-app-and-woken-by-its-next-message.test.ts`",
        [
            # ⚑ **the service dispatcher · re-anchored in place, not retired** — NOT VERIFIED: re-anchored source-only on the text L4a moved or repeated; the mutant makes the same change as before; no table run.
            (RUNTIME_HOST, "      !somethingRunning(session.background) &&\n      !scheduleHeld(session.scheduled) &&\n      session.handle.status() === 'idle' &&\n", "      !scheduleHeld(session.scheduled) &&\n      session.handle.status() === 'idle' &&\n"),
        ],
    ),
    (
        "M9 · a conversation holding a schedule is counted · its wake-ups die with the process — killed by `a-quiet-conversation-is-stopped-by-the-app-and-woken-by-its-next-message.test.ts`",
        [
            (RUNTIME_HOST, "      !scheduleHeld(session.scheduled) &&\n", ""),
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (W4.210, W4's decision A):** a conversation whose *needs you* the
        # LEDGER holds — a question to a person, an ask against an agent's rules, a piece waiting on
        # the person who wrote to it — is now counted and stopped like an idle one, so this row's
        # mutation is now the code itself. The card a provider holds open is kept by its status
        # (`waiting_permission`), pinned by "a turn parked on its card has no countdown". Its
        # anchor is left stale, so the census records it retired.
        "M10 · a conversation that needs a person is counted · the stop is armed under an open ask against its rules — killed by `a-quiet-conversation-is-stopped-by-the-app-and-woken-by-its-next-message.test.ts`",
        [
            (RUNTIME_HOST, "    if (state.is === 'needs-you' || state.is === 'active') return false\n", "    if (state.is === 'active') return false\n"),
        ],
    ),
    (
        "M11 · the levels are read through the word, so waiting on an answer hides them · a conversation waiting on an answer that also holds a background command or a schedule is counted and its process stopped — killed by `a-quiet-conversation-is-stopped-by-the-app-and-woken-by-its-next-message.test.ts`",
        [
            (RUNTIME_HOST, "      !somethingRunning(session.background) &&\n      !scheduleHeld(session.scheduled) &&\n", "      state.is !== 'in-the-background' &&\n      state.is !== 'scheduled' &&\n"),
        ],
    ),
    (
        "M12 · the fire stops the conversation without asking again whether it is still idle · whatever moved without a mark in the interval (a person's interrupt-and-send holding the queue) is ignored — killed by `a-quiet-conversation-is-stopped-by-the-app-and-woken-by-its-next-message.test.ts`",
        [
            (RUNTIME_HOST, "      if (!this.idleEnoughToStop(conversation, state)) return\n", ""),
        ],
    ),
    (
        "M13 · a person's interrupt-and-send that is refused after the interrupt leaves the conversation idle with no countdown · the hold is let go without a mark, so nothing counts the conversation until its next fact — killed by `a-quiet-conversation-is-stopped-by-the-app-and-woken-by-its-next-message.test.ts`",
        [
            (RUNTIME_HOST, "counted again here ({@link idleEnoughToStop}).\n      this.stateMayHaveMoved(session.id)\n", "counted again here ({@link idleEnoughToStop}).\n"),
        ],
    ),
    (
        "M14 · leaving plan mode with no message does not count the conversation · it started no turn, so no status row follows and it is never counted again — killed by `a-quiet-conversation-is-stopped-by-the-app-and-woken-by-its-next-message.test.ts`",
        [
            (RUNTIME_HOST, "so it is counted.\n    this.stateMayHaveMoved(sessionId)\n", "so it is counted.\n"),
        ],
    ),
    (
        "M20 · the memory read lists every process on the machine (`-axo`) instead of the named pids — killed by `the-memory-a-running-agent-holds-is-read-by-pid-and-never-kept.test.ts`",
        [
            (PROCESS_TREE, "return ['-o', PS_COLUMNS, '-p', pids.join(',')]", "return ['-axo', PS_COLUMNS]"),
        ],
    ),
    (
        "M21 · the memory read includes a conversation that is already on its way out — killed by `the-memory-a-running-agent-holds-is-read-by-pid-and-never-kept.test.ts`, `the-word-the-poll-cannot-say.test.ts`",
        [
            (RUNTIME_HOST, "if (this.runningStateOf(conversation) === 'not-running') continue", "if (slot.session === null) continue"),
        ],
    ),
    (
        "M22 · every asker forks its own `ps` instead of sharing the read in flight — killed by `the-memory-a-running-agent-holds-is-read-by-pid-and-never-kept.test.ts`",
        [
            (RUNTIME_HOST, "return (this.processMemoryRead ??= this.measureProcessMemory().finally(() => {", "return (this.processMemoryRead = this.measureProcessMemory().finally(() => {"),
        ],
    ),
    (
        "M23 · the finished read is kept, so every later ask gets the first answer (or the first failure) forever — killed by `the-memory-a-running-agent-holds-is-read-by-pid-and-never-kept.test.ts`",
        [
            (RUNTIME_HOST, "      this.processMemoryRead = null", "      void 0"),
        ],
    ),
    (
        "M24 · the window door answers `processMemory` with the forest instead of the memory — killed by `the-memory-a-running-agent-holds-is-read-by-pid-and-never-kept.test.ts`",
        [
            (IPC, "return host.processMemory()", "return host.theWholeForest()"),
        ],
    ),
    (
        "M25 · the renderer store lets a refused or failed memory read throw instead of answering null — killed by `the-memory-a-running-agent-holds-is-read-by-pid-and-never-kept.test.ts`",
        [
            (SESSION_STORE, "        return await bridge.processMemory()\n      } catch {\n        return null\n      }", "        return await bridge.processMemory()\n      } catch (refused) {\n        throw refused\n      }"),
        ],
    ),
    (
        "M26 · the screen never asks main for the process memory, so no card ever shows a figure — killed by `the-memory-a-running-agent-holds-is-read-by-pid-and-never-kept.test.ts`",
        [
            # ⚑ **W4.91 · re-anchored in place, not retired** — 031d1176 made the memory read from two call sites, so the row now empties the one read itself: the screen never asks main
            (RUNTIME_SCREEN_VUE, "  const held = await store.processMemory()\n", "  const held = await Promise.resolve(null)\n"),
        ],
    ),
    (
        "M27 · a memory read that did not answer keeps the last figures instead of drawing none — killed by `the-memory-a-running-agent-holds-is-read-by-pid-and-never-kept.test.ts`",
        [
            (RUNTIME_SCREEN_VUE, "  const held = await store.processMemory()\n  cast.processMemory.value = new Map(\n    (held?.conversations ?? []).map((one) => [one.conversation, one.bytes]),\n  )", "  const held = await store.processMemory()\n  if (held === null) return\n  cast.processMemory.value = new Map(\n    held.conversations.map((one) => [one.conversation, one.bytes]),\n  )"),
        ],
    ),
    (
        "M28 · a process that is gone is drawn as 0 MB instead of absent — killed by `the-memory-a-running-agent-holds-is-read-by-pid-and-never-kept.test.ts`",
        [
            (RUNTIME_HOST, "return bytes === undefined ? [] : [{ conversation, bytes }]", "return [{ conversation, bytes: bytes ?? 0 }]"),
        ],
    ),
]
