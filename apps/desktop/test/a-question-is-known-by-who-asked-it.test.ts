import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { FakeProviderSessions, FakeRuntime } from '@brobot2/runtime'
import type {
  FakeSessionHandle,
  ResumeOptions,
  RuntimeEvent,
  SessionRef,
  StartOptions,
  UserInputResponse,
} from '@brobot2/runtime'
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
import { REQUEST_IS_OPEN } from '../src/shared/questions'
import { TASK_IS_OPEN } from '../src/shared/tasks'
import type { RuntimeEventMessage, TranscriptEvent } from '../src/shared/runtime-ipc'

/**
 * 🔴 **679 · a question is known by who asked it** — `675` F-b.
 *
 * ## ⛔ The defect, and why a one-child fixture could never see it
 *
 * ⚠️ **A provider's request id is SESSION-LOCAL** ([[a-provider-request-id-is-session-local]]).
 * Codex's is the app-server's JSON-RPC server-request id, numbered per CONNECTION — every
 * conversation has its own — and this suite's double mints `ui_N` per handle for the same reason.
 * ⛔ **So two children's questions CAN carry one id** — here, each child's first — ⚠️ and on Codex
 * the probe measured the numbering for `item/tool/call`, not for a question. The answer door and
 * the pass-up door found a question by that id ALONE, across every asker routed to the caller: the
 * door reached only the NEWER, and an answer meant for the older child went to the newer one.
 *
 * ⚑ **The key is (the conversation that asked, its id)** — the one `675` gave `list_questions`.
 * What a caller NAMES is still the id it was shown; the asker is derived from the questions routed to
 * it, and only when two of those askers share the id does it have to say which — by `asked_by`, the
 * field `list_questions` already shows it beside every id.
 *
 * ## ⚠️ Every section pairs the arm where the ids COLLIDE with one where they differ
 *
 * ⛔ **A fixture in which the ids never collide passes against the old key**, by construction —
 * `a-comparison-tested-where-both-sides-agree-measures-nothing`. ⚑ The control is the same two
 * children with the second one's counter moved on, so the only fact that changes is the id.
 *
 * ⚑ **Real host, real SQLite, real migrations, real tools.** The only double is the provider — and
 * {@link mint}, which makes the app's own `req_<uuid>` spell a provider's id in §4, the one arm the
 * app-held map's key can be measured on.
 */

/**
 * ⛔ **§4's plant: the app's own question id, made to spell a provider's.** `newAskedQuestionId` is
 * `req_<uuid>`, so across ORIGINS a collision needs a provider free to mint `req_…` — which
 * `answerQuestion`'s own note names as the case its map lookup must survive. ⚑ Null everywhere else,
 * so every other test here mints exactly as the app does.
 */
const mint = vi.hoisted(() => ({ next: null as (() => string) | null }))
vi.mock('../src/main/db/ids', async (importOriginal) => {
  const real = await importOriginal<typeof import('../src/main/db/ids')>()
  return {
    ...real,
    newAskedQuestionId: (): string => mint.next?.() ?? real.newAskedQuestionId(),
  }
})

async function waitFor(predicate: () => boolean, what: string): Promise<void> {
  for (let attempt = 0; attempt < 400; attempt++) {
    if (predicate()) return
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
  throw new Error(`timed out waiting for ${what}`)
}

/**
 * ⛔ **Whether a promise has settled after a real interval** — `a-question-a-worker-can-ask`'s
 * helper, for its reason: a macrotask tick is what separates *answered* from *not yet*.
 */
async function settledYet(promise: Promise<unknown>): Promise<boolean> {
  const pending = Symbol('pending')
  let outcome: unknown = pending
  void promise.then(
    (value) => {
      outcome = value
    },
    (error: unknown) => {
      outcome = error
    },
  )
  await new Promise((resolve) => setTimeout(resolve, 50))
  return outcome !== pending
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
 * ⚑ **`656`'s stream lever** (`what-a-close-does-that-a-reopen-never-undoes` §6): the stream fails
 * UNDER the host, so no `status` row is written — the one ending that leaves a request `open` with
 * nobody running. ⚠️ Armed only for the handles a test asks for, so every other test's stream is the
 * double's own.
 */
const levers = new Map<FakeSessionHandle, () => void>()
const failable = { on: false }

/** `394`'s double, with the handles kept — a test has to BE the provider to raise a question. */
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
    if (!failable.on) return handle
    let fail!: () => void
    const failed = new Promise<IteratorResult<RuntimeEvent>>((_resolve, reject) => {
      fail = () => reject(new Error('the stream failed under the host'))
    })
    failed.catch(() => undefined)
    levers.set(handle, fail)
    return new Proxy(handle, {
      get(target, property) {
        if (property === 'events') {
          return (): AsyncIterable<RuntimeEvent> => ({
            [Symbol.asyncIterator]() {
              const inner = target.events()[Symbol.asyncIterator]()
              return {
                next: () => Promise.race([inner.next(), failed]),
                return: async (): Promise<IteratorResult<RuntimeEvent>> =>
                  (await inner.return?.()) ?? { done: true, value: undefined },
              }
            },
          })
        }
        const value = Reflect.get(target, property, target) as unknown
        return typeof value === 'function' ? (value as () => unknown).bind(target) : value
      },
    })
  }
  override async resume(ref: SessionRef, options: ResumeOptions): Promise<FakeSessionHandle> {
    const handle = await super.resume(ref, options)
    this.handles.push(handle)
    return handle
  }
}

interface Child {
  readonly id: string
  readonly handle: FakeSessionHandle
}

describe('679 · a question is known by who asked it', () => {
  let userData: string
  let root: string
  let db: AppDatabase
  let store: SessionStore
  let host: RuntimeHost
  let handles: FakeSessionHandle[]
  let issued: FakeProviderSessions
  let counter: number
  let clock: number
  let window: RecordingSink
  let families: number
  const tick = (): number => clock++

  beforeEach(() => {
    userData = mkdtempSync(join(tmpdir(), 'brobot2-679-'))
    root = mkdtempSync(join(tmpdir(), 'brobot2-679-root-'))
    db = openDatabase(join(userData, 'brobot2.sqlite'))
    applyMigrations(db, join(dirname(fileURLToPath(import.meta.url)), '../src/main/db/migrations'))
    clock = 9_000_000
    store = createSessionStore(db, tick)
    counter = 0
    handles = []
    issued = new FakeProviderSessions()
    host = new RuntimeHost({
      store,
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
      readProviderConfig: (_provider, home) => ({
        home,
        homeEnv: 'CLAUDE_CONFIG_DIR',
        model: 'm',
        authNote: null,
        files: [],
      }),
    })
    window = new RecordingSink('webContents:1')
    families = 0
    mint.next = null
    failable.on = false
    levers.clear()
  })

  afterEach(async () => {
    mint.next = null
    await host.closeAll()
    db.close()
    for (const dir of [userData, root]) rmSync(dir, { recursive: true, force: true })
  })

  const ledger = (sessionId: string): TranscriptEvent[] =>
    store.events(sessionId).map((entry) => entry.event)

  const callOn = async (
    sessionId: string,
    name: ToolName,
    args: Record<string, unknown>,
  ): Promise<Record<string, unknown>> => {
    const tool = agentToolsFor(host, sessionId).tools.find((one) => one.name === name)
    if (tool === undefined) throw new Error(`no such tool: ${name}`)
    return (await tool.call(args)).structured as Record<string, unknown>
  }

  const latestHandle = (): FakeSessionHandle => {
    const handle = handles.at(-1)
    if (handle === undefined) throw new Error('no provider handle has been issued')
    return handle
  }

  const personOpens = async (profileId: string): Promise<string> => {
    const { sessionId } = await host.createSession(
      { provider: 'claude', profileId, approvalMode: 'ask', cwd: root },
      window,
    )
    return sessionId
  }

  /**
   * ⚑ **A PM in a window with TWO children, given work through the real door, older first.** ⛔ Each
   * child has its own handle, so each one's first question is `ui_1` — the shape this file is about.
   * ⚑ **D-016 · each brief is its child's first turn**, which in the PM's `ask` parks on that
   * child's own first card — `turn_1_perm` on each handle.
   */
  const aPmAndTwoChildren = async (): Promise<{ pm: string; older: Child; newer: Child }> => {
    const nth = ++families
    const pmProfile = `pm-${String(nth)}`
    const profiles = [`worker-${String(nth)}-a`, `worker-${String(nth)}-b`]
    for (const one of profiles) await host.close(await personOpens(one), window)
    // ⛔ No grant is set for the gives (D-014: any agent may give work to any agent).
    const pm = await personOpens(pmProfile)
    const children: Child[] = []
    for (const profile of profiles) {
      const given = await callOn(pm, 'give_work', {
        definition_of_done: 'The requested result and its checks are recorded.',
        profile,
        title: `the half ${profile} owns`,
        brief: 'migrate the schema',
      })
      expect(given.outcome, JSON.stringify(given)).toBe('ok')
      children.push({ id: given.agent as string, handle: latestHandle() })
    }
    const [older, newer] = children
    if (older === undefined || newer === undefined) throw new Error('two children were not given')
    return { pm, older, newer }
  }

  /**
   * ⚑ **Raise a question on a child exactly as its provider would**, and wait for the app to have
   * routed it. ⚠️ The SAME options on every child, on purpose: a question whose answer the other
   * child would refuse turns a misroute into a refusal, and the case worth measuring is the one where
   * the wrong child silently takes it.
   */
  const childAsks = async (
    child: Child,
    prompt: string,
  ): Promise<{ id: string; answered: Promise<UserInputResponse> }> => {
    // ⚠️ **A COUNT of routings, not their existence** — one ledger can route an id twice (the last
    // test in §1 does), and a `some` would return on the first routing before the second is written.
    const routings = (id: string): number =>
      ledger(child.id).filter((event) => event.type === 'request_routed' && event.requestId === id)
        .length
    const before = routings(`ui_${String(Number(Reflect.get(child.handle, 'idCounter')) + 1)}`)
    const raised = child.handle.simulateUserInput(prompt, ['main', 'dev'])
    await waitFor(() => routings(raised.id) > before, `the routing of ${raised.id} on ${child.id}`)
    return raised
  }

  /**
   * ⛔ **The control's one fact: the second child's counter moved on**, so its first question is
   * `ui_41` rather than `ui_1`. ⚠️ `idCounter` is the double's own private field — reached here by
   * name rather than by a second `simulateUserInput` answered away, which would leave a closed `ui_1`
   * routing on that child and put the collision straight back.
   */
  const moveTheCounterOn = (child: Child): void => {
    expect(Reflect.get(child.handle, 'idCounter')).toBe(0)
    Reflect.set(child.handle, 'idCounter', 40)
  }

  /** ⚑ The PROSE half of a pass-up's answer — the row a person reads and a model reads first. */
  const passedUpSentence = async (pm: string, question: string): Promise<string> => {
    const tool = agentToolsFor(host, pm).tools.find((one) => one.name === 'pass_question_up')
    if (tool === undefined) throw new Error('no pass_question_up')
    // ⛔ A second pass of the same question is a second hop and answers with the same sentence
    // shape, so the text read here is the tool's own, not one this test composed.
    return (await tool.call({ question, who_answers: 'a-person' })).text
  }

  const answer = (
    pm: string,
    question: string,
    extra: Record<string, unknown> = {},
    chosen = 'main',
  ): Promise<Record<string, unknown>> =>
    callOn(pm, 'answer_question', {
      question,
      answers: [{ part: 'q0', answer: [chosen] }],
      ...extra,
    })

  const decisionsOn = (sessionId: string): number =>
    ledger(sessionId).filter((event) => event.type === 'user_decision').length

  // ───────────────────────────────────────────────────────────────────────────────────────────
  // §1 · the answer door
  // ───────────────────────────────────────────────────────────────────────────────────────────

  describe('§1 · the answer door', () => {
    it('🔴 the arm where it collides · with no asker named, the shared id is refused by name, BOTH askers named, and nothing is answered', async () => {
      const { pm, older, newer } = await aPmAndTwoChildren()
      const a = await childAsks(older, 'which branch for the API?')
      const b = await childAsks(newer, 'which branch for the docs?')
      // ⚑ **The premise, asserted** — two children's FIRST questions, one id.
      expect(b.id).toBe(a.id)

      const refused = await answer(pm, a.id)
      // ⛔ **Pinned on `main` @ `44c6f029`**: `{outcome: 'ok', agent: <newer>}` — the older child's
      // answer, taken by the newer one, which is the defect `675` F-b reasoned and this measured.
      expect(refused, JSON.stringify(refused)).toMatchObject({
        outcome: 'refused',
        rail: 'more-than-one-question-has-that-id',
        permanence: 'permanent',
        retryable: false,
        remedy: null,
        detail: { question: a.id, askers: [older.id, newer.id] },
      })
      // ⚑ **The act is in the sentence**, before anything that explains it (`675`'s cut).
      expect(refused.reason).toMatch(
        /^name which one you mean: make the same call again with asked_by/,
      )
      // ⛔ **And nothing moved**: neither provider was answered and neither ledger took a decision.
      expect(await settledYet(a.answered)).toBe(false)
      expect(await settledYet(b.answered)).toBe(false)
      expect([decisionsOn(older.id), decisionsOn(newer.id)]).toEqual([0, 0])
    })

    it('🔴 the arm where it collides · naming the asker reaches THAT child — the older one first, and the newer one is still waiting', async () => {
      const { pm, older, newer } = await aPmAndTwoChildren()
      const a = await childAsks(older, 'which branch for the API?')
      const b = await childAsks(newer, 'which branch for the docs?')
      expect(b.id).toBe(a.id)

      // 🔴 **`402` · the door the refusal names does not refuse its caller**: the same call, with
      // `asked_by` set to each asker the refusal named, lands on that asker.
      const toOlder = await answer(pm, a.id, { asked_by: older.id })
      expect(toOlder, JSON.stringify(toOlder)).toMatchObject({ outcome: 'ok', agent: older.id })
      await expect(a.answered).resolves.toMatchObject({ kind: 'answer', answers: { q0: ['main'] } })
      expect(await settledYet(b.answered)).toBe(false)
      expect(store.routedRequestsOf(newer.id).find((one) => one.requestId === b.id)?.state).toBe(
        'open',
      )

      const toNewer = await answer(pm, b.id, { asked_by: newer.id }, 'dev')
      expect(toNewer, JSON.stringify(toNewer)).toMatchObject({ outcome: 'ok', agent: newer.id })
      await expect(b.answered).resolves.toMatchObject({ kind: 'answer', answers: { q0: ['dev'] } })
    })

    it('🔴 the words a parent is HANDED name the asker beside the id — and doing exactly what they say lands on that child', async () => {
      const { pm, older, newer } = await aPmAndTwoChildren()
      const a = await childAsks(older, 'which branch for the API?')
      const b = await childAsks(newer, 'which branch for the docs?')
      expect(b.id).toBe(a.id)
      // ⚑ **Read off the parent's own ledger** — the turn `deliverQuestion` wrote, not a string this
      // test composed — so what is followed is what a model was actually told.
      const told = ledger(pm).flatMap((event) =>
        event.type === 'user_turn' && event.text.includes('which branch for the API?')
          ? [event.text]
          : [],
      )
      expect(told).toHaveLength(1)
      const quoted = /quoting (\S+) with asked_by (\S+)\./.exec(told[0] ?? '')
      // ⚑ **D-016 · commit 7 · R3 — `asked_by` quotes the asker's ADDRESS**: the label of the piece
      // it owns, which `answer_question` takes (R1), where it used to quote the id. ⚠️ The premise
      // that it IS a label, so what is followed below goes through the door's label reading.
      expect(host.addressOf(older.id)).not.toBe(older.id)
      expect(quoted?.slice(1), told[0]).toEqual([a.id, host.addressOf(older.id)])
      // ⛔ **`402` · the door the words name does not refuse the caller they were written for.**
      const done = await answer(pm, quoted?.[1] ?? '', { asked_by: quoted?.[2] })
      expect(done, JSON.stringify(done)).toMatchObject({ outcome: 'ok', agent: older.id })
      await expect(a.answered).resolves.toMatchObject({ answers: { q0: ['main'] } })
      expect(await settledYet(b.answered)).toBe(false)
    })

    it('⛔ an `asked_by` that is not a name is refused as malformed — never quietly dropped back to the id alone', async () => {
      const { pm, older, newer } = await aPmAndTwoChildren()
      const a = await childAsks(older, 'which branch for the API?')
      await childAsks(newer, 'which branch for the docs?')
      for (const bad of ['', 42, null]) {
        const refused = await answer(pm, a.id, { asked_by: bad })
        expect(refused, JSON.stringify(bad)).toMatchObject({
          outcome: 'refused',
          rail: 'malformed-request',
        })
        expect(JSON.stringify(refused.detail), JSON.stringify(bad)).toContain('asked_by')
        const passed = await callOn(pm, 'pass_question_up', {
          question: a.id,
          asked_by: bad,
          who_answers: 'a-person',
        })
        expect(passed, JSON.stringify(bad)).toMatchObject({
          outcome: 'refused',
          rail: 'malformed-request',
        })
      }
      expect([decisionsOn(older.id), decisionsOn(newer.id)]).toEqual([0, 0])
    })

    it('⚑ THE CONTROL · ids that differ route by the id alone, as they always did', async () => {
      const { pm, older, newer } = await aPmAndTwoChildren()
      moveTheCounterOn(newer)
      const a = await childAsks(older, 'which branch for the API?')
      const b = await childAsks(newer, 'which branch for the docs?')
      expect(b.id).not.toBe(a.id)

      expect(await answer(pm, a.id)).toMatchObject({ outcome: 'ok', agent: older.id })
      await expect(a.answered).resolves.toMatchObject({ answers: { q0: ['main'] } })
      expect(await settledYet(b.answered)).toBe(false)
      expect(await answer(pm, b.id, {}, 'dev')).toMatchObject({ outcome: 'ok', agent: newer.id })
      await expect(b.answered).resolves.toMatchObject({ answers: { q0: ['dev'] } })
    })

    it('🔴 an `asked_by` that raised nothing by a LIVE id is told so, truthfully — one answer for a sibling, a stranger and nobody', async () => {
      const mine = await aPmAndTwoChildren()
      const theirs = await aPmAndTwoChildren()
      const a = await childAsks(mine.older, 'which branch for the API?')
      await childAsks(theirs.older, 'which branch for the site?')

      // ⛔ **Not `no-question-by-that-name`** (this dispatch's review): its *"no conversation you
      // started is waiting on a request by that id… will never succeed"* is false here — the older
      // child IS waiting on it, and the right `asked_by` lands (below).
      const said = new Set<string>()
      // ⚑ **A child of mine that did not ask it, a child of somebody ELSE's that did, and nobody.**
      for (const askedBy of [mine.newer.id, theirs.older.id, 'sess_nobody']) {
        const refused = await answer(mine.pm, a.id, { asked_by: askedBy })
        expect(refused, askedBy).toMatchObject({
          outcome: 'refused',
          rail: 'that-conversation-did-not-ask-that',
          permanence: 'permanent',
          retryable: false,
          remedy: null,
          // ⛔ **Only the caller's own askers**, which `list_questions` already names to it.
          detail: { question: a.id, askers: [mine.older.id] },
        })
        said.add(JSON.stringify(refused))
      }
      // ⛔ **One answer for all three** — naming a stranger learns nothing about the stranger.
      expect(said.size).toBe(1)
      expect([...said][0]).toContain('make the same call again with asked_by')
      // ⚑ **An id nothing routed to the caller carries is the made-up-id absence whatever
      // `asked_by` says** — the rows decide, never the name.
      const nowhere = await answer(mine.pm, 'ui_nothing')
      expect(nowhere).toMatchObject({ outcome: 'refused', rail: 'no-question-by-that-name' })
      for (const askedBy of [mine.older.id, theirs.older.id]) {
        expect(await answer(mine.pm, 'ui_nothing', { asked_by: askedBy }), askedBy).toEqual(nowhere)
      }
      // ⛔ **`402` · the door the sentence names**: the asker the detail lists, named, lands.
      expect(await answer(mine.pm, a.id, { asked_by: mine.older.id })).toMatchObject({
        outcome: 'ok',
        agent: mine.older.id,
      })
    })

    it('🔴 an ANSWERED question still shares its id — the open one is not guessed, and the id alone stays refused', async () => {
      const { pm, older, newer } = await aPmAndTwoChildren()
      const a = await childAsks(older, 'which branch for the API?')
      const b = await childAsks(newer, 'which branch for the docs?')
      expect(b.id).toBe(a.id)
      expect(await answer(pm, a.id, { asked_by: older.id })).toMatchObject({ outcome: 'ok' })
      expect(store.routedRequestsOf(older.id).find((one) => one.requestId === a.id)?.state).toBe(
        'answered',
      )
      // ⛔ **Only one is still open, and the door still does not choose it**: a caller that meant the
      // answered one would have its words taken by a conversation that never asked them.
      expect(await answer(pm, a.id, {}, 'dev')).toMatchObject({
        outcome: 'refused',
        rail: 'more-than-one-question-has-that-id',
        detail: { askers: [older.id, newer.id] },
      })
      expect(await settledYet(b.answered)).toBe(false)
    })

    it('⚑ two children’s PERMISSIONS under one id are a person’s either way — refused as that, never as shared', async () => {
      const { pm, older, newer } = await aPmAndTwoChildren()
      // ⚑ **D-016** — each brief is the child's first turn, and it parks on that child's first card.
      for (const child of [older, newer]) host.claimSession(child.id, window)
      const cardOf = (child: Child) =>
        store
          .routedRequestsOf(child.id)
          .find((one) => one.went.is === 'the-person-the-channel-left-it-with')
      await waitFor(
        () => cardOf(older) !== undefined && cardOf(newer) !== undefined,
        'both children to park on their first card',
      )
      const cards = [older, newer].map((child) =>
        store
          .routedRequestsOf(child.id)
          .find((one) => one.went.is === 'the-person-the-channel-left-it-with'),
      )
      // ⚑ **The premise**: one id, both a person's, one kind — the double parks each turn on its
      // own first card, as a Codex child parks on its first approval (`number:0` on each connection).
      expect(cards[0]?.requestId).toBeDefined()
      expect(cards[1]?.requestId).toBe(cards[0]?.requestId)
      // ⛔ **Whichever was meant, the door says the same true thing and sends nothing** — so the id
      // alone is not refused as shared (the review's finding: `asked_by` would have been refused for
      // every asker a shared-id refusal listed).
      expect(await answer(pm, cards[0]?.requestId ?? '')).toMatchObject({
        outcome: 'refused',
        rail: 'a-person-answers-this-one',
      })
    })

    it('⚑ THE CONTROL · a permission and a QUESTION under one id are still refused as shared', async () => {
      const { pm, older, newer } = await aPmAndTwoChildren()
      // ⚑ **D-016** — each brief is the child's first turn, and it parks on that child's first card.
      for (const child of [older, newer]) host.claimSession(child.id, window)
      const cardOn = (child: Child) =>
        store
          .routedRequestsOf(child.id)
          .find((one) => one.went.is === 'the-person-the-channel-left-it-with')
      await waitFor(
        () => cardOn(older) !== undefined && cardOn(newer) !== undefined,
        'both children to park on their first card',
      )
      const card = cardOn(older)
      const own = cardOn(newer)
      const task = store.piecesOwnedBy(newer.id).find((one) => TASK_IS_OPEN[one.state])
      if (card === undefined || own === undefined || task === undefined) {
        throw new Error('the premise did not form')
      }
      // ⚠️ **A person settles the newer child's OWN card first.** One ledger folds a second routing
      // of an id into a row still open under it, so without this the plant below would be read as
      // that card again rather than as a question.
      await host.respondPermission(newer.id, own.requestId, { outcome: 'allow' }, window)
      await waitFor(
        () => !REQUEST_IS_OPEN[cardOn(newer)?.state ?? 'open'],
        "the newer child's own card to be settled",
      )
      // ⚑ **The one fact that differs from the test above**: the newer child's LAST request under
      // the id is a QUESTION — the app's own, its id planted to spell the card's, as in §4.
      mint.next = () => card.requestId
      const asked = await callOn(newer.id, 'ask_question', {
        who_answers: 'the-parent',
        piece: task.piece,
        question: 'postgres or sqlite?',
        options: ['postgres', 'sqlite'],
      })
      mint.next = null
      expect(asked, JSON.stringify(asked)).toMatchObject({ question: card.requestId })
      const last = (asker: string): string | undefined =>
        store
          .questionsRoutedTo(pm)
          .filter((one) => one.requestId === card.requestId && one.askedBy === asker)
          .at(-1)?.went.is
      expect([last(older.id), last(newer.id)]).toEqual([
        'the-person-the-channel-left-it-with',
        'the-parent',
      ])
      // ⛔ **One reading is a person's card and the other a question this caller may answer** — so
      // the id alone is ambiguous again, and refused rather than guessed.
      expect(await answer(pm, card.requestId)).toMatchObject({
        outcome: 'refused',
        rail: 'more-than-one-question-has-that-id',
        detail: { askers: [older.id, newer.id] },
      })
    })

    it('⚑ one asker that asked twice under one id is NOT ambiguous — the last routing is the live one, as `396` §3 has it', async () => {
      const { pm, older } = await aPmAndTwoChildren()
      const a = await childAsks(older, 'which branch for the API?')
      host.claimSession(older.id, window)
      await host.respondUserInput(
        older.id,
        a.id,
        { kind: 'answer', answers: { q0: ['dev'] } },
        window,
      )
      await expect(a.answered).resolves.toMatchObject({ answers: { q0: ['dev'] } })
      // ⛔ **A resumed conversation is a NEW provider session**, whose ids start again — so ONE asker
      // routes `ui_1` twice, the first answered and the second open. ⚠️ Not the same handle's counter
      // moved back: the double refuses an id it already settled, as a real provider would.
      await host.close(older.id, window)
      await host.resumeSession(older.id, window)
      const resumed: Child = { id: older.id, handle: latestHandle() }
      const again = await childAsks(resumed, 'and which branch for the tests?')
      expect(again.id).toBe(a.id)

      expect(await answer(pm, a.id)).toMatchObject({ outcome: 'ok', agent: older.id })
      await expect(again.answered).resolves.toMatchObject({ answers: { q0: ['main'] } })
    })
  })

  // ───────────────────────────────────────────────────────────────────────────────────────────
  // §2 · the pass-up door
  // ───────────────────────────────────────────────────────────────────────────────────────────

  describe('§2 · the pass-up door', () => {
    /** The words the pass-up carried, read off the passer's own new question. */
    const wordsPassedUp = (pm: string): string[] =>
      ledger(pm).flatMap((event) =>
        event.type === 'question_asked' && event.passedUpFrom !== undefined ? [event.prompt] : [],
      )

    it('🔴 the arm where it collides · the shared id is refused by name, and naming the asker carries THAT child’s words', async () => {
      const { pm, older, newer } = await aPmAndTwoChildren()
      const a = await childAsks(older, 'which branch for the API?')
      const b = await childAsks(newer, 'which branch for the docs?')
      expect(b.id).toBe(a.id)

      const refused = await callOn(pm, 'pass_question_up', {
        question: a.id,
        who_answers: 'a-person',
      })
      // ⛔ **Pinned on `main` @ `44c6f029`**: `ok`, carrying *"which branch for the docs?"* — the
      // NEWER child's words under the older child's id.
      expect(refused, JSON.stringify(refused)).toMatchObject({
        outcome: 'refused',
        rail: 'more-than-one-question-has-that-id',
        detail: { question: a.id, askers: [older.id, newer.id] },
      })
      expect(wordsPassedUp(pm)).toEqual([])

      const passed = await callOn(pm, 'pass_question_up', {
        question: a.id,
        asked_by: older.id,
        who_answers: 'a-person',
      })
      expect(passed.outcome, JSON.stringify(passed)).toBe('ok')
      expect(wordsPassedUp(pm)).toEqual(['which branch for the API?'])
    })

    it('⚑ a pass-up names the asker of the question it CARRIED, so the passer can quote the pair when the answer comes back', async () => {
      const { pm, older, newer } = await aPmAndTwoChildren()
      moveTheCounterOn(newer)
      const a = await childAsks(older, 'which branch for the API?')
      // ⚑ **The id was unique when it was passed up** — no `asked_by` given, none needed.
      const passed = await callOn(pm, 'pass_question_up', {
        question: a.id,
        who_answers: 'a-person',
      })
      expect(passed, JSON.stringify(passed)).toMatchObject({
        outcome: 'ok',
        passed_up: a.id,
        asked_by: older.id,
      })
      const said = await passedUpSentence(pm, a.id)
      // ⚑ **D-016 · commit 7 · R3** — the sentence quotes the asker's address (the label of the
      // piece it owns, which `answer_question` takes), and the payload above keeps its id.
      expect(said).toContain(`answer_question with asked_by ${host.addressOf(older.id)}`)
    })

    it('⚑ THE CONTROL · ids that differ carry the right words by the id alone', async () => {
      const { pm, older, newer } = await aPmAndTwoChildren()
      moveTheCounterOn(newer)
      const a = await childAsks(older, 'which branch for the API?')
      const b = await childAsks(newer, 'which branch for the docs?')
      expect(b.id).not.toBe(a.id)

      for (const id of [a.id, b.id]) {
        const passed = await callOn(pm, 'pass_question_up', {
          question: id,
          who_answers: 'a-person',
        })
        expect(passed.outcome, JSON.stringify(passed)).toBe('ok')
      }
      expect(wordsPassedUp(pm)).toEqual(['which branch for the API?', 'which branch for the docs?'])
    })
  })

  // ───────────────────────────────────────────────────────────────────────────────────────────
  // §3 · the key across a reopen
  // ───────────────────────────────────────────────────────────────────────────────────────────

  describe('§3 · across a reopen the key does not move', () => {
    it('⚑ a question that outlives a stop keeps its asker AND its id across the reopen — the same key, so a sibling sharing the id still makes it ambiguous and naming it still lands', async () => {
      const { pm, older, newer } = await aPmAndTwoChildren()
      host.claimSession(older.id, window)
      // ⚑ **D-016** — the work is the older child's brief, and its piece is still open.
      const task = store.piecesOwnedBy(older.id).find((one) => TASK_IS_OPEN[one.state])
      if (task === undefined) throw new Error('the give never opened a piece')
      // ⚑ **The app's own question**, whose id this test makes spell the newer child's provider id —
      // so the reopen's second routing and the sibling's question share one id and differ by asker.
      mint.next = () => 'ui_1'
      const asked = await callOn(older.id, 'ask_question', {
        who_answers: 'the-parent',
        piece: task.piece,
        question: 'postgres or sqlite?',
        options: ['postgres', 'sqlite'],
      })
      mint.next = null
      expect(asked, JSON.stringify(asked)).toMatchObject({ outcome: 'ok', question: 'ui_1' })
      const b = await childAsks(newer, 'which branch for the docs?')
      expect(b.id).toBe('ui_1')

      await host.close(older.id, window)
      await host.resumeSession(older.id, window)
      const routings = store.routedRequestsOf(older.id).filter((one) => one.requestId === 'ui_1')
      // ⚑ **One routing, one asker, one id, still open** — ⚑ D-017 · R4: a question this app asked
      // outlives the stop (the launch marker says so), so the reopen has nothing to route again
      // (`661`'s second routing is gone with the bring-back) and the key is the one it always had.
      expect(routings.map((one) => one.state)).toEqual(['open'])

      expect(await answer(pm, 'ui_1')).toMatchObject({
        outcome: 'refused',
        rail: 'more-than-one-question-has-that-id',
        detail: { askers: [older.id, newer.id] },
      })
      const done = await callOn(pm, 'answer_question', {
        question: 'ui_1',
        asked_by: older.id,
        answers: [{ part: 'answer', answer: ['sqlite'] }],
      })
      expect(done, JSON.stringify(done)).toMatchObject({ outcome: 'ok', agent: older.id })
      expect(await settledYet(b.answered)).toBe(false)
    })
  })

  // ───────────────────────────────────────────────────────────────────────────────────────────
  // §4 · the app-held map, keyed the same way
  // ───────────────────────────────────────────────────────────────────────────────────────────

  describe('§4 · the words this app holds are known by who asked them too', () => {
    /**
     * ⚑ **The older child asks its parent through the APP (`ask_question`), with its id planted to
     * spell `ui_1`; the newer child's PROVIDER asks `ui_1` too.** ⛔ Across origins this needs a
     * provider free to mint the app's spelling — the one case the map's key has to survive, and the
     * only arm on which it can be measured, since `req_<uuid>` never repeats on its own.
     */
    const anAppQuestionAndAProviderQuestionOneId = async (): Promise<{
      pm: string
      older: Child
      newer: Child
      providers: { id: string; answered: Promise<UserInputResponse> }
    }> => {
      const { pm, older, newer } = await aPmAndTwoChildren()
      host.claimSession(older.id, window)
      host.claimSession(newer.id, window)
      // ⚑ **D-016** — the work is the older child's brief, and its piece is still open.
      const task = store.piecesOwnedBy(older.id).find((one) => TASK_IS_OPEN[one.state])
      if (task === undefined) throw new Error('the give never opened a piece')
      mint.next = () => 'ui_1'
      const asked = await callOn(older.id, 'ask_question', {
        who_answers: 'the-parent',
        piece: task.piece,
        question: 'postgres or sqlite?',
        options: ['postgres', 'sqlite'],
      })
      mint.next = null
      expect(asked, JSON.stringify(asked)).toMatchObject({ outcome: 'ok', question: 'ui_1' })
      const providers = await childAsks(newer, 'which branch for the docs?')
      expect(providers.id).toBe('ui_1')
      return { pm, older, newer, providers }
    }

    it('🔴 the PROVIDER’s question is answered through its provider, never as the app’s held words', async () => {
      const { pm, older, newer, providers } = await anAppQuestionAndAProviderQuestionOneId()
      // ⚠️ **Every part of BOTH questions answered** (this dispatch's review), so a door that took
      // the card for the sibling's held words would take it SILENTLY — `ok`, and the provider never
      // told — rather than refusing a missing part. ⚑ A provider ignores a part it did not ask.
      const done = await callOn(pm, 'answer_question', {
        question: 'ui_1',
        asked_by: newer.id,
        answers: [
          { part: 'q0', answer: ['main'] },
          { part: 'answer', answer: ['sqlite'] },
        ],
      })
      expect(done, JSON.stringify(done)).toMatchObject({ outcome: 'ok', agent: newer.id })
      // ⛔ **Settled-yet first**, so the silent take fails here rather than hanging.
      expect(await settledYet(providers.answered)).toBe(true)
      await expect(providers.answered).resolves.toMatchObject({ answers: { q0: ['main'] } })
      // ⛔ **And the app's question is untouched** — still open, still owed an answer.
      expect(
        store
          .routedRequestsOf(older.id)
          .filter((one) => one.requestId === 'ui_1')
          .map((one) => one.state),
      ).toEqual(['open'])
    })

    it('⚑ THE PAIR · the APP’s question, named, is answered from the held words', async () => {
      const { pm, older, providers } = await anAppQuestionAndAProviderQuestionOneId()
      const done = await callOn(pm, 'answer_question', {
        question: 'ui_1',
        asked_by: older.id,
        answers: [{ part: 'answer', answer: ['sqlite'] }],
      })
      expect(done, JSON.stringify(done)).toMatchObject({ outcome: 'ok', agent: older.id })
      expect(await settledYet(providers.answered)).toBe(false)
      await waitFor(
        () =>
          ledger(older.id).some(
            (event) =>
              (event.type === 'user_turn' || event.type === 'message_queued') &&
              event.text.includes('answer: sqlite'),
          ),
        'the answer delivered into the older child as words',
      )
    })

    it('🔴 a PERSON answering the provider’s card on the newer child reaches that provider', async () => {
      const { older, newer, providers } = await anAppQuestionAndAProviderQuestionOneId()
      const ack = await host.respondUserInput(
        newer.id,
        'ui_1',
        { kind: 'answer', answers: { q0: ['dev'] } },
        window,
      )
      expect(ack, JSON.stringify(ack)).not.toMatchObject({ outcome: 'refused' })
      // ⚠️ **Settled-yet first**, so a door that took the card for the app's words fails here in
      // fifty milliseconds rather than hanging on a promise nothing will ever resolve.
      expect(await settledYet(providers.answered)).toBe(true)
      await expect(providers.answered).resolves.toMatchObject({ answers: { q0: ['dev'] } })
      expect(
        store
          .routedRequestsOf(older.id)
          .filter((one) => one.requestId === 'ui_1')
          .map((one) => one.state),
      ).toEqual(['open'])
    })

    it('🔴 a close remembers only the questions THIS conversation asked the app — the provider’s card does not come back on a reopen', async () => {
      const { newer } = await anAppQuestionAndAProviderQuestionOneId()
      await host.close(newer.id, window)
      const card = (): string | undefined =>
        store
          .routedRequestsOf(newer.id)
          .filter((one) => one.requestId === 'ui_1')
          .at(-1)?.state
      expect(card()).toBe('abandoned')

      await host.resumeSession(newer.id, window)
      // ⛔ **Its provider died with the close** and the reopen is a new one that never had it, so
      // the card stays ended — a second routing here would list a question nothing can answer.
      expect(card()).toBe('abandoned')
      expect(REQUEST_IS_OPEN.abandoned).toBe(false)
    })

    it('🔴 a provider card whose asker is GONE is not the sibling’s held words either — its words were never held', async () => {
      failable.on = true
      const { pm, newer } = await anAppQuestionAndAProviderQuestionOneId()
      const fail = levers.get(newer.handle)
      if (fail === undefined) throw new Error('no lever on the newer child')
      fail()
      await waitFor(() => !host.sessionIds.includes(newer.id), 'the failed stream to end it')
      // ⚑ **The premise**: nothing ended the card — no `status` row — so it is still `open` with
      // nobody running to take an answer.
      expect(
        store
          .routedRequestsOf(newer.id)
          .filter((one) => one.requestId === 'ui_1')
          .map((one) => one.state),
      ).toEqual(['open'])
      // ⛔ **`has-gone`, and its *never* is true**: the provider that raised the card died with its
      // stream. ⚠️ Read by the id alone, the held-words check found the SIBLING's app question and
      // said `has-ended` — *"if it is reopened while this app runs, you can answer it then"* — false
      // of a card no reopen will ever raise again (this dispatch's review).
      expect(await answer(pm, 'ui_1', { asked_by: newer.id })).toMatchObject({
        outcome: 'refused',
        rail: 'the-conversation-that-asked-has-gone',
      })
    })
  })
})
