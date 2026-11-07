import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  AuthUnavailableError,
  CodexSettingsUnusableError,
  FakeLaunchGate,
  FakeProviderSessions,
  FakeRuntime,
} from '@brobot2/runtime'
import type { AgentToolAnswer } from '@brobot2/runtime'
import type { Provider } from '@brobot2/shared'
import { type AppDatabase, openDatabase } from '../src/main/db/connection'
import { applyMigrations } from '../src/main/db/migrate'
import { createSessionStore, type SessionStore } from '../src/main/db/session-store'
import { NO_DISCOVERY } from '../src/main/adopt/discover-sessions'
import { RuntimeHost } from '../src/main/runtime/runtime-host'
import type { RuntimeEventSink } from '../src/main/runtime/runtime-host'
import { agentToolsFor, type ToolName } from '../src/main/runtime/agent-tools'
import { SessionUnavailable, unavailableOf } from '../src/main/runtime/session-unavailable'
import { resolveSessionCwd } from '../src/main/runtime/scratch-cwd'
import { DEFAULT_PROFILE_ID, type RuntimeEventMessage } from '../src/shared/runtime-ipc'

/**
 * # 🔴 657 · a launch that did not start (`650` F2)
 *
 * ⛔ **`spawn_agent` THREW when an admitted launch failed**, and the model met a broken tool — the
 * adapter's `isError`, *"spawn_agent failed: …"* — with the host's raw text, which can carry a path
 * or an install instruction. ⚑ **D-016 · `give_work` is the door that starts a conversation now**,
 * and every section below asks it: a give whose launch failed is answered, and leaves no piece (R4). ⚑ The helper every tool runs under was named `guarded` and said
 * *"Everything below answers rather than throws"*; its body has been `run()` since the commit that
 * made it (`347`), so the brief's *"a pass-through AGAIN"* rests on a premise the history refutes.
 *
 * ⚑ **What `657` built instead is per tool, as the module note always meant**: the starting door
 * classifies the typed launch failures it knows into two words and rethrows the rest (`375`).
 *
 *  - §1 · a provider that is slow to answer is waited for: no deadline refuses the give.
 *  - §2 · a launch the app stopped before it started (D-017: `end_agent` is gone; it was a launch
 *    its parent ended) — `agent-did-not-start`: a decision, not a retry, and the sentence does not
 *    say a person has to act (the review of `657` found its first draft did, on exactly this arm).
 *  - §3 · a sign-in the machine does not have — `agent-did-not-start`, with a closed reason and
 *    none of the host's text, which goes to the host's log instead.
 *  - §4 · a failure this tool does not recognise still propagates.
 *  - §5 · the host keeps the class as `cause`, and the message a person reads is unchanged.
 */

const here = dirname(fileURLToPath(import.meta.url))
const migrationsFolder = join(here, '../src/main/db/migrations')

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

describe('657 · a launch that did not start', () => {
  let userData: string
  let work: string
  let db: AppDatabase
  let store: SessionStore
  let host: RuntimeHost
  let sessions: FakeProviderSessions
  let counter: number
  let clock: number
  let window: RecordingSink
  /** ⚑ Holds a launch inside `start` — installed for ONE launch, because it holds from creation. */
  let gate: FakeLaunchGate | null
  /** ⚑ What `prepareProviderHome` throws for the next launch, if anything. */
  let homeFails: Error | null
  const gatesMade: FakeLaunchGate[] = []

  const buildHost = (): RuntimeHost =>
    new RuntimeHost({
      store,
      discoverSessions: NO_DISCOVERY,
      nativeTranscriptPath: () => null,
      exportDirectory: () => join(userData, 'exports'),
      createRuntime: (provider: Provider) =>
        new FakeRuntime(provider, { sessions, ...(gate === null ? {} : { gate }) }),
      prepareProviderHome: (provider: Provider, profileId?: string) => {
        if (homeFails !== null) throw homeFails
        const home = join(userData, 'provider-homes', profileId ?? 'default', provider)
        mkdirSync(home, { recursive: true })
        return home
      },
      providerHomePath: (provider: Provider) => join(userData, 'provider-homes', provider),
      resolveCwd: (sessionId, requested) => resolveSessionCwd(userData, sessionId, requested),
      newSessionId: () => `sess_${++counter}`,
      now: () => clock++,
      readProviderConfig: (provider, home) => ({
        home,
        homeEnv: 'CLAUDE_CONFIG_DIR',
        model: 'm',
        authNote: null,
        files: [],
      }),
    })

  beforeEach(() => {
    userData = mkdtempSync(join(tmpdir(), 'brobot2-657-launch-'))
    work = mkdtempSync(join(tmpdir(), 'brobot2-657-launch-work-'))
    db = openDatabase(join(userData, 'brobot2.sqlite'))
    applyMigrations(db, migrationsFolder)
    clock = 7_000_000
    store = createSessionStore(db, () => clock++)
    counter = 0
    sessions = new FakeProviderSessions()
    gate = null
    homeFails = null
    host = buildHost()
    window = new RecordingSink('webContents:1')
  })

  afterEach(async () => {
    vi.restoreAllMocks()
    for (const made of gatesMade.splice(0)) made.release()
    await host.closeAll()
    db.close()
    rmSync(userData, { recursive: true, force: true })
    rmSync(work, { recursive: true, force: true })
  })

  const personOpens = async (profileId: string): Promise<string> =>
    (
      await host.createSession(
        { provider: 'claude', profileId, approvalMode: 'ask', cwd: work },
        window,
      )
    ).sessionId

  const toolsOf = (sessionId: string) => {
    const set = agentToolsFor(host, sessionId)
    return async (name: ToolName, args: Record<string, unknown>): Promise<AgentToolAnswer> => {
      const tool = set.tools.find((one) => one.name === name)
      if (tool === undefined) throw new Error(`no such tool: ${name}`)
      return tool.call(args)
    }
  }
  const payload = (answer: AgentToolAnswer): Record<string, unknown> =>
    answer.structured as Record<string, unknown>

  /** The giver's conversation — set by {@link aParentThatMaySpawn}. */
  let giver = ''

  /** ⚑ Every agent may give work to any agent this app holds — the one default set. */
  const aParentThatMaySpawn = async (): Promise<ReturnType<typeof toolsOf>> => {
    await host.close(await personOpens('worker'), window)
    giver = await personOpens(DEFAULT_PROFILE_ID)
    return toolsOf(giver)
  }

  /** ⚑ **D-016** — the give that starts a conversation: `worker` has none with this giver yet. */
  const A_GIVE = {
    definition_of_done: 'The requested result and its checks are recorded.',
    profile: 'worker',
    title: 'A first piece',
    brief: 'x',
  }

  /** ⛔ **R4 — the pieces written under the giver's root**: a give that did not arrive wrote none. */
  const piecesUnderTheRoot = (): readonly string[] =>
    store.childrenOf(store.rootOf(giver)?.piece ?? 'no root').map((one) => one.label)

  const holdTheNextLaunch = (): FakeLaunchGate => {
    const made = new FakeLaunchGate()
    gatesMade.push(made)
    gate = made
    return made
  }

  /** ⛔ Bounded, and it waits on the THING. */
  const until = async (check: () => boolean | Promise<boolean>, what: string): Promise<void> => {
    for (let n = 0; n < 400; n += 1) {
      if (await check()) return
      await new Promise((resolve) => setTimeout(resolve, 2))
    }
    throw new Error(`timed out waiting for ${what}`)
  }

  it('§1 a provider that is slow to answer is waited for, and the give lands once it answers', async () => {
    const call = await aParentThatMaySpawn()
    const held = holdTheNextLaunch()
    const giving = call('give_work', A_GIVE)
    await until(() => held.held > 0, 'the launch to reach its gate')
    // Past the fifteen seconds' worth of shortened bound a launch used to be given: still waiting.
    await new Promise((resolve) => setTimeout(resolve, 200))
    let settled = false
    void giving.then(() => {
      settled = true
    })
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(settled).toBe(false)
    held.release()
    const answered = payload(await giving)
    expect(answered.outcome).not.toBe('refused')
    expect(piecesUnderTheRoot()).toHaveLength(1)
  })

  it('§2 a launch the app stopped before it started is answered as not started, a decision and not a retry', async () => {
    const call = await aParentThatMaySpawn()
    const held = holdTheNextLaunch()
    const spawning = call('give_work', A_GIVE)
    await until(() => held.held > 0, 'the launch to reach its gate')
    // ⚑ **D-017 · R11 — a start on its way in is `active`** (there is no *starting* state), and it
    // is the only conversation here doing anything.
    const starting = (
      payload(await call('list_agents', {})) as { agents: { agent: string; state: string }[] }
    ).agents.find((one) => one.state === 'active')
    expect(starting).toBeDefined()
    // ⚑ **D-017 — nothing ends a conversation** (`end_agent` is gone, and a person's Close of a
    // child nobody holds is refused until it is taken over): what stops a spawn in flight is the
    // app itself — a quit.
    await host.closeAll()

    expect(payload(await spawning)).toMatchObject({
      outcome: 'refused',
      rail: 'agent-did-not-start',
      permanence: 'until-a-person-changes-it',
      retryable: false,
      remedy: null,
      detail: { profile: 'worker', because: 'shutting-down' },
    })
    // ⚠️ **True on this arm**: a stop nobody had to fix — and the sentence does not tell the parent
    // a person has to change something before it may call again.
    const said = String(payload(await spawning).reason)
    expect(said).toContain('somebody stopped it first')
    expect(said).not.toContain('has to change that first')
    // ⛔ **D-016 · R4** — and nothing was given.
    expect(piecesUnderTheRoot()).toEqual([])
  })

  it('§3 a sign-in the machine does not have is answered with a closed reason and none of the host text', async () => {
    const call = await aParentThatMaySpawn()
    homeFails = new AuthUnavailableError(
      'claude',
      'the machine Claude login at /Users/somebody/.claude is not healthy',
    )
    const warned = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const answered = payload(await call('give_work', A_GIVE))
    expect(answered).toMatchObject({
      outcome: 'refused',
      rail: 'agent-did-not-start',
      detail: { profile: 'worker', because: 'its-sign-in-is-unusable', provider: 'claude' },
    })
    // ⛔ **No path and no instruction reach the model** — the detail carries a reason, not the text.
    expect(JSON.stringify(answered)).not.toContain('/Users/somebody')
    // ⚑ What failed and what fixes it, and never that somebody stopped it.
    expect(String(answered.reason)).toContain('its Claude sign-in could not be used')
    expect(String(answered.reason)).toContain('sign in to Claude Code on this computer again')
    expect(String(answered.reason)).not.toContain('somebody stopped it first')
    expect(answered.retryable).toBe(false)
    expect(piecesUnderTheRoot()).toEqual([])
    // 🔴 **And the text is not LOST**: it reached the transcript as *"spawn_agent failed: …"* before
    // `657`, and the host's log is where the precise diagnostic lives now.
    expect(
      warned.mock.calls.some(
        (args) =>
          String(args[0]).startsWith('give_work: ') &&
          String(args[0]).includes('/Users/somebody/.claude'),
      ),
    ).toBe(true)
  })

  it('§3b Codex settings its profile holds that cannot be used are said as settings, not as a sign-in', async () => {
    const call = await aParentThatMaySpawn()
    homeFails = new CodexSettingsUnusableError(
      'profile config.toml could not be parsed at /Users/somebody/home/config.toml',
    )
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const answered = payload(await call('give_work', A_GIVE))
    expect(answered).toMatchObject({
      outcome: 'refused',
      rail: 'agent-did-not-start',
      detail: {
        profile: 'worker',
        because: 'its-provider-settings-are-unusable',
        provider: 'codex',
      },
    })
    expect(String(answered.reason)).toContain(
      'correct that agent’s Codex settings (config.toml): they could not be used',
    )
    expect(String(answered.reason)).not.toContain('sign-in')
    expect(JSON.stringify(answered)).not.toContain('/Users/somebody')
    expect(piecesUnderTheRoot()).toEqual([])
  })

  it('§4 a failure this tool does not recognise still propagates — it is not dressed as a word', async () => {
    const call = await aParentThatMaySpawn()
    homeFails = new Error('the disk said no')
    // ⛔ `375`'s rule: classify one type and let the rest through. A catch-all here would be the
    // fold `650` spent a dispatch undoing.
    await expect(call('give_work', A_GIVE)).rejects.toThrow('the disk said no')
  })

  it('§5 the host keeps the class as `cause`, and the sentence a person reads is unchanged', async () => {
    const held = holdTheNextLaunch()
    const failing = host
      .createSession({ provider: 'claude', profileId: 'worker', cwd: work }, window)
      .then(
        () => null,
        (error: unknown) => error,
      )
    await until(() => held.held > 0, 'the launch to reach its gate')
    await host.closeAll()
    const failed = await failing
    expect(failed).toBeInstanceOf(Error)
    // ⚑ **The person's sentence, as before** — and not the class name.
    expect(String((failed as Error).message)).not.toContain('SessionUnavailable')
    expect(unavailableOf(failed)).toBeNull()
    // 🔴 **The class survives one step down**, which is what `give_work` classifies by.
    const cause = (failed as Error).cause
    expect(cause).toBeInstanceOf(SessionUnavailable)
    expect(unavailableOf(cause)).toBe('shutting-down')
  })
})
