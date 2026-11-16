import { setImmediate as afterIO } from 'node:timers/promises'
import { afterEach, expect, it, vi } from 'vitest'
import { aLibraryHost, filesLibraryFixture } from './helpers/files-library-fixture'
import { RecordingSink, waitFor } from './lib/host-fixture'

const cleanups: (() => Promise<void>)[] = []

afterEach(async () => {
  for (const close of cleanups.splice(0)) await close()
  vi.restoreAllMocks()
})

function waitingConversations(
  count: number,
  deferred = true,
  seed?: (world: ReturnType<typeof filesLibraryFixture>) => void,
) {
  const world = filesLibraryFixture()
  const ids = Array.from({ length: count }, (_, n) => `conversation-${n}`)
  for (const id of ids) {
    world.owner(id)
    world.store.append(
      id,
      world.store.nextOrdinal(id),
      {
        type: 'message_queued',
        messageId: `message-${id}`,
        text: 'Waiting at the crash',
        kind: 'work',
      },
      1,
    )
  }
  seed?.(world)
  const steps = world.store.settleStrandedMessagesInSteps.bind(world.store)
  const repair = vi.spyOn(world.store, 'settleStrandedMessagesInSteps')
  const host = aLibraryHost(world.directory, {
    store: world.store,
    deferStartupUntilListPaint: deferred,
    now: () => 100,
    afterFirstWindowLoad: new Promise<void>(() => {}),
  })
  const abandoned = (id: string) =>
    world.store
      .events(id)
      .filter(({ event }) => event.type === 'message_unqueued' && event.reason === 'abandoned')
      .length
  const fixture = { world, ids, repair, steps, host, abandoned }
  cleanups.push(async () => {
    await host.closeAll()
    world.close()
  })
  return fixture
}

it('returns its first list without repairing history, then yields between bounded batches', async () => {
  const { ids, repair, host, abandoned } = waitingConversations(51)
  const list = await host.listConversations()
  if ('refused' in list) throw new Error(list.refused)
  expect(list.resumable.length + list.unresumable.length).toBe(51)
  expect(repair).not.toHaveBeenCalled()
  await afterIO()
  expect(ids.map(abandoned)).toEqual(ids.map(() => 0))
  host.firstListPainted()
  host.firstListPainted()
  expect(repair).not.toHaveBeenCalled()
  let previous = 0
  let writesOnDifferentTicks = 0
  for (let tick = 0; tick < 20 && previous < ids.length; tick += 1) {
    await afterIO()
    const total = ids.map(abandoned).reduce((a, b) => a + b, 0)
    expect(total - previous).toBeLessThanOrEqual(25)
    if (total > previous) writesOnDifferentTicks += 1
    previous = total
  }
  expect(writesOnDifferentTicks).toBeGreaterThan(1)
  expect(repair).toHaveBeenCalledTimes(1)
  expect(ids.map(abandoned)).toEqual(ids.map(() => 1))
})

it('repairs the canonical earlier message prefix before opening, without applying it twice', async () => {
  const { ids, repair, host, abandoned } = waitingConversations(26)
  const opened = ids[25]!
  await host.look(opened, new RecordingSink('window'), false)
  expect(repair).toHaveBeenCalledTimes(1)
  expect(abandoned(opened)).toBe(1)
  expect(abandoned(ids[0]!)).toBe(1)
  host.firstListPainted()
  await afterIO()
  expect(repair).toHaveBeenCalledTimes(1)
  expect(ids.map(abandoned)).toEqual(ids.map(() => 1))
})

it('keeps a foreground message added after paint while owner repairs remain', async () => {
  const { ids, world, host, abandoned } = waitingConversations(51)
  const work = vi.spyOn(world.store, 'settleRestartedWork')
  const opened = ids[0]!
  host.firstListPainted()
  for (let tick = 0; tick < 20 && abandoned(opened) === 0; tick += 1) await afterIO()
  expect(abandoned(opened)).toBe(1)
  await host.look(opened, new RecordingSink('window'), false)
  const repaired = work.mock.calls.flatMap((call) => [...call[6]!])
  expect(repaired).toContain(opened)
  expect(repaired.length).toBeLessThan(ids.length)
  const message = {
    type: 'message_queued' as const,
    messageId: 'foreground-after-paint',
    text: 'New work while the sweep still has owners to repair',
    kind: 'work' as const,
  }
  world.store.append(opened, world.store.nextOrdinal(opened), message, 101)
  expect(work).toHaveBeenCalledTimes(repaired.length)
  await waitFor(() => work.mock.calls.length === ids.length, 'the remaining owner repairs')
  await afterIO()
  expect(work).toHaveBeenCalledTimes(ids.length)
  expect(ids.map(abandoned)).toEqual(ids.map(() => 1))
  expect(
    world.store
      .events(opened)
      .map(({ event }) => event)
      .filter((event) => 'messageId' in event && event.messageId === message.messageId),
  ).toEqual([message])
})

it('cancels the queued remainder before shutdown releases the store', async () => {
  const { ids, repair, host, abandoned } = waitingConversations(51)
  host.firstListPainted()
  for (let tick = 0; tick < 10 && abandoned(ids[0]!) === 0; tick += 1) await afterIO()
  const beforeClose = ids.map(abandoned)
  expect(beforeClose.reduce((a, b) => a + b, 0)).toBeGreaterThan(0)
  expect(beforeClose.at(-1)).toBe(0)
  await host.closeAll()
  await afterIO()
  host.firstListPainted()
  await afterIO()
  expect(repair).toHaveBeenCalledTimes(1)
  expect(ids.map(abandoned)).toEqual(beforeClose)
  expect(abandoned(ids[50]!)).toBe(0)
})

it('settles a foreground repair wait on shutdown without reading the closed store', async () => {
  const { ids, host, world } = waitingConversations(51)
  const pending = host.look(ids[50]!, new RecordingSink('window'), false)
  const rejected = expect(pending).rejects.toThrow('shut down before')
  await host.closeAll()
  const read = vi.spyOn(world.store, 'checkCommitted')
  await rejected
  expect(read).not.toHaveBeenCalled()
})

it('does not register a stale look after its window leaves during the repair prefix', async () => {
  const { ids, host } = waitingConversations(51)
  const sink = new RecordingSink('departed-window')
  const opening = host.look(ids[50]!, sink, false)
  const rejected = expect(opening).rejects.toThrow()
  await host.closeSessionsForOwner(sink.ownerId)
  await rejected
  expect(host.workInFlight()).not.toContain(ids[50])
})

it('keeps canonical message, request and work repair results and their per-owner order', async () => {
  const seed = (world: ReturnType<typeof filesLibraryFixture>) => {
    const owner = 'conversation-0'
    const root = world.store.rootOf(owner)!
    world.task('work', root.piece, 1, owner, null)
    world.store.append(
      owner,
      world.store.nextOrdinal(owner),
      {
        type: 'work_given',
        piece: 'work',
        label: `${root.label}.1`,
        parent: root.piece,
        givenBy: null,
        title: 'Work',
        brief: 'Finish this',
      },
      2,
    )
    world.store.append(
      owner,
      world.store.nextOrdinal(owner),
      { type: 'request_routed', requestId: 'question', to: 'a-person' },
      3,
    )
  }
  const before = waitingConversations(2, false, seed)
  const after = waitingConversations(2, true, seed)
  expect(after.repair).not.toHaveBeenCalled()
  after.host.firstListPainted()
  await afterIO()
  for (const owner of before.ids) {
    const events = (world: typeof before.world) =>
      world.store.events(owner).map(({ event }) => event)
    const beforeRoot = before.world.store.rootOf(owner)!
    const afterRoot = after.world.store.rootOf(owner)!
    const expected = events(before.world).map((event) =>
      event.type === 'work_given' && event.parent === beforeRoot.piece
        ? { ...event, parent: afterRoot.piece }
        : event,
    )
    expect(events(after.world)).toEqual(expected)
  }
  expect(
    after.world.store
      .events('conversation-0')
      .slice(-3)
      .map(({ event }) => event.type),
  ).toEqual(['message_unqueued', 'request_stranded', 'work_restarted'])
})

it.each([
  { foreground: false, failFirst: false, parent: 'conversation-1' },
  { foreground: true, failFirst: false, parent: 'conversation-1' },
  { foreground: false, failFirst: true, parent: 'conversation-0' },
])(
  'keeps global answer provenance with foreground=$foreground and failed first append=$failFirst',
  async ({ foreground, failFirst, parent }) => {
    const seed = (world: ReturnType<typeof filesLibraryFixture>) => {
      for (const [parent, piece] of [
        ['conversation-1', 'first-piece'],
        ['conversation-0', 'first-piece'],
        ['conversation-0', 'second-piece'],
        ['conversation-1', 'second-piece'],
      ] as const) {
        world.store.append(
          parent,
          world.store.nextOrdinal(parent),
          {
            type: 'message_queued',
            messageId: `${parent}-${piece}`,
            text: 'The held answer',
            kind: 'work',
            relayedFrom: 'conversation-2',
            work: {
              piece,
              label: 'W1.1',
              owner: 'conversation-2',
              state: 'answered',
              outcome: 'done',
            },
          },
          2,
        )
      }
      if (failFirst) {
        world.db.exec(`CREATE TRIGGER reject_first_answer_abandonment BEFORE INSERT ON events
          WHEN NEW.session_id = 'conversation-1' AND NEW.type = 'message_unqueued'
           AND json_extract(NEW.payload, '$.messageId') = 'conversation-1-first-piece'
          BEGIN SELECT RAISE(FAIL, 'fixture first abandonment failed'); END`)
      }
    }
    const warnings = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const before = waitingConversations(3, false, seed)
    const originalWarnings = warnings.mock.calls.map((args) => [...args])
    warnings.mockClear()
    const after = waitingConversations(3, true, seed)
    if (foreground) await after.host.look('conversation-0', new RecordingSink('window'), false)
    else {
      after.host.firstListPainted()
      await afterIO()
    }
    expect(warnings.mock.calls).toEqual(originalWarnings)
    const lost = (world: typeof before.world) =>
      world.store
        .events('conversation-2')
        .flatMap(({ event }) =>
          event.type === 'reply_undelivered' ? [[event.piece, event.parent]] : [],
        )
    expect(lost(before.world)).toEqual([
      ['first-piece', parent],
      ['second-piece', 'conversation-0'],
    ])
    expect(lost(after.world)).toEqual(lost(before.world))
  },
)

it('retains quit-preserved queues and torn endings with the same unread diagnostics', async () => {
  const seed = (world: ReturnType<typeof filesLibraryFixture>) => {
    world.store.closedByTheQuit(['conversation-0'], 2)
    world.db
      .prepare(
        `INSERT INTO events (id, session_id, generation, ordinal, type, payload, created_at)
       VALUES ('torn-ending', 'conversation-1', 0, 10, 'message_unqueued', 'not JSON', 2)`,
      )
      .run()
  }
  const warnings = vi.spyOn(console, 'warn').mockImplementation(() => {})
  const before = waitingConversations(3, false, seed)
  const originalWarnings = warnings.mock.calls.map((args) => [...args])
  warnings.mockClear()
  const after = waitingConversations(3, true, seed)
  expect(warnings).not.toHaveBeenCalled()
  after.host.firstListPainted()
  await afterIO()
  expect(warnings.mock.calls).toEqual(originalWarnings)
  expect(originalWarnings.length).toBeGreaterThan(0)
  expect(before.ids.map(before.abandoned)).toEqual([0, 0, 1])
  expect(after.ids.map(after.abandoned)).toEqual([0, 0, 1])
})

it('keeps a failed pre-use step pending and does not report a failed background sweep complete', async () => {
  const { host, ids, repair, steps, abandoned, world } = waitingConversations(51)
  const owner = ids[0]!
  let fail = true
  repair.mockImplementation(function* (...args) {
    yield () => {
      if (fail) {
        fail = false
        throw new Error('fixture pre-use repair failure')
      }
    }
    return yield* steps(...args)
  })
  await expect(host.look(owner, new RecordingSink('window'), false)).rejects.toThrow(
    'fixture pre-use repair failure',
  )
  expect(abandoned(owner)).toBe(0)
  await host.look(owner, new RecordingSink('window'), false)
  expect(abandoned(owner)).toBe(1)
  expect(ids.map(abandoned)).toEqual(ids.map(() => 1))
  expect(repair).toHaveBeenCalledTimes(1)
  const errors = vi.spyOn(console, 'error').mockImplementation(() => {})
  const work = vi.spyOn(world.store, 'settleRestartedWork').mockImplementationOnce(() => {
    throw new Error('fixture background repair failure')
  })
  host.firstListPainted()
  await waitFor(() => errors.mock.calls.length > 0, 'the failed deferred repair to be reported')
  expect(errors).toHaveBeenCalledWith(
    'startup repairs did not finish: fixture background repair failure',
  )
  const calls = work.mock.calls.length
  host.firstListPainted()
  await afterIO()
  expect(work).toHaveBeenCalledTimes(calls)
  expect(ids.map(abandoned)).toEqual(ids.map(() => 1))
})
