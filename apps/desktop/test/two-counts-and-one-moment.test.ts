import type { TranscriptEvent } from '../src/shared/conversation-events'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { FakeRuntime } from '@brobot2/runtime'
import type { Provider } from '@brobot2/shared'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { openDatabase, type AppDatabase } from '../src/main/db/connection'
import { applyMigrations } from '../src/main/db/migrate'
import {
  NULL_SESSION_STORE,
  createSessionStore,
  type SessionStore,
} from '../src/main/db/session-store'
import { RuntimeHost } from './helpers/giver-notice-host'
import { resolveSessionCwd } from '../src/main/runtime/scratch-cwd'
import { personsQueueView } from '../src/renderer/src/lib/persons-queue'
import { type RuntimeChangeMessage } from '../src/shared/runtime-ipc'
import {
  aWholeReading,
  countedTogether,
  scopesOmittedFrom,
  scopesShortIn,
  type WorkspaceReading,
} from '../src/shared/workspace-reading'
import { syntheticProviderHome, neutralHostDeps } from './lib/host-fixture'

const here = dirname(fileURLToPath(import.meta.url))
const migrationsDir = join(here, '../src/main/db/migrations')

const NOW = 1_800_000_000_000

/** A provider limit line as Claude reports it. */
const A_PROVIDER_WALL =
  'claude is approaching its rate limit (seven_day); resets 2126-09-23T11:00:00.000Z'

describe('the workspace reading', () => {
  let userData: string
  let workspace: string
  let db: AppDatabase
  let store: SessionStore
  let host: RuntimeHost
  let clock: number
  let announced: RuntimeChangeMessage[]

  const tick = (): number => clock++

  beforeEach(() => {
    userData = mkdtempSync(join(tmpdir(), 'brobot2-reading-'))
    workspace = mkdtempSync(join(tmpdir(), 'brobot2-reading-cwd-'))
    db = openDatabase(join(userData, 'brobot2.sqlite'))
    applyMigrations(db, migrationsDir)
    clock = NOW
    announced = []
    store = createSessionStore(db, tick)
    host = new RuntimeHost({
      store,
      ...neutralHostDeps(() => userData),
      createRuntime: (provider: Provider) => new FakeRuntime(provider),
      prepareProviderHome: syntheticProviderHome(() => userData),
      providerHomePath: (provider: Provider) => join(userData, 'provider-homes', provider),
      resolveCwd: (sessionId, requested) => resolveSessionCwd(userData, sessionId, requested),
      newSessionId: () => `sess_567_${String(tick())}`,
      now: tick,
      readProviderConfig: (provider, home) => ({
        home,
        homeEnv: 'CLAUDE_CONFIG_DIR',
        model: 'm',
        authNote: null,
        files: [],
      }),
      announce: (message) => {
        announced.push(message)
      },
    })
  })

  afterEach(async () => {
    await host.closeAll()
    db.close()
    rmSync(userData, { recursive: true, force: true })
    rmSync(workspace, { recursive: true, force: true })
  })

  /** A conversation this app started. */
  const conversation = (id: string, profileId: string): string => {
    store.create({
      id,
      provider: 'codex',
      cwd: workspace,
      approvalMode: 'ask',
      profileId,
    })
    return id
  }

  const ordinals = new Map<string, number>()
  const append = (id: string, event: TranscriptEvent, at = tick()): void => {
    const next = ordinals.get(id) ?? 0
    ordinals.set(id, next + 1)
    store.append(id, next, event, at)
  }

  /** A question that travelled and was escalated to a person. */
  const aQuestionAPersonNowOwes = (id: string, requestId: string): string => {
    append(id, { type: 'request_routed', requestId, to: 'the-parent', parent: 'sess_parent' })
    append(id, { type: 'request_escalated', requestId } as TranscriptEvent)
    return requestId
  }

  /** A request that never travelled: a decision only a person can make. */
  const aDecisionOnlyAPersonCanMake = (id: string, requestId: string): string => {
    append(id, {
      type: 'request_routed',
      requestId,
      to: 'a-person',
      because: 'a-permission-decision',
      parent: 'sess_parent',
    })
    return requestId
  }

  /** A person answered it. */
  const answered = (id: string, requestId: string): void => {
    append(id, { type: 'user_decision', requestId, outcome: 'answered' } as TranscriptEvent)
  }

  /** Work given, then a turn that ended: stalled with nobody told. */
  const workThatStalled = (holder: string, giver: string, piece: string): void => {
    const root = store.rootOf(giver)
    if (root === null) throw new Error(`${giver} has no root`)
    const number = store.numberUnder(root.piece)
    const title = 'Run the migration'
    const brief = 'run the migration'
    const ordinal = ordinals.get(holder) ?? 0
    ordinals.set(holder, ordinal + 1)
    store.recordGive(
      {
        piece,
        parent: root.piece,
        number,
        owner: holder,
        givenBy: giver,
        title,
        brief,
        folder: null,
        inputs: [],
      },
      ordinal,
      {
        type: 'work_given',
        piece,
        label: `${root.label}.${String(number)}`,
        parent: root.piece,
        givenBy: giver,
        title,
        brief,
      },
      tick(),
    )
    append(holder, { type: 'turn', state: 'interrupted' } as TranscriptEvent)
  }

  /** A provider limit, as the non-fatal error row the limits read folds. */
  const aWall = (id: string): void => {
    append(id, { type: 'error', message: A_PROVIDER_WALL, fatal: false } as TranscriptEvent)
  }

  /**
   * Two things a person must answer (one question, one decision, in different conversations), two
   * things they read but cannot answer (a provider limit and stalled work), and two stopped
   * conversations.
   */
  const theWorkspace = (): {
    pm: string
    worker: string
    loner: string
    done: string
    broke: string
    escalated: string
    decision: string
  } => {
    const pm = conversation('sess_pm', 'project-manager')
    const worker = conversation('sess_worker', 'worker')
    const loner = conversation('sess_loner', 'auditor')
    const done = conversation('sess_done', 'reviewer')
    const broke = conversation('sess_broke', 'reviewer')
    const escalated = aQuestionAPersonNowOwes(pm, 'req_escalated')
    const decision = aDecisionOnlyAPersonCanMake(worker, 'req_decision')
    aWall(pm)
    workThatStalled(loner, pm, 'work_stalled')
    store.terminate(done, 'ended', 'completed', tick())
    store.terminate(broke, 'errored', 'failed', tick())
    return { pm, worker, loner, done, broke, escalated, decision }
  }

  it('counts what a person must answer across the workspace, and not what they only read', () => {
    theWorkspace()
    expect(host.limitsForAPerson().rows).toHaveLength(1)
    expect(host.stalledWorkForAPerson().rows).toHaveLength(1)
    const read = host.readWorkspace()
    expect(read.needsYou).toEqual({ counted: 'in-full', count: 2 })
    expect(aWholeReading(read)).toBe(true)
  })

  it('an answered request moves the count, and a conversation stopping does not', () => {
    const { pm, escalated } = theWorkspace()
    expect(host.readWorkspace()).toMatchObject({ needsYou: { count: 2 } })
    store.terminate('sess_worker', 'ended', 'completed', tick())
    expect(host.readWorkspace()).toMatchObject({ needsYou: { count: 2 } })
    answered(pm, escalated)
    expect(host.readWorkspace()).toMatchObject({ needsYou: { count: 1 } })
  })

  it('an empty workspace counts zero, which is not the same answer as not counted', () => {
    const read = host.readWorkspace()
    expect(read.needsYou).toEqual({ counted: 'in-full', count: 0 })
    expect(scopesOmittedFrom(read)).toEqual([])
    expect(aWholeReading(read)).toBe(true)
  })

  it('`needsYou` equals the number the queue draws, over the same world', () => {
    theWorkspace()
    const queue = personsQueueView(host.questionsForAPerson(), host.decisionsForAPerson(), {
      now: NOW,
      held: new Set(),
      answerable: new Map(),
      answeredFromHere: new Set(),
      lastLookAnswered: { questions: true, decisions: true },
    })
    expect(queue?.count).toBe(2)
    expect(host.readWorkspace().needsYou).toEqual({ counted: 'in-full', count: 2 })
  })

  it('a closed thing is not counted, and each population is closed by its own writer', () => {
    const { pm, worker, escalated, decision } = theWorkspace()
    answered(pm, escalated)
    answered(worker, decision)
    expect(host.readWorkspace().needsYou).toEqual({ counted: 'in-full', count: 0 })
  })

  it('answers synchronously, with `readAt` taken inside the call from the wall clock', () => {
    theWorkspace()
    const before = Date.now()
    const answer: WorkspaceReading | Promise<WorkspaceReading> = host.readWorkspace()
    const after = Date.now()
    expect(typeof (answer as { then?: unknown }).then).toBe('undefined')
    const read = answer as WorkspaceReading
    expect(read.readAt).toBeGreaterThanOrEqual(before)
    expect(read.readAt).toBeLessThanOrEqual(after)
    expect(read.readAt).not.toBe(NOW)
  })

  it('a store with no database omits the count and zeroes nothing', () => {
    const blind = new RuntimeHost({
      store: NULL_SESSION_STORE,
      ...neutralHostDeps(() => userData),
      createRuntime: (provider: Provider) => new FakeRuntime(provider),
      prepareProviderHome: () => join(userData, 'nowhere'),
      providerHomePath: () => join(userData, 'nowhere'),
      resolveCwd: (sessionId, requested) => resolveSessionCwd(userData, sessionId, requested),
      newSessionId: () => 'sess_blind',
      now: tick,
      readProviderConfig: (provider, home) => ({
        home,
        homeEnv: 'CLAUDE_CONFIG_DIR',
        model: 'm',
        authNote: null,
        files: [],
      }),
    })
    const read = blind.readWorkspace()
    expect(read.needsYou).toEqual({ counted: 'not-at-all', because: 'no-ledger' })
    expect(Object.keys(read.needsYou)).not.toContain('count')
    expect(scopesOmittedFrom(read)).toEqual(['needs-you'])
    expect(aWholeReading(read)).toBe(false)
    expect(read.readAt).toBeGreaterThan(0)
  })

  it('a walk that dropped a row makes `needsYou` a lower bound that says so', () => {
    const { worker } = theWorkspace()
    db.prepare(
      `INSERT INTO events (id, session_id, generation, ordinal, type, payload, created_at)
       VALUES (?, ?, 0, ?, 'request_routed', '{not json', ?)`,
    ).run('evt_unreadable', worker, 900, tick())
    expect(store.decisionsAwaitingAPerson().rowsUnread).toBe(1)
    // Both walks open the same candidate set, so one malformed row is skipped twice.
    expect(store.questionsAPersonMustAnswer().rowsUnread).toBe(1)
    const read = host.readWorkspace()
    expect(read.needsYou).toEqual({ counted: 'short', count: 2, unread: 2 })
    expect(scopesShortIn(read)).toEqual(['needs-you'])
    expect(aWholeReading(read)).toBe(false)
  })

  it('`countedTogether` is short if any walk is short and absent only if every walk is', () => {
    const empty = { rows: [], ledgers: 0, rowsUnread: 0 } as const
    expect(
      countedTogether([
        { ...empty, walk: 'no-ledger' },
        { ...empty, walk: 'no-ledger' },
      ]),
    ).toEqual({ counted: 'not-at-all', because: 'no-ledger' })
    expect(
      countedTogether([
        { ...empty, walk: 'no-ledger' },
        { ...empty, walk: 'every-conversation-that-routed' },
      ]),
    ).toEqual({ counted: 'in-full', count: 0 })
    expect(
      countedTogether([
        { rows: [1], ledgers: 1, rowsUnread: 0, walk: 'every-conversation-that-routed' },
        { rows: [], ledgers: 1, rowsUnread: 2, walk: 'every-conversation-that-routed' },
      ]),
    ).toEqual({ counted: 'short', count: 1, unread: 2 })
  })

  it('a read announces nothing', () => {
    theWorkspace()
    announced.length = 0
    host.readWorkspace()
    expect(announced).toEqual([])
  })
})
