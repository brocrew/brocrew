import type { AgentState } from '../src/shared/agent-state-contracts'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { FakeProviderSessions, FakeRuntime } from '@brobot2/runtime'
import type { Provider } from '@brobot2/shared'
import { type AppDatabase, openDatabase } from '../src/main/db/connection'
import { applyMigrations } from '../src/main/db/migrate'
import { createSessionStore, type SessionStore } from '../src/main/db/session-store'
import { RuntimeHost,  } from '../src/main/runtime/runtime-host'
import { agentToolsFor, type ToolName } from '../src/main/runtime/agent-tools'
import { resolveSessionCwd } from '../src/main/runtime/scratch-cwd'
import {
  fixtureProviderConfig,
  RecordingSink,
  syntheticProviderHome,
  neutralHostDeps,
} from './lib/host-fixture'

const here = dirname(fileURLToPath(import.meta.url))
const migrationsFolder = join(here, '../src/main/db/migrations')

describe('an answer to an asker the quit left open really starts it', () => {
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
      ...neutralHostDeps(() => userData),
      createRuntime: (provider: Provider) => new FakeRuntime(provider, { sessions: issued }),
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
    userData = mkdtempSync(join(tmpdir(), 'brobot2-quit-asker-'))
    root = mkdtempSync(join(tmpdir(), 'brobot2-quit-asker-root-'))
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
    host.agentCard(sessionId)?.state

  async function waitFor(predicate: () => boolean, what: string): Promise<void> {
    for (let attempt = 0; attempt < 400; attempt++) {
      if (predicate()) return
      await new Promise((resolve) => setTimeout(resolve, 10))
    }
    throw new Error(`timed out waiting for ${what}`)
  }

  it('the asker is WAITING ON THE PEER’S ANSWER right after a quit, with nothing running, and the peer’s answer starts it', async () => {
    const ada = await personOpens('default')
    const bo = await personOpens('reviewer')
    const asked = await callOn(ada, 'ask_question', {
      who_answers: 'an-agent',
      agent: bo,
      question: 'which schema do you use?',
    })
    expect(asked.outcome, JSON.stringify(asked)).toBe('ok')
    const id = asked.question as string

    // The quit, then the next launch with its own store object.
    await host.closeAll()
    store = createSessionStore(db, tick)
    host = buildHost()

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

    // A delivery that skipped the start would still leave words in the ledger, so read what only a
    // running asker shows: the host registered it and its turn is parked on the provider's card.
    await waitFor(() => host.sessionIds.includes(ada), 'the answer to start the asker')
    await waitFor(() => stateOf(ada)?.is === 'needs-you', 'the answer’s turn to reach the asker')
    expect(stateOf(ada)).toEqual({ is: 'needs-you' })
  })
})
