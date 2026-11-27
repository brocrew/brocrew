import { callOn, textOf } from './helpers/call-tool'
import { waitFor } from './lib/f093-host'
import { neutralHostDeps, fixtureProviderConfig, RecordingSink } from './lib/host-fixture'
import { ProviderDouble } from './lib/provider-double'
import { closeAndRemove, homesUnder } from './helpers/scratch-host'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { FakeProviderSessions, type FakeSessionHandle } from '@brobot2/runtime/testing'
import type { Provider } from '@brobot2/shared'
import { type AppDatabase, openDatabase } from '../src/main/db/connection'
import { applyMigrations } from '../src/main/db/migrate'
import { createSessionStore, type SessionStore } from '../src/main/db/session-store'
import { RuntimeHost, THE_APP_ITSELF } from '../src/main/runtime/runtime-host'
import { agentToolsFor } from '../src/main/runtime/agent-tools'

type AgentToolset = ReturnType<typeof agentToolsFor>

const migrationsFolder = join(__dirname, '../src/main/db/migrations')

describe('675 M20 · abandoned prints why it cannot come back', () => {
  let userData: string
  let root: string
  let db: AppDatabase
  let store: SessionStore
  let host: RuntimeHost
  let handles: FakeSessionHandle[]
  let issued: FakeProviderSessions
  let counter: number
  let clock: number
  let window: RecordingSink
  const tick = (): number => clock++

  beforeEach(() => {
    userData = mkdtempSync(join(tmpdir(), 'brobot2-675-m20-'))
    root = mkdtempSync(join(tmpdir(), 'brobot2-675-m20-root-'))
    db = openDatabase(join(userData, 'brobot2.sqlite'))
    applyMigrations(db, migrationsFolder)
    clock = 7_000_000
    store = createSessionStore(db, tick)
    counter = 0
    handles = []
    issued = new FakeProviderSessions()
    host = new RuntimeHost({
      store,
      ...neutralHostDeps(() => userData),
      ...homesUnder(() => userData),
      createRuntime: (provider: Provider) => new ProviderDouble(provider, handles, issued),
      newSessionId: () => `sess_${String(++counter)}`,
      now: tick,
      readProviderConfig: fixtureProviderConfig,
    })
    window = new RecordingSink('webContents:1')
  })

  afterEach(async () => {
    await closeAndRemove([host], db, userData, root)
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

  const ledger = (sessionId: string) => store.events(sessionId).map((entry) => entry.event)

  const latestHandle = (): FakeSessionHandle => {
    const handle = handles.at(-1)
    if (handle === undefined) throw new Error('no provider handle has been issued')
    return handle
  }

  /** A PM in a window with one child of its own, started by a give through the real door (D-016). */
  const aPmAndItsWorker = async (): Promise<{
    pm: string
    worker: string
    pmTools: AgentToolset
    workerHandle: FakeSessionHandle
  }> => {
    const pmProfile = 'pm-1'
    const workerProfile = 'worker-1'
    await bringIdentityIntoBeing(workerProfile)
    const pm = await personOpens(pmProfile)
    const pmTools = agentToolsFor(host, pm)
    const spawned = await callOn(pmTools, 'give_work', {
      to: 'new',
      conversation_title: 'The work this row is about',
      definition_of_done: 'The requested result and its checks are recorded.',
      profile: workerProfile,
      title: 'The work this row is about',
      brief: 'the work this row is about',
    })
    expect(spawned.outcome, JSON.stringify(spawned)).toBe('ok')
    return { pm, worker: spawned.agent as string, pmTools, workerHandle: latestHandle() }
  }

  /** Raise a question on the child and wait for the app to have ROUTED it. */
  const childAsks = async (
    child: string,
    handle: FakeSessionHandle,
    prompt = 'which branch?',
    options: readonly string[] = ['main', 'dev'],
  ): Promise<{ id: string }> => {
    const raised = handle.simulateUserInput(prompt, options, false)
    await waitFor(
      () =>
        ledger(child).some(
          (event) => event.type === 'request_routed' && event.requestId === raised.id,
        ),
      `the routing of ${raised.id}`,
    )
    return raised
  }

  const lineFor = (text: string, id: string): string =>
    text.split('\n').find((one) => one.includes(id)) ?? ''

  it('a historical abandoned question names why it cannot be answered, not just the word', async () => {
    const { pm, worker, pmTools, workerHandle } = await aPmAndItsWorker()
    const original = await childAsks(worker, workerHandle)
    const asked = { id: `historical_${original.id}` }
    const event = ledger(worker).find(
      (event) => event.type === 'user_input_request' && event.id === original.id,
    )
    if (event?.type !== 'user_input_request') throw new Error('no native question to copy')
    // Imported native question from before the routing change; a distinct ID keeps the live person request separate.
    store.append(worker, store.nextOrdinal(worker), { ...event, id: asked.id }, tick())
    store.append(
      worker,
      store.nextOrdinal(worker),
      {
        type: 'request_routed',
        requestId: asked.id,
        to: 'the-parent',
        parent: pm,
      },
      tick(),
    )

    // Measured BEFORE as well: while the request is still open, nothing in the sentence table
    // applies to it, so its line carries no parenthetical at all — the fixture's own control.
    const before = lineFor(await textOf(pmTools, 'list_questions'), asked.id)
    expect(before).toContain('open')
    expect(before).not.toContain('cannot be answered')
    // A provider's own question is listed as the person's, not as one this caller may answer.
    expect(before).toContain('a person answers this one at its card')
    const listed = await callOn(pmTools, 'list_questions', {})
    const row = (listed.questions as { question: string; answerable_by_you: boolean }[]).find(
      (one) => one.question === asked.id,
    )
    expect(row?.answerable_by_you).toBe(false)

    const refused = await callOn(pmTools, 'answer_question', {
      question: asked.id,
      answers: [{ part: 'q0', answer: ['main'] }],
    })
    expect(refused).toMatchObject({ outcome: 'refused', rail: 'a-person-answers-this-one' })
    expect(store.routedRequestsOf(worker).find((one) => one.requestId === asked.id)?.state).toBe(
      'open',
    )

    // Closing the conversation ends its native requests, including the imported historical one.
    await host.close(worker, THE_APP_ITSELF)

    // ⚑ A question that is over is listed when asked for.
    const after = await callOn(pmTools, 'list_questions', { state: 'all' })
    const rows = after.questions as { question: string; state: string }[]
    expect(rows.find((one) => one.question === asked.id)?.state).toBe('abandoned')

    const line = lineFor(await textOf(pmTools, 'list_questions', { state: 'all' }), asked.id)
    expect(line).toContain('abandoned')
    // 🔴 **The sentence, by name** (standing rule 5): a reader that sees only `abandoned` is left to
    // guess whether the question comes back. It does not, and this is the fact that says so.
    expect(line).toContain(
      '(the conversation that raised it stopped while it was waiting, and the request stopped with it, so it cannot be answered)',
    )
    expect(line).not.toContain('ask it again')
  })
})
