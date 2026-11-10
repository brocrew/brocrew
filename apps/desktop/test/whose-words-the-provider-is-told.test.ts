import { waitFor } from './lib/f093-host'
import type { TranscriptEvent } from '../src/shared/conversation-events'
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { SDKMessage, SDKUserMessage } from '@anthropic-ai/claude-agent-sdk'
import { ClaudeRuntime } from '@brobot2/runtime/claude'
import {
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
import { giverStallReceipts, RuntimeHost, THE_APP_ITSELF } from './helpers/giver-notice-host'
import type { Caller, RuntimeEventSink } from './helpers/giver-notice-host'
import { agentCallerId, agentToolsFor } from '../src/main/runtime/agent-tools'
import { sinkOwnerId } from '../src/main/runtime/window-caller'
import {
  provenanceOf,
  THE_PERSON_AT_A_WINDOW,
  theStampOfSeveral,
} from '../src/main/runtime/turn-origin'
import { resourcesRoot } from '../src/main/resources/resources'
import { resolveSessionCwd } from '../src/main/runtime/scratch-cwd'
import { GO_AHEAD_MESSAGE } from '../src/renderer/src/lib/plan-mode'
import { RecordingSink, syntheticProviderHome, neutralHostDeps } from './lib/host-fixture'
import { callOn } from './helpers/call-tool'

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
      ...neutralHostDeps(() => userData),
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
      prepareProviderHome: syntheticProviderHome(() => userData),
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
      ...neutralHostDeps(() => userData),
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

describe('the stamp the host derives for a turn', () => {
  it('⚑ provenanceOf and theStampOfSeveral — pinned to their answers', () => {
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
    // A turn of several gets a person's stamp only when every message is a person's, an agent's
    // only when every message is that same agent's, and otherwise none.
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
