import { join } from 'node:path'
import { expect, it, vi } from 'vitest'
import { aServiceWorld } from './helpers/a-service-world'
import { WindowReadEngine } from '../src/main/db/window-read-engine'
import type { WindowReadQuery, WindowReadResult } from '../src/main/db/window-read-protocol'
import { windowWriterSampler } from '../src/main/db/window-writer-stamp'
import { limitsWriterSampler } from '../src/main/db/fresh-limits-snapshot'
import type { RuntimeStatesMessage } from '../src/shared/runtime-ipc'

it('says kept files and states while a writer moves during every publication read', async () => {
  const world = aServiceWorld()
  world.anAgent('fictional-agent', 'normal')
  const engine = new WindowReadEngine(join(world.folder, 'brobot2.sqlite'))
  const pushed: RuntimeStatesMessage[] = []
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
  let writer: string | undefined
  const kinds: string[] = []
  const read = async (query: WindowReadQuery): Promise<WindowReadResult> => {
    kinds.push(query.kind)
    const result = engine.read(query)
    if (writer !== undefined && query.kind === 'publication')
      world.store.append(
        writer,
        world.store.nextOrdinal(writer),
        { type: 'status', state: kinds.length % 2 === 0 ? 'working' : 'idle' },
        world.clock++,
      )
    return result
  }
  const host = world.aHost({
    windowReader: { read, close: async () => engine.close() },
    windowWriterStamp: windowWriterSampler(world.db, () => true),
    limitsWriterStamp: limitsWriterSampler(world.db, () => true),
    statesMoved: (message) => pushed.push(message),
  })
  try {
    const id = await world.aPersonOpens(host, 'fictional-agent')
    await vi.waitFor(() => expect(pushed.length).toBeGreaterThan(0))
    writer = id
    const asked = kinds.length
    const kept = world.store.addResource(
      {
        piece: world.store.rootOf(id)!.piece,
        role: 'made',
        title: 'Fictional file',
        summary: null,
        name: 'fictional-1.md',
        sha256: 'a'.repeat(64),
        bytes: 1,
        addedBy: id,
      },
      world.clock,
    ).resource
    world.handles[0]!.handle.simulateBackgroundWork({
      running: [{ id: 'fictional-job', description: 'A notice' }],
    })
    await vi.waitFor(() =>
      expect(pushed.flatMap((one) => one.kept.map((file) => file.resourceId))).toContain(kept),
    )
    // Each write the read made marks a state again, and the flush it asks for reads once more.
    await new Promise((resolve) => setTimeout(resolve, 200))
    expect(kinds.slice(asked).filter((kind) => kind === 'publication').length).toBeLessThan(10)
    expect(warn).not.toHaveBeenCalledWith(expect.stringContaining('could not read changed states'))
  } finally {
    warn.mockRestore()
    await host.closeAll()
    await world.cleanUp()
  }
})
