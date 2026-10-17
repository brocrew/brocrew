import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  AuthUnavailableError,
  FakeProviderSessions,
  type FakeSessionHandle,
} from '@brobot2/runtime'
import type { Provider } from '@brobot2/shared'
import { type AppDatabase, openDatabase } from '../src/main/db/connection'
import { applyMigrations } from '../src/main/db/migrate'
import { createSessionStore as createLedger } from '../src/main/db/session-store'
import { NO_DISCOVERY } from '../src/main/adopt/discover-sessions'
import { RuntimeHost, type RuntimeEventSink } from '../src/main/runtime/runtime-host'
import { executeRuntimeCommand } from '../src/main/runtime/ipc'
import { resolveSessionCwd } from '../src/main/runtime/scratch-cwd'
import {
  createSessionStore,
  type SessionStore as RendererStore,
} from '../src/renderer/src/lib/session-store'
import {
  LAUNCH_REFUSALS,
  type CreateSessionInput,
  type LaunchRefusal,
  type RuntimeBridge,
  type RuntimeCommand,
  type RuntimeEventMessage,
} from '../src/shared/runtime-ipc'
import { ProviderDouble, anOpenGate, type ResumeGate } from './lib/provider-double'
import { everythingOverTheWire } from './lib/the-wire'

/**
 * # 🔴 725 draw 7 · `716` F-1 — a refusal that said why is not asked about again: the store and the screen
 *
 * ⚑ **The finding** (`716` §9, F-1): *"The launcher can now skip its sign-in check, by sending
 * `answerARefusal: true` and reading `refused.reason`."* ⚑ **Main's own table** (`LAUNCH_REFUSALS`,
 * `runtime-ipc.ts`): for `sign-in` the check is *"the remedy — its buttons are how a person fixes
 * it"*; for `program`, `folder`, `machine` and `launch` it *"says nothing the refusal did not"*; and
 * a failure with no word keeps it as *"the only diagnosis there is"*. ⛔ The defect it ends is `710`
 * F-7's two boxes: a start the machine ran short for drew the refusal AND *"Could not check this
 * profile’s sign-in"* with the same shortage — one fact, said twice.
 *
 *  - **§1 · the store** (`session-store.ts` `create` / `forLaunch`), over a bridge that answers the
 *    way MAIN does (`ipc.ts`: a worded refusal is an ANSWER only to a caller that asked, and a
 *    rejection otherwise), through the wire's clone:
 *     - 🔴 the start ASKS (`answerARefusal: true`), and keeps each word beside the launcher's
 *       sentence — the sentence itself byte for byte what a rejection carried;
 *     - 🔴 `cancelled` is a Cancel, even with no Cancel marked in this window;
 *     - 🔴 a word from an earlier start is gone the moment the next start, or a reopen, is asked;
 *     - ⚑ controls that hold on `main`: a refusal with no word; a Cancel pressed here; a superseded
 *       start; the sheet's refusal, which is the sheet's and carries no word to the launcher.
 *  - **§2 · the screen** — `RuntimeScreen` is mounted by no test, so the hop from the store to the
 *    launcher is read where it is written, as `718` pinned the sheet's tag.
 *  - **§3 · the real wire** — the renderer's store over main's own `executeRuntimeCommand` and a real
 *    `RuntimeHost` (`host-renderer-agreement.test.ts`' shape): main's zod takes the ask, and the word
 *    main's own classifier chose is the one the store keeps.
 *
 * ⚠️ **The drawn half — the check skipped, the panel gone — is the DOM file's**
 * (`a-refusal-that-said-why-is-not-asked-again.dom.test.ts`), with `theCheckCanSayMore` over every
 * word: this project cannot import a `.vue` file without the `.render` suffix.
 *
 * ⚠️ **The word is read through {@link wordOf}**, tolerant of a store that has no such ref, so on
 * `main` the controls run and pass — and each subject fails on the missing word, not on a throw.
 */

const here = dirname(fileURLToPath(import.meta.url))
const migrationsFolder = join(here, '../src/main/db/migrations')
const RENDERER = join(here, '../src/renderer/src')

/** ⚑ The launcher's word — `null` on a store without the ref, which is `main`'s. */
const wordOf = (store: RendererStore): LaunchRefusal | null =>
  (store as Partial<Pick<RendererStore, 'launchRefusal'>>).launchRefusal?.value ?? null

/**
 * ⚑ **What main SAYS for each word, spelled here** — `session-unavailable.ts`'s sentences where the
 * word has one, and a plain sentence where the adapter's own words ride. ⛔ Keyed by the whole
 * union, so a seventh word in main's table is a compile error here until it has a sentence.
 */
const SAID: Readonly<Record<LaunchRefusal, string>> = {
  'sign-in':
    'Claude is not signed in on this profile. Sign in, or copy your machine sign-in, then start it again.',
  program: 'Codex isn’t available on this machine, so this conversation did not open.',
  folder: 'This conversation did not open: BroBot2 could not make its folder.',
  machine:
    'This conversation did not open: this machine ran short of open files, processes or memory as its agent was starting. Close an app or a conversation you are not using, then start it again.',
  cancelled:
    'This conversation was stopped before it opened. Start it again whenever you are ready.',
  launch:
    "This conversation's agent did not answer within 15s, so BroBot2 stopped waiting and shut it down. No conversation was made: start it again. If it keeps not answering, its provider is not responding on this machine.",
}

/** ⚑ How Electron hands a rejected `invoke` to the renderer — the wrapper `readableError` strips. */
const rejectedAsElectronDoes = (said: string): Error =>
  new Error(`Error invoking remote method 'runtime:command': Error: ${said}`)

/* ================================================================ §1 · the store */

type Launch = {
  readonly input: Record<string, unknown>
  readonly resolve: (answer: unknown) => void
  readonly reject: (cause: Error) => void
}

/**
 * ⚑ **A bridge that answers as main does** (`ipc.ts`, `executeRuntimeCommand`'s `createSession`
 * case): a worded refusal is RESOLVED as `{ refused: { reason, said } }` only when the payload asked
 * (`answerARefusal === true`), and REJECTED with the same sentence otherwise; a refusal with no
 * word is rejected either way. ⚑ Over the wire's clone, and the answer cloned too — `invoke` hands
 * the renderer a copy of what main returned.
 */
function aBridgeThatAnswersAsMainDoes() {
  const launches = new Map<string, Launch>()
  const asked: Record<string, unknown>[] = []
  const cancelled: string[] = []
  const reopens: string[] = []
  const bridge = {
    onEvent: () => () => {},
    onLiveness: () => () => {},
    attachOpen: () => Promise.resolve({ sessions: [] }),
    createSession: (input: Record<string, unknown>) =>
      new Promise((resolve, reject) => {
        asked.push(input)
        launches.set(input.launchKey as string, { input, resolve, reject })
      }),
    resume: (input: { sessionId: string }) =>
      new Promise(() => {
        reopens.push(input.sessionId)
      }),
    cancelLaunch: ({ launchKey }: { launchKey: string }) => {
      cancelled.push(launchKey)
      return Promise.resolve(true)
    },
  } as unknown as RuntimeBridge
  const launch = (index: number): Launch => {
    const found = [...launches.values()][index]
    if (found === undefined) throw new Error(`no launch #${String(index)} was asked for`)
    return found
  }
  return {
    bridge: everythingOverTheWire(bridge),
    asked,
    cancelled,
    reopens,
    /** ⚑ Main refuses launch #`index` with a word — answered or rejected, as the payload asked. */
    refuse(index: number, reason: LaunchRefusal): void {
      const one = launch(index)
      if (one.input.answerARefusal === true) {
        one.resolve(structuredClone({ refused: { reason, said: SAID[reason] } }))
      } else one.reject(rejectedAsElectronDoes(SAID[reason]))
    },
    /** ⚑ Main refuses launch #`index` with NO word — rejected, asked or not. */
    refuseUnworded(index: number, said: string): void {
      launch(index).reject(rejectedAsElectronDoes(said))
    },
  }
}

const INPUT: CreateSessionInput = { provider: 'codex', profileId: 'default', approvalMode: 'ask' }

describe('§1 · `716` F-1 — the store asks main why, and keeps the word beside the sentence', () => {
  /** 🔴 **RED on `main`**, whose store sent no `answerARefusal`: every refusal came back a rejection. */
  it('🔴 a start ASKS for the refusal’s word — the one flag, beside everything the launcher gave', () => {
    const wire = aBridgeThatAnswersAsMainDoes()
    const store = createSessionStore(wire.bridge)
    void store.create(INPUT)
    expect(wire.asked).toHaveLength(1)
    expect(wire.asked[0]).toMatchObject({ ...INPUT, answerARefusal: true })
    expect(typeof wire.asked[0]?.launchKey).toBe('string')
  })

  /**
   * 🔴 **The subject — RED on `main`**, which kept only the sentence: the launcher could not tell a
   * refusal that said why from one that did not. ⚑ Every word but `cancelled`, each with main's
   * sentence landing in `launchError` byte for byte.
   */
  it('🔴 each worded refusal lands as the launcher’s sentence AND its word — `sign-in` included', async () => {
    const worded = LAUNCH_REFUSALS.filter((word) => word !== 'cancelled')
    expect(worded).toEqual(['sign-in', 'program', 'folder', 'machine', 'launch'])
    for (const word of worded) {
      const wire = aBridgeThatAnswersAsMainDoes()
      const store = createSessionStore(wire.bridge)
      const heard: string[] = []
      const started = store.create(INPUT, 'front-door', (said) => heard.push(said))
      wire.refuse(0, word)
      expect(await started, word).toBeNull()
      expect(store.launchError.value, word).toBe(SAID[word])
      expect(wordOf(store), word).toBe(word)
      // ⚑ …and the caller that asked is told the same sentence, once.
      expect(heard, word).toEqual([SAID[word]])
      expect(store.isLaunching(), word).toBe(false)
    }
  })

  /** ⚑ **THE CONTROL — green on `main`**: a refusal main has no word for is still a rejection. */
  it('⚑ a refusal with NO word — rejected even though the start asked — is the sentence with no word', async () => {
    const wire = aBridgeThatAnswersAsMainDoes()
    const store = createSessionStore(wire.bridge)
    const started = store.create(INPUT)
    wire.refuseUnworded(0, 'providerHome ancestor passes through a symlink')
    expect(await started).toBeNull()
    expect(store.launchError.value).toBe('providerHome ancestor passes through a symlink')
    expect(wordOf(store)).toBeNull()
  })

  /**
   * 🔴 **`cancelled` is a Cancel — RED on `main`**, where only this window's own mark swallowed one
   * (`cancelled.has(key)`, which `cancelGesture` lifts when its ask fails or answers `false`): with
   * no mark standing, main's *stopped before it opened* was written as the launcher's sentence, under
   * a button that meant *stop* (`102`). ⚑ Here main's WORD says it, and the store reads the word
   * whether or not a mark stands. ⚠️ A measurement of the store's rule, not of a common path: on one
   * window the mark is nearly always there, which is the control below.
   */
  it('🔴 a start main answered `cancelled`, with no Cancel marked here, draws nothing and returns null', async () => {
    const wire = aBridgeThatAnswersAsMainDoes()
    const store = createSessionStore(wire.bridge)
    const heard: string[] = []
    const started = store.create(INPUT, 'front-door', (said) => heard.push(said))
    wire.refuse(0, 'cancelled')
    expect(await started).toBeNull()
    expect(store.launchError.value).toBeNull()
    expect(store.placedError.value).toBeNull()
    expect(wordOf(store)).toBeNull()
    expect(heard).toEqual([])
    expect(store.isLaunching()).toBe(false)
  })

  /** ⚑ **THE CONTROL — green on `main`**: the same answer to a Cancel pressed HERE, which `102` swallows. */
  it('⚑ the same `cancelled`, after a Cancel pressed here — swallowed, as it always was', async () => {
    const wire = aBridgeThatAnswersAsMainDoes()
    const store = createSessionStore(wire.bridge)
    const started = store.create(INPUT)
    expect(await store.cancelLaunch()).toBe(true)
    expect(wire.cancelled).toHaveLength(1)
    wire.refuse(0, 'cancelled')
    expect(await started).toBeNull()
    expect(store.launchError.value).toBeNull()
    expect(wordOf(store)).toBeNull()
  })

  /**
   * 🔴 **A word belongs to the start it answered** — cleared with the three error refs on every
   * attempt, or it would pair with a LATER start's word-less sentence and skip the check that
   * sentence needs. ⚠️ Red on `main` at its premise: `main` never holds a word to clear.
   */
  it('🔴 a word from an earlier start is gone the moment the next start is asked — and the moment a reopen is', async () => {
    const wire = aBridgeThatAnswersAsMainDoes()
    const store = createSessionStore(wire.bridge)
    const first = store.create(INPUT)
    wire.refuse(0, 'machine')
    await first
    expect(wordOf(store)).toBe('machine')

    // ⚑ The next start: cleared as it is ASKED — never beside its own spinner.
    const second = store.create(INPUT)
    expect(store.isLaunching()).toBe(true)
    expect(wordOf(store)).toBeNull()
    expect(store.launchError.value).toBeNull()
    // …and a refusal with no word leaves it clear: the check it needs is not skipped.
    wire.refuseUnworded(1, 'providerHome ancestor passes through a symlink')
    await second
    expect(store.launchError.value).toBe('providerHome ancestor passes through a symlink')
    expect(wordOf(store)).toBeNull()

    // ⚑ A reopen clears it too — it clears every launch error the window holds.
    const third = store.create(INPUT)
    wire.refuse(2, 'folder')
    await third
    expect(wordOf(store)).toBe('folder')
    void store.resume('sess_elsewhere')
    expect(wire.reopens).toEqual(['sess_elsewhere'])
    expect(wordOf(store)).toBeNull()
    expect(store.launchError.value).toBeNull()
  })

  /**
   * ⚑ **THE CONTROL — green on `main`**: a start another start under the launcher replaced writes
   * neither the launcher's sentence nor its word (`718`'s rule, `inFlight.get(gesture) === key`) —
   * its caller is still told.
   */
  it('⚑ a superseded start writes no word and no sentence — its own caller is still told', async () => {
    const wire = aBridgeThatAnswersAsMainDoes()
    const store = createSessionStore(wire.bridge)
    const heardByA: string[] = []
    const a = store.create(INPUT, 'front-door', (said) => heardByA.push(said))
    void store.create(INPUT)
    wire.refuse(0, 'machine')
    expect(await a).toBeNull()
    expect(heardByA).toEqual([SAID.machine])
    expect(store.isLaunching()).toBe(true)
    expect(store.launchError.value).toBeNull()
    expect(wordOf(store)).toBeNull()
  })

  /**
   * ⚑ **THE CONTROL — green on `main`**: the sheet's refusal is the SHEET's (`718`, `710` F-9). It
   * asks too — one opt-in at the one call — lands in `placedError`, reaches its own caller, and hands
   * the launcher no word: the sheet runs no sign-in check to skip.
   */
  it('⚑ a refusal from the SHEET lands in `placedError` and its caller, and gives the launcher no word', async () => {
    const wire = aBridgeThatAnswersAsMainDoes()
    const store = createSessionStore(wire.bridge)
    const heard: string[] = []
    const started = store.create(INPUT, 'sheet', (said) => heard.push(said))
    expect(store.isPlacing()).toBe(true)
    wire.refuse(0, 'machine')
    expect(await started).toBeNull()
    expect(store.placedError.value).toBe(SAID.machine)
    expect(heard).toEqual([SAID.machine])
    expect(store.launchError.value).toBeNull()
    expect(wordOf(store)).toBeNull()
  })
})

/* ================================================================ §2 · the screen */

describe('§2 · the screen hands the launcher the word — read where it is written', () => {
  const screen = readFileSync(join(RENDERER, 'components/RuntimeScreen.vue'), 'utf8')

  /** One component tag, from its opening line to its own `/>` line — `718`'s reading of the sheet's. */
  const tagOf = (opening: string, close: string): string => {
    const from = screen.indexOf(opening)
    expect(from, `no ${opening.trim()} in RuntimeScreen`).toBeGreaterThan(-1)
    expect(screen.indexOf(opening, from + 1), `a second ${opening.trim()}`).toBe(-1)
    const to = screen.indexOf(close, from)
    expect(to).toBeGreaterThan(from)
    return screen.slice(from, to)
  }

  /**
   * 🔴 **RED on `main`**, whose `<NewConversation>` was handed the sentence and nothing else — so
   * however the store kept the word, the launcher's check could not read it.
   */
  it('🔴 `<NewConversation>` is bound to `store.launchRefusal`, beside the sentence it pairs with', () => {
    const tag = tagOf('<NewConversation\n', '\n        />')
    expect(tag).toContain(':error="store.launchError.value"')
    expect(tag).toContain(':refused-as="store.launchRefusal.value"')
    expect(screen.split(':refused-as=')).toHaveLength(2)
  })

  /** ⚑ **The control**: the sheet's tag is handed its own sentence, and no word — it has no check. */
  it('⚑ `<StartAsAgent>` is handed its own sentence and no word', () => {
    const tag = tagOf('<StartAsAgent\n', '/>')
    expect(tag).toContain(':error="placedHere ? store.placedError.value : null"')
    expect(tag).not.toContain('refused-as')
  })
})

/* ================================================================ §3 · the real wire */

/** ⚑ A window a person is behind. */
class Seat implements RuntimeEventSink {
  readonly aPersonIsBehindIt = true
  readonly messages: RuntimeEventMessage[] = []
  alive = true
  constructor(readonly ownerId: string) {}
  send(message: RuntimeEventMessage): void {
    this.messages.push(message)
  }
  sendLiveness(): void {}
}

describe('§3 · the renderer’s store over main’s own dispatcher — the word main’s classifier chose', () => {
  let userData: string
  let root: string
  let db: AppDatabase
  let host: RuntimeHost
  let handles: FakeSessionHandle[]
  let gate: ResumeGate
  let counter: number
  /** ⚑ The HOST's own step failing — `prepareProviderHome`, which every launch runs (`716`'s rig). */
  let homeFails: (() => Error) | undefined
  let window: Seat

  beforeEach(() => {
    userData = mkdtempSync(join(tmpdir(), 'brobot2-725-refusal-'))
    root = mkdtempSync(join(tmpdir(), 'brobot2-725-refusal-root-'))
    db = openDatabase(join(userData, 'brobot2.sqlite'))
    applyMigrations(db, migrationsFolder)
    counter = 0
    handles = []
    gate = anOpenGate()
    homeFails = undefined
    const issued = new FakeProviderSessions()
    host = new RuntimeHost({
      store: createLedger(db),
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
    window = new Seat('webContents:1')
    // ⚑ Main logs every answered refusal whole (`716`); nothing here is about the log.
    vi.spyOn(console, 'warn').mockImplementation(() => {})
  })

  afterEach(async () => {
    vi.restoreAllMocks()
    await host.closeAll()
    db.close()
    for (const dir of [userData, root]) rmSync(dir, { recursive: true, force: true })
  })

  /** ⚑ The bridge over the REAL dispatcher — zod, the command union and the host method — and the wire. */
  const theWindowsStore = (): RendererStore => {
    const run = async <T>(command: RuntimeCommand): Promise<T> =>
      (await executeRuntimeCommand(host, window, command)) as T
    const bridge: Partial<RuntimeBridge> = {
      createSession: (input) => run({ kind: 'createSession', ...input }),
      attachOpen: () => run({ kind: 'attachOpen' }),
      onEvent: () => () => {},
      onLiveness: () => () => {},
    }
    return createSessionStore(everythingOverTheWire(bridge) as RuntimeBridge)
  }

  /** ⚑ What main says to a caller that did NOT ask — the sentence the launcher drew before `725`. */
  const theRejection = async (): Promise<string> => {
    const refusal = await executeRuntimeCommand(host, window, {
      kind: 'createSession',
      provider: 'claude',
      profileId: 'writer',
      approvalMode: 'auto',
      cwd: root,
    }).then(
      () => new Error('the start was not refused'),
      (error: unknown) => error as Error,
    )
    return refusal.message
  }

  /** ⚑ The start `716`'s main half is measured with — a profile, a mode and this run's folder. */
  const start = (): CreateSessionInput => ({
    provider: 'claude',
    profileId: 'writer',
    approvalMode: 'auto',
    cwd: root,
  })

  it.each([
    [
      'a machine that ran short',
      'machine',
      () => Object.assign(new Error('EMFILE: open'), { code: 'EMFILE', syscall: 'open' }),
    ],
    [
      'a sign-in main could not use',
      'sign-in',
      () => new AuthUnavailableError('claude', 'Claude machine login unavailable'),
    ],
  ] as const)(
    '🔴 %s: the launcher’s sentence is the rejection’s, byte for byte, and its word is `%s`',
    async (_what, word, fail) => {
      homeFails = fail
      const said = await theRejection()
      const store = theWindowsStore()
      expect(await store.create(start())).toBeNull()
      expect(store.launchError.value).toBe(said)
      expect(wordOf(store)).toBe(word)
    },
  )

  it('⚑ THE CONTROL — a refusal main cannot name is still a rejection: the sentence, and no word', async () => {
    homeFails = () => new Error('providerHome ancestor passes through a symlink')
    const store = theWindowsStore()
    expect(await store.create(start())).toBeNull()
    expect(store.launchError.value).toContain('passes through a symlink')
    expect(wordOf(store)).toBeNull()
  })

  it('⚑ THE CONTROL — a start that works opens, asked or not', async () => {
    const store = theWindowsStore()
    const sessionId = await store.create(start())
    expect(sessionId).toMatch(/^sess_/)
    expect(store.launchError.value).toBeNull()
    expect(wordOf(store)).toBeNull()
  })
})
