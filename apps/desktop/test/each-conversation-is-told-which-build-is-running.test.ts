import { fixtureProviderConfig, neutralHostDeps, syntheticProviderHome } from './lib/host-fixture'
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { FakeProviderSessions, FakeRuntime } from '@brobot2/runtime'
import type { FakeSessionHandle, ResumeOptions, SessionRef, StartOptions } from '@brobot2/runtime'
import { BUILD_IS_DEV, type Provider } from '@brobot2/shared'
import { type AppDatabase, openDatabase } from '../src/main/db/connection'
import { applyMigrations } from '../src/main/db/migrate'
import { createSessionStore, type SessionStore } from '../src/main/db/session-store'
import {
  profileBundleSpans,
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
 * Each launch reads which build of the app is running, through `RuntimeHostDeps.whichBuild`, and
 * keeps it on the launch's context for the host without adding a build line to the model's text. A
 * read that throws, or a host wired with none, costs the build and never the launch.
 *
 * Only the provider is a double. No Electron, no port, no userData but a temporary one.
 */

const here = dirname(fileURLToPath(import.meta.url))
const migrationsFolder = join(here, '../src/main/db/migrations')

const SHA = 'e76e7c6aaaabbbbccccddddeeeeffff000011112'
const STAMPED: TheBuildRunning = { id: 'e76e7c6', commit: SHA, dirty: false, schema: 7 }

/** The three openings a build line can have — one of them is in every launch that read a build. */
const ANY_BUILD_LINE =
  /^- This app(?: is build `|’s build did not record|'s build did not record| is a development build)/m

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

describe('each launch reads the build, and a build it cannot read costs only the build', () => {
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
      ...neutralHostDeps(() => userData),
      createRuntime: (provider: Provider) => new LaunchWatchingRuntime(provider, launches, issued),
      prepareProviderHome: syntheticProviderHome(() => userData),
      providerHomePath: (provider: Provider) => join(userData, 'provider-homes', provider),
      resolveCwd: (sessionId, requested) => resolveSessionCwd(userData, sessionId, requested),
      newSessionId: () => `sess_${++counter}`,
      now: tick,
      readProviderConfig: fixtureProviderConfig,
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

  it('reads the build at every launch: a later launch, and a reopen after a restart onto another build, keep the build then running', async () => {
    const first = await personOpens('ali')
    expect(lastContext().build).toEqual(STAMPED)
    expect(toldLast()).not.toMatch(ANY_BUILD_LINE)

    // A development build, for the next launch in the same run.
    const DEV: TheBuildRunning = { id: BUILD_IS_DEV, commit: '', dirty: false, schema: 7 }
    theBuild = DEV
    await personOpens('ali')
    expect(lastContext().build).toEqual(DEV)
    expect(toldLast()).not.toMatch(ANY_BUILD_LINE)

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
    expect(toldLast()).not.toMatch(ANY_BUILD_LINE)
  })

  it('a whichBuild that throws costs the build and never the launch, and the next launch reads it again', async () => {
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

    // The paired positive, same host: the read answers again, and the host has the build.
    theBuild = STAMPED
    await personOpens('ali')
    expect(lastContext().build).toEqual(STAMPED)
    expect(toldLast()).not.toMatch(ANY_BUILD_LINE)
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
