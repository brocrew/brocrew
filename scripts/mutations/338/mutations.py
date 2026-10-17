"""338 · The app behind the sheet — every row puts the cut back, or makes the guard unable to see it.

⛔ **The defect, in one sentence:** `.app` is `min-width: var(--app-min-w)` — 1180 px — the document
does not scroll, and `BrowserWindow` sets no minimum, so a window narrower than the frame cut the
frame and there was nothing to scroll to. Measured in a real window at a `1000px` viewport: **23
elements carrying a `data-cy` outside it, and every scrollable ancestor on the page already at its
extreme** — not behind a scrollbar, nowhere.

## ⚑ What is lost, and where — measured, and the reason the rows below are what they are

The layout does not respond below 1180: 46 of the 47 named elements sit at the same coordinates at
`900` as at `1180`, so it is one picture with the right-hand pixels removed. Each element therefore
has an exact onset, which is its own right edge:

| viewport | what stops being whole |
|---|---|
| `1179` | the frame's own 1 px of chrome; nothing named |
| **`1165`** | ⚠️ the titlebar's right cluster — the theme toggle, and the strip carrying the build line and `@startup-error` |
| `1163` | the session header's debug toggle (gone at `1134`) |
| `1121` | the composer hint — the line that names ⌘↵, the only other way to send |
| **`1114`** | 🔴 the **send button** (gone at `1086`) |
| `1079` | attach (gone at `1051`) · `1066` the provider chip · `1040` the prompt textarea |
| `1011` | the launcher column's right edge: the folder input, the fine-tune toggle, the credential note |

## 🔴 Why the fix is on `#app` and not on the window, which decides what is NOT a row here

⛔ **There is no row that adds `minWidth` to the `BrowserWindow`**, because that is not a defect —
it is the option this dispatch rejected, and a row has to be able to go red. Measured on the real
window: `setMinimumSize(1180, 700)` does hold it (a request for 864, half of this display, and a
request for 300 both answer 1180). ⚑ **And with that minimum in force, one ⌘+ from this app's own
`View` menu still puts the viewport at `1095.45`** — past the send button — because a zoom does not
change the window. The reach lives one layer in, where every road arrives.

## ⚠️ Which gate can see each row

| rows | the defect is caught by |
|---|---|
| `M1`-`M6` | ⚑ **both** — `test/dom/app-frame-reachable.dom.test.ts` (real Chromium, real viewport) and `test/app-frame-window.test.ts` |
| `M7`, `M8`, `M10` | ⚑ `test/app-frame-window.test.ts` alone — each is a declaration the dom file supplies for itself, so only the source pin can see it |
| `M9` | ⚑ both of those, and `conversation-chrome.test.ts` (measured: 1 failure) — the token is arithmetic elsewhere too |
| `M11`-`M16` | ⛔ the dom file's OWN fixture — each one makes it pass over nothing, and it fails instead |
| `M17` | ⛔ the source file's comment stripper, without which its block reader stops inside a comment |

## ⛔ What this table deliberately does NOT contain

**No row about the scrollbar's WIDTH in the runner.** `scrollbar-width: thin` is a classic 11 px bar
in the Electron window and an overlay bar that takes no space in this repo's browser runner
(measured, both). The dom file stands the bar in with a bottom border of the same measured height
and says so; a row about a number the runner cannot produce would be a row about the harness.

**No row that removes `page.viewport()` from the dom file.** Every assertion there would then be
about the runner's own frame, which is a real hazard — but it is `335`'s hazard, already carried by
that table, and `M13` reaches the same failure from the side this dispatch owns.
"""

BASE = "apps/desktop/src/renderer/src/assets/base.css"
TOKENS = "apps/desktop/src/renderer/src/assets/tokens.css"
SCREEN = "apps/desktop/src/renderer/src/components/RuntimeScreen.vue"
MAIN = "apps/desktop/src/main/index.ts"
DOM_TEST = "apps/desktop/test/dom/app-frame-reachable.dom.test.ts"
PIN_TEST = "apps/desktop/test/app-frame-window.test.ts"

MUTATIONS = [
    # ── the reach itself ──────────────────────────────────────────────────────────────────────────
    (
        "M1 · ⛔ THE DEFECT, verbatim · `#app` stops carrying the reach, so a window narrower than "
        "the 1180px frame cuts it again and no gesture reaches what is past the edge",
        [
            (
                BASE,
                "  overflow-x: auto;\n  overflow-y: hidden;",
                "  overflow-x: hidden;\n  overflow-y: hidden;",
            )
        ],
    ),
    (
        "M2 · ⛔ the same cut through the edit that reads like a tidy-up · `clip` is `hidden` "
        "without even a programmatic scroll, and the frame is unreachable exactly as before",
        [
            (
                BASE,
                "  overflow-x: auto;\n  overflow-y: hidden;",
                "  overflow-x: clip;\n  overflow-y: hidden;",
            )
        ],
    ),
    (
        "M3 · ⚠️ the vertical axis stops being closed · the shell is designed to have exactly one "
        "scrollbar and only when it does not fit; this opens a second one. ⚑ Caught as a "
        "DECLARATION rather than as a behaviour — measured, `.app` is `height: 100%` of this "
        "element, so at no width does the new axis have anything to reveal",
        [
            (
                BASE,
                "  overflow-y: hidden;\n  scrollbar-width: thin;",
                "  overflow-y: auto;\n  scrollbar-width: thin;",
            )
        ],
    ),
    (
        "M4 · ⚠️ the degrade stops being one you can see · an `auto` bar is an OVERLAY bar on this "
        "platform, so the cut becomes reachable and still says nothing — 187 §2's knowing degrade "
        "quietly back to a silent one",
        [(BASE, "  scrollbar-width: thin;\n}", "  scrollbar-width: auto;\n}")],
    ),
    (
        "M5 · ⛔ the pair that every other scroll container in this app declares, declared here · "
        "`scrollbar-color` inherits as an already-substituted value, so one line on the element "
        "every surface descends from puts the dark thumb on the white paper islands too. Measured: "
        "122 elements resolve an explicit `scrollbar-color` today, 307 with this row applied",
        [
            (
                BASE,
                "  scrollbar-width: thin;\n}",
                "  scrollbar-width: thin;\n  scrollbar-color: var(--scrollbar-thumb) transparent;\n}",
            )
        ],
    ),
    (
        "M6 · ⛔ the tempting alternative fix · let the DOCUMENT scroll instead. It reaches the same "
        "pixels and gives the shell back the rubber-band under the titlebar that `overflow: hidden` "
        "was there to prevent, and it moves the reach off the element that owns the frame",
        [
            (
                BASE,
                "  overflow: hidden;\n  background: var(--bg-glow), var(--bg);",
                "  overflow: auto;\n  background: var(--bg-glow), var(--bg);",
            )
        ],
    ),
    # ── the frame the reach is for ────────────────────────────────────────────────────────────────
    (
        "M7 · ⛔ the declaration 338 replaced · a frame keyed to the WINDOW does not know the "
        "horizontal bar took 11px out of `#app`'s content box, overflows it by exactly that, and "
        "loses its bottom strip — the composer's own row — to the `overflow-y: hidden` beside the "
        "reach",
        [
            (
                SCREEN,
                "  height: 100%;\n  min-width: var(--app-min-w);",
                "  height: 100vh;\n  min-width: var(--app-min-w);",
            )
        ],
    ),
    (
        "M8 · ⚠️ the frame stops having a minimum at all · nothing is cut any more, because the app "
        "is now laid out at 400px in a 400px window. That is not this dispatch's answer: the design "
        "does not respond below 1180 and 338 did not make it",
        [(SCREEN, "  min-width: var(--app-min-w);", "  min-width: 0;")],
    ),
    (
        "M9 · ⚠️ the one number the whole thing turns on moves · the frame, the onsets and the "
        "window's own 20px of margin above it are all this token",
        [(TOKENS, "--app-min-w: 1180px;", "--app-min-w: 1280px;")],
    ),
    (
        "M10 · ⛔ the window opens ALREADY cut · 1200 is twenty pixels above the frame; 1100 is "
        "below it, so the first thing a person sees is a titlebar missing its right-hand cluster",
        [(MAIN, "    width: 1200,\n    height: 840,", "    width: 1100,\n    height: 840,")],
    ),
    # ── the guard's own preconditions, so a green line means something ────────────────────────────
    (
        "M11 · ⛔ the control is no longer AT the frame's right edge · every 'it was off-screen "
        "before the gesture' becomes a statement about a button that was on screen all along",
        [(DOM_TEST, "  node.style.right = '0'", "  node.style.right = '400px'")],
    ),
    (
        "M12 · ⛔ the instrument's own control moves inside the window · `inside()` returning true "
        "for the reachable case is then worth nothing, because nothing ever tested that it can "
        "return false",
        [
            (
                DOM_TEST,
                "unreachable.style.left = 'calc(100vw + 40px)'",
                "unreachable.style.left = 'calc(100vw - 40px)'",
            )
        ],
    ),
    (
        "M13 · ⛔ the hazard leaves the path · a fixture frame with no minimum never overflows the "
        "window, so 'the frame is reachable' is asserted about a frame that always fitted",
        [(DOM_TEST, "  frame.style.minWidth = 'var(--app-min-w)'", "  frame.style.minWidth = '0'")],
    ),
    (
        "M14 · ⛔ 335's own trap, on this file's fixture · an absolutely positioned control inside "
        "an UNPOSITIONED frame falls back to the initial containing block, which is the window "
        "again — so `right: 0` lands it at the viewport's edge and it was never outside anything",
        [(DOM_TEST, "  frame.style.position = 'relative'", "  frame.style.position = 'static'")],
    ),
    (
        "M15 · ⛔ the fixture stops being the app's own element · with any other id the real "
        "`#app` rule never reaches it, and the file measures a plain div it styled itself",
        [(DOM_TEST, "  host.id = 'app'", "  host.id = 'app-frame'")],
    ),
    (
        "M16 · ⚠️ the stand-in moves and the number it stands in for does not · the bar's height is "
        "asserted as the literal the shipped window measured, so a fixture that sets a different "
        "border cannot quietly redefine what it is standing in for",
        [(DOM_TEST, "const BAR = 11", "const BAR = 13")],
    ),
    (
        "M17 · ⛔ the source pin's block reader walks into a comment · these rules carry long ones, "
        "and one of them contains `{@link #app}` — a brace-counting read of the raw text stops "
        "inside the prose and every declaration after it goes unpinned. ⚠️ **This row is killed by "
        "that one brace**: rewrite `base.css`'s own comment without a `}` in it and the row goes "
        "quiet while the stripper is still right, so the brace is named here rather than relied on "
        "silently",
        [
            (
                PIN_TEST,
                r"const withoutComments = (css: string): string => css.replace(/\/\*[\s\S]*?\*\//g, '')",
                r"const withoutComments = (css: string): string => css",
            )
        ],
    ),
]
