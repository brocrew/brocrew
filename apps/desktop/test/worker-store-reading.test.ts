import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { aServiceWorld, type AServiceWorld } from './helpers/a-service-world'
import { rowsUnreadOnce } from '../src/main/db/session-store'

// Only fictional SQLite rows are used. No host or provider is opened in this suite.
describe('complete bounded worker store reads', () => {
  let world: AServiceWorld
  const rowBound = 8192
  const byteBound = 8 * 1024 * 1024

  beforeEach(() => {
    world = aServiceWorld()
  })
  afterEach(async () => {
    await world.cleanUp()
  })

  function conversation(id: string) {
    world.store.create({
      id,
      provider: 'codex',
      cwd: world.folder,
      approvalMode: 'ask',
      profileId: 'document-reader',
    })
  }

  // Raw inserts make corruption and exact budgets possible without asking the writer to repair them.
  function rows(
    id: string,
    count: number,
    make: (ordinal: number) => { type: string; payload: string },
    generation = 0,
    first = 0,
  ) {
    const insert = world.db.prepare(`INSERT INTO events
      (id, session_id, ordinal, type, payload, created_at, generation)
      VALUES (?, ?, ?, ?, ?, ?, ?)`)
    world.db.transaction(() => {
      for (let ordinal = first; ordinal < first + count; ordinal++) {
        const row = make(ordinal)
        insert.run(
          `${id}-${generation}-${ordinal}`,
          id,
          ordinal,
          row.type,
          row.payload,
          100 + ordinal,
          generation,
        )
      }
    })()
  }

  function row(
    id: string,
    ordinal: number,
    event: { type: string; [key: string]: unknown },
    generation = 0,
  ) {
    rows(id, 1, () => ({ type: event.type, payload: JSON.stringify(event) }), generation, ordinal)
  }

  function corrupt(id: string, ordinal: number, payload: string) {
    world.db
      .prepare(
        'UPDATE events SET payload = ? WHERE session_id = ? AND generation = 0 AND ordinal = ?',
      )
      .run(payload, id, ordinal)
  }

  const idle = { type: 'status', state: 'idle' }
  const queued = (messageId: string) => ({
    type: 'message_queued',
    messageId,
    kind: 'work',
    text: messageId,
  })
  const ended = (messageId: string) => ({ type: 'message_unqueued', messageId, reason: 'sent' })
  const routed = (requestId: string, parent: string | null) => ({
    type: 'request_routed',
    requestId,
    parent,
    to: parent === null ? 'a-person' : 'an-agent',
  })

  function replace(from: string, to: string, ordinal = 0) {
    row(from, ordinal, { type: 'replaced_by', sessionId: to })
  }

  it('returns a complete ordered ledger, and returns unknown for any torn payload', () => {
    conversation('reader')
    expect(world.store.workerLedger('missing-reader')).toBeNull()
    expect(world.store.workerLedger('reader')).toEqual([])
    row('reader', 0, idle)
    row('reader', 1, queued('brief'))
    expect(world.store.workerLedger('reader')).toEqual([
      { ordinal: 0, at: 100, event: idle },
      { ordinal: 1, at: 101, event: queued('brief') },
    ])
    for (const payload of ['{', '[]', '{}', '{"type":7}']) {
      corrupt('reader', 1, payload)
      expect(world.store.workerLedger('reader')).toBeNull()
    }
  })

  it('accepts the ledger row boundary and refuses a complete-looking truncated prefix', () => {
    conversation('reader')
    rows('reader', rowBound, () => ({ type: idle.type, payload: JSON.stringify(idle) }))
    const complete = world.store.workerLedger('reader')
    expect(complete).toHaveLength(rowBound)
    expect(complete?.at(-1)).toEqual({ ordinal: rowBound - 1, at: 100 + rowBound - 1, event: idle })
    row('reader', rowBound, idle)
    expect(world.store.workerLedger('reader')).toBeNull()
  })

  it('budgets aggregate UTF-8 ledger bytes, accepting exactly 8 MiB and refusing one more byte', () => {
    conversation('reader')
    function padded(bytes: number) {
      const empty = JSON.stringify({ ...idle, padding: '' })
      const remaining = bytes - Buffer.byteLength(empty)
      const payload = JSON.stringify({
        ...idle,
        padding: 'é'.repeat(Math.floor(remaining / 2)) + 'x'.repeat(remaining % 2),
      })
      expect(Buffer.byteLength(payload)).toBe(bytes)
      expect(payload.length).toBeLessThan(bytes)
      return payload
    }
    const first = padded(byteBound / 2)
    const second = padded(byteBound / 2)
    rows('reader', 2, (ordinal) => ({ type: idle.type, payload: ordinal === 0 ? first : second }))
    expect(world.store.workerLedger('reader')).toHaveLength(2)
    corrupt('reader', 1, padded(byteBound / 2 + 1))
    expect(world.store.workerLedger('reader')).toBeNull()
  })

  it('consumes a shared row and byte budget across ledgers, including unreadable ones', () => {
    for (const id of ['first-reader', 'second-reader', 'torn-reader']) conversation(id)
    for (const id of ['first-reader', 'second-reader']) {
      rows(id, 2, () => ({ type: idle.type, payload: JSON.stringify(idle) }))
    }
    rows('torn-reader', 1, () => ({ type: 'status', payload: '{' }))
    const twoRowsBytes = 2 * Buffer.byteLength(JSON.stringify(idle))
    const complete = { rowsLeft: 4, bytesLeft: 2 * twoRowsBytes }
    expect(world.store.workerLedger('first-reader', complete)).toHaveLength(2)
    expect(complete).toEqual({ rowsLeft: 2, bytesLeft: twoRowsBytes })
    expect(world.store.workerLedger('second-reader', complete)).toHaveLength(2)
    expect(complete).toEqual({ rowsLeft: 0, bytesLeft: 0 })
    expect(world.store.workerLedger('first-reader', complete)).toBeNull()
    for (const remaining of [
      { rowsLeft: 3, bytesLeft: byteBound },
      { rowsLeft: rowBound, bytesLeft: twoRowsBytes + 1 },
    ]) {
      expect(world.store.workerLedger('first-reader', remaining)).toHaveLength(2)
      expect(world.store.workerLedger('second-reader', remaining)).toBeNull()
      expect(remaining).toEqual({ rowsLeft: 0, bytesLeft: 0 })
      expect(world.store.workerLedger('first-reader', remaining)).toBeNull()
    }
    const unread = { rowsLeft: 3, bytesLeft: 10 }
    expect(world.store.workerLedger('torn-reader', unread)).toBeNull()
    expect(unread).toEqual({ rowsLeft: 2, bytesLeft: 9 })
  })

  it('reads only the active generation, including while a replacement projection is being built', () => {
    conversation('reader')
    row('reader', 0, queued('old-brief'))
    rows('reader', 1, () => ({ type: 'message_unqueued', payload: '{' }), 0, 1)
    const next = world.store.beginGeneration('reader')
    row('reader', 0, queued('new-brief'), next)
    row('reader', 1, idle, next)
    const oldUnread = rowsUnreadOnce()
    expect(world.store.workerLedger('reader')).toBeNull()
    expect(world.store.messagesWaitingIn('reader', oldUnread, rowBound)).toEqual([])
    expect(oldUnread.count).toBe(1)
    expect(
      world.store.promoteGeneration('reader', next, { normalizerVersion: 1, derivedThrough: 0 }),
    ).toBe(true)
    expect(world.store.workerLedger('reader')).toEqual([
      { ordinal: 0, at: 100, event: queued('new-brief') },
      { ordinal: 1, at: 101, event: idle },
    ])
    const currentUnread = rowsUnreadOnce()
    expect(
      world.store
        .messagesWaitingIn('reader', currentUnread, rowBound)
        .map((message) => message.messageId),
    ).toEqual(['new-brief'])
    expect(currentUnread.count).toBe(0)
    expect(currentUnread.ledgersSkipped).toBe(0)
  })

  it('pairs messages with their own endings and keeps the default read compatible', () => {
    conversation('reader')
    row('reader', 0, queued('finished'))
    row('reader', 1, ended('finished'))
    row('reader', 2, queued('waiting'))
    row('reader', 3, ended('another-message'))
    const unread = rowsUnreadOnce()
    const complete = world.store.messagesWaitingIn('reader', unread, 4)
    expect(complete).toMatchObject([
      { messageId: 'waiting', kind: 'work', text: 'waiting', at: 102 },
    ])
    expect(complete).toHaveLength(1)
    expect(world.store.messagesWaitingIn('reader')).toEqual(complete)
    expect(unread.count).toBe(0)
    expect(unread.ledgersSkipped).toBe(0)
  })

  it('counts queue and ending rows toward the bound and records a whole skipped ledger once', () => {
    conversation('reader')
    rows('reader', rowBound, (ordinal) => {
      const event =
        ordinal % 2 === 0 ? queued(`message-${ordinal / 2}`) : ended(`message-${(ordinal - 1) / 2}`)
      return { type: event.type, payload: JSON.stringify(event) }
    })
    const unread = rowsUnreadOnce()
    expect(world.store.messagesWaitingIn('reader', unread, rowBound)).toEqual([])
    expect(unread.ledgersSkipped).toBe(0)
    row('reader', rowBound, queued('beyond-cap'))
    expect(world.store.messagesWaitingIn('reader', unread, rowBound)).toEqual([])
    expect(world.store.messagesWaitingIn('reader', unread, rowBound)).toEqual([])
    expect(unread.ledgersSkipped).toBe(1)
    expect(unread.count).toBe(0)
    expect(world.store.messagesWaitingIn('reader').map((message) => message.messageId)).toEqual([
      'beyond-cap',
    ])
  })

  it('reports torn queues and endings even when the surviving messages look readable', () => {
    conversation('reader')
    row('reader', 0, queued('before'))
    rows('reader', 1, () => ({ type: 'message_queued', payload: '{' }), 0, 1)
    row('reader', 2, ended('unrelated'))
    rows('reader', 1, () => ({ type: 'message_unqueued', payload: '{' }), 0, 3)
    row('reader', 4, queued('after'))
    const unread = rowsUnreadOnce()
    expect(
      world.store.messagesWaitingIn('reader', unread, 5).map((message) => message.messageId),
    ).toEqual(['after'])
    expect(
      world.store.messagesWaitingIn('reader', unread, 5).map((message) => message.messageId),
    ).toEqual(['after'])
    expect(unread.count).toBe(2)
    expect(unread.ledgersSkipped).toBe(0)
    corrupt('reader', 1, JSON.stringify(queued('repaired')))
    corrupt('reader', 3, JSON.stringify(ended('unrelated')))
    const repairedUnread = rowsUnreadOnce()
    expect(
      world.store
        .messagesWaitingIn('reader', repairedUnread, 5)
        .map((message) => message.messageId),
    ).toEqual(['before', 'repaired', 'after'])
    expect(repairedUnread.count).toBe(0)
  })

  it('returns the complete replacement chain and resolves only its terminal conversation', () => {
    for (const id of ['giver', 'successor', 'latest', 'other']) conversation(id)
    replace('giver', 'successor')
    replace('successor', 'latest')
    expect(world.store.workerLineage('giver')).toEqual(['giver', 'successor', 'latest'])
    expect(world.store.workerLineage('other')).toEqual(['other'])
    expect(world.store.workerGiverContains('giver', 'latest')).toBe(true)
    expect(world.store.workerGiverContains('giver', 'other')).toBe(false)
    expect(world.store.workerInItsPlace('giver')).toBe('latest')
  })

  it('finishes checking the chain before accepting an already-seen giver match', () => {
    for (const id of ['giver', 'successor', 'latest']) conversation(id)
    replace('giver', 'successor')
    replace('successor', 'latest')
    rows('latest', 1, () => ({ type: 'replaced_by', payload: '{' }))
    expect(() => world.store.workerGiverContains('giver', 'successor')).toThrow('unreadable')
    expect(() => world.store.workerGiverContains('giver', 'giver')).toThrow('unreadable')
    expect(() => world.store.workerLineage('giver')).toThrow('unreadable')
    expect(() => world.store.workerInItsPlace('giver')).toThrow('unreadable')
  })

  it('rejects cyclic, ambiguous, oversized and overlong replacement chains', () => {
    for (const id of ['cycle-first', 'cycle-second', 'ambiguous', 'target', 'oversized'])
      conversation(id)
    replace('cycle-first', 'cycle-second')
    replace('cycle-second', 'cycle-first')
    expect(() => world.store.workerLineage('cycle-first')).toThrow('cyclic')
    replace('ambiguous', 'target')
    replace('ambiguous', 'target', 1)
    expect(() => world.store.workerLineage('ambiguous')).toThrow('ambiguous')
    const replacement = JSON.stringify({ type: 'replaced_by', sessionId: 'target', padding: '' })
    corruptReplacement(4096)
    expect(world.store.workerLineage('oversized')).toEqual(['oversized', 'target'])
    corruptReplacement(4097)
    expect(() => world.store.workerLineage('oversized')).toThrow('too large')
    for (let index = 0; index < 65; index++) conversation(`hop-${index}`)
    for (let index = 0; index < 63; index++) replace(`hop-${index}`, `hop-${index + 1}`)
    expect(world.store.workerLineage('hop-0')).toHaveLength(64)
    replace('hop-63', 'hop-64')
    expect(() => world.store.workerLineage('hop-0')).toThrow('too deep')

    function corruptReplacement(characters: number) {
      const payload = JSON.stringify({
        type: 'replaced_by',
        sessionId: 'target',
        padding: 'x'.repeat(characters - replacement.length),
      })
      expect(payload.length).toBe(characters)
      world.db.prepare('DELETE FROM events WHERE session_id = ?').run('oversized')
      rows('oversized', 1, () => ({ type: 'replaced_by', payload }))
    }
  })

  it('reads only routing facts and makes any torn or oversized routing row unknown', () => {
    conversation('asker')
    row('asker', 0, routed('to-agent', 'recipient'))
    row('asker', 1, routed('to-person', null))
    rows('asker', 1, () => ({ type: 'status', payload: '{' }), 0, 2)
    expect(world.store.workerQuestionTargets()).toEqual([
      { asker: 'asker', recipient: 'recipient' },
    ])
    const atBoundary = JSON.stringify({ ...routed('to-person', null), padding: '' })
    const padded = JSON.stringify({
      ...routed('to-person', null),
      padding: 'x'.repeat(4096 - atBoundary.length),
    })
    expect(padded.length).toBe(4096)
    corrupt('asker', 1, padded)
    expect(world.store.workerQuestionTargets()).toEqual([
      { asker: 'asker', recipient: 'recipient' },
    ])
    for (const payload of [
      '{',
      JSON.stringify({ type: 'status' }),
      JSON.stringify({ ...routed('to-person', null), requestId: '' }),
      JSON.stringify({ ...routed('to-person', null), parent: 7 }),
      JSON.stringify({ type: 'request_routed', requestId: 'missing-parent' }),
      JSON.stringify({
        ...routed('to-person', null),
        padding: 'x'.repeat(4097 - atBoundary.length),
      }),
    ]) {
      corrupt('asker', 1, payload)
      expect(world.store.workerQuestionTargets()).toBeNull()
    }
  })

  it('counts person routes as well as agent routes before declaring the routing read complete', () => {
    conversation('asker')
    rows('asker', rowBound, (ordinal) => ({
      type: 'request_routed',
      payload: JSON.stringify(
        routed(`request-${ordinal}`, ordinal === rowBound - 1 ? 'recipient' : null),
      ),
    }))
    expect(world.store.workerQuestionTargets()).toEqual([
      { asker: 'asker', recipient: 'recipient' },
    ])
    row('asker', rowBound, routed('beyond-cap', 'other-recipient'))
    expect(world.store.workerQuestionTargets()).toBeNull()
  })
})
