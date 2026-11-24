import { aWorkWaitFixture } from './helpers/work-wait-fixture'
import { waitFor } from './lib/f093-host'
import { registerProviderFailureFallbackCases } from './helpers/provider-failure-fallback-cases'
import { settle, registerPersistedWaitRevisionCase } from './helpers/persisted-wait-revision-cases'
import type { WorkReconciliationEvent } from '../src/shared/reconciliation-contracts'
import type { TranscriptEvent } from '../src/shared/conversation-events'
import { describe, expect, it, vi } from 'vitest'
import type { RuntimeHost } from '../src/main/runtime/runtime-host'
import { agentToolsFor } from '../src/main/runtime/agent-tools'

describe('a work wait is reconciled without a window', () => {
  const f = aWorkWaitFixture()
  const { create, cycle, giveToNewWorker, notices, receipts, record, tick, waiting, window } = f

  const waitContext = {
    host: () => f.host,
    replaceHost: (value: RuntimeHost) => {
      f.host = value
    },
    freezeClock: () => {
      f.freezeClock = true
    },
    create,
    waiting,
    store: () => f.store,
    build: () => f.build(),
  }
  registerPersistedWaitRevisionCase(waitContext)
  registerProviderFailureFallbackCases(waitContext, tick, cycle, (owner) => notices(owner).length)

  it('a future time is untouched; the 60 s tick wakes a due root once and turn end lists it', async () => {
    const { owner, work } = await create()
    const at = f.clock + 3_600_000
    waiting(owner, work.piece, { kind: 'time', at })
    await cycle()
    expect(notices(owner)).toHaveLength(0)
    f.clock = at
    await cycle()
    await waitFor(
      () => receipts(owner, work.piece).some((one) => one.step === 'person'),
      'the reminded turn to finish',
    )
    expect(notices(owner)).toHaveLength(1)
    const queued = notices(owner)[0]!.event
    expect(queued).toMatchObject({
      text: `${work.label}: the time it was waiting for has come. Carry on with it, or say what it waits on now with update_work (on).`,
    })
    expect(f.host.workIncidentsForAPerson()).toMatchObject({
      walk: 'every-conversation-that-holds-work',
      rows: [
        { piece: work.piece, kind: 'wait-target-ended', told: { holder: expect.any(Number) } },
      ],
    })
    await cycle()
    expect(notices(owner)).toHaveLength(1)
  })

  it('a reminded turn still running at the next tick is never escalated', async () => {
    const { owner, work } = await create()
    f.keepTurnsOpen = true
    // Fit the already running provider life as well.
    const handle = f.handles.at(-1)!
    const machine = (handle as unknown as { machine: { beginTurn(): number | null } }).machine
    handle.send = async () => {
      machine.beginTurn()
    }
    waiting(owner, work.piece)
    await cycle()
    expect(notices(owner)).toHaveLength(1)
    expect(f.host.workIncidentsForAPerson().rows).toEqual([])
    f.clock += 10 * 60_000
    await cycle()
    expect(notices(owner)).toHaveLength(1)
    expect(receipts(owner, work.piece).some((one) => one.step === 'person')).toBe(false)
    expect(f.store.reconciliationDelivery(owner, receipts(owner, work.piece)[0]!.messageId!)).toBe(
      'running',
    )
  })

  it('a restart processes a root wait and never repeats a persisted ladder step', async () => {
    const { owner, work } = await create()
    waiting(owner, work.piece, { kind: 'agent', piece: 'missing-fictional-piece', label: 'W99.1' })
    await f.host.closeAll()
    f.host = f.build()
    await waitFor(() => notices(owner).length === 1, 'startup reminder without a window')
    await waitFor(
      () => receipts(owner, work.piece).some((one) => one.step === 'person'),
      'startup ladder ending',
    )
    await f.host.closeAll()
    f.host = f.build()
    await settle()
    await cycle()
    expect(notices(owner)).toHaveLength(1)
    expect(f.host.workIncidentsForAPerson().rows).toMatchObject([{ kind: 'wait-target-missing' }])
  })

  it('a person Stop is listed directly without any reminder', async () => {
    const { owner, work } = await create()
    waiting(owner, work.piece)
    await f.host.interrupt(owner, window)
    expect(f.store.lastAskToStop(owner)?.by).toBe('a-person')
    await cycle()
    expect(notices(owner)).toHaveLength(0)
    expect(receipts(owner, work.piece)).toMatchObject([{ step: 'person', outcome: 'listed' }])
    expect(f.host.workIncidentsForAPerson().rows).toMatchObject([
      { kind: 'wait-needs-classification' },
    ])
    await cycle()
    expect(notices(owner)).toHaveLength(0)
  })

  it('a malformed incident receipt is uncertainty, never permission to send again', async () => {
    const { owner, work } = await create()
    waiting(owner, work.piece)
    record(owner, {
      type: 'work_reconciliation',
      piece: work.piece,
      incident: 'torn',
    } as WorkReconciliationEvent)
    await cycle()
    expect(notices(owner)).toHaveLength(0)
    expect(f.host.workIncidentsForAPerson().rows).toEqual([])
    expect(f.host.workIncidentsForAPerson().rowsUnread).toBeGreaterThan(0)
  })

  it('a completed queued reminder closes only its own actual turn, not an unrelated later turn', async () => {
    const { owner, work } = await create()
    record(owner, {
      type: 'message_queued',
      messageId: 'fictional-q',
      text: 'notice',
      appNotice: 'a-work-wait-needs-attention',
    })
    expect(f.store.reconciliationDelivery(owner, 'fictional-q')).toBe('pending')
    record(owner, {
      type: 'message_unqueued',
      messageId: 'fictional-q',
      reason: 'sent',
      text: 'notice',
    })
    // A ledger torn before the corresponding user_turn does not borrow the next person's turn.
    expect(f.store.reconciliationDelivery(owner, 'fictional-q')).toBe('not-delivered')
    record(owner, { type: 'user_turn', text: 'unrelated person words' })
    expect(f.store.reconciliationDelivery(owner, 'fictional-q')).toBe('not-delivered')
    expect(receipts(owner, work.piece)).toEqual([])
  })
  it('an open piece target is left alone; its actual close makes that same wait actionable', async () => {
    const { owner, work } = await create()
    const tools = agentToolsFor(f.host, owner)
    const call = async (name: string, input: Record<string, unknown>) => {
      const answer = await tools.tools.find((one) => one.name === name)!.call(input)
      const value = answer.structured as Record<string, unknown>
      expect(value).toMatchObject({ outcome: 'ok' })
      return value
    }
    await call('create_agent', { profile_slug: 'fictional-worker' })
    const child = await call('give_work', {
      profile: 'fictional-worker',
      to: 'new',
      conversation_title: 'Fictional child',
      title: 'Fictional child',
      brief: 'Keep this open.',
      definition_of_done: 'A checked result.',
    })
    await settle()
    const before = notices(owner).length
    waiting(owner, work.piece, { kind: 'agent', piece: child.piece, label: child.label })
    await cycle()
    expect(notices(owner)).toHaveLength(before)
    expect(receipts(owner, work.piece)).toEqual([])
    await call('update_work', { piece: child.piece, close: true })
    await cycle()
    expect(notices(owner)).toHaveLength(before + 1)
    await waitFor(
      () => receipts(owner, work.piece).some((one) => one.step === 'person'),
      'closed target escalation',
    )
    expect(f.host.workIncidentsForAPerson().rows).toMatchObject([
      { piece: work.piece, kind: 'wait-target-ended' },
    ])
  })

  it.each([
    { kind: 'person', request: 'missing-person-request' },
    { kind: 'agent', request: 'missing-agent-request' },
    { kind: 'event', job: 'missing-job' },
    { kind: 'event', background: 'missing-background' },
  ])('a missing target is found from its recorded wait: %j', async (on) => {
    const { owner, work } = await create()
    waiting(owner, work.piece, on)
    await cycle()
    await waitFor(
      () => receipts(owner, work.piece).some((one) => one.step === 'person'),
      'missing target reminder ending',
    )
    expect(notices(owner)).toHaveLength(1)
    expect(f.host.workIncidentsForAPerson().rows).toMatchObject([
      { piece: work.piece, kind: 'wait-target-missing' },
    ])
  })

  it('a reminder held at admission is retracted if a valid wait arrives before handover', async () => {
    const { owner, work } = await create()
    let release = () => {}
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    ;(f.handles[0] as unknown as { checkSignIn(): Promise<boolean> }).checkSignIn = async () => {
      await gate
      return false
    }
    try {
      waiting(owner, work.piece)
      await cycle()
      expect(notices(owner)).toHaveLength(1)
      waiting(owner, work.piece, { kind: 'time', at: f.clock + 3_600_000 })
    } finally {
      release()
    }
    await cycle()
    expect(
      f.store
        .messagesWaitingIn(owner)
        .filter((one) => one.authorship.appNotice === 'a-work-wait-needs-attention'),
    ).toEqual([])
    expect(
      f.store
        .events(owner)
        .filter(
          (one) =>
            one.event.type === 'user_turn' && one.event.appNotice === 'a-work-wait-needs-attention',
        ),
    ).toEqual([])
    expect(receipts(owner, work.piece).at(-1)?.step).toBe('resolved')
    expect(f.host.workIncidentsForAPerson().rows).toEqual([])
  })

  it('a failed provider start removes its exact held reminder instead of leaving it for an unrelated reopen', async () => {
    const { owner, work } = await create()
    waiting(owner, work.piece)
    await f.host.closeAll()
    f.host = f.build()
    f.failResume = true
    await waitFor(
      () => receipts(owner, work.piece).some((one) => one.step === 'person'),
      'failed start ladder',
    )
    expect(notices(owner)).toHaveLength(1)
    expect(
      f.store
        .messagesWaitingIn(owner)
        .filter((one) => one.authorship.appNotice === 'a-work-wait-needs-attention'),
    ).toEqual([])
    expect(f.host.workIncidentsForAPerson().rows).toMatchObject([
      { piece: work.piece, kind: 'notice-not-delivered' },
    ])
  })

  it('two already running holders take their reminders without the provider-start pacing gap', async () => {
    await f.host.closeAll()
    f.startGap = 5_000
    f.host = f.build()
    const a = await create()
    const b = await create()
    waiting(a.owner, a.work.piece)
    waiting(b.owner, b.work.piece)
    await cycle()
    await waitFor(
      () =>
        [a, b].every(({ owner, work }) =>
          receipts(owner, work.piece).some(
            (one) => one.step === 'holder' && one.outcome === 'delivered',
          ),
        ),
      'both live reminders without a new start',
    )
    expect(f.handles).toHaveLength(2)
    expect(notices(a.owner)).toHaveLength(1)
    expect(notices(b.owner)).toHaveLength(1)
  })

  it('an archived holder stays outside the visible incident list and is never woken', async () => {
    const { owner, work } = await create()
    waiting(owner, work.piece)
    expect(await f.host.archiveConversation(owner)).toMatchObject({ done: true })
    await cycle()
    expect(notices(owner)).toHaveLength(0)
    expect(f.host.workIncidentsForAPerson().rows).toEqual([])
  })

  it('an unread root line is unavailable, without claiming there are no incidents', async () => {
    const { owner, work } = await create()
    record(owner, {
      type: 'work_status_set',
      piece: work.piece,
      line: 5,
      by: owner,
      waiting: true,
    } as unknown as TranscriptEvent)
    await cycle()
    expect(notices(owner)).toHaveLength(0)
    expect(f.host.workIncidentsForAPerson().rows).toEqual([])
    expect(f.host.workIncidentsForAPerson().ledgersSkipped).toBeGreaterThan(0)
  })

  it('a root waiting on an actual person request is not woken by its older expired status line', async () => {
    const { owner, work } = await create()
    waiting(owner, work.piece, { kind: 'time', at: f.clock - 1 })
    const tool = agentToolsFor(f.host, owner).tools.find((one) => one.name === 'ask_question')!
    const result = (
      await tool.call({
        piece: work.label,
        who_answers: 'a-person',
        question: 'Which fictional file comes first?',
      })
    ).structured as Record<string, unknown>
    expect(result).toMatchObject({ outcome: 'ok' })
    expect(f.host.questionsForAPerson().rows.map((one) => one.request.requestId)).toContain(
      result.question,
    )
    await cycle()
    expect(notices(owner)).toHaveLength(0)
    expect(receipts(owner, work.piece)).toEqual([])
    expect(f.host.workIncidentsForAPerson().rows).toEqual([])
  })

  it('an open to-do is a valid person wait; its answer ends that target exactly once', async () => {
    const { owner, work } = await create()
    const tools = agentToolsFor(f.host, owner).tools
    const asked = (
      await tools
        .find((one) => one.name === 'request_action')!
        .call({
          piece: work.label,
          action: 'Check the fictional result.',
        })
    ).structured as Record<string, unknown>
    expect(asked).toMatchObject({ outcome: 'ok' })
    const request = asked.question as string
    const status = await tools
      .find((one) => one.name === 'update_work')!
      .call({
        piece: work.label,
        status: 'Waiting for the check',
        on: { person: request },
      })
    expect(status.structured).toMatchObject({ outcome: 'ok' })
    await cycle()
    expect(notices(owner)).toEqual([])
    expect(receipts(owner, work.piece)).toEqual([])
    expect(await f.host.answerAction(owner, request, true, null, window)).toEqual({
      outcome: 'taken',
    })
    await settle()
    await cycle()
    await waitFor(
      () => receipts(owner, work.piece).some((one) => one.step === 'person'),
      'the answered to-do wait',
    )
    expect(notices(owner)).toHaveLength(1)
    expect(f.host.workIncidentsForAPerson().rows).toMatchObject([
      { piece: work.piece, kind: 'wait-target-ended' },
    ])
    await cycle()
    expect(notices(owner)).toHaveLength(1)
  })

  it('a listed incident is hidden while its holder resumes actual work', async () => {
    const { owner, work } = await create()
    waiting(owner, work.piece)
    await cycle()
    await waitFor(
      () => receipts(owner, work.piece).some((one) => one.step === 'person'),
      'the incident to reach the person',
    )
    expect(f.host.workIncidentsForAPerson().rows).toHaveLength(1)
    const machine = (f.handles.at(-1)! as unknown as { machine: { beginTurn(): number | null } })
      .machine
    f.handles.at(-1)!.send = async () => {
      machine.beginTurn()
    }
    await f.host.send(owner, 'Carry on with the fictional work.', window)
    await waitFor(() => f.store.theOpenTurn(owner) !== null, 'the new working turn')
    await cycle()
    expect(f.host.workIncidentsForAPerson().rows).toEqual([])
    expect(notices(owner)).toHaveLength(1)
  })

  it('startup reconciliation waits for the first window load without holding the launch', async () => {
    const { owner, work } = await create()
    waiting(owner, work.piece)
    await f.host.closeAll()
    let loaded!: () => void
    f.firstLoad = new Promise<void>((resolve) => {
      loaded = resolve
    })
    f.host = f.build()
    await settle()
    expect(notices(owner)).toHaveLength(0)
    loaded()
    await waitFor(() => notices(owner).length === 1, 'deferred startup reminder')
  })

  it('a newly recorded valid time wait gets a fresh wake if it expires before the next scan', async () => {
    const { owner, work } = await create()
    waiting(owner, work.piece)
    await cycle()
    await waitFor(
      () => receipts(owner, work.piece).some((one) => one.step === 'person'),
      'the first ladder',
    )
    const first = receipts(owner, work.piece)[0]!.incident
    const at = f.clock + 3_600_000
    const tool = agentToolsFor(f.host, owner).tools.find((one) => one.name === 'update_work')!
    expect(
      (
        await tool.call({
          piece: work.label,
          status: 'Until the new time',
          on: { time: new Date(at).toISOString() },
        })
      ).structured,
    ).toMatchObject({ outcome: 'ok' })
    f.clock = at
    await cycle()
    expect(notices(owner)).toHaveLength(2)
    expect(
      receipts(owner, work.piece).some((one) => one.incident === first && one.step === 'resolved'),
    ).toBe(true)
    expect(
      new Set(
        receipts(owner, work.piece)
          .filter((one) => one.step === 'holder')
          .map((one) => one.incident),
      ).size,
    ).toBe(2)
  })

  it('a cross-holder target ending is found in its touched pass without a tick', async () => {
    const a = await create()
    const b = await create()
    const given = await giveToNewWorker(b.owner, {
      profile: 'cross-holder-worker',
      title: 'Target',
      brief: 'A fictional target.',
      definition_of_done: 'A checked result.',
    })
    const target = given.structured as { piece: string; label: string; agent: string }
    await settle()
    waiting(a.owner, a.work.piece, { kind: 'agent', piece: target.piece, label: target.label })
    const engine = (
      f.host as unknown as { workReconciler: { run(owners?: ReadonlySet<string>): Promise<void> } }
    ).workReconciler
    await engine.run()
    expect(receipts(a.owner, a.work.piece)).toEqual([])
    record(target.agent, {
      type: 'work_replied',
      piece: target.piece,
      outcome: 'done',
      summary: 'Checked.',
      resources: [],
    })
    await settle()
    expect(receipts(a.owner, a.work.piece)[0]).toMatchObject({
      kind: 'wait-target-ended',
      step: 'holder',
    })
  })

  it.each([false, 0, [], {}, '', 'x'.repeat(513)].map((key) => ({ key })))(
    'an invalid receipt piece key $key cannot authorize an empty history',
    async ({ key }) => {
      const { owner, work } = await create()
      waiting(owner, work.piece)
      const ordinal = f.store.nextOrdinal(owner)
      f.db
        .prepare(
          'INSERT INTO events (id,session_id,generation,ordinal,type,payload,created_at) VALUES (?,?,?,?,?,?,?)',
        )
        .run(
          'invalid-key',
          owner,
          0,
          ordinal,
          'work_reconciliation',
          JSON.stringify({
            type: 'work_reconciliation',
            piece: key,
            incident: 'invalid',
            kind: 'wait-target-ended',
            since: f.clock,
            step: 'person',
            outcome: 'listed',
          }),
          tick(),
        )
      expect(() => receipts(owner, work.piece)).toThrow('could not be read')
      await cycle()
      expect(notices(owner)).toHaveLength(0)
      expect(f.host.workIncidentsForAPerson().rowsUnread).toBeGreaterThan(0)
    },
  )

  it('async notice freshness reads the carried piece directly and persists its exact reference', async () => {
    const { handles, store } = f
    const { owner, work } = await create()
    let release = () => {}
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    ;(handles[0] as unknown as { checkSignIn(): Promise<boolean> }).checkSignIn = async () => {
      await gate
      return false
    }
    try {
      waiting(owner, work.piece)
      await cycle()
      const receipt = receipts(owner, work.piece).find((one) => one.step === 'holder')!
      expect(receipt).toBeDefined()
      const point = vi.spyOn(store, 'reconciliationReceipts')
      const own = vi.spyOn(store, 'reconciliationReceiptsForOwner')
      const legacy = vi.fn(() => {
        throw new Error('an unbounded notice history read was attempted')
      })
      Object.assign(store, { reconciliationNotice: legacy })
      const check = f.host as unknown as {
        reconciliationNoticeStillGoes(target: string, message: string, piece?: string): boolean
      }
      expect(check.reconciliationNoticeStillGoes(owner, receipt.messageId!, work.piece)).toBe(true)
      expect(point).toHaveBeenCalledWith(owner, work.piece)
      expect(own).not.toHaveBeenCalled()
      expect(legacy).not.toHaveBeenCalled()
      expect(notices(owner)[0]!.event).toMatchObject({ about: work.piece })
      expect(check.reconciliationNoticeStillGoes(owner, receipt.messageId!, 'not-this-piece')).toBe(
        false,
      )
      expect(check.reconciliationNoticeStillGoes(owner, receipt.messageId!)).toBe(false)
      expect(check.reconciliationNoticeStillGoes(owner, 'not-this-message', work.piece)).toBe(false)
    } finally {
      release()
    }
    await settle()
  })

  it.each(['withdraw', 'answer'] as const)(
    'a giver request %s revisits its waiting holder without a tick',
    async (ending) => {
      const { owner } = await create()
      f.keepTurnsOpen = true
      const call = async (who: string, name: string, input: Record<string, unknown>) => {
        const answer = (
          await agentToolsFor(f.host, who)
            .tools.find((one) => one.name === name)!
            .call(input)
        ).structured as Record<string, unknown>
        expect(answer).toMatchObject({ outcome: 'ok' })
        return answer
      }
      await call(owner, 'create_agent', { profile_slug: 'request-holder' })
      const a = await call(owner, 'give_work', {
        profile: 'request-holder',
        to: 'new',
        conversation_title: 'Waiting work',
        title: 'Waiting work',
        brief: 'A fictional piece.',
        definition_of_done: 'Checked.',
      })
      await call(owner, 'create_agent', { profile_slug: 'request-answerer' })
      const b = await call(owner, 'give_work', {
        profile: 'request-answerer',
        to: 'new',
        conversation_title: 'Other work',
        title: 'Other work',
        brief: 'Another fictional piece.',
        definition_of_done: 'Checked.',
      })
      await settle()
      const asked = await call(owner, 'ask_question', {
        who_answers: 'an-agent',
        agent: b.label,
        question: 'Which fictional result?',
        interrupt: false,
      })
      const question = asked.question as string
      await call(owner, 'update_work', {
        piece: a.piece,
        status: 'Waiting for the requested answer',
        on: { agent: question },
      })
      ;(
        f.handles[1] as unknown as { machine: { completeTurn(state: 'completed'): void } }
      ).machine.completeTurn('completed')
      await settle()
      expect(receipts(a.agent as string, a.piece as string)).toEqual([])
      if (ending === 'withdraw') await call(owner, 'withdraw_question', { question })
      else
        await call(b.agent as string, 'answer_question', {
          question,
          answers: [{ part: 'answer', answer: ['Checked.'] }],
          interrupt: false,
        })
      await settle()
      expect(receipts(a.agent as string, a.piece as string)[0]).toMatchObject({
        kind: 'wait-target-ended',
        step: 'holder',
      })
    },
  )
})
