import { waitFor } from './lib/f093-host'
import type { TranscriptEvent } from '../src/shared/conversation-events'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { FakeProviderSessions, FakeRuntime } from '@brobot2/runtime'
import type {
  AgentToolset,
  FakeSessionHandle,
  ResumeOptions,
  SessionRef,
  StartOptions,
} from '@brobot2/runtime'
import type { Provider } from '@brobot2/shared'
import { type AppDatabase, openDatabase } from '../src/main/db/connection'
import { applyMigrations } from '../src/main/db/migrate'
import { createSessionStore, type SessionStore } from '../src/main/db/session-store'
import { RuntimeHost, THE_APP_ITSELF, mayInterruptDownTheChain } from './helpers/giver-notice-host'
import {
  A_CONVERSATION_CANNOT_INTERRUPT_ITSELF,
  agentToolsFor,
  refuseTool,
  type ToolName,
} from '../src/main/runtime/agent-tools'
import { resourcesRoot } from '../src/main/resources/resources'
import { resolveSessionCwd } from '../src/main/runtime/scratch-cwd'
import { DEFAULT_PROFILE_ID } from '../src/shared/runtime-ipc'
import { permanenceInWords } from '../src/main/runtime/agent-tool-answer-words'
import {
  syntheticProviderHome,
  neutralHostDeps,
  fixtureProviderConfig,
  RecordingSink,
} from './lib/host-fixture'

const here = dirname(fileURLToPath(import.meta.url))
const migrationsFolder = join(here, '../src/main/db/migrations')
const mainRoot = join(here, '../src/main')

class ProviderDouble extends FakeRuntime {
  constructor(
    provider: Provider,
    private readonly handles: FakeSessionHandle[],
    sessions: FakeProviderSessions,
  ) {
    super(provider, { sessions })
  }
  override async start(options: StartOptions): Promise<FakeSessionHandle> {
    const handle = await super.start(options)
    this.handles.push(handle)
    return handle
  }
  override async resume(ref: SessionRef, options: ResumeOptions): Promise<FakeSessionHandle> {
    const handle = await super.resume(ref, options)
    this.handles.push(handle)
    return handle
  }
}

describe('629 · a stop reaches down the whole chain', () => {
  let userData: string
  let root: string
  let db: AppDatabase
  let store: SessionStore
  let host: RuntimeHost
  let hosts: RuntimeHost[]
  let handles: FakeSessionHandle[]
  let issued: FakeProviderSessions
  let counter: number
  let clock: number
  let window: RecordingSink
  let chains: number
  const tick = (): number => clock++

  const buildHost = (): RuntimeHost => {
    const built = new RuntimeHost({
      store,
      ...neutralHostDeps(() => userData),
      resourcesRoot: () => resourcesRoot(userData),
      createRuntime: (provider: Provider) => new ProviderDouble(provider, handles, issued),
      prepareProviderHome: syntheticProviderHome(() => userData),
      providerHomePath: (provider: Provider) => join(userData, 'provider-homes', provider),
      resolveCwd: (sessionId, requested) => resolveSessionCwd(userData, sessionId, requested),
      newSessionId: () => `sess_${++counter}`,
      now: tick,
      interruptWaitMs: 40,
      readProviderConfig: fixtureProviderConfig,
    })
    hosts.push(built)
    return built
  }

  beforeEach(() => {
    userData = mkdtempSync(join(tmpdir(), 'brobot2-629-'))
    root = mkdtempSync(join(tmpdir(), 'brobot2-629-root-'))
    db = openDatabase(join(userData, 'brobot2.sqlite'))
    applyMigrations(db, migrationsFolder)
    clock = 9_000_000
    store = createSessionStore(db, tick)
    counter = 0
    hosts = []
    handles = []
    chains = 0
    issued = new FakeProviderSessions()
    host = buildHost()
    window = new RecordingSink('webContents:1')
  })

  afterEach(async () => {
    vi.restoreAllMocks()
    for (const built of hosts) await built.closeAll()
    db.close()
    for (const dir of [userData, root]) rmSync(dir, { recursive: true, force: true })
  })

  const personOpens = async (
    profileId: string,
    approvalMode: 'ask' | 'auto' = 'ask',
  ): Promise<string> => {
    const { sessionId } = await host.createSession(
      { provider: 'claude', profileId, approvalMode, cwd: root },
      window,
    )
    return sessionId
  }

  const bringIdentityIntoBeing = async (profileId: string): Promise<void> => {
    const id = await personOpens(profileId)
    await host.close(id, window)
  }

  const callOn = async (
    toolset: AgentToolset,
    name: ToolName,
    args: Record<string, unknown>,
  ): Promise<Record<string, unknown>> => {
    const tool = toolset.tools.find((one) => one.name === name)
    if (tool === undefined) throw new Error(`no such tool: ${name}`)
    return (await tool.call(args)).structured as Record<string, unknown>
  }

  const ledger = (sessionId: string): TranscriptEvent[] =>
    store.events(sessionId).map((entry) => entry.event)

  const latestHandle = (): FakeSessionHandle => {
    const handle = handles.at(-1)
    if (handle === undefined) throw new Error('no provider handle has been issued')
    return handle
  }

  const makeItWork = async (handle: FakeSessionHandle): Promise<void> => {
    handle.simulateThinking({ text: 'driving the browser', redacted: false })
    await waitFor(() => handle.status() === 'working', 'the conversation to be working')
  }

  const asAgent = (sessionId: string): { ownerId: string } => ({ ownerId: `agent:${sessionId}` })

  const give = async (
    tools: AgentToolset,
    profile: string,
    title: string,
  ): Promise<{ agent: string; piece: string; label: string }> => {
    const given = await callOn(tools, 'give_work', {
      definition_of_done: 'The requested result and its checks are recorded.',
      profile,
      title,
      brief: title,
    })
    expect(given.outcome, JSON.stringify(given)).toBe('ok')
    expect(given.started, JSON.stringify(given)).toBe(true)
    const agent = given.agent as string
    await waitFor(
      () => ledger(agent).some((event) => event.type === 'turn'),
      'the brief’s turn to end',
    )
    return { agent, piece: given.piece as string, label: given.label as string }
  }

  const aChainOfThree = async (): Promise<{
    brobot: string
    ada: string
    ali: string
    aliPiece: string
    aliLabel: string
    aliHandle: FakeSessionHandle
    brobotTools: AgentToolset
    adaTools: AgentToolset
    pmProfile: string
    workerProfile: string
    siblingProfile: string
  }> => {
    const nth = ++chains
    const pmProfile = `pm-${String(nth)}`
    const workerProfile = `worker-${String(nth)}`
    const siblingProfile = `sibling-${String(nth)}`
    await bringIdentityIntoBeing(pmProfile)
    await bringIdentityIntoBeing(workerProfile)
    await bringIdentityIntoBeing(siblingProfile)
    const brobot = await personOpens(DEFAULT_PROFILE_ID, 'auto')
    const brobotTools = agentToolsFor(host, brobot)
    const ada = (await give(brobotTools, pmProfile, 'run the front-end work')).agent
    const adaTools = agentToolsFor(host, ada)
    const toAli = await give(adaTools, workerProfile, 'build the world-clock page')
    const ali = toAli.agent
    const aliHandle = latestHandle()
    return {
      brobot,
      ada,
      ali,
      aliPiece: toAli.piece,
      aliLabel: toAli.label,
      aliHandle,
      brobotTools,
      adaTools,
      pmProfile,
      workerProfile,
      siblingProfile,
    }
  }

  describe('§0 · the chain and the actor were already recorded', () => {
    it('⚑ ALREADY BUILT · the chain is DURABLE, and the depth rail already walks it', async () => {
      const { brobot, ada, ali, aliPiece } = await aChainOfThree()
      expect(store.parentOf(ali)).toBe(ada)
      expect(store.parentOf(ada)).toBe(brobot)
      expect(store.parentOf(brobot)).toBeNull()
      expect(store.depthOf(aliPiece)).toBe(2)
      expect(store.ancestorsOf(ali)).toEqual([ada, brobot])
      expect(store.ancestorsOf(ada)).toEqual([brobot])
      expect(store.ancestorsOf(brobot)).toEqual([])
    })

    it('⚑ ALREADY BUILT · the interrupt already records WHO performed it', async () => {
      const { ada, ali, aliHandle, adaTools } = await aChainOfThree()
      await makeItWork(aliHandle)
      const said = await callOn(adaTools, 'interrupt_agent', { agent: ali, reason: 'stop' })
      expect(said.outcome, JSON.stringify(said)).toBe('ok')
      const asked = ledger(ali).find((event) => event.type === 'work_interrupted')
      expect(asked).toMatchObject({ type: 'work_interrupted', by: 'an-agent', agent: ada })
    })
  })

  describe('§1 · a grandparent may interrupt a grandchild', () => {
    it('🔴 THE RULING · BroBot stops Ali directly, at depth 2, without going through Ada', async () => {
      const { brobot, ali, aliPiece, aliHandle, brobotTools } = await aChainOfThree()
      await makeItWork(aliHandle)
      expect(store.depthOf(aliPiece)).toBe(2)

      const said = await callOn(brobotTools, 'interrupt_agent', {
        agent: ali,
        reason: 'the person asked for it to stop',
      })
      expect(said.outcome, JSON.stringify(said)).toBe('ok')
      expect(said.agent).toBe(ali)
      expect(said.asked).toBe(true)

      await waitFor(
        () => ledger(ali).some((event) => event.type === 'work_interrupted'),
        'the ask to reach the grandchild',
      )
      expect(ledger(ali).find((event) => event.type === 'work_interrupted')).toMatchObject({
        by: 'an-agent',
        agent: brobot,
      })
      expect(ledger(brobot).some((event) => event.type === 'work_interrupted')).toBe(false)
    })

    it('⚑ THE PAIR one fact over · the DIRECT commander still stops it, unchanged', async () => {
      const { ada, ali, aliHandle, adaTools } = await aChainOfThree()
      await makeItWork(aliHandle)
      const said = await callOn(adaTools, 'interrupt_agent', { agent: ali, reason: 'stop' })
      expect(said.outcome, JSON.stringify(said)).toBe('ok')
      expect(ledger(ali).find((event) => event.type === 'work_interrupted')).toMatchObject({
        agent: ada,
      })
    })

    it('🔴 D-014 · the grandchild may not interrupt what is above it — and the grandparent may interrupt it', async () => {
      const { ada, ali, aliHandle, brobotTools } = await aChainOfThree()
      await makeItWork(aliHandle)
      const upward = await callOn(agentToolsFor(host, ali), 'interrupt_agent', {
        agent: ada,
        reason: 'no',
      })
      expect(upward.outcome, JSON.stringify(upward)).toBe('refused')
      expect(upward.rail).toBe('not-below-you')
      expect(ledger(ada).some((event) => event.type === 'work_interrupted')).toBe(false)
      const down = await callOn(brobotTools, 'interrupt_agent', { agent: ali, reason: 'done' })
      expect(down.outcome, JSON.stringify(down)).toBe('ok')
    })
  })

  describe('§2 · sideways, upward and spawning are all still refused', () => {
    it('⛔ REFUSED · a SIBLING cannot interrupt its sibling — and their parent can', async () => {
      const { ali, aliHandle, adaTools, siblingProfile } = await aChainOfThree()
      await makeItWork(aliHandle)
      const sibling = (await give(adaTools, siblingProfile, 'the second worker')).agent
      const siblingTools = agentToolsFor(host, sibling)
      expect(store.parentOf(sibling)).toBe(store.parentOf(ali))
      expect(store.ancestorsOf(ali)).not.toContain(sibling)

      const refused = await callOn(siblingTools, 'interrupt_agent', { agent: ali, reason: 'stop' })
      expect(refused.outcome, JSON.stringify(refused)).toBe('refused')
      expect(refused.rail).toBe('not-below-you')

      const allowed = await callOn(adaTools, 'interrupt_agent', { agent: ali, reason: 'stop' })
      expect(allowed.outcome, JSON.stringify(allowed)).toBe('ok')
    })

    it('⛔ REFUSED · an UNRELATED agent cannot interrupt anything — and its own child it can', async () => {
      const { ali, aliHandle } = await aChainOfThree()
      await makeItWork(aliHandle)
      const other = await aChainOfThree()
      await makeItWork(other.aliHandle)
      expect(store.ancestorsOf(ali)).not.toContain(other.brobot)
      expect(store.ancestorsOf(ali)).not.toContain(other.ada)

      const refused = await callOn(other.brobotTools, 'interrupt_agent', {
        agent: ali,
        reason: 'stop',
      })
      expect(refused.outcome, JSON.stringify(refused)).toBe('refused')
      expect(refused.rail).toBe('not-below-you')

      const allowed = await callOn(other.brobotTools, 'interrupt_agent', {
        agent: other.ali,
        reason: 'stop',
      })
      expect(allowed.outcome, JSON.stringify(allowed)).toBe('ok')
    })

    it('⛔ REFUSED · a conversation is not ABOVE ITSELF — and the one above it is', async () => {
      const { ali, aliHandle, adaTools } = await aChainOfThree()
      await makeItWork(aliHandle)
      expect(store.ancestorsOf(ali)).not.toContain(ali)

      const itself = await callOn(agentToolsFor(host, ali), 'interrupt_agent', {
        agent: ali,
        reason: 'stop',
      })
      expect(itself.outcome, JSON.stringify(itself)).toBe('refused')
      expect(itself.rail).toBe('that-agent-is-you')
      expect(await host.interruptAgent(ali, asAgent(ali))).toMatchObject({
        ok: false,
        refusal: { rail: 'not-below-you' },
      })
      expect(aliHandle.status()).toBe('working')

      const allowed = await callOn(adaTools, 'interrupt_agent', { agent: ali, reason: 'stop' })
      expect(allowed.outcome, JSON.stringify(allowed)).toBe('ok')
    })

    it('⛔ REFUSED · the chain grants no SPAWN — a grandparent may not start a child under its grandchild', async () => {
      const { brobot, ali, aliLabel, siblingProfile } = await aChainOfThree()
      const request = {
        definition_of_done: 'The requested result and its checks are recorded.',
        profile: siblingProfile,
        title: 'a helper',
        brief: 'a helper',
      }
      const refused = await host.giveWork({ ...request, piece: aliLabel }, asAgent(brobot))
      if (refused.ok) throw new Error(`the grandparent's give was admitted: ${refused.owner}`)
      expect(refused.refusal.rail).toBe('no-piece-you-hold-by-that-name')

      const allowed = await host.giveWork({ ...request, piece: aliLabel }, asAgent(ali))
      expect(allowed.ok, JSON.stringify(allowed)).toBe(true)
      if (allowed.ok) expect(store.parentOf(allowed.owner)).toBe(ali)
    })

    it('⛔ REFUSED · the chain grants no WORK — a grandparent may not give its grandchild work', async () => {
      const { ali, aliLabel, brobotTools, adaTools } = await aChainOfThree()
      const refused = await callOn(brobotTools, 'message_agent', {
        agent: ali,
        kind: 'follow-up',
        piece: aliLabel,
        text: 'build the settings page too',
      })
      expect(refused.outcome, JSON.stringify(refused)).toBe('refused')
      expect(refused.rail).toBe('not-a-piece-you-gave')

      const given = await callOn(adaTools, 'message_agent', {
        agent: ali,
        kind: 'follow-up',
        piece: aliLabel,
        text: 'build the settings page too',
      })
      expect(given.outcome, JSON.stringify(given)).toBe('ok')
    })
  })

  describe('§4 · a reach past a manager is visible to the manager', () => {
    it('🔴 Ada can read that her worker was stopped, and that BroBot did it', async () => {
      const { brobot, ada, ali, aliHandle, brobotTools } = await aChainOfThree()
      await makeItWork(aliHandle)
      expect(
        (await callOn(brobotTools, 'interrupt_agent', { agent: ali, reason: 'stop' })).outcome,
      ).toBe('ok')
      await waitFor(
        () => ledger(ali).some((event) => event.type === 'work_interrupted'),
        'the ask to reach the grandchild',
      )

      const card = host.agentCard(ali, asAgent(ada), ada)
      expect(card, 'Ada cannot read her own worker’s card').not.toBeNull()
      expect(card?.lastAskToStop).toMatchObject({ by: 'an-agent', asker: brobot })
      expect(card?.lastAskToStop?.asker).not.toBe(ada)

      expect(card?.lastAskToStop?.asker).toMatch(/^sess_/)
    })
  })

  describe('§5 · the widening is one predicate with one caller', () => {
    const withoutProse = (source: string): string =>
      source.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^[ \t]*\/\/.*$/gm, ' ')

    it('⛔ exactly ONE call site asks the predicate — `mayInterrupt`, which the door and the resolver of its address ask', () => {
      const raw = readFileSync(join(mainRoot, 'runtime/runtime-host.ts'), 'utf8')
      const code = withoutProse(raw)
      const declaration = /^ {2}(?:private |protected |public )?(?:static )?(?:async )?(\w+)\s*\(/
      const inspect = (source: string) => {
        let current: string | null = null
        const asked: string[] = []
        const bodies = new Map<string, string>()
        for (const line of source.split('\n')) {
          if (/^(?:export )?(?:async )?function \w/.test(line)) current = null
          const declared = declaration.exec(line)
          if (declared !== null) current = declared[1] ?? null
          if (current !== null) bodies.set(current, `${bodies.get(current) ?? ''}${line}\n`)
          if (/\bmayInterruptDownTheChain\((?:\w|\s*$)/.test(line) && current !== null)
            asked.push(current)
        }
        return { asked, bodies }
      }
      const { asked, bodies } = inspect(code)
      expect(asked).toEqual(['mayInterrupt'])
      const oneCondition =
        /mayCommand\(this\.commandedNow\(target\), by\)\)\s*(?:\|\||&&)\s*!?mayInterruptDownTheChain\(\s*by,\s*this\.ancestorsAsItWillRun\(sessionId\)/
      for (const name of asked) expect(bodies.get(name), name).toMatch(oneCondition)
      const askers = [...bodies.entries()]
        .filter(([, body]) => /\bthis\.mayInterrupt\(/.test(body))
        .map(([name]) => name)
        .sort()
      expect(askers).toEqual([
        'interruptAgent',
        'messageAgentNow',
        'stopForAnAnswer',
        'theConversationAddressed',
      ])
      const contaminated = `${raw}\n// mayInterruptDownTheChain(decoy)\n/* mayInterruptDownTheChain(decoy) */`
      expect(contaminated.match(/mayInterruptDownTheChain/g)?.length ?? 0).toBeGreaterThan(
        raw.match(/mayInterruptDownTheChain/g)?.length ?? 0,
      )
      expect(withoutProse(contaminated).trim()).toBe(code.trim())
      expect(inspect(withoutProse(contaminated)).asked).toEqual(asked)
      const header = 'export class RuntimeHost implements LiveHost {'
      expect(raw).toContain(header)
      const extra = raw.replace(
        header,
        `${header}\n  unexpectedCaller() {\n    mayInterruptDownTheChain(decoy)\n  }`,
      )
      expect(extra).not.toBe(raw)
      expect(inspect(withoutProse(extra)).asked).toEqual(['unexpectedCaller', ...asked])
    })

    it('⛔ the model-facing sentence of the verb names the chain and not *you created*', () => {
      for (const name of ['interrupt_agent'] as const) {
        const said = agentToolsFor(host, 'sess_none').tools.find(
          (one) => one.name === name,
        )?.description
        expect(said, `${name} has no description`).toBeTruthy()
        expect(said, name).toContain('below you')
        expect(said, name).not.toContain('an agent you created')
      }
    })

    it('⛔ the predicate admits NO caller that is not a conversation, and no empty chain', () => {
      expect(mayInterruptDownTheChain({ ownerId: 'webContents:1' }, ['sess_a'])).toBe(false)
      expect(mayInterruptDownTheChain(THE_APP_ITSELF, ['sess_a'])).toBe(false)
      expect(mayInterruptDownTheChain(asAgent('sess_a'), [])).toBe(false)
      expect(mayInterruptDownTheChain(asAgent('sess_a'), ['sess_b', 'sess_a'])).toBe(true)
    })
  })

  describe('§6 · a conversation that names itself', () => {
    const callWithText = async (
      toolset: AgentToolset,
      name: ToolName,
      args: Record<string, unknown>,
    ): Promise<{ structured: Record<string, unknown>; text: string }> => {
      const tool = toolset.tools.find((one) => one.name === name)
      if (tool === undefined) throw new Error(`no such tool: ${name}`)
      const result = await tool.call(args)
      return { structured: result.structured as Record<string, unknown>, text: result.text }
    }

    it('🔴 F091 · its id, a piece it holds and its own root name this conversation: nothing is interrupted, and the acts are its own', async () => {
      const { brobot, ada, ali, aliLabel, aliHandle, brobotTools, adaTools, pmProfile } =
        await aChainOfThree()
      await makeItWork(aliHandle)
      const adaLabel = store.piecesOwnedBy(ada)[0]?.label
      expect(typeof adaLabel).toBe('string')
      const aliTools = agentToolsFor(host, ali)
      const brobotsRoot = store.rootOf(brobot)?.label
      if (brobotsRoot === undefined) throw new Error('a conversation a person opened owns a root')
      const readPiece = host.pieceRecord.bind(host)
      vi.spyOn(host, 'pieceRecord').mockImplementation((caller, named) => {
        const record = readPiece(caller, named)
        const ownRoot = caller === brobot && named === brobotsRoot
        if (!ownRoot || record.is === 'no-piece-by-that-name') return record
        return {
          ...record,
          children: record.children.map((child) => {
            if (child.owner !== ada) return child
            return { ...child, state: 'working' as const }
          }),
        }
      })
      const premise = host.pieceRecord(brobot, brobotsRoot)
      expect(premise.is).not.toBe('no-piece-by-that-name')
      if (premise.is === 'no-piece-by-that-name') throw new Error('the caller owns this root')
      expect(premise.children.find((child) => child.owner === ada)?.state).toBe('working')
      for (const [tools, named, itself] of [
        [aliTools, ali, ali],
        [aliTools, aliLabel, ali],
        [brobotTools, brobotsRoot, brobot],
      ] as const) {
        const said = await callWithText(tools, 'interrupt_agent', { agent: named, reason: 'stop' })
        const guide =
          named === aliLabel
            ? ` ${aliLabel} is your own piece, with no helpers recorded under it. list_agents names who you can reach.`
            : named === brobotsRoot
              ? ` ${brobotsRoot} is your own piece. Its helpers: Ada (${pmProfile}) on ${adaLabel} (working). Reach a helper by its piece's label, even after it ended: message_agent with kind: note, or ask_question. For new work, give_work with its profile. To stop a helper below you, interrupt_agent with its label.`
              : ''
        expect(said.structured, named).toMatchObject({
          outcome: 'refused',
          rail: 'that-agent-is-you',
          permanence: 'permanent',
          retryable: false,
          remedy: null,
          reason: A_CONVERSATION_CANNOT_INTERRUPT_ITSELF + guide,
          detail: { agent: itself },
        })
        expect(said.text, named).toBe(
          `refused (that-agent-is-you): ${A_CONVERSATION_CANNOT_INTERRUPT_ITSELF}${guide} ${permanenceInWords('that-agent-is-you', 'permanent')}`,
        )
        expect(
          said.text.slice(
            0,
            `refused (that-agent-is-you): ${A_CONVERSATION_CANNOT_INTERRUPT_ITSELF}`.length,
          ),
          named,
        ).not.toContain('message_agent')
      }
      expect(aliHandle.status()).toBe('working')
      expect(ledger(ali).some((event) => event.type === 'work_interrupted')).toBe(false)
      const other = await aChainOfThree()
      await makeItWork(other.aliHandle)
      expect(
        await callOn(aliTools, 'interrupt_agent', { agent: other.ali, reason: 'stop' }),
      ).toMatchObject({ outcome: 'refused', rail: 'not-below-you' })
      expect(
        (await callOn(adaTools, 'interrupt_agent', { agent: ali, reason: 'stop' })).outcome,
      ).toBe('ok')
    })

    it('🔴 F091 · a conversation in another’s place: that one’s id and its piece name this conversation too — at interrupt_agent and at message_agent', async () => {
      const { ali, aliLabel, adaTools } = await aChainOfThree()
      await host.close(ali, THE_APP_ITSELF)
      await waitFor(
        () =>
          ![...host.resumableSessions()].some(
            (row) => row.sessionId === ali && row.running !== 'not-running',
          ),
        'Ali to stop',
      )
      issued.forgetAll()
      const woken = await callOn(adaTools, 'message_agent', {
        agent: ali,
        kind: 'follow-up',
        piece: aliLabel,
        text: 'carry on',
      })
      expect(woken.outcome, JSON.stringify(woken)).toBe('ok')
      const next = woken.went_to as string
      expect(typeof next).toBe('string')
      expect(next).not.toBe(ali)
      const nextTools = agentToolsFor(host, next)
      for (const named of [ali, aliLabel, next]) {
        const guide =
          named === aliLabel
            ? ` ${aliLabel} is your own piece, with no helpers recorded under it. list_agents names who you can reach.`
            : ''
        expect(
          await callOn(nextTools, 'interrupt_agent', { agent: named, reason: 'stop' }),
          named,
        ).toMatchObject({
          outcome: 'refused',
          rail: 'that-agent-is-you',
          reason: A_CONVERSATION_CANNOT_INTERRUPT_ITSELF + guide,
        })
        expect(
          await callOn(nextTools, 'message_agent', { kind: 'note', agent: named, text: 'hello' }),
          named,
        ).toMatchObject({
          outcome: 'refused',
          rail: 'that-agent-is-you',
          reason: refuseTool('that-agent-is-you').reason + guide,
        })
      }
      expect(
        await callOn(adaTools, 'message_agent', { agent: ali, kind: 'note', text: 'and this' }),
      ).toMatchObject({ outcome: 'ok', went_to: next })
      expect(
        await callOn(adaTools, 'interrupt_agent', { agent: ali, reason: 'stop' }),
      ).toMatchObject({ outcome: 'ok', agent: next })
    })
  })
})
