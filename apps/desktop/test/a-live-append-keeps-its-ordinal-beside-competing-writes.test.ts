import { aWorkWaitFixture } from './helpers/work-wait-fixture'
import { waitFor } from './lib/f093-host'
import { settle } from './helpers/persisted-wait-revision-cases'
import type { WorkReconciliationEvent } from '../src/shared/reconciliation-contracts'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { openDatabase } from '../src/main/db/connection'
import { createSessionStore } from '../src/main/db/session-store'
import type { RuntimeHost } from '../src/main/runtime/runtime-host'

describe('a work wait is reconciled without a window', () => {
  const f = aWorkWaitFixture()
  const { create, tick, window } = f

  async function heldTurnForOrdinalReads() {
    f.keepTurnsOpen = true
    const { owner } = await create()
    await f.host.send(owner, 'A fictional held turn.', window)
    await waitFor(() => f.store.theOpenTurn(owner) !== null, 'the held turn')
    const live = f.host as unknown as {
      slots: Map<string, { session: { id: string; ordinal: number } }>
      deliver(session: unknown, event: { type: 'assistant_delta'; text: string }): void
    }
    const session = live.slots.get(owner)!.session
    return { owner, live, session }
  }

  it('ordinary live appends allocate without an additional SQL read', async () => {
    const { owner, live, session } = await heldTurnForOrdinalReads()
    const event = { type: 'assistant_delta' as const, text: 'fictional text' }
    const baseline: string[] = []
    for (let n = 0; n < 20; n++) {
      const ordinal = f.store.nextOrdinal(owner)
      f.sqlReads = []
      f.store.append(owner, ordinal, event, tick())
      baseline.push(...f.sqlReads)
      f.sqlReads = null
    }
    // Account once for the deliberately competing direct store writes above.
    live.deliver(session, event)
    const floors = vi.spyOn(f.store, 'nextOrdinal')
    f.sqlReads = []
    for (let n = 0; n < 20; n++) live.deliver(session, event)
    const actual = f.sqlReads
    f.sqlReads = null
    expect(floors).not.toHaveBeenCalled()
    expect(actual).toEqual(baseline)
    expect(actual.filter((sql) => /max\(ordinal\)/i.test(sql))).toEqual([])
    expect(f.store.nextOrdinal(owner)).toBeLessThanOrEqual(session.ordinal)
  })

  it('a rolled-back competing write refreshes once without retaining its ordinal', async () => {
    const { owner, live, session } = await heldTurnForOrdinalReads()
    const next = f.store.nextOrdinal(owner)
    expect(() =>
      f.store.atomically(() => {
        f.store.append(owner, next, { type: 'assistant_delta', text: 'rolled back' }, tick())
        throw new Error('the fictional transaction rolled back')
      }),
    ).toThrow('the fictional transaction rolled back')
    const floors = vi.spyOn(f.store, 'nextOrdinal')
    live.deliver(session, { type: 'assistant_delta', text: 'kept after rollback' })
    live.deliver(session, { type: 'assistant_delta', text: 'next kept event' })
    expect(floors).toHaveBeenCalledTimes(1)
    expect(f.store.nextOrdinal(owner)).toBeLessThanOrEqual(session.ordinal)
    expect(
      f.store
        .events(owner)
        .filter((one) => one.event.type === 'assistant_delta')
        .map((one) => [one.ordinal, one.event]),
    ).toEqual([
      [next, { type: 'assistant_delta', text: 'kept after rollback' }],
      [next + 1, { type: 'assistant_delta', text: 'next kept event' }],
    ])
  })

  it('a receipt from another store cannot steal the holder next event ordinal', async () => {
    f.keepTurnsOpen = true
    const { owner, work } = await create()
    await f.host.send(owner, 'A fictional held turn.', window)
    await waitFor(() => f.store.theOpenTurn(owner) !== null, 'the held turn')
    const originalStore = f.store
    const otherDb = openDatabase(join(f.userData, 'brobot2.sqlite'))
    let other: RuntimeHost | undefined
    const engine = f.host as unknown as {
      reconcileWork(holders?: ReadonlySet<string>): void
      slots: Map<string, { session: { ordinal: number } }>
    }
    const paused = vi.spyOn(engine, 'reconcileWork').mockImplementation(() => {})
    const session = engine.slots.get(owner)!.session
    const reserved = session.ordinal
    try {
      f.store = createSessionStore(otherDb, tick)
      f.firstLoad = new Promise(() => {})
      other = f.build()
      f.store = originalStore
      const writer = other as unknown as {
        keepReconciliation(owner: string, event: WorkReconciliationEvent): boolean
      }
      const receipt: WorkReconciliationEvent = {
        type: 'work_reconciliation',
        incident: 'fictional-racing-receipt',
        piece: work.piece,
        kind: 'stopped',
        since: tick(),
        step: 'holder',
        outcome: 'planned',
        target: owner,
        messageId: 'fictional-racing-reminder',
      }
      expect(writer.keepReconciliation(owner, receipt)).toBe(true)
      expect(f.store.nextOrdinal(owner)).toBeGreaterThan(reserved)
      expect(session.ordinal).toBe(reserved)
      ;(
        f.handles[0] as unknown as { machine: { completeTurn(state: 'completed'): void } }
      ).machine.completeTurn('completed')
      await settle()
      expect(f.store.nextOrdinal(owner)).toBeLessThanOrEqual(session.ordinal)
      const entries = f.store.events(owner)
      const reminder = entries.find((one) => one.event.type === 'work_reconciliation')!
      const terminal = entries.find(
        (one) =>
          one.ordinal > reminder.ordinal &&
          one.event.type === 'turn' &&
          one.event.state === 'completed',
      )
      expect(terminal).toBeDefined()
      expect(session.ordinal).toBeGreaterThan(terminal!.ordinal)
      expect(new Set(entries.map((one) => one.ordinal)).size).toBe(entries.length)
    } finally {
      f.store = originalStore
      f.firstLoad = undefined
      await other?.closeAll()
      otherDb.close()
      paused.mockRestore()
    }
  })
})
