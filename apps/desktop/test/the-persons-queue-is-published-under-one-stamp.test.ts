import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { aServiceWorld, RecordingSink, type AServiceWorld } from './helpers/a-service-world'
import { openDatabase } from '../src/main/db/connection'
import type { RuntimeHost } from '../src/main/runtime/runtime-host'
import type { RuntimeChangeMessage, TranscriptEvent } from '../src/shared/runtime-ipc'
import { PERSONS_PARTS, type PersonsQueue } from '../src/shared/persons-published'

/**
 * The person's queue is answered as one publication: all eight parts under one `{epoch, seq}`, each
 * with its own coverage. The sequence moves wherever a version a window reads moves; the epoch moves
 * only on a resync. A part is included only if it is exact at the stamp; otherwise it is refused.
 */
describe('the person’s queue is published under one stamp', () => {
  let world: AServiceWorld
  let host: RuntimeHost
  let giver: string
  let announced: RuntimeChangeMessage[]

  const routed = (requestId: string) =>
    world.store.append(
      giver,
      world.store.nextOrdinal(giver),
      { type: 'request_routed', requestId, to: 'a-person' } as TranscriptEvent,
      world.clock,
    )
  const queue = async (): Promise<PersonsQueue> => {
    const answer = await host.personsQueue()
    if ('refused' in answer) throw new Error(`the queue was refused: ${answer.refused}`)
    return answer
  }
  /** A write from another connection, as another process writes. */
  const fromOutside = (sql: string, ...args: unknown[]) => {
    const other = openDatabase(join(world.folder, 'brobot2.sqlite'))
    try {
      other.prepare(sql).run(...args)
    } finally {
      other.close()
    }
  }
  /** Runs `between` after the incidents are composed and before the other parts are assembled. */
  const betweenIncidentsAndAssembly = (between: () => void) => {
    const assemble = host.readForWindow.bind(host)
    vi.spyOn(host, 'readForWindow').mockImplementationOnce(async (answer) => {
      between()
      return assemble(answer)
    })
  }
  const aHelperHoldingWork = async (): Promise<{ helper: string; piece: string }> => {
    const given = await world.gives(host, giver, 'helper')
    if (!given.ok) throw new Error('the give was refused')
    return { helper: world.store.workById(given.piece)!.owner, piece: given.piece }
  }
  /** Quiet: the helper's turn has settled, and nothing moves the stamp across a turn of the timers. */
  const settled = async () => {
    await vi.waitFor(async () => {
      const first = (await queue()).published.seq
      await new Promise((resolve) => setTimeout(resolve, 50))
      expect((await queue()).published.seq).toBe(first)
    })
  }

  beforeEach(async () => {
    world = aServiceWorld()
    world.anAgent('giver', 'normal')
    world.anAgent('helper', 'normal')
    announced = []
    host = world.aHost({ servicesOn: false, announce: (message) => announced.push(message) })
    giver = await world.aPersonOpens(host, 'giver')
  })
  afterEach(async () => {
    vi.restoreAllMocks()
    await world.cleanUp()
  })

  it('the epoch names this run, starts at 0, moves on a resync and never on an own commit', () => {
    const first = host.currentEpoch()
    expect(first.n).toBe(0)
    expect(first.reason).toBeUndefined()
    expect(first.run).toMatch(/\S/)
    routed('fictional-own')
    expect(host.currentEpoch()).toEqual(first)
    fromOutside('UPDATE provider_session SET cwd = ? WHERE id = ?', '/tmp/elsewhere', giver)
    expect(host.currentEpoch()).toEqual({ run: first.run, n: 1, reason: 'resync' })
  })

  it('all eight parts answer under one stamp, each complete', async () => {
    const answer = await queue()
    expect(Object.keys(answer.published.covers).sort()).toEqual([...PERSONS_PARTS].sort())
    for (const part of PERSONS_PARTS) {
      expect(answer[part], part).not.toBeNull()
      expect(answer.published.covers[part]).toEqual({
        population: 'persons',
        scope: part,
        complete: true,
      })
    }
    expect(answer.published.epoch).toEqual(host.currentEpoch())
    expect(answer.instructionAsks).toEqual({ rows: [], rowsUnread: 0 })
    expect(answer.mcpServerRequests).toEqual({ rows: [], rowsUnread: 0 })
  })

  it('every move of a version advances the stamp: a row the queue reads, a commit only the listing reads, a live hand-back', async () => {
    const { helper } = await aHelperHoldingWork()
    const other = new RecordingSink('webContents:2')
    await host.look(helper, other, true)
    const s0 = (await queue()).published.seq
    routed('fictional-q')
    const s1 = (await queue()).published.seq
    expect(s1).toBeGreaterThan(s0)
    world.store.setModel(giver, 'fictional-model')
    const s2 = (await queue()).published.seq
    expect(s2).toBeGreaterThan(s1)
    host.releaseSession(helper, other)
    expect((await queue()).published.seq).toBeGreaterThan(s2)
  })

  it('a torn instruction row and a torn MCP row are counted in their parts, which are then partial', async () => {
    const insert = `INSERT INTO events (id, session_id, generation, ordinal, type, payload, created_at)
                    VALUES (?, ?, 0, ?, ?, '{not json', ?)`
    fromOutside(insert, 'evt_torn_ask', giver, 90_000, 'instruction_proposed', world.clock)
    fromOutside(insert, 'evt_torn_mcp', giver, 90_001, 'mcp_server_requested', world.clock)
    const answer = await queue()
    expect(answer.instructionAsks).toEqual({ rows: [], rowsUnread: 1 })
    expect(answer.mcpServerRequests).toEqual({ rows: [], rowsUnread: 1 })
    for (const part of ['instructionAsks', 'mcpServerRequests'] as const)
      expect(answer.published.covers[part]).toEqual({
        population: 'persons',
        scope: part,
        complete: false,
        ids: [],
      })
    // The old reads still answer bare arrays.
    expect(host.instructionAsksForAPerson()).toEqual([])
    expect(host.mcpServerRequestsForAPerson()).toEqual([])
  })

  it('a part whose read fails is null and refused in its coverage, while the others answer', async () => {
    vi.spyOn(
      host as unknown as { readWorkIncidentsForAPerson: () => unknown },
      'readWorkIncidentsForAPerson',
    ).mockImplementation(() => {
      throw new Error('fictional failure')
    })
    const answer = await queue()
    expect(answer.incidents).toBeNull()
    expect(answer.published.covers.incidents).toEqual({
      population: 'persons',
      scope: 'incidents',
      complete: false,
      ids: [],
    })
    expect(answer.questions).not.toBeNull()
    expect(answer.published.covers.questions.complete).toBe(true)
  })

  it('incidents composed before a commit are refused at assembly, and included with nothing between', async () => {
    await aHelperHoldingWork()
    await settled()
    expect((await queue()).incidents).not.toBeNull()
    betweenIncidentsAndAssembly(() => routed('fictional-between'))
    const answer = await queue()
    expect(answer.incidents).toBeNull()
    expect(answer.published.covers.incidents.complete).toBe(false)
    expect(answer.questions).not.toBeNull()
  })

  it('incidents are refused when a wait on a time they read ends before assembly', async () => {
    const { helper, piece } = await aHelperHoldingWork()
    const at = world.clock + 60_000
    world.store.append(
      helper,
      world.store.nextOrdinal(helper),
      {
        type: 'work_status_set',
        piece,
        line: 'Fictional wait.',
        by: helper,
        waiting: true,
        on: { kind: 'time', at },
      } as TranscriptEvent,
      world.clock,
    )
    await settled()
    expect((await queue()).incidents).not.toBeNull()
    betweenIncidentsAndAssembly(() => {
      world.clock = at
    })
    expect((await queue()).incidents).toBeNull()
  })

  it('incidents are refused when a live fact they read moves before assembly', async () => {
    const { helper } = await aHelperHoldingWork()
    await settled()
    expect((await queue()).incidents).not.toBeNull()
    const held = (host as unknown as { heldAtAStop: Map<string, unknown[]> }).heldAtAStop
    betweenIncidentsAndAssembly(() => held.set(helper, [{}]))
    try {
      expect((await queue()).incidents).toBeNull()
    } finally {
      held.delete(helper)
    }
  })

  it('the persons notice carries the stamp it was made at', async () => {
    const before = (await queue()).published.seq
    announced = []
    routed('fictional-notice')
    const notice = announced.find((one) => one.what === 'persons')
    expect(notice?.published?.epoch).toEqual(host.currentEpoch())
    expect(notice?.published?.seq).toBeGreaterThan(before)
    expect((await queue()).published.seq).toBeGreaterThanOrEqual(notice!.published!.seq)
  })
})
