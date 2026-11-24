import { aWorkWaitFixture } from './helpers/work-wait-fixture'
import { describe, expect, it } from 'vitest'
import { NO_CUTS_KEPT, turnsTheAppCutIn, type CutRecord } from '../src/main/turns-the-app-cut-file'
import { DEFAULT_PROFILE_ID } from '../src/shared/runtime-ipc'

describe('a work wait is reconciled without a window', () => {
  const f = aWorkWaitFixture()
  const { create, cycle, notices, receipts, record } = f

  it.each([
    ['limit', 'usage-limit', 1_800_000_500_000],
    ['program', 'program', null],
    ['quit', 'app-restart', null],
    ['crash', 'app-restart', null],
  ] as const)(
    'a saved %s cut has a pending recovery with the agreed metadata',
    async (kind, because, resumesAt) => {
      const { owner, work } = await create()
      record(owner, { type: 'user_turn', text: 'Fictional work underway', drives: work.piece })
      const turn = f.store.theNewestTurn(owner)!
      await f.host.closeAll()
      const cut: CutRecord = {
        turn,
        generation: f.store.theActiveGeneration(owner),
        kind,
        cutAt: f.clock,
        at: f.clock,
        provider: 'claude',
        profile: DEFAULT_PROFILE_ID,
        expected: null,
        noticeId: 'fictional-cut-notice',
        aPersonStartedIt: false,
        state: 'pending',
        ...(resumesAt === null ? {} : { resetsAt: resumesAt }),
      }
      turnsTheAppCutIn(f.db).write({ ...NO_CUTS_KEPT, cuts: { [owner]: cut } })
      f.host = f.build()
      expect(f.host.workIncidentsForAPerson().rows).toEqual([])
      // Recovery metadata is visible only after this incident has reached the person.
      record(owner, {
        type: 'work_reconciliation',
        incident: 'already-listed',
        piece: work.piece,
        kind: 'stopped',
        since: f.clock,
        step: 'person',
        outcome: 'listed',
      })
      expect(f.host.workIncidentsForAPerson().rows).toMatchObject([
        { piece: work.piece, kind: 'recovery-pending', recovery: { because, resumesAt } },
      ])
      await cycle()
      expect(notices(owner)).toHaveLength(0)
    },
  )

  it.each([
    ['start-failed', 'recovery-failed'],
    ['account-not-known', 'recovery-declined'],
  ] as const)(
    'a saved recovery ending %s is listed, without a second recovery wake',
    async (ended, kind) => {
      const { owner, work } = await create()
      record(owner, { type: 'user_turn', text: 'Fictional cut work', drives: work.piece })
      const turn = f.store.theNewestTurn(owner)!
      await f.host.closeAll()
      const cut: CutRecord = {
        turn,
        generation: f.store.theActiveGeneration(owner),
        kind: 'program',
        cutAt: f.clock,
        at: f.clock,
        provider: 'claude',
        profile: DEFAULT_PROFILE_ID,
        expected: null,
        noticeId: 'fictional-cut-notice',
        aPersonStartedIt: false,
        state: { ended },
      }
      turnsTheAppCutIn(f.db).write({ ...NO_CUTS_KEPT, cuts: { [owner]: cut } })
      f.host = f.build()
      await cycle()
      expect(f.host.workIncidentsForAPerson().rows).toMatchObject([
        { piece: work.piece, kind, recovery: { because: 'program', resumesAt: null } },
      ])
      expect(notices(owner)).toHaveLength(0)
      await cycle()
      expect(receipts(owner, work.piece).filter((one) => one.step === 'person')).toHaveLength(1)
    },
  )

  it('a persisted sign-in recovery that lost its reopen at restart reads failed with null resume time', async () => {
    const { owner, work } = await create()
    record(owner, { type: 'user_turn', text: 'Fictional sign-in cut work', drives: work.piece })
    const turn = f.store.theNewestTurn(owner)!
    record(owner, {
      type: 'work_recovery',
      turn,
      pieces: [work.piece],
      since: f.clock,
      phase: 'pending',
    })
    await f.host.closeAll()
    f.host = f.build()
    await cycle()
    expect(f.host.workIncidentsForAPerson().rows).toMatchObject([
      {
        piece: work.piece,
        kind: 'recovery-failed',
        recovery: { because: 'sign-in', resumesAt: null },
      },
    ])
    expect(notices(owner)).toHaveLength(0)
  })
})
