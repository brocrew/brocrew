import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { FakeProviderSessions, FakeRuntime } from '@brobot2/runtime'
import type {
  AgentToolset,
  FakeSessionHandle,
  ResumeOptions,
  SessionRef,
  StartOptions,
} from '@brobot2/runtime'
import type { Provider } from '@brobot2/shared'
import { type AppDatabase, openDatabase } from '../src/main/db/connection'
import { applyMigrations } from '../src/main/db/migrate'
import { createSessionStore, type SessionStore } from '../src/main/db/session-store'
import { NO_DISCOVERY } from '../src/main/adopt/discover-sessions'
import { agentToolsFor, refuseTool, type ToolName } from '../src/main/runtime/agent-tools'
import { RuntimeHost, type RuntimeEventSink } from '../src/main/runtime/runtime-host'
import { resolveSessionCwd } from '../src/main/runtime/scratch-cwd'
import type { RuntimeEventMessage } from '../src/shared/runtime-ipc'

/**
 * 🔴 **424 §B · the arms of `agent-cannot-take-a-message`, after the one that made it false was
 * split off.**
 *
 * ## ⛔ What `422` measured
 *
 * > *"The second flatly false rail I pinned is `agent-cannot-take-a-message`: a model can address
 * > its own real, advertised session id, receive `while-this-holds · retryable: true` forever, and
 * > has no verb that can make that id commandable."*
 *
 * ⚑ **That arm is `that-agent-is-you` now** — `permanent`, and demonstrated in
 * `the-five-tools.test.ts` §2, where `422`'s own characterisation lives. ⛔ **This file is about
 * what is LEFT**, because a split that leaves the remainder untested is a rail going dark rather
 * than a rail being fixed.
 *
 * ## ⚑ The two things measured here
 *
 * 1. **A conversation that is over** reached the catch-all, and said `until-a-person-changes-it`.
 *    ⚑ **D-017 · R1: it no longer does** — a provider failure is a stop, and the message starts the
 *    conversation again; the test below measures that, and the rail's price for what remains. ⚠️ **This said *"true of every arm that
 *    remains"* and named those two, and `650` counted more**: a launch in flight and a turn another
 *    sender opened first cleared on their own. The first has its own word now; the second has had
 *    none since `657`, which HOLDS it instead of refusing it. The arms the fold still holds are
 *    listed in the note beside its permanence in `agent-tools.ts` rather than here.
 * 2. **Words made of whitespace never reach it at all.** ⛔ **Found while splitting the rail**: the
 *    tool guarded `text.length === 0` while the host guards `hasSomethingToSend`, so a message of
 *    spaces passed the door, threw `NOTHING_TO_SEND` inside `queueMessage`, and came back as *"that
 *    agent is not in a state where it can be given anything to do"* — a sentence about the RECEIVER
 *    for a fault in the caller's own arguments, which is 340's finding exactly.
 *
 * ⚠️ **Real host, real SQLite, real migrations, real tools. The only double is the provider** — and
 * it is a double that keeps its handles, because a test has to BE the provider to fault like one.
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

/** `395`'s double, kept here for the same reason: a test has to BE the provider to fault like one. */
class ProviderDouble extends FakeRuntime {
  constructor(
    provider: Provider,
    private readonly handles: FakeSessionHandle[],
    sessions: FakeProviderSessions,
  ) {
    super(provider, { sessions })
  }
  override async start(options: StartOptions): Promise<FakeSessionHandle> {
    const handle = await super.start(options)
    this.handles.push(handle)
    return handle
  }
  override async resume(ref: SessionRef, options: ResumeOptions): Promise<FakeSessionHandle> {
    const handle = await super.resume(ref, options)
    this.handles.push(handle)
    return handle
  }
}

describe('424 §B · what `agent-cannot-take-a-message` still answers for', () => {
  let userData: string
  let work: string
  let db: AppDatabase
  let store: SessionStore
  let host: RuntimeHost
  let handles: FakeSessionHandle[]
  let issued: FakeProviderSessions
  let counter: number
  let clock: number
  let window: RecordingSink
  const tick = (): number => clock++

  beforeEach(() => {
    userData = mkdtempSync(join(tmpdir(), 'brobot2-promises-'))
    work = mkdtempSync(join(tmpdir(), 'brobot2-promises-work-'))
    db = openDatabase(join(userData, 'brobot2.sqlite'))
    applyMigrations(db, migrationsFolder)
    clock = 4_000_000
    store = createSessionStore(db, tick)
    counter = 0
    handles = []
    issued = new FakeProviderSessions()
    window = new RecordingSink('webContents:1')
    host = new RuntimeHost({
      store,
      discoverSessions: NO_DISCOVERY,
      nativeTranscriptPath: () => null,
      exportDirectory: () => join(userData, 'exports'),
      createRuntime: (provider: Provider) => new ProviderDouble(provider, handles, issued),
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
    })
  })

  afterEach(async () => {
    await host.closeAll()
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

  /** An identity exists only once a person has run a conversation as it — 341 criterion 12. */
  const bringIdentityIntoBeing = async (profileId: string): Promise<void> => {
    await host.close(await personOpens(profileId), window)
  }

  const callOn = async (
    set: AgentToolset,
    name: ToolName,
    args: Record<string, unknown> = {},
  ): Promise<Record<string, unknown>> => {
    const tool = set.tools.find((one) => one.name === name)
    if (tool === undefined) throw new Error(`no such tool: ${name}`)
    return (await tool.call(args)).structured as Record<string, unknown>
  }

  const latestHandle = (): FakeSessionHandle => {
    const handle = handles.at(-1)
    if (handle === undefined) throw new Error('no provider handle has been issued')
    return handle
  }

  /**
   * A parent and two children it commands — the second is every negative's paired positive.
   *
   * ⚑ **D-016 · each child is started by a GIVE**, so each holds a piece from this parent and runs
   * its brief as its first turn (parked on the Fake's card, since the parent is in `ask`).
   */
  const aParentAndTwoChildren = async (): Promise<{
    tools: AgentToolset
    first: string
    firstPiece: string
    firstHandle: FakeSessionHandle
    second: string
    secondPiece: string
  }> => {
    for (const one of ['worker', 'worker-b']) await bringIdentityIntoBeing(one)
    const parent = await personOpens('pm')
    const tools = agentToolsFor(host, parent)
    const first = await callOn(tools, 'give_work', {
      definition_of_done: 'The requested result and its checks are recorded.',
      profile: 'worker',
      title: 'A',
      brief: 'a',
    })
    expect(first.outcome, JSON.stringify(first)).toBe('ok')
    const firstHandle = latestHandle()
    const second = await callOn(tools, 'give_work', {
      definition_of_done: 'The requested result and its checks are recorded.',
      profile: 'worker-b',
      title: 'B',
      brief: 'b',
    })
    expect(second.outcome, JSON.stringify(second)).toBe('ok')
    return {
      tools,
      first: first.agent as string,
      firstPiece: first.label as string,
      firstHandle,
      second: second.agent as string,
      secondPiece: second.label as string,
    }
  }

  /**
   * ⚑ **D-017 · R1 — re-aimed: a provider failure is a STOP, and the message starts it again.** ⛔
   * This measured *a conversation that is over* refused `agent-cannot-take-a-message`
   * `until-a-person-changes-it` — a person's Reopen being the only way back. ⚑ Now the message waits
   * the failed provider's teardown out and starts the conversation again (`ensureRunning`), so the
   * arm is gone from the catch-all: what it still folds is listed beside its permanence in
   * `agent-tools.ts` (a turn stopped inside `send`, a sign-in the machine moved on from).
   */
  it('🔴 a conversation whose provider FAILED is started again by the message — not refused, and not a person’s to reopen', async () => {
    const { tools, first, firstPiece, firstHandle, second, secondPiece } =
      await aParentAndTwoChildren()
    // ⛔ **The provider faults, which is a state this app reports and does not create.**
    firstHandle.simulateError('the provider died', true)
    expect(firstHandle.status()).toBe('errored')
    const issuedBefore = handles.length

    // ⚑ **D-016 · a follow-up names the piece it follows up** — the one this parent gave it.
    const started = await callOn(tools, 'message_agent', {
      agent: first,
      text: 'carry on',
      kind: 'follow-up',
      piece: firstPiece,
    })
    expect(started.outcome, JSON.stringify(started)).toBe('ok')
    expect(started.rail).toBeUndefined()
    // ⚑ **Started again, not merely answered**: a new provider handle was issued, and it runs.
    expect(handles.length).toBe(issuedBefore + 1)
    expect(latestHandle().status()).not.toBe('errored')
    // ⚠️ **The rail's price is unchanged for the arms that remain** — each still a state nothing but a
    // person changes, so it is still not a state to retry into.
    expect(refuseTool('agent-cannot-take-a-message')).toMatchObject({
      permanence: 'until-a-person-changes-it',
      retryable: false,
    })

    // ⚑ **ONE FACT OVER — the same call, the same caller, a sibling whose provider never failed**,
    // following up the piece this parent gave IT.
    const landed = await callOn(tools, 'message_agent', {
      agent: second,
      text: 'carry on',
      kind: 'follow-up',
      piece: secondPiece,
    })
    expect(landed.outcome, JSON.stringify(landed)).toBe('ok')
  })

  it('⛔ words made of whitespace are the CALLER’s fault, and are no longer answered as the receiver’s', async () => {
    const { tools, second, secondPiece } = await aParentAndTwoChildren()
    // 🔴 **The second mis-fold, found while splitting the catch-all** (424). The tool guarded
    // `text.length === 0`; the host guards `hasSomethingToSend`, which trims. So this call used to
    // pass the door, throw `NOTHING_TO_SEND` two layers down, and come back wearing a sentence
    // about the receiver.
    // ⚑ **D-016 · the follow-up names the piece this parent gave it**, so the words are the one fault.
    const refused = await callOn(tools, 'message_agent', {
      agent: second,
      text: '   \n\t ',
      kind: 'follow-up',
      piece: secondPiece,
    })
    expect(refused.outcome, JSON.stringify(refused)).toBe('refused')
    expect(refused.rail).toBe('malformed-request')
    // ⛔ **The rail it must NOT be, named** — and the sentence it must not be wearing, which is the
    // half that would survive a rename.
    expect(refused.rail).not.toBe('agent-cannot-take-a-message')
    expect(String(refused.reason)).not.toContain('not in a state')
    expect(String(refused.reason)).toBe(refuseTool('malformed-request').reason)

    // ⚑ **ONE FACT OVER — the identical call with words in it.** The receiver never moved.
    const landed = await callOn(tools, 'message_agent', {
      agent: second,
      text: ' do this ',
      kind: 'follow-up',
      piece: secondPiece,
    })
    expect(landed.outcome, JSON.stringify(landed)).toBe('ok')
  })
})
