#!/usr/bin/env python3
"""275's mutation table — each row is THE DEFECT, put back verbatim (131).

⛔ **The ticket, in `00-cli-gaps.md`'s own words:** *"Per-task stop shipped for Claude and not for
Codex. A person who backgrounds work on Codex can see it and cannot stop it."* ⚠️ **275 measured the
ticket to be understated in both halves.** They could not see it either — the registry was empty, no
row was drawn, and the pill read `idle` — and the reason a stop was missing is not that the surface
was unwired but that nothing on the Codex wire ever says a command is still running.

Everything this table protects rests on `smoke/codex-background-probe.smoke.ts`, four live threads
against the bundled `codex-cli 0.146.0`:

 * a plain *"run `sleep 402.93655`"* turn ends at **4 009 ms** with the process still running;
 * the row is in `thread/backgroundTerminals/list` at **t = 0 ms** and gone the moment it dies;
 * **no `item/completed` ever arrives** — the receipt never lands, so the edges cannot say it ended;
 * **no notification on the wire names background terminals** — 12–16 methods, none of them;
 * `terminate` answers `{terminated:true}` and `pgrep -f` goes `[81937]` → `[]`;
 * a second `terminate` on the same id answers `{terminated:false}` — an answer, not an error;
 * an unparseable `processId` is JSON-RPC **-32600**;
 * `turn/interrupt` ends the turn and leaves the command in the process table 20 s later;
 * the list's `processId` IS the card's `backgroundId`, and its `itemId` IS the card's own id.

The row groups:

 * `M1`-`M5`   🔴 **§1 · the stop** — that it exists at all, that it is not the control that already
                existed and cannot reach the process, that a refusal is not swallowed, that the level
                is re-read after it, and that an already-finished command is not raised as a failure.
 * `M6`-`M12`  ⛔ **§1/§2 · when the level is asked for** — the one edge, the turn it must be read
                at, the frame that must NOT buy a request, the poll that must exist, the poll that
                must not, single-flight, and the door 273 built on another channel.
 * `M13`-`M18` ⚠️ **the rows themselves** — the join, the id the Stop sends, the shortfall, the
                bound, the page bound, and a cap that stops saying so.
 * `M19`-`M22` ⚑ **the endings** — the two words, and the two ways `stopped` becomes a claim about a
                command nobody stopped.
 * `M23`-`M25` ⛔ **what reaches the stream** — the frame per turn, the frame that clears a resumed
                conversation, and the empty level asserted from a failed read.
 * `M26`-`M29` 🔴 **the instruments** — the live step's two app-shaped throws, the probe's OS reading,
                and the gap ledger that must stop claiming Codex cannot stop anything.
 * `M30`-`M31` ⚠️ **the resume** — the one frame that clears a level the LEDGER replayed, and the
                fresh start that must not ask for it.

## ⛔ Why `M6` is the row to read first

It is the ticket, restored by deleting one line. The `turn/completed` hook is what makes the level
exist; without it
`stopBackgroundWork` is present, correct, and unreachable — no registry row, so no Stop beside one.
`235`'s finding, which 275 §2 exists to have avoided: *a live mechanism with no live input.*

## ⛔ Why `M9` is the row to read second

`M9` turns the poll off. Every edge this app can see has already happened by the time a Codex command
finishes, so a level maintained from edges alone gains a row that can never leave — `222`'s wedged
stale indicator, which `247`'s REPLACE rule exists to make impossible, arrived at from the one
direction that rule does not cover.

## ⛔ This table is written against 264's harness contract and was NOT run

`275` §3: *"Mutation rows in `scripts/mutations/275/`. **Write, do not run.**"* `mutate.sh` is carried
forward from `273` unchanged, including `271`'s guard: if `require_healthy_baselines`,
`begin_mutation_control` or `require_healthy_control` are missing from the tree it refuses with a
sentence instead of dying on `command not found`. ⚑ **They are present here** — `275` branches off
`main` at `ad4e8c6`, which merged `mla/mutations`, so unlike `273` this table COULD be run at its own
HEAD. It was not, because the dispatch said not to.

## ⛔ What this table cannot reach, stated because a table silent about its edges is claiming them

 * ⚠️ **No row here is killed by the live smoke.** `M26`/`M27` mutate `scripts/ui-live-smoke.mjs`,
   which is not in any of the four vitest projects, so they die in `scripts` against
   `step-census.test.mjs`'s roster check — which proves the STEP is classified, not that it would
   catch the defect. What proves the second is the run recorded in 275's response: step 78, live,
   8 claims asserted, the OS going from 1 process to 0 on the press.
 * ⚠️ **No row proves what the app-server does.** That `terminate` kills the process, that
   `{terminated:false}` is not an error, that `interrupt` leaves the command alive — all of it is
   measurement (the probe), and nothing in this repository can assert it. The unit fixtures are
   copies of what the wire returned, which is the most a test can be.
 * ⚠️ **No row reaches the RENDERER.** The registry, the row and the Stop are `248`'s surfaces and
   were not touched; what 275 changed is what reaches them. `M13` is the closest — a row that cannot
   join its card — and it is killed by a unit assertion rather than by a rendered row.

## ⚑ Four anchors corrected in place by `287`

`280` reviewed this dispatch's code three commits old and found six defects in it; `287` fixed them,
and four of the fixes moved text this table points at. ⛔ **Corrected rather than retired** — the
DEFECT each row describes is unchanged and still reachable, so retiring them would drop coverage this
table paid for, which is `206`'s rule. Each site carries its own `⚑ ANCHOR CORRECTED IN PLACE BY 287`
note beside it:

 * `M1`/`M2` — `stopBackgroundWork` answers a **boolean** now and guards on `isShuttingDown`
   (287 finding 5: both silent no-ops were reported to the bar as a stop that had gone out).
 * `M6` — the level's one edge is guarded on `ours` (287 finding 2: a STALE `turn/completed` is not a
   turn boundary and must buy no request).
 * `M25` — `refresh`'s `catch` records the failure, because a failed read now RE-ARMS the poll
   (287 finding 3). ⚠️ Its replacement keeps that flag deliberately, so the row stays one defect.

⛔ **Nothing was re-run and nothing needed to be**: this table is `unrun` and has no `mutations.txt`,
so there is no recorded result that was measured against the older text.
"""

from pathlib import Path

TERMINALS = "packages/runtime/src/codex/background-terminals.ts"
RUNTIME = "packages/runtime/src/codex/codex-runtime.ts"
LEDGER = "packages/runtime/test/conformance.test.ts"
STEP = "scripts/ui-live-smoke.mjs"
PROBE = "packages/runtime/smoke/codex-background-probe.smoke.ts"

# ⚑ **ANCHOR CORRECTED IN PLACE BY 287** — see the docstring's own note. The method now answers a
# BOOLEAN (287 finding 5: a silent no-op was reported to the bar as a stop that went out) and guards
# on `isShuttingDown` rather than `machine.isTerminal` (the window is an ordinary conversation close).
# The row's defect is unchanged: delete the method and Codex has no stop at all.
STOP_METHOD = (
    "  async stopBackgroundWork(id: string): Promise<boolean> {\n"
    "    if (this.isShuttingDown) return false\n"
    "    return await this.backgroundTerminals.terminate(id)\n"
    "  }\n"
)

MUTATIONS = [
    # ── §1 · the stop ───────────────────────────────────────────────────────────────────────────
    (
        "M1 · 🔴 there is no stop · the method is gone, so `handle.stopBackgroundWork === undefined` "
        "again, `canStopBackgroundWork` is never published for Codex, and `BackgroundBar` draws no "
        "button — the ticket verbatim, and the state every Codex conversation was in before 275",
        [(RUNTIME, STOP_METHOD, "")],
    ),
    (
        "M2 · ⛔ the stop is the one that already existed · `turn/interrupt` instead of "
        "`thread/backgroundTerminals/terminate` — 275 measured it ending the turn and leaving the "
        "command in the process table 20 seconds later, which is exactly why this is a second verb",
        # ⚑ ANCHOR CORRECTED IN PLACE BY 287 — the call is `return await` now (finding 5's boolean).
        [
            (
                RUNTIME,
                "    return await this.backgroundTerminals.terminate(id)",
                "    await this.interrupt()\n    return true",
            )
        ],
    ),
    (
        "M3 · 🔴 a refusal the provider STATES is swallowed · the measured -32600 for an unparseable "
        "processId becomes a resolved promise, so the row keeps saying 'still running' over a "
        "request that never landed — 275 §1: 'a card that stays running after a failed stop is a "
        "worse lie than no button'",
        [
            (
                TERMINALS,
                "    const answer = await this.deps.request('thread/backgroundTerminals/terminate', {\n"
                "      threadId,\n"
                "      processId: id,\n"
                "    })",
                "    const answer = await this.deps\n"
                "      .request('thread/backgroundTerminals/terminate', { threadId, processId: id })\n"
                "      .catch(() => ({}))",
            )
        ],
    ),
    (
        "M4 · ⛔ the stop does not re-read the level · the request goes out and nothing looks again, "
        "so the row stands until the next turn ends — the app's opinion about a request it sent, "
        "in place of the process being gone",
        [
            (
                TERMINALS,
                "    if (isRecord(answer) && answer['terminated'] === true) this.confirmedStopped.add(id)\n"
                "    this.refresh()",
                "    if (isRecord(answer) && answer['terminated'] === true) this.confirmedStopped.add(id)",
            )
        ],
    ),
    (
        "M5 · ⚠️ `{terminated:false}` is raised as a failure · pressing Stop on a command that "
        "finished a second ago reads as a broken button, when the measured answer means only 'the "
        "id named nothing running' — the sentence Claude's silent no-op already says",
        [
            (
                TERMINALS,
                "    if (isRecord(answer) && answer['terminated'] === true) this.confirmedStopped.add(id)",
                "    if (!isRecord(answer) || answer['terminated'] !== true) {\n"
                "      throw new Error('the provider did not stop it')\n"
                "    }\n"
                "    this.confirmedStopped.add(id)",
            )
        ],
    ),
    # ── §2 · when the level is asked for ────────────────────────────────────────────────────────
    (
        "M6 · 🔴 THE TICKET · the one hook is gone, so the level is never read: no registry row, no "
        "Stop beside one, and a pill that says idle over a live process. The adapter half above is "
        "present, correct and unreachable — 235's finding, a live mechanism with no live input",
        # ⚑ ANCHOR CORRECTED IN PLACE BY 287 — the call is guarded on `ours` now (finding 2: a STALE
        # `turn/completed` is not a turn boundary and must buy no request). The defect is unchanged:
        # remove the line and the level is never read at all.
        [
            (
                RUNTIME,
                "      if (ours) this.backgroundTerminals.note(method)\n",
                "",
            )
        ],
    ),
    (
        "M7 · ⛔ the level is read one turn too early · `turn/started` instead of `turn/completed`, "
        "so the app looks BEFORE the command it is about to run exists and says idle over live work "
        "until some later turn ends — the 250 defect, displaced by exactly one turn",
        [
            (
                TERMINALS,
                "    if (method === 'turn/completed') this.refresh()",
                "    if (method === 'turn/started') this.refresh()",
            )
        ],
    ),
    (
        "M8 · ⚠️ a command STARTING buys a request · the regression this dispatch's own review "
        "found: Codex lists a command from t = 0 ms, so an ordinary foreground `git status` enters "
        "the level, leaves it, and is published as an ENDING — which ToolEntry renders in place of "
        "the `done` its receipt had already earned",
        [
            (
                TERMINALS,
                "    if (method === 'turn/completed') this.refresh()",
                "    if (method === 'turn/completed' || method === 'item/started') this.refresh()",
            )
        ],
    ),
    (
        "M9 · ⛔ THE POLL IS OFF · every edge this app can see has already happened by the time a "
        "Codex command finishes — no `item/completed` ever arrives — so the row that appears can "
        "never leave. 222's wedged stale indicator, from the one direction 247's REPLACE rule does "
        "not cover",
        [(TERMINALS, "    this.watchWhile(running.length > 0)", "    this.watchWhile(false)")],
    ),
    (
        "M10 · ⚠️ the poll never stops · armed whether or not anything is running, so a conversation "
        "nobody has touched for an hour is still asking the app-server for a list it answers empty "
        "1 800 times — the same failure mode as M8, measured in hours instead of frames",
        [(TERMINALS, "    this.watchWhile(running.length > 0)", "    this.watchWhile(true)")],
    ),
    (
        "M11 · ⚑ the reads overlap · a turn running six quick commands raises twelve edges and "
        "twelve concurrent lists whose answers can land out of order, so the level published LAST "
        "is not the one asked for last",
        [
            (
                TERMINALS,
                "    if (this.inFlight !== null) {\n      this.pending = true\n      return\n    }\n",
                "",
            )
        ],
    ),
    (
        "M12 · ⛔ the watch outlives its session · nothing disarms it at teardown, so a list request "
        "goes into a transport being closed — 273's door, on the channel 275 opened, and the same "
        "handler exception a clean quit must never print",
        [
            (
                RUNTIME,
                "    this.backgroundTerminals.close()\n    if (!this.machine.beginClose()) {",
                "    if (!this.machine.beginClose()) {",
            )
        ],
    ),
    # ── the rows themselves ─────────────────────────────────────────────────────────────────────
    (
        "M13 · ⛔ the row cannot find its card · `itemId` is dropped, so `withCommand` has nothing to "
        "join and the row shows the provider's description instead of the command (251 §2) — and a "
        "`background_work.ended` has no `toolCallId`, so no card ever learns how its work ended",
        [
            (
                TERMINALS,
                "    ...(itemId !== '' && itemId.length <= MAX_BACKGROUND_ID ? { toolCallId: itemId } : {}),\n",
                "",
            )
        ],
    ),
    (
        "M14 · 🔴 the Stop sends the wrong string · `itemId` as the id instead of `processId`, so "
        "every press is answered with the measured -32600 ('invalid background terminal process id: "
        "invalid digit found in string') — a button that cannot work, on a row that says it can",
        [
            (
                TERMINALS,
                "  const id = readString(row, 'processId')",
                "  const id = readString(row, 'itemId')",
            )
        ],
    ),
    (
        "M15 · ⚠️ a row nobody can stop is silently skipped · the registry shows one fewer row and "
        "says nothing, which 247 §3 calls worse than no registry: a list that looks complete is "
        "read as complete",
        [(TERMINALS, "    if (item === undefined) skipped += 1", "    if (item === undefined) skipped += 0")],
    ),
    (
        "M16 · ⚠️ the command is unbounded · a provider string with no ceiling reaches "
        "`toWireEvent`, which re-validates it against `MAX_BACKGROUND_TEXT` and degrades the whole "
        "event to `unknown` — the row is lost, and the log says an adapter bug",
        [
            (
                TERMINALS,
                "  const command = truncate(readString(row, 'command').trim(), MAX_BACKGROUND_TEXT - 1)",
                "  const command = readString(row, 'command').trim()",
            )
        ],
    ),
    (
        "M17 · ⛔ the pagination trusts the provider · `while (cursor)` with no page bound, so an "
        "app-server that never ends its cursor keeps this session reading pages for as long as it "
        "answers — a loop a provider bug owns",
        [
            (
                TERMINALS,
                "    } while (\n"
                "      cursor !== undefined &&\n"
                "      pages < MAX_TERMINAL_PAGES &&\n"
                "      rows.length <= MAX_BACKGROUND_WORK\n"
                "    )",
                "    } while (cursor !== undefined)",
            )
        ],
    ),
    (
        "M18 · ⚠️ the cap goes silent · the page bound bites and nothing says so, so a registry "
        "showing eight pages' worth of a longer list reads as the whole of what is running "
        "(092's rule: a cap is never silent)",
        [
            (
                TERMINALS,
                "    if (cursor !== undefined && rows.length <= MAX_BACKGROUND_WORK) {\n"
                "      this.deps.emit({",
                "    if (false && cursor !== undefined && rows.length <= MAX_BACKGROUND_WORK) {\n"
                "      this.deps.emit({",
            )
        ],
    ),
    # ── the endings ─────────────────────────────────────────────────────────────────────────────
    (
        "M19 · ⛔ everything reads as `stopped` · a command that finished by itself is reported as "
        "one the person stopped — an outcome nobody observed, which is 074's rule exactly: an "
        "honest absence beats a confident wrong answer",
        [
            (
                TERMINALS,
                "      outcome: weStopped.has(row.id) ? 'stopped' : 'unknown',",
                "      outcome: 'stopped',",
            )
        ],
    ),
    (
        "M20 · ⚑ nothing ever reads as `stopped` · the press works, the process dies, and the card "
        "says 'ended, outcome not reported' — the one outcome this adapter CAN state, thrown away",
        [
            (
                TERMINALS,
                "      outcome: weStopped.has(row.id) ? 'stopped' : 'unknown',",
                "      outcome: 'unknown',",
            )
        ],
    ),
    (
        "M21 · ⚠️ a confirmed stop is never spent · the id stays in the set, so a LATER command "
        "the provider gives the same counter to is reported as stopped by memory rather than by "
        "anything that happened to it",
        [
            (
                TERMINALS,
                "      this.confirmedStopped.delete(ending.id)\n",
                "",
            )
        ],
    ),
    (
        "M22 · ⚠️ the answer is not read · every id we sent a terminate for is remembered as "
        "stopped, including the ones the provider answered `{terminated:false}` for — which means "
        "the work was already over and nobody stopped anything",
        [
            (
                TERMINALS,
                "    if (isRecord(answer) && answer['terminated'] === true) this.confirmedStopped.add(id)",
                "    void answer\n    this.confirmedStopped.add(id)",
            )
        ],
    ),
    # ── what reaches the stream ─────────────────────────────────────────────────────────────────
    (
        "M23 · ⛔ every read is published · one `background_work` frame per turn on every Codex "
        "conversation, for ever, saying exactly what the previous one said — into the wire, the "
        "renderer's fold and the durable ledger",
        [
            (
                TERMINALS,
                "    if (this.sameAsPublished(running, dropped) && gone.length === 0) return\n",
                "",
            )
        ],
    ),
    (
        "M24 · 🔴 the first level is withheld · `published` starts empty instead of unset, so the "
        "one frame that clears a resumed conversation never goes out — and a session reopened after "
        "a relaunch keeps showing rows for processes that died with the previous app-server",
        [
            (
                TERMINALS,
                "  private published: { ids: string; dropped: number } | null = null",
                "  private published: { ids: string; dropped: number } | null = { ids: '', dropped: 0 }",
            )
        ],
    ),
    (
        "M25 · ⛔ a failed read empties the registry · `running: []` asserted from an answer nobody "
        "gave, which is the stale indicator's mirror image: the rows vanish while the processes run "
        "on, and nothing says the question went unanswered",
        # ⚑ ANCHOR CORRECTED IN PLACE BY 287 — the `catch` records the failure now, because 287
        # finding 3 made a failed read RE-ARM the poll. ⚠️ The flag is deliberately kept in the
        # replacement: without it this row would carry a second defect (no retry) and stop being one
        # thing, which is 131's rule for what a row is.
        [
            (
                TERMINALS,
                "      .catch(() => {\n        failed = true\n      })",
                "      .catch(() => {\n"
                "        failed = true\n"
                "        this.deps.emit({\n"
                "          type: 'background_work',\n"
                "          running: [],\n"
                "          source: BACKGROUND_TERMINALS_SOURCE,\n"
                "        })\n"
                "      })",
            )
        ],
    ),
    # ── the instruments ─────────────────────────────────────────────────────────────────────────
    (
        "M26 · 🔴 step 78 stops asking the OS · the throw for 'the process is running and the app "
        "names none of it' is gone, so the live step goes green over the exact state 00-cli-gaps "
        "Rank-1 describes — the instrument passing over its own subject",
        [
            (
                STEP,
                "      if (aliveAtTurnEnd > 0 && !stampedAtTurnEnd && atTurnEnd.rows.length === 0) {\n"
                "        throw new Error(",
                "      if (false && aliveAtTurnEnd > 0 && !stampedAtTurnEnd && atTurnEnd.rows.length === 0) {\n"
                "        throw new Error(",
            )
        ],
    ),
    (
        "M27 · ⛔ step 78 accepts a stop nothing proves · the OS reading after the press is dropped, "
        "so a press that reached nothing reads as a stop — 233/240's whole distinction, deleted "
        "from the one step that exists to hold it",
        [
            (
                STEP,
                "      if (aliveAfter === null) {\n        throw new Error(",
                "      if (false && aliveAfter === null) {\n        throw new Error(",
            )
        ],
    ),
    (
        "M28 · ⚠️ the probe's OS reading always answers 'nothing' · every 'gone-from-the-OS' line "
        "reads true whatever is running, so the instrument that measured `terminate` killing a "
        "process would have said the same over one it never touched (240's rule, on the probe side)",
        [
            (
                PROBE,
                "    return execFileSync('pgrep', ['-f', pattern], { encoding: 'utf8' })",
                "    return String(pattern) && []",
            )
        ],
    ),
    (
        "M29 · ⛔ the gap ledger still says Codex cannot stop anything · a stale claim the next "
        "reader closes believing the provider could not — which is the exact sentence 233 wrote "
        "when `providerPid` left the same list, and 247 wrote when these two joined it",
        [
            (
                LEDGER,
                # Source-only re-anchor; the mutation verdict has not been re-verified.
                "      [\n        'codex',\n        [\n          'isRetiring',\n          'refreshManagedPlugins',\n          'builtInSkillsConfirmed',\n          'launchedAs',\n          'providerCommands',\n          'backgroundWork',\n          'account',\n        ],\n      ],\n",
                "      [\n        'codex',\n        [\n          'isRetiring',\n          'refreshManagedPlugins',\n          'builtInSkillsConfirmed',\n          'launchedAs',\n          'providerCommands',\n          'backgroundWork',\n          'stopBackgroundWork',\n          'account',\n        ],\n      ],\n",
            )
        ],
    ),
    (
        "M30 · 🔴 a resumed conversation keeps its dead rows · the one frame that clears a level the "
        "LEDGER replayed is gone, so reopening a Codex conversation after a relaunch shows rows for "
        "processes that died with the previous app-server, each with a Stop beside it",
        [(RUNTIME, "      handle.refreshBackgroundWork()\n", "")],
    ),
    (
        "M31 · ⚠️ every fresh start asks too · a guaranteed-empty request on every session this app "
        "opens — 275 §1's 'unnecessary request to a provider is a new failure mode', bought for an "
        "answer that is empty by construction on a thread with no ledger behind it",
        [
            (
                RUNTIME,
                "      await handle.begin('started', opts.model, opts.systemHint, bootSettled)",
                "      await handle.begin('started', opts.model, opts.systemHint, bootSettled)\n"
                "      handle.refreshBackgroundWork()",
            )
        ],
    ),
]


def apply(root: Path, index: int, dry: bool) -> int:
    name, edits = MUTATIONS[index]
    bad = 0
    for rel, find, replace in edits:
        path = root / rel
        text = path.read_text()
        hits = text.count(find)
        if hits != 1:
            print(f"!! {name}: anchor found {hits} times in {rel} (expected exactly 1)")
            bad += 1
            continue
        # ⛔ **A replacement equal to its original records as SURVIVED and proves nothing** — the
        # phantom survivor 252 found. Checked here rather than by eye, on every row, every run.
        if find == replace:
            print(f"!! {name}: the replacement is identical to the anchor — this row is a no-op")
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
