"""344 · One scheme: dark chrome, light paper — each row is THE DEFECT, put back verbatim (131).

⚑ **What the person asked for, and it is the whole specification** (344 §0):

> *"get rid of the dark and light toggle and only keep: **light stuff for the bodies**
> (conversation, project views…), **dark stuff for the header and the left menus**."*

Half of it existed. `022` shipped a two-zone scheme behind a titlebar toggle whose own tooltip said
*"the rail, this bar and Home stay dark"*, and four surfaces took the prop that drove it. ⛔ **Two
did not, and had therefore never been drawn on paper at all** — `HomeSurface` and `ProjectWorkspace`,
the second of which the person named by hand. So this table has two halves that fail in different ways:

  * **the control and its state** — a toggle, a prop threaded four ways, and a `localStorage` key
    that outlives both. Deleting a control is easy to do and easy to do incompletely.
  * **the palette** — 45 tokens that had no light value because nothing in a light scope had ever
    painted them. ⚠️ **Every one of those fails SILENTLY**: the app renders, and a near-black chip
    sits on white paper where a person has to notice it.

## 🔴 Which gate can see each row

| rows | the defect is caught by |
|---|---|
| M1–M2, M4–M8 | `run_suite` — `apps/desktop/test/dom/surface-boundaries.dom.test.ts` (dom) |
| M3, M9, M25 | `run_suite` — `apps/desktop/test/conversation-chrome{,.render}.test.ts` |
| M10–M12 | `run_suite` — `apps/desktop/test/persistent-toggle.test.ts` |
| M13, M23–M24 | `run_suite` — `apps/desktop/test/chat-theme.test.ts` (the guards' own lists) |
| M14–M22 | `run_suite` — `apps/desktop/test/chat-theme.test.ts` |

## ⚠️ What this table deliberately does NOT contain

⛔ **No row narrows `isColour` in `chat-theme.test.ts` back to `^`-anchored.** That widening is what
found `--queued-glow` and `--shadow`, but narrowing a filter makes a test WEAKER rather than red —
it would record as a survivor by construction (`a-mutation-that-changes-nothing-reports-as-a-
survivor`, one level up). ⚑ **M17 and M18 are the observable form of the same rule**: they delete the
two light values the widening exists to demand, and both are invisible to the narrow filter. If
somebody re-narrows it, those two rows stop being red — which is the signal, in the place a row can
carry it.

⛔ **No row deletes a `data-chat-theme` carrier from an OVERLAY.** There is none to delete: the
sheets, the drawer and the palette sit outside every scope by 080's carrier rule, and a row asserting
that would be a row about nothing.

⛔ **No row makes `forgetPersistentPreference` call `removeItem` unconditionally.** The optional
call is enforced by `typecheck` — `ToggleStorage.removeItem` is declared optional so an older stub
still satisfies the interface — and at RUNTIME it sits inside a `catch` that already answers for a
storage that will not have it. So no suite can make that row red, and a row nothing can kill is a
row about nothing (`a-line-no-mutation-can-kill-is-not-carrying-its-rule`). ⚑ `M12` is the killable
half of the same guard: it deletes the `catch`, and the "storage that will not have it" test goes
red immediately.

⛔ **No row re-tints a single hue by one step.** A light value that is merely *worse* is a contrast
finding, and the contrast floors in `chat-theme.test.ts` and `library-layout.dom.test.ts` already own
it. These rows put the DARK value back, which is the defect that actually shipped in 021.
"""

HOME = "apps/desktop/src/renderer/src/components/HomeSurface.vue"
WORK = "apps/desktop/src/renderer/src/components/ProjectWorkspace.vue"
PANE = "apps/desktop/src/renderer/src/components/ConversationPane.vue"
LAUNCH = "apps/desktop/src/renderer/src/components/NewConversation.vue"
READ = "apps/desktop/src/renderer/src/components/ReadingPane.vue"
LIB = "apps/desktop/src/renderer/src/components/SessionLibrary.vue"
SCREEN = "apps/desktop/src/renderer/src/components/RuntimeScreen.vue"
TOGGLE = "apps/desktop/src/renderer/src/composables/usePersistentToggle.ts"
TOKENS = "apps/desktop/src/renderer/src/assets/tokens.css"
THEME_TEST = "apps/desktop/test/chat-theme.test.ts"
WAITINGONYOU = "apps/desktop/src/renderer/src/components/WaitingOnYou.vue"

MUTATIONS = [
    # ── §1 · the scope, on the surfaces that had never had one ───────────────────────────────────
    (
        "M1 · ⛔ THE DEFECT, verbatim · Home has no light scope, which is the state 344 found it in "
        "— `022`'s toggle said in its own tooltip that *\"the rail, this bar and Home stay dark\"*, "
        "so Home was dark even with the reading light ON",
        # ⚑ Landing D-016a (bd70d693) · re-anchored in place, not retired (a second reviewer refuted
        # its retirement) — The refutation holds. HomeSurface is deleted, but WaitingOnYou.vue:160
        # and WhileYouWereAway.vue:63 are the surviving Home bodies and each carries the attribute
        # once; no other live row removes it from a body. Expect RED in surface-boundaries `each
        # surface carries its theme boundary exactly once` ("Waiting on you, which 606 split off
        # Home", 0 carriers instead of 1) and in chat-theme.test.ts `every surface RuntimeScreen
        # renders as a BODY declares the light scope (344)` (unscoped = WaitingOnYou). Run the DOM
        # file under the dom (chromium) project.
        [
            (WAITINGONYOU, '    data-cy="waiting-on-you"\n    data-chat-theme="light"\n', '    data-cy="waiting-on-you"\n'),
        ],
    ),
    (
        # The project workspace surface is gone. There is no pane to darken with this mutation;
        # retain the absent anchor as retired.
        "M2 · ⛔ THE DEFECT on the surface the person named by hand · *\"light stuff for the bodies "
        "(conversation, **project views**…)\"* — the project workspace goes back to dark only",
        # ⚑ **Re-anchored by 452, and it is now TWO edits rather than one.** That surface grew a
        # second root: a real project draws its own room and a fixture id draws the old one, and
        # each carries its own `data-chat-theme`. A single anchor matched both, which is a stale
        # row rather than a wider one — and dropping either edit would leave the defect half made,
        # with one of the two rooms still on paper. Verified RED alone after the correction.
        [
            (
                WORK,
                '    :data-project-slug="realProject.slug"\n    data-chat-theme="light"\n',
                '    :data-project-slug="realProject.slug"\n',
            ),
            (
                WORK,
                '    data-room="fixture"\n    data-chat-theme="light"\n',
                '    data-room="fixture"\n',
            ),
        ],
    ),
    (
        "M3 · ⚠️ the conversation is dark again · the value the prop used to supply on a fresh "
        "install, hardcoded — the scheme becomes the one 344 replaced, with no control to leave it",
        [(
            PANE,
            '<section class="conversation-pane" data-cy="conversation-pane" data-chat-theme="light">',
            '<section class="conversation-pane" data-cy="conversation-pane" data-chat-theme="dark">',
        )],
    ),
    (
        "M4 · ⚠️ the launcher is dark again — and it is what a fresh install opens on, so this is "
        "the first screen anybody sees disagreeing with every other body surface",
        [(
            LAUNCH,
            'data-cy="new-conversation-surface" data-chat-theme="light"',
            'data-cy="new-conversation-surface" data-chat-theme="dark"',
        )],
    ),
    (
        "M5 · ⚠️ the session library is dark again (`091`'s surface, in the other direction)",
        [(
            LIB,
            'data-cy="session-library" data-chat-theme="light"',
            'data-cy="session-library" data-chat-theme="dark"',
        )],
    ),
    (
        "M6 · ⚠️ a recording being read is dark again",
        [(READ, '    data-chat-theme="light"', '    data-chat-theme="dark"')],
    ),
    (
        "M7 · 🔴 **`091`'s defect, on Home** · the scope is declared and the surface paints no page "
        "of its own, so it composites onto `--app-bg` — the dark app frame — and the whole ramp "
        "flips to paper INK on near-black with nothing else changing at all",
        # ⚑ Landing D-016a (bd70d693) · re-anchored in place, not retired (a second reviewer refuted
        # its retirement) — The refutation holds. The 384 §1.3 ground block moved intact to
        # `.waiting-surface` (WaitingOnYou.vue:265-267, and the twin at
        # WhileYouWereAway.vue:112-114), and the light scope itself paints no background
        # (tokens.css:585-600). Without it the root composites onto the opaque dark body in both
        # themes, so the DOM file goes RED in `the flip reproduces what Waiting on you… actually
        # ships` ("paints the same colour in both themes"), `nothing inside these surfaces is left
        # behind`, and the boundary-move test's 'not clean to begin with' check. Run under the dom
        # (chromium) project; the three-line anchor counts once in each of the two files.
        [
            # ⚑ **Re-anchored in place, not retired** — NOT VERIFIED. The row guards Home's own page, which keeps its ink off the dark window behind it; the ground is now painted as longhands that fall back to the same paper and wash, and the plant still removes it and the re-declared colour.
            (WAITINGONYOU, '  background-color: var(--conversation-bg-color, var(--chat-bg));\n  background-image: var(--conversation-bg-image, var(--paper-wash));\n  background-position: var(--conversation-bg-position, 0% 0%);\n  background-repeat: var(--conversation-bg-repeat, repeat);\n  background-size: var(--conversation-bg-size, auto);\n  image-rendering: var(--conversation-bg-rendering, auto);\n  color: var(--text);\n', ''),
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-016a, bd70d693):** `ProjectWorkspace.vue` no longer
        # exists (D-016a: 'project rooms/board/sheet/picker' go), so the 'same on the project
        # workspace' plant has no file to edit. Its anchor is left stale, so the census records it
        # retired.
        "M8 · 🔴 the same on the project workspace · one line, and the surface the person named becomes "
        "the exact failure `SessionLibrary` shipped between 047 and 091",
        [(WORK, "  background: var(--chat-bg);\n  /* ⚑ **384 §1.3** — the ground, not a fill. `--chat-bg` stays a COLOUR (`chat-theme.test.ts`\n     resolves it as the page for every contrast pair); the wash is the image on top of it. */\n  background-image: var(--paper-wash);\n  color: var(--text);\n", "")],
    ),
    # ── §2 · the retired control, and the state that outlives a control ──────────────────────────
    (
        "M9 · ⛔ the retired key is never forgotten · nothing reads `brobot2.chatLightTheme` any "
        "more, so it cannot pin a body dark — it is simply a live value on every machine that used "
        "the toggle, under a name this app has stopped meaning anything by",
        [(SCREEN, "forgetPersistentPreference('brobot2.chatLightTheme')\n", "")],
    ),
    (
        "M10 · ⛔ `forgetPersistentPreference` does nothing at all · the call site is intact and "
        "reads as a fix, which is worse than not having one",
        [
            (
                TOGGLE,
                "  try {\n    storage?.removeItem?.(key)\n  } catch {",
                "  try {\n    if (key) return\n    storage?.removeItem?.(key)\n  } catch {",
            )
        ],
    ),
    (
        "M11 · 🔴 it forgets the WRONG preference · `debugMode` and `drawerOpen` live one key away, "
        "and a machine that never touched the reading light loses the eye instead",
        [(TOGGLE, "    storage?.removeItem?.(key)", "    storage?.removeItem?.('brobot2.debugMode')")],
    ),
    (
        "M12 · ⚠️ storage that throws on access takes the render down with it · the composable's own "
        "rule since 022 is that a view preference is never the thing that breaks the screen",
        [
            (
                TOGGLE,
                "  try {\n    storage?.removeItem?.(key)\n  } catch {\n    // Storage can throw on access, not only on write.\n  }",
                "  storage?.removeItem?.(key)",
            )
        ],
    ),
    (
        "M13 · ⛔ the `<main>` census stops naming WaitingOnYou · the list that says WHICH surfaces are "
        "bodies is read off `RuntimeScreen`, and its own non-vacuity check is the only thing "
        "standing between *\"every body declares the scope\"* and *\"every body I remembered does\"*",
        # The exact roster is derived from RuntimeScreen's main body. Dropping WaitingOnYou
        # leaves a mounted body out of that roster, so the census must go red.
        [
            # ⚑ **Re-anchored in place at the Settings + Recent activity merge** — both changed the
            # body roster; the plant still drops the mounted WaitingOnYou body from the census.
            (THEME_TEST, "      'TeamWorkspace',\n      'WaitingOnYou',\n    ])", "      'TeamWorkspace',\n    ])"),
        ],
    ),
    # ── §3 · the palette, where every failure is silent ──────────────────────────────────────────
    (
        # ⛔ **RETIRED BY RULING (landing D-016a, bd70d693):** `--accent-solid` was deleted from
        # tokens.css by D-016a along with Home's Start work button that painted it (the card removed
        # projects, project rooms and the proposal cards). There is no token or surface left for a
        # plant to keep dark. Its anchor is left stale, so the census records it retired.
        "M14 · 🔴 `--accent-solid` keeps its dark value · Home's *Start work* is a SOLID fill with "
        "`--accent-ink` on it, and light already sets that ink to `#fff` — so the pale `#88c2ff` "
        "tuned to carry white on near-black becomes white on a pastel, at 1.9:1",
        [(TOKENS, "  --accent-solid: var(--accent);", "")],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-016a, bd70d693):** `--glyph-neutral-bg` was the neutral
        # project glyph's tile and is deleted from tokens.css with project cards (D-016a: 'project
        # rooms/board/sheet/picker' go). The `--wash-4` trap it guarded survives as a general rule
        # in other rows on tokens that still exist. Its anchor is left stale, so the census records
        # it retired.
        "M15 · 🔴 **the `--wash-4` trap, third occurrence** (086) · the neutral project glyph's tile "
        "is translucent WHITE in dark, so with no light value it is a tile that is not there",
        [(TOKENS, "  --glyph-neutral-bg: rgba(40, 51, 78, 0.04);\n", "")],
    ),
    (
        "M16 · 🔴 `--panel` keeps `#0d1118` · Home's attention column becomes an opaque near-black "
        "slab down the right-hand side of a paper page — 021's light, in one token · killed by `chat-theme.test.ts`",
        # ⚑ **W4.205 · re-anchored in place, not retired** — W4.205 · 2ca719c5 wrote the light scope's --panel as #ffffff; deleting it leaves :root's #1e2940 on paper. Killed by chat-theme.test.ts's stranded scan (SessionHeader and SessionPanel paint --panel; the scan is empty on HEAD).
        [(TOKENS, "  --panel: #ffffff;\n", "")],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-016a, bd70d693):** `--queued-glow` is deleted from
        # tokens.css by D-016a; it painted a project card's queued state and nothing else survives
        # that uses it. The scan-anchored-at-`^` lesson is kept by 346's other box-shadow-style rows
        # only where a token remains. Its anchor is left stale, so the census records it retired.
        "M17 · ⚠️ `--queued-glow` keeps a violet tuned for near-black · **invisible to a stranded-"
        "token scan anchored at `^`**, because the value starts with `0` — it is a box-shadow, and "
        "the widened `isColour` is the only reason this row is red at all",
        [(TOKENS, "  --queued-glow: 0 0 0 3px rgba(121, 83, 185, 0.1);\n", "")],
    ),
    (
        "M18 · 🔴 `--shadow` keeps `rgba(0, 0, 0, 0.42)` · a 42%-black halo under the floating "
        "drawer, on paper — **a defect that had been shipping inside the light conversation since "
        "080** and that 344 found rather than caused, by the same widening M17 depends on · killed by `chat-theme.test.ts`",
        # ⚑ **W4.205 · re-anchored in place, not retired** — W4.205 · 2ca719c5 made the light --shadow `var(--shadow-dialog)` (19% navy); deleting it puts back :root's `0 24px 80px rgba(0, 0, 0, 0.42)`, still the 42%-black halo. SessionDrawer paints --shadow, so chat-theme.test.ts's widened stranded scan catches it.
        # ⚑ **token plumbing · re-anchored in place, not retired** — NOT VERIFIED. The token codemod rewrote this line to read tokens; the replacement is unchanged and makes the same defect.
        [(TOKENS, "  --shadow-card: 0 1px 2px rgba(23, 26, 58, 0.06), 0 8px 24px -10px rgba(23, 26, 58, 0.18);\n  --shadow: var(--shadow-dialog);\n", "  --shadow-card: 0 1px 2px rgba(23, 26, 58, 0.06), 0 8px 24px -10px rgba(23, 26, 58, 0.18);\n")],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-016a, bd70d693):** `--auto-bg`, `--auto-border` and
        # `--auto-text` (the orange auto-approve pill on a project card) are deleted from tokens.css
        # by D-016a with the project card. The block's own comment 'No --auto here on purpose: the
        # conversation never paints it' is true again. Its anchor is left stale, so the census
        # records it retired.
        "M19 · ⚠️ the orange auto-approve pill keeps its dark ramp · the block said *\"No --auto "
        "here on purpose: the conversation never paints it\"*, which was true until a project card "
        "did — this is that comment being right again and wrong about the app",
        [
            (
                TOKENS,
                "  --auto-bg: rgba(170, 96, 38, 0.09);\n  --auto-border: rgba(170, 96, 38, 0.3);\n  --auto-text: #9e5923;\n",
                "",
            )
        ],
    ),
    (
        # ⛔ **RETIRED (Recent activity, in "Show Recent activity and what finished since you were last here"):** the digest tokens and the DigestCard entry are deleted with the card.
        "M20 · 🔴 the two cards keep their near-black gradient · a project card and the digest strip "
        "become dark islands on paper. ⚠️ **This row SURVIVED its first per-row pass** against "
        "`surface-boundaries`: that walk's criterion is *the same colour in both ramps*, and a card "
        "painted near-black over paper is a different near-black from the one over the app frame — "
        "so it is not a scoping failure at all, it is a LEGIBILITY one, and the contrast pair "
        "`--text` on `--card-bg` is what actually holds it",
        # ⚑ Landing D-016a (bd70d693) · re-anchored in place, not retired — Half the row survives:
        # the project card is gone (`--card-bg` deleted) but the digest strip, now the top of
        # `WhileYouWereAway`, still paints `--digest-bg`, and `['--digest-text','--digest-bg']` is
        # still in PAIRS at 4.5:1. Re-anchor on the digest's light value: a near-black gradient
        # differing from the dark value (so the 'did not actually change' guard does not fire first)
        # drops paper ink `#3a4252` to about 1.5:1; correct the label from 'the two cards' to 'the
        # digest strip'.
        [
            (TOKENS, '  --digest-bg: linear-gradient(180deg, #fff, #f7f9fe);', '  --digest-bg: linear-gradient(180deg, rgba(35, 48, 75, 0.78), rgba(30, 41, 64, 0.9));'),
        ],
    ),
    (
        "M21 · ⚠️ Home's attention column keeps its near-black scrim · a near-black over paper is not "
        "a sunken panel, it is a different page — and, like M20, it is invisible to both scoping "
        "guards and caught by `--attention-text` on `--attention-bg`",
        [
            (
                TOKENS,
                "  --attention-bg: rgba(40, 51, 78, 0.022);",
                "  --attention-bg: rgba(26, 36, 58, 0.93);",
            )
        ],
    ),
    (
        # ⚠️ **RETIRED, and an OPEN FINDING (landing D-016a, bd70d693):** the rule survives but
        # D-016a deleted the only test that pinned it, so no plant can go red until a test exists
        # again. The refutation is wrong about the killer. `['--faint','--attention-footer-bg']`
        # (chat-theme.test.ts:417) never runs at 4.5: line 447 filters it out with
        # `PAIRS.filter(([fg]) => !DESIGN_RUNS_FAINT.has(fg))`, and the 'faint ramp is no worse'
        # test hard-codes only `--faint` on `--chat-bg` and `--placeholder` on `--panel-2`. No other
        # test names `--attention-footer-bg` or paints the footer's ink, so planting `rgba(26, 36,
        # 58, 0.96)` at tokens.css:664 survives; `--attention-bg` (:663) has no pair at all either.
        # The rule is live (WaitingOnYou.vue:378 paints the footer, side-footer-bg is deleted) but
        # unguarded, so a test-side change is needed before any plant can go red (for example, hold
        # the footer ink at the dark theme's own faint ratio). Do not re-anchor on the footer as it
        # stands.
        "M22 · ⚠️ the project workspace's side footer keeps its scrim · the same shape one surface "
        "over, on the surface the person asked for by name, held by `--text` on `--side-footer-bg`",
        [
            (
                TOKENS,
                "  --side-footer-bg: rgba(40, 51, 78, 0.035);",
                "  --side-footer-bg: rgba(26, 36, 58, 0.96);",
            )
        ],
    ),
    # ── §4 · the lists the guards are worth exactly the completeness of ──────────────────────────
    (
        "M23 · ⛔ `READING_SURFACE` forgets the project workspace · `083`'s point about this list "
        "made against this list for the fourth time — a surface missing from it is a surface whose "
        "tokens are checked in NEITHER direction",
        # ⚑ Landing D-016a (bd70d693) · re-anchored in place, not retired (a second reviewer refuted
        # its retirement) — The refutation holds. READING_SURFACE lines 223-224 took over
        # HomeSurface's place, and `--attention-bg` and `--attention-footer-bg` are painted only by
        # WaitingOnYou.vue:346 and :378 (grep of apps/desktop/src) while both are overridden in the
        # light block (tokens.css:663-664). Dropping the root leaves them overridden and unpainted,
        # so `light re-themes ONLY tokens the conversation actually paints` goes RED, listing those
        # two. The two-line anchor is needed because the single line `  'WaitingOnYou',\n` also
        # matches inside the six-space census roster and counts twice.
        [
            # ⚑ **Recent activity replaced the digest card · re-anchored in place, not retired** — Recent activity replaced the old page in the list; the plant still forgets a reading surface
            (THEME_TEST, "  'WaitingOnYou',\n  'RecentActivity',\n", "  'RecentActivity',\n"),
        ],
    ),
    (
        # ⛔ **RETIRED (Recent activity, in "Show Recent activity and what finished since you were last here"):** the digest tokens and the DigestCard entry are deleted with the card.
        "M24 · ⛔ it forgets `ProjectCard`, which is a CHILD rather than a surface · the scope "
        "reaches whatever the surface renders, so a list that stops at the two roots measures the "
        "two roots and nothing else",
        # ⚑ Landing D-016a (bd70d693) · re-anchored in place, not retired (a second reviewer refuted
        # its retirement) — The refutation holds. DigestCard is a child of WhileYouWereAway and the
        # only consumer of `--digest-edge`, `--digest-bg` and `--digest-text` (DigestCard.vue:206,
        # 208, 342), all of which sit in the light block (tokens.css:670, 674, 744). With the child
        # off the list they are overridden and painted by nothing on it, so `light re-themes ONLY
        # tokens the conversation actually paints` goes RED. It plants the label's own defect: a
        # child left off a list that stops at the roots.
        [
            (THEME_TEST, "  'DigestCard',\n", ''),
        ],
    ),
    (
        "M25 · ⚠️ the pane keeps a `chatLight` prop that no longer does anything · a dead prop on a "
        "surface whose scheme is fixed is a second, silent answer to a question that now has one",
        [
            (
                PANE,
                "  /** Whether lifecycle notices are shown inline in the conversation (079 §3). */",
                "  chatLight?: boolean\n"
                "  /** Whether lifecycle notices are shown inline in the conversation (079 §3). */",
            )
        ],
    ),
]
