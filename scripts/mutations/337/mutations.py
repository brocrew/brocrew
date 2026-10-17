"""337 · The sheet nobody can reach — the ROUTE, and the promises the sheet makes once you are on it.

⛔ **`334` graded Slice 2 acceptance #1 BROKEN over a component that was correct.** `DispatchModal`
had implemented the busy-target queue semantics since Slice 2 and its idle half matched the
reference exactly — and no person could open the other half. Four routes to document `043` were
walked; every one ended at a drawer whose only footer action was **Close**. ⚑ **A promise nothing
can route to is not a promise the product makes**, which is the whole finding and the reason half
the rows below are about a BUTTON rather than about a sentence.

## ⚑ What each row is defending

| rows | the defect |
|---|---|
| `M1`-`M5` | ⛔ **the route** — the door back to the state `334` measured, in five different ways |
| `M6`-`M7` | ⛔ **the dead control** (`106`) — the gate offered on documents that have no dispatch |
| `M8`-`M13` | 🔴 **the queued sheet's promises** — the ones the PO ruled promises and not decoration |
| `M14`-`M16` | ⚠️ **the lookup underneath them** — a NAME that is plausible and wrong |

## 🔴 Which gate can see each row

| rows | caught by |
|---|---|
⚑ **Measured, one row at a time, not reasoned about.** Every gate below is the file that actually
went red when the row was applied alone.

| rows | caught by |
|---|---|
| `M1`-`M3`, `M6`, `M17` | `test/dom/dispatch-route.dom.test.ts` — the route CLICKED in real Chromium |
| `M4` | that file **and** `test/dispatch-route.test.ts` |
| `M5`, `M7`, `M14`-`M15`, `M18` | `test/dispatch-route.test.ts` — ⚠️ **and not the dom file** |
| `M8`, `M10`-`M13` | the dom file **and** `test/overlays.render.test.ts` |
| `M9`, `M16` | `test/overlays.render.test.ts` |

⚠️ **The first version of this map said `M1`-`M7` were all killed by the dom file, and it was
wrong.** All nine seeded documents resolve their agent, so deleting the lookup guard (`M7`) changes
nothing the dom file renders; and no `ready` document in the seed points at a `queued` agent, so half
the availability rule (`M5`) is invisible there. Both are killed by fixtures built in the unit file
instead. **A kill map is a claim about which instrument can see a defect, and a claim is worth no
more than the measurement behind it.**

⚠️ **`M14`-`M16` are the rows the seed alone could not hold.** Every one of them is about a case the
demo payload does not contain — two runs in flight on one agent, a queued document mistaken for a
running one, an agent and its run disagreeing about a freeze — and in each the wrong answer reads
exactly like the right one on screen. They are killed by fixtures built in the test, which is why
those fixtures exist.

## ⚠️ What this table deliberately does NOT contain

⛔ **No row about the footer sentence `This is real dispatch`.** The reference says it and ours must
not (§3, acceptance #7): there is no product string to mutate, and the ABSENCE is asserted directly
in `dispatch-route.dom.test.ts`. A row cannot be written for a sentence that is not there.

⛔ **No row removing `Modify source files.`** from the will-not list. The reference has no equivalent
and ours keeps it, so removing it is a smaller true list rather than a false one — a different
finding, and not this one.
"""

ROUTE = "apps/desktop/src/renderer/src/lib/dispatch-route.ts"
DRAWER = "apps/desktop/src/renderer/src/components/DocumentDrawer.vue"
MODAL = "apps/desktop/src/renderer/src/components/DispatchModal.vue"
SCREEN = "apps/desktop/src/renderer/src/components/RuntimeScreen.vue"

MUTATIONS = [
    # ── the route itself: `334`'s finding, restored five ways ─────────────────────────────────
    (
        # ⛔ **RETIRED BY RULING (landing D-016a, bd70d693):** The drawer's 'Review dispatch' footer
        # action lived in DocumentDrawer.vue, which bd70d693 deleted (470 lines) with the demo seed
        # and renderer fixtures ('Proposals go end to end, with the demo seed, the renderer
        # fixtures'). overlays.render.test.ts now says D-016 'deleted the seed-only overlays ... the
        # document drawer, the dispatch gate, the recruiting sheet and the all-documents sheet —
        # with the seed itself'. No surviving surface draws a dispatch route. Its anchor is left
        # stale, so the census records it retired.
        "M1 · ⛔ THE FINDING, verbatim · the drawer's footer loses its dispatch action and every "
        "route to 043 ends at Close again — which is the exact state `334` measured on all four of "
        "the routes it walked, over a component that was already correct",
        [
            (
                DRAWER,
                """      <button
        v-if="route"
        class="primary-button"
        type="button"
        data-cy="drawer-review-dispatch"
        @click="review"
      >
        <svg class="icon"><use href="#i-eye" /></svg>
        Review dispatch to {{ route.target.name }}
      </button>
""",
                "",
            )
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-016a, bd70d693):** The line `overlays.open({ kind:
        # 'dispatch', ... })` was in the deleted DocumentDrawer.vue, and the 'dispatch' overlay kind
        # no longer exists in overlay-store.ts (the Overlay union lost document, dispatch, recruit,
        # allDocuments, projectSettings and newProject). The dom killer
        # test/dom/dispatch-route.dom.test.ts was deleted too. Its anchor is left stale, so the
        # census records it retired.
        "M2 · ⛔ the action opens the DOCUMENT instead of the gate · the drawer that is already "
        "open reopens itself, which is a control that responds to a click and goes nowhere — the "
        "hardest version of this defect to see, because something visibly happens",
        [
            (
                DRAWER,
                "  overlays.open({ kind: 'dispatch', document: props.document, ...gate })",
                "  overlays.open({ kind: 'document', document: props.document })",
            )
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-016a, bd70d693):** The wrong-document `...gate` open was
        # in the deleted DocumentDrawer.vue (the `dispatch` overlay kind and the `documents` prop
        # are gone). Subject removed on purpose with the seed-only overlays. Its anchor is left
        # stale, so the census records it retired.
        "M3 · ⛔ the gate opens on the WRONG document · `...gate` carries the target and the queue "
        "verdict, and a sheet that shows 043's target over another document's body is a dispatch "
        "preview of something the person did not open",
        [
            (
                DRAWER,
                "  overlays.open({ kind: 'dispatch', document: props.document, ...gate })",
                "  overlays.open({ kind: 'dispatch', document: props.documents[0]!, ...gate })",
            )
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-016a, bd70d693):** `busy` was computed in
        # lib/dispatch-route.ts, deleted in bd70d693 along with its unit test
        # (test/dispatch-route.test.ts) and dom test. The whole busy-target dispatch sheet was a
        # Slice-2 preview over the demo seed ('dispatch isn't wired in Slice 2'), and the seed,
        # lib/entities.ts and the modal are all gone. Its anchor is left stale, so the census
        # records it retired.
        "M4 · ⛔ every dispatch claims to start now · the busy test is what makes this the busy "
        "sheet at all, so a constant `false` puts a person in front of **Dispatch 043 to dev now** "
        "for an agent that is frozen on a permission and cannot take it. ⚠️ **Anchor corrected in "
        "343**, which replaced this row's `queued` boolean with a three-valued `availability` — the "
        "defect and this row's claim are unchanged, and it was re-verified RED by hand after the "
        "correction.",
        [
            (
                ROUTE,
                "  const busy = target.state.lifecycle === 'in_flight' || target.state.lifecycle === 'queued'",
                "  const busy = false",
            )
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-016a, bd70d693):** `availabilityOf` and its
        # in_flight/queued busy clause lived only in the deleted lib/dispatch-route.ts, over
        # AgentProfile fixtures from the deleted lib/entities.ts. No real-product surface asks
        # whether a document's target agent is busy, so there is no surviving rule to re-anchor. Its
        # anchor is left stale, so the census records it retired.
        "M5 · ⛔ only an in-flight target queues · an agent whose own lifecycle is already `queued` "
        "is not free either, and this is the half of the condition that is invisible in the demo "
        "seed — dev is `in_flight`, so the first clause alone looks entirely correct. ⚠️ **Anchor "
        "corrected in 343** (the boolean became `availability`); re-verified RED by hand.",
        [
            (
                ROUTE,
                "  const busy = target.state.lifecycle === 'in_flight' || target.state.lifecycle === 'queued'",
                "  const busy = target.state.lifecycle === 'in_flight'",
            )
        ],
    ),
    # ── the dead control (106) ────────────────────────────────────────────────────────────────
    (
        # ⛔ **RETIRED BY RULING (landing D-016a, bd70d693):** The `lifecycle !== 'ready'` gate was
        # in the deleted dispatchRoute() over seed Document fixtures (lib/entities.ts is deleted).
        # The dead-control defect it guarded (a 'Review dispatch' button on non-dispatchable
        # documents) has no button left to appear on. Its anchor is left stale, so the census
        # records it retired.
        "M6 · ⛔ THE DEAD CONTROL (`106`) · without the lifecycle gate every document in the drawer "
        "grows **Review dispatch** — a landed response, a run already in flight, a prompt with no "
        "response — and seven of the seed's nine offer to dispatch something that cannot be sent",
        [(ROUTE, "  if (document.state.lifecycle !== 'ready') return null", "")],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-016a, bd70d693):** The target lookup guard `if (!target)
        # return null` was in the deleted lib/dispatch-route.ts. There is no dispatch gate left that
        # needs a target to name. Its anchor is left stale, so the census records it retired.
        "M7 · ⛔ the target is not looked up · a document naming an agent this window does not have "
        "still routes, and the gate opens with no target to name — the sheet exists to show the "
        "exact target, so one that cannot is worse than no route at all",
        [(ROUTE, "  if (!target) return null", "")],
    ),
    # ── the promises the PO ruled promises (§2.2) ─────────────────────────────────────────────
    (
        # ⛔ **RETIRED BY RULING (landing D-016a, bd70d693):** 'queues behind N' was a sentence in
        # the deleted DispatchModal.vue (756 lines), a seed-only preview whose confirm was never
        # wired. bd70d693 removed the demo seed and renderer fixtures, and its killers
        # dispatch-route.dom.test.ts and the dispatch part of overlays.render.test.ts are gone. Its
        # anchor is left stale, so the census records it retired.
        "M8 · 🔴 the target card stops naming what it queues BEHIND · the PO's ruling, verbatim: "
        "*\"Naming what it queues behind is a promise, not a decoration\"* — **Busy · queues** is a "
        "wait of unknown length behind unknown work",
        [
            (
                MODAL,
                "  busyWith.value ? `queues behind ${busyWith.value.number}` : 'queues',",
                "  'queues',",
            )
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-016a, bd70d693):** 'queued behind N' movement wording was
        # in the deleted DispatchModal.vue. overlays.render.test.ts no longer renders any dispatch
        # sheet, so no test can see it. Its anchor is left stale, so the census records it retired.
        "M9 · 🔴 the movement stops naming it · *\"Move 043 from ready to queued\"* says the "
        "document ends up in a queue and not where in it, which is the one thing a person deciding "
        "whether to wait needs",
        [
            (
                MODAL,
                "  busyWith.value ? `queued behind ${busyWith.value.number}` : 'queued',",
                "  'queued',",
            )
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-016a, bd70d693):** The 'Target X is still occupied by N'
        # subtitle was in the deleted DispatchModal.vue. The whole modal went with the seed-only
        # overlays in D-016 (commit 1). Its anchor is left stale, so the census records it retired.
        "M10 · 🔴 the subtitle stops naming the occupant · **Target dev is still occupied** is the "
        "sentence the reference improves on by naming 041, and the header is where a reader looks "
        "first",
        [
            (
                MODAL,
                "    ? `Target ${props.target.name} is still occupied${\n"
                "        busyWith.value ? ` by ${busyWith.value.number}` : ''\n"
                "      }, so this dispatch becomes queued work.`",
                "    ? `Target ${props.target.name} is still occupied, so this dispatch becomes queued work.`",
            )
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-016a, bd70d693):** The 'Interrupt N, or answer the
        # permission it is frozen on' promise was a sentence in the deleted DispatchModal.vue. No
        # surviving component carries it, and grep finds no 'frozen on' or 'Review dispatch' string
        # in src. Its anchor is left stale, so the census records it retired.
        "M11 · 🔴 the permission promise is dropped · the reference promises this click will not "
        "*\"interrupt or answer 041's permission\"*; queueing behind a frozen run and answering the "
        "thing it is frozen on are exactly the two acts a person needs told apart here",
        [
            (
                MODAL,
                "      ? `Interrupt ${occupant.number}, or answer the permission it is frozen on.`",
                "      ? `Interrupt ${occupant.number}.`",
            )
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-016a, bd70d693):** The 'will not start N while X is still
        # frozen on M' promise was in the deleted DispatchModal.vue. The modal and its
        # frozenOccupant logic are gone with the seed-only overlays. Its anchor is left stale, so
        # the census records it retired.
        "M12 · 🔴 the queue-does-not-jump-the-freeze promise is dropped · the reference's *\"will "
        "not run 043 while dev is still frozen on 041\"* is the corollary of *\"let it start once "
        "dev is free\"*, and without it the will-list's promise reads as sooner than it is",
        [
            (
                MODAL,
                "    ...(frozenOccupant.value && occupant\n"
                "      ? [\n"
                "          `Start ${props.document.number} while ${props.target.name} is still frozen on ` +\n"
                "            `${occupant.number}.`,\n"
                "        ]\n"
                "      : []),\n",
                "",
            )
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-016a, bd70d693):** The 'When N eventually starts, any
        # command or file permission will freeze it here' guard sentence was in the deleted
        # DispatchModal.vue. The row's plant also just swaps two identical strings in the other
        # branch, so it has nothing left to protect. Its anchor is left stale, so the census records
        # it retired.
        "M13 · ⚠️ the guard stops saying WHEN · *\"any command or file permission will freeze the "
        "agent here\"* is true of a dispatch that starts on the click and misleading about one that "
        "does not start for another quarter of an hour",
        [
            (
                MODAL,
                "    ? `When ${props.document.number} eventually starts, any command or file permission will freeze it here.`\n"
                "    : 'Any command or file permission will freeze the agent here.'",
                "    ? 'Any command or file permission will freeze the agent here.'\n"
                "    : 'Any command or file permission will freeze the agent here.'",
            )
        ],
    ),
    # ── the lookup that decides whether a NAME is true ────────────────────────────────────────
    (
        # ⛔ **RETIRED BY RULING (landing D-016a, bd70d693):** `occupyingDocument`'s
        # exactly-one-running rule was in the deleted lib/dispatch-route.ts. Its subject (fixture
        # documents with agentProfileId and lifecycle) went with lib/entities.ts and the demo seed.
        # Its anchor is left stale, so the census records it retired.
        "M14 · ⛔ the sheet names an occupant when there are two · with more than one run in flight "
        "on the target, *\"queues behind 041\"* names whichever document happens to sort first — a "
        "sentence indistinguishable on screen from the right one, and wrong half the time",
        [(ROUTE, "  return running.length === 1 ? running[0]! : null", "  return running[0] ?? null")],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-016a, bd70d693):** The in_flight-only occupant filter was
        # in the deleted lib/dispatch-route.ts, over seed Document fixtures that no longer exist.
        # Its killer test/dispatch-route.test.ts was deleted in bd70d693. Its anchor is left stale,
        # so the census records it retired.
        "M15 · ⛔ a QUEUED document counts as occupying · a document waiting its own turn is not "
        "what the agent is busy with, so *\"still occupied by 018\"* describes a queue as if it "
        "were the work in front of it",
        [
            (
                ROUTE,
                "    (document) => document.agentProfileId === target.id && document.state.lifecycle === 'in_flight',",
                "    (document) => document.agentProfileId === target.id && document.state.lifecycle !== 'ready',",
            )
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-016a, bd70d693):** The frozen-agent-AND-run conjunction
        # lived in the deleted DispatchModal.vue, over seed agents and documents. Its killer was
        # overlays.render.test.ts's dispatch arm, which D-016 removed with the seed-only overlays.
        # Its anchor is left stale, so the census records it retired.
        "M16 · ⛔ half the freeze conjunction is enough · *\"dev is still frozen on 041\"* names an "
        "agent AND a run; with only the run's facet checked, an agent that is merely busy is "
        "described as frozen — and in the demo seed both facets agree, so this row is invisible to "
        "any test that uses the seed alone",
        [
            (
                MODAL,
                "    busyWith.value?.state.condition === 'waiting_on_you' &&\n"
                "    props.target.state.condition === 'waiting_on_you',",
                "    busyWith.value?.state.condition === 'waiting_on_you',",
            )
        ],
    ),
    # ── the two the app needs and no earlier row covered (both found in review) ────────────────
    (
        # ⛔ **RETIRED BY RULING (landing D-016a, bd70d693):** The `.primary-button` rule was in the
        # deleted DocumentDrawer.vue, so the button it styled no longer exists. Its killer
        # test/dom/dispatch-route.dom.test.ts was deleted. Its anchor is left stale, so the census
        # records it retired.
        "M17 · ⛔ the one control this dispatch adds stops being a primary · `.primary-button` is "
        "declared per component and never globally, so without the drawer's own rule Vue's scoping "
        "matches nothing and the button falls back to `base.css`'s bare `button` — legible, "
        "clickable, and not the primary action it is; a screenshot of it looked entirely plausible",
        [
            (
                DRAWER,
                """.primary-button {
  border: 1px solid var(--accent-solid);
  background: var(--accent-solid);
  box-shadow: var(--accent-solid-shadow);
  color: var(--accent-ink);
}
""",
                "",
            )
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-016a, bd70d693):** The `:documents="seed?.documents ??
        # []"` binding fed DispatchModal, which is deleted. RuntimeScreen.vue no longer imports
        # DispatchModal, DocumentDrawer or AllDocumentsSheet and has no `seed` documents (count_now
        # 0 for the anchor). The 'proposals go end to end, with the demo seed, the renderer
        # fixtures' removal took the binding's whole purpose. Its anchor is left stale, so the
        # census records it retired.
        "M18 · ⛔ the screen stops handing the modal its documents · the ONE binding that carries "
        "everything M8-M13 defend into the shipped app, and losing it is neither a type error nor a "
        "component-level failure — the sheet falls back to the sentences that say less, silently. "
        "⚠️ **Anchor corrected in 343**: the line above it is now `:availability`. Re-verified RED.",
        [
            (
                SCREEN,
                '        :availability="overlays.overlay.value.availability"\n'
                '        :documents="seed?.documents ?? []"',
                '        :availability="overlays.overlay.value.availability"',
            )
        ],
    ),
]
