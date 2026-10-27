import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { openDatabase, type AppDatabase } from '../src/main/db/connection'
import { applyMigrations } from '../src/main/db/migrate'
import { createSessionStore, type SessionStore } from '../src/main/db/session-store'
import { HUMAN_FINAL_TERM, HUMAN_CONTEXT_TERM } from '../src/main/db/human-answer-index'
import { RuntimeHost } from '../src/main/runtime/runtime-host'
import { FakeRuntime } from '@brobot2/runtime'
import { NO_DISCOVERY } from '../src/main/adopt/discover-sessions'
import type { TranscriptEvent } from '../src/shared/runtime-ipc'
import {
  acceptEvent,
  createSessionRecord,
  openWindow,
} from '../src/renderer/src/lib/session-record'
import { panelWords } from '../src/renderer/src/lib/latest-words'
import { visibleItems } from '../src/renderer/src/lib/transcript-mode'
import { normalizeNotification } from '../../../packages/runtime/src/codex/normalize'

const migrations = join(dirname(fileURLToPath(import.meta.url)), '../src/main/db/migrations')
describe('indexed human answer history', () => {
  let directory: string
  let db: AppDatabase
  let store: SessionStore
  let ordinal: number
  let host: RuntimeHost
  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), 'fictional-human-answer-'))
    db = openDatabase(join(directory, 'fictional.sqlite'))
    applyMigrations(db, migrations)
    store = createSessionStore(db)
    store.create({
      id: 's',
      provider: 'codex',
      cwd: directory,
      approvalMode: 'ask',
      profileId: 'fictional',
    })
    ordinal = 0
    host = new RuntimeHost({
      store,
      createRuntime: () => new FakeRuntime('codex'),
      discoverSessions: NO_DISCOVERY,
      resolveCwd: () => directory,
      prepareProviderHome: () => directory,
      providerHomePath: () => directory,
      nativeTranscriptPath: () => null,
      exportDirectory: () => directory,
      newSessionId: () => 'fictional-new',
      readProviderConfig: () => ({
        home: directory,
        homeEnv: 'CODEX_HOME',
        model: 'fictional',
        authNote: null,
        files: [],
      }),
    })
  })
  afterEach(async () => {
    await host.closeAll()
    db.close()
    rmSync(directory, { recursive: true, force: true })
  })
  function feed(...events: TranscriptEvent[]) {
    for (const event of events) {
      store.append('s', ordinal, event, 1000 + ordinal)
      ordinal++
    }
  }
  function human(text: string) {
    feed({ type: 'user_turn', text, humanInitiated: true })
  }
  function final(text: string) {
    feed({ type: 'assistant_message', text, phase: 'final' }, { type: 'turn', state: 'completed' })
  }

  it('keeps new empty messages and old plain-empty diagnostics consistent through host history', () => {
    human('Fictional question')
    final('Actual answer')
    const raw = {
      type: 'agentMessage',
      id: 'fictional-empty',
      text: '',
      phase: 'final_answer',
      memoryCitation: null,
      delivery: null,
      questions: null,
    }
    feed(...normalizeNotification('item/completed', { item: raw }))
    feed({
      type: 'unknown',
      provider: 'codex',
      category: 'unrecognized',
      label: 'agentMessage',
      raw,
    })
    feed(
      ...normalizeNotification('item/completed', {
        item: { type: 'agentMessage', id: 'fictional-malformed', text: null },
      }),
    )
    feed({ type: 'turn', state: 'completed' })
    const stored = store.events('s')
    const oldPayload = stored.find(
      (row) =>
        row.event.type === 'unknown' &&
        row.event.raw !== null &&
        typeof row.event.raw === 'object' &&
        'id' in row.event.raw &&
        row.event.raw.id === 'fictional-empty',
    )
    expect(oldPayload?.event).toMatchObject({ category: 'unrecognized', raw })
    const live = createSessionRecord('s')
    stored.forEach((row) => acceptEvent(live, { ...row, sessionId: 's' }))
    const page = host.latestHistory('s')
    const cold = createSessionRecord('s')
    openWindow(cold, page)
    page.entries.forEach((row) => acceptEvent(cold, { ...row, sessionId: 's' }))
    for (const record of [live, cold]) {
      const shown = visibleItems('normal', record.control.items)
      expect(shown.filter((item) => item.kind === 'assistant').map((item) => item.text)).toEqual([
        'Actual answer',
      ])
      expect(shown.filter((item) => item.kind === 'unknown')).toHaveLength(1)
      expect(panelWords(record.control)?.text).toBe('Actual answer')
      expect(
        record.control.items.filter((item) => item.kind === 'assistant' && item.humanFinal),
      ).toHaveLength(1)
    }
    expect(store.events('s').find((row) => row.ordinal === oldPayload?.ordinal)?.event).toEqual(
      oldPayload?.event,
    )
  })

  it('reloads a human final outside a page of later app turns without including their answers', () => {
    human('My **question**')
    final('## My answer')
    for (let n = 0; n < 20; n++) {
      feed({ type: 'user_turn', text: `App ${n}`, attribution: 'app_authored' })
      final(`App answer ${n}`)
    }
    const page = host.latestHistory('s')
    expect(page.entries.some((row) => row.ordinal === 0)).toBe(false)
    expect(page.humanAnswers?.latest).toMatchObject({
      prompt: 'My **question**',
      final: { text: '## My answer' },
    })
    const record = createSessionRecord('s')
    openWindow(record, page)
    page.entries.forEach((row) => acceptEvent(record, { ...row, sessionId: 's' }))
    expect(panelWords(record.control)?.text).toBe('My answer')
    human('New pending question')
    expect(store.latestHumanAnswers('s').latest).toMatchObject({
      prompt: 'New pending question',
      final: null,
    })
    feed(
      { type: 'turn', state: 'interrupted' },
      { type: 'user_turn', text: 'App notice', attribution: 'app_authored' },
    )
    final('New app response')
    expect(store.latestHumanAnswers('s').latest).toMatchObject({
      prompt: 'New pending question',
      final: null,
    })
  })

  it('keeps legacy authorship and missing finality uncertain and ignores child finals', () => {
    feed({ type: 'user_turn', text: 'Legacy' })
    final('Old answer')
    expect(store.latestHumanAnswers('s').latest).toBeNull()
    human('Current')
    feed(
      { type: 'assistant_message', text: 'Complete block without final flag' },
      { type: 'assistant_message', text: 'Child final', phase: 'final', parentToolCallId: 'child' },
      { type: 'turn', state: 'completed' },
    )
    expect(store.latestHumanAnswers('s').latest?.final).toBeNull()
  })

  it('a later uncertain prompt prevents selecting an older verified human final', () => {
    human('Known question')
    final('Known answer')
    feed({ type: 'user_turn', text: 'Later legacy prompt' })
    final('Legacy response')
    expect(store.latestHumanAnswers('s').latest).toBeNull()
  })

  it('live and cold history select the same nonblank final across repeated finals', () => {
    human('Question')
    feed({ type: 'assistant_message', text: 'First final', phase: 'final' })
    feed({ type: 'assistant_message', text: 'Selected final', phase: 'final' })
    feed({ type: 'assistant_message', text: '\n\t\u00a0\uFEFF', phase: 'final' })
    const page = host.latestHistory('s')
    expect(page.humanAnswers?.latest?.final?.text).toBe('Selected final')
    const record = createSessionRecord('s')
    openWindow(record, page)
    page.entries.forEach((row) => acceptEvent(record, { ...row, sessionId: 's' }))
    expect(
      record.control.items
        .filter((item) => item.kind === 'assistant')
        .filter((item) => item.humanFinal)
        .map((item) => item.text),
    ).toEqual(['Selected final'])
    expect(panelWords(record.control)?.text).toBe('Selected final')
  })

  it.each(['ended', 'reopened'] as const)(
    'does not adopt a late final after %s on cold reload',
    (boundary) => {
      human('Question')
      feed({ type: 'assistant_message', text: 'Original final', phase: 'final' })
      feed(boundary === 'ended' ? { type: 'status', state: 'ended' } : { type: 'reopened' })
      feed({ type: 'assistant_message', text: 'Late final', phase: 'final' })
      const page = host.latestHistory('s')
      expect(page.humanAnswers?.latest?.final?.text).toBe('Original final')
      expect(page.humanAnswers?.active).toBeNull()
      const record = createSessionRecord('s')
      openWindow(record, page)
      page.entries.forEach((row) => acceptEvent(record, { ...row, sessionId: 's' }))
      expect(
        record.control.items
          .filter((item) => item.kind === 'assistant')
          .filter((item) => item.humanFinal)
          .map((item) => item.text),
      ).toEqual(['Original final'])
      expect(panelWords(record.control)?.text).toBe('Original final')
    },
  )

  it('keeps each visible human final across a real event-cap cut and an older page cut', () => {
    human('Q1 outside page')
    for (let n = 0; n < 2600; n++) feed({ type: 'activity', phase: 'thinking' })
    final('A1 inside cut page')
    human('Q2 inside page')
    final('A2 inside page')
    feed({ type: 'user_turn', text: 'Trailing app turn', attribution: 'app_authored' })
    final('Trailing app answer')
    const page = host.latestHistory('s')
    expect(page.turnAligned).toBe(false)
    expect(page.entries.some((entry) => entry.ordinal === 0)).toBe(false)
    expect(page.humanAnswers?.latest?.prompt).toBe('Q2 inside page')
    expect(page.humanAnswers?.active).toBeNull()
    const record = createSessionRecord('s')
    openWindow(record, page)
    page.entries.forEach((row) => acceptEvent(record, { ...row, sessionId: 's' }))
    expect(
      record.control.items
        .filter((item) => item.kind === 'assistant')
        .filter((item) => item.humanFinal)
        .map((item) => item.text),
    ).toEqual(['A1 inside cut page', 'A2 inside page'])
    expect(panelWords(record.control)?.text).toBe('A2 inside page')
    // An older-page request can begin partway through Q1 and contain A1 without Q1's prompt.
    const older = host.earlierHistory('s', 2603, 1)
    expect(older.turnAligned).toBe(false)
    const olderRecord = createSessionRecord('s')
    openWindow(olderRecord, older)
    older.entries.forEach((row) => acceptEvent(olderRecord, { ...row, sessionId: 's' }))
    expect(
      olderRecord.control.items
        .filter((item) => item.kind === 'assistant')
        .filter((item) => item.humanFinal)
        .map((item) => item.text),
    ).toEqual(['A1 inside cut page'])
  })

  it.each(['app', 'superseded human'] as const)(
    'reconciles provider confirmations during live and host history replay for %s answers',
    (kind) => {
      const live = createSessionRecord('s')
      const events: TranscriptEvent[] = [
        {
          type: 'user_turn',
          text: 'Question',
          ...(kind === 'app' ? { attribution: 'app_authored' as const } : { humanInitiated: true }),
        },
        { type: 'assistant_message', text: 'Confirmed prose', messageId: 'provider-message-one' },
        {
          type: 'assistant_message',
          text: 'Confirmed prose',
          messageId: 'provider-message-one',
          phase: 'final',
        },
      ]
      if (kind === 'superseded human')
        events.push({
          type: 'assistant_message',
          text: 'Selected answer',
          phase: 'final',
          messageId: 'provider-message-two',
        })
      events.push({ type: 'turn', state: 'completed' })
      for (const event of events) {
        acceptEvent(live, { sessionId: 's', event, ordinal, at: 1000 + ordinal })
        feed(event)
      }
      const page = host.latestHistory('s')
      expect(
        page.entries
          .filter(
            (row) =>
              row.event.type === 'assistant_message' &&
              row.event.messageId === 'provider-message-one',
          )
          .map((row) => row.humanFinal),
      ).toEqual([null, null])
      const cold = createSessionRecord('s')
      openWindow(cold, page)
      page.entries.forEach((row) => acceptEvent(cold, { ...row, sessionId: 's' }))
      for (const record of [live, cold]) {
        const prose = record.control.items.filter((item) => item.kind === 'assistant')
        expect(prose.map((item) => item.text)).toEqual(
          kind === 'app' ? ['Confirmed prose'] : ['Confirmed prose', 'Selected answer'],
        )
        expect(prose.filter((item) => item.humanFinal).map((item) => item.text)).toEqual(
          kind === 'app' ? [] : ['Selected answer'],
        )
      }
      expect(panelWords(cold.control)).toEqual(panelWords(live.control))
    },
  )

  it('uses index seeks without temporary sorts and tolerates malformed historical payloads', () => {
    for (const [name, term, extra, args] of [
      ['events_human_prompt_idx', `(${HUMAN_CONTEXT_TERM})`, " AND type = 'user_turn'", ['s', 0]],
      [
        'events_human_final_idx',
        HUMAN_FINAL_TERM,
        ' AND turn_id = ? AND ordinal > ?',
        ['s', 0, 'fictional', 0],
      ],
    ] as const) {
      const plan = db
        .prepare(
          `EXPLAIN QUERY PLAN SELECT ordinal, payload FROM events WHERE session_id = ? AND generation = ? AND ${term}${extra} ORDER BY ordinal DESC LIMIT 1`,
        )
        .all(...args)
      const details = JSON.stringify(plan)
      expect(details).toContain(`USING INDEX ${name}`)
      expect(details).not.toContain('TEMP B-TREE')
      expect(details).not.toContain('SCAN events')
    }
    db.prepare(
      'INSERT INTO events (id, session_id, ordinal, type, payload, created_at) VALUES (?, ?, ?, ?, ?, ?)',
    ).run('bad', 's', 0, 'user_turn', '{', 1)
    expect(store.latestHumanAnswers('s').latest).toBeNull()
  })

  it('seeks a missing lifecycle boundary past many later human prompts using the type key', () => {
    const prompts = 20_000
    db.transaction(() => {
      for (let n = 0; n < prompts; n++) {
        human(`Fictional question ${n}`)
        if (n < 20) final(`Fictional selected answer ${n}`)
      }
    })()
    expect(
      db
        .prepare<[], { name: string }>('PRAGMA index_info(events_human_prompt_idx)')
        .all()
        .map((row) => row.name),
    ).toEqual(['session_id', 'generation', 'type', 'ordinal'])
    const query = `SELECT ordinal FROM events INDEXED BY events_human_prompt_idx
      WHERE session_id = ? AND generation = ? AND (${HUMAN_CONTEXT_TERM}) AND type = ?
        AND ordinal > ? ORDER BY ordinal LIMIT 1`
    const seek = db.prepare(query)
    const began = performance.now()
    for (const type of ['status', 'reopened']) {
      const plan = JSON.stringify(db.prepare(`EXPLAIN QUERY PLAN ${query}`).all('s', 0, type, 0))
      expect(plan).toContain(
        'USING INDEX events_human_prompt_idx (session_id=? AND generation=? AND type=? AND ordinal>?)',
      )
      expect(plan).not.toContain('SCAN events')
      expect(plan).not.toContain('TEMP B-TREE')
      for (let n = 0; n < 100; n++) expect(seek.get('s', 0, type, 0)).toBeUndefined()
    }
    const missingBoundaryMs = performance.now() - began
    const windowAt = performance.now()
    expect(store.humanFinalsInWindow('s', 0, 59).size).toBe(20)
    const firstWindowContextMs = performance.now() - windowAt
    // Timings supplement the full equality-prefix/range plan; they are not VM-step counts.
    console.info(
      'fictional-human-boundary-seeks',
      JSON.stringify({ prompts, seeks: 200, missingBoundaryMs, firstWindowContextMs }),
    )
  })
})
