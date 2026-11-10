import type { TaskState } from '../src/shared/task-contracts'
import type { TranscriptEvent } from '../src/shared/conversation-events'
import { WORK_STATE_WORD } from '../src/shared/work-state-words'
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
import { TASK_IS_OPEN } from '../src/shared/tasks'
import { aPersonOwesAnAnswerIn } from '../src/shared/questions'
import { MAX_FOREST_CONVERSATIONS } from '../src/shared/the-whole-forest'
import { ToolWatchingResumeRuntime as ToolWatchingRuntime } from './lib/provider-double'
import {
  RecordingSink,
  syntheticProviderHome,
  fixtureProviderConfig,
  neutralHostDeps,
} from './lib/host-fixture'

const here = dirname(fileURLToPath(import.meta.url))
const migrationsFolder = join(here, '../src/main/db/migrations')

describe('one task, one reading, in every place it is drawn', () => {
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

  beforeEach(() => {
    userData = mkdtempSync(join(tmpdir(), 'brobot2-664-'))
    root = mkdtempSync(join(tmpdir(), 'brobot2-664-root-'))
    db = openDatabase(join(userData, 'brobot2.sqlite'))
    applyMigrations(db, migrationsFolder)
    clock = 9_000_000
    store = createSessionStore(db, tick)
    counter = 0
    handed = []
    issued = new FakeProviderSessions()
    host = new RuntimeHost({
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
    window = new RecordingSink('webContents:1')
  })

  afterEach(async () => {
    await host.closeAll()
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

  const waitFor = async (predicate: () => boolean, what: string): Promise<void> => {
    for (let attempt = 0; attempt < 400; attempt++) {
      if (predicate()) return
      await new Promise((resolve) => setTimeout(resolve, 10))
    }
    throw new Error(`timed out waiting for ${what}`)
  }

  /** One piece given by a PM to a worker; the worker parks on a card a person owes. */
  const aTaskGivenOut = async (): Promise<{
    giver: string
    holder: string
    piece: string
    surface: RecordingSink
  }> => {
    const seeded = await personOpens('worker')
    await host.close(seeded, window)
    const giver = await personOpens('pm')
    const giverTools = theToolsetJustHandedOut()
    const given = await callOn(giverTools, 'give_work', {
      definition_of_done: 'The requested result and its checks are recorded.',
      profile: 'worker',
      title: 'the work one task is about',
      brief: 'do the thing',
    })
    expect(given.outcome, JSON.stringify(given)).toBe('ok')
    const holder = given.agent as string
    const piece = store.piecesOwnedBy(holder).find((one) => TASK_IS_OPEN[one.state])
    if (piece === undefined) throw new Error('the give never opened a piece')
    const surface = new RecordingSink('webContents:9')
    host.claimSession(holder, surface)
    await waitFor(
      () => aPersonOwesAnAnswerIn(store.routedRequestsOf(holder)),
      'the holder to park on a card a person owes',
    )
    return { giver, holder, piece: piece.piece, surface }
  }

  const readingsOf = (
    giver: string,
    holder: string,
    piece: string,
  ): Record<string, string | undefined> => ({
    'the giver’s drawer': host
      .whoCalledWhom(giver)
      .workGivenOut.rows.find((one) => one.piece === piece)?.state,
    'the receiver’s line': host
      .whoCalledWhom(holder)
      .workTakenIn.rows.find((one) => one.piece === piece)?.state,
    'the Team forest': host
      .theWholeForest()
      .nodes.rows.flatMap((one) => (one.node === 'a-task' ? [one.work] : []))
      .find((one) => one.piece === piece)?.state,
    'the agent’s list_tasks': host.pieceBoard(giver).gave.find((one) => one.piece === piece)?.state,
    'the person’s Work tab': store.workGivenOutBy(giver).rows.find((one) => one.piece === piece)
      ?.state,
    'the agent turn block': (
      host as unknown as {
        factsForTheTurnBlock(
          session: { id: string },
          piece: null,
        ): { helpers: { piece: string; state: string }[] | null }
      }
    )
      .factsForTheTurnBlock({ id: giver }, null)
      .helpers?.find((row) => row.piece === piece)?.state,
  })

  const everywhere = (state: TaskState): Record<string, string> => ({
    'the giver’s drawer': state,
    'the receiver’s line': state,
    'the Team forest': state,
    'the agent’s list_tasks': state,
    'the person’s Work tab': state,
    'the agent turn block': WORK_STATE_WORD[state],
  })

  describe('one task waiting on a person, and the same task once nothing is outstanding', () => {
    it('a task whose holder a person owes an answer reads `waiting-on-a-person` in every place', async () => {
      const { giver, holder, piece } = await aTaskGivenOut()
      expect(store.piecesOwnedBy(holder).find((one) => one.piece === piece)?.state).toBe('working')
      const before = (db.prepare('SELECT total_changes() AS n').get() as { n: number }).n
      expect(readingsOf(giver, holder, piece)).toEqual(everywhere('waiting-on-a-person'))
      expect((db.prepare('SELECT total_changes() AS n').get() as { n: number }).n).toBe(before)
    })

    it('the same task, card answered and turn over, reads its raw state in every place', async () => {
      const { giver, holder, piece, surface } = await aTaskGivenOut()
      const card = ledger(holder)
        .filter(
          (event): event is TranscriptEvent & { type: 'permission_request'; id: string } =>
            event.type === 'permission_request',
        )
        .at(-1)
      if (card === undefined) throw new Error('the holder is not parked on anything')
      await host.respondPermission(holder, card.id, { outcome: 'allow' }, surface)
      await waitFor(
        () => store.piecesOwnedBy(holder).find((one) => one.piece === piece)?.state === 'stalled',
        'the holder’s turn to end',
      )
      expect(aPersonOwesAnAnswerIn(store.routedRequestsOf(holder))).toBe(false)
      expect(readingsOf(giver, holder, piece)).toEqual(everywhere('stalled'))
    })
  })
})

/** Counts the questions read, which on these walks is the wait read, per conversation. */
describe('one wait read per holder, whatever it holds', () => {
  let userData: string
  let raw: AppDatabase
  let store: SessionStore
  let clock: number
  let armed: number
  const reads: string[] = []
  const tick = (): number => clock++
  const ordinals = new Map<string, number>()

  beforeEach(() => {
    userData = mkdtempSync(join(tmpdir(), 'brobot2-664-price-'))
    raw = openDatabase(join(userData, 'brobot2.sqlite'))
    applyMigrations(raw, migrationsFolder)
    clock = 7_000_000
    armed = 0
    reads.length = 0
    ordinals.clear()
    const counted = new Proxy(raw, {
      get(target, property) {
        if (property === 'prepare') {
          return (sql: string) => {
            const statement = target.prepare(sql)
            // The read that asks whether a question was written since a kept fold reads none.
            if (
              !sql.includes("AND type IN ('user_input_request', 'question_asked')") ||
              sql.includes('ordinal > @after')
            )
              return statement
            armed += 1
            return new Proxy(statement, {
              get(inner, name) {
                if (name === 'all') {
                  return (...args: unknown[]) => {
                    reads.push(args[0] as string)
                    return inner.all(...args)
                  }
                }
                const value: unknown = Reflect.get(inner, name, inner)
                return typeof value === 'function' ? value.bind(inner) : value
              },
            })
          }
        }
        const value: unknown = Reflect.get(target, property, target)
        return typeof value === 'function' ? value.bind(target) : value
      },
    })
    store = createSessionStore(counted, tick)
  })

  afterEach(() => {
    raw.close()
    rmSync(userData, { recursive: true, force: true })
  })

  const conversation = (id: string, profileId: string, parentSessionId?: string): string => {
    store.create({
      id,
      provider: 'codex',
      cwd: userData,
      approvalMode: 'ask',
      profileId,
      ...(parentSessionId === undefined ? {} : { parentSessionId }),
    })
    return id
  }
  const nextOrdinal = (id: string): number => {
    const next = ordinals.get(id) ?? 0
    ordinals.set(id, next + 1)
    return next
  }
  const append = (id: string, event: TranscriptEvent): void => {
    store.append(id, nextOrdinal(id), event, tick())
  }
  const given = (holder: string, giver: string, piece: string): void => {
    const root = store.rootOf(giver)
    if (root === null) throw new Error(`${giver} owns no root`)
    const number = store.numberUnder(root.piece)
    const label = `${root.label}.${String(number)}`
    const title = `the work labelled ${label}`
    store.recordGive(
      {
        piece,
        parent: root.piece,
        number,
        owner: holder,
        givenBy: giver,
        title,
        brief: title,
        folder: null,
        inputs: [],
      },
      nextOrdinal(holder),
      { type: 'work_given', piece, label, parent: root.piece, givenBy: giver, title, brief: title },
      tick(),
    )
  }

  it('the forest and the receiver’s line read a holder of two open rows once, and a conversation holding nothing never', () => {
    const one = conversation('sess_giver_one', 'pm')
    const holder = conversation('sess_holder', 'worker', one)
    given(holder, one, 'work_1')
    given(holder, one, 'work_2')
    // An unreadable question in the holder's ledger, so its questions are never kept between
    // reads: each answer must read them, and read them once.
    raw
      .prepare(
        `INSERT INTO events (id, session_id, generation, ordinal, type, payload, created_at)
         VALUES (?, ?, 0, ?, 'user_input_request', ?, ?)`,
      )
      .run('evt_unkept', holder, nextOrdinal(holder), '{not json', tick())
    expect(armed, 'the questions read was never prepared through the probe').toBe(1)

    const forest = store.everyPlacedConversation(MAX_FOREST_CONVERSATIONS)
    expect(
      forest.rows
        .flatMap((node) => (node.node === 'a-task' ? [node.work] : []))
        .filter((work) => TASK_IS_OPEN[work.state])
        .map((work) => work.piece)
        .sort(),
    ).toEqual(['work_1', 'work_2'])
    expect(reads).toEqual([holder])

    reads.length = 0
    expect(store.workThisOneWasGiven(holder).rows).toHaveLength(2)
    expect(reads).toEqual([holder])

    reads.length = 0
    expect(store.workThisOneWasGiven(one).rows).toEqual([])
    expect(reads).toEqual([])
  })

  it('one unparseable assignment elsewhere: the forest answers while work is open, and counts the row once', () => {
    const giver = conversation('sess_giver', 'pm')
    const holder = conversation('sess_holder', 'worker', giver)
    const elsewhere = conversation('sess_elsewhere', 'worker', giver)
    given(holder, giver, 'work_1')
    expect(store.everyPlacedConversation(MAX_FOREST_CONVERSATIONS).rowsUnread).toBe(0)
    raw
      .prepare(
        `INSERT INTO events (id, session_id, generation, ordinal, type, payload, created_at)
         VALUES (?, ?, 0, ?, 'work_given', ?, ?)`,
      )
      .run('evt_torn', elsewhere, 900, '{not json', tick())
    const forest = store.everyPlacedConversation(MAX_FOREST_CONVERSATIONS)
    expect(forest.rowsUnread).toBe(1)
    expect(
      forest.rows.flatMap((node) => (node.node === 'a-task' ? [node.work.piece] : [])),
    ).toEqual(['work_1'])
    expect(forest.rows.filter((node) => node.node === 'a-conversation')).toHaveLength(3)
  })

  it('one unparseable question row in a holder’s own ledger: both reads answer, and count it', () => {
    const giver = conversation('sess_giver', 'pm')
    const holder = conversation('sess_holder', 'worker', giver)
    given(holder, giver, 'work_1')
    expect(store.workThisOneWasGiven(holder).rowsUnread).toBe(0)
    raw
      .prepare(
        `INSERT INTO events (id, session_id, generation, ordinal, type, payload, created_at)
         VALUES (?, ?, 0, ?, 'user_input_request', ?, ?)`,
      )
      .run('evt_torn_question', holder, nextOrdinal(holder), '{not json', tick())
    const forest = store.everyPlacedConversation(MAX_FOREST_CONVERSATIONS)
    expect(forest.rowsUnread).toBe(1)
    expect(forest.rows.some((node) => node.node === 'a-task')).toBe(true)
    const taken = store.workThisOneWasGiven(holder)
    expect(taken.rowsUnread).toBe(1)
    expect(taken.rows).toHaveLength(1)
    append(holder, {
      type: 'work_replied',
      piece: 'work_1',
      outcome: 'done',
      summary: 'done',
      resources: [],
    })
    expect(store.workThisOneWasGiven(holder).rowsUnread).toBe(0)
  })
})
