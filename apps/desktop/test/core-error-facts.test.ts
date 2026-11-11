import { expect, it } from 'vitest'
import { F093World, waitFor } from './lib/f093-host'
import { legacyConversation } from './fixtures/legacy-migration-data'
import { transcriptMessageForDisplay } from '../src/main/providers/error-presentation'
import {
  createSessionRecord,
  acceptEvent,
  openWindow,
  reopenAtLatest,
  prependOlder,
} from '../src/renderer/src/lib/session-record'
import { createWindow, openAt, foldWindow } from '../src/renderer/src/lib/transcript-window'
import { readWholeConversation } from '../src/renderer/src/lib/readable-export'
import {
  applyEvent,
  createTranscript,
  type TranscriptState,
} from '../src/renderer/src/lib/transcript'
import type { TranscriptEvent } from '../src/shared/conversation-events'

const sentence = 'The fictional model cannot run on this account.'
const envelope = JSON.stringify({ error: { message: sentence } })
const notices = (state: TranscriptState) =>
  state.items.flatMap((item) => (item.kind === 'notice' ? [item.text] : []))

it('keeps supplied event/sign-in identity and raw fallback while core facts own decoding', () => {
  const signIn = Object.freeze({ state: 'retrying' as const, message: 'Fern is reconnecting.' })
  const event = Object.freeze({ type: 'error' as const, message: envelope, fatal: false, signIn })
  const input = { event, ordinal: 71, at: 900 }
  const projected = transcriptMessageForDisplay(input)
  expect(projected.event).toBe(event)
  expect(projected.event.signIn).toBe(signIn)
  expect(projected.event.signIn).not.toHaveProperty('captions')
  expect(projected.errorFacts).toEqual({ sentence })
  expect(input).not.toHaveProperty('errorFacts')
  expect(projected).toMatchObject({ ordinal: 71, at: 900 })
  const bare = createTranscript()
  applyEvent(bare, { type: 'error', message: envelope, fatal: false })
  expect(notices(bare)).toEqual([envelope])
  const rawEnding = `turn failed: ${envelope}`
  applyEvent(bare, { type: 'error', message: rawEnding, fatal: false })
  expect(notices(bare)).toEqual([envelope, rawEnding])
})

it('projects actual host live errors and old SQLite history through windows, refolds and export', async () => {
  const world = new F093World()
  const host = world.buildHost(false)
  try {
    const { sessionId } = await host.createSession(
      { provider: 'codex', cwd: world.project, approvalMode: 'auto' },
      world.window,
    )
    const handle = world.end.newest().handle
    handle.simulateError(envelope, false)
    handle.simulateError(`turn failed: ${envelope}`, false)
    handle.simulateError('turn failed', false)
    await waitFor(
      () => world.window.messages.filter((row) => row.event.type === 'error').length === 3,
      'live error facts',
    )
    const record = createSessionRecord(sessionId)
    for (const row of world.window.messages) acceptEvent(record, row)
    expect(notices(record.transcript)).toEqual([
      `session started · ${handle.ref.sessionId}`,
      sentence,
    ])
    const live = world.window.messages.filter((row) => row.event.type === 'error')
    expect(live.map((row) => row.errorFacts?.ending)).toEqual([
      undefined,
      { raw: envelope, sentence },
      { raw: '', sentence: '' },
    ])
    expect(world.ledger(sessionId).filter((event) => event.type === 'error')).toEqual(
      live.map((row) => row.event),
    )
    expect(world.ledger(sessionId).every((event) => !('errorFacts' in event))).toBe(true)

    const id = 'old-error-envelope'
    legacyConversation(world.db, {
      id,
      profileId: id,
      provider: 'codex',
      cwd: world.project,
      approvalMode: 'ask',
    })
    const events: TranscriptEvent[] = [
      { type: 'error', message: envelope, fatal: false },
      { type: 'error', message: `turn failed: ${envelope}`, fatal: false },
      { type: 'error', message: 'turn failed', fatal: false },
      { type: 'turn', state: 'failed' },
    ]
    const insert = world.db.prepare(
      'INSERT INTO events (id,session_id,generation,ordinal,type,payload,created_at) VALUES (?, ?, 0, ?, ?, ?, ?)',
    )
    for (const [ordinal, event] of events.entries())
      insert.run(`${id}-${ordinal}`, id, ordinal, event.type, JSON.stringify(event), 1000 + ordinal)
    const saved = () =>
      world.db
        .prepare('SELECT ordinal,payload FROM events WHERE session_id = ? ORDER BY ordinal')
        .all(id)
    const before = saved()
    const page = host.latestHistory(id)
    expect(page.entries.map((row) => [row.ordinal, row.at])).toEqual(
      events.map((_, ordinal) => [ordinal, 1000 + ordinal]),
    )
    expect(page.entries[0]?.errorFacts).toEqual({ sentence })
    const replay = createSessionRecord(id)
    openWindow(replay, page)
    for (const row of page.entries) acceptEvent(replay, { sessionId: id, ...row })
    expect(notices(replay.transcript)).toEqual([sentence, 'turn failed'])
    reopenAtLatest(replay, page)
    expect(notices(replay.transcript)).toEqual([sentence, 'turn failed'])
    const suffix = { ...page, entries: page.entries.slice(1), from: 1, hasOlder: true }
    const scrolled = createSessionRecord(id)
    openWindow(scrolled, suffix)
    for (const row of suffix.entries) acceptEvent(scrolled, { sessionId: id, ...row })
    prependOlder(scrolled, { ...page, entries: page.entries.slice(0, 1) })
    expect(notices(scrolled.transcript)).toEqual([sentence, 'turn failed'])
    const window = createWindow()
    openAt(window, page, id)
    expect(notices(foldWindow(window.entries, null))).toEqual([sentence, 'turn failed'])
    const whole = await readWholeConversation({
      sessionId: id,
      liveFrom: null,
      latest: async () => page,
      earlier: async ({ before }) => host.earlierHistory(id, before),
    })
    expect(whole.ok).toBe(true)
    if (!whole.ok) throw new Error('Expected a readable history')
    expect(whole.items.filter((item) => item.kind === 'notice').map((item) => item.text)).toEqual([
      sentence,
      'turn failed',
    ])
    expect(saved()).toEqual(before)
  } finally {
    await world.dispose()
  }
})
