import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { aServiceWorld, RecordingSink, type AServiceWorld } from './helpers/a-service-world'
import { openDatabase } from '../src/main/db/connection'
import type { RuntimeHost } from '../src/main/runtime/runtime-host'
import type { TranscriptEvent } from '../src/shared/runtime-ipc'

/**
 * Each answer of the person's queue is composed once and shared by every window that asks, until
 * something it reads moves: a commit holding a row the queue reads, another connection's commit, an
 * announcement such as a window handing a conversation back, or a state move. A walk that could not
 * read a row is said once and read again. The asks against agents' rules and the MCP server
 * requests are replayed once per version for every reader of them.
 */
describe('the person’s queue is composed once until it moves', () => {
  let world: AServiceWorld
  let host: RuntimeHost
  let giver: string
  const asked = () => [
    host.questionsForAPerson(),
    host.decisionsForAPerson(),
    host.instructionAsksForAPerson(),
    host.mcpServerRequestsForAPerson(),
    host.stalledWorkForAPerson(),
    host.stoppedWorkForAPerson(),
    host.waitingOnWhoWroteForAPerson(),
  ]
  const quiet = async () => {
    await vi.waitFor(async () => {
      const first = asked()
      await new Promise((resolve) => setTimeout(resolve, 50))
      const second = asked()
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

  it('three windows asking every answer at one version share each composition', async () => {
    await quiet()
    const walked = vi.spyOn(world.store, 'piecesWaitingOnWhoWrote')
    const replayed = vi.spyOn(world.store, 'mcpServerRequestsWaiting')
    const first = asked()
    const answers = [asked(), asked()]
    expect(walked).not.toHaveBeenCalled()
    expect(replayed).not.toHaveBeenCalled()
    for (const answer of answers) answer.forEach((one, at) => expect(one).toBe(first[at]))
  })

  it('a commit holding a row the queue reads composes it again', async () => {
    await quiet()
    const walked = vi.spyOn(world.store, 'piecesWaitingOnWhoWrote')
    world.store.append(
      giver,
      world.store.nextOrdinal(giver),
      { type: 'request_routed', requestId: 'fictional-q', to: 'a-person' } as TranscriptEvent,
      world.clock++,
    )
    host.waitingOnWhoWroteForAPerson()
    expect(walked).toHaveBeenCalledTimes(1)
  })

  it('words streamed move nothing the queue reads, and it stays shared', async () => {
    await quiet()
    const before = host.decisionsForAPerson()
    world.store.append(
      giver,
      world.store.nextOrdinal(giver),
      { type: 'assistant_message', text: 'fictional words' },
      world.clock++,
    )
    expect(host.decisionsForAPerson()).toBe(before)
  })

  it('another connection’s commit is heard before a kept answer is reused', async () => {
    await quiet()
    const before = host.stalledWorkForAPerson()
    const other = openDatabase(join(world.folder, 'brobot2.sqlite'))
    try {
      other.prepare('UPDATE provider_session SET cwd = ? WHERE id = ?').run('/tmp/elsewhere', giver)
    } finally {
      other.close()
    }
    expect(host.stalledWorkForAPerson()).not.toBe(before)
  })

  it('a live fact with no commit — a window handing a conversation back — composes again', async () => {
    const given = await world.gives(host, giver, 'helper')
    if (!given.ok) throw new Error('the give was refused')
    const helper = world.store.workById(given.piece)!.owner
    const other = new RecordingSink('webContents:2')
    await host.look(helper, other, true)
    await quiet()
    const before = host.decisionsForAPerson()
    const rows = world.store.events(helper).length
    host.releaseSession(helper, other)
    expect(world.store.events(helper).length).toBe(rows)
    expect(host.decisionsForAPerson()).not.toBe(before)
  })

  it('a walk that could not read a row is said once, and read again with nothing moved', async () => {
    await quiet()
    // A commit moves the queue, so the next ask composes; its walk counts one row unread, once.
    world.store.setModel(giver, 'fictional-model')
    const read = world.store.piecesWaitingOnWhoWrote.bind(world.store)
    const walked = vi
      .spyOn(world.store, 'piecesWaitingOnWhoWrote')
      .mockImplementationOnce((...args) => ({ ...read(...args), rowsUnread: 1 }))
    expect(host.waitingOnWhoWroteForAPerson().rowsUnread).toBe(1)
    const recovered = host.waitingOnWhoWroteForAPerson()
    expect(walked).toHaveBeenCalledTimes(2)
    expect(recovered.rowsUnread).toBe(0)
    expect(host.waitingOnWhoWroteForAPerson()).toBe(recovered)
  })

  it('the asks against agents’ rules are replayed once a version, for the queue, the workspace and the listing', async () => {
    await quiet()
    world.store.setModel(giver, 'fictional-model')
    const replayed = vi.spyOn(world.store, 'instructionAsksWaiting')
    host.instructionAsksForAPerson()
    host.readWorkspace()
    host.resumableSessions()
    host.unresumableSessions()
    expect(replayed).toHaveBeenCalledTimes(1)
  })
})
