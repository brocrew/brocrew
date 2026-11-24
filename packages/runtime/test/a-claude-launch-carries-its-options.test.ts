import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { ModelInfo, Options, SDKUserMessage } from '@anthropic-ai/claude-agent-sdk'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { type RuntimeEvent } from '../src/index'
import { ClaudeRuntime, type ClaudeQuery } from '../src/claude'
import { TODO_TOOLS } from '../src/claude/todo-plan'
import { FakeQuery, init, collect, has, toolOpts, startFake } from './fake-claude-query'

describe('ClaudeRuntime — config-independent prompting (007 P1-6)', () => {
  function captureOptions(): { start: () => Promise<unknown>; get: () => Options } {
    let captured: Options | undefined
    const runtime = new ClaudeRuntime(
      (params) => {
        captured = params.options
        return new FakeQuery()
      },
      async () => true,
    )
    return {
      start: () => runtime.start({ cwd: '/tmp/x', providerHome: '/tmp/x/home' }),
      get: () => {
        if (!captured) throw new Error('query options were not captured')
        return captured
      },
    }
  }

  type PreToolUseGuard = (input: {
    hook_event_name: string
    tool_name: string
    tool_input: unknown
    tool_use_id: string
  }) => Promise<{ continue?: boolean; hookSpecificOutput?: { permissionDecision?: string } }>

  function guardOf(o: Options): PreToolUseGuard {
    const guard = o.hooks?.PreToolUse?.[0]?.hooks?.[0]
    if (!guard) throw new Error('PreToolUse guard not installed')
    return guard as unknown as PreToolUseGuard
  }

  const ask = (tool: string, input: unknown = {}) => ({
    hook_event_name: 'PreToolUse',
    tool_name: tool,
    tool_input: input,
    tool_use_id: 't',
  })

  it('isolates from inherited settings (settingSources:[]) and installs a PreToolUse guard', async () => {
    const cap = captureOptions()
    await cap.start()
    const o = cap.get()
    expect(o.settingSources).toEqual([]) // no user/project/local allow-rule can load
    expect(o.permissionMode).toBe('default')
    expect(o.canUseTool).toBeTypeOf('function')
    expect(o.hooks?.PreToolUse).toBeDefined()
  })

  it('⚑ a launch says the settings it gave Claude Code, read off the very options it was launched with', async () => {
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
      approvalMode: 'auto',
      planMode: true,
    })
    const o = captured
    if (o === undefined) throw new Error('query options were not captured')
    const settings = Object.fromEntries(
      (handle.launchSettings ?? []).map((one) => [one.key, one.value]),
    )
    expect(settings).toEqual({
      'settings-sources': o.settingSources,
      'memory-folder': (o.settings as { autoMemoryDirectory?: string }).autoMemoryDirectory,
      'built-in-tools': o.tools,
      'denied-tools': ['AskUserQuestion'],
      'tools-off': ['AskUserQuestion'],
      mode: 'plan',
      connectors: false,
      attribution: 'provider-default',
      approval: 'auto',
    })
    expect(o.permissionMode).toBe('plan')
    expect(settings['memory-folder']).toBe(join('/tmp/x/home', 'memory'))
  })

  it('the checklist tools raise no card — and the exempt set IS 028’s recognized set (032)', async () => {
    // The acceptance criterion 032 asks to prove, and the reason it is provable at all: the guard
    // does not keep its own copy of these names. It exempts {@link TODO_TOOLS} — the set the
    // checklist adapter recognizes — so a tool cannot be a todo in one file and consequential in
    // the other. Iterating the imported set (rather than a literal list repeated here) is the point:
    // add a name there and this test covers it without being edited, which is what "cannot
    // disagree" has to mean to be worth anything.
    const cap = captureOptions()
    await cap.start()
    const guard = guardOf(cap.get())
    expect(TODO_TOOLS.length).toBeGreaterThan(0) // never vacuously true
    for (const tool of TODO_TOOLS) {
      // Twice, with opposite inputs: a plausible one and a hostile one. The exemption is decided on
      // the NAME alone — `{tool_name, tool_input}` is all the hook receives — and proving that is
      // worth more than picking a schema-shaped input per tool, because it is the property that
      // makes the exemption safe to reason about. A guard that could be talked into yielding by an
      // argument would be a very different thing to audit.
      for (const input of [{ subject: 'S', description: 'd' }, { file_path: '/etc/passwd' }]) {
        expect(await guard(ask(tool, input) as never), `${tool} ${JSON.stringify(input)}`).toEqual({
          continue: true,
        })
      }
    }
  })

  it('pins CLAUDE_CONFIG_DIR to the provider home and hardens the child env', async () => {
    const cap = captureOptions() // starts with providerHome '/tmp/x/home'
    await cap.start()
    const o = cap.get()
    expect(o.env?.['CLAUDE_CONFIG_DIR']).toBe('/tmp/x/home')
    expect(o.env?.['ENABLE_CLAUDEAI_MCP_SERVERS']).toBe('false')
    // Absent, not '0', so auto-memory stays on in the app-owned home whatever the CLI coerces.
    expect('CLAUDE_CODE_DISABLE_AUTO_MEMORY' in (o.env ?? {})).toBe(false)
    // With this set the CLI forces the permission mode to `default`, overriding plan mode.
    expect('CLAUDE_CODE_SUBPROCESS_ENV_SCRUB' in (o.env ?? {})).toBe(false)
    expect(o.strictMcpConfig).toBe(true)
    expect(o.settingSources).toEqual([])
  })

  afterEach(() => vi.unstubAllEnvs())

  async function launchEnvWith(
    inherited: Record<string, string>,
    platform: NodeJS.Platform = process.platform,
  ): Promise<NodeJS.ProcessEnv> {
    for (const [name, value] of Object.entries(inherited)) vi.stubEnv(name, value)
    let captured: Options | undefined
    const runtime = new ClaudeRuntime(
      (params) => {
        captured = params.options
        return new FakeQuery()
      },
      async () => true,
      () => 'made-up-profile-token',
      undefined,
      undefined,
      undefined,
      platform,
    )
    await runtime.start({ cwd: '/tmp/x', providerHome: '/tmp/x/home' })
    return captured?.env ?? {}
  }

  it('inherits the person’s environment, so git, gh and aws work in the agent', async () => {
    const inherited = { GITHUB_TOKEN: 'x', AWS_SECRET_ACCESS_KEY: 'x', SSH_AUTH_SOCK: '/x' }
    expect(await launchEnvWith(inherited)).toMatchObject(inherited)
  })

  it('on Windows the profile’s home and sign-in replace inherited ones spelled in any case', async () => {
    const inherited = { Claude_Code_Oauth_Token: 'x', claude_config_dir: 'x' }
    const env = await launchEnvWith(inherited, 'win32')
    const pattern = /^(claude_code_oauth_token|claude_config_dir)$/i
    const kept = Object.keys(env).filter((name) => pattern.test(name))
    expect(Object.fromEntries(kept.map((name) => [name, env[name]]))).toEqual({
      CLAUDE_CODE_OAUTH_TOKEN: 'made-up-profile-token',
      CLAUDE_CONFIG_DIR: '/tmp/x/home',
    })
  })

  it('concurrent starts with different homes get isolated child env (no cross-talk, global untouched)', async () => {
    const before = process.env['CLAUDE_CONFIG_DIR']
    const captured: Options[] = []
    const runtime = new ClaudeRuntime(
      (params) => {
        captured.push(params.options)
        return new FakeQuery()
      },
      async () => true,
    )
    await Promise.all([
      runtime.start({ cwd: '/tmp/a', providerHome: '/managed/profile-A' }),
      runtime.start({ cwd: '/tmp/b', providerHome: '/managed/profile-B' }),
    ])
    expect(captured.map((o) => o.env?.['CLAUDE_CONFIG_DIR']).sort()).toEqual([
      '/managed/profile-A',
      '/managed/profile-B',
    ])
    expect(process.env['CLAUDE_CONFIG_DIR']).toBe(before) // the global never carried either profile's var
  })
})

describe('ClaudeRuntime — every launch keeps Claude’s own sub-agents (D-014), and turns its question tool off', () => {
  async function capturedOptions(launch: 'start' | 'resume'): Promise<Options> {
    const query = new FakeQuery()
    let captured: Options | undefined
    const runtime = new ClaudeRuntime(
      (params) => {
        captured = params.options
        return query
      },
      async () => true,
    )
    const context = { providerHome: '/tmp/x/home' }
    const handle =
      launch === 'start'
        ? await runtime.start({ cwd: '/tmp/x', ...context })
        : await runtime.resume(
            { provider: 'claude', sessionId: 'sess_d014', cwd: '/tmp/x', rotation: 0 },
            context,
          )
    await handle.close()
    if (!captured) throw new Error('query factory never called')
    return captured
  }

  it('never disallows Agent, Workflow or Task on a fresh or a resumed launch', async () => {
    for (const launch of ['start', 'resume'] as const) {
      const options = await capturedOptions(launch)
      for (const tool of ['Agent', 'Workflow', 'Task']) {
        expect(options.disallowedTools ?? [], `${launch} withholds ${tool}`).not.toContain(tool)
      }
      expect(options.tools, launch).toContain('preset:default')
    }
  })

  it('⛔ turns Claude’s own question tool off on a fresh and a resumed launch, and nothing plan mode needs', async () => {
    for (const launch of ['start', 'resume'] as const) {
      const options = await capturedOptions(launch)
      // ⚑ With no other name to deny, the question tool is the whole list.
      expect(options.disallowedTools, launch).toEqual(['AskUserQuestion'])
      // ⛔ A plan is approved through `ExitPlanMode`, and `EnterPlanMode` asks nobody: both stay.
      for (const tool of ['ExitPlanMode', 'EnterPlanMode']) {
        expect(options.disallowedTools, `${launch} withholds ${tool}`).not.toContain(tool)
      }
    }
  })
})

describe('the effective model comes from the provider (081), the effort from us (024)', () => {
  it('system:init reports the model; asking for no effort reports none', async () => {
    const { handle, events, consumer, fq, sdkOptions } = await startFake()
    expect(handle.agentInfo, 'nothing is claimed before the provider reports').toBeUndefined()

    fq.emit({ ...init('sess_1', '/tmp/x'), model: 'claude-opus-4-8' })
    await vi.waitFor(has(events, (e) => e.type === 'session'))

    expect(handle.agentInfo?.model).toBe('claude-opus-4-8')
    expect(handle.agentInfo?.reasoningEffort, 'never invented').toBeUndefined()
    // Nothing asked for ⇒ nothing set: Claude keeps whatever default it would have used.
    expect(sdkOptions().effort).toBeUndefined()
    fq.end()
    await handle.close()
    await consumer
  })

  it('the requested effort reaches the SDK — 081 said this knob did not exist (024)', async () => {
    // `Options.effort` is real in the pinned 0.3.281 (sdk.d.ts:1855). The comment claiming
    // otherwise is what kept the UI showing a hard-coded `n/a`.
    const { handle, fq, consumer, sdkOptions } = await startFake({ reasoningEffort: 'high' })
    expect(sdkOptions().effort).toBe('high')
    fq.end()
    await handle.close()
    await consumer
  })

  it('…and is reported as REQUESTED, because Claude never echoes it back (024)', async () => {
    // `system:init` carries model/cwd/tools/permissionMode and no effort, so there is nothing to
    // confirm against. The flag is what stops a request being displayed as a provider fact.
    const { handle, events, consumer, fq } = await startFake({ reasoningEffort: 'low' })
    fq.emit({ ...init('sess_1', '/tmp/x'), model: 'claude-opus-4-8' })
    await vi.waitFor(has(events, (e) => e.type === 'session'))

    expect(handle.agentInfo?.reasoningEffort).toBe('low')
    expect(handle.agentInfo?.reasoningEffortReported, 'ours, not the provider’s').toBe(false)
    fq.end()
    await handle.close()
    await consumer
  })
})

describe('the model list, asked of the provider rather than written down (058)', () => {
  // The public supportedModels answer supplies rows and per-row effort facts. This historical
  // fixture includes aliases, punctuation and a row with no advertised efforts.
  const SUPPORTED: ModelInfo[] = [
    {
      value: 'default',
      resolvedModel: 'claude-opus-4-8[1m]',
      displayName: 'Default (recommended)',
      description: 'Use the default model · $5/$25 per Mtok',
      supportsEffort: true,
      supportedEffortLevels: ['low', 'medium', 'high', 'xhigh', 'max'],
    },
    // Keep the bracketed alias intact; the resolved target is not the ID sent to the provider.
    {
      value: 'opus[1m]',
      resolvedModel: 'claude-opus-4-8[1m]',
      displayName: 'Opus',
      description: 'Opus 4.8 with 1M context',
      supportsEffort: true,
      supportedEffortLevels: ['low', 'medium', 'high', 'xhigh', 'max'],
    },
    {
      value: 'sonnet',
      resolvedModel: 'claude-sonnet-5',
      displayName: 'Sonnet',
      description: 'Sonnet 5',
      supportsEffort: true,
      supportedEffortLevels: ['low', 'medium', 'high', 'xhigh', 'max'],
    },
    // No displayName: the label must fall back to the id rather than rendering a blank menu row.
    // ⚠️ And no effort fields either, which is what the real `haiku` row answers (106) — the A to
    // the other three rows' B. Without a row like this in the same fixture, "we pass the provider's
    // narrowing through" and "we invent five levels" produce identical output.
    {
      value: 'haiku',
      resolvedModel: 'claude-haiku-4-5-20251001',
      displayName: '',
      description: '',
    },
  ]

  function probeRuntime(
    query: Partial<ClaudeQuery> & { supportedModels?: () => Promise<unknown> },
  ): {
    runtime: ClaudeRuntime
    built: () => { prompt: AsyncIterable<SDKUserMessage>; options: Options }
    closes: () => number
  } {
    let params: { prompt: AsyncIterable<SDKUserMessage>; options: Options } | undefined
    let closes = 0
    const runtime = new ClaudeRuntime(
      (p) => {
        params = p
        return {
          close: () => void closes++,
          interrupt: async () => undefined,
          ...query,
        } as ClaudeQuery
      },
      async () => true,
    )
    return {
      runtime,
      built: () => {
        if (!params) throw new Error('no query was built')
        return params
      },
      closes: () => closes,
    }
  }

  it('maps a row to the id we SEND and the name we SHOW, and closes the probe', async () => {
    const { runtime, closes } = probeRuntime({ supportedModels: async () => SUPPORTED })
    const models = await runtime.listModels({ providerHome: '/tmp/x/home' })

    // Persist/send the alias and retain its resolved target and provider-supplied efforts.
    const efforts = [
      { id: 'low', label: 'low' },
      { id: 'medium', label: 'medium' },
      { id: 'high', label: 'high' },
      { id: 'xhigh', label: 'xhigh' },
      { id: 'max', label: 'max' },
    ]
    // The native default alias alone is marked; medium is used only where offered.
    expect(models).toEqual([
      {
        id: 'default',
        label: 'Default (recommended)',
        description: 'Use the default model · $5/$25 per Mtok',
        efforts,
        resolvesTo: 'claude-opus-4-8[1m]',
        isDefault: true,
        defaultEffort: 'medium',
      },
      {
        id: 'opus[1m]',
        label: 'Opus',
        description: 'Opus 4.8 with 1M context',
        efforts,
        resolvesTo: 'claude-opus-4-8[1m]',
        defaultEffort: 'medium',
      },
      {
        id: 'sonnet',
        label: 'Sonnet',
        description: 'Sonnet 5',
        efforts,
        resolvesTo: 'claude-sonnet-5',
        defaultEffort: 'medium',
      },
      // Fallen back to the id, and no empty `description` key invented for a row that has none.
      // ⚠️ **And no `efforts` key at all** — not `[]`, which `ModelChoice.efforts` distinguishes:
      // absent is "the provider did not say", and an empty array would be us answering for it.
      // ⚑ D-042: so no `defaultEffort` either — a row that lists no levels is not given one.
      { id: 'haiku', label: 'haiku', resolvesTo: 'claude-haiku-4-5-20251001' },
    ])
    // Count described rows before checking their additional levels, so an empty loop cannot pass.
    const described = models.filter((row) => row.efforts !== undefined)
    expect(described, 'three of the four rows describe their efforts').toHaveLength(3)
    for (const row of described) {
      expect(row.efforts?.map((e) => e.id)).toContain('xhigh')
      expect(row.efforts?.map((e) => e.id)).toContain('max')
    }
    // Claude catalogue rows have no provider-supplied default. Supply `medium` only for rows
    // listing `medium`, never for rows with no levels, so model calls can name an effort.
    // Codex retains its actual default field.
    expect(
      models.filter((row) => row.defaultEffort === 'medium').map((row) => row.id),
      'the three rows that list medium, and only those',
    ).toEqual(['default', 'opus[1m]', 'sonnet'])
    expect(models.find((row) => row.id === 'haiku')).not.toHaveProperty('defaultEffort')
    // ⚑ One default, by name: the `default` row, and no other row is marked.
    expect(models.filter((row) => row.isDefault === true).map((row) => row.id)).toEqual(['default'])
    expect(closes(), 'the probe query must not be left running').toBe(1)
  })

  // A short effort list must remain short; a paired full row catches unconditional truncation.
  it('passes a SHORT effort list through unpadded — the provider narrows, we do not widen', async () => {
    const rows: ModelInfo[] = [
      {
        value: 'thrifty',
        displayName: 'Thrifty',
        description: '',
        supportedEffortLevels: ['low', 'medium'],
      },
      // The A to its B, in the same response: five stays five. Without this row a mapper that
      // truncated everything to two would pass.
      {
        value: 'lavish',
        displayName: 'Lavish',
        description: '',
        supportedEffortLevels: ['low', 'medium', 'high', 'xhigh', 'max'],
      },
    ]
    const { runtime } = probeRuntime({ supportedModels: async () => rows })
    const models = await runtime.listModels({ providerHome: '/tmp/x/home' })

    expect(models[0]?.efforts?.map((e) => e.id)).toEqual(['low', 'medium'])
    expect(
      models[0]?.efforts?.map((e) => e.id),
      'nothing is added back',
    ).not.toContain('xhigh')
    expect(models[1]?.efforts?.map((e) => e.id)).toEqual(['low', 'medium', 'high', 'xhigh', 'max'])
  })

  it('keeps the current Default and Fable catalogue identities and resolutions verbatim', async () => {
    const rows: ModelInfo[] = [
      {
        value: 'default',
        displayName: 'Default (recommended)',
        description: 'Supplied default',
        resolvedModel: 'claude-opus-5-5',
      },
      {
        value: 'fable',
        displayName: 'Fable 5.2',
        description: 'Supplied Fable',
        resolvedModel: 'claude-fable-5-2',
      },
      {
        value: 'older',
        displayName: 'Older available model',
        description: '',
        resolvedModel: 'claude-opus-4-8',
      },
    ]
    const { runtime, closes } = probeRuntime({ supportedModels: async () => rows })
    const models = await runtime.listModels({ providerHome: '/tmp/x/home' })
    expect(models.map(({ id, label, resolvesTo }) => ({ id, label, resolvesTo }))).toEqual(
      rows.map(({ value, displayName, resolvedModel }) => ({
        id: value,
        label: displayName,
        resolvesTo: resolvedModel,
      })),
    )
    expect(models.filter((model) => model.isDefault).map((model) => model.id)).toEqual(['default'])
    expect(closes()).toBe(1)
  })

  /**
   * An EMPTY array is the third shape, and it is not the same as absent.
   *
   * `ModelChoice.efforts` says *"Empty or absent means the provider did not say"*, and the surface
   * treats them alike — but `[]` reaching the renderer would make `modelChoices`' own "an empty
   * `<datalist>` reads as a broken control" problem appear one control along. Omitting the key is
   * the shape the rest of the mapper already uses for "there was nothing to say".
   */
  it('a row that answers with an EMPTY effort list gets no key, like one that answers with none', async () => {
    const rows: ModelInfo[] = [
      {
        value: 'quiet',
        displayName: 'Quiet',
        description: '',
        supportsEffort: true,
        supportedEffortLevels: [],
      },
      { value: 'silent', displayName: 'Silent', description: '' },
      { value: 'loud', displayName: 'Loud', description: '', supportedEffortLevels: ['high'] },
    ]
    const { runtime } = probeRuntime({ supportedModels: async () => rows })
    const models = await runtime.listModels({ providerHome: '/tmp/x/home' })

    expect(models[0]).not.toHaveProperty('efforts')
    expect(models[1]).not.toHaveProperty('efforts')
    // The positive that stops both assertions above passing over a mapper that dropped the field
    // entirely.
    expect(models[2]?.efforts).toEqual([{ id: 'high', label: 'high' }])
  })

  it('never sends a message — asking what models exist must not start a conversation', async () => {
    // The mechanism, asserted rather than described. `supportedModels` is a method on the QUERY, so
    // there has to be one; the prompt it is given is an iterable that parks forever, which
    // initializes the CLI without producing a user message. If that ever became a real prompt, this
    // probe would silently cost a turn every time the launcher opened.
    const { runtime, built } = probeRuntime({ supportedModels: async () => [] })
    await runtime.listModels({ providerHome: '/tmp/x/home' })

    const raced = await Promise.race([
      (async () => {
        for await (const message of built().prompt) return message
        return 'ended'
      })(),
      new Promise((resolve) => setTimeout(() => resolve('never yielded'), 25)),
    ])
    expect(raced).toBe('never yielded')
  })

  it('runs in the profile HOME, because a model list is what THIS login may run', async () => {
    const { runtime, built } = probeRuntime({ supportedModels: async () => [] })
    await runtime.listModels({ providerHome: '/tmp/x/home' })
    expect(built().options.env?.CLAUDE_CONFIG_DIR).toBe('/tmp/x/home')
    // Asking from anywhere else would answer about a different account. Same isolation a launch
    // gets — this is not a lighter-weight env, which is why it moves with the launch (165 removed
    // the auto-memory flag from both at once, and this line is what would catch the two drifting).
    expect('CLAUDE_CODE_DISABLE_AUTO_MEMORY' in (built().options.env ?? {})).toBe(false)
    expect(built().options.env?.ENABLE_CLAUDEAI_MCP_SERVERS).toBe('false')
    expect(built().options.strictMcpConfig).toBe(true)
    // …and 166's flag settings for the same reason: the CLI resolves the memory directory at
    // startup whether or not a turn follows, so a probe that pointed somewhere else would be a
    // second answer to "where does this profile remember things". ONE derivation, both launches.
    expect(built().options.settings).toEqual({ autoMemoryDirectory: join('/tmp/x/home', 'memory') })
  })

  it('gives up on a CLI that is alive but silent, instead of never settling', async () => {
    // ⚠️ 058's review found the worst bug in this task here. `supportedModels()` was awaited with no
    // bound, and a subprocess that is alive but stalled neither resolves nor rejects — so the
    // `finally` that closes the child was unreachable, the child outlived the app, and the promise
    // never settled at all. The host CACHES this probe, so one stuck child left every future caller
    // awaiting a promise that could not resolve: no menu, no error, no log, no recovery short of a
    // restart. A hang is strictly worse than a failure, because a failure is a state the layer above
    // already knows how to handle.
    let closed = 0
    const runtime = new ClaudeRuntime(
      () =>
        ({
          close: () => void closed++,
          interrupt: async () => undefined,
          supportedModels: () => new Promise<never>(() => {}), // alive, and never answering
        }) as unknown as ClaudeQuery,
      async () => true,
    )

    vi.useFakeTimers()
    try {
      const probing = runtime.listModels({ providerHome: '/tmp/x/home' })
      const settled = expect(probing).rejects.toThrow(/did not answer/)
      await vi.advanceTimersByTimeAsync(20_000)
      await settled
    } finally {
      vi.useRealTimers()
    }
    // …and the child is released. The deadline frees the AWAITER; only this frees the process, so
    // a bound without a reachable `finally` would have swapped a hang for a leak.
    expect(closed, 'the stalled CLI must still be closed').toBe(1)
  })

  it('🔒 refuses an EMPTY home rather than falling back to the personal ~/.claude', async () => {
    // The additions are layered verbatim onto the child env, so an empty `providerHome` would send
    // `CLAUDE_CONFIG_DIR=''` — read as unset, which lands the child in the user's real `~/.claude`.
    // That is the one failure this codebase can least afford to make quietly, and 058 added a
    // second caller of the helper that builds it. Asserted for BOTH callers, because the guard is
    // only worth having if it covers the path that existed before as well as the one just added.
    const probe = probeRuntime({ supportedModels: async () => [] })
    await expect(probe.runtime.listModels({ providerHome: '' })).rejects.toThrow(/~\/\.claude/)

    const launch = probeRuntime({ supportedModels: async () => [] })
    await expect(launch.runtime.start({ cwd: '/tmp/x', providerHome: '' })).rejects.toThrow(
      /~\/\.claude/,
    )
  })

  it('fails rather than inventing a list when the provider cannot answer', async () => {
    // The honest failure, both ways round: a query with no such method, and one that rejects. The
    // caller turns either into "no menu, keep the text box" — never into a list this app wrote.
    const missing = probeRuntime({})
    await expect(missing.runtime.listModels({ providerHome: '/tmp/x/home' })).rejects.toThrow(
      /supportedModels/,
    )
    expect(missing.closes(), 'a failed probe still closes its query').toBe(1)

    const broken = probeRuntime({
      supportedModels: async () => {
        throw new Error('not logged in')
      },
    })
    await expect(broken.runtime.listModels({ providerHome: '/tmp/x/home' })).rejects.toThrow(
      /not logged in/,
    )
    expect(broken.closes()).toBe(1)
  })
})

/**
 * **069 A1's geometry, on disk** (071) — and, since `726` · R92, what it no longer triggers.
 *
 * Everything here is built on disk under a temp `userData` laid out exactly as the app lays it out,
 * because the finding was about geometry — *"a default cwd that is a sibling of the credential
 * store"* — and a test with invented paths would be testing a string comparison instead.
 *
 * ⚠️ **No credential is anywhere near this file.** The `auth.json` fixtures hold a marker string,
 * and every assertion is about what the guard hook ANSWERS — refuse, card or yield — never about
 * reading a file, which would require the real one.
 */
describe('the adapter’s own allowances — and, since 726, no folder guard (071, R92)', () => {
  let userData: string
  let workspace: string
  let claudeHome: string
  let codexAuth: string

  beforeEach(() => {
    // Resolved, because macOS hides `tmpdir()` behind `/var` → `/private/var`.
    userData = realpathSync(mkdtempSync(join(tmpdir(), 'brobot2-a1-')))
    workspace = join(userData, 'brobot-workspace')
    claudeHome = join(userData, 'provider-homes', 'default', 'default', 'claude')
    const codexHome = join(userData, 'provider-homes', 'default', 'default', 'codex')
    for (const dir of [workspace, claudeHome, codexHome]) mkdirSync(dir, { recursive: true })
    codexAuth = join(codexHome, 'auth.json')
    writeFileSync(codexAuth, '{"marker":"a fixture, never a credential"}')
  })

  afterEach(() => {
    rmSync(userData, { recursive: true, force: true })
  })

  /** A real session on the real geometry: the default cwd inside the app's own data. */
  async function session(approvalMode?: 'ask' | 'auto'): Promise<{
    options: Options
    events: RuntimeEvent[]
    consumer: Promise<void>
    fq: FakeQuery
    handle: Awaited<ReturnType<ClaudeRuntime['start']>>
  }> {
    const fq = new FakeQuery()
    let options: Options | undefined
    const runtime = new ClaudeRuntime(
      (params) => {
        options = params.options
        return fq
      },
      async () => true,
    )
    const handle = await runtime.start({
      cwd: workspace,
      providerHome: claudeHome,
      ...(approvalMode ? { approvalMode } : {}),
    })
    const events: RuntimeEvent[] = []
    const consumer = collect(handle, events)
    if (!options) throw new Error('the query was never built')
    return { options, events, consumer, fq, handle }
  }

  const guard = (options: Options) => {
    const hook = options.hooks?.PreToolUse?.[0]?.hooks?.[0]
    if (!hook) throw new Error('PreToolUse guard not installed')
    return (tool: string, input: unknown) =>
      hook(
        {
          hook_event_name: 'PreToolUse',
          tool_name: tool,
          tool_input: input,
          tool_use_id: 't',
        } as never,
        't',
        { signal: new AbortController().signal },
      ) as Promise<{
        continue?: boolean
        hookSpecificOutput?: { permissionDecision?: string; permissionDecisionReason?: string }
      }>
  }

  /**
   * Calls with app-data paths, an unknown tool, a dangling link, or oversized input meet only
   * the provider’s permission mode. BroBot adds no folder restriction or `protectedRoots`
   * scan above that mode check.
   */
  it('🔴 726 · R92 — in `auto`, a tool call naming the app’s own data is not refused: it yields, as the CLI would run it', async () => {
    const { options, consumer, fq, handle } = await session('auto')
    const bait = join(workspace, 'bait')
    symlinkSync(join(userData, 'not-created-yet', 'x'), bait)
    for (const [tool, input] of [
      ['Read', { file_path: '../provider-homes/default/default/codex/auth.json' }],
      ['Read', { file_path: codexAuth }],
      ['Glob', { pattern: `${userData}/provider-homes/**/auth.json` }],
      ['Grep', { pattern: 'marker', path: '../provider-homes' }],
      ['mcp__fs__read_file', { file: codexAuth }],
      ['Write', { file_path: bait, content: 'x' }],
      ['mcp__fs__bulk', { items: Array.from({ length: 600 }, (_, i) => `s${i}`) }],
    ] as const) {
      expect(await guard(options)(tool, input), tool).toEqual({ continue: true })
    }
    // ⚑ …and the second door answers as the mode does — `allow` — with no deny of ours first.
    await expect(
      options.canUseTool?.('Read', { file_path: codexAuth }, toolOpts('tu_r92') as never),
    ).resolves.toMatchObject({ behavior: 'allow' })
    await handle.close()
    fq.end()
    await consumer
  })

  it('🔴 726 · R92 — in `ask`, a read anywhere is the provider’s own to ask about; and since 728 (R93) so is every other call', async () => {
    const { options, consumer, fq, handle } = await session('ask')
    // ⚑ A read — of the app's own data, or outside the workspace — is not ours to refuse or to card:
    // the CLI asks about a read outside its cwd itself (`721`'s probe, arms B/F/G/H).
    expect(await guard(options)('Read', { file_path: codexAuth })).toEqual({ continue: true })
    expect(await guard(options)('Grep', { pattern: 'x', path: '/etc' })).toEqual({ continue: true })
    // 🔴 **728 · R93 — and no card of this hook's own for a consequential call either.** Until
    // `728` these three were forced to `ask` here; the CLI's own engine now decides (measured: it
    // asks before a `Write`, an `rm` and an MCP tool), so the hook has no opinion on any of them.
    for (const [tool, input] of [
      ['Bash', { command: `cat ${codexAuth}` }],
      ['mcp__fs__read_file', { file: codexAuth }],
      ['Write', { file_path: join(workspace, 'out.txt'), content: 'x' }],
    ] as const) {
      expect(await guard(options)(tool, input), tool).toEqual({ continue: true })
    }
    await handle.close()
    fq.end()
    await consumer
  })

  it('…and yolo still runs everything else unattended, which is the hazard 056 named', async () => {
    // Until `726` a check sat ABOVE the mode check, so the thing to prove was that it did not
    // become a card in a session that was promised there would be none. 063's routing is intact:
    // an ordinary tool in a launched-auto session yields, whatever it names, including inside the
    // workspace.
    const { options, events, consumer, fq, handle } = await session('auto')
    for (const [tool, input] of [
      ['Bash', { command: 'rm -rf build' }],
      ['Write', { file_path: join(workspace, 'out.txt') }],
      ['Write', { file_path: '/tmp/elsewhere.txt' }],
      ['Read', { file_path: '/etc/hosts' }],
      ['SomeUnknownMcpTool', {}],
    ] as const) {
      expect(await guard(options)(tool, input), tool).toEqual({ continue: true })
    }
    expect(events.filter((e) => e.type === 'permission_request')).toHaveLength(0)
    await handle.close()
    fq.end()
    await consumer
  })

  it('a session keeps its own home — which is where plan documents are written', async () => {
    // Five `Write` calls to `<providerHome>/claude/plans/*.md` in this app's own ledger — and they
    // are the only tool calls in it that land inside the provider homes at all. A confinement that
    // took the session's own home would have broken plan mode (071; since `726` there is none).
    const { options, consumer, fq, handle } = await session()
    const said = await guard(options)('Write', { file_path: join(claudeHome, 'plans', 'p.md') })
    // ⚑ Not refused — and since `728` the hook has no opinion: the CLI asks, as for any Write.
    expect(said).toEqual({ continue: true })
    await handle.close()
    fq.end()
    await consumer
  })

  it('ordinary work in the workspace is untouched: a read there still raises no card', async () => {
    const { options, consumer, fq, handle } = await session()
    writeFileSync(join(workspace, 'notes.md'), 'x')
    for (const input of [{ file_path: join(workspace, 'notes.md') }, { file_path: 'notes.md' }]) {
      expect(await guard(options)('Read', input)).toEqual({ continue: true })
    }
    await handle.close()
    fq.end()
    await consumer
  })

  /* ------------------------------------ 166 §2 · the agent's own memory raises no card */

  /**
   * 🔴 **The profile's memory directory** (166 §2). ⚑ **728 · R93 — its carve-out is gone**: the
   * hook no longer allows a write there on its own account, nor bounds one — measured, the CLI's
   * own engine writes a profile's memory without asking (`probe:tool-calls-as-the-cli`, `memory`),
   * so the provider decides, as it does every other call. What stays here is what is not that gate.
   */
  const memoryDir = (): string => join(claudeHome, 'memory')

  it('⛔ a symlink out of the memory directory gets no allow of this app’s — since 728 no write does', async () => {
    const { options, consumer, fq, handle } = await session()
    mkdirSync(memoryDir(), { recursive: true })
    symlinkSync(
      join(userData, 'provider-homes', 'default', 'default', 'codex'),
      join(memoryDir(), 'out'),
    )
    // Lexically inside; really somewhere else. ⚑ The property this test is for — no cardless write
    // on THIS app's account — is unchanged; what changed is how: until `726` a scan refused it, until
    // `728` the memory allowance declined to follow the link and the hook forced a card. ⚑ **728 ·
    // R93 removed both the allowance and the forced card**: the hook has no opinion, and the CLI's
    // own engine decides, as it does in the CLI.
    const said = await guard(options)('Write', {
      file_path: join(memoryDir(), 'out', 'auth.json'),
      content: 'x',
    })
    expect(said.hookSpecificOutput?.permissionDecision).not.toBe('allow')
    expect(said).toEqual({ continue: true })
    await handle.close()
    fq.end()
    await consumer
  })

  it('⚠️ …and a question is still routed to the user, even from inside the memory directory', async () => {
    // 063's exception is above everything, including this one: "the user must be asked" is not a
    // permission question, so no path can exempt it.
    const { options, consumer, fq, handle } = await session()
    const said = await guard(options)('AskUserQuestion', {
      file_path: join(memoryDir(), 'MEMORY.md'),
    })
    expect(said.hookSpecificOutput?.permissionDecision).toBe('ask')
    expect(said.hookSpecificOutput?.permissionDecisionReason).toContain('routes questions')
    await handle.close()
    fq.end()
    await consumer
  })
})
