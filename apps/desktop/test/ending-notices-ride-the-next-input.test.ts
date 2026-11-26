import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ResumeError } from '@brobot2/runtime'
import { FakeRuntime, type FakeSessionHandle } from '@brobot2/runtime/testing'
import { agentToolsFor, type ToolName } from '../src/main/runtime/agent-tools'
import { agentCallerId } from '../src/main/runtime/conversation-caller'
import type { RuntimeHost } from '../src/main/runtime/runtime-host'
import { F093World, waitFor } from './lib/f093-host'

/**
 * Closing or withdrawing someone else's task tells its holder, and its giver, who did it and why.
 * The notice is recorded at once and rides that conversation's next input; nothing is started just
 * to deliver it. A giver whose recorded wait names exactly the ended task is started by the wait
 * reconciliation, and the notice rides that turn once.
 *
 * Every conversation runs in ask mode, so each of its turns parks on a permission card until the
 * test answers it. A holder records a wait on purpose while its first turn is parked, so the
 * stall reminder for an open task never adds a turn of its own.
 */
describe('ending notices ride the next input', () => {
  let world: F093World
  let host: RuntimeHost
  let profiles: Set<string>

  beforeEach(() => {
    world = new F093World()
    profiles = new Set()
    host = world.buildHost(false, { startGapMs: 0 })
  })

  afterEach(async () => {
    await world.dispose()
  })

  const call = async (
    caller: string,
    name: ToolName,
    args: Record<string, unknown>,
  ): Promise<Record<string, unknown> & { said: string }> => {
    const tool = agentToolsFor(host, caller).tools.find((one) => one.name === name)
    if (tool === undefined) throw new Error(`no such tool: ${name}`)
    const answer = await tool.call(args)
    return { said: answer.text, ...(answer.structured as Record<string, unknown>) }
  }

  const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 150))

  const later = (): string => new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()

  const open = (profile: string): Promise<string> =>
    world.open(host, 'claude', profile, { approvalMode: 'ask' })

  const cards = (id: string): { id: string }[] =>
    world
      .ledger(id)
      .flatMap((event) => (event.type === 'permission_request' ? [event as { id: string }] : []))

  const idle = (id: string): boolean => {
    const last = world
      .ledger(id)
      .filter((event) => event.type === 'status')
      .at(-1) as { state?: string } | undefined
    return last?.state === 'idle'
  }

  /** The person answers the card its turn parked on, and the turn ends. */
  const endTheTurn = async (id: string, nth: number): Promise<void> => {
    await waitFor(() => cards(id).length >= nth, `${id}'s card ${String(nth)}`)
    await host.respondPermission(id, cards(id)[nth - 1]!.id, { outcome: 'allow' }, world.window)
    await waitFor(() => idle(id), `${id} idle`)
  }

  /** What the provider was handed, turn by turn: the fake echoes each send. */
  const handed = (id: string): string[] =>
    world
      .ledger(id)
      .flatMap((event) =>
        event.type === 'assistant_message' && event.text.startsWith('echo: ')
          ? [event.text.slice('echo: '.length)]
          : [],
      )

  const heldNotices = (id: string, notice: string): string[] =>
    world
      .ledger(id)
      .flatMap((event) =>
        event.type === 'message_queued' && event.appNotice === notice ? [event.text] : [],
      )

  /** Whether the holder's task still carries its wait on purpose. */
  const waitsOnPurpose = (holder: string, piece: string): boolean =>
    world.store.piecesOwnedBy(holder).find((one) => one.piece === piece)?.statusLine?.waiting ===
    true

  const waitsOn = async (holder: string, label: string, on: Record<string, string>) => {
    const set = await call(holder, 'update_work', { piece: label, status: 'Waiting.', on })
    expect(set.outcome, set.said).toBe('ok')
  }

  /** A conversation of `profile` given a task by `giver`, waiting on a time, idle. */
  const aTaskFor = async (
    giver: string,
    profile: string,
    title: string,
    under?: string,
    provider?: 'claude' | 'codex',
  ) => {
    if (!profiles.has(profile)) {
      profiles.add(profile)
      await host.close(await open(profile), world.window)
    }
    const given = await call(giver, 'give_work', {
      profile,
      to: 'new',
      conversation_title: title,
      title,
      brief: `Do ${title}.`,
      definition_of_done: 'A checked result.',
      ...(under === undefined ? {} : { under }),
      ...(provider === undefined ? {} : { provider }),
    })
    expect(given.outcome, given.said).toBe('ok')
    const holder = given.agent as string
    const label = given.label as string
    host.claimSession(holder, world.window)
    const handle = world.end.newest().handle
    await waitFor(() => cards(holder).length === 1, `${title} parked`)
    await waitsOn(holder, label, { time: later() })
    await endTheTurn(holder, 1)
    return { holder, piece: given.piece as string, label, handle }
  }

  it('a third party closes a task with no reason: the idle holder gets no turn, and its next input carries the notice once', async () => {
    const pm = await open('pm')
    const { holder, label } = await aTaskFor(pm, 'worker', 'the index')
    const observer = await open('observer')

    const closed = await call(observer, 'update_work', { piece: label, close: true })
    expect(closed.outcome, closed.said).toBe('ok')
    expect(closed.delivery).toBe('held')
    expect(closed.said).toContain('will be told with its next input.')
    await settle()

    expect(handed(holder), JSON.stringify(handed(holder))).toHaveLength(1)
    const [notice] = heldNotices(holder, 'a-piece-closed')
    expect(notice).toContain(`closed your task ${label}`)
    expect(notice).toContain('Reason: no reason given. It keeps its outcome; stop work on it.')

    await call(pm, 'message_agent', { agent: label, text: 'One more thing.' })
    await waitFor(() => handed(holder).length === 2, 'the next input')
    expect(handed(holder)[1]).toContain(notice!)
    await endTheTurn(holder, 2)

    await call(pm, 'message_agent', { agent: label, text: 'And another.' })
    await waitFor(() => handed(holder).length === 3, 'a third input')
    expect(handed(holder)[2]).not.toContain(notice!)
  })

  it('a withdrawal with a reason tells holder and giver by held notices, and starts neither', async () => {
    const boss = await open('boss')
    const pmTask = await aTaskFor(boss, 'pm', 'the plan')
    const { holder, label } = await aTaskFor(pmTask.holder, 'worker', 'the index', pmTask.label)
    const observer = await open('observer')
    const pmTurns = handed(pmTask.holder).length

    const taken = await call(observer, 'withdraw_task', {
      piece: label,
      reason: 'The plan changed.',
    })
    expect(taken.outcome, taken.said).toBe('ok')
    expect(taken.delivery).toBe('held')
    await settle()

    expect(handed(holder), JSON.stringify(handed(holder))).toHaveLength(1)
    expect(heldNotices(holder, 'a-piece-taken-back')[0]).toContain('Reason: The plan changed.')
    expect(heldNotices(holder, 'a-piece-taken-back')[0]).not.toContain('changed..')
    expect(handed(pmTask.holder), JSON.stringify(handed(pmTask.holder))).toHaveLength(pmTurns)
    expect(heldNotices(pmTask.holder, 'a-piece-it-gave-taken-back')[0]).toContain(
      'Reason: The plan changed.',
    )
  })

  describe('a giver of the ended task', () => {
    const chain = async () => {
      const boss = await open('boss')
      const pmTask = await aTaskFor(boss, 'pm', 'the plan')
      const target = await aTaskFor(pmTask.holder, 'worker', 'the index', pmTask.label)
      return { pmTask, target }
    }

    it('waiting on exactly that task is started once, and the notice rides that turn', async () => {
      const { pmTask, target } = await chain()
      await waitsOn(pmTask.holder, pmTask.label, { agent: target.label })
      const before = handed(pmTask.holder).length
      const observer = await open('observer')

      await call(observer, 'update_work', { piece: target.label, close: true })
      await waitFor(() => handed(pmTask.holder).length === before + 1, 'the wait to start it')
      const turn = handed(pmTask.holder)[before]!
      expect(turn, turn).toContain(`closed ${target.label}`)
      expect(turn).toContain('Reason: no reason given.')
      await settle()
      expect(handed(pmTask.holder)).toHaveLength(before + 1)
    })

    it('a wait reminder carries the work ending while cancellation waits for ordinary input', async () => {
      const { pmTask, target } = await chain()
      const { holder, label } = pmTask
      await waitsOn(holder, label, { agent: target.label })
      await host.send(target.holder, 'Keep this turn open.', world.window)
      await waitFor(() => cards(target.holder).length === 2, 'the target parked again')
      const held = await host.queueMessage(target.holder, 'Include the index.', {
        ownerId: agentCallerId(holder),
      })
      if (held.outcome !== 'queued') throw new Error('the target did not hold the message')
      await host.cancelQueuedMessage(target.holder, held.messageId, world.window)
      const [cancelled] = heldNotices(holder, 'a-queued-message-was-cancelled')
      expect(cancelled).toContain('cancelled your queued message')

      const observer = await open('observer')
      const before = handed(holder).length
      await call(observer, 'update_work', { piece: target.label, close: true })
      await waitFor(() => handed(holder).length === before + 1, 'the wait reminder')
      expect(handed(holder)[before]).toContain(`closed ${target.label}`)
      expect(handed(holder)[before]).not.toContain(cancelled!)
      await endTheTurn(holder, before + 1)

      await host.send(holder, 'Ordinary input.', world.window)
      await waitFor(() => handed(holder).length === before + 2, 'the next ordinary input')
      expect(handed(holder)[before + 1]).toContain(cancelled!)
      expect(handed(holder)[before + 1]).not.toContain(`closed ${target.label}`)
    })

    it.each(['another task', 'a time'])('waiting on %s is not started', async (waitsFor) => {
      const { pmTask, target } = await chain()
      if (waitsFor === 'another task') {
        const other = await aTaskFor(pmTask.holder, 'helper', 'the other', pmTask.label)
        await waitsOn(pmTask.holder, pmTask.label, { agent: other.label })
      }
      const before = handed(pmTask.holder).length
      const observer = await open('observer')

      await call(observer, 'update_work', { piece: target.label, close: true })
      await settle()
      await settle()
      expect(handed(pmTask.holder), JSON.stringify(handed(pmTask.holder))).toHaveLength(before)
      expect(heldNotices(pmTask.holder, 'a-piece-it-gave-closed')).toHaveLength(1)
    })
  })

  it('a holder stopped by a restart is not started by a close; its next start carries the notice', async () => {
    const pm = await open('pm')
    const { holder, label } = await aTaskFor(pm, 'worker', 'the index')
    await host.closeAll()
    host = world.buildHost(false, { startGapMs: 0 })
    const launches = world.launchesOf(holder).length
    const observer = await open('observer')

    const closed = await call(observer, 'update_work', { piece: label, close: true })
    expect(closed.outcome, closed.said).toBe('ok')
    await settle()
    expect(world.launchesOf(holder)).toHaveLength(launches)
    const [notice] = heldNotices(holder, 'a-piece-closed')
    expect(notice).toContain(`closed your task ${label}`)

    await call(pm, 'message_agent', { agent: label, text: 'Are you there?' })
    await waitFor(() => handed(holder).length === 2, 'its next input')
    expect(handed(holder)[1]).toContain(notice!)
  })

  it('a new brief is kept at once and held: an idle holder gets no turn, and its next input carries it once', async () => {
    const pm = await open('pm')
    const { holder, piece, label } = await aTaskFor(pm, 'worker', 'the index')

    const briefed = await call(pm, 'update_work', { piece: label, brief: 'Use the second table.' })
    expect(briefed.outcome, briefed.said).toBe('ok')
    expect(briefed.delivery).toBe('held')
    expect(briefed.said).toContain('will get the new brief with its next input.')
    expect(world.store.piecesOwnedBy(holder).find((one) => one.piece === piece)?.brief).toBe(
      'Use the second table.',
    )
    await settle()
    expect(handed(holder), JSON.stringify(handed(holder))).toHaveLength(1)
    // Its wait on purpose stands while the brief is held: no incident, no reminder.
    expect(waitsOnPurpose(holder, piece)).toBe(true)
    expect(host.workIncidentsForAPerson().rows.some((one) => one.piece === piece)).toBe(false)

    await call(pm, 'message_agent', { agent: label, text: 'One more thing.' })
    await waitFor(() => handed(holder).length === 2, 'the next input')
    expect(handed(holder)[1]).toContain('Use the second table.')
    expect(handed(holder)[1]).toContain('One more thing.')
    // Delivered: the wait ends with it. The holder says where it stands again before its turn ends.
    expect(waitsOnPurpose(holder, piece)).toBe(false)
    await waitsOn(holder, label, { time: later() })
    await endTheTurn(holder, 2)
    await call(pm, 'message_agent', { agent: label, text: 'And another.' })
    await waitFor(() => handed(holder).length === 3, 'a third input')
    expect(handed(holder)[2]).not.toContain('Use the second table.')
  })

  it('a rejected input leaves a held brief held and its wait standing; the next accepted input carries it once and ends the wait once', async () => {
    const pm = await open('pm')
    const { holder, piece, label, handle } = await aTaskFor(pm, 'worker', 'the index')
    await call(pm, 'update_work', { piece: label, brief: 'Use the second table.' })
    const brief = world
      .ledger(holder)
      .find((event) => event.type === 'message_queued' && event.rebrief === true)
    if (brief?.type !== 'message_queued') throw new Error('the new brief was not held')
    const sentOnce = (): number =>
      world
        .ledger(holder)
        .filter(
          (event) =>
            event.type === 'message_unqueued' &&
            event.messageId === brief.messageId &&
            event.reason === 'sent',
        ).length

    // The provider refuses the next handover: nothing is marked sent and the wait stands.
    const send = handle.send.bind(handle)
    let refused = 0
    Object.defineProperty(handle, 'send', {
      value: async (...args: Parameters<typeof send>): Promise<void> => {
        if (refused === 0) {
          refused++
          throw new Error('fictional refusal of the handover')
        }
        return send(...args)
      },
      configurable: true,
    })
    await call(pm, 'message_agent', { agent: label, text: 'First try.' })
    await waitFor(() => refused === 1, 'the refused handover')
    await settle()
    expect(sentOnce()).toBe(0)
    expect(waitsOnPurpose(holder, piece)).toBe(true)
    expect(handed(holder), JSON.stringify(handed(holder))).toHaveLength(1)

    // The next accepted input carries it once, and the wait ends once.
    await call(pm, 'message_agent', { agent: label, text: 'Second try.' })
    await waitFor(() => handed(holder).length === 2, 'the accepted input')
    expect(handed(holder)[1]).toContain('Use the second table.')
    expect(handed(holder)[1]?.split('Use the second table.')).toHaveLength(2)
    expect(sentOnce()).toBe(1)
    expect(waitsOnPurpose(holder, piece)).toBe(false)
  })

  it('a new brief for a holder stopped by a restart does not start it; its next start carries it', async () => {
    const pm = await open('pm')
    const { holder, piece, label } = await aTaskFor(pm, 'worker', 'the index')
    await host.closeAll()
    host = world.buildHost(false, { startGapMs: 0 })
    const launches = world.launchesOf(holder).length

    const briefed = await call(pm, 'update_work', { piece: label, brief: 'Use the second table.' })
    expect(briefed.delivery).toBe('held')
    await settle()
    expect(world.launchesOf(holder)).toHaveLength(launches)
    expect(waitsOnPurpose(holder, piece)).toBe(true)

    // Read again after another restart, the held brief still keeps the wait.
    await host.closeAll()
    host = world.buildHost(false, { startGapMs: 0 })
    expect(waitsOnPurpose(holder, piece)).toBe(true)

    await call(pm, 'message_agent', { agent: label, text: 'Are you there?' })
    await waitFor(() => handed(holder).length === 2, 'its next input')
    expect(handed(holder)[1]).toContain('Use the second table.')
    expect(waitsOnPurpose(holder, piece)).toBe(false)
  })

  it('a live holder holding only a new brief is not started again when it stops', async () => {
    const pm = await open('pm')
    const { holder, label } = await aTaskFor(pm, 'worker', 'the index')
    const briefed = await call(pm, 'update_work', { piece: label, brief: 'Use the second table.' })
    expect(briefed.delivery).toBe('held')
    const launches = world.launchesOf(holder).length

    await host.close(holder, world.window)
    await new Promise((resolve) => setTimeout(resolve, 1000))
    expect(world.launchesOf(holder)).toHaveLength(launches)

    await call(pm, 'message_agent', { agent: label, text: 'One more thing.' })
    await waitFor(() => handed(holder).length === 2, 'its next input')
    expect(handed(holder)[1]).toContain('Use the second table.')
  })

  it('a holder rebriefing work it took on for a person ends its own wait at once', async () => {
    const holder = await open('worker')
    await host.send(holder, 'Please take on these notes.', world.window)
    await waitFor(() => cards(holder).length === 1, 'its turn parked')
    const taken = await call(holder, 'take_on_work', {
      title: 'Write the notes',
      brief: 'Write the notes here.',
      definition_of_done: 'The notes are written.',
    })
    expect(taken.outcome, taken.said).toBe('ok')
    const piece = taken.piece as string
    const label = taken.label as string
    await waitsOn(holder, label, { time: later() })
    expect(waitsOnPurpose(holder, piece)).toBe(true)

    const briefed = await call(holder, 'update_work', {
      piece: label,
      brief: 'Write them shorter.',
    })
    expect(briefed.outcome, briefed.said).toBe('ok')
    expect(waitsOnPurpose(holder, piece)).toBe(false)
  })

  it('an archived holder brought back is not started for a close notice it holds', async () => {
    const pm = await open('pm')
    const { holder, label } = await aTaskFor(pm, 'worker', 'the index')
    expect((await host.archiveConversation(holder)).done).toBe(true)
    const observer = await open('observer')
    const closed = await call(observer, 'update_work', { piece: label, close: true })
    expect(closed.outcome, closed.said).toBe('ok')
    const launches = world.launchesOf(holder).length

    expect(host.restoreConversation(holder).done).toBe(true)
    await new Promise((resolve) => setTimeout(resolve, 1000))
    expect(world.launchesOf(holder)).toHaveLength(launches)
    expect(heldNotices(holder, 'a-piece-closed')).toHaveLength(1)
  })

  describe('a new brief written before briefs were held', () => {
    const appended = (holder: string, row: Record<string, unknown>): void => {
      world.store.append(holder, world.store.nextOrdinal(holder), row as never, Date.now())
    }

    it('told at once, still ends the wait at its row', async () => {
      const pm = await open('pm')
      const { holder, piece } = await aTaskFor(pm, 'worker', 'the index')
      expect(waitsOnPurpose(holder, piece)).toBe(true)
      appended(holder, { type: 'work_rebriefed', piece, brief: 'Use the second table.', by: pm })
      expect(waitsOnPurpose(holder, piece)).toBe(false)
    })

    it('held behind a turn, does not end a wait set before it was sent', async () => {
      const pm = await open('pm')
      const { holder, piece, label } = await aTaskFor(pm, 'worker', 'the index')
      appended(holder, { type: 'work_rebriefed', piece, brief: 'Use the second table.', by: pm })
      appended(holder, {
        type: 'message_queued',
        messageId: 'msg_an_older_brief',
        kind: 'work',
        text: 'Use the second table.',
        piece,
        label,
        rebrief: true,
      })
      appended(holder, {
        type: 'work_status_set',
        piece,
        line: 'Waiting.',
        by: holder,
        waiting: true,
      })
      expect(waitsOnPurpose(holder, piece)).toBe(true)
      appended(holder, {
        type: 'message_unqueued',
        messageId: 'msg_an_older_brief',
        reason: 'sent',
        text: 'Use the second table.',
      })
      expect(waitsOnPurpose(holder, piece)).toBe(true)
    })
  })

  /**
   * Card 584 · when the handback or answer a holder waits on reaches that holder, it is the one
   * wake-up: no "what it waited on has ended" notice goes with it. The notice stays for a result
   * that reaches someone else or no one, and for a holder that does not settle its wait after it.
   */
  describe('the result a holder waits on wakes it once', () => {
    const ended = 'what it waited on has ended'
    const notices = (id: string): number => handed(id).filter((one) => one.includes(ended)).length

    /** A PM on `provider` holding the plan, waiting on the index it gave a worker, both idle. */
    const aPmWaitingOnItsWorker = async (provider?: 'claude' | 'codex') => {
      const boss = await open('boss')
      const pmTask = await aTaskFor(boss, 'pm', 'the plan', undefined, provider)
      const target = await aTaskFor(pmTask.holder, 'worker', 'the index', pmTask.label)
      await waitsOn(pmTask.holder, pmTask.label, { agent: target.label })
      return { boss, pm: pmTask.holder, plan: pmTask.label, target }
    }

    /** The holder settles its wait, as an agent does: it now waits on a time, not on the result. */
    const settleOnATime = async (pm: string, plan: string): Promise<void> => {
      const status = 'Settled on the result; checking again later.'
      const set = await call(pm, 'update_work', { piece: plan, status, on: { time: later() } })
      expect(set.outcome, set.said).toBe('ok')
      const line = world.store.piecesOwnedBy(pm).find((one) => one.label === plan)?.statusLine
      expect(line).toMatchObject({ text: status, waiting: true, on: { kind: 'time' } })
    }

    /**
     * A PM on `provider` holding the plan, waiting on a question it asked a helper the boss gave work
     * to. ⚑ No child of its own: an open one is a wait of its own, and no reminder is owed.
     */
    const aPmWaitingOnItsQuestion = async (provider?: 'claude' | 'codex') => {
      const boss = await open('boss')
      const pmTask = await aTaskFor(boss, 'pm', 'the plan', undefined, provider)
      const { holder: pm, label: plan } = pmTask
      const other = await aTaskFor(boss, 'helper', 'the other')
      const asked = await call(pm, 'ask_question', {
        who_answers: 'an-agent',
        agent: other.label,
        piece: plan,
        question: 'Which table holds the index?',
      })
      expect(asked.outcome, asked.said).toBe('ok')
      const question = asked.question as string
      await waitsOn(pm, plan, { agent: question })
      const answer = () =>
        call(other.holder, 'answer_question', {
          question,
          answers: [{ part: 'answer', answer: ['The second table.'] }],
          interrupt: false,
        })
      return { pm, plan, answer }
    }

    const handBack = async (holder: string, label: string): Promise<void> => {
      const replied = await call(holder, 'reply_to_parent', {
        piece: label,
        outcome: 'done',
        summary: 'The index is built.',
      })
      expect(replied.outcome, replied.said).toBe('ok')
    }

    it.each(['claude', 'codex'] as const)(
      'a child handback to an idle %s holder is the one wake-up',
      async (provider) => {
        const { pm, plan, target } = await aPmWaitingOnItsWorker(provider)
        const before = handed(pm).length
        const card = cards(pm).length + 1
        await handBack(target.holder, target.label)
        await waitFor(() => handed(pm).length === before + 1, 'the holder woken')
        await settle()
        expect(notices(pm)).toBe(0)
        expect(handed(pm)[before], handed(pm)[before]).toContain('The index is built.')
        await settleOnATime(pm, plan)
        await endTheTurn(pm, card)
        await settle()
        expect(handed(pm)).toHaveLength(before + 1)
        expect(notices(pm)).toBe(0)
      },
    )

    it.each(['claude', 'codex'] as const)(
      'an answer to a question an idle %s holder waits on is the one wake-up',
      async (provider) => {
        const { pm, plan, answer } = await aPmWaitingOnItsQuestion(provider)
        const before = handed(pm).length
        const card = cards(pm).length + 1
        const answered = await answer()
        expect(answered.outcome, answered.said).toBe('ok')
        await waitFor(() => handed(pm).length === before + 1, 'the holder woken')
        await settle()
        expect(notices(pm)).toBe(0)
        expect(handed(pm)[before], handed(pm)[before]).toContain('The second table.')
        await settleOnATime(pm, plan)
        await endTheTurn(pm, card)
        await settle()
        expect(handed(pm)).toHaveLength(before + 1)
        expect(notices(pm)).toBe(0)
      },
    )

    it('a holder that does not settle its wait after the result is reminded once, after it, and its giver after that', async () => {
      const { boss, pm, plan, target } = await aPmWaitingOnItsWorker()
      const before = handed(pm).length
      const card = cards(pm).length + 1
      await handBack(target.holder, target.label)
      await waitFor(() => handed(pm).length === before + 1, 'the holder woken')
      expect(handed(pm)[before]).toContain('The index is built.')
      await host.respondPermission(pm, cards(pm)[card - 1]!.id, { outcome: 'allow' }, world.window)
      await waitFor(() => handed(pm).length === before + 2, 'the reminder after the result')
      expect(handed(pm)[before + 1]).toContain(`${plan} needs attention: ${ended}`)
      expect(notices(pm)).toBe(1)
      const bossTurns = handed(boss).length
      await waitFor(() => cards(pm).length === card + 1, 'the reminded turn parked')
      await host.respondPermission(pm, cards(pm)[card]!.id, { outcome: 'allow' }, world.window)
      await waitFor(() => handed(boss).length > bossTurns, 'the giver told')
      expect(handed(boss).at(-1)).toContain(`${plan} still needs attention`)
      expect(notices(pm)).toBe(1)
    })

    it('a holder busy with a turn gets the handback when that turn ends, and no notice', async () => {
      const { pm, plan, target } = await aPmWaitingOnItsWorker()
      await host.send(pm, 'Keep this turn open.', world.window)
      await waitFor(() => cards(pm).length === 2, 'the holder busy')
      const before = handed(pm).length
      await handBack(target.holder, target.label)
      await settle()
      expect(handed(pm)).toHaveLength(before)
      await host.respondPermission(pm, cards(pm)[1]!.id, { outcome: 'allow' }, world.window)
      await waitFor(() => handed(pm).length === before + 1, 'the held handback')
      expect(handed(pm)[before]).toContain('The index is built.')
      await settleOnATime(pm, plan)
      await endTheTurn(pm, 3)
      await settle()
      expect(notices(pm)).toBe(0)
    })

    it('a handback that goes to another conversation leaves the waiting holder its notice', async () => {
      // ⚑ A PM with no open child of its own: an open one is a wait of its own, and no notice comes.
      const boss = await open('boss')
      const { holder: pm, label: plan } = await aTaskFor(boss, 'pm', 'the plan')
      const other = await aTaskFor(boss, 'helper', 'the other')
      await waitsOn(pm, plan, { agent: other.label })
      await handBack(other.holder, other.label)
      await waitFor(() => notices(pm) === 1, 'the waiting holder told')
      expect(handed(pm).some((one) => one.includes('The index is built.'))).toBe(false)
      expect(handed(boss).some((one) => one.includes('The index is built.'))).toBe(true)
    })

    /** `pm` stopped, and its next start fails once. */
    const stoppedAndItsNextStartFails = async (pm: string) => {
      await host.close(pm, world.window)
      const ref = world.store.find(pm)?.ref
      if (ref === undefined) throw new Error('the holder has no provider ref')
      return vi
        .spyOn(FakeRuntime.prototype, 'resume')
        .mockRejectedValueOnce(new ResumeError(ref, 'resume failed: the handshake died'))
    }

    it('a handback only kept because its holder could not be started leaves it the notice that wakes it', async () => {
      const { pm, target } = await aPmWaitingOnItsWorker()
      const resume = await stoppedAndItsNextStartFails(pm)
      try {
        const replied = await call(target.holder, 'reply_to_parent', {
          piece: target.label,
          outcome: 'done',
          summary: 'The index is built.',
        })
        expect(replied.outcome, replied.said).toBe('ok')
        expect(replied.delivered).toBe('kept')
        await waitFor(() => notices(pm) === 1, 'the reminder that starts the holder')
        await waitFor(
          () => handed(pm).some((one) => one.includes('The index is built.')),
          'the kept handback delivered at that start',
        )
        expect(notices(pm)).toBe(1)
      } finally {
        resume.mockRestore()
      }
    })

    it('a handback kept for a start, read by the next launch, still wakes its holder', async () => {
      const { pm, target } = await aPmWaitingOnItsWorker()
      const resume = await stoppedAndItsNextStartFails(pm)
      // ⚑ This launch quits before any reminder pass reads the kept handback.
      Object.defineProperty(host, 'reconcileWork', { value: () => undefined, configurable: true })
      try {
        const replied = await call(target.holder, 'reply_to_parent', {
          piece: target.label,
          outcome: 'done',
          summary: 'The index is built.',
        })
        expect(replied.delivered).toBe('kept')
      } finally {
        resume.mockRestore()
      }
      await host.closeAll()
      host = world.buildHost(false, { startGapMs: 0 })
      await waitFor(() => notices(pm) === 1, 'the next launch to wake the holder')
      await waitFor(
        () => handed(pm).some((one) => one.includes('The index is built.')),
        'the kept handback delivered at that start',
      )
    })

    it('an answer only kept because its asker could not be started leaves it the notice that wakes it', async () => {
      const { pm, answer } = await aPmWaitingOnItsQuestion()
      const resume = await stoppedAndItsNextStartFails(pm)
      try {
        const answered = await answer()
        expect(answered.outcome, answered.said).toBe('ok')
        expect(answered.kept, answered.said).toBeDefined()
        await waitFor(() => notices(pm) === 1, 'the reminder that starts the asker')
        await waitFor(
          () => handed(pm).some((one) => one.includes('The second table.')),
          'the kept answer delivered at that start',
        )
        expect(notices(pm)).toBe(1)
      } finally {
        resume.mockRestore()
      }
    })

    it.each([
      {
        what: 'a background task',
        id: 'fake_task',
        starts: (handle: FakeSessionHandle) => handle.simulateBackgroundWork(),
        ends: (handle: FakeSessionHandle) => handle.simulateBackgroundWork({ running: [] }),
      },
      {
        what: 'a scheduled job',
        id: 'fake_cron',
        starts: (handle: FakeSessionHandle) => handle.simulateScheduledWork(),
        ends: (handle: FakeSessionHandle) => handle.simulateScheduledWork({ jobs: [] }),
      },
    ])('$what a holder waits on that ends without a word leaves it the notice', async (event) => {
      const boss = await open('boss')
      const { holder: pm, label: plan, handle } = await aTaskFor(boss, 'pm', 'the plan')
      event.starts(handle)
      await settle()
      await waitsOn(pm, plan, { event: event.id })
      event.ends(handle)
      await settle()
      ;(host as unknown as { reconcileWork(holders: Set<string>): void }).reconcileWork(
        new Set([pm]),
      )
      const gone = `${plan} needs attention: what it waited on is no longer available`
      await waitFor(() => handed(pm).some((one) => one.includes(gone)), 'the holder told')
    })
  })

  it('stop and compact accept a call without a reason', async () => {
    const pm = await open('pm')
    const { label } = await aTaskFor(pm, 'worker', 'the index')
    const stopped = await call(pm, 'interrupt_agent', { agent: label })
    expect(stopped.outcome, stopped.said).not.toBe('refused')
    const compacted = await call(pm, 'compact_agent', { agent: label })
    expect(compacted.rail).not.toBe('malformed-request')
  })

  /**
   * Card 591 · a coordinator that has given work to many conversations over its life still gets an
   * exact count of what is open in its footer. The footer reads at most 32 helper ledgers; a piece
   * that has already ended must not use that budget up, or "and at least N more" replaces the count.
   */
  describe('the footer counts the open work a coordinator gave', () => {
    const turnsEnded = (id: string): number =>
      world.ledger(id).filter((event) => event.type === 'turn').length

    /** A new conversation of `worker` given `title`, its first turn over. */
    const give = async (pm: string, title: string) => {
      const given = await call(pm, 'give_work', {
        profile: 'worker',
        to: 'new',
        conversation_title: title,
        title,
        brief: `Do ${title}.`,
        definition_of_done: 'A checked result.',
      })
      expect(given.outcome, given.said).toBe('ok')
      const holder = given.agent as string
      await waitFor(() => turnsEnded(holder) >= 1, `${title}'s first turn`)
      return { holder, label: given.label as string }
    }

    const footerFacts = (pm: string) =>
      (
        host as unknown as {
          factsForTheTurnBlock(
            session: { id: string },
            piece: null,
          ): { helpers: readonly { label: string }[]; helpersIncomplete: boolean }
        }
      ).factsForTheTurnBlock({ id: pm }, null)

    it('ended work given to 34 conversations leaves the one open piece counted exactly', async () => {
      await host.close(await world.open(host, 'claude', 'worker'), world.window)
      const pm = await world.open(host, 'claude', 'pm')
      for (let at = 0; at < 34; at += 1) {
        const { holder, label } = await give(pm, `piece ${String(at)}`)
        const replied = await call(holder, 'reply_to_parent', {
          piece: label,
          outcome: 'done',
          summary: 'Done.',
        })
        expect(replied.outcome, replied.said).toBe('ok')
      }
      const open = await give(pm, 'the open piece')

      const facts = footerFacts(pm)
      expect(facts.helpersIncomplete).toBe(false)
      expect(facts.helpers.map((row) => row.label)).toEqual([open.label])
    }, 60_000)

    /** A PM, and a way to record a give from it to a new owner, and to cancel that give's brief. */
    const aPmThatRecordsGives = async () => {
      const pm = await world.open(host, 'claude', 'pm')
      const store = world.store
      const parent = store.rootOf(pm)!
      let at = Date.now()
      const seed = (owner: string, messageId?: string, exists = false) => {
        if (!exists)
          store.create({
            id: owner,
            provider: 'claude',
            cwd: world.project,
            approvalMode: 'ask',
            profileId: 'worker',
            parentSessionId: pm,
          })
        const piece = `fiction-piece-${owner}`
        const number = store.numberUnder(parent.piece)
        const label = `${parent.label}.${String(number)}`
        at += 1
        store.recordGive(
          {
            piece,
            parent: parent.piece,
            number,
            owner,
            givenBy: pm,
            title: 'T',
            brief: 'B',
            folder: null,
            inputs: [],
          },
          store.nextOrdinal(owner),
          {
            type: 'work_given',
            piece,
            parent: parent.piece,
            label,
            givenBy: pm,
            title: 'T',
            brief: 'B',
            ...(messageId === undefined ? {} : { messageId }),
          },
          at,
        )
        return { piece, label }
      }
      const cancel = (owner: string, messageId: string) =>
        store.append(
          owner,
          store.nextOrdinal(owner),
          { type: 'message_unqueued', messageId, reason: 'cancelled', text: 'B' },
          (at += 1),
        )
      return { pm, store, seed, cancel }
    }

    it('a cancelled brief behind 32 open pieces is skipped, and no more than 32 ledgers open', async () => {
      const { pm, store, seed, cancel } = await aPmThatRecordsGives()
      // The oldest give's held brief was cancelled; 32 newer gives are open, one owner each.
      seed('fiction-cancelled', 'msg_fiction_cancelled')
      cancel('fiction-cancelled', 'msg_fiction_cancelled')
      expect(store.piecesOwnedBy('fiction-cancelled')[0]?.state).toBe('withdrawn')
      const open = Array.from({ length: 32 }, (_, i) => seed(`fiction-open-${String(i)}`))
      const piecesBefore = store.turnBlockPiecesOwnedBy
      const opened = new Set<string>()
      store.turnBlockPiecesOwnedBy = (owner, unread) => {
        opened.add(owner)
        return piecesBefore(owner, unread)
      }
      try {
        const facts = footerFacts(pm)
        expect(facts.helpersIncomplete).toBe(false)
        expect(facts.helpers.map((row) => row.label).sort()).toEqual(
          open.map((row) => row.label).sort(),
        )
        expect(opened.has('fiction-cancelled')).toBe(false)
        expect(opened.size).toBeLessThanOrEqual(33)
      } finally {
        store.turnBlockPiecesOwnedBy = piecesBefore
      }
    })

    it('a give the fold cannot read is not taken as ended, however its brief ended', async () => {
      const { pm, seed, cancel } = await aPmThatRecordsGives()
      const unread = seed('fiction-unread-give', 'msg_fiction_unread')
      cancel('fiction-unread-give', 'msg_fiction_unread')
      // ⚑ Valid JSON the codec refuses: a present, empty done condition.
      world.db
        .prepare(
          `UPDATE events SET payload = json_set(payload, '$.definitionOfDone', ' ')
            WHERE session_id = ? AND type = 'work_given'`,
        )
        .run('fiction-unread-give')
      const facts = footerFacts(pm)
      expect(facts.helpersIncomplete).toBe(true)
      expect(facts.helpers.map((row) => row.label)).not.toContain(unread.label)
    })

    // Núria's decision (card 591): "at least" means an open or unknown piece could not be read. An
    // unreadable row elsewhere in a ledger whose piece from this giver verifiably ended does not.
    it('a torn row beside a piece that verifiably ended leaves the count exact', async () => {
      const { pm, store, seed } = await aPmThatRecordsGives()
      const ended = seed('fiction-ended-torn')
      store.append(
        'fiction-ended-torn',
        store.nextOrdinal('fiction-ended-torn'),
        { type: 'work_replied', piece: ended.piece, outcome: 'done', summary: 'S', resources: [] },
        Date.now() + 1_000,
      )
      world.db
        .prepare(
          `INSERT INTO events(id, session_id, generation, ordinal, type, payload, created_at)
            VALUES (?, ?, 0, ?, ?, ?, ?)`,
        )
        .run(
          'fiction-torn-status',
          'fiction-ended-torn',
          store.nextOrdinal('fiction-ended-torn'),
          'status',
          '{',
          Date.now() + 2_000,
        )
      const facts = footerFacts(pm)
      expect(facts.helpersIncomplete).toBe(false)
      expect(facts.helpers).toEqual([])
    })

    it('a reply recorded before its give is no ending: the piece the fold leaves open is listed', async () => {
      const { pm, store, seed } = await aPmThatRecordsGives()
      const owner = 'fiction-early-reply'
      store.create({
        id: owner,
        provider: 'claude',
        cwd: world.project,
        approvalMode: 'ask',
        profileId: 'worker',
        parentSessionId: pm,
      })
      const piece = `fiction-piece-${owner}`
      store.append(
        owner,
        store.nextOrdinal(owner),
        { type: 'work_replied', piece, outcome: 'done', summary: 'S', resources: [] },
        Date.now(),
      )
      const open = seed(owner, undefined, true)
      expect(open.piece).toBe(piece)
      expect(store.piecesOwnedBy(owner).find((one) => one.piece === piece)?.state).not.toBe(
        'answered',
      )
      expect(footerFacts(pm).helpers.map((row) => row.label)).toEqual([open.label])
    })
  })
})
