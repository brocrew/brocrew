import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { agentToolsFor, type ToolName } from '../src/main/runtime/agent-tools'
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
  const aTaskFor = async (giver: string, profile: string, title: string, under?: string) => {
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

  it('stop and compact accept a call without a reason', async () => {
    const pm = await open('pm')
    const { label } = await aTaskFor(pm, 'worker', 'the index')
    const stopped = await call(pm, 'interrupt_agent', { agent: label })
    expect(stopped.outcome, stopped.said).not.toBe('refused')
    const compacted = await call(pm, 'compact_agent', { agent: label })
    expect(compacted.rail).not.toBe('malformed-request')
  })
})
