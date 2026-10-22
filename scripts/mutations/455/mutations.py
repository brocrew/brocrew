"""455 · The drawing arrives — the design inventory made true about v2.7, and made to say WHEN.

⛔ **What this table is about is a claim, not a behaviour.** Nothing a person presses changes in
this dispatch. What changes is that `design-v2-map.ts` now records, per surface, WHICH REVISION
DREW IT and WHICH COMMIT IMPORTED IT — and that the commits are resolved against `git` by
`apps/desktop/test/the-drawing-arrives.test.ts` rather than read as prose. ⚠️ The revisions are a
record: the drawings are not in the repository (below).

🔴 **So the rows below are mostly about the INSTRUMENT.** A design inventory whose rows nothing
resolves is exactly the artefact `455 §2.1` says cannot be read a week later, and a row that
silently stopped being checked would put us back there with a green suite.

## ⚑ The two drawings, which are not in the repo

`382 §9` ruled it and it never happened: *"if the designer ships a v2.4, the vendored copy is what
has to be replaced."* v2.4, v2.5, v2.5.1 and v2.6 are cited 55 times in this tree and NONE of them
is here, and neither are v2.3 and v2.7: no geometry number in v2.7's `TEST-RESULTS.json` is tied to
bytes a test can open.

## ⚠️ What the drawings' absence leaves

⛔ **The design drawings stay private, so the test reads neither, and the map holds no `DRAWINGS`,
`CITED_BUT_UNHELD` or `COPY_CENSUS_LIVES_IN`.** `M1`, `M15` and `M24` anchor on those and are
retired. ⚠️ `M3`, `M4`, `M5` and `M28` still APPLY and no test kills them, and `M16` is a survivor
as well: each is named on its row, for landing to record or retire. The test's §4, §7, §8, §9 (our
half of each geometry difference) and §10 hold, and §5 holds `SPAWN_RAIL_MEANS`'s pinned length.

## 🔴 Which gate can see each row

| rows | the defect is caught by |
|---|---|
| `M2`, `M6`-`M9`, `M19`, `M20`, `M22`, `M25`-`M27` | ⚑ **`apps/desktop/test/the-drawing-arrives.test.ts`** §4, §7, §8 |
| `M18` | ⚑ **`apps/desktop/test/digest-card.render.test.ts`**, which holds the digest's own words |
| `M23` | ⚑ **`apps/desktop/test/dom/a-stop-a-modal-cannot-cover.dom.test.ts`** and **`dom/spawning-switch.dom.test.ts`** |
| `M17` | retired: `NOBODY_IS_WATCHING` is not in the product |
| `M10`-`M14`, `M21`, `M29` | ⚑ **`apps/desktop/test/dom/the-drawing-arrives.dom.test.ts`** |
| `M1`, `M15`, `M24` | retired: the drawings stay private |
| `M3`-`M5`, `M16`, `M28` | no test kills them — see each row |

## ⛔ What this table deliberately does NOT contain

⚠️ **No row on the `review-scaffold` state's membership.** `§4`'s assertion is an equality against
a two-name list, so any edit to that list is the assertion's own subject rather than a defect in
something else — a mutation there would be mutating a census with that census
(`a-mutation-on-a-census-is-invisible-to-that-census`).

⚠️ **No row deleting `--lane-clear`'s derivation in favour of the literal `220px`.** The computed
value is the same, so nothing measurable moves and the row would report as a survivor
(`a-mutation-that-changes-nothing-reports-as-a-survivor`). ⚑ What the derivation buys is caught by
`session-tools.dom.test.ts`'s planted-token test, which `444` already wrote.

⚠️ **No row on `SessionTools`' narrow cap** — `min(calc(1000px - 2 * var(--lane-clear)), …)`. A
first draft of this table had one, rewriting it as the literal `560px` it computes to today; it
SURVIVED, and correctly: nothing measurable moves unless the token moves with it, which is the
same phantom as the row above. ⚑ The derivation IS unpinned at the narrow width — no test plants
`--lane-w` and watches the 560 follow — and that is a finding in `455`'s response rather than a
row here.

⚠️ **No row on a copy census's own records.** A mutation there would be mutating a census with that
census. ⚑ The copy rows below mutate the PRODUCT's constants instead, which is the direction that
matters: `M16`-`M18`.

⚠️ **No row on the copy DIFFERENCES' `theirs` side.** Those strings are the designer's bytes, and
editing them to make a test red would be editing evidence.
"""

MAP = "apps/desktop/src/renderer/src/lib/design-v2-map.ts"
TOKENS = "apps/desktop/src/renderer/src/assets/tokens.css"
BASE = "apps/desktop/src/renderer/src/assets/base.css"
OVERLAY = "apps/desktop/src/renderer/src/components/OverlayHost.vue"
TOOLS = "apps/desktop/src/renderer/src/components/SessionTools.vue"
CAPS = "apps/desktop/src/shared/capabilities.ts"
DIGEST = "apps/desktop/src/shared/digest.ts"
TAKING = "apps/desktop/src/renderer/src/lib/taking-over.ts"
HOST = "apps/desktop/src/main/runtime/runtime-host.ts"
SAFETY = "apps/desktop/src/renderer/src/lib/spawn-safety.ts"
CODEX_RUNTIME = "packages/runtime/src/codex/codex-runtime.ts"

MUTATIONS = [
    # ── §1 · the bytes, and the anchor that says they are the measured ones ─────────────────────
    (
        # ⛔ **RETIRED BY RULING (the design drawings stay private):** the map holds no `DRAWINGS`
        # or recorded sha256, because the v2.7 drawing is not in the repository to hash. Its anchor
        # is left stale, so the census records it retired.
        "M1 · 🔴 the vendored drawing is no longer the one the delivery measured · one character of "
        "the recorded sha256, which is the anchor every geometry number in TEST-RESULTS.json hangs "
        "on — if this can drift, the repo holds a drawing nobody has checked",
        [
            (
                MAP,
                "    sha256: '8b1a5968e5cd5d8ffef2966e2c7978ed46e3d6389555a1b4d82bf61cfad6b9f8',",
                "    sha256: '8b1a5968e5cd5d8ffef2966e2c7978ed46e3d6389555a1b4d82bf61cfad6b9f9',",
            )
        ],
    ),
    # ── §2 · the roster is the drawing's, not a list somebody typed ─────────────────────────────
    (
        "M2 · ⛔ a surface the drawing can reach loses its row · the `workspace` sheet goes, which "
        "is the shape `455 §2.1` is about: an inventory that is quietly incomplete",
        [
            (
                MAP,
                "  {\n    id: 'workspace',\n    kind: 'sheet',",
                "  {\n    id: 'workspace-that-is-not-drawn',\n    kind: 'sheet',",
            )
        ],
    ),
    (
        # ⚠️ **No test kills this row.** `drawnIn` is a record of both drawings' routers, and the
        # drawings are not in the repository, so nothing re-derives it. The anchor still applies,
        # so the row survives: landing records it or retires it.
        "M3 · 🔴 `drawnIn` stops being the derivation · `capabilities` is recorded as v2.7-only "
        "when v2.3 drew it too, so the column that makes the inventory say WHEN says the wrong when",
        [
            (
                MAP,
                "    id: 'capabilities',\n    kind: 'sheet',\n    title: ['CAPABILITY POLICY'],\n    drawnIn: ['v2.3', 'v2.7'],",
                "    id: 'capabilities',\n    kind: 'sheet',\n    title: ['CAPABILITY POLICY'],\n    drawnIn: ['v2.7'],",
            )
        ],
    ),
    (
        # ⚠️ **No test kills this row.** The roster is a record of the drawing's router, and the
        # drawing is not in the repository, so nothing refuses a roster that misses a route it
        # reaches. The anchor still applies, so the row survives: landing records it or retires it.
        "M4 · ⛔ a route the drawing decides on but the roster misses · `conversation` is the one "
        "reachable by assignment as well as by `navigate`, and dropping its row is what a "
        "mention-derived list would have done",
        [
            (
                MAP,
                "  {\n    id: 'conversation',\n    kind: 'route',",
                "  {\n    id: 'conversation-elsewhere',\n    kind: 'route',",
            )
        ],
    ),
    # ── §3 · the titles are quoted from the drawing ─────────────────────────────────────────────
    (
        # ⚠️ **No test kills this row.** A title is a record of its sheet's arm in the drawing, and
        # the drawing is not in the repository, so nothing finds it there. The anchor still
        # applies, so the row survives: landing records it or retires it.
        "M5 · ⚠️ a sheet's title is paraphrased · `INVENTORY WORKBENCH · READ-ONLY` becomes the "
        "reasonable-sounding `TOOL INVENTORY`, and the inventory starts describing a drawing in "
        "its own words",
        [
            (
                MAP,
                "    title: ['INVENTORY WORKBENCH · READ-ONLY'],",
                "    title: ['TOOL INVENTORY'],",
            )
        ],
    ),
    # ── §4 · which commit imported it ───────────────────────────────────────────────────────────
    (
        "M6 · 🔴 `importedAt` names a commit that TOUCHED the file rather than the one that brought "
        "it · `452` reshaped `ProjectWorkspace.vue` and `009` created it; without the "
        "absent-at-the-parent half this row would read as an import date and be a repair date",
        # ⚑ Landing D-016a (bd70d693) · re-anchored in place, not retired — The ProjectWorkspace.vue
        # row is gone (the projects, project and workspace rows are now only-drawn with no files),
        # but the rule that importedAt names the commit that first carried the file still holds.
        # Re-planted on the conversation row (ConversationPane.vue, born 1c20ab5), swapping in
        # da4a9ed, which is an ancestor that touched the file but did not create it (file present at
        # da4a9ed and at da4a9ed^1).
        [
            (MAP, "    renders: ['apps/desktop/src/renderer/src/components/ConversationPane.vue'],\n    importedAt: ['1c20ab5'],", "    renders: ['apps/desktop/src/renderer/src/components/ConversationPane.vue'],\n    importedAt: ['da4a9ed'],"),
        ],
    ),
    (
        "M7 · ⛔ a product file that no longer exists keeps its row · the inventory claims a "
        "surface is imported and names nothing a reader can open",
        [
            (
                MAP,
                "    renders: ['apps/desktop/src/renderer/src/components/StartAsAgent.vue'],",
                "    renders: ['apps/desktop/src/renderer/src/components/PlaceConversation.vue'],",
            )
        ],
    ),
    (
        "M8 · ⛔ `state` and the file list stop agreeing · a surface with two real components is "
        "recorded as `only-drawn`, which is the row a plan would act on",
        [
            (
                MAP,
                "    id: 'history',\n    kind: 'sheet',\n    title: ['ARCHIVE · RETURN TO WORK'],\n    drawnIn: ['v2.3', 'v2.7'],\n    state: 'imported',",
                "    id: 'history',\n    kind: 'sheet',\n    title: ['ARCHIVE · RETURN TO WORK'],\n    drawnIn: ['v2.3', 'v2.7'],\n    state: 'only-drawn',",
            )
        ],
    ),
    (
        "M9 · ⚠️ the two lists fall out of step · one more file than commits, so a row silently "
        "stops saying when its second half arrived",
        # ⚑ Landing D-016a (bd70d693) · re-anchored in place, not retired — The three-file row is
        # gone, but the decision row still lists two files with `importedAt: ['e4f04a2',
        # 'e4f04a2']`, and the census still requires one commit per file. Dropping one commit puts
        # one more file than commits, the label's exact defect.
        [
            (MAP, "    importedAt: ['e4f04a2', 'e4f04a2'],", "    importedAt: ['e4f04a2'],"),
        ],
    ),
    # ── the geometry, in a real engine ──────────────────────────────────────────────────────────
    (
        "M10 · 🔴 the lane's own column widens and the band with it · `--lane-w` is the one literal "
        "the whole 210/220 ruling derives from, and the delivery's claim is about that band",
        [(TOKENS, "  --lane-w: 200px;", "  --lane-w: 210px;")],
    ),
    (
        "M11 · ⛔ the clearance loses its extra step and the sheet sits TANGENT to the stop · "
        "`444`'s ruling undone, and every `>=` in `session-tools.dom.test.ts` stays green because "
        "tangency satisfies it — which is why 740/760/940 had to be pinned by equality · killed by `the-drawing-arrives.dom.test.ts` · killed by `session-tools.dom.test.ts`",
        [
            (
                TOKENS,
                # ⚑ **W4.205 · re-anchored in place, not retired** — W4.205 · 2ca719c5 folded the calc onto one line. ⚠️ This table's gate, the-drawing-arrives.dom.test.ts, expects the computed token text 'calc( 10px + 200px + 10px )' (the multi-line form's whitespace); HEAD's single line gives 'calc(10px + 200px + 10px)', so it is very likely red on HEAD (not run). session-tools.dom.test.ts §2 kills the plant (444 M7).
                "  --lane-clear: calc(var(--space-5) + var(--lane-w) + var(--space-5));",
                "  --lane-clear: calc(var(--space-5) + var(--lane-w));",
            )
        ],
    ),
    (
        "M12 · 🔴 the 940 ceiling moves · the cap is what decides the panel at 1440 and the "
        "delivery's third width is entirely about it; nothing in the repository pinned 940 before "
        "this dispatch",
        [
            (
                TOOLS,
                "  width: min(940px, calc(100% - 2 * var(--lane-clear)));",
                "  width: min(1000px, calc(100% - 2 * var(--lane-clear)));",
            )
        ],
    ),
    (
        "M13 · ⛔ the lane leaves its gutter · `.overlay-corner` moves one step of the ladder, so "
        "the band is 208 and the recorded 210 is false in the direction a person cannot see",
        [
            (
                OVERLAY,
                ".overlay-corner {\n  position: absolute;\n  z-index: 2;\n  bottom: var(--space-6);\n  left: var(--space-5);",
                ".overlay-corner {\n  position: absolute;\n  z-index: 2;\n  bottom: var(--space-6);\n  left: var(--space-4);",
            )
        ],
    ),
    (
        "M14 · 🔴 the document is allowed to scroll sideways · this is the rule that makes "
        "`documentElement.clientWidth` the window, and with it gone the shipped engine may draw a "
        "classic bar that takes width out of every fixed overlay — 11px off every panel the "
        "delivery measured, invisible to a runner that draws overlay bars",
        [
            (
                BASE,
                "  overflow: hidden;\n  background: var(--bg-glow), var(--bg);",
                "  overflow: auto;\n  background: var(--bg-glow), var(--bg);",
            )
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (the design drawings stay private):** the map holds no
        # `CITED_BUT_UNHELD`; the revisions it named are one sentence in §10's docblock. Its anchor
        # is left stale, so the census records it retired.
        "M15 · ⛔ a revision we DO hold is listed as merely cited · the list that keeps `drawnIn` "
        "honest — *we hold no bytes for it* rather than *it did not draw this* — stops being a "
        "statement about what is missing",
        [
            (
                MAP,
                "export const CITED_BUT_UNHELD: readonly string[] = ['v2.4', 'v2.5', 'v2.5.1', 'v2.6']",
                "export const CITED_BUT_UNHELD: readonly string[] = ['v2.4', 'v2.5', 'v2.5.1', 'v2.6', 'v2.7']",
            )
        ],
    ),
    # ── the copy both sides render ──────────────────────────────────────────────────────────────
    (
        # ⚠️ **No test kills this row.** `approve is approved!` has the sentence's length, so the 274
        # length pin passes, and `consent-never-containment`'s `/what you approve is approved/`
        # matches both endings. The anchor still applies: landing records it or retires it.
        "M16 · 🔴 the ONE sentence the delivery declares product-owned drifts · the drawing carries "
        "`SPAWN_RAIL_MEANS` byte-identical, and a product edit that left the mock behind is exactly "
        "the direction `386` called an unsafe near-miss",
        [
            (
                CAPS,
                "  'bounds where a command it runs can reach, and what you approve is approved.'",
                "  'bounds where a command it runs can reach, and what you approve is approved!'",
            )
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-017, 5206d835):** D-017 commit 3 removes
        # NOBODY_IS_WATCHING entirely: taking-over.ts's own comment says 'it said "nobody is
        # watching it", and that was a process fact' (F024), and the card's rule 5 states 'Nothing
        # reports whether a process runs... the rail's "nobody is watching it" label is gone' —
        # exactly the words the task's retire list names. Grepping the renderer source finds no
        # `NOBODY_IS_WATCHING` export left anywhere; the sentence survives only in test/comment
        # prose describing its removal. Its anchor is left stale, so the census records it retired.
        "M17 · ⛔ `NOBODY_IS_WATCHING` is reworded · the drawing reproduces `421`'s words verbatim "
        "and nothing recorded that it did, so a rewrite here silently makes the drawing wrong",
        [
            (
                TAKING,
                "export const NOBODY_IS_WATCHING = 'nobody is watching it'",
                "export const NOBODY_IS_WATCHING = 'no one is watching it'",
            )
        ],
    ),
    (
        "M18 · 🔴 the digest stops refusing *while you were away* · `WINDOW_WAS_CHOSEN` is the "
        "sentence that makes the drawing's own label unusable, and `430` measured why: there is no "
        "durable last-view marker anywhere in this app",
        [
            (
                DIGEST,
                "  'This window was chosen here. Nothing in this app records when you last looked, so no digest '",
                "  'This window covers the time you were away. Nothing in this app records when you last looked, so no digest '",
            )
        ],
    ),
    # ── the third clause of the provider note ───────────────────────────────────────────────────
    (
        "M19 · ⛔ a running session's handle becomes reassignable · `417 §3`'s third finding, and "
        "the clause `design-v2-map.ts` claimed a test pinned when nothing did until this dispatch",
        [(HOST, "  readonly handle: SessionHandle", "  handle: SessionHandle")],
    ),
    (
        "M20 · ⚠️ a hand-carried sentence is recorded as surviving into v2.7 · ONE of the twenty "
        "retired ones then reads as current, and nothing but a derivation from the bytes could "
        "tell — which is what `heldIn` is for",
        [
            (
                MAP,
                "    quote: 'Confirmation is not permission.',\n    heldIn: ['v2.3'],",
                "    quote: 'Confirmation is not permission.',\n    heldIn: ['v2.3', 'v2.7'],",
            )
        ],
    ),
    (
        "M21 · 🔴 the clearance stops being DERIVED and becomes a second literal · the same 220 "
        "today and two numbers that can drift apart tomorrow, which is the defect `444`'s ruling "
        "removed — and `§9`'s `not.toMatch` was a line no row could redden until this one · killed by `the-drawing-arrives.test.ts` · killed by `session-tools.dom.test.ts`",
        [
            (
                TOKENS,
                # ⚑ **W4.205 · re-anchored in place, not retired** — W4.205 · 2ca719c5 folded the calc onto one line; the literal still equals today's 220. ⚠️ the-drawing-arrives.test.ts still toContain()s the multi-line calc (red on HEAD) and the .dom file's 'calc( 10px … )' text is very likely red too; session-tools.dom.test.ts 'widening the lane widens the gutter' would kill this plant on its own.
                "  --lane-clear: calc(var(--space-5) + var(--lane-w) + var(--space-5));",
                "  --lane-clear: 220px;",
            )
        ],
    ),
    (
        "M22 · ⛔ a drawn surface joins the review scaffold's neighbour state · `review-scaffold` "
        "excuses a row from every product assertion, so its membership is the one place a surface "
        "could go to stop being owed",
        [
            (
                MAP,
                "    id: 'unavailable',\n    kind: 'sheet',\n    title: ['DESIGN REVIEW · MISSING DATA'],\n    drawnIn: ['v2.7'],\n    state: 'review-scaffold',",
                "    id: 'unavailable',\n    kind: 'sheet',\n    title: ['DESIGN REVIEW · MISSING DATA'],\n    drawnIn: ['v2.7'],\n    state: 'only-drawn',",
            )
        ],
    ),
    (
        "M23 · 🔴 the product adopts the DRAWING's words for the emergency stop · the half of every "
        "copy difference that goes stale silently, and the direction that matters: the day we say "
        "what the drawing says, the row is no longer a difference and must be deleted",
        [
            (
                SAFETY,
                # The approved heading replaces spawning jargon; the plant still substitutes the drawing wording for the product wording.
                "    heading: confirming\n      ? 'Allow agents to start new conversations?'\n      : on\n        ? 'Agents can start new conversations'\n        : 'Agents cannot start new conversations',",
                "    heading: confirming\n      ? 'Allow agents to start new conversations?'\n      : on\n        ? 'Stop new spawns'\n        : 'Agents cannot start new conversations',",
            )
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (the design drawings stay private):** the map holds no `DRAWINGS`,
        # so there is no `against` field to plant. Its anchor is left stale, so the census records
        # it retired.
        "M24 · ⛔ the revision the delivery was drawn against stops being a commit · standing rule "
        "17 says a delivery's claim is unverified until the importer verifies it, and `against` is "
        "the one *when* §10 records about the other side",
        [(MAP, "    against: 'a945a88',", "    against: '0000000',")],
    ),
    (
        "M25 · ⚠️ both providers' session handles become one class · `417 §3`'s third finding is "
        "that the handle is built by a PER-PROVIDER class, which is what makes changing a provider "
        "an end-and-relaunch rather than a setter",
        [(CODEX_RUNTIME, "export class CodexSessionHandle", "export class ClaudeSessionHandle")],
    ),
    (
        "M26 · ⛔ `wiredAt` names a commit that touched none of the row's files · the column exists "
        "because `importedAt` answers *when the file was born* and several of these surfaces were "
        "born as Slice-2 fixtures; a sha that never touched them answers neither question",
        # ⚑ Landing D-016a (bd70d693) · re-anchored in place, not retired — The project row that
        # carried `wiredAt: '71d7360'` is gone, but the rule (wiredAt must name a commit that
        # touched one of the row's files) still holds and the wiredAt census test still asserts it.
        # Re-planted on the composed-instructions row, whose wiredAt is unique, using 86d0730, a
        # real ancestor that touched neither SessionInstructions.vue nor told.ts (verified by git
        # show --stat).
        [
            (MAP, "    wiredAt: '37a7802',", "    wiredAt: '86d0730',"),
        ],
    ),
    (
        "M27 · 🔴 a part-imported surface stops naming what is owed · `stillOnlyDrawn` is the third "
        "of `455 §2.1`'s three questions, and emptying it is how a row quietly becomes indistinct "
        "from an imported one",
        # ⚑ Landing D-016a (bd70d693) · re-anchored in place, not retired — Only the text moved: the
        # attention row's owed item now reads 'the queue is a block on `waiting`' instead of `home`.
        # A part-imported row emptied of stillOnlyDrawn is still exactly what the census refuses.
        [
            (MAP, "    stillOnlyDrawn: [\n      'a route of its own — the queue is a block on `waiting`, and `SurfaceName` has no member for it',\n    ],", '    stillOnlyDrawn: [],'),
        ],
    ),
    (
        # ⚠️ **No test kills this row.** A title is a record of its own sheet's arm in the drawing,
        # not a neighbour's, and the drawing is not in the repository, so nothing finds it there.
        # The anchor still applies, so the row survives: landing records it or retires it.
        "M28 · ⛔ a sheet wears its NEIGHBOUR's eyebrow · both titles are somewhere in the switch, "
        "so a file-level `toContain` passed for any permutation of the twenty-two — the arm has to "
        "be sliced for a title to mean anything",
        [(MAP, "    title: ['AGENT IDENTITY'],", "    title: ['WORKSPACE CONVERSATIONS'],")],
    ),
    (
        "M29 · ⚠️ the panel stops being a function of the window · a fixed width keeps 740 at the "
        "app's floor and breaks it everywhere else, and it is what says the eleven-pixel section "
        "measures a SLOPE rather than one subtraction",
        [(TOOLS, "  width: min(940px, calc(100% - 2 * var(--lane-clear)));", "  width: 740px;")],
    ),
]
