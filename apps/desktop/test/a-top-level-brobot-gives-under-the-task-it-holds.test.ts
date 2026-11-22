import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { aServiceWorld, type AServiceWorld } from './helpers/a-service-world'
import { agentToolsFor } from '../src/main/runtime/agent-tools'
import { DEFAULT_PROFILE_ID } from '../src/shared/runtime-ipc'
import type { RuntimeHost } from '../src/main/runtime/runtime-host'

/**
 * A new BroBot conversation stands at the top level with a root of its own, yet the work it gives
 * or takes on with no piece named still goes under the task it was given, before and after a
 * restart, and under its own root only while it holds no task.
 */

const request = {
  title: 'Fictional request',
  brief: 'Read the fictional input.',
  definition_of_done: 'The result and its check are recorded.',
  profile: 'third',
  to: 'new',
  conversation_title: 'Fictional request',
}

describe('a top-level BroBot gives under the task it holds', () => {
  let world: AServiceWorld
  let host: RuntimeHost
  beforeEach(() => {
    world = aServiceWorld()
    world.anAgent('giver', 'normal')
    world.anAgent(DEFAULT_PROFILE_ID, 'normal')
    world.anAgent('third', 'normal')
    host = world.aHost()
  })
  afterEach(async () => {
    await world.cleanUp()
  })
  const call = async (on: RuntimeHost, conversation: string, name: string, args: object) =>
    (await agentToolsFor(on, conversation)
      .tools.find((one) => one.name === name)!
      .call(args as Record<string, unknown>)) as { structured: Record<string, unknown> }

  it('hangs a give with no piece named under the one task it was given, also after a restart', async () => {
    const giver = await world.aPersonOpens(host, 'giver')
    const given = await world.gives(host, giver, DEFAULT_PROFILE_ID)
    if (!given.ok) throw new Error('fictional give failed')
    const brobot = given.owner
    expect(world.store.parentOf(brobot)).toBeNull()
    expect(world.store.rootOf(brobot)).not.toBeNull()
    expect(world.store.workById(given.piece)?.givenBy).toBe(giver)

    const first = await call(host, brobot, 'give_work', request)
    expect(first.structured).toMatchObject({ outcome: 'ok', label: `${given.label}.1` })

    await host.closeAll()
    const again = world.aHost()
    await again.resumeSession(brobot, world.window)
    const second = await call(again, brobot, 'give_work', request)
    expect(second.structured).toMatchObject({ outcome: 'ok', label: `${given.label}.2` })
  })

  it('hangs a person’s request under the one task it was given, not its own root', async () => {
    const giver = await world.aPersonOpens(host, 'giver')
    const given = await world.gives(host, giver, DEFAULT_PROFILE_ID)
    if (!given.ok) throw new Error('fictional give failed')
    host.claimSession(given.owner, world.window)
    await host.sendInterrupting(given.owner, 'Please also take this on.', world.window)
    const taken = await call(host, given.owner, 'take_on_work', {
      title: request.title,
      brief: request.brief,
      definition_of_done: request.definition_of_done,
    })
    expect(taken.structured).toMatchObject({ outcome: 'ok', under: given.label })
  })

  it('still hangs a person’s request under its own root while it holds no task', async () => {
    const person = await world.aPersonOpens(host, DEFAULT_PROFILE_ID)
    const root = world.store.rootOf(person)!.label
    await host.sendInterrupting(person, 'Please take this on.', world.window)
    const taken = await call(host, person, 'take_on_work', {
      title: request.title,
      brief: request.brief,
      definition_of_done: request.definition_of_done,
    })
    expect(taken.structured).toMatchObject({ outcome: 'ok', under: root })
  })
})
