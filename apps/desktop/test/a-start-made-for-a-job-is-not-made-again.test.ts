import { describe, expect, it } from 'vitest'
import { THE_APP_ITSELF } from '../src/main/runtime/runtime-host'
import { scheduleAttemptsIn } from '../src/main/schedule-attempts-file'
import {
  aWakeUpApp,
  type Job,
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
    handlesOf,
    heldNotices,
    lists,
    makes,
    newestLevel,
    NO_LONGER_STARTED,
    noticesIn,
    opens,
    restartsAt,
    runningOf,
    stateOf,
    timerCall,
    wakeUpsOf,
  } = app

  /** A one-shot two months ahead: its minute never comes in the cases below. */
  const FAR_AHEAD: Job = {
    id: 'job-far',
    schedule: '45 14 28 11 *',
    recurring: false,
    prompt: 'look at the nightly run',
  }
  /** A person starts it, its provider lists no job, and the app is quit with it still up. */
  const aLifeThatListsNothingAt = async (id: string, moment: number): Promise<void> => {
    restartsAt(moment)
    await settle()
    await app.host.startAndSend(id, 'hello', app.window)
    await settle()
    await lists(id)
    await app.host.closeAll()
  }
  /** The same, but the conversation stops with the app still up: its jobs are planned then. */
  const aLifeThatStopsAt = async (id: string, moment: number): Promise<void> => {
    restartsAt(moment)
    await settle()
    await app.host.startAndSend(id, 'hello', app.window)
    await settle()
    await lists(id)
    await app.host.close(id, THE_APP_ITSELF)
    await settle()
  }
  const keptAsDealtWith = (id: string) =>
    (scheduleAttemptsIn(app.db).read().conversations[id]?.told ?? []).map((one) => one.said)

  it('⚑ a job a start did not bring back over a day ago, with the conversation started twice since, gets no word and no start, now or two launches later', async () => {
    const [a] = await aFirstLife(async ([first]) => makes(first!, FAR_AHEAD), 'agent-a')
    if (a === undefined) throw new Error('a conversation was opened')
    // The start that did not bring it back, at noon; then one more life that day.
    await aLifeThatListsNothingAt(a, local(9, 28, 12, 0))
    await aLifeThatListsNothingAt(a, local(9, 28, 13, 0))
    expect(keptAsDealtWith(a)).toEqual([])

    // Three days on it runs and stops: nothing is held for it, and nothing will start it.
    await aLifeThatStopsAt(a, local(10, 1, 12, 0))
    const lives = handlesOf(a).length
    expect(noticesIn(a)).toEqual([])
    expect(wakeUpsOf(app.host).has(a)).toBe(false)
    // ⚑ Kept as dealt with, with no word said: no later plan raises it.
    expect(keptAsDealtWith(a)).toEqual([false])
    await app.host.closeAll()

    for (const moment of [local(10, 1, 12, 30), local(10, 2, 9, 0)]) {
      await aLifeThatStopsAt(a, moment)
      expect(noticesIn(a)).toEqual([])
      expect(wakeUpsOf(app.host).has(a)).toBe(false)
      await app.host.closeAll()
    }
    // ⛔ Every life since was a person's own.
    expect(handlesOf(a)).toHaveLength(lives + 2)
    expect(keptAsDealtWith(a)).toEqual([false])
  })

  it('🔴 …and the same job is told where that stop is the first since it left, however long the app was closed: the app starts the conversation to say it, once', async () => {
    const [a] = await aFirstLife(async ([first]) => makes(first!, FAR_AHEAD), 'agent-a')
    if (a === undefined) throw new Error('a conversation was opened')
    // The start that did not bring it back; the app is quit with it up, so nothing plans for it.
    await aLifeThatListsNothingAt(a, local(9, 28, 12, 0))

    // ⚑ A launch plans only for a conversation whose newest level holds a job: nothing yet.
    restartsAt(local(10, 1, 12, 0))
    await settle()
    expect(wakeUpsOf(app.host).has(a)).toBe(false)
    expect(noticesIn(a)).toEqual([])
    await app.host.closeAll()

    restartsAt(local(10, 1, 12, 5))
    await settle()
    await app.host.startAndSend(a, 'hello', app.window)
    await settle()
    await lists(a)
    const lives = handlesOf(a).length
    await app.host.close(a, THE_APP_ITSELF)
    await waitFor(() => handlesOf(a).length === lives + 1, 'the app to start it to say so')
    expect(heldNotices(a)).toHaveLength(1)
    expect(heldNotices(a)[0]?.text).toContain('look at the nightly run')
    await waitFor(
      () => noticesIn(a).some((one) => one.type === 'user_turn'),
      'the held words to go in',
    )
    await settle()
    expect(keptAsDealtWith(a)).toEqual([true])
    await app.host.closeAll()

    // Told once: a later life is told nothing more, and nothing starts it.
    await aLifeThatStopsAt(a, local(10, 3, 9, 0))
    expect(noticesIn(a).filter((one) => one.type === 'user_turn')).toHaveLength(1)
    expect(heldNotices(a)).toHaveLength(1)
    expect(wakeUpsOf(app.host).has(a)).toBe(false)
    expect(handlesOf(a)).toHaveLength(lives + 2)
  })

  it('⛔ a conversation woken for its job that stops before its provider says anything is not woken again; one whose provider listed the job again is', async () => {
    const jobB: Job = { ...ONE_SHOT_A, id: 'job-b' }
    const [a, b] = await aFirstLife(
      async ([first, second]) => {
        await makes(first!, ONE_SHOT_A)
        await makes(second!, jobB)
      },
      'agent-a',
      'agent-b',
    )
    if (a === undefined || b === undefined) throw new Error('two conversations were opened')
    const before = { a: handlesOf(a).length, b: handlesOf(b).length }

    restartsAt(LATE)
    await waitFor(
      () => handlesOf(a).length === before.a + 1 && handlesOf(b).length === before.b + 1,
      'both to be started for their jobs',
    )
    await settle()

    // B's provider lists its job again: it brought the job back, and runs it from here.
    await lists(b, jobB)

    await app.host.close(a, THE_APP_ITSELF)
    await app.host.close(b, THE_APP_ITSELF)

    // B's provider brought the job back, so its stop is woken for it afresh.
    await waitFor(() => handlesOf(b).length === before.b + 2, 'B to be started again for its job')
    await settle()
    // A's provider never spoke: the start made for its job is not made a second time.
    expect(wakeUpsOf(app.host).has(a)).toBe(false)
    expect(stateOf(app.host, a)).toEqual({ is: 'idle' })
    expect(runningOf(a)).toBe('not-running')
    expect(handlesOf(a)).toHaveLength(before.a + 1)
  })

  it('🔴 a repeating job is started in time for each run, not at once because a run passed; and not run after run once a start did not bring it back', async () => {
    const [a] = await aFirstLife(async ([first]) => makes(first!, NIGHTLY), 'agent-a')
    if (a === undefined) throw new Error('a conversation was opened')
    const before = handlesOf(a).length

    // A run passed while it was stopped: that is told, at once.
    restartsAt(local(9, 29, 12, 0))
    await waitFor(() => handlesOf(a).length === before + 1, 'A to be started to be told')
    await settle()
    // ⚑ That start was made long before the next run, so it is not that run's: stopped now, it is
    // woken just before that run.
    await app.host.close(a, THE_APP_ITSELF)
    await settle()
    const wakeUp = wakeUpsOf(app.host).get(a)
    expect(wakeUp?.startAt).toBe(local(9, 30, 3, 0) - LEAD)
    expect(stateOf(app.host, a)).toEqual({ is: 'scheduled', dueAt: local(9, 30, 3, 0) })

    // Its time comes: it is started for that run.
    app.clock = local(9, 30, 3, 0) - LEAD
    timerCall(wakeUp?.timer ?? null).fn()
    await waitFor(() => handlesOf(a).length === before + 2, 'A to be started for its run')
    await settle()

    // All the time the run could take goes by, and its provider says nothing of the job: it did not
    // bring it back.
    app.clock = local(9, 30, 3, 31)
    await app.host.close(a, THE_APP_ITSELF)
    await settle()
    // ⛔ So no start is made for the run after.
    expect(wakeUpsOf(app.host).has(a)).toBe(false)
    expect(handlesOf(a)).toHaveLength(before + 2)
    // ⚑ Never silently: the job's own row says so, and the words wait for its next start.
    expect(newestLevel(a)).toMatchObject({
      source: 'app/receipts',
      jobs: [{ id: 'nightly', notStarted: 'no-word-from-its-provider' }],
    })
    expect(heldNotices(a).at(-1)?.text).toBe(
      `Your scheduled job (“run the nightly check”) ${NO_LONGER_STARTED}`,
    )
  })

  it('⛔ a run whose minute has come, though it may yet run late, is told of once and never started for at once, life after life', async () => {
    const [a] = await aFirstLife(async ([first]) => makes(first!, NIGHTLY), 'agent-a')
    if (a === undefined) throw new Error('a conversation was opened')
    const before = handlesOf(a).length

    // Ten minutes after its minute, inside the half hour it may still run in: one start, to tell
    // it that a run may have been missed.
    restartsAt(local(9, 29, 3, 10))
    await waitFor(() => handlesOf(a).length === before + 1, 'A to be started to be told')
    await settle()
    // Its provider lists the job in that life, and the life stops: the start owed is the next
    // run's, a day on, and none at once.
    await lists(a, NIGHTLY)
    await app.host.close(a, THE_APP_ITSELF)
    await settle()
    expect(wakeUpsOf(app.host).get(a)?.startAt).toBe(local(9, 30, 3, 0) - LEAD)

    // …and the same at a restart, still inside that half hour.
    await app.host.closeAll()
    restartsAt(local(9, 29, 3, 20))
    await settle()
    expect(wakeUpsOf(app.host).get(a)?.startAt).toBe(local(9, 30, 3, 0) - LEAD)
    expect(handlesOf(a)).toHaveLength(before + 1)
    expect(heldNotices(a)).toHaveLength(1)
  })

  it('⚑ a life started for a run that stops before the run leaves the next run owed, and is not started again for that one', async () => {
    app.clock = local(9, 28, 12, 0)
    const f = await opens('agent-f')
    await makes(f, NIGHTLY)
    await app.host.close(f, THE_APP_ITSELF)
    await settle()
    const wakeUp = wakeUpsOf(app.host).get(f)
    expect(wakeUp?.startAt).toBe(local(9, 29, 3, 0) - LEAD)

    app.clock = local(9, 29, 3, 0) - LEAD
    timerCall(wakeUp?.timer ?? null).fn()
    await waitFor(() => handlesOf(f).length === 2, 'F to be started for its run')
    await settle()

    // Stopped ten seconds before the run: the start for that run was made, so the next is owed.
    app.clock = local(9, 29, 2, 59, 50)
    await app.host.close(f, THE_APP_ITSELF)
    await settle()
    expect(wakeUpsOf(app.host).get(f)?.startAt).toBe(local(9, 30, 3, 0) - LEAD)
    expect(handlesOf(f)).toHaveLength(2)
    // ⚑ Its time is the run it will be started for, not the one ten seconds off that it will miss.
    expect(stateOf(app.host, f)).toEqual({ is: 'scheduled', dueAt: local(9, 30, 3, 0) })
  })

  it('⛔ three starts of this app’s own in a row with no word of the job from its provider: no more are made for it, and it says so', async () => {
    app.clock = local(9, 28, 12, 0)
    const f = await opens('agent-f')
    await makes(f, NIGHTLY)
    await app.host.close(f, THE_APP_ITSELF)
    await settle()

    for (const day of [29, 30, 31]) {
      const wakeUp = wakeUpsOf(app.host).get(f)
      expect(wakeUp?.startAt, `the run of the ${String(day)}th`).toBe(local(9, day, 3, 0) - LEAD)
      const before = handlesOf(f).length
      app.clock = local(9, day, 3, 0) - LEAD
      timerCall(wakeUp?.timer ?? null).fn()
      await waitFor(() => handlesOf(f).length === before + 1, 'F to be started for its run')
      await settle()
      // Stopped before the run, its provider having said nothing of the job.
      app.clock = local(9, day, 2, 59, 50)
      await app.host.close(f, THE_APP_ITSELF)
      await settle()
    }
    expect(wakeUpsOf(app.host).has(f)).toBe(false)
    expect(handlesOf(f)).toHaveLength(4)
    expect(newestLevel(f)).toMatchObject({
      source: 'app/receipts',
      jobs: [{ id: 'nightly', notStarted: 'no-word-from-its-provider' }],
    })
    expect(heldNotices(f).at(-1)?.text).toContain(
      `Your scheduled job (“run the nightly check”) ${NO_LONGER_STARTED}`,
    )
    // ⚑ Its provider lists the job again, in a life a person began: it is started for once more.
    const sent = await app.host.startAndSend(f, 'hello', app.window)
    expect('notSent' in sent, JSON.stringify(sent)).toBe(false)
    await waitFor(() => handlesOf(f).length === 5, 'F to be started by the message')
    await settle()
    await lists(f, NIGHTLY)
    expect(newestLevel(f)).not.toHaveProperty('jobs.0.notStarted')
    expect(newestLevel(f)).toMatchObject({
      jobs: [{ id: 'nightly', nominalAt: local(10, 1, 3, 0) }],
    })
    await app.host.close(f, THE_APP_ITSELF)
    await settle()
    expect(newestLevel(f)).not.toHaveProperty('jobs.0.notStarted')
  })
})
