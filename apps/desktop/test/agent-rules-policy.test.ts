import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  FakeRuntime,
  FakeProviderSessions,
  type AgentToolset,
  type StartOptions,
  type ResumeOptions,
  type SessionRef,
} from '@brobot2/runtime'
import type { Provider } from '@brobot2/shared'
import { openDatabase, type AppDatabase } from '../src/main/db/connection'
import { applyMigrations } from '../src/main/db/migrate'
import { createSessionStore, type SessionStore } from '../src/main/db/session-store'
import { NO_DISCOVERY } from '../src/main/adopt/discover-sessions'
import { agentCallerId } from '../src/main/runtime/agent-tools'
import { executeRuntimeCommand } from '../src/main/runtime/ipc'
import { RuntimeHost, type Caller, type RuntimeEventSink } from '../src/main/runtime/runtime-host'
import { resolveSessionCwd } from '../src/main/runtime/scratch-cwd'
import { DEFAULT_PROFILE_ID, type RuntimeEventMessage } from '../src/shared/runtime-ipc'
import type { AgentInstructionsReading } from '../src/shared/own-instructions'

const migrations = join(dirname(fileURLToPath(import.meta.url)), '../src/main/db/migrations')

// A local expected contract lets this fixture compile before the host methods are added.
type Baseline = { readonly expectedVersion: number; readonly currentText: string }
type PolicyHost = {
  proposeAgentRules(
    me: string,
    said: {
      about: string
      text: string
      why: string
      relaying: boolean
      expectedVersion: number
    },
    by: Caller,
  ): { ok: true; askId: string } | { ok: false }
  readAgentRules(me: string, profile: string, by: Caller): { ok: boolean }
  writeAgentRules(
    me: string,
    said: Baseline & {
      about: string
      text: string
      why: string
    },
    by: Caller,
  ): { ok: boolean }
  undoAgentRules(
    profile: string,
    expectedVersion: number,
    by: Caller,
  ): AgentInstructionsReading | null
  markAgentRulesSeen(profile: string, throughVersion: number, by: Caller): boolean
  instructAgent(
    profile: string,
    text: string,
    broughtBack: number | undefined,
    by: Caller,
    baseline?: Baseline,
  ): AgentInstructionsReading | null
}
type PolicyCommand =
  | { kind: 'agentRulesUnread'; profileId: string }
  | { kind: 'undoAgentRules'; profileId: string; expectedVersion: number }
  | { kind: 'markAgentRulesSeen'; profileId: string; throughVersion: number }

class Window implements RuntimeEventSink {
  readonly aPersonIsBehindIt = true
  readonly ownerId = 'webContents:1'
  readonly messages: RuntimeEventMessage[] = []
  readonly alive = true
  send(message: RuntimeEventMessage): void {
    this.messages.push(message)
  }
  sendLiveness(): void {}
}

class ToolRuntime extends FakeRuntime {
  constructor(
    provider: Provider,
    private readonly handed: AgentToolset[],
    sessions: FakeProviderSessions,
  ) {
    super(provider, { sessions })
  }
  override async start(options: StartOptions): ReturnType<FakeRuntime['start']> {
    const handle = await super.start(options)
    if (options.agentTools !== undefined) this.handed.push(options.agentTools)
    return handle
  }
  override async resume(
    ref: SessionRef,
    options: ResumeOptions,
  ): ReturnType<FakeRuntime['resume']> {
    const handle = await super.resume(ref, options)
    if (options.agentTools !== undefined) this.handed.push(options.agentTools)
    return handle
  }
}

describe('standing-rule authority belongs to the host and changes remain attributable', () => {
  let root: string
  let work: string
  let db: AppDatabase
  let store: SessionStore
  let host: RuntimeHost
  let window: Window
  let handed: AgentToolset[]
  let providerSessions: FakeProviderSessions
  let tools: Map<string, AgentToolset>
  let clock: number
  let sequence: number
  const tick = (): number => clock++
  const caller = (id: string) => ({ ownerId: agentCallerId(id) })
  const policy = (): PolicyHost => host as unknown as PolicyHost
  const command = (sink: RuntimeEventSink, said: PolicyCommand) =>
    executeRuntimeCommand(
      host,
      sink,
      said as unknown as Parameters<typeof executeRuntimeCommand>[2],
    )

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'rules-policy-'))
    work = mkdtempSync(join(tmpdir(), 'rules-policy-work-'))
    db = openDatabase(join(root, 'app.sqlite'))
    applyMigrations(db, migrations)
    clock = 1000
    sequence = 0
    handed = []
    providerSessions = new FakeProviderSessions()
    tools = new Map()
    store = createSessionStore(db, tick)
    const home = (provider: Provider, profile?: string | null) =>
      join(root, 'homes', profile ?? 'default', provider)
    host = new RuntimeHost({
      store,
      discoverSessions: NO_DISCOVERY,
      nativeTranscriptPath: () => null,
      exportDirectory: () => join(root, 'exports'),
      createRuntime: (provider) => new ToolRuntime(provider, handed, providerSessions),
      prepareProviderHome: (provider, profile) => {
        const path = home(provider, profile)
        mkdirSync(path, { recursive: true })
        return path
      },
      providerHomePath: home,
      resolveCwd: (id, requested) => resolveSessionCwd(root, id, requested),
      newSessionId: () => `session-${++sequence}`,
      now: tick,
      readProviderConfig: (_provider, path) => ({
        home: path,
        homeEnv: 'CODEX_HOME',
        model: 'm',
        authNote: null,
        files: [],
      }),
    })
    window = new Window()
  })

  afterEach(async () => {
    await host.closeAll()
    db.close()
    rmSync(root, { recursive: true, force: true })
    rmSync(work, { recursive: true, force: true })
  })

  const start = async (profile: string, provider: Provider = 'codex'): Promise<string> => {
    const created = await host.createSession(
      { provider, profileId: profile, cwd: work, approvalMode: 'ask' },
      window,
    )
    const toolset = handed.at(-1)
    if (toolset === undefined) throw new Error('no tools handed to the runtime')
    tools.set(created.sessionId, toolset)
    return created.sessionId
  }
  const propose = (me: string, text = 'Proposed rules', expectedVersion = 0) =>
    policy().proposeAgentRules(
      me,
      { about: 'lark', text, why: 'Keep changes reviewable', relaying: false, expectedVersion },
      caller(me),
    )
  const replace = (me: string, extra = {}) =>
    policy().writeAgentRules(
      me,
      {
        about: 'lark',
        text: 'New rules',
        why: 'Clarify the work',
        expectedVersion: 0,
        currentText: '',
        ...extra,
      },
      caller(me),
    )
  const call = async (me: string, name: string, args: Record<string, unknown>) => {
    const tool = tools.get(me)?.tools.find((one) => one.name === name)
    expect(tool, `registered tool ${name}`).toBeDefined()
    if (tool === undefined) throw new Error('unreachable missing tool')
    return (await tool.call(args)).structured as Record<string, unknown>
  }

  it.each(['claude', 'codex'] as const)(
    'offers the direct rules tool only to a person-started primary conversation on %s',
    async (provider) => {
      await start('lark', provider)
      const primary = await start(DEFAULT_PROFILE_ID, provider)
      const primaryNames = tools.get(primary)!.tools.map((one) => one.name)
      expect(primaryNames).toContain('write_agent_rules')
      expect(primaryNames).toContain('read_agent_rules')
      expect(primaryNames).toContain('propose_agent_rules')
      const ordinary = await start('wren', provider)
      const ordinaryNames = tools.get(ordinary)!.tools.map((one) => one.name)
      expect(ordinaryNames).not.toContain('write_agent_rules')
      expect(ordinaryNames).toEqual(primaryNames.filter((name) => name !== 'write_agent_rules'))
      expect(replace(ordinary)).toMatchObject({ ok: false, rail: 'may-not-write-rules' })
      expect(replace(primary, { about: DEFAULT_PROFILE_ID })).toMatchObject({
        ok: false,
        rail: 'may-not-write-rules',
      })
      expect(store.ownInstructionsOf('lark').versions).toEqual([])
    },
  )

  it.each(['claude', 'codex'] as const)(
    'keeps the same eligible tool list when a person reopens a conversation on %s',
    async (provider) => {
      for (const profile of [DEFAULT_PROFILE_ID, 'wren']) {
        const me = await start(profile, provider)
        const before = tools.get(me)!.tools.map((one) => one.name)
        expect(before.includes('write_agent_rules')).toBe(profile === DEFAULT_PROFILE_ID)
        await host.close(me, window)
        const count = handed.length
        await host.resumeSession(me, window)
        expect(handed).toHaveLength(count + 1)
        const after = handed.at(-1)!.tools.map((one) => one.name)
        expect(after).toEqual(before)
      }
    },
  )

  it.each(['none', 'propose', 'relay'] as const)(
    'lets a known agent propose under dormant grant %s without allowing direct writes',
    async (grant) => {
      await start('lark')
      const me = await start('wren')
      expect(store.setCapabilities('wren', { canWriteRules: grant })).toBe(true)
      expect(propose(me).ok).toBe(true)
      expect(replace(me).ok).toBe(false)
      expect(store.ownInstructionsOf('lark').versions).toEqual([])
      expect(store.instructionAsksWaiting()).toHaveLength(1)
    },
  )

  it('does not trust a supplied session or a matching display name as authority', async () => {
    await start('lark')
    const ordinary = await start('wren')
    const primary = await start(DEFAULT_PROFILE_ID)
    store.setAgentDisplayName('wren', 'Primary')
    store.setAgentDisplayName(DEFAULT_PROFILE_ID, 'Primary')
    expect(replace(ordinary).ok).toBe(false)
    expect(
      policy().writeAgentRules(
        primary,
        {
          about: 'lark',
          text: 'Forged caller',
          why: 'Pretend',
          expectedVersion: 0,
          currentText: '',
        },
        caller(ordinary),
      ).ok,
    ).toBe(false)
    expect(policy().readAgentRules(primary, 'lark', window).ok).toBe(false)
    expect(policy().readAgentRules('absent', 'lark', caller('absent')).ok).toBe(false)
    expect(replace(primary, { about: DEFAULT_PROFILE_ID }).ok).toBe(false)
    expect(store.ownInstructionsOf('lark').versions).toEqual([])
  })

  it('refuses direct writing by a helper on the primary profile while preserving its read and proposal path', async () => {
    await start('lark')
    const giver = await start('wren')
    const primary = await start(DEFAULT_PROFILE_ID)
    const given = await host.giveWork(
      {
        profile: DEFAULT_PROFILE_ID,
        title: 'Review a change',
        brief: 'Propose a standing-rule change.',
        definition_of_done: 'A proposed change is recorded.',
        folder: work,
      },
      caller(giver),
    )
    if (!given.ok) throw new Error(`give refused: ${given.refusal.rail}`)
    const helper = given.owner
    expect(helper).not.toBe(primary)
    await vi.waitFor(() =>
      expect(policy().readAgentRules(helper, 'lark', caller(helper)).ok).toBe(true),
    )
    expect(store.parentOf(helper)).toBe(giver)
    const helperNames = handed.at(-1)!.tools.map((one) => one.name)
    expect(helperNames).not.toContain('write_agent_rules')
    expect(helperNames).toContain('read_agent_rules')
    expect(helperNames).toContain('propose_agent_rules')
    expect(replace(helper).ok).toBe(false)
    host.claimSession(helper, window)
    expect(replace(helper).ok).toBe(false)
    await host.close(helper, window)
    const count = handed.length
    await host.resumeSession(helper, window)
    expect(handed).toHaveLength(count + 1)
    expect(handed.at(-1)!.tools.map((one) => one.name)).toEqual(helperNames)
    expect(replace(helper).ok).toBe(false)
    expect(propose(helper).ok).toBe(true)
    expect(store.ownInstructionsOf('lark').versions).toEqual([])
    expect(replace(primary)).toMatchObject({ ok: true, result: { conversation: primary } })
  })

  it('refuses the old shortcut and exposes the bound direct-write door with the book', async () => {
    await start('lark')
    const me = await start(DEFAULT_PROFILE_ID)
    const current = await call(me, 'read_agent_rules', { agent: 'lark' })
    expect(current).toMatchObject({ outcome: 'ok', profile: 'lark', version: 0, text: '' })
    expect(
      await call(me, 'propose_agent_rules', {
        agent: 'lark',
        rules: 'Proposal',
        why: 'Explain',
        current_version: 0,
        already_agreed: true,
      }),
    ).toMatchObject({ outcome: 'refused', rail: 'malformed-request' })
    expect(
      await call(me, 'propose_agent_rules', {
        agent: 'lark',
        rules: 'Proposal',
        why: 'Explain',
        current_version: 0,
      }),
    ).toMatchObject({ outcome: 'ok', wrote: 'a-request' })
    expect(tools.get(me)?.tools.some((one) => one.name === 'write_agent_rules')).toBe(true)
    expect(store.ownInstructionsOf('lark').versions).toEqual([])
  })

  it('keeps the original proposer name separately from the approver after rename and restart', async () => {
    await start('lark')
    const me = await start('wren')
    store.setAgentDisplayName('wren', 'Wren')
    const asked = propose(me)
    if (!asked.ok) throw new Error('proposal refused')
    store.setAgentDisplayName('wren', 'Finch')
    await host.closeAll()
    const outcome = host.decideInstruction(asked.askId, true, window)
    expect(outcome).toEqual({ outcome: 'taken' })
    store = createSessionStore(db, tick)
    expect(store.ownInstructionsOf('lark').versions[0]).toMatchObject({
      author: { profile: 'wren', name: 'Wren' },
      by: { who: 'a-person' },
      whoWroteIt: 'an-agents-proposal',
    })
  })

  it('refuses a stale proposal and does not approve one over a later person edit', async () => {
    await start('lark')
    const me = await start('wren')
    const asked = propose(me)
    if (!asked.ok) throw new Error('proposal refused')
    policy().instructAgent('lark', 'The person saved this', undefined, window)
    expect(propose(me, 'Stale', 0).ok).toBe(false)
    expect(host.decideInstruction(asked.askId, true, window).outcome).toBe('refused')
    expect(store.ownInstructionsOf('lark').versions[0]?.text).toBe('The person saved this')
  })

  it('validates the exact person baseline and records replacement, unread state and a compact receipt', async () => {
    await start('lark')
    const me = await start(DEFAULT_PROFILE_ID)
    policy().instructAgent('lark', 'Person rules', undefined, window)
    expect(replace(me).ok).toBe(false)
    expect(replace(me, { expectedVersion: 1, currentText: 'Wrong' }).ok).toBe(false)
    const written = replace(me, { expectedVersion: 1, currentText: 'Person rules' })
    expect(written).toMatchObject({
      ok: true,
      result: { version: 2, previousVersion: 1, replacedPersonVersion: 1 },
    })
    const latest = store.ownInstructionsOf('lark').versions[0]
    expect(latest).toMatchObject({
      whoWroteIt: 'an-agent-direct',
      author: { profile: DEFAULT_PROFILE_ID },
      said: 'Clarify the work',
    })
    expect(store.instructionUnread('lark').unread).toBe(true)
    const receipt = window.messages
      .map((one) => one.event)
      .find((one) => (one as { type: string }).type === 'instruction_changed')
    expect(receipt).toMatchObject({ type: 'instruction_changed', profile: 'lark', version: 2 })
    expect(receipt).not.toHaveProperty('text')
    const reader = await start('wren')
    expect(policy().readAgentRules(reader, 'lark', caller(reader))).toMatchObject({
      ok: true,
      result: {
        version: 2,
        text: 'New rules',
        reason: 'Clarify the work',
        author: { profile: DEFAULT_PROFILE_ID },
      },
    })
  })

  it('identifies a person-approved proposal when the direct tool replaces it', async () => {
    await start('lark')
    const proposer = await start('wren')
    const asked = propose(proposer, 'Approved proposal')
    if (!asked.ok) throw new Error('proposal refused')
    expect(host.decideInstruction(asked.askId, true, window)).toEqual({ outcome: 'taken' })
    const me = await start(DEFAULT_PROFILE_ID)
    const written = await call(me, 'write_agent_rules', {
      agent: 'lark',
      current_version: 1,
      current_rules: 'Approved proposal',
      rules: 'Revised checklist',
      why: 'Clarify the sequence',
    })
    expect(written).toMatchObject({
      outcome: 'ok',
      previousVersion: 1,
      version: 2,
      replacedPersonVersion: 1,
    })
    expect(store.ownInstructionsOf('lark').versions[1]).toMatchObject({
      whoWroteIt: 'an-agents-proposal',
      by: { who: 'a-person' },
      text: 'Approved proposal',
    })
  })

  it('binds a real direct tool write to the running author and returns metadata only', async () => {
    await start('lark')
    const me = await start(DEFAULT_PROFILE_ID)
    store.setAgentDisplayName(DEFAULT_PROFILE_ID, 'Coordinator')
    const written = await call(me, 'write_agent_rules', {
      agent: 'lark',
      current_version: 0,
      current_rules: '',
      rules: 'Read the checklist first.',
      why: 'Keep the work reviewable.',
    })
    expect(written).toMatchObject({
      outcome: 'ok',
      profile: 'lark',
      conversation: me,
      previousVersion: 0,
      version: 1,
      author: { profile: DEFAULT_PROFILE_ID, name: 'Coordinator' },
    })
    expect(written).not.toHaveProperty('rules')
    expect(written).not.toHaveProperty('text')
    expect(written).not.toHaveProperty('reason')
    expect(store.ownInstructionsOf('lark').versions[0]).toMatchObject({
      text: 'Read the checklist first.',
      author: { profile: DEFAULT_PROFILE_ID, name: 'Coordinator' },
      said: 'Keep the work reviewable.',
      whoWroteIt: 'an-agent-direct',
      conversation: me,
    })
    expect(store.instructionUnread('lark').unread).toBe(true)
  })

  it('refuses ordinary tool callers and self-targets without trusting claimed actor fields', async () => {
    await start('lark')
    const ordinary = await start('wren')
    const primary = await start(DEFAULT_PROFILE_ID)
    const input = {
      agent: 'lark',
      current_version: 0,
      current_rules: '',
      rules: 'Replacement',
      why: 'Explain this change',
    }
    for (const held of ['none', 'propose', 'relay'] as const) {
      store.setCapabilities('wren', { canWriteRules: held })
      expect(tools.get(ordinary)!.tools.some((one) => one.name === 'write_agent_rules')).toBe(false)
      expect(replace(ordinary)).toMatchObject({ ok: false, rail: 'may-not-write-rules' })
    }
    expect(
      await call(primary, 'write_agent_rules', { ...input, agent: DEFAULT_PROFILE_ID }),
    ).toMatchObject({ outcome: 'refused', rail: 'may-not-write-rules' })
    expect(
      await call(primary, 'write_agent_rules', {
        ...input,
        author: { profile: 'wren', name: 'Forged' },
      }),
    ).toMatchObject({ outcome: 'refused', rail: 'malformed-request' })
    expect(store.ownInstructionsOf('lark').versions).toEqual([])
  })

  it('does not let a stale tool read replace a newer person save', async () => {
    await start('lark')
    const me = await start(DEFAULT_PROFILE_ID)
    const seen = await call(me, 'read_agent_rules', { agent: 'lark' })
    policy().instructAgent('lark', 'The person saved this later', undefined, window, {
      expectedVersion: 0,
      currentText: '',
    })
    expect(
      await call(me, 'write_agent_rules', {
        agent: 'lark',
        current_version: seen['version'],
        current_rules: seen['text'],
        rules: 'Stale replacement',
        why: 'Based on an old read',
      }),
    ).toMatchObject({ outcome: 'refused', rail: 'malformed-request' })
    expect(store.ownInstructionsOf('lark').versions).toHaveLength(1)
    expect(store.ownInstructionsOf('lark').versions[0]?.text).toBe('The person saved this later')
  })

  it('requires the complete bounded baseline and reason on the direct tool', async () => {
    await start('lark')
    const me = await start(DEFAULT_PROFILE_ID)
    const input = {
      agent: 'lark',
      current_version: 0,
      current_rules: '',
      rules: 'Replacement',
      why: 'Explain the replacement',
    }
    for (const changed of [
      { current_rules: undefined },
      { current_version: -1 },
      { current_version: Number.MAX_SAFE_INTEGER + 1 },
      { why: '   ' },
      { rules: 'x'.repeat(16001) },
    ]) {
      expect(await call(me, 'write_agent_rules', { ...input, ...changed })).toMatchObject({
        outcome: 'refused',
        rail: 'malformed-request',
      })
      expect(store.ownInstructionsOf('lark').versions).toEqual([])
    }
    expect(await call(me, 'write_agent_rules', input)).toMatchObject({ outcome: 'ok', version: 1 })
  })

  it('allows only a person to undo or acknowledge, and Undo supersedes pending proposals', async () => {
    await start('lark')
    const me = await start(DEFAULT_PROFILE_ID)
    expect(replace(me).ok).toBe(true)
    expect(propose(me, 'Waiting replacement', 1).ok).toBe(true)
    expect(policy().undoAgentRules('lark', 1, caller(me))).toBeNull()
    expect(policy().markAgentRulesSeen('lark', 1, caller(me))).toBe(false)
    expect(
      policy().instructAgent('lark', 'Stale person save', undefined, window, {
        expectedVersion: 0,
        currentText: '',
      }),
    ).toBeNull()
    const agentSink: RuntimeEventSink = {
      ...window,
      ownerId: agentCallerId(me),
      aPersonIsBehindIt: false,
      send() {},
      sendLiveness() {},
    }
    await expect(
      command(agentSink, { kind: 'agentRulesUnread', profileId: 'lark' }),
    ).rejects.toThrow()
    await expect(
      command(agentSink, { kind: 'undoAgentRules', profileId: 'lark', expectedVersion: 1 }),
    ).rejects.toThrow()
    await expect(
      command(agentSink, { kind: 'markAgentRulesSeen', profileId: 'lark', throughVersion: 1 }),
    ).rejects.toThrow()
    expect(policy().undoAgentRules('lark', 1, window)?.own.versions[0]?.text).toBe('')
    expect(store.instructionAsksWaiting()).toEqual([])
    expect(policy().undoAgentRules('lark', 1, window)).toBeNull()
    expect(policy().markAgentRulesSeen('lark', 1, window)).toBe(true)
  })
})
