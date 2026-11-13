import { expect, it, vi } from 'vitest'
import type { AppDatabase } from '../../src/main/db/connection'
import { createSessionStore, type SessionStore } from '../../src/main/db/session-store'
import { WindowReadEngine } from '../../src/main/db/window-read-engine'
import { WindowIncidentReads } from '../../src/main/db/window-incident-reads'
import { WindowRoutingReads } from '../../src/main/db/window-routing-reads'
import { WindowReadUnavailable, windowReadResult } from '../../src/main/db/window-read-protocol'
import { rowsUnreadOnce } from '../../src/main/db/rows-unread'
import { RuntimeHost } from '../../src/main/runtime/runtime-host'
import { aLibraryHost } from './files-library-fixture'

export function windowIncidentCases(
  fixture: () => {
    store: SessionStore
    db: AppDatabase
    engine: WindowReadEngine
    directory: string
    hosts: RuntimeHost[]
    ordinal: number
    row(session: string, type: string, payload: object | string, generation?: number): void
  },
) {
  it('projects incident history without main reads and preserves failed receipts and closed wait targets', () => {
    const { store, engine, row } = fixture()
    const root = store.ensurePersonalRoot('alpha', 1)
    row('alpha', 'work_given', {
      type: 'work_given',
      piece: 'child',
      parent: root.piece,
      label: `${root.label}.1`,
      givenBy: 'beta',
      title: 'Fictional',
      brief: 'A private brief stays off the wait-target projection.',
    })
    row('alpha', 'work_closed', { type: 'work_closed', piece: 'child' })
    row('alpha', 'work_status_set', {
      type: 'work_status_set',
      piece: root.piece,
      line: 'A fictional wait',
      by: 'alpha',
      at: 10,
    })
    const reads = new WindowIncidentReads(
      () => null,
      () => null,
    )
    const forbidden = new Proxy(store, {
      get(target, key) {
        if (
          [
            'rootLines',
            'turnBlockRootLines',
            'reconciliationReceipts',
            'reconciliationRecovery',
            'theNewestTurn',
            'reconciliationDrivenByTurn',
            'whenAPersonLastWrote',
            'workReportedTo',
            'legacyOrdinaryStallWasReported',
            'piecesOwnedBy',
          ].includes(String(key))
        )
          return () => {
            throw new Error(`main history: ${String(key)}`)
          }
        const value: unknown = Reflect.get(target, key, target)
        return typeof value === 'function' ? value.bind(target) : value
      },
    })
    const projected = reads.store(forbidden)
    const check = () => {
      const snapshot = engine.read({ kind: 'incidents' })
      if (snapshot.kind !== 'incidents') throw new Error('wrong snapshot')
      expect(windowReadResult.safeParse(snapshot).success).toBe(true)
      reads.run(() => {
        expect(projected.rootLines(root.piece)).toEqual(store.rootLines(root.piece))
        expect(projected.turnBlockRootLines(root.piece)).toEqual(
          store.turnBlockRootLines(root.piece),
        )
        expect(projected.reconciliationRecovery('alpha')).toEqual(
          store.reconciliationRecovery('alpha'),
        )
        expect(projected.theNewestTurn('alpha')).toEqual(store.theNewestTurn('alpha'))
        expect(projected.whenAPersonLastWrote('alpha')).toEqual(store.whenAPersonLastWrote('alpha'))
        expect(reads.waitTarget('alpha', 'child', rowsUnreadOnce())).toEqual({ state: 'closed' })
        expect(reads.waitTarget('alpha', 'absent', rowsUnreadOnce())).toEqual({ state: null })
      }, snapshot)
      return snapshot
    }
    const complete = check()
    reads.run(
      () => expect(projected.reconciliationReceipts('alpha', root.piece)).toEqual([]),
      complete,
    )
    row('alpha', 'work_reconciliation', '{')
    const unread = check()
    reads.run(
      () =>
        expect(() => projected.reconciliationReceipts('alpha', root.piece)).toThrow(
          WindowReadUnavailable,
        ),
      unread,
    )
    row('alpha', 'work_recovery', '{')
    const recoveryUnread = engine.read({ kind: 'incidents' })
    if (recoveryUnread.kind !== 'incidents') throw new Error('wrong snapshot')
    reads.run(
      () => expect(() => projected.reconciliationRecovery('alpha')).toThrow(WindowReadUnavailable),
      recoveryUnread,
    )
  })

  it('keeps legacy stall ordinal evidence with a reused owner fold', () => {
    const { store, db, engine, row } = fixture()
    const root = store.ensurePersonalRoot('alpha', 1)
    row('alpha', 'work_given', {
      type: 'work_given',
      piece: 'legacy-child',
      parent: root.piece,
      label: `${root.label}.1`,
      givenBy: 'beta',
      title: 'Fictional',
      brief: 'Fictional',
    })
    row('alpha', 'status', { type: 'status', state: 'working' })
    row('alpha', 'status', { type: 'status', state: 'idle' })
    row('beta', 'work_stall_told', {
      type: 'work_stall_told',
      piece: 'legacy-child',
      cause: 'turn_ended',
      how: 'pushed',
    })
    db.prepare(
      'INSERT OR REPLACE INTO work_legacy_stall_cut(session_id,generation,through_ordinal) VALUES (?,0,?)',
    ).run('alpha', fixture().ordinal)
    expect(store.legacyOrdinaryStallWasReported('alpha', 'legacy-child', 'beta')).toBe(true)
    const first = engine.read({ kind: 'routes' })
    if (first.kind !== 'routes' || first.cacheToken === undefined)
      throw new Error('missing route token')
    const second = engine.read({
      kind: 'incidents',
      reuse: { token: first.cacheToken, changed: [] },
    })
    if (second.kind !== 'incidents') throw new Error('wrong snapshot')
    expect(second.owners.find((one) => one.sessionId === 'alpha')?.history.legacy).toContainEqual([
      'legacy-child',
      'beta',
      { value: true },
    ])
  })

  it('reads incident dependencies canonically, including corrupt rows and changed generations', () => {
    const { store, db, engine, row } = fixture()
    store.ensurePersonalRoot('alpha', 1)
    store.ensurePersonalRoot('beta', 1)
    row('alpha', 'message_queued', {
      type: 'message_queued',
      messageId: 'held',
      kind: 'work',
      text: 'Fictional words.',
    })
    row('alpha', 'message_unqueued', '{')
    row('alpha', 'work_interrupted', '{')
    const compare = () => {
      const actual = engine.read({ kind: 'incidents' })
      if (actual.kind !== 'incidents') throw new Error('wrong incident result')
      expect(actual.owners.map((one) => one.sessionId).sort()).toEqual(['alpha', 'beta'])
      for (const one of actual.owners) {
        const fresh = createSessionStore(db)
        const messages = rowsUnreadOnce()
        const stop = rowsUnreadOnce()
        const pieces = rowsUnreadOnce()
        const routes = rowsUnreadOnce()
        expect(one.pieces).toEqual(fresh.openPiecesOf(one.sessionId, pieces))
        expect(one.work).toEqual(fresh.reconciliationWork(new Set([one.sessionId]), pieces))
        expect(one.routes).toEqual(fresh.routedRequestsOf(one.sessionId, routes))
        expect(one.messages).toEqual(fresh.messagesWaitingIn(one.sessionId, messages))
        expect(one.stop).toEqual(fresh.lastAskToStop(one.sessionId, stop))
        expect(one.messagesSkipped.length).toBe(messages.count + messages.ledgersSkipped)
        expect(one.stopSkipped.length).toBe(stop.count + stop.ledgersSkipped)
        expect(one.piecesSkipped.length).toBe(pieces.count + pieces.ledgersSkipped)
        expect(one.routesSkipped.length).toBe(routes.count + routes.ledgersSkipped)
      }
      return actual
    }
    const first = compare().owners.find((one) => one.sessionId === 'alpha')!
    expect(first.messagesSkipped.length).toBeGreaterThan(0)
    expect(first.stopSkipped.length).toBeGreaterThan(0)
    db.prepare('UPDATE events SET generation = 3 WHERE session_id = ?').run('alpha')
    expect(compare().owners.find((one) => one.sessionId === 'alpha')?.messagesSkipped).toEqual([])
    expect(() => engine.read({ kind: 'incidents' }, () => true)).toThrow(WindowReadUnavailable)
  })

  it('projects root-first open work while explicit readers and no-worker reads keep their semantics', () => {
    const { store, engine, row, directory, hosts } = fixture()
    const root = store.ensurePersonalRoot('alpha', 1)
    for (const [piece, label] of [
      ['open-child', `${root.label}.2`],
      ['closed-child', `${root.label}.3`],
    ])
      row('alpha', 'work_given', {
        type: 'work_given',
        piece,
        label,
        parent: root.piece,
        givenBy: 'beta',
        title: 'Fictional',
        brief: 'Never copied to work context',
      })
    row('alpha', 'work_closed', { type: 'work_closed', piece: 'closed-child' })
    const host = aLibraryHost(directory, { store })
    hosts.push(host)
    const context = host as unknown as {
      oneWorkReadPerAnswer(
        pieces?: SessionStore['piecesOwnedBy'],
      ): (id: string) => readonly { label: string }[]
      windowRoutingReads: WindowRoutingReads
    }
    const expected = [{ label: root.label }, { label: `${root.label}.2` }]
    expect(context.oneWorkReadPerAnswer()('alpha')).toEqual(expected)
    const snapshot = engine.read({ kind: 'routes' })
    if (snapshot.kind !== 'routes') throw new Error('wrong snapshot')
    const explicit = vi.fn(() => [])
    const raw = vi.spyOn(store, 'piecesOwnedBy').mockImplementation(() => {
      throw new Error('raw reader')
    })
    context.windowRoutingReads.run(snapshot, () => {
      expect(context.oneWorkReadPerAnswer()('alpha')).toEqual(expected)
      expect(raw).not.toHaveBeenCalled()
      expect(context.oneWorkReadPerAnswer(explicit)('alpha')).toEqual([{ label: root.label }])
      expect(explicit).toHaveBeenCalledWith('alpha')
    })
    expect(() => context.oneWorkReadPerAnswer()('alpha')).toThrow('raw reader')
    const incomplete = structuredClone(snapshot)
    const owner = incomplete.work!.owners.find((one) => one.id === 'alpha')!
    Object.assign(owner.openWork, { skipped: [['alpha', [1]]] })
    context.windowRoutingReads.run(incomplete, () => {
      expect(() => context.oneWorkReadPerAnswer()('alpha')).toThrow(WindowReadUnavailable)
    })
    raw.mockRestore()
  })
}
