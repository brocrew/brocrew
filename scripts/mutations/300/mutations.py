#!/usr/bin/env python3
"""300's mutation table — each row is THE DEFECT, put back verbatim (131).

⛔ **Two gaps, one handle.** `300` §1: *"Both need the same thing: a handle to a specific running
command rather than to the turn."* Every row below is about that handle being kept, addressed
correctly, bounded, withdrawn, or offered only while it means something.

 * **gap 3** — *"Watch a running command while it runs. You see the card, but not the live output."*
   Codex streams it (`item/commandExecution/outputDelta`, measured: 11 frames for a 12-tick command,
   **and 39 more after its own `turn/completed`**); the app discarded every one. Claude streams
   nothing at all, measured over 53 frames with a nonce only the process could produce.
 * **gap 5** — *"Stop one command without stopping everything. Escape stops the whole turn."* Codex
   hands a stop key on EVERY PTY-backed command, foreground included — measured live: a turn blocked
   on `sleep 300.52243`, `tool_call backgroundId=77615`, `terminate` → `{terminated:true}`, the OS
   stopped listing it, ⚑ **and the turn went on to complete.** The app drew no control for it.

## The row groups

 * `M1`-`M4`   🔴 **the feed, and WHERE it sits.** Above the turn gate and below the thread gate, and
                both halves are load-bearing: `M1` is the placement itself, verified by hand to turn
                the post-turn assertion red.
 * `M5`-`M13`  ⛔ **the ring.** Two ceilings, a counted cut, a code-point slice, eviction by the
                write rather than the read, the two closers a detached command has, and the teardown.
 * `M14`-`M18` ⚠️ **the four silences.** `null`, an empty tail, a recording and a provider that will
                never stream are four different sentences, and `074` is why they may not collapse.
 * `M19`-`M25` 🔴 **the follow.** One timer on the pane, gated on the session, started by the
                gesture, and withdrawn by the fold, by the unmount and by a conversation switch.
 * `M26`-`M29` ⛔ **the key on the card**, kept without ever being read as a detachment — the trap
                `detachment()` refuses, sprung from the other side.
 * `M30`-`M36` 🔴 **the Stop**, and the four things that decide whether it may be offered at all.
 * `M37`-`M38` ⚠️ **the two places the tail and the fold could disagree** — §4's own warning.
 * `M39`-`M40` 🔴 **the two identities**: the latch keyed by the CALL rather than by the provider's
                recyclable number, and ONE predicate for *"is this command going on"*. Both were
                found by the adversarial pass over this dispatch's own diff.
 * `M41`-`M43` ⚑ **the instruments**, including the probe's own nonce — which run 1 did not have,
                and whose absence made its Claude reading unusable.

## Where each row is expected to be caught

 * `M1`-`M13` → `codex-runtime.test.ts` *"a running command's output (300)"* and
   `command-output.test.ts` — both in the `runtime` project.
 * `M14`-`M18`, `M26`-`M33`, `M37`, `M40` → `watch-one-command.render.test.ts` (`desktop`), which
   folds the transcript and renders the card in SSR.
 * `M19`-`M25`, `M34`-`M36`, `M38`-`M39` → `watch-and-stop-one-command.dom.test.ts` (`dom`), which
   is the only project where a fold, a timer and a conversation switch exist at all.
 * `M41`-`M43` → `conformance.test.ts`'s gap ledger and the probe's own file.

⚠️ **What no project here can see, said once**: `run_suite` runs vitest, which transforms through
esbuild — so a row that breaks only the TYPES passes all four. `M43` is in that class. `M25` is a
lifecycle-hook row whose effect is a LEAK rather than a wrong answer, and the `dom` project's
`afterEach` unmounts everything, so it may survive; it is named as such rather than left to look
like a gap.

⚠️ Like 240, 243, 247, 248, 250, 251, 254, 258, 262 and 292, this table does NOT mutate the harness
it is run by, and it touches no other dispatch's table.
"""

from __future__ import annotations

import sys
from pathlib import Path

CODEX = "packages/runtime/src/codex/codex-runtime.ts"
RING = "packages/runtime/src/command-output.ts"
TAIL = "apps/desktop/src/renderer/src/lib/command-tail.ts"
TRANSCRIPT = "apps/desktop/src/renderer/src/lib/transcript.ts"
ENTRY = "apps/desktop/src/renderer/src/components/ToolEntry.vue"
PANE = "apps/desktop/src/renderer/src/components/ConversationPane.vue"
CLAUDE_CAPS = "packages/runtime/src/claude/capabilities.ts"
CONFORMANCE = "packages/runtime/test/conformance.test.ts"
PROBE = "packages/runtime/smoke/command-output-probe.smoke.ts"

MUTATIONS = [
    # ── the feed, and where it sits ───────────────────────────────────────────────────────────
    # Re-anchored, NOT VERIFIED and HELD; its test reaches a held path.
    (
        "M1 · 🔴 THE FEED SITS BELOW THE TURN GATE — the defect this dispatch is about, in one line. "
        "A detached command's output stops the instant its turn ends, which is the instant it becomes "
        "the background work anybody would want to watch. Verified by hand: this reverts the "
        "post-turn assertion to red",
        [('packages/runtime/src/codex/codex-runtime.ts', "    if (method === 'item/commandExecution/outputDelta') this.noteCommandOutput(params)\n    if (method === 'item/completed') this.closeCommandOutput(params)\n    // Turn-scoped CONTENT", '    // Turn-scoped CONTENT'), ('packages/runtime/src/codex/codex-runtime.ts', '    for (const normalized of normalizeNotification(method, params, this.rateLimits)) {', "    if (method === 'item/commandExecution/outputDelta') this.noteCommandOutput(params)\n    if (method === 'item/completed') this.closeCommandOutput(params)\n    for (const normalized of normalizeNotification(method, params, this.rateLimits)) {")],
    ),
    (
        "M2 · ⛔ nothing is fed at all — the card goes on saying `running…` and nothing else, which is "
        "the state the person described",
        [
            (
                CODEX,
                "    if (method === 'item/commandExecution/outputDelta') this.noteCommandOutput(params)\n",
                "",
            )
        ],
    ),
    (
        "M3 · 🔴 the tail is keyed by the TURN rather than by the item — every command in a turn "
        "writes into one buffer, so two commands running together show each other's output",
        [
            (
                CODEX,
                "    this.commandTails.write(readString(params, 'itemId'), readString(params, 'delta'))",
                "    this.commandTails.write(readString(params, 'turnId'), readString(params, 'delta'))",
            )
        ],
    ),
    (
        "M4 · ⛔ the item's own id is not read on completion, so no `item/completed` ever closes a "
        "tail and a finished command goes on presenting its last output as live",
        [
            (
                CODEX,
                "    const item = isRecord(params) ? params['item'] : undefined\n"
                "    this.commandTails.close(readString(item, 'id'))",
                "    this.commandTails.close(readString(params, 'id'))",
            )
        ],
    ),
    # ── the ring ──────────────────────────────────────────────────────────────────────────────
    (
        "M5 · ⛔ the tail has no ceiling — one `pnpm test` puts its whole output in memory, which is "
        "052's blow-up with a smaller unit",
        [(RING, "    const over = Math.max(0, points.length - MAX_COMMAND_TAIL)", "    const over = 0")],
    ),
    (
        "M6 · ⛔ the cut is SILENT — the tail starts in the middle and says nothing about it, which is "
        "exactly the ellipsis 092 forbids, without even a glyph",
        [(RING, "      dropped: (held?.dropped ?? 0) + over,", "      dropped: 0,")],
    ),
    (
        "M7 · ⛔ the drop count does not accumulate, so it understates by exactly as much as the "
        "command kept printing — 247 §3's registry that quietly undercounts",
        [(RING, "      dropped: (held?.dropped ?? 0) + over,", "      dropped: over,")],
    ),
    (
        "M8 · 🔴 sliced by UTF-16 unit rather than by CODE POINT — a command ending on an emoji at the "
        "boundary renders a lone surrogate on the one surface whose job is not misleading anyone "
        "about what ran (251's rule, one surface over)",
        [
            (
                RING,
                "    const points = [...joined]",
                "    const points = joined.split('') as unknown as string[]",
            )
        ],
    ),
    (
        "M9 · ⛔ nothing is ever evicted — the map grows with the conversation rather than with what "
        "is running",
        [(RING, "    this.evict()", "    void 0")],
    ),
    (
        "M10 · ⛔ eviction is by FIRST write rather than by last — the one command still producing is "
        "the first one thrown away, which is the only entry that had to survive",
        [(RING, "    if (held !== undefined) this.tails.delete(id)", "    void held")],
    ),
    (
        "M11 · ⛔ `close` MINTS a ring for a command that never streamed — so `read` answers an empty "
        "tail, and the card says *'it printed nothing'* about work it was never watching",
        [
            (
                RING,
                "    const held = this.tails.get(id)\n    if (held === undefined) return\n    held.closed = true",
                "    const held = this.tails.get(id) ?? { text: '', dropped: 0, closed: false }\n"
                "    held.closed = true\n    this.tails.set(id, held)",
            )
        ],
    ),
    (
        "M12 · ⛔ the registry's ending does not close the tail — and it is a DETACHED command's only "
        "closer, because Codex emits no `item/completed` for one, ever (275, measured)",
        [(CODEX, "      this.closeEndedCommandOutput(event)\n", "")],
    ),
    (
        "M13 · ⛔ the buffers outlive the session — a closed conversation keeps presenting a live tail "
        "for a process that died with its provider",
        [(CODEX, "    this.commandTails.clear()\n", "")],
    ),
    # ── the four silences ─────────────────────────────────────────────────────────────────────
    (
        "M14 · 🔴 `null` and an empty tail collapse into one sentence — *'we are not holding it'* and "
        "*'it has printed nothing yet'* are different facts and 074's whole rule is that they stay "
        "apart",
        # ⚑ Landing D-017b (3af91dcb) · re-anchored in place, not retired — 074's rule still holds
        # in `tailAbsence`: 'nothing kept' (`null` tail) and 'has not printed anything yet' (empty
        # text) stay separate sentences. Only the null arm changed, from an inline literal to the
        # `NOTHING_KEPT` constant (D-017b). The plant collapses the two arms into one.
        [
            (TAIL, "  if (tail === null) return NOTHING_KEPT\n  if (tail.text === '') return 'It has not printed anything yet.'", "  if (tail === null || tail.text === '') return NOTHING_KEPT"),
        ],
    ),
    (
        "M15 · ⛔ a provider that will NEVER stream gets the recording's sentence — so a Claude card "
        "says the conversation is closed while it is running, and the real asymmetry is never "
        "disclosed (039)",
        [
            (
                TAIL,
                "    if (capability?.state === 'absent') return capability.reason\n",
                "",
            )
        ],
    ),
    (
        "M16 · ⚠️ an `unwired` reason is shown to the person watching their own command — a true "
        "sentence about US, in the wrong voice, on the wrong surface",
        [
            (
                TAIL,
                "    if (capability?.state === 'absent') return capability.reason",
                "    if (capability !== null && capability.state !== 'available') return capability.reason",
            )
        ],
    ),
    (
        "M17 · ⛔ the cut becomes an ELLIPSIS the reader cannot tell from the command's own — 092's "
        "rule, and `background-work.ts`'s `cutNote` one surface over",
        [
            (
                TAIL,
                "    ? '1 earlier character is no longer kept'\n"
                "    : `${dropped.toLocaleString()} earlier characters are no longer kept`",
                "    ? '…'\n    : '…'",
            )
        ],
    ),
    (
        "M18 · ⛔ *'still live'* is read off SILENCE rather than off the provider's ending — a command "
        "printing nothing becomes a finished one, which is 042's timeout wearing a number",
        [(TAIL, "  return tail !== null && !tail.closed", "  return tail !== null && tail.text !== ''")],
    ),
    (
        "M19 · ⛔ a session with no handle is asked anyway — a recording polls a bridge that answers "
        "nothing, once a second, for as long as it is open",
        [
            (
                PANE,
                "    props.record.meta?.liveness.canReadCommandOutput === true &&\n"
                "    props.onReadCommandOutput !== undefined,",
                "    props.onReadCommandOutput !== undefined,",
            )
        ],
    ),
    # ── the follow ────────────────────────────────────────────────────────────────────────────
    (
        "M20 · 🔴 the first read waits for the timer — so a card opened over a command that has been "
        "printing for a minute says *'nothing kept'* for a whole second, which reads as broken",
        [(PANE, "  void readFollowed()\n  if (followTimer === null)", "  if (followTimer === null)")],
    ),
    (
        "M21 · ⛔ the follow never stops — a folded card is polled for the life of the conversation, "
        "and every card ever opened is still being read",
        [
            (
                PANE,
                "  if (!on) {\n    following.delete(callId)\n    followed.delete(callId)\n",
                "  if (!on) {\n",
            )
        ],
    ),
    (
        "M22 · ⛔ the timer outlives the pane that owns it — it holds this closure, its record and "
        "every tail it captured, and goes on asking about a conversation nobody is looking at",
        # ⚑ Landing ui f1fa1e2e…70aaa954 (the card panel and the Vue Flow forest) · re-anchored in
        # place, not retired — The rule survives and the subject is intact: onUnmounted still ends
        # with `stopFollowing()`. 70aaa954 inserted `cast.inspected.value = null` between
        # `removeEventListener` and the comment, so edit 0's two-line anchor went dark. Edit 0 is
        # re-anchored on the comment line alone, which survives UI-006 removing that inserted line.
        # Edit 1 (`  stopFollowing()\n})`) still applies once. ⚠️ No existing test kills it, and it
        # is probably an equivalent mutant. watch-and-stop-one-command.dom.test.ts never unmounts a
        # pane mid-follow and moves the clock, and ToolEntry's `onBeforeUnmount` withdrawal (587)
        # already empties `following`, so the next `tick` or the withdrawal stops the timer anyway.
        # Table 300 has no mutations.txt, so the row was never verified. ⚠️ Run alone at this landing
        # against `watch-and-stop-one-command.dom.test.ts`: SURVIVED, as expected. An equivalent
        # mutant since 587 (ToolEntry's own withdrawal stops the timer), recorded rather than
        # removed, as 347 M17 is. It means something again only beside a plant that breaks that
        # withdrawal.
        [
            (PANE, '  // ⛔ **A timer must never outlive the pane that owns it** (300)', '  // (the timer is deliberately left running)\n  // ⛔ **A timer must never outlive the pane that owns it** (300)'),
            (PANE, '  stopFollowing()\n})', '})'),
        ],
    ),
    (
        "M23 · 🔴 a conversation switch leaves the tail behind — this pane is reused without a key, so "
        "conversation A's output is drawn under conversation B's card (287 finding 4's hazard, one "
        "surface over)",
        [
            (
                PANE,
                "    following.clear()\n    followed.clear()\n    drainAgain = false\n    stopFollowing()\n",
                "",
            )
        ],
    ),
    (
        "M24 · ⛔ a read that lands after its card let go is written anyway — the tail comes back for a "
        "row nobody is watching",
        [
            (
                PANE,
                "    if (following.has(callId)) followed.set(callId, tail)",
                "    followed.set(callId, tail)",
            )
        ],
    ),
    (
        "M25 · ⛔ the withdrawal is raised from `onUnmounted`, which Vue DROPS — so a row the "
        "virtualizer scrolled away is followed for ever. ⚠️ Expected to survive the `dom` project: "
        "its `afterEach` unmounts the app, so the leak has nowhere to show",
        [(ENTRY, "onBeforeUnmount(() => {", "onUnmounted(() => {")],
    ),
    # ── the key on the card ───────────────────────────────────────────────────────────────────
    (
        "M26 · 🔴 the fold throws the provider's stop key away — which is what the app did before this "
        "dispatch, holding a working handle for every Codex command and rendering nothing",
        [
            (
                TRANSCRIPT,
                "        ...(event.backgroundId === undefined ? {} : { stopKey: event.backgroundId }),\n",
                "",
            )
        ],
    ),
    (
        "M27 · ⛔ the RECEIPT's key is dropped — which is the only place Claude ever names one, so a "
        "detached Claude task has no stop on its card at all",
        [(TRANSCRIPT, "        if (event.backgroundId !== undefined) item.stopKey = event.backgroundId\n", "")],
    ),
    (
        "M28 · ⛔ a later receipt carrying no key TAKES THE KEY AWAY — the same shape the line above it "
        "merges rather than assigns to avoid",
        [
            (
                TRANSCRIPT,
                "        if (event.backgroundId !== undefined) item.stopKey = event.backgroundId",
                "        item.stopKey = event.backgroundId",
            )
        ],
    ),
    (
        "M29 · 🔴 having a key is read as HAVING DETACHED — the trap `detachment()` refuses by name, "
        "sprung from the other side: Codex puts a `processId` on every PTY command, so every finished "
        "one would read *'still running'*",
        [
            (
                TRANSCRIPT,
                "  if (event.backgrounded !== true) return undefined",
                "  if (event.backgrounded !== true && event.backgroundId === undefined) return undefined",
            )
        ],
    ),
    # ── the Stop ──────────────────────────────────────────────────────────────────────────────
    (
        "M30 · 🔴 the Stop is offered on a row that has already reported back — which is what makes a "
        "RECYCLED provider id reachable: Codex's `processId` is a counter it reuses and a transcript "
        "row lives for ever, so a press stops somebody else's command",
        [
            (
                ENTRY,
                "const stoppable = computed(() => props.canStop && live.value && props.item.stopKey !== undefined)",
                "const stoppable = computed(() => props.canStop && props.item.stopKey !== undefined)",
            )
        ],
    ),
    (
        "M31 · ⛔ the Stop ignores whether the adapter can stop anything — 106's control that cannot "
        "act, offered on every recording and every provider without the verb",
        [
            (
                ENTRY,
                "const stoppable = computed(() => props.canStop && live.value && props.item.stopKey !== undefined)",
                "const stoppable = computed(() => live.value && props.item.stopKey !== undefined)",
            )
        ],
    ),
    (
        "M32 · 🔴 the Stop sends the CALL id instead of the provider's key — they are different "
        "strings and only one of them stops anything; the measured refusal is JSON-RPC -32600",
        [
            (
                ENTRY,
                "  if (key !== undefined) emit('stop', props.item.callId, key)",
                "  if (key !== undefined) emit('stop', props.item.callId, props.item.callId)",
            )
        ],
    ),
    (
        "M33 · ⛔ the Stop is hidden by the fold — the one control this app has over a running command, "
        "behind a disclosure triangle a person has no reason to open (106)",
        [(ENTRY, '    <div v-if="stoppable" class="tool-stop">', '    <div v-if="stoppable && !folded" class="tool-stop">')],
    ),
    (
        "M34 · ⛔ the latch is never set, so two presses in one breath send two stops — and on Codex "
        "the second lands on a `processId` the provider may already have handed to something else",
        [(PANE, "  stoppingCalls.value = new Set(stoppingCalls.value).add(callId)\n", "")],
    ),
    (
        "M35 · ⛔ a refused stop leaves the button reading *'Stopping…'* for ever — 106's control that "
        "cannot act, manufactured by the app itself (248 shipped this once and took it back)",
        [
            (
                PANE,
                "  if (!(await stop(key))) {\n    const next = new Set(stoppingCalls.value)\n    next.delete(callId)\n    stoppingCalls.value = next\n  }",
                "  await stop(key)",
            )
        ],
    ),
    (
        "M36 · ⛔ the stop latch survives a conversation switch — nothing this pane holds is a "
        "statement about the next conversation, and it is reused across them without a key",
        [(PANE, "    if (stoppingCalls.value.size > 0) stoppingCalls.value = new Set()\n", "")],
    ),
    (
        "M37 · ⛔ the tail is drawn for a settled row as well — two accounts of one command, which is "
        "300 §4's warning: *'if the output view and the card can disagree, they will'*",
        [(ENTRY, '    <div v-if="!folded && live" class="tool-tail"', '    <div v-if="!folded" class="tool-tail"')],
    ),
    (
        "M38 · ⛔ a folded card asks to be followed — a turn that ran a dozen commands becomes a dozen "
        "pollers, none of which anybody is looking at",
        [(ENTRY, "const watching = computed(() => !folded.value && live.value)", "const watching = computed(() => live.value)")],
    ),
    (
        "M39 · 🔴 the in-flight latch is keyed on the PROVIDER's key rather than on the call — and "
        "Codex's `processId` is a counter it recycles, so the next command born wearing that number "
        "arrives already disabled, reading *'Stopping…'* over a request nobody made for it. `287` "
        "finding 4, one surface over, and the shape this dispatch's first draft shipped",
        [
            (
                PANE,
                "  stoppingCalls.value = new Set(stoppingCalls.value).add(callId)",
                "  stoppingCalls.value = new Set(stoppingCalls.value).add(key)",
            )
        ],
    ),
    (
        "M40 · ⛔ `commandIsLive` becomes a SECOND derivation in the card — the same answer today, and "
        "the shape 099/064 are about: the pane asks the same question to decide what a latch is still "
        "about, and two readings that agree by coincidence are how they stop agreeing",
        [
            (
                ENTRY,
                "const live = computed(() => commandIsLive(props.item))",
                "const live = computed(() => status.value === 'running')",
            )
        ],
    ),
    # ── the instruments ───────────────────────────────────────────────────────────────────────
    (
        "M41 · 🔴 the probe's detector goes back to the predictable string — which is what run 1 had, "
        "and it counted the MODEL saying *'it will print tick-1 through tick-12'* as the provider "
        "streaming. A detector that cannot tell the subject from a sentence about the subject can "
        "neither confirm nor refute (240, from the instrument's side)",
        [(PROBE, "const NONCE = /N0NCE-\\d+-\\d/", "const NONCE = /tick-\\d/")],
    ),
    (
        "M42 · ⛔ Claude's gap is deleted from the conformance ledger — the measured absence stops "
        "being stated, and the next reader closes it believing the provider could not have said · killed by `conformance.test.ts` (named by W4.135)",
        [
            (
                CONFORMANCE,
                # ⚑ **713 · corrected in place** (standing rule 27): Claude's ledger gained `compact`,
                # a gap by design (`R42` sends its `/compact`). Same deletion; re-verified RED alone.
                # ⚑ **W4.135 · re-anchored in place, not retired** — W4.135 · F084 added 'endEverythingTheTurnStarted' to Claude's list and split it one per line; the plant still deletes Claude's commandOutput gap
                "          'childInput',\n          'commandOutput',\n          'compact',\n",
                "          'childInput',\n          'compact',\n",
            ),
            (
                CONFORMANCE,
                "      commandOutput:\n        'Claude reports a command’s output only when the command finishes",
                "      _commandOutput:\n        'Claude reports a command’s output only when the command finishes",
            ),
        ],
    ),
    (
        "M43 · ⛔ Claude declares the capability AVAILABLE — a card that promised a tail on a provider "
        "that never sends one, which is 300 §3's *'fake tail'* in the one place a person would read "
        "it. ⚠️ TYPES only: `state: 'available'` with a `reason` beside it fails `tsc` and passes "
        "esbuild, so this row is expected to survive all four projects",
        # Provider facts live in the shared registry; this row plants the same fault there.
        [("packages/shared/src/providers/claude-capabilities.ts", "  commandOutput: {\n    state: 'absent',", "  commandOutput: {\n    state: 'available',")],
    ),
]


def apply(root: Path, index: int, dry: bool) -> int:
    """Apply (or merely verify) one mutation. Returns 0 on success, 1 on a bad anchor."""
    name, edits = MUTATIONS[index]
    for rel, find, replace in edits:
        path = root / rel
        text = path.read_text()
        hits = text.count(find)
        if hits != 1:
            print(f"!! {name.split(' ·')[0]}: anchor found {hits}x in {rel} (expected exactly 1)")
            return 1
        if find == replace:
            print(f"!! {name.split(' ·')[0]}: replacement equals the original in {rel} — a no-op row")
            return 1
        if not dry:
            path.write_text(text.replace(find, replace, 1))
    return 0


def main() -> int:
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
