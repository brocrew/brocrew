"""492 · make the word mean one thing — `HO-032` §1, `483`'s repair 2, Slice 5's first exit half.

🔴 **The defect this table restores, in the PO's own words:** *"Deny and Cancel do the same thing on
that door, and the only difference is a label that is false."*

⛔ **The door is ONE door.** `487` measured that most of `cancel` is already right — a command or
file approval maps to Codex's own `cancel` decision and goes out on the wire, and Claude's
`canUseTool` answers `interrupt: true`. ⚠️ **On a Codex `item/tool/call` there is no decision channel
at all**, so before this dispatch the whole of a cancel was: refuse the tool locally, latch
`interruptRequested`, and let `SessionMachine.completeTurn` rename Codex's ORDINARY completion
`interrupted`. 🔴 **A turn nobody asked to stop, relabelled.**

⚑ **What the repair is**: the tool result goes back exactly as a deny's does — byte for byte, because
*nobody ran your tool* is one outcome and a model must not read two sentences for it — and then the
door sends `turn/interrupt` for the turn THAT CARD belongs to. ⛔ **And the latch comes out**: with
the frame sent, the provider classifies its own turn, so a latch could only ever CHANGE that answer.
⚠️ (492's reasoning, before R43. Since `709` no latch renames a completion on any door; what a latch
still decides is the machine's own word for a fatal error after the ask — see M2.)

## ⚠️ Measured against the provider, not against this adapter's expectations

`pnpm run probe:codex-cancel-interrupt` drives the pinned bundled app-server on a loopback Responses
endpoint, no credential and no tokens. Four arms:

| arm | what it did | what pinned 0.146.0 answered |
|---|---|---|
| A · never-answer | left `item/tool/call` outstanding, then `turn/interrupt` | accepted in 16 ms · `turn/completed{status:'interrupted'}`; the app-server then completed the dangling call ITSELF (`failed`) 5 ms later and sent **no** `serverRequest/resolved` |
| B · answer-then-interrupt | the product's own declined payload, then the frame | accepted in 11 ms · `interrupted` |
| C · answer-only (CONTROL) | the same declined payload, no frame | `completed` — so `interrupted` is not what a declined tool call says anyway |
| D · two calls, one answered | cancelled one with another still open | `interrupted`; the app-server completed the other on its own |

⛔ **Arm A is why the frame goes out AFTER the tool result**, and arm D is why this door must not
call `settleRequests()` — the provider needs no help clearing the cards beside the one a person
answered, and `INTERRUPT_RAILS`' `a-person-is-being-asked` exists precisely to refuse an agent that
answers somebody else's card on their behalf.

## 🔴 The gate map — which file kills which row

| rows | killer |
|---|---|
| M1, M3, M5 | `packages/runtime/test/codex-runtime.test.ts` — the 492 pair and the 482 deny control |
| M2 | `packages/runtime/test/codex-runtime.test.ts` — 709's *"a Cancel here, then the stream ends"* — and `apps/desktop/test/make-the-word-mean-one-thing.test.ts` §3, the latch census |
| M4, M6, M11 | `apps/desktop/test/make-the-word-mean-one-thing.test.ts` §3 |
| M7, M9 | `apps/desktop/test/two-sentences-a-person-chooses-on.test.ts` §2 and `make-the-word-mean-one-thing.test.ts` §1 |
| M8 | `apps/desktop/test/make-the-word-mean-one-thing.test.ts` §1, the shared-derivation census |
| M9 | …and `apps/desktop/test/the-interruption-that-looks-like-a-fault.test.ts` §4 |
| M10 | `packages/runtime/test/codex-runtime.test.ts` — 709's *"a card CANCELLED, then the stream ends"* — and the latch census |

## ⛔ What this table deliberately does NOT contain

 - ⛔ **No row on the card's OFFER.** `HO-032` §1's outcome 1 was reached, so `cancel` stays on this
   door and `publishedOffer`'s floor is untouched — `482 M13/M14` and `487` own that rule and 492
   changed none of it. ⚑ A row here would double-count a defect somebody else already restores.
 - ⛔ **No row on the declined tool payload.** `348 M21/M22` own it, and 492's whole point is that
   those bytes are the SAME for both answers; a row making them differ would restore a defect this
   dispatch deliberately did not create.
 - ⛔ **No row adding a second `session.handle.interrupt()` call site in the host.** `397`'s
   structural claim owns that, and `the-word-for-a-question-nobody-stopped.test.ts` already kills it.
 - ⚠️ **No row on the missing `work_interrupted`.** A cancel writes no ask, so `howWorkStopped`
   answers `who: null` for a gesture this app knows the author of — 492 reports that as a FINDING
   about a class it did not repair (command approvals have it too), and a mutation row would claim a
   rule the product does not yet hold.
 - ⚑ **`M10` mutates TWO lines and the reason is a finding, not tidiness.** The command-approval
   path latches `requestInterrupt()` twice — `respondPermission` sets the bit, and then the approval
   handler's own continuation sets it again on the line above `endWait()`. ⛔ **The continuation's
   line alone is a NO-OP mutation**: removing it leaves `respondPermission`'s, which sets the same
   bit, so nothing behavioural can turn red (measured — the first draft of this row did exactly
   that). ⚑ `respondPermission`'s line alone IS killed, by `make-the-word-mean-one-thing`'s §3
   census, which counts it. ⚠️ **709 corrected this bullet**: it said *either* line alone was a
   no-op, and named `two-sentences-a-person-chooses-on.test.ts` as the test that stayed green — since
   R43 that test plants Codex's own `interrupted`, and M10's behavioural killer is 709's *"a card
   CANCELLED, then the stream ends"*. ⚠️ The continuation's line is `042`'s *two readings of one
   fact* on a line nothing can turn red; 492 reported it and did not repair it.
 - ⛔ **No row on `M6`'s behaviour.** Its killer is a SOURCE census and the table says so rather than
   implying a behavioural one: the provider clears its pending server requests at a turn boundary,
   so `the card's turn` and `the current turn` cannot be made to diverge through the real door.

⛔ **Evidence standard.** Every row was applied ALONE against a byte-exact snapshot, its own killer
file run, and the tree restored and `cmp`-verified before the next. ⚠️ The table has NOT been run
under the driver, so `CENSUS.md` records it `unrun` and no driver verdict is claimed here.
"""

CODEX = "packages/runtime/src/codex/codex-runtime.ts"
OFFER = "apps/desktop/src/renderer/src/lib/user-input-offer.ts"
TOOLS = "apps/desktop/src/main/runtime/agent-tools.ts"
STOPPED = "apps/desktop/src/shared/how-work-stopped.ts"

MUTATIONS = [
    # ── §1 · the ask itself ─────────────────────────────────────────────────────────────────────
    (
        "M1 · 🔴 THE DEFECT, restored · the frame is never sent, so a cancel on this door refuses "
        "the tool locally and the provider carries on — `483`'s measurement exactly, and the reason "
        "*the whole turn is asked to stop* would be a sentence about nothing",
        [
            (
                CODEX,
                "      if (decision.outcome === 'cancel') await this.askTheTurnToStop(readString(params, 'turnId'))\n      return\n",
                "      return\n",
            )
        ],
    ),
    (
        # 🔴 **RETIRED BY RULING at `720` (R71), in the honest direction: this row's REPLACEMENT is
        # now the product.** ⚑ R71: *"both latch, because a Cancel asked a stop on both, and a
        # fault after it is not the provider's word alone"* — so the latch this row put back beside
        # the frame is where the Cancel latches now (above the arm, in `respondPermission`). ⛔ A
        # mutation whose replacement is the current behaviour measures nothing
        # (`a-true-mutation-measures-nothing`), and its anchor — the arm alone — still matched, so
        # it would have kept `492`'s KILLED verdict without earning it. ⚑ **The anchor is pinned to
        # the arm AS IT STOOD ABOVE THE LATCH** (its next line was the latch's own comment, which
        # R71 removed), so the census records it retired, by name, rather than counting it.
        # ⚠️ The rule is measured the other way by `720 M7` (the latch back below the arm) and
        # `720 M8` (every answer latches).
        "M2 · ⛔ the latch comes back beside the frame · the ask goes out AND the local bit is set "
        "— ⚑ RELABELLED IN PLACE BY 709: since R43 `completeTurn` records the provider's word, so a "
        "turn Codex completes is no longer renamed; what the bit still changes is the machine's own "
        "word for a fatal error after this door's Cancel (`failed` becomes `interrupted`), on the "
        "door `492` left unlatched — the command door's Cancel does latch, so the two doors differ, "
        "on `main` too, and `709`'s response raises it for one ruling — killed by 709's agent-tool "
        "arm *\"a Cancel here, then the stream ends\"* and by the latch census",
        [
            (
                CODEX,
                "    if (state.kind.kind === 'agentTool') {\n      this.permissions.respond(id, decision)\n      return\n    }\n    // Cancel is a client-side turn-kill",
                "    if (state.kind.kind === 'agentTool') {\n      if (decision.outcome === 'cancel') this.machine.requestInterrupt()\n      this.permissions.respond(id, decision)\n      return\n    }\n    // Cancel is a client-side turn-kill",
            )
        ],
    ),
    (
        "M3 · ⚠️ DENY stops the turn too · the two answers collapse back into one act from the other "
        "direction — a person refusing one tool call loses the whole turn, which is the destruction "
        "`478` F3 says the label is what buys consent for",
        [
            (
                CODEX,
                "      if (decision.outcome === 'cancel') await this.askTheTurnToStop(readString(params, 'turnId'))\n      return\n",
                "      await this.askTheTurnToStop(readString(params, 'turnId'))\n      return\n",
            )
        ],
    ),
    (
        "M4 · 🔴 the door answers everybody else's card · `settleRequests()` safe-rejects every OTHER "
        "open card as `{outcome:'deny'}` and writes no row for any of them — HO-005 Q2 arriving "
        "through a person's own press, and the act `INTERRUPT_RAILS`' `a-person-is-being-asked` "
        "refuses an agent for",
        [
            (
                CODEX,
                "    if (!providerTurnId) return\n    await this.sendInterruptRpc(providerTurnId)\n",
                "    if (!providerTurnId) return\n    this.settleRequests()\n    await this.sendInterruptRpc(providerTurnId)\n",
            )
        ],
    ),
    (
        "M5 · ⛔ a local terminal instead of an ask · `forceEnd` declares the turn over from inside "
        "this app and the provider is never told, which is `483`'s defect wearing the repair's "
        "clothes — the word would be right and the work would still be running",
        [
            (
                CODEX,
                "    if (!providerTurnId) return\n    await this.sendInterruptRpc(providerTurnId)\n",
                "    if (!providerTurnId) return\n    this.machine.forceEnd()\n",
            )
        ],
    ),
    (
        "M6 · ⚠️ the frame names the CURRENT turn rather than the card's · a person answers whenever "
        "they get to it, so the id this app happens to be holding is not the one the decision is "
        "about — `serverRequestScopeProblem` validated the card's own `turnId` and that is the "
        "faithful source. ⛔ Killed by a SOURCE census and the table says so",
        [
            (
                CODEX,
                "await this.askTheTurnToStop(readString(params, 'turnId'))",
                "await this.askTheTurnToStop(this.currentTurn?.providerTurnId ?? '')",
            )
        ],
    ),
    # ── §2 · the claim, and the one derivation it comes from ────────────────────────────────────
    (
        "M7 · 🔴 the card claims the turn is already over · *is interrupted* is the claim "
        "`RuntimeHost.interruptAgent` refuses to make on either provider — Claude forces its own "
        "terminal, Codex awaits an answer that may never come (709: not a `turn/completed`) — and "
        "it is the sentence "
        "`483` found false on the one door where nothing was ever asked",
        [
            (
                OFFER,
                "  cancel: `the whole turn is ${ASKED_TO_STOP}, and this request is refused`,",
                "  cancel: 'the whole turn is interrupted, and this request is refused',",
            )
        ],
    ),
    (
        "M8 · ⛔ the two doors spell the claim separately · the STRING is identical and every value "
        "assertion still passes, which is the whole hazard: one act described from two places, free "
        "to drift the next time either is edited. ⚑ HO-030 §2 — a sentence that differs between "
        "surfaces teaches a reader that the sentence is optional",
        # ⚑ Landing D-017 (5206d835) · re-anchored in place, not retired — The interrupt_agent
        # notice still composes its claim from the shared `ASKED_TO_STOP` constant rather than
        # spelling it out — the exact hazard M8 protects against. A plain hardcoded-text plant
        # (matching the original row's edit) is now invisible to the file-wide 'contains
        # ${ASKED_TO_STOP} somewhere' census, because D-017 added an unrelated second
        # `${ASKED_TO_STOP}` use elsewhere in the same file (the `interrupted:` refusal reason) that
        # keeps that loose check green. Interpolating a quoted string literal in place of the
        # constant reproduces the same byte-identical output (so it is still undetectable by value
        # assertions, matching the row's own point) while tripping the census's separate 'does not
        # spell the claim as a quoted literal' check, which the plain-text form could not.
        # ⚑ Landing D-016c commits 6–7 and D-022 (4a7f0fec, c1a79abe, 37228461) · re-anchored in
        # place, not retired — The rule survives: `interrupt_agent` composes its claim from the
        # shared `ASKED_TO_STOP` constant instead of spelling it, so the two doors cannot drift. The
        # sentence now uses `${called}`, and the plant interpolates the quoted literal `${'asked to
        # stop'}`, which gives the same bytes but a second spelling. Killed by
        # `make-the-word-mean-one-thing.test.ts`.
        [
            (TOOLS, '            `${called} was ${ASKED_TO_STOP}. Its state now: ${now}.`,', "            `${called} was ${'asked to stop'}. Its state now: ${now}.`,"),
        ],
    ),
    (
        "M9 · 🔴 the shared claim becomes the one this app may not make · `stopped` is what "
        "`interrupt_agent` has refused to say since `395`, and moving it into the constant makes "
        "BOTH surfaces say it at once — the cost of sharing bytes, paid for by the tests that read "
        "the value rather than the constant",
        [
            (
                STOPPED,
                "export const ASKED_TO_STOP = 'asked to stop'",
                "export const ASKED_TO_STOP = 'stopped'",
            )
        ],
    ),
     # ── §3 · the door this dispatch did not touch, and the ordering arm A measured ─────────────
    (
        "M10 · ⚠️ the door that DID keep the word loses it · a command or file approval's cancel "
        "stops latching — ⚑ RELABELLED IN PLACE BY 709: since R43 the turn's ending is Codex's own "
        "`interrupted` either way, so what breaks is the machine's word for a FATAL error on a "
        "cancelled turn, which reads `failed` (the fault alone) instead of `interrupted` beside it — "
        "killed by 709's codex-runtime arm. ⛔ **BOTH latches, and that is a finding**: this path "
        "sets the bit twice — once in `respondPermission`, once in the approval handler's "
        "continuation — so the continuation's latch alone is unkillable (`respondPermission`'s sets "
        "the same bit), while `respondPermission`'s alone is killed by the §3 census — ⚑ RELABELLED "
        "IN PLACE BY 720: since R71 the latch it removes sits above the agent-tool arm, so it "
        "unlatches that door too, and 720's agent-tool arm kills it as well",
        [
            (
                # ⚠️ **ANCHOR CORRECTED at `605`, and the SUBJECT is untouched** — the latch is
                # still on this line and the row still removes it. ⛔ `605` inserted the
                # elicitation's own wire-shape branch between the latch and the `Atomic:` comment
                # this anchor used as its neighbour, so the pair stopped matching. ⚑ A moved
                # anchor is a repair, never a retirement, and the row was re-verified RED by hand
                # after the correction (`a-corrected-anchor-keeps-a-verdict-it-never-earned`).
                # ⚠️ **Still a PAIR and not the bare line**, because the same latch appears twice
                # in this file and this row's second edit owns the other one.
                # ⚑ **720 · ANCHOR CORRECTED AGAIN, the subject untouched** — R71 moved this latch
                # ABOVE the agent-tool arm, so its neighbour is the 348 comment now and it guards
                # the command, file AND agent-tool doors at once (the elicitation latches in its own
                # handler, where its Cancel asks); the row still removes it (with the
                # continuation's, below), so its RED now covers the agent-tool door too.
                # Re-verified RED alone after the correction.
                CODEX,
                "    if (decision.outcome === 'cancel' && state.kind.kind !== 'elicitation') {\n      this.machine.requestInterrupt()\n    }\n    // 🔴 **A tool call's answer is not a decision",
                "    // 🔴 **A tool call's answer is not a decision",
            ),
            (
                CODEX,
                "    if (decision.outcome === 'cancel') this.machine.requestInterrupt()\n    this.machine.endWait()",
                "    this.machine.endWait()",
            ),
        ],
    ),
   (
        "M11 · ⛔ the frame goes out BEFORE the tool result · the provider is asked to stop while it "
        "is still holding our call, and arm A measured what that costs: the app-server completes "
        "the dangling call ITSELF five ms after `turn/completed`, with no `serverRequest/resolved`, "
        "so this adapter goes on holding an id the provider has already torn down",
        [
            (
                CODEX,
                "      if (decision.outcome === 'cancel') await this.askTheTurnToStop(readString(params, 'turnId'))\n      return\n",
                "      return\n",
            ),
            (
                CODEX,
                "      this.respondToProvider(id, {\n        contentItems: [\n",
                "      if (decision.outcome === 'cancel') await this.askTheTurnToStop(readString(params, 'turnId'))\n      this.respondToProvider(id, {\n        contentItems: [\n",
            ),
        ],
    ),
]
