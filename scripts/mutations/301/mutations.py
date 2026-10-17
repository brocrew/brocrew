#!/usr/bin/env python3
"""301's mutation table — each row is THE DEFECT, put back verbatim (131).

⛔ **Three acceptance lines and a name**, and the rows are grouped by the line they serve, because
that is what `HO-003` §2 now asks every task to say:

 * **#5** — *"'work item' appears nowhere; 'project' used consistently."* One doc comment, plus the
   type rename `HO-004` §3 asked for, plus the guard that stops both coming back.
 * **#6** — *"placeholder surfaces render from typed fixtures, demonstrably."* The demonstration is
   `scripts/fixture-follow-check.mjs`; the *typed* half is `// @ts-check` on the payload, which
   until `301` was a hand-written `.d.mts` that SHADOWED the file it described.
 * **#7** — *"nothing unwired implies working state."* Four surfaces corrected and one guard added.

## 🔴 Which gate can see each row, because for this table they are not all the same one

⚠️ **`301`'s work is deliberately spread across three gates, and `run_suite` is only the first.**
Saying so here is the point — a survivor in the table below is not automatically a coverage gap,
and a reader must be able to tell which kind it is:

| rows | the defect is caught by |
|---|---|
| `M1`-`M17` | ⚑ **`run_suite`** — `desktop` (SSR) and `dom`, named per row |
| `M18`-`M21` | ⛔ **`pnpm run typecheck`**, and by nothing in the four projects: vitest transforms through esbuild, which strips types without checking them |
| `M22`-`M26` | ⛔ **`pnpm run fixture:check`**, which launches the app and reads its DOM — and, since `306`, **`desktop` as well** (see below) |
| `M27`-`M29` | ⚠️ **nothing** — they weaken an instrument, and this repository has no test of its tests. Recorded as expected SURVIVED with the reason, rather than left to read as a gap |

## ⚑ Corrected at 306: two claims in this header stopped being true, and the rows did not change

⛔ **This table said `M22`-`M26` were invisible to all four vitest projects** — *"no vitest project
runs it, and it is not in the `ci` chain either"* — and named the two foreign anchors that pinned the
chain. `306` re-anchored those rows, appended `fixture:check` to `ci`, and pinned the check's own
five assertions in `apps/desktop/test/gates-in-the-chain.test.ts`. So `M22`-`M26` are now killed by
**`desktop`** as well, and their row labels' *"`fixture:check` only"* understates them by one column.

⚠️ **The labels are left exactly as written**, and not because it is awkward to change them: a row
label is compared byte-for-byte against the artefact roster, and this table's own text is the record
of what `301` measured and expected. The correction belongs here, where a reader meets it before the
rows. Nothing about the five propositions moved.

## The row groups

 * `M1`-`M4`   ⛔ **the digest's empty state** — `211` §2 scoped every sentence on that card to
                PROJECTS and left one promising that BroBot *"will keep distilling"*, in the branch
                a fresh install always takes.
 * `M5`-`M7`   🔴 **the document drawer**, the only seed-backed surface in the app that carried
                `data-wired="false"` and showed a reader nothing.
 * `M8`-`M11`  ⚠️ **Home's banner**, which named three blocks that are not on an empty Home.
 * `M12`-`M15` 🔴 **the library's reopen band** (`302`'s finding 1): *"Nothing matches …"* over a
                long clickable list of conversations, on one screen.
 * `M16`-`M17` ⚑ **the rail's closed-projects summary**, `225`/`226`'s `v-show` defect on the group
                the fix was not applied to.
 * `M18`-`M21` ⛔ **the typed fixtures**, which were not typed: the `.d.mts` shadowed the payload.
 * `M22`-`M26` 🔴 **the demonstration itself** — its control, its `260` guard, its reload.
 * `M27`-`M29` ⚠️ **the two new guards**, weakened from the inside.

⚠️ Like 240, 243, 247, 248, 250, 251, 254, 258, 262, 292 and 300, this table does NOT mutate the
harness it is run by, and it touches no other dispatch's table.
"""

from __future__ import annotations

import sys
from pathlib import Path

DIGEST = "apps/desktop/src/renderer/src/components/DigestCard.vue"
ACTIVITY_PAGE = "apps/desktop/src/renderer/src/components/RecentActivity.vue"
DRAWER = "apps/desktop/src/renderer/src/components/DocumentDrawer.vue"
HOME = "apps/desktop/src/renderer/src/components/HomeSurface.vue"
LIBRARY = "apps/desktop/src/renderer/src/components/SessionLibrary.vue"
RAIL = "apps/desktop/src/renderer/src/components/SideRail.vue"
PAYLOAD = "scripts/demo-seed-payload.mjs"
TSWEB = "apps/desktop/tsconfig.web.json"
TSNODE = "apps/desktop/tsconfig.node.json"
CHECK = "scripts/fixture-follow-check.mjs"
UNWIRED = "apps/desktop/test/unwired-is-disclosed.test.ts"
ENTITIES_TEST = "apps/desktop/test/entities.test.ts"

MUTATIONS = [
    # ── #7 · the digest's empty state ─────────────────────────────────────────────────────────
    (
        # ⛔ **RETIRED (Recent activity, in "Show Recent activity and what finished since you were last here"):** the digest card is deleted, and with it every sentence these rows planted.
        "M1 · 🔴 THE PROMISE COMES BACK — `BroBot will keep distilling changes and surface only "
        "what deserves you`, in the branch a window that has NOT LOOKED YET always takes. The "
        "first sentence this app shows before it has read anything, replaced by a promise about "
        "what it will do · desktop ⚑ RE-AIMED BY 438 (a distiller exists now, so the old sentence "
        "is retired; the surviving half is that the not-yet-looked branch may not promise)",
        [
            (
                DIGEST,
                "        Nothing has been read yet. This is not an all-clear — it is a window that has not looked.",
                "        BroBot will keep distilling changes and surface only what deserves you.",
            )
        ],
    ),
    (
        "M2 · ⛔ the having-nothing line loses its condition, so a card says `Nothing this digest "
        "reads was recorded here` over a window that recorded plenty · desktop "
        "⚑ RE-AIMED BY 438 (same rule, on the sentence that replaced `digest-none`) "
        "⚑ ANCHOR CORRECTED IN PLACE BY 466, and RE-VERIFIED: the first correction SURVIVED, "
        "because with the sentence taken from a table keyed on one derived word, dropping the "
        "condition draws an EMPTY paragraph rather than the wrong sentence. ⛔ A row that can no "
        "longer put its defect back is a row that has stopped measuring anything, so it now "
        "forces the member as well as the condition — which is the defect, whole",
        # ⚑ Landing D-016a (bd70d693) · re-anchored in place, not retired — The rule survives: a
        # digest card may not say "Nothing this digest reads was recorded here" over a window that
        # recorded something. D-016 made the digest one list, so the paragraph is now keyed on
        # `view.says` and its hook is the bare `digest-silent`, with no project slug. The plant
        # drops the condition and forces the member and the hook, as the label's own note asks.
        # ⚑ **Recent activity replaced the digest card · re-anchored in place, not retired** — the having-nothing line is Recent activity's empty state now; the plant still drops its condition.
        [(ACTIVITY_PAGE, "        <div v-if=\"says === 'nothing-recorded'\" class=\"state\" data-cy=\"activity-empty\">", "        <div class=\"state\" data-cy=\"activity-empty\">")],
    ),
    (
        "M3 · ⚠️ the branch inverts — the having-nothing sentence appears only when there IS "
        "something, and vanishes in the one state it exists for · desktop ⚑ RE-AIMED BY 438 "
        "⚑ ANCHOR CORRECTED IN PLACE BY 466: same inversion, written against the table lookup",
        # ⚑ Landing D-016a (bd70d693) · re-anchored in place, not retired — The rule survives: the
        # having-nothing sentence must appear only when there is nothing. The paragraph's guard on
        # the card is now `SILENCE_SAYS[view.says] !== null`, with no project loop. The plant
        # inverts it.
        # ⚑ **Recent activity replaced the digest card · re-anchored in place, not retired** — the having-nothing line is Recent activity's empty state now; the plant still inverts its condition.
        [(ACTIVITY_PAGE, "        <div v-if=\"says === 'nothing-recorded'\" class=\"state\" data-cy=\"activity-empty\">", "        <div v-if=\"says !== 'nothing-recorded'\" class=\"state\" data-cy=\"activity-empty\">")],
    ),
    (
        # ⛔ **RETIRED (Recent activity, in "Show Recent activity and what finished since you were last here"):** the digest card is deleted, and with it every sentence these rows planted.
        "M4 · ⚠️ the hook goes, so the recorded-nothing state is unaddressable — every assertion "
        "about which digest branch is on screen becomes a substring search over the whole card · "
        "desktop ⚑ RE-AIMED BY 438 ⚑ ANCHOR CORRECTED IN PLACE BY 466: the hook is a word out of "
        "the same table as the sentence, so that a silence cannot have one and not the other",
        # ⚑ Landing D-016a (bd70d693) · re-anchored in place, not retired — The rule survives: the
        # silence paragraph must carry its hook. It now comes from the same table as the sentence,
        # `:data-cy="SILENCE_SAYS[view.says]?.hook"`, and is no longer suffixed with a project slug.
        # The plant deletes that line, which also removes the `digest-partly-read` hook.
        [
            (DIGEST, '            :data-cy="SILENCE_SAYS[view.says]?.hook"\n', ''),
        ],
    ),
    # ── #7 · the document drawer ──────────────────────────────────────────────────────────────
    (
        # ⛔ **RETIRED BY RULING (landing D-016a, bd70d693):** DocumentDrawer.vue,
        # AllDocumentsSheet.vue and the seeded fixture documents are deleted ("Proposals go end to
        # end, with the demo seed, the renderer fixtures"). The 'fixture' chip marked invented
        # document data, and no such data is drawn any more. The two canonical document viewers show
        # real documents only. Its anchor is left stale, so the census records it retired.
        "M5 · 🔴 THE DRAWER GOES BACK TO SILENCE — `data-wired=\"false\"` and no mark, so a person "
        "reads a fixture document's number, agent, TL;DR, runtime and warning with nothing saying "
        "it never existed. The defect `301`'s sweep found · desktop",
        [(DRAWER, '      <SoonChip label="fixture" />\n', "")],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-016a, bd70d693):** DocumentDrawer.vue and `SoonChip.vue`
        # are deleted on purpose. `unwired-is-disclosed.test.ts` says: "D-016 deleted `<SoonChip`
        # and `<PlaceholderBanner`". A chip that reads 'soon' rather than 'fixture' has no surface
        # any more. Its anchor is left stale, so the census records it retired.
        "M6 · ⚠️ the chip says `soon` rather than `fixture` — the wrong half of the truth: nothing "
        "here is coming later, the DATA is invented, and `AllDocumentsSheet` says `fixture` about "
        "the same documents one surface over · desktop",
        [(DRAWER, '<SoonChip label="fixture" />', "<SoonChip />")],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-016a, bd70d693):** The `data-wired="false"` document
        # drawer is gone, and the renderer now declares no unwired surface.
        # `unwired-is-disclosed.test.ts` says: "The last `data-wired="false"` went with Home", and
        # every remaining declaration is `data-wired="true"`. The chip and the attribute this row
        # protected were deleted together. Its anchor is left stale, so the census records it
        # retired.
        "M7 · ⛔ the surface stops declaring itself unwired at all — the attribute and the chip are "
        "one claim in two halves, and dropping the machine-readable half hides the drawer from the "
        "guard while leaving the human-readable one alone · desktop",
        [(DRAWER, ' data-wired="false" data-cy="document-drawer"', ' data-cy="document-drawer"')],
    ),
    # ── #7 · Home's banner (302's finding 2) ──────────────────────────────────────────────────
    (
        # ⛔ **RETIRED BY RULING (landing D-016a, bd70d693):** HomeSurface.vue and its
        # `PlaceholderBanner` are deleted. The dom test now says: "D-016 deleted Home — the
        # placeholder dashboard over the demo seed ... with the seed, so §3 (*Home keeps the
        # fixture*) and the rail's Home row went too". The empty Home no longer exists to name
        # blocks that are not there. Its anchor is left stale, so the census records it retired.
        "M8 · 🔴 ONE SENTENCE FOR BOTH STATES AGAIN — the empty Home says `the project cards, "
        "digest and dispatch decisions below read fixture state`, naming three blocks that are not "
        "there, three lines above `No projects yet` · desktop + dom",
        [(HOME, "  nothingBelow.value\n", "  false\n")],
    ),
    (
        # The seeded Home, project cards and digest are gone. There is no surface on which to plant
        # this empty-state claim, so retain the absent anchor as retired.
        "M9 · ⛔ the other way round: a SEEDED Home claims there is nothing below it, while three "
        "project cards and a digest are on screen · desktop",
        [(HOME, "  nothingBelow.value\n", "  true\n")],
    ),
    (
        # Home and its nothingBelow predicate are gone. No renderer predicate remains to receive
        # this mutation; retain its absent anchor as retired.
        "M10 · ⚠️ the predicate reads only the projects, so a seed carrying decision rows and no "
        "projects says `there is nothing below it` over four rendered rows — the same defect, "
        "narrower · desktop ⚑ RE-AIMED BY 438 (the bullets arm is gone: the digest is read from "
        "the ledger and is deliberately NOT one of the blocks this sentence names. ⚑ The row can "
        "now be KILLED rather than merely named — `surfaces.render.test.ts` plants rows without "
        "projects, which no fixture did when this was written)",
        [
            (
                HOME,
                "const nothingBelow = computed(() => active.value.length === 0 && rows.value.length === 0)",
                "const nothingBelow = computed(() => active.value.length === 0)",
            )
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-016a, bd70d693):** The empty Home and its
        # `PlaceholderBanner` were removed on purpose: the commit removes "the demo seed, the
        # renderer fixtures", and `unwired-is-disclosed.test.ts` now records "The last
        # `data-wired="false"` went with Home ... `SoonChip` and `PlaceholderBanner`". Nothing in
        # the tree draws a placeholder banner, so the defect (banner missing on an empty placeholder
        # Home) has no surface. Its anchor is left stale, so the census records it retired.
        "M11 · ⛔ the banner goes entirely on the empty Home — the most convincing surface in the "
        "app, unmarked, at the moment it has nothing to back any of it (118: an empty placeholder "
        "is still one) · desktop",
        [(HOME, '    <PlaceholderBanner :what="placeholderNote" />', '    <PlaceholderBanner v-if="!nothingBelow" :what="placeholderNote" />')],
    ),
    # ── #7 · the library's reopen band (302's finding 1) ──────────────────────────────────────
    (
        "M12 · 🔴 THE CONTRADICTION RETURNS — `Nothing matches “Q302_NO_MATCH_9f73e6a1”` over a "
        "long, clickable list of conversations, with nothing on the page saying the list is not "
        "part of the search · dom",
        [(LIBRARY, '<p v-if="searching || filtered" class="reopen-scope"', '<p v-if="false" class="reopen-scope"')],
    ),
    (
        "M13 · ⚠️ the note is always on, so it becomes furniture: a sentence that is present when "
        "nothing is narrowed says nothing about the state it exists to explain (106's other "
        "direction) · dom",
        [(LIBRARY, '<p v-if="searching || filtered" class="reopen-scope"', '<p v-if="true" class="reopen-scope"')],
    ),
    (
        "M14 · ⛔ only the FACETS disclose it — a plain search miss, which is exactly what `302` "
        "reported, goes back to sitting silently above the list · dom",
        [(LIBRARY, '<p v-if="searching || filtered" class="reopen-scope"', '<p v-if="filtered" class="reopen-scope"')],
    ),
    (
        "M15 · ⚠️ the note loses its hook, so the page states the scope and no instrument can read "
        "which band it is about · dom",
        [(LIBRARY, ' class="reopen-scope" data-cy="library-reopen-scope"', ' class="reopen-scope"')],
    ),
    # ── #7 · the rail's collapsed summary (225 / 226 §3) ──────────────────────────────────────
    (
        # ⛔ **RETIRED BY RULING (landing D-017b, 3af91dcb):** The row turns `v-if` into `v-show` on
        # the collapsed summary of the rail's one collapsible group, the closed CONVERSATIONS one.
        # D-017b removed that group ('One Conversations list in the rail and the palette ... no open
        # / closed / kept-open split'), so `SideRail.vue` has no `closedOpen` and no
        # `rail-group-summary`, and nothing collapses. The row's own note calls it 'the one
        # collapsible group left', and that group is now gone. Its anchor is left stale, so the
        # census records it retired.
        "M16 · 🔴 `v-show` for `v-if` — the summary is `display: none` the instant the group opens "
        "and its sentence stays in the DOM beside the rows it claims to be hiding, which is the "
        "half a script, a dump or a CDP read sees. `225` finding 2 · ⚠️ **RE-ANCHORED at `572`**: "
        "this row was measured on the CLOSED PROJECTS group, and `EXT-008` §1 took that group out "
        "of the rail — so it sits on the one collapsible group left, the closed CONVERSATIONS one "
        "forty lines above where the other was. `301`'s own finding was that the pair behaved "
        "identically to a reader; the pair is now a single · dom",
        [(RAIL, '          v-if="!closedOpen"\n          class="rail-group-summary"', '          v-show="!closedOpen"\n          class="rail-group-summary"')],
    ),
    (
        "M17 · ⛔ RETIRED at `572` · anchor-absent · the count was taken from ALL projects rather "
        "than the closed ones, so the collapsed summary said `3 closed projects hidden` about a "
        "group holding none. ⚑ **The subject is gone rather than moved**: `EXT-008` §1 took the "
        "rail's CLOSED PROJECTS group out of the navigation column, and `ProjectDetails` has no "
        "`closedAt`, so there is no closed-project count anywhere in this app to re-anchor onto. "
        "⛔ Unlike `M16` beside it, whose rule survived on the conversations group · dom",
        [(RAIL, "            {{ closedProjectList.length }} closed", "            {{ props.projects.length }} closed")],
    ),
    # ── #6 · the typed fixtures — typecheck only ──────────────────────────────────────────────
    (
        # ⛔ **RETIRED BY RULING (landing D-016a, bd70d693):** `scripts/demo-seed-payload.mjs` is
        # deleted ("Proposals go end to end, with the demo seed, the renderer fixtures") and
        # `lib/fixtures.ts` with it. There is no typed payload left whose `@ts-check` could stop
        # being checked. Its anchor is left stale, so the census records it retired.
        "M18 · 🔴 THE PAYLOAD STOPS BEING CHECKED — `// @ts-check` deleted and the exact violation "
        "`301` measured planted beside it (`att_1.id` as a number). ⛔ Caught by `pnpm run "
        "typecheck` and by NOTHING in the four projects: vitest transforms through esbuild, which "
        "strips types without checking them · EXPECTED SURVIVED under `run_suite`",
        [
            (PAYLOAD, "// @ts-check\n", ""),
            (PAYLOAD, "    id: 'att_1',", "    id: 12345,"),
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-016a, bd70d693):** D-016 removed `allowJs` from
        # `tsconfig.web.json` on purpose, together with `lib/fixtures.ts` and the payload it
        # imported. No renderer, shared or DOM-test file imports a `.mjs` from the web project any
        # more, so setting it false plants nothing the label describes. Its anchor is left stale, so
        # the census records it retired.
        "M19 · ⛔ `allowJs` removed from the renderer project, so `lib/fixtures.ts` cannot import "
        "the payload at all and the whole typed re-export resolves to nothing · typecheck only",
        [(TSWEB, '    "allowJs": true', '    "allowJs": false')],
    ),
    (
        "M20 · ⚠️ the same in the node project, where `entities.test.ts` and the smokes read the "
        "payload — the half that would be missed by checking only the surface the app renders · "
        "typecheck only",
        [(TSNODE, '    "allowJs": true', '    "allowJs": false')],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-016a, bd70d693):** Both the `PROJECTS` fixture and
        # `scripts/demo-seed-payload.mjs` are deleted ("projects and proposals go", "the demo seed,
        # the renderer fixtures"). There is no Project[] array left to lose its `@type`. Its anchor
        # is left stale, so the census records it retired.
        "M21 · ⛔ one export loses its `@type`, so that array is inferred instead of checked and a "
        "wrong shape in the PROJECTS fixture typechecks green — the shadowing defect back, one "
        "export at a time · typecheck only, and only with a planted violation",
        [
            (
                PAYLOAD,
                "/** @type {import('../apps/desktop/src/renderer/src/lib/entities').Project[]} */\nexport const PROJECTS = [",
                "export const PROJECTS = [",
            ),
            (PAYLOAD, "    shortTitle: 'DEV-75297',", "    shortTitle: 75297,"),
        ],
    ),
    # ── #6 · the demonstration — the ci step only ─────────────────────────────────────────────
    (
        # ⛔ **RETIRED BY RULING (landing D-016a, bd70d693):** `scripts/fixture-follow-check.mjs` and
        # the `fixture:check` script are deleted. `gates-in-the-chain.test.ts` says: "D-016 deleted
        # `fixture:check` and `scripts/fixture-follow-check.mjs`: the demo seed it followed into
        # Home is gone, and so are Home and the project card it read." The instrument's whole
        # subject is gone. Its anchor is left stale, so the census records it retired.
        "M22 · 🔴 THE CONTROL GOES — phase 1 no longer asserts the SHIPPED title is on screen, so a "
        "green says only *\"the marker appeared\"*, which a surface that always showed the marker "
        "would also produce. `193`'s vacuity, in the instrument built to close the criterion · "
        "`pnpm run fixture:check` only",
        [
            (
                CHECK,
                "    if (shown !== before) {\n      throw new Error(",
                "    if (false) {\n      throw new Error(",
            )
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-016a, bd70d693):** The marker guard lived in
        # `scripts/fixture-follow-check.mjs`, which D-016 deleted with the demo seed.
        # `gates-in-the-chain.test.ts` also dropped its 'fixture instrument cannot quietly ask for
        # less' block. Nothing is left to re-anchor onto. Its anchor is left stale, so the census
        # records it retired.
        "M23 · ⛔ the `260` guard goes: the marker may equal the shipped title, and phase 2 then "
        "asserts a value travelled by comparing it with itself · `fixture:check` only",
        [
            (
                CHECK,
                "  if (before === MARKER) {\n    throw new Error(`the marker IS the shipped title (${MARKER}) — phase 2 could not fail`)\n  }\n",
                "",
            )
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-016a, bd70d693):** The one-occurrence guard lived in
        # `scripts/fixture-follow-check.mjs`, deleted on purpose ("D-016 deleted `fixture:check` ...
        # the demo seed it followed into Home is gone"). The check that changed one fixture value
        # and read the screen no longer exists. Its anchor is left stale, so the census records it
        # retired.
        "M24 · ⚠️ the one-occurrence guard goes, so *\"change ONE fixture value\"* silently becomes "
        "*\"change every occurrence of a string\"* and the check stops testing what the criterion "
        "asks · `fixture:check` only",
        [(CHECK, "  if (hits !== 1) {", "  if (false) {")],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-016a, bd70d693):** `writeFileSync(edited, ...)` was in
        # `scripts/fixture-follow-check.mjs`, which D-016 deleted together with
        # `scripts/demo-seed-payload.mjs` and `fixture:check`. There is no edited payload and no
        # re-seed any more. Its anchor is left stale, so the census records it retired.
        "M25 · ⛔ the edited payload is never written — phase 2 re-seeds the file unchanged, so the "
        "check asserts the screen follows a change nobody made · `fixture:check` only",
        [(CHECK, "writeFileSync(edited, source.replace(before, MARKER))", "writeFileSync(edited, source)")],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-016a, bd70d693):** The 'old value asserted gone' step was
        # in `scripts/fixture-follow-check.mjs`, deleted on purpose with the demo seed and Home
        # ("the demo seed it followed into Home is gone"). It has no surviving equivalent. Its
        # anchor is left stale, so the census records it retired.
        "M26 · ⚠️ the old value is no longer asserted GONE, so a surface that ADDED the new title "
        "beside the old one — two documents, one screen — reads as a surface that followed · "
        "`fixture:check` only",
        [(CHECK, "    if (stale) {", "    if (false) {")],
    ),
    # ── the instruments ───────────────────────────────────────────────────────────────────────
    (
        "M27 · ⚠️ the guard accepts `data-wired` as its own disclosure — the exact confusion it was "
        "written to end, since the attribute is invisible to the person the rule is about. "
        "⛔ EXPECTED SURVIVED: this repository has no test of its tests, and the row is here so "
        "that absence is recorded rather than inferred",
        # ⚑ Landing D-016a (bd70d693) · re-anchored in place, not retired — The rule holds:
        # `data-wired` must not count as a disclosure. D-016 shrank the list to `['not-wired']`
        # (SoonChip and PlaceholderBanner are gone), so the plant adds `'data-wired'` to that list.
        # The label predicts SURVIVED, but D-016 added planted `hides` and `told` sections to the
        # census test, so this plant now goes RED. The label is byte-keyed, so only the expectation
        # changes.
        [
            (UNWIRED, "const DISCLOSURES = ['not-wired'] as const", "const DISCLOSURES = ['not-wired', 'data-wired'] as const"),
        ],
    ),
    (
        "M28 · ⚠️ proximity stops meaning anything — a disclosure anywhere in the file satisfies a "
        "dead control at the top of it. ⛔ EXPECTED SURVIVED, same reason as `M27`",
        [(UNWIRED, "const NEAR_LINES = 12", "const NEAR_LINES = 9_999")],
    ),
    (
        "M29 · ⚠️ every line counts as prose, so the vocabulary guard passes over an identifier "
        "named `workItem` as readily as over a comment explaining why the noun went. ⛔ EXPECTED "
        "SURVIVED, same reason as `M27`",
        [
            (
                ENTITIES_TEST,
                "    const text = line.trim()\n    return text.startsWith('*') || text.startsWith('//') || text.startsWith('/*')",
                "    return line.length >= 0",
            )
        ],
    ),
]


def apply(root: Path, index: int, dry: bool) -> int:
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
