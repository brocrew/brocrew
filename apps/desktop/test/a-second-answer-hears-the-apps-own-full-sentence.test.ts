import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { FakeProviderSessions, FakeRuntime } from '@brobot2/runtime'
import type { AgentToolset, StartOptions } from '@brobot2/runtime'
import type { Provider } from '@brobot2/shared'
import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { type AppDatabase, openDatabase } from '../src/main/db/connection'
import { applyMigrations } from '../src/main/db/migrate'
import { createSessionStore, type SessionStore } from '../src/main/db/session-store'
import { NO_DISCOVERY } from '../src/main/adopt/discover-sessions'
import { RuntimeHost } from '../src/main/runtime/runtime-host'
import type { RuntimeEventSink } from '../src/main/runtime/runtime-host'
import type { ToolName } from '../src/main/runtime/agent-tools'
import { resolveSessionCwd } from '../src/main/runtime/scratch-cwd'

/**
 * 🔴 **M77 — a person told their already-answered question hears the app's own FULL sentence,
 * not a shortened one.**
 *
 * ⛔ **Why this is a separate file from `an-answer-a-quit-cannot-lose.test.ts`:** that file's own
 * `'⛔ a second answer to a question this app already closed is refused in this app's own words'`
 * asserts `reason` against `A_PERSONS_ANSWER_TO_AN_ENDED_QUESTION.answered` — the SAME product
 * constant the sentence lives in. A plant that shortens the sentence in
 * `question-rails.ts` moves both sides of that comparison together, so that test cannot fail no
 * matter what the words say (a self-referential oracle). ⚑ This file hardcodes the sentence
 * `RuntimeHost` must actually hand back, as an independent oracle, so a shortened or reworded
 * sentence is caught.
 *
 * ⚑ Setup copied from `an-answer-a-quit-cannot-lose.test.ts`: a real `RuntimeHost` over a real
 * SQLite ledger and real migrations, with `FakeRuntime` standing in for the provider — trimmed to
 * one lead and one child, which is all this scenario needs.
 */

const here = dirname(fileURLToPath(import.meta.url))
const migrationsFolder = join(here, '../src/main/db/migrations')

class RecordingSink implements RuntimeEventSink {
  readonly aPersonIsBehindIt = true
  alive = true
  constructor(readonly ownerId: string) {}
  send(): void {}
  sendLiveness(): void {}
}

describe('M77 · a second answer to an already-answered question', () => {
  let userData: string
  let root: string
  let db: AppDatabase
  let store: SessionStore
  let host: RuntimeHost
  let counter: number
  let clock: number
  let window: RecordingSink
  const tick = (): number => clock++

  const handed: AgentToolset[] = []

  beforeEach(() => {
    userData = mkdtempSync(join(tmpdir(), 'brobot2-second-answer-'))
    root = mkdtempSync(join(tmpdir(), 'brobot2-second-answer-root-'))
    db = openDatabase(join(userData, 'brobot2.sqlite'))
    applyMigrations(db, migrationsFolder)
    clock = 9_000_000
    store = createSessionStore(db, tick)
    counter = 0
    handed.length = 0
    host = new RuntimeHost({
      store,
      discoverSessions: NO_DISCOVERY,
      nativeTranscriptPath: () => null,
      exportDirectory: () => join(userData, 'exports'),
      createRuntime: (provider: Provider) =>
        new (class extends FakeRuntime {
          override async start(options: StartOptions): ReturnType<FakeRuntime['start']> {
            const handle = await super.start(options)
            if (options.agentTools) handed.push(options.agentTools)
            return handle
          }
        })(provider, { sessions: new FakeProviderSessions() }),
      prepareProviderHome: (provider: Provider, profileId?: string) => {
        const home = join(userData, 'provider-homes', profileId ?? 'default', provider)
        mkdirSync(home, { recursive: true })
        return home
      },
      providerHomePath: (provider: Provider) => join(userData, 'provider-homes', provider),
      resolveCwd: (sessionId, requested) => resolveSessionCwd(userData, sessionId, requested),
      newSessionId: () => `sess_${++counter}`,
      now: tick,
      readProviderConfig: (_provider, home) => ({
        home,
        homeEnv: 'CLAUDE_CONFIG_DIR',
        model: 'm',
        authNote: null,
        files: [],
      }),
    })
    window = new RecordingSink('webContents:1')
  })

  afterEach(async () => {
    await host.closeAll()
    db.close()
    for (const dir of [userData, root]) rmSync(dir, { recursive: true, force: true })
  })

  const lastToolset = (): AgentToolset => {
    const last = handed.at(-1)
    if (last === undefined) throw new Error('no toolset was handed out')
    return last
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

  const bringIntoBeing = async (profileId: string): Promise<void> => {
    const { sessionId } = await host.createSession(
      { provider: 'claude', profileId, approvalMode: 'ask', cwd: root },
      window,
    )
    await host.close(sessionId, window)
  }

  it("hands the second answer the app's own FULL sentence, word for word", async () => {
    await bringIntoBeing('mock-dev')
    await host.createSession(
      { provider: 'claude', profileId: 'lead', approvalMode: 'ask', cwd: root },
      window,
    )
    const leadTools = lastToolset()

    // ⚑ **D-016 · one give is the old start and its work together**: the brief is the child's
    // first turn, and the piece it opens is the one the question is about.
    const given = await callOn(leadTools, 'give_work', {
      definition_of_done: 'The requested result and its checks are recorded.',
      profile: 'mock-dev',
      title: 'answer a question',
      brief: 'pick one of the two',
    })
    expect(given.outcome, JSON.stringify(given)).toBe('ok')
    const asker = given.agent as string
    const askerTools = lastToolset()
    const piece = store.piecesOwnedBy(asker)[0]?.piece ?? ''
    expect(piece).not.toBe('')

    const asked = await callOn(askerTools, 'ask_question', {
      who_answers: 'a-person',
      piece,
      question: 'which of the two?',
    })
    expect(asked.outcome, JSON.stringify(asked)).toBe('ok')
    const rows = host
      .questionsForAPerson()
      .rows.filter(
        (row) =>
          row.request.askedBy === asker && row.request.went.is === 'the-person-the-asker-named',
      )
    expect(rows).toHaveLength(1)
    const requestId = rows[0]!.request.requestId

    const first = await host.respondUserInput(
      asker,
      requestId,
      { kind: 'answer', answers: { answer: ['left'] } },
      new RecordingSink('webContents:9'),
    )
    expect(first, JSON.stringify(first)).toMatchObject({ outcome: 'taken' })

    const second = await host.respondUserInput(
      asker,
      requestId,
      { kind: 'answer', answers: { answer: ['right'] } },
      new RecordingSink('webContents:10'),
    )
    // ⚑ The full sentence, hardcoded here rather than imported — an independent oracle a
    // shortened or reworded sentence in `question-rails.ts` cannot slip past.
    expect(second).toMatchObject({
      outcome: 'refused',
      reason: 'That question was already answered, so your answer was not sent.',
      stillOpen: false,
    })
  })

  it('takes a fresh, still-open question the ordinary way (positive control)', async () => {
    await bringIntoBeing('mock-dev')
    await host.createSession(
      { provider: 'claude', profileId: 'lead', approvalMode: 'ask', cwd: root },
      window,
    )
    const leadTools = lastToolset()

    const given = await callOn(leadTools, 'give_work', {
      definition_of_done: 'The requested result and its checks are recorded.',
      profile: 'mock-dev',
      title: 'answer a question',
      brief: 'pick one of the two',
    })
    expect(given.outcome).toBe('ok')
    const asker = given.agent as string
    const askerTools = lastToolset()
    const piece = store.piecesOwnedBy(asker)[0]?.piece ?? ''

    const asked = await callOn(askerTools, 'ask_question', {
      who_answers: 'a-person',
      piece,
      question: 'which of the two?',
    })
    expect(asked.outcome).toBe('ok')
    const rows = host
      .questionsForAPerson()
      .rows.filter(
        (row) =>
          row.request.askedBy === asker && row.request.went.is === 'the-person-the-asker-named',
      )
    const requestId = rows[0]!.request.requestId

    const only = await host.respondUserInput(
      asker,
      requestId,
      { kind: 'answer', answers: { answer: ['left'] } },
      new RecordingSink('webContents:9'),
    )
    expect(only).toMatchObject({ outcome: 'taken' })
  })
})
