import { afterEach, describe, expect, it } from 'vitest'
import { page } from 'vitest/browser'
import { defineComponent, h, nextTick, ref } from 'vue'
import CanonicalDocumentOverlay from '../../src/renderer/src/components/CanonicalDocumentOverlay.vue'
import OverlayHost, { provideOverlayLayer } from '../../src/renderer/src/components/OverlayHost.vue'
import PersonsQueue from '../../src/renderer/src/components/PersonsQueue.vue'
import SideRail from '../../src/renderer/src/components/SideRail.vue'
import WaitingOnYou from '../../src/renderer/src/components/WaitingOnYou.vue'
import type { AttentionRequest } from '../../src/renderer/src/lib/attention'
import { usePersonsQueue } from '../../src/renderer/src/lib/persons-queue'
import { clockTime } from '../../src/shared/clock'
import {
  NOTHING_NAMED_THE_WORK,
  aPersonsSince,
  chainReading,
  chainSentence,
  escalationChain,
  type LedgerWalk,
  type PersonsDecision,
  type PersonsQuestion,
  type RoutedRequest,
  type WorkInHand,
} from '../../src/shared/questions'
import type { ResumableSessionInfo } from '../../src/shared/runtime-ipc'
import type { StalledWork } from '../../src/shared/stalled-work'
import type { StoppedWorkForAPerson } from '../../src/shared/stopped-work'
import type { WaitOn } from '../../src/shared/tasks'
import type { WorkIncident } from '../../src/shared/work-incidents'
import type { PersonTodo } from '../../src/shared/work-waits'
import { assertDrawn, drawnReady } from './drawn'
import { mount, unmountAll, visible } from './harness'
import { identities, workerRows } from './parallel-workers-fixture'

/**
 * Waiting on you draws what an agent asked a person to do, answered on its card; each piece no agent
 * is driving, once, with the agent, the piece and the cause; and each recovery that is pending,
 * declined or failed. A typed wait says what it waits on where its holder read idle.
 */

const AT = new Date(2026, 9, 14, 21, 30).getTime()
const NINE = new Date(2026, 9, 15, 9, 0).getTime()
const FRIDAY = new Date(2026, 9, 16, 9, 0).getTime()

const read = (el: Element): string => (el.textContent ?? '').replace(/\s+/g, ' ').trim()

afterEach(async () => {
  unmountAll()
  usePersonsQueue().forget()
  delete (window as { api?: unknown }).api
  await page.viewport(1200, 808)
})

const settle = async (): Promise<void> => {
  await new Promise((done) => setTimeout(done, 0))
  await nextTick()
  await drawnReady()
}

const TODO: PersonTodo = {
  requestId: 'req_board',
  askedBy: 'sess_ada',
  askedByName: 'Ada',
  label: 'W3.1',
  text: 'Play through the Italian Game line in the file, then tell me where you got lost.',
  files: [{ resource: 'res_italian', name: 'italian-game.pgn' }],
  at: AT,
}

const incident = (over: Partial<WorkIncident> = {}): WorkIncident => ({
  piece: 'work_31',
  label: 'W3.1',
  title: 'Coach the person through a week of openings',
  holder: 'sess_ada',
  holderName: 'Ada',
  giver: 'sess_bro',
  giverName: 'BroBot',
  kind: 'wait-needs-classification',
  since: AT,
  ...over,
})

/** Ali's piece, in one of the three recovery kinds. */
const recovery = (over: Partial<WorkIncident> = {}): WorkIncident =>
  incident({
    piece: 'work_41',
    label: 'W4.1',
    holder: 'sess_ali',
    holderName: 'Ali',
    kind: 'recovery-pending',
    ...over,
  })

interface Doors {
  answered: { sessionId: string; requestId: string; done: boolean; note: string }[]
  handed: string[]
  opened: string[]
  files: string[]
}

const EMPTY = <Row>(): LedgerWalk<Row> =>
  ({
    rows: [],
    walk: 'every-conversation-that-routed',
    ledgers: 1,
    rowsUnread: 0,
  }) as LedgerWalk<Row>

/** A to-do as the host lists it: a person's question row marked as an action. */
function asARow(todo: PersonTodo): PersonsQuestion {
  const request: RoutedRequest = {
    requestId: todo.requestId,
    askedBy: todo.askedBy,
    parent: null,
    went: { is: 'the-person-the-asker-named', to: 'a-person' },
    at: todo.at,
    state: 'open',
    endedAt: null,
    escalatedAt: null,
  }
  const chain = escalationChain(request, () => null)
  const name = (id: string): string => (id === todo.askedBy ? todo.askedByName : id)
  return {
    request,
    aPersonsSince: aPersonsSince(request),
    chain,
    reading: chainReading(chain, name),
    sentence: chainSentence(chain, name),
    work: [],
    about:
      todo.label === null
        ? NOTHING_NAMED_THE_WORK
        : { is: 'the-asker-named-it', work: { label: todo.label } as WorkInHand },
    raisedBy: 'this-app',
    offered: null,
    asked: null,
    action: { text: todo.text, files: todo.files },
  }
}

interface Waits {
  readonly todos?: readonly PersonTodo[]
  readonly incidents?: readonly WorkIncident[]
  readonly lastLookAnswered?: { readonly todos: boolean; readonly incidents: boolean }
  readonly rowsUnread?: number
  readonly ledgersSkipped?: number
}

/** The queue, supplied the work waits (and any stall or stop walks) and doors that record presses. */
function supply(
  waits: Waits,
  {
    answer = async () => null,
    handBack = async () => 'Taken back.',
    stalled,
    stopped,
  }: {
    answer?: (requestId: string) => Promise<string | null>
    handBack?: (label: string) => Promise<string>
    stalled?: LedgerWalk<StalledWork>
    stopped?: LedgerWalk<StoppedWorkForAPerson>
  } = {},
): Doors {
  const doors: Doors = { answered: [], handed: [], opened: [], files: [] }
  const answered = waits.lastLookAnswered ?? { todos: true, incidents: true }
  usePersonsQueue().supply(
    answered.todos ? { ...EMPTY<PersonsQuestion>(), rows: (waits.todos ?? []).map(asARow) } : null,
    EMPTY<PersonsDecision>(),
    {
      held: new Set<string>(),
      answerable: new Map<string, AttentionRequest>(),
      now: AT + 60_000,
      lastLookAnswered: { questions: answered.todos, decisions: true },
      answeredFromHere: new Set<string>(),
    },
    {
      travel: () => {},
      settle: () => {},
      takeOver: () => {},
      open: (sessionId) => doors.opened.push(sessionId),
      handBack: (label) => {
        doors.handed.push(label)
        return handBack(label)
      },
      answerTodo: (sessionId, requestId, done, note) => {
        doors.answered.push({ sessionId, requestId, done, note })
        return answer(requestId)
      },
      openFile: (resource) => doors.files.push(resource),
    },
    undefined,
    stalled === undefined ? undefined : { walked: stalled, lastLookAnswered: true },
    undefined,
    undefined,
    undefined,
    stopped === undefined ? undefined : { walked: stopped, lastLookAnswered: true },
    {
      incidents: waits.incidents ?? null,
      lastLookAnswered: answered.incidents,
      rowsUnread: waits.rowsUnread ?? 0,
      ...(waits.ledgersSkipped === undefined ? {} : { ledgersSkipped: waits.ledgersSkipped }),
    },
  )
  return doors
}

const waitingOnYou = async () => {
  await page.viewport(1400, 1200)
  const m = mount(WaitingOnYou, { needsYou: [], clock: AT + 60_000 }, { width: 1351, height: 1200 })
  await settle()
  return m
}

function heldAnswer<T>(): { door: () => Promise<T>; answer: (value: T) => void } {
  let answer: (value: T) => void = () => {}
  const pending = new Promise<T>((done) => (answer = done))
  return { door: () => pending, answer }
}

describe('a to-do an agent asked of a person', () => {
  it('is drawn whole with its text, files, note box and presses, and counted as owed', async () => {
    const doors = supply({ todos: [TODO] })
    const m = await waitingOnYou()
    const head = m.q('waiting-todo-head-req_board')
    expect(read(head)).toBe('Ada asks you to do this · W3.1')
    expect(read(m.q('waiting-todo-text-req_board'))).toBe(TODO.text)
    expect(read(m.q('todos-count'))).toBe('1')
    const note = m.q('waiting-todo-note-req_board') as HTMLTextAreaElement
    expect(note.placeholder).toBe('Add a note (optional)')
    for (const cy of ['head', 'text', 'done', 'cant']) {
      assertDrawn(m.q(`waiting-todo-${cy}-req_board`), `the to-do's ${cy}`)
    }
    expect(read(m.q('waiting-todo-done-req_board'))).toBe('Done')
    expect(read(m.q('waiting-todo-cant-req_board'))).toBe("Can't do it")
    m.q('waiting-todo-file-req_board-res_italian').click()
    expect(doors.files).toEqual(['res_italian'])
    // Owed by a person, so the page does not call itself quiet over it.
    expect(read(m.q('waiting-stat'))).not.toBe('All clear')
  })

  it('Done sends the note once and says so in place; the presses go', async () => {
    const held = heldAnswer<string | null>()
    const doors = supply({ todos: [TODO] }, { answer: held.door })
    const m = await waitingOnYou()
    const note = m.q('waiting-todo-note-req_board') as HTMLTextAreaElement
    note.value = '  Got lost at move 6.  '
    note.dispatchEvent(new Event('input'))
    const done = m.q('waiting-todo-done-req_board') as HTMLButtonElement
    done.click()
    done.click()
    await nextTick()
    expect(doors.answered).toEqual([
      { sessionId: 'sess_ada', requestId: 'req_board', done: true, note: 'Got lost at move 6.' },
    ])
    expect(done.disabled).toBe(true)
    held.answer(null)
    await settle()
    const said = m.q('waiting-todo-said-req_board')
    expect(read(said)).toBe('Done. Ada is told.')
    expect(said.getAttribute('role')).toBe('status')
    assertDrawn(said, 'what Done came to')
    expect(m.all('waiting-todo-done-req_board')).toEqual([])
  })

  it("Can't do it refused says the host's words, and the presses work again", async () => {
    const doors = supply(
      { todos: [TODO] },
      { answer: async () => 'That to-do was already answered from another window.' },
    )
    const m = await waitingOnYou()
    m.q('waiting-todo-cant-req_board').click()
    await settle()
    expect(doors.answered[0]).toMatchObject({ done: false })
    expect(read(m.q('waiting-todo-said-req_board'))).toBe(
      'That to-do was already answered from another window.',
    )
    expect((m.q('waiting-todo-cant-req_board') as HTMLButtonElement).disabled).toBe(false)
  })

  it("Can't do it taken says so in place", async () => {
    supply({ todos: [TODO] })
    const m = await waitingOnYou()
    m.q('waiting-todo-cant-req_board').click()
    await settle()
    expect(read(m.q('waiting-todo-said-req_board'))).toBe("Sent. Ada is told you can't do it.")
  })

  it('an answer that lands after the queue was forgotten revives nothing', async () => {
    const held = heldAnswer<string | null>()
    supply({ todos: [TODO] }, { answer: held.door })
    const m = await waitingOnYou()
    m.q('waiting-todo-done-req_board').click()
    await nextTick()
    usePersonsQueue().forget()
    supply({ todos: [] }, { answer: held.door })
    held.answer(null)
    await settle()
    expect(m.host.querySelector('[data-cy="waiting-todo-req_board"]')).toBeNull()
  })

  it('is not drawn again as a question, and counts once', async () => {
    supply({ todos: [TODO] })
    const m = await waitingOnYou()
    expect(m.all('waiting-todo-req_board')).toHaveLength(1)
    expect(m.host.querySelector('[data-cy="yours-group"]')).toBeNull()
    expect(read(m.q('todos-count'))).toBe('1')
  })

  it('the corner copy counts it and draws it', async () => {
    supply({ todos: [TODO] })
    await page.viewport(900, 700)
    const m = mount(PersonsQueue as never, { floating: true }, { width: 260, height: 680 })
    await settle()
    m.q('persons-queue-toggle').click()
    await settle()
    expect(read(m.q('persons-queue-heading'))).toBe('An agent asked you to do something')
    expect(read(m.q('persons-queue-count'))).toBe('1')
    assertDrawn(m.q('persons-queue-todo-done-req_board'), "the corner's Done")
  })
  it('Open the conversation leaves the floating sheet before selecting its holder', async () => {
    const doors = supply({ todos: [TODO] })
    let openedAtClose: string[] | null = null
    const Layer = defineComponent({
      setup: () => () =>
        h(
          OverlayHost,
          { label: 'Sample report', onClose: () => (openedAtClose = [...doors.opened]) },
          () => h('p', 'Sample report'),
        ),
    })
    const m = mount(Layer, {}, { width: 900, height: 700 })
    await settle()
    m.q('persons-queue-toggle').click()
    await settle()
    m.q('persons-queue-todo-open-req_board').click()
    expect(openedAtClose).toEqual([])
    expect(doors.opened).toEqual([TODO.askedBy])
  })
})

describe('work that needs you', () => {
  const cases: [WorkIncident, string][] = [
    [
      incident(),
      'W3.1 with Ada is marked waiting, but not on anything. Look, or take it back for BroBot to redo or give again.',
    ],
    [
      incident({ kind: 'stopped', cause: 'app_restarted' }),
      'W3.1 with Ada stopped: the app restarted while it was open. Look, or take it back for BroBot to redo or give again.',
    ],
    [
      incident({ kind: 'wait-target-ended', giverName: null }),
      'W3.1 with Ada is waiting on something that has ended. Look, or take it back for its giver to redo or give again.',
    ],
    [
      incident({ kind: 'wait-target-ended' }),
      'W3.1 with Ada is waiting on something that has ended. Look, or take it back for BroBot to redo or give again.',
    ],
    [
      incident({ kind: 'wait-target-missing' }),
      'W3.1 with Ada is waiting on something this app can no longer find. Look, or take it back for BroBot to redo or give again.',
    ],
    [
      incident({ kind: 'notice-not-delivered' }),
      'W3.1 with Ada stopped, and the notice to BroBot did not arrive. Look, or take it back for BroBot to redo or give again.',
    ],
  ]
  it.each(cases)('names the agent, the piece and the cause: %#', async (one, words) => {
    supply({ incidents: [one] })
    const m = await waitingOnYou()
    const says = m.q('waiting-incidents-says-work_31')
    expect(read(says)).toBe(words)
    assertDrawn(says, 'the incident')
    assertDrawn(m.q('waiting-incidents-look-work_31'), 'Look')
    assertDrawn(m.q('waiting-incidents-take-back-work_31'), 'Take back')
  })

  it('Look opens the holder; Take back asks once by label and says the answer in place', async () => {
    const held = heldAnswer<string>()
    const doors = supply({ incidents: [incident()] }, { handBack: held.door })
    const m = await waitingOnYou()
    m.q('waiting-incidents-look-work_31').click()
    expect(doors.opened).toEqual(['sess_ada'])
    const press = m.q('waiting-incidents-take-back-work_31') as HTMLButtonElement
    press.click()
    press.click()
    await nextTick()
    expect(doors.handed).toEqual(['W3.1'])
    expect(press.disabled).toBe(true)
    held.answer('Taken back.')
    await settle()
    expect(read(m.q('waiting-incidents-said-work_31'))).toBe('Taken back.')
  })

  it('is counted as owed, under its own heading', async () => {
    supply({ incidents: [incident()] })
    const m = await waitingOnYou()
    expect(read(m.q('incidents-group').querySelector('span')!)).toBe('Work that needs you')
    expect(read(m.q('incidents-count'))).toBe('1')
    // Counted as owed: the stat names a number, never the all-clear or "Nothing".
    expect(read(m.q('waiting-stat'))).not.toBe('All clear')
    expect(read(m.q('waiting-stat'))).not.toBe('Nothing')
  })

  it('the control: a recovery is not counted as owed', async () => {
    supply({ incidents: [recovery()] })
    const m = await waitingOnYou()
    expect(m.host.querySelector('[data-cy="incidents-group"]')).toBeNull()
    // Owed by nobody and no amber line: the page is clear beside it.
    expect(read(m.q('waiting-stat'))).toBe('All clear')
  })
})

describe('each piece is drawn once', () => {
  it('two incidents for one piece are one entry, the newest', async () => {
    supply({
      incidents: [
        incident({ since: AT }),
        incident({ kind: 'stopped', cause: 'turn_interrupted', since: AT + 1000 }),
      ],
    })
    const m = await waitingOnYou()
    expect(m.all('waiting-incidents-work_31')).toHaveLength(1)
    expect(read(m.q('waiting-incidents-says-work_31'))).toContain(
      'the turn it was running in was stopped',
    )
  })

  it('a recovery speaks for its piece over an incident', async () => {
    supply({
      incidents: [incident({ piece: 'work_41', label: 'W4.1', since: AT + 5000 }), recovery()],
    })
    const m = await waitingOnYou()
    expect(m.host.querySelector('[data-cy="waiting-incidents-work_41"]')).toBeNull()
    expect(m.all('waiting-recoveries-work_41')).toHaveLength(1)
  })

  it('a piece needing a look is not drawn again as stalled or stopped', async () => {
    const stalled = {
      ...EMPTY<StalledWork>(),
      rows: [
        {
          piece: 'work_31',
          label: 'W3.1',
          title: 'Coach',
          owner: 'sess_ada',
          ownerName: 'Ada',
          giver: 'sess_bro',
          giverName: 'BroBot',
          because: 'turn_ended',
          stalledAt: AT,
        } as StalledWork,
      ],
    }
    const stopped = {
      ...EMPTY<StoppedWorkForAPerson>(),
      rows: [
        {
          piece: 'work_31',
          label: 'W3.1',
          title: 'Coach',
          holder: 'sess_ada',
          holderName: 'Ada',
          giver: 'sess_bro',
          giverName: 'BroBot',
          at: AT,
        },
      ],
    }
    supply({ incidents: [incident()] }, { stalled, stopped })
    const m = await waitingOnYou()
    expect(m.all('waiting-incidents-work_31')).toHaveLength(1)
    expect(m.host.querySelector('[data-cy="persons-queue-stall"]')).toBeNull()
    expect(m.host.querySelector('[data-cy="persons-queue-stopped-work_31"]')).toBeNull()
  })

  it('the control: with no incident, the stalled band draws the piece as before', async () => {
    const stalled = {
      ...EMPTY<StalledWork>(),
      rows: [
        {
          piece: 'work_31',
          label: 'W3.1',
          title: 'Coach',
          owner: 'sess_ada',
          ownerName: 'Ada',
          giver: 'sess_bro',
          giverName: 'BroBot',
          because: 'turn_ended',
          stalledAt: AT,
        } as StalledWork,
      ],
    }
    supply({}, { stalled })
    const m = await waitingOnYou()
    expect(m.all('persons-queue-stall')).toHaveLength(1)
  })
})

describe('picking work back up', () => {
  it('pending says it picks up again, with Look and no Take back', async () => {
    supply({ incidents: [recovery()] })
    const m = await waitingOnYou()
    const says = m.q('waiting-recoveries-says-work_41')
    expect(read(says)).toBe('W4.1 with Ali picks up again.')
    assertDrawn(says, 'the pending recovery')
    expect(visible(m.q('waiting-recoveries-look-work_41'))).toBe(true)
    expect(m.host.querySelector('[data-cy="waiting-recoveries-take-back-work_41"]')).toBeNull()
  })

  it.each([
    [
      'recovery-declined',
      'W4.1 with Ali was not picked back up. Look, or take it back for BroBot to redo or give again.',
    ],
    [
      'recovery-failed',
      'W4.1 with Ali could not be picked back up. Look, or take it back for BroBot to redo or give again.',
    ],
  ] as const)('%s says so, with Look and Take back', async (kind, words) => {
    supply({ incidents: [recovery({ kind })] })
    const m = await waitingOnYou()
    expect(read(m.q('waiting-recoveries-says-work_41'))).toBe(words)
    assertDrawn(m.q('waiting-recoveries-take-back-work_41'), 'Take back')
  })

  it.each([
    [
      { kind: 'recovery-pending', recovery: { because: 'usage-limit', resumesAt: NINE } },
      `W4.1 with Ali picks up again tomorrow at ${clockTime(NINE)}, once its usage limit resets.`,
    ],
    [
      { kind: 'recovery-pending', recovery: { because: 'usage-limit', resumesAt: AT + 3_600_000 } },
      `W4.1 with Ali picks up again at ${clockTime(AT + 3_600_000)}, once its usage limit resets.`,
    ],

    [
      { kind: 'recovery-pending', recovery: { because: 'sign-in', resumesAt: null } },
      'W4.1 with Ali picks up again, once its sign-in is renewed.',
    ],
    [
      { kind: 'recovery-declined', recovery: { because: 'sign-in', resumesAt: null } },
      'W4.1 with Ali was not picked back up after a sign-in problem. Look, or take it back for BroBot to redo or give again.',
    ],
    [
      { kind: 'recovery-failed', recovery: { because: 'program', resumesAt: null } },
      'W4.1 with Ali could not be picked back up after its program stopped. Look, or take it back for BroBot to redo or give again.',
    ],
    [
      { kind: 'recovery-pending', recovery: { because: 'app-restart', resumesAt: null } },
      'W4.1 with Ali picks up again shortly, after BroCrew restarted.',
    ],
    [
      { kind: 'recovery-declined', recovery: { because: 'app-restart', resumesAt: null } },
      'W4.1 with Ali was not picked back up after BroCrew restarted. Look, or take it back for BroBot to redo or give again.',
    ],
    [
      { kind: 'recovery-failed', recovery: { because: 'app-restart', resumesAt: null } },
      'W4.1 with Ali could not be picked back up after BroCrew restarted. Look, or take it back for BroBot to redo or give again.',
    ],
  ] as const)('says why and when, where the host says them: %#', async (over, words) => {
    supply({ incidents: [recovery(over as Partial<WorkIncident>)] })
    const m = await waitingOnYou()
    expect(read(m.q('waiting-recoveries-says-work_41'))).toBe(words)
  })

  it('a later day is named, in the Mac’s own way of writing a date', async () => {
    supply({
      incidents: [
        recovery({
          recovery: { because: 'usage-limit', resumesAt: FRIDAY },
        } as Partial<WorkIncident>),
      ],
    })
    const m = await waitingOnYou()
    // The day's spelling is the Mac's locale ("Fri 16 Oct" or "Fri Oct 16"); its parts are fixed.
    expect(read(m.q('waiting-recoveries-says-work_41'))).toMatch(
      new RegExp(
        `^W4\\.1 with Ali picks up again on Fri (16 Oct|Oct 16) at ${clockTime(FRIDAY)}, once its usage limit resets\\.$`,
      ),
    )
  })

  it('a look that did not answer says so, once per reading', async () => {
    supply({ lastLookAnswered: { todos: false, incidents: false } })
    const m = await waitingOnYou()
    for (const part of ['todos', 'incidents']) {
      expect(visible(m.q(`waiting-${part}-unread`)), part).toBe(true)
    }
    expect(m.host.querySelector('[data-cy="waiting-recoveries-unread"]')).toBeNull()
  })

  it('a piece a person gave offers Look only, and says so', async () => {
    supply({
      incidents: [incident({ kind: 'stopped', cause: 'turn_ended', giver: null, giverName: null })],
    })
    const m = await waitingOnYou()
    expect(read(m.q('waiting-incidents-says-work_31'))).toBe(
      'W3.1 with Ada stopped: its turn ended with this work still open. Look to see where it stands.',
    )
    expect(m.host.querySelector('[data-cy="waiting-incidents-take-back-work_31"]')).toBeNull()
  })
})

describe('a typed wait says what it waits on where its holder read idle', () => {
  const rail = async (on: WaitOn | undefined) => {
    const [row] = workerRows(1)
    const rows: ResumableSessionInfo[] = [
      {
        ...row!,
        state: { is: 'idle' },
        running: 'not-running',
        status: 'idle',
        named: { label: 'W90.1', title: 'Coach' },
        waitingOnPurpose: { label: 'W90.1', status: 'Coaching week.', ...(on ? { on } : {}) },
      },
    ]
    window.api = {
      runtime: { listResumable: async () => rows, listUnresumable: async () => [] },
    } as never
    const m = mount(
      SideRail,
      { open: [], activeId: null, place: null, agents: identities(1), collapsed: false },
      { width: 251.68, height: 1000 },
    )
    await settle()
    return read(m.q('rail-state-word-recipe-1'))
  }

  it.each([
    [{ kind: 'person', request: 'req_1' }, 'waiting on you'],
    [{ kind: 'agent', piece: 'work_12', label: 'W1.2' }, 'waiting on W1.2'],
    [{ kind: 'agent', request: 'req_2' }, 'waiting on an answer'],
    [{ kind: 'time', at: NINE }, `waiting until ${clockTime(NINE)}`],
    [{ kind: 'event', job: 'job_1' }, 'waiting for a scheduled job'],
    [{ kind: 'event', background: 'bg_1' }, 'waiting for a background command'],
  ] as const)('%o', async (on, words) => {
    expect(await rail(on as WaitOn)).toBe(words)
  })

  it('an agent wait the host names says the agent', async () => {
    const [row] = workerRows(1)
    const rows: ResumableSessionInfo[] = [
      {
        ...row!,
        state: { is: 'idle' },
        running: 'not-running',
        status: 'idle',
        named: { label: 'W90.1', title: 'Coach' },
        waitingOnPurpose: {
          label: 'W90.1',
          status: 'Coaching week.',
          on: { kind: 'agent', piece: 'work_12', label: 'W1.2' },
          agentName: 'Ada',
        },
      },
    ]
    window.api = {
      runtime: { listResumable: async () => rows, listUnresumable: async () => [] },
    } as never
    const m = mount(
      SideRail,
      { open: [], activeId: null, place: null, agents: identities(1), collapsed: false },
      { width: 251.68, height: 1000 },
    )
    await settle()
    expect(read(m.q('rail-state-word-recipe-1'))).toBe('waiting on Ada')
  })

  it('the control: a bare wait keeps "waiting on purpose"', async () => {
    expect(await rail(undefined)).toBe('waiting on purpose')
  })
})

describe('an incidents walk that answered without reading everything', () => {
  const shorts: { rowsUnread: number; ledgersSkipped?: number }[] = [
    { rowsUnread: 1 },
    { rowsUnread: 0, ledgersSkipped: 2 },
  ]
  it.each(shorts)('says so and never reads all clear: %o', async (short) => {
    supply({ incidents: [], ...short })
    const m = await waitingOnYou()
    const line = m.q('waiting-incidents-short')
    expect(visible(line)).toBe(true)
    assertDrawn(line, 'the could-not-read line')
    expect(read(m.q('waiting-stat'))).not.toBe('All clear')
    expect(m.host.querySelector('[data-cy="waiting-incidents-unread"]')).toBeNull()
  })

  it('the control: a whole walk with nothing in it draws no group and reads all clear', async () => {
    supply({ incidents: [] })
    const m = await waitingOnYou()
    expect(m.host.querySelector('[data-cy="incidents-group"]')).toBeNull()
    expect(read(m.q('waiting-stat'))).toBe('All clear')
  })
})

describe('popups are drawn in the order they open, under one layer', () => {
  /** A screen with buttons that open each named popup, and the layer every popup is drawn into. */
  function screen(names: readonly string[], nested: Record<string, string> = {}) {
    const open = ref<Record<string, boolean>>({})
    const host = (name: string): ReturnType<typeof h> | null =>
      open.value[name]
        ? h(
            OverlayHost,
            { label: name, onClose: () => (open.value = { ...open.value, [name]: false }) },
            () => [
              h('p', { 'data-cy': `content-${name}` }, name),
              h('button', { 'data-cy': `button-${name}` }, `A press in ${name}`),
              ...Object.entries(nested)
                .filter(([, outer]) => outer === name)
                .map(([inner]) => host(inner)),
            ],
          )
        : null
    const Screen = defineComponent({
      setup() {
        const layer = ref<HTMLElement | null>(null)
        provideOverlayLayer(layer)
        return () =>
          h('div', [
            ...names.map((name) =>
              h(
                'button',
                {
                  'data-cy': `open-${name}`,
                  onClick: () => (open.value = { ...open.value, [name]: true }),
                },
                name,
              ),
            ),
            ...names.filter((name) => nested[name] === undefined).map(host),
            h('div', { ref: layer, 'data-cy': 'layer' }),
          ])
      },
    })
    const m = mount(Screen, {}, { width: 1200, height: 800 })
    const press = async (name: string): Promise<void> => {
      const button = m.q(`open-${name}`)
      button.focus()
      button.click()
      await settle()
    }
    return { m, open, press }
  }

  const onTopIs = (name: string): boolean => {
    const hit = document.elementFromPoint(600, 400)
    const host = [...document.querySelectorAll<HTMLElement>('[data-cy="overlay-host"]')].find(
      (one) => one.getAttribute('aria-label') === name,
    )
    return (
      host !== undefined && host.contains(hit) && hit?.closest('[data-cy="overlay-host"]') === host
    )
  }

  const escape = async (): Promise<void> => {
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    await settle()
  }

  const openNow = (): string[] =>
    [...document.querySelectorAll<HTMLElement>('[data-cy="overlay-host"]')].map(
      (one) => one.getAttribute('aria-label') ?? '',
    )

  it('twelve popups, opened last-in-the-page first: the newest is on top and closes first', async () => {
    const names = Array.from({ length: 12 }, (_, i) => `sheet-${String(i + 1)}`)
    await page.viewport(1200, 800)
    const { press } = screen(names)
    for (const name of [...names].reverse()) await press(name)
    expect(openNow()).toHaveLength(12)
    expect(onTopIs('sheet-1')).toBe(true)
    await escape()
    expect(openNow()).not.toContain('sheet-1')
    expect(onTopIs('sheet-2')).toBe(true)
  })

  it('a popup closed and opened again is on top again', async () => {
    await page.viewport(1200, 800)
    const { open, press } = screen(['first', 'second'])
    await press('first')
    await press('second')
    open.value = { ...open.value, first: false }
    await settle()
    await press('first')
    expect(onTopIs('first')).toBe(true)
    await escape()
    expect(openNow()).toEqual(['second'])
  })

  it('a popup opened from inside another, after a sibling, is on top and closes first', async () => {
    await page.viewport(1200, 800)
    const { open, press } = screen(['outer', 'sibling', 'inner'], { inner: 'outer' })
    await press('outer')
    await press('sibling')
    open.value = { ...open.value, inner: true }
    await settle()
    expect(onTopIs('inner')).toBe(true)
    await escape()
    expect(openNow()).not.toContain('inner')
    expect(onTopIs('sibling')).toBe(true)
  })

  it('an outer and an inner popup opened in one render: the inner is on top and owns the keys', async () => {
    await page.viewport(1200, 800)
    const { m, open } = screen(['outer', 'inner'], { inner: 'outer' })
    open.value = { outer: true, inner: true }
    await settle()
    expect(onTopIs('inner')).toBe(true)
    // Tab stays inside the inner popup.
    for (let i = 0; i < 3; i++) {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab' }))
      await settle()
      expect(document.activeElement).toBe(m.q('button-inner'))
    }
    await escape()
    expect(openNow()).toEqual(['outer'])
    await escape()
    expect(openNow()).toEqual([])
  })

  it('each popup gives the focus back to what opened it when it closes', async () => {
    await page.viewport(1200, 800)
    const { m, press } = screen(['first', 'second'])
    await press('first')
    // The second is opened by a press while the first is open, from the screen's own button.
    await press('second')
    await escape()
    expect(document.activeElement).toBe(m.q('open-second'))
    await escape()
    expect(document.activeElement).toBe(m.q('open-first'))
  })

  it('a to-do’s file opened over a sheet is on top and closes first', async () => {
    const sheetOpen = ref(true)
    const viewer = ref<{ open: (id: string) => Promise<void> } | null>(null)
    const Screen = defineComponent({
      setup() {
        const layer = ref<HTMLElement | null>(null)
        provideOverlayLayer(layer)
        return () =>
          h('div', [
            h(CanonicalDocumentOverlay as never, {
              ref: viewer,
              read: async (id: string) => ({
                ok: true,
                resourceId: id,
                name: 'italian-game.md',
                form: 'markdown',
                text: '# The Italian Game\n',
                bytes: 20,
              }),
            }),
            sheetOpen.value
              ? h(
                  OverlayHost,
                  { label: 'New agent', onClose: () => (sheetOpen.value = false) },
                  () => h('p', 'A new agent'),
                )
              : null,
            h('div', { ref: layer }),
          ])
      },
    })
    await page.viewport(1200, 800)
    mount(Screen, {}, { width: 1200, height: 800 })
    await settle()
    await viewer.value!.open('res_italian')
    await settle()
    expect(openNow()).toHaveLength(2)
    expect(onTopIs('Document')).toBe(true)
    expect(onTopIs('New agent')).toBe(false)
    await escape()
    expect(openNow()).toEqual(['New agent'])
    await escape()
    expect(openNow()).toEqual([])
  })
})
