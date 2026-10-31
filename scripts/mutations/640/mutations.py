"""640 · Three ways to open one document, folded to one.

⛔ **Ordered by `00-backlog` D14** — ⚑ boarded by `562` §6 with a TRIGGER (*"a fourth surface
needs to open a canonical document"*) and pulled by `635`, which widened a document from
Markdown-only to pages, images and PDFs.

## 🔴 What the fold was

⚑ **`562` measured the DECIDING and found ONE of each** — *may this be pressed here* · *what the
press says* · *where it goes* · *who fetches* · *what a failure shows*. ⛔ **What was three was
HOW**: `ConversationPane` (510), `ReadingPane` (510) and `ProjectWorkspace` (550) each held a
`readingDocument`, each mounted their own `OverlayHost` + `CanonicalDocumentViewer`, and each
spelled the may-open test for themselves — four times over, in the room's one row element.

⚠️ **`CanonicalDocumentOverlay.vue` and `lib/opening-a-document.ts` are the whole of the fold.**
🔴 **Nothing about the five above changed**, and the rows in group D exist to make that a
measurement rather than a promise.

## The row groups

 * `M1`-`M4`   ⛔ **the fold, un-folded** — a second mount site, a surface that keeps its own
                fetched state, a panel that never draws, an overlay nobody wired.
 * `M5`-`M7`   ⚠️ **the door** — `106`'s rule inverted, re-spelled, and made to always say yes.
 * `M8`-`M10`  🔴 **the `067` guard, now INHERITED rather than re-derived** — the watch, the
                comparison, and the surface that stops naming which conversation it is.
 * `M11`-`M13` ⛔ **the three of `562`'s five that this fold could plausibly have moved** — the
                word the press says, the event it travels on, and the sentence a failure shows.
 * `M14`-`M15` ⚠️ **viewing never executes** — the overlay drawing the bytes itself instead of
                mounting the panel, and the panel's form branch going back to one.

## ⚑ What this table cannot reach, stated because a table silent about its edges is claiming them

 * ⛔ **No row turns `html: false` into `html: true`.** ⚑ That is `635 M13`, and `HO-097` §1.3's
   guarantee belongs to the dispatch that made it — a second row on the same line would report as
   a survivor the day either table is run against a tree the other has already mutated
   ([[a-mutation-on-a-census-is-invisible-to-that-census]]).
 * ⛔ **No row on the capture BEFORE the await, although the fold moved that line into this
   dispatch's own file.** ⚑ It is `510 M15`, whose anchor `640` CORRECTED rather than retired —
   the subject moved out of `ConversationPane` and into `CanonicalDocumentOverlay`, and the row
   that has carried that rule since `510` carries it still. ⚠️ A row here was written, verified
   red, and then withdrawn for exactly the reason the `html: false` bullet above gives.
 * ⚠️ **No row touches `RuntimeScreen.vue`.** `mla/fe-1` holds eight unmerged renderer commits and
   that file is in them (§5 of the dispatch). ⛔ So *who fetches* is asserted from the source by
   `three-ways-to-open-one-document.test.ts` and mutated by nobody here.
 * ⚠️ **No row makes the overlay's panel too WIDE for its host.** `a-stop-a-modal-cannot-cover`
   owns the geometry of every overlay in this app and measures the widest document state there;
   a row here would be a second reading of it.

## ⚑ WRITTEN, not run

⛔ **Standing memory: writing rows is routine, RUNNING a table is rare and deliberate.** Every row
below was verified RED by hand against its killer file, one row at a time, restoring from bytes —
no `mutations.txt` exists at this HEAD and its absence is the honest state.
"""

from __future__ import annotations

OVERLAY = "apps/desktop/src/renderer/src/components/CanonicalDocumentOverlay.vue"
RULE = "apps/desktop/src/renderer/src/lib/opening-a-document.ts"
PANE = "apps/desktop/src/renderer/src/components/ConversationPane.vue"
READING = "apps/desktop/src/renderer/src/components/ReadingPane.vue"
ROOM = "apps/desktop/src/renderer/src/components/ProjectWorkspace.vue"
VIEWER = "apps/desktop/src/renderer/src/components/CanonicalDocumentViewer.vue"
REPORT = "apps/desktop/src/renderer/src/lib/the-document-a-report-names.ts"

MUTATIONS: list[tuple[str, list[tuple[str, str, str]]]] = [
    # ── A · the fold, un-folded ───────────────────────────────────────────────────────────────
    (
        "M1 · ⛔ **a second mount site comes back** · the reading pane grows its own "
        "`OverlayHost` + `CanonicalDocumentViewer` beside the shared one, which is the state "
        "`562` §6 boarded and the exact shape `635` made expensive: ⚠️ **two places deciding how "
        "to draw a page, an image and a PDF**, free to answer differently the next time a form is "
        "added",
        # ⚑ Landing D-016b (5e931be8, the tree) · re-anchored in place, not retired — The rule
        # survives: the shared CanonicalDocumentOverlay is the only mount site of
        # CanonicalDocumentViewer, so the drawing of a page, image or PDF is decided in one place.
        # The plant gives ReadingPane its own dead OverlayHost + viewer beside the shared overlay.
        # The import edit is needed so the plant compiles; the 'no-registry' reason is gone, so
        # 'no-store' stands in. Killed by `three-ways-to-open-one-document.test.ts`.
        [
            (READING, "import CanonicalDocumentOverlay from './CanonicalDocumentOverlay.vue'\n", "import CanonicalDocumentOverlay from './CanonicalDocumentOverlay.vue'\nimport CanonicalDocumentViewer from './CanonicalDocumentViewer.vue'\n"),
            # ⚑ D-032's window half · re-anchored in place, not retired — the mount takes the draw and
            # Finder doors too, over several lines; the second mount is planted after it, as before.
            (READING, '      :reveal="props.onRevealResource"\n    />\n\n    <!-- What a sub-agent did', '      :reveal="props.onRevealResource"\n    />\n    <OverlayHost v-if="false" @close="() => undefined">\n      <CanonicalDocumentViewer\n        :result="{ ok: false, reason: \'no-store\' }"\n        @close="() => undefined"\n      />\n    </OverlayHost>\n\n    <!-- What a sub-agent did'),
        ],
    ),
    (
        "M2 · ⚠️ **a surface keeps its own fetched document again** · the room re-declares the "
        "`readingDocument` the fold removed. ⛔ It is the half a source census sees and a dom test "
        "cannot: the second state is inert until something writes it, and then there are two "
        "readings of one fetch",
        # ⚑ Landing D-016a (bd70d693) · re-anchored in place, not retired — D-016a deleted
        # ProjectWorkspace.vue on purpose, but the rule (a surface keeps no fetched-document ref of
        # its own) still holds for the two surviving surfaces, ConversationPane and ReadingPane.
        # Plant the same declaration in ReadingPane.vue, where the old anchor line still exists
        # exactly once.
        [
            (READING, 'const documentOverlay = ref<InstanceType<typeof CanonicalDocumentOverlay> | null>(null)', 'const documentOverlay = ref<InstanceType<typeof CanonicalDocumentOverlay> | null>(null)\nconst readingDocument = ref<{ documentId: string; result: CanonicalDocumentResult } | null>(\n  null,\n)'),
        ],
    ),
    (
        "M3 · 🔴 **the one panel never draws** · the overlay is mounted by all three surfaces and "
        "renders nothing, so every document press in the app becomes the dead control `106` is "
        "about — ⚑ **and the blast radius IS the deliverable**: one line now reaches three "
        "surfaces, which is the cost of folding as well as its benefit · killed by `three-ways-to-open-one-document.test.ts` · killed by `three-ways-to-open-one-document.dom.test.ts`",
        [
            (
                OVERLAY,
                # ⚑ **W4.205 · re-anchored in place, not retired** — W4.205 · the document overlay's host now carries a dialog name; the plant still makes it never draw, so every document press shows nothing
                # The host has a descriptive label and shared close handler; hiding it still kills every press.
                '    v-if="showing"\n',
                '    v-if="false"\n',
            )
        ],
    ),
    (
        "M4 · ⛔ **the overlay is mounted and never handed the door** · the pane drops `:read`, so "
        "the panel is in the tree, the press is still drawn — `canOpenDocument` reads the pane's "
        "own prop, not the overlay's — and nothing opens. ⚠️ `106` arriving one hop later than "
        "`M3`",
        # ⚑ Landing D-016b (5e931be8, the tree) · re-anchored in place, not retired — The rule
        # survives: the conversation pane must hand its document overlay the read door, or the
        # overlay is mounted and the press opens nothing (open() returns early when the surface may
        # not open a document). The pane's overlay mount still passes :read=props.onReadResource on
        # its own line. The plant drops that prop. Killed by
        # `a-press-that-opens-the-document-it-names.dom.test.ts`,
        # `three-ways-to-open-one-document.test.ts`.
        [
            (PANE, '      ref="documentOverlay"\n      :read="props.onReadResource"\n', '      ref="documentOverlay"\n'),
        ],
    ),
    # ── B · the door ──────────────────────────────────────────────────────────────────────────
    (
        "M5 · 🔴 **the one rule inverts** · a surface may open a document exactly when it was "
        "given NO door. ⛔ Every surface with a reader goes dead and every surface without one "
        "grows a press that throws — ⚑ the row that proves the fold's single point of failure is "
        "actually load-bearing",
        [(RULE, "  return read !== undefined\n", "  return read === undefined\n")],
    ),
    (
        "M6 · ⚠️ **a surface re-spells the rule instead of asking it** · the pane goes back to "
        "`props.onReadCanonicalDocument !== undefined`. ⛔ **Nothing a person can see changes** — "
        "which is the point: `169` §1 is about the SECOND spelling, and the day the rule gains a "
        "clause this pane keeps the old answer",
        [
            (
                PANE,
                '          :can-open-document="mayOpenADocument"\n',
                '          :can-open-document="props.onReadCanonicalDocument !== undefined"\n',
            )
        ],
    ),
    (
        "M7 · ⛔ **the rule always says yes** · every surface draws the press, including the ones "
        "mounted with no runtime behind them — ⚠️ the SSR mounts and the fixture room, where the "
        "control now does nothing when pressed (`106`, `118`)",
        [(RULE, "  return read !== undefined\n", "  return true\n")],
    ),
    # ── C · the 067 guard, now inherited ──────────────────────────────────────────────────────
    (
        "M8 · 🔴 **the scope watch goes** · ⚑ **THIS ROW SURVIVED WHEN IT WAS FIRST WRITTEN, and "
        "that is the finding it carries.** ⛔ The `showing` guard HIDES a panel whose scope is not "
        "the one on screen — it does not DROP it — so removing the watch changes nothing until a "
        "person comes BACK to the conversation they opened the document in, and finds it over "
        "them again with nobody having pressed anything. ⚠️ `ConversationPane` held the pair "
        "before the fold and the pair is what got folded; the assertion that kills this row was "
        "written because this row would not die ([[a-line-no-mutation-can-kill-is-not-carrying-"
        "its-rule]])",
        [
            (
                OVERLAY,
                # The same scope guard now invalidates pending body and drawing reads too.
                "watch(\n  () => props.scope,\n  () => {\n    opens++\n    reading.value = null\n  },\n)\n\n",
                "",
            )
        ],
    ),
    (
        "M9 · ⛔ **the guard stops comparing** · `showing` returns whatever was last read, so a "
        "document fetched for one conversation is drawn over another. ⚠️ **The other half of "
        "`067`** — it fails only on a read that lands AFTER the person moved, which is why the "
        "test that kills it has to hold the read open",
        [
            (
                OVERLAY,
                "  reading.value !== null && reading.value.scope === props.scope ? reading.value : null,",
                "  reading.value !== null ? reading.value : null,",
            )
        ],
    ),
    (
        "M10 · ⚠️ **the pane stops naming which conversation it is** · the overlay is scopeless, "
        "so `undefined === undefined` passes for every conversation and the pane inherits the "
        "guard's null answer. ⛔ **A surface can opt OUT of a shared guard by omission** — which "
        "is why the two scopeless mounts are argued in the docblock rather than left to look like "
        "the default",
        [(PANE, '\n      :scope="props.record.sessionId"', "")],
    ),
    # ── D · the five that must not move ───────────────────────────────────────────────────────
    (
        "M11 · ⛔ **the word the press says drifts** · *Read the full response* becomes the other "
        "sentence, and a row naming a PROMPT tells a person it is a response. ⚑ `562` found this "
        "to be ONE and `640` was forbidden from moving it — this row is how that is measured "
        "rather than asserted",
        # ⚑ Landing D-016b (5e931be8, the tree) · re-anchored in place, not retired — The rule
        # survives: the press label OPEN_THE_DOCUMENT and READ_THE_DOCUMENT_NAMED are two different
        # sentences by design, and a row naming a different kind of file must not be told it is
        # something else. The wording in today's code is 'Open the file kept with this reply'. The
        # plant drifts it to 'Open this file', which is the other constant's sentence. Killed by
        # `three-ways-to-open-one-document.test.ts`,
        # `a-press-that-opens-the-document-it-names.test.ts`,
        # `the-id-this-app-hands-a-person.render.test.ts`.
        [
            (REPORT, "export const OPEN_THE_DOCUMENT = 'Open the file kept with this reply'", "export const OPEN_THE_DOCUMENT = 'Open this file'"),
        ],
    ),
    (
        "M12 · ⚠️ **the event the press travels on drifts in ONE surface** · the recording pane "
        "listens for a name nothing emits, so the press is drawn and the panel never opens — ⛔ "
        "the failure mode a fold is most likely to introduce, because the handler moved and the "
        "template did not",
        # ⚑ Landing D-016b (5e931be8, the tree) · re-anchored in place, not retired — The rule
        # survives: the press travels on one event name in every surface, and a pane that listens
        # for a name nothing emits draws the press and never opens the panel. ReadingPane still
        # listens with @open-document and the resourceId handler. The plant renames the listened
        # event to @read-document in that one pane. Killed by
        # `three-ways-to-open-one-document.test.ts`,
        # `a-press-that-opens-the-document-it-names.dom.test.ts`.
        [
            (READING, '      @open-document="(resourceId) => void openResource(resourceId)"', '      @read-document="(resourceId) => void openResource(resourceId)"'),
        ],
    ),
    (
        "M13 · ⛔ **a refusal loses its own sentence** · `outside` falls through to the panel's "
        "catch-all, so a document whose row points out of the tree is reported with the words "
        "that mean *this app could not say why*. ⚠️ `452` §5.1: a sentence that claims less than "
        "the app knows",
        # ⚑ Landing D-016b (5e931be8, the tree) · re-anchored in place, not retired — The rule 'a
        # refusal keeps its own sentence, and one that falls through to the catch-all claims less
        # than the app knows' survives for the four remaining ResourceReading refusals. Only the
        # 'outside' key went with the registry, on purpose, in 5e931be8: the three-ways test now
        # asserts 'outside:' is absent, and the commit says 'document tables go ... list_documents
        # is gone and read_document reads a resource'. So the plant drops a surviving key,
        # 'unreadable', which then reads 'That file could not be opened.'. Killed by
        # `three-ways-to-open-one-document.test.ts`,
        # `the-id-this-app-hands-a-person.render.test.ts`.
        [
            (VIEWER, "  unreadable:\n    'This app keeps a file by that id and could not read it — it may have been moved, or replaced by something that is not a file.',\n", ''),
        ],
    ),
    # ── E · viewing never executes ────────────────────────────────────────────────────────────
    (
        "M14 · 🔴 **the overlay draws the bytes itself** · the fold's one component grows a "
        "renderer of its own and puts an agent-written page into the page as HTML — ⛔ **exactly "
        "the hole a second drawing path opens**, and the reason `640` was ordered the hour `635` "
        "merged (`HO-097` §1.3)",
        # ⚑ Landing D-026, PE-007 and the ui files batch · re-anchored in place, not retired — The
        # rule survives: the overlay must stay a pure mount of the panel and never draw
        # agent-written bytes as HTML (the no-execute guarantee lives below, in DocumentBody at
        # html:false). d023c051 split the one-line `<CanonicalDocumentViewer :result=... @close=...
        # />` into a multi-line element with `:file`, so the old anchor is gone; the new anchor is
        # the multi-line element (once). The plant inserts a v-html div ahead of it and leaves the
        # panel element untouched (no v-else), so the only census that goes red is the `v-html`
        # needle, the label's own reason. Killed by `three-ways-to-open-one-document.test.ts`.
        [
            # ⚑ D-032's window half · re-anchored in place, not retired — the mount names the id, the
            # drawing and the Finder door too; the plant still puts the page in as HTML beside it.
            (OVERLAY, '    <CanonicalDocumentViewer\n      :resource-id="showing.resourceId"', '    <div v-if="showing.result.ok" v-html="showing.result.text"></div>\n    <CanonicalDocumentViewer\n      :resource-id="showing.resourceId"'),
        ],
    ),
    (
        "M15 · ⚠️ **the panel's form branch collapses back to one** · every form is handed to the "
        "Markdown renderer again, so a page is drawn as Markdown rather than shown as source — "
        "⛔ `635`'s widening undone from the READER's side, which is the side `640` touched",
        [
            (
                VIEWER,
                "        :source-only=\"result.form !== 'markdown'\"",
                '        :source-only="false"',
            )
        ],
    ),
]
