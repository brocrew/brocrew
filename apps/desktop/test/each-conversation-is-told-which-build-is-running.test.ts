import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { FakeProviderSessions, FakeRuntime } from '@brobot2/runtime'
import type { FakeSessionHandle, ResumeOptions, SessionRef, StartOptions } from '@brobot2/runtime'
import { BUILD_IS_DEV, BUILD_IS_UNRECORDED, type Provider } from '@brobot2/shared'
import { NO_DISCOVERY } from '../src/main/adopt/discover-sessions'
import { buildIdentity } from '../src/main/build-identity'
import { type AppDatabase, openDatabase } from '../src/main/db/connection'
import { applyMigrations } from '../src/main/db/migrate'
import { createSessionStore, type SessionStore } from '../src/main/db/session-store'
import {
  profileBundleSpans,
  theBuildRunningSaid,
  thisConversationSpans,
  type InstructionContext,
  type TheBuildRunning,
} from '../src/main/runtime/factory-text'
import { readSessionInstructions } from '../src/main/runtime/instructions'
import { publishProfileBundle } from '../src/main/runtime/profile-bundle'
import { RuntimeHost, type RuntimeEventSink } from '../src/main/runtime/runtime-host'
import { resolveSessionCwd } from '../src/main/runtime/scratch-cwd'
import type { RuntimeEventMessage } from '../src/shared/runtime-ipc'

/**
 * F006 · each conversation is told which build of the app is running (`e59ef72c`, `b337beed`).
 *
 * Every launch's "This conversation" lines now carry one line saying which build is running, worded
 * as the window's build chip and its hover say it, read through `RuntimeHostDeps.whichBuild`. A
 * read that throws costs the line and never the launch. No test read the line, the four kinds of
 * build it tells apart, or the host's half.
 *
 *  - §1 `theBuildRunningSaid`: a stamped build, the same with uncommitted changes, a development
 *    build, a build that recorded no commit (two ways), and a schema that could not be read. Then
 *    the same through `buildIdentity()`, the reader `main/index.ts` hands it.
 *  - §2 the host: the line rides the words a Claude launch is handed, read again at every launch
 *    (a fresh start and a reopen after a restart); a `whichBuild` that throws, and a host wired with
 *    none, launch all the same and say no build at all.
 *  - §3 the composition root: `main/index.ts` is the Electron entry and no test imports it, so the
 *    line that wires `whichBuild` is a source census with its control.
 *
 * Only the provider is a double. No Electron, no port, no userData but a temporary one.
 */

const here = dirname(fileURLToPath(import.meta.url))
const migrationsFolder = join(here, '../src/main/db/migrations')
const SRC = join(here, '../src')

const SHA = 'e76e7c6aaaabbbbccccddddeeeeffff000011112'
const STAMPED: TheBuildRunning = { id: 'e76e7c6', commit: SHA, dirty: false, schema: 7 }

/** The three openings a build line can have — one of them is in every launch that read a build. */
const ANY_BUILD_LINE =
  /^- This app(?: is build `|’s build did not record|'s build did not record| is a development build)/m

// ─────────────────────────────────────────────────────────────────────────────────────────────
// §1 · the line, per build kind
// ─────────────────────────────────────────────────────────────────────────────────────────────

describe('F006 · §1 · the line says which kind of build is running', () => {
  it('a stamped build names its id and its commit, and says uncommitted changes only when there were some', () => {
    const clean = theBuildRunningSaid(STAMPED)
    expect(clean).toBe(
      `- This app is build \`e76e7c6\`, built from commit \`${SHA}\`. Its database schema is 7.`,
    )
    expect(clean).not.toContain('uncommitted')

    const dirty = theBuildRunningSaid({ ...STAMPED, dirty: true })
    expect(dirty).toBe(
      `- This app is build \`e76e7c6\`, built from commit \`${SHA}\` with uncommitted changes, so what runs is not exactly that commit. Its database schema is 7.`,
    )
    // ⚠️ b337beed: a conversation may have no window, so the line makes no claim about one.
    for (const said of [clean, dirty]) expect(said).not.toContain('title bar')
  })

  it('a development build names no commit and says what its main process runs — whatever commit it carries', () => {
    const DEV_LINE = `- This app is a development build (\`${BUILD_IS_DEV}\`), run from a working tree, so no commit describes it; its main process runs the code as it was when the app started. Its database schema is 7.`
    // As the stamp writes a dev build: no commit at all.
    const dev = theBuildRunningSaid({ id: BUILD_IS_DEV, commit: '', dirty: false, schema: 7 })
    expect(dev).toBe(DEV_LINE)
    // ⛔ It is not a build that failed to record one: the dev arm is asked before the empty commit.
    expect(dev).not.toContain('did not record')
    // ⚠️ b337beed: its window hot-reloads, its main process does not; never "rebuilt as saved".
    expect(dev).not.toContain('rebuilt as its code is saved')
    // A dev id carrying a commit and a dirty flag is still said as a dev build, and the commit is not.
    const devWithACommit = theBuildRunningSaid({
      id: BUILD_IS_DEV,
      commit: SHA,
      dirty: true,
      schema: 7,
    })
    expect(devWithACommit).toBe(DEV_LINE)
    expect(devWithACommit).not.toContain(SHA)
  })

  it('a build that recorded no commit says so, by its word or by a commit it lacks', () => {
    const unrecorded = theBuildRunningSaid({
      id: BUILD_IS_UNRECORDED,
      commit: '',
      dirty: false,
      schema: 7,
    })
    expect(unrecorded).toBe(
      `- This app's build did not record a commit (\`${BUILD_IS_UNRECORDED}\`). Its database schema is 7.`,
    )
    // A half-stamp — an id and no commit (`build-identity.test.ts`'s case) — is no commit either,
    // and the line never says "built from commit ``".
    const halfStamp = theBuildRunningSaid({ id: 'e76e7c6', commit: '', dirty: false, schema: 7 })
    expect(halfStamp).toBe(
      "- This app's build did not record a commit (`e76e7c6`). Its database schema is 7.",
    )
    expect(halfStamp).not.toContain('built from commit')
    // The word alone is enough, whatever else the record carries.
    const theWord = theBuildRunningSaid({
      id: BUILD_IS_UNRECORDED,
      commit: SHA,
      dirty: false,
      schema: 7,
    })
    expect(theWord).toContain('did not record a commit')
    expect(theWord).not.toContain(SHA)
  })

  it('a schema that could not be read is left out, and nothing else of the line moves', () => {
    for (const build of [
      STAMPED,
      { ...STAMPED, dirty: true },
      { id: BUILD_IS_DEV, commit: '', dirty: false, schema: 7 },
      { id: BUILD_IS_UNRECORDED, commit: '', dirty: false, schema: 7 },
    ]) {
      const withIt = theBuildRunningSaid(build)
      const without = theBuildRunningSaid({ ...build, schema: null })
      expect(withIt.endsWith(' Its database schema is 7.')).toBe(true)
      expect(without).not.toContain('schema')
      expect(`${without} Its database schema is 7.`).toBe(withIt)
    }
    // Zero is a schema, not "no schema".
    expect(theBuildRunningSaid({ ...STAMPED, schema: 0 })).toContain('Its database schema is 0.')
  })

  describe('through buildIdentity(), the reader main/index.ts hands the host', () => {
    const globals = globalThis as Record<string, unknown>
    afterEach(() => {
      delete globals.__BUILD_ID__
      delete globals.__BUILD_COMMIT__
      delete globals.__BUILD_DIRTY__
    })

    it('an unstamped bundle says it recorded no commit, and a stamped one names it', () => {
      const unstamped = theBuildRunningSaid({ ...buildIdentity(), schema: 3 })
      expect(unstamped).toBe(
        `- This app's build did not record a commit (\`${BUILD_IS_UNRECORDED}\`). Its database schema is 3.`,
      )

      globals.__BUILD_ID__ = 'e76e7c6'
      globals.__BUILD_COMMIT__ = SHA
      globals.__BUILD_DIRTY__ = true
      const stamped = theBuildRunningSaid({ ...buildIdentity(), schema: 3 })
      expect(stamped).toBe(
        `- This app is build \`e76e7c6\`, built from commit \`${SHA}\` with uncommitted changes, so what runs is not exactly that commit. Its database schema is 3.`,
      )
    })
  })
})

// ─────────────────────────────────────────────────────────────────────────────────────────────
// §2 · the host tells each launch
// ─────────────────────────────────────────────────────────────────────────────────────────────

/** Every provider launch the host made, in order, so a test reads what each was handed. */
class LaunchWatchingRuntime extends FakeRuntime {
  constructor(
    provider: Provider,
    private readonly launches: FakeSessionHandle[],
    sessions: FakeProviderSessions,
  ) {
    super(provider, { sessions })
  }
  override async start(options: StartOptions): ReturnType<FakeRuntime['start']> {
    const handle = await super.start(options)
    this.launches.push(handle)
    return handle
  }
  override async resume(
    ref: SessionRef,
    options: ResumeOptions,
  ): ReturnType<FakeRuntime['resume']> {
    const handle = await super.resume(ref, options)
    this.launches.push(handle)
    return handle
  }
}

class Sink implements RuntimeEventSink {
  readonly aPersonIsBehindIt = true
  readonly messages: RuntimeEventMessage[] = []
  alive = true
  constructor(readonly ownerId: string) {}
  send(message: RuntimeEventMessage): void {
    this.messages.push(message)
  }
  sendLiveness(): void {}
}

describe('F006 · §2 · each launch is told the build, and a build it cannot read costs only the line', () => {
  let userData: string
  let root: string
  let db: AppDatabase
  let store: SessionStore
  let host: RuntimeHost
  let hosts: RuntimeHost[]
  let launches: FakeSessionHandle[]
  let seen: InstructionContext[]
  let issued: FakeProviderSessions
  let counter: number
  let clock: number
  let window: Sink
  /** What `whichBuild` answers now: a build, or a read that throws. */
  let theBuild: TheBuildRunning | Error
  let asked: number
  const tick = (): number => clock++

  const buildHost = (wired: { whichBuild: boolean } = { whichBuild: true }): RuntimeHost => {
    const built = new RuntimeHost({
      store,
      discoverSessions: NO_DISCOVERY,
      nativeTranscriptPath: () => null,
      exportDirectory: () => join(userData, 'exports'),
      createRuntime: (provider: Provider) => new LaunchWatchingRuntime(provider, launches, issued),
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
      ...(wired.whichBuild
        ? {
            whichBuild: (): TheBuildRunning => {
              asked += 1
              if (theBuild instanceof Error) throw theBuild
              return theBuild
            },
          }
        : {}),
      // ⚑ **A copy of `main/index.ts`'s call**: the profile's text is published, this conversation's
      // own text rides the launch. `home` is a temporary one, so no person's own files are read.
      readInstructions: (provider, cwd, providerHome, ctx) => {
        seen.push(ctx)
        const composed = profileBundleSpans(ctx)
        const bundle = publishProfileBundle(provider, providerHome, composed.text)
        const read = readSessionInstructions({
          provider,
          cwd,
          providerHome,
          home: join(userData, 'home'),
          bundle,
          bundleComposed: composed,
          thisConversation: thisConversationSpans(ctx),
        })
        return {
          instructions: read.instructions,
          systemHint: read.systemHint ?? undefined,
          ...(read.firstTurnLead === null ? {} : { firstTurnLead: read.firstTurnLead }),
          memoryLoaded: null,
        }
      },
    })
    hosts.push(built)
    return built
  }

  beforeEach(() => {
    userData = mkdtempSync(join(tmpdir(), 'brobot2-f006-'))
    root = mkdtempSync(join(tmpdir(), 'brobot2-f006-root-'))
    mkdirSync(join(userData, 'home'), { recursive: true })
    db = openDatabase(join(userData, 'brobot2.sqlite'))
    applyMigrations(db, migrationsFolder)
    clock = Date.UTC(2030, 0, 1)
    store = createSessionStore(db, tick)
    counter = 0
    hosts = []
    launches = []
    seen = []
    issued = new FakeProviderSessions()
    theBuild = STAMPED
    asked = 0
    host = buildHost()
    window = new Sink('webContents:1')
  })

  afterEach(async () => {
    vi.restoreAllMocks()
    for (const built of hosts) await built.closeAll()
    db.close()
    for (const dir of [userData, root]) rmSync(dir, { recursive: true, force: true })
  })

  const personOpens = async (profileId: string): Promise<string> => {
    const { sessionId } = await host.createSession(
      { provider: 'claude', profileId, approvalMode: 'ask', cwd: root },
      window,
    )
    return sessionId
  }

  /** What the last Claude launch was told in its system prompt. */
  const toldLast = (): string => {
    const handle = launches.at(-1)
    if (handle === undefined) throw new Error('nothing was launched')
    return handle.systemHint ?? ''
  }

  const lastContext = (): InstructionContext => {
    const ctx = seen.at(-1)
    if (ctx === undefined) throw new Error('the reader was never called')
    return ctx
  }

  /** The quit a person's ⌘Q is, and the next launch over the same ledger. */
  const quitAndRelaunch = async (): Promise<void> => {
    for (const built of hosts) await built.closeAll()
    store = createSessionStore(db, tick)
    host = buildHost()
    seen = []
  }

  it('a launch keeps the build fact for the host, without appending it to the model text', async () => {
    await personOpens('ali')
    expect(asked).toBeGreaterThan(0)
    expect(lastContext().build).toEqual(STAMPED)
    const told = toldLast()
    // ⚑ Presence first: this conversation's own section was sent, so what it carries is a reading.
    expect(told).toContain('## This conversation')
    expect(told).toContain(
      `- Your working directory is \`${lastContext().cwd}\`.\n` +
        '- This folder persists: files you leave here are still here in later conversations.\n' +
        '- Ask when something is destructive or ambiguous.',
    )
    expect(told).not.toMatch(ANY_BUILD_LINE)
    // Not into the profile's file, which every conversation of the profile shares.
    const file = profileBundleSpans(lastContext()).text
    expect(file).not.toMatch(ANY_BUILD_LINE)
  })

  it('reads the build at every launch: a later launch, and a reopen after a restart onto another build, are told the build then running', async () => {
    const first = await personOpens('ali')
    expect(toldLast()).not.toContain(theBuildRunningSaid(STAMPED))

    // A development build, for the next launch in the same run.
    const DEV: TheBuildRunning = { id: BUILD_IS_DEV, commit: '', dirty: false, schema: 7 }
    theBuild = DEV
    await personOpens('ali')
    expect(lastContext().build).toEqual(DEV)
    expect(toldLast()).not.toContain(theBuildRunningSaid(DEV))
    expect(toldLast()).not.toContain(theBuildRunningSaid(STAMPED))

    // The app restarts onto a newer commit with uncommitted changes, and the first is reopened.
    const NEWER: TheBuildRunning = {
      id: 'f00dbab',
      commit: 'f00dbab0000111122223333444455556666777788',
      dirty: true,
      schema: 8,
    }
    theBuild = NEWER
    await quitAndRelaunch()
    await host.resumeSession(first, window)
    expect(lastContext().build).toEqual(NEWER)
    expect(toldLast()).not.toContain(theBuildRunningSaid(NEWER))
    expect(toldLast()).not.toContain(theBuildRunningSaid(STAMPED))
  })

  it('a whichBuild that throws costs the line and never the launch — and the next launch it answers is told again', async () => {
    const warned = vi.spyOn(console, 'warn').mockImplementation(() => {})
    theBuild = new Error('the stamp is gone')
    const id = await personOpens('ali')
    // The launch went ahead: a conversation, a provider handle, and its own section sent.
    expect(store.find(id)).not.toBeNull()
    expect(launches).toHaveLength(1)
    expect(asked).toBeGreaterThan(0)
    expect(lastContext().build).toBeNull()
    const told = toldLast()
    expect(told).toContain('## This conversation')
    expect(told).toContain(`- Your working directory is \`${lastContext().cwd}\`.`)
    expect(told).not.toMatch(ANY_BUILD_LINE)
    expect(told).not.toContain('database schema')
    // …and the failure is said where a developer reads it.
    expect(
      warned.mock.calls.some((call) =>
        String(call[0]).includes('could not read which build is running: the stamp is gone'),
      ),
    ).toBe(true)

    // The paired positive, same host, one fact over: the read answers, and the line is back.
    theBuild = STAMPED
    await personOpens('ali')
    expect(toldLast()).not.toContain(theBuildRunningSaid(STAMPED))
  })

  it('a host wired with no whichBuild tells nobody a build, and launches all the same', async () => {
    for (const built of hosts) await built.closeAll()
    host = buildHost({ whichBuild: false })
    const id = await personOpens('ali')
    expect(store.find(id)).not.toBeNull()
    expect(asked).toBe(0)
    expect(lastContext().build).toBeNull()
    expect(toldLast()).toContain('## This conversation')
    expect(toldLast()).not.toMatch(ANY_BUILD_LINE)
  })
})

// ─────────────────────────────────────────────────────────────────────────────────────────────
// §3 · the composition root
// ─────────────────────────────────────────────────────────────────────────────────────────────

/** Comments stripped first — a docblock quoting a call is not a call. */
function code(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1')
}

const squashed = (text: string): string => text.replace(/\s+/g, ' ').trim()

/** ⚑ The one line of `main/index.ts` this section is about: the host reads the stamp and the count. */
function wiresWhichBuildToTheStampAndTheCount(source: string): boolean {
  const stripped = squashed(code(source))
  return (
    stripped.includes(
      'whichBuild: () => ({ ...buildIdentity(), schema: migrationsAppliedOrNull() })',
    ) && stripped.split('whichBuild:').length - 1 === 1
  )
}

describe('F006 · §3 · the composition root wires whichBuild to the stamp and the migration count', () => {
  const source = readFileSync(join(SRC, 'main/index.ts'), 'utf8')

  it('hands the host the build stamp and the count of applied migrations', () => {
    expect(wiresWhichBuildToTheStampAndTheCount(source)).toBe(true)
  })

  it('a planted copy that wires nothing, or reads the schema as a constant, fails the same predicate', () => {
    const none = source.replace(
      /\n\s*whichBuild: \(\) => \(\{ \.\.\.buildIdentity\(\), schema: migrationsAppliedOrNull\(\) \}\),/,
      '',
    )
    expect(none).not.toBe(source)
    expect(wiresWhichBuildToTheStampAndTheCount(none)).toBe(false)

    const constant = source.replace('schema: migrationsAppliedOrNull() })', 'schema: 0 })')
    expect(constant).not.toBe(source)
    expect(wiresWhichBuildToTheStampAndTheCount(constant)).toBe(false)

    // The control for the control: the untouched source still passes.
    expect(wiresWhichBuildToTheStampAndTheCount(source)).toBe(true)
  })
})
