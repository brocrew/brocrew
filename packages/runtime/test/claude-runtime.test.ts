import { readFileSync } from 'node:fs'
import type { Options, PermissionUpdate, SDKMessage } from '@anthropic-ai/claude-agent-sdk'
import { describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import { type AgentToolset } from '../src/index'
import { init, firstOfType, has, toolOpts, atOnce, startFake } from './fake-claude-query'

describe('ClaudeRuntime — permissions via canUseTool', () => {
  it('file tool → permission_request(file); allow → {behavior:allow}', async () => {
    const { fq, handle, canUse, events, consumer } = await startFake()
    const resultP = canUse('Write', { file_path: '/tmp/x/f.txt' }, toolOpts('tu_1'))
    await vi.waitFor(has(events, (e) => e.type === 'permission_request'))
    const perm = firstOfType(events, 'permission_request')
    expect(perm).toMatchObject({ id: 'tu_1', kind: 'file', action: 'Write' })
    expect(handle.status()).toBe('waiting_permission')

    await handle.respondPermission('tu_1', { outcome: 'allow' })
    expect(await resultP).toEqual({ behavior: 'allow' })

    await handle.close()
    fq.end()
    await consumer
  })

  it('an ALREADY-ABORTED request publishes NO card and is safely denied (044 P2 #2)', async () => {
    const { fq, handle, canUse, events, consumer } = await startFake()
    const aborted = new AbortController()
    aborted.abort() // the request is dead before it ever reaches us

    // The provider still gets its safe refusal…
    const result = await canUse(
      'Write',
      { file_path: '/tmp/x/f.txt' },
      { toolUseID: 'tu_dead', signal: aborted.signal, requestId: 'req_tu_dead' },
    )
    expect(result).toMatchObject({ behavior: 'deny' })

    // …and NO card is published, so the UI never shows something it cannot answer. (Pre-fix the
    // broker said `accepted:true` for a pre-aborted signal, so both of these appeared.)
    await new Promise((r) => setTimeout(r, 10))
    expect(events.some((e) => e.type === 'permission_request')).toBe(false)
    expect(events.some((e) => e.type === 'status' && e.state === 'waiting_permission')).toBe(false)
    expect(handle.status()).not.toBe('waiting_permission')

    // A LIVE request afterwards still works — the dead one must not poison the path.
    const liveP = canUse('Write', { file_path: '/tmp/x/g.txt' }, toolOpts('tu_live'))
    await vi.waitFor(has(events, (e) => e.type === 'permission_request'))
    await handle.respondPermission('tu_live', { outcome: 'allow' })
    expect(await liveP).toEqual({ behavior: 'allow' })

    await handle.close()
    fq.end()
    await consumer
  })

  /**
   * 🔴 **709 · R43 — a Cancel's turn ends in CLAUDE's word.** ⚑ Measured through this adapter on the
   * loopback (CLI 2.1.281, `fixtures/claude-stopped-results.json`): a card answered Cancel — the
   * `interrupt: true` below — closes its turn `error_during_execution` with `terminal_reason:
   * 'aborted_tools'`. ⛔ The latch used to rename whatever came back; without it, that subtype alone
   * read as a FAULT, so `claudeResultOutcome` reads the reason. The pair: a Cancel whose turn Claude
   * finished anyway (`success`) is `completed`, and the ask is the decision row beside it.
   */
  it('🔴 709 · R43 — a Cancel whose turn Claude ABORTED is `interrupted`, with no fault beside it', async () => {
    const measured = (
      JSON.parse(
        readFileSync(new URL('./fixtures/claude-stopped-results.json', import.meta.url), 'utf8'),
      ) as { cancelledCard: SDKMessage }
    ).cancelledCard
    const { fq, handle, canUse, events, consumer } = await startFake()
    fq.emit(init('sess_1', '/tmp/x'))
    await vi.waitFor(has(events, (e) => e.type === 'session'))
    await handle.send('go')
    const cancelled = canUse('Bash', { command: 'sleep 1' }, toolOpts('tu_r43'))
    await vi.waitFor(has(events, (e) => e.type === 'permission_request'))
    await handle.respondPermission('tu_r43', { outcome: 'cancel' })
    await cancelled
    fq.emit(measured)
    await vi.waitFor(has(events, (e) => e.type === 'turn'))
    expect(
      events.filter((e) => e.type === 'turn').map((e) => (e.type === 'turn' ? e.state : '')),
    ).toEqual(['interrupted'])
    expect(events.some((e) => e.type === 'error')).toBe(false)
    await handle.close()
    fq.end()
    await consumer
  })

  it('🔴 709 · R43 — …and a Cancel whose turn Claude FINISHED anyway is `completed`', async () => {
    const { fq, handle, canUse, events, consumer } = await startFake()
    fq.emit(init('sess_1', '/tmp/x'))
    await vi.waitFor(has(events, (e) => e.type === 'session'))
    await handle.send('go')
    const cancelled = canUse('Bash', { command: 'sleep 1' }, toolOpts('tu_r43b'))
    await vi.waitFor(has(events, (e) => e.type === 'permission_request'))
    await handle.respondPermission('tu_r43b', { outcome: 'cancel' })
    await cancelled
    // ⛔ **On `main` this read `interrupted`** — the latch renamed Claude's own `success`.
    fq.emit({ type: 'result', subtype: 'success', is_error: false, terminal_reason: 'completed' })
    await vi.waitFor(has(events, (e) => e.type === 'turn'))
    expect(
      events.filter((e) => e.type === 'turn').map((e) => (e.type === 'turn' ? e.state : '')),
    ).toEqual(['completed'])
    await handle.close()
    fq.end()
    await consumer
  })

  it('command tool deny → {behavior:deny, message}; cancel → deny+interrupt', async () => {
    const a = await startFake()
    const denyP = a.canUse('Bash', { command: 'rm -rf /' }, toolOpts('tu_d'))
    await vi.waitFor(has(a.events, (e) => e.type === 'permission_request'))
    expect(firstOfType(a.events, 'permission_request').kind).toBe('command')
    await a.handle.respondPermission('tu_d', { outcome: 'deny', message: 'no' })
    expect(await denyP).toEqual({ behavior: 'deny', message: 'no' })
    await a.handle.close()
    a.fq.end()
    await a.consumer

    const b = await startFake()
    const cancelP = b.canUse('Bash', { command: 'sleep 1' }, toolOpts('tu_c'))
    await vi.waitFor(has(b.events, (e) => e.type === 'permission_request'))
    await b.handle.respondPermission('tu_c', { outcome: 'cancel' })
    expect(await cancelP).toEqual({
      behavior: 'deny',
      message: 'cancelled by user',
      interrupt: true,
    })
    await b.handle.close()
    b.fq.end()
    await b.consumer
  })

  it('AskUserQuestion → user_input_request(questions); answer → structured questions/answers (007 P2-1)', async () => {
    const { fq, handle, canUse, events, consumer } = await startFake()
    const input = {
      questions: [
        {
          question: 'pick a color',
          header: 'Color',
          options: [
            { label: 'blue', description: '' },
            { label: 'red', description: '' },
          ],
        },
      ],
    }
    const answerP = canUse('AskUserQuestion', input, toolOpts('tu_q'))
    await vi.waitFor(has(events, (e) => e.type === 'user_input_request'))
    const req = firstOfType(events, 'user_input_request')
    expect(req.id).toBe('tu_q')
    // the neutral event exposes structured questions (id/prompt/options), no raw payload
    // `multiSelect: false` is part of the neutral shape since 139 — the adapter states the mode on
    // every question, so an ABSENT flag is an adapter that forgot rather than a question nobody ruled
    // on. This call sends no `multiSelect` at all, which is the malformed-input reading: not several.
    // 143: `header` is absent because this fixture's question sends none, and an absent header is
    // `undefined` rather than an invented empty string (086). `allowOther` is TRUE because the
    // question offers options and Claude's client supplies the escape for every such question — the
    // adapter has no field to copy, so the count of options is what it reads.
    expect(req.questions).toEqual([
      {
        id: 'q0',
        prompt: 'pick a color',
        header: 'Color',
        options: [{ label: 'blue' }, { label: 'red' }],
        allowOther: true,
        multiSelect: false,
      },
    ])
    expect(Object.keys(req)).not.toContain('raw')

    await handle.respondUserInput('tu_q', { kind: 'answer', answers: { q0: 'blue' } })
    const result = await answerP
    // official `answers` shape (question text → answer), NOT the invented `__brobot_answer`
    expect(result).toMatchObject({
      behavior: 'allow',
      updatedInput: { answers: { 'pick a color': 'blue' } },
    })
    expect(JSON.stringify(result)).not.toContain('__brobot_answer')

    // ExitPlanMode: an answer approves (allow), a reject declines gracefully (deny)
    const rejectP = canUse('ExitPlanMode', { plan: 'x' }, toolOpts('tu_p'))
    await vi.waitFor(() =>
      expect(events.filter((e) => e.type === 'user_input_request')).toHaveLength(2),
    )
    await handle.respondUserInput('tu_p', { kind: 'reject' })
    expect(await rejectP).toEqual({ behavior: 'deny', message: 'declined by user' })

    // ⚑ A decline that gives its reason is denied with that reason, which the model reads; a blank
    // one says what a decline with none says.
    const reasonP = canUse(
      'AskUserQuestion',
      {
        questions: [
          {
            question: 'which branch?',
            header: 'Branch',
            options: [
              { label: 'main', description: '' },
              { label: 'dev', description: '' },
            ],
            multiSelect: false,
          },
        ],
      },
      toolOpts('tu_r'),
    )
    await vi.waitFor(() =>
      expect(events.filter((e) => e.type === 'user_input_request')).toHaveLength(3),
    )
    await handle.respondUserInput('tu_r', { kind: 'reject', reason: 'I do not know which branch' })
    expect(await reasonP).toEqual({ behavior: 'deny', message: 'I do not know which branch' })
    const blankP = canUse('ExitPlanMode', { plan: 'y' }, toolOpts('tu_b'))
    await vi.waitFor(() =>
      expect(events.filter((e) => e.type === 'user_input_request')).toHaveLength(4),
    )
    await handle.respondUserInput('tu_b', { kind: 'reject', reason: '   ' })
    expect(await blankP).toEqual({ behavior: 'deny', message: 'declined by user' })

    await handle.close()
    fq.end()
    await consumer
  })

  /**
   * The plan the user is being asked to approve (030).
   *
   * Until now `ExitPlanMode` surfaced as a bare "approve this" and the document it was about was
   * dropped on the floor — the one thing the user needed in order to answer. The shape is taken
   * from the 026 capture, not from the SDK type: `ExitPlanModeInput` declares only a deprecated
   * `allowedPrompts` and an index signature, so `plan` arrives untyped and must be read as such.
   */
  describe('the plan document (030)', () => {
    const PLAN = '# Plan\n\n1. Read the config\n2. Rename the field\n3. Run the tests\n'

    it('reaches the stream as plan_update.body, BEFORE the card that asks about it', async () => {
      const { fq, handle, canUse, events, consumer } = await startFake()
      const approveP = canUse('ExitPlanMode', { plan: PLAN }, toolOpts('tu_plan'))
      await vi.waitFor(() =>
        expect(events.filter((e) => e.type === 'user_input_request')).toHaveLength(1),
      )
      const plans = events.filter((e) => e.type === 'plan_update')
      expect(plans).toHaveLength(1)
      expect(plans[0]).toMatchObject({ type: 'plan_update', body: PLAN.trim(), steps: [] })
      // Order is the point: the reader sees the plan, then the question about it. A card that
      // arrived first would be asking about something not yet on screen.
      expect(events.findIndex((e) => e.type === 'plan_update')).toBeLessThan(
        events.findIndex((e) => e.type === 'user_input_request'),
      )
      await handle.respondUserInput('tu_plan', { kind: 'answer', answers: {} })
      expect(await approveP).toEqual({ behavior: 'allow' })
      await handle.close()
      fq.end()
      await consumer
    })

    it('an ExitPlanMode with NO plan produces no document rather than an empty one', async () => {
      // `plan` is not in the SDK type; it reaches us through an index signature. So its absence is
      // an ordinary case, and a blank sheet claiming a plan exists would be worse than no sheet.
      const { fq, handle, canUse, events, consumer } = await startFake()
      for (const [id, input] of [
        ['tu_a', {}],
        ['tu_b', { plan: '   ' }],
        ['tu_c', { plan: 42 }],
      ] as const) {
        void canUse('ExitPlanMode', input as Record<string, unknown>, toolOpts(id))
      }
      await vi.waitFor(() =>
        expect(events.filter((e) => e.type === 'user_input_request')).toHaveLength(3),
      )
      expect(events.filter((e) => e.type === 'plan_update')).toHaveLength(0)
      await handle.close()
      fq.end()
      await consumer
    })

    it('only ExitPlanMode means a plan by `plan` — AskUserQuestion does not', async () => {
      // The field arrives through an index signature, so any user-input tool could carry a key of
      // that name. Gating on the tool as well as the field is what keeps that from becoming a card.
      const { fq, handle, canUse, events, consumer } = await startFake()
      void canUse(
        'AskUserQuestion',
        { plan: PLAN, questions: [{ question: 'pick', options: [{ label: 'a' }] }] },
        toolOpts('tu_q2'),
      )
      await vi.waitFor(() =>
        expect(events.filter((e) => e.type === 'user_input_request')).toHaveLength(1),
      )
      expect(events.filter((e) => e.type === 'plan_update')).toHaveLength(0)
      await handle.close()
      fq.end()
      await consumer
    })
  })

  /**
   * The rest of plan mode's vocabulary (056).
   *
   * 055 saw three live plan-mode turns produce no `ExitPlanMode` and concluded the plan document
   * was dead against the current binary. It is not — every `ExitPlanMode` this machine has ever
   * recorded carries `input.plan`, three of them as `plan_update` rows WITH a body in the app's own
   * database. What was actually missing is the OTHER end of plan mode: `EnterPlanMode`, which the
   * model now calls to ask permission to plan at all, and which fell through to the permission
   * guard as a command card reading `EnterPlanMode` and disclosing nothing.
   */
  describe('the rest of plan mode (056)', () => {
    it('🔴 736 · R98 — EnterPlanMode in `ask` is allowed with NO card, as the CLI does not ask it', async () => {
      // ⛔ On `main`: a consent card (*"The agent wants to plan this out first…"*) — BroBot's own ask.
      // The CLI's engine never hands `EnterPlanMode` to its host (measured, `probe:tool-calls-as-the-cli`
      // `enter-plan-write`), so in `ask` this app does not ask it either.
      const { fq, handle, canUse, events, consumer } = await startFake()
      expect(await atOnce(canUse('EnterPlanMode', {}, toolOpts('tu_enter')))).toEqual({
        behavior: 'allow',
      })
      expect(events.filter((e) => e.type === 'user_input_request')).toHaveLength(0)
      expect(events.filter((e) => e.type === 'permission_request')).toHaveLength(0)
      // ⚑ …and the conversation is planning from that allow, so the plan-mode asks that follow are
      // told apart (`the-cli-decides-what-to-ask.test.ts`).
      expect(handle.settings.planMode.effective).toBe(true)
      await handle.close()
      fq.end()
      await consumer
    })

    it('EnterPlanMode carries no plan, so it produces no document — and no card', async () => {
      // The one thing 056 refused to do. `EnterPlanModeInput` is `{}` — a plan read out of it would
      // have to be invented, and an invented plan is worse than an absent one.
      const { fq, handle, canUse, events, consumer } = await startFake()
      expect(
        await canUse(
          'EnterPlanMode',
          { plan: '# not a plan the model proposed' },
          toolOpts('tu_e2'),
        ),
      ).toEqual({ behavior: 'allow' })
      expect(events.filter((e) => e.type === 'plan_update')).toHaveLength(0)
      expect(events.filter((e) => e.type === 'user_input_request')).toHaveLength(0)
      await handle.close()
      fq.end()
      await consumer
    })

    it('⚑ R98 CONTROL — ExitPlanMode is still a person’s card in `ask`: approving a plan is the CLI’s ask', async () => {
      // The one fact over: the other plan tool, which carries a plan only a person can approve.
      const { fq, handle, canUse, events, consumer } = await startFake()
      void canUse('ExitPlanMode', { plan: '# Plan\n' }, toolOpts('tu_exit_ctl'))
      await vi.waitFor(has(events, (e) => e.type === 'user_input_request'))
      expect(firstOfType(events, 'user_input_request')).toMatchObject({
        id: 'tu_exit_ctl',
        questions: [],
        consent: 'stop-planning',
      })
      await handle.close()
      fq.end()
      await consumer
    })

    it('an UNATTENDED session answers EnterPlanMode itself — a plan and a question still ask', async () => {
      // The regression this set exists to prevent. `USER_INPUT_TOOLS` is consulted above the
      // auto-approve return, so every name added to it silently starts blocking yolo. In the
      // ledger, three auto sessions passed EnterPlanMode with a tool_call and no card at all;
      // a card there stops an unattended run until a human comes back.
      const { fq, handle, canUse, events, consumer } = await startFake({ approvalMode: 'auto' })
      expect(await canUse('EnterPlanMode', {}, toolOpts('tu_auto'))).toEqual({ behavior: 'allow' })
      expect(events.filter((e) => e.type === 'user_input_request')).toHaveLength(0)
      expect(events.filter((e) => e.type === 'permission_request')).toHaveLength(0)

      // …and the two that carry something only the user can settle are untouched by that exit.
      void canUse('ExitPlanMode', { plan: '# Plan\n' }, toolOpts('tu_auto_plan'))
      void canUse(
        'AskUserQuestion',
        { questions: [{ question: 'which?', options: [{ label: 'a' }] }] },
        toolOpts('tu_auto_q'),
      )
      await vi.waitFor(
        () => void expect(events.filter((e) => e.type === 'user_input_request')).toHaveLength(2),
      )
      await handle.close()
      fq.end()
      await consumer
    })

    it('the card names what it is asking — and says so when the plan did not arrive', async () => {
      // The SDK sends no `title` for these tools: the ledger's own card carried the bare string
      // "ExitPlanMode" in the field that renders as the question. A plan with no document is the
      // 030 failure (approve a thing you were never shown), so the wording has to split on it.
      const { fq, handle, canUse, events, consumer } = await startFake()
      void canUse('ExitPlanMode', { plan: '# Plan\n\n1. Do it\n' }, toolOpts('tu_with'))
      await vi.waitFor(has(events, (e) => e.type === 'user_input_request'))
      void canUse('ExitPlanMode', { planFilePath: '/somewhere/plan.md' }, toolOpts('tu_without'))
      await vi.waitFor(
        () => void expect(events.filter((e) => e.type === 'user_input_request')).toHaveLength(2),
      )
      const [withPlan, withoutPlan] = events.filter((e) => e.type === 'user_input_request')
      expect(withPlan?.prompt).toBe(
        'The agent has finished planning and asks you to approve its plan.',
      )
      expect(withoutPlan?.prompt).toContain('did not send the plan itself')
      // Neither one is the tool's name, which is what both of them used to be.
      expect(withPlan?.prompt).not.toContain('ExitPlanMode')
      expect(withoutPlan?.prompt).not.toContain('ExitPlanMode')
      // And the honest absence stays an absence — no blank document was manufactured to fill it.
      expect(events.filter((e) => e.type === 'plan_update')).toHaveLength(1)
      await handle.close()
      fq.end()
      await consumer
    })

    it('a title from the SDK still wins — the sentence is a fallback, not an override', async () => {
      const { fq, handle, canUse, events, consumer } = await startFake()
      void canUse(
        'ExitPlanMode',
        { plan: '# Plan\n' },
        {
          ...toolOpts('tu_titled'),
          title: 'Claude wants to start on its plan',
        },
      )
      await vi.waitFor(has(events, (e) => e.type === 'user_input_request'))
      expect(firstOfType(events, 'user_input_request').prompt).toBe(
        'Claude wants to start on its plan',
      )
      await handle.close()
      fq.end()
      await consumer
    })
  })

  /**
   * 🔴 **Plan mode, and what moves it** (150; ⚑ `728` re-aimed).
   *
   * The field defect: the model called `ExitPlanMode`, the user APPROVED it, the provider left plan
   * mode — and BroBot's own floor stayed up, refusing every `Bash` and `Write` for the rest of the
   * session. `plan.effective` was a one-way latch with `plan.request(true)` as its only writer, so
   * nothing anywhere could put it back.
   *
   * ⚑ **728 · R93 removed the floor itself**: the provider's own plan mode decides every call
   * (measured, `probe:tool-calls-as-the-cli`: in plan mode the CLI asks before a `Write` and an MCP
   * tool and runs `ls`). ⚠️ **The STATE these tests pin still matters** — `settings.planMode` is what
   * the header draws and what `setPermissionMode` is sent from — so each keeps its gesture and its
   * state, and where it asked whether the floor refused, it now asks that the hook has NO opinion:
   * red on every commit that still had the floor.
   */
  describe('plan mode, and what moves it (150, 728)', () => {
    /** The PreToolUse guard the runtime actually installed. */
    function floorOf(sdkOptions: () => Options) {
      const guard = sdkOptions().hooks?.PreToolUse?.[0]?.hooks?.[0]
      if (!guard) throw new Error('PreToolUse guard not installed')
      return (tool: string, input: unknown = {}) =>
        (
          guard as unknown as (i: {
            hook_event_name: string
            tool_name: string
            tool_input: unknown
            tool_use_id: string
          }) => Promise<{
            continue?: boolean
            hookSpecificOutput?: { permissionDecision?: string; permissionDecisionReason?: string }
          }>
        )({ hook_event_name: 'PreToolUse', tool_name: tool, tool_input: input, tool_use_id: 't' })
    }
    const PLAN_FILE = '/tmp/x/home/plans/buzzing-wibbling-ocean.md'

    it('an APPROVED plan ENDS plan mode — the field defect, end to end', async () => {
      const { fq, handle, canUse, events, consumer, sdkOptions } = await startFake({
        planMode: true,
      })
      const floor = floorOf(sdkOptions)
      // Planning — and since 728 the hook refuses nothing: the provider's own plan mode decides.
      expect(await floor('Bash', { command: 'ls' })).toEqual({ continue: true })
      expect(handle.settings.planMode.effective).toBe(true)

      const exitP = canUse('ExitPlanMode', { plan: '# Plan\n' }, toolOpts('tu_exit'))
      await vi.waitFor(has(events, (e) => e.type === 'user_input_request'))
      await handle.respondUserInput('tu_exit', { kind: 'answer', answers: {} })
      expect(await exitP).toEqual({ behavior: 'allow' })

      // ⛔ 150's assertion: after the approval, plan mode is over — and nothing refuses work.
      expect(await floor('Bash', { command: 'ls' })).toEqual({ continue: true })
      expect(await floor('Write', { file_path: '/tmp/x/out.txt' })).toEqual({ continue: true })
      // …and it SETTLED rather than being requested: a plan mode that is over must not read as a
      // change the UI still owes the user "from your next message".
      expect(handle.settings.planMode).toEqual({ effective: false, requested: false })
      await handle.close()
      fq.end()
      await consumer
    })

    it('…and a REJECTED plan keeps it — the paired negative', async () => {
      const { fq, handle, canUse, events, consumer, sdkOptions } = await startFake({
        planMode: true,
      })
      const floor = floorOf(sdkOptions)
      const exitP = canUse('ExitPlanMode', { plan: '# Plan\n' }, toolOpts('tu_no'))
      await vi.waitFor(has(events, (e) => e.type === 'user_input_request'))
      await handle.respondUserInput('tu_no', { kind: 'reject' })
      expect(await exitP).toMatchObject({ behavior: 'deny' })

      // Refusing to approve a plan is not a request to start work.
      expect(await floor('Bash', { command: 'ls' })).toEqual({ continue: true })
      expect(handle.settings.planMode.effective).toBe(true)
      await handle.close()
      fq.end()
      await consumer
    })

    it('…and a session that never planned is not planning — the other paired negative', async () => {
      const { fq, handle, consumer, sdkOptions } = await startFake()
      const floor = floorOf(sdkOptions)
      expect(await floor('Bash', { command: 'ls' })).toEqual({ continue: true })
      expect(handle.settings.planMode.effective).toBe(false)
      await handle.close()
      fq.end()
      await consumer
    })

    it('an allowed EnterPlanMode STARTS plan mode — the other edge of the same seam (no card since 736)', async () => {
      // ⚑ The tester's framing, and the reason this test exists beside the one above: *"the two
      // plan-mode states are not synchronized in either direction. Whatever you fix for one, check
      // the other edge."* Without this, the model starts planning, the SDK enters plan mode — and
      // BroBot does not know it is planning while the header should say so. ⚑ Since `736` (R98)
      // nobody is asked: the allow itself is the edge.
      const { fq, handle, canUse, events, consumer, sdkOptions } = await startFake()
      const floor = floorOf(sdkOptions)
      expect(await floor('Write', { file_path: '/tmp/x/out.txt' })).toEqual({ continue: true })
      expect(handle.settings.planMode.effective).toBe(false)

      expect(await atOnce(canUse('EnterPlanMode', {}, toolOpts('tu_in')))).toEqual({
        behavior: 'allow',
      })
      expect(events.filter((e) => e.type === 'user_input_request')).toHaveLength(0)

      expect(await floor('Write', { file_path: '/tmp/x/out.txt' })).toEqual({ continue: true })
      expect(handle.settings.planMode).toEqual({ effective: true, requested: true })
      await handle.close()
      fq.end()
      await consumer
    })

    it('answering an ORDINARY question moves plan mode not at all', async () => {
      // The gesture that must not be mistaken for the two that are plan gestures — the map is keyed
      // by request id, and this is what stops it being "any answered card lifts the floor".
      const { fq, handle, canUse, events, consumer, sdkOptions } = await startFake({
        planMode: true,
      })
      const floor = floorOf(sdkOptions)
      const askP = canUse(
        'AskUserQuestion',
        { questions: [{ question: 'which?', options: [{ label: 'a' }, { label: 'b' }] }] },
        toolOpts('tu_ask'),
      )
      await vi.waitFor(has(events, (e) => e.type === 'user_input_request'))
      await handle.respondUserInput('tu_ask', { kind: 'answer', answers: { q0: 'a' } })
      await askP
      expect(await floor('Bash', { command: 'ls' })).toEqual({ continue: true })
      expect(handle.settings.planMode.effective).toBe(true)
      await handle.close()
      fq.end()
      await consumer
    })

    it('the client-side switch OFF is still refused, and that is 076 rather than a hole', async () => {
      // The release is real now; the rival way out is still not offered. `RuntimeHost.endPlanMode`
      // is therefore a Codex-only path — which is also what makes 148 H2 a Codex-only defect.
      const { fq, handle, consumer } = await startFake({ planMode: true })
      await expect(handle.setPlanMode(false)).rejects.toThrow(/cannot stop planning from here/)
      expect(handle.planNeedsGoAhead).toBe(false)
      await handle.close()
      fq.end()
      await consumer
    })

    // ---- §0b · the plan file is the one write planning is FOR -----------------------------------

    it('the plan file is not refused while planning — 728: nothing is, by this app', async () => {
      const { fq, handle, consumer, sdkOptions } = await startFake({ planMode: true })
      const floor = floorOf(sdkOptions)
      expect(await floor('Write', { file_path: PLAN_FILE })).toEqual({ continue: true })
      expect(await floor('Edit', { file_path: PLAN_FILE })).toEqual({ continue: true })
      await handle.close()
      fq.end()
      await consumer
    })

    // ---- §1 · a planning session can search ------------------------------------------------------

    it('a planning session can DISCOVER a file it does not know the path of', async () => {
      // ⛔ 140 invented the check *"can you still read?"* and shipped a floor that failed it. The
      // tester: *"I can read a file only if I already know its exact path. I cannot discover one."*
      //
      // ⛔ **This test PASSED for a release in which the capability did not exist** (164). It asserts
      // that the floor lets `Glob` through, and the floor did — but the session was never offered a
      // `Glob` to let through, so the assertion was about a name rather than a tool. 150 read the
      // green and closed the ticket; the live session answered *"No such tool available: Glob"*.
      // The missing half is asserted first, on the launch options, because a floor that yields for a
      // tool the child does not have is exactly as useful as one that refuses it.
      const { fq, handle, consumer, sdkOptions } = await startFake({ planMode: true })
      expect(sdkOptions().tools, 'the session is OFFERED the tools this floor exempts').toEqual([
        'preset:default',
        'Grep',
        'Glob',
      ])
      const floor = floorOf(sdkOptions)
      expect(await floor('ToolSearch', { query: 'select:Grep,Glob' })).toEqual({ continue: true })
      expect(await floor('Glob', { pattern: '**/*.ts', path: '/tmp/x' })).toEqual({
        continue: true,
      })
      expect(await floor('Grep', { pattern: 'CANARY', path: '/tmp/x' })).toEqual({ continue: true })
      expect(await floor('Read', { file_path: '/tmp/x/AGENTS.md' })).toEqual({ continue: true })
      await handle.close()
      fq.end()
      await consumer
    })
  })

  /**
   * 🔴 **This app's own verbs, and the hook** (461, 486; ⚑ `728` re-aimed).
   *
   * ⚑ `461` let a PLANNING session through the floor for `create_project` alone; ⚑ **728 · R93
   * removed the floor**, so that exemption and its tests went with it. What stays is `486`'s: the
   * verbs whose rails are the whole gate are ALLOWED by the hook — orchestration, which R93 keeps —
   * and every other verb gets no opinion from it, so the CLI's own engine decides (it asks before
   * every MCP tool, measured by `probe:tool-calls-as-the-cli`).
   */
  describe('this app’s own verbs, and the hook (461, 486, 728)', () => {
    /** The PreToolUse guard the runtime actually installed — its own copy, per the 150 block. */
    function floorOf(sdkOptions: () => Options) {
      const guard = sdkOptions().hooks?.PreToolUse?.[0]?.hooks?.[0]
      if (!guard) throw new Error('PreToolUse guard not installed')
      return (tool: string, input: unknown = {}) =>
        (
          guard as unknown as (i: {
            hook_event_name: string
            tool_name: string
            tool_input: unknown
            tool_use_id: string
          }) => Promise<{
            continue?: boolean
            hookSpecificOutput?: { permissionDecision?: string; permissionDecisionReason?: string }
          }>
        )({ hook_event_name: 'PreToolUse', tool_name: tool, tool_input: input, tool_use_id: 't' })
    }
    /**
     * ⚑ **The proposing verb and a minting one, in ONE toolset** — standing rule 3's pairing: the
     * same call, one fact over, and the two readings must DIVERGE here or the test measures nothing.
     */
    const toolsetOf = (server: string): AgentToolset => ({
      server,
      tools: [
        {
          name: 'create_project',
          description:
            'Put a new piece of work in front of the person. Nothing is created unless they approve.',
          beyondItsRails: 'nothing-its-rails-do-not-cover',
          input: { name: z.string(), shape: z.string(), why: z.string() },
          call: async () => ({ text: 'ok' }),
        },
        {
          name: 'spawn_agent',
          description: 'Start another agent.',
          beyondItsRails: 'it-starts-something-outside-this-app',
          input: { profile_slug: z.string() },
          call: async () => ({ text: 'ok' }),
        },
        {
          name: 'create_agent',
          description: 'Mint an identity.',
          beyondItsRails: 'nothing-its-rails-do-not-cover',
          input: { slug: z.string() },
          call: async () => ({ text: 'ok' }),
        },
      ],
    })
    const BROBOT = toolsetOf('brobot')

    it('⚠️ the two verbs DIVERGE — one is rail-gated, one is left to the CLI’s own ask', async () => {
      // ⚑ `486` decides the first: its rails are the gate, so the hook allows it. ⚑ **728** — the
      // second gets NO opinion from the hook, and the CLI's engine asks before an MCP tool itself.
      // `a-comparison-tested-where-both-sides-agree` measures nothing, so the pair must diverge.
      const { fq, handle, consumer, sdkOptions } = await startFake({
        approvalMode: 'ask',
        agentTools: BROBOT,
      })
      const floor = floorOf(sdkOptions)
      const proposes = await floor('mcp__brobot__create_project', {})
      expect(proposes.hookSpecificOutput?.permissionDecision).toBe('allow')
      const spawns = await floor('mcp__brobot__spawn_agent', {})
      expect(spawns).toEqual({ continue: true })
      await handle.close()
      fq.end()
      await consumer
    })

    it('🔴 …and when the CLI asks before one of this app’s tools, its card keeps nothing: once, or not', async () => {
      // ⚑ The CLI suggests a whole-tool rule kept in the project for an MCP tool, so this app's own
      // verbs were offered *always* and *for this conversation*; giving work or starting an agent
      // stays a person's choice each time, as on Codex.
      const { fq, handle, canUse, events, consumer } = await startFake({
        approvalMode: 'ask',
        agentTools: BROBOT,
      })
      const WHOLE = [
        {
          type: 'addRules',
          rules: [{ toolName: 'mcp__brobot__spawn_agent' }],
          behavior: 'allow',
          destination: 'localSettings',
        },
      ] as PermissionUpdate[]
      const asked = canUse(
        'mcp__brobot__spawn_agent',
        { profile_slug: 'worker' },
        toolOpts('tu_1', WHOLE),
      )
      await vi.waitFor(has(events, (e) => e.type === 'permission_request' && e.id === 'tu_1'))
      const card = firstOfType(events, 'permission_request')
      expect(card.scope.availableDecisions).toEqual(['allow', 'deny', 'cancel'])
      expect(card.scope.persistence).toBe('once')
      await expect(handle.respondPermission('tu_1', { outcome: 'allow_always' })).rejects.toThrow(
        /not offered|not one of/,
      )
      await handle.respondPermission('tu_1', { outcome: 'allow' })
      expect(await asked).not.toHaveProperty('updatedPermissions')
      // ⚑ THE CONTROL — another server's tool with the same suggestion is still offered both.
      const other = canUse(
        'mcp__srv__look',
        { q: 'x' },
        toolOpts('tu_2', [
          { ...WHOLE[0], rules: [{ toolName: 'mcp__srv__look' }] } as PermissionUpdate,
        ]),
      )
      await vi.waitFor(has(events, (e) => e.type === 'permission_request' && e.id === 'tu_2'))
      const otherCard = events.filter((e) => e.type === 'permission_request').at(-1)
      expect(
        otherCard?.type === 'permission_request' && otherCard.scope.availableDecisions,
      ).toEqual(['allow', 'allow_for_session', 'allow_always', 'deny', 'cancel'])
      await handle.respondPermission('tu_2', { outcome: 'deny' })
      await other
      await handle.close()
      fq.end()
      await consumer
    })

    /**
     * ⚑ **A verb carded for SOME calls only** (`beyondItsRailsWhen`) — `message_agent` and
     * `answer_question` raise no card until they are asked to stop the other conversation's turn.
     * ⛔ The hook reads the call's own arguments: the same verb in the same session is allowed with
     * one fact over and left to the CLI's card with the other, and an argument that is not exactly
     * `true` is no stop.
     */
    it('🔴 a verb that stops a turn only when asked to: allowed without interrupt, carded with it', async () => {
      const when = (args: Readonly<Record<string, unknown>>) =>
        args['interrupt'] === true
          ? ('it-destroys-work-in-flight' as const)
          : ('nothing-its-rails-do-not-cover' as const)
      const MAYBE: AgentToolset = {
        server: 'brobot',
        tools: ['message_agent', 'answer_question'].map((name) => ({
          name,
          description: name,
          beyondItsRails: 'nothing-its-rails-do-not-cover' as const,
          beyondItsRailsWhen: when,
          input: { interrupt: z.boolean().optional() },
          call: async () => ({ text: 'ok' }),
        })),
      }
      const { fq, handle, consumer, sdkOptions } = await startFake({
        approvalMode: 'ask',
        agentTools: MAYBE,
      })
      const floor = floorOf(sdkOptions)
      for (const verb of ['message_agent', 'answer_question']) {
        const name = `mcp__brobot__${verb}`
        expect((await floor(name, {})).hookSpecificOutput?.permissionDecision, verb).toBe('allow')
        expect(
          (await floor(name, { interrupt: false })).hookSpecificOutput?.permissionDecision,
          verb,
        ).toBe('allow')
        // The same call one fact over: no opinion from the hook, so the CLI's own engine cards it.
        expect(await floor(name, { interrupt: true }), verb).toEqual({ continue: true })
        // Not exactly `true` is no stop.
        expect(
          (await floor(name, { interrupt: 'true' })).hookSpecificOutput?.permissionDecision,
          verb,
        ).toBe('allow')
        // Arguments that are no record fall back to the verb's own word.
        for (const odd of [null, 'text', 7, ['interrupt']]) {
          expect(
            (await floor(name, odd)).hookSpecificOutput?.permissionDecision,
            `${verb} with ${JSON.stringify(odd)}`,
          ).toBe('allow')
        }
      }
      await handle.close()
      fq.end()
      await consumer
    })

    /**
     * 🔴 **486 · this app's own verbs do not raise a card — their rails are the gate**
     * (HO-031 §2.4).
     *
     * ## ⛔ The measurement
     *
     * ⚑ **BroBot's own session report, §2.9:** *"The PM then needed human approval for `ls`, for
     * `Write`, and even for `mcp__brobot__reply_to_parent` — it had to ask permission to answer
     * me."* ⚠️ *"Double-gating them means every task needs a human click to close, which breaks the
     * loop the tools exist to make."*
     *
     * ⛔ **The class is NOT *the app's own tools*, and the negatives below are the whole test.**
     * Three verbs keep their card and each says why on its own declaration — `spawn_agent` starts a
     * provider child outside this app, `end_agent` and `interrupt_agent` destroy work in flight.
     */
    describe('this app’s own verbs, gated by rails rather than by a card (486)', () => {
      /** ⚑ **The real split's shape**, in the fixture idiom this file already uses. */
      const EVERY_VERB: AgentToolset = {
        server: 'brobot',
        tools: (
          [
            ['reply_to_parent', 'nothing-its-rails-do-not-cover'],
            ['ask_parent', 'nothing-its-rails-do-not-cover'],
            ['answer_question', 'nothing-its-rails-do-not-cover'],
            ['message_agent', 'nothing-its-rails-do-not-cover'],
            ['withdraw_task', 'nothing-its-rails-do-not-cover'],
            ['list_agents', 'nothing-its-rails-do-not-cover'],
            ['create_agent', 'nothing-its-rails-do-not-cover'],
            ['create_project', 'nothing-its-rails-do-not-cover'],
            ['spawn_agent', 'it-starts-something-outside-this-app'],
            ['end_agent', 'it-destroys-work-in-flight'],
            ['interrupt_agent', 'it-destroys-work-in-flight'],
          ] as const
        ).map(([name, beyondItsRails]) => ({
          name,
          description: name,
          beyondItsRails,
          input: { task_id: z.string().optional() },
          call: async () => ({ text: 'ok' }),
        })),
      }

      const decisionOf = (out: {
        hookSpecificOutput?: { permissionDecision?: string; permissionDecisionReason?: string }
      }): string => out.hookSpecificOutput?.permissionDecision ?? 'continue'

      it('🔴 reply_to_parent is answerable with no human click — §2.9’s own verb, by name', async () => {
        const { fq, handle, consumer, sdkOptions } = await startFake({
          approvalMode: 'ask',
          agentTools: EVERY_VERB,
        })
        const out = await floorOf(sdkOptions)('mcp__brobot__reply_to_parent', {
          task_id: 'task_1',
        })
        expect(decisionOf(out)).toBe('allow')
        expect(out.hookSpecificOutput?.permissionDecisionReason).toContain(
          'BroCrew gates its own tools with rails, not with a card',
        )
        await handle.close()
        fq.end()
        await consumer
      })

      it('⛔ …and the three that keep a card still card, in the same session', async () => {
        // ⚑ **The paired negative, and it is what makes this an exemption rather than a hole**
        // (standing rule 3): the same hook, the same session, the same mode — one fact over.
        const { fq, handle, consumer, sdkOptions } = await startFake({
          approvalMode: 'ask',
          agentTools: EVERY_VERB,
        })
        const floor = floorOf(sdkOptions)
        const answered: Record<string, string> = {}
        for (const tool of EVERY_VERB.tools) {
          answered[tool.name] = decisionOf(await floor(`mcp__brobot__${tool.name}`, {}))
        }
        // ⚑ **728** — the hook has no opinion on these three, so the CLI's own engine asks before
        // each (every MCP tool, measured): they card through the provider, not through this hook.
        const cards = Object.entries(answered)
          .filter(([, decision]) => decision === 'continue')
          .map(([name]) => name)
          .sort()
        expect(cards).toEqual(['end_agent', 'interrupt_agent', 'spawn_agent'])
        // ⛔ …and every other verb was ALLOWED rather than merely not-asked, which is the
        // distinction `{continue:true}` would have blurred: a yield reaches `canUseTool` and cards.
        for (const tool of EVERY_VERB.tools) {
          if (cards.includes(tool.name)) continue
          expect(answered[tool.name], tool.name).toBe('allow')
        }
        // ⚠️ **A built-in is untouched** — no opinion, as for every call that is not ours (728).
        expect(decisionOf(await floor('Bash', { command: 'ls' }))).toBe('continue')
        await handle.close()
        fq.end()
        await consumer
      })

      it('⛔ the exemption is the SESSION’S OWN toolset, not a name', async () => {
        // ⚑ **Two plants, not one** — the rule `461` wrote for its own set, at `486`'s door. A session whose
        // server is spelled differently exempts ITS name and not the other one.
        const probe = await startFake({
          approvalMode: 'ask',
          agentTools: { ...EVERY_VERB, server: 'brobot_probe' },
        })
        const floorProbe = floorOf(probe.sdkOptions)
        expect(decisionOf(await floorProbe('mcp__brobot_probe__reply_to_parent', {}))).toBe('allow')
        expect(
          decisionOf(await floorProbe('mcp__brobot__reply_to_parent', {})),
          'a server this session was never given exempts nothing',
        ).toBe('continue')
        await probe.handle.close()
        probe.fq.end()
        await probe.consumer

        // …and a session offered NO toolset exempts neither, rather than exempting a bare name.
        const bare = await startFake({ approvalMode: 'ask' })
        const floorBare = floorOf(bare.sdkOptions)
        expect(decisionOf(await floorBare('mcp__brobot__reply_to_parent', {}))).toBe('continue')
        expect(decisionOf(await floorBare('reply_to_parent', {}))).toBe('continue')
        await bare.handle.close()
        bare.fq.end()
        await bare.consumer
      })
    })
  })

  it('AskUserQuestion with MULTIPLE questions answers ALL by question text (033, fixing 023 P2 #1)', async () => {
    const { fq, handle, canUse, events, consumer } = await startFake()
    const input = {
      questions: [
        {
          question: 'pick a color',
          header: 'Color',
          options: [{ label: 'blue', description: '' }],
        },
        { question: 'pick a size', header: 'Size', options: [{ label: 'L', description: '' }] },
      ],
    }
    const answerP = canUse('AskUserQuestion', input, toolOpts('tu_m'))
    await vi.waitFor(has(events, (e) => e.type === 'user_input_request'))
    // 143: this fixture's options carry `description: ''` — Claude declares the field required, so
    // a producer sending an empty one is sending a reason that says nothing. It is dropped rather
    // than carried, for the same reason an absent one is: the card must render NOTHING where there
    // is no reason, and an empty string would draw a blank line that reads like a missing answer.
    expect(firstOfType(events, 'user_input_request').questions).toEqual([
      {
        id: 'q0',
        prompt: 'pick a color',
        header: 'Color',
        options: [{ label: 'blue' }],
        allowOther: true,
        multiSelect: false,
      },
      {
        id: 'q1',
        prompt: 'pick a size',
        header: 'Size',
        options: [{ label: 'L' }],
        allowOther: true,
        multiSelect: false,
      },
    ])
    await handle.respondUserInput('tu_m', { kind: 'answer', answers: { q0: 'blue', q1: 'L' } })
    // BOTH questions forwarded by their text (pre-fix: only question 1 survived).
    expect(await answerP).toMatchObject({
      behavior: 'allow',
      updatedInput: { answers: { 'pick a color': 'blue', 'pick a size': 'L' } },
    })
    await handle.close()
    fq.end()
    await consumer
  })

  it('AskUserQuestion with an INCOMPLETE answer is refused at the gesture, and the card stays live (033, 142)', async () => {
    // ⛔ **This used to assert `deny`, and that was the defect one layer up** (142 §1). The answer
    // was accepted, the ledger recorded `Answered`, and the provider was told the user declined.
    // The refusal now happens where the gesture does — so nothing is written, and the question the
    // partial answer failed to answer is still there to answer properly.
    const { fq, handle, canUse, events, consumer } = await startFake()
    const input = {
      questions: [
        { question: 'q one', header: 'A', options: [] },
        { question: 'q two', header: 'B', options: [] },
      ],
    }
    const answerP = canUse('AskUserQuestion', input, toolOpts('tu_i'))
    await vi.waitFor(has(events, (e) => e.type === 'user_input_request'))
    await expect(
      handle.respondUserInput('tu_i', { kind: 'answer', answers: { q0: 'only first' } }), // q1 unanswered
    ).rejects.toThrow(/cannot be forwarded/)

    // The card is STILL PENDING — the whole point of refusing rather than denying. Nothing has been
    // said to the provider, so the same request takes a complete answer and forwards it.
    await handle.respondUserInput('tu_i', {
      kind: 'answer',
      answers: { q0: 'only first', q1: 'and second' },
    })
    expect(await answerP).toMatchObject({
      behavior: 'allow',
      updatedInput: { answers: { 'q one': 'only first', 'q two': 'and second' } },
    })
    await handle.close()
    fq.end()
    await consumer
  })

  it('AskUserQuestion with NO questions is refused, and never becomes a card (064)', async () => {
    // ⚠️ **The ruling 064 was asked to make.** Zero questions used to publish a card that renders as
    // a single enabled "Approve" — right for the plan tools, whose input carries no choice, and
    // wrong for a QUESTION tool. Pressing it returned a bare `allow` with no `answers` at all, so
    // the model's own question came back successful and empty and it carried on as though a human
    // had answered. That is 063's defect wearing different clothes.
    //
    // Denied rather than repaired: the honest thing to tell the model is that its call was
    // malformed — which it can see and retry — rather than to invent an answer or to ask a human to
    // approve a question nobody was ever shown. It is the same fail-closed rule the INCOMPLETE case
    // above already applies; zero questions is the degenerate case of the same thing.
    const { fq, handle, canUse, events, consumer } = await startFake()

    const answerP = canUse('AskUserQuestion', { questions: [] }, toolOpts('tu_none'))

    expect(await answerP).toMatchObject({ behavior: 'deny' })
    // No card, and therefore nothing a human could have been asked to rubber-stamp.
    expect(events.some((e) => e.type === 'user_input_request')).toBe(false)
    await handle.close()
    fq.end()
    await consumer
  })

  it('two questions with the SAME TEXT are refused, and never become a card (146 §3)', async () => {
    // ⛔ **145 HIGH 3.** `AskUserQuestionOutput.answers` is a dictionary keyed by question TEXT and
    // the pinned SDK puts no uniqueness condition on it, so BroBot's positional ids kept two such
    // questions apart on screen and the payload loop then wrote the second answer over the first.
    // One human answer destroyed, silently, with the gesture recorded as `Answered` — and no second
    // carrier either, since `response` is deliberately absent when two questions were freeform.
    //
    // ⚑ **The remedy is 064's, applied to a second malformation**: the provider's shape cannot
    // encode this call, so the model is told so and can retry. **What the user sees is no card at
    // all.**
    const { fq, handle, canUse, events, consumer } = await startFake()

    const answerP = canUse(
      'AskUserQuestion',
      {
        questions: [
          { question: 'Anything else?', header: 'One', multiSelect: false, options: [] },
          { question: 'Anything else?', header: 'Two', multiSelect: false, options: [] },
        ],
      },
      toolOpts('tu_dup'),
    )

    expect(await answerP).toMatchObject({ behavior: 'deny' })
    expect((await answerP) as { message?: string }).toMatchObject({
      message: expect.stringContaining('same text'),
    })
    // ⛔ Nothing was shown, so nothing could be half-answered.
    expect(events.some((e) => e.type === 'user_input_request')).toBe(false)
    await handle.close()
    fq.end()
    await consumer
  })

  it('…while two questions that merely LOOK alike are asked as normal (146 §3)', async () => {
    // Non-vacuity for the refusal above: the rule is about the exact wire key, not about
    // similarity, and a call whose two questions differ by one character is an ordinary call.
    const { fq, handle, canUse, events, consumer } = await startFake()

    const answerP = canUse(
      'AskUserQuestion',
      {
        questions: [
          { question: 'Anything else?', header: 'One', multiSelect: false, options: [] },
          { question: 'Anything else??', header: 'Two', multiSelect: false, options: [] },
        ],
      },
      toolOpts('tu_near'),
    )
    await vi.waitFor(has(events, (e) => e.type === 'user_input_request'))
    await handle.respondUserInput('tu_near', {
      kind: 'answer',
      answers: { q0: 'alpha', q1: 'beta' },
    })

    expect(await answerP).toMatchObject({
      behavior: 'allow',
      updatedInput: { answers: { 'Anything else?': 'alpha', 'Anything else??': 'beta' } },
    })
    await handle.close()
    fq.end()
    await consumer
  })

  it('a question whose TEXT is `__proto__` is answered, not swallowed (146 §2)', async () => {
    // ⛔ **145 HIGH 2, the Claude half.** The payload dictionary is keyed by the model's own
    // sentence, `question: string` is unrestricted in the pinned typings, and on an ordinary object
    // `answers['__proto__'] = text` sets the PROTOTYPE — so `JSON.stringify` would hand the SDK
    // `{}` and the model would see its question unanswered while BroBot recorded `Answered`. Built
    // on a null prototype, the key is an ordinary own property and serialises like any other.
    const { fq, handle, canUse, events, consumer } = await startFake()

    const answerP = canUse(
      'AskUserQuestion',
      {
        questions: [
          { question: '__proto__', header: 'Odd', multiSelect: false, options: [] },
          { question: 'constructor', header: 'Odder', multiSelect: false, options: [] },
        ],
      },
      toolOpts('tu_proto'),
    )
    await vi.waitFor(has(events, (e) => e.type === 'user_input_request'))
    await handle.respondUserInput('tu_proto', {
      kind: 'answer',
      answers: { q0: 'alpha', q1: 'beta' },
    })

    const result = (await answerP) as { updatedInput?: { answers?: Record<string, string> } }
    const answers = result.updatedInput?.answers ?? {}
    // ⛔ The assertion that actually catches it: `toMatchObject` would pass on a prototype read.
    expect(Object.getOwnPropertyNames(answers).sort()).toEqual(['__proto__', 'constructor'])
    expect(JSON.stringify(answers)).toBe('{"__proto__":"alpha","constructor":"beta"}')
    await handle.close()
    fq.end()
    await consumer
  })

  it('still asks for the plan tool, which genuinely has nothing to ask (064)', async () => {
    // Non-vacuity for the refusal above: `claudeQuestions` returns `[]` for EVERY non-question tool,
    // so a refusal keyed on "no questions" alone would have silently killed plan-mode consent. The
    // rule is about `AskUserQuestion` specifically, and this is what proves it. ⚑ `ExitPlanMode`
    // since `736` — `EnterPlanMode` raises no card at all (R98).
    const { fq, handle, canUse, events, consumer } = await startFake()

    const exitP = canUse('ExitPlanMode', { plan: '# Plan\n' }, toolOpts('tu_exit_064'))
    await vi.waitFor(has(events, (e) => e.type === 'user_input_request'))
    await handle.respondUserInput('tu_exit_064', { kind: 'answer', answers: {} })

    expect(await exitP).toEqual({ behavior: 'allow' })
    await handle.close()
    fq.end()
    await consumer
  })

  it('close() safe-rejects a pending permission (SDK gets deny), no hang', async () => {
    const { fq, handle, canUse, events, consumer } = await startFake()
    const pendingP = canUse('Write', { file_path: '/tmp/x/f' }, toolOpts('tu_z'))
    await vi.waitFor(has(events, (e) => e.type === 'permission_request'))
    await handle.close()
    fq.end()
    await consumer
    expect(await pendingP).toEqual({ behavior: 'deny', message: 'session closed' })
  })

  it('respondPermission on an unknown id throws', async () => {
    const { fq, handle, consumer } = await startFake()
    await expect(handle.respondPermission('nope', { outcome: 'allow' })).rejects.toThrow()
    await handle.close()
    fq.end()
    await consumer
  })
})
