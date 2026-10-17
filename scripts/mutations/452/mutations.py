#!/usr/bin/env python3
"""452 · the room behind the door — each row is THE DEFECT, put back (131).

🔴 **the person asked whether he can see a project's progress and its agents' conversations.** The
answer was *"the door is real and the room is a photograph"* — criterion 15's own shape, on a
surface a person can reach.

## ⛔ The measurement came first, and it was wider than the question

`ProjectWorkspace` was only ever handed a FIXTURE id. `projectId` is `place` (`useSurface.ts:93`),
and both gestures that put an id there carried `entities.ts` ids; the rail's REAL rows were routed
to the sheet on purpose, saying *"it would find nothing for these rows and draw an empty picture of
a project that is not empty."* 🔴 **So the door and the room did not lead to the same building**,
and no band could be sourced until one of them moved. The arrow on the rail's real row is that
move, and `M19`-`M22` are it put back.

## ⛔ ONE of the three bands is a GAP now, and a gap is not a placeholder

A placeholder draws invented content and wears a dashed chip. A gap draws none and names what
cannot be answered — HO-024 §5.3. `M10`-`M13` and `M16` are the two ways a gap fails: by falling
silent, and by dressing as a thing that is about to be built. ⚑ `M11` and `M12` are RE-ANCHORED by
relay 1 — see below; the defect on each is unchanged and the sentence it plants moved.

## 🔴 relay 1 · the gap under band 3 was closed while the band was being drawn

⚡ **The brief said no queue row carries a project. It nearly did.** `452` measured that every row
carries `work[]` and a `WorkInHand` has a `projectSlug` that `PersonsQueue.vue:198` already prints
— the asking CONVERSATION'S open tasks, possibly empty, possibly several — so a project WAS on
every row and it was the wrong one to key on.

⛔ **`453` then landed `project` and `projectIs` on `PersonsQueueRow`, and the two were integrated
in one gate.** `452`'s own census — *no queue row carries a project of its own* — went RED on
`main`, which is the whole argument for writing a gap's premise as a test rather than as prose. ⚑
**`M25`-`M38` are that field spent**: the band draws the rows filed under one slug, in the queue's
own order, in the queue's own words, and `work[].projectSlug` is still on every row and still the
wrong key.

⚠️ **`sinceWords` and `KIND_WORDS` moved out of `PersonsQueue.vue` and into the module**, because
the rule was *one derivation, wherever it lives* and the MECHANISM it was written as — *said once in
the single component both surfaces mount* — stopped holding at a third surface. `403 M23` was
re-anchored onto the module in place; the lines are byte-identical and the defect is the same swap.

## 🔴 Which gate can see each row

| rows | the defect is caught by |
|---|---|
| `M1`-`M9`, `M13`-`M14`, `M19`, `M26`-`M28` | `apps/desktop/test/the-room-behind-the-door.render.test.ts` |
| `M10`-`M12`, `M15`-`M18`, `M20`-`M25`, `M29`-`M38` | `apps/desktop/test/dom/the-room-behind-the-door.dom.test.ts` |

⛔ **The table was NOT run.** Every row below was applied ALONE, watched go red against the gate
named above, and restored from bytes with a SHA-256 check — `verify-each-mutation-row`, which is
not the same claim as a table run. ⚑ **relay 1's rows were verified the same way, on the rebased
tree**, and `403 M23` was re-verified after its anchor moved file.

## ⚠️ What is deliberately NOT here

⛔ **No row that makes a band draw rows it cannot source.** Band 2's gap exists because no reader
answers it; a mutation that filtered conversations by folder would be this table shipping the guess
the surface refuses. ⚑ **`453` did not close that one and could not have**: what it placed is a
CARD — where a question is waiting — and band 2 asks which conversations are RUNNING here, whether
or not any of them has asked anything. A conversation with nothing waiting on anybody produces no
queue row at all.

⛔ **No row on `PLACED_IN_A_NAMED_PROJECT`'s VALUES.** Today `never-placed` always arrives with
`project: null`, so flipping a cell changes no row that can exist — `a-line-no-mutation-can-kill-is-
not-carrying-its-rule`. ⚑ What the table buys is a compile error on a third `ProjectIs`, and the
instrument for that is a source census; `M27` relaxes the TYPE, which is the reachable half.

⛔ **No row on `.decision-body { min-width: 0 }`, because that declaration was DELETED rather than
covered.** It is the ordinary companion to `flex: 1` and it was measured to carry nothing: a
conversation name long enough to overflow was planted in a 1100px room, the declaration removed, and
the act did not move — `.decision-hop` is `overflow-wrap: anywhere` and the chain wraps, so the
item's min-content width is already near zero. `M38` is the one thing in that block that is
load-bearing.

⛔ **No row on the row press.** `project-sheet.dom.test.ts` asserts the rail's real row opens the
SHEET and not the workspace, and 452 left that gesture where it was — which of the two a bare
click should open is a product question. A row here would be this table answering it.

⛔ **No row on `448`'s decide door.** Nothing on this surface settles anything, and
`a-list-that-notices.test.ts` is red on `main` for a reason `448-relay-1` owns.

⛔ **No row on `.real-project-row .rail-item`, because that rule was DELETED rather than covered.**
It carried `flex: 1; min-width: 0`, and neither could be made to matter: `.rail-item` is already
`width: 100%`, a flex item shrinks by default, and its middle grid track is `minmax(0, 1fr)`, so
its min-content width is near zero with or without them. ⚠️ **The first `M24` was that row and it
SURVIVED**; planting a project name long enough to overflow a 200px rail did not change the answer.
`a-line-no-mutation-can-kill-is-not-carrying-its-rule` — the declaration was removed, and `M24` is
now the one thing in that block that is load-bearing.

⚠️ **Two rows were re-anchored in other tables rather than added here** — `344 M2` (the light
scope, now two roots) and `376 M19` (the rail's `v-for`, now on the row's box). Both were corrected
in place and re-verified RED; a copy here would be two rows protecting one line.
"""

WORK = "apps/desktop/src/renderer/src/components/ProjectWorkspace.vue"
# ⚑ **472 · where the two-key rule lives now** — see M1.
STORE = "apps/desktop/src/renderer/src/lib/project-store.ts"
RAIL = "apps/desktop/src/renderer/src/components/SideRail.vue"
# ⚑ **572 · where the two doors went** — `EXT-008` §1 took the list out of the rail, and a page
# has room to write both words down, so the unlabelled arrow is a named button.
BOARD = "apps/desktop/src/renderer/src/components/ProjectsBoard.vue"
SCREEN = "apps/desktop/src/renderer/src/components/RuntimeScreen.vue"
# ⚑ **relay 1** — `453`'s field lives on the row and the scoping lives beside it.
QUEUE = "apps/desktop/src/renderer/src/lib/persons-queue.ts"
PERSONSQUEUE = "apps/desktop/src/renderer/src/components/PersonsQueue.vue"
SESSIONINFO = "apps/desktop/src/renderer/src/components/SessionInfo.vue"
WAITINGONYOU = "apps/desktop/src/renderer/src/components/WaitingOnYou.vue"

# (name, suite, [(file, old, new), ...])
MUTATIONS: list[tuple[str, str, list[tuple[str, str, str]]]] = [
    (
        # ⛔ **RETIRED BY RULING (landing D-016a, bd70d693):** The row's subject, the project room's
        # `roomFor` id resolution in `lib/project-store.ts`, was deleted with the project store.
        # Commit bd70d693: "Projects stop being something a person or a model meets: ... the project
        # rooms, board, sheet and picker ... are removed." No project id is resolved anywhere now.
        # Its anchor is left stale, so the census records it retired.
        "M1 · ⛔ the room answers only to a `proj:` id · the rail's own arrow sends a SLUG, so the one control that opens a real project finds nothing and the surface draws a blank page ⚑ RE-ANCHORED IN PLACE BY 472, never retired: the two-key rule moved out of `ProjectWorkspace.vue` into `roomFor` when the SCREEN became a second caller of it — it resolves the same id to decide which project to read band 2's roster for, and two spellings would poll one project and draw another. The row's claim is unchanged and it now reaches both readers at once",
        "node",
        [
            (STORE, 'row.slug === projectId || row.id === projectId', 'row.id === projectId'),
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-016a, bd70d693):** Same subject as M1: the slug-versus-id
        # resolution lived in `project-store.ts`, which D-016 deleted. There is no project address
        # left to resolve, so the defect cannot be planted. Its anchor is left stale, so the census
        # records it retired.
        'M2 · ⚠️ the room answers only to a slug · every foreign key in this database holds `proj:<slug>`, so a deep link or a stored address resolves to nothing ⚑ RE-ANCHORED IN PLACE BY 472, never retired — see M1 for the move',
        "node",
        [
            (STORE, 'row.slug === projectId || row.id === projectId', 'row.slug === projectId'),
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-016a, bd70d693):** `ProjectWorkspace.vue`, the room that
        # declared `data-wired`, was deleted. D-016 removed the project rooms on purpose ("the
        # project rooms, board, sheet and picker ... are removed"), and
        # `the-room-behind-the-door.dom.test.ts` was deleted with it. Its anchor is left stale, so
        # the census records it retired.
        'M3 · 🔴 the real room declares itself FIXTURE · every word on it is off the `project` table and it tells the one machine-readable reader of that claim the opposite — 009 in the direction that is harder to notice, a working surface dressed as a picture',
        "node",
        [
            (WORK, '    data-wired="true"\n', '    data-wired="false"\n'),
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-016a, bd70d693):** The two rooms (`data-room="real"`
        # versus the demo room) were ProjectWorkspace's branches; D-016 deleted the room, the demo
        # seed and the renderer fixtures ('Proposals go end to end, with the demo seed, the renderer
        # fixtures'). The room dom test that killed this row is deleted too. Its anchor is left
        # stale, so the census records it retired.
        'M4 · ⚠️ the two rooms stop saying which is which · one `data-cy` covers both branches, so a reader cannot tell a project from a demo of one',
        "node",
        [
            (WORK, '    data-room="real"\n', ''),
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-016a, bd70d693):** This planted `||` for `??` on the
        # project's displayName in ProjectWorkspace's heading; the heading and the project it names
        # are removed ('Projects stop being something a person or a model meets'). Its anchor is
        # left stale, so the census records it retired.
        "M5 · ⛔ `||` for `??` on the project's name · 086, on the column the rail already got right: an empty display name is a name somebody typed, and this draws what a missing one draws",
        "node",
        [
            (WORK, "realProject.value?.displayName ?? realProject.value?.slug ?? ''", "realProject.value?.displayName || realProject.value?.slug || ''"),
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-016a, bd70d693):** The project's slug fallback in the
        # room heading is gone with ProjectWorkspace.vue and the project record; no project name is
        # drawn anywhere now (D-016 card: 'no Projects anywhere'). Its anchor is left stale, so the
        # census records it retired.
        'M6 · ⚠️ the slug stops being the fallback · a project nobody has named draws an empty heading, which is an absence rendered as a value',
        "node",
        [
            (WORK, "realProject.value?.displayName ?? realProject.value?.slug ?? ''", "realProject.value?.displayName ?? ''"),
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-016a, bd70d693):** The header's
        # `agoWords(realProject.createdAt, now)` was the project room's only derived fact; the room
        # and the project's createdAt are deleted by D-016. Its anchor is left stale, so the census
        # records it retired.
        "M7 · ⛔ the header's one derived fact is derived from nothing · every project reads *0s ago* however old it is, which is a stamp that cannot be wrong and therefore says nothing",
        "node",
        [
            (WORK, 'agoWords(realProject.createdAt, now)', 'agoWords(now, now)'),
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-016a, bd70d693):** The folder band drew the project's
        # `cwd` path; 'project folders and their rails' are removed by D-016 and the room that drew
        # the band is deleted. Its anchor is left stale, so the census records it retired.
        'M8 · 🔴 the folder band draws a path that is not there · `441` writes `cwd: null` by construction, so the ordinary project BroBot made gets an empty code box instead of the sentence that says where a folder is chosen',
        "node",
        [
            # ⚑ **Anchor corrected at `588`**: the folder became a one-line STRIP (`EXT-013` §1.1),
            # so the `v-if` moved off a `<p class="folder-line">` and onto the `<code>` that draws
            # the path. ⛔ The SUBJECT never moved — *a project with no folder must not draw an
            # empty path box*.
            # ⚠️ **And the CONDITION is flipped rather than deleted** (588). Deleting the `v-if`
            # orphans the `v-else` beside it, so the row went red on a template that would not
            # compile rather than on the defect it names — a red for the wrong reason is a row that
            # measures nothing. ⛔ `v-if="true"` draws the empty box the row is about.
            (WORK, '<code v-if="realProject.cwd" class="path"', '<code v-if="true" class="path"'),
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-016a, bd70d693):** The 'no folder becomes silence'
        # sentence (`project-folder-none`) belonged to the deleted project folder band ('project
        # folders and their rails' removed in D-016), so there is no project with or without a
        # folder to be silent about. Its anchor is left stale, so the census records it retired.
        'M9 · ⛔ no folder becomes SILENCE · HO-024 §5.3 exactly: omission is indistinguishable from nothing-happened, and a person reads a project with no folder as a project with nothing to say',
        "node",
        [
            # ⚑ **Anchor corrected at `588`**: the sentence is a `<span class="folder-none">` inside
            # the strip rather than a headed `band-gap` panel. ⛔ Same subject — *no folder is SAID,
            # never silent*.
            (WORK, '<span v-else class="folder-none" data-cy="project-folder-none">', '<span v-else v-if="false" class="folder-none" data-cy="project-folder-none">'),
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-016a, bd70d693):** The conversations band lived in
        # `ProjectWorkspace.vue`, which is deleted, and the label is about a project's conversations
        # going silent. Card: "no Projects anywhere (sidebar, rooms, cards)"; conversations are now
        # found by their agent, not by a project. Its anchor is left stale, so the census records it
        # retired.
        'M10 · 🔴 the conversations band falls silent · a heading over an empty box, which is what a person reads as *nothing is running here* — the one sentence this surface must never say by accident, and the reason the band is a named gap rather than a filter ⚑ RE-ANCHORED IN PLACE BY 467, never retired: the sentence was *this app cannot list them yet* until `467` landed `conversationsInProject` and made that false; what the band says now is that the app CAN list them and this screen does not draw them. The row\'s claim is unchanged — a heading over an empty box. ⚑ RE-ANCHORED IN PLACE AGAIN BY 472, never retired: `472` DREW the band, so the sentence this row deleted is gone and what falls silent now is the list itself. The defect is the same one a person meets — conversations exist in this project and the band shows none of them',
        "node",
        [
            (WORK, 'v-if="conversations.rows.length > 0"', 'v-if="false"'),
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-016a, bd70d693):** The decisions band was a section of
        # the deleted project room (`ProjectWorkspace.vue`), and "Nothing in this project is waiting
        # on you." no longer exists anywhere in src. The person's queue is `PersonsQueue.vue`, which
        # is not project-scoped and has its own empty-state rows. Its anchor is left stale, so the
        # census records it retired.
        "M11 · ⛔ the decisions band falls silent when it is empty · M10's defect on the band a person checks when they are looking for what is blocked ⚑ RE-ANCHORED IN PLACE BY 452 RELAY 1: the sentence was a GAP (*nothing waiting on you is filed under a project*) until `453` put the project on the row; the band draws rows now and what is left in its place is the EMPTY state, which is the same defect on the same band",
        "node",
        [
            # ⚑ **Anchor corrected at `588`**: `EXT-013` §2.3 — *an empty section needs one line or
            # none* — so the two explanatory sentences are gone and the heading is the whole of it.
            # ⛔ The SUBJECT is unchanged: the band must not fall silent when it is empty.
            (WORK, 'Nothing in this project is waiting on you.', ''),
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-016a, bd70d693):** The disclosure named the project whose
        # rows might be missing (`realProject.slug`) inside the deleted room. With no project to
        # name, the defect has no subject. D-016 removed "the project rooms" on purpose. Its anchor
        # is left stale, so the census records it retired.
        'M12 · ⚠️ the short-list disclosure stops naming the project whose rows may be missing · *rows may be missing* with no subject is a statement about the app rather than about the project a person is standing in ⚑ SUBJECT CHANGED BY 452 RELAY 1: the anchor still resolves exactly once and it is now in the `mayBeShort` disclosure rather than in the retired gap, so the LABEL was corrected with it — a row whose words describe a defect it no longer plants is a verdict it never earned',
        "node",
        [
            (WORK, '<code>{{ realProject.slug }}</code', '<code>this project</code'),
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-016a, bd70d693):** The `project-decisions-all` button
        # that pointed at Home lived in the deleted room, and Home itself went in D-016 (the
        # commit's own tree removes `HomeSurface.vue`). The gap and its address are gone with the
        # project band. Its anchor is left stale, so the census records it retired.
        "M13 · 🔴 the gap names no address · HO-024 §5.3's other half: a named unknown that does not say where the answer IS leaves a person on a surface with nowhere to go, and Home is the only address the whole queue has",
        "node",
        [
            (WORK, '<button\n            class="band-act"\n            type="button"\n            data-cy="project-decisions-all"\n            @click="emit(\'home\')"\n          >\n            Everything waiting on you\n            <svg class="icon"><use href="#i-arrow" /></svg>\n          </button>', ''),
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-016a, bd70d693):** The 'Open in Finder' button was a
        # planted defect on the project workspace's folder band (`project-open-settings` /
        # `project-reveal`). The band, the project folder and their rails
        # (`project-folder-rails.ts`, `shared/project-folder.ts`) were deleted ("project folders and
        # their rails ... are removed"), and no `project-reveal` exists in src. Its anchor is left
        # stale, so the census records it retired.
        'M14 · ⛔ THE DEFECT OF THIS DISPATCH, put back · an *Open in Finder* button that looks live and does nothing, on a surface whose whole subject is controls that do nothing — the app owns one door onto the filesystem and it resolves a path from a live SESSION, which a project is not',
        "node",
        [
            # ⚑ **Anchor corrected at `588`**: the path moved into the folder strip and the
            # interpolation wraps, so the `</p>` it was anchored against is gone. 🔴 **`588`
            # re-measured this refusal and it still holds** — the v2.7 mock draws `Copy` AND
            # `Open in Finder`, this app owns no clipboard-WRITE verb anywhere, and `revealPath`
            # (`main/index.ts:370`) is keyed to a live SESSION whose four targets a project is not.
            # ⛔ Same defect: a control that looks live and cannot work.
            (WORK, '<span class="spacer"></span>\n        <button\n          class="band-act"\n          type="button"\n          data-cy="project-open-settings"', '<button class="band-act" type="button" data-cy="project-reveal">Open in Finder</button>\n        <span class="spacer"></span>\n        <button\n          class="band-act"\n          type="button"\n          data-cy="project-open-settings"'),
        ],
    ),
    (
        # ⚑ Landing D-016a (bd70d693) · killer:
        # `a-folder-on-the-screen-can-be-copied-with-one-click.dom.test.ts` (the landing added it;
        # no existing test observed this plant).
        "M15 · 🔴 the path stops being selectable · this app has no clipboard-write door of any kind, so `user-select: all` is not a nicety here — it is the whole answer to the drawing's Copy button, and without it the folder is on the screen and out of reach",
        "node",
        # ⚑ Landing D-016a (bd70d693) · re-anchored in place, not retired (a second reviewer refuted
        # its retirement) — The rule survives: SessionInfo.vue `.path { cursor: text; overflow-wrap:
        # anywhere; user-select: all; }` (~743-746, drawn for cwd, home and config files) is the
        # only way to copy a folder, since the app still has no clipboard-write door (main only
        # calls clipboard.readImage). The anchor is unique in that file, but NO test today asserts a
        # computed userSelect. The only user-select assertion in the tree is
        # build-identity.test.ts:362 for `.sync-detail`, and the deleted
        # the-room-behind-the-door.dom.test.ts line 254 was the only one for paths, so this plant
        # SURVIVES as it stands. It needs one new dom assertion,
        # `getComputedStyle(index.host.querySelector('[data-cy="session-cwd"]')).userSelect === 'all
        [
            (SESSIONINFO, '  user-select: all;\n', '  user-select: auto;\n'),
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-016a, bd70d693):** The label is about a project-room gap
        # wearing the dashed 'not built yet' placeholder treatment. That CSS block was in
        # `ProjectWorkspace.vue`, deleted, and the room's named gaps went with it. Its anchor is
        # left stale, so the census records it retired.
        'M16 · ⛔ a gap wears the placeholder treatment · dashed and faint means NOT BUILT YET in this app, so a true sentence about a reader that does not exist reads as a band a person should wait for',
        "node",
        [
            (WORK, '  border: 1px solid var(--line);\n  border-radius: var(--radius-md);', '  border: 1px dashed var(--line-strong);\n  border-radius: var(--radius-md);'),
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-016a, bd70d693):** The `projectSettings` sheet and the
        # row press that opened it were deleted (`ProjectSheet.vue`, `ProjectsBoard.vue`,
        # `ProjectWorkspace.vue`). The commit removed "the project rooms, board, sheet and picker"
        # on purpose, so no editor can open over a wrong project. Its anchor is left stale, so the
        # census records it retired.
        'M17 · ⚠️ the sheet opens over no row · the one wired act on this surface is an editor, and an editor opened without its subject is how a person saves over a project they were not looking at',
        "node",
        [
            (WORK, "overlays.open({ kind: 'projectSettings', projectSlug: row.slug })", "overlays.open({ kind: 'projectSettings', projectSlug: '' })"),
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-016a, bd70d693):** The 'Project settings' control opened
        # the project sheet from the folder band, and both the sheet and the band are deleted by
        # D-016 ("project folders and their rails", "sheet"). No surface has a project setting to
        # offer. Its anchor is left stale, so the census records it retired.
        "M18 · 🔴 the surface's only working control disappears · the folder band then names a place to choose a folder and offers no way to reach it, which is the picture this dispatch exists to stop",
        "node",
        [
            # ⚑ **Anchor corrected at `588`**: the press moved from a band bar into the folder
            # strip, which is one indent level shallower. ⛔ Same subject — it is this surface's
            # only working control.
            (WORK, '<button\n          class="band-act"\n          type="button"\n          data-cy="project-open-settings"\n          @click="openSettings"\n        >\n          <svg class="icon"><use href="#i-sliders" /></svg>\n          Project settings\n        </button>', ''),
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-016a, bd70d693):** `RuntimeScreen.vue` no longer has
        # `projectStore` or a `:real-projects` prop (grep finds neither), and the workspace that
        # received the roster is deleted. D-016 removed the project surfaces and the project store.
        # Its anchor is left stale, so the census records it retired.
        'M19 · ⛔ the roster never reaches the surface · `RuntimeScreen` keeps handing the rail its real projects and stops handing them to the workspace, so every real project falls through to the cold branch and draws nothing — the line no rendered test can see, which is why it is censused ⚑ RE-ANCHORED IN PLACE BY 472, never retired: the mount grew a `ref` and three props, so the old block anchor no longer resolves; it is the ONE line it was always about now, which is narrower and cannot go dark again for a neighbour\'s edit',
        "node",
        [
            (SCREEN, '          :real-projects="projectStore.projects.value"\n          :projects="seed?.projects ?? []"', '          :projects="seed?.projects ?? []"'),
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-016a, bd70d693):** `ProjectsBoard.vue` is deleted
        # ("project rooms, board, sheet and picker ... are removed"). There is no card that opens a
        # room or a settings sheet. Its anchor is left stale, so the census records it retired.
        "M20 · 🔴 the door leads back to the sheet · the card opens the editor the button beside it already opens, so there is again no gesture in this app that reaches a real project's workspace. ⚑ **Re-anchored at `572`**: `EXT-008` §1 moved both doors onto `ProjectsBoard`, where the card is the room and `Project settings` is the sheet",
        "node",
        [
            (BOARD, '@click="emit(\'open\', row.slug)"', '@click="emit(\'settings\', row.slug)"'),
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-016a, bd70d693):** The board's `emit('open', row.slug)`
        # door is gone with `ProjectsBoard.vue`, and so is the routing address it fed, the project
        # `place`. Nothing routes on a project slug any more. Its anchor is left stale, so the
        # census records it retired.
        'M21 · ⚠️ the door sends a NAME where a slug is expected · `place` takes a routing address and a display name is not one, so a project called *BroBot2* routes to nothing while one nobody has named still works — a defect that hides on exactly the rows a test is most likely to use. ⚑ **Re-anchored at `572`** onto the board, where the same substitution is available because the fold carries both',
        "node",
        [
            (BOARD, "emit('open', row.slug)", "emit('open', row.heading)"),
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-016a, bd70d693):** The board card press that opened a
        # project room was removed on purpose with the board and the room (card D-016a: "no Projects
        # anywhere (sidebar, rooms, cards)"). A missing press handler has no subject to protect. Its
        # anchor is left stale, so the census records it retired.
        'M22 · ⛔ the door is removed · the room is unreachable again and every band below is dead code, which is the state this dispatch found and the thing a green suite would not notice. ⚑ **Re-anchored at `572`**: the door is the card press now, and taking the handler off leaves a card that paints, hovers and does nothing — which is a WORSE state than the missing arrow was, and the reason the row keeps this row',
        "node",
        [
            (BOARD, '              @click="emit(\'open\', row.slug)"\n', ''),
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-016a, bd70d693):** `SideRail.vue` no longer has
        # `realProjectRows` or any project row (count 0 and grep finds none). The rail's project
        # destination was removed with the sidebar Projects list. Its anchor is left stale, so the
        # census records it retired.
        'M23 · ⚠️ the open project never marks itself · the rail shows which conversation is on screen and stops showing which project is, so a person cannot tell where they are from the list they navigated with. ⚑ **Re-anchored at `572` and the reading got WIDER rather than narrower**: the list is a destination row now, and the `some()` this removes is the half that keeps it lit while a ROOM is open — without it the row marks only the board itself, which is the exact sentence above',
        "node",
        [
            (RAIL, "realProjectRows.value.some((row) => row.slug === props.place)", "false"),
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-016a, bd70d693):** The `.row-wrap` flex box holding the
        # project card and its settings button was in the deleted `ProjectsBoard.vue`. Both the
        # board and the settings button are removed. Its anchor is left stale, so the census records
        # it retired.
        "M24 · \U0001f534 the project row stops being a flex box · the settings button drops below "
        "the project it belongs to and the board grows a second line per project. ⚑ "
        "**Re-anchored at `572`**: the box is `ProjectsBoard`'s `.row-wrap`, which is the same "
        "declaration doing the same job for the same two controls, one surface over",
        "node",
        [
            (BOARD, ".row-wrap {\n  display: flex;\n", ".row-wrap {\n"),
        ],
    ),
    # ── relay 1 · the band `453` closed the gap under ───────────────────────────────────────────
    (
        # ⛔ **RETIRED BY RULING (landing D-016a, bd70d693):** The band that drew rows filed under
        # one project, via `rowsInProject(...)` in the deleted room, is gone. The commit's
        # design-v2-map note says it: "the product has no projects now, and neither a queue row nor
        # its work carries one." Its anchor is left stale, so the census records it retired.
        "M25 · \U0001f534 the band draws the WHOLE queue · every question in the workspace under a heading that names one project, which is the *wrong* answer this band's whole argument is about — a person reading it is told that work in another project is waiting on them here",
        "node",
        [
            (WORK, "return rowsInProject(persons.view.value?.rows ?? [], row.slug)", "return persons.view.value?.rows ?? []"),
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-016a, bd70d693):** `rowsInProject` and
        # `PLACED_IN_A_NAMED_PROJECT` no longer exist in `persons-queue.ts`, and `PersonsQueueRow`
        # no longer carries `project` or `projectIs` (grep finds `ProjectIs` only in comments and a
        # migration). D-016 deleted per-project scoping of the queue. Its anchor is left stale, so
        # the census records it retired.
        "M26 · ⛔ the scoping stops reading the slug · every row whose `projectIs` admits a project lands in every project's band, so two projects open side by side show one another's decisions",
        "node",
        [
            (QUEUE, "PLACED_IN_A_NAMED_PROJECT[row.projectIs] && row.project === slug", "PLACED_IN_A_NAMED_PROJECT[row.projectIs]"),
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-016a, bd70d693):** The `Record<ProjectIs, boolean>`
        # vocabulary table and the `ProjectIs` type are removed. A partial-record relaxation on them
        # cannot be planted. Its anchor is left stale, so the census records it retired.
        "M27 · ⚠️ the vocabulary table becomes PARTIAL · a third `ProjectIs` — a placement this window could not read — stops being a compile error and starts being a silent exclusion, which is the omission HO-024 §5.3 forbids arriving as a type relaxation rather than as code",
        "node",
        [
            (QUEUE, "const PLACED_IN_A_NAMED_PROJECT: Readonly<Record<ProjectIs, boolean>> = {", "const PLACED_IN_A_NAMED_PROJECT: Readonly<Partial<Record<ProjectIs, boolean>>> = {"),
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-016a, bd70d693):** The per-project subset filter that M28
        # re-sorts is deleted along with `rowsInProject`. The whole queue's single blocked-since
        # order still exists, but the row's subject was the project band's second ordering, and the
        # DOM test 'ONE list, in blocked-since order' already guards the surviving order. Its anchor
        # is left stale, so the census records it retired.
        "M28 · ⛔ the band re-sorts the rows it was handed · criterion 17 orders ONE list oldest-blocked-first and a subset of a total order already is one, so this is the second ordering the criterion forbids — and it disagrees with Home over the same rows",
        "node",
        [
            (QUEUE, "  return rows.filter((row) => PLACED_IN_A_NAMED_PROJECT[row.projectIs] && row.project === slug)", "  return rows\n    .filter((row) => PLACED_IN_A_NAMED_PROJECT[row.projectIs] && row.project === slug)\n    .slice()\n    .sort((left, right) => (left.key < right.key ? -1 : 1))"),
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-016a, bd70d693):** `v-if="decisions.length > 0"` was the
        # project room's decisions band, in the deleted `ProjectWorkspace.vue`. The band is deleted
        # with the room ("the project rooms ... are removed"). Its anchor is left stale, so the
        # census records it retired.
        "M29 · \U0001f534 the rows are not drawn at all · the band is back to the state `452` shipped, silently, over a field that is on the row — which is the gap going stale rather than going red",
        "node",
        [
            (WORK, 'v-if="decisions.length > 0"', 'v-if="false"'),
        ],
    ),
    (
        "M30 · ⛔ the population is drawn as its enum · `escalated` where Home says *Escalated to you — nobody above has answered*, so one row says two different things about who else might still pick it up depending on which surface a person is standing on",
        "node",
        # ⚑ Landing D-016a (bd70d693) · re-anchored in place, not retired — The rule survives: a
        # queue row draws its population in `KIND_WORDS`' sentence, never as the raw `kind` enum.
        # The project band that drew it is gone, but `PersonsQueue.vue` still draws `{{
        # KIND_WORDS[row.kind] }}` (line 538, exactly once), and `persons-queue.dom.test.ts` asserts
        # the sentences ('nobody else was ever asked', 'nobody above has answered'). The label's
        # "where Home says" should be reworded to the queue's own sentence, since Home and the
        # second surface are gone.
        [
            (PERSONSQUEUE, '{{ KIND_WORDS[row.kind] }}', '{{ row.kind }}'),
        ],
    ),
    (
        "M31 · ⚠️ the age loses the word that says WHICH clock · `9 minutes ago` over a routing nothing ever announced reads as *you were told 9 minutes ago*, and a row with no recorded time draws a blank at the bottom of a list ordered oldest-first, which reads as the newest thing in it",
        "node",
        # ⚑ Landing D-016a (bd70d693) · re-anchored in place, not retired — The project band that
        # drew this cell is gone, but the rule (an age keeps the word that says which clock, and a
        # missing stamp says where it sorted) still holds in PersonsQueue.vue, which draws the same
        # cell with sinceWords(row). No other mutation row plants that template line, so the swap is
        # re-anchored there and killed by the queue's own DOM test.
        [
            (PERSONSQUEUE, '{{ sinceWords(row) }}', '{{ row.since }}'),
        ],
    ),
    (
        "M32 · \U0001f534 the chain is dropped · criterion 20's *who asked* goes with it, and what is left is a sentence about a population and a button, with nothing saying which conversation a person is about to be taken to",
        "node",
            # ⚑ **613 · anchor CORRECTED IN PLACE, not retired** — a hop now draws its name AND
            # what that participant did (`PersonsQueueHop.did`), so the block moved and its
            # subject did not. Re-verified RED by hand against the band's own dom file.
        # ⚑ Landing D-016a (bd70d693) · re-anchored in place, not retired — ProjectWorkspace's
        # decision-chain list is deleted with the room, but PersonsQueue.vue still draws the
        # identical hop list (pq-chain, criterion 20's who-asked), and no mutation row pins it.
        # Planting v-if="false" on that <ol> drops the whole chain, which is the label's defect, and
        # the queue DOM test reads every hop name off it.
        # ⚑ Landing ui bb5b9b7e…128203e6 (UI-009 to UI-011) · re-anchored in place, not retired —
        # The rule survives on the queue: a decision or provider-question row draws its chain
        # (criterion 20's who asked). UI-009 added `v-if="!row.question"` to the `<ol
        # class="pq-chain">` (a question this app asked is its QuestionCard and draws no chain), so
        # the old two-line anchor is dark. The plant forces that guard to `false`, which drops every
        # chain. Killed by `persons-queue.dom.test.ts`, `the-chain-a-question-carries.dom.test.ts`.
        [
            (PERSONSQUEUE, '            v-if="!row.question"\n            class="pq-chain"\n', '            v-if="false"\n            class="pq-chain"\n'),
        ],
    ),
    (
        "M33 · ⛔ a walk that was STOPPED says nothing · the chain is still drawn, so the last name on it reads as the person who owes the answer — which is the one thing an unfollowable walk does not know",
        "node",
        # ⚑ Landing D-016a (bd70d693) · re-anchored in place, not retired — The band's 'chain could
        # not be followed' paragraph is gone, but PersonsQueue.vue keeps the same disclosure
        # (pq-gap, persons-queue-unfollowable-*) and the rule that a stopped walk names nobody as
        # the answerer is unchanged. Removing the paragraph's guard plants the label's defect, and
        # the queue DOM test asserts it is visible.
        # ⚑ Landing ui bb5b9b7e…128203e6 (UI-009 to UI-011) · re-anchored in place, not retired —
        # The rule survives: a stopped walk must say so and name nobody as the answerer. The
        # `pq-gap` paragraph's guard is now `v-if="row.unfollowable && !row.question"` (UI-009: a
        # question's card draws no chain or gap), so the old bare `v-if="row.unfollowable"` text is
        # gone. The plant forces the new guard to `false`. Killed by `persons-queue.dom.test.ts`,
        # `the-chain-a-question-carries.dom.test.ts`.
        [
            (PERSONSQUEUE, 'v-if="row.unfollowable && !row.question"', 'v-if="false"'),
        ],
    ),
    (
        "M34 · ⚠️ the act leaves the row behind · it sends a person to the whole queue instead of to the conversation the row names, so the band becomes a list of things to go and look for rather than a list of things to open",
        "node",
        # ⚑ Landing D-016a (bd70d693) · re-anchored in place, not retired (a second reviewer refuted
        # its retirement) — The subject moved from ProjectWorkspace's readDecision to
        # PersonsQueue.vue's `.pq-go` button, `go(row)` (line 769), which calls queue.take(row),
        # then doors?.travel(row) in persons-queue.ts:2476, then RuntimeScreen.vue:2622 `travel:
        # (row) => void goToQuestion(row)`. Table 434 M10 plants settle() and 506/718 plant later
        # halves of goToQuestion, so nothing plants this first hop. Swapping the click for a bare
        # `emit('leave')` (`emit` is declared at line 129) leaves the person on the queue instead of
        # the conversation the row names. Four dom tests go red on `travelled` staying empty: '🔴
        # pressing it travels, and names the row it travelled for' (line 729), '🔴 inside an overlay
        # it asks the host to clos
        [
            (PERSONSQUEUE, '@click="go(row)"', '@click="emit(\'leave\')"'),
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-016a, bd70d693):** The subject is ProjectWorkspace's
        # queueMayBeShort and its 'nothing in this project is waiting on you' band, deleted by D-016
        # ('the project rooms'). The false all-clear rule itself survives on
        # WaitingOnYou/homeAttention (`unread: persons.mayBeShort.value`, `allClear = count === 0 &&
        # !mayBeShort`) and is already pinned by 434, 685 and 1017 rows. Its anchor is left stale,
        # so the census records it retired.
        "M35 · \U0001f534 the band stops asking whether the queue is whole · `mayBeShort` is *at least one of the four holes*, and with it ignored an empty band says *nothing in this project is waiting on you* over a read that did not answer — `086`'s false all-clear, on the one surface that narrows the list",
        "node",
        [
            (WORK, "const queueMayBeShort = computed(() => persons.view.value?.mayBeShort ?? false)", "const queueMayBeShort = computed(() => false)"),
        ],
    ),
    (
        "M36 · ⛔ the empty sentence is drawn over a short list · the same false all-clear reached through the template rather than through the derivation, which is why both are rows",
        "node",
            # ⚑ **Anchor corrected at `588`**: the empty state is a one-line `band-quiet` rather
            # than a headed `band-gap` panel (`EXT-013` §2.3). ⛔ The GUARD is untouched.
        # ⚑ Landing D-016a (bd70d693) · re-anchored in place, not retired (a second reviewer refuted
        # its retirement) — The template half of the false all-clear now lives on Home:
        # WaitingOnYou.vue:206 passes `:alone` into AttentionQueue, whose `v-if="props.alone"`
        # branch draws 'Nothing needs you.' Table 401 M18 plants only the `onlyYou === 0` term
        # (`:alone="!attention.unread"`), so dropping the `!attention.unread` term has no row, and
        # homeAttention's `quiet` (the derivation half) is pinned by other rows. With the plant, a
        # read that did not answer (unread true, onlyYou 0) draws the headline, so '🔴 one read
        # refused and the other empty draws the disclosure, not silence' (line 629) goes red at
        # ~659, `expect(home.q('attention-clear').innerText).not.toContain('Nothing needs you.')`.
        # The paired positive in the same
        [
            (WAITINGONYOU, ':alone="onlyYou === 0 && !attention.unread"', ':alone="onlyYou === 0"'),
        ],
    ),
    (
        "M37 · ⚠️ the short-list disclosure is removed · the band draws what landed and says nothing about what did not, so a person cannot tell a quiet project from one whose ledger this window failed to read",
        "node",
        # ⚑ Landing D-016a (bd70d693) · re-anchored in place, not retired (a second reviewer refuted
        # its retirement) — The stated reason is wrong: PersonsQueue.vue (~486-508) draws four
        # `pq-short` disclosures (partial, noLedger, rowsDropped, stale), and no mutation table
        # mentions any of their data-cy names or `pq-short`. The no-ledger paragraph is the closest
        # to the label, a person told 'an empty list here says nothing' instead of seeing a quiet
        # project when the ledger could not be read. Removing it makes '🔴 no ledger behind the
        # answer draws the card, with the honest heading' (line 1378) fail at ~1382, where
        # `m.q('persons-queue-no-ledger')` finds nothing in the DOM. Sibling rows could plant the
        # partial (line 634), stale (line 1361) and rows-dropped (line 1401, also
        # a-nights-backlog-rehearsed.render.test.ts:1
        [
            (PERSONSQUEUE, '      <p v-if="view?.noLedger" class="pq-short" data-cy="persons-queue-no-ledger">\n        This app has no record to read just now, so an empty list here says nothing about what is\n        waiting on you.\n      </p>\n', ''),
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-016a, bd70d693):** `.decision-body { flex: 1 }` is CSS of
        # the deleted project band's decision rows in ProjectWorkspace.vue, and no `.decision-body`
        # exists in today's tree. The commit deleted the whole component on purpose (D-016 'project
        # rooms'). Its anchor is left stale, so the census records it retired.
        "M38 · ⚠️ the act stops sitting at the end of the row · the body is `flex: 0 1 auto`, the button follows the text, and the column of acts a person scans down becomes a ragged edge that moves with every conversation name",
        "node",
        [
            (WORK, ".decision-body {\n  display: flex;\n  flex: 1;\n", ".decision-body {\n  display: flex;\n"),
        ],
    ),
]
