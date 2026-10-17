"""296 · A child you can talk to — what the suite would notice if the ruling were removed.

# The finding this table exists to protect

⛔ **`295` measured a Codex child accepting a message it should not have been sent.** The provider
took a `turn/start` for a child that was still working, answered with a turn id that appears in ONE
of its 167 frames and nowhere else, merged the message into the turn already running, completed that
turn, and let the `sleep 20` that turn had started run for another 7.667 seconds.

So the whole dispatch rests on a REFUSAL, and a refusal is the easiest thing in a codebase to delete
by accident: remove it and everything still compiles, the composer still draws, the button still
presses, the message still goes, and the provider still answers `ok`. ⚑ **The only thing that
changes is somebody else's agent.** Rows M1-M4 are the ones that matter; the rest cover the
disclosures and the boundaries that keep the feature honest around them.

# The groups

* **M1-M4 · the ruling.** The refusal in the adapter, the refusal in the host, and the two ways the
  predicate behind them can be quietly weakened (an unknown status reading as idle, a `null`
  capability reading as a `false` one).
* **M5-M7 · the boundary.** Ownership decided before the ledger, the child's own settings left
  alone, and a malformed answer that must not become an idle child.
* **M8-M12 · the composer.** Drawn only where there is a channel, dark for exactly the states that
  refuse, a draft kept when it is refused, and the wire's own emptiness rule.
* **M13-M17 · the follow.** The interval that must stop, the poll that must latch, the stale read
  that must not be assigned, the ceiling that must be said, and the note that must not claim
  nothing can answer.

# ⚠️ What this table cannot reach

⛔ **The provider's own behaviour, which is the thing the ruling is about.** No row here can make a
real app-server merge a message into a running turn — that is `295`'s capture, and the tests replay
its SHAPES rather than its consequences. A row that deletes the refusal reddens because this repo
asserts the refusal, not because anything measured a child being spoken over.

⛔ **`smoke/` and `scripts/ui-live-smoke.mjs` are executed by no vitest project**, so step `80` is a
structural survivor and gets no row — 277's `NO-ROWS.md` and 241 M10 / 275 M28 record that class.

⚠️ **The capability NOTES are prose and are asserted only for two substrings each.** A row that
rewrote `codex.childInput.note` into something misleading but still containing `IDLE` and `working`
would survive, and no row pretends otherwise.

# ⛔ NOT MEASURED

**FIVE rows were measured and twelve were not**, and the labels say which is which rather than
presenting reasoning as a figure. `296` §4 says *"Write, do not run"* and that the machine is busy,
so the table was written, five rows were put into the tree by hand and run, and the rest are left for
`mutate.sh` on an idle machine. ⛔ No `mutations.txt` was produced: the run state is `unrun`, which
is the honest state for a table nobody has replayed end to end.

```
M1  M8  M9  M15  M17   MEASURED   (applied, all three projects run, tree restored + hash-checked)
M2 … M7, M10 … M14, M16   EXPECTED (NOT MEASURED)
```

⛔ **Measuring is why five rows were measured at all.** M15 and M17 came back GREEN on every project
— survivors, protecting nothing — and four of the five predictions were wrong in at least one cell.
The two survivors were closed with new tests rather than re-labelled.

⚑ **`279` is why the distinction is not pedantry**: its table predicted `dom 1 red` for M3 and the
machine said GREEN, because dropping a description left the argument hint and the browser assertion
still passed. A figure written from reasoning claims coverage the suite may not have.

**Baselines, taken on the unmutated tree: `runtime` 1,495 · `desktop` 3,061 · `dom` 824.**
(`scripts` 291 and `shared` 3, both untouched by every row here.)
No row touches a file the `scripts` or `shared` projects execute, so both are expected GREEN
throughout; `mutations.py --files` is how that is checked rather than believed.

**All 17 anchors are verified present exactly once** (`mutations.py --dry-run .`).
"""

from pathlib import Path

VOCAB = "packages/runtime/src/child-conversation.ts"
CODEX = "packages/runtime/src/codex/codex-runtime.ts"
HOST = "apps/desktop/src/main/runtime/runtime-host.ts"
IPC = "apps/desktop/src/main/runtime/ipc.ts"
VIEWER = "apps/desktop/src/renderer/src/components/ChildWorkViewer.vue"
PANE = "apps/desktop/src/renderer/src/components/ConversationPane.vue"
STORE = "apps/desktop/src/renderer/src/lib/session-store.ts"

# The adapter's refusal, with enough of its neighbourhood to be unique in the file — the host holds
# an almost identical pair of lines, which is the point of both of them.
CODEX_REFUSAL = """    const state = await this.childState(childId)
    const refusal = childInputRefusal(state)
    if (refusal !== null) return { ok: false, reason: refusal, state }"""

HOST_REFUSAL = """    const refusal = childInputRefusal(state)
    if (refusal !== null) return { ok: false, reason: refusal, state }
    try {"""

ADDRESSABLE = """    props.onReadState !== undefined &&
    props.onSend !== undefined,"""

CAN_SEND = """    childState.value?.ok === true &&
    refusalOf(childState.value) === null &&
    draft.value.trim().length > 0,"""

CHILD_INPUT_PARAMS = """          threadId: childId,
          // The same shape `turnStartParams` writes — `text_elements` is required by the wire even
          // when there is nothing to put in it.
          input: [{ type: 'text', text, text_elements: [] }],"""

MUTATIONS = [
    # ── the ruling ────────────────────────────────────────────────────────────
    (
        "M1 · 🔴 THE DEFECT the measurement exists to prevent · the adapter stops refusing, so a "
        "message to a WORKING child reaches the app-server — where 295 measured it joining the turn "
        "already running, completing it early, and leaving that turn's `sleep 20` alive 7.667s past "
        "its own reported completion "
        "· MEASURED: runtime 3 red of 1495, desktop GREEN, dom GREEN",
        [(CODEX, CODEX_REFUSAL, "    const state = await this.childState(childId)")],
    ),
    (
        "M2 · ⛔ the HOST's copy of the same refusal goes · the adapter still refuses, so nothing "
        "reaches the provider — but the round trip is made and the word a person sees now comes from "
        "the far side of the wire instead of the near one (169 §1: one rule, two call sites) "
        "· EXPECTED (NOT MEASURED): desktop 2 red of 3061, runtime GREEN, dom GREEN",
        [
            (
                HOST,
                HOST_REFUSAL,
                "    try {",
            )
        ],
    ),
    (
        "M3 · ⛔ an unrecognised provider status reads as IDLE · a `ThreadStatus` this app has never "
        "seen opens the composer instead of keeping it shut, which is the wrong way to be wrong "
        "about a thread we cannot describe "
        "· EXPECTED (NOT MEASURED): runtime 2 red of 1495, desktop GREEN, dom GREEN",
        [(VOCAB, "  return 'error'\n}", "  void tag\n  return 'idle'\n}")],
    ),
    (
        "M4 · ⛔ `null` is treated as `false` · the vendored type documents the null as *the "
        "capability is unavailable*, not *this child refuses*; collapsing them makes an unloaded "
        "thread read as a refusing one and shuts the composer on a child that would have listened "
        "· EXPECTED (NOT MEASURED): runtime 1 red of 1495, desktop GREEN, dom GREEN",
        [
            (
                VOCAB,
                "  if (state.acceptsInput === false) return 'not-accepting'",
                "  if (state.acceptsInput !== true) return 'not-accepting'",
            )
        ],
    ),
    # ── the boundary ──────────────────────────────────────────────────────────
    (
        "M5 · 🔴 ownership is no longer checked at all · a window this conversation was never given "
        "to can ask about its children and speak to them — 203's rule, and the ordering defect this "
        "dispatch actually shipped in draft before `window-authority.test.ts` found it "
        "· EXPECTED (NOT MEASURED): desktop 3 red of 3061, runtime GREEN, dom GREEN",
        [(HOST, "    if (slot) this.assertMayControl(slot, by)", "    void slot")],
    ),
    (
        "M6 · ⛔ the child's turn is re-pinned from THIS session's settings · `turn/start` gains an "
        "effort the parent chose, which silently reconfigures somebody else's agent mid-conversation "
        "— the two non-optional fields are the whole payload for a reason "
        "· EXPECTED (NOT MEASURED): runtime 1 red of 1495, desktop GREEN, dom GREEN",
        [
            (
                CODEX,
                CHILD_INPUT_PARAMS,
                "          threadId: childId,\n"
                "          effort: 'high',\n"
                "          input: [{ type: 'text', text, text_elements: [] }],",
            )
        ],
    ),
    (
        "M7 · ⛔ a malformed `thread/read` becomes an IDLE child · a response this app could not "
        "parse opens the composer, which is 279 §2's rule one level down — an invented answer on "
        "exactly the traffic we understood least "
        "· EXPECTED (NOT MEASURED): runtime 2 red of 1495, desktop GREEN, dom GREEN",
        [
            (
                CODEX,
                "    if (!isRecord(thread)) return CHILD_STATE_UNKNOWN",
                "    if (!isRecord(thread))\n"
                "      return { status: 'idle', acceptsInput: true, nickname: null, turns: null }",
            )
        ],
    ),
    # ── the composer ──────────────────────────────────────────────────────────
    (
        "M8 · ⛔ a composer is drawn with nothing to send through · `onSend` is no longer required, "
        "so a mount with no channel gets a box and a button that cannot do anything — the dead "
        "control 108's review found on the reading pane, rebuilt "
        "· MEASURED: desktop 1 red of 3061, dom GREEN, runtime GREEN — the table first PREDICTED `desktop 3 red, dom 1 red` and was wrong in both cells",
        [(VIEWER, ADDRESSABLE, "    props.onReadState !== undefined,")],
    ),
    (
        "M9 · 🔴 the button is live while the child works · `canSend` stops asking the refusal, so "
        "Enter and the mouse both reach a send the host will refuse — and 223's rule that a mount "
        "never promises a gesture it has switched off is broken in the visible direction "
        "· MEASURED: dom 1 red of 824, desktop GREEN, runtime GREEN — predicted `dom 2, desktop 1`",
        [
            (
                VIEWER,
                CAN_SEND,
                "    childState.value?.ok === true &&\n    draft.value.trim().length > 0,",
            )
        ],
    ),
    (
        "M10 · ⚠️ a refused message is thrown away · the draft clears whatever the answer was, so a "
        "person who typed a paragraph and was told *the child is still working* has lost it and has "
        "no way to know that is what happened "
        "· EXPECTED (NOT MEASURED): dom 1 red of 824, desktop GREEN, runtime GREEN",
        [(VIEWER, "    if (answer.ok) draft.value = ''", "    draft.value = ''")],
    ),
    (
        "M11 · ⛔ a blank message crosses the wire · `childMessage` loses the rule every other "
        "message on this wire is held to, so a send of spaces starts a real turn in a child's "
        "conversation (221 §1, and the census in `send-refusals.test.ts` counts the constraint) "
        "· EXPECTED (NOT MEASURED): desktop 3 red of 3061, runtime GREEN, dom GREEN",
        [
            (
                IPC,
                "const childMessage = z.string().refine((text) => hasSomethingToSend(text, 0), NOTHING_TO_SEND)",
                "const childMessage = z.string()",
            )
        ],
    ),
    (
        "M12 · ⛔ a message to a child is answered during a QUIT · the one verb in this pair that "
        "starts work is exempted from the shutdown door, so a closing app opens a turn in a "
        "conversation it is in the middle of abandoning (273 §1) "
        "· EXPECTED (NOT MEASURED): desktop 1 red of 3061, runtime GREEN, dom GREEN",
        [(IPC, "  sendToChild: 'refused',", "  sendToChild: 'answered',")],
    ),
    # ── the follow ────────────────────────────────────────────────────────────
    (
        "M13 · ⛔ the follow's interval is never cleared · a closed viewer goes on reading a file and "
        "asking a provider for ever, once per two seconds per viewer ever opened — the leak class "
        "253 was dispatched for "
        "· EXPECTED (NOT MEASURED): dom 1 red of 824, desktop GREEN, runtime GREEN",
        [(VIEWER, "  if (following !== undefined) clearInterval(following)", "  void following")],
    ),
    (
        "M14 · ⚠️ the state poll never latches · a refusal that cannot change while a window is open "
        "— `unsupported`, `not-live`, `unknown-agent` — is re-asked every two seconds for the life "
        "of the viewer, which is a request that cannot produce news "
        "· EXPECTED (NOT MEASURED): dom 1 red of 824, desktop GREEN, runtime GREEN",
        [
            (
                VIEWER,
                "          if (!answer.ok && answer.reason !== 'unreachable') keepAsking.value = false",
                "          void answer",
            )
        ],
    ),
    (
        "M15 · ⛔ a stale refresh is assigned · the pane stops checking that the conversation and the "
        "child are still the ones it read for, so switching conversation mid-poll puts one child's "
        "transcript under another's heading (067's guard, on a path that runs every two seconds) "
        "· MEASURED: dom 1 red of 824, desktop GREEN, runtime GREEN. ⛔ It measured GREEN EVERYWHERE first — a SURVIVOR protecting nothing — and `child-talk.dom.test.ts`'s late-refresh test was written to close that, not the prediction softened to match",
        [
            (
                PANE,
                "  if (!still || still.sessionId !== open.sessionId || still.agentId !== open.agentId) return",
                "  if (!still) return",
            )
        ],
    ),
    (
        "M16 · ⛔ a follow that has hit the ceiling says nothing · past `MAX_CHILD_WORK_BYTES` the "
        "screen stops changing while the child does not, and without this line a frozen view reads "
        "exactly like a finished child "
        "· EXPECTED (NOT MEASURED): desktop 2 red of 3061, dom GREEN, runtime GREEN",
        [
            (
                VIEWER,
                "    props.result.part === 'transcript' &&\n    props.result.truncated,\n)",
                "    props.result.part === 'transcript' &&\n    false,\n)",
            )
        ],
    ),
    (
        "M17 · ⚠️ a failed state read is reported as the LEDGER's refusal · a channel that threw "
        "becomes `unknown-agent`, which blames this session's record for a broken bridge and sends a "
        "reader looking for a child that had been lost "
        "· MEASURED: desktop 1 red of 3061, dom GREEN, runtime GREEN. ⛔ A SURVIVOR too on the first pass; `session-store.test.ts`'s new block is what kills it",
        [
            (
                STORE,
                "        return await bridge.readChildState({ sessionId, agentId })\n"
                "      } catch {\n"
                "        return { ok: false, reason: 'unreachable' }",
                "        return await bridge.readChildState({ sessionId, agentId })\n"
                "      } catch {\n"
                "        return { ok: false, reason: 'unknown-agent' }",
            )
        ],
    ),
]


def apply(root: Path, index: int, dry: bool = False) -> int:
    """Apply row `index` under `root`. Returns the number of anchors that did not resolve."""
    name, edits = MUTATIONS[index]
    bad = 0
    for rel, find, replace in edits:
        path = root / rel
        if not path.exists():
            print(f"!! {name}: {rel} does not exist")
            bad += 1
            continue
        text = path.read_text()
        hits = text.count(find)
        if hits != 1:
            print(f"!! {name}: anchor found {hits} times in {rel} (expected exactly 1)")
            bad += 1
            continue
        # ⛔ **A replacement equal to its original records as SURVIVED and proves nothing** — the
        # phantom survivor 252 found, and 268 §2 found one that had reached a committed table.
        # Checked here rather than by eye, on every row, every run.
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
        edits = sum(len(edits) for _name, edits in MUTATIONS)
        for index in range(len(MUTATIONS)):
            bad += apply(root, index, dry=True)
        print(f"{len(MUTATIONS) - bad}/{len(MUTATIONS)} rows apply exactly once ({edits} edit anchors)")
        return 1 if bad else 0
    root = Path(args[0]).resolve()
    return apply(root, int(args[1]), dry=False)


if __name__ == "__main__":
    raise SystemExit(main())
