import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { FakeRuntime } from '@brobot2/runtime'
import { openDatabase, type AppDatabase } from '../src/main/db/connection'
import { applyMigrations } from '../src/main/db/migrate'
import { createSessionStore, type SessionStore } from '../src/main/db/session-store'
import { NO_DISCOVERY } from '../src/main/adopt/discover-sessions'
import { executeRuntimeCommand } from '../src/main/runtime/ipc'
import { RuntimeHost, type RuntimeEventSink } from '../src/main/runtime/runtime-host'
import { answerFor, attentionQueue, OPEN_REQUEST_MISSED } from '../src/renderer/src/lib/attention'
import { createSessionRecord, type SessionRecord } from '../src/renderer/src/lib/session-record'
import { applyEvent } from '../src/renderer/src/lib/transcript'
import type { CreatedSession, RuntimeCommand, RuntimeEventMessage } from '../src/shared/runtime-ipc'

/**
 * **Answering from the overview, end to end** (Slice 2 · 205 §2).
 *
 * ⛔ **203 made every control verb take a caller, and this is the assertion that the new surface
 * goes through it rather than around it.** The queue is built from the renderer's own records, the
 * decision it offers is turned into a wire payload by `answerFor`, and that payload is driven through
 * `executeRuntimeCommand` — the door 195 found open — twice: once as the window that owns the
 * session, and once as a window that does not.
 *
 * ⚠️ **The second risk this closes is 205's own, and 203's tests could not see it.** An overview
 * answers conversations that are mostly NOT on screen; a handler that reached for the active session
 * id would answer the wrong one and pass every owner check while doing it. So the queue here holds
 * TWO conversations and the answer is sent for the SECOND — the one that is not first, not active,
 * and not the one the other row names.
 */

const here = dirname(fileURLToPath(import.meta.url))
const migrationsFolder = join(here, '../src/main/db/migrations')
const SCREEN = join(here, '../src/renderer/src/components/RuntimeScreen.vue')

/** A sink that keeps what it was sent, exactly as 203's does. */
function sinkNamed(ownerId: string): RuntimeEventSink & { events: () => RuntimeEventMessage[] } {
  const seen: RuntimeEventMessage[] = []
  return {
    ownerId,
    aPersonIsBehindIt: true,
    alive: true,
    send: (message: RuntimeEventMessage) => seen.push(message),
    sendLiveness: () => {},
    events: () => seen,
  }
}

async function waitFor(predicate: () => boolean, what: string): Promise<void> {
  for (let attempt = 0; attempt < 200; attempt++) {
    if (predicate()) return
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
  throw new Error(`timed out waiting for ${what}`)
}

describe('answering from the overview', () => {
  let dir: string
  let db: AppDatabase
  let store: SessionStore
  let host: RuntimeHost
  let owner: ReturnType<typeof sinkNamed>
  let stranger: ReturnType<typeof sinkNamed>

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'brobot2-overview-'))
    db = openDatabase(join(dir, 'db.sqlite'))
    applyMigrations(db, migrationsFolder)
    store = createSessionStore(db)
    let counter = 0
    host = new RuntimeHost({
      store,
      discoverSessions: NO_DISCOVERY,
      nativeTranscriptPath: () => null,
      exportDirectory: () => join(dir, 'exports'),
      createRuntime: (provider) => new FakeRuntime(provider),
      prepareProviderHome: (provider, profileId) =>
        join(dir, 'provider-homes', profileId, provider),
      providerHomePath: (provider, profileId) => join(dir, 'provider-homes', profileId, provider),
      resolveCwd: (id, requested) => requested ?? join(dir, 'scratch', id),
      newSessionId: () => `sess_${++counter}`,
      readProviderConfig: (_provider, home) => ({
        home,
        homeEnv: 'CODEX_HOME',
        model: 'fake',
        authNote: null,
        files: [],
      }),
    })
    owner = sinkNamed('webContents:1')
    stranger = sinkNamed('webContents:2')
  })

  afterEach(async () => {
    await host.closeAll()
    db.close()
    rmSync(dir, { recursive: true, force: true })
  })

  const ask = (sink: RuntimeEventSink, command: RuntimeCommand): Promise<unknown> =>
    executeRuntimeCommand(host, sink as never, command)

  /**
   * The renderer's own record, folded from what the sink was sent — the queue's real input.
   *
   * ⛔ **The provider is a PARAMETER since 299, and the default being `'codex'` is the whole reason
   * this file could run the entire join and still miss it** (297 §3). Every session here was Codex,
   * so `FakeRuntime` published `CODEX_OFFER` — `allow_for_session`, the narrow grant — and the one
   * card shape where the overview drew a wholesale grant in the same slot was never constructed.
   * *"A test that drives the whole real path can still miss everything if one fixture value is
   * wrong."*
   */
  function recordFrom(
    sessionId: string,
    sink: ReturnType<typeof sinkNamed>,
    provider: 'codex' | 'claude' = 'codex',
  ): SessionRecord {
    const record = createSessionRecord(sessionId)
    record.meta = { sessionId, provider, cwd: dir, profileId: 'default' } as CreatedSession
    record.phase = 'open'
    for (const message of sink.events()) {
      if (message.sessionId !== sessionId) continue
      applyEvent(record.control, message.event, message.at)
    }
    return record
  }

  it('⛔ answers the row’s OWN conversation, and the host lets the owner through', async () => {
    // Two conversations, both this window's, both frozen on a card.
    const first = await host.createSession({ provider: 'codex', cwd: dir }, owner)
    const second = await host.createSession({ provider: 'codex', cwd: dir }, owner)
    await ask(owner, { kind: 'send', sessionId: first.sessionId, text: 'run something' })
    await ask(owner, { kind: 'send', sessionId: second.sessionId, text: 'run something' })
    await waitFor(
      () =>
        owner
          .events()
          .filter((message) => message.event.type === 'permission_request')
          .map((message) => message.sessionId)
          .filter((id, index, all) => all.indexOf(id) === index).length === 2,
      'a card on each conversation',
    )

    const queue = attentionQueue(
      [recordFrom(first.sessionId, owner), recordFrom(second.sessionId, owner)],
      () => 'waiting: permission',
    )
    expect(queue).toHaveLength(2)

    // ⛔ The SECOND row — the one an `activeId` handler would have got wrong.
    const row = queue.find((request) => request.sessionId === second.sessionId)
    expect(row).toBeDefined()
    const allow = row?.decisions.find((decision) => decision.label === 'Allow')
    expect(allow).toBeDefined()
    const answer = answerFor(allow!)
    expect(answer).toEqual({ permission: { outcome: 'allow' } })

    await ask(owner, {
      kind: 'respondPermission',
      sessionId: row!.sessionId,
      requestId: row!.requestId,
      decision: (answer as { permission: never }).permission,
    })

    await waitFor(
      () =>
        owner
          .events()
          .some(
            (message) =>
              message.sessionId === second.sessionId && message.event.type === 'tool_result',
          ),
      'the tool the overview allowed, on the SECOND conversation',
    )
    // …and the first one is still frozen, which is what proves the id came off the row.
    expect(
      owner
        .events()
        .some(
          (message) =>
            message.sessionId === first.sessionId && message.event.type === 'tool_result',
        ),
    ).toBe(false)
  })

  it('⛔ …and a window that does not own the session cannot answer from its own overview', async () => {
    const made = await host.createSession({ provider: 'codex', cwd: dir }, owner)
    await ask(owner, { kind: 'send', sessionId: made.sessionId, text: 'run something' })
    await waitFor(
      () => owner.events().some((message) => message.event.type === 'permission_request'),
      'the card',
    )

    const row = attentionQueue([recordFrom(made.sessionId, owner)], () => 'waiting: permission')[0]
    expect(row).toBeDefined()
    const answer = answerFor(row!.decisions[0]!)

    // The identical payload, from a window that does not hold the session. 203's `require` asks
    // `mayControl(slot, by)` on the way in, and the sentence a person reads names no id.
    await expect(
      ask(stranger, {
        kind: 'respondPermission',
        sessionId: row!.sessionId,
        requestId: row!.requestId,
        decision: (answer as { permission: never }).permission,
      }),
    ).rejects.toThrow(/belongs to another window/)

    // Still frozen — the refusal is a refusal, not a slower path to the same effect.
    expect(owner.events().some((message) => message.event.type === 'tool_result')).toBe(false)
  })

  /**
   * 🔴 **The second button, on the one card shape where it used to be the wholesale grant** (299 §1,
   * from 297 finding 1).
   *
   * ⛔ **`claudeDecisionsFor` is a `.filter` over a fixed array, so the provider's ORDER survives**:
   * a `Write` card offers `[allow, allow_for_session, deny, cancel]` and an opaque `Bash` card offers
   * `[allow, allow_all_for_session, deny, cancel]`. The overview mapped that array positionally onto
   * peer buttons with one shared `data-cy` and `.deny` as the only style variant — so index 1 meant
   * *"this conversation"* on one card and *"every Bash command this session"* on the other.
   *
   * ⚑ **The whole path is real** — `RuntimeHost`, the fold, `attentionQueue`, `answerFor`,
   * `executeRuntimeCommand` — exactly as it was before. The only thing that changed is the fixture
   * literal.
   */
  // 🔴 743 · re-aimed — `739` F-1, ruled: the wholesale grant is a one-click answer here too, AFTER
  // the row and under its own warning; ⚑ what this test is about (299 §1) holds — never the second.
  it('🔴 the second button on an opaque card is Deny, and the wholesale grant comes after the row', async () => {
    const made = await host.createSession({ provider: 'claude', cwd: dir }, owner)
    await ask(owner, { kind: 'send', sessionId: made.sessionId, text: 'run something' })
    await waitFor(
      () => owner.events().some((message) => message.event.type === 'permission_request'),
      'the opaque card',
    )

    // ⚑ **The fixture first, or every assertion below passes over the wrong card.** This is the
    // shape `claude-runtime.test.ts:4272` pins on the declaring side: the wholesale grant IS offered
    // and the narrow one is NOT, because a command that discloses no path has nothing to scope to.
    const published = owner
      .events()
      .map((message) => message.event)
      .find((event) => event.type === 'permission_request') as {
      scope: { availableDecisions: string[] }
      action: string
    }
    expect(published.scope.availableDecisions).toContain('allow_all_for_session')
    expect(published.scope.availableDecisions).not.toContain('allow_for_session')
    expect(published.action).toBe('Bash')

    const row = attentionQueue(
      [recordFrom(made.sessionId, owner, 'claude')],
      () => 'waiting: permission',
    )[0]
    expect(row).toBeDefined()

    // ⛔ **What IS drawn, and in what order** — asserting only the absence would pass over an empty
    // row just as happily (196's rule).
    expect(row!.decisions.map((decision) => decision.label)).toEqual([
      'Allow',
      'Deny',
      'Cancel',
      'Allow every Bash call for this conversation',
    ])
    expect(row!.decisions.map((decision) => decision.label)).not.toContain(
      'Allow all for this conversation',
    )

    // ⛔ …and it is OFFERED rather than silently dropped (058's relief for the tool with the worst
    // approval fatigue), last, under the card's own warning — and it sends the wholesale grant.
    const wide = row!.decisions.at(-1)!
    expect(wide.kind === 'permission' ? wide.warns : null).toBe(
      '⚠ Covers any Bash command for this conversation — not just this one. Nothing will ask again, whatever it runs.',
    )
    expect(answerFor(wide)).toEqual({ permission: { outcome: 'allow_all_for_session' } })

    // 🔴 **The gesture itself.** Index 1 — the slot a Write card gives to "Allow for this
    // conversation" — now sends a refusal, and the wire payload is what proves it.
    const second = answerFor(row!.decisions[1]!)
    expect(second).toEqual({ permission: { outcome: 'deny' } })
    await ask(owner, {
      kind: 'respondPermission',
      sessionId: row!.sessionId,
      requestId: row!.requestId,
      decision: (second as { permission: never }).permission,
    })

    // …and the conversation is still asking on the next turn, which is what a NARROW answer means.
    await waitFor(
      () => owner.events().some((message) => message.event.type === 'turn'),
      'the denied turn to finish',
    )
    const cardsBefore = owner
      .events()
      .filter((message) => message.event.type === 'permission_request').length
    await ask(owner, { kind: 'send', sessionId: made.sessionId, text: 'run something else' })
    await waitFor(
      () =>
        owner.events().filter((message) => message.event.type === 'permission_request').length >
        cardsBefore,
      'a second card, because nothing standing was granted',
    )
  })

  /**
   * ⚑ **The control, at the same moment** — otherwise the test above proves only that a button
   * labelled Deny denies (`Measure the incumbent too`).
   *
   * The outcome the row no longer offers really IS standing: answered directly, the very next turn
   * runs the same tool with no card at all. That is what a mis-aimed click used to buy, and it is
   * why the slot mattered.
   */
  it('⛔ …and the grant it used to sit in really is standing — the next turn asks nothing', async () => {
    const made = await host.createSession({ provider: 'claude', cwd: dir }, owner)
    await ask(owner, { kind: 'send', sessionId: made.sessionId, text: 'run something' })
    await waitFor(
      () => owner.events().some((message) => message.event.type === 'permission_request'),
      'the opaque card',
    )
    const row = attentionQueue(
      [recordFrom(made.sessionId, owner, 'claude')],
      () => 'waiting: permission',
    )[0]!
    await ask(owner, {
      kind: 'respondPermission',
      sessionId: row.sessionId,
      requestId: row.requestId,
      decision: { outcome: 'allow_all_for_session' },
    })
    await waitFor(
      () => owner.events().some((message) => message.event.type === 'turn'),
      'the granted turn to finish',
    )
    const cardsBefore = owner
      .events()
      .filter((message) => message.event.type === 'permission_request').length

    await ask(owner, { kind: 'send', sessionId: made.sessionId, text: 'run something else' })
    await waitFor(
      () => owner.events().filter((message) => message.event.type === 'tool_result').length >= 2,
      'the second turn running its tool',
    )
    expect(
      owner.events().filter((message) => message.event.type === 'permission_request').length,
      'the wholesale grant is standing — the second turn asked nothing',
    ).toBe(cardsBefore)
  })

  it('turns a question option into the card’s own wire shape', () => {
    expect(answerFor({ kind: 'answer', label: 'Red', questionId: 'q1', option: 'Red' })).toEqual({
      userInput: { kind: 'answer', answers: { q1: 'Red' } },
    })
    // Reject is protocol-safe and is what every limited row still offers.
    expect(answerFor({ kind: 'reject', label: 'Reject' })).toEqual({
      userInput: { kind: 'reject' },
    })
  })

  it('⛔ a GRANT’s Approve is the card’s payload, and it is not the decline (207 M1)', () => {
    // ⚠️ These two differ ONLY in `kind`, and that is the whole reason `approve` is its own decision
    // rather than an `answer` with an empty question id. `userInputPayloadFor` reads the kind: for a
    // permission request an `answer` becomes `codexGrant` (approved) and a `reject` becomes
    // `userInputDecline` (denied). An id nobody asked for would go on the wire as a real key.
    expect(
      answerFor({ kind: 'approve', label: 'Approve', consent: 'access-for-this-turn' }),
    ).toEqual({
      userInput: { kind: 'answer', answers: {} },
    })
    expect(answerFor({ kind: 'reject', label: 'Reject' })).not.toEqual(
      answerFor({ kind: 'approve', label: 'Approve', consent: 'access-for-this-turn' }),
    )
  })
})

/**
 * ⛔ **The screen's half, as source** — `211` §11's rule. A pane that can be sent to a card and a
 * screen that never sends it there is exactly the state this dispatch found.
 */
describe('236 §2 · the screen carries the id it was handed', () => {
  const source = readFileSync(SCREEN, 'utf8')
  const open = source.slice(
    source.indexOf('function openRequest('),
    source.indexOf('function onKey('),
  )

  it('⚑ the slice found the function — otherwise every rule below passes over nothing', () => {
    expect(open.length, 'openRequest moved or was renamed — re-point this').toBeGreaterThan(80)
    expect(open).toContain('select(request.sessionId)')
  })

  it('🔴 it passes `request.itemId` to the pane, rather than dropping it', () => {
    expect(open).toContain('pane.value?.focus(request.itemId)')
    // ⛔ **…on the next tick, and not synchronously.** Opening from the overview is usually what
    // MOUNTS the pane, so an id carried to a `pane.value` that is still null is the same defect
    // with the fix written above it.
    expect(open).toContain('void nextTick(')
  })

  it('⛔ …and a miss is SAID, because landing silently is the finding', () => {
    expect(open).toContain('say(OPEN_REQUEST_MISSED)')
    expect(OPEN_REQUEST_MISSED).toContain('further back')
  })

  it('⛔ …and the pane is reachable at all — the ref the call needs', () => {
    // Two lines, a hundred lines apart, and either one alone leaves the other dead: the `ref` on
    // the mount and the declaration it fills.
    expect(source).toContain('const pane = ref<InstanceType<typeof ConversationPane> | null>(null)')
    expect(source).toMatch(/<ConversationPane\b[\s\S]{0,200}?ref="pane"/)
  })
})
