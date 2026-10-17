import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { FakeProviderSessions, FakeRuntime, ResumeError, SessionMachine } from '@brobot2/runtime'
import type {
  AgentToolAnswer,
  AgentToolset,
  FakeSessionHandle,
  ResumeOptions,
  RuntimeEvent,
  SessionRef,
  StartOptions,
} from '@brobot2/runtime'
import { AsyncQueue } from '../../../packages/runtime/src/internal/async-queue'
import type { Provider } from '@brobot2/shared'
import { type AppDatabase, openDatabase } from '../src/main/db/connection'
import { applyMigrations } from '../src/main/db/migrate'
import { createSessionStore, type SessionStore } from '../src/main/db/session-store'
import { NO_DISCOVERY } from '../src/main/adopt/discover-sessions'
import { RuntimeHost, type RuntimeEventSink } from './helpers/giver-notice-host'
import { agentToolsFor, type ToolName } from '../src/main/runtime/agent-tools'
import { resourcesRoot } from '../src/main/resources/resources'
import { resolveSessionCwd } from '../src/main/runtime/scratch-cwd'
import type { RuntimeEventMessage, TranscriptEvent } from '../src/shared/runtime-ipc'
import {
  RULES_PUT_BEFORE_A_PERSON,
  RULES_WRITTEN,
} from '../src/main/runtime/agent-tool-answer-words'

/**
 * # A successful answer says in words what its payload held
 *
 * A model reads an agent tool's prose answer and nothing else, so every fact it must act on is in
 * the words, and none of what the call sent comes back to it. Each control below would fail if the
 * fact went back to living in the structured payload alone, or if an echo returned.
 *
 * Real host, real SQLite, real migrations, real tools. The only double is the provider, as in
 * `state-a-supervisor-can-trust.test.ts`, whose held-turn instrument this copies.
 */

const here = dirname(fileURLToPath(import.meta.url))
const migrationsFolder = join(here, '../src/main/db/migrations')
const WEEK = 7 * 24 * 60 * 60 * 1000

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

/** A resume to fail once, as a provider that could not bring a conversation back this time. */
let nextResumeThrows: Error | null = null

class ProviderDouble extends FakeRuntime {
  constructor(
    provider: Provider,
    private readonly handles: FakeSessionHandle[],
    sessions: FakeProviderSessions,
    private readonly decorate: (handle: FakeSessionHandle) => FakeSessionHandle,
  ) {
    super(provider, { sessions })
  }
  override async start(options: StartOptions): Promise<FakeSessionHandle> {
    const handle = this.decorate(await super.start(options))
    this.handles.push(handle)
    return handle
  }
  override async resume(ref: SessionRef, options: ResumeOptions): Promise<FakeSessionHandle> {
    const failure = nextResumeThrows
    if (failure !== null) {
      nextResumeThrows = null
      throw failure
    }
    const handle = await super.resume(ref, options)
    this.handles.push(handle)
    return handle
  }
}

/**
 * A turn that stays `working` until it is asked to stop, then ends in the provider's own word:
 * `interrupted` (the stop honoured), `completed` (finished anyway, as Codex can), or `never` — no
 * terminal yet, as a Codex `interrupt()` the app-server has not answered leaves it (709).
 */
function holdingAWorkingTurn(
  handle: FakeSessionHandle,
  itsWord: 'interrupted' | 'completed' | 'never' = 'interrupted',
): FakeSessionHandle {
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
      if (property === 'interrupt') {
        return async (): Promise<void> => {
          machine.requestInterrupt()
          if (itsWord !== 'never') machine.completeTurn(itsWord)
        }
      }
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

describe('a successful answer says in words what its payload held', () => {
  let userData: string
  let root: string
  let db: AppDatabase
  let store: SessionStore
  let host: RuntimeHost
  let handles: FakeSessionHandle[]
  let counter: number
  let clock: number
  let window: RecordingSink
  let claimed: Set<string>
  let decorateNextHandle: ((handle: FakeSessionHandle) => FakeSessionHandle) | null
  const tick = (): number => clock++

  beforeEach(() => {
    userData = mkdtempSync(join(tmpdir(), 'brobot2-answer-words-'))
    root = mkdtempSync(join(tmpdir(), 'brobot2-answer-words-root-'))
    db = openDatabase(join(userData, 'brobot2.sqlite'))
    applyMigrations(db, migrationsFolder)
    clock = 9_000_000
    store = createSessionStore(db, tick)
    counter = 0
    handles = []
    decorateNextHandle = null
    nextResumeThrows = null
    const issued = new FakeProviderSessions()
    host = new RuntimeHost({
      store,
      discoverSessions: NO_DISCOVERY,
      nativeTranscriptPath: () => null,
      exportDirectory: () => join(userData, 'exports'),
      resourcesRoot: () => resourcesRoot(userData),
      createRuntime: (provider: Provider) =>
        new ProviderDouble(provider, handles, issued, (handle) => {
          const decorate = decorateNextHandle
          decorateNextHandle = null
          return decorate?.(handle) ?? handle
        }),
      prepareProviderHome: (provider: Provider, profileId?: string) => {
        const home = join(userData, 'provider-homes', profileId ?? 'default', provider)
        mkdirSync(home, { recursive: true })
        return home
      },
      providerHomePath: (provider: Provider) => join(userData, 'provider-homes', provider),
      resolveCwd: (sessionId, requested) => resolveSessionCwd(userData, sessionId, requested),
      newSessionId: () => `sess_${String(++counter)}`,
      now: tick,
      interruptWaitMs: 40,
      readProviderConfig: (provider, home) => ({
        home,
        homeEnv: 'CLAUDE_CONFIG_DIR',
        model: 'm',
        authNote: null,
        files: [],
      }),
    })
    window = new RecordingSink('webContents:1')
    claimed = new Set<string>()
  })

  afterEach(async () => {
    await host.closeAll()
    db.close()
    for (const dir of [userData, root]) rmSync(dir, { recursive: true, force: true })
  })

  const ledger = (sessionId: string): TranscriptEvent[] =>
    store.events(sessionId).map((entry) => entry.event)
  const turnsOf = (sessionId: string): number =>
    ledger(sessionId).filter((event) => event.type === 'turn').length

  const call = async (
    tools: AgentToolset,
    name: ToolName,
    args: Record<string, unknown>,
  ): Promise<AgentToolAnswer> => {
    const tool = tools.tools.find((one) => one.name === name)
    if (tool === undefined) throw new Error(`no such tool: ${name}`)
    return tool.call(args)
  }
  const ok = async (
    tools: AgentToolset,
    name: ToolName,
    args: Record<string, unknown>,
  ): Promise<AgentToolAnswer> => {
    const answered = await call(tools, name, args)
    expect(answered.structured?.['outcome'], answered.text).toBe('ok')
    return answered
  }

  /** A person opens a conversation, in `ask` mode so a turn its give starts parks on a card. */
  const aPm = async (): Promise<{ pm: string; pmTools: AgentToolset }> => {
    const { sessionId } = await host.createSession(
      { provider: 'claude', profileId: 'pm', approvalMode: 'ask', cwd: root },
      window,
    )
    claimed.add(sessionId)
    return { pm: sessionId, pmTools: agentToolsFor(host, sessionId) }
  }

  /** The PM gives a new worker a piece; the give starts the worker with the brief as its turn. */
  const aPmAndItsWorker = async (
    options: {
      readonly decorate?: (handle: FakeSessionHandle) => FakeSessionHandle
      readonly inputs?: readonly string[]
    } = {},
  ): Promise<{
    pm: string
    pmTools: AgentToolset
    worker: string
    workerTools: AgentToolset
    label: string
    given: AgentToolAnswer
  }> => {
    const { pm, pmTools } = await aPm()
    decorateNextHandle = options.decorate ?? null
    let given: AgentToolAnswer
    try {
      given = await ok(pmTools, 'give_work', {
        definition_of_done: 'The requested result and its checks are recorded.',
        profile: 'worker',
        new: true,
        title: 'Survey the kept files',
        brief: 'Survey the kept files and report.',
        ...(options.inputs === undefined ? {} : { inputs: options.inputs }),
      })
    } finally {
      decorateNextHandle = null
    }
    const worker = given.structured?.['agent'] as string
    return {
      pm,
      pmTools,
      worker,
      workerTools: agentToolsFor(host, worker),
      label: given.structured?.['label'] as string,
      given,
    }
  }

  const aPersonTakesOver = (sessionId: string): void => {
    if (claimed.has(sessionId)) return
    host.claimSession(sessionId, window)
    claimed.add(sessionId)
  }

  /** The card the worker's turn parked on, answered by a person. */
  const theCardIsAnswered = async (
    sessionId: string,
    outcome: 'allow' | 'cancel',
  ): Promise<void> => {
    const before = turnsOf(sessionId)
    await waitFor(
      () =>
        ledger(sessionId).filter((event) => event.type === 'permission_request').length >
        ledger(sessionId).filter((event) => event.type === 'user_decision').length,
      'the turn to park on its card',
    )
    const card = [...ledger(sessionId)]
      .reverse()
      .find((event) => event.type === 'permission_request')
    if (card?.type !== 'permission_request') throw new Error('no card')
    aPersonTakesOver(sessionId)
    await host.respondPermission(sessionId, card.id, { outcome }, window)
    await waitFor(() => turnsOf(sessionId) > before, 'the turn to reach its terminal')
  }

  const aFile = (name: string, words: string): string => {
    const path = join(root, name)
    writeFileSync(path, words)
    return path
  }

  // ─────────────────────────────────────────────────────────────────────────────────────────────
  // get_agent_status · how the last turn ended, and the last ask to stop
  // ─────────────────────────────────────────────────────────────────────────────────────────────

  describe('get_agent_status says the last ask to stop, its time and who asked, wherever it landed', () => {
    const lastTurnOf = async (pmTools: AgentToolset, worker: string): Promise<string> =>
      (await ok(pmTools, 'get_agent_status', { agent: worker })).text

    it('an ask honoured on the last turn: the turn was stopped, and the ask has its time and asker', async () => {
      const { pm, pmTools, worker } = await aPmAndItsWorker({
        decorate: (handle) => holdingAWorkingTurn(handle, 'interrupted'),
      })
      await waitFor(
        () => host.agentCard(worker, { ownerId: `agent:${pm}` }, pm)?.state.is === 'active',
        'the held turn to be working',
      )
      await ok(pmTools, 'interrupt_agent', { agent: worker, reason: 'a change of plan' })
      await waitFor(() => store.lastEndedTurn(worker) !== null, 'the stopped turn to end')
      expect(store.lastAskToStop(worker)).toMatchObject({ turn: 'the-turn-that-ended-last' })
      expect(store.lastEndedTurn(worker)).toMatchObject({ how: 'it-was-stopped', asker: pm })

      const said = await lastTurnOf(pmTools, worker)
      expect(said).toMatch(/; it was stopped; nothing has started since\./)
      expect(said).toMatch(/It was last asked to stop at [^.,]+, by you\./)
    })

    it('an ask the provider finished anyway: it finished, and is never said to be finished BY the asker', async () => {
      const { pm, pmTools, worker } = await aPmAndItsWorker({
        decorate: (handle) => holdingAWorkingTurn(handle, 'completed'),
      })
      await waitFor(
        () => host.agentCard(worker, { ownerId: `agent:${pm}` }, pm)?.state.is === 'active',
        'the held turn to be working',
      )
      await ok(pmTools, 'interrupt_agent', { agent: worker, reason: 'a change of plan' })
      await waitFor(() => store.lastEndedTurn(worker) !== null, 'the asked turn to end')
      expect(store.lastEndedTurn(worker)).toMatchObject({ how: 'it-finished', asker: pm })

      const said = await lastTurnOf(pmTools, worker)
      expect(said).toMatch(/; it finished; nothing has started since\./)
      expect(said).not.toMatch(/it finished, by/)
      expect(said).toMatch(/It was last asked to stop at [^.,]+, by you\./)
    })

    it('an ask with no turn running: said with its relation, and the finished turn names nobody', async () => {
      const { pmTools, worker } = await aPmAndItsWorker()
      await theCardIsAnswered(worker, 'allow')
      await host.interrupt(worker, window)
      expect(store.lastAskToStop(worker)).toMatchObject({
        by: 'a-person',
        turn: 'no-turn-was-running',
      })

      const said = await lastTurnOf(pmTools, worker)
      expect(said).toMatch(/; it finished; nothing has started since\./)
      expect(said).toMatch(
        /It was last asked to stop at [^.,]+, by a person, when no turn was running\./,
      )
    })

    it('an ask on a turn that ended before the last: said with its relation', async () => {
      const { pmTools, worker } = await aPmAndItsWorker()
      await theCardIsAnswered(worker, 'cancel')
      await host.send(worker, 'once more', window)
      await theCardIsAnswered(worker, 'allow')
      expect(store.lastAskToStop(worker)).toMatchObject({
        by: 'a-person',
        turn: 'a-turn-that-ended-earlier',
      })
      expect(store.lastEndedTurn(worker)).toMatchObject({ how: 'it-finished', who: null })

      const said = await lastTurnOf(pmTools, worker)
      expect(said).toMatch(/; it finished; nothing has started since\./)
      expect(said).toMatch(
        /It was last asked to stop at [^.,]+, by a person, in a turn that ended before its last\./,
      )
    })

    it('an ask its provider has not answered: the turn running now, said with its relation', async () => {
      const { pm, pmTools, worker } = await aPmAndItsWorker({
        decorate: (handle) => holdingAWorkingTurn(handle, 'never'),
      })
      await waitFor(
        () => host.agentCard(worker, { ownerId: `agent:${pm}` }, pm)?.state.is === 'active',
        'the held turn to be working',
      )
      await ok(pmTools, 'interrupt_agent', { agent: worker, reason: 'a change of plan' })
      await waitFor(() => store.lastAskToStop(worker) !== null, 'the ask to be recorded')
      expect(store.lastAskToStop(worker)).toMatchObject({ turn: 'a-turn-that-is-running-now' })

      const said = await lastTurnOf(pmTools, worker)
      expect(said).toMatch(/It was last asked to stop at [^.,]+, by you, in the turn running now\./)
    })
  })

  // ─────────────────────────────────────────────────────────────────────────────────────────────
  // list_questions · the question's own words
  // ─────────────────────────────────────────────────────────────────────────────────────────────

  it('list_questions carries each open question whole: its parts, options and asked_by', async () => {
    const { pmTools, workerTools } = await aPmAndItsWorker()
    const asked = await ok(workerTools, 'ask_question', {
      who_answers: 'the-parent',
      question: 'Which suite should run?',
      options: ['the unit suite', 'every suite'],
    })
    const id = asked.structured?.['question'] as string

    const listed = (await ok(pmTools, 'list_questions', {})).text
    expect(listed).toContain('Which suite should run?')
    expect(listed).toContain('the unit suite')
    expect(listed).toContain('every suite')
    expect(listed).toMatch(new RegExp(`quoting ${id} with asked_by \\S+`))
    expect(listed).toMatch(/part \S+/)
  })

  // ─────────────────────────────────────────────────────────────────────────────────────────────
  // list_tasks · the holder, a stall's holder now, and files by what each is to the piece
  // ─────────────────────────────────────────────────────────────────────────────────────────────

  it('list_tasks names who holds a piece, what its holder does now on a stall, and each file by its role', async () => {
    const input = aFile('the-brief-notes.md', '# Notes\n\nWhat to survey.\n')
    const { pmTools, worker, workerTools, label } = await aPmAndItsWorker({ inputs: [input] })
    const holder = host.whatToCallTheConversation(worker)

    // The worker's turn ends with the piece still open: a stall.
    await theCardIsAnswered(worker, 'allow')
    const board = (await ok(pmTools, 'list_tasks', {})).text
    expect(board).toContain(`· held by ${holder}`)
    expect(board).toMatch(/· stalled \(.*\).* · the conversation holding it is now \S/)

    const report = aFile('the-survey.md', '# Survey\n\nAll files read.\n')
    const replied = await ok(workerTools, 'reply_to_parent', {
      piece: label,
      outcome: 'done',
      summary: 'Surveyed.',
      resource_paths: [report],
    })
    const kept = replied.structured?.['resources'] as string[]
    expect(kept).toHaveLength(1)
    expect(replied.text).toContain(`Kept: ${kept[0]!}.`)
    expect(replied.text).not.toContain('(the-survey.md)')

    const reading = await call(pmTools, 'list_tasks', { piece: label })
    expect(reading.structured).toMatchObject({ label, state: 'answered', outcome: 'done' })
    const record = reading.text
    expect(record).toMatch(/Its inputs: res_\S+ \(the-brief-notes\.md\)\./)
    expect(record).toContain(`Handed back with its answer: ${kept[0]!} (the-survey.md).`)
  })

  // ─────────────────────────────────────────────────────────────────────────────────────────────
  // list_profiles · which usage windows each provider has reported
  // ─────────────────────────────────────────────────────────────────────────────────────────────

  it('list_profiles says which windows each provider has reported, first and last', async () => {
    const { pmTools } = await aPm()
    const handle = handles.at(-1)!
    handle.simulateProviderUsage([{ window: 'seven_day', usedPercent: 40, resetsAt: clock + WEEK }])
    await waitFor(() => host.usageWindowsSeen().claude.length === 1, 'the window to be noted')

    const listed = (await ok(pmTools, 'list_profiles', {})).text
    expect(listed).toMatch(/Windows Claude has reported: weekly \(first [^,]+, last [^)]+\)\./)
  })

  // ─────────────────────────────────────────────────────────────────────────────────────────────
  // Writes: no echo of what the call sent; generated labels, ids and delivery kept
  // ─────────────────────────────────────────────────────────────────────────────────────────────

  describe('a write says what happened, and none of what it was sent', () => {
    it('give_work keeps its generated label, the profile and how the brief went', async () => {
      const { given, label } = await aPmAndItsWorker()
      expect(given.text).toMatch(
        new RegExp(
          `^${label.replace(/\./g, '\\.')} given to .+ \\(worker\\); it (went to .+ straight away|is held)`,
        ),
      )
      expect(given.text.split('\n')[0]).not.toContain('Survey the kept files')
      expect(given.text).toContain(
        `[${label} · Survey the kept files](brocrew://piece/${String(given.structured?.['piece'])})`,
      )
    })

    it('message_agent does not say the kind back, and keeps how it went', async () => {
      const { pmTools, worker, label } = await aPmAndItsWorker()
      const sent = await ok(pmTools, 'message_agent', {
        agent: worker,
        kind: 'follow-up',
        piece: label,
        text: 'Also count the images.',
      })
      expect(sent.text).not.toMatch(/as (note|follow-up)/)
      expect(sent.text).not.toContain('Also count the images.')
      expect(sent.text).toMatch(/straight away|held for/)
    })

    it('update_work answers Done, with the label only when the call did not spell it', async () => {
      const { pmTools } = await aPmAndItsWorker()
      const inferred = await ok(pmTools, 'update_work', {
        title: 'A particular title',
        status: 'A particular status line',
      })
      expect(inferred.text).toMatch(/^Done\. W\d+\.$/)
      const label = inferred.structured?.['label'] as string
      expect(inferred.text).toBe(`Done. ${label}.`)

      const named = await ok(pmTools, 'update_work', {
        piece: label,
        status: 'Another particular status line',
      })
      expect(named.text).toBe('Done.')
    })

    it('take_on_work names the personal piece and its parent', async () => {
      const { pm, pmTools } = await aPm()
      await host.send(pm, 'Please take on the memorable request.', window)
      const taken = await ok(pmTools, 'take_on_work', {
        definition_of_done: 'The requested result and its checks are recorded.',
        title: 'A request with a memorable title',
        brief: 'Do the memorable thing.',
      })
      expect(taken.text.split('\n')[0]).toBe(
        `Took on ${taken.structured?.['label'] as string} under ${taken.structured?.['under'] as string} for the person.`,
      )
      expect(taken.text).toContain(
        `[${String(taken.structured?.['label'])} · A request with a memorable title](brocrew://piece/${String(taken.structured?.['piece'])})`,
      )
    })

    it('create_agent says the name this app chose, not the slug it was sent', async () => {
      const { pmTools } = await aPm()
      const created = await ok(pmTools, 'create_agent', { profile_slug: 'fixture-maker' })
      expect(created.text).toMatch(/^Created; /)
      expect(created.text).not.toContain('fixture-maker')
    })

    it('ask_question keeps its id and says where it went in words; withdraw_question answers Done', async () => {
      const { workerTools } = await aPmAndItsWorker()
      const asked = await ok(workerTools, 'ask_question', {
        who_answers: 'the-parent',
        question: 'May the survey skip the archive?',
      })
      const id = asked.structured?.['question'] as string
      expect(asked.text).toContain(`as ${id}.`)
      expect(asked.text).not.toMatch(/the-parent|a-person/)
      expect(asked.text).not.toContain('May the survey skip the archive?')

      const withdrawn = await ok(workerTools, 'withdraw_question', { question: id })
      expect(withdrawn.text).toBe('Done.')
    })

    it('find_files does not quote the words it was given', async () => {
      const { pmTools } = await aPm()
      const found = await ok(pmTools, 'find_files', { words: 'zebracrossing' })
      expect(found.text).not.toContain('zebracrossing')
      expect(found.text).toMatch(/holds those words\.|holding those words, newest first:/)
    })
  })

  // ─────────────────────────────────────────────────────────────────────────────────────────────
  // The arms a write can end on, each said in words
  // ─────────────────────────────────────────────────────────────────────────────────────────────

  describe('each arm a write ends on is said, and none of what it was sent', () => {
    /** Another agent whose rules the PM may ask for, once a person has granted it `grant`. */
    const aGrantedPm = async (grant: 'propose' | 'relay'): Promise<AgentToolset> => {
      const { pmTools } = await aPm()
      await ok(pmTools, 'create_agent', { profile_slug: 'archivist', rules: 'Mine.' })
      // A person at the sheet: the one thing that moves this column.
      expect(store.setCapabilities('pm', { canWriteRules: grant })).toBe(true)
      return pmTools
    }
    const versionsOfTheArchivist = (): string[] =>
      store.ownInstructionsOf('archivist').versions.map((version) => version.text)

    it('propose_agent_rules put before a person: says nothing is written, and echoes neither rules nor reason', async () => {
      const pmTools = await aGrantedPm('propose')
      const asked = await ok(pmTools, 'propose_agent_rules', {
        agent: 'archivist',
        rules: 'A second thought.',
        why: 'A memorable reason.',
      })
      expect(asked.structured?.['wrote']).toBe('a-request')
      expect(asked.text).toBe(RULES_PUT_BEFORE_A_PERSON)
      expect(asked.text).not.toContain('archivist')
      expect(asked.text).not.toContain('A second thought.')
      expect(asked.text).not.toContain('A memorable reason.')
      expect(versionsOfTheArchivist()).toEqual(['Mine.'])
    })

    it('propose_agent_rules relayed from a person: says it is written and when it applies', async () => {
      const pmTools = await aGrantedPm('relay')
      const written = await ok(pmTools, 'propose_agent_rules', {
        agent: 'archivist',
        rules: 'A rule a person gave.',
        why: 'A memorable reason.',
        already_agreed: true,
      })
      expect(written.structured?.['wrote']).toBe('a-version')
      expect(written.text).toBe(RULES_WRITTEN)
      expect(written.text).not.toContain('version')
      expect(written.text).not.toContain('relayed')
      expect(versionsOfTheArchivist()).toEqual(['A rule a person gave.', 'Mine.'])
    })

    /** The PM stops, and its provider will fail to bring it back this time. */
    const aParentThatCannotStart = async (pm: string): Promise<void> => {
      await host.close(pm, window)
      const ref = store.find(pm)?.ref
      if (ref === undefined) throw new Error('the parent has no provider ref')
      nextResumeThrows = new ResumeError(ref, 'resume failed: the handshake died')
    }

    /** A known profile gets the fixed reminder after the delivery arm's own words. */
    const receiptBeforeSaveReminder = (text: string): string => {
      const suffix =
        " If this work taught you a tested method you would reuse, save it now as your Saved methods section says; otherwise you're done."
      expect(text.endsWith(suffix)).toBe(true)
      return text.slice(0, -suffix.length)
    }

    it('reply_to_parent kept for the next start: says where the words wait, and the kept file ids', async () => {
      const { pm, worker, workerTools, label } = await aPmAndItsWorker()
      expect(store.identityOf(worker)?.profileSlug).toBe('worker')
      await aParentThatCannotStart(pm)
      const report = aFile('kept-report.md', '# Kept\n')
      const replied = await ok(workerTools, 'reply_to_parent', {
        piece: label,
        outcome: 'done',
        summary: 'A memorable summary.',
        resource_paths: [report],
      })
      expect(replied.structured?.['delivered']).toBe('kept')
      const kept = replied.structured?.['resources'] as string[]
      expect(replied.text).toMatch(
        new RegExp(
          `^${label.replace(/\./g, '\\.')} answered · kept on ${label.replace(/\./g, '\\.')}; .+ gets it when it next starts`,
        ),
      )
      expect(replied.structured?.['result_document']).toBe(kept[0])
      expect(
        receiptBeforeSaveReminder(replied.text).endsWith(
          ` Kept: ${kept[0]!}. Main result: ${kept[0]!}.`,
        ),
      ).toBe(true)
      expect(replied.text).not.toContain('A memorable summary.')
      expect(replied.text).not.toContain('kept-report.md')
    })

    it('reply_to_parent delivered nowhere: says so, why, where the answer stays and what to do', async () => {
      const { pm, worker, workerTools, label } = await aPmAndItsWorker()
      expect(store.identityOf(worker)?.profileSlug).toBe('worker')
      await aParentThatCannotStart(pm)
      // Only the parent's record refuses the words; every other row goes in.
      const append = store.append.bind(store)
      const refusing = vi
        .spyOn(store, 'append')
        .mockImplementation((sessionId, ordinal, event, at) => {
          if (
            sessionId === pm &&
            event.type === 'message_queued' &&
            event.text.includes('A summary nobody reads.')
          ) {
            throw new Error('SQLITE_FULL: database or disk is full')
          }
          append(sessionId, ordinal, event, at)
        })
      let replied: AgentToolAnswer
      try {
        replied = await ok(workerTools, 'reply_to_parent', {
          piece: label,
          outcome: 'done',
          summary: 'A summary nobody reads.',
        })
      } finally {
        refusing.mockRestore()
      }
      expect(replied.structured?.['delivered']).toBe('not-delivered')
      expect(replied.text).toContain(' could not be told: ')
      expect(replied.text).toContain(String(replied.structured?.['why']))
      expect(replied.text).toContain(`Your answer stays on ${label}`)
      expect(receiptBeforeSaveReminder(replied.text)).toMatch(/tell the person here\.$/)
      expect(replied.text).not.toContain('A summary nobody reads.')
      expect(replied.text).not.toMatch(/^Done/)
    })

    it('update_work a new brief held behind its holder’s turn: says it waits, and not the brief', async () => {
      const { pmTools, label } = await aPmAndItsWorker()
      const briefed = await ok(pmTools, 'update_work', {
        piece: label,
        brief: 'A memorable corrected brief.',
      })
      expect(briefed.structured?.['delivery']).toBe('held')
      expect(briefed.text).toContain('is not told yet: the new brief is held')
      expect(briefed.text).not.toContain('A memorable corrected brief.')
    })

    it('update_work a new brief of a piece whose give still waits: says it rides that give', async () => {
      const { pmTools, worker } = await aPmAndItsWorker()
      const second = await ok(pmTools, 'give_work', {
        definition_of_done: 'The requested result and its checks are recorded.',
        profile: 'worker',
        title: 'A second piece',
        brief: 'The second brief.',
      })
      expect(second.structured?.['agent']).toBe(worker)
      expect(second.structured?.['delivery']).toBe('held')
      const secondLabel = second.structured?.['label'] as string
      const briefed = await ok(pmTools, 'update_work', {
        piece: secondLabel,
        brief: 'A memorable corrected brief.',
      })
      expect(briefed.structured?.['delivery']).toBe('held')
      expect(briefed.text).toContain(`the give of ${secondLabel} is still held`)
      expect(briefed.text).toContain('in place of the first')
      expect(briefed.text).not.toContain('A memorable corrected brief.')
    })

    it('list_agents names a conversation that holds no piece by its id, and restore_agent gives that id beside its name', async () => {
      const { pm, pmTools } = await aPm()
      store.create({
        id: 'below_1',
        provider: 'claude',
        cwd: root,
        approvalMode: 'auto',
        profileId: 'pm',
        parentSessionId: pm,
      })

      // The emitted line, as a model reads it: led by the id, the one address it has.
      const listed = await ok(pmTools, 'list_agents', {})
      const line = listed.text.split('\n').find((one) => one.startsWith('below_1 · '))
      expect(line, listed.text).toBeDefined()
      expect(line).toContain(' · started by ')
      expect(line?.split(' · started by ')[0]).not.toContain('the owner of')

      expect(await host.archiveConversation('below_1')).toMatchObject({ done: true })
      const restored = await ok(pmTools, 'restore_agent', { agent: 'below_1' })
      expect(restored.structured?.['restored']).toEqual([
        { agent: 'below_1', carries_on: 'stopped' },
      ])
      expect(restored.text).toContain(', below_1: stays stopped until something starts it')
    })

    it('update_work a new brief its holder could not be started for: no Done, who could not be told, and why', async () => {
      const { pmTools, worker, label } = await aPmAndItsWorker()
      // The holder is stopped, and its provider fails to bring it back this time.
      aPersonTakesOver(worker)
      await host.close(worker, window)
      const ref = store.find(worker)?.ref
      if (ref === undefined) throw new Error('the worker has no provider ref')
      nextResumeThrows = new ResumeError(ref, 'resume failed: the handshake died')

      const briefed = await ok(pmTools, 'update_work', {
        piece: label,
        brief: 'A memorable corrected brief.',
      })
      expect(nextResumeThrows, 'the start was tried').toBeNull()
      expect(briefed.structured).toMatchObject({
        label,
        rebriefed: true,
        delivery: 'not-delivered',
      })
      const why = briefed.structured?.['whyNotTold'] as string
      expect(why.length).toBeGreaterThan(0)
      expect(briefed.text).toBe(
        `${host.whatToCallTheConversation(worker)} could not be told. ${why}`,
      )
      expect(briefed.text).not.toMatch(/^Done/)
      expect(briefed.text).not.toContain('A memorable corrected brief.')
      // The new brief stands on the piece, whoever could not be told.
      expect(store.piecesOwnedBy(worker).find((one) => one.label === label)?.brief).toBe(
        'A memorable corrected brief.',
      )
    })

    it('update_work a new brief of a piece that ended while it was on its way: no Done, and the brief was not sent', async () => {
      const { pmTools, worker, workerTools, label } = await aPmAndItsWorker()
      // The holder is running, parked on its card, so the new brief is held in its mailbox. The
      // call runs synchronously until it waits on that hold; the holder's reply lands in that
      // wait, before the answer reads whether the piece is still open.
      const updating = ok(pmTools, 'update_work', {
        piece: label,
        brief: 'A memorable corrected brief.',
      })
      const replying = ok(workerTools, 'reply_to_parent', {
        piece: label,
        outcome: 'done',
        summary: 'Finished on the first brief.',
      })
      const [briefed] = await Promise.all([updating, replying])

      expect(briefed.structured).toMatchObject({
        label,
        rebriefed: true,
        delivery: 'not-delivered',
      })
      expect(briefed.structured).not.toHaveProperty('whyNotTold')
      expect(briefed.text).toBe(
        `${label} had ended before its new brief reached ${host.whatToCallTheConversation(worker)}, so the new brief was not sent: any answer to it is to the brief before.`,
      )
      expect(briefed.text).not.toMatch(/^Done/)
      expect(store.piecesOwnedBy(worker).find((one) => one.label === label)?.state).toBe('answered')
    })
  })
})
