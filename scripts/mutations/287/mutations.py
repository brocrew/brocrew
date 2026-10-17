#!/usr/bin/env python3
"""287's mutation table — each row is THE DEFECT, put back verbatim (131).

⛔ **`280` reviewed `275` when it was three commits old and found six defects in it.** All six live in
the background-work subsystem and several cross the host/renderer line, which is why they were one
dispatch: *"splitting a Stop-button contract between two seats is how you get two half-fixes."*

## 🔴 The three HIGH

 * `§1` **Every ordinary Codex background command was marked *did not finish* while it ran.** The
   measured Codex stream is `tool_call` → `turn/completed` → `background_work.running` with **no
   `item/completed` and no `tool_result`, ever** — so the turn ends first, `stopOpenToolCalls` marks
   the result-less row `unfinished`, and the level updated `state.background` and nothing else. ⛔ The
   screen then said both: the bar **still running** with a working Stop, and the card **did not
   finish**, whose sentence is *"the conversation running it is gone, so nothing will ever report how
   it ended"*. ⚠️ Claude never takes this path — its `tool_result.backgrounded` seeds the card before
   the sweep — and every desktop test used that Claude receipt, so nothing exercised the stream `275`
   measured. **The test was as much the deliverable as the fix.**
 * `§2` **A stale completion for turn A could expose and STOP turn B's foreground command.**
   `onTurnCompleted` rejected the stale turn id correctly and the caller raised the level's one edge
   anyway. Codex lists every PTY from process start, including foreground ones, so B's live command
   entered the registry with a Stop beside it and left it as `ended: unknown` — which `ToolEntry`
   renders **above** a real successful result. ⚑ **This is the load-bearing half of `§1`**: with the
   level now reaching cards, a wrongly-listed foreground command would poison its card too.
 * `§3` **One transient list failure permanently disabled the only ending poll.** The timer cleared
   its own handle before the read, `refresh()` swallowed the rejection, and only a successful read
   re-armed. Codex emits no closing edge, so nothing else could ever take a row away: the registry,
   the pill, the rail row and the Stop went on claiming live work indefinitely after the process was
   dead — `222`'s stale indicator through a rejected request instead of a missed bookend.

## 🟠 The three MEDIUM

 * `§4` **A successful Stop poisoned that provider id for the life of the component.** The latch was
   cleared only on `false`, and a stop that succeeds never returns one — the row simply leaves. The
   next work born with that id was born disabled at **Stopping…**. ⚠️ Reuse is in this code's own
   model: `background-terminals.test.ts` brings a Codex `processId` back on purpose.
 * `§5` **Stop stayed offered while a conversation closed, and `true` was reported for a request that
   was never sent.** `record.phase = 'closing'` is set before the host is awaited and the gate ignored
   it; both adapters no-op silently once shutting down, and `RuntimeHost` answered `true` after every
   present method resolved. ⚑ The boolean means *"the request went out"* — `{terminated:false}` on
   Codex is still a `true`, because that is the provider answering about the WORK.
 * `§6` **`BackgroundTerminals.close()` was not permanent.** It cleared the handle it happened to hold
   and recorded nothing, so an in-flight read could resolve after teardown, publish, and re-arm.

## ⚠️ What this table deliberately does NOT contain

⛔ **A row whose only kill is a live app is a guaranteed survivor, and writing one would be a claim
this harness cannot support.** `mutate.sh` runs `runtime`, `desktop`, `dom` and `scripts`; it launches
no Electron and no provider. Named rather than written:

 * *what the app-server actually does* — that `terminate` kills the process, that `item/completed`
   never arrives, that a list names foreground commands from t = 0 ms. All of it is `275`'s
   measurement, and nothing in this repository can assert it. The fixtures are copies of the wire.
 * *`refresh()`'s own `if (this.closed) return`* — removing it leaves every downstream door still
   guarded by `usable()`, so the row would survive. It is a cheap early exit, not the latch.
 * *Codex's `isShuttingDown` vs `machine.isTerminal`* — the window between them is an ordinary
   conversation close, and the Codex handle's tests reach terminal, never `closing`. `M17` covers the
   half a test CAN see: the button that must not be offered there at all.

⚑ **Four rows in `275`'s table were corrected in place by this dispatch and are not re-covered here**
— `275 M1`, `M2`, `M6` and `M25`. Each carries its own note on the row and in that table's docstring.
Corrected, never retired (142/206): every one of those defects is still live.

⛔ **287 wrote this table and did NOT run it.** Its dispatch §3 says *"Write, do not run."* So
`mutations.txt` does not exist at 287's HEAD and its absence is the honest state. All anchors were
verified present exactly once (`mutations.py --dry-run .`), which is the whole of what can be checked
without running.
"""

from pathlib import Path

TERMINALS = "packages/runtime/src/codex/background-terminals.ts"
CODEX = "packages/runtime/src/codex/codex-runtime.ts"
CLAUDE = "packages/runtime/src/claude/claude-runtime.ts"
HOST = "apps/desktop/src/main/runtime/runtime-host.ts"
TRANSCRIPT = "apps/desktop/src/renderer/src/lib/transcript.ts"
BAR = "apps/desktop/src/renderer/src/components/BackgroundBar.vue"
PANE = "apps/desktop/src/renderer/src/components/ConversationPane.vue"
CARD = "apps/desktop/src/renderer/src/components/AgentCard.vue"

MUTATIONS = [
    # ── §1 · the level reaches the card ─────────────────────────────────────────────────────────
    (
        "M1 · 🔴 THE TICKET · the level updates the registry and nothing else, so every ordinary "
        "Codex background command has a card reading `did not finish` — *'the conversation running "
        "it is gone, so nothing will ever report how it ended'* — beside a bar saying `still "
        "running` with a working Stop, about one live process",
        [(TRANSCRIPT, "        markLevelRunning(state, running)\n", "")],
    ),
    (
        "M2 · 🔴 a level UN-SAYS an ending the provider reported · the outcome guard is gone, so a "
        "row the poll lists once more after its ending landed takes `finished`/`stopped` off the "
        "card and puts `still running` back — `backgroundState`'s own precedence inverted, and 074's "
        "rule with it",
        [
            (
                TRANSCRIPT,
                "    if (call === undefined || call.background?.outcome !== undefined) continue",
                "    if (call === undefined) continue",
            )
        ],
    ),
    (
        "M3 · ⚠️ the level does not clear the sweep it contradicts · so a conversation that was "
        "reopened, then told by the provider that a process IS running, keeps saying nothing will "
        "ever report an ending about work the provider just named",
        [(TRANSCRIPT, "    delete detached.unfinished\n", "")],
    ),
    (
        "M4 · ⛔ the card is detached and NAMELESS · `background` exists with no `id`, so "
        "`data-background-id` is absent and 248 §3's correlation is gone: a reader cannot tell that "
        "the row saying `still running` is the row the bar is offering to stop",
        [
            (
                TRANSCRIPT,
                "    const detached: DetachedWork = { ...call.background, id: item.id }",
                "    const detached: DetachedWork = { ...call.background }",
            )
        ],
    ),
    # ── §2 · the edge that is not an edge ───────────────────────────────────────────────────────
    (
        "M5 · 🔴 a STALE completion asks for the level again · a delayed duplicate for turn A, "
        "arriving while turn B runs an ordinary foreground command, lists that command as background "
        "work, gives it a Stop that terminates foreground work, and ends it as `unknown` on a card "
        "whose real result was a success",
        [
            (
                CODEX,
                "      if (ours) this.backgroundTerminals.note(method)",
                "      this.backgroundTerminals.note(method)",
            )
        ],
    ),
    (
        "M6 · ⛔ a REAL turn end reports itself as somebody else's · the accepted completion answers "
        "`false`, so the one edge the level has never fires: no registry row, no Stop beside one, and "
        "`idle` over a live process. 275's ticket, reached through the return value 287 added",
        [
            (
                CODEX,
                # ⚑ **F074 · re-anchored in place, not retired** — F074 hands the usage limit to the machine; the row still makes an accepted completion answer false.
                # ⚑ **Codex key refusal · re-anchored in place, not retired** — a Codex turn that failed on its credential hands that to the machine too; the row still makes an accepted completion answer false.
                "    this.machine.completeTurn(outcome.outcome, outcome.message, limit, undefined, refused)\n    return true",
                "    this.machine.completeTurn(outcome.outcome, outcome.message, limit, undefined, refused)\n    return false",
            )
        ],
    ),
    # ── §3 · a read that failed ─────────────────────────────────────────────────────────────────
    (
        "M7 · 🔴 a failed read arms nothing · one rejected list and the only thing that can ever "
        "take a row away is gone for the life of the session — Codex sends no closing edge, so the "
        "bar, the pill, the rail and the Stop claim live work for ever over a dead process",
        [(TERMINALS, "        if (failed) this.retryLater()", "        if (failed) return")],
    ),
    (
        "M8 · ⚠️ the retry ignores the level · a session with nothing running retries a failed read, "
        "so the *'a quiet session sends nothing at all, for ever'* promise this file opens with "
        "becomes a request every two seconds over a screen that is claiming nothing",
        [
            (
                TERMINALS,
                "    if (this.level.length === 0 || !this.usable()) return",
                "    if (!this.usable()) return",
            )
        ],
    ),
    (
        "M9 · ⚠️ there is no backoff · a transport that is failing for a reason that outlasts two "
        "seconds is asked every two seconds, which turns one bad read into a request storm against a "
        "child process that is already unwell",
        [
            (
                TERMINALS,
                "  return Math.min(WHILE_RUNNING_MS * 2 ** Math.max(0, failures - 1), MAX_RETRY_MS)",
                "  return WHILE_RUNNING_MS",
            )
        ],
    ),
    (
        "M10 · ⚠️ the backoff is never spent · a failure an hour apart is treated as the fiftieth in "
        "a row, so a session that hiccups occasionally ends up waiting the ceiling before it will "
        "look again — a bound earned by nothing",
        [
            (
                TERMINALS,
                "    // Every page arrived, so whatever was wrong is over — the backoff starts again from the top.\n"
                "    this.failures = 0\n",
                "",
            )
        ],
    ),
    (
        "M11 · ⛔ the retry outlives the session · 273's door on this channel, opened from the one "
        "place added after it was written: a list request armed over a conversation that has already "
        "torn its transport down",
        [
            (
                TERMINALS,
                "    if (this.level.length === 0 || !this.usable()) return",
                "    if (this.level.length === 0) return",
            )
        ],
    ),
    # ── §4 · closed for good ────────────────────────────────────────────────────────────────────
    (
        "M12 · 🔴 `close()` records nothing again · it clears the timer it happens to be HOLDING, so "
        "a read already in flight resolves after teardown, publishes a level and arms the timer "
        "again — another list into a transport that is being closed, exactly after the code claimed "
        "it had stopped watching for good",
        [(TERMINALS, "    this.closed = true\n", "")],
    ),
    (
        "M13 · ⛔ the latch is written and never read · `usable()` asks the session only, which is "
        "the state before this fix wearing the shape of it: a field nothing consults is 198's "
        "definition of code to delete rather than keep",
        [
            (
                TERMINALS,
                "    return !this.closed && this.deps.open()",
                "    return this.deps.open()",
            )
        ],
    ),
    # ── §5 · what `true` means ──────────────────────────────────────────────────────────────────
    (
        "M14 · 🔴 the host invents the answer · `true` written from the fact that nothing threw, "
        "over adapters that no-op silently on a shutting-down session — so the bar reads *'Stopping… "
        "/ Asked to stop'* about a request that never left the process, which is this boolean's own "
        "wire contract broken by its only writer",
        [
            (
                HOST,
                "    if (handle.stopBackgroundWork === undefined) return false\n"
                "    return await handle.stopBackgroundWork(id)",
                "    if (handle.stopBackgroundWork === undefined) return false\n"
                "    await handle.stopBackgroundWork(id)\n"
                "    return true",
            )
        ],
    ),
    (
        "M15 · ⛔ Claude's two no-ops claim they sent · a closed session and a query with no "
        "`stopTask` both answer `true`, which is the silent `undefined` this fix replaced saying the "
        "same thing out loud — and the row keeps a disabled button over work nothing was asked about",
        [
            (
                CLAUDE,
                "    if (this.isShuttingDown || !this.query?.stopTask) return false",
                "    if (this.isShuttingDown || !this.query?.stopTask) return true",
            )
        ],
    ),
    (
        "M16 · ⛔ Codex's terminate claims it sent · a stop over a session with no thread bound, or "
        "one already closed, answers `true` without touching the wire",
        [
            (
                TERMINALS,
                "    if (threadId === undefined || !this.usable()) return false",
                "    if (threadId === undefined || !this.usable()) return true",
            )
        ],
    ),
    (
        "M17 · 🔴 Stop stays offered while the conversation closes · `phase = 'closing'` is set "
        "before the host is awaited (089), this is an ordinary close so the app-wide quit door does "
        "not cover it, and 106's rule is that a control which cannot act is not offered",
        [
            (
                PANE,
                "    props.onStopBackgroundWork !== undefined &&\n"
                "    props.record.phase !== 'closing',",
                "    props.onStopBackgroundWork !== undefined,",
            )
        ],
    ),
    # ── §6 · the latch on the bar ───────────────────────────────────────────────────────────────
    (
        "M18 · 🔴 nothing is ever retired · a stop that SUCCEEDS never comes back `false`, so the id "
        "stays latched while its row leaves — and the next piece of work the provider gives that "
        "number to is born disabled at `Stopping…`, over a request nobody made for it",
        [
            (
                BAR,
                "  const next = new Set([...asked.value].filter((id) => keep.has(id)))",
                "  const next = new Set([...asked.value])",
            )
        ],
    ),
    (
        "M19 · ⛔ the latch follows the reader into the next conversation · this pane is reused "
        "UNKEYED as the active record changes, and a provider id is only unique within a session, so "
        "a row in another conversation that shares the number is born unable to be stopped",
        [
            (
                BAR,
                "// ⚠️ The set is emptied rather than filtered: nothing this conversation is holding is a statement\n"
                "// about the next one, even where the ids happen to match.\n"
                "watch(\n"
                "  () => props.conversation,\n"
                "  () => {\n"
                "    if (asked.value.size > 0) asked.value = new Set()\n"
                "  },\n"
                ")\n",
                "",
            )
        ],
    ),
    (
        "M20 · ⚠️ every conversation is handed the same identity · the bar's scope is a constant, so "
        "the watcher above can never fire and M19's defect is back through the prop instead of "
        "through the component — the shape 099 is about, one hop up",
        # ⚑ Landing ui batch 1 · re-anchored in place, not retired — `ac9c71fd` moved the bar onto
        # the agent's card; the identity it is handed is now the card's `conversation` prop.
        [
            (
                CARD,
                ':conversation="props.conversation ?? \'\'"',
                ':conversation="\'one-conversation\'"',
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
