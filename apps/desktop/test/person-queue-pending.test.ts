import { describe, expect, it, vi } from 'vitest'
import {
  createPersonsQueue,
  type PersonsQueue,
  type PersonsQueueDoors,
  type StoppedWorkRow,
} from '../src/renderer/src/lib/persons-queue'
import type { TodoRow, WorkEntry } from '../src/renderer/src/lib/work-waits'

const stop: StoppedWorkRow = {
  key: 'piece',
  sessionId: 'session',
  label: 'W1.2',
  who: 'W1.2 with Ada',
  what: 'A small task',
  says: 'Stopped',
  at: 10,
}
const todo: TodoRow = {
  key: 'request',
  sessionId: 'session',
  askedByName: 'Ada',
  head: 'Ada asks',
  text: 'Check the result',
  files: [],
}
const entry: WorkEntry = {
  key: 'piece',
  sessionId: 'session',
  label: 'W1.2',
  says: 'Needs a look',
  mayTakeBack: true,
  kind: 'stopped',
}

interface Card {
  pending: boolean
  said: string | null
  listed: boolean
  taken?: boolean
}
interface Action {
  name: string
  invoke(queue: PersonsQueue): void
  cards(queue: PersonsQueue): readonly Card[]
  input: unknown[]
  answer: string | null
  said: string
}
const actions: Action[] = [
  {
    name: 'stopped work',
    invoke: (q) => q.handBack(stop),
    cards: (q) => q.stoppedCards.value,
    input: ['W1.2'],
    answer: 'Taken back.',
    said: 'Taken back.',
  },
  {
    name: 'to-do',
    invoke: (q) => q.answerTodo(todo, false, '  Later.  '),
    cards: (q) => q.todoCards.value,
    input: ['session', 'request', false, 'Later.'],
    answer: null,
    said: "Sent. Ada is told you can't do it.",
  },
  {
    name: 'work entry',
    invoke: (q) => q.takeBackEntry('incidents', entry),
    cards: (q) => q.workCards.value.incidents,
    input: ['W1.2'],
    answer: 'Taken back.',
    said: 'Taken back.',
  },
]

function supply(queue: PersonsQueue, doors: Partial<PersonsQueueDoors> = {}) {
  queue.supply(
    null,
    null,
    {
      held: new Set(),
      answerable: new Map(),
      answeredFromHere: new Set(),
      now: 20,
      lastLookAnswered: { questions: false, decisions: false },
    },
    { travel: () => {}, settle: () => {}, takeOver: () => {}, open: () => {}, ...doors },
  )
}

function deferred() {
  let resolve!: (answer: string | null) => void
  let reject!: (error: Error) => void
  const promise = new Promise<string | null>((yes, no) => {
    resolve = yes
    reject = no
  })
  return { promise, resolve, reject }
}

function doorsFor(held: ReturnType<typeof deferred>) {
  const handBack = vi.fn((_label: string) => held.promise as Promise<string>)
  const answerTodo = vi.fn(
    (_session: string, _request: string, _done: boolean, _note: string) => held.promise,
  )
  return { handBack, answerTodo }
}

async function settle() {
  await Promise.resolve()
  await Promise.resolve()
  await Promise.resolve()
}

describe.each(actions)('$name pending bookkeeping', (action) => {
  it('keeps one press and its payload/result through refresh and retry', async () => {
    const queue = createPersonsQueue()
    const held = deferred()
    const doors = doorsFor(held)
    supply(queue, doors)
    action.invoke(queue)
    action.invoke(queue)
    const calls = [...doors.handBack.mock.calls, ...doors.answerTodo.mock.calls]
    expect(calls).toEqual([action.input])
    expect(action.cards(queue)).toMatchObject([{ listed: false, pending: true, said: null }])
    supply(queue, doors)
    expect(action.cards(queue)).toMatchObject([{ pending: true, said: null }])
    held.resolve(action.answer)
    await settle()
    expect(action.cards(queue)).toMatchObject([{ pending: false, said: action.said }])
    if (action.name === 'to-do') expect(action.cards(queue)[0].taken).toBe(true)
    const retry = deferred()
    supply(queue, doorsFor(retry))
    action.invoke(queue)
    expect(action.cards(queue)).toMatchObject([{ pending: true, said: null }])
    retry.resolve('The host refused this action.')
    await settle()
    expect(action.cards(queue)).toMatchObject([
      { pending: false, said: 'The host refused this action.' },
    ])
    if (action.name === 'to-do') expect(action.cards(queue)[0].taken).toBe(false)
  })

  it('does nothing without its domain door', () => {
    const queue = createPersonsQueue()
    supply(queue)
    action.invoke(queue)
    expect(action.cards(queue)).toEqual([])
  })

  it('forgets pending work without reviving it when the answer arrives', async () => {
    const queue = createPersonsQueue()
    const held = deferred()
    supply(queue, doorsFor(held))
    action.invoke(queue)
    queue.forget()
    held.resolve(action.answer)
    await settle()
    expect(action.cards(queue)).toEqual([])
  })

  it('does not let an earlier answer or cleanup overwrite a new press after forget', async () => {
    const queue = createPersonsQueue()
    const old = deferred()
    supply(queue, doorsFor(old))
    action.invoke(queue)
    queue.forget()
    const current = deferred()
    supply(queue, doorsFor(current))
    action.invoke(queue)
    old.resolve('An old answer')
    await settle()
    expect(action.cards(queue)).toMatchObject([{ pending: true, said: null }])
    current.resolve(action.answer)
    await settle()
    expect(action.cards(queue)).toMatchObject([{ pending: false, said: action.said }])
  })

  it('cleans up a rejected call without converting it into a domain result', async () => {
    const original = Promise.prototype.finally
    const endings: Promise<unknown>[] = []
    const observed = vi
      .spyOn(Promise.prototype, 'finally')
      .mockImplementation(function (this: Promise<unknown>, onFinally) {
        const ending = original.call(this, onFinally)
        void ending.catch(() => {})
        endings.push(ending)
        return ending
      })
    try {
      const queue = createPersonsQueue()
      const held = deferred()
      supply(queue, doorsFor(held))
      action.invoke(queue)
      const error = new Error('Door unavailable')
      held.reject(error)
      expect(endings).toHaveLength(1)
      await expect(endings[0]).rejects.toBe(error)
      expect(action.cards(queue)).toEqual([])
    } finally {
      observed.mockRestore()
    }
  })
})
