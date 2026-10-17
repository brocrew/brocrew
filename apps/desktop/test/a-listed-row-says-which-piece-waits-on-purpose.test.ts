import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { FakeProviderSessions, FakeRuntime } from '@brobot2/runtime'
import type { AgentToolset } from '@brobot2/runtime'
import type { Provider } from '@brobot2/shared'
import { type AppDatabase, openDatabase } from '../src/main/db/connection'
import { applyMigrations } from '../src/main/db/migrate'
import { createSessionStore, rowsUnreadOnce, type SessionStore } from '../src/main/db/session-store'
import { NO_DISCOVERY } from '../src/main/adopt/discover-sessions'
import { RuntimeHost } from '../src/main/runtime/runtime-host'
import type { RuntimeEventSink } from '../src/main/runtime/runtime-host'
import { agentToolsFor, type ToolName } from '../src/main/runtime/agent-tools'
import { resourcesRoot } from '../src/main/resources/resources'
import { resolveSessionCwd } from '../src/main/runtime/scratch-cwd'
import type { PieceRow } from '../src/shared/tasks'
import {
  DEFAULT_PROFILE_ID,
  type ResumableSessionInfo,
  type RuntimeEventMessage,
  type UnresumableSessionInfo,
} from '../src/shared/runtime-ipc'

/**
 * The window's list of conversations says which piece a helper waits on on purpose.
 *
 * BroBot gives a worker (Ada) pieces of work. When the newest open piece Ada holds is marked as
 * waiting on purpose (`update_work` with `waiting`), Ada's listed row carries that piece's label
 * and the status line Ada wrote, so the window can say why Ada is not working. An unmarked piece,
 * a mark a later status line took off, a closed piece, an older piece behind a newer one, and a
 * piece Ada asked a question about all leave it absent, as their cards say.
 *
 * A real `RuntimeHost` over a real SQLite ledger, real migrations and the real tools; the only
 * double is the provider.
 */

const here = dirname(fileURLToPath(import.meta.url))
const migrationsFolder = join(here, '../src/main/db/migrations')

async function waitFor(predicate: () => boolean, what: string): Promise<void> {
  for (let attempt = 0; attempt < 400; attempt++) {
    if (predicate()) return
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
  throw new Error(`timed out waiting for ${what}`)
}

/** Long enough for every pump and every flush a row arms to have run. */
async function settle(): Promise<void> {
  for (let round = 0; round < 2; round++) {
    for (let turn = 0; turn < 5; turn++) await new Promise((resolve) => setImmediate(resolve))
    await new Promise((resolve) => setTimeout(resolve, 30))
  }
}

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

describe('a listed row says which piece its conversation waits on on purpose', () => {
  let userData: string
  let root: string
  let db: AppDatabase
  let store: SessionStore
  let host: RuntimeHost
  let counter: number
  let clock: number
  let window: RecordingSink
  const tick = (): number => clock++

  beforeEach(() => {
    userData = mkdtempSync(join(tmpdir(), 'brobot2-on-purpose-'))
    root = mkdtempSync(join(tmpdir(), 'brobot2-on-purpose-root-'))
    db = openDatabase(join(userData, 'brobot2.sqlite'))
    applyMigrations(db, migrationsFolder)
    clock = 9_000_000
    store = createSessionStore(db, tick)
    counter = 0
    const issued = new FakeProviderSessions()
    host = new RuntimeHost({
      store,
      discoverSessions: NO_DISCOVERY,
      nativeTranscriptPath: () => null,
      exportDirectory: () => join(userData, 'exports'),
      resourcesRoot: () => resourcesRoot(userData),
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
      statesMoved: () => undefined,
    })
    window = new RecordingSink('webContents:1')
  })

  afterEach(async () => {
    await host.closeAll()
    db.close()
    for (const dir of [userData, root]) rmSync(dir, { recursive: true, force: true })
  })

  const callOn = async (
    toolset: AgentToolset,
    name: ToolName,
    args: Record<string, unknown>,
  ): Promise<Record<string, unknown>> => {
    const tool = toolset.tools.find((one) => one.name === name)
    if (tool === undefined) throw new Error(`no such tool: ${name}`)
    const answer = (await tool.call(args)).structured as Record<string, unknown>
    expect(answer, JSON.stringify(answer)).toMatchObject({ outcome: 'ok' })
    return answer
  }

  /** One conversation's row, as the window's list reads it, from whichever half holds it. */
  const listed = (id: string): ResumableSessionInfo | UnresumableSessionInfo => {
    const row = [...host.resumableSessions(), ...host.unresumableSessions()].find(
      (one) => one.sessionId === id,
    )
    if (row === undefined) throw new Error(`${id} is not listed`)
    return row
  }
  const pieceOf = (owner: string, piece: string): PieceRow | undefined =>
    store.piecesOwnedBy(owner).find((one) => one.piece === piece)

  /** BroBot gives a piece to its worker, minted Ada the first time; the brief's turn ends with it open. */
  const aPieceGiven = async (
    brobot: string,
    title: string,
    first: boolean,
  ): Promise<{ ada: string; piece: string; label: string }> => {
    const given = await callOn(agentToolsFor(host, brobot), 'give_work', {
      definition_of_done: 'The requested result and its checks are recorded.',
      profile: 'worker',
      ...(first ? { new: true } : {}),
      title,
      brief: title.toLowerCase(),
    })
    const ada = given.agent as string
    const piece = given.piece as string
    await waitFor(() => pieceOf(ada, piece)?.state === 'stalled', `the brief of ${title} to end`)
    await settle()
    return { ada, piece, label: given.label as string }
  }
  const aHelperWithAPiece = async (): Promise<{ brobot: string; ada: string; piece: string }> => {
    const { sessionId: brobot } = await host.createSession(
      { provider: 'claude', profileId: DEFAULT_PROFILE_ID, approvalMode: 'auto', cwd: root },
      window,
    )
    await settle()
    const { ada, piece } = await aPieceGiven(brobot, 'Build the pages', true)
    return { brobot, ada, piece }
  }
  const statusOf = async (
    ada: string,
    label: string,
    status: string,
    waiting: boolean,
  ): Promise<void> => {
    await callOn(agentToolsFor(host, ada), 'update_work', {
      piece: label,
      status,
      ...(waiting ? { on: { time: new Date(clock + 3_600_000).toISOString() } } : {}),
    })
    await settle()
  }

  it('carries the marked piece and its status line, and only on the helper’s row', async () => {
    const { brobot, ada, piece } = await aHelperWithAPiece()
    await statusOf(ada, 'W1.1', 'waiting for the designs', true)
    expect(pieceOf(ada, piece)?.state).toBe('waiting-on-purpose')
    expect(listed(ada)).toMatchObject({
      named: { label: 'W1.1' },
      waitingOnPurpose: { label: 'W1.1', status: 'waiting for the designs' },
    })
    expect(listed(brobot)).not.toHaveProperty('waitingOnPurpose')
  })

  it('leaves it absent for a piece with a status line and no mark', async () => {
    const { ada } = await aHelperWithAPiece()
    await statusOf(ada, 'W1.1', 'half the pages are built', false)
    expect(listed(ada)).toMatchObject({ named: { label: 'W1.1' } })
    expect(listed(ada)).not.toHaveProperty('waitingOnPurpose')
    // The store hands the listing no piece its fold does not read as waiting on purpose.
    expect(store.workThatNamesAndItsWait(ada).waitingOnPurpose).toBeNull()
  })

  it('leaves it absent once a later status line without the mark is set', async () => {
    const { ada } = await aHelperWithAPiece()
    await statusOf(ada, 'W1.1', 'waiting for the designs', true)
    expect(listed(ada)).toHaveProperty('waitingOnPurpose')
    await statusOf(ada, 'W1.1', 'the designs came', false)
    expect(listed(ada)).not.toHaveProperty('waitingOnPurpose')
    expect(store.workThatNamesAndItsWait(ada).waitingOnPurpose).toBeNull()
  })

  it('leaves it absent once the piece is closed', async () => {
    const { brobot, ada, piece } = await aHelperWithAPiece()
    await statusOf(ada, 'W1.1', 'waiting for the designs', true)
    expect(listed(ada)).toHaveProperty('waitingOnPurpose')
    await callOn(agentToolsFor(host, brobot), 'update_work', { piece: 'W1.1', close: true })
    await settle()
    expect(pieceOf(ada, piece)?.state).toBe('closed')
    expect(listed(ada)).not.toHaveProperty('waitingOnPurpose')
    expect(store.workThatNamesAndItsWait(ada).waitingOnPurpose).toBeNull()
  })

  it('reads the newest open piece: an older marked piece behind a newer one is not said', async () => {
    const { brobot, ada } = await aHelperWithAPiece()
    const second = await aPieceGiven(brobot, 'Write the copy', false)
    expect(second).toMatchObject({ ada, label: 'W1.2' })
    await statusOf(ada, 'W1.1', 'waiting for the designs', true)
    expect(listed(ada)).toMatchObject({ named: { label: 'W1.2' } })
    expect(listed(ada)).not.toHaveProperty('waitingOnPurpose')
    await statusOf(ada, 'W1.2', 'waiting for the brand words', true)
    expect(listed(ada)).toMatchObject({
      waitingOnPurpose: { label: 'W1.2', status: 'waiting for the brand words' },
    })
  })

  it('leaves it absent while a question the helper asked about the piece waits, as its card says', async () => {
    const { ada, piece } = await aHelperWithAPiece()
    await statusOf(ada, 'W1.1', 'waiting for the designs', true)
    await callOn(agentToolsFor(host, ada), 'ask_question', {
      piece: 'W1.1',
      question: 'which pages first?',
      who_answers: 'the-parent',
    })
    await settle()
    expect(pieceOf(ada, piece)?.state).toBe('waiting-on-purpose')
    const composed = store.piecesWithTheirWaits(ada, rowsUnreadOnce())
    expect(composed.find((one) => one.piece === piece)?.state).toBe('waiting-on-an-answer')
    expect(listed(ada)).not.toHaveProperty('waitingOnPurpose')
  })

  it('bounds the status line to a status line’s limit', async () => {
    const { ada, piece } = await aHelperWithAPiece()
    const long = 'w'.repeat(1_300)
    store.append(
      ada,
      store.nextOrdinal(ada),
      { type: 'work_status_set', piece, line: long, by: ada, waiting: true },
      clock++,
    )
    expect(listed(ada)).toMatchObject({
      waitingOnPurpose: { label: 'W1.1', status: 'w'.repeat(1_280) },
    })
  })
})
