"""720 · Every stop door tells the truth.

⚑ **Ordered by** the PM — runtime-dev-2's `709` F-1, F-2, F-5, F-6, F-7, F-9, F-10 (ruled `R71`–`R74`).

## 🔴 A · `R71` — a stop the APP forces records its word as the app's act (M1-M6)

`SessionMachine`'s three own endings — `forceEnd` (a Claude Stop after its receipt, every Close),
`failTurn` and a fatal error's terminal — carry `wordOf: 'this-app'`; a provider's own word never
does, and the schema declares the field so the wire does not strip it.

## 🔴 B · `R71` — a Cancel latches on every door (M7-M8)

The latch in the Codex adapter's `respondPermission` sits ABOVE the agent-tool arm now, so *Cancel,
then the stream dies* reads `interrupted` on the agent-tool card as on a command approval.

## 🔴 C · `R72` — the stall notice carries the ask (M9-M11)

`AN_ASK_RIDES_ON` lets an ask ride on both turn causes, and `theStallAndItsAsk` says an ask beside
a turn the provider finished AS an ask. (`484 M8` and `M19`, re-anchored in place, guard the other
direction.)

## 🔴 D · `R73` — a policy's own words are the provider's (M12-M22)

`thePolicysWords` carries Codex's *"`<command>` requires approval: <rule>"* as `providerReason`,
labelled `a-policy-rule`, and nothing else; `probe:codex-approval-reason`'s verdict reads the carry.

## 🔴 E · `R74` — an elicitation's Cancel asks the card's own turn to stop (M23-M25)

## 🔴 F · `709` F-6 — a person's Stop is bounded (M26-M27)

## 🔴 G · `709` F-7 — interrupt-and-send's latch counts (M28-M30)

## 🔴 H · `709` F-9 — `interrupt_agent` asks, and says where to read what happened (M31)

## ⛔ What this table cannot reach

 * ⚠️ **The live probes** — `probe:codex-external-mcp` arms H, I, J and `probe:codex-approval-reason`
   (loopback, $0) — not in `ci`; their runs and tables are in `720`'s response. Their verdict
   modules are (§D).
"""

MACHINE = "packages/runtime/src/internal/session-machine.ts"
EVENTS = "packages/runtime/src/events.ts"
CODEX = "packages/runtime/src/codex/codex-runtime.ts"
EVIDENCE = "packages/runtime/smoke/approval-reason-evidence.ts"
TASKS = "apps/desktop/src/shared/tasks.ts"
RAILS = "apps/desktop/src/main/runtime/reply-rails.ts"
TOOLS = "apps/desktop/src/main/runtime/agent-tools.ts"
HOST = "apps/desktop/src/main/runtime/runtime-host.ts"

MUTATIONS: list[tuple[str, list[tuple[str, str, str]]]] = [
    # ── A · R71, the app's own word ─────────────────────────────────────────────────────────────
    (
        "M1 · 🔴 **`forceEnd` writes a bare `interrupted`** — a Close or a Claude Stop reads as the "
        "provider's word (`main`) — killed by `the-apps-own-word-is-marked.test.ts`, "
        "`conformance.test.ts` and `runtime-host.test.ts` (720)",
        [
            (
                MACHINE,
                # ⚑ **F080 · re-anchored in place, not retired** — F080's follow-up marks the ending of a turn that joined a burst; the app's word is still the defect's subject.
                "      this.say({ type: 'turn', state: 'interrupted', wordOf: 'this-app', ...endingMarksOf(ended) })\n      this.foreignTerminal = expectTerminal\n",
                "      this.say({ type: 'turn', state: 'interrupted', ...endingMarksOf(ended) })\n      this.foreignTerminal = expectTerminal\n",
            )
        ],
    ),
    (
        "M2 · ⛔ **`failTurn`'s `failed` is unmarked** — a turn WE could not start reads as the "
        "provider's fault — killed by `the-apps-own-word-is-marked.test.ts` (720)",
        [
            (
                MACHINE,
                # ⚑ **F080 · re-anchored in place, not retired** — F080's follow-up marks the ending of a turn that joined a burst; the app's word is still the defect's subject.
                "      this.say({ type: 'turn', state: 'failed', wordOf: 'this-app', ...endingMarksOf(ended) })\n",
                "      this.say({ type: 'turn', state: 'failed', ...endingMarksOf(ended) })\n",
            )
        ],
    ),
    (
        "M3 · ⛔ **`failTurn`'s `interrupted` is unmarked** — killed by "
        "`the-apps-own-word-is-marked.test.ts` (720)",
        [
            (
                MACHINE,
                # ⚑ **F080 · re-anchored in place, not retired** — F080's follow-up marks the ending of a turn that joined a burst; the app's word is still the defect's subject.
                "      this.say({ type: 'turn', state: 'interrupted', wordOf: 'this-app', ...endingMarksOf(ended) })\n    } else {\n",
                "      this.say({ type: 'turn', state: 'interrupted', ...endingMarksOf(ended) })\n    } else {\n",
            )
        ],
    ),
    (
        "M4 · 🔴 **a fatal error's terminal is unmarked** — a provider that DIED reads as one that "
        "ended the turn — killed by `the-apps-own-word-is-marked.test.ts`, `claude-runtime.test.ts` "
        "and `codex-runtime.test.ts` (720)",
        [
            (
                MACHINE,
                "        state: endedTurn.interruptRequested ? 'interrupted' : 'failed',\n        wordOf: 'this-app',\n",
                "        state: endedTurn.interruptRequested ? 'interrupted' : 'failed',\n",
            )
        ],
    ),
    (
        "M5 · 🔴 **the provider's own word is marked too** — the mark stops meaning anything — "
        "killed by `the-apps-own-word-is-marked.test.ts`, `conformance.test.ts`, "
        "`runtime-host.test.ts` and `claude-runtime.test.ts` (720's controls)",
        [
            (
                MACHINE,
                # ⚑ **F080 · re-anchored in place, not retired** — F080 moved the provider's ending into `sayTheEnding`, which adds the `startedBy` marks.
                "      this.say({ type: 'turn', state: outcome, ...marks })\n",
                "      this.say({ type: 'turn', state: outcome, ...marks, wordOf: 'this-app' })\n",
            )
        ],
    ),
    (
        "M6 · 🔴 **the schema does not declare it** — every wire crossing strips it silently, so the "
        "ledger never holds it — killed by `the-apps-own-word-is-marked.test.ts` §2 and "
        "`runtime-host.test.ts` (720)",
        [(EVENTS, "  wordOf: z.literal('this-app').optional(),\n", "")],
    ),
    # ── B · R71, the latch on every door ────────────────────────────────────────────────────────
    (
        "M7 · 🔴 **THE DEFECT, restored: the latch back BELOW the agent-tool arm** (`main`, `492`) — "
        "*Cancel, then the stream dies* reads `failed` on that card and `interrupted` on a command "
        "approval — killed by `codex-runtime.test.ts` (720) and `make-the-word-mean-one-thing.test.ts`",
        [
            (
                CODEX,
                "    if (decision.outcome === 'cancel' && state.kind.kind !== 'elicitation') {\n      this.machine.requestInterrupt()\n    }\n    // 🔴 **A tool call's answer is not a decision, so this is not the writer for it** (348).\n",
                "    // 🔴 **A tool call's answer is not a decision, so this is not the writer for it** (348).\n",
            ),
            (
                CODEX,
                "      this.permissions.respond(id, decision)\n      return\n    }\n    // ⚑ **What each remaining door's Cancel tells Codex**",
                "      this.permissions.respond(id, decision)\n      return\n    }\n    if (decision.outcome === 'cancel' && state.kind.kind !== 'elicitation') {\n      this.machine.requestInterrupt()\n    }\n    // ⚑ **What each remaining door's Cancel tells Codex**",
            ),
        ],
    ),
    (
        "M8 · ⛔ **every answer latches** — a Deny, which asks no stop, reads a fault after it as "
        "a stop — killed by `codex-runtime.test.ts` (720's Deny control, and 395's)",
        [
            (
                CODEX,
                "    if (decision.outcome === 'cancel' && state.kind.kind !== 'elicitation') {\n",
                "    if (state.kind.kind !== 'elicitation') {\n",
            )
        ],
    ),
    # ── C · R72, the stall notice carries the ask ───────────────────────────────────────────────
    (
        "M9 · 🔴 **THE DEFECT, restored: no ask rides on `turn_ended`** (`main`, `494`'s pin) — a "
        "turn asked to stop that the provider finished stalls naming nobody — killed by "
        "`the-act-this-app-knows-the-author-of.test.ts` and `state-a-supervisor-can-trust.test.ts` (720)",
        # ⚑ ANCHOR CORRECTED IN PLACE BY T-002 — D-005's `ITS_OWNER_RUNNING_AGAIN_DRIVES_IT` is a
        # second record that opens with the same two lines, so the anchor now names the record.
        # Same defect. Re-verified RED alone on its two killers.
        [(TASKS, "export const AN_ASK_RIDES_ON: Readonly<Record<TaskStallCause, boolean>> = {\n  turn_ended: true,\n  turn_interrupted: true,\n",
          "export const AN_ASK_RIDES_ON: Readonly<Record<TaskStallCause, boolean>> = {\n  turn_ended: false,\n  turn_interrupted: true,\n")],
    ),
    (
        "M10 · 🔴 **the ask on `turn_ended` is said as the ENDING's actor** — *\"its turn ended with "
        "this work still open, by a person\"*: the asker named as the one who ended a turn the "
        "provider finished, the conflation R43 removed — killed by "
        "`state-a-supervisor-can-trust.test.ts` (720; since `729` by its turn_ended ANCESTOR control — "
        "R90 says the reader's own ask as its own act, which never reaches this arm)",
        # ⚑ **F074 · re-anchored in place, not retired** — F074 · the ask is said as an ask on every cause but a stopped turn's (`provider_limited` joined `turn_ended`); the row still drops that phrasing.
        [(RAILS, "  return by !== null && cause !== 'turn_interrupted'\n", "  return false\n")],
    ),
    (
        "M11 · ⛔ **the stopped turn's actor is said as an ask** — *\"the turn it was running in was "
        "stopped; it had been asked to stop, by a person\"* — killed by "
        "`state-a-supervisor-can-trust.test.ts` (484's notice and list_tasks pins)",
        # ⚑ **F074 · re-anchored in place, not retired** — F074 · the same line, widened to every cause but a stopped turn's; the row still says a stopped turn's actor as an ask.
        [(RAILS, "  return by !== null && cause !== 'turn_interrupted'\n", "  return by !== null\n")],
    ),
    # ── D · R73, a policy's own words ───────────────────────────────────────────────────────────
    (
        "M12 · 🔴 **THE DEFECT, restored: the policy's words are carried by nobody** (`main`, `709` "
        "F-5) — killed by `codex-runtime.test.ts` and `the-agents-words-on-a-card.test.ts` (720)",
        [
            (
                CODEX,
                "        : { providerReason: policysWords, providerReasonFrom: 'a-policy-rule' as const }),\n",
                "        : {}),\n",
            )
        ],
    ),
    (
        "M13 · ⛔ **carried without its label** — Codex's rule reads as a mark's reason — killed by "
        "`codex-runtime.test.ts` and `the-agents-words-on-a-card.test.ts` (720)",
        [
            (
                CODEX,
                "        : { providerReason: policysWords, providerReasonFrom: 'a-policy-rule' as const }),\n",
                "        : { providerReason: policysWords }),\n",
            )
        ],
    ),
    (
        "M14 · ⛔ **the schema does not declare the label** — the wire strips it — killed by "
        "`the-agents-words-on-a-card.test.ts` (720, through the host)",
        [(EVENTS, "  providerReasonFrom: z.literal('a-policy-rule').optional(),\n", "")],
    ),
    (
        "M15 · 🔴 **the sentence is not tied to THIS request's command** — words naming another "
        "command are labelled its rule — killed by `codex-runtime.test.ts` (720's forged-head control)",
        [
            (
                CODEX,
                "  if (!said.startsWith(head) || said.slice(head.length).trim() === '') return null\n",
                "  if (!said.includes(' requires approval: ') || said.slice(head.length).trim() === '') return null\n",
            )
        ],
    ),
    (
        "M16 · ⛔ **a sentence with no rule text is a rule** — killed by `codex-runtime.test.ts` "
        "(720's no-rule-text control)",
        [
            (
                CODEX,
                "  if (!said.startsWith(head) || said.slice(head.length).trim() === '') return null\n",
                "  if (!said.startsWith(head)) return null\n",
            )
        ],
    ),
    (
        "M17 · 🔴 **\"and no further\" dropped: the rule-silent sentence is a rule too** — killed by "
        "`codex-runtime.test.ts` (720's rule-silent control)",
        [
            (
                CODEX,
                "  const head = `\\`${command}\\` requires approval: `\n",
                "  const head = `\\`${command}\\` requires approval`\n",
            )
        ],
    ),
    (
        "M18 · 🔴 **the other request shapes are not refused** — a network, subcommand or "
        "additional-permissions approval, or one with an offered rule, carries a policy's label — "
        "killed by `codex-runtime.test.ts` (720's controls)",
        [(CODEX, "  if (!unset.every((key) => params[key] == null)) return null\n", "")],
    ),
    (
        "M19 · ⛔ **an offered rule is not read** — `[]` rides BOTH `agentReason` and "
        "`providerReason` — killed by `codex-runtime.test.ts` (720's empty-rule control)",
        [
            (
                CODEX,
                "    'proposedExecpolicyAmendment',\n    'networkApprovalContext',\n",
                "    'networkApprovalContext',\n",
            )
        ],
    ),
    (
        "M20 · ⛔ **the policy's words are carried raw** — escapes and a 70 KB sentence reach the "
        "card — killed by `codex-runtime.test.ts` (720's cleaning test)",
        [(CODEX, "  return wordsForACard(said)\n}\n", "  return said\n}\n")],
    ),
    (
        "M35 · 🔴 **the head may stand anywhere in the sentence** — a model's justification that "
        "quotes Codex's sentence after words of its own is labelled a rule — killed by "
        "`codex-runtime.test.ts` (720's head-after-other-words control)",
        [
            (
                CODEX,
                "  if (!said.startsWith(head) || said.slice(head.length).trim() === '') return null\n",
                "  if (!said.includes(head) || said.slice(head.length).trim() === '') return null\n",
            )
        ],
    ),
    (
        "M36 · ⛔ **the head is compared AFTER cleaning** — a multi-line (heredoc) command's rule is "
        "dropped, because the cleaning collapses its newlines — killed by `codex-runtime.test.ts` (720)",
        [(CODEX, "  const said = params['reason']\n", "  const said = wordsForACard(params['reason'])\n")],
    ),
    (
        "M21 · 🔴 **the verdict cannot see an unsaid rule** — `the-rule-unsaid` never returned — "
        "killed by `codex-approval-reason-evidence.test.ts` (720)",
        [(EVIDENCE, "  if (unsaid.length > 0) return { verdict: 'the-rule-unsaid', turns: unsaid }\n", "")],
    ),
    (
        "M37 · ⛔ **the verdict compares the CLEANED carry with the RAW reason** — a correct carry "
        "of a rule over a multi-line command reads `the-rule-unsaid` — killed by "
        "`codex-approval-reason-evidence.test.ts` (720)",
        [
            (
                EVIDENCE,
                "        (ask.card?.providerReason !== wordsForACard(ask.rawReason) ||\n",
                "        (ask.card?.providerReason !== ask.rawReason ||\n",
            )
        ],
    ),
    (
        "M22 · ⛔ **the verdict cannot see a provider's words on a turn that is no rule** — killed "
        "by `codex-approval-reason-evidence.test.ts` (720)",
        [(EVIDENCE, "  if (notARule.length > 0) return { verdict: 'misattributed', turns: notARule }\n", "")],
    ),
    # ── E · R74, the elicitation's Cancel ───────────────────────────────────────────────────────
    # 🔴 **RETIRED BY RULING at `736`** — R97 (PM): *"Cancel does what the CLI's Cancel does … BroBot adds no stop of its own to a Cancel."* The elicitation Cancel's own stop (R74) and its latch are gone, so the code this row mutated is gone and what it planted is now the product. Measured: the Codex terminal's Esc on its own MCP approval lets the turn run on.
    (
        "M23 · 🔴 **THE DEFECT, restored: the elicitation's Cancel asks the turn nothing** (`main`, "
        "`709` F-10; measured: the turn runs on) — killed by `codex-runtime.test.ts` (720)",
        [
            (
                CODEX,
                "    if (isRecord(answered) && answered['outcome'] === 'cancel') {\n",
                "    if (isRecord(answered) && answered['outcome'] === 'never') {\n",
            )
        ],
    ),
    # 🔴 **RETIRED BY RULING at `736`** — R97 (PM): *"Cancel does what the CLI's Cancel does … BroBot adds no stop of its own to a Cancel."* The elicitation Cancel's own stop (R74) and its latch are gone, so the code this row mutated is gone. ⚠️ What it planted is NOT the product (`736`'s review): the rule it guarded — no elicitation answer stops or latches the turn — is guarded now by `736` M21 and this table's M32. Measured: the Codex terminal's Esc on its own MCP approval lets the turn run on.
    (
        "M24 · 🔴 **addressed to `currentTurn`, not the frame's turn** — `492`'s ruling, broken: a "
        "frame that named no turn stops whatever is running when the person answers — killed by "
        "`codex-runtime.test.ts` (720's no-turn control)",
        [
            (
                CODEX,
                "        isRecord(params) && typeof params['turnId'] === 'string' ? params['turnId'] : ''\n",
                "        (this.currentTurn?.providerTurnId ?? '')\n",
            )
        ],
    ),
    # 🔴 **RETIRED BY RULING at `736`** — R97 (PM): *"Cancel does what the CLI's Cancel does … BroBot adds no stop of its own to a Cancel."* The elicitation Cancel's own stop (R74) and its latch are gone, so the code this row mutated is gone. ⚠️ What it planted is NOT the product (`736`'s review): the rule it guarded — no elicitation answer stops or latches the turn — is guarded now by `736` M21 and this table's M32. Measured: the Codex terminal's Esc on its own MCP approval lets the turn run on.
    (
        "M25 · ⛔ **a Deny stops the turn too** — killed by `codex-runtime.test.ts` (720's Deny control)",
        [
            (
                CODEX,
                "    if (isRecord(answered) && answered['outcome'] === 'cancel') {\n",
                "    if (isRecord(answered) && answered['outcome'] !== 'allow') {\n",
            )
        ],
    ),
    (
        "M32 · 🔴 **the elicitation latches at the PRESS again** — a Cancel on a frame that named no "
        "turn marks the running turn as asked to stop, though nothing asked Codex to (720's review) "
        "— killed by `codex-runtime.test.ts` (720's no-turn control)",
        [
            (
                CODEX,
                "    if (decision.outcome === 'cancel' && state.kind.kind !== 'elicitation') {\n",
                "    if (decision.outcome === 'cancel') {\n",
            )
        ],
    ),
    # 🔴 **RETIRED BY RULING at `736`** — R97 (PM): *"Cancel does what the CLI's Cancel does … BroBot adds no stop of its own to a Cancel."* The elicitation Cancel's own stop (R74) and its latch are gone, so the code this row mutated is gone. ⚠️ What it planted is NOT the product (`736`'s review): the rule it guarded — no elicitation answer stops or latches the turn — is guarded now by `736` M21 and this table's M32. Measured: the Codex terminal's Esc on its own MCP approval lets the turn run on.
    (
        "M33 · ⛔ **the elicitation's own latch is unconditional** — the same defect from the "
        "handler — killed by `codex-runtime.test.ts` (720's no-turn control)",
        [
            (
                CODEX,
                "      if (theCardsTurn !== '' && theCardsTurn === this.currentTurn?.providerTurnId) {\n",
                "      if (theCardsTurn !== '' || theCardsTurn === '') {\n",
            )
        ],
    ),
    # 🔴 **RETIRED BY RULING at `736`** — R97 (PM): *"Cancel does what the CLI's Cancel does … BroBot adds no stop of its own to a Cancel."* The elicitation Cancel's own stop (R74) and its latch are gone, so the code this row mutated is gone and what it planted is now the product. Measured: the Codex terminal's Esc on its own MCP approval lets the turn run on.
    (
        "M34 · ⛔ **an in-turn elicitation's Cancel never latches** — R71 dropped on this door: a "
        "fault after its Cancel reads the fault alone — killed by `codex-runtime.test.ts` (720)",
        [
            (
                CODEX,
                "      if (theCardsTurn !== '' && theCardsTurn === this.currentTurn?.providerTurnId) {\n",
                "      if (theCardsTurn === '' && theCardsTurn !== '') {\n",
            )
        ],
    ),
    # ── F · F-6, a person's Stop is bounded ─────────────────────────────────────────────────────
    (
        "M26 · 🔴 **THE DEFECT, restored: the Stop waits on Codex's answer, unbounded** (`main`, "
        "`709` F-6) — killed by `an-interrupt-codex-never-answers.test.ts` (720)",
        [(HOST, "    if (await settledWithin(stopping, this.interruptWaitMs)) await stopping\n", "    await stopping\n")],
    ),
    (
        "M27 · ⛔ **a refusal inside the wait is swallowed** — a person's Stop that the provider "
        "refused reports nothing — killed by `the-word-for-a-question-nobody-stopped.test.ts`",
        [
            (
                HOST,
                "    if (await settledWithin(stopping, this.interruptWaitMs)) await stopping\n",
                "    await settledWithin(stopping, this.interruptWaitMs)\n",
            )
        ],
    ),
    # ── G · F-7, the latch counts ───────────────────────────────────────────────────────────────
    (
        "M28 · 🔴 **THE DEFECT, restored: the first press lowers the latch under the second** "
        "(`main`, `709` F-7) — killed by `an-interrupt-codex-never-answers.test.ts` (720)",
        [(HOST, "      session.holdingQueue -= 1\n", "      session.holdingQueue = 0\n")],
    ),
    (
        "M29 · ⛔ **the latch never comes down** — the message that was waiting waits for good — "
        "killed by `an-interrupt-codex-never-answers.test.ts` (720's control) and `709`'s arms",
        [(HOST, "      session.holdingQueue -= 1\n", "")],
    ),
    (
        "M30 · ⛔ **the flush does not read the latch** — the queued message jumps interrupt-and-send "
        "(`077`) — killed by `queued-message.test.ts` and `handed-path-send.test.ts`",
        [(HOST, "    if (session.holdingQueue) return\n", "")],
    ),
    # ── H · F-9, the description asks ───────────────────────────────────────────────────────────
    (
        "M31 · 🔴 **THE DEFECT, restored: the description promises the turn IS cut short** (`main`, "
        "`709` F-9 — the ledger can say `completed` beside it) — killed by "
        "`a-backgrounded-agent-outlives-its-turn.test.ts` (720)",
        [
            (
                TOOLS,
                # ⚑ **W4.135 · re-anchored in place, not retired** — W4.135 · F084 replaced the background sentence; the plant still promises the turn IS cut short
                "It asks the turn it is in to stop: that turn may end there, throwing away whatever it was part-way through, or it may be finished anyway — once the agent is no longer working, get_agent_status says which, so read it there before you rely on either.",
                "The turn it is in is cut short and whatever that turn was part-way through is thrown away.",
            )
        ],
    ),
]


if __name__ == "__main__":
    raise SystemExit("run through mutate.sh, never directly")
