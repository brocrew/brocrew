import { waitFor } from './lib/f093-host'
import type { PersistedEventInfo, TranscriptEvent } from '../src/shared/conversation-events'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { FakeProviderSessions } from '@brobot2/runtime'
import { type AgentToolset } from '@brobot2/runtime'
import type { Provider } from '@brobot2/shared'
import { type AppDatabase, openDatabase } from '../src/main/db/connection'
import { applyMigrations } from '../src/main/db/migrate'
import { createSessionStore, type SessionStore } from '../src/main/db/session-store'
import { RuntimeHost } from './helpers/giver-notice-host'
import type { ToolName } from '../src/main/runtime/agent-tools'
import { resolveSessionCwd } from '../src/main/runtime/scratch-cwd'
import { DEFAULT_CAPABILITIES } from '../src/shared/capabilities'
import { mailboxOf, stillHeld } from '../src/shared/mailbox'
import { theMessagesOf } from '../src/shared/runtime-ipc'
import { ToolWatchingResumeRuntime as ToolWatchingRuntime } from './lib/provider-double'
import {
  RecordingSink,
  syntheticProviderHome,
  fixtureProviderConfig,
  neutralHostDeps,
} from './lib/host-fixture'

/**
 * One worker and the callers who reach it: a second caller asks or leaves a note rather than
 * giving it work, and held messages reach the worker in arrival order, across a quit too.
 */

const here = dirname(fileURLToPath(import.meta.url))
const migrationsFolder = join(here, '../src/main/db/migrations')

describe('one session, and the callers who wait', () => {
  let userData: string
  let root: string
  let db: AppDatabase
  let store: SessionStore
  let host: RuntimeHost
  let hosts: RuntimeHost[]
  let handed: AgentToolset[]
  let issued: FakeProviderSessions
  let counter: number
  let clock: number
  let window: RecordingSink
  let claimed: Set<string>
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
    userData = mkdtempSync(join(tmpdir(), 'brobot2-queue-'))
    root = mkdtempSync(join(tmpdir(), 'brobot2-queue-root-'))
    db = openDatabase(join(userData, 'brobot2.sqlite'))
    applyMigrations(db, migrationsFolder)
    clock = 8_000_000
    store = createSessionStore(db, tick)
    counter = 0
    hosts = []
    handed = []
    issued = new FakeProviderSessions()
    host = buildHost()
    window = new RecordingSink('webContents:1')
    claimed = new Set<string>()
  })

  afterEach(async () => {
    for (const built of hosts) await built.closeAll()
    db.close()
    for (const dir of [userData, root]) rmSync(dir, { recursive: true, force: true })
  })

  const personOpens = async (profileId: string): Promise<string> => {
    const { sessionId } = await host.createSession(
      { provider: 'claude', profileId, approvalMode: 'ask', cwd: root },
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

  const theToolsetJustHandedOut = (): AgentToolset => {
    const last = handed.at(-1)
    if (last === undefined) throw new Error('no toolset was handed to that launch')
    return last
  }

  const ledger = (sessionId: string): TranscriptEvent[] =>
    store.events(sessionId).map((entry) => entry.event)

  const saidToProvider = (sessionId: string): string[] =>
    ledger(sessionId)
      .filter((event) => event.type === 'assistant_message')
      .map((event) => (event as { text: string }).text)
      .filter((text) => text.startsWith('echo: '))
      .map((text) => text.slice('echo: '.length))

  const openPiecesOf = (sessionId: string) => store.openPiecesOf(sessionId)

  const cardOn = async (sessionId: string): Promise<string> => {
    await waitFor(
      () => ledger(sessionId).some((event) => event.type === 'permission_request'),
      'the card the turn parks on',
    )
    const asked = ledger(sessionId)
      .filter((event) => event.type === 'permission_request')
      .at(-1)
    if (asked === undefined || asked.type !== 'permission_request') {
      throw new Error('no permission request on the ledger')
    }
    return asked.id
  }

  const letTheTurnFinish = async (sessionId: string): Promise<void> => {
    const id = await cardOn(sessionId)
    if (!claimed.has(sessionId)) {
      host.claimSession(sessionId, window)
      claimed.add(sessionId)
    }
    await host.respondPermission(sessionId, id, { outcome: 'allow' }, window)
    await waitFor(
      () => ledger(sessionId).some((event) => event.type === 'turn'),
      'the turn to reach its own terminal',
    )
  }

  /**
   * One worker, started by the first caller's give and parked on its brief's card, and a second
   * conversation that gave it nothing.
   */
  const oneWorkerAndTwoCallers = async (): Promise<{
    worker: string
    first: string
    second: string
    firstPiece: string
    firstTools: AgentToolset
    secondTools: AgentToolset
    workerTools: AgentToolset
  }> => {
    await bringIdentityIntoBeing('worker')
    const first = await personOpens('pm')
    const firstTools = theToolsetJustHandedOut()
    const given = await callOn(firstTools, 'give_work', {
      definition_of_done: 'The requested result and its checks are recorded.',
      profile: 'worker',
      title: 'the work this dispatch is about',
      brief: 'the work this dispatch is about',
    })
    expect(given.outcome, JSON.stringify(given)).toBe('ok')
    expect(given.started).toBe(true)
    const worker = given.agent as string
    const workerTools = theToolsetJustHandedOut()
    await cardOn(worker)
    const second = await personOpens('archivist')
    const secondTools = theToolsetJustHandedOut()
    expect(store.parentOf(worker)).toBe(first)
    expect(openPiecesOf(worker).map((one) => [one.label, one.giver])).toEqual([
      [given.label, first],
    ])
    expect(store.capabilitiesOf('archivist')).toEqual(DEFAULT_CAPABILITIES)
    return {
      worker,
      first,
      second,
      firstPiece: given.label as string,
      firstTools,
      secondTools,
      workerTools,
    }
  }

  /** The worker's open pieces, by title. */
  const titlesOpenOn = (worker: string): string[] => openPiecesOf(worker).map((one) => one.title)

  describe('the second caller', () => {
    it('a second caller that did not start the worker is told no, by name', async () => {
      const { worker, firstPiece, secondTools } = await oneWorkerAndTwoCallers()

      const refused = await callOn(secondTools, 'message_agent', {
        kind: 'follow-up',
        agent: worker,
        piece: firstPiece,
        text: 'and mine',
      })
      expect(refused.outcome, JSON.stringify(refused)).toBe('refused')
      expect(refused.rail).toBe('not-a-piece-you-gave')
      expect(refused.retryable).toBe(false)

      // Its own give starts a conversation of its own.
      const its = await callOn(secondTools, 'give_work', {
        definition_of_done: 'The requested result and its checks are recorded.',
        profile: 'worker',
        title: 'and mine',
        brief: 'and mine',
      })
      expect(its.outcome, JSON.stringify(its)).toBe('ok')
      expect(its.agent).not.toBe(worker)
      expect(its.started).toBe(true)
      expect(titlesOpenOn(worker)).toEqual(['the work this dispatch is about'])
    })

    it('a second caller’s note waits its turn, in the ledger’s order', async () => {
      const { worker, first, firstTools, secondTools, workerTools } = await oneWorkerAndTwoCallers()
      const held1 = await callOn(firstTools, 'give_work', {
        definition_of_done: 'The requested result and its checks are recorded.',
        profile: 'worker',
        title: 'do mine',
        brief: 'do mine',
      })
      expect(held1.delivery, JSON.stringify(held1)).toBe('held')
      expect(held1.agent).toBe(worker)
      const held2 = await callOn(secondTools, 'message_agent', {
        kind: 'note',
        agent: worker,
        text: 'then mine',
      })
      expect(held2.delivery, JSON.stringify(held2)).toBe('queued')

      expect(stillHeld(store.events(worker)).map((one) => one.text)).toEqual([
        'do mine',
        'then mine',
      ])

      // The turn ending sends everything held as one turn, oldest first.
      await letTheTurnFinish(worker)
      await waitFor(
        () => saidToProvider(worker).some((said) => said.includes('then mine')),
        'the held messages to flush',
      )
      const carrying = saidToProvider(worker).filter(
        (said) => said.includes('do mine') || said.includes('then mine'),
      )
      expect(carrying).toHaveLength(1)
      const [both = ''] = carrying
      expect(both.indexOf('do mine')).toBeGreaterThan(-1)
      expect(both.indexOf('do mine')).toBeLessThan(both.indexOf('then mine'))
      const theTurn = ledger(worker)
        .filter((event) => event.type === 'user_turn')
        .at(-1)
      expect(
        theTurn?.type === 'user_turn' ? theMessagesOf(theTurn).map((one) => one.text) : [],
      ).toEqual(['do mine', 'then mine'])
      expect(stillHeld(store.events(worker))).toEqual([])

      // The held piece's answer reaches the caller that gave it.
      expect(titlesOpenOn(worker)).toEqual(['the work this dispatch is about', 'do mine'])
      const piece = openPiecesOf(worker).find((one) => one.title === 'do mine')
      if (piece === undefined) throw new Error('the held give opened no piece')
      expect(piece.giver).toBe(first)
      const replied = await callOn(workerTools, 'reply_to_parent', {
        piece: piece.label,
        outcome: 'done',
        summary: `answered for ${first}`,
      })
      expect(replied.outcome, JSON.stringify(replied)).toBe('ok')
      expect(titlesOpenOn(worker)).toEqual(['the work this dispatch is about'])
      await waitFor(
        () =>
          ledger(first).some(
            (event) =>
              (event.type === 'user_turn' || event.type === 'message_queued') &&
              (event as { text: string }).text.includes(`answered for ${first}`),
          ),
        `the answer to reach ${first}`,
      )
    })
  })

  describe('the same caller, twice', () => {
    it('the same caller is told of the piece its own stalled work holds, and its give goes through', async () => {
      const { worker, firstPiece, firstTools } = await oneWorkerAndTwoCallers()
      await letTheTurnFinish(worker)
      await waitFor(
        () => openPiecesOf(worker).some((one) => one.state === 'stalled'),
        'the brief’s piece to stall when its turn ended',
      )

      const again = await callOn(firstTools, 'give_work', {
        definition_of_done: 'The requested result and its checks are recorded.',
        profile: 'worker',
        title: 'and also',
        brief: 'and also',
      })
      expect(again.outcome, JSON.stringify(again)).toBe('ok')
      expect(again.stalled).toEqual([firstPiece])
      expect(titlesOpenOn(worker)).toEqual(['the work this dispatch is about', 'and also'])
    })

    it('a person typing into a busy child is held and opens no piece', async () => {
      const { worker } = await oneWorkerAndTwoCallers()
      host.claimSession(worker, window)
      claimed.add(worker)
      await host.queueMessage(worker, 'what are you doing?', window)
      await waitFor(
        () =>
          ledger(worker).some(
            (event) => event.type === 'message_queued' && event.text === 'what are you doing?',
          ),
        'the person’s message to be held',
      )
      expect(openPiecesOf(worker)).toHaveLength(1)
    })
  })

  describe('derived, never remembered', () => {
    it('a row written by an older build reads as work', () => {
      const older: PersistedEventInfo[] = [
        {
          ordinal: 1,
          at: 10,
          event: { type: 'message_queued', messageId: 'msg_old', text: 'from an older build' },
        },
        {
          ordinal: 2,
          at: 11,
          event: {
            type: 'message_queued',
            messageId: 'msg_new',
            kind: 'question',
            text: 'from this one',
          },
        },
      ]
      const box = mailboxOf(older)
      expect(box.map((one) => one.kind)).toEqual(['work', 'question'])
      expect(box.map((one) => one.messageId)).toEqual(['msg_old', 'msg_new'])
    })

    it('the queue survives a quit: the held rows stay open, and the next start sends them first, in order', async () => {
      const { worker, firstTools, secondTools } = await oneWorkerAndTwoCallers()
      await callOn(firstTools, 'give_work', {
        definition_of_done: 'The requested result and its checks are recorded.',
        profile: 'worker',
        title: 'do mine',
        brief: 'do mine',
      })
      await callOn(secondTools, 'message_agent', { kind: 'note', agent: worker, text: 'then mine' })
      expect(stillHeld(store.events(worker))).toHaveLength(2)

      for (const built of hosts) await built.closeAll()
      hosts.length = 0
      // No ending was written for either.
      expect(stillHeld(store.events(worker)).map((one) => one.text)).toEqual([
        'do mine',
        'then mine',
      ])
      expect(mailboxOf(store.events(worker)).map((one) => one.ending)).toEqual([null, null])

      host = buildHost()
      claimed.clear()
      const before = saidToProvider(worker).length
      await host.resumeSession(worker, window)
      claimed.add(worker)
      // Both go as the first turn of the new start, oldest first.
      await waitFor(() => saidToProvider(worker).length > before, 'the held messages to go')
      const [first = ''] = saidToProvider(worker).slice(before)
      expect(first.indexOf('do mine')).toBeGreaterThan(-1)
      expect(first.indexOf('do mine')).toBeLessThan(first.indexOf('then mine'))
      expect(stillHeld(store.events(worker))).toEqual([])
      expect(mailboxOf(store.events(worker)).map((one) => one.ending)).toEqual(['sent', 'sent'])
    })
  })
})
