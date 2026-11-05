import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { aServiceWorld, RecordingSink, type AServiceWorld } from './helpers/a-service-world'
import type { RuntimeHost } from '../src/main/runtime/runtime-host'
import type { RuntimeChangeMessage, RuntimeStatesMessage } from '../src/shared/runtime-ipc'
import type { ListingAnswer, PublishedListing } from '../src/shared/listing-published'
import { acceptAnswer, acceptPush, emptyScope } from '../src/shared/data-version'

/**
 * The listing is answered as one publication: both halves from one composition under one stamp. A
 * states push is newer than every answer composed before it, and keys its rows by the same
 * conversation id the listing does. The conversations notice carries its stamp.
 */
describe('the listing and the states are published under one stamp', () => {
  let world: AServiceWorld
  let host: RuntimeHost
  let giver: string
  let announced: RuntimeChangeMessage[]
  let pushed: RuntimeStatesMessage[]

  const listing = async (): Promise<PublishedListing> => {
    const answer = await host.listConversations()
    if ('refused' in answer) throw new Error(`the listing was refused: ${answer.refused}`)
    return answer
  }
  const idsOf = (answer: PublishedListing) =>
    [...answer.resumable, ...answer.unresumable].map((row) => row.sessionId)
  const settled = async () => {
    await vi.waitFor(async () => {
      const first = (await listing()).published.seq
      await new Promise((resolve) => setTimeout(resolve, 50))
      expect((await listing()).published.seq).toBe(first)
    })
  }

  beforeEach(async () => {
    world = aServiceWorld()
    world.anAgent('giver', 'normal')
    world.anAgent('helper', 'normal')
    announced = []
    pushed = []
    host = world.aHost({
      servicesOn: false,
      announce: (message) => announced.push(message),
      statesMoved: (message) => pushed.push(message),
    })
    giver = await world.aPersonOpens(host, 'giver')
  })
  afterEach(async () => {
    vi.restoreAllMocks()
    await world.cleanUp()
  })

  it('both halves answer under one complete stamp, from the composition the old verbs share', async () => {
    await settled()
    const answer = await listing()
    expect(answer.published.epoch).toEqual(host.currentEpoch())
    expect(answer.published.covers).toEqual({ population: 'listing', complete: true })
    expect(answer.resumable).toBe(host.resumableSessions())
    expect(answer.unresumable).toBe(host.unresumableSessions())
    expect(idsOf(answer)).toContain(giver)
  })

  it('a listing that skipped a read is partial, naming every row of both halves', async () => {
    await settled()
    world.store.setModel(giver, 'fictional-model')
    const read = world.store.routedRequestsOf.bind(world.store)
    let failedOnce = false
    vi.spyOn(world.store, 'routedRequestsOf').mockImplementation((id, unread) => {
      if (failedOnce) return read(id, unread)
      failedOnce = true
      unread?.in(id)('the-whole-ledger')
      return read(id)
    })
    const answer = await listing()
    expect(failedOnce).toBe(true)
    expect(answer.published.covers).toEqual({
      population: 'listing',
      complete: false,
      ids: idsOf(answer),
    })
  })

  it('a listing that cannot be read at all is refused with the stamp it failed at', async () => {
    const before = (await listing()).published.seq
    vi.spyOn(host, 'readForWindow').mockRejectedValueOnce(new Error('fictional failure'))
    const answer: ListingAnswer = await host.listConversations()
    expect(answer).toEqual({
      refused: 'fictional failure',
      published: { epoch: host.currentEpoch(), seq: before },
    })
  })

  it('a states push is newer than the answer before it, and an answer after it is not older', async () => {
    const given = await world.gives(host, giver, 'helper')
    if (!given.ok) throw new Error('the give was refused')
    const helper = world.store.workById(given.piece)!.owner
    const other = new RecordingSink('webContents:2')
    await host.look(helper, other, true)
    await settled()
    const before = await listing()
    pushed = []
    // Closing it moves its state, which is what a states push says.
    await host.close(helper, other)
    await vi.waitFor(() => expect(pushed.length).toBeGreaterThan(0))
    const last = pushed.at(-1)!
    if (last.published === undefined) throw new Error('the push carried no stamp')
    const push = { ...last, published: last.published }
    expect(push.published.epoch).toEqual(host.currentEpoch())
    expect(push.published.seq).toBeGreaterThan(before.published.seq)
    const after = await listing()
    expect(after.published.seq).toBeGreaterThanOrEqual(push.published.seq)
    // A push lands on the listing's own row for that conversation: one id for both.
    const moved = push.moved.find((one) => one.conversation === helper)
    expect(moved).toBeDefined()
    expect(idsOf(after)).toContain(moved!.conversation)
    const rows = (answer: PublishedListing) =>
      new Map([...answer.resumable, ...answer.unresumable].map((row) => [row.sessionId, row]))
    const held = acceptPush(
      acceptAnswer(emptyScope<unknown>(), before.published.seq, true, rows(before)),
      push.published.seq,
      new Map(push.moved.map((one) => [one.conversation, one])),
    )
    expect(held.rows.get(helper)?.seq).toBe(push.published.seq)
  })

  it('an ask with nothing moved moves no stamp, so a push stays the newest', async () => {
    await settled()
    const first = await listing()
    const second = await listing()
    expect(second.published.seq).toBe(first.published.seq)
  })

  it('the conversations notice carries the stamp it was made at', async () => {
    const before = (await listing()).published.seq
    announced = []
    await host.close(giver, world.window)
    const notice = announced.find((one) => one.what === 'conversations')
    expect(notice?.published?.epoch).toEqual(host.currentEpoch())
    expect(notice?.published?.seq).toBeGreaterThan(before)
  })
})
