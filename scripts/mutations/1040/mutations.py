"""1040 · D-040, a sub-agent's frames are not the main agent working — 9233fce9, with D-050's migration (c7a1878c).

⛔ **The defect (D-040, F054).** `isProviderWork` classified an event by its type alone, and a
Claude sub-agent's `tool_call`, `tool_result` and `assistant_message` carry the same types as the
main agent's. A BACKGROUND sub-agent's tool call, 12 s after the main agent's turn had ended, opened
an unbidden burst; a sub-agent writes no `result` to its parent's stream, so the conversation read
`working` for eleven minutes over a main agent doing nothing, and every message sent to it was held.
⚑ 9233fce9: `isProviderWork` returns false for an event that carries `parentToolCallId` (and true
for one whose `parentToolCallId` is explicitly `undefined`), so only the main agent's own output
reaches `SessionMachine.noteProviderWork` from the Claude runtime's `deliver`.

⚑ **D-050 (c7a1878c)** took the agents' model limit out and dropped its two columns with migration
`0002_no_agent_limit`. Rows that would bring the limit back are not meaningful (its code is gone);
what still exists is the migration and its journal entry, and those two rows are here.

## ⚑ What a row here measures

 * ⚑ **M1 is the defect, verbatim** — the parent check gone, every frame of the five types read as
   the main agent working.
 * ⚑ **M2–M3 are the check's edges** — an explicit `undefined` parent is still the main agent's, and
   all three parented types are refused, not just the tool call.
 * ⚑ **M4 is the stamp the check reads** — `normalize.ts` putting `parentToolCallId` on a sub-agent's
   `tool_call` (029); without it the D-040 check has nothing to see.
 * ⚑ **M5 is the burst itself** — the Claude runtime's `deliver` feeding the machine, without which
   the main agent's own out-of-turn work never reads `working` (123, D-040's paired positive).
 * ⚑ **M6–M7 are D-050's migration** — `0002_no_agent_limit` registered in the journal, and stamped
   above `0001` so drizzle does not skip it on a database already at `0001`.

## ⛔ What this table cannot reach

 * ⚠️ **"Parented events no longer retire a stopped turn's debt"** — the D-002 test drives an
   unparented `tool_result`; no test drives a sub-agent's frame while a debt stands.
 * ⚠️ **The Codex and fake-runtime call sites** (`codex-runtime.ts`, `fake-runtime.ts`) — Codex never
   delivers a child's work as content events, so no test drives a parented event through them, and
   a row there would only replant M5 on another adapter.
 * ⚠️ **The `parentToolCallId` stamps on a sub-agent's `assistant_message` and `tool_result`** (128,
   029) — the preferred killers drive only a parented `tool_use` through the adapter;
   `claude-normalize.test.ts` asserts the stamps, but as 029/128's attribution, not as D-040.
 * ⚠️ **The statements inside `0002_no_agent_limit.sql`** — no test reads
   `provider_model_setting`'s columns (`PRAGMA table_info`), so dropping one `DROP COLUMN` leaves an
   unread nullable column and every test green.
 * ⚠️ **The rest of D-050** (the window command, bridge member, `AgentModelLimit`, the limit half of
   `judgeAnAgentsChoice`, the two refusals) — removed code; a row would bring a limit back, which is
   not a defect anything could be asked to catch.
 * ⚠️ **9233fce9's other files** (`agent-state.ts` ×2, `capabilities.ts`' note, `session-machine.ts`)
   — comments and one note string only.
"""

WORK = "packages/runtime/src/internal/provider-work.ts"
CLAUDE = "packages/runtime/src/claude/claude-runtime.ts"
NORMALIZE = "packages/runtime/src/claude/normalize.ts"
JOURNAL = "apps/desktop/src/main/db/migrations/meta/_journal.json"

PROVIDER_WORK = "provider-work.test.ts"
RUNTIME = "claude-runtime.test.ts"
STAMP = "a-stamp-that-skips.test.ts"

MUTATIONS: list[tuple[str, list[tuple[str, str, str]]]] = [
    # ---- A · whose model — the check in isProviderWork (9233fce9) ------------------------------
    # PROVIDER_WORK · "⛔ a sub-agent's output is not the main agent working (D-040)" —
    # `isProviderWork({ type, parentToolCallId: 'toolu_agent' })` must be false, reads true.
    # (RUNTIME's "a background sub-agent's own tool call opens no burst…" also kills: status 'working'.)
    (
        "M1 · a sub-agent's frames are read by type alone — the defect, verbatim: a background "
        "sub-agent's tool call opens a burst and the conversation reads working over a main agent "
        f"doing nothing · killed by `{PROVIDER_WORK}`",
        [(WORK,
          "  return !('parentToolCallId' in event) || event.parentToolCallId === undefined\n",
          "  return true\n")],
    ),
    # PROVIDER_WORK · same test, its third expectation: `{ type, parentToolCallId: undefined }`
    # ("… with an explicit undefined parent") must be true, reads false.
    (
        "M2 · an event whose parent field is present but undefined is taken for a sub-agent's — the "
        "main agent's own output, spread with an empty parent, no longer makes its conversation "
        f"working · killed by `{PROVIDER_WORK}`",
        [(WORK,
          "  return !('parentToolCallId' in event) || event.parentToolCallId === undefined\n",
          "  return !('parentToolCallId' in event)\n")],
    ),
    # PROVIDER_WORK · same test, loop over 'tool_result' and 'assistant_message': a parented one
    # must be false, reads true.
    (
        "M3 · only a sub-agent's tool CALL is refused — its tool results and its words still open a "
        f"burst on its conversation · killed by `{PROVIDER_WORK}`",
        [(WORK,
          "  return !('parentToolCallId' in event) || event.parentToolCallId === undefined\n",
          "  return event.type !== 'tool_call' || !('parentToolCallId' in event) || "
          "event.parentToolCallId === undefined\n")],
    ),
    # ---- B · the Claude runtime's side of it ----------------------------------------------------
    # RUNTIME · "a burst the provider starts by itself (123)" › "a background sub-agent's own tool
    # call opens no burst, the main agent's still does (D-040)" — the frame carries
    # `parent_tool_use_id: 'toolu_agent'`; with the stamp gone the `tool_call` has no parent and
    # `expect(handle.status(), "a sub-agent's tool call made the conversation work").toBe('idle')`
    # reads 'working'.
    (
        "M4 · a sub-agent's tool call loses its parent on the way in — the D-040 check sees the main "
        f"agent's call and the conversation reads working · killed by `{RUNTIME}`",
        [(NORMALIZE,
          "              ...(memoryPath === null ? {} : { memoryPath }),\n"
          "              ...(parent ? { parentToolCallId: parent } : {}),\n",
          "              ...(memoryPath === null ? {} : { memoryPath }),\n")],
    ),
    # RUNTIME · "a burst the provider starts by itself (123)" › "reads as working, and interrupt()
    # ends it without inventing a turn" — `expect(handle.status()).toBe('working')` reads 'idle';
    # the D-040 test's paired positive (`waitFor(... toBe('working'))`) times out as well.
    (
        "M5 · the Claude runtime never tells the machine its provider produced content — the main "
        "agent's own work outside a turn (a backgrounded command waking it, a notification turn) "
        f"reads idle · killed by `{RUNTIME}`",
        [(CLAUDE,
          "    if (isProviderWork(event)) this.machine.noteProviderWork(event.type)\n",
          "")],
    ),
    # ---- C · D-050's migration, 0002_no_agent_limit (c7a1878c) ----------------------------------
    # STAMP · "§3 · the disk and the journal describe the same tree" › "🔴 every stamp in the
    # committed journal is strictly above the one before it" — `skippable(stamps)` returns
    # [1790830976669], expected [].
    (
        "M6 · 0002_no_agent_limit is stamped at 0001's moment — drizzle skips it on every database "
        "already at 0001, and the agents' limit columns are never dropped there · "
        f"killed by `{STAMP}`",
        [(JOURNAL,
          '      "when": 1790868253982,\n',
          '      "when": 1790830976669,\n')],
    ),
    # STAMP · §3 › "🔴 every migration on disk is in the journal, and every entry in the journal is
    # on disk" — `disagreements` names "on disk and not in the journal: 0002_no_agent_limit" (and the
    # renumbered entries). (`a-reply-keeps-the-files-it-was-handed-exactly-as-they-were.test.ts`'s
    # `__drizzle_migrations` count of 7 also kills.)
    (
        "M7 · 0002_no_agent_limit is on disk but not in the journal — the migrator never runs it, and "
        f"every database keeps the agents' limit columns · killed by `{STAMP}`",
        [(JOURNAL,
          "    {\n"
          '      "idx": 2,\n'
          '      "version": "6",\n'
          '      "when": 1790868253982,\n'
          '      "tag": "0002_no_agent_limit",\n'
          '      "breakpoints": true\n'
          "    },\n",
          "")],
    ),
]
