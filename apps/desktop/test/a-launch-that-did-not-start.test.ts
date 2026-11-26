import { expectRecordedCannotRun, expectTaskKept, logKeepsFailure } from './lib/recorded-send'
import { RecordingSink, neutralHostDeps } from './lib/host-fixture'
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  AuthUnavailableError,
  FakeLaunchGate,
  FakeProviderSessions,
  FakeRuntime,
} from '@brobot2/runtime'
import type { AgentToolAnswer } from '@brobot2/runtime'
import type { Provider } from '@brobot2/shared'
import { type AppDatabase, openDatabase } from '../src/main/db/connection'
import { applyMigrations } from '../src/main/db/migrate'
import { createSessionStore, type SessionStore } from '../src/main/db/session-store'
import { RuntimeHost } from '../src/main/runtime/runtime-host'
import { agentToolsFor, type ToolName } from '../src/main/runtime/agent-tools'
import { SessionUnavailable, unavailableOf } from '../src/main/runtime/session-unavailable'
import { resolveSessionCwd } from '../src/main/runtime/scratch-cwd'
import { DEFAULT_PROFILE_ID } from '../src/shared/runtime-ipc'

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
 *  - §1 · a provider that did not answer in time — `agent-took-too-long-to-start`, retryable,
 *    because the same call is a fresh launch nobody has to act before.
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

  const buildHost = (launchTimeoutMs?: number): RuntimeHost =>
    new RuntimeHost({
      store,
      ...neutralHostDeps(() => userData),
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
      ...(launchTimeoutMs === undefined ? {} : { launchTimeoutMs }),
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
    to: 'new',
    conversation_title: 'A first piece',
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

  it('keeps a task through a launch timeout and starts it later at the same address', async () => {
    host = buildHost(40)
    const call = await aParentThatMaySpawn()
    holdTheNextLaunch()

    const answered = await call('give_work', A_GIVE)
    const kept = expectRecordedCannotRun(
      payload(answered),
      'task',
      'no further launch progress',
      false,
    )
    expectTaskKept(store, kept)
    expect(piecesUnderTheRoot()).toEqual([kept.recorded.taskLabel])
    expect(answered.text).toContain('The work is kept.')

    gate = null
    const retry = payload(
      await call('message_agent', {
        agent: kept.recipient.id,
        kind: 'note',
        text: 'Continue with the saved task.',
      }),
    )
    expect(retry).toMatchObject({
      outcome: 'ok',
      agent: kept.recipient.id,
    })
    expect(store.recordedOne(kept.recipient.id)?.providerSessionId).toEqual(expect.any(String))
    expect(piecesUnderTheRoot()).toEqual([kept.recorded.taskLabel])
  })

  it('keeps its task when the app shuts down during the first launch', async () => {
    const call = await aParentThatMaySpawn()
    const held = holdTheNextLaunch()
    const spawning = call('give_work', A_GIVE)
    await until(() => held.held > 0, 'the launch to reach its gate')
    const starting = (
      payload(await call('list_agents', {})) as { agents: { agent: string; state: string }[] }
    ).agents.find((one) => one.state === 'active')
    expect(starting).toBeDefined()
    await host.closeAll()

    const kept = expectRecordedCannotRun(payload(await spawning), 'task', 'shutting down', false)
    expect(kept.recipient.id).toBe(starting?.agent)
    expectTaskKept(store, kept)
    expect(piecesUnderTheRoot()).toEqual([kept.recorded.taskLabel])
    expect(store.recordedOne(kept.recipient.id)?.providerSessionId).toBeNull()
  })

  it('states an unusable sign-in as a person’s action and keeps the actual error in the log', async () => {
    const call = await aParentThatMaySpawn()
    const failure = new AuthUnavailableError(
      'claude',
      'the machine Claude login at /Users/somebody/.claude is not healthy',
    )
    homeFails = failure
    const warned = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const answered = await call('give_work', A_GIVE)
    const kept = expectRecordedCannotRun(
      payload(answered),
      'task',
      'its Claude sign-in could not be used',
      true,
    )
    expectTaskKept(store, kept)
    expect(JSON.stringify(answered)).not.toContain('/Users/somebody')
    expect(answered.text).toContain('Ask the person to fix it, with request_action.')
    expect(piecesUnderTheRoot()).toEqual([kept.recorded.taskLabel])
    expect(logKeepsFailure(warned.mock.calls, failure)).toBe(true)
  })

  it('keeps a task when an unclassified start error stays only in the log', async () => {
    const call = await aParentThatMaySpawn()
    const failure = new Error('the disk said no')
    homeFails = failure
    const warned = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const answered = await call('give_work', A_GIVE)
    const kept = expectRecordedCannotRun(payload(answered), 'task', 'only in its log', false)
    expectTaskKept(store, kept)
    expect(JSON.stringify(answered)).not.toContain(failure.message)
    expect(logKeepsFailure(warned.mock.calls, failure)).toBe(true)
  })

  it('§5 the host keeps the class as `cause`, and the sentence a person reads is unchanged', async () => {
    host = buildHost(40)
    holdTheNextLaunch()
    const failed = await host
      .createSession({ provider: 'claude', profileId: 'worker', cwd: work }, window)
      .then(
        () => null,
        (error: unknown) => error,
      )
    expect(failed).toBeInstanceOf(Error)
    // ⚑ **The person's sentence, as before** — and not the class name.
    expect(String((failed as Error).message)).not.toContain('SessionUnavailable')
    expect(unavailableOf(failed)).toBeNull()
    // 🔴 **The class survives one step down**, which is what `give_work` classifies by.
    const cause = (failed as Error).cause
    expect(cause).toBeInstanceOf(SessionUnavailable)
    expect(unavailableOf(cause)).toBe('took-too-long')
  })
})
