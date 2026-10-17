"""444 · The design track, re-measured — each row is one way a number stops saying what it means.

⛔ **This table has three subjects and they are all the same subject: a number with nothing behind
it.** `411` §6 left six ordered items; four of them had no code in them at all by the time this
dispatch measured, and what survived was three places where the app states a quantity and cannot
say where it came from.

| § | the subject | `411` §6 |
|---|---|---|
| §1 | the answer goes to the conversation that ASKED, not the one on screen | item 1 |
| §2 | the safety lane at a window under 840, where a panel really lies over it | item 2 |
| §3 | the sheet's gutter DERIVES from the lane's band instead of shadowing it | item 5 |
| §4 | the tool count says WHEN it was true | relay 1 (item 4's shape) |

## 🔴 Which gate can see each row

| rows | the defect is caught by |
|---|---|
| `M1`-`M3` | ⚑ **`apps/desktop/test/persons-queue.test.ts`** — the source census on the two doors |
| `M4`-`M6` | ⚑ **`apps/desktop/test/dom/a-stop-a-modal-cannot-cover.dom.test.ts`** §7 |
| `M7`-`M10` | ⚑ **`apps/desktop/test/dom/session-tools.dom.test.ts`** §2 |
| `M11` | ⚑ **`apps/desktop/test/conversation-chrome.test.ts`** |
| `M12`-`M21` | ⚑ **`apps/desktop/test/tool-inventory.test.ts`** |
| `M22`-`M25` | ⚑ **`apps/desktop/test/dom/session-tools.dom.test.ts`** §9/§10 |
| `M26` | ⚑ **`apps/desktop/test/the-map-before-the-move.test.ts`** |

## ⚑ `M4` is a row `390` WROTE AND COULD NOT KEEP

⛔ **`390`'s own table says so**: *"No row on the lane's `z-index`. It was written, and the number
IS load-bearing … but the two do not overlap in any real layout, so a row would have changed
nothing observable and reported as a survivor."* ⚠️ **That was true of the widths `390` could
measure.** `411` §6 item 2 asked for a case at ≤840 and `444` §item-2 built it — and below the
1000px breakpoint the workbench really does reach into the lane's band, so a panel and the lane
overlap for real and paint order is the only thing deciding the click.

🔴 **So `M4` is the same edit `390` deleted, killable now because the window is narrower.** It is
the clearest thing this dispatch has to say about what a ≤840 case buys:
`a-line-no-mutation-can-kill-is-not-carrying-its-rule`, answered two dispatches later.

## ⛔ What this table deliberately does NOT contain

⚠️ **No row on the focus trap and no row on the stop's press.** `390` has both (`M5`, `M13`) and
`444` §7 re-asks them at 460px rather than asking anything new; a second row would be the same
defect with a different viewport, which is not a second defect.

⚠️ **No row on the narrow cap's `1000px - 2 * var(--lane-clear)`.** At the shipped lane width it
evaluates to the 560px that was typed there before, and nothing pins that number — the edit would
change no byte a test can see and would report as a phantom survivor
(`a-mutation-that-changes-nothing-reports-as-a-survivor`). ⚑ What carries the continuity instead is
`M8`: move the band and the two rules must move together.

⚠️ **No row on `ATTACH is not RESUME`.** It is a finding about copy naming the right act, and the
clause that carries it — *"reloading the window does not"* — is `M19`; the underlying behaviour is
`runtime-host`'s and this dispatch changed none of it.
"""

SCREEN = "apps/desktop/src/renderer/src/components/RuntimeScreen.vue"
HOST = "apps/desktop/src/renderer/src/components/OverlayHost.vue"
TOKENS = "apps/desktop/src/renderer/src/assets/tokens.css"
SHEET = "apps/desktop/src/renderer/src/components/SessionTools.vue"
HEADER = "apps/desktop/src/renderer/src/components/SessionHeader.vue"
LIB = "apps/desktop/src/renderer/src/lib/tool-inventory.ts"
FOLD = "apps/desktop/src/renderer/src/lib/transcript.ts"
WINDOW = "apps/desktop/src/renderer/src/lib/transcript-window.ts"
MAP = "apps/desktop/src/renderer/src/lib/design-v2-map.ts"
DRAWER = "apps/desktop/src/renderer/src/lib/drawer.ts"

MUTATIONS = [
    # ── §1 · the answer goes to the conversation that asked (411 §6 item 1) ──────────────────────
    (
        "M1 · 🔴 THE DEFECT 411 ITEM 1 IS ABOUT, verbatim · the overview answers the SELECTED "
        "conversation instead of the one whose row was pressed — a permission decision sent to the "
        "wrong session, which passes every owner check while doing it because this window owns both",
        [
            (
                SCREEN,
                "    void store.respondPermission(request.sessionId, request.requestId, answer.permission)",
                "    void store.respondPermission(activeId.value ?? request.sessionId, request.requestId, answer.permission)",
            )
        ],
    ),
    (
        "M2 · ⛔ only the QUESTION arm goes wrong · one of two verbs answers the selected "
        "conversation, which is the shape a census that asserts the verbs and not their arguments "
        "cannot see at all (one-failure-is-not-the-failure-shape)",
        [
            (
                SCREEN,
                "  void store.respondUserInput(request.sessionId, request.requestId, answer.userInput)",
                "  void store.respondUserInput(activeId.value ?? request.sessionId, request.requestId, answer.userInput)",
            )
        ],
    ),
    (
        "M3 · ⚠️ the CONTROL stops being a control · the in-pane card stops answering by the "
        "selected conversation, so the census can no longer show that its search shape finds the "
        "spelling it asserts the absence of — a green census measuring nothing",
        [
            (
                SCREEN,
                "function decide(requestId: string, decision: PermissionDecision): void {\n  if (activeId.value) void store.respondPermission(activeId.value, requestId, decision)",
                "function decide(requestId: string, decision: PermissionDecision): void {\n  if (activeId.value) void store.respondPermission(requestId, requestId, decision)",
            )
        ],
    ),
    # ── §2 · the lane at a window under 840 (411 §6 item 2) ──────────────────────────────────────
    # ⛔ **M4 was WRITTEN AND REMOVED, and the measurement is the finding.** It re-applied the
    # `z-index: 2` → `auto` edit `390` deleted as a phantom survivor, on the belief that a panel
    # overlapping the lane at 460px would make it killable. ⚠️ **Applied, §7 stays GREEN (6/6) and
    # only §4 — `390`'s own PLANTED `position: absolute; z-index: 1` control at 1180 — goes red.**
    # 🔴 No panel root in this app is positioned, so `.overlay-corner`'s `position: absolute` alone
    # wins the stacking order and its `z-index` is inert against every real panel at every width.
    # ⚑ `390` was right; the id is left as a gap rather than reused.
    (
        "M5 · ⛔ the lane is pushed out of the viewport at a narrow window · present, in the trap, "
        "reachable by keyboard and off the screen — which is the half `reachable()` answers and a "
        "focus assertion does not",
        [(HOST, "  left: var(--space-5);", "  left: calc(100% + var(--space-5));")],
    ),
    (
        "M6 · ⚠️ the lane is drawn with no height at a narrow window · a zero box is not a control, "
        "and `elementFromPoint` at the centre of a zero box answers about whatever is behind it",
        [(HOST, "  flex-direction: column;\n  gap: var(--space-4);", "  flex-direction: column;\n  gap: var(--space-4);\n  max-height: 0;\n  overflow: hidden;")],
    ),
    # ── §3 · the gutter derives from the band (411 §6 item 5) ────────────────────────────────────
    (
        "M7 · 🔴 THE RULING REVERSED · the sheet clears exactly the lane's 210px, so its edge is "
        "tangent to the stop and the only thing keeping the control pressable is paint order — the "
        "state every `>=` assertion in this repository was already green in · killed by `session-tools.dom.test.ts`",
        [
            (
                TOKENS,
                # ⚑ **W4.205 · re-anchored in place, not retired** — W4.205 · 2ca719c5 folded the calc onto one line; the plant makes the sheet tangent (210). Killed by session-tools.dom.test.ts §2.
                "  --lane-clear: calc(var(--space-5) + var(--lane-w) + var(--space-5));",
                "  --lane-clear: calc(var(--space-5) + var(--lane-w));",
            )
        ],
    ),
    (
        "M8 · ⛔ the gutter stops DERIVING and becomes a literal again · the number is the same "
        "today and the two stop moving together, which is the defect 444 found rather than a "
        "number it disagreed with",
        [(SHEET, "  width: min(940px, calc(100% - 2 * var(--lane-clear)));", "  width: min(940px, calc(100% - 2 * 220px));")],
    ),
    (
        "M9 · ⛔ the lane stops reading the band token · `.overlay-corner` goes back to its own "
        "literal, so widening the band moves the sheet and leaves the control where it was — the "
        "two-literal state, one literal at a time",
        [(HOST, "  width: var(--lane-w);", "  width: 200px;")],
    ),
    (
        "M10 · ⚠️ the clearance step is taken off the ladder · 7px instead of one `--space-5`, "
        "which is a gap a screenshot cannot tell from 10 and an equality can — and NOT the same "
        "edit as `M7`, which removes the step altogether and makes the sheet tangent · killed by `session-tools.dom.test.ts`",
        [
            (
                TOKENS,
                # ⚑ **W4.205 · re-anchored in place, not retired** — W4.205 · 2ca719c5 folded the calc onto one line; same derivation (10 + 200 + 10). Killed by session-tools.dom.test.ts §2 (sheet.left − lane.right toBe 10).
                "  --lane-clear: calc(var(--space-5) + var(--lane-w) + var(--space-5));",
                "  --lane-clear: calc(var(--space-5) + var(--lane-w) + 7px);",
            )
        ],
    ),
    (
        "M11 · ⛔ the rail's wide declaration disappears · the drawer's 1440 arithmetic silently "
        "falls back to the narrow rail, and `comfortable` at all three widths hides it because "
        "both readings agree · killed by `conversation-chrome.test.ts` · killed by `rail-rhythm.dom.test.ts`",
        # ⚑ **W4.265 · re-anchored in place, not retired** — W4.265 · 89ff0e75 replaced the wide declaration's literal 220px with var(--rail-w-wide); the plant still renames the declaration away so 1440 falls back to the narrow rail. The anchor is unique in tokens.css (classes.css has its own copy on .bb-app-shell).
        [(TOKENS, "    --rail-w: var(--rail-w-wide);", "    --rail-width-unused: var(--rail-w-wide);")],
    ),
    # ── §4 · the count says when it was true (444 relay 1) ───────────────────────────────────────
    (
        "M12 · 🔴 THE DEFECT RELAY 1 IS ABOUT, verbatim · the fold throws the envelope's moment "
        "away, so `15 tools` is drawn with no instant attached and a person cannot tell a live "
        "conversation's launch set from the current one",
        [(FOLD, "        at: at ?? null,\n      }\n      return\n    }\n\n    /**", "        at: null,\n      }\n      return\n    }\n\n    /**")],
    ),
    (
        "M13 · ⛔ the fold stamps its OWN clock instead of the ledger's · a replayed row then says "
        "it was stated at the moment the window was opened, which is the one reading that makes "
        "the label worse than no label",
        [(FOLD, "        at: at ?? null,\n      }\n      return\n    }\n\n    /**", "        at: Date.now(),\n      }\n      return\n    }\n\n    /**")],
    ),
    (
        "M14 · ⛔ the moment dies at the first window release · the carry is hand-built, so a "
        "conversation long enough to roll its window loses the one fact whose whole point is that "
        "it is old",
        [(WINDOW, "      at: state.tools.at,", "      at: null,")],
    ),
    (
        "M15 · ⛔ the fold keeps the FIRST statement for ever · the relay's one instruction was "
        "not to touch latest-wins, and without it a reopened conversation shows its launch set "
        "under its launch moment — an honest-looking label on a stale count, which is worse than "
        "the bare number it replaced",
        [
            (
                FOLD,
                "      state.tools = {\n        set: {\n          naming:",
                "      if (state.tools.set !== null) return\n      state.tools = {\n        set: {\n          naming:",
            )
        ],
    ),
    (
        "M16 · ⛔ the untold arm loses the moment · a reading with no set still has a row and a "
        "stamp, and dropping it on one of two return arms is the shape a test that exercises the "
        "other arm passes over",
        [(LIB, "        'library, has nothing to report yet.',\n      at: registry.at,", "        'library, has nothing to report yet.',\n      at: null,")],
    ),
    (
        "M17 · ⛔ a reading with NO moment prints one anyway · epoch 0 formatted as a date, which "
        "is the `Time not reported` failure this file's own rule 4 forbids wearing a number",
        [
            (
                LIB,
                "  if (reading.at === null) return null\n  const when = fullTime(reading.at)\n  return when === '' ? null : `Stated ${when}`",
                "  return `Stated ${fullTime(reading.at ?? 0)}`",
            )
        ],
    ),
    (
        "M17b · ⛔ the guard checks `null` and not the FORMATTED value · `fullTime` answers the "
        "empty string for a NaN, for `undefined` and for anything past Intl's TimeClip bound, so "
        "a refused moment is drawn as the dangling fragment `Stated .` — non-null, so the surface "
        "renders it. Found reviewing this dispatch's own diff, in a real mount",
        [
            (
                LIB,
                "  const when = fullTime(reading.at)\n  return when === '' ? null : `Stated ${when}`",
                "  return `Stated ${fullTime(reading.at)}`",
            )
        ],
    ),
    (
        "M18 · ⚠️ the moment becomes a bare wall clock · a conversation launched yesterday reads "
        "`09:41` and a person reads it as this morning ⚑ TWO EDITS, and the import is one of "
        "them: `clockTime` is not imported here, so a one-line row would have thrown a "
        "ReferenceError and recorded a verdict about a missing symbol rather than about an "
        "ambiguous time",
        [
            (
                LIB,
                "import { fullTime } from './clock'",
                "import { clockTime, fullTime } from './clock'",
            ),
            (
                LIB,
                "  const when = fullTime(reading.at)",
                "  const when = clockTime(reading.at)",
            ),
        ],
    ),
    (
        "M19 · 🔴 the sentence names a remedy that does not work · dropping the clause that rules "
        "out a window reload leaves `reopen` meaning whatever a person guesses, and a reload "
        "re-ATTACHES a held session, which launches nothing and emits no inventory",
        [
            (
                LIB,
                "  'current. Reloading the window does not.'",
                "  'current.'",
            )
        ],
    ),
    (
        "M20 · ⛔ the sentence claims the provider published it · false on Codex, where `published` "
        "is hard-coded `null` for ever, and misleading on Claude, where every count a person reads "
        "is the DECLARED half",
        [
            (
                LIB,
                "  'What this conversation last stated it has, at the moment shown. Nothing re-reads it on a ' +",
                "  'What the provider published for this conversation, at the moment shown. Nothing re-reads it on a ' +",
            )
        ],
    ),
    (
        "M21 · 🔴 the false clause returns · `when it started` is untrue of every conversation "
        "opened out of the library, because `agentToolsFor` runs again at `reopenSession` — the "
        "one clause of that sentence nothing pinned until 444",
        [
            (
                LIB,
                "          'this conversation at its most recent launch; nothing here is a confirmation that the ' +",
                "          'this conversation when it started; nothing here is a confirmation that the ' +",
            )
        ],
    ),
    (
        "M22 · ⛔ the moment is drawn when there is none · the as-of line appears on a conversation "
        "nobody has been told about, which is `untold` wearing a timestamp",
        [(SHEET, '      <p v-if="asOf !== null" class="provenance as-of" data-cy="tools-as-of">', '      <p class="provenance as-of" data-cy="tools-as-of">')],
    ),
    (
        "M23 · ⛔ the register is dropped from the surface · the moment is drawn with no word "
        "saying how the app knows it, which is `438`'s whole vocabulary spent and not used",
        [
            (
                SHEET,
                '          data-cy="tools-register"\n          >{{ REGISTER_WORDS.observed.label }}</span',
                '          data-cy="tools-register"\n          >&nbsp;</span',
            )
        ],
    ),
    (
        "M24 · ⚠️ the surface forks the vocabulary · a register word spelled in the component means "
        "one thing here and another in `DigestCard`, which is the second vocabulary `439` censused "
        "against by name",
        [
            (
                SHEET,
                "  :title=\"REGISTER_WORDS.observed.title\"",
                "  :title=\"'the engine watched this happen'\"",
            )
        ],
    ),
    (
        "M25 · ⛔ the bar says how many and never of when · the badge's hover loses the moment, so "
        "the only surface a person passes on the way to the sheet is back to a bare number",
        [(HEADER, "  return asOf === null ? head : `${head} · ${asOf}`", "  return head")],
    ),
    # ── the map every other claim resolves through ───────────────────────────────────────────────
    (
        "M26 · ⛔ the design map still calls `tools.at` a hole · the artefact every v2.3 claim is "
        "resolved through would describe a gap the same commit closed "
        "(the-artefact-you-resolve-through-can-carry-the-defect)",
        [
            (
                MAP,
                "    binding: { state: 'bound', from: [ref(TOOLS, 'InventoryReading.at')] },",
                "    binding: { state: 'hole', note: '`InventoryReading` carries no time.' },",
            )
        ],
    ),
    (
        # ⚑ W4.183 re-anchor: one docked state, fluid between 360 and 560, replaced the three steps.
        "M27 · ⛔ the app's own minimum stops seating a docked drawer · 972px floats it over the "
        "transcript, which is the state `385 §3` and `390 §4` both moved the rail to get out of",
        [
            (
                DRAWER,
                "  return available >= TRANSCRIPT_MIN + DRAWER_W_MIN ? 'docked' : 'overlay'",
                "  return available >= TRANSCRIPT_MIN + DRAWER_W_MIN + 60 ? 'docked' : 'overlay'",
            )
        ],
    ),
]
