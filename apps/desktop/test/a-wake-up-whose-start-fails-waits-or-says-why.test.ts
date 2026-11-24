import { describe, expect, it, vi } from 'vitest'
import { FakeSessionHandle } from '@brobot2/runtime'
import { THE_APP_ITSELF } from '../src/main/runtime/runtime-host'
import {
  aWakeUpApp,
  DUE,
  fakeKeys,
  LATE,
  LEAD,
  local,
  NIGHTLY,
  ONE_SHOT_A,
  settle,
  waitFor,
  type WordsInARow,
} from './helpers/scheduled-wake-up-fixture'

describe('D-029 · the host starts a stopped conversation in time for the jobs it scheduled', () => {
  const app = aWakeUpApp()
  const {
    aFirstLife,
    handlesOf,
    heldNotices,
    ledger,
    makes,
    restartsAt,
    stateOf,
    theHeldNotice,
    timerCall,
    wakeUpsOf,
    wordsIn,
  } = app

  it('⚑ words handed to a start whose first send fails are not lost: they wait, and the next start says them', async () => {
    const [a] = await aFirstLife(async ([first]) => makes(first!, ONE_SHOT_A), 'agent-a')
    if (a === undefined) throw new Error('a conversation was opened')
    const before = handlesOf(a).length
    const send = vi
      .spyOn(FakeSessionHandle.prototype, 'send')
      .mockRejectedValueOnce(new Error('the provider went away'))
    restartsAt(local(9, 28, 15, 0))
    await waitFor(() => handlesOf(a).length === before + 1, 'A to be started')
    await settle()
    const told = (): boolean =>
      ledger(a).some(
        (event) => event.type === 'user_turn' && (event as WordsInARow).appNotice !== undefined,
      )
    // ⚑ Kept as told when the start was made; not yet said.
    expect(told()).toBe(false)
    expect(heldNotices(a)).toHaveLength(1)
    send.mockRestore()
    await app.host.close(a, THE_APP_ITSELF)
    await settle()
    // The next start, whoever makes it, says them.
    const sent = await app.host.startAndSend(a, 'hello', app.window)
    expect('notSent' in sent, JSON.stringify(sent)).toBe(false)
    await waitFor(told, 'the held words to be said')
  })

  it('⛔ a start refused because the saved key cannot be read waits for the key to change: no read on a timer, a relaunch reads it once, and one start once it is saved again', async () => {
    const [a] = await aFirstLife(async ([first]) => makes(first!, ONE_SHOT_A), 'agent-a')
    if (a === undefined) throw new Error('a conversation was opened')
    const before = handlesOf(a).length
    const keys = fakeKeys()
    app.control.keys = keys
    restartsAt(LATE)
    await waitFor(
      () => wakeUpsOf(app.host).get(a)?.waitingForItsKey === 'claude',
      'A to wait for its key',
    )
    expect(keys.reads).toBe(1)
    // ⛔ No timer at all: nothing will read the key again on its own.
    expect(wakeUpsOf(app.host).get(a)?.timer).toBeNull()
    // The Providers card's own fact is untouched.
    expect(await app.host.apiKeyStatus('claude')).toMatchObject({ readState: 'unreadable' })

    // A relaunch, the key still unreadable: read once, then it waits again; the back-off is not
    // started over.
    await app.host.closeAll()
    // A new process knows nothing of the read before it.
    keys.knownUnreadable = false
    restartsAt(LATE + 1_000)
    await waitFor(
      () => wakeUpsOf(app.host).get(a)?.waitingForItsKey === 'claude',
      'A to wait again',
    )
    expect(keys.reads).toBe(2)
    expect(wakeUpsOf(app.host).get(a)?.timer).toBeNull()
    // Across what the old back-off would have tried (1, 2, 4 and 8 minutes on), no read.
    app.clock += 16 * 60_000
    await settle()
    expect(keys.reads).toBe(2)
    expect(handlesOf(a)).toHaveLength(before)

    // Saved again: the start it is owed is made, once.
    await app.host.setApiKey('claude', 'sk-ant-api03-saved-again')
    await waitFor(() => handlesOf(a).length === before + 1, 'A to be started once its key is saved')
    await settle()
    expect(handlesOf(a)).toHaveLength(before + 1)
  })

  it('⚑ a person’s own start is not held back while a wake-up waits for the saved key', async () => {
    const { control, window } = app
    const [a] = await aFirstLife(async ([first]) => makes(first!, ONE_SHOT_A), 'agent-a')
    if (a === undefined) throw new Error('a conversation was opened')
    const keys = fakeKeys()
    control.keys = keys
    restartsAt(LATE)
    await waitFor(
      () => wakeUpsOf(app.host).get(a)?.waitingForItsKey === 'claude',
      'A to wait for its key',
    )
    const reads = keys.reads
    // The person writes to it: that start is made, and reads the key as any launch does.
    await app.host.startAndSend(a, 'hello', window).catch(() => undefined)
    await settle()
    expect(keys.reads).toBeGreaterThan(reads)
  })

  it.each([
    ['with a notice already held', true],
    ['with no notice held', false],
  ] as const)('records a missing provider file on scheduled wake %s', async (_, hadNotice) => {
    const { handles, issued, store, window } = app
    const [conversation] = await aFirstLife(async ([first]) => makes(first!, ONE_SHOT_A), 'agent-a')
    if (conversation === undefined) throw new Error('no conversation was opened')
    issued.forgetAll()
    const idsBefore = store.recorded().map(({ sessionId }) => sessionId)
    const handlesBefore = handles.length
    const onlyTheOriginal = () => {
      expect(wakeUpsOf(app.host).has(conversation)).toBe(false)
      expect(store.recorded().map(({ sessionId }) => sessionId)).toEqual(idsBefore)
      expect(store.replacements()).toEqual([])
      expect(handles.length).toBe(handlesBefore)
    }
    const detail =
      'This conversation could not wake: its provider session file is missing. Nothing ran.'
    restartsAt(local(9, 28, hadNotice ? 15 : 14, hadNotice ? 0 : 40))
    if (hadNotice) {
      await waitFor(
        () => ledger(conversation).some((event) => event.type === 'message_unqueued'),
        'the held notice to be ended',
      )
      const ended = ledger(conversation).find((event) => event.type === 'message_unqueued')
      expect(ended).toMatchObject({ reason: 'abandoned', detail, text: theHeldNotice(DUE) })
      await settle()
      expect(stateOf(app.host, conversation)).toEqual({ is: 'idle' })
      onlyTheOriginal()
      expect(await app.host.startAndSend(conversation, 'are you there', window)).toMatchObject({
        notSent: { refusedBy: 'the-start', running: null },
      })
      expect(wordsIn(conversation).some((one) => one.text.includes('are you there'))).toBe(false)
    } else {
      expect(heldNotices(conversation)).toEqual([])
      const wake = wakeUpsOf(app.host).get(conversation)
      expect(wake?.startAt).toBe(DUE - LEAD)
      app.clock = DUE - LEAD
      timerCall(wake?.timer ?? null).fn()
      await waitFor(
        () => ledger(conversation).some((row) => row.type === 'error' && row.message === detail),
        'the missing session wake row',
      )
      expect(ledger(conversation)).toContainEqual({ type: 'error', message: detail, fatal: false })
    }
    onlyTheOriginal()
  })

  it('a failed wake-up start is tried again after a minute, twice as long after each failure, up to half an hour', async () => {
    const { control, warnSpy } = app
    // First life at two in the morning: its provider makes a nightly job, then the quit.
    app.clock = local(9, 28, 2, 0)
    const [a] = await aFirstLife(async ([first]) => makes(first!, NIGHTLY), 'agent-a')
    if (a === undefined) throw new Error('a conversation was opened')
    const before = handlesOf(a).length

    // The machine cannot spawn a process; this morning's 03:00 has passed, so a start is owed.
    control.failResume = true
    restartsAt(local(9, 28, 12, 0))
    const wake = wakeUpsOf(app.host).get(a)
    if (wake === undefined) throw new Error('A holds no wake-up')
    expect(wake.startAt).toBeLessThanOrEqual(app.clock)
    await waitFor(() => wake.failed === 1, 'the first start to fail')
    // Tried again a minute on, on the same wake-up.
    expect(wake.startAt - app.clock).toBeGreaterThan(59_000)
    expect(wake.startAt - app.clock).toBeLessThanOrEqual(60_000)
    expect(wakeUpsOf(app.host).get(a)).toBe(wake)
    expect(handlesOf(a)).toHaveLength(before)
    // It is told, once, that a run may have been missed: nothing says whether it was.
    expect(heldNotices(a)).toHaveLength(1)
    expect(heldNotices(a)[0]?.text).toContain(
      'may have missed one or more runs while this conversation was stopped',
    )

    // Each failure doubles the wait: 2, 4, 8 and 16 minutes, then the half hour, and the half hour.
    const waits = [120_000, 240_000, 480_000, 960_000, 1_800_000, 1_800_000]
    for (const [index, expected] of waits.entries()) {
      app.clock = wake.startAt + 1_000
      timerCall(wake.timer).fn()
      await waitFor(() => wake.failed === index + 2, `start ${String(index + 2)} to fail`)
      expect(wake.startAt - app.clock, `after failure ${String(index + 2)}`).toBeGreaterThan(
        expected - 1_000,
      )
      expect(wake.startAt - app.clock, `after failure ${String(index + 2)}`).toBeLessThanOrEqual(
        expected,
      )
      expect(
        warnSpy.mock.calls.some(([line]) =>
          String(line).includes(`tries again in ${String(expected)}ms`),
        ),
      ).toBe(true)
    }
    expect(heldNotices(a)).toHaveLength(1)

    // The paired positive: the same wake-up, once the machine can spawn, starts and is taken.
    control.failResume = false
    app.clock = wake.startAt + 1_000
    timerCall(wake.timer).fn()
    await waitFor(() => handlesOf(a).length === before + 1, 'A to be started at last')
    await settle()
    expect(wakeUpsOf(app.host).has(a)).toBe(false)
  })
})
