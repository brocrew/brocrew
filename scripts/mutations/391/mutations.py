"""391 · The CSS we never applied.

⛔ **Five design dispatches built the design's SHAPE in our own palette.** `382` mapped the fields,
`384` built the sheet and its ground, `385` took the frame, `389` the bar and the shelf, `390` the
safety lane — and the person, looking at the result: *"there is still the black stripe."* This commit is
the values: v2.5.1's navy on the chrome, its blue-slate ink on a bluer page, and its indigo where
the accent was a pale cyan-blue.

## 🔴 The three shapes a palette change fails in

1. **The ground moves and something is left behind.** ⚑ `M1`-`M5`. A near-black surface on a navy
   app is a hole; a band tuned to sit 11 channels from a near-black page is 47 channels from a navy
   one; a hex hand-copied into a component is a value the palette cannot reach at all. Every one of
   these is invisible in a diff of `tokens.css`, because the thing left behind is somewhere else.
2. **A ratio quietly relaxes.** ⚑ `M6`-`M8`. Contrast is `(L+0.05)/(Lbg+0.05)`, so raising the
   ground divides EVERY dark reading by 1.24 at a stroke. ⛔ **A bound written as "light must be no
   worse than dark" gets EASIER when dark gets worse**, which is the one direction a comparative
   assertion cannot see. The inks that would have fallen under a floor were lifted; these rows put
   them back.
3. **A designer's value is taken where our own bar says it cannot be.** ⚑ `M9`-`M11`. v2.5.1 draws
   small text at 3.0–3.2:1 and its amber only 1.107× above its routine grey. Three values were
   darkened along the mock's own hue rather than reverted to ours, and each row here is the mock's
   value put back verbatim.

## 🔴 Which gate can see each row

| rows | the defect is caught by |
|---|---|
| M1, M2 | `run_suite` — `apps/desktop/test/dom/theme-scope.dom.test.ts` (dom) |
| M3, M5, M8, M9, M10 | `run_suite` — `apps/desktop/test/chat-theme.test.ts` |
| M4 | `run_suite` — `apps/desktop/test/chat-theme.test.ts` (the chrome census 391 added) |
| M7 | `run_suite` — `apps/desktop/test/dom/library-layout.dom.test.ts` (dom) |
| M6 | `run_suite` — `apps/desktop/test/dom/paper-ink.dom.test.ts` (dom) |
| M11 | `run_suite` — `apps/desktop/test/dom/overlays-on-paper.dom.test.ts` (dom) |

## 🔴 Two rows survived their first pass, and both were instrument gaps rather than wrong rows

⛔ **`M5` — the rail has no colour test of any kind.** `--rail` and `--rail-bg` are two independent
declarations painted by two rules in `SideRail.vue` (the surface at :1006, the anchored footer's
fade at :1431), and putting `--rail` back to `#090c12` while the rail itself stayed navy passed
every suite in the repository. ⚑ Closed by an assertion that the fade lands where the gradient
starts — `chat-theme.test.ts`'s *"the rail fades into its own colour"*.

⛔ **`M9` — every floor looks DOWN.** Reverting `--paper-ink` to its neutral `#1b1f24` makes the ink
DARKER, so every contrast floor in `paper-ink.dom.test.ts` and `overlay-panel.dom.test.ts` passes
more comfortably than before. The paper's background has been pinned since 129; its ink was pinned
by nothing at all. ⚑ Closed by pinning the pair rather than the half.

⚠️ **Both were found by running the rows, not by writing them** — which is the argument for running
each row against the gate its own table names rather than against the suite.

## ⚠️ What this table deliberately does NOT contain

⛔ **No row puts `--bg-glow`'s radial back.** Measured: `.app` is `100vw × 100%` and paints
`--app-bg` over the whole of `body`, so with `--app-bg` opaque the glow reaches no pixel at all, and
with the old `0.9` it reached under one channel of blue. ⚑ **A row nothing can see is a row that
records as a survivor by construction** — the gap is real and it is stated here instead: the app
frame's own decoration is behind an opaque child and no instrument in this repository looks at it.

⛔ **No row restores `--app-bg`'s `0.9` alpha.** Same reason and it is worth separating: the alpha
was INERT on the old ground (`rgba(7, 9, 13, .9)` over `#07090d` composites to `#07090d` exactly)
and would be destructive on the new one — but the only element that paints it is `RuntimeScreen`'s
`.app`, which nothing mounts. `389` filed that instrument gap for the title bar and fixed it by
extracting a component; the frame itself still has it.

⛔ **No row changes a NUMBER in `chat-theme.test.ts`'s `PAIRS` list or lowers one of its floors.**
Weakening an assertion passes the assertion (`a-mutation-on-a-census-is-invisible-to-that-census`).
⚑ **M8, M9 and M10 are the observable form of the same rule**: they put back the three values whose
own bars are what those floors exist to hold.

⛔ **No row touches the main process's `backgroundColor` or `index.html`'s pre-paint fill.** Both
are the app's ground restated where a custom property cannot be read, both moved with it, and
neither is reachable from any test in this repository — a window's first frame and the paint before
the token sheet loads. Stated rather than pretended.
"""

TOKENS = "apps/desktop/src/renderer/src/assets/tokens.css"
SHADE = "apps/desktop/src/renderer/src/components/ClosingShade.vue"

MUTATIONS: list[tuple[str, list[tuple[str, str, str]]]] = [
    # ── 1 · the ground moves and something is left behind ────────────────────────────────────────
    (
        "M1 · 🔴 THE DEFECT, verbatim · the ground goes back to near-black while everything built "
        "on it stays navy — the state the app shipped in for five design dispatches, which is what "
        "the person was looking at when he said *'there is still the black stripe'* · killed by `theme-scope.dom.test.ts`",
        # ⚑ **W4.205 · re-anchored in place, not retired** — W4.205 · 2ca719c5 stripped the comment; --bg is still the navy base.css paints the body with. Killed by theme-scope.dom.test.ts's dark row (DARK_PAGE 24,33,53; the plant is 29 channels off, bound 2).
        # ⚑ **BroCrew default look (5dcd8456e, 87d2c694b) · re-anchored in place, NOT VERIFIED and HELD** — --bg is BroCrew's #14173a now; the plant is unchanged. theme-scope.dom.test.ts's dark row now types DARK_PAGE 20,23,58.
        [(TOKENS, "  --bg: #14173a;", "  --bg: #07090d;")],
    ),
    (
        "M2 · ⛔ the blurred surface header keeps the band it was tuned for · `rgba(11, 14, 20, "
        ".72)` sat 11.5 channels from a `#07090d` page and sits 47 from a navy one — the exact "
        "failure `theme-scope`'s `BELONGS = 16` exists to catch, and the reason every dark-based "
        "alpha in this file moved by the ground's own delta rather than being re-picked",
        [(TOKENS, "  --surface-header-bg: rgba(28, 38, 60, 0.72);", "  --surface-header-bg: rgba(11, 14, 20, 0.72);")],
    ),
    (
        "M3 · ⚠️ the raised card fill stays where it was · `#111722` beside a `#182135` page is "
        "DARKER than the page, so the depth ramp inverts and a raised surface becomes a well — the "
        "same reading §13 already makes about paper, arriving on the chrome",
        # ⚑ **BroCrew default look (5dcd8456e, 87d2c694b) · re-anchored in place, NOT VERIFIED and HELD** — dark --panel-2 is #272a4a now; the plant is still darker than the #14173a page, so the depth ramp still inverts.
        [(TOKENS, "  --panel-2: #272a4a;", "  --panel-2: #111722;")],
    ),
    (
        "M4 · 🔴 the quit shade goes back to a hex in the component · `tokens.css`'s own rule is "
        "*'a hand-copied hex in a component is a bug'*, and this is what it costs: a palette change "
        "cannot reach a value that is not in the palette, so the app would close behind a near-"
        "black sheet on a navy window — at the one moment nobody photographs",
        [(SHADE, "  background: var(--closing-shade-bg);", "  background: rgba(7, 9, 13, 0.86);")],
    ),
    (
        "M5 · ⚠️ the rail's own base is left on the near-black · `--rail` and `--rail-bg` are two "
        "independent declarations and only one of them is the gradient: the anchored footer fades "
        "to `#090c12` over a navy rail, which is a seam rather than a fade",
        # ⚑ **BroCrew default look (5dcd8456e, 87d2c694b) · re-anchored in place, NOT VERIFIED and HELD** — --rail is BroCrew's #1b1f4b, where --rail-bg's gradient starts; the plant leaves the fade on a colour the rail does not paint.
        [(TOKENS, "  --rail: #1b1f4b;", "  --rail: #090c12;")],
    ),
    # ── 2 · a ratio quietly relaxes ──────────────────────────────────────────────────────────────
    (
        "M6 · 🔴 the accent stays the pale cyan-blue · v2.5.1's rail draws `#a7b7ff` and its paper "
        "`#4c60ef`; ours were one token and one hue, 21° away from either. The chip's own pair is "
        "what reads it — `--accent-ink` on `--accent`, in both themes, on six surfaces · killed by `chat-theme.test.ts`",
        # ⚑ **W4.205 · re-anchored in place, not retired** — W4.205 · 2ca719c5 stripped the comment; dark --accent still #a7b7ff. ⚠️ paper-ink.dom.test.ts no longer reads it: white on #7dbbff is 2.01:1, inside that file's 1.9–2.1 band, and --accent-ink #182135 on it is 7.97:1. It is killed by chat-theme.test.ts 'the light values are scoped to the pane' (DARK['--accent'] toBe '#a7b7ff').
        # ⚑ **BroCrew default look (5dcd8456e, 87d2c694b) · re-anchored in place, NOT VERIFIED and HELD** — dark --accent is crew orange #ff8a5c; chat-theme.test.ts pins it, so the old pale blue plant is still caught there.
        [(TOKENS, "  --accent: #ff8a5c;", "  --accent: #7dbbff;")],
    ),
    (
        "M7 · ⛔ the faintest ink takes the compression with everything else · `#5f6979` read 3.59:1 "
        "on the near-black and reads 2.89:1 on the navy — under the 3:1 floor `library-layout` "
        "measures across 70 elements, whose own worst case was the row's clock at 3.24 · killed by `library-layout.dom.test.ts`",
        # ⚑ **W4.205 · re-anchored in place, not retired** — W4.205 · 602e204e moved dark --faint from #93a4c2 to #8597b6 (5.43:1 on --bg #182135, 4.51:1 on --panel-2 #222f4a). The plant puts the compressed #5f6979 back: 2.89:1 on --bg and 2.40:1 on --panel-2, under the 3.0 floor of library-layout.dom.test.ts's dark walk ('nothing in the list is unreadable in dark'), which still paints --faint in SessionLibrary.
        # ⚑ **BroCrew default look (5dcd8456e, 87d2c694b) · re-anchored in place, NOT VERIFIED and HELD** — dark --faint is #a6aad8; the plant is the same compressed ink, under library-layout's 3.0 floor on the indigo ground.
        [(TOKENS, "  --faint: #a6aad8;", "  --faint: #5f6979;")],
    ),
    (
        "M8 · ⚠️ the light page keeps the neutral it had · `#f7f8fa` is a grey sheet beside a navy "
        "shell; `#f8faff` is the mock's own, and the two washes over it inherit the difference. "
        "The invariant this row is really about is that `--paper-*` is ONE value in both themes · killed by `chat-theme.test.ts`",
        # ⚑ **W4.205 · re-anchored in place, not retired** — W4.205 · 2ca719c5 moved --paper-bg #f8faff → #fdfdff; the plant still puts the neutral grey sheet back (6 levels off). ⚠️ The killer chat-theme.test.ts 'the document viewer keeps its own paper' still pins '#f8faff', so it is red on HEAD; once the pin reads '#fdfdff' it kills this.
        # ⚑ **BroCrew default look (5dcd8456e, 87d2c694b) · re-anchored in place, NOT VERIFIED and HELD** — --paper-bg is BroCrew's warm #fbfaf7, pinned by chat-theme.test.ts; the plant puts a neutral grey sheet back.
        [(TOKENS, "  --paper-bg: #fbfaf7;", "  --paper-bg: #f7f8fa;")],
    ),
    # ── 3 · a designer's value where our own bar says it cannot be ───────────────────────────────
    (
        "M9 · 🔴 the paper's ink goes back to the neutral near-black · `#1b1f24` is what made the "
        "light side read as a different product from the chrome; `#28334e` is v2.5.1's `--ink` and "
        "it is 4 points less contrasty, which is the whole reason the fade band had to be re-"
        "measured rather than restated · killed by `chat-theme.test.ts`",
        # ⚑ **W4.205 · re-anchored in place, not retired** — W4.205 · 2ca719c5 moved --paper-ink #28334e → #2d3753 (11.6:1 on #fdfdff; the plant is 16.3:1, darker, so floors stay green). ⚠️ The only killer, chat-theme.test.ts's pin, still expects '#28334e' and is red on HEAD; once it reads '#2d3753' it kills this.
        # ⚑ **BroCrew default look (5dcd8456e, 87d2c694b) · re-anchored in place, NOT VERIFIED and HELD** — --paper-ink is BroCrew's indigo #171a3a, pinned by chat-theme.test.ts; the plant is the neutral near-black again.
        [(TOKENS, "  --paper-ink: #171a3a;", "  --paper-ink: #1b1f24;")],
    ),
    (
        "M10 · 🔴 the mock's amber, taken verbatim · `#956314` reads 4.94:1 where `--faint` reads "
        "4.46:1 — **1.107×**, inside the 9% `--waiting`'s own docblock has called the point where "
        "*'the notice ladder stopped being a ladder'* since 022. ⚑ This is the row 391 found by "
        "measuring its own comment and is the reason that sentence is an assertion now",
        [(TOKENS, "  --waiting: #784f10;", "  --waiting: #956314;")],
    ),
    (
        "M11 · ⚠️ the document's rule takes the mock's border verbatim · `#e2e7f1` is one channel "
        "too light to be an edge at the 30 `overlays-on-paper` measures, and a document that "
        "dissolves into the sheet it sits on is 346 §1's whole finding · killed by `overlays-on-paper.dom.test.ts`",
        # ⚑ **W4.205 · re-anchored in place, not retired** — W4.205 · 602e204e darkened --paper-line to #dde1eb, 32 levels off the viewer's sheet (--drawer-solid #fdfdff in the light scope). The plant is the mock's #e2e7f1 again, 27 levels off, so the document's rule drops under the >= 30 edge that overlays-on-paper.dom.test.ts 'so the edge and the elevation carry it' asserts on the canonical document viewer.
        # ⚑ **BroCrew default look (5dcd8456e, 87d2c694b) · re-anchored in place, NOT VERIFIED and HELD** — --paper-line is #d0ccc2 (35 levels off the light --drawer-solid #f3f2ee); the plant is 17 off, under overlays-on-paper's 30.
        [(TOKENS, "  --paper-line: #d0ccc2;", "  --paper-line: #e2e7f1;")],
    ),
]
