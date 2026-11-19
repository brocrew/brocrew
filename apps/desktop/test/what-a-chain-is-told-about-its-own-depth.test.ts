import { syntheticProviderHome, neutralHostDeps, fixtureProviderConfig } from './lib/host-fixture'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { FakeProviderSessions, FakeRuntime } from '@brobot2/runtime'
import type { AgentToolset, ResumeOptions, SessionRef, StartOptions } from '@brobot2/runtime'
import type { Provider } from '@brobot2/shared'
import { RuntimeHost, type RuntimeEventSink } from '../src/main/runtime/runtime-host'
import { resolveSessionCwd } from '../src/main/runtime/scratch-cwd'
import type { RuntimeEventMessage } from '../src/shared/runtime-ipc'
import { type AppDatabase, openDatabase } from '../src/main/db/connection'
import { applyMigrations } from '../src/main/db/migrate'
import { createSessionStore, type SessionStore } from '../src/main/db/session-store'
import { composeProfileBundle, thisConversationSpans } from '../src/main/runtime/factory-text'
import { publishProfileBundle } from '../src/main/runtime/profile-bundle'
import { readSessionInstructions } from '../src/main/runtime/instructions'

const here = dirname(fileURLToPath(import.meta.url))
const migrationsFolder = join(here, '../src/main/db/migrations')

class ToolWatchingRuntime extends FakeRuntime {
  constructor(
    provider: Provider,
    private readonly handed: AgentToolset[],
    sessions: FakeProviderSessions,
    /**
     * 🔴 **D-024 · R1 — what each launch's adapter was HANDED as its system prompt**, start and
     * resume alike: this conversation's own block rides there, and in no file.
     */
    private readonly told: string[],
  ) {
    super(provider, { sessions })
  }
  override async start(options: StartOptions): ReturnType<FakeRuntime['start']> {
    this.hear(options.systemHint)
    const handle = await super.start(options)
    if (options.agentTools) this.handed.push(options.agentTools)
    return handle
  }
  override async resume(
    ref: SessionRef,
    options: ResumeOptions,
  ): ReturnType<FakeRuntime['resume']> {
    this.hear(options.systemHint)
    const handle = await super.resume(ref, options)
    if (options.agentTools) this.handed.push(options.agentTools)
    return handle
  }
  /**
   * ⛔ **A launch handed no hint was told nothing**, which is a premise failing rather than a
   * reading — so it throws, as the reader seam below does, instead of reading as silence.
   */
  private hear(systemHint: string | undefined): void {
    if (systemHint === undefined) throw new Error('the adapter was handed no system prompt')
    this.told.push(systemHint)
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

const GRANTS_HEADING = '## What you may do'

describe('what a chain is told about its own depth', () => {
  let userData: string
  let work: string
  let db: AppDatabase
  let store: SessionStore
  let host: RuntimeHost
  /** ⚑ Every host this test built, so a restart closes the one it replaced. */
  let hosts: RuntimeHost[]
  let handed: AgentToolset[]
  let told: string[]
  let issued: FakeProviderSessions
  let counter: number
  let clock: number
  let window: Sink
  const tick = (): number => clock++

  beforeEach(() => {
    userData = mkdtempSync(join(tmpdir(), 'brobot2-544-'))
    /** Its own folder, outside `userData` (which `checkSessionCwd` refused until `726` · R92). */
    work = mkdtempSync(join(tmpdir(), 'brobot2-544-work-'))
    db = openDatabase(join(userData, 'brobot2.sqlite'))
    applyMigrations(db, migrationsFolder)
    clock = Date.UTC(2030, 0, 1)
    store = createSessionStore(db, tick)
    counter = 0
    handed = []
    told = []
    issued = new FakeProviderSessions()
    window = new Sink('webContents:1')
    hosts = []
    host = buildHost()
  })

  const buildHost = (): RuntimeHost => {
    const built = new RuntimeHost({
      store,
      ...neutralHostDeps(() => userData),
      createRuntime: (provider: Provider) =>
        new ToolWatchingRuntime(provider, handed, issued, told),
      prepareProviderHome: syntheticProviderHome(() => userData),
      providerHomePath: (provider: Provider) => join(userData, 'provider-homes', provider),
      resolveCwd: (sessionId, requested) => resolveSessionCwd(userData, sessionId, requested),
      newSessionId: () => `sess_${++counter}`,
      now: tick,
      readProviderConfig: fixtureProviderConfig,
      // What the model receives, as the adapter is handed it: the published file, read back, plus
      // this conversation's own block, captured by ToolWatchingRuntime.
      readInstructions: (provider, cwd, providerHome, context) => {
        const bundle = publishProfileBundle(provider, providerHome, composeProfileBundle(context))
        if (!bundle.ok) throw new Error(`the bundle was not published: ${bundle.reason}`)
        // This conversation's own block is composed for its launch and handed beside the file.
        const thisConversation = thisConversationSpans(context)
        const read = readSessionInstructions({
          provider,
          cwd,
          providerHome,
          bundle,
          thisConversation,
        })
        // ⚠️ **The file is still checked as SENT**, keyed on the leaf's own path —
        // `InjectedInstruction.text` is *the exact text appended, verbatim* — so the rules around
        // the block this file reads are the bytes the model receives, not the composer's.
        const appended = read.instructions.injected.find((one) => one.path === bundle.path)
        if (appended === undefined) throw new Error(`the reader did not hand over ${bundle.path}`)
        if (appended.truncated) throw new Error(`the bundle was truncated at ${bundle.path}`)
        if (appended.text !== readFileSync(bundle.path, 'utf8')) {
          throw new Error(`what was appended is not what was published at ${bundle.path}`)
        }
        // Whole and last in the hint, so a cut cannot read as a launch told nothing.
        if (read.systemHint === null || !read.systemHint.endsWith(thisConversation.text)) {
          throw new Error('this conversation’s own block is not the whole tail of the hint')
        }
        return { instructions: read.instructions, systemHint: read.systemHint, memoryLoaded: null }
      },
    })
    hosts.push(built)
    return built
  }

  afterEach(async () => {
    for (const built of hosts) await built.closeAll()
    db.close()
    for (const dir of [userData, work]) rmSync(dir, { recursive: true, force: true })
  })

  const personOpens = async (profileId: string): Promise<string> => {
    const { sessionId } = await host.createSession(
      { provider: 'claude', profileId, cwd: work, approvalMode: 'ask' },
      window,
    )
    return sessionId
  }

  const bringIntoBeing = async (profileId: string): Promise<void> => {
    await host.close(await personOpens(profileId), window)
  }

  /** The toolset of the conversation launched most recently — the caller's own door. */
  const toolsOfTheLast = (): AgentToolset => handed.at(-1) as AgentToolset

  /**
   * ⚑ **D-016 · the give** — it starts the conversation the first time, and hangs the piece under
   * the one the caller holds (its root, or the piece it was given).
   */
  const callGive = async (
    tools: AgentToolset,
    profileSlug: string,
  ): Promise<Record<string, unknown>> => {
    const tool = tools.tools.find((one) => one.name === 'give_work')
    if (tool === undefined) throw new Error('no give_work on this toolset')
    return (
      await tool.call({
        definition_of_done: 'The requested result and its checks are recorded.',
        profile: profileSlug,
        title: 'The chain this file measures',
        brief: 'the chain this file measures',
      })
    ).structured as Record<string, unknown>
  }

  /** Seven levels below the work a person gave: deeper than any bound the app once applied. */
  const CHAIN = ['w1', 'w2', 'w3', 'w4', 'w5', 'w6', 'w7'] as const

  describe('no depth bound', () => {
    it('admits a give at every level of a seven-deep chain, and tells no launch a limit', async () => {
      for (const name of CHAIN) await bringIntoBeing(name)
      await personOpens('pm')
      let under: string | null = null
      for (const name of CHAIN) {
        const started = await callGive(toolsOfTheLast(), name)
        expect(started.outcome, JSON.stringify(started)).toBe('ok')
        if (under !== null) expect(started.label as string).toMatch(new RegExp(`^${under}\\.`))
        under = started.label as string
      }
      const launched = told.slice(-CHAIN.length - 1)
      expect(launched).toHaveLength(CHAIN.length + 1)
      for (const said of launched) {
        expect(said).toContain(GRANTS_HEADING)
        expect(said).not.toContain('delegation limit')
        expect(said).not.toContain('level below this conversation')
      }
    })

    it('the app-wide switch is still said, and still refuses a start', async () => {
      await bringIntoBeing('pm')
      store.setSpawningEnabled(false)
      await personOpens('pm')
      expect(told.at(-1) as string).toContain(
        '- This app currently blocks creating agents and starting new agent conversations.',
      )
      const refused = await callGive(toolsOfTheLast(), 'pm')
      expect(refused.outcome).toBe('refused')
      expect(refused.rail).toBe('spawning-disabled')
    })
  })
})
