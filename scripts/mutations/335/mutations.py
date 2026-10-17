"""335 · A sheet that clips in the reference — each row puts the REFERENCE'S defect into ours (131).

⛔ **335 changed no product code, and that is the point of this table.** `302` finding #6 reported
the prototype's dispatch sheet *"visibly clipped on its right edge at `1440×1000`"* and said the app
had *"no reachable equivalent"*, so ours had never been looked at there. It has now — in a real
window, over CDP, at `1440×1000`, at the `1200×808` the app opens at, and down to a `400px`
viewport, in both target states. **It does not clip.** So there was nothing to fix, and the only
thing worth building was the guard that keeps the answer true. Every row below is a way the
reference's defect gets into our sheet, and every one of them is killed by
`apps/desktop/test/dom/dispatch-sheet-fits.dom.test.ts`.

## ⚑ The reference's mechanism, measured — because it decides what a row can be

Measured in `preview-1-final.html` with the same probe:

| what | the prototype | ours |
|---|---|---|
| the app frame | `.app { min-width: 1180px }`, document does not scroll | ⚠️ **the same** — `--app-min-w: 1180px` |
| the overlay | `.overlay { position: absolute; inset: 0 }`, inside a positioned frame | ⛔ `position: fixed; inset: 0` — the WINDOW |
| the sheet | `width: min(820px, calc(100% - 80px))` | `width: min(920px, 92vw)` |
| below a `1122px` window | 222px of the sheet off-screen, **and no scrollbar to reach it** | centred and whole |

⛔ **We own half the mechanism and not the other half.** The clip is not about the dialog's own
sizing: measured, replacing our `width`/`max-height` with the prototype's own
`min(820px, calc(100% - 80px))` / `calc(100% - 76px)` changes nothing here, because a `fixed` host
makes `100%` mean the window — so it is not a row, because a row has to be able to go red. It is
about where the overlay is ANCHORED, which is why `M1`, `M2` and `M3` are the rows that matter and
the rest guard the degrades around them.

## 🔴 Which gate can see each row

| rows | the defect is caught by |
|---|---|
| `M1`-`M9` | ⚑ **`run_suite`** — `test/dom/dispatch-sheet-fits.dom.test.ts`, in real Chromium at a real viewport |
| `M10`-`M11` | ⚑ **`run_suite`** — the same file's confirm-label assertion, and `test/overlays.render.test.ts` |
| `M12`-`M13` | ⚑ **`run_suite`** — the `data-cy` anchors that file (and the live smokes) reach the sheet through |

⚠️ **This is a DOM-project table, and it is the first one.** Every row is a computed layout fact —
a box measured where it actually sits — so nothing here could be killed by an SSR render test, which
has no layout at all. `vitest.dom.config.ts` runs on the default path, so `run_suite` reaches it.

## ⚠️ What this table deliberately does NOT contain

⛔ **No row about `--app-min-w`.** Widening or narrowing it moves the surface behind the sheet and
not the sheet, because the sheet is anchored to the window. Measured: `1180px → 2000px` changes
nothing this file asserts. The app frame's own behaviour below `1180px` — `body { overflow: hidden }`
means the right of the SURFACE is unreachable rather than scrollable — is real, is inherited from
the same reference, and is **not this dispatch's surface**. It is named in the response instead.

⛔ **No row removes `.dispatch-dialog { overflow: hidden }`.** It survives, correctly: with
`visible` nothing is cut, it is merely drawn outside the sheet's own border. A row has to be a
DEFECT, and that one is a different one.

⛔ **No row about the small end.** The sheet is complete down to a `460px` viewport; at `440` the
target-agent card's pill starts to overflow its own border, and at `360` the first element reaches
past the sheet's clip edge. Both are far below `--app-min-w`, so the app is already unusable there
for reasons that have nothing to do with this sheet — the bound is reported in the response and
guarded by nothing, deliberately.
"""

HOST = "apps/desktop/src/renderer/src/components/OverlayHost.vue"
MODAL = "apps/desktop/src/renderer/src/components/DispatchModal.vue"
CAPABILITIESSHEET = "apps/desktop/src/renderer/src/components/CapabilitiesSheet.vue"

MUTATIONS = [
    # ── the reference's rule, put into ours ───────────────────────────────────────────────────
    (
        "M1 · ⛔ THE REFERENCE'S DEFECT, verbatim · the overlay is anchored to the app frame "
        "instead of to the window, with the prototype's own sizing rule on the sheet — below a "
        "1180px window the right edge goes off-screen and no scrollbar reaches it",
        # ⚑ Landing D-016a (bd70d693) · re-anchored in place, not retired — DispatchModal.vue is
        # gone, but the rule (an overlay anchored to the frame instead of the window, with the
        # prototype's own sizing on the sheet) survives: OverlayHost still has `position: fixed`
        # once, and CapabilitiesSheet carries the same clamp with a comment naming '335's rule'.
        # `capabilities-sheet-fits.dom.test.ts` is the sibling guard and its frame wrapper is
        # `position:relative;min-width:1180px` for exactly this defect. Re-anchored to the
        # capabilities sheet (its cap is 660px, not 920px).
        [
            (HOST, '  position: fixed;', '  position: absolute;'),
            (CAPABILITIESSHEET, '  width: min(660px, 92vw);\n  max-height: 88vh;', '  width: min(660px, calc(100% - 80px));\n  max-height: calc(100% - 76px);'),
        ],
    ),
    (
        "M2 · ⛔ the overlay stops being window-anchored · `absolute` is the prototype's own value, "
        "and it is the whole of the difference: inside a positioned app frame wider than the "
        "window, the sheet is centred on the FRAME and half of it is nowhere",
        [(HOST, "  position: fixed;", "  position: absolute;")],
    ),
    (
        "M3 · ⛔ the overlay stops being positioned at all · `inset: 0` then addresses nothing, the "
        "backdrop is an in-flow block, and the sheet sits wherever the surface behind it left off",
        [(HOST, "  position: fixed;", "  position: static;")],
    ),
    # ── the clamp that keeps the sheet inside the window it is in ─────────────────────────────
    (
        # ⛔ **RETIRED BY RULING (landing D-016a, bd70d693):** The subject was DispatchModal's flat
        # 920px width, and D-016 deleted the sheet with its guard: 'tests whose subject was a
        # deleted feature are deleted' (dispatch-sheet-fits.dom.test.ts, 389 lines, deleted). The
        # rule survives on CapabilitiesSheet, but 355 M26 already plants the byte-identical edit
        # there (`width: min(660px, 92vw);` to `width: 660px;`) with the same killer, and 355's own
        # header says the same rule under two tables is the drift `169` §1 warns about, so a
        # re-anchor would only duplicate M26. Its anchor is left stale, so the census records it
        # retired.
        "M4 · ⛔ the sheet is a flat 920px again · identical to `min(920px, 92vw)` in any wide "
        "window, which is exactly why this is the row: it can only be seen below 1000px, and it is "
        "the shape the prototype ships",
        [(MODAL, "  width: min(920px, 92vw);", "  width: 920px;")],
    ),
    (
        "M5 · ⛔ the clamp leaves no margin · `100vw` fits the window exactly, so the sheet becomes "
        "edge-to-edge with its border on the window's own border and nothing between the two",
        # ⚑ Landing D-016a (bd70d693) · re-anchored in place, not retired — The dispatch sheet is
        # gone but its clamp rule survives on CapabilitiesSheet (`width: min(660px, 92vw)`,
        # commented as 335's rule), and no row in 355 plants the '100vw leaves no margin' variant.
        # `capabilities-sheet-fits.dom.test.ts` at 460×800 asserts the width is exactly 92vw of the
        # viewport, which is where `92vw` and `100vw` diverge.
        [
            (CAPABILITIESSHEET, '  width: min(660px, 92vw);', '  width: min(660px, 100vw);'),
        ],
    ),
    (
        "M6 · ⛔ the sheet grows past a short window · without `88vh` it is its content's height, "
        "and in a 450px window the footer — the button that commits the dispatch — is below the "
        "bottom of the screen with no scrollbar anywhere",
        # ⚑ Landing D-016a (bd70d693) · re-anchored in place, not retired — The rule that a sheet's
        # height is capped to the window still holds: CapabilitiesSheet has `max-height: 88vh` once,
        # and it is what makes the body scroll instead of pushing Save off screen. 355 has no row
        # for this cap. Replacing it with a fixed 2000px lets the sheet grow past a 450px window.
        [
            (CAPABILITIESSHEET, '  max-height: 88vh;', '  max-height: 2000px;'),
        ],
    ),
    # ── the degrade that is knowing rather than silent (187 §2) ───────────────────────────────
    (
        "M7 · ⛔ the body stops scrolling · this is the difference between a sheet that says there "
        "is more and a sheet that cuts it off: with `hidden` the overflow is still there and there "
        "is no longer any way to reach it",
        # ⚑ Landing D-016a (bd70d693) · re-anchored in place, not retired — The body-scrolls rule
        # survives: `.sheet-body { overflow-y: auto }` on CapabilitiesSheet, with a comment citing
        # 335. This plants the label's own `hidden` variant, which is a different edit from 355 M27
        # (that row deletes the line). With `hidden` the body still shrinks and Save stays on
        # screen, so it is the final test's `overflowY` assertion that kills it.
        [
            (CAPABILITIESSHEET, '  padding: var(--space-8) var(--space-9);\n  overflow-y: auto;', '  padding: var(--space-8) var(--space-9);\n  overflow-y: hidden;'),
        ],
    ),
    (
        "M8 · ⛔ the body stops flexing · it takes its content's height instead of the room left "
        "between header and footer, so in a short window it pushes the footer out of the sheet "
        "rather than scrolling inside it",
        # ⚑ Landing D-016a (bd70d693) · re-anchored in place, not retired — The body-flexes rule
        # survives on CapabilitiesSheet, where the body relies on default shrink and the actions are
        # `flex: 0 0 auto`. It has no `flex: 1` line, so the plant adds `flex: 0 0 auto` to
        # `.sheet-body`. The body then takes its content height and pushes the footer out of the
        # sheet, which is the label's defect.
        [
            (CAPABILITIESSHEET, '  padding: var(--space-8) var(--space-9);\n  overflow-y: auto;\n  gap: var(--space-7);', '  flex: 0 0 auto;\n  padding: var(--space-8) var(--space-9);\n  overflow-y: auto;\n  gap: var(--space-7);'),
        ],
    ),
    (
        "M9 · ⛔ header, body and footer sit side by side · the sheet is one column and the three "
        "parts are stacked; as a row the body's own width is whatever is left, and the document "
        "preview it exists to show is the part that loses",
        # ⚑ Landing D-016a (bd70d693) · re-anchored in place, not retired — The one-column rule
        # survives: `.capabilities-sheet { flex-direction: column; overflow: hidden }` is anchored
        # once. As a row, the header's `flex: 0 0 auto` takes its max-content width (the long owner
        # sentence on one line), which is wider than the 660px sheet, so the body and actions are
        # pushed past the sheet's clip edge.
        [
            # ⚑ **theme host · re-anchored in place, not retired** — NOT VERIFIED. Theme border widths now use tokens; the same defect retains all other declarations.
            (CAPABILITIESSHEET, "  flex-direction: column;\n  overflow: hidden;\n  border: var(--border-width) solid var(--line-strong);", "  flex-direction: row;\n  overflow: hidden;\n  border: var(--border-width) solid var(--line-strong);"),
        ],
    ),
    # ── the promise, which is the thing that must not be cut (§2.1) ───────────────────────────
    (
        # ⛔ **RETIRED BY RULING (landing D-016a, bd70d693):** DispatchModal.vue was deleted (756
        # lines) with the sheet's only openers, DocumentDrawer and HomeSurface. The commit says
        # 'Projects stop being something a person or a model meets: … the project rooms, board,
        # sheet and picker … are removed', and the modal took `lib/entities` Document and
        # AgentProfile, whose module went with it (entities.ts, 490 lines). A grep for 'Dispatch …
        # now', 'dispatch-confirm' and 'DispatchModal' finds nothing live in src, test or scripts.
        # Its anchor is left stale, so the census records it retired.
        "M10 · ⛔ the button stops saying WHEN · `Dispatch 042 to test` and `Dispatch 042 to test "
        "now` are the same sentence minus the only word that says work starts on this click — the "
        "sheet's whole job. \u26a0\ufe0f **Anchor corrected in 343**, which made `action` a "
        "three-branch function and dropped this line's trailing comma; re-verified RED by hand.",
        [
            (
                MODAL,
                "    : `Dispatch ${props.document.number} to ${props.target.name} now`",
                "    : `Dispatch ${props.document.number} to ${props.target.name}`",
            )
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-016a, bd70d693):** The 'Queue 043 for <target>' button
        # was DispatchModal's queued branch, gone with the modal, `dispatch-route.ts` (the
        # availability model) and `dispatch-route.test.ts` / `dispatch-route.dom.test.ts`. Nothing
        # today queues a project document behind an agent's run. chat-theme.test.ts now says 'D-016
        # deleted those five panels (DispatchModal, DocumentDrawer, AllDocumentsSheet, RecruitSheet,
        # ProjectSheet)'. Its anchor is left stale, so the census records it retired.
        "M11 · ⛔ the queued button stops saying WHO · `Queue 043` names no target, so the one "
        "sheet that exists to show the exact target before a run starts stops naming it on the "
        "button that would start it",
        [
            (
                MODAL,
                "    ? `Queue ${props.document.number} for ${props.target.name}`",
                "    ? `Queue ${props.document.number}`",
            )
        ],
    ),
    # ── the anchors everything reaches the sheet through ──────────────────────────────────────
    (
        # ⛔ **RETIRED BY RULING (landing D-016a, bd70d693):** The `data-cy="dispatch-modal"` anchor
        # belonged to DispatchModal.vue, deleted by D-016, and the overlay-store kind 'dispatch' is
        # removed too. The instruments that addressed it are deleted or rewritten:
        # dispatch-sheet-fits, overlays.render, and the ui-live-smoke steps (1991 lines changed in
        # that script). Its anchor is left stale, so the census records it retired.
        "M12 · ⛔ the sheet's own `data-cy` moves · every instrument that can see this sheet — this "
        "dispatch's guard and the live smokes — addresses it by that name, and a rename makes all "
        "of them look at nothing",
        [(MODAL, '    data-cy="dispatch-modal"', '    data-cy="dispatch-sheet"')],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-016a, bd70d693):** The `data-cy="dispatch-confirm"`
        # button was DispatchModal's, deleted by D-016 ('tests whose subject was a deleted feature
        # are deleted'), and the `overlays.render.test.ts` assertion on it is gone. No confirm
        # button of that name exists anywhere in src today. Its anchor is left stale, so the census
        # records it retired.
        "M13 · ⛔ the confirm button's `data-cy` moves · the assertion that its label is whole, and "
        "that it is still on screen in a short window, both reach it by that name. \u26a0\ufe0f "
        "**Anchor corrected in 343**, which broke the button across lines to add `:disabled`; "
        "re-verified RED by hand.",
        [
            (
                MODAL,
                '        data-cy="dispatch-confirm"',
                '        data-cy="confirm-dispatch"',
            )
        ],
    ),
]
