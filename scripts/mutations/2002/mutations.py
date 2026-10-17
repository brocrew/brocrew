"""2002 · the landing's table for `ui` batch 2: `d1057288`, an open sub-agent's card shows the agents it spawned.

⚑ **Why `2002`**: `ui` batches are numbered `2000 + n` (see `2001`). This batch is one commit, landed by
merging `c4fd2136` (the `ui` seat's merge of `dev` right after it), which carries exactly
`d1057288`'s change and the seat's own resolution of the cherry-pick overlap.

Under the open agent's card the band draws that agent's OWN sub-agents as the strip's chips, a
picture with no press, read from the whole forest that now rides in the band's one round trip. The
seat's own tests (`the-first-picture-of-who-called-whom.dom.test.ts` §9) pin the positive, a
stranger's agent left out, and the control. The landing added the source assertion on the forest's
guard (`a-childs-state.test.ts` §3), in the pattern the round trip above it already uses.

## ⚠️ Not rowed

- The plates' `atWork` (`props.reading?.atWork ?? null` → `null`): the §9 test asserts a plate is
  drawn, not its state, so this would survive; the state is the forest view's own fold, which the
  Team page's tests hold.

## Verification

The landing agent verified each row alone with `verify_row.py`. The table has not been run.
- **RED: 4 of 4**, each on its named killer (each ran green unmutated first).
"""

WORKING_TOGETHER_VUE = "apps/desktop/src/renderer/src/components/WorkingTogether.vue"
RUNTIME_SCREEN_VUE = "apps/desktop/src/renderer/src/components/RuntimeScreen.vue"

MUTATIONS: list[tuple[str, list[tuple[str, str, str]]]] = [
    (
        # ⛔ **RETIRED BY RULING (landing ui f1fa1e2e…70aaa954):** `theirOwn`, the forest filter
        # 'under the open agent' that drew the open card's own sub-agents, was deleted with the
        # card. f1fa1e2e: 'the default-open pick and the open card's own sub-agents went with the
        # card, and their tests with them'; the first-picture test has no `their-own` assertion left
        # and `node.under.conversation === open.conversation` appears nowhere in the tree. Its
        # anchor is left stale, so the census records it retired.
        "M1 · 🔴 the card draws every OTHER agent's sub-agents · the filter asks *not under the open agent*, so the strangers, the root and the agent itself are drawn under its card — killed by `the-first-picture-of-who-called-whom.dom.test.ts`",
        [
            (WORKING_TOGETHER_VUE, "node.under.conversation === open.conversation", "node.under.conversation !== open.conversation"),
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing ui f1fa1e2e…70aaa954):** The `<template
        # v-if="theirOwn.length" #default>` guard drew the open card's *Sub agents* box and went
        # with the open card (f1fa1e2e: 'The open child's card under the Sub agents strip is gone').
        # There is no card under the strip to carry an empty heading, and no replacement anchor
        # outside deleted code. Its anchor is left stale, so the census records it retired.
        "M2 · ⛔ an agent that spawned nobody still draws a row of its own · an empty *Its sub-agents* heading under every open card — killed by `the-first-picture-of-who-called-whom.dom.test.ts`",
        [
            (WORKING_TOGETHER_VUE, '<template v-if="theirOwn.length" #default>', '<template v-if="true" #default>'),
        ],
    ),
    (
        "M3 · ⛔ its sub-agents look pressable · each is a button that does nothing, against the person's *nothing happens when clicked for now* — killed by `the-first-picture-of-who-called-whom.dom.test.ts`",
        # ⚑ Landing ui batch 3 · re-anchored in place, not retired — UI-001 (`032301e7`) draws each
        # sub-agent's plate from its rail row; the chips are still not pressable.
        # ⚑ Landing ui batch 4 (3e73c885..ac1918b1) · re-anchored in place, not retired — The rule
        # survives: the open agent's own sub-agents are still non-pressable spans, and the killer
        # still asserts `card.querySelectorAll('.their-own button')` has length 0. 74659e69 changed
        # the chip's markup (size="avatar" and a new `chip-dot` span), so the old block text matched
        # 0 times. Two small anchors now do the job, one for the opening tag and one for the closing
        # tag, each matching once, so the row no longer breaks whenever the plate's props change.
        # Planting a `<button>` leaves the earlier assertions in that test true (2 chips, names,
        # plates, side by side). The test then fails at the last line with length 2 instead of 0,
        # which is the label's reason. Killed by `the-first-picture-of-who-called-whom.dom.test.ts`.
        # ⚑ Landing ui f1fa1e2e…70aaa954 (the card panel and the Vue Flow forest) · re-anchored in
        # place, not retired — The open card's flat spans went with the card (f1fa1e2e), but
        # f1fa1e2e kept the rule on the Sub agents strip: where nothing above the drawer can open a
        # conversation, a chip is a flat span, not a button that does nothing (`:is="canOpen ?
        # 'button' : 'span'"`). The plant makes every chip a button; a second agent refuted the
        # retirement. Killed by `the-first-picture-of-who-called-whom.dom.test.ts`.
        [
            (WORKING_TOGETHER_VUE, ':is="canOpen ? \'button\' : \'span\'"', ':is="\'button\'"'),
        ],
    ),
    (
        "M4 · ⛔ a failed forest read blanks the row · `null` is written over the last good forest, so an open agent's sub-agents vanish for half a minute on any failed read — killed by `a-childs-state.test.ts`",
        [
            (RUNTIME_SCREEN_VUE, "if (mine === castRead && asked === activeId.value && grown !== null)", "if (mine === castRead && asked === activeId.value)"),
        ],
    ),
]
