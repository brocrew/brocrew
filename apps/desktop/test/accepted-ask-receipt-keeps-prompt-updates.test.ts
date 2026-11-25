import { afterEach, describe, expect, it, vi } from 'vitest'
import { openDatabase } from '../src/main/db/connection'
import { createSessionStore, type SessionStore } from '../src/main/db/session-store'
import { agentToolsFor } from '../src/main/runtime/agent-tools'
import { agentCallerId } from '../src/main/runtime/conversation-caller'
import type { RuntimeHost } from '../src/main/runtime/runtime-host'
import type { TranscriptEvent } from '../src/shared/conversation-events'
import { theMessagesOf } from '../src/shared/runtime-ipc'
import { aServiceWorld } from './helpers/a-service-world'

const prefix = 'accepted Ask receipt'
const worlds: ReturnType<typeof aServiceWorld>[] = []
function world() {
  const fixture = aServiceWorld()
  worlds.push(fixture)
  return fixture
}
afterEach(async () => {
  vi.restoreAllMocks()
  for (const fixture of worlds.splice(0).reverse()) await fixture.cleanUp()
})

const prompt = 'Which version belongs in the record?'
const note = 'The cover sheet belongs beside it.'
const rows = (store: SessionStore, owner: string) => store.events(owner).map(({ event }) => event)
const byType = <T extends TranscriptEvent['type']>(events: TranscriptEvent[], type: T) =>
  events.filter((event): event is Extract<TranscriptEvent, { type: T }> => event.type === type)

function observation(store: SessionStore, owner: string, question = prompt) {
  const events = rows(store, owner)
  return {
    attempts: byType(events, 'ask_handoff_attempted'),
    rejected: byType(events, 'ask_handoff_not_accepted'),
    turns: byType(events, 'user_turn').filter((turn) => turn.text.includes(question)),
    notes: byType(events, 'user_turn').filter((turn) => turn.text.includes(note)),
    endings: byType(events, 'message_unqueued').filter((ending) => ending.reason === 'sent'),
    waiting: store.messagesWaitingIn(owner).map((message) => message.messageId),
  }
}

function observed(fixture: ReturnType<typeof world>, owner: string, question = prompt) {
  const db = openDatabase(fixture.db.name, { fileMustExist: true })
  try {
    return observation(createSessionStore(db), owner, question)
  } finally {
    db.close()
  }
}

async function pair(fixture: ReturnType<typeof world>) {
  fixture.anAgent('asker', 'normal')
  fixture.anAgent('recipient', 'normal')
  const host = fixture.aHost()
  const open = async (profileId: string) =>
    (
      await host.createSession(
        { provider: 'claude', profileId, approvalMode: 'auto', cwd: fixture.folder },
        fixture.window,
      )
    ).sessionId
  return { host, asker: await open('asker'), recipient: await open('recipient') }
}

const tool = (host: RuntimeHost, owner: string, name: string) =>
  agentToolsFor(host, owner).tools.find((candidate) => candidate.name === name)!

async function ask(host: RuntimeHost, asker: string, recipient: string, question = prompt) {
  const result = await tool(host, asker, 'ask_question').call({
    who_answers: 'an-agent',
    agent: recipient,
    question,
  })
  const id = result.structured?.question
  expect(typeof id, JSON.stringify(result.structured)).toBe('string')
  return id as string
}

function opening(store: SessionStore, asker: string, requestId: string) {
  const row = store
    .events(asker)
    .filter(({ event }) => event.type === 'request_routed' && event.requestId === requestId)
    .at(-1)
  if (!row || row.event.type !== 'request_routed') throw Error('Missing sender route')
  const expected = JSON.stringify([asker, store.theActiveGeneration(asker), row.ordinal])
  expect(row.event.originalOpening).toBe(expected)
  return expected
}

const calls = (fixture: ReturnType<typeof world>, profile = 'recipient') =>
  fixture.sent.filter(({ as, words }) => as === profile && words.includes(prompt))
const noteCalls = (fixture: ReturnType<typeof world>) =>
  fixture.sent.filter(({ as, words }) => as === 'recipient' && words.includes(note))
function park(fixture: ReturnType<typeof world>) {
  let release = () => {}
  fixture.turnsWait = new Promise<void>((resolve) => {
    release = resolve
  })
  return () => {
    fixture.turnsWait = null
    release()
  }
}

describe(prefix, () => {
  async function heldBatch() {
    const fixture = world()
    const { host, asker, recipient } = await pair(fixture)
    const release = park(fixture)
    try {
      await host.send(recipient, 'Keep the recipient busy.', fixture.window)
      const id = await ask(host, asker, recipient)
      const origin = opening(fixture.store, asker, id)
      await host.queueMessage(
        recipient,
        note,
        { ownerId: agentCallerId(asker) },
        [],
        'work',
        {},
        'note',
      )
      const queue = byType(fixture.ledger(recipient), 'message_queued').filter(
        ({ text }) => text.includes(prompt) || text.includes(note),
      )
      expect(queue.map(({ text }) => (text.includes(prompt) ? 'ask' : 'note'))).toEqual([
        'ask',
        'note',
      ])
      const held = queue.map(({ messageId }) => messageId)
      expect(observed(fixture, recipient).waiting).toEqual(expect.arrayContaining(held))
      expect(calls(fixture)).toHaveLength(0)
      await host.closeAll()
      const reopened = fixture.aHost({ deferStartupUntilFirstList: true })
      return { fixture, reopened, asker, recipient, requestId: id, origin, held }
    } finally {
      release()
    }
  }

  it('keeps the known prompt updates on the durable turn after a rolled-back receipt is retried', async () => {
    const { fixture, reopened, asker, recipient, requestId, origin, held } = await heldBatch()
    const db = openDatabase(fixture.db.name, { fileMustExist: true })
    const reader = createSessionStore(db)
    const read = () => observation(reader, recipient)
    // One known change the reopened conversation has not yet been told about.
    const notes = fixture.store.writeOwnNotes(
      'recipient',
      { expectedVersion: 0, text: 'Keep the cover sheet with the record.', why: 'Fictional note.' },
      { who: 'a-person' },
      Date.now(),
    )
    expect(notes?.version).toBe(1)
    const release = park(fixture)
    const beforeRollback: ReturnType<typeof read>[] = []
    const append = fixture.store.appendMany.bind(fixture.store)
    const failure = vi.spyOn(fixture.store, 'appendMany').mockImplementation((owner, entries) => {
      append(owner, entries)
      if (
        owner !== recipient ||
        !entries.some(
          ({ event }) =>
            event.type === 'user_turn' && event.parts?.some((part) => part.text.includes(prompt)),
        )
      )
        return
      if (beforeRollback.length > 0) return
      beforeRollback.push(read())
      throw Error('Fictional accepted Ask transaction rolled back')
    })
    try {
      await reopened.resumeSession(recipient, fixture.window)
      await vi.waitFor(() => expect(beforeRollback).not.toHaveLength(0))
      expect(beforeRollback[0]).toMatchObject({
        attempts: [expect.objectContaining({ type: 'ask_handoff_attempted' })],
        rejected: [],
        turns: [],
        notes: [],
        endings: [],
        waiting: expect.arrayContaining(held),
      })
      expect(calls(fixture)).toHaveLength(1)
      expect(noteCalls(fixture)).toHaveLength(1)
      const words = calls(fixture)[0]!.words
      expect(words).toContain(note)
      expect(words.indexOf(prompt)).toBeLessThan(words.indexOf(note))
      const pending = read()
      expect(pending.attempts).toHaveLength(1)
      expect(pending.attempts[0]?.originals).toEqual([
        { opening: origin, inputIndex: 0, heldMessageId: held[0] },
      ])
      release()
      await vi.waitFor(() => expect(read().turns).toHaveLength(1))
      const accepted = read()
      expect(accepted.attempts).toHaveLength(1)
      expect(accepted.turns[0]?.askHandoffAttempt).toBe(pending.attempts[0]?.attempt)
      expect(theMessagesOf(accepted.turns[0]!).map((part) => part.originalOpening)).toEqual([
        origin,
        undefined,
      ])
      const reminders = byType(rows(reader, recipient), 'message_queued').filter(
        (entry) =>
          entry.appNotice === 'an-answer-is-still-owed' &&
          entry.asks?.asker === asker &&
          entry.asks.requestId === requestId,
      )
      expect(reminders).toHaveLength(1)
      const [reminder] = reminders
      if (reminder === undefined) throw Error('The queued owed-Ask reminder is missing')
      expect(reminder.asks?.originalOpening).toBeUndefined()
      expect(held).not.toContain(reminder.messageId)
      const originalEndings = accepted.endings.slice(0, -1)
      expect(originalEndings.map(({ messageId }) => messageId)).toEqual(held)
      expect(accepted.endings.at(-1)).toMatchObject({
        messageId: reminder.messageId,
        text: reminder.text,
        reason: 'sent',
      })
      const acceptedCalls = calls(fixture)
      expect(acceptedCalls).toHaveLength(1)
      expect(noteCalls(fixture)).toEqual(acceptedCalls)
      // The new obligation: the known change rides the durable turn the retry recorded.
      expect(accepted.turns[0]?.promptUpdates).toMatchObject({ notes: '1' })
    } finally {
      release()
      failure.mockRestore()
      db.close()
    }
  })
})
