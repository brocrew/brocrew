import { ToolWatchingRuntime } from './lib/provider-double'
import {
  neutralHostDeps,
  RecordingSink,
  syntheticProviderHome,
  fixtureProviderConfig,
} from './lib/host-fixture'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { FakeProviderSessions } from '@brobot2/runtime'
import type { AgentToolset } from '@brobot2/runtime'
import type { Provider } from '@brobot2/shared'
import { type AppDatabase, openDatabase } from '../src/main/db/connection'
import { applyMigrations } from '../src/main/db/migrate'
import { createSessionStore, type SessionStore } from '../src/main/db/session-store'
import { RuntimeHost } from '../src/main/runtime/runtime-host'
import type { CallerIdentity } from '../src/main/runtime/runtime-host'
import { agentCallerId } from '../src/main/runtime/agent-tools'
import { executeRuntimeCommand } from '../src/main/runtime/ipc'
import { resolveSessionCwd } from '../src/main/runtime/scratch-cwd'
import {
  CAPABILITY_FIELDS,
  ASSIGNMENT_REACH_ADMITS,
  MESSAGING_REACH,
  type MessagingReach,
  MESSAGING_REACH_ADMITS,
  capabilityField,
  type AnyCapabilityField,
} from '../src/shared/capabilities'
import { reachesWhatItDidNotStart, refuseOutOfReach } from '../src/main/runtime/message-rails'
import { DEFAULT_PROFILE_ID } from '../src/shared/runtime-ipc'
import { agentStateWords } from '../src/shared/agent-state'


const here = dirname(fileURLToPath(import.meta.url))
const migrationsFolder = join(here, '../src/main/db/migrations')
const mainRoot = join(here, '../src/main')

describe('433 §B · the agents a reach can see', () => {
  let userData: string
  let root: string
  let elsewhere: string
  let db: AppDatabase
  let store: SessionStore
  let host: RuntimeHost
  let hosts: RuntimeHost[]
  let handed: AgentToolset[]
  let issued: FakeProviderSessions
  let counter: number
  let clock: number
  let window: RecordingSink
  const tick = (): number => clock++

  const buildHost = (): RuntimeHost => {
    const built = new RuntimeHost({
      store,
      ...neutralHostDeps(() => userData),
      createRuntime: (provider: Provider) => new ToolWatchingRuntime(provider, handed, issued),
      prepareProviderHome: syntheticProviderHome(() => userData),
      providerHomePath: (provider: Provider) => join(userData, 'provider-homes', provider),
      resolveCwd: (sessionId, requested) => resolveSessionCwd(userData, sessionId, requested),
      newSessionId: () => `sess_${++counter}`,
      now: tick,
      readProviderConfig: fixtureProviderConfig,
    })
    hosts.push(built)
    return built
  }

  beforeEach(() => {
    userData = mkdtempSync(join(tmpdir(), 'brobot2-seeing-'))
    root = mkdtempSync(join(tmpdir(), 'brobot2-seeing-root-'))
    elsewhere = mkdtempSync(join(tmpdir(), 'brobot2-seeing-elsewhere-'))
    db = openDatabase(join(userData, 'brobot2.sqlite'))
    applyMigrations(db, migrationsFolder)
    clock = Date.UTC(2030, 0, 1)
    store = createSessionStore(db, tick)
    counter = 0
    hosts = []
    handed = []
    issued = new FakeProviderSessions()
    host = buildHost()
    window = new RecordingSink('webContents:1')
  })

  afterEach(async () => {
    for (const built of hosts) await built.closeAll()
    db.close()
    for (const dir of [userData, root, elsewhere]) rmSync(dir, { recursive: true, force: true })
  })

  const ask = (command: Parameters<typeof executeRuntimeCommand>[2]): Promise<unknown> =>
    executeRuntimeCommand(host, window, command)

  const personOpens = async (profileId: string): Promise<string> => {
    const opened = (await ask({
      kind: 'createSession',
      provider: 'claude',
      profileId,
      approvalMode: 'ask',
      cwd: root,
    })) as { sessionId: string }
    return opened.sessionId
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

  const theToolsetJustHandedOut = (): AgentToolset => {
    const last = handed.at(-1)
    if (last === undefined) throw new Error('no toolset was handed to that launch')
    return last
  }

  const speakingAs = (sessionId: string): CallerIdentity => ({ ownerId: agentCallerId(sessionId) })

  const idsListedBy = async (toolset: AgentToolset): Promise<string[]> => {
    const listed = (await callOn(toolset, 'list_agents', {})) as { agents: { agent: string }[] }
    return listed.agents.map((one) => one.agent).sort()
  }

  const twoCallersAndOneTarget = async (): Promise<{
    brobot: string
    brobotTools: AgentToolset
    explorer: string
    explorerTools: AgentToolset
    manager: string
  }> => {
    const manager = await personOpens('pm')
    const brobot = await personOpens(DEFAULT_PROFILE_ID)
    const brobotTools = theToolsetJustHandedOut()
    const explorer = await personOpens('explorer')
    const explorerTools = theToolsetJustHandedOut()
    expect(store.setCapabilities('explorer', { canMessage: 'none' })).toBe(true)
    expect(store.capabilitiesOf(DEFAULT_PROFILE_ID)?.canMessage).toBe('any')
    expect(store.capabilitiesOf('explorer')?.canMessage).toBe('none')
    expect(store.parentOf(manager)).toBeNull()
    expect((await host.interruptAgent(manager, speakingAs(brobot))).ok).toBe(false)
    expect((await host.interruptAgent(manager, speakingAs(explorer))).ok).toBe(false)
    return { brobot, brobotTools, explorer, explorerTools, manager }
  }


  describe('§1 · the ruling, as two callers over one target', () => {
    it('🔴 the granted caller sees the foreign conversation and the narrow one does not', async () => {
      const { brobot, brobotTools, explorer, explorerTools, manager } =
        await twoCallersAndOneTarget()

      expect(await idsListedBy(brobotTools)).toEqual([brobot, explorer, manager].sort())
      expect(await callOn(brobotTools, 'get_agent_status', { agent: manager })).toMatchObject({
        outcome: 'ok',
        agent: { agent: manager },
      })

      expect(await idsListedBy(explorerTools)).toEqual([explorer])
      expect(await callOn(explorerTools, 'get_agent_status', { agent: manager })).toMatchObject({
        outcome: 'refused',
        rail: 'may-not-message',
        permanence: 'until-a-person-changes-it',
      })
    })

    it('⛔ an unentitled caller is told its reach about a real foreign conversation, and nothing about it', async () => {
      const { explorer, explorerTools, manager } = await twoCallersAndOneTarget()
      const aboutTheReal = await callOn(explorerTools, 'get_agent_status', { agent: manager })
      const aboutAGhost = await callOn(explorerTools, 'get_agent_status', {
        agent: 'sess_nobody_ever_opened',
      })
      expect(aboutTheReal).toMatchObject({
        outcome: 'refused',
        rail: 'may-not-message',
      })
      expect(aboutAGhost).toMatchObject({ outcome: 'refused', rail: 'no-such-agent' })
      expect(aboutTheReal).not.toHaveProperty('agent')
      expect(aboutTheReal['detail']).toStrictEqual({ reach: 'none', agent: manager })
      expect(
        await callOn(explorerTools, 'message_agent', {
          agent: manager,
          text: 'anything at all',
          kind: 'note',
        }),
      ).toStrictEqual({ ...aboutTheReal, detail: { reach: 'none' } })
      const listed = await idsListedBy(explorerTools)
      expect(listed).toContain(explorer)
      expect(listed).not.toContain(manager)
      expect(listed).not.toContain('sess_nobody_ever_opened')
    })

    it('🔴 the card reader answers for exactly the ids the send door does not refuse', async () => {
      const { brobot, brobotTools, explorer, explorerTools, manager } =
        await twoCallersAndOneTarget()
      expect(host.mayReachAtAll('message', speakingAs(brobot))).toBeNull()
      expect(host.mayReachAtAll('message', speakingAs(explorer))?.rail).toBe('may-not-message')
      const ghost = 'sess_nobody_ever_opened'
      const targets = [brobot, explorer, manager, ghost]
      const entitlement = [
        refuseOutOfReach(null).rail,
        'no-such-agent',
        'that-conversation-takes-no-messages',
      ]

      for (const [who, tools] of [['brobot', brobotTools]] as const) {
        for (const target of targets) {
          const seen = await callOn(tools, 'get_agent_status', { agent: target })
          const sent = await callOn(tools, 'message_agent', {
            agent: target,
            text: 'anything at all',
            kind: 'note',
          })
          const pair = `${who} → ${target}: saw ${JSON.stringify(seen)}, sent ${JSON.stringify(sent)}`
          if (seen.outcome === 'ok') expect(entitlement, pair).not.toContain(sent.rail)
          else expect(sent, pair).toStrictEqual(seen)
        }
      }

      expect(await callOn(brobotTools, 'get_agent_status', { agent: manager })).toMatchObject({
        outcome: 'ok',
      })
      expect(await callOn(brobotTools, 'get_agent_status', { agent: ghost })).toMatchObject({
        outcome: 'refused',
        rail: 'no-such-agent',
      })
      expect(await callOn(explorerTools, 'get_agent_status', { agent: manager })).toMatchObject({
        outcome: 'refused',
      })
    })

    it('⛔ each reader promises NAMING, and `list_agents` says that seeing is not sending', async () => {
      const { brobotTools } = await twoCallersAndOneTarget()
      const saidBy = (name: string): string => {
        const tool = brobotTools.tools.find((one) => one.name === name)
        if (tool === undefined) throw new Error(`no such tool: ${name}`)
        return tool.description
      }
      expect(saidBy('list_agents')).toContain(
        'Being listed is not a promise that every message to it is admitted — message_agent answers that separately.',
      )
      expect(saidBy('list_agents')).toContain('message_agent')
      expect(saidBy('get_agent_status')).toContain('list_agents')
      expect(saidBy('get_agent_status')).toContain('any conversation you may reach')
      expect(saidBy('interrupt_agent')).not.toContain('Being listed is not a promise')
    })

    it('⛔ seeing is not sending: the caller’s own row is listed and permanently refused', async () => {
      const { brobot, brobotTools } = await twoCallersAndOneTarget()
      expect(await idsListedBy(brobotTools)).toContain(brobot)
      expect(
        await callOn(brobotTools, 'message_agent', {
          agent: brobot,
          text: 'hello me',
          kind: 'note',
        }),
      ).toMatchObject({ outcome: 'refused', rail: 'that-agent-is-you', permanence: 'permanent' })
      const { manager } = {
        manager: (await idsListedBy(brobotTools)).filter((id) => id !== brobot)[0] as string,
      }
      expect(
        await callOn(brobotTools, 'message_agent', {
          agent: manager,
          text: 'hello you',
          kind: 'note',
        }),
      ).toMatchObject({ outcome: 'ok' })
    })

    it('🔴 the grant sheet’s own help text names BOTH things this control now decides', () => {
      const field = CAPABILITY_FIELDS.find((one) => one.key === 'canMessage')
      expect(field, 'the field this whole suite is about is gone').toBeDefined()
      const help = field?.help ?? ''
      expect(help).toContain('send a message to')
      expect(help).toContain('list and ask about')
      expect(capabilityField('canAssignWork').help).not.toContain('list and ask about')
    })

    it('⚑ the card `get_agent_status` answers is the card `list_agents` names', async () => {
      const { brobotTools, manager } = await twoCallersAndOneTarget()
      const listed = (await callOn(brobotTools, 'list_agents', {})) as {
        agents: { agent: string }[]
      }
      const inTheList = listed.agents.find((one) => one.agent === manager)
      const oneByOne = (await callOn(brobotTools, 'get_agent_status', { agent: manager })) as {
        agent: unknown
      }
      expect(inTheList).toBeDefined()
      expect(oneByOne.agent).toEqual(inTheList)
    })
  })


  describe('§2 · the card, whole', () => {
    it('🔴 a card asked from across is the card its own side sees', async () => {
      const { brobotTools, manager } = await twoCallersAndOneTarget()
      const fromAcross = (await callOn(brobotTools, 'get_agent_status', { agent: manager })) as {
        agent: { whose: { profile?: string } }
      }
      expect(fromAcross.agent.whose.profile).toBe('pm')
      const itsOwn = host.agentCard(manager, speakingAs(manager), manager)
      expect(itsOwn).not.toBeNull()
      if (itsOwn === null) throw new Error('unreachable')
      expect({ ...itsOwn, state: agentStateWords(itsOwn.state) }).toEqual(fromAcross.agent)
    })

  })


  describe('§3 · the verbs, and the predicate they still ask', () => {
    it('⛔ `withdraw_task` names a piece, and a caller that can see the conversation still cannot take its work back', async () => {
      const { brobotTools, explorerTools, manager } = await twoCallersAndOneTarget()
      const itsRoot = store.rootOf(manager)
      expect(itsRoot, 'a conversation a person opened owns a root').not.toBeNull()
      expect(itsRoot?.givenBy).toBeNull()
      expect(await callOn(brobotTools, 'get_agent_status', { agent: manager })).toMatchObject({
        outcome: 'ok',
      })
      const refused = await callOn(brobotTools, 'withdraw_task', { piece: itsRoot?.label })
      expect(refused, JSON.stringify(refused)).toMatchObject({
        outcome: 'refused',
        rail: 'not-a-piece-you-gave',
      })
      expect(await callOn(explorerTools, 'withdraw_task', { piece: itsRoot?.label })).toMatchObject(
        { outcome: 'refused', rail: 'not-a-piece-you-gave' },
      )
    })

    it('🔴 exactly six call sites ask `mayCommand`, and the two readers are not among them', () => {
      const raw = readFileSync(join(mainRoot, 'runtime/runtime-host.ts'), 'utf8')
      const code = withoutProse(raw)
      const lines = code.split('\n')
      const declaration = /^ {2}(?:private |protected |public )?(?:static )?(?:async )?(\w+)\s*\(/
      let current: string | null = null
      const asked: string[] = []
      for (const line of lines) {
        const declared = declaration.exec(line)
        if (declared !== null) current = declared[1] ?? null
        if (/\bmayCommand\(\w/.test(line) && current !== null) {
          asked.push(current)
        }
      }
      expect(asked.sort()).toEqual(
        [
          'withinMessagingReach',
          'whereItsHolderStands',
          'mayInterrupt',
          'assertMayCommand',
          'assertMayAnswer',
          'aPersonsRequestNobodyHolds',
        ].sort(),
      )

      const callersOf = (gate: string): string[] => {
        const found: string[] = []
        let inside: string | null = null
        for (const line of lines) {
          const declared = declaration.exec(line)
          if (declared !== null) inside = declared[1] ?? null
          if (line.includes(`this.${gate}(`) && inside !== null && inside !== gate) {
            found.push(inside)
          }
        }
        return found
      }
      const questions = [
        ...asked.filter(
          (each) =>
            ![
              'withinMessagingReach',
              'assertMayCommand',
              'assertMayAnswer',
              'queueAs',
              'aMessageWaitsThere',
              'whereItsHolderStands',
              'mayInterrupt',
              'aPersonsRequestNobodyHolds',
            ].includes(each),
        ),
        ...callersOf('whereItsHolderStands'),
        ...callersOf('mayInterrupt'),
        ...callersOf('requireToMessage'),
        'agentsVisibleTo',
        'agentCard',
        'agentRecord',
        ...callersOf('requireToCommand'),
        ...callersOf('requireToAnswer'),
      ]
      expect(questions.sort()).toEqual(
        [
          'agentCard',
          'agentRecord',
          'agentsVisibleTo',
          'cancelQueuedMessage',
          'closeForAPerson',
          'decideMoveRequest',
          'decideMoveRequest',
          'interrupt',
          'interruptAgent',
          'messageAgentNow',
          'stopForAnAnswer',
          'queueAs',
          'replyToParent',
          'respondPermission',
          'respondUserInput',
          'sendAs',
          'sendInterrupting',
          'takeBackPiece',
          'theConversationAddressed',
          'updateWork',
        ].sort(),
      )
      expect(questions).toHaveLength(20)
      expect(code).toContain('.filter((slot) => this.withinMessagingReach(slot.id, by, me))')
      expect(code).toContain('if (!this.withinMessagingReach(sessionId, by, me)) return null')
      expect(raw.match(/mayCommand/g)?.length ?? 0).toBeGreaterThan(
        code.match(/mayCommand/g)?.length ?? 0,
      )
    })
  })


  describe('§4 · one word, two composites, and the three places that publish it', () => {
    it('⛔ each grant a model reads names what its OWN gate asks, and the sheet says it in the same bytes', () => {
      const said = MESSAGING_REACH_ADMITS.any
      expect(said).toContain('whoever started it')
      const capabilitiesSource = readFileSync(join(here, '../src/shared/capabilities.ts'), 'utf8')
      const declaredFrom = (key: string): string | null => {
        const at = capabilitiesSource.indexOf(`    key: '${key}',`)
        if (at < 0) return null
        const body = capabilitiesSource.slice(at, capabilitiesSource.indexOf('\n  },', at))
        return /vocabulary: \[\.\.\.(\w+)\]/.exec(body)?.[1] ?? null
      }
      expect(declaredFrom('canCreateAgents')).toBe('CREATION_REACH')
      const everyField: readonly AnyCapabilityField[] = CAPABILITY_FIELDS
      const reachFields = everyField.filter(
        (field) =>
          field.vocabulary !== undefined &&
          [...field.vocabulary].join('|') === [...MESSAGING_REACH].join('|') &&
          declaredFrom(field.key) === 'MESSAGING_REACH',
      )
      expect(reachFields.map((field) => field.key)).toEqual(['canMessage', 'canAssignWork'])
      const SAYS = {
        canMessage: MESSAGING_REACH_ADMITS,
        canAssignWork: ASSIGNMENT_REACH_ADMITS,
      } satisfies Readonly<Record<string, Readonly<Record<MessagingReach, string>>>>
      for (const field of reachFields) {
        const admits = SAYS[field.key as keyof typeof SAYS]
        for (const word of MESSAGING_REACH) {
          expect(field.help, `${field.key} does not say what ${word} reaches`).toContain(
            admits[word],
          )
        }
      }
      expect(ASSIGNMENT_REACH_ADMITS.any).not.toBe(MESSAGING_REACH_ADMITS.any)
      expect(ASSIGNMENT_REACH_ADMITS.any).toBe(
        'any agent — the work goes to a conversation it has with that agent, started for it when needed',
      )
      expect(capabilityField('canCreateAgents').help).not.toContain(said)
      expect(MESSAGING_REACH_ADMITS.none).not.toBe(said)
      expect(ASSIGNMENT_REACH_ADMITS.none).toBe(MESSAGING_REACH_ADMITS.none)
      for (const word of MESSAGING_REACH) {
        expect(ASSIGNMENT_REACH_ADMITS[word], word).not.toContain('many callers')
      }
      expect(SAYS.canAssignWork).not.toBe(SAYS.canMessage)
      expect(reachesWhatItDidNotStart('none')).toBe(false)
      expect(reachesWhatItDidNotStart('any')).toBe(true)
    })
  })
})

function withoutProse(source: string): string {
  let inBlock = false
  return source
    .split('\n')
    .map((raw) => {
      let code = ''
      for (let at = 0; at < raw.length; at += 1) {
        const rest = raw.slice(at)
        if (inBlock) {
          if (!rest.startsWith('*/')) continue
          at += 1
          inBlock = false
          continue
        }
        if (rest.startsWith('//')) break
        if (rest.startsWith('/*')) {
          inBlock = true
          at += 1
          continue
        }
        code += raw[at]
      }
      return code
    })
    .join('\n')
}
