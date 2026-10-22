import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { FakeRuntime, type AgentToolset, type StartOptions } from '@brobot2/runtime'
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
  ) {
    super(provider)
  }
  override async start(options: StartOptions): ReturnType<FakeRuntime['start']> {
    const handle = await super.start(options)
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
    tools = new Map()
    store = createSessionStore(db, tick)
    const home = (provider: Provider, profile?: string | null) =>
      join(root, 'homes', profile ?? 'default', provider)
    host = new RuntimeHost({
      store,
      discoverSessions: NO_DISCOVERY,
      nativeTranscriptPath: () => null,
      exportDirectory: () => join(root, 'exports'),
      createRuntime: (provider) => new ToolRuntime(provider, handed),
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

  const start = async (profile: string): Promise<string> => {
    const created = await host.createSession(
      { provider: 'codex', profileId: profile, cwd: work, approvalMode: 'ask' },
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
    if (tool === undefined) throw new Error(`missing tool ${name}`)
    return (await tool.call(args)).structured as Record<string, unknown>
  }

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
    expect(replace(helper).ok).toBe(false)
    host.claimSession(helper, window)
    expect(replace(helper).ok).toBe(false)
    expect(propose(helper).ok).toBe(true)
    expect(store.ownInstructionsOf('lark').versions).toEqual([])
    expect(replace(primary)).toMatchObject({ ok: true, result: { conversation: primary } })
  })

  it('refuses the old shortcut, exposes a usable read, and leaves direct writing off the public tools', async () => {
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
    expect(tools.get(me)?.tools.some((one) => one.name === 'write_agent_rules')).toBe(false)
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
