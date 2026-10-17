import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
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
import { CHANNEL_REFUSALS, CHANNEL_REFUSAL_SENTENCES } from '@brobot2/runtime'
import type { Provider } from '@brobot2/shared'
import { type AppDatabase, openDatabase } from '../src/main/db/connection'
import { applyMigrations } from '../src/main/db/migrate'
import { createSessionStore, type SessionStore } from '../src/main/db/session-store'
import { NO_DISCOVERY } from '../src/main/adopt/discover-sessions'
import { RuntimeHost } from '../src/main/runtime/runtime-host'
import type { RuntimeEventSink } from '../src/main/runtime/runtime-host'
import { agentToolsFor, type ToolName } from '../src/main/runtime/agent-tools'
import { resourcesRoot } from '../src/main/resources/resources'
import { resolveSessionCwd } from '../src/main/runtime/scratch-cwd'
import { REQUEST_IS_OPEN, permissionShaped, theChannelRefusalIn } from '../src/shared/questions'
import { agentName, type PersistedEventInfo, type TranscriptEvent } from '../src/shared/runtime-ipc'
import type { RuntimeEventMessage } from '../src/shared/runtime-ipc'

/**
 * 🔴 **403 · the queue that cannot see a permission** — HO-007 criterion 11's other half, from
 * `402` F1 and HO-018 §5 item 3.
 *
 * ⚑ The PO's words, quoted in the brief that asked for this:
 *
 * > ⛔ **"A chain that stops before the person is not a chain — it is the feature not existing,
 * > disclosed as a backend."**
 *
 * ## ⛔ Three facts that only bite together, and a live run put them together
 *
 * 1. **Every spawned child is `ask` BY RAIL** — `spawnRequestSchema` defaults the mode to `ask`,
 *    its enum admits only `ask` and `auto`, and `admitSpawn` refuses `auto` by the named rail
 *    `spawn-must-prompt` — so the first consequential tool call an agent-created conversation
 *    makes parks on a permission card. ⚠️ **`admitSpawn`, not `assertMaySpawn`**: that name is in
 *    `402` F1 and in this dispatch's brief, and no such declaration exists in this repo.
 * 2. **Only a person may answer it**: the window that holds the conversation, or, while no window
 *    holds it, a person from the queue. A spawned child is reserved under no owner, and
 *    `releaseSession` hands a claimed one back to nobody.
 * 3. ⛔ **`questionsForAPerson` is structurally unable to list one.** It starts from
 *    `questionsAPersonMustAnswer`, and `escalationsDue` never returns a routing with a `because` — so a
 *    permission-shaped request has `escalatedAt === null` for ever.
 *
 * 🔴 **Measured on both of `402`'s final live runs: three permissions needed a person on the
 * worker alone, and `questionsForAPerson()` listed 0 of them.** So a child frozen on an answer
 * only a person can give was in NONE of Home's populations.
 *
 * ## ⛔ The fix is a SECOND reader, and never a widened first one
 *
 * ⚠️ **Knowledge escalates; authority does not.** A question may travel — worker to PM to a
 * person. A request refused entry to the channel may only ever reach a person, and criterion 10's
 * negative rides on `questionsForAPerson` being unable to return one. ⛔ **Widening a predicate
 * widens every question the field answers**, so §2 measures the two readers where their readings
 * DIVERGE rather than where they agree.
 *
 * ⚑ **Real host, real SQLite, real migrations, real tools, real filesystem.** The only double is
 * the provider, and every row here is planted the way `402` measured it: through `give_work` (D-016:
 * it took `spawn_agent`'s place), on a conversation with no surface, by a turn that really parked on
 * a card.
 */

const here = dirname(fileURLToPath(import.meta.url))
const migrationsFolder = join(here, '../src/main/db/migrations')
const mainRoot = join(here, '../src/main')
const sharedRoot = join(here, '../src/shared')

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

/** `394`'s double, with the handles kept — a test has to BE the provider to park a turn on a card. */
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

describe('403 · a decision only a person can make', () => {
  let userData: string
  let root: string
  let db: AppDatabase
  let store: SessionStore
  let host: RuntimeHost
  let hosts: RuntimeHost[]
  let handles: FakeSessionHandle[]
  let issued: FakeProviderSessions
  let counter: number
  let clock: number
  let window: RecordingSink
  let claimed: Set<string>
  let pairs: number
  const tick = (): number => clock++

  const buildHost = (over: SessionStore = store): RuntimeHost => {
    const built = new RuntimeHost({
      store: over,
      discoverSessions: NO_DISCOVERY,
      nativeTranscriptPath: () => null,
      exportDirectory: () => join(userData, 'exports'),
      resourcesRoot: () => resourcesRoot(userData),
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
    hosts.push(built)
    return built
  }

  beforeEach(() => {
    userData = mkdtempSync(join(tmpdir(), 'brobot2-decision-'))
    root = mkdtempSync(join(tmpdir(), 'brobot2-decision-root-'))
    db = openDatabase(join(userData, 'brobot2.sqlite'))
    applyMigrations(db, migrationsFolder)
    clock = 8_000_000
    store = createSessionStore(db, tick)
    counter = 0
    hosts = []
    handles = []
    issued = new FakeProviderSessions()
    host = buildHost()
    window = new RecordingSink('webContents:1')
    claimed = new Set<string>()
    pairs = 0
  })

  afterEach(async () => {
    for (const built of hosts) await built.closeAll()
    db.close()
    for (const dir of [userData, root]) rmSync(dir, { recursive: true, force: true })
  })

  const personOpens = async (
    profileId: string,
    approvalMode: 'ask' | 'auto' = 'ask',
  ): Promise<string> => {
    const { sessionId } = await host.createSession(
      { provider: 'claude', profileId, approvalMode, cwd: root },
      window,
    )
    return sessionId
  }

  const bringIdentityIntoBeing = async (profileId: string): Promise<void> => {
    const id = await personOpens(profileId)
    await host.close(id, window)
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

  const said = async (
    toolset: AgentToolset,
    name: ToolName,
    args: Record<string, unknown> = {},
  ): Promise<string> => {
    const tool = toolset.tools.find((one) => one.name === name)
    if (tool === undefined) throw new Error(`no such tool: ${name}`)
    return (await tool.call(args)).text
  }

  const entries = (sessionId: string): readonly PersistedEventInfo[] => store.events(sessionId)
  const ledger = (sessionId: string): TranscriptEvent[] =>
    entries(sessionId).map((entry) => entry.event)

  const latestHandle = (): FakeSessionHandle => {
    const handle = handles.at(-1)
    if (handle === undefined) throw new Error('no provider handle has been issued')
    return handle
  }

  /**
   * `393`'s helper, widened to N children: a PM in a window with `count` children of its own,
   * every one started through the real door — ⚑ D-016 · by a give, whose brief is the child's
   * first turn.
   *
   * ⚑ **N because a turn parks and STAYS parked.** A conversation waiting on a permission is not
   * running a second turn, so three open cards are three conversations — which is also the shape
   * a PM with three workers actually reaches, and a stronger control for a fold than three rows
   * in one ledger would be.
   *
   * ⚠️ **`approvalMode` is the PM's, and a child runs in its giver's** — so an `auto` PM's
   * children run their brief to its end with no card, which is the one way to hold a child that is
   * frozen on nothing now that a give always drives a turn.
   */
  const aPmAndItsWorkers = async (
    count = 1,
    approvalMode: 'ask' | 'auto' = 'ask',
  ): Promise<{
    pm: string
    workers: string[]
    pmTools: AgentToolset
    handlesOf: Map<string, FakeSessionHandle>
  }> => {
    const nth = ++pairs
    const pmProfile = `pm-${String(nth)}`
    const siblings = Array.from(
      { length: count + 1 },
      (_unused, index) => `worker-${String(nth)}-${String(index)}`,
    )
    for (const one of siblings) await bringIdentityIntoBeing(one)
    const pm = await personOpens(pmProfile, approvalMode)
    claimed.add(pm)
    const pmTools = agentToolsFor(host, pm)
    const workers: string[] = []
    const handlesOf = new Map<string, FakeSessionHandle>()
    for (let index = 0; index < count; index++) {
      const spawned = await callOn(pmTools, 'give_work', {
        definition_of_done: 'The requested result and its checks are recorded.',
        profile: siblings[index],
        title: 'the work this dispatch is about',
        brief: 'do the thing',
      })
      expect(spawned.outcome, JSON.stringify(spawned)).toBe('ok')
      workers.push(spawned.agent as string)
      handlesOf.set(spawned.agent as string, latestHandle())
      // ⚠️ **Parked before the next give**, so the cards are raised — and stamped — in the order the
      // workers were given, as they were when each child was sent its work one at a time.
      if (approvalMode === 'ask') await aChildParksOnAPermission(spawned.agent as string)
    }
    return { pm, workers, pmTools, handlesOf }
  }

  /** The ordinary case: one PM, one child. */
  const aPmAndItsWorker = async (
    approvalMode: 'ask' | 'auto' = 'ask',
  ): Promise<{
    pm: string
    worker: string
    pmTools: AgentToolset
    workerHandle: FakeSessionHandle
  }> => {
    const { pm, workers, pmTools, handlesOf } = await aPmAndItsWorkers(1, approvalMode)
    const worker = workers[0] as string
    return { pm, worker, pmTools, workerHandle: handlesOf.get(worker) as FakeSessionHandle }
  }

  /**
   * ⛔ **Count what `nameForAPerson` actually costs**, by wrapping the store read it makes.
   *
   * ⚠️ **Because a memo nothing counts is a claim.** `oneNamingPerAnswer`'s docblock says the map
   * is per ANSWER and never per host — *"a cache that outlived the call would print yesterday's
   * name in today's chain"* — and hoisting it to an instance field would have been green
   * everywhere.
   *
   * 🔴 **734 · the read is the BINDING now** (`identityOf`, through `profileOf`), and no longer the
   * folder's `recordedOne`: a conversation with an agent is named by it (R41). ⚑ **D-016** · the
   * placement read the same binding and went with projects — so an answer about ONE conversation
   * reads it ONCE, and without the memo it is three for three rows.
   */
  const countingNameReads = (): { reads: () => number; stop: () => void } => {
    const real = store.identityOf.bind(store)
    let seen = 0
    store.identityOf = (sessionId: string) => {
      seen += 1
      return real(sessionId)
    }
    return { reads: () => seen, stop: () => (store.identityOf = real) }
  }

  /**
   * ⛔ **The plant, exactly as `402` reached it.** A parent gives its worker work, the worker's turn
   * runs, and the Fake parks it on a `permission_request` — which is what a provider does when a
   * tool needs approving, and what every child of an `ask` giver does on its first consequential
   * call. ⚑ **D-016 · the give's brief IS that turn** — the child's first — so the card is on its
   * way once {@link aPmAndItsWorkers} returns, and this waits for it and for its routing.
   */
  const aChildParksOnAPermission = async (worker: string): Promise<string> => {
    await waitFor(
      () => ledger(worker).some((event) => event.type === 'permission_request'),
      'the card the brief’s turn parks on',
    )
    const card = ledger(worker)
      .filter((event) => event.type === 'permission_request')
      .at(-1)
    if (card === undefined || card.type !== 'permission_request') {
      throw new Error('no permission request on the ledger')
    }
    await waitFor(
      () =>
        ledger(worker).some(
          (event) => event.type === 'request_routed' && event.requestId === card.id,
        ),
      `the routing of ${card.id}`,
    )
    return card.id
  }

  // ⛔ **612 · `liveIn` stood here and is GONE** (HO-088 §3.1). ⚑ It answered *which sessions may
  // a store-side decision write into*, and the only caller was `escalationsDue`'s `consider`
  // predicate — a question no reader in this app asks any more.

  /**
   * ⚠️ **Through the host's own door**, so the ordinal is the one the host would have used
   * (`398`'s helper). A test that appended straight to the store would pass while shipping the
   * collision.
   */
  const writeThrough = (sessionId: string, event: TranscriptEvent, at: number): void => {
    const publish = host as unknown as {
      publishOurs: (session: unknown, event: TranscriptEvent, at?: number) => void
      slots: Map<string, { session: unknown }>
    }
    const session = publish.slots.get(sessionId)?.session
    if (session === undefined) throw new Error(`${sessionId} is not live`)
    publish.publishOurs(session, event, at)
  }

  /**
   * 🔴 **612 · `lookForEscalations` stood here and is GONE with the deadline** (HO-088 §3.1).
   *
   * ⛔ **It drove `store.escalationsDue` and wrote what it named through the host's own door.**
   * ⚑ **There is no sweep to drive**: a question reaches a person because an agent put it there,
   * which is `611`'s `pass_question_up` — so this helper performs the ACT instead of advancing a
   * clock, and every test below puts the real hazard on the real path.
   *
   * ⚠️ **It answers the PASSER's new request id**, because that is what the person's queue holds:
   * passing up raises the passer's OWN question carrying the original words.
   */
  const thePmPassesItUp = async (pmTools: AgentToolset, questionId: string): Promise<string> => {
    const passed = await callOn(pmTools, 'pass_question_up', {
      question: questionId,
      who_answers: 'a-person',
    })
    expect(passed.outcome, JSON.stringify(passed)).toBe('ok')
    return passed.question as string
  }

  const idsIn = (rows: readonly { request: { requestId: string } }[]): string[] =>
    rows.map((one) => one.request.requestId)

  /**
   * ⛔ **A request id is the PROVIDER's and is only unique inside one conversation** — measured
   * here rather than assumed: the Fake mints `turn_1_perm` per handle, so two workers parked on
   * their first card carry the same id. ⚠️ Every identity assertion in this file therefore reads
   * `askedBy:requestId`, which is also the key the renderer's rows are drawn on.
   */
  const keysIn = (rows: readonly { request: { askedBy: string; requestId: string } }[]): string[] =>
    rows.map((one) => `${one.request.askedBy}:${one.request.requestId}`)

  const sourceOf = (dir: string, file: string): string => readFileSync(join(dir, file), 'utf8')

  /**
   * ⛔ **One declaration's body, with every comment stripped** —
   * `a-source-census-must-strip-prose-before-it-asserts`. ⚠️ The first version of §4's census
   * sliced the raw source, so this very file's own comments were inside the text it asserted
   * `not.toContain` over: a future doc line naming a refusal would have turned it red with no
   * behaviour change at all.
   */
  const bodyIn = (source: string, from: string, to: string): string => {
    const start = source.indexOf(from)
    expect(start, `${from} is not in this file`).toBeGreaterThan(-1)
    const end = source.indexOf(to, start)
    expect(end, `${to} does not close ${from}`).toBeGreaterThan(start)
    return source
      .slice(start, end)
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '')
  }

  /**
   * ⚑ **A conversation's name, derived the way `RuntimeHost.nameForAPerson` derives it** — its
   * AGENT's name since `734` (R41), and the basename of its working directory, falling back to the
   * id, only where it has no agent. ⛔ Re-derived here rather than read off the payload, so §3's
   * assertions are about a name that really could have appeared.
   */
  const nameOf = (sessionId: string): string => {
    const identity = store.identityOf(sessionId)
    if (identity !== null) return agentName(identity.profileSlug, store.agentIdentities())
    const cwd = store.recordedOne(sessionId)?.cwd ?? ''
    const base = cwd.split('/').filter(Boolean).pop()
    return base === undefined || base === '' ? sessionId : base
  }

  // ─────────────────────────────────────────────────────────────────────────────────────────
  // §1 · the population 401 could not see, planted the way 402 measured it
  // ─────────────────────────────────────────────────────────────────────────────────────────

  describe('§1 · a spawned child frozen on a permission is LISTED', () => {
    it('🔴 the row `402` measured — no surface, `to: a-person`, `because: a-permission-decision`', async () => {
      const { pm, worker } = await aPmAndItsWorker()
      const card = await aChildParksOnAPermission(worker)

      // ⛔ **The premise, asserted rather than assumed** (`402` F1's first two facts). The child is
      // running, nobody owns it, and the routing is the shape the finding names.
      expect(host.sessionIds).toContain(worker)
      expect(store.routedRequestsOf(worker).find((one) => one.requestId === card)).toMatchObject({
        went: {
          is: 'the-person-the-channel-left-it-with',
          to: 'a-person',
          because: 'a-permission-decision',
        },
        parent: pm,
        state: 'open',
      })

      // 🔴 **The finding, as a red line that is now green.** `401`'s reader lists none of it; the
      // reader `403` added lists it, and the two are asked in the same breath so this measures the
      // DIFFERENCE rather than the presence of a row.
      expect(idsIn(host.questionsForAPerson().rows)).toEqual([])
      expect(idsIn(host.decisionsForAPerson().rows)).toEqual([card])

      // The payload as a closed key set, so any field added here fails. While no window holds the
      // conversation the row carries the request as its card draws it — `card` — for the person to
      // read and answer from the queue; this read is on no agent's toolset.
      const [row] = host.decisionsForAPerson().rows
      expect(Object.keys(row ?? {}).sort()).toEqual([
        'card',
        'reading',
        'request',
        'says',
        'sentence',
        'work',
      ])
      expect(Object.keys(row?.card ?? {}).sort()).toEqual(['asked', 'profileId', 'provider'])
      expect(row?.card?.asked).toMatchObject({ type: 'permission_request', id: card })
      // 🔴 **And the census goes one level INTO `work`** (434), because that is where the next
      // field would be added. ⛔ A piece carries the work VERBATIM (`PieceRow.brief`) and this
      // payload may not: the whole of `394` §2 is that a person's queue says a thing exists, not
      // what it says. ⚑ This fixture's worker really holds the PM's piece, so the census
      // runs over a real entry rather than over `[]`, which would pass for ever. ⚑ D-016 · an entry
      // is the piece's label (`WorkInHand`), where it was the task's number.
      expect(row?.work).toHaveLength(1)
      expect(Object.keys(row?.work[0] ?? {}).sort()).toEqual(['label'])
      // ⚑ **611 · `to` and `because` became ONE field** — see `WhereARequestWent`. ⛔ The census
      // is unchanged in what it guards: a key added to this payload is still a compile-free way to
      // put a child's words in front of a person, and the union moved two keys into one rather
      // than adding a third.
      expect(Object.keys(row?.request ?? {}).sort()).toEqual([
        'askedBy',
        'at',
        'endedAt',
        'escalatedAt',
        'parent',
        'requestId',
        'state',
        'went',
      ])
      // ⚠️ **And one level INTO the union**, for the reason the `work` census above goes one level
      // in: the arm carrying a `ChannelRefusal` is the one a person's queue draws from.
      expect(Object.keys(row?.request.went ?? {}).sort()).toEqual(['because', 'is', 'to'])
      // Once a window holds the conversation it has the card itself, and no request text crosses
      // here: the key set and, because a key census cannot see a word smuggled into a field that
      // already exists, the live negative.
      host.claimSession(worker, new RecordingSink('webContents:5'))
      const [held] = host.decisionsForAPerson().rows
      expect(Object.keys(held ?? {}).sort()).toEqual([
        'reading',
        'request',
        'says',
        'sentence',
        'work',
      ])
      const payload = JSON.stringify(host.decisionsForAPerson().rows)
      expect(payload).not.toContain('do the thing')
      // ⚑ **Non-vacuity**: the text really is in the ledger this reader folds, so the negative is
      // about the payload rather than about a string nothing could have carried.
      expect(JSON.stringify(ledger(worker))).toContain('do the thing')
    })

    it('🔴 the child really has no window, which is why no other surface can see it', async () => {
      const { worker } = await aPmAndItsWorker()
      await aChildParksOnAPermission(worker)

      // ⛔ **A spawned child is reserved under NO owner** — `mayAnswerAsAHuman` reads
      // `slot.ownerIsAPerson && slot.ownerId === by.ownerId`, so there is no window this card can
      // be answered from and the live queue of every window is empty of it.
      const slots = (host as unknown as { slots: Map<string, { ownerId: string | null }> }).slots
      expect(slots.get(worker)?.ownerId).toBeNull()
      // ⚑ **The paired positive**: the conversation a person opened DOES have one, so this is
      // about the child rather than about how the test reads a slot.
      const mine = await personOpens('a-person-of-my-own')
      expect(slots.get(mine)?.ownerId).toBe('webContents:1')
    })

    it('⚑ three frozen children are three rows — a fold that returned the first would pass a control of one', async () => {
      const { workers } = await aPmAndItsWorkers(3)
      const cards: string[] = []
      for (const worker of workers) cards.push(await aChildParksOnAPermission(worker))

      // ⚑ **`402`'s own number**, and standing rule 12's control: a reader that stopped at the
      // first row, or at the first LEDGER, would be green against a plant of one.
      expect(cards).toHaveLength(3)
      expect(new Set(workers).size).toBe(3)
      // ⛔ **Keyed by conversation AND request**, because the Fake mints the same `turn_1_perm`
      // for each worker's first card — an assertion over ids alone would have compared three
      // copies of one string and passed over a reader that returned any of them.
      const planted = workers.map((worker, index) => `${worker}:${cards[index] ?? ''}`)
      expect(new Set(planted).size).toBe(3)
      expect(keysIn(host.decisionsForAPerson().rows)).toEqual(planted)
      for (const worker of workers) {
        expect(permissionShaped(store.routedRequestsOf(worker))).toHaveLength(1)
      }
      expect(idsIn(host.questionsForAPerson().rows)).toEqual([])
    })

    /**
     * ⛔ **Oldest FIRST, and the plant is one the UNSORTED reading gets wrong** (403, from the
     * review).
     *
     * ⚠️ **The first version of this measured nothing.** `selectSessionsThatRouted` is a
     * `SELECT DISTINCT` with no `ORDER BY`, so its candidate order is the order each ledger FIRST
     * routed something — which, with one request per conversation, is already `at` order. Deleting
     * the sort left the answer identical; only a REVERSED sort was caught. ⛔
     * `a-comparison-tested-where-both-readings-agree-measures-nothing`.
     *
     * ⚑ **So one conversation holds TWO rows straddling another's.** A worker parks on a card,
     * a second worker parks on its own, and then the FIRST worker raises a secret — which is
     * permission-shaped too and, unlike a card, can be raised with no turn running. The flattened
     * candidate order is then `[A₁, A₃, B₂]` and the sorted answer is `[A₁, B₂, A₃]`.
     */
    it('🔴 oldest first, where the candidate order and the stamp order DISAGREE', async () => {
      const { workers, handlesOf } = await aPmAndItsWorkers(2)
      const [first, second] = workers as [string, string]
      const early = await aChildParksOnAPermission(first)
      const middle = await aChildParksOnAPermission(second)
      const secret = (handlesOf.get(first) as FakeSessionHandle).simulateUserInput(
        'the token?',
        [],
        false,
        { secret: true },
      )
      await waitFor(
        () =>
          ledger(first).some(
            (event) => event.type === 'request_routed' && event.requestId === secret.id,
          ),
        'the routing of the late secret',
      )
      const late = `${first}:${secret.id}`

      const rows = host.decisionsForAPerson().rows
      const stamps = rows.map((one) => one.request.at)
      // ⛔ **The control, and it is the whole test**: the order the ledgers are walked in is NOT
      // the order the stamps are in, so an unsorted answer differs from a sorted one.
      const unsorted = [first, second].flatMap((id) =>
        permissionShaped(store.routedRequestsOf(id))
          .filter((one) => REQUEST_IS_OPEN[one.state])
          .map((one) => `${id}:${one.requestId}`),
      )
      expect(unsorted).toEqual([`${first}:${early}`, late, `${second}:${middle}`])
      expect(keysIn(rows)).toEqual([`${first}:${early}`, `${second}:${middle}`, late])
      expect(keysIn(rows)).not.toEqual(unsorted)
      expect([...stamps].sort((left, right) => left - right)).toEqual(stamps)
      expect(new Set(stamps).size).toBe(3)
    })

    it('⛔ the paired negative · criterion 10 still refuses it from the question channel', async () => {
      const { worker, pmTools } = await aPmAndItsWorker()
      const card = await aChildParksOnAPermission(worker)

      // ⛔ **A parent that names it is refused BY NAME, not by an absence.** `394`'s door is
      // untouched: the reader added here reports, and reporting is not entitlement.
      const refused = await callOn(pmTools, 'answer_question', {
        question: card,
        answers: [{ part: 'q0', answer: ['allow'] }],
      })
      expect(refused.outcome).toBe('refused')
      expect(JSON.stringify(refused)).toContain('a-permission-decision')

      // ⚑ **And the words never crossed either**: `list_questions` gives the parent the row and no
      // text for it, which is `394` §2 and is what the new reader must not have widened.
      const listed = (await callOn(pmTools, 'list_questions')).questions as {
        question: string
        words: string | null
        answerable_by_you: boolean
      }[]
      const row = listed.find((one) => one.question === card)
      expect(row).toMatchObject({ answerable_by_you: false, words: null })
    })
  })

  // ─────────────────────────────────────────────────────────────────────────────────────────
  // §2 · two readers, two guarantees, measured where they DIVERGE
  // ─────────────────────────────────────────────────────────────────────────────────────────

  describe('§2 · the strict reader stays strict', () => {
    it('🔴 one world, both populations, and neither reader returns the other’s row', async () => {
      const { pm, worker, pmTools, workerHandle } = await aPmAndItsWorker()
      const card = await aChildParksOnAPermission(worker)
      const question = workerHandle.simulateUserInput('which region?', ['eu', 'us'], false)
      await waitFor(
        () =>
          ledger(worker).some(
            (event) => event.type === 'request_routed' && event.requestId === question.id,
          ),
        'the routing of the question',
      )
      // ⚑ **612 · the PM passes it up, because no clock does it any more** (HO-088 §3.1). ⛔ The
      // row in the person's queue is then the PM's own, carrying the worker's words.
      const passed = await thePmPassesItUp(pmTools, question.id)
      // ⚑ **D-017 · R19 — and the PM's own card is a person's decision too.** The routed question
      // opened a turn in the PM, which the double parks on a card, and the PM has no parent: its
      // card is routed to a person, so the strict reader lists it beside the worker's.
      await waitFor(
        () =>
          store
            .routedRequestsOf(pm)
            .some((one) => one.went.to === 'a-person' && one.requestId !== passed),
        'the routing of the card the PM’s turn parks on',
      )
      const pmCard = permissionShaped(store.routedRequestsOf(pm)).at(-1)?.requestId

      // ⛔ **Tested where the two readings give DIFFERENT answers** (standing rule 3). Every row is
      // open, all are on one conversation family, and neither reader returns the other's.
      expect(keysIn(host.questionsForAPerson().rows)).toEqual([`${pm}:${passed}`])
      expect(keysIn(host.decisionsForAPerson().rows)).toEqual([
        `${worker}:${card}`,
        `${pm}:${String(pmCard)}`,
      ])
    })

    /**
     * 🔴 **A stamp that LANDS on a permission-shaped row is refused at the READER too** (403,
     * from the review), and the hazard is put on the path this code walks rather than argued
     * about.
     *
     * ⛔ **The guard was not redundant with the deadline's own skip.** That skip stopped a
     * permission being escalated; this stops one being READ BACK as escalated, and the two were
     * different writers apart. ⚑ **612 · the skip went with the clock and THIS ONE DID NOT**, and
     * the reason is the whole point of it: the rows it guards against are ones a ledger already
     * holds, so removing the writer removed nothing this reader has to be right about.
     * ⚠️ The reachable path is `396 §3`'s: a request id repeats across a resume,
     * and `deriveRoutedRequests` resolves `request_escalated` through `everSeen`, which points at
     * the LATEST row that id opened — so a stamp computed for a travelling question can land on a
     * permission-shaped row raised later under the same id.
     *
     * 🔴 **Without the guard the same request is in BOTH populations**: the person's count is one
     * too high, and the row is drawn as something a parent might still answer.
     */
    it('🔴 a stamp landing on a permission-shaped row does not put it in the question channel', async () => {
      const { worker } = await aPmAndItsWorker()
      const card = await aChildParksOnAPermission(worker)

      // ⛔ **The hazard, written through the host's own door** — a `request_escalated` naming a
      // request whose routing carries a refusal. ⚑ **612 · nothing in this app writes one AT ALL
      // now**, so this test is the only producer left — and a ledger written before `612` is
      // exactly the world it stands for.
      writeThrough(worker, { type: 'request_escalated', requestId: card }, clock)

      // ⚑ **The premise, asserted**: the fold really did stamp it, so the guard is being asked a
      // question rather than passing over an absence.
      const row = store.routedRequestsOf(worker).find((one) => one.requestId === card)
      expect(row?.escalatedAt).not.toBeNull()
      expect(row === undefined ? null : theChannelRefusalIn(row)).toBe('a-permission-decision')
      expect(REQUEST_IS_OPEN[row?.state ?? 'open']).toBe(true)

      // ⛔ **And it is in ONE population, not two.**
      expect(store.questionsAPersonMustAnswer().rows).toEqual([])
      expect(idsIn(host.questionsForAPerson().rows)).toEqual([])
      expect(idsIn(host.decisionsForAPerson().rows)).toEqual([card])
    })

    it('⛔ NOTHING can make a permission enter the question queue — and there is no deadline left to try', async () => {
      const { worker, pmTools } = await aPmAndItsWorker()
      const card = await aChildParksOnAPermission(worker)

      // ⚠️ **612 · this drove twenty escalation windows and asserted the sweep found nothing**
      // (HO-088 §3.1, standing rule 26: strip AND re-aim). ⛔ **There is no sweep and no window**,
      // so the old assertion could only ever pass — and what it was FOR survives: a permission is
      // not the question queue's, whatever anybody does to it.
      //
      // ⚑ **So the act that CAN put a question in front of a person is tried instead**, which is
      // `611`'s verb, and it is refused by name.
      const passed = await callOn(pmTools, 'pass_question_up', {
        question: card,
        who_answers: 'a-person',
      })
      expect(passed.outcome, JSON.stringify(passed)).toBe('refused')
      expect(passed.rail).toBe('a-person-answers-this-one')
      expect(
        store.routedRequestsOf(worker).find((one) => one.requestId === card)?.escalatedAt,
      ).toBeNull()
      expect(store.questionsAPersonMustAnswer().rows).toEqual([])
      // ⚑ **And it is still a person's the whole time**, which is the point: the absence of an
      // escalation is not the absence of somebody waiting.
      expect(idsIn(host.decisionsForAPerson().rows)).toEqual([card])
    })
  })

  // ─────────────────────────────────────────────────────────────────────────────────────────
  // §3 · the chain has no middle
  // ─────────────────────────────────────────────────────────────────────────────────────────

  describe('§3 · "worker waiting on you", at any depth', () => {
    /**
     * ⛔ **The two chains are measured in ONE world, by their SHAPE — and since `734` by WHO too.**
     *
     * ⚠️ **Until `734` a name could not have told them apart, and finding that out was worth
     * writing down.** A spawned child inherits its parent's working directory — `a-spawn-must-
     * inherit-its-parents-project` — and `nameForAPerson` WAS the basename of that directory, so a
     * PM and its worker were named the SAME WORD, and an assertion that *"the sentence does not
     * contain the parent's name"* was either vacuous or falsely red. ⚑ What distinguishes the two
     * chains is the number of hops: a permission has one and its clause ends at `you`; a question
     * raised in the same relationship, from the same child, to the same parent, has two.
     *
     * 🔴 **734 · the WHO is measured here now as well.** A conversation is named by its AGENT
     * (R41), and the PM and its worker are two identities — so their names differ in this world,
     * and the hop naming the worker is red for a reading built from the PARENT. ⚑
     * `persons-queue.test.ts` §8 still measures it over a fixture (`worker → you`).
     */
    it('🔴 one hop ending at you, where the SAME relationship gives a question two', async () => {
      const { pm, worker, pmTools, workerHandle } = await aPmAndItsWorker()
      await aChildParksOnAPermission(worker)
      const question = workerHandle.simulateUserInput('which region?', ['eu', 'us'], false)
      await waitFor(
        () =>
          ledger(worker).some(
            (event) => event.type === 'request_routed' && event.requestId === question.id,
          ),
        'the routing of the question',
      )
      // ⚑ **612 · the PM passes it up** — one row in each population, which is what this section
      // needs and what a deadline used to arrange.
      await thePmPassesItUp(pmTools, question.id)

      const [only] = host.decisionsForAPerson().rows
      expect(only?.reading.hops).toHaveLength(1)
      expect(only?.reading.hops[0]?.on).toBeNull()
      // ⚑ **734 · WHO, and not only the shape** — see this section's note: the two names differ
      // now, so a hop built from the parent is red here.
      expect(nameOf(worker)).not.toBe(nameOf(pm))
      expect(only?.reading.hops[0]?.waiting).toBe(nameOf(worker))
      // ⛔ **Complete in one step, not STOPPED in one step.** `unfollowable` is what a cycle and
      // the hop bound leave behind, and a surface may print *"you"* after this one.
      expect(only?.reading.unfollowable).toBe(false)
      expect(only?.sentence).toBe(`${nameOf(worker)} waiting on you`)
      expect(only?.sentence.split(' waiting on ')).toHaveLength(2)

      // ⚑ **The paired positive, one conversation over and in the same breath**: the walk exists
      // and reaches two hops for a question, so the one hop above is the CHANNEL rather than a
      // depth this test happened to stop at.
      // ⚠️ **612 · the passed-up row's chain is ONE hop** (HO-088 §3.2), where an escalated one
      // was two: the PM raised it ITSELF, so there is nobody above it that has not answered.
      // ⛔ **The property this pairing is FOR survives**: the walk really does read a chain for
      // the question population and a one-hop reading for the decision population, and they are
      // one hop for DIFFERENT reasons — the channel refused one, and nobody is above the other.
      const [passedUp] = host.questionsForAPerson().rows
      expect(passedUp?.reading.hops).toHaveLength(1)
      expect(passedUp?.reading.hops[0]?.on).toBeNull()
      expect(passedUp?.request.went.is).toBe('the-person-the-asker-named')
      expect(only?.request.went.is).toBe('the-person-the-channel-left-it-with')
    })
  })

  // ─────────────────────────────────────────────────────────────────────────────────────────
  // §4 · every refusal, not the one the brief names
  // ─────────────────────────────────────────────────────────────────────────────────────────

  describe('§4 · the reader admits the closed vocabulary, not one member of it', () => {
    it('🔴 a question whose answer is a SECRET is here too, with its own sentence', async () => {
      const { worker, workerHandle } = await aPmAndItsWorker()
      const card = await aChildParksOnAPermission(worker)
      const secret = workerHandle.simulateUserInput('the token?', [], false, { secret: true })
      await waitFor(
        () =>
          ledger(worker).some(
            (event) => event.type === 'request_routed' && event.requestId === secret.id,
          ),
        'the routing of the secret',
      )

      // ⛔ **Two DIFFERENT refusals in one answer.** A reader that matched `a-permission-decision`
      // would return one of these and would go on returning one as the vocabulary grows — the
      // exact shape of `a-filter-can-blind-the-instrument-that-justifies-it`, one column over.
      const rows = host.decisionsForAPerson().rows
      expect(idsIn(rows).sort()).toEqual([card, secret.id].sort())
      const byId = new Map(rows.map((one) => [one.request.requestId, one]))
      expect(byId.get(card)?.request.went.because).toBe('a-permission-decision')
      expect(byId.get(secret.id)?.request.went.because).toBe('a-secret-only-a-person-can-type')
      // ⚑ **The words are the vocabulary's own**, so a fifth member gets a sentence for free and
      // this surface cannot invent one.
      expect(byId.get(card)?.says).toBe(CHANNEL_REFUSAL_SENTENCES['a-permission-decision'])
      expect(byId.get(secret.id)?.says).toBe(
        CHANNEL_REFUSAL_SENTENCES['a-secret-only-a-person-can-type'],
      )
      // ⛔ **And a secret's chain is one hop too** — it is authority-shaped for a different
      // reason and reaches the same answerer.
      expect(byId.get(secret.id)?.reading.hops).toHaveLength(1)
    })

    /**
     * 🔴 **A `because` this build has not been taught reaches a person as a SENTENCE, not as
     * `undefined` and not as the word** (403, from the review).
     *
     * ⛔ **The hazard is on the path this code walks.** `toPersistedEvents` reads a ledger row
     * with `JSON.parse(row.payload) as TranscriptEvent` — a CAST, checked against nothing — so an
     * imported conversation, or this build reading a ledger a later one wrote, hands
     * `deriveRoutedRequests` a sixth member. ⚠️ `CHANNEL_REFUSAL_SENTENCES` answers `undefined`
     * there, which is typed `string`, survives a structured clone, and draws an EMPTY amber
     * paragraph on the one line that says what a person is being asked for.
     */
    it('🔴 a refusal this build has never heard of still reads as a sentence', async () => {
      // ⚑ D-016 · an `auto` PM, so its worker runs its brief with no card of its own and the one
      // row below is the only one there is.
      const { worker } = await aPmAndItsWorker('auto')
      // ⛔ **Through the host's own door, with a value no version of this app writes today.** The
      // cast is the point: this is what a ledger from another build looks like from in here.
      writeThrough(
        worker,
        {
          type: 'request_routed',
          requestId: 'req_from_the_future',
          to: 'a-person',
          because: 'a-shape-from-a-later-build' as never,
          parent: 'sess_whoever',
        },
        clock,
      )

      const [only] = host.decisionsForAPerson().rows
      expect(only?.request.requestId).toBe('req_from_the_future')
      expect(typeof only?.says).toBe('string')
      expect(only?.says.length ?? 0).toBeGreaterThan(20)
      // ⛔ **A sentence, and never the machine word.** `CHANNEL_REFUSAL_SENTENCES`' own docblock
      // says the words are for a person or a test and the ENUM is what a model reads.
      expect(only?.says).not.toContain('a-shape-from-a-later-build')
      expect(only?.says).toContain('has not been taught')
      // ⚑ **The paired positive**: a member this build DOES know still gets the vocabulary's own
      // sentence, so the fallback did not swallow the ordinary case.
      const { worker: other } = await aPmAndItsWorker()
      const card = await aChildParksOnAPermission(other)
      const known = host.decisionsForAPerson().rows.find((one) => one.request.requestId === card)
      expect(known?.says).toBe(CHANNEL_REFUSAL_SENTENCES['a-permission-decision'])
    })

    it('⛔ the selector is *it did not travel*, and no member of the vocabulary is named on the path', () => {
      // ⛔ **EVERY function on the path, because a member match anywhere on it would be GREEN
      // against every behavioural test above** — the Fake can raise two of the five refusals, so
      // the three it cannot are exactly the ones a narrowing would drop silently. ⚠️ The first
      // version of this census read ONE function body, and a `.filter` added in the host or in
      // `permissionShaped` would have walked straight past it.
      const path: [string, string][] = [
        [
          'session-store.ts · decisionsAwaitingAPerson',
          bodyIn(
            sourceOf(join(mainRoot, 'db'), 'session-store.ts'),
            '    decisionsAwaitingAPerson(unread) {',
            '\n    },',
          ),
        ],
        [
          'runtime-host.ts · decisionsForAPerson',
          bodyIn(
            sourceOf(join(mainRoot, 'runtime'), 'runtime-host.ts'),
            '  decisionsForAPerson(): LedgerWalk<PersonsDecision> {',
            '\n  }\n',
          ),
        ],
        [
          'questions.ts · permissionShaped',
          bodyIn(
            sourceOf(sharedRoot, 'questions.ts'),
            'export function permissionShaped(',
            '\n}\n',
          ),
        ],
      ]
      for (const [where, body] of path) {
        expect(body.length, `${where} is not where this census thinks it is`).toBeGreaterThan(60)
        for (const refusal of CHANNEL_REFUSALS) {
          expect(body, `${where} names ${refusal}`).not.toContain(refusal)
        }
      }
      // ⚑ …and the selector really is the one this file claims it is.
      expect(path[0]?.[1]).toContain('permissionShaped(')
      expect(path[0]?.[1]).toContain('REQUEST_IS_OPEN[request.state]')
      // 🔴 **611 · the selector is the ARM and it used to be `one.because !== null`** (HO-088 §2).
      // ⛔ Since an asker can address a question to a person with nothing refused, a selector on
      // the absence of a refusal would have admitted questions into the population criterion 10
      // counts — so `permissionShaped` narrows on the arm that CARRIES a refusal.
      expect(path[2]?.[1]).toContain("one.went.is === 'the-person-the-channel-left-it-with'")
      // ⚑ **Non-vacuity: the census can go red.** A body with a member match in it fails the loop
      // above, so this is a census rather than a sentence about a string nobody would write.
      const planted = `${path[0]?.[1] ?? ''}.filter((one) => one.went.because === 'a-permission-decision')`
      expect(CHANNEL_REFUSALS.filter((refusal) => planted.includes(refusal))).toEqual([
        'a-permission-decision',
      ])
    })
  })

  // ─────────────────────────────────────────────────────────────────────────────────────────
  // §5 · the parent's own surface, which is a different sentence
  // ─────────────────────────────────────────────────────────────────────────────────────────

  describe('§5 · what the PARENT is told, and it is not that it may answer', () => {
    it('🔴 `list_questions` no longer counts a permission as waiting on the caller', async () => {
      const { worker, pmTools, workerHandle } = await aPmAndItsWorker()
      await aChildParksOnAPermission(worker)
      const question = workerHandle.simulateUserInput('which region?', ['eu', 'us'], false)
      await waitFor(
        () =>
          ledger(worker).some(
            (event) => event.type === 'request_routed' && event.requestId === question.id,
          ),
        'the routing of the question',
      )

      // ⛔ **Two open rows, and exactly one of them is this caller's.** Until `403` the line read
      // *"2 waiting on you"* — about a row `answer_question` refuses it by name.
      const line = await said(pmTools, 'list_questions')
      expect(line).toContain('1 waiting on you')
      expect(line).toContain('1 waiting on a person, not on you')
      expect(line).toContain('that conversation is')
      expect(line).toContain('frozen until somebody decides')
      expect(line).not.toContain('2 waiting on you')
    })

    it('⚑ the paired positive · with nothing permission-shaped the sentence is unchanged', async () => {
      // ⚑ D-016 · an `auto` PM, so its worker runs its brief with no card: nothing is
      // permission-shaped.
      const { worker, pmTools, workerHandle } = await aPmAndItsWorker('auto')
      const question = workerHandle.simulateUserInput('which region?', ['eu', 'us'], false)
      await waitFor(
        () =>
          ledger(worker).some(
            (event) => event.type === 'request_routed' && event.requestId === question.id,
          ),
        'the routing of the question',
      )
      const line = await said(pmTools, 'list_questions')
      expect(line).toContain('1 waiting on you:')
      expect(line).not.toContain('waiting on a person')
      expect(line).not.toContain('frozen')
    })

    /**
     * 🔴 **Requests are counted; CONVERSATIONS are what freeze, and they are not the same
     * number** (403, from the review).
     *
     * ⛔ **`402`'s own measured case is the counterexample**: three permissions on ONE worker. The
     * first version of the clause said *"those conversations are frozen"* about three — a new
     * false number one clause after the false number it was added to fix.
     */
    it('🔴 three cards on one child are three requests and ONE frozen conversation', async () => {
      const { workers, pmTools, handlesOf } = await aPmAndItsWorkers(1)
      const only = workers[0] as string
      await aChildParksOnAPermission(only)
      for (const prompt of ['the token?', 'the other token?']) {
        const secret = (handlesOf.get(only) as FakeSessionHandle).simulateUserInput(
          prompt,
          [],
          false,
          { secret: true },
        )
        await waitFor(
          () =>
            ledger(only).some(
              (event) => event.type === 'request_routed' && event.requestId === secret.id,
            ),
          `the routing of ${prompt}`,
        )
      }

      const line = await said(pmTools, 'list_questions')
      expect(line).toContain('3 waiting on a person, not on you')
      expect(line).toContain('that conversation is frozen')
      expect(line).not.toContain('conversations are frozen')
    })

    it('⚑ two frozen children are named as two, so the plural arm is not a guess', async () => {
      const { workers, pmTools } = await aPmAndItsWorkers(2)
      for (const one of workers) await aChildParksOnAPermission(one)
      const line = await said(pmTools, 'list_questions')
      expect(line).toContain('2 waiting on a person, not on you')
      expect(line).toContain('those 2 conversations are frozen')
    })

    it('⛔ a parent with ONLY a permission under it is told nothing is waiting on IT', async () => {
      const { worker, pmTools } = await aPmAndItsWorker()
      await aChildParksOnAPermission(worker)
      const line = await said(pmTools, 'list_questions')
      // ⚑ **`nothing is waiting on you` and the frozen clause TOGETHER** — the parent learns that
      // it owes nothing and that its child is not going anywhere, which are two different facts
      // and were previously one false one.
      expect(line).toContain('nothing is waiting on you')
      expect(line).toContain('waiting on a person, not on you')
    })
  })

  // ─────────────────────────────────────────────────────────────────────────────────────────
  // §6 · what the reader refuses to say
  // ─────────────────────────────────────────────────────────────────────────────────────────

  describe('§6 · it reports, and it rules nothing', () => {
    /**
     * 🔴 **The naming is memoised PER ANSWER, and both halves are measured** (403, from the
     * review — the docblock made two claims and nothing counted anything).
     *
     * ⛔ **Per answer**, because a conversation's name is its agent's since `734` — which a
     * person's rename moves — and its folder where it has none, which a move changes: a cache
     * hoisted to the host would print yesterday's name in today's chain. ⚑ **Memoised**, because
     * three cards on one worker is `402`'s own measured shape and the walk would otherwise read that
     * conversation's binding once per row.
     */
    it('🔴 one name read per conversation inside an answer, and a fresh read for the next one', async () => {
      const { workers, handlesOf } = await aPmAndItsWorkers(1)
      const only = workers[0] as string
      await aChildParksOnAPermission(only)
      for (const prompt of ['the token?', 'the other token?']) {
        const secret = (handlesOf.get(only) as FakeSessionHandle).simulateUserInput(
          prompt,
          [],
          false,
          { secret: true },
        )
        await waitFor(
          () =>
            ledger(only).some(
              (event) => event.type === 'request_routed' && event.requestId === secret.id,
            ),
          `the routing of ${prompt}`,
        )
      }

      const counting = countingNameReads()
      try {
        expect(host.decisionsForAPerson().rows).toHaveLength(3)
        // ⛔ **ONE read for three rows, for the name** (see the helper; D-016 took the placement's
        // read). Without the name's memo it is three, which is what makes this a measurement
        // rather than a restatement of the docblock.
        expect(counting.reads()).toBe(1)

        // ⛔ **And the next answer reads AGAIN**, so the map did not outlive the call. A cache
        // hoisted to the host would leave this at 1.
        expect(host.decisionsForAPerson().rows).toHaveLength(3)
        expect(counting.reads()).toBe(2)
      } finally {
        counting.stop()
      }
    })

    it('🔴 a permission a person has decided leaves the queue', async () => {
      const { worker } = await aPmAndItsWorker()
      const card = await aChildParksOnAPermission(worker)
      expect(idsIn(host.decisionsForAPerson().rows)).toEqual([card])

      // ⛔ **Through the real door**: a person takes the conversation over — `336`'s claim, the
      // only way in — and answers on the card. Nothing in this dispatch changed either step.
      const person = new RecordingSink('webContents:2')
      host.claimSession(worker, person)
      const ack = await host.respondPermission(worker, card, { outcome: 'allow' }, person)
      expect(ack.outcome).toBe('taken')

      const row = store.routedRequestsOf(worker).find((one) => one.requestId === card)
      expect(row?.state).toBe('decided')
      expect(REQUEST_IS_OPEN[row?.state ?? 'open']).toBe(false)
      expect(host.decisionsForAPerson().rows).toEqual([])
    })

    it('a person answers it from the queue without taking it over; an agent never does', async () => {
      const { pm, worker } = await aPmAndItsWorker()
      const card = await aChildParksOnAPermission(worker)
      expect(idsIn(host.decisionsForAPerson().rows)).toEqual([card])

      await expect(
        host.respondPermission(worker, card, { outcome: 'allow' }, { ownerId: `agent:${pm}` }),
      ).rejects.toThrow()
      const person = new RecordingSink('webContents:9')
      await expect(
        host.respondPermission(worker, card, { outcome: 'allow' }, person),
      ).resolves.toMatchObject({ outcome: 'taken' })
      const slots = (host as unknown as { slots: Map<string, { ownerId: string | null }> }).slots
      expect(slots.get(worker)?.ownerId, 'answering took nothing over').toBeNull()
      expect(host.decisionsForAPerson().rows).toEqual([])
    })

    it('once a window holds the conversation, only that window answers it', async () => {
      const { worker } = await aPmAndItsWorker()
      const card = await aChildParksOnAPermission(worker)
      const holder = new RecordingSink('webContents:3')
      host.claimSession(worker, holder)
      expect(
        host.decisionsForAPerson().rows[0]?.card,
        'its own window holds the card',
      ).toBeUndefined()
      await expect(
        host.respondPermission(
          worker,
          card,
          { outcome: 'allow' },
          new RecordingSink('webContents:9'),
        ),
      ).rejects.toThrow()
      await expect(
        host.respondPermission(worker, card, { outcome: 'allow' }, holder),
      ).resolves.toMatchObject({ outcome: 'taken' })
    })

    it('⚠️ nothing routed is nothing listed, and that is not the same as nothing looked at', async () => {
      // ⛔ **The empty answer means *none arrived*, which is only true because nothing is dropped
      // at the boundary** — `394` §2's whole argument, one reader over.
      expect(host.decisionsForAPerson().rows).toEqual([])
      const alone = await personOpens('lonely')
      const raised = latestHandle().simulateUserInput('which branch?', ['main'])
      await waitFor(
        () => ledger(alone).some((event) => event.type === 'request_routed'),
        'the routing of the card on a conversation with no parent',
      )
      // ⚑ **D-017 · R19 — a conversation nobody spawned has no channel, but its request is a
      // PERSON's, and a row says so**: routed to a person with no `because`, because it is a
      // question and was refused nothing. ⛔ So the strict reader still lists nothing — and the
      // question reader, one reader over, is where it is: nothing was dropped, and nothing counts
      // twice.
      const routed = store.routedRequestsOf(alone)
      expect(routed).toMatchObject([{ requestId: raised.id, went: { to: 'a-person' } }])
      expect(permissionShaped(routed)).toEqual([])
      expect(host.decisionsForAPerson().rows).toEqual([])
      expect(keysIn(host.questionsForAPerson().rows)).toEqual([`${alone}:${raised.id}`])
    })
  })
})
