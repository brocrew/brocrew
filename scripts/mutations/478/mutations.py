"""478 · two sentences a person chooses on — `476` §3.2 and §3.3, criterion 20's third item.

⛔ **Both sentences were read BEFORE the press**, which is what makes them promises rather than
observations — and `476` measured that neither described what happens.

| § | the sentence | what it left out |
|---|---|---|
| `476` §3.2 | *"the request is cancelled"* | ⛔ **both adapters interrupt the WHOLE TURN**, before they answer the request at all |
| `476` §3.3 | *"the request is approved with no answer"* | ⛔ it describes the **payload**; three materially different acts share that payload |

## 🔴 Three defects, and the third is one level past the brief

| § | what it was | rows |
|---|---|---|
| the scope | `PERMISSION_EFFECTS.cancel` said only that the request went away | `M1`, `M2` |
| the consent | one sentence over a turn-scoped sandbox grant, an agent STARTING to plan, and an agent LEAVING plan mode to start work | `M3`-`M8`, `M12` |
| the direction | ⚠️ **`476` read the two plan cards as one *"Enter/ExitPlanMode consent"***. Approving one puts this app's own read-only floor UP; approving the other takes it DOWN, after which the agent may run commands and change files | `M4`, `M5`, `M9` |

⚑ **The direction could not be said at all before this dispatch**: the neutral `user_input_request`
carried `questions`, `prompt` and — on Codex only — `permission`. `consent` is the field that makes
the sentence derivable, written by the adapter off the same `PLAN_GESTURES` entry that moves the
floor when the card is approved.

## ⛔ What this table deliberately does NOT contain

⚠️ **No row on the PROPOSAL sentences.** `476` §3.4 and §3.5 are `479`'s, in the same function and
in a different family — ⛔ a row here would be this dispatch holding an opinion about a repair
somebody else is measuring, and it would collide in `whatThisAnswerDoes`. ⚑ **`479` landed at
`dc01747` while this branch was gating, and `scripts/mutations/479/mutations.py` owns those rows**;
this table was rebased over it without touching them.

⚠️ **No row moving `questions.length === 0`.** That predicate is `214` §3's and `user-input-offer`'s
whole first docblock; `478` decides what the Approve SAYS and never whether there is one. ⛔ A row
there would be re-testing `213`'s defect under this dispatch's name, and
`user-input-offer.test.ts` already owns it.

⚠️ **No row on `WHAT_COMES_AFTER_IS_NOT_OURS`.** It is `434`'s sentence and `430`'s ruling,
unchanged here, and `persons-queue.test.ts` §9.3 already pins it.

⚠️ **No row on the LABELS.** `OUTCOME_LABEL` and the card's `LABELS` are `299` §1's deliberate
divergence — two surfaces may address a reader differently — and nothing in this dispatch touched
them.

⚠️ **No row planting a SECOND classifier.** A surface that decided *what is this consent* for itself
is the `214` §3 shape, and the way to plant it is to write a new file, which no mutation of an
existing line can do. ⛔ **That bound is stated in
`two-sentences-a-person-chooses-on.test.ts` §1 rather than papered over**: `userInputOffer` takes
the whole request precisely so no caller can hand it a mismatched pair, and `M12` is the nearest a
single-line mutation gets.

## 🔴 The gate map — which file kills which row

| rows | killer |
|---|---|
| `M1`, `M2` | ⚑ **`apps/desktop/test/two-sentences-a-person-chooses-on.test.ts`** §2 — the clauses BY NAME, beside the two adapters that perform them |
| `M3`, `M4` | ⚑ **§1's distinctness check** — four keys, four sentences, asserted as a set |
| `M5` | ⚑ **§1's per-member words** — ⛔ and NOT its distinctness check, which passes on a clean swap |
| `M6` | ⚑ **§4** — *"for this turn and no longer"* asserted against the wire's own `scope: 'turn'` |
| `M7` | ⚑ **§1's ordering case** — a request carrying BOTH fields is a grant |
| `M8` | ⚑ **§1** — the gap member, and `every-answer-through-the-persons-queue.test.ts`, which raises a consent with neither field through the real fold |
| `M9` | ⚑ **§3** — the adapter driven for both plan tools, with the floor read before and after |
| `M10` | ⚑ **`packages/runtime/test/claude-runtime.test.ts`** `394` (every Claude question stops travelling) and **§3**'s key census |
| `M11` | ⚑ **`packages/runtime/test/the-question-channel.test.ts`** — the consent keeps its own reason |
| `M12` | ⚑ **§1** and the dom file's three-row case |

🔴 **`M5` is in this table because writing it found a hole, and the hole is now closed.** The first
draft of §1 asserted only that the four sentences DIFFER — which a clean swap of the two plan
sentences satisfies exactly — and `476`'s independent oracle carries the grant's words and not the
plan pair's. ⛔ **Nothing in the repository would have failed.** §1 now writes each member's
load-bearing verb out, which is `a-comparison-tested-where-both-sides-agree` answered before it
could be measured. ⚠️ `473`'s own gate map was false in its first draft for the same family of
reason: a section that compares the subject against itself measures nothing.

⛔ **Evidence this table is honest about what it can reach.** Every row was applied alone, its own
killer file run, and the tree restored from bytes — the whole table has NOT been run under the
driver, so `CENSUS.md` records it `unrun` and no verdict is claimed here.
"""

OFFER = "apps/desktop/src/renderer/src/lib/user-input-offer.ts"
CLAUDE = "packages/runtime/src/claude/claude-runtime.ts"
CHANNEL = "packages/runtime/src/question-channel.ts"

# ⚑ **492 · M1 and M2 had their anchors corrected in place** (`142`'s rule, never retired).
# `HO-032` §1 made a person's Cancel on a Codex agent-tool card send `turn/interrupt` instead of
# latching a local bit, so the sentence's CLAIM moved from *the whole turn is interrupted* to
# *the whole turn is asked to stop* — composed from `ASKED_TO_STOP`, which `interrupt_agent` now
# shares. ⛔ **Both ROWS are unchanged and both were re-verified RED by hand.** ⚠️ The recorded
# verdict for this table was measured against the OLD text; the table is `unrun`, so nothing was
# re-blessed by the correction.
MUTATIONS = [
    # ── §1 · the scope of a Cancel ──────────────────────────────────────────────────────────────
    (
        "M1 · 🔴 THE FIRST DEFECT, restored · Cancel goes back to *the request is cancelled*, so a "
        "person choosing between Deny and Cancel is told the same thing about both — and one of "
        "them stops everything the agent is doing ⚑ ANCHOR CORRECTED IN PLACE BY 492",
        [
            (
                OFFER,
                # ⚑ **492 · anchor corrected, not retired.** `HO-032` §1 made the press a real
                # `turn/interrupt` on the one door where it was only a label, and the CLAIM moved
                # with it — *is interrupted* said the turn was over, which `interrupt_agent` refuses
                # to say on either provider. ⛔ The ROW is unchanged. Re-verified RED.
                "  cancel: `the whole turn is ${ASKED_TO_STOP}, and this request is refused`,",
                "  cancel: 'the request is cancelled',",
            )
        ],
    ),
    (
        "M2 · ⛔ half the sentence · the scope clause survives and the request's own fate is "
        "dropped, so the line promises the turn ends and says nothing about whether the command "
        "runs — the ambiguity `476` found, moved rather than closed "
        "⚑ ANCHOR CORRECTED IN PLACE BY 492",
        [
            (
                OFFER,
                # ⚑ **492 · anchor corrected, not retired**, and the REPLACEMENT with it: dropping
                # the second clause is the defect, so the half that survives is the half the
                # sentence now has. ⛔ Restoring *is interrupted* here would have made this row kill
                # `492`'s paraphrase check as well, which is a different rule than the one M2 owns.
                "  cancel: `the whole turn is ${ASKED_TO_STOP}, and this request is refused`,",
                "  cancel: `the whole turn is ${ASKED_TO_STOP}`,",
            )
        ],
    ),
    # ── §2 · what an Approve is a consent TO ────────────────────────────────────────────────────
    (
        "M3 · 🔴 THE SECOND DEFECT, restored · every consent card gets the payload sentence again, "
        "so one button covers a turn-scoped sandbox grant, an agent starting to plan and an agent "
        "leaving plan mode to run commands — which is `476` §3.3 exactly",
        [
            (
                OFFER,
                "  'access-for-this-turn': 'the access this card asks for is granted, for this turn and no longer',",
                "  'access-for-this-turn': 'the request is approved with no answer',",
            )
        ],
    ),
    (
        "M4 · ⛔ two kinds share one sentence · starting to plan is described with the words for "
        "leaving it, so a person approving *the agent wants to plan this out first* reads that the "
        "tools which change things are being let through",
        [
            (
                OFFER,
                # ⚑ **728 · re-anchored in place, not retired** — 728 (R93) rewrote both plan-card sentences with the floor gone; the row still gives starting to plan the words for leaving it
                "  'start-planning': 'the agent starts planning, in the provider’s own plan mode',",
                "  'start-planning': 'the agent stops planning, and its plan mode ends',",
            )
        ],
    ),
    (
        "M5 · ⚠️ the DIRECTION swapped, both ways at once · the press that lets an agent start "
        "running commands and writing files reads as the press that stops it, and the other way "
        "round — ⛔ **every sentence still differs from every other**, so a distinctness check over "
        "the set passes and only a per-member word does not",
        [
            (
                OFFER,
                # ⚑ **728 · re-anchored in place, not retired** — 728 (R93) rewrote both plan-card sentences with the floor gone; the row still swaps their direction
                "  'start-planning': 'the agent starts planning, in the provider’s own plan mode',\n  'stop-planning': 'the agent stops planning, and its plan mode ends',",
                "  'start-planning': 'the agent stops planning, and its plan mode ends',\n  'stop-planning': 'the agent starts planning, in the provider’s own plan mode',",
            )
        ],
    ),
    (
        "M6 · ⛔ the grant loses its bound · *for this turn and no longer* goes, so a sandbox "
        "widening the wire really scopes to one turn reads as an open-ended grant — the 007 P1-7 "
        "class, in the line that exists to disclose it",
        [
            (
                OFFER,
                "  'access-for-this-turn': 'the access this card asks for is granted, for this turn and no longer',",
                "  'access-for-this-turn': 'the access this card asks for is granted',",
            )
        ],
    ),
    (
        "M7 · 🔴 the classifier's ORDER · `consent` is asked before `permission`, so a Codex request "
        "for wider access — which carries both no questions and a grant — is reported in a plan "
        "card's words, and a sandbox widening is described as a change of mode",
        [
            (
                OFFER,
                "  if (request.permission !== undefined) return 'access-for-this-turn'\n"
                "  if (request.consent !== undefined) return request.consent",
                "  if (request.consent !== undefined) return request.consent\n"
                "  if (request.permission !== undefined) return 'access-for-this-turn'",
            )
        ],
    ),
    (
        "M8 · ⛔ the gap becomes a guess · a consent card carrying neither field — every plan card "
        "written before this dispatch, replayed by the fold — falls back to a REAL member and gets "
        "a confident sentence about a press nobody classified",
        [
            (
                OFFER,
                "  return 'a-consent-this-window-cannot-name'",
                "  return 'stop-planning'",
            )
        ],
    ),
    (
        "M12 · ⚠️ a SECOND opinion about the request · the offer builds its Approve with a constant, "
        "so the queue row and the card agree with each other and disagree with the request — the "
        "`214` §3 shape, in the decision rather than in the label",
        [
            (
                OFFER,
                # ⚑ **Anchor corrected by 482, meaning unchanged.** The decision is a named
                # `approve` const now, because `positiveDoes` is `whatThisAnswerDoes` of the
                # very object `decisions` carries — so the constant goes on the field rather
                # than in the array literal, and both surfaces still get the frozen consent.
                "      consent: consentAsked(request),",
                "      consent: 'a-consent-this-window-cannot-name',",
            )
        ],
    ),
    # ── §3 · the adapter that knows which way the floor moves ───────────────────────────────────
    (
        "M9 · 🔴 the adapter says the opposite · `planConsentOf` inverts, so `EnterPlanMode` is "
        "published as *stop-planning* and `ExitPlanMode` as *start-planning* — the sentence is "
        "correct for a card that is the other one, which no renderer test can see",
        [
            (
                CLAUDE,
                "  return { consent: gesture ? 'start-planning' : 'stop-planning' }",
                "  return { consent: gesture ? 'stop-planning' : 'start-planning' }",
            )
        ],
    ),
    (
        "M10 · ⛔ the key comes back on every card · `{ consent: undefined }` instead of `{}`, which "
        "is an own enumerable key — `askedOfTheChannel` walks `Object.keys` and every Claude "
        "question stops travelling to a parent, classified as a shape nobody taught. ⚑ This is not "
        "hypothetical: it is what this dispatch's own first draft did",
        [
            (
                CLAUDE,
                "  if (gesture === undefined) return {}",
                "  if (gesture === undefined) return { consent: undefined }",
            )
        ],
    ),
    (
        "M11 · ⚠️ the channel classifies the consent too LATE · the branch moves below the "
        "admit-list walk, so a plan card is recorded as *a shape this app has not been taught* "
        "rather than as the consent it is — `340`'s finding, about the one request whose whole "
        "nature is that there is nothing to answer",
        [
            (
                CHANNEL,
                # ⚑ **728 · re-anchored in place, not retired** — 728 put a server's own request, by name, between the consent branch and the admit-list walk; the row still takes the consent's own name away
                "  if (Object.hasOwn(asked, 'consent') && asked['consent'] !== undefined) {\n    return { travels: false, id, because: 'a-consent-with-nothing-to-answer' }\n  }\n",
                "",
            )
        ],
    ),
]
