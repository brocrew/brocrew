"""550 · The project page is showing fixtures about a real project.

⛔ **`548` Q3:** *"`ProjectWorkspace` receives FIXTURE `Document[]`, and `RuntimeScreen` supplies
fixture seed documents EVEN WHEN it is rendering a real `ProjectDetails` record."* ⚑ This table is
about the wire that replaces it, and every row breaks a rule the wire carries.

## 🔴 A · the two answers the store owes, and the one it must not give twice

⚠️ **`452` §5.1's forbidden sentence, on this noun, is *no documents in this project* drawn out of
a project this app does not hold or a read that could not answer.** ⛔ `M1` collapses the absent
arm into the empty list at its SOURCE; `M2` drops the slug fold, so a project with documents
answers empty under an unfolded spelling; `M3` turns the writer join into an inner one, which makes
a document VANISH because this app cannot say who wrote it; `M4` re-orders the list by the clock,
which renumbers what a person quotes.

## ⛔ B · the door, and what may not cross it

⚑ `M5` lets the read answer during a quit, which is the one thing that door exists to keep out.

## ⚠️ C · the fold's four states, each of which can be made to deny another

⛔ **Two sentences that deny each other on one screen is `304`.** `M6` certifies a project as empty
over a read that did not answer; `M7` certifies a NAME as absent over the same; `M8` draws the
covers sentence beside the absence it is already saying. ⚑ `M9` is the one that would name a
writer this app cannot name — `agentName(null, …)` answers *BroBot (default)*, and that function's
own docblock says *"Any OTHER caller owes the same check before asking."* ⚠️ `M10` reverses the
order the two doubts are asked in, which reports the older problem; `M11` moves the age threshold
off the poll it is derived from; `M12` writes the cadence as a number; `M13` drops the stamp that
keeps one project's list off another's heading; `M14` un-groups the byte count.

## 🔴 D · the band

⛔ `M15` draws a press on a room that was handed no door (`118`: absent, never dead); `M16` takes
the `:title` off the one line on the row that can be cut, which is a sentence a person cannot get
to (`530` F1); `M17` cuts the reading off at the component, so the band says *nothing has been
read yet* for ever.

## ⛔ What this table does NOT cover

 1. **`readCanonicalDocument`.** `510`'s door and `510`'s table; nothing here touches it.
 2. **The fixture room.** Its `documents` prop, its rail and `DocumentRow.vue` are unchanged, and
    a row breaking the seed's own path would be measuring `011` rather than this dispatch.
 3. **The `document` registry itself.** `380`'s table owns registration.
"""

STORE = "apps/desktop/src/main/db/session-store.ts"
HOST = "apps/desktop/src/main/runtime/runtime-host.ts"
IPC = "apps/desktop/src/main/runtime/ipc.ts"
FOLD = "apps/desktop/src/renderer/src/lib/project-documents.ts"
ROOM = "apps/desktop/src/renderer/src/components/ProjectWorkspace.vue"

MUTATIONS = [
    # ---- A · the store -------------------------------------------------------------------------
    (
        # ⛔ **RETIRED BY RULING (landing D-016a, bd70d693):** The whole project-documents read
        # (`documentsInProject`, the store method and `projectToWalk`, and its `no-such-project`
        # arm) is deleted in bd70d693: the IPC command, host method, preload door and store SQL are
        # all gone. Card: 'no Projects anywhere (sidebar, rooms, cards)'; the commit removes 'the
        # project rooms, board, sheet and picker'. Its anchor is left stale, so the census records
        # it retired.
        "M1 · 🔴 **`452` §5.1's forbidden sentence, at its source** · the absent arm becomes the "
        "empty list, so a slug no `project` row spells reports *this project has produced nothing*",
        [
            (
                STORE,
                "      const slug = projectToWalk(projectSlug)\n"
                "      if (slug === null) return { read: 'no-such-project' }",
                "      const slug = projectToWalk(projectSlug) ?? projectSlug\n"
                "      if (slug === null) return { read: 'no-such-project' }",
            )
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-016a, bd70d693):** `listProjectDocuments` and the
        # `documentsInProject` store method were removed with the project room's document band
        # (bd70d693 deletes `project-documents.ts` and `ProjectWorkspace.vue`, and their test
        # `the-documents-a-project-actually-produced.test.ts`). No slug-folded per-project document
        # list exists any more. Its anchor is left stale, so the census records it retired.
        "M2 · ⛔ **the fold is dropped** · `project.slug` is always stored folded, so the caller's "
        "own spelling answers an empty list for a project that has documents — `tasksIn`'s "
        "measured defect (`438`), inherited rather than repaired",
        [
            (
                STORE,
                "        documents: (documentSql().listProjectDocuments.all(slug) as ProjectDocumentRow[]).map(",
                "        documents: (\n"
                "          documentSql().listProjectDocuments.all(projectSlug) as ProjectDocumentRow[]\n"
                "        ).map(",
            )
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-016a, bd70d693):** The per-project document SQL
        # (`listProjectDocuments`, with its writer LEFT JOIN) was deleted in bd70d693 along with the
        # project band that drew it. `list_documents` now takes no argument and nothing lists 'what
        # a project produced'. Its anchor is left stale, so the census records it retired.
        "M3 · 🔴 **the writer join becomes an INNER join** · a document this app cannot attribute "
        "disappears from a person's list, which is the one thing a list of what a project produced "
        "may never do",
        [
            (
                STORE,
                "           LEFT JOIN provider_session s ON s.id = d.source_session_id",
                "           JOIN provider_session s ON s.id = d.source_session_id",
            )
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-016a, bd70d693):** The `ORDER BY d.sequence, d.kind`
        # query belonged to `listProjectDocuments`, which is deleted in bd70d693 with the project
        # rooms. The per-project document list it ordered no longer exists. Its anchor is left
        # stale, so the census records it retired.
        "M4 · ⚠️ **the order becomes the clock** · the NUMBER is what a person quotes and what names "
        "the file, so a list ordered by registration renumbers the page under them",
        [
            (
                STORE,
                "           LEFT JOIN agent_profile binding ON binding.id = s.agent_profile_id\n"
                "          WHERE p.slug = ? ORDER BY d.sequence, d.kind`,",
                "           LEFT JOIN agent_profile binding ON binding.id = s.agent_profile_id\n"
                "          WHERE p.slug = ? ORDER BY d.registered_at DESC`,",
            )
        ],
    ),
    # ---- B · the door --------------------------------------------------------------------------
    (
        # ⛔ **RETIRED BY RULING (landing D-016a, bd70d693):** The `documentsInProject` IPC command
        # and its `'refused'` entry in the quit-door table were removed in bd70d693 (the command
        # schema, handler case, preload bridge and host method all go). The row's subject is a
        # command that no longer exists. Its anchor is left stale, so the census records it retired.
        "M5 · ⛔ **the read answers during a quit** · it reaches `deps.store`, which is the one "
        "thing this door exists to keep out — and there is nothing a person could do with the "
        "answer while the window that asked is going away",
        [(IPC, "  documentsInProject: 'refused',", "  documentsInProject: 'allowed',")],
    ),
    # ---- C · the fold --------------------------------------------------------------------------
    (
        # ⛔ **RETIRED BY RULING (landing D-016a, bd70d693):**
        # `apps/desktop/src/renderer/src/lib/project-documents.ts` is deleted by bd70d693 (-340
        # lines), and the project page's document band with it. Projects stop being something a
        # person meets, so the empty-project certification has no surface. Its anchor is left stale,
        # so the census records it retired.
        "M6 · 🔴 **an empty project certified over a read that did not answer** · *No documents in "
        "this project yet* and *this list did not answer just now* both drawn, which is `304` — two "
        "things on one screen denying each other",
        [
            (
                FOLD,
                "    empty:\n      doubt === null &&\n      read.read === 'every-document-registered-in-that-project' &&",
                "    empty:\n      read.read === 'every-document-registered-in-that-project' &&",
            )
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-016a, bd70d693):** The fold `project-documents.ts` (and
        # its `no-such-project` covers sentence) is deleted in bd70d693 with the project rooms.
        # There is no project name a person can be told this app does not hold. Its anchor is left
        # stale, so the census records it retired.
        "M7 · ⛔ **a NAME certified as absent over a read that did not answer** · `M6`'s defect on "
        "the other arm: a read that could not answer may not say this app holds no project by that "
        "name",
        [
            (
                FOLD,
                "      doubt === null && read.read === 'no-such-project' ? READ_COVERS['no-such-project'] : null,",
                "      read.read === 'no-such-project' ? READ_COVERS['no-such-project'] : null,",
            )
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-016a, bd70d693):** The fold `project-documents.ts` and
        # the band that drew its covers sentence are deleted in bd70d693 (project rooms removed on
        # purpose). Nothing draws the 'no such project' absence any more. Its anchor is left stale,
        # so the census records it retired.
        "M8 · ⚠️ **the covers sentence is drawn beside the absence** · the band then says *nothing "
        "was read, because this app holds no project by that name* twice, in two elements",
        [
            (
                FOLD,
                "    says: read.read === 'no-such-project' ? null : says,",
                "    says,",
            )
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-016a, bd70d693):** The writer-line function in the
        # deleted `project-documents.ts` is gone. Its rule, an unattributable document is not drawn
        # as BroBot's, has no surviving caller: the per-project document band is removed and the
        # other document surfaces are keyed by their own tables. Its anchor is left stale, so the
        # census records it retired.
        "M9 · 🔴 **the null reaches `agentName`** · that function answers `profileLabel(null)` — "
        "*BroBot (default)* — so every document this app cannot attribute would be drawn as one "
        "BroBot wrote. ⛔ Its own docblock: *\"Any OTHER caller owes the same check before asking.\"*",
        [
            (
                FOLD,
                "  if (row.identity === null) return `Registered ${when}`\n"
                "  return `${agentName(row.identity, identities)} · registered ${when}`",
                "  return `${agentName(row.identity, identities)} · registered ${when}`",
            )
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-016a, bd70d693):** The two-doubt ordering lived only in
        # `project-documents.ts`, which bd70d693 deletes together with `ProjectWorkspace.vue`. The
        # subject was removed on purpose (project rooms and their document band). Its anchor is left
        # stale, so the census records it retired.
        "M10 · ⛔ **the two doubts are asked in the other order** · a read that BOTH failed and came "
        "back with an arm this build cannot spell then reports the older problem. ⚑ The two "
        "readings agree on every other input — `a-comparison-tested-where-both-sides-agree-measures-nothing`",
        [
            (
                FOLD,
                "  const doubt: DocumentsDoubt | null = !reading.answered\n"
                "    ? 'the-read-did-not-answer'\n"
                "    : says === null\n"
                "      ? 'a-word-this-app-cannot-spell'\n"
                "      : null",
                "  const doubt: DocumentsDoubt | null =\n"
                "    says === null\n"
                "      ? 'a-word-this-app-cannot-spell'\n"
                "      : !reading.answered\n"
                "        ? 'the-read-did-not-answer'\n"
                "        : null",
            )
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-016a, bd70d693):** The age threshold derived from
        # `DOCUMENTS_EVERY_MS` is in the deleted `project-documents.ts`; no project document reading
        # is polled any more. The file went in bd70d693 with the project band. Its anchor is left
        # stale, so the census records it retired.
        "M11 · ⚠️ **the age threshold moves off the poll** · a reading exactly one poll old then "
        "draws no age at all, and the boundary is the only place the derivation can be seen",
        [
            (
                FOLD,
                "    asOf: input.now - reading.at < DOCUMENTS_EVERY_MS ? null : agoWords(reading.at, input.now),",
                "    asOf: input.now - reading.at <= DOCUMENTS_EVERY_MS ? null : agoWords(reading.at, input.now),",
            )
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-016a, bd70d693):** `DOCUMENTS_EVERY_MS` was exported only
        # by the deleted `project-documents.ts` (the project band's poll cadence). The whole poll is
        # gone with the project rooms in bd70d693. Its anchor is left stale, so the census records
        # it retired.
        "M12 · ⛔ **the cadence becomes a number somebody chose** · it is the same VALUE today, so "
        "only the source census can see it — `a-bound-written-as-the-constant-cannot-pin-it`, and "
        "the reason `DOCUMENTS_EVERY_MS` is a symbol rather than `30_000`",
        [
            (
                FOLD,
                "export const DOCUMENTS_EVERY_MS = ROSTER_EVERY_MS",
                "export const DOCUMENTS_EVERY_MS = 30_000",
            )
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-016a, bd70d693):** The reading's project stamp
        # (`reading.slug !== input.forSlug`) is in the deleted `project-documents.ts`. With no
        # project rooms there is no heading a stale reading could be drawn under. Its anchor is left
        # stale, so the census records it retired.
        "M13 · 🔴 **the reading's project stamp is dropped** · a person who opens project A and then "
        "project B inside one round trip is shown A's documents under B's heading, which is the "
        "strongest false claim this band could make",
        [
            (
                FOLD,
                "  if (reading === null || reading.slug !== input.forSlug) return null",
                "  if (reading === null) return null",
            )
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-016a, bd70d693):** The byte-count formatter for the
        # project band's document lines is in the deleted `project-documents.ts`. The band and its
        # lines were removed on purpose in bd70d693. Its anchor is left stale, so the census records
        # it retired.
        "M14 · ⚠️ **the byte count loses its grouping** · the house idiom for a count is "
        "`toLocaleString()`, which `tool-answer.ts` and `context-meter.ts` both print counts with",
        [
            (
                FOLD,
                "  return bytes === 1 ? '1 byte' : `${bytes.toLocaleString()} bytes`",
                "  return bytes === 1 ? '1 byte' : `${bytes} bytes`",
            )
        ],
    ),
    # ---- D · the band --------------------------------------------------------------------------
    (
        # ⛔ **RETIRED BY RULING (landing D-016a, bd70d693):** `ProjectWorkspace.vue` (the room whose
        # document line this row plants) is deleted in bd70d693 as one of 'the project rooms, board,
        # sheet and picker'. `mayOpenADocument` still exists in ConversationPane and ReadingPane,
        # but those are different elements owned by other tables (e.g. 640 M7). Its anchor is left
        # stale, so the census records it retired.
        "M15 · ⛔ **a press on a room that was handed no door** · `118`: a control is ABSENT where "
        "nothing would make it work, and `108`'s review found the dead-control shape on exactly "
        "this kind of prop. ⚑ **ANCHOR CORRECTED at `640`, not retired — it is the same element "
        "and only the expression inside it moved.** The room asked `props.onReadCanonicalDocument` "
        "four times in this one element; it now asks `mayOpenADocument`, which is "
        "`aSurfaceMayOpenADocument` — the app's one answer since the fold. ⚠️ **This row still "
        "says *this surface stops asking***, and `640 M7` is the neighbouring row where the RULE "
        "itself answers wrong: they fail differently and on different files. ⛔ Re-verified RED "
        "by hand against `the-documents-a-project-actually-produced.dom.test.ts`",
        [
            (
                ROOM,
                "                :is=\"mayOpenADocument ? 'button' : 'div'\"",
                "                :is=\"'button'\"",
            )
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-016a, bd70d693):** The `project-document-wrote-*` writer
        # line lived in the deleted `ProjectWorkspace.vue` document band (bd70d693, -2735 lines). No
        # surviving element carries that line or its `:title`. Its anchor is left stale, so the
        # census records it retired.
        "M16 · 🔴 **the writer line loses its `:title`** · a display name is bounded only by "
        "`AGENT_DISPLAY_NAME_CHARS` and `textContent` is identical whether Chromium drew it or cut "
        "it (`530` F1), so what is lost is lost silently",
        [
            (
                ROOM,
                "                  <small :title=\"row.wrote\" :data-cy=\"`project-document-wrote-${row.documentId}`\">{{",
                "                  <small :data-cy=\"`project-document-wrote-${row.documentId}`\">{{",
            )
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-016a, bd70d693):** Its defect (the fixture room's
        # demo-seed `Document[]` drawn under a real project's heading) needs both the project page
        # and the demo seed, and bd70d693 deletes `ProjectWorkspace.vue`, `demo-seed.ts` content and
        # the renderer fixtures ('Proposals go end to end, with the demo seed, the renderer
        # fixtures'). Its anchor is left stale, so the census records it retired.
        "M18 · 🔴 **THE SHIPPED DEFECT, PLANTED** · the band draws the demo seed's `Document[]` — "
        "which `RuntimeScreen` still hands this component for its fixture room — under a REAL "
        "project's heading. ⛔ `548` Q3's sentence, made reachable: *the project page has been "
        "telling a person things about a real project that came from a fixture*. ⚑ This is the row "
        "that proves the suite catches the FIXTURE and not merely the absence (`550` §4.2)",
        [
            (
                ROOM,
                '            <li v-for="row in documentsHere.rows" :key="row.documentId" class="document-line">',
                '            <li v-for="row in props.documents" :key="row.id" class="document-line">',
            )
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-016a, bd70d693):** `reading: props.documentsInProject`
        # was a prop of the deleted `ProjectWorkspace.vue`; the `documentsInProject` wire is gone as
        # well. Projects stop being something a person meets (D-016a). Its anchor is left stale, so
        # the census records it retired.
        "M17 · ⛔ **the reading is cut off at the component** · the band then says *nothing has been "
        "read yet* for ever, which is the one absence the wire cannot carry being drawn over a wire "
        "that answered",
        [
            (
                ROOM,
                "    reading: props.documentsInProject ?? null,",
                "    reading: null,",
            )
        ],
    ),
]
