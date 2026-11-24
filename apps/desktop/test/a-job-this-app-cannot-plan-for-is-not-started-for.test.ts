import { describe, expect, it, vi } from 'vitest'
import { THE_APP_ITSELF } from '../src/main/runtime/runtime-host'
import { scheduleAttemptsIn } from '../src/main/schedule-attempts-file'
import {
  aWakeUpApp,
  LATE,
  LEAD,
  local,
  NIGHTLY,
  ONE_SHOT_A,
  settle,
  waitFor,
} from './helpers/scheduled-wake-up-fixture'

describe('D-029 · the host starts a stopped conversation in time for the jobs it scheduled', () => {
  const app = aWakeUpApp()
  const {
    aFirstLife,
    aLongStretchOfWork,
    doubleOf,
    handlesOf,
    heldNotices,
    ledger,
    lists,
    makes,
    newestLevel,
    NOT_LISTED_SINCE_A_RESET,
    NOT_READ_IN_FULL,
    opens,
    restartsAt,
    stateOf,
    TIME_NOT_KNOWN,
    wakeUpsOf,
  } = app

  it('⚑ a job of unknown time made again by its agent is planned afresh: in time for its next run, and not at once again', async () => {
    const [a] = await aFirstLife(async ([first]) => lists(first!, NIGHTLY), 'agent-a')
    if (a === undefined) throw new Error('a conversation was opened')
    const before = handlesOf(a).length
    restartsAt(local(9, 28, 12, 0))
    await waitFor(() => handlesOf(a).length === before + 1, 'A to be started, once')
    await settle()
    // Told it cannot be timed, its agent makes it again: a call this app sees, so its time is known.
    await makes(a, NIGHTLY)
    expect(newestLevel(a)).not.toHaveProperty('jobs.0.notStarted')
    await app.host.close(a, THE_APP_ITSELF)
    await settle()
    expect(wakeUpsOf(app.host).get(a)?.startAt).toBe(local(9, 29, 3, 0) - LEAD)
    expect(handlesOf(a)).toHaveLength(before + 1)
  })

  it('⛔ a reset seen while its evidence is not held, and the first read of it fails: no start is made on what came before', async () => {
    const { store, window } = app
    app.clock = local(9, 28, 12, 0)
    const f = await opens('agent-f')
    await makes(f, NIGHTLY)
    // Its evidence is no longer held, and the next read of it fails.
    ;(app.host as unknown as { scheduleEvidence: Map<string, unknown> }).scheduleEvidence.delete(f)
    vi.spyOn(store, 'scheduleEvidenceRows').mockImplementationOnce(() => {
      throw new Error('the database is busy')
    })
    doubleOf(f).simulateConversationReset()
    await settle()
    // ⚑ The reset was taken: its mark is in the ledger.
    expect(
      ledger(f).some(
        (event) => event.type === 'scheduled_work' && (event as { reset?: boolean }).reset === true,
      ),
    ).toBe(true)
    await app.host.close(f, THE_APP_ITSELF)
    await settle()
    expect(wakeUpsOf(app.host).has(f)).toBe(false)
    // Evicted and read again: still nothing.
    ;(app.host as unknown as { scheduleEvidence: Map<string, unknown> }).scheduleEvidence.delete(f)
    app.host.placeTheWakeUpsAgain()
    await settle()
    expect(wakeUpsOf(app.host).has(f)).toBe(false)
    await app.host.closeAll()
    restartsAt(local(9, 28, 13, 0))
    await settle()
    expect(wakeUpsOf(app.host).has(f)).toBe(false)
    expect(handlesOf(f)).toHaveLength(1)
    // A later listing by its provider gives the job back its time.
    const sent = await app.host.startAndSend(f, 'hello', window)
    expect('notSent' in sent, JSON.stringify(sent)).toBe(false)
    await waitFor(() => handlesOf(f).length === 2, 'F to be started by the message')
    await settle()
    await lists(f, NIGHTLY)
    expect(newestLevel(f)).toMatchObject({
      jobs: [{ id: 'nightly', nominalAt: local(9, 29, 3, 0) }],
    })
  })

  it('⛔ its provider’s conversation reset and the mark could not be written: no start is made on what came before, and a restart reads the same', async () => {
    const { db, store } = app
    app.clock = local(9, 28, 12, 0)
    const f = await opens('agent-f')
    await makes(f, NIGHTLY)
    const append = store.append.bind(store)
    const failing = vi.spyOn(store, 'append').mockImplementation((id, ordinal, event, at) => {
      if (event.type === 'scheduled_work' && (event as { reset?: boolean }).reset === true) {
        throw new Error('the disk is full')
      }
      return append(id, ordinal, event, at)
    })
    doubleOf(f).simulateConversationReset()
    await settle()
    expect(scheduleAttemptsIn(db).read().conversations[f]?.resetUnmarkedAt).toBeDefined()
    await app.host.close(f, THE_APP_ITSELF)
    await settle()
    expect(wakeUpsOf(app.host).has(f)).toBe(false)

    failing.mockRestore()
    await app.host.closeAll()
    restartsAt(local(9, 28, 13, 0))
    await settle()
    expect(wakeUpsOf(app.host).has(f)).toBe(false)
    expect(handlesOf(f)).toHaveLength(1)
  })

  it('⛔ a history read only in part, with no level of its provider’s in it: nothing is started or cut, and each job it last held says why', async () => {
    const [a] = await aFirstLife(async ([first]) => makes(first!, NIGHTLY), 'agent-a')
    if (a === undefined) throw new Error('a conversation was opened')
    aLongStretchOfWork(a, local(9, 28, 11, 55))
    const before = handlesOf(a).length

    restartsAt(local(9, 28, 12, 0))
    await settle()
    expect(wakeUpsOf(app.host).has(a)).toBe(false)
    expect(handlesOf(a)).toHaveLength(before)
    const said = newestLevel(a) as {
      jobs?: { id: string; notStarted?: string; nominalAt?: number }[]
    }
    expect(said).toMatchObject({
      source: 'app/receipts',
      jobs: [{ id: 'nightly', notStarted: 'history-not-read-in-full' }],
    })
    expect(said.jobs?.[0]?.nominalAt).toBeUndefined()
    expect(heldNotices(a).at(-1)?.text).toBe(
      `Your scheduled job (“run the nightly check”) ${NOT_READ_IN_FULL}`,
    )

    // A person writes to it and its provider lists the job: a level is read again, and the job is
    // planned from it — known only from where it is listed, as its making is past the rows read.
    const sent = await app.host.startAndSend(a, 'hello', app.window)
    expect('notSent' in sent, JSON.stringify(sent)).toBe(false)
    await waitFor(() => handlesOf(a).length === before + 1, 'A to be started by the message')
    await settle()
    await lists(a, NIGHTLY)
    expect(newestLevel(a)).not.toMatchObject({
      jobs: [{ notStarted: 'history-not-read-in-full' }],
    })
  })

  it('⛔ a one-shot already started for, whose making is no longer among the rows read: it looks new, and is not started for again', async () => {
    const [a] = await aFirstLife(async ([first]) => makes(first!, ONE_SHOT_A), 'agent-a')
    if (a === undefined) throw new Error('a conversation was opened')
    const before = handlesOf(a).length
    restartsAt(LATE)
    await waitFor(() => handlesOf(a).length === before + 1, 'A to be started once')
    await settle()
    // A long stretch of work, then its provider lists the job: the level is read, the making not.
    aLongStretchOfWork(a, app.clock)
    await lists(a, ONE_SHOT_A)
    await app.host.closeAll()

    restartsAt(app.clock + 5_000)
    await settle()
    expect(wakeUpsOf(app.host).has(a)).toBe(false)
    expect(handlesOf(a)).toHaveLength(before + 1)
    expect(newestLevel(a)).toMatchObject({
      jobs: [{ id: ONE_SHOT_A.id, notStarted: 'history-not-read-in-full' }],
    })
  })

  it('🔴 a job this app has no receipt for has no known time: one start, at once, and its state names no time', async () => {
    const [a] = await aFirstLife(async ([first]) => lists(first!, NIGHTLY), 'agent-a')
    if (a === undefined) throw new Error('a conversation was opened')
    const before = handlesOf(a).length

    restartsAt(local(9, 28, 12, 0))
    // ⛔ No time is shown that is not known.
    expect(stateOf(app.host, a)).toEqual({ is: 'scheduled', dueAt: null })
    expect(wakeUpsOf(app.host).get(a)?.startAt).toBeLessThanOrEqual(app.clock)
    await waitFor(() => handlesOf(a).length === before + 1, 'A to be started once')
    await settle()
    // ⚑ With that one start it is told that this app will make no other for the job.
    expect(heldNotices(a).map((one) => one.text)).toEqual([
      `Your scheduled job (“run the nightly check”) ${TIME_NOT_KNOWN}`,
    ])
    await app.host.closeAll()

    // The next launch finds the same job, unchanged, and a start already made for it: none again.
    restartsAt(local(9, 28, 12, 30))
    await settle()
    expect(wakeUpsOf(app.host).has(a)).toBe(false)
    expect(handlesOf(a)).toHaveLength(before + 1)
    // ⚑ …told once, and its ledger says on the job's own row that it is not started for.
    expect(heldNotices(a)).toHaveLength(1)
    expect(newestLevel(a)).toMatchObject({
      source: 'app/receipts',
      jobs: [{ id: 'nightly', notStarted: 'time-not-known' }],
    })
  })

  it('⛔ a job of unknown time is started for once, however often its provider lists it again unchanged', async () => {
    const [a] = await aFirstLife(async ([first]) => lists(first!, NIGHTLY), 'agent-a')
    if (a === undefined) throw new Error('a conversation was opened')
    const before = handlesOf(a).length

    restartsAt(local(9, 28, 12, 0))
    await waitFor(() => handlesOf(a).length === before + 1, 'A to be started, once')
    await settle()
    // Its provider lists the same job in the new life: still no call seen, still no known time.
    await lists(a, NIGHTLY)
    expect(newestLevel(a)).toMatchObject({
      source: 'app/receipts',
      jobs: [{ id: 'nightly', notStarted: 'time-not-known' }],
    })
    await app.host.close(a, THE_APP_ITSELF)
    await settle()
    expect(wakeUpsOf(app.host).has(a)).toBe(false)

    // …and a restart finds the same: nothing about the job changed, so nothing is started.
    await app.host.closeAll()
    restartsAt(local(9, 28, 13, 0))
    await settle()
    expect(wakeUpsOf(app.host).has(a)).toBe(false)
    expect(handlesOf(a)).toHaveLength(before + 1)
  })

  it('⛔ its provider’s conversation is reset and it stops with no level since: no start is made on what was recorded before the reset — until its provider lists the job again', async () => {
    app.clock = local(9, 28, 12, 0)
    const f = await opens('agent-f')
    await makes(f, NIGHTLY)
    // The control: stopped now, it would be started for the job's next run.
    doubleOf(f).simulateConversationReset()
    await waitFor(
      () => ledger(f).some((event) => event.type === 'scheduled_work' && 'reset' in event),
      'the reset to be marked',
    )
    await settle()
    // ⚑ Said at once on the job's own row, while the conversation is still open.
    expect(newestLevel(f)).toMatchObject({
      source: 'app/receipts',
      jobs: [{ id: 'nightly', notStarted: 'no-word-since-a-reset' }],
    })

    await app.host.close(f, THE_APP_ITSELF)
    await settle()
    // ⛔ No wake-up: nothing says the job outlived the reset.
    expect(wakeUpsOf(app.host).has(f)).toBe(false)
    expect(stateOf(app.host, f)).toEqual({ is: 'idle' })
    expect(heldNotices(f).at(-1)?.text).toBe(
      `Your scheduled job (“run the nightly check”) ${NOT_LISTED_SINCE_A_RESET}`,
    )
    // …and a restart finds the same.
    await app.host.closeAll()
    restartsAt(local(9, 28, 13, 0))
    await settle()
    expect(wakeUpsOf(app.host).has(f)).toBe(false)
    expect(handlesOf(f)).toHaveLength(1)

    // A person writes to it, and its provider lists the job: it outlived the reset, its time is
    // as known as before, and a stop is woken in time for its next run.
    const sent = await app.host.startAndSend(f, 'hello', app.window)
    expect('notSent' in sent, JSON.stringify(sent)).toBe(false)
    await waitFor(() => handlesOf(f).length === 2, 'F to be started by the message')
    await settle()
    await lists(f, NIGHTLY)
    expect(newestLevel(f)).not.toHaveProperty('jobs.0.notStarted')
    // ⚑ Its time is known again: what it says of the job, open or stopped, is its next run.
    expect(newestLevel(f)).toMatchObject({
      jobs: [{ id: 'nightly', nominalAt: local(9, 29, 3, 0) }],
    })
    await app.host.close(f, THE_APP_ITSELF)
    await settle()
    expect(newestLevel(f)).not.toHaveProperty('jobs.0.notStarted')
  })
})
