import type { Options, PermissionResult, SDKMessage } from '@anthropic-ai/claude-agent-sdk'
import { describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import type { AgentToolset } from '../src/agent-tools'
import { AnswerRefused } from '../src/answer-refused'
import { ClaudeRuntime, type ClaudeQuery } from '../src/claude/claude-runtime'
import type { RuntimeEvent } from '../src/events'
import { AsyncQueue } from '../src/internal/async-queue'

/**
 * 🔴 **728 · R93 — on Claude, the CLI's own engine decides what to ask; this app's hook adds nothing.**
 *
 * ⚑ R93: *"BroBot never declines, narrows, rewrites or adds an ask on its own account, and removes the
 * ones it has."* ⚑ **Measured** (`probe:tool-calls-as-the-cli`, the bundled CLI on a loopback, this
 * app's `PreToolUse` hook out): the CLI asks before `rm`, a `Write`, an `Edit`, `WebFetch` and every
 * MCP tool, and runs `ls`, `echo` and `git status` without asking; in plan mode it asks before a
 * `Write` and an MCP tool and runs `ls`; it writes a profile's memory without asking. ⛔ On `main` the
 * hook forced `ask` on all of them, refused every one while planning, and ALLOWED the memory write on
 * its own account — so each assertion below is red on `main`, and the controls are the three answers
 * the hook still gives: a question is routed to the person in every mode, this app's own rail-gated
 * verbs are allowed (orchestration, which R93 keeps), and nothing else.
 *
 * ⚑ **And the narrow grant is the CLI's OWN rule** (`736`, R94): its suggestion for the ask, held to
 * the conversation — for an edit its *allow all edits*, for a read outside the folder its directory
 * rule. Until `728` it was a whole-tool rule this hook narrowed by asking again, and `728` made it a
 * file rule of this app's own (`Edit(//<path>)` / `Read(//<path>)`), which R94 replaced.
 */

class FakeQuery implements ClaudeQuery {
  private readonly messages = new AsyncQueue<SDKMessage>()
  async interrupt(): Promise<unknown> {
    return undefined
  }
  close(): void {}
  [Symbol.asyncIterator](): AsyncIterator<SDKMessage> {
    return this.messages[Symbol.asyncIterator]()
  }
}

const TOOLSET: AgentToolset = {
  server: 'brobot',
  tools: [
    {
      name: 'reply_to_parent',
      description: 'Reply.',
      beyondItsRails: 'nothing-its-rails-do-not-cover',
      input: { text: z.string() },
      call: async () => ({ text: 'ok' }),
    },
    {
      name: 'spawn_agent',
      description: 'Start another agent.',
      beyondItsRails: 'it-starts-something-outside-this-app',
      input: { profile_slug: z.string() },
      call: async () => ({ text: 'ok' }),
    },
  ],
}

async function launched(opts: { approvalMode?: 'ask' | 'auto'; planMode?: boolean } = {}): Promise<{
  handle: Awaited<ReturnType<ClaudeRuntime['start']>>
  options: Options
  events: RuntimeEvent[]
  hook: (tool: string, input: unknown) => Promise<unknown>
}> {
  let captured: Options | undefined
  const runtime = new ClaudeRuntime(
    (params) => {
      captured = params.options
      return new FakeQuery()
    },
    async () => true,
  )
  const handle = await runtime.start({
    cwd: '/tmp/x',
    providerHome: '/tmp/x/home',
    agentTools: TOOLSET,
    ...(opts.approvalMode === undefined ? {} : { approvalMode: opts.approvalMode }),
    ...(opts.planMode === undefined ? {} : { planMode: opts.planMode }),
  })
  const events: RuntimeEvent[] = []
  void (async () => {
    for await (const event of handle.events()) events.push(event)
  })()
  if (captured === undefined) throw new Error('the query was never built')
  const options = captured
  const guard = options.hooks?.PreToolUse?.[0]?.hooks?.[0]
  if (guard === undefined) throw new Error('no PreToolUse hook')
  return {
    handle,
    options,
    events,
    hook: (tool, input) =>
      guard(
        {
          hook_event_name: 'PreToolUse',
          tool_name: tool,
          tool_input: input,
          tool_use_id: 'tu',
        } as never,
        'tu',
        { signal: new AbortController().signal },
      ),
  }
}

const NO_OPINION = { continue: true }
const decisionOf = (out: unknown): string =>
  (out as { hookSpecificOutput?: { permissionDecision?: string } }).hookSpecificOutput
    ?.permissionDecision ?? 'continue'

describe('728 · R93 — the hook asks nothing of its own', () => {
  it('🔴 in `ask`, an ordinary call gets NO opinion from the hook — the CLI’s engine decides (red on main: a forced ask)', async () => {
    const { handle, hook } = await launched({ approvalMode: 'ask' })
    for (const [tool, input] of [
      ['Bash', { command: 'ls' }],
      ['Bash', { command: 'rm -f x' }],
      ['Write', { file_path: '/tmp/x/a.txt', content: 'x' }],
      ['WebFetch', { url: 'https://example.invalid/', prompt: 'x' }],
      ['mcp__probe728__note_it', { note: 'x' }],
      ['mcp__brobot__spawn_agent', { profile_slug: 'x' }],
    ] as const) {
      expect(await hook(tool, input), `${tool} ${JSON.stringify(input)}`).toEqual(NO_OPINION)
    }
    await handle.close()
  })

  it('🔴 while planning, nothing is refused by this app (red on main: the plan floor denied it)', async () => {
    const { handle, hook } = await launched({ approvalMode: 'ask', planMode: true })
    for (const [tool, input] of [
      ['Bash', { command: 'ls' }],
      ['Write', { file_path: '/tmp/x/a.txt', content: 'x' }],
      ['mcp__probe728__note_it', { note: 'x' }],
    ] as const) {
      expect(await hook(tool, input), tool).toEqual(NO_OPINION)
    }
    await handle.close()
  })

  it('🔴 a write into the profile’s own memory is the CLI’s to decide too (red on main: allowed by the hook, and bounded)', async () => {
    const { handle, hook } = await launched({ approvalMode: 'ask' })
    const into = '/tmp/x/home/memory/MEMORY.md'
    expect(await hook('Write', { file_path: into, content: 'x' })).toEqual(NO_OPINION)
    expect(await hook('Write', { file_path: into, content: 'x'.repeat(300_000) })).toEqual(
      NO_OPINION,
    )
    await handle.close()
  })

  it('⚑ CONTROL · a question is still routed to the person, in both modes — the CLI hands it to its host in its own unattended mode too (measured)', async () => {
    for (const approvalMode of ['ask', 'auto'] as const) {
      const { handle, hook } = await launched({ approvalMode })
      expect(decisionOf(await hook('AskUserQuestion', {})), approvalMode).toBe('ask')
      expect(decisionOf(await hook('ExitPlanMode', {})), approvalMode).toBe('ask')
      await handle.close()
    }
  })

  it('⚑ CONTROL · this app’s own rail-gated verb is still ALLOWED — orchestration, which R93 keeps', async () => {
    const { handle, hook } = await launched({ approvalMode: 'ask' })
    expect(decisionOf(await hook('mcp__brobot__reply_to_parent', { text: 'x' }))).toBe('allow')
    await handle.close()
  })

  it('⚑ CONTROL · …and while planning too: the rails stay the whole gate for this app’s own verbs (R93 keeps orchestration; 728 review)', async () => {
    // ⚑ `728` first stood the rails aside while planning, so the CLI's plan-mode MCP ask decided —
    // and that put a card in front of `create_project`, whose whole effect is a card. Withdrawn.
    const { handle, hook } = await launched({ approvalMode: 'ask', planMode: true })
    expect(decisionOf(await hook('mcp__brobot__reply_to_parent', { text: 'x' }))).toBe('allow')
    await handle.close()
  })
})

describe('728 · R93 — in `auto`, what the CLI’s own unattended mode asks still reaches the person', () => {
  // ⚑ Measured (`probe:tool-calls-as-the-cli`): outside plan mode the CLI's skip-permissions asks
  // nothing (`auto-*`); in plan mode, entered from such a session, it still asks before a `Write`
  // (`plan-write-auto`). Until `728` this app's plan floor refused that call before `canUseTool`.
  const asked = async (planMode: boolean): Promise<{ result: unknown; events: RuntimeEvent[] }> => {
    const { handle, options, events } = await launched({ approvalMode: 'auto', planMode })
    if (options.canUseTool === undefined) throw new Error('no canUseTool')
    const pending = options.canUseTool('Write', { file_path: '/tmp/x/plan.txt', content: 'x' }, {
      signal: new AbortController().signal,
      toolUseID: 'tu_auto',
    } as never)
    const settled = await Promise.race([
      pending,
      new Promise((resolve) => setTimeout(() => resolve('pending'), 50)),
    ])
    await handle.close()
    return { result: settled, events }
  }

  it('🔴 while PLANNING, a call the CLI asks about raises a card — not answered on the person’s behalf (red on main: allowed unseen)', async () => {
    const { result, events } = await asked(true)
    expect(result).toBe('pending')
    expect(
      events.filter((one) => one.type === 'permission_request').map((one) => one.action),
    ).toEqual(['Write'])
  })

  it('⚑ CONTROL · not planning, the same call is answered for the person — the CLI’s skip-permissions asks nothing', async () => {
    const { result, events } = await asked(false)
    expect(result).toEqual({ behavior: 'allow' })
    expect(events.some((one) => one.type === 'permission_request')).toBe(false)
  })

  it('🔴 a plan the MODEL starts in `auto` counts too: after its `EnterPlanMode` is let through, the CLI’s ask is a card (728 review; measured, `enter-plan-write-auto`)', async () => {
    // ⚑ The CLI enters plan mode on this allow and asks before the next `Write`. ⛔ Until the
    // review, nothing recorded the plan when nobody was asked, so `auto` answered that ask unseen.
    const { handle, options, events } = await launched({ approvalMode: 'auto' })
    if (options.canUseTool === undefined) throw new Error('no canUseTool')
    const opts = (id: string): never =>
      ({ signal: new AbortController().signal, toolUseID: id }) as never
    await expect(options.canUseTool('EnterPlanMode', {}, opts('tu_enter'))).resolves.toEqual({
      behavior: 'allow',
    })
    expect(handle.settings.planMode.effective, 'the conversation is planning').toBe(true)
    const pending = options.canUseTool(
      'Write',
      { file_path: '/tmp/x/plan.txt', content: 'x' },
      opts('tu_w'),
    )
    const settled = await Promise.race([
      pending,
      new Promise((resolve) => setTimeout(() => resolve('pending'), 50)),
    ])
    expect(settled).toBe('pending')
    expect(
      events.filter((one) => one.type === 'permission_request').map((one) => one.action),
    ).toEqual(['Write'])
    await handle.close()
  })
})

describe('736 · R98 — the CLI does not ask before the model’s own EnterPlanMode, and in `ask` neither does BroBot', () => {
  const opts = (id: string, suggestions?: unknown[]): never =>
    ({
      signal: new AbortController().signal,
      toolUseID: id,
      ...(suggestions === undefined ? {} : { suggestions }),
    }) as never

  it('🔴 in `ask`, EnterPlanMode is let through with NO card, and the conversation is planning from it', async () => {
    // ⛔ On `main`: a consent card of this app's own (`728` F-11) — measured, `enter-plan-write`: the
    // CLI with this app's hook out asked its host for the `Write` and never for `EnterPlanMode`.
    const { handle, options, events } = await launched({ approvalMode: 'ask' })
    if (options.canUseTool === undefined) throw new Error('no canUseTool')
    // ⚑ Raced, so on `main` — where the call parks on a card — this is RED by its assertion, not by
    // a hung await (`736`'s review).
    const settled = await Promise.race([
      options.canUseTool('EnterPlanMode', {}, opts('tu_enter')),
      new Promise((resolve) => setTimeout(() => resolve('pending'), 200)),
    ])
    expect(settled).toEqual({ behavior: 'allow' })
    expect(events.filter((one) => one.type === 'user_input_request')).toEqual([])
    expect(handle.settings.planMode.effective, 'the conversation is planning').toBe(true)
    await handle.close()
  })

  it('🔴 …and what the CLI asks WHILE that plan stands is still a card — with no conversation grant, as the CLI’s plan-mode ask offers none', async () => {
    // ⚑ The plan-mode check's own ask carries no suggestion (measured, `plan-write`), so a grant
    // pressed here could not hold while the plan stands (`728`). R98 keeps what the CLI asks.
    // ⚑ An OPAQUE ask (`736`'s review): a `Write` with no suggestion is offered no grant planning or
    // not, so only an opaque tool's wholesale grant depends on the plan.
    const { handle, options, events } = await launched({ approvalMode: 'ask' })
    if (options.canUseTool === undefined) throw new Error('no canUseTool')
    void options.canUseTool('EnterPlanMode', {}, opts('tu_enter'))
    await vi.waitFor(() => expect(handle.settings.planMode.effective).toBe(true))
    void options.canUseTool('Bash', { command: 'rm -f x' }, opts('tu_b'))
    await vi.waitFor(() =>
      expect(events.filter((one) => one.type === 'permission_request')).toHaveLength(1),
    )
    const card = events.find((one) => one.type === 'permission_request')
    if (card?.type !== 'permission_request') throw new Error('no card')
    expect(card.action).toBe('Bash')
    expect(card.scope.availableDecisions).toEqual(['allow', 'deny', 'cancel'])
    await handle.close()
  })

  it('⚑ CONTROL — ExitPlanMode is still the person’s card: approving a plan is the CLI’s own ask', async () => {
    // ⚑ Planning from the launch, not from `EnterPlanMode` — so this passes on `main` too, where that
    // call parks on a card (`736`'s review).
    const { handle, options, events } = await launched({ approvalMode: 'ask', planMode: true })
    if (options.canUseTool === undefined) throw new Error('no canUseTool')
    void options.canUseTool('ExitPlanMode', { plan: '# Plan' }, opts('tu_exit'))
    await vi.waitFor(() =>
      expect(events.filter((one) => one.type === 'user_input_request')).toHaveLength(1),
    )
    expect(events.find((one) => one.type === 'user_input_request')).toMatchObject({
      id: 'tu_exit',
      consent: 'stop-planning',
    })
    await handle.close()
  })
})

describe('728 → 736 · the conversation grant is the CLI’s own rule (R94)', () => {
  const askedAndPressed = async (
    tool: string,
    input: Record<string, unknown>,
    outcome: 'allow_for_session' | 'allow',
    planMode = false,
    suggestions?: unknown[],
  ): Promise<{ result: PermissionResult | null; offered: readonly string[] }> => {
    const { handle, options, events } = await launched({ approvalMode: 'ask', planMode })
    if (options.canUseTool === undefined) throw new Error('no canUseTool')
    const pending = options.canUseTool(tool, input, {
      signal: new AbortController().signal,
      toolUseID: 'tu_grant',
      ...(suggestions === undefined ? {} : { suggestions }),
    } as never)
    await vi.waitFor(() =>
      expect(events.some((one) => one.type === 'permission_request')).toBe(true),
    )
    const card = events.find(
      (one): one is Extract<RuntimeEvent, { type: 'permission_request' }> =>
        one.type === 'permission_request',
    )!
    await handle.respondPermission(card.id, { outcome })
    const result = await pending
    await handle.close()
    return { result, offered: card.scope.availableDecisions }
  }

  it('🔴 736 · R94 — a write grant is the CLI’s own *allow all edits*, a read grant its DIRECTORY rule — never a narrower file rule of this app’s', async () => {
    // ⛔ On `main` (`728`): `Edit(//<file>)` and `Read(//<file>)` — this app's own rule for one file,
    // installed whatever the CLI suggested. ⚑ The suggestions below are the CLI's, as measured
    // (`736`'s loopback): a Write suggests `setMode acceptEdits`, a Read outside the folder
    // `Read(//<its folder>/**)`.
    const write = await askedAndPressed(
      'Write',
      { file_path: '/tmp/x/a.txt', content: 'x' },
      'allow_for_session',
      false,
      [{ type: 'setMode', mode: 'acceptEdits', destination: 'session' }],
    )
    expect(write.result).toMatchObject({
      behavior: 'allow',
      updatedPermissions: [{ type: 'setMode', mode: 'acceptEdits', destination: 'session' }],
    })
    const read = await askedAndPressed(
      'Read',
      { file_path: '/elsewhere/n.txt' },
      'allow_for_session',
      false,
      [
        {
          type: 'addRules',
          rules: [{ toolName: 'Read', ruleContent: '//elsewhere/**' }],
          behavior: 'allow',
          destination: 'session',
        },
      ],
    )
    expect(read.result).toMatchObject({
      updatedPermissions: [{ rules: [{ toolName: 'Read', ruleContent: '//elsewhere/**' }] }],
    })
  })

  it('⚑ …but an ORDINARY ask while planning — the CLI offered its own "don’t ask again" — keeps its grant (728 review: the plan-mode check sends no suggestion, measured)', async () => {
    const rule = [
      {
        type: 'addRules',
        rules: [{ toolName: 'Bash', ruleContent: 'rm -f x' }],
        behavior: 'allow',
        destination: 'localSettings',
      },
    ]
    const withIt = await askedAndPressed('Bash', { command: 'rm -f x' }, 'allow', true, rule)
    const without = await askedAndPressed('Bash', { command: 'rm -f x' }, 'allow', true)
    expect(without.offered, 'the plan-mode ask: no grant').toEqual(['allow', 'deny', 'cancel'])
    expect(withIt.offered.length, 'an ordinary ask: its grant').toBeGreaterThan(3)
  })

  it('⛔ a card raised while PLANNING offers no conversation grant — the CLI’s plan-mode ask offers none, and no rule holds while the plan stands', async () => {
    // ⚑ An OPAQUE ask with no suggestion (`736`'s review): since R94 a `Write` with none is offered
    // no grant planning or not, so only the wholesale grant still turns on the plan.
    const planning = await askedAndPressed('Bash', { command: 'rm -f x' }, 'allow', true)
    expect(planning.offered).toEqual(['allow', 'deny', 'cancel'])
    // ⚑ The control, ONE fact over: the same ask, not planning, offers its wholesale grant.
    const ordinary = await askedAndPressed('Bash', { command: 'rm -f x' }, 'allow', false)
    expect(ordinary.offered).toContain('allow_all_for_session')
  })

  it('⛔ with no "don’t ask again" of the CLI’s, no conversation grant — whatever the path — and refused if sent (736: a pattern-shaped path was `728`’s reason, and the rule is the CLI’s now)', async () => {
    for (const file_path of ['/tmp/x/*.txt', '/tmp/x/a[1].txt', '/tmp/x/!a.txt', 'relative.txt']) {
      const { handle, options, events } = await launched({ approvalMode: 'ask' })
      if (options.canUseTool === undefined) throw new Error('no canUseTool')
      void options.canUseTool('Write', { file_path, content: 'x' }, {
        signal: new AbortController().signal,
        toolUseID: 'tu_pattern',
      } as never)
      await vi.waitFor(() =>
        expect(events.some((one) => one.type === 'permission_request')).toBe(true),
      )
      const card = events.find(
        (one): one is Extract<RuntimeEvent, { type: 'permission_request' }> =>
          one.type === 'permission_request',
      )!
      expect(card.scope.availableDecisions, file_path).toEqual(['allow', 'deny', 'cancel'])
      await expect(
        handle.respondPermission(card.id, { outcome: 'allow_for_session' }),
        file_path,
      ).rejects.toBeInstanceOf(AnswerRefused)
      await handle.close()
    }
  })
})
