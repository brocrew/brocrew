import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { aServiceWorld, type AServiceWorld } from './helpers/a-service-world'
import { openDatabase } from '../src/main/db/connection'
import type { RuntimeHost } from '../src/main/runtime/runtime-host'
import {
  WindowReadUnavailable,
  type WindowRoutes,
  type WindowStoreReader,
} from '../src/main/db/window-read-protocol'

/**
 * A commit another connection makes is heard before a window answer is composed — whether the
 * worker's reading is served, reused, or the answer is read on the main thread — so the host's
 * kept readings never meet a foreign commit unannounced. One resync each time.
 */
describe('a commit another connection makes is heard before a window answer', () => {
  let world: AServiceWorld
  let host: RuntimeHost
  let conversation: string
  let resyncs: number
  let release: () => void
  let held: Promise<void>
  let served: boolean
  const stamp = {
    writer: {},
    watcher: 0,
    revision: 1n,
    dataVersion: 1n,
    at: 0,
  }
  const reader: WindowStoreReader = {
    read: async () => {
      await held
      if (!served) throw new WindowReadUnavailable()
      // What the store itself reads, as the worker would hand it over.
      const routes: WindowRoutes = {
        kind: 'routes',
        routes: [],
        questions: world.store.questionsAPersonMustAnswer(),
        decisions: world.store.decisionsAwaitingAPerson(),
      }
      return routes
    },
    close: async () => undefined,
  }
  const anotherConnectionCommits = (cwd: string) => {
    const other = openDatabase(join(world.folder, 'brobot2.sqlite'))
    try {
      other.prepare('UPDATE provider_session SET cwd = ? WHERE id = ?').run(cwd, conversation)
    } finally {
      other.close()
    }
  }

  beforeEach(async () => {
    world = aServiceWorld()
    world.anAgent('reader', 'normal')
    held = Promise.resolve()
    served = true
    host = world.aHost({
      servicesOn: false,
      windowWriterStamp: () => stamp,
      windowReader: reader,
    })
    conversation = await world.aPersonOpens(host, 'reader')
    resyncs = 0
    world.store.onCommitted((change) => {
      if (change.resync) resyncs += 1
    })
  })
  afterEach(async () => world.cleanUp())

  it('during the worker’s wait, and again when its reading is reused', async () => {
    held = new Promise<void>((resolve) => (release = resolve))
    const composed: number[] = []
    const reading = host.readForWindow(() => composed.push(resyncs))
    await new Promise((resolve) => setImmediate(resolve))
    anotherConnectionCommits('/tmp/fictional-elsewhere')
    release()
    await reading
    expect(composed).toEqual([1])

    anotherConnectionCommits('/tmp/fictional-elsewhere-again')
    await host.readForWindow(() => composed.push(resyncs))
    expect(composed).toEqual([1, 2])
  })

  it('when the answer is read on the main thread', async () => {
    served = false
    const composed: number[] = []
    anotherConnectionCommits('/tmp/fictional-elsewhere')
    await host.readForWindow(() => composed.push(resyncs))
    expect(composed).toEqual([1])
  })
})
