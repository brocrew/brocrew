"""1019 · D-019 · the window hears when an agent's state changes.

⚑ **Why `1019`**: card D-00N's table is `100N`. D-019 is one DEV commit, `8e47328e`.

## What it changed

Main tells every window the moment a conversation's state changes, on `runtime:states`, as a delta of
the conversations that moved: each fact that can move a state MARKS its conversation, and one flush per
loop turn derives only what was marked (from `stateOf`) and sends only what differs from what was last
said, with no timer, sweep or poll. The rail folds the pushed states over its one list; the list
re-read on the 30-second tick and on the waits reading are gone (the re-read on work stays).

 * `M1`–`M10` **main's push** — `the-window-is-told-what-an-agent-is-doing-the-moment-it-moves.test.ts`.
 * `M11`–`M20` **the rail's fold** — `the-rail-draws-what-main-pushed-over-the-list-it-read.dom.test.ts`.

Table `2003`'s rows about the removed re-reads were retired (`M21`–`M23`) or re-anchored onto the push
(`M20`, `M24`–`M28`). DEV wrote no new tests (the work model). Designed read-only by Sonnet 5.5 agents
from the commit, the card and today's code; each row verified alone by the landing agent.

## Verification

- **RED: 20 of 20.** Each row alone by `verify_row.py` with its named killer, on `landing` over
  `de49bf69` (the merge of `8e47328e`), none by a syntax, reference or type error. Each killer file ran
  green unmutated first.
"""

INDEX = "apps/desktop/src/main/index.ts"
RUNTIME_HOST = "apps/desktop/src/main/runtime/runtime-host.ts"
RUNTIME_SCREEN_VUE = "apps/desktop/src/renderer/src/components/RuntimeScreen.vue"
SIDE_RAIL_VUE = "apps/desktop/src/renderer/src/components/SideRail.vue"
CONVERSATION_LIST = "apps/desktop/src/renderer/src/lib/conversation-list.ts"
QUESTIONS = "apps/desktop/src/shared/questions.ts"

MUTATIONS: list[tuple[str, list[tuple[str, str, str]]]] = [
    (
        "M1 · 🔴 a status row no longer marks the conversation · a turn that ends or parks is never pushed, so the rail keeps drawing the word the last mark left — killed by `the-window-is-told-what-an-agent-is-doing-the-moment-it-moves.test.ts`",
        [
            (RUNTIME_HOST, "  'status',\n  'background_work',\n", "  'background_work',\n"),
        ],
    ),
    (
        "M2 · 🔴 a background_work row no longer marks the conversation · a background job started or finished is never pushed, so the rail says idle while a build runs — killed by `the-window-is-told-what-an-agent-is-doing-the-moment-it-moves.test.ts`",
        [
            # ⚑ **the service dispatcher · re-anchored in place, not retired** — NOT VERIFIED: re-anchored source-only on the text L4a moved or repeated; the mutant makes the same change as before; no table run.
            (RUNTIME_HOST, "  'status',\n  'background_work',\n  'scheduled_work',\n", "  'status',\n  'scheduled_work',\n"),
        ],
    ),
    (
        "M3 · 🔴 the flush no longer compares with what the windows were last told · every mark is pushed, equal word or not, and a stream of levels costs an IPC message each — killed by `the-window-is-told-what-an-agent-is-doing-the-moment-it-moves.test.ts`",
        [
            (RUNTIME_HOST, "        if (this.stateSaid.get(conversation) === said) continue\n", ""),
        ],
    ),
    (
        "M4 · 🔴 the launch row type `launched` drops out of the set the wait reads select · a conversation started again keeps the wait read of its previous run, and a type added to the SQL and not to the set goes stale silently — killed by `the-window-is-told-what-an-agent-is-doing-the-moment-it-moves.test.ts`",
        [
            (QUESTIONS, "  'launched',\n  'user_input_request',\n", "  'user_input_request',\n"),
        ],
    ),
    (
        "M5 · 🔴 the flush no longer keeps the wait reads it derived a running conversation from · every level or status re-reads the conversation's whole ledger (0.2–0.4 s on an 88k-event one) — killed by `the-window-is-told-what-an-agent-is-doing-the-moment-it-moves.test.ts`",
        [
            (RUNTIME_HOST, "        if (runs) this.waitAsLastRead.set(conversation, ledger)\n", ""),
        ],
    ),
    (
        "M6 · 🔴 a row the wait reads select no longer drops the kept read · a conversation keeps deriving who owes it the next move from a ledger that has since moved — killed by `the-window-is-told-what-an-agent-is-doing-the-moment-it-moves.test.ts`",
        [
            (RUNTIME_HOST, "      this.waitAsLastRead.delete(conversation)\n      this.stateMayHaveMoved(conversation)\n", "      this.stateMayHaveMoved(conversation)\n"),
        ],
    ),
    (
        "M7 · 🔴 a conversation the flush cannot read rethrows from setImmediate · one bad ledger costs every other conversation's word and takes main down with an uncaught exception — killed by `the-window-is-told-what-an-agent-is-doing-the-moment-it-moves.test.ts`",
        [
            (RUNTIME_HOST, "        console.warn(\n          `runtime host could not say what ${conversation} is doing: ${errorMessage(error)}`,\n        )\n", "        throw error\n"),
        ],
    ),
    (
        "M8 · 🔴 the rail drops a push that arrived while its list read was in flight · the older half of a two-reply answer overwrites the newer word and the row flips back — killed by `the-window-is-told-what-an-agent-is-doing-the-moment-it-moves.test.ts`",
        [
            (SIDE_RAIL_VUE, "heard.after >= asked", "heard.after > asked"),
        ],
    ),
    (
        "M9 · 🔴 the list ignores what main pushed · every surface drawn from it keeps the row's own state until the next list read — killed by `the-window-is-told-what-an-agent-is-doing-the-moment-it-moves.test.ts`",
        [
            (CONVERSATION_LIST, "state: input.said?.get(row.sessionId) ?? row.state,", "state: row.state,"),
        ],
    ),
    (
        "M10 · 🔴 `statesMoved` sends on the invalidation channel instead of its own · the renderer's `runtime:changed` listener gets a message it refuses, and nobody hears `runtime:states`, so the whole push is dead — killed by `the-window-is-told-what-an-agent-is-doing-the-moment-it-moves.test.ts`",
        [
            # ⚑ **source-restoration · re-anchored in place, not retired** — NOT VERIFIED; source targeting only. 7d2f08f06 moved sends through the guarded broadcast helper; keep that helper and change only the states channel to invalidation.
            (INDEX, "        RUNTIME_STATES_CHANNEL,\n        message,\n", "        RUNTIME_CHANGED_CHANNEL,\n        message,\n"),
        ],
    ),
    (
        "M11 · the one list ignores what main pushed and always draws the row's own state — killed by `the-rail-draws-what-main-pushed-over-the-list-it-read.dom.test.ts`",
        [
            (CONVERSATION_LIST, "state: input.said?.get(row.sessionId) ?? row.state,", "state: row.state,"),
        ],
    ),
    (
        "M12 · the rail's `listed` hands `conversationList` an empty map instead of what main said — killed by `the-rail-draws-what-main-pushed-over-the-list-it-read.dom.test.ts`, `the-rails-list-is-asked-again-when-an-agents-state-may-have-moved.test.ts`",
        [
            (SIDE_RAIL_VUE, "said: new Map([...said.value].map(([conversation, heard]) => [conversation, heard.state])),", "said: new Map(),"),
        ],
    ),
    (
        "M13 · hearStates writes into the map it already holds, so the ref is assigned the same object and nothing redraws — killed by `the-rail-draws-what-main-pushed-over-the-list-it-read.dom.test.ts`, `the-rails-list-is-asked-again-when-an-agents-state-may-have-moved.test.ts`",
        [
            (SIDE_RAIL_VUE, "const next = new Map(said.value)", "const next = said.value as Map<string, { state: OneState; after: number }>"),
        ],
    ),
    (
        "M14 · hearStates starts from an empty map, so a later message forgets every earlier push — killed by `the-rail-draws-what-main-pushed-over-the-list-it-read.dom.test.ts`, `the-rails-list-is-asked-again-when-an-agents-state-may-have-moved.test.ts`",
        [
            (SIDE_RAIL_VUE, "const next = new Map(said.value)", "const next = new Map<string, { readonly state: OneState; readonly after: number }>()"),
        ],
    ),
    (
        "M15 · a list read no longer gives way pushes older than its ask (the prune is gone) — killed by `the-rail-draws-what-main-pushed-over-the-list-it-read.dom.test.ts`",
        [
            (SIDE_RAIL_VUE, "said.value = new Map([...said.value].filter(([, heard]) => heard.after >= asked))", "void asked"),
        ],
    ),
    (
        "M16 · a push that arrived while the read was in flight is dropped by the prune (`>` for `>=`) — killed by `the-rail-draws-what-main-pushed-over-the-list-it-read.dom.test.ts`",
        [
            (SIDE_RAIL_VUE, "heard.after >= asked", "heard.after > asked"),
        ],
    ),
    (
        "M17 · the screen answers a `runtime:states` message by asking the rail's list again instead of handing the message over — killed by `the-rails-list-is-asked-again-when-an-agents-state-may-have-moved.test.ts`",
        # ⚑ Landing D-026, PE-007 and the ui files batch · re-anchored in place, not retired — The rule
        # survives: the screen hands each runtime:states message to the rail's own hearStates door instead
        # of asking the list again. D-026 (message type) and UI-002's b57d1579 turned the one-line
        # listener into a block (it now also reads the files when message.kept is non-empty), so the old
        # one-line anchor is gone; the call sits alone on its own line, once. The plant replaces it with a
        # refreshResumable ask and keeps `message` in scope, so the later `message.kept.length` line still
        # runs. Killed by `the-rails-list-is-asked-again-when-an-agents-state-may-have-moved.test.ts`.
        [
            (RUNTIME_SCREEN_VUE, "    rail.value?.hearStates(message)\n", "    void rail.value?.refreshResumable()\n"),
        ],
    ),
    (
        "M18 · the band's 30-second tick asks the rail's list too — killed by `the-rails-list-is-asked-again-when-an-agents-state-may-have-moved.test.ts`",
        [
            # ⚑ W4.74 · re-anchored in place: the band's tick is gone (D-033); the one interval left
            # that could ride the rail's list along is the glance — the same defect, one tick over.
            (RUNTIME_SCREEN_VUE, "glancing = setInterval(() => void glance(), ROSTER_EVERY_MS)", "glancing = setInterval(() => void Promise.all([glance(), rail.value?.refreshResumable()]), ROSTER_EVERY_MS)"),
        ],
    ),
    (
        "M19 · the waits reading asks the rail's list again after it lands — killed by `the-rails-list-is-asked-again-when-an-agents-state-may-have-moved.test.ts`",
        [
            (RUNTIME_SCREEN_VUE, "if (reading !== null) conversationWaits.value = reading", "if (reading !== null) conversationWaits.value = reading\n  void rail.value?.refreshResumable()"),
        ],
    ),
    (
        "M20 · the `work` arm no longer asks the rail's list, so a give, reply, take-back, close or retitle stops renaming the rail rows — killed by `the-rails-list-is-asked-again-when-an-agents-state-may-have-moved.test.ts`",
        [
            (RUNTIME_SCREEN_VUE, "// ({@link stopHearingStates}).\n      void rail.value?.refreshResumable()", "// ({@link stopHearingStates})."),
        ],
    ),
]
