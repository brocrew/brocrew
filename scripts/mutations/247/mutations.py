#!/usr/bin/env python3
"""247's mutation table — each row is THE DEFECT, put back verbatim (131).

247 is one subsystem with two halves and a measurement in front of both.

`245` found BroBot showing a green, settled Bash card and an idle turn for **24.562 seconds while
the command was still running**, and called it the rank-1 adoption blocker. But it produced that
state by calling the SDK's `backgroundTasks(id)` from a harness, and BroBot calls that method in
**0 files** — so the audit proved the RENDERING wrong and left open whether a model can reach the
state unaided. `235` is the precedent: it found `230` M3 to be *"a live mechanism with no live
input"*, real and shipped and unreachable, and that changed what the fix was for.

⛔ **§1 measured that a model reaches it unaided, and the answer is not marginal.** Four live turns,
app-shaped launch, app-owned home (`smoke/background-reach-probe.smoke.ts`): Haiku and Sonnet both
emitted `"run_in_background": true` in the `Bash` input off a one-sentence request, on every run —
and on 2 of 4 runs Haiku did so on a turn that never asked, which is reported as a finding rather
than a rule. False-settled windows on the committed artefact, measured against the OS rather than
against the provider: **26 630 ms** and **28 198 ms**; the control — a one-second command — **none**.

⚠️ **The field the dispatch named is the one that does NOT fire on that path.** `is_backgrounded`
appeared in none of the four captures: it is the CONVERSION signal, sent when something already
running is detached, which is the path `245`'s harness took and production could not. When a model
asks up front, the task is born background and the live discriminator is membership of the
`background_tasks_changed` level set — measured, because the control row produced `task_started` and
`task_notification` and **no level payload at all**. Carrying `is_backgrounded` anyway is not
speculative: 247 exposes the control, so it creates its own live input.

The row groups:

 * `M1`-`M4`   🔴 **the truthful receipt** — the flag, the id, and the two ways the registry can
                answer the question wrongly (stale-live, and a foreground call marked as detached).
 * `M5`-`M9`   ⛔ **the level** — not published, merged instead of replaced, never enriched with its
                binding, and a malformed payload read as "nothing is running".
 * `M10`-`M12` ⚠️ **the endings** — the poorer bookend silencing the richer one, `paused` read as
                finished, and an unrecognised status read as a failure.
 * `M13`-`M14` ⛔ **the reset**, which exists because the ledger is REPLAYED: an app killed while a
                command was live would otherwise resurrect a phantom row on reopen.
 * `M15`-`M16` ⚑ **Codex** — the `processId` `245` found being discarded, and the same field read off
                items that have no process.
 * `M17`-`M18` ⛔ **the controls**, which `245` listed as ABSENT · 1 and found called in 0 files.
 * `M19`       🔴 **the classification** — `background_work` counted as the provider working, which
                would move `245`'s lie one surface over instead of ending it.
 * `M20`-`M22` ⚑ **the bounds, and all three rows came out of the adversarial pass over this diff** —
                a one-character schema cap that would have deleted the very rows it was meant to
                bound, a cap that was silent about half of what it dropped, and a ceiling enforced at
                one of the two doors into the same map.

## ⛔ What this table cannot reach, stated because a table silent about its edges is claiming them

 * ⚠️ **No row touches `apps/desktop`, and two arms there are unguarded by this table.** 247 adds a
   `RuntimeEvent` variant, so `describe-event.ts` and `transcript.ts` had to grow a case each or the
   tree does not compile. Those are ui-dev's files and the arms are stubs: `transcript.ts` creates no
   item on purpose (the card is `248`'s), so a mutation removing its body would change nothing an
   assertion could see. ⛔ Naming it rather than shipping a row that cannot die.
 * ⛔ **No row proves the LIVE reachability §1 rests on.** That claim is a live capture against the
   real provider, and no mutation of this tree can make a model stop reaching for a tool argument.
   `probe:background-reach` is its instrument and asserts the verdict itself; if a future pin changes
   the answer, that probe goes red and this table stays green — which is the correct division, and it
   means the table is NOT evidence for §1.
 * ⚠️ **No row makes `everBackground` unbounded-growth visible.** It never forgets a task id, on
   purpose, so both endings can speak; nothing in a unit run can observe the memory a session-long
   set costs. `SubAgentTasks` has the same shape and the same silence.
 * ⛔ **No row removes the `unknown{lifecycle}` frame that still accompanies the level.** `245` ruled
   that classification deliberate and 247 §3 forbids changing it, so the row would be mutating a
   ruling rather than this dispatch's code — but the pairing IS asserted, in
   `background-work.test.ts` *"publishes the set as a first-class fact AND leaves the frame
   classified lifecycle"*.
 * ⚑ **Nothing retired.** Run `census.py` before believing that in either direction — 238's lesson 4
   and 240's counterpart to it.

## ⚑ The killing test for every row, named before the table was run, and CHECKED after

⚠️ Every entry was verified by applying the row and watching the named test go red — 238's lesson,
where two rows stayed green beside prose saying they must die.

 * `M1`  → `background-work.test.ts` *"marks the tool result as backgrounded, with the id that will
           stop it"*.
 * `M2`  → the same test — the id half of it.
 * `M3`  → *"stops marking it once the work has ended"*.
 * `M4`  → *"and does NOT mark an ordinary foreground result — the control, from the same capture"*.
 * `M5`  → *"publishes the set as a first-class fact AND leaves the frame classified lifecycle"*.
 * `M6`  → *"REPLACES rather than merges — the SDK's own word, and the anti-wedge"*.
 * `M7`  → *"re-emits the level once the binding arrives, so a row can point at its card"*.
 * `M8`  → *"a `task_started` for FOREGROUND work says nothing about background work"*.
 * `M9`  → *"a malformed payload is not an empty set"*.
 * `M10` → *"and the POORER ending arriving first does not silence the richer one"*.
 * `M11` → *"`paused` is not an ending — paused work still exists and still needs a stop control"*.
 * `M12` → *"a status word we do not recognise is `unknown`, never a failure"*.
 * `M13` → *"`system/init` clears the level and SAYS so, because the ledger is replayed"* — the
           emitted half.
 * `M14` → the same test's second assertion — the reset half.
 * `M15` → *"on the call and on the result — the join key `backgroundTerminals/terminate` takes"*.
 * `M16` → *"a command with no PTY carries nothing, and neither does a tool that has no process"*.
 * `M17` → `claude-runtime.test.ts` *"passes the tool-use id straight through, and returns the
           provider's own answer"*.
 * `M18` → `claude-runtime.test.ts` *"a CLOSED session detaches nothing and stops nothing"*.
 * `M19` → `provider-work.test.ts` *"excludes `activity`, and 099 is the reason with a number on it"*
           and its count guard.
 * `M20` → *"a long description survives the wire"* and *"…and so does a long ending summary"*.
 * `M21` → *"a cap is never silent — and an entry with NO id is counted, not skipped"*.
 * `M22` → *"the ceiling holds against the CONVERSION door too, or the whole frame degrades"*.
"""

from pathlib import Path

NORM = "packages/runtime/src/claude/normalize.ts"
TASKS = "packages/runtime/src/claude/background-tasks.ts"
WORK = "packages/runtime/src/background-work.ts"
CODEX = "packages/runtime/src/codex/normalize.ts"
RUNTIME = "packages/runtime/src/claude/claude-runtime.ts"
PWORK = "packages/runtime/src/internal/provider-work.ts"

# (name, [(file, old, new), ...])
MUTATIONS = [
    # ---- the truthful receipt ---------------------------------------------------------------------
    (
        "M1 · 🔴 THE DEFECT, verbatim · the receipt stops saying it is a DETACHMENT, so the Bash card "
        "settles green at 6 102 ms for a command that runs to 36 150 ms — 245's whole finding, back",
        [
            (
                NORM,
                "              ...(detachedAs ? { backgrounded: true, backgroundId: detachedAs } : {}),",
                "",
            )
        ],
    ),
    (
        "M2 · ⛔ …and the id that would stop it goes with it · 248 gets a card it can mark but not "
        "act on, which is the half of the rank-1 gap that is a CONTROL rather than a label",
        [
            (
                NORM,
                "...(detachedAs ? { backgrounded: true, backgroundId: detachedAs } : {}),",
                "...(detachedAs ? { backgrounded: true } : {}),",
            )
        ],
    ),
    (
        "M3 · 🔴 the registry answers from what it EVER saw instead of what is live · a card whose "
        "work finished half an hour ago still reads 'still running', which is the stale indicator "
        "222 cost a dispatch and the SDK's own doc warns about by name",
        [
            (
                TASKS,
                "    return taskId !== undefined && this.live.has(taskId) ? taskId : undefined",
                "    return taskId !== undefined && this.everBackground.has(taskId) ? taskId : undefined",
            )
        ],
    ),
    (
        "M4 · ⛔ …and the mirror of it: any task with a binding is called backgrounded · 8 of the 12 "
        "task_started records on this machine are foreground `local_bash`, so every ordinary shell "
        "call would claim live work",
        [
            (
                TASKS,
                "    const taskId = this.taskOf.get(toolUseId)\n"
                "    return taskId !== undefined && this.live.has(taskId) ? taskId : undefined",
                "    return this.taskOf.get(toolUseId)",
            )
        ],
    ),
    # ---- the level --------------------------------------------------------------------------------
    (
        "M5 · ⛔ the level is never published · the frame stays classified `lifecycle` exactly as 245 "
        "ruled, and the registry it was supposed to feed has nothing to read — the pre-247 state",
        [
            (
                NORM,
                "    background.replace(named)",
                "    background.replace(named)\n    return []",
            )
        ],
    ),
    (
        "M6 · 🔴 the set MERGES instead of replacing · one missed empty payload and a finished task "
        "never leaves the registry — the exact failure `background_tasks_changed`'s doc tells "
        "consumers to replace their set to avoid",
        [
            (
                TASKS,
                "    this.live = new Map(\n"
                "      tasks.slice(0, MAX_BACKGROUND_WORK).map((task) => [\n"
                "        task.id,\n"
                "        {\n"
                "          ...(task.kind ? { kind: task.kind } : {}),\n"
                "          ...(task.description ? { description: task.description } : {}),\n"
                "        },\n"
                "      ]),\n"
                "    )\n"
                "    for (const task of tasks) this.everBackground.add(task.id)",
                "    for (const task of tasks) {\n"
                "      this.live.set(task.id, {\n"
                "        ...(task.kind ? { kind: task.kind } : {}),\n"
                "        ...(task.description ? { description: task.description } : {}),\n"
                "      })\n"
                "      this.everBackground.add(task.id)\n"
                "    }",
            )
        ],
    ),
    (
        "M7 · ⛔ the level is never re-emitted once the binding arrives · every registry row keeps ids "
        "only, so nothing on screen can point at the card whose work it is",
        [
            (
                NORM,
                "    if (!background.has(taskId)) return []\n    return [{ type: 'background_work', running: background.snapshot(), source: subtype }]",
                "    return []",
            )
        ],
    ),
    (
        "M8 · ⚑ …and the opposite: EVERY task_started re-emits the level · a foreground shell call "
        "publishes a registry frame, which is 035's honesty bug arriving through a new door",
        [(NORM, "    if (!background.has(taskId)) return []", "")],
    ),
    (
        "M9 · ⛔ a payload we cannot read is treated as an empty set · the one fact that CLEARS a "
        "registry gets invented from the traffic we understood least",
        [(NORM, "    if (!Array.isArray(raw)) return []", "    if (!Array.isArray(raw)) return [{ type: 'background_work', running: [], source: subtype }]")],
    ),
    # ---- the endings ------------------------------------------------------------------------------
    (
        "M10 · 🔴 the ending asks the LIVE set instead of what was ever background · measured, "
        "task_updated and task_notification arrive in the same millisecond and the first empties the "
        "set — so the poorer bookend, which carries neither tool_use_id nor summary, silences the "
        "richer one on every real completion",
        [
            (
                NORM,
                "    if (!background.wasBackground(taskId)) return []\n    background.finish(taskId)",
                "    if (!background.has(taskId)) return []\n    background.finish(taskId)",
            )
        ],
    ),
    (
        "M11 · ⚠️ `paused` becomes an ending · paused work still exists and still has a stop control, "
        "and a registry that drops it tells the user it finished",
        [
            (
                TASKS,
                "const TERMINAL_STATUS = new Set(['completed', 'failed', 'killed'])",
                "const TERMINAL_STATUS = new Set(['completed', 'failed', 'killed', 'paused'])",
            )
        ],
    ),
    (
        "M12 · ⚠️ a status word we do not recognise is reported as a FAILURE · 074's rule and 240's "
        "reversed — a confident wrong answer where an honest absence belongs",
        [(WORK, "  return 'unknown'\n}", "  return 'failed'\n}")],
    ),
    # ---- the reset --------------------------------------------------------------------------------
    (
        "M13 · ⛔ the reset is held but never SAID · every event is written to the ledger and replayed "
        "on reopen, so an app killed while a command was live resurrects a row for work that died "
        "with the process — a phantom nothing ever clears",
        [
            (
                NORM,
                "        return [{ type: 'background_work', running: [], source: message.subtype }]",
                "        return []",
            )
        ],
    ),
    (
        "M14 · ⛔ …and the level is not reset at all · the SDK says the set is per-process and that "
        "nothing is emitted at startup, so a restarted CLI inherits the previous process's tasks",
        [(NORM, "        background.reset()", "")],
    ),
    # ---- Codex ------------------------------------------------------------------------------------
    (
        "M15 · ⛔ Codex's `processId` is discarded again · the string 245 §1.4 named — the very key "
        "`thread/backgroundTerminals/terminate` takes — dies at the normalizer, so a later dispatch "
        "has no binding between a card and the terminal registry",
        [(CODEX, "  const backgroundId = commandProcessId(type, item)", "  const backgroundId = ''")],
    ),
    (
        "M16 · ⚠️ …and the opposite: the field is read off EVERY item type · an mcpToolCall or a "
        "webSearch is handed an id nothing can act on",
        [
            (
                CODEX,
                "  return type === 'commandExecution' ? readString(item, 'processId') : ''",
                "  return readString(item, 'processId')",
            )
        ],
    ),
    # ---- the controls -----------------------------------------------------------------------------
    (
        "M17 · 🔴 the detach ignores which tool call it was given · Ctrl+B for everything, when the "
        "user pointed at one card — the SDK distinguishes the two by the presence of the argument",
        [
            (
                RUNTIME,
                "    return await this.query.backgroundTasks(toolCallId)",
                "    return await this.query.backgroundTasks()",
            )
        ],
    ),
    (
        "M18 · ⛔ a CLOSED session still reaches the provider · the guard 202/233 put on every other "
        "control, missing from the two new ones",
        [
            (
                RUNTIME,
                "    if (this.machine.isTerminal || !this.query?.backgroundTasks) return false",
                "    if (!this.query?.backgroundTasks) return false",
            )
        ],
    ),
    # ---- the classification -----------------------------------------------------------------------
    (
        "M19 · 🔴 background work counts as the provider WORKING · its defining case is arriving while "
        "the model does nothing (measured, 26.6 s after the turn completed), so this replaces a "
        "transcript that wrongly says 'finished' with a session that wrongly says 'busy' — the same "
        "lie moved one surface over, and this time with no ending that could clear it",
        [(PWORK, "  'tool_result',\n])", "  'tool_result',\n  'background_work',\n])")],
    ),
    # ---- the bounds -------------------------------------------------------------------------------
    (
        "M20 · 🔴 the text bound goes back to 200 · `truncate` keeps 200 characters AND APPENDS AN "
        "ELLIPSIS, so a 200-cap rejects exactly the strings that were bounded — and toWireEvent "
        "re-validates every event, so the registry row is degraded to `unknown` and lost for every "
        "task whose description is long, and only for those",
        [
            (
                WORK,
                "export const MAX_BACKGROUND_TEXT = 201",
                "export const MAX_BACKGROUND_TEXT = 200",
            )
        ],
    ),
    (
        "M21 · ⚑ `dropped` counts only what passed the ceiling · an entry the provider sent with no "
        "task_id — unusable, unlistable, unstoppable — vanishes with nothing to say so, which is a "
        "silent cap wearing a different hat",
        [
            (
                NORM,
                "    const dropped = raw.length - Math.min(named.length, MAX_BACKGROUND_WORK)",
                "    const dropped = named.length - Math.min(named.length, MAX_BACKGROUND_WORK)",
            )
        ],
    ),
    (
        "M22 · ⛔ the CONVERSION door stops respecting the ceiling · one task over the cap and the "
        "`running` array fails its own schema, so toWireEvent degrades the whole registry frame to "
        "`unknown` — a bound that loses the frame rather than the row",
        [(TASKS, "      this.live.size < MAX_BACKGROUND_WORK\n", "      true\n")],
    ),
]


def apply(root: Path, index: int, dry: bool) -> int:
    name, edits = MUTATIONS[index]
    bad = 0
    for rel, find, replace in edits:
        path = Path(root) / rel
        text = path.read_text()
        hits = text.count(find)
        if hits != 1:
            print(f"!! {name}: anchor found {hits} times in {rel} (expected exactly 1)")
            bad += 1
            continue
        if not dry:
            path.write_text(text.replace(find, replace))
    return bad


def main() -> int:
    import sys

    args = sys.argv[1:]
    if args[:1] == ["--count"]:
        print(len(MUTATIONS))
        return 0
    if args[:1] == ["--files"]:
        seen = []
        for _name, edits in MUTATIONS:
            for rel, _find, _replace in edits:
                if rel not in seen:
                    seen.append(rel)
        print(" ".join(seen))
        return 0
    if args[:1] == ["--name"]:
        print(MUTATIONS[int(args[1])][0])
        return 0
    if args[:1] == ["--dry-run"]:
        root = Path(args[1]).resolve()
        bad = 0
        for index in range(len(MUTATIONS)):
            bad += apply(root, index, dry=True)
        print(f"{len(MUTATIONS) - bad}/{len(MUTATIONS)} anchors found exactly once")
        return 1 if bad else 0
    root = Path(args[0]).resolve()
    return apply(root, int(args[1]), dry=False)


if __name__ == "__main__":
    raise SystemExit(main())
