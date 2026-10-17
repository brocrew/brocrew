import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { profileExecutionFile, writeProfileExecution } from '../src/main/profile-execution-file'
import { agentToolsFor, type ToolName } from '../src/main/runtime/agent-tools'
import { createSessionStore, type SessionStore } from '../src/main/db/session-store'
import {
  THE_APP_ITSELF,
  type GiveOutcome,
  type RuntimeHost,
} from '../src/main/runtime/runtime-host'
import type { TranscriptEvent } from '../src/shared/runtime-ipc'
import { clockTime } from '../src/shared/clock'
import type { PieceRow } from '../src/shared/tasks'
import { aServiceWorld, type AServiceWorld } from './helpers/a-service-world'

/**
 * A service takes one piece at a time: its oldest queued piece is handed over alone, and the next
 * only once that one has ended and the service runs nothing. A turn going quiet, a question, an
 * approval or a stall keeps the piece it is on. Reached through the host alone: services are
 * switched off in the app.
 */

describe('a service takes one piece at a time', () => {
  let world: AServiceWorld
  beforeEach(() => {
    world = aServiceWorld()
  })
  afterEach(async () => {
    await world.cleanUp()
  })

  const accepted = (outcome: GiveOutcome): Extract<GiveOutcome, { ok: true }> => {
    if (!outcome.ok) throw new Error(`refused (${outcome.refusal.rail}): ${outcome.refusal.reason}`)
    return outcome
  }
  /** A service and a caller a person opened; with `auto`, the service runs without asking. */
  const aServiceAndACaller = async (
    opts: { auto?: boolean } = {},
  ): Promise<{ host: RuntimeHost; caller: string }> => {
    world.anAgent('browser-driver')
    world.anAgent('caller', 'nothing kept')
    if (opts.auto === true) world.store.setDefaultApprovalMode('auto')
    const host = world.aHost()
    return { host, caller: await world.aPersonOpens(host, 'caller') }
  }
  const piecesOf = (service: string): readonly PieceRow[] => world.store.piecesOwnedBy(service)
  const stateOf = (service: string, piece: string): string | undefined =>
    piecesOf(service).find((one) => one.piece === piece)?.state
  /** Until `piece` at `service` has been handed over: open, and no longer waiting. */
  const handedOver = async (service: string, piece: string): Promise<void> => {
    await vi.waitFor(() => {
      expect(stateOf(service, piece)).not.toBe('waiting')
    })
  }
  const call = async (
    host: RuntimeHost,
    conversation: string,
    name: ToolName,
    args: Record<string, unknown>,
  ): Promise<{ structured: Record<string, unknown>; text: string }> => {
    const tool = agentToolsFor(host, conversation).tools.find((one) => one.name === name)
    if (tool === undefined) throw new Error(`no such tool: ${name}`)
    const result = await tool.call(args)
    return { structured: result.structured as Record<string, unknown>, text: result.text }
  }
  /** The pieces whose briefs went to `service`, in the order they went. */
  const handedOverIn = (service: string): readonly string[] => {
    const rows = world.ledger(service)
    const pieceOf = new Map<string, string>()
    for (const row of rows) {
      if (row.type === 'work_given' && row.messageId !== undefined) {
        pieceOf.set(row.messageId, row.piece)
      }
    }
    return rows.flatMap((row) => {
      if (row.type !== 'message_unqueued' || row.reason !== 'sent') return []
      const piece = row.messageId === undefined ? undefined : pieceOf.get(row.messageId)
      return piece === undefined ? [] : [piece]
    })
  }

  /** Provider turns for briefs and person words, excluding separately recorded app reminders. */
  const sentWithoutReminders = (service: string): typeof world.sent => {
    const reminders = new Set(
      world
        .ledger(service)
        .flatMap((row) =>
          row.type === 'user_turn' && row.appNotice === 'a-work-wait-needs-attention'
            ? [row.sent ?? row.text]
            : [],
        ),
    )
    return world.sent.filter((turn) => turn.as === 'browser-driver' && !reminders.has(turn.words))
  }

  it('launches its one conversation for its first piece, under its own id, and replaces nothing', async () => {
    const { host, caller } = await aServiceAndACaller()
    const one = accepted(await world.gives(host, caller, 'browser-driver'))
    const recorded = world.conversationsRecorded()
    await handedOver(one.owner, one.piece)
    expect(world.conversationsRecorded()).toBe(recorded)
    expect(world.startedAs).toEqual(['caller', 'browser-driver'])
    const types = world.ledger(one.owner).map((row) => row.type)
    expect(types[0]).toBe('work_given')
    expect(types).toContain('launched')
    expect(types).not.toContain('replaced_by')
    expect(handedOverIn(one.owner)).toEqual([one.piece])
  })

  it('hands the oldest piece over alone, and the next only once it has ended and the service is quiet', async () => {
    const { host, caller } = await aServiceAndACaller({ auto: true })
    const one = accepted(await world.gives(host, caller, 'browser-driver', { title: 'One' }))
    const two = accepted(await world.gives(host, caller, 'browser-driver', { title: 'Two' }))
    const three = accepted(await world.gives(host, caller, 'browser-driver', { title: 'Three' }))
    const service = one.owner
    // Its turn ends with the piece open: a stall, which keeps the queue where it is.
    await vi.waitFor(() => {
      expect(stateOf(service, one.piece)).toBe('stalled')
    })
    expect(piecesOf(service).map((piece) => piece.state)).toEqual(['stalled', 'waiting', 'waiting'])
    expect(handedOverIn(service)).toEqual([one.piece])

    // Answered, it ends; the next goes.
    await call(host, service, 'reply_to_parent', {
      piece: one.label,
      outcome: 'done',
      summary: 'Booked.',
    })
    await handedOver(service, two.piece)
    expect(stateOf(service, three.piece)).toBe('waiting')
    expect(handedOverIn(service)).toEqual([one.piece, two.piece])
    const rows = world.ledger(service)
    const replied = rows.findIndex((row) => row.type === 'work_replied' && row.piece === one.piece)
    const placed = rows.findIndex((row) => row.type === 'message_queued' && row.piece === two.piece)
    expect(replied).toBeGreaterThanOrEqual(0)
    expect(placed).toBeGreaterThan(replied)
    // Each brief took a turn of its own.
    const turns = rows.filter(
      (row) => row.type === 'user_turn' && row.appNotice !== 'a-work-wait-needs-attention',
    )
    expect(turns).toHaveLength(2)
    expect(turns.every((turn) => turn.type === 'user_turn' && turn.parts === undefined)).toBe(true)
  })

  it('keeps the piece it is on while an approval waits for a person', async () => {
    const { host, caller } = await aServiceAndACaller()
    const one = accepted(await world.gives(host, caller, 'browser-driver'))
    const two = accepted(await world.gives(host, caller, 'browser-driver'))
    await handedOver(one.owner, one.piece)
    await vi.waitFor(() => {
      expect(world.ledger(one.owner).some((row) => row.type === 'permission_request')).toBe(true)
    })
    expect(stateOf(one.owner, one.piece)).toBe('working')
    expect(stateOf(one.owner, two.piece)).toBe('waiting')
    expect(handedOverIn(one.owner)).toEqual([one.piece])
  })

  it('leaves the piece it is on open when it asks about it, and the queue with it', async () => {
    const { host, caller } = await aServiceAndACaller({ auto: true })
    const one = accepted(await world.gives(host, caller, 'browser-driver'))
    const two = accepted(await world.gives(host, caller, 'browser-driver'))
    const service = one.owner
    await vi.waitFor(() => {
      expect(stateOf(service, one.piece)).toBe('stalled')
    })
    const asked = await call(host, service, 'ask_question', {
      question: 'Which room?',
      who_answers: 'the-parent',
      piece: one.label,
    })
    expect(asked.structured).toMatchObject({ outcome: 'ok' })
    // Its caller sees it waiting on that answer; the piece behind it still waits its turn.
    expect(
      host.pieceBoard(caller).gave.map((row) => [row.piece, row.state, row.queuedBehind]),
    ).toEqual([
      [one.piece, 'waiting-on-an-answer', undefined],
      [two.piece, 'waiting', 1],
    ])
    expect(handedOverIn(service)).toEqual([one.piece])
  })

  it('two callers giving at the same moment: the oldest alone is queued and launched, under its own id', async () => {
    const { host, caller } = await aServiceAndACaller()
    world.anAgent('other-caller', 'nothing kept')
    const other = await world.aPersonOpens(host, 'other-caller')
    let release = (): void => {}
    world.startsWait = new Promise((done) => {
      release = done
    })
    const giving = Promise.all([
      world.gives(host, caller, 'browser-driver', { title: 'One' }),
      world.gives(host, other, 'browser-driver', { title: 'Two' }),
    ])
    await vi.waitFor(() => {
      expect(world.startedAs).toContain('browser-driver')
    })
    world.startsWait = null
    release()
    const [one] = (await giving).map(accepted)
    const service = one?.owner ?? ''
    const recorded = world.conversationsRecorded()
    const [oldest, next] = piecesOf(service)
    await handedOver(service, oldest?.piece ?? '')
    expect(handedOverIn(service)).toEqual([oldest?.piece])
    expect(next?.state).toBe('waiting')
    expect(world.startedAs.filter((profile) => profile === 'browser-driver')).toHaveLength(1)
    expect(world.conversationsRecorded()).toBe(recorded)
    expect(world.ledger(service).map((row) => row.type)).not.toContain('replaced_by')
    const held = world
      .ledger(service)
      .flatMap((row) => (row.type === 'message_queued' ? [row] : []))
    expect(held.map((row) => row.messageId)).toEqual([oldest?.messageId])
  })

  it('keeps a brief held when this app quits while its start is under way, and hands it over at the next launch', async () => {
    const { host, caller } = await aServiceAndACaller()
    let release = (): void => {}
    world.startsWait = new Promise((done) => {
      release = done
    })
    const one = accepted(await world.gives(host, caller, 'browser-driver'))
    await vi.waitFor(() => {
      expect(world.startedAs).toContain('browser-driver')
    })
    const quiet = [
      vi.spyOn(console, 'info').mockImplementation(() => {}),
      vi.spyOn(console, 'warn').mockImplementation(() => {}),
    ]
    const closing = host.closeAll()
    world.startsWait = null
    release()
    await closing
    expect(world.ledger(one.owner).some((row) => row.type === 'message_unqueued')).toBe(false)
    expect(stateOf(one.owner, one.piece)).toBe('waiting')
    world.aHost()
    await handedOver(one.owner, one.piece)
    for (const spy of quiet) spy.mockRestore()
    expect(handedOverIn(one.owner)).toEqual([one.piece])
  })

  it('keeps a head whose start is under way from being taken back or closed, and hands it over once started', async () => {
    const { host, caller } = await aServiceAndACaller()
    let release = (): void => {}
    world.startsWait = new Promise((done) => {
      release = done
    })
    const one = accepted(await world.gives(host, caller, 'browser-driver'))
    await vi.waitFor(() => {
      expect(world.startedAs).toContain('browser-driver')
    })
    const taken = await call(host, caller, 'withdraw_task', { piece: one.label })
    expect(taken.structured).toMatchObject({ rail: 'that-conversation-has-not-started' })
    const closed = await call(host, caller, 'update_work', { piece: one.label, close: true })
    expect(closed.structured).toMatchObject({ rail: 'that-conversation-has-not-started' })
    world.startsWait = null
    release()
    await handedOver(one.owner, one.piece)
    expect(handedOverIn(one.owner)).toEqual([one.piece])
  })

  it('never shows a caller the words of the piece the service is on', async () => {
    const { host, caller } = await aServiceAndACaller()
    world.anAgent('other-caller', 'nothing kept')
    const other = await world.aPersonOpens(host, 'other-caller')
    const one = accepted(
      await world.gives(host, caller, 'browser-driver', {
        title: 'Secret',
        brief: 'the secret brief',
      }),
    )
    await handedOver(one.owner, one.piece)
    const two = accepted(await world.gives(host, other, 'browser-driver', { title: 'Lunch' }))
    const record = await call(host, other, 'list_tasks', { piece: two.label })
    expect(record.text).not.toContain('secret')
    expect(record.text).not.toContain('Secret')
    expect(JSON.stringify(record.structured)).not.toContain('secret')
  })

  it('runs a piece that asked for no pair on its agent’s, never on the pair the piece before it asked for', async () => {
    world.anAgent('browser-driver', 'service', 'codex')
    world.anAgent('caller', 'nothing kept')
    world.store.setDefaultApprovalMode('auto')
    const host = world.aHost()
    const caller = await world.aPersonOpens(host, 'caller')
    const one = accepted(
      await world.gives(host, caller, 'browser-driver', { model: 'fake-codex-a', effort: 'high' }),
    )
    await vi.waitFor(() => {
      expect(stateOf(one.owner, one.piece)).toBe('stalled')
    })
    expect(world.store.whatItRunsOn(one.owner)).toMatchObject({ reasoningEffort: 'high' })
    const two = accepted(await world.gives(host, caller, 'browser-driver'))
    await call(host, one.owner, 'reply_to_parent', {
      piece: one.label,
      outcome: 'done',
      summary: 'Booked.',
    })
    await handedOver(one.owner, two.piece)
    // Its agent names none, so it runs on its provider's default: medium, never the high asked before.
    expect(world.store.whatItRunsOn(one.owner)).toMatchObject({
      model: 'fake-codex-a',
      reasoningEffort: 'medium',
    })
    // …and that is the pair each brief's own turn ran on at its provider.
    const pairsSent = (): (string | null)[][] =>
      sentWithoutReminders(one.owner).map((one) => [one.model, one.effort])
    await vi.waitFor(() => {
      expect(pairsSent()).toHaveLength(2)
    })
    expect(pairsSent()).toEqual([
      ['fake-codex-a', 'high'],
      ['fake-codex-a', 'medium'],
    ])
  })

  describe('while the pair its agent starts on is being read', () => {
    /** The host's own read of the pair an agent starts on. */
    interface ReadsAPair {
      theSelectedModel(
        ...args: unknown[]
      ): Promise<{ readonly model: string; readonly effort: string }>
    }
    type Given = Extract<GiveOutcome, { ok: true }>
    /**
     * A Codex service whose agent names no pair, its first piece (which asked for high) stalled.
     * Every read of the pair its agent starts on is counted, and the first answers low, every other
     * the provider's own default (medium): a pair sent says which read it came from.
     */
    const aCodexServiceOnAPieceThatAskedHigh = async (): Promise<{
      host: RuntimeHost
      caller: string
      service: string
      one: Given
      reads: () => number
    }> => {
      world.anAgent('browser-driver', 'service', 'codex')
      world.anAgent('caller', 'nothing kept')
      world.store.setDefaultApprovalMode('auto')
      const host = world.aHost()
      const caller = await world.aPersonOpens(host, 'caller')
      const one = accepted(
        await world.gives(host, caller, 'browser-driver', {
          title: 'One',
          model: 'fake-codex-a',
          effort: 'high',
        }),
      )
      const service = one.owner
      await vi.waitFor(() => {
        expect(stateOf(service, one.piece)).toBe('stalled')
      })
      const reader = host as unknown as ReadsAPair
      const read = reader.theSelectedModel.bind(host)
      let reads = 0
      vi.spyOn(reader, 'theSelectedModel').mockImplementation(async (...args: unknown[]) => {
        const nth = ++reads
        const own = await read(...args)
        return nth === 1 ? { ...own, effort: 'low' } : own
      })
      return { host, caller, service, one, reads: () => reads }
    }
    /** …and a second piece that asks for none, whose pair is being read, held until `release`. */
    const aReadHeldForTheSecondPiece = async (): Promise<
      Awaited<ReturnType<typeof aCodexServiceOnAPieceThatAskedHigh>> & {
        two: Given
        release: () => void
      }
    > => {
      const first = await aCodexServiceOnAPieceThatAskedHigh()
      const { host, caller, service, one } = first
      let release = (): void => {}
      world.listsWait = new Promise((done) => {
        release = done
      })
      const asked = world.listedFor.length
      const two = accepted(await world.gives(host, caller, 'browser-driver', { title: 'Two' }))
      await call(host, service, 'reply_to_parent', {
        piece: one.label,
        outcome: 'done',
        summary: 'Booked.',
      })
      await vi.waitFor(() => {
        expect(world.listedFor.slice(asked)).toContain('browser-driver')
      })
      return {
        ...first,
        two,
        release: () => {
          world.listsWait = null
          release()
        },
      }
    }
    const pairsSent = (service: string): (string | null)[][] =>
      sentWithoutReminders(service).map((one) => [one.model, one.effort])
    const placed = (service: string, piece: string): number =>
      world.ledger(service).filter((row) => row.type === 'message_queued' && row.piece === piece)
        .length
    const cardsIn = (conversation: string): TranscriptEvent[] =>
      world.ledger(conversation).filter((row) => row.type === 'permission_request')

    it('places nothing until it is read, then hands the piece over once, on that read’s pair', async () => {
      const { service, one, two, release, reads } = await aReadHeldForTheSecondPiece()
      expect(stateOf(service, two.piece)).toBe('waiting')
      expect(placed(service, two.piece)).toBe(0)
      release()
      await handedOver(service, two.piece)
      await vi.waitFor(() => {
        expect(pairsSent(service)).toHaveLength(2)
      })
      expect(handedOverIn(service)).toEqual([one.piece, two.piece])
      expect(placed(service, two.piece)).toBe(1)
      expect(reads()).toBe(1)
      expect(pairsSent(service)).toEqual([
        ['fake-codex-a', 'high'],
        ['fake-codex-a', 'low'],
      ])
    })

    it('reads again for the life a close and a reopen left, and hands the piece to it once', async () => {
      const { host, service, one, two, release } = await aReadHeldForTheSecondPiece()
      await host.close(service, THE_APP_ITSELF)
      await host.reopenForAPerson(service, world.window, null)
      expect(placed(service, two.piece)).toBe(0)
      release()
      await handedOver(service, two.piece)
      await vi.waitFor(() => {
        expect(pairsSent(service)).toHaveLength(2)
      })
      expect(handedOverIn(service)).toEqual([one.piece, two.piece])
      expect(placed(service, two.piece)).toBe(1)
      // The read held across the close was the first life's: the pair sent is the second read's.
      expect(pairsSent(service)).toEqual([
        ['fake-codex-a', 'high'],
        ['fake-codex-a', 'medium'],
      ])
    })

    it('hands over nothing of a piece taken back meanwhile, and reads again for the next', async () => {
      const { host, caller, service, one, two, release } = await aReadHeldForTheSecondPiece()
      const taken = await call(host, caller, 'withdraw_task', { piece: two.label })
      expect(taken.structured).toMatchObject({ outcome: 'ok' })
      const three = accepted(await world.gives(host, caller, 'browser-driver', { title: 'Three' }))
      release()
      await handedOver(service, three.piece)
      await vi.waitFor(() => {
        expect(pairsSent(service)).toHaveLength(2)
      })
      expect(handedOverIn(service)).toEqual([one.piece, three.piece])
      expect(placed(service, two.piece)).toBe(0)
      expect(placed(service, three.piece)).toBe(1)
      // The held read was the piece taken back's: the pair sent is the one read for the next.
      expect(pairsSent(service)).toEqual([
        ['fake-codex-a', 'high'],
        ['fake-codex-a', 'medium'],
      ])
    })

    it('drops a read that lands while the service is busy, and reads again once it is free', async () => {
      const warned = vi.spyOn(console, 'warn').mockImplementation(() => {})
      const { host, service, one, two, release } = await aReadHeldForTheSecondPiece()
      host.claimSession(service, world.window)
      await host.setApprovalMode(service, 'ask', world.window)
      await host.send(service, 'check the calendar first', world.window)
      await vi.waitFor(() => {
        expect(cardsIn(service)).toHaveLength(1)
      })
      // It fails while a person's turn waits on an approval: nothing is placed, and nothing stalls.
      world.listsFail = true
      release()
      await vi.waitFor(() => {
        expect(warned).toHaveBeenCalledWith(expect.stringContaining('could not read the pair'))
      })
      world.listsFail = false
      expect(stateOf(service, two.piece)).toBe('waiting')
      const [card] = cardsIn(service)
      if (card?.type !== 'permission_request') throw new Error('no card to answer')
      await host.respondPermission(service, card.id, { outcome: 'allow' }, world.window)
      await handedOver(service, two.piece)
      expect(stateOf(service, two.piece)).not.toBe('stalled')
      expect(handedOverIn(service)).toEqual([one.piece, two.piece])
      await vi.waitFor(() => {
        expect(pairsSent(service)).toHaveLength(3)
      })
      expect(pairsSent(service).at(-1)).toEqual(['fake-codex-a', 'medium'])
      warned.mockRestore()
    })

    it('ends the piece unsent when its pair can’t be read: it stalls, its caller is told, and nothing is sent', async () => {
      const warned = vi.spyOn(console, 'warn').mockImplementation(() => {})
      const { caller, service, two, release } = await aReadHeldForTheSecondPiece()
      world.listsFail = true
      release()
      await vi.waitFor(() => {
        expect(piecesOf(service).find((one) => one.piece === two.piece)).toMatchObject({
          state: 'stalled',
          stalledBecause: 'message_never_sent',
        })
      })
      await vi.waitFor(() => {
        expect(world.ledger(caller).some((row) => row.type === 'work_stall_told')).toBe(true)
      })
      expect(pairsSent(service)).toEqual([['fake-codex-a', 'high']])
      warned.mockRestore()
    })

    it('writes nothing when this app quits while it is read, and hands the piece over at the next launch', async () => {
      const { host, service, one, two, release } = await aReadHeldForTheSecondPiece()
      const quiet = [
        vi.spyOn(console, 'info').mockImplementation(() => {}),
        vi.spyOn(console, 'warn').mockImplementation(() => {}),
      ]
      const rows = world.ledger(service).length
      const closing = host.closeAll()
      release()
      await closing
      await new Promise((settled) => setTimeout(settled, 50))
      expect(
        world
          .ledger(service)
          .slice(rows)
          .map((row) => row.type),
      ).not.toContain('message_queued')
      expect(stateOf(service, two.piece)).toBe('waiting')
      world.aHost()
      await handedOver(service, two.piece)
      for (const spy of quiet) spy.mockRestore()
      expect(handedOverIn(service)).toEqual([one.piece, two.piece])
    })

    it('reads nothing where a person chose the pair it runs on, and hands the piece over on theirs', async () => {
      const { host, caller, service, one, reads } = await aCodexServiceOnAPieceThatAskedHigh()
      // A person kept the pair it runs on, high, and no pick of theirs names one for what starts.
      world.store.aPersonSetItsModelOrEffort(service, world.clock)
      expect(world.store.lastPicked('codex')).toBeNull()
      const two = accepted(await world.gives(host, caller, 'browser-driver', { title: 'Two' }))
      await call(host, service, 'reply_to_parent', {
        piece: one.label,
        outcome: 'done',
        summary: 'Booked.',
      })
      await handedOver(service, two.piece)
      await vi.waitFor(() => {
        expect(pairsSent(service)).toHaveLength(2)
      })
      expect(reads()).toBe(0)
      expect(pairsSent(service)).toEqual([
        ['fake-codex-a', 'high'],
        ['fake-codex-a', 'high'],
      ])
    })
  })

  it('runs each piece on the model and effort its give asked for', async () => {
    const { host, caller } = await aServiceAndACaller()
    const one = accepted(
      await world.gives(host, caller, 'browser-driver', { model: 'fake-claude-a', effort: 'high' }),
    )
    await handedOver(one.owner, one.piece)
    expect(world.store.whatItRunsOn(one.owner)).toMatchObject({
      model: 'fake-claude-a',
      reasoningEffort: 'high',
    })
  })

  it('ends a brief unsent when the start it needs fails: the piece stalls, its caller is told, and nothing starts it again', async () => {
    const { host, caller } = await aServiceAndACaller()
    world.startsFail = true
    const warned = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const one = accepted(await world.gives(host, caller, 'browser-driver'))
    await vi.waitFor(() => {
      expect(piecesOf(one.owner)[0]).toMatchObject({
        state: 'stalled',
        stalledBecause: 'message_never_sent',
      })
    })
    await vi.waitFor(() => {
      expect(world.ledger(caller).some((row) => row.type === 'work_stall_told')).toBe(true)
    })
    world.startsFail = false
    const two = accepted(await world.gives(host, caller, 'browser-driver'))
    expect(stateOf(one.owner, two.piece)).toBe('waiting')
    expect(world.startedAs).toEqual(['caller', 'browser-driver'])
    warned.mockRestore()
  })

  it('tells callers behind a stalled piece when it stalled, and never whose it is', async () => {
    const { host, caller } = await aServiceAndACaller({ auto: true })
    world.anAgent('other-caller', 'nothing kept')
    const other = await world.aPersonOpens(host, 'other-caller')
    const one = accepted(await world.gives(host, caller, 'browser-driver', { title: 'Secret' }))
    await vi.waitFor(() => {
      expect(stateOf(one.owner, one.piece)).toBe('stalled')
    })
    const given = await call(host, other, 'give_work', {
      definition_of_done: 'The requested result and its checks are recorded.',
      profile: 'browser-driver',
      title: 'Order lunch',
      brief: 'order lunch for six',
    })
    const stalledAt = clockTime(piecesOf(one.owner)[0]?.stalledAt ?? undefined)
    expect(given.text).toContain(` Queued behind 1; the active piece stalled at ${stalledAt}.`)
    expect(given.text).not.toContain('Secret')
    expect(given.text).not.toContain(one.label)
    const board = await call(host, other, 'list_tasks', {})
    expect(board.text).toContain(`queued behind 1; the active piece stalled at ${stalledAt}`)
    expect(board.text).not.toContain('Secret')
  })

  describe('when the row that holds its next brief can’t be written', () => {
    /** Which rows can't be written. */
    interface Fails {
      when: (conversation: string, event: TranscriptEvent) => boolean
    }
    /** The store, but its rows that `fails` names can't be written: the disk is full for them. */
    const aStoreThatFails = (fails: Fails): SessionStore =>
      new Proxy(world.store, {
        get(target, key, receiver) {
          if (key === 'append') {
            return (...args: Parameters<SessionStore['append']>) => {
              const [conversation, , event] = args
              if (fails.when(conversation, event)) throw new Error('the disk is full')
              target.append(...args)
            }
          }
          const value: unknown = Reflect.get(target, key, receiver)
          return typeof value === 'function'
            ? (value as (...args: unknown[]) => unknown).bind(target)
            : value
        },
      })
    const nothing: Fails['when'] = () => false
    /** The words each turn handed the service's provider. */
    const sentToTheService = (): string[] =>
      world.sent.filter((one) => one.as === 'browser-driver').map((one) => one.words)
    /** A running service on its first piece, stalled, with a second queued behind it. */
    const aSecondBriefAfterTheFirst = async (fails: Fails) => {
      world.anAgent('browser-driver')
      world.anAgent('caller', 'nothing kept')
      world.store.setDefaultApprovalMode('auto')
      const host = world.aHost({ store: aStoreThatFails(fails) })
      const caller = await world.aPersonOpens(host, 'caller')
      const one = accepted(
        await world.gives(host, caller, 'browser-driver', { brief: 'the first brief' }),
      )
      await vi.waitFor(() => {
        expect(stateOf(one.owner, one.piece)).toBe('stalled')
      })
      const two = accepted(
        await world.gives(host, caller, 'browser-driver', { brief: 'the second brief' }),
      )
      return { host, one, two }
    }

    it('hands nothing over when a running service can’t record the brief it would take', async () => {
      const fails: Fails = { when: nothing }
      const { host, one, two } = await aSecondBriefAfterTheFirst(fails)
      const runs = (): boolean =>
        (host as unknown as { slots: Map<string, { session: unknown }> }).slots.get(one.owner)
          ?.session != null
      expect(runs()).toBe(true)
      fails.when = (conversation, event) =>
        conversation === one.owner && event.type === 'message_queued'
      const quiet = vi.spyOn(console, 'error').mockImplementation(() => {})
      await call(host, one.owner, 'reply_to_parent', {
        piece: one.label,
        outcome: 'done',
        summary: 'Booked.',
      })
      await new Promise((settle) => setTimeout(settle, 200))
      // Its running life is what failed to record the brief: that life records nothing more.
      const saidNoLonger = quiet.mock.calls.some((said) =>
        String(said[0]).includes('is no longer being recorded'),
      )
      quiet.mockRestore()
      expect(saidNoLonger).toBe(true)
      expect(sentToTheService().filter((words) => words.includes('the first brief'))).toHaveLength(
        1,
      )
      expect(sentToTheService().filter((words) => words.includes('the second brief'))).toEqual([])
      expect(stateOf(one.owner, two.piece)).toBe('waiting')
    })

    it('…while one that records it hands it over, once', async () => {
      const { host, one, two } = await aSecondBriefAfterTheFirst({ when: nothing })
      await call(host, one.owner, 'reply_to_parent', {
        piece: one.label,
        outcome: 'done',
        summary: 'Booked.',
      })
      await handedOver(one.owner, two.piece)
      await new Promise((settle) => setTimeout(settle, 100))
      expect(sentToTheService().filter((words) => words.includes('the second brief'))).toHaveLength(
        1,
      )
    })

    it('starts nothing when a stopped service can’t record the brief it would take', async () => {
      world.anAgent('browser-driver')
      world.anAgent('caller', 'nothing kept')
      const fails: Fails = { when: nothing }
      const host = world.aHost({ store: aStoreThatFails(fails) })
      const caller = await world.aPersonOpens(host, 'caller')
      fails.when = (conversation, event) =>
        conversation !== caller && event.type === 'message_queued'
      const quiet = vi.spyOn(console, 'warn').mockImplementation(() => {})
      const one = accepted(await world.gives(host, caller, 'browser-driver'))
      await new Promise((settle) => setTimeout(settle, 200))
      quiet.mockRestore()
      expect(world.startedAs).not.toContain('browser-driver')
      expect(stateOf(one.owner, one.piece)).toBe('waiting')
    })
  })

  describe('at a restart', () => {
    /**
     * A service's conversation recorded with two pieces queued in it and nothing handed over, as a
     * stop between its pieces leaves it; with `held`, the first one's brief is held in its ledger,
     * for its next start, or for a life a crash cut — or was handed to that life, which a crash cut
     * before its turn was recorded.
     */
    const aQueueLeftBehind = (
      held:
        | 'nothing'
        | 'for-its-next-start'
        | 'by-a-life-a-crash-cut'
        | 'after-a-note'
        | 'sent-before-its-turn',
      /** A caller a person opened and that has stopped since; else one recorded that never ran. */
      callerThatRan?: string,
      /** Another caller a person opened, and that has stopped since, gives the second piece. */
      other?: string,
    ): { service: string; pieces: readonly string[]; caller: string } => {
      const svc = world.anAgent('browser-driver', 'nothing kept')
      const caller = callerThatRan ?? 'sess_the_caller'
      if (callerThatRan === undefined) {
        world.anAgent('caller', 'nothing kept')
        world.store.create({
          id: caller,
          provider: 'claude',
          cwd: world.folder,
          approvalMode: 'ask',
          profileId: 'caller',
        })
      }
      const service = 'sess_the_service'
      world.store.create({
        id: service,
        provider: 'claude',
        cwd: world.folder,
        approvalMode: 'auto',
        profileId: 'browser-driver',
        service: true,
      })
      writeProfileExecution(profileExecutionFile(world.folder), {
        profiles: {
          [svc.id]: {
            kind: 'service',
            identityCreatedAt: svc.createdAt,
            serviceConversation: service,
          },
        },
      })
      const root = world.store.rootOf(caller)
      if (root === null) throw new Error('the caller owns no root')
      if (held === 'by-a-life-a-crash-cut' || held === 'sent-before-its-turn') {
        world.store.append(
          service,
          world.store.nextOrdinal(service),
          { type: 'launched' },
          world.clock++,
        )
      }
      const pieces = [1, 2].map((number) => {
        const piece = `work_queued_${String(number)}`
        const givenBy = number === 2 && other !== undefined ? other : caller
        const under = world.store.rootOf(givenBy)
        if (under === null) throw new Error('the caller owns no root')
        world.store.recordGive(
          {
            piece,
            parent: under.piece,
            number,
            owner: service,
            givenBy,
            title: `Piece ${String(number)}`,
            brief: `do piece ${String(number)}`,
            folder: null,
            inputs: [],
          },
          world.store.nextOrdinal(service),
          {
            type: 'work_given',
            piece,
            label: `${under.label}.${String(number)}`,
            parent: under.piece,
            givenBy,
            title: `Piece ${String(number)}`,
            brief: `do piece ${String(number)}`,
            messageId: `msg_queued_${String(number)}`,
          },
          world.clock++,
        )
        return piece
      })
      if (held === 'after-a-note') {
        world.store.append(
          service,
          world.store.nextOrdinal(service),
          {
            type: 'message_queued',
            messageId: 'msg_a_note',
            kind: 'notice',
            text: 'a note held for its next start',
            forItsNextStart: true,
          },
          world.clock++,
        )
      }
      if (held !== 'nothing') {
        world.store.append(
          service,
          world.store.nextOrdinal(service),
          {
            type: 'message_queued',
            messageId: 'msg_queued_1',
            kind: 'work',
            text: 'do piece 1',
            piece: 'work_queued_1',
            label: `${root.label}.1`,
            ...(held === 'by-a-life-a-crash-cut' || held === 'sent-before-its-turn'
              ? {}
              : { forItsNextStart: true as const }),
          },
          world.clock++,
        )
      }
      if (held === 'sent-before-its-turn') {
        world.store.append(
          service,
          world.store.nextOrdinal(service),
          {
            type: 'message_unqueued',
            messageId: 'msg_queued_1',
            reason: 'sent',
          } as TranscriptEvent,
          world.clock++,
        )
      }
      return { service, pieces, caller }
    }

    it('starts the oldest piece of a queue nothing was on', async () => {
      const { service, pieces } = aQueueLeftBehind('nothing')
      const info = vi.spyOn(console, 'info').mockImplementation(() => {})
      world.aHost()
      await handedOver(service, pieces[0] ?? '')
      info.mockRestore()
      expect(stateOf(service, pieces[1] ?? '')).toBe('waiting')
      expect(handedOverIn(service)).toEqual([pieces[0]])
    })

    it('hands over a brief held for its next start, which never reached it', async () => {
      const { service, pieces } = aQueueLeftBehind('for-its-next-start')
      const info = vi.spyOn(console, 'info').mockImplementation(() => {})
      world.aHost()
      await handedOver(service, pieces[0] ?? '')
      info.mockRestore()
      expect(handedOverIn(service)).toEqual([pieces[0]])
      // The one held row was handed over; no second brief was queued for it.
      expect(world.ledger(service).filter((row) => row.type === 'message_queued')).toHaveLength(1)
    })

    it('hands a brief held for its start over in a turn of its own, apart from words held before it', async () => {
      const { service, pieces } = aQueueLeftBehind('after-a-note')
      const info = vi.spyOn(console, 'info').mockImplementation(() => {})
      world.aHost()
      await handedOver(service, pieces[0] ?? '')
      info.mockRestore()
      const turns = world.ledger(service).filter((row) => row.type === 'user_turn')
      expect(turns).toHaveLength(2)
      expect(turns.every((turn) => turn.type === 'user_turn' && turn.parts === undefined)).toBe(
        true,
      )
      expect(handedOverIn(service)).toEqual([pieces[0]])
    })

    it('launches nothing over a first launch cut before its provider named it, at this start or the next: the piece stalls, and its caller is told once', async () => {
      world.anAgent('caller', 'nothing kept')
      const before = world.aHost()
      const ran = await world.aPersonOpens(before, 'caller')
      await before.closeAll()
      const { service, pieces, caller } = aQueueLeftBehind('nothing', ran)
      const lost = 'claude-a-launch-that-was-cut'
      world.store.firstLaunchOf({ id: service, launchedAs: lost })
      const launchedAs = (): string | null =>
        (
          world.db
            .prepare('SELECT launched_as AS asked FROM provider_session WHERE id = ?')
            .get(service) as {
            asked: string | null
          }
        ).asked
      // Told as the waking tests count it: a stall notice sent, or held for the caller's next start.
      const told = (): number =>
        world
          .ledger(caller)
          .filter(
            (row) =>
              row.type === 'work_stall_told' ||
              (row.type === 'message_queued' &&
                ('report' in (row as object) || row.appNotice === 'a-work-wait-needs-attention')),
          ).length
      const quiet = [
        vi.spyOn(console, 'info').mockImplementation(() => {}),
        vi.spyOn(console, 'warn').mockImplementation(() => {}),
      ]
      world.aHost()
      await vi.waitFor(() => {
        expect(piecesOf(service)[0]).toMatchObject({
          state: 'stalled',
          stalledBecause: 'message_never_sent',
        })
      })
      await vi.waitFor(() => {
        expect(told()).toBe(1)
      })
      expect(launchedAs()).toBe(lost)
      expect(world.startedAs).not.toContain('browser-driver')
      expect(stateOf(service, pieces[1] ?? '')).toBe('waiting')

      // The next start, after this one crashed: still nothing launched over it, and nothing said twice.
      world.aHost()
      await new Promise((settle) => setTimeout(settle, 200))
      for (const spy of quiet) spy.mockRestore()
      expect(launchedAs()).toBe(lost)
      expect(world.startedAs).not.toContain('browser-driver')
      expect(piecesOf(service)[0]).toMatchObject({
        state: 'stalled',
        stalledBecause: 'message_never_sent',
      })
      expect(stateOf(service, pieces[1] ?? '')).toBe('waiting')
      expect(told()).toBe(1)
    })

    it('moves nothing where a row of its queue can’t be read', async () => {
      const { service } = aQueueLeftBehind('nothing')
      world.db
        .prepare(
          `UPDATE events SET payload = '{not json' WHERE session_id = ? AND type = ? AND payload LIKE ?`,
        )
        .run(service, 'work_given', '%work_queued_2%')
      const quiet = [
        vi.spyOn(console, 'info').mockImplementation(() => {}),
        vi.spyOn(console, 'warn').mockImplementation(() => {}),
      ]
      world.aHost()
      await new Promise((settle) => setTimeout(settle, 100))
      for (const spy of quiet) spy.mockRestore()
      expect(handedOverIn(service)).toEqual([])
      expect(world.startedAs).not.toContain('browser-driver')
    })

    it('never hands over again a brief a crash cut while it was held: that piece stalls, and the queue keeps', async () => {
      const { service, pieces } = aQueueLeftBehind('by-a-life-a-crash-cut')
      const quiet = [
        vi.spyOn(console, 'info').mockImplementation(() => {}),
        vi.spyOn(console, 'warn').mockImplementation(() => {}),
      ]
      world.aHost()
      await vi.waitFor(() => {
        expect(piecesOf(service)[0]).toMatchObject({
          state: 'stalled',
          stalledBecause: 'message_never_sent',
        })
      })
      await new Promise((settle) => setTimeout(settle, 50))
      for (const spy of quiet) spy.mockRestore()
      expect(handedOverIn(service)).toEqual([])
      expect(stateOf(service, pieces[1] ?? '')).toBe('waiting')
      expect(world.startedAs).not.toContain('browser-driver')
    })

    describe('across a crash at each step of a handover, and the next start after it', () => {
      // ⚑ A give and its place in the queue are one write (`recordGive`): no crash falls between.
      /** Two callers a person opened, stopped since; the second gives the second piece. */
      const twoCallers = async (): Promise<{ first: string; other: string }> => {
        world.anAgent('caller', 'nothing kept')
        world.anAgent('other-caller', 'nothing kept')
        const before = world.aHost()
        const first = await world.aPersonOpens(before, 'caller')
        const other = await world.aPersonOpens(before, 'other-caller')
        await before.closeAll()
        return { first, other }
      }
      /** Stall notices a caller was sent, or that are held for its next start. */
      const told = (caller: string): number =>
        world
          .ledger(caller)
          .filter(
            (row) =>
              row.type === 'work_stall_told' ||
              (row.type === 'message_queued' &&
                ('report' in (row as object) || row.appNotice === 'a-work-wait-needs-attention')),
          ).length
      /** A start after a crash: a host with its own store, as the next launch has. */
      const afterACrash = (): RuntimeHost =>
        world.aHost({ store: createSessionStore(world.db, () => world.clock++) })
      /**
       * A person opens the callers again in `host`, as a giver hears of its stalled work once it
       * runs: with nothing else running in them, what they are told goes straight in.
       */
      const theyStart = async (host: RuntimeHost, callers: readonly string[]): Promise<void> => {
        for (const one of callers) await host.resumeSession(one, world.window)
      }
      const quietly = async (run: () => Promise<void>): Promise<void> => {
        const quiet = [
          vi.spyOn(console, 'info').mockImplementation(() => {}),
          vi.spyOn(console, 'warn').mockImplementation(() => {}),
        ]
        try {
          await run()
        } finally {
          for (const spy of quiet) spy.mockRestore()
        }
      }

      it('queued, not yet held: the first start hands it over once, under its own id, and the next start nothing', async () => {
        const { first, other } = await twoCallers()
        const { service, pieces, caller } = aQueueLeftBehind('nothing', first, other)
        await quietly(async () => {
          world.aHost()
          await handedOver(service, pieces[0] ?? '')
          await vi.waitFor(() => {
            expect(told(caller)).toBe(1)
          })
          await new Promise((settle) => setTimeout(settle, 100))
          await theyStart(afterACrash(), [caller, other])
          await new Promise((settle) => setTimeout(settle, 200))
        })
        expect(handedOverIn(service)).toEqual([pieces[0]])
        expect(
          world
            .ledger(service)
            .filter(
              (row) =>
                row.type === 'message_unqueued' &&
                row.reason === 'sent' &&
                world
                  .ledger(service)
                  .some(
                    (queued) =>
                      queued.type === 'message_queued' &&
                      queued.piece !== undefined &&
                      queued.messageId === row.messageId,
                  ),
            )
            .map((row) => (row.type === 'message_unqueued' ? row.messageId : null)),
        ).toEqual(['msg_queued_1'])
        expect(stateOf(service, pieces[1] ?? '')).toBe('waiting')
        expect(told(caller)).toBe(1)
        expect(told(other)).toBe(0)
      })

      it('held, not yet handed over: never handed over, at this start or the next; it stalls, and only its caller is told, once', async () => {
        const { first, other } = await twoCallers()
        const { service, pieces, caller } = aQueueLeftBehind('by-a-life-a-crash-cut', first, other)
        await quietly(async () => {
          await theyStart(world.aHost(), [caller, other])
          await vi.waitFor(() => {
            expect(piecesOf(service)[0]).toMatchObject({
              state: 'stalled',
              stalledBecause: 'message_never_sent',
            })
          })
          await vi.waitFor(() => {
            expect(told(caller)).toBe(1)
          })
          await new Promise((settle) => setTimeout(settle, 100))
          await theyStart(afterACrash(), [caller, other])
          await new Promise((settle) => setTimeout(settle, 200))
        })
        expect(handedOverIn(service)).toEqual([])
        expect(world.startedAs).not.toContain('browser-driver')
        expect(stateOf(service, pieces[1] ?? '')).toBe('waiting')
        expect(told(caller)).toBe(1)
        expect(told(other)).toBe(0)
      })

      it('handed over, before its turn was recorded: never handed over again, at this start or the next; it stalls, and only its caller is told, once', async () => {
        const { first, other } = await twoCallers()
        const { service, pieces, caller } = aQueueLeftBehind('sent-before-its-turn', first, other)
        await quietly(async () => {
          await theyStart(world.aHost(), [caller, other])
          await vi.waitFor(() => {
            expect(stateOf(service, pieces[0] ?? '')).toBe('stalled')
          })
          await vi.waitFor(() => {
            expect(told(caller)).toBe(1)
          })
          await new Promise((settle) => setTimeout(settle, 100))
          await theyStart(afterACrash(), [caller, other])
          await new Promise((settle) => setTimeout(settle, 200))
        })
        expect(handedOverIn(service)).toEqual([pieces[0]])
        expect(world.startedAs).not.toContain('browser-driver')
        expect(stateOf(service, pieces[1] ?? '')).toBe('waiting')
        expect(told(caller)).toBe(1)
        expect(told(other)).toBe(0)
      })
    })
  })
})
