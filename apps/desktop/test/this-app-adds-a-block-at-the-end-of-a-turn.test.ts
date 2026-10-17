import manifest from '../resources/built-in-skills/manifest.json'
import {
  BuiltInSkillCatalogueSchema,
  creationAllowedSkills,
  builtInSkillReminders,
} from '../src/main/skills/built-in-catalogue'
import { BUILT_IN_SKILLS_FAILURE } from '../src/shared/built-in-skills'
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { FakeProviderSessions, FakeRuntime, type FakeSessionHandle } from '@brobot2/runtime'
import type { AgentToolset, ResumeOptions, SessionRef, StartOptions } from '@brobot2/runtime'
import type { Provider } from '@brobot2/shared'
import { type AppDatabase, openDatabase } from '../src/main/db/connection'
import { applyMigrations } from '../src/main/db/migrate'
import { createSessionStore, type SessionStore } from '../src/main/db/session-store'
import { NO_DISCOVERY } from '../src/main/adopt/discover-sessions'
import { giverStallReceipts, RuntimeHost } from './helpers/giver-notice-host'
import type { RuntimeEventSink, RuntimeHostDeps } from './helpers/giver-notice-host'
import { readSessionInstructions } from '../src/main/runtime/instructions'
import type { TextPackRead } from '../src/main/skills/text-pack'
import type { ToolName } from '../src/main/runtime/agent-tools'
import { resolveSessionCwd } from '../src/main/runtime/scratch-cwd'
import { PERSON_LAST_WROTE_WITHIN_TURNS } from '../src/main/db/session-store'
import { THE_APP_ITSELF } from './helpers/giver-notice-host'
import {
  howLongAgo,
  OPEN_QUESTIONS_NAMED,
  THE_BLOCK_BEGINS,
  WHAT_IS_OPEN_IS_SAID_AGAIN_AFTER_MS,
  whatThisAppAddsToATurn,
} from '../src/main/runtime/what-this-app-adds-to-a-turn'
import { whatThisAppAdded, withoutWhatThisAppAdds } from './lib/what-this-app-adds'
import {
  EMPTY_TURN_BLOCK,
  turnBlockChanges,
  type TurnBlockSnapshot,
} from '../src/main/runtime/turn-block-changes'
import {
  TURN_BLOCK_WORDS,
  type AHelperInTheTurn,
  type CurrentWorkInTheTurn,
} from '../src/main/runtime/what-this-app-adds-to-a-turn'
import { TASK_IS_OPEN } from '../src/shared/tasks'
import type { RuntimeEventMessage, TranscriptEvent } from '../src/shared/runtime-ipc'

const migrationsFolder = join(dirname(fileURLToPath(import.meta.url)), '../src/main/db/migrations')

/**
 * Every turn this app hands an agent ends with a block of the app's own words: the time; on a turn
 * the app started, when the person last wrote and that they have read nothing since; and, where
 * the store already holds them, the agent's open questions to the person and who waits on it.
 *
 * A real host, a real SQLite ledger and the real rails; the only double is the provider. In `ask`
 * mode each of the double's turns waits on a card, and ends when the card is answered.
 */
describe('this app adds a block at the end of what a turn hands its agent', () => {
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

  class ToolWatchingRuntime extends FakeRuntime {
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
      started.push(handle)
      await heldProviderReturn(handle, 'start')
      return handle
    }
    override async resume(
      ref: SessionRef,
      options: ResumeOptions,
    ): ReturnType<FakeRuntime['resume']> {
      const handle = await super.resume(ref, options)
      if (options.agentTools) this.handed.push(options.agentTools)
      await heldProviderReturn(handle, 'resume')
      return handle
    }
  }

  let heldReturn: {
    opening: 'start' | 'resume'
    handle: FakeSessionHandle | null
    waiting: Promise<void>
    release: () => void
    closed: boolean
  } | null
  const heldProviderReturn = async (handle: FakeSessionHandle, opening: 'start' | 'resume') => {
    const held = heldReturn
    if (!held || held.opening !== opening) return
    held.handle = handle
    const close = handle.close.bind(handle)
    handle.close = async () => {
      held.closed = true
      await close()
    }
    await held.waiting
  }

  let userData: string
  let root: string
  let db: AppDatabase
  let store: SessionStore
  let host: RuntimeHost
  let hosts: RuntimeHost[]
  let handed: AgentToolset[]
  /** Every handle a start issued, in order: a give's helper is the newest. */
  let started: FakeSessionHandle[]
  let issued: FakeProviderSessions
  let counter: number
  let clock: number
  /** How far the clock moves at each read: one millisecond, none, or back. */
  let step: number
  let window: RecordingSink
  const tick = (): number => {
    const at = clock
    clock += step
    return at
  }

  /** The text pack each launch handed its skills, in launch order. */
  let packsGivenToSkills: unknown[] = []

  const buildHost = (withSkills = false, extra: Partial<RuntimeHostDeps> = {}): RuntimeHost => {
    const built = new RuntimeHost({
      store,
      discoverSessions: NO_DISCOVERY,
      nativeTranscriptPath: () => null,
      exportDirectory: () => join(userData, 'exports'),
      createRuntime: (provider: Provider) => new ToolWatchingRuntime(provider, handed, issued),
      prepareProviderHome: (provider: Provider, profileId?: string) => {
        const home = join(userData, 'provider-homes', profileId ?? 'default', provider)
        mkdirSync(home, { recursive: true })
        return home
      },
      ...(withSkills
        ? {
            prepareBuiltInSkills: async (input: {
              provider: Provider
              canCreateAgents: boolean
              isCoordinator: boolean
              isCurrent: () => boolean
              pack?: TextPackRead
            }) => {
              packsGivenToSkills.push(input.pack)
              const catalogue = BuiltInSkillCatalogueSchema.parse(manifest)
              const selected = creationAllowedSkills(
                catalogue,
                input.canCreateAgents,
                input.isCoordinator,
              )
              return {
                context: {
                  root: `/fictional/skills/${input.provider}`,
                  skills: selected.map((skill) => ({
                    name: input.provider === 'claude' ? `brobot:${skill.name}` : skill.name,
                    description: skill.description,
                    path: `/fictional/skills/${input.provider}/${skill.name}/SKILL.md`,
                  })),
                },
                reminder: builtInSkillReminders(input.provider, selected),
                version: catalogue.version,
                isCurrent: input.isCurrent,
              }
            },
          }
        : {}),
      providerHomePath: (provider: Provider) => join(userData, 'provider-homes', provider),
      resolveCwd: (sessionId, requested) => resolveSessionCwd(userData, sessionId, requested),
      newSessionId: () => `sess_${++counter}`,
      now: tick,
      ...extra,
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
    heldReturn = null
    userData = mkdtempSync(join(tmpdir(), 'brobot2-stop-questions-'))
    root = mkdtempSync(join(tmpdir(), 'brobot2-stop-questions-root-'))
    db = openDatabase(join(userData, 'brobot2.sqlite'))
    applyMigrations(db, migrationsFolder)
    clock = 9_000_000
    step = 1
    store = createSessionStore(db, tick)
    counter = 0
    hosts = []
    handed = []
    started = []
    issued = new FakeProviderSessions()
    packsGivenToSkills = []
    host = buildHost()
    window = new RecordingSink('webContents:1')
  })

  afterEach(async () => {
    heldReturn?.release()
    for (const built of hosts) await built.closeAll()
    db.close()
    for (const dir of [userData, root]) rmSync(dir, { recursive: true, force: true })
  })

  const personOpens = async (
    profileId: string,
    provider: Provider = 'claude',
    approvalMode: 'ask' | 'auto' = 'ask',
  ): Promise<string> => {
    const { sessionId } = await host.createSession(
      { provider, profileId, approvalMode, cwd: root },
      window,
    )
    return sessionId
  }

  const callOn = async (
    toolset: AgentToolset,
    name: ToolName,
    args: Record<string, unknown>,
  ): Promise<Record<string, unknown>> => {
    const tool = toolset.tools.find((one) => one.name === name)
    if (tool === undefined) throw new Error(`no such tool: ${name}`)
    return (await tool.call(args)).structured as Record<string, unknown>
  }

  const theToolsetJustHandedOut = (): AgentToolset => {
    const last = handed.at(-1)
    if (last === undefined) throw new Error('no toolset was handed to that launch')
    return last
  }

  const ledger = (sessionId: string): TranscriptEvent[] =>
    store.events(sessionId).map((entry) => entry.event)

  const waitFor = async (predicate: () => boolean, what: string): Promise<void> => {
    for (let attempt = 0; attempt < 400; attempt++) {
      if (predicate()) return
      await new Promise((resolve) => setTimeout(resolve, 10))
    }
    throw new Error(`timed out waiting for ${what}`)
  }

  /**
   * ⚑ **The chain `HO-088` §1 watched**: a PM in a window, a worker it gave one piece of work.
   *
   * ⛔ It is the shape every assertion here needs: a conversation with a parent, holding work it
   * can ask about. No grant is set for the give (D-014: any agent may give work to any agent).
   * ⚑ **D-016 · the give starts the worker, and its brief is the worker's first turn** — in the
   * PM's `ask` that turn parks on a permission card.
   */
  const aWorkerHoldingWork = async (
    provider: Provider = 'claude',
    approvalMode: 'ask' | 'auto' = 'ask',
  ): Promise<{
    pm: string
    worker: string
    pmTools: AgentToolset
    workerTools: AgentToolset
    piece: string
  }> => {
    const seeded = await personOpens('worker', provider)
    await host.close(seeded, window)
    const pm = await personOpens('pm', provider, approvalMode)
    const pmTools = theToolsetJustHandedOut()
    const given = await callOn(pmTools, 'give_work', {
      definition_of_done: 'The requested result and its checks are recorded.',
      profile: 'worker',
      title: 'the work this dispatch is about',
      brief: 'gather the requirements',
    })
    expect(given.outcome, JSON.stringify(given)).toBe('ok')
    const worker = given.agent as string
    const workerTools = theToolsetJustHandedOut()
    const open = store.piecesOwnedBy(worker).find((one) => TASK_IS_OPEN[one.state])
    if (open === undefined) throw new Error('the give never opened a piece')
    return { pm, worker, pmTools, workerTools, piece: open.piece }
  }

  const QUESTION_ONE = 'did the rest of the Mac freeze at about 17:05?'
  const QUESTION_TWO = 'which port does the other one use?'
  const HEADER_OF_A_PERSONS =
    'This app adds what follows. It is not part of the person’s message above, and that message comes first.'
  const HEADER_OF_THE_APPS =
    'This app adds what follows. It is not part of the message above, and that message comes first.'
  const READ_NOTHING =
    'When you next write to the person, assume they have read nothing since then, and tell them briefly what they need to know.'

  /** The words each turn handed its provider, as the double says them back. */
  const handedOver = (id: string): string[] =>
    ledger(id).flatMap((event) =>
      event.type === 'assistant_message' && event.text.startsWith('echo: ') ? [event.text] : [],
    )
  const turnsEnded = (id: string): number =>
    ledger(id).filter((event) => event.type === 'turn').length
  const theCardItWaitsOn = (id: string): string => {
    const card = ledger(id)
      .filter((event) => event.type === 'permission_request')
      .at(-1)
    if (card === undefined || card.type !== 'permission_request') throw new Error('no card')
    return card.id
  }
  const asks = async (
    tools: AgentToolset,
    piece: string,
    question: string,
    who: 'a-person' | 'the-parent' = 'a-person',
  ): Promise<string> => {
    const asked = await callOn(tools, 'ask_question', { piece, question, who_answers: who })
    expect(asked.outcome, JSON.stringify(asked)).toBe('ok')
    return asked.question as string
  }
  /** The turn that runs ends, as its card is answered. */
  const itsTurnEnds = async (id: string, surface: RecordingSink): Promise<void> => {
    const before = turnsEnded(id)
    await host.respondPermission(id, theCardItWaitsOn(id), { outcome: 'allow' }, surface)
    await waitFor(() => turnsEnded(id) === before + 1, 'its turn to end')
  }
  /** These words go to it as a turn, and the block that turn carried is given back. */
  const theBlockOfATurn = async (
    id: string,
    words: string,
    from: RuntimeEventSink | typeof THE_APP_ITSELF,
    surface: RecordingSink,
  ): Promise<string> => {
    const before = handedOver(id).length
    await host.send(id, words, from)
    await waitFor(() => handedOver(id).length === before + 1, 'its words to be handed over')
    const handed = handedOver(id).at(-1) ?? ''
    expect(withoutWhatThisAppAdds(handed)).toContain(words)
    await itsTurnEnds(id, surface)
    return whatThisAppAdded(handed)
  }
  const composedEndOfTheCurrentLife = (id: string): string => {
    type CurrentLife = { id: string }
    const reader = host as unknown as {
      slots: Map<string, { session: CurrentLife | null }>
      whatThisAppAddsAtItsEnd(session: CurrentLife, currentPiece: null): string
    }
    const session = reader.slots.get(id)?.session
    if (session === undefined || session === null) throw new Error('no current life')
    return reader.whatThisAppAddsAtItsEnd(session, null)
  }
  /** A row every fold reads, put into a ledger by SQL: the store is not told. Nothing is written after it. */
  const aRowWrittenPastTheStore = (id: string): void => {
    db.prepare(
      'INSERT INTO events(id,session_id,generation,ordinal,type,payload,created_at) VALUES(?,?,0,?,?,?,?)',
    ).run(
      `past-the-store-${id}`,
      id,
      store.nextOrdinal(id),
      'status',
      JSON.stringify({ type: 'status', state: 'idle' }),
      tick(),
    )
  }
  /** What the window's look reads, every five seconds. */
  const theWindowLooks = (): void => {
    host.questionsForAPerson()
    host.whatEachConversationIsWaitingOn()
  }
  /** A worker with a piece from its giver, its first turn ended, and a window on it. */
  const aWorkerBetweenTurns = async (provider: Provider = 'claude') => {
    const made = await aWorkerHoldingWork(provider)
    const surface = new RecordingSink('webContents:8')
    host.claimSession(made.worker, surface)
    await waitFor(
      () => ledger(made.worker).some((event) => event.type === 'permission_request'),
      'its first turn to wait on its card',
    )
    return { ...made, surface }
  }

  for (const opening of ['start', 'resume'] as const) {
    for (const revoke of [false, true]) {
      it(`a held ${opening} ${revoke ? 'returns its handle without registration after revocation' : 'registers with unchanged grants'}`, async () => {
        const seeded = await personOpens('worker')
        await waitFor(() => store.find(seeded)?.ref != null, 'seeded provider identity')
        await host.closeAll()
        host = buildHost(true)
        let release!: () => void
        const held = {
          opening,
          handle: null as FakeSessionHandle | null,
          waiting: new Promise<void>((done) => {
            release = done
          }),
          release: () => release(),
          closed: false,
        }
        heldReturn = held
        const priorLaunches =
          opening === 'resume' ? ledger(seeded).filter((one) => one.type === 'launched').length : 0
        const operation =
          opening === 'start'
            ? host.createSession(
                { provider: 'claude', profileId: 'worker', approvalMode: 'ask', cwd: root },
                window,
              )
            : host.resumeSession(seeded, window)
        const outcome = operation.then(
          () => ({ ok: true }),
          (error: unknown) => ({
            ok: false,
            message: error instanceof Error ? error.message : String(error),
          }),
        )
        try {
          await waitFor(() => held.handle !== null, 'provider return after skill preparation')
          const id = opening === 'start' ? `sess_${counter}` : seeded
          if (revoke)
            expect(store.setCapabilities('worker', { canCreateAgents: 'none' })).toBe(true)
          held.release()
          if (revoke) {
            expect(await outcome).toEqual({ ok: false, message: BUILT_IN_SKILLS_FAILURE })
            expect(held.closed).toBe(true)
            expect(ledger(id).filter((one) => one.type === 'launched')).toHaveLength(priorLaunches)
            expect(ledger(id).filter((one) => one.type === 'user_turn')).toHaveLength(0)
          } else {
            expect(await outcome).toEqual({ ok: true })
            expect(held.closed).toBe(false)
            expect(ledger(id).filter((one) => one.type === 'launched')).toHaveLength(
              priorLaunches + 1,
            )
          }
        } finally {
          held.release()
          heldReturn = null
        }
      })
    }
  }

  it('reads a text pack once for each launch, and hands its skills and its instructions that one reading', async () => {
    const readings: TextPackRead[] = []
    const toInstructions: (TextPackRead | undefined)[] = []
    const extra: Partial<RuntimeHostDeps> = {
      readTextPack: () => {
        const one: TextPackRead = {
          kind: 'refused',
          folder: `/fictional/pack-${String(readings.length)}`,
          refusal: { kind: 'core-missing' },
        }
        readings.push(one)
        return one
      },
      readInstructions: (provider, cwd, providerHome, _context, pack) => {
        toInstructions.push(pack)
        return {
          instructions: readSessionInstructions({ provider, cwd, providerHome, home: userData })
            .instructions,
          systemHint: undefined,
        }
      },
    }
    host = buildHost(true, extra)
    const worker = await personOpens('worker')
    expect(readings).toHaveLength(1)
    expect(packsGivenToSkills[0]).toBe(readings[0])
    expect(toInstructions[0]).toBe(readings[0])
    await host.closeAll()
    host = buildHost(true, extra)
    await host.resumeSession(worker, window)
    expect(readings).toHaveLength(2)
    expect(packsGivenToSkills[1]).toBe(readings[1])
    expect(toInstructions[1]).toBe(readings[1])
  })

  it.each(['claude', 'codex'] as const)(
    '%s carries installed reminders on briefs, people, notices and resumed turns',
    async (provider) => {
      host = buildHost(true)
      const { worker, surface } = await aWorkerBetweenTurns(provider)
      await itsTurnEnds(worker, surface)
      const expected = builtInSkillReminders(
        provider,
        creationAllowedSkills(BuiltInSkillCatalogueSchema.parse(manifest), true),
      )
      expect(handedOver(worker).at(-1)).toContain(expected)
      const person = await theBlockOfATurn(worker, 'Fictional person request.', surface, surface)
      expect(person).toContain(expected)
      expect(store.setCapabilities('worker', { canCreateAgents: 'none' })).toBe(true)
      const denied = builtInSkillReminders(
        provider,
        creationAllowedSkills(BuiltInSkillCatalogueSchema.parse(manifest), false),
      )
      const notice = await theBlockOfATurn(worker, 'Fictional app notice.', THE_APP_ITSELF, surface)
      expect(notice).toContain(denied)
      expect(notice).not.toContain('build-a-team — ')
      expect(notice).not.toContain('add-a-capability — ')
      await host.closeAll()
      host = buildHost(true)
      await host.resumeSession(worker, surface)
      await host.send(worker, 'Fictional resumed request.', surface)
      await waitFor(
        () => handedOver(worker).some((one) => one.includes('Fictional resumed request.')),
        'resumed words',
      )
      expect(handedOver(worker).at(-1)).toContain(denied)
      await itsTurnEnds(worker, surface)
    },
  )

  describe('the new closing facts', () => {
    it('lists current helpers after hundreds of ended pieces, then summarizes unchanged work', () => {
      const pm = 'fictional-giver'
      store.create({ id: pm, provider: 'claude', cwd: root, approvalMode: 'ask', profileId: 'pm' })
      const parent = store.rootOf(pm)!
      const owners = Array.from({ length: 15 }, (_, i) => `fictional-owner-${i}`)
      for (const owner of owners)
        store.create({
          id: owner,
          provider: 'claude',
          cwd: root,
          approvalMode: 'ask',
          profileId: 'worker',
          parentSessionId: pm,
        })
      const open: { piece: string; owner: string; label: string }[] = []
      const givenAt = tick()
      for (let i = 0; i < 535; i++) {
        const owner = owners[i % owners.length]!
        const piece = `fictional-piece-${String(i).padStart(4, '0')}`
        const number = store.numberUnder(parent.piece)
        const label = `${parent.label}.${number}`
        const title = 'Fictional work'
        const brief = 'Fictional brief'
        store.recordGive(
          {
            piece,
            parent: parent.piece,
            number,
            owner,
            givenBy: pm,
            title,
            brief,
            folder: null,
            inputs: [],
          },
          store.nextOrdinal(owner),
          { type: 'work_given', piece, parent: parent.piece, label, givenBy: pm, title, brief },
          givenAt,
        )
        if (i < 523)
          store.append(
            owner,
            store.nextOrdinal(owner),
            {
              type: 'work_replied',
              piece,
              outcome: 'done',
              summary: 'Fictional result',
              resources: [],
            },
            tick(),
          )
        else open.push({ piece, owner, label })
      }
      const reader = host as unknown as {
        factsForTheTurnBlock(
          session: { id: string; turnBlockSnapshot: TurnBlockSnapshot },
          piece: null,
        ): {
          helpers: readonly AHelperInTheTurn[] | null
          personWait: string | null
          nobodyWaiting: boolean
          replyQuestionTurn: string | null
          current: CurrentWorkInTheTurn
        }
      }
      const session = { id: pm, turnBlockSnapshot: EMPTY_TURN_BLOCK }
      const render = () => {
        const pages: number[] = []
        const ownersRead = new Map<string, number>()
        const candidatesBefore = store.turnBlockCandidates
        const piecesBefore = store.turnBlockPiecesOwnedBy
        store.turnBlockCandidates = (giver, limit, after) => {
          expect(limit).toBeLessThanOrEqual(257)
          const rows = candidatesBefore(giver, limit, after)
          if (giver === pm && limit > 0) pages.push(rows?.length ?? 0)
          return rows
        }
        store.turnBlockPiecesOwnedBy = (owner, unread) => {
          ownersRead.set(owner, (ownersRead.get(owner) ?? 0) + 1)
          return piecesBefore(owner, unread)
        }
        let facts: ReturnType<typeof reader.factsForTheTurnBlock>
        try {
          facts = reader.factsForTheTurnBlock(session, null)
        } finally {
          store.turnBlockCandidates = candidatesBefore
          store.turnBlockPiecesOwnedBy = piecesBefore
        }
        expect(pages).toEqual([257, 257, 23])
        expect(ownersRead.size).toBe(16)
        expect([...ownersRead.values()].every((count) => count === 1)).toBe(true)
        expect(facts.helpers?.filter((row) => row.open).map((row) => row.piece)).toEqual(
          open.map((row) => row.piece),
        )
        const changed = turnBlockChanges(
          { ...facts, person: true, now: tick() },
          session.turnBlockSnapshot,
        )
        session.turnBlockSnapshot = changed.next
        return whatThisAppAddsToATurn({
          now: tick(),
          aPersonStartedIt: true,
          thePersonLastWroteAt: null,
          questions: null,
          waiting: null,
          extra: changed.extra,
        })
      }
      expect(store.turnBlockCandidates(pm, 257)).toHaveLength(257)
      const first = render()
      expect(first).toContain('Work you gave:')
      expect(first).toContain('and 7 more: list_tasks')
      const second = render()
      expect(second).toContain('and 2 more: list_tasks')
      const third = render()
      for (const row of open)
        expect(
          [first, second, third].filter((block) => block.includes(`${row.label} · `)),
        ).toHaveLength(1)
      expect(render()).toContain('Work you gave: 12 pieces out, no change.')

      const stalled = open[0]!
      const person = open[1]!
      store.append(
        stalled.owner,
        store.nextOrdinal(stalled.owner),
        { type: 'turn', state: 'completed' },
        tick(),
      )
      store.append(
        person.owner,
        store.nextOrdinal(person.owner),
        { type: 'user_turn', text: 'Fictional person request' },
        tick(),
      )
      store.append(
        person.owner,
        store.nextOrdinal(person.owner),
        { type: 'turn', state: 'completed' },
        tick(),
      )
      for (let i = 0; i < 2; i++) {
        const urgent = render()
        expect(urgent).toContain(`${stalled.label} · Ali · not being worked on`)
        expect(urgent).toContain(`${person.label} · Ali · waiting on the person`)
        expect(urgent).not.toContain(TURN_BLOCK_WORDS.helpersUnavailable)
      }
      const ended = open.pop()!
      store.append(
        ended.owner,
        store.nextOrdinal(ended.owner),
        {
          type: 'work_replied',
          piece: ended.piece,
          outcome: 'done',
          summary: 'Fictional ending',
          resources: [],
        },
        tick(),
      )
      expect(render()).toContain(`${ended.label} · Ali · ended: done`)
      expect(render()).not.toContain(`${ended.label} · `)
    })

    it('still reports unavailable helpers when a real helper ledger row cannot be read', async () => {
      const { pm, worker } = await aWorkerHoldingWork()
      db.prepare(
        'INSERT INTO events(id,session_id,generation,ordinal,type,payload,created_at) VALUES(?,?,0,?,?,?,?)',
      ).run('fictional-unread-row', worker, store.nextOrdinal(worker), 'status', '{', tick())
      const facts = (
        host as unknown as {
          factsForTheTurnBlock(
            session: { id: string },
            piece: null,
          ): {
            helpers: readonly AHelperInTheTurn[] | null
            nobodyWaiting: boolean
            personWait: string | null
            replyQuestionTurn: string | null
            current: CurrentWorkInTheTurn
          }
        }
      ).factsForTheTurnBlock({ id: pm }, null)
      expect(facts.helpers).toBeNull()
      expect(facts.nobodyWaiting).toBe(false)
      const changed = turnBlockChanges({ ...facts, person: true, now: tick() }, EMPTY_TURN_BLOCK)
      const block = whatThisAppAddsToATurn({
        now: tick(),
        aPersonStartedIt: true,
        thePersonLastWroteAt: null,
        questions: null,
        waiting: null,
        extra: changed.extra,
      })
      expect(block).toContain(TURN_BLOCK_WORDS.helpersUnavailable)
      expect(block).not.toContain(TURN_BLOCK_WORDS.nobody)
      expect(block).not.toContain('no change')
    })

    it('names the person in a helper row after the helper answers their own words', async () => {
      const { pm, worker, piece, surface } = await aWorkerBetweenTurns()
      await itsTurnEnds(worker, surface)
      await waitFor(
        () => ledger(pm).some((event) => event.type === 'permission_request'),
        'the giver to wait on the stalled-work notice',
      )
      expect(giverStallReceipts(store, pm)).toContainEqual(
        expect.objectContaining({
          type: 'work_reconciliation',
          piece,
          step: 'giver',
          outcome: 'delivered',
        }),
      )
      await itsTurnEnds(pm, window)
      await theBlockOfATurn(worker, 'Fictional request from the person.', surface, surface)
      const held = store.piecesOwnedBy(worker).find((row) => row.piece === piece)
      expect(held?.state).toBe('waiting-on-the-person-who-wrote')
      const block = await theBlockOfATurn(pm, 'Fictional request to the giver.', window, window)
      const row = block.split('\n').find((line) => line.startsWith(`${held!.label} · `))
      expect(row).toContain(' · waiting on the person')
      expect(row).not.toContain(' · waiting on you')
    })

    it('shows the root work, and never replaces it with a child', async () => {
      const { pm, worker, piece } = await aWorkerHoldingWork()
      const rootWork = store.rootOf(pm)!
      const facts = host as unknown as {
        factsForTheTurnBlock(
          session: { id: string },
          selected: string | null,
        ): {
          current: { label: string }
          helpers: { label: string }[] | null
          nobodyWaiting: boolean
        }
      }
      const blockFacts = facts.factsForTheTurnBlock({ id: pm }, piece)
      expect(blockFacts.current.label).toBe(rootWork.label)
      expect(blockFacts.helpers?.map((row) => row.label)).toContain(
        store.piecesOwnedBy(worker)[0]!.label,
      )
    })

    it('distinguishes absent root lines from malformed newest title and status rows', async () => {
      const pm = await personOpens('pm', 'claude', 'auto')
      const rootWork = store.rootOf(pm)!
      const reader = host as unknown as {
        factsForTheTurnBlock(
          session: { id: string },
          selected: null,
        ): { current: CurrentWorkInTheTurn }
      }
      const composed = () =>
        whatThisAppAddsToATurn({
          now: clock,
          aPersonStartedIt: true,
          thePersonLastWroteAt: null,
          questions: null,
          waiting: null,
          extra: { currentWork: reader.factsForTheTurnBlock({ id: pm }, null).current },
        })
      db.prepare(
        "DELETE FROM events WHERE session_id = ? AND type IN ('work_retitled','work_status_set')",
      ).run(pm)
      expect(composed()).toContain(
        `Your current work: ${rootWork.label} · untitled · status: none.`,
      )
      const append = (type: string, payload: string) => {
        const id = `root-line-${counter++}`
        db.prepare(
          'INSERT INTO events(id,session_id,generation,ordinal,type,payload,created_at) VALUES(?,?,0,?,?,?,?)',
        ).run(id, pm, store.nextOrdinal(pm), type, payload, tick())
        return id
      }
      append(
        'work_retitled',
        JSON.stringify({ type: 'work_retitled', piece: rootWork.piece, title: 'Known work' }),
      )
      append(
        'work_status_set',
        JSON.stringify({
          type: 'work_status_set',
          piece: rootWork.piece,
          line: 'Known status',
          by: pm,
        }),
      )
      expect(composed()).toContain(
        `Your current work: ${rootWork.label} · Known work · status: Known status.`,
      )
      for (const [type, payload] of [
        [
          'work_retitled',
          JSON.stringify({ type: 'work_retitled', piece: rootWork.piece, title: 7 }),
        ],
        [
          'work_status_set',
          JSON.stringify({ type: 'work_status_set', piece: rootWork.piece, line: 'torn', by: 7 }),
        ],
        ['work_retitled', '{broken'],
        ['work_status_set', '{broken'],
      ]) {
        const id = append(type!, payload!)
        expect(store.turnBlockRootLines(rootWork.piece)).toBeNull()
        const words = composed()
        expect(words).toContain(TURN_BLOCK_WORDS.currentUnavailable)
        expect(words).not.toContain('status: none')
        expect(words).not.toContain('Known work')
        db.prepare('DELETE FROM events WHERE id = ?').run(id)
        expect(composed()).toContain('Known work · status: Known status.')
      }
    })

    it('acknowledges closing facts only after a matching actual host handover', async () => {
      const pm = await personOpens('pm', 'claude', 'auto')
      type ControlledSession = {
        id: string
        handle: FakeSessionHandle
        turnBlockSnapshot: TurnBlockSnapshot
        pendingTurnBlock: { next: TurnBlockSnapshot; words: string } | null
      }
      const inputFacts = {
        helpers: [
          {
            piece: 'open-helper',
            label: 'W1.1',
            name: 'Lena',
            state: 'being worked on',
            givenAt: 1,
            changedAt: null,
            open: true,
            urgent: false,
            revision: 'working',
          },
          {
            piece: 'ended-helper',
            label: 'W1.2',
            name: 'Ali',
            state: 'ended: done',
            givenAt: 1,
            changedAt: null,
            open: false,
            urgent: false,
            revision: 'done',
          },
        ],
        questions: [],
        personWait: '[]',
        nobodyWaiting: true,
        replyQuestionTurn: 'fictional-person-reply',
        current: { kind: 'none' as const },
      }
      const reader = host as unknown as {
        slots: Map<string, { session: ControlledSession | null }>
        factsForTheTurnBlock(session: ControlledSession, piece: null): typeof inputFacts
        handToProvider(
          session: ControlledSession,
          text: string,
          paths: readonly [],
          handing: null,
          drives: null,
          about: null,
          from: null,
          authorship: { attribution: 'app_authored' },
        ): Promise<void>
        publishOurs(
          session: ControlledSession,
          event: { type: 'user_turn'; text: string; attribution: 'app_authored' },
        ): void
      }
      const session = reader.slots.get(pm)!.session!
      const before: TurnBlockSnapshot = {
        ...EMPTY_TURN_BLOCK,
        awaitingEnd: new Set(['ended-helper']),
      }
      session.turnBlockSnapshot = before
      const factsBefore = reader.factsForTheTurnBlock
      const sendBefore = session.handle.send
      reader.factsForTheTurnBlock = () => inputFacts
      const send = () =>
        reader.handToProvider(session, 'ready', [], null, null, null, null, {
          attribution: 'app_authored',
        })
      const stillEligible = () => {
        expect(session.turnBlockSnapshot).toBe(before)
        const words = session.pendingTurnBlock!.words
        expect(words).toContain('W1.1 · Lena')
        expect(words).toContain('W1.2 · Ali · ended: done')
        expect(words).toContain(TURN_BLOCK_WORDS.nobody)
        expect(words).toContain(TURN_BLOCK_WORDS.replyQuestion)
      }
      try {
        session.handle.send = () => Promise.reject(new Error('fictional refused handover'))
        await expect(send()).rejects.toThrow('fictional refused handover')
        stillEligible()
        let release!: () => void
        session.handle.send = () =>
          new Promise<void>((resolve) => {
            release = resolve
          })
        const held = send()
        stillEligible()
        release()
        await held
        stillEligible()
        reader.publishOurs(session, {
          type: 'user_turn',
          text: 'different words',
          attribution: 'app_authored',
        })
        stillEligible()
        const matched = send()
        release()
        await matched
        const expected = session.pendingTurnBlock!.next
        reader.publishOurs(session, {
          type: 'user_turn',
          text: 'ready',
          attribution: 'app_authored',
        })
        expect(session.turnBlockSnapshot).toBe(expected)
        expect(session.pendingTurnBlock).toBeNull()
        expect(session.turnBlockSnapshot.awaitingEnd.has('ended-helper')).toBe(false)
        expect(session.turnBlockSnapshot.hintedTurn).toBe(inputFacts.replyQuestionTurn)
        const next = send()
        release()
        await next
        expect(session.pendingTurnBlock!.words).not.toContain('W1.2 · Ali')
        expect(session.pendingTurnBlock!.words).not.toContain(TURN_BLOCK_WORDS.nobody)
        expect(session.pendingTurnBlock!.words).not.toContain(TURN_BLOCK_WORDS.replyQuestion)
      } finally {
        reader.factsForTheTurnBlock = factsBefore
        session.handle.send = sendBefore
      }
    })

    it('keeps known own questions while incomplete helpers prevent an empty claim', async () => {
      const { pm, worker, pmTools } = await aWorkerHoldingWork()
      const question = await asks(pmTools, store.rootOf(pm)!.piece, QUESTION_ONE)
      const facts = host as unknown as {
        factsForTheTurnBlock(
          session: { id: string },
          selected: string | null,
        ): {
          helpers: unknown
          nobodyWaiting: boolean
          personWait: string | null
          questions: { id: string }[] | null
        }
      }
      const before = store.turnBlockCandidates
      store.turnBlockCandidates = () =>
        Array.from({ length: 257 }, (_, i) => ({ piece: `fiction-${i}`, owner: worker }))
      try {
        const overflow = facts.factsForTheTurnBlock({ id: pm }, null)
        expect(overflow.helpers).toBeNull()
        expect(overflow.nobodyWaiting).toBe(false)
        expect(overflow.personWait).toBeNull()
        expect(overflow.questions?.map((row) => row.id)).toContain(question)
      } finally {
        store.turnBlockCandidates = before
      }
      db.prepare(
        'INSERT INTO events(id,session_id,generation,ordinal,type,payload,created_at) VALUES(?,?,0,?,?,?,?)',
      ).run('broken-helper', worker, store.nextOrdinal(worker), 'status', '{', tick())
      expect(facts.factsForTheTurnBlock({ id: pm }, null).nobodyWaiting).toBe(false)
    })

    it('opens at most 32 helper ledgers, before reading any overflowing owner', async () => {
      const { pm, worker } = await aWorkerHoldingWork()
      const template = store.piecesOwnedBy(worker)[0]!
      const candidates = Array.from({ length: 33 }, (_, i) => ({
        piece: `fiction-piece-${i}`,
        owner: `fiction-owner-${i}`,
      }))
      const candidatesBefore = store.turnBlockCandidates
      const piecesBefore = store.turnBlockPiecesOwnedBy
      const touched: string[] = []
      store.turnBlockCandidates = (giver, limit) => (giver === pm ? candidates.slice(0, limit) : [])
      store.turnBlockPiecesOwnedBy = (owner, unread) => {
        const candidate = candidates.find((row) => row.owner === owner)
        if (candidate === undefined) return piecesBefore(owner, unread)
        touched.push(owner)
        return [{ ...template, piece: candidate.piece, owner, giver: pm }]
      }
      try {
        const facts = (
          host as unknown as {
            factsForTheTurnBlock(
              session: { id: string },
              piece: null,
            ): { helpers: unknown; nobodyWaiting: boolean }
          }
        ).factsForTheTurnBlock({ id: pm }, null)
        expect(touched).toEqual(candidates.slice(0, 32).map((row) => row.owner))
        expect(facts.helpers).toBeNull()
        expect(facts.nobodyWaiting).toBe(false)
      } finally {
        store.turnBlockCandidates = candidatesBefore
        store.turnBlockPiecesOwnedBy = piecesBefore
      }
    })

    it('keeps names private while separately retaining a known empty person queue', async () => {
      const { pm, worker } = await aWorkerHoldingWork('claude', 'auto')
      await waitFor(
        () => store.piecesOwnedBy(worker).some((row) => row.state === 'stalled'),
        'the auto fake turn to finish without a permission',
      )
      expect(ledger(worker).some((event) => event.type === 'permission_request')).toBe(false)
      const read = host as unknown as {
        factsForTheTurnBlock(
          session: { id: string },
          piece: null,
        ): { helpers: unknown; nobodyWaiting: boolean; replyQuestionTurn: string | null }
      }
      expect(read.factsForTheTurnBlock({ id: pm }, null).nobodyWaiting).toBe(true)
      const reachBefore = host.withinMessagingReach
      const nameBefore = host.whatToCallTheConversation
      const replyBefore = store.replyQuestionWithoutARequest
      store.replyQuestionWithoutARequest = (id) => {
        expect(id).toBe(pm)
        return 'fictional-ended-person-question'
      }
      const named: string[] = []
      host.withinMessagingReach = () => false
      host.whatToCallTheConversation = (id) => {
        named.push(id)
        return nameBefore.call(host, id)
      }
      try {
        const facts = (
          host as unknown as {
            factsForTheTurnBlock(
              session: { id: string },
              piece: null,
            ): { helpers: unknown; nobodyWaiting: boolean; replyQuestionTurn: string | null }
          }
        ).factsForTheTurnBlock({ id: pm }, null)
        expect(facts.helpers).toBeNull()
        expect(facts.nobodyWaiting).toBe(true)
        expect(named).toEqual([])
        expect(facts.replyQuestionTurn).toBe('fictional-ended-person-question')
      } finally {
        host.withinMessagingReach = reachBefore
        host.whatToCallTheConversation = nameBefore
        store.replyQuestionWithoutARequest = replyBefore
      }
    })

    it('reads a queued service piece from supplied bounded facts, with no fallback read', async () => {
      const { worker, surface } = await aWorkerBetweenTurns()
      await itsTurnEnds(worker, surface)
      const active = store.piecesOwnedBy(worker)[0]!
      expect(active.state).toBe('stalled')
      const queued = {
        ...active,
        piece: 'fictional-queued',
        label: 'W1.99',
        state: 'waiting' as const,
        messageId: 'fictional-held',
      }
      delete queued.briefHandedOver
      expect(queued.briefHandedOver).toBeUndefined()
      const reader = host as unknown as {
        withItsPlaceInTheQueue(
          row: typeof active,
          bounded: {
            pieces: readonly (typeof active)[]
            waits: () => { answers: Set<string>; aPerson: boolean; childrenOpen: Set<string> }
          },
        ): typeof active
        theServiceOf(id: string): object | null
        theQueueOf(id: string): unknown
        queuedAhead(piece: string, owner: string): number | null
        whenItsActivePieceStalled(id: string): number | null
      }
      const originals = [
        reader.theServiceOf,
        reader.theQueueOf,
        reader.queuedAhead,
        reader.whenItsActivePieceStalled,
      ] as const
      reader.theServiceOf = () => ({})
      const noFallback = (): never => {
        throw new Error('unbounded queue fallback')
      }
      reader.theQueueOf = noFallback
      reader.queuedAhead = noFallback
      reader.whenItsActivePieceStalled = noFallback
      try {
        const got = reader.withItsPlaceInTheQueue(queued, {
          pieces: [active, queued],
          waits: () => ({ answers: new Set(), aPerson: false, childrenOpen: new Set() }),
        })
        expect(got.state).toBe('waiting')
        expect(got.queuedBehind).toBe(1)
        expect(got.queueStalledAt).toBe(active.stalledAt)
        expect(got.piece).toBe(queued.piece)
      } finally {
        ;[
          reader.theServiceOf,
          reader.theQueueOf,
          reader.queuedAhead,
          reader.whenItsActivePieceStalled,
        ] = originals
      }
    })

    it('checks the complete main reply tail, not a preview or a child message', async () => {
      const pm = await personOpens('pm')
      await theBlockOfATurn(pm, 'answer me', window, window)
      const closed = db
        .prepare('SELECT id FROM turn WHERE session_id = ? ORDER BY ordinal DESC LIMIT 1')
        .get(pm) as { id: string }
      const append = (id: string, text: string, child = false): void => {
        db.prepare(
          'INSERT INTO events(id,session_id,generation,ordinal,type,payload,created_at,turn_id) VALUES(?,?,0,?,?,?,?,?)',
        ).run(
          id,
          pm,
          store.nextOrdinal(pm),
          'assistant_message',
          JSON.stringify({
            type: 'assistant_message',
            text,
            ...(child ? { parentToolCallId: 'child-tool' } : {}),
          }),
          tick(),
          closed.id,
        )
      }
      db.prepare(
        "DELETE FROM events WHERE turn_id = ? AND type IN ('permission_request', 'request_routed')",
      ).run(closed.id)
      append('long-main', 'x'.repeat(12_000) + '?\n\t')
      expect(store.replyQuestionWithoutARequest(pm)).toBe(closed.id)
      append('child-message', 'Child declaration.', true)
      expect(store.replyQuestionWithoutARequest(pm)).toBe(closed.id)
      append('main-declaration', 'The reply is complete.')
      expect(store.replyQuestionWithoutARequest(pm)).toBeNull()
      append('final-question', 'Still needed?')
      db.prepare("UPDATE turn SET end_reason = 'interrupted' WHERE id = ?").run(closed.id)
      expect(store.replyQuestionWithoutARequest(pm)).toBeNull()
    })

    it('does not hint if that turn opened a person request even after it ended', async () => {
      const pm = await personOpens('pm')
      await theBlockOfATurn(pm, 'answer me', window, window)
      const closed = db
        .prepare('SELECT id FROM turn WHERE session_id = ? ORDER BY ordinal DESC LIMIT 1')
        .get(pm) as { id: string }
      db.prepare(
        'INSERT INTO events(id,session_id,generation,ordinal,type,payload,created_at,turn_id) VALUES(?,?,0,?,?,?,?,?)',
      ).run(
        'question-after-request',
        pm,
        store.nextOrdinal(pm),
        'assistant_message',
        JSON.stringify({ type: 'assistant_message', text: 'Need anything else?' }),
        tick(),
        closed.id,
      )
      // The fake provider opened a real permission on this turn, then this fixture answered it.
      expect(ledger(pm).some((event) => event.type === 'permission_request')).toBe(true)
      expect(store.replyQuestionWithoutARequest(pm)).toBeNull()
    })
  })

  describe('the words', () => {
    const NOW = new Date(2026, 9, 9, 10, 42).getTime()
    const MINUTE = 60_000

    it('🔴 a person’s turn carries the mark, that their message comes first, and the time — and nothing of a list it was not given', () => {
      const block = whatThisAppAddsToATurn({
        now: NOW,
        aPersonStartedIt: true,
        thePersonLastWroteAt: NOW - MINUTE,
        questions: null,
        waiting: null,
      })
      const lines = block.split('\n')
      expect(lines).toHaveLength(3)
      expect(lines[0]).toBe(THE_BLOCK_BEGINS)
      expect(lines[1]).toBe(HEADER_OF_A_PERSONS)
      expect(lines[2]).toMatch(/^It is .*2026.*\.$/)
      // ⛔ When the person last wrote is for a turn this app started: theirs says nothing of it.
      expect(block).not.toContain('last wrote')
    })

    it('⚑ a turn this app started also says when the person last wrote, by its day when that was not today, and to assume they read nothing since', () => {
      const today = whatThisAppAddsToATurn({
        now: NOW,
        aPersonStartedIt: false,
        thePersonLastWroteAt: NOW - 87 * MINUTE,
        questions: null,
        waiting: null,
      }).split('\n')
      expect(today).toHaveLength(3)
      expect(today[1]).toBe(HEADER_OF_THE_APPS)
      expect(today[2]).toMatch(
        /^It is .*2026.*\. The person last wrote in this conversation at [^.]*09[^.]*15[^.]*\. When you next write/,
      )
      expect(today[2]?.endsWith(READ_NOTHING)).toBe(true)
      const yesterday = whatThisAppAddsToATurn({
        now: NOW,
        aPersonStartedIt: false,
        thePersonLastWroteAt: NOW - 17 * 60 * MINUTE,
        questions: null,
        waiting: null,
      })
      expect(yesterday).toMatch(
        /The person last wrote in this conversation at [^.]*8[^.]*42[^.]*\. When/,
      )
      const unknown = whatThisAppAddsToATurn({
        now: NOW,
        aPersonStartedIt: false,
        thePersonLastWroteAt: null,
        questions: null,
        waiting: null,
      })
      expect(unknown).toContain(
        `The person has not written in this conversation recently. ${READ_NOTHING}`,
      )
    })

    it('⚑ its open questions: one line each with its id, its age and its first line, the oldest five and a count of the rest', () => {
      const one = (n: number, minutesAgo: number, prompt: string) => ({
        id: `req_${String(n)}`,
        askedAt: NOW - minutesAgo * MINUTE,
        prompt,
      })
      const two = whatThisAppAddsToATurn({
        now: NOW,
        aPersonStartedIt: true,
        thePersonLastWroteAt: null,
        questions: [one(1, 190, `${QUESTION_ONE}\nmore of it`), one(2, 20, QUESTION_TWO)],
        waiting: null,
      }).split('\n')
      expect(two.slice(3)).toEqual([
        'You have 2 questions open with the person:',
        `- req_1, asked 3 hours ago: “${QUESTION_ONE}”`,
        `- req_2, asked 20 minutes ago: “${QUESTION_TWO}”`,
        'If one is answered or no longer needed, take it back with withdraw_question.',
      ])
      const seven = whatThisAppAddsToATurn({
        now: NOW,
        aPersonStartedIt: true,
        thePersonLastWroteAt: null,
        questions: [1, 2, 3, 4, 5, 6, 7].map((n) => one(n, 0, n === 3 ? 'x'.repeat(81) : '')),
        waiting: null,
      }).split('\n')
      expect(seven.slice(3)).toEqual([
        'You have 7 questions open with the person:',
        '- req_1, asked just now',
        '- req_2, asked just now',
        `- req_3, asked just now: “${'x'.repeat(80)}…”`,
        '- req_4, asked just now',
        '- req_5, asked just now',
        'and 2 more. list_questions shows them all.',
        'If one is answered or no longer needed, take it back with withdraw_question.',
      ])
      expect(OPEN_QUESTIONS_NAMED).toBe(5)
      const single = whatThisAppAddsToATurn({
        now: NOW,
        aPersonStartedIt: true,
        thePersonLastWroteAt: null,
        questions: [one(1, 1, 'q')],
        waiting: null,
      })
      expect(single).toContain(
        'You have 1 question open with the person:\n- req_1, asked 1 minute ago: “q”',
      )
    })

    it('⚑ who waits on it: each giver with the piece, then each asker with its question’s id and age', () => {
      const block = whatThisAppAddsToATurn({
        now: NOW,
        aPersonStartedIt: false,
        thePersonLastWroteAt: null,
        questions: null,
        waiting: {
          givers: [{ who: 'Ada (the owner of W1 · Bake)', work: 'W1.2 · Build the pages' }],
          askers: [{ who: 'Ali', id: 'req_9', askedAt: NOW - 2 * 24 * 60 * MINUTE }],
        },
      }).split('\n')
      expect(block.slice(3)).toEqual([
        'Waiting on you:',
        '- Ada (the owner of W1 · Bake) gave you W1.2 · Build the pages, and is waiting for it.',
        '- Ali asked you req_9 2 days ago. Answer it with answer_question.',
      ])
    })

    it('empty question lists alone cannot establish an empty person queue', () => {
      const none = whatThisAppAddsToATurn({
        now: NOW,
        aPersonStartedIt: true,
        thePersonLastWroteAt: null,
        questions: [],
        waiting: { givers: [], askers: [] },
      })
      const notGiven = whatThisAppAddsToATurn({
        now: NOW,
        aPersonStartedIt: true,
        thePersonLastWroteAt: null,
        questions: null,
        waiting: null,
      })
      expect(none).toBe(notGiven)
      expect(none.split('\n')).toHaveLength(3)
      const knownEmpty = whatThisAppAddsToATurn({
        now: NOW,
        aPersonStartedIt: true,
        thePersonLastWroteAt: null,
        questions: [],
        waiting: { givers: [], askers: [] },
        extra: { nobodyWaiting: true },
      })
      expect(knownEmpty).toContain(TURN_BLOCK_WORDS.nobody)
      expect(knownEmpty.split('\n')).toHaveLength(4)
      for (const word of ['question', 'Waiting', 'nothing', 'nobody', 'no one', 'None', 'none']) {
        expect(none, word).not.toContain(word)
      }
    })

    it('⚑ an age is said in the largest whole unit', () => {
      expect(howLongAgo(NOW - 59_000, NOW)).toBe('just now')
      expect(howLongAgo(NOW - MINUTE, NOW)).toBe('1 minute ago')
      expect(howLongAgo(NOW - 59 * MINUTE, NOW)).toBe('59 minutes ago')
      expect(howLongAgo(NOW - 60 * MINUTE, NOW)).toBe('1 hour ago')
      expect(howLongAgo(NOW - 23 * 60 * MINUTE, NOW)).toBe('23 hours ago')
      expect(howLongAgo(NOW - 24 * 60 * MINUTE, NOW)).toBe('1 day ago')
    })
  })

  describe('the time, and what the person has read', () => {
    it('🔴 a person’s message is handed over whole, and the block comes after it: the time, and no word of what they have read', async () => {
      const { worker, surface } = await aWorkerBetweenTurns()
      await itsTurnEnds(worker, surface)
      const block = await theBlockOfATurn(worker, 'what are you doing?', surface, surface)
      const lines = block.split('\n')
      expect(lines.slice(0, 2)).toEqual([THE_BLOCK_BEGINS, HEADER_OF_A_PERSONS])
      expect(lines[2]).toMatch(/^It is .+\.$/)
      expect(block).not.toContain('last wrote')
      // ⚑ The turn's row keeps the whole text it was handed, the block with it.
      const kept = ledger(worker)
        .flatMap((event) => (event.type === 'user_turn' ? [event] : []))
        .at(-1)
      expect(kept?.text).toBe('what are you doing?')
      expect(kept?.sent?.endsWith(block)).toBe(true)
      expect(withoutWhatThisAppAdds(kept?.sent ?? '').endsWith('what are you doing?')).toBe(true)
    })

    it('🔴 a turn this app started says when the person last wrote, and that they have read nothing since; before they ever wrote, that they have not written recently', async () => {
      const { worker, surface } = await aWorkerBetweenTurns()
      await itsTurnEnds(worker, surface)
      const first = await theBlockOfATurn(worker, 'the app speaking', THE_APP_ITSELF, surface)
      expect(first.split('\n')[1]).toBe(HEADER_OF_THE_APPS)
      expect(first).toContain(
        `The person has not written in this conversation recently. ${READ_NOTHING}`,
      )

      await theBlockOfATurn(worker, 'a person writes', surface, surface)
      const second = await theBlockOfATurn(worker, 'the app again', THE_APP_ITSELF, surface)
      expect(second).toMatch(
        /The person last wrote in this conversation at [^.]+\. When you next write/,
      )
      expect(second).not.toContain('has not written')
    })

    it('⚑ after a restart, when the person last wrote is read off its ledger — among its newest 200 turns, and no further', async () => {
      const { worker, surface } = await aWorkerBetweenTurns()
      await itsTurnEnds(worker, surface)
      expect(store.whenAPersonLastWrote(worker)).toBeNull()
      await theBlockOfATurn(worker, 'a person writes', surface, surface)
      const wrote = store.whenAPersonLastWrote(worker)
      expect(wrote).not.toBeNull()
      await host.closeAll()

      // A life that continues the recording knows it: its first turn, of this app's words, says so.
      host = buildHost()
      await host.resumeSession(worker, surface)
      await host.send(worker, 'a note after a restart', THE_APP_ITSELF)
      await waitFor(
        () => handedOver(worker).some((one) => one.includes('a note after a restart')),
        'its first words after the start',
      )
      expect(whatThisAppAdded(handedOver(worker).at(-1) ?? '')).toMatch(
        /The person last wrote in this conversation at [^.]+\. When you next write/,
      )
      await host.closeAll()

      // ⚑ The bound: with 199 turns this app wrote since, theirs is the 200th newest and is found…
      const theirs = store.whenAPersonLastWrote(worker)
      expect(theirs).not.toBeNull()
      const anAppsTurn = (n: number): void => {
        store.append(
          worker,
          store.nextOrdinal(worker),
          {
            type: 'user_turn',
            text: `this app wrote ${String(n)}`,
            attribution: 'app_authored',
            appNotice: 'a-scheduled-job-that-will-not-run',
          },
          tick(),
        )
      }
      for (let n = 0; n < PERSON_LAST_WROTE_WITHIN_TURNS - 1; n++) anAppsTurn(n)
      expect(store.whenAPersonLastWrote(worker)).toBe(theirs)
      // ⛔ …and with one more it is the 201st: not read, which is said as *not recently*.
      anAppsTurn(PERSON_LAST_WROTE_WITHIN_TURNS)
      expect(store.whenAPersonLastWrote(worker)).toBeNull()
    })
  })

  describe('current open questions, with existing waiting notices', () => {
    it('reads current questions before any window look, including recent turns', async () => {
      const { worker, surface, workerTools, piece } = await aWorkerBetweenTurns()
      const one = await asks(workerTools, piece, QUESTION_ONE)
      const two = await asks(workerTools, piece, QUESTION_TWO)
      await itsTurnEnds(worker, surface)

      // Turn-end reconciliation reads current questions before any window look too.
      expect(store.routedRequestsAtHand(worker)).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ requestId: one }),
          expect.objectContaining({ requestId: two }),
        ]),
      )
      const reader = host as unknown as {
        factsForTheTurnBlock(session: { id: string }, piece: string | null): unknown
      }
      const factsBefore = reader.factsForTheTurnBlock
      const candidatesBefore = store.turnBlockCandidates
      const piecesBefore = store.turnBlockPiecesOwnedBy
      const routedBefore = store.routedRequestsOf
      const raisedBefore = store.questionsRaisedIn
      let reading = false
      let observations = 0
      let candidateCount = 0
      const owners = new Set<string>()
      const watch =
        <A extends unknown[], R>(read: (owner: string, ...args: A) => R) =>
        (owner: string, ...args: A): R => {
          if (reading) owners.add(owner)
          return read(owner, ...args)
        }
      store.turnBlockPiecesOwnedBy = watch(piecesBefore)
      store.routedRequestsOf = watch(routedBefore)
      store.questionsRaisedIn = watch(raisedBefore)
      store.turnBlockCandidates = (giver, limit) => {
        const rows = candidatesBefore(giver, limit)
        if (reading) {
          expect(limit).toBeLessThanOrEqual(257)
          candidateCount += rows?.length ?? 0
        }
        return rows
      }
      reader.factsForTheTurnBlock = (...args) => {
        const changes = () => (db.prepare('SELECT total_changes() AS n').get() as { n: number }).n
        const before = changes()
        reading = true
        try {
          return factsBefore.call(reader, ...args)
        } finally {
          reading = false
          observations += 1
          expect(changes()).toBe(before)
          expect(owners.size).toBeLessThanOrEqual(33)
          expect(candidateCount).toBeLessThanOrEqual(256)
        }
      }
      let before: string
      try {
        before = await theBlockOfATurn(worker, 'what are you doing?', surface, surface)
        expect(observations).toBe(1)
        expect(owners).toContain(worker)
      } finally {
        reader.factsForTheTurnBlock = factsBefore
        store.turnBlockCandidates = candidatesBefore
        store.turnBlockPiecesOwnedBy = piecesBefore
        store.routedRequestsOf = routedBefore
        store.questionsRaisedIn = raisedBefore
      }
      // The reconciler's read also makes the two-line giver notice available.
      expect(before.split('\n')).toHaveLength(10)
      expect(before).toContain('Waiting on you:')
      expect(before).toContain('You have 2 questions open with the person:')
      expect(before).toContain(`- ${one}, asked just now: “${QUESTION_ONE}”`)
      expect(before).toContain(`- ${two}, asked just now: “${QUESTION_TWO}”`)
      expect(before).not.toContain('Nothing of yours is waiting on the person.')

      theWindowLooks()
      const after = await theBlockOfATurn(worker, 'and now?', surface, surface)
      const lines = after.split('\n')
      expect(lines.slice(3, 7)).toEqual([
        'You have 2 questions open with the person:',
        `- ${one}, asked just now: “${QUESTION_ONE}”`,
        `- ${two}, asked just now: “${QUESTION_TWO}”`,
        'If one is answered or no longer needed, take it back with withdraw_question.',
      ])
      expect(lines[7]).toBe('Waiting on you:')
      expect(lines[8]).toMatch(
        /^- .+ gave you W\S+ · the work this dispatch is about, and is waiting for it\.$/,
      )
      expect(lines[9]).toMatch(
        /^Your current work: W\S+ · the work this dispatch is about · status: none\./,
      )
      expect(lines).toHaveLength(10)
    })

    it('a new question is read immediately, and direct ledger writes invalidate the cached views', async () => {
      const { worker, surface, workerTools, piece } = await aWorkerBetweenTurns()
      const one = await asks(workerTools, piece, QUESTION_ONE)
      await itsTurnEnds(worker, surface)
      theWindowLooks()
      const kept = await theBlockOfATurn(worker, 'first', surface, surface)
      expect(kept).toContain(`- ${one}, asked just now`)

      // It asks again in a turn: its ledger grows, and what was kept is no longer current.
      const before = handedOver(worker).length
      await host.send(worker, 'second', surface)
      await waitFor(() => handedOver(worker).length === before + 1, 'its words to be handed over')
      const two = await asks(workerTools, piece, QUESTION_TWO)
      await itsTurnEnds(worker, surface)
      const stale = await theBlockOfATurn(worker, 'third', surface, surface)
      expect(stale).toContain('You have 2 questions open with the person:')
      expect(stale).toContain(one)
      expect(stale).toContain(two)

      theWindowLooks()
      const current = await theBlockOfATurn(worker, 'fourth', surface, surface)
      expect(current).toContain('You have 2 questions open with the person:')
      expect(current).toContain(`- ${two}, asked just now`)

      // ⛔ Current by construction: a row its folds read, written past this store, is noticed as
      // the lists are asked for, though nothing told the store to forget them.
      theWindowLooks()
      expect(store.routedRequestsAtHand(worker)).not.toBeNull()
      expect(store.questionsRaisedAtHand(worker)).not.toBeNull()
      expect(store.piecesAtHand(worker)).not.toBeNull()
      aRowWrittenPastTheStore(worker)
      expect(store.routedRequestsAtHand(worker)).toBeNull()
      expect(store.questionsRaisedAtHand(worker)).toBeNull()
      expect(store.piecesAtHand(worker)).toBeNull()
      const afterExternalWrite = composedEndOfTheCurrentLife(worker)
      const shownQuestions = [one, two].filter((id) => afterExternalWrite.includes(id))
      expect([0, 2]).toContain(shownQuestions.length)
      if (shownQuestions.length === 2)
        expect(afterExternalWrite).toContain('You have 2 questions open with the person:')
      else expect(afterExternalWrite).not.toContain('open with the person')
      expect(afterExternalWrite).not.toContain(TURN_BLOCK_WORDS.nobody)
    })

    it('⛔ the same for a conversation others route to: an asker that asks again drops what was held, and its question to a person is never the parent’s to answer', async () => {
      const { pm, worker, workerTools, piece } = await aWorkerBetweenTurns()
      // The giver was opened in the test's own window, and no turn of its own runs.
      const pmSurface = window
      /** A question to its giver reaches the giver as a turn of its own, which then ends. */
      const asksItsGiver = async (question: string): Promise<{ id: string; block: string }> => {
        const before = handedOver(pm).length
        const id = await asks(workerTools, piece, question, 'the-parent')
        await waitFor(() => handedOver(pm).length === before + 1, 'the question to reach its giver')
        const block = whatThisAppAdded(handedOver(pm).at(-1) ?? '')
        await itsTurnEnds(pm, pmSurface)
        return { id, block }
      }
      const { id: forItsGiver } = await asksItsGiver('which branch?')
      const forThePerson = await asks(workerTools, piece, QUESTION_ONE)
      theWindowLooks()
      const held = await theBlockOfATurn(pm, 'how is it going?', pmSurface, pmSurface)
      expect(held).toContain('Waiting on you:')
      expect(held).toMatch(
        new RegExp(
          `- \\S.* asked you ${forItsGiver} just now\\. Answer it with answer_question\\.`,
        ),
      )
      // ⛔ The one its asker addressed to a person is the person's.
      expect(held).not.toContain(forThePerson)

      // The asker asks its giver again: its ledger grows.
      const { id: again, block: asItArrived } = await asksItsGiver('and which commit?')
      // Reconciliation has read the asker's ledger, so the arrival names both current questions.
      expect(asItArrived).toContain(forItsGiver)
      expect(asItArrived).toContain(again)
      expect(asItArrived).not.toContain(forThePerson)
      // Transaction-local folds are never published as at-hand facts.
      const cold = db.transaction(() => composedEndOfTheCurrentLife(pm))()
      expect(cold).not.toContain('Waiting on you')
      expect(cold).not.toContain(forItsGiver)
      const stale = await theBlockOfATurn(pm, 'and now?', pmSurface, pmSurface)
      expect(stale).toContain(forItsGiver)
      expect(stale).toContain(again)
      expect(stale).not.toContain(forThePerson)
      theWindowLooks()
      const current = await theBlockOfATurn(pm, 'and after a look?', pmSurface, pmSurface)
      expect(current).toContain(forItsGiver)
      expect(current).toContain(again)

      // ⛔ …and by construction for the asker's ledger too: a row written past this store leaves
      // nothing at hand for the one it routes to.
      theWindowLooks()
      expect(store.questionsRoutedToAtHand(pm)).not.toBeNull()
      aRowWrittenPastTheStore(worker)
      expect(store.questionsRoutedToAtHand(pm)).toBeNull()
    })

    it('keeps a known waiting notice beside the helper summary, and never claims empty in a cold block', async () => {
      const { pm, workerTools, piece } = await aWorkerBetweenTurns()
      const forThePerson = await asks(workerTools, piece, QUESTION_ONE)
      const before = handedOver(pm).length
      const forItsGiver = await asks(workerTools, piece, 'which branch?', 'the-parent')
      await waitFor(() => handedOver(pm).length === before + 1, 'the parent question to arrive')
      await itsTurnEnds(pm, window)
      // A transaction cannot expose a kept fold, even when reconciliation warmed one.
      const cold = db.transaction(() => {
        expect(store.piecesAtHand(pm)).toBeNull()
        return composedEndOfTheCurrentLife(pm)
      })()
      expect(cold).not.toContain(TURN_BLOCK_WORDS.nobody)
      expect(cold).not.toContain(forThePerson)
      theWindowLooks()
      // The app-authored arrival already said this wait. A person's turn repeats current facts.
      const known = await theBlockOfATurn(pm, 'after the look', window, window)
      expect(known).toContain('Work you gave:')
      expect(known).toContain('Work you gave: 1 piece out, no change.')
      expect(known).toContain('Waiting on you:')
      expect(known).toContain(forItsGiver)
      expect(known).not.toContain(forThePerson)
      // The only question this giver must answer belongs to its helper, not to the person.
      expect(known).toContain(TURN_BLOCK_WORDS.nobody)
    })

    it('⛔ a giver the work table places nowhere above the piece is named by its name alone, and no ledger is folded to name it', async () => {
      const { worker, surface, pmTools } = await aWorkerBetweenTurns()
      await itsTurnEnds(worker, surface)
      // A conversation that owns no root — a give started it — and a give in the worker's ledger
      // that names it as its giver, for a piece the work table has no row of.
      await host.close(await personOpens('stranger'), window)
      const started = await callOn(pmTools, 'give_work', {
        definition_of_done: 'The requested result and its checks are recorded.',
        profile: 'stranger',
        title: 'another piece',
        brief: 'something else',
      })
      expect(started.outcome, JSON.stringify(started)).toBe('ok')
      const stranger = started.agent as string
      await host.closeAll()
      const given = ledger(worker).find((event) => event.type === 'work_given')
      if (given === undefined || given.type !== 'work_given') throw new Error('no give is recorded')
      store.append(
        worker,
        store.nextOrdinal(worker),
        { ...given, piece: 'piece_the_table_lacks', label: 'W9.9', givenBy: stranger },
        tick(),
      )

      // Hold the independent startup scan while isolating the turn's naming read.
      host = buildHost(false, { afterFirstWindowLoad: new Promise<void>(() => {}) })
      await host.resumeSession(worker, surface)
      theWindowLooks()
      expect(store.piecesAtHand(stranger)).toBeNull()
      const block = await theBlockOfATurn(worker, 'who waits on me?', surface, surface)
      expect(block).toContain(
        `- ${host.whatToCallTheConversation(stranger)} gave you W9.9 · the work this dispatch is about, and is waiting for it.`,
      )
      // ⚑ Its real giver, which the table does place above its piece, is still named by its work.
      expect(block).toMatch(
        /- .+ \(the owner of W\S+\) gave you W\S+ · the work this dispatch is about/,
      )
      // ⛔ Nothing folded the stranger's ledger for a name.
      expect(store.piecesAtHand(stranger)).toBeNull()
    })

    it('⚑ a turn this app starts says a list only once it changed, or after two hours; a person’s turn says it every time', async () => {
      const { worker, surface, workerTools, piece } = await aWorkerBetweenTurns()
      const one = await asks(workerTools, piece, QUESTION_ONE)
      await itsTurnEnds(worker, surface)
      const anAppTurn = async (words: string): Promise<string> => {
        theWindowLooks()
        return theBlockOfATurn(worker, words, THE_APP_ITSELF, surface)
      }
      expect(await anAppTurn('one')).toContain(one)
      // Unchanged: this app's next turn does not say it again…
      const second = await anAppTurn('two')
      expect(second).not.toContain('open with the person')
      expect(second).not.toContain('Waiting on you')
      // …a person's turn does…
      theWindowLooks()
      expect(await theBlockOfATurn(worker, 'three', surface, surface)).toContain(one)
      expect(await anAppTurn('four')).not.toContain(one)
      // …and so does this app's, more than two hours on.
      clock += WHAT_IS_OPEN_IS_SAID_AGAIN_AFTER_MS + 1
      const later = await anAppTurn('five')
      expect(later).toContain(one)
      expect(later).toContain('Waiting on you')
      // ⚑ Changed: said at once.
      const before = handedOver(worker).length
      await host.send(worker, 'six', THE_APP_ITSELF)
      await waitFor(() => handedOver(worker).length === before + 1, 'its words to be handed over')
      const two = await asks(workerTools, piece, QUESTION_TWO)
      await itsTurnEnds(worker, surface)
      const changed = await anAppTurn('seven')
      expect(changed).toContain(two)
    })
  })
})
