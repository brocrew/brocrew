import { chmodSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  AuthUnavailableError,
  ClaudeRuntime,
  FakeProviderSessions,
  ResumeError,
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
import { CodexUnavailableError } from '../src/main/runtime/codex-binary'
import { SessionUnavailable, describeUnavailable } from '../src/main/runtime/session-unavailable'
import { resolveSessionCwd } from '../src/main/runtime/scratch-cwd'
import type { RuntimeEventMessage } from '../src/shared/runtime-ipc'
import { ProviderDouble, anOpenGate, type ResumeGate } from './lib/provider-double'

// Windows chmod cannot create the POSIX EACCES fixture these witnesses require.
const itWithPosixChmod = process.platform === 'win32' ? it.skip : it

/**
 * # 🔴 716 · what a person must fix, said once — R66, R67 and `710` F-7
 *
 * ⚑ **PM ruling R66** (`710` F-1, F-2): *"R51 covers every start a person must fix. A host step a
 * person must fix (`EACCES` / `EROFS` / `ENOSPC` making a provider home or a workspace) and Claude's
 * 'Native CLI binary … not found', thrown before any spawn, get R51's permanent word, not a broken
 * tool. The sentence says which it is, a program or a folder, in words. The Claude adapter throws a
 * typed error for the missing binary, so the word is chosen by type, never by matching message text."*
 *
 * ⚑ **PM ruling R67** (`710` F-3): *"One word for a missing program, on both providers. Codex's
 * missing binary (`CodexUnavailableError`, today `agent-did-not-start` / `provider-binary-unavailable`)
 * answers with R51's `agent-could-not-be-started`."*
 *
 * ⚑ **`710` F-7, the main half**: *"a structured `reason` on a refused `createSession`, so the launcher
 * can skip its sign-in check when the refusal already said why."* ⛔ A rejection cannot carry one — only
 * its message crosses Electron's two hops (`716`'s map) — so the reason is ANSWERED, when asked for.
 *
 * ⚑ **The errors are real where they can be**: the folder's is Node's own `EACCES` from a `mkdir` under
 * a directory with no write bit; Claude's is the SDK's own resolver missing (the process reports an
 * architecture the SDK ships no program for — `packages/runtime/test/claude-binary.test.ts` §0);
 * Codex's is its resolver's class. ⚠️ Imported as a namespace (`tools`), so `main` — with none of the
 * new sentences — runs this file and goes RED on its assertions.
 */

const here = dirname(fileURLToPath(import.meta.url))
const migrationsFolder = join(here, '../src/main/db/migrations')

const CANNOT_BE_STARTED = 'agent-could-not-be-started'
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

const REAL_ARCH = Object.getOwnPropertyDescriptor(process, 'arch') as PropertyDescriptor

/** ⚑ Claude's missing program, made by the real adapter over the SDK's real resolver. */
async function claudesMissingProgram(root: string): Promise<Error> {
  Object.defineProperty(process, 'arch', { ...REAL_ARCH, value: 'mips' })
  try {
    return await new ClaudeRuntime(
      undefined,
      async () => true,
      undefined,
      undefined,
      () => {
        throw new Error('716: a Claude CLI was spawned by a test that must never start one')
      },
    )
      .start({ cwd: root, providerHome: join(root, 'claude-home-716'), approvalMode: 'auto' })
      .then(
        () => new Error('claude start RESOLVED'),
        (thrown: unknown) => thrown as Error,
      )
  } finally {
    Object.defineProperty(process, 'arch', REAL_ARCH)
  }
}

describe('716 · what a person must fix, said once', () => {
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
  /** ⚑ The HOST's own step failing — `prepareProviderHome`, which every launch and reopen runs. */
  let homeFails: (() => Error) | undefined

  beforeEach(() => {
    userData = mkdtempSync(join(tmpdir(), 'brobot2-716-'))
    root = mkdtempSync(join(tmpdir(), 'brobot2-716-root-'))
    db = openDatabase(join(userData, 'brobot2.sqlite'))
    applyMigrations(db, migrationsFolder)
    store = createSessionStore(db)
    counter = 0
    handles = []
    issued = new FakeProviderSessions()
    gate = anOpenGate()
    homeFails = undefined
    host = new RuntimeHost({
      store,
      discoverSessions: NO_DISCOVERY,
      nativeTranscriptPath: () => null,
      exportDirectory: () => join(userData, 'exports'),
      createRuntime: (provider: Provider) => new ProviderDouble(provider, handles, issued, gate),
      prepareProviderHome: (provider: Provider, profileId?: string) => {
        if (homeFails !== undefined) throw homeFails()
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
    Object.defineProperty(process, 'arch', REAL_ARCH)
    vi.restoreAllMocks()
    await host.closeAll()
    db.close()
    for (const dir of [userData, root]) {
      chmodSync(dir, 0o700)
      rmSync(dir, { recursive: true, force: true })
    }
  })

  /** ⚑ Node's own `EACCES`, from a `mkdir` under a directory with no write bit — measured each time. */
  const aFolderTheDiskRefuses = (): Error => {
    const locked = join(root, 'locked')
    mkdirSync(locked, { recursive: true })
    chmodSync(locked, 0o500)
    try {
      mkdirSync(join(locked, 'provider-home'))
    } catch (error) {
      return error as Error
    } finally {
      chmodSync(locked, 0o700)
    }
    throw new Error('the mkdir under a read-only directory was allowed — is this running as root?')
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
    name: tools.ToolName,
    args: Record<string, unknown> = {},
  ): Promise<Record<string, unknown>> => {
    const tool = tools.agentToolsFor(host, caller).tools.find((one) => one.name === name)
    if (tool === undefined) throw new Error(`no such tool: ${name}`)
    return (await tool.call(args)).structured as Record<string, unknown>
  }

  const aPmThatMaySpawn = async (): Promise<string> => {
    await host.close(await personOpens('worker'), window)
    const pm = await personOpens('pm')
    return pm
  }

  /**
   * ⚑ **D-016 · the give that starts the worker** — `spawn_agent`'s start, re-aimed: the PM has no
   * conversation with `worker` yet, so the give starts one, and its launch is what fails here.
   */
  const spawnWorker = (pm: string): Promise<Record<string, unknown>> =>
    callOn(pm, 'give_work', {
      definition_of_done: 'The requested result and its checks are recorded.',
      profile: 'worker',
      title: 'The work',
      brief: 'the work',
    })

  const waitFor = async (predicate: () => boolean, what: string): Promise<void> => {
    for (let attempt = 0; attempt < 400; attempt++) {
      if (predicate()) return
      await new Promise((resolve) => setTimeout(resolve, 10))
    }
    throw new Error(`timed out waiting for ${what}`)
  }

  /**
   * A worker the PM gave work, and that then STOPPED — the conversation a wake brings back
   * (`wake-one-conversation.test.ts` §4's `aWorkerOver`: a wake is for a child holding the caller's
   * open work). ⚑ **D-017** — the PM's `end_agent` stopped it here, and is gone; the app's own close
   * is the same stop. ⚑ **D-016** — the give starts it and gives it the work in one act.
   */
  const aWorkerThatStopped = async (pm: string): Promise<{ worker: string; label: string }> => {
    const given = await callOn(pm, 'give_work', {
      definition_of_done: 'The requested result and its checks are recorded.',
      profile: 'worker',
      title: 'The schema',
      brief: 'migrate the schema',
    })
    expect(given.outcome, JSON.stringify(given)).toBe('ok')
    const worker = given.agent as string
    await waitFor(
      () => store.piecesOwnedBy(worker).some((piece) => piece.giver === pm),
      'the give to open a piece',
    )
    await host.close(worker, THE_APP_ITSELF)
    await waitFor(() => !host.sessionIds.includes(worker), 'the worker to be over')
    return { worker, label: given.label as string }
  }

  /**
   * ⚑ **D-017 · R1 — the wake is the start a message makes**: `resume_agent` is gone, and a
   * `message_agent` to a conversation that is not running starts it, answering a start that did not
   * happen in the wake's words. ⚠️ A follow-up naming the piece, because the worker holds the PM's
   * open work (D-016: a second give would be refused `its-work-has-stalled` before any start).
   */
  const wakeByMessage = (
    pm: string,
    worker: string,
    label: string,
  ): Promise<Record<string, unknown>> =>
    callOn(pm, 'message_agent', {
      agent: worker,
      text: 'carry on',
      kind: 'follow-up',
      piece: label,
    })

  /** The program's sentence is the word's own; the folder's is said instead of it. */
  const programSentence = (): string => tools.refuseTool(CANNOT_BE_STARTED as never).reason

  // ───────────────────────────────────────────────────────────────────────────────
  // §1 · give_work's start (`spawn_agent` until D-016) — R66 and R67, the permanent word
  // ───────────────────────────────────────────────────────────────────────────────

  describe('§1 · `give_work`’s start: every start a person must fix has the permanent word', () => {
    it('🔴 R67 — Codex’s missing program answers `agent-could-not-be-started`, not `agent-did-not-start`', async () => {
      const pm = await aPmThatMaySpawn()
      vi.spyOn(console, 'warn').mockImplementation(() => {})
      gate.startFails = () =>
        new CodexUnavailableError('Codex isn’t available — the bundled Codex binary is missing.')
      const refused = await spawnWorker(pm)
      expect(refused).toMatchObject({
        outcome: 'refused',
        rail: CANNOT_BE_STARTED,
        permanence: 'until-a-person-changes-it',
        retryable: false,
        remedy: null,
        detail: { profile: 'worker', because: 'provider-binary-unavailable' },
      })
      expect(refused.reason).toBe(programSentence())
      expect(String(refused.reason)).toContain('program')
    })

    it('🔴 R66 — Claude’s missing program, as the SDK’s real resolver misses it: the same word, the same reason', async () => {
      const produced = await claudesMissingProgram(root)
      const pm = await aPmThatMaySpawn()
      vi.spyOn(console, 'warn').mockImplementation(() => {})
      gate.startFails = () => produced
      const refused = await spawnWorker(pm)
      expect(refused).toMatchObject({
        rail: CANNOT_BE_STARTED,
        retryable: false,
        detail: { because: 'provider-binary-unavailable' },
      })
      expect(refused.reason).toBe(programSentence())
    })

    itWithPosixChmod(
      '🔴 R66 — a folder the disk refused (Node’s own EACCES): the same word, in a FOLDER’s sentence',
      async () => {
        const pm = await aPmThatMaySpawn()
        const logged = vi.spyOn(console, 'warn').mockImplementation(() => {})
        const refusal = aFolderTheDiskRefuses()
        homeFails = () => refusal
        const refused = await spawnWorker(pm)
        expect(refused).toMatchObject({
          outcome: 'refused',
          rail: CANNOT_BE_STARTED,
          permanence: 'until-a-person-changes-it',
          retryable: false,
          detail: { profile: 'worker', because: 'EACCES' },
        })
        // ⚑ **The sentence says which, in words** (R66): a folder, not a program.
        expect(refused.reason).toBe(tools.A_FOLDER_COULD_NOT_BE_MADE)
        expect(String(refused.reason)).toContain('folder')
        expect(String(refused.reason)).not.toContain('program')
        const act = String(refused.reason).indexOf('nothing was sent')
        expect(act).toBeGreaterThanOrEqual(0)
        expect(act).toBeLessThan(200)
        // ⛔ …and the path stays in the log, never in what the model is handed.
        expect(JSON.stringify(refused)).not.toContain(join(root, 'locked'))
        expect(logged.mock.calls.some(([line]) => String(line).includes('(EACCES)'))).toBe(true)
      },
    )

    it.each([
      ['EROFS', 'mkdir'],
      ['ENOSPC', 'mkdir'],
      ['ENOTDIR', 'open'],
    ])('🔴 R66 — %s from `%s` is the same word', async (code, syscall) => {
      const pm = await aPmThatMaySpawn()
      vi.spyOn(console, 'warn').mockImplementation(() => {})
      homeFails = () => Object.assign(new Error(`${code}: ${syscall}`), { code, syscall })
      const refused = await spawnWorker(pm)
      expect(refused).toMatchObject({ rail: CANNOT_BE_STARTED, detail: { because: code } })
      expect(refused.reason).toBe(tools.A_FOLDER_COULD_NOT_BE_MADE)
    })

    it('⚑ control — a sign-in keeps `agent-did-not-start`, and its sentence says whose and what fixes it', async () => {
      const pm = await aPmThatMaySpawn()
      vi.spyOn(console, 'warn').mockImplementation(() => {})
      gate.startFails = () => new AuthUnavailableError('claude', 'signed out')
      const refused = await spawnWorker(pm)
      expect(refused).toMatchObject({
        rail: 'agent-did-not-start',
        detail: { because: 'its-sign-in-is-unusable', provider: 'claude' },
      })
      expect(String(refused.reason)).toContain('its Claude sign-in could not be used')
      expect(String(refused.reason)).not.toContain('somebody stopped it first')
    })

    it('⚑ control — a machine that ran short keeps its retryable word', async () => {
      const pm = await aPmThatMaySpawn()
      vi.spyOn(console, 'warn').mockImplementation(() => {})
      homeFails = () =>
        Object.assign(new Error('EMFILE: open'), { code: 'EMFILE', syscall: 'open' })
      expect((await spawnWorker(pm)).rail).toBe('agent-could-not-start-just-now')
    })

    it('⚑ control — a containment refusal (a plain Error, no code) is still a broken tool', async () => {
      const pm = await aPmThatMaySpawn()
      homeFails = () => new Error('providerHome ancestor passes through a symlink')
      await expect(spawnWorker(pm)).rejects.toThrow('passes through a symlink')
    })
  })

  // ───────────────────────────────────────────────────────────────────────────────
  // §2 · the wake — the WAKE's permanent word, and the sentence that says which
  // ───────────────────────────────────────────────────────────────────────────────

  describe('§2 · the start a message makes: the wake’s own permanent word, saying which', () => {
    it('🔴 a missing program at a wake: `that-conversation-could-not-be-resumed`, in the program’s words', async () => {
      const pm = await aPmThatMaySpawn()
      const { worker, label } = await aWorkerThatStopped(pm)
      vi.spyOn(console, 'warn').mockImplementation(() => {})
      gate.resumeFails = () => new CodexUnavailableError('Codex isn’t available.')
      const refused = await wakeByMessage(pm, worker, label)
      expect(refused).toMatchObject({
        rail: COULD_NOT_BE_RESUMED,
        retryable: false,
        detail: { agent: worker, because: 'provider-binary-unavailable' },
      })
      expect(refused.reason).toBe(tools.A_WAKE_WHOSE_PROGRAM_COULD_NOT_RUN)
    })

    itWithPosixChmod(
      '🔴 a folder the disk refused at a wake: the wake’s word, in the folder’s words',
      async () => {
        const pm = await aPmThatMaySpawn()
        const { worker, label } = await aWorkerThatStopped(pm)
        vi.spyOn(console, 'warn').mockImplementation(() => {})
        const refusal = aFolderTheDiskRefuses()
        homeFails = () => refusal
        const refused = await wakeByMessage(pm, worker, label)
        expect(refused).toMatchObject({
          rail: COULD_NOT_BE_RESUMED,
          retryable: false,
          detail: { agent: worker, because: 'EACCES' },
        })
        expect(refused.reason).toBe(tools.A_WAKE_WHOSE_FOLDER_COULD_NOT_BE_MADE)
      },
    )

    it('⚑ control — a provider that lost the conversation is not refused: a new one takes its place', async () => {
      const pm = await aPmThatMaySpawn()
      const { worker, label } = await aWorkerThatStopped(pm)
      vi.spyOn(console, 'warn').mockImplementation(() => {})
      issued.forgetAll()
      // ⚑ **D-017 · R10** — it kept `that-conversation-could-not-be-resumed` and its reason; a
      // conversation its provider no longer has is REPLACED now, by a new conversation of the same
      // agent, which takes the message. ⛔ So the two arms above are the only ones a person must fix.
      const sent = await wakeByMessage(pm, worker, label)
      expect(sent, JSON.stringify(sent)).toMatchObject({ outcome: 'ok', agent: worker })
      expect(typeof sent.went_to).toBe('string')
      expect(sent.went_to).not.toBe(worker)
      expect(JSON.stringify(sent)).not.toContain(COULD_NOT_BE_RESUMED)
    })
  })

  // ───────────────────────────────────────────────────────────────────────────────
  // §3 · a person's two doors — New Conversation and a message that continues one (D-017b)
  // ───────────────────────────────────────────────────────────────────────────────

  describe('§3 · what a PERSON reads when a folder was refused', () => {
    itWithPosixChmod(
      '🔴 New Conversation: what failed, where, why, and what to do — not Node’s errno',
      async () => {
        vi.spyOn(console, 'warn').mockImplementation(() => {})
        const refusal = aFolderTheDiskRefuses()
        homeFails = () => refusal
        // ⚑ Node names the folder that was NOT made; the one a person can fix is the one holding it
        // (review of `716`), and the sentence names both.
        const notMade = join(root, 'locked', 'provider-home')
        await expect(personOpens('writer')).rejects.toThrow(
          `This conversation did not open: BroCrew could not make the folder ${notMade}, because it may not write in ${join(root, 'locked')}. Give BroCrew permission to write to that folder, then start it again.`,
        )
      },
    )

    // ⚑ **D-017b · re-aimed, not stripped** (rule 26): there is no *Reopen* press — a person's
    // message to a stopped conversation continues it (`startAndSend`, which reopens underneath), so
    // the sentence is said of continuing it and its remedy is to send the message again.
    it('🔴 a message to a stopped conversation: the same, said of continuing it', async () => {
      const sessionId = await personOpens('writer')
      await host.close(sessionId, window)
      vi.spyOn(console, 'warn').mockImplementation(() => {})
      homeFails = () =>
        Object.assign(new Error('ENOSPC: mkdir'), { code: 'ENOSPC', syscall: 'mkdir' })
      const SAID =
        'This conversation did not continue: BroCrew could not make or write a folder it needs, because the disk or its quota is full. Free some space on it, then send it your message again.'
      // ⚑ The person's door — the message — and the sentence it answers with, nothing sent.
      const answer = await host.startAndSend(sessionId, 'carry on', window)
      expect('notSent' in answer ? answer.notSent : null).toMatchObject({
        refusedBy: 'the-start',
        said: SAID,
      })
      // ⚑ …which is the reopen underneath, said in the same words.
      await expect(host.resumeSession(sessionId, window)).rejects.toThrow(SAID)
    })

    it('🔴 a call on an entry that EXISTS is refused by that entry — not by the folder that holds it', () => {
      // ⚑ Round two of `716`'s review: the provider home's `chmod` runs on a home that exists.
      expect(
        describeUnavailable(
          'its-folder-could-not-be-made' as never,
          {
            folder: { code: 'EPERM', path: '/h/claude', syscall: 'chmod' },
          } as never,
        ),
      ).toBe(
        'This conversation did not open: BroCrew could not set the permissions of /h/claude, because it may not change it. Give BroCrew permission to change it, then start it again.',
      )
    })

    itWithPosixChmod(
      '🔴 the launcher’s model field says it too — never Node’s errno (review of `716`)',
      async () => {
        await host.close(await personOpens('writer'), window)
        vi.spyOn(console, 'warn').mockImplementation(() => {})
        const refusal = aFolderTheDiskRefuses()
        homeFails = () => refusal
        expect(await host.providerModels('writer', 'claude')).toEqual({
          ok: false,
          reason: 'refused',
          detail: `BroCrew could not make the folder ${join(root, 'locked', 'provider-home')}, because it may not write in ${join(root, 'locked')}. Give BroCrew permission to write to that folder`,
        })
      },
    )

    it('⚑ control — what a provider’s RESUME failed on stays the provider’s, never a folder', async () => {
      // ⚑ True on `main` too. ⛔ Without the reader's stop at a `ResumeError`, an `open` the adapter
      // made reading its transcript would be told a folder BroCrew could not make (review of `716`).
      const sessionId = await personOpens('writer')
      await host.close(sessionId, window)
      vi.spyOn(console, 'warn').mockImplementation(() => {})
      const ref = { provider: 'claude' as const, sessionId: 'x', cwd: root, rotation: 0 }
      gate.resumeFails = () =>
        new ResumeError(ref, 'resume setup failed: EACCES: permission denied', {
          cause: Object.assign(new Error('EACCES: permission denied, open'), {
            code: 'EACCES',
            syscall: 'open',
            path: join(root, 'transcript.jsonl'),
          }),
        })
      const failure = await host.resumeSession(sessionId, window).catch((error: Error) => error)
      expect((failure as Error).message).toContain('resume setup failed')
      // ⚑ Neither folder sentence: the reader would have said *could not write* for an `open`.
      expect((failure as Error).message).not.toContain('BroCrew could not')
    })

    it('⚑ control — a containment refusal still reaches a person as its own words', async () => {
      homeFails = () => new Error('providerHome ancestor passes through a symlink')
      await expect(personOpens('writer')).rejects.toThrow(
        'providerHome ancestor passes through a symlink',
      )
    })
  })

  // ───────────────────────────────────────────────────────────────────────────────
  // §4 · `710` F-7 — the refusal's word, answered to a launcher that asks
  // ───────────────────────────────────────────────────────────────────────────────

  describe('§4 · `710` F-7 — `createSession` answers a refusal, with its word, when asked', () => {
    const create = (extra: Record<string, unknown> = {}): Promise<unknown> =>
      executeRuntimeCommand(host, window, {
        kind: 'createSession',
        provider: 'claude',
        profileId: 'writer',
        approvalMode: 'auto',
        cwd: root,
        ...extra,
      })

    let warned: ReturnType<typeof vi.spyOn> | null = null
    const answered = async (fail: () => void): Promise<unknown> => {
      warned = vi.spyOn(console, 'warn').mockImplementation(() => {})
      fail()
      return await create({ answerARefusal: true })
    }

    it.each([
      [
        'a folder the disk refused',
        'folder',
        () => {
          homeFails = () =>
            Object.assign(new Error('EROFS: mkdir'), { code: 'EROFS', syscall: 'mkdir' })
        },
      ],
      [
        'a machine that ran short',
        'machine',
        () => {
          homeFails = () =>
            Object.assign(new Error('EMFILE: open'), { code: 'EMFILE', syscall: 'open' })
        },
      ],
      [
        'Codex’s missing program',
        'program',
        () => {
          gate.startFails = () => new CodexUnavailableError('Codex isn’t available.')
        },
      ],
      [
        'a sign-in',
        'sign-in',
        () => {
          homeFails = () => new AuthUnavailableError('claude', 'Claude machine login unavailable')
        },
      ],
      [
        'a spawn’s code no wait clears',
        'program',
        () => {
          gate.startFails = () =>
            Object.assign(new Error('spawn /x/claude ENOENT'), {
              code: 'ENOENT',
              syscall: 'spawn /x/claude',
            })
        },
      ],
      [
        'a start that took too long',
        'launch',
        () => {
          gate.startFails = () =>
            new SessionUnavailable('took-too-long', 'x', { waitedForMs: 15_000 })
        },
      ],
      [
        'a start stopped before it opened',
        'cancelled',
        () => {
          gate.startFails = () => new SessionUnavailable('cancelled', 'x')
        },
      ],
    ])(
      '🔴 %s is answered `%s`, with the sentence a rejection would carry',
      async (_what, reason, fail) => {
        const answer = await answered(fail)
        expect(answer).toMatchObject({ refused: { reason } })
        // ⚑ …and logged whole, as a rejection would have been (review of `716`): nothing else
        // prints an answer, and a missing program's own words ride only as its cause.
        expect(
          warned?.mock.calls.some((call: unknown[]) =>
            String(call[0]).includes(`was refused (${reason}) and answered`),
          ),
        ).toBe(true)
        const said = (answer as { refused: { said: string } }).refused.said
        // ⚑ the same words the unasked-for rejection carries, byte for byte
        await expect(create()).rejects.toThrow(said)
      },
    )

    it('⚑ control — nobody asked: the same refusal is REJECTED, as it always was', async () => {
      homeFails = () =>
        Object.assign(new Error('EROFS: mkdir'), { code: 'EROFS', syscall: 'mkdir' })
      vi.spyOn(console, 'warn').mockImplementation(() => {})
      // ⚑ Rejected on `main` (with Node's words) and here (with the folder's): the opt-in changes
      // nothing for a caller that did not ask. What it says is §3's subject, not this arm's.
      await expect(create()).rejects.toThrow(/EROFS|read-only/)
    })

    it('⚑ control — a failure with no word is still rejected, even when asked', async () => {
      homeFails = () => new Error('providerHome ancestor passes through a symlink')
      await expect(create({ answerARefusal: true })).rejects.toThrow('passes through a symlink')
    })

    it('⚑ control — a start that works answers the session, asked or not', async () => {
      const created = (await create({ answerARefusal: true })) as { sessionId?: string }
      expect(created.sessionId).toMatch(/^sess_/)
    })
  })
})
