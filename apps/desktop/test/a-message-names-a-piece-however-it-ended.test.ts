import { giveWorkWithTitleAsBrief } from './lib/give-fixture'
import type { TranscriptEvent } from '../src/shared/conversation-events'
import { recordHistoricallyMovedNote, seedHistoricalSuccessor } from './lib/historical-replacement'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { FakeProviderSessions } from '@brobot2/runtime'
import { type AgentToolset } from '@brobot2/runtime'
import type { Provider } from '@brobot2/shared'
import { type AppDatabase, openDatabase } from '../src/main/db/connection'
import { applyMigrations } from '../src/main/db/migrate'
import { createSessionStore, type SessionStore } from '../src/main/db/session-store'
import { RuntimeHost } from '../src/main/runtime/runtime-host'
import { resolveSessionCwd } from '../src/main/runtime/scratch-cwd'
import { agentName } from '../src/shared/runtime-ipc'
import { ToolWatchingResumeRuntime as ToolWatchingRuntime } from './lib/provider-double'
import {
  fixtureProviderConfig,
  RecordingSink,
  syntheticProviderHome,
  neutralHostDeps,
  waitFor,
} from './lib/host-fixture'
import { callOn } from './helpers/call-tool'

const here = dirname(fileURLToPath(import.meta.url))
const migrationsFolder = join(here, '../src/main/db/migrations')

/** `FakeRuntime` with the toolset each launch was handed captured, so a test can act as that agent. */
type WordsInARow = TranscriptEvent & { type: 'user_turn' | 'message_queued'; text: string }

type Ending = 'answered' | 'withdrawn' | 'closed'

/** ⚑ The mark each ending is said with (`HOW_A_PIECE_ENDED_SAID`), written out, not imported. */
const MARK: Readonly<Record<Ending, string>> = {
  answered: 'answered',
  withdrawn: 'taken back',
  closed: 'closed',
}

const ABOUT = 'about task'

describe('F086 · F087 · F088 · a message names a piece however it ended', () => {
  let userData: string
  let root: string
  let db: AppDatabase
  let store: SessionStore
  let host: RuntimeHost
  let hosts: RuntimeHost[]
  let handed: AgentToolset[]
  let issued: FakeProviderSessions
  let counter: number
  let clock: number
  let window: RecordingSink
  let claimed: Set<string>
  const tick = (): number => clock++

  const buildHost = (): RuntimeHost => {
    const built = new RuntimeHost({
      store,
      ...neutralHostDeps(() => userData),
      createRuntime: (provider: Provider) => new ToolWatchingRuntime(provider, handed, issued),
      prepareProviderHome: syntheticProviderHome(() => userData),
      providerHomePath: (provider: Provider) => join(userData, 'provider-homes', provider),
      resolveCwd: (sessionId, requested) => resolveSessionCwd(userData, sessionId, requested),
      newSessionId: () => `sess_${++counter}`,
      now: tick,
      readProviderConfig: fixtureProviderConfig,
    })
    hosts.push(built)
    return built
  }

  beforeEach(() => {
    userData = mkdtempSync(join(tmpdir(), 'brobot2-named-piece-'))
    root = mkdtempSync(join(tmpdir(), 'brobot2-named-piece-root-'))
    db = openDatabase(join(userData, 'brobot2.sqlite'))
    applyMigrations(db, migrationsFolder)
    clock = 7_200_000
    store = createSessionStore(db, tick)
    counter = 0
    hosts = []
    handed = []
    issued = new FakeProviderSessions()
    host = buildHost()
    window = new RecordingSink('webContents:1')
    claimed = new Set<string>()
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

  const theToolsetJustHandedOut = (): AgentToolset => {
    const last = handed.at(-1)
    if (last === undefined) throw new Error('no toolset was handed to that launch')
    return last
  }

  const ledger = (sessionId: string): TranscriptEvent[] =>
    store.events(sessionId).map((entry) => entry.event)

  const wordsIn = (sessionId: string): WordsInARow[] =>
    ledger(sessionId).filter(
      (event): event is WordsInARow =>
        event.type === 'user_turn' || event.type === 'message_queued',
    )

  const sentBy = (sessionId: string): TranscriptEvent[] =>
    ledger(sessionId).filter((event) => event.type === 'message_sent')

  const theOpenCard = (sessionId: string): string | null => {
    const rows = ledger(sessionId)
    const settled = new Set(
      rows
        .filter((event) => event.type === 'user_decision')
        .map((event) => (event as { requestId: string }).requestId),
    )
    const open = rows
      .filter((event) => event.type === 'permission_request')
      .map((event) => (event as { id: string }).id)
      .filter((id) => !settled.has(id))
    return open.at(-1) ?? null
  }

  const answerTheCard = async (sessionId: string, id: string): Promise<void> => {
    if (!claimed.has(sessionId)) {
      host.claimSession(sessionId, window)
      claimed.add(sessionId)
    }
    await host.respondPermission(sessionId, id, { outcome: 'allow' }, window)
  }

  /** ⚑ What a provider was handed, whole — the double echoes each turn it is given. */
  const heardBy = (sessionId: string): string[] =>
    ledger(sessionId).flatMap((event) =>
      event.type === 'assistant_message' && event.text.startsWith('echo: ')
        ? [event.text.slice('echo: '.length)]
        : [],
    )

  /**
   * ⚑ **The turn that carried these words**, answering every card that stands before it — a brief's
   * turn parked on its card holds what comes after it. ⛔ Bounded: 600 rounds of 10 ms at most.
   */
  const driveUntilHeard = async (sessionId: string, words: string): Promise<string> => {
    for (let round = 0; round < 600; round += 1) {
      const turn = heardBy(sessionId).find((one) => one.includes(words))
      if (turn !== undefined) return turn
      const card = theOpenCard(sessionId)
      if (card !== null) await answerTheCard(sessionId, card)
      await new Promise((resolve) => setTimeout(resolve, 10))
    }
    throw new Error(`timed out waiting for "${words}" to reach ${sessionId}`)
  }

  /**
   * ⚑ **The part of a turn that belongs to the message whose words are `words`** — from the end of
   * the words of any other message of `others` that comes before it in the same turn, up to its own
   * words: its sender line, and its about-sentence if it has one.
   */
  const theSectionOf = (turn: string, words: string, others: readonly string[]): string => {
    const at = turn.indexOf(words)
    expect(at, `"${words}" is in the turn`).toBeGreaterThan(-1)
    const start = others
      .map((other) => ({ other, where: turn.indexOf(other) }))
      .filter(({ where }) => where > -1 && where < at)
      .reduce((latest, { other, where }) => Math.max(latest, where + other.length), 0)
    return turn.slice(start, at)
  }

  const nameOf = (profile: string): string => agentName(profile, store.agentIdentities())

  /** A give, answered `ok`, with the piece it wrote down. */
  const aGive = giveWorkWithTitleAsBrief

  /** A PM a person opened, and one worker it gave a piece to, whose first turn parks on a card. */
  const aPmAndItsWorker = async (title: string) => {
    await bringIdentityIntoBeing('worker')
    const pm = await personOpens('pm')
    // ⚑ A person opened the pm, so its window answers the pm's cards without taking it over.
    claimed.add(pm)
    const pmTools = theToolsetJustHandedOut()
    const given = await aGive(pmTools, 'worker', title)
    return {
      pm,
      worker: given.agent,
      pmTools,
      workerTools: theToolsetJustHandedOut(),
      piece: given.piece,
      label: given.label,
    }
  }

  /** …and a helper, given a second piece by the same pm, whose first turn parks on a card too. */
  const aPmAWorkerAndAHelper = async () => {
    const made = await aPmAndItsWorker('first piece')
    await bringIdentityIntoBeing('helper')
    const other = await aGive(made.pmTools, 'helper', 'second piece')
    expect(other.agent).not.toBe(made.worker)
    return {
      ...made,
      helper: other.agent,
      helperTools: theToolsetJustHandedOut(),
      other,
    }
  }

  /** ⚑ End the worker's piece the way `ending` says: its holder answers it, or its giver takes it back or closes it. */
  const endIt = async (
    ending: Ending,
    made: {
      pmTools: AgentToolset
      workerTools: AgentToolset
      worker: string
      piece: string
      label: string
    },
  ): Promise<void> => {
    const result =
      ending === 'answered'
        ? await callOn(made.workerTools, 'reply_to_parent', {
            piece: made.label,
            outcome: 'done',
            summary: 'done',
          })
        : ending === 'withdrawn'
          ? await callOn(made.pmTools, 'withdraw_task', { piece: made.label })
          : await callOn(made.pmTools, 'update_work', { piece: made.label, close: true })
    expect(result.outcome, `${ending}: ${JSON.stringify(result)}`).toBe('ok')
    // The premise: the piece ended, the way it was meant to.
    expect(store.piecesOwnedBy(made.worker).find((one) => one.piece === made.piece)?.state).toBe(
      ending,
    )
  }

  const restartWithHistoricalHelper = async (
    helper: string,
    moved: readonly string[] = [],
  ): Promise<string> => {
    await host.closeAll()
    const next = seedHistoricalSuccessor(store, helper, `sess_${++counter}`, tick(), {
      sessions: issued,
      home: syntheticProviderHome(() => userData)('claude', 'helper'),
    })
    for (const text of moved) recordHistoricallyMovedNote(store, helper, next, text, tick())
    store = createSessionStore(db, tick)
    host = buildHost()
    claimed.clear()
    return next
  }

  // ─────────────────────────────────────────────────────────────────────────────────────────────
  // §1 · F086 · F087 · a held piece taken back or closed
  // ─────────────────────────────────────────────────────────────────────────────────────────────

  for (const ending of ['withdrawn', 'closed'] as const) {
    it(`🔴 §1 · a held piece ${MARK[ending]}: its holder names it and its giver reads "(${MARK[ending]})"; its giver can send about it too`, async () => {
      const made = await aPmAndItsWorker('the piece')
      const { pm, worker, pmTools, workerTools, piece, label } = made
      await endIt(ending, made)

      // ⚑ Held and ended, by a take-back or a close rather than an answer: the note is admitted.
      const receipts = sentBy(worker).length
      const note = await callOn(workerTools, 'message_agent', {
        kind: 'note',
        agent: pm,
        text: `a word after it was ${MARK[ending]}`,
        piece: label,
      })
      expect(note, JSON.stringify(note)).toMatchObject({
        outcome: 'ok',
        kind: 'note',
        piece,
        label,
      })
      expect(sentBy(worker)).toHaveLength(receipts + 1)
      expect(sentBy(worker).at(-1)).toMatchObject({ kind: 'note', piece, label })
      // 🔴 F088 · its giver is told which piece, and how it ended.
      const turn = await driveUntilHeard(pm, `a word after it was ${MARK[ending]}`)
      const line = turn.split('\n')[0] ?? ''
      expect(line.startsWith(`From ${nameOf('worker')} (conversation `), line).toBe(true)
      const about = `${ABOUT} ${label} · the piece (${MARK[ending]}), in your conversation `
      expect(line, line).toContain(about)
      // ⛔ A note changes nothing about the piece it names.
      expect(store.piecesOwnedBy(worker).find((one) => one.piece === piece)?.state).toBe(ending)

      const giverReceipts = sentBy(pm).length
      const given = await callOn(pmTools, 'message_agent', {
        agent: worker,
        text: 'thanks all the same',
        piece: label,
      })
      expect(given, JSON.stringify(given)).toMatchObject({
        outcome: 'ok',
        kind: 'follow-up',
        piece,
        label,
      })
      expect(['sent', 'queued']).toContain(given.delivery)
      expect(sentBy(pm)).toHaveLength(giverReceipts + 1)
      expect(sentBy(pm).at(-1)).toMatchObject({ kind: 'follow-up', piece, label })
    })
  }

  // ─────────────────────────────────────────────────────────────────────────────────────────────
  // §2 · F086 · a note can name a recorded task
  // ─────────────────────────────────────────────────────────────────────────────────────────────

  it('a note can name a task its receiver holds, both open and ended', async () => {
    const { pmTools, workerTools, helper, helperTools, worker, piece, label, other } =
      await aPmAWorkerAndAHelper()

    const fromTheWorker = async (when: string): Promise<void> => {
      const before = sentBy(worker).length
      const sent = await callOn(workerTools, 'message_agent', {
        agent: helper,
        text: `about your piece, ${when}`,
        piece: other.label,
      })
      expect(sent).toMatchObject({
        outcome: 'ok',
        kind: 'note',
        piece: other.piece,
        label: other.label,
      })
      expect(sentBy(worker), when).toHaveLength(before + 1)
    }

    await fromTheWorker('while open')
    const invented = await callOn(workerTools, 'message_agent', {
      agent: helper,
      piece: 'W99999.99999',
      text: 'Please look at the named task.',
    })
    expect(invented).toMatchObject({ outcome: 'refused', rail: 'no-piece-by-that-name' })
    // ⚑ The twin, one fact over: the worker's note to the helper naming the piece the WORKER holds.
    const own = await callOn(workerTools, 'message_agent', {
      kind: 'note',
      agent: helper,
      text: 'about my own piece',
      piece: label,
    })
    expect(own, JSON.stringify(own)).toMatchObject({ outcome: 'ok', piece, label })

    // The helper answers it and the recorded task remains addressable.
    const replied = await callOn(helperTools, 'reply_to_parent', {
      piece: other.label,
      outcome: 'done',
      summary: 'done',
    })
    expect(replied.outcome, JSON.stringify(replied)).toBe('ok')
    await fromTheWorker('once it was answered')
    // ⚑ …while its giver's note to the helper naming it is admitted.
    const fromItsGiver = await callOn(pmTools, 'message_agent', {
      kind: 'note',
      agent: helper,
      text: 'thanks for your piece',
      piece: other.label,
    })
    expect(fromItsGiver, JSON.stringify(fromItsGiver)).toMatchObject({
      outcome: 'ok',
      piece: other.piece,
      label: other.label,
    })
  })

  // ─────────────────────────────────────────────────────────────────────────────────────────────
  // §3 · F087 · a piece given another agent, ended, and that agent replaced
  // ─────────────────────────────────────────────────────────────────────────────────────────────

  it('🔴 §3 · the same ended task produces a note to a peer and a follow-up to its owner', async () => {
    const { pmTools, helperTools, worker, other } = await aPmAWorkerAndAHelper()
    const replied = await callOn(helperTools, 'reply_to_parent', {
      piece: other.label,
      outcome: 'done',
      summary: 'done',
    })
    expect(replied.outcome, JSON.stringify(replied)).toBe('ok')

    const said = await callOn(pmTools, 'message_agent', {
      agent: worker,
      text: 'and the tests',
      piece: other.label,
    })
    expect(said).toMatchObject({
      outcome: 'ok',
      kind: 'note',
      piece: other.piece,
      label: other.label,
    })
    const followed = await callOn(pmTools, 'message_agent', {
      agent: other.label,
      text: 'and the tests',
      piece: other.label,
    })
    expect(followed, JSON.stringify(followed)).toMatchObject({
      outcome: 'ok',
      kind: 'follow-up',
      piece: other.piece,
      label: other.label,
    })
  })

  it('🔴 §3 · a follow-up to the successor can use the old id, the task label or the successor id', async () => {
    const { pm, worker, helper, other } = await aPmAWorkerAndAHelper()
    const next = await restartWithHistoricalHelper(helper)
    await host.resumeSession(pm, window)
    const pmTools = theToolsetJustHandedOut()

    // ⚑ Read through the one in its place, on both sides: each of these names the agent holding it.
    for (const to of [helper, other.label, next]) {
      const again = await callOn(pmTools, 'message_agent', {
        agent: to,
        text: `again, to ${to}`,
        piece: other.label,
      })
      expect(again, `${to}: ${JSON.stringify(again)}`).toMatchObject({
        outcome: 'ok',
        kind: 'follow-up',
        piece: other.piece,
      })
    }
    const said = await callOn(pmTools, 'message_agent', {
      agent: worker,
      text: 'for the other agent’s information',
      piece: other.label,
    })
    expect(said).toMatchObject({ outcome: 'ok', kind: 'note', piece: other.piece })
  })

  // ─────────────────────────────────────────────────────────────────────────────────────────────
  // §4 · F088 · every ending mark on every path a held message takes
  // ─────────────────────────────────────────────────────────────────────────────────────────────

  const NAMED = 'about the first piece'
  const PLAIN = 'about nothing in particular'

  /**
   * ⚑ The pm's two notes to the helper, held behind the helper's brief card: one naming the WORKER's
   * piece (a piece the pm gave another agent — a note may name it), one naming none.
   */
  const twoHeldNotes = async (made: Awaited<ReturnType<typeof aPmAWorkerAndAHelper>>) => {
    for (const args of [
      { kind: 'note', agent: made.helper, text: NAMED, piece: made.label },
      { kind: 'note', agent: made.helper, text: PLAIN },
    ]) {
      const held = await callOn(made.pmTools, 'message_agent', args)
      expect(held.outcome, JSON.stringify(held)).toBe('ok')
      expect(held.delivery, JSON.stringify(held)).toBe('queued')
    }
  }

  /** ⚑ What the receiver read: the named note's section says which piece and how it ended; the plain one's says nothing. */
  const readAsEnded = async (receiver: string, label: string, ending: Ending): Promise<void> => {
    const named = await driveUntilHeard(receiver, NAMED)
    const plain = await driveUntilHeard(receiver, PLAIN)
    const about = `${ABOUT} ${label} · first piece (${MARK[ending]}), in your conversation `
    const namedSection = theSectionOf(named, NAMED, [PLAIN])
    expect(namedSection, namedSection).toContain(about)
    expect(namedSection.split(ABOUT), namedSection).toHaveLength(2)
    const plainSection = theSectionOf(plain, PLAIN, [NAMED])
    expect(plainSection, plainSection).not.toContain(ABOUT)
  }

  for (const ending of ['answered', 'withdrawn', 'closed'] as const) {
    it(`🔴 §4 · held behind a turn, a note about a piece ${MARK[ending]} meanwhile says "(${MARK[ending]})" when it goes; a note naming none says nothing of a piece`, async () => {
      const made = await aPmAWorkerAndAHelper()
      await twoHeldNotes(made)
      // ⚑ Ended AFTER the notes were held: what the line says is read when the words go.
      await endIt(ending, made)
      await readAsEnded(made.helper, made.label, ending)
    })

    it(`🔴 §4 · rebuilt from its row after a quit, a note about a piece ${MARK[ending]} says "(${MARK[ending]})"; a note naming none says nothing of a piece`, async () => {
      const made = await aPmAWorkerAndAHelper()
      await twoHeldNotes(made)
      await endIt(ending, made)
      // ⚑ The named note's row keeps the piece; the plain one's names none.
      const waiting = store.messagesWaitingIn(made.helper)
      expect(waiting.find((one) => one.text === NAMED)).toMatchObject({ about: made.piece })
      expect(waiting.find((one) => one.text === PLAIN)).not.toHaveProperty('about')
      // The quit, and the next launch: its own store object over the same database.
      await host.closeAll()
      store = createSessionStore(db, tick)
      host = buildHost()
      claimed.clear()
      await host.resumeSession(made.helper, window)
      // ⚑ The resume opened it in this window: it is held here already.
      claimed.add(made.helper)
      await readAsEnded(made.helper, made.label, ending)
    })

    it(`🔴 §4 · handed to the conversation that took its receiver's place, a note about a piece ${MARK[ending]} says "(${MARK[ending]})"; a note naming none says nothing of a piece`, async () => {
      const made = await aPmAWorkerAndAHelper()
      await twoHeldNotes(made)
      await endIt(ending, made)
      const next = await restartWithHistoricalHelper(made.helper, [NAMED, PLAIN])
      const moved = store.messagesWaitingIn(next)
      expect(moved.find((one) => one.text === NAMED)).toMatchObject({ about: made.piece })
      expect(moved.find((one) => one.text === PLAIN)).not.toHaveProperty('about')
      expect(store.messagesWaitingIn(made.helper)).toEqual([])
      await host.resumeSession(next, window)
      claimed.add(next)
      await readAsEnded(next, made.label, ending)
    })
  }

  // ─────────────────────────────────────────────────────────────────────────────────────────────
  // §5 · F088 · which piece, by the title it stands under now
  // ─────────────────────────────────────────────────────────────────────────────────────────────

  it("🔴 §5 · a note naming the sender's own root says it by the root's title, with no mark", async () => {
    const { pm, worker, pmTools } = await aPmAndItsWorker('the piece')
    const rootPiece = store.rootOf(pm)
    if (rootPiece === null) throw new Error('the pm has no root')
    const titledIt = await callOn(pmTools, 'update_work', {
      piece: rootPiece.label,
      title: 'Plan the launch',
    })
    expect(titledIt.outcome, JSON.stringify(titledIt)).toBe('ok')
    // The premise: a root's row has no title; its title is its newest retitling.
    expect(store.workById(rootPiece.piece)?.title ?? null).toBeNull()
    expect(store.rootLines(rootPiece.piece).title).toBe('Plan the launch')

    const note = await callOn(pmTools, 'message_agent', {
      kind: 'note',
      agent: worker,
      text: 'the launch is what this is all for',
      piece: rootPiece.label,
    })
    expect(note, JSON.stringify(note)).toMatchObject({ outcome: 'ok', label: rootPiece.label })
    const turn = await driveUntilHeard(worker, 'the launch is what this is all for')
    const section = theSectionOf(turn, 'the launch is what this is all for', [])
    // A root has no ending mark between its title and the receiver name.
    expect(section, section).toContain(
      `${ABOUT} ${rootPiece.label} · Plan the launch, in your conversation `,
    )
    expect(section, section).not.toContain(`${ABOUT} ${rootPiece.label}.`)
  })

  it('🔴 §5 · of two pieces one conversation holds, a note names the one it names — by the title it was given since — and never the other', async () => {
    const { worker, pmTools, label } = await aPmAndItsWorker('first piece')
    const second = await aGive(pmTools, 'worker', 'second piece', worker)
    // The premise: both pieces went to the one conversation.
    expect(second.agent).toBe(worker)
    const retitled = await callOn(pmTools, 'update_work', {
      piece: second.label,
      title: 'second piece, renamed',
    })
    expect(retitled.outcome, JSON.stringify(retitled)).toBe('ok')
    // The premise: the row keeps the title as given; the piece stands under its new one.
    expect(store.workById(second.piece)?.title).toBe('second piece')
    expect(store.piecesOwnedBy(worker).find((one) => one.piece === second.piece)?.title).toBe(
      'second piece, renamed',
    )

    const SECOND = 'a note about the second'
    const FIRST = 'a note about the first'
    for (const [text, named] of [
      [SECOND, second.label],
      [FIRST, label],
    ] as const) {
      const note = await callOn(pmTools, 'message_agent', {
        kind: 'note',
        agent: worker,
        text,
        piece: named,
      })
      expect(note.outcome, JSON.stringify(note)).toBe('ok')
    }
    const aboutSecond = `${ABOUT} ${second.label} · second piece, renamed.`
    const aboutFirst = `${ABOUT} ${label} · first piece.`
    const secondTurn = await driveUntilHeard(worker, SECOND)
    const firstTurn = await driveUntilHeard(worker, FIRST)
    // ⚠️ The second piece's brief may go in the same turn, ahead of the notes: it names no piece in
    // an about-sentence (a brief hands its piece over; it is not ABOUT one), so it cannot muddy these.
    const secondSection = theSectionOf(secondTurn, SECOND, [FIRST])
    const firstSection = theSectionOf(firstTurn, FIRST, [SECOND])
    // ⚑ W4.187 · a piece's title is said once a turn: where that brief went in the same turn, ahead
    // of the note, it said the new title, and the note names the piece by its label alone.
    const renamed = `${second.label} · second piece, renamed`
    const byTheBrief = secondSection.indexOf(renamed) < secondSection.indexOf(ABOUT)
    expect(secondSection, secondSection).toContain(renamed)
    expect(secondSection, secondSection).toContain(
      byTheBrief ? `${ABOUT} ${second.label}.` : aboutSecond,
    )
    // ⛔ …and never under the title it was given first.
    expect(
      secondSection
        .split(`${second.label} · second piece`)
        .slice(1)
        .every((rest) => rest.startsWith(', renamed')),
      secondSection,
    ).toBe(true)
    expect(secondSection, secondSection).not.toContain(aboutFirst)
    expect(firstSection, firstSection).toContain(aboutFirst)
    expect(firstSection, firstSection).not.toContain(aboutSecond)
  })

  // ─────────────────────────────────────────────────────────────────────────────────────────────
  // §6 · F088 · only an agent's words carry it
  // ─────────────────────────────────────────────────────────────────────────────────────────────

  it('⛔ §6 · a held app notice about a piece keeps no `about` on its row; a held note naming the same piece does', async () => {
    const { worker, pmTools, piece, label } = await aPmAndItsWorker('the piece')
    // ⚑ The twin first: the pm's note naming the piece, held behind the worker's brief card.
    const held = await callOn(pmTools, 'message_agent', {
      kind: 'note',
      agent: worker,
      text: 'held for later',
      piece: label,
    })
    expect(held.delivery, JSON.stringify(held)).toBe('queued')
    expect(
      wordsIn(worker).find((one) => one.type === 'message_queued' && one.text === 'held for later'),
    ).toMatchObject({ about: piece })

    // ⛔ The take-back's notice is this app's words about the same piece: it names no sender, so it
    // keeps no piece for a sender line.
    const back = await callOn(pmTools, 'withdraw_task', { piece: label })
    expect(back.outcome, JSON.stringify(back)).toBe('ok')
    const isTheNotice = (one: WordsInARow): boolean =>
      (one as { appNotice?: string }).appNotice === 'a-piece-taken-back'
    await waitFor(() => wordsIn(worker).some(isTheNotice), 'the take-back notice')
    const notices = wordsIn(worker).filter(isTheNotice)
    // The premise: it was held behind the same card, so a row was written for it.
    const heldNotice = notices.find((one) => one.type === 'message_queued')
    expect(heldNotice, JSON.stringify(notices)).toBeDefined()
    expect(heldNotice).not.toHaveProperty('about')
    // ⚑ …and the store reads it back without one, while the note keeps its piece.
    const waiting = store.messagesWaitingIn(worker)
    expect(waiting.find((one) => one.text === 'held for later')).toMatchObject({ about: piece })
    const noticeWaiting = waiting.find((one) => one.text === heldNotice?.text)
    expect(noticeWaiting, JSON.stringify(waiting)).toBeDefined()
    expect(noticeWaiting).not.toHaveProperty('about')
  })
})
