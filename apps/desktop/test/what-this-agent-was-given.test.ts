import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  boundInventory,
  CODEX_TOOL_NAMING,
  MAX_COMMAND_TEXT,
  CODEX_TOOLS_DESCRIPTION,
  FakeRuntime,
  MAX_TOOL_TEXT,
  type FakeSessionHandle,
  type AgentToolset,
  type StartOptions,
} from '@brobot2/runtime'
import type { Provider } from '@brobot2/shared'
import { type AppDatabase, openDatabase } from '../src/main/db/connection'
import { applyMigrations } from '../src/main/db/migrate'
import { createSessionStore, type SessionStore } from '../src/main/db/session-store'
import { NO_DISCOVERY } from '../src/main/adopt/discover-sessions'
import { RuntimeHost, type RuntimeEventSink } from '../src/main/runtime/runtime-host'
import { executeRuntimeCommand } from '../src/main/runtime/ipc'
import { agentToolsFor, toolsToldInTextFor } from '../src/main/runtime/agent-tools'
import { conversationBlock, readSessionInstructions } from '../src/main/runtime/instructions'
import {
  fingerprintOf,
  toolsetFingerprint,
  oneMessageAsTheModelGotIt,
} from '../src/main/runtime/what-this-agent-was-given'
import { readCodexSkill } from '../../../packages/runtime/src/codex/normalize'
import {
  boundCommands,
  MAX_PROVIDER_COMMANDS,
} from '../../../packages/runtime/src/provider-commands'
import { WHAT_CHANGED_HEADER } from '../src/main/runtime/codex-lead'
import type { TurnAsSent } from '../src/shared/turn-as-sent'
import {
  sizeOf,
  sizesAdded,
  type GivenMemoryEntry,
  type PartSize,
  type WhatALaunchGave,
  type WhatThisAgentWasGiven,
} from '../src/shared/what-this-agent-was-given'
import { profileBundleSpans, thisConversationSpans } from '../src/main/runtime/factory-text'
import { publishProfileBundle } from '../src/main/runtime/profile-bundle'
import {
  brobotWorkspace,
  CLAUDE_INSTRUCTIONS_FILE,
  ensureWorkspace,
  workspaceOwnFilesIn,
} from '../src/main/runtime/workspace'
import { resolveSessionCwd } from '../src/main/runtime/scratch-cwd'
import { SNAPSHOT_FILES, snapshotFor } from '../src/main/provider-snapshots'
import { DEFAULT_PROFILE_ID } from '../src/shared/runtime-ipc'
import type {
  LaunchedEvent,
  RuntimeEventMessage,
  TranscriptEvent,
  UserTurnEvent,
} from '../src/shared/runtime-ipc'
import { withoutWhatThisAppAdds } from './lib/what-this-app-adds'
import { howYouWork } from './lib/the-core'

/**
 * # F093 · what an agent was given — recorded with each launch and each turn (R2), read in one go
 *
 * ⚑ **A real host on the fake runtime, with `main/index.ts`'s own instruction wiring**, on throwaway
 * folders: a `launched` row keeps what its launch gave (BroBot's own words in full, everything else
 * by fingerprint), a `user_turn` keeps the whole text its provider was handed, and
 * `whatThisAgentWasGiven` reads both back with the files and the memory read now, the tools in full
 * and every size.
 */

const here = dirname(fileURLToPath(import.meta.url))
const migrationsFolder = join(here, '../src/main/db/migrations')

/** A `FakeRuntime` that keeps the handles it issues, so a test can reach the provider end. */
class CapturingRuntime extends FakeRuntime {
  readonly issued: FakeSessionHandle[] = []
  readonly handed: (AgentToolset | undefined)[] = []
  override async start(opts: StartOptions): Promise<FakeSessionHandle> {
    const handle = await super.start(opts)
    this.issued.push(handle)
    this.handed.push(opts.agentTools)
    return handle
  }
}

class RecordingSink implements RuntimeEventSink {
  readonly aPersonIsBehindIt: boolean = true
  readonly messages: RuntimeEventMessage[] = []
  alive = true
  constructor(readonly ownerId: string) {}
  send(message: RuntimeEventMessage): void {
    this.messages.push(message)
  }
  sendLiveness(): void {}
}

/** A channel with no person behind it — what the window's own sink is not. */
class NobodysSink extends RecordingSink {
  override readonly aPersonIsBehindIt: boolean = false
}

describe('F093 · what an agent was given', () => {
  let userData: string
  let project: string
  let db: AppDatabase
  let store: SessionStore
  let hosts: RuntimeHost[]
  let runtimes: CapturingRuntime[]
  let counter: number
  let window: RecordingSink
  /** ⚑ The provider's own record of a conversation, as the archive would name it — or none. */
  let nativeFile: string | null

  const homeOf = (provider: Provider, profileId: string): string =>
    join(userData, 'provider-homes', 'default', profileId, provider)

  const buildHost = (withInstructions = true): RuntimeHost => {
    // ⚑ One fake per provider, so a conversation closed here can be resumed by the runtime that
    // issued it.
    const byProvider = new Map<Provider, CapturingRuntime>()
    const built = new RuntimeHost({
      store,
      discoverSessions: NO_DISCOVERY,
      nativeTranscriptPath: () => nativeFile,
      exportDirectory: () => join(userData, 'exports'),
      createRuntime: (provider: Provider) => {
        const known = byProvider.get(provider)
        if (known !== undefined) return known
        const runtime = new CapturingRuntime(provider)
        byProvider.set(provider, runtime)
        runtimes.push(runtime)
        return runtime
      },
      prepareProviderHome: (provider: Provider, profileId?: string) => {
        const home = homeOf(provider, profileId ?? 'default')
        mkdirSync(home, { recursive: true })
        return home
      },
      providerHomePath: (provider: Provider, profileId: string) => homeOf(provider, profileId),
      providerHomesRoot: () => join(userData, 'provider-homes'),
      resolveCwd: (sessionId, requested) => resolveSessionCwd(userData, sessionId, requested),
      newSessionId: () => `sess_${++counter}`,
      readProviderConfig: (_provider, home) => ({
        home,
        homeEnv: 'CLAUDE_CONFIG_DIR',
        model: 'm',
        authNote: null,
        files: [],
      }),
      whichBuild: () => ({ id: 'abc1234', commit: 'abc1234def', dirty: false, schema: 7 }),
      // ⚑ `main/index.ts`'s own wiring: the snapshots this build carries.
      providerSnapshot: (provider, model) => snapshotFor(provider, model),
      // ⚑ `main/index.ts`'s own wiring, copied: compile, publish, read.
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
              }
            },
          }
        : {}),
    })
    hosts.push(built)
    return built
  }

  beforeEach(() => {
    userData = mkdtempSync(join(tmpdir(), 'brobot2-f093-'))
    project = join(userData, 'project')
    mkdirSync(project, { recursive: true })
    db = openDatabase(join(userData, 'brobot2.sqlite'))
    applyMigrations(db, migrationsFolder)
    store = createSessionStore(db)
    ensureWorkspace(userData)
    hosts = []
    runtimes = []
    counter = 0
    window = new RecordingSink('webContents:1')
    nativeFile = null
  })

  afterEach(async () => {
    for (const host of hosts) await host.closeAll()
    db.close()
    rmSync(userData, { recursive: true, force: true })
  })

  const ledger = (sessionId: string): TranscriptEvent[] =>
    store.events(sessionId).map((entry) => entry.event)

  const waitFor = async (predicate: () => boolean, what: string): Promise<void> => {
    for (let attempt = 0; attempt < 400; attempt++) {
      if (predicate()) return
      await new Promise((resolve) => setTimeout(resolve, 10))
    }
    throw new Error(`timed out waiting for ${what}`)
  }

  const turnsOf = (sessionId: string): UserTurnEvent[] =>
    ledger(sessionId).filter((event): event is UserTurnEvent => event.type === 'user_turn')

  const launchesOf = (sessionId: string): LaunchedEvent[] =>
    ledger(sessionId).filter((event): event is LaunchedEvent => event.type === 'launched')

  const seedClaudeMemory = (profileId: string, topics: number): void => {
    const dir = join(homeOf('claude', profileId), 'memory')
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'MEMORY.md'), '- [Style](style.md) — one line per change\n')
    for (let at = 0; at < topics; at++) {
      writeFileSync(join(dir, `topic-${String(at).padStart(2, '0')}.md`), `Topic ${String(at)}.\n`)
    }
  }

  /**
   * ⚑ In the throwaway project folder — or, `inTheWorkspace`, in BroBot's own workspace — on the
   * model named, else the one the host names.
   */
  const open = async (
    host: RuntimeHost,
    provider: Provider,
    profileId: string,
    inTheWorkspace = false,
    model?: string,
  ): Promise<string> => {
    const { sessionId } = await host.createSession(
      {
        provider,
        profileId,
        approvalMode: 'auto',
        ...(inTheWorkspace ? {} : { cwd: project }),
        ...(model === undefined ? {} : { model }),
      },
      window,
    )
    return sessionId
  }

  it.each(['claude', 'codex'] as const)(
    'keeps role-specific tool counts and fingerprints on %s, including stopped reads',
    async (provider) => {
      const host = buildHost()
      const primary = await open(host, provider, DEFAULT_PROFILE_ID)
      const primaryTools = runtimes.at(-1)?.handed.at(-1)
      const ordinary = await open(host, provider, 'wren')
      const ordinaryTools = runtimes.at(-1)?.handed.at(-1)
      for (const [id, expected, count] of [
        [primary, primaryTools, 33],
        [ordinary, ordinaryTools, 32],
      ] as const) {
        if (expected === undefined) throw new Error('no runtime toolset captured')
        expect(expected.tools).toHaveLength(count)
        const given = launchesOf(id)[0]?.given
        expect(given?.tools).toMatchObject({ count, sha256: toolsetFingerprint(expected) })
        const live = await host.whatThisAgentWasGiven(id)
        expect(live.tools.list.map((tool) => tool.name)).toEqual(
          expected.tools.map((tool) => tool.name),
        )
        // Provider model lists can arrive after the first launch; compare actual definitions,
        // rather than pretending the factory's empty-list default was handed to the model.
        const now = fingerprintOf(
          JSON.stringify(
            live.tools.list.map(({ name, description, parameters }) => ({
              name,
              description,
              parameters,
            })),
          ),
        )
        expect(live.tools.changedSinceLaunch).toBe(now !== given?.tools.sha256)
        await host.close(id, window)
        const stopped = await host.whatThisAgentWasGiven(id)
        expect(stopped.tools.list).toEqual(live.tools.list)
        expect(stopped.tools.changedSinceLaunch).toBe(live.tools.changedSinceLaunch)
      }
    },
  )

  it('preserves a full pre-filter launch record while showing the current ordinary toolset', async () => {
    const host = buildHost()
    const ordinary = await open(host, 'claude', 'wren')
    await host.close(ordinary, window)
    const given = launchesOf(ordinary)[0]?.given
    if (given === undefined) throw new Error('the launch kept no record')
    const currentFull = agentToolsFor(host, ordinary, {}, true)
    // Keep the old full vocabulary in the historical launch, before own-notes tools existed.
    const full = {
      ...currentFull,
      tools: currentFull.tools.filter(
        (one) => one.name !== 'read_own_notes' && one.name !== 'write_own_notes',
      ),
    }
    const historical = {
      ...given,
      tools: { ...given.tools, count: 31, sha256: toolsetFingerprint(full) },
    }
    store.append(
      ordinary,
      store.nextOrdinal(ordinary),
      { type: 'launched', given: historical },
      Date.now(),
    )
    const read = await host.whatThisAgentWasGiven(ordinary)
    expect(read.tools.list).toHaveLength(32)
    expect(read.tools.list.map((tool) => tool.name)).not.toContain('write_agent_rules')
    expect(read.tools.changedSinceLaunch).toBe(true)
    expect(launchesOf(ordinary).at(-1)?.given).toEqual(historical)
  })

  it('omits the direct writer for stopped adopted or unknown profiles and an unrecorded id', async () => {
    const host = buildHost()
    const id = await open(host, 'claude', 'wren')
    await host.close(id, window)
    const row = store.recordedOne(id)
    if (row === null) throw new Error('missing recorded conversation')
    for (const profileId of [null, 'unrecognised-profile']) {
      const recorded = vi
        .spyOn(store, 'recordedOne')
        .mockImplementation((asked) => (asked === id ? { ...row, profileId } : null))
      try {
        const read = await host.whatThisAgentWasGiven(id)
        expect(read.tools.list).toHaveLength(32)
        expect(read.tools.list.map((tool) => tool.name)).not.toContain('write_agent_rules')
        expect(read.tools.list.map((tool) => tool.name)).toEqual(
          expect.arrayContaining(['read_agent_rules', 'propose_agent_rules']),
        )
      } finally {
        recorded.mockRestore()
      }
    }
    // The read API refuses unknown ids. Pin the private construction boundary as well: no
    // slot and no recorded owner must never become a privileged declaration.
    const boundary = host as unknown as {
      agentToolsForSession(id: string): ReturnType<typeof agentToolsFor>
    }
    expect(boundary.agentToolsForSession('missing').tools.map((tool) => tool.name)).not.toContain(
      'write_agent_rules',
    )
    await expect(host.whatThisAgentWasGiven('missing')).rejects.toThrow()
  })

  it('⚑ a Claude launch keeps BroBot’s own words in full and the rest by fingerprint, and a turn keeps the whole text it was handed', async () => {
    seedClaudeMemory('lead', 2)
    const host = buildHost()
    const lead = await open(host, 'claude', 'lead', true)
    await host.send(lead, 'please plan the next release', window)
    await waitFor(() => turnsOf(lead).length > 0, 'the turn')

    const [launched] = launchesOf(lead)
    const given = launched?.given
    expect(given, 'the launch kept no record').toBeDefined()
    if (given === undefined) return
    expect(given.placement).toBe('system-prompt')
    expect(given.build).toEqual({ id: 'abc1234', commit: 'abc1234def' })
    expect(given.profileFile?.text).toContain(howYouWork(false))
    expect(given.profileFile?.sections.map((one) => one.heading)).toContain('How you work')
    // The core is the same text whatever the grants, so the record keeps no grant-chosen lines.
    expect(Object.keys(given)).not.toContain('adaptedLines')
    expect(given.thisConversation?.text).toContain('## This conversation')
    expect(given.files.some((one) => one.kind === 'workspace-instructions')).toBe(false)
    expect(given.thisConversation?.text).toContain(
      'This folder persists: files you leave here are still here in later conversations.',
    )
    expect(given.memory.map((one) => basename(one.path))).toContain('MEMORY.md')
    expect(JSON.stringify(given.memory)).not.toContain('one line per change')
    expect(given.tools.count).toBe(agentToolsFor(host, lead).tools.length)

    const [turn] = turnsOf(lead)
    expect(turn?.text).toBe('please plan the next release')
    expect(turn?.sent).toContain('Sent by a person, typed into this app.')
    expect(turn?.sent).toContain('You are answering a person.')
    expect(withoutWhatThisAppAdds(turn?.sent ?? '').endsWith('please plan the next release')).toBe(
      true,
    )
  })

  it('⚑ the one read: files with origin and sections, tools in full, memory read now, the provider’s own parts for its model, and sizes', async () => {
    seedClaudeMemory('lead', 2)
    const host = buildHost()
    const lead = await open(host, 'claude', 'lead', true, 'opus')
    const read = await host.whatThisAgentWasGiven(lead)

    expect(read.launch).toMatchObject({ recorded: true, running: true, thisBuild: true })
    expect(read.placement).toBe('system-prompt')
    const [profile] = read.files
    expect(profile?.kind).toBe('profile-instructions')
    expect(profile?.origin).toBe('brobot')
    expect(profile?.madeAutomatically).toBe(true)
    expect(profile?.textIs).toBe('as-launched')
    expect(profile?.changedSinceLaunch).toBe(false)
    const made = Object.fromEntries((profile?.sections ?? []).map((one) => [one.heading, one.made]))
    expect(made['How you work']).toBe('shipped')
    // The core replaced the separate rules section.
    expect(Object.keys(made)).not.toContain('Rules')
    expect(read.files.some((one) => one.kind === 'workspace-instructions')).toBe(false)
    expect(read.thisConversation?.sections.some((one) => one.made === 'composed-at-launch')).toBe(
      true,
    )

    // ⛔ Every tool in full — never cut at 500.
    const toolset = agentToolsFor(host, lead)
    expect(read.tools.list.map((one) => one.name)).toEqual(toolset.tools.map((one) => one.name))
    const giveWork = read.tools.list.find((one) => one.name === 'give_work')
    expect(giveWork?.description.length).toBeGreaterThan(500)
    expect(giveWork?.parameters).toMatchObject({ type: 'object' })
    expect(read.tools.instructions.ridesIn).toBe('in-the-first-message')

    const claude = read.memory.stores.find((one) => one.provider === 'claude')
    const index = claude?.entries.find((one) => one.path.endsWith('MEMORY.md'))
    expect(index).toMatchObject({ origin: 'an-agent', reach: 'in-every-request' })
    expect(index?.changedSinceLaunch).toBe(false)
    expect(claude?.total).toBe(3)

    // ⚑ R3 · the provider's own parts, from the snapshot this build carries for the model it runs.
    const snapshot = read.providerParts.snapshot
    expect(read.providerParts.model).toBe('opus')
    expect(snapshot?.label).toBe(SNAPSHOT_FILES.claude.label)
    expect(snapshot?.parts.map((one) => one.id)).toContain('claude.prompt')
    expect(read.providerParts.why).toBeNull()
    expect(read.size.provider).toEqual({
      characters: snapshot?.chars,
      words: snapshot?.words,
      tokens: snapshot?.approxTokens,
    })
    // ⚑ The total holds BroBot's words, the other files, the memory in every request and the
    // provider's own parts.
    expect(read.size.total.characters).toBeGreaterThan(
      read.size.brobot.characters +
        read.size.otherFiles.characters +
        read.size.memoryInEveryRequest.characters +
        (read.size.provider?.characters ?? 0),
    )
    // BroBot's words in every request hold at least the whole core it told this agent.
    expect(read.size.brobot.characters).toBeGreaterThan(howYouWork(false).length)
    expect(read.size.contextWindow).toBeNull()
    expect(read.size.contextWindowWhy).toMatch(/No context reading/)

    // ⛔ A model this build did not capture: no other model's parts in its place, and why.
    const other = await host.whatThisAgentWasGiven(
      await open(host, 'claude', 'lead', true, 'claude-nonesuch-1'),
    )
    expect(other.providerParts).toMatchObject({ model: 'claude-nonesuch-1', snapshot: null })
    expect(other.providerParts.why).toBe(
      `claude-nonesuch-1 was not captured ${SNAPSHOT_FILES.claude.label}.`,
    )
    expect(other.size.provider).toBeNull()
  })

  it('⚑ the own instructions say which version a launch used, who wrote it and when — and that a newer one waits for the next start', async () => {
    const host = buildHost()
    await host.close(await open(host, 'claude', 'worker'), window)
    expect(host.instructAgent('worker', 'Keep each note to one line.', undefined, window)).not.toBe(
      null,
    )
    const worker = await open(host, 'claude', 'worker')
    const first = await host.whatThisAgentWasGiven(worker)
    expect(first.ownInstructions.used).toMatchObject({ version: 1, whoWroteIt: 'a-person' })
    expect(first.ownInstructions.used?.whoWroteItMeans).toBe('you wrote this')
    expect(first.ownInstructions.changedSinceLaunch).toBe(false)
    const own = first.files[0]?.sections.find((one) => one.made === 'own-instructions')
    expect(own?.version?.version).toBe(1)

    host.instructAgent('worker', 'Keep each note to two lines.', undefined, window)
    const later = await host.whatThisAgentWasGiven(worker)
    expect(later.ownInstructions.used?.version).toBe(1)
    expect(later.ownInstructions.newest?.version).toBe(2)
    expect(later.ownInstructions.changedSinceLaunch).toBe(true)
  })

  it('⚑ Codex: the first turn is handed with this conversation’s lead in front, and the profile file’s text comes with the launch', async () => {
    const host = buildHost()
    const lead = await open(host, 'codex', 'lead')
    await host.send(lead, 'please plan the next release', window)
    await waitFor(() => turnsOf(lead).length > 0, 'the turn')
    const [turn] = turnsOf(lead)
    expect(
      turn?.sent?.startsWith('Composed by BroCrew for this conversation at this launch:'),
    ).toBe(true)
    expect(turn?.sent).toContain('Sent by a person, typed into this app.')

    const read = await host.whatThisAgentWasGiven(lead)
    expect(read.placement).toBe('first-message')
    expect(read.files[0]?.kind).toBe('profile-instructions')
    expect(read.files[0]?.text).toContain('## How you work')
    expect(read.tools.instructions.ridesIn).toBe('in-the-first-message')
    expect(read.tools.deferral.kind).toBe('in-every-request')
  })

  /** ⚑ A Codex tool list as its adapter states it: through the one bounding rule, with no tools. */
  const codexToolList = (lead: string, source: string, instructions: string): void => {
    const bounded = boundInventory({
      naming: CODEX_TOOL_NAMING,
      declared: { server: 'brobot', instructions, tools: [] },
      published: null,
    })
    store.append(
      lead,
      store.nextOrdinal(lead),
      {
        type: 'tool_inventory',
        naming: bounded.naming,
        declared: bounded.declared,
        published: bounded.published,
        source,
      } as TranscriptEvent,
      Date.now(),
    )
  }

  it('⚑ Codex’s tools come with the sentence they are declared under: the one its thread started with where the ledger says, this build’s where it does not; Claude has none', async () => {
    const host = buildHost()
    const lead = await open(host, 'codex', 'lead')
    // No start on the ledger: this build's sentence, and the read says so.
    const now = await host.whatThisAgentWasGiven(lead)
    expect(now.tools.namespace).toEqual({
      text: CODEX_TOOLS_DESCRIPTION,
      textIs: 'composed-now',
      size: expect.objectContaining({ characters: CODEX_TOOLS_DESCRIPTION.length }),
    })
    // ⚑ It goes in every request on Codex, so it counts there, and with the tools in full.
    expect(now.size.toolsInEveryRequest.characters).toBe(
      now.tools.size.characters + CODEX_TOOLS_DESCRIPTION.length,
    )
    expect(now.size.tools).toEqual(now.size.toolsInEveryRequest)

    // ⚑ The thread started with other words; a later resume states this build's, which the thread
    // never took: the start's words are the ones shown.
    codexToolList(lead, 'thread/start', 'Older words the tools were declared with.')
    codexToolList(lead, 'thread/resume', CODEX_TOOLS_DESCRIPTION)
    const launched = await host.whatThisAgentWasGiven(lead)
    expect(launched.tools.namespace?.text).toBe('Older words the tools were declared with.')
    expect(launched.tools.namespace?.textIs).toBe('as-launched')

    // ⛔ Claude declares no namespace.
    const claude = await open(host, 'claude', 'other')
    expect((await host.whatThisAgentWasGiven(claude)).tools.namespace).toBeUndefined()
  })

  it('⚑ a Codex conversation whose ledger holds only resumes shows this build’s sentence, and says so', async () => {
    const host = buildHost()
    const lead = await open(host, 'codex', 'lead')
    codexToolList(lead, 'thread/resume', CODEX_TOOLS_DESCRIPTION)
    const read = await host.whatThisAgentWasGiven(lead)
    expect(read.tools.namespace?.textIs).toBe('composed-now')
  })

  it('⛔ a start sentence the tool list may have cut is never shown as the thread’s: this build’s is, and says so', async () => {
    const host = buildHost()
    const lead = await open(host, 'codex', 'lead')
    // ⚑ Longer than the list keeps, and within the 1024 a thread could start with.
    const long = 'The tools this app gives you, and what each is for. '.repeat(15)
    expect(long.length).toBeGreaterThan(MAX_TOOL_TEXT)
    expect(long.length).toBeLessThanOrEqual(1024)
    codexToolList(lead, 'thread/start', long)
    const row = ledger(lead)
      .filter((event) => event.type === 'tool_inventory')
      .at(-1)
    expect(row?.type === 'tool_inventory' ? row.declared?.instructions?.length : null).toBe(
      MAX_TOOL_TEXT,
    )

    const read = await host.whatThisAgentWasGiven(lead)
    expect(read.tools.namespace).toEqual({
      text: CODEX_TOOLS_DESCRIPTION,
      textIs: 'composed-now',
      size: expect.objectContaining({ characters: CODEX_TOOLS_DESCRIPTION.length }),
    })
  })

  it('⚑ a closed conversation reads its last launch off the ledger; one launched before the record is composed now, and says so', async () => {
    const host = buildHost()
    const lead = await open(host, 'claude', 'lead')
    await host.close(lead, window)
    const closed = await host.whatThisAgentWasGiven(lead)
    expect(closed.launch).toMatchObject({ recorded: true, running: false })
    expect(closed.files[0]?.textIs).toBe('as-launched')

    // ⚑ A launch with no instruction reader keeps no record — as every launch did before F093.
    const bare = buildHost(false)
    const old = await open(bare, 'claude', 'elder')
    await bare.close(old, window)
    expect(launchesOf(old)[0]?.given).toBeUndefined()
    const now = await host.whatThisAgentWasGiven(old)
    expect(now.launch).toEqual({ recorded: false, why: 'before-this-build', running: false })
    expect(now.files[0]?.textIs).toBe('composed-now')
  })

  it('⛔ a launch this app holds no record of: the read composes one now, and every line and the paragraph in it say they are this build’s, on both providers', async () => {
    const host = buildHost()
    const bare = buildHost(false)
    for (const provider of ['claude', 'codex'] as const) {
      const old = await open(bare, provider, `elder-${provider}`, true)
      await bare.close(old, window)
      expect(launchesOf(old)[0]?.given).toBeUndefined()
      const read = await host.whatThisAgentWasGiven(old)
      expect(read.launch.recorded, provider).toBe(false)
      const headed = read.files.filter((one) => one.heading !== undefined)
      if (provider === 'claude') expect(headed).toHaveLength(1)
      expect(
        headed.every((one) => one.headingIs === 'composed-now'),
        provider,
      ).toBe(true)
      expect(read.thisConversation?.headingIs, provider).toBe('composed-now')
      expect(read.tools.instructions.textIs, provider).toBe('composed-now')
    }
  })

  it('⚑ each line BroBot composed says where it came from: its launch’s, where the launch kept it, else this build’s; memory is the launch’s until it changes', async () => {
    seedClaudeMemory('lead', 1)
    const host = buildHost()
    const lead = await open(host, 'claude', 'lead', true)
    const [launched] = launchesOf(lead)
    const given = launched?.given
    if (given === undefined) throw new Error('the launch kept no record')

    // ⚑ The launch kept them: the read gives them back, and says so.
    const read = await host.whatThisAgentWasGiven(lead)
    const sent = read.files.filter((one) => one.heading !== undefined)
    expect(sent).toHaveLength(1)
    expect(sent.every((one) => one.headingIs === 'as-launched')).toBe(true)
    expect(sent.map((one) => one.heading)).toEqual([
      given.profileFile?.heading,
      ...given.files.flatMap((one) => (one.heading === undefined ? [] : [one.heading])),
    ])
    expect(read.thisConversation?.headingIs).toBe('as-launched')
    expect(read.tools.instructions).toMatchObject({
      text: agentToolsFor(host, lead).instructions,
      textIs: 'as-launched',
    })
    const index = (of: typeof read): GivenMemoryEntry | undefined =>
      of.memory.stores
        .find((one) => one.provider === 'claude')
        ?.entries.find((one) => one.path.endsWith('MEMORY.md'))
    expect(index(read)?.textIs).toBe('as-launched')

    // ⚑ A launch that kept none of them: this build's, and the read says so.
    await host.close(lead, window)
    const without = <T extends object>(one: T, key: string): T =>
      Object.fromEntries(Object.entries(one).filter(([name]) => name !== key)) as T
    const older: WhatALaunchGave = {
      ...given,
      profileFile: given.profileFile === null ? null : without(given.profileFile, 'heading'),
      thisConversation:
        given.thisConversation === null ? null : without(given.thisConversation, 'heading'),
      files: given.files.map((file) => without(file, 'heading')),
      tools: without(given.tools, 'instructions'),
    }
    store.append(lead, store.nextOrdinal(lead), { type: 'launched', given: older }, Date.now())
    const composed = await host.whatThisAgentWasGiven(lead)
    const composedSent = composed.files.filter((one) => one.heading !== undefined)
    expect(composedSent.map((one) => one.heading)).toEqual(sent.map((one) => one.heading))
    expect(composedSent.every((one) => one.headingIs === 'composed-now')).toBe(true)
    expect(composed.thisConversation?.headingIs).toBe('composed-now')
    expect(composed.tools.instructions.textIs).toBe('composed-now')

    const olderMessage = oneMessageAsTheModelGotIt({
      sessionId: lead,
      provider: 'claude',
      message: { ordinal: 2, at: 1, event: { type: 'user_turn', text: 'An older message.' } },
      launch: { ordinal: 1, at: 1, kept: 'recorded', record: older },
      firstOfItsLaunch: true,
      earlierInThisLaunch: () => [],
      providersRecord: { found: false, why: 'No provider record in this fixture.' },
    })
    const olderFiles = olderMessage.parts.filter((part) => part.path !== null)
    expect(olderFiles).toHaveLength(1)
    expect(olderFiles.every((part) => part.heading === undefined)).toBe(true)

    // ⛔ A paragraph its launch kept is shown over this build's, never the other way round.
    store.append(
      lead,
      store.nextOrdinal(lead),
      {
        type: 'launched',
        given: { ...given, tools: { ...given.tools, instructions: 'An older paragraph.' } },
      },
      Date.now(),
    )
    const kept = await host.whatThisAgentWasGiven(lead)
    expect(kept.tools.instructions).toMatchObject({
      text: 'An older paragraph.',
      textIs: 'as-launched',
      size: expect.objectContaining({ characters: 'An older paragraph.'.length }),
    })

    // ⚑ The memory changed since: read now, and said so.
    writeFileSync(
      join(homeOf('claude', 'lead'), 'memory', 'MEMORY.md'),
      '- [Style](style.md) — changed\n',
    )
    const changed = await host.whatThisAgentWasGiven(lead)
    expect(index(changed)).toMatchObject({ textIs: 'read-now', changedSinceLaunch: true })
  })

  it('⚑ the launch keeps the settings its adapter launched with, and the read gives them beside where the conversation stands now; the copy says the mode it was captured in', async () => {
    const host = buildHost()
    const lead = await open(host, 'claude', 'lead')
    const handle = runtimes.find((one) => one.provider === 'claude')?.issued.at(-1)
    if (handle === undefined) throw new Error('no Claude handle was issued')
    const [launched] = launchesOf(lead)
    expect(handle.launchSettings).toEqual([{ key: 'approval', value: 'auto' }])
    expect(launched?.given?.settings).toEqual(handle.launchSettings)

    const read = await host.whatThisAgentWasGiven(lead)
    expect(read.launchSettings).toEqual({
      recorded: true,
      settings: [{ key: 'approval', atLaunch: 'auto', now: 'auto' }],
    })
    expect(read.providerParts.capturedIn).toEqual({ approval: 'ask', planning: false })

    // ⚑ Changed since: the launch's value stays, beside the new one.
    await host.setApprovalMode(lead, 'ask', window)
    expect((await host.whatThisAgentWasGiven(lead)).launchSettings?.settings).toEqual([
      { key: 'approval', atLaunch: 'auto', now: 'ask' },
    ])

    // ⛔ A launch that kept none: nothing said for it, and where the conversation stands now.
    await host.close(lead, window)
    const given = launched?.given
    if (given === undefined) throw new Error('the launch kept no record')
    const older = Object.fromEntries(
      Object.entries(given).filter(([name]) => name !== 'settings'),
    ) as WhatALaunchGave
    store.append(lead, store.nextOrdinal(lead), { type: 'launched', given: older }, Date.now())
    store.startPlanMode(lead, Date.now())
    expect((await host.whatThisAgentWasGiven(lead)).launchSettings).toEqual({
      recorded: false,
      settings: [
        { key: 'approval', atLaunch: null, now: 'ask' },
        { key: 'mode', atLaunch: null, now: 'plan' },
      ],
    })

    // ⛔ What the launch row holds is read back only where it is a setting this app writes.
    store.append(
      lead,
      store.nextOrdinal(lead),
      {
        type: 'launched',
        given: {
          ...given,
          settings: [
            { key: 'approval', value: 'auto' },
            { key: 'not-a-setting', value: 'x' },
            { key: 'memory', value: [1, 2] },
            { key: 'tools-off', value: ['AskUserQuestion'] },
          ],
        },
      } as unknown as TranscriptEvent,
      Date.now(),
    )
    // ⚑ …and the provider's own tools that launch turned off, as it kept them.
    expect((await host.whatThisAgentWasGiven(lead)).launchSettings?.settings).toEqual([
      { key: 'approval', atLaunch: 'auto', now: 'ask' },
      { key: 'tools-off', atLaunch: ['AskUserQuestion'] },
    ])
  })

  it('⚑ an agent’s skills as its provider listed them since its launch: Codex’s with their files, none yet, none at all, a cut description; Claude loads no skill files', async () => {
    const host = buildHost()
    const lead = await open(host, 'codex', 'lead')
    const list = (commands: unknown[]): void =>
      store.append(
        lead,
        store.nextOrdinal(lead),
        {
          type: 'provider_commands',
          commands,
          prefix: '$',
          source: 'skills/list',
        } as unknown as TranscriptEvent,
        Date.now(),
      )
    expect((await host.whatThisAgentWasGiven(lead)).skills).toEqual({
      listed: null,
      at: null,
      dropped: null,
      why: 'not-listed-yet',
    })

    // ⚑ A fictional skill, with its file, and one whose description reached the cap.
    const long = `${'x'.repeat(MAX_COMMAND_TEXT - 1)}…`
    expect(long.length).toBe(MAX_COMMAND_TEXT)
    list([
      {
        name: 'brew-tea',
        description: 'Brew a pot of tea',
        skill: {
          path: '/fictional/skills/brew-tea/SKILL.md',
          scope: 'user',
          description: 'Use when someone asks for tea.',
        },
      },
      {
        name: 'steep',
        skill: { path: '/fictional/skills/steep/SKILL.md', scope: 'repo', description: long },
      },
    ])
    const row = store
      .events(lead)
      .filter((entry) => entry.event.type === 'provider_commands')
      .at(-1)
    const read = await host.whatThisAgentWasGiven(lead)
    expect(read.skills).toEqual({
      listed: [
        {
          name: 'brew-tea',
          description: 'Use when someone asks for tea.',
          descriptionMayBeCut: false,
          path: '/fictional/skills/brew-tea/SKILL.md',
          scope: 'user',
        },
        {
          name: 'steep',
          description: long,
          descriptionMayBeCut: true,
          path: '/fictional/skills/steep/SKILL.md',
          scope: 'repo',
        },
      ],
      at: row?.at,
      dropped: 0,
      why: null,
    })

    // ⚑ The provider listed none: an empty list, which is not "not listed".
    list([])
    expect((await host.whatThisAgentWasGiven(lead)).skills?.listed).toEqual([])

    // ⛔ A list past the cap, through the real bound: what it could not carry is counted.
    const many = Array.from({ length: MAX_PROVIDER_COMMANDS + 7 }, (_, at) => ({
      name: `skill-${String(at)}`,
      description: 'Fictional.',
      path: `/fictional/skills/skill-${String(at)}/SKILL.md`,
      scope: 'user',
      enabled: true,
    }))
    const { commands, dropped } = boundCommands(many.map(readCodexSkill))
    store.append(
      lead,
      store.nextOrdinal(lead),
      { type: 'provider_commands', commands, prefix: '$', dropped, source: 'skills/list' },
      Date.now(),
    )
    const capped = (await host.whatThisAgentWasGiven(lead)).skills
    expect(capped?.listed).toHaveLength(MAX_PROVIDER_COMMANDS)
    expect(capped?.dropped).toBe(7)
    expect(capped?.listed?.[0]?.path).toBe('/fictional/skills/skill-0/SKILL.md')

    // ⛔ A list from before the newest launch is not this launch's.
    store.append(lead, store.nextOrdinal(lead), { type: 'launched' }, Date.now())
    expect((await host.whatThisAgentWasGiven(lead)).skills?.why).toBe('not-listed-yet')

    // ⛔ Claude: no settings sources, so no skill files; its own skills are in the first message.
    const claude = await open(host, 'claude', 'other')
    expect((await host.whatThisAgentWasGiven(claude)).skills).toEqual({
      listed: null,
      at: null,
      dropped: null,
      why: 'no-skill-files',
    })
  })

  it('⚑ BroBot’s tool names as the provider itself listed them, and when; none on Codex', async () => {
    const host = buildHost()
    const lead = await open(host, 'claude', 'lead')
    expect((await host.whatThisAgentWasGiven(lead)).tools.listedByTheProvider).toBeNull()
    const ours = agentToolsFor(host, lead).tools.map((one) => `mcp__brobot__${one.name}`)
    const handle = runtimes.find((one) => one.provider === 'claude')?.issued.at(-1)
    if (handle === undefined) throw new Error('no Claude handle was issued')
    handle.simulateToolInventory({
      published: {
        tools: ['ToolSearch', 'Bash', ...ours, 'mcp__gmail__send_email'],
        servers: [{ name: 'brobot', status: 'connected' }],
      },
    })
    await waitFor(() => ledger(lead).some((event) => event.type === 'tool_inventory'), 'the list')
    const row = store.events(lead).find((entry) => entry.event.type === 'tool_inventory')
    const read = await host.whatThisAgentWasGiven(lead)
    expect(read.tools.listedByTheProvider).toEqual({ names: ours, at: row?.at })

    const worker = await open(host, 'codex', 'worker')
    expect((await host.whatThisAgentWasGiven(worker)).tools.listedByTheProvider).toBeNull()
  })

  it('⛔ a repository’s own file is kept by fingerprint only, read now, and said to have changed when it has', async () => {
    writeFileSync(join(project, 'CLAUDE.md'), 'Repository rule: tabs, never spaces.\n')
    const host = buildHost()
    const lead = await open(host, 'claude', 'lead')
    const given = launchesOf(lead)[0]?.given
    const kept = given?.files.find((one) => one.path === join(project, 'CLAUDE.md'))
    expect(kept?.sha256).toMatch(/^[0-9a-f]{64}$/)
    expect(kept?.text).toBeUndefined()
    expect(JSON.stringify(given)).not.toContain('Repository rule')

    const before = await host.whatThisAgentWasGiven(lead)
    const file = before.files.find((one) => one.path === join(project, 'CLAUDE.md'))
    expect(file).toMatchObject({
      origin: 'a-repository',
      madeAutomatically: false,
      textIs: 'read-now',
      changedSinceLaunch: false,
    })
    expect(file?.text).toContain('Repository rule')

    writeFileSync(join(project, 'CLAUDE.md'), 'Repository rule: spaces now.\n')
    const after = await host.whatThisAgentWasGiven(lead)
    expect(
      after.files.find((one) => one.path === join(project, 'CLAUDE.md'))?.changedSinceLaunch,
    ).toBe(true)
  })

  it('🔴 a repository that fills the instruction budget gives way: BroBot’s own rules still reach a Claude agent, and the read says they were sent, from BroBot', async () => {
    // ⚑ Forty nested folders, each with both `CLAUDE.md` spellings, about 290 KB against the
    // 256 KiB budget — in pieces small enough that whatever the chain leaves is smaller than
    // BroBot's own rules file, so a budget spent on the chain first would cut that file.
    const level = `${'Repository rule. '.repeat(212)}\n`
    let deep = project
    for (let at = 0; at < 40; at++) {
      deep = join(deep, `d${String(at)}`)
      mkdirSync(join(deep, '.claude'), { recursive: true })
      writeFileSync(join(deep, 'CLAUDE.md'), level)
      writeFileSync(join(deep, '.claude', 'CLAUDE.md'), level)
    }
    const host = buildHost()
    const { sessionId: lead } = await host.createSession(
      { provider: 'claude', profileId: 'lead', approvalMode: 'auto', cwd: deep },
      window,
    )

    // ⛔ BroBot's rules were sent, whole.
    const given = launchesOf(lead)[0]?.given
    expect(given?.profileFile?.refused).toBeNull()
    expect(given?.profileFile?.text).toContain('## How you work')
    // ⚑ The premise: the chain really did not fit — some of its files were left out, and the
    // nearest are among those sent.
    const sent = new Set(given?.files.map((one) => one.path))
    expect(sent.size).toBeGreaterThan(0)
    expect(sent.size).toBeLessThan(80)
    expect(sent.has(join(deep, 'CLAUDE.md'))).toBe(true)
    expect(sent.has(join(project, 'd0', 'CLAUDE.md'))).toBe(false)

    // ⚑ The read says where they come from and how they were made, unchanged: BroBot's file, made
    // automatically, as launched, sent, with its sections.
    const read = await host.whatThisAgentWasGiven(lead)
    const [profile] = read.files
    expect(profile).toMatchObject({
      kind: 'profile-instructions',
      origin: 'brobot',
      madeAutomatically: true,
      textIs: 'as-launched',
      refused: null,
    })
    expect(profile?.sections.map((one) => one.heading)).toContain('How you work')
    expect(read.size.brobot.characters).toBeGreaterThan(profile?.size.characters ?? 0)
  })

  it('⚑ what every request carries adds up to the total: on Claude with its tool search, BroBot’s tools and other servers’ by name; on Codex, BroBot’s in full', async () => {
    /** ⚑ The parts the total is the sum of — each known one, exactly once. */
    const theParts = (size: WhatThisAgentWasGiven['size']): PartSize[] =>
      [
        size.brobot,
        size.otherFiles,
        size.toolsInEveryRequest,
        size.otherServersToolsInEveryRequest,
        size.memoryInEveryRequest,
        size.provider,
      ].filter((one): one is PartSize => one !== null && one !== undefined)
    const host = buildHost()
    const lead = await open(host, 'claude', 'lead')

    // ⚑ Before Claude has said how it hands the tools over, they are counted in full.
    const before = (await host.whatThisAgentWasGiven(lead)).size
    expect(before.toolsInEveryRequest).toEqual(before.tools)
    expect(sizesAdded(theParts(before))).toEqual(before.total)

    // ⚑ Claude publishes its tool search, BroBot's tools and two other servers' tools.
    const others = [
      'mcp__gmail__send_email',
      'mcp__gmail__search_emails',
      'mcp__web-search-serpapi__search',
    ]
    const handle = runtimes.find((one) => one.provider === 'claude')?.issued.at(-1)
    if (handle === undefined) throw new Error('no Claude handle was issued')
    handle.simulateToolInventory({
      published: {
        tools: [
          'ToolSearch',
          'Bash',
          ...agentToolsFor(host, lead).tools.map((one) => `mcp__brobot__${one.name}`),
          ...others,
        ],
        servers: [
          { name: 'brobot', status: 'connected' },
          { name: 'gmail', status: 'connected' },
          { name: 'web-search-serpapi', status: 'connected' },
        ],
      },
    })
    await waitFor(() => ledger(lead).some((event) => event.type === 'tool_inventory'), 'the list')
    const claude = await host.whatThisAgentWasGiven(lead)
    expect(claude.tools.deferral.kind).toBe('names-until-loaded')
    // ⛔ BroBot's tools by name, as every request carries them — never their full definitions.
    expect(claude.size.toolsInEveryRequest).toEqual(
      sizeOf(claude.tools.list.map((one) => `mcp__${claude.tools.server}__${one.name}`).join('\n')),
    )
    expect(claude.size.toolsInEveryRequest?.characters).toBeLessThan(claude.size.tools.characters)
    // ⚑ Other servers' tools by name, apart from BroBot's.
    expect(claude.size.otherServersToolsInEveryRequest).toEqual(sizeOf(others.join('\n')))
    expect(claude.size.otherServersToolsWhy).toBeNull()
    expect(claude.size.provider, 'the premise: the snapshot is counted too').not.toBeNull()
    expect(sizesAdded(theParts(claude.size))).toEqual(claude.size.total)

    // ⚑ Codex: BroBot's tools in full in every request; other servers' tools found by search.
    const worker = await open(host, 'codex', 'worker')
    const codex = await host.whatThisAgentWasGiven(worker)
    expect(codex.tools.deferral.kind).toBe('in-every-request')
    expect(codex.size.toolsInEveryRequest).toEqual(codex.size.tools)
    expect(codex.size.otherServersToolsInEveryRequest).toEqual(sizesAdded([]))
    expect(sizesAdded(theParts(codex.size))).toEqual(codex.size.total)
  })

  it('⛔ a conversation this app holds no record of is refused, and nothing is read', async () => {
    const host = buildHost()
    await expect(host.whatThisAgentWasGiven('sess_nobody')).rejects.toThrow(/no record/)
  })

  it('⚑ memory pages past the twenty a launch lists, with the total and where the next page starts', async () => {
    seedClaudeMemory('lead', 25)
    const host = buildHost()
    const first = host.agentMemoryPage('lead', 0, 20)
    const claude = first.stores.find((one) => one.provider === 'claude')
    expect(claude?.total).toBe(26)
    expect(claude?.entries).toHaveLength(21)
    expect(claude?.nextOffset).toBe(20)
    const second = host.agentMemoryPage('lead', 20, 20)
    const rest = second.stores.find((one) => one.provider === 'claude')
    expect(rest?.entries.map((one) => basename(one.path))).toEqual([
      'topic-20.md',
      'topic-21.md',
      'topic-22.md',
      'topic-23.md',
      'topic-24.md',
    ])
    expect(rest?.nextOffset).toBeNull()
    // Main resolves managed entries from every page again before changing them.
    expect(claude?.entries.every((one) => one.amendable)).toBe(true)
    expect(rest?.entries.every((one) => one.amendable)).toBe(true)
  })

  it('⚑ the latest context reading rides on what is being done, and gives the read its share of the window', async () => {
    const host = buildHost()
    const lead = await open(host, 'codex', 'lead')
    const atWork = host.whatIsBeingDone().conversations.find((one) => one.conversation === lead)
    expect(atWork?.context).toBeNull()
    const handle = runtimes.at(-1)?.issued.at(-1)
    if (handle === undefined) throw new Error('no handle was issued')
    handle.simulateContextReading({ kind: 'proportional', used: 10_000, window: 200_000 })
    await waitFor(
      () =>
        host.whatIsBeingDone().conversations.find((one) => one.conversation === lead)?.context !==
        null,
      'the reading',
    )
    expect(
      host.whatIsBeingDone().conversations.find((one) => one.conversation === lead)?.context,
    ).toEqual({ kind: 'proportional', used: 10_000, window: 200_000 })
    const read = await host.whatThisAgentWasGiven(lead)
    expect(read.size.contextWindow?.tokens).toBe(200_000)
    expect(read.size.contextWindow?.share).toBeCloseTo(read.size.total.tokens / 200_000)
  })

  // ── C9 d · one message as the model got it ──

  /** The ledger place of each message the conversation handed over, oldest first. */
  const messagesAt = (sessionId: string): number[] =>
    store
      .events(sessionId)
      .filter((entry) => entry.event.type === 'user_turn')
      .map((entry) => entry.ordinal)

  /** ⚑ R1's own answer when the provider's file is gone and the app kept no copy of it. */
  const R1_GONE = {
    found: false,
    why: 'The provider’s own record of this message is gone, and the app kept no copy of it.',
  }

  it('⚑ C9 d · a Claude message as the model got it: BroBot’s instructions, files and this conversation in the system prompt, then the message as handed over', async () => {
    const host = buildHost()
    const lead = await open(host, 'claude', 'lead', true)
    await host.send(lead, 'please plan the next release', window)
    await waitFor(() => turnsOf(lead).length > 0, 'the turn')
    const [at] = messagesAt(lead)
    if (at === undefined) throw new Error('no message was recorded')
    const got = await host.whatTheModelGot(lead, at)

    expect(got).toMatchObject({
      sessionId: lead,
      provider: 'claude',
      ordinal: at,
      words: ['please plan the next release'],
      firstOfItsLaunch: true,
      providersRecord: R1_GONE,
      providerKeptTheSameText: null,
    })
    expect(got.launch?.recorded).toBe(true)
    // ⚑ Everything BroBot appends sits in the system prompt, in front of the message.
    const wheres = got.parts.map((one) => one.where)
    expect(wheres.at(-1)).toBe('this-message')
    expect(wheres.slice(0, -1).every((one) => one === 'system-prompt')).toBe(true)
    const [profile] = got.parts
    expect(profile).toMatchObject({ kind: 'profile-instructions', origin: 'brobot', why: null })
    expect(profile?.text).toContain('## How you work')
    expect(got.parts.some((one) => one.kind === 'workspace-instructions')).toBe(false)
    const given = launchesOf(lead)[0]?.given
    const conversation = got.parts.find((one) => one.kind === 'this-conversation')
    expect(conversation?.text).toBe(conversationBlock(given?.thisConversation?.text ?? ''))
    // ⛔ The message exactly as handed over — every frame line, then the words.
    const message = got.parts.at(-1)
    const sent = turnsOf(lead)[0]?.sent
    expect(message).toMatchObject({ kind: 'the-message', origin: 'a-person', text: sent })
    expect(message?.size?.characters).toBe(sent?.length)

    // ⚑ The next message is not the first of its launch; any later row answers for the message
    // handed over at or before it.
    await host.send(lead, 'and the one after it', window)
    await waitFor(() => turnsOf(lead).length > 1, 'the second turn')
    const second = messagesAt(lead)[1]
    if (second === undefined) throw new Error('no second message was recorded')
    expect((await host.whatTheModelGot(lead, second)).firstOfItsLaunch).toBe(false)
    const last = store.events(lead).at(-1)?.ordinal ?? second
    expect((await host.whatTheModelGot(lead, last)).ordinal).toBe(second)
  })

  it('⚑ C9 d · joined with the provider’s own record (R1): the turn as Claude Code kept it, read from a recorded transcript', async () => {
    // ⚑ The words the F093 map's scratch probe sent, so its recorded transcript holds this turn.
    const first = 'W4157-PERSON Please plan the next release.'
    const host = buildHost()
    const lead = await open(host, 'claude', 'lead')
    await host.send(lead, first, window)
    await waitFor(() => ledger(lead).some((event) => event.type === 'turn'), 'the turn to end')
    // ⚑ The probe's transcript, as this conversation's own record, in its own provider home.
    const recorded = readFileSync(
      join(here, 'fixtures', 'turn-as-sent', 'claude-transcript.jsonl'),
      'utf8',
    )
    const theirs = /"sessionId":"([^"]+)"/.exec(recorded)?.[1] ?? '\u0000'
    // ⚑ The probe's turn was recorded before this app added a block at a turn's end: the record
    // is given the block this turn carried, as Claude Code would have kept it.
    const handed =
      ledger(lead).flatMap((event) => (event.type === 'user_turn' ? [event.sent ?? ''] : []))[0] ??
      ''
    const asRecorded = JSON.stringify(withoutWhatThisAppAdds(handed)).slice(1, -1)
    expect(recorded).toContain(asRecorded)
    const withItsBlock = recorded.split(asRecorded).join(JSON.stringify(handed).slice(1, -1))
    nativeFile = join(homeOf('claude', 'lead'), 'projects', 'p', 'transcript.jsonl')
    mkdirSync(dirname(nativeFile), { recursive: true })
    writeFileSync(
      nativeFile,
      withItsBlock.split(theirs).join(store.find(lead)?.ref.sessionId ?? ''),
    )
    const [at] = messagesAt(lead)
    if (at === undefined) throw new Error('no message was recorded')

    const got = await host.whatTheModelGot(lead, at)
    const record = got.providersRecord
    if (!record.found) throw new Error(`R1 found no turn: ${record.why}`)
    expect(withoutWhatThisAppAdds(record.message).endsWith(first)).toBe(true)
    // ⚑ What Claude Code added beside the message, in the order the model got it.
    expect(record.parts.some((one) => one.author === 'the-provider')).toBe(true)
    expect(record.parts.some((one) => one.author === 'the-message')).toBe(true)
    // ⚑ The provider kept exactly the text BroBot kept as handed over, and the answer says so.
    expect(got.parts.at(-1)?.text).toBe(turnsOf(lead)[0]?.sent)
    expect(got.providerKeptTheSameText).toBe(true)
    // ⚑ Asked at the reply's place, the read answers for the message, and R1 reads that message.
    const reply = store.events(lead).find((entry) => entry.event.type === 'turn')?.ordinal
    if (reply === undefined) throw new Error('no turn row was recorded')
    const atTheReply = await host.whatTheModelGot(lead, reply)
    expect(atTheReply.ordinal).toBe(at)
    expect(atTheReply.providersRecord.found && atTheReply.providersRecord.message).toBe(
      record.message,
    )
  })

  it('⚑ C9 d · whether the provider kept the same text as BroBot handed over: yes, no, or not known', () => {
    const sent = 'Sent by a person, typed into this app.\n\nhello'
    const event: UserTurnEvent = { type: 'user_turn', text: 'hello', sent }
    const kept = (message: string): TurnAsSent => ({
      found: true,
      provider: 'claude',
      version: null,
      whole: true,
      message,
      parts: [],
      standing: [],
      leavesOut: ['the-system-prompt', 'after-its-first-answer'],
      records: [],
    })
    const sameText = (providersRecord: TurnAsSent, of: UserTurnEvent = event): boolean | null =>
      oneMessageAsTheModelGotIt({
        sessionId: 'sess_x',
        provider: 'claude',
        message: { ordinal: 3, at: 1, event: of },
        launch: null,
        firstOfItsLaunch: null,
        earlierInThisLaunch: () => [],
        leadsInThisThread: null,
        providersRecord,
      }).providerKeptTheSameText
    expect(sameText(kept(sent))).toBe(true)
    expect(sameText(kept(`${sent}.`))).toBe(false)
    expect(sameText({ found: false, why: 'The provider’s own record is gone.' })).toBeNull()
    // ⚑ Not known: no text kept, or a message that carried a file.
    expect(sameText(kept(sent), { type: 'user_turn', text: 'hello' })).toBeNull()
    expect(
      sameText(kept(sent), {
        ...event,
        attachments: [{ path: '/scratch/a.png', kind: 'file', outsideCwd: true }],
      }),
    ).toBeNull()
  })

  it('⚑ C9 d · Codex: its files in the first message, and this conversation’s lead split off the message it rode', async () => {
    const host = buildHost()
    const lead = await open(host, 'codex', 'lead')
    await host.send(lead, 'please plan the next release', window)
    await waitFor(() => turnsOf(lead).length > 0, 'the turn')
    const [first] = messagesAt(lead)
    if (first === undefined) throw new Error('no message was recorded')
    const got = await host.whatTheModelGot(lead, first)
    const block = conversationBlock(launchesOf(lead)[0]?.given?.thisConversation?.text ?? '')

    expect(got.parts[0]).toMatchObject({ where: 'first-message', kind: 'profile-instructions' })
    expect(got.parts[0]?.text).toContain('## How you work')
    const [lead1, message1] = got.parts.slice(-2)
    expect(lead1).toMatchObject({ where: 'this-message', kind: 'this-conversation', text: block })
    expect(message1).toMatchObject({ where: 'this-message', kind: 'the-message' })
    // ⛔ Split exactly: the lead, a blank line, the message — the whole text handed over.
    expect(`${lead1?.text ?? ''}\n\n${message1?.text ?? ''}`).toBe(turnsOf(lead)[0]?.sent)

    await host.send(lead, 'and the one after it', window)
    await waitFor(() => turnsOf(lead).length > 1, 'the second turn')
    const second = messagesAt(lead)[1]
    if (second === undefined) throw new Error('no second message was recorded')
    const next = await host.whatTheModelGot(lead, second)
    // ⚑ Past the first message, the lead is named where it rode: in front of the launch's first.
    expect(next.parts.find((one) => one.kind === 'this-conversation')).toMatchObject({
      where: 'first-message',
      text: block,
    })
    expect(next.parts.at(-1)?.text).toBe(turnsOf(lead)[1]?.sent)

    // ⚑ A compaction owes the lead again: it rides the next message, and the one after names it
    // where it last rode — an earlier message of this launch, not its first.
    const handle = runtimes.at(-1)?.issued.at(-1)
    if (handle === undefined) throw new Error('no handle was issued')
    handle.simulateCompaction()
    await waitFor(() => ledger(lead).some((event) => event.type === 'compaction'), 'the compaction')
    await host.send(lead, 'after the compaction', window)
    await waitFor(() => turnsOf(lead).length > 2, 'the third turn')
    const third = messagesAt(lead)[2]
    if (third === undefined) throw new Error('no third message was recorded')
    expect(
      (await host.whatTheModelGot(lead, third)).parts.find(
        (one) => one.kind === 'this-conversation',
      ),
    ).toMatchObject({ where: 'this-message', text: block })
    await host.send(lead, 'and one more', window)
    await waitFor(() => turnsOf(lead).length > 3, 'the fourth turn')
    const fourth = messagesAt(lead)[3]
    if (fourth === undefined) throw new Error('no fourth message was recorded')
    expect(
      (await host.whatTheModelGot(lead, fourth)).parts.find(
        (one) => one.kind === 'this-conversation',
      ),
    ).toMatchObject({ where: 'an-earlier-message', text: block })
  })

  it('⚑ C9 d · a message names the launch it was handed over in: across a close and a reopen, the thread holds the first lead and the reopen sends only what changed', async () => {
    const host = buildHost()
    const lead = await open(host, 'codex', 'lead')
    await host.send(lead, 'in the first life', window)
    await waitFor(() => turnsOf(lead).length > 0, 'the first turn')
    await host.close(lead, window)
    await host.resumeSession(lead, window)
    await host.send(lead, 'in the second life', window)
    await waitFor(() => turnsOf(lead).length > 1, 'the second turn')

    const launches = store
      .events(lead)
      .filter((entry) => entry.event.type === 'launched')
      .map((entry) => entry.ordinal)
    expect(launches).toHaveLength(2)
    const [inTheFirst, inTheSecond] = messagesAt(lead)
    if (inTheFirst === undefined || inTheSecond === undefined) throw new Error('no messages')
    const first = await host.whatTheModelGot(lead, inTheFirst)
    const second = await host.whatTheModelGot(lead, inTheSecond)
    expect(first.launch?.ordinal).toBe(launches[0])
    expect(second.launch?.ordinal).toBe(launches[1])
    expect([first.firstOfItsLaunch, second.firstOfItsLaunch]).toEqual([true, true])
    const about = (got: typeof first) => got.parts.filter((one) => one.kind === 'this-conversation')
    expect(about(first)).toMatchObject([
      {
        where: 'this-message',
        title: 'What is true of this conversation, in front of this message',
      },
    ])
    // ⚑ **W4.179 — the thread already holds the first life's lead**: the second message shows it where
    // it rode, and — when the reopen's text changed — the sections it sent again, in front of itself.
    const whole = about(first)[0]?.text
    const secondRow = store.events(lead).find((entry) => entry.ordinal === inTheSecond)?.event
    const sentAgain = secondRow?.type === 'user_turn' ? secondRow.lead : undefined
    expect(about(second)[0]).toMatchObject({
      where: 'an-earlier-message',
      title: 'What is true of this conversation, in front of a message of an earlier launch',
      text: whole,
    })
    if (sentAgain === undefined) expect(about(second)).toHaveLength(1)
    else {
      expect(sentAgain.is).toBe('what-changed')
      expect(about(second)[1]).toMatchObject({
        where: 'this-message',
        title: 'What changed in it since, in front of this message',
      })
      expect(about(second)[1]?.text?.startsWith(`${WHAT_CHANGED_HEADER}\n\n`)).toBe(true)
    }
  })

  it('⚑ C9 d · the store’s newest row of a type, before a place: a launch, a message, a tool list', async () => {
    const host = buildHost()
    const lead = await open(host, 'claude', 'lead')
    await host.send(lead, 'one', window)
    await waitFor(() => turnsOf(lead).length > 0, 'the first turn')
    await host.send(lead, 'two', window)
    await waitFor(() => turnsOf(lead).length > 1, 'the second turn')
    const handle = runtimes.at(-1)?.issued.at(-1)
    if (handle === undefined) throw new Error('no handle was issued')
    handle.simulateToolInventory()
    handle.simulateToolInventory()
    const ofType = (type: TranscriptEvent['type']): number[] =>
      store
        .events(lead)
        .filter((entry) => entry.event.type === type)
        .map((entry) => entry.ordinal)
    await waitFor(() => ofType('tool_inventory').length > 1, 'the tool lists')

    for (const type of ['user_turn', 'tool_inventory'] as const) {
      const [older, newer] = ofType(type).slice(-2)
      expect(store.newestOfType?.(lead, type)?.ordinal, type).toBe(newer)
      expect(store.newestOfType?.(lead, type, newer)?.ordinal, type).toBe(older)
    }
    const [launched] = ofType('launched')
    expect(store.newestOfType?.(lead, 'launched')?.ordinal).toBe(launched)
    expect(store.newestOfType?.(lead, 'launched', launched)).toBeNull()
  })

  it('⚑ C9 d · a launch that kept no record says so for each part it cannot give', async () => {
    // ⚑ A launch with no instruction reader keeps no record — as every launch did before F093.
    const bare = buildHost(false)
    const elder = await open(bare, 'claude', 'elder')
    await bare.send(elder, 'an older message', window)
    await waitFor(() => turnsOf(elder).length > 0, 'the turn')
    const [at] = messagesAt(elder)
    if (at === undefined) throw new Error('no message was recorded')
    const got = await bare.whatTheModelGot(elder, at)
    expect(got.launch?.recorded).toBe(false)
    const unrecorded =
      'This message’s launch kept no record of what it gave: it was made before this app kept one, or keeping it failed.'
    expect(got.parts.slice(0, 2)).toMatchObject([
      { kind: 'profile-instructions', text: null, size: null, why: unrecorded },
      { kind: 'this-conversation', text: null, size: null, why: unrecorded },
    ])
    expect(got.parts.at(-1)?.text).toBe(turnsOf(elder)[0]?.sent)
  })

  it('⛔ C9 d · both reads are a person’s doors: refused on a channel with no person behind it, answered on a window', async () => {
    const host = buildHost()
    const lead = await open(host, 'claude', 'lead')
    await host.send(lead, 'please plan the next release', window)
    await waitFor(() => turnsOf(lead).length > 0, 'the turn')
    const [at] = messagesAt(lead)
    if (at === undefined) throw new Error('no message was recorded')
    const asks = [
      { kind: 'whatTheModelGot', sessionId: lead, ordinal: at },
      { kind: 'whatThisAgentWasGiven', sessionId: lead },
    ]
    for (const ask of asks) {
      await expect(
        executeRuntimeCommand(host, new NobodysSink('owner:nobody'), ask),
        ask.kind,
      ).rejects.toThrow(/unless a person is asking/)
      await expect(executeRuntimeCommand(host, window, ask), ask.kind).resolves.toMatchObject({
        sessionId: lead,
      })
    }
  })

  it('⛔ C9 d · refused, in plain words: a conversation not held, a place with no row, and a place before any message', async () => {
    const host = buildHost()
    await expect(host.whatTheModelGot('sess_nobody', 0)).rejects.toThrow(/no record/)
    const lead = await open(host, 'claude', 'lead')
    await expect(host.whatTheModelGot(lead, 999_999)).rejects.toThrow(
      'There is no row at that place in this conversation’s record.',
    )
    const firstRow = store.events(lead)[0]?.ordinal ?? 0
    await expect(host.whatTheModelGot(lead, firstRow)).rejects.toThrow(
      'No message was handed to the model at or before that place.',
    )
  })
})
