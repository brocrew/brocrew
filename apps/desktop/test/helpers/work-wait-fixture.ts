import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, expect, vi } from 'vitest'
import { FakeProviderSessions } from '@brobot2/runtime'
import type { FakeSessionHandle, ResumeOptions, SessionRef, StartOptions } from '@brobot2/runtime'
import type { Provider } from '@brobot2/shared'
import type { TranscriptEvent } from '../../src/shared/conversation-events'
import { type AppDatabase, openDatabase } from '../../src/main/db/connection'
import { applyMigrations } from '../../src/main/db/migrate'
import { createSessionStore, type SessionStore } from '../../src/main/db/session-store'
import { limitsWriterSampler } from '../../src/main/db/fresh-limits-snapshot'
import { windowWriterSampler } from '../../src/main/db/window-writer-stamp'
import { RuntimeHost, type RuntimeEventSink } from '../../src/main/runtime/runtime-host'
import { agentToolsFor } from '../../src/main/runtime/agent-tools'
import { resourcesRoot } from '../../src/main/resources/resources'
import { turnsTheAppCutIn } from '../../src/main/turns-the-app-cut-file'
import { resolveSessionCwd } from '../../src/main/runtime/scratch-cwd'
import { DEFAULT_PROFILE_ID, type RuntimeEventMessage } from '../../src/shared/runtime-ipc'
import { neutralHostDeps } from '../lib/host-fixture'
import { HandleKeepingRuntime as ProviderDouble } from './handle-keeping-runtime'
import { countSqlReads, settle } from './persisted-wait-revision-cases'

const here = dirname(fileURLToPath(import.meta.url))
const migrationsFolder = join(here, '../../src/main/db/migrations')

class RecordingSink implements RuntimeEventSink {
  readonly aPersonIsBehindIt = true
  readonly messages: RuntimeEventMessage[] = []
  alive = true
  constructor(readonly ownerId: string) {}
  send(message: RuntimeEventMessage): void {
    this.messages.push(message)
  }
  sendLiveness(): void {}
}

/** What each test of a work wait starts from; every field is set afresh before each test. */
interface WorkWaitState {
  userData: string
  root: string
  db: AppDatabase
  store: SessionStore
  host: RuntimeHost
  handles: FakeSessionHandle[]
  clock: number
  freezeClock: boolean
  keepTurnsOpen: boolean
  failResume: boolean
  startGap: number
  firstLoad: Promise<void> | undefined
  build: () => RuntimeHost
  sqlReads: string[] | null
  stampsAvailable: boolean
}

/**
 * A runtime host without a window over a fresh database for each test, whose 60 s reconciler
 * tick a test runs by hand with `cycle`. Call it once in a describe: the one object it returns
 * holds the running test's state, and a test may change any of its fields.
 */
export function aWorkWaitFixture() {
  const f = {} as WorkWaitState
  let counter: number
  let intervals: (() => void)[]
  const tick = () => (f.freezeClock ? f.clock : f.clock++)
  const window = new RecordingSink('webContents:271')
  const record = (owner: string, event: TranscriptEvent) => {
    ;(
      f.host as unknown as { writeIntoItsLedger(owner: string, event: TranscriptEvent): void }
    ).writeIntoItsLedger(owner, event)
  }
  const receipts = (owner: string, piece: string) => f.store.reconciliationReceipts(owner, piece)
  const captureLegacyCut = () => {
    f.db.exec('DROP TABLE work_legacy_stall_cut')
    f.db.exec(
      readFileSync(join(migrationsFolder, '0010_the_legacy_stall_cut.sql'), 'utf8').replaceAll(
        '--> statement-breakpoint',
        '',
      ),
    )
  }

  const notices = (owner: string) =>
    f.store
      .events(owner)
      .filter(
        (one) =>
          one.event.type === 'message_queued' &&
          one.event.appNotice === 'a-work-wait-needs-attention',
      )
  const cycle = async () => {
    intervals.at(-1)!()
    await settle()
  }
  const giveToNewWorker = async (
    owner: string,
    task: { profile: string; title: string; brief: string; definition_of_done: string },
  ) => {
    const { tools } = agentToolsFor(f.host, owner)
    const made = await tools
      .find((tool) => tool.name === 'create_agent')!
      .call({
        profile_slug: task.profile,
      })
    expect(made.structured).toMatchObject({ outcome: 'ok' })
    return tools
      .find((tool) => tool.name === 'give_work')!
      .call({
        ...task,
        to: 'new',
        conversation_title: task.title,
      })
  }

  const create = async () => {
    const { sessionId } = await f.host.createSession(
      { provider: 'claude', profileId: DEFAULT_PROFILE_ID, approvalMode: 'auto', cwd: f.root },
      window,
    )
    return { owner: sessionId, work: f.store.rootOf(sessionId)! }
  }
  const waiting = (owner: string, piece: string, on?: Record<string, unknown>) =>
    record(owner, {
      type: 'work_status_set',
      piece,
      line: 'waiting for the fictional target',
      by: owner,
      waiting: true,
      ...(on === undefined ? {} : { on }),
    } as TranscriptEvent)

  beforeEach(() => {
    f.userData = mkdtempSync(join(tmpdir(), 'brobot-reconcile-'))
    f.root = mkdtempSync(join(tmpdir(), 'brobot-reconcile-root-'))
    f.db = openDatabase(join(f.userData, 'brobot2.sqlite'))
    applyMigrations(f.db, migrationsFolder)
    f.sqlReads = null
    f.db = countSqlReads(f.db, (sql) => f.sqlReads?.push(sql))
    f.clock = 1_800_000_000_000
    f.freezeClock = false
    f.store = createSessionStore(f.db, tick)
    f.stampsAvailable = true
    const contentStamp = limitsWriterSampler(
      f.db,
      () => f.store.canReadFreshSnapshot?.() === true,
      () => f.clock,
    )
    const windowStamp = windowWriterSampler(
      f.db,
      () => f.store.canReadFreshSnapshot?.() === true,
      () => f.clock,
    )
    f.firstLoad = undefined
    f.handles = []
    counter = 0
    f.keepTurnsOpen = false
    f.failResume = false
    f.startGap = 1
    intervals = []
    const actualInterval = globalThis.setInterval
    vi.spyOn(globalThis, 'setInterval').mockImplementation(((
      fn: () => void,
      ms: number,
      ...args: unknown[]
    ) => {
      if (ms === 60_000) intervals.push(fn)
      return Reflect.apply(actualInterval, globalThis, [fn, ms, ...args]) as ReturnType<
        typeof setInterval
      >
    }) as typeof setInterval)
    const issued = new FakeProviderSessions()
    class Runtime extends ProviderDouble {
      private fit(handle: FakeSessionHandle) {
        if (f.keepTurnsOpen) {
          const machine = (
            handle as unknown as { machine: { beginTurn(): number | null; refusedTurn(): Error } }
          ).machine
          handle.send = async () => {
            if (machine.beginTurn() === null) throw machine.refusedTurn()
          }
        }
        return handle
      }
      override async start(options: StartOptions) {
        return this.fit(await super.start(options))
      }
      override async resume(ref: SessionRef, options: ResumeOptions) {
        if (f.failResume) throw new Error('fictional provider start failed')
        return this.fit(await super.resume(ref, options))
      }
    }
    f.build = () =>
      new RuntimeHost({
        afterFirstWindowLoad: f.firstLoad,
        turnsTheAppCut: turnsTheAppCutIn(f.db),
        store: f.store,
        limitsWriterStamp: () => (f.stampsAvailable ? contentStamp() : null),
        windowWriterStamp: (query) => (f.stampsAvailable ? windowStamp(query) : null),
        ...neutralHostDeps(() => f.userData),
        resourcesRoot: () => resourcesRoot(f.userData),
        createRuntime: (provider: Provider) => new Runtime(provider, f.handles, issued),
        prepareProviderHome: (provider, profileId) => {
          const home = join(f.userData, 'provider-homes', profileId ?? 'default', provider)
          mkdirSync(home, { recursive: true })
          return home
        },
        providerHomePath: (provider) => join(f.userData, 'provider-homes', provider),
        resolveCwd: (sessionId, requested) => resolveSessionCwd(f.userData, sessionId, requested),
        newSessionId: () => `fictional-${++counter}`,
        now: tick,
        startGapMs: f.startGap,
        readProviderConfig: (_provider, home) => ({
          home,
          homeEnv: 'CLAUDE_CONFIG_DIR',
          model: 'm',
          authNote: null,
          files: [],
        }),
      })
    f.host = f.build()
  })
  afterEach(async () => {
    await f.host.closeAll()
    vi.restoreAllMocks()
    f.db.close()
    for (const folder of [f.userData, f.root]) rmSync(folder, { recursive: true, force: true })
  })

  return Object.assign(f, {
    tick,
    window,
    record,
    receipts,
    captureLegacyCut,
    notices,
    cycle,
    giveToNewWorker,
    create,
    waiting,
  })
}
