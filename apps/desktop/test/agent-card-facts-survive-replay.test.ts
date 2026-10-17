import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { openDatabase, type AppDatabase } from '../src/main/db/connection'
import { applyMigrations } from '../src/main/db/migrate'
import { createSessionStore, type SessionStore } from '../src/main/db/session-store'
import type { TranscriptEvent } from '../src/shared/runtime-ipc'

describe('agent card facts survive replay', () => {
  let directory: string
  let db: AppDatabase
  let store: SessionStore
  let ordinal: number
  const answer = { requestId: 'req_clock', answeredBy: null, answer: 'UTC' }

  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), 'brobot-card-facts-'))
    db = openDatabase(join(directory, 'test.sqlite'))
    applyMigrations(db, join(import.meta.dirname, '../src/main/db/migrations'))
    store = createSessionStore(db, () => 1)
    store.create({
      id: 'reader',
      provider: 'claude',
      cwd: directory,
      approvalMode: 'ask',
      profileId: 'agent',
    })
    ordinal = 0
  })

  afterEach(() => {
    db.close()
    rmSync(directory, { recursive: true, force: true })
  })

  function append(event: object) {
    db.prepare(
      `INSERT INTO events (id, session_id, generation, ordinal, type, payload, created_at)
      VALUES (?, 'reader', 0, ?, ?, ?, 1)`,
    ).run(`fixture-${ordinal}`, ordinal++, (event as { type: string }).type, JSON.stringify(event))
  }

  it('keeps typed answers on one delivery, batched parts and reconstructed held mail', () => {
    append({ type: 'user_turn', text: 'notice', answeredQuestion: answer })
    append({
      type: 'user_turn',
      text: 'both',
      parts: [{ text: 'notice', answeredQuestion: answer }, { text: 'a normal note' }],
    })
    append({
      type: 'message_queued',
      messageId: 'msg_answer',
      kind: 'notice',
      text: 'notice',
      answeredQuestion: answer,
    })
    const events = store.events('reader').map((one) => one.event)
    expect(events[0]).toMatchObject({ answeredQuestion: answer })
    expect(events[1]).toMatchObject({
      parts: [{ text: 'notice', answeredQuestion: answer }, { text: 'a normal note' }],
    })
    expect(store.messagesWaitingIn('reader')[0]?.authorship.answeredQuestion).toEqual(answer)
  })

  it.each([
    { ...answer, requestId: '' },
    { ...answer, requestId: 'x'.repeat(201) },
    { ...answer, answeredBy: 7 },
    { ...answer, answer: 'x'.repeat(1281) },
    { ...answer, cannotAnswer: false },
    { ...answer, clipped: 'yes' },
  ])('omits damaged answer metadata while keeping the notice text', (damaged) => {
    append({ type: 'user_turn', text: 'original notice', answeredQuestion: damaged })
    append({
      type: 'message_queued',
      messageId: 'msg_bad',
      kind: 'notice',
      text: 'held notice',
      answeredQuestion: damaged,
    })
    const events = store.events('reader').map((one) => one.event)
    expect(events[0]).toMatchObject({ text: 'original notice' })
    expect(events[0]).not.toHaveProperty('answeredQuestion')
    expect(events[1]).not.toHaveProperty('answeredQuestion')
    expect(store.messagesWaitingIn('reader')[0]?.authorship).not.toHaveProperty('answeredQuestion')
  })

  it('keeps old rows unchanged and omits oversized addresses rather than shortening them', () => {
    const old: TranscriptEvent = { type: 'user_turn', text: 'old notice' }
    append(old)
    append({
      type: 'message_sent',
      to: 'receiver',
      toProfile: 'worker',
      kind: 'note',
      delivery: 'sent',
      onBehalfOfAPerson: false,
      addressedAs: 'x'.repeat(201),
      toLabel: 'the observed receiver',
    })
    const events = store.events('reader').map((one) => one.event)
    expect(events[0]).toEqual(old)
    expect(events[1]).toMatchObject({ to: 'receiver', toLabel: 'the observed receiver' })
    expect(events[1]).not.toHaveProperty('addressedAs')
  })

  it('keeps the exact act join on recorded results and receipts after reopening the store', () => {
    const messageAct = 'message_act_00000000-0000-4000-8000-000000000001'
    append({ type: 'tool_result', id: 'call_b', summary: 'sent', ok: true, messageAct })
    append({
      type: 'message_sent',
      to: 'receiver',
      toProfile: null,
      kind: 'note',
      delivery: 'sent',
      onBehalfOfAPerson: false,
      messageAct,
    })
    const fresh = createSessionStore(db, () => 2)
    expect(fresh.events('reader').map((one) => one.event)).toEqual([
      { type: 'tool_result', id: 'call_b', summary: 'sent', ok: true, messageAct },
      {
        type: 'message_sent',
        to: 'receiver',
        toProfile: null,
        kind: 'note',
        delivery: 'sent',
        onBehalfOfAPerson: false,
        messageAct,
      },
    ])
  })

  it('drops damaged optional facts from parts, endings and result joins without losing their text', () => {
    append({
      type: 'user_turn',
      text: 'both',
      parts: [
        { text: 'notice', answeredQuestion: { ...answer, requestId: '' } },
        { text: 'good notice', answeredQuestion: answer },
      ],
    })
    append({
      type: 'message_unqueued',
      messageId: 'msg_answer',
      why: 'sent',
      text: 'notice',
      answeredQuestion: { ...answer, cannotAnswer: false },
    })
    append({ type: 'tool_result', id: 'call', summary: 'sent', ok: true, messageAct: 'not-an-act' })
    const events = store.events('reader').map((one) => one.event)
    expect(events[0]).toMatchObject({
      parts: [{ text: 'notice' }, { text: 'good notice', answeredQuestion: answer }],
    })
    const first = events[0]
    if (first === undefined || first.type !== 'user_turn') throw new Error('wrong event')
    expect(first.parts?.[0]).not.toHaveProperty('answeredQuestion')
    expect(events[1]).toMatchObject({ text: 'notice' })
    expect(events[1]).not.toHaveProperty('answeredQuestion')
    expect(events[2]).not.toHaveProperty('messageAct')
  })
})
