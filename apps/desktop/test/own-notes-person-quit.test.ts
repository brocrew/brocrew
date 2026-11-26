import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { createAppLifetime } from '../src/main/app-lifetime'
import { closeDatabase } from '../src/main/db/close-database'
import { executeRuntimeCommand, refusedDuringAQuit } from '../src/main/runtime/ipc'
import type { RuntimeHost } from '../src/main/runtime/runtime-host'
import { aServiceWorld, type AServiceWorld } from './helpers/a-service-world'
import { deferred } from './helpers/quit-open-list-cases'
import { stopFailedStart } from './helpers/stop-failed-start'

let world: AServiceWorld
let host: RuntimeHost
let publishedVersions: number[]
const profileId = 'notes-reader'
const mutation = (kind: 'saveOwnNotes' | 'undoOwnNotes') =>
  kind === 'saveOwnNotes'
    ? { kind, profileId, expectedVersion: 2, text: 'Person correction', why: 'Correct the notes' }
    : { kind, profileId, expectedVersion: 2 }

beforeEach(() => {
  world = aServiceWorld()
  world.anAgent(profileId, 'normal', 'claude')
  publishedVersions = []
  host = world.aHost({
    announce: ({ what }) => {
      if (what === 'agents')
        publishedVersions.push(world.store.currentOwnNotesOf(profileId)?.current?.version ?? 0)
    },
  })
  for (const [expectedVersion, text] of ['first', 'second'].entries()) {
    world.store.writeOwnNotes(
      profileId,
      { expectedVersion, text, why: 'seed' },
      { who: 'a-person' },
      world.clock++,
    )
  }
})
afterEach(async () => {
  vi.restoreAllMocks()
  await world.cleanUp()
})

for (const kind of ['saveOwnNotes', 'undoOwnNotes'] as const) {
  it.each(['normal quit', 'failed startup'] as const)(
    'holds the original database through ' + kind + ' readback on %s with an earlier failure',
    async (route) => {
      const notes = host['agentNotes']
      const readback = notes.ownNotesOf.bind(notes)
      const atReadback = deferred()
      const release = deferred()
      const order: string[] = []
      vi.spyOn(notes, 'ownNotesOf').mockImplementationOnce(async (profile) => {
        expect(publishedVersions).toEqual([3])
        atReadback.resolve()
        await release.promise
        const page = await readback(profile)
        order.push('read back')
        return page
      })
      const command = mutation(kind)
      const result = executeRuntimeCommand(host, world.window, command)
      await Promise.race([atReadback.promise, result])
      const failure = new Error('fictional earlier stop failed')
      const partial = route === 'failed startup' ? stopFailedStart(host, failure) : undefined
      const log = vi.fn()
      // A quit record may fail before the normal Host stop has begun.
      if (!partial) {
        vi.spyOn(
          host as unknown as { recordWhatTheQuitClosed(): void },
          'recordWhatTheQuitClosed',
        ).mockImplementationOnce(() => {
          throw failure
        })
      }
      let closedBeforeSessions: boolean | undefined
      const lifetime = createAppLifetime({
        announceClosing: () => {},
        recordOpenSessions: () => {
          if (!partial) host.recordOpenForQuit()
        },
        closeAllSessions: () => partial ?? host.closeAll(),
        stopArchiveWork: () => {
          closedBeforeSessions = host.closing
        },
        drainArchiveWork: () => host.drainArchiveWork(),
        closeDatabase: () => {
          order.push('close')
          closeDatabase(world.db)
        },
        quit: () => {},
        exit: () => {},
        armLastResort: () => {},
        log,
        now: Date.now,
      })
      lifetime.beforeQuit({ preventDefault() {} })
      try {
        await new Promise<void>((done) => setImmediate(done))
        if (!partial) expect(closedBeforeSessions).toBe(true)
        expect(world.db.open).toBe(true)
        expect(world.store.ownNotesOf(profileId)?.versions[0]?.version).toBe(3)
        expect(order).toEqual([])
        await expect(executeRuntimeCommand(host, world.window, command)).rejects.toThrow(
          refusedDuringAQuit(kind),
        )
      } finally {
        release.resolve()
        await lifetime.shuttingDown
      }
      expect(await result).toMatchObject({
        versions: [
          { version: 3, text: kind === 'saveOwnNotes' ? 'Person correction' : 'first' },
          { version: 2 },
          { version: 1 },
        ],
      })
      // A failed startup reports its earlier failure through stopFailedStart itself.
      if (!partial) expect(log.mock.calls.some((args) => args.includes(failure))).toBe(true)
      expect(order).toEqual(['read back', 'close'])
      expect(world.db.open).toBe(false)
    },
  )

  it('keeps the competing edit when ' + kind + ' resumes after its baseline read', async () => {
    const notes = host['agentNotes']
    const current = notes.currentOwnNotesOf.bind(notes)
    const atBaseline = deferred()
    const release = deferred()
    vi.spyOn(notes, 'currentOwnNotesOf').mockImplementationOnce(async (profile) => {
      const page = await current(profile)
      atBaseline.resolve()
      await release.promise
      return page
    })
    const result = executeRuntimeCommand(host, world.window, mutation(kind))
    try {
      await Promise.race([atBaseline.promise, result])
      expect(
        world.store.writeOwnNotes(
          profileId,
          { expectedVersion: 2, text: 'competing edit', why: 'update' },
          { who: 'a-person' },
          world.clock++,
        )?.version,
      ).toBe(3)
    } finally {
      release.resolve()
    }
    expect(await result).toBeNull()
    expect(publishedVersions).toEqual([])
    expect(world.store.ownNotesOf(profileId)?.versions.map(({ text }) => text)).toEqual([
      'competing edit',
      'second',
      'first',
    ])
  })
}
