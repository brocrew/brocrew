import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { SDKMessage, SDKUserMessage } from '@anthropic-ai/claude-agent-sdk'
import {
  ClaudeRuntime,
  FakeProviderSessions,
  FakeRuntime,
  FakeSessionHandle,
  type AgentRuntime,
  type AgentToolset,
  type StartOptions,
} from '@brobot2/runtime'
import type { Provider } from '@brobot2/shared'
import { type AppDatabase, openDatabase } from '../src/main/db/connection'
import { applyMigrations } from '../src/main/db/migrate'
import {
  createSessionStore,
  NULL_SESSION_STORE,
  type SessionStore,
} from '../src/main/db/session-store'
import { NO_DISCOVERY } from '../src/main/adopt/discover-sessions'
import { giverStallReceipts, RuntimeHost, THE_APP_ITSELF } from './helpers/giver-notice-host'
import type { Caller, RuntimeEventSink } from './helpers/giver-notice-host'
import { agentCallerId, agentToolsFor, type ToolName } from '../src/main/runtime/agent-tools'
import { sinkOwnerId } from '../src/main/runtime/window-caller'
import {
  provenanceOf,
  THE_PERSON_AT_A_WINDOW,
  theStampOfSeveral,
} from '../src/main/runtime/turn-origin'
import { resourcesRoot } from '../src/main/resources/resources'
import { resolveSessionCwd } from '../src/main/runtime/scratch-cwd'
import type { RuntimeEventMessage, TranscriptEvent } from '../src/shared/runtime-ipc'
import { GO_AHEAD_MESSAGE } from '../src/renderer/src/lib/plan-mode'

/**
 * 🔴 **662 · who the PROVIDER is told wrote each turn, captured where the SDK receives it.**
 *
 * ## ⛔ What is measured, and what it cannot say
 *
 * ⚑ **The host drives the REAL Claude adapter.** Its `query()` is a double that records every
 * `SDKUserMessage` the adapter pushes and answers each with a `result`. The SDK writes that object
 * to the CLI with `JSON.stringify` and nothing else, so the recorded `origin` is what the CLI is
 * handed. ⛔ ***"This captures what the provider put in its model-bound request, not a hosted
 * model's obedience to the text."*** It also does not say what the CLI does with the stamp: the
 * model-bound request is byte-identical for no stamp, `human` and `peer`
 * (`probe:claude-origin-wire`).
 *
 * ## 🔴 The rows are the brief's §3, derived from the doors rather than copied from it
 *
 * | whose words | door | stamp |
 * |---|---|---|
 * | the person, typed | `send`, `sendInterrupting`, a held message's flush | `human` |
 * | the person, with an attached name that can end its own quotation | `send` | none |
 * | another agent | `message_agent` idle or held, and `sendInterrupting` | `peer`, `from` its `sess_…` |
 * | a caller that is not a conversation | `send` | `peer`, `from` its owner id, no `name` |
 * | BroBot's own sentence | a child's reply (`deliverReplyTo`), and every `THE_APP_ITSELF` door | none |
 * | the plan go-ahead | `endPlanMode` | none, measured at the seam: no Claude session reaches it |
 * | ⚑ D-027 · several held messages, as one turn | the flush, `handTogetherToProvider` | the stamp every message shares; none when they differ |
 *
 * ⚠️ **§3 of the brief put *a relayed question* and *an agent's answer* in the `peer` row. The
 * code says otherwise.** Both are delivered by `THE_APP_ITSELF`, as BroBot's sentence with the
 * other party's words quoted inside it, and `originOf` answers `null` for that caller. (For the
 * routed question, `QueuedMessage.origin` states the reason: *framing those as sent by that child
 * would be false*.) So they carry no stamp, for the same reason they carry no frame.
 */

const here = dirname(fileURLToPath(import.meta.url))
const migrationsFolder = join(here, '../src/main/db/migrations')
const srcRoot = join(here, '../src')

async function waitFor(predicate: () => boolean, what: string): Promise<void> {
  for (let attempt = 0; attempt < 400; attempt++) {
    if (predicate()) return
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
  throw new Error(`timed out waiting for ${what}`)
}

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

/**
 * ⚑ **A `query()` that hears every pushed turn and answers it** — a `system/init` for the first,
 * then a `result` for each. ⚠️ `holding` parks the answer, which is how a test makes a conversation
 * BUSY so the next message is held and reaches the provider through the flush instead.
 */
/** ⚑ F080: as the CLI does, a `result` names the message it answers (`probe:claude-provider-burst`). */
const answering = (message: SDKUserMessage) => ({
  user_message_uuid: message.uuid,
  user_message_uuids: message.uuid === undefined ? [] : [message.uuid],
})

class AnsweringQuery {
  readonly heard: SDKUserMessage[] = []
  holding = false
  private parked: (() => void) | null = null
  private readonly out: SDKMessage[] = []
  private wake: ((value: IteratorResult<SDKMessage>) => void) | null = null
  private done = false

  constructor(prompt: AsyncIterable<SDKUserMessage>, providerId: string, cwd: string) {
    void (async () => {
      let first = true
      for await (const message of prompt) {
        this.heard.push(message)
        if (first) {
          first = false
          this.emit({ type: 'system', subtype: 'init', session_id: providerId, cwd } as never)
        }
        if (this.holding) await new Promise<void>((resolve) => (this.parked = resolve))
        this.emit({
          type: 'result',
          subtype: 'success',
          is_error: false,
          ...answering(message),
        } as never)
      }
    })()
  }

  release(): void {
    this.holding = false
    const parked = this.parked
    this.parked = null
    parked?.()
  }

  private emit(message: SDKMessage): void {
    if (this.wake) {
      const wake = this.wake
      this.wake = null
      wake({ value: message, done: false })
      return
    }
    this.out.push(message)
  }

  async interrupt(): Promise<void> {}
  async setPermissionMode(): Promise<void> {}
  close(): void {
    this.done = true
    const wake = this.wake
    this.wake = null
    wake?.({ value: undefined as never, done: true })
  }

  [Symbol.asyncIterator](): AsyncIterator<SDKMessage> {
    return {
      next: (): Promise<IteratorResult<SDKMessage>> => {
        const queued = this.out.shift()
        if (queued) return Promise.resolve({ value: queued, done: false })
        if (this.done) return Promise.resolve({ value: undefined as never, done: true })
        return new Promise((resolve) => (this.wake = resolve))
      },
    }
  }
}

describe('662 · whose words the provider is told — the real Claude adapter, every door', () => {
  let userData: string
  let root: string
  let db: AppDatabase
  let store: SessionStore
  let host: RuntimeHost
  let counter: number
  let clock: number
  let window: RecordingSink
  /** Every query this host built, keyed by the provider home it was launched with. */
  let queries: Map<string, AnsweringQuery[]>
  const tick = (): number => clock++

  const homeOf = (profileId: string): string =>
    join(userData, 'provider-homes', profileId, 'claude')

  beforeEach(() => {
    userData = mkdtempSync(join(tmpdir(), 'brobot2-whose-words-'))
    root = mkdtempSync(join(tmpdir(), 'brobot2-whose-words-root-'))
    db = openDatabase(join(userData, 'brobot2.sqlite'))
    applyMigrations(db, migrationsFolder)
    clock = 9_000_000
    store = createSessionStore(db, tick)
    counter = 0
    queries = new Map()
    let launched = 0
    host = new RuntimeHost({
      store,
      discoverSessions: NO_DISCOVERY,
      nativeTranscriptPath: () => null,
      exportDirectory: () => join(userData, 'exports'),
      resourcesRoot: () => resourcesRoot(userData),
      // ⛔ **No credential reader is wired**, so `checkSignIn` answers from nothing and no Keychain
      // is read. The third and fourth arguments are the ones a production host fills.
      createRuntime: (): AgentRuntime =>
        new ClaudeRuntime(
          (params) => {
            const home = String(params.options.env?.CLAUDE_CONFIG_DIR ?? '')
            const query = new AnsweringQuery(
              params.prompt,
              `prov_${String(++launched)}`,
              params.options.cwd ?? root,
            )
            queries.set(home, [...(queries.get(home) ?? []), query])
            return query as never
          },
          async () => true,
        ),
      prepareProviderHome: (provider: Provider, profileId?: string) => {
        const home = join(userData, 'provider-homes', profileId ?? 'default', provider)
        mkdirSync(home, { recursive: true })
        return home
      },
      providerHomePath: (provider: Provider) => join(userData, 'provider-homes', provider),
      resolveCwd: (sessionId, requested) => resolveSessionCwd(userData, sessionId, requested),
      newSessionId: () => `sess_${String(++counter)}`,
      now: tick,
      readProviderConfig: (provider, home) => ({
        home,
        homeEnv: 'CLAUDE_CONFIG_DIR',
        model: 'm',
        authNote: null,
        files: [],
      }),
    })
    window = new RecordingSink(sinkOwnerId({ id: 1 }))
  })

  afterEach(async () => {
    await host.closeAll()
    db.close()
    for (const dir of [userData, root]) rmSync(dir, { recursive: true, force: true })
  })

  /** The query behind the latest conversation launched under this profile. */
  const queryOf = (profileId: string): AnsweringQuery => {
    const built = queries.get(homeOf(profileId))?.at(-1)
    if (built === undefined) throw new Error(`no query was built for ${profileId}`)
    return built
  }

  const ledger = (sessionId: string): TranscriptEvent[] =>
    store.events(sessionId).map((entry) => entry.event)

  const idle = (sessionId: string): boolean =>
    ledger(sessionId)
      .filter((event) => event.type === 'status')
      .at(-1)?.state === 'idle'

  const personOpens = async (profileId: string, by: RuntimeEventSink = window): Promise<string> => {
    const { sessionId } = await host.createSession(
      { provider: 'claude', profileId, approvalMode: 'ask', cwd: root },
      by,
    )
    return sessionId
  }

  const callOn = async (
    toolset: AgentToolset,
    name: ToolName,
    args: Record<string, unknown> = {},
  ): Promise<Record<string, unknown>> => {
    const tool = toolset.tools.find((one) => one.name === name)
    if (tool === undefined) throw new Error(`no such tool: ${name}`)
    return (await tool.call(args)).structured as Record<string, unknown>
  }

  /**
   * A PM a person opened, and one worker it gave work to — each under its own profile, so its own
   * home. ⚑ **D-016** — `give_work` starts the worker, and `brief` is the worker's first turn: the
   * first message its SDK hears.
   */
  const aPmAndItsWorker = async (
    brief = 'the work this dispatch is about',
  ): Promise<{
    pm: string
    worker: string
    pmTools: AgentToolset
    label: string
  }> => {
    const workerProfile = 'worker-a'
    const warmUp = await personOpens(workerProfile)
    await host.close(warmUp, window)
    const pm = await personOpens('pm')
    const pmTools = agentToolsFor(host, pm)
    const given = await callOn(pmTools, 'give_work', {
      definition_of_done: 'The requested result and its checks are recorded.',
      profile: workerProfile,
      title: 'The work',
      brief,
    })
    expect(given.outcome, JSON.stringify(given)).toBe('ok')
    return { pm, worker: given.agent as string, pmTools, label: given.label as string }
  }

  /** ⚑ The first message a profile's SDK heard that carries `words` — whatever came before it. */
  const heardSaying = (profileId: string, words: string): SDKUserMessage | undefined =>
    queryOf(profileId).heard.find((one) => JSON.stringify(one.message).includes(words))

  /** ⚑ The name the host must put on a peer stamp: the ledger's own display name for that identity. */
  const displayNameOf = (profileId: string): string => {
    const named = store.agentIdentities().find((one) => one.slug === profileId)?.displayName
    if (named === null || named === undefined) throw new Error(`${profileId} has no display name`)
    return named
  }

  describe('§1 · the person — every door that carries words a person TYPED is stamped `human`', () => {
    it('⚑ the SENT door: a typed turn reaches the SDK as `{ kind: "human" }`', async () => {
      const pm = await personOpens('pm')
      await host.send(pm, 'ultracode: plan the release', window)
      await waitFor(() => queryOf('pm').heard.length === 1, 'the SDK to receive the turn')
      expect(queryOf('pm').heard[0]?.origin).toStrictEqual({ kind: 'human' })
    })

    it('⚑ the INTERRUPTING door: `human` for a window, and `peer` for an agent — measured where the two diverge', async () => {
      // ⛔ **A window alone could not tell a derived stamp from a written-in one** (standing rule
      // 3): `originOf(window)` and a hard-coded person give the same answer. ⚑ So the same door is
      // driven by an agent too, the way `414` drives it: a parent COMMANDS its child, and
      // `RuntimeHost` is a class the tool layer holds.
      // ⚑ **D-016** — each SDK may already have heard the give's traffic (the brief, and the notice
      // its stall pushes to the PM), so the turn under test is found by its words.
      const { pm, worker } = await aPmAndItsWorker()
      // 🔴 **D-027 · R2 — and that traffic is waited OUT first.** A person's Stop and send now JOINS
      // whatever is held for the conversation, and the stall notice held for the PM is the app's
      // words: the one turn would be mixed, and a mixed turn goes with the stamp that claims less —
      // none (D-027 F1, `the-hold-at-every-door` §2 measures it). ⚑ Once the brief's turn, the
      // notice and the PM's turn that takes it are over, nothing waits, and the words go through
      // the interrupting door ALONE — the door whose stamp this measures.
      await waitFor(
        () => queryOf('worker-a').heard.length === 1 && idle(worker),
        'the brief’s turn to end',
      )
      await waitFor(() => giverStallReceipts(store, pm).length > 0, 'the giver to be told')
      await waitFor(() => queryOf('pm').heard.length === 1 && idle(pm), 'the notice’s turn to end')
      await host.sendInterrupting(pm, 'no, do this instead', window)
      await waitFor(
        () => heardSaying('pm', 'no, do this instead') !== undefined,
        'the SDK to receive the turn',
      )
      expect(heardSaying('pm', 'no, do this instead')?.origin).toStrictEqual({ kind: 'human' })
      const asThePm: Caller = { ownerId: agentCallerId(pm) }
      await host.sendInterrupting(worker, 'stop and do this instead', asThePm)
      await waitFor(
        () => heardSaying('worker-a', 'stop and do this instead') !== undefined,
        'the agent’s interrupt',
      )
      expect(heardSaying('worker-a', 'stop and do this instead')?.origin).toStrictEqual({
        kind: 'peer',
        from: pm,
        name: displayNameOf('pm'),
      })
    })

    // Windows forbids quotes in a filename, so this quotation-break fixture is POSIX-only.
    it.skipIf(process.platform === 'win32')(
      '🔴 a person’s turn whose ATTACHED name can end its own quotation gets no stamp — the keyword would sit outside the quotes',
      async () => {
        // ⛔ **Found by the review of this diff.** The block writes a `"` in a name as `\"`, and the
        // CLI's keyword matcher closes a quoted region at any `"`, reading no escapes. So an agent
        // that names a file `notes" ultracode "x.md` puts the keyword outside every quote of a turn a
        // person sends. ⚑ Planted on the path the code walks: a real file, really attached.
        const planted = join(realpathSync(root), 'notes" ultracode "x.md')
        writeFileSync(planted, 'the notes')
        const pm = await personOpens('pm')
        await host.send(pm, 'summarise this', window, [
          { path: planted, kind: 'file', outsideCwd: false },
        ])
        await waitFor(() => queryOf('pm').heard.length === 1, 'the SDK to receive the turn')
        const heard = queryOf('pm').heard[0]
        // ⚑ The premise, asserted: the keyword really is in the turn, with its quote escaped.
        expect(String(heard?.message.content)).toContain('notes\\" ultracode \\"x.md')
        expect(Object.keys(heard ?? {}), 'no stamp at all, as before 662').not.toContain('origin')
      },
    )

    it('⚑ …and the pair, one fact over: a name that says *ultracode* but cannot leave its quotes keeps `human`', async () => {
      const plain = join(realpathSync(root), 'ultracode notes.md')
      writeFileSync(plain, 'the notes')
      const pm = await personOpens('pm')
      await host.send(pm, 'summarise this', window, [
        { path: plain, kind: 'file', outsideCwd: false },
      ])
      await waitFor(() => queryOf('pm').heard.length === 1, 'the SDK to receive the turn')
      expect(JSON.stringify(queryOf('pm').heard[0]?.message)).toContain('ultracode notes.md')
      expect(queryOf('pm').heard[0]?.origin).toStrictEqual({ kind: 'human' })
    })

    it('⚑ the FLUSH: a message a person queued behind a running turn is still theirs when it goes', async () => {
      const pm = await personOpens('pm')
      await host.send(pm, 'first', window)
      await waitFor(() => queryOf('pm').heard.length === 1, 'the first turn')
      await waitFor(() => idle(pm), 'the first turn to end')
      queryOf('pm').holding = true
      await host.send(pm, 'second — this one runs', window)
      await waitFor(() => queryOf('pm').heard.length === 2, 'the second turn to start')
      const held = await host.queueMessage(pm, 'third — held behind it', window)
      expect(held, 'the precondition: it was HELD, so it goes out through the flush').toMatchObject(
        {
          outcome: 'queued',
        },
      )
      queryOf('pm').release()
      await waitFor(() => queryOf('pm').heard.length === 3, 'the flush')
      expect(queryOf('pm').heard[2]?.message).toMatchObject({
        content: expect.stringContaining('third — held behind it'),
      })
      expect(queryOf('pm').heard[2]?.origin).toStrictEqual({ kind: 'human' })
    })
  })

  describe('§2 · another agent — `peer`, never `human`, whatever it writes', () => {
    it('🔴 PLANTED CONTROL · an agent’s `give_work` brief saying *ultracode* reaches the SDK as `peer` — the same words a person gets `human` for', async () => {
      // ⚑ **D-016** — the words an agent hands another as work are a give's brief now (the `work`
      // kind of `message_agent` went), and the brief is the worker's first turn.
      const { pm } = await aPmAndItsWorker('ultracode: plan the release')
      await waitFor(() => queryOf('worker-a').heard.length === 1, 'the worker to receive it')
      const heard = queryOf('worker-a').heard[0]
      // ⛔ The words that earned the person `human` in §1, byte for byte, in this turn too.
      expect(JSON.stringify(heard?.message)).toContain('ultracode: plan the release')
      expect(heard?.origin).toStrictEqual({ kind: 'peer', from: pm, name: displayNameOf('pm') })
      expect(heard?.origin?.kind).not.toBe('human')
    })

    it('⚑ …and on the FLUSH too: a message held behind a busy agent keeps the sender it was queued with', async () => {
      const { pm, worker, pmTools, label } = await aPmAndItsWorker('the work')
      await waitFor(() => queryOf('worker-a').heard.length === 1, 'the work to start')
      await waitFor(() => idle(worker), 'the worker to finish its first turn')
      queryOf('worker-a').holding = true
      await callOn(pmTools, 'message_agent', {
        kind: 'follow-up',
        agent: worker,
        text: 'how is it going?',
        piece: label,
      })
      await waitFor(() => queryOf('worker-a').heard.length === 2, 'the question to start a turn')
      const held = await callOn(pmTools, 'message_agent', {
        kind: 'follow-up',
        agent: worker,
        text: 'ultracode — and this one waits',
        piece: label,
      })
      // ⛔ **HELD, not sent** — `message_agent` answers `ok` on both branches, and only `delivery`
      // says which. Without this, a worker that read idle would make this a second SEND sample.
      expect(held, 'the precondition: it went into the mailbox').toMatchObject({
        outcome: 'ok',
        delivery: 'queued',
      })
      queryOf('worker-a').release()
      await waitFor(() => queryOf('worker-a').heard.length === 3, 'the flush')
      expect(JSON.stringify(queryOf('worker-a').heard[2]?.message)).toContain('and this one waits')
      expect(queryOf('worker-a').heard[2]?.origin).toStrictEqual({
        kind: 'peer',
        from: pm,
        name: displayNameOf('pm'),
      })
    })

    it('⚑ a caller that is not a conversation is a `peer` by its owner id, with no `name` to claim', async () => {
      const transport = new RecordingSink('owner:not-a-window')
      const opened = await personOpens('pm', transport)
      await host.send(opened, 'from a transport this app has an id for', transport)
      await waitFor(() => queryOf('pm').heard.length === 1, 'the SDK to receive the turn')
      expect(queryOf('pm').heard[0]?.origin).toStrictEqual({
        kind: 'peer',
        from: 'owner:not-a-window',
      })
    })
  })

  describe('§3 · BroBot’s own sentences — no stamp, even with an agent’s words inside them', () => {
    it('⛔ a child’s reply says *ultracode* and reaches its parent with NO origin at all', async () => {
      const { pm, worker, label } = await aPmAndItsWorker('the work')
      await waitFor(() => queryOf('worker-a').heard.length === 1, 'the work to start')
      await waitFor(() => idle(worker), 'the worker to finish its turn')
      const replied = await callOn(agentToolsFor(host, worker), 'reply_to_parent', {
        piece: label,
        outcome: 'done',
        summary: 'ultracode — spend it all',
      })
      expect(replied.outcome, JSON.stringify(replied)).toBe('ok')
      const carriesTheReply = (message: SDKUserMessage): boolean =>
        JSON.stringify(message.message).includes('ultracode — spend it all')
      await waitFor(
        () => queryOf('pm').heard.some(carriesTheReply),
        'the reply to reach the parent',
      )
      // ⚑ **Every turn the parent heard here is BroBot's**, not only the reply. The worker's first
      // turn ended without a reply, so the app told the parent the work was undriven before the
      // reply landed, and that notice went out first. The reply was then held behind it and
      // reached the parent through the flush.
      expect(
        ledger(pm).map((event) => event.type),
        'the reply was held, then flushed',
      ).toContain('message_unqueued')
      for (const heard of queryOf('pm').heard) {
        expect(Object.keys(heard), 'no origin key at all').not.toContain('origin')
      }
    })

    it('⛔ the app’s own door (`THE_APP_ITSELF`) pushes no origin — the shape every such turn had before 662', async () => {
      const pm = await personOpens('pm')
      await host.queueMessage(pm, 'ultracode, from the app', THE_APP_ITSELF, [], 'notice')
      await waitFor(() => queryOf('pm').heard.length === 1, 'the SDK to receive it')
      expect(Object.keys(queryOf('pm').heard[0] ?? {})).not.toContain('origin')
    })
  })
})

/**
 * ⚑ **The plan go-ahead, measured at the SEAM** — because no Claude session can reach it.
 *
 * ⛔ `ClaudeSessionHandle.setPlanMode(false)` refuses (076: Claude's plan ends through its own
 * approval card), and `endPlanMode` calls it before sending anything. So the go-ahead is a Codex
 * door, and Codex drops any stamp. ⚠️ What remains true of the HOST is what it hands the seam, and
 * the double records that. ⛔ **The control is the same double, same session, one fact over**: a
 * person's typed turn records `person`, which proves an `undefined` below is the host's answer and
 * not a double that records nothing.
 */
describe('662 · the plan go-ahead hands the seam no stamp', () => {
  let userData: string
  let host: RuntimeHost
  let handles: FakeSessionHandle[]

  class Recording extends FakeRuntime {
    constructor(provider: Provider) {
      super(provider, { sessions: new FakeProviderSessions() })
    }
    override async start(options: StartOptions): Promise<FakeSessionHandle> {
      const handle = await super.start(options)
      handles.push(handle)
      return handle
    }
  }

  beforeEach(() => {
    userData = mkdtempSync(join(tmpdir(), 'brobot2-go-ahead-'))
    handles = []
    let counter = 0
    host = new RuntimeHost({
      store: NULL_SESSION_STORE,
      discoverSessions: NO_DISCOVERY,
      nativeTranscriptPath: () => null,
      exportDirectory: () => join(userData, 'exports'),
      createRuntime: (provider: Provider) => new Recording(provider),
      prepareProviderHome: (provider: Provider) => join(userData, 'provider-homes', provider),
      providerHomePath: (provider: Provider) => join(userData, 'provider-homes', provider),
      resolveCwd: (sessionId) => join(userData, 'scratch', sessionId),
      newSessionId: () => `sess_${String(++counter)}`,
      readProviderConfig: (provider, home) => ({
        home,
        homeEnv: 'CODEX_HOME',
        model: 'm',
        authNote: null,
        files: [],
      }),
    })
  })

  afterEach(async () => {
    await host.closeAll()
    rmSync(userData, { recursive: true, force: true })
  })

  it('⛔ the go-ahead is BroBot’s sentence, so the seam gets `undefined` — while a typed turn gets `person`', async () => {
    const window = new RecordingSink(sinkOwnerId({ id: 1 }))
    const { sessionId } = await host.createSession(
      { provider: 'codex', planMode: true, approvalMode: 'auto' },
      window,
    )
    const handle = handles.at(-1)
    if (handle === undefined) throw new Error('no handle was issued')
    await host.send(sessionId, 'plan it', window)
    await waitFor(() => handle.status() === 'idle', 'the planning turn to end')
    await host.endPlanMode(sessionId, window, GO_AHEAD_MESSAGE)
    expect(handle.origins, 'the typed turn, then the go-ahead').toStrictEqual([
      { kind: 'person' },
      undefined,
    ])
  })
})

/**
 * 🔴 **The census: every call into `SessionHandle.send` in this app passes a provenance the host
 * DERIVED** (§5.2) — read from the CALL, never from the mention
 * (`a-census-that-asks-for-the-import-must-ask-for-the-call`).
 *
 * ## ⚠️ The search shape, named so its negative means something (standing rule 4)
 *
 * ⛔ **Every `.ts` under `src/`**, walked from the directory and not listed by hand (rule 27.1),
 * and parsed with the TypeScript parser, so comments and strings are never read as calls. A call
 * is counted when its callee is `<receiver>.send` and the receiver, once `!`, parentheses and
 * `as` are unwrapped, is spelled `handle` or `<anything>.handle`. That is how this app holds a
 * `SessionHandle`: `HostedSession.handle`, `SessionSlot.handle`, and parameters named `handle`.
 * ⚠️ **What it cannot see:** a handle held under another name (`const h = session.handle`), one
 * returned by a call (`this.handleOf(id).send`), or `send` destructured off it. The type checker
 * could, and this file does not boot one, for `ultracode.test.ts`' reason (seconds on every run).
 * The positive control below proves the matcher finds every shape of call the host makes today —
 * three since D-027.
 *
 * ## ⛔ The rule each call is held to — DERIVED, not merely spelled through `stampFor`
 *
 * ⚑ **The second argument is `this.stampFor(<who>, <attached>)`**, the host's one door onto
 * `provenanceOf`, and both of its arguments are checked against the method the call sits in:
 *
 * - **`<who>`**: where that method frames the words with `messageNamingItsSender`, it is the SAME
 *   expression every such frame is given. Where it frames nothing, it is the literal `null`: the
 *   app's own words. ⛔ A hand-written `THE_PERSON_AT_A_WINDOW`, or any value the frame did not
 *   read, fails.
 * - **`<attached>`**: where that method composes an attachment block with
 *   `messageWithHandedPaths`, it is the SAME expression that block is given. Where it composes
 *   none, it is the literal `[]`.
 *
 * ⚠️ **"That method" is the nearest method or function DECLARATION**, not the nearest arrow, so a
 * send inside a callback is still held to the frame of the method around it.
 *
 * ## 🔴 D-027 · the second shape — a turn of several, stamped per message
 *
 * ⚑ **`this.stampForATurnOf(<list>)`** is the other stamp a call may pass: several held messages
 * handed over as ONE turn (`handTogetherToProvider`), each framed as it would have been alone. ⛔ It
 * is held to the SAME rule, per message:
 *
 * - **every frame and every block of that method is built inside `<list>.map(…)`** — each message
 *   framed from its own entry of the list the stamp is asked about, and never from anything else;
 * - **the class's own `stampForATurnOf` derives each message's stamp as `this.stampFor(<who>,
 *   <attached>)` inside `<its list>.map(…)`**, with `<who>` the SAME expression every frame of the
 *   door is given and `<attached>` the SAME expression every block is — the rule above, once for
 *   each message. ⚠️ How the per-message stamps become one (`theStampOfSeveral`) is pinned by its
 *   answers below, as `provenanceOf` is.
 */
describe('662 · census — every `handle.send` passes a derived provenance', () => {
  interface SendCall {
    readonly file: string
    readonly line: number
    readonly args: readonly ts.Expression[]
    readonly frames: readonly string[]
    readonly blocks: readonly string[]
    /** ⚑ D-027 · for each frame and block of the method, the lists whose `.map(…)` builds it. */
    readonly framedOver: readonly (readonly string[])[]
    /** ⚑ D-027 · the class's own `stampForATurnOf`, as the per-message stamps it derives. */
    readonly perMessage: PerMessage | null
    readonly source: ts.SourceFile
  }

  /** ⚑ D-027 · what a class's `stampForATurnOf(<list>)` derives, one `this.stampFor` at a time. */
  interface PerMessage {
    readonly list: string | null
    readonly stamps: readonly {
      readonly call: string
      readonly args: readonly string[]
      readonly over: readonly string[]
    }[]
  }

  const sourceFiles = (dir: string): string[] =>
    readdirSync(dir).flatMap((name) => {
      const path = join(dir, name)
      if (statSync(path).isDirectory()) return sourceFiles(path)
      return name.endsWith('.ts') && !name.endsWith('.d.ts') ? [path] : []
    })

  const unwrap = (node: ts.Expression): ts.Expression => {
    let at = node
    while (
      ts.isNonNullExpression(at) ||
      ts.isParenthesizedExpression(at) ||
      ts.isAsExpression(at) ||
      ts.isTypeAssertionExpression(at)
    ) {
      at = at.expression
    }
    return at
  }

  const isHandle = (node: ts.Expression): boolean => {
    const at = unwrap(node)
    return (
      (ts.isIdentifier(at) && at.text === 'handle') ||
      (ts.isPropertyAccessExpression(at) && at.name.text === 'handle')
    )
  }

  /** The nearest method or function DECLARATION around a node — never an arrow or a callback. */
  const enclosingDeclaration = (node: ts.Node): ts.Node => {
    let at: ts.Node = node
    while (
      at.parent &&
      !ts.isMethodDeclaration(at) &&
      !ts.isFunctionDeclaration(at) &&
      !ts.isConstructorDeclaration(at) &&
      !ts.isGetAccessorDeclaration(at) &&
      !ts.isSetAccessorDeclaration(at) &&
      !ts.isPropertyDeclaration(at)
    ) {
      at = at.parent
    }
    return at
  }

  /** Every `<name>(_, X)` in a subtree, as the source text of X. */
  const secondArgumentsOf = (root: ts.Node, name: string, source: ts.SourceFile): string[] => {
    const found: string[] = []
    const look = (node: ts.Node): void => {
      if (
        ts.isCallExpression(node) &&
        ts.isIdentifier(node.expression) &&
        node.expression.text === name
      ) {
        const second = node.arguments[1]
        if (second !== undefined) found.push(second.getText(source))
      }
      ts.forEachChild(node, look)
    }
    look(root)
    return found
  }

  /**
   * ⚑ **D-027 · the lists a node is built over** — the receiver of every `<list>.map(…)` whose
   * argument holds it: a message framed inside `messages.map(({ queued }) => …)` is built over
   * `messages`.
   */
  const listsMappedAround = (node: ts.Node, source: ts.SourceFile): string[] => {
    const lists: string[] = []
    for (let at: ts.Node | undefined = node.parent; at !== undefined; at = at.parent) {
      if (
        ts.isCallExpression(at) &&
        ts.isPropertyAccessExpression(at.expression) &&
        at.expression.name.text === 'map' &&
        at.arguments.some((arg) => arg.pos <= node.pos && node.end <= arg.end)
      ) {
        lists.push(at.expression.expression.getText(source))
      }
    }
    return lists
  }

  /** ⚑ D-027 · every call to one of `names` in a subtree, as the lists it is built over. */
  const builtOver = (
    root: ts.Node,
    names: readonly string[],
    source: ts.SourceFile,
  ): string[][] => {
    const found: string[][] = []
    const look = (node: ts.Node): void => {
      if (
        ts.isCallExpression(node) &&
        ts.isIdentifier(node.expression) &&
        names.includes(node.expression.text)
      ) {
        found.push(listsMappedAround(node, source))
      }
      ts.forEachChild(node, look)
    }
    look(root)
    return found
  }

  /**
   * ⚑ **D-027 · the `stampForATurnOf` of the class a call sits in** — each `this.stampFor(…)` it
   * makes, with the lists it is made over; ⛔ `null` when the class has none.
   */
  const perMessageStampsOf = (node: ts.Node, source: ts.SourceFile): PerMessage | null => {
    let at: ts.Node | undefined = node
    while (at !== undefined && !ts.isClassDeclaration(at) && !ts.isClassExpression(at)) {
      at = at.parent
    }
    if (at === undefined) return null
    const method = at.members.find(
      (member): member is ts.MethodDeclaration =>
        ts.isMethodDeclaration(member) &&
        ts.isIdentifier(member.name) &&
        member.name.text === 'stampForATurnOf',
    )
    if (method === undefined) return null
    const [first] = method.parameters
    const stamps: PerMessage['stamps'][number][] = []
    const look = (inner: ts.Node): void => {
      if (
        ts.isCallExpression(inner) &&
        ts.isPropertyAccessExpression(inner.expression) &&
        inner.expression.expression.kind === ts.SyntaxKind.ThisKeyword &&
        inner.expression.name.text === 'stampFor'
      ) {
        stamps.push({
          call: inner.getText(source),
          args: inner.arguments.map((arg) => arg.getText(source)),
          over: listsMappedAround(inner, source),
        })
      }
      ts.forEachChild(inner, look)
    }
    look(method)
    return {
      list: first !== undefined && ts.isIdentifier(first.name) ? first.name.text : null,
      stamps,
    }
  }

  /** Every `handle.send(…)` in one source, with the frames and blocks its method builds. */
  const sendCallsIn = (file: string, text: string): SendCall[] => {
    const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true)
    const found: SendCall[] = []
    const visit = (node: ts.Node): void => {
      if (
        ts.isCallExpression(node) &&
        ts.isPropertyAccessExpression(node.expression) &&
        node.expression.name.text === 'send' &&
        isHandle(node.expression.expression)
      ) {
        const around = enclosingDeclaration(node)
        found.push({
          file,
          line: source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1,
          args: [...node.arguments],
          frames: secondArgumentsOf(around, 'messageNamingItsSender', source),
          blocks: secondArgumentsOf(around, 'messageWithHandedPaths', source),
          framedOver: builtOver(
            around,
            ['messageNamingItsSender', 'messageWithHandedPaths'],
            source,
          ),
          perMessage: perMessageStampsOf(node, source),
          source,
        })
      }
      ts.forEachChild(node, visit)
    }
    visit(source)
    return found
  }

  /** ⚑ `<who>` and `<attached>` against what the method frames and quotes — the rule's heart. */
  const whatTheStampMisreads = (
    call: SendCall,
    who: string | undefined,
    attached: string | undefined,
  ): string[] => {
    const wrong: string[] = []
    if (call.frames.length === 0 ? who !== 'null' : call.frames.some((frame) => frame !== who)) {
      wrong.push(
        `stamps ${String(who)} but frames ${call.frames.join(' / ') || 'nothing (so: null)'}`,
      )
    }
    if (
      call.blocks.length === 0 ? attached !== '[]' : call.blocks.some((block) => block !== attached)
    ) {
      wrong.push(
        `stamps attached ${String(attached)} but the block quotes ${call.blocks.join(' / ') || 'nothing (so: [])'}`,
      )
    }
    return wrong
  }

  /**
   * 🔴 **D-027 · a turn of several** — the list stamped is the list every message is framed from,
   * and the class's `stampForATurnOf` derives each message's stamp by the rule, over its own list.
   */
  const whatIsWrongPerMessage = (call: SendCall, list: string): string[] => {
    const wrong: string[] = []
    if (call.framedOver.length === 0) wrong.push(`stamps a turn of ${list} but frames none of it`)
    if (call.framedOver.some((lists) => !lists.includes(list))) {
      wrong.push(`stamps a turn of ${list} but frames a message outside ${list}.map`)
    }
    const derived = call.perMessage
    if (derived === null) return [...wrong, 'stamps a turn but its class has no stampForATurnOf']
    if (derived.stamps.length === 0) {
      wrong.push('its stampForATurnOf derives no this.stampFor(who, attached)')
    }
    for (const one of derived.stamps) {
      if (derived.list === null || !one.over.includes(derived.list)) {
        wrong.push(`its stampForATurnOf makes ${one.call} outside ${String(derived.list)}.map`)
      }
      if (one.args.length !== 2) {
        wrong.push(`its stampForATurnOf makes ${one.call}, not this.stampFor(who, attached)`)
        continue
      }
      wrong.push(...whatTheStampMisreads(call, one.args[0], one.args[1]))
    }
    return wrong
  }

  /** The rule, as a list of what is wrong with one call — empty when it holds. */
  const whatIsWrong = (call: SendCall): string[] => {
    const stamp = call.args[1]
    if (call.args.length !== 2 || stamp === undefined) {
      return [`passes ${String(call.args.length)} argument(s), not the words and a stamp`]
    }
    const isThis = (name: string, count: number): boolean =>
      ts.isCallExpression(stamp) &&
      ts.isPropertyAccessExpression(stamp.expression) &&
      stamp.expression.expression.kind === ts.SyntaxKind.ThisKeyword &&
      stamp.expression.name.text === name &&
      stamp.arguments.length === count
    // 🔴 **D-027 · the second door's shape**, held to the same rule per message.
    if (isThis('stampForATurnOf', 1) && ts.isCallExpression(stamp)) {
      const [list] = stamp.arguments
      if (list !== undefined && ts.isIdentifier(list)) {
        return whatIsWrongPerMessage(call, list.text)
      }
    }
    if (!isThis('stampFor', 2) || !ts.isCallExpression(stamp)) {
      return [
        `stamps with ${stamp.getText(call.source)}, not this.stampFor(who, attached) or this.stampForATurnOf(messages)`,
      ]
    }
    const [who, attached] = stamp.arguments.map((arg) => arg.getText(call.source))
    return whatTheStampMisreads(call, who, attached)
  }

  it('⚑ every call in the app holds, and the census found the calls it is aimed at', () => {
    const calls = sourceFiles(srcRoot).flatMap((file) =>
      sendCallsIn(file, readFileSync(file, 'utf8')),
    )
    // ⚑ The positive control: the host's three calls today, each by its own shape. A matcher that
    // found nothing, or only some of them, would pass the rule below over less than it claims.
    // 🔴 **D-027 moved the count from two to three**: `handTogetherToProvider` hands a turn of
    // several held messages over, stamped per message.
    const stamps = calls.map((call) => call.args[1]?.getText(call.source))
    expect(stamps).toContain('this.stampFor(from, handed)')
    expect(stamps).toContain('this.stampFor(null, [])')
    expect(stamps).toContain('this.stampForATurnOf(messages)')
    const broken = calls.flatMap((call) =>
      whatIsWrong(call).map((why) => `${call.file}:${String(call.line)} ${why}`),
    )
    expect(broken).toStrictEqual([])
  })

  it('🔴 CONTROL · each rule is broken TWICE in one file, and every break is caught', () => {
    // ⛔ Standing rule 12: two plants per rule, in ONE file, so a census that stopped at the first
    // hit — per file or per rule — would report one of each pair and pass the other.
    const planted = sendCallsIn(
      'planted.ts',
      [
        'class Planted {',
        // passes no derived stamp at all, twice (one through a non-null receiver)
        '  async a1(session) { await session.handle.send(text) }',
        "  async a2(session) { await session.handle!.send(text, { kind: 'person' }) }",
        // frames nothing, so the stamp must be null; a hand-written person and an unread value
        '  async b1(session) { await session.handle.send(text, this.stampFor(THE_PERSON_AT_A_WINDOW, [])) }',
        '  async b2(session, from) { await session.handle.send(text, this.stampFor(from, [])) }',
        // frames `from` and stamps something else, once directly and once inside a callback
        '  async c1(session, from, other) {',
        '    const words = messageNamingItsSender(text, from)',
        '    await session.handle.send(words, this.stampFor(other, []))',
        '  }',
        '  async c2(session, from) {',
        '    const words = messageNamingItsSender(text, from)',
        '    await run(async () => session.handle.send(words, this.stampFor(null, [])))',
        '  }',
        // quotes `handed` in the block and stamps a different attachment list
        '  async d1(session, from, handed) {',
        '    const words = messageNamingItsSender(messageWithHandedPaths(text, handed), from)',
        '    await session.handle.send(words, this.stampFor(from, []))',
        '  }',
        '  async d2(session, handed) {',
        '    const words = messageWithHandedPaths(text, handed)',
        '    await (session.handle as SessionHandle).send(words, this.stampFor(null, other))',
        '  }',
        // ⚑ and one that HOLDS, inside a callback, so the checker is not refusing everything
        '  async ok(session, from, handed) {',
        '    const words = messageNamingItsSender(messageWithHandedPaths(text, handed), from)',
        '    await run(async () => session.handle.send(words, this.stampFor(from, handed)))',
        '  }',
        // 🔴 D-027 · a turn of several stamps the list it frames — a list it does not frame, and a
        // frame built outside any list (this class's own derivation holds, so only that is wrong)
        '  async e1(session, messages, others) {',
        '    const words = messages.map(({ queued, handed }) => messageNamingItsSender(messageWithHandedPaths(text, handed.paths), queued.origin ?? null))',
        '    await session.handle.send(words.join(""), this.stampForATurnOf(others))',
        '  }',
        '  async e2(session, messages) {',
        '    const [{ queued, handed }] = messages',
        '    const words = messageNamingItsSender(messageWithHandedPaths(text, handed.paths), queued.origin ?? null)',
        '    await session.handle.send(words, this.stampForATurnOf(messages))',
        '  }',
        '  stampForATurnOf(messages) {',
        '    return theStampOfSeveral(messages.map(({ queued, handed }) => this.stampFor(queued.origin ?? null, handed.paths)))',
        '  }',
        '}',
        // 🔴 D-027 · …and its class derives each message's stamp from what that message's frame
        // and block read: a hand-written person, and an attachment list the block did not quote
        'class PlantedWho {',
        '  async f1(session, messages) {',
        '    const words = messages.map(({ queued, handed }) => messageNamingItsSender(messageWithHandedPaths(text, handed.paths), queued.origin ?? null))',
        '    await session.handle.send(words.join(""), this.stampForATurnOf(messages))',
        '  }',
        '  stampForATurnOf(messages) {',
        '    return theStampOfSeveral(messages.map(({ handed }) => this.stampFor(THE_PERSON_AT_A_WINDOW, handed.paths)))',
        '  }',
        '}',
        'class PlantedAttached {',
        '  async f2(session, messages) {',
        '    const words = messages.map(({ queued, handed }) => messageNamingItsSender(messageWithHandedPaths(text, handed.paths), queued.origin ?? null))',
        '    await session.handle.send(words.join(""), this.stampForATurnOf(messages))',
        '  }',
        '  stampForATurnOf(messages) {',
        '    return theStampOfSeveral(messages.map(({ queued }) => this.stampFor(queued.origin ?? null, [])))',
        '  }',
        '}',
        // 🔴 D-027 · …once PER MESSAGE, over its own list: the first message's stamp for all of
        // them, and a map over some other list
        'class PlantedFirst {',
        '  async g1(session, messages) {',
        '    const words = messages.map(({ queued, handed }) => messageNamingItsSender(messageWithHandedPaths(text, handed.paths), queued.origin ?? null))',
        '    await session.handle.send(words.join(""), this.stampForATurnOf(messages))',
        '  }',
        '  stampForATurnOf(messages) {',
        '    const [{ queued, handed }] = messages',
        '    return this.stampFor(queued.origin ?? null, handed.paths)',
        '  }',
        '}',
        'class PlantedOther {',
        '  async g2(session, messages) {',
        '    const words = messages.map(({ queued, handed }) => messageNamingItsSender(messageWithHandedPaths(text, handed.paths), queued.origin ?? null))',
        '    await session.handle.send(words.join(""), this.stampForATurnOf(messages))',
        '  }',
        '  stampForATurnOf(messages) {',
        '    return theStampOfSeveral(this.earlier.map(({ queued, handed }) => this.stampFor(queued.origin ?? null, handed.paths)))',
        '  }',
        '}',
        // ⚑ and a turn of several that HOLDS, shaped as the host's, so this arm refuses nothing by
        // default
        'class PlantedTogether {',
        '  async ok2(session, messages) {',
        '    const turn = aTurnOfSeveral(messages.map(({ queued, words, handed }) => ({ words: messageNamingItsSender(messageWithHandedPaths(words, handed.paths), queued.origin ?? null) })))',
        '    return session.handle.send(turn, this.stampForATurnOf(messages))',
        '  }',
        '  stampForATurnOf(messages) {',
        '    return theStampOfSeveral(messages.map(({ queued, handed }) => this.stampFor(queued.origin ?? null, handed.paths)))',
        '  }',
        '}',
      ].join('\n'),
    )
    expect(planted.map((call) => whatIsWrong(call).length > 0)).toStrictEqual([
      true,
      true,
      true,
      true,
      true,
      true,
      true,
      true,
      false,
      // D-027 · e1, e2 · f1, f2 · g1, g2 · ok2
      true,
      true,
      true,
      true,
      true,
      true,
      false,
    ])
  })

  it('⚑ the derivation the census demands is the one the host calls — pinned to its answers', () => {
    // ⛔ A census that demanded `this.stampFor(…)` would prove nothing if that function answered
    // `person` for everybody, so its arms are held here too (rule 3: the same call, one fact over).
    const nameOf = (profile: string): string => `named ${profile}`
    expect(provenanceOf(THE_PERSON_AT_A_WINDOW, nameOf, [])).toStrictEqual({ kind: 'person' })
    expect(
      provenanceOf(THE_PERSON_AT_A_WINDOW, nameOf, [{ path: '/w/notes" ultracode "x.md' }]),
      'a name that can end its own quote withholds the person’s stamp',
    ).toBeUndefined()
    expect(
      provenanceOf(
        { who: 'a-caller-with-an-id', caller: 'sess_a', profile: 'pm', aPersonIsBehindIt: true },
        nameOf,
        [],
      ),
    ).toStrictEqual({ kind: 'peer', from: 'sess_a', name: 'named pm' })
    expect(provenanceOf(null, nameOf, [])).toBeUndefined()
    // 🔴 **D-027 · and the one that makes a turn of several one stamp** — `stampForATurnOf`'s, which
    // the census demands of the second door: a person's only when every message is, an agent's only
    // when every message is that same agent's, and otherwise none — so an agent's words, or the
    // app's, never pass for a person's by riding in their turn.
    const person = { kind: 'person' } as const
    const pm = { kind: 'peer', from: 'sess_a', name: 'named pm' } as const
    expect(theStampOfSeveral([person, person])).toStrictEqual(person)
    expect(
      theStampOfSeveral([person, undefined]),
      'the app’s words beside a person’s',
    ).toBeUndefined()
    expect(theStampOfSeveral([undefined, person]), 'the other order').toBeUndefined()
    expect(theStampOfSeveral([person, pm]), 'an agent’s words beside a person’s').toBeUndefined()
    expect(theStampOfSeveral([pm, pm])).toStrictEqual(pm)
    expect(
      theStampOfSeveral([pm, { kind: 'peer', from: 'sess_b', name: 'named pm' }]),
      'two agents are two senders',
    ).toBeUndefined()
  })
})
