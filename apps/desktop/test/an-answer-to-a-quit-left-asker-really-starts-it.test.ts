import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { FakeProviderSessions, FakeRuntime } from '@brobot2/runtime'
import type { Provider } from '@brobot2/shared'
import { type AppDatabase, openDatabase } from '../src/main/db/connection'
import { applyMigrations } from '../src/main/db/migrate'
import { createSessionStore, type SessionStore } from '../src/main/db/session-store'
import { NO_DISCOVERY } from '../src/main/adopt/discover-sessions'
import { RuntimeHost, THE_APP_ITSELF } from '../src/main/runtime/runtime-host'
import type { RuntimeEventSink } from '../src/main/runtime/runtime-host'
import { agentToolsFor, type ToolName } from '../src/main/runtime/agent-tools'
import { resolveSessionCwd } from '../src/main/runtime/scratch-cwd'
import type { RuntimeEventMessage } from '../src/shared/runtime-ipc'
import type { AgentState } from '../src/shared/agent-state'

/**
 * 🔴 **D-009 · F012, decision 4's answer half — an answer to an asker the quit left open STARTS
 * it, rather than only recording words nobody is running to read.**
 *
 * ⛔ **What `agents-ask-each-other.test.ts` §3 measures instead.** That test's `toldIn` reads the
 * asker's LEDGER, and `deliverAnswer`'s held-message write ({@link RuntimeHost}'s
 * `holdUntilItStarts`) appends the `message_queued` row before it ever tries to start the asker —
 * so a delivery that skips the start still leaves the words in the ledger, and that assertion
 * passes whether or not the asker actually came up. ⚑ **This file asks the other question**: did
 * the answer really start the asker?
 *
 * ⚑ **D-017 · R11 — the state no longer says whether a process runs** (`05` rule 5): after the quit
 * the asker reads *waiting on <name>'s answer* (R19 — its question is the peer's to answer), not a
 * process word. ⛔ So the start is read off what only a RUNNING asker can show: the host has
 * registered it ({@link RuntimeHost.sessionIds} — a session it can talk to), and its own state is
 * *needs you* — the provider double's representative turn, begun by the delivered answer, is parked
 * on its permission card, which nothing but a running provider holds. A `deliverAnswer` that skipped
 * the start would leave the asker unregistered, with no turn to park on a card.
 *
 * ⚑ **Real host, real SQLite ledger, real toolsets; the only double is the provider** — the same
 * shape `a-childs-state.test.ts` uses.
 */

const here = dirname(fileURLToPath(import.meta.url))
const migrationsFolder = join(here, '../src/main/db/migrations')

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

describe('D-009 · an answer to an asker the quit left open really starts it', () => {
  let userData: string
  let root: string
  let db: AppDatabase
  let store: SessionStore
  let host: RuntimeHost
  let hosts: RuntimeHost[]
  let issued: FakeProviderSessions
  let counter: number
  let clock: number
  let window: RecordingSink
  const tick = (): number => clock++

  const buildHost = (): RuntimeHost => {
    const built = new RuntimeHost({
      store,
      discoverSessions: NO_DISCOVERY,
      nativeTranscriptPath: () => null,
      exportDirectory: () => join(userData, 'exports'),
      createRuntime: (provider: Provider) => new FakeRuntime(provider, { sessions: issued }),
      prepareProviderHome: (provider: Provider, profileId?: string) => {
        const home = join(userData, 'provider-homes', profileId ?? 'default', provider)
        mkdirSync(home, { recursive: true })
        return home
      },
      providerHomePath: (provider: Provider) => join(userData, 'provider-homes', provider),
      resolveCwd: (sessionId, requested) => resolveSessionCwd(userData, sessionId, requested),
      newSessionId: () => `sess_${++counter}`,
      now: tick,
      readProviderConfig: (provider, home) => ({
        home,
        homeEnv: 'CLAUDE_CONFIG_DIR',
        model: 'm',
        authNote: null,
        files: [],
      }),
    })
    hosts.push(built)
    return built
  }

  beforeEach(() => {
    userData = mkdtempSync(join(tmpdir(), 'brobot2-m13-'))
    root = mkdtempSync(join(tmpdir(), 'brobot2-m13-root-'))
    db = openDatabase(join(userData, 'brobot2.sqlite'))
    applyMigrations(db, migrationsFolder)
    clock = 9_000_000
    store = createSessionStore(db, tick)
    counter = 0
    hosts = []
    issued = new FakeProviderSessions()
    host = buildHost()
    window = new RecordingSink('webContents:1')
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

  const callOn = async (
    sessionId: string,
    name: ToolName,
    args: Record<string, unknown>,
  ): Promise<Record<string, unknown>> => {
    const set = agentToolsFor(host, sessionId)
    const tool = set.tools.find((one) => one.name === name)
    if (tool === undefined) throw new Error(`no such tool: ${name}`)
    return (await tool.call(args)).structured as Record<string, unknown>
  }

  const stateOf = (sessionId: string): AgentState | undefined =>
    host.agentCard(sessionId, THE_APP_ITSELF, sessionId)?.state

  async function waitFor(predicate: () => boolean, what: string): Promise<void> {
    for (let attempt = 0; attempt < 400; attempt++) {
      if (predicate()) return
      await new Promise((resolve) => setTimeout(resolve, 10))
    }
    throw new Error(`timed out waiting for ${what}`)
  }

  it('🔴 the asker is WAITING ON THE PEER’S ANSWER right after a quit, with nothing running, and the peer’s answer starts it', async () => {
    const ada = await personOpens('default')
    const bo = await personOpens('reviewer')
    const asked = await callOn(ada, 'ask_question', {
      who_answers: 'an-agent',
      agent: bo,
      question: 'which schema do you use?',
    })
    expect(asked.outcome, JSON.stringify(asked)).toBe('ok')
    const id = asked.question as string

    // ⚑ The quit — a stop, never an ending (D-017 · R3) — then the next launch, with its own store
    // object (`a-next-launch-test-needs-its-own-store-object`).
    await host.closeAll()
    store = createSessionStore(db, tick)
    host = buildHost()

    // ⛔ **THE BEFORE, paired so the assertion below is not vacuous**: nothing is running in
    // either conversation yet — a fresh host has started nobody. ⚑ D-017 · R11 · R19: the asker's
    // state is the question it is waiting on, the one its record holds; ⚑ F036 · and the peer owes
    // it an answer, which its own state now says, read from the asker's record, not running either.
    expect(host.sessionIds).not.toContain(ada)
    expect(host.sessionIds).not.toContain(bo)
    expect(stateOf(ada)).toMatchObject({ is: 'waiting-on-an-answer' })
    expect(stateOf(bo)).toMatchObject({
      is: 'owes-an-answer',
      to: [expect.stringContaining('Ada')],
    })

    await host.resumeSession(bo, window)
    const answered = await callOn(bo, 'answer_question', {
      question: id,
      asked_by: ada,
      answers: [{ part: 'answer', answer: ['still the one in schema.sql'] }],
    })
    expect(answered.outcome, JSON.stringify(answered)).toBe('ok')

    // 🔴 **THE ONE FACT this file exists to pin**: the answer did not just leave words in Ada's
    // ledger for nobody to read — it actually started Ada. A `deliverAnswer` that skips
    // `ensureRunning` returns `null` (success) here too, so this can only be told apart from what a
    // running asker shows, never from `answer_question`'s outcome or Ada's ledger: the host has
    // registered her, and the turn the answer began is parked on the provider's own card.
    await waitFor(() => host.sessionIds.includes(ada), 'the answer to start the asker')
    await waitFor(() => stateOf(ada)?.is === 'needs-you', 'the answer’s turn to reach the asker')
    expect(stateOf(ada)).toEqual({ is: 'needs-you' })
  })
})
