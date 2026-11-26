import { mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Options } from '@anthropic-ai/claude-agent-sdk'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import {
  QUESTION_REQUEST_KEYS,
  askedOfTheChannel,
  type AgentToolset,
  type SessionHandle,
} from '../src/index'
import {
  FakeQuery,
  init,
  firstOfType,
  has,
  toolOpts,
  atOnce,
  sdkToolCall,
  startFake,
  recordingClaudeRuntime,
} from './fake-claude-query'

describe('the settings a live conversation can change (076)', () => {
  /** Get to a session with a real ref and an idle turn machine. */
  async function live(opts: Parameters<typeof startFake>[0] = {}) {
    const ctx = await startFake(opts)
    ctx.fq.emit(init('sess_live', '/tmp/x'))
    await vi.waitFor(() => expect(ctx.handle.ref).not.toBeNull())
    return ctx
  }

  it('moves effort with applyFlagSettings — NOT the deprecated setMaxThinkingTokens', async () => {
    // ⚠️ The dispatch expected `Query.setMaxThinkingTokens()`, and at our pin that is the wrong
    // knob. It is `@deprecated` (0.3.218 and 0.3.281 alike) and it sets a token CEILING — the SDK
    // says "on Opus 4.6 this is treated as on/off (0 = disabled, any other value = adaptive)". Effort
    // is a separate axis with its own vocabulary (`EffortLevel`), and `applyFlagSettings` is the only
    // member of the pinned `Query` that moves the running session's (680: 0.3.281's `updateSettings`
    // takes one too, and saves it without setting the running level). Asserting the absence as well as the presence, because
    // "we called something" is not the claim being made here.
    const { fq, handle, consumer } = await live()
    await handle.setReasoningEffort('xhigh')
    expect(fq.calls, 'queued — nothing reaches the SDK before the turn boundary').toEqual([])

    await handle.send('go')
    expect(fq.calls).toContain('effort:xhigh')
    expect(fq.calls.some((call) => call.includes('MaxThinkingTokens'))).toBe(false)
    expect(handle.settings.reasoningEffort.effective).toBe('xhigh')

    await handle.close()
    await consumer
  })

  it('refuses an effort this provider does not have, BY NAME, and records nothing (076 §2)', async () => {
    // The §2 rule: an unrecognised value is a STATED limitation, never a quiet substitution. `ultra`
    // is real — it is Codex's — and can arrive from a persisted row or a hand-edited setting now
    // that `ReasoningEffort` is open. The three wrong answers are passing it (a type error),
    // dropping it (a toggle that does nothing) and rounding it to `high` (this app inventing a
    // choice on the user's behalf). Only refusing leaves the user knowing what happened.
    const { fq, handle, consumer } = await live()
    await expect(handle.setReasoningEffort('ultra')).rejects.toThrow(/does not offer/)
    await expect(handle.setReasoningEffort('ultra')).rejects.toThrow(
      /low, medium, high, xhigh, max/,
    )
    expect(handle.settings.reasoningEffort.requested, 'nothing was recorded').toBeUndefined()

    await handle.send('go')
    expect(fq.calls, 'and nothing reached the SDK on the next turn either').toEqual([])

    await handle.close()
    await consumer
  })

  it('a launch carrying an effort Claude cannot take leaves its default alone (076 §2)', async () => {
    // The same rule at the other door, where the honest answer is different. A LAUNCH must not fail
    // over a value from a persisted row — that would make a session un-resumable — so the field is
    // omitted and Claude's own default stands, which is exactly what "we did not ask" means. The
    // live path refuses instead, because there a user is watching and can be told.
    const { handle, sdkOptions, consumer } = await live({ reasoningEffort: 'ultra' })
    expect(sdkOptions().effort, 'never coerced to a neighbouring level').toBeUndefined()
    // ⚠️ **And the session must not REPORT it either** (found in review). The first version omitted
    // the effort from the SDK Options — correct — and still seeded the handle with the raw value, so
    // `settings.reasoningEffort.effective` read `ultra` for a session running on Claude's own
    // default. The header renders that pair as "running with ultra". Dropping a value silently is
    // bad; dropping it and then claiming it is running is the failure this codebase treats as
    // equal to a crash.
    expect(
      handle.settings.reasoningEffort.effective,
      'what we report and what we sent must be the same value',
    ).toBeUndefined()

    await handle.close()
    await consumer
  })

  it('rolls the approval mode back when the queued settings fail to apply (found in review)', async () => {
    // ⚠️ Before 076 nothing between `approvals.adopt()` and the message push could throw, so the
    // adopt was final by construction. `applyPendingSettings` can now reject — three SDK control
    // requests — and without a rollback the session would keep reporting a mode the SDK was never
    // told about, for the rest of its life, on the one setting where being wrong is a safety claim.
    const { fq, handle, consumer } = await live()
    // A query whose `setModel` rejects is the realistic shape: the method is optional on
    // `ClaudeQuery`, so a CLI that does not implement the control request fails at call time.
    fq.setModel = () => Promise.reject(new Error('control request not supported'))

    await handle.setApprovalMode('auto')
    await handle.setModel('haiku')
    expect(handle.approval).toEqual({ effective: 'ask', requested: 'auto' })

    await expect(handle.send('go')).rejects.toThrow(/not supported/)
    expect(handle.approval.effective, 'the SDK was never told, so nothing may claim it was').toBe(
      'ask',
    )
    expect(
      handle.approval.requested,
      'the user still wants it — the turn failed, not the choice',
    ).toBe('auto')
    expect(handle.settings.model.effective, 'and the model did not adopt either').toBeUndefined()

    await handle.close()
    await consumer
  })

  it('turning plan mode ON is a control; turning it OFF belongs to the plan card (the 076 ruling)', async () => {
    // `setPlanMode(false)` IS the go-ahead — one state transition, one name. On this provider the
    // go-ahead already has a surface: the model raises `ExitPlanMode`, the adapter shows the card,
    // and answering it releases the plan. A client-side switch beside that would be a rival way out
    // of one state, and the two could disagree because the card is answered inside the SDK.
    const { fq, handle, consumer } = await live()
    await expect(handle.setPlanMode(false)).rejects.toThrow(/plan-approval request/)
    expect(handle.planNeedsGoAhead, 'which is why no second button is ever offered here').toBe(
      false,
    )

    await handle.setPlanMode(true)
    expect(handle.settings.planMode).toEqual({ effective: false, requested: true })
    await handle.send('go')
    expect(fq.calls).toContain('permissionMode:plan')
    expect(handle.settings.planMode.effective).toBe(true)

    await handle.close()
    await consumer
  })

  it('a yolo session that starts planning keeps its MODE — and, since 728, its write is the provider’s plan-mode ask, shown to the person (056/140/728)', async () => {
    // ⚑ **728 · R93** — the tool half below asserted 140's floor; the floor is gone, and the CLI's
    // own plan mode asks before a `Write` even in its unattended mode (measured, `plan-write-auto`),
    // so an unattended session that starts planning leaves that ask to the person.
    // ⚠️ The mode half is 076's and is unchanged: moving the plan bit must not drag the approval
    // floor with it. `permissionMode` is one enum carrying two of this app's concepts, and asking
    // for `bypassPermissions` mid-session would leave our claim and the SDK's disagreeing with
    // nothing to resolve them.
    //
    // ⛔ **The tool half was wrong, and it was wrong in the way this suite has learned to look
    // for.** It asserted that a yolo session which starts planning still runs `Bash` unattended, and
    // it proved it by calling `canUse` DIRECTLY — under the guard hook, which is the layer that
    // decides. So it described a door the provider does not use. 140's incident is that door: a
    // Bash card approved in a session whose header said "planning", which wrote a file into a real
    // `~/.claude`. Driven through {@link sdkToolCall} it now refuses, and yolo cannot vote.
    const { fq, handle, consumer, sdkOptions, events } = await live({ approvalMode: 'auto' })
    const write = { file_path: '/tmp/x/plan.txt', content: 'x' }
    // ⚑ CONTROL, one fact apart: the same write before planning is answered for the person.
    await expect(
      sdkToolCall(sdkOptions(), 'Write', write, toolOpts('tu_before_plan')),
    ).resolves.toMatchObject({ behavior: 'allow' })
    await handle.setPlanMode(true)
    await handle.send('go')

    expect(fq.calls).toContain('permissionMode:plan')
    expect(handle.approval.effective, 'untouched by a plan-mode change').toBe('auto')
    expect(
      fq.calls.includes('permissionMode:bypassPermissions'),
      'the approval floor is never re-asserted from the plan control',
    ).toBe(false)

    const pending = sdkToolCall(sdkOptions(), 'Write', write, toolOpts('tu_plan_yolo'))
    await vi.waitFor(() =>
      expect(
        events.filter((e) => e.type === 'permission_request').map((e) => e.action),
        'no floor of this app’s refuses it, and no unattended allow answers it (728)',
      ).toEqual(['Write']),
    )

    await handle.close()
    await expect(pending).resolves.toMatchObject({ behavior: 'deny' })
    await consumer
  })

  it('clears the flag layer with null, because undefined would silently do nothing', async () => {
    // The SDK documents `undefined` as "dropped by JSON serialization and has no effect" and `null`
    // as "clear it from the flag layer and fall back to lower-precedence sources". So the user
    // undoing their choice — `setReasoningEffort(undefined)` — must become `null` on the wire, or it
    // is a control that appears to work and does not.
    const { fq, handle, events, consumer } = await live()
    await handle.setReasoningEffort('max')
    await handle.send('one')
    expect(fq.calls).toContain('effort:max')

    fq.emit({ type: 'result', subtype: 'success', session_id: 'sess_live' })
    await vi.waitFor(() => expect(handle.status()).toBe('idle'))
    void events

    await handle.setReasoningEffort(undefined)
    await handle.send('two')
    expect(fq.calls).toContain('effort:(null)')
    expect(fq.calls, 'undefined would be dropped in serialization and do nothing').not.toContain(
      'effort:(undefined)',
    )
    expect(handle.settings.reasoningEffort.effective).toBeUndefined()

    await handle.close()
    await consumer
  })
})

/**
 * 🔴 **W4.189 · a give's folder is a work-folder grant on the conversation** — on Claude,
 * `permissions.additionalDirectories` in the flag layer, BESIDE the kept rules the launch put there.
 * ⚠️ A `permissions` sent through `applyFlagSettings` replaces the whole object (`sdk.d.ts`), so a
 * change that forgot them would drop every rule a person kept. ⚑ Next-turn, like the settings 076
 * made, and adopted only once the CLI took it.
 */
describe('W4.189 · work folders ride the flag layer beside the kept rules — Claude', () => {
  /** ⚑ Kept as the CLI keeps them in the provider home's own `settings.json` (736). */
  const KEPT = { allow: ['Bash(make build *)'], deny: ['Bash(rm *)'] }
  let home: string
  beforeEach(() => {
    home = realpathSync(mkdtempSync(join(tmpdir(), 'brobot2-w4189-')))
    writeFileSync(join(home, 'settings.json'), JSON.stringify({ permissions: KEPT }))
  })
  afterEach(() => {
    rmSync(home, { recursive: true, force: true })
  })

  const permissionsOf = (options: Options | undefined): unknown =>
    (options?.settings as { permissions?: unknown } | undefined)?.permissions

  /** A live session launched in the scratch home, with its kept rules on disk. */
  async function live(workFolders?: readonly string[]) {
    const ctx = await startFake({ home, ...(workFolders ? { workFolders } : {}) })
    ctx.fq.emit(init('sess_w', home))
    await vi.waitFor(() => expect(ctx.handle.ref).not.toBeNull())
    return ctx
  }

  async function endTurn(fq: FakeQuery, handle: SessionHandle): Promise<void> {
    fq.emit({ type: 'result', subtype: 'success', is_error: false })
    await vi.waitFor(() => expect(handle.status()).toBe('idle'))
  }

  it('🔴 the launch’s flag settings carry the kept rules AND the work folders — never `--add-dir`', async () => {
    const { handle, sdkOptions, consumer } = await live(['/w/a', '/w/b'])
    expect(permissionsOf(sdkOptions())).toStrictEqual({
      ...KEPT,
      additionalDirectories: ['/w/a', '/w/b'],
    })
    expect(sdkOptions().additionalDirectories, 'a launch flag cannot be taken back').toBeUndefined()
    expect(handle.workFolders).toEqual({ effective: ['/w/a', '/w/b'], requested: ['/w/a', '/w/b'] })
    await handle.close()
    await consumer
  })

  it('⚑ THE CONTROL — no work folder: the kept rules alone, with no `additionalDirectories` key', async () => {
    const { handle, sdkOptions, consumer } = await live()
    expect(permissionsOf(sdkOptions())).toStrictEqual(KEPT)
    await handle.close()
    await consumer
  })

  it('🔴 a change mid-turn waits for the turn boundary, then sends the kept rules and the new list in ONE call', async () => {
    const { fq, handle, consumer } = await live()
    await handle.send('one')
    handle.setWorkFolders(['/w/a', '/w/b'])
    expect(fq.flagSettings, 'nothing reaches the CLI while a turn runs').toEqual([])
    expect(handle.workFolders).toEqual({ effective: [], requested: ['/w/a', '/w/b'] })
    await endTurn(fq, handle)

    await handle.send('two')
    expect(fq.flagSettings).toStrictEqual([
      { permissions: { ...KEPT, additionalDirectories: ['/w/a', '/w/b'] } },
    ])
    expect(handle.workFolders).toEqual({ effective: ['/w/a', '/w/b'], requested: ['/w/a', '/w/b'] })
    await handle.close()
    await consumer
  })

  it('🔴 an EMPTY list keeps the kept rules — it takes the folders away, never the rules', async () => {
    const { fq, handle, consumer } = await live(['/w/a'])
    handle.setWorkFolders([])
    await handle.send('one')
    expect(fq.flagSettings).toStrictEqual([{ permissions: KEPT }])
    expect(handle.workFolders.effective).toEqual([])
    await handle.close()
    await consumer
  })

  it('⚑ …and with no kept rule at all it CLEARS the key — the launch wrote none', async () => {
    rmSync(join(home, 'settings.json'))
    const { fq, handle, sdkOptions, consumer } = await live(['/w/a'])
    expect(permissionsOf(sdkOptions())).toStrictEqual({ additionalDirectories: ['/w/a'] })
    handle.setWorkFolders([])
    await handle.send('one')
    expect(fq.flagSettings).toStrictEqual([{ permissions: null }])
    await handle.close()
    await consumer
  })

  it('⚑ the same list in a new array asks the CLI nothing', async () => {
    const { fq, handle, consumer } = await live(['/w/a'])
    handle.setWorkFolders(['/w/a'])
    await handle.send('one')
    expect(fq.flagSettings).toEqual([])
    expect(handle.workFolders).toEqual({ effective: ['/w/a'], requested: ['/w/a'] })
    await handle.close()
    await consumer
  })

  it('⛔ a call that THROWS fails the send and adopts nothing — the next send asks again', async () => {
    const { fq, handle, consumer } = await live(['/w/a'])
    const real = fq.applyFlagSettings.bind(fq)
    let refuse = true
    fq.applyFlagSettings = (settings) =>
      refuse ? Promise.reject(new Error('control request not supported')) : real(settings)
    handle.setWorkFolders(['/w/a', '/w/b'])

    await expect(handle.send('one')).rejects.toThrow(/not supported/)
    expect(handle.workFolders, 'a list the CLI never took is never effective').toEqual({
      effective: ['/w/a'],
      requested: ['/w/a', '/w/b'],
    })
    await vi.waitFor(() => expect(handle.status()).toBe('idle'))

    refuse = false
    await handle.send('two')
    expect(handle.workFolders.effective).toEqual(['/w/a', '/w/b'])
    await handle.close()
    await consumer
  })

  it('⛔ …and a query with NO applyFlagSettings fails the send by name', async () => {
    const { fq, handle, consumer } = await live()
    Object.defineProperty(fq, 'applyFlagSettings', { value: undefined })
    handle.setWorkFolders(['/w/a'])
    await expect(handle.send('one')).rejects.toThrow(
      /cannot change the work folders: .* no applyFlagSettings\(\)/,
    )
    expect(handle.workFolders.effective).toEqual([])
    await handle.close()
    await consumer
  })

  it('🔴 a RESUME carries them, beside the kept rules, as a start does', async () => {
    const { fq, runtime, options: launched } = recordingClaudeRuntime()
    const handle = await runtime.resume(
      { provider: 'claude', sessionId: 'sess_w', cwd: home, rotation: 0 },
      { providerHome: home, workFolders: ['/w/a'] },
    )
    const options = launched()
    expect(options?.resume).toBe('sess_w')
    expect(permissionsOf(options)).toStrictEqual({ ...KEPT, additionalDirectories: ['/w/a'] })
    expect(handle.workFolders.effective).toEqual(['/w/a'])
    await handle.close()
    fq.end()
  })
})

/**
 * 140 · **Plan mode is a promise this app makes, so this app has to keep it.**
 *
 * The incident: a session launched from the UI with plan mode ON, whose header said so, whose
 * `provider_session.plan_mode` said so — and which wrote a file into the user's personal
 * `~/.claude/plans/` at a path the model invented, because it had never been told it was planning.
 *
 * ⛔ **The mechanism, measured rather than reasoned about.** `--permission-mode plan` was on the
 * child's argv every time (read off `ps`). The CLI threw it away, because
 * `CLAUDE_CODE_SUBPROCESS_ENV_SCRUB` — set here since 026, from its name — makes the CLI
 * `return { mode: 'default' }` before it looks at anything else, and writes the reason to a stderr
 * nobody reads. Three hypotheses died first (the toggle never calls the session layer; the guard
 * hook out-votes the mode; the streaming prompt), and each one is a control in
 * `smoke/plan-mode-probe.smoke.ts`.
 *
 * So there are two fixes and they are different in kind. Not setting the variable makes the
 * PROVIDER's plan mode real again — the system reminder, the plan file in the app's own home,
 * `ExitPlanMode`. The floor in {@link promptGuardHooks} makes the guarantee OURS, which is the part
 * that survives the next provider flag nobody predicted.
 */
describe('plan mode is a promise this app keeps itself (140)', () => {
  async function planning(opts: Parameters<typeof startFake>[0] = {}) {
    const ctx = await startFake({ planMode: true, ...opts })
    ctx.fq.emit(init('sess_plan', '/tmp/x'))
    await vi.waitFor(() => expect(ctx.handle.ref).not.toBeNull())
    return ctx
  }

  it('the launch asks for plan AND stops handing the CLI the flag that overrides it', async () => {
    const { handle, consumer, sdkOptions } = await planning()
    const options = sdkOptions()
    expect(options.permissionMode).toBe('plan')
    // 🔴 The root cause, as an absence. With this key present the line above is a request the CLI
    // discards, which is the whole of 140 in two assertions.
    expect('CLAUDE_CODE_SUBPROCESS_ENV_SCRUB' in (options.env ?? {})).toBe(false)
    // …and the isolation it was supposed to be part of is untouched.
    expect(options.env?.CLAUDE_CONFIG_DIR).toBe('/tmp/x/home')
    expect(options.settingSources).toEqual([])
    await handle.close()
    await consumer
  })

  it('the way OUT of plan mode is never denied — the floor cannot trap the session', async () => {
    // ⛔ If this ever goes red the feature is unusable: `ExitPlanMode` carries the plan the user has
    // to approve, and denying it would leave a session that can only ever propose. It is in
    // `USER_INPUT_TOOLS`, which the guard consults BEFORE the plan floor, and that ordering is the
    // reason. `AskUserQuestion` rides the same exit for the same reason.
    const { handle, events, consumer, sdkOptions } = await planning()
    for (const [tool, input] of [
      ['ExitPlanMode', { plan: '# do the thing' }],
      ['AskUserQuestion', { questions: [{ question: 'which?', options: ['a', 'b'] }] }],
    ] as const) {
      const pending = sdkToolCall(sdkOptions(), tool, input, toolOpts(`tu_${tool}`))
      await vi.waitFor(has(events, (e) => e.type === 'user_input_request'))
      const card = firstOfType(events, 'user_input_request')
      // ⚠️ Answered for real, from the card's OWN question id, and the result awaited without a
      // swallow. A `.catch(() => {})` here would let a denied tool pass as a delivered one, which is
      // the only failure this test exists to catch.
      await handle.respondUserInput(`tu_${tool}`, {
        kind: 'answer',
        answers: Object.fromEntries(card.questions.map((q) => [q.id, q.options[0]?.label ?? 'a'])),
      })
      await expect(pending, `${tool} was allowed through, not denied`).resolves.toMatchObject({
        behavior: 'allow',
      })
      events.length = 0
    }
    await handle.close()
    await consumer
  })

  it('the toggle and the launch reach the SAME state — one path, not two', async () => {
    // Criterion 5. A session that starts planning and a session that is switched to planning must
    // be indistinguishable afterwards, or "plan mode" is two features wearing one name — which is
    // exactly what 140 found: the launcher's checkbox reached the store and the model's own
    // `EnterPlanMode` reached the provider, and nobody could see that those were different things.
    const launched = await planning()
    const toggled = await startFake()
    toggled.fq.emit(init('sess_toggled', '/tmp/x'))
    await vi.waitFor(() => expect(toggled.handle.ref).not.toBeNull())
    await toggled.handle.setPlanMode(true)
    await toggled.handle.send('go')

    // ⚑ **728** — the same STATE; the floor that also refused a `Write` in both is gone (R93).
    for (const ctx of [launched, toggled]) {
      expect(ctx.handle.settings.planMode.effective).toBe(true)
    }
    expect(launched.sdkOptions().permissionMode).toBe('plan')
    // And the toggle told the SDK, so the provider's own half moved too.
    expect(toggled.fq.calls).toContain('permissionMode:plan')

    await launched.handle.close()
    await launched.consumer
    await toggled.handle.close()
    await toggled.consumer
  })

  it('a plan REQUESTED does not govern the turn already running', async () => {
    // The floor reads `effective`, not `requested`, for the reason `NextTurnSetting` exists: the
    // tools of a turn in flight stay governed by what that turn started under. A floor that read
    // `requested` would change the rules under a card the user is already looking at.
    const { handle, consumer, events, sdkOptions } = await startFake().then(async (ctx) => {
      ctx.fq.emit(init('sess_pending', '/tmp/x'))
      await vi.waitFor(() => expect(ctx.handle.ref).not.toBeNull())
      return ctx
    })
    await handle.setPlanMode(true)
    expect(handle.settings.planMode).toEqual({ effective: false, requested: true })
    // Not denied — CARDED, which is what this session was already doing. The floor arrives with the
    // next turn, along with the mode the SDK is told about, so the two can never disagree.
    const pending = sdkToolCall(
      sdkOptions(),
      'Write',
      { file_path: '/tmp/x/a.txt' },
      toolOpts('tu_inflight'),
    )
    await vi.waitFor(has(events, (e) => e.type === 'permission_request'))
    await handle.respondPermission('tu_inflight', { outcome: 'deny' })
    await expect(pending).resolves.toMatchObject({ behavior: 'deny' })
    expect(
      firstOfType(events, 'permission_request'),
      'still the turn the user sent before they asked to plan',
    ).toBeDefined()
    await handle.close()
    await consumer
  })
})

/**
 * 🔴 **358 · what tools this conversation has, published off the child's own opening frame.**
 *
 * The declared toolset is an offer; system/init tools and mcp_servers state what the child sees.
 * The paired probe measured 37 tools, including five BroCrew tools and brobot[connected], against
 * 32 tools and no server with the toolset detached. The tests must establish that join.
 */
describe('the tools a conversation has (358)', () => {
  /** The declaration, in the shape `agentToolsFor` produces. TWO of the five: enough to join on. */
  const TOOLSET: AgentToolset = {
    server: 'brobot',
    instructions: 'These tools reach the app you are running inside.',
    tools: [
      {
        name: 'list_agents',
        description: 'List the agents you can see.',
        beyondItsRails: 'nothing-its-rails-do-not-cover',
        input: { project: z.string().optional().describe('Only agents in this project.') },
        call: async () => ({ text: 'ok' }),
      },
      {
        name: 'spawn_agent',
        description: 'Create another agent.',
        beyondItsRails: 'it-starts-something-outside-this-app',
        input: {
          profile_slug: z.string().describe('Which agent identity to run as.'),
          cwd: z.string().optional(),
        },
        call: async () => ({ text: 'ok' }),
      },
    ],
  }

  /** An `init` frame carrying what the SDK declares it carries. */
  const fullInit = (tools: string[], servers: { name: string; status: string }[] = []) => ({
    ...init('sess_tools', '/tmp/x'),
    tools,
    mcp_servers: servers,
  })

  it('⛔ publishes both halves, and the join is exact', async () => {
    const { fq, handle, events, consumer } = await startFake({ agentTools: TOOLSET })
    fq.emit(
      fullInit(
        ['Bash', 'Read', 'mcp__brobot__list_agents', 'mcp__brobot__spawn_agent'],
        [{ name: 'brobot', status: 'connected' }],
      ),
    )
    await vi.waitFor(has(events, (e) => e.type === 'tool_inventory'))
    const event = firstOfType(events, 'tool_inventory')

    // ⛔ **The spelling is DATA on the event**, so nothing downstream recognises a provider (039).
    expect(event.naming).toEqual({ prefix: 'mcp__', separator: '__' })
    expect(event.declared?.server).toBe('brobot')
    expect(event.declared?.tools.map((tool) => tool.name)).toEqual(['list_agents', 'spawn_agent'])
    expect(event.declared?.instructions).toBe('These tools reach the app you are running inside.')
    // The arguments, flattened from the JSON Schema the child was HANDED — `required` here is the
    // same document the door holds the model to.
    expect(event.declared?.tools[1]?.parameters).toEqual([
      {
        name: 'profile_slug',
        type: 'string',
        required: true,
        description: 'Which agent identity to run as.',
      },
      { name: 'cwd', type: 'string', required: false },
    ])
    expect(event.published?.tools).toEqual([
      'Bash',
      'Read',
      'mcp__brobot__list_agents',
      'mcp__brobot__spawn_agent',
    ])
    expect(event.published?.servers).toEqual([
      { name: 'brobot', status: 'connected', connectionKind: 'ready' },
    ])
    expect(event.source).toBe('init')

    await handle.close()
    fq.end()
    await consumer
  })

  it('⛔ a launch with NO toolset publishes `declared: null` — and still publishes the child’s list', async () => {
    // ⚑ The control arm of `probe:tool-inventory`, at the fold: the same frame, no toolset, and the
    // five names absent from what the child saw. Without this the assertion above is a string found
    // in a stream rather than a fact about the toolset.
    const { fq, handle, events, consumer } = await startFake()
    fq.emit(fullInit(['Bash', 'Read'], []))
    await vi.waitFor(has(events, (e) => e.type === 'tool_inventory'))
    const event = firstOfType(events, 'tool_inventory')
    expect(event.declared, 'nothing was declared, and the event says so').toBeNull()
    expect(event.published?.tools).toEqual(['Bash', 'Read'])
    expect(event.published?.servers).toEqual([])
    await handle.close()
    fq.end()
    await consumer
  })

  it('⛔ a frame with NO tool list publishes nothing — never an empty inventory', async () => {
    // 🔴 **The state that would be a lie.** `published: {tools: []}` reads as *"this conversation
    // has no tools"*; silence leaves the registry at *"we have not been told"*, which is true.
    // ⚠️ **And this frame is the ordinary one in this suite** — every other test's `init()` carries
    // no `tools` at all, so a version of this that threw took the whole session down with it.
    const { fq, handle, events, consumer } = await startFake({ agentTools: TOOLSET })
    fq.emit(init('sess_tools', '/tmp/x'))
    await vi.waitFor(has(events, (e) => e.type === 'session'))
    expect(events.filter((e) => e.type === 'tool_inventory')).toEqual([])
    // ⚑ The pair, on the SAME session: a frame that DOES carry one publishes.
    fq.emit(fullInit(['Bash'], []))
    await vi.waitFor(has(events, (e) => e.type === 'tool_inventory'))
    expect(firstOfType(events, 'tool_inventory').published?.tools).toEqual(['Bash'])
    await handle.close()
    fq.end()
    await consumer
  })

  it('⛔ a row shed by the defensive read is COUNTED — a cap is never silent, for any reason', async () => {
    // 🔴 **Found by an adversarial pass over this dispatch's own diff.** `boundInventory` computes
    // `dropped` from the arrays it is HANDED, so the two runtime filters above it were shedding
    // rows invisibly. ⚠️ **And it produced a false SENTENCE**: a server row with no `status` was
    // dropped, the sheet found no status for our own server, and it printed *"the agent did not
    // list this server"* — about a server the child DID list — with the shortfall banner suppressed
    // because `dropped` was 0.
    const { fq, handle, events, consumer } = await startFake({ agentTools: TOOLSET })
    fq.emit({
      ...init('sess_tools', '/tmp/x'),
      tools: ['Bash', null, 'Read'],
      mcp_servers: [{ name: 'brobot', status: 'connected' }, { name: 'nostatus' }],
    })
    await vi.waitFor(has(events, (e) => e.type === 'tool_inventory'))
    const event = firstOfType(events, 'tool_inventory')
    expect(event.published?.tools, 'the usable names survive').toEqual(['Bash', 'Read'])
    expect(event.published?.servers).toEqual([
      { name: 'brobot', status: 'connected', connectionKind: 'ready' },
    ])
    expect(event.dropped, 'one nameless tool and one server with no status').toBe(2)
    await handle.close()
    fq.end()
    await consumer
  })

  it('…and a clean frame carries no `dropped` field at all', async () => {
    // The pair: without it, `toBe(2)` above is satisfied by an adapter that reports a shortfall on
    // every frame — which would put the banner on an inventory that lost nothing.
    const { fq, handle, events, consumer } = await startFake({ agentTools: TOOLSET })
    fq.emit(fullInit(['Bash'], [{ name: 'brobot', status: 'connected' }]))
    await vi.waitFor(has(events, (e) => e.type === 'tool_inventory'))
    expect(firstOfType(events, 'tool_inventory')).not.toHaveProperty('dropped')
    await handle.close()
    fq.end()
    await consumer
  })

  it('a malformed `mcp_servers` degrades to “named none” rather than losing the inventory', async () => {
    const { fq, handle, events, consumer } = await startFake({ agentTools: TOOLSET })
    fq.emit({ ...init('sess_tools', '/tmp/x'), tools: ['Bash'], mcp_servers: 'nonsense' })
    await vi.waitFor(has(events, (e) => e.type === 'tool_inventory'))
    const event = firstOfType(events, 'tool_inventory')
    expect(event.published?.tools, 'the list the child DID publish survives').toEqual(['Bash'])
    expect(event.published?.servers).toEqual([])
    await handle.close()
    fq.end()
    await consumer
  })

  it('⛔ a re-stated inventory is not a second row; a CHANGED one is', async () => {
    // ⚠️ **`257` §0 measured a cron re-emitting `system/init` on one stream at 10 194 / 54 805 /
    // 114 037 ms.** Four identical rows in the ledger say nothing happened; a row when the answer
    // MOVES is the only one a reader can act on.
    const { fq, handle, events, consumer } = await startFake({ agentTools: TOOLSET })
    fq.emit(fullInit(['Bash'], [{ name: 'brobot', status: 'connected' }]))
    await vi.waitFor(has(events, (e) => e.type === 'tool_inventory'))
    fq.emit(fullInit(['Bash'], [{ name: 'brobot', status: 'connected' }]))
    fq.emit(fullInit(['Bash'], [{ name: 'brobot', status: 'connected' }]))
    // …then something the reader would want: the server dropped out.
    fq.emit(fullInit(['Bash'], []))
    await vi.waitFor(
      has(events, (e) => e.type === 'tool_inventory' && e.published?.servers.length === 0),
    )
    const published = events.filter((e) => e.type === 'tool_inventory')
    expect(published, 'two rows: the first statement and the change').toHaveLength(2)
    expect(published[0]?.published?.servers).toEqual([
      { name: 'brobot', status: 'connected', connectionKind: 'ready' },
    ])
    expect(published[1]?.published?.servers).toEqual([])
    await handle.close()
    fq.end()
    await consumer
  })
})

/**
 * 🔴 **394 · what Claude puts in front of a person, and which half of it may travel** (HO-007 S4,
 * criterion 10).
 *
 * ## ⛔ From the wire, not from a capture
 *
 * ⚠️ **`394` §3: *"enumerate what a permission looks like on BOTH providers — from the code and the
 * wire, not from a capture. Absence in a capture is not absence."*** ⚑ Every event below is built by
 * the REAL adapter from a REAL `canUseTool` call and then handed to the real classifier, so the
 * claim is about what this provider actually emits rather than about what a fixture says it does.
 *
 * ## ⚠️ The kind Claude differs in, said rather than smoothed over
 *
 * ⛔ **On this provider a consent arrives as a TOOL NAME that produces an empty question list.**
 * `USER_INPUT_TOOLS` is `AskUserQuestion`, `ExitPlanMode`, `EnterPlanMode`; `claudeQuestions`
 * returns `[]` for everything that is not the first. ⚑ **Claude never populates `permission`** —
 * `a-grant-of-access` is Codex's shape, and the Codex suite is where it is demonstrated.
 */
describe('394 · Claude · what may travel to a parent', () => {
  it('🔴 AskUserQuestion TRAVELS; ExitPlanMode does NOT, and neither does a Bash approval — EnterPlanMode raises nothing (736)', async () => {
    const { fq, handle, canUse, events, consumer } = await startFake()
    // ⚑ **The question, first** — the positive, so the three refusals below are not the only thing
    // this test can produce. A suite where nothing travels would pass with a classifier that refused
    // everything.
    void canUse(
      'AskUserQuestion',
      {
        questions: [{ question: 'which branch?', header: 'Branch', options: [{ label: 'main' }] }],
      },
      toolOpts('tu_ask'),
    )
    void canUse('ExitPlanMode', { plan: 'do the thing' }, toolOpts('tu_exit'))
    // ⚑ Since `736` (R98) `EnterPlanMode` is allowed with no card, so nothing of it can travel.
    expect(await atOnce(canUse('EnterPlanMode', {}, toolOpts('tu_enter')))).toEqual({
      behavior: 'allow',
    })
    void canUse('Bash', { command: 'rm -rf /tmp/x' }, toolOpts('tu_bash'))
    await vi.waitFor(() =>
      expect(events.filter((e) => e.type === 'user_input_request')).toHaveLength(2),
    )
    await vi.waitFor(has(events, (e) => e.type === 'permission_request'))

    const verdictFor = (id: string): ReturnType<typeof askedOfTheChannel> => {
      const raised = events.find(
        (event) =>
          (event.type === 'user_input_request' || event.type === 'permission_request') &&
          event.id === id,
      )
      if (raised === undefined) throw new Error(`no request was raised for ${id}`)
      return askedOfTheChannel(raised)
    }

    expect(verdictFor('tu_ask')).toMatchObject({ travels: true, id: 'tu_ask' })
    // ⛔ **The plan card is CONSENT, and the classifier says so in its own word.** It is a request
    // with nothing to answer, which is what an approval is however it arrives.
    expect(verdictFor('tu_exit')).toEqual({
      travels: false,
      id: 'tu_exit',
      because: 'a-consent-with-nothing-to-answer',
    })
    expect(() => verdictFor('tu_enter')).toThrow('no request was raised for tu_enter')
    expect(verdictFor('tu_bash')).toEqual({
      travels: false,
      id: 'tu_bash',
      because: 'a-permission-decision',
    })

    // ⚠️ **And the shape the classifier admits is the shape this adapter emits** — asserted as the
    // NAMED SET rather than as a count, so a provider that dropped `prompt` and added a field would
    // fail here rather than keep an arithmetic fact true.
    const question = firstOfType(events, 'user_input_request')
    // ⚑ Every key the card carries is admitted; `isBlocking` is Codex's and absent here.
    expect(Object.keys(question).sort()).toEqual(
      QUESTION_REQUEST_KEYS.filter((key) => key !== 'isBlocking').sort(),
    )

    await handle.close()
    fq.end()
    await consumer
  })

  it('⛔ Claude never populates `permission`, so `a-grant-of-access` is not this provider’s shape', async () => {
    const { fq, handle, canUse, events, consumer } = await startFake()
    void canUse(
      'AskUserQuestion',
      { questions: [{ question: 'q', header: 'H', options: [{ label: 'a' }] }] },
      toolOpts('tu_1'),
    )
    void canUse('ExitPlanMode', { plan: 'p' }, toolOpts('tu_2'))
    // ⚑ The third member of `USER_INPUT_TOOLS` raises nothing since `736` (R98).
    expect(await atOnce(canUse('EnterPlanMode', {}, toolOpts('tu_3')))).toEqual({
      behavior: 'allow',
    })
    await vi.waitFor(() =>
      expect(events.filter((e) => e.type === 'user_input_request')).toHaveLength(2),
    )
    // ⚑ **Both of them, which is every request `USER_INPUT_TOOLS` still raises** — an assertion
    // over one would be a claim about a set made from a sample of it.
    for (const raised of events.filter((event) => event.type === 'user_input_request')) {
      expect(Object.hasOwn(raised, 'permission'), raised.id).toBe(false)
    }
    await handle.close()
    fq.end()
    await consumer
  })
})
