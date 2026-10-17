"""299 · The second button — what the suite would notice if each finding came back.

# The findings this table exists to protect

⛔ **Five seams, and only the first one costs CONSENT.** `297` found the wholesale session grant
drawn as the second button on the Home overview — the slot a `Write` card gives to *"Allow for this
conversation"* — with one shared `data-cy` and `.deny` as the only style variant. A person who has
learned that the second button means *this conversation* presses it on a `Bash` card and grants any
Bash command for the session. The other four cost a roster, a scroll position, a follow, or a file
count.

⚑ **Every one of them is a rule that WAS held, by one consumer of a fact and not by its sibling.**
That is what makes them all deletable without a compile error: `PermissionCard` filtered and
`attention.ts` did not, `SessionDrawer` keyed and `ConversationPane` did not, three registries got a
carry and `changes` did not, four event families got a producer bound and `workflow_run` did not.

# The groups

* **M1-M5 · the consent rule.** The composition that keeps the wholesale grant out of the row, the
  order that makes the second button mean one thing, and the sentence that says where the grant went
  instead.
* **M6-M7 · the bound `workflow_run` never had.** The truncation, and the schema ceiling that has to
  be 201 for the truncation to survive its own boundary.
* **M8-M11 · paging back.** The anchor that must measure the inserted height rather than the net
  one, the ordinal that makes that possible, and the follow a page-back gesture releases.
* **M12 · the key.** The one attribute that stops conversation B inheriting A's released follow.
* **M13-M18 · the change log across a release.** The carry, the ordinal filter that keeps it from
  doubling, the turn base, the id counter, and the cap that must not be silent.

# ⚠️ What this table cannot reach

⛔ **The provider's own behaviour.** No row makes a real `Bash` card arrive with a wholesale grant in
it; `fake-runtime.ts`'s `OPAQUE_OFFER` stands in for that, and `claude-runtime.test.ts:4272` is what
pins the real adapter. A row that deletes the composition reddens because this repo asserts the
composition.

⛔ **The 4b ordering.** `useStickToBottom.release` removes a race between two writers of one
property; the row that deletes it (M11) reddens on a live message arriving after a page-back, which
is what the release actually changes. **Nothing here reddens on the disorder itself**, and §3 of the
response says why: `stuck` is true only while the reader is at the bottom, so the two writers agree
wherever both can run.

⛔ **`smoke/` and `scripts/ui-live-smoke.mjs` are executed by no vitest project** (277's `NO-ROWS.md`,
241 M10, 275 M28). Nothing here touches them.

# ⛔ NOT MEASURED

**FOUR rows were measured and fourteen were not**, and the labels say which is which rather than
presenting reasoning as a figure. `299` §4 says *"Write, do not run"*, and the machine is under load
~220 from `290`'s batch — so the four rows whose fixes this dispatch actually wrote were applied by
hand against **the files that cover them**, and the rest are left for `mutate.sh` on an idle machine.

⚠️ **A targeted measurement is not a project measurement, and the labels say so.** `M1`'s cell reads
`desktop 3 red (targeted: wide-grant.render + attention-answer)`. It means those two files were run
with the row applied and three tests died; it does **not** claim the whole 3,061-test project was
run. ⛔ Reading it as a project figure would be exactly the over-claim `279` M3 made in the other
direction.

```
M1  M8  M11  M12       MEASURED (targeted files, tree restored + hash-checked)
M2 … M7, M9, M10, M13 … M18   EXPECTED (NOT MEASURED)
```

**Baselines, taken on the unmutated tree: `runtime` 1,498 · `desktop` 3,083 · `dom` 833.**
(`scripts` 291 and `shared` 3, both untouched by every row here.)
No row touches a file the `scripts` or `shared` projects execute, so both are expected GREEN
throughout; `mutations.py --files` is how that is checked rather than believed.

**All anchors are verified present exactly once** (`mutations.py --dry-run .`).
"""

from pathlib import Path

OFFER = "apps/desktop/src/renderer/src/lib/permission-offer.ts"
ATT = "apps/desktop/src/renderer/src/lib/attention.ts"
CARD = "apps/desktop/src/renderer/src/components/PermissionCard.vue"
QUEUE = "apps/desktop/src/renderer/src/components/AttentionQueue.vue"
NORM = "packages/runtime/src/claude/normalize.ts"
WORKFLOW = "packages/runtime/src/workflow-run.ts"
OLDER = "apps/desktop/src/renderer/src/composables/useOlderHistory.ts"
STICK = "apps/desktop/src/renderer/src/composables/useStickToBottom.ts"
VIEW = "apps/desktop/src/renderer/src/components/TranscriptView.vue"
PANE = "apps/desktop/src/renderer/src/components/ConversationPane.vue"
WINDOW = "apps/desktop/src/renderer/src/lib/transcript-window.ts"
TRANSCRIPT = "apps/desktop/src/renderer/src/lib/transcript.ts"

# The overview's own call, with enough of its neighbourhood to be unique: the card makes an almost
# identical one, which is the entire point of both of them.
OVERVIEW_ROW = """          decisions: offer.row.map((outcome) => ({
            kind: 'permission' as const,"""

# ⚑ 695 · anchor corrected in place: the card's call gained the request's marks (R36), the subject —
# the card asking `permissionOffer` rather than deciding for itself — unchanged. Re-verified RED
# alone with `verify_row.py 299 M2 --killer wide-grant.render.test.ts` (4 of 12 red).
CARD_OFFER = """const offer = computed(() =>
  // ⚑ 695 · R36 — the request itself carries the provider's two marks, and the offer reads them.
  permissionOffer(scope.value.availableDecisions, props.item.request.action, props.item.request),
)"""

ANCHOR_CHOICE = """      after.scrollTop =
        anchor !== null && moved !== null
          ? anchorAfterShift(before.scrollTop, contentTop(after, moved) - anchor.top)
          : anchorAfterPrepend(before, after.scrollHeight)"""

CARRY_CALL = "    changes: carryChanges(state.changes, retained),"

CARRY_FILTER = """  const older =
    from === undefined
      ? log.reports.filter((report) => report.ordinal !== undefined)
      : log.reports.filter((report) => report.ordinal !== undefined && report.ordinal < from)"""

MUTATIONS = [
    # ── the consent rule ──────────────────────────────────────────────────────
    (
        "M1 · 🔴 THE CONSENT DEFECT · the overview maps every offered outcome positionally again, so "
        "on a Bash card the second button — the slot a Write card gives to `allow_for_session` — is "
        "the WHOLESALE grant, in the same row, with the same class and the same `data-cy` "
        "· MEASURED: desktop 3 red (targeted: wide-grant.render + attention-answer), "
        "runtime GREEN, dom GREEN",
        [
            (
                ATT,
                OVERVIEW_ROW,
                "          decisions: scope.availableDecisions.map((outcome) => ({\n"
                "            kind: 'permission' as const,",
            )
        ],
    ),
    (
        "M2 · ⛔ the CARD goes back to deciding for itself · `permissionOffer` still exists and the "
        "overview still calls it, but the card filters its own row again — which is the state the "
        "codebase was in, and the state in which one consumer can be right forever while the other "
        "is wrong (238's two implementations of one fold) "
        "· EXPECTED (NOT MEASURED): desktop 2 red of 3083, runtime GREEN, dom GREEN",
        [
            (
                CARD,
                CARD_OFFER,
                "const offer = computed(() => ({\n"
                "  row: (['allow', 'allow_for_session', 'deny', 'cancel'] as PermissionOutcome[]).filter(\n"
                "    (outcome) => scope.value.availableDecisions.includes(outcome),\n"
                "  ),\n"
                "  wide: null,\n"
                "  primary: 'allows' as const,\n"
                "}))",
            )
        ],
    ),
    (
        "M3 · ⛔ the wholesale grant becomes an ordinary row member · one line in the placement table, "
        "and every surface that draws a row draws it as a peer — the defect re-created at its source "
        "rather than at either consumer "
        "· EXPECTED (NOT MEASURED): desktop 4 red of 3083, runtime GREEN, dom GREEN",
        [(OFFER, "  [WIDE]: 'apart',", "  [WIDE]: 4,")],
    ),
    (
        "M4 · ⛔ the provider's ORDER is kept instead of ours · the row is whatever the adapter's own "
        "filter produced, so the second button means one thing on one card and another on the next — "
        "which is the finding with the wide grant left out of it "
        "· EXPECTED (NOT MEASURED): desktop 1 red of 3083, runtime GREEN, dom GREEN",
        [
            (
                OFFER,
                "    .sort((a, b) => (PLACE[a] as number) - (PLACE[b] as number))",
                "    .sort((a, b) => available.indexOf(a) - available.indexOf(b))",
            )
        ],
    ),
    (
        "M5 · ⛔ the row stops SAYING where the grant went · the composition is still right and the "
        "relief 058 exists to give simply disappears from the surface without a word — 106 from the "
        "other side, and the reason a filter alone was not the fix "
        "· EXPECTED (NOT MEASURED): desktop 2 red of 3083, runtime GREEN, dom GREEN",
        # ⚑ ANCHOR CORRECTED IN PLACE BY 730 — R80: the sentence is handed the request's marks, so an
        # MCP tool call says where ITS grant went; the call no longer fits one line, and the mutation
        # still blanks the sentence to `null` whatever the request is. Verified RED alone by 730 with
        # `--killer wide-grant.render.test.ts` (the label names no killer).
        # ⚑ ANCHOR CORRECTED IN PLACE BY 743 — `739` F-1, ruled by the PM: the row no longer SAYS
        # where the grant is, it OFFERS it (after the row, under the card's warning). The subject is
        # unchanged — the relief 058 exists to give disappears from the row without a word — so the
        # mutation drops the offered grant instead of blanking the sentence. Killed by
        # `wide-grant.render.test.ts`.
        [
            (
                ATT,
                "        if (wide !== null) queue.at(-1)?.decisions.push(wide)\n",
                "",
            )
        ],
    ),
    # ── the bound workflow_run never had ──────────────────────────────────────
    (
        "M6 · 🔴 the agent LABEL loses its bound again · a fan-out that passes each item as its "
        "agent's label sends whatever the author wrote, the event fails `runtimeEventSchema` at "
        "`toWireEvent`, and `degradeEvent` replaces the whole frame with `unknown` — the roster "
        "deleted rather than the label shortened, permanently, in the ledger and every resume "
        "· EXPECTED (NOT MEASURED): runtime 1 red of 1495, desktop GREEN, dom GREEN",
        [
            (
                NORM,
                "      label: truncate(readString(entry, 'label') || agentId),",
                "      label: readString(entry, 'label') || agentId,",
            )
        ],
    ),
    (
        "M7 · ⛔ the schema ceiling goes back to 200 · the normalizer still truncates and every string "
        "it actually shortens is 201 characters long, so the bound now rejects precisely the frames "
        "it was written to save — the trap `MAX_BACKGROUND_TEXT` documents, sprung on the fifth family "
        "· EXPECTED (NOT MEASURED): runtime 2 red of 1495, desktop GREEN, dom GREEN",
        [(WORKFLOW, "export const MAX_WORKFLOW_TEXT = 201", "export const MAX_WORKFLOW_TEXT = 200")],
    ),
    # ── paging back ───────────────────────────────────────────────────────────
    (
        "M8 · 🔴 the anchor is fed a NET height again · `prependPage` inserts A at the top and deletes "
        "R at the bottom in one patch, so `afterHeight − beforeHeight` is ≈ 0 and the reader is moved "
        "nowhere while a page slides down beneath them — landing back inside the 400px fetch band, "
        "which fetches again, one quadratic re-fold per page "
        "· MEASURED: dom 2 red (targeted: older-history.dom), runtime GREEN, desktop GREEN",
        [
            (
                OLDER,
                ANCHOR_CHOICE,
                "      after.scrollTop = anchorAfterPrepend(before, after.scrollHeight)\n"
                "      void moved",
            )
        ],
    ),
    (
        "M9 · ⛔ the anchor is remembered by ITEM ID · a prepend re-folds and a fresh fold renumbers "
        "every row, so the id names a different row on the far side of the very gesture it was "
        "remembered across — the reason `data-ordinal` exists at all "
        "· EXPECTED (NOT MEASURED): dom 2 red of 833, runtime GREEN, desktop GREEN",
        [
            (
                OLDER,
                "    const row = node.querySelector<HTMLElement>('.entry[data-ordinal]')\n"
                "    const ordinal = row?.dataset['ordinal']",
                "    const row = node.querySelector<HTMLElement>('.entry[data-item]')\n"
                "    const ordinal = row?.dataset['item']",
            )
        ],
    ),
    (
        "M10 · ⛔ the rows stop carrying their ledger ordinal · the anchor finds nothing to key on and "
        "falls back to the arithmetic the finding is about, silently — a fallback that is right for "
        "the case it was written for and wrong for every case that reaches it this way "
        "· EXPECTED (NOT MEASURED): dom 2 red of 833, desktop 1 red of 3083, runtime GREEN",
        # ⚑ **Anchor corrected at `587`, subject unmoved.** `587` folded the list into rows, so the ordinal is written on TWO wrappers — the
        # item's and the run's. ⛔ **Both go, or the row would leave one anchor alive and the
        # scroll anchor would still find something** — a mutation that applies by half is a green
        # that means nothing.
        # Re-verified RED by hand at the correction (`a-corrected-anchor-keeps-a-verdict-it-never-earned`).
        # ⚑ Re-anchored in place, NOT VERIFIED — a run's members now include finished thoughts, so
        # the run's wrapper reads its last MEMBER's ordinal; deleting it is the same defect.
        [
            (VIEW, '        :data-ordinal="row.item.ordinal"\n', ""),
            (VIEW, '        :data-ordinal="row.members[row.members.length - 1]?.ordinal"\n', ""),
        ],
    ),
    (
        "M11 · ⛔ asking for older messages no longer releases the follow · the next live message "
        "yanks a reader who has explicitly gone backwards to the newest line, which is the thing "
        "`useStickToBottom` exists to stop happening to somebody who is reading "
        "· MEASURED: dom 1 red (targeted: older-history.dom), runtime GREEN, desktop GREEN",
        [(OLDER, "    options.releaseFollow?.()", "    void options.releaseFollow")],
    ),
    # ── the key ───────────────────────────────────────────────────────────────
    (
        "M12 · 🔴 the transcript is unkeyed again · `RuntimeScreen` reuses the pane, so conversation B "
        "opens at A's pixel offset with A's released follow and stops following its own newest line — "
        "permission cards included — for the life of the mount "
        "· MEASURED: dom 1 red (targeted: events-across-conversations.dom), runtime GREEN, desktop GREEN",
        [
            (
                PANE,
                '        <TranscriptView\n          :key="props.record.sessionId"\n          ref="view"',
                '        <TranscriptView\n          ref="view"',
            )
        ],
    ),
    # ── the change log across a release ───────────────────────────────────────
    (
        "M13 · 🔴 the change log is dropped by a release again · a conversation long enough to roll "
        "its window loses every report, so the drawer's file count vanishes from the tab strip "
        "mid-conversation and the pane draws *nothing changed* about a conversation that "
        "demonstrably changed files "
        "· EXPECTED (NOT MEASURED): desktop 5 red of 3083, runtime GREEN, dom GREEN",
        [(WINDOW, CARRY_CALL, "    changes: { reports: [], turn: 0, seq: 0, dropped: 0 },")],
    ),
    (
        "M14 · ⛔ the carry stops filtering by ordinal · on the prepend path the retained run CONTAINS "
        "everything the carry was folded from, so every report is carried and rebuilt — one row per "
        "file becomes two, on every page back "
        "· EXPECTED (NOT MEASURED): desktop 2 red of 3083, runtime GREEN, dom GREEN",
        [(WINDOW, CARRY_FILTER, "  const older = [...log.reports]")],
    ),
    (
        "M15 · ⛔ the TURN base is carried whole · the suffix re-opens its own turns on top of a total "
        "that already counted them, so *This turn* moves past the rows that belong to it and an old "
        "report reads as work the agent did just now "
        "· EXPECTED (NOT MEASURED): desktop 1 red of 3083, runtime GREEN, dom GREEN",
        [(WINDOW, "    turn: Math.max(0, log.turn - reopened),", "    turn: log.turn,")],
    ),
    (
        "M16 · ⛔ `seq` restarts at zero across the carry · a carried `changes_3` and a freshly built "
        "`changes_3` are two different reports with one id, and `ChangeRow.bodyReportId` points at "
        "reports by exactly that string — so an expanded row opens somebody else's diff "
        "· EXPECTED (NOT MEASURED): desktop 1 red of 3083, runtime GREEN, dom GREEN",
        [(WINDOW, "    seq: log.seq,", "    seq: 0,")],
    ),
    (
        "M17 · ⛔ the cap becomes silent · the reports beyond the ceiling are still dropped and "
        "nothing counts them, so a pane holding a short list presents it as the whole conversation "
        "— 092's rule, and the one every other registry in this family keeps "
        "· EXPECTED (NOT MEASURED): desktop 2 red of 3083, dom 1 red of 833, runtime GREEN",
        [
            (
                WINDOW,
                "    dropped: log.dropped + (older.length - kept.length),",
                "    dropped: log.dropped,",
            )
        ],
    ),
    (
        "M18 · ⛔ `opensTurn` and the fold disagree · the predicate the carry counts with stops "
        "matching the branch that does the counting, which is the drift that makes a rule stated "
        "twice worth pinning at all "
        "· EXPECTED (NOT MEASURED): desktop 2 red of 3083, runtime GREEN, dom GREEN",
        [
            (
                TRANSCRIPT,
                "export function opensTurn(event: TranscriptEvent): boolean {\n"
                "  return event.type === 'user_turn'\n}",
                "export function opensTurn(event: TranscriptEvent): boolean {\n"
                "  return event.type === 'user_turn' || event.type === 'assistant_message'\n}",
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
