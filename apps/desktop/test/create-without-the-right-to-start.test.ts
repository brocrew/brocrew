import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  FakeProviderSessions,
  FakeRuntime,
  type AgentToolset,
  type StartOptions,
} from '@brobot2/runtime'
import type { Provider } from '@brobot2/shared'
import { type AppDatabase, openDatabase } from '../src/main/db/connection'
import { applyMigrations } from '../src/main/db/migrate'
import { createSessionStore, type SessionStore } from '../src/main/db/session-store'
import { NO_DISCOVERY } from '../src/main/adopt/discover-sessions'
import { RuntimeHost, type RuntimeEventSink } from '../src/main/runtime/runtime-host'
import {
  composeProfileBundle,
  thisConversationSpans,
  type InstructionContext,
} from '../src/main/runtime/factory-text'
import { resolveSessionCwd } from '../src/main/runtime/scratch-cwd'
import {
  DEFAULT_PROFILE_ID,
  type RuntimeEventMessage,
  type SessionInstructions,
} from '../src/shared/runtime-ipc'

const here = dirname(fileURLToPath(import.meta.url))
const migrationsFolder = join(here, '../src/main/db/migrations')

const NOTHING_INJECTED: SessionInstructions = {
  injected: [],
  agentMemory: [],
  provider: [],
  refused: [],
  note: '',
  recallsReported: false,
  writesReported: true,
  composed: null,
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

class WatchingRuntime extends FakeRuntime {
  constructor(
    provider: Provider,
    private readonly handed: AgentToolset[],
    sessions: FakeProviderSessions,
  ) {
    super(provider, { sessions })
  }
  override async start(options: StartOptions): ReturnType<FakeRuntime['start']> {
    const handle = await super.start(options)
    if (options.agentTools) this.handed.push(options.agentTools)
    return handle
  }
}

/** ⚑ A name nobody has created yet, so a `create_agent` of it can only fail on the grant. */
const A_NEW_NAME = 'nadia'

/**
 * 🔴 **573 · the grants a conversation is told are a photograph, and the checks are live** (HO-068
 * §2).
 *
 * ⛔ **BroBot read *"the grants were read when this conversation started"* as covering the rails
 * too**, retried, met the identical refusal, and could not tell *not saved yet* from *saved and not
 * visible to me*. ⚑ The instruction bundle is composed once per launch; every refusal rail reads the
 * row at the moment it refuses. This file drives both in one conversation and pins the sentence
 * that tells a model which is which.
 */
describe('573 · the grant prose scopes its own claim', () => {
  let userData: string
  let work: string
  let db: AppDatabase
  let store: SessionStore
  let host: RuntimeHost
  let sessions: FakeProviderSessions
  let handed: AgentToolset[]
  let seen: InstructionContext[]
  let counter: number
  let window: Sink
  let clock: number
  const tick = (): number => clock++

  const buildHost = (): RuntimeHost =>
    new RuntimeHost({
      store,
      discoverSessions: NO_DISCOVERY,
      nativeTranscriptPath: () => null,
      exportDirectory: () => join(userData, 'exports'),
      createRuntime: (provider: Provider) => new WatchingRuntime(provider, handed, sessions),
      prepareProviderHome: (provider: Provider, profileId?: string) => {
        const home = join(userData, 'provider-homes', profileId ?? 'default', provider)
        mkdirSync(home, { recursive: true })
        return home
      },
      providerHomePath: (provider: Provider) => join(userData, 'provider-homes', provider),
      resolveCwd: (sessionId, requested) => resolveSessionCwd(userData, sessionId, requested),
      newSessionId: () => `sess_${++counter}`,
      now: tick,
      readProviderConfig: (provider, home) => ({
        home,
        homeEnv: 'CLAUDE_CONFIG_DIR',
        model: 'm',
        authNote: null,
        files: [],
      }),
      // ⚑ **The context is CAPTURED rather than composed here**, so a test can compose the same
      // text the launch would have sent and compare it against a row that moved afterwards.
      // ⚑ D-024 · R1 · the grants are in this conversation's own text (`thisConversationSpans`),
      // not in the bundle the launch publishes.
      readInstructions: (_provider, _cwd, _home, context) => {
        seen.push(context)
        return { instructions: NOTHING_INJECTED, systemHint: undefined, memoryLoaded: null }
      },
    })

  beforeEach(() => {
    userData = mkdtempSync(join(tmpdir(), 'brobot2-573-'))
    work = mkdtempSync(join(tmpdir(), 'brobot2-573-work-'))
    db = openDatabase(join(userData, 'brobot2.sqlite'))
    applyMigrations(db, migrationsFolder)
    clock = 5_000_000
    store = createSessionStore(db, tick)
    counter = 0
    handed = []
    seen = []
    sessions = new FakeProviderSessions()
    host = buildHost()
    window = new Sink('webContents:1')
  })

  afterEach(async () => {
    await host.closeAll()
    db.close()
    rmSync(userData, { recursive: true, force: true })
    rmSync(work, { recursive: true, force: true })
  })

  /** ⚑ The toolset a model on BroBot's own conversation is handed. */
  const brobotsTools = async (): Promise<AgentToolset> => {
    await host.createSession(
      { provider: 'codex', profileId: DEFAULT_PROFILE_ID, cwd: work, approvalMode: 'ask' },
      window,
    )
    const one = handed.at(-1)
    if (one === undefined) throw new Error('no launch was handed a toolset')
    return one
  }

  const callOn = async (
    toolset: AgentToolset,
    name: string,
    args: Record<string, unknown>,
  ): Promise<Record<string, unknown>> => {
    const one = toolset.tools.find((tool) => tool.name === name)
    if (one === undefined) throw new Error(`no such tool: ${name}`)
    return (await one.call(args)).structured as Record<string, unknown>
  }

  /**
   * 🔴 **`574` measured the surfaces and BroBot's guess was wrong.** ⛔ It reasoned that *"widening
   * the grant may not reach this conversation until BroBot is relaunched"*; the rail is LIVE, so the
   * widened grant was already in force and the only stale thing was the prose. ⚑ **This arm drives
   * the rail, the door and the snapshot in one conversation, in the direction HO-068 is about.**
   */
  it('🔴 a grant WIDENED mid-conversation reaches the rail and the door, and not the snapshot', async () => {
    // ⛔ **Start from the narrowed state**, so the widening below is a real change of answer.
    // ⚠️ A first launch is what mints the row a person can then narrow; the SECOND launch is the
    // conversation this arm is about, and its snapshot is composed from the narrowed row.
    await brobotsTools()
    expect(store.setCapabilities(DEFAULT_PROFILE_ID, { canCreateAgents: 'none' })).toBe(true)
    const tools = await brobotsTools()
    const context = seen.at(-1)
    if (context === undefined) throw new Error('no instruction context was composed')
    // ⚑ D-024 · R1 · the photograph is this conversation's own text, composed for its launch.
    const snapshot = thisConversationSpans(context).text
    expect(snapshot).toContain('- You may not create agents.')

    expect(
      (await callOn(tools, 'create_agent', { profile_slug: A_NEW_NAME }))['rail'],
      'the premise — the narrowed grant refuses',
    ).toBe('may-not-create-agents')

    // 🔴 **A person widens it while the conversation is running.**
    expect(store.setCapabilities(DEFAULT_PROFILE_ID, { canCreateAgents: 'any' })).toBe(true)

    // ⚑ **The rail is LIVE** — the very next call is admitted, with no relaunch.
    const created = await callOn(tools, 'create_agent', { profile_slug: A_NEW_NAME })
    expect(created['outcome']).toBe('ok')

    // ⚑ **`list_profiles` is LIVE** — it names the agent that did not exist when this list was
    // taken.
    const said = await callOn(tools, 'list_profiles', {})
    expect(
      (said['profiles'] as { profile: string }[] | undefined)?.map((one) => one.profile),
    ).toContain(A_NEW_NAME)

    // ⛔ **And the snapshot is STILL the old one**, which is the fact the sentence now discloses
    // rather than the defect it was mistaken for. ⚠️ Re-composed from the context the launch was
    // given, so this measures the photograph rather than a string cached by this test.
    expect(thisConversationSpans(context).text).toBe(snapshot)
    expect(snapshot).not.toContain('- You may create agents and give them their initial rules.')
  })

  /**
   * ⛔ **Standing rule 5: assert the load-bearing clause BY NAME**, so it cannot drift out
   * silently. ⚠️ **The tail clause is pinned by `the-text-a-child-is-actually-told.test.ts` §3 and
   * §10 as well** — quoted here because the sentence around it was rewritten.
   */
  it('⚑ the preamble says WHICH thing is the photograph, when the next one is taken, and what is live', async () => {
    await brobotsTools()
    const context = seen.at(-1)
    if (context === undefined) throw new Error('no instruction context was composed')
    // 🔴 **D-024 · R1 — the grants left the profile's file**, which every launch of the profile
    // rewrites, for this conversation's own text: one of them is said for its depth.
    const said = thisConversationSpans(context).text
    expect(composeProfileBundle(context)).not.toContain('## What you may do')

    expect(said).toContain(
      "As of this launch, for BroCrew's agent tools (the tools always check the current rules):",
    )
    expect(said).not.toContain('This list is a photograph')
    expect(said).not.toContain('The checks are not a photograph')
    const heading = '## What you may do'
    const from = said.indexOf(heading) + heading.length
    const preamble = said.slice(from, said.indexOf('\n- ', from))
    expect(preamble.trim()).toBe(
      "As of this launch, for BroCrew's agent tools (the tools always check the current rules):",
    )
    expect(said.slice(from)).toContain('- You may message any conversation.')
    expect(said.slice(from)).toContain(
      '- You may give work to any agent, through your own conversation with it.',
    )
    expect(said.slice(from)).toContain('- You may create agents and give them their initial rules.')
    expect(said.slice(from)).toContain(
      "- You can read any agent's standing rules and propose a replacement; the person decides. " +
        'A BroBot conversation the person started may also save one directly, but never its own. ' +
        'Each version keeps its author and reason, and the person can undo it.',
    )
    expect(said.slice(from)).not.toContain(
      "- You may not change or propose other agents' standing rules.",
    )
    expect(said.slice(from)).not.toContain(
      "- You may propose rules for approval, or save a person's rule for another agent when they gave it in this conversation.",
    )
  })
})
