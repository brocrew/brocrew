import { join } from 'node:path'
import { expect, it, vi } from 'vitest'
import { aServiceWorld } from './helpers/a-service-world'
import { aLibraryHost } from './helpers/files-library-fixture'
import { WindowReadEngine } from '../src/main/db/window-read-engine'
import type { WindowReadQuery } from '../src/main/db/window-read-protocol'
import { windowWriterSampler } from '../src/main/db/window-writer-stamp'
import { limitsWriterSampler } from '../src/main/db/fresh-limits-snapshot'

it('shows the conversation list while a writer moves after every consistent snapshot', async () => {
  const world = aServiceWorld()
  world.store.create({
    id: 'fictional-root',
    provider: 'codex',
    profileId: 'fictional',
    cwd: world.folder,
    approvalMode: 'ask',
  })
  const engine = new WindowReadEngine(join(world.folder, 'brobot2.sqlite'))
  let writing = true
  let writes = 0
  const read = vi.fn(async (query: WindowReadQuery) => {
    const result = engine.read(query)
    if (query.kind === 'listing' && writing) {
      world.store.append(
        'fictional-root',
        world.store.nextOrdinal('fictional-root'),
        { type: 'status', state: writes % 2 === 0 ? 'working' : 'idle' },
        world.clock++,
      )
      writes++
    }
    return result
  })
  const host = aLibraryHost(world.folder, {
    store: world.store,
    windowReader: { read, close: async () => engine.close() },
    afterFirstWindowLoad: new Promise<void>(() => {}),
    windowWriterStamp: windowWriterSampler(world.db, () => true),
    limitsWriterStamp: limitsWriterSampler(world.db, () => true),
  })
  try {
    for (let n = 0; n < 3; n++) {
      const answer = await host.listConversations()
      expect(answer).not.toHaveProperty('refused')
      if ('refused' in answer) throw new Error(answer.refused)
      expect([...answer.resumable, ...answer.unresumable].map((row) => row.sessionId)).toEqual([
        'fictional-root',
      ])
      expect(writing).toBe(true)
      expect(writes).toBe(n + 1)
      expect(read).toHaveBeenCalledTimes(n + 1)
    }

    // The moved snapshot was not cached as current: the first quiet read still reaches SQLite.
    writing = false
    const quiet = await host.listConversations()
    expect(quiet).not.toHaveProperty('refused')
    expect(read).toHaveBeenCalledTimes(4)
    await host.listConversations()
    expect(read).toHaveBeenCalledTimes(4)
  } finally {
    await host.closeAll()
    await world.cleanUp()
  }
})
