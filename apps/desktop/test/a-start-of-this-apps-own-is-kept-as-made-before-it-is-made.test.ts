import { describe, expect, it, vi } from 'vitest'
import { THE_APP_ITSELF } from '../src/main/runtime/runtime-host'
import { scheduleAttemptsIn } from '../src/main/schedule-attempts-file'
import {
  aWakeUpApp,
  type Job,
  type KeptAttemptsRead,
  LATE,
  local,
  ONE_SHOT_A,
  settle,
  waitFor,
} from './helpers/scheduled-wake-up-fixture'

describe('D-029 · the host starts a stopped conversation in time for the jobs it scheduled', () => {
  const app = aWakeUpApp()
  const { aFirstLife, handlesOf, heldNotices, ledger, makes, restartsAt, timerCall, wakeUpsOf } =
    app

  it('🔴 what a start was made for is kept across restarts: told once, started once', async () => {
    const [a] = await aFirstLife(async ([first]) => makes(first!, ONE_SHOT_A), 'agent-a')
    if (a === undefined) throw new Error('a conversation was opened')
    const before = handlesOf(a).length

    restartsAt(local(9, 28, 15, 0))
    await waitFor(() => handlesOf(a).length === before + 1, 'A to be started')
    await waitFor(
      () => ledger(a).some((event) => event.type === 'user_turn'),
      'the held words to go in',
    )
    await settle()
    await app.host.closeAll()
    const kept = scheduleAttemptsIn(app.db).read().conversations[a]
    expect(kept?.attempts.some((one) => one.attempted)).toBe(true)
    expect(kept?.told).toHaveLength(1)

    // The app starts again ten minutes on: the same job, the same passed minute — nothing is told
    // again, and nothing is started again.
    restartsAt(local(9, 28, 15, 10))
    await settle()
    expect(wakeUpsOf(app.host).has(a)).toBe(false)
    expect(handlesOf(a)).toHaveLength(before + 1)
    expect(heldNotices(a)).toHaveLength(1)
    await app.host.closeAll()

    // ⚑ The control: without what was kept, the same launch starts it again — so the kept attempts
    // are what held it back.
    scheduleAttemptsIn(app.db).write({ conversations: {} })
    restartsAt(local(9, 28, 15, 20))
    await waitFor(() => handlesOf(a).length === before + 2, 'A to be started without the file')
  })

  it('⛔ a start of this app’s own is made only on a plan made as it begins: with none, it is put off, and a person’s start still goes on', async () => {
    const [a] = await aFirstLife(async ([first]) => makes(first!, ONE_SHOT_A), 'agent-a')
    if (a === undefined) throw new Error('a conversation was opened')
    const before = handlesOf(a).length

    restartsAt(LATE)
    // The wake-up's own look at the plan passes; the look made as the start begins finds none.
    const planning = app.host as unknown as { planItsWake: (id: string, now: number) => unknown }
    const really = planning.planItsWake.bind(app.host)
    let looks = 0
    vi.spyOn(planning, 'planItsWake').mockImplementation((id, now) =>
      looks++ === 0 ? really(id, now) : null,
    )
    await waitFor(() => wakeUpsOf(app.host).get(a)?.failed === 1, 'the start to be put off')
    expect(handlesOf(a)).toHaveLength(before)

    // ⚑ A person writes to it: that start is theirs, and goes on with no plan.
    const sent = await app.host.startAndSend(a, 'hello', app.window)
    expect('notSent' in sent, JSON.stringify(sent)).toBe(false)
    await waitFor(() => handlesOf(a).length === before + 1, 'A to be started by the person')
  })

  it('🔴 a start of its own is kept as made before the provider is asked: a restart meanwhile makes no second one, and a start that fails is put back and tried again', async () => {
    const { control, db } = app
    const [a] = await aFirstLife(async ([first]) => makes(first!, ONE_SHOT_A), 'agent-a')
    if (a === undefined) throw new Error('a conversation was opened')
    const before = handlesOf(a).length
    const attemptedIn = (): boolean =>
      scheduleAttemptsIn(db)
        .read()
        .conversations[a]?.attempts.some((one) => one.attempted) === true

    // A start that fails: what was kept is put back, so the start is asked for again.
    control.failResume = true
    restartsAt(LATE)
    await waitFor(() => wakeUpsOf(app.host).get(a)?.failed === 1, 'the start to fail')
    expect(attemptedIn()).toBe(false)

    // Held while the provider comes up: the start is already kept as made…
    control.failResume = false
    let release = (): void => {}
    control.holdResume = new Promise<void>((resolve) => {
      release = resolve
    })
    app.clock += 60_000
    timerCall(wakeUpsOf(app.host).get(a)?.timer ?? null).fn()
    await waitFor(() => control.resumedAt.length > 0, 'the provider to be asked')
    expect(attemptedIn()).toBe(true)
    // …so a host that starts meanwhile, from the file, makes no second start.
    const first = app.host
    restartsAt(app.clock + 1_000)
    await settle()
    expect(wakeUpsOf(app.host).has(a)).toBe(false)
    control.holdResume = undefined
    release()
    await waitFor(() => handlesOf(a).length === before + 1, 'the held start to come up')
    expect(first).not.toBe(app.host)
  })

  it('🔴 a start of its own is kept as made from the plan made as it begins: a job that came due since it was reserved is kept as started for too', async () => {
    const { control, db } = app
    const LATER: Job = {
      id: 'job-later',
      schedule: '46 14 28 9 *',
      recurring: false,
      prompt: 'then this',
    }
    const [a] = await aFirstLife(async ([first]) => makes(first!, ONE_SHOT_A, LATER), 'agent-a')
    if (a === undefined) throw new Error('a conversation was opened')
    const before = handlesOf(a).length
    const consumed = (): Set<string> =>
      new Set(
        (scheduleAttemptsIn(db).read().conversations[a]?.attempts ?? [])
          .filter((one) => one.attempted)
          .map((one) => one.key),
      )
    // The provider is held as it comes up, so the file can be read before it is.
    let release = (): void => {}
    control.holdResume = new Promise<void>((resolve) => {
      release = resolve
    })
    restartsAt(LATE)
    // The last look before the start is made a minute on: LATER's start has come due meanwhile.
    const looking = app.host as unknown as { judgeItsWakeUpAgain(id: string): boolean }
    const look = looking.judgeItsWakeUpAgain.bind(app.host)
    vi.spyOn(looking, 'judgeItsWakeUpAgain').mockImplementation((id) => {
      app.clock = local(9, 28, 14, 45, 31)
      return look(id)
    })
    await waitFor(() => control.resumedAt.length > 0, 'the provider to be asked')
    // ⚑ Both are kept as started for before the provider is up.
    expect(consumed()).toContain(JSON.stringify(['job', ONE_SHOT_A.id]))
    expect(consumed()).toContain(JSON.stringify(['job', LATER.id]))
    control.holdResume = undefined
    release()
    await waitFor(() => handlesOf(a).length === before + 1, 'A to be started')
    await settle()
    // …and a host rebuilt from the file, with no listing since and LATER's minute still ahead,
    // starts nothing for either.
    await app.host.close(a, THE_APP_ITSELF)
    await app.host.closeAll()
    restartsAt(local(9, 28, 14, 45, 40))
    await settle()
    expect(wakeUpsOf(app.host).has(a)).toBe(false)
    expect(handlesOf(a)).toHaveLength(before + 1)
  })

  it('⛔ the last look’s plan asks more than was reserved, and that cannot be kept: no start is made', async () => {
    const LATER: Job = {
      id: 'job-later',
      schedule: '46 14 28 9 *',
      recurring: false,
      prompt: 'then this',
    }
    const [a] = await aFirstLife(async ([first]) => makes(first!, ONE_SHOT_A, LATER), 'agent-a')
    if (a === undefined) throw new Error('a conversation was opened')
    const before = handlesOf(a).length
    restartsAt(LATE)
    const looking = app.host as unknown as { judgeItsWakeUpAgain(id: string): boolean }
    const look = looking.judgeItsWakeUpAgain.bind(app.host)
    vi.spyOn(looking, 'judgeItsWakeUpAgain').mockImplementation((id) => {
      app.clock = local(9, 28, 14, 45, 31)
      app.control.attemptsCannotBeKept = true
      return look(id)
    })
    await waitFor(() => wakeUpsOf(app.host).get(a)?.failed === 1, 'the start to be put off')
    expect(handlesOf(a)).toHaveLength(before)
    expect(app.control.resumedAt).toEqual([])
  })

  it('⛔ a start that fails, whose put-back cannot be written, stays kept as made — here and after a restart: no second start for it', async () => {
    const { control, db, warnSpy } = app
    const [a] = await aFirstLife(async ([first]) => makes(first!, ONE_SHOT_A), 'agent-a')
    if (a === undefined) throw new Error('a conversation was opened')
    const before = handlesOf(a).length
    control.failResume = true
    control.diskFillsOnResume = true
    restartsAt(LATE)
    await waitFor(() => wakeUpsOf(app.host).get(a)?.failed === 1, 'the start to fail')
    expect(warnSpy.mock.calls.some(([line]) => String(line).includes('stays kept as made'))).toBe(
      true,
    )
    const job = JSON.stringify(['job', ONE_SHOT_A.id])
    const attemptedIn = (kept: KeptAttemptsRead): boolean =>
      kept.conversations[a]?.attempts.some((one) => one.key === job && one.attempted) === true
    // Kept as made in this host's memory…
    expect(
      attemptedIn((app.host as unknown as { attemptsKept: KeptAttemptsRead }).attemptsKept),
    ).toBe(true)
    // …and on disk…
    expect(attemptedIn(scheduleAttemptsIn(db).read())).toBe(true)
    // …so a host rebuilt from the file, the job's minute still ahead, starts nothing for it.
    control.failResume = false
    control.diskFillsOnResume = false
    control.attemptsCannotBeKept = false
    await app.host.closeAll()
    restartsAt(LATE + 5_000)
    await settle()
    expect(wakeUpsOf(app.host).has(a)).toBe(false)
    expect(handlesOf(a)).toHaveLength(before)
  })

  it('⛔ while what it does cannot be kept, it makes no start of its own — a restart would make it again — and it tries later', async () => {
    const { control, warnSpy } = app
    const [a] = await aFirstLife(async ([first]) => makes(first!, ONE_SHOT_A), 'agent-a')
    if (a === undefined) throw new Error('a conversation was opened')
    const before = handlesOf(a).length

    control.attemptsCannotBeKept = true
    restartsAt(LATE)
    await waitFor(() => wakeUpsOf(app.host).get(a)?.failed === 1, 'the start to be put off')
    expect(handlesOf(a)).toHaveLength(before)
    expect(warnSpy.mock.calls.some(([line]) => String(line).includes('cannot be kept'))).toBe(true)

    // It can be kept again: the next try makes the start.
    control.attemptsCannotBeKept = false
    app.clock += 60_000
    timerCall(wakeUpsOf(app.host).get(a)?.timer ?? null).fn()
    await waitFor(() => handlesOf(a).length === before + 1, 'A to be started once it can be kept')
  })
})
