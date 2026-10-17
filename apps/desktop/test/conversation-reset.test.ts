import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  FakeProviderSessions,
  FakeRuntime,
  parseSessionRef,
  type RuntimeEvent,
  type SessionRef,
} from '@brobot2/runtime'
import { openDatabase, type AppDatabase } from '../src/main/db/connection'
import { applyMigrations } from '../src/main/db/migrate'
import { createSessionStore, type SessionStore } from '../src/main/db/session-store'
import { NO_DISCOVERY } from '../src/main/adopt/discover-sessions'
import { RuntimeHost, type RuntimeEventSink } from '../src/main/runtime/runtime-host'
import type { RuntimeEventMessage } from '../src/shared/runtime-ipc'
import { applyEvent, appendUserMessage, createTranscript } from '../src/renderer/src/lib/transcript'
import { isVisibleIn, visibleItems } from '../src/renderer/src/lib/transcript-mode'

/**
 * **What `/clear` costs, and what a reader is told about it** (199, from 192 H5 + H6).
 *
 * ⛔ **The defect these are written against loses WORK, not visibility.** Claude emits
 * `conversation_reset` carrying `new_conversation_id`, and this app read that field with nothing at
 * all: the field fell to `normalizeMessage`'s tail, became `unknown{lifecycle}`, and was filtered
 * out of the reading view. So the session's ref went on naming the conversation the provider had
 * abandoned — and a resume reopened THAT one, with every turn typed after the reset gone.
 *
 * Two halves, asserted separately because they fail separately: the identity has to follow the
 * provider, and the person at the keyboard has to be told it did.
 *
 * ⚠️ **`721`: these run on `FakeRuntime`, whose reset id is one its provider can reopen — Claude's
 * is not.** They were green on `main` while every real `/clear`ed conversation was unreopenable: the
 * id `conversation_reset` names has no transcript, and the ref must be the next init's (R75). That
 * is asserted over the real `ClaudeRuntime` in `a-cleared-conversation-reopens.test.ts`.
 */

const migrations = join(dirname(fileURLToPath(import.meta.url)), '../src/main/db/migrations')

class NullSink implements RuntimeEventSink {
  // 349 · this double stands in for a WINDOW — the tests below answer for a person through it.
  readonly aPersonIsBehindIt = true
  readonly messages: RuntimeEventMessage[] = []
  readonly alive = true
  constructor(readonly ownerId = 'owner:1') {}
  send(message: RuntimeEventMessage): void {
    this.messages.push(message)
  }
  sendLiveness(): void {}
}

async function waitFor(predicate: () => boolean, what: string, timeoutMs = 2_000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (predicate()) return
    await new Promise((resolve) => setTimeout(resolve, 5))
  }
  throw new Error(`timed out waiting for ${what}`)
}

describe('a conversation reset moves what a resume reopens (199)', () => {
  let dir: string
  let db: AppDatabase
  let store: SessionStore
  /**
   * ⚑ **The PROVIDER's record, shared across hosts** (186's `FakeProviderSessions`). A relaunched
   * app builds a new host and a new runtime object; Claude's session files are on disk and outlive
   * both. Without this the pretend relaunch could not resume anything, and the assertion below —
   * *"it reopened the POST-reset conversation"* — would have nothing to be true of.
   */
  let provider: FakeProviderSessions

  /** Every live handle, so a test can make the provider do something to a session it is running. */
  let handles: { simulateConversationReset(sessionId?: string): void; ref: SessionRef }[]

  function buildHost(overrides: Partial<ConstructorParameters<typeof RuntimeHost>[0]> = {}) {
    return new RuntimeHost({
      store,
      discoverSessions: NO_DISCOVERY,
      nativeTranscriptPath: () => null,
      exportDirectory: () => join(dir, 'exports'),
      createRuntime: (which) => {
        const runtime = new FakeRuntime(which, { sessions: provider })
        return {
          provider: which,
          listModels: (context) => runtime.listModels(context),
          start: async (options) => {
            const handle = await runtime.start(options)
            handles.push(handle)
            return handle
          },
          resume: async (ref, options) => {
            const handle = await runtime.resume(ref, options)
            handles.push(handle)
            return handle
          },
        }
      },
      prepareProviderHome: (which) => join(dir, 'homes', which),
      providerHomePath: (which) => join(dir, 'homes', which),
      resolveCwd: (sessionId, requested) => requested ?? join(dir, 'scratch', sessionId),
      newSessionId: () => 'sess_1',
      readProviderConfig: (_which, home) => ({
        home,
        homeEnv: 'CODEX_HOME',
        model: 'file-based',
        authNote: null,
        files: [],
      }),
      ...overrides,
    })
  }

  const refOf = (sessionId: string): SessionRef => {
    const row = db
      .prepare('SELECT external_ref FROM provider_session WHERE id = ?')
      .get(sessionId) as { external_ref: string | null }
    if (row.external_ref === null) throw new Error('no ref recorded')
    return parseSessionRef(row.external_ref)
  }

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'brobot2-reset-'))
    db = openDatabase(join(dir, 'brobot2.sqlite'))
    applyMigrations(db, migrations)
    store = createSessionStore(db)
    provider = new FakeProviderSessions()
    handles = []
  })

  afterEach(() => {
    db.close()
    rmSync(dir, { recursive: true, force: true })
  })

  /** One turn, driven to its ending, so the ledger has something in it either side of the seam. */
  async function oneTurn(host: RuntimeHost, sessionId: string, text: string, sink: NullSink) {
    const from = sink.messages.length
    const seen = (type: string) => sink.messages.slice(from).some((m) => m.event.type === type)
    await host.send(sessionId, text, sink)
    await waitFor(() => seen('permission_request'), `the card for "${text}"`)
    const card = sink.messages
      .slice(from)
      .map((m) => m.event)
      .find((e) => e.type === 'permission_request')
    if (card?.type !== 'permission_request') throw new Error('no card')
    await host.respondPermission(sessionId, card.id, { outcome: 'allow' }, sink)
    await waitFor(() => seen('turn'), `the turn for "${text}"`)
  }

  it('⛔ a resume after a `/clear` reopens the POST-reset conversation, with the turns typed into it', async () => {
    const host = buildHost()
    const sink = new NullSink()
    const created = await host.createSession({ provider: 'claude' }, sink)
    await waitFor(() => handles.length === 1, 'the session to be running')

    await oneTurn(host, created.sessionId, 'before the clear', sink)
    const before = refOf(created.sessionId)

    // The user types `/clear`. Nothing intercepts it — the composer forwards slash commands to the
    // provider verbatim, which is how a real `/compact` reached this app's transcript (133) — so
    // the provider resets and announces the conversation it moved to.
    handles[0]?.simulateConversationReset()
    await waitFor(
      () => sink.messages.some((m) => m.event.type === 'conversation_reset'),
      'the reset to reach the renderer',
    )
    await waitFor(() => refOf(created.sessionId).sessionId !== before.sessionId, 'the ref to move')

    // …and then keeps working. THIS is the work the old behaviour threw away.
    await oneTurn(host, created.sessionId, 'after the clear', sink)
    const after = refOf(created.sessionId)
    await host.close(created.sessionId, sink)

    // The row now names the conversation the provider is in, and only the id moved.
    expect(after.sessionId).not.toBe(before.sessionId)
    expect(after).toMatchObject({ provider: 'claude', cwd: before.cwd, rotation: before.rotation })
    // ⛔ **…and the CLOSE did not write it back.** `session:'ended'` carries a ref and this store
    // writes the ref on every `session` event, so a handle whose own ref had not followed the reset
    // would have overwritten the row with the abandoned conversation on the way out — after every
    // assertion above it had already passed.
    expect(refOf(created.sessionId)).toEqual(after)

    // Quit and relaunch: a brand-new host, a brand-new runtime object, the provider's own record
    // intact.
    handles = []
    const relaunched = buildHost()
    const resumed = await relaunched.resumeSession(created.sessionId, new NullSink())

    // ⛔ **The claim.** It reopened the post-reset conversation…
    expect(handles[0]?.ref.sessionId).toBe(after.sessionId)
    // …and the turns typed after the reset came back with it.
    const prompts = resumed.history.entries
      .map((entry) => entry.event)
      .filter((event) => event.type === 'user_turn')
      .map((event) => (event.type === 'user_turn' ? event.text : ''))
    expect(prompts).toEqual(['before the clear', 'after the clear'])
    // …and the seam is in the record, between them, rather than only in the row.
    const types = resumed.history.entries.map((entry) => entry.event.type)
    expect(types.indexOf('conversation_reset')).toBeGreaterThan(types.indexOf('user_turn'))
    expect(types.lastIndexOf('user_turn')).toBeGreaterThan(types.indexOf('conversation_reset'))

    await relaunched.closeAll()
  })

  /**
   * ⚠️ **The paired positive, and without it the test above proves only that SOMETHING writes the
   * ref column.** A build that rewrote the ref on any event at all would pass it. This is the same
   * flow with no reset in it, and the ref must not move at all.
   */
  it('…while an ordinary session’s ref does not move across the same flow', async () => {
    const host = buildHost()
    const sink = new NullSink()
    const created = await host.createSession({ provider: 'claude' }, sink)
    await waitFor(() => handles.length === 1, 'the session to be running')

    await oneTurn(host, created.sessionId, 'one', sink)
    const first = refOf(created.sessionId)
    await oneTurn(host, created.sessionId, 'two', sink)
    await host.close(created.sessionId, sink)

    expect(refOf(created.sessionId)).toEqual(first)

    handles = []
    const relaunched = buildHost()
    await relaunched.resumeSession(created.sessionId, new NullSink())
    expect(handles[0]?.ref.sessionId).toBe(first.sessionId)
    await relaunched.closeAll()
  })
})

/**
 * **The visibility half** (199 §1 and §2), at the fold that decides what a reader sees.
 *
 * ⛔ Asserted in `normal` and not only in `debug`, because `debug` returns `true` for everything —
 * a visibility test that only ran there would pass over a row nobody can see.
 */
describe('what a reader is told (199)', () => {
  const ref: SessionRef = {
    provider: 'claude',
    sessionId: 'sess-before',
    cwd: '/tmp/scratch',
    rotation: 0,
  }

  function transcriptWith(...events: RuntimeEvent[]) {
    const state = createTranscript()
    applyEvent(state, { type: 'session', state: 'started', ref }, 1)
    appendUserMessage(state, 'do the thing')
    events.forEach((event, index) => applyEvent(state, event, 2 + index))
    return state
  }

  it('⛔ a reset is a durable ROW in the reading view, naming the conversation it moved to', () => {
    const state = transcriptWith({
      type: 'conversation_reset',
      ref: { ...ref, sessionId: 'sess-after' },
      source: 'conversation_reset',
    })

    const row = state.items.find((item) => item.kind === 'reset')
    expect(row).toMatchObject({
      kind: 'reset',
      sessionId: 'sess-after',
      // Cited, not asserted: the row says which signal it came from.
      source: 'conversation_reset',
    })
    expect(row?.at).toBe(2) // stamped where it happened, not when it was replayed

    // ⛔ The claim: it survives the reading view.
    expect(row && isVisibleIn('normal', row)).toBe(true)
    expect(visibleItems('normal', state.items).some((item) => item.kind === 'reset')).toBe(true)

    // ⚠️ The paired negative: the `session started` line beside it is STILL hidden, so this is not
    // "everything became visible" — it is this one row, on purpose. That notice is exactly where a
    // reset would have been filed if it had been made a `session` state.
    expect(
      visibleItems('normal', state.items).some(
        (item) => item.kind === 'notice' && item.level === 'info',
      ),
    ).toBe(false)
  })

  it('…and the transcript’s own ref follows it, so the header cannot name the abandoned conversation', () => {
    const state = transcriptWith({
      type: 'conversation_reset',
      ref: { ...ref, sessionId: 'sess-after' },
      source: 'conversation_reset',
    })
    expect(state.ref?.sessionId).toBe('sess-after')
    // ⚑ …and the terminal latch is untouched. A reset arrives mid-life from a session that never
    // stopped; only a session ANNOUNCING ITSELF OPEN clears a previous life's ending (085).
    expect(state.ended).toBe(false)
  })

  it('⛔ a refusal is a line the reader can see, carrying its category and explanation', () => {
    const state = transcriptWith({
      type: 'error',
      fatal: false,
      message: 'claude declined to answer (cyber) — no fallback model was tried: because reasons',
    })

    const shown = visibleItems('normal', state.items)
    const notice = shown.find((item) => item.kind === 'notice')
    expect(notice).toMatchObject({ kind: 'notice', level: 'warn' })
    expect(notice?.kind === 'notice' && notice.text).toContain('cyber')
    expect(notice?.kind === 'notice' && notice.text).toContain('because reasons')
  })

  it('…while ordinary hidden activity is still hidden (049)', () => {
    const state = transcriptWith(
      {
        type: 'unknown',
        provider: 'claude',
        category: 'activity',
        label: 'memory_recall',
        raw: {},
      },
      {
        type: 'unknown',
        provider: 'claude',
        category: 'lifecycle',
        label: 'auth_status',
        raw: {},
      },
    )
    // Non-vacuity: the chatter really is in the transcript — it is the READING view that drops it.
    expect(state.items.filter((item) => item.kind === 'unknown')).toHaveLength(2)
    expect(visibleItems('normal', state.items).some((item) => item.kind === 'unknown')).toBe(false)
  })
})
