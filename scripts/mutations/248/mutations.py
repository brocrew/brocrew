#!/usr/bin/env python3
"""248's mutation table — each row is THE DEFECT, put back verbatim (131).

248 is the VISIBLE half of `245`'s only Rank-1 gap, and `247` is the half that put the facts on the
wire. `245`'s own sentence for why it ranked first:

> *"it destroys the central promise of a conversation UI: that the transcript is a trustworthy
> account of what the agent is still doing. It can make closing the app, changing branches or
> starting dependent work unsafe."*

⛔ **Measured against the OS rather than the provider, twice, through two different doors.** `247`
timed a detached `Bash`: turn ended at **9 507 ms**, the command stamped its file at **36 137 ms** —
**26 630 ms** of a green, settled card. `248` §5's probe then found the SAME window through the
sub-agent door, which nobody had measured: turn idle at **5 959 ms**, the agent's own command
stamped at **28 045 ms**, with no `Bash` detachment anywhere in the capture.

⚑ **§5's measurement is why the registry carries sub-agents rather than filtering them out.** A
dispatched agent joins the level set as `local_agent` unless the dispatch sends
`run_in_background: false` — so the SDK's *"agents run in the background by default"* is a
measurement now and not a type reading, and a registry that excluded them would be silent during the
exact window it exists for.

The row groups:

 * `M1`-`M9`   🔴 **the card** — the flag it is read from, the two traps `247` §3 named (the
                receipt's wording, and Codex's `processId` on every command), the ending that turns
                it into the completion record, and the duration that must be the WORK's rather than
                the detachment's.
 * `M10`-`M16` ⛔ **the registry** — REPLACE against merge, absent against empty, the cap said out
                loud, the sweep that stops a dead conversation claiming live work, and the carry
                that keeps a rolled window from forgetting it.
 * `M17`-`M18` ⚠️ **the vocabulary's precedence** — an outcome that arrived outranks a sweep, and a
                sweep outranks a level, because only the first two are facts of ours.
 * `M19`-`M25` ⛔ **the stop** — `106`'s *no control that cannot act* and `118`'s *absent beats
                greyed*, at all four places the gate is spelled: the button, the pane, the host verb
                and the liveness disclosure that carries it.
 * `M26`       ⚠️ **a child's own detached command**, which `248` §5 measured rather than imagined.
 * `M27`       ⚠️ **the live step's classification**, which `224` §5's number depends on.
 * `M28`       ⚠️ **the correlation key** that ties the card to the row the registry offers to stop.
 * `M29`-`M32` 🔴 **the adversarial pass over this diff**, which is where four of the table's rows come
                from — the turn-end sweep that inverted the whole feature, a reclaimed child row that
                lost the fact, a stop that stranded its own control, and a shortfall wiped by the
                re-emission of its own set.

## ⛔ What this table cannot reach, stated because a table silent about its edges is claiming them

 * ⛔ **No row proves `245`'s window closes on a REAL turn.** That is a live claim about a real
   provider and a real process table, and no mutation of this tree can make a model detach a command
   or a process die. `smoke:ui`'s step `74` is its instrument: it reads the OS at the moment the turn
   ends and throws if a card says finished while the process is alive. If a future pin changes what
   the model does, that step goes to an unreached claim and this table stays green — which is the
   correct division, and it means the table is NOT evidence for §7's headline.
 * ⚠️ **No row makes the CSS visible.** `.status-dot.background` is accent-plus-glow and
   `.status-dot.stopped` deliberately has no rule at all; the DOM project mounts real stylesheets but
   nothing here asserts a computed colour, so a mutation swapping them would survive. `074` left the
   same gap for the same reason and named it rather than shipping a row that cannot die.
 * ⚠️ **ONE row touches `packages/runtime`** (`M32`), and the rest do not. 247's table owns that seam;
   248 reaches into it once, because the *"this list is understating itself"* notice cannot be made
   correct on the renderer's side — the producer has to state the shortfall on every frame that states
   the set. `runtime` running WHOLE on all the other rows is the claim that this change reached
   nothing behind the wire, and a project that stays green is the honest way to say so.
 * ⚑ **Nothing retired.** Run `census.py` before believing that in either direction — 238's lesson 4.
   ⚠️ One row of ANOTHER table moved: `150` M28's anchor is re-indented, because the line it points at
   was extracted into `noteFailure` so `stopBackgroundWork` could reuse it instead of copying it. It
   was re-run and still kills (`desktop RED 5`), which is what the census asks for rather than
   assumed.

## ⚑ The killing test for every row, named before the table was run, and CHECKED after

⚠️ Every entry was verified by applying the row and watching the named test go red — 238's lesson,
where two rows stayed green beside prose saying they must die.

 * `M1`  → `background-work.test.ts` *"a detached receipt is NOT a completion"*.
 * `M2`  → *"a `backgroundId` alone does NOT detach a card — the Codex trap 247 named"*.
 * `M3`  → *"an ending cannot be erased by a receipt that arrives after it"*.
 * `M4`  → *"…and so is a sub-agent's OWN command, one level down"*.
 * `M5`  → `background-bar.render.test.ts` *"a detached call does NOT read as finished"*.
 * `M6`  → *"…and it becomes the completion record, with the WORK's duration"*.
 * `M7`  → *"the card becomes the COMPLETION RECORD when the work really ends"*.
 * `M8`  → the render test's `>35.1 s<`, which is `endedAt - at`.
 * `M9`  → *"…and so is a sub-agent's OWN command, one level down"* — its ending half.
 * `M10` → *"every level payload REPLACES the set — and `[]` is what clears it"*.
 * `M11` → *"absent is NOT empty — a frame that states no level changes nothing"*.
 * `M12` → *"`dropped` travels WITH the level and is replaced with it"*.
 * `M13` → *"a closed session stops the card claiming, and empties the registry"*.
 * `M14` → the same test's `unfinished` half, and *"…and a reopen does the same"*.
 * `M15` → `transcript-window.test.ts` *"a level stated in the RELEASED prefix is still on screen"*.
 * `M16` → *"the carry is a COPY — two folds cannot come to disagree through a shared array"*.
 * `M17` → *"every word in the table is produced by a real fold"* — its `unfinished` row.
 * `M18` → *"the outcome outranks the sweep, and the sweep outranks the level"*.
 * `M19` → `background-bar.render.test.ts` *"no stop where the adapter cannot stop"*, and
           `dom/background-stop.dom.test.ts` *"no button at all where the adapter cannot stop"*.
 * `M20` → `dom/background-stop.dom.test.ts` *"the row says it was asked"*.
 * `M21` → `dom/background-stop.dom.test.ts` *"no button at all where the adapter cannot stop"*.
 * `M22` → `runtime-host.test.ts` *"stopBackgroundWork answers `false` on a seam that has no stop"*.
 * `M23` → `runtime-host.test.ts` *"the liveness OMITS `canStopBackgroundWork`"*.
 * `M24` → `session-store.test.ts` *"a stop that FAILS says so beside the conversation"*.
 * `M25` → `background-bar.render.test.ts` *"a registry that is UNDERSTATING itself says so"*.
 * `M26` → `dom/background-nested.dom.test.ts` *"the row carries the word"*.
 * `M27` → `step-census.test.ts` *"a step that reports an unreached claim is never left in the app
           default"*.
 * `M28` → `background-bar.render.test.ts` *"a detached call does NOT read as finished"* — its
           `data-background-id` line, added by the adversarial pass over this diff.
 * `M29` → `background-work.test.ts` *"the card still says 'still running' once the turn is over"*
           and *"…and the registry still names it"*.
 * `M30` → *"a child row RECLAIMED onto its card keeps what it had learned"*.
 * `M31` → `dom/background-stop.dom.test.ts` *"a stop that did NOT go out gives the control back"*.
 * `M32` → `packages/runtime/test/background-work.test.ts` *"the shortfall travels with the set, so a
           RE-EMISSION cannot wipe it"*.
"""

from pathlib import Path

FOLD = "apps/desktop/src/renderer/src/lib/transcript.ts"
WIN = "apps/desktop/src/renderer/src/lib/transcript-window.ts"
VOCAB = "apps/desktop/src/renderer/src/lib/background-work.ts"
CARD = "apps/desktop/src/renderer/src/components/ToolEntry.vue"
# ⚑ **`587` · where the card's own derivation went.** `status` and `took` are one derivation now,
# read by the card and by the collapsed run beside it — `064`/`099`.
OUTCOME = "apps/desktop/src/renderer/src/lib/tool-outcome.ts"
BAR = "apps/desktop/src/renderer/src/components/BackgroundBar.vue"
PANE = "apps/desktop/src/renderer/src/components/ConversationPane.vue"
STORE = "apps/desktop/src/renderer/src/lib/session-store.ts"
HOST = "apps/desktop/src/main/runtime/runtime-host.ts"
CHILD = "apps/desktop/src/renderer/src/components/SubAgentEntry.vue"
CENSUS = "scripts/lib/step-census.mjs"
NORM = "packages/runtime/src/claude/normalize.ts"

# (name, [(file, old, new), ...])
MUTATIONS = [
    # ---- the card -------------------------------------------------------------------------------
    (
        "M1 · 🔴 THE DEFECT, verbatim · no receipt is ever a detachment again, so the Bash card "
        "settles green at 6 102 ms for a command that runs to 36 150 ms — 245's whole finding, back",
        [(FOLD, "  if (event.backgrounded !== true) return undefined", "  return undefined")],
    ),
    (
        "M2 · ⛔ the trap 247 §3 named · the card is gated on HAVING a stop id instead of on the "
        "flag — and Codex puts a `processId` on every PTY-backed command, foreground included, so "
        "every finished Codex command reads 'still running' on the adapter that implements no stop",
        [
            (
                FOLD,
                "  if (event.backgrounded !== true) return undefined",
                "  if (event.backgroundId === undefined) return undefined",
            )
        ],
    ),
    (
        "M3 · ⚠️ the receipt ASSIGNS rather than merges · nothing on the wire orders the ending "
        "against the receipt, so a command that has already finished goes back to 'still running'",
        [
            (
                FOLD,
                "        if (detached) item.background = { ...item.background, ...detached }",
                "        if (detached) item.background = { ...detached }",
            )
        ],
    ),
    (
        "M4 · ⚠️ a sub-agent's OWN detached command loses the fact · 248 §5 measured a dispatched "
        "agent running a Bash of its own, and nothing stops that child asking to detach it",
        [
            (
                FOLD,
                "        if (detached) nested.background = { ...nested.background, ...detached }\n",
                "",
            )
        ],
    ),
    (
        "M5 · ⛔ the card's dot ignores the detachment · `ok:true` wins, so the row is green and "
        "successful while the work runs on — 245's *green settled Bash card*, in one line",
        # ⚑ **Anchor corrected at `587`, subject unmoved.** `ToolEntry`'s `status` moved WHOLE to `tool-outcome.ts` and the card reads it;
        # Re-verified RED by hand at the correction (`a-corrected-anchor-keeps-a-verdict-it-never-earned`).
        [
            (
                OUTCOME,
                "  if (item.background !== undefined) {\n"
                "    const state = backgroundState(item.background)\n"
                "    return state === 'running' ? 'background' : state\n"
                "  }\n",
                "",
            )
        ],
    ),
    (
        "M6 · ⚠️ the row prints the DETACHMENT's duration · '1.2 s' beside work that ran for half a "
        "minute, which is the same lie in a smaller font",
        [
            # ⚑ **Anchor corrected at `587`, subject unmoved.** `took` moved with `status`; the far end this row shortens is the same line.
            # Re-verified RED by hand at the correction (`a-corrected-anchor-keeps-a-verdict-it-never-earned`).
            (
                OUTCOME,
                "  const to = item.background ? item.background.endedAt : item.result?.at",
                "  const to = item.result?.at",
            )
        ],
    ),
    (
        "M7 · ⛔ the ending never reaches the card · 245's other half — *reconcile final task "
        "completion to that card: ABSENT · 1, measured Claude card never changed*",
        [
            (
                FOLD,
                "        const row = event.ended.toolCallId ? toolRowFor(state, event.ended.toolCallId) : undefined",
                "        const row = undefined",
            )
        ],
    ),
    (
        "M8 · ⚠️ the ending does not stamp WHEN it landed · the card can say it finished and not how "
        "long it took, so the completion record is half a record",
        [(FOLD, "            endedAt: at,\n", "")],
    ),
    (
        "M9 · ⚠️ `toolRowFor` stops looking on the cards · a child's call is deliberately not in "
        "`toolItems`, so its ending would land nowhere and its row would claim forever",
        [(FOLD, "  const card = cardOwningTool(state, callId)", "  const card = undefined")],
    ),
    # ---- the registry ---------------------------------------------------------------------------
    (
        "M10 · 🔴 the level is MERGED rather than replaced · the SDK's own doc: *replace their set "
        "with each payload rather than pairing edges, so a missed bookend cannot wedge a stale "
        "running indicator* — and 222 is what a stale indicator costs",
        [
            (
                # ⚑ **Anchor corrected at `587`, subject unmoved — and it was dark BEFORE this
                # dispatch**, at `a69703c1` and earlier: `287` named the level's rows on their own
                # line and this row went on quoting the inlined spread. ⛔ `mutations:check` stayed
                # green because the census on disk already described it that way, which is rule 27's
                # shape. Re-verified RED by hand at the correction.
                FOLD,
                "        state.background = { running, dropped: event.dropped ?? 0 }",
                "        state.background = {\n          running: [...state.background.running, ...running],\n          dropped: event.dropped ?? 0,\n        }",
            )
        ],
    ),
    (
        "M11 · ⛔ ABSENT is read as EMPTY · every frame that carries only an ending would clear the "
        "registry, which is the traffic most likely to arrive while something is still running",
        [
            (
                # ⚑ **Anchor corrected at `587`, subject unmoved — and it was dark BEFORE this
                # dispatch**, at `a69703c1` and earlier: `287` named the level's rows on their own
                # line and this row went on quoting the inlined spread. ⛔ `mutations:check` stayed
                # green because the census on disk already described it that way, which is rule 27's
                # shape. Re-verified RED by hand at the correction.
                FOLD,
                "      if (event.running !== undefined) {\n",
                "      {\n",
            ),
            (
                # ⚠️ **TWO edits, because a twelve-line comment now sits between the guard and the
                # statement it guards.** ⛔ Dropping the guard alone would make `event.running.map`
                # throw rather than draw the defect, and a row that crashes measures the crash.
                FOLD,
                "        const running = event.running.map((row) => withCommand(state, row))\n",
                "        const running = (event.running ?? []).map((row) => withCommand(state, row))\n",
            )
        ],
    ),
    (
        "M12 · ⚠️ the cap goes silent · a registry that quietly undercounts is worse than none "
        "(247 §3), because a list that looks complete is read as complete",
        [(FOLD, "dropped: event.dropped ?? 0 }", "dropped: 0 }")],
    ),
    (
        "M13 · ⛔ the registry outlives the conversation · a closed, read-only or reopened "
        "conversation goes on naming work that died with the CLI child — 222's stale indicator, "
        "arriving through the store instead of through a missed bookend",
        [(FOLD, "  state.background = { running: [], dropped: 0 }\n", "")],
    ),
    (
        "M14 · ⛔ …and so does the CARD · it is the one row here with a result, so the sweep above "
        "it skips it by design and nothing else would ever correct the claim",
        [
            (
                FOLD,
                "    if (row.background && row.background.outcome === undefined) row.background.unfinished = true\n",
                "",
            )
        ],
    ),
    (
        "M15 · ⚠️ a rolled window forgets what is running · the level is not an item, so the events "
        "that would restate it are exactly the ones a slab release throws away — and a conversation "
        "long enough to roll is one you have stopped watching",
        [(WIN, "    state.background = carry.background\n", "")],
    ),
    (
        "M16 · ⚠️ the carry ALIASES the outgoing fold's array · two folds sharing one array is a way "
        "for them to disagree later for no reason (the rule `activity` and `meter` already follow)",
        [
            (
                WIN,
                "    background: { running: [...state.background.running], dropped: state.background.dropped },",
                "    background: state.background,",
            )
        ],
    ),
    # ---- the vocabulary's precedence ------------------------------------------------------------
    (
        "M17 · ⚠️ the sweep loses to the level · a conversation quit mid-command replays saying "
        "'still running' about a dead process, forever",
        [(VOCAB, "  return work.unfinished === true ? 'unfinished' : 'running'", "  return 'running'")],
    ),
    (
        "M18 · ⚠️ the sweep outranks the OUTCOME · a `task_notification` that lands after a reopen "
        "renders as the sweep rather than as the ending it is — `ToolEntry`'s precedence rule, "
        "inverted (*the real result still wins wherever there is one*)",
        [
            (
                VOCAB,
                "  if (work.outcome !== undefined) return work.outcome",
                "  if (work.unfinished === true) return 'unfinished'",
            )
        ],
    ),
    # ---- the stop -------------------------------------------------------------------------------
    (
        "M19 · ⛔ the button is offered where nothing can act · 106's rule outright, and on Codex it "
        "would call a method the adapter does not implement",
        [(BAR, '          v-if="props.canStop"', '          v-if="true"')],
    ),
    (
        "M20 · ⚠️ the row keeps inviting a second press · stopTask promises a notification, not a "
        "death (233/240), so a button that stayed live would read as one that did nothing",
        [(BAR, '          :disabled="asked.has(row.id)"', '          :disabled="false"')],
    ),
    (
        "M21 · ⛔ the pane reads ABSENCE as permission · `!== false` turns every adapter's silence "
        "into a positive claim, which is 150/148 L3 exactly — and Codex says nothing at all",
        [
            (
                PANE,
                "    props.record.meta?.liveness.canStopBackgroundWork === true &&",
                "    props.record.meta?.liveness.canStopBackgroundWork !== false &&",
            )
        ],
    ),
    (
        "M22 · ⛔ the host claims a stop it never made · an adapter with no such method would answer "
        "'the request went out' — 233/240's distinction, discarded at the one place it is made",
        [
            (
                HOST,
                "    if (handle.stopBackgroundWork === undefined) return false",
                "    if (handle.stopBackgroundWork === undefined) return true",
            )
        ],
    ),
    (
        "M23 · ⛔ the liveness publishes an explicit `false` · 148 L3's finding, one field over: "
        "`=== true` turned every adapter's silence into a positive claim, and absence is what an "
        "adapter with nothing to say is entitled to",
        [
            (
                HOST,
                "    ...(session.handle.stopBackgroundWork === undefined ? {} : { canStopBackgroundWork: true }),",
                "    canStopBackgroundWork: session.handle.stopBackgroundWork !== undefined,",
            )
        ],
    ),
    (
        "M24 · ⚠️ a failed stop says nothing · a control that failed silently is a control that "
        "cannot act pretending it can (106), and 118 is why the sentence goes beside the session",
        [
            (
                STORE,
                "      } catch (cause) {\n        noteFailure(record, cause)\n        return false\n      }",
                "      } catch (cause) {\n        void cause\n        return false\n      }",
            )
        ],
    ),
    (
        "M25 · ⚠️ the registry stops saying it is UNDERSTATING itself · 092's no-silent-cap rule, "
        "and 247 §3's sharpening of it for this event",
        [
            (
                BAR,
                '    <p v-if="props.registry.dropped > 0" class="bg-dropped" data-cy="background-dropped">',
                '    <p v-if="false" class="bg-dropped" data-cy="background-dropped">',
            )
        ],
    ),
    (
        "M26 · ⚠️ a CHILD's detached command goes back to reading as an ordinary receipt · 248 §5 "
        "measured a dispatched agent running a Bash of its own, so this is the same lie one level "
        "down, on a row a different component draws",
        [(CHILD, '              v-if="row.background"', '              v-if="false"')],
    ),
    # ---- the live step's classification ---------------------------------------------------------
    (
        "M27 · ⚠️ the new live step joins the run unclassified · 224 §5's number would count a step "
        "that reports an unreached claim as one that can only go red for an app defect",
        [
            (
                CENSUS,
                "  74: {\n    cause: 'provider',\n    why: 'whether the model DETACHES",
                "  '74-retired': {\n    cause: 'provider',\n    why: 'whether the model DETACHES",
            )
        ],
    ),
    (
        "M28 · ⚠️ the card stops carrying the CORRELATION with the registry · the bar offers to stop "
        "a piece of work and the row saying 'still running' has nothing on screen tying the two "
        "together, so a reader cannot tell that they are one thing",
        [(CARD, '    :data-background-id="item.background?.id"\n', "")],
    ),
    (
        "M29 · 🔴 THE ADVERSARIAL PASS'S OWN FINDING, reverted verbatim · the detached sweep goes back "
        "onto the TURN-end path, so the registry empties and every card flips to 'did not finish' at "
        "the instant 245's window opens — the defect this dispatch exists to end, inverted",
        [
            (
                FOLD,
                "    case 'turn': {\n      closeStreaming(state)",
                "    case 'turn': {\n      stopDetachedWork(state)\n      closeStreaming(state)",
            )
        ],
    ),
    (
        "M30 · ⛔ a child's row loses what it learned when its card reclaims it · the one path that "
        "exists BECAUSE something arrived late is the one that drops what arrived in the meantime",
        [
            (
                FOLD,
                "      ...(item.background ? { background: { ...item.background } } : {}),\n",
                "",
            )
        ],
    ),
    (
        "M31 · ⛔ a stop that never landed keeps the control · the only button for still-running work "
        "sits at 'Stopping…' for ever — 106's control that cannot act, manufactured by the app",
        [(BAR, "  if (!(await props.onStop(id))) forget(id)", "  await props.onStop(id)")],
    ),
    (
        "M32 · ⚠️ the level RE-EMISSION drops the shortfall again · the 'this list is understating "
        "itself' notice is wiped one millisecond after it appears, while the set is still short",
        [
            (
                NORM,
                "        ...(background.dropped() > 0 ? { dropped: background.dropped() } : {}),\n",
                "",
            )
        ],
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
