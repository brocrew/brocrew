import { describe, expect, it, vi } from 'vitest'
import {
  permissionOutcomeSchema,
  ResumeError,
  TURN_REFUSED,
  TurnInProgress,
  type RuntimeEvent,
} from '../src/index'
import { CodexRuntime } from '../src/codex'
import { sessionRefSchema } from '../src/session-ref'
import { turnStartedNotification } from './fixtures/codex-protocol'
import {
  type ClaudeCtl,
  type Driver,
  CONTRACT_MEMBERS,
  RUNTIME_MEMBERS,
  claudeDriver,
  collect,
  countPermissions,
  countTurns,
  ensureClaudeInit,
  fakeDriver,
  offeredBy,
  toolOpts,
  waitUntil,
} from './conformance-claude-and-fake-drivers'
import { StrictFakeTransport, codexDriver } from './conformance-codex-driver'

/**
 * Cross-adapter conformance suite (008): the same session/turn state-machine
 * invariants asserted against **Fake**, the **Claude seam** (fake query), and
 * the **Codex seam** (fake transport). Reused/extended by 009/010.
 *
 * It covers the 007 P1-3 invariants: working-on-every-turn, terminal-turn→idle,
 * failure ordering (`error → turn:failed → idle`), a permission `cancel`'s turn
 * ending in the provider's own `interrupted` (709, R43 — measured on both; it used to be the
 * machine's rename), overlapping-send rejection, and
 * freeze-after-terminal. These fail on the pre-fix behavior (see the response).
 */

// --- shared scenarios ---

function runConformance(driver: Driver): void {
  describe(`conformance · ${driver.provider}`, () => {
    it('a mode change is queued for the NEXT turn, on every adapter (034)', async () => {
      // The one contract worth making provider-independent, because the alternative is a control
      // that means "now" on one provider and "soon" on another — and the direction it would be
      // wrong in is the dangerous one. Neither provider can re-govern a turn already in flight
      // (Codex: measured on the live app-server; Claude: the mode is baked into the `Options` of a
      // query that lives for the whole session), so the Fake honours it too.
      const ctx = await driver.start()
      expect(ctx.handle.approval).toEqual({ effective: 'ask', requested: 'ask' })

      const id = await driver.openPermission(ctx)
      await ctx.handle.setApprovalMode('auto')
      expect(ctx.handle.approval, 'nothing moves under a running turn').toEqual({
        effective: 'ask',
        requested: 'auto',
      })
      // Answering the card does not move it either — adoption is a TURN boundary, not a decision.
      // (Which turn each adapter then carries it on is asserted per-adapter, and live in
      // codex-live.smoke.ts §3.1c; the terminal here is the driver's to inject.)
      await ctx.handle.respondPermission(id, { outcome: 'allow' })
      expect(ctx.handle.approval.effective).toBe('ask')

      // Exact-match opt-in, re-applied at this second door to the same room (078).
      await ctx.handle.setApprovalMode('AUTO' as 'auto')
      expect(ctx.handle.approval.requested).toBe('ask')

      await ctx.handle.close()
      await ctx.consumer
    })

    it('model and effort are queued for the NEXT turn too, on every adapter (076)', async () => {
      // 034's rule, extended to the three settings 076 made live. It is here rather than per-adapter
      // for the reason the mode is: the delay must be the SAME on both providers or the control
      // lies half the time. Codex has no choice (the values ride `turn/start`); Claude's SDK would
      // apply them immediately and this adapter queues them anyway, so the contract holds — and
      // this is the assertion that would catch someone "optimising" that away.
      const ctx = await driver.start()
      expect(ctx.handle.settings.model).toEqual({ effective: undefined, requested: undefined })
      expect(ctx.handle.settings.reasoningEffort).toEqual({
        effective: undefined,
        requested: undefined,
      })

      const id = await driver.openPermission(ctx)
      await ctx.handle.setModel('some-model')
      await ctx.handle.setReasoningEffort('low')
      expect(ctx.handle.settings.model, 'nothing moves under a running turn').toEqual({
        effective: undefined,
        requested: 'some-model',
      })
      expect(ctx.handle.settings.reasoningEffort).toEqual({
        effective: undefined,
        requested: 'low',
      })

      // Answering the card does not move them either — adoption is a TURN boundary, not a decision.
      await ctx.handle.respondPermission(id, { outcome: 'allow' })
      expect(ctx.handle.settings.model.effective).toBeUndefined()
      expect(ctx.handle.settings.reasoningEffort.effective).toBeUndefined()

      await ctx.handle.close()
      await ctx.consumer
    })

    it('a queued setting is ADOPTED by the next turn, and "no preference" is a real value (076)', async () => {
      // The other half, and the one a queue that never drained would pass without. `undefined` is
      // asserted as a REQUEST rather than an absence: "stop asking, use the provider's own default"
      // is a thing a user does, and a `pending` computed on `!==` instead of `Object.is` would
      // report it as nothing-queued and never adopt it.
      const ctx = await driver.start()
      await ctx.handle.setModel('some-model')
      await ctx.handle.setReasoningEffort('low')
      await driver.runTurn(ctx, 'completed')
      expect(ctx.handle.settings.model.effective).toBe('some-model')
      expect(ctx.handle.settings.reasoningEffort.effective).toBe('low')

      await ctx.handle.setModel(undefined)
      expect(ctx.handle.settings.model, 'clearing is a pending change').toEqual({
        effective: 'some-model',
        requested: undefined,
      })
      await driver.runTurn(ctx, 'completed')
      expect(ctx.handle.settings.model.effective).toBeUndefined()

      await ctx.handle.close()
      await ctx.consumer
    })

    it('emits status:working for every accepted turn', async () => {
      const ctx = await driver.start()
      await driver.runTurn(ctx, 'completed')
      await driver.runTurn(ctx, 'completed')
      await ctx.handle.close()
      await ctx.consumer
      const working = ctx.events.filter((e) => e.type === 'status' && e.state === 'working').length
      expect(working).toBeGreaterThanOrEqual(2)
    })

    it('answering the last open card publishes status:working, on every adapter (064)', async () => {
      // ⚠️ **The invariant that was missing, and the reason the Fake could drift away from it.**
      // Every adapter publishes `working` the moment the last open card is answered AND a turn is
      // still open (122 — through `SessionMachine.endWait` now, not a per-adapter lease; with no
      // turn open the same call publishes `idle`, which is the whole of that fix). The Fake went
      // straight from `waiting_permission` to the turn's terminal.
      // Nothing pinned it, because the `working >= 2` test above is satisfied by the one the machine
      // emits at `beginTurn`. The app reads THIS one: the durable store clears its blocked reason on
      // it, and the stall watchdog re-arms on it, so a double that skips it cannot fail when the
      // product's handling of it breaks.
      const ctx = await driver.start()
      const id = await driver.openPermission(ctx)
      const waiting = ctx.events.findIndex(
        (e) => e.type === 'status' && e.state === 'waiting_permission',
      )
      expect(waiting, 'a card was opened but nothing said the session was waiting').toBeGreaterThan(
        -1,
      )

      await ctx.handle.respondPermission(id, { outcome: 'allow' })
      await vi.waitFor(() =>
        expect(
          ctx.events.slice(waiting + 1).some((e) => e.type === 'status' && e.state === 'working'),
        ).toBe(true),
      )

      await ctx.handle.close()
      await ctx.consumer
    })

    it('work with no turn open reads as working, and Stop ends it (123)', async () => {
      // Provider work is a fact about the session, independent of a turn. A measured
      // four-minute window was labeled idle while `interrupt()` returned early. Assert that
      // interruption still reaches work when no turn is active.
      const ctx = await driver.start()
      await driver.runTurn(ctx, 'completed')
      await waitUntil(() => ctx.handle.status() === 'idle', 'the turn ending')
      const turnsBefore = countTurns(ctx.events)
      const eventsBefore = ctx.events.length

      driver.burst(ctx)

      if (!driver.reportsBurst) {
        // ⛔ **The other half, asserted rather than skipped.** This adapter drops the content before
        // it can be seen — see {@link Driver.reportsBurst} — so the honest pin is that NOTHING
        // arrived and the session stayed settled. A skip here would read as coverage.
        await new Promise((resolve) => setTimeout(resolve, 80))
        expect(
          ctx.events.slice(eventsBefore),
          'this adapter reported out-of-turn content after all — it can model a burst now',
        ).toEqual([])
        expect(ctx.handle.status()).toBe('idle')
        await ctx.handle.close()
        await ctx.consumer
        return
      }

      await waitUntil(() => ctx.handle.status() === 'working', 'the burst being noticed')

      // 🔴 **F080 — the burst is a turn the provider started**: it opened as `provider_turn`…
      // (⚑ `status()` reads the machine at once; the events reach the consumer a tick later.)
      await waitUntil(
        () => ctx.events.slice(eventsBefore).some((e) => e.type === 'provider_turn'),
        'the burst opening as a turn',
      )
      expect(ctx.events.slice(eventsBefore).filter((e) => e.type === 'provider_turn')).toHaveLength(
        1,
      )
      await ctx.handle.interrupt()
      await waitUntil(() => ctx.handle.status() === 'idle', 'Stop ending the burst')
      await waitUntil(() => countTurns(ctx.events) > turnsBefore, 'the burst’s ending')
      // ⚑ …and the Stop ends it as one: `interrupted`, this app's word, marked `startedBy`. ⛔ Until
      // F080 no turn was written for it (039/086), and a wake had no turn in the ledger at all.
      expect(countTurns(ctx.events), 'stopping a burst wrote no ending').toBe(turnsBefore + 1)
      expect(ctx.events.filter((e) => e.type === 'turn').at(-1)).toMatchObject({
        state: 'interrupted',
        wordOf: 'this-app',
        startedBy: 'the-provider',
      })

      await ctx.handle.close()
      await ctx.consumer
    })

    it('a non-interrupted terminal turn is immediately followed by status:idle', async () => {
      const ctx = await driver.start()
      await driver.runTurn(ctx, 'completed')
      await ctx.handle.close()
      await ctx.consumer
      const idx = ctx.events.findIndex((e) => e.type === 'turn' && e.state === 'completed')
      expect(ctx.events[idx + 1]).toMatchObject({ type: 'status', state: 'idle' })
    })

    it('a failure is ordered error → turn:failed → status:idle', async () => {
      const ctx = await driver.start()
      await driver.runTurn(ctx, 'failed')
      await ctx.handle.close()
      await ctx.consumer
      const fi = ctx.events.findIndex((e) => e.type === 'turn' && e.state === 'failed')
      expect(fi).toBeGreaterThan(0)
      expect(ctx.events[fi - 1]).toMatchObject({ type: 'error' })
      expect(ctx.events[fi + 1]).toMatchObject({ type: 'status', state: 'idle' })
    })

    it('a cancelled turn ends in the provider’s own `interrupted` (709, R43)', async () => {
      const ctx = await driver.start()
      await driver.runTurn(ctx, 'interrupted')
      await ctx.handle.close()
      await ctx.consumer
      expect(ctx.events.some((e) => e.type === 'turn' && e.state === 'interrupted')).toBe(true)
      expect(ctx.events.some((e) => e.type === 'turn' && e.state === 'completed')).toBe(false)
      // ⚑ 720 · R71's control: the PROVIDER's own `interrupted` is never marked as the app's.
      expect(ctx.events.filter((e) => e.type === 'turn' && e.wordOf !== undefined)).toEqual([])
    })

    it('an overlapping second send is rejected, not misclassified', async () => {
      const ctx = await driver.start()
      await driver.beginActiveTurn(ctx)
      // 🔴 **650 · and it says WHICH refusal it was, as a type** — a turn already held clears on
      // its own, and the host tells a caller so. ⛔ The text is unchanged, on every adapter.
      const overlapping = ctx.handle.send('y')
      await expect(overlapping).rejects.toBeInstanceOf(TurnInProgress)
      await expect(overlapping).rejects.toThrow(TURN_REFUSED)
      // the single active turn has not produced a spurious terminal
      expect(countTurns(ctx.events)).toBe(0)
      await ctx.handle.close()
      await ctx.consumer
    })

    it('freezes lifecycle after a terminal session (no events after ended)', async () => {
      const ctx = await driver.start()
      await driver.runTurn(ctx, 'completed')
      await ctx.handle.close()
      await ctx.consumer
      driver.injectLateTerminal(ctx)
      // sends after close are rejected (frozen)
      // ⚠️ **650 · the control for the case above**: the same text, and NOT the type — a closed
      // session is not busy, and a caller told it was would retry a conversation that has gone.
      const late = ctx.handle.send('late')
      await expect(late).rejects.toThrow(TURN_REFUSED)
      await expect(late).rejects.not.toBeInstanceOf(TurnInProgress)
      const endedIdx = ctx.events.findIndex((e) => e.type === 'session' && e.state === 'ended')
      expect(endedIdx).toBeGreaterThanOrEqual(0)
      const afterEnded = ctx.events.slice(endedIdx + 1)
      expect(afterEnded.every((e) => e.type === 'status')).toBe(true)
      expect(afterEnded.some((e) => e.type === 'turn' || e.type === 'session')).toBe(false)
    })

    // --- 009 request broker ---

    it('resolves an allow-vs-deny race exactly once; the loser is told it did not win', async () => {
      const ctx = await driver.start()
      const id = await driver.openPermission(ctx)
      const results = await Promise.allSettled([
        ctx.handle.respondPermission(id, { outcome: 'allow' }),
        ctx.handle.respondPermission(id, { outcome: 'deny' }),
      ])
      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1)
      expect(results.filter((r) => r.status === 'rejected')).toHaveLength(1)
      await ctx.handle.close()
      driver.injectLateTerminal(ctx)
    })

    it('rejects a duplicate/late response once the request is answered', async () => {
      const ctx = await driver.start()
      const id = await driver.openPermission(ctx)
      await ctx.handle.respondPermission(id, { outcome: 'allow' })
      await expect(ctx.handle.respondPermission(id, { outcome: 'deny' })).rejects.toThrow()
      await ctx.handle.close()
      driver.injectLateTerminal(ctx)
    })

    it('settleAll on interrupt leaves no pending request (a later response is rejected)', async () => {
      const ctx = await driver.start()
      const id = await driver.openPermission(ctx)
      await ctx.handle.interrupt()
      await expect(ctx.handle.respondPermission(id, { outcome: 'allow' })).rejects.toThrow()
      await ctx.handle.close()
      driver.injectLateTerminal(ctx)
    })

    it('settleAll on fatal error leaves no pending request', async () => {
      const ctx = await driver.start()
      const id = await driver.openPermission(ctx)
      driver.triggerFatal(ctx)
      await ctx.consumer
      await expect(ctx.handle.respondPermission(id, { outcome: 'allow' })).rejects.toThrow()
    })

    // --- 010 close() teardown barrier ---

    it('close() mid-turn emits exactly one terminal turn (interrupted) → idle → ended → status:ended', async () => {
      const ctx = await driver.start()
      await driver.beginActiveTurn(ctx)
      expect(countTurns(ctx.events)).toBe(0) // no terminal yet — turn is live
      await ctx.handle.close() // awaitable barrier
      await ctx.consumer
      const turns = ctx.events.filter((e) => e.type === 'turn')
      expect(turns).toHaveLength(1)
      // 🔴 720 · R71: a Close is the APP's act, and the word says whose it is — on every adapter.
      expect(turns[0]).toEqual({ type: 'turn', state: 'interrupted', wordOf: 'this-app' })
      // ordering: turn:interrupted → status:idle → session:ended → status:ended
      const ti = ctx.events.findIndex((e) => e.type === 'turn')
      expect(ctx.events[ti + 1]).toMatchObject({ type: 'status', state: 'idle' })
      const si = ctx.events.findIndex((e) => e.type === 'session' && e.state === 'ended')
      expect(si).toBeGreaterThan(ti + 1)
      expect(ctx.events[si + 1]).toMatchObject({ type: 'status', state: 'ended' })
      expect(ctx.handle.status()).toBe('ended')
    })

    it('close() mid-permission safe-rejects the pending prompt and terminalizes interrupted', async () => {
      const ctx = await driver.start()
      const id = await driver.openPermission(ctx)
      await ctx.handle.close() // must not hang on the pending prompt
      await ctx.consumer
      // the pending prompt was settled by teardown: a later response is refused
      await expect(ctx.handle.respondPermission(id, { outcome: 'allow' })).rejects.toThrow()
      const turns = ctx.events.filter((e) => e.type === 'turn')
      expect(turns).toHaveLength(1)
      expect(turns[0]).toMatchObject({ state: 'interrupted' })
      expect(ctx.handle.status()).toBe('ended')
    })

    it('close() is a single memoized barrier: concurrent callers await ONE teardown, exactly one session:ended (023 P1-A)', async () => {
      const ctx = await driver.start()
      await driver.runTurn(ctx, 'completed')
      const p1 = ctx.handle.close()
      const p2 = ctx.handle.close()
      expect(p1).toBe(p2) // one memoized promise — caller 2 never early-returns with its own
      await Promise.all([p1, p2])
      await ctx.consumer
      expect(ctx.events.filter((e) => e.type === 'session' && e.state === 'ended')).toHaveLength(1)
      expect(ctx.events.filter((e) => e.type === 'status' && e.state === 'ended')).toHaveLength(1)
      expect(ctx.handle.status()).toBe('ended')
    })

    it('a fatal provider loss during a permission wait emits EXACTLY ONE terminal turn (never zero) → errored (023 P1-A)', async () => {
      const ctx = await driver.start()
      await driver.openPermission(ctx) // active turn + pending permission
      driver.triggerFatal(ctx) // provider stream dies mid-permission
      await ctx.consumer // the fatal terminalizes the turn and ends the queue
      // The active turn is terminalized exactly once (pre-fix: zero terminal turns).
      const turns = ctx.events.filter((e) => e.type === 'turn')
      expect(turns).toHaveLength(1)
      // Ordering: error{fatal} → terminal turn → status:errored.
      const ei = ctx.events.findIndex((e) => e.type === 'error' && e.fatal === true)
      const ti = ctx.events.findIndex((e) => e.type === 'turn')
      const xi = ctx.events.findIndex((e) => e.type === 'status' && e.state === 'errored')
      expect(ei).toBeGreaterThanOrEqual(0)
      expect(ti).toBeGreaterThan(ei)
      expect(xi).toBeGreaterThan(ti)
      expect(ctx.handle.status()).toBe('errored')
    })

    it('close() is awaitable and idempotent: a second close is a safe no-op', async () => {
      const ctx = await driver.start()
      await driver.runTurn(ctx, 'completed')
      await ctx.handle.close()
      await ctx.handle.close() // no throw, no duplicate terminal
      await ctx.consumer
      expect(ctx.events.filter((e) => e.type === 'session' && e.state === 'ended')).toHaveLength(1)
      expect(ctx.events.filter((e) => e.type === 'status' && e.state === 'ended')).toHaveLength(1)
      expect(ctx.handle.status()).toBe('ended')
    })

    it('a late provider event after close cannot mutate status or deliver events', async () => {
      const ctx = await driver.start()
      await driver.runTurn(ctx, 'completed')
      await ctx.handle.close()
      await ctx.consumer
      const countBefore = ctx.events.length
      driver.injectLateTerminal(ctx) // late provider terminal after teardown
      await new Promise((r) => setTimeout(r, 20))
      expect(ctx.handle.status()).toBe('ended')
      expect(ctx.events.length).toBe(countBefore)
    })

    // --- 011 honest ref ---

    it('every emitted session ref is schema-valid — never a synthesized placeholder', async () => {
      const ctx = await driver.start()
      await driver.runTurn(ctx, 'completed')
      await ctx.handle.close()
      await ctx.consumer
      const sessions = ctx.events.filter(
        (e): e is Extract<RuntimeEvent, { type: 'session' }> => e.type === 'session',
      )
      expect(sessions.length).toBeGreaterThan(0)
      for (const s of sessions) {
        expect(sessionRefSchema.safeParse(s.ref).success).toBe(true)
        expect(s.ref.sessionId).not.toBe('unstarted')
      }
      // and the live ref matches what the session events announced
      expect(ctx.handle.ref === null || sessionRefSchema.safeParse(ctx.handle.ref).success).toBe(
        true,
      )
    })

    it('honest resume: a forged/unissued ref → ResumeError (holds for the Fake too, 034 fixing 023 P2 #7)', async () => {
      // Pre-fix the Fake accepted any `fake_*` id, so this passed on the real seams but
      // FAILED on the Fake — masking resume bugs. Now the Fake is a faithful double.
      await expect(driver.resumeForged()).rejects.toBeInstanceOf(ResumeError)
    })

    // --- the contract ledger (186) ---

    it('every member of the contract is modelled here, or written down as a gap', async () => {
      // ⛔ **The SHAPE pass.** `CONTRACT_MEMBERS` is a `Record<keyof SessionHandle, …>`, so a member
      // added to the interface does not COMPILE until it is listed; this then asks a live handle
      // from each seam whether it has one, and anything missing must carry a reason. That chain is
      // what would have stopped `179` at the moment `agentInfo` landed rather than four dispatches
      // later — and it is why a `cannot` here is a written decision instead of a silence.
      const ctx = await driver.start()
      const missing = Object.keys(CONTRACT_MEMBERS).filter(
        (member) => !(member in ctx.handle) && !(member in driver.ledger.gaps),
      )
      expect(missing, `${driver.provider} has no ledger entry for these contract members`).toEqual(
        [],
      )
      // …and the other direction, which is what keeps the list honest as the doubles grow: a gap
      // that is no longer a gap is a stale claim, and a stale claim is how a ledger stops being read.
      const stale = Object.keys(driver.ledger.gaps).filter((member) => member in ctx.handle)
      expect(stale, `${driver.provider} declares gaps it no longer has`).toEqual([])
      // The runtime that issues handles is held to the same list.
      const runtimeMissing = Object.keys(RUNTIME_MEMBERS).filter(
        (member) => !(member in driver.runtimeUnderTest()),
      )
      expect(runtimeMissing, `${driver.provider} runtime is missing contract members`).toEqual([])
      await ctx.handle.close()
      await ctx.consumer
    })

    it('every neutral outcome does what this seam says it does (186 · A)', async () => {
      // ⛔ **The BEHAVIOUR pass, and the one that catches `182` H4's first contradiction.** The Fake
      // recorded `allow_all_for_session` as a standing grant and then reported the command as
      // `skipped (denied)` — a yes counted as a no, one turn apart, in the same file. Nothing above
      // could fail, because the only test that touched the grant asserted the DISCLOSURE mentioned
      // the tool and never that the tool ran.
      //
      // Driven off `permissionOutcomeSchema.options` rather than a hand-written list, so widening
      // the union reaches here too — and a fresh session per outcome, because a wholesale grant
      // changes what the NEXT turn does and an in-order loop would card itself out of existence.
      for (const outcome of permissionOutcomeSchema.options) {
        const claim = driver.ledger.outcomes[outcome]
        const ctx = await driver.start()
        const id = await driver.openPermission(ctx)
        const offered = offeredBy(ctx.events)
        if (claim === 'not-offered') {
          // A UI may only draw what the card lists — so the claim is about the buttons, and the
          // outcome is never sent. Answered `deny` instead, which every card always accepts.
          expect(offered, `${driver.provider} · ${outcome}`).not.toContain(outcome)
          expect(await driver.tell(ctx, id, 'deny')).toBe('refused')
        } else {
          expect(offered, `${driver.provider} · ${outcome}`).toContain(outcome)
          expect(await driver.tell(ctx, id, outcome), `${driver.provider} · ${outcome}`).toBe(claim)
        }
        await ctx.handle.close()
        await ctx.consumer
      }
    })

    it('a wholesale grant is STANDING, or the ledger says where it lives instead (186 · B)', async () => {
      // ⛔ **`182` H4's second contradiction.** `permission.ts` says `allow_all_for_session` means
      // *"every future use of this tool this session, whatever its arguments"*. The Fake recorded
      // the grant for the header and raised a card on the very next turn anyway, so every host test
      // above it certified a promise the double was not keeping.
      const ctx = await driver.start()
      if (driver.ledger.wholesaleGrant === 'standing') {
        expect(await driver.asksAgainAfterWholesaleGrant(ctx), 'it asked again').toBe(false)
        // The positive pair: the grant is VISIBLE, so this is not a gate that simply stopped working.
        expect(ctx.handle.blanketGrants).toContain('Bash')
      } else {
        // A declared gap, asserted from the other side rather than skipped: this seam reports no
        // standing grant at all, which is the honest half of the sentence its ledger gives.
        expect(ctx.handle.blanketGrants, driver.ledger.wholesaleGrant).toEqual([])
      }
      await ctx.handle.close()
      await ctx.consumer
    })

    it('an unattended session asks nobody anything (186 · C)', async () => {
      // ⛔ **`182` H4's third finding, and the one that was a TIMING false-green.** The desktop test
      // for this waited on the opening statuses, which arrive before the asynchronous driver reaches
      // its card — so it read "no card" at a moment when no card could have arrived yet, against a
      // double that published one in every mode.
      const proof = await driver.unattended()
      expect(proof.cards, `${driver.provider} asked in auto`).toBe(0)
      if (driver.ledger.unattended === 'no-card') {
        // ⚑ The positive pair. A turn that never ran raises no cards either, and that is not the
        // claim: yolo means the work happens and nobody is asked.
        expect(proof.ran, 'nothing actually ran, so "no card" proves nothing').toBe(true)
      } else {
        // Provider-side: the proof is the profile that went out on the wire, since there is no card
        // for this adapter to have suppressed.
        expect(proof.wire, driver.ledger.unattended).toMatchObject({ approvalPolicy: 'never' })
      }
    })
  })
}

runConformance(fakeDriver)
runConformance(claudeDriver)
runConformance(codexDriver)

// Claude-specific broker guarantees (007 P1-2): SDK abort signal + SDK request identity.
describe('conformance · claude broker specifics', () => {
  it('an aborted canUseTool settles (deny), never hangs', async () => {
    const ctx = await claudeDriver.start()
    const ctl = ctx.ctl as ClaudeCtl
    await ctx.handle.send('x')
    await ensureClaudeInit(ctx, ctl)
    const ac = new AbortController()
    const result = ctl.canUse(
      'Bash',
      { command: 'x' },
      { toolUseID: 'tu_abort', signal: ac.signal, requestId: 'r' },
    )
    await waitUntil(() => countPermissions(ctx.events) > 0, 'permission')
    ac.abort()
    await expect(result).resolves.toMatchObject({ behavior: 'deny' })
    await ctx.handle.close()
    ctl.fq.end()
    await ctx.consumer
  })

  it('a canUseTool arriving after close is safe-rejected (deny), not left pending', async () => {
    const ctx = await claudeDriver.start()
    const ctl = ctx.ctl as ClaudeCtl
    await ctx.handle.close()
    const result = ctl.canUse('Bash', { command: 'x' }, toolOpts('tu_after'))
    await expect(result).resolves.toMatchObject({ behavior: 'deny' })
    ctl.fq.end()
    await ctx.consumer
  })

  it('a duplicate toolUseID does not strand the earlier callback', async () => {
    const ctx = await claudeDriver.start()
    const ctl = ctx.ctl as ClaudeCtl
    await ctx.handle.send('x')
    await ensureClaudeInit(ctx, ctl)
    const first = ctl.canUse('Bash', { command: 'a' }, toolOpts('tu_dup'))
    await waitUntil(() => countPermissions(ctx.events) > 0, 'permission')
    // Duplicate delivery for the same id: safe-rejected immediately; `first` stays pending.
    const dup = ctl.canUse('Bash', { command: 'b' }, toolOpts('tu_dup'))
    await expect(dup).resolves.toMatchObject({ behavior: 'deny' })
    await ctx.handle.respondPermission('tu_dup', { outcome: 'allow' })
    await expect(first).resolves.toMatchObject({ behavior: 'allow' })
    await ctx.handle.close()
    ctl.fq.end()
    await ctx.consumer
  })

  // 010: teardown must detach the SDK via Query.close(), not only interrupt().
  it('close() detaches the SDK via Query.close() and terminalizes the live turn as interrupted', async () => {
    const ctx = await claudeDriver.start()
    const ctl = ctx.ctl as ClaudeCtl
    await ctx.handle.send('x')
    await ensureClaudeInit(ctx, ctl)
    await waitUntil(() => ctx.handle.status() === 'working', 'working')
    await ctx.handle.close()
    await ctx.consumer
    expect(ctl.fq.closeCount).toBeGreaterThanOrEqual(1)
    const turns = ctx.events.filter((e) => e.type === 'turn')
    expect(turns).toHaveLength(1)
    expect(turns[0]).toMatchObject({ state: 'interrupted' })
  })
})

// 010: the Codex decline-before-close write ordering, proven against a transport
// that (like the real one) drops writes after close.
describe('conformance · codex close-path wire ordering', () => {
  const decisionOf = (result: unknown): unknown =>
    typeof result === 'object' && result !== null
      ? (result as Record<string, unknown>)['decision']
      : undefined

  it('flushes the decline to the wire BEFORE transport.close() (write-rejecting transport)', async () => {
    const transport = new StrictFakeTransport()
    const runtime = new CodexRuntime(() => transport)
    const handle = await runtime.start({ cwd: '/tmp/x', providerHome: '/tmp/x/home' })
    const events: RuntimeEvent[] = []
    const consumer = collect(handle, events)
    // open a pending command approval mid-turn
    await handle.send('x')
    transport.notification(
      'turn/started',
      turnStartedNotification('th_1', transport.currentTurnId()),
    )
    transport.serverRequest(7, 'item/commandExecution/requestApproval', { command: 'rm -rf /' })
    await waitUntil(() => events.some((e) => e.type === 'permission_request'), 'permission')
    // close mid-permission: the decline must reach the wire before the transport shuts
    await handle.close()
    await consumer
    const declines = transport.wire.filter((w) => decisionOf(w.result) === 'decline')
    expect(declines).toHaveLength(1) // actually written, not dropped
    expect(transport.attempts.every((a) => !a.afterClose)).toBe(true) // nothing written after close
  })
})
