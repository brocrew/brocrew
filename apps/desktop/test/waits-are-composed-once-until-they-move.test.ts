import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { aServiceWorld, RecordingSink, type AServiceWorld } from './helpers/a-service-world'
import { openDatabase } from '../src/main/db/connection'
import type { RuntimeHost } from '../src/main/runtime/runtime-host'

/**
 * What each conversation waits on is composed once and shared by every window that asks, until
 * something it reads moves: a commit, another connection's commit, or a live fact such as who holds
 * a conversation. A reading that could not read a row is said once and read again.
 */
describe('waits are composed once until they move', () => {
  let world: AServiceWorld
  let host: RuntimeHost
  let giver: string
  const both = () => [host.whatEachConversationIsWaitingOn()] as const
  const quiet = async () => {
    await vi.waitFor(async () => {
      const first = both()
      await new Promise((resolve) => setTimeout(resolve, 50))
      const second = both()
      second.forEach((answer, at) => expect(answer).toBe(first[at]))
    })
  }

  beforeEach(async () => {
    world = aServiceWorld()
    world.anAgent('giver', 'normal')
    world.anAgent('helper', 'normal')
    host = world.aHost({ servicesOn: false })
    giver = await world.aPersonOpens(host, 'giver')
  })
  afterEach(async () => {
    vi.restoreAllMocks()
    await world.cleanUp()
  })

  it('three windows asking at one version share one composition', async () => {
    await quiet()
    const owned = vi.spyOn(world.store, 'piecesOwnedBy')
    const first = both()
    const answers = [both(), both()]
    expect(owned).not.toHaveBeenCalled()
    for (const answer of answers) answer.forEach((one, at) => expect(one).toBe(first[at]))
  })

  it('a commit moves them, and the next ask composes them again', async () => {
    await quiet()
    const [waits] = both()
    world.store.setModel(giver, 'fictional-model')
    const [nextWaits] = both()
    expect(nextWaits).not.toBe(waits)
  })

  it('another connection’s commit is heard before a kept answer is reused', async () => {
    await quiet()
    const [waits] = both()
    const other = openDatabase(join(world.folder, 'brobot2.sqlite'))
    try {
      other.prepare('UPDATE provider_session SET cwd = ? WHERE id = ?').run('/tmp/elsewhere', giver)
    } finally {
      other.close()
    }
    const [nextWaits] = both()
    expect(nextWaits).not.toBe(waits)
  })

  it('a live fact with no commit — a window handing a conversation back — composes them again', async () => {
    const given = await world.gives(host, giver, 'helper')
    if (!given.ok) throw new Error('the give was refused')
    const helper = world.store.workById(given.piece)!.owner
    const other = new RecordingSink('webContents:2')
    await host.look(helper, other, true)
    await quiet()
    const [waits] = both()
    const rows = world.store.events(helper).length
    host.releaseSession(helper, other)
    expect(world.store.events(helper).length).toBe(rows)
    const [nextWaits] = both()
    expect(nextWaits).not.toBe(waits)
  })

  it('waits that skipped a ledger are said once, and read again with nothing moved', async () => {
    await quiet()
    world.store.setModel(giver, 'fictional-model')
    const read = world.store.piecesOwnedBy.bind(world.store)
    let failedOnce = false
    vi.spyOn(world.store, 'piecesOwnedBy').mockImplementation((id, unread) => {
      if (failedOnce) return read(id, unread)
      failedOnce = true
      unread?.in(id)('the-whole-ledger')
      return read(id)
    })
    const skipped = host.whatEachConversationIsWaitingOn()
    expect(failedOnce).toBe(true)
    expect(skipped.ledgersSkipped).toBeGreaterThan(0)
    const recovered = host.whatEachConversationIsWaitingOn()
    expect(recovered).not.toBe(skipped)
    expect(recovered.ledgersSkipped ?? 0).toBe(0)
    expect(host.whatEachConversationIsWaitingOn()).toBe(recovered)
  })
})
