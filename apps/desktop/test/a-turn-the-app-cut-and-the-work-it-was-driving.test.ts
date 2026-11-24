import {
  aTurnTheAppCutFixture,
  now,
  root,
  window,
  handles,
  waitFor,
  settle,
  aGate,
  CUT,
  SOON,
} from './helpers/a-turn-the-app-cut-fixture'
import type { TranscriptEvent } from '../src/shared/conversation-events'
import { describe, expect, it } from 'vitest'
import { writeProfileExecution } from '../src/main/profile-execution-file'
import { agentToolsFor, type ToolName } from '../src/main/runtime/agent-tools'
import type { NotContinuedBecause } from '../src/main/turns-the-app-cut-file'

describe('a turn the app cut is continued once, on the account it ran on', () => {
  const app = aTurnTheAppCutFixture()
  const {
    starts,
    ledger,
    continuations,
    heldCount,
    stateOf,
    askedFor,
    running,
    theLimitIsReached,
  } = app

  describe('the work it was driving, and who gave it', () => {
    const callOn = async (
      caller: string,
      name: ToolName,
      args: Record<string, unknown>,
    ): Promise<Record<string, unknown>> => {
      const tool = agentToolsFor(now.host, caller).tools.find((one) => one.name === name)
      if (tool === undefined) throw new Error(`no such tool: ${name}`)
      return (await tool.call(args)).structured as Record<string, unknown>
    }
    /** A lead gives a worker a piece; the worker's turn on it is running when the app quits or crashes. */
    const aGivenPieceIsCut = async (
      how: 'quit' | 'crash',
    ): Promise<{ lead: string; worker: string }> => {
      starts(CUT - 60_000, { turnsStayOpen: true })
      const { sessionId: lead } = await now.host.createSession(
        { provider: 'claude', profileId: 'lead', approvalMode: 'auto', cwd: root },
        window,
      )
      await settle()
      await callOn(lead, 'create_agent', { profile_slug: 'agent-w' })
      const given = await callOn(lead, 'give_work', {
        definition_of_done: 'The requested result and its checks are recorded.',
        profile: 'agent-w',
        to: 'new',
        conversation_title: 'build the thing',
        title: 'build the thing',
        brief: 'build the thing',
      })
      expect(given['outcome'], JSON.stringify(given)).toBe('ok')
      const worker = given['agent'] as string
      await waitFor(
        () => ledger(worker).some((event) => event.type === 'user_turn'),
        'the brief to go in',
      )
      await settle()
      app.clock = CUT
      if (how === 'quit') {
        await now.host.closeAll()
        expect(stateOf(worker)).toBe('pending')
      }
      return { lead, worker }
    }
    const restarted = (id: string): number =>
      ledger(id).filter((event) => event.type === 'work_restarted').length
    const toldItStalled = (lead: string): boolean =>
      ledger(lead).some(
        (event) =>
          event.type === 'work_stall_told' ||
          (event.type === 'message_queued' &&
            ('report' in (event as object) || event.appNotice === 'a-work-wait-needs-attention')),
      )

    it('after a crash, the launch says nothing of the work its continuation drives, and nobody is told it stopped', async () => {
      const { lead, worker } = await aGivenPieceIsCut('crash')
      starts(SOON, { turnsStayOpen: true })
      expect(restarted(worker)).toBe(0)
      await waitFor(() => continuations(worker).length === 1, 'the continuation')
      await settle()
      expect(restarted(worker)).toBe(0)
      expect(toldItStalled(lead)).toBe(false)
    })

    it('after a quit, a giver that starts while the continuation is coming is not told its work stopped', async () => {
      const { lead, worker } = await aGivenPieceIsCut('quit')
      starts(SOON, { turnsStayOpen: true })
      const sent = await now.host.startAndSend(lead, 'how is it going?', window)
      expect('notSent' in sent, JSON.stringify(sent)).toBe(false)
      await waitFor(() => continuations(worker).length === 1, 'the continuation')
      await settle()
      expect(toldItStalled(lead)).toBe(false)
    })

    /**
     * A service whose turn on `lead`'s piece One is running when the app crashes, with `other`'s piece
     * Two queued behind it. Every turn after the crash ends at once. With `ask`, that turn waits on a
     * person's approval.
     */
    const aServicesPieceIsCut = async (
      opts: { ask?: boolean } = {},
    ): Promise<{
      lead: string
      other: string
      service: string
      one: string
      two: string
    }> => {
      starts(CUT - 70_000, { services: true })
      const svc = now.store.createAgentIdentity(
        { slug: 'browser-driver', displayName: null, provider: 'claude' },
        { by: 'a-person' },
      )
      if (svc === null) throw new Error('the service already exists')
      writeProfileExecution(now.db, {
        profiles: { [svc.id]: { kind: 'service', identityCreatedAt: svc.createdAt } },
      })
      if (opts.ask !== true) now.store.setDefaultApprovalMode('auto')
      starts(CUT - 60_000, { turnsStayOpen: opts.ask !== true, services: true })
      const opened = async (profileId: string): Promise<string> =>
        (
          await now.host.createSession(
            { provider: 'claude', profileId, approvalMode: 'auto', cwd: root },
            window,
          )
        ).sessionId
      const lead = await opened('lead')
      const other = await opened('other-lead')
      await settle()
      const one = await callOn(lead, 'give_work', {
        definition_of_done: 'The requested result and its checks are recorded.',
        profile: 'browser-driver',
        title: 'One',
        brief: 'book the room',
      })
      expect(one['outcome'], JSON.stringify(one)).toBe('ok')
      const two = await callOn(other, 'give_work', {
        definition_of_done: 'The requested result and its checks are recorded.',
        profile: 'browser-driver',
        title: 'Two',
        brief: 'order lunch',
      })
      expect(two['outcome'], JSON.stringify(two)).toBe('ok')
      const service = one['agent'] as string
      await waitFor(
        () => ledger(service).some((event) => event.type === 'user_turn'),
        'the first brief to go in',
      )
      if (opts.ask === true) {
        await waitFor(
          () => ledger(service).some((event) => event.type === 'permission_request'),
          'its approval to be asked',
        )
      }
      await settle()
      app.clock = CUT
      return {
        lead,
        other,
        service,
        one: one['label'] as string,
        two: two['label'] as string,
      }
    }
    const piecesAt = (service: string): string[][] =>
      now.store.piecesOwnedBy(service).map((piece) => [piece.title ?? '', piece.state])
    const handedOverAt = (service: string): number =>
      ledger(service).filter(
        (event) =>
          event.type === 'message_unqueued' && (event as { reason?: string }).reason === 'sent',
      ).length

    it('a service’s cut is continued once on the piece it was on, and its queue keeps its place', async () => {
      const { lead, other, service } = await aServicesPieceIsCut()
      starts(SOON, { services: true, turnsStayOpen: true })
      await waitFor(() => continuations(service).length === 1, 'the continuation')
      await settle()
      expect(stateOf(service)).toBe('sent')
      expect(restarted(service)).toBe(0)
      expect(piecesAt(service)).toEqual([
        ['One', 'working'],
        ['Two', 'waiting'],
      ])
      expect(toldItStalled(lead)).toBe(false)
      expect(toldItStalled(other)).toBe(false)
      // ⚑ …a crash in the continued turn is continued once more, on the same piece…
      app.clock = SOON + 30_000
      starts(SOON + 60_000, { services: true, turnsStayOpen: true })
      await waitFor(() => continuations(service).length === 2, 'the second continuation')
      await waitFor(() => stateOf(service) === 'sent', 'the second continuation sent')
      await settle()
      // ⛔ …and a third cut waits for a person, and stalls only One.
      app.clock = SOON + 90_000
      starts(SOON + 120_000, { services: true })
      await waitFor(() => typeof stateOf(service) === 'object', 'the third cut to end')
      await settle()
      expect(stateOf(service)).toEqual({ ended: 'continued-twice' })
      expect(continuations(service)).toHaveLength(2)
      expect(piecesAt(service)).toEqual([
        ['One', 'stalled'],
        ['Two', 'waiting'],
      ])
    })

    it('a service’s turn a quit cut is continued once on the piece it was on', async () => {
      const { service } = await aServicesPieceIsCut()
      await now.host.closeAll()
      expect(stateOf(service)).toBe('pending')
      starts(SOON, { services: true })
      await waitFor(() => continuations(service).length === 1, 'the continuation')
      await settle()
      expect(stateOf(service)).toBe('sent')
      expect(piecesAt(service)[1]).toEqual(['Two', 'waiting'])
    })

    it('⛔ a service whose piece had ended before the crash goes on with nothing, stalls nothing, and hands the next over', async () => {
      const { service, one } = await aServicesPieceIsCut()
      const answered = await callOn(service, 'reply_to_parent', {
        piece: one,
        outcome: 'done',
        summary: 'Booked.',
      })
      expect(answered['outcome'], JSON.stringify(answered)).toBe('ok')
      starts(SOON, { services: true })
      await waitFor(() => typeof stateOf(service) === 'object', 'the cut to end')
      await settle()
      expect(stateOf(service)).toEqual({ ended: 'a-service' })
      expect(continuations(service)).toEqual([])
      expect(restarted(service)).toBe(0)
      await waitFor(() => handedOverAt(service) === 2, 'the next piece to be handed over')
      expect(piecesAt(service)[0]).toEqual(['One', 'answered'])
    })

    it('⛔ a service’s continuation whose piece is taken back while its account is asked is dropped, and never attached to the next', async () => {
      const { lead, service, one } = await aServicesPieceIsCut()
      starts(SOON, { services: true, accountAfterMs: 400 })
      await waitFor(() => running(now, service), 'the service to start for its cut')
      const taken = await callOn(lead, 'withdraw_task', { piece: one })
      expect(taken['outcome'], JSON.stringify(taken)).toBe('ok')
      await waitFor(() => typeof stateOf(service) === 'object', 'the cut to end')
      await settle()
      expect(stateOf(service)).toEqual({ ended: 'overtaken' })
      expect(continuations(service)).toEqual([])
      expect(askedFor(now, service)).toBe(1)
    })

    it('⛔ a service’s continuation whose piece is answered while its account is asked is dropped', async () => {
      const { other, service, one, two } = await aServicesPieceIsCut()
      starts(SOON, { services: true, accountAfterMs: 400 })
      await waitFor(() => running(now, service), 'the service to start for its cut')
      // Nothing waits behind it, so no next brief can overtake the continuation first.
      expect((await callOn(other, 'withdraw_task', { piece: two }))['outcome']).toBe('ok')
      const answered = await callOn(service, 'reply_to_parent', {
        piece: one,
        outcome: 'done',
        summary: 'Booked.',
      })
      expect(answered['outcome'], JSON.stringify(answered)).toBe('ok')
      await waitFor(() => typeof stateOf(service) === 'object', 'the cut to end')
      await settle()
      expect(stateOf(service)).toEqual({ ended: 'overtaken' })
      expect(continuations(service)).toEqual([])
      // Dropped before its words were held: nothing was held to be taken back.
      expect(heldCount(service)).toBe(0)
    })

    it('⛔ a service’s continuation whose piece is answered as its words wait to go is never sent', async () => {
      const { other, service, one, two } = await aServicesPieceIsCut()
      const gate = aGate()
      starts(SOON, { services: true, signInGate: gate })
      await waitFor(() => stateOf(service) === 'queued', 'the continuation to be held')
      // Nothing waits behind it, so nothing else needs the life started for the cut.
      expect((await callOn(other, 'withdraw_task', { piece: two }))['outcome']).toBe('ok')
      // The reply's delivery waits on the same gate, so the gate opens once its row is down.
      const answering = callOn(service, 'reply_to_parent', {
        piece: one,
        outcome: 'done',
        summary: 'Booked.',
      })
      await waitFor(() => piecesAt(service)[0]?.[1] === 'answered', 'the piece to be answered')
      gate.open()
      expect((await answering)['outcome']).toBe('ok')
      await waitFor(() => typeof stateOf(service) === 'object', 'the cut to end')
      await settle()
      expect(stateOf(service)).toEqual({ ended: 'overtaken' })
      expect(continuations(service)).toEqual([])
      // The life started only for the cut has nothing left to do, and is stopped again.
      await waitFor(() => !running(now, service), 'the life started for it to be stopped')
    })

    it('⛔ a service’s continuation that does not go stalls only the piece it was on, and tells only that piece’s caller', async () => {
      const { lead, other, service } = await aServicesPieceIsCut()
      starts(SOON, { services: true, account: 'bea' })
      await waitFor(() => typeof stateOf(service) === 'object', 'the cut to end')
      await settle()
      expect(stateOf(service)).toEqual({ ended: 'not-same-account' })
      expect(piecesAt(service)).toEqual([
        ['One', 'stalled'],
        ['Two', 'waiting'],
      ])
      for (const caller of [lead, other]) {
        const sent = await now.host.startAndSend(caller, 'how is it going?', window)
        expect('notSent' in sent, JSON.stringify(sent)).toBe(false)
      }
      await waitFor(() => toldItStalled(lead), 'its caller to be told')
      await settle()
      expect(toldItStalled(other)).toBe(false)
    })

    const toldCount = (caller: string): number =>
      ledger(caller).filter(
        (event) =>
          event.type === 'work_stall_told' ||
          (event.type === 'message_queued' &&
            ('report' in (event as object) || event.appNotice === 'a-work-wait-needs-attention')),
      ).length
    /** The service's handle in this life, the last one started. */
    const itsMachine = (): {
      noteProviderWork(): void
      completeTurn(state: 'completed'): void
    } => {
      const handle = handles.at(-1)
      if (handle === undefined) throw new Error('no handle')
      return (
        handle as unknown as {
          machine: { noteProviderWork(): void; completeTurn(state: 'completed'): void }
        }
      ).machine
    }
    /**
     * A service's cut that ends as `why`, at this launch and at the next after a crash: nothing of it
     * is continued or tried again, nothing past One is handed over, and Two waits with its caller
     * untold. With `stalls`, One stalls, and its caller alone is told, once.
     */
    const itGoesNowhere = async (
      cut: { readonly lead: string; readonly other: string; readonly service: string },
      why: NotContinuedBecause,
      stalls: boolean,
    ): Promise<void> => {
      const { lead, other, service } = cut
      // ⚑ What its ledger had handed over by the cut: nothing more is, at either launch.
      const handedOverAtTheCut = handedOverAt(service)
      await waitFor(() => typeof stateOf(service) === 'object', 'the cut to end')
      await settle()
      expect(stateOf(service)).toEqual({ ended: why })
      const asItStands = async (): Promise<void> => {
        expect(continuations(service)).toEqual([])
        expect(handedOverAt(service)).toBe(handedOverAtTheCut)
        // ⚑ Two's brief never handed over: its piece still waits.
        expect(piecesAt(service)[1]).toEqual(['Two', 'waiting'])
        if (stalls) expect(piecesAt(service)[0]).toEqual(['One', 'stalled'])
        for (const caller of [lead, other]) {
          if (running(now, caller)) continue
          const sent = await now.host.startAndSend(caller, 'how is it going?', window)
          expect('notSent' in sent, JSON.stringify(sent)).toBe(false)
        }
        if (stalls) await waitFor(() => toldCount(lead) === 1, 'its caller to be told')
        await settle()
        if (stalls) expect(toldCount(lead)).toBe(1)
        expect(toldCount(other)).toBe(0)
      }
      await asItStands()
      starts(SOON + 120_000, { services: true })
      await settle()
      expect(stateOf(service)).toEqual({ ended: why })
      expect(askedFor(now, service)).toBe(0)
      await asItStands()
    }

    it('⛔ a service’s cut whose start fails goes nowhere, at this launch or the next', async () => {
      const cut = await aServicesPieceIsCut()
      starts(SOON, { services: true, startsFailFor: 'browser-driver' })
      await itGoesNowhere(cut, 'start-failed', true)
    })

    it('⛔ a service’s cut turn waiting on a person’s approval goes nowhere, at this launch or the next', async () => {
      const cut = await aServicesPieceIsCut({ ask: true })
      starts(SOON, { services: true })
      await itGoesNowhere(cut, 'blocked', true)
    })

    it('⛔ a service a person archives before its cut’s start goes nowhere, at this launch or the next', async () => {
      const cut = await aServicesPieceIsCut()
      starts(SOON, { services: true })
      expect(running(now, cut.service)).toBe(false)
      await now.host.archiveConversation(cut.service)
      await itGoesNowhere(cut, 'kept-stopped', true)
    })

    it('⛔ a service a person stops while its cut’s account is asked goes nowhere, at this launch or the next', async () => {
      const cut = await aServicesPieceIsCut()
      starts(SOON, { services: true, accountAfterMs: 400 })
      await waitFor(() => running(now, cut.service), 'the service to start for its cut')
      now.host.claimSession(cut.service, window)
      await now.host.close(cut.service, window)
      await itGoesNowhere(cut, 'stopped', true)
    })

    it('⛔ a service whose provider runs a turn of its own while its cut’s account is asked goes nowhere', async () => {
      const cut = await aServicesPieceIsCut()
      starts(SOON, { services: true, accountAfterMs: 400 })
      await waitFor(() => running(now, cut.service), 'the service to start for its cut')
      const machine = itsMachine()
      machine.noteProviderWork()
      await waitFor(
        () => ledger(cut.service).some((event) => event.type === 'provider_turn'),
        'its own turn',
      )
      machine.completeTurn('completed')
      // ⚑ Its own turn ended with One unanswered, so One stalls as any piece does then.
      await itGoesNowhere(cut, 'overtaken', true)
    })

    it('⛔ a service’s cut at its provider’s usage limit goes nowhere, at this launch or the next', async () => {
      const cut = await aServicesPieceIsCut()
      starts(SOON, { services: true })
      theLimitIsReached()
      await itGoesNowhere(cut, 'limited', true)
    })

    it('⛔ a service whose queue can’t be read goes on with nothing, at this launch or the next', async () => {
      const cut = await aServicesPieceIsCut()
      const one = now.store.piecesOwnedBy(cut.service)[0]
      if (one === undefined) throw new Error('no first piece')
      // A row of its work that can't be read, as a crash may leave one.
      const ordinal = now.store.nextOrdinal(cut.service) + 1_000
      now.store.append(
        cut.service,
        ordinal,
        {
          type: 'work_status_set',
          piece: one.piece,
          line: 'torn',
          by: cut.lead,
        } as TranscriptEvent,
        CUT,
      )
      now.db
        .prepare("UPDATE events SET payload = '{not json' WHERE session_id = ? AND ordinal = ?")
        .run(cut.service, ordinal)
      starts(SOON, { services: true })
      await itGoesNowhere(cut, 'a-service', true)
    })

    it('⛔ a service whose cut turn drove other work goes on with nothing, at this launch or the next', async () => {
      const cut = await aServicesPieceIsCut()
      // One's turn ends; its caller's note about its own work goes in, and that turn is cut.
      itsMachine().completeTurn('completed')
      await waitFor(() => piecesAt(cut.service)[0]?.[1] === 'stalled', 'One to stall')
      const root = now.store.rootOf(cut.lead)
      if (root === null) throw new Error('the caller holds no work of its own')
      const noted = await callOn(cut.lead, 'message_agent', {
        agent: cut.service,
        kind: 'note',
        piece: root.label,
        text: 'for my own records',
      })
      expect(noted['outcome'], JSON.stringify(noted)).toBe('ok')
      await waitFor(
        () => ledger(cut.service).filter((event) => event.type === 'user_turn').length === 2,
        'the note’s turn',
      )
      await waitFor(() => toldCount(cut.lead) === 1, 'One’s caller to be told it stalled')
      await settle()
      app.clock = CUT
      starts(SOON, { services: true })
      await itGoesNowhere(cut, 'a-service', true)
    })

    /**
     * One's turn ends with its caller's words held behind it, which go in one turn of their own that
     * the crash cuts: `about` names the piece each one names.
     */
    const aCutOfTheCallersWords = async (
      about: readonly ('its-piece' | 'its-own-work' | 'nothing')[],
    ): Promise<{ lead: string; other: string; service: string; one: string }> => {
      const cut = await aServicesPieceIsCut()
      const root = now.store.rootOf(cut.lead)
      if (root === null) throw new Error('the caller holds no work of its own')
      for (const [at, named] of about.entries()) {
        const sent = await callOn(cut.lead, 'message_agent', {
          agent: cut.service,
          ...(named === 'its-piece'
            ? { kind: 'follow-up', piece: cut.one }
            : named === 'its-own-work'
              ? { kind: 'note', piece: root.label }
              : { kind: 'note' }),
          text: `word ${String(at)}`,
        })
        expect(sent['outcome'], JSON.stringify(sent)).toBe('ok')
      }
      itsMachine().completeTurn('completed')
      await waitFor(
        () => ledger(cut.service).filter((event) => event.type === 'user_turn').length === 2,
        'the words’ turn',
      )
      const batch = ledger(cut.service).filter((event) => event.type === 'user_turn')[1]
      if (about.length > 1) {
        expect((batch as { parts?: unknown[] } | undefined)?.parts).toHaveLength(about.length)
      }
      await settle()
      app.clock = CUT
      return cut
    }

    it('⛔ a service whose cut turn named other work beside its piece goes on with nothing, at this launch or the next', async () => {
      const cut = await aCutOfTheCallersWords(['its-own-work', 'its-piece'])
      starts(SOON, { services: true })
      await itGoesNowhere(cut, 'a-service', true)
    })

    it('⛔ a service whose cut turn asked to stop one that named other work goes on with nothing, at this launch or the next', async () => {
      const cut = await aCutOfTheCallersWords(['its-own-work'])
      // Its caller's words ask the turn on its own work to stop, and go in the turn after it.
      const sent = await callOn(cut.lead, 'message_agent', {
        agent: cut.service,
        kind: 'follow-up',
        piece: cut.one,
        interrupt: true,
        text: 'stop and read this',
      })
      expect(sent['outcome'], JSON.stringify(sent)).toBe('ok')
      ;(itsMachine() as unknown as { completeTurn(state: 'interrupted'): void }).completeTurn(
        'interrupted',
      )
      await waitFor(
        () => ledger(cut.service).filter((event) => event.type === 'user_turn').length === 3,
        'the turn its words asked for',
      )
      await settle()
      app.clock = CUT
      starts(SOON, { services: true })
      await itGoesNowhere(cut, 'a-service', true)
    })

    it('⛔ a service whose cut turn’s words can’t be read goes on with nothing, at this launch or the next', async () => {
      const cut = await aServicesPieceIsCut()
      now.db
        .prepare(
          "UPDATE events SET payload = '{not json' WHERE session_id = ? AND type = 'user_turn'",
        )
        .run(cut.service)
      starts(SOON, { services: true })
      await itGoesNowhere(cut, 'a-service', true)
    })

    it.each([
      ['its piece twice', ['its-piece', 'its-piece']],
      ['its piece and nothing', ['nothing', 'its-piece']],
    ] as const)(
      'a service’s cut turn whose words name %s is continued on that piece',
      async (_named, about) => {
        const { service } = await aCutOfTheCallersWords(about)
        starts(SOON, { services: true })
        await waitFor(() => continuations(service).length === 1, 'the continuation')
        await settle()
        expect(stateOf(service)).toBe('sent')
      },
    )

    it('⛔ a service whose cut found two pieces handed over goes on with neither, and hands nothing more over', async () => {
      // ⚑ Its dispatcher never hands a second piece over while one is open: a row says so here.
      const { lead, other, service } = await aServicesPieceIsCut()
      const three = await callOn(other, 'give_work', {
        definition_of_done: 'The requested result and its checks are recorded.',
        profile: 'browser-driver',
        title: 'Three',
        brief: 'water the plants',
      })
      expect(three['outcome'], JSON.stringify(three)).toBe('ok')
      const two = now.store.piecesOwnedBy(service)[1]
      if (two?.messageId == null) throw new Error('no queued second piece')
      now.store.append(
        service,
        now.store.nextOrdinal(service),
        { type: 'message_unqueued', messageId: two.messageId, reason: 'sent' } as TranscriptEvent,
        CUT,
      )
      starts(SOON, { services: true })
      await waitFor(() => typeof stateOf(service) === 'object', 'the cut to end')
      await settle()
      expect(stateOf(service)).toEqual({ ended: 'a-service' })
      starts(SOON + 120_000, { services: true })
      await settle()
      expect(stateOf(service)).toEqual({ ended: 'a-service' })
      expect(askedFor(now, service)).toBe(0)
      expect(continuations(service)).toEqual([])
      expect(handedOverAt(service)).toBe(2)
      expect(piecesAt(service)).toEqual([
        ['One', 'stalled'],
        ['Two', 'stalled'],
        ['Three', 'waiting'],
      ])
      for (const caller of [lead, other]) {
        const sent = await now.host.startAndSend(caller, 'how is it going?', window)
        expect('notSent' in sent, JSON.stringify(sent)).toBe(false)
      }
      await waitFor(() => toldCount(lead) === 1 && toldCount(other) === 1, 'each caller told')
      await settle()
      expect([toldCount(lead), toldCount(other)]).toEqual([1, 1])
    })

    it('⛔ a service’s piece taken back before its cut’s start: the start is made, the cut dropped, and the next piece goes on its own', async () => {
      const { lead, service, one } = await aServicesPieceIsCut()
      starts(SOON, { services: true })
      expect(running(now, service)).toBe(false)
      expect((await callOn(lead, 'withdraw_task', { piece: one }))['outcome']).toBe('ok')
      await waitFor(() => typeof stateOf(service) === 'object', 'the cut to end')
      await settle()
      expect(stateOf(service)).toEqual({ ended: 'overtaken' })
      await waitFor(
        () => piecesAt(service)[1]?.[1] !== undefined && piecesAt(service)[1]?.[1] !== 'waiting',
        'the next piece to be handed over',
      )
      await settle()
      expect(continuations(service)).toEqual([])
      expect(piecesAt(service)[0]).toEqual(['One', 'withdrawn'])
      // ⚑ The start it waited for is still made, once: what it drops is its words.
      expect(askedFor(now, service)).toBe(1)
      // …and the next launch, after a crash, continues nothing.
      starts(SOON + 120_000, { services: true })
      await settle()
      expect(stateOf(service)).toEqual({ ended: 'overtaken' })
      expect(continuations(service)).toEqual([])
    })

    it('⛔ when a crash’s continuation does not go, the work stalls then, and its giver is told as it starts', async () => {
      const { lead, worker } = await aGivenPieceIsCut('crash')
      starts(SOON, { account: 'bea' })
      expect(restarted(worker)).toBe(0)
      await waitFor(() => typeof stateOf(worker) === 'object', 'the cut to end')
      await settle()
      expect(stateOf(worker)).toEqual({ ended: 'not-same-account' })
      expect(restarted(worker)).toBe(1)
      const sent = await now.host.startAndSend(lead, 'how is it going?', window)
      expect('notSent' in sent, JSON.stringify(sent)).toBe(false)
      await waitFor(() => toldItStalled(lead), 'its giver to be told')
    })

    it('⛔ …and a piece its giver marked as waiting on purpose stalls once too, keeps its mark, and a second stop sweep writes nothing', async () => {
      const { lead, worker } = await aGivenPieceIsCut('crash')
      const label = now.store.piecesOwnedBy(worker)[0]?.label
      const parked = await callOn(lead, 'update_work', {
        piece: label,
        status: 'until the review lands',
        on: { time: new Date(app.clock + 3_600_000).toISOString() },
      })
      expect(parked['outcome'], JSON.stringify(parked)).toBe('ok')
      expect(now.store.piecesOwnedBy(worker)[0]).toMatchObject({
        state: 'waiting-on-purpose',
        parkedOver: 'working',
      })
      starts(SOON, { account: 'bea' })
      await waitFor(() => typeof stateOf(worker) === 'object', 'the cut to end')
      await settle()
      expect(stateOf(worker)).toEqual({ ended: 'not-same-account' })
      expect(restarted(worker)).toBe(1)
      // ⚑ The mark outlasts the restart: still waiting on purpose, over the stall the sweep wrote.
      expect(now.store.piecesOwnedBy(worker)[0]).toMatchObject({
        state: 'waiting-on-purpose',
        parkedOver: 'stalled',
        stalledBecause: null,
      })
      // ⛔ The stop sweep once more writes nothing: the piece no longer stands over a drive.
      ;(now.host as unknown as { stallWhatACutLeft(conversation: string): void }).stallWhatACutLeft(
        worker,
      )
      expect(restarted(worker)).toBe(1)
    })
  })
})
