import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { TheCliAnswersInOrder } from '../../../packages/runtime/test/the-cli-answers-in-order'
import { ClaudeRuntime, parseSessionRef, type SessionRef } from '@brobot2/runtime'
import type { Options, SDKMessage } from '@anthropic-ai/claude-agent-sdk'
import { openDatabase, type AppDatabase } from '../src/main/db/connection'
import { applyMigrations } from '../src/main/db/migrate'
import { createSessionStore, type SessionStore } from '../src/main/db/session-store'
import { NO_DISCOVERY } from '../src/main/adopt/discover-sessions'
import { RuntimeHost, type RuntimeEventSink } from '../src/main/runtime/runtime-host'
import type { RuntimeEventMessage } from '../src/shared/runtime-ipc'

/**
 * # 🔴 721 · R75 — a `/clear`ed conversation can be reopened, through the host
 *
 * ⚑ **The ruling** (`715` F-1): *"After a `/clear`, the ref follows the transcript. A conversation's
 * ref names what a resume can open. After a `conversation_reset`, that is the session the CLI's next
 * init names in the same launch (the one with a transcript), not the id the reset event names."*
 *
 * ⚑ **The double is Claude-faithful where `conversation-reset.test.ts`'s is not.** That file runs on
 * `FakeRuntime`, whose reset ISSUES the new id to its provider — so it reopens, and it was green on
 * `main` while every real `/clear`ed conversation was unreopenable (*a double can build a world
 * production cannot*). ⚑ Here the product's own `ClaudeRuntime` runs over scripted SDK frames in the
 * measured order (`probe:claude-resume-after-cd`, `715`): `conversation_reset{new_conversation_id: R}`
 * then `system/init` naming B — and the provider "has on disk" only the ids an init announced, as
 * Claude's does (R has no transcript; resuming it is *"session not found"*).
 */

const migrations = join(dirname(fileURLToPath(import.meta.url)), '../src/main/db/migrations')

class FakeQuery {
  private resolve: ((value: IteratorResult<SDKMessage>) => void) | null = null
  private readonly buffer: SDKMessage[] = []
  private done = false

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

  /** ⚑ F080: it reads what the adapter sends, and each `result` names the message it answers. */
  readonly cli = new TheCliAnswersInOrder()
}

class NullSink implements RuntimeEventSink {
  readonly messages: RuntimeEventMessage[] = []
  readonly alive = true
  readonly ownerId = 'owner:1'
  readonly aPersonIsBehindIt = true
  send(message: RuntimeEventMessage): void {
    this.messages.push(message)
  }
  sendLiveness(): void {}
}

async function waitFor(predicate: () => boolean, what: string, timeoutMs = 2_000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (predicate()) return
    await new Promise((resolve) => setTimeout(resolve, 5))
  }
  throw new Error(`timed out waiting for ${what}`)
}

const frame = (value: Record<string, unknown>): SDKMessage => value as unknown as SDKMessage
const success = (): SDKMessage => frame({ type: 'result', subtype: 'success', is_error: false })

describe('721 · R75 — a /clear’d conversation reopens on the conversation that has a transcript', () => {
  let dir: string
  let db: AppDatabase
  let store: SessionStore
  /** ⚑ What the provider has "on disk": every id a `system/init` announced, and nothing else. */
  let announced: Set<string>
  /** Every query the product built, in order, and the options it built them with. */
  let launches: { fq: FakeQuery; options: Options }[]

  const init = (id: string, cwd: string): SDKMessage => {
    announced.add(id)
    return frame({ type: 'system', subtype: 'init', session_id: id, cwd })
  }

  function buildHost(): RuntimeHost {
    return new RuntimeHost({
      store,
      discoverSessions: NO_DISCOVERY,
      nativeTranscriptPath: () => null,
      exportDirectory: () => join(dir, 'exports'),
      createRuntime: () =>
        new ClaudeRuntime(
          (params) => {
            const fq = new FakeQuery()
            launches.push({ fq, options: params.options })
            fq.cli.listen(params.prompt)
            return fq as never
          },
          async (sessionId) => announced.has(sessionId),
        ),
      prepareProviderHome: (which) => join(dir, 'homes', which),
      providerHomePath: (which) => join(dir, 'homes', which),
      resolveCwd: () => join(dir, 'cwd'),
      newSessionId: () => 'sess_row',
      readProviderConfig: (_which, home) => ({
        home,
        homeEnv: 'CLAUDE_CONFIG_DIR',
        model: 'm',
        authNote: null,
        files: [],
      }),
    })
  }

  const refOf = (sessionId: string): SessionRef => {
    const row = db
      .prepare('SELECT external_ref FROM provider_session WHERE id = ?')
      .get(sessionId) as { external_ref: string | null }
    if (row.external_ref === null) throw new Error('no ref recorded')
    return parseSessionRef(row.external_ref)
  }

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'brobot2-721-'))
    db = openDatabase(join(dir, 'brobot2.sqlite'))
    applyMigrations(db, migrations)
    store = createSessionStore(db)
    announced = new Set()
    launches = []
  })

  afterEach(() => {
    db.close()
    rmSync(dir, { recursive: true, force: true })
  })

  it('🔴 a conversation that was /clear’d, ended and reopened resumes the conversation the /clear began', async () => {
    const host = buildHost()
    const sink = new NullSink()
    const created = await host.createSession({ provider: 'claude' }, sink)
    const cwd = join(dir, 'cwd')
    const turn = async (text: string, frames: SDKMessage[]): Promise<void> => {
      const before = sink.messages.filter((m) => m.event.type === 'turn').length
      await host.send(created.sessionId, text, sink)
      for (const one of frames) launches[0]?.fq.emit(one)
      await waitFor(
        () => sink.messages.filter((m) => m.event.type === 'turn').length > before,
        `the turn for "${text}"`,
      )
    }
    await turn('before the clear', [init('sess_A', cwd), success()])
    // ⚑ The measured `/clear`: the reset naming R (no transcript), then the init naming B.
    await turn('/clear', [
      frame({ type: 'conversation_reset', session_id: 'sess_A', new_conversation_id: 'sess_R' }),
      init('sess_B', cwd),
      success(),
    ])
    // ⛔ **On `main` the row names `sess_R`** — the reset's own id, which no resume can open.
    expect(refOf(created.sessionId)).toMatchObject({ provider: 'claude', sessionId: 'sess_B', cwd })
    await host.close(created.sessionId, sink)
    expect(refOf(created.sessionId).sessionId).toBe('sess_B')

    // Quit and relaunch: a brand-new host over the same store and the same provider record.
    const relaunched = buildHost()
    // ⛔ **On `main` this REJECTS** — *"session not found: sess_R"* — and the host closes the
    // conversation for good (`forgetTheQuitOf`).
    await relaunched.resumeSession(created.sessionId, new NullSink())
    expect(launches).toHaveLength(2)
    expect(launches[1]?.options.resume).toBe('sess_B')
    await relaunched.closeAll()
  })

  it('⚑ CONTROL — with no /clear, the row names the conversation it opened, and that reopens', async () => {
    const host = buildHost()
    const sink = new NullSink()
    const created = await host.createSession({ provider: 'claude' }, sink)
    const cwd = join(dir, 'cwd')
    await host.send(created.sessionId, 'hello', sink)
    launches[0]?.fq.emit(init('sess_A', cwd))
    launches[0]?.fq.emit(success())
    await waitFor(() => sink.messages.some((m) => m.event.type === 'turn'), 'the turn')
    await host.close(created.sessionId, sink)
    expect(refOf(created.sessionId).sessionId).toBe('sess_A')
    const relaunched = buildHost()
    await relaunched.resumeSession(created.sessionId, new NullSink())
    expect(launches[1]?.options.resume).toBe('sess_A')
    await relaunched.closeAll()
  })
})
