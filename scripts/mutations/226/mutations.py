#!/usr/bin/env python3
"""226's mutation table — each row is THE DEFECT, put back verbatim (131).

⛔ **The explorer asked Codex for two children named `alpha` and `beta` and got two cards reading
`nested agent`** — no name, no parent, no usage, no outcome (`225` finding 1). ⚠️ **226 §1 refused
to let anyone guess which way that pointed**, and the measurement came first: `pnpm run
probe:two-children`, against the pinned binary, with a control turn that spawns nothing.

**What the wire said**, on a session that produced five real children:

  * a depth-1 birth carries `agentPath: /root/alpha` and its dispatching call — so those cards were
    never the ones the explorer saw;
  * a depth-2 birth carries `agentPath: /root/coordinator/gamma` and ITS dispatching call, and
    arrives here stamped with the depth-1 child's `threadId`;
  * every child sends `turn/started`, its own item lifecycle, `thread/tokenUsage/updated`, and a
    `turn/completed` whose `turn.status` is the generated `TurnStatus` union with `durationMs`.

⛔ **All of it was being discarded by this session's own thread gate** (200), which refuses a frame
naming another thread before anything reads it. Three sentences hardened in this repo — 135's *"a
connection this app does not hold"*, 033's *"an ending carries NO outcome"*, 111's *"a Codex child
reports no usage"* — were each true of the instrument that measured them and false on the wire.

The rows fall into four groups:

  * `M1`-`M4`   **the door.** It is MEMBERSHIP, not a method list: only a thread this session
    already holds a card for is read. `M1` opens it to any thread — which would let another
    conversation's frames write onto our surface, and is the one way this dispatch could have been
    a hole in 200 rather than a correction to it.
  * `M5`-`M7`   **the descendant's birth**, which is 225's actual finding: reading it at all, the
    registration without which the child's own `active` re-opens it as an anonymous `observed` card
    — the exact face the explorer reported — and the `item/started`-only rule 033 paid for.
  * `M8`-`M15`  **what a child reports about itself**: the outcome from the provider's own union,
    fail-closed for `inProgress`; the duration; `total` rather than `last`; the tool count on
    COMPLETION rather than on start; and a reading with no number in it staying silent instead of
    writing a zero over a real one.
  * `M20`-`M30` ⛔ **everything an adversarial pass over this dispatch's OWN diff found**, and it is
    the largest group for a reason: five reviewers read the change before it was committed and
    between them they found a security defect, a 075 ordering violation, three vacuous assertions
    and a hole in the very step this dispatch edited. Each row is one of those defects put back:
    a door that reads a thread nothing announced (`M21`); a card the parent's turn already closed
    going on to speak (`M22`, `M23`); a birth naming OUR OWN thread, which would grow a sub-agent
    card of the conversation itself (`M24`); progress after an ending (`M25`); a negative rendered
    as a measurement (`M26`); a per-turn duration beside lifetime totals (`M27`); `working` written
    by something other than the status stream (`M28`); a grandchild's usage read as its parent's
    (`M29`); and step 17's naming exemption, which after 226 waves through exactly the regression it
    was written to catch (`M30`).
  * `M16`-`M19` **the accounting and the two surfaces this touched.** `adopted` is a subset of
    `dropped` and never a deduction from it — the equality `probe:foreign-thread` checks against an
    independent tee depends on that. Then §3's summary, and step `17`'s assertion, which used to
    assert the silence §1 disproves and would now throw on a healthy run.

## ⛔ What this table cannot reach, stated because a table silent about its edges is claiming them

  * ⛔ **A real child.** Every runtime row is killed by a handle-level test over a FAKE transport
    replaying the measured frame order. That a real Codex child's name reaches a real card is
    `BROBOT_SMOKE_ONLY=17` and `pnpm run probe:two-children`, and only those.
  * ⛔ **The `scripts` row proves SHAPE, not behaviour.** Nothing in `pnpm run ci` can drive a live
    app, so step `17`'s corrected vocabulary is checked by reading the file as text.
  * ⚠️ **`desktop` is in the run and no row mutates it.** `SubAgentEntry.vue`'s changes are comments
    — three of them corrections of claims the measurement refuted — and a project that stays GREEN
    on every row is the honest way to say a comment carries no behaviour.
  * ⛔ **`descendant`'s item-type filter has NO ROW, and it is not an oversight.** A row disarming
    it was written, dry-run, and then removed: `subAgentBirth` already refuses an item with no
    `agentThreadId` and no `subAgentActivity` `kind`, so the filter is defence in depth over a check
    that gets there first and nothing could tell it was gone. ⚑ **224's `M8`/`M33` are why this is
    said out loud** — both survived their first run for exactly this shape, and the honest move is to
    name the redundancy rather than to ship a row that certifies itself.
"""

from pathlib import Path

SUBAGENTS = "packages/runtime/src/codex/sub-agents.ts"
RUNTIME = "packages/runtime/src/codex/codex-runtime.ts"
RAIL = "apps/desktop/src/renderer/src/components/SideRail.vue"
SMOKE = "scripts/ui-live-smoke.mjs"

# (name, [(file, old, new), ...])
MUTATIONS = [
    # ---- the door: membership, not method -----------------------------------------------------
    (
        "M1 · ⛔ THE HOLE · the report path stops asking whether this thread is OURS, so any "
        "conversation on the connection can write a card onto this one — 226 as a hole in 200 "
        "rather than a correction to it",
        [
            (
                SUBAGENTS,
                "    if (!child || !child.announced || child.sealed) return []",
                "    if (!child) return []",
            )
        ],
    ),
    (
        "M2 · the gate never calls the reader at all — every frame a child sends about itself is "
        "refused unread, which is the state 225 reported and 226 measured the cause of",
        [
            (
                RUNTIME,
                "      const reports = this.subAgents.report(method, params)",
                "      const reports = []",
            )
        ],
    ),
    (
        "M3 · a method nobody wrote a branch for is read as something — the switch stops falling "
        "through to nothing, so an unrecognised frame becomes a card event",
        [
            (
                SUBAGENTS,
                "      default:\n        return []\n    }\n  }",
                "      default:\n        return [{ type: 'sub_agent', agentId, phase: 'progress' }]\n    }\n  }",
            )
        ],
    ),
    (
        "M4 · the report is read from the frame's own `agentId` field instead of the `threadId` "
        "the provider actually keys these on — a lookup that can never hit, failing silently",
        [
            (
                SUBAGENTS,
                "    const agentId = readString(params, 'threadId')\n    const child = this.children.get(agentId)",
                "    const agentId = readString(params, 'agentId')\n    const child = this.children.get(agentId)",
            )
        ],
    ),
    # ---- the descendant's birth — 225's finding ------------------------------------------------
    (
        "M5 · ⛔ THE DEFECT · a descendant's birth is not read, so a depth-2 agent is known only by "
        "going active and draws as `nested agent` with no name and no parent — 225 finding 1, "
        "verbatim",
        [
            (
                SUBAGENTS,
                "        return child.ended ? [] : this.descendant(agentId, params)",
                "        return []",
            )
        ],
    ),
    (
        "M6 · the birth is not REGISTERED as it is emitted, so the grandchild's own `active` finds "
        "no entry and `observe` opens a second, anonymous card beside the named one",
        [(SUBAGENTS, "    this.note(born)\n    return [born]", "    return [born]")],
    ),
    (
        "M7 · `item/completed` announces the birth a second time — the byte-identical item 033 was "
        "dispatched over, so every grandchild arrives twice",
        [
            (
                SUBAGENTS,
                "        return child.ended ? [] : tools(agentId, child, params)",
                "        return child.ended ? [] : [...this.descendant(agentId, params), ...tools(agentId, child, params)]",
            )
        ],
    ),
    # ---- what a child reports about itself ------------------------------------------------------
    (
        "M8 · ⛔ THE DEFECT · a child's `turn/completed` is not read, so its ending carries no "
        "outcome — the `ENDED · usage not reported` face 225 saw, and 033's sentence back",
        [
            (
                SUBAGENTS,
                "        return this.finished(agentId, child, params)",
                "        return []",
            )
        ],
    ),
    (
        "M9 · every child ending is reported as a SUCCESS — the fail-closed mapping 055 built for "
        "the parent's own turn is swapped for the happy reading, so a failed child says completed",
        [
            (
                SUBAGENTS,
                "        outcome: codexTurnOutcome(params).outcome,",
                "        outcome: 'completed',",
            )
        ],
    ),
    (
        "M10 · the outcome is reported once per FRAME rather than once per turn, so a provider "
        "that repeats `turn/completed` ends the same card again and again",
        [(SUBAGENTS, "    if (child.outcomeFor === turnId) return []", "    if (false) return []")],
    ),
    (
        "M11 · the duration is read off the notification instead of out of its `turn`, so a child "
        "that ran for seven seconds reports no time at all",
        [
            (
                SUBAGENTS,
                "    const ms = readCount(turn, 'durationMs')",
                "    const ms = readCount(params, 'durationMs')",
            )
        ],
    ),
    (
        "M12 · ⛔ the card reports the child's LAST request instead of its whole spend — "
        "`mergeUsage` keeps the larger of what it has, so the number shown becomes whichever single "
        "request happened to be biggest",
        [
            (
                SUBAGENTS,
                "  const total = readCount(readField(readField(params, 'tokenUsage'), 'total'), 'totalTokens')",
                "  const total = readCount(readField(readField(params, 'tokenUsage'), 'last'), 'totalTokens')",
            )
        ],
    ),
    (
        "M13 · a reading with no number in it writes a zero — `0k tokens` over a real measurement, "
        "which is the fabricated blank 111 built `usage not reported` to avoid",
        [(SUBAGENTS, "  if (total === undefined) return []", "  if (false) return []")],
    ),
    (
        "M14 · the tool count moves when a call STARTS — work the child has begun reported as work "
        "it has done, which is 074's reading one surface over",
        [
            (
                SUBAGENTS,
                "        return child.ended ? [] : this.descendant(agentId, params)\n      case 'item/completed':\n        return child.ended ? [] : tools(agentId, child, params)",
                "        return child.ended ? [] : [...this.descendant(agentId, params), ...tools(agentId, child, params)]\n      case 'item/completed':\n        return []",
            )
        ],
    ),
    (
        "M15 · everything a child does counts as a tool call — its own prose and its reasoning "
        "included, so the card reports a number that is not a measurement of anything",
        [(SUBAGENTS, "  if (!isCodexToolItem(type)) return []", "  if (false) return []")],
    ),
    # ---- the accounting, and the two surfaces -----------------------------------------------------
    (
        "M16 · `adopted` becomes a DEDUCTION from `dropped` rather than a subset of it — the "
        "equality `probe:foreign-thread` checks against an independent tee stops holding, and the "
        "only thing keeping that counter honest would have to be relaxed to accommodate this change",
        [
            (
                RUNTIME,
                "      this.countForeignDrop(method)\n      // ⛔ **Counted as a drop first",
                "      // ⛔ **Counted as a drop first",
            ),
            (
                RUNTIME,
                "      if (reports.length > 0) this.frameScopeAdopted += 1",
                "      if (reports.length === 0) this.countForeignDrop(method)\n      else this.frameScopeAdopted += 1",
            ),
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-017b, 3af91dcb):** Deleted on purpose. `closedOpen` and
        # the collapsed 'N closed threads hidden' summary (`v-if="!closedOpen"`) were removed from
        # SideRail.vue, and no `v-show` remains in that block. D-017b: 'One Conversations list in
        # the rail and the palette, each row with the shared state: no open / closed / kept-open
        # split.' There is no collapsed closed group to hide. Its anchor is left stale, so the
        # census records it retired.
        "M17 · ⛔ 226 §3 · the rail's collapsed summary is hidden rather than removed, so the "
        "sentence `N closed threads hidden` stays in the document while the rows are on screen — "
        "225 finding 2, which is exactly what a script reading the DOM sees",
        [(RAIL, '          v-if="!closedOpen"', '          v-show="!closedOpen"')],
    ),
    (
        "M18 · ⛔ step 17 asserts the silence §1 disproved — a Codex child that names how it ended "
        "reds the step on a healthy run, which is the measured-false claim turned into a gate",
        [
            (
                SMOKE,
                "        if (!['unreported', 'interrupted', 'completed', 'failed'].includes(status)) {",
                "        if (!['unreported', 'interrupted'].includes(status)) {",
            )
        ],
    ),
    (
        "M19 · the outcome and usage claims are computed and never reach the verdict — 206 H1's "
        "whole subject: a claim that lives in the step and not in the headline",
        [
            (
                SMOKE,
                "        collabClaim,\n        outcomeClaim,\n        usageClaim,",
                "        collabClaim,",
            )
        ],
    ),
    (
        "M20 · ⛔ a child's SECOND turn can never report how it went — the outcome is refused for "
        "every turn after the first, so a resumed child's ending is silently discarded",
        [
            (
                SUBAGENTS,
                "    if (child.outcomeFor === turnId) return []\n    if (child.turnId !== null && turnId !== child.turnId) return []",
                "    if (child.outcomeFor !== null) return []",
            )
        ],
    ),
    (
        "M21 · ⛔ THE HOLE · a thread nothing ANNOUNCED is read like a child — `observe` fails open "
        "by design, so any thread that ever went active would hand this conversation its token "
        "totals, its tool counts, its outcome and the births it announces",
        [(SUBAGENTS, "if (!child || !child.announced || child.sealed)", "if (!child || child.sealed)")],
    ),
    (
        "M22 · ⛔ 075 · a card the PARENT turn already closed goes on speaking — its own "
        "`turn/completed` lands after the terminal turn, and a late token reading puts it back in "
        "`open` to be closed a second time on the next turn",
        [(SUBAGENTS, "if (!child || !child.announced || child.sealed)", "if (!child || !child.announced)")],
    ),
    (
        "M23 · the boundary closes the card and does not SEAL it, which is the same hole reached "
        "from the other side — `note` leaves the tracker able to speak about a card `deliver` just "
        "closed",
        [(RUNTIME, "        this.subAgents.seal(closing)", "        this.subAgents.note(closing)")],
    ),
    (
        "M24 · ⛔ a birth may name OUR OWN thread — the one door that writes an id it did not read "
        "from `threadId`, so the session grows a sub-agent card of itself that progresses whenever "
        "it works and ends whenever it goes idle",
        [
            (
                SUBAGENTS,
                "    if (!own || born.agentId === own || born.agentId === announcer) return []",
                "    if (!own) return []",
            )
        ],
    ),
    (
        "M25 · a card that has ENDED goes on making progress — `status` has refused this since 033 "
        "and the two new progress paths must, or an event about a closed card re-opens it",
        [
            (
                SUBAGENTS,
                "        return child.ended ? [] : tokens(agentId, params)",
                "        return tokens(agentId, params)",
            )
        ],
    ),
    (
        "M26 · a negative number is rendered as a measurement — the usage schema has no lower bound, "
        "so `durationMs: -1` validates, survives `mergeUsage` and draws as a negative duration "
        "instead of falling back to the honest blank",
        [(SUBAGENTS, "Number.isFinite(field) && field >= 0", "Number.isFinite(field)")],
    ),
    (
        "M27 · the duration is this TURN's rather than the child's whole life, beside tokens and "
        "tool counts that are lifetime totals — `mergeUsage` keeps the max, so the card reports "
        "everything it ever spent in the time of whichever single turn was longest",
        [
            (
                SUBAGENTS,
                "    if (ms !== undefined) child.ms += ms\n    return [",
                "    if (ms !== undefined) child.ms = ms\n    return [",
            )
        ],
    ),
    (
        "M28 · `finished` writes `working`, which only the status stream may write — after a "
        "`turn/completed` a REPEATED `active` then reads as a fresh transition, emitting a spurious "
        "progress and re-arming everything behind it",
        [
            (
                SUBAGENTS,
                "    child.outcomeFor = turnId\n    child.ended = true",
                "    child.outcomeFor = turnId\n    child.ended = true\n    child.working = false",
            )
        ],
    ),
    (
        "M29 · the snapshot reads a card's usage with a bare descendant query, so a grandchild's "
        "number is reported as its parent's — 035's hazard, on the field 226 added",
        [
            (
                SMOKE,
                "      usage: mine(el, '[data-cy=subagent-usage]')?.textContent.trim() ?? null,",
                "      usage: el.querySelector('[data-cy=subagent-usage]')?.textContent.trim() ?? null,",
            )
        ],
    ),
    (
        "M30 · ⛔ step 17's naming check EXEMPTS a card that says its parent was never reported — "
        "after 226 that card is the regression, so the exemption waves through exactly what it was "
        "written to catch",
        [
            (
                SMOKE,
                "      const nested = cards.filter((c) => c.parentUnknown)\n      if (nested.length > 0) {",
                "      const nested = cards.filter((c) => c.parentUnknown)\n      if (false) {",
            )
        ],
    ),
]


def apply(root, index: int, dry: bool) -> int:
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
