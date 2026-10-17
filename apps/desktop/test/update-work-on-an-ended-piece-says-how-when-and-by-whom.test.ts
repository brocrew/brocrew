import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { FakeProviderSessions, FakeRuntime } from '@brobot2/runtime'
import type { Provider } from '@brobot2/shared'
import { type AppDatabase, openDatabase } from '../src/main/db/connection'
import { applyMigrations } from '../src/main/db/migrate'
import { createSessionStore, type SessionStore } from '../src/main/db/session-store'
import { NO_DISCOVERY } from '../src/main/adopt/discover-sessions'
import { RuntimeHost } from '../src/main/runtime/runtime-host'
import type { EndedPieceDetail, RuntimeEventSink } from '../src/main/runtime/runtime-host'
import {
  agentToolsFor,
  anEndedPieceSaid,
  refuseTool,
  type ToolName,
} from '../src/main/runtime/agent-tools'
import { resourcesRoot } from '../src/main/resources/resources'
import { resolveSessionCwd } from '../src/main/runtime/scratch-cwd'
import { clockTime, clockTimeFrom } from '../src/shared/clock'
import { sameLocalDay } from '../src/shared/local-time'
import type {
  PersistedEventInfo,
  RuntimeEventMessage,
  TranscriptEvent,
} from '../src/shared/runtime-ipc'

/**
 * F059 · `update_work` on a piece that has ended says how, when and by whom it ended (`1abdb8ab`).
 *
 * Before it, a giver that tried to close, re-brief or set the status of a piece its helper had
 * already answered was told only *"that piece has ended — answered, closed or taken back"*. Now the
 * refusal says which ending, when and by whom, as `reply_to_parent`'s refusal does, and its act is
 * the one THIS caller has:
 *
 *  - the owner of a piece a conversation gave it (it may not rename it) stops work on it;
 *  - a giver whose piece was answered reads the answer with list_tasks;
 *  - anyone else who may still rename it is told that a title is all that may change.
 *
 * What this file pins, and why it is a file of its own: `the-act-inside-the-cut` measures one
 * planted sentence for its length and nothing else, so no test read the words, the detail, or the
 * host's half (who ended it, the caller's own act said as its own, whether the caller may rename).
 *
 *  - §1 `anEndedPieceSaid` over a literal detail: each ending, each act, the time on the same day
 *    and on another, and each fact left out where the detail carries none.
 *  - §2 through the real host, real SQLite and the real tools: an answered piece read by its giver
 *    and by its helper; the same refusal days later; a piece the giver closed, closed again; a piece
 *    the giver took back; a held brief cancelled, which names nobody. Each is paired with a title
 *    change the same piece still takes, or with the caller that may not make one.
 *  - 🔴 F090 · an ended piece is refused as one FIRST, whatever was asked: its owner's close, new
 *    brief and title are told how it ended, where they met the giver's words, whose every act an
 *    ended piece refuses. The giver's words stay on an open piece, where they are true.
 *
 * Only the provider is a double. No Electron, no port, no userData but its own temporary one.
 */

const here = dirname(fileURLToPath(import.meta.url))
const migrationsFolder = join(here, '../src/main/db/migrations')

const DAY_MS = 86_400_000

/** The acts, as the three arms of the sentence open. */
const STOP = 'stop work on that piece; no further reply is owed.'
const ONLY_THE_TITLE = 'only its title may still be changed.'
const readItsAnswer = (label: string): string =>
  `read its answer with list_tasks, naming ${label}; only its title may still be changed.`
const NOTHING_CHANGED = 'so nothing was changed.'

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

// ─────────────────────────────────────────────────────────────────────────────────────────────
// §1 · anEndedPieceSaid, over a literal detail — no host, no database
// ─────────────────────────────────────────────────────────────────────────────────────────────

describe('F059 · §1 · anEndedPieceSaid, over a literal detail', () => {
  /** Noon UTC: on whatever zone this Mac is in, a minute later is the same local day. */
  const AT = Date.UTC(2030, 0, 15, 12, 0)
  const SAME_DAY = AT + 60_000
  const DAYS_LATER = AT + 3 * DAY_MS

  /** A detail with every required field spelled, so a test moves exactly the facts it names. */
  const detailOf = (
    over: Pick<EndedPieceDetail, 'state' | 'yoursToRetitle'> &
      Partial<Omit<EndedPieceDetail, 'state' | 'yoursToRetitle'>>,
  ): EndedPieceDetail => ({ piece: 'work_1', label: 'W2.1', at: AT, ...over })

  it('the premise: the two reading moments fall on the same day and on another, and say the time differently', () => {
    expect(sameLocalDay(AT, SAME_DAY)).toBe(true)
    expect(sameLocalDay(AT, DAYS_LATER)).toBe(false)
    expect(clockTime(AT)).toMatch(/\d/)
    expect(clockTimeFrom(AT, SAME_DAY)).toBe(clockTime(AT))
    expect(clockTimeFrom(AT, DAYS_LATER)).not.toBe(clockTime(AT))
  })

  it('an answered piece: its giver is told to read the answer, its helper to stop, and the helper is "You", never by name', () => {
    const toTheGiver = anEndedPieceSaid(
      detailOf({ state: 'answered', called: 'Ada', yoursToRetitle: true }),
      SAME_DAY,
    )
    expect(toTheGiver).toBe(
      `${readItsAnswer('W2.1')} W2.1 was answered by Ada at ${clockTime(AT)}, ${NOTHING_CHANGED}`,
    )

    const toTheHelper = anEndedPieceSaid(
      detailOf({ state: 'answered', endedByYou: true, yoursToRetitle: false }),
      SAME_DAY,
    )
    expect(toTheHelper).toBe(`${STOP} You answered W2.1 at ${clockTime(AT)}, ${NOTHING_CHANGED}`)
    expect(toTheHelper).not.toContain(' by ')
    expect(toTheHelper).not.toContain('list_tasks')
    expect(toTheHelper).not.toContain(ONLY_THE_TITLE)

    // One fact over: the same ending by the caller itself, where it MAY rename the piece (the owner
    // of a piece a person gave). No answer is waiting for it to read, so it is told the title alone.
    const toAnOwnerThatMayRename = anEndedPieceSaid(
      detailOf({ state: 'answered', endedByYou: true, yoursToRetitle: true }),
      SAME_DAY,
    )
    expect(toAnOwnerThatMayRename).toBe(
      `${ONLY_THE_TITLE} You answered W2.1 at ${clockTime(AT)}, ${NOTHING_CHANGED}`,
    )
    expect(toAnOwnerThatMayRename).not.toContain('list_tasks')
  })

  it('a closed piece and a piece taken back: "You …" for the caller’s own act, "… by <name>" for another’s', () => {
    const t = clockTime(AT)
    expect(
      anEndedPieceSaid(
        detailOf({ state: 'closed', endedByYou: true, yoursToRetitle: true }),
        SAME_DAY,
      ),
    ).toBe(`${ONLY_THE_TITLE} You closed W2.1 at ${t}, ${NOTHING_CHANGED}`)
    expect(
      anEndedPieceSaid(
        detailOf({ state: 'closed', called: 'Grace', yoursToRetitle: false }),
        SAME_DAY,
      ),
    ).toBe(`${STOP} W2.1 was closed by Grace at ${t}, ${NOTHING_CHANGED}`)
    expect(
      anEndedPieceSaid(
        detailOf({ state: 'withdrawn', endedByYou: true, yoursToRetitle: true }),
        SAME_DAY,
      ),
    ).toBe(`${ONLY_THE_TITLE} You took W2.1 back at ${t}, ${NOTHING_CHANGED}`)
    expect(
      anEndedPieceSaid(
        detailOf({ state: 'withdrawn', called: 'Grace', yoursToRetitle: false }),
        SAME_DAY,
      ),
    ).toBe(`${STOP} W2.1 was taken back by Grace at ${t}, ${NOTHING_CHANGED}`)

    // "read its answer" belongs to an ANSWERED piece alone: a giver of a closed piece someone else
    // ended may rename it, and is told only that.
    const closedByAnother = anEndedPieceSaid(
      detailOf({ state: 'closed', called: 'Grace', yoursToRetitle: true }),
      SAME_DAY,
    )
    expect(closedByAnother).toBe(
      `${ONLY_THE_TITLE} W2.1 was closed by Grace at ${t}, ${NOTHING_CHANGED}`,
    )
    expect(closedByAnother).not.toContain('list_tasks')
  })

  it('an ending on another day is said with its date, and the same ending read that day with the time alone', () => {
    const detail = detailOf({ state: 'answered', called: 'Ada', yoursToRetitle: true })
    const sameDay = anEndedPieceSaid(detail, SAME_DAY)
    const later = anEndedPieceSaid(detail, DAYS_LATER)
    expect(sameDay).toContain(` at ${clockTime(AT)}, `)
    expect(later).toBe(
      `${readItsAnswer('W2.1')} W2.1 was answered by Ada at ${clockTimeFrom(AT, DAYS_LATER)}, ${NOTHING_CHANGED}`,
    )
    // The only difference between the two is how the moment is said.
    expect(later).not.toBe(sameDay)
    expect(later).not.toContain(` at ${clockTime(AT)}, `)
  })

  it('says no "by" where nobody is recorded and no "at" where no moment is, and falls back for a state it does not name', () => {
    // A held brief cancelled: the row names nobody.
    const nobody = anEndedPieceSaid(
      detailOf({ state: 'withdrawn', yoursToRetitle: true }),
      SAME_DAY,
    )
    expect(nobody).toBe(
      `${ONLY_THE_TITLE} W2.1 was taken back at ${clockTime(AT)}, ${NOTHING_CHANGED}`,
    )
    expect(nobody).not.toContain(' by ')
    expect(nobody).not.toContain('You ')

    // No moment on the row: the detail is built without `at`, and the sentence says no time.
    const undated: EndedPieceDetail = {
      piece: 'work_1',
      label: 'W2.1',
      state: 'withdrawn',
      yoursToRetitle: true,
    }
    const noTime = anEndedPieceSaid(undated, SAME_DAY)
    expect(noTime).toBe(`${ONLY_THE_TITLE} W2.1 was taken back, ${NOTHING_CHANGED}`)
    expect(noTime).not.toContain(' at ')

    // A state that has not ended is not one this function names: the word's own sentence stands.
    const open = anEndedPieceSaid(detailOf({ state: 'working', yoursToRetitle: true }), SAME_DAY)
    expect(open).toBe(refuseTool('that-piece-has-ended').reason)
    expect(open).not.toContain('W2.1')
    // …and the control: an ended state never falls back to it.
    expect(
      anEndedPieceSaid(detailOf({ state: 'closed', yoursToRetitle: true }), SAME_DAY),
    ).not.toBe(refuseTool('that-piece-has-ended').reason)
  })
})

// ─────────────────────────────────────────────────────────────────────────────────────────────
// §2 · through the real host
// ─────────────────────────────────────────────────────────────────────────────────────────────

describe('F059 · §2 · update_work on an ended piece, through the real host and the real tools', () => {
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
      readProviderConfig: (_provider, home) => ({
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
    userData = mkdtempSync(join(tmpdir(), 'brobot2-f059-'))
    root = mkdtempSync(join(tmpdir(), 'brobot2-f059-root-'))
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

  /** An identity a give can name: opened by a person, then closed. */
  const bringIdentityIntoBeing = async (profileId: string): Promise<void> => {
    await host.close(await personOpens(profileId), window)
  }

  const callOn = async (
    caller: string,
    name: ToolName,
    args: Record<string, unknown>,
  ): Promise<Record<string, unknown>> => {
    const tool = agentToolsFor(host, caller).tools.find((one) => one.name === name)
    if (tool === undefined) throw new Error(`no such tool: ${name}`)
    return (await tool.call(args)).structured as Record<string, unknown>
  }

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

  const rowsOf = (sessionId: string, type: TranscriptEvent['type']): number =>
    ledger(sessionId).filter((event) => event.type === type).length

  const pieceOf = (owner: string, piece: string) =>
    store.piecesOwnedBy(owner).find((one) => one.piece === piece)

  /** A PM in a window with one worker of its own, parked on a card mid-way through the piece. */
  const aPmAndItsWorker = async (): Promise<{
    pm: string
    worker: string
    workerProfile: string
    piece: string
    label: string
  }> => {
    const nth = ++pairs
    const workerProfile = `worker-${String(nth)}`
    await bringIdentityIntoBeing(workerProfile)
    const pm = await personOpens(`pm-${String(nth)}`)
    const given = await callOn(pm, 'give_work', {
      definition_of_done: 'The requested result and its checks are recorded.',
      profile: workerProfile,
      title: 'the work',
      brief: 'the work',
    })
    expect(given.outcome, JSON.stringify(given)).toBe('ok')
    const worker = given.agent as string
    await waitFor(
      () => ledger(worker).some((event) => event.type === 'permission_request'),
      'the card the turn parks on',
    )
    return {
      pm,
      worker,
      workerProfile,
      piece: given.piece as string,
      label: given.label as string,
    }
  }

  /** A refused `update_work`, which must be refused for the piece having ended. */
  const refusedAsEnded = async (
    caller: string,
    args: Record<string, unknown>,
  ): Promise<{ reason: string; detail: Record<string, unknown> }> => {
    const refused = await callOn(caller, 'update_work', args)
    expect(refused.outcome, JSON.stringify(refused)).toBe('refused')
    expect(refused.rail).toBe('that-piece-has-ended')
    expect(refused.retryable).toBe(false)
    return {
      reason: String(refused.reason),
      detail: refused.detail as Record<string, unknown>,
    }
  }

  it('an answered piece: its giver is told to read the answer and who answered; its helper to stop, as "You"; and only the giver’s title is taken', async () => {
    const { pm, worker, piece, label } = await aPmAndItsWorker()
    const replied = await callOn(worker, 'reply_to_parent', {
      piece,
      outcome: 'done',
      summary: 'all done here',
    })
    expect(replied.outcome, JSON.stringify(replied)).toBe('ok')
    expect(pieceOf(worker, piece)?.state).toBe('answered')
    const answeredAt = momentOf(
      worker,
      (event) => event.type === 'work_replied',
      'work_replied row',
    )
    const helper = host.whatToCallTheConversation(worker)
    const giver = host.whatToCallTheConversation(pm)
    // The premise for every name below: the two are told apart, and neither is an id.
    expect(helper).not.toBe(giver)
    expect(helper).not.toMatch(/sess_/)
    // Read on the day it ended, so the time is said alone.
    expect(clockTimeFrom(answeredAt, clock)).toBe(clockTime(answeredAt))
    const statusRowsBefore = rowsOf(worker, 'work_status_set')

    // The giver tries to close it.
    const toTheGiver = await refusedAsEnded(pm, { piece: label, close: true })
    expect(toTheGiver.detail).toEqual({
      piece,
      label,
      state: 'answered',
      at: answeredAt,
      called: helper,
      yoursToRetitle: true,
    })
    expect(toTheGiver.reason).toBe(
      `${readItsAnswer(label)} ${label} was answered by ${helper} at ${clockTime(answeredAt)}, ${NOTHING_CHANGED}`,
    )
    expect(toTheGiver.reason).not.toContain('You ')
    expect(JSON.stringify(toTheGiver)).not.toMatch(/sess_/)

    // The helper tries to say where it stands.
    const toTheHelper = await refusedAsEnded(worker, { piece: label, status: 'late' })
    expect(toTheHelper.detail).toEqual({
      piece,
      label,
      state: 'answered',
      at: answeredAt,
      endedByYou: true,
      yoursToRetitle: false,
    })
    expect(toTheHelper.detail).not.toHaveProperty('called')
    expect(toTheHelper.reason).toBe(
      `${STOP} You answered ${label} at ${clockTime(answeredAt)}, ${NOTHING_CHANGED}`,
    )
    // Its own act, never its own name.
    expect(toTheHelper.reason).not.toContain(helper)
    expect(toTheHelper.reason).not.toContain(ONLY_THE_TITLE)

    // Nothing was written by either refusal, and the piece is still answered.
    expect(rowsOf(worker, 'work_status_set')).toBe(statusRowsBefore)
    expect(rowsOf(worker, 'work_closed')).toBe(0)
    expect(pieceOf(worker, piece)?.state).toBe('answered')

    // The act the giver was given is one it can take: list_tasks naming the label reads the answer.
    const record = await callOn(pm, 'list_tasks', { piece: label })
    // ⚑ A record, not a refusal: its `outcome` is the piece's own (`done`, as the helper answered).
    expect(record.label, JSON.stringify(record)).toBe(label)
    expect(record.outcome, JSON.stringify(record)).toBe('done')
    expect(JSON.stringify(record)).toContain('all done here')

    // `yoursToRetitle` is the truth on both sides: the helper's title is refused — ⚑ F090 · as the
    // piece having ended, first, and its act is to stop: whose act a title is would be said only of
    // an open piece…
    const helperRenames = await refusedAsEnded(worker, { piece: label, title: 'mine now' })
    expect(helperRenames.reason).toBe(toTheHelper.reason)
    expect(helperRenames.detail).toEqual(toTheHelper.detail)
    // …and the giver's title on the same ended piece is taken.
    const giverRenames = await callOn(pm, 'update_work', {
      piece: label,
      title: 'Renamed after the end',
    })
    expect(giverRenames.outcome, JSON.stringify(giverRenames)).toBe('ok')
    expect(pieceOf(worker, piece)).toMatchObject({
      state: 'answered',
      title: 'Renamed after the end',
    })
  })

  it('the same refusal read on another day says the ending with its date', async () => {
    const { pm, worker, piece, label } = await aPmAndItsWorker()
    expect(
      (await callOn(worker, 'reply_to_parent', { piece, outcome: 'done', summary: 'done it' }))
        .outcome,
    ).toBe('ok')
    const answeredAt = momentOf(
      worker,
      (event) => event.type === 'work_replied',
      'work_replied row',
    )
    const helper = host.whatToCallTheConversation(worker)

    // The control first, the same caller and the same call: read that day, the time alone.
    const thatDay = await refusedAsEnded(pm, { piece: label, status: 'late' })
    expect(thatDay.reason).toContain(
      `${label} was answered by ${helper} at ${clockTime(answeredAt)}, `,
    )

    // Three days on, by the host's own clock.
    clock += 3 * DAY_MS
    expect(sameLocalDay(answeredAt, clock)).toBe(false)
    const said = clockTimeFrom(answeredAt, clock)
    expect(said).not.toBe(clockTime(answeredAt))

    const later = await refusedAsEnded(pm, { piece: label, status: 'late' })
    // The moment in the detail is the ending's own, not the reading's.
    expect(later.detail).toMatchObject({ state: 'answered', at: answeredAt, called: helper })
    expect(later.reason).toBe(
      `${readItsAnswer(label)} ${label} was answered by ${helper} at ${said}, ${NOTHING_CHANGED}`,
    )
    expect(later.reason).not.toBe(thatDay.reason)
  })

  it('a piece its giver closed, closed again: "You closed", and its helper is told who closed it', async () => {
    const { pm, worker, piece, label } = await aPmAndItsWorker()
    const closing = await callOn(pm, 'update_work', { piece: label, close: true })
    expect(closing.outcome, JSON.stringify(closing)).toBe('ok')
    expect(pieceOf(worker, piece)?.state).toBe('closed')
    const closedAt = momentOf(worker, (event) => event.type === 'work_closed', 'work_closed row')
    const giver = host.whatToCallTheConversation(pm)

    const again = await refusedAsEnded(pm, { piece: label, close: true })
    expect(again.detail).toEqual({
      piece,
      label,
      state: 'closed',
      at: closedAt,
      endedByYou: true,
      yoursToRetitle: true,
    })
    expect(again.reason).toBe(
      `${ONLY_THE_TITLE} You closed ${label} at ${clockTime(closedAt)}, ${NOTHING_CHANGED}`,
    )
    expect(again.reason).not.toContain(giver)
    // A closed piece has no answer to read: the giver is not sent to list_tasks for one.
    expect(again.reason).not.toContain('list_tasks')

    const toTheHelper = await refusedAsEnded(worker, { piece: label, status: 'still on it' })
    expect(toTheHelper.detail).toEqual({
      piece,
      label,
      state: 'closed',
      at: closedAt,
      called: giver,
      yoursToRetitle: false,
    })
    expect(toTheHelper.reason).toBe(
      `${STOP} ${label} was closed by ${giver} at ${clockTime(closedAt)}, ${NOTHING_CHANGED}`,
    )

    // One close row, the first; and the positive, a title, is still taken.
    expect(rowsOf(worker, 'work_closed')).toBe(1)
    const renamed = await callOn(pm, 'update_work', { piece: label, title: 'renamed' })
    expect(renamed.outcome, JSON.stringify(renamed)).toBe('ok')
    expect(pieceOf(worker, piece)).toMatchObject({ state: 'closed', title: 'renamed' })
  })

  it('a piece its giver took back: "You took … back" to the giver, "… was taken back by <giver>" to its helper', async () => {
    const { pm, worker, piece, label } = await aPmAndItsWorker()
    const back = await callOn(pm, 'withdraw_task', { piece: label })
    expect(back.outcome, JSON.stringify(back)).toBe('ok')
    expect(pieceOf(worker, piece)?.state).toBe('withdrawn')
    const at = momentOf(worker, (event) => event.type === 'work_taken_back', 'work_taken_back row')
    const giver = host.whatToCallTheConversation(pm)

    const toTheGiver = await refusedAsEnded(pm, { piece: label, brief: 'do it differently' })
    expect(toTheGiver.detail).toEqual({
      piece,
      label,
      state: 'withdrawn',
      at,
      endedByYou: true,
      yoursToRetitle: true,
    })
    expect(toTheGiver.reason).toBe(
      `${ONLY_THE_TITLE} You took ${label} back at ${clockTime(at)}, ${NOTHING_CHANGED}`,
    )

    const toTheHelper = await refusedAsEnded(worker, { piece: label, status: 'halfway' })
    expect(toTheHelper.detail).toEqual({
      piece,
      label,
      state: 'withdrawn',
      at,
      called: giver,
      yoursToRetitle: false,
    })
    expect(toTheHelper.reason).toBe(
      `${STOP} ${label} was taken back by ${giver} at ${clockTime(at)}, ${NOTHING_CHANGED}`,
    )
    expect(rowsOf(worker, 'work_rebriefed')).toBe(0)
  })

  it('a held brief cancelled names nobody, and its giver is told the title alone', async () => {
    const { pm, worker, workerProfile, piece } = await aPmAndItsWorker()
    expect(
      (await callOn(worker, 'reply_to_parent', { piece, outcome: 'done', summary: 'the first' }))
        .outcome,
    ).toBe('ok')

    // A second give to the same profile reaches the same worker, HELD behind the running turn's card.
    const held = await callOn(pm, 'give_work', {
      definition_of_done: 'The requested result and its checks are recorded.',
      profile: workerProfile,
      title: 'the held one',
      brief: 'the held one',
    })
    expect(held.outcome, JSON.stringify(held)).toBe('ok')
    expect(held.agent).toBe(worker)
    const heldPiece = held.piece as string
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
    expect(pieceOf(worker, heldPiece)?.state).toBe('withdrawn')
    expect(pieceOf(worker, heldPiece)?.endedBy).toBeNull()
    const cancelledAt = pieceOf(worker, heldPiece)?.endedAt
    if (typeof cancelledAt !== 'number') throw new Error('the cancel recorded no moment')

    const refused = await refusedAsEnded(pm, { piece: heldLabel, status: 'never mind' })
    expect(refused.detail).toEqual({
      piece: heldPiece,
      label: heldLabel,
      state: 'withdrawn',
      at: cancelledAt,
      yoursToRetitle: true,
    })
    expect(refused.detail).not.toHaveProperty('called')
    expect(refused.detail).not.toHaveProperty('endedByYou')
    expect(refused.reason).toBe(
      `${ONLY_THE_TITLE} ${heldLabel} was taken back at ${clockTime(cancelledAt)}, ${NOTHING_CHANGED}`,
    )
    expect(refused.reason).not.toContain(' by ')
    expect(refused.reason).not.toContain('You ')
  })

  /**
   * 🔴 **F090 · an ended piece is refused as one FIRST, whatever was asked of it.** ⛔ Its owner's
   * close, new brief and title met the giver's words first — *"Ask with ask_question to change or
   * stop the work; you may set its status line, keep files you made for it, or hand it back with
   * reply_to_parent"* — and every one of those acts is refused on a piece that has ended. ⚑ The
   * giver's words stay where they are true: on a piece that is open.
   */
  it('🔴 F090 · its owner’s close, new brief and title: the giver’s words while it is open; once it has answered, how it ended — for every field, and nothing written', async () => {
    const { worker, piece, label } = await aPmAndItsWorker()
    // ⚑ Open: whose act it is, and what its owner may do instead, which an open piece takes.
    for (const [args, rail] of [
      [{ piece: label, close: true }, 'the-giver-briefs-and-closes-a-piece'],
      [{ piece: label, brief: 'do it my way' }, 'the-giver-briefs-and-closes-a-piece'],
      [{ piece: label, title: 'mine now' }, 'the-giver-names-a-piece'],
    ] as const) {
      const open = await callOn(worker, 'update_work', args)
      expect(open, JSON.stringify(args)).toMatchObject({
        outcome: 'refused',
        rail,
        reason: refuseTool(rail).reason,
      })
    }
    expect(
      (await callOn(worker, 'reply_to_parent', { piece, outcome: 'done', summary: 'done' }))
        .outcome,
    ).toBe('ok')
    const answeredAt = momentOf(
      worker,
      (event) => event.type === 'work_replied',
      'work_replied row',
    )
    const rowsBefore = (
      ['work_closed', 'work_rebriefed', 'work_retitled', 'work_status_set'] as const
    ).map((type) => rowsOf(worker, type))
    // 🔴 Answered — W1.67's case: a close, a new brief and a title, and a status line and files as
    // before, are each told how it ended, in the one sentence.
    for (const args of [
      { piece: label, close: true },
      { piece: label, brief: 'do it my way' },
      { piece: label, title: 'mine now' },
      { piece: label, status: 'still here' },
      { piece: label, resources: ['notes.md'] },
    ]) {
      const ended = await refusedAsEnded(worker, args)
      expect(ended.reason, JSON.stringify(args)).toBe(
        `${STOP} You answered ${label} at ${clockTime(answeredAt)}, ${NOTHING_CHANGED}`,
      )
      expect(ended.detail, JSON.stringify(args)).toEqual({
        piece,
        label,
        state: 'answered',
        at: answeredAt,
        endedByYou: true,
        yoursToRetitle: false,
      })
      // ⛔ …and none of the acts the giver's words offered.
      for (const act of ['ask_question', 'reply_to_parent', 'status line', 'keep files']) {
        expect(ended.reason, JSON.stringify(args)).not.toContain(act)
      }
    }
    // Nothing was written by any of them, and the piece is still answered, under its own title.
    expect(
      (['work_closed', 'work_rebriefed', 'work_retitled', 'work_status_set'] as const).map((type) =>
        rowsOf(worker, type),
      ),
    ).toEqual(rowsBefore)
    expect(pieceOf(worker, piece)).toMatchObject({ state: 'answered', title: 'the work' })
  })

  it('🔴 F090 · a piece its giver closed, or took back: its owner’s close, new brief and title are told how it ended and by whom', async () => {
    const closing = await aPmAndItsWorker()
    expect(
      (await callOn(closing.pm, 'update_work', { piece: closing.label, close: true })).outcome,
    ).toBe('ok')
    const taking = await aPmAndItsWorker()
    expect((await callOn(taking.pm, 'withdraw_task', { piece: taking.label })).outcome).toBe('ok')
    for (const [made, row, state, how] of [
      [closing, 'work_closed', 'closed', 'closed'],
      [taking, 'work_taken_back', 'withdrawn', 'taken back'],
    ] as const) {
      const at = momentOf(made.worker, (event) => event.type === row, `${row} row`)
      const giver = host.whatToCallTheConversation(made.pm)
      for (const args of [
        { piece: made.label, close: true },
        { piece: made.label, brief: 'again' },
        { piece: made.label, title: 'mine now' },
      ]) {
        const ended = await refusedAsEnded(made.worker, args)
        expect(ended.reason, `${state} · ${JSON.stringify(args)}`).toBe(
          `${STOP} ${made.label} was ${how} by ${giver} at ${clockTime(at)}, ${NOTHING_CHANGED}`,
        )
        expect(ended.detail, `${state} · ${JSON.stringify(args)}`).toEqual({
          piece: made.piece,
          label: made.label,
          state,
          at,
          called: giver,
          yoursToRetitle: false,
        })
      }
    }
  })

  it('🔴 F090 · work taken on for a person: a close while it is open gets the giver’s words; once answered, how it ended, and that only its title may change — which it does', async () => {
    const pm = await personOpens(`pm-${String(++pairs)}`)
    await host.send(pm, 'Please take on the trip plan.', window)
    const taken = await callOn(pm, 'take_on_work', {
      definition_of_done: 'The requested result and its checks are recorded.',
      title: 'Plan the trip',
      brief: 'plan the trip',
    })
    expect(taken.outcome, JSON.stringify(taken)).toBe('ok')
    const piece = taken.piece as string
    const label = taken.label as string
    // ⚑ Open: no conversation gave it, so none closes it — its owner asks, sets its status line,
    // keeps files or hands it back, each of which an open piece takes.
    expect(await callOn(pm, 'update_work', { piece: label, close: true })).toMatchObject({
      outcome: 'refused',
      rail: 'the-giver-briefs-and-closes-a-piece',
    })
    expect(
      (await callOn(pm, 'reply_to_parent', { piece: label, outcome: 'done', summary: 'planned' }))
        .outcome,
    ).toBe('ok')
    const at = momentOf(pm, (event) => event.type === 'work_replied', 'work_replied row')
    for (const args of [
      { piece: label, close: true },
      { piece: label, brief: 'plan it again' },
    ]) {
      const ended = await refusedAsEnded(pm, args)
      expect(ended.reason, JSON.stringify(args)).toBe(
        `${ONLY_THE_TITLE} You answered ${label} at ${clockTime(at)}, ${NOTHING_CHANGED}`,
      )
      expect(ended.detail, JSON.stringify(args)).toEqual({
        piece,
        label,
        state: 'answered',
        at,
        endedByYou: true,
        yoursToRetitle: true,
      })
    }
    // ⚑ …and the one change it names is taken.
    const renamed = await callOn(pm, 'update_work', { piece: label, title: 'The trip, planned' })
    expect(renamed.outcome, JSON.stringify(renamed)).toBe('ok')
    expect(pieceOf(pm, piece)).toMatchObject({ state: 'answered', title: 'The trip, planned' })
  })
})
