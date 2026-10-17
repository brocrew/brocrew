"""615 · The decision that reaches nobody — a bound may end a CALL, never an obligation.

⛔ **The ruling is this dispatch's §2 and it is one sentence:** *"A proposal decision reaches its
proposer whether or not anybody is still waiting."*

## 🔴 What this table has to guard, and why the shape is unusually easy to get wrong

⚠️ **`609` left the defect pinned as an ASSERTION over the absence of every carrier**, so the
existence of a delivery is already measured by `three-waits-one-family.test.ts` §6 and is not what
these rows are for. ⛔ **What a census cannot see is the CONDITION in front of it.**

🔴 **There are exactly two ways to be wrong here and they are opposites:**

 - ⛔ **Never delivering** is `609`'s finding restored — a person approves an hour later, the
   project exists, and the agent that asked for it is never told (`M1`, `M2`, `M3`, `M4`).
 - ⛔ **Always delivering** is `591 M6` re-created — *the words are delivered EVEN WHEN a turn is
   still waiting, so a worker gets its answer twice* (`M5`, `M6`).

⚑ **`608` was allowed to RETIRE `591 M6`** because the question side stopped parking at all, and
*every answer is a late answer* made the branch unreachable. ⚠️ **A proposal still parks** — this
brief's §5 keeps {@link PROPOSAL_BOUND_MS} exactly where `441` put it — so the branch `608` deleted
is the one this dispatch has to keep correct, and that is what half these rows measure.

## ⚠️ B · the words, because two routes now carry one fact

⛔ **A decision reaches a model two ways since this dispatch** — the parked call's own answer and a
turn — ⚑ **and `whatTheDecisionMeans` exists so neither composes its own spelling.** `M8` takes the
proposal out of the delivered line and `M9` takes `441` §2.2's act out of the shared refusal; both
leave a sentence that is still true and no longer useful.

⚠️ **`M7` is the one that is invisible to every idle test.** ⛔ `'work'` looks right and reads right,
and criterion 13's singleton then refuses the message to a BUSY proposer — so the decision is
dropped exactly when the conversation has the most going on. ⚑ Only the held arm can see it.

## ⛔ C · the two flags, which are one word apart and mean different things

🔴 **`waiting` is the CARD and `aCallIsStillWaiting` is the CALL.** ⚠️ Before this dispatch the
field's own docblock said `waiting` was *"False once the bound has passed"* — which no writer has
ever made true, and which `609` corrected 1,240 lines lower without sweeping the declaration the
claim came from. ⛔ **`M11` puts that sentence back**, because a reader who believes it takes
`waiting` for the flag this dispatch had to add.

⚑ **`M13` lets the call's flag be raised again.** ⛔ A call that has stopped waiting cannot start
again, and the absence of a second writer is the whole of that guarantee.

## 🔴 616 · SIX of these rows are retired and FOUR had their anchors corrected

⛔ **`HO-093` §2 removed the hold this table was written around**, so every row that attacked the
promise, the flag or the guard in front of the delivery lost its subject. ⚠️ **Each was looked at
one at a time** rather than flagged as a batch, and the split is:

| ⚑ corrected, and re-verified RED by hand | ⛔ retired, subject gone |
|---|---|
| `M1` the delivery deleted outright · `M4` only approvals delivered · `M11` the false `waiting` sentence · `M12` the clause that says the decision will arrive | `M2` the guard inverted · `M3` the call's flag never lowered · `M5` the once-only guard removed · `M6` the call born given up on · `M13` the flag raised again |

🔴 **`M2` and `M5` keep their anchors written out in full rather than composed from `DELIVERY`**,
because that constant now names the UNGUARDED line: `M5` would have become a replacement identical
to its original (`a-mutation-that-changes-nothing-reports-as-a-survivor`, which the preflight
refuses) and `M2` would have planted `if (parked)` where no such binding exists, so the table would
have gone red on a `ReferenceError` rather than on the defect the row names.

⚠️ **`a-corrected-anchor-keeps-a-verdict-it-never-earned`**, so all four corrected rows were applied
one at a time against their killer files on the tree that corrected them and each went RED.

## ⛔ What has NO row, said rather than left out

⚠️ **No row for the order of the `parked` read against the settle.** ⛔ **It would change nothing
and would report as a SURVIVOR** (`a-mutation-that-changes-nothing-reports-as-a-survivor`):
`decideProposal` is synchronous and the continuation that lowers the flag is a microtask, so the
read is safe on either side today. ⚑ The source says so in place rather than claiming a defence no
row could fail.

⚠️ **No row restoring a second spelling of the approval sentence into `agent-tools.ts`.** ⛔ That
line is `489 M18`'s, whose anchor this dispatch corrected in place onto exactly it — a row here
would measure the same edit twice and tell a future reader that two people had looked (`609`'s own
precedent, and `a-line-no-mutation-can-kill-is-not-carrying-its-rule` read the other way). ⚑ The
duplication is guarded by a CENSUS instead — `the-decision-that-reaches-nobody.test.ts` §4 — which
is the right instrument for a move.

⚠️ **No row on `PROPOSAL_BOUND_MS`'s value, and none on the bound existing at all.** ⛔ §4 of this
brief reports that question to the PO and does not act on it; the number is `441`'s and its rows
are in that table.

⚠️ **No row on `releaseProposalsOf` not delivering.** ⛔ `withdrawn` is reached by four actors and
every one of them is the conversation being torn down, so there is nobody left to tell — and
`441 M25` and `489 M17` already sit on those two lines.
"""

from __future__ import annotations

HOST = "apps/desktop/src/main/runtime/runtime-host.ts"
TOOLS = "apps/desktop/src/main/runtime/agent-tools.ts"
RAILS = "apps/desktop/src/main/runtime/proposal-rails.ts"

# ⛔ **616 · the guard went with the hold** (`HO-093` §2). ⚑ The DELIVERY did not move and the
# rows that attack it are corrected onto its new line rather than retired; the rows that
# attacked the GUARD are retired, because nothing parks and a condition here could only ever
# be `true` (`a-corrected-anchor-keeps-a-verdict-it-never-earned` — both corrected rows were
# re-verified by hand on the tree that corrected them).
DELIVERY = "    void this.deliverDecision(sessionId, proposal, ending, created)"

MUTATIONS: list[tuple[str, list[tuple[str, str, str]]]] = [
    # ── A · never delivering — 609's finding, restored ─────────────────────────────────────────
    (
        # ⛔ **RETIRED BY RULING (landing D-016a, bd70d693):** `deliverDecision` delivered a person's
        # decision on a proposal back to the agent that proposed it. Proposals were removed end to
        # end, and `deliverDecision` no longer appears in runtime-host.ts (count_now 0). Its anchor
        # is left stale, so the census records it retired.
        "M1 · 🔴 **the decision reaches nobody** · the delivery is deleted outright and the app is "
        "back where `609` found it — a person approves an hour after the bound, the project is "
        "created, and the agent that asked for it is never told it exists. ⛔ Every surface a "
        "PERSON reads is correct; the only reader that is wrong is the one that did the asking",
        [(HOST, DELIVERY + "\n", "")],
    ),
    (
        "M2 · ⚠️ **the guard is inverted** · only a call that is STILL WAITING is sent a turn, so "
        "the one case this dispatch exists for gets nothing and the one case that was already "
        "answered gets told twice. ⛔ It is both defects at once and it passes any test that "
        "decides a proposal promptly",
        # ⛔ **616 · RETIRED, and its anchor is written out rather than built from `DELIVERY`**
        # for `M5`'s reason one step on: composed from the constant this row would plant
        # `if (parked)` where no such binding exists, so the table would go red on a
        # ReferenceError rather than on the defect the row names.
        [
            (
                HOST,
                "    if (!parked) void this.deliverDecision(sessionId, proposal, ending, created)",
                "    if (parked) void this.deliverDecision(sessionId, proposal, ending, created)",
            )
        ],
    ),
    (
        "M3 · ⛔ **the call's flag is never lowered** · nothing writes `aCallIsStillWaiting = "
        "false`, so every proposal looks for ever like one whose call is still parked and no "
        "decision is ever delivered. ⚑ The bound still fires and the call still returns "
        "`nobody-answered`, which is what makes this survive a test that only reads the call",
        [(HOST, "      holding.aCallIsStillWaiting = false\n", "")],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-016a, bd70d693):** The row is about delivering only
        # approvals of a proposal to its proposer. Proposals and `deliverDecision` are removed
        # (commit message, 'Proposals go end to end'), so there is no delivery whose scope could be
        # narrowed. Its anchor is left stale, so the census records it retired.
        "M4 · 🔴 **only approvals are delivered** · a person declines, nothing is created, and the "
        "proposer is told nothing at all — so it learns from silence that its proposal is still "
        "being considered. ⛔ `an-unenumerated-state-counts-as-success`: *nothing arrived* would "
        "mean both *they said no* and *nobody has looked yet*, and only one is worth acting on",
        [(HOST, DELIVERY, "    if (approve) void this.deliverDecision(sessionId, proposal, ending, created)")],
    ),
    # ── B · always delivering — 591 M6, re-created ─────────────────────────────────────────────
    (
        "M5 · ⛔ **the once-only guard goes** · the decision settles the promise the parked call is "
        "awaiting AND sends the same conversation a turn, so a proposer whose call never expired "
        "is told twice. ⚑ This is `591 M6` word for word — *the words are delivered EVEN WHEN a "
        "turn is still waiting* — the row `608` was allowed to retire because its branch had "
        "become unreachable, and which a proposal's surviving bound makes reachable again",
        # ⛔ **616 · this row is RETIRED and its anchor is written out rather than built from
        # `DELIVERY`** — the constant now names the UNGUARDED line, so composing this edit
        # from it would make the replacement identical to the original and the row would
        # report as a survivor rather than as dark
        # (`a-mutation-that-changes-nothing-reports-as-a-survivor`; the preflight refuses it).
        [
            (
                HOST,
                "    if (!parked) void this.deliverDecision(sessionId, proposal, ending, created)",
                "    void this.deliverDecision(sessionId, proposal, ending, created)",
            )
        ],
    ),
    (
        "M6 · ⚠️ **the call is born already given up on** · the hold is created with "
        "`aCallIsStillWaiting: false`, so a decision taken one second after the proposal — while "
        "the call is demonstrably still parked — both settles it and sends it a turn. ⛔ `M5`'s "
        "defect arriving from the other end, and invisible to any test that lets the bound fire",
        [(HOST, "      aCallIsStillWaiting: true,", "      aCallIsStillWaiting: false,")],
    ),
    # ── C · the words ─────────────────────────────────────────────────────────────────────────
    (
        # ⛔ **RETIRED BY RULING (landing D-016a, bd70d693):** The row is about the proposal decision
        # being delivered as 'work' instead of a 'notice'. The delivery (`decisionDeliveredText`,
        # `deliverDecision`) went with proposals, so the anchor is at count 0. Its anchor is left
        # stale, so the census records it retired.
        "M7 · 🔴 **the decision goes as WORK** · criterion 13's singleton refuses a second work "
        "message to a busy conversation, so the decision is DROPPED exactly when the proposer has "
        "the most going on. ⛔ Invisible to every idle arm — the words arrive, the turn starts, "
        "nothing looks wrong — and only the held arm can see it",
        [
            (
                HOST,
                "        decisionDeliveredText(proposal, decided, created),\n"
                "        THE_APP_ITSELF,\n"
                "        [],\n"
                "        'notice',\n",
                "        decisionDeliveredText(proposal, decided, created),\n"
                "        THE_APP_ITSELF,\n"
                "        [],\n"
                "        'work',\n",
            )
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-016a, bd70d693):** The row is about the delivered
        # decision text in proposal-rails.ts, which was deleted (count_now -1). The commit removes
        # proposals and `proposal-rails.ts` end to end. Its anchor is left stale, so the census
        # records it retired.
        "M8 · ⚠️ **the delivered words do not say what was decided ON** · the consequence arrives "
        "with no proposal attached, so a model reading *approved. acme exists now* hours after its "
        "turn ended has nothing to attach it to. ⛔ `answerText`'s rule at this "
        "venue — *the question is quoted back, because the turn that asked it may be hours gone*",
        # ⚑ **RE-POINTED at 624, not retired** (`HO-095` §6.4). ⛔ The line lost `quoting
        # ${proposal.proposalId}` — no agent tool takes a `prop_`, and a person read one in the
        # middle of a sentence about their own decision — so the anchor moved.
        # ⚠️ **The title lost *and no id to quote* with it**: that clause named a remedy that
        # never existed (`a-priced-cost-can-name-a-remedy-that-does-not-exist`). 🔴 **The DEFECT
        # is unchanged and is now sharper** — the NAME is the only thing attaching the
        # consequence to a proposal, so deleting the line costs the whole attachment.
        # `correct-a-stale-mutation-anchor-dont-retire-it`.
        #
        # ⚑ **639 · corrected again, same reason.** ⛔ The heading line is RENDERED from
        # `SHAPE_CREATES` now and `whatTheDecisionMeans` takes the shape, so the anchor's bytes
        # moved and its SUBJECT did not: the delivered words still attach the consequence to the
        # proposal by name, and deleting the line still costs the whole attachment. ⚠️ Re-verified
        # RED by hand against `the-decision-that-reaches-nobody.test.ts` before the census was
        # regenerated — `a-corrected-anchor-keeps-a-verdict-it-never-earned`.
        [
            (
                RAILS,
                "  return [\n"
                "    `A person decided on ${THE_THING_DECIDED_ON[SHAPE_CREATES[proposal.shape]]} you proposed, ${proposal.name}.`,\n"
                "    whatTheDecisionMeans(decided, { created, slug: proposal.slug, shape: proposal.shape }),\n"
                "  ].join('\\n\\n')\n",
                "  return whatTheDecisionMeans(decided, { created, slug: proposal.slug, shape: proposal.shape })\n",
            )
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-016a, bd70d693):** The row is about the refusal sentence
        # for a declined proposal in proposal-rails.ts, which was deleted (count_now -1). Proposals,
        # approving and their delivery were removed on purpose. Its anchor is left stale, so the
        # census records it retired.
        "M9 · ⛔ **the refusal loses its act** · the sentence still says nothing was created and "
        "no longer says what to do about it, so a model told only *they said no* reasonably sends "
        "the same proposal again and puts a second card in front of somebody who has just declined "
        "it. ⚑ `441` §2.2 wrote that clause for exactly that reason, and this dispatch put the "
        "same sentence on a second route where the harm is larger — the turn that proposed it is "
        "gone, so the model has less context and more reason to retry",
        [
            (
                RAILS,
                "    return 'they read the proposal and said no, so nothing was created. They are in this conversation — ask them what they would rather have, and do not send the same proposal again.'\n",
                "    return 'they read the proposal and said no, so nothing was created.'\n",
            )
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-016a, bd70d693):** proposal-rails.ts, and its
        # `ProposalDecided` type that excludes 'withdrawn', were deleted (count_now -1). The commit
        # message removes proposals and `proposal-rails.ts` end to end. Its anchor is left stale, so
        # the census records it retired.
        "M10 · ⚠️ **`withdrawn` becomes deliverable** · the type stops excluding it, so a caller can "
        "compose a turn saying *the work that proposed this was stopped* and send it to the very "
        "conversation whose teardown produced that ending. ⛔ The exclusion is the rail: four "
        "actors reach `withdrawn` and every one of them is the conversation going away",
        [(RAILS, "  decided: Exclude<ProposalDecided, 'withdrawn'>,", "  decided: ProposalDecided,")],
    ),
    # ── D · the two flags ─────────────────────────────────────────────────────────────────────
    (
        # ⛔ **RETIRED BY RULING (landing D-016a, bd70d693):** The row restores a false docblock on
        # the proposal-registry `waiting` field in runtime-host.ts. The proposal registry and its
        # field are gone with proposals, and the anchor is at count 0. Its anchor is left stale, so
        # the census records it retired.
        "M11 · 🔴 **the false sentence comes back** · the field docblock says `waiting` is *False "
        "once the bound has passed*, which no writer has ever made true. ⛔ It is not cosmetic: a "
        "reader who believes it takes `waiting` for *is a call still parked*, which is the "
        "different question with the different writer that this dispatch had to add a field for. "
        "⚑ `609` corrected the same claim at the branch that READS the field and left the "
        "declaration it comes from standing",
        [
            (
                HOST,
                "      /**\n       * ⛔ **Whether this proposal is still ANSWERABLE** — the card, and since `616` there is no",
                "      /** ⛔ **False once the bound has passed**; the entry stays. */\n"
                "      /**\n       * ⛔ **Whether this proposal is still ANSWERABLE** — the card, and since `616` there is no",
            )
        ],
    ),
    # ── E · the sweep standing rule 8.1 owed ──────────────────────────────────────────────────
    (
        # ⛔ **RETIRED BY RULING (landing D-016a, bd70d693):** The row is about the expiry branch of
        # the `create_project` proposal call's text ('What they decide will be sent to you when they
        # decide it'). `create_project` and its proposal path were deleted, and the string is no
        # longer in agent-tools.ts. Its anchor is left stale, so the census records it retired.
        "M12 · ⚠️ **the expiry branch stops saying the decision will arrive** · every other clause "
        "survives and the model is told the proposal is still in front of them, that this call "
        "gave up, and not to propose it again — so an obedient caller is left with NO path: it "
        "reports an unresolved proposal to its supervisor, or re-proposes out of having nothing "
        "else to do. ⛔ Before `615` that silence was honest, because the outcome really never "
        "arrived; the delivery this dispatch built is what makes the omission a false impression "
        "rather than a true one",
        [
            (
                TOOLS,
                " Do not propose it again — that would put a second decision in front of them for the same work. What they decide will be sent to you when they decide it.'\n",
                " Do not propose it again — that would put a second decision in front of them for the same work.'\n",
            )
        ],
    ),
    (
        "M13 · ⛔ **a call that stopped waiting starts again** · the flag is raised back to `true` "
        "after it is read, so the next reader of this entry believes a call is parked on a promise "
        "that has already been settled and resolved. ⚑ There is exactly one writer of `false` and "
        "deliberately no writer of `true` after creation; the absence of a second writer IS the "
        "guarantee, and an absence is what a row has to attack",
        [
            (
                HOST,
                "    const parked = holding.aCallIsStillWaiting\n",
                "    const parked = holding.aCallIsStillWaiting\n    holding.aCallIsStillWaiting = true\n",
            )
        ],
    ),
]
