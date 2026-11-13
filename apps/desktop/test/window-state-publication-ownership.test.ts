import { join } from 'node:path'
import Database from 'better-sqlite3'
import { expect, it, vi } from 'vitest'
import { aServiceWorld } from './helpers/a-service-world'
import { WindowReadEngine } from '../src/main/db/window-read-engine'
import {
  WindowReadUnavailable,
  type WindowReadQuery,
  type WindowReadResult,
} from '../src/main/db/window-read-protocol'
import { windowWriterSampler } from '../src/main/db/window-writer-stamp'
import { limitsWriterSampler } from '../src/main/db/fresh-limits-snapshot'
import type { RuntimeStatesMessage } from '../src/shared/runtime-ipc'

it('owns state and file marks through superseding notices, partial failures, delivery failure and quit', async () => {
  let writer: Database.Database | undefined
  let measuring = false
  let mainHistoryQueries = 0
  const prepare = Database.prototype.prepare
  const nativeReads = vi.spyOn(Database.prototype, 'prepare').mockImplementation(function (this: Database.Database, sql: string) {
    const connection = this
    const statement = prepare.call(this, sql) as Database.Statement<unknown[], unknown>
    if (!/^\s*(SELECT|WITH)\b/i.test(sql) || !/\bevents\b/i.test(sql) || !/\bpayload\b/i.test(sql)) return statement
    return new Proxy(statement, {
      get(native, key) {
        if (key === 'get' || key === 'all' || key === 'iterate')
          return (...args: unknown[]) => {
            if (measuring && connection === writer && /statesThatMoved|whatWasKept|sayWhatMoved/.test(new Error().stack ?? '')) mainHistoryQueries++
            return native[key](...args)
          }
        const value: unknown = Reflect.get(native, key, native)
        return typeof value === 'function' ? value.bind(native) : value
      },
    })
  })
  const world = aServiceWorld()
  writer = world.db
  world.anAgent('fictional-agent', 'normal')
  const engine = new WindowReadEngine(join(world.folder, 'brobot2.sqlite'))
  const pushed: RuntimeStatesMessage[] = []
  let hold = false
  let failStates = false
  let failFiles = false
  let failDelivery = false
  let held: { finish: () => void; reject: () => void } | undefined
  let closed = false
  let reads = 0
  const read = async (query: WindowReadQuery): Promise<WindowReadResult> => {
    reads++
    let result = engine.read(query)
    if (result.kind === 'publication') {
      if (failStates) result = { ...result, states: null }
      if (failFiles)
        result = {
          ...result,
          files: [],
          failedFiles: query.kind === 'publication' ? query.kept.map((one) => one.piece) : [],
        }
    }
    if (hold) {
      hold = false
      await new Promise<void>((resolve, reject) => {
        held = { finish: resolve, reject: () => reject(new WindowReadUnavailable()) }
      })
    }
    return result
  }
  const host = world.aHost({
    servicesOn: false,
    windowReader: {
      read,
      close: async () => {
        held?.reject()
        if (!closed) {
          closed = true
          engine.close()
        }
      },
    },
    windowWriterStamp: windowWriterSampler(world.db, () => true),
    limitsWriterStamp: limitsWriterSampler(world.db, () => true),
    statesMoved: (message) => {
      if (failDelivery) {
        failDelivery = false
        throw new Error('fictional delivery failure')
      }
      pushed.push(message)
    },
  })
  try {
    const id = await world.aPersonOpens(host, 'fictional-agent')
    await vi.waitFor(() => expect(pushed.length).toBeGreaterThan(0))
    measuring = true
    const handle = world.handles[0]!.handle
    const root = world.store.rootOf(id)!.piece
    let number = 0
    const keep = () =>
      world.store.addResource(
        {
          piece: root,
          role: 'made',
          title: 'Fictional file',
          summary: null,
          name: `fictional-${++number}.md`,
          sha256: 'a'.repeat(64),
          bytes: 1,
          addedBy: id,
        },
        world.clock,
      ).resource
    const notice = (description: string) =>
      handle.simulateBackgroundWork({ running: [{ id: 'fictional-job', description }] })
    const files = () => pushed.flatMap((one) => one.kept.map((file) => file.resourceId))
    const states = (from: number) =>
      pushed.slice(from).flatMap((one) => one.moved.map((moved) => moved.state))

    const before = pushed.length
    hold = true
    notice('First notice')
    await vi.waitFor(() => expect(held).toBeDefined())
    const retained = keep()
    notice('Superseding notice')
    held!.finish()
    held = undefined
    await vi.waitFor(() => {
      expect(states(before)).toContainEqual({ is: 'in-the-background', what: 'Superseding notice' })
      expect(files()).toContain(retained)
    })
    expect(states(before)).not.toContainEqual({ is: 'in-the-background', what: 'First notice' })

    failStates = true
    const fileOnly = keep()
    notice('State read failed')
    await vi.waitFor(() => expect(files()).toContain(fileOnly))
    failStates = false
    notice('State recovered')
    await vi.waitFor(() =>
      expect(states(before)).toContainEqual({ is: 'in-the-background', what: 'State recovered' }),
    )

    failFiles = true
    const delayed = keep()
    notice('Files read failed')
    await vi.waitFor(() =>
      expect(states(before)).toContainEqual({ is: 'in-the-background', what: 'Files read failed' }),
    )
    expect(files()).not.toContain(delayed)
    failFiles = false
    notice('Files recovered')
    await vi.waitFor(() => expect(files()).toContain(delayed))

    failDelivery = true
    const undelivered = keep()
    notice('Delivery failed')
    await vi.waitFor(() => expect(failDelivery).toBe(false))
    expect(files()).not.toContain(undelivered)
    notice('Delivery recovered')
    await vi.waitFor(() => expect(files()).toContain(undelivered))
    expect(files().filter((one) => one === undelivered)).toHaveLength(1)
    const sequences = pushed.map((one) => {
      expect(one.published).toBeDefined()
      return one.published!.seq
    })
    expect(sequences.every((seq, index) => index === 0 || seq > sequences[index - 1]!)).toBe(true)

    hold = true
    notice('Must not publish after quit')
    await vi.waitFor(() => expect(held).toBeDefined())
    const atQuit = pushed.length
    await host.closeAll()
    expect(pushed).toHaveLength(atQuit)
    expect(closed).toBe(true)
    expect(mainHistoryQueries).toBe(0)
    console.info(
      JSON.stringify({
        publicationOwnership: { reads, pushes: pushed.length, files: files().length, mainHistoryQueries },
      }),
    )
  } finally {
    held?.finish()
    await host.closeAll()
    await world.cleanUp()
    nativeReads.mockRestore()
  }
}, 30_000)
