#!/usr/bin/env python3
"""205's mutation table — each row is THE DEFECT, put back verbatim (131).

⛔ **195 H3's remainder, as it shipped until this commit.** 203 built the live count and the kind;
what was missing was the surface that answers *"which of my agents needs me"* without opening six
rows. `RuntimeScreen` mounts `ConversationPane` only for `activeId`, so a pending request was not
rendered anywhere else in the window — and the PM measured the cost on his own machine: one session
frozen on a permission for **63 seconds** while work happened in another.

The rows fall into five groups:

  * `M1`-`M4`   the projection itself — the six facts, and the gate that makes it affordable.
  * `M5`-`M8`   the disclosure: whole, and honest about being short (071, 181).
  * `M9`-`M12`  the order, which is a choice and not a default (§3).
  * `M13`-`M17` the decisions on offer, and the four shapes that must NOT get a one-click answer.
  * `M18`-`M22` the surface: the live badge, the wired queue, and answering the row you pressed.

## ⛔ What this table cannot reach, stated because a table silent about its edges is claiming them

  * ⛔ **The 63 seconds.** Nothing here waits. Every age in this table is a number handed to a pure
    function or a fixed `now` handed to a component; the only instrument that measures a real freeze
    is `smoke:ui` step 71, and even that asserts the age is SHOWN rather than that it is right.
  * ⛔ **Six, twelve and thirty.** The table runs against two and three conversations. §3's answer
    is an argument from the code's own shape — the gate is `pending`, the walk is per WAITING
    conversation — and a row cannot kill an argument. What a row CAN kill is the gate, and `M4` is it.
  * **The owner check itself.** 203 owns that, and its table already has the rows. `M22` kills the
    half 203's tests could not see: an overview that answered the ACTIVE conversation instead of the
    row's would pass every owner check in that file while being completely wrong.
  * **A real second window.** Same limit 203 recorded: two `RecordingSink`s in one process, and no
    row here can say that a real `WebContents` id is stable across a reload.
  * **What a person actually reads.** `M1`-`M17` kill assertions about objects; `M18`-`M21` kill
    assertions about painted rows at 1200px in a real Chromium. Neither can say the surface is
    legible at thirty rows — 031's rule is a judgement, and the PM's eyes are the instrument.
  * **The ticking clock.** `RuntimeScreen`'s one-second interval is not reachable from any project
    here: it lives in a component nothing mounts in a test, and a row that removed it would be green.
    ⚑ Named rather than counted — see the response doc's §3.

⚠️ **Anchors are taken from the FORMATTED source** — 147's M12 came back `DID NOT APPLY` because
`prettier --write` had reflowed the string it was anchored on. These were taken after `format` ran.

⛔ **Do not apply these by hand** — `mutate.sh` owns the tree, takes 196's repository-global lock,
and restores from a pristine copy keyed by FULL relative path.

## ⚑ `446` corrected two anchors in place — same defects, same kills

⛔ **`M2` and `M4` moved because a THIRD kind of card a person must answer arrived.** `441` shipped a
proposal with its own door, `446` put it in this queue, and both of these rows anchor on the lines
that decide which conversations get walked: the item guard is now three-way and the O(1) gate sums
three counters. ⚑ **Neither DEFECT changed** — one restores *list everything open*, the other
deletes the gate — and both were applied alone and watched go RED against
`apps/desktop/test/attention-queue.test.ts`.

"""

from __future__ import annotations

import sys

LIB = "apps/desktop/src/renderer/src/lib/attention.ts"
QUEUE = "apps/desktop/src/renderer/src/components/AttentionQueue.vue"
HOME = "apps/desktop/src/renderer/src/components/HomeSurface.vue"
RAIL = "apps/desktop/src/renderer/src/components/SideRail.vue"

MUTATIONS = [
    # ------------------------------------------------------------------ the projection
    (
        "M1 · ⛔ THE DEFECT, verbatim · nothing is projected at all — the queue is empty however many "
        "conversations are frozen, which is the app as 195 H3 found it",
        [(LIB, "  const queue: AttentionRequest[] = []\n  for (const record of records) {", "  const queue: AttentionRequest[] = []\n  for (const record of [] as readonly SessionRecord[]) {")],
    ),
    (
        "M2 · it lists every OPEN conversation rather than the ones that need you — a dashboard that "
        "is always full is a dashboard nobody reads (031)",
                # ⚑ **Re-anchored by `446`**, which added a third kind of card a person must
                # answer and made this guard three-way. ⛔ The DEFECT is unchanged: the awaiting
                # check is what keeps the overview to what needs you rather than to everything open.
        # ⚑ Landing D-016a (bd70d693) · re-anchored in place, not retired — The rule (the attention
        # queue lists the conversations that need the person, not every open one, via
        # `isAwaitingAnswer`) survives; D-016 only removed the `proposal` kind, so the old
        # multi-line kind check collapsed to a two-kind one-liner. The corrected plant deletes the
        # `isAwaitingAnswer` line, so a settled card stays listed.
        [
            (LIB, "      if (item.kind !== 'permission' && item.kind !== 'userInput') continue\n      if (!isAwaitingAnswer(item)) continue\n", "      if (item.kind !== 'permission' && item.kind !== 'userInput') continue\n"),
        ],
    ),
    (
        "M3 · the row names the SESSION ID rather than the folder, so six rows read as six uuids",
        [
            (
                LIB,
                # ⚑ **470 · the rule moved to `session-record.whereItWorks` and only the FALLBACK
                # stayed here** — three surfaces wrote `basenameOf(record.meta?.cwd ?? '')` out in
                # full and each was pinned by its own row, so a change to the rule went red in one
                # place and stayed silent in the other two. ⛔ M3's defect is unchanged: the row
                # names the session id instead of the folder.
                "    const where = whereItWorks(record) ?? record.sessionId\n",
                "    const where = record.sessionId\n",
            )
        ],
    ),
    (
        "M4 · ⛔ the O(1) gate is gone, so every open conversation's `items` is walked on every "
        "render — 099's defect, in the surface built after it",
                # ⚑ **Re-anchored by `446`**, which added the third counter to the same gate.
                # ⚠️ **Two lines since `446`**, because the third counter took the expression past
                # the print width and prettier wrapped it — the anchor follows the file.
        # ⚑ Landing D-016a (bd70d693) · re-anchored in place, not retired — The O(1) gate over
        # `state.pending` still exists in `attentionQueue`; D-016 only removed
        # `state.pending.proposals` from the sum, so the anchor lost its wrapped `=== 0)\n continue`
        # form. The corrected plant removes the whole one-line gate, so every open conversation's
        # items are walked again.
        [
            (LIB, '    if (state.pending.permissions + state.pending.questions === 0) continue\n', ''),
        ],
    ),
    # ------------------------------------------------------------------ the disclosure
    (
        "M5 · ⛔ the scope is not disclosed at all — the row says what is asked and never what "
        "approving it authorizes (071, from 069 finding 1)",
        [
            (
                LIB,
                "          scope: permissionScopeLines(item.request.detail, scope),\n",
                "          scope: [],\n",
            )
        ],
    ),
    (
        "M6 · the provider's one-sentence summary REPLACES the disclosure instead of standing beside "
        "it — the older shape, which disclosed less than the truncation did",
        [
            (
                LIB,
                "  const lines: string[] = []\n  if (detail !== '') lines.push(detail)\n",
                "  const lines: string[] = []\n",
            )
        ],
    ),
    (
        "M7 · ⛔ `underDisclosed` is dropped, so a request BroBot cannot fully represent is shown as "
        "though the scope on screen were the whole of it (181)",
        [(LIB, "          underDisclosed: scope.underDisclosed,\n", "          underDisclosed: false,\n")],
    ),
    (
        "M8 · …and the bound is dropped with it: the disclosure is short and nothing says by how much",
        [
            (
                LIB,
                "          detailOmitted: item.request.detailOmitted ?? null,\n",
                "          detailOmitted: null,\n",
            )
        ],
    ),
    # ------------------------------------------------------------------ the order
    (
        "M9 · ⛔ the age is invented where there is none — `?? 0` on a card the fold had no clock "
        "for, which reads as the oldest thing on the screen (086, in a comparator)",
        [(LIB, "        at: item.at ?? null,\n", "        at: item.at ?? 0,\n")],
    ),
    (
        "M10 · a clockless card sorts FIRST rather than last, so an unknown age outranks a measured one",
        [
            (
                LIB,
                "    if (a.at === null) return 1\n    if (b.at === null) return -1\n",
                "    if (a.at === null) return -1\n    if (b.at === null) return 1\n",
            )
        ],
    ),
    (
        "M11 · newest first — the freshest request at the top and the 63-second freeze at the bottom",
        [(LIB, "    return a.at - b.at\n", "    return b.at - a.at\n")],
    ),
    (
        "M12 · the order is whatever the records arrived in, which is the order you happened to open "
        "them — not a fact about urgency",
        [(LIB, "  return queue.sort(byUrgency)\n", "  return queue\n")],
    ),
    # ------------------------------------------------------------------ the decisions
    (
        "M13 · ⛔ no decision is offered at all — 195 H3's *\"or an answer control\"*, put back",
        [
            (
                LIB,
                "          decisions: offer.row.map((outcome) => ({\n",
                "          decisions: [].map((outcome: never) => ({\n",
            )
        ],
    ),
    (
        "M14 · every outcome is offered rather than the ones the request accepts — a button the "
        "provider never said it would take",
        [
            (
                LIB,
                "          decisions: offer.row.map((outcome) => ({\n",
                "          decisions: (Object.keys(OUTCOME_LABEL) as PermissionDecision['outcome'][]).map((outcome) => ({\n",
            )
        ],
    ),
    (
        "M15 · ⛔ a MULTI-SELECT question gets one-click options, so one click sends one answer to a "
        "question that asked for several and calls it the answer",
        [(LIB, "  if (only.multiSelect === true) return 'multi-select'\n", "")],
    ),
    (
        "M16 · …and a SECRET one does too, so the provider's sensitive answer goes on a dashboard",
        [(LIB, "  if (only.secret === true) return 'secret'\n", "")],
    ),
    (
        "M17 · ⛔ Reject disappears from a question this surface cannot answer, so a row that can do "
        "nothing at all is offered — which is `106`'s defect exactly",
        [(LIB, "            : [REJECT],\n", "            : [],\n")],
    ),
    # ------------------------------------------------------------------ the surface
    (
        # The seeded Home surface, project count and badge are gone. There is no remaining element
        # for this defect to target, so keep the absent anchor recorded as retired.
        "M18 · ⛔ THE HOME BADGE, back on the fixture · the rail counts the demo seed's projects "
        "again, on a button whose own chip says \"soon\" (205 §1, the lie it replaced)",
        [
            (
                RAIL,
                "const homeCount = computed(() => props.needsYou)\n",
                "const homeCount = computed(() => activeProjects(props.projects).length)\n",
            )
        ],
    ),
    (
        "M19 · the header stat counts the seed again, so *\"Needs you\"* names something other than "
        "the list under it",
        # ⚠️ **Anchor corrected in 305 §1, not retired.** The row's defect is unchanged — a summary
        # that counts something other than what the screen lists — but `decisions`/`quiet` are gone:
        # every sentence Home makes now comes from `homeAttention(...)`, over BOTH populations.
        # Emptying the seeded half is the same mutation, and it reproduces exactly what `304` read.
        [
            (
                HOME,
                "  homeAttention({ requests: props.needsYou, attention: props.attention }),\n",
                "  homeAttention({ requests: props.needsYou, attention: [] }),\n",
            )
        ],
    ),
    (
        "M20 · the queue claims to be a placeholder, so a real permission is drawn beside a chip that "
        "says nothing here is wired",
        [(QUEUE, '<div class="attention-live" data-wired="true"', '<div class="attention-live" data-wired="false"')],
    ),
    (
        "M21 · ⛔ the good state is an empty box — no rows and nothing saying why, which reads as a "
        "surface that failed to load (037's rule)",
        [
            (
                QUEUE,
                '    <div v-else class="attention-clear" :class="{ inline: !props.alone }" data-cy="attention-clear">',
                '    <div v-else-if="false" class="attention-clear" :class="{ inline: !props.alone }" data-cy="attention-clear">',
            )
        ],
    ),
    (
        "M22 · ⛔ THE ROW'S OWN CONVERSATION, lost · the click carries the FIRST request in the queue "
        "instead of the one that was pressed — every owner check in 203 passes, and the wrong agent "
        "is answered",
        [
            (
                QUEUE,
                '            @click="emit(\'decide\', request, decision)"\n',
                '            @click="emit(\'decide\', props.requests[0]!, decision)"\n',
            )
        ],
    ),
]


def apply(root, index: int, dry: bool) -> int:
    name, edits = MUTATIONS[index]
    bad = 0
    for rel, find, replace in edits:
        path = root / rel
        text = path.read_text()
        hits = text.count(find)
        if hits != 1:
            print(
                f"!! {name}: anchor found {hits} times in {rel} (expected exactly 1)",
                file=sys.stderr,
            )
            bad += 1
            continue
        if not dry:
            path.write_text(text.replace(find, replace, 1))
    return 1 if bad else 0


def main() -> int:
    from pathlib import Path

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
