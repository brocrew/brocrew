"""1002 · D-002 · a stopped call's receipt no longer lets the stopped turn close the next one (`1aca84b5`).

⚑ **Why `1002`** (T-002): a table id must be a positive integer (`runner_contract.TABLE_ID`), and
the work model's cards have none, so card D-00N's table is `100N`.

1002 · D-002 — a stopped call's receipt no longer lets the stopped turn close the next one
(`1aca84b5`, 738 P-2, `smoke:claude` 3.4 red in both batches). On Claude, Stop while a command runs
and then send (or a Stop that flushes a queued message): the CLI delivers the stopped call's own
`tool_result` (`is_error`) after the replacement turn opened, then the stopped turn's `result`.
Before the fix the receipt counted as the replacement's first content, so it retired the debt
(`absorbsForeignTerminal`). The stopped turn's `result` then closed the replacement, and its reply
streamed outside any turn. The fix: `SessionMachine.noteProviderWork(kind)` returns early on a
`tool_result` while the held turn still owes the debt, and the adapters (Claude, Codex, Fake) pass
`event.type`. The boundary it drew is that only `tool_result` counts as a receipt. The model's own
output (`tool_call`, text) still retires the debt, so a debt the provider never pays still cannot
eat the replacement's own ending. Rows: M1 is the defect put back in the machine. M2 is the Claude
adapter half. M3 and M4 are the two sides of the only-`tool_result` boundary. Codex and Fake are not
rowed because both are equivalent on reachable states (see below). One finding: the part of
D-002's machine test that says "the replacement's own reply still retires the debt" measures
nothing. Only a 123 desktop test catches M4.

## ⚠️ What has no row here, and why

1) Codex adapter drops `event.type` (codex-runtime.ts:3289, anchor count 1). This is an equivalent
   mutant on every reachable state. Codex never holds a debt on a turn. `interrupt()` outside a turn
   calls `forceEnd(false)`, which leaves no debt. With a `currentTurn`, it sends `turn/interrupt`
   and never calls `forceEnd`. `forceEnd()` with a debt runs only in `doClose`, after `beginClose`,
   when no turn can open again. Out-of-turn content is dropped at `onNotification` (037,
   `reportsBurst` false in conformance), so `unbidden` never latches. `absorbsForeignTerminal` is
   therefore always false on Codex and `kind` is never read. A row would stay green forever and
   teach nothing. 2) Fake adapter drops `event.type` (fake-runtime.ts:382, count 1). Also
   equivalent. The Fake can hold a debt (simulateThinking burst → Stop → `forceEnd(true)` → send),
   but `driveTurn` always pushes `assistant_delta`/`assistant_message` first, which retires it, and
   the Fake's only `tool_result` pushes follow its own `tool_call`. No `simulate*` injects a bare
   `tool_result`. 3) Dropping the `&& this.turn.absorbsForeignTerminal` conjunct. Equivalent: with
   no debt, the fall-through only writes false over false. 4) Removing the kind test entirely, so
   every content kind counts as a receipt while the debt stands. This is the union of M3 and M4,
   killed more bluntly by 123's untyped machine tests. The two sharper rows were chosen because each
   has its own single killer. 5) Hoisting the guard above `if (this.turn)`, so a `tool_result` never
   opens an unbidden burst (the same as dropping it from PROVIDER_WORK for noteProviderWork, while
   dodging provider-work.test.ts's five-member census). D-002 deliberately left the out-of-turn
   branch alone. A burst whose first provider-work frame is a `tool_result` has not been measured
   (probe:out-of-turn opened with thinking), so this would probably survive over an unmeasured
   shape. Recorded here, not rowed. 6) The `idle-is-not-true.smoke.ts` replica line. It is not in
   vitest, and `smoke:claude` 3.4 is a live step. 7) The doc-comment edits on
   `absorbsForeignTerminal` and `noteProviderWork`. Comment-only, so they would be no-ops. 8) The
   'Stop that flushes a queued message' reach. It reaches the machine through the same `send` →
   `beginTurn` path as Stop-and-send, with no separate source line to mutate.

## Verification

T-002 designed these rows read-only and verified each one alone with `verify_row.py`: applied,
its own killer files run, restored from bytes. The table has not been run.
- RED alone, each on its own killer: M1 on `session-machine.test.ts` and `claude-runtime.test.ts`,
  M2 on `claude-runtime.test.ts`, M3 on `session-machine.test.ts`, M4 on `out-of-turn-work.test.ts`.
"""

MACHINE = 'packages/runtime/src/internal/session-machine.ts'
CLAUDE = 'packages/runtime/src/claude/claude-runtime.ts'

MUTATIONS: list[tuple[str, list[tuple[str, str, str]]]] = [
    (
        "M1 · 🔴 **THE DEFECT, restored: the stopped call's own receipt retires the replacement's debt** (`main` before `1aca84b5`). The stopped turn's `result` then closes the new turn, and its reply streams outside any turn. killed by `session-machine.test.ts` and `claude-runtime.test.ts` (D-002)",
        [
            (MACHINE, "      if (kind === 'tool_result' && this.turn.absorbsForeignTerminal) return\n", "      if (false && kind === 'tool_result' && this.turn.absorbsForeignTerminal) return\n"),
        ],
    ),
    (
        "M2 · 🔴 **the Claude adapter no longer says WHAT proved the work.** `noteProviderWork()` is called untyped, so the machine's guard never fires on the one provider that produces the order. killed by `claude-runtime.test.ts` alone (D-002)",
        [
            (CLAUDE, '    if (isProviderWork(event)) this.machine.noteProviderWork(event.type)\n', '    if (isProviderWork(event)) this.machine.noteProviderWork()\n'),
        ],
    ),
    (
        "M3 · ⛔ **the replacement's own `tool_call` read as the stopped work's too.** A debt the provider never pays then eats the ending of a turn that opens with a tool. killed by `session-machine.test.ts`'s paired positive (D-002's boundary)",
        [
            (MACHINE, "      if (kind === 'tool_result' && this.turn.absorbsForeignTerminal) return\n", "      if ((kind === 'tool_result' || kind === 'tool_call') && this.turn.absorbsForeignTerminal) return\n"),
        ],
    ),
    (
        "M4 · ⚠️ **the replacement's own reply read as the stopped turn's tail.** A text-first turn whose predecessor never pays keeps the debt, and its own `result` is eaten. killed by `out-of-turn-work.test.ts` (123), NOT by D-002's own lane",
        [
            (MACHINE, "      if (kind === 'tool_result' && this.turn.absorbsForeignTerminal) return\n", "      if ((kind === 'tool_result' || kind === 'assistant_delta' || kind === 'assistant_message') && this.turn.absorbsForeignTerminal) return\n"),
        ],
    ),
]
