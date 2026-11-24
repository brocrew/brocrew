import type { TranscriptEvent } from '../src/shared/conversation-events'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest'
import { type AppDatabase, openDatabase } from '../src/main/db/connection'
import { applyMigrations } from '../src/main/db/migrate'
import { createSessionStore, type SessionStore } from '../src/main/db/session-store'
import {
  scheduleNoticesText,
  THE_APP_ITSELF,
  type NoticeAboutAJob,
} from '../src/main/runtime/runtime-host'
import {
  importScheduleAttemptsFile,
  MAX_ATTEMPT_CONVERSATIONS,
  SCHEDULE_ATTEMPTS_FILE,
  scheduleAttemptsIn,
  type ConversationAttempts,
} from '../src/main/schedule-attempts-file'
import { clockTime, clockTimeFrom } from '../src/shared/clock'
import { withoutWhatThisAppAdds } from './lib/what-this-app-adds'
import {
  aWakeUpApp,
  DUE,
  GAP,
  type Job,
  LATE,
  LEAD,
  local,
  migrationsFolder,
  NIGHTLY,
  ONE_SHOT_A,
  settle,
  type TimerCall,
  waitFor,
} from './helpers/scheduled-wake-up-fixture'

/**
 * Scheduled conversations use one wake-up per newest ledger level at launch and stop.
 * A receipt gives a known minute and a thirty-second lead. A level without that
 * evidence costs one start, once; passed or removed jobs are reported once instead.
 * Pure wording cases use local wall-clock dates. Store cases use real SQLite and
 * migrations; host cases use a provider double that reports actual tool calls and levels.
 * Restart closes the first host and opens another over the same database and attempt
 * file. Quit arms nothing, so timers in the second life belong to launch planning.
 * Call-through spies retain each real timer, delay and callback; tests invoke those
 * callbacks directly. The controlled clock advances one millisecond per read.
 */

/* ══════════════════ what a conversation is told of its jobs ══════════════════ */

describe('D-029 · what a conversation is told of its scheduled jobs', () => {
  const now = local(9, 28, 15, 0)
  const passed = (prompt: string | undefined, dueAt: number | null = DUE): NoticeAboutAJob => ({
    reason: 'offline-time-passed',
    dueAt,
    ...(prompt === undefined ? {} : { prompt }),
  })
  const gone = (prompt: string | undefined, dueAt: number | null = DUE): NoticeAboutAJob => ({
    ...passed(prompt, dueAt),
    reason: 'not-present',
  })
  const PASSED_ONE =
    'was due while this conversation was stopped. This app cannot tell whether it ran: check whether its work is still needed.'
  const PASSED_MANY =
    'were due while this conversation was stopped. This app cannot tell whether they ran: check whether their work is still needed.'
  const GONE_ONE =
    'is no longer on your schedule. This app cannot tell whether it ran or was cancelled.'

  it('each kind in a plain sentence, each job by its minute and the first line it asked', () => {
    const t1 = clockTime(DUE)
    const t2 = clockTime(local(9, 28, 14, 50))
    const t3 = clockTime(local(9, 28, 14, 55))
    expect(t1).not.toBe('')
    expect(t1).not.toBe(t2)

    // One, two and three whose time passed.
    expect(scheduleNoticesText([passed('check the deploy')], now)).toBe(
      `Your scheduled job for ${t1} (“check the deploy”) ${PASSED_ONE}`,
    )
    expect(scheduleNoticesText([passed('a'), passed('b', local(9, 28, 14, 50))], now)).toBe(
      `Your scheduled jobs for ${t1} (“a”) and for ${t2} (“b”) ${PASSED_MANY}`,
    )
    expect(
      scheduleNoticesText(
        [passed('a'), passed('b', local(9, 28, 14, 50)), passed('c', local(9, 28, 14, 55))],
        now,
      ),
    ).toBe(
      `Your scheduled jobs for ${t1} (“a”), for ${t2} (“b”) and for ${t3} (“c”) ${PASSED_MANY}`,
    )
    // Two kinds: a sentence each, one space between, whatever order they came in.
    expect(scheduleNoticesText([gone('b', local(9, 28, 14, 50)), passed('a')], now)).toBe(
      `Your scheduled job for ${t1} (“a”) ${PASSED_ONE} Your scheduled job for ${t2} (“b”) ${GONE_ONE}`,
    )
    // ⛔ It never says a job did not run: nothing public says which turn a job began.
    for (const reason of [
      'offline-time-passed',
      'recurring-offline-interval',
      'not-present',
      'expired-on-resume',
      'compaction-confirmed',
    ] as const) {
      const said = scheduleNoticesText([{ reason, dueAt: DUE, prompt: 'p' }], now)
      expect(said, reason).toContain(`Your scheduled job for ${t1} (“p”) `)
      expect(said, reason).not.toMatch(/did not run|will not run|never ran/)
    }
    // Nothing to tell, nothing said.
    expect(scheduleNoticesText([], now)).toBe('')

    // A job due yesterday says its day; one due today does not.
    const yesterday = local(9, 27, 14, 45)
    expect(clockTimeFrom(yesterday, now)).not.toBe(clockTime(yesterday))
    expect(scheduleNoticesText([passed('a', yesterday)], now)).toContain(
      `for ${clockTimeFrom(yesterday, now)} (“a”)`,
    )
    expect(clockTimeFrom(DUE, now)).toBe(clockTime(DUE))

    // Only the first line of what it asked is told, whatever its line breaks.
    const manyLines = scheduleNoticesText([passed('first line\r\nsecond line')], now)
    expect(manyLines).toContain('(“first line”)')
    expect(manyLines).not.toContain('second line')
    // Eighty code points are told whole; the eighty-first is the cut, marked with an ellipsis.
    expect(scheduleNoticesText([passed('😀'.repeat(80))], now)).toContain(`(“${'😀'.repeat(80)}”)`)
    const cut = scheduleNoticesText([passed('😀'.repeat(81))], now)
    expect(cut).toContain(`(“${'😀'.repeat(80)}…”)`)
    expect(cut).not.toContain('😀'.repeat(81))

    // A clause is left out when the fact behind it is absent, and present when it is not.
    expect(scheduleNoticesText([passed('p', null)], now)).toBe(
      `Your scheduled job (“p”) ${PASSED_ONE}`,
    )
    expect(scheduleNoticesText([passed(undefined)], now)).toBe(
      `Your scheduled job for ${t1} ${PASSED_ONE}`,
    )
    expect(scheduleNoticesText([passed(undefined, null)], now)).toBe(
      `Your scheduled job ${PASSED_ONE}`,
    )
  })
})

/* ══════════════════ what the ledger says, read off the real store ══════════════════ */

describe('D-029 · what the ledger says a conversation scheduled', () => {
  let userData: string
  let db: AppDatabase
  let store: SessionStore
  let warn: MockInstance<typeof console.warn>
  let clock: number
  const tick = (): number => clock++
  const ordinals = new Map<string, number>()

  beforeEach(() => {
    userData = mkdtempSync(join(tmpdir(), 'brobot2-wakeup-ledger-'))
    db = openDatabase(join(userData, 'brobot2.sqlite'))
    applyMigrations(db, migrationsFolder)
    clock = 1_000
    store = createSessionStore(db, tick)
    ordinals.clear()
    warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
  })

  afterEach(() => {
    vi.restoreAllMocks()
    db.close()
    rmSync(userData, { recursive: true, force: true })
  })

  const conversation = (id: string): string => {
    store.create({ id, provider: 'claude', cwd: userData, approvalMode: 'ask', profileId: 'agent' })
    return id
  }
  const append = (id: string, event: Record<string, unknown>, at: number): void => {
    const next = ordinals.get(id) ?? 0
    ordinals.set(id, next + 1)
    store.append(id, next, event as unknown as TranscriptEvent, at)
  }
  const lists = (id: string, jobs: Record<string, unknown>[], at: number): void =>
    append(id, { type: 'scheduled_work', jobs, source: 'test' }, at)
  /** A row whose payload is written raw, as a torn or short one is: ordinals past any real one. */
  const rawLevel = (id: string, ordinal: number, payload: string, at: number): void => {
    db.prepare(
      `INSERT INTO events (id, session_id, generation, ordinal, type, payload, created_at)
       VALUES (?, ?, 0, ?, 'scheduled_work', ?, ?)`,
    ).run(`evt_${id}_${String(ordinal)}`, id, ordinal, payload, at)
  }

  it("a wake-up is built from each conversation's newest level: an emptied level hides an older one, and a torn one costs only its own conversation", () => {
    // The control: a store that holds no conversation reads nothing.
    expect(store.newestScheduleLevels()).toEqual([])

    const nightly = { id: 'j1', schedule: '0 3 * * *', recurring: true, prompt: 'nightly' }
    const once = { id: 'j2', schedule: '30 4 28 9 *', recurring: false }
    // keeps: a level, a compaction, a newer level that adds a job, a newer compaction.
    conversation('sess_keeps')
    lists('sess_keeps', [nightly], 100)
    append('sess_keeps', { type: 'compaction', source: 'test' }, 150)
    lists('sess_keeps', [nightly, once], 200)
    append('sess_keeps', { type: 'compaction', source: 'test' }, 250)
    // cleared: a job, then the model clears the schedule.
    conversation('sess_cleared')
    lists('sess_cleared', [{ id: 'jobA', schedule: '0 3 * * *', recurring: true }], 100)
    lists('sess_cleared', [], 200)
    // torn: a valid level, then a row that is not JSON.
    conversation('sess_torn')
    lists('sess_torn', [{ id: 'jobB', schedule: '0 3 * * *', recurring: true }], 100)
    rawLevel('sess_torn', 900, 'not json', 200)
    // short: one readable row, one with no id, one whose id is no string, and a stated count of one.
    conversation('sess_short')
    rawLevel(
      'sess_short',
      900,
      '{"jobs":[{"id":"ok","schedule":"0 3 * * *","recurring":true},{"schedule":"no id"},{"id":7}],"dropped":1}',
      300,
    )
    // understated: no row to list, and a count that says two were not.
    conversation('sess_understated')
    rawLevel('sess_understated', 900, '{"jobs":[],"dropped":2}', 300)
    // quiet: says nothing about a schedule at all.
    conversation('sess_quiet')
    append('sess_quiet', { type: 'status', state: 'idle' }, 100)

    const read = [...store.newestScheduleLevels()].sort((a, b) =>
      a.conversation.localeCompare(b.conversation),
    )

    // The conversations it does read, beside the omissions that follow.
    expect(read.map((row) => row.conversation)).toEqual([
      'sess_keeps',
      'sess_short',
      'sess_understated',
    ])
    const [keeps, short, understated] = read
    // Newest level wins; j1's first listing is its EARLIEST level; the newest compaction is kept.
    expect(keeps?.level).toEqual({
      jobs: [
        { id: 'j1', schedule: '0 3 * * *', recurring: true, prompt: 'nightly', listedSince: 100 },
        { id: 'j2', schedule: '30 4 28 9 *', recurring: false, listedSince: 200 },
      ],
      dropped: 0,
    })
    expect(keeps?.compactedAt).toBe(250)
    // The count adds the stated one to the two rows that could not be read.
    expect(short?.level).toEqual({
      jobs: [{ id: 'ok', schedule: '0 3 * * *', recurring: true, listedSince: 300 }],
      dropped: 3,
    })
    expect(short?.compactedAt).toBeNull()
    expect(understated?.level).toEqual({ jobs: [], dropped: 2 })
    expect(understated?.compactedAt).toBeNull()

    // An emptied newest level hides the older one, and a torn newest does NOT fall back to it: its
    // own conversation is skipped, once, said.
    const absent = read.map((row) => row.conversation)
    expect(absent).not.toContain('sess_cleared')
    expect(absent).not.toContain('sess_torn')
    expect(absent).not.toContain('sess_quiet')
    const lines = warn.mock.calls.map(([line]) => String(line))
    expect(lines).toHaveLength(1)
    expect(lines[0]).toContain('session store skipped an unreadable schedule in sess_torn')
  })
})

/* ══════════════════ the host, over a real store and a provider double ══════════════════ */

describe('what was done about scheduled jobs is kept for the conversations recorded most recently', () => {
  it('⛔ of one more than the cap, the one recorded longest ago goes, and a read gives back what was written', () => {
    const dir = mkdtempSync(join(tmpdir(), 'brobot2-attempts-'))
    const db = openDatabase(join(dir, 'brobot2.sqlite'))
    try {
      applyMigrations(db, migrationsFolder)
      const done = (at: number): ConversationAttempts => ({
        attempts: [{ key: 'a job', revision: 'as it was', attempted: true }],
        admittedAt: at,
        told: [{ id: 'a notice', of: 'a making', said: true }],
        runs: { 'a making': { runAt: at, startedAt: at, unanswered: 2 } },
        notStartedSaid: { 'job-a': 'no-word-from-its-provider' },
        at,
      })
      scheduleAttemptsIn(db).write({
        conversations: Object.fromEntries(
          Array.from({ length: MAX_ATTEMPT_CONVERSATIONS + 1 }, (_, n) => [
            `sess_${String(n)}`,
            done(1_000 + n),
          ]),
        ),
      })
      const back = scheduleAttemptsIn(db).read().conversations
      expect(Object.keys(back)).toHaveLength(MAX_ATTEMPT_CONVERSATIONS)
      // ⚠️ The one dropped is read as nothing done: it costs one more start, and no more.
      expect(back['sess_0']).toBeUndefined()
      expect(back[`sess_${String(MAX_ATTEMPT_CONVERSATIONS)}`]).toEqual(
        done(1_000 + MAX_ATTEMPT_CONVERSATIONS),
      )

      // The old file is imported once; one that is not JSON is kept and imports nothing.
      const file = join(dir, SCHEDULE_ATTEMPTS_FILE)
      writeFileSync(file, '{ torn')
      importScheduleAttemptsFile(db, dir)
      expect(readFileSync(file, 'utf8')).toBe('{ torn')
      expect(Object.keys(scheduleAttemptsIn(db).read().conversations)).toHaveLength(
        MAX_ATTEMPT_CONVERSATIONS,
      )
      writeFileSync(
        file,
        JSON.stringify({ conversations: { sess_x: { at: 'yesterday' }, sess_y: done(7) } }),
      )
      importScheduleAttemptsFile(db, dir)
      expect(scheduleAttemptsIn(db).read().conversations).toEqual({ sess_y: done(7) })
      expect(existsSync(file)).toBe(false)
    } finally {
      db.close()
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

describe('D-029 · the host starts a stopped conversation in time for the jobs it scheduled', () => {
  const app = aWakeUpApp()
  const {
    aFirstLife,
    doubleOf,
    handlesOf,
    heldNotices,
    ledger,
    lists,
    liveCountdowns,
    makes,
    noticesIn,
    opens,
    providerIdOf,
    restartsAt,
    runningOf,
    stateOf,
    theHeldNotice,
    timerCall,
    wakeUpsOf,
  } = app

  // ─────────────────────────────────────────────────────────────────────────────────────────────

  it('a restart arms one wake-up for each stopped conversation whose newest level holds a job, on a timer of a minute at most, and starts it the lead before its job', async () => {
    const [a, b] = await aFirstLife(
      async ([first, second]) => {
        await makes(first!, ONE_SHOT_A)
        // B made a daily job, and then its provider said nothing is scheduled: nothing to wake it for.
        await makes(second!, NIGHTLY)
        doubleOf(second!).simulateScheduledWork({ jobs: [] })
        await settle()
      },
      'agent-a',
      'agent-b',
    )
    if (a === undefined || b === undefined) throw new Error('two conversations were opened')
    const before = app.handles.length

    // The control: the same ledger, a host nobody listens to — it arms nothing.
    const quiet = restartsAt(local(9, 28, 12, 0), false)
    expect(wakeUpsOf(quiet).size).toBe(0)
    expect(stateOf(quiet, a)).toEqual({ is: 'idle' })
    expect(app.handles.length).toBe(before)
    await quiet.closeAll()

    // The same ledger, a host that is listened to.
    const listening = restartsAt(local(9, 28, 12, 0))
    expect([...wakeUpsOf(listening).keys()]).toEqual([a])
    const wake = wakeUpsOf(listening).get(a)
    if (wake === undefined) throw new Error('A holds no wake-up')
    expect(wake.startAt).toBe(DUE - LEAD)
    // Its minute is 2 h 45 min away, and the timer is a minute at most.
    expect(timerCall(wake.timer).delay).toBe(60_000)
    expect(stateOf(listening, a)).toEqual({ is: 'scheduled', dueAt: DUE })
    expect(stateOf(listening, b)).toEqual({ is: 'idle' })
    expect(app.handles.length).toBe(before)

    // The timer runs thirty seconds before its start: nothing starts, and the clock is read again.
    const first = wake.timer
    app.clock = local(9, 28, 14, 44, 0)
    timerCall(first).fn()
    await settle()
    expect(app.handles.length).toBe(before)
    expect(wakeUpsOf(listening).get(a)).toBe(wake)
    expect(wake.timer).not.toBe(first)
    const again = timerCall(wake.timer).delay
    expect(again).toBeGreaterThan(0)
    expect(again).toBeLessThanOrEqual(60_000)
    clearTimeout(first ?? undefined)

    // Twenty seconds past its start, the same timer starts it — with no message.
    const second = wake.timer
    app.clock = local(9, 28, 14, 44, 50)
    timerCall(second).fn()
    await waitFor(() => app.handles.length === before + 1, 'A to be started for its job')
    expect(doubleOf(a).origins).toEqual([])
    expect(handlesOf(a)).toHaveLength(2)
    clearTimeout(second ?? undefined)
    await settle()
    expect(wakeUpsOf(listening).has(a)).toBe(false)
  })

  it('a one-shot that came due while the app was down is told once and its conversation started at once; one still ahead is neither', async () => {
    const jobE: Job = { id: 'job-e', schedule: '15 16 28 9 *', recurring: false, prompt: 'ship it' }
    const [a, e] = await aFirstLife(
      async ([first, second]) => {
        await makes(first!, ONE_SHOT_A)
        await makes(second!, jobE)
      },
      'agent-a',
      'agent-e',
    )
    if (a === undefined || e === undefined) throw new Error('two conversations were opened')
    const before = handlesOf(a).length

    // A's 14:45 has passed; E's 16:15 has not.
    restartsAt(local(9, 28, 15, 0))
    await waitFor(() => handlesOf(a).length === before + 1, 'A to be started')

    // A was told once, held in its ledger, in words that claim only what is known.
    expect(heldNotices(a)).toHaveLength(1)
    expect(heldNotices(a)[0]?.text).toBe(theHeldNotice(DUE))
    // …and the held words went in as its start's first turn.
    await waitFor(
      () =>
        ledger(a).some(
          (event) =>
            event.type === 'assistant_message' &&
            event.text.includes('was due while this conversation was stopped'),
        ),
      'the held words to reach A',
    )
    await settle()
    expect(heldNotices(a)).toHaveLength(1)
    expect(wakeUpsOf(app.host).has(a)).toBe(false)

    // E, on the same restart: the same shape of job with its time still ahead is neither told nor
    // started — it is waited for.
    expect(noticesIn(e)).toEqual([])
    expect(handlesOf(e)).toHaveLength(1)
    expect(wakeUpsOf(app.host).get(e)?.startAt).toBe(local(9, 28, 16, 15) - LEAD)
    expect(stateOf(app.host, e)).toEqual({ is: 'scheduled', dueAt: local(9, 28, 16, 15) })
  })

  it('🔴 a crash leaves no row for a life’s end: a one-shot whose minute passed since its provider last spoke is still told', async () => {
    const [a] = await aFirstLife(async ([first]) => makes(first!, ONE_SHOT_A), 'agent-a')
    if (a === undefined) throw new Error('a conversation was opened')
    // ⚑ The app died: the quit's own rows for the life's end were never written.
    const ended = app.db
      .prepare(
        `DELETE FROM events WHERE session_id = ?
           AND ((type = 'status' AND json_extract(payload, '$.state') = 'ended')
             OR (type = 'session' AND json_extract(payload, '$.state') = 'ended'))`,
      )
      .run(a)
    expect(ended.changes).toBeGreaterThan(0)
    const before = handlesOf(a).length

    restartsAt(local(9, 28, 15, 0))
    await waitFor(() => handlesOf(a).length === before + 1, 'A to be started')
    expect(heldNotices(a)).toHaveLength(1)
    expect(heldNotices(a)[0]?.text).toBe(theHeldNotice(DUE))
  })

  it('⚑ seven stopped conversations at a launch: each one’s history is read once, and the launch’s list once', async () => {
    const { infoSpy, store } = app
    const profiles = Array.from({ length: 7 }, (_, n) => `agent-${String(n)}`)
    const made = await aFirstLife(
      async (ids) => {
        for (const [n, id] of ids.entries())
          await makes(id, { ...NIGHTLY, id: `nightly-${String(n)}` })
      },
      ...profiles,
    )
    const histories = vi.spyOn(store, 'scheduleEvidenceRows')
    const lists_ = vi.spyOn(store, 'newestScheduleLevels')
    const lastStatus = vi.spyOn(store, 'lastStatusAt')
    const began = performance.now()
    restartsAt(local(9, 28, 12, 0))
    const tookMs = performance.now() - began
    await settle()
    expect(lists_).toHaveBeenCalledTimes(1)
    expect(histories).toHaveBeenCalledTimes(made.length)
    expect(new Set(histories.mock.calls.map(([id]) => id)).size).toBe(made.length)
    expect(lastStatus.mock.calls.length).toBeLessThanOrEqual(made.length)
    // Every one armed for its run, none started now.
    for (const id of made)
      expect(wakeUpsOf(app.host).get(id)?.startAt).toBe(local(9, 29, 3, 0) - LEAD)
    // ⚑ An observation, not a bound: what the launch's own work took here.
    infoSpy.mockRestore()
    console.info(`seven-launch: the host's start took ${tookMs.toFixed(1)} ms`)
  })

  it('⚑ a start for a job’s time that comes due while starts due at once wait goes before them', async () => {
    const [a, b, c] = await aFirstLife(
      async ([first, second, third]) => {
        await lists(first!, NIGHTLY)
        await lists(second!, { ...NIGHTLY, id: 'nightly-b' })
        await makes(third!, ONE_SHOT_A)
      },
      'agent-a',
      'agent-b',
      'agent-c',
    )
    if (a === undefined || b === undefined || c === undefined) throw new Error('three were opened')
    const handlesBefore = app.handles.length
    restartsAt(local(9, 28, 14, 40))
    // A and B are due at once; C, at its job's lead.
    await waitFor(() => app.handles.length === handlesBefore + 1, 'the first start at once')
    app.clock = DUE - LEAD
    timerCall(wakeUpsOf(app.host).get(c)?.timer ?? null).fn()
    await waitFor(() => app.handles.length === handlesBefore + 3, 'all three to be started')
    const order = app.handles.slice(handlesBefore).map((one) => one.ref.sessionId)
    // ⚑ C came due during the wider pause before the second start due at once, and went first.
    expect(order[1]).toBe(providerIdOf(c))
  })

  it('🔴 conversations due together are started one at a time, a pause apart', async () => {
    const jobs = ['a', 'b', 'c'].map((name): Job => ({
      ...ONE_SHOT_A,
      id: `job-${name}`,
      prompt: `check ${name}`,
    }))
    const made = await aFirstLife(
      async (ids) => {
        for (const [index, id] of ids.entries()) await makes(id, jobs[index]!)
      },
      'agent-a',
      'agent-b',
      'agent-c',
    )
    app.control.resumedAt = []
    restartsAt(LATE)
    await waitFor(() => app.control.resumedAt.length === made.length, 'all three to be started')
    const [first, second, third] = app.control.resumedAt as [number, number, number]
    // ⚑ Each was due at once, so each waits out four pauses after the one before it ended — the
    // wider spacing, which one pause alone would not pass.
    expect(second - first).toBeGreaterThanOrEqual(4 * GAP - 20)
    expect(third - second).toBeGreaterThanOrEqual(4 * GAP - 20)
  })

  it('a stop arms the wake-up of what its ledger holds, so the conversation reads scheduled until it is started', async () => {
    app.clock = local(9, 28, 12, 0)
    const f = await opens('agent-f')
    const g = await opens('agent-g')
    await makes(f, NIGHTLY)
    doubleOf(g).simulateScheduledWork({ jobs: [] })
    await settle()

    await app.host.close(f, THE_APP_ITSELF)
    await app.host.close(g, THE_APP_ITSELF)
    await settle()

    // F took its jobs with it, and the stop armed their wake-up: scheduled · 03:00, started the
    // lead before.
    expect(runningOf(f)).toBe('not-running')
    expect(wakeUpsOf(app.host).get(f)?.startAt).toBe(local(9, 29, 3, 0) - LEAD)
    expect(stateOf(app.host, f)).toEqual({ is: 'scheduled', dueAt: local(9, 29, 3, 0) })
    expect(noticesIn(f)).toEqual([])
    // G, the same stop with the provider having said nothing is scheduled: idle, and unarmed.
    expect(runningOf(g)).toBe('not-running')
    expect(wakeUpsOf(app.host).has(g)).toBe(false)
    expect(stateOf(app.host, g)).toEqual({ is: 'idle' })
  })

  it('a life started for its jobs holds them from its first moment, so the idle stop leaves it alone, until they could no longer run and its provider has said nothing', async () => {
    const { infoSpy, setTimeoutSpy } = app
    const [a] = await aFirstLife(async ([first]) => makes(first!, ONE_SHOT_A), 'agent-a')
    if (a === undefined) throw new Error('a conversation was opened')
    const before = handlesOf(a).length

    // Inside the lead: the start is owed at once.
    restartsAt(LATE)
    await waitFor(() => handlesOf(a).length === before + 1, 'A to be started for its job')
    // The provider says nothing; the life reads what its wake-up held.
    expect(stateOf(app.host, a)).toEqual({ is: 'scheduled', dueAt: DUE })

    // A plain conversation in the same host IS counted at once; A, scheduled from its seed, is not.
    const h = await opens('agent-h')
    await settle()
    expect(h).not.toBe(a)
    expect(liveCountdowns()).toBe(1)

    const letGo = (): TimerCall[] =>
      setTimeoutSpy.mock.calls
        .filter(([fn]) => String(fn).includes('has said nothing of the jobs'))
        .map(([fn, delay]) => ({ fn: fn as () => void, delay: Number(delay) }))
    expect(letGo()).toHaveLength(1)

    // Before the job's minute plus the lead, the let-go looks again and holds on.
    // ⚑ Its minute is behind us, so the word is plain *scheduled*: no time is promised, and it is
    // not idle.
    app.clock = local(9, 28, 14, 45, 20)
    letGo()[0]?.fn()
    expect(letGo()).toHaveLength(2)
    expect(stateOf(app.host, a)).toEqual({ is: 'scheduled', dueAt: null })
    // ⚑ The zone moving reads its jobs again, and the watch holds on.
    app.host.placeTheWakeUpsAgain()
    await settle()
    expect(stateOf(app.host, a)).toEqual({ is: 'scheduled', dueAt: null })

    // Past it, with nothing said, the life holds none of them, and D-018 may count it again.
    app.clock = local(9, 28, 14, 45, 40)
    letGo().at(-1)?.fn()
    await settle()
    expect(stateOf(app.host, a)).toEqual({ is: 'idle' })
    expect(
      infoSpy.mock.calls.some(([line]) => String(line).includes('holds none of them now')),
    ).toBe(true)
    expect(liveCountdowns()).toBe(2)
  })

  it('a message that starts a stopped conversation plans its jobs again first, so a one-shot that passed since the wake-up was armed is told', async () => {
    const jobB: Job = { id: 'job-b', schedule: '15 16 28 9 *', recurring: false, prompt: 'ship it' }
    const [a, b] = await aFirstLife(
      async ([first, second]) => {
        await makes(first!, ONE_SHOT_A)
        await makes(second!, jobB)
      },
      'agent-a',
      'agent-b',
    )
    if (a === undefined || b === undefined) throw new Error('two conversations were opened')

    // Both armed at noon, neither started.
    restartsAt(local(9, 28, 12, 0))
    expect([...wakeUpsOf(app.host).keys()].sort()).toEqual([a, b].sort())
    expect(noticesIn(a)).toEqual([])

    // The Mac slept: no timer ran, and a person writes to both at ten to three.
    app.clock = local(9, 28, 14, 50)
    const toA = await app.host.startAndSend(a, 'hello', app.window)
    const toB = await app.host.startAndSend(b, 'hello', app.window)
    expect('notSent' in toA, JSON.stringify(toA)).toBe(false)
    expect('notSent' in toB, JSON.stringify(toB)).toBe(false)

    // A's one-shot passed since the wake-up was armed: told once…
    expect(heldNotices(a)).toHaveLength(1)
    expect(heldNotices(a)[0]?.text).toBe(theHeldNotice(DUE))
    // …its words are the start's first turn, sent once, and the person's own wait behind them.
    await waitFor(
      () =>
        ledger(a).some(
          (event) =>
            event.type === 'assistant_message' &&
            withoutWhatThisAppAdds(event.text) === `echo: ${theHeldNotice(DUE)}`,
        ),
      'A to be told as its start first turn',
    )
    const rowsOfA = ledger(a)
    const noticeTurn = rowsOfA.findIndex(
      (event) => event.type === 'user_turn' && event.text === theHeldNotice(DUE),
    )
    const helloHeld = rowsOfA.findIndex(
      (event) => event.type === 'message_queued' && event.text === 'hello',
    )
    expect(noticeTurn).toBeGreaterThan(-1)
    expect(helloHeld).toBeGreaterThan(noticeTurn)
    expect(rowsOfA.filter((event) => event.type === 'user_turn')).toHaveLength(1)
    expect(wakeUpsOf(app.host).has(a)).toBe(false)

    // B, the same start and the same message with its one-shot still ahead: nothing told, and the
    // person's words are its first turn.
    expect(noticesIn(b)).toEqual([])
    await waitFor(
      () =>
        ledger(b).some(
          (event) =>
            event.type === 'assistant_message' &&
            withoutWhatThisAppAdds(event.text).endsWith('\n\nhello'),
        ),
      'B to answer the person',
    )
    const rowsOfB = ledger(b)
    expect(rowsOfB.some((event) => event.type === 'user_turn' && event.text === 'hello')).toBe(true)
    expect(
      rowsOfB.some((event) => 'text' in event && String(event.text).includes('was due while')),
    ).toBe(false)
    expect(wakeUpsOf(app.host).has(b)).toBe(false)
  })
})
