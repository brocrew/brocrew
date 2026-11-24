import type { TranscriptEvent } from '../src/shared/conversation-events'
import { describe, expect, it, vi } from 'vitest'
import { THE_APP_ITSELF } from '../src/main/runtime/runtime-host'
import type { RuntimeEventSink } from '../src/main/runtime/runtime-host'
import type { RuntimeEventMessage } from '../src/shared/runtime-ipc'
import { RecordingSink } from './lib/host-fixture'
import {
  aWakeUpApp,
  local,
  NIGHTLY,
  settle,
  waitFor,
  type WordsInARow,
} from './helpers/scheduled-wake-up-fixture'

describe('D-029 · the host starts a stopped conversation in time for the jobs it scheduled', () => {
  const app = aWakeUpApp()
  const { aFirstLife, doubleOf, handlesOf, makes, opens, restartsAt, wakeUpsOf } = app

  it('🔴 a window that has a stopped conversation open is shown the level and the words this app writes for it, as they are written; one that does not have it open is shown nothing, and nothing starts', async () => {
    const [f] = await aFirstLife(async ([first]) => makes(first!, NIGHTLY), 'agent-f')
    if (f === undefined) throw new Error('a conversation was opened')
    // Started for its run…
    restartsAt(local(9, 29, 2, 59, 30))
    await waitFor(() => handlesOf(f).length === 2, 'F to be started for its run')
    await settle()
    // A second window has it open, read only; a third has something else open.
    const looking = new RecordingSink('webContents:2')
    const elsewhere = new RecordingSink('webContents:3')
    await app.host.look(f, looking, false)
    const g = await opens('agent-g')
    await app.host.look(g, elsewhere, false)
    const shownBefore = looking.messages.length
    const handlesBefore = handlesOf(f).length

    // …and stopped after the run's whole window, its provider having said nothing of the job:
    // this app writes its level, with the job's reason, and holds a word for it.
    app.clock = local(9, 29, 3, 31)
    await app.host.close(f, THE_APP_ITSELF)
    await settle()
    const shown = looking.messages.slice(shownBefore).filter((one) => one.sessionId === f)
    const level = shown.find((one) => one.event.type === 'scheduled_work' && 'jobs' in one.event)
    expect(level?.event).toMatchObject({
      source: 'app/receipts',
      jobs: [{ id: 'nightly', notStarted: 'no-word-from-its-provider' }],
    })
    // ⚑ The row as its ledger holds it: the same ordinal, moment and row, so a window that reads
    // the ledger again draws it once.
    const stored = app.store.events(f).find((one) => one.ordinal === level?.ordinal)
    expect(level).toEqual({
      sessionId: f,
      ...stored,
      agentState: null,
      published: { epoch: app.host.currentEpoch(), seq: expect.any(Number) },
    })
    // ⚑ …and the word held for its next start, which that window draws as a reopen would.
    expect(
      shown.some(
        (one) =>
          one.event.type === 'message_queued' &&
          (one.event as WordsInARow).appNotice === 'a-scheduled-job-that-will-not-run',
      ),
    ).toBe(true)
    // ⛔ Nothing for a window without it open, and nothing started.
    expect(elsewhere.messages.filter((one) => one.sessionId === f)).toEqual([])
    expect(handlesOf(f)).toHaveLength(handlesBefore)
    expect(wakeUpsOf(app.host).has(f)).toBe(false)
  })

  it('🔴 a window that moved from a stopped conversation to another is shown none of its later rows, while a window still on it is shown each, as its ledger holds it', async () => {
    const [f] = await aFirstLife(async ([first]) => makes(first!, NIGHTLY), 'agent-f')
    if (f === undefined) throw new Error('a conversation was opened')
    restartsAt(local(9, 29, 2, 59, 30))
    await waitFor(() => handlesOf(f).length === 2, 'F to be started for its run')
    await settle()
    // Two windows have it open, read only. Then one moves to another conversation, and its store
    // lets F go, as it does for a conversation that leaves the screen.
    const moved = new RecordingSink('webContents:2')
    const stays = new RecordingSink('webContents:3')
    await app.host.look(f, moved, false)
    await app.host.look(f, stays, false)
    const g = await opens('agent-g')
    await app.host.look(g, moved, false)
    app.host.stopLooking(f, moved.ownerId)

    // F is stopped after its run's window with no word: its level and a held word are written.
    app.clock = local(9, 29, 3, 31)
    const before = app.store.events(f).at(-1)?.ordinal ?? 0
    await app.host.close(f, THE_APP_ITSELF)
    await settle()
    const written = app.store
      .events(f)
      .filter(
        (one) =>
          one.ordinal > before &&
          ((one.event.type === 'scheduled_work' && 'jobs' in one.event) ||
            (one.event.type === 'message_queued' &&
              (one.event as WordsInARow).appNotice === 'a-scheduled-job-that-will-not-run')),
      )
    expect(written).toHaveLength(2)
    // ⚑ The window still on it is shown each, exactly as stored.
    for (const row of written) {
      expect(stays.messages).toContainEqual({
        sessionId: f,
        ...row,
        agentState: null,
        published: { epoch: app.host.currentEpoch(), seq: expect.any(Number) },
      })
    }
    // ⛔ The one that moved is shown nothing of F.
    expect(moved.messages.filter((one) => one.sessionId === f)).toEqual([])
  })

  /** A row this app writes into the ledger of a conversation nothing runs, as each of its writers does. */
  const writesWhileStopped = (id: string): void => {
    const writer = app.host as unknown as {
      writeWhileNothingRunsIt(id: string, row: TranscriptEvent): boolean
    }
    const row = { type: 'scheduled_work', jobs: [], source: 'app/receipts' } as TranscriptEvent
    if (!writer.writeWhileNothingRunsIt(id, row)) throw new Error(`${id}'s row was not written`)
  }
  const shownOf = (sink: RecordingSink, id: string): RuntimeEventMessage[] =>
    sink.messages.filter((one) => one.sessionId === id)

  it('🔴 a window that reloads is shown nothing it looked at before, until it looks again; one it looks at after is shown its rows', async () => {
    const g = await opens('agent-g')
    const h = await opens('agent-h')
    await app.host.close(g, THE_APP_ITSELF)
    await app.host.close(h, THE_APP_ITSELF)
    const reloads = new RecordingSink('webContents:2')
    await app.host.look(g, reloads, false)
    writesWhileStopped(g)
    expect(shownOf(reloads, g)).toHaveLength(1)

    // It reloads, and the same window is still there to be sent to.
    await app.host.closeSessionsForOwner(reloads.ownerId)
    expect(reloads.alive).toBe(true)
    writesWhileStopped(g)
    expect(shownOf(reloads, g)).toHaveLength(1)

    // ⚑ What it looks at now is shown to it; what it looked at before is not brought back.
    await app.host.look(h, reloads, false)
    writesWhileStopped(h)
    writesWhileStopped(g)
    expect(shownOf(reloads, h)).toHaveLength(1)
    expect(shownOf(reloads, g)).toHaveLength(1)
    // …until it looks at it again.
    await app.host.look(g, reloads, false)
    writesWhileStopped(g)
    expect(shownOf(reloads, g)).toHaveLength(2)
  })

  /** A look at a conversation whose life just ended, held in its wait until `letItEnd`. */
  const lookThatWaits = async (id: string, sink: RecordingSink) => {
    const teardown = app.host as unknown as { settleTeardown(id: string): Promise<void> }
    let letItEnd!: () => void
    const held = new Promise<void>((resolve) => (letItEnd = resolve))
    vi.spyOn(teardown, 'settleTeardown').mockImplementationOnce(() => held)
    doubleOf(id).simulateError('its provider went away', true)
    const looked = app.host.look(id, sink, false)
    await settle()
    return { letItEnd, looked }
  }
  /** The next read of a conversation's record for a look fails. */
  const theNextRecordReadFails = (): void => {
    const reader = app.host as unknown as {
      recordedHandover(id: string, sink: RuntimeEventSink): unknown
    }
    vi.spyOn(reader, 'recordedHandover').mockImplementationOnce(() => {
      throw new Error('the database is busy')
    })
  }

  it('⛔ a look that waits for a life to end is not counted once its window has reloaded, and a look made after the reload is', async () => {
    // The window reloads while its look waits; the look then ends: it is not counted.
    const a = await opens('agent-a')
    const reloads = new RecordingSink('webContents:2')
    const first = await lookThatWaits(a, reloads)
    await app.host.closeSessionsForOwner(reloads.ownerId)
    first.letItEnd()
    await first.looked
    writesWhileStopped(a)
    expect(shownOf(reloads, a)).toEqual([])

    // The window stops looking while its look waits: the same.
    const b = await opens('agent-b')
    const second = await lookThatWaits(b, reloads)
    app.host.stopLooking(b, reloads.ownerId)
    second.letItEnd()
    await second.looked
    writesWhileStopped(b)
    expect(shownOf(reloads, b)).toEqual([])

    // ⚑ The reloaded window looks at the same conversation while the old look still waits: the
    // new look counts, and the old one ending changes nothing — each row is shown once.
    const c = await opens('agent-c')
    const third = await lookThatWaits(c, reloads)
    await app.host.closeSessionsForOwner(reloads.ownerId)
    await app.host.look(c, reloads, false)
    third.letItEnd()
    await third.looked
    writesWhileStopped(c)
    expect(shownOf(reloads, c)).toHaveLength(1)
  })

  it('⛔ a look that fails takes back only its own count: a newer look by the same window is still shown each row, and a failed look that is the newest leaves nothing', async () => {
    // ⛔ An older look still waits; the window reloads and looks again, and that look is drawn. The
    // older one then fails to read the record: the newer look is still counted.
    const a = await opens('agent-a')
    const reloads = new RecordingSink('webContents:2')
    const older = await lookThatWaits(a, reloads)
    await app.host.closeSessionsForOwner(reloads.ownerId)
    await app.host.look(a, reloads, false)
    theNextRecordReadFails()
    older.letItEnd()
    await expect(older.looked).rejects.toThrow('the database is busy')
    writesWhileStopped(a)
    expect(shownOf(reloads, a)).toHaveLength(1)

    // ⚑ A look that is the newest and fails to read the record leaves its window uncounted.
    const b = await opens('agent-b')
    const only = await lookThatWaits(b, reloads)
    theNextRecordReadFails()
    only.letItEnd()
    await expect(only.looked).rejects.toThrow('the database is busy')
    writesWhileStopped(b)
    expect(shownOf(reloads, b)).toEqual([])
  })
})
