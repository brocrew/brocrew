import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  FakeProviderSessions,
  type AgentInfo,
  type FakeSessionHandle,
  type ResumeOptions,
  type SessionRef,
  type StartOptions,
} from '@brobot2/runtime'
import type { Provider } from '@brobot2/shared'
import { type AppDatabase, openDatabase } from '../src/main/db/connection'
import { applyMigrations } from '../src/main/db/migrate'
import { createSessionStore, type SessionStore } from '../src/main/db/session-store'
import { NO_DISCOVERY } from '../src/main/adopt/discover-sessions'
import { RuntimeHost, type RuntimeEventSink } from '../src/main/runtime/runtime-host'
import { resolveSessionCwd } from '../src/main/runtime/scratch-cwd'
import type { RuntimeEventMessage, SessionLivenessMessage } from '../src/shared/runtime-ipc'
import { ProviderDouble, anOpenGate, type ResumeGate } from './lib/provider-double'

/**
 * # What a Claude conversation's row keeps as its reported effort, across a reopen
 *
 * The host keeps on each row what the provider last reported it runs. Claude states an effort only
 * as a turn ends, so a reopened conversation's first `init` names its model and no effort: the
 * first report of a life keeps the effort on record while the model is the one on record, and only
 * the first — later in a life, a report with no effort means the ask or the model moved. No test
 * drives a report with no effort onto a row that holds one, so none of this is reached:
 *
 *  - §1 🔴 a reopen whose first report names the same model and no effort keeps the effort on
 *    record; ⚑ a reported level then replaces it; ⛔ a later report in the same life naming no
 *    effort clears it.
 *  - §2 ⛔ a reopen whose first report names another model keeps no effort from the old one —
 *    beside the same reopen naming the same model, which does.
 *
 * Real host, real SQLite ledger; the provider is the double, its handle reporting whatever
 * `AgentInfo` the test sets, read as each event is pumped. Scratch folders only.
 */
describe('the effort on record across a Claude conversation’s lives', () => {
  class Window implements RuntimeEventSink {
    readonly aPersonIsBehindIt = true
    readonly messages: RuntimeEventMessage[] = []
    readonly liveness: SessionLivenessMessage[] = []
    alive = true
    constructor(readonly ownerId: string) {}
    send(message: RuntimeEventMessage): void {
      this.messages.push(message)
    }
    sendLiveness(message: SessionLivenessMessage): void {
      this.liveness.push(message)
    }
  }

  /** What every handle reports it runs, read afresh each time the host asks. */
  interface Reporting {
    info: AgentInfo | undefined
  }

  /** The double, its handles reporting `reporting.info` — as Claude's adapter reports its own. */
  class ReportingDouble extends ProviderDouble {
    constructor(
      provider: Provider,
      handles: FakeSessionHandle[],
      sessions: FakeProviderSessions,
      gate: ResumeGate,
      private readonly reporting: Reporting,
    ) {
      super(provider, handles, sessions, gate)
    }
    override async start(options: StartOptions): Promise<FakeSessionHandle> {
      return this.reports(await super.start(options))
    }
    override async resume(ref: SessionRef, options: ResumeOptions): Promise<FakeSessionHandle> {
      return this.reports(await super.resume(ref, options))
    }
    private reports(handle: FakeSessionHandle): FakeSessionHandle {
      Object.defineProperty(handle, 'agentInfo', {
        get: () => this.reporting.info,
        configurable: true,
      })
      return handle
    }
  }

  let scratch: string
  let userData: string
  let workspace: string
  let db: AppDatabase
  let store: SessionStore
  let host: RuntimeHost
  let handles: FakeSessionHandle[]
  let window: Window
  let counter: number
  let reporting: Reporting

  beforeEach(() => {
    scratch = mkdtempSync(join(tmpdir(), 'brobot2-effort-on-record-'))
    userData = join(scratch, 'userData')
    workspace = join(scratch, 'workspace')
    for (const folder of [userData, workspace]) mkdirSync(folder, { recursive: true })
    const here = dirname(fileURLToPath(import.meta.url))
    db = openDatabase(join(userData, 'brobot2.sqlite'))
    applyMigrations(db, join(here, '../src/main/db/migrations'))
    store = createSessionStore(db)
    handles = []
    counter = 0
    reporting = { info: undefined }
    const sessions = new FakeProviderSessions()
    host = new RuntimeHost({
      store,
      discoverSessions: NO_DISCOVERY,
      nativeTranscriptPath: () => null,
      exportDirectory: () => join(userData, 'exports'),
      createRuntime: (provider: Provider) =>
        new ReportingDouble(provider, handles, sessions, anOpenGate(), reporting),
      prepareProviderHome: (provider: Provider, profileId?: string) => {
        const home = join(userData, 'provider-homes', profileId ?? 'default', provider)
        mkdirSync(home, { recursive: true })
        return home
      },
      providerHomePath: (provider: Provider) => join(userData, 'provider-homes', provider),
      resolveCwd: (sessionId, requested) => resolveSessionCwd(userData, sessionId, requested),
      newSessionId: () => `sess_${String(++counter)}`,
      readProviderConfig: (_provider, home) => ({
        home,
        homeEnv: 'CLAUDE_CONFIG_DIR',
        model: 'm',
        authNote: null,
        files: [],
      }),
    })
    window = new Window('webContents:1')
  })

  afterEach(async () => {
    await host.closeAll()
    db.close()
    rmSync(scratch, { recursive: true, force: true })
  })

  const waitFor = async (what: string, done: () => boolean): Promise<void> => {
    const until = Date.now() + 4_000
    while (Date.now() < until) {
      if (done()) return
      await new Promise((resolve) => setTimeout(resolve, 5))
    }
    throw new Error(`timed out waiting for ${what}`)
  }

  const turnsEnded = (id: string): number =>
    store.events(id).filter((entry) => entry.event.type === 'turn').length

  /** A person's message, and its turn ended — every event of it pumped past the host's record. */
  const aTurn = async (id: string, text: string): Promise<void> => {
    const before = turnsEnded(id)
    await host.queueMessage(id, text, window)
    await waitFor(`the turn “${text}”`, () => turnsEnded(id) > before)
  }

  const onRecord = (id: string) => {
    const runsOn = store.whatItRunsOn(id)
    return { model: runsOn?.reportedModel ?? null, effort: runsOn?.reportedEffort ?? null }
  }

  /** A Claude conversation, started and closed reporting nothing, with `model` at `effort` on record. */
  const aClosedConversation = async (model: string, effort: string): Promise<string> => {
    reporting.info = undefined
    const { sessionId } = await host.createSession(
      { provider: 'claude', cwd: workspace, approvalMode: 'auto' },
      window,
    )
    await host.close(sessionId, window)
    store.setReportedModel(sessionId, model, effort)
    expect(onRecord(sessionId)).toEqual({ model, effort })
    return sessionId
  }

  /** Reopened, its first report `info`, and a turn run so that report has surely been recorded. */
  const reopenedReporting = async (id: string, info: AgentInfo): Promise<void> => {
    reporting.info = info
    await host.resumeSession(id, window)
    await aTurn(id, 'the first turn of this life')
  }

  it('§1 · 🔴 a reopen’s first report, same model and no effort, keeps the effort on record — ⛔ a later one in the same life does not', async () => {
    const id = await aClosedConversation('m', 'high')
    await reopenedReporting(id, {
      model: 'm',
      reasoningEffort: 'medium',
      reasoningEffortReported: false,
    })
    // 🔴 Kept: the first init of a life names no effort, which is not a report that it changed.
    expect(onRecord(id)).toEqual({ model: 'm', effort: 'high' })

    // ⚑ A turn's end reports a level, which replaces it.
    reporting.info = { model: 'm', reasoningEffort: 'max', reasoningEffortReported: true }
    await aTurn(id, 'a reported level')
    expect(onRecord(id)).toEqual({ model: 'm', effort: 'max' })

    // ⛔ Later in the same life, a report with no effort — the ask moved — clears it.
    reporting.info = { model: 'm', reasoningEffort: 'low', reasoningEffortReported: false }
    await aTurn(id, 'a new ask')
    expect(onRecord(id)).toEqual({ model: 'm', effort: null })
  })

  it('§2 · ⛔ a reopen whose first report names another model keeps no effort — ⚑ one naming the same model does', async () => {
    // ⚑ The control: same model on the first report — kept.
    const same = await aClosedConversation('m', 'high')
    await reopenedReporting(same, {
      model: 'm',
      reasoningEffort: 'medium',
      reasoningEffortReported: false,
    })
    expect(onRecord(same)).toEqual({ model: 'm', effort: 'high' })
    await host.close(same, window)

    // ⛔ Another model on the first report — the old model's effort is not carried over.
    const moved = await aClosedConversation('m', 'high')
    await reopenedReporting(moved, {
      model: 'm2',
      reasoningEffort: 'medium',
      reasoningEffortReported: false,
    })
    expect(onRecord(moved)).toEqual({ model: 'm2', effort: null })
  })
})
