import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { FakeProviderSessions, SessionMachine } from '@brobot2/runtime'
import type { FakeSessionHandle, RuntimeEvent, StartOptions } from '@brobot2/runtime'
import { AsyncQueue } from '../../../packages/runtime/src/internal/async-queue'
import type { Provider } from '@brobot2/shared'
import { type AppDatabase, openDatabase } from '../src/main/db/connection'
import { applyMigrations } from '../src/main/db/migrate'
import { createSessionStore, type SessionStore } from '../src/main/db/session-store'
import { NO_DISCOVERY } from '../src/main/adopt/discover-sessions'
import { RuntimeHost } from '../src/main/runtime/runtime-host'
import type { RuntimeEventSink } from '../src/main/runtime/runtime-host'
import { agentToolsFor, type ToolName } from '../src/main/runtime/agent-tools'
import { resolveSessionCwd } from '../src/main/runtime/scratch-cwd'
import { agentName } from '../src/shared/runtime-ipc'
import type { RuntimeEventMessage, TranscriptEvent } from '../src/shared/runtime-ipc'
import { ProviderDouble, anOpenGate, type ResumeGate } from './lib/provider-double'

/**
 * # 🔴 734 · the queue names agents, not folders
 *
 *  - **§1 · `732` F-1, under R41** — *"every identity a person reads is NAMED (`agentName`), never by
 *    slug, and never by a folder."* ⛔ On `main` a person's questions, decisions, proposals and the
 *    digest named a conversation by the basename of its working folder (`nameForAPerson`, `398`),
 *    and in the default folder that is `brobot-workspace` for every agent a person has. ⚑ Control:
 *    a conversation with NO identity still reads its folder. ⚑ And where two conversations of ONE
 *    identity must be told apart, what tells them apart rides beside the name (`732` F-6).
 *  - **§2 · `732` F-5** — `stop_unanswered` carries the asking agent's identity (its folded slug), from
 *    the builder `work_interrupted` uses, so the two rows about one ask cannot disagree. ⛔ On `main`
 *    it carried the conversation alone.
 *
 * ⚑ Real host, real SQLite, real migrations, real tools; the only double is the provider.
 */
const here = dirname(fileURLToPath(import.meta.url))
const migrationsFolder = join(here, '../src/main/db/migrations')

/** ⚑ The host's own bound on an unanswered stop — short, so §2 measures the host and not the clock. */
const INTERRUPT_WAIT_MS = 40

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

/** ⚑ `ProviderDouble`, with one start's handle decorated. */
class DecoratingDouble extends ProviderDouble {
  constructor(
    provider: Provider,
    handles: FakeSessionHandle[],
    sessions: FakeProviderSessions,
    gate: ResumeGate,
    private readonly takeDecoration: () =>
      ((handle: FakeSessionHandle) => FakeSessionHandle) | null,
  ) {
    super(provider, handles, sessions, gate)
  }
  override async start(options: StartOptions): Promise<FakeSessionHandle> {
    const handle = await super.start(options)
    const decorate = this.takeDecoration()
    return decorate === null ? handle : decorate(handle)
  }
}

/**
 * ⚑ **A turn that stays `working`, and a provider that never answers a stop** — `723`'s Codex that
 * neither answers `turn/interrupt` nor ends the turn, as a handle. ⛔ The Fake's own turn parks on a
 * permission card, and an agent may not stop a turn a person is being asked in.
 */
function aTurnThatNeverAnswersAStop(handle: FakeSessionHandle): FakeSessionHandle {
  const queue = new AsyncQueue<RuntimeEvent>()
  let status = handle.status()
  const machine = new SessionMachine((event) => {
    if (event.type === 'status') status = event.state
    queue.push(event)
  })
  machine.markStarting()
  machine.sessionStarted(handle.ref, 'started')
  let closing: Promise<void> | null = null
  return new Proxy(handle, {
    get(target, property) {
      if (property === 'events') return (): AsyncIterable<RuntimeEvent> => queue
      if (property === 'status') return () => status
      if (property === 'send') {
        return async (): Promise<void> => {
          if (machine.beginTurn() === null) {
            throw new Error('cannot send: session is not active or a turn is in progress')
          }
        }
      }
      // ⛔ **Asked, and never answered** — the turn runs on.
      if (property === 'interrupt') return (): Promise<void> => new Promise<void>(() => {})
      if (property === 'close') {
        return (): Promise<void> =>
          (closing ??= (async () => {
            if (machine.beginClose()) {
              if (machine.hasProviderWork) machine.forceEnd(false)
              machine.closeSession(handle.ref)
              queue.close()
            }
            await target.close()
          })())
      }
      const value = Reflect.get(target, property, target) as unknown
      return typeof value === 'function' ? (value as () => unknown).bind(target) : value
    },
  })
}

describe('734 · the queue names agents, not folders', () => {
  let userData: string
  let db: AppDatabase
  let store: SessionStore
  let host: RuntimeHost
  let handles: FakeSessionHandle[]
  let issued: FakeProviderSessions
  let counter: number
  let clock: number
  let window: RecordingSink
  let gate: ResumeGate
  let decorateNext: ((handle: FakeSessionHandle) => FakeSessionHandle) | null
  const tick = (): number => clock++

  beforeEach(() => {
    userData = mkdtempSync(join(tmpdir(), 'brobot2-734-'))
    db = openDatabase(join(userData, 'brobot2.sqlite'))
    applyMigrations(db, migrationsFolder)
    clock = 7_340_000
    store = createSessionStore(db, tick)
    counter = 0
    handles = []
    issued = new FakeProviderSessions()
    gate = anOpenGate()
    decorateNext = null
    host = new RuntimeHost({
      store,
      discoverSessions: NO_DISCOVERY,
      nativeTranscriptPath: () => null,
      exportDirectory: () => join(userData, 'exports'),
      createRuntime: (provider: Provider) =>
        new DecoratingDouble(provider, handles, issued, gate, () => {
          const decorate = decorateNext
          decorateNext = null
          return decorate
        }),
      prepareProviderHome: (provider: Provider, profileId?: string) => {
        const home = join(userData, 'provider-homes', profileId ?? 'default', provider)
        mkdirSync(home, { recursive: true })
        return home
      },
      providerHomePath: (provider: Provider) => join(userData, 'provider-homes', provider),
      resolveCwd: (sessionId, requested) => resolveSessionCwd(userData, sessionId, requested),
      newSessionId: () => `sess_${++counter}`,
      now: tick,
      interruptWaitMs: INTERRUPT_WAIT_MS,
      readProviderConfig: (provider, home) => ({
        home,
        homeEnv: 'CLAUDE_CONFIG_DIR',
        model: 'm',
        authNote: null,
        files: [],
      }),
    })
    window = new RecordingSink('webContents:1')
  })

  afterEach(async () => {
    await host.closeAll()
    db.close()
    rmSync(userData, { recursive: true, force: true })
  })

  const events = (sessionId: string): TranscriptEvent[] =>
    store.events(sessionId).map((entry) => entry.event)

  const waitFor = async (predicate: () => boolean, what: string): Promise<void> => {
    for (let attempt = 0; attempt < 400; attempt++) {
      if (predicate()) return
      await new Promise((resolve) => setTimeout(resolve, 10))
    }
    throw new Error(`timed out waiting for ${what}`)
  }

  /** ⚑ A person opens a conversation with NO folder chosen — the app's default workspace. */
  const personOpens = async (profileId: string): Promise<string> => {
    const { sessionId } = await host.createSession(
      { provider: 'claude', profileId, approvalMode: 'ask' },
      window,
    )
    return sessionId
  }

  const bringIdentityIntoBeing = async (profileId: string): Promise<void> => {
    await host.close(await personOpens(profileId), window)
  }

  const callOn = async (
    caller: string,
    name: ToolName,
    args: Record<string, unknown> = {},
  ): Promise<Record<string, unknown>> => {
    const tool = agentToolsFor(host, caller).tools.find((one) => one.name === name)
    if (tool === undefined) throw new Error(`no such tool: ${name}`)
    return (await tool.call(args)).structured as Record<string, unknown>
  }

  const latestHandle = (): FakeSessionHandle => {
    const handle = handles.at(-1)
    if (handle === undefined) throw new Error('no provider handle has been issued')
    return handle
  }

  const theFolderOf = (sessionId: string): string =>
    basename(store.recordedOne(sessionId)?.cwd ?? '')

  interface GraceAndAda {
    /** Grace, opened by a person. */
    readonly boss: string
    /** Ada, started by the piece Grace gave it. */
    readonly pm: string
  }

  /**
   * ⚑ **`parent` gives a child of `profile` a piece**, and returns it with its provider handle.
   *
   * ⚑ **D-016 · the give starts the child, and its brief is the child's first turn** — where a spawn
   * started it idle and a `work` message opened the turn. Every conversation here is in `ask`, and a
   * give runs in its giver's mode, so that turn parks on the Fake's permission card: a decision only
   * a person can make, waited for here.
   */
  const gives = async (
    parent: string,
    profile: string,
    brief = 'do the thing',
  ): Promise<{ child: string; handle: FakeSessionHandle; piece: string; label: string }> => {
    const given = await callOn(parent, 'give_work', {
      definition_of_done: 'The requested result and its checks are recorded.',
      profile,
      title: brief,
      brief,
    })
    expect(given.outcome, JSON.stringify(given)).toBe('ok')
    const child = given.agent as string
    const handle = latestHandle()
    await waitFor(
      () => events(child).some((event) => event.type === 'permission_request'),
      'the card the brief’s turn parks on',
    )
    return { child, handle, piece: given.piece as string, label: given.label as string }
  }

  /**
   * ⚑ **`732`'s rig, in the default folder**: Grace opened by a person, Ada given a piece by Grace —
   * each identity NAMED, so a name that is not the folder is the name a person gave. ⚠️ Every
   * conversation below works in the one default workspace, so the folder names none of them.
   * ⚑ D-016: Ada's brief parks her on a card of her own, as every child's does here.
   */
  const graceAndAda = async (): Promise<GraceAndAda> => {
    await bringIdentityIntoBeing('pm-g')
    await bringIdentityIntoBeing('worker-g')
    await bringIdentityIntoBeing('helper-g')
    const boss = await personOpens('boss-g')
    for (const [slug, name] of [
      ['boss-g', 'Grace'],
      ['pm-g', 'Ada'],
      ['worker-g', 'Bob'],
      ['helper-g', 'Cleo'],
    ] as const) {
      expect(host.setAgentDisplayName(slug, name), slug).not.toBeNull()
    }
    const { child: pm } = await gives(boss, 'pm-g', 'plan')
    return { boss, pm }
  }

  /** ⚑ **A child asks**, and the question is routed to the conversation that gave it its piece. */
  const aChildAsks = async (child: string, handle: FakeSessionHandle): Promise<string> => {
    const question = handle.simulateUserInput('which region?', ['eu', 'us'])
    await waitFor(
      () =>
        events(child).some(
          (event) => event.type === 'request_routed' && event.requestId === question.id,
        ),
      'the routing of the question',
    )
    return question.id
  }

  /**
   * ⚑ **The parent passes it up to a person** — `pass_question_up`, which raises it again from the
   * PARENT, addressed to a person: the row a person's queue lists is the parent's, one hop.
   */
  const passedUp = async (parent: string, questionId: string): Promise<string> => {
    const passed = await callOn(parent, 'pass_question_up', {
      question: questionId,
      who_answers: 'a-person',
    })
    expect(passed.outcome, JSON.stringify(passed)).toBe('ok')
    return passed.question as string
  }

  const questionRow = (askedBy: string, requestId: string) =>
    host
      .questionsForAPerson()
      .rows.find((one) => one.request.askedBy === askedBy && one.request.requestId === requestId)

  /** ⚑ **Counts the roster reads** one call makes — a memo nothing counts is a claim. */
  const rosterReadsIn = <T>(call: () => T): { answer: T; reads: number } => {
    const real = store.agentIdentities.bind(store)
    let reads = 0
    store.agentIdentities = () => {
      reads += 1
      return real()
    }
    try {
      return { answer: call(), reads }
    } finally {
      store.agentIdentities = real
    }
  }

  /**
   * ⚑ A parent gives a child of `profile` a piece, and the child reports it done — two digest rows.
   * ⚑ D-016: the give is what starts the child, so it is named by its profile.
   */
  const workDoneBy = async (
    parent: string,
    profile: string,
    text: string,
  ): Promise<{ child: string; label: string }> => {
    const { child, piece, label } = await gives(parent, profile, text)
    const replied = await callOn(child, 'reply_to_parent', {
      piece,
      outcome: 'done',
      summary: `${text}: done`,
    })
    expect(replied.outcome, JSON.stringify(replied)).toBe('ok')
    return { child, label }
  }

  // ─────────────────────────────────────────────────────────────────────────────────────────────
  // §1 · `732` F-1 — a person's queue names the conversation's AGENT
  // ─────────────────────────────────────────────────────────────────────────────────────────────

  describe('§1 · `732` F-1 — a person’s queue names the agent, never its folder', () => {
    it('🔴 §1.1 a question Ada passed up to you — Ada waiting on you — in the default folder', async () => {
      const { pm } = await graceAndAda()
      const { child: worker, handle } = await gives(pm, 'worker-g')
      const passed = await passedUp(pm, await aChildAsks(worker, handle))
      // ⛔ **The premise**: one default folder for both, so a folder cannot tell them apart.
      expect(theFolderOf(worker)).toBe('brobot-workspace')
      expect(theFolderOf(pm)).toBe('brobot-workspace')
      const row = questionRow(pm, passed)
      // 🔴 **RED on `main`**: *"brobot-workspace waiting on you"*.
      expect(row?.sentence).toBe('Ada waiting on you')
      expect(row?.reading.hops).toEqual([{ waiting: 'Ada', on: null }])
      // ⚑ …and the conversation stays on the row, beside the name (`732` F-6).
      expect(row?.chain.links.map((link) => link.waiting)).toEqual([pm])
    })

    it('🔴 §1.2 the decision only a person can make — Bob waiting on you', async () => {
      const { pm } = await graceAndAda()
      // ⚑ D-016 · the brief parks it on the card.
      const { child: worker } = await gives(pm, 'worker-g')
      const [row] = host.decisionsForAPerson().rows.filter((one) => one.request.askedBy === worker)
      expect(row?.sentence).toBe('Bob waiting on you')
      expect(row?.reading.hops).toEqual([{ waiting: 'Bob', on: null }])
    })

    it('🔴 §1.4 the digest — the work went to Bob, and Bob reported it', async () => {
      const { pm } = await graceAndAda()
      // ⚑ D-016 · the give hands Bob the work — the digest's `work_given` row.
      const { child: worker, piece, label } = await gives(pm, 'worker-g', 'count the moons')
      const replied = await callOn(worker, 'reply_to_parent', {
        piece,
        outcome: 'done',
        summary: 'four of them',
      })
      expect(replied.outcome, JSON.stringify(replied)).toBe('ok')
      const { answer: digest, reads } = rosterReadsIn(() => host.digest(7_340_000, clock + 1))
      const said = digest.digest.lines.map((line) => line.text)
      // ⚑ **One roster read for the whole digest** — the agents it names come from one read, as its
      // docblock says (D-016 took the proposer's name, `distil`'s `agentCalled`, with proposals).
      // ⚠️ Green on `main` too (its namer read no roster): a pin for `734 M12`, and not part of this
      // test's RED.
      expect(reads).toBe(1)
      // 🔴 **RED on `main`**: *"…to brobot-workspace"* and *"brobot-workspace reported…"*.
      // ⚑ D-016 · a piece reads by its label and title, where it was *Task #N*.
      expect(said.join('\n')).toContain(`${label} · count the moons, to Bob`)
      expect(said).toContain(`Bob reported ${label} · count the moons done — four of them`)
      expect(said.join('\n')).not.toContain('brobot-workspace')
    })

    it('⚑ §1.5 control · a conversation with NO identity still reads its folder, as it did', async () => {
      // ⚑ **A conversation this app never placed** (`438`'s `never-placed`) — found, not launched.
      const folder = join(userData, 'the-old-project')
      mkdirSync(folder, { recursive: true })
      store.adopt({
        id: 'sess_found',
        provider: 'claude',
        sessionId: 'ext_found',
        cwd: folder,
        profileId: null,
        createdAt: clock,
        updatedAt: clock,
      })
      expect(store.identityOf('sess_found')).toBeNull()
      store.append(
        'sess_found',
        0,
        {
          type: 'request_routed',
          requestId: 'req_found',
          to: 'a-person',
          because: 'a-permission-decision',
          parent: 'sess_nobody',
        },
        tick(),
      )
      const [row] = host
        .decisionsForAPerson()
        .rows.filter((one) => one.request.askedBy === 'sess_found')
      // ⛔ **Its folder, and never the band's category** (*"an agent this app cannot name"*): a row a
      // person must find needs a word they can find it by.
      expect(row?.sentence).toBe('the-old-project waiting on you')
    })

    it('names an unplaced conversation by the last folder in a Windows cwd', () => {
      store.adopt({
        id: 'sess_windows',
        provider: 'claude',
        sessionId: 'ext_windows',
        cwd: 'C:\\work\\winter-notes\\',
        profileId: null,
        createdAt: clock,
        updatedAt: clock,
      })
      store.append(
        'sess_windows',
        0,
        {
          type: 'request_routed',
          requestId: 'req_windows',
          to: 'a-person',
          because: 'a-permission-decision',
          parent: 'sess_nobody',
        },
        tick(),
      )
      const row = host
        .decisionsForAPerson()
        .rows.find((one) => one.request.askedBy === 'sess_windows')
      expect(row?.sentence).toBe('winter-notes waiting on you')
    })

    it('⚑ §1.6 the names are read per look — renamed, the next look says the new ones', async () => {
      // ⚠️ A memo that outlived one answer would say *Ada* and *Bob* for the life of the app.
      const { pm } = await graceAndAda()
      const { child: worker, handle } = await gives(pm, 'worker-g')
      const passed = await passedUp(pm, await aChildAsks(worker, handle))
      const said = (): (string | undefined)[] => [
        questionRow(pm, passed)?.sentence,
        host.decisionsForAPerson().rows.find((one) => one.request.askedBy === worker)?.sentence,
      ]
      expect(said()).toEqual(['Ada waiting on you', 'Bob waiting on you'])
      expect(host.setAgentDisplayName('pm-g', 'Ava')).not.toBeNull()
      expect(host.setAgentDisplayName('worker-g', 'Ben')).not.toBeNull()
      expect(said()).toEqual(['Ava waiting on you', 'Ben waiting on you'])
    })

    it('⚑ §1.7 two LIVE conversations of ONE identity read one name in a person’s queue — and each row keeps its conversation', async () => {
      // ⚑ **D-016 · one conversation per helper PER GIVER**, so Grace's Bob and Ada's Bob are both
      // live — a give reaches the conversation its OWN giver has with that agent. ⚠️ Their name is
      // one word — R41's letter — and the PM closed `732` F-6 on *"the row keeps each conversation's
      // id"*: this pins that it still does. Each brief parks its Bob on a card.
      const { boss, pm } = await graceAndAda()
      const { child: gracesBob } = await gives(boss, 'worker-g')
      const { child: adasBob } = await gives(pm, 'worker-g')
      expect(gracesBob).not.toBe(adasBob)
      const rows = host
        .decisionsForAPerson()
        .rows.filter((one) => [gracesBob, adasBob].includes(one.request.askedBy))
      expect(rows.map((one) => one.sentence)).toEqual(['Bob waiting on you', 'Bob waiting on you'])
      expect(rows.map((one) => one.request.askedBy).sort()).toEqual([gracesBob, adasBob].sort())
    })

    it('⚑ §1.7b …and the digest names an ended Bob beside its successor, each line keeping its own', async () => {
      // ⚑ **Over a window**: Bob, closed, then a new Bob — the piece's label and each claim line's
      // conversation tell them apart.
      const { boss, pm } = await graceAndAda()
      const { child: first, label: one } = await workDoneBy(pm, 'worker-g', 'count the moons')
      // ⚑ **A person closes the first** — its turn is parked on a card, which an agent may not end.
      host.claimSession(first, window)
      await host.close(first, window)
      // ⛔ **D-017 · R15 — a close is a STOP, and a stopped Bob is still Ada's Bob**: ⚑ D-016 · a give
      // from Ada reaches the conversation Ada already has with Bob, and starts it again. The new Bob
      // is therefore GRACE's — another giver — and the digest still reads one name for two
      // conversations of one identity across the window.
      const { child: second, label: two } = await workDoneBy(boss, 'worker-g', 'count the rings')
      expect(second).not.toBe(first)
      expect(store.identityOf(second)?.profileSlug).toBe(store.identityOf(first)?.profileSlug)
      const claims = host
        .digest(7_340_000, clock + 1)
        .digest.lines.filter((line) => line.register === 'claimed')
      // ⚠️ **One name for both** — and the label and the line's conversation tell them apart.
      expect(claims.map((line) => line.text).sort()).toEqual(
        [
          `Bob reported ${one} · count the moons done — count the moons: done`,
          `Bob reported ${two} · count the rings done — count the rings: done`,
        ].sort(),
      )
      const said = (text: string): string | undefined =>
        claims.find((line) => line.text.includes(text))?.id
      expect(said('count the moons')).toContain(first)
      expect(said('count the rings')).toContain(second)
    })

    it('⚑ §1.8 the roster is read ONCE per answer, however many agents it names — and again for the next', async () => {
      // ⚠️ **`oneNamingPerAnswer`'s docblock says so, and a memo nothing counts is a claim.** The
      // queue is polled every five seconds for the life of a window.
      const { pm } = await graceAndAda()
      const { child: bob } = await gives(pm, 'worker-g')
      const { child: cleo } = await gives(pm, 'helper-g')
      const once = rosterReadsIn(() => host.decisionsForAPerson())
      // ⚑ **Three agents named in one answer** — Ada, Bob and Cleo, each parked on the card its brief
      // raised (D-016) — so a roster read per NAME is three.
      expect(once.answer.rows.map((one) => one.sentence).sort()).toEqual([
        'Ada waiting on you',
        'Bob waiting on you',
        'Cleo waiting on you',
      ])
      expect(
        once.answer.rows.filter((one) => [bob, cleo].includes(one.request.askedBy)),
      ).toHaveLength(2)
      expect(once.reads).toBe(1)
      expect(rosterReadsIn(() => host.decisionsForAPerson()).reads).toBe(1)
    })
  })

  // ─────────────────────────────────────────────────────────────────────────────────────────────
  // §2 · `732` F-5 — `stop_unanswered` says WHICH agent asked
  // ─────────────────────────────────────────────────────────────────────────────────────────────

  const ofType = (sessionId: string, type: TranscriptEvent['type']): TranscriptEvent[] =>
    events(sessionId).filter((event) => event.type === type)

  const sentLive = (sessionId: string, type: TranscriptEvent['type']): unknown[] =>
    window.messages
      .filter((one) => one.sessionId === sessionId && one.event.type === type)
      .map((one) => one.event)

  /** ⚑ Grace, Ada, and Bob — whose turn runs, and whose provider never answers a stop. */
  const bobWhoNeverAnswers = async (): Promise<GraceAndAda & { worker: string }> => {
    const rig = await graceAndAda()
    decorateNext = aTurnThatNeverAnswersAStop
    let worker: string
    try {
      // ⚑ **D-016 · the brief is the turn** — a give starts Bob and sends it, where a spawn started
      // him idle and a `work` message began the turn. ⛔ Not {@link gives}: this handle raises no card.
      const given = await callOn(rig.pm, 'give_work', {
        definition_of_done: 'The requested result and its checks are recorded.',
        profile: 'worker-g',
        title: '734-a-turn-nobody-can-stop',
        brief: '734-a-turn-nobody-can-stop',
      })
      expect(given.outcome, JSON.stringify(given)).toBe('ok')
      expect(given.delivery).toBe('sent')
      worker = given.agent as string
    } finally {
      decorateNext = null
    }
    // ⚑ **D-017 · R11 — the card's word for a running turn is `active`** (the one shared state),
    // where it said `working`. ⚠️ The brief above was DELIVERED (`sent`), so the turn has begun.
    await waitFor(
      () => host.agentCard(worker, { ownerId: `agent:${rig.pm}` }, rig.pm)?.state.is === 'active',
      'the provider turn to be working',
    )
    return { ...rig, worker }
  }

  describe('§2 · `732` F-5 — an unanswered stop says which agent asked', () => {
    it('🔴 §2.1 Grace stops Bob and the provider never answers — the row says it was Grace’s identity, as the ask does', async () => {
      const rig = await bobWhoNeverAnswers()
      await callOn(rig.boss, 'interrupt_agent', { agent: rig.worker, reason: 'the plan changed' })
      await waitFor(
        () => ofType(rig.worker, 'stop_unanswered').length === 1,
        'the stop to be said unanswered',
      )
      // 🔴 **RED on `main`**: `{ waitedMs, by, agent }` and no identity.
      expect(ofType(rig.worker, 'stop_unanswered')).toEqual([
        {
          type: 'stop_unanswered',
          waitedMs: INTERRUPT_WAIT_MS,
          by: 'an-agent',
          agent: rig.boss,
          agentProfile: 'boss-g',
        },
      ])
      // ⚑ **The two rows about one ask name ONE identity** — one builder.
      expect(ofType(rig.worker, 'work_interrupted')).toEqual([
        { type: 'work_interrupted', by: 'an-agent', agent: rig.boss, agentProfile: 'boss-g' },
      ])
      // ⚑ …which the one naming function names (R41) — what the frontend is to draw.
      const row = ofType(rig.worker, 'stop_unanswered')[0]
      expect(
        row?.type === 'stop_unanswered' && row.agentProfile !== undefined
          ? agentName(row.agentProfile, store.agentIdentities())
          : null,
      ).toBe('Grace')
    })

    it('⚑ §2.2 control · a PERSON’s unanswered Stop names nobody — no id, and no identity, stored or sent live', async () => {
      const rig = await bobWhoNeverAnswers()
      host.claimSession(rig.worker, window)
      await host.interrupt(rig.worker, window)
      await waitFor(
        () => ofType(rig.worker, 'stop_unanswered').length === 1,
        'the stop to be said unanswered',
      )
      const unanswered = { type: 'stop_unanswered', waitedMs: INTERRUPT_WAIT_MS, by: 'a-person' }
      expect(ofType(rig.worker, 'stop_unanswered')).toEqual([unanswered])
      // ⚠️ **And the LIVE row**: the store's door bounds the persisted copy only, and the window is
      // sent what the writer built.
      expect(sentLive(rig.worker, 'stop_unanswered')).toEqual([unanswered])
    })

    it('⛔ §2.3 a replayed row keeps an identity only by the slug’s own rule, and only beside a conversation', async () => {
      // ⚑ **The store's door is a trust boundary** (`boundRelayedIdentity`): an imported or edited
      // ledger could otherwise put anything where a person will read a name. ⚑ The control is the row
      // this app writes, which survives whole.
      const ledger = await personOpens('a-ledger')
      await host.close(ledger, window)
      const one = { type: 'stop_unanswered', waitedMs: 40 } as const
      const planted: Record<string, unknown>[] = [
        { ...one, by: 'an-agent', agent: 'sess_x', agentProfile: 'boss-g' },
        { ...one, by: 'an-agent', agent: 'sess_x', agentProfile: 'Grace Hopper' },
        { ...one, by: 'an-agent', agent: 'sess_x', agentProfile: 42 },
        { ...one, by: 'an-agent', agent: 'sess_x', agentProfile: 'g'.repeat(65) },
        { ...one, by: 'a-person', agentProfile: 'boss-g' },
      ]
      for (const row of planted) {
        store.append(ledger, store.nextOrdinal(ledger), row as unknown as TranscriptEvent, tick())
      }
      expect(ofType(ledger, 'stop_unanswered')).toEqual([
        { ...one, by: 'an-agent', agent: 'sess_x', agentProfile: 'boss-g' },
        { ...one, by: 'an-agent', agent: 'sess_x' },
        { ...one, by: 'an-agent', agent: 'sess_x' },
        { ...one, by: 'an-agent', agent: 'sess_x' },
        { ...one, by: 'a-person' },
      ])
    })
  })
})
