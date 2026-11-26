import { afterEach, expect, it, vi } from 'vitest'
import { FakeSessionHandle } from '@brobot2/runtime'
import { agentToolsFor } from '../src/main/runtime/agent-tools'
import { answerOn } from './helpers/call-tool'
import { aServiceWorld, type AServiceWorld } from './helpers/a-service-world'
import { waitFor } from './lib/host-fixture'

const endings = [
  {
    how: 'its provider ends the session',
    end: (handle: FakeSessionHandle) => handle.close(),
    state: 'ended',
  },
  {
    how: 'its provider fails',
    end: (handle: FakeSessionHandle) => handle.simulateError('fictional provider stopped', true),
    state: 'errored',
  },
] as const

afterEach(() => {
  vi.restoreAllMocks()
})

/** From here on, each new provider life takes what it is handed and begins no turn. */
function livesTakeInputAndRunNoTurn(): void {
  vi.spyOn(FakeSessionHandle.prototype, 'send').mockImplementation(
    async (_text, _origin, onInputAccepted) => {
      onInputAccepted?.()
    },
  )
}

function sentCount(world: AServiceWorld, holder: string): number {
  return world
    .ledger(holder)
    .filter((one) => one.type === 'message_unqueued' && one.reason === 'sent').length
}

function endsRecorded(world: AServiceWorld, holder: string, state: 'ended' | 'errored'): number {
  return world.ledger(holder).filter((one) => one.type === 'status' && one.state === state).length
}

async function giverIsToldOf(
  world: AServiceWorld,
  giver: string,
  holder: string,
  piece: string,
  cause: string,
): Promise<void> {
  await waitFor(
    () =>
      world
        .ledger(giver)
        .some(
          (one) =>
            one.type === 'work_stall_told' &&
            one.piece === piece &&
            'cause' in one &&
            one.cause === cause,
        ),
    `the giver to be told the work stopped (${cause})`,
  )
  expect(world.store.piecesOwnedBy(holder)).toContainEqual(
    expect.objectContaining({ piece, state: 'stalled', stalledBecause: cause }),
  )
}

it.each(endings)(
  'a giver is told when $how after taking the brief and before any turn',
  async ({ end, state }) => {
    const world = aServiceWorld()
    try {
      world.anAgent('worker', 'normal')
      const host = world.aHost()
      const giver = await world.aPersonOpens(host, 'giver')
      livesTakeInputAndRunNoTurn()
      const given = await world.gives(host, giver, 'worker')
      if (!given.ok) throw new Error('the task was not recorded')
      const holder = given.owner
      await waitFor(() => sentCount(world, holder) === 1, 'the brief to be handed over')

      await end(world.handleOf('worker') as FakeSessionHandle)
      await waitFor(() => endsRecorded(world, holder, state) === 1, 'the end to be recorded')
      expect(endsRecorded(world, holder, state === 'ended' ? 'errored' : 'ended')).toBe(0)

      await giverIsToldOf(world, giver, holder, given.piece, 'turn_interrupted')
    } finally {
      await world.cleanUp()
    }
  },
)

it('a giver is told when a reopen on the current sign-in hands over its follow-up and its provider ends the session before any turn', async () => {
  const world = aServiceWorld()
  let release = (): void => {}
  try {
    world.signInsChecked = true
    world.turnsWait = new Promise<void>((resolve) => {
      release = resolve
    })
    world.anAgent('worker', 'normal', 'codex')
    const host = world.aHost()
    const giver = await world.aPersonOpens(host, 'giver')
    const given = await world.gives(host, giver, 'worker')
    if (!given.ok) throw new Error('the task was not recorded')
    const holder = given.owner
    await waitFor(() => world.store.theOpenTurn(holder) !== null, 'the brief turn')
    // Its sign-in reads as moved on from here, mid-turn, until this app reopens it.
    world.signInMovedFor = 'worker'
    await answerOn(agentToolsFor(host, giver), 'message_agent', {
      agent: given.label,
      piece: given.label,
      text: 'Please carry on with this work.',
    })
    livesTakeInputAndRunNoTurn()
    const lives = world.handles.length
    release()
    await waitFor(
      () => world.ledger(holder).some((one) => one.type === 'permission_request'),
      'the brief turn to ask before its tool',
    )
    await host.respondPermission(holder, 'turn_1_perm', { outcome: 'allow' }, world.window)
    await waitFor(() => world.handles.length > lives, 'the reopen on the current sign-in')
    await waitFor(
      () =>
        world
          .ledger(holder)
          .some(
            (one) =>
              one.type === 'user_turn' && one.text.includes('Please carry on with this work.'),
          ),
      'the follow-up to be handed over',
    )

    await (world.handleOf('worker') as FakeSessionHandle).close()
    await waitFor(() => endsRecorded(world, holder, 'ended') === 2, 'the end to be recorded')
    expect(endsRecorded(world, holder, 'errored')).toBe(0)

    await giverIsToldOf(world, giver, holder, given.piece, 'turn_interrupted')
  } finally {
    release()
    await world.cleanUp()
  }
})

it('a giver is told of its holder’s refused login once the holder reopens on the renewed sign-in', async () => {
  const world = aServiceWorld()
  try {
    world.signInsChecked = true
    world.anAgent('worker', 'normal', 'codex')
    const host = world.aHost()
    const giver = await world.aPersonOpens(host, 'giver')
    livesTakeInputAndRunNoTurn()
    const given = await world.gives(host, giver, 'worker')
    if (!given.ok) throw new Error('the task was not recorded')
    const holder = given.owner
    await waitFor(() => sentCount(world, holder) === 1, 'the brief to be handed over')
    const lives = world.handles.length
    world.signInMovedFor = 'worker'
    await (world.handleOf('worker') as FakeSessionHandle).runTurnRefusedOnItsLogin()
    await waitFor(() => world.handles.length > lives, 'the reopen on the renewed sign-in')
    await waitFor(
      () =>
        world.ledger(holder).some((one) => one.type === 'work_recovery' && one.phase === 'sent'),
      'the recovery to be sent',
    )

    await giverIsToldOf(world, giver, holder, given.piece, 'login_refused')
  } finally {
    await world.cleanUp()
  }
})
