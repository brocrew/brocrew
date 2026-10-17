import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { FakeProviderSessions, FakeRuntime } from '@brobot2/runtime'
import type { AgentToolset } from '@brobot2/runtime'
import type { Provider } from '@brobot2/shared'
import { type AppDatabase, openDatabase } from '../src/main/db/connection'
import { applyMigrations } from '../src/main/db/migrate'
import { createSessionStore, type SessionStore } from '../src/main/db/session-store'
import { NO_DISCOVERY } from '../src/main/adopt/discover-sessions'
import { RuntimeHost } from '../src/main/runtime/runtime-host'
import type { RuntimeEventSink } from '../src/main/runtime/runtime-host'
import { agentToolsFor, type ToolName } from '../src/main/runtime/agent-tools'
import {
  AN_AGENT_THIS_APP_CANNOT_NAME,
  admitReply,
  type ReplyRefusal,
} from '../src/main/runtime/reply-rails'
import { resourcesRoot } from '../src/main/resources/resources'
import { resolveSessionCwd } from '../src/main/runtime/scratch-cwd'
import { clockTime } from '../src/shared/clock'
import { TASK_IS_OPEN, TASK_STATES, derivePieces, type PieceRow } from '../src/shared/tasks'
import type {
  PersistedEventInfo,
  RuntimeEventMessage,
  TranscriptEvent,
} from '../src/shared/runtime-ipc'

/**
 * D-025 · a reply refused for an ended piece says who ended it and when.
 *
 * What this file pins, and why it is a file of its own: `a-reply-and-its-absence` reads the refusal
 * for an ended piece only by its prefix (`You already replied`, `It was taken back`), and every
 * word D-025 added sits after that prefix. Nothing else reads `PieceRow.endedBy`. So this file
 * reads the new facts and the exact sentence they build:
 *
 *  - §1 the fold: who ended each piece is kept off the SAME row as the moment it ended, and is
 *    nobody where that row names nobody (a held brief cancelled).
 *  - §2 `admitReply` over a literal piece: the moment (`at`) and the NAME (`called`) in the detail,
 *    the sentence built from them, an id nowhere, and the name asked of the host only on this rail.
 *  - §3 to §6 the same through the real host, real SQLite, real tools: a giver closes a piece, a
 *    giver takes one back, the owner replies twice, a held brief is cancelled. Each reads the
 *    recorded moment off the ledger row that ended the piece, and the name off the host.
 *
 * Only the provider is a double. No Electron, no port, no userData but its own temporary one.
 */

const here = dirname(fileURLToPath(import.meta.url))
const migrationsFolder = join(here, '../src/main/db/migrations')

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

/** The one sentence an ended piece is refused in, up to the part that says how it ended. */
const STOP = 'stop work on that piece; no further reply is owed.'
const NOTHING_CHANGED = 'so nothing was recorded or changed.'

// ─────────────────────────────────────────────────────────────────────────────────────────────
// §1 · the fold — no host, no database
// ─────────────────────────────────────────────────────────────────────────────────────────────

describe('D-025 · §1 · the fold keeps who ended each piece', () => {
  const START = 1_700_000_000_000
  /** One ledger's rows, each at its own increasing moment, so no two endings share a time. */
  const ledgerOf = (events: readonly TranscriptEvent[]): PersistedEventInfo[] =>
    events.map((event, index) => ({ ordinal: index, at: START + (index + 1) * 1_000, event }))

  const given = (n: number, extra: { messageId?: string } = {}): TranscriptEvent => ({
    type: 'work_given',
    piece: `work_${String(n)}`,
    label: `W1.${String(n)}`,
    parent: 'work_root',
    givenBy: 'sess_pm',
    title: `the work ${String(n)}`,
    brief: `the work ${String(n)}`,
    ...extra,
  })

  it('§1 · the fold keeps who ended each piece off the row that ended it, and nobody where that row names nobody', () => {
    const entries = ledgerOf([
      /* 0 */ given(1),
      /* 1 */ {
        type: 'work_replied',
        piece: 'work_1',
        outcome: 'done',
        summary: 'done it',
        resources: [],
      },
      /* 2 */ given(2),
      /* 3 */ { type: 'work_taken_back', piece: 'work_2', by: 'sess_pm' },
      /* 4 */ given(3),
      /* 5 */ { type: 'work_closed', piece: 'work_3', by: 'sess_in_its_place' },
      // A LATER take-back of the same piece, by somebody else: it finds the piece already ended.
      /* 6 */ { type: 'work_taken_back', piece: 'work_3', by: 'sess_pm' },
      /* 7 */ given(4, { messageId: 'msg_4' }),
      /* 8 */ {
        type: 'message_unqueued',
        messageId: 'msg_4',
        reason: 'cancelled',
        text: 'the work 4',
      },
      /* 9 */ given(5),
    ])
    const rows = derivePieces('sess_worker', entries)
    expect(rows).toHaveLength(5)
    const byLabel = (label: string): PieceRow | undefined => rows.find((one) => one.label === label)
    const at = (index: number): number => (entries[index] as PersistedEventInfo).at

    // The moment each ending is read off must be a different moment, or the pairing below could
    // pass against a fold that took the time of the wrong row.
    expect(at(5)).not.toBe(at(6))

    // Its owner's own reply: the owner is the actor, at the reply row's own moment.
    expect(byLabel('W1.1')).toMatchObject({
      state: 'answered',
      endedBy: 'sess_worker',
      endedAt: at(1),
    })
    // A take-back names the row's own `by`.
    expect(byLabel('W1.2')).toMatchObject({
      state: 'withdrawn',
      endedBy: 'sess_pm',
      endedAt: at(3),
    })
    // A close names the row's own `by` - the conversation in the giver's place, not the giver - and
    // the first ending wins: the actor and the moment are the CLOSE's, kept together, and the later
    // take-back moves neither.
    expect(byLabel('W1.3')).toMatchObject({
      state: 'closed',
      endedBy: 'sess_in_its_place',
      endedAt: at(5),
    })
    // A held brief cancelled: the row names nobody, whoever cancelled it. Ended, with the moment,
    // and no actor.
    expect(byLabel('W1.4')).toMatchObject({ state: 'withdrawn', endedBy: null, endedAt: at(8) })
    // Still open: nothing ended it.
    expect(byLabel('W1.5')).toMatchObject({ state: 'working', endedBy: null, endedAt: null })

    // The paired positive, from the same fold over the same ledger: three endings are named and two
    // rows are not, so "nobody" for the held brief is read beside "somebody" for the other endings.
    expect(rows.filter((one) => one.endedBy !== null).map((one) => one.label)).toEqual([
      'W1.1',
      'W1.2',
      'W1.3',
    ])
    expect(rows.filter((one) => one.endedBy === null).map((one) => one.label)).toEqual([
      'W1.4',
      'W1.5',
    ])
  })
})

// ─────────────────────────────────────────────────────────────────────────────────────────────
// §2 · admitReply over a literal piece — no host, no database
// ─────────────────────────────────────────────────────────────────────────────────────────────

describe('D-025 · §2 · admitReply, over a literal piece', () => {
  const ENDED_AT = 1_700_000_000_000
  const NAMES: Readonly<Record<string, string>> = { sess_pm: 'Ada', sess_in_its_place: 'Grace' }

  /** A piece with every field spelled, so nothing is inherited from a builder. */
  const pieceIn = (state: PieceRow['state'], over: Partial<PieceRow> = {}): PieceRow => ({
    piece: 'work_1',
    label: 'W1.1',
    parent: 'work_root',
    title: 'work',
    brief: 'work',
    giver: 'sess_pm',
    owner: 'sess_w',
    givenAt: 10,
    messageId: null,
    state,
    endedAt: TASK_IS_OPEN[state] ? null : ENDED_AT,
    endedBy: null,
    outcome: state === 'answered' ? 'done' : null,
    stalledBecause: state === 'stalled' ? 'turn_ended' : null,
    stalledAt: state === 'stalled' ? 15 : null,
    stalledBy: null,
    questionLostAtRestart: false,
    resources: [],
    summary: null,
    answerReachedNobody: false,
    needsUserAction: false,
    statusLine: null,
    ...over,
  })

  const whatToCallThem = (): ((conversation: string) => string) =>
    vi.fn((conversation: string): string => NAMES[conversation] ?? 'somebody else')

  /** The refusal for `piece`, which must be one. */
  const refusalFor = (
    piece: PieceRow,
    whatToCall: (conversation: string) => string,
  ): ReplyRefusal => {
    const refusal = admitReply('W1.1', piece, false, 'a summary', whatToCall)
    if (refusal === null) throw new Error(`a ${piece.state} piece was admitted`)
    return refusal
  }

  it('§2 · a close or a take-back is refused with the moment and the NAME of the one that ended it: never an id, never the giver by guess', () => {
    expect(clockTime(ENDED_AT)).toMatch(/\d/)

    // A: the giver closed it.
    const whatToCallA = whatToCallThem()
    const closed = refusalFor(pieceIn('closed', { endedBy: 'sess_pm' }), whatToCallA)
    expect(closed.rail).toBe('piece-already-ended')
    expect(closed.permanence).toBe('permanent')
    expect(closed.retryable).toBe(false)
    expect(closed.detail).toEqual({
      piece: 'W1.1',
      label: 'W1.1',
      state: 'closed',
      at: ENDED_AT,
      called: 'Ada',
    })
    expect(closed.reason).toBe(
      `${STOP} It was closed by Ada at ${clockTime(ENDED_AT)}, ${NOTHING_CHANGED}`,
    )
    // The name is asked of the host once, for the one that ended it, and no id reaches the agent.
    expect(whatToCallA).toHaveBeenCalledTimes(1)
    expect(whatToCallA).toHaveBeenCalledWith('sess_pm')
    expect(JSON.stringify(closed)).not.toMatch(/sess_/)

    // B: the SAME giver, but it was the conversation in its place that took the piece back. The
    // sentence names the one that ended it, not the giver.
    const whatToCallB = whatToCallThem()
    const takenBack = refusalFor(
      pieceIn('withdrawn', { giver: 'sess_pm', endedBy: 'sess_in_its_place' }),
      whatToCallB,
    )
    expect(takenBack.detail).toEqual({
      piece: 'W1.1',
      label: 'W1.1',
      state: 'withdrawn',
      at: ENDED_AT,
      called: 'Grace',
    })
    expect(takenBack.reason).toBe(
      `${STOP} It was taken back by Grace at ${clockTime(ENDED_AT)}, ${NOTHING_CHANGED}`,
    )
    expect(whatToCallB).toHaveBeenCalledTimes(1)
    expect(whatToCallB).toHaveBeenCalledWith('sess_in_its_place')
    expect(JSON.stringify(takenBack)).not.toMatch(/sess_/)
    // The paired fact: A and B differ only in who ended it, and the names differ with it.
    expect(closed.detail.called).not.toBe(takenBack.detail.called)

    // The name follows "by" as the host spelled it: the lower-case category is not capitalised, and
    // a slug is not either.
    const unnamed = refusalFor(
      pieceIn('withdrawn', { endedBy: 'sess_in_its_place' }),
      () => AN_AGENT_THIS_APP_CANNOT_NAME,
    )
    expect(AN_AGENT_THIS_APP_CANNOT_NAME).toBe('an agent this app cannot name')
    expect(unnamed.reason).toContain(`It was taken back by an agent this app cannot name at `)
    const aSlug = refusalFor(pieceIn('closed', { endedBy: 'sess_pm' }), () => 'worker-7')
    expect(aSlug.reason).toContain('It was closed by worker-7 at ')
  })

  it("§2 · the owner's own reply names nobody: said by the state, never by its own name, and the host is not asked", () => {
    const whatToCall = whatToCallThem()
    const answered = refusalFor(pieceIn('answered', { endedBy: 'sess_w' }), whatToCall)
    expect(answered.rail).toBe('piece-already-ended')
    expect(answered.permanence).toBe('permanent')
    expect(answered.detail).toEqual({
      piece: 'W1.1',
      label: 'W1.1',
      state: 'answered',
      at: ENDED_AT,
    })
    expect(answered.detail).not.toHaveProperty('called')
    expect(answered.reason).toBe(
      `${STOP} You already replied at ${clockTime(ENDED_AT)}, ${NOTHING_CHANGED}`,
    )
    expect(answered.reason).not.toContain(' by ')
    expect(whatToCall).not.toHaveBeenCalled()

    // The paired positive, on the otherwise identical piece: where somebody ELSE ended it the name
    // is present and the host is asked. One fact over is who ended it.
    const askedToo = whatToCallThem()
    const somebodyElse = refusalFor(pieceIn('closed', { endedBy: 'sess_pm' }), askedToo)
    expect(somebodyElse.detail.called).toBe('Ada')
    expect(askedToo).toHaveBeenCalledTimes(1)
  })

  it('§2 · a held brief cancelled names nobody and never guesses the giver, and a missing moment is left out of the sentence', () => {
    const whatToCall = whatToCallThem()
    const cancelled = refusalFor(pieceIn('withdrawn', { endedBy: null }), whatToCall)
    expect(cancelled.detail).toEqual({
      piece: 'W1.1',
      label: 'W1.1',
      state: 'withdrawn',
      at: ENDED_AT,
    })
    expect(cancelled.detail).not.toHaveProperty('called')
    expect(cancelled.reason).toBe(
      `${STOP} It was taken back at ${clockTime(ENDED_AT)}, ${NOTHING_CHANGED}`,
    )
    expect(cancelled.reason).not.toContain(' by ')
    expect(cancelled.reason).not.toContain('giver')
    expect(whatToCall).not.toHaveBeenCalled()
    // The piece's giver is named in the fixture: it is there to be guessed at, and is not.
    expect(cancelled.detail.called).toBeUndefined()
    expect(pieceIn('withdrawn').giver).toBe('sess_pm')

    // A piece that holds no moment: the detail has no `at`, and the sentence no ' at '.
    const undated = refusalFor(pieceIn('withdrawn', { endedBy: null, endedAt: null }), whatToCall)
    expect(undated.detail).toEqual({ piece: 'W1.1', label: 'W1.1', state: 'withdrawn' })
    expect(undated.detail).not.toHaveProperty('at')
    expect(undated.reason).toBe(`${STOP} It was taken back, ${NOTHING_CHANGED}`)
    expect(undated.reason).not.toContain(' at ')
    expect(whatToCall).not.toHaveBeenCalled()
  })

  it('§2 · the host is asked for a name only on piece-already-ended: an open piece is admitted and an unknown one is opaque', () => {
    // Every state this app has, through one door: the three endings are refused and every open
    // state is admitted, so the names below are asked only where something ended.
    const refused: string[] = []
    const admitted: string[] = []
    const whatToCall = whatToCallThem()
    for (const state of TASK_STATES) {
      const outcome = admitReply('W1.1', pieceIn(state), false, 'a summary', whatToCall)
      ;(outcome === null ? admitted : refused).push(state)
      if (outcome !== null) expect(outcome.rail).toBe('piece-already-ended')
    }
    expect(refused).toEqual(TASK_STATES.filter((state) => !TASK_IS_OPEN[state]))
    expect(admitted).toEqual(TASK_STATES.filter((state) => TASK_IS_OPEN[state]))
    expect(refused.length).toBeGreaterThan(0)
    expect(admitted).toContain('stalled')
    expect(admitted).toContain('working')
    // The open pieces named nobody, though each of them has an `endedBy` slot to be asked about.
    expect(whatToCall).not.toHaveBeenCalled()

    // No piece by that name: the detail is the caller's own echo and nothing more.
    const unknown = admitReply('W9.9', undefined, false, 'a summary', whatToCall)
    expect(unknown?.rail).toBe('no-piece-by-that-name')
    expect(unknown?.detail).toEqual({ piece: 'W9.9' })
    // And its own root, which never ends, is a different word with the same bare detail.
    const itsRoot = admitReply('W1', undefined, true, 'a summary', whatToCall)
    expect(itsRoot?.rail).toBe('a-person-gave-that-piece')
    expect(itsRoot?.detail).toEqual({ piece: 'W1' })
    expect(whatToCall).not.toHaveBeenCalled()
  })
})

// ─────────────────────────────────────────────────────────────────────────────────────────────
// §3 to §6 · through the real host
// ─────────────────────────────────────────────────────────────────────────────────────────────

describe('D-025 · §3-§6 · a refused reply through the real host', () => {
  let userData: string
  let root: string
  let db: AppDatabase
  let store: SessionStore
  let host: RuntimeHost
  let hosts: RuntimeHost[]
  let issued: FakeProviderSessions
  let counter: number
  let clock: number
  let window: RecordingSink
  /** A fresh identity per pair, so no pair can read another pair's conversations. */
  let pairs: number
  const tick = (): number => clock++

  const buildHost = (): RuntimeHost => {
    const built = new RuntimeHost({
      store,
      discoverSessions: NO_DISCOVERY,
      nativeTranscriptPath: () => null,
      exportDirectory: () => join(userData, 'exports'),
      resourcesRoot: () => resourcesRoot(userData),
      createRuntime: (provider: Provider) => new FakeRuntime(provider, { sessions: issued }),
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
    userData = mkdtempSync(join(tmpdir(), 'brobot2-ended-piece-'))
    root = mkdtempSync(join(tmpdir(), 'brobot2-ended-piece-root-'))
    db = openDatabase(join(userData, 'brobot2.sqlite'))
    applyMigrations(db, migrationsFolder)
    clock = 7_000_000
    store = createSessionStore(db, tick)
    counter = 0
    hosts = []
    issued = new FakeProviderSessions()
    host = buildHost()
    window = new RecordingSink('webContents:1')
    pairs = 0
  })

  afterEach(async () => {
    for (const built of hosts) await built.closeAll()
    db.close()
    for (const dir of [userData, root]) rmSync(dir, { recursive: true, force: true })
  })

  const personOpens = async (profileId: string): Promise<string> => {
    const { sessionId } = await host.createSession(
      { provider: 'claude', profileId, approvalMode: 'ask', cwd: root },
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
    args: Record<string, unknown>,
  ): Promise<Record<string, unknown>> => {
    const tool = toolset.tools.find((one) => one.name === name)
    if (tool === undefined) throw new Error(`no such tool: ${name}`)
    return (await tool.call(args)).structured as Record<string, unknown>
  }

  /** The toolset a session's calls are driven through, built the way the launch builds it. */
  const toolsOf = (sessionId: string): AgentToolset => agentToolsFor(host, sessionId)

  const ledger = (sessionId: string): TranscriptEvent[] =>
    store.events(sessionId).map((entry) => entry.event)

  /** The recorded moment of the one ledger row that matches, which must exist. */
  const momentOf = (
    sessionId: string,
    matches: (event: TranscriptEvent) => boolean,
    what: string,
  ): number => {
    const found = store.events(sessionId).filter((entry) => matches(entry.event))
    if (found.length !== 1) throw new Error(`expected exactly one ${what}, found ${found.length}`)
    return (found[0] as PersistedEventInfo).at
  }

  /** The turn parks on a person's card; once it has, the piece is open and its brief delivered. */
  const cardOn = async (sessionId: string): Promise<void> => {
    await waitFor(
      () => ledger(sessionId).some((event) => event.type === 'permission_request'),
      'the card the turn parks on',
    )
  }

  const giveTo = async (
    tools: AgentToolset,
    profile: string,
    text: string,
  ): Promise<{ agent: string; piece: string; label: string }> => {
    const given = await callOn(tools, 'give_work', {
      definition_of_done: 'The requested result and its checks are recorded.',
      profile,
      title: text,
      brief: text,
    })
    expect(given.outcome, JSON.stringify(given)).toBe('ok')
    return {
      agent: given.agent as string,
      piece: given.piece as string,
      label: given.label as string,
    }
  }

  /** A PM in a window with one worker of its own, holding one piece of work the PM gave it. */
  const aPmAndItsWorker = async (
    text: string,
  ): Promise<{
    pm: string
    worker: string
    pmTools: AgentToolset
    siblings: readonly string[]
    task: string
    label: string
  }> => {
    const nth = ++pairs
    const workerProfile = `worker-${String(nth)}`
    const siblings = [workerProfile, `${workerProfile}-b`, `${workerProfile}-c`]
    for (const one of siblings) await bringIdentityIntoBeing(one)
    const pm = await personOpens(`pm-${String(nth)}`)
    const pmTools = toolsOf(pm)
    const given = await giveTo(pmTools, workerProfile, text)
    await cardOn(given.agent)
    return { pm, worker: given.agent, pmTools, siblings, task: given.piece, label: given.label }
  }

  const taskOf = (sessionId: string, piece: string) =>
    store.piecesOwnedBy(sessionId).find((one) => one.piece === piece)

  const reply = async (
    sessionId: string,
    args: Record<string, unknown>,
  ): Promise<Record<string, unknown>> => callOn(toolsOf(sessionId), 'reply_to_parent', args)

  it('§3 · a giver closes the piece: the owner’s reply is refused saying it was closed, by whom, and when', async () => {
    const { pm, worker, pmTools, siblings, task, label } = await aPmAndItsWorker('the work')
    expect(taskOf(worker, task)?.label).toBe(label)
    const closing = await callOn(pmTools, 'update_work', { piece: label, close: true })
    expect(closing.outcome, JSON.stringify(closing)).toBe('ok')
    const closedAt = momentOf(worker, (event) => event.type === 'work_closed', 'work_closed row')
    expect(taskOf(worker, task)?.state).toBe('closed')

    const refused = await reply(worker, { piece: task, outcome: 'done', summary: 'too late' })
    const closer = host.whatToCallTheConversation(pm)
    expect(refused.outcome).toBe('refused')
    expect(refused.rail).toBe('piece-already-ended')
    expect(refused.permanence).toBe('permanent')
    expect(refused.retryable).toBe(false)
    expect(refused.detail).toEqual({
      piece: task,
      label,
      state: 'closed',
      at: closedAt,
      called: closer,
    })
    // The CLOSER is named, and not the caller, and not by id.
    expect(closer).not.toBe(host.whatToCallTheConversation(worker))
    expect(closer).not.toMatch(/sess_/)
    expect(clockTime(closedAt)).toMatch(/\d/)
    expect(refused.reason).toBe(
      `${STOP} It was closed by ${closer} at ${clockTime(closedAt)}, ${NOTHING_CHANGED}`,
    )
    expect(JSON.stringify(refused)).not.toMatch(/sess_/)
    // Nothing was recorded.
    expect(ledger(worker).some((event) => event.type === 'work_replied')).toBe(false)

    // The paired positive, same caller and same call shape: the worker now holds nothing open, a
    // new piece reaches the same worker, and a reply that names it lands.
    const next = await giveTo(pmTools, siblings[0] as string, 'the next one')
    expect(next.agent).toBe(worker)
    expect(next.piece).not.toBe(task)
    const landed = await reply(worker, { piece: next.piece, outcome: 'done', summary: 'the next' })
    expect(landed.outcome, JSON.stringify(landed)).toBe('ok')
  })

  it('§4 · a giver takes the piece back: the refusal says it was taken back, by whom, and when', async () => {
    const { pm, worker, pmTools, siblings, task, label } = await aPmAndItsWorker('the work')
    const back = await callOn(pmTools, 'withdraw_task', { piece: label })
    expect(back.outcome, JSON.stringify(back)).toBe('ok')
    // The brief had already gone out: the row that ended the piece is the take-back's own.
    expect(back.tookBackTheMessage).toBe(false)
    const at = momentOf(worker, (event) => event.type === 'work_taken_back', 'work_taken_back row')
    expect(taskOf(worker, task)?.state).toBe('withdrawn')

    const refused = await reply(worker, { piece: task, outcome: 'done', summary: 'too late' })
    const giver = host.whatToCallTheConversation(pm)
    expect(refused.rail).toBe('piece-already-ended')
    expect(refused.detail).toEqual({ piece: task, label, state: 'withdrawn', at, called: giver })
    expect(giver).not.toBe(host.whatToCallTheConversation(worker))
    expect(clockTime(at)).toMatch(/\d/)
    expect(refused.reason).toBe(
      `${STOP} It was taken back by ${giver} at ${clockTime(at)}, ${NOTHING_CHANGED}`,
    )
    expect(JSON.stringify(refused)).not.toMatch(/sess_/)
    expect(JSON.stringify(refused)).not.toContain('giver')

    // The paired positive: a piece given after the take-back is answered by the same worker.
    const next = await giveTo(pmTools, siblings[0] as string, 'the one after')
    expect(next.agent).toBe(worker)
    expect(
      (await reply(worker, { piece: next.piece, outcome: 'done', summary: 'the one after' }))
        .outcome,
    ).toBe('ok')
  })

  it('§5 · the owner’s own earlier reply reads "You already replied at <time>" and names nobody', async () => {
    const { worker, task, label } = await aPmAndItsWorker('the work')
    const first = await reply(worker, { piece: task, outcome: 'done', summary: 'once' })
    expect(first.outcome, JSON.stringify(first)).toBe('ok')
    const at = momentOf(worker, (event) => event.type === 'work_replied', 'work_replied row')

    const again = await reply(worker, { piece: task, outcome: 'failed', summary: 'twice' })
    expect(again.rail).toBe('piece-already-ended')
    expect(again.permanence).toBe('permanent')
    // The first reply's recorded moment, not a later tick: the second reply moved the clock on.
    expect(again.detail).toEqual({ piece: task, label, state: 'answered', at })
    expect(again.detail).not.toHaveProperty('called')
    expect(clockTime(at)).toMatch(/\d/)
    expect(again.reason).toBe(`${STOP} You already replied at ${clockTime(at)}, ${NOTHING_CHANGED}`)
    expect(again.reason).not.toContain(' by ')
    // And the answer a giver has read is the one the row keeps.
    expect(taskOf(worker, task)?.outcome).toBe('done')
    expect(taskOf(worker, task)?.endedAt).toBe(at)
  })

  it('§6 · a held brief cancelled reads "It was taken back at <time>" and names nobody, whoever cancelled it', async () => {
    const { worker, pmTools, siblings, task } = await aPmAndItsWorker('the running one')
    const first = await reply(worker, {
      piece: task,
      outcome: 'done',
      summary: 'the running one is done',
    })
    expect(first.outcome, JSON.stringify(first)).toBe('ok')

    // A second give is HELD behind the running turn's card. Called directly so the raw result is
    // read: a held give carries no message property.
    const held = await callOn(pmTools, 'give_work', {
      definition_of_done: 'The requested result and its checks are recorded.',
      profile: siblings[0] as string,
      title: 'the held one',
      brief: 'the held one',
    })
    expect(held.outcome, JSON.stringify(held)).toBe('ok')
    expect(held.agent).toBe(worker)
    expect(held).not.toHaveProperty('message')
    const heldTask = held.piece as string
    const heldLabel = held.label as string
    const heldRow = [...ledger(worker)]
      .reverse()
      .find((event) => event.type === 'message_queued' && event.text === 'the held one')
    if (heldRow?.type !== 'message_queued' || heldRow.messageId === undefined) {
      throw new Error('the held message was not recorded')
    }
    const messageId = heldRow.messageId
    // A window takes the child over before it may cancel for it.
    host.claimSession(worker, window)
    await host.cancelQueuedMessage(worker, messageId, window)
    expect(taskOf(worker, heldTask)?.state).toBe('withdrawn')
    const cancelledAt = momentOf(
      worker,
      (event) =>
        event.type === 'message_unqueued' &&
        event.reason === 'cancelled' &&
        event.messageId === messageId,
      'cancelled message_unqueued row',
    )

    const refused = await reply(worker, {
      piece: heldTask,
      outcome: 'done',
      summary: 'work nobody wanted any more',
    })
    expect(refused.rail).toBe('piece-already-ended')
    const detail = refused.detail as { state?: string; at?: number }
    expect(detail.state).toBe('withdrawn')
    expect(detail.at).toBe(cancelledAt)
    expect(detail.at).toBe(taskOf(worker, heldTask)?.endedAt)
    // The row names nobody, so the detail does not either.
    expect(refused.detail).toEqual({
      piece: heldTask,
      label: heldLabel,
      state: 'withdrawn',
      at: cancelledAt,
    })
    expect(refused.detail).not.toHaveProperty('called')
    expect(clockTime(cancelledAt)).toMatch(/\d/)
    expect(refused.reason).toBe(
      `${STOP} It was taken back at ${clockTime(cancelledAt)}, ${NOTHING_CHANGED}`,
    )
    expect(refused.reason).not.toContain(' by ')
    expect(refused.reason).not.toContain('giver')

    // The paired positive: §4's explicit take-back of an OPEN piece says "taken back by <name>" in
    // the same words, so the absence above is the row's and not the sentence's. And a live sibling
    // given after the cancel is answered by the same worker.
    const alive = await giveTo(pmTools, siblings[0] as string, 'the live one')
    expect(alive.agent).toBe(worker)
    expect(alive.piece).not.toBe(heldTask)
    expect(
      (await reply(worker, { piece: alive.piece, outcome: 'done', summary: 'the live one' }))
        .outcome,
    ).toBe('ok')
  })
})
