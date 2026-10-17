import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { FakeProviderSessions, FakeRuntime } from '@brobot2/runtime'
import type { Provider } from '@brobot2/shared'
import { type AppDatabase, openDatabase } from '../src/main/db/connection'
import { applyMigrations } from '../src/main/db/migrate'
import { createSessionStore, type SessionStore } from '../src/main/db/session-store'
import { NO_DISCOVERY } from '../src/main/adopt/discover-sessions'
import { RuntimeHost, type RuntimeEventSink } from '../src/main/runtime/runtime-host'
import { resolveSessionCwd } from '../src/main/runtime/scratch-cwd'
import { type FirstMessageAnswer, type HandedPath } from '../src/shared/runtime-ipc'

/**
 * # 🔴 735 M4 · the second ask, asked AGAIN after the disk read, must refuse on its own
 *
 * ⚑ **`startAndSend`'s own docstring**: *"whether another window has it open, asked before the
 * disk is read and AGAIN after (735 M4), so a window that opened it during that read is refused on
 * its own, never queued behind the arrivals to be told the same."* ⚑ **D-017b** — the word is
 * `held-elsewhere` now: another window has it open, and nothing is started.
 *
 * ⛔ **What this measures that `a-first-message-starts-it-in-one-act.test.ts`'s own race
 * (`a start another window makes while the attachment is read is seen — not raced`) does not.**
 * That test proves the race is SEEN — the answer is the same word either way, because a
 * THIRD ask sits a few lines further down, inside `startAndSend`'s own arrivals entry
 * (`afterWhatArrivedFirst`), and would catch the very same fact. ⚑ **The second ask's own reason
 * to exist, separate from the third, is WHERE it refuses**: before this call ever joins that
 * conversation's arrivals queue — so a loser of this race is answered on its own, and never sits
 * behind whatever else that queue is already carrying. ⛔ **Drop the second ask and the words are
 * still refused — but now only after whatever was already queued ahead of them finishes**, which
 * this band catches by putting something ahead of them on purpose and never letting it finish.
 *
 * ⚑ **Real host, real SQLite ledger.** The only doubles are the provider (`FakeRuntime`) and the
 * one thing no public door can hand it: an arrival already queued ahead of this conversation's,
 * held open by hand so a wait behind it cannot be mistaken for one that never happened.
 */

const here = dirname(fileURLToPath(import.meta.url))
const migrationsFolder = join(here, '../src/main/db/migrations')

class AWindow implements RuntimeEventSink {
  readonly aPersonIsBehindIt = true
  readonly messages: unknown[] = []
  alive = true
  constructor(readonly ownerId: string) {}
  send(): void {}
  sendLiveness(): void {}
}

describe('735 M4 · a race the second ask sees refuses without joining the arrivals queue', () => {
  let userData: string
  let root: string
  let db: AppDatabase
  let store: SessionStore
  let host: RuntimeHost
  let counter: number
  let clock: number
  let window: AWindow
  let issued: FakeProviderSessions
  const tick = (): number => clock++

  const buildHost = (): RuntimeHost =>
    new RuntimeHost({
      store,
      discoverSessions: NO_DISCOVERY,
      nativeTranscriptPath: () => null,
      exportDirectory: () => join(userData, 'exports'),
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
      readProviderConfig: (_provider, home) => ({
        home,
        homeEnv: 'CLAUDE_CONFIG_DIR',
        model: 'm',
        authNote: null,
        files: [],
      }),
    })

  beforeEach(() => {
    userData = mkdtempSync(join(tmpdir(), 'brobot2-735-m4-'))
    // ⚑ Real path: a handed attachment is refused when the path it names and the path it resolves
    // to differ, and macOS hands out `/var/…` for `/private/var/…`.
    root = realpathSync(mkdtempSync(join(tmpdir(), 'brobot2-735-m4-root-')))
    db = openDatabase(join(userData, 'brobot2.sqlite'))
    applyMigrations(db, migrationsFolder)
    clock = 9_000_000
    store = createSessionStore(db, tick)
    counter = 0
    issued = new FakeProviderSessions()
    host = buildHost()
    window = new AWindow('webContents:1')
  })

  afterEach(async () => {
    await host.closeAll()
    db.close()
    for (const dir of [userData, root]) rmSync(dir, { recursive: true, force: true })
  })

  const letItSettle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 60))

  const listed = (sessionId: string): { running: string } => {
    const row = host.resumableSessions().find((one) => one.sessionId === sessionId)
    if (row === undefined) throw new Error(`${sessionId} is not listed`)
    return { running: row.running }
  }

  /** ⚑ A person's conversation, open and idle when the person quit; the next launch has it kept open. */
  const aConversationTheQuitLeftOpen = async (): Promise<string> => {
    const { sessionId } = await host.createSession(
      { provider: 'claude', approvalMode: 'ask', cwd: root },
      window,
    )
    await host.closeAll()
    store = createSessionStore(db, tick)
    host = buildHost()
    window = new AWindow('webContents:2')
    expect(listed(sessionId).running, 'the premise: the quit left it open').toBe('not-running')
    return sessionId
  }

  /** ⚑ A file the person attached, as main classified it when they did. */
  const attached = (name: string): HandedPath => {
    const path = join(root, name)
    writeFileSync(path, 'the notes\n')
    return { path, kind: 'file', outsideCwd: false }
  }

  const notSentOf = (
    answer: FirstMessageAnswer,
  ): Extract<FirstMessageAnswer, { notSent: unknown }>['notSent'] => {
    if (!('notSent' in answer)) throw new Error(`it was sent: ${JSON.stringify(answer)}`)
    return answer.notSent
  }

  it('⛔ a start another window makes during the disk read refuses at once — never behind an arrival already ahead of it', async () => {
    const id = await aConversationTheQuitLeftOpen()
    const notes = attached('notes.md')

    // ⚑ **Something already ahead of this conversation's arrivals, on purpose, and held open by
    // hand.** Nothing but `startAndSend`'s own third ask (inside `afterWhatArrivedFirst`) would
    // ever wait on this; the second ask, done right, refuses before it is ever consulted.
    let releaseWhatWasAhead: () => void = () => {}
    const alreadyAhead = new Promise<void>((resolve) => {
      releaseWhatWasAhead = resolve
    })
    const arrivals = (host as unknown as { arrivals: Map<string, Promise<void>> }).arrivals
    arrivals.set(id, alreadyAhead)

    // ⚑ The door is suspended in the real disk read for `notes.md`.
    const answering = host.startAndSend(id, 'hello', window, [notes])
    // ⚑ Another window's Reopen reserves it while that read is still in flight — the same race
    // `a-first-message-starts-it-in-one-act.test.ts` races, just without a gate: nothing needs to
    // hold its launch open, only to win the reservation before the read comes back.
    const theirs = host.resumeSession(id, new AWindow('webContents:8'))
    await theirs

    let settled = false
    void answering.then(() => {
      settled = true
    })
    // ⚑ Give every microtask and timer its turn — WITHOUT ever releasing `alreadyAhead`. If the
    // second ask joined that queue instead of refusing on its own, `answering` is still pending
    // here, because only `alreadyAhead` resolving could ever wake it.
    await letItSettle()

    expect(
      settled,
      'the second ask must refuse this on its own, before it is queued behind anything else',
    ).toBe(true)

    const refused = notSentOf(await answering)
    // ⚑ **D-017b · `held-elsewhere`** — another window has it open, and nothing is started.
    expect(refused.refusedBy).toBe('held-elsewhere')

    releaseWhatWasAhead()
  })

  it('⚑ control — with nobody racing it, the same first message is answered, sent', async () => {
    const id = await aConversationTheQuitLeftOpen()
    const notes = attached('notes.md')
    const answer = await host.startAndSend(id, 'hello', window, [notes])
    expect('sent' in answer && answer.sent.sessionId, JSON.stringify(answer)).toBe(id)
  })
})
