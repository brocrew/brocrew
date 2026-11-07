import {
  RecordingSink,
  syntheticProviderHome,
  neutralHostDeps,
  fixtureProviderConfig,
} from './lib/host-fixture'
import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { FakeProviderSessions, FakeRuntime } from '@brobot2/runtime'
import type { Provider } from '@brobot2/shared'
import { type AppDatabase, openDatabase } from '../src/main/db/connection'
import { applyMigrations } from '../src/main/db/migrate'
import { createSessionStore, type SessionStore } from '../src/main/db/session-store'
import { RuntimeHost } from '../src/main/runtime/runtime-host'
import { resolveSessionCwd } from '../src/main/runtime/scratch-cwd'
import { agentToolsFor, type ToolName } from '../src/main/runtime/agent-tools'
import {
  MOST_MISSING_ORDINALS_TRACKED,
  NOT_REACHED_THIS_WINDOW,
  acceptEvent,
  createSessionRecord,
  openWindow,
  reopenAtLatest,
} from '../src/renderer/src/lib/session-record'
import type { HistoryWindow, RuntimeEventMessage } from '../src/shared/runtime-ipc'


const here = dirname(fileURLToPath(import.meta.url))
const migrationsFolder = join(here, '../src/main/db/migrations')
const hostSource = readFileSync(join(here, '../src/main/runtime/runtime-host.ts'), 'utf8')


describe('§1 · a refused call and its retry take contiguous ordinals', () => {
  let userData: string
  let work: string
  let db: AppDatabase
  let host: RuntimeHost
  let store: SessionStore
  let sessions: FakeProviderSessions
  let counter: number
  let window: RecordingSink
  let clock: number
  const tick = (): number => clock++

  beforeEach(() => {
    userData = mkdtempSync(join(tmpdir(), 'brobot2-623-'))
    work = mkdtempSync(join(tmpdir(), 'brobot2-623-work-'))
    db = openDatabase(join(userData, 'brobot2.sqlite'))
    applyMigrations(db, migrationsFolder)
    clock = 3_000_000
    store = createSessionStore(db, tick)
    counter = 0
    sessions = new FakeProviderSessions()
    host = new RuntimeHost({
      store,
      ...neutralHostDeps(() => userData),
      createRuntime: () => new FakeRuntime('claude', { sessions }),
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
    rmSync(userData, { recursive: true, force: true })
    rmSync(work, { recursive: true, force: true })
  })

  const aRefusedCallAndItsRetry = async (): Promise<string> => {
    const { sessionId } = await host.createSession(
      { provider: 'claude', profileId: 'pm', cwd: work, approvalMode: 'auto' },
      window,
    )
    const set = agentToolsFor(host, sessionId)
    const call = async (name: ToolName, args: Record<string, unknown>): Promise<void> => {
      const tool = set.tools.find((one) => one.name === name)
      if (tool === undefined) throw new Error(`no such tool: ${name}`)
      await tool.call(args)
    }
    await host.send(sessionId, 'plan the world clock page', window)
    const aGiveToNobody = {
      definition_of_done: 'The requested result and its checks are recorded.',
      profile: 'nobody',
      title: 'a worker',
      brief: 'build the page',
    }
    await call('give_work', aGiveToNobody)
    await call('give_work', aGiveToNobody)
    await host.send(sessionId, 'carry on then', window)
    await vi.waitFor(() => expect(store.events(sessionId).at(-1)?.event.type).toBe('status'))
    return sessionId
  }

  it('🔴 the wire and the ledger both run 0,1,2,… with nothing skipped', async () => {
    const sessionId = await aRefusedCallAndItsRetry()

    const wire = window.messages.map((one) => one.ordinal)
    const ledger = store.events(sessionId).map((one) => one.ordinal)

    const refusalAt = store.events(sessionId).findIndex((one) => one.event.type === 'tool_refused')
    expect(
      refusalAt,
      'no refusal was recorded — the sequence under test did not happen',
    ).toBeGreaterThan(0)
    const kinds = store.events(sessionId).map((one) => one.event.type)
    expect(
      kinds.indexOf('turn'),
      'the refusal landed between turns, not inside one',
    ).toBeGreaterThan(refusalAt)
    expect(kinds.filter((kind) => kind === 'tool_refused')).toHaveLength(2)

    expect(wire).toEqual(wire.map((_, at) => at))
    expect(ledger).toEqual(ledger.map((_, at) => at))
    expect(wire).toEqual(ledger)
  })

  it('⚑ …and the renderer folding that wire reports no hole at all', async () => {
    const sessionId = await aRefusedCallAndItsRetry()
    const record = createSessionRecord(sessionId)
    for (const message of window.messages) acceptEvent(record, message)

    expect(record.missing.size).toBe(0)
    expect(record.missingBeyondTheList).toBe(0)
    expect(holesReportedIn(record)).toEqual([])
  })

  it('⛔ …and the CONTROL: take one message out of that wire and it says so', async () => {
    const sessionId = await aRefusedCallAndItsRetry()
    const record = createSessionRecord(sessionId)
    const dropped = window.messages.findIndex((one) => one.event.type === 'tool_refused') + 1
    expect(dropped).toBeGreaterThan(1)
    for (const [at, message] of window.messages.entries()) {
      if (at !== dropped) acceptEvent(record, message)
    }

    expect(record.missing.size).toBe(1)
    expect(holesReportedIn(record)).toHaveLength(1)
    expect(holesReportedIn(record)[0]).toContain('1 event of this conversation')
  })
})


describe('§2 · every place an ordinal is allocated, and what each one owes', () => {
  const allocations = (): string[] => {
    const at: string[] = []
    let from = 0
    for (;;) {
      const match = /session\.ordinal\+\+|this\.takeLedgerOrdinal\(session\)/g
      match.lastIndex = from
      const found = match.exec(hostSource)?.index ?? -1
      if (found < 0) return at
      const end = hostSource.indexOf('\n  }\n', found)
      expect(end, 'an allocation with no end to its method').toBeGreaterThan(found)
      at.push(hostSource.slice(Math.max(0, found - 300), end))
      from = found + 1
    }
  }

  const writesTheLedger = (source: string): boolean =>
    source.includes('this.deps.store.append(') || source.includes('this.deps.store.recordGive(')

  it('🔴 there are exactly five, and four of them write the ledger', () => {
    const sites = allocations()
    expect(sites, 'an event allocator appeared and nothing classified it').toHaveLength(5)
    expect(hostSource.match(/this\.takeLedgerOrdinal\(session\)/g)).toHaveLength(4)
    const allocator = hostSource.slice(
      hostSource.indexOf('private takeLedgerOrdinal('),
      hostSource.indexOf('\n  }\n', hostSource.indexOf('private takeLedgerOrdinal(')),
    )
    expect(allocator).toContain('this.deps.store.nextOrdinal(session.id)')
    expect(allocator).toContain('session.ordinal = ordinal + 1')
    const appends = sites.filter(writesTheLedger)
    expect(appends).toHaveLength(4)
  })

  it('⛔ the one allocator that does not write the ledger is the recording-failure notice, and its ordinal is never written', () => {
    const [orphan] = allocations().filter((source) => !writesTheLedger(source))
    expect(orphan).toBeDefined()
    expect(orphan).toContain('this.emit(session, {')
    const declares = hostSource.slice(
      hostSource.indexOf('private reportRecordingFailure'),
      hostSource.indexOf('private reportRecordingFailure') + 900,
    )
    expect(declares).toContain('it is not in the ledger')
  })
})


const SESSION = 'sess_623'

const message = (ordinal: number, text: string): RuntimeEventMessage => ({
  sessionId: SESSION,
  ordinal,
  at: 1_800_000_000_000 + ordinal * 1_000,
  event: { type: 'assistant_message', text },
})

const noticesOn = (record: ReturnType<typeof createSessionRecord>): string[] =>
  record.control.items.flatMap((item) => (item.kind === 'notice' ? [item.text] : []))

const holesReportedIn = (record: ReturnType<typeof createSessionRecord>): string[] =>
  noticesOn(record).filter((said) => said.includes(NOT_REACHED_THIS_WINDOW))

const page = (from: number, count: number): HistoryWindow => ({
  entries: Array.from({ length: count }, (_, index) => ({
    ordinal: from + index,
    at: 1_800_000_000_000 + (from + index) * 1_000,
    event: { type: 'assistant_message', text: `reply ${from + index}` } as const,
  })),
  from,
  hasOlder: from > 0,
  turnAligned: true,
})

describe('§3 · the window keeps what it is short by', () => {
  it('🔴 a hole opens, and the SET says which ordinals — not just how far the counter jumped', () => {
    const record = createSessionRecord(SESSION)
    acceptEvent(record, message(0, 'one'))
    acceptEvent(record, message(4, 'five'))
    expect([...record.missing].sort((a, b) => a - b)).toEqual([1, 2, 3])
    expect(record.nextOrdinal).toBe(5)
  })

  it('⚑ a late arrival closes its own hole, and the window says so ONLY when nothing is left', () => {
    const record = createSessionRecord(SESSION)
    acceptEvent(record, message(0, 'one'))
    acceptEvent(record, message(4, 'five'))
    acceptEvent(record, message(1, 'two'))
    expect(noticesOn(record)[1]).toContain('2 events are still missing')
    expect(noticesOn(record)[1]).not.toContain('nothing is missing')

    acceptEvent(record, message(2, 'three'))
    expect(noticesOn(record)[2]).toContain('1 event is still missing')
    acceptEvent(record, message(3, 'four'))
    expect(record.missing.size).toBe(0)
    expect(noticesOn(record)[3]).toContain('nothing is missing from what you are reading')
  })

  it('⛔ an arrival this window was never short by does NOT claim it filled a hole', () => {
    const record = createSessionRecord(SESSION)
    openWindow(record, page(100, 3))
    for (const entry of page(100, 3).entries) acceptEvent(record, { sessionId: SESSION, ...entry })
    expect(record.missing.size).toBe(0)

    acceptEvent(record, message(42, 'an event from before this page'))
    expect(noticesOn(record)).toHaveLength(1)
    expect(noticesOn(record)[0]).not.toContain('nothing is missing')
    expect(noticesOn(record)[0]).toContain('at the end of this list rather than in its place')
  })

  it('⚠️ the LIST is bounded and the COUNT is not, so a huge jump names a number rather than a set', () => {
    const record = createSessionRecord(SESSION)
    const jump = MOST_MISSING_ORDINALS_TRACKED * 3
    acceptEvent(record, message(0, 'one'))
    acceptEvent(record, message(jump, 'much later'))

    expect(record.missing.size).toBe(MOST_MISSING_ORDINALS_TRACKED)
    expect(record.missingBeyondTheList).toBe(jump - 1 - MOST_MISSING_ORDINALS_TRACKED)
    expect(noticesOn(record)[0]).toContain(`${jump - 1} events of this conversation`)
  })

  it('⛔ the cap is on the WINDOW and not on each gap, so a second hole cannot buy another capful', () => {
    const record = createSessionRecord(SESSION)
    const wide = Math.floor(MOST_MISSING_ORDINALS_TRACKED * 0.8)
    acceptEvent(record, message(0, 'one'))
    acceptEvent(record, message(wide + 1, 'after the first hole'))
    expect(record.missing.size).toBe(wide)
    acceptEvent(record, message(wide * 2 + 2, 'after the second'))

    expect(record.missing.size).toBe(MOST_MISSING_ORDINALS_TRACKED)
    expect(record.missingBeyondTheList).toBe(wide * 2 - MOST_MISSING_ORDINALS_TRACKED)
    expect(noticesOn(record)[1]).toContain(`${wide * 2} events of this conversation`)
  })

  it('⛔ …and in that state it can never say a hole closed, because it does not know which', () => {
    const record = createSessionRecord(SESSION)
    const jump = MOST_MISSING_ORDINALS_TRACKED * 3
    acceptEvent(record, message(0, 'one'))
    acceptEvent(record, message(jump, 'much later'))
    for (let ordinal = 1; ordinal <= MOST_MISSING_ORDINALS_TRACKED; ordinal += 1) {
      acceptEvent(record, message(ordinal, `late ${ordinal}`))
    }
    expect(record.missing.size).toBe(0)
    expect(record.missingBeyondTheList).toBeGreaterThan(0)
    expect(noticesOn(record).some((said) => said.includes('nothing is missing'))).toBe(false)
  })

  it('🔴 re-anchoring the window forgets what it was short of — both doors', () => {
    const opened = createSessionRecord(SESSION)
    acceptEvent(opened, message(0, 'one'))
    acceptEvent(opened, message(9, 'ten'))
    expect(opened.missing.size).toBe(8)
    openWindow(opened, page(100, 2))
    expect(opened.missing.size).toBe(0)
    expect(opened.missingBeyondTheList).toBe(0)

    const jumped = createSessionRecord(SESSION)
    acceptEvent(jumped, message(0, 'one'))
    acceptEvent(jumped, message(9, 'ten'))
    expect(jumped.missing.size).toBe(8)
    reopenAtLatest(jumped, page(200, 2))
    expect(jumped.missing.size).toBe(0)
    expect(jumped.missingBeyondTheList).toBe(0)
  })

  it('⚠️ the notice keeps its severity, on the projection and at the moment 064 put it', () => {
    const record = createSessionRecord(SESSION)
    acceptEvent(record, message(0, 'one'))
    acceptEvent(record, message(2, 'three'))
    const [item] = record.control.items.filter((one) => one.kind === 'notice')
    expect(item?.kind === 'notice' && item.level).toBe('warn')
    expect(item?.at).toBe(1_800_000_000_000 + 2_000)
  })
})


describe('§4 · no source in the app writes the retired sentences', () => {
  const codeOf = (body: string): string =>
    body
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/<!--[\s\S]*?-->/g, '')
      .replace(/^\s*\/\/.*$/gm, '')

  const everyAppSource = (): string[] => {
    const out: string[] = []
    const walk = (at: string): void => {
      for (const name of readdirSync(at)) {
        if (name === 'node_modules' || name === 'out' || name === 'dist') continue
        const full = join(at, name)
        if (statSync(full).isDirectory()) walk(full)
        else if (name.endsWith('.ts') || name.endsWith('.vue')) out.push(full)
      }
    }
    walk(join(here, '../src'))
    return out
  }

  it('⛔ neither *event stream gap* nor *event out of order* is composed anywhere in the app', () => {
    const still = everyAppSource().filter((file) => {
      const code = codeOf(readFileSync(file, 'utf8'))
      return code.includes('event stream gap') || code.includes('event out of order')
    })
    expect(still.map((file) => basename(file))).toEqual([])
  })

  it('⚑ …and the walk CAN find a sentence in that tree, because it finds this one', () => {
    const found = everyAppSource().filter((file) =>
      codeOf(readFileSync(file, 'utf8')).includes(NOT_REACHED_THIS_WINDOW),
    )
    expect(found.map((file) => basename(file))).toEqual(['session-record.ts'])
  })
})
