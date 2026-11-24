import { aWorkWaitFixture } from './helpers/work-wait-fixture'
import { waitFor } from './lib/f093-host'
import { settle } from './helpers/persisted-wait-revision-cases'
import { describe, expect, it, vi } from 'vitest'
import { agentToolsFor } from '../src/main/runtime/agent-tools'

describe('a work wait is reconciled without a window', () => {
  const f = aWorkWaitFixture()
  const {
    captureLegacyCut,
    create,
    cycle,
    giveToNewWorker,
    notices,
    receipts,
    record,
    tick,
    waiting,
    window,
  } = f

  it.each([
    'holder-waits',
    'giver-closes',
    'person',
    'turn-ended-holder-waits',
    'turn-ended-person',
    'turn-ended-failed',
    'turn-ended-person-with-history',
    'turn-ended-person-with-rollback-history',
    'turn-ended-person-with-tied-history',
  ] as const)('the actual holder → giver → person receipts end at %s', async (outcome) => {
    f.keepTurnsOpen = true
    const { owner } = await create()
    const call = async (caller: string, name: string, args: Record<string, unknown>) => {
      const tool = agentToolsFor(f.host, caller).tools.find((one) => one.name === name)!
      const result = (await tool.call(args)).structured as Record<string, unknown>
      expect(result).toMatchObject({ outcome: 'ok' })
      return result
    }
    await call(owner, 'create_agent', { profile_slug: 'fictional-worker' })
    const child = await call(owner, 'give_work', {
      profile: 'fictional-worker',
      to: 'new',
      conversation_title: 'Fictional owned work',
      title: 'Fictional owned work',
      brief: 'Produce a checked result.',
      definition_of_done: 'The result is checked.',
    })
    const holder = child.agent as string
    const piece = child.piece as string
    const ordinary = outcome.startsWith('turn-ended-')
    const resolution = outcome.replace('turn-ended-', '').replace(/-with.*history$/, '')
    if (resolution === 'failed') {
      const admission = f.host as unknown as { reconciliationMayWake(target: string): boolean }
      const mayWake = admission.reconciliationMayWake.bind(f.host)
      vi.spyOn(admission, 'reconciliationMayWake').mockImplementation(
        (target) => target !== holder && mayWake(target),
      )
    }
    const finish = (at: number) =>
      (
        f.handles[at] as unknown as {
          machine: { completeTurn(state: 'completed' | 'interrupted'): void }
        }
      ).machine.completeTurn('completed')
    await waitFor(() => f.store.theOpenTurn(holder) !== null, 'the original brief turn')
    const historical = outcome.includes('history')
    let previousReceiptAt: number | null = null
    if (historical) {
      // An already-recorded pre-upgrade notice, before this host's first reconciliation.
      const engine = f.host as unknown as { reconcileWork(holders?: ReadonlySet<string>): void }
      const paused = vi.spyOn(engine, 'reconcileWork').mockImplementation(() => {})
      try {
        finish(1)
        await waitFor(
          () => f.store.piecesOwnedBy(holder)[0]?.stalledBecause === 'turn_ended',
          'the old ordinary ending',
        )
        record(owner, { type: 'work_stall_told', piece, cause: 'turn_ended', how: 'pushed' })
      } finally {
        paused.mockRestore()
      }
      captureLegacyCut()
      previousReceiptAt = f.store
        .events(owner)
        .filter((row) => row.event.type === 'work_stall_told')
        .at(-1)!.at
      expect(f.store.legacyOrdinaryStallWasReported(holder, piece, owner)).toBe(true)
      await cycle()
      await cycle()
      expect(notices(holder)).toHaveLength(0)
      if (outcome.includes('rollback')) f.clock -= 1_000_000
      if (outcome.includes('tied')) {
        f.clock = previousReceiptAt!
        f.freezeClock = true
      }
      await call(owner, 'message_agent', {
        agent: holder,
        piece,
        kind: 'follow-up',
        text: 'Resume this fictional piece.',
      })
      await waitFor(() => f.store.theOpenTurn(holder) !== null, 'the resumed piece turn')
      expect(f.store.piecesOwnedBy(holder)[0]!.state).toBe('working')
    }
    if (!ordinary) waiting(holder, piece)
    else
      record(holder, {
        type: 'assistant_message',
        text: 'Which fictional opening would you like to practise?',
      })
    const engine = f.host as unknown as {
      reconcileWork(holders?: ReadonlySet<string>): void
      reconciliationReading(piece: string): { rows: { issue: { cause?: string } | null }[] }
    }
    const paused = ordinary ? vi.spyOn(engine, 'reconcileWork').mockImplementation(() => {}) : null
    finish(1)
    if (ordinary) {
      try {
        await waitFor(() => f.store.theOpenTurn(holder) === null, 'the original ordinary ending')
        expect(
          f.store.events(owner).filter((row) => row.event.type === 'work_stall_told'),
        ).toHaveLength(historical ? 1 : 0)
        if (outcome.includes('rollback'))
          expect(f.store.piecesOwnedBy(holder)[0]!.stalledAt).toBeLessThan(previousReceiptAt!)
        if (outcome.includes('tied'))
          expect(f.store.piecesOwnedBy(holder)[0]!.stalledAt).toBe(previousReceiptAt)
        expect(engine.reconciliationReading(piece).rows[0]?.issue).toMatchObject({
          cause: 'turn_ended',
        })
      } finally {
        paused?.mockRestore()
      }
      await cycle()
      expect(
        f.store.events(owner).filter((one) => one.event.type === 'work_stall_told'),
      ).toHaveLength(historical ? 1 : 0)
    }
    await waitFor(
      () =>
        receipts(holder, piece).some(
          (one) =>
            one.step === 'holder' &&
            one.outcome === (resolution === 'failed' ? 'failed' : 'delivered'),
        ),
      'holder reminder',
    )
    if (resolution !== 'failed')
      await waitFor(
        () =>
          f.store.reconciliationDelivery(holder, receipts(holder, piece)[0]!.messageId!) ===
          'running',
        'actual reminded holder turn',
      )
    if (resolution !== 'failed') {
      const label = f.store.workById(piece)!.label
      expect(notices(holder)[0]!.event).toMatchObject({
        text: ordinary
          ? `${label} needs attention: its turn ended with this work still open. If your last message already gave the finished result, hand it back now with reply_to_parent and don't repeat it. A question asked in chat is not tracked. Use ask_question for a question, request_action for an action the person must take, or update_work with on to record what it waits on. Otherwise carry on with it or finish it.`
          : `${label} needs attention: its wait names nothing that ends it. If your last message already gave the finished result, hand it back now with reply_to_parent and don't repeat it. Carry on with it, finish it, or say what it waits on with update_work (on).`,
      })
    }
    if (ordinary) {
      expect(
        f.store.events(owner).filter((one) => one.event.type === 'work_stall_told'),
      ).toHaveLength(historical ? 1 : 0)
      expect(f.host.stalledWorkForAPerson().rows.some((one) => one.piece === piece)).toBe(false)
      if (resolution !== 'failed') {
        expect(notices(holder)[0]!.event).toMatchObject({
          text: expect.not.stringContaining('Which fictional opening'),
        })
        await cycle()
        expect(notices(holder)).toHaveLength(1)
      }
    }
    if (resolution !== 'failed') expect(notices(owner)).toHaveLength(0)
    if (resolution === 'holder-waits') {
      await call(holder, 'update_work', {
        piece,
        status: 'waiting until tomorrow',
        on: { time: new Date(f.clock + 3_600_000).toISOString() },
      })
      finish(1)
      await cycle()
      expect(receipts(holder, piece).at(-1)?.step).toBe('resolved')
      expect(notices(owner)).toHaveLength(0)
      expect(f.host.workIncidentsForAPerson().rows).toEqual([])
      if (ordinary) {
        await f.host.closeAll()
        f.host = f.build()
        await settle()
        await cycle()
        expect(notices(owner)).toHaveLength(0)
        expect(notices(holder)).toHaveLength(1)
        expect(f.host.workIncidentsForAPerson().rows).toEqual([])
      }
      return
    }
    if (resolution !== 'failed') finish(1)
    await waitFor(
      () =>
        receipts(holder, piece).some((one) => one.step === 'giver' && one.outcome === 'delivered'),
      'giver notice',
    )
    const giver = receipts(holder, piece).find((one) => one.step === 'giver')!
    await waitFor(
      () => f.store.reconciliationDelivery(owner, giver.messageId!) === 'running',
      'actual giver turn',
    )
    expect(f.host.workIncidentsForAPerson().rows).toEqual([])
    if (resolution === 'giver-closes') await call(owner, 'update_work', { piece, close: true })
    finish(0)
    await cycle()
    if (resolution === 'giver-closes') {
      expect(receipts(holder, piece).at(-1)?.step).toBe('giver')
      expect(f.host.workIncidentsForAPerson().rows).toEqual([])
    } else {
      expect(receipts(holder, piece).at(-1)?.step).toBe('person')
      expect(f.host.workIncidentsForAPerson().rows).toMatchObject([
        {
          piece,
          told:
            resolution === 'failed'
              ? { giver: expect.any(Number) }
              : { holder: expect.any(Number), giver: expect.any(Number) },
        },
      ])
    }
    await cycle()
    expect(notices(holder)).toHaveLength(resolution === 'failed' ? 0 : 1)
    expect(notices(owner)).toHaveLength(1)
    if (ordinary) {
      await f.host.closeAll()
      f.host = f.build()
      await settle()
      await cycle()
      await cycle()
      expect(notices(holder)).toHaveLength(resolution === 'failed' ? 0 : 1)
      expect(notices(owner)).toHaveLength(1)
      expect(
        f.store.events(owner).filter((one) => one.event.type === 'work_stall_told'),
      ).toHaveLength(historical ? 1 : 0)
    }
  })

  type LegacyReconciliation = {
    reconcileWork(holders?: ReadonlySet<string>): void
    reconciliationReading(piece: string): { rows: { issue: { cause?: string } | null }[] }
  }

  const afterLegacyTurnWithoutReconciliation = async (
    holder: string,
    recordLegacyFacts: (engine: LegacyReconciliation) => Promise<void>,
  ) => {
    await waitFor(() => f.store.theOpenTurn(holder) !== null, 'the old holder turn')
    const engine = f.host as unknown as LegacyReconciliation
    const paused = vi.spyOn(engine, 'reconcileWork').mockImplementation(() => {})
    try {
      const handle = f.handles[1] as unknown as {
        machine: { completeTurn(state: 'completed'): void }
      }
      handle.machine.completeTurn('completed')
      await waitFor(() => f.store.theOpenTurn(holder) === null, 'the old ordinary ending')
      await recordLegacyFacts(engine)
    } finally {
      paused.mockRestore()
    }
  }

  it.each([1, 2])(
    'a legacy receipt in replacement giver 1 survives a %s-hop lineage and restart',
    async (hops) => {
      f.keepTurnsOpen = true
      const { owner } = await create()
      const given = (
        await giveToNewWorker(owner, {
          profile: 'fictional-lineage-worker',
          title: 'Fictional legacy work',
          brief: 'Check the result.',
          definition_of_done: 'A checked result.',
        })
      ).structured as { agent: string; piece: string }
      const { agent: holder, piece } = given
      await afterLegacyTurnWithoutReconciliation(holder, async () => {
        let previous = owner
        for (let hop = 1; hop <= hops; hop++) {
          const { sessionId: next } = await f.host.createSession(
            {
              provider: 'claude',
              profileId: `fictional-replacement-${hop}`,
              approvalMode: 'auto',
              cwd: f.root,
            },
            window,
          )
          record(previous, { type: 'replaced_by', sessionId: next })
          record(next, { type: 'replaces', sessionId: previous })
          if (hop === 1)
            record(next, { type: 'work_stall_told', piece, cause: 'turn_ended', how: 'pushed' })
          previous = next
        }
        captureLegacyCut()
      })
      expect(f.store.workById(piece)?.givenBy).toBe(owner)
      expect(f.store.workReportedTo(owner).has(piece)).toBe(false)
      expect(f.store.legacyOrdinaryStallWasReported(holder, piece, owner)).toBe(true)
      await cycle()
      await cycle()
      expect(receipts(holder, piece)).toEqual([])
      expect(notices(holder)).toHaveLength(0)
      await f.host.closeAll()
      f.host = f.build()
      await cycle()
      await cycle()
      expect(f.store.legacyOrdinaryStallWasReported(holder, piece, owner)).toBe(true)
      expect(receipts(holder, piece)).toEqual([])
      expect(notices(holder)).toHaveLength(0)
      expect(f.store.reconciliationOwners().flatMap((id) => notices(id))).toEqual([])
    },
  )

  const giveLegacyHolderWork = async (owner: string, profile: string, title: string) => {
    const given = await giveToNewWorker(owner, {
      profile,
      title,
      brief: 'Check the result.',
      definition_of_done: 'A checked result.',
    })
    return given.structured as { agent: string; piece: string }
  }

  it.each(['receipt-giver', 'later-giver'] as const)(
    'an incomplete legacy giver read in the %s still reminds the holder',
    async (where) => {
      f.keepTurnsOpen = true
      const { owner } = await create()
      const { agent: holder, piece } = await giveLegacyHolderWork(
        owner,
        'fictional-incomplete-proof-worker',
        'Fictional legacy work',
      )
      await afterLegacyTurnWithoutReconciliation(holder, async (engine) => {
        const receiptGiver = await f.host.createSession(
          {
            provider: 'claude',
            profileId: 'fictional-receipt-giver',
            approvalMode: 'auto',
            cwd: f.root,
          },
          window,
        )
        record(owner, { type: 'replaced_by', sessionId: receiptGiver.sessionId })
        record(receiptGiver.sessionId, { type: 'replaces', sessionId: owner })
        const held = (giver: string, messageId: string) => {
          record(giver, {
            type: 'message_queued',
            messageId,
            text: 'Fictional notice.',
            kind: 'notice',
          })
          record(giver, {
            type: 'work_stall_told',
            piece,
            cause: 'turn_ended',
            how: 'pushed',
            messageId,
          })
        }
        held(receiptGiver.sessionId, 'fictional-standing-receipt')
        let unreadGiver = receiptGiver.sessionId
        if (where === 'later-giver') {
          const next = await f.host.createSession(
            {
              provider: 'claude',
              profileId: 'fictional-unread-giver',
              approvalMode: 'auto',
              cwd: f.root,
            },
            window,
          )
          record(receiptGiver.sessionId, { type: 'replaced_by', sessionId: next.sessionId })
          record(next.sessionId, { type: 'replaces', sessionId: receiptGiver.sessionId })
          unreadGiver = next.sessionId
          held(unreadGiver, 'fictional-torn-receipt')
        }
        const messageId =
          where === 'later-giver' ? 'fictional-torn-receipt' : 'fictional-standing-receipt'
        const ordinal = f.store.nextOrdinal(unreadGiver)
        record(unreadGiver, {
          type: 'message_unqueued',
          messageId,
          reason: 'abandoned',
          text: 'Fictional notice.',
        })
        captureLegacyCut()
        expect(f.store.legacyOrdinaryStallWasReported(holder, piece, owner)).toBe(
          where === 'later-giver',
        )
        f.db
          .prepare('UPDATE events SET payload = ? WHERE session_id = ? AND ordinal = ?')
          .run('{', unreadGiver, ordinal)
        record(unreadGiver, {
          type: 'work_stall_told',
          piece: 'fictional-other-piece',
          cause: 'turn_ended',
          how: 'pushed',
        })
        expect(f.store.workReportedTo(receiptGiver.sessionId).has(piece)).toBe(true)
        expect(f.store.legacyOrdinaryStallWasReported(holder, piece, owner)).toBe(false)
        expect(engine.reconciliationReading(piece).rows[0]?.issue).toMatchObject({
          cause: 'turn_ended',
        })
      })
      await cycle()
      expect([...new Set(receipts(holder, piece).map((one) => one.step))]).toEqual(['holder'])
      expect(notices(holder)).toHaveLength(1)
      expect(f.store.reconciliationDelivery(holder, receipts(holder, piece)[0]!.messageId!)).toBe(
        'running',
      )
      await cycle()
      expect(notices(holder)).toHaveLength(1)
    },
  )

  it('a generation rebuilt after the legacy cut rejects old proof and reminds its next stalled turn', async () => {
    f.keepTurnsOpen = true
    const { owner } = await create()
    const { agent: holder, piece } = await giveLegacyHolderWork(
      owner,
      'fictional-rebuilt-worker',
      'Fictional rebuilt work',
    )
    await afterLegacyTurnWithoutReconciliation(holder, async () => {
      record(owner, { type: 'work_stall_told', piece, cause: 'turn_ended', how: 'pushed' })
      captureLegacyCut()
      expect(f.store.legacyOrdinaryStallWasReported(holder, piece, owner)).toBe(true)
    })
    await f.host.closeAll()
    const oldGeneration = f.store.theActiveGeneration(holder)
    const source = f.store
      .events(holder)
      .filter((one) =>
        ['message_queued', 'work_given', 'user_turn', 'message_unqueued', 'turn'].includes(
          one.event.type,
        ),
      )
    const generation = f.store.beginGeneration(holder)
    expect(generation).not.toBe(oldGeneration)
    const entries = source.map((one, ordinal) => ({ ordinal, event: one.event, at: tick() }))
    const cut = f.db
      .prepare('SELECT generation, through_ordinal FROM work_legacy_stall_cut WHERE session_id = ?')
      .get(holder) as { generation: number; through_ordinal: number }
    expect(cut.generation).toBe(oldGeneration)
    expect(entries.at(-1)!.ordinal).toBeLessThanOrEqual(cut.through_ordinal)
    f.store.appendGeneration(holder, generation, entries)
    expect(
      f.store.promoteGeneration(holder, generation, {
        normalizerVersion: 1,
        derivedThrough: entries.length,
      }),
    ).toBe(true)
    expect(f.store.piecesOwnedBy(holder)).toMatchObject([
      { piece, state: 'stalled', stalledBecause: 'turn_ended' },
    ])
    expect(f.store.workReportedTo(owner).has(piece)).toBe(true)
    expect(f.store.legacyOrdinaryStallWasReported(holder, piece, owner)).toBe(false)
    f.host = f.build()
    await cycle()
    expect([...new Set(receipts(holder, piece).map((one) => one.step))]).toEqual(['holder'])
    expect(notices(holder)).toHaveLength(1)
    expect(notices(owner)).toHaveLength(0)
    await cycle()
    expect(notices(holder)).toHaveLength(1)
  })

  it('a giver new wait never inherits an old person receipt before the next tick', async () => {
    f.keepTurnsOpen = true
    const { owner } = await create()
    const given = (
      await giveToNewWorker(owner, {
        profile: 'fictional-idle-worker',
        title: 'Fictional result',
        brief: 'Check it.',
        definition_of_done: 'Checked.',
      })
    ).structured as Record<string, unknown>
    expect(given).toMatchObject({ outcome: 'ok' })
    const holder = given.agent as string
    const piece = given.piece as string
    waiting(holder, piece)
    const finish = (index: number) =>
      (
        f.handles[index] as unknown as {
          machine: { completeTurn(state: 'completed'): void }
        }
      ).machine.completeTurn('completed')
    await waitFor(() => f.store.theOpenTurn(holder) !== null, 'original worker turn')
    finish(1)
    await waitFor(
      () =>
        receipts(holder, piece).some((one) => one.step === 'holder' && one.outcome === 'delivered'),
      'holder reminder',
    )
    await waitFor(() => f.store.theOpenTurn(holder) !== null, 'reminded worker turn')
    finish(1)
    await waitFor(
      () =>
        receipts(holder, piece).some((one) => one.step === 'giver' && one.outcome === 'delivered'),
      'giver turn',
    )
    await waitFor(() => f.store.theOpenTurn(owner) !== null, 'giver reminder turn')
    finish(0)
    await cycle()
    await waitFor(
      () => receipts(holder, piece).some((one) => one.step === 'person'),
      'old wait person phase',
    )
    expect(f.host.workIncidentsForAPerson().rows.some((one) => one.piece === piece)).toBe(true)
    await f.host.send(owner, 'Set a new short wait on the work.', window)
    await waitFor(() => f.store.theOpenTurn(owner) !== null, 'giver own running turn')
    expect(f.store.theOpenTurn(holder)).toBeNull()
    // Hold the scheduled pass so this control reads the ledger before any reconciliation.
    ;(f.host as unknown as { workReconciler: { close(): void } }).workReconciler.close()
    const previous = receipts(holder, piece).at(-1)!.incident
    const at = f.clock + 60_000
    const { tools } = agentToolsFor(f.host, owner)
    expect(
      (
        await tools
          .find((one) => one.name === 'update_work')!
          .call({
            piece,
            status: 'Until the new short time',
            on: { time: new Date(at).toISOString() },
          })
      ).structured,
    ).toMatchObject({ outcome: 'ok' })
    await settle()
    expect(f.host.workIncidentsForAPerson().rows.some((one) => one.piece === piece)).toBe(false)
    f.clock = at
    expect(receipts(holder, piece).at(-1)?.incident).toBe(previous)
    expect(f.store.theOpenTurn(owner)).not.toBeNull()
    expect(f.store.theOpenTurn(holder)).toBeNull()
    expect(f.host.workIncidentsForAPerson().rows.some((one) => one.piece === piece)).toBe(false)
  })
})
