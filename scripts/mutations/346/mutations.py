"""346 · The overlays too — each row is THE DEFECT, put back verbatim (131).

⚑ **The question `344` §7 put to the person, and his answer**:

> *"The sheets, the drawer, the command palette and the toasts sit outside every body scope by
> `080`'s carrier rule… a dispatch sheet is neither a header nor a body. It looks right to me as
> chrome — but it is a decision, not a reading, so it is yours."*

**the person: *"they should also be light."*** ⛔ Only the titlebar and the left rail stay dark.

## 🔴 The two shapes that fail here, and only one of them is 344's

`344`'s whole instrument looks for the WRONG COLOUR — a near-black chip stranded on paper. Half of
this table is that shape and is caught the same way. ⛔ **The other half is two RIGHT colours with
nothing between them**, which no stranded-token scan can see:

  * **a white document dissolving into a white sheet.** `DocumentBody`'s `.doc-paper` is
    `--paper-bg`, tuned to be the light thing on dark chrome; a sheet in a light scope is `#fff`.
    Measured, their fills are **eight channel levels apart** — so the fill is not the separator, and
    M12–M14 delete the two things that are.
  * **a dim tuned for near-black, over paper.** `--overlay-backdrop` has had a paper value since
    `080` and, until 346, `OverlayHost` could not reach it: the same app dimmed itself two different
    ways depending on which component raised the overlay.

## 🔴 Which gate can see each row

| rows | the defect is caught by |
|---|---|
| M1, M2, M4, M6, M11–M17, M23 | `run_suite` — `apps/desktop/test/dom/overlays-on-paper.dom.test.ts` (dom) |
| M3, M5, M24 | `run_suite` — `apps/desktop/test/chat-theme.test.ts` (the carrier census) |
| M7–M10 | `run_suite` — `apps/desktop/test/chat-theme.test.ts` (the stranded scan) |
| M18–M22 | `run_suite` — `apps/desktop/test/chat-theme.test.ts` (the censuses' own lists) |

⚠️ **M3, M5 and M24 are held by a SOURCE census and by nothing in the browser, and that is
measured rather than assumed** — all three survived their first pass against the dom file. Neither
of the two surfaces they name is mountable there: the palette is `Teleport`ed to `body`, out of the
harness's host entirely, and the notice toast belongs to `RuntimeScreen`, which is the app frame.
The live probe opens both over a real light app; between it and the census the three rows are
covered, and a reader deciding what this table's greens are worth should know which of them the
browser never saw.

⛔ **M23/M24's first draft prefixed the comment above the declaration instead of deleting the
declaration** — bytes changed, behaviour did not, and a row like that records as a survivor by
construction. Caught by sweeping the table for `old == new` before running anything.

## ⚠️ What this table deliberately does NOT contain

⛔ **No row deletes a name from the `CARRIERS` list in `chat-theme.test.ts`.** Shortening the list a
test loops over makes the test WEAKER rather than red, and records as a survivor by construction
(`a-mutation-that-changes-nothing-reports-as-a-survivor`). ⚑ **M1, M3, M4 and M5 are the observable
form of the same rule**: one per carrier, deleting the attribute itself — which is exactly what a
missing name in that list would stop anybody noticing.

⛔ **No row makes `.doc-paper`'s fill `#fff`.** That is the dissolve everybody pictures, and it is
NOT the defect: measured, the document and the sheet are already within eight levels, and what
separates them is the rule and the shadow either way. A row on the fill would be a row about a
number that is not carrying anything.

⛔ **No row re-tints the backdrop by a step.** A dim that is merely *wrong* is a contrast finding
and the dom file's own floors own it; M15 and M16 put back the two states that actually shipped —
the near-black dim `OverlayHost` resolved until this task, and an opaque one.

⛔ **No row touches the titlebar or the rail.** 346 §3 puts them out of scope and `344` already
asserts them byte-identical on every surface; a row here would be a second, weaker copy of that.
"""

HOST = "apps/desktop/src/renderer/src/components/OverlayHost.vue"
PALETTE = "apps/desktop/src/renderer/src/components/CommandPalette.vue"
TOASTS = "apps/desktop/src/renderer/src/components/ToastStack.vue"
SCREEN = "apps/desktop/src/renderer/src/components/RuntimeScreen.vue"
BODY = "apps/desktop/src/renderer/src/components/DocumentBody.vue"
TOKENS = "apps/desktop/src/renderer/src/assets/tokens.css"
THEME_TEST = "apps/desktop/test/chat-theme.test.ts"
CAPABILITIESSHEET = "apps/desktop/src/renderer/src/components/CapabilitiesSheet.vue"

MUTATIONS = [
    # ── §1 · the three carriers, which are the whole of the ruling ───────────────────────────────
    (
        "M1 · ⛔ THE DEFECT, verbatim · `OverlayHost` carries no scope, which is the state 346 "
        "found it in — every sheet, drawer and modal in the app goes back to near-black over a "
        "paper page, and so does the dim behind them",
        # ⚑ **popups drawn in open order · re-anchored in place, not retired** — the host is drawn into the screen's overlay layer, a level deeper; the plant still takes the light scope off it
        [(HOST, "      data-cy=\"overlay-host\"\n      data-chat-theme=\"light\"\n", "      data-cy=\"overlay-host\"\n")],
    ),
    (
        "M2 · ⚠️ the host declares the scope and declares it DARK · one word, and the ruling is "
        "reversed with the mechanism left in place, which is how a scheme drifts back without "
        "anybody deciding to reverse it",
        [(HOST, '    data-chat-theme="light"\n', '    data-chat-theme="dark"\n')],
    ),
    (
        "M3 · 🔴 the command palette is left out · it is TELEPORTED to `body`, so it inherits "
        "nothing from the host and is the one overlay a fix applied at `OverlayHost` cannot reach "
        "— the single dark island in a light app, put there by no rule anybody chose",
        [(
            PALETTE,
            '      data-cy="palette-scrim"\n      data-chat-theme="light"\n',
            '      data-cy="palette-scrim"\n',
        )],
    ),
    (
        "M4 · ⚠️ the toast stack is left out · a toast is fixed to the app frame rather than "
        "hosted, so it inherits the chrome the way the rail does — a near-black chip landing in "
        "the corner of a paper page, which is the shape `344` spent 45 tokens removing everywhere "
        "else",
        [(TOASTS, ' data-cy="toast-stack" data-chat-theme="light"', ' data-cy="toast-stack"')],
    ),
    (
        "M5 · ⚠️ the app frame's OWN notice toast is left out · there are two toasts in this app "
        "and this is the second — one paper chip and one near-black chip on the same page, which "
        "is worse than either answer taken consistently",
        [(
            SCREEN,
            '<div v-if="notice" class="toast" data-cy="toast" data-chat-theme="light">',
            '<div v-if="notice" class="toast" data-cy="toast">',
        )],
    ),
    (
        "M6 · ⛔ the scope is put on the PANELS instead of the host · the sheets look right and the "
        "BACKDROP does not — a 58%-alpha black dim over a paper page, and a new sheet added "
        "tomorrow is dark because somebody forgot a line rather than because a rule said so",
        # ⚑ Landing D-016a (bd70d693) · re-anchored in place, not retired — The rule holds: the
        # light scope belongs on the overlay HOST (`OverlayHost`), not on its panels, so the
        # backdrop and any future sheet are on paper. `DispatchModal` is deleted, so plant the
        # panel-level attribute on `CapabilitiesSheet` (a hosted sheet, in the HOSTED roster) while
        # removing it from the host; both edits keep the anchors unique.
        [
            (HOST, '    data-chat-theme="light"\n', ''),
            (CAPABILITIESSHEET, 'data-cy="capabilities-sheet"', 'data-cy="capabilities-sheet"\n    data-chat-theme="light"'),
        ],
    ),
    # ── §2 · the four tokens that had never been on anything but near-black ──────────────────────
    (
        "M7 · ⛔ `--toast-bg` has no paper value · `rgba(21, 28, 40, 0.97)` is a near-opaque "
        "near-black, and 0.97 is exactly what stops you seeing that it is wrong through it",
        [(TOKENS, "  --toast-bg: rgba(255, 255, 255, 0.97);\n", "")],
    ),
    (
        "M8 · ⚠️ `--toast-shadow` has no paper value · a toast is the one floating thing in this "
        "app with no backdrop under it, so its shadow is the whole of what says it is above the "
        "page — and a 34% BLACK one on paper is the defect `344` found in `--shadow`",
        [(TOKENS, "  --toast-shadow: 0 14px 40px rgba(40, 51, 78, 0.18);\n", "")],
    ),
    (
        "M9 · ⚠️ `--accent-border-weak` has no paper value · the palette's highlighted row and the "
        "rail's active item draw an 11%-alpha PALE blue tuned for near-black, which on white is an "
        "edge that is simply not there · killed by `chat-theme.test.ts`",
        # ⚑ **W4.205 · re-anchored in place, not retired** — W4.205 · 2ca719c5 re-valued the paper --accent-border-weak to #e3e3ff; deleting it leaves :root's rgba(167, 183, 255, 0.11). CommandPalette (in READING_SURFACE) paints it, so chat-theme.test.ts's stranded scan catches it.
        # ⚑ **BroCrew default look (5dcd8456e, 87d2c694b) · re-anchored in place, NOT VERIFIED and HELD** — the paper --accent-border-weak is #f9d3c2; deleting it leaves :root's crew-orange rgba(255, 138, 92, 0.3) for chat-theme.test.ts's stranded scan.
        [(TOKENS, "  --accent-border-weak: #f9d3c2;\n", "")],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-016a, bd70d693):** `--accent-solid-shadow` is deleted
        # from tokens.css by D-016a; it was the halo under the primary action on the three sheets
        # (DispatchModal, RecruitSheet and one more) that the card removed. No live token or sheet
        # is left for the plant. Its anchor is left stale, so the census records it retired.
        "M10 · ⚠️ `--accent-solid-shadow` has no paper value · the halo under the primary action on "
        "three sheets — invisible to a scan anchored at `^`, because a box-shadow's value starts "
        "with a `0` (`344`, and this is the third token to wear it)",
        [(TOKENS, "  --accent-solid-shadow: 0 4px 18px rgba(76, 96, 239, 0.22);\n", "")],
    ),
    (
        "M11 · 🔴 `--toast-bg` keeps the DARK value inside the light scope · the token HAS a light "
        "value, it is just the wrong one — invisible to the stranded scan, which only asks whether "
        "one exists, and caught by the pair that measures the toast's own sentence on it",
        [(
            TOKENS,
            "  --toast-bg: rgba(255, 255, 255, 0.97);",
            "  --toast-bg: rgba(21, 28, 40, 0.97);",
        )],
    ),
    # ── §3 · what separates a document from the sheet it sits on (346 §1) ────────────────────────
    (
        "M12 · 🔴 **THE §1 DEFECT** · the document paper loses its rule, so the only thing left "
        "between a `#f7f8fa` document and a `#fff` sheet is a fill step of eight levels — two "
        "near-whites with nothing between them, which reads as broken rather than as anything "
        "anybody can name",
        [(
            BODY,
            # ⚑ **theme host · re-anchored in place, not retired** — NOT VERIFIED. Theme border widths now use tokens; the same defect retains all other declarations.
            "  overflow: hidden;\n  border: var(--border-width) solid var(--paper-line);\n",
            "  overflow: hidden;\n",
        )],
    ),
    (
        "M13 · 🔴 the rule is there and is the wrong colour · `--line` is the light scope's own "
        "hairline at 10% ink, which on white is under half the step `--paper-line` gives — the "
        "shape where a fix looks applied and measures at nothing",
        [(
            BODY,
            # ⚑ **theme host · re-anchored in place, not retired** — NOT VERIFIED. Theme border widths now use tokens; the same defect retains all other declarations.
            "  overflow: hidden;\n  border: var(--border-width) solid var(--paper-line);",
            "  overflow: hidden;\n  border: var(--border-width) solid var(--line);",
        )],
    ),
    (
        "M14 · 🔴 the document paper casts no shadow · the rule alone is **1.35:1** against the "
        "sheet, well under the 3:1 a non-text boundary asks for, so the elevation is not "
        "decoration here — it is the other half of the separator",
        [(BODY, "  box-shadow: var(--paper-shadow);\n", "")],
    ),
    # ── §4 · the dim (346 §2) ───────────────────────────────────────────────────────────────────
    (
        "M15 · ⛔ the backdrop keeps the near-black dim on paper · `rgba(3, 5, 8, 0.58)` over "
        "`--paper-bg` composites to `rgb(107, 109, 112)` — that is not a dim, it is a different "
        "page, and it is the state every sheet `RuntimeScreen` raises was in until this task · killed by `overlays-on-paper.dom.test.ts`",
        [(
            TOKENS,
            # ⚑ **W4.205 · re-anchored in place, not retired** — W4.205 · 2ca719c5 moved the paper dim to rgb(38 51 80 / 28%); the plant puts the chrome's dim on paper. Recomputed: over the test's PAPER it composites to rgb(116, 122, 135), luminance 0.19 (< 0.35), and its channel gap to the chrome dim is 0 (needs > 20). Killed by overlays-on-paper.dom.test.ts §3.
            "  --overlay-backdrop: rgb(38 51 80 / 28%);",
            "  --overlay-backdrop: rgba(20, 29, 48, 0.58);",
        )],
    ),
    (
        "M16 · ⚠️ the dim becomes a WASH · the person asked for the opposite in as many words — *\"keep "
        "it a dim rather than a wash: its job is to say 'this is modal' without hiding what you "
        "were reading\"* · killed by `overlays-on-paper.dom.test.ts`",
        [(
            TOKENS,
            # ⚑ **W4.205 · re-anchored in place, not retired** — W4.205 · 2ca719c5 moved the paper dim to rgb(38 51 80 / 28%); the plant is the same colour opaque, a wash. overlays-on-paper.dom.test.ts §3 refuses alpha >= 0.5.
            "  --overlay-backdrop: rgb(38 51 80 / 28%);",
            "  --overlay-backdrop: rgb(38 51 80);",
        )],
    ),
    (
        "M17 · ⛔ the light scope has no `--panel` · every overlay panel in this app is "
        "`background: var(--panel)`, so the sheets go back to `#0d1118` while their own documents "
        "stay paper — the one failure mode 021's light shipped, on the surface a person opens most · killed by `chat-theme.test.ts`",
        # ⚑ **W4.205 · re-anchored in place, not retired** — W4.205 · 2ca719c5 wrote the light --panel as #ffffff; same edit as 344 M16, scored by this table. Killed by chat-theme.test.ts's stranded scan.
        [(TOKENS, "  --panel: #ffffff;\n", "")],
    ),
    # ── §5 · the lists these guards are worth exactly the completeness of ────────────────────────
    (
        "M18 · ⛔ `READING_SURFACE` forgets `ToastStack` · `083`'s point about this list made "
        "against this list for the fifth time — a component missing from it is a component whose "
        "tokens are checked in NEITHER direction, and both of the toast's are its alone",
        [(THEME_TEST, "  'ToastStack',\n", "")],
    ),
    (
        "M19 · ⛔ it forgets the command palette · `--accent-border-weak`'s only other consumers "
        "are the rail and the changes tab, neither of which is a light scope, so this one name is "
        "the whole of what asks for that token's paper value",
        [(THEME_TEST, "  'CommandPalette',\n", "")],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-016a, bd70d693):** The row drops `DispatchModal` and
        # `RecruitSheet` from a list in chat-theme.test.ts, but D-016a deleted both sheets and their
        # list entries (the surviving list has only `AllDocumentsSheet` left of that group, and the
        # token `--accent-solid-shadow` they existed for is gone). The anchor text is gone and the
        # rule it guarded went with the token. Its anchor is left stale, so the census records it
        # retired.
        "M20 · ⛔ it forgets the three sheets that carry a primary action · `--accent-solid-shadow` "
        "is painted by exactly those three and by nothing else in any light scope",
        [(
            THEME_TEST,
            "  'DispatchModal',\n  'DocumentDrawer',\n  'AllDocumentsSheet',\n  'RecruitSheet',\n",
            "  'AllDocumentsSheet',\n",
        )],
    ),
    (
        "M21 · ⚠️ the carrier census reads `<OverlayHost` and finds nothing · the enumeration is "
        "taken from `RuntimeScreen`'s own branch list so it moves when the app does; pointed at a "
        "tag that is not there it enumerates the empty set and every sheet passes unasked",
        [(THEME_TEST, "const open = screen.indexOf('<OverlayHost')", "const open = screen.indexOf('<OverlayGuest')")],
    ),
    (
        "M22 · ⚠️ the notice-toast census stops reading the `.toast` rule · a source census whose "
        "slice is empty is a census that agrees with everything (`344`, twice)",
        [(THEME_TEST, "const at = screen.indexOf('\\n.toast {')", "const at = screen.indexOf('\\n.tost {')")],
    ),
    # ── §6 · the ink, which is not the fill and which no screenshot could have caught ───────────
    (
        "M23 · 🔴 **the ink is inherited rather than re-resolved** · `color` inherits as a resolved "
        "COLOUR, not as the `var()` that produced it, so `body`'s `#e7ecf3` — a near-white for a "
        "near-black page — lands inside the light scope and every sheet computes it on its own "
        "root. ⚠️ Nothing goes invisible TODAY, because every text element in those sheets happens "
        "to declare its own colour; this is 091's `--panel-3` arriving through a property nobody "
        "had named, and it is the state this dispatch's own live build was in until the probe read "
        "it back",
        [(HOST, "  color: var(--text);\n  inset: 0;\n  outline: none;", "  inset: 0;\n  outline: none;")],
    ),
    (
        "M24 · ⚠️ the same, on the teleported palette · it inherits from `body` directly, so it is "
        "the one carrier a fix applied at `OverlayHost` cannot reach — the same asymmetry as M3, "
        "one property down",
        [(PALETTE, "  color: var(--text);\n  inset: 0;\n}", "  inset: 0;\n}")],
    ),
]
