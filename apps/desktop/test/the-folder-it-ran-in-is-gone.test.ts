import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  ClaudeRuntime,
  CodexRuntime,
  FakeProviderSessions,
  ResumeError,
  createSpawnTransportFactory,
  spawnClaudeChild,
  spawnNoWaitClearsOf,
} from '@brobot2/runtime'
import type { FakeSessionHandle } from '@brobot2/runtime'
import type { Provider } from '@brobot2/shared'
import { type AppDatabase, openDatabase } from '../src/main/db/connection'
import { applyMigrations } from '../src/main/db/migrate'
import { createSessionStore, type SessionStore } from '../src/main/db/session-store'
import { NO_DISCOVERY } from '../src/main/adopt/discover-sessions'
import { RuntimeHost, THE_APP_ITSELF, type RuntimeEventSink } from './helpers/giver-notice-host'
import * as tools from '../src/main/runtime/agent-tools'
import { executeRuntimeCommand } from '../src/main/runtime/ipc'
import { resolveSessionCwd } from '../src/main/runtime/scratch-cwd'
import type { RuntimeEventMessage } from '../src/shared/runtime-ipc'
import { ProviderDouble, anOpenGate, type ResumeGate } from './lib/provider-double'

/**
 * # 🔴 724 · `717` F-2 — a Resume into a folder that is gone says so, and names it
 *
 * ⚑ **`717` F-2**: *"Since `705` a Resume into a folder that no longer exists is refused — correct —
 * but the error a person reads names the claude binary and `ENOENT`, not the missing folder."* ⚑ The
 * brief: *"Say the folder is gone and name it (R66's shape)."* — R66: *"The sentence says which it is,
 * a program or a folder, in words … chosen by type, never by matching message text."*
 *
 *  - **§0 · the premise, measured**: Node reports a spawn into a missing folder as `ENOENT` naming the
 *    PROGRAM; and both adapters' own resumes over a gone folder carry that errno, in words that name
 *    the program and not the folder.
 *  - **§1 · a person's Resume, on both providers' own errors**: the folder's sentence, with its path —
 *    through the host and through the IPC a window calls. RED on `main`, which said the errno.
 *    ⚑ Controls: a missing PROGRAM in a folder that is there keeps its words; a folder that is gone
 *    under a failure that is not a spawn `ENOENT` keeps that failure's words; a gone folder whose
 *    launch works reopens — the question is asked only once the launch failed.
 *  - **§2 · the wake (the model's side)**: the wake's permanent word, with a sentence that says the
 *    folder is gone — never that the program could not run. RED on `main` (the generic word).
 *    ⚑ **D-017** — `resume_agent` is gone: the wake is the start a `message_agent` makes of a
 *    conversation that was not running (R1), and it answers in the same words.
 *    ⚠️ The pair varies the ADAPTER's error, not the woken conversation's provider: the give that
 *    starts the worker (D-016 · `give_work`, which took `spawn_agent`'s place) runs it on the PM's
 *    provider (Claude), so both arms wake a Claude row — the host classifies by the error's shape,
 *    which is what differs (§1 opens each provider for real).
 *
 * ⛔ **Nothing live, no Electron, no port.** The only processes are Node's own binary and the SDK's
 * Claude program spawned into a folder that does NOT exist, which Node refuses before anything runs —
 * and the Claude spawn is guarded so a real CLI can never start. ⚠️ Imported as a namespace
 * (`tools`), so `main` runs this file and goes RED on its assertions.
 */

const here = dirname(fileURLToPath(import.meta.url))
const migrationsFolder = join(here, '../src/main/db/migrations')
const COULD_NOT_BE_RESUMED = 'that-conversation-could-not-be-resumed'

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

/**
 * ⚑ The sentence a person reads, for a gone folder at `path`. ⚑ **D-017b** — *did not reopen …
 * then reopen it* became *did not continue … then send it your message again*: a message sent from
 * its view is the one gesture that carries a conversation on.
 */
const theFolderIsGone = (path: string): string =>
  `This conversation did not continue: the folder it ran in, ${path}, is no longer there. Put that folder back, then send it your message again.`

describe('724 · `717` F-2 — the folder it ran in is gone', () => {
  let userData: string
  let root: string
  let db: AppDatabase
  let store: SessionStore
  let host: RuntimeHost
  let handles: FakeSessionHandle[]
  let issued: FakeProviderSessions
  let counter: number
  let window: RecordingSink
  let gate: ResumeGate

  beforeEach(() => {
    userData = mkdtempSync(join(tmpdir(), 'brobot2-724-gone-'))
    root = mkdtempSync(join(tmpdir(), 'brobot2-724-gone-root-'))
    db = openDatabase(join(userData, 'brobot2.sqlite'))
    applyMigrations(db, migrationsFolder)
    store = createSessionStore(db)
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
    vi.restoreAllMocks()
    await host.closeAll()
    db.close()
    for (const dir of [userData, root]) rmSync(dir, { recursive: true, force: true })
  })

  /**
   * ⚑ **Claude's own resume over a gone folder** — the SDK's real `query()` on the adapter's spawn
   * seam, through the product's own `spawnClaudeChild`. ⛔ Guarded: if the folder were there, a real
   * CLI would start, and the guard throws instead.
   */
  const claudeResumesInto = async (folder: string): Promise<Error> =>
    new ClaudeRuntime(
      undefined,
      async () => true,
      undefined,
      undefined,
      (options) => {
        if (existsSync(options.cwd ?? '')) {
          throw new Error('724: a Claude CLI would have started in a folder that is there')
        }
        return spawnClaudeChild(options)
      },
    )
      .resume(
        { provider: 'claude', sessionId: 'sess_724', cwd: folder, rotation: 0 },
        { providerHome: join(root, 'claude-home-724') },
      )
      .then(
        () => new Error('the Claude resume RESOLVED'),
        (thrown: unknown) => thrown as Error,
      )

  /**
   * ⚑ **Codex's own resume over a gone folder** — the real transport, spawning THIS Node binary, which
   * exists: only the folder is missing, so the errno can be about nothing else.
   */
  const codexResumesInto = async (folder: string): Promise<Error> =>
    new CodexRuntime(createSpawnTransportFactory(process.execPath))
      .resume(
        { provider: 'codex', sessionId: 'thr_724', cwd: folder, rotation: 0 },
        { providerHome: join(root, 'codex-home-724') },
      )
      .then(
        () => new Error('the Codex resume RESOLVED'),
        (thrown: unknown) => thrown as Error,
      )

  const resumesInto = (provider: Provider, folder: string): Promise<Error> =>
    provider === 'claude' ? claudeResumesInto(folder) : codexResumesInto(folder)

  /** ⚑ A conversation a person opened in `folder` and closed — the row a Resume brings back. */
  const aClosedConversationIn = async (provider: Provider, folder: string): Promise<string> => {
    mkdirSync(folder, { recursive: true })
    const { sessionId } = await host.createSession(
      { provider, profileId: 'writer', approvalMode: 'auto', cwd: folder },
      window,
    )
    await host.close(sessionId, window)
    // ⚑ The premise: the row remembers the folder it ran in.
    expect(store.find(sessionId)?.ref.cwd).toBe(folder)
    return sessionId
  }

  const theReopen = (sessionId: string): Promise<string> =>
    host.resumeSession(sessionId, window).then(
      () => 'RESOLVED',
      (error: Error) => error.message,
    )

  const callOn = async (
    caller: string,
    name: tools.ToolName,
    args: Record<string, unknown> = {},
  ): Promise<Record<string, unknown>> => {
    const tool = tools.agentToolsFor(host, caller).tools.find((one) => one.name === name)
    if (tool === undefined) throw new Error(`no such tool: ${name}`)
    return (await tool.call(args)).structured as Record<string, unknown>
  }

  const waitFor = async (predicate: () => boolean, what: string): Promise<void> => {
    for (let attempt = 0; attempt < 400; attempt++) {
      if (predicate()) return
      await new Promise((resolve) => setTimeout(resolve, 10))
    }
    throw new Error(`timed out waiting for ${what}`)
  }

  // ───────────────────────────────────────────────────────────────────────────────
  // §0 · the premise
  // ───────────────────────────────────────────────────────────────────────────────

  describe('§0 · the premise: a missing folder is reported as the PROGRAM', () => {
    it('⚑ Node: a spawn into a folder that is not there says `ENOENT` and names the program', async () => {
      const gone = join(root, 'gone')
      expect(existsSync(gone)).toBe(false)
      const child = spawn(process.execPath, ['-e', ''], { cwd: gone, stdio: 'pipe' })
      // ⛔ Bounded: a silence past it is NOT PERFORMED, never a pass (rule 13).
      const met = await Promise.race([
        new Promise<NodeJS.ErrnoException>((resolve) => child.once('error', resolve)),
        new Promise<null>((resolve) => setTimeout(() => resolve(null), 5_000)),
      ])
      expect(met, 'no spawn error within 5s — NOT PERFORMED').not.toBeNull()
      expect(met?.code).toBe('ENOENT')
      expect(met?.syscall).toBe(`spawn ${process.execPath}`)
      expect(met?.message).not.toContain(gone)
      expect(child.pid).toBeUndefined()
    })

    it.each(['claude', 'codex'] as const)(
      '⚑ %s’s own resume over a gone folder carries that errno, and its words name the program',
      async (provider) => {
        const gone = join(root, `gone-${provider}`)
        const produced = await resumesInto(provider, gone)
        expect(produced).toBeInstanceOf(ResumeError)
        expect(spawnNoWaitClearsOf(produced)).toBe('ENOENT')
        expect(produced.message).toMatch(/ENOENT$/)
        expect(produced.message).not.toContain(gone)
      },
    )
  })

  // ───────────────────────────────────────────────────────────────────────────────
  // §1 · a person's Resume
  // ───────────────────────────────────────────────────────────────────────────────

  describe.each(['claude', 'codex'] as const)(
    '§1 · a person’s Resume, on %s’s own error',
    (provider) => {
      it('🔴 the folder is gone: the sentence says so and names it — through the host and the IPC', async () => {
        const folder = join(root, `project-${provider}`)
        const sessionId = await aClosedConversationIn(provider, folder)
        rmSync(folder, { recursive: true })
        const produced = await resumesInto(provider, folder)
        gate.resumeFails = () => produced
        vi.spyOn(console, 'warn').mockImplementation(() => {})
        const entered = gate.entered

        const said = await theReopen(sessionId)
        expect(said).toBe(theFolderIsGone(folder))
        expect(said).not.toMatch(/ENOENT|spawn |claude-agent-sdk|codex app-server/)
        // ⚑ Asked once, and classified after the fact: the provider was asked to resume.
        expect(gate.entered).toBe(entered + 1)
        // ⚑ …and what a window's IPC hands the renderer is the same sentence.
        const viaTheWindow = await executeRuntimeCommand(host, window, {
          kind: 'resume',
          sessionId,
        }).then(
          () => 'RESOLVED',
          (error: Error) => error.message,
        )
        expect(viaTheWindow).toBe(theFolderIsGone(folder))
      })
    },
  )

  describe('§1 · controls — only a gone folder under a spawn’s `ENOENT` says so', () => {
    it('⚑ a missing PROGRAM in a folder that is there keeps its own words', async () => {
      const folder = join(root, 'here')
      const sessionId = await aClosedConversationIn('claude', folder)
      const ref = { provider: 'claude' as const, sessionId: 'sess_x', cwd: folder, rotation: 0 }
      gate.resumeFails = () =>
        new ResumeError(ref, 'resume setup failed: spawn /x/claude ENOENT', {
          cause: Object.assign(new Error('spawn /x/claude ENOENT'), {
            code: 'ENOENT',
            syscall: 'spawn /x/claude',
            path: '/x/claude',
          }),
        })
      vi.spyOn(console, 'warn').mockImplementation(() => {})
      const said = await theReopen(sessionId)
      expect(said).toBe('resume setup failed: spawn /x/claude ENOENT')
      expect(said).not.toContain('no longer there')
    })

    it('⚑ a gone folder under a failure that is not a spawn `ENOENT` keeps that failure’s words', async () => {
      const folder = join(root, 'gone-but-short')
      const sessionId = await aClosedConversationIn('claude', folder)
      rmSync(folder, { recursive: true })
      const ref = { provider: 'claude' as const, sessionId: 'sess_x', cwd: folder, rotation: 0 }
      gate.resumeFails = () =>
        new ResumeError(ref, 'resume setup failed: spawn /x/claude EMFILE', {
          cause: Object.assign(new Error('spawn /x/claude EMFILE'), {
            code: 'EMFILE',
            syscall: 'spawn /x/claude',
          }),
        })
      vi.spyOn(console, 'warn').mockImplementation(() => {})
      const said = await theReopen(sessionId)
      expect(said).toContain('BroCrew had too many files open')
      expect(said).not.toContain('no longer there')
    })

    it('⚑ a gone folder the provider LOST the conversation in keeps the provider’s words', async () => {
      // ⚑ Not a spawn at all: the provider has no such conversation (`noSuchSession`), which is
      // `692`'s signal to let a kept-open conversation go. ⛔ Called *the folder* here, that signal
      // would be wrapped away and a person told to put back a folder that would not bring it back.
      const folder = join(root, 'gone-and-lost')
      const sessionId = await aClosedConversationIn('codex', folder)
      rmSync(folder, { recursive: true })
      issued.forgetAll()
      vi.spyOn(console, 'warn').mockImplementation(() => {})
      const said = await theReopen(sessionId)
      expect(said).toContain('unknown session')
      expect(said).not.toContain('no longer there')
    })

    it('⚑ a gone folder whose launch WORKS reopens — nothing is asked before the launch', async () => {
      const folder = join(root, 'gone-but-fine')
      const sessionId = await aClosedConversationIn('codex', folder)
      rmSync(folder, { recursive: true })
      const reopened = await host.resumeSession(sessionId, window)
      expect(reopened.sessionId).toBe(sessionId)
    })
  })

  // ───────────────────────────────────────────────────────────────────────────────
  // §2 · the wake
  // ───────────────────────────────────────────────────────────────────────────────

  /**
   * A worker the PM gave work — the give started its conversation — and that then STOPPED: the
   * conversation a wake brings back (716's). ⚑ **D-017** — the PM's `end_agent` stopped it here, and
   * is gone; the app's own close is the same stop. ⚑ **D-016** — the give names the worker's own
   * `folder`, so the folder §2 removes is the worker's alone, not the PM's.
   */
  const aWorkerThatStopped = async (): Promise<{ pm: string; worker: string; piece: string }> => {
    const writer = await host.createSession(
      { provider: 'claude', profileId: 'worker', approvalMode: 'auto', cwd: root },
      window,
    )
    await host.close(writer.sessionId, window)
    const pm = (
      await host.createSession(
        { provider: 'claude', profileId: 'pm', approvalMode: 'auto', cwd: root },
        window,
      )
    ).sessionId
    const folder = join(root, 'the-workers-folder')
    mkdirSync(folder, { recursive: true })
    const given = await callOn(pm, 'give_work', {
      definition_of_done: 'The requested result and its checks are recorded.',
      profile: 'worker',
      title: 'the work',
      brief: 'migrate',
      folder,
    })
    expect(given.outcome, JSON.stringify(given)).toBe('ok')
    const worker = given.agent as string
    await waitFor(
      () => store.piecesOwnedBy(worker).some((piece) => piece.giver === pm),
      'the give to write its piece',
    )
    await host.close(worker, THE_APP_ITSELF)
    await waitFor(() => !host.sessionIds.includes(worker), 'the worker to be over')
    return { pm, worker, piece: given.label as string }
  }

  /**
   * ⚑ **D-017 · R1 — the wake is the start a message makes**: `resume_agent` is gone, and a
   * `message_agent` to a conversation that is not running starts it, answering a start that did not
   * happen in the wake's words. ⚠️ A follow-up on the piece the PM gave it (D-016: a follow-up
   * names its piece), because that piece stalled when its turn ended, and a second give would be
   * refused by the stall rule before any start.
   */
  const wakeByMessage = (
    pm: string,
    worker: string,
    piece: string,
  ): Promise<Record<string, unknown>> =>
    callOn(pm, 'message_agent', { agent: worker, text: 'carry on', kind: 'follow-up', piece })

  describe.each(['claude', 'codex'] as const)(
    '§2 · the start a message makes, on %s’s adapter error — in a Claude conversation’s wake',
    (provider) => {
      it('🔴 the wake says the folder is gone — never that the program could not run', async () => {
        const { pm, worker, piece } = await aWorkerThatStopped()
        const folder = store.find(worker)?.ref.cwd
        if (folder === undefined) throw new Error('the worker recorded no folder')
        expect(existsSync(folder)).toBe(true)
        rmSync(folder, { recursive: true })
        const produced = await resumesInto(provider, folder)
        gate.resumeFails = () => produced
        vi.spyOn(console, 'warn').mockImplementation(() => {})

        const refused = await wakeByMessage(pm, worker, piece)
        expect(refused).toMatchObject({
          outcome: 'refused',
          rail: COULD_NOT_BE_RESUMED,
          retryable: false,
          detail: { agent: worker, because: 'its-folder-is-gone' },
        })
        const exported = tools as unknown as Record<string, unknown>
        expect(typeof exported.A_WAKE_WHOSE_FOLDER_IS_GONE, 'no sentence for a gone folder').toBe(
          'string',
        )
        expect(refused.reason).toBe(exported.A_WAKE_WHOSE_FOLDER_IS_GONE)
        expect(refused.reason).not.toBe(tools.A_WAKE_WHOSE_PROGRAM_COULD_NOT_RUN)
      })
    },
  )

  it('⚑ control — a wake whose folder is THERE keeps the provider’s word', async () => {
    const { pm, worker, piece } = await aWorkerThatStopped()
    const ref = { provider: 'claude' as const, sessionId: 'sess_x', cwd: root, rotation: 0 }
    gate.resumeFails = () =>
      new ResumeError(ref, 'resume setup failed: spawn /x/claude ENOENT', {
        cause: Object.assign(new Error('spawn /x/claude ENOENT'), {
          code: 'ENOENT',
          syscall: 'spawn /x/claude',
        }),
      })
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const refused = await wakeByMessage(pm, worker, piece)
    expect(refused).toMatchObject({
      rail: COULD_NOT_BE_RESUMED,
      detail: { agent: worker, because: 'the-provider-could-not-resume-it' },
    })
  })
})
