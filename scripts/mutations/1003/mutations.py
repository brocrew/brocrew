"""1003 · D-003 · a running workflow the level still lists is not marked "did not finish" at a turn end (`caae8300`).

⚑ **Why `1003`** (T-002): a table id must be a positive integer (`runner_contract.TABLE_ID`), and
the work model's cards have none, so card D-00N's table is `100N`.

1003 · D-003 (`caae8300`) · P-3: a running workflow read "did not finish" at every turn end, with
its agents not live, while the background bar listed it running, for 0.5 to 10 s until the next
progress frame revived it (`smoke:ui` 57). The fix has two halves in
apps/desktop/src/renderer/src/lib/transcript.ts. (1) `stopOpenToolCalls` takes the same optional
`sparing` set that `stopRunningSubAgents` has taken since 695, and its workflow loop skips a running
run whose `taskId` is in that set. (2) `case 'turn'` builds `stillListed` from
`state.background.running` ids once and passes it to both sweeps. The card draws two boundaries.
First, a TURN spares only a run the level lists, by the run's own task_id (measured on the 738
ledger as `wdrzvugu5`). Second, the three session boundaries (`markReopened`, `markReadOnly`,
`markTerminal`) pass nothing and still mark every run. The killer tests are the three `D-003 …`
tests in apps/desktop/test/workflow-tree.test.ts. Only the reopen boundary has one of them, so the
close and read-only boundaries had no test; see Verification.

## ⚠️ What has no row here, and why

(a) A spared run that keeps `running` but is still stamped `unfinished`. WorkflowEntry.vue checks
    `running` first and the facet functions never read `unfinished`, so a person sees nothing
    different. The main test's `not.toHaveProperty('unfinished')` would kill it anyway, so it would
    only measure a state field.

(b) Emptying or rekeying the shared `stillListed` const, for example `.map((one) => one.toolCallId)`
    or an empty Set. That breaks both sweeps at once, which is M2 plus 695 M8 (already re-anchored
    by T-001 in 6930168e), so it adds no independent evidence.

(c) The revival arm in `case 'workflow_run'`, where a non-terminal frame clears `unfinished`. D-003
    only edited its comment, and 108's 'a frame arriving after we stopped watching REVIVES the run'
    and 'an ending clears a stale mark' already guard it.

(d) The `interrupted` turn arm. The card drew no boundary there: sparing applies to all three turn
    endings, as 695 ruled for sub-agents, because a background task outlives a Stop.

(e) A reopen-only mutation inside `markReopened`'s body. It would add `Set`/`map` calls to
    what-a-reopen-costs.test.ts's census and die for the wrong reason, so M5 moves the same defect
    into a parameter default.

(f) The tool-row loop. The Workflow call's own row is still marked `unfinished` at a turn end if it
    has no result. D-003 did not touch it, and in production the Workflow call returns at once.

(g) `smoke:ui` 57. It is live, not in vitest, and nothing a row can reach.

## Verification

T-002 designed these rows read-only and verified each one alone with `verify_row.py`: applied,
its own killer files run, restored from bytes. The table has not been run.
- RED alone: M1–M5 on `workflow-tree.test.ts`.
- ⚠️ **M6 and M7 SURVIVED D-003's own tests**: only the reopen boundary had one. T-002 added the
  session close and the read-only recording to `workflow-tree.test.ts`, and both are RED on it now.
"""

FOLD = 'apps/desktop/src/renderer/src/lib/transcript.ts'

MUTATIONS: list[tuple[str, list[tuple[str, str, str]]]] = [
    (
        'M1 · 🔴 **THE DEFECT, restored: the run sweep spares nothing** (`main` before `caae8300`). A turn end draws *did not finish*, with the agents not live, over a run the bar lists as running. killed by `workflow-tree.test.ts`',
        [
            (FOLD, '    if (sparing?.has(run.taskId) === true) continue\n', ''),
        ],
    ),
    (
        'M2 · 🔴 **the turn gives the run sweep no level**. The sub-agent sweep is still spared (695) but the workflow is marked at every turn end. killed by `workflow-tree.test.ts`',
        [
            (FOLD, '      stopOpenToolCalls(state, stillListed)\n', '      stopOpenToolCalls(state)\n'),
        ],
    ),
    (
        'M3 · ⛔ **a turn end spares EVERY run, listed or not**. A workflow the level does not list reads running forever after its turn. killed by the paired positive in `workflow-tree.test.ts` · killed by `workflow-tree.test.ts`',
        [
            (FOLD, '    if (sparing?.has(run.taskId) === true) continue\n', '    if (sparing !== undefined) continue\n'),
        ],
    ),
    (
        'M4 · ⚠️ **the run is looked up by its launching call, not its own task_id**. It is never found in the level, so it is marked as before. killed by `workflow-tree.test.ts`',
        [
            (FOLD, '    if (sparing?.has(run.taskId) === true) continue\n', "    if (sparing?.has(run.toolUseId ?? '') === true) continue\n"),
        ],
    ),
    (
        'M5 · ⛔ **the session boundaries spare what the level lists** (a default on the parameter). A reopened conversation keeps a dead run running. killed by the reopen control in `workflow-tree.test.ts` · killed by `workflow-tree.test.ts`',
        [
            (FOLD, 'function stopOpenToolCalls(state: TranscriptState, sparing?: ReadonlySet<string>): void {\n', 'function stopOpenToolCalls(state: TranscriptState, sparing: ReadonlySet<string> = new Set(state.background.running.map((one) => one.id))): void {\n'),
        ],
    ),
    (
        'M6 · ⛔ **a session CLOSE spares what the level lists**. A workflow reads running forever in a closed conversation. `markTerminal` alone · killed by `workflow-tree.test.ts` (the test T-002 added)',
        [
            (FOLD, '  // send one.\n  stopOpenToolCalls(state)\n', '  // send one.\n  stopOpenToolCalls(state, new Set(state.background.running.map((one) => one.id)))\n'),
        ],
    ),
    (
        'M7 · ⛔ **a READ-ONLY recording spares what the level lists**. A recording draws a workflow running forever. `markReadOnly` alone · killed by `workflow-tree.test.ts` (the test T-002 added)',
        [
            (FOLD, '  stopRunningSubAgents(state)\n  stopOpenToolCalls(state)\n', '  stopRunningSubAgents(state)\n  stopOpenToolCalls(state, new Set(state.background.running.map((one) => one.id)))\n'),
        ],
    ),
]
