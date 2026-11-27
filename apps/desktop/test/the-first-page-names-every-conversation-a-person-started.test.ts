import { afterEach, expect, it } from 'vitest'
import { acceptedGive, aServiceWorld, type AServiceWorld } from './helpers/a-service-world'
import { RECENT_CONVERSATION_PAGE_SIZE } from '../src/shared/listing-published'

/**
 * The rail's first page, read before the full listing: the most recent conversations and every one
 * a person started, whichever agent runs it. With many agents working, none of a person's own
 * conversations may be among the most recent, and they would wait for the full listing.
 */
let world: AServiceWorld | undefined
afterEach(async () => world?.cleanUp())

it("names every conversation a person started beyond the most recent page, and no agent's", async () => {
  world = aServiceWorld()
  world.anAgent('helper', 'normal')
  world.anAgent('reviewer', 'normal')
  const host = world.aHost()
  const theirs = [
    await world.aPersonOpens(host, 'brobot'),
    await world.aPersonOpens(host, 'reviewer'),
  ]
  const giver = await world.aPersonOpens(host, 'helper')
  const agentStarted = acceptedGive(await world.gives(host, giver, 'reviewer')).owner
  // Older versions could leave a conversation another one started owning a root of its own.
  world.db
    .prepare(
      `UPDATE work SET parent_id = NULL, given_by_session_id = NULL,
         number = (SELECT max(number) + 1000 FROM work) WHERE owner_session_id = ?`,
    )
    .run(agentStarted)
  expect(world.store.rootOf(agentStarted)).not.toBeNull()
  const helpers: string[] = []
  for (let i = 0; i < RECENT_CONVERSATION_PAGE_SIZE + 3; i++) {
    world.clock += 1_000
    helpers.push(await world.aPersonOpens(host, 'helper'))
  }
  const page = host.listRecentConversations().map((row) => row.sessionId)
  expect(page.slice(0, RECENT_CONVERSATION_PAGE_SIZE)).toEqual(
    helpers.slice(-RECENT_CONVERSATION_PAGE_SIZE).reverse(),
  )
  const beyond = page.slice(RECENT_CONVERSATION_PAGE_SIZE)
  expect(new Set(beyond)).toEqual(new Set([...theirs, giver, ...helpers.slice(0, 3)]))
  expect(page).not.toContain(agentStarted)
})
