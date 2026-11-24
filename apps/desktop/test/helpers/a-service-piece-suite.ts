import { newConversationGive } from '../lib/give-fixture'
import type { TranscriptEvent } from '../../src/shared/conversation-events'
import { theMessagesOf } from '../../src/shared/runtime-ipc'
import type { PieceRow } from '../../src/shared/task-contracts'
import { afterEach, beforeEach, expect, vi } from 'vitest'
import { agentCallerId, agentToolsFor, type ToolName } from '../../src/main/runtime/agent-tools'
import { type GiveOutcome, type RuntimeHost } from '../../src/main/runtime/runtime-host'
import { aServiceWorld, type AServiceWorld } from './a-service-world'

type Given = Extract<GiveOutcome, { ok: true }>

function aServicePieceSuite() {
  let world: AServiceWorld
  beforeEach(() => {
    world = aServiceWorld({ holderReminders: 'declined' })
  })
  afterEach(async () => {
    world.turnsWait = null
    world.stopsWait = null
    world.stopsAddressTheirTurn = false
    world.signInWait = null
    world.sendsSettle = null
    world.clockStep = 1
    world.signInChecksLetThrough = 0
    await world.cleanUp()
  })

  const accepted = (outcome: GiveOutcome): Given => {
    if (!outcome.ok) throw new Error(`refused (${outcome.refusal.rail}): ${outcome.refusal.reason}`)
    return outcome
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
  const giveRoomsTask = async (host: RuntimeHost, service: string) => {
    const given = await call(
      host,
      service,
      'give_work',
      newConversationGive('helper', 'Find rooms', 'list the free rooms'),
    )
    expect(given.structured).toMatchObject({ outcome: 'ok' })
    const helper = String(given.structured['owner'] ?? given.structured['agent'])
    return { given, helper }
  }

  const giveAndReportAFreeRoom = async (host: RuntimeHost, service: string) => {
    const { given, helper } = await giveRoomsTask(host, service)
    const replied = await call(host, helper, 'reply_to_parent', {
      piece: String(given.structured['label']),
      outcome: 'done',
      summary: 'Room 4 is free.',
    })
    expect(replied.structured).toMatchObject({ outcome: 'ok' })
  }
  const queueServiceFollowUp = (host: RuntimeHost, caller: string, one: Given, text: string) =>
    host.queueMessage(
      one.owner,
      text,
      { ownerId: agentCallerId(caller) },
      [],
      'work',
      { aboutPiece: { piece: one.piece, label: one.label } },
      'follow-up',
    )

  const piecesOf = (service: string): readonly PieceRow[] => world.store.piecesOwnedBy(service)
  const stateOf = (service: string, piece: string): string | undefined =>
    piecesOf(service).find((one) => one.piece === piece)?.state
  const handedOver = async (service: string, piece: string): Promise<void> => {
    await vi.waitFor(() => {
      expect(stateOf(service, piece)).not.toBe('waiting')
    })
  }
  const rows = (conversation: string, type: TranscriptEvent['type']): TranscriptEvent[] =>
    world.ledger(conversation).filter((row) => row.type === type)
  const deliveredParts = (conversation: string) =>
    world
      .ledger(conversation)
      .flatMap((row) => (row.type === 'user_turn' ? theMessagesOf(row) : []))
  /** The routing rows of `service`'s questions, by request id. */
  const routed = (
    service: string,
  ): Map<string, Extract<TranscriptEvent, { type: 'request_routed' }>> =>
    new Map(
      world
        .ledger(service)
        .flatMap((row) => (row.type === 'request_routed' ? [[row.requestId, row] as const] : [])),
    )
  /** Release a gate the world holds, so nothing waits on it any more. */
  const aGate = (): { readonly held: Promise<void>; readonly release: () => void } => {
    let release = (): void => {}
    const held = new Promise<void>((done) => {
      release = done
    })
    return { held, release }
  }

  const holdFollowUpAtSignIn = async (
    host: RuntimeHost,
    caller: string,
    one: Given,
    releaseTheTurn: () => void,
  ) => {
    const followed = await queueServiceFollowUp(host, caller, one, 'the room on the third floor')
    expect(followed.outcome).toBe('queued')
    const signIn = aGate()
    world.signInWait = signIn.held
    const checked = world.signInChecks
    releaseTheTurn()
    await vi.waitFor(() => {
      expect(world.signInChecks).toBeGreaterThan(checked)
    })
    return signIn
  }

  const aServiceOnTheFirstPiece = async (
    opts: {
      turnHeld?: boolean
      ask?: boolean
      interruptWaitMs?: number
      deliveryWaitMs?: number
      signInsChecked?: boolean
    } = {},
  ): Promise<{
    host: RuntimeHost
    caller: string
    other: string
    stranger: string
    service: string
    one: Given
    two: Given
    releaseTheTurn: () => void
  }> => {
    world.anAgent('browser-driver')
    world.anAgent('caller', 'nothing kept')
    world.anAgent('other-caller', 'nothing kept')
    world.anAgent('stranger', 'nothing kept')
    if (opts.ask !== true) world.store.setDefaultApprovalMode('auto')
    world.signInsChecked = opts.signInsChecked === true
    const host = world.aHost({
      ...(opts.interruptWaitMs === undefined ? {} : { interruptWaitMs: opts.interruptWaitMs }),
      ...(opts.deliveryWaitMs === undefined ? {} : { deliveryWaitMs: opts.deliveryWaitMs }),
    })
    const caller = await world.aPersonOpens(host, 'caller')
    const other = await world.aPersonOpens(host, 'other-caller')
    const stranger = await world.aPersonOpens(host, 'stranger')
    const turn = aGate()
    if (opts.turnHeld === true) world.turnsWait = turn.held
    const one = accepted(await world.gives(host, caller, 'browser-driver', { title: 'One' }))
    const two = accepted(await world.gives(host, other, 'browser-driver', { title: 'Two' }))
    const service = one.owner
    await handedOver(service, one.piece)
    if (opts.turnHeld === true) {
      await vi.waitFor(() => {
        expect(rows(service, 'user_turn')).toHaveLength(1)
      })
    } else if (opts.ask === true) {
      await vi.waitFor(() => {
        expect(rows(service, 'permission_request')).toHaveLength(1)
      })
    } else {
      await vi.waitFor(() => {
        expect(stateOf(service, one.piece)).toBe('stalled')
      })
    }
    return {
      host,
      caller,
      other,
      stranger,
      service,
      one,
      two,
      releaseTheTurn: () => {
        world.turnsWait = null
        turn.release()
      },
    }
  }
  return {
    world: () => world,
    accepted,
    call,
    giveRoomsTask,
    giveAndReportAFreeRoom,
    queueServiceFollowUp,
    piecesOf,
    stateOf,
    handedOver,
    rows,
    deliveredParts,
    routed,
    aGate,
    holdFollowUpAtSignIn,
    aServiceOnTheFirstPiece,
  }
}

export { aServicePieceSuite, type Given }
