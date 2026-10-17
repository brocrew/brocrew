import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { ASKED_TO_STOP, howWorkStopped } from '../src/shared/how-work-stopped'
import { whatThisAnswerDoes } from '../src/renderer/src/lib/user-input-offer'
import { permissionDecisionFor } from '../src/renderer/src/lib/permission-offer'

/**
 * # 🔴 492 · Make the word mean one thing (`HO-032` §1, `483`'s repair 2)
 *
 * ## ⛔ The ruling, and the half of it that is not about the adapter
 *
 * ⚠️ **The PO ruled option 1 — send the interrupt** — and refused the alternative in one sentence:
 * *"Deny and Cancel do the same thing on that door, and the only difference is a label that is
 * false."* ⛔ The adapter half is measured where it belongs, in
 * `packages/runtime/test/codex-runtime.test.ts`, against the `FakeTransport`, and against the real
 * pinned app-server at `pnpm run probe:codex-cancel-interrupt`.
 *
 * ## ⚑ What THIS file owns
 *
 *  - **§1 · one act, one claim.** A person's Cancel and `interrupt_agent` now perform the same act,
 *    and HO-030 §2's argument is about habit: *"a sentence that is true on one surface and absent on
 *    two teaches him that the sentence is optional."* ⛔ Two spellings of one act is the same defect
 *    one step in. The claim is {@link ASKED_TO_STOP}, shared as bytes, and a **paraphrase fails**.
 *  - **§2 · the trap, from the source.** `HO-032` §2.1: *"the person pressing Cancel turn IS the
 *    person being asked"*, and `INTERRUPT_RAILS` refuses exactly that state. ⚑ The behaviour is
 *    measured on one card in one instant in `the-interruption-that-looks-like-a-fault.test.ts` §3;
 *    here is the SEARCH SHAPE that makes *"it never reaches the rail"* a negative worth believing.
 *  - **§3 · command approvals did not move**, which the brief asked to be proven rather than said.
 *  - **§4 · what this door deliberately does NOT do** — settle anybody else's card.
 *
 * ⚠️ **No sentence is spelled twice here.** Every expectation is read from the module that owns it,
 * which is `what-a-card-says-a-press-does.test.ts`'s own rule and the reason a copy census cannot
 * become the copy.
 */

const here = dirname(fileURLToPath(import.meta.url))
const DESKTOP = join(here, '../src')
const RUNTIME = join(here, '../../../packages/runtime/src')

/** ⛔ Prose is not code — a docblock quoting a call it retired must not answer a source census. */
const codeOnly = (source: string): string =>
  source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

const read = (path: string): string => readFileSync(path, 'utf8')

/**
 * ⚑ **One method's body, sliced by its own signature and the dedent that ends it.** The shape
 * `the-interruption-that-looks-like-a-fault.test.ts` uses for `askTheWorkToStop`, so a census about
 * one door cannot be satisfied by a neighbour.
 */
const bodyOf = (whole: string, signature: string): string => {
  // ⛔ **Stripped BEFORE it is sliced.** A docblock naming the call a method deliberately does not
  // make would answer a census about that method — *a source census must strip prose before it
  // asserts*, and this dispatch's own comments name `settleRequests` twice to say it is not called.
  const source = codeOnly(whole)
  const at = source.indexOf(signature)
  expect(at, `${signature} was renamed or removed`).toBeGreaterThan(0)
  const end = source.indexOf('\n  }', at)
  expect(end, `${signature} has no closing brace at method depth`).toBeGreaterThan(at)
  return source.slice(at, end)
}

describe('492 · make the word mean one thing', () => {
  // ─────────────────────────────────────────────────────────────────────────────────────────────
  // §1 · one act, one claim — and a paraphrase fails
  // ─────────────────────────────────────────────────────────────────────────────────────────────

  describe('§1 · the sentence, from one derivation, for both doors', () => {
    it('🔴 the card says what the press does, and it is the claim interrupt_agent makes', () => {
      const says = whatThisAnswerDoes({
        kind: 'permission',
        label: 'Cancel turn',
        decision: permissionDecisionFor('cancel'),
      })
      // ⛔ **The CLAIM**, shared as bytes with the verb that performs this act for a model.
      expect(says).toContain(ASKED_TO_STOP)
      // ⚑ **And the scope survived the repair.** `478` F3's whole point is that a person choosing
      // between Deny and Cancel is choosing between one thing and everything; the claim moved and
      // the scope did not.
      expect(says).toContain('the whole turn')
      expect(says).toContain('this request is refused')
    })

    it('⛔ …and every paraphrase of it fails, including the one this sentence used to be', () => {
      const says = whatThisAnswerDoes({
        kind: 'permission',
        label: 'Cancel turn',
        decision: permissionDecisionFor('cancel'),
      })
      // 🔴 **`asked`, never `stopped`** — `RuntimeHost.interruptAgent`'s ruling, which this card is
      // now covered by: *"a tool that answered `stopped` would be false on one provider and would
      // hang on the other."* ⛔ Each of these is a sentence somebody would reasonably write next,
      // and each of them claims the turn is already over.
      for (const paraphrase of [
        'is interrupted',
        'was interrupted',
        'is stopped',
        'was stopped',
        'ends the turn',
        'the turn ends',
      ]) {
        expect(says, `the sentence claims the turn is already over: ${paraphrase}`).not.toContain(
          paraphrase,
        )
      }
      // ⚠️ **The control, and standing rule 12 asks for one that plants TWO.** Both halves of the
      // check must be able to fire, or *"no paraphrase is present"* is a loop over a list that
      // could not have matched anything.
      const planted = 'the whole turn is interrupted, and this request is refused'
      expect(planted).toContain('is interrupted')
      expect('the agent was stopped').toContain('was stopped')
    })

    it('🔴 both composers read the ONE constant, and neither spells the claim itself', () => {
      const card = read(join(DESKTOP, 'renderer/src/lib/user-input-offer.ts'))
      const verb = read(join(DESKTOP, 'main/runtime/agent-tools.ts'))
      // ⛔ **The import, and then the CALL** — an unused import passes an import census (standing).
      for (const [name, source] of [
        ['user-input-offer.ts', card],
        ['agent-tools.ts', verb],
      ] as const) {
        expect(source, `${name} imports the claim`).toContain('ASKED_TO_STOP')
        expect(codeOnly(source), `${name} composes from it`).toContain('${ASKED_TO_STOP}')
      }
      // 🔴 **And neither writes the words down.** A second spelling is the thing this constant
      // exists to prevent, and it would be invisible to every value assertion above — both would
      // still say *asked to stop*, from two places free to drift apart.
      for (const [name, source] of [
        ['user-input-offer.ts', card],
        ['agent-tools.ts', verb],
      ] as const) {
        expect(codeOnly(source), `${name} spells the claim a second time`).not.toContain(
          `'${ASKED_TO_STOP}'`,
        )
        expect(codeOnly(source), `${name} spells the claim a second time`).not.toContain(
          `"${ASKED_TO_STOP}"`,
        )
      }
      // ⚠️ **The control**: the stripper really did leave the code, so the two negatives above are
      // about absent bytes rather than an empty string.
      expect(codeOnly(card)).toContain('PERMISSION_EFFECTS')
      expect(codeOnly(verb)).toContain("name: 'interrupt_agent'")
    })

    it('⚑ one definition, and every other mention of the claim is prose', () => {
      const home = read(join(DESKTOP, 'shared/how-work-stopped.ts'))
      const declarations = codeOnly(home)
        .split('\n')
        .filter((line) => line.includes(`= '${ASKED_TO_STOP}'`))
      expect(declarations).toHaveLength(1)
      expect(declarations[0]).toContain('export const ASKED_TO_STOP')
    })
  })

  // ─────────────────────────────────────────────────────────────────────────────────────────────
  // §2 · the person's own Cancel does not travel the interrupt door
  // ─────────────────────────────────────────────────────────────────────────────────────────────

  describe('§2 · the trap, and the search shape that makes the negative worth believing', () => {
    /**
     * ⛔ **What shape of answer this search COULD have found** (standing rule 4). A person's
     * `PermissionDecision` is opaque data from the moment it leaves the window, so for a cancel to
     * reach `INTERRUPT_RAILS` one of exactly three things would have to be true:
     *
     *  1. the main process branches on the outcome and routes `cancel` somewhere `deny` does not go;
     *  2. `respondPermission`'s own path calls one of the interrupt symbols — its body, and since `742`
     *     the bound it answers through and what follows a taken decision; or
     *  3. something downstream of it re-enters the host on seeing the decision.
     *
     * ⚑ **Each has a positive control below**, so an empty result is a measurement.
     */
    const host = read(join(DESKTOP, 'main/runtime/runtime-host.ts'))

    it('🔴 the host reads the outcome in ONE place, and it routes nowhere — cancel and deny reach the same code', () => {
      // ⚑ **723 · R81 — re-aimed, not stripped** (standing rule 26). ⛔ This said *"the host never
      // reads the outcome"*, and since `723` it reads it once: `respondPermission` marks the row of a
      // cancel on a card whose frame named no turn (`stopsNothing`), so no fold reads that press as
      // an ask. ⚑ **What the census exists for is unchanged** — shape 1 above, a branch that ROUTES a
      // cancel somewhere a deny does not go. So it pins that ONE read, BY ITS TEXT, inside the body the
      // next test proves reaches no interrupt symbol — and that there is no other.
      const main = codeOnly(host)
      const THE_ONE_READ =
        "decision.outcome === 'cancel' && session.cancelsThatStopNothing.has(requestId)"
      expect(main.split(THE_ONE_READ), 'the R81 read, once').toHaveLength(2)
      // ⚑ **742 · re-aimed, not stripped** (standing rule 26): the door's work after the answer moved
      // into `aPermissionWasTaken`, so a decision the provider takes after the bound is recorded the
      // same way — and the door still reaches it.
      expect(bodyOf(host, 'async respondPermission(')).toContain('this.aPermissionWasTaken(')
      expect(codeOnly(bodyOf(host, 'private aPermissionWasTaken('))).toContain(THE_ONE_READ)
      const elsewhere = main.split(THE_ONE_READ).join('')
      for (const spelling of ["'cancel'", '"cancel"', "=== 'cancel'"]) {
        expect(elsewhere, `the host branches on ${spelling}`).not.toContain(spelling)
      }
      // ⚠️ **The control, and it plants TWO** — the word is all over this file as identifiers, so
      // a sweep that found nothing because it was reading nothing would be caught here.
      expect(main).toContain('cancelQueuedMessage')
      expect(main).toContain('cancelLaunch')
    })

    it('⛔ respondPermission asks no interrupt rail — and the same search finds the doors that do', () => {
      // ⚑ **742 · the answer's path is THREE bodies now** — the door, the bound it answers through,
      // and what follows a taken decision — so the sweep reads all three, and asserts the door calls
      // the other two (else it would sweep methods the door no longer reaches).
      const door = bodyOf(host, 'async respondPermission(')
      expect(door).toContain('this.answerTheProvider(')
      expect(door).toContain('this.aPermissionWasTaken(')
      const answering = [
        door,
        bodyOf(host, 'private answerTheProvider('),
        bodyOf(host, 'private aPermissionWasTaken('),
      ].join('\n')
      // ⚑ **D-016 · commit 7 · R1 — the entitlement is a method of its own** (`mayInterrupt`, asked by
      // the door and by the resolver of its address), so the sweep names it beside the predicate it
      // asks.
      const SYMBOLS = [
        'admitInterrupt(',
        'askTheWorkToStop(',
        'mayInterrupt(',
        'mayInterruptDownTheChain(',
        'handle.interrupt()',
        'INTERRUPT_RAILS',
      ]
      for (const symbol of SYMBOLS) {
        expect(answering, `respondPermission reaches ${symbol}`).not.toContain(symbol)
      }
      // 🔴 **The positive control, one method over.** `interruptAgent` is the ONLY production caller
      // of `admitInterrupt`, and its body carries three of the six — so the sweep above is a sweep.
      const interrupting = bodyOf(host, 'async interruptAgent(')
      expect(interrupting).toContain('admitInterrupt(')
      // ⚑ **D-014** — the entitlement is the chain predicate now; no grant is read for an interrupt.
      // ⚑ **D-016 · commit 7 · R1** — asked through `mayInterrupt`, whose body carries the predicate.
      expect(interrupting).toContain('this.mayInterrupt(')
      expect(bodyOf(host, 'private mayInterrupt(')).toContain('mayInterruptDownTheChain(')
      expect(interrupting).toContain('askTheWorkToStop(')
      // ⚑ **And the one line that reaches the provider is still one line**, in the method that
      // records the ask — `397`'s structural claim, re-read here because `492` added a second way to
      // ask a provider to stop and it is deliberately NOT in this file.
      expect(codeOnly(host).split('session.handle.interrupt()')).toHaveLength(2)
    })

    it('⚠️ and the rail it would have met is reachable from exactly one door', () => {
      const rails = read(join(DESKTOP, 'main/runtime/interrupt-rails.ts'))
      expect(rails).toContain("'a-person-is-being-asked'")
      // ⛔ **One caller, and the file it is in is the host** — so *"the person's cancel does not meet
      // the rail"* is a property of the roster and not of one method's body.
      // ⚑ **Two since a held message may ask the turn it waits behind to stop** — both doors that
      // stop a turn on an agent's ask, and neither is the person's cancel.
      const callers = codeOnly(host).split('admitInterrupt(')
      expect(callers, 'admitInterrupt has exactly two call sites in the host').toHaveLength(3)
      expect(bodyOf(host, 'private stopTheTurnItWaitsBehind(')).toContain('admitInterrupt(')
      const tools = codeOnly(read(join(DESKTOP, 'main/runtime/agent-tools.ts')))
      expect(tools.split('host.interruptAgent(')).toHaveLength(2)
    })

    it('⛔ and the reading a cancelled turn leaves is the one this dispatch reports, not repairs', () => {
      // 🔴 **A person really stopped the work and no row says so.** `howWorkStopped` is pure and is
      // handed one turn's rows; a cancel writes `user_decision` and never `work_interrupted`, so the
      // honest reading of a turn that a person ended is `it-was-stopped` with nobody named.
      expect(howWorkStopped([{ event: { type: 'turn', state: 'interrupted' } }] as never)).toEqual({
        how: 'it-was-stopped',
        who: null,
        asker: null,
      })
      // ⚑ **The control one fact over**: the row a Stop writes is what fills that field in, so the
      // `null` above is an absent row rather than a fold that cannot answer.
      expect(
        howWorkStopped([
          { event: { type: 'work_interrupted', by: 'a-person' } },
          { event: { type: 'turn', state: 'interrupted' } },
        ] as never),
      ).toEqual({ how: 'it-was-stopped', who: 'a-person', asker: null })
    })
  })

  // ─────────────────────────────────────────────────────────────────────────────────────────────
  // §3 · command approvals did not move, and §4 · what this door does not do
  // ─────────────────────────────────────────────────────────────────────────────────────────────

  describe('§3 · the doors this dispatch did not touch', () => {
    const codex = read(join(RUNTIME, 'codex/codex-runtime.ts'))

    it('🔴 736 · R97 — the latch is still there for every door whose Cancel asks a stop, and the elicitation door has none', () => {
      const answering = bodyOf(codex, 'async respondPermission(')
      // ⛔ **Still exactly one latch**, and still above the wire write — which is what makes a
      // command or file approval's cancel byte-identical to what `483` measured. ⚑ **720: it skips
      // the elicitation**, whose Cancel asks no stop (below).
      expect(answering.split('this.machine.requestInterrupt()')).toHaveLength(2)
      const latch = answering.indexOf(
        "if (decision.outcome === 'cancel' && state.kind.kind !== 'elicitation') {",
      )
      expect(latch, 'the latch is here, and it skips the elicitation').toBeGreaterThan(0)
      expect(answering).toContain('decision: codexDecision(decision)')
      expect(latch, 'the latch must still precede the wire write').toBeLessThan(
        answering.indexOf('decision: codexDecision(decision)'),
      )
      // 🔴 **736 · R97 — the elicitation door latches NOTHING and asks NOTHING**: its Cancel is the
      // provider's `{action:'cancel'}` and the turn runs on, as the Codex terminal's Esc does.
      // ⛔ On `main`: a Cancel whose frame named the running turn latched it here
      // (`if (theCardsTurn !== '' && theCardsTurn === this.currentTurn?.providerTurnId)`) and sent
      // `turn/interrupt` through `askTheTurnToStop` (R74).
      const eliciting = bodyOf(codex, 'private async handleExternalMcpElicitation(')
      expect(eliciting).not.toContain('theCardsTurn')
      expect(eliciting).not.toContain('requestInterrupt(')
      expect(eliciting).not.toContain('askTheTurnToStop(')
      expect(eliciting).not.toContain('sendInterruptRpc(')
      // ⚑ **…over a slice that reaches past the wait**, where the latch and the ask used to sit — so
      // the negatives above are about the whole handler, not a slice cut short.
      expect(eliciting).toContain('await reservation.response')
      expect(eliciting).toContain('this.machine.endWait()')
      // ⚑ **And the control, one door over**: the agent-tool door still ASKS (492), after its result.
      expect(bodyOf(codex, 'private async handleAgentToolCall(')).toContain(
        'await this.askTheTurnToStop(',
      )
    })

    it('🔴 720 · R71 — …and the latch is ABOVE the agent-tool arm now, so that door latches too', () => {
      const answering = bodyOf(codex, 'async respondPermission(')
      const arm = answering.indexOf("if (state.kind.kind === 'agentTool') {")
      const latch = answering.indexOf(
        "if (decision.outcome === 'cancel' && state.kind.kind !== 'elicitation') {",
      )
      expect(arm, 'the agent-tool arm is still here').toBeGreaterThan(0)
      // ⛔ An absent latch reads -1, which is "above" everything — found in `720`'s own review.
      expect(latch, 'the latch is still here').toBeGreaterThan(0)
      // 🔴 **Position IS the behaviour here.** Above the latch, a cancel on this door sets no bit;
      // below it, the bit is set. ⚑ **709 · since R43 the bit renames no provider ending** — what it
      // decides is the machine's own word for a fatal error or a failed start after the Cancel.
      // ⛔ `492` put this arm above the latch, so that word was `failed` here and `interrupted` on the
      // command door; ⚑ **R71 (`709` F-1): *"both latch, because a Cancel asked a stop on both"*.**
      // The behaviour is pinned in `codex-runtime.test.ts` (Cancel, then the stream ends, and its
      // Deny control); this pins where it lives.
      expect(latch).toBeLessThan(arm)
    })

    it('⚠️ the frame goes out after the tool RESULT, and nobody else’s card is settled', () => {
      const handling = bodyOf(codex, 'private async handleAgentToolCall(')
      const result = handling.indexOf('success: false')
      const frame = handling.indexOf(
        "if (decision.outcome === 'cancel') await this.askTheTurnToStop(",
      )
      expect(result, 'the declined tool result is still written here').toBeGreaterThan(0)
      expect(frame, 'the cancel arm asks the turn to stop').toBeGreaterThan(0)
      expect(result).toBeLessThan(frame)
      // ⛔ **`settleRequests()` is what would answer the cards beside this one, on the person's
      // behalf, with no row for any of them** — the act `INTERRUPT_RAILS`' `a-person-is-being-asked`
      // refuses an agent for. ⚑ This door must not reach it, and neither must the helper it calls.
      expect(handling).not.toContain('settleRequests(')
      expect(bodyOf(codex, 'private async askTheTurnToStop(')).not.toContain('settleRequests(')
      // ⚑ **The control**: the call exists, in the method this door deliberately is not.
      expect(codeOnly(codex)).toContain('this.settleRequests()')
    })

    it('⚑ the helper asks for a stop and claims nothing else', () => {
      const helper = bodyOf(codex, 'private async askTheTurnToStop(')
      expect(helper).toContain('this.sendInterruptRpc(providerTurnId)')
      // ⛔ **No local terminal, no latch.** A local terminal would put back a word this app decided
      // rather than one the provider said — a forced `interrupted`. ⚠️ The latch belongs at the
      // PRESS (`respondPermission`, R71), a microtask before this helper runs — never in here.
      // (Its only caller since `736` is the agent-tool door; the elicitation door called it too
      // from `720` until R97.)
      expect(helper).not.toContain('forceEnd')
      expect(helper).not.toContain('requestInterrupt')
      // 🔴 **And the id is the CARD's, never `currentTurn`'s.** ⛔ A person answers whenever they get
      // to it; `currentTurn` is whatever is running then. ⚑ `serverRequestScopeProblem` validated
      // this request's `turnId` against the bound turn before the card existed, so it names the turn
      // the decision is about. ⚠️ **This assertion is the row's only killer and that is stated
      // rather than hidden**: the provider clears its pending server requests on a turn boundary, so
      // the two readings cannot be made to diverge through the real door.
      const handling = bodyOf(codex, 'private async handleAgentToolCall(')
      expect(handling).toContain("await this.askTheTurnToStop(readString(params, 'turnId'))")
      expect(helper).not.toContain('this.currentTurn')
    })
  })
})
