import { expect, it, vi } from 'vitest'
import { agentToolsFor } from '../src/main/runtime/agent-tools'
import { answerOn } from './helpers/call-tool'
import { aServiceWorld, type AServiceWorld } from './helpers/a-service-world'
import { settleFixtureTurns, waitFor } from './lib/host-fixture'

function failureNotices(world: AServiceWorld, giver: string) {
  return world
    .ledger(giver)
    .filter(
      (event) =>
        event.type === 'message_queued' && event.appNotice === 'a-given-brief-could-not-start',
    )
}

it('tells the actual giver when the first brief stays held after a failed handoff', async () => {
  const world = aServiceWorld()
  let releaseHandoff = (): void => {}
  try {
    world.anAgent('worker', 'normal')
    const host = world.aHost()
    const giver = await world.aPersonOpens(host, 'giver')
    const unrelated = await world.aPersonOpens(host, 'unrelated')

    world.sendFinishesWait = new Promise<void>((resolve) => {
      releaseHandoff = resolve
    })
    const pending = world.gives(host, giver, 'worker')
    await waitFor(() => world.sent.some((turn) => turn.as === 'worker'), 'the pending handoff')
    expect(failureNotices(world, giver)).toEqual([])
    world.sendReturnsError = true
    world.sendFinishesWait = null
    releaseHandoff()
    const give = await pending
    if (!give.ok) throw new Error('the task was not recorded')
    world.sendReturnsError = false

    const retained = world.store.messagesWaitingIn(give.owner)
    expect(retained).toContainEqual(expect.objectContaining({ piece: give.piece }))
    expect(world.store.workById(give.piece)).toMatchObject({ givenBy: giver, owner: give.owner })
    await waitFor(
      () =>
        world
          .ledger(giver)
          .some(
            (event) =>
              event.type === 'message_queued' &&
              event.text.includes(give.label) &&
              event.appNotice === 'a-given-brief-could-not-start' &&
              event.text.includes('did not confirm receiving'),
          ),
      'the giver’s recorded first-brief failure notice',
    )
    expect(
      world
        .ledger(unrelated)
        .some((event) => event.type === 'message_queued' && event.text.includes(give.label)),
    ).toBe(false)
    expect(world.startedAs.filter((profile) => profile === 'worker')).toHaveLength(1)

    await host.closeAll()
    const restarted = world.aHost()
    await restarted.reopenForAPerson(giver, world.window, null)
    world.resumesAreGoneFor = 'worker'
    const later = await answerOn(agentToolsFor(restarted, giver), 'message_agent', {
      agent: give.owner,
      kind: 'note',
      text: 'Please check the same work.',
    })
    expect(later.text).toContain('its session file is missing')
    await settleFixtureTurns(1, 0)
    expect(failureNotices(world, giver)).toHaveLength(1)
  } finally {
    releaseHandoff()
    await world.cleanUp()
  }
})

it.each([
  ['conversation', false],
  ['person', false],
  ['conversation', true],
  ['person', true],
] as const)(
  'returns a close receipt without telling a stopped holder (%s, abandoned: %s)',
  async (closer, abandoned) => {
    const world = aServiceWorld()
    try {
      world.anAgent('worker', 'normal')
      const host = world.aHost()
      const giver = await world.aPersonOpens(host, 'giver')
      const holder = await world.aRecordedWorker(giver, 'worker')
      world.resumesAreGoneFor = 'worker'
      const given = await world.gives(host, giver, 'worker', { to: holder })
      if (!given.ok) throw new Error('the task was not recorded')
      expect(given.recipientState).toMatchObject({
        kind: 'cannot-run',
        cause: { code: 'provider-file-missing' },
      })
      const brief = world.store.messagesWaitingIn(holder).find((row) => row.piece === given.piece)
      if (brief === undefined) throw new Error('the first brief was not held')
      if (abandoned) {
        world.store.append(
          holder,
          world.store.nextOrdinal(holder),
          {
            type: 'message_unqueued',
            messageId: brief.messageId,
            reason: 'abandoned',
            text: brief.text,
          },
          Date.now(),
        )
        expect(world.store.piecesOwnedBy(holder)).toContainEqual(
          expect.objectContaining({ piece: given.piece, stalledBecause: 'message_never_sent' }),
        )
      }

      if (closer === 'person') {
        expect(await host.closeForAPerson(given.piece, world.window)).toMatchObject({
          ok: true,
          piece: given.piece,
          label: given.label,
          briefNeverDelivered: true,
        })
      } else {
        const observer = await world.aPersonOpens(host, 'observer')
        const receipt = await answerOn(agentToolsFor(host, observer), 'update_work', {
          piece: given.label,
          close: true,
        })
        expect(receipt.structured).toMatchObject({
          outcome: 'ok',
          state: 'closed',
          tookBackTheMessage: !abandoned,
          delivery: 'not-delivered',
        })
        expect(receipt.text).toContain(`${given.label} is closed`)
        expect(receipt.text).toContain('had not reached it')
      }

      expect(world.ledger(holder)).toContainEqual(
        expect.objectContaining({ type: 'work_closed', piece: given.piece }),
      )
      expect(world.store.messagesWaitingIn(holder)).not.toContainEqual(
        expect.objectContaining({ piece: given.piece }),
      )
      expect(world.ledger(holder)).not.toContainEqual(
        expect.objectContaining({
          type: 'message_queued',
          appNotice: closer === 'person' ? 'a-piece-a-person-closed' : 'a-piece-closed',
        }),
      )
    } finally {
      await world.cleanUp()
    }
  },
)

it.each(['restart', 'withdrawal', 'live'])('rechecks a held failure notice (%s)', async (when) => {
  const world = aServiceWorld()
  try {
    world.anAgent('worker', 'normal')
    const host = world.aHost()
    const giver = await world.aPersonOpens(host, 'giver')
    const holder = await world.aRecordedWorker(giver, 'worker')
    await host.send(giver, 'Already working', world.window)
    await waitFor(
      () => world.ledger(giver).some((event) => event.type === 'permission_request'),
      'the giver to still be working',
    )
    world.resumesAreGoneFor = 'worker'

    const give = await world.gives(host, giver, 'worker', { to: holder })
    if (!give.ok) throw new Error('the task was not recorded')
    expect(give.recipientState).toMatchObject({
      kind: 'cannot-run',
      cause: { code: 'provider-file-missing' },
    })
    const notices = () => failureNotices(world, giver)
    await waitFor(() => notices().length === 1, 'the missing-session notice')
    expect(notices()).toMatchObject([{ text: expect.stringContaining('session file is missing') }])
    expect(notices()).toMatchObject([{ text: expect.stringContaining(give.label) }])
    expect(world.store.messagesWaitingIn(holder)).toContainEqual(
      expect.objectContaining({ piece: give.piece }),
    )
    expect(world.ledger(holder).some((event) => event.type === 'replaced_by')).toBe(false)
    const noticeTurns = () =>
      world.sent.filter((turn) => turn.as === 'giver' && turn.words.includes(give.label))
    expect(noticeTurns()).toEqual([])
    const [notice] = notices()
    if (notice?.type !== 'message_queued') throw new Error('the notice was not recorded')
    expect(world.store.messagesWaitingIn(giver)).toContainEqual(
      expect.objectContaining({ messageId: notice.messageId }),
    )
    if (when !== 'restart') {
      const ended = await answerOn(agentToolsFor(host, giver), 'withdraw_task', {
        piece: give.label,
      })
      expect(ended.structured).toMatchObject({ outcome: 'ok', state: 'withdrawn' })
    }

    let receiving = host
    if (when === 'live') {
      await host.respondPermission(giver, 'turn_1_perm', { outcome: 'allow' }, world.window)
    } else {
      await host.closeAll()
      receiving = world.aHost()
      await receiving.reopenForAPerson(giver, world.window, null)
    }
    if (when !== 'restart') {
      await waitFor(
        () =>
          world
            .ledger(giver)
            .some(
              (event) =>
                event.type === 'message_unqueued' &&
                event.messageId === notice.messageId &&
                event.reason === 'retracted',
            ),
        'the obsolete notice to be retracted',
      )
      expect(noticeTurns()).toEqual([])
      return
    }
    await waitFor(() => noticeTurns().length === 1, 'the restarted giver to receive its notice')
    await answerOn(agentToolsFor(receiving, giver), 'message_agent', {
      agent: holder,
      kind: 'note',
      text: 'Can you continue the same work?',
    })
    expect(notices()).toHaveLength(1)
    expect(noticeTurns()).toHaveLength(1)
    expect(world.store.messagesWaitingIn(holder)).toContainEqual(
      expect.objectContaining({ piece: give.piece }),
    )
  } finally {
    await world.cleanUp()
  }
})

it('does not call a brief failed while its provider start is still pending', async () => {
  const world = aServiceWorld()
  let releaseStart = (): void => {}
  try {
    world.anAgent('worker', 'normal')
    const host = world.aHost()
    const giver = await world.aPersonOpens(host, 'giver')
    world.startsWait = new Promise<void>((resolve) => {
      releaseStart = resolve
    })

    const pending = world.gives(host, giver, 'worker')
    await waitFor(() => world.store.piecesGivenBy(giver).length === 1, 'the recorded give')
    const notices = () => failureNotices(world, giver)
    expect(notices()).toEqual([])
    releaseStart()
    expect(await pending).toMatchObject({ ok: true, delivery: 'sent' })
    expect(notices()).toEqual([])
  } finally {
    releaseStart()
    await world.cleanUp()
  }
})

it('keeps a real busy hold without a failure notice and delivers it afterward', async () => {
  const world = aServiceWorld()
  let releaseTurn = (): void => {}
  try {
    world.anAgent('worker', 'normal')
    const host = world.aHost()
    const giver = await world.aPersonOpens(host, 'giver')
    const holder = await world.aPersonOpens(host, 'worker')
    world.turnsWait = new Promise<void>((resolve) => {
      releaseTurn = resolve
    })

    await host.send(holder, 'Already working', world.window)
    const give = await world.gives(host, giver, 'worker', { to: holder })
    expect(give).toMatchObject({ ok: true, delivery: 'held' })
    if (!give.ok) throw new Error('the task was not recorded')
    const failures = () => failureNotices(world, giver)
    expect(failures()).toEqual([])
    world.turnsWait = null
    releaseTurn()
    await waitFor(
      () => world.ledger(holder).some((event) => event.type === 'permission_request'),
      'the first turn to reach its fictional tool approval',
    )
    await host.respondPermission(holder, 'turn_1_perm', { outcome: 'allow' }, world.window)
    await waitFor(
      () =>
        world.store
          .piecesOwnedBy(holder)
          .some((one) => one.piece === give.piece && one.briefHandedOver === true),
      'the busy holder to receive the brief',
    )
    expect(failures()).toEqual([])
  } finally {
    releaseTurn()
    await world.cleanUp()
  }
})

it('returns the start failure to the giver without dropping a newly recorded task', async () => {
  const world = aServiceWorld()
  try {
    world.anAgent('worker', 'normal')
    const host = world.aHost()
    const giver = await world.aPersonOpens(host, 'giver')
    world.startsFail = true

    const give = await world.gives(host, giver, 'worker')
    if (!give.ok) throw new Error('the task was not recorded')
    expect(give.recipientState).toMatchObject({
      kind: 'cannot-run',
      cause: { code: 'could-not-start' },
    })
    expect(world.store.messagesWaitingIn(give.owner)).toContainEqual(
      expect.objectContaining({ piece: give.piece }),
    )
    expect(failureNotices(world, giver)).toEqual([])
  } finally {
    await world.cleanUp()
  }
})

it.each([
  'setup',
  'handoff',
  'handoff with busy giver',
  'park before live delivery',
  'park before restart',
])('reports a pending fresh Give on the existing sweep (%s)', async (when) => {
  vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] })
  const world = aServiceWorld()
  let resolve = (): void => {}
  const block = new Promise<void>((released) => {
    resolve = released
  })
  let releaseWorkersTurn = (): void => {}
  const workerTurn = new Promise<void>((released) => {
    releaseWorkersTurn = released
  })
  let pending: ReturnType<AServiceWorld['gives']> | undefined
  const parked = when.startsWith('park')
  const waitingForSetup = when === 'setup' || when === 'park before restart'
  try {
    world.anAgent('worker', 'normal')
    const host = world.aHost({
      beforePreparingHome: (profile) =>
        waitingForSetup && profile === 'worker' ? block : undefined,
    })
    const giver = await world.aPersonOpens(host, 'giver')
    const giverBusy = when === 'handoff with busy giver' || parked
    if (giverBusy) {
      await host.send(giver, 'Waiting for a person', world.window)
      await waitFor(
        () => world.ledger(giver).some((event) => event.type === 'permission_request'),
        'the giver to be busy',
      )
    }
    if (!waitingForSetup) {
      world.turnsWait = workerTurn
      world.sendFinishesWait = block
    }
    pending = world.gives(host, giver, 'worker')
    await waitFor(() => world.store.piecesGivenBy(giver).length === 1, 'the recorded Give')
    const [work] = world.store.piecesGivenBy(giver)
    if (work === undefined) throw new Error('the Give was not recorded')
    if (!waitingForSetup) {
      await waitFor(() => world.sent.some((turn) => turn.as === 'worker'), 'first handoff')
      world.sendFinishesWait = null
      world.turnsWait = null
    } else expect(world.startedAs).not.toContain('worker')

    world.clock = work.givenAt + 119_000
    await vi.advanceTimersByTimeAsync(60_000)
    expect(failureNotices(world, giver)).toEqual([])

    world.clock = work.givenAt + 120_000
    const observedAt = performance.now()
    await vi.advanceTimersByTimeAsync(60_000)
    const [notice] = failureNotices(world, giver)
    if (notice?.type !== 'message_queued' || notice.messageId === undefined)
      throw new Error('the notice was not recorded')
    const noticeId = notice.messageId
    const recordedAfterMs = performance.now() - observedAt
    const sentToGiver = () =>
      world.sent.filter(
        (turn) =>
          turn.as === 'giver' &&
          turn.words.includes(work.label) &&
          turn.words.includes('Startup or brief delivery is still unconfirmed'),
      )
    if (giverBusy) expect(sentToGiver()).toEqual([])
    else {
      await waitFor(
        () =>
          sentToGiver().length === 1 &&
          world.store.whatBecameOfAMessage(giver, noticeId) === 'sent',
        'the actual giver to receive the notice',
      )
      console.info('first brief observation', when, {
        recordedAfterMs,
        deliveredAfterMs: performance.now() - observedAt,
      })
    }
    expect(notice.text).toContain('Startup or brief delivery is still unconfirmed')
    expect(notice.text).not.toContain('provider session file is missing')
    expect(world.store.messagesWaitingIn(work.owner)).toContainEqual(
      expect.objectContaining({ piece: work.piece }),
    )
    await vi.advanceTimersByTimeAsync(60_000)
    expect(sentToGiver()).toHaveLength(giverBusy ? 0 : 1)

    if (parked) {
      const wait = await answerOn(agentToolsFor(host, giver), 'update_work', {
        piece: work.label,
        status: 'Wait for the meeting time',
        on: { time: new Date(world.clock + 120_000).toISOString() },
      })
      expect(wait.structured).toMatchObject({ outcome: 'ok' })
      const waitIsRecorded = () =>
        world.store.piecesOwnedBy(work.owner).find((piece) => piece.piece === work.piece)
          ?.statusLine?.waiting === true
      if (when === 'park before restart') {
        world.startsFail = true
        resolve()
        expect(await pending).toMatchObject({ recipientState: { kind: 'cannot-run' } })
        world.startsFail = false
        await waitFor(waitIsRecorded, 'the original task to record its wait')
        await host.closeAll()
        const restarted = world.aHost({ startGapMs: 0 })
        await restarted.reopenForAPerson(giver, world.window, null)
        await restarted.send(giver, 'Please continue', world.window)
      } else {
        await waitFor(waitIsRecorded, 'the original task to record its wait')
        await host.respondPermission(giver, 'turn_1_perm', { outcome: 'allow' }, world.window)
      }
      const disposition = () =>
        world
          .ledger(giver)
          .find((event) => event.type === 'message_unqueued' && event.messageId === noticeId)
      await waitFor(() => disposition() !== undefined, 'the parked notice disposition')
      expect(disposition()).toMatchObject({ reason: 'retracted' })
      expect(sentToGiver()).toEqual([])
      return
    }

    resolve()
    expect(await pending).toMatchObject({ delivery: 'sent' })
    expect(
      world.store.piecesOwnedBy(work.owner).find((piece) => piece.piece === work.piece),
    ).toMatchObject({ briefHandedOver: true })
    expect(world.sent.filter((turn) => turn.as === 'worker')).toHaveLength(1)
    if (giverBusy) {
      await host.respondPermission(giver, 'turn_1_perm', { outcome: 'allow' }, world.window)
      await waitFor(
        () =>
          world
            .ledger(giver)
            .some(
              (event) =>
                event.type === 'message_unqueued' &&
                event.messageId === notice.messageId &&
                event.reason === 'retracted',
            ),
        'the notice to be retracted after late handoff',
      )
      expect(sentToGiver()).toEqual([])
    }
    expect(failureNotices(world, giver)).toHaveLength(1)
  } finally {
    world.sendFinishesWait = null
    world.turnsWait = null
    resolve()
    releaseWorkersTurn()
    await pending
    await world.cleanUp()
    vi.useRealTimers()
  }
})

it.each(['before launch', 'after registration'])(
  'reports a retained fresh brief on restart (%s)',
  async (when) => {
    const world = aServiceWorld()
    try {
      world.anAgent('worker', 'normal')
      const host = world.aHost()
      const giver = await world.aPersonOpens(host, 'giver')
      world.startsFail = true
      const given = await world.gives(host, giver, 'worker')
      if (!given.ok) throw new Error('the fixture did not record the Give')
      expect(given.recipientState).toMatchObject({ kind: 'cannot-run' })
      expect(failureNotices(world, giver)).toEqual([])
      expect(world.ledger(giver)).toContainEqual(
        expect.objectContaining({ type: 'work_sent', piece: given.piece }),
      )
      const [brief] = world.store.messagesWaitingIn(given.owner)
      if (brief === undefined) throw new Error('the fixture did not retain the brief')
      await host.closeAll()
      if (when === 'after registration')
        world.store.append(
          given.owner,
          world.store.nextOrdinal(given.owner),
          { type: 'launched' },
          world.clock++,
        )

      world.startsFail = false
      world.clock = brief.at + 120_000
      const observedAt = performance.now()
      const restarted = world.aHost({ startGapMs: 0 })
      await waitFor(() => failureNotices(world, giver).length === 1, 'reconciliation to record')
      const recordedAfterMs = performance.now() - observedAt
      await waitFor(
        () => world.sent.some((turn) => turn.as === 'giver' && turn.words.includes(given.label)),
        'the giver to receive the notice without waking the worker',
      )
      console.info('restart first brief observation', when, {
        recordedAfterMs,
        deliveredAfterMs: performance.now() - observedAt,
      })
      expect(world.startedAs.filter((profile) => profile === 'worker')).toHaveLength(1)
      expect(failureNotices(world, giver)).toMatchObject([
        {
          text: expect.stringContaining('cannot tell whether the earlier Give result reached you'),
        },
      ])
      expect(failureNotices(world, giver)).not.toMatchObject([
        { text: expect.stringContaining('provider session file is missing') },
      ])
      expect(world.store.whatBecameOfAMessage(given.owner, brief.messageId)).toBe(
        when === 'after registration' ? 'ended' : 'waiting',
      )
      expect(world.store.workById(given.piece)).toMatchObject({
        givenBy: giver,
        owner: given.owner,
      })
      await restarted.closeAll()
      world.aHost({ startGapMs: 0 })
      await settleFixtureTurns(2, 0)
      expect(failureNotices(world, giver)).toHaveLength(1)
    } finally {
      await world.cleanUp()
    }
  },
)

it('keeps a completed typed refusal and an ordinary busy Give quiet on later sweeps', async () => {
  vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] })
  const world = aServiceWorld()
  try {
    world.anAgent('worker', 'normal')
    const host = world.aHost()
    const giver = await world.aPersonOpens(host, 'giver')
    const busy = await world.aPersonOpens(host, 'worker')
    world.startsFail = true
    const refused = await world.gives(host, giver, 'worker')
    if (!refused.ok) throw new Error('the fixture did not record the Give')
    expect(refused.recipientState).toMatchObject({ kind: 'cannot-run' })

    await host.send(busy, 'Waiting for a person', world.window)
    await waitFor(
      () => world.ledger(busy).some((event) => event.type === 'permission_request'),
      'the busy holder’s request',
    )
    expect(await world.gives(host, giver, 'worker', { to: busy })).toMatchObject({
      delivery: 'held',
    })
    world.clock += 240_000
    await vi.advanceTimersByTimeAsync(60_000)
    expect(failureNotices(world, giver)).toEqual([])
    await host.respondPermission(busy, 'turn_1_perm', { outcome: 'allow' }, world.window)
  } finally {
    await world.cleanUp()
    vi.useRealTimers()
  }
})

it('leaves a retained first brief quiet while its provider has a usage hold', async () => {
  const world = aServiceWorld()
  try {
    world.anAgent('worker', 'normal')
    const host = world.aHost()
    const giver = await world.aPersonOpens(host, 'giver')
    world.startsFail = true
    const given = await world.gives(host, giver, 'worker')
    if (!given.ok) throw new Error('the fixture did not record the Give')
    await host.closeAll()
    const reset = new Date(world.clock + 600_000).toISOString()
    world.store.append(
      giver,
      world.store.nextOrdinal(giver),
      {
        type: 'error',
        message: `claude is rate-limited (five_hour) — the turn may stall until it resets; resets ${reset}`,
        fatal: false,
      },
      world.clock++,
    )
    world.clock += 120_000
    expect(world.store.providerLimitsSeen(world.clock).rows).toContainEqual(
      expect.objectContaining({ provider: 'claude', standing: 'stopped' }),
    )
    world.startsFail = false
    world.aHost({ startGapMs: 0 })
    await settleFixtureTurns(2, 0)
    expect(failureNotices(world, giver)).toEqual([])
    expect(world.startedAs.filter((profile) => profile === 'worker')).toHaveLength(1)
  } finally {
    await world.cleanUp()
  }
})

it.each(['recorded', 'missing'])(
  'checks positive first-brief evidence after an interruption before launch (%s)',
  async (evidence) => {
    const world = aServiceWorld()
    try {
      world.anAgent('worker', 'normal')
      const host = world.aHost()
      const giver = await world.aPersonOpens(host, 'giver')
      const parent = world.store.rootOf(giver)
      if (parent === null) throw new Error('the giver has no root')
      await host.closeAll()

      const owner = 'sess_interrupted_first_give'
      const piece = 'work_interrupted_first_give'
      const label = `${parent.label}.1`
      const messageId = 'interrupted-first-give'
      const brief = 'Book the room'
      const at = world.clock++
      world.store.atomically(() => {
        world.store.create({
          id: owner,
          provider: 'claude',
          profileId: 'worker',
          cwd: world.folder,
          approvalMode: 'ask',
          parentSessionId: giver,
        })
        if (evidence === 'recorded')
          world.store.append(
            owner,
            0,
            {
              type: 'message_queued',
              kind: 'work',
              messageId,
              piece,
              label,
              text: brief,
              forItsNextStart: true,
            },
            at,
          )
        world.store.recordGive(
          {
            piece,
            parent: parent.piece,
            number: 1,
            owner,
            givenBy: giver,
            title: brief,
            brief,
            folder: null,
            inputs: [],
          },
          1,
          {
            type: 'work_given',
            piece,
            label,
            parent: parent.piece,
            givenBy: giver,
            title: brief,
            brief,
            definitionOfDone: 'The room is booked',
            messageId,
          },
          at,
        )
      })
      world.clock = at + 120_000
      world.aHost({ startGapMs: 0 })
      if (evidence === 'missing') {
        await settleFixtureTurns(2, 0)
        expect(failureNotices(world, giver)).toEqual([])
        expect(world.startedAs).not.toContain('worker')
        return
      }
      await waitFor(
        () => world.sent.some((turn) => turn.as === 'giver' && turn.words.includes(label)),
        'the giver to hear about the interrupted Give',
      )
      expect(failureNotices(world, giver)).toHaveLength(1)
      expect(world.startedAs).not.toContain('worker')
      expect(world.ledger(giver).some((event) => event.type === 'work_sent')).toBe(false)
      expect(world.store.messagesWaitingIn(owner)).toContainEqual(
        expect.objectContaining({ piece, messageId }),
      )
    } finally {
      await world.cleanUp()
    }
  },
)

it('returns the existing launch inactivity refusal to the giver', async () => {
  vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] })
  const world = aServiceWorld()
  let release = (): void => {}
  try {
    world.anAgent('worker', 'normal')
    const host = world.aHost({ launchTimeoutMs: 100 })
    const giver = await world.aPersonOpens(host, 'giver')
    world.startsWait = new Promise<void>((resolve) => {
      release = resolve
    })
    const given = await world.gives(host, giver, 'worker')
    if (!given.ok) throw new Error('the fixture did not record the Give')
    expect(given.recipientState).toMatchObject({
      kind: 'cannot-run',
      cause: {
        code: 'could-not-start',
        reason: expect.stringContaining('observed no further launch progress'),
      },
    })
    expect(world.store.messagesWaitingIn(given.owner)).toContainEqual(
      expect.objectContaining({ piece: given.piece }),
    )
    world.clock += 120_000
    await vi.advanceTimersByTimeAsync(60_000)
    expect(failureNotices(world, giver)).toEqual([])
  } finally {
    release()
    await world.cleanUp()
    vi.useRealTimers()
  }
})

it('preserves a deliberate wait after an interrupted first brief', async () => {
  vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] })
  const world = aServiceWorld()
  try {
    world.anAgent('worker', 'normal')
    const host = world.aHost()
    const giver = await world.aPersonOpens(host, 'giver')
    world.startsFail = true
    const given = await world.gives(host, giver, 'worker')
    if (!given.ok) throw new Error('the fixture did not record the Give')
    const [brief] = world.store.messagesWaitingIn(given.owner)
    if (brief === undefined) throw new Error('the fixture did not retain the brief')
    const due = brief.at + 240_000
    const parked = await answerOn(agentToolsFor(host, giver), 'update_work', {
      piece: given.label,
      status: 'Wait for the meeting time',
      on: { time: new Date(due).toISOString() },
    })
    expect(parked.structured).toMatchObject({ outcome: 'ok' })
    await host.closeAll()
    world.store.append(
      given.owner,
      world.store.nextOrdinal(given.owner),
      { type: 'launched' },
      world.clock++,
    )

    world.startsFail = false
    world.clock = brief.at + 120_000
    world.aHost({ startGapMs: 0 })
    await settleFixtureTurns(2, 0)
    const beforeDue = failureNotices(world, giver)
    expect(world.store.reconciliationReceipts(given.owner, given.piece)).toEqual([])

    world.clock = due
    await vi.advanceTimersByTimeAsync(60_000)
    expect({
      startNotices: beforeDue.length,
      dueReminders: world.store
        .reconciliationReceipts(given.owner, given.piece)
        .filter((receipt) => receipt.outcome === 'planned'),
    }).toMatchObject({
      startNotices: 0,
      dueReminders: [{ kind: 'wait-target-ended', step: 'holder' }],
    })
  } finally {
    await world.cleanUp()
    vi.useRealTimers()
  }
})
