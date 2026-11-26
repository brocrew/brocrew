import {
  RecordingSink,
  syntheticProviderHome,
  neutralHostDeps,
  fixtureProviderConfig,
} from './lib/host-fixture'
import { ToolWatchingRuntime } from './lib/provider-double'
import { textOfTheKeptFile } from './lib/kept-file-named'
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
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
import { resourcesRoot } from '../src/main/resources/resources'
import { executeRuntimeCommand } from '../src/main/runtime/ipc'
import { resolveSessionCwd } from '../src/main/runtime/scratch-cwd'
import { TASK_IS_OPEN } from '../src/shared/tasks'
import { callOn } from './helpers/call-tool'

const here = dirname(fileURLToPath(import.meta.url))
const migrationsFolder = join(here, '../src/main/db/migrations')

// Every fixture plants two conversations that share only their giver, each with its own resource,
// so a read or message across them is a fact about the default reach, not an old one-hop rail.
describe('two withdrawals — open what was scoped', () => {
  let userData: string
  let root: string
  let db: AppDatabase
  let store: SessionStore
  let host: RuntimeHost
  let handed: AgentToolset[]
  let issued: FakeProviderSessions
  let counter: number
  let clock: number
  let window: RecordingSink
  const tick = (): number => clock++
  const kept = (): string => resourcesRoot(userData)

  beforeEach(() => {
    userData = mkdtempSync(join(tmpdir(), 'brobot2-549-'))
    root = mkdtempSync(join(tmpdir(), 'brobot2-549-root-'))
    db = openDatabase(join(userData, 'brobot2.sqlite'))
    applyMigrations(db, migrationsFolder)
    clock = Date.UTC(2030, 0, 1)
    store = createSessionStore(db, tick)
    counter = 0
    handed = []
    issued = new FakeProviderSessions()
    host = new RuntimeHost({
      store,
      ...neutralHostDeps(() => userData),
      resourcesRoot: () => resourcesRoot(userData),
      createRuntime: (provider: Provider) => new ToolWatchingRuntime(provider, handed, issued),
      prepareProviderHome: syntheticProviderHome(() => userData),
      providerHomePath: (provider: Provider) => join(userData, 'provider-homes', provider),
      resolveCwd: (sessionId, requested) => resolveSessionCwd(userData, sessionId, requested),
      newSessionId: () => `sess_${++counter}`,
      now: tick,
      readProviderConfig: fixtureProviderConfig,
    })
    window = new RecordingSink('webContents:1')
  })

  afterEach(async () => {
    await host.closeAll()
    db.close()
    for (const dir of [userData, root]) rmSync(dir, { recursive: true, force: true })
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

  const theToolsetJustHandedOut = (): AgentToolset => {
    const last = handed.at(-1)
    if (last === undefined) throw new Error('no toolset was handed to that launch')
    return last
  }

  const aPieceGiven = async (
    giverTools: AgentToolset,
    profile: string,
    title: string,
  ): Promise<{ agent: string; label: string; tools: AgentToolset }> => {
    await callOn(giverTools, 'create_agent', { profile_slug: profile })
    const given = await callOn(giverTools, 'give_work', {
      definition_of_done: 'The requested result and its checks are recorded.',
      profile,
      title,
      brief: title.toLowerCase(),
      to: 'new',
      conversation_title: title,
    })
    expect(given.outcome, JSON.stringify(given)).toBe('ok')
    return {
      agent: given.agent as string,
      label: given.label as string,
      tools: theToolsetJustHandedOut(),
    }
  }

  const aResourceKept = async (
    replier: { agent: string; label: string; tools: AgentToolset },
    name: string,
    text: string,
  ): Promise<string> => {
    const folder = store.recordedOne(replier.agent)?.cwd
    if (folder === undefined) throw new Error(`${replier.agent} has no folder`)
    writeFileSync(join(folder, name), text)
    const replied = await callOn(replier.tools, 'reply_to_parent', {
      piece: replier.label,
      outcome: 'done',
      summary: `handed back ${name}`,
      resource_paths: [name],
    })
    expect(replied.outcome, JSON.stringify(replied)).toBe('ok')
    const [resource] = replied.resources as string[]
    if (resource === undefined) throw new Error('the reply kept no resource')
    return resource
  }

  const reached = (conversation: string, words: string): boolean =>
    store
      .events(conversation)
      .some(
        (one) =>
          (one.event.type === 'user_turn' || one.event.type === 'message_queued') &&
          one.event.text.includes(words),
      )

  const twoConversations = async (): Promise<{
    deskTools: AgentToolset
    reader: string
    readerTools: AgentToolset
    writer: string
    mine: string
    theirs: string
  }> => {
    const desk = await personOpens('desk')
    const deskTools = theToolsetJustHandedOut()
    const scribe = await aPieceGiven(deskTools, 'scribe', 'Find things')
    const theirs = await aResourceKept(scribe, 'theirs.md', '# what the scribe found\n')
    const inspector = await aPieceGiven(deskTools, 'inspector', 'Inspect things')
    const mine = await aResourceKept(inspector, 'mine.md', '# my own note\n')
    const writer = scribe.agent
    const reader = inspector.agent
    expect(store.identityOf(writer)?.profileSlug).toBe('scribe')
    expect(store.identityOf(reader)?.profileSlug).toBe('inspector')
    expect(store.resource(mine)?.addedBy).toBe(reader)
    expect(store.resource(theirs)?.addedBy).toBe(writer)
    expect(store.parentOf(writer)).toBe(desk)
    expect(store.parentOf(writer)).not.toBe(reader)
    return {
      deskTools,
      reader,
      readerTools: inspector.tools,
      writer,
      mine,
      theirs,
    }
  }

  describe('any agent may read any document', () => {
    it('a conversation that neither wrote it nor started its writer reads it, through the published tool', async () => {
      const { readerTools, mine, theirs } = await twoConversations()

      const across = await callOn(readerTools, 'read_document', { resource: theirs })
      expect(across.outcome, JSON.stringify(across)).toBe('ok')
      const tool = readerTools.tools.find((one) => one.name === 'read_document')
      expect(textOfTheKeptFile((await tool!.call({ resource: theirs })).text)).toBe(
        '# what the scribe found\n',
      )

      const own = await callOn(readerTools, 'read_document', { resource: mine })
      expect(own.outcome, JSON.stringify(own)).toBe('ok')
    })
  })

  describe('reading local edits', () => {
    it('returns edited bytes to a reader who did not write the resource', async () => {
      const { readerTools, mine, theirs } = await twoConversations()
      const row = store.resource(theirs)
      const at = join(kept(), row?.sha256 ?? '', row?.name ?? '')
      expect(existsSync(at), at).toBe(true)
      writeFileSync(at, 'somebody edited this\n')

      const answered = await callOn(readerTools, 'read_document', { resource: theirs })
      expect(answered.outcome).toBe('ok')
      const reader = readerTools.tools.find((tool) => tool.name === 'read_document')!
      expect(textOfTheKeptFile((await reader.call({ resource: theirs })).text)).toBe(
        'somebody edited this\n',
      )

      const untouched = await callOn(readerTools, 'read_document', { resource: mine })
      expect(untouched.outcome, JSON.stringify(untouched)).toBe('ok')
    })
  })

  describe('cross-conversation withdrawal uses the existing work ending', () => {
    it('message and withdrawal are admitted while the interrupt rule still holds', async () => {
      await personOpens('desk')
      const deskTools = theToolsetJustHandedOut()
      const {
        agent: writer,
        label: writerLabel,
        tools: writerTools,
      } = await aPieceGiven(deskTools, 'scribe', 'Find things')
      const { tools: readerTools } = await aPieceGiven(deskTools, 'inspector', 'Inspect things')

      const said = await callOn(readerTools, 'message_agent', {
        agent: writer,
        text: 'a question about your notes',
        kind: 'note',
      })
      expect(said.outcome, JSON.stringify(said)).toBe('ok')
      expect(reached(writer, 'a question about your notes')).toBe(true)

      const waiting = store.routedRequestsOf(writer)
      expect(waiting.some((request) => request.state === 'open')).toBe(true)
      const refused = await callOn(readerTools, 'interrupt_agent', { agent: writer, reason: 'no' })
      expect(refused).toMatchObject({ outcome: 'refused', rail: 'a-person-is-being-asked' })
      expect(store.routedRequestsOf(writer)).toEqual(waiting)

      const asked = await callOn(writerTools, 'ask_question', {
        who_answers: 'a-person',
        piece: writerLabel,
        question: 'Which notes should I check?',
      })
      expect(asked.outcome, JSON.stringify(asked)).toBe('ok')
      const question = () =>
        store.routedRequestsOf(writer).find((request) => request.requestId === asked.question)
      expect(question()?.state).toBe('open')

      const taken = await callOn(readerTools, 'withdraw_task', { piece: writerLabel })
      expect(taken, JSON.stringify(taken)).toMatchObject({ outcome: 'ok', state: 'withdrawn' })
      expect(question()?.state).toBe('work-withdrawn')
      for (const request of waiting) expect(store.routedRequestsOf(writer)).toContainEqual(request)
      expect(host.sessionIds).toContain(writer)
    })

    it('WORK never reaches a stranger, and lands in one the giver started', async () => {
      const { deskTools, reader, readerTools, writer } = await twoConversations()
      const held = await callOn(deskTools, 'give_work', {
        to: reader,
        definition_of_done: 'The requested result and its checks are recorded.',
        profile: 'inspector',
        title: 'Get this written up',
        brief: 'get this written up',
      })
      expect(held.outcome, JSON.stringify(held)).toBe('ok')
      expect(held.agent).toBe(reader)
      expect(held.delivery, JSON.stringify(held)).toBe('held')
      const card = store
        .events(reader)
        .map((entry) => entry.event)
        .filter((event) => event.type === 'permission_request')
        .at(-1)
      if (card === undefined || card.type !== 'permission_request') {
        throw new Error('the reader’s turn raised no card')
      }
      await ask({ kind: 'claim', sessionId: reader })
      await ask({
        kind: 'respondPermission',
        sessionId: reader,
        requestId: card.id,
        decision: { outcome: 'allow' },
      })
      const itsBriefIsATurn = (): boolean =>
        store
          .events(reader)
          .some((one) => one.event.type === 'user_turn' && one.event.text === 'get this written up')
      for (let attempt = 0; attempt < 400 && !itsBriefIsATurn(); attempt++) {
        await new Promise((resolve) => setTimeout(resolve, 10))
      }
      expect(itsBriefIsATurn(), 'the held give went out as the reader’s turn').toBe(true)
      expect(store.piecesGivenBy(reader)).toHaveLength(0)

      const noted = await callOn(readerTools, 'message_agent', {
        agent: writer,
        text: 'how did you handle this last time?',
        kind: 'note',
      })
      expect(noted.outcome, JSON.stringify(noted)).toBe('ok')
      expect(store.piecesGivenBy(reader)).toHaveLength(0)

      const given = await callOn(readerTools, 'give_work', {
        to: 'new',
        conversation_title: 'Write this up',
        definition_of_done: 'The requested result and its checks are recorded.',
        profile: 'scribe',
        title: 'Write this up',
        brief: 'please write this up',
      })
      expect(given.outcome, JSON.stringify(given)).toBe('ok')
      const mine = given.agent as string
      expect(mine).not.toBe(writer)
      expect(store.parentOf(mine)).toBe(reader)
      expect(store.piecesOwnedBy(writer).map((one) => one.giver)).not.toContain(reader)

      const assigned = store.piecesGivenBy(reader)
      expect(assigned).toHaveLength(1)
      expect(assigned[0]?.owner).toBe(mine)
      expect(TASK_IS_OPEN[assigned[0]!.state]).toBe(true)
    })
  })
})
