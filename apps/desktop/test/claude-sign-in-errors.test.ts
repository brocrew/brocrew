import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { FakeRuntime } from '@brobot2/runtime'
import { openDatabase } from '../src/main/db/connection'
import { applyMigrations } from '../src/main/db/migrate'
import { createSessionStore } from '../src/main/db/session-store'
import { RuntimeHost } from '../src/main/runtime/runtime-host'
import { NO_DISCOVERY } from '../src/main/adopt/discover-sessions'
import {
  createSessionRecord,
  openWindow,
  acceptEvent,
} from '../src/renderer/src/lib/session-record'
import { legacyConversation, legacyEvents } from './fixtures/legacy-migration-data'
import { transcriptMessageForDisplay } from '../src/main/providers/error-presentation'
import type { TranscriptEvent } from '../src/shared/conversation-events'
import { describe, expect, it } from 'vitest'

import {
  applyEvent as applyDisplayedEvent,
  createTranscript,
  THE_APPS_OWN_WORD,
  type NoticeItem,
} from '../src/renderer/src/lib/transcript'
import { visibleItems } from '../src/renderer/src/lib/transcript-mode'

function applyEvent(
  state: Parameters<typeof applyDisplayedEvent>[0],
  event: TranscriptEvent,
): void {
  const row = transcriptMessageForDisplay({ event }, state.ref?.provider)
  applyDisplayedEvent(
    state,
    row.event,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    row.errorFacts,
  )
}

const retry = (attempt: number): Extract<TranscriptEvent, { type: 'error' }> => ({
  type: 'error',
  message: `claude could not authenticate; retrying (attempt ${attempt}/3, retrying in 1s, HTTP 401)`,
  fatal: false,
})
const refused: Extract<TranscriptEvent, { type: 'error' }> = {
  type: 'error',
  message: 'HTTP 401: the launch sign-in was refused',
  fatal: true,
  cause: 'auth_stale',
}

function transcript() {
  const state = createTranscript()
  state.ref = { provider: 'claude', sessionId: 'bakery', cwd: '/tmp/bakery', rotation: 0 }
  return state
}
const notices = (items: ReturnType<typeof transcript>['items']) =>
  items.filter((item): item is NoticeItem => item.kind === 'notice')

describe('Claude sign-in failures', () => {
  it('updates one row through retries, refusal and failed turn, keeping every diagnostic', () => {
    const state = transcript()
    applyEvent(state, retry(1))
    const id = state.items[0]?.id
    applyEvent(state, retry(2))
    expect(notices(state.items)).toHaveLength(1)
    expect(notices(state.items)[0]?.text).toContain('attempt 2/3')
    expect(notices(state.items)[0]?.signIn?.state).toBe('retrying')
    applyEvent(state, refused)
    const restated = `turn failed: ${refused.message}`
    applyEvent(state, { type: 'error', message: restated, fatal: false })
    applyEvent(state, { type: 'turn', state: 'failed', wordOf: 'this-app' })
    const [notice] = notices(state.items)
    expect(notices(state.items)).toHaveLength(1)
    expect(notice?.id).toBe(id)
    expect(notice?.signIn).toEqual({
      state: 'refused',
      details: [
        retry(1).message,
        retry(2).message,
        refused.message,
        restated,
        `turn failed — ${THE_APPS_OWN_WORD}`,
      ],
    })
    expect(state.ended).toBe(true)
  })

  it('does not leave a retry running after a successful turn', () => {
    const state = transcript()
    applyEvent(state, retry(1))
    applyEvent(state, { type: 'turn', state: 'completed' })
    expect(notices(state.items)[0]).toMatchObject({
      text: 'Claude sign-in recovered.',
      level: 'info',
      signIn: { state: 'recovered' },
    })
    expect(visibleItems(state.items)).toHaveLength(0)
  })

  it.each(['error_max_turns', 'error_during_execution'])(
    'keeps a distinct %s failure visible after a sign-in retry',
    (reason) => {
      const state = transcript()
      applyEvent(state, retry(1))
      applyEvent(state, { type: 'error', message: `turn failed: ${reason}`, fatal: false })
      applyEvent(state, { type: 'turn', state: 'failed' })
      expect(
        visibleItems(state.items).map((item) => (item.kind === 'notice' ? item.text : '')),
      ).toEqual([reason, 'turn failed'])
      expect(notices(state.items)[0]?.signIn?.state).toBe('ended')
      expect(notices(state.items).some((item) => item.signIn?.state === 'refused')).toBe(false)
    },
  )

  it('a bare failed ending settles a retry without claiming an authentication failure', () => {
    const state = transcript()
    applyEvent(state, retry(1))
    applyEvent(state, { type: 'turn', state: 'failed' })
    expect(notices(state.items)[0]?.signIn?.state).toBe('ended')
    expect(
      visibleItems(state.items).map((item) => (item.kind === 'notice' ? item.text : '')),
    ).toEqual(['turn failed'])
  })

  it('Stop during backoff settles the retry and retains the interruption', () => {
    const state = transcript()
    applyEvent(state, retry(1))
    applyEvent(state, { type: 'turn', state: 'interrupted' })
    expect(notices(state.items)[0]).toMatchObject({
      text: 'Claude sign-in retry stopped.',
      signIn: { state: 'ended' },
    })
    expect(notices(state.items)[0]?.signIn?.details).toContain('turn interrupted')
    expect(
      visibleItems(state.items).map((item) => (item.kind === 'notice' ? item.text : '')),
    ).toEqual(['turn interrupted'])
  })

  it('starts another row for a new user turn and leaves other failures visible', () => {
    const state = transcript()
    applyEvent(state, refused)
    applyEvent(state, { type: 'user_turn', text: 'Try again' })
    applyEvent(state, retry(1))
    applyEvent(state, { type: 'error', message: 'disk full', fatal: false })
    expect(notices(state.items)).toHaveLength(3)
    expect(notices(state.items).at(-1)?.text).toBe('disk full')
  })

  it('keeps API key and Codex failures on their existing remedies', () => {
    const state = transcript()
    applyEvent(state, { ...refused, onAKey: true })
    expect(notices(state.items)[0]?.signIn).toBeUndefined()
    expect(notices(state.items)[0]?.text).toContain('API key')
    const codex = transcript()
    codex.ref = { ...codex.ref!, provider: 'codex' }
    applyEvent(codex, retry(1))
    expect(notices(codex.items)[0]?.signIn).toBeUndefined()
  })

  it('marks a rejected current Claude login for sign-in, without Codex launcher advice', () => {
    const state = transcript()
    applyEvent(state, { ...refused, cause: 'auth' })
    const [notice] = notices(state.items)
    expect(notice?.signIn).toMatchObject({ state: 'refused', needsSignIn: true })
    expect(notice?.text).toContain('Sign in again to continue this conversation')
    expect(notice?.text).not.toContain('Start a new conversation')
  })

  it('keeps unknown events for Debug mode, including dev_intent', () => {
    const state = transcript()
    for (const label of ['dev_intent', 'new-useful-event'])
      applyEvent(state, {
        type: 'unknown',
        provider: 'claude',
        label,
        category: 'unrecognized',
        raw: { type: label },
      })
    expect(state.items).toHaveLength(2)
    expect(visibleItems(state.items)).toEqual([])
    expect(
      visibleItems(state.items, true).map((item) => (item.kind === 'unknown' ? item.label : '')),
    ).toEqual(['dev_intent', 'new-useful-event'])
  })
})

describe('core-supplied retry endings across old and current recordings', () => {
  it.each([
    ['completed', 'recovered', 'recovered'],
    ['interrupted', 'stopped', 'ended'],
    ['failed', 'ended', 'ended'],
  ] as const)(
    'preserves %s row identity, raw details and opaque words in live and actual history',
    async (ending, caption, state) => {
      const directory = mkdtempSync(join(tmpdir(), 'retry-caption-history-'))
      const db = openDatabase(join(directory, 'fictional.sqlite'))
      applyMigrations(
        db,
        join(dirname(fileURLToPath(import.meta.url)), '../src/main/db/migrations'),
      )
      const store = createSessionStore(db)
      const host = new RuntimeHost({
        store,
        createRuntime: () => new FakeRuntime('claude'),
        discoverSessions: NO_DISCOVERY,
        resolveCwd: () => directory,
        prepareProviderHome: () => directory,
        providerHomePath: () => directory,
        nativeTranscriptPath: () => null,
        exportDirectory: () => directory,
        newSessionId: () => 'caption-fixture-unused',
        readProviderConfig: () => ({
          home: directory,
          homeEnv: 'CLAUDE_CONFIG_DIR',
          model: 'fictional',
          authNote: null,
          files: [],
        }),
      })
      const captions = {
        recovered: 'Fern connected again.',
        stopped: 'Fern stopped reconnecting.',
        ended: 'Fern finished reconnecting.',
      }
      try {
        for (const mode of ['old', 'current'] as const) {
          const id = `caption-${mode}`
          legacyConversation(db, {
            id,
            provider: 'claude',
            cwd: directory,
            approvalMode: 'ask',
            profileId: id,
          })
          const error: TranscriptEvent =
            mode === 'old'
              ? retry(1)
              : {
                  type: 'error',
                  message: 'fictional raw diagnostic',
                  fatal: false,
                  signIn: { state: 'retrying', message: 'Fern is reconnecting.', captions },
                }
          const end: TranscriptEvent = { type: 'turn', state: ending }
          const events = [error, end]
          const saved = JSON.stringify(events)
          legacyEvents(db, id, events, 1000)
          const rawRows = db
            .prepare('SELECT ordinal,payload FROM events WHERE session_id = ? ORDER BY ordinal')
            .all(id)
          const live = transcript()
          applyEvent(live, error)
          const original = notices(live.items)[0]!
          const rowId = original.id
          applyEvent(live, end)
          const expected =
            mode === 'current'
              ? captions[caption]
              : caption === 'recovered'
                ? 'Claude sign-in recovered.'
                : caption === 'stopped'
                  ? 'Claude sign-in retry stopped.'
                  : 'Claude sign-in retry ended.'
          expect(notices(live.items)[0]).toBe(original)
          expect(original.id).toBe(rowId)
          expect(original.text).toBe(expected)
          expect(original.signIn?.state).toBe(state)
          expect(original.signIn?.details).toEqual([error.message, `turn ${ending}`])
          const page = host.latestHistory(id)
          expect(page.entries.map((row) => [row.ordinal, row.at])).toEqual([
            [0, 1000],
            [1, 1001],
          ])
          const replay = createSessionRecord(id)
          openWindow(replay, page)
          for (const row of page.entries) acceptEvent(replay, { sessionId: id, ...row })
          expect(notices(replay.transcript.items)[0]).toMatchObject({
            text: expected,
            level: 'info',
            signIn: { state, details: original.signIn!.details },
          })
          expect(
            visibleItems(replay.transcript.items).map((row) =>
              row.kind === 'notice' ? row.text : row.kind,
            ),
          ).toEqual(
            visibleItems(live.items).map((row) => (row.kind === 'notice' ? row.text : row.kind)),
          )
          expect(JSON.stringify(events)).toBe(saved)
          expect(
            db
              .prepare('SELECT ordinal,payload FROM events WHERE session_id = ? ORDER BY ordinal')
              .all(id),
          ).toEqual(rawRows)
        }
      } finally {
        await host.closeAll()
        db.close()
        rmSync(directory, { recursive: true, force: true })
      }
    },
  )
})
