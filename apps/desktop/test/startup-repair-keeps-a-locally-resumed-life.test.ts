import { afterEach, expect, it } from 'vitest'
import { F093World, waitFor } from './lib/f093-host'
import { NO_CUTS_KEPT, turnsTheAppCutIn } from '../src/main/turns-the-app-cut-file'

const worlds: F093World[] = []

afterEach(async () => {
  for (const world of worlds.splice(0)) await world.dispose()
})

function backgroundWork(world: F093World, owner: string, at: number): void {
  world.store.append(
    owner,
    world.store.nextOrdinal(owner),
    {
      type: 'background_work',
      running: [{ id: 'unfinished', description: 'Finish the work' }],
      source: 'fictional',
    },
    at,
  )
}

it('delivers the restart background notice on a life resumed locally before the first paint', async () => {
  const world = new F093World()
  worlds.push(world)
  let clock = Date.UTC(2026, 9, 10, 12)
  const original = world.buildHost(false, { now: () => clock })
  const owner = await world.open(original, 'claude', 'local-owner')
  await original.closeAll()
  backgroundWork(world, owner, clock)
  clock += 1_000
  const host = world.buildHost(false, {
    now: () => clock,
    statesMoved: () => {},
    deferStartupUntilListPaint: true,
    afterFirstWindowLoad: new Promise<void>(() => {}),
    startGapMs: 1,
  })
  const notices = () =>
    world
      .ledger(owner)
      .filter(
        (event) =>
          (event.type === 'message_queued' || event.type === 'user_turn') &&
          event.appNotice === 'background-work-a-restart-stopped',
      )
  await host.resumeSession(owner, world.window)
  expect(world.launchesOf(owner)).toHaveLength(2)
  expect(notices()).toHaveLength(0)
  host.firstListPainted()
  await waitFor(
    () => notices().some((event) => event.type === 'user_turn'),
    'the restart notice to reach the locally resumed life',
  )
  expect(notices().filter((event) => event.type === 'user_turn')).toHaveLength(1)
  expect(world.launchesOf(owner)).toHaveLength(2)
})

it.each([false, true])(
  'keeps a local pending cut for its account decision with background work %s',
  async (background) => {
    const world = new F093World()
    worlds.push(world)
    const at = Date.UTC(2026, 9, 10, 13)
    const original = world.buildHost(false, { now: () => at })
    const owner = await world.open(original, 'claude', 'cut-owner')
    await original.closeAll()
    world.store.append(
      owner,
      world.store.nextOrdinal(owner),
      { type: 'user_turn', text: 'The turn interrupted by the crash' },
      at,
    )
    if (background) backgroundWork(world, owner, at)
    const turn = world.store.turns(owner).at(-1)!
    world.store.closeOpenTurn(owner, 'unknown', at)
    const cuts = turnsTheAppCutIn(world.db)
    cuts.write({
      ...NO_CUTS_KEPT,
      cuts: {
        [owner]: {
          turn: turn.id,
          generation: 0,
          kind: 'crash',
          cutAt: at,
          provider: 'claude',
          profile: 'cut-owner',
          expected: 'fictional:account',
          noticeId: 'fictional-continuation',
          aPersonStartedIt: true,
          state: 'pending',
          at,
        },
      },
    })
    const host = world.buildHost(false, {
      now: () => at + 1_000,
      statesMoved: () => {},
      deferStartupUntilListPaint: true,
      afterFirstWindowLoad: new Promise<void>(() => {}),
      turnsTheAppCut: cuts,
      accountWaitMs: 1,
      startGapMs: 1,
    })
    await host.resumeSession(owner, world.window)
    expect(cuts.read().cuts[owner]?.state).toBe('pending')
    host.firstListPainted()
    await waitFor(
      () => typeof cuts.read().cuts[owner]?.state === 'object',
      'the continuation to make its account decision on the local life',
    )
    expect(cuts.read().cuts[owner]?.state).toEqual({ ended: 'account-not-known' })
    if (background) {
      await waitFor(
        () =>
          world
            .turnsOf(owner)
            .some((turn) => turn.appNotice === 'background-work-a-restart-stopped'),
        'the background notice to follow the continuation decision',
      )
    }
    expect(world.launchesOf(owner)).toHaveLength(2)
  },
)

it('does not promote an older quit after the newest owner resumes before the remaining repair', async () => {
  const world = new F093World()
  worlds.push(world)
  const at = Date.UTC(2026, 9, 10, 14)
  const original = world.buildHost(false, { now: () => at })
  const newest = await world.open(original, 'claude', 'newest-quit')
  const older = await world.open(original, 'claude', 'older-quit')
  await original.closeAll()
  world.store.closedByTheQuit([older], at - 1_000)
  world.store.closedByTheQuit([newest], at)
  backgroundWork(world, newest, at)
  backgroundWork(world, older, at)
  const host = world.buildHost(false, {
    now: () => at + 1_000,
    statesMoved: () => {},
    deferStartupUntilListPaint: true,
    afterFirstWindowLoad: new Promise<void>(() => {}),
    startGapMs: 1,
  })
  expect(world.store.whatTheNewestQuitClosed(at - 2_000)).toEqual([newest])
  await host.resumeSession(newest, world.window)
  expect(world.store.whatTheNewestQuitClosed(at - 2_000)).toEqual([older])
  host.firstListPainted()
  await waitFor(
    () =>
      world.turnsOf(newest).some((turn) => turn.appNotice === 'background-work-a-restart-stopped'),
    'the original newest-quit owner to receive its notice',
  )
  expect(
    world
      .ledger(older)
      .filter(
        (event) =>
          (event.type === 'message_queued' || event.type === 'user_turn') &&
          event.appNotice === 'background-work-a-restart-stopped',
      ),
  ).toEqual([])
  expect(world.launchesOf(older)).toHaveLength(1)
})
