import { join } from 'node:path'
import { expect, it, vi } from 'vitest'
import { aServiceWorld } from './helpers/a-service-world'
import { aLibraryHost } from './helpers/files-library-fixture'
import { WindowReadEngine } from '../src/main/db/window-read-engine'
import { WindowReadUnavailable, type WindowReadQuery } from '../src/main/db/window-read-protocol'
import { windowWriterSampler } from '../src/main/db/window-writer-stamp'
import { limitsWriterSampler } from '../src/main/db/fresh-limits-snapshot'

it('legacy listing callers share admission, warm reads and failures at the same writer stamp', async () => {
  const world = aServiceWorld()
  world.store.create({
    id: 'own-root',
    provider: 'codex',
    profileId: 'brobot',
    cwd: world.folder,
    approvalMode: 'ask',
  })
  const engine = new WindowReadEngine(join(world.folder, 'brobot2.sqlite'))
  const read = vi.fn(async (query: WindowReadQuery) => engine.read(query))
  const host = aLibraryHost(world.folder, {
    store: world.store,
    windowReader: { read, close: async () => engine.close() },
    afterFirstWindowLoad: new Promise<void>(() => {}),
    windowWriterStamp: windowWriterSampler(world.db, () => true),
    limitsWriterStamp: limitsWriterSampler(world.db, () => true),
  })
  const listing = async () => {
    const result = await host.listConversations()
    if ('refused' in result) throw new Error(result.refused)
    expect(result.resumable).toEqual([])
    expect(result.unresumable.map((row) => row.sessionId)).toEqual(['own-root'])
    return result
  }
  const move = () =>
    world.store.append(
      'own-root',
      world.store.nextOrdinal('own-root'),
      { type: 'status', state: 'idle' },
      world.clock++,
    )
  try {
    const concurrent = await Promise.all(Array.from({ length: 40 }, listing))
    expect(read).toHaveBeenCalledOnce()
    for (const answer of concurrent) expect(answer.unresumable).toBe(concurrent[0]!.unresumable)
    for (let n = 0; n < 50; n++) await listing()
    expect(read).toHaveBeenCalledOnce()
    move()
    await listing()
    expect(read).toHaveBeenCalledTimes(2)
    expect(read.mock.calls[1]![0]).toMatchObject({
      kind: 'listing',
      reuse: { token: expect.any(String) },
    })
    move()
    read.mockRejectedValueOnce(new WindowReadUnavailable('failed'))
    for (let n = 0; n < 6; n++) expect(await host.listConversations()).toHaveProperty('refused')
    expect(read).toHaveBeenCalledTimes(3)
    move()
    await listing()
    expect(read).toHaveBeenCalledTimes(4)
    expect((await host.readForWindow(() => host.questionsForAPerson())).rows).toEqual([])
    expect(read).toHaveBeenCalledTimes(5)
    await listing()
    expect(read).toHaveBeenCalledTimes(5)
  } finally {
    await host.closeAll()
    await world.cleanUp()
  }
})
