import type { Options, PermissionUpdate } from '@anthropic-ai/claude-agent-sdk'
import { describe, expect, it, vi } from 'vitest'
import { type RuntimeEvent } from '../src/index'
import { MAX_PERMISSION_DETAIL_CHARS, runtimeEventSchema } from '../src/events'
import {
  init,
  firstOfType,
  has,
  toolOpts,
  CLI_SUGGESTS,
  sdkToolCall,
  startFake,
} from './fake-claude-query'

describe('waiting on the user is not silence (076)', () => {
  /**
   * Drive a turn to an open `user_input_request` and leave it unanswered.
   *
   * ⚠️ **All three tests below used to answer `q1`, and the card's only question is `q0`** (found by
   * 142, not by 141). The answer was therefore incomplete AND addressed to an id that did not
   * exist — a shape the adapter has failed closed since 033 — and the tests passed anyway, because
   * the wait lease comes down whichever way the continuation exits. What they meant to assert about
   * status was never wrong; what they demonstrated was that the status half survives an answer the
   * adapter refuses, which is not what any of them says it is doing. Answering `q0` is the whole
   * fix, and 142's refusal-at-the-gesture is what made the three of them go red and say so.
   */
  async function awaitingAnswer() {
    const ctx = await startFake()
    ctx.fq.emit(init('sess_1', '/tmp/x'))
    await vi.waitFor(has(ctx.events, (e) => e.type === 'session'))
    await ctx.handle.send('ask me something')
    const pending = ctx.canUse(
      'AskUserQuestion',
      { questions: [{ question: 'which one?', options: ['a', 'b'] }] },
      toolOpts('tu_ask'),
    )
    await vi.waitFor(has(ctx.events, (e) => e.type === 'user_input_request'))
    return { ...ctx, pending }
  }

  it('the status is waiting_permission while a question is open — not working', async () => {
    const { handle, events, consumer, fq, pending } = await awaitingAnswer()

    expect(handle.status()).toBe('waiting_permission')
    // Non-vacuous: the request really is open and unanswered.
    expect(events.filter((e) => e.type === 'user_input_request')).toHaveLength(1)
    // …and the watchdog is genuinely disarmed for this state, not merely silent by luck.
    const watchdog = (handle as unknown as { stallWatchdog: { armed: boolean } }).stallWatchdog
    expect(watchdog.armed, 'the watchdog must be disarmed while waiting on the user').toBe(false)

    await handle.respondUserInput('tu_ask', { kind: 'answer', answers: { q0: 'a' } })
    await pending
    fq.end()
    await handle.close()
    await consumer
  })

  it('the stall watchdog does not ping while the person is thinking', async () => {
    // Before the fix the await sat on `working`, so the watchdog counted the user's own thinking
    // time as provider silence and pinged "no activity for 120s" at a question it had itself asked.
    const { handle, events, consumer, fq, pending } = await awaitingAnswer()

    // Fire the watchdog directly: the wiring only reports while a turn is genuinely working.
    const withStall = handle as unknown as { reportStall(ms: number): void }
    withStall.reportStall(120_000)
    await new Promise((r) => setTimeout(r, 20))

    expect(
      events.filter((e) => e.type === 'error' && /no activity/.test(e.message)),
      'no stall ping may fire while a question is open',
    ).toHaveLength(0)

    await handle.respondUserInput('tu_ask', { kind: 'answer', answers: { q0: 'a' } })
    await pending
    fq.end()
    await handle.close()
    await consumer
  })

  it('after the answer the status returns to working and a GENUINE stall still pings', async () => {
    // The fix must not disable the watchdog — only stop counting the wait.
    const { handle, events, consumer, fq, pending } = await awaitingAnswer()
    await handle.respondUserInput('tu_ask', { kind: 'answer', answers: { q0: 'a' } })
    await pending
    await vi.waitFor(() => expect(handle.status()).toBe('working'))

    const withStall = handle as unknown as { reportStall(ms: number): void }
    withStall.reportStall(120_000)
    await vi.waitFor(has(events, (e) => e.type === 'error' && /no activity/.test(e.message)))

    fq.end()
    await handle.close()
    await consumer
  })

  it('a shutting-down session still leaves the status off waiting_permission', async () => {
    // The mirror bug: a status stuck on `waiting_permission` would disarm the watchdog for good.
    const { handle, consumer, fq, pending } = await awaitingAnswer()
    await handle.close()
    await pending
    expect(handle.status()).toBe('ended')
    fq.end()
    await consumer
  })
})

describe('the WHOLESALE session grant an opaque tool can be asked for (058)', () => {
  /**
   * 031's measurement, made deliberate.
   *
   * The narrow grant is scoped to what a card disclosed, so an opaque tool — whose card discloses a
   * command string we refuse to decompose — was offered none, and the tool with the worst approval
   * fatigue became the only one offered no relief. `allow_all_for_session` is the honest version of
   * the grant it was refused: it really does cover every later call, so the only way to have it is
   * to press a button that says so.
   *
   * ⚠️ Every test here runs the call through {@link sdkToolCall} rather than poking `canUseTool`,
   * because the thing under test is a POLICY — whether the guard yields — and calling the callback
   * directly is exactly the vacuous shape 050 removed.
   */
  it('is offered to an opaque tool, and never to a disclosed one — and since 736 beside the CLI’s own rule, as another button', async () => {
    const { fq, handle, events, consumer, sdkOptions } = await startFake()
    void sdkToolCall(sdkOptions(), 'Bash', { command: 'echo ALPHA' }, toolOpts('tu_1'))
    await vi.waitFor(has(events, (e) => e.type === 'permission_request'))
    const opaque = firstOfType(events, 'permission_request')

    expect(opaque.scope.availableDecisions).toContain('allow_all_for_session')
    expect(opaque.scope.availableDecisions).not.toContain('allow_for_session')
    await handle.respondPermission(opaque.id, { outcome: 'deny' })

    // …and the complement: a fully-disclosed file tool is offered the narrow grant — the CLI's own
    // rule, where it suggested one (736, R94) — and NOT the wide one.
    events.length = 0
    void sdkToolCall(
      sdkOptions(),
      'Write',
      { file_path: '/tmp/x/a.txt' },
      toolOpts('tu_2', CLI_SUGGESTS.write),
    )
    await vi.waitFor(has(events, (e) => e.type === 'permission_request'))
    const disclosed = firstOfType(events, 'permission_request')
    expect(disclosed.scope.availableDecisions).toContain('allow_for_session')
    expect(disclosed.scope.availableDecisions).not.toContain('allow_all_for_session')
    await handle.respondPermission(disclosed.id, { outcome: 'deny' })

    // 🔴 **736 · R94 — an opaque card whose CLI suggested its own rule carries BOTH**, as two buttons:
    // the CLI's rule for the conversation, and this app's whole tool. ⛔ On `main` an opaque card was
    // never offered `allow_for_session` (058's *"no card offers both"*). ⚑ Each button carries its own
    // `grants`, so 058's *"not reachable by the same click"* still holds. ⚑ `740` · `make build`'s
    // prefix rule, as the SDK hands it (an `rm`'s own rule is not the CLI's to offer, R99).
    events.length = 0
    void sdkToolCall(
      sdkOptions(),
      'Bash',
      { command: 'make build' },
      toolOpts('tu_3', CLI_SUGGESTS.make),
    )
    await vi.waitFor(has(events, (e) => e.type === 'permission_request'))
    const both = firstOfType(events, 'permission_request')
    expect(both.scope.availableDecisions).toContain('allow_for_session')
    expect(both.scope.availableDecisions).toContain('allow_all_for_session')
    expect(both.scope.grants?.allow_for_session).not.toEqual(
      both.scope.grants?.allow_all_for_session,
    )
    await handle.respondPermission(both.id, { outcome: 'deny' })

    // ⚑ …and where the CLI's own rule already IS the whole tool (an MCP tool's), the whole-tool
    // button is not drawn a second time.
    events.length = 0
    void sdkToolCall(
      sdkOptions(),
      'mcp__srv__do_it',
      { note: 'x' },
      toolOpts('tu_4', [
        {
          type: 'addRules',
          rules: [{ toolName: 'mcp__srv__do_it' }],
          behavior: 'allow',
          destination: 'localSettings',
        },
      ]),
    )
    await vi.waitFor(has(events, (e) => e.type === 'permission_request'))
    const mcp = firstOfType(events, 'permission_request')
    expect(mcp.scope.availableDecisions).toEqual([
      'allow',
      'allow_for_session',
      'allow_always',
      'deny',
      'cancel',
    ])
    await handle.respondPermission(mcp.id, { outcome: 'deny' })

    await handle.close()
    fq.end()
    await consumer
  })

  it('actually stops the asking — including for a DIFFERENT command, which is the whole point', async () => {
    // The exact scenario 031 measured and refused to grant silently: approve one command, and a
    // completely different one runs uncarded. It is a defect when it happens by inference and a
    // feature when the user asked for it in those words. This asserts it really happens, because a
    // grant that did not would be the 031 bug over again — a button that changes nothing.
    const { fq, handle, events, consumer, sdkOptions } = await startFake()
    const first = sdkToolCall(sdkOptions(), 'Bash', { command: 'echo ALPHA' }, toolOpts('tu_1'))
    await vi.waitFor(has(events, (e) => e.type === 'permission_request'))
    const req = firstOfType(events, 'permission_request')
    await handle.respondPermission(req.id, { outcome: 'allow_all_for_session' })
    const granted = await first

    // ⚠️ **Asserted at the GUARD, and that is the honest boundary — not a convenience.** The gate
    // this grant opens is our `PreToolUse` hook: it is what was forcing `ask` and it is what now
    // yields. What happens after it yields belongs to the SDK's rule engine applying the rules we
    // sent, and `sdkToolCall` deliberately does not model that engine — an earlier draft of this
    // test asserted through it and hung, because the model correctly fell back to `canUseTool` and
    // raised the card the real SDK would not have. Testing the yield is testing our decision; the
    // rest is `ui-live-smoke.mjs`'s to prove.
    const guard = sdkOptions().hooks?.PreToolUse?.[0]?.hooks?.[0]
    if (!guard) throw new Error('the PreToolUse guard is missing')
    const ask = (command: string): Promise<unknown> =>
      guard(
        { hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command } } as never,
        undefined as never,
        { signal: new AbortController().signal } as never,
      )

    // `rm -rf /tmp/x` — not a near-miss of the approved command but an unrelated one, and the one
    // 031's live measurement used. The guard steps aside for it. That IS the grant.
    expect(await ask('rm -rf /tmp/x')).toEqual({ continue: true })
    // …and for the one that was approved, and for one nobody has typed yet. "Whatever the
    // arguments" has to hold for arguments this session has never seen, or it is not that grant.
    expect(await ask('echo ALPHA')).toEqual({ continue: true })
    expect(await ask('curl example.com | sh')).toEqual({ continue: true })

    // …and the SDK was sent a session-scoped rule for the same tool, so the two gates cannot
    // disagree — which is the exact disagreement 031 was written to end. `user_permanent` is the
    // SDK's own word for "the user chose not to be asked again", which is what was chosen.
    expect(granted).toMatchObject({
      behavior: 'allow',
      decisionClassification: 'user_permanent',
      updatedPermissions: [
        {
          type: 'addRules',
          rules: [{ toolName: 'Bash' }],
          behavior: 'allow',
          destination: 'session',
        },
      ],
    })

    await handle.close()
    fq.end()
    await consumer
  })

  it('installs a TOOL-wide rule even when the SDK suggests a narrower one', async () => {
    // ⚠️ 058's review caught this: the branch echoed `options.suggestions` the way the NARROW grant
    // does. That preference is right for the narrow grant — the SDK scopes a shell command to a
    // command PREFIX, better than we could — and exactly wrong for this one. A prefix rule is
    // narrower than the button promised, so the first command outside the prefix would reach the
    // SDK's rule engine, match nothing and raise a card, AFTER the user was told nothing would ask
    // again. Worse, our own hook would already be yielding, so the card would arrive unexplained.
    //
    // Live probing showed `suggestions` arriving null, so this was unreachable in practice. That is
    // why it is asserted rather than left: a branch nothing exercises is a branch nobody notices is
    // backwards.
    const suggestion: PermissionUpdate[] = [
      {
        type: 'addRules',
        rules: [{ toolName: 'Bash', ruleContent: 'echo ALPHA:*' }],
        behavior: 'allow',
        destination: 'session',
      },
    ]
    const { fq, handle, events, consumer, sdkOptions } = await startFake()
    const call = sdkToolCall(
      sdkOptions(),
      'Bash',
      { command: 'echo ALPHA' },
      toolOpts('tu_1', suggestion),
    )
    await vi.waitFor(has(events, (e) => e.type === 'permission_request'))
    await handle.respondPermission(firstOfType(events, 'permission_request').id, {
      outcome: 'allow_all_for_session',
    })
    const granted = await call

    // The plain tool rule, with the suggestion's `ruleContent` nowhere in it.
    expect(granted).toMatchObject({
      updatedPermissions: [
        {
          type: 'addRules',
          rules: [{ toolName: 'Bash' }],
          behavior: 'allow',
          destination: 'session',
        },
      ],
    })
    expect(JSON.stringify(granted)).not.toContain('echo ALPHA:*')

    await handle.close()
    fq.end()
    await consumer
  })

  it('does not leak to a different tool — it is wide within one tool, not across them', async () => {
    const { fq, handle, events, consumer, sdkOptions } = await startFake()
    void sdkToolCall(sdkOptions(), 'Bash', { command: 'echo ALPHA' }, toolOpts('tu_1'))
    await vi.waitFor(has(events, (e) => e.type === 'permission_request'))
    await handle.respondPermission(firstOfType(events, 'permission_request').id, {
      outcome: 'allow_all_for_session',
    })

    events.length = 0
    // A file write is a different tool and was never granted. "Wholesale" is bounded by the tool the
    // card named; a grant that spread across tools would grant something no card was ever shown for.
    void sdkToolCall(sdkOptions(), 'Write', { file_path: '/tmp/x/a.txt' }, toolOpts('tu_2'))
    await vi.waitFor(has(events, (e) => e.type === 'permission_request'))
    await handle.respondPermission(firstOfType(events, 'permission_request').id, {
      outcome: 'deny',
    })

    await handle.close()
    fq.end()
    await consumer
  })

  it('is DISCLOSED for the rest of the session, because the card that made it scrolls away', async () => {
    // 031 made disclosure a hard rule for what a card grants at the moment it is answered. A grant
    // that outlives its card breaks that rule unless something else carries it, and this is that
    // something: the handle reports it, the host copies it onto the liveness channel, the header
    // shows it. Empty before, named after — and a plain `allow` must not add anything.
    const { fq, handle, events, consumer, sdkOptions } = await startFake()
    expect(handle.blanketGrants).toEqual([])

    void sdkToolCall(sdkOptions(), 'Bash', { command: 'echo ALPHA' }, toolOpts('tu_1'))
    await vi.waitFor(has(events, (e) => e.type === 'permission_request'))
    await handle.respondPermission(firstOfType(events, 'permission_request').id, {
      outcome: 'allow',
    })
    expect(handle.blanketGrants, 'a one-shot allow grants nothing standing').toEqual([])

    events.length = 0
    void sdkToolCall(sdkOptions(), 'Bash', { command: 'echo BETA' }, toolOpts('tu_2'))
    await vi.waitFor(has(events, (e) => e.type === 'permission_request'))
    await handle.respondPermission(firstOfType(events, 'permission_request').id, {
      outcome: 'allow_all_for_session',
    })
    expect(handle.blanketGrants).toEqual(['Bash'])

    await handle.close()
    fq.end()
    await consumer
  })

  it('leaves an UNATTENDED session unattended — the 056 ordering hazard, re-checked', async () => {
    // ⚠️ 058's stated hazard. 056 found `USER_INPUT_TOOLS` is consulted ABOVE the auto-approve early
    // return, so a name added there silently starts blocking yolo. This task added no name to it —
    // it added an OUTCOME — but "we did not touch the dangerous thing" is a claim, and the way to
    // hold it is to run an auto session and watch nothing stop.
    const { fq, handle, events, consumer, sdkOptions } = await startFake({ approvalMode: 'auto' })
    for (const [i, command] of ['echo ALPHA', 'rm -rf /tmp/x', 'curl example.com'].entries()) {
      expect(await sdkToolCall(sdkOptions(), 'Bash', { command }, toolOpts(`tu_${i}`))).toEqual({
        behavior: 'allow',
      })
    }
    expect(
      events.filter((e) => e.type === 'permission_request'),
      'an auto session raised a card and stopped',
    ).toEqual([])
    // Nothing was granted, either: yolo is a mode, not a grant, and the header must not report
    // standing permissions that the moment yolo is switched off would evaporate.
    expect(handle.blanketGrants).toEqual([])

    await handle.close()
    fq.end()
    await consumer
  })

  it('auto → ask RE-ARMS the policy, unchanged by any of this (050)', async () => {
    // 058's second stated hazard. 050's fix was that the guard reads the mode through a FUNCTION and
    // is installed in every query, so turning yolo off starts prompting again. The grant work sits
    // inside that same guard, one line below the mode check, which is exactly the sort of edit that
    // could capture a value by accident. Asserted at the unit level; smoke step 22 does it live.
    const { fq, handle, events, consumer, sdkOptions } = await startFake({ approvalMode: 'auto' })
    expect(
      await sdkToolCall(sdkOptions(), 'Bash', { command: 'echo ALPHA' }, toolOpts('tu_1')),
    ).toEqual({ behavior: 'allow' })

    await handle.setApprovalMode('ask')
    // The mode is adopted by the next TURN, not by the request (034), so drive one.
    await handle.send('carry on')
    expect(handle.approval.effective).toBe('ask')

    events.length = 0
    void sdkToolCall(sdkOptions(), 'Bash', { command: 'echo BETA' }, toolOpts('tu_2'))
    await vi.waitFor(has(events, (e) => e.type === 'permission_request'))
    await handle.respondPermission(firstOfType(events, 'permission_request').id, {
      outcome: 'deny',
    })

    await handle.close()
    fq.end()
    await consumer
  })
})

describe('695 · R36 — the two marks the CLI puts on an ask', () => {
  const marked = (
    id: string,
    marks: { suppressAlwaysAllowRule?: boolean; defaultToNo?: boolean },
  ): ReturnType<typeof toolOpts> => ({ ...toolOpts(id), ...marks }) as ReturnType<typeof toolOpts>

  const SESSION_GRANTS = ['allow_for_session', 'allow_all_for_session'] as const

  it('R36a · a marked OPAQUE ask offers neither session grant, promises `once`, and refuses one pressed', async () => {
    const { fq, handle, events, consumer, sdkOptions } = await startFake()
    void sdkToolCall(
      sdkOptions(),
      'Bash',
      { command: 'echo r36 &' },
      marked('tu_1', { suppressAlwaysAllowRule: true }),
    )
    await vi.waitFor(has(events, (e) => e.type === 'permission_request'))
    const card = firstOfType(events, 'permission_request')
    expect(card.suppressAlwaysAllowRule).toBe(true)
    for (const grant of SESSION_GRANTS) expect(card.scope.availableDecisions).not.toContain(grant)
    expect(card.scope.availableDecisions).toEqual(['allow', 'deny', 'cancel'])
    expect(card.scope.persistence).toBe('once')
    await expect(
      handle.respondPermission(card.id, { outcome: 'allow_all_for_session' }),
    ).rejects.toThrow(/not offered/)
    await handle.respondPermission(card.id, { outcome: 'deny' })

    // ⚑ The control, one fact over — the same command UNMARKED keeps today's wide grant.
    events.length = 0
    void sdkToolCall(sdkOptions(), 'Bash', { command: 'echo r36 &' }, toolOpts('tu_2'))
    await vi.waitFor(has(events, (e) => e.type === 'permission_request'))
    const control = firstOfType(events, 'permission_request')
    expect(control.scope.availableDecisions).toContain('allow_all_for_session')
    expect(control.scope.persistence).toBe('session')
    // ⛔ And an unmarked card carries no mark at all — byte-identical to one from before 695.
    expect('suppressAlwaysAllowRule' in control).toBe(false)
    expect('defaultToNo' in control).toBe(false)
    await handle.respondPermission(control.id, { outcome: 'deny' })

    await handle.close()
    fq.end()
    await consumer
  })

  it('R36a · a marked DISCLOSED ask loses the narrow grant too — the control offers it', async () => {
    const { fq, handle, events, consumer, sdkOptions } = await startFake()
    // ⚑ 736 · both with the CLI's own suggestion, so the MARK is the one fact apart (R94: the offer
    // follows the suggestion; a marked ask withholds it anyway, as the CLI's own prompt does).
    void sdkToolCall(
      sdkOptions(),
      'Write',
      { file_path: '/tmp/x/a.txt' },
      { ...marked('tu_1', { suppressAlwaysAllowRule: true }), suggestions: CLI_SUGGESTS.write },
    )
    await vi.waitFor(has(events, (e) => e.type === 'permission_request'))
    const card = firstOfType(events, 'permission_request')
    expect(card.scope.availableDecisions).not.toContain('allow_for_session')
    expect(card.scope.persistence).toBe('once')
    await handle.respondPermission(card.id, { outcome: 'deny' })

    events.length = 0
    void sdkToolCall(
      sdkOptions(),
      'Write',
      { file_path: '/tmp/x/a.txt' },
      toolOpts('tu_2', CLI_SUGGESTS.write),
    )
    await vi.waitFor(has(events, (e) => e.type === 'permission_request'))
    expect(firstOfType(events, 'permission_request').scope.availableDecisions).toContain(
      'allow_for_session',
    )
    await handle.respondPermission(firstOfType(events, 'permission_request').id, {
      outcome: 'deny',
    })

    await handle.close()
    fq.end()
    await consumer
  })

  it('R36a · 736 — a marked ask whose CLI suggested a KEPT rule offers no Always allow either, and refuses one pressed', async () => {
    // ⚑ `736`'s review: every R36a test above passed no settings-file suggestion, so nothing asked
    // whether the mark withholds R95's `allow_always` — the CLI's own marked prompt hides it.
    const { fq, handle, events, consumer, sdkOptions } = await startFake()
    // ⚑ `740` · `make build`'s kept rule (the SDK's `bash-make`): an `rm` offers no *always* at all now.
    void sdkToolCall(
      sdkOptions(),
      'Bash',
      { command: 'make build' },
      { ...marked('tu_1', { suppressAlwaysAllowRule: true }), suggestions: CLI_SUGGESTS.make },
    )
    await vi.waitFor(has(events, (e) => e.type === 'permission_request'))
    const card = firstOfType(events, 'permission_request')
    expect(card.scope.availableDecisions).toEqual(['allow', 'deny', 'cancel'])
    expect(card.scope.persistence).toBe('once')
    await expect(handle.respondPermission(card.id, { outcome: 'allow_always' })).rejects.toThrow(
      /not offered/,
    )
    await handle.respondPermission(card.id, { outcome: 'deny' })

    // ⚑ THE CONTROL, one fact over — the same ask UNMARKED offers it.
    events.length = 0
    void sdkToolCall(
      sdkOptions(),
      'Bash',
      { command: 'make build' },
      toolOpts('tu_2', CLI_SUGGESTS.make),
    )
    await vi.waitFor(has(events, (e) => e.type === 'permission_request'))
    const control = firstOfType(events, 'permission_request')
    expect(control.scope.availableDecisions).toContain('allow_always')
    await handle.respondPermission(control.id, { outcome: 'deny' })

    await handle.close()
    fq.end()
    await consumer
  })

  it('R36b · `defaultToNo` rides the card and moves nothing in the offer', async () => {
    const { fq, handle, events, consumer, sdkOptions } = await startFake()
    void sdkToolCall(
      sdkOptions(),
      'Bash',
      { command: 'rm -rf ./build' },
      marked('tu_1', { defaultToNo: true }),
    )
    await vi.waitFor(has(events, (e) => e.type === 'permission_request'))
    const card = firstOfType(events, 'permission_request')
    expect(card.defaultToNo).toBe(true)
    expect('suppressAlwaysAllowRule' in card).toBe(false)
    // ⚑ The ORDER is the renderer's (`permission-offer.ts`); the adapter's offer is today's.
    expect(card.scope.availableDecisions).toContain('allow_all_for_session')
    await handle.respondPermission(card.id, { outcome: 'deny' })
    await handle.close()
    fq.end()
    await consumer
  })

  it('a mark sent as `false` is no mark — only `true` is carried', async () => {
    const { fq, handle, events, consumer, sdkOptions } = await startFake()
    void sdkToolCall(
      sdkOptions(),
      'Bash',
      { command: 'echo r36' },
      marked('tu_1', { suppressAlwaysAllowRule: false, defaultToNo: false }),
    )
    await vi.waitFor(has(events, (e) => e.type === 'permission_request'))
    const card = firstOfType(events, 'permission_request')
    expect('suppressAlwaysAllowRule' in card).toBe(false)
    expect('defaultToNo' in card).toBe(false)
    expect(card.scope.availableDecisions).toContain('allow_all_for_session')
    await handle.respondPermission(card.id, { outcome: 'deny' })
    await handle.close()
    fq.end()
    await consumer
  })

  it('the wire keeps both marks — a schema that stripped them would drop them before the ledger', () => {
    const parsed = runtimeEventSchema.parse({
      type: 'permission_request',
      id: 'tu_1',
      kind: 'command',
      action: 'Bash',
      detail: 'echo r36 &',
      scope: {
        cwd: '/tmp/x',
        paths: [],
        networkHosts: [],
        persistence: 'once',
        amendments: [],
        availableDecisions: ['allow', 'deny', 'cancel'],
        underDisclosed: true,
        approvalMode: 'ask',
      },
      suppressAlwaysAllowRule: true,
      defaultToNo: true,
    })
    expect(parsed).toMatchObject({ suppressAlwaysAllowRule: true, defaultToNo: true })
  })
})

/**
 * 🔴 **700 · `695` F-f — the provider's own reason for an ask it marked, carried to the card.**
 *
 * ⚑ **What the CLI sends, measured by `probe:permission-markers` (`695`, CLI 2.1.281) and read from
 * its evidence files** — ⚠️ `decisionReason` rides EVERY ask, not only a marked one:
 *
 * | arm | marked | `decisionReason` |
 * |---|---|---|
 * | `echo r36 &` · 2.1.281 | `suppressAlwaysAllowRule` | *"This command uses the `&` background operator, which defers execution past approval-time safety checks. Approve only if you trust it."* |
 * | `echo r36` · 2.1.281 | — | *"brobot2 requires explicit approval for consequential tools"* — **our own hook's words, echoed back** |
 * | `echo r36 &` · 2.1.218 | — | the `&` sentence above, unmarked |
 *
 * ⛔ So the card carries it only where the provider MARKED the ask, and never where the words are our
 * own hook's: the card calls it *the provider's reason*, and on the second arm that would be false.
 * The CLI's own schema says the field *"may carry ANSI escapes; sanitize before rendering"*.
 */
describe('700 · `695` F-f — the provider’s own reason for an ask it marked', () => {
  const THE_CLIS_OWN =
    'This command uses the `&` background operator, which defers execution past approval-time safety checks. Approve only if you trust it.'

  const asked = (
    id: string,
    extra: { suppressAlwaysAllowRule?: boolean; defaultToNo?: boolean; decisionReason?: string },
  ): ReturnType<typeof toolOpts> => ({ ...toolOpts(id), ...extra }) as ReturnType<typeof toolOpts>

  /** The card one ask raises, answered and cleared so the next ask starts from nothing. */
  async function cardFor(
    started: Awaited<ReturnType<typeof startFake>>,
    toolName: string,
    input: Record<string, unknown>,
    opts: ReturnType<typeof toolOpts>,
  ): Promise<Extract<RuntimeEvent, { type: 'permission_request' }>> {
    started.events.length = 0
    void sdkToolCall(started.sdkOptions(), toolName, input, opts)
    await vi.waitFor(has(started.events, (e) => e.type === 'permission_request'))
    const card = firstOfType(started.events, 'permission_request')
    await started.handle.respondPermission(card.id, { outcome: 'deny' })
    return card
  }

  /** ⚑ **The reason our OWN guard hook gives**, read off the hook itself rather than retyped here. */
  async function whyOurHookAsks(
    options: Options,
    toolName: string,
    input: Record<string, unknown>,
  ): Promise<string> {
    for (const matcher of options.hooks?.PreToolUse ?? []) {
      for (const hook of matcher.hooks) {
        const output = (await hook(
          { hook_event_name: 'PreToolUse', tool_name: toolName, tool_input: input } as never,
          'tu_hook',
          { signal: new AbortController().signal },
        )) as {
          hookSpecificOutput?: { permissionDecision?: string; permissionDecisionReason?: string }
        }
        const said = output?.hookSpecificOutput
        if (said?.permissionDecision === 'ask' && typeof said.permissionDecisionReason === 'string')
          return said.permissionDecisionReason
      }
    }
    throw new Error(`our hook did not ask about ${toolName}`)
  }

  it('🔴 a marked ask carries the CLI’s own reason to the card, word for word', async () => {
    const started = await startFake()
    const card = await cardFor(
      started,
      'Bash',
      { command: 'echo r36 &' },
      asked('tu_1', { suppressAlwaysAllowRule: true, decisionReason: THE_CLIS_OWN }),
    )
    expect(card.providerReason).toBe(THE_CLIS_OWN)
    // ⚑ …and a `defaultToNo` ask is marked too.
    const noFirst = await cardFor(
      started,
      'Bash',
      { command: 'rm -rf ./build' },
      asked('tu_2', { defaultToNo: true, decisionReason: THE_CLIS_OWN }),
    )
    expect(noFirst.providerReason).toBe(THE_CLIS_OWN)
    await started.handle.close()
    started.fq.end()
    await started.consumer
  })

  it('⚑ THE CONTROL — an unmarked ask carries no reason: the CLI’s own words (2.1.218’s shape) or ours (2.1.281’s)', async () => {
    const started = await startFake()
    const unmarkedCli = await cardFor(
      started,
      'Bash',
      { command: 'echo r36 &' },
      asked('tu_1', { decisionReason: THE_CLIS_OWN }),
    )
    expect('providerReason' in unmarkedCli).toBe(false)
    // ⚑ **728** — our hook no longer asks about an ordinary command (R93), so OUR words here are the
    // sentence it still asks with in every mode: the one that routes a question to the person.
    const ours = await whyOurHookAsks(started.sdkOptions(), 'AskUserQuestion', {})
    const unmarkedOurs = await cardFor(
      started,
      'Bash',
      { command: 'echo r36' },
      asked('tu_2', { decisionReason: ours }),
    )
    expect('providerReason' in unmarkedOurs).toBe(false)
    // ⚑ A mark sent as `false` is no mark, so it carries no reason either.
    const falseMark = await cardFor(
      started,
      'Bash',
      { command: 'echo r36 &' },
      asked('tu_3', { suppressAlwaysAllowRule: false, decisionReason: THE_CLIS_OWN }),
    )
    expect('providerReason' in falseMark).toBe(false)
    await started.handle.close()
    started.fq.end()
    await started.consumer
  })

  it('⛔ a marked ask whose reason is OUR hook’s own words is not drawn as the provider’s — for the one sentence our hook still asks with', async () => {
    // ⚑ **728 + 726** — R93 removed *"requires explicit approval for consequential tools"* with the
    // ask it was the reason for, and R92 the read outside the working directory (700 M10's second
    // sentence); the one left is the question our hook routes to a person, and the set
    // `providerReasonOf` refuses has to hold it.
    const started = await startFake()
    const questions = await whyOurHookAsks(started.sdkOptions(), 'AskUserQuestion', {
      questions: [],
    })
    for (const [i, ours] of [questions].entries()) {
      const card = await cardFor(
        started,
        'Bash',
        { command: 'echo r36 &' },
        asked(`tu_${i}`, { suppressAlwaysAllowRule: true, decisionReason: ours }),
      )
      expect(card.suppressAlwaysAllowRule).toBe(true)
      expect('providerReason' in card, ours).toBe(false)
      // ⚑ …and our words are still ours with a code INSIDE them, or behind a prefix the CLI added.
      for (const [how, reason] of [
        ['a code inside', `${ours.slice(0, 7)}\u001b[1m${ours.slice(7)}\u001b[0m`],
        ['a prefix', `PreToolUse hook: ${ours}`],
      ] as const) {
        const dressed = await cardFor(
          started,
          'Bash',
          { command: 'echo r36 &' },
          asked(`tu_${how}_${i}`, { suppressAlwaysAllowRule: true, decisionReason: reason }),
        )
        expect('providerReason' in dressed, `${how}: ${ours}`).toBe(false)
      }
    }
    await started.handle.close()
    started.fq.end()
    await started.consumer
  })

  it('🔴 the terminal codes the CLI warns of are taken out — escapes, control characters and the marks that reorder text', async () => {
    const started = await startFake()
    const card = await cardFor(
      started,
      'Bash',
      { command: 'echo r36 &' },
      asked('tu_1', {
        suppressAlwaysAllowRule: true,
        decisionReason:
          '\u001b[1mThis command\u001b[0m uses the `&`\u001b]8;;https://x.test\u0007 background\u001b]8;;\u0007\n' +
          '  operator,\tso \u202Eapprove\u202C only\u200F if you trust it.\u0000',
      }),
    )
    expect(card.providerReason).toBe(
      'This command uses the `&` background operator, so approve only if you trust it.',
    )
    // ⚑ And a reason that was ONLY codes and space is no reason at all.
    const blank = await cardFor(
      started,
      'Bash',
      { command: 'echo r36 &' },
      asked('tu_2', { suppressAlwaysAllowRule: true, decisionReason: ' \u001b[0m \n\t' }),
    )
    expect('providerReason' in blank).toBe(false)
    await started.handle.close()
    started.fq.end()
    await started.consumer
  })

  it('🔴 each class the cleaning takes out, placed INSIDE a word — so removing and spacing read differently', async () => {
    const started = await startFake()
    const CASES: readonly (readonly [string, string, string])[] = [
      [
        'a reordering mark inside a word is removed, not made a space',
        'ap\u202Epro\u202Cve',
        'approve',
      ],
      ['the isolates', 'ok\u2066a\u2069y', 'okay'],
      ['the Arabic letter mark and the direction marks', 'a\u061Cb\u200Ec\u200Fd', 'abcd'],
      ['a C1 control becomes a space', 'one\u0085two', 'one two'],
      ['DEL becomes a space', 'del\u007Fete', 'del ete'],
      ['an escape inside a word leaves nothing', 'Ri\u001b[1msk\u001b[0my', 'Risky'],
      ['the 8-bit CSI', '\u009B1mBold\u009B0m', 'Bold'],
      ['an nF escape — tput sgr0 on xterm', 'Risky\u001b(B op', 'Risky op'],
      ['Fp and Fs escapes', '\u001b7saved\u001b8 \u001bcreset', 'saved reset'],
      ['an APC string, payload and all, to ST', '\u001b_Gpayload\u001b\\ok', 'ok'],
      ['a DCS string', '\u001bPq#0;2\u001b\\ok', 'ok'],
      ['the 8-bit DCS', '\u0090q#0\u009Cok', 'ok'],
      [
        'an OSC hyperlink ended by ST',
        'the \u001b]8;;https://x.test\u001b\\link\u001b]8;;\u001b\\ here',
        'the link here',
      ],
      ['the 8-bit OSC', '\u009D8;;https://x.test\u009Clink\u009D8;;\u009C', 'link'],
      ['a 7-bit C1 control becomes a space, as its 8-bit twin does', 'one\u001bEtwo', 'one two'],
      ['a CSI with a private parameter', 'ok\u001b[?25lay', 'okay'],
      ['a CSI whose final byte is not m', 'ok\u001b[2Kay', 'okay'],
      ['a CSI with an intermediate byte', 'ok\u001b[1 qay', 'okay'],
      ['an OSC ended by BEL, inside a word', 'ok\u001b]0;t\u0007ay', 'okay'],
      ['the 8-bit OSC ended by the 8-bit ST, inside a word', 'ok\u009D0;t\u009Cay', 'okay'],
      ['the 8-bit DCS ended by the 8-bit ST, inside a word', 'ok\u0090q\u009Cay', 'okay'],
      ['an SOS string', 'ok\u001bXsos\u001b\\ay', 'okay'],
      ['a PM string', 'ok\u001b^pm\u001b\\ay', 'okay'],
      ['the 8-bit SOS, PM and APC', 'ok\u0098s\u009Ca\u009Ep\u009Cy\u009Fq\u009C', 'okay'],
      ['an unterminated OSC runs to the end', 'ok\u001b]8;;https://x.test', 'ok'],
      ['a leading control is trimmed', '\u0085Risky', 'Risky'],
    ]
    for (const [i, [what, said, carried]] of CASES.entries()) {
      const card = await cardFor(
        started,
        'Bash',
        { command: 'echo r36 &' },
        asked(`tu_class_${i}`, { suppressAlwaysAllowRule: true, decisionReason: said }),
      )
      expect(card.providerReason, what).toBe(carried)
    }
    await started.handle.close()
    started.fq.end()
    await started.consumer
  })

  it('⛔ a reason longer than the card’s whole ceiling is dropped, not cut — the ceiling itself is carried', async () => {
    const started = await startFake()
    const atTheCeiling = 'r'.repeat(MAX_PERMISSION_DETAIL_CHARS)
    const kept = await cardFor(
      started,
      'Bash',
      { command: 'echo r36 &' },
      asked('tu_1', { suppressAlwaysAllowRule: true, decisionReason: atTheCeiling }),
    )
    expect(kept.providerReason).toBe(atTheCeiling)
    const over = await cardFor(
      started,
      'Bash',
      { command: 'echo r36 &' },
      asked('tu_2', { suppressAlwaysAllowRule: true, decisionReason: `${atTheCeiling}r` }),
    )
    expect('providerReason' in over).toBe(false)
    expect(over.suppressAlwaysAllowRule).toBe(true)
    await started.handle.close()
    started.fq.end()
    await started.consumer
  })

  it('🔴 the wire keeps the reason — a schema that stripped it would drop it before the ledger', () => {
    const parsed = runtimeEventSchema.parse({
      type: 'permission_request',
      id: 'tu_1',
      kind: 'command',
      action: 'Bash',
      detail: 'echo r36 &',
      scope: {
        cwd: '/tmp/x',
        paths: [],
        networkHosts: [],
        persistence: 'once',
        amendments: [],
        availableDecisions: ['allow', 'deny', 'cancel'],
        underDisclosed: true,
        approvalMode: 'ask',
      },
      suppressAlwaysAllowRule: true,
      providerReason: THE_CLIS_OWN,
    })
    expect(parsed).toMatchObject({ providerReason: THE_CLIS_OWN })
  })
})
