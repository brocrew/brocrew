import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { FakeRuntime } from '@brobot2/runtime'
import { executeRuntimeCommand } from '../src/main/runtime/ipc'
import { openDatabase, type AppDatabase } from '../src/main/db/connection'
import { applyMigrations } from '../src/main/db/migrate'
import { createSessionStore } from '../src/main/db/session-store'
import { NO_DISCOVERY } from '../src/main/adopt/discover-sessions'
import { RuntimeHost, type RuntimeEventSink } from '../src/main/runtime/runtime-host'
import { describeEvent } from '../src/renderer/src/lib/describe-event'
import { applyEvent, createTranscript } from '../src/renderer/src/lib/transcript'
import { isVisibleIn } from '../src/renderer/src/lib/transcript-mode'
import type {
  CreatedSession,
  RuntimeEventMessage,
  UserCommandEvent,
} from '../src/shared/runtime-ipc'

/**
 * **Which control the user pressed** (097 §2, from 085's *"the thing that would have saved me an
 * hour"*).
 *
 * 085 could prove a close had happened and not what closed it. The ledger records consequences —
 * `session:'ended'`, `turn:'interrupted'` — and nothing at all about the gesture that caused one.
 *
 * Three rulings are asserted here rather than only argued in a comment:
 *  1. **Same mechanism as 077**, not a third one: an app-authored `TranscriptEvent` published
 *     through `publishOurs`, never a `RuntimeEvent` a provider could be thought to emit.
 *  2. **Written at the IPC boundary**, because that boundary IS "a person pressed something" — so
 *     the internal callers of the very same host methods leave no trail.
 *  3. **Ledger-only**: it makes no transcript item, and the conversation is unchanged by it.
 *
 * That it opens no turn is asserted where that is decided — `turn-table.test.ts`, beside 077's own.
 */

class RecordingSink implements RuntimeEventSink {
  readonly aPersonIsBehindIt = false
  readonly messages: RuntimeEventMessage[] = []
  readonly alive = true
  constructor(readonly ownerId = 'owner:1') {}
  send(message: RuntimeEventMessage): void {
    this.messages.push(message)
  }
  sendLiveness(): void {}
}

const migrationsFolder = join(dirname(fileURLToPath(import.meta.url)), '../src/main/db/migrations')

describe('the user_command breadcrumb (097)', () => {
  let userData: string
  let db: AppDatabase
  let host: RuntimeHost
  let sink: RecordingSink

  beforeEach(() => {
    userData = mkdtempSync(join(tmpdir(), 'brobot2-cmd-'))
    // ⚠️ **A REAL store, not the null one** (097 review, finding 1). The first version of this file
    // used `NULL_SESSION_STORE` and asserted only what reached the sink — which is why it could not
    // see that the `interrupted` breadcrumb was landing on no turn at all. Turn attribution is a
    // property of `appendTx`, so a test that never writes to a database cannot check it.
    db = openDatabase(join(userData, 'brobot2.sqlite'))
    applyMigrations(db, migrationsFolder)
    let counter = 0
    host = new RuntimeHost({
      newSessionId: () => `sess_${++counter}`,
      readProviderConfig: (provider, home) => ({
        home,
        homeEnv: provider === 'claude' ? 'CLAUDE_CONFIG_DIR' : 'CODEX_HOME',
        model: `${provider} config model`,
        authNote: null,
        files: [],
      }),
      store: createSessionStore(db),
      discoverSessions: NO_DISCOVERY,
      nativeTranscriptPath: () => null,
      exportDirectory: () => join(userData, 'exports'),
      createRuntime: (provider) => new FakeRuntime(provider),
      prepareProviderHome: (provider, profileId) =>
        join(userData, 'provider-homes', profileId, provider),
      providerHomePath: (provider, profileId) =>
        join(userData, 'provider-homes', profileId, provider),
      resolveCwd: (sessionId, requested) => requested ?? join(userData, 'scratch', sessionId),
    })
    sink = new RecordingSink()
  })

  afterEach(async () => {
    await host.closeAll()
    db.close()
    rmSync(userData, { recursive: true, force: true })
  })

  /**
   * Wait for the turn table to show every turn closed.
   *
   * ⚠️ **Needed, and the reason is the finding itself.** A turn is closed by the `turn` event
   * arriving through the host's event pump, which is a different hop from the command promise —
   * and HOW different depends on the adapter. Claude's `interrupt()` terminalizes from inside its
   * own promise, so the close lands before the command resolves; `FakeRuntime`'s does not. That the
   * two disagree is exactly why the breadcrumb is written BEFORE the await: it is then attached to
   * the turn under either timing, instead of to whichever one the adapter happens to produce.
   */
  const settle = async (): Promise<void> => {
    for (let attempt = 0; attempt < 200; attempt += 1) {
      const open = db.prepare(`SELECT count(*) AS n FROM turn WHERE closed_at IS NULL`).get() as {
        n: number
      }
      if (open.n === 0) return
      await new Promise((resolve) => setTimeout(resolve, 5))
    }
    throw new Error('a turn never closed')
  }

  /** Every recorded breadcrumb with the turn the store attributed it to. */
  const recorded = (): { command: string; turn_id: string | null }[] =>
    db
      .prepare(
        `SELECT json_extract(payload, '$.command') AS command, turn_id
           FROM events WHERE type = 'user_command' ORDER BY ordinal`,
      )
      .all() as { command: string; turn_id: string | null }[]

  const open = async (): Promise<string> =>
    (
      (await executeRuntimeCommand(host, sink, {
        kind: 'createSession',
        provider: 'codex',
      })) as CreatedSession
    ).sessionId

  const breadcrumbs = (): UserCommandEvent[] =>
    sink.messages
      .map((message) => message.event)
      .filter((event): event is UserCommandEvent => event.type === 'user_command')

  it('records the gesture for every control that had nothing to say it', async () => {
    const sessionId = await open()

    await executeRuntimeCommand(host, sink, {
      kind: 'setSessionSetting',
      sessionId,
      body: { kind: 'model', value: 'gpt-5.1-codex' },
    })
    await executeRuntimeCommand(host, sink, {
      kind: 'setSessionSetting',
      sessionId,
      body: { kind: 'reasoningEffort', value: 'high' },
    })
    await executeRuntimeCommand(host, sink, { kind: 'setApprovalMode', sessionId, mode: 'auto' })
    await executeRuntimeCommand(host, sink, { kind: 'interrupt', sessionId })

    expect(breadcrumbs()).toEqual([
      { type: 'user_command', command: 'changed_model', target: 'gpt-5.1-codex' },
      { type: 'user_command', command: 'changed_effort', target: 'high' },
      { type: 'user_command', command: 'changed_approval_mode', target: 'auto' },
      { type: 'user_command', command: 'interrupted' },
    ])
  })

  it('clearing a setting records the gesture with NO target', async () => {
    // ⚠️ Absent means *"back to whatever the provider does by itself"*, which is a different
    // decision from picking a model that happens to be the default — and a `'default'` string would
    // have been indistinguishable from a provider that really is called that.
    const sessionId = await open()
    await executeRuntimeCommand(host, sink, {
      kind: 'setSessionSetting',
      sessionId,
      body: { kind: 'model', value: undefined },
    })
    expect(breadcrumbs()).toEqual([{ type: 'user_command', command: 'changed_model' }])
    expect(breadcrumbs()[0]).not.toHaveProperty('target')
  })

  it('NEVER carries the message text, on either command that has one', async () => {
    const sessionId = await open()
    const secret = 'my database password is hunter2'
    await executeRuntimeCommand(host, sink, { kind: 'send', sessionId, text: 'first' })
    await executeRuntimeCommand(host, sink, { kind: 'sendInterrupting', sessionId, text: secret })

    // The gesture is recorded…
    expect(breadcrumbs().map((event) => event.command)).toEqual(['interrupted_to_send'])
    // …and not one character of the message is in it. Asserted over the SERIALIZED event, because
    // that is what lands in the row, and a field added later would slip past a property check.
    for (const event of breadcrumbs()) {
      expect(JSON.stringify(event)).not.toContain('hunter2')
      expect(JSON.stringify(event)).not.toContain(secret)
    }
    // Paired with the positive that makes it mean something: the text really did travel, on the
    // `user_turn` whose job that is. Without this, a boundary that dropped the message entirely
    // would satisfy the assertion above.
    const turns = sink.messages
      .map((message) => message.event)
      .filter((event) => event.type === 'user_turn')
    expect(turns.map((event) => (event as { text: string }).text)).toContain(secret)
  })

  it('a gesture that already has its own event does not get a second one', async () => {
    // ⚠️ The ruling that keeps this from becoming a third way to say "the app did something".
    // Queueing is `message_queued`; answering a card is `user_decision`; sending is `user_turn`.
    // Those are the thing itself, not a breadcrumb of a control, and duplicating them is the
    // failure this event was designed around.
    const sessionId = await open()
    await executeRuntimeCommand(host, sink, { kind: 'send', sessionId, text: 'go' })
    await executeRuntimeCommand(host, sink, { kind: 'queueMessage', sessionId, text: 'later' })
    // ⚑ **The cancel NAMES the message** (354) — there is no session-shaped cancel any more, and the
    // name is read off the `message_queued` this boundary just published rather than out of the
    // command's return type, so this stays a test about breadcrumbs.
    const messageId = sink.messages
      .map((message) => message.event)
      .find((event) => event.type === 'message_queued')?.messageId
    expect(messageId, 'the queue published a named message').toBeTypeOf('string')
    await executeRuntimeCommand(host, sink, {
      kind: 'cancelQueuedMessage',
      sessionId,
      messageId: messageId ?? '',
    })

    expect(breadcrumbs()).toEqual([])
    // Paired: those gestures DID leave their own durable trail, so the emptiness above is a
    // decision about duplication rather than a boundary that recorded nothing.
    expect(sink.messages.map((message) => message.event.type)).toEqual(
      expect.arrayContaining(['user_turn', 'message_queued', 'message_unqueued']),
    )
  })

  it('leaves no trail when the session is not the caller’s to command', async () => {
    // A stale Close on a session that has already ended is an ordinary thing for a window to do.
    // It must not throw, and it must not record a gesture against a conversation that is not there.
    await executeRuntimeCommand(host, sink, { kind: 'close', sessionId: 'sess_gone' })
    expect(breadcrumbs()).toEqual([])
  })

  it('a close through the button is recorded; the same close from inside is not', async () => {
    const sessionId = await open()
    await executeRuntimeCommand(host, sink, { kind: 'close', sessionId })
    expect(breadcrumbs()).toEqual([{ type: 'user_command', command: 'closed' }])

    // ⚠️ **The point of writing it at the IPC boundary**, stated as a test. `host.close()` is also
    // called when a window goes away and when the app quits, and neither of those is a person
    // pressing anything. Same method, same session id, no breadcrumb — and nothing had to remember
    // to suppress one.
    const second = await open()
    await host.close(second, sink)
    expect(breadcrumbs()).toEqual([{ type: 'user_command', command: 'closed' }])
  })

  /**
   * **The `interrupted` breadcrumb lands on the turn it stopped** (097 review, finding 1).
   *
   * ⚠️ This is the test the first version of this change did not have, and its absence hid a real
   * defect. `turn-table.test.ts` asserted the attribution by feeding the store a hand-written event
   * order — breadcrumb, then turn-close — and that order is one the product never produces:
   * `handle.interrupt()` terminalizes the turn from inside its own promise, so an `await` before the
   * note arrives to find the turn already closed and `turnFor` stamps `null`. A green test over an
   * impossible ordering is worth less than no test, because it reads as coverage.
   *
   * So this one presses Stop the way the renderer does — through `executeRuntimeCommand`, against a
   * real provider handle and a real database — and reads the attribution out of the turn table.
   */
  it('the Stop breadcrumb lands on the turn it stopped, through the real command path', async () => {
    const sessionId = await open()
    await executeRuntimeCommand(host, sink, { kind: 'send', sessionId, text: 'a long job' })
    const turnId = (
      db.prepare(`SELECT id FROM turn ORDER BY ordinal`).all() as { id: string }[]
    ).at(-1)?.id
    expect(
      turnId,
      'the send opened no turn — the fixture is not exercising a turn at all',
    ).toBeDefined()

    await executeRuntimeCommand(host, sink, { kind: 'interrupt', sessionId })

    expect(recorded()).toEqual([{ command: 'interrupted', turn_id: turnId }])
    // …and that turn really did end, so `turn_id` above is the id of the turn the Stop STOPPED
    // rather than of whatever happened to be open. This is the pairing that makes the assertion
    // mean what its name says.
    await settle()
    const turn = db.prepare(`SELECT end_reason FROM turn WHERE id = ?`).get(turnId) as {
      end_reason: string | null
    }
    expect(turn.end_reason).toBe('interrupted')
  })

  it('a gesture between turns is attributed to neither, and that is the ruling', async () => {
    const sessionId = await open()
    await executeRuntimeCommand(host, sink, { kind: 'send', sessionId, text: 'one' })
    await executeRuntimeCommand(host, sink, { kind: 'interrupt', sessionId })
    await settle()
    // The turn is over. A setting changed now belongs to no turn — a decision made after a turn is
    // not part of its record.
    await executeRuntimeCommand(host, sink, {
      kind: 'setSessionSetting',
      sessionId,
      body: { kind: 'model', value: 'gpt-5.1-codex' },
    })
    const rows = recorded()
    expect(rows.map((row) => row.command)).toEqual(['interrupted', 'changed_model'])
    // Paired: the first one IS attributed, so `null` on the second is a decision rather than a
    // store that attributes nothing.
    expect(rows[0]!.turn_id).not.toBeNull()
    expect(rows[1]!.turn_id).toBeNull()
  })

  it('leaving plan mode and starting the plan are recorded, and told apart', async () => {
    // ⚠️ 097 review, finding 10: these three verbs — `entered_plan_mode`, `left_plan_mode`,
    // `started_the_plan` — were mapped in `ipc.ts` and exercised by nothing, unit or live. A verb
    // nothing drives is a verb that can be wired to the wrong branch for free.
    const sessionId = await open()
    await executeRuntimeCommand(host, sink, {
      kind: 'setSessionSetting',
      sessionId,
      body: { kind: 'planMode', on: true },
    })
    await executeRuntimeCommand(host, sink, { kind: 'endPlanMode', sessionId })
    expect(recorded().map((row) => row.command)).toEqual(['entered_plan_mode', 'left_plan_mode'])

    // …and the OTHER ending, which is a different decision and must not collapse into the first.
    await executeRuntimeCommand(host, sink, {
      kind: 'setSessionSetting',
      sessionId,
      body: { kind: 'planMode', on: true },
    })
    await executeRuntimeCommand(host, sink, {
      kind: 'endPlanMode',
      sessionId,
      text: 'go ahead then',
    })
    expect(recorded().map((row) => row.command)).toEqual([
      'entered_plan_mode',
      'left_plan_mode',
      'entered_plan_mode',
      'started_the_plan',
    ])
    // Entering plan mode carries no object; nothing invented one from the boolean.
    const entered = sink.messages
      .map((message) => message.event)
      .filter(
        (event): event is UserCommandEvent =>
          event.type === 'user_command' && event.command === 'entered_plan_mode',
      )
    expect(entered).toHaveLength(2)
    for (const event of entered) expect(event).not.toHaveProperty('target')
    // …and the plan's own message is not in the breadcrumb, on the ending that has one.
    for (const event of breadcrumbs()) expect(JSON.stringify(event)).not.toContain('go ahead then')
  })

  it('reads as a gesture in the raw stream, and makes no item in the conversation', () => {
    expect(
      describeEvent({ type: 'user_command', command: 'changed_model', target: 'claude-opus-5' }),
    ).toBe('changed model → claude-opus-5 (ours)')
    expect(describeEvent({ type: 'user_command', command: 'left_plan_mode' })).toBe(
      'left plan mode (ours)',
    )

    // Ledger-only: the fold takes it and the conversation is unchanged by it.
    const state = createTranscript()
    applyEvent(state, { type: 'user_turn', text: 'hello' })
    const before = state.items.length
    applyEvent(state, { type: 'user_command', command: 'interrupted' })
    applyEvent(state, { type: 'user_command', command: 'closed' })
    expect(state.items).toHaveLength(before)
    // …and `before` is not zero, so "unchanged" is a statement about a transcript that exists.
    expect(before).toBeGreaterThan(0)
    // Every item that IS there is still visible in normal mode — nothing was hidden to achieve it.
    expect(state.items.every((item) => isVisibleIn('normal', item))).toBe(true)
  })
})
