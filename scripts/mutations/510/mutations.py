"""510 · the id this app hands a person and cannot open — each row is THE DEFECT, put back (131).

🔴 **the person, from live use.** A work report in his `brobot-workspace` conversation ended with:

    The full response is document doc:default:4:response. Read it with read_document.

⛔ **He asked where he opens it. There was nowhere.** ⚑ The bytes existed —
`documents/default/004-response.md`, the substance of the answer rather than a header — and the app
had printed their id into his transcript beside an instruction he cannot follow.

## ⚠️ The sentence is CORRECT, and every row below respects that

`replyText` addresses the parent AGENT; `read_document` is that agent's tool; `380`'s rule is why
an id appears there rather than a path. ⛔ **Nothing about those words is the defect, and no row
here mutates them.** What was missing is a door for the PERSON reading the same row.

## ⛔ The four properties these rows guard

 1. ⚑ **The id is a FIELD and the control is derived from it** — never parsed out of the prose
    beside it, which `work-report.ts` forbids by name and which the row's own body contains.
 2. ⛔ **The document travels as an ARGUMENT, never off the `TaskRow`** — the row `deliverReply`
    holds is the task as the lookup found it, so its `documentId` is the PREVIOUS reply's.
 3. 🔴 **The person's door is a SIBLING of `read_document`, not a widening of it** — it asks no
    entitlement (HO-005, *"the human is unrestricted"*) and is bounded by `documentsRoot` instead.
 4. ⚠️ **Its five refusals say five different true things** — including `unreadable` rather than
    `gone`, because `documentBytes` answers one rail for six causes and one of them is a file
    sitting right there and too large.

## 🔴 The asymmetry, which is the opposite of `506`'s

⛔ **`workUndriven` can never carry a document, and it is STRUCTURAL rather than *nothing has
replied yet*.** A `documentId` reaches a `TaskRow` only through `deriveTasks`' `task_replied`
branch; that branch settles the row to `answered`; `answered` is not `TASK_IS_OPEN`, so the fold
deletes it from `open`; and `stall` returns on a row `open` no longer holds. ⚑ `506` had to put
`assignedTo` on BOTH constructors precisely because it is not asymmetric — this one is, so there is
no row below that mutates `workUndriven`, and `finished-and-finished-with-a-question.test.ts`'s
untouched `workUndriven` key census is what would notice if it grew a document.

## 🔴 The gate map — which file kills which row

| rows | killer |
|---|---|
| M1, M2, M3 | `apps/desktop/test/the-id-this-app-hands-a-person.test.ts` §1, and `finished-and-finished-with-a-question.test.ts` §2's positive arm |
| M4, M5 | `the-id-this-app-hands-a-person.test.ts` §2 — the planted row that spells its way out of the tree |
| M6, M7, M8 | …the same file's §2, the five answers |
| M9 | …the same file's §2 — the path that must never reach a person's screen |
| M10, M11, M12 | …the same file's §3, and `the-id-this-app-hands-a-person.render.test.ts` §1 |
| M13 | `the-id-this-app-hands-a-person.render.test.ts` §1, the surface with no reader |
| M14 | `apps/desktop/test/dom/work-report.dom.test.ts` §7 — two presses and the clock at 1180 |
| M15 | …the same file's §7 — the `067` race, driven with the read held open |

⛔ **The table was NOT run.** Every row below was applied ALONE, watched go red against the gate
named above, and restored from bytes with a SHA-256 re-check — which is what
`verify-each-mutation-row` is for and is not the same claim as a table run.

## ⚠️ What is deliberately NOT here

 - ⛔ **No row on `replyText`.** Its sentence is addressed to an agent and is correct; `400`, `484`
   and `393` already guard that function, and pinning one rule in two tables is how a verdict comes
   to be inherited rather than earned.
 - ⛔ **No row on `documentBytes` or `mayReadDocument`.** `380` owns three HOST rows and one
   REGISTRY row there, and `510` built a sibling method precisely so they stay alive. A row here
   would be this dispatch claiming a rule `380` measured.
   ⚑ **517 · M4 now anchors in `documentBytes` and the bullet above is why that is not a
   contradiction.** The sentence forbade `510` from claiming a rule `380` had measured; the rule
   M4 measures is `510`'s own placement, which HO-043 §1 moved into that function. ⛔ The anchor
   followed the rule rather than the rule being re-claimed, and `380`'s four rows there are
   untouched — `M30`'s `if (read.sha256 !== record.contentSha256) {` is still exactly once.
 - ⚠️ **No row that makes `documentId` REQUIRED on the wire.** A type-only edit changes no
   behaviour, every test that omits the key still passes, and *a mutation that changes nothing
   reports as a survivor*.
 - ⚠️ **No row on the `.go-to-conversation` CSS the press borrows.** `506` already refused one for
   the measured reason: a deleted declaration lands on the BASE style, which at the one width the
   pane mounts is indistinguishable (*a style mutation's control is the state it falls back to*).
 - ⛔ **No row on this dispatch's own census regeneration.** *A mutation on a census is invisible
   to that census.*
 - ⚠️ **No row on the six prose corrections.** They are sentences, not behaviour; standing rule 19
   is what makes them correctable and no mutation can make a docblock false in a way a test sees.
"""

RAILS = "apps/desktop/src/main/runtime/reply-rails.ts"
HOST = "apps/desktop/src/main/runtime/runtime-host.ts"
# ⚑ **517 · added when M4's anchor followed its rule into the shared reader** (HO-043 §1).
REGISTRY = "apps/desktop/src/main/documents/document-registry.ts"
LIB = "apps/desktop/src/renderer/src/lib/the-document-a-report-names.ts"
ENTRY = "apps/desktop/src/renderer/src/components/WorkReportEntry.vue"
VIEW = "apps/desktop/src/renderer/src/components/TranscriptView.vue"
PANE = "apps/desktop/src/renderer/src/components/ConversationPane.vue"
# ⚑ **640 · added when M15's anchor followed its rule into the fold's one component.**
OVERLAY = "apps/desktop/src/renderer/src/components/CanonicalDocumentOverlay.vue"
RESOURCES = "apps/desktop/src/main/resources/resources.ts"

MUTATIONS = [
    # ── the wire: what the parent's ledger records ──────────────────────────────────────────────
    (
        "M1 · ⛔ the report stops carrying the document · the id stays in the prose, where a person "
        "can read it and not press it — which is the exact state the person photographed, restored",
        # ⚑ Landing D-016b (5e931be8, the tree) · re-anchored in place, not retired — The rule
        # survives D-016 unchanged: the report carries the ids as a FIELD (WorkReport.resources,
        # spread only when non-empty) so the row can press them. The subject moved from documentId
        # to resources in reply-rails.ts workAnswered; the plant deletes the spread so the ids stay
        # only in the prose. Killed by `the-id-this-app-hands-a-person.test.ts`,
        # `finished-and-finished-with-a-question.test.ts`.
        [
            (RAILS, '    ...(resources.length === 0 ? {} : { resources }),\n', ''),
        ],
    ),
    (
        "M2 · 🔴 the id is picked off the ROW instead of the argument · `task` is the task as the "
        "lookup found it, so every report names the PREVIOUS reply's document or none — the same "
        "staleness `state` is written-not-copied to avoid, three lines up",
                # ⚑ **707 · re-anchored in place, not retired** — R40 added `projectSlug` to the `Pick`; the row still reads the id off the row.
        # ⚑ Landing D-016a (bd70d693) · re-anchored in place, not retired — The rule that
        # `workAnswered` takes the document as an argument and never off the task row survives. Only
        # the `Pick<TaskRow, ...>` lost `'projectSlug'`, so edit 1's old text moved (count 0). Edit
        # 0 still matches once, and edit 1 is re-cut to today's Pick, which is a type-only edit.
        # ⚑ Landing D-016b (5e931be8, the tree) · re-anchored in place, not retired — workAnswered
        # still takes the ids as an argument and its docblock still says 'PASSED, and never picked
        # off piece', because the piece is the row as it was BEFORE the reply. PieceRow now has a
        # real `resources` field, so the plant reads the ids off the row (adding 'resources' to the
        # Pick to stay type-honest) instead of the argument. Killed by
        # `the-id-this-app-hands-a-person.test.ts`, `finished-and-finished-with-a-question.test.ts`.
        [
            (RAILS, "piece: Pick<PieceRow, 'piece' | 'label' | 'owner'>,\n  reply: { outcome: TaskOutcome; needsUserAction: boolean },\n  /**\n   * ⛔ **510 · PASSED, and never picked off `piece`**", "piece: Pick<PieceRow, 'piece' | 'label' | 'owner' | 'resources'>,\n  reply: { outcome: TaskOutcome; needsUserAction: boolean },\n  /**\n   * ⛔ **510 · PASSED, and never picked off `piece`**"),
            (RAILS, '    ...(resources.length === 0 ? {} : { resources }),', '    ...((piece.resources ?? []).length === 0 ? {} : { resources: piece.resources }),'),
        ],
    ),
    (
        "M3 · ⚠️ the spread inverts · a reply with no document writes `documentId: null` and one "
        "WITH a document writes no key at all — the first `null` on a wire whose own rule is "
        "*absent, never null*, and the press disappears from exactly the rows that have one",
        # ⚑ Landing D-016b (5e931be8, the tree) · re-anchored in place, not retired — The 'absent,
        # never null' spread rule on the report survives with resources: a reply that kept nothing
        # must leave no key. The plant inverts the spread condition in workAnswered, so an empty
        # reply writes `resources: []` and a reply WITH files writes no key. Killed by
        # `the-id-this-app-hands-a-person.test.ts`, `finished-and-finished-with-a-question.test.ts`.
        [
            (RAILS, '    ...(resources.length === 0 ? {} : { resources }),', '    ...(resources.length === 0 ? { resources } : {}),'),
        ],
    ),
    # ── the person's door: what bounds it ───────────────────────────────────────────────────────
    # ⚑ **517 · CORRECTED IN PLACE, not retired** (HO-043 §1). The rule this row measures did not
    # die; it MOVED. `510` placed the path in `readCanonicalDocument` and reported that
    # `documentBytes` contained nothing; the PO ruled the placement into `documentBytes`, so the
    # anchor follows it into `REGISTRY` and the label's last clause — *`documentBytes` has never
    # contained anything* — is corrected with it. ⛔ **Table `510` is `unrun`, so there is no
    # verdict to inherit** (`a-corrected-anchor-keeps-a-verdict-it-never-earned` has nothing to
    # keep here), and the corrected row was re-applied alone and watched go red.
    #
    # ⚠️ **It now guards BOTH doors, which is what the move means**: deleting the placement hands
    # an out-of-tree row to a window AND to `read_document`. `517 M1` is the narrower sibling that
    # restores exactly `510`'s asymmetry, and only the agent's door notices it.
    (
        "M4 · 🔴 the containment goes · a `document` row whose `canonical_path` spells its way out "
        "of the tree is read and handed to a window and to `read_document` — `join` normalises "
        "`..` and the column carries no CHECK, so the only thing in front of it is this call",
                # ⚑ **Re-anchored in place at `726` (R92)**: `placeResource` answers `why` now; the defect is unchanged.
        # ⚑ Landing D-016b (5e931be8, the tree) · re-anchored in place, not retired — The rule
        # survives and is stronger: resourceBytes in resources.ts is the one reader that holds a
        # hand-edited row's name inside <userData>/resources/<sha256>/, with three guards
        # (one-segment name and hash spelling, lexical within, real-path within). The old
        # placeResource call is gone, so the plant removes all three guards; removing only one would
        # stay green because isOneSegment catches a '../' name before the lexical arm. Killed by
        # `one-rule-one-place.test.ts`, `the-id-this-app-hands-a-person.test.ts`.
        [
            (RESOURCES, "  if (!SHA256_HEX.test(row.sha256) || !isOneSegment(row.name)) {\n    return refused('resource-bytes-unreadable')\n  }\n", ''),
            (RESOURCES, "  if (!within(lexicalRoot, lexicalPath)) return refused('resource-bytes-unreadable')\n", ''),
            (RESOURCES, "  if (!within(filesystemSpelling(lexicalRoot), realPath)) {\n    return refused('resource-bytes-unreadable')\n  }\n", ''),
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-016b, 5e931be8, the tree):** D-016 dropped the person's
        # 'outside' word on purpose: ResourceReading is now four reasons ('no-such-resource' |
        # 'no-store' | 'unreadable' | 'changed'), and its docblock says 'unreadable — the file is
        # absent, is not a plain file, or cannot be read: each ends with a person going to look, so
        # one word serves.' A row pointing out of the tree is now `resource-bytes-unreadable` at
        # both doors, and one-rule-one-place asserts the person's door 'fold[s] this into
        # `unreadable`'. The agent-door version of this rule is 517 M2. Its anchor is left stale, so
        # the census records it retired.
        "M5 · ⛔ a row pointing out of the tree reports as *this app could not read its file* · the "
        "one refusal that names a defect in the app's own data is spelled as an ordinary disk "
        "problem, and nobody looks for it",
        [
            # ⚑ **517 · corrected in place.** The subject is unchanged — the person's door losing
            # the one refusal that names a defect in the app's own data — and only the shape of
            # the arm moved, because the rail it reads is now a document rail rather than a
            # resource rail.
            (
                HOST,
                "          bytes.refusal.rail === 'document-path-outside-tree'\n"
                "            ? 'outside'\n"
                "            : bytes.refusal.rail === 'document-bytes-changed'\n",
                "          bytes.refusal.rail === 'document-bytes-changed'\n",
            )
        ],
    ),
    (
        "M6 · ⚠️ *this app keeps no documents tree* is folded into *there is no such document* · the "
        "agent door's non-enumeration answer, given to a person who has nothing to enumerate — so a "
        "build with no registry tells everyone their documents do not exist",
        # ⚑ Landing D-016b (5e931be8, the tree) · re-anchored in place, not retired — The
        # distinction survives with new words: readResourceForAPerson says 'no-store' when the host
        # has no resources tree, and 'no-such-resource' only when the id names nothing. The plant
        # folds 'no-store' into 'no-such-resource', replacing the old no-registry/no-such-document
        # pair. Killed by `the-id-this-app-hands-a-person.test.ts`.
        [
            (HOST, "    if (root === undefined) return { ok: false, reason: 'no-store' }", "    if (root === undefined) return { ok: false, reason: 'no-such-resource' }"),
        ],
    ),
    (
        "M7 · 🔴 the person's door grows the AGENT's entitlement · `mayReadDocument` asks *did you "
        "register it, or are you its parent*, and a window is neither — so every document becomes "
        "unopenable from the surface `510` exists to serve",
                # ⚑ **517 · the third line of this anchor was the comment above the placement,
                # and the placement moved.** The two lines that remain are still exactly once in
                # the file — `readDocument` looks the row up differently — so the anchor shortens
                # rather than moving.
                # 🔴 **549 · the REPLACEMENT was repaired, and the anchor was not touched.** It
                # called `this.mayReadDocument(record.sourceSessionId, documentId)`, and HO-057
                # DELETED that predicate — so this row still applied, would still have gone red, and
                # would have gone red on a missing method rather than on the rule it names.
                # ⛔ **A census reads ANCHORS and cannot see a replacement rot.**
                # ⚑ **The three arms are inlined verbatim**, `documentId` kept in the caller
                # position exactly as before, so what this row measures is unchanged.
                # ⚠️ **Re-verified RED by hand at `549`** — a repaired edit keeps a verdict it never
                # earned until somebody re-takes it.
        # ⚑ Landing D-016b (5e931be8, the tree) · re-anchored in place, not retired — HO-057/549
        # withdrew the entitlement at both doors, but the rule 'a window is no caller, so the
        # person's door asks nothing about who is asking' survives (HO-005) and is asserted in '549
        # · neither door asks an entitlement now'. The plant makes the person's door require that
        # the resource was added by the id it is given, a stand-in for the caller a window does not
        # have, so every resource becomes unopenable from the window. Killed by
        # `the-id-this-app-hands-a-person.test.ts`.
        [
            (HOST, "    if (row === null) return { ok: false, reason: 'no-such-resource' }", "    if (row === null || row.addedBy !== resourceId) return { ok: false, reason: 'no-such-resource' }"),
        ],
    ),
    (
        "M8 · ⚠️ *the bytes are not what was registered* collapses into *could not read it* · the "
        "one refusal a person can act on — the registry re-hashes on every read — is reported as a "
        "failure of the app rather than as a fact about the file",
            # ⚑ **517 · corrected in place** — the arm is a nested ternary now that a third rail
            # reaches this door, and the row's subject did not move.
        # ⚑ Landing D-016b (5e931be8, the tree) · re-anchored in place, not retired — The person's
        # door still separates 'the bytes are not what was kept' from 'could not read it', because
        # the hash is re-checked on every read and the first is a fact a person can act on. The
        # plant collapses the `resource-bytes-changed` ternary in readResourceForAPerson into
        # 'unreadable'. Killed by `the-id-this-app-hands-a-person.test.ts`.
        [
            (HOST, "        reason: read.refusal.rail === 'resource-bytes-changed' ? 'changed' : 'unreadable',", "        reason: 'unreadable',"),
        ],
    ),
    (
        "M9 · ⛔ the panel is handed the PATH instead of the file's name · `380` keeps the canonical "
        "tree's spelling off every wire because it is the one string a caller may not use, and this "
        "puts it on a person's screen in the toolbar",
        # ⚑ Landing D-016b (5e931be8, the tree) · re-anchored in place, not retired — The rule
        # survives: the panel is handed the file's NAME and never the tree's spelling (380's rule;
        # the field is documented 'the FILE's name as it was handed in, never a path'). The plant
        # hands the window the full kept path join(root, sha256, name) instead of row.name. Killed
        # by `the-id-this-app-hands-a-person.test.ts`.
        [
            (HOST, '      name: row.name,', '      name: join(root, row.sha256, row.name),'),
        ],
    ),
    # ── the fold: what the row may offer ────────────────────────────────────────────────────────
    (
        "M10 · 🔴 the type guard becomes a presence check · `toPersistedEvents` CASTS and a `.brobot` "
        "bundle is `.passthrough()`d, so `documentId: 42` and `documentId: {}` are bytes on disk — "
        "and a press built from one sends a number to the bridge",
        # ⚑ Landing D-016b (5e931be8, the tree) · re-anchored in place, not retired — The renderer
        # guard survives as theResourcesAReportNames in the-document-a-report-names.ts. It filters
        # each id by `typeof === 'string'` because a cast wire or a .passthrough() bundle can carry
        # 42 or {} as bytes on disk. The plant swaps the type guard for a presence check (keeping
        # the empty-string exclusion so only the type arm is measured). Killed by
        # `the-id-this-app-hands-a-person.test.ts`.
        [
            (LIB, "  return resources.filter((id): id is string => typeof id === 'string' && id.length > 0)", "  return resources.filter((id): id is string => id !== undefined && id !== '')"),
        ],
    ),
    (
        "M11 · ⛔ the surface's own answer is ignored · a transcript rendered with no reader behind "
        "it grows a press that reaches nothing when pressed, which is `106` and the dead button "
        "`108`'s review found on this exact pane",
        # ⚑ Landing D-016b (5e931be8, the tree) · re-anchored in place, not retired — The rule
        # survives: a surface with no reader behind it (canOpen false) draws no press, which is
        # `106`'s dead-button rule, and the TranscriptView default of no reader is pinned. The plant
        # ignores the surface's answer in theResourcesAReportNames. Killed by
        # `the-id-this-app-hands-a-person.test.ts`, `the-id-this-app-hands-a-person.render.test.ts`.
        [
            (LIB, '  if (!canOpen || !Array.isArray(resources)) return []', '  if (!Array.isArray(resources)) return []'),
        ],
    ),
    (
        "M12 · ⚠️ an EMPTY id draws a press · a `.brobot` bundle carrying `documentId: \"\"` gets a "
        "control that asks main for nothing and is answered *there is no such document* — a control "
        "absent where nothing would make it work is `118`, and this is the inverse",
        # ⚑ Landing D-016b (5e931be8, the tree) · re-anchored in place, not retired — The empty-id
        # arm survives in theResourcesAReportNames: an id of '' from a bundle would draw a press
        # that asks main for nothing. The plant drops the `id.length > 0` half of the filter and
        # keeps the type guard. Killed by `the-id-this-app-hands-a-person.test.ts`.
        [
            (LIB, "  return resources.filter((id): id is string => typeof id === 'string' && id.length > 0)", "  return resources.filter((id): id is string => typeof id === 'string')"),
        ],
    ),
    # ── the wiring: where it draws and what it costs ────────────────────────────────────────────
    (
        "M13 · ⛔ every transcript claims it can read a document · `ChildWorkViewer` and any SSR "
        "mount draw the press with no fetch behind them — `canOpenStore`'s default is `false` for "
        "this exact reason, one prop up in the same block",
        [(VIEW, "    canOpenDocument: false,", "    canOpenDocument: true,")],
    ),
    (
        "M14 · 🔴 the press lands AFTER the clock · `.time` is `margin-left: auto`, so a control "
        "placed past it is pushed to the far right and the timestamp loses the slot `406` gave it — "
        "the row growing a control by taking a fact off it",
        # ⚑ Landing D-016b (5e931be8, the tree) · re-anchored in place, not retired —
        # WorkReportEntry.vue still lays out the meta row as heading, where-press, resource presses,
        # then the `.time` clock, and the render and layout tests still pin the press before the
        # clock. The old anchor `<button v-if="document"` is gone (the presses are now a v-for over
        # resources), so the plant moves the clock span to just before that v-for and removes it
        # from the end of the row. Killed by `the-id-this-app-hands-a-person.render.test.ts`,
        # `work-report.dom.test.ts`.
        # ⚑ Landing D-026, PE-007 and the ui files batch · re-anchored in place, not retired — The
        # rule survives: WorkReportEntry.vue still lays the meta row out as heading, where-press,
        # document presses, then the `.time` clock (margin-left:auto), and §7 of
        # work-report.dom.test.ts plus the render test still pin the presses before the clock.
        # UI-002's 1a1ec11a changed the v-for from `in resources` to `in presses` (only the files
        # the tree has not read keep a press), so the second edit's old text no longer matched; the
        # first edit (remove the clock from the end of the row) still matches once unchanged. With
        # no `kept` on the DOM/SSR mounts every id is unread, so the presses still draw and the
        # plant puts the clock between the where-press and the document press. Killed by
        # `the-id-this-app-hands-a-person.render.test.ts`, `work-report.dom.test.ts`.
        [
            (ENTRY, '        <span class="time">{{ clockTime(item.at) }}</span>\n      </div>', '      </div>'),
            (ENTRY, '        <button\n          v-for="(resource, index) in presses"', '        <span class="time">{{ clockTime(item.at) }}</span>\n        <button\n          v-for="(resource, index) in presses"'),
        ],
    ),
    (
        "M15 · ⛔ the conversation is stamped AFTER the read lands · a person who switches "
        "conversation while a document is being fetched gets it drawn over the next one — `067`'s "
        "defect, on the sixth panel, and the comment above the line is what it deletes. "
        "⚑ **ANCHOR CORRECTED at `640`, not retired — the subject MOVED and did not die.** "
        "`640` folded three document paths into one `CanonicalDocumentOverlay`, so the capture "
        "before the await is written once there instead of once per surface, and the field it "
        "stamps is `scope` — which `ConversationPane` hands its own `record.sessionId` in as. "
        "⚠️ **The rule is unchanged and its blast radius grew**: the same slip now reaches "
        "three surfaces. ⛔ Re-verified RED by hand against "
        "`three-ways-to-open-one-document.dom.test.ts`, whose held-open read drives this race at "
        "the component rather than at the pane",
        # ⚑ Landing D-016b (5e931be8, the tree) · re-anchored in place, not retired — The 067 race
        # guard survives in CanonicalDocumentOverlay.open(): the scope is captured before the await,
        # and the docblock still says so. The only change is naming (documentId became resourceId),
        # so the plant reads props.scope after the await. Killed by
        # `three-ways-to-open-one-document.dom.test.ts`.
        # ⚑ Landing D-026, PE-007 and the ui files batch · re-anchored in place, not retired — The
        # 067 guard survives in CanonicalDocumentOverlay.open(): the scope is captured before the
        # await and the docblock still says so. d023c051 (UI-002 §3) added a `file` field to the
        # stamped reading, so the old one-line anchor `{ scope, resourceId, result: await
        # read(resourceId) }` no longer matches; the new one includes `, file }` (once). The plant
        # reads props.scope after the await again, so a document fetched under one conversation is
        # drawn over the next. Killed by `three-ways-to-open-one-document.dom.test.ts`.
        [
            # ⚑ D-032's window half · re-anchored in place, not retired — the read is awaited on its
            # own line now, with the drawing after it; the plant stamps the scope after both, as before.
            (OVERLAY, '  reading.value = { scope, resourceId, result, file, drawing }', '  reading.value = { scope: props.scope, resourceId, result, file, drawing }'),
        ],
    ),
]
