import { createHash } from 'node:crypto'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  AuthUnavailableError,
  FakeProviderSessions,
  FakeRuntime,
  codexAuthStateFrom,
  provisionCodexAuth,
  type AgentToolset,
  type StartOptions,
} from '@brobot2/runtime'
import type { Provider } from '@brobot2/shared'
import type { SessionInstructions } from '../src/shared/runtime-ipc'
import { type AppDatabase, openDatabase } from '../src/main/db/connection'
import { applyMigrations } from '../src/main/db/migrate'
import { createSessionStore, type SessionStore } from '../src/main/db/session-store'
import { NO_DISCOVERY } from '../src/main/adopt/discover-sessions'
import { RuntimeHost, type RuntimeEventSink } from '../src/main/runtime/runtime-host'
import { resolveSessionCwd } from '../src/main/runtime/scratch-cwd'
import { NONE_STARTED, theProviderOfAnAgent } from '../src/shared/agent-roster'
import { DEFAULT_PROFILE_ID, type RuntimeEventMessage } from '../src/shared/runtime-ipc'

/**
 * An agent keeps its default: a give can select another conversation's provider. One
 * nobody saved a provider for takes it from its own conversations that started; one whose
 * conversations ran on both is a person's to choose; and one nothing has run takes it at its first
 * start, and keeps it.
 *
 * ⚑ Real host, real SQLite ledger, real migrations. The providers are doubles that record which
 * provider each start ran on; every Codex sign-in file here is a fake one in a scratch folder.
 */

const here = dirname(fileURLToPath(import.meta.url))
const migrationsFolder = join(here, '../src/main/db/migrations')

const NOTHING_INJECTED: SessionInstructions = {
  injected: [],
  agentMemory: [],
  provider: [],
  refused: [],
  note: '',
  recallsReported: false,
  writesReported: true,
  composed: null,
}

class Sink implements RuntimeEventSink {
  readonly aPersonIsBehindIt = true
  readonly messages: RuntimeEventMessage[] = []
  alive = true
  constructor(readonly ownerId: string) {}
  send(message: RuntimeEventMessage): void {
    this.messages.push(message)
  }
  sendLiveness(): void {}
}

class WatchingRuntime extends FakeRuntime {
  constructor(
    provider: Provider,
    private readonly handed: AgentToolset[],
    private readonly started: Provider[],
    sessions: FakeProviderSessions,
  ) {
    super(provider, { sessions })
  }
  override async start(options: StartOptions): ReturnType<FakeRuntime['start']> {
    const handle = await super.start(options)
    this.started.push(this.provider)
    if (options.agentTools) this.handed.push(options.agentTools)
    return handle
  }
}

describe('the rule: what an agent runs on', () => {
  it('a provider saved for it wins over its conversations', () => {
    expect(theProviderOfAnAgent('codex', { claude: 3, codex: 0 })).toEqual({
      provider: 'codex',
      from: 'saved',
    })
  })

  it('with none saved, conversations that all started on one provider name it', () => {
    expect(theProviderOfAnAgent(null, { claude: 2, codex: 0 })).toEqual({
      provider: 'claude',
      from: 'its-conversations',
    })
    expect(theProviderOfAnAgent(null, { claude: 0, codex: 1 })).toEqual({
      provider: 'codex',
      from: 'its-conversations',
    })
  })

  it('conversations on both name none, and say how many ran on each', () => {
    expect(theProviderOfAnAgent(null, { claude: 3, codex: 1 })).toEqual({
      provider: null,
      from: 'its-conversations-differ',
      startedOn: { claude: 3, codex: 1 },
    })
  })

  it('with none saved and none started, nothing names one yet', () => {
    expect(theProviderOfAnAgent(null, NONE_STARTED)).toEqual({
      provider: null,
      from: 'nothing-yet',
    })
  })
})

describe('through the host: a give never changes an agent’s provider', () => {
  let userData: string
  let work: string
  let db: AppDatabase
  let store: SessionStore
  let host: RuntimeHost
  let sessions: FakeProviderSessions
  let handed: AgentToolset[]
  let started: Provider[]
  let counter: number
  let window: Sink
  let clock: number
  let homeFails: (provider: Provider, profileId: string) => Error | null
  let prepared: string[]
  const tick = (): number => clock++

  beforeEach(() => {
    userData = mkdtempSync(join(tmpdir(), 'brobot2-its-provider-'))
    work = mkdtempSync(join(tmpdir(), 'brobot2-its-provider-work-'))
    db = openDatabase(join(userData, 'brobot2.sqlite'))
    applyMigrations(db, migrationsFolder)
    clock = 5_000_000
    store = createSessionStore(db, tick)
    counter = 0
    handed = []
    started = []
    homeFails = () => null
    prepared = []
    sessions = new FakeProviderSessions()
    host = new RuntimeHost({
      store,
      discoverSessions: NO_DISCOVERY,
      nativeTranscriptPath: () => null,
      exportDirectory: () => join(userData, 'exports'),
      createRuntime: (provider: Provider) =>
        new WatchingRuntime(provider, handed, started, sessions),
      prepareProviderHome: (provider: Provider, profileId?: string) => {
        const failed = homeFails(provider, profileId ?? DEFAULT_PROFILE_ID)
        if (failed !== null) throw failed
        prepared.push(`${profileId ?? DEFAULT_PROFILE_ID}/${provider}`)
        const home = join(userData, 'provider-homes', 'default', profileId ?? 'default', provider)
        mkdirSync(home, { recursive: true })
        return home
      },
      providerHomePath: (provider: Provider) => join(userData, 'provider-homes', provider),
      resolveCwd: (sessionId, requested) => resolveSessionCwd(userData, sessionId, requested),
      newSessionId: () => `sess_${String(++counter)}`,
      now: tick,
      readProviderConfig: (_provider, home) => ({
        home,
        homeEnv: 'CLAUDE_CONFIG_DIR',
        model: 'm',
        authNote: null,
        files: [],
      }),
      readInstructions: () => ({
        instructions: NOTHING_INJECTED,
        systemHint: undefined,
        memoryLoaded: null,
      }),
    })
    window = new Sink('webContents:1')
  })

  afterEach(async () => {
    await host.closeAll()
    db.close()
    rmSync(userData, { recursive: true, force: true })
    rmSync(work, { recursive: true, force: true })
  })

  const personOpens = async (profileId: string, provider: Provider): Promise<string> => {
    const { sessionId } = await host.createSession(
      { provider, profileId, cwd: work, approvalMode: 'ask' },
      window,
    )
    return sessionId
  }

  /** A giver on this provider, and the toolset its launch was handed. */
  const aGiverOn = async (provider: Provider): Promise<AgentToolset> => {
    await personOpens(DEFAULT_PROFILE_ID, provider)
    const tools = handed.at(-1)
    if (tools === undefined) throw new Error('no launch was handed a toolset')
    return tools
  }

  const callOn = async (
    toolset: AgentToolset,
    name: string,
    args: Record<string, unknown>,
  ): Promise<Record<string, unknown>> => {
    const tool = toolset.tools.find((one) => one.name === name)
    if (tool === undefined) throw new Error(`no such tool: ${name}`)
    return (await tool.call(args)).structured as Record<string, unknown>
  }

  const give = (
    tools: AgentToolset,
    profile: string,
    over: Record<string, unknown> = {},
  ): Promise<Record<string, unknown>> =>
    callOn(tools, 'give_work', {
      definition_of_done: 'The requested result and its checks are recorded.',
      profile,
      title: 'The work',
      brief: 'the work',
      ...over,
    })

  const providerOfSession = (sessionId: string): unknown =>
    (
      db.prepare('SELECT provider FROM provider_session WHERE id = ?').get(sessionId) as
        { provider: string } | undefined
    )?.provider

  const conversationsOf = (slug: string): number =>
    (
      db
        .prepare(
          `SELECT count(*) AS n FROM provider_session s JOIN agent_identity i
             ON s.agent_identity_id = i.id WHERE i.slug = ?`,
        )
        .get(slug) as { n: number }
    ).n

  const piecesGiven = (): number =>
    (
      db.prepare('SELECT count(*) AS n FROM work WHERE parent_id IS NOT NULL').get() as {
        n: number
      }
    ).n

  /**
   * An agent whose conversations started on these providers, as a database from before an agent
   * kept its provider holds it: nothing saved for it.
   */
  const anAgentThatRanOn = async (slug: string, providers: readonly Provider[]): Promise<void> => {
    host.createAgent({ slug, displayName: null, provider: null })
    for (const provider of providers) {
      await host.close(await personOpens(slug, provider), window)
      db.prepare('UPDATE agent_identity SET provider = NULL WHERE slug = ?').run(slug)
    }
  }

  const runsOnInTheRoster = (slug: string): unknown =>
    host.agentIdentities().use.find((one) => one.slug === slug)?.runsOn

  describe('an agent nobody saved a provider for takes it from its own conversations', () => {
    it('a Codex giver starts a Claude-only agent on Claude, and nothing of Codex is started for it', async () => {
      await anAgentThatRanOn('ana', ['claude', 'claude'])
      expect(store.providerOf('ana')).toBeNull()
      expect(runsOnInTheRoster('ana')).toEqual({ provider: 'claude', from: 'its-conversations' })
      const giver = await aGiverOn('codex')
      started.length = 0

      const given = await give(giver, 'ana')

      expect(given['outcome'], JSON.stringify(given)).toBe('ok')
      expect(given['started']).toBe(true)
      expect(providerOfSession(String(given['agent']))).toBe('claude')
      expect(started).toEqual(['claude'])
      // ⚑ …and it is saved at that start, so no later giver can move it.
      expect(store.providerOf('ana')).toBe('claude')
    })

    it('a Claude giver starts a Codex-only agent on Codex', async () => {
      await anAgentThatRanOn('ida', ['codex'])
      const giver = await aGiverOn('claude')
      started.length = 0

      const given = await give(giver, 'ida')

      expect(providerOfSession(String(given['agent']))).toBe('codex')
      expect(started).toEqual(['codex'])
      expect(store.providerOf('ida')).toBe('codex')
    })

    it('a conversation that never started does not count, so a failed start cannot move it', async () => {
      await anAgentThatRanOn('ana', ['claude'])
      const never = await personOpens('ana', 'codex')
      await host.close(never, window)
      db.prepare('UPDATE provider_session SET external_ref = NULL WHERE id = ?').run(never)
      db.prepare("UPDATE agent_identity SET provider = NULL WHERE slug = 'ana'").run()
      expect(runsOnInTheRoster('ana')).toEqual({ provider: 'claude', from: 'its-conversations' })

      const given = await give(await aGiverOn('codex'), 'ana')

      expect(providerOfSession(String(given['agent']))).toBe('claude')
    })

    it('a provider saved for it wins over its conversations', async () => {
      await anAgentThatRanOn('ana', ['claude'])
      host.setAgentProvider('ana', 'codex')

      const given = await give(await aGiverOn('claude'), 'ana')

      expect(providerOfSession(String(given['agent']))).toBe('codex')
    })

    it('list_profiles says the provider it runs on, from its conversations', async () => {
      await anAgentThatRanOn('ana', ['claude'])
      const listed = await callOn(await aGiverOn('codex'), 'list_profiles', {})
      const ana = (listed['profiles'] as { profile: string; provider: unknown }[]).find(
        (one) => one.profile === 'ana',
      )
      expect(ana?.provider).toBe('claude')
    })
  })

  describe('a give naming a model preserves the default and existing conversations', () => {
    it('a model of another provider starts its conversation while the old provider and default stay put', async () => {
      await anAgentThatRanOn('ana', ['claude'])
      const giver = await aGiverOn('codex')
      const before = { conversations: conversationsOf('ana'), pieces: piecesGiven() }

      const old = store.conversationsOf('ana').map((one) => one.conversation)
      const given = await give(giver, 'ana', { model: 'fake-codex-a' })

      expect(given['outcome'], JSON.stringify(given)).toBe('ok')
      expect(providerOfSession(String(given['agent']))).toBe('codex')
      expect(given['runs_on']).toMatchObject({ model: 'fake-codex-a' })
      for (const conversation of old) expect(providerOfSession(conversation)).toBe('claude')
      expect({ conversations: conversationsOf('ana'), pieces: piecesGiven() }).toEqual({
        conversations: before.conversations + 1,
        pieces: before.pieces + 1,
      })
      expect(store.providerOf('ana')).toBe('claude')
    })

    it('a model of its own provider is taken, from a giver on the other one', async () => {
      await anAgentThatRanOn('ana', ['claude'])
      const given = await give(await aGiverOn('codex'), 'ana', { model: 'fake-claude-b' })

      expect(given['outcome'], JSON.stringify(given)).toBe('ok')
      expect(providerOfSession(String(given['agent']))).toBe('claude')
      expect(given['runs_on']).toMatchObject({ model: 'fake-claude-b' })
    })
  })

  describe('give_work and create_agent name each list as this app last read it', () => {
    const described = (tools: AgentToolset, tool: string, field: string): string => {
      const input = tools.tools.find((one) => one.name === tool)?.input as
        Record<string, { readonly description?: string }> | undefined
      return input?.[field]?.description ?? ''
    }

    it('a made-up model is refused with the list, and the next launch names a model a person added', async () => {
      await host.modelList('claude')
      await host.modelList('codex')
      await anAgentThatRanOn('ana', ['claude'])
      const before = await aGiverOn('codex')
      for (const tool of ['give_work', 'create_agent']) {
        expect(described(before, tool, 'model')).toContain(
          ' Models to choose from, as last read — Claude: fake-claude-a, fake-claude-b · Codex: fake-codex-a, fake-codex-b.',
        )
        expect(described(before, tool, 'effort')).toContain(
          ' Efforts each model offers, as last read — Claude: low, medium, high for fake-claude-a; none for fake-claude-b · Codex: low, medium, high for fake-codex-a; none for fake-codex-b.',
        )
      }

      const refused = await give(before, 'ana', { model: 'claude-made-up' })

      expect(refused['rail']).toBe('model-not-in-the-list')
      expect(refused['detail']).toMatchObject({ choices: ['fake-claude-a', 'fake-claude-b'] })
      expect(String(refused['reason'])).toContain(
        'Pick a model from Claude’s list: “fake-claude-a”, “fake-claude-b”.',
      )

      host.addHandAddedModel('claude', 'claude-by-hand')
      const after = await aGiverOn('codex')

      for (const tool of ['give_work', 'create_agent']) {
        expect(described(after, tool, 'model')).toContain(
          ' Claude: fake-claude-a, fake-claude-b, claude-by-hand · Codex: fake-codex-a, fake-codex-b.',
        )
        expect(described(after, tool, 'effort')).toContain(
          ' Claude: low, medium, high for fake-claude-a, claude-by-hand; none for fake-claude-b · Codex:',
        )
      }
      // ⚑ A launch keeps the words it was handed.
      expect(described(before, 'give_work', 'model')).not.toContain('claude-by-hand')
      const refusedAgain = await give(after, 'ana', { model: 'claude-made-up' })
      expect(refusedAgain['detail']).toMatchObject({
        choices: ['fake-claude-a', 'fake-claude-b', 'claude-by-hand'],
      })
    })

    it('an unknown field is refused with the fields give_work takes', async () => {
      const refused = await give(await aGiverOn('codex'), 'ana', { priority: 'high' })

      expect(refused['rail']).toBe('malformed-request')
      expect(refused['detail']).toMatchObject({
        problems: [
          '(request): unknown fields "priority" — it takes only profile, title, brief, definition_of_done, folder, piece, new, provider, parallel, inputs, model, effort',
        ],
      })
    })
  })

  describe('an agent whose conversations ran on both is a person’s to choose', () => {
    it('a give that would start a conversation is refused, saying how many ran on each, and nothing is written', async () => {
      await anAgentThatRanOn('ana', ['claude', 'claude', 'codex'])
      expect(runsOnInTheRoster('ana')).toEqual({
        provider: null,
        from: 'its-conversations-differ',
        startedOn: { claude: 2, codex: 1 },
      })
      const giver = await aGiverOn('codex')
      const before = { conversations: conversationsOf('ana'), pieces: piecesGiven() }

      const refused = await give(giver, 'ana')

      expect(refused).toMatchObject({
        outcome: 'refused',
        rail: 'its-provider-is-not-chosen',
        permanence: 'until-a-person-changes-it',
        retryable: false,
        detail: { profileId: 'ana', startedOn: { claude: 2, codex: 1 } },
      })
      expect(String(refused['reason'])).toContain('Ask a person to choose a provider for “ana”')
      expect(String(refused['reason'])).toContain('Claude (2) and Codex (1)')
      expect({ conversations: conversationsOf('ana'), pieces: piecesGiven() }).toEqual(before)
      expect(store.providerOf('ana')).toBeNull()
    })

    it('a give asking for a NEW agent under its name is told the name exists, not to choose', async () => {
      await anAgentThatRanOn('ana', ['claude', 'codex'])
      const refused = await give(await aGiverOn('codex'), 'ana', { new: true })
      expect(refused['rail']).toBe('that-profile-exists')
    })

    it('once a person chooses, the same give starts on that provider', async () => {
      await anAgentThatRanOn('ana', ['claude', 'codex'])
      const giver = await aGiverOn('codex')
      expect((await give(giver, 'ana'))['rail']).toBe('its-provider-is-not-chosen')

      host.setAgentProvider('ana', 'claude')
      const given = await give(giver, 'ana')

      expect(given['outcome'], JSON.stringify(given)).toBe('ok')
      expect(providerOfSession(String(given['agent']))).toBe('claude')
    })
  })

  describe('an agent nothing has run takes its provider at its first start, and keeps it', () => {
    it('with no model named, the giver’s — and a later giver on the other provider cannot change it', async () => {
      host.createAgent({ slug: 'eve', displayName: null, provider: null })
      expect(runsOnInTheRoster('eve')).toEqual({ provider: null, from: 'nothing-yet' })

      const first = await give(await aGiverOn('codex'), 'eve')
      expect(providerOfSession(String(first['agent']))).toBe('codex')
      expect(store.providerOf('eve')).toBe('codex')

      // ⚑ Another giver has no conversation with eve yet, so its give starts one: on eve's.
      const second = await give(await aGiverOn('claude'), 'eve')
      expect(second['started']).toBe(true)
      expect(providerOfSession(String(second['agent']))).toBe('codex')
    })

    it('a model named by a giver on the other provider chooses the provider whose list alone holds it', async () => {
      host.createAgent({ slug: 'eve', displayName: null, provider: null })
      // ⚑ An agent with a folder of its own: the lookup still reads the stand-in's lists, so the
      // agent's home is never prepared for a provider it will not run on.
      mkdirSync(join(userData, 'provider-homes', 'default', 'eve'), { recursive: true })

      const given = await give(await aGiverOn('codex'), 'eve', { model: 'fake-claude-a' })

      expect(given['outcome'], JSON.stringify(given)).toBe('ok')
      expect(providerOfSession(String(given['agent']))).toBe('claude')
      expect(store.providerOf('eve')).toBe('claude')
      expect(prepared).not.toContain('eve/codex')
    })

    it('a model neither list holds is refused against the giver’s list, and nothing is saved', async () => {
      host.createAgent({ slug: 'eve', displayName: null, provider: null })

      const refused = await give(await aGiverOn('codex'), 'eve', { model: 'no-such-model' })

      expect(refused['rail']).toBe('model-not-in-the-list')
      expect(refused['detail']).toMatchObject({ provider: 'codex' })
      expect(store.providerOf('eve')).toBeNull()
    })

    it('a new agent a give makes keeps the provider it starts on', async () => {
      const given = await give(await aGiverOn('claude'), 'fresh', { new: true })
      expect(given['outcome'], JSON.stringify(given)).toBe('ok')
      expect(store.providerOf('fresh')).toBe('claude')
    })

    it('create_agent keeps the provider it names, else its model’s, else its creator’s', async () => {
      const creator = await aGiverOn('codex')
      await callOn(creator, 'create_agent', { profile_slug: 'named', provider: 'claude' })
      await callOn(creator, 'create_agent', { profile_slug: 'by-model', model: 'fake-claude-a' })
      await callOn(creator, 'create_agent', { profile_slug: 'plain' })

      expect(store.providerOf('named')).toBe('claude')
      expect(store.providerOf('by-model')).toBe('claude')
      expect(store.modelChoiceOf('by-model')).toMatchObject({
        provider: 'claude',
        model: 'fake-claude-a',
      })
      expect(store.providerOf('plain')).toBe('codex')
    })
  })

  describe('only a give’s start saves it, and a failed save never stops the start', () => {
    it('a person’s own launch on another provider runs there and saves nothing', async () => {
      host.createAgent({ slug: 'eve', displayName: null, provider: null })
      const launched = await personOpens('eve', 'codex')
      expect(providerOfSession(launched)).toBe('codex')
      expect(store.providerOf('eve')).toBeNull()
    })

    it('a save the store refuses is said, and the start goes on', async () => {
      host.createAgent({ slug: 'eve', displayName: null, provider: null })
      const giver = await aGiverOn('claude')
      const warned = vi.spyOn(console, 'warn').mockImplementation(() => {})
      vi.spyOn(store, 'saveProviderIfNoneIsSaved').mockImplementation(() => {
        throw new Error('database or disk is full')
      })

      const given = await give(giver, 'eve')

      expect(given['outcome'], JSON.stringify(given)).toBe('ok')
      expect(providerOfSession(String(given['agent']))).toBe('claude')
      expect(warned.mock.calls.some((args) => String(args[0]).includes('could not keep eve'))).toBe(
        true,
      )
    })

    it('a saved value this app cannot read is no provider, and a give’s start replaces it', async () => {
      await anAgentThatRanOn('ana', ['claude'])
      db.prepare("UPDATE agent_identity SET provider = 'gemini' WHERE slug = 'ana'").run()
      expect(runsOnInTheRoster('ana')).toEqual({ provider: 'claude', from: 'its-conversations' })

      await give(await aGiverOn('codex'), 'ana')

      expect(store.providerOf('ana')).toBe('claude')
    })
  })

  describe('saving it never writes over a person', () => {
    it('a provider is saved only where none is, and a default model stays as it is', () => {
      host.createAgent({ slug: 'ana', displayName: null, provider: null })
      store.setModelChoice('ana', { provider: 'codex', model: 'fake-codex-a', effort: 'high' })

      expect(store.saveProviderIfNoneIsSaved('ana', 'claude')).toBe(true)
      expect(store.providerOf('ana')).toBe('claude')
      expect(store.modelChoiceOf('ana')).toMatchObject({ provider: 'codex' })

      expect(store.saveProviderIfNoneIsSaved('ana', 'codex')).toBe(false)
      expect(store.providerOf('ana')).toBe('claude')
      expect(store.saveProviderIfNoneIsSaved('nobody', 'codex')).toBe(false)
    })
  })

  describe('a stale copy of a Codex sign-in says what failed and what fixes it', () => {
    it('the one-time copy is never refreshed, and a start on it is refused naming the sign-in and its remedy', async () => {
      // ⚑ A fake sign-in, copied once into a scratch profile home, as a profile's first launch does.
      const source = join(userData, 'machine-codex', 'auth.json')
      const home = join(userData, 'scratch-profile-home')
      mkdirSync(dirname(source), { recursive: true })
      mkdirSync(home, { recursive: true })
      const signIn = (refresh: string): string =>
        JSON.stringify({
          auth_mode: 'chatgpt',
          tokens: { account_id: 'acct-fake', access_token: 'fake', refresh_token: refresh },
        })
      writeFileSync(source, signIn('fake-one'))
      await provisionCodexAuth(home, { sourceAuthPath: source })
      // ⚑ The machine's sign-in renews: the copy keeps the old one, which the provider has
      // since retired.
      writeFileSync(source, signIn('fake-two'))
      await provisionCodexAuth(home, { sourceAuthPath: source })
      // ⚑ By a digest of its bytes: a failure prints two digests, never what a file holds.
      const digestOf = (bytes: string | Buffer): string =>
        createHash('sha256').update(bytes).digest('hex').slice(0, 16)
      expect(digestOf(readFileSync(join(home, 'auth.json')))).toBe(digestOf(signIn('fake-one')))

      // ⚑ What Codex answers for such a copy: a sign-in, and no account it can use.
      const stale = codexAuthStateFrom({ authMethod: 'chatgpt' }, { account: null })
      if (stale.state !== 'stale') throw new Error(`a stale copy read as ${stale.state}`)
      homeFails = (provider, profileId) =>
        provider === 'codex' && profileId === 'reader'
          ? new AuthUnavailableError('codex', stale.reason)
          : null
      vi.spyOn(console, 'warn').mockImplementation(() => {})
      await anAgentThatRanOn('reader', [])
      host.setAgentProvider('reader', 'codex')

      const refused = await give(await aGiverOn('codex'), 'reader')

      expect(refused).toMatchObject({
        outcome: 'refused',
        rail: 'agent-did-not-start',
        detail: { profile: 'reader', because: 'its-sign-in-is-unusable', provider: 'codex' },
      })
      const said = String(refused['reason'])
      expect(said).toContain('its Codex sign-in could not be used')
      // 🔴 The remedy is one that reaches THIS agent's sign-in: the Codex card in Providers signs in
      // only BroBot's own profile, so it is never named as where this agent is signed in.
      expect(said).toContain('the Codex card signs in only BroBot’s own')
      expect(said).not.toContain('again on the Codex card in Providers')
      expect(said).toContain('BroCrew does not need restarting')
      expect(said).not.toContain('somebody stopped it first')
      // ⚑ What a person does, whole inside the 200 characters a giver's row keeps.
      expect(`refused (agent-did-not-start): ${said}`.slice(0, 200)).toContain(
        'Ask a person to save an API key on the Codex card in Providers, or to sign that agent in from one of its conversations: its Codex sign-in could not be used.',
      )
      expect(said).toContain('Nothing was given, and giving it again will not help until then.')
    })

    it('🔴 a first start with no Codex sign-in to copy says that, and what a person can do', async () => {
      // ⚑ The real first-start copy, from a fictional place that holds no sign-in.
      const newHome = join(userData, 'scratch-new-home')
      mkdirSync(newHome, { recursive: true })
      const failure = await provisionCodexAuth(newHome, {
        sourceAuthPath: join(userData, 'no-machine-codex', 'auth.json'),
      }).then(
        () => null,
        (error: unknown) => error,
      )
      if (!(failure instanceof AuthUnavailableError)) throw new Error('the copy did not refuse')
      homeFails = (provider, profileId) =>
        provider === 'codex' && profileId === 'reader' ? failure : null
      vi.spyOn(console, 'warn').mockImplementation(() => {})
      await anAgentThatRanOn('reader', [])
      host.setAgentProvider('reader', 'codex')

      const refused = await give(await aGiverOn('codex'), 'reader')

      expect(refused).toMatchObject({
        outcome: 'refused',
        rail: 'agent-did-not-start',
        detail: {
          profile: 'reader',
          because: 'this-computer-has-no-sign-in-to-copy',
          provider: 'codex',
        },
      })
      const said = String(refused['reason'])
      // ⛔ Not "its sign-in could not be used": there was never one, and no place to renew it.
      expect(said).not.toContain('its Codex sign-in could not be used')
      expect(`refused (agent-did-not-start): ${said}`.slice(0, 200)).toContain(
        'Ask a person to sign in on the Codex card in Providers, or to save an API key there: there is no Codex sign-in for that agent to start on.',
      )
      expect(said).toContain('where it keeps none, of BroBot’s own')
      expect(said).toContain('BroCrew does not need restarting')
      // ⛔ The path of the missing file stays in the log.
      expect(said).not.toContain('auth.json')
      expect(said).not.toContain(userData)
      expect(said).toContain('Nothing was given, and giving it again will not help until then.')
    })
  })
})
