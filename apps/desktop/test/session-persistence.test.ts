import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  FakeRuntime,
  parseSessionRef,
  type AgentRuntime,
  type RuntimeEvent,
} from '@brobot2/runtime'
import { openDatabase, type AppDatabase } from '../src/main/db/connection'
import { applyMigrations } from '../src/main/db/migrate'
import {
  NULL_SESSION_STORE,
  createSessionStore,
  type SessionStore,
} from '../src/main/db/session-store'
import { NO_DISCOVERY } from '../src/main/adopt/discover-sessions'
import { RuntimeHost, type RuntimeEventSink } from '../src/main/runtime/runtime-host'
import { sinkOwnerId } from '../src/main/runtime/window-caller'
import type { RuntimeEventMessage } from '../src/shared/runtime-ipc'

/**
 * Sessions have to outlive the process that ran them. Until now the tables existed
 * and nothing wrote to them — the start screen has said `0 persisted sessions` since
 * Step 0. These drive the real host against a real (temp-file) database, because the
 * thing being tested is whether the rows are actually there afterwards.
 */

const migrationsFolder = join(dirname(fileURLToPath(import.meta.url)), '../src/main/db/migrations')

/** Records what the renderer was told, and when — so ordering against the DB is checkable. */
class RecordingSink implements RuntimeEventSink {
  // 349 · this double stands in for a WINDOW — the tests below answer for a person through it.
  readonly aPersonIsBehindIt = true
  readonly messages: RuntimeEventMessage[] = []
  readonly alive = true
  constructor(
    // ⛔ **A WINDOW's owner id, since 413.** `413` made a turn the person's only when a WINDOW
    // sent it — a positive test on the id `sinkOwnerId` mints — so a double standing in for a
    // window has to look like one. ⚠️ Three assertions in this file read the exact `user_turn`
    // payload of a turn a person sent, and they are what caught it.
    readonly ownerId = sinkOwnerId({ id: 1 }),
    private readonly log: string[] = [],
  ) {}

  send(message: RuntimeEventMessage): void {
    this.messages.push(message)
    this.log.push(`publish:${message.ordinal}`)
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

describe('session persistence', () => {
  let dir: string
  let db: AppDatabase
  let store: SessionStore
  let host: RuntimeHost
  let sink: RecordingSink
  let calls: string[]

  function buildHost(overrides: Partial<ConstructorParameters<typeof RuntimeHost>[0]> = {}) {
    let counter = 0
    return new RuntimeHost({
      store,
      discoverSessions: NO_DISCOVERY,
      nativeTranscriptPath: () => null,
      exportDirectory: () => join(dir, 'exports'),
      createRuntime: (provider) => new FakeRuntime(provider),
      prepareProviderHome: (provider) => join(dir, 'homes', provider),
      providerHomePath: (provider) => join(dir, 'homes', provider),
      resolveCwd: (sessionId, requested) => requested ?? join(dir, 'scratch', sessionId),
      newSessionId: () => `sess_${++counter}`,
      readProviderConfig: (_provider, home) => ({
        home,
        homeEnv: 'CODEX_HOME',
        model: 'file-based',
        authNote: null,
        files: [],
      }),
      ...overrides,
    })
  }

  const sessionRows = () =>
    db.prepare('SELECT * FROM provider_session ORDER BY created_at').all() as Record<
      string,
      unknown
    >[]
  const eventRows = (sessionId: string) =>
    db
      .prepare('SELECT * FROM events WHERE session_id = ? ORDER BY ordinal')
      .all(sessionId) as Record<string, unknown>[]

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'brobot2-persist-'))
    db = openDatabase(join(dir, 'brobot2.sqlite'))
    applyMigrations(db, migrationsFolder)
    calls = []
    store = createSessionStore(db)
    host = buildHost()
    sink = new RecordingSink(sinkOwnerId({ id: 1 }), calls)
  })

  afterEach(async () => {
    await host.closeAll()
    db.close()
    rmSync(dir, { recursive: true, force: true })
  })

  it('records the session the moment it is created', async () => {
    const created = await host.createSession({ provider: 'claude', cwd: dir }, sink)

    const rows = sessionRows()
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      id: created.sessionId,
      provider: 'claude',
      cwd: dir,
      approval_mode: 'ask',
    })
    // The count the start screen reads is no longer permanently zero.
    expect(db.prepare('SELECT count(*) AS c FROM provider_session').get()).toEqual({ c: 1 })
  })

  it('persists the approval mode, because it is the one thing resume cannot re-derive', async () => {
    await host.createSession({ provider: 'claude', approvalMode: 'auto' }, sink)
    await host.createSession({ provider: 'codex', approvalMode: 'ask' }, sink)

    expect(sessionRows().map((row) => row.approval_mode)).toEqual(['auto', 'ask'])
  })

  it('writes the provider ref once the session announces it, and it round-trips', async () => {
    const created = await host.createSession({ provider: 'codex' }, sink)
    await waitFor(() => sessionRows()[0]?.external_ref !== null, 'the ref to be recorded')

    const stored = sessionRows()[0]?.external_ref as string
    // Round-trippable, not just a string that happened to be saved.
    expect(parseSessionRef(stored)).toMatchObject({ provider: 'codex', cwd: created.cwd })
    expect(parseSessionRef(stored).sessionId).toBe(created.ref?.sessionId)
  })

  it('follows the session status as it changes', async () => {
    const created = await host.createSession({ provider: 'claude' }, sink)
    await host.send(created.sessionId, 'hello', sink)
    await waitFor(
      () => sessionRows()[0]?.status === 'waiting_permission',
      'the status to follow the session',
    )

    await host.respondPermission(created.sessionId, 'turn_1_perm', { outcome: 'allow' }, sink)
    await waitFor(() => sessionRows()[0]?.status === 'idle', 'the turn to settle')

    await host.close(created.sessionId, sink)
    expect(sessionRows()[0]?.status).toBe('ended')
  })

  it('replays a question recorded BEFORE the option shape changed (143)', async () => {
    // ⛔ **The hole a shape change opens, and nothing in the type system was going to find it.**
    // 143 turned `options: string[]` into `UserInputOption[]`. Replay does not parse — it CASTS
    // (`toPersistedEvents`: `JSON.parse(row.payload) as TranscriptEvent`) — and `historyWindow` hands
    // `entry.event` to the renderer untouched, while `toWireEvent`, which DOES re-parse and would
    // have coerced it, sits on the live emit path only. So a row written before this dispatch would
    // have reached `UserInputCard.vue` as strings behind a type promising objects, and every chip
    // would have rendered `option.label` as `undefined`: blank buttons, no error, no failing test.
    //
    // ⚠️ **Five such rows exist in the live database this was measured against** — 145 re-counted
    // them exactly: three with one question and four options, two with two questions and seven, all
    // 26 options bare strings. One of the two-question rows is the call 139 was raised for. The row
    // below is that shape verbatim.
    const created = await host.createSession({ provider: 'claude' }, sink)
    const legacy = {
      type: 'user_input_request',
      id: 'toolu_legacy',
      prompt: 'AskUserQuestion',
      questions: [
        {
          id: 'q0',
          prompt: 'Which capability groups should the showcase cover?',
          options: ['Core rendering + tools (Recommended)', 'Interactive UI elements'],
        },
      ],
    }
    // Written straight to the ledger, because that is what a pre-143 row IS: no adapter alive today
    // can produce one, so going through one would test the migration against the new shape.
    db.prepare(
      'INSERT INTO events (id, session_id, generation, ordinal, type, payload, created_at)' +
        ' VALUES (?, ?, ?, ?, ?, ?, ?)',
    ).run(
      'ev_legacy',
      created.sessionId,
      0,
      9_000,
      'user_input_request',
      JSON.stringify(legacy),
      Date.now(),
    )

    const replayed = store
      .events(created.sessionId)
      .find((entry) => entry.event.type === 'user_input_request')
    expect(replayed, 'the legacy row came back out of the ledger').toBeDefined()
    const questions = (replayed!.event as { questions: { options: unknown[] }[] }).questions
    expect(questions[0]!.options).toEqual([
      { label: 'Core rendering + tools (Recommended)' },
      { label: 'Interactive UI elements' },
    ])

    // ⛔ **And NOTHING is invented on the way through** (086). A row that never carried a
    // description, a header or an escape flag must not gain one — an empty description would make
    // "the model gave no reason" and "the model gave the empty reason" the same thing on screen.
    expect(questions[0]).toEqual({
      id: 'q0',
      prompt: 'Which capability groups should the showcase cover?',
      options: [
        { label: 'Core rendering + tools (Recommended)' },
        { label: 'Interactive UI elements' },
      ],
    })
  })

  it('drops a stored question it cannot PARSE, rather than half-rendering it (146 §4.1)', async () => {
    // ⛔ **145 MEDIUM 1: 143 closed the cast with a hand-written coercion, and the coercion trusted
    // everything it had not been told about.** It looked for bare strings and cast the rest, so the
    // schema and the replay path were two validators kept in step by hand — the class of hole 143
    // §0 named, re-opened one function down. Each malformed shape produced a DIFFERENT accident:
    //
    //  - `["A", 42]` → a chip whose label is a number, rendered as `undefined`.
    //  - `[{label: 42}]` → survives to `label.trim()` and THROWS, in the renderer.
    //  - a `questions` field that is not an array → throws inside the migration itself.
    //
    // ⚑ **The route taken: replay PARSES, with the same schema every other path uses.** There is
    // one definition of an option now, so there is nothing left to keep in step. A row that does
    // not parse reaches `toPersistedEvents`'s own long-standing policy — *"a row we cannot parse is
    // skipped rather than replayed as something else: a transcript with a hole is honest, a
    // transcript with a fabricated entry is not"* — and all three land there together.
    const created = await host.createSession({ provider: 'claude' }, sink)
    const insert = db.prepare(
      'INSERT INTO events (id, session_id, generation, ordinal, type, payload, created_at)' +
        ' VALUES (?, ?, ?, ?, ?, ?, ?)',
    )
    const malformed = [
      ['ev_num', { id: 'q0', prompt: 'a', options: ['A', 42] }],
      ['ev_lbl', { id: 'q0', prompt: 'a', options: [{ label: 42 }] }],
      ['ev_box', { id: 'q0', prompt: 'a', options: 'not a list' }],
    ] as const
    malformed.forEach(([id, question], i) => {
      insert.run(
        id,
        created.sessionId,
        0,
        9_100 + i,
        'user_input_request',
        JSON.stringify({
          type: 'user_input_request',
          id: `toolu_${id}`,
          prompt: 'AskUserQuestion',
          questions: [question],
        }),
        Date.now(),
      )
    })
    // …and one GOOD row after them, which is what makes the assertion below non-vacuous: replay has
    // to keep going, not stop at the first row it cannot read.
    insert.run(
      'ev_good',
      created.sessionId,
      0,
      9_200,
      'user_input_request',
      JSON.stringify({
        type: 'user_input_request',
        id: 'toolu_good',
        prompt: 'AskUserQuestion',
        questions: [{ id: 'q0', prompt: 'a', options: ['A'] }],
      }),
      Date.now(),
    )

    const cards = store
      .events(created.sessionId)
      .filter((entry) => entry.event.type === 'user_input_request')

    expect(cards.map((entry) => (entry.event as { id: string }).id)).toEqual(['toolu_good'])
    expect(
      (cards[0]!.event as { questions: { options: unknown[] }[] }).questions[0]!.options,
    ).toEqual([{ label: 'A' }])
  })

  it('a skipped row says so where WE can see it, even though the reader is not told (150)', async () => {
    // ⛔ **150's ruling on 148 M4, pinned so it is a decision rather than an omission.** A skip is
    // invisible to the reader at the EDGES of a window: an interior one leaves an ordinal gap that
    // the gap check already reports, but a leading, trailing or only row vanishes exactly like a row
    // that never existed. The user-facing mark is BACKLOGGED — it needs a wire field, a surface and
    // wording honest about a cause we cannot state, for a condition with no observed instance in
    // this app's history — and that is only a safe call because the skip is no longer silent to us.
    //
    // ⚑ Without this test the warn is a line nobody would notice losing, and the backlogged item
    // would go back to being undiagnosable the first time it fires.
    const warnings: string[] = []
    const warn = console.warn
    console.warn = (...args: unknown[]) => void warnings.push(args.map(String).join(' '))
    try {
      const created = await host.createSession({ provider: 'claude' }, sink)
      db.prepare(
        'INSERT INTO events (id, session_id, generation, ordinal, type, payload, created_at)' +
          ' VALUES (?, ?, ?, ?, ?, ?, ?)',
      ).run('ev_bad', created.sessionId, 0, 9_300, 'assistant_message', '{not json', Date.now())

      const events = store.events(created.sessionId)
      expect(
        events.some((entry) => entry.ordinal === 9_300),
        'the row really was skipped',
      ).toBe(false)
      expect(warnings.join('\n')).toContain('9300')
      expect(warnings.join('\n')).toContain('skipped')
    } finally {
      console.warn = warn
    }
  })

  it('keeps a gap-free ledger in emit order', async () => {
    const created = await host.createSession({ provider: 'claude' }, sink)
    await host.send(created.sessionId, 'hello', sink)
    await waitFor(
      () => sink.messages.some((m) => m.event.type === 'permission_request'),
      'the permission card',
    )
    await host.respondPermission(created.sessionId, 'turn_1_perm', { outcome: 'allow' }, sink)
    await waitFor(() => sink.messages.some((m) => m.event.type === 'turn'), 'the terminal turn')
    await host.close(created.sessionId, sink)

    const rows = eventRows(created.sessionId)
    expect(rows.length).toBeGreaterThan(5)
    // Monotonic from zero with no holes…
    expect(rows.map((row) => row.ordinal)).toEqual(rows.map((_row, index) => index))
    // …and the same events, in the same order, that the renderer was shown.
    expect(rows.map((row) => row.type)).toEqual(sink.messages.map((m) => m.event.type))
  })

  it('records what we sent, not only what came back', async () => {
    // The §7 smoke found this: a session reopened with the agent's replies and none of
    // the questions, because no provider reports our own turns — Codex echoes them as
    // unrecognized chatter and Claude not at all. Half a conversation is not a transcript.
    const created = await host.createSession({ provider: 'claude' }, sink)
    await host.send(created.sessionId, 'write the file', sink)

    const ours = eventRows(created.sessionId).filter((row) => row.type === 'user_turn')
    expect(ours).toHaveLength(1)
    // ⚑ **F093 · R2** — the row also keeps the whole text the provider was handed.
    const { sent, ...row } = JSON.parse(String(ours[0]?.payload)) as { sent?: string }
    expect(row).toEqual({ type: 'user_turn', text: 'write the file' })
    expect(sent).toContain('write the file')
  })

  it('does not record a turn the runtime refused', async () => {
    // An append-only ledger cannot take a row back, so the turn is recorded only after
    // the send is accepted. A refused one leaves no trace and no hole in the ordinals.
    const refusing = buildHost({
      createRuntime: (provider) => {
        const runtime = new FakeRuntime(provider)
        const refuser: AgentRuntime = {
          provider,
          resume: (ref, options) => runtime.resume(ref, options),
          listModels: (context) => runtime.listModels(context),
          start: async (options) => {
            const handle = await runtime.start(options)
            // Everything else stays real; only the send fails, the way a dead provider does.
            return Object.assign(Object.create(handle) as typeof handle, {
              send: () => Promise.reject(new Error('provider is gone')),
            })
          },
        }
        return refuser
      },
    })
    const created = await refusing.createSession({ provider: 'claude' }, sink)
    await expect(refusing.send(created.sessionId, 'never mind', sink)).rejects.toThrow(
      'provider is gone',
    )

    const rows = eventRows(created.sessionId)
    expect(rows.some((row) => row.type === 'user_turn')).toBe(false)
    expect(rows.map((row) => row.ordinal)).toEqual(rows.map((_row, index) => index))
    await refusing.closeAll()
  })

  it('stores each event as its validated payload, replayable as a RuntimeEvent', async () => {
    const created = await host.createSession({ provider: 'claude' }, sink)
    // ⚑ **D-017 · R4** — the host's own `launched` row takes ordinal 0 now, so the provider's
    // opening `session` event is the SECOND row; this test is about the provider's event.
    await waitFor(() => eventRows(created.sessionId).length >= 3, 'the opening events')

    const rows = eventRows(created.sessionId)
    expect(rows[0]?.type).toBe('launched')
    const first = rows[1]
    const payload = JSON.parse(String(first?.payload)) as RuntimeEvent
    expect(payload.type).toBe('session')
    expect(first?.type).toBe(payload.type)
  })

  it('writes before it publishes — a crash in between still leaves the event durable', async () => {
    // The interleaving is the assertion: every event is in the ledger before the
    // renderer hears about it, so anything the UI showed is already recoverable.
    const ordering: string[] = []
    const watched = buildHost({
      store: {
        ...store,
        create: (record) => {
          ordering.push('create')
          store.create(record)
        },
        append: (sessionId, ordinal, event, at) => {
          ordering.push(`persist:${ordinal}`)
          store.append(sessionId, ordinal, event, at)
        },
      },
    })
    const watchingSink = new RecordingSink(sinkOwnerId({ id: 1 }), ordering)

    const created = await watched.createSession({ provider: 'claude' }, watchingSink)
    await waitFor(() => watchingSink.messages.length >= 2, 'the opening events')
    await watched.closeAll()

    expect(ordering[0]).toBe('create')
    const pairs = ordering.slice(1)
    for (let i = 0; i + 1 < pairs.length; i += 2) {
      expect(pairs[i]).toBe(`persist:${i / 2}`)
      expect(pairs[i + 1]).toBe(`publish:${i / 2}`)
    }
    expect(eventRows(created.sessionId).length).toBeGreaterThan(0)
  })

  it('keeps recording when nobody is listening — a closed window must not hole the ledger', async () => {
    // The renderer is what stops; the session is what continues. If the ledger only
    // grew while a window was open, resume would replay a transcript with gaps.
    const deaf: RuntimeEventSink = {
      ownerId: 'owner:gone',
      aPersonIsBehindIt: true,
      alive: false,
      send: () => {},
      sendLiveness: () => {},
    }
    const created = await host.createSession({ provider: 'claude' }, deaf)
    // ⚠️ `deaf`, not the suite's live sink (203): the window is GONE, not replaced — its owner id is
    // still the owner of this session, and a send from anyone else is exactly what 195 H1 refuses.
    await host.send(created.sessionId, 'hello', deaf)
    await waitFor(() => eventRows(created.sessionId).length >= 5, 'events to be recorded anyway')

    const rows = eventRows(created.sessionId)
    expect(rows.map((row) => row.ordinal)).toEqual(rows.map((_row, index) => index))
  })

  it('offers exactly the sessions a resume could use', async () => {
    const claude = await host.createSession({ provider: 'claude', approvalMode: 'auto' }, sink)
    await waitFor(() => sessionRows()[0]?.external_ref !== null, 'the ref')
    await host.close(claude.sessionId, sink)

    const resumable = host.resumableSessions()
    expect(resumable).toHaveLength(1)
    expect(resumable[0]).toMatchObject({
      sessionId: claude.sessionId,
      provider: 'claude',
      approvalMode: 'auto',
      status: 'ended',
    })
    // The ref is parsed, not raw text — 084 gets something it can resume from directly.
    expect(resumable[0]?.ref.sessionId).toBe(claude.ref?.sessionId)
  })

  it('a mid-conversation mode change is RECORDED, so a resume carries on with it (034)', async () => {
    // The column already governed resume — it was simply written once, at creation, because that
    // was the only moment the mode could be chosen. Without this write, a session resumed after the
    // user turned yolo on would quietly start prompting again; one resumed after they turned it
    // OFF would quietly not, which is the direction that matters.
    const created = await host.createSession({ provider: 'codex', approvalMode: 'ask' }, sink)
    await waitFor(() => sessionRows()[0]?.external_ref !== null, 'the ref')

    await host.setApprovalMode(created.sessionId, 'auto', sink)
    expect(store.find(created.sessionId)?.approvalMode).toBe('auto')

    // And back — the record follows the user, not the creation-time choice.
    await host.setApprovalMode(created.sessionId, 'ask', sink)
    expect(store.find(created.sessionId)?.approvalMode).toBe('ask')
    await host.close(created.sessionId, sink)
  })

  it('will not offer a session that has no ref to resume from', () => {
    store.create({
      id: 'sess_refless',
      provider: 'claude',
      cwd: dir,
      approvalMode: 'ask',
      profileId: 'default',
    })
    expect(host.resumableSessions()).toEqual([])
    // …but it is not simply dropped: a session that vanishes from the list is the very
    // silence this feature exists to end, so it comes back with the reason instead.
    expect(host.unresumableSessions()).toEqual([
      {
        sessionId: 'sess_refless',
        provider: 'claude',
        cwd: dir,
        status: 'idle',
        // 🔴 **421 · `idle` and NOT running, in one row, which is why the column cannot answer
        // this question.** `store.create` wrote a row this host has no slot for — the same shape a
        // crash leaves behind, and the shape `settleOrphanRuns` settles a stranded run INTO. A rail
        // that derived *"the app is running it"* from a non-terminal status would offer a take-over
        // on this row, and the host would refuse it `not-running`.
        running: 'not-running',
        // ⚑ **D-017b · what it is doing, in the one derivation** (`agent-state.ts`) — idle, never a
        // word about a process or about a quit (`05` rule 5): the `closing` and *did not finish
        // quitting* facts went with the rows that drew them.
        state: { is: 'idle' },
        providerBlockStatus: 'current',
        providerBlock: null,
        providerBlockLastKnown: null,
        // ⚑ **D-016 · R2 — named by its ROOT, and untitled**: no conversation started this one, so
        // `store.create` wrote the root a person gave it in the same transaction — the first root,
        // and its title is `null` until its owner names it.
        named: { label: 'W1', title: null, definitionOfDone: null },
        profileId: 'default',
        // We ran this one ourselves, so it is not adopted from anywhere.
        adoptedAt: null,
        updatedAt: expect.any(Number),
        // ⚑ **A row the rail can now tell apart from a readable one** (151). It is on this shape
        // because a conversation that cannot be reopened is offered READ instead (118), and one we
        // hold nothing of can be offered neither — which is a row that must not look pressable.
        hasTranscript: false,
        // ⚑ **222 — null, and it is the honest value.** This session never took a turn, so there is
        // no closed turn to have an ending. A row like this is the one place `null` is not "we did
        // not look": there is nothing there to have ended, and the surface renders nothing.
        lastEnding: null,
        // ⛔ **The rail's discriminator, and this row is on the side that STAYS** (154). A
        // conversation this app ran is one you can pick up again — or, here, one you cannot, for a
        // reason that has nothing to do with whose folder it came out of. `toEqual` rather than
        // `toMatchObject` is what makes the field's absence a failure rather than a silence.
        foundInUserHome: false,
        // ⛔ **The second provenance, and this row is on the side that stays too** (214 §1). A
        // restored bundle is unresumable for a different reason and with a different sentence —
        // `toEqual` is what makes the difference between the two an assertion rather than a hope.
        restoredFromBundle: false,
        // ⛔ **151 · the mechanism dropped, the claim kept.** *"the provider never gave it an id"*
        // named a handshake the reader has no reason to know; the clause in front of it was already
        // the fact. Nothing new is asserted — a row with no ref is one no turn was recorded for.
        // ⚑ **D-017b** — *carry on from*, not *reopen*: a message is what continues a conversation.
        reason: 'no turn was ever taken in this one, so there is nothing to carry on from',
      },
    ])
  })

  /**
   * **The ref is on disk before anyone is told it exists** (163 §2, the PM's ruling).
   *
   * *"If the UI can render it, the app has it."* The window and the row are written from the same
   * `deliver` call — the ledger row first, the message after — so there is no "next convenient
   * write" to move this to; what this pins is that it stays that way. A ref that reached the screen
   * and not the database is a conversation the provider is holding on disk under a name only the
   * screen ever knew, and `toResumable` drops the row for good.
   */
  it('⛔ has the ref ON DISK before the renderer is told it (163)', async () => {
    // A second connection, opened before anything is written and never handed to the app. What it
    // can see is what a NEXT LAUNCH sees: committed rows, no finalizer, no drain — the state a
    // SIGKILL leaves. `smoke:ui` step 44 is the live half of this.
    const onDisk = openDatabase(join(dir, 'brobot2.sqlite'))
    const refOnDisk = (sessionId: string): string | null =>
      (
        onDisk.prepare('SELECT external_ref FROM provider_session WHERE id = ?').get(sessionId) as
          { external_ref: string | null } | undefined
      )?.external_ref ?? null

    let refWhenTold: string | null | undefined
    const watching: RuntimeEventSink = {
      ownerId: sinkOwnerId({ id: 1 }),
      aPersonIsBehindIt: true,
      alive: true,
      send: (message) => {
        // The FIRST announcement only: what the database held at the instant the renderer could
        // first have drawn a thread id.
        if (message.event.type === 'session' && refWhenTold === undefined) {
          refWhenTold = refOnDisk(message.sessionId)
        }
      },
      sendLiveness: () => {},
    }

    try {
      const created = await host.createSession({ provider: 'codex', cwd: dir }, watching)
      await waitFor(() => refWhenTold !== undefined, 'the session event')

      expect(refWhenTold, 'the renderer was told a ref the database did not have').not.toBeNull()
      expect(parseSessionRef(refWhenTold as string).sessionId).toEqual(expect.any(String))
      // …and it is the row's own ref, not some other session's: the reopen list reads this one.
      expect(refOnDisk(created.sessionId)).toBe(refWhenTold)
      await host.close(created.sessionId, sink)
    } finally {
      onDisk.close()
    }
  })

  /**
   * The pair the ruling above needs, and the sentence that was wrong (163 §2).
   *
   * A row with no ref is not always a row nothing happened in — and until this, the app said it was.
   */
  it('⛔ tells a session that never started from one that stopped before it was named (163)', () => {
    const refless = (id: string): void => {
      store.create({
        id,
        provider: 'claude',
        cwd: dir,
        approvalMode: 'ask',
        profileId: 'default',
      })
    }
    // Nothing at all: created, never sent to. The old sentence is TRUE of this one and stays.
    refless('sess_untouched')
    // A turn was taken and the process went before the handshake came back — the shape a SIGKILL
    // mid-first-turn leaves, and the one `smoke:ui` 44 kills the app to produce.
    refless('sess_killed_early')
    store.append('sess_killed_early', 0, { type: 'user_turn', text: 'count to forty' }, 1_000)
    store.append('sess_killed_early', 1, { type: 'status', state: 'working' }, 1_001)

    const reasons = new Map(
      host.unresumableSessions().map((row) => [row.sessionId, row.reason] as const),
    )
    expect(reasons.get('sess_untouched')).toBe(
      'no turn was ever taken in this one, so there is nothing to carry on from',
    )
    // ⛔ **The defect 163 came for.** Said about the row below, "no turn was ever taken in this one"
    // is contradicted by that row's own turn table — 086: never claim something else instead.
    expect(reasons.get('sess_killed_early')).toBe(
      'this one stopped before Claude gave it an id, so there is nothing to carry on from',
    )
    // Non-vacuity: the row really did record a turn, so the sentence above is about a session that
    // took one rather than about a fixture that differs from its neighbour by nothing.
    expect(store.turns('sess_killed_early')).toHaveLength(1)
    expect(store.turns('sess_untouched')).toEqual([])
  })

  it('⛔ says which rows the sweep found in the user’s OWN folder, off the row (154)', () => {
    /**
     * The adopted row in the shape handed over by the store.
     *
     * `sess_865688c3` on his machine: `profile_id` NULL with an `adopted_at` — one of his own
     * Claude conversations, swept out of `~/.claude` by `046`/`047`. The rail reads this field and
     * drops the row; the Sessions page reads the same field for its Origin facet. ⚠️ **Both from
     * one call to `foundInUserHome`**, which is what `032` asks and what `session-library.ts`'s own
     * copy of the predicate was not.
     */
    store.create({
      id: 'sess_adopted',
      provider: 'claude',
      cwd: dir,
      approvalMode: 'ask',
      profileId: 'default',
    })
    // ⚠️ **Both columns written here, and `create` cannot do it.** `profileId` is a `string` on
    // that API — an app-owned row always has one — so the state this test is about is reachable
    // only the way the sweep reaches it: `046` writes the row with a NULL profile and a timestamp.
    db.prepare('UPDATE provider_session SET adopted_at = ?, profile_id = NULL WHERE id = ?').run(
      1_000,
      'sess_adopted',
    )
    store.create({
      id: 'sess_ours',
      provider: 'claude',
      cwd: dir,
      approvalMode: 'ask',
      profileId: 'default',
    })
    /**
     * A conversation adopted from a home provisioned by this app is both adopted and
     * app-owned; `adopt-sessions.test.ts` measured 13 rows of that shape and none from
     * personal homes. It stays on the rail, so `adopted_at !== null` alone cannot be the
     * exclusion predicate.
     */
    store.create({
      id: 'sess_ours_adopted',
      provider: 'claude',
      cwd: dir,
      approvalMode: 'ask',
      profileId: 'reviewer',
    })
    db.prepare('UPDATE provider_session SET adopted_at = ? WHERE id = ?').run(
      2_000,
      'sess_ours_adopted',
    )
    /**
     * ⛔ **The fourth row, and the mutation table is what found it.** `adopted_at` alone is not the
     * rule (above) and neither is a NULL `profile_id` — because migration `0003` adds that column
     * with **no default and no backfill**:
     *
     * ```sql
     * ALTER TABLE `provider_session` ADD `profile_id` text;
     * ```
     *
     * ⚠️ So every conversation this app ran before profiles existed has a NULL profile and no
     * `adopted_at`. Read on the profile alone, all of them become *"found in your own folder"* —
     * and a conversation the user CAN reopen vanishes from the list whose purpose is reopening.
     * That is the same silence `046` exists to end, arriving from the other direction.
     */
    store.create({
      id: 'sess_legacy',
      provider: 'claude',
      cwd: dir,
      approvalMode: 'ask',
      profileId: 'default',
    })
    db.prepare('UPDATE provider_session SET profile_id = NULL WHERE id = ?').run('sess_legacy')

    const answers = new Map(
      host.unresumableSessions().map((session) => [session.sessionId, session.foundInUserHome]),
    )
    // ⚑ **All four, and each one kills a different one-term reading.** "The adopted row says true"
    // is also satisfied by a field hard-wired to true, which empties the rail; `sess_ours_adopted`
    // is what `adopted_at` alone gets wrong; `sess_legacy` is what a NULL `profile_id` alone gets
    // wrong. Only the AND of the two answers all four.
    expect(answers.get('sess_adopted')).toBe(true)
    expect(answers.get('sess_ours')).toBe(false)
    expect(answers.get('sess_ours_adopted')).toBe(false)
    expect(answers.get('sess_legacy')).toBe(false)

    // …and the same answer reaches the library's shape, because it is the same call. A second
    // derivation here is exactly what 154 removed.
    const recorded = new Map(
      store.recorded().map((session) => [session.sessionId, session.foundInUserHome]),
    )
    expect(recorded.get('sess_adopted')).toBe(true)
    expect(recorded.get('sess_ours')).toBe(false)
  })

  it('skips a ref it can no longer parse rather than handing over something unusable', () => {
    store.create({
      id: 'sess_corrupt',
      provider: 'claude',
      cwd: dir,
      approvalMode: 'ask',
      profileId: 'default',
    })
    db.prepare('UPDATE provider_session SET external_ref = ? WHERE id = ?').run(
      'not json',
      'sess_corrupt',
    )
    expect(host.resumableSessions()).toEqual([])
    // Unusable is not the same as never-started, and the list says which — still, in words that
    // name no internal concept (151). *"The recorded provider id"* was the same family of jargon as
    // *"provider home"*, on a sentence a user meets in a 200px column.
    expect(host.unresumableSessions().map((session) => session.reason)).toEqual([
      'we can no longer read where this conversation lives, so a message here cannot carry it on',
    ])
  })

  it('keeps the session alive and says so when recording breaks', async () => {
    // A dead database must not take the live session with it — but the user has to be
    // told, because the session is no longer coming back.
    const broken = buildHost({
      store: {
        ...NULL_SESSION_STORE,
        append: () => {
          throw new Error('database is locked')
        },
      },
    })

    const created = await broken.createSession({ provider: 'claude' }, sink)
    await waitFor(
      () => sink.messages.some((m) => m.event.type === 'error'),
      'the recording failure to surface',
    )

    const notice = sink.messages.find((m) => m.event.type === 'error')?.event
    expect(notice).toMatchObject({ fatal: false })
    expect(notice && 'message' in notice ? notice.message : '').toMatch(/no longer being recorded/)
    // Reported once, not once per event.
    expect(sink.messages.filter((m) => m.event.type === 'error')).toHaveLength(1)
    // …and the session kept running: the stream carried on past the failure.
    expect(sink.messages.length).toBeGreaterThan(2)
    await broken.close(created.sessionId, sink)
  })
})

/**
 * Reopening a recorded session. The danger here is a resume that looks like a resume
 * but is really a fresh session wearing an old name — so these pin the things that
 * would make it one: the mode it comes back with, the ledger it continues, and what
 * happens when the provider cannot find the conversation at all.
 */
describe('resume', () => {
  let dir: string
  let db: AppDatabase
  let store: SessionStore
  let sink: RecordingSink
  /**
   * One runtime per provider, SHARED across hosts. A relaunched app gets a new host,
   * but the provider's own conversation state is on disk and outlives us — and the
   * Fake models that faithfully by refusing to resume a ref it never issued (034).
   */
  let runtimes: Map<string, FakeRuntime>

  const migrations = join(dirname(fileURLToPath(import.meta.url)), '../src/main/db/migrations')

  function buildHost(overrides: Partial<ConstructorParameters<typeof RuntimeHost>[0]> = {}) {
    let counter = 0
    return new RuntimeHost({
      store,
      discoverSessions: NO_DISCOVERY,
      nativeTranscriptPath: () => null,
      exportDirectory: () => join(dir, 'exports'),
      createRuntime: (provider) => {
        const existing = runtimes.get(provider)
        if (existing) return existing
        const fresh = new FakeRuntime(provider)
        runtimes.set(provider, fresh)
        return fresh
      },
      prepareProviderHome: (provider) => join(dir, 'homes', provider),
      providerHomePath: (provider) => join(dir, 'homes', provider),
      resolveCwd: (sessionId, requested) => requested ?? join(dir, 'scratch', sessionId),
      newSessionId: () => `sess_${++counter}`,
      readProviderConfig: (_provider, home) => ({
        home,
        homeEnv: 'CODEX_HOME',
        model: 'file-based',
        authNote: null,
        files: [],
      }),
      ...overrides,
    })
  }

  beforeEach(() => {
    runtimes = new Map()
    dir = mkdtempSync(join(tmpdir(), 'brobot2-resume-'))
    db = openDatabase(join(dir, 'brobot2.sqlite'))
    applyMigrations(db, migrations)
    store = createSessionStore(db)
    sink = new RecordingSink()
  })

  afterEach(() => {
    db.close()
    rmSync(dir, { recursive: true, force: true })
  })

  /** Run a session to the point where it is recorded and resumable, then close it. */
  let recorded = 0
  async function recordASession(
    approvalMode: 'ask' | 'auto' = 'ask',
    reasoningEffort?: 'low' | 'medium' | 'high',
    model?: string,
    planMode?: boolean,
  ) {
    const nth = ++recorded
    const host = buildHost({ newSessionId: () => `sess_${nth}` })
    const created = await host.createSession(
      {
        provider: 'codex',
        approvalMode,
        ...(reasoningEffort ? { reasoningEffort } : {}),
        ...(model ? { model } : {}),
        ...(planMode !== undefined ? { planMode } : {}),
      },
      sink,
    )
    // ⚠️ **Counted FROM HERE, not `some(…)` over the whole sink** (186). `sink` is shared across
    // every session a test records, so a wait for "a card exists" was satisfied by the PREVIOUS
    // session's card the moment a test recorded two — the second recording then answered a request
    // that had not been raised yet and passed on the first one's timing.
    const from = sink.messages.length
    const seen = (type: string): boolean =>
      sink.messages.slice(from).some((m) => m.event.type === type)

    await host.send(created.sessionId, 'hello', sink)
    if (approvalMode === 'auto') {
      // ⛔ **An unattended session is asked nothing, so there is no card to answer** (186). This used
      // to wait for one anyway and got it, because the Fake raised a card in every mode — which is
      // the contradiction 182 H4 names, and it meant the yolo half of every setting-survives-a-quit
      // test was recorded through a prompt yolo would never have produced.
      await waitFor(() => seen('turn'), 'the unattended turn to finish')
    } else {
      await waitFor(() => seen('permission_request'), 'the first turn')
      // `turn_1_perm`: each recording is a fresh host and a fresh session, so its turn counter is 1.
      await host.respondPermission(created.sessionId, 'turn_1_perm', { outcome: 'allow' }, sink)
      await waitFor(() => seen('turn'), 'the turn to finish')
    }
    await host.close(created.sessionId, sink)
    return { created, before: [...sink.messages] }
  }

  it('hands back the transcript the session had before', async () => {
    const { created, before } = await recordASession()

    // A brand-new host, as if the app had been quit and relaunched.
    const relaunched = buildHost()
    const resumed = await relaunched.resumeSession(created.sessionId, new RecordingSink())

    expect(resumed.sessionId).toBe(created.sessionId)
    expect(resumed.history.entries.map((h) => h.event.type)).toEqual(
      before.map((m) => m.event.type),
    )
    expect(resumed.history.entries.map((h) => h.ordinal)).toEqual(before.map((m) => m.ordinal))
    // Including our side of it — the half no provider reports back: what we said…
    // ⚑ **F093 · R2** — `sent`, the whole text the provider was handed, set aside: it is kept too.
    expect(
      resumed.history.entries
        .map((h) => h.event)
        .filter((e) => e.type === 'user_turn')
        .map(({ sent, ...row }) => (void sent, row)),
    ).toEqual([{ type: 'user_turn', text: 'hello' }])
    // …and which button we pressed, so an allowed card does not come back looking unanswered.
    expect(
      resumed.history.entries.map((h) => h.event).filter((e) => e.type === 'user_decision'),
      // ⚑ **477 · the answer was taken through the window that owns this conversation**, so the
      // replayed row names one — and a resume hands back what was written rather than a shape this
      // build would produce today.
    ).toEqual([
      {
        type: 'user_decision',
        requestId: 'turn_1_perm',
        outcome: 'allow',
        by: { who: 'a-person' },
      },
    ])
    await relaunched.closeAll()
  })

  it('continues the ledger instead of restarting it — no collision, no rewind at the seam', async () => {
    const { created, before } = await recordASession()
    const seam = before.length

    const relaunched = buildHost()
    const liveSink = new RecordingSink()
    await relaunched.resumeSession(created.sessionId, liveSink)
    await waitFor(() => liveSink.messages.length > 0, 'the resumed session to emit')

    // Live ordinals pick up exactly where the recording left off…
    expect(liveSink.messages[0]?.ordinal).toBe(seam)
    // …and the ledger is still one dense sequence across the quit.
    const rows = db
      .prepare('SELECT ordinal FROM events WHERE session_id = ? ORDER BY ordinal')
      .all(created.sessionId) as { ordinal: number }[]
    expect(rows.map((row) => row.ordinal)).toEqual(rows.map((_row, index) => index))
    await relaunched.closeAll()
  })

  it('comes back with the mode it was recorded with, not the default', async () => {
    // The reverse of this is the dangerous one: a session that ran without prompts
    // must not silently start prompting, and an asking session must never stop.
    const yolo = await recordASession('auto')
    const asked = await recordASession('ask')

    const modes: ('ask' | 'auto' | undefined)[] = []
    const relaunched = buildHost({
      createRuntime: (provider) => {
        const runtime = runtimes.get(provider)!
        const spy: AgentRuntime = {
          provider,
          start: (options) => runtime.start(options),
          listModels: (context) => runtime.listModels(context),
          resume: (ref, options) => {
            modes.push(options.approvalMode)
            return runtime.resume(ref, options)
          },
        }
        return spy
      },
    })

    await relaunched.resumeSession(yolo.created.sessionId, new RecordingSink())
    await relaunched.resumeSession(asked.created.sessionId, new RecordingSink())
    expect(modes).toEqual(['auto', 'ask'])
    await relaunched.closeAll()
  })

  it('comes back with the EFFORT it was recorded with, not the default of the day (024)', async () => {
    // Same rule as the mode and the cwd above: a conversation carries on the way it was started.
    // Re-deriving it would silently change how the agent behaves on reopen — and the effort a
    // session ran with is exactly the kind of thing nobody would think to check.
    const hard = await recordASession('ask', 'high')
    const easy = await recordASession('ask', 'low')
    const unset = await recordASession('ask')
    // ⚑ **D-042 · R1 — "unset" is no longer a state a conversation can start in**: a launch that
    // names no effort is named one by the host — here Codex's default row at its own `medium` — and
    // that pair is RECORDED on the row, as a named one is. Read off the ledger, so the replay below
    // is of what the row holds rather than of a value this test assumed.
    const onItsRow = (sessionId: string): unknown =>
      db.prepare('SELECT model, reasoning_effort FROM provider_session WHERE id = ?').get(sessionId)
    expect(onItsRow(unset.created.sessionId)).toEqual({
      model: 'fake-codex-a',
      reasoning_effort: 'medium',
    })
    // ⛔ **…and "the default of the day" moves before the relaunch**: a person picks `low` on
    // Codex, which every later start that names nothing would now run at (R2's last pick). A resume
    // that re-derived its effort would come back at it.
    store.aPersonPicked('codex', { model: 'fake-codex-a', effort: 'low' }, Date.now())

    const efforts: (string | undefined)[] = []
    const relaunched = buildHost({
      createRuntime: (provider) => {
        const runtime = runtimes.get(provider)!
        const spy: AgentRuntime = {
          provider,
          start: (options) => runtime.start(options),
          listModels: (context) => runtime.listModels(context),
          resume: (ref, options) => {
            efforts.push(options.reasoningEffort)
            return runtime.resume(ref, options)
          },
        }
        return spy
      },
    })

    await relaunched.resumeSession(hard.created.sessionId, new RecordingSink())
    await relaunched.resumeSession(easy.created.sessionId, new RecordingSink())
    await relaunched.resumeSession(unset.created.sessionId, new RecordingSink())
    // The third used to be the honest gap: nothing was chosen, so nothing was replayed — NOT
    // 'medium', which would have been this app inventing a setting the conversation never had.
    // ⚑ **D-042 moved it**: the conversation HAD `medium` — R1 named it at its start and recorded
    // it — so `medium` is what it comes back with, and ⛔ NOT today's `low`, which is the 024 rule
    // itself: a conversation carries on the way it was started.
    expect(efforts).toEqual(['high', 'low', 'medium'])
    await relaunched.closeAll()
  })

  it('…and with the MODEL it was recorded with, for the same reason (038)', async () => {
    // Until 038 the app never asked for a model, so "the provider re-reports it on resume" was a
    // complete answer. Once a session can CHOOSE one it stops being complete: the provider reports
    // what it is running, which after a forgetful resume is its own default — a conversation
    // started deliberately on a small model would come back on a large one, answering differently
    // and costing differently, and the only trace would be the reported value quietly changing.
    const haiku = await recordASession('ask', undefined, 'claude-haiku-4-5-20251001')
    const unset = await recordASession('ask')
    // ⚑ **D-042 · a row with NOTHING recorded** — every helper's before D-042, which no start can
    // make any more (R1 names and records a pair at every start). Made by hand here, so the half of
    // R1 that names such a row at its next start has a row to name.
    const blank = await recordASession('ask')
    store.setModel(blank.created.sessionId, null)
    store.setReasoningEffort(blank.created.sessionId, null)
    // ⛔ "The default of the day" moves before the relaunch: a person picks `fake-codex-b` on Codex
    // (a row that offers no effort levels, so its pair's effort is none).
    store.aPersonPicked('codex', { model: 'fake-codex-b', effort: null }, Date.now())

    const models: (string | undefined)[] = []
    const relaunched = buildHost({
      createRuntime: (provider) => {
        const runtime = runtimes.get(provider)!
        const spy: AgentRuntime = {
          provider,
          start: (options) => runtime.start(options),
          listModels: (context) => runtime.listModels(context),
          resume: (ref, options) => {
            models.push(options.model)
            return runtime.resume(ref, options)
          },
        }
        return spy
      },
    })

    await relaunched.resumeSession(haiku.created.sessionId, new RecordingSink())
    await relaunched.resumeSession(unset.created.sessionId, new RecordingSink())
    await relaunched.resumeSession(blank.created.sessionId, new RecordingSink())
    // The second used to be the same honest gap as the effort above: asking for nothing was not a
    // value to replay, and replaying "whatever is default today" would have been this app inventing
    // a decision. ⚑ **D-042 moved it**: R1 named `fake-codex-a` at its start and recorded it, so
    // that is replayed — ⛔ never today's `fake-codex-b`.
    //
    // ⚑ **The third is what is left of the gap**: a row that recorded nothing has no decision to
    // replay, so R1 names one at this start — today's, the last pick — and the provider is told it.
    expect(models).toEqual(['claude-haiku-4-5-20251001', 'fake-codex-a', 'fake-codex-b'])
    // …and RECORDS it (R1: *"recorded, and the provider is told it"*), so its next start replays it
    // whatever the default of that day is.
    expect(
      db
        .prepare('SELECT model, reasoning_effort FROM provider_session WHERE id = ?')
        .get(blank.created.sessionId),
    ).toEqual({ model: 'fake-codex-b', reasoning_effort: null })
    await relaunched.closeAll()
  })

  it('a turn open when the app quit does not come back running (045)', async () => {
    // The durable half of `markReopened`'s renderer rule. Nothing else would ever close that turn —
    // its ending is simply not in the ledger — so resume closes it with the only truthful reason,
    // and the session stops claiming to be working.
    const { created } = await recordASession()
    // Re-open a turn and leave it open, exactly as a mid-turn quit does.
    const ordinal = store.events(created.sessionId).length
    store.append(
      created.sessionId,
      ordinal,
      { type: 'user_turn', text: 'interrupted by a quit' },
      1,
    )
    expect(store.turns(created.sessionId).at(-1)?.endReason, 'open before resume').toBeNull()

    const relaunched = buildHost()
    await relaunched.resumeSession(created.sessionId, new RecordingSink())

    const last = store.turns(created.sessionId).at(-1)
    // `unknown`, never `completed`: we did not observe how it went, and saying otherwise would be
    // the app inventing an outcome for a turn nobody watched end.
    expect(last?.endReason).toBe('unknown')
    expect(last?.closedAt).not.toBeNull()
    // ⛔ **`idle`, and this line said `ended` until 179** — where it was asserting the defect.
    //
    // Terminal permanence is valid for {@link SessionStore.closeOpenTurn}, asserted in
    // `turn-table.test.ts`, but resuming a session makes it live again. A measured sequence
    // of `status: working`, `user_turn`, completed turn, and `status: idle` left the stale
    // column `ended` while the host and rail held it open. `SessionStore.reopened` must
    // update the resumed session’s state.
    expect(store.find(created.sessionId)?.status).not.toBe('working')
    expect(store.find(created.sessionId)?.status).toBe('idle')
    await relaunched.closeAll()
  })

  it('…and PLANNING, if it was planning (030)', async () => {
    // The fourth setting to ride the launch context, and the one whose loss would be least visible:
    // a resumed session that quietly stopped proposing would just start doing things, and the only
    // sign would be the absence of a plan nobody was waiting for.
    const planning = await recordASession('ask', undefined, undefined, true)
    const plain = await recordASession('ask', undefined, undefined, false)
    const never = await recordASession('ask')

    const modes: (boolean | undefined)[] = []
    const relaunched = buildHost({
      createRuntime: (provider) => {
        const runtime = runtimes.get(provider)!
        const spy: AgentRuntime = {
          provider,
          start: (options) => runtime.start(options),
          listModels: (context) => runtime.listModels(context),
          resume: (ref, options) => {
            modes.push(options.planMode)
            return runtime.resume(ref, options)
          },
        }
        return spy
      },
    })

    await relaunched.resumeSession(planning.created.sessionId, new RecordingSink())
    await relaunched.resumeSession(plain.created.sessionId, new RecordingSink())
    await relaunched.resumeSession(never.created.sessionId, new RecordingSink())
    // `false` and "never asked" both resume without plan mode, and they arrive here the same way —
    // the difference between them is recorded in the row, not re-litigated at the provider.
    expect(modes).toEqual([true, undefined, undefined])
    // …and the row keeps the distinction the resume call does not need.
    expect(store.find(planning.created.sessionId)?.planMode).toBe(true)
    expect(store.find(plain.created.sessionId)?.planMode).toBe(false)
    expect(store.find(never.created.sessionId)?.planMode).toBeNull()
    await relaunched.closeAll()
  })

  it('…and a plan that was RELEASED stays released across a relaunch (060)', async () => {
    // The durable half of the go-ahead, end to end: a real database, a real migration, a real
    // resume. Without it the conversation comes back proposing — and the sticky server-side mode
    // means it would genuinely still be in plan mode, with the bar gone and nothing to say why.
    // ⚑ **741 · the go-ahead is given while the conversation is LIVE** — since R99 (corrected) a
    // reopened conversation is no longer planning, so there is no plan left to release after one.
    const live = buildHost({ newSessionId: () => 'sess_goahead' })
    const created = await live.createSession(
      { provider: 'codex', approvalMode: 'ask', planMode: true },
      sink,
    )
    const from = sink.messages.length
    const seenHere = (type: string): boolean =>
      sink.messages.slice(from).some((m) => m.event.type === type)
    await live.send(created.sessionId, 'hello', sink)
    await waitFor(() => seenHere('permission_request'), 'the first turn')
    await live.respondPermission(created.sessionId, 'turn_1_perm', { outcome: 'allow' }, sink)
    await waitFor(() => seenHere('turn'), 'the turn to finish')
    await live.endPlanMode(created.sessionId, sink, 'Go ahead with this plan.')
    await live.closeAll()
    const planning = { created }
    const untouched = await recordASession('ask', undefined, undefined, true)

    const seen: { planMode?: boolean; ended?: boolean }[] = []
    const relaunched = buildHost({
      createRuntime: (provider) => {
        const runtime = runtimes.get(provider)!
        return {
          provider,
          start: (options) => runtime.start(options),
          listModels: (context) => runtime.listModels(context),
          resume: (ref, options) => {
            seen.push({ planMode: options.planMode, ended: options.planModeEnded })
            return runtime.resume(ref, options)
          },
        } satisfies AgentRuntime
      },
    })
    const released = await relaunched.resumeSession(planning.created.sessionId, new RecordingSink())
    const still = await relaunched.resumeSession(untouched.created.sessionId, new RecordingSink())

    // Check app authorship through publication, a real SQLite ledger, and replay validation.
    // A reload must preserve both the generated go-ahead’s causality and its authorship. In
    // one assertion, the person’s typed `hello` returns unmarked while the app turn is
    // marked; the `untouched` session retains only the typed turn. Preserve `sent` too: the
    // full text handed to the provider is kept separately.
    const turnsOf = (sessionId: string) =>
      store
        .events(sessionId)
        .map((entry) => entry.event)
        .filter((event) => event.type === 'user_turn')
        .map(({ sent, ...row }) => (void sent, row))
    expect(turnsOf(planning.created.sessionId)).toEqual([
      { type: 'user_turn', text: 'hello' },
      { type: 'user_turn', text: 'Go ahead with this plan.', attribution: 'app_authored' },
    ])
    expect(turnsOf(untouched.created.sessionId)).toEqual([{ type: 'user_turn', text: 'hello' }])

    // ⚠️ BOTH fields reach the adapter, and both are needed: `planMode` alone cannot distinguish a
    // released session from one that never planned, and those two must send different things on
    // every turn (see the column comment).
    // 🔴 **741 · R99 (corrected) — and a plan still OPEN at the close is released by the reopen**:
    // *"a reopened conversation does NOT resume planning, whoever started the plan"* — the
    // interactive CLI's resume comes back in its default mode (measured, `740` K7). ⛔ Until `741` the
    // untouched session came back `{ planMode: true, ended: undefined }` — still planning (060).
    expect(seen).toEqual([
      { planMode: true, ended: true },
      { planMode: true, ended: true },
    ])
    expect(released.planNeedsGoAhead).toBe(false)
    expect(still.planNeedsGoAhead).toBe(false)
    // The row keeps both facts rather than overwriting one with the other — and the reopen's release
    // is one of them now.
    expect(store.find(planning.created.sessionId)?.planMode).toBe(true)
    expect(store.find(planning.created.sessionId)?.planEndedAt).toBeGreaterThan(0)
    expect(store.find(untouched.created.sessionId)?.planMode).toBe(true)
    expect(store.find(untouched.created.sessionId)?.planEndedAt).toBeGreaterThan(0)
    await relaunched.closeAll()
  })

  it('a go-ahead on a session that never planned writes NOTHING (060)', async () => {
    // The store's own guard, checked against a real database rather than trusted to the caller. A
    // `plan_ended_at` on a row whose `plan_mode` is not set would have the adapter assert a
    // collaboration mode on a thread that has none — replacing the developer instructions a
    // workspace hint put there. The `WHERE` is what makes that unreachable even by mistake.
    const plain = await recordASession('ask')
    store.endPlanMode(plain.created.sessionId, 1_700_000_000_000)
    expect(store.find(plain.created.sessionId)?.planEndedAt).toBeNull()
  })

  it('refuses to resume what it cannot resume, rather than starting something new', async () => {
    const host = buildHost()
    await expect(host.resumeSession('sess_nope', sink)).rejects.toThrow(
      'There is no record of this conversation here.',
    )

    // A provider that cannot find the conversation surfaces as a rejection…
    const { created } = await recordASession()
    const failing = buildHost({
      createRuntime: () =>
        ({
          provider: 'codex' as const,
          start: () => Promise.reject(new Error('unused')),
          resume: () => Promise.reject(new Error('session not found: gone')),
        }) as unknown as AgentRuntime,
    })
    await expect(failing.resumeSession(created.sessionId, sink)).rejects.toThrow(
      'session not found',
    )
    // …and nothing half-registered is left behind.
    expect(failing.sessionIds).toEqual([])
  })

  /**
   * ⚠️ **This test used to assert the refusal, and the refusal was the bug** (100).
   *
   * A second resume from the same surface can recover a live host session the window has lost
   * sight of. The invariant is one session, provider, and slot; rejecting with `already open`
   * is not itself the property to preserve.
   *
   * So it asserts the property directly now, which the old form could not: the second ask is
   * answered with the SAME session, no second provider is spawned, and the host still holds one
   * slot. A regression that started a second child would have passed the old test by rejecting for
   * any reason at all.
   */
  it('hands the same session back when the surface that owns it asks again', async () => {
    const { created } = await recordASession()
    // Counted at the RUNTIME, which is the only witness that cannot be satisfied by the host
    // merely tidying up after itself: if a second provider is asked for, this goes to 2.
    let resumesAsked = 0
    const relaunched = buildHost({
      createRuntime: (provider) => {
        const runtime = runtimes.get(provider) ?? new FakeRuntime(provider)
        runtimes.set(provider, runtime)
        return {
          provider,
          listModels: (context) => runtime.listModels(context),
          start: (options) => runtime.start(options),
          resume: (ref, options) => {
            resumesAsked++
            return runtime.resume(ref, options)
          },
        } satisfies AgentRuntime
      },
    })
    const first = await relaunched.resumeSession(created.sessionId, sink)
    expect(resumesAsked).toBe(1)

    const again = await relaunched.resumeSession(created.sessionId, sink)

    expect(again.sessionId).toBe(first.sessionId)
    expect(again.ref).toEqual(first.ref)
    // Nothing was opened, something was handed back.
    expect(resumesAsked).toBe(1)
    expect(relaunched.sessionIds).toEqual([created.sessionId])
    // …and it comes back with its transcript, which is what makes it usable rather than merely
    // not-an-error: a window that has forgotten a conversation needs the conversation.
    expect(again.history.entries.length).toBeGreaterThan(0)
    await relaunched.closeAll()
  })

  it('still refuses a DIFFERENT surface the session it is running', async () => {
    // 062's rule, and the line the attach above must not have crossed: joining a second window onto
    // a live session would send its events to somebody else's sink.
    const { created } = await recordASession()
    const relaunched = buildHost()
    await relaunched.resumeSession(created.sessionId, sink)

    await expect(
      relaunched.resumeSession(created.sessionId, new RecordingSink('owner:2')),
    ).rejects.toThrow('already open in another window')
    await relaunched.closeAll()
  })

  /**
   * **The one launch setting that must NOT come back** (106).
   *
   * Every pair above says the opposite thing — mode, effort, model, plan mode all carry on, because
   * *"a conversation carries on the way it was started"*. The provider's max-effort orchestration
   * mode is the exception, and the SDK says so itself: *"Session-scoped … interactive toggles never
   * persist it."* So it has no column, `reopenSession` has nothing to read, and
   * `StartOptions.ultracode` sits on the start options rather than the launch context precisely so
   * the resume call could not carry it even if someone added the read.
   *
   * ⚠️ The failure this prevents is 085's ended latch with a new subject: an app that re-asked on
   * every reopen would be claiming a state it has no way to confirm — 106 measured that the CLI
   * accepts the setting, and a key that does not exist, with equal silence.
   */
  describe('the max-effort mode is asked for once and never restored (106)', () => {
    /** A host whose adapter records what `start` and `resume` were actually handed. */
    function spyingHost(seen: { starts: unknown[]; resumes: unknown[] }, nth?: number) {
      return buildHost({
        ...(nth === undefined ? {} : { newSessionId: () => `sess_${nth}` }),
        createRuntime: (provider) => {
          // The same get-or-create the default `buildHost` does. The resume tests above can assume
          // the map is warm because `recordASession` filled it; a test that STARTS a session is the
          // first caller, so `runtimes.get(provider)!` would be `undefined` and the spy would throw
          // on `.start`.
          let runtime = runtimes.get(provider)
          if (!runtime) {
            runtime = new FakeRuntime(provider)
            runtimes.set(provider, runtime)
          }
          const real = runtime
          const spy: AgentRuntime = {
            provider,
            start: (options) => {
              seen.starts.push(options)
              return real.start(options)
            },
            listModels: (context) => real.listModels(context),
            resume: (ref, options) => {
              seen.resumes.push(options)
              return real.resume(ref, options)
            },
          }
          return spy
        },
      })
    }

    it('reaches the adapter on the launch that asked for it', async () => {
      const seen = { starts: [] as unknown[], resumes: [] as unknown[] }
      const asking = spyingHost(seen)
      await asking.createSession({ provider: 'claude', ultracode: true }, sink)
      // The A/B: the same host, one launch that asked and one that did not, so "it arrives" and
      // "the field is always there" are distinguishable.
      await asking.createSession({ provider: 'claude' }, sink)

      expect(seen.starts).toHaveLength(2)
      expect(seen.starts[0]).toMatchObject({ ultracode: true })
      // Omitted, not `false` — the whole stack reads an absent field as "we did not ask".
      expect(seen.starts[1]).not.toHaveProperty('ultracode')
      await asking.closeAll()
    })

    it('is not written to the session row, so a reopen has nothing to read', async () => {
      const host2 = buildHost({ newSessionId: () => 'sess_ultra' })
      await host2.createSession({ provider: 'claude', ultracode: true }, sink)

      const row = db.prepare('SELECT * FROM provider_session WHERE id = ?').get('sess_ultra') as
        Record<string, unknown> | undefined
      expect(row, 'the session really was recorded').toBeDefined()
      // ⚠️ Asserted over the COLUMN NAMES rather than by reading one: a column added later would
      // pass `row['ultracode'] === undefined` on the day it was added and empty, and this is the
      // shape that keeps failing once it exists.
      expect(Object.keys(row!).filter((key) => /ultra/i.test(key))).toEqual([])
      // The paired positive: the settings that ARE recorded still are, so the sweep above is about
      // this one field rather than about a row that recorded nothing.
      expect(Object.keys(row!)).toContain('reasoning_effort')
      expect(Object.keys(row!)).toContain('plan_mode')
      await host2.closeAll()
    })

    it('a reopened conversation is not re-asked, while everything else IS', async () => {
      // Recorded through the ordinary path, WITH the settings that do survive, so the negative below
      // sits next to four positives from the same resume call.
      const { created } = await recordASession('auto', 'high', 'some-model', true)

      const seen = { starts: [] as unknown[], resumes: [] as unknown[] }
      const relaunched = spyingHost(seen)
      await relaunched.resumeSession(created.sessionId, new RecordingSink())

      expect(seen.resumes).toHaveLength(1)
      const options = seen.resumes[0] as Record<string, unknown>
      expect(options).toMatchObject({
        approvalMode: 'auto',
        reasoningEffort: 'high',
        model: 'some-model',
        planMode: true,
      })
      expect(options, 'the mode was for that run').not.toHaveProperty('ultracode')
      await relaunched.closeAll()
    })
  })
})
