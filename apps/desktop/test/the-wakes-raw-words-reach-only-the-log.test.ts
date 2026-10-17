import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { FakeProviderSessions, ResumeError } from '@brobot2/runtime'
import type { FakeSessionHandle } from '@brobot2/runtime'
import type { Provider } from '@brobot2/shared'
import { type AppDatabase, openDatabase } from '../src/main/db/connection'
import { applyMigrations } from '../src/main/db/migrate'
import { createSessionStore, type SessionStore } from '../src/main/db/session-store'
import { NO_DISCOVERY } from '../src/main/adopt/discover-sessions'
import { RuntimeHost } from './helpers/giver-notice-host'
import type { RuntimeEventSink } from './helpers/giver-notice-host'
import { agentToolsFor, type ToolName } from '../src/main/runtime/agent-tools'
import { resolveSessionCwd } from '../src/main/runtime/scratch-cwd'
import { TASK_IS_OPEN } from '../src/shared/tasks'
import type { RuntimeEventMessage, TranscriptEvent } from '../src/shared/runtime-ipc'
import { ProviderDouble, anOpenGate, type ResumeGate } from './lib/provider-double'

/**
 * # 🔴 663 M50 · the host's own words go to the log, and only to the log
 *
 * ⚑ **`message_agent`'s own start** — the wake a stopped conversation's next message makes (D-017
 * R1) — meets a provider that cannot resume it, `agent-tools.ts` (around `aWakeThatDidNotHappen`)
 * logs the RAW underlying text with `console.warn` and then answers the caller in the door's own
 * closed sentence, never the provider's words (`657` M22's edit on this door, carried to the wake
 * by `673` F6). ⛔ **This measures both halves of that split on one call**: the model's answer
 * (`structured` and `text`) never contains the provider's raw diagnostic, and `console.warn` is
 * called with exactly that diagnostic — so a change that quietly drops the log call (as `String(`
 * in place of `console.warn(` does: the template literal is still built, but the value is thrown
 * away) leaves the host's words written nowhere at all, and this test is red.
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

describe('663 M50 · a wake refused logs the host’s own words and keeps them off the model', () => {
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
  let gate: ResumeGate
  const tick = (): number => clock++

  beforeEach(() => {
    userData = mkdtempSync(join(tmpdir(), 'brobot2-663-m50-'))
    root = mkdtempSync(join(tmpdir(), 'brobot2-663-m50-root-'))
    db = openDatabase(join(userData, 'brobot2.sqlite'))
    applyMigrations(db, migrationsFolder)
    clock = 6_635_000
    store = createSessionStore(db, tick)
    counter = 0
    handles = []
    issued = new FakeProviderSessions()
    gate = anOpenGate()
    host = new RuntimeHost({
      store,
      discoverSessions: NO_DISCOVERY,
      nativeTranscriptPath: () => null,
      exportDirectory: () => join(userData, 'exports'),
      createRuntime: (provider: Provider) => new ProviderDouble(provider, handles, issued, gate),
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
    window = new RecordingSink('webContents:1')
  })

  afterEach(async () => {
    await host.closeAll()
    db.close()
    for (const dir of [userData, root]) rmSync(dir, { recursive: true, force: true })
  })

  const events = (sessionId: string): TranscriptEvent[] =>
    store.events(sessionId).map((entry) => entry.event)

  const turnsIn = (sessionId: string): number =>
    events(sessionId).filter((event) => event.type === 'turn').length

  const waitFor = async (predicate: () => boolean, what: string): Promise<void> => {
    for (let attempt = 0; attempt < 400; attempt++) {
      if (predicate()) return
      await new Promise((resolve) => setTimeout(resolve, 10))
    }
    throw new Error(`timed out waiting for ${what}`)
  }

  const personOpens = async (profileId: string): Promise<string> => {
    const { sessionId } = await host.createSession(
      { provider: 'claude', profileId, approvalMode: 'auto', cwd: root },
      window,
    )
    return sessionId
  }

  const callOn = async (
    caller: string,
    name: ToolName,
    args: Record<string, unknown> = {},
  ): Promise<{ structured: Record<string, unknown>; text: string }> => {
    const tool = agentToolsFor(host, caller).tools.find((one) => one.name === name)
    if (tool === undefined) throw new Error(`no such tool: ${name}`)
    const said = await tool.call(args)
    return { structured: said.structured as Record<string, unknown>, text: said.text }
  }

  /**
   * ⚑ A PM a person opened, and one `worker` it gave a piece to, whose turn is over.
   * ⚑ **D-016** — `give_work` starts the worker, and its brief is the worker's first turn.
   */
  const aPmAndItsIdleWorker = async (): Promise<{ pm: string; worker: string; label: string }> => {
    await host.close(await personOpens('worker'), window)
    const pm = await personOpens('pm')
    const given = await callOn(pm, 'give_work', {
      definition_of_done: 'The requested result and its checks are recorded.',
      profile: 'worker',
      title: 'The schema',
      brief: 'migrate the schema',
    })
    expect(given.structured.outcome, JSON.stringify(given.structured)).toBe('ok')
    const worker = given.structured.agent as string
    await waitFor(() => turnsIn(worker) > 0, 'the turn the brief opened to end')
    const piece = store.openPiecesOf(worker).find((one) => TASK_IS_OPEN[one.state])
    if (piece === undefined) throw new Error('the give never opened a piece')
    return { pm, worker, label: piece.label }
  }

  /** ⚑ D-017: a worker a person's Close stopped; the parent's next message is what starts it. */
  const aWorkerOver = async (): Promise<{ pm: string; worker: string; label: string }> => {
    const { pm, worker, label } = await aPmAndItsIdleWorker()
    host.claimSession(worker, window)
    await host.close(worker, window)
    await waitFor(
      () =>
        ![...host.resumableSessions()].some(
          (row) => row.sessionId === worker && row.running !== 'not-running',
        ),
      'the worker to be over',
    )
    return { pm, worker, label }
  }

  it('the raw provider text reaches console.warn and nothing else, on a wake the provider refuses to resume', async () => {
    const { pm, worker, label } = await aWorkerOver()
    // ⚑ The exact shape `673` F6 measures for a lost thread (`what-a-wake-still-says-wrong.test.ts`
    // §3.2): a `ResumeError` whose own `.message` is the text `console.warn` reads
    // (`error.cause.message` at the plant's call site) — distinctive enough that finding it
    // anywhere is unambiguous. Its own `cause` is not what gets logged, so this does not lean on it.
    const theHostsOwnWords =
      'resume failed: th_gone is gone from this machine, not from the provider'
    gate.resumeFails = () =>
      new ResumeError(
        { provider: 'codex', sessionId: 'th_gone', cwd: root, rotation: 0 },
        theHostsOwnWords,
        { cause: new Error('thread/resume: not found') },
      )

    const warned: string[] = []
    const spy = vi.spyOn(console, 'warn').mockImplementation((...args: unknown[]) => {
      warned.push(args.map(String).join(' '))
    })
    try {
      const refused = await callOn(pm, 'message_agent', {
        agent: worker,
        text: 'how far along are you?',
        kind: 'follow-up',
        piece: label,
      })

      // ⚑ Positive — the caller is told, in the door's own closed sentence, that the wake failed.
      expect(refused.structured.outcome).toBe('refused')
      expect(refused.structured.rail).toBe('that-conversation-could-not-be-resumed')

      // ⛔ Negative — but never in the provider's own words: neither field the caller reads carries
      // the raw string, so a model can never see what only a person reading the log should.
      const wholeAnswer = JSON.stringify(refused.structured) + '\n' + refused.text
      expect(wholeAnswer).not.toContain(theHostsOwnWords)

      // ⚑ Positive — and the same raw string DOES reach the log, which is the one place a person
      // can still read the precise text a `config.toml`, a path or a provider's own error would
      // otherwise vanish with (`657` M22). Swapping `console.warn(` for `String(` still builds this
      // line — the template literal runs — but throws the result away unread, so the spy would see
      // nothing at all.
      expect(spy).toHaveBeenCalled()
      const logged = warned.join('\n')
      expect(logged).toContain('message_agent: the start did not happen')
      expect(logged).toContain(theHostsOwnWords)
    } finally {
      spy.mockRestore()
    }
  })
})
