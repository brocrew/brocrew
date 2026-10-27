import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  FakeProviderSessions,
  FakeRuntime,
  type FakeSessionHandle,
  type ResumeOptions,
  type SessionRef,
  type StartOptions,
} from '@brobot2/runtime'
import type { Provider } from '@brobot2/shared'
import { type AppDatabase, openDatabase } from '../../src/main/db/connection'
import { applyMigrations } from '../../src/main/db/migrate'
import { createSessionStore, type SessionStore } from '../../src/main/db/session-store'
import { NO_DISCOVERY } from '../../src/main/adopt/discover-sessions'
import {
  RuntimeHost,
  type RuntimeHostDeps,
  type RuntimeEventSink,
} from '../../src/main/runtime/runtime-host'
import { toolsToldInTextFor } from '../../src/main/runtime/agent-tools'
import { readSessionInstructions } from '../../src/main/runtime/instructions'
import { profileBundleSpans, thisConversationSpans } from '../../src/main/runtime/factory-text'
import { publishProfileBundle } from '../../src/main/runtime/profile-bundle'
import {
  brobotWorkspace,
  CLAUDE_INSTRUCTIONS_FILE,
  ensureWorkspace,
  workspaceOwnFilesIn,
} from '../../src/main/runtime/workspace'
import { resolveSessionCwd } from '../../src/main/runtime/scratch-cwd'
import { resourcesRoot } from '../../src/main/resources/resources'
import type {
  LaunchedEvent,
  RuntimeEventMessage,
  TranscriptEvent,
  UserTurnEvent,
} from '../../src/shared/runtime-ipc'

/**
 * # F093 · one world for the gap tests: a real host on the fake runtime, on throwaway folders
 *
 * ⚑ **`main/index.ts`'s own instruction wiring, copied** — compile, publish, read, and hand back the
 * profile file and the context it was composed from — as `what-this-agent-was-given.test.ts` does,
 * plus `context`, which `main/index.ts` passes since 7973c2fd.
 *
 * ⚑ **The provider end is captured**: every launch's options (its `systemHint` and its toolset) and
 * every text `send` handed over, per handle, in the order the handles were issued — so a test can
 * compare what a row KEPT with what the provider GOT.
 */

const here = dirname(fileURLToPath(import.meta.url))
const migrationsFolder = join(here, '../../src/main/db/migrations')

/** One launch, as the provider end saw it. */
export interface Handed {
  readonly provider: Provider
  readonly handle: FakeSessionHandle
  readonly options: StartOptions | ResumeOptions
  /** Every text `send` was handed, in order — refused ones too. */
  readonly sends: string[]
}

/** ⚑ What a test chooses about the provider end. */
export class TheProviderEnd {
  readonly handed: Handed[] = []
  /** The files Codex reports reading at launch (`instructionSources`), or `null` for none. */
  reportedSources: readonly string[] | null = null
  /** A Codex conversation compacts on request, as its adapter does (`R59`). */
  compactsOnCodex = false

  take(provider: Provider, handle: FakeSessionHandle, options: StartOptions | ResumeOptions): void {
    const sends: string[] = []
    const send = handle.send.bind(handle)
    Object.defineProperty(handle, 'send', {
      value: async (...args: Parameters<FakeSessionHandle['send']>): Promise<void> => {
        sends.push(args[0])
        return send(...args)
      },
      configurable: true,
    })
    if (provider === 'codex' && this.reportedSources !== null) {
      Object.defineProperty(handle, 'instructionSources', {
        value: this.reportedSources,
        configurable: true,
      })
    }
    if (provider === 'codex' && this.compactsOnCodex) handle.compactsOnRequest()
    this.handed.push({ provider, handle, options, sends })
  }

  newest(): Handed {
    const last = this.handed.at(-1)
    if (last === undefined) throw new Error('the provider was handed nothing')
    return last
  }
}

/** A `FakeRuntime` whose every handle reaches {@link TheProviderEnd}. */
export class CapturingRuntime extends FakeRuntime {
  constructor(
    provider: Provider,
    sessions: FakeProviderSessions,
    private readonly end: TheProviderEnd,
  ) {
    super(provider, { sessions })
  }
  override async start(opts: StartOptions): Promise<FakeSessionHandle> {
    const handle = await super.start(opts)
    this.end.take(this.provider, handle, opts)
    return handle
  }
  override async resume(ref: SessionRef, options: ResumeOptions): Promise<FakeSessionHandle> {
    const handle = await super.resume(ref, options)
    this.end.take(this.provider, handle, options)
    return handle
  }
}

/** A window, or — with `aPersonIsBehindIt: false` — a channel no person is behind. */
export class RecordingSink implements RuntimeEventSink {
  readonly messages: RuntimeEventMessage[] = []
  alive = true
  constructor(
    readonly ownerId: string,
    readonly aPersonIsBehindIt = true,
  ) {}
  send(message: RuntimeEventMessage): void {
    this.messages.push(message)
  }
  sendLiveness(): void {}
}

/** ⚑ Bounded: 400 × 10 ms at most, then a named failure. */
export async function waitFor(predicate: () => boolean, what: string): Promise<void> {
  for (let attempt = 0; attempt < 400; attempt++) {
    if (predicate()) return
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
  throw new Error(`timed out waiting for ${what}`)
}

export class F093World {
  readonly userData = mkdtempSync(join(tmpdir(), 'brobot2-f093-gaps-'))
  readonly project = join(this.userData, 'project')
  readonly db: AppDatabase
  readonly store: SessionStore
  readonly window = new RecordingSink('webContents:1')
  readonly end = new TheProviderEnd()
  private readonly sessions = new FakeProviderSessions()
  private readonly hosts: RuntimeHost[] = []
  private counter = 0

  constructor() {
    mkdirSync(this.project, { recursive: true })
    this.db = openDatabase(join(this.userData, 'brobot2.sqlite'))
    applyMigrations(this.db, migrationsFolder)
    this.store = createSessionStore(this.db)
    ensureWorkspace(this.userData)
  }

  /** The managed root: every home this app makes is under it. */
  root(): string {
    return join(this.userData, 'provider-homes')
  }

  homeOf(provider: Provider, profileId: string): string {
    return join(this.root(), 'default', profileId, provider)
  }

  buildHost(withInstructions = true, extra: Partial<RuntimeHostDeps> = {}): RuntimeHost {
    const userData = this.userData
    const built = new RuntimeHost({
      store: this.store,
      discoverSessions: NO_DISCOVERY,
      nativeTranscriptPath: () => null,
      exportDirectory: () => join(userData, 'exports'),
      resourcesRoot: () => resourcesRoot(userData),
      createRuntime: (provider: Provider) =>
        new CapturingRuntime(provider, this.sessions, this.end),
      prepareProviderHome: (provider: Provider, profileId?: string) => {
        const home = this.homeOf(provider, profileId ?? 'default')
        mkdirSync(home, { recursive: true })
        return home
      },
      providerHomePath: (provider: Provider, profileId: string) => this.homeOf(provider, profileId),
      providerHomesRoot: () => this.root(),
      resolveCwd: (sessionId, requested) => resolveSessionCwd(userData, sessionId, requested),
      newSessionId: () => `sess_${String(++this.counter)}`,
      commandListWaitMs: 200,
      readProviderConfig: (provider, home) => ({
        home,
        homeEnv: provider === 'codex' ? 'CODEX_HOME' : 'CLAUDE_CONFIG_DIR',
        model: 'm',
        authNote: null,
        files: [],
      }),
      whichBuild: () => ({ id: 'abc1234', commit: 'abc1234def', dirty: false, schema: 7 }),
      ...(withInstructions
        ? {
            readInstructions: (provider, cwd, providerHome, context) => {
              const composed = profileBundleSpans(context)
              const bundle = publishProfileBundle(provider, providerHome, composed.text)
              const read = readSessionInstructions({
                provider,
                cwd,
                providerHome,
                bundle,
                bundleComposed: composed,
                thisConversation: thisConversationSpans(context, toolsToldInTextFor(provider)),
                workspaceFile: join(brobotWorkspace(userData), CLAUDE_INSTRUCTIONS_FILE),
                workspaceOwnFiles: workspaceOwnFilesIn(userData),
                home: userData,
              })
              return {
                instructions: read.instructions,
                systemHint: read.systemHint ?? undefined,
                ...(read.firstTurnLead === null ? {} : { firstTurnLead: read.firstTurnLead }),
                memoryLoaded: read.memoryLoaded,
                profileFile: read.profileFile,
                context,
              }
            },
          }
        : {}),
      ...extra,
    })
    this.hosts.push(built)
    return built
  }

  async dispose(): Promise<void> {
    for (const host of [...this.hosts].reverse()) await host.closeAll()
    this.db.close()
    rmSync(this.userData, { recursive: true, force: true })
  }

  ledger(sessionId: string): TranscriptEvent[] {
    return this.store.events(sessionId).map((entry) => entry.event)
  }

  turnsOf(sessionId: string): UserTurnEvent[] {
    return this.ledger(sessionId).filter(
      (event): event is UserTurnEvent => event.type === 'user_turn',
    )
  }

  launchesOf(sessionId: string): LaunchedEvent[] {
    return this.ledger(sessionId).filter(
      (event): event is LaunchedEvent => event.type === 'launched',
    )
  }

  countOf(sessionId: string, type: TranscriptEvent['type']): number {
    return this.ledger(sessionId).filter((event) => event.type === type).length
  }

  /** ⚑ In the throwaway project folder — or, `inTheWorkspace`, in BroBot's own workspace. */
  async open(
    host: RuntimeHost,
    provider: Provider,
    profileId: string,
    options: { readonly inTheWorkspace?: boolean; readonly approvalMode?: 'auto' | 'ask' } = {},
  ): Promise<string> {
    const { sessionId } = await host.createSession(
      {
        provider,
        profileId,
        approvalMode: options.approvalMode ?? 'auto',
        ...(options.inTheWorkspace === true ? {} : { cwd: this.project }),
      },
      this.window,
    )
    return sessionId
  }
}
