import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { Options, SDKMessage } from '@anthropic-ai/claude-agent-sdk'
import { ClaudeRuntime } from '@brobot2/runtime'
import { TheCliAnswersInOrder } from '../../../packages/runtime/test/the-cli-answers-in-order'
import { openDatabase } from '../src/main/db/connection'
import { applyMigrations } from '../src/main/db/migrate'
import { createSessionStore, type SessionStore } from '../src/main/db/session-store'
import { NO_DISCOVERY } from '../src/main/adopt/discover-sessions'
import { RuntimeHost, type RuntimeEventSink } from '../src/main/runtime/runtime-host'
import { attentionQueue } from '../src/renderer/src/lib/attention'
import { createSessionRecord } from '../src/renderer/src/lib/session-record'
import { applyEvent } from '../src/renderer/src/lib/transcript'
import type {
  CreatedSession,
  RuntimeEventMessage,
  TranscriptEvent,
} from '../src/shared/runtime-ipc'

/**
 * A Claude card the SDK aborts while it waits, end to end: the real Claude adapter under the real
 * host and a real database, then the record folded as the window folds it for Waiting on you.
 */

class FakeQuery {
  private resolve: ((value: IteratorResult<SDKMessage>) => void) | null = null
  private readonly buffer: SDKMessage[] = []
  private done = false
  readonly cli = new TheCliAnswersInOrder()

  emit(message: SDKMessage): void {
    if (this.resolve) {
      const resolve = this.resolve
      this.resolve = null
      resolve({ value: message, done: false })
      return
    }
    this.buffer.push(message)
  }

  end(): void {
    this.done = true
    if (this.resolve) {
      const resolve = this.resolve
      this.resolve = null
      resolve({ value: undefined as never, done: true })
    }
  }

  async interrupt(): Promise<void> {}
  async setPermissionMode(): Promise<void> {}
  close(): void {
    this.end()
  }

  [Symbol.asyncIterator](): AsyncIterator<SDKMessage> {
    return this.cli.over({
      next: (): Promise<IteratorResult<SDKMessage>> => {
        const queued = this.buffer.shift()
        if (queued) return Promise.resolve({ value: queued, done: false })
        if (this.done) return Promise.resolve({ value: undefined as never, done: true })
        return new Promise((resolve) => {
          this.resolve = resolve
        })
      },
    })
  }
}

class RecordingSink implements RuntimeEventSink {
  readonly aPersonIsBehindIt = true
  readonly messages: RuntimeEventMessage[] = []
  alive = true
  readonly ownerId = 'owner:1'
  send(message: RuntimeEventMessage): void {
    this.messages.push(message)
  }
  sendLiveness(): void {}
  events(): TranscriptEvent[] {
    return this.messages.map((message) => message.event)
  }
}

async function waitFor(predicate: () => boolean, what: string, timeoutMs = 3_000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (predicate()) return
    await new Promise((resolve) => setTimeout(resolve, 5))
  }
  throw new Error(`timed out waiting for ${what}`)
}

const migrations = join(dirname(fileURLToPath(import.meta.url)), '../src/main/db/migrations')

describe('a Claude card the SDK aborts while it waits is closed in the record', () => {
  let folder: string
  let db: ReturnType<typeof openDatabase>
  let store: SessionStore
  let host: RuntimeHost
  let sink: RecordingSink
  let fq: FakeQuery
  let canUseTool: NonNullable<Options['canUseTool']> | null

  beforeEach(() => {
    folder = mkdtempSync(join(tmpdir(), 'brocrew-dropped-card-'))
    db = openDatabase(join(folder, 'fixture.sqlite'))
    applyMigrations(db, migrations)
    let clock = 7_000_000
    store = createSessionStore(db, () => clock++)
    fq = new FakeQuery()
    canUseTool = null
    let counter = 0
    host = new RuntimeHost({
      store,
      discoverSessions: NO_DISCOVERY,
      nativeTranscriptPath: () => null,
      exportDirectory: () => join(folder, 'exports'),
      createRuntime: () =>
        new ClaudeRuntime(
          (params) => {
            canUseTool = params.options.canUseTool ?? null
            fq.cli.listen(params.prompt)
            return fq as never
          },
          async () => true,
        ),
      prepareProviderHome: (provider) => join(folder, 'provider-homes', provider),
      providerHomePath: (provider) => join(folder, 'provider-homes', provider),
      resolveCwd: (sessionId, requested) => requested ?? join(folder, 'scratch', sessionId),
      newSessionId: () => `sess_${++counter}`,
      now: () => clock++,
      readProviderConfig: (_provider, home) => ({
        home,
        homeEnv: 'CLAUDE_CONFIG_DIR',
        model: 'm',
        authNote: null,
        files: [],
      }),
    })
    sink = new RecordingSink()
  })

  afterEach(async () => {
    fq.end()
    await host.closeAll()
    db.close()
    rmSync(folder, { recursive: true, force: true })
  })

  const ledger = (id: string) => store.events(id).map((row) => row.event)
  const rowsFor = (id: string, card: string) =>
    ledger(id).filter(
      (one) =>
        (one.type === 'request_resolved' && one.id === card) ||
        (one.type === 'user_decision' && one.requestId === card),
    )
  /** The card as the host's fold reads it: what a reopen and the person's queue go by. */
  const statesOf = (id: string, card: string) =>
    store
      .routedRequestsOf(id)
      .filter((one) => one.requestId === card)
      .map((one) => one.state)
  /** What Waiting on you lists for this conversation, folded from the rows the window received. */
  const waitingOnYou = (id: string) => {
    const record = createSessionRecord(id)
    record.meta = { sessionId: id, provider: 'claude', cwd: folder } as CreatedSession
    record.phase = 'open'
    for (const event of sink.events()) applyEvent(record.control, event, 1_000)
    return attentionQueue([record], () => 'waiting')
  }

  /** A conversation with a turn open and one permission card on it, raised as the SDK raises it. */
  async function aCard(card: string, signal: AbortSignal) {
    const created = await host.createSession({ provider: 'claude' }, sink)
    const id = created.sessionId
    await host.send(id, 'write the file', sink)
    fq.emit({
      type: 'system',
      subtype: 'init',
      session_id: 'sess_provider_1',
      cwd: join(folder, 'scratch', id),
    } as unknown as SDKMessage)
    await waitFor(
      () => sink.events().some((one) => one.type === 'status' && one.state === 'working'),
      'the turn opening',
    )
    if (!canUseTool) throw new Error('the adapter never handed the SDK a canUseTool')
    const answered = canUseTool(
      'Write',
      { file_path: join(folder, 'scratch', id, 'f.txt'), content: 'x' },
      { toolUseID: card, signal } as never,
    )
    await waitFor(
      () => ledger(id).some((one) => one.type === 'permission_request' && one.id === card),
      'the card in the record',
    )
    expect(waitingOnYou(id)).toHaveLength(1)
    expect(statesOf(id, card)).toEqual(['open'])
    return { id, answered }
  }

  it('the abort writes request_resolved once, and Waiting on you no longer lists the card', async () => {
    const ctl = new AbortController()
    const { id, answered } = await aCard('tu_gone', ctl.signal)

    ctl.abort()
    expect(await answered).toMatchObject({ behavior: 'deny' })
    await waitFor(
      () => ledger(id).some((one) => one.type === 'request_resolved'),
      'the closing row',
    )
    expect(rowsFor(id, 'tu_gone')).toEqual([{ type: 'request_resolved', id: 'tu_gone' }])
    expect(waitingOnYou(id)).toHaveLength(0)
    expect(statesOf(id, 'tu_gone')).toEqual(['withdrawn'])
  })

  it('an answer closes the card once, and a later abort adds no second row', async () => {
    const ctl = new AbortController()
    const { id, answered } = await aCard('tu_ok', ctl.signal)

    await host.respondPermission(id, 'tu_ok', { outcome: 'allow' }, sink)
    expect(await answered).toMatchObject({ behavior: 'allow' })
    ctl.abort()
    await host.close(id, sink)
    expect(rowsFor(id, 'tu_ok').map((one) => one.type)).toEqual(['user_decision'])
    expect(statesOf(id, 'tu_ok')).toEqual(['decided'])
    expect(waitingOnYou(id)).toHaveLength(0)
  })
})
