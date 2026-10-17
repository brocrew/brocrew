import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AuthUnavailableError, FakeProviderSessions, ResumeError } from '@brobot2/runtime'
import type { FakeSessionHandle } from '@brobot2/runtime'
import type { Provider } from '@brobot2/shared'
import { type AppDatabase, openDatabase } from '../src/main/db/connection'
import { applyMigrations } from '../src/main/db/migrate'
import { createSessionStore, type SessionStore } from '../src/main/db/session-store'
import { NO_DISCOVERY } from '../src/main/adopt/discover-sessions'
import { RuntimeHost, THE_APP_ITSELF } from '../src/main/runtime/runtime-host'
import type { RuntimeEventSink } from '../src/main/runtime/runtime-host'
import { agentToolsFor, type ToolName } from '../src/main/runtime/agent-tools'
import { resourcesRoot } from '../src/main/resources/resources'
import { resolveSessionCwd } from '../src/main/runtime/scratch-cwd'
import { TASK_IS_OPEN } from '../src/shared/tasks'
import type {
  RuntimeEventMessage,
  TranscriptEvent,
  WorkGivenEvent,
} from '../src/shared/runtime-ipc'
import { ProviderDouble, anOpenGate, type ResumeGate } from './lib/provider-double'

/**
 * # 🔴 D-047 · the giver keeps, in its OWN ledger, the whole brief it gave
 *
 * ⚑ **`71709f76`** — when `give_work` succeeds, and when `update_work` gives a piece a new brief,
 * the host writes a `work_sent` row into the GIVER's ledger, before the call answers: the piece, its
 * label, `as` (`given` or `rebriefed`), `to` (the conversation holding the piece), and the title and
 * brief whole. The give card draws it in place of the arguments, which both adapters cut at 200.
 *
 * ⚑ Over a real `RuntimeHost` and a real ledger, on the Fake provider only (`ProviderDouble`, so a
 * start or a resume can be made to fail at the provider's door).
 *
 * | § | subject | ⛔ paired with |
 * |---|---|---|
 * | 1 | a give that starts a new conversation: one row, seven keys, whole, before the answer | the helper's ledger, which takes the piece and no `work_sent` |
 * | 2 | a give to the conversation it already has: one more row | the first give's row, unchanged |
 * | 3 | a refusal, a failed start and a failed delivery write none | the same give once the failure clears, which writes one |
 * | 4 | a new brief: `as: 'rebriefed'`, the title as it now stands, before the answer | a title, a status, and the owner's own refused brief, which write none |
 *
 * ⚑ The helper runs in its giver's approval mode: `ask`, so its brief's turn parks on the card it
 * raises — busy, and never stalled — and a second give to it is admitted.
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

/** Fresh briefs reach the bound; older ledger entries retain their original longer text. */
const briefSteps = (length: number): string =>
  Array.from(
    { length },
    (_, n) => `Step ${String(n + 1)}: read the part of the code that does this, then change it.`,
  ).join('\n')
const HISTORICAL_BRIEF = briefSteps(40)
const LONG_BRIEF = briefSteps(20).padEnd(2000, '·')
const SECOND_BRIEF =
  `${briefSteps(20)}\nAnd for this one: say what you found in the second table.`.padEnd(1999, 's')
const NEW_BRIEF =
  `${briefSteps(20)}\nAnd one more thing at the very end: say what you found.`.padEnd(2000, 'n')

const TITLE = 'Make the card draw the whole brief'

/** ⚑ The seven keys of the row, and no more — a spread of the give would carry its folder and inputs. */
const SEVEN_KEYS = ['as', 'brief', 'label', 'piece', 'title', 'to', 'type']

describe('D-047 · the giver keeps the whole brief it gave, in its own ledger', () => {
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
  let gate: ResumeGate
  const tick = (): number => clock++

  beforeEach(() => {
    userData = mkdtempSync(join(tmpdir(), 'brobot2-d047-'))
    root = mkdtempSync(join(tmpdir(), 'brobot2-d047-root-'))
    db = openDatabase(join(userData, 'brobot2.sqlite'))
    applyMigrations(db, migrationsFolder)
    clock = 9_470_000
    store = createSessionStore(db, tick)
    counter = 0
    handles = []
    issued = new FakeProviderSessions()
    gate = anOpenGate()
    window = new RecordingSink('webContents:1')
    host = new RuntimeHost({
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
      resourcesRoot: () => resourcesRoot(userData),
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
  })

  afterEach(async () => {
    vi.restoreAllMocks()
    await host.closeAll()
    db.close()
    for (const dir of [userData, root]) rmSync(dir, { recursive: true, force: true })
  })

  // ───────────────────────────────────────────────────────────────────────────────────────────
  // The rig
  // ───────────────────────────────────────────────────────────────────────────────────────────

  const events = (sessionId: string): TranscriptEvent[] =>
    store.events(sessionId).map((entry) => entry.event)

  const rowsOf = <T extends TranscriptEvent['type']>(
    id: string,
    type: T,
  ): Extract<TranscriptEvent, { type: T }>[] =>
    events(id).filter(
      (event): event is Extract<TranscriptEvent, { type: T }> => event.type === type,
    )

  const sentBy = (id: string) => rowsOf(id, 'work_sent')

  const waitFor = async (predicate: () => boolean, what: string): Promise<void> => {
    for (let attempt = 0; attempt < 400; attempt++) {
      if (predicate()) return
      await new Promise((resolve) => setTimeout(resolve, 10))
    }
    throw new Error(`timed out waiting for ${what}`)
  }

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

  /**
   * ⚑ **A call, and how many `work_sent` rows its CALLER's ledger held the moment it answered** —
   * read in the very callback the answer resolves, so a row written after the answer is not counted.
   */
  const callTimed = async (
    caller: string,
    name: ToolName,
    args: Record<string, unknown>,
  ): Promise<{ structured: Record<string, unknown>; text: string; sentWhenItAnswered: number }> => {
    const tool = agentToolsFor(host, caller).tools.find((one) => one.name === name)
    if (tool === undefined) throw new Error(`no such tool: ${name}`)
    return tool.call(args).then((answered) => ({
      structured: answered.structured as Record<string, unknown>,
      text: answered.text,
      sentWhenItAnswered: sentBy(caller).length,
    }))
  }

  const callOn = async (
    caller: string,
    name: ToolName,
    args: Record<string, unknown>,
  ): Promise<Record<string, unknown>> => (await callTimed(caller, name, args)).structured

  const cardsOn = (id: string): number => rowsOf(id, 'permission_request').length

  /** ⚑ A PM a person opened, and `worker`, an identity it can give to. */
  const aPm = async (): Promise<string> => {
    await bringIdentityIntoBeing('worker')
    return personOpens('pm')
  }

  /** ⚑ A give, answered `ok`, whose helper's first turn has parked on its card. */
  const aGive = async (
    pm: string,
    title: string,
    brief: string,
  ): Promise<{ worker: string; piece: string; label: string }> => {
    const given = await callOn(pm, 'give_work', {
      definition_of_done: 'The requested result and its checks are recorded.',
      profile: 'worker',
      title,
      brief,
    })
    expect(given.outcome, JSON.stringify(given)).toBe('ok')
    const worker = given.agent as string
    await waitFor(() => cardsOn(worker) > 0, 'the helper to park on its first turn')
    return { worker, piece: given.piece as string, label: given.label as string }
  }

  // ───────────────────────────────────────────────────────────────────────────────────────────
  // §1 · a give that starts a new conversation
  // ───────────────────────────────────────────────────────────────────────────────────────────

  it('refuses fresh over-limit gives and rebriefs before any work row or delivery is produced', async () => {
    const pm = await aPm()
    const startsBefore = handles.length
    const sessionsBefore = [...host.sessionIds]
    const recorded = vi.spyOn(store, 'recordGive')
    for (const brief of ['x'.repeat(2001), HISTORICAL_BRIEF]) {
      const refused = await callOn(pm, 'give_work', {
        definition_of_done: 'The fictional result and its checks are recorded.',
        profile: 'worker',
        title: TITLE,
        brief,
      })
      expect(refused).toMatchObject({
        outcome: 'refused',
        rail: 'malformed-request',
        detail: {
          problems: ['The brief is limited to 2000 characters. Put the rest in an input file.'],
        },
      })
    }
    expect(recorded).not.toHaveBeenCalled()
    expect(handles).toHaveLength(startsBefore)
    expect(host.sessionIds).toEqual(sessionsBefore)
    expect(host.pieceBoard(pm).gave).toEqual([])
    expect(sentBy(pm)).toHaveLength(0)
    const { worker, piece, label } = await aGive(pm, TITLE, LONG_BRIEF)
    const sentBefore = sentBy(pm)
    const rebriefsBefore = rowsOf(worker, 'work_rebriefed')
    const refused = await callOn(pm, 'update_work', { piece: label, brief: NEW_BRIEF + '!' })
    expect(refused).toMatchObject({
      outcome: 'refused',
      rail: 'malformed-request',
      detail: {
        problems: ['The brief is limited to 2000 characters. Put the rest in an input file.'],
      },
    })
    expect(sentBy(pm)).toEqual(sentBefore)
    expect(rowsOf(worker, 'work_rebriefed')).toEqual(rebriefsBefore)
    expect(store.piecesOwnedBy(worker).find((one) => one.piece === piece)?.brief).toBe(LONG_BRIEF)
  })

  it('reads historical over-limit gives and rebriefs whole without applying the new-write cap', () => {
    const giver = 'fictional-historical-giver'
    const owner = 'fictional-historical-owner'
    for (const id of [giver, owner])
      store.create({
        id,
        provider: 'claude',
        profileId: id,
        cwd: root,
        approvalMode: 'ask',
        ...(id === owner ? { parentSessionId: giver } : {}),
      })
    const parent = store.rootOf(giver)!
    const number = store.numberUnder(parent.piece)
    const piece = 'fictional-historical-piece'
    const label = `${parent.label}.${number}`
    const given: WorkGivenEvent = {
      type: 'work_given',
      piece,
      label,
      parent: parent.piece,
      givenBy: giver,
      title: TITLE,
      brief: HISTORICAL_BRIEF,
    }
    store.recordGive(
      {
        piece,
        parent: parent.piece,
        number,
        owner,
        givenBy: giver,
        title: TITLE,
        brief: HISTORICAL_BRIEF,
        folder: null,
        inputs: [],
      },
      store.nextOrdinal(owner),
      given,
      tick(),
    )
    store.append(
      giver,
      store.nextOrdinal(giver),
      {
        type: 'work_sent',
        piece,
        label,
        as: 'given',
        to: owner,
        title: TITLE,
        brief: HISTORICAL_BRIEF,
      },
      tick(),
    )
    expect(HISTORICAL_BRIEF.length).toBe(2670)
    expect(sentBy(giver)[0]?.brief).toBe(HISTORICAL_BRIEF)
    expect(rowsOf(owner, 'work_given')[0]?.brief).toBe(HISTORICAL_BRIEF)
    const before = host.pieceRecord(giver, piece)
    expect(before.is).toBe('a-piece')
    if (before.is !== 'a-piece') throw new Error('historical piece was not read')
    expect(before.piece.brief).toBe(HISTORICAL_BRIEF)
    const historicalRevision = `${HISTORICAL_BRIEF}\nThe old revision keeps its final sentence.`
    store.append(
      owner,
      store.nextOrdinal(owner),
      { type: 'work_rebriefed', piece, brief: historicalRevision, by: giver },
      tick(),
    )
    store.append(
      giver,
      store.nextOrdinal(giver),
      {
        type: 'work_sent',
        piece,
        label,
        as: 'rebriefed',
        to: owner,
        title: TITLE,
        brief: historicalRevision,
      },
      tick(),
    )
    expect(historicalRevision.length).toBeGreaterThan(2000)
    expect(sentBy(giver).map((row) => row.brief)).toEqual([HISTORICAL_BRIEF, historicalRevision])
    expect(rowsOf(owner, 'work_rebriefed')[0]?.brief).toBe(historicalRevision)
    const after = host.pieceRecord(giver, piece)
    expect(after.is).toBe('a-piece')
    if (after.is !== 'a-piece') throw new Error('historical revision was not read')
    expect(after.piece.brief).toBe(historicalRevision)
    expect(after.piece.definitionOfDone).toBeNull()
    expect(handles).toHaveLength(0)
  })

  describe('§1 · a give that starts a new conversation', () => {
    it('🔴 writes ONE work_sent into the giver’s ledger, before it answers: the seven keys, `to` its owner, the title and brief whole', async () => {
      const pm = await aPm()
      const before = [...host.sessionIds]
      expect(sentBy(pm)).toHaveLength(0)

      const given = await callTimed(pm, 'give_work', {
        definition_of_done: 'The requested result and its checks are recorded.',
        profile: 'worker',
        title: TITLE,
        brief: LONG_BRIEF,
      })
      expect(given.structured.outcome, JSON.stringify(given.structured)).toBe('ok')
      const owner = given.structured.agent as string
      const piece = given.structured.piece as string
      const label = given.structured.label as string
      // ⚑ The path: a conversation this give started.
      expect(before).not.toContain(owner)
      expect(given.text).toContain('It started a new conversation for it')
      // ⚑ Down before the call answered.
      expect(given.sentWhenItAnswered).toBe(1)

      expect(LONG_BRIEF.length).toBe(2_000)
      const rows = sentBy(pm)
      expect(rows).toEqual([
        {
          type: 'work_sent',
          piece,
          label,
          as: 'given',
          to: owner,
          title: TITLE,
          brief: LONG_BRIEF,
        },
      ])
      expect(Object.keys(rows[0] as object).sort()).toEqual(SEVEN_KEYS)
      // ⚑ `to` is the conversation that OWNS the piece — the store says so.
      expect(store.piecesOwnedBy(owner).some((one) => one.piece === piece)).toBe(true)

      // ⛔ The helper's ledger takes the piece (its `work_given`) and no `work_sent`.
      expect(rowsOf(owner, 'work_given').map((one) => one.piece)).toContain(piece)
      expect(sentBy(owner)).toHaveLength(0)
    })
  })

  // ───────────────────────────────────────────────────────────────────────────────────────────
  // §2 · a give to the conversation it already has
  // ───────────────────────────────────────────────────────────────────────────────────────────

  describe('§2 · a give to the conversation it already has', () => {
    it('🔴 one more row, for the second piece and to the same conversation — ⛔ the first give’s row is untouched', async () => {
      const pm = await aPm()
      const first = await aGive(pm, TITLE, LONG_BRIEF)
      const firstRow = sentBy(pm)[0]
      expect(firstRow).toBeDefined()

      const second = await callTimed(pm, 'give_work', {
        definition_of_done: 'The requested result and its checks are recorded.',
        profile: 'worker',
        title: 'Then the second table',
        brief: SECOND_BRIEF,
      })
      expect(second.structured.outcome, JSON.stringify(second.structured)).toBe('ok')
      // ⚑ The path: the conversation the giver has with that agent, which a give does not start.
      expect(second.structured.agent).toBe(first.worker)
      expect(second.text).not.toContain('It started a new conversation for it')
      expect(second.sentWhenItAnswered).toBe(2)

      const rows = sentBy(pm)
      expect(rows).toHaveLength(2)
      expect(rows[0]).toEqual(firstRow)
      expect(rows[1]).toEqual({
        type: 'work_sent',
        piece: second.structured.piece,
        label: second.structured.label,
        as: 'given',
        to: first.worker,
        title: 'Then the second table',
        brief: SECOND_BRIEF,
      })
      expect(Object.keys(rows[1] as object).sort()).toEqual(SEVEN_KEYS)
      expect(second.structured.label).not.toBe(first.label)
      expect(sentBy(first.worker)).toHaveLength(0)
    })
  })

  // ───────────────────────────────────────────────────────────────────────────────────────────
  // §3 · a give that gave nothing writes nothing
  // ───────────────────────────────────────────────────────────────────────────────────────────

  describe('§3 · a give that gave nothing writes nothing', () => {
    it('⛔ a refusal writes no row — a success beside it writes one', async () => {
      const pm = await aPm()
      const refused = await callOn(pm, 'give_work', {
        definition_of_done: 'The requested result and its checks are recorded.',
        profile: 'nobody-by-that-name',
        title: 't',
        brief: 'b',
      })
      expect(refused.outcome, JSON.stringify(refused)).toBe('refused')
      expect(sentBy(pm)).toHaveLength(0)
      await aGive(pm, TITLE, LONG_BRIEF)
      expect(sentBy(pm)).toHaveLength(1)
    })

    it('⛔ a start that failed writes no row — the same give once it starts writes one', async () => {
      const pm = await aPm()
      vi.spyOn(console, 'warn').mockImplementation(() => {})
      gate.startFails = () => new AuthUnavailableError('claude', 'signed out')
      const failed = await callOn(pm, 'give_work', {
        definition_of_done: 'The requested result and its checks are recorded.',
        profile: 'worker',
        title: TITLE,
        brief: LONG_BRIEF,
      })
      expect(failed).toMatchObject({ outcome: 'refused', rail: 'agent-did-not-start' })
      expect(sentBy(pm)).toHaveLength(0)

      gate.startFails = undefined
      const given = await callOn(pm, 'give_work', {
        definition_of_done: 'The requested result and its checks are recorded.',
        profile: 'worker',
        title: TITLE,
        brief: LONG_BRIEF,
      })
      expect(given.outcome, JSON.stringify(given)).toBe('ok')
      expect(sentBy(pm)).toEqual([expect.objectContaining({ label: given.label, as: 'given' })])
    })

    it('⛔ a delivery that failed writes no row — the same give delivered writes one', async () => {
      const pm = await aPm()
      // ⚑ The conversation it has, its piece answered, then stopped by the app: a give to it now
      // has to start it again, and that start is the delivery made to fail.
      const first = await aGive(pm, 'the first piece', 'read the first table')
      const replied = await callOn(first.worker, 'reply_to_parent', {
        piece: first.label,
        outcome: 'done',
        summary: 'read it',
      })
      expect(replied.outcome, JSON.stringify(replied)).toBe('ok')
      const answered = store.piecesOwnedBy(first.worker).find((one) => one.piece === first.piece)
      expect(answered === undefined ? 'not found' : TASK_IS_OPEN[answered.state]).toBe(false)
      await host.close(first.worker, THE_APP_ITSELF)
      await waitFor(() => !host.sessionIds.includes(first.worker), 'the helper to be over')
      expect(sentBy(pm)).toHaveLength(1)

      vi.spyOn(console, 'warn').mockImplementation(() => {})
      gate.resumeFails = () =>
        new ResumeError(
          { provider: 'claude', sessionId: 'th_x', cwd: root, rotation: 0 },
          'resume failed: x',
          { cause: new Error('the handshake died') },
        )
      const resumesBefore = gate.entered
      const failed = await callOn(pm, 'give_work', {
        definition_of_done: 'The requested result and its checks are recorded.',
        profile: 'worker',
        title: 'the second piece',
        brief: SECOND_BRIEF,
      }).catch((error: unknown) => ({ outcome: 'threw', error: String(error) }))
      // ⚑ It reached the delivery: the conversation was asked to start again, and was not.
      expect(gate.entered).toBeGreaterThan(resumesBefore)
      expect(failed.outcome, JSON.stringify(failed)).not.toBe('ok')
      expect(sentBy(pm)).toHaveLength(1)

      // ⚑ The pair: the same give, the resume let through, is delivered and writes its row.
      gate.resumeFails = undefined
      const delivered = await callOn(pm, 'give_work', {
        definition_of_done: 'The requested result and its checks are recorded.',
        profile: 'worker',
        title: 'the second piece',
        brief: SECOND_BRIEF,
      })
      expect(delivered.outcome, JSON.stringify(delivered)).toBe('ok')
      const rows = sentBy(pm)
      expect(rows).toHaveLength(2)
      expect(rows[1]).toMatchObject({
        as: 'given',
        label: delivered.label,
        to: delivered.agent,
        brief: SECOND_BRIEF,
      })
    })
  })

  // ───────────────────────────────────────────────────────────────────────────────────────────
  // §4 · a new brief
  // ───────────────────────────────────────────────────────────────────────────────────────────

  describe('§4 · a new brief given with update_work', () => {
    it('🔴 writes `as: rebriefed`, whole, with the title as it now stands, before it answers — ⛔ a title or a status alone writes none', async () => {
      const pm = await aPm()
      const { worker, piece, label } = await aGive(pm, TITLE, 'the first brief')
      expect(sentBy(pm)).toHaveLength(1)

      // ⛔ A title alone, and a status alone: no new brief, so no row.
      const retitled = await callOn(pm, 'update_work', {
        piece: label,
        title: 'The title as it now stands',
      })
      expect(retitled.outcome, JSON.stringify(retitled)).toBe('ok')
      const status = await callOn(pm, 'update_work', { piece: label, status: 'half way' })
      expect(status.outcome, JSON.stringify(status)).toBe('ok')
      expect(sentBy(pm)).toHaveLength(1)

      // 🔴 A new brief: one row, before the answer, with the title the retitle left.
      const rebriefed = await callTimed(pm, 'update_work', { piece: label, brief: NEW_BRIEF })
      expect(rebriefed.structured.outcome, JSON.stringify(rebriefed.structured)).toBe('ok')
      expect(rebriefed.structured.rebriefed).toBe(true)
      expect(rebriefed.sentWhenItAnswered).toBe(2)
      const rows = sentBy(pm)
      expect(rows[1]).toEqual({
        type: 'work_sent',
        piece,
        label,
        as: 'rebriefed',
        to: worker,
        title: 'The title as it now stands',
        brief: NEW_BRIEF,
      })
      expect(Object.keys(rows[1] as object).sort()).toEqual(SEVEN_KEYS)

      // ⚑ A title and a brief in one call: the row names the title this call gave it.
      const both = await callOn(pm, 'update_work', {
        piece: label,
        title: 'Renamed with its brief',
        brief: 'a third brief',
      })
      expect(both.outcome, JSON.stringify(both)).toBe('ok')
      expect(sentBy(pm)).toHaveLength(3)
      expect(sentBy(pm)[2]).toMatchObject({
        as: 'rebriefed',
        title: 'Renamed with its brief',
        brief: 'a third brief',
      })
      // ⛔ The holder's ledger takes none of them.
      expect(sentBy(worker)).toHaveLength(0)
    })

    it('⛔ the owner’s own new brief is refused and writes no row in either ledger — its giver’s, one fact over, writes one', async () => {
      const pm = await aPm()
      const { worker, label } = await aGive(pm, TITLE, 'the first brief')
      const refused = await callOn(worker, 'update_work', { piece: label, brief: 'x' })
      expect(refused).toMatchObject({
        outcome: 'refused',
        rail: 'the-giver-briefs-and-closes-a-piece',
      })
      expect(sentBy(worker)).toHaveLength(0)
      expect(sentBy(pm)).toHaveLength(1)

      const giver = await callOn(pm, 'update_work', { piece: label, brief: 'x' })
      expect(giver.outcome, JSON.stringify(giver)).toBe('ok')
      expect(sentBy(pm)).toHaveLength(2)
      expect(sentBy(pm)[1]).toMatchObject({ as: 'rebriefed', brief: 'x', to: worker })
    })
  })
})
