"""551 · The strip that says where in the chain you are.

⛔ **`547` drew the relationship and put it behind a drawer that is SHUT by default**, and
`HO-050` §1.2 is the ruling that says that is not enough: *"a person reading a transcript who has to
leave it to find out what the agent was told has lost the thread."* ⚑ Every row below breaks a rule
the STRIP carries, and every one of them is killed in a real engine — the claims are geometry, ink
and a press, and none of them is a string a node runner could read back.

## 🔴 A · the strip says something that is not so

⚠️ **The two ways to lie about a chain are to invent a hop and to drop one.** ⛔ `M4` reverses the
direction a person reads a path in, `M5` says every entry is where you are, `M6` prints the
conversation HANDLE where the agent's name goes — which is `413` §4's invented actor one noun over
— and `M7` draws an edge before the first entry, claiming something spawned the root.

## ⛔ B · the strip is drawn where it must not be, or not drawn where it must

⚑ **`551` §3.3 is the whole of this group.** `M1` is the shipped defect put back — nothing above the
transcript at all. ⛔ `M2` draws a fixed bar on every top-level conversation, which is `086` in the
other direction: a permanent claim charging the transcript 37.31 px to report the ordinary case.
⚠️ `M3` drops `CastReading`'s own guard, so a read still in flight for the conversation a person
just left is drawn above the words of the one they are now reading.

## ⚠️ C · the press, and the two navigation states this app has no verb for

⛔ **`118` · a control is ABSENT where nothing would make it work.** `M8` offers a press for every
state including the two `543`'s read cannot decide (`106`, `547` F2), `M9` makes *where you are*
into a control that takes you where you already are, `M11` offers one with no screen above to act on
it, and `M20` throws away what THIS window holds — the only fact that separates *open in this
window* from *open in another*. ⚑ `M10` presses correctly and names the wrong conversation.

## 🔴 D · the entrance, which is a door and not a roster

⚠️ **v2.8 §05: counts appear only when the list AND its completeness flag are supplied.** `M12`
re-derives the count from the rows that came back and `M13` prints *0 spawned* over a read that
could not look — `452` §5.1's forbidden sentence, as a number. ⛔ `M14` opens a tab that does not
hold the band and `M15` toggles the drawer instead of setting it, which shuts it for somebody who
already had it open (`318` §2.3).

## ⛔ E · the bound, which is the reason this component is in the clipped-text ledger

🔴 **An identity's display name is user-authored and unbounded** (551 §4.3). `M18` lets the row wrap
again — v2.8's own `flex-wrap: wrap` — so a 342-character name becomes transcript height. ⚑ `M19`
removes the shrink weighting, and the parent's typed name then ellipsizes *this* conversation's own
name by 9.08 px. ⚠️ `M16` and `M17` take away what a person can still recover: the state word an
entry carries and the `title` that holds the whole of a cut name.

## ⚠️ What this table does NOT cover

 1. **`543`'s read.** Nothing here touches main; the one ancestor is the read's bound and `551`'s
    response records it as a finding rather than repairing it.
 2. **`547`'s band.** Its own table owns it. `M8` mutates the press derivation this dispatch hoisted
    into `working-together.ts`, which both surfaces now ask — a row either of them may kill.
"""

FOLD = "apps/desktop/src/renderer/src/lib/spawn-path.ts"
STRIP = "apps/desktop/src/renderer/src/components/SpawnPath.vue"
PANE = "apps/desktop/src/renderer/src/components/ConversationPane.vue"
BAND = "apps/desktop/src/renderer/src/lib/working-together.ts"
SESSIONPANEL = "apps/desktop/src/renderer/src/components/SessionPanel.vue"

MUTATIONS = [
    # ---- B · drawn, or not drawn ---------------------------------------------------------------
    (
        # The Spawn path strip and its suite are gone. Parent and graph surfaces now carry the
        # relationship and have their own mutations; retain this absent strip anchor as retired.
        "M1 · 🔴 **the shipped defect, put back** · the pane mounts nothing above the transcript, "
        "which is `main` at `59df1670`. ⛔ The relationship is then reachable only by opening a "
        "drawer that is shut by default — `HO-050` §1.2's lost thread",
        # ⚑ Landing ui f1fa1e2e…70aaa954 (the card panel and the Vue Flow forest) · re-anchored in
        # place, not retired — The rule and the subject survive: the pane still mounts the strip
        # above the transcript, and 70aaa954 only reflowed `<SpawnPath v-if="spawnPath" ...
        # @band="showTheBand" />` onto several lines (the `@band` handler now does `inspect(null)`
        # first). The anchor is reduced to `v-if="spawnPath"`, which occurs once and is identical in
        # 70aaa954's multi-line form and the original one-line form UI-006 will bring back, so it
        # should not go dark again. The plant is the label's defect: nothing drawn above the
        # transcript. Killed by `the-strip-that-says-where-you-are.dom.test.ts`.
        [
            (PANE, 'v-if="spawnPath"', 'v-if="false"'),
        ],
    ),
    (
        "M2 · ⛔ **a fixed bar on a conversation nobody spawned** · the strip is drawn with no "
        "ancestor to name, so every top-level conversation pays 37.31 px for a row that says only "
        "where it already is. ⚠️ `086` in the other direction (551 §3.3)",
        # ⚑ Landing D-027, the ui stretch to 3ef68f7f and D-038 · re-anchored in place, not retired
        # — The Spawn path strip went on purpose (fe00a6a5, 'the ↑ and the Graph say it'), but the
        # rule it carried, that a conversation nobody spawned draws no 'where you came from'
        # element, holds on the ↑ row that replaced it (`v-if="parent"`). The plant hands the row a
        # parent on every conversation. A second agent refuted the retirement. Killed by
        # `the-first-picture-of-who-called-whom.dom.test.ts`,
        # `the-main-panel-shows-the-conversation-or-its-graph.dom.test.ts`.
        [
            (SESSIONPANEL, 'const parent = computed(() => parentCardOf(castInput.value))', "const parent = computed(() => parentCardOf(castInput.value) ?? ({ conversation: '', name: '', facets: {} } as never))"),
        ],
    ),
    (
        "M3 · ⚠️ **another conversation's ancestor, above these words** · the reading's own subject "
        "is taken from the reading instead of from the surface, so `CastReading`'s guard can never "
        "fire and a read still in flight is drawn over the conversation a person moved to",
        # ⚑ Landing D-027, the ui stretch to 3ef68f7f and D-038 · re-anchored in place, not retired
        # — The strip's `forConversation` input went with it (fe00a6a5), but the defect, another
        # conversation's ancestor drawn over these words because a late read is not checked against
        # the surface, is still makeable on the ↑ row: `parentCardOf`'s own copy of the guard, which
        # no row planted (547 M12 names the view's copy). A second agent refuted the retirement.
        # Killed by `the-main-panel-shows-the-conversation-or-its-graph.dom.test.ts`.
        [
            (BAND, '  const reading = input.reading\n  if (reading === null || reading.conversation !== input.forConversation) return null\n', '  const reading = input.reading\n  if (reading === null) return null\n'),
        ],
    ),
    # ---- A · the strip says something that is not so --------------------------------------------
    (
        # ⛔ **RETIRED BY RULING (landing D-027, the ui stretch to 3ef68f7f and D-038):** The path
        # the row reversed (`spawnPathOf`'s entries in lib/spawn-path.ts) was deleted on purpose by
        # fe00a6a5 ('the Spawn path strip goes — the ↑ and the Graph say it'); there is no strip
        # left to draw a path backwards. Dark shape: file-gone. Its anchor is left stale, so the
        # census records it retired.
        "M4 · 🔴 **the path runs backwards** · this conversation first and its ancestor last, so "
        "the arrow between them now claims that this conversation spawned the one that spawned it",
        [
            (
                FOLD,
                "      { conversation: here.conversation, name: here.name, here: true, press: null, says: null },\n    ],",
                "      { conversation: here.conversation, name: here.name, here: true, press: null, says: null },\n    ].reverse(),",
            )
        ],
    ),
    (
        # The ancestor aria-current entries lived in the deleted spawn-path module. Keep this
        # file-gone anchor recorded as retired; the parent link and graph carry the relationship
        # instead.
        "M5 · ⛔ **every entry is where you are** · `aria-current=\"page\"` on all of them, and the "
        "one question the strip exists to answer has two answers",
        [(FOLD, "        here: false,", "        here: true,")],
    ),
    (
        "M6 · 🔴 **the handle where the name goes** · `sess_9f1c…` drawn as an agent, which is "
        "`413` §4's invented actor with the arrow reversed — and `agentName` is the app's one "
        "naming function precisely so no surface has to choose",
        # ⚑ Landing D-027, the ui stretch to 3ef68f7f and D-038 · re-anchored in place, not retired
        # — The strip's `name: card.name` went with it (fe00a6a5), but the rule, the agent's name
        # from the app's one naming function and never the conversation's handle, holds on the ↑
        # row's name. The plant draws the handle. A second agent refuted the retirement. Killed by
        # `the-first-picture-of-who-called-whom.dom.test.ts`,
        # `the-main-panel-shows-the-conversation-or-its-graph.dom.test.ts`.
        [
            (SESSIONPANEL, '<span class="came-name" :title="parent.name" data-cy="came-from-name">{{\n          parent.name\n        }}</span>', '<span class="came-name" :title="parent.name" data-cy="came-from-name">{{\n          parent.conversation\n        }}</span>'),
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-027, the ui stretch to 3ef68f7f and D-038):** The arrow
        # before the first entry was SpawnPath.vue markup (`<span v-if="i > 0" class="arrow"`);
        # fe00a6a5 deletes SpawnPath.vue and lib/spawn-path.ts ('Out: SpawnPath.vue,
        # lib/spawn-path.ts, the pane's strip…'). Nothing draws an edge between path entries any
        # more. Dark shape: file-gone. Its anchor is left stale, so the census records it retired.
        "M7 · ⚠️ **an edge before the first entry** · an arrow with `spawned` on it in front of the "
        "oldest conversation the strip can name, asserting a spawn the read never reported",
        [
            (
                STRIP,
                '<span v-if="i > 0" class="arrow"',
                '<span v-if="i >= 0" class="arrow"',
            )
        ],
    ),
    # ---- C · the press ---------------------------------------------------------------------------
    (
        # ⛔ **RETIRED BY RULING (landing D-017b, 3af91dcb):** The row's defect is that the press
        # narrowing collapses to *open* for every state, which is now the decision. Commit 3af91dcb:
        # "one press, 'Open the conversation'", and the-strip-that-says-where-you-are.dom.test.ts
        # asserts 'every ancestor is pressed with the one press, whatever it is doing' for both
        # not-running and in-a-window. `pressableAs` is now `canOpen && card.elsewhere !== null ?
        # 'open' : null`, its only caller (spawn-path.ts) passes parent cards built by `cardOf`,
        # whose `elsewhere` is never null, and no test builds a null-elsewhere card for it, so
        # `return canOpen ? 'open' : null` is an equivalent mutant with no killer. Its anchor is
        # left stale, so the census records it retired.
        "M8 · ⛔ **a press for a state this app has no verb for** · the narrowing both surfaces now "
        "ask collapses to *open*, so a recording whose gesture `543`'s read cannot decide (`547` "
        "F2) and a conversation in another window (`106`) both get a control that cannot act",
        [
            (
                BAND,
                "  return canOpen && card.hereIs !== null ? CAST_PRESS[card.hereIs] : null",
                "  return canOpen ? 'open' : null",
            )
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-027, the ui stretch to 3ef68f7f and D-038):** 'Where you
        # are becomes a control' was an entry in the strip's fold (`press: null` on the `here` entry
        # in lib/spawn-path.ts), deleted by fe00a6a5 along with `pressableAs` and `CastPress`. The ↑
        # row is only for the parent and is never 'here'. Dark shape: file-gone. Its anchor is left
        # stale, so the census records it retired.
        "M9 · ⛔ **where you are becomes a control** · a press that takes a person to the "
        "conversation they are already reading — `118`'s dead control, on the one entry that is a "
        "statement rather than a verb",
        [
            (
                FOLD,
                "      { conversation: here.conversation, name: here.name, here: true, press: null, says: null },",
                "      { conversation: here.conversation, name: here.name, here: true, press: 'open', says: null },",
            )
        ],
    ),
    (
        "M10 · ⚑ **the press names the wrong conversation** · the door is asked for the conversation "
        "a person is already in rather than for the one they pressed, so *get back up* stands still",
        # ⚑ Landing D-027, the ui stretch to 3ef68f7f and D-038 · the anchor still applies, but its killer,
        # `the-strip-that-says-where-you-are.dom.test.ts`, went with the Spawn path strip (fe00a6a5). Run
        # alone at this landing against `the-main-panel-shows-the-conversation-or-its-graph.dom.test.ts`: RED.
        [
            (
                PANE,
                "  cast.goTo.value?.(conversation)",
                "  cast.goTo.value?.(props.record.sessionId)",
            )
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-027, the ui stretch to 3ef68f7f and D-038):** The
        # `cast.goTo.value !== null` argument was the strip's `canOpen` input in ConversationPane's
        # `spawnPath` computed, removed by fe00a6a5 ('the pane's strip … and the band's
        # `pressableAs`'). The pane now calls `cast.goTo.value?.(conversation)` only from
        # `goToConversation`, which no longer takes a canOpen flag; the task-list and band presses
        # have their own guard rows. Dark shape: anchor-absent. Its anchor is left stale, so the
        # census records it retired.
        "M11 · ⛔ **a press with no screen above it** · `118` again, from the other side: a pane "
        "mounted by a render test, or a transcript being READ rather than watched, has no door — "
        "and the strip offers one anyway",
        [(PANE, "    cast.goTo.value !== null,", "    true,")],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-027, the ui stretch to 3ef68f7f and D-038):** `held: new
        # Set(props.held ?? [])` was the strip's input in ConversationPane's `spawnPath` computed,
        # removed by fe00a6a5. The ↑ row opens through the one door whatever the parent's state (it
        # draws no 'open in another window' word), and the same held-versus-elsewhere fold at
        # `cardOf` is already pinned by 547 M7. Dark shape: anchor-absent. Its anchor is left stale,
        # so the census records it retired.
        "M20 · ⚠️ **what THIS window holds is thrown away** · `hereIsOf` can no longer tell *open "
        "in this window* from *nobody is watching it*, so the strip offers to TAKE OVER a "
        "conversation this window already has open",
        [(PANE, "      held: new Set(props.held ?? []),", "      held: new Set(),")],
    ),
    # ---- D · the entrance -------------------------------------------------------------------------
    (
        # ⛔ **RETIRED BY RULING (landing D-027, the ui stretch to 3ef68f7f and D-038):** The count
        # `spawned: view.childList.count` was the strip's entrance field in lib/spawn-path.ts,
        # deleted by fe00a6a5 (the strip, its 'spawned' count and `THE_BAND` entrance are all out).
        # Dark shape: file-gone. Its anchor is left stale, so the census records it retired.
        "M12 · 🔴 **the count is re-derived from the rows that came back** · v2.8 §05's four "
        "conditions are skipped, so a walk that refused rows still reports a total",
        [(FOLD, "    spawned: view.childList.count,", "    spawned: view.children.length,")],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-027, the ui stretch to 3ef68f7f and D-038):** The '0
        # spawned' versus `THE_BAND` choice was in SpawnPath.vue's entrance control; fe00a6a5
        # deletes that component and `THE_BAND` itself from working-together.ts ('the band's
        # `pressableAs`, `CastPress` and `THE_BAND`'). The forbidden-sentence rule for the band is
        # still carried by 547's rows. Dark shape: file-gone. Its anchor is left stale, so the
        # census records it retired.
        "M13 · ⛔ **0 spawned, out of a read that could not look** · `452` §5.1's forbidden "
        "sentence written as a number, on the one control a person presses to find out more",
        [
            (
                STRIP,
                "  props.path.spawned === null ? THE_BAND : `${props.path.spawned} spawned`,",
                "  props.path.spawned === null ? '0 spawned' : `${props.path.spawned} spawned`,",
            )
        ],
    ),
    (
        "M14 · ⚠️ **the entrance opens a tab that does not hold the band** · a press that promises "
        "a surface and delivers another is `483`'s step that passed either way, as a control",
        # ⚑ Landing D-027, the ui stretch to 3ef68f7f and D-038 · the anchor still applies, but its killer,
        # `the-strip-that-says-where-you-are.dom.test.ts`, went with the Spawn path strip (fe00a6a5). Run
        # alone at this landing against `the-main-panel-shows-the-conversation-or-its-graph.dom.test.ts`: RED.
        [
            (
                PANE,
                "  emit('update:drawerTab', TAB_OF_THE_BAND)",
                "  emit('update:drawerTab', 'events')",
            )
        ],
    ),
    (
        "M15 · ⛔ **the drawer is TOGGLED rather than opened** · `318` §2.3: *a flip here would "
        "shut the drawer for anyone who already had it open* — so the one press that exists to "
        "show something hides it instead",
        # ⚑ Landing D-027, the ui stretch to 3ef68f7f and D-038 · the anchor still applies, but its killer,
        # `the-strip-that-says-where-you-are.dom.test.ts`, went with the Spawn path strip (fe00a6a5). Run
        # alone at this landing against `the-main-panel-shows-the-conversation-or-its-graph.dom.test.ts`: RED.
        [
            (
                PANE,
                "  if (!props.drawerOpen) emit('toggleDrawer')",
                "  emit('toggleDrawer')",
            )
        ],
    ),
    # ---- E · the bound ----------------------------------------------------------------------------
    (
        # ⛔ **RETIRED BY RULING (landing D-027, the ui stretch to 3ef68f7f and D-038):** `says:
        # card.says` on each strip entry (lib/spawn-path.ts) went when fe00a6a5 removed the strip.
        # The state-word-on-a-chip rule now belongs to UI-004's chips and cards, which the frontend
        # rows later in 2006. Dark shape: file-gone. Its anchor is left stale, so the census records
        # it retired.
        "M16 · ⚠️ **an entry stops saying what it is** · 551 §3.2 — an entry for a conversation "
        "this app is not running says what it is and offers no press; without the word it is a "
        "name a person cannot act on and cannot explain",
        [(FOLD, "        says: card.says,", "        says: null,")],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-027, the ui stretch to 3ef68f7f and D-038):** The title
        # `${step.name} — ${step.says}` was SpawnPath.vue's entry title; the component is deleted by
        # fe00a6a5 ('the Spawn path strip goes'). Dark shape: file-gone. Its anchor is left stale,
        # so the census records it retired.
        "M17 · ⛔ **the title stops carrying the name** · a cut entry is then a sentence a person "
        "cannot get to, which is the difference `531` draws between a layout decision and a loss",
        [
            (
                STRIP,
                "  step.says === null ? step.name : `${step.name} — ${step.says}`",
                "  step.says === null ? '' : `${step.says}`",
            )
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-027, the ui stretch to 3ef68f7f and D-038):** `flex-wrap:
        # nowrap` was in SpawnPath.vue's style, deleted by fe00a6a5; the 551 clipped-text-ledger
        # entry for it also went (the diff drops 6 lines from
        # every-assertion-that-reads-clipped-text.test.ts). Dark shape: file-gone. Its anchor is
        # left stale, so the census records it retired.
        "M18 · 🔴 **the row wraps again** · v2.8's own `flex-wrap: wrap`, which is safe above a "
        "fixture and not above a transcript: a 342-character display name a person typed becomes "
        "rows of transcript height",
        [(STRIP, "  flex-wrap: nowrap;", "  flex-wrap: wrap;")],
    ),
    (
        # The shrink weighting belonged to the deleted SpawnPath style. Keep this file-gone anchor
        # recorded as retired rather than moving it to another surface.
        "M19 · ⛔ **the path stops giving way first** · flex shrinks in proportion to `basis × "
        "shrink`, so without the weighting a name typed on the PARENT ellipsizes the answer to "
        "*which conversation am I reading* — measured at 9.08 px",
        [(STRIP, "  flex-shrink: 100;", "  flex-shrink: 1;")],
    ),
]
