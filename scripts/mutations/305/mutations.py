"""305 · A screen that disagrees with itself — what the suite would notice if each finding came back.

# The findings this table exists to protect

⛔ **One BROKEN row and five drifts, and they are the same shape twice over.**

`304` opened the seeded app as a person and read all of this on one screen at one moment: two project
cards saying **2 need you**, four decision rows below them, and — in the header, in the **NEEDS YOU**
stat, and in the **Needs you now** panel — *"nothing needs you"*. Three authoritative summaries
disagreeing with the data the same screen was drawing.

⚑ **§1 is one boolean redefined under four consumers.** `205` gave Home a live queue and pointed
every summary at it, correctly; what it did not do is move the surfaces that still read the seed. So
`quiet` came to mean *"the live half is empty"* under sentences that claim the screen is. The fix is
`lib/home-attention.ts`: one function decides every count and every sentence, from BOTH populations.

⚑ **§2 is five surfaces with no field to read.** A card with no command field showed an elapsed time;
a recruiting sheet with no engine field showed the project; a stage with no digest field showed one
sentence; a project with no origin field showed its own short title; a document with no follow-up
field offered nothing. Each row below deletes the field's use, not the field.

# The groups

* **M1-M6 · one screen, one truth.** The total that counts both populations, the `quiet` that means
  the screen, the third sentence for the mixed state, the clear block that may only speak for a whole
  screen, the seeded group's presence in the panel, and the rail badge that counts what Home lists.
* **M7-M9 · the frozen agent's command.** The command block, the reason, and the decision's own verb.
* **M10-M11 · the stage.** The digest, and the documents it offers to open.
* **M12-M14 · provenance and the empty shell.** The origin, the header chip, the empty roster.
* **M15-M16 · the approval's model.** The role grid's fact and the target card's line.
* **M17-M18 · three ways to be empty.** The zero library and the excluding filter.
* **M19-M20 · the bridge.** The follow-up's presence, and that it carries the RIGHT document.

# ⚠️ What this table cannot reach

⛔ **The prototype.** Nothing here compares the app to `preview-1-final.html`; `302`/`304` are people
looking at both, and no row can stand in for that. What these rows hold is that the FIELDS the design
needs are read where the design draws them.

⛔ **The live smoke.** `scripts/ui-live-smoke.mjs` is executed by no vitest project (277's
`NO-ROWS.md`, 241 M10, 275 M28), and step 14's assertions were the instrument that CERTIFIED §1's
defect — it demanded `All clear` with four decision rows painted. That correction is real and no row
here can redden on it.

⛔ **The seed's own consistency.** `home-agrees.dom.test.ts`'s last case holds `needsYouTotal(PROJECTS)
=== ATTENTION.length` on the payload itself. No mutation below can break it, because the payload is
not a file any row touches — which is the point: it is an invariant of the DATA, not of the UI.

# ⛔ NOT MEASURED

**FIVE rows were measured and fifteen were not**, and the labels say which is which rather than
presenting reasoning as a figure. `305` §4 says *"Write, do not run"*, and the machine is under load
**~71** — so five rows were applied by hand against **the files that cover them**, the tree was
restored and hash-checked, and the rest are left for `mutate.sh` on an idle machine.

⚠️ **A targeted measurement is not a project measurement, and the labels say so.** `M1`'s cell reads
`desktop N red (targeted: home-attention.test)`. It means that file was run with the row applied and
N tests died; it does **not** claim the whole project was run. ⛔ Reading it as a project figure would
be the over-claim `279` M3 made in the other direction.

```
M1  M5  M12  M19  M20     MEASURED (targeted files, tree restored + hash-checked)
M2 … M4, M6 … M11, M13 … M18   EXPECTED (NOT MEASURED)
```

**Baselines, taken on the unmutated tree: `desktop` 3,126 · `dom` 858 · `runtime` 1,523 ·
`scripts` 291** (and `shared` 3 — 5,801 in all).
No row touches a file the `runtime`, `scripts` or `shared` projects execute, so all three are
expected GREEN throughout; `mutations.py --files` is how that is checked rather than believed.

**All anchors are verified present exactly once** (`mutations.py --dry-run .`), after prettier had
formatted the tree — a step `296` learned the hard way, because formatting moves anchors.
"""

from pathlib import Path

ATTN = "apps/desktop/src/renderer/src/lib/home-attention.ts"
HOME = "apps/desktop/src/renderer/src/components/HomeSurface.vue"
QUEUE = "apps/desktop/src/renderer/src/components/AttentionQueue.vue"
SCREEN = "apps/desktop/src/renderer/src/components/RuntimeScreen.vue"
WORK = "apps/desktop/src/renderer/src/components/ProjectWorkspace.vue"
RECRUIT = "apps/desktop/src/renderer/src/components/RecruitSheet.vue"
SHEET = "apps/desktop/src/renderer/src/components/AllDocumentsSheet.vue"
DRAWER = "apps/desktop/src/renderer/src/components/DocumentDrawer.vue"

# The mixed state's own sentence, with enough of its neighbours to be unique: all three arms of this
# ternary are strings this file is the only place to find.
MIXED_INTRO = """        : `No conversation is blocked on you. The ${seeded} project decision${
            seeded === 1 ? '' : 's'
          } below ${seeded === 1 ? 'is a' : 'are'} seeded placeholder${seeded === 1 ? '' : 's'}.`,"""

CLEAR_BLOCK = (
    '<div v-else class="attention-clear" :class="{ inline: !props.alone }" '
    'data-cy="attention-clear">\n      <template v-if="props.alone">'
)

MUTATIONS = [
    # ── §1 · one screen, one truth ────────────────────────────────────────────
    (
        "M1 · 🔴 THE DEFECT, verbatim · the screen's total counts only the LIVE half again, so with "
        "the demo seed loaded and nothing open the NEEDS YOU stat reads `All clear` over four "
        "decision rows the same screen is drawing, and the header calls the workspace quiet "
        "· MEASURED: desktop 5 red (targeted: home-attention.test), dom 2 red (targeted: "
        "home-agrees.dom)",
        [(ATTN, "  const total = live + seeded\n", "  const total = live\n")],
    ),
    (
        "M2 · ⛔ `quiet` goes back to meaning *the live queue is empty* rather than *the screen is* "
        "— the exact redefinition 205 made under four consumers, which is how three summaries came "
        "to contradict the cards beside them "
        "· EXPECTED (NOT MEASURED): desktop 4 red of 3,126, dom 4 red of 858",
        [(ATTN, "  const quiet = total === 0 && !unread\n", "  const quiet = live === 0 && !unread\n")],
    ),
    (
        "M3 · ⚠️ the MIXED state loses its own sentence · with nothing live and four seeded rows "
        "below it, the panel goes back to inviting an answer it cannot take, which is a control-room "
        "sentence over a placeholder list "
        "· EXPECTED (NOT MEASURED): desktop 1 red of 3,126, dom 2 red of 858",
        [
            (
                ATTN,
                MIXED_INTRO,
                "        : 'Answer here, or open the card for the full disclosure.',",
            )
        ],
    ),
    (
        "M4 · ⛔ the live half speaks for the WHOLE SCREEN again · `Nothing needs you.` and its check "
        "ring are drawn above a labelled group of four seeded project decisions — the block 304 read "
        "at the same moment as the four rows "
        "· EXPECTED (NOT MEASURED): desktop 1 red of 3,126, dom 2 red of 858",
        [
            (
                QUEUE,
                CLEAR_BLOCK,
                '<div v-else class="attention-clear" :class="{ inline: !props.alone }" '
                'data-cy="attention-clear">\n      <template v-if="true">',
            )
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-016a, bd70d693):** HomeSurface.vue is deleted and the
        # seeded group it drew went with the demo seed. home-agrees.dom.test.ts now says 'D-016
        # deleted the demo seed, Home, its project cards and its seeded decisions', and the commit
        # message lists 'Proposals go end to end, with the demo seed'. No painted 'seeded group in
        # the panel' exists to protect. Its anchor is left stale, so the census records it retired.
        "M5 · 🔴 the at-a-glance surface is EMPTY again · the seeded group is not drawn in the panel, "
        "which is 304's own sentence — *the four actions were moved into a scrollable section below "
        "the project cards, so the required at-a-glance attention surface is empty* "
        "· MEASURED: dom 4 red (targeted: home-agrees.dom), desktop 3 red (targeted: "
        "surfaces.render)",
        [
            (
                HOME,
                '          <template v-if="rows.length > 0">',
                '          <template v-if="false">',
            )
        ],
    ),
    (
        "M6 · ⚠️ THE FOURTH SURFACE, which 305's brief named three of · the rail's Home badge counts "
        "the live queue again, so it goes blank over four decisions while the seeded project cards on "
        "the surface it OPENS each draw their own `2` "
        "· ⚑ **the label was corrected at `572`**: it said *the project rows in the same rail*, and "
        "`EXT-008` §1 took that block out of the rail — Home's cards are where the seed's projects "
        "are drawn now, which is the surface this badge is about "
        "· EXPECTED (NOT MEASURED): dom 1 red of 858, desktop GREEN",
        [(SCREEN, ':needs-you="homeNeedsYou.total"', ':needs-you="needsYou.length"')],
    ),
    # ── §2.1 · the frozen agent's command ─────────────────────────────────────
    (
        # ⛔ **RETIRED BY RULING (landing D-016a, bd70d693):** The row's subject is
        # ProjectWorkspace's seeded stage card (`selected.frozenOn.command`), and both the component
        # and the seeded `frozenOn` field (lib/entities.ts) are deleted, per 'the project rooms,
        # board, sheet and picker' and 'the demo seed'. The real permission card's command
        # (`permission-detail` in PermissionCard.vue) is a different surface that table 725 already
        # plants. Its anchor is left stale, so the census records it retired.
        "M7 · 🔴 the COMMAND disappears from the decision point · the amber card says why the agent "
        "wants something and never says what it would run, which is 304's *the command is the thing "
        "a person decides on* "
        "· EXPECTED (NOT MEASURED): desktop 2 red of 3,126, dom GREEN",
        [
            (
                WORK,
                '<code v-if="selected.frozenOn" class="command-block"',
                '<code v-if="false" class="command-block"',
            )
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-016a, bd70d693):** The reason-versus-`note` fallback
        # lived only in ProjectWorkspace's seeded stage card (`selected.frozenOn?.reason ??
        # selected.note`), and that file and the seeded frozenOn data are deleted with the demo seed
        # and the project rooms. Nothing in today's code has a `note` fallback for a permission
        # reason. Its anchor is left stale, so the census records it retired.
        "M8 · ⚠️ the reason goes back to `note` · the card's body reads *work 14m · wait 9m* — an "
        "elapsed time where the justification belongs, which is the copy 304 filed "
        "· EXPECTED (NOT MEASURED): desktop 1 red of 3,126, dom GREEN",
        [
            (
                WORK,
                "{{ selected.frozenOn?.reason ?? selected.note }}",
                "{{ selected.note }}",
            )
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-016a, bd70d693):** The `frozenOn?.allowLabel ?? 'Allow'`
        # button belonged to the seeded stage card in ProjectWorkspace.vue, which the commit deleted
        # ('the project rooms, board, sheet and picker', 'the demo seed'). `allowLabel` occurs
        # nowhere else in apps/ or scripts/. Its anchor is left stale, so the census records it
        # retired.
        "M9 · ⚠️ the approval loses the decision's own verb · a card that would run the Chromium E2E "
        "suite offers a button that says `Allow`, so the one word naming the consequence is gone "
        "· EXPECTED (NOT MEASURED): desktop 1 red of 3,126, dom GREEN",
        [(WORK, "{{ selected.frozenOn?.allowLabel ?? 'Allow' }}", "{{ 'Allow' }}")],
    ),
    # ── §2.3 · the stage ──────────────────────────────────────────────────────
    (
        # ⛔ **RETIRED BY RULING (landing D-016a, bd70d693):** The stage digest (`stage-digest`,
        # `selected.digest`) was a field of the seeded ProjectWorkspace stage. ProjectWorkspace.vue
        # and the seed are deleted, and no `stage-digest` marker remains in apps/. The real digest
        # is DigestCard/digest.ts, which the commit reshaped into 'one window over every
        # conversation an agent holds' and which has its own tables. Its anchor is left stale, so
        # the census records it retired.
        "M10 · ⛔ the stage collapses to one sentence again · every agent selection loses its status "
        "digest, which is 304's *materially thinner than the reference* on the primary surface "
        "· EXPECTED (NOT MEASURED): desktop 3 red of 3,126, dom GREEN",
        [
            (
                WORK,
                '<div v-if="selected.digest" class="stage-digest"',
                '<div v-if="false" class="stage-digest"',
            )
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-016a, bd70d693):** `stage-documents`, the
        # open-prompt/open-response actions on a seeded stage, were part of ProjectWorkspace.vue,
        # which is deleted. The card removes 'the project rooms, board, sheet and picker', and no
        # `stage-documents` marker remains. Its anchor is left stale, so the census records it
        # retired.
        "M11 · ⚠️ the stage's contextual document actions go · the PM's *open prompt 043* and the "
        "logs agent's *open response 040* vanish from the view that names them "
        "· EXPECTED (NOT MEASURED): desktop 2 red of 3,126, dom GREEN",
        [
            (
                WORK,
                '<div v-if="stageDocuments.length > 0" class="stage-documents"',
                '<div v-if="false" class="stage-documents"',
            )
        ],
    ),
    # ── §2.4 · provenance and the empty shell ─────────────────────────────────
    (
        # ⛔ **RETIRED BY RULING (landing D-016a, bd70d693):** The project's own `origin` chip
        # (`project-origin`) was drawn on the project workspace status strip, and projects are no
        # longer something a person meets: 'Projects stop being something a person or a model
        # meets'. ProjectWorkspace.vue is deleted, and its killers seeded-drift.render/dom.test.ts
        # were deleted in the same commit. Its anchor is left stale, so the census records it
        # retired.
        "M12 · 🔴 the project is spawned from ITSELF again · the status strip reads *Spawned from "
        "DEV-75297* on DEV-75297's own surface, on the row whose only job is provenance — and Slice "
        "3 puts a spawn tree here "
        "· MEASURED: desktop 1 red (targeted: seeded-drift.render), dom GREEN",
        [
            (
                WORK,
                '<span class="origin-link" data-cy="project-origin">{{ project.origin }}</span>',
                '<span class="origin-link" data-cy="project-origin">{{ project.shortTitle }}</span>',
            )
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-016a, bd70d693):** 'Brand-new work' versus the card's
        # health word was the project workspace header, which is deleted with the project rooms
        # ('the project rooms, board, sheet and picker'). No such header or `project.startedAt`
        # remains anywhere in apps/. Its anchor is left stale, so the census records it retired.
        "M13 · ⚠️ the workspace header borrows the CARD's word · a shell nobody has worked in reads "
        "*Not started* where the reference says *Brand-new work*, so the surface you just opened "
        "reports a health rather than naming what it is "
        "· EXPECTED (NOT MEASURED): desktop 1 red of 3,126, dom GREEN",
        [
            (
                WORK,
                "{{ project.startedAt === null ? 'Brand-new work' : health.label }}",
                "{{ health.label }}",
            )
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-016a, bd70d693):** The 'roster of one PM says it is
        # empty' rail was a project-workspace element (PM plus specialists inside a project), and
        # projects and the PM-per-project roster are removed as something a person meets.
        # ProjectWorkspace.vue is deleted, and no `roster.every` rail remains. Its anchor is left
        # stale, so the census records it retired.
        "M14 · ⚠️ a roster of one PM stops saying it is empty · the rail lists the PM and stops, "
        "which reads as specialists above the fold rather than as a project that has none (067) "
        "· EXPECTED (NOT MEASURED): desktop 1 red of 3,126, dom GREEN",
        [
            (
                WORK,
                "v-if=\"roster.length > 0 && roster.every((agent) => agent.role === 'pm')\"",
                'v-if="false"',
            )
        ],
    ),
    # ── §2.2 · the approval's model ───────────────────────────────────────────
    (
        # ⛔ **RETIRED BY RULING (landing D-016a, bd70d693):** RecruitSheet.vue is the approver's
        # sheet for a PM's proposal, and the commit says 'Proposals go end to end'. The sheet and
        # its `recruit-model` role grid are deleted, so there is no approval sheet whose engine fact
        # could be swapped for the project. Its anchor is left stale, so the census records it
        # retired.
        "M15 · 🔴 the approver cannot see what they are authorizing · the role grid's second fact "
        "goes back to the PROJECT, which is already in the breadcrumb, the header and the proposal, "
        "while the engine is nowhere on the sheet "
        "· EXPECTED (NOT MEASURED): desktop 2 red of 3,126, dom GREEN",
        [
            (
                RECRUIT,
                "<strong data-cy=\"recruit-model\">{{ engine ?? 'not proposed yet' }}</strong>",
                '<strong data-cy="recruit-model">{{ project.shortTitle }}</strong>',
            )
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-016a, bd70d693):** The 'no engine proposed — the PM has
        # not shaped this one yet' line was the target card of RecruitSheet.vue on the PM's own
        # proposal awaiting approval. Proposals and the recruit sheet are deleted end to end, and
        # the string exists nowhere else. Its anchor is left stale, so the census records it
        # retired.
        "M16 · ⚠️ the target card says the engine is chosen later · on the PM's own proposal awaiting "
        "approval, which is the sentence 304 quoted "
        "· EXPECTED (NOT MEASURED): desktop 2 red of 3,126, dom GREEN",
        [
            (
                RECRUIT,
                "                engine ?? 'no engine proposed — the PM has not shaped this one yet'",
                "                'engine chosen when the PM proposes it'",
            )
        ],
    ),
    # ── §2.5 · three ways to be empty ─────────────────────────────────────────
    (
        # ⛔ **RETIRED BY RULING (landing D-016a, bd70d693):** AllDocumentsSheet.vue was the
        # per-project library sheet, deleted with 'the project rooms, board, sheet and picker'
        # (chat-theme.test.ts records it as one of the deleted panels). No 'No document matches'
        # empty-library text exists in any other surface. Its anchor is left stale, so the census
        # records it retired.
        "M17 · 🔴 a library with nothing in it reports a SEARCH MISS again · *No document matches "
        "“”* on a brand-new project, which is a report about a query nobody typed "
        "· EXPECTED (NOT MEASURED): desktop 1 red of 3,126, dom 1 red of 858",
        [
            (
                SHEET,
                '<template v-if="all.length === 0">',
                '<template v-if="false">',
            )
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-016a, bd70d693):** The
        # excluding-filter-versus-empty-search report belonged to AllDocumentsSheet.vue's kind
        # filter and search box, and the whole sheet is deleted. No other surface has a document
        # library with a filter. Its anchor is left stale, so the census records it retired.
        "M18 · ⚠️ an excluding FILTER reports a search miss too · the sheet quotes an empty needle "
        "whenever the filter, and not the query, is what emptied the table "
        "· EXPECTED (NOT MEASURED): dom 1 red of 858, desktop GREEN",
        [
            (
                SHEET,
                "<template v-else-if=\"search.trim() === ''\">",
                '<template v-else-if="false">',
            )
        ],
    ),
    # ── §2.6 · the bridge ─────────────────────────────────────────────────────
    (
        # ⛔ **RETIRED BY RULING (landing D-016a, bd70d693):** DocumentDrawer.vue and its `followUp`
        # bridge (Open prompt 043) are deleted, along with the project-scoped document drawer flow.
        # Both killers, seeded-drift.render.test.ts and seeded-drift.dom.test.ts, were deleted in
        # the same commit. Its anchor is left stale, so the census records it retired.
        "M19 · ⚠️ the drawer's footer stops at Close again · 040's warning names 043 and the drawer "
        "offers no way to it, so the evidence-to-next-step bridge is lost the moment it closes "
        "· MEASURED: desktop 1 red (targeted: seeded-drift.render), dom 1 red (targeted: "
        "seeded-drift.dom)",
        [(DRAWER, '        v-if="followUp"', '        v-if="false"')],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-016a, bd70d693):** The row planted the drawer's follow-up
        # button emitting the wrong document, and DocumentDrawer.vue is deleted, so no bridge button
        # remains. Its only killer, seeded-drift.dom.test.ts, is deleted too. Its anchor is left
        # stale, so the census records it retired.
        "M20 · ⛔ the bridge leads back to the document you are already reading · the button is drawn, "
        "says *Open prompt 043*, and asks for 040 — the shape no SSR assertion can see, because the "
        "markup is identical and only the press is wrong "
        "· MEASURED: dom 1 red (targeted: seeded-drift.dom), desktop GREEN (targeted: "
        "seeded-drift.render)",
        [
            (
                DRAWER,
                "@click=\"emit('open', followUp)\"",
                "@click=\"emit('open', props.document)\"",
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
        print(
            f"{len(MUTATIONS) - bad}/{len(MUTATIONS)} rows apply exactly once ({edits} edit anchors)"
        )
        return 1 if bad else 0
    root = Path(args[0]).resolve()
    return apply(root, int(args[1]), dry=False)


if __name__ == "__main__":
    raise SystemExit(main())
