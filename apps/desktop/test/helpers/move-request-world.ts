import { afterEach, beforeEach, expect } from 'vitest'
import { agentCallerId } from '../../src/main/runtime/agent-tools'
import { archivedConversationsIn } from '../../src/main/archived-file'
import type { RuntimeHost } from '../../src/main/runtime/runtime-host'
import { aServiceWorld, type AServiceWorld } from './a-service-world'

export const ORIGINAL = 'Please check the fictional release notes.'

export function aMoveRequestFixture() {
  let world: AServiceWorld
  let fixture: {
    world: AServiceWorld
    host: RuntimeHost
    source: string
    target: string
    offer: (destination?: string) => Promise<string>
    targetWords: () => ReturnType<AServiceWorld['ledger']>
  }
  beforeEach(async () => {
    world = aServiceWorld()
    world.anAgent('source', 'normal')
    world.anAgent('target', 'normal')
    const host = world.aHost({ archived: archivedConversationsIn(world.db) })
    const source = await world.aPersonOpens(host, 'source')
    const target = await world.aPersonOpens(host, 'target')
    await host.send(source, ORIGINAL, world.window)
    fixture = {
      world,
      host,
      source,
      target,
      offer: (destination = target) => offerMoveRequest(host, source, destination),
      targetWords: () => world.ledger(target).filter((event) => event.type === 'user_turn'),
    }
  })
  afterEach(async () => world.cleanUp())
  return () => fixture
}

export async function offerMoveRequest(host: RuntimeHost, source: string, target: string) {
  const result = await host.raiseAQuestion(
    {
      piece: null,
      question: 'The target owns this subject.',
      options: [],
      who: 'a-person',
      agent: null,
      moveTo: target,
    },
    { ownerId: agentCallerId(source) },
  )
  expect(result.ok).toBe(true)
  if (!result.ok) throw new Error(result.refusal.reason)
  return result.question
}
