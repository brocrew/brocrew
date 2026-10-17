import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  FakeLaunchGate,
  FakeProviderSessions,
  FakeRuntime,
  ResumeError,
  type FakeSessionHandle,
  type ResumeOptions,
  type SessionRef,
  type StartOptions,
} from '@brobot2/runtime'
import type { Provider } from '@brobot2/shared'
import { type AppDatabase, openDatabase } from '../src/main/db/connection'
import { applyMigrations } from '../src/main/db/migrate'
import { createSessionStore, type SessionStore } from '../src/main/db/session-store'
import { NO_DISCOVERY } from '../src/main/adopt/discover-sessions'
import {
  RuntimeHost,
  THE_APP_ITSELF,
  type RuntimeEventSink,
} from '../src/main/runtime/runtime-host'
import { executeRuntimeCommand } from '../src/main/runtime/ipc'
import { resolveSessionCwd } from '../src/main/runtime/scratch-cwd'
import {
  A_FIRST_MESSAGE_IS_STARTING_IT,
  HELD_ELSEWHERE,
  NOTHING_TO_SEND,
  type FirstMessageAnswer,
  type HandedPath,
  type RuntimeEventMessage,
  type TranscriptEvent,
} from '../src/shared/runtime-ipc'

/**
 * 🔴 **735 · `701` F-8 — a first message to a conversation the quit left open, and the start it
 * causes, in ONE act** (PM ruling R34: *"a conversation the app closed ONLY because it quit comes
 * back OPEN at the next launch; its provider starts when something is sent to it, never at
 * launch."*).
 *
 * ⚑ **D-017b · every conversation is one view, and a message from it continues it** — whatever its
 * process is doing. So the door is no longer only for a conversation the quit left open: it attaches
 * one this window runs, takes one running with no window, and starts one nothing runs; it refuses
 * only a conversation another window has open (`held-elsewhere`). ⚑ There is no kept-open fact any
 * more (no `keptOpenAcrossAQuit`, no `stillWaiting`, no put-back of the quit's stamp), and a refusal
 * after the start is the send's own words, never a sentence about a process (`05` rule 5). ⚑ What a
 * test here reads off the rail is `running`, the one fact the list still carries about a process.
 *
 * ⛔ **The defect**: the window's first send ran the person's Reopen and then sent — two acts over two
 * doors, until `737` moved the pane onto this door — so a send refused after a good start left the
 * conversation RUNNING with the words handed back (§1's control measures it on those two doors). ⚑ `RuntimeHost.startAndSend` is
 * the one door: the words go and it runs, or they do not and nothing it started is left running.
 *
 * ⚑ **Real host, real SQLite ledger, real migrations.** The only double is the provider, counting
 * every launch the HOST asked for — so *"nothing started"* is a count, not an absence of events.
 * ⚠️ Each relaunch builds its own `SessionStore` over the same database
 * (`a-next-launch-test-needs-its-own-store-object`).
 */

const here = dirname(fileURLToPath(import.meta.url))
const migrationsFolder = join(here, '../src/main/db/migrations')

class AWindow implements RuntimeEventSink {
  readonly aPersonIsBehindIt = true
  readonly messages: RuntimeEventMessage[] = []
  alive = true
  constructor(readonly ownerId: string) {}
  send(message: RuntimeEventMessage): void {
    this.messages.push(message)
  }
  sendLiveness(): void {}
}

interface Launch {
  readonly kind: 'start' | 'resume'
  readonly handle: FakeSessionHandle
}

class LaunchCountingRuntime extends FakeRuntime {
  /** ⚑ One shot: the error the next resume throws, as a real adapter's. */
  static nextResumeThrows: unknown = null

  constructor(
    provider: Provider,
    private readonly launches: Launch[],
    sessions: FakeProviderSessions,
    gate: FakeLaunchGate | undefined,
  ) {
    super(provider, { sessions, ...(gate === undefined ? {} : { gate }) })
  }
  override async start(options: StartOptions): ReturnType<FakeRuntime['start']> {
    const handle = await super.start(options)
    this.launches.push({ kind: 'start', handle })
    return handle
  }
  override async resume(
    ref: SessionRef,
    options: ResumeOptions,
  ): ReturnType<FakeRuntime['resume']> {
    const thrown = LaunchCountingRuntime.nextResumeThrows
    if (thrown !== null) {
      LaunchCountingRuntime.nextResumeThrows = null
      throw thrown
    }
    const handle = await super.resume(ref, options)
    this.launches.push({ kind: 'resume', handle })
    return handle
  }
}

async function waitFor(predicate: () => boolean, what: string): Promise<void> {
  for (let attempt = 0; attempt < 400; attempt++) {
    if (predicate()) return
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
  throw new Error(`timed out waiting for ${what}`)
}

describe('735, D-017b · a person’s message continues a conversation in one act, whatever runs it', () => {
  let userData: string
  let root: string
  let db: AppDatabase
  let store: SessionStore
  let host: RuntimeHost
  let hosts: RuntimeHost[]
  let launches: Launch[]
  let issued: FakeProviderSessions
  let counter: number
  let clock: number
  let window: AWindow
  let gate: FakeLaunchGate | undefined
  /**
   * ⚑ Every change announced to the windows, with what the host's own rail read said of `watched`'s
   * `running` at that moment — what a rail that re-reads on the announcement would find.
   */
  let announced: { what: string; runningThen: string | null }[]
  let watched: string | null
  const tick = (): number => clock++

  const buildHost = (): RuntimeHost => {
    const built = new RuntimeHost({
      store,
      discoverSessions: NO_DISCOVERY,
      nativeTranscriptPath: () => null,
      exportDirectory: () => join(userData, 'exports'),
      createRuntime: (provider: Provider) =>
        new LaunchCountingRuntime(provider, launches, issued, gate),
      prepareProviderHome: (provider: Provider, profileId?: string) => {
        const home = join(userData, 'provider-homes', profileId ?? 'default', provider)
        mkdirSync(home, { recursive: true })
        return home
      },
      providerHomePath: (provider: Provider) => join(userData, 'provider-homes', provider),
      resolveCwd: (sessionId, requested) => resolveSessionCwd(userData, sessionId, requested),
      newSessionId: () => `sess_${++counter}`,
      now: tick,
      announce: (change) => {
        const row =
          watched === null
            ? undefined
            : built.resumableSessions().find((one) => one.sessionId === watched)
        announced.push({ what: change.what, runningThen: row?.running ?? null })
      },
      readProviderConfig: (_provider, home) => ({
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
    userData = mkdtempSync(join(tmpdir(), 'brobot2-735-'))
    // ⚑ Real path: a handed attachment is refused when the path it names and the path it resolves
    // to differ, and macOS hands out `/var/…` for `/private/var/…`.
    root = realpathSync(mkdtempSync(join(tmpdir(), 'brobot2-735-root-')))
    db = openDatabase(join(userData, 'brobot2.sqlite'))
    applyMigrations(db, migrationsFolder)
    clock = 9_000_000
    store = createSessionStore(db, tick)
    counter = 0
    hosts = []
    launches = []
    issued = new FakeProviderSessions()
    gate = undefined
    announced = []
    watched = null
    LaunchCountingRuntime.nextResumeThrows = null
    host = buildHost()
    window = new AWindow('webContents:1')
  })

  afterEach(async () => {
    for (const built of hosts) await built.closeAll()
    db.close()
    for (const dir of [userData, root]) rmSync(dir, { recursive: true, force: true })
  })

  const ledger = (sessionId: string): TranscriptEvent[] =>
    store.events(sessionId).map((entry) => entry.event)

  const letItSettle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 60))

  /**
   * What the rail says about one conversation — ⚑ **D-017b** its `running`, and never a kept-open
   * word: the row carries none (asserted, so a split that came back would redden here).
   */
  const listed = (sessionId: string): { running: string } => {
    const row = host.resumableSessions().find((one) => one.sessionId === sessionId)
    if (row === undefined) throw new Error(`${sessionId} is not listed`)
    expect(row).not.toHaveProperty('keptOpenAcrossAQuit')
    return { running: row.running }
  }

  const NOTHING_RUNS_IT = { running: 'not-running' }

  /** ⚑ A person's conversation, idle when the person quit; at the next launch nothing runs it. */
  const aConversationTheQuitStopped = async (): Promise<string> => {
    const { sessionId } = await host.createSession(
      { provider: 'claude', approvalMode: 'ask', cwd: root },
      window,
    )
    await host.closeAll()
    store = createSessionStore(db, tick)
    host = buildHost()
    window = new AWindow('webContents:2')
    expect(listed(sessionId), 'the premise: nothing runs it after the restart').toEqual(
      NOTHING_RUNS_IT,
    )
    return sessionId
  }

  /** ⚑ A person's conversation, running in this window. */
  const aConversationThisWindowRuns = async (): Promise<string> => {
    const { sessionId } = await host.createSession(
      { provider: 'claude', approvalMode: 'ask', cwd: root },
      window,
    )
    return sessionId
  }

  /** ⚑ A file the person attached, as main classified it when they did. */
  const attached = (name: string): HandedPath => {
    const path = join(root, name)
    writeFileSync(path, 'the notes\n')
    return { path, kind: 'file', outsideCwd: false }
  }

  const answered = (sessionId: string, text: string): boolean =>
    ledger(sessionId).some(
      (event) =>
        event.type === 'assistant_message' &&
        event.text.startsWith('echo: ') &&
        event.text.includes(text),
    )

  const turnsOf = (sessionId: string): string[] =>
    ledger(sessionId).flatMap((event) => (event.type === 'user_turn' ? [event.text] : []))

  const notSentOf = (
    answer: FirstMessageAnswer,
  ): Extract<FirstMessageAnswer, { notSent: unknown }>['notSent'] => {
    if (!('notSent' in answer)) throw new Error(`it was sent: ${JSON.stringify(answer)}`)
    return answer.notSent
  }

  /**
   * ⚑ **D-017 · R1 — the first message's send is `sendAs`, inside its one arrivals entry** (never
   * `send`, which would join the chain behind that very entry), so a refusal only the started
   * conversation could make is planted THERE — once: every later send goes through the real door.
   */
  const theFirstMessagesSendRefuses = (refuse: (sessionId: string) => Promise<void>): void => {
    const door = host as unknown as {
      sendAs: (sessionId: string, ...rest: unknown[]) => Promise<void>
    }
    const real = door.sendAs.bind(host)
    door.sendAs = async (sessionId: string): Promise<void> => {
      door.sendAs = real
      return refuse(sessionId)
    }
  }

  // ───────────────────────────────────────────────────────────────────────────────────────────
  // §1 · refused before the start — nothing starts
  // ───────────────────────────────────────────────────────────────────────────────────────────

  describe('§1 · a first message refused for what it IS starts nothing', () => {
    it('⛔ control — the two acts the window used until `737`: a start, then a send refused, leave it RUNNING', async () => {
      // ⚑ **The defect, measured on the doors the window used until `737`** (`kept-open.ts`, which
      // since `737` calls this door instead): the person's Reopen, then the person's send. A file attached and moved before the press is refused by
      // the send — after the start.
      const id = await aConversationTheQuitStopped()
      const notes = attached('notes.md')
      rmSync(notes.path)
      const before = launches.length

      await host.resumeSession(id, window)
      await expect(host.send(id, 'look at this', window, [notes])).rejects.toThrow(
        /moved or deleted/,
      )
      expect(launches.length - before, 'the start the send could not use').toBe(1)
      expect(listed(id), 'running, with no message in it').toEqual({ running: 'in-a-window' })
    })

    it('🔴 through the one door: refused, NOTHING started, and nothing runs it still', async () => {
      const id = await aConversationTheQuitStopped()
      const notes = attached('notes.md')
      rmSync(notes.path)
      const before = launches.length

      const refused = notSentOf(await host.startAndSend(id, 'look at this', window, [notes]))

      expect(refused.refusedBy).toBe('before-the-start')
      expect(refused.said).toMatch(/moved or deleted/)
      expect(refused.launch).toBeNull()
      expect(refused.running).toBeNull()
      await letItSettle()
      expect(
        launches.length - before,
        'a provider was started for a message that could not go',
      ).toBe(0)
      expect(listed(id)).toEqual(NOTHING_RUNS_IT)
      expect(turnsOf(id)).not.toContain('look at this')
    })

    it('⚑ no words and nothing attached — refused at the door too, before anything starts', async () => {
      const id = await aConversationTheQuitStopped()
      const before = launches.length
      const refused = notSentOf(await host.startAndSend(id, '   ', window))
      expect(refused).toEqual({
        refusedBy: 'before-the-start',
        said: NOTHING_TO_SEND,
        launch: null,
        running: null,
      })
      expect(launches.length - before).toBe(0)
    })
  })

  describe('§1b · one first message at a time', () => {
    it('⚑ a second first message while the first is starting it is answered `already-starting` — one start', async () => {
      const id = await aConversationTheQuitStopped()
      gate = new FakeLaunchGate()
      host = buildHost()
      const before = launches.length
      const first = host.startAndSend(id, 'one', window)
      await waitFor(() => (gate?.held ?? 0) > 0, 'the first to be inside its launch')

      const second = notSentOf(await host.startAndSend(id, 'two', window))

      expect(second.refusedBy).toBe('already-starting')
      expect(second.said).toBe(A_FIRST_MESSAGE_IS_STARTING_IT)
      gate.release()
      const answer = await first
      expect('sent' in answer, JSON.stringify(answer)).toBe(true)
      await waitFor(() => answered(id, 'one'), 'the first message to be answered')
      expect(turnsOf(id)).toEqual(['one'])
      expect(launches.length - before).toBe(1)
    })
  })

  // ───────────────────────────────────────────────────────────────────────────────────────────
  // §2 · refused after the start — the start is undone
  // ───────────────────────────────────────────────────────────────────────────────────────────

  describe('§2 · a refusal only the STARTED conversation could make undoes the start', () => {
    it('🔴 a listed command carrying a file (R42): stopped at once, and nothing runs it again', async () => {
      // ⚑ **Only the provider can say `/usage` is one of its commands** — its list is asked of the
      // started conversation — so this refusal cannot be made before the start.
      const id = await aConversationTheQuitStopped()
      const notes = attached('notes.md')
      const before = launches.length
      watched = id
      announced = []

      const refused = notSentOf(await host.startAndSend(id, '/usage', window, [notes]))

      expect(refused.refusedBy).toBe('after-the-start')
      expect(refused.said).toContain('/usage')
      // ⚑ **D-017b · the send's own words, and nothing about a process** (`05` rule 5): it said
      // *"…was stopped again, so it is still open, with nothing running in it"*.
      expect(refused.said).not.toMatch(/running|stopped|started/i)
      expect(refused.launch).toBeNull()
      // ⚑ **Started once — and stopped**: the one provider the door asked for is closed.
      expect(launches.length - before).toBe(1)
      expect(launches.at(-1)?.kind).toBe('resume')
      expect(launches.at(-1)?.handle.status()).toBe('ended')
      expect(listed(id)).toEqual(NOTHING_RUNS_IT)
      expect(turnsOf(id)).not.toContain('/usage')
      // ⚑ **…and the last word the windows were told is the true one**: a rail that re-read on the
      // last announcement finds nothing running it, as the answer says.
      expect(refused.running).toBeNull()
      const told = announced.filter((change) => change.what === 'conversations')
      expect(told.length, 'the start and the stop were announced').toBeGreaterThan(0)
      expect(told.at(-1)?.runningThen, 'the last word the lists had was not the true one').toBe(
        'not-running',
      )
    })

    it('⚑ …and the next first message starts it again, and is answered', async () => {
      const id = await aConversationTheQuitStopped()
      const notes = attached('notes.md')
      notSentOf(await host.startAndSend(id, '/usage', window, [notes]))

      const answer = await host.startAndSend(id, 'where were we', window)

      expect('sent' in answer && answer.sent.sessionId).toBe(id)
      await waitFor(() => answered(id, 'where were we'), 'the answer')
      expect(listed(id)).toEqual({ running: 'in-a-window' })
    })

    it('⚑ a provider that FAILED as it started is a stop — the answer leads with the message and says the failure’s words', async () => {
      // ⚑ The undo is for a start that is still running. One that ended on its own is that ending's.
      // ⚑ **D-017 · R3 — a provider's failure is a STOP**: a message starts it again. ⚑ **D-017b** —
      // the refusal is led by what happened to the message (*"Your message did not go in"*), never
      // by the stop (*"It stopped as it started"*), and opens on what the provider failed with,
      // never on the door's *unknown session* about the slot it took away.
      const id = await aConversationTheQuitStopped()
      const resumed = host.resumeSession.bind(host)
      host.resumeSession = async (...args) => {
        const reopened = await resumed(...args)
        launches.at(-1)?.handle.simulateError('the provider fell over', true)
        await letItSettle()
        return reopened
      }

      const refused = notSentOf(await host.startAndSend(id, 'look at this', window))

      expect(refused.refusedBy).toBe('after-the-start')
      expect(refused.said).toBe('Your message did not go in: the provider fell over.')
      expect(refused.said).not.toMatch(/unknown session/)
      expect(refused.running).toBeNull()
      expect(listed(id)).toEqual(NOTHING_RUNS_IT)
    })
  })

  describe('§2b · a Close that is not the undo’s own', () => {
    it('⛔ a person’s Close landing while the first message is refused is theirs — the undo leaves it to that stop', async () => {
      // ⚑ The undo is for the start it made. A conversation the person is already closing is on its
      // way out by the person's own act, and the undo does not stop it a second time.
      const id = await aConversationTheQuitStopped()
      theFirstMessagesSendRefuses(async (): Promise<void> => {
        // ⚑ **A provider's stop takes time** — the double's is instant, so it is slowed here, and the
        // person's Close is still UNDER WAY when the undo asks (a real adapter's close awaits its
        // process).
        const handle = launches.at(-1)?.handle
        if (handle !== undefined) {
          const stop = handle.close.bind(handle)
          handle.close = async (): Promise<void> => {
            await new Promise((resolve) => setTimeout(resolve, 30))
            return stop()
          }
        }
        void host.close(id, window)
        throw new Error('cannot send: refused while the person closed it')
      })

      const refused = notSentOf(await host.startAndSend(id, 'hello', window))

      expect(refused.refusedBy).toBe('after-the-start')
      // ⚑ The send's own words, ended as a sentence — ⚑ **D-017b** and nothing about the start after
      // them: whether a process runs is not the answer's to say.
      expect(refused.said).toBe('cannot send: refused while the person closed it.')
      expect(refused.running).toBeNull()
      await letItSettle()
      expect(listed(id)).toEqual(NOTHING_RUNS_IT)
    })

    it('⛔ …and one landing WHILE the undo stops it is one more stop — nothing is handed over, and nothing runs it', async () => {
      // ⚑ **D-017b** — the undo put the quit's stamp back before its stop, and a person's Close during
      // that stop took it again; there is no stamp now, so what is left is the outcome: two stops
      // meet, and the answer is read off it.
      const id = await aConversationTheQuitStopped()
      const notes = attached('notes.md')
      const close = host.close.bind(host)
      host.close = (sessionId, by) => {
        const going = close(sessionId, by)
        // ⚑ The person presses End while the app's own stop is under way.
        if (by === THE_APP_ITSELF) void close(sessionId, window)
        return going
      }

      const refused = notSentOf(await host.startAndSend(id, '/usage', window, [notes]))

      expect(refused.refusedBy).toBe('after-the-start')
      expect(refused.said).toContain('/usage')
      expect(refused.said).not.toMatch(/running|stopped|started/i)
      expect(refused.running).toBeNull()
      await letItSettle()
      expect(listed(id)).toEqual(NOTHING_RUNS_IT)
    })

    it('⛔ a conversation that changed hands before the undo is not the undo’s — it is not stopped', async () => {
      const id = await aConversationTheQuitStopped()
      const other = new AWindow('webContents:7')
      theFirstMessagesSendRefuses(async (): Promise<void> => {
        // ⚑ The person closes what the door started, and another window reopens it — all before
        // the refusal reaches the undo.
        await host.close(id, window)
        await host.resumeSession(id, other)
        throw new Error('cannot send: refused after it changed hands')
      })

      const refused = notSentOf(await host.startAndSend(id, 'hello', window))

      expect(refused.refusedBy).toBe('after-the-start')
      expect(refused.running, 'not running in THIS window').toBeNull()
      expect(refused.said).toBe('cannot send: refused after it changed hands.')
      await letItSettle()
      expect(
        launches.at(-1)?.handle.status(),
        'the other window’s conversation was stopped',
      ).not.toBe('ended')
      expect(listed(id).running).toBe('in-a-window')
    })
  })

  describe('§2c · when the start is not the first message’s alone, it is handed over, not stopped', () => {
    it('🔴 another message reached it first — its turn is not cut, and the window gets the conversation', async () => {
      const id = await aConversationTheQuitStopped()
      // ⚑ **D-017 · R1 — every delivery that arrives during a start waits behind the message that
      // caused it**, so another message is there first only when it ARRIVED first: the app's own
      // message starts the conversation with no window, and in `ask` the double's turn parks on a
      // card, so it is still running for that sender when the person's first message comes.
      await host.queueMessage(id, 'the app has news for it', THE_APP_ITSELF)
      await waitFor(
        () => turnsOf(id).includes('the app has news for it'),
        'the app’s message to start it and go in',
      )
      const before = launches.length
      theFirstMessagesSendRefuses(async (): Promise<void> => {
        throw new Error('cannot send: refused after another message went in')
      })

      const refused = notSentOf(await host.startAndSend(id, 'hello', window))

      expect(refused.refusedBy).toBe('after-the-start')
      // ⚑ **D-017 · R5 — the window TOOK it**: nothing was started for this message, so nothing is
      // stopped again, and it is handed over running. ⚑ **D-017b** — the send's own words alone.
      expect(refused.said).toBe('cannot send: refused after another message went in.')
      expect(launches.length - before, 'taken, not started a second time').toBe(0)
      expect(refused.running?.sessionId, 'handed over, to adopt as a reopen').toBe(id)
      expect(refused.running?.handover).toBe('attached')
      expect(launches.at(-1)?.handle.status(), 'the other sender’s turn was cut').not.toBe('ended')
      expect(listed(id).running).toBe('in-a-window')
    })

    // ⚑ **D-017b** — the arm where the quit's stamp could not be PUT BACK is gone with the stamp's
    // put-back; the undo's one step that can fail now is its stop.
    it('⚑ a stop that fails leaves it running here — answered, not thrown, and handed over', async () => {
      const id = await aConversationTheQuitStopped()
      const notes = attached('notes.md')
      const close = host.close.bind(host)
      host.close = (sessionId, by) =>
        by === THE_APP_ITSELF
          ? Promise.reject(new Error('it would not stop'))
          : close(sessionId, by)

      const refused = notSentOf(await host.startAndSend(id, '/usage', window, [notes]))

      expect(refused.refusedBy).toBe('after-the-start')
      expect(refused.running?.sessionId).toBe(id)
      expect(refused.said).not.toMatch(/running|stopped|started/i)
      expect(listed(id).running).toBe('in-a-window')
      // ⚑ The quit in `afterEach` stops it through the same door.
      host.close = close
    })
  })

  // ───────────────────────────────────────────────────────────────────────────────────────────
  // §3 · the words go
  // ───────────────────────────────────────────────────────────────────────────────────────────

  describe('§3 · the first message starts it and is sent', () => {
    it('🔴 one launch, the words in it, answered — and it is running in this window', async () => {
      const id = await aConversationTheQuitStopped()
      const notes = attached('notes.md')
      const before = launches.length

      const answer = await host.startAndSend(id, 'read this, please', window, [notes])

      if (!('sent' in answer)) throw new Error(JSON.stringify(answer))
      expect(answer.sent.sessionId).toBe(id)
      expect(answer.sent.handover).toBe('resumed')
      expect(launches.length - before).toBe(1)
      await waitFor(() => answered(id, 'read this, please'), 'the answer')
      // ⚑ The attachment rode with the words, as a send's does.
      expect(answered(id, notes.path)).toBe(true)
      expect(listed(id)).toEqual({ running: 'in-a-window' })
    })
  })

  // ───────────────────────────────────────────────────────────────────────────────────────────
  // §4 · any conversation this window may send to — and never another window's
  // ───────────────────────────────────────────────────────────────────────────────────────────

  /**
   * ⚑ **D-017b · the door is every message from a conversation's view**, whatever its process is
   * doing: one this window runs is attached and sent to, one nothing runs is started. ⛔ It used to
   * answer `no-longer-waiting` for anything but a conversation the quit left open. ⚑ The one it still
   * refuses is a conversation ANOTHER window has open — `held-elsewhere`, and nothing is started.
   */
  describe('§4 · a conversation another window has open is not started, and not sent to', () => {
    it('⚑ control — an ordinary send to a LIVE conversation is unchanged', async () => {
      const id = await aConversationThisWindowRuns()
      const before = launches.length
      await host.send(id, 'hello there', window)
      await waitFor(() => answered(id, 'hello there'), 'the ordinary send to be answered')
      expect(launches.length - before, 'a send to a running conversation starts nothing').toBe(0)
      expect(turnsOf(id)).toEqual(['hello there'])
      expect(listed(id)).toEqual({ running: 'in-a-window' })
    })

    it('🔴 D-017b · …and this door sends to a live conversation this window runs — attached, nothing started, nothing stopped', async () => {
      const id = await aConversationThisWindowRuns()
      await host.send(id, 'hello there', window)
      await waitFor(() => answered(id, 'hello there'), 'the ordinary send to be answered')
      const before = launches.length

      const answer = await host.startAndSend(id, 'and again', window)

      if (!('sent' in answer)) throw new Error(`not sent: ${JSON.stringify(answer)}`)
      expect(answer.sent.sessionId).toBe(id)
      expect(answer.sent.handover).toBe('attached')
      // ⚑ **The words went in, as any send's do**: the first turn is parked on its card (`ask`), so
      // they are held for the turn after it — a send's own lost race, never a refusal.
      await waitFor(
        () =>
          ledger(id).some(
            (event) =>
              (event.type === 'message_queued' || event.type === 'user_turn') &&
              event.text === 'and again',
          ),
        'the words to go in',
      )
      await letItSettle()
      expect(launches.length - before, 'a provider was started for a running conversation').toBe(0)
      expect(listed(id).running, 'the live conversation was stopped').toBe('in-a-window')
    })

    it('⛔ another window’s conversation: this door neither starts nor sends to it', async () => {
      const id = await aConversationTheQuitStopped()
      await host.startAndSend(id, 'mine', window)
      await waitFor(() => answered(id, 'mine'), 'the owner’s first message')
      const stranger = new AWindow('webContents:9')
      const before = launches.length

      const refused = notSentOf(await host.startAndSend(id, 'not yours', stranger))

      expect(refused).toEqual({
        refusedBy: 'held-elsewhere',
        said: HELD_ELSEWHERE,
        launch: null,
        running: null,
      })
      await letItSettle()
      expect(launches.length - before).toBe(0)
      expect(turnsOf(id)).not.toContain('not yours')
      expect(listed(id).running).toBe('in-a-window')
    })

    it('⚑ the window is asked FIRST — another window’s conversation with a moved file is told it is held elsewhere, not about the file', async () => {
      const id = await aConversationThisWindowRuns()
      const notes = attached('notes.md')
      rmSync(notes.path)

      const refused = notSentOf(
        await host.startAndSend(id, 'look', new AWindow('webContents:9'), [notes]),
      )

      expect(refused.refusedBy).toBe('held-elsewhere')
      // ⚑ **The control, one fact over**: the window that runs it is told about the file.
      const own = notSentOf(await host.startAndSend(id, 'look', window, [notes]))
      expect(own.refusedBy).toBe('before-the-start')
      expect(own.said).toMatch(/moved or deleted/)
    })

    it('⛔ a person’s Close that lands while the attachment is read is seen — and a message still continues it', async () => {
      // ⚑ **D-017 · R1/R2 — a Close is a STOP, not an ending**, and ⚑ **D-017b** — a message from its
      // view continues it whatever its process is doing: the door's ask inside the arrivals sees the
      // stop, and the words go — one start, this door's.
      const id = await aConversationThisWindowRuns()
      const notes = attached('notes.md')
      const before = launches.length
      const answering = host.startAndSend(id, 'hello', window, [notes])
      // ⚑ The door is suspended in the disk read; the person's Close lands there.
      await host.close(id, window)
      expect(listed(id).running, 'the premise: the Close stopped it').toBe('not-running')

      const answer = await answering

      expect('sent' in answer, JSON.stringify(answer)).toBe(true)
      expect(launches.length - before).toBe(1)
      expect(launches.at(-1)?.kind).toBe('resume')
      await waitFor(() => answered(id, 'hello'), 'the first message to be answered')
      expect(listed(id).running).toBe('in-a-window')
    })

    it('⛔ a start another window makes while the attachment is read is seen — not raced', async () => {
      const id = await aConversationTheQuitStopped()
      gate = new FakeLaunchGate()
      host = buildHost()
      const notes = attached('notes.md')
      const before = launches.length
      const answering = host.startAndSend(id, 'hello', window, [notes])
      // ⚑ Another window's Reopen — the wire's `resume` door — starts it, and is held inside its
      // launch, during the read.
      const other = new AWindow('webContents:8')
      const theirs = host.reopenForAPerson(id, other, null)
      await waitFor(() => (gate?.held ?? 0) > 0, 'their start to be inside its launch')
      gate.release()
      await theirs

      const refused = notSentOf(await answering)

      // ⚑ **D-017b** — the message joins the start in flight, and once it lands the conversation is
      // theirs: the person reads the held-elsewhere sentence and nothing is sent. ⚠️ Measured: the
      // join path answers it under `the-start` (the refused start's own word), not `held-elsewhere`
      // — the window draws only the sentence, so the two read the same (reported, not pinned).
      expect(['held-elsewhere', 'the-start']).toContain(refused.refusedBy)
      expect(refused.said).toBe(HELD_ELSEWHERE)
      expect(refused.running).toBeNull()
      expect(launches.length - before, 'one start: theirs').toBe(1)
      expect(turnsOf(id)).not.toContain('hello')
      expect(listed(id).running).toBe('in-a-window')
    })

    it('⚑ a conversation a person CLOSED is continued by its next message all the same', async () => {
      // ⚑ **D-017 · R1 — any conversation a message can start, however it stopped.**
      const id = await aConversationThisWindowRuns()
      await host.close(id, window)
      expect(listed(id).running, 'the premise: the Close stopped it').toBe('not-running')
      const before = launches.length
      const answer = await host.startAndSend(id, 'hello?', window)
      expect('sent' in answer && answer.sent.sessionId, JSON.stringify(answer)).toBe(id)
      expect(launches.length - before).toBe(1)
      await waitFor(() => answered(id, 'hello?'), 'the first message to be answered')
    })
  })

  // ───────────────────────────────────────────────────────────────────────────────────────────
  // §5 · the start refused
  // ───────────────────────────────────────────────────────────────────────────────────────────

  describe('§5 · a start that is refused sends nothing', () => {
    it('⚑ a failure of this attempt — nothing runs it, the words not sent', async () => {
      const id = await aConversationTheQuitStopped()
      const ref = store.find(id)?.ref
      if (ref === undefined) throw new Error('no ref')
      LaunchCountingRuntime.nextResumeThrows = new ResumeError(
        ref,
        'resume failed: the handshake died',
        {
          cause: new Error('the handshake died'),
        },
      )

      const refused = notSentOf(await host.startAndSend(id, 'are you there', window))

      expect(refused.refusedBy).toBe('the-start')
      expect(refused.running).toBeNull()
      expect(listed(id)).toEqual(NOTHING_RUNS_IT)
      expect(turnsOf(id)).not.toContain('are you there')
    })

    it('⚑ a provider that no longer has it — D-017 · R10: replaced, and the words go to the one in its place', async () => {
      const id = await aConversationTheQuitStopped()
      const ref = store.find(id)?.ref
      if (ref === undefined) throw new Error('no ref')
      LaunchCountingRuntime.nextResumeThrows = new ResumeError(ref, 'no such conversation', {
        noSuchSession: true,
      })

      const answer = await host.startAndSend(id, 'are you there', window)

      // ⚑ **R10 — a conversation that can never be reopened is replaced**, owned by the writing
      // window, and the first message is the new one's first turn — never refused, never lost.
      if (!('sent' in answer)) throw new Error(`not sent: ${JSON.stringify(answer)}`)
      const next = answer.sent.sessionId
      expect(next).not.toBe(id)
      expect(ledger(id)).toContainEqual({ type: 'replaced_by', sessionId: next })
      expect(ledger(next)).toContainEqual({ type: 'replaces', sessionId: id })
      expect(turnsOf(id)).not.toContain('are you there')
      await waitFor(() => turnsOf(next).includes('are you there'), 'the words in its place')
    })
  })

  // ───────────────────────────────────────────────────────────────────────────────────────────
  // §6 · the window's door
  // ───────────────────────────────────────────────────────────────────────────────────────────

  describe('§6 · the wire carries it, and a refusal comes back as an ANSWER', () => {
    it('⚑ `startAndSend` through `executeRuntimeCommand`: a refusal is answered, not thrown', async () => {
      const id = await aConversationTheQuitStopped()
      const notes = attached('notes.md')
      rmSync(notes.path)
      const answer = (await executeRuntimeCommand(host, window, {
        kind: 'startAndSend',
        sessionId: id,
        text: 'look',
        attachments: [notes],
      })) as FirstMessageAnswer
      expect(notSentOf(answer).refusedBy).toBe('before-the-start')
    })

    it('⚑ the launch key reaches the start — the pane’s Cancel stops it, and nothing is left running', async () => {
      const id = await aConversationTheQuitStopped()
      gate = new FakeLaunchGate()
      host = buildHost()
      const answering = executeRuntimeCommand(host, window, {
        kind: 'startAndSend',
        sessionId: id,
        text: 'hello',
        launchKey: 'pane:1',
      }) as Promise<FirstMessageAnswer>
      await waitFor(() => (gate?.held ?? 0) > 0, 'the start to be inside its launch')

      // ⛔ **The cancel FOUND the launch** — otherwise a dropped key reads as a stalled start.
      expect(
        await executeRuntimeCommand(host, window, { kind: 'cancelLaunch', launchKey: 'pane:1' }),
      ).toBe(true)

      const refused = notSentOf(await answering)
      expect(refused.refusedBy).toBe('the-start')
      expect(refused.launch).toBe('cancelled')
      expect(refused.running).toBeNull()
      expect(listed(id)).toEqual(NOTHING_RUNS_IT)
    })

    it('⛔ blank words are refused by the wire, as every send’s are', async () => {
      await expect(
        executeRuntimeCommand(host, window, {
          kind: 'startAndSend',
          sessionId: 'sess_1',
          text: ' ',
        }),
      ).rejects.toThrow(NOTHING_TO_SEND)
    })
  })

  // ⚑ **D-017b** — §7 pinned the store's put-back of the quit's stamp (`theQuitsStampPutBack`), which
  // went with the kept-open fact: nothing puts a stamp back, because nothing reads one per row.
})
