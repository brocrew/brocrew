import { tmpdir } from 'node:os'
import { expect, it, vi } from 'vitest'
import type { TranscriptEvent } from '../../src/shared/conversation-events'
import type { SessionStore } from '../../src/main/db/session-store'
import type { RuntimeHost } from '../../src/main/runtime/runtime-host'
import type { WorkReconciler } from '../../src/main/runtime/work-reconciliation'
import { agentToolsFor } from '../../src/main/runtime/agent-tools'
import { planProviderFailureNotice, recordFailedQuestionTurn } from '../lib/question-wake'
import { waitFor } from '../lib/f093-host'
import { settle } from './persisted-wait-revision-cases'

interface PersistedReadContext {
  host(): RuntimeHost
  replaceHost(host: RuntimeHost): void
  create(): Promise<{ owner: string; work: { piece: string; label: string } }>
  store(): SessionStore
  build(): RuntimeHost
}

/** The host's private reads these cases watch; production code is not changed for them. */
interface ReconciliationInternals {
  workReconciler: WorkReconciler
  initialReconciliation?: Promise<void>
  reconcileProviderFailureNotices(holders: ReadonlySet<string>): void
  reconciliationReading(onlyPiece?: string, holders?: ReadonlySet<string>): unknown
  writeIntoItsLedger(owner: string, event: TranscriptEvent): void
}

const inside = (host: RuntimeHost) => host as unknown as ReconciliationInternals

/**
 * Card 327 moves the remaining persisted reconciliation reads (holder enumeration, provider
 * failure episode and progress, waits outside the group) behind the database module. These cases
 * pin what those reads decide today, so the move can be checked against the same cases unchanged.
 */
export function registerReconciliationPersistedReadCases(
  context: PersistedReadContext,
  tick: () => number,
): void {
  const append = (owner: string, event: TranscriptEvent) => {
    const store = context.store()
    const ordinal = store.nextOrdinal(owner)
    store.append(owner, ordinal, event, tick())
    return ordinal
  }
  const rebuild = async () => {
    const host = context.build()
    context.replaceHost(host)
    await inside(host).initialReconciliation
    await settle()
    // The initial pass starts after the first window load; wait it out before spying on later passes.
    for (let pass = inside(host).workReconciler.currentPass(); pass !== null;)
      pass = (await pass, inside(host).workReconciler.currentPass())
    return host
  }
  const queuedFor = (asker: string, messageId: string) =>
    context
      .store()
      .events(asker)
      .filter((one) => one.event.type === 'message_queued' && one.event.messageId === messageId)

  /** An answerer with no work whose provider failed its question turn, with a planned notice. */
  const aFailedAnswerer = async () => {
    const { owner: asker } = await context.create()
    await context.host().closeAll()
    const store = context.store()
    const holder = 'fictional-answerer-without-work'
    store.create({
      id: holder,
      provider: 'codex',
      cwd: tmpdir(),
      approvalMode: 'auto',
      profileId: 'worker',
      parentSessionId: asker,
    })
    const message = 'The fictional provider could not run the selected model.'
    const { turnOrdinal } = recordFailedQuestionTurn(append, {
      asker,
      holder,
      requestId: 'req_fictional_failed_peer',
      prompt: 'Which fictional clock face should be kept?',
      message,
    })
    const messageId = 'fictional-failure-notice'
    const held = planProviderFailureNotice(append, {
      asker,
      holder,
      terminalOrdinal: turnOrdinal,
      since: tick(),
      incident: 'fictional-failure-incident',
      messageId,
      text: message,
    })
    return { asker, holder, messageId, message, turnOrdinal, held }
  }

  it('a whole sweep reads each enumerated holder once, in store order, 100 at a time, failures first', async () => {
    const { owner: asker } = await context.create()
    await context.host().closeAll()
    const store = context.store()
    // Holders with a provider-failure receipt; the sweep reads the inclusive enumeration.
    for (let at = 0; at < 205; at++) {
      const holder = `fictional-failure-holder-${String(at).padStart(3, '0')}`
      store.create({
        id: holder,
        provider: 'codex',
        cwd: tmpdir(),
        approvalMode: 'auto',
        profileId: 'worker',
        parentSessionId: asker,
      })
      append(holder, {
        type: 'work_reconciliation',
        incident: `fictional-incident-${at}`,
        kind: 'provider-turn-failed',
        episode: { generation: 0, terminalOrdinal: 0 },
        since: tick(),
        step: 'giver',
        outcome: 'delivered',
        target: asker,
        messageId: `fictional-delivered-${at}`,
      })
    }
    const enumerated = store.reconciliationOwners(true)
    expect(enumerated).toHaveLength(206)

    const host = inside(await rebuild())
    const calls: { read: 'failures' | 'pieces'; holders: string[] }[] = []
    const failures = host.reconcileProviderFailureNotices.bind(host)
    const reading = host.reconciliationReading.bind(host)
    host.reconcileProviderFailureNotices = (holders) => {
      calls.push({ read: 'failures', holders: [...holders] })
      failures(holders)
    }
    host.reconciliationReading = (onlyPiece, holders) => {
      if (onlyPiece === undefined && holders !== undefined)
        calls.push({ read: 'pieces', holders: [...holders] })
      return reading(onlyPiece, holders)
    }
    await host.workReconciler.run()

    const groups = calls.filter((one) => one.read === 'failures').map((one) => one.holders)
    expect(groups.map((group) => group.length)).toEqual([100, 100, 6])
    expect(groups.flat()).toEqual(enumerated)
    // Each group's failure notices are read before its ordinary pieces, with the same holders.
    expect(calls).toEqual(
      groups.flatMap((holders) => [
        { read: 'failures', holders },
        { read: 'pieces', holders },
      ]),
    )
  })

  it('a planned failure notice whose turn already opened is recorded delivered, not queued again', async () => {
    const { asker, holder, messageId, held } = await aFailedAnswerer()
    append(asker, { ...held, type: 'message_unqueued', reason: 'sent' })
    append(asker, {
      type: 'user_turn',
      text: held.text,
      attribution: 'app_authored',
      appNotice: 'a-provider-turn-failed',
    })
    const store = context.store()
    expect(['running', 'turn-ended']).toContain(
      store.providerFailureNoticeProgress(asker, messageId),
    )
    await rebuild()
    await waitFor(
      () => store.reconciliationReceiptsForOwner(holder).at(-1)?.outcome === 'delivered',
      'the sweep to record the notice as delivered',
    )
    expect(store.reconciliationReceiptsForOwner(holder)).toMatchObject([
      { outcome: 'planned', messageId, target: asker },
      { outcome: 'delivered', messageId, target: asker },
    ])
    expect(queuedFor(asker, messageId)).toHaveLength(1)
  })

  it('a failure episode that moved after the sweep read it sends nothing; the next sweep replans', async () => {
    const { asker, holder, messageId, held, message } = await aFailedAnswerer()
    append(asker, { ...held, type: 'message_unqueued', reason: 'retracted' })
    const store = context.store()
    expect(store.providerFailureNoticeProgress(asker, messageId)).toBe('retracted')
    const episode = store.providerFailureEpisode.bind(store)
    let sweeping = false
    let moved = true
    vi.spyOn(store, 'providerFailureEpisode').mockImplementation((id, unread) => {
      const read = episode(id, unread)
      if (id !== holder || sweeping || !moved || typeof read === 'string') return read
      return { ...read, terminalOrdinal: read.terminalOrdinal + 1 }
    })
    const host = inside(context.build())
    context.replaceHost(host as unknown as RuntimeHost)
    const failures = host.reconcileProviderFailureNotices.bind(host)
    host.reconcileProviderFailureNotices = (holders) => {
      sweeping = true
      try {
        failures(holders)
      } finally {
        sweeping = false
      }
    }
    await host.initialReconciliation
    await host.workReconciler.run()
    await settle()
    expect(store.reconciliationReceiptsForOwner(holder)).toHaveLength(1)
    expect(queuedFor(asker, messageId)).toHaveLength(1)

    // Control: the same episode read again in the delivery turn replans the same notice.
    moved = false
    await host.workReconciler.run()
    await waitFor(
      () => queuedFor(asker, messageId).length === 2,
      'the unchanged episode to queue the notice again',
    )
    expect(queuedFor(asker, messageId)[1]?.event).toHaveProperty(
      'text',
      expect.stringContaining(message),
    )
  })

  /** A worker piece under `owner`, given through the agent tools as the product gives it. */
  const aGivenPiece = async (owner: string) => {
    const { tools } = agentToolsFor(context.host(), owner)
    const made = await tools
      .find((tool) => tool.name === 'create_agent')!
      .call({
        profile_slug: 'fictional-target-worker',
      })
    expect(made.structured).toMatchObject({ outcome: 'ok' })
    const given = await tools
      .find((tool) => tool.name === 'give_work')!
      .call({
        profile: 'fictional-target-worker',
        title: 'Fictional target',
        brief: 'A fictional target.',
        definition_of_done: 'A checked fictional result.',
        to: 'new',
        conversation_title: 'Fictional target',
      })
    await settle()
    return given.structured as { piece: string; label: string; agent: string }
  }
  const waitsOn = (owner: string, piece: string, on: Record<string, unknown>, by = owner) =>
    inside(context.host()).writeIntoItsLedger(owner, {
      type: 'work_status_set',
      piece,
      line: 'waiting for the fictional target',
      by,
      waiting: true,
      on,
    } as TranscriptEvent)
  const onlyThese = async (...holders: string[]) => {
    await inside(context.host()).workReconciler.run(new Set(holders))
    await settle()
  }

  it('a targeted pass reads piece waits outside its holders: open is valid, absent is missing', async () => {
    const a = await context.create()
    const b = await context.create()
    const c = await context.create()
    const target = await aGivenPiece(b.owner)
    waitsOn(a.owner, a.work.piece, { kind: 'agent', piece: target.piece, label: target.label })
    waitsOn(c.owner, c.work.piece, {
      kind: 'agent',
      piece: 'fictional-piece-that-does-not-exist',
      label: 'W9.9',
    })
    await onlyThese(a.owner, c.owner)
    const store = context.store()
    expect(store.reconciliationReceipts(a.owner, a.work.piece)).toEqual([])
    expect(store.reconciliationReceipts(c.owner, c.work.piece)[0]).toMatchObject({
      kind: 'wait-target-missing',
      step: 'holder',
    })
  })

  it('an unreadable wait target outside the pass leaves its holder unread, without an incident', async () => {
    const a = await context.create()
    const b = await context.create()
    const target = await aGivenPiece(b.owner)
    waitsOn(a.owner, a.work.piece, { kind: 'agent', piece: target.piece, label: target.label })
    inside(context.host()).writeIntoItsLedger(target.agent, {
      type: 'work_replied',
      piece: target.piece,
      outcome: 'done',
      summary: 'Checked.',
      resources: [],
    })
    await settle()
    const store = context.store()
    // The touched pass may already have recorded the ended target; start from a holder without one.
    const before = store.reconciliationReceipts(a.owner, a.work.piece).length
    const byId = store.workById.bind(store)
    const unreadable = vi.spyOn(store, 'workById').mockImplementation((piece) => {
      if (piece === target.piece) throw new Error('fictional unreadable wait target')
      return byId(piece)
    })
    waitsOn(a.owner, a.work.piece, { kind: 'agent', piece: target.piece, label: target.label })
    await onlyThese(a.owner)
    expect(store.reconciliationReceipts(a.owner, a.work.piece)).toHaveLength(before)

    // Control: once the target reads again, the same pass finds it ended.
    unreadable.mockRestore()
    await onlyThese(a.owner)
    expect(store.reconciliationReceipts(a.owner, a.work.piece).at(-1)).toMatchObject({
      kind: 'wait-target-ended',
    })
  })

  it('a request wait is looked up through the conversation that recorded it', async () => {
    const a = await context.create()
    const recorder = await context.create()
    const answerer = await context.create()
    const requestId = 'req_fictional_recorded_elsewhere'
    inside(context.host()).writeIntoItsLedger(recorder.owner, {
      type: 'question_asked',
      requestId,
      prompt: 'Which fictional colour should the chart use?',
      questions: [
        { id: 'answer', prompt: 'Which fictional colour should the chart use?', options: [] },
      ],
    } as TranscriptEvent)
    inside(context.host()).writeIntoItsLedger(recorder.owner, {
      type: 'request_routed',
      requestId,
      to: 'an-agent',
      parent: answerer.owner,
    } as TranscriptEvent)
    const store = context.store()
    expect(store.routedRequestsOf(recorder.owner).map((one) => one.requestId)).toContain(requestId)

    waitsOn(a.owner, a.work.piece, { kind: 'agent', request: requestId }, recorder.owner)
    await onlyThese(a.owner)
    expect(store.reconciliationReceipts(a.owner, a.work.piece)).toEqual([])

    // Control: the same wait recorded by its own holder cannot find the request.
    waitsOn(a.owner, a.work.piece, { kind: 'agent', request: requestId })
    await onlyThese(a.owner)
    expect(store.reconciliationReceipts(a.owner, a.work.piece)[0]).toMatchObject({
      kind: 'wait-target-missing',
      step: 'holder',
    })
  })
}
