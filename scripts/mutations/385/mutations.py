"""385 · One title bar.

⛔ **Three claims, three shapes of failure.** This commit takes the window's frame off and makes the
three decorative dots into three controls that work, opens the companion on a fresh profile, and
takes v2.3's rail rhythm. Each of those fails differently, and the rows below are grouped by which.

## 🔴 The three shapes

1. **A frame that comes back, or a control that is a picture again.** `384` found two title bars and
   three `<span>`s that did nothing; the whole of §1 is that neither can return unnoticed — not the
   OS frame, not a control outside the drag region's escape, not a `zoom` that cannot leave full
   screen, not a channel that does the nearest thing to what it was asked. ⚑ `M1`-`M8`.
2. **A default that is not a default.** Flipping the companion open is one word; what makes it safe
   is that it is a SEED and not an override — a machine that shut the drawer keeps it shut. ⚑ `M9`,
   `M10`.
3. **A rhythm that only looks moved.** The rail's numbers are v2.3's now, and every one of them is a
   number a stylesheet can quietly put back. ⚑ `M11`-`M14`.

## ⛔ Which gate can see each row

| rows | the defect is caught by |
|---|---|
| `M1` | ⚑ **`one-title-bar.test.ts`** §1 — the frame, back on, and a second bar with it |
| `M2` | ⚑ **…** §1 — the 32px bar that makes the shell 808, put back to 42 |
| `M3` | ⚑ **…** §1 — the handler wired to *the* window rather than to the sender's |
| `M4` | ⚑ **…** §2 — `zoom` that cannot leave a full screen it has no OS control to leave |
| `M5` | ⚑ **…** §2 — a destroyed window touched instead of answered |
| `M6` | ⚑ **…** §3 — a verb outside the vocabulary doing the nearest thing |
| `M7` | ⚑ **`window-controls.dom.test.ts`** §3 — the `no-drag` escape, without which a button is a picture |
| `M8` | ⚑ **…** §1 — the accessible name, without which the window has no controls to anything but an eye |
| `M9` | ⚑ **`conversation-chrome.test.ts`** — the companion default, back to shut |
| `M10` | ⚑ **…** — a "default" that overwrites the choice a person made |
| `M11` | ⚑ **`rail-rhythm.dom.test.ts`** §1 — the rail's width |
| `M12` | ⚑ **`conversation-chrome.test.ts`** — the second `--rail-w`, which puts 1180 back in the narrow band |
| `M13` | ⚑ **`rail-rhythm.dom.test.ts`** §1 — the section gap, back to two gaps stacking |
| `M14` | ⚑ **…** §2 — the anchored end, back inside the scroller |

## ⚠️ What this table deliberately does NOT contain

⛔ **No row that only `pnpm run probe:window-controls` could catch.** The probe is the only instrument
here that owns a window, and it is not in `ci` — a row aimed at it would be applied, the suite would
stay green, and it would report as a survivor having measured the harness rather than the code
(`a-guard-that-only-a-live-run-can-trip-is-dark-by-default`). ⚑ What `ci` holds instead is
`one-title-bar.test.ts` §5, which pins the probe's hooks against the component so the live
instrument cannot go dark unnoticed.

⛔ **No row writing `-webkit-app-region: none` in place of `no-drag`.** ⚠️ **That row was written,
and it SURVIVED** — measured, and the reason is worth the paragraph: in this Chromium an element that
DECLARES `none` computes `no-drag`, and only an element that declares nothing computes `none`. The two
keywords are one behaviour, so the edit changed nothing observable and reported as a survivor
(`a-mutation-that-changes-nothing-reports-as-a-survivor`). ⚑ `M7` removes the declaration instead,
which is the state `384`'s spans were actually in, and the table in
`window-controls.dom.test.ts` §3 carries the measurement.

⛔ **No row on the SMOKE's inverted drawer assertion.** `ui-live-smoke.mjs` step 2 now says the
drawer is open on a fresh profile; putting `!== 0` back would be a mutation on an instrument that
`ci` never runs, and `mutations:check` would count a survivor for a row nothing could ever kill.

⛔ **No row turning `--surface-tuck` or the bar's colour into another value.** Those are tastes with
no assertion behind them, and a row whose replacement changes nothing observable reports as a
survivor (`a-mutation-that-changes-nothing-reports-as-a-survivor`).

## 🔴 The row that could not be written, and it is a property rather than an omission

⛔ **There is no row for *"`close` quits the app"*.** On darwin `window-all-closed` deliberately does
not quit, so a `close()` that also called `app.quit()` would be a behaviour change no test in `ci`
can see — `quit:check` measures SIGTERM and the menu's own path, and nothing measures what the
window's own control does to the process. ⚠️ **The probe is what measures it**, and it asserted the
WRONG thing on its first run — it expected the process to end — which is how that sentence came to be
measured rather than assumed.

## ⚑ The one row whose absence is a finding

⛔ **Nothing counts the window controls' CONSUMERS.** `WindowControls.vue` is mounted in exactly one
place, and a second bar somewhere else drawing its own three dots would break nothing:
`one-title-bar.test.ts` §4 asserts the OLD markup is absent from `RuntimeScreen.vue` and from nowhere
else. ⚠️ Closing it needs a census over every component for the `traffic-lights` shape; named here so
that one file's negative is not read as the tree's.
"""

MAIN = "apps/desktop/src/main/index.ts"
CONTROLS = "apps/desktop/src/renderer/src/components/WindowControls.vue"
BEHAVIOUR = "apps/desktop/src/main/window-controls.ts"
SCREEN = "apps/desktop/src/renderer/src/components/RuntimeScreen.vue"
RAIL = "apps/desktop/src/renderer/src/components/SideRail.vue"
TOKENS = "apps/desktop/src/renderer/src/assets/tokens.css"
TOGGLE = "apps/desktop/src/renderer/src/composables/usePersistentToggle.ts"

MUTATIONS = [
    # ── 1 · a frame that comes back, or a control that is a picture again ──────────────────────
    (
        "M1 · 🔴 the OS frame comes back · one word, and the app draws two title bars again — which "
        "is the state four rounds of design review could not see, because every screenshot was a CDP "
        "capture of the web contents",
        [(MAIN, "    frame: false,\n", "    frame: true,\n")],
    ),
    (
        "M2 · ⛔ the bar goes back to 42px · the shell below it becomes 798 and the 1200 × 808 `381` "
        "measured v2.3 assuming is gone — the number that only lands because our bar REPLACED the OS "
        "one rather than sitting under it · killed by `one-title-bar.test.ts`",
        [
            (
                TOKENS,
                # ⚑ **W4.205 · re-anchored in place, not retired** — W4.205 · 2ca719c5 stripped the comment; value unchanged. Killed by one-title-bar.test.ts §1 (840 − bar = 808).
                "  --titlebar-h: 32px;",
                "  --titlebar-h: 42px;",
            )
        ],
    ),
    (
        "M3 · 🔴 the controls drive *the* window instead of the sender's · passes every test that "
        "exercises the handler through an injected owner, and moves the wrong window the day this app "
        "opens two",
        [
            (
                MAIN,
                "  registerWindowControls(ipcMain, (event) => BrowserWindow.fromWebContents(event.sender))",
                "  registerWindowControls(ipcMain, () => BrowserWindow.getAllWindows()[0] ?? null)",
            )
        ],
    ),
    (
        "M4 · 🔴 zoom stops being able to leave full screen · with no frame there is no OS control to "
        "leave with, so a window entered from the View menu would have no way out but the keyboard",
        [
            (
                BEHAVIOUR,
                "      if (window.isFullScreen()) {\n"
                "        window.setFullScreen(false)\n"
                "        return 'left-full-screen'\n"
                "      }\n",
                "",
            )
        ],
    ),
    (
        "M5 · ⚠️ a destroyed window is touched instead of answered · every method on one throws, and "
        "the commonest way to be here is a person pressing close twice",
        [(BEHAVIOUR, "  if (window.isDestroyed()) return 'gone'\n", "")],
    ),
    (
        "M6 · ⛔ an unknown verb does the nearest thing · a control that did something plausible with "
        "what it was handed hides a preload that has drifted for exactly as long as nobody presses "
        "the button",
        [
            (
                BEHAVIOUR,
                "    if (!isWindowControl(control)) {\n"
                "      throw new Error(\n"
                "        `${WINDOW_CONTROL_CHANNEL}: ${JSON.stringify(control)} is not one of ` +\n"
                "          `${WINDOW_CONTROLS.join(', ')}.`,\n"
                "      )\n"
                "    }\n",
                "    if (!isWindowControl(control)) control = 'close'\n",
            )
        ],
    ),
    (
        "M7 · 🔴 the buttons lose their escape from the drag region · the declaration goes away, which "
        "is exactly the state `384`'s three decorative spans were in — the region is a rectangle and a "
        "child that says nothing sits inside it, so the click never arrives",
        [(CONTROLS, "  -webkit-app-region: no-drag;\n", "")],
    ),
    (
        "M8 · ⛔ the controls lose their accessible names · three coloured dots again to anything but "
        "an eye, which is the half of `384`'s defect that survives having handlers",
        [(CONTROLS, '      :aria-label="LABEL[control]"\n', "")],
    ),
    # ── 2 · a default that is not a default ───────────────────────────────────────────────────
    (
        "M9 · ⛔ the companion goes back to shut on a fresh profile · the one boolean `384 §0` "
        "measured as the cheapest visible difference between this app and the mock",
        [
            (
                SCREEN,
                "const drawerOpen = usePersistentToggle('brobot2.drawerOpen', true)",
                "const drawerOpen = usePersistentToggle('brobot2.drawerOpen', false)",
            )
        ],
    ),
    (
        "M10 · 🔴 the default becomes an override · the toggle stops reading what is stored, so every "
        "launch reopens the drawer for the person who shut it — an app may seed a default, it never "
        "re-grants what somebody removed",
        [
            (
                TOGGLE,
                "  const stored = read(storage, key)\n  const state = ref(stored ?? initial)",
                "  const state = ref(initial)",
            )
        ],
    ),
    # ── 3 · a rhythm that only looks moved ────────────────────────────────────────────────────
    (
        "M11 · ⛔ the rail goes back to 264px · v2.3's 212 is the last of the four rhythm items "
        "`384 §0` found open, and it is the one a person sees before anything else · killed by `rail-rhythm.dom.test.ts` · killed by `conversation-chrome.test.ts`",
        [
            (
                TOKENS,
                # ⚠️ **Anchor corrected at 390 §4**, where the token moved 212 → 208 and gained a
                # ≥1400px step. The RULE is untouched — the rail going back to the pre-v2.3 264 is
                # still what `rail-rhythm.dom.test.ts` §1 is for — and the row was re-run against
                # the corrected anchor rather than inheriting a verdict it never earned.
                # ⚑ **W4.205 · re-anchored in place, not retired** — W4.205 · 2ca719c5 stripped the token's comment; the value is still 208px below the 1400px step. Killed by rail-rhythm.dom.test.ts §1 (computed --rail-w 208px).
                # ⚑ **W4.265 · re-anchored in place, not retired** — W4.265 · 89ff0e75 widened the narrow rail from 208px to 228.8px; the plant still puts the rail back to the pre-v2.3 264px below the 1400px step.
                # ⚑ **W4.275 · re-anchored in place, not retired** — W4.275 · c78ae4dc widened the narrow rail by ten percent to 251.68px; the plant still puts the rail back to 264px below the 1400px step.
                "  --rail-w: 251.68px;",
                "  --rail-w: 264px;",
            )
        ],
    ),
    (
        "M12 · ⚠️ the responsive narrowing comes back · a second `--rail-w` puts the app's own 1180px "
        "minimum back into the band where the drawer narrows, as a side effect of a media query "
        "nobody was reading · killed by `conversation-chrome.test.ts`",
                # ⚠️ **Anchor corrected at 390 §4** — the comment above `--right-w` was rewritten
                # when the rail moved to 208. Same rule, same replacement, re-run.
        # ⚑ Landing D-016a (bd70d693) · re-anchored in place, not retired — The rule holds and its
        # test still forbids it: a `--rail-w` under `@media (max-width: 1320px)` must not exist.
        # That block itself is gone, since only `--rail-w: 208px` and the `min-width: 1400px`
        # `--rail-w: 220px` remain. The plant puts a 1320px block back, inserted before the comment
        # that heads the 1400px block, so the census count of `--rail-w:` becomes 3.
        [
            # ⚑ **W4.205 · re-anchored in place, not retired** — W4.205 · 2ca719c5 replaced the comment heading the ≥1400px block; the plant inserts the 1320px block before the new comment, so `--rail-w:` occurs 3 times (`--rail-w-wide:` does not match). Killed by conversation-chrome.test.ts (count 2, and no --rail-w under max-width 1320).
            (TOKENS, "/* Existing wide-window rail geometry; responsive work is deferred. */", "@media (max-width: 1320px) {\n  :root {\n    --rail-w: 244px;\n  }\n}\n\n/* Existing wide-window rail geometry; responsive work is deferred. */"),
        ],
    ),
    (
        "M13 · ⛔ the section gap goes back to two gaps stacking · `12px 0 18px` is 30px between "
        "neighbours and 18px of dead space under the last one, which is what made the rail read as a "
        "list of boxes",
        [
            (
                RAIL,
                ".rail-section {\n  margin: var(--space-10) 0 0;\n}",
                ".rail-section {\n  margin: var(--space-6) 0 var(--space-9);\n}",
            )
        ],
    ),
    (
        "M14 · 🔴 the anchored end scrolls again · the scroller stops taking the space that is left, "
        "so it grows to its content and pushes the kill switch off the bottom — the live defect this "
        "dispatch found by taking the rhythm seriously",
        [(RAIL, ".rail-scroll {\n  min-height: 0;\n  flex: 1;", ".rail-scroll {\n  min-height: 0;\n  flex: none;")],
    ),
]
