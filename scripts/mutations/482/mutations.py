"""482 · the cards, and a move nobody can reach — HO-030 §2 and §2.1.

⛔ **Two criteria in one table, and the PO put them together deliberately.**

 1. **Criterion 20 on the two surfaces a person actually answers on.** ⚠️ `478` F3:
    *"`PermissionCard` says it in one word (Cancel turn), and `UserInputCard`'s Approve says
    nothing at all."* ⚑ The queue has drawn `whatThisAnswerDoes` under every button since `434`;
    the cards drew the word and stopped. ⛔ The PO's reason is habit rather than coverage —
    *"an inconsistent explanation is worse than a uniformly absent one, because it trains the
    reader out of looking"* — so §1 and §2 below are one row per control that could fall silent.
 2. **Criterion 15: a move the rails honour and no surface draws.** ⛔ `478` F4's card offered
    `['allow','deny']` while both adapters exempt `deny` and `cancel` from the offered-set gate.
    ⚑ §4 is the floor itself and the one producer that now reads it.

🔴 **Every row is one press a person could make, or one rule that decides what that press says.**

⚠️ **What this table deliberately does NOT contain.**

 - ⛔ **No row on the Claude adapter's `isAlwaysHonoured` call.** Every card `claudeDecisionsFor`
   builds already contains both refusals, so `isSafeNegative = false` there changes no reachable
   answer and the row would report a survivor it was never possible to kill
   (`a-line-no-mutation-can-kill-is-not-carrying-its-rule`). ⚑ It is a finding in `482`'s
   response — a correct guard with nothing behind it — not a row here.
 - ⛔ **No row on `ANSWER_SENDS_THE_FORM`'s wording.** The tests read the constant, so moving it
   moves both sides (`a-bound-written-as-the-constant-cannot-pin-it`). ⚠️ `M12` reaches the same
   rule from the half that IS pinned: which branch is allowed to use it.
 - ⛔ **No row on the agent-tool refusal TEXT** (*"the person using this app declined…"*). That is
   `348` M22's anchor, and correcting somebody else's anchor to add a row of my own would leave
   their recorded verdict attached to bytes it never earned
   (`a-corrected-anchor-keeps-a-verdict-it-never-earned`).
 - ⛔ **No row on the two cards' `flex-direction: column`.** It is a layout consequence of the
   sentence, not a rule: a row that put the buttons back would be killed only by the dom file's
   font-size ordering, which is about the SENTENCE and would then be measuring the wrong thing.

🔴 **487 moved two of these rows, and neither was retired.** `483`'s repair 1 made the floor one
derivation — `publishedOffer` — instead of four call sites that happened to agree, so:

 - ⛔ **`M14`'s anchor was CORRECTED IN PLACE.** The agent-tool card now reads
   `availableDecisions: publishedOffer(['allow'])`; the defect it restores is unchanged, a
   two-move offer. ⚠️ **The RED recorded for this row was measured against the OLD text**
   (`availableDecisions: ['allow', ...ALWAYS_HONOURED]`), and re-running the row is the only
   thing that makes its verdict current — `CENSUS.md`'s per-file digests are what make that
   checkable.
 - ⛔ **`M13`'s second clause was overturned, and its anchor was not touched.** It said narrowing
   the floor *"tells the gap census that the gap it exists to watch has closed"* — true of `482`'s
   census, which computed `ALWAYS_HONOURED.filter(…)` and would have moved with the constant.
   ⚑ **487 replaced that census with exact published offers**, precisely because a filter cannot
   survive its own repair (`a-comparison-tested-where-both-sides-agree`). The kill is now
   STRONGER, and the row's label says what it is rather than what it was.

⛔ **Evidence this table is honest about what it can reach.** Every row was applied alone, its own
killer file run, and the tree restored from bytes and hashed — the whole table has NOT been run
under the driver, so `CENSUS.md` records it `unrun` and no verdict is claimed here.

🔴 **The gate map** — which file kills which row:

| rows | killer |
|---|---|
| M1, M2, M3, M4, M5 | `apps/desktop/test/dom/what-a-card-says-a-press-does.dom.test.ts` §1 |
| M2 | …and `apps/desktop/test/what-a-card-says-a-press-does.test.ts` §3, the source census |
| M6, M7, M8, M9 | `apps/desktop/test/dom/what-a-card-says-a-press-does.dom.test.ts` §2 |
| M10, M11, M12 | `apps/desktop/test/what-a-card-says-a-press-does.test.ts` §1 |
| M13, M14 | `packages/runtime/test/codex-runtime.test.ts`, the `482` pair and the floor census |
| M14 | ⛔ **NOT the dom file's §4, and that claim was wrong when it was written (found by 487).** That file mounts `permissionItem(AGENT_TOOL)` with its own constant and never reads the producer, so the row applied against it comes back GREEN — measured at 487, with the corrected anchor and with `codex-runtime.test.ts` red in the same run |
| M15 | `packages/runtime/test/codex-runtime.test.ts` — the `482` cancel witness and `023 P1-F`'s |
"""

CARD = "apps/desktop/src/renderer/src/components/PermissionCard.vue"
INPUT = "apps/desktop/src/renderer/src/components/UserInputCard.vue"
OFFER = "apps/desktop/src/renderer/src/lib/user-input-offer.ts"
PERMISSION = "packages/runtime/src/permission.ts"
CODEX = "packages/runtime/src/codex/codex-runtime.ts"

# ⚑ The whole element, so a row can delete the line without touching the button around it.
ROW_SENTENCE = (
    "          <small :data-cy=\"`permission-does-${outcome}`\">{{ saysOf(outcome) }}</small>\n"
)
WIDE_SENTENCE = (
    "          <small :data-cy=\"`permission-does-${wide.outcome}`\">"
    "{{ saysOf(wide.outcome) }}</small>\n"
)
CARD_AFTER = (
    '        <p v-if="offered.length > 0" class="after" data-cy="permission-after">\n'
    "          {{ WHAT_COMES_AFTER_IS_NOT_OURS }}\n"
    "        </p>\n"
)
INPUT_AFTER = (
    '        <p class="after" data-cy="user-input-after">{{ WHAT_COMES_AFTER_IS_NOT_OURS }}</p>\n'
)

MUTATIONS = [
    # ------------------------------------------------- §1 · the permission card's own five presses
    (
        "M1 · 🔴 the decision buttons go back to a word each · `Approve` beside `Deny` beside "
        "`Cancel turn`, and nothing says that one of the three stops everything the agent is "
        "doing. ⛔ This is the state `478` F3 measured, restored",
        [(CARD, ROW_SENTENCE, "")],
    ),
    (
        "M2 · ⛔ the card composes its own sentence instead of reading the one the queue reads · "
        "the word, again, wearing a `<small>`. ⚠️ Two copies of one sentence is the defect one "
        "level up (`464`/`470`), and it is the one a screenshot cannot see",
        [
            (
                CARD,
                "  return whatThisAnswerDoes({\n"
                "    kind: 'permission',\n"
                "    label: LABELS[outcome],\n"
                "    decision: permissionDecisionFor(outcome),\n"
                "  })\n",
                "  return LABELS[outcome]\n",
            )
        ],
    ),
    (
        "M3 · ⚠️ every button is told what ALLOW does · the sentence is drawn, it is quiet, it is "
        "in the right place, and it is about a different press. ⛔ A decision built here rather "
        "than from the outcome is exactly the second producer `473` was sent at",
        [
            (
                CARD,
                # ⚑ **728 · re-anchored in place, not retired** — 728 added a server's card's branch above it, which builds a second decision; the row still tells every button what Allow does
                "    label: LABELS[outcome],\n    decision: permissionDecisionFor(outcome),\n",
                "    label: LABELS[outcome],\n    decision: permissionDecisionFor('allow'),\n",
            )
        ],
    ),
    (
        "M4 · ⛔ the WIDEST button on the card says nothing · `Always allow Bash this session` is "
        "the one control whose warning describes the GRANT, so the line that describes the PRESS "
        "is the only place its immediate effect is stated",
        [(CARD, WIDE_SENTENCE, "")],
    ),
    (
        "M5 · ⚠️ the unknown is no longer admitted on this card · without "
        "`WHAT_COMES_AFTER_IS_NOT_OURS` the four sentences read as the whole of what happens, "
        "which is the one thing nobody can promise about a model (`430`, HO-024 §5.3)",
        [(CARD, CARD_AFTER, "")],
    ),
    # ------------------------------------------------------- §2 · the question card's two presses
    (
        "M6 · 🔴 Approve says nothing at all · `478` F3's other half, restored. ⛔ The word is the "
        "same on a turn-scoped sandbox grant, on entering plan mode and on leaving it, and those "
        "are three materially different consents",
        [
            (
                INPUT,
                '          <small data-cy="user-input-answer-does">{{ offer.positiveDoes }}'
                "</small>\n",
                "",
            )
        ],
    ),
    (
        "M7 · ⛔ Reject says nothing · the protocol-safe answer is the one a person reaches for "
        "when they do not understand the request, so it is the worst one to leave unexplained",
        [
            (
                INPUT,
                '          <small data-cy="user-input-reject-does">{{ offer.rejectDoes }}</small>\n',
                "",
            )
        ],
    ),
    (
        "M8 · ⚠️ the positive control is labelled with the REFUSAL's consequence · both sentences "
        "are drawn, both are real, and the one under Approve describes pressing the other button",
        [(INPUT, "{{ offer.positiveDoes }}", "{{ offer.rejectDoes }}")],
    ),
    (
        "M9 · ⛔ the question card stops admitting the unknown · the same omission as `M5`, on the "
        "surface where the answer is a form rather than one click",
        [(INPUT, INPUT_AFTER, "")],
    ),
    # ------------------------------------------------------ §3 · the one source both cards read
    (
        "M10 · 🔴 a zero-question card is told what a FORM sends · `the agent is given the answers "
        "you filled in here`, on a card with no questions and no answers. ⛔ The consent the "
        "request actually asks for — the whole of `478` — is thrown away",
        [
            (
                OFFER,
                "      positiveDoes: whatThisAnswerDoes(approve),\n",
                "      positiveDoes: ANSWER_SENDS_THE_FORM,\n",
            )
        ],
    ),
    (
        "M11 · ⚠️ Reject borrows the positive's sentence on a zero-question card · the two "
        "controls say one thing, and it is the one that is wrong about the button a person "
        "presses to say no",
        [
            (
                OFFER,
                "      positiveDoes: whatThisAnswerDoes(approve),\n"
                "      rejectDoes: whatThisAnswerDoes(REJECT),\n",
                "      positiveDoes: whatThisAnswerDoes(approve),\n"
                "      rejectDoes: whatThisAnswerDoes(approve),\n",
            )
        ],
    ),
    (
        "M12 · ⛔ a card that ASKS promises a one-click answer's effect · `the agent is given "
        "“Yes” as the answer` under a button that sends a whole multi-select form. ⚑ The row the "
        "table's docblock points at: the wording is not pinnable, but which branch may use it is",
        [
            (
                OFFER,
                # ⚑ **728 · re-anchored in place, not retired** — 728 names the SERVER on its own form's submit; the row still promises a one-click answer's effect on a card that asks
                "    positiveDoes:\n      server === undefined\n        ? ANSWER_SENDS_THE_FORM\n        : `${server.name} gets the answers you filled in here`,\n",
                "    positiveDoes: whatThisAnswerDoes(REJECT),\n",
            )
        ],
    ),
    # ------------------------------------------------- §4 · the floor, and the card that reads it
    (
        "M13 · 🔴 the adapters' floor forgets the turn-kill · `ALWAYS_HONOURED` is what both gates "
        "ask and what EVERY producer now publishes through `publishedOffer`, so narrowing it takes "
        "the button off every card in the app at once ⚑ SECOND CLAUSE CORRECTED IN PLACE BY 487",
        [
            (
                PERMISSION,
                "export const ALWAYS_HONOURED: readonly PermissionOutcome[] = ['deny', 'cancel']\n",
                "export const ALWAYS_HONOURED: readonly PermissionOutcome[] = ['deny']\n",
            )
        ],
    ),
    (
        "M14 · ⛔ the agent-tool card goes back to two moves · `478` F4 exactly: a person watching "
        "a `spawn_agent` call can refuse it and cannot stop the turn that made it, while "
        "`respondPermission` would have honoured the press the whole time "
        "⚑ ANCHOR CORRECTED IN PLACE BY 487",
        [
            (
                CODEX,
                "        availableDecisions: publishedOffer(['allow']),\n",
                "        availableDecisions: ['allow', 'deny'],\n",
            )
        ],
    ),
    (
        "M15 · ⚠️ the Codex gate stops exempting the refusals · every negative is now validated "
        "against the offered set, so a card the provider left enumerating nothing becomes one "
        "this app cannot decline at all — `023 P1-F`'s rule, and fail-closed stops being usable",
        [
            (
                CODEX,
                "    const isSafeNegative = isAlwaysHonoured(decision.outcome)\n",
                "    const isSafeNegative = false\n",
            )
        ],
    ),
]
