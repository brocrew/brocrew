import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { aServiceWorld, RecordingSink, type AServiceWorld } from './helpers/a-service-world'
import { openDatabase } from '../src/main/db/connection'
import type { RuntimeHost } from '../src/main/runtime/runtime-host'

/**
 * Both halves of the listing are composed once and shared by every window that asks, until
 * something they read moves: a commit, another connection's commit, or a live fact such as who
 * holds a conversation. Each caller then gets the composition at the current version.
 */
describe('the listing is composed once until it moves', () => {
  let world: AServiceWorld
  let host: RuntimeHost
  let giver: string
  let compositions: () => number
  const listed = () => ({
    resumable: host.resumableSessions(),
    unresumable: host.unresumableSessions(),
  })
  const runningOf = (id: string) =>
    [...host.resumableSessions(), ...host.unresumableSessions()].find((row) => row.sessionId === id)
      ?.running

  beforeEach(async () => {
    world = aServiceWorld()
    world.anAgent('giver', 'normal')
    world.anAgent('helper', 'normal')
    host = world.aHost({ servicesOn: false })
    giver = await world.aPersonOpens(host, 'giver')
    const read = vi.spyOn(world.store, 'resumable')
    compositions = () => read.mock.calls.length
  })
  afterEach(async () => {
    vi.restoreAllMocks()
    await world.cleanUp()
  })

  it('three windows asking at one version share one composition of both halves', () => {
    listed()
    const before = compositions()
    const answers = [listed(), listed(), listed()]
    expect(compositions()).toBe(before)
    expect(answers[1]!.resumable).toBe(answers[0]!.resumable)
    expect(answers[2]!.unresumable).toBe(answers[0]!.unresumable)
  })

  it('a commit moves the version, and the next ask composes again', () => {
    listed()
    const before = compositions()
    world.store.setModel(giver, 'fictional-model')
    listed()
    expect(compositions()).toBe(before + 1)
  })

  it('another connection’s commit is heard before a kept listing is reused', () => {
    listed()
    const other = openDatabase(join(world.folder, 'brobot2.sqlite'))
    try {
      other.prepare('UPDATE provider_session SET cwd = ? WHERE id = ?').run('/tmp/elsewhere', giver)
    } finally {
      other.close()
    }
    const row = host.resumableSessions().find((one) => one.sessionId === giver)
    expect(row?.cwd).toBe('/tmp/elsewhere')
  })

  it('a live fact with no commit — a window handing a conversation back — composes again', async () => {
    const given = await world.gives(host, giver, 'helper')
    if (!given.ok) throw new Error('the give was refused')
    const helper = world.store.workById(given.piece)!.owner
    await vi.waitFor(() => expect(runningOf(helper)).toBe('unwatched'))
    const other = new RecordingSink('webContents:2')
    await host.look(helper, other, true)
    expect(runningOf(helper)).toBe('in-a-window')
    // Quiet: nothing commits across a turn of the timers, so the listing is being shared.
    await vi.waitFor(async () => {
      listed()
      const settled = compositions()
      await new Promise((resolve) => setTimeout(resolve, 50))
      listed()
      expect(compositions()).toBe(settled)
    })
    const before = compositions()
    const rows = world.store.events(helper).length
    host.releaseSession(helper, other)
    expect(world.store.events(helper).length).toBe(rows)
    expect(runningOf(helper)).toBe('unwatched')
    expect(compositions()).toBeGreaterThan(before)
  })
})
