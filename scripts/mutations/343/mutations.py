"""343 · An agent that is blocked is not idle — the third answer, and the two lies it replaces.

⛔ **`337` §7, named and not fixed.** `agent_zephyr_review` is `ready` and `blocked` — *"Cannot
compare: the branch is missing"* — and `dispatchRoute` read the LIFECYCLE and never the CONDITION,
so the gate answered **Idle · starts now** over an agent that cannot take work at all. `337` widened
that question's reach from four attention rows to every ready document's drawer, which is what turns
a latent wrong answer into one a person meets.

⚠️ **The easy repair is the trap, and half these rows are about it.** Folding `blocked` into the
busy branch renders *"Busy · queues"* — and queueing promises the work starts once the target is
free. A blocked target does not become free by waiting; the branch is missing and somebody has to go
and make it. ⚑ **So the sheet needed a third answer, and the reference has only two.**

## ⚑ What each row is defending

| rows | the defect |
|---|---|
| `M1`-`M4` | ⛔ **the answer itself** — the 337 defect restored, and the queue-shaped lie that would replace it |
| `M5`-`M8` | 🔴 **the reason** — the target's own words, and the shorter true sentence where it has none |
| `M9`-`M13`, `M19` | ⚠️ **the sentences around it** — a click that is promised, a document that is said to move |
| `M14`-`M16`, `M20` | ⛔ **the control and the colour** — disabled, visible, drawn as dead as it is, and red rather than amber |
| `M17`-`M18` | ⚑ **the reach** — the binding and the seeded document without which none of this is meetable |

## 🔴 Which gate can see each row

⚑ **Measured, one row at a time, from a quiet tree.** Every gate named below is the file that
actually went red when that row was applied alone — twice, and the second time after a review pass
had changed one of the tests.

| rows | caught by |
|---|---|
| `M1`, `M3`-`M6`, `M9`, `M10`, `M12`, `M13`, `M18` | the unit files **and** `test/dom/dispatch-route.dom.test.ts` |
| `M2`, `M7`, `M8`, `M17`, `M19` | `test/dispatch-route.test.ts` / `test/overlays.render.test.ts` — ⚠️ **and not the dom file** |
| `M11`, `M14`-`M16`, `M20` | ⚑ **only the dom file** — a heading, a `:disabled`, and three colours |

🔴 **`M20` SURVIVED its first verification pass, and the reason is worth more than the row.** Its
guard compared the blocked target card with the QUEUED one, and deleting `.dispatch-target.blocked`
does not make that card amber — it makes it the IDLE card's blue, which a one-sided control cannot
see. The chip is the mirror case: its unstyled state IS the queued amber, so the queued sheet is the
right control there and the idle sheet is not. ⚠️ **Nothing tells you which way a panel falls**, so
each is now held apart from both.

⚠️ **`M2`, `M3`, `M8` and `M19` are the rows the SEED cannot hold.** An agent that is `in_flight` AND
blocked, an agent whose only condition is `auto_approve`, an agent that gives no reason at all, an
agent whose reason ends in a full stop — the demo payload contains none of them, and in each case the wrong answer reads exactly like the right
one on screen. They are killed by fixtures built in a test, which is why those fixtures exist.

## ⚠️ What this table deliberately does NOT contain

⛔ **No row about `waiting_on_you` on a `ready` agent.** 343 widens the availability question on
`blocked` ALONE and leaves every other condition to the lifecycle, exactly as `337` left it. There
is no rule here to break.
"""

ROUTE = "apps/desktop/src/renderer/src/lib/dispatch-route.ts"
MODAL = "apps/desktop/src/renderer/src/components/DispatchModal.vue"
SCREEN = "apps/desktop/src/renderer/src/components/RuntimeScreen.vue"
SEED = "scripts/demo-seed-payload.mjs"

MUTATIONS = [
    # ── the answer itself ──────────────────────────────────────────────────────────────────────
    (
        # ⛔ **RETIRED BY RULING (landing D-016a, bd70d693):** bd70d693 deleted dispatch-route.ts
        # (109 lines), DispatchModal.vue, and dispatch-route.test.ts and dispatch-route.dom.test.ts
        # with them. Nothing in today's tree answers idle, queued or blocked for a document handed
        # to an agent, so there is no code to plant the missing condition check in. The surface was
        # a fixture-driven Slice 2 document-dispatch preview (entities.ts, the demo seed, the drawer
        # and the project workspace), which the commit removed along with the project and proposal
        # fixtures. Its anchor is left stale, so the census records it retired.
        "M1 · ⛔ THE FINDING, verbatim · the condition is not consulted at all and a `ready · "
        "blocked` agent is offered as **Idle · starts now** again — which is exactly the state "
        "`337` §7 measured and declined to fix, over a route it had just built",
        [
            (
                ROUTE,
                "  if (target.state.condition === 'blocked') return 'blocked'\n",
                "",
            )
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-016a, bd70d693):** The subject, dispatch-route.ts and its
        # ordering of blocked before busy, was deleted in bd70d693 (count_now -1). The dispatch
        # overlay and its `Availability` type are gone from overlay-store.ts, and both killers
        # (dispatch-route.test.ts and dispatch-route.dom.test.ts) were deleted. No other function
        # ranks a document-dispatch target's condition against its lifecycle. Its anchor is left
        # stale, so the census records it retired.
        "M2 · ⛔ blocked is ranked BELOW busy · an agent that is mid-run AND blocked answers "
        "`queued`, so the sheet promises a start once the run in front finishes — and that run is "
        "the one that is not going to finish; `AgentRow` and `ConversationPane` both rank the "
        "condition first, and this is the row that holds this function to their order",
        [
            (
                ROUTE,
                """  if (target.state.condition === 'blocked') return 'blocked'
  // Busy targets queue rather than start — the same rule the modal explains.
  const busy = target.state.lifecycle === 'in_flight' || target.state.lifecycle === 'queued'
  return busy ? 'queued' : 'idle'""",
                """  // Busy targets queue rather than start — the same rule the modal explains.
  const busy = target.state.lifecycle === 'in_flight' || target.state.lifecycle === 'queued'
  if (busy) return 'queued'
  return target.state.condition === 'blocked' ? 'blocked' : 'idle'""",
            )
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-016a, bd70d693):** The `blocked` widening it defends was
        # in dispatch-route.ts, which bd70d693 deleted whole. `grep 'blocked' apps/desktop/src`
        # finds only task-outcome and status-projection words, not an availability answer, so
        # nothing holds this rule. Its fixtures and killers were deleted with the file. Its anchor
        # is left stale, so the census records it retired.
        "M3 · ⚠️ the widening becomes `any condition at all` · an auto-approving idle agent — the "
        "most available thing the model has, and the OPPOSITE of a refusal — is reported as unable "
        "to take work; the seed contains no such agent, so nothing on screen would ever say so",
        [
            (
                ROUTE,
                "  if (target.state.condition === 'blocked') return 'blocked'",
                "  if (target.state.condition !== 'none') return 'blocked'",
            )
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-016a, bd70d693):** The 'tempting wrong fix' (blocked
        # answered queued) was a defect of dispatch-route.ts, deleted by bd70d693 together with the
        # Busy · queues sheet. No queue-versus-blocked availability answer remains anywhere in the
        # renderer, and both killer files are gone. Its anchor is left stale, so the census records
        # it retired.
        "M4 · 🔴 THE TEMPTING WRONG FIX · `blocked` is answered `queued`, which is the repair this "
        "dispatch exists to refuse: the sheet then says **Busy · queues**, promises the work starts "
        "when the target is free, and the target is not going to become free by waiting",
        [
            (
                ROUTE,
                "  if (target.state.condition === 'blocked') return 'blocked'",
                "  if (target.state.condition === 'blocked') return 'queued'",
            )
        ],
    ),
    # ── the reason ─────────────────────────────────────────────────────────────────────────────
    (
        # ⛔ **RETIRED BY RULING (landing D-016a, bd70d693):** `blockReason` was a computed in
        # DispatchModal.vue, which bd70d693 deleted (756 lines). The reason line ('Cannot compare:
        # the branch is missing') came from the demo-seed agent's `activity`, and the seed and
        # entities fixtures were removed in the same commit ('Proposals go end to end, with the demo
        # seed, the renderer fixtures'). No surface shows a blocked target's reason today. Its
        # anchor is left stale, so the census records it retired.
        "M5 · 🔴 the sheet stops naming WHY · the reason becomes a sentence of the app's own, and "
        "*'review cannot take work right now'* is a sentence a person can do nothing with; "
        "*'Cannot compare: the branch is missing'* names the thing they have to go and fix",
        [
            (
                MODAL,
                "const blockReason = computed(() => props.target.activity?.trim() || null)",
                "const blockReason = computed(() => 'it cannot take work right now')",
            )
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-016a, bd70d693):** The branch-name note was a card line
        # in DispatchModal.vue, deleted by bd70d693, and it read the demo seed's `note` field. The
        # `ProjectWorkspace` surface the label compares it to was deleted too, per the card's
        # 'project rooms, board, sheet'. Nothing today renders this note. Its anchor is left stale,
        # so the census records it retired.
        "M6 · ⚠️ the longer half is dropped · the card loses the branch name — *'migration/"
        "client-v2 does not exist locally or on origin'* — which is the only line on the sheet that "
        "says what is actually missing, and `ProjectWorkspace` draws the same field for the same "
        "condition in the same sentence",
        [
            (
                MODAL,
                "  return note && note !== blockReason.value ? note : null",
                "  return null",
            )
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-016a, bd70d693):** The note-versus-activity distinctness
        # check lived in DispatchModal.vue, which bd70d693 deleted. The seed fixtures it guarded
        # (`note`, `activity`) are removed with the demo seed and entities.ts, so the
        # duplicate-bullet defect cannot occur in the code. Its anchor is left stale, so the census
        # records it retired.
        "M7 · ⛔ the distinctness check goes · a seed whose `note` merely repeats its `activity` "
        "renders the same fact as two bullets, which reads as two separate problems — and nothing "
        "in the payload today can produce it, so only a fixture can see this",
        [
            (
                MODAL,
                "  return note && note !== blockReason.value ? note : null",
                "  return note",
            )
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-016a, bd70d693):** The no-reason fallback ('is blocked,
        # and has not said what on') was a sentence in DispatchModal.vue, deleted by bd70d693. No
        # component builds a blocked-target sentence from a nullable `activity` any more. Its anchor
        # is left stale, so the census records it retired.
        "M8 · ⚠️ a target that gives NO reason gets a sentence with a hole in it · `activity` is "
        "nullable and the seed's is not null, so the fallback is exercised by nothing on screen; "
        "without it the card says *'review is blocked — null.'*",
        [
            (
                MODAL,
                """      blockReason.value
        ? `${props.target.name} is blocked — ${sentence(blockReason.value)}`
        : `${props.target.name} is blocked, and has not said what on.`,""",
                """      `${props.target.name} is blocked — ${sentence(String(blockReason.value))}`,""",
            )
        ],
    ),
    # ── the sentences around it ────────────────────────────────────────────────────────────────
    (
        # ⛔ **RETIRED BY RULING (landing D-016a, bd70d693):** The availability chip ('Blocked ·
        # cannot start', 'Idle · starts now') was part of DispatchModal.vue, deleted whole by
        # bd70d693. `grep 'starts now' apps/desktop/src` finds nothing that draws it, so no chip
        # vocabulary is left to fall back. Its anchor is left stale, so the census records it
        # retired.
        "M9 · ⛔ the availability chip falls back to the two-answer vocabulary · the target card "
        "says **Idle · starts now** over a blocked agent while every sentence beside it says the "
        "opposite — the chip is the one thing on this sheet read at a glance",
        [
            (
                MODAL,
                "  if (blocked.value) return 'Blocked · cannot start'\n",
                "",
            )
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-016a, bd70d693):** The blocked header subtitle ('… so
        # this dispatch can neither start nor queue') was in DispatchModal.vue, which bd70d693
        # deleted. The `dispatch` member of the Overlay union was removed from overlay-store.ts in
        # the same commit. No sheet carries this sentence today. Its anchor is left stale, so the
        # census records it retired.
        "M10 · ⚠️ the header's second line stops carrying the reason · the subtitle becomes the "
        "queued one, so the sheet's most-read sentence describes a wait that is not happening",
        [
            (
                MODAL,
                """    const why = blockReason.value ? ` — ${clause(blockReason.value)} —` : ','
    return `${props.target.name} is blocked${why} so this dispatch can neither start nor queue.`""",
                """    return `Target ${props.target.name} is still occupied, so this dispatch becomes queued work.`""",
            )
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-016a, bd70d693):** `willHeading` ('Nothing can be
        # dispatched yet' / 'This click will') was in DispatchModal.vue, deleted by bd70d693. The
        # 'This click will' card was the dispatch preview's, and that preview no longer exists. Its
        # anchor is left stale, so the census records it retired.
        "M11 · ⛔ the card promises a CLICK on a sheet whose control cannot be clicked · *'This "
        "click will'* over a disabled primary is the same lie in a smaller place, and the heading "
        "is the half of that card a reader takes the bullets' tense from",
        [
            (
                MODAL,
                """const willHeading = computed(() =>
  blocked.value ? 'Nothing can be dispatched yet' : 'This click will',
)""",
                "const willHeading = computed(() => 'This click will')",
            )
        ],
        ),
    (
        # ⛔ **RETIRED BY RULING (landing D-016a, bd70d693):** The sentence 'Nothing is queued, so
        # nothing starts on its own when the block clears' was in DispatchModal.vue's won't-happen
        # list, deleted by bd70d693 with the whole sheet. The rule was about a document dispatch
        # that nothing in the runtime performs, since the sheet was a preview (the toast says
        # 'dispatch isn't wired in Slice 2'). Its anchor is left stale, so the census records it
        # retired.
        "M12 · 🔴 the sheet stops saying that NOTHING was queued · a gate that refuses reads as a "
        "gate that will act later, so a person who is not told this will come back expecting the "
        "work to have started when the block cleared — and nothing queued it",
        [
            (
                MODAL,
                """      // ⚠️ **The sentence a person will otherwise assume the opposite of.** A gate that refuses
      // reads as a gate that will act later; nothing here queued anything, so clearing the block
      // does not start this — somebody has to come back and dispatch it.
      `${props.document.number} stays ready. Nothing is queued, so nothing starts on its own ` +
        `when the block clears.`,
""",
                "",
            )
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-016a, bd70d693):** The refusal line 'a blocked target
        # does not become free by waiting' was in DispatchModal.vue, deleted by bd70d693. There is
        # no will-not list or dispatch sheet left in the renderer. Its anchor is left stale, so the
        # census records it retired.
        "M13 · ⛔ the refusal that names the tempting wrong fix is dropped · *'a blocked target "
        "does not become free by waiting'* is the one sentence on the sheet that refutes queueing "
        "in the reader's own words, and the will-not list is where a person looks for what they "
        "are safe from",
        [
            (
                MODAL,
                """      // ⛔ **The refusal that names the tempting wrong fix.** Folding `blocked` into the busy branch
      // would have rendered "Busy · queues", and this is the sentence that would then be false.
      `Queue ${props.document.number} behind the block — a blocked target does not become free ` +
        `by waiting.`,""",
                """      'Dispatch any other document.',""",
            )
        ],
    ),
    # ── the control ────────────────────────────────────────────────────────────────────────────
    (
        # ⛔ **RETIRED BY RULING (landing D-016a, bd70d693):** The disabled primary button was in
        # DispatchModal.vue, deleted by bd70d693. Its preview toast is the only remaining trace, as
        # a stale comment in overlays.render.test.ts, and nothing fires it. Its anchor is left
        # stale, so the census records it retired.
        "M14 · 🔴 the primary stops being disabled · pressing it fires the preview toast, so a "
        "control the sheet has just spent four sentences explaining cannot act DOES act — and the "
        "toast it fires says the dispatch was not made, which is true for the wrong reason",
        [
            (
                MODAL,
                '        :disabled="blocked"\n',
                "",
            )
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-016a, bd70d693):** `.primary-button:disabled` was a style
        # block of DispatchModal.vue, deleted by bd70d693. The dispatch dom tests that photographed
        # it (dispatch-route.dom.test.ts, dispatch-sheet-fits.dom.test.ts) were deleted as well. Its
        # anchor is left stale, so the census records it retired.
        "M15 · ⚠️ the disabled control is drawn as the LIVE primary · a shut button in the accent "
        "fill is `106`'s dead control with extra steps, and a screenshot of it looks entirely "
        "right — the same way `337`'s unstyled `.primary-button` did",
        [
            (
                MODAL,
                """.primary-button:disabled {
  border-color: var(--line-strong);
  background: var(--wash-2);
  box-shadow: none;
  color: var(--faint);
  cursor: not-allowed;
}""",
                "",
            )
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-016a, bd70d693):** `.dispatch-starts.blocked` was a chip
        # style in DispatchModal.vue, deleted by bd70d693. The AgentRow and ProjectWorkspace
        # surfaces the label points at as comparisons were deleted too (AgentRow.vue -239,
        # ProjectWorkspace.vue -2735). Its anchor is left stale, so the census records it retired.
        "M16 · ⛔ the availability chip loses its own colour and wears the queued amber · amber is "
        "this product's *'not now'*, which is the exact reading these sentences exist to refuse; "
        "`AgentRow`'s dot and `ProjectWorkspace`'s banner both draw this condition in `--danger`",
        [
            (
                MODAL,
                """.dispatch-starts.blocked {
  border-color: var(--danger-pill-border);
  background: var(--danger-bg);
  color: var(--danger-text);
}""",
                "",
            )
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-016a, bd70d693):** `clause()` was a helper in
        # DispatchModal.vue, deleted by bd70d693. It only trimmed the trailing stop of the blocked
        # header, and that header is gone. Its anchor is left stale, so the census records it
        # retired.
        "M19 · ⚠️ the reason keeps its own full stop where the header wants a clause · `activity` "
        "is prose nobody in this repo writes, and the seed's carry no stop — but the header reads "
        "*'…the branch is missing. — so this dispatch'* the moment one does, which is a shape only "
        "a fixture can produce today",
        [
            (
                MODAL,
                "function clause(text: string): string {\n  return text.replace(/\\.$/, '')\n}",
                "function clause(text: string): string {\n  return text\n}",
            )
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-016a, bd70d693):** `.dispatch-target.blocked` was a card
        # style in DispatchModal.vue, deleted by bd70d693. The dom test that held the colour
        # (dispatch-route.dom.test.ts) was deleted with it. Its anchor is left stale, so the census
        # records it retired.
        "M20 · ⛔ the target card keeps the queued AMBER · amber is this product's *'not now'*, "
        "which is the exact reading every sentence on this sheet exists to refuse — and a "
        "screenshot of the wrong colour looks entirely plausible, the way `337`'s unstyled "
        "`.primary-button` did",
        [
            (
                MODAL,
                """.dispatch-target.blocked {
  border-color: var(--danger-pill-border);
  background: var(--danger-bg);
}""",
                "",
            )
        ],
    ),
    # ── the reach ──────────────────────────────────────────────────────────────────────────────
    (
        # ⛔ **RETIRED BY RULING (landing D-016a, bd70d693):** RuntimeScreen.vue exists, but bd70d693
        # removed both the `import DispatchModal` and the `<DispatchModal
        # :availability="overlays.overlay.value.availability">` mount, so the anchor count is 0 for
        # that reason. The dispatch overlay kind and `Availability` were dropped from
        # overlay-store.ts in the same commit, so there is no binding left to defend. Its anchor is
        # left stale, so the census records it retired.
        "M17 · ⛔ the screen stops handing the modal its availability · the ONE binding that "
        "carries every answer above into the shipped app, and nothing in this repository mounts "
        "`RuntimeScreen` — so losing it is neither a type error nor a component-level failure",
        [
            (
                SCREEN,
                '        :availability="overlays.overlay.value.availability"',
                '        :availability="\'idle\'"',
            )
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-016a, bd70d693):** scripts/demo-seed-payload.mjs was
        # deleted (850 lines), along with seed-demo.mjs, demo-seed.ts and demo-seed.test.ts. The
        # commit message says 'Proposals go end to end, with the demo seed', so there is no seeded
        # `022` document to make queued. The row's whole point, that the seed can reach the blocked
        # answer, has no seed left. Its anchor is left stale, so the census records it retired.
        "M18 · 🔴 nothing in the seed reaches the blocked answer any more · `022` becomes queued "
        "and the review agent has no dispatchable document again, which is the state `337` §7 "
        "found: a wrong answer that is true of the code and producible by nothing — the precise "
        "shape that let `337`'s own `M5` survive its first verification pass",
        [
            (
                SEED,
                "    state: { lifecycle: 'ready', condition: 'none', outcome: 'none' },\n"
                "    runtime: null,\n"
                "    filename: '022-review-re-run-the-client-comparison-prompt.md',",
                "    state: { lifecycle: 'queued', condition: 'none', outcome: 'none' },\n"
                "    runtime: null,\n"
                "    filename: '022-review-re-run-the-client-comparison-prompt.md',",
            )
        ],
    ),
]
