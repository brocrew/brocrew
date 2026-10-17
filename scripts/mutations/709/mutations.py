"""709 · The provider's word, and the agent's words.

⚑ **Ordered by** the PM — runtime-dev's `704` H-3 (ruled R43), H-4 and H-5 (ruled R44), and H-8.

## 🔴 A · `704` H-8 — interrupt-and-send's ask is bounded, as `interruptAgent`'s is (M1-M2)

⚑ Measured on the REAL `CodexRuntime` over a scripted app-server (`an-interrupt-codex-never-answers`):
on `main` a Codex that never answers `turn/interrupt` held the verb, and the queue behind it, for
good — even when it had already ended the turn. M1 puts the unbounded await back; M2 takes the wait
away altogether, which only the patience arm can see (a Codex that answers 5.5 s after the ask).

## 🔴 B · R43 — the ledger records the provider's word (M3-M12)

⚑ `SessionMachine.completeTurn` no longer renames the provider's outcome once a stop is asked (M3).
Claude's own word for a stopped turn — `terminal_reason: aborted_streaming / aborted_tools`,
measured on CLI 2.1.281 — is read (M4-M6); the Fake, a provider, ends a turn it was told to stop in
its own word (M7-M8). The readers that took the ask as the stop now say the ask (M9-M11), and
`probe:codex-early-interrupt` checks the product's word against Codex's (M12).

## 🔴 C · R44 — the model's words are carried under the agent's name (M13-M20)

⚑ Measured by `probe:codex-approval-reason` (bundled 0.146.0): a command's `reason` is the model's
`justification`, and a permissions request's `reason` is the model's (with Codex's
`request_permissions_tool` on — BroBot's shipped profile does not offer the tool). So both cards
carry `agentReason` and nothing else on them carries the words (M13-M18), and main's wire keeps the
field (M19-M20).

## ⚑ D · `probe:codex-approval-reason`'s verdict, pinned from `ci` (M21-M27)

## 🔴 E · 709's review — R44 only on the MEASURED shape, the permissions cleaning, Claude's stop word
## pinned by a probe, the proposal readers, the latch widened, and the policy's words (M28-M55)

⚑ The review found `agentReason` carried on command shapes whose `reason` was never measured (a
managed-network approval, a subcommand `approvalId`, a command asking for additional permissions):
M28-M31 take each condition of `theModelWroteTheReason` away. M32 carries the permissions card's
words uncleaned. M33-M36 and M40-M42 are `probe:claude-stopped-word`'s verdict, and M37-M39 put
*"was stopped"* back on the three proposal surfaces, which a Stop or a Close writes before the
provider is told. M43 widens the approval handler's latch to every answer, which only a Deny
followed by a dead stream can see. ⚑ Then measured, on the review's word: a command an exec-policy
`prompt` rule stops carries CODEX's words in `reason` (*"… requires approval: …"*) and no offered
prefix rule — M44 stops reading that absence, and M45-M55 are the probe's verdict on the new turns
(M53-M55 from round 3: Codex's retry words, and the sandbox's refusal as `sandbox-denied`'s premise).

## ⛔ What this table cannot reach

 * ⚠️ **The live probes** (`probe:codex-approval-reason`, `probe:codex-early-interrupt`) — not in
   `ci`; their reading logic is (section D and M12), and the runs' evidence is in `709`'s response.
 * ⚠️ **The shared cleaning** (`words-on-a-card.ts`) — table `700`'s rows M11-M17, M25-M33 and
   M38-M47, re-anchored there by `709` and re-verified; not duplicated here.
 * ⚠️ **The machine's own three endings** (`forceEnd`, `failTurn`, a fatal error) — unchanged by R43,
   and a finding in `709`'s response.
"""

HOST = "apps/desktop/src/main/runtime/runtime-host.ts"
MACHINE = "packages/runtime/src/internal/session-machine.ts"
CLAUDE_WORDS = "packages/runtime/src/claude/normalize.ts"
FAKE = "packages/runtime/src/fake-runtime.ts"
TRANSCRIPT = "apps/desktop/src/renderer/src/lib/transcript.ts"
DIGEST = "apps/desktop/src/main/runtime/digest.ts"
TOOLS = "apps/desktop/src/main/runtime/agent-tools.ts"
EARLY = "packages/runtime/smoke/early-interrupt-evidence.ts"
CODEX = "packages/runtime/src/codex/codex-runtime.ts"
EVENTS = "packages/runtime/src/events.ts"
PERMISSION = "packages/runtime/src/permission.ts"
REASONS = "packages/runtime/smoke/approval-reason-evidence.ts"
STOPPED = "packages/runtime/smoke/claude-stopped-evidence.ts"
PROPOSALS = "apps/desktop/src/shared/proposals.ts"
PROPOSAL_RAILS = "apps/desktop/src/main/runtime/proposal-rails.ts"
PROPOSAL_CARD = "apps/desktop/src/renderer/src/components/ProposalCard.vue"

THE_BOUND = "      await settledWithin(asked, this.interruptWaitMs)\n"
THE_COMMANDS = "      ...(agentReason === null ? {} : { agentReason }),\n"
THE_GRANTS = "\n    ...(agentReason === null ? {} : { agentReason }),\n"

MUTATIONS: list[tuple[str, list[tuple[str, str, str]]]] = [
    # ── A · `704` H-8 ─────────────────────────────────────────────────────────────────────────
    (
        "M1 · 🔴 **the ask is awaited whole again** — a Codex that never answers `turn/interrupt` "
        "holds interrupt-and-send and the queue behind it for good — killed by "
        "`an-interrupt-codex-never-answers.test.ts`",
        [(HOST, THE_BOUND, "      await asked\n")],
    ),
    (
        "M2 · ⛔ **the ask is not waited on at all** — `waitForIdle`'s five seconds are the verb's "
        "whole patience, so a Codex that answers 5.5 s after the ask loses the replacement — killed "
        "by `an-interrupt-codex-never-answers.test.ts`",
        [(HOST, THE_BOUND, "")],
    ),
    # ── B · R43 ───────────────────────────────────────────────────────────────────────────────
    (
        "M3 · 🔴 **the relabel is back** — a turn the provider completed after a stop was asked is "
        "recorded `interrupted` — killed by `the-providers-word-is-the-ledgers.test.ts`",
        [
            (
                MACHINE,
                # ⚑ **F080 · re-anchored in place, not retired** — F080 moved the ending into `sayTheEnding`; the relabel goes back in where the outcome is said.
                # ⚑ **F080 · re-anchored in place, not retired** — F080's follow-up keeps the ended turn to mark a joined burst's ending; the relabel goes back in where the outcome is said.
                # ⚑ **Codex key refusal · re-anchored in place, not retired** — the ending also carries a refused login (Codex's unauthorized); the relabel goes back in where the outcome is said.
                "    const ended = this.takeTurn()\n    this.sayTheEnding(providerOutcome, errorMessage, limit, endingMarksOf(ended), refused)\n",
                "    const relabelled: TurnOutcome = this.turn?.interruptRequested ? 'interrupted' : providerOutcome\n    const ended = this.takeTurn()\n    this.sayTheEnding(relabelled, errorMessage, limit, endingMarksOf(ended), refused)\n",
            )
        ],
    ),
    (
        "M4 · 🔴 **Claude's own word for a stop is not read** — a Cancel's `aborted_tools` reads as "
        "a fault, with an error — killed by `the-providers-word-is-the-ledgers.test.ts`",
        [
            (
                CLAUDE_WORDS,
                "  if (STOPPED.has(readString(message, 'terminal_reason'))) return { outcome: 'interrupted' }\n",
                "",
            )
        ],
    ),
    (
        "M5 · ⛔ **`aborted_tools` is not a stop** — the mapping reads a Cancel's result as a fault "
        "(on a Stop inside a tool the product's forced ending comes first, measured, so only a result "
        "that beat the ack would be misread) — killed by `the-providers-word-is-the-ledgers.test.ts` "
        "on the probe's fixture",
        [
            (
                CLAUDE_WORDS,
                "new Set(['aborted_streaming', 'aborted_tools'])",
                "new Set(['aborted_streaming'])",
            )
        ],
    ),
    (
        "M6 · ⛔ **`aborted_streaming` is not a stop** — the mapping reads a stopped stream's result as "
        "a fault (live, the product's forced ending comes first, measured, so only a result that beat "
        "the ack would be misread) — killed by `the-providers-word-is-the-ledgers.test.ts` on the "
        "probe's fixture",
        [
            (
                CLAUDE_WORDS,
                "new Set(['aborted_streaming', 'aborted_tools'])",
                "new Set(['aborted_tools'])",
            )
        ],
    ),
    (
        "M7 · 🔴 **the Fake says `completed` for a turn it stopped** — a double that lets a reader "
        "confusing the ask with the ending ship green — killed by "
        "`the-providers-word-is-the-ledgers.test.ts`",
        [
            (
                FAKE,
                "    this.machine.completeTurn(this.stoppedTurn === turnId ? 'interrupted' : 'completed')\n",
                "    this.machine.completeTurn('completed')\n",
            )
        ],
    ),
    (
        "M8 · ⛔ **the Fake never records the stop** — the same ending, one line earlier — killed by "
        "`the-providers-word-is-the-ledgers.test.ts`",
        [(FAKE, "    this.stoppedTurn = this.machine.activeTurnId\n", "")],
    ),
    (
        "M9 · 🔴 **the transcript draws the ask as a stop** — *stopped by …* above a turn the "
        "provider completed — killed by `the-interruption-that-looks-like-a-fault.test.ts`",
        [
            (
                # ⚑ **Re-anchored in place by `737`** (`734` F-2): the ask's words moved into the ONE function
                # that names its asker (`stop-unanswered.ts`' `askedToStopSays`); the row still says *stopped*.
                "apps/desktop/src/renderer/src/lib/stop-unanswered.ts",
                "`${ASKED_TO_STOP} by ${whoAskedItToStop(fact, identities)}`",
                "`stopped by ${whoAskedItToStop(fact, identities)}`",
            )
        ],
    ),
    (
        "M10 · 🔴 **the digest counts the ask as a stop** — *Work was stopped* beside *1 completed* — "
        "killed by `a-person-who-never-answered.test.ts`",
        [
            (
                DIGEST,
                "      return `Work was ${ASKED_TO_STOP} ${many(group.count, 'time', 'times')}.`",
                "      return `Work was stopped ${many(group.count, 'time', 'times')}.`",
            )
        ],
    ),
    (
        "M11 · ⛔ **a question's line says its work was stopped** — written at the ask, before the "
        "provider answers — killed by `the-word-for-a-question-nobody-stopped.test.ts`",
        [
            (
                TOOLS,
                "`the work it was raised in was ${ASKED_TO_STOP}, so it was never answered",
                "`the work it was raised in was stopped, so it was never answered",
            )
        ],
    ),
    (
        "M12 · 🔴 **the early-interrupt probe cannot see a rename** — the product's word is never "
        "compared with Codex's — killed by `codex-early-interrupt-evidence.test.ts`",
        [(EARLY, "        turn.providerStatus !== turn.productWord,\n", "        false,\n")],
    ),
    # ── C · R44 ───────────────────────────────────────────────────────────────────────────────
    (
        "M13 · 🔴 **the command card drops the agent's words** — `704`'s shape: the model's question "
        "reaches no card at all — killed by `codex-runtime.test.ts`",
        [(CODEX, THE_COMMANDS, "")],
    ),
    (
        "M14 · 🔴 **the permissions card drops the agent's words** — killed by `codex-runtime.test.ts`",
        [(CODEX, THE_GRANTS, "\n")],
    ),
    (
        "M15 · ⛔ **any card's reason is carried as the agent's** — a file card's (whose author is "
        "not established) and every unmeasured command shape's — killed by `codex-runtime.test.ts`",
        [
            (
                CODEX,
                "      kind === 'command' && theModelWroteTheReason(params)\n",
                "      true\n",
            )
        ],
    ),
    (
        "M16 · ⛔ **the agent's words are carried raw** — a terminal escape and a reordering mark "
        "reach the card — killed by `codex-runtime.test.ts`",
        [
            (
                CODEX,
                "wordsForACard(isRecord(params) ? params['reason'] : undefined)",
                "(isRecord(params) && typeof params['reason'] === 'string' ? params['reason'] : null)",
            )
        ],
    ),
    (
        "M17 · 🔴 **the permissions card's headline is the model's reason again** — unlabelled, "
        "the sentence a person reads first — killed by `codex-runtime.test.ts`",
        [
            (
                CODEX,
                "    const prompt = isPermission ? THE_AGENT_ASKS_FOR_ACCESS : questionText(params) || method\n",
                "    const prompt = readString(params, 'reason') || questionText(params) || method\n",
            )
        ],
    ),
    (
        "M18 · 🔴 **the model's reason rides `permission.reason` again** — the field with no author, "
        "which Home drew as the first line of what a grant authorizes — killed by "
        "`codex-runtime.test.ts`",
        [
            (
                CODEX,
                "    cwd: readOptionalString(p, 'cwd'),\n    ...(agentReason",
                "    cwd: readOptionalString(p, 'cwd'),\n    reason: readOptionalString(p, 'reason'),\n    ...(agentReason",
            )
        ],
    ),
    (
        "M19 · 🔴 **main's wire strips a command card's `agentReason`** — the schema does not name "
        "it, so it never reaches the ledger or a window — killed by "
        "`the-agents-words-on-a-card.test.ts`",
        # ⚑ **723 · re-anchored in place, not retired** — 723's `mcpToolCall` and `cancelStopsNothing` now follow `agentReason` in the schema; the row still strips `agentReason` at the wire
        [(EVENTS, "  agentReason: z.string().optional(),\n  /**\n   * 🔴 **723 · R80 — the provider asks before an EXTERNAL MCP server's tool runs: which server,", "  /**\n   * 🔴 **723 · R80 — the provider asks before an EXTERNAL MCP server's tool runs: which server,")],
    ),
    (
        "M20 · 🔴 **main's wire strips a permissions card's `agentReason`** — killed by "
        "`the-agents-words-on-a-card.test.ts`",
        [(PERMISSION, "  agentReason: z.string().optional(),\n", "")],
    ),
    # ── D · the probe's verdict ───────────────────────────────────────────────────────────────
    (
        "M21 · 🔴 **any reason is the model's** — a sentence Codex wrote would be judged the agent's "
        "— killed by `codex-approval-reason-evidence.test.ts`",
        [
            (
                REASONS,
                "  return ask.modelWrote !== null && ask.rawReason === ask.modelWrote ? 'the-model' : 'not-the-model'\n",
                "  return 'the-model'\n",
            )
        ],
    ),
    (
        "M22 · ⛔ **a `null` reason counts as one** — killed by "
        "`codex-approval-reason-evidence.test.ts`",
        [
            (
                REASONS,
                "  if (ask.rawReason === undefined || ask.rawReason === null) return 'absent'\n",
                "  if (ask.rawReason === undefined) return 'absent'\n",
            )
        ],
    ),
    (
        "M23 · 🔴 **not-offered is read off a silence** — a request that did not arrive in time would "
        "be a measurement — killed by `codex-approval-reason-evidence.test.ts`",
        [
            (
                REASONS,
                "  return ask.method === null && ask.toolAnswer !== null && NOT_OFFERED.test(ask.toolAnswer)\n",
                "  return ask.method === null\n",
            )
        ],
    ),
    (
        "M24 · 🔴 **words anywhere else on the card are not looked for** — a card carrying the "
        "words as `agentReason` AND as its headline or `permission.reason` would pass — killed by "
        "`codex-approval-reason-evidence.test.ts`",
        [
            (
                REASONS,
                "  return ask.card.agentReason === words && !ask.card.elsewhere.some((one) => one.includes(words))\n",
                "  return ask.card.agentReason === words\n",
            )
        ],
    ),
    (
        "M25 · ⛔ **the control may grow agent words** — ⚑ RE-AIMED IN PLACE by 709's review: the "
        "`misattributed` check holds the control now (its own line went dead and was removed), so "
        "the row takes that check away, and a policy's words pass as the agent's too — killed by "
        "`codex-approval-reason-evidence.test.ts`",
        [
            (
                REASONS,
                "  if (misattributed.length > 0) return { verdict: 'misattributed', turns: misattributed }\n",
                "",
            )
        ],
    ),
    (
        "M26 · 🔴 **a Codex bump that moves the author passes** — a command reason that is no longer "
        "the model's is judged by the rule it no longer fits — killed by "
        "`codex-approval-reason-evidence.test.ts`",
        [(REASONS, "  if (whoWroteIt(justified) !== 'the-model') {", "  if (false) {")],
    ),
    (
        "M27 · 🔴 **the Cancel's two words are never compared** — a product word that is not Codex's "
        "would pass — killed by `codex-approval-reason-evidence.test.ts`",
        [(REASONS, "  if (seen.providerStatus !== seen.productWord) {", "  if (false) {")],
    ),
    # ── E · 709's review ─────────────────────────────────────────────────────────────────────
    (
        "M28 · 🔴 **a command-LESS approval carries its reason as the agent's** — the managed-network "
        "shape, whose reason Codex words — killed by `codex-runtime.test.ts`",
        [(CODEX, "    readString(params, 'command') !== '' &&\n", "")],
    ),
    (
        "M29 · 🔴 **a managed-network approval carries its reason as the agent's** — killed by "
        "`codex-runtime.test.ts`",
        [(CODEX, "    absent('networkApprovalContext') &&\n", "")],
    ),
    (
        "M30 · ⛔ **a subcommand approval carries its reason as the agent's** — killed by "
        "`codex-runtime.test.ts`",
        [(CODEX, "    absent('approvalId') &&\n", "")],
    ),
    (
        "M31 · ⛔ **a command asking for additional permissions carries its reason as the agent's** — "
        "killed by `codex-runtime.test.ts`",
        [(CODEX, "    absent('approvalId') &&\n    absent('additionalPermissions')\n", "    absent('approvalId')\n")],
    ),
    (
        "M32 · ⛔ **a permissions card's agent words are carried raw** — a terminal escape and a "
        "reordering mark reach the card — killed by `codex-runtime.test.ts`",
        [
            (
                CODEX,
                "  const agentReason = wordsForACard(p['reason'])\n",
                "  const agentReason = typeof p['reason'] === 'string' ? p['reason'] : null\n",
            )
        ],
    ),
    (
        "M33 · 🔴 **a CLI bump that moves Claude's stop word passes** — killed by "
        "`claude-stopped-evidence.test.ts`",
        [
            (
                STOPPED,
                "  const moved = seen.filter((one) => one.result?.terminalReason !== CLAUDE_SAYS[one.arm])\n",
                "  const moved: StopSeen[] = []\n",
            )
        ],
    ),
    (
        "M34 · 🔴 **a Cancel drawn as a fault passes, so long as its word is right** — the error "
        "beside it is not read — killed by `claude-stopped-evidence.test.ts`",
        [
            (
                STOPPED,
                "      return one.productWords.join(',') !== expected || one.productErrors > 0\n",
                "      return one.productWords.join(',') !== expected\n",
            )
        ],
    ),
    (
        "M35 · ⛔ **the measured Cancel word is wrong** — a probe run on today's CLI would read `moved` "
        "— killed by `claude-stopped-evidence.test.ts`",
        [(STOPPED, "  'cancelled-card': 'aborted_tools',\n", "  'cancelled-card': 'aborted_streaming',\n")],
    ),
    (
        "M36 · ⛔ **a turn with no result from Claude counts as measured** — killed by "
        "`claude-stopped-evidence.test.ts`",
        [(STOPPED, "    if (one.result === null) {", "    if (false) {")],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-016a, bd70d693):** The digest's proposal line lived in
        # shared/proposals.ts, which D-016 deleted ('Proposals go end to end'). The killer
        # a-withdrawn-proposal-says-the-ask.render.test.ts is deleted too. ASKED_TO_STOP itself
        # survives in shared/how-work-stopped and is guarded by other rows on the surfaces that
        # still exist. Its anchor is left stale, so the census records it retired.
        "M37 · 🔴 **the digest's proposal line says the work was stopped** — written by a Stop or a "
        "Close before the provider is told — "
        "killed by `a-withdrawn-proposal-says-the-ask.render.test.ts`",
        [
            (
                PROPOSALS,
                "  withdrawn: `the work that proposed it was ${ASKED_TO_STOP} before anybody decided`,",
                "  withdrawn: 'the work that proposed it was stopped before anybody decided',",
            )
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-016a, bd70d693):** proposal-rails.ts was deleted by D-016
        # ('Proposals go end to end'), so there is no proposer to be told its work was stopped. The
        # killer test is deleted. The 'asked to stop, not stopped' wording still holds on the
        # remaining surfaces through how-work-stopped. Its anchor is left stale, so the census
        # records it retired.
        "M38 · 🔴 **the proposer is told its work was stopped** — killed by "
        "`a-withdrawn-proposal-says-the-ask.render.test.ts`",
        [
            (
                PROPOSAL_RAILS,
                "`the work that proposed this was ${ASKED_TO_STOP} before anybody decided,",
                "`the work that proposed this was stopped before anybody decided,",
            )
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-016a, bd70d693):** ProposalCard.vue was deleted by D-016
        # (the card and the project rooms go). The killer
        # a-withdrawn-proposal-says-the-ask.render.test.ts is deleted, and the card's 'never
        # decided' sentence has no other home. Its anchor is left stale, so the census records it
        # retired.
        "M39 · 🔴 **the card tells a person the work was stopped** — killed by "
        "`a-withdrawn-proposal-says-the-ask.render.test.ts`",
        [
            (
                PROPOSAL_CARD,
                "`The work this belonged to was ${ASKED_TO_STOP}, so this was never decided`",
                "`The work this belonged to was stopped, so this was never decided`",
            )
        ],
    ),
    (
        "M40 · ⛔ **a Stop asked of a turn already over counts as a stop** — a turn that completed "
        "before its stop reads as a CLI bump (`moved`) — killed by `claude-stopped-evidence.test.ts`",
        [(STOPPED, "    if (one.arm !== 'finishes' && one.openAtStop !== true) {", "    if (false) {")],
    ),
    (
        "M41 · ⛔ **an arm the product ended first counts as read** — the verdict claims the mapping "
        "was exercised on a Stop whose word was the product's own — killed by "
        "`claude-stopped-evidence.test.ts`",
        [
            (
                STOPPED,
                "  const read = seen.filter((one) => !one.endedBeforeClaudesResult).map((one) => one.arm)\n",
                "  const read = seen.map((one) => one.arm)\n",
            )
        ],
    ),
    (
        "M42 · ⛔ **a run where no stop was read passes** — killed by `claude-stopped-evidence.test.ts`",
        [(STOPPED, "  if (!read.some((arm) => arm !== 'finishes')) {", "  if (false) {")],
    ),
    (
        "M43 · ⛔ **the approval handler latches on every answer** — a Deny, then the stream ends, "
        "reads `it-was-stopped-and-it-faulted` though nobody asked for a stop — killed by "
        "`codex-runtime.test.ts` (the Deny control)",
        [
            (
                CODEX,
                "    if (decision.outcome === 'cancel') this.machine.requestInterrupt()\n    this.machine.endWait()\n",
                "    this.machine.requestInterrupt()\n    this.machine.endWait()\n",
            )
        ],
    ),
    (
        "M44 · 🔴 **a command a POLICY rule stopped carries Codex's words as the agent's** — the "
        "offered prefix rule is not read — killed by `codex-runtime.test.ts`",
        [(CODEX, "    Array.isArray(amendment) &&\n", "")],
    ),
    (
        "M45 · 🔴 **the probe never looks for a policy's words under the agent's name** — ⚠️ NARROWED "
        "IN PLACE by 709's round-3 review to the policy turns alone (it also took `denied` away, which "
        "M53 now owns) — killed by `codex-approval-reason-evidence.test.ts`",
        [
            (
                REASONS,
                "  const misattributed = [justified, bare, enabled, compound, denied, ...policy, shipped]\n",
                "  const misattributed = [justified, bare, enabled, compound, denied, shipped]\n",
            )
        ],
    ),
    (
        "M46 · ⛔ **a Codex bump that hands a policy-stopped command the model's words passes** — "
        "killed by `codex-approval-reason-evidence.test.ts`",
        [(REASONS, "  if (policyMoved.length > 0) {", "  if (false) {")],
    ),
    (
        "M47 · ⛔ **`sandbox-denied` read off a silence** — a request that did not arrive in time, "
        "or a write the sandbox never refused, would read `not-asked` — ⚠️ ANCHOR CORRECTED IN PLACE "
        "by 709's round-3 review, which added the refusal to the premise — killed by "
        "`codex-approval-reason-evidence.test.ts`",
        [(REASONS, "  if (denied.method === null && !sandboxRefused(denied)) {", "  if (false) {")],
    ),
    (
        "M48 · ⛔ **a model's words a policy overrode may land on the card** — killed by "
        "`codex-approval-reason-evidence.test.ts`",
        [
            (
                REASONS,
                "      ask.card.elsewhere.some((one) => one.includes(words))\n    ) {\n      unlabelled.push(ask.turn)\n",
                "      false\n    ) {\n      unlabelled.push(ask.turn)\n",
            )
        ],
    ),
    (
        "M49 · ⛔ **a policy turn that raised nothing counts as measured** — killed by "
        "`codex-approval-reason-evidence.test.ts`",
        [
            (
                REASONS,
                "  for (const ask of [justified, bare, enabled, compound, ...policy]) {\n",
                "  for (const ask of [justified, bare, enabled, compound]) {\n",
            )
        ],
    ),
    (
        "M50 · ⛔ **a compound command's reason may move author unnoticed** — killed by "
        "`codex-approval-reason-evidence.test.ts`",
        [(REASONS, "  if (whoWroteIt(compound) !== 'the-model') {", "  if (false) {")],
    ),
    (
        "M51 · ⛔ **the verdict says Codex never asks to retry a sandboxed command, whatever it did** — "
        "killed by `codex-approval-reason-evidence.test.ts`",
        [
            (
                REASONS,
                "    sandboxRetry: denied.method === null ? 'not-asked' : 'asked',\n",
                "    sandboxRetry: 'not-asked',\n",
            )
        ],
    ),
    (
        "M52 · ⛔ **a retry request with no card counts as measured** — killed by "
        "`codex-approval-reason-evidence.test.ts`",
        [(REASONS, "  if (denied.method !== null && denied.card === null) {", "  if (false) {")],
    ),
    (
        "M53 · ⛔ **the probe never looks for Codex's retry words under the agent's name** — the "
        "`sandbox-denied` turn, if Codex ever asks — killed by `codex-approval-reason-evidence.test.ts`",
        [
            (
                REASONS,
                "  const misattributed = [justified, bare, enabled, compound, denied, ...policy, shipped]\n",
                "  const misattributed = [justified, bare, enabled, compound, ...policy, shipped]\n",
            )
        ],
    ),
    (
        "M54 · ⛔ **any answer counts as a refusal, whatever its exit code** — a refusal the command "
        "recovered from reads as one — killed by `codex-approval-reason-evidence.test.ts`",
        [(REASONS, "    FAILED.test(ask.toolAnswer) &&\n", "")],
    ),
    (
        "M55 · ⛔ **any failure counts as the sandbox's refusal** — a command that failed for another "
        "reason reads as one — killed by `codex-approval-reason-evidence.test.ts`",
        [(REASONS, "    FAILED.test(ask.toolAnswer) &&\n    REFUSED.test(ask.toolAnswer)\n", "    FAILED.test(ask.toolAnswer)\n")],
    ),
]
