#!/usr/bin/env python3
"""278's mutation table — each row is THE DEFECT, put back verbatim (131).

⛔ **The finding is the person's, and `276` measured what the fix may not be.** BroBot sent a message he
never typed: pressing *Start work on this plan* published `Go ahead with this plan.` as a plain
`user_turn`, under his name, with the user avatar beside it. The obvious repair — stop sending the
sentence — was measured against the real bundled Codex `0.146.0` app-server, `gpt-5.6-luna` low, a
fresh isolated provider home per trial:

```
A  switch alone, send nothing, wait 10 s   0/2 turns   0/2 files    ← the switch does not wake a model
B  switch + the message (today's button)   2/2 turns   2/2 files, byte-exact
C  the message alone, plan mode still on   5/5 turns   acted 3/5; 2/5 waited for plan mode to end
```

⚑ **So the message does two jobs the mode request cannot**: it starts the next turn — which is the
boundary on which `{mode:'default'}` actually reaches Codex — and it is a semantic instruction in its
own right. `278` therefore changes the AUTHORSHIP and nothing else, and half the rows below exist to
kill a build that "fixed" this by removing the send.

## The row groups

 * `M1`-`M3`   🔴 **the mark** — the host publishes a plain `user_turn` again; the fold routes an
                app-authored turn back into the bubble; the mark is put on EVERY turn, which is the
                same lie pointed the other way.
 * `M4`-`M6`   🔴 **the message must still go** — the button emits no text, the constant is emptied,
                and the Leave button gains a message it must never carry (085's defect).
 * `M7`-`M9`   ⚠️ **what the entry says** — it signs itself "You" again, it drops the explanation,
                and it stops being drawn in the reading view.
 * `M10`-`M11` ⚑ **the two instruments either side of it** — the turn counter 096's scope axis reads,
                and the raw stream's one word for three provenances.
 * `M12`       ⛔ **an expected SURVIVOR, and it is the most useful row here** — see below.

## ⛔ `M12` is expected to survive, and that is a statement about the harness rather than the code

The row narrows `UserTurnEvent.attribution` back to `'provider_transcript'`. Every producer and
consumer of the wider type then fails to compile — and **nothing in the four vitest projects can see
that**, because a type is not executed. `pnpm run typecheck` is the instrument that kills it and the
harness does not run one. ⚠️ **This is `268 §1`'s lesson in the mirror**: that dispatch retired a RED
produced by a text census because the mutant could not compile; this row is a mutant that DOES break
compilation and produces no red at all. Recorded as an expected survivor rather than dropped, because
a table that only carries rows it can kill is a table that has stopped measuring its own edges.

## ⛔ What this table cannot reach, stated because a table silent about its edges is claiming them

 * ⚠️ **No row reaches `276`'s measurement.** A/B/C needed the real Codex app-server; nothing here
   can prove that removing the sentence stops the model working, only that the app stops sending it.
   `M4`-`M6` are the closest a unit test gets, and the honest limit is that they measure BroBot's
   half of the wire, not Codex's answer to it. ⛔ **This is exactly what §3 asked to be said out
   loud, and it is why the sentence in `plan-mode.ts` now carries the numbers.**
 * ⚠️ **No row mutates the §2 prose**, and that is deliberate. The comment that said *"the message is
   not the mechanism (the switch is)"* is corrected in place with `276`'s numbers; nothing executes a
   comment, so a row over it could only ever be killed by a source census — and `268 §1` ruled that a
   RED produced only by a text census is non-evidentiary. An honest absence beats a row that reds for
   the wrong reason.
 * ⚠️ **No row reaches Claude.** `276` corrected the record: Claude's planning ends at the model's own
   `ExitPlanMode` card, `planNeedsGoAhead` is `false` there and `setPlanMode(false)` rejects
   (`claude-runtime.ts:1451-1479,1536-1567`), so this whole gesture is Codex-only. The `runtime`
   project is expected GREEN on every row — `278` touches no package file.

## ⚑ ALL TWELVE rows measured by hand, by ordinary edits to the working tree

`278` §3 says *"Write, do not run."* So `mutations.txt` does not exist at this HEAD and its absence is
the honest state — `238`'s lesson is that a row can sit green beside prose insisting it must die.
What WAS done is putting every one of the twelve defects into the tree by hand and running both
projects that can move, WHOLE — an ordinary edit, no harness, no tree lock, restored from a pristine
copy after each. **Baselines: `desktop` 2,996 · `dom` 788.** `runtime` and `scripts` were not run
per row: `278` touches no file in either, which the `--files` list makes checkable.

```
                                                    desktop        dom
M1   the host publishes a plain user_turn           3 red          GREEN
M2   the fold routes it back into the bubble        4 red          1 red
M3   the mark is put on EVERY turn                  6 red          GREEN
M4   the button sends nothing (276's shape A)       GREEN          1 red
M5   the message constant is emptied                3 red          1 red
M6   Leave gains the go-ahead's message             GREEN          1 red
M7   the entry signs itself "You"                   GREEN          1 red
M8   the explanation is dropped                     1 red          1 red
M9   the entry is hidden in the reading view        3 red          1 red
M10  the continuation stops opening a turn          1 red          GREEN
M11  the raw stream conflates the provenances       1 red          GREEN
M12  the wire type narrows                          GREEN          GREEN   ← expected, see above
```

⛔ **`M4` is the row `278` §3 asked about by name**, and the answer is that it CAN go red in a unit
test — but only because this dispatch wrote the test that reads it. Nothing before it measured what
the button EMITS: `plan-go-ahead.render.test.ts` proves the control is drawn, disabled at the right
moments and worded honestly, and every one of those assertions is satisfied by a build that emits
`endPlanMode()` with no message. ⚠️ **What no unit test can reach is 276's other half** — that Codex
then does nothing. This kills a build that stops SENDING; only a live provider can measure what the
sentence is worth once it arrives.

⛔ **`M5` is the row that teaches the most.** Emptying `GO_AHEAD_MESSAGE` leaves every assertion that
compares a render against the constant TRUE — `toContain('')` is true of every string — so the tests
written *against the constant* are blind to it by construction. ⚑ **It dies anyway, and on the two
assertions that do not read the constant as a value**: the one that pins the LITERAL
(`expect(GO_AHEAD_MESSAGE).toBe('Go ahead with this plan.')`) and, in `dom`, the paired NEGATIVE
`expect(bubble.textContent).not.toContain(GO_AHEAD_MESSAGE)` — which an empty constant turns false
for every string on the page. ⚠️ **A test written against a constant cannot measure that constant**,
which is `268 §3`'s coupling lesson arriving somewhere new; the two rows that survive it are the two
that broke the coupling.
"""

from pathlib import Path

HOST = "apps/desktop/src/main/runtime/runtime-host.ts"
WIRE = "apps/desktop/src/shared/runtime-ipc.ts"
FOLD = "apps/desktop/src/renderer/src/lib/transcript.ts"
MODE = "apps/desktop/src/renderer/src/lib/transcript-mode.ts"
COPY = "apps/desktop/src/renderer/src/lib/plan-mode.ts"
RAW = "apps/desktop/src/renderer/src/lib/describe-event.ts"
PANE = "apps/desktop/src/renderer/src/components/ConversationPane.vue"
ENTRY = "apps/desktop/src/renderer/src/components/ContinuationEntry.vue"

# ⚠️ **Corrected at `406`, not retired.** That dispatch put a THIRD arm in front of this one — a
# turn carrying `work` is a work report and never the go-ahead's entry — so the two-arm anchor
# stopped applying. ⛔ The DEFECT below is unchanged and is now wider: it puts BOTH app-authored
# kinds back into the person's bubble. `correct-a-stale-mutation-anchor-dont-retire-it`, and this
# table is `unrun`, so no verdict is inherited.
# ⚠️ **RE-POINTED at 413, not retired** — a third arm was added between the two that were here
# (`correct-a-stale-mutation-anchor-dont-retire-it`). The row's subject is unchanged: the fold
# ignores every mark and draws the user's bubble.
# ⚑ **RE-POINTED again at 545**, same rule and same subject: the relayed arm gained the relayer's
# identity and wrapped onto two lines.
# ⚑ **RE-POINTED again at 624** — a FOURTH arm, `appNotice`, went in between the relayed one and
# the go-ahead's. ⛔ Same rule, same subject, and the row is WIDER again: it now puts all three
# app-authored kinds back into the person's bubble. ⚠️ The table is still `unrun`, so no verdict
# is inherited (`a-corrected-anchor-keeps-a-verdict-it-never-earned`).
FOLD_BRANCH = """      if (isAWorkReport(event.work)) appendWorkReport(state, event.text, event.work)
      else if (wasRelayed(event.relayedFrom))
        appendRelayedTurn(state, event.text, relayerIdentity(event.relayedFromProfile))
      else if (isAppNotice(event.appNotice)) appendAppNotice(state, event.text, event.appNotice)
      else if (event.attribution === 'app_authored') appendAppTurn(state, event.text)
      else appendUserMessage(state, event.text, event.attribution, event.attachments)"""

APP_TURN_BODY = """  state.items.push({ kind: 'continuation', id: nextId(state, 'continuation'), text })
  state.changes.turn += 1"""

SEND_PUBLISH = """      type: 'user_turn',
      text,
      // Spread rather than assigned, so an ordinary turn carries no such key at all — the same rule"""

# ⚠️ **Corrected at `406`, not retired** — that dispatch put the task id on this line when a turn
# carries one. ⛔ The DEFECT is unchanged: the raw stream prints one word for three provenances.
# ⚠️ **RE-POINTED at 413, not retired** — the arm gained a branch for a relayed turn, whose words
# are another conversation's rather than BroBot's. The row still collapses every provenance to one
# word in the surface a debugger trusts most.
# ⚑ **678 · re-anchored and the ROW is unchanged** — the line gained the task a turn OPENED (`671`
# G2, `opened task_…`) between the work and the provenance; the row still collapses the provenance.
RAW_ARM = """      return `${event.text.length} chars${event.work === undefined ? '' : ` \u00b7 ${event.work.taskId}`}${
        event.taskId === undefined ? '' : ` \u00b7 opened ${event.taskId}`
      } ${
        event.attribution === 'provider_transcript'
          ? '(per the transcript)'
          : event.relayedFrom !== undefined
            ? `(relayed from ${event.relayedFrom}${relayer(event.relayedFromProfile)})`
            : event.attribution === 'app_authored'
              ? '(BroBot wrote it)'
              : '(ours)'
      }`"""

MUTATIONS = [
    # ── the mark ────────────────────────────────────────────────────────────────────────────────
    (
        "M1 · 🔴 THE DEFECT, verbatim · the host publishes the go-ahead as a plain `user_turn` "
        "again — the message the person never typed, in his own name · MEASURED: desktop 3 red of 2996",
        [
            (
                HOST,
                # ⚑ **W4.493 · re-anchored in place, not retired** — Source-only, NOT VERIFIED. The go-ahead still publishes an app-authored turn; retain the same missing-authorship mutant while preserving its new handoff identity. No plant or table run. Held: running it needs W4 written lift.
                "this.publishOurs(\n      session,\n      { type: 'user_turn', text, attribution: 'app_authored' },\n      undefined,\n      moveHandoff,\n    )",
                "this.publishOurs(\n      session,\n      { type: 'user_turn', text },\n      undefined,\n      moveHandoff,\n    )",
            )
        ],
    ),
    (
        "M2 · 🔴 the fold ignores the mark · the event says BroBot wrote it and the transcript draws "
        "the user's bubble anyway — the half a wire-only fix leaves behind "
        "· MEASURED: desktop 4 red of 2996, dom 1 red of 788",
                # ⚑ ANCHOR CORRECTED IN PLACE BY 688: the relayed turn's call now also hands `says` (`687` H1) and wrapped; the row's defect is unchanged.
        # ⚑ Landing D-016a (bd70d693) · re-anchored in place, not retired — The rule (the fold reads
        # the mark: an app-authored, relayed, work-report or notice `user_turn` must not be drawn as
        # the user's bubble) is untouched by D-016a. The old anchor is stale only because an earlier
        # commit renamed the notice guard `isAppNotice` to `carriesANotice`, and I verified the
        # corrected multi-line anchor occurs exactly once in `transcript.ts`. The plant collapses
        # the whole chain into `appendUserMessage`, with `as undefined` keeping the plant
        # type-correct since `attribution` can now be 'app_authored'.
        [
            # ⚑ **a turn that carries on after a repaired sign-in · re-anchored in place, not retired** — the fold has one more arm above the app-authored one, for a turn that carries on after a repaired sign-in; the row's defect is unchanged
            # ⚑ **source-restoration · re-anchored in place, not retired** — NOT VERIFIED; source targeting only. The turn dispatch now carries relay navigation too; still bypass authorship/subject selection and append a user message.
            (FOLD, "      if (isAWorkReport(event.work))\n        appendWorkReport(\n          state,\n          event.text,\n          event.work,\n          wasRelayed(event.relayedFrom)\n            ? {\n                relayedFromProfile: relayerIdentity(event.relayedFromProfile),\n                relayedFrom: event.relayedFrom,\n              }\n            : null,\n        )\n      else if (wasRelayed(event.relayedFrom))\n        appendRelayedTurn(\n          state,\n          event.text,\n          relayerIdentity(event.relayedFromProfile),\n          // ⚑ **688 · what the sender said it is** — see {@link RelayedItem.says}.\n          isAgentMessageKind(event.says) ? event.says : undefined,\n          event.relayedFrom,\n        )\n      else if (carriesANotice(event.appNotice)) appendAppNotice(state, event.text, event.appNotice)\n      // ⚑ A turn that carries on after a repaired sign-in hands over no words, so there is nothing\n      // to draw: the reopen above it says what happened. It still opens a turn.\n      else if (event.carriesOn === true) state.changes.turn += 1\n      else if (event.attribution === 'app_authored') appendAppTurn(state, event.text)\n      else appendUserMessage(state, event.text, event.attribution, event.attachments)\n", "      appendUserMessage(state, event.text, event.attribution as undefined, event.attachments)\n"),
        ],
    ),
    (
        "M3 · ⚠️ the mark is put on EVERY turn · the transcript stops lying in one direction and "
        "starts lying in the other, and no assertion about the go-ahead alone could tell "
        "· MEASURED: desktop 6 red of 2996",
        [
            (
                HOST,
                SEND_PUBLISH,
                "      type: 'user_turn',\n      text,\n      attribution: 'app_authored' as const,\n      // Spread rather than assigned, so an ordinary turn carries no such key at all — the same rule",
            )
        ],
    ),
    # ── the message must still go ───────────────────────────────────────────────────────────────
    (
        "M4 · 🔴 the button sends NOTHING · the mode change alone, which is 276's shape A — measured "
        "at 0/2 turns and 0/2 files against real Codex · MEASURED: dom 1 red of 788, desktop GREEN",
        [
            (
                PANE,
                "@click=\"emit('endPlanMode', goAheadMessage)\"",
                "@click=\"emit('endPlanMode')\"",
            )
        ],
    ),
    (
        "M5 · ⛔ the message is emptied at its source · every assertion that compares a render "
        "against the constant stays TRUE, so only the row that pins the LITERAL can see it "
        "· MEASURED: desktop 3 red of 2996, dom 1 red of 788 — on the two assertions that do NOT "
        "read the constant as a value; see the module docstring",
        [(COPY, "export const GO_AHEAD_MESSAGE = 'Go ahead with this plan.'", "export const GO_AHEAD_MESSAGE = ''")],
    ),
    (
        "M6 · ⛔ Leave gains the go-ahead's message · 085's defect exactly — walking away from a plan "
        "tells the agent to carry it out · MEASURED: dom 1 red of 788, desktop GREEN",
        [
            (
                PANE,
                "@click=\"emit('endPlanMode')\"",
                "@click=\"emit('endPlanMode', goAheadMessage)\"",
            )
        ],
    ),
    # ── what the entry says ─────────────────────────────────────────────────────────────────────
    (
        "M7 · 🔴 the entry signs itself \"You\" again · the whole defect, surviving inside its own "
        "fix, in the one line where it would be easiest to reintroduce · MEASURED: dom 1 red of 788",
        [
            (
                ENTRY,
                '<strong data-cy="continuation-sender">{{ GO_AHEAD_SENDER }}</strong>',
                '<strong data-cy="continuation-sender">You</strong>',
            )
        ],
    ),
    (
        "M8 · ⚠️ the explanation is dropped · the words are shown and nothing says why they are "
        "there, which is the causality 276 argued must survive a reload "
        "· MEASURED: desktop 1 red of 2996, dom 1 red of 788",
        [
            (
                ENTRY,
                '      <p class="why" data-cy="continuation-why">{{ GO_AHEAD_AUTHORSHIP }}</p>\n',
                "",
            )
        ],
    ),
    (
        "M9 · ⚠️ the entry is lifecycle chrome · hidden in the reading view, so a reader meets a turn "
        "of work with no visible cause · MEASURED: desktop 3 red of 2996, dom 1 red of 788",
        [
            (
                MODE,
                "    case 'continuation':\n      return true",
                "    case 'continuation':\n      return mode === 'debug'",
            )
        ],
    ),
    # ── the instruments either side ─────────────────────────────────────────────────────────────
    (
        "M10 · ⚑ the continuation stops opening a turn · 096's scope axis puts every change this "
        "turn produces in the PREVIOUS turn's scope, silently attributing work to the wrong prompt "
        "· MEASURED: desktop 1 red of 2996",
        [(FOLD, APP_TURN_BODY, "  state.items.push({ kind: 'continuation', id: nextId(state, 'continuation'), text })")],
    ),
    (
        "M11 · ⛔ the raw stream prints one word for three provenances · `(ours)` for a sentence "
        "BroBot wrote, in the surface a debugger trusts most · MEASURED: desktop 1 red of 2996",
        # describe-event still labels an app_authored user_turn as BroBot-written. Narrow this
        # mutation to that label rather than replacing the whole return, which also carries piece
        # and relay facts. The authorship and final-question tests cover the surviving rule.
        [
            # ⚑ **W4.428 · re-anchored in place, not retired** — the window's words now name the product BroCrew, or say "This app" for the app's own acts; the row plants the same defect in the renamed text.
            (RAW, "            : event.attribution === 'app_authored'\n              ? '(This app wrote it)'\n              : '(ours)'\n", "            : '(ours)'\n"),
        ],
    ),
    # ── the edge this table cannot kill ─────────────────────────────────────────────────────────
    (
        "M12 · ⚠️ EXPECTED SURVIVOR · the wire type narrows back and every producer stops compiling "
        "— which no vitest project can see, because a type is not executed. `pnpm run typecheck` is "
        "the instrument; the harness does not run one. 268 §1's lesson in the mirror "
        "· MEASURED: GREEN in desktop AND dom, as expected",
        [
            (
                WIRE,
                "  attribution?: 'provider_transcript' | 'app_authored'",
                "  attribution?: 'provider_transcript'",
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
