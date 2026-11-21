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
    // The writer only appended, so the worker carries its kept folds forward: no owner is named.
    expect(read.mock.calls[3]![0]).toMatchObject({ kind: 'listing', reuse: { changed: [] } })

    read.mockImplementation(async (query) => {
      const result = engine.read(query)
      world.store.append(
        'fictional-root',
        world.store.nextOrdinal('fictional-root'),
        { type: 'status', state: 'idle' },
        world.clock++,
      )
      return result
    })
    const asked = read.mock.calls.length
    expect((await host.readForWindow(() => host.questionsForAPerson())).rows).toEqual([])
    expect(read).toHaveBeenCalledTimes(asked + 2)
    // Kept under the snapshot's origin, so the next look reads again.
    expect((await host.readForWindow(() => host.questionsForAPerson())).rows).toEqual([])
    expect(read).toHaveBeenCalledTimes(asked + 4)

    let schema = 0
    read.mockImplementation(async (query) => {
      const result = engine.read(query)
      world.db.exec(`CREATE TABLE fictional_schema_${schema++} (id INTEGER)`)
      return result
    })
    expect(await host.listConversations()).toHaveProperty('refused')

    let release!: () => void
    const waiting = new Promise<void>((resolve) => {
      release = resolve
    })
    read.mockImplementation(async (query) => {
      const result = engine.read(query)
      await waiting
      return result
    })
    const closingRead = host.listConversations()
    await host.closeAll()
    release()
    expect(await closingRead).toHaveProperty('refused')
  } finally {
    await host.closeAll()
    await world.cleanUp()
  }
})
