import type { LedgerWalk, LedgerWalkKind } from '../src/shared/question-contracts'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { openDatabase, type AppDatabase } from '../src/main/db/connection'
import { applyMigrations } from '../src/main/db/migrate'
import {
  NULL_SESSION_STORE,
  createSessionStore,
  type SessionStore,
} from '../src/main/db/session-store'
import { WALK_COVERS } from '../src/shared/questions'
import { personsQueueView, type PersonsQueueWorld } from '../src/renderer/src/lib/persons-queue'
import { homeAttention } from '../src/renderer/src/lib/home-attention'
import type { AttentionRequest } from '../src/renderer/src/lib/attention'
import { FakeRuntime } from '@brobot2/runtime'
import type { Provider } from '@brobot2/shared'
import { RuntimeHost } from '../src/main/runtime/runtime-host'
import { resolveSessionCwd } from '../src/main/runtime/scratch-cwd'
import { syntheticProviderHome, neutralHostDeps, fixtureProviderConfig } from './lib/host-fixture'

const here = dirname(fileURLToPath(import.meta.url))
const migrationsDir = join(here, '../src/main/db/migrations')

const NOW = 1_800_000_000_000

let dir: string
let db: AppDatabase
let store: SessionStore

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'brobot2-queue-'))
  db = openDatabase(join(dir, 'db.sqlite'))
  applyMigrations(db, migrationsDir)
  store = createSessionStore(db)
})

afterEach(() => {
  db.close()
  rmSync(dir, { recursive: true, force: true })
  vi.restoreAllMocks()
})

/** A conversation this app started. */
function conversation(id: string): void {
  store.create({
    id,
    provider: 'codex',
    cwd: dir,
    approvalMode: 'ask',
    profileId: 'd',
  })
}

/** A permission-shaped routing — the population a spawned child parks on. */
function parksOnAPermission(id: string, requestId: string, at: number, ordinal = 0): void {
  store.append(
    id,
    ordinal,
    {
      type: 'request_routed',
      requestId,
      to: 'a-person',
      because: 'a-permission-decision',
      parent: 'sess_pm',
    },
    at,
  )
}

/** A question that travelled and was then escalated to a person. */
function escalates(id: string, requestId: string, at: number, ordinal = 0): void {
  store.append(
    id,
    ordinal,
    { type: 'request_routed', requestId, to: 'the-parent', parent: 'sess_pm' },
    at,
  )
  store.append(id, ordinal + 1, { type: 'request_escalated', requestId }, at + 30_000)
}

describe('a walk says what it walked, and `rows` is not the answer', () => {
  it('an EMPTY list over ledgers that were read says so — the query`s number, not the result`s', () => {
    for (const n of [1, 2, 3]) {
      conversation(`sess_${n}`)
      parksOnAPermission(`sess_${n}`, `req_${n}`, NOW)
      store.append(
        `sess_${n}`,
        1,
        { type: 'user_decision', requestId: `req_${n}`, outcome: 'deny' },
        NOW + 1,
      )
    }
    const walked = store.decisionsAwaitingAPerson()
    expect(walked.rows).toEqual([])
    expect(walked.ledgers).toBe(3)
    expect(walked.walk).toBe('every-conversation-that-routed')
    expect(walked.rowsUnread).toBe(0)
  })

  it('a workspace where NOTHING has ever routed answers the same word with zero ledgers', () => {
    conversation('sess_quiet')
    store.append('sess_quiet', 0, { type: 'assistant_delta', text: 'hello' }, NOW)
    const walked = store.decisionsAwaitingAPerson()
    expect(walked.rows).toEqual([])
    expect(walked.ledgers).toBe(0)
    expect(walked.walk).toBe('every-conversation-that-routed')
  })

  it('`ledgers` counts what was OPENED and never what was found', () => {
    conversation('sess_busy')
    parksOnAPermission('sess_busy', 'req_1', NOW, 0)
    parksOnAPermission('sess_busy', 'req_2', NOW, 1)
    parksOnAPermission('sess_busy', 'req_3', NOW, 2)
    const walked = store.decisionsAwaitingAPerson()
    expect(walked.rows).toHaveLength(3)
    expect(walked.ledgers).toBe(1)
  })

  it('the ESCALATED walk reports the same candidate set as the decision walk, and says so', () => {
    conversation('sess_asker')
    escalates('sess_asker', 'req_q', NOW)
    conversation('sess_child')
    parksOnAPermission('sess_child', 'req_d', NOW)
    const asked = store.questionsAPersonMustAnswer()
    const settled = store.decisionsAwaitingAPerson()
    expect(asked.rows.map((one) => one.requestId)).toEqual(['req_q'])
    expect(settled.rows.map((one) => one.requestId)).toEqual(['req_d'])
    expect(asked.walk).toBe(settled.walk)
    expect(asked.ledgers).toBe(settled.ledgers)
    expect(asked.ledgers).toBe(2)
  })

  it('a store with NO LEDGER says so, and it is not an empty workspace', () => {
    expect(NULL_SESSION_STORE.questionsAPersonMustAnswer()).toEqual({
      rows: [],
      walk: 'no-ledger',
      ledgers: 0,
      rowsUnread: 0,
    })
    expect(NULL_SESSION_STORE.decisionsAwaitingAPerson().walk).toBe('no-ledger')
    expect(store.questionsAPersonMustAnswer()).toMatchObject({
      rows: [],
      walk: 'every-conversation-that-routed',
    })
  })

  it('a ledger row this app cannot parse is COUNTED, and the rest of the walk still lands', () => {
    conversation('sess_torn')
    parksOnAPermission('sess_torn', 'req_good', NOW)
    db.prepare(
      `INSERT INTO events (id, session_id, ordinal, type, payload, created_at, turn_id, generation)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run('ev_torn', 'sess_torn', 1, 'request_routed', '{"type":"request_rou', NOW + 1, null, 0)
    vi.spyOn(console, 'warn').mockImplementation(() => {})

    const walked = store.decisionsAwaitingAPerson()
    expect(walked.rows.map((one) => one.requestId)).toEqual(['req_good'])
    expect(walked.rowsUnread).toBe(1)
    expect(walked.ledgers).toBe(1)
  })

  it('a walk over the same ledger with nothing torn counts ZERO — the control', () => {
    conversation('sess_whole')
    parksOnAPermission('sess_whole', 'req_good', NOW)
    expect(store.decisionsAwaitingAPerson().rowsUnread).toBe(0)
  })
})

const WORLD: PersonsQueueWorld = {
  held: new Set<string>(),
  answerable: new Map<string, AttentionRequest>(),
  now: NOW,
  lastLookAnswered: { questions: true, decisions: true },
  answeredFromHere: new Set<string>(),
}

const blind = <Row>(): LedgerWalk<Row> => ({
  rows: [],
  walk: 'no-ledger',
  ledgers: 0,
  rowsUnread: 0,
})
const read = <Row>(walk: LedgerWalkKind = 'every-conversation-that-routed'): LedgerWalk<Row> => ({
  rows: [],
  walk,
  ledgers: 4,
  rowsUnread: 0,
})

describe('what the card says when there is nothing in it', () => {
  it('no ledger behind the answer is NOT "Nothing is waiting on you"', () => {
    const view = personsQueueView(blind(), blind(), WORLD)!
    expect(view.noLedger).toBe(true)
    expect(view.heading).not.toContain('Nothing is waiting on you')
    expect(view.heading).toBe('No list could be read at all')
    expect(view.partial).toBe(false)
    expect(view.stale).toBe(false)
  })

  it('the SAME empty rows over ledgers that were read still say the quiet thing', () => {
    const view = personsQueueView(read(), read(), WORLD)!
    expect(view.noLedger).toBe(false)
    expect(view.heading).toBe('Nothing is waiting on you')
  })

  it('a dropped ledger row stops the all-clear too, and says which hole it is', () => {
    const view = personsQueueView({ ...read<never>(), rowsUnread: 2 }, read(), WORLD)!
    expect(view.rowsDropped).toBe(true)
    expect(view.heading).toBe('Some of what is waiting could not be read')
    expect(view.covers['a-question']?.rowsUnread).toBe(2)
    expect(view.covers['a-decision']?.rowsUnread).toBe(0)
  })

  it('a look that has never answered carries NO coverage, and that is not `no-ledger`', () => {
    const view = personsQueueView(null, read(), WORLD)!
    expect(view.covers['a-question']).toBeNull()
    expect(view.partial).toBe(true)
    expect(view.noLedger).toBe(false)
    expect(view.covers['a-decision']).toMatchObject({
      walk: 'every-conversation-that-routed',
      ledgers: 4,
    })
  })

  it('ONE blind look does not blind the card — `every`, and never `some`', () => {
    const view = personsQueueView(read(), blind(), WORLD)!
    expect(view.noLedger).toBe(false)
    expect(view.heading).toBe('Nothing is waiting on you')
    expect(view.covers['a-decision']?.walk).toBe('no-ledger')
    expect(view.covers['a-question']?.walk).toBe('every-conversation-that-routed')
  })

  it('and the sentence is rendered from the word, so the two cannot drift', () => {
    const view = personsQueueView(blind(), blind(), WORLD)!
    expect(view.covers['a-question']?.says).toBe(WALK_COVERS['no-ledger'])
    const seen = personsQueueView(read(), read(), WORLD)!
    expect(seen.covers['a-decision']?.says).toBe(WALK_COVERS['every-conversation-that-routed'])
    expect(view.covers['a-question']?.says).not.toBe(seen.covers['a-decision']?.says)
  })

  it('every one of these holes forbids Home’s all-clear', () => {
    for (const view of [
      personsQueueView(blind(), blind(), WORLD)!,
      personsQueueView({ ...read<never>(), rowsUnread: 1 }, read(), WORLD)!,
    ]) {
      expect(view.mayBeShort).toBe(true)
      expect(homeAttention({ requests: [], onlyYou: 0, unread: view.mayBeShort }).quiet).toBe(false)
    }
    const seen = personsQueueView(read(), read(), WORLD)!
    expect(seen.mayBeShort).toBe(false)
    expect(homeAttention({ requests: [], onlyYou: 0, unread: seen.mayBeShort }).quiet).toBe(true)
  })
})

describe('both readers answer through the real host', () => {
  let userData: string
  let hostDb: AppDatabase
  let hostStore: SessionStore
  let host: RuntimeHost
  let clock: number

  beforeEach(() => {
    userData = mkdtempSync(join(tmpdir(), 'brobot2-queue-host-'))
    hostDb = openDatabase(join(userData, 'brobot2.sqlite'))
    applyMigrations(hostDb, migrationsDir)
    clock = NOW
    hostStore = createSessionStore(hostDb, () => clock++)
    host = new RuntimeHost({
      store: hostStore,
      ...neutralHostDeps(() => userData),
      createRuntime: (provider: Provider) => new FakeRuntime(provider),
      prepareProviderHome: syntheticProviderHome(() => userData),
      providerHomePath: (provider: Provider) => join(userData, 'provider-homes', provider),
      resolveCwd: (sessionId, requested) => resolveSessionCwd(userData, sessionId, requested),
      newSessionId: () => `sess_${clock}`,
      now: () => clock++,
      readProviderConfig: fixtureProviderConfig,
    })
  })

  afterEach(async () => {
    await host.closeAll()
    hostDb.close()
    rmSync(userData, { recursive: true, force: true })
  })

  const started = (id: string): void => {
    hostStore.create({ id, provider: 'codex', cwd: userData, approvalMode: 'ask', profileId: 'd' })
  }

  it('one settling event clears the row from every reader that answers "what is waiting"', () => {
    started('sess_worker')
    hostStore.append(
      'sess_worker',
      0,
      { type: 'request_routed', requestId: 'req_q', to: 'the-parent', parent: 'sess_pm' },
      NOW,
    )
    hostStore.append('sess_worker', 1, { type: 'request_escalated', requestId: 'req_q' }, NOW + 1)
    started('sess_child')
    hostStore.append(
      'sess_child',
      0,
      {
        type: 'request_routed',
        requestId: 'req_d',
        to: 'a-person',
        because: 'a-permission-decision',
        parent: 'sess_pm',
      },
      NOW,
    )
    expect(host.questionsForAPerson().rows).toHaveLength(1)
    expect(host.decisionsForAPerson().rows).toHaveLength(1)

    hostStore.append(
      'sess_worker',
      2,
      { type: 'user_decision', requestId: 'req_q', outcome: 'allow' },
      NOW + 2,
    )
    hostStore.append(
      'sess_child',
      1,
      { type: 'user_decision', requestId: 'req_d', outcome: 'deny' },
      NOW + 2,
    )

    expect(host.questionsForAPerson().rows).toEqual([])
    expect(host.decisionsForAPerson().rows).toEqual([])
    expect(host.decisionsForAPerson()).toMatchObject({
      walk: 'every-conversation-that-routed',
      ledgers: 2,
    })
  })
})
