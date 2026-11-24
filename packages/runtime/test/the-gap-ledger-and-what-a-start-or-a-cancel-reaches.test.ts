import { EventEmitter } from 'node:events'
import { PassThrough } from 'node:stream'
import type { Options } from '@anthropic-ai/claude-agent-sdk'
import { describe, expect, it } from 'vitest'
import {
  AnswerRefused,
  FakeLaunchGate,
  FakeProviderSessions,
  FakeRuntime,
  permissionOutcomeSchema,
  ResumeError,
  type RuntimeEvent,
} from '../src/index'
import { ClaudeRuntime } from '../src/claude'
import { CodexRuntime } from '../src/codex'
import { cancelWith } from '../src/internal/bounded'
import {
  FakeQuery,
  claudeDriver,
  collect,
  countPermissions,
  countTurns,
  fakeDriver,
  latestPermissionId,
  toolResults,
  waitUntil,
} from './conformance-claude-and-fake-drivers'
import { FakeTransport, codexDriver } from './conformance-codex-driver'

/**
 * ⛔ **The ledger as ONE list** (186 §3).
 *
 * The two passes above check each seam against its own declaration. This is the third thing the
 * mechanism has to do, and the one the four previous dispatches actually needed: put the complete
 * set of "things the doubles cannot express" somewhere a reviewer READS, so the next dispatch starts
 * from a written list instead of discovering an eighth instance of it.
 *
 * ⚠️ **It is pinned, not printed.** A `console.log` is a thing nobody looks at in a green run; an
 * equality is a diff in the pull request. Adding a gap, closing one, or moving one between seams all
 * fail here until the list is updated — which is the moment a human decides whether the gap is
 * acceptable.
 */
describe('conformance · the gap ledger (186)', () => {
  const drivers = [fakeDriver, claudeDriver, codexDriver]

  it('says exactly what the doubles cannot express, seam by seam', () => {
    const ledger = drivers.map((driver) => [driver.provider, Object.keys(driver.ledger.gaps)])
    expect(ledger).toEqual([
      [
        'fake',
        [
          'isRetiring',
          'refreshManagedPlugins',
          'awaitManagedPlugins',
          'managedPluginHealth',
          'builtInSkillsConfirmed',
          // 722 · R79: a pre-init window only a Claude launch has — the Fake's ref is set at birth.
          'launchedAs',
          'agentInfo',
          'providerPid',
          'instructionSources',
          'signInSuperseded',
          'checkSignIn',
          'signInCopyAtLaunch',
          'carryOn',
          'signInTag',
          'account',
          // 247. The Fake can REPORT background work — `simulateBackgroundWork` exists so the
          // taxonomy pass has a frame — and cannot DO any, because it runs nothing that could
          // outlive a turn. Those are different claims, and only the second one is a gap.
          'backgroundWork',
          'stopBackgroundWork',
          // F084: and nothing a stop could end.
          'endEverythingTheTurnStarted',
          // 300, and it is the SAME distinction a third time: the Fake can be given a tool card,
          // and no command runs behind it, so there is nothing for a tail to be a tail of.
          'commandOutput',
          // 462, and the SAME distinction a fourth time — and it is the only one of the four that
          // BOTH real adapters implement, so this list is the whole of its absence. A Fake tool
          // card has no receipt behind it; an empty answer would be a claim about one.
          'toolAnswer',
          // 296, and the same distinction one level over: the Fake can be given a child CARD
          // (`simulateSubAgent`), and it has no thread behind it for anyone to address. Reporting a
          // child and being able to speak to one are different claims.
          'childState',
          'childInput',
        ],
      ],
      // ⚑ **`providerPid` LEFT this list in 233**, and that is the ledger doing its job: the
      // adapter now supplies the SDK's `Options.spawnClaudeCodeProcess`, so the CLI child is one
      // this app spawned and holds. 076's *"Claude's subprocess belongs to the Agent SDK and we
      // hold no handle to it"* was a true statement about every surface the SDK offers, and it
      // stopped being true of the LAUNCH. The gap could not simply be deleted quietly — a stale
      // entry fails the pass above by name.
      // ⚑ **`childState`/`childInput` JOINED this list in 296, and the reason is a measurement of
      // the OTHER provider.** `295` proved a Codex child is a real addressable thread — an id, a
      // status, `canAcceptDirectInput`, and a `turn/start` it answers. Nothing equivalent exists
      // here: the SDK writes a sub-agent's record to `subagents/agent-<id>.jsonl` and offers no
      // method that takes an agent id, so BroBot can READ a Claude child (112/115 do) and has
      // nothing to say to one. ⛔ An absence, stated — not a deferral.
      // ⚑ **`commandOutput` JOINED this list in 300, and it is the first entry here that a live
      // turn had to settle rather than a `.d.ts`.** `Query` declaring no reader of a task's output
      // is a claim about the schema, and this project has shipped two `absent`s that were exactly
      // that and were false (029, 030). So `probe:command-output` ran a real command printing a
      // nonce only the process could produce: 53 frames, and the first one carrying a byte of it
      // was the receipt. ⛔ An absence, measured — and `245`'s finding is why it is the provider's
      // rather than our pin's: the output goes to the MODEL, through its own tools (`TaskOutput` until
      // 0.3.281 removed it; the Read tool on the output file since — 680).
      // ⚑ **`compact` JOINED this list in 713, by design** — Claude's compaction is its CLI's own
      // `/compact`, which `R42` sends as typed; Codex's is a request of its own (`R59`).
      // ⚑ **`endEverythingTheTurnStarted` JOINED it in F084, by measurement**: the CLI ends the Bash a
      // stopped turn waits on and spares background work whoever asked, so there is nothing to widen.
      [
        'claude',
        [
          'awaitManagedPlugins',
          'instructionSources',
          'signInCopyAtLaunch',
          'carryOn',
          'endEverythingTheTurnStarted',
          'childState',
          'childInput',
          'commandOutput',
        ],
      ],
      // ⚑ **`backgroundWork`/`stopBackgroundWork` JOINED this list in 247, by ruling rather than by
      // absence** — the mirror image of `providerPid` leaving it in 233. Codex's pin HAS the
      // controls (`command/exec/terminate`, `process/kill`, `thread/backgroundTerminals/terminate`
      // are all in the generated `ClientRequest` union at `rust-v0.146.0`) and 247 §2 rules that
      // wiring them is not this dispatch's. A gap that exists because we chose not to build it has
      // to say so, or the next reader will close it believing the provider could not.
      //
      // ⛔ **And `stopBackgroundWork` LEFT it again in 275**, which is the ledger paying for itself
      // twice: the entry said *"wiring it is a later dispatch's"*, that dispatch happened, and the
      // line above could not be deleted quietly. `backgroundWork` stays, with a reason that changed
      // from *"we chose not to build it"* to *"there is nothing here to build"* — see the ledger.
      //
      // ⚑ **`providerCommands` JOINED this list in 708, by design and not by deferral.** `R42` is
      // about `/` commands and Codex's list is `$` skills (`279`), so no `/` word can be on it and
      // the host never asks — `PROVIDER_COMMAND_PREFIX` tells it so without a round trip.
      //
      // ⚑ **`launchedAs` JOINED both doubles' lists in 722, by design**: it covers Claude's window
      // between `start()` and the first init, and a Codex thread id is in `thread/start`'s answer.
      [
        'codex',
        [
          'isRetiring',
          'refreshManagedPlugins',
          'builtInSkillsConfirmed',
          'launchedAs',
          'providerCommands',
          'backgroundWork',
          'account',
        ],
      ],
    ])
    // Every gap carries a REASON, and a blank one is not a reason. This is what stops the list
    // being closed by writing `''` next to a member somebody did not want to think about.
    for (const driver of drivers) {
      for (const [member, why] of Object.entries(driver.ledger.gaps)) {
        expect(why.length, `${driver.provider}.${member} has no stated reason`).toBeGreaterThan(20)
      }
    }
  })

  it('covers every outcome the permission union defines', () => {
    // The compile-time `Record<PermissionOutcome, …>` is the real gate; this is its runtime echo,
    // and it is here because the union is DERIVED from a zod schema — so the one way the two could
    // part company is a schema that grew without the type being rebuilt.
    for (const driver of drivers) {
      expect(Object.keys(driver.ledger.outcomes).sort()).toEqual(
        [...permissionOutcomeSchema.options].sort(),
      )
    }
  })

  it('and the two the base Fake can now be ASKED to do, which it could not before (186 §2)', async () => {
    // ⚑ The two rows of `182` H4's gap list that the counts justified building: **131** cases touch
    // a delayed / hung / cancelled launch, and **103** touch resume-after-death — worked around in
    // 11 test files by keeping the runtime instance alive across a pretend relaunch.
    const gate = new FakeLaunchGate()
    const sessions = new FakeProviderSessions()
    const control = new AbortController()
    const first = new FakeRuntime('claude', { sessions, gate })

    // A launch that is genuinely IN FLIGHT — the interval 185 found a real ownership defect inside.
    const held = first.start({ cwd: '/tmp/x', providerHome: '/tmp/x/home', signal: control.signal })
    void held.catch(() => {})
    await waitUntil(() => gate.held === 1, 'the launch to reach the gate')
    expect(gate.arrived, 'a launch really happened').toBe(1)
    control.abort()
    await expect(held).rejects.toThrow('cancelled before it started')
    expect(sessions.size, 'a cancelled launch leaves nothing to unwind').toBe(0)

    // …and a session the PROVIDER still has after our process is gone.
    gate.release()
    const handle = await first.start({ cwd: '/tmp/x', providerHome: '/tmp/x/home' })
    const ref = handle.ref
    await handle.close()

    const relaunched = new FakeRuntime('claude', { sessions })
    const resumed = await relaunched.resume(ref, { providerHome: '/tmp/x/home' })
    expect(resumed.ref?.sessionId).toBe(ref.sessionId)
    await resumed.close()

    // …and the new process does not hand out an id the provider is already using. The counter
    // belongs to the record for the same reason the record does: a provider does not reissue a
    // session it still has, and a per-object counter would have the second process collide with the
    // first on its very first launch.
    const fresh = await relaunched.start({ cwd: '/tmp/x', providerHome: '/tmp/x/home' })
    expect(fresh.ref.sessionId).not.toBe(ref.sessionId)
    await fresh.close()

    // The negative that keeps it honest: a new process is not a licence to forge one.
    await expect(
      new FakeRuntime('claude', { sessions }).resume(
        { provider: 'claude', sessionId: 'fake_claude_never', cwd: '/tmp/x', rotation: 0 },
        { providerHome: '/tmp/x/home' },
      ),
    ).rejects.toBeInstanceOf(ResumeError)
    // …and a provider that lost its own state refuses the ref it once issued.
    sessions.forgetAll()
    await expect(
      new FakeRuntime('claude', { sessions }).resume(ref, { providerHome: '/tmp/x/home' }),
    ).rejects.toBeInstanceOf(ResumeError)
  })

  it('a CODEX-labelled Fake publishes CODEX buttons, not Claude ones (196, from 193 M4)', async () => {
    // ⛔ **A double that is silent about a difference and one that has it wrong look the same from
    // the test.** `FakeRuntime` stored its provider label and then published the Claude-shaped
    // OPAQUE offer for every provider, so all 55 codex-labelled construction sites across 25
    // desktop test files opened a card with `allow_all_for_session` on it — a button the real Codex
    // adapter never offers. A provider-routing regression, or a Codex card that offered the wrong
    // grant, executed Claude behaviour under a Codex name and stayed green.
    //
    // ⚠️ **Measured when the fix landed: not one of the 3,297 tests changed colour.** That is the
    // finding, not the reassurance — the alias was invisible to every one of them.
    const codex = await new FakeRuntime('codex').start({
      cwd: '/tmp/x',
      providerHome: '/tmp/x/home',
    })
    const events: RuntimeEvent[] = []
    const consumer = collect(codex, events)
    await codex.send('x')
    await waitUntil(() => countPermissions(events) > 0, 'the codex card')
    const card = events.find((e) => e.type === 'permission_request')
    expect(card?.type === 'permission_request' && card.scope.availableDecisions).toEqual([
      'allow',
      'allow_for_session',
      'deny',
      'cancel',
    ])

    // …and the card is validated against what IT offered: Claude's wholesale grant is refused here
    // exactly as the narrow one is refused on a Claude card.
    const id = latestPermissionId(events)
    await expect(
      codex.respondPermission(id, { outcome: 'allow_all_for_session' }),
    ).rejects.toBeInstanceOf(AnswerRefused)
    // ⚑ The positive pair: the button Codex DOES offer is honoured, and it is standing — otherwise
    // this double would offer a session grant and then ask again, which is 182 H4 with a new label.
    await codex.respondPermission(id, { outcome: 'allow_for_session' })
    expect(codex.blanketGrants).toContain('Bash')
    await codex.close()
    await consumer

    // …and the mirror, so this is a difference rather than a swap: Claude still publishes Claude's.
    const claude = await new FakeRuntime('claude').start({
      cwd: '/tmp/x',
      providerHome: '/tmp/x/home',
    })
    const claudeEvents: RuntimeEvent[] = []
    const claudeConsumer = collect(claude, claudeEvents)
    await claude.send('x')
    await waitUntil(() => countPermissions(claudeEvents) > 0, 'the claude card')
    const claudeCard = claudeEvents.find((e) => e.type === 'permission_request')
    expect(
      claudeCard?.type === 'permission_request' && claudeCard.scope.availableDecisions,
    ).toEqual(['allow', 'allow_all_for_session', 'deny', 'cancel'])
    await claude.respondPermission(latestPermissionId(claudeEvents), { outcome: 'deny' })
    await claude.close()
    await claudeConsumer
  })

  it('refuses a decision its own card did not offer, exactly as both adapters do (186)', async () => {
    // ⛔ **Found by the ledger, not by the ticket.** `permission.ts` says a card *"only ever offers
    // what its own `scope.availableDecisions` lists, and every adapter validates an answer against
    // what it offered"*. Every adapter did. This double did not — it published the OPAQUE offer and
    // then honoured `allow_for_session` anyway, which is a UI drawing a button the provider never
    // gave, staying green in the only tests that see the UI.
    const ctx = await fakeDriver.start()
    const id = await fakeDriver.openPermission(ctx)
    await expect(
      ctx.handle.respondPermission(id, { outcome: 'allow_for_session' }),
    ).rejects.toBeInstanceOf(AnswerRefused)

    // ⚑ **The card is still LIVE** — the whole difference between this refusal and a stale one
    // (142): nothing was told to the provider, so nothing was spent.
    await ctx.handle.respondPermission(id, { outcome: 'allow' })
    await waitUntil(() => countTurns(ctx.events) > 0, 'the turn the live card still owned')
    expect(toolResults(ctx.events).at(-1)?.ok).toBe(true)
    await ctx.handle.close()
    await ctx.consumer
  })

  it('and a card the teardown already took is `not-pending`, not `not-offered` (186)', async () => {
    // ⚠️ The refusals are three different events and the app says a different sentence for each
    // (085). A settled card that kept its offer would answer an unoffered outcome with *"we never
    // gave you that button"* when the true answer is *"that question is gone"* — the same drift 142
    // fixed for questions, which is why the offer is dropped on exactly the same paths.
    const ctx = await fakeDriver.start()
    const id = await fakeDriver.openPermission(ctx)
    await ctx.handle.close()
    await ctx.consumer
    await expect(
      ctx.handle.respondPermission(id, { outcome: 'allow_for_session' }),
    ).rejects.toThrow(/not pending/)
  })
})

/**
 * `StartOptions.systemHint` is DELIVERED to each provider's real instruction field (056,
 * closing 044 P2 #6). Pre-fix the field was part of the neutral contract, accepted by every
 * adapter, and then silently dropped — a caller could set an agent persona and no provider
 * ever saw it. These assert on the ACTUAL call args (the SDK `Options` the query factory
 * receives; the `thread/start` params written to the transport), not on a wrapper.
 *
 * ⛔ **555 · and the call args are the LAST STEP THIS SUITE CAN SEE.** HO-062 §2 withdrew
 * `HO-023` §7's *"the factory layer propagates verbatim by construction … that is a safety
 * property"*: **the layer carries BEHAVIOUR, and safety lives in the rails.** ⚠️ So nothing below
 * is evidence that a hint is still in force at turn N — on Codex a `collaborationMode` update
 * takes precedence over `developerInstructions` (`552`; see `collaborationModeFor` in
 * `codex/codex-runtime.ts`), and no assertion here would notice. ⚑ **That is a stated limit, not
 * a gap in this file**: HO-062 §1 rules the re-assert out and names the symptom to wait for.
 */
describe('StartOptions.systemHint → provider instruction field (044 P2 #6)', () => {
  const HINT = 'You are BroBot2 QA. Prefer minimal diffs.'
  const startOpts = { cwd: '/tmp/x', providerHome: '/tmp/x/home' }

  /** Start a Claude session and return the `Options` the SDK was actually called with. */
  async function claudeOptions(systemHint?: string) {
    const fq = new FakeQuery()
    let captured: Options | undefined
    const runtime = new ClaudeRuntime(
      (params) => {
        captured = params.options
        return fq
      },
      async () => true,
    )
    const handle = await runtime.start({ ...startOpts, ...(systemHint ? { systemHint } : {}) })
    await handle.close()
    if (!captured) throw new Error('query factory never called')
    return captured
  }

  /** Start a Codex session and return the params its `thread/start` was actually sent with. */
  async function codexThreadStartParams(systemHint?: string) {
    const transport = new FakeTransport()
    const handle = await new CodexRuntime(() => transport).start({
      ...startOpts,
      ...(systemHint ? { systemHint } : {}),
    })
    await handle.close()
    const sent = transport.requests.find((r) => r.method === 'thread/start')
    if (!sent) throw new Error('thread/start never sent')
    return sent.params as Record<string, unknown>
  }

  it('Claude: forwarded as an APPENDED system prompt, never a replacement', async () => {
    // A bare string would REPLACE the preset and strip the tool GUIDANCE the model reads — so the
    // preset+append shape is the assertion.
    //
    // ⛔ **555 · it used to say the 001 approval profile DEPENDS ON that text, and HO-062 §2
    // withdraws the framing.** The profile is `promptGuardHooks` (evaluated ahead of permission
    // rules, so no rule can shadow it), `canUseTool`, and `settingSources: []` — none of them
    // prose, none of them reachable from a system prompt. ⚠️ **A bare string costs BEHAVIOUR**:
    // `claude-runtime.ts` measures it as no preset, no tool guidance, no environment block and no
    // memory section.
    expect(await claudeOptions(HINT)).toMatchObject({
      systemPrompt: { type: 'preset', preset: 'claude_code', append: HINT },
    })
  })

  it('Codex: forwarded as thread/start `developerInstructions`, never `baseInstructions`', async () => {
    const params = await codexThreadStartParams(HINT)
    expect(params['developerInstructions']).toBe(HINT)
    // baseInstructions REPLACES the agent's base prompt — using it would silently drop the
    // built-in tool guidance, so it must stay absent.
    //
    // ⚠️ **555 · "tool/approval behaviour" was one word too wide** (HO-062 §2). The approval half
    // is `approvalPolicy`, `approvalsReviewer` and `sandbox` — three fields of THIS SAME
    // `thread/start` params object, from `APPROVAL_PROFILES` — and `baseInstructions` touches none
    // of them. What it would drop is what the model KNOWS about its tools.
    expect(params['baseInstructions']).toBeUndefined()
  })

  it('Fake: records the hint so conformance can assert it end-to-end', async () => {
    const handle = await new FakeRuntime().start({ ...startOpts, systemHint: HINT })
    expect(handle.systemHint).toBe(HINT)
    await handle.close()
  })

  // ⛔ **555 · this was titled *"the hint reaches the provider VERBATIM"* and it does not measure
  // arrival** — it measures the HAND-OFF, which is the strongest thing a fake query factory and a
  // fake transport can measure. ⚠️ A title is a claim (standing rule 25), and this one was the
  // withdrawn ruling's own word on the only assertion in the tree that carried it.
  it('the hint is HANDED OVER verbatim — no truncation, no normalization; arrival is not asserted', async () => {
    const long = `${'persona '.repeat(200)}\n- rule one\n- rule two`
    expect(await claudeOptions(long)).toMatchObject({
      systemPrompt: { type: 'preset', preset: 'claude_code', append: long },
    })
    expect((await codexThreadStartParams(long))['developerInstructions']).toBe(long)
  })

  it('NO hint appends nothing on every seam — and Claude still gets its preset (165)', async () => {
    // ⛔ **This asserted `toBeUndefined()` and that WAS the absence** — of the Claude Code preset,
    // not just of our text. The SDK reads an omitted `systemPrompt` as an EMPTY one, so "changes
    // nothing" was changing everything for a session with no instruction file. What the conformance
    // claim is really about is the APPEND, and that is what it asserts now: no hint, no appended
    // field, on all three seams.
    const claude = (await claudeOptions()).systemPrompt
    // ⚑ `snapshot: false` (680): every launch renders its own instructions, as before 0.3.281.
    expect(claude).toEqual({ type: 'preset', preset: 'claude_code', snapshot: false })
    expect('append' in (claude as object)).toBe(false)
    const params = await codexThreadStartParams()
    expect('developerInstructions' in params).toBe(false)
    expect('baseInstructions' in params).toBe(false)
    const fake = await new FakeRuntime().start(startOpts)
    expect(fake.systemHint).toBeUndefined()
    await fake.close()
  })

  /**
   * ⛔ **RESUME re-injects what it is given** (158) — and this block used to assert the opposite.
   *
   * The old assertion pinned a deliberate choice honestly: `ResumeOptions` carried no hint, so
   * adapters had nothing to re-inject and inventing one would have been a lie. 156 measured what
   * that cost — *"a start-only append would make the developer forget who they are after
   * reopening"* — and 158 closed it at the contract rather than at the adapters.
   *
   * ⚠️ **The negative half is the one that still matters**, and it is asserted below unchanged in
   * spirit: a resume given NO hint must send no field. The gap was never that adapters could not
   * do this; it was that nobody was allowed to ask.
   */
  it('RESUME re-injects the hint it is given, on every seam', async () => {
    const transport = new FakeTransport()
    const resumed = await new CodexRuntime(() => transport).resume(
      { provider: 'codex', sessionId: 'th_1', cwd: '/tmp/x', rotation: 0 },
      { providerHome: '/tmp/x/home', systemHint: HINT },
    )
    await resumed.close()
    const params = transport.requests.find((r) => r.method === 'thread/resume')?.params as Record<
      string,
      unknown
    >
    expect(params).toBeDefined()
    // The additive developer layer, exactly as on start — never `baseInstructions`, which would
    // replace the agent's base prompt and the tool guidance in it.
    //
    // ⛔ **555 · not "the 001 approval behaviour"** (HO-062 §2): a resume re-sends
    // `approvalPolicy` and `sandbox` on this same object, which is where that behaviour lives.
    // 🔴 **And a RESUME is where the stated limit bites hardest** — a thread being resumed may
    // already have switched `collaborationMode`, and this re-sent layer is then superseded from
    // that switch onwards. The field is still sent; what it is worth afterwards is not asserted
    // here and cannot be.
    expect(params['developerInstructions']).toBe(HINT)
    expect('baseInstructions' in params).toBe(false)

    // The Fake mirrors it: a resumed handle records the hint the resume was handed.
    const fakeRuntime = new FakeRuntime()
    const started = await fakeRuntime.start({ ...startOpts, systemHint: HINT })
    await started.close()
    const fakeResumed = await fakeRuntime.resume(started.ref, {
      providerHome: startOpts.providerHome,
      systemHint: HINT,
    })
    expect(fakeResumed.systemHint).toBe(HINT)
    await fakeResumed.close()
  })

  it('…and a resume with NO hint still sends none — adapters may not fabricate one', async () => {
    const transport = new FakeTransport()
    const resumed = await new CodexRuntime(() => transport).resume(
      { provider: 'codex', sessionId: 'th_1', cwd: '/tmp/x', rotation: 0 },
      { providerHome: '/tmp/x/home' },
    )
    await resumed.close()
    const params = transport.requests.find((r) => r.method === 'thread/resume')?.params as Record<
      string,
      unknown
    >
    expect(params).toBeDefined()
    expect('developerInstructions' in params).toBe(false)

    // ⚠️ And the Fake must not carry a hint forward from the START it once had — a resume reports
    // what THIS launch was given, which is the whole reason the host re-reads rather than replays.
    const fakeRuntime = new FakeRuntime()
    const started = await fakeRuntime.start({ ...startOpts, systemHint: HINT })
    await started.close()
    const fakeResumed = await fakeRuntime.resume(started.ref, {
      providerHome: startOpts.providerHome,
    })
    expect(fakeResumed.systemHint).toBeUndefined()
    await fakeResumed.close()
  })
})

/**
 * **`ProviderRuntimeContext.signal` — cancelling a launch must reach the CHILD, not the awaiter**
 * (070, from 068 findings 2 and 7).
 *
 * ⚠️ **The assertion that matters is teardown, not rejection.** An `AbortSignal` idiomatically means
 * "stop waiting", and here that is the wrong half: a `start()` that rejects while its app-server
 * keeps running is the exact failure this field exists to close — *"a detached provider can outlive
 * BroBot"*. So every case below asserts a transport or query was CLOSED, and the rejection is the
 * secondary claim.
 *
 * Per-seam rather than through the `Driver`, like the `systemHint` block above, because the fact
 * being pinned is about how each adapter builds its provider — which is precisely the thing the
 * neutral driver hides.
 */
describe('launch cancellation (070)', () => {
  const startOpts = { cwd: '/tmp/x', providerHome: '/tmp/x/home' }

  /**
   * A transport that never answers its handshake — the interval a cancel has to reach into.
   *
   * Its pending requests are rejected by `close()`, which is the real transport's own contract:
   * *"`transport.request` settles when the child answers, when it EXITS, or when the transport is
   * closed"*. A fake that left them hanging would make the cancel look like it had done nothing.
   */
  class SilentTransport extends FakeTransport {
    closes = 0
    private shut = false
    private readonly waiting: ((reason: Error) => void)[] = []
    override request(method: string, params?: unknown): Promise<unknown> {
      // ⚠️ A request made AFTER the close must reject too, not join the queue of the never-answered.
      // The cancel lands while the handshake is still at `initialize`, so `thread/resume` is issued
      // to an already-closed transport — and a fake that accepted it would hang the launch forever
      // and make the cancel look inert.
      if (this.shut) return Promise.reject(new Error('transport closed'))
      if (method === 'thread/start' || method === 'thread/resume') {
        return new Promise((_resolve, reject) => this.waiting.push(reject))
      }
      return super.request(method, params)
    }
    override close(): void {
      this.closes += 1
      this.shut = true
      for (const reject of this.waiting.splice(0)) reject(new Error('transport closed'))
      super.close()
    }
  }

  it('Codex: a cancel during the handshake CLOSES the transport that was already spawned', async () => {
    const transport = new SilentTransport()
    const control = new AbortController()
    const starting = new CodexRuntime(() => transport).start({
      ...startOpts,
      signal: control.signal,
    })
    void starting.catch(() => {})

    // 068's measurement: the detached child exists from `transportFactory` onward, and `begin()`
    // has not answered — so no handle exists and nothing else in the system can reach it.
    expect(transport.closes).toBe(0)
    control.abort()
    await waitUntil(() => transport.closes > 0, 'the transport to be closed')
  })

  it('Codex: an already-cancelled launch spawns NOTHING', async () => {
    let built = 0
    const control = new AbortController()
    control.abort()

    await expect(
      new CodexRuntime(() => {
        built += 1
        return new FakeTransport()
      }).start({ ...startOpts, signal: control.signal }),
    ).rejects.toThrow('cancelled before it started')
    // Refused above the preconditions and above the factory: a cancelled launch must leave no state
    // to unwind, and the only way to promise that is to create none.
    expect(built).toBe(0)
  })

  it('Codex: a resume cancels the same way, and reports it as a resume failure', async () => {
    const transport = new SilentTransport()
    const control = new AbortController()
    const resuming = new CodexRuntime(() => transport).resume(
      { provider: 'codex', sessionId: 'th_1', cwd: '/tmp/x', rotation: 0 },
      { providerHome: '/tmp/x/home', signal: control.signal },
    )
    void resuming.catch(() => {})

    control.abort()
    await waitUntil(() => transport.closes > 0, 'the transport to be closed')
    await expect(resuming).rejects.toThrow(ResumeError)
  })

  it('Codex: a cancel AFTER the handle arrives does not touch the live session', async () => {
    const transport = new FakeTransport()
    let closes = 0
    const counted = Object.assign(transport, {
      close: () => {
        closes += 1
      },
    })
    const control = new AbortController()
    const handle = await new CodexRuntime(() => counted).start({
      ...startOpts,
      signal: control.signal,
    })

    // ⚠️ The other direction, and it is not hypothetical: the host holds one controller for a
    // launch's whole life and aborts every one of them on quit. A listener left wired here would
    // close a RUNNING conversation's transport from underneath it, out of order with the finalizer.
    control.abort()
    await new Promise((resolve) => setTimeout(resolve, 10))
    expect(closes).toBe(0)
    await handle.close()
  })

  /**
   * ⛔ **A cancel that has ALREADY landed by the time the transport exists still closes it** (180).
   *
   * Until 180 nothing could get between a launch's `assertNotCancelled` and its spawn — the whole
   * prologue was synchronous, so an abort was either before both or after both. The per-home boot
   * gate put an `await` there, and `addEventListener('abort')` on a signal that has already fired
   * never runs: the child would spawn with nobody wired to reap it, which is 070's leak one line to
   * the left. Asserted on the interval itself rather than through `start`, so it stays true whatever
   * the prologue does next.
   */
  it('Codex: a cancel that lands DURING the boot gate still closes the spawned transport', async () => {
    const transport = new SilentTransport()
    const control = new AbortController()
    // The gate's wait, stood in for: the abort happens while the launch is between its cancel check
    // and its spawn, so `cancelWith` meets a signal that is already aborted.
    control.abort()
    const cancel = cancelWith(control.signal, () => transport.close())
    await waitUntil(() => transport.closes > 0, 'the transport to be closed')
    expect(cancel.cancelled).toBe(true)
    cancel.release()
  })

  it('Claude: a cancel during the model probe closes the query', async () => {
    const probe = new FakeQuery()
    let closed = 0
    let started = false
    const control = new AbortController()
    const runtime = new ClaudeRuntime(
      () => {
        started = true
        return Object.assign(probe, {
          supportedModels: () =>
            new Promise<never>(() => {
              /* the CLI that is alive but silent — 15 s, bounded, in the real one */
            }),
          close: () => {
            closed += 1
          },
        })
      },
      async () => true,
    )
    const asking = runtime.listModels({ providerHome: '/tmp/x/home', signal: control.signal })
    void asking.catch(() => {})

    await waitUntil(() => started, 'the probe query to start')
    control.abort()
    await waitUntil(() => closed > 0, 'the probe query to be closed')
  })

  it('Claude: an already-cancelled start or probe creates no query', async () => {
    let built = 0
    const control = new AbortController()
    control.abort()
    const runtime = new ClaudeRuntime(
      () => {
        built += 1
        return new FakeQuery()
      },
      async () => true,
    )

    await expect(runtime.start({ ...startOpts, signal: control.signal })).rejects.toThrow(
      'cancelled before it started',
    )
    await expect(
      runtime.listModels({ providerHome: '/tmp/x/home', signal: control.signal }),
    ).rejects.toThrow('cancelled before it started')
    expect(built).toBe(0)
  })

  it('Claude: a resume cancelled during its on-disk precheck never reaches the query', async () => {
    let built = 0
    const control = new AbortController()
    const runtime = new ClaudeRuntime(
      () => {
        built += 1
        return new FakeQuery()
      },
      async () => {
        // The first await this launch makes. A cancel landing here must stop BEFORE the query below
        // spawns a CLI — after it, the only thing that could close it is a handle nobody receives.
        control.abort()
        return true
      },
    )

    await expect(
      runtime.resume(
        { provider: 'claude', sessionId: 's_1', cwd: '/tmp/x', rotation: 0 },
        { providerHome: '/tmp/x/home', signal: control.signal },
      ),
    ).rejects.toThrow(ResumeError)
    expect(built).toBe(0)
  })

  /**
   * 🔴 **705 · the second await, after the spawn** — the resume asks the spawn's witness whether it
   * failed (R39) and then goes on to attach. ⛔ A cancel that lands there is AFTER the query exists,
   * so the only thing that can close it is the adapter's own catch: the resume must reject and close
   * the query, never hand back a handle the caller has abandoned.
   */
  it('Claude: a resume cancelled after its query is built closes the query and rejects', async () => {
    let closed = 0
    const control = new AbortController()
    const runtime = new ClaudeRuntime(
      () => {
        // ⚑ the cancel lands with the query built and the spawn check still to come
        control.abort()
        return Object.assign(new FakeQuery(), {
          close: () => {
            closed += 1
          },
        })
      },
      async () => true,
    )

    await expect(
      runtime.resume(
        { provider: 'claude', sessionId: 's_1', cwd: '/tmp/x', rotation: 0 },
        { providerHome: '/tmp/x/home', signal: control.signal },
      ),
    ).rejects.toThrow(ResumeError)
    expect(closed).toBe(1)
  })

  it('⚑ control: the same resume, not cancelled, hands back its handle and closes nothing', async () => {
    let closed = 0
    const runtime = new ClaudeRuntime(
      () =>
        Object.assign(new FakeQuery(), {
          close: () => {
            closed += 1
          },
        }),
      async () => true,
    )
    const handle = await runtime.resume(
      { provider: 'claude', sessionId: 's_1', cwd: '/tmp/x', rotation: 0 },
      { providerHome: '/tmp/x/home', signal: new AbortController().signal },
    )
    expect(closed).toBe(0)
    await handle.close()
  })

  /**
   * 🔴 **707 · the same await, on a START** — `start()` now asks the spawn's witness too (R39,
   * extended), so a start is no longer a launch that *"awaits nothing"*. ⛔ A cancel that lands there
   * is AFTER the query exists: the start must reject and close it, never hand back a handle the
   * caller has abandoned (070).
   */
  /**
   * ⚑ **ONE rig for the pair** (review, round two): a child that spawned and is RUNNING — pid, three
   * pipes, no error — so the witness really waits its macrotask (`spawnFailure()`), which a query
   * that never spawns skips; the arms differ in the cancel alone.
   */
  const aStartOverARunningChild = (
    cancelInsideTheWait: boolean,
  ): { readonly started: Promise<unknown>; closed: () => number; exit: () => void } => {
    let closed = 0
    const control = new AbortController()
    const child = Object.assign(new EventEmitter(), {
      pid: 4242,
      stdin: new PassThrough(),
      stdout: new PassThrough(),
      stderr: new PassThrough(),
      killed: false,
      exitCode: null,
      kill: () => true,
    })
    const runtime = new ClaudeRuntime(
      (params: { options?: Options }) => {
        params.options?.spawnClaudeCodeProcess?.({
          command: 'claude',
          args: [],
          cwd: '/tmp/x',
          env: {},
          signal: new AbortController().signal,
        } as never)
        // ⛔ **The cancel lands INSIDE the witness's wait** (`707`'s review): queued now, it runs
        // before the macrotask `spawnFailure()` queues next — so a check asked BEFORE that wait would
        // pass, and a handle would go back to a caller that has abandoned it.
        if (cancelInsideTheWait) setImmediate(() => control.abort())
        return Object.assign(new FakeQuery(), {
          close: () => {
            closed += 1
          },
        })
      },
      undefined,
      undefined,
      undefined,
      () => child as never,
    )
    return {
      started: runtime.start({
        cwd: '/tmp/x',
        providerHome: '/tmp/x/home',
        signal: control.signal,
      }),
      closed: () => closed,
      exit: () => child.emit('exit', 0, null),
    }
  }

  it('Claude: a start cancelled after its query is built closes the query and rejects', async () => {
    const start = aStartOverARunningChild(true)
    await expect(start.started).rejects.toThrow('cancelled')
    expect(start.closed()).toBe(1)
  })

  it('⚑ control: the same start, not cancelled, hands back its handle and closes nothing', async () => {
    const start = aStartOverARunningChild(false)
    const handle = (await start.started) as { close: () => Promise<void> }
    expect(start.closed()).toBe(0)
    start.exit()
    await handle.close()
  })

  it('Fake: honours the cancel too, so a host test cannot pass against a runtime that ignores it', async () => {
    const control = new AbortController()
    control.abort()
    const runtime = new FakeRuntime()

    // The vacuity 068 named in a neighbouring finding: a guard proved by the shape of the source
    // rather than by behaviour. Every host-level ownership test in `apps/desktop` drives this
    // double, so the double has to be the contract.
    await expect(
      runtime.start({ cwd: '/tmp/x', providerHome: '/tmp/x/home', signal: control.signal }),
    ).rejects.toThrow('cancelled before it started')
    await expect(
      runtime.listModels({ providerHome: '/tmp/x/home', signal: control.signal }),
    ).rejects.toThrow('cancelled before it started')
  })
})
