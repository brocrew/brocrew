import { describe, expect, it } from 'vitest'
import type { AgentToolset } from '@brobot2/runtime'
import { agentToolsFor, ENDED_LISTED, type AgentToolHost } from '../src/main/runtime/agent-tools'
import type { PieceBoard } from '../src/main/runtime/runtime-host'
import type { VisibleQuestion } from '../src/shared/questions'
import type { PieceRow, TaskState } from '../src/shared/tasks'

/**
 * `list_tasks` and `list_questions` list what is open. A long history is counted, and listed only
 * when asked for, a line each, newest first and no more than a limit: so an answer stays the size of
 * the work in hand. Nothing waiting is left out by default: a stalled piece, a piece waiting on an
 * answer, and a piece whose answer its giver has not read yet.
 *
 * The host here is a stand-in: these tests are about what the two tools list, and a board of
 * hundreds of pieces is cheap to build this way. The real host's rows are what every other
 * `list_tasks` test reads.
 */

const ME = 'sess_me'
const HELPER = 'sess_helper'
const A_LONG_BRIEF = `Do the long thing.\n${'Every step of it, said at length. '.repeat(60)}`
const A_LONG_ANSWER = `It is done. ${'Every detail of how, said at length. '.repeat(30)}`

let made = 0
/** A piece, as the fold would leave it. */
function aPiece(state: TaskState, more: Partial<PieceRow> = {}): PieceRow {
  made += 1
  const ended = !['working', 'waiting', 'stalled'].includes(state) && !state.startsWith('waiting')
  return {
    piece: `work_${String(made)}`,
    label: `W1.${String(made)}`,
    parent: 'work_root',
    title: `piece ${String(made)}`,
    brief: A_LONG_BRIEF,
    giver: ME,
    owner: HELPER,
    givenAt: made,
    messageId: null,
    state,
    endedAt: ended ? 1_000 + made : null,
    endedBy: ended ? HELPER : null,
    outcome: state === 'answered' ? 'done' : null,
    stalledBecause: state === 'stalled' ? 'turn_ended' : null,
    stalledAt: state === 'stalled' ? 900 : null,
    stalledBy: null,
    questionLostAtRestart: false,
    resources: [],
    summary: state === 'answered' ? A_LONG_ANSWER : null,
    answerReachedNobody: false,
    needsUserAction: false,
    statusLine: state === 'answered' ? { text: A_LONG_ANSWER, by: HELPER, at: 1_000 + made } : null,
    ...more,
  }
}

/** A question routed to this caller, open or ended. */
function aQuestion(
  id: string,
  state: 'open' | 'answered' | 'stranded',
  at: number,
): VisibleQuestion {
  return {
    request: {
      requestId: id,
      askedBy: HELPER,
      parent: ME,
      went: { is: 'the-parent', to: 'the-parent' },
      at,
      state,
      endedAt: state === 'open' ? null : at + 1,
      escalatedAt: null,
    } as VisibleQuestion['request'],
    askerCalled: 'Ada (the owner of W1.1 · the long thing)',
    words: `What should I do about ${id}? ${'The whole question, at length. '.repeat(40)}`,
  }
}

/** The two tools over a stand-in host; anything else they ask of it fails the test. */
function theTools(
  board: PieceBoard,
  questions: readonly VisibleQuestion[] = [],
  heldForMe: readonly string[] = [],
): AgentToolset {
  const given: Partial<AgentToolHost> = {
    pieceBoard: () => board,
    answersHeldFor: () => new Set(heldForMe),
    questionsListedFor: () => ({ questions, rowsUnread: 0 }),
    agentCard: () => null,
    whyWhatIsHeldWaits: () => null,
    nameByItsWorkUnder: () => 'Ada',
    nameByItsWork: (id) => {
      if (id !== HELPER && id !== ME) throw new Error(`named an unexpected conversation: ${id}`)
      return 'Ada'
    },
    navigationProfileForConversation: () => null,
    navigationIdentity: () => null,
    whatToCallTheConversation: (conversation: string) => {
      if (conversation !== HELPER) throw new Error(`named an unexpected holder: ${conversation}`)
      return 'Ada'
    },
    noteRefusal: () => {},
    whenItWasArchived: () => null,
  }
  const host = new Proxy(given, {
    get: (target, key) => {
      const found = target[key as keyof AgentToolHost]
      if (found === undefined) throw new Error(`the stand-in host was asked for ${String(key)}`)
      return found
    },
  }) as AgentToolHost
  return agentToolsFor(host, ME)
}

async function call(
  tools: AgentToolset,
  name: 'list_tasks' | 'list_questions',
  args: Record<string, unknown> = {},
): Promise<{ text: string; structured: Record<string, unknown>; size: number }> {
  const tool = tools.tools.find((one) => one.name === name)
  if (tool === undefined) throw new Error(`no ${name}`)
  const answered = await tool.call(args)
  const structured = answered.structured as Record<string, unknown>
  return {
    text: answered.text,
    structured,
    size: answered.text.length + JSON.stringify(structured).length,
  }
}

const aBoard = (gave: readonly PieceRow[], hold: readonly PieceRow[] = []): PieceBoard => ({
  root: null,
  hold,
  gave,
  rowsUnread: 0,
})

const labelsIn = (rows: unknown): string[] => (rows as { label: string }[]).map((one) => one.label)

describe('list_tasks with no piece', () => {
  it('a board of hundreds of ended pieces and a few open ones stays small, and counts the rest', async () => {
    const ended = [
      ...Array.from({ length: 290 }, () => aPiece('answered')),
      ...Array.from({ length: 12 }, () => aPiece('withdrawn')),
      ...Array.from({ length: 6 }, () => aPiece('closed')),
    ]
    const open = [aPiece('working'), aPiece('stalled'), aPiece('waiting-on-an-answer')]
    const tools = theTools(aBoard([...ended, ...open]))

    const listed = await call(tools, 'list_tasks')
    expect(labelsIn(listed.structured['you_gave'])).toEqual(open.map((one) => one.label))
    // Each open row names who holds it; an ended row is one line with no holder.
    expect(listed.text.split(' · held by Ada').length - 1).toBe(open.length)
    expect(listed.structured['not_listed']).toEqual({
      you_hold: {},
      you_gave: { done: 290, withdrawn: 12, closed: 6 },
    })
    expect(listed.text).toContain(
      'not listed: of the work you gave, 290 done, 12 withdrawn, 6 closed.',
    )
    expect(listed.text).toContain('list_tasks takes state')
    expect(listed.size).toBeLessThan(6_000)
    // ⚑ The control: the same open pieces with no history answer within a sentence of it, so the
    // answer is the size of the work in hand, however long the history behind it.
    const without = await call(theTools(aBoard(open)), 'list_tasks')
    expect(listed.size - without.size).toBeLessThan(400)
  })

  it('⛔ nothing waiting is left out by default: stalled, waiting on an answer, and an answer not read', async () => {
    const stalled = aPiece('stalled')
    const asking = aPiece('waiting-on-an-answer')
    const lost = aPiece('answered', { answerReachedNobody: true })
    const held = aPiece('answered')
    const read = aPiece('answered')
    const tools = theTools(aBoard([stalled, asking, lost, held, read]), [], [held.piece])

    const listed = await call(tools, 'list_tasks')
    const rows = listed.structured['you_gave'] as Record<string, unknown>[]
    expect(labelsIn(rows)).toEqual([stalled.label, asking.label, lost.label, held.label])
    expect(rows.find((one) => one['piece'] === lost.piece)).toMatchObject({
      answer_not_read: 'reached-nobody',
      // ⚑ An answer that reached nobody carries its words: here is the only place they are.
      summary: A_LONG_ANSWER,
    })
    expect(rows.find((one) => one['piece'] === held.piece)).toMatchObject({
      answer_not_read: 'held-for-you',
    })
    expect(listed.text).toContain('its answer reached no conversation, and its words are here:')
    expect(listed.text).toContain('its answer is held for you and has not reached you yet:')
    expect(listed.structured['not_listed']).toEqual({ you_hold: {}, you_gave: { done: 1 } })

    // ⚑ In every listing, and never cut by the limit: nothing else tells the giver to look.
    const ended = await call(tools, 'list_tasks', { state: 'ended', limit: 1 })
    const endedRows = ended.structured['you_gave'] as Record<string, unknown>[]
    expect(labelsIn(endedRows)).toEqual([lost.label, held.label, read.label])
    expect(endedRows[0]).toMatchObject({ summary: A_LONG_ANSWER })
  })

  it('a piece that is over says, on its one line, when a person has to act or a question was lost', async () => {
    const needsAPerson = aPiece('answered', { needsUserAction: true })
    const lostAQuestion = aPiece('withdrawn', { questionLostAtRestart: true })
    const quiet = aPiece('answered')
    const listed = await call(
      theTools(aBoard([needsAPerson, lostAQuestion, quiet])),
      'list_tasks',
      { state: 'ended' },
    )
    const rows = listed.structured['you_gave'] as Record<string, unknown>[]
    expect(rows.find((one) => one['piece'] === needsAPerson.piece)).toMatchObject({
      needs_user_action: true,
    })
    expect(rows.find((one) => one['piece'] === lostAQuestion.piece)).toMatchObject({
      question_lost_at_restart: true,
    })
    const quietRow = rows.find((one) => one['piece'] === quiet.piece)
    expect(quietRow).not.toHaveProperty('needs_user_action')
    expect(quietRow).not.toHaveProperty('question_lost_at_restart')
    expect(listed.text).toContain(
      `${needsAPerson.label} · piece ${needsAPerson.label.slice(3)} · answered · done · ended`,
    )
    expect(listed.text).toContain('its holder said a person has to act')
    expect(listed.text).toContain('a question of its own was lost at a restart')
  })

  it('an answer is its giver’s to read: a piece the caller holds and answered is not kept listed', async () => {
    const answered = aPiece('answered', { giver: 'sess_pm', owner: ME, answerReachedNobody: true })
    const tools = theTools(aBoard([], [answered, aPiece('working', { owner: ME })]))
    const listed = await call(tools, 'list_tasks')
    expect((listed.structured['you_hold'] as unknown[]).length).toBe(1)
    expect(listed.structured['not_listed']).toEqual({ you_hold: { done: 1 }, you_gave: {} })
  })

  it('state "ended" lists only what is over, a line each, newest first, as many as limit says', async () => {
    const ended = Array.from({ length: 30 }, () => aPiece('answered'))
    const open = aPiece('working')
    const tools = theTools(aBoard([...ended, open]))

    const listed = await call(tools, 'list_tasks', { state: 'ended' })
    const rows = listed.structured['you_gave'] as Record<string, unknown>[]
    expect(rows).toHaveLength(ENDED_LISTED)
    expect(labelsIn(rows)).toEqual(
      [...ended]
        .reverse()
        .slice(0, ENDED_LISTED)
        .map((one) => one.label),
    )
    // ⚑ A line each: its state, how it went and when, and none of its brief or answer.
    expect(Object.keys(rows[0] ?? {}).sort()).toEqual(
      ['ended_at', 'label', 'outcome', 'piece', 'state', 'title'].sort(),
    )
    expect(listed.text).not.toContain('Every detail of how')
    expect(listed.text).not.toContain('Every step of it')
    expect(listed.structured['not_listed']).toEqual({
      you_hold: {},
      you_gave: { done: 10, open: 1 },
    })

    const three = await call(tools, 'list_tasks', { state: 'ended', limit: 3 })
    expect(labelsIn(three.structured['you_gave'])).toEqual(
      [...ended]
        .reverse()
        .slice(0, 3)
        .map((one) => one.label),
    )
  })

  it('state "all" lists what is open whole, then what is over, a line each', async () => {
    const answered = aPiece('answered')
    const open = aPiece('working')
    const listed = await call(theTools(aBoard([answered, open])), 'list_tasks', { state: 'all' })
    const rows = listed.structured['you_gave'] as Record<string, unknown>[]
    expect(labelsIn(rows)).toEqual([open.label, answered.label])
    expect(rows[0]).toHaveProperty('status_line')
    expect(rows[1]).not.toHaveProperty('status_line')
    expect(listed.structured['not_listed']).toEqual({ you_hold: {}, you_gave: {} })
  })

  it('says plainly when it holds work and none of it is open', async () => {
    const listed = await call(theTools(aBoard([aPiece('answered')])), 'list_tasks')
    expect(listed.text).toContain('no work you gave is open')
    expect(listed.text).toContain('you hold no work')
  })

  it('⛔ a bad state or limit is refused, and so is either beside a piece or made', async () => {
    const tools = theTools(aBoard([]))
    for (const args of [
      { state: 'closed' },
      { limit: 0 },
      { limit: 201 },
      { limit: 2.5 },
      { state: 'all', piece: 'W1.1' },
      { limit: 5, made: true },
    ]) {
      const refused = await call(tools, 'list_tasks', args)
      expect(refused.structured, JSON.stringify(args)).toMatchObject({
        outcome: 'refused',
        rail: 'malformed-request',
      })
    }
  })
})

describe('list_questions', () => {
  it('with nothing open, it is a line, whatever lies behind it', async () => {
    const over = Array.from({ length: 40 }, (_, at) =>
      aQuestion(`req_${String(at)}`, 'answered', at),
    )
    const listed = await call(theTools(aBoard([]), over), 'list_questions')
    expect(listed.text).toBe(
      'nothing is waiting on you.\nnot listed: 40 answered. list_questions takes state — open, ended or all — and limit, which is how many ended questions it lists, newest first.',
    )
    expect(listed.structured['questions']).toEqual([])
    expect(listed.structured['not_listed']).toEqual({ answered: 40 })
    expect(listed.size).toBeLessThan(1_000)
  })

  it('what is waiting is listed with its words; what is over is counted', async () => {
    const waiting = aQuestion('req_open', 'open', 50)
    const listed = await call(
      theTools(aBoard([]), [aQuestion('req_old', 'answered', 1), waiting]),
      'list_questions',
    )
    const rows = listed.structured['questions'] as Record<string, unknown>[]
    expect(rows.map((one) => one['question'])).toEqual(['req_open'])
    expect(rows[0]?.['words']).toBe(waiting.words)
    expect(listed.text).toContain('1 waiting on you:')
    expect(listed.structured['not_listed']).toEqual({ answered: 1 })
  })

  it('⛔ one that is over is listed only when asked for, without its words, newest first', async () => {
    const questions = [
      aQuestion('req_1', 'answered', 1),
      aQuestion('req_2', 'stranded', 2),
      aQuestion('req_3', 'open', 3),
    ]
    const tools = theTools(aBoard([]), questions)

    const ended = await call(tools, 'list_questions', { state: 'ended' })
    const rows = ended.structured['questions'] as Record<string, unknown>[]
    expect(rows.map((one) => one['question'])).toEqual(['req_2', 'req_1'])
    for (const row of rows) expect(row).not.toHaveProperty('words')
    expect(ended.text).not.toContain('The whole question')
    // ⚑ What is waiting is still said first, and counted among what was left out.
    expect(ended.text.split('\n')[0]).toBe('1 waiting on you.')
    expect(ended.text).toContain('the app restarted while it was waiting')
    expect(ended.structured['not_listed']).toEqual({ open: 1 })

    const one = await call(tools, 'list_questions', { state: 'all', limit: 1 })
    expect(
      (one.structured['questions'] as Record<string, unknown>[]).map((row) => row['question']),
    ).toEqual(['req_3', 'req_2'])
    expect(one.structured['not_listed']).toEqual({ answered: 1 })
  })

  it('⛔ a bad state or limit is refused', async () => {
    const tools = theTools(aBoard([]))
    for (const args of [{ state: 'over' }, { limit: -1 }]) {
      expect((await call(tools, 'list_questions', args)).structured).toMatchObject({
        outcome: 'refused',
        rail: 'malformed-request',
      })
    }
  })
})
