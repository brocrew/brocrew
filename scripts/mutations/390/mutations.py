"""390 · A stop a modal cannot cover — each row is THE DEFECT, put back verbatim (131).

⛔ **The shape this dispatch arrives in.** `385 §3` anchored the global spawn stop so a long rail
could not carry it off the bottom of the screen, and that fix is real. `388` then measured the half
nothing was watching: every `OverlayHost` is a fixed `inset: 0` `aria-modal` layer with a focus trap
that **deliberately covers the rail**, so `rail-spawning` could not be clicked or tabbed to while any
modal was open, and **no test exercised that cross-layer state**. ⚑ The PM's ruling: *the emergency
stop stays reachable while a modal is open* — drawn twice, supplied once, with the modal's isolation
untouched.

## ⚑ 444 corrected `M4`'s anchor in place, and this table has no artefact to invalidate

⛔ **`M4`'s DEFECT is unchanged and so is its kill.** `444` §item-5 declared the safety lane's own
column as a root token — `--lane-w` — so `SessionTools`'s `220px` gutter could DERIVE from the
210px the lane occupies instead of shadowing it with a second literal. `.overlay-corner`'s
`width: 200px` became `width: var(--lane-w)`, which is the line `M4` anchors on; the row still
appends `pointer-events: none` to it and still makes the stop unpointable.

⚠️ **This table is `unrun`: there is no `mutations.txt` and no recorded verdict here**, so nothing
was measured against the old text. ⛔ **The corrected row was still applied ALONE and watched go
RED against its named killer file before being recorded** (444 §7).


## 🔴 The three shapes of failure

1. **The stop is not there, or it is there and cannot be reached.** Presence is not reachability:
   the defect this dispatch fixes was a control that was present, painted, and under another layer.
   ⚑ `M1`-`M6`.
2. **Two surfaces, two answers.** The rail and the lane are two views of ONE state; a second author
   of the state, of the words, or of the confirm is the state a person must never be able to
   reach. ⚑ `M7`-`M10`, `M14`, `M15`.
3. **A rail width that only looks moved.** v2.5's 208px and its ≥1400px step are two numbers a
   stylesheet can quietly put back — and the step is the first width-dependent rail this app has had
   since `385 §3` flattened the old one. ⚑ `M11`, `M12`.

`M13` is the modal's own rule, measured from the element this dispatch added.

## ⛔ Which gate can see each row

| rows | the defect is caught by |
|---|---|
| `M1` | ⚑ **`a-stop-a-modal-cannot-cover.dom.test.ts`** §2 — every path, and §4's pair |
| `M2` | ⚑ **…** §6 — the lane taking the focus a dialog opens with |
| `M3` | ⚑ **…** §6 — the panel pushed off centre by a second in-flow child |
| `M4` | ⚑ **…** §2 — present, painted, and not what the point lands on |
| `M5` | ⚑ **…** §6 — one Shift+Tab from the opening focus |
| `M6` | ⚑ **…** §2 and §5 — a control that is a picture |
| `M7` | ⚑ **…** §5 — the rail and the lane saying different things |
| `M8` | ⚑ **…** §5 — a stop drawn before anybody has answered |
| `M9` | ⚑ **`spawning-switch.dom.test.ts`** — the confirm left armed across a change from elsewhere |
| `M10` | ⚑ **…** — the confirm thrown away by a re-read that did not touch the switch |
| `M11` | ⚑ **`rail-rhythm.dom.test.ts`** §3 — the step, measured on both sides of it |
| `M12` | ⚑ **…** §3 — the wide rail that is not wide |
| `M13` | ⚑ **`a-stop-a-modal-cannot-cover.dom.test.ts`** §6 — pressing the stop dismissing the dialog |
| `M14` | ⚑ **…** §3 — the screen's commit, which nothing can mount the screen to press |
| `M15` | ⚑ **…** §3 — the screen supplying nothing at all |

## ⚠️ What this table deliberately does NOT contain

⛔ **No second row on `--rail-w: 208px` itself.** `385 M11` already puts that line back to the
pre-v2.3 264 and its anchor was CORRECTED here rather than retired, so the width token is pinned by
a row that has been re-run. A second row on the same line with a different number would measure the
same assertion twice.

⛔ **No row on either `v-if`.** Removing the `v-if` from the rail's row or from the lane leaves a
`null` dereference at render — a crash rather than a behaviour, and a crash is a verdict about the
harness. ⚑ `M8` puts the same defect on the path as a VALUE: a view that answers *"spawning is off"*
before anybody has been asked, which is the shape a person would actually meet.

⛔ **No row on the lane's `z-index`.** It was written, and the number IS load-bearing —
`AllDocumentsSheet`'s sticky table header is `z-index: 1` in this same stacking context — but the
two do not overlap in any real layout, so a row would have changed nothing observable and reported
as a survivor (`a-mutation-that-changes-nothing-reports-as-a-survivor`). ⚑ What carries it instead
is §4's planted control: an element of exactly that shape, placed over the lane's corner, which the
lane must still win.

⛔ **No row putting `tabindex="-1"` on the lane. It was written, and it SURVIVED** — measured, and
the reason is a property of the trap worth writing down: `OverlayHost`'s own `FOCUSABLE` selector
matches `button:not([disabled])`, so a `tabindex` on a `<button>` changes nothing about which
elements the trap cycles through, and `.focus()` works on a `tabindex="-1"` element anyway. ⚠️ Inside
a modal the TRAP is the tab order, so the edit changed nothing observable
(`a-mutation-that-changes-nothing-reports-as-a-survivor`). ⚑ `M5` removes the lane from the trap
instead, which is the state it would actually be in if somebody moved it.

⛔ **No row on §3's own source census.** A mutation on a census is invisible to that census
(`a-mutation-on-a-census-is-invisible-to-that-census`) — weakening the walk passes the walk. ⚑ Its
control is inside it: the walk is asserted to find FOUR hosts in `ConversationPane`, which is the
`store.create(` defect one dispatch over, and the prose stripper in §5 is asserted both ways round.

## 🔴 The row that could not be written, and it is a finding

⛔ **Nothing in `ci` can press the stop through the running screen.** `211` §11, `212` §9 and `214`
§8 each filed the same gap: nothing in this repository mounts `RuntimeScreen`. `M14` and `M15` are
aimed at a SOURCE assertion for that reason, and a source assertion cannot see a supply that runs at
the wrong time — only one that is not written. ⚠️ The live instrument that could see it is
`pnpm run probe:capabilities`, which presses `rail-spawning` in a real window and is not in `ci`.
"""

# 🔴 **`401` moved four of these anchors, and not one of them changed what its row DOES.**
#
# ⛔ **The declarations moved, so the anchors follow them.** `401` added a second card to this
# layer — the person's queue — and two cards that position themselves cannot be stopped from
# overlapping each other, so `position`, `z-index`, `left`, `bottom` and `width` now live once on
# `.overlay-corner` in `OverlayHost.vue` and the stop is a plain card inside it. ⚠️ `M1` and `M2`
# are re-anchored on the new markup, `M3` and `M4` on the column that now carries the declaration
# each of them names.
#
# ⚠️ **Each row's hash changes, so each goes back to UNRUN in the census** — which is right: none
# of them has been executed against the code as it now stands, and a corrected anchor must not
# inherit a verdict it did not earn.

HOST = "apps/desktop/src/renderer/src/components/OverlayHost.vue"
LANE = "apps/desktop/src/renderer/src/components/SpawnStopLane.vue"
SAFETY = "apps/desktop/src/renderer/src/lib/spawn-safety.ts"
SCREEN = "apps/desktop/src/renderer/src/components/RuntimeScreen.vue"
TOKENS = "apps/desktop/src/renderer/src/assets/tokens.css"

MUTATIONS = [
    # ── §1 · the stop is not there, or cannot be reached ──────────────────────────────────────
    (
        "M1 · 🔴 the overlay layer draws no stop · exactly the state 388 measured at 529649c: the "
        "rail's switch is under a fixed inset:0 aria-modal layer with a focus trap, and the one "
        "control that stops agents creating conversations cannot be clicked or tabbed to",
        # ⚑ **popups drawn in open order · re-anchored in place, not retired** — the host is drawn into the screen's overlay layer, a level deeper; the plant still draws no stop in it
        [(HOST, "        <PersonsQueue floating @leave=\"emit('close')\" />\n        <SpawnStopLane />\n", "")],
    ),
    (
        "M2 · ⛔ the stop is drawn before the panel · it becomes the first focusable inside the host, "
        "so every sheet in the app opens with the emergency stop focused instead of its own first "
        "control — the safety lane taking over the dialog it is a passenger on",
        [
            (HOST, "      <SpawnStopLane />\n", ""),
            (HOST, "    <slot />\n", "    <SpawnStopLane />\n    <slot />\n"),
        ],
    ),
    (
        "M3 · ⛔ the stop is laid out in flow · `.overlay-host` is a centring flex container, so a "
        "second in-flow child makes the panel one of two flex items and moves every sheet in the app "
        "sideways",
        [(HOST, ".overlay-corner {\n  position: absolute;", ".overlay-corner {\n  position: static;")],
    ),
    (
        "M4 · 🔴 the stop cannot be pointed at · present, painted, inside the trap, and not the "
        "element a click at its own coordinates reaches — which is 388's defect wearing the fix's "
        "clothes ⚑ ANCHOR CORRECTED IN PLACE BY 444",
        [(HOST, "  width: var(--lane-w);", "  width: var(--lane-w);\n  pointer-events: none;")],
    ),
    (
        "M5 · ⛔ the stop is drawn OUTSIDE the layer it belongs to · teleported to the body it is "
        "still on the screen and still pressable, and it is no longer in the modal's focus trap or "
        "in its light scope — reachable by mouse and not by keyboard, which is the half a person "
        "using the keyboard has no way around",
        [
            (
                HOST,
                "    <SpawnStopLane />\n",
                "    <Teleport to=\"body\"><SpawnStopLane /></Teleport>\n",
            )
        ],
    ),
    (
        "M6 · 🔴 the stop is a picture · it draws the state, it is in the trap, it is reachable, and "
        "pressing it does nothing — 009's rule on the one control where a placeholder is dangerous",
        [(LANE, '    @click="safety.press()"\n', "")],
    ),
    # ── §2 · two surfaces, two answers ────────────────────────────────────────────────────────
    (
        "M7 · 🔴 the lane composes its own heading · a literal in the second surface is exactly the "
        "state the ruling forbids: the rail says one thing and the modal's header says another, and "
        "nothing in either component can tell",
        [
            (
                LANE,
                '<strong data-cy="overlay-spawning-state">{{ safety.view.value.heading }}</strong>',
                '<strong data-cy="overlay-spawning-state">Spawning is on</strong>',
            )
        ],
    ),
    (
        "M8 · ⛔ the view answers before anybody has been asked · 086 on the one control where the "
        "wrong default is dangerous in both directions — a stop drawn OFF claims a stop that is not "
        "in force, and this is that claim, on two layers at once",
        [
            (
                SAFETY,
                "  if (identities === null) return null",
                "  if (identities === null)\n    return {\n      on: false,\n      confirming,\n      heading: 'Spawning is off',\n      line: 'No agent can create a conversation. Nothing running was stopped.',\n    }",
            )
        ],
    ),
    (
        "M9 · 🔴 the armed confirm survives a change made from elsewhere · another window throws the "
        "switch, the confirm this surface armed is still standing, and the next press is one press "
        "from a widening nobody is looking at",
        [(SAFETY, "      if (after !== before) confirming.value = false\n", "")],
    ),
    (
        "M10 · ⚠️ every re-read throws the confirm away · the identities are re-read on every "
        "conversation start (355), so a person who armed the confirm has it silently disarmed by an "
        "unrelated read, and their second press arms it again instead of turning spawning on",
        [
            (
                SAFETY,
                "      if (after !== before) confirming.value = false",
                "      confirming.value = false",
            )
        ],
    ),
    # ── §3 · the rail's two widths ────────────────────────────────────────────────────────────
    (
        "M11 · ⛔ the step is written the other way round · a `max-width` where v2.5 asks for a "
        "`min-width` widens the rail on every window BELOW 1400 and narrows it above — the same two "
        "numbers, applied to the wrong halves of the range",
        [(TOKENS, "@media (min-width: 1400px) {", "@media (max-width: 1400px) {")],
    ),
    (
        "M12 · ⚠️ the wide rail is not wide · the query is there, the breakpoint is right, and the "
        "value is the one it was supposed to differ from, so the step exists and does nothing · killed by `rail-rhythm.dom.test.ts` · killed by `conversation-chrome.test.ts`",
        # ⚑ **W4.265 · re-anchored in place, not retired** — W4.265 · 89ff0e75 made the wide declaration read the new --rail-w-wide token (242px) instead of a literal 220px; the plant still sets the wide rail to the narrow value, so the step exists and does nothing.
        [(TOKENS, "@media (min-width: 1400px) {\n  :root {\n    --rail-w: var(--rail-w-wide);", "@media (min-width: 1400px) {\n  :root {\n    --rail-w: 228.8px;")],
    ),
    # ── §4 · the modal's own rule, from the element this dispatch added ───────────────────────
    (
        "M13 · 🔴 a press anywhere on the overlay dismisses it · the stop is a child of the backdrop, "
        "so a backdrop that closes on any mousedown means pressing the emergency stop also throws "
        "away whatever the person had open",
        [
            (
                HOST,
                "  if (event.target === event.currentTarget) emit('close')",
                "  emit('close')",
            )
        ],
    ),
    # ── §5 · the hop nothing can mount the screen to press ────────────────────────────────────
    (
        "M14 · 🔴 the screen supplies a commit that writes nothing · both surfaces draw the state, "
        "both are reachable, both agree — and no press reaches `agentStore.setSpawning`, so the "
        "emergency stop is a picture in the running app and in neither component",
        [
            (
                SCREEN,
                "  safety.supply(agentStore.identities.value, (enabled) => void setSpawning(enabled))",
                "  safety.supply(agentStore.identities.value, () => {})",
            )
        ],
    ),
    (
        "M15 · ⛔ the screen supplies nothing at all · the module is never handed the store's answer, "
        "so the rail's switch and the overlay's lane are both absent for the life of the window — "
        "the read landed and nothing was told",
        [
            (
                SCREEN,
                "watchEffect(() => {\n  safety.supply(agentStore.identities.value, (enabled) => void setSpawning(enabled))\n})",
                "watchEffect(() => {\n  void agentStore.identities.value\n})",
            )
        ],
    ),
]
