import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { FakeProviderSessions } from '@brobot2/runtime'
import type { FakeSessionHandle } from '@brobot2/runtime'
import type { Provider } from '@brobot2/shared'
import { type AppDatabase, openDatabase } from '../src/main/db/connection'
import { applyMigrations } from '../src/main/db/migrate'
import { createSessionStore, type SessionStore } from '../src/main/db/session-store'
import { NO_DISCOVERY } from '../src/main/adopt/discover-sessions'
import { RuntimeHost } from './helpers/giver-notice-host'
import type { RuntimeEventSink } from './helpers/giver-notice-host'
import { agentToolsFor, type ToolName } from '../src/main/runtime/agent-tools'
import * as rails from '../src/main/runtime/reply-rails'
import { resolveSessionCwd } from '../src/main/runtime/scratch-cwd'
import { PIECE_TITLE_CHARS } from '../src/shared/piece-called'
import { TASK_IS_OPEN, type TaskState } from '../src/shared/tasks'
import type {
  RuntimeEventMessage,
  TranscriptEvent,
  WorkRetitledEvent,
  WorkStatusSetEvent,
} from '../src/shared/runtime-ipc'
import { ProviderDouble, anOpenGate, type ResumeGate } from './lib/provider-double'

/**
 * # 🔴 D-016 · a root is titled, and a piece says where it stands
 *
 * `update_work` is the one door that names a piece or says where it stands (plan ruling 7), and
 * `list_tasks` is where both are read back: the board (no argument) and one piece's record. This
 * file pins the door and both readers, on the real host, the real SQLite ledger and the real tools.
 *
 *  - **T1–T2 · a root** has no row a fold reads (R1), so its title and status line are read straight
 *    off the ledger by `SessionStore.rootLines`: the NEWEST of each stands, and setting one never
 *    hides the other.
 *  - **T3–T5 · who may do what**: the giver names a piece and its owner may not; either sets a
 *    status; an ended piece takes no status but still takes a title; a stranger — or the worker on
 *    the manager's root — is told *no such piece*, in the very words for a piece that does not
 *    exist, so a label is no oracle.
 *  - **T6** the fold: a title set while a piece was open survives its answer, and the answer's
 *    summary becomes its status line.
 *  - **T7** a torn `work_retitled` / `work_status_set` row is passed over.
 *  - **T8–T9** the door's own argument rules: no piece means the ONE held that has reached the
 *    caller (D-022 · R4: a piece whose give still waits does not count, so two held with one waiting
 *    is one; two that have reached it are malformed and named both); a line is trimmed and bounded,
 *    and a blank one is refused.
 *  - **T10** the labels: consecutive roots, a grandchild `W<n>.1.1`, a piece found by label or id.
 *
 * ⚠️ **The bounds are written as literals** (`1280`, `200`) beside the constants they mirror, for
 * `REPLY_SUMMARY_LIMIT`'s own reason: a test that computes `LIMIT + 1` moves with a mutated limit
 * and pins nothing.
 *
 * ⚑ **One provider shape**: nothing here resumes a conversation, so the Claude shape's
 * silent-until-its-first-turn resume would run the same run twice.
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

type Row = Record<string, unknown>

/** The status line as a payload carries it. */
interface Line {
  readonly text: string
  readonly by: string
  readonly at: number
}

describe('D-016 · a root is titled, and a piece says where it stands', () => {
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
  let gate: ResumeGate
  const tick = (): number => clock++

  const buildHost = (): RuntimeHost => {
    const built = new RuntimeHost({
      store,
      discoverSessions: NO_DISCOVERY,
      nativeTranscriptPath: () => null,
      exportDirectory: () => join(userData, 'exports'),
      createRuntime: (provider: Provider) => new ProviderDouble(provider, handles, issued, gate),
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
    userData = mkdtempSync(join(tmpdir(), 'brobot2-root-titled-'))
    root = mkdtempSync(join(tmpdir(), 'brobot2-root-titled-root-'))
    db = openDatabase(join(userData, 'brobot2.sqlite'))
    applyMigrations(db, migrationsFolder)
    clock = 8_160_000
    store = createSessionStore(db, tick)
    counter = 0
    hosts = []
    handles = []
    issued = new FakeProviderSessions()
    gate = anOpenGate()
    host = buildHost()
    window = new RecordingSink('webContents:1')
  })

  afterEach(async () => {
    for (const built of hosts) await built.closeAll()
    db.close()
    for (const dir of [userData, root]) rmSync(dir, { recursive: true, force: true })
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

  /** ⚑ A real macrotask pause, so a negative is measured after whatever was queued has run. */
  const letItSettle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 50))

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

  const callOn = async (
    caller: string,
    name: ToolName,
    args: Record<string, unknown> = {},
  ): Promise<Record<string, unknown>> => {
    const tool = agentToolsFor(host, caller).tools.find((one) => one.name === name)
    if (tool === undefined) throw new Error(`no such tool: ${name}`)
    return (await tool.call(args)).structured as Record<string, unknown>
  }

  const cardsOn = (id: string): number =>
    events(id).filter((event) => event.type === 'permission_request').length

  /**
   * ⚑ **In ONE app run, a worker parked mid-turn on the work its parent gave it**, with a person's
   * window on it — `724`'s rig. The give starts the worker's conversation, and its brief is that
   * conversation's first turn, which parks on its card, so the piece is open while the tests run.
   */
  const aPmAndItsWorker = async (): Promise<{
    pm: string
    worker: string
    piece: string
    label: string
  }> => {
    await host.close(await personOpens('worker'), window)
    const pm = await personOpens('pm')
    const given = await callOn(pm, 'give_work', {
      definition_of_done: 'The requested result and its checks are recorded.',
      profile: 'worker',
      title: 'the work',
      brief: 'migrate',
    })
    expect(given.outcome, JSON.stringify(given)).toBe('ok')
    const worker = given.agent as string
    host.claimSession(worker, window)
    await waitFor(() => cardsOn(worker) > 0, 'the worker to park mid-turn')
    const piece = store.piecesOwnedBy(worker)[0]
    if (piece === undefined) throw new Error('no piece')
    expect(piece.piece).toBe(given.piece)
    return { pm, worker, piece: piece.piece, label: piece.label }
  }

  const theRootOf = (conversation: string): { piece: string; label: string } => {
    const found = store.rootOf(conversation)
    if (found === null) throw new Error(`${conversation} owns no root`)
    return found
  }

  const numberOfARoot = (label: string): number => Number(label.replace(/^W/, ''))

  /** ⚑ The rows `list_tasks` hands a conversation for what it holds — its root first, when it owns one. */
  const heldOnTheBoard = async (id: string): Promise<Row[]> =>
    ((await callOn(id, 'list_tasks', { state: 'all' })) as { you_hold: Row[] }).you_hold

  const gaveOnTheBoard = async (id: string): Promise<Row[]> =>
    ((await callOn(id, 'list_tasks', { state: 'all' })) as { you_gave: Row[] }).you_gave

  /** ⚑ The ROOT's entry on the board — the one row that carries `root: true`. */
  const rootOnTheBoard = async (id: string): Promise<Row> => {
    const found = (await heldOnTheBoard(id)).find((row) => row.root === true)
    if (found === undefined) throw new Error(`${id}'s board has no root entry`)
    return found
  }

  /** ⚑ A piece as its OWNER's board holds it. */
  const pieceHeld = async (owner: string, piece: string): Promise<Row> => {
    const found = (await heldOnTheBoard(owner)).find((row) => row.piece === piece)
    if (found === undefined) throw new Error(`${owner}'s board does not hold ${piece}`)
    return found
  }

  /** ⚑ A piece as its GIVER's board holds it. */
  const pieceGave = async (giver: string, piece: string): Promise<Row> => {
    const found = (await gaveOnTheBoard(giver)).find((row) => row.piece === piece)
    if (found === undefined) throw new Error(`${giver}'s board does not list ${piece}`)
    return found
  }

  const recordOf = (caller: string, piece: string): Promise<Row> =>
    callOn(caller, 'list_tasks', { piece })

  /** ⚑ A conversation's own ledger rows of one kind, oldest first. */
  function linesIn(id: string, type: 'work_retitled'): WorkRetitledEvent[]
  function linesIn(id: string, type: 'work_status_set'): WorkStatusSetEvent[]
  function linesIn(id: string, type: 'work_retitled' | 'work_status_set'): TranscriptEvent[] {
    return events(id).filter((event) => event.type === type)
  }

  /** ⚑ Every title and status line ever written, in EVERY ledger. */
  const linesWrittenAnywhere = (): number =>
    (
      db
        .prepare(
          `SELECT count(*) AS n FROM events WHERE type IN ('work_retitled', 'work_status_set')`,
        )
        .get() as { n: number }
    ).n

  /** ⚑ What a message would leave in a ledger — none of it may appear because a line was set. */
  const messagesIn = (id: string): string[] =>
    events(id)
      .map((event) => event.type)
      .filter((type) =>
        ['message_queued', 'message_unqueued', 'message_sent', 'user_turn'].includes(type),
      )

  const lineOf = (row: Row): Line | null => row.status_line as Line | null

  // ─────────────────────────────────────────────────────────────────────────────
  // T1–T2 · a root
  // ─────────────────────────────────────────────────────────────────────────────

  describe('a root — the work a person gave a conversation', () => {
    it('a root’s owner titles it and says where it stands, and the board and the record read both', async () => {
      const pm = await personOpens('pm')
      const mine = theRootOf(pm)

      // ⚑ The premise, read once BEFORE: the same entry says nothing yet, so the reads below are not
      // vacuous. ⛔ A root's entry carries no state (R1).
      const before = await rootOnTheBoard(pm)
      expect(before).toMatchObject({
        piece: mine.piece,
        label: mine.label,
        title: null,
        status_line: null,
        root: true,
      })
      expect(before).not.toHaveProperty('state')
      expect(linesWrittenAnywhere()).toBe(0)

      // ⚑ No piece named: the one it holds — its root — and both lines padded, to prove the trim.
      const said = await callOn(pm, 'update_work', {
        title: '  Ship the tree  ',
        status: '  two of three done  ',
      })
      expect(said).toMatchObject({
        outcome: 'ok',
        piece: mine.piece,
        label: mine.label,
        title: 'Ship the tree',
        status: 'two of three done',
      })

      // ⚑ The board's entry for the root — first among what it holds.
      const entry = (await heldOnTheBoard(pm))[0]
      expect(entry).toMatchObject({ piece: mine.piece, root: true, title: 'Ship the tree' })
      expect(lineOf(entry ?? {})).toMatchObject({ text: 'two of three done', by: pm })
      expect(typeof lineOf(entry ?? {})?.at).toBe('number')

      // ⚑ The record: a root is its title, its status line and its children — and the same words.
      const record = await recordOf(pm, mine.label)
      expect(record).toMatchObject({
        outcome: 'ok',
        piece: mine.piece,
        label: mine.label,
        root: true,
        owner: pm,
        title: 'Ship the tree',
        children: [],
      })
      expect(lineOf(record)).toMatchObject({ text: 'two of three done', by: pm })
      expect(record).not.toHaveProperty('state')
      expect(host.pieceRecord(pm, mine.label).is).toBe('a-root')

      // ⚑ Both rows are in the PM's OWN ledger — a root's owner is the PM, and nobody else has one.
      expect(linesIn(pm, 'work_retitled')).toMatchObject([
        { piece: mine.piece, title: 'Ship the tree', by: pm },
      ])
      expect(linesIn(pm, 'work_status_set')).toMatchObject([
        { piece: mine.piece, line: 'two of three done', by: pm },
      ])
    })

    it('the newest title and the newest status stand, and neither hides the other', async () => {
      const pm = await personOpens('pm')
      const mine = theRootOf(pm)
      const read = async (): Promise<{ board: Row; record: Row }> => ({
        board: await rootOnTheBoard(pm),
        record: await recordOf(pm, mine.label),
      })

      expect((await callOn(pm, 'update_work', { title: 'First', status: 'one' })).outcome).toBe(
        'ok',
      )
      // ⚑ The first read proves the reads see the rows at all.
      let seen = await read()
      for (const one of [seen.board, seen.record]) {
        expect(one.title).toBe('First')
        expect(lineOf(one)?.text).toBe('one')
      }

      // ⚑ A title alone: the newest title stands and the status line is still the one before.
      expect((await callOn(pm, 'update_work', { title: 'Second' })).outcome).toBe('ok')
      seen = await read()
      for (const one of [seen.board, seen.record]) {
        expect(one.title).toBe('Second')
        expect(lineOf(one)?.text).toBe('one')
      }

      // ⚑ A status alone: the newest line stands and the title is still the one before.
      expect((await callOn(pm, 'update_work', { status: 'two' })).outcome).toBe('ok')
      seen = await read()
      for (const one of [seen.board, seen.record]) {
        expect(one.title).toBe('Second')
        expect(lineOf(one)?.text).toBe('two')
      }
      // ⚑ …and every line was kept: the ledger holds all of them, oldest first.
      expect(linesIn(pm, 'work_retitled').map((one) => one.title)).toEqual(['First', 'Second'])
      expect(linesIn(pm, 'work_status_set').map((one) => one.line)).toEqual(['one', 'two'])
    })
  })

  // ─────────────────────────────────────────────────────────────────────────────
  // T3–T5 · who may do what
  // ─────────────────────────────────────────────────────────────────────────────

  describe('a piece — who may name it and who may say where it stands', () => {
    it('the giver names a piece and its owner cannot, and either may say where it stands', async () => {
      const { pm, worker, piece, label } = await aPmAndItsWorker()
      const handlesBefore = handles.length
      const messagesBefore = { pm: messagesIn(pm), worker: messagesIn(worker) }

      // ⛔ The owner may not retitle a piece it was given — the giver names the work.
      const refused = await callOn(worker, 'update_work', { piece: label, title: 'mine' })
      expect(refused.outcome, JSON.stringify(refused)).toBe('refused')
      expect(refused.rail).toBe('the-giver-names-a-piece')
      expect(refused.detail).toMatchObject({ piece, label })
      expect(linesIn(worker, 'work_retitled')).toHaveLength(0)
      expect(linesWrittenAnywhere()).toBe(0)
      expect((await pieceHeld(worker, piece)).title).toBe('the work')

      // ⚑ The paired positive: the giver's title call succeeds against the same piece.
      const renamed = await callOn(pm, 'update_work', { piece: label, title: 'Renamed by giver' })
      expect(renamed).toMatchObject({ outcome: 'ok', piece, label, title: 'Renamed by giver' })
      expect((await pieceGave(pm, piece)).title).toBe('Renamed by giver')
      expect((await pieceHeld(worker, piece)).title).toBe('Renamed by giver')
      // ⚑ Written into the OWNER's ledger, and by the giver.
      expect(linesIn(worker, 'work_retitled')).toMatchObject([
        { piece, title: 'Renamed by giver', by: pm },
      ])
      expect(linesIn(pm, 'work_retitled')).toHaveLength(0)

      // ⚑ Either may say where it stands, and the line names who said it.
      expect(
        await callOn(worker, 'update_work', { piece: label, status: 'from worker' }),
      ).toMatchObject({ outcome: 'ok', piece, status: 'from worker' })
      expect(lineOf(await pieceGave(pm, piece))).toMatchObject({ text: 'from worker', by: worker })
      expect(await callOn(pm, 'update_work', { piece: label, status: 'from giver' })).toMatchObject(
        { outcome: 'ok', piece, status: 'from giver' },
      )
      expect(lineOf(await pieceGave(pm, piece))).toMatchObject({ text: 'from giver', by: pm })
      expect(lineOf(await pieceHeld(worker, piece))).toMatchObject({ text: 'from giver', by: pm })
      expect(linesIn(worker, 'work_status_set').map((one) => [one.line, one.by])).toEqual([
        ['from worker', worker],
        ['from giver', pm],
      ])

      // ⛔ Nothing is sent and nobody is woken: no message row in either ledger, no new turn for
      // the worker's provider handle.
      await letItSettle()
      expect({ pm: messagesIn(pm), worker: messagesIn(worker) }).toEqual(messagesBefore)
      expect(handles).toHaveLength(handlesBefore)
    })

    it('a piece that has answered cannot be given a status, may still be titled, and its reply’s words are its status', async () => {
      const { pm, worker, piece, label } = await aPmAndItsWorker()

      // ⚑ Open: the status is taken.
      expect(
        await callOn(worker, 'update_work', { piece: label, status: 'halfway' }),
      ).toMatchObject({ outcome: 'ok', status: 'halfway' })
      const open = await pieceGave(pm, piece)
      expect(TASK_IS_OPEN[open.state as TaskState]).toBe(true)
      expect(lineOf(open)).toMatchObject({ text: 'halfway', by: worker })

      // ⚑ The worker answers: the piece is answered and the reply's summary IS its status line.
      expect(
        await callOn(worker, 'reply_to_parent', {
          piece,
          outcome: 'done',
          summary: 'all done here',
        }),
      ).toMatchObject({ outcome: 'ok' })
      await letItSettle()
      const answered = await pieceGave(pm, piece)
      expect(answered.state).toBe('answered')
      // ⚑ A piece that is over is a line on the board; its record carries its status line.
      expect(lineOf(await recordOf(pm, label))).toMatchObject({ text: 'all done here', by: worker })

      // ⛔ The reply is its last word: a status after the end is refused, and changes nothing.
      const late = await callOn(worker, 'update_work', { piece: label, status: 'late' })
      expect(late.outcome, JSON.stringify(late)).toBe('refused')
      expect(late.rail).toBe('that-piece-has-ended')
      expect(late.detail).toMatchObject({ piece, label, state: 'answered' })
      expect(lineOf(await recordOf(pm, label))).toMatchObject({
        text: 'all done here',
        by: worker,
      })
      // …and the giver's status is refused the same way.
      expect((await callOn(pm, 'update_work', { piece: label, status: 'late' })).rail).toBe(
        'that-piece-has-ended',
      )

      // ⚑ The paired positive: a TITLE on the ended piece is allowed, and the status is untouched.
      expect(
        await callOn(pm, 'update_work', { piece: label, title: 'Renamed after the end' }),
      ).toMatchObject({ outcome: 'ok', title: 'Renamed after the end' })
      const after = await pieceGave(pm, piece)
      expect(after).toMatchObject({ state: 'answered', title: 'Renamed after the end' })
      expect(lineOf(await recordOf(pm, label))).toMatchObject({ text: 'all done here', by: worker })
    })

    it('a stranger, or the worker on the manager’s root, is told there is no such piece - the same words as for a piece that does not exist - and nothing is written', async () => {
      const { pm, worker, piece, label } = await aPmAndItsWorker()
      const stranger = await personOpens('stranger')
      const managersRoot = theRootOf(pm).label
      const nobodys = 'W999'
      expect(store.workByLabel(nobodys)).toBeNull()

      // ⚑ The words for a name that names nothing — what every other refusal below must equal.
      const noSuchUpdate = await callOn(pm, 'update_work', { piece: nobodys, status: 'x' })
      expect(noSuchUpdate.outcome, JSON.stringify(noSuchUpdate)).toBe('refused')
      expect(noSuchUpdate.rail).toBe('no-piece-by-that-name')
      const noSuchRecord = await recordOf(pm, nobodys)
      expect(noSuchRecord.outcome, JSON.stringify(noSuchRecord)).toBe('refused')
      expect(noSuchRecord.rail).toBe('no-piece-by-that-name')

      const forbidden: [string, string, string][] = [
        ['a stranger on the piece', stranger, label],
        ['a stranger on the root', stranger, managersRoot],
        ['the worker on the manager’s root', worker, managersRoot],
        ['a stranger on a name that names nothing', stranger, nobodys],
        ['the worker on a name that names nothing', worker, nobodys],
      ]
      for (const [who, caller, spelled] of forbidden) {
        const updated = await callOn(caller, 'update_work', { piece: spelled, status: 'x' })
        expect(updated, `update_work · ${who}`).toEqual({
          ...noSuchUpdate,
          detail: { piece: spelled },
        })
        const read = await recordOf(caller, spelled)
        expect(read, `list_tasks · ${who}`).toEqual({
          ...noSuchRecord,
          detail: { piece: spelled },
        })
      }
      // ⚑ A title is refused the same way — it is the entitlement that is asked first.
      expect(await callOn(stranger, 'update_work', { piece: label, title: 'mine now' })).toEqual({
        ...noSuchUpdate,
        detail: { piece: label },
      })

      // ⛔ Nothing was written into ANY ledger.
      expect(linesWrittenAnywhere()).toBe(0)
      expect((await pieceGave(pm, piece)).title).toBe('the work')
      expect((await rootOnTheBoard(pm)).status_line).toBeNull()

      // ⚑ The paired positives, for the same calls: the root's owner, the piece's owner and its
      // giver are each answered — and the counter above reads what they wrote.
      expect(
        await callOn(pm, 'update_work', { piece: managersRoot, status: 'the root' }),
      ).toMatchObject({ outcome: 'ok' })
      expect(
        await callOn(worker, 'update_work', { piece: label, status: 'the owner' }),
      ).toMatchObject({ outcome: 'ok' })
      expect(await callOn(pm, 'update_work', { piece: label, status: 'the giver' })).toMatchObject({
        outcome: 'ok',
      })
      expect(linesWrittenAnywhere()).toBe(3)
      expect(await recordOf(pm, managersRoot)).toMatchObject({ outcome: 'ok', root: true })
      // ⚠️ A PIECE's record spreads the piece's own payload over `outcome: 'ok'`, so its `outcome` is
      // the piece's answer (`null` while it is open): a hit is read as a `piece` and no `rail`.
      for (const caller of [worker, pm]) {
        const hit = await recordOf(caller, label)
        expect(hit).toMatchObject({ piece, label })
        expect(hit).not.toHaveProperty('rail')
      }
    })
  })

  // ─────────────────────────────────────────────────────────────────────────────
  // T6 · the fold
  // ─────────────────────────────────────────────────────────────────────────────

  describe('a piece — the fold', () => {
    it('a title set while the piece was open survives its answer', async () => {
      const { pm, worker, piece, label } = await aPmAndItsWorker()
      expect((await callOn(pm, 'update_work', { piece: label, title: 'Kept title' })).outcome).toBe(
        'ok',
      )
      expect(
        (await callOn(worker, 'update_work', { piece: label, status: 'in progress' })).outcome,
      ).toBe('ok')

      // ⚑ The premise, read BEFORE the answer: open, with both lines.
      const before = await pieceGave(pm, piece)
      expect(TASK_IS_OPEN[before.state as TaskState]).toBe(true)
      expect(before.title).toBe('Kept title')
      expect(lineOf(before)?.text).toBe('in progress')

      expect(
        await callOn(worker, 'reply_to_parent', {
          piece,
          outcome: 'done',
          summary: 'finished the migration',
        }),
      ).toMatchObject({ outcome: 'ok' })
      await letItSettle()

      // ⚑ Answered — and the title set while it was open is still its title. ⛔ The fold re-sets the
      // open entry on a retitle: a stale one would settle the row without it.
      const board = await pieceGave(pm, piece)
      const record = await recordOf(pm, label)
      for (const one of [board, record]) {
        expect(one.state).toBe('answered')
        expect(one.title).toBe('Kept title')
      }
      // ⚑ The reply's summary is the line now, not what the owner said while it worked — on its
      // record: a piece that is over is a line on the board, without its answer's words.
      expect(lineOf(record)).toMatchObject({ text: 'finished the migration', by: worker })
      expect((await pieceHeld(worker, piece)).title).toBe('Kept title')
    })

    it('a torn title or status line is passed over and the good lines still read', async () => {
      const pm = await personOpens('pm')
      const mine = theRootOf(pm)
      const read = async (): Promise<{ board: Row; record: Row }> => ({
        board: await rootOnTheBoard(pm),
        record: await recordOf(pm, mine.label),
      })
      expect(
        (await callOn(pm, 'update_work', { title: 'Good', status: 'good line' })).outcome,
      ).toBe('ok')

      // ⚑ The control, before anything is torn.
      const good = await read()
      for (const one of [good.board, good.record]) {
        expect(one.title).toBe('Good')
        expect(lineOf(one)?.text).toBe('good line')
      }

      // ⛔ Two rows that are not JSON at all, NEWER than the good ones (a high ordinal, well above
      // the live conversation's own counter, so nothing it writes next can collide with them).
      for (const [index, type] of ['work_retitled', 'work_status_set'].entries()) {
        db.prepare(
          `INSERT INTO events (id, session_id, generation, ordinal, type, payload, created_at)
           VALUES (?, ?, 0, ?, ?, '{not json', ?)`,
        ).run(`evt_torn_${type}`, pm, 900_000 + index, type, tick())
      }
      const torn = db
        .prepare(
          `SELECT count(*) AS n FROM events
            WHERE session_id = ? AND type IN ('work_retitled', 'work_status_set')
              AND NOT json_valid(payload)`,
        )
        .get(pm) as { n: number }
      expect(torn.n).toBe(2)

      const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
      const error = vi.spyOn(console, 'error').mockImplementation(() => undefined)
      try {
        // ⚑ Neither read throws, and the older good rows stand.
        const after = await read()
        for (const one of [after.board, after.record]) {
          expect(one.outcome ?? 'ok').toBe('ok')
          expect(one.title).toBe('Good')
          expect(lineOf(one)?.text).toBe('good line')
        }

        // ⚑ …and a valid newer line still replaces them: the reader has not gone blind to the root.
        expect(
          (await callOn(pm, 'update_work', { title: 'Better', status: 'better line' })).outcome,
        ).toBe('ok')
        const newer = await read()
        for (const one of [newer.board, newer.record]) {
          expect(one.title).toBe('Better')
          expect(lineOf(one)?.text).toBe('better line')
        }
      } finally {
        warn.mockRestore()
        error.mockRestore()
      }
    })
  })

  // ─────────────────────────────────────────────────────────────────────────────
  // T8–T9 · the door's own argument rules
  // ─────────────────────────────────────────────────────────────────────────────

  describe('the door’s arguments', () => {
    it('with no piece named it means the one piece held; two held is malformed and names both', async () => {
      // (a) A root only: the one it holds is its root.
      const alone = await personOpens('alone')
      const aloneRoot = theRootOf(alone)
      expect(await callOn(alone, 'update_work', { status: 'solo' })).toMatchObject({
        outcome: 'ok',
        piece: aloneRoot.piece,
        label: aloneRoot.label,
      })
      expect(lineOf(await rootOnTheBoard(alone))).toMatchObject({ text: 'solo', by: alone })

      // (b) A worker that holds exactly one piece: the piece. And the giver, which holds its root
      // and GAVE one, means its root — a piece it gave is not one it holds.
      const { pm, worker, piece, label } = await aPmAndItsWorker()
      expect(await callOn(worker, 'update_work', { status: 'mine' })).toMatchObject({
        outcome: 'ok',
        piece,
        label,
      })
      expect(lineOf(await pieceHeld(worker, piece))).toMatchObject({ text: 'mine', by: worker })
      const managersRoot = theRootOf(pm)
      expect(await callOn(pm, 'update_work', { status: 'the root line' })).toMatchObject({
        outcome: 'ok',
        piece: managersRoot.piece,
        label: managersRoot.label,
      })
      expect(lineOf(await rootOnTheBoard(pm))?.text).toBe('the root line')
      expect(lineOf(await pieceHeld(worker, piece))?.text).toBe('mine')

      // (c) The worker is given a SECOND piece, held behind the first: it holds two.
      const second = await callOn(pm, 'give_work', {
        definition_of_done: 'The requested result and its checks are recorded.',
        profile: 'worker',
        title: 'the second thing',
        brief: 'and the backups',
      })
      expect(second.outcome, JSON.stringify(second)).toBe('ok')
      expect(second.agent).toBe(worker)
      expect(second.delivery).toBe('held')
      const secondPiece = second.piece as string
      const secondLabel = second.label as string
      expect(secondLabel).not.toBe(label)

      // ⚑ **D-022 · R4 — the control: a piece whose give still waits has not reached the worker**, so
      // it holds two and means one. The bare call is admitted and lands on the first piece, the one
      // that has reached it, and the held one is untouched.
      const meaning = await callOn(worker, 'update_work', { status: 'the first, alone' })
      expect(meaning).toMatchObject({ outcome: 'ok', piece, label })
      expect(lineOf(await pieceHeld(worker, piece))).toMatchObject({ text: 'the first, alone' })
      expect(lineOf(await pieceHeld(worker, secondPiece))).toBeNull()

      // ⚑ Its turn is answered, so the held brief goes out as the next one: both have reached it.
      const firstCard = events(worker).find((event) => event.type === 'permission_request')
      if (firstCard === undefined) throw new Error('the worker raised no card')
      await host.respondPermission(worker, firstCard.id, { outcome: 'allow' }, window)
      await waitFor(() => cardsOn(worker) > 1, 'the second brief to reach the worker and park')
      const written = linesIn(worker, 'work_status_set').length

      const bare = await callOn(worker, 'update_work', { status: 'which one?' })
      expect(bare.outcome, JSON.stringify(bare)).toBe('refused')
      expect(bare.rail).toBe('malformed-request')
      const problems = (bare.detail as { problems: string[] }).problems
      expect(problems).toHaveLength(1)
      expect(problems[0]).toContain('you hold more than one')
      expect(problems[0]).toContain(label)
      expect(problems[0]).toContain(secondLabel)
      expect(linesIn(worker, 'work_status_set')).toHaveLength(written)

      // ⚑ The paired positive: naming one of the two succeeds where the bare call was refused, and
      // updates that one only.
      expect(
        await callOn(worker, 'update_work', { piece: secondLabel, status: 'the second' }),
      ).toMatchObject({ outcome: 'ok', piece: secondPiece, label: secondLabel })
      expect(lineOf(await pieceHeld(worker, secondPiece))).toMatchObject({ text: 'the second' })
      expect(lineOf(await pieceHeld(worker, piece))?.text).toBe('the first, alone')
    })

    it('the title and the status are trimmed and bounded, and blank is refused', async () => {
      // ⚑ The bounds, as literals beside the constants they mirror.
      expect(PIECE_TITLE_CHARS).toBe(200)
      expect(rails.REPLY_SUMMARY_LIMIT).toBe(1280)

      const pm = await personOpens('pm')
      const mine = theRootOf(pm)
      const stands = async (): Promise<{ title: unknown; status: unknown }> => {
        const entry = await rootOnTheBoard(pm)
        return { title: entry.title, status: lineOf(entry)?.text ?? null }
      }
      const malformed = (answer: Record<string, unknown>, what: string): void => {
        expect(answer.outcome, what).toBe('refused')
        expect(answer.rail, what).toBe('malformed-request')
      }

      // ⚑ Exactly the title bound is accepted — measured AFTER the trim, so padding does not count.
      const longestTitle = 'a'.repeat(200)
      expect(await callOn(pm, 'update_work', { title: ` ${longestTitle} ` })).toMatchObject({
        outcome: 'ok',
        title: longestTitle,
      })
      expect((await stands()).title).toBe(longestTitle)
      // ⛔ …and one over is refused, right beside it, changing nothing.
      malformed(await callOn(pm, 'update_work', { title: 'a'.repeat(201) }), '201-character title')
      expect((await stands()).title).toBe(longestTitle)

      // ⚑ Exactly the status bound is accepted…
      const longestLine = 'b'.repeat(1280)
      expect(await callOn(pm, 'update_work', { status: longestLine })).toMatchObject({
        outcome: 'ok',
        status: longestLine,
      })
      expect((await stands()).status).toBe(longestLine)
      // ⛔ …and one over is refused.
      malformed(await callOn(pm, 'update_work', { status: 'b'.repeat(1281) }), '1281-char status')
      expect((await stands()).status).toBe(longestLine)

      // ⛔ Blank is none: a title of spaces, an empty status, and neither at all.
      malformed(await callOn(pm, 'update_work', { title: '   ' }), 'blank title')
      malformed(await callOn(pm, 'update_work', { status: '' }), 'empty status')
      malformed(await callOn(pm, 'update_work', {}), 'neither title nor status')
      expect(await stands()).toEqual({ title: longestTitle, status: longestLine })

      // ⚑ The stored lines are the two accepted ones and nothing else.
      expect(linesIn(pm, 'work_retitled').map((one) => one.title)).toEqual([longestTitle])
      expect(linesIn(pm, 'work_status_set').map((one) => one.line)).toEqual([longestLine])
      expect(mine.label).toBe(theRootOf(pm).label)
    })
  })

  // ─────────────────────────────────────────────────────────────────────────────
  // T10 · the labels
  // ─────────────────────────────────────────────────────────────────────────────

  describe('the labels', () => {
    it('root labels are consecutive, a grandchild is W_n.1.1, and a piece is found by its label or its id', async () => {
      // ⚑ Two conversations nobody started, opened one after the other: consecutive roots.
      const firstRoot = theRootOf(await personOpens('first'))
      const secondRoot = theRootOf(await personOpens('second'))
      expect(firstRoot.label).toMatch(/^W\d+$/)
      expect(secondRoot.label).toMatch(/^W\d+$/)
      expect(numberOfARoot(secondRoot.label)).toBe(numberOfARoot(firstRoot.label) + 1)

      // ⚑ BroBot → Ada → Ali, through the real give door: each hop's brief is the child's first
      // turn, and in `auto` it ENDS rather than parking on a card.
      await host.close(await personOpens('middle'), window)
      await host.close(await personOpens('leaf'), window)
      const brobot = await personOpens('brobot', 'auto')
      const givenAda = await callOn(brobot, 'give_work', {
        definition_of_done: 'The requested result and its checks are recorded.',
        profile: 'middle',
        title: 'run the front-end work',
        brief: 'run the front-end work',
      })
      expect(givenAda.outcome, JSON.stringify(givenAda)).toBe('ok')
      const ada = givenAda.agent as string
      const givenAli = await callOn(ada, 'give_work', {
        definition_of_done: 'The requested result and its checks are recorded.',
        profile: 'leaf',
        title: 'build the world-clock page',
        brief: 'build the world-clock page',
      })
      expect(givenAli.outcome, JSON.stringify(givenAli)).toBe('ok')
      const ali = givenAli.agent as string
      await waitFor(
        () => events(ali).some((event) => event.type === 'turn'),
        'Ali’s brief to run and end',
      )

      // ⚑ The labels: the root, the child under it, the grandchild under the child.
      const brobotsRoot = theRootOf(brobot)
      const adasPiece = store.piecesOwnedBy(ada)[0]
      const alisPiece = store.piecesOwnedBy(ali)[0]
      if (adasPiece === undefined || alisPiece === undefined) throw new Error('no piece was given')
      expect(adasPiece.label).toBe(`${brobotsRoot.label}.1`)
      expect(alisPiece.label).toBe(`${adasPiece.label}.1`)
      expect(alisPiece.label).toBe(`${brobotsRoot.label}.1.1`)
      expect(alisPiece.parent).toBe(adasPiece.piece)
      expect(adasPiece.parent).toBe(brobotsRoot.piece)
      expect(givenAli.label).toBe(alisPiece.label)

      // ⚑ Found by its label or its id — the same record — for its owner and for its giver.
      for (const [who, caller] of [
        ['its owner', ali],
        ['its giver', ada],
      ] as const) {
        const byLabel = await recordOf(caller, alisPiece.label)
        const byId = await recordOf(caller, alisPiece.piece)
        expect(byLabel, who).toMatchObject({ piece: alisPiece.piece, label: alisPiece.label })
        expect(byLabel, who).not.toHaveProperty('rail')
        expect(byId, who).toEqual(byLabel)
      }
      // …and the child's record, by either spelling, for the conversation that gave it.
      const adasByLabel = await recordOf(brobot, adasPiece.label)
      expect(adasByLabel).toMatchObject({ piece: adasPiece.piece, label: adasPiece.label })
      expect(adasByLabel).not.toHaveProperty('rail')
      expect(await recordOf(brobot, adasPiece.piece)).toEqual(adasByLabel)

      // ⚑ The paired positive: the same lookup by a label nobody was given is no such piece.
      const wrong = await recordOf(ada, `${adasPiece.label}.9`)
      expect(wrong.outcome, JSON.stringify(wrong)).toBe('refused')
      expect(wrong.rail).toBe('no-piece-by-that-name')
      expect((await recordOf(ali, `${brobotsRoot.label}.9`)).rail).toBe('no-piece-by-that-name')
    })
  })
})
