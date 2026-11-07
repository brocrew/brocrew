import { ToolWatchingRuntime } from './lib/provider-double'
import {
  fixtureProviderConfig,
  neutralHostDeps,
  RecordingSink,
  syntheticProviderHome,
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
import { DEFAULT_PROFILE_ID } from '../src/shared/runtime-ipc'


const here = dirname(fileURLToPath(import.meta.url))
const migrationsFolder = join(here, '../src/main/db/migrations')
const mainRoot = join(here, '../src/main')

describe('431 · the message that crosses a project', () => {
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
    userData = mkdtempSync(join(tmpdir(), 'brobot2-crossing-'))
    root = mkdtempSync(join(tmpdir(), 'brobot2-crossing-root-'))
    elsewhere = mkdtempSync(join(tmpdir(), 'brobot2-crossing-elsewhere-'))
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

  const eventKinds = (sessionId: string): string[] =>
    store.events(sessionId).map((one) => one.event.type)

  const reach = (
    profileSlug: string,
    edit: { canMessage?: string; canAssignWork?: string },
  ): void => {
    expect(store.setCapabilities(profileSlug, edit as never)).toBe(true)
  }

  const aManagerInAnotherProject = async (): Promise<{
    brobot: string
    brobotTools: AgentToolset
    manager: string
  }> => {
    const manager = await personOpens('pm')
    const brobot = await personOpens(DEFAULT_PROFILE_ID)
    const brobotTools = theToolsetJustHandedOut()
    expect(store.parentOf(manager)).toBeNull()
    expect((await host.interruptAgent(manager, speakingAs(brobot))).ok).toBe(false)
    return { brobot, brobotTools, manager }
  }

  const aChildOfBroBot = async (
    brobotTools: AgentToolset,
  ): Promise<{ child: string; childTools: AgentToolset; label: string }> => {
    await personOpens('worker')
    const given = await callOn(brobotTools, 'give_work', {
      definition_of_done: 'The requested result and its checks are recorded.',
      profile: 'worker',
      title: 'the work',
      brief: 'do the thing',
    })
    expect(given.outcome, JSON.stringify(given)).toBe('ok')
    expect(given.started, JSON.stringify(given)).toBe(true)
    const child = given.agent as string
    return { child, childTools: theToolsetJustHandedOut(), label: given.label as string }
  }

  const workGivenIn = (sessionId: string): unknown[] =>
    store
      .events(sessionId)
      .map((one) => one.event)
      .filter((event) => event.type === 'work_given')


  describe('§1 · the four cases, and not one hand-written binding', () => {
    it('🔴 BroBot reaches a manager a person opened, and a `none` identity does not', async () => {
      const { brobot, brobotTools, manager } = await aManagerInAnotherProject()

      expect(store.capabilitiesOf(DEFAULT_PROFILE_ID)?.canMessage).toBe('any')
      const reached = await callOn(brobotTools, 'message_agent', {
        agent: manager,
        text: 'what is this project up to?',
        kind: 'note',
      })
      expect(reached, JSON.stringify(reached)).toMatchObject({ outcome: 'ok', agent: manager })
      expect(eventKinds(manager)).toContain('user_turn')

      const other = await personOpens('explorer')
      const otherTools = theToolsetJustHandedOut()
      reach('explorer', { canMessage: 'none' })
      expect(store.capabilitiesOf('explorer')?.canMessage).toBe('none')
      const refused = await callOn(otherTools, 'message_agent', {
        agent: manager,
        text: 'what is this project up to?',
        kind: 'note',
      })
      expect(refused, JSON.stringify(refused)).toMatchObject({
        outcome: 'refused',
        rail: 'may-not-message',
        permanence: 'until-a-person-changes-it',
        retryable: false,
      })
      expect(eventKinds(manager).filter((kind) => kind === 'user_turn')).toHaveLength(1)
      expect(brobot).not.toBe(other)
    })



    it('🔴 the reach follows the grant, not the identity — narrowed it refuses, granted it admits', async () => {
      const { brobotTools, manager } = await aManagerInAnotherProject()
      const asking = { agent: manager, text: 'how is it going?', kind: 'note' }
      reach(DEFAULT_PROFILE_ID, { canMessage: 'none' })
      expect(await callOn(brobotTools, 'message_agent', asking)).toMatchObject({
        outcome: 'refused',
        rail: 'may-not-message',
      })
      reach(DEFAULT_PROFILE_ID, { canMessage: 'any' })
      expect(await callOn(brobotTools, 'message_agent', asking)).toMatchObject({ outcome: 'ok' })

      await personOpens('explorer')
      const otherTools = theToolsetJustHandedOut()
      reach('explorer', { canMessage: 'none' })
      expect(await callOn(otherTools, 'message_agent', asking)).toMatchObject({
        outcome: 'refused',
        rail: 'may-not-message',
      })
      reach('explorer', { canMessage: 'any' })
      expect(await callOn(otherTools, 'message_agent', asking)).toMatchObject({ outcome: 'ok' })
    })

    it('🔴 a narrowed identity is told two different things, and which one depends on what it started', async () => {
      const { brobotTools, manager } = await aManagerInAnotherProject()
      const asking = { agent: manager, text: 'how is it going?', kind: 'note' }
      expect(await callOn(brobotTools, 'message_agent', asking)).toMatchObject({ outcome: 'ok' })

      const { child } = await aChildOfBroBot(brobotTools)

      reach(DEFAULT_PROFILE_ID, { canMessage: 'none' })
      for (const args of [asking, { agent: child, text: 'do the thing' }]) {
        const refused = await callOn(brobotTools, 'message_agent', args)
        expect(refused, JSON.stringify(refused)).toMatchObject({
          outcome: 'refused',
          rail: 'may-not-message',
          permanence: 'until-a-person-changes-it',
        })
      }
      expect((await callOn(brobotTools, 'get_agent_status', { agent: child })).outcome).toBe('ok')
      expect(await callOn(brobotTools, 'get_agent_status', { agent: manager })).toMatchObject({
        outcome: 'refused',
        rail: 'may-not-message',
      })
    })
  })


  describe('§2 · what the reach did NOT widen', () => {
    it('⛔ `interrupt_agent` still refuses it, with the message reach at its widest', async () => {
      const { brobotTools, manager } = await aManagerInAnotherProject()
      reach(DEFAULT_PROFILE_ID, { canMessage: 'any' })
      expect(
        await callOn(brobotTools, 'message_agent', {
          agent: manager,
          text: 'x',
          kind: 'note',
        }),
      ).toMatchObject({ outcome: 'ok' })
      expect(
        await callOn(brobotTools, 'interrupt_agent', { agent: manager, reason: 'stop' }),
      ).toMatchObject({ outcome: 'refused', rail: 'not-below-you' })
      expect(host.sessionIds).toContain(manager)
    })

    it('⚑ `list_agents` and `get_agent_status` now name exactly what the send admits', async () => {
      const { brobot, brobotTools, manager } = await aManagerInAnotherProject()
      reach(DEFAULT_PROFILE_ID, { canMessage: 'any' })
      const listed = (await callOn(brobotTools, 'list_agents', {})) as {
        agents: { agent: string }[]
      }
      expect(listed.agents.map((one) => one.agent).sort()).toEqual([brobot, manager].sort())
      expect(await callOn(brobotTools, 'get_agent_status', { agent: manager })).toMatchObject({
        outcome: 'ok',
        agent: { agent: manager },
      })
      expect(
        await callOn(brobotTools, 'message_agent', {
          agent: manager,
          text: 'x',
          kind: 'note',
        }),
      ).toMatchObject({ outcome: 'ok' })
    })

    it('🔴 a give files a piece in the RECEIVER’s ledger, and only in a conversation the giver started', async () => {
      const { brobot, brobotTools, manager } = await aManagerInAnotherProject()
      expect(store.capabilitiesOf(DEFAULT_PROFILE_ID)?.canAssignWork).toBe('any')
      const toTheManagersProfile = await callOn(brobotTools, 'give_work', {
        definition_of_done: 'The requested result and its checks are recorded.',
        profile: 'pm',
        title: 'the thing',
        brief: 'do the thing',
      })
      expect(toTheManagersProfile, JSON.stringify(toTheManagersProfile)).toMatchObject({
        outcome: 'ok',
        started: true,
      })
      expect(toTheManagersProfile.agent).not.toBe(manager)
      expect(store.parentOf(toTheManagersProfile.agent as string)).toBe(brobot)
      expect(workGivenIn(manager)).toHaveLength(0)

      const { child, label } = await aChildOfBroBot(brobotTools)

      const given = workGivenIn(child)
      expect(given).toHaveLength(1)
      expect(given[0]).toMatchObject({ givenBy: brobot, label })
      expect(workGivenIn(brobot)).toHaveLength(0)

      await personOpens('explorer')
      expect(store.capabilitiesOf('explorer')?.canAssignWork).toBe('any')
      const second = await callOn(theToolsetJustHandedOut(), 'give_work', {
        definition_of_done: 'The requested result and its checks are recorded.',
        profile: 'worker',
        title: 'and this too',
        brief: 'and this too',
      })
      expect(second, JSON.stringify(second)).toMatchObject({ outcome: 'ok', started: true })
      expect(second.agent).not.toBe(child)
      expect(workGivenIn(child)).toHaveLength(1)
      expect(
        await callOn(brobotTools, 'message_agent', {
          agent: child,
          text: 'how is it going?',
          kind: 'follow-up',
          piece: label,
        }),
      ).toMatchObject({ outcome: 'ok' })
      expect(workGivenIn(child)).toHaveLength(1)
    })

    it('⚠️ the reply to cross-project work lands back, from an identity granted no reach at all', async () => {
      const { brobot, brobotTools } = await aManagerInAnotherProject()
      const { childTools, label } = await aChildOfBroBot(brobotTools)
      const mine = (await callOn(childTools, 'list_tasks', {})) as {
        you_hold: { piece: string; label: string }[]
      }
      expect(mine.you_hold.map((one) => one.label)).toEqual([label])

      reach('worker', { canMessage: 'none' })
      const replied = await callOn(childTools, 'reply_to_parent', {
        piece: mine.you_hold[0]?.piece,
        outcome: 'done',
        summary: 'it is finished',
      })
      expect(replied, JSON.stringify(replied)).toMatchObject({ outcome: 'ok' })
      const heard = store
        .events(brobot)
        .map((one) => one.event)
        .filter((event) => event.type === 'user_turn')
      expect(JSON.stringify(heard)).toContain('it is finished')
    })

    it('⛔ the widest reach does not let a conversation queue words into itself', async () => {
      const brobot = await personOpens(DEFAULT_PROFILE_ID)
      const brobotTools = theToolsetJustHandedOut()
      expect(store.capabilitiesOf(DEFAULT_PROFILE_ID)?.canMessage).toBe('any')
      expect(host.withinMessagingReach(brobot, speakingAs(brobot))).toBe(false)
      await expect(host.queueMessage(brobot, 'to myself', speakingAs(brobot))).rejects.toThrow(
        /belongs to another window|held for/i,
      )
      expect(host.withinMessagingReach(brobot, speakingAs(brobot), brobot)).toBe(true)
      expect(
        await callOn(brobotTools, 'message_agent', {
          agent: brobot,
          text: 'to myself',
          kind: 'note',
        }),
      ).toMatchObject({ outcome: 'refused', rail: 'that-agent-is-you' })
      expect(eventKinds(brobot).length).toBeGreaterThan(0)
      expect(eventKinds(brobot)).not.toContain('user_turn')
    })

    it('⛔ a caller with no identity row reaches nothing, and the same call from a placed one does', async () => {
      const { brobot, manager } = await aManagerInAnotherProject()
      expect(host.withinMessagingReach(manager, speakingAs(brobot))).toBe(true)
      db.prepare('UPDATE provider_session SET agent_identity_id = NULL WHERE id = ?').run(brobot)
      expect(store.identityOf(brobot)).toBeNull()
      expect(host.withinMessagingReach(manager, speakingAs(brobot))).toBe(false)
    })

    it('⛔ a placed caller whose IDENTITY row cannot be read is refused, not given the defaults', async () => {
      const { brobot, manager } = await aManagerInAnotherProject()
      expect(store.capabilitiesOf(DEFAULT_PROFILE_ID)?.canMessage).toBe('any')
      expect(host.withinMessagingReach(manager, speakingAs(brobot))).toBe(true)

      db.prepare(
        `UPDATE agent_identity SET slug = 'no-such-identity'
           WHERE id = (SELECT agent_identity_id FROM provider_session WHERE id = ?)`,
      ).run(brobot)
      expect(store.identityOf(brobot)?.profileSlug).toBe('no-such-identity')
      expect(store.capabilitiesOf('no-such-identity')).toBeNull()
      expect(host.withinMessagingReach(manager, speakingAs(brobot))).toBe(false)
    })
  })


  describe('§3 · the opt-in, as source', () => {

    it('⛔ the two send verbs and the move press ask `requireToMessage`, and the readers ask it too since `433`', () => {
      const code = withoutProse(readFileSync(join(mainRoot, 'runtime/runtime-host.ts'), 'utf8'))
      expect(code.match(/requireToMessage\(/g)).toHaveLength(5)
      expect(code.match(/this\.requireToMessage\(offer\.destination, by\)/g)).toHaveLength(2)
      expect(code.match(/this\.requireToMessage\(sessionId, by[,)]/g)).toHaveLength(2)
      expect(code.match(/this\.requireToCommand\(/g)).toHaveLength(4)
      expect(code).toContain('.filter((slot) => this.withinMessagingReach(slot.id, by, me))')
      expect(code).toContain('if (!this.withinMessagingReach(sessionId, by, me)) return null')
      const raw = readFileSync(join(mainRoot, 'runtime/runtime-host.ts'), 'utf8')
      expect(raw.match(/requireToMessage/g)?.length ?? 0).toBeGreaterThan(
        code.match(/requireToMessage/g)?.length ?? 0,
      )
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
