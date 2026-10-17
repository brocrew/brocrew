import { executeRuntimeCommand } from '../src/main/runtime/ipc'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { writeFileSync, unlinkSync, realpathSync } from 'node:fs'
import { join } from 'node:path'
import { aServiceWorld, type AServiceWorld } from './helpers/a-service-world'
import { agentCallerId, agentToolsFor } from '../src/main/runtime/agent-tools'
import { originalMoveRequest, recordMovedRequest } from '../src/main/runtime/move-request'
import { RuntimeHost, THE_APP_ITSELF } from '../src/main/runtime/runtime-host'
import {
  DO_IT_HERE,
  MOVE_IT,
  MOVE_WORDS,
  movedHereLine,
  moveReceiptOf,
  type MoveOffer,
} from '../src/shared/move-request'
import { conversationLink } from '../src/shared/links'
import type { SessionStore } from '../src/main/db/session-store'
import { DEFAULT_CAPABILITIES } from '../src/shared/capabilities'
import { RecordingSink } from './helpers/a-service-world'
import { answerCodexToolCall } from '../../../packages/runtime/src/codex/agent-tools'
import type { AgentToolAnswer } from '@brobot2/runtime'
import type { TranscriptEvent } from '../src/shared/runtime-ipc'

const ORIGINAL = 'Please check the fictional release notes.'
const PERSON = { who: 'a-person' as const }

describe('a person moves the stored request', () => {
  let world: AServiceWorld
  let host: RuntimeHost
  let source: string
  let target: string
  beforeEach(async () => {
    world = aServiceWorld()
    world.anAgent('source', 'normal')
    world.anAgent('target', 'normal')
    host = world.aHost({ servicesOn: false })
    source = await world.aPersonOpens(host, 'source')
    target = await world.aPersonOpens(host, 'target')
    await host.send(source, ORIGINAL, world.window)
  })
  afterEach(async () => world.cleanUp())

  const byAgent = () => ({ ownerId: agentCallerId(source) })
  const offer = async () => {
    const result = await host.raiseAQuestion(
      {
        piece: null,
        question: 'The target owns this subject.',
        options: [],
        who: 'a-person',
        agent: null,
        moveTo: target,
      },
      byAgent(),
    )
    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error(result.refusal.reason)
    return result.question
  }
  const sourceWords = () => world.ledger(source).filter((one) => one.type === 'user_turn')
  const targetWords = () => world.ledger(target).filter((one) => one.type === 'user_turn')
  const row = (id: string, event: TranscriptEvent) =>
    world.store.append(id, world.store.nextOrdinal(id), event, world.clock++)

  it('offers without sending, keeps ordinary reply work and fixes the two actions', async () => {
    const requestId = await offer()
    expect(targetWords()).toHaveLength(0)
    expect(sourceWords()).toHaveLength(1)
    const raised = world.store.questionsRaisedIn(source).get(requestId)!
    expect(raised.questions[0]?.options.map((one) => one.label)).toEqual([MOVE_IT, DO_IT_HERE])
    expect(raised.move?.destination).toBe(target)
    expect(
      world.store.routedRequestsOf(source).find((one) => one.requestId === requestId)?.state,
    ).toBe('open')
  })

  it('accepts exact original text, carries person provenance and does not wake the source', async () => {
    const requestId = await offer()
    host.setAgentDisplayName('target', 'Destination ] new)')
    const before = sourceWords().length
    const ack = await host.decideMoveRequest(
      { sessionId: source, requestId, decision: 'move' },
      world.window,
    )
    expect(ack.outcome).toBe('moved')
    const destinationLink = `[Destination \\] new\\)](brocrew://conversation/${encodeURIComponent(target)})`
    expect(ack).toMatchObject({ destinationLink })
    const receipt = world.store.theDecisionOn(source, requestId)?.movedTo
    expect(receipt).toEqual({
      sessionId: target,
      messageId: `move-${source}-${requestId}`,
      destinationLink,
      receiptLine: `Your request is now in ${destinationLink}.`,
    })
    const stored = world.ledger(source).filter((one) => one.type === 'user_decision' && one.movedTo)
    expect(stored).toHaveLength(1)
    expect(stored[0]?.type === 'user_decision' && stored[0].movedTo).toEqual(receipt)
    await expect.poll(() => targetWords().length).toBe(1)
    const moved = targetWords()[0]!
    expect(moved.type === 'user_turn' && moved.text).toBe(ORIGINAL)
    expect(moved.type === 'user_turn' && moved.attribution).toBeUndefined()
    expect(moved.type === 'user_turn' && moved.movedFrom?.sessionId).toBe(source)
    expect(sourceWords()).toHaveLength(before)
    const endings = world.ledger(target).filter((one) => one.type === 'message_unqueued')
    expect(endings).toHaveLength(1)
    expect(endings[0]?.type === 'message_unqueued' && endings[0].reason).toBe('handover')
    expect(world.store.theDecisionOn(source, requestId)?.by).toEqual(PERSON)
  })

  it('rejects an agent press, even with a claimed person behind that caller', async () => {
    const requestId = await offer()
    for (const caller of [byAgent(), { ...byAgent(), aPersonIsBehindIt: true }]) {
      expect(
        await host.decideMoveRequest({ sessionId: source, requestId, decision: 'move' }, caller),
      ).toEqual({ outcome: 'refused', reason: MOVE_WORDS.personOnly })
    }
    expect(targetWords()).toHaveLength(0)
    expect(world.store.theDecisionOn(source, requestId)).toBeNull()
  })

  it('two simultaneous presses and a later retry share the one durable receipt', async () => {
    host.setAgentDisplayName('target', 'Destination')
    const requestId = await offer()
    const input = { sessionId: source, requestId, decision: 'move' as const }
    const [first, second] = await Promise.all([
      host.decideMoveRequest(input, world.window),
      host.decideMoveRequest(input, world.window),
    ])
    expect(second).toEqual(first)
    expect(first).toMatchObject({
      outcome: 'moved',
      destinationLink: `[Destination](brocrew://conversation/${encodeURIComponent(target)})`,
    })
    const receipts = world
      .ledger(source)
      .filter((one) => one.type === 'user_decision' && one.movedTo)
    expect(receipts).toHaveLength(1)
    expect(receipts[0]?.type === 'user_decision' && receipts[0].movedTo?.destinationLink).toBe(
      `[Destination](brocrew://conversation/${encodeURIComponent(target)})`,
    )
    await expect.poll(() => targetWords().length).toBe(1)
    expect(world.ledger(target).filter((one) => one.type === 'message_queued')).toHaveLength(1)
    host.setAgentDisplayName('target', 'Renamed after moving')
    expect(await host.decideMoveRequest(input, world.window)).toEqual(first)
    expect(
      world.ledger(source).filter((one) => one.type === 'user_decision' && one.movedTo),
    ).toHaveLength(1)
  })

  it('reads old receipts without inventing links, and drops malformed link metadata without losing idempotency', () => {
    const old = { sessionId: target, messageId: 'old-move' }
    expect(moveReceiptOf(old)).toEqual(old)
    expect(
      moveReceiptOf({
        ...old,
        destinationLink: '[Wrong](https://example.com)',
        receiptLine: 'Not a move receipt',
      }),
    ).toEqual(old)
    const destinationLink = `[Destination](brocrew://conversation/${encodeURIComponent(target)})`
    const linked = {
      ...old,
      destinationLink,
      receiptLine: `Your request is now in ${destinationLink}.`,
    }
    expect(moveReceiptOf(linked)).toEqual(linked)
    expect(moveReceiptOf({ ...linked, receiptLine: 'Changed words' })).toEqual(old)
    const malformed = { ...old, sessionId: '\ud800' }
    expect(moveReceiptOf({ ...linked, ...malformed })).toEqual(malformed)
  })

  it('Do it here closes the offer and sends no target request', async () => {
    const requestId = await offer()
    expect(
      await host.decideMoveRequest(
        { sessionId: source, requestId, decision: 'here' },
        world.window,
      ),
    ).toEqual({ outcome: 'here' })
    expect(world.store.theDecisionOn(source, requestId)?.outcome).toBe('answered')
    expect(targetWords()).toHaveLength(0)
  })

  it('text saying move it stays here and closes only the move offer', async () => {
    const requestId = await offer()
    const ordinary = await host.raiseAQuestion(
      {
        piece: null,
        question: 'Which fictional release?',
        options: [],
        who: 'a-person',
        agent: null,
      },
      byAgent(),
    )
    expect(ordinary.ok).toBe(true)
    await host.queueMessage(source, 'move it', world.window)
    expect(world.store.theDecisionOn(source, requestId)?.outcome).toBe('rejected')
    if (ordinary.ok) expect(world.store.theDecisionOn(source, ordinary.question)).toBeNull()
    expect(targetWords()).toHaveLength(0)
    expect(
      (
        await host.decideMoveRequest(
          { sessionId: source, requestId, decision: 'move' },
          world.window,
        )
      ).outcome,
    ).toBe('refused')
  })

  it('a generic answer labelled Move it cannot execute the move', async () => {
    const requestId = await offer()
    await host.respondUserInput(
      source,
      requestId,
      { kind: 'answer', answers: { answer: 'Move it' } },
      world.window,
    )
    expect(targetWords()).toHaveLength(0)
    expect(world.store.theDecisionOn(source, requestId)?.movedTo).toBeUndefined()
  })

  it.each(['app_authored', 'provider_transcript'] as const)(
    'does not bind %s words as a person request',
    (attribution) => {
      const stored = originalMoveRequest(world.store, source)!
      const port: SessionStore = {
        ...world.store,
        newestOfType: () => ({ ...stored, event: { ...stored.event, attribution } }),
      }
      expect(originalMoveRequest(port, source)).toBeNull()
      expect(targetWords()).toHaveLength(0)
    },
  )

  it('refuses self, unknown target and a second outstanding offer', async () => {
    for (const moveTo of [source, 'unknown-conversation']) {
      const result = await host.raiseAQuestion(
        { piece: null, question: 'Move?', options: [], who: 'a-person', agent: null, moveTo },
        byAgent(),
      )
      expect(result.ok).toBe(false)
    }
    await offer()
    const second = await host.raiseAQuestion(
      {
        piece: null,
        question: 'Another move?',
        options: [],
        who: 'a-person',
        agent: null,
        moveTo: target,
      },
      byAgent(),
    )
    expect(second.ok).toBe(false)
    if (!second.ok) expect(second.refusal.permanence).toBe('permanent')
  })

  it('missing attachments refuse without closing the card or queuing a partial request', async () => {
    const file = join(realpathSync(world.folder), 'fictional-missing.md')
    writeFileSync(file, 'Fictional notes.')
    source = await world.aPersonOpens(host, 'source')
    await host.send(source, ORIGINAL, world.window, [
      { path: file, kind: 'file', outsideCwd: false },
    ])
    unlinkSync(file)
    const requestId = await offer()
    const ack = await host.decideMoveRequest(
      { sessionId: source, requestId, decision: 'move' },
      world.window,
    )
    expect(ack.outcome).toBe('refused')
    expect(ack).not.toHaveProperty('destinationLink')
    expect(world.store.theDecisionOn(source, requestId)).toBeNull()
    expect(targetWords()).toHaveLength(0)
    expect(
      world.ledger(source).filter((one) => one.type === 'user_decision' && one.movedTo),
    ).toHaveLength(0)
  })

  it('keeps existing attachment paths and rechecks them before acceptance', async () => {
    const file = join(realpathSync(world.folder), 'fictional-notes.md')
    writeFileSync(file, 'Fictional notes.')
    source = await world.aPersonOpens(host, 'source')
    await host.send(source, ORIGINAL, world.window, [
      { path: file, kind: 'file', outsideCwd: false },
    ])
    const requestId = await offer()
    expect(
      (
        await host.decideMoveRequest(
          { sessionId: source, requestId, decision: 'move' },
          world.window,
        )
      ).outcome,
    ).toBe('moved')
    await expect.poll(() => targetWords().length).toBe(1)
    const moved = targetWords()[0]!
    expect(moved.type === 'user_turn' && moved.attachments?.[0]?.path).toBe(file)
  })

  it('database rollback leaves neither a destination copy nor a source decision', async () => {
    const requestId = await offer()
    const bound = world.store.questionsRaisedIn(source).get(requestId)!.move!
    const faulty: SessionStore = {
      ...world.store,
      append(id, ...args) {
        if (id === source) throw new Error('fictional commit failure')
        world.store.append(id, ...args)
      },
    }
    expect(() =>
      recordMovedRequest(faulty, source, requestId, bound, 'Source', [], PERSON, world.clock++),
    ).toThrow('fictional commit failure')
    expect(world.store.messagesWaitingIn(target)).toHaveLength(0)
    expect(world.store.theDecisionOn(source, requestId)).toBeNull()
    expect(
      world.ledger(source).filter((one) => one.type === 'user_decision' && one.movedTo),
    ).toHaveLength(0)
  })

  it('a moved queue survives a crash sweep while an ordinary stranded queue does not', async () => {
    const requestId = await offer()
    const bound = world.store.questionsRaisedIn(source).get(requestId)!.move!
    await host.closeAll()
    world.store.reopened(target, world.clock++)
    recordMovedRequest(
      world.store,
      source,
      requestId,
      bound,
      'Source',
      [],
      PERSON,
      world.clock++,
      false,
    )
    row(target, {
      type: 'message_queued',
      messageId: 'ordinary-stranded',
      kind: 'work',
      text: 'Ordinary queued words.',
    })
    world.store.settleStrandedMessages(world.clock++, new Set())
    expect(world.store.messagesWaitingIn(target).map((one) => one.text)).toEqual([ORIGINAL])
    expect(world.store.theDecisionOn(source, requestId)?.movedTo?.sessionId).toBe(target)
  })

  it('a changed generation or stored request digest cannot reuse the offer', async () => {
    const requestId = await offer()
    const bound = world.store.questionsRaisedIn(source).get(requestId)!.move!
    const changedGeneration: SessionStore = {
      ...world.store,
      generationOf: () => bound.sourceGeneration + 1,
    }
    expect(() =>
      recordMovedRequest(
        changedGeneration,
        source,
        requestId,
        bound,
        'Source',
        [],
        PERSON,
        world.clock++,
      ),
    ).toThrow(MOVE_WORDS.noOriginal)
    const changedText: SessionStore = {
      ...world.store,
      eventsFrom(id, from, limit) {
        return world.store
          .eventsFrom(id, from, limit)
          .map((one) =>
            one.event.type === 'user_turn'
              ? { ...one, event: { ...one.event, text: 'Different stored words.' } }
              : one,
          )
      },
    }
    expect(() =>
      recordMovedRequest(
        changedText,
        source,
        requestId,
        bound,
        'Source',
        [],
        PERSON,
        world.clock++,
      ),
    ).toThrow(MOVE_WORDS.noOriginal)
    expect(world.store.theDecisionOn(source, requestId)).toBeNull()
    expect(world.store.messagesWaitingIn(target)).toHaveLength(0)
  })

  it('ends the durable queue before an unconfirmed native return and never crash-replays it', async () => {
    const requestId = await offer()
    let finish!: () => void
    world.sendFinishesWait = new Promise<void>((resolve) => {
      finish = resolve
    })
    try {
      expect(
        (
          await host.decideMoveRequest(
            { sessionId: source, requestId, decision: 'move' },
            world.window,
          )
        ).outcome,
      ).toBe('moved')
      await expect.poll(() => world.sent.filter((one) => one.as === 'target').length).toBe(1)
      expect(targetWords()).toHaveLength(0)
      expect(world.store.messagesWaitingIn(target)).toHaveLength(0)
      world.store.settleStrandedMessages(world.clock++, new Set())
      expect(world.store.messagesWaitingIn(target)).toHaveLength(0)
      expect(world.ledger(target).filter((one) => one.type === 'message_unqueued')).toMatchObject([
        { reason: 'handover' },
      ])
      finish()
      await expect.poll(() => targetWords().length).toBe(1)
    } finally {
      finish()
      world.sendFinishesWait = null
    }
  })

  it('an opaque send error remains unconfirmed and a later message does not resend the move', async () => {
    const requestId = await offer()
    world.sendReturnsError = true
    expect(
      (
        await host.decideMoveRequest(
          { sessionId: source, requestId, decision: 'move' },
          world.window,
        )
      ).outcome,
    ).toBe('moved')
    await expect.poll(() => world.sent.filter((one) => one.as === 'target').length).toBe(1)
    await expect
      .poll(() => world.ledger(target).filter((one) => one.type === 'message_unqueued').length)
      .toBe(1)
    expect(targetWords()).toHaveLength(0)
    world.sendReturnsError = false
    const waiting = world.ledger(target).find((one) => one.type === 'permission_request')
    expect(waiting?.type).toBe('permission_request')
    if (waiting?.type !== 'permission_request') throw new Error('The fake turn has no waiting card')
    await host.respondPermission(target, waiting.id, { outcome: 'deny' }, world.window)
    await host.queueMessage(target, 'Another fictional message.', world.window)
    await expect.poll(() => world.sent.filter((one) => one.as === 'target').length).toBe(2)
    const handed = world.sent.filter((one) => one.as === 'target')
    await expect.poll(() => targetWords().length).toBe(1)
    const confirmed = targetWords()[0]!
    expect(confirmed.type === 'user_turn' && confirmed.text).toBe('Another fictional message.')
    expect(handed[1]?.words).toContain('Another fictional message.')
    expect(
      world
        .ledger(target)
        .filter((one) => one.type === 'message_unqueued' && one.reason === 'handover'),
    ).toHaveLength(1)
  })

  it('a failed handover write leaves the move unsent and recoverable', async () => {
    const requestId = await offer()
    const append = world.store.append
    let attempts = 0
    world.store.append = (id, ordinal, event, at) => {
      if (id === target && event.type === 'message_unqueued' && event.reason === 'handover') {
        attempts += 1
        throw new Error('fictional handover write failed')
      }
      append(id, ordinal, event, at)
    }
    try {
      expect(
        (
          await host.decideMoveRequest(
            { sessionId: source, requestId, decision: 'move' },
            world.window,
          )
        ).outcome,
      ).toBe('moved')
      await expect.poll(() => attempts).toBeGreaterThan(0)
      expect(world.sent.filter((one) => one.as === 'target')).toHaveLength(0)
      expect(world.store.messagesWaitingIn(target).map((one) => one.text)).toEqual([ORIGINAL])
      world.store.settleStrandedMessages(world.clock++, new Set())
      expect(world.store.messagesWaitingIn(target)).toHaveLength(1)
    } finally {
      world.store.append = append
    }
  })

  it('a copied movement marker without the matching person receipt is not crash-recovered', async () => {
    await host.closeAll()
    world.store.reopened(target, world.clock++)
    row(target, {
      type: 'message_queued',
      messageId: 'copied-marker',
      kind: 'work',
      text: 'Not a moved request.',
      movedFrom: { sessionId: source, name: 'Source', ordinal: 1, requestId: 'unknown' },
    })
    world.store.settleStrandedMessages(world.clock++, new Set())
    expect(world.store.messagesWaitingIn(target)).toHaveLength(0)
  })

  const endFakeTurn = async (sessionId: string) => {
    const pending = world
      .ledger(sessionId)
      .slice()
      .reverse()
      .find((one) => one.type === 'permission_request')
    if (pending?.type !== 'permission_request') throw new Error('No fake card to settle')
    await host.respondPermission(sessionId, pending.id, { outcome: 'deny' }, world.window)
  }

  it('an early callback cannot offer old A while new B has no committed row', async () => {
    await endFakeTurn(source)
    let finish!: () => void
    world.sendFinishesWait = new Promise<void>((resolve) => {
      finish = resolve
    })
    const delivery = host.send(source, 'The new fictional request B.', world.window)
    try {
      await expect.poll(() => world.sent.filter((one) => one.as === 'source').length).toBe(2)
      expect(sourceWords()).toHaveLength(1)
      const early = await throughFinalTool({
        question: 'Move B?',
        who_answers: 'a-person',
        move_to: target,
      })
      expect(early.structured).toMatchObject({
        outcome: 'refused',
        rail: 'move-offer-is-held',
        permanence: 'while-this-holds',
        retryable: true,
        remedy: 'make-the-same-call-when-this-settles',
      })
      expect(world.store.questionsRaisedIn(source).size).toBe(0)
      expect(targetWords()).toHaveLength(0)
      world.sendFinishesWait = null
      finish()
      await delivery
      const requestId = await offer()
      expect(
        (
          await host.decideMoveRequest(
            { sessionId: source, requestId, decision: 'move' },
            world.window,
          )
        ).outcome,
      ).toBe('moved')
      await expect.poll(() => targetWords().length).toBe(1)
      const moved = targetWords()[0]!
      expect(moved.type === 'user_turn' && moved.text).toBe('The new fictional request B.')
    } finally {
      finish()
      world.sendFinishesWait = null
      await delivery
    }
  })

  it.each(['success', 'error', 'app-success', 'continuation-success'] as const)(
    'a late older handoff %s cannot replace the current request',
    async (outcome) => {
      await endFakeTurn(source)
      let releaseB!: () => void
      let releaseC!: () => void
      world.sendFinishesWait = new Promise<void>((resolve) => {
        releaseB = resolve
      })
      if (outcome === 'continuation-success') await world.handleOf('source').setPlanMode(true)
      const sendingB =
        outcome === 'continuation-success'
          ? host.endPlanMode(source, world.window, 'Older fictional app continuation B.')
          : host.send(
              source,
              'Older fictional request B.',
              outcome === 'app-success' ? THE_APP_ITSELF : world.window,
            )
      const b = sendingB.then(
        () => null,
        (error: unknown) => error,
      )
      let c: Promise<void> | undefined
      try {
        await expect.poll(() => world.sent.filter((one) => one.as === 'source').length).toBe(2)
        await endFakeTurn(source)
        if (outcome === 'error')
          world.sendFinishesWait = new Promise<void>((resolve) => {
            releaseC = resolve
          })
        else world.sendFinishesWait = null
        c = host.send(source, 'Current fictional request C.', world.window)
        await expect.poll(() => world.sent.filter((one) => one.as === 'source').length).toBe(3)
        if (outcome !== 'error') await c
        world.sendReturnsError = outcome === 'error'
        releaseB()
        const result = await b
        world.sendReturnsError = false
        if (outcome === 'error') {
          expect(result).toBeInstanceOf(Error)
          const early = await throughFinalTool({
            question: 'Move C?',
            who_answers: 'a-person',
            move_to: target,
          })
          expect(early.structured).toMatchObject({ rail: 'move-offer-is-held' })
          expect(world.store.questionsRaisedIn(source).size).toBe(0)
          releaseC()
          await c
        } else expect(result).toBeNull()
        const requestId = await offer()
        expect(
          (
            await host.decideMoveRequest(
              { sessionId: source, requestId, decision: 'move' },
              world.window,
            )
          ).outcome,
        ).toBe('moved')
        await expect.poll(() => targetWords().length).toBe(1)
        const delivered = targetWords()[0]!
        expect(delivered.type === 'user_turn' && delivered.text).toBe(
          'Current fictional request C.',
        )
      } finally {
        world.sendReturnsError = false
        world.sendFinishesWait = null
        releaseB()
        releaseC?.()
        await b
        await c
      }
    },
  )

  it('a newly submitted text reply closes an older offer before its native return', async () => {
    const requestId = await offer()
    await endFakeTurn(source)
    let finish!: () => void
    world.sendFinishesWait = new Promise<void>((resolve) => {
      finish = resolve
    })
    const delivery = host.send(source, 'Keep this fictional request here.', world.window)
    try {
      await expect.poll(() => world.sent.filter((one) => one.as === 'source').length).toBe(2)
      expect(sourceWords()).toHaveLength(1)
      expect(world.store.theDecisionOn(source, requestId)?.outcome).toBe('rejected')
      expect(
        (
          await host.decideMoveRequest(
            { sessionId: source, requestId, decision: 'move' },
            world.window,
          )
        ).outcome,
      ).toBe('refused')
      expect(targetWords()).toHaveLength(0)
    } finally {
      world.sendFinishesWait = null
      finish()
      await delivery
    }
  })

  it.each(['notice', 'continuation'] as const)(
    'a current app-authored %s cannot borrow the older person row',
    async (kind) => {
      await endFakeTurn(source)
      if (kind === 'continuation') {
        await world.handleOf('source').setPlanMode(true)
        await host.endPlanMode(source, world.window, 'Fictional app continuation.')
      } else await host.send(source, 'Fictional app notice.', THE_APP_ITSELF)
      const proposed = await host.raiseAQuestion(
        {
          piece: null,
          question: 'Move?',
          options: [],
          who: 'a-person',
          agent: null,
          moveTo: target,
        },
        byAgent(),
      )
      expect(proposed.ok).toBe(false)
      expect(targetWords()).toHaveLength(0)
    },
  )

  it.each(['unchanged', 'grants', 'archive', 'owner'] as const)(
    'held target check revalidates %s before committing',
    async (change) => {
      const requestId = await offer()
      const handle = world.handleOf('target')
      let checked!: () => void
      let finish!: () => void
      const entered = new Promise<void>((resolve) => {
        checked = resolve
      })
      const held = new Promise<boolean>((resolve) => {
        finish = () => resolve(false)
      })
      handle.checkSignIn = async () => {
        handle.checkSignIn = async () => false
        checked()
        return held
      }
      const deciding = host.decideMoveRequest(
        { sessionId: source, requestId, decision: 'move' },
        world.window,
      )
      try {
        await entered
        if (change === 'grants')
          host.setCapabilities('source', { ...DEFAULT_CAPABILITIES, canMessage: 'none' })
        if (change === 'archive') expect((await host.archiveConversation(target)).done).toBe(true)
        if (change === 'owner') {
          await host.close(target, world.window)
          const resumed = await host.resumeSession(target, new RecordingSink('webContents:2'))
          expect(resumed.sessionId).toBe(target)
        }
        finish()
        const ack = await deciding
        if (change === 'unchanged') {
          expect(ack.outcome).toBe('moved')
          await expect.poll(() => targetWords().length).toBe(1)
        } else {
          expect(ack.outcome).toBe('refused')
          expect(world.store.theDecisionOn(source, requestId)).toBeNull()
          expect(world.store.messagesWaitingIn(target)).toHaveLength(0)
          expect(targetWords()).toHaveLength(0)
        }
      } finally {
        finish()
        await deciding
      }
    },
  )

  const throughFinalTool = async (args: Record<string, unknown>) => {
    const final = agentToolsFor(host, source)
    let seen: AgentToolAnswer | undefined
    const wrapped = {
      ...final,
      tools: final.tools.map((tool) =>
        tool.name !== 'ask_question'
          ? tool
          : {
              ...tool,
              call: async (input: Record<string, unknown>) => {
                seen = await tool.call(input)
                return seen
              },
            },
      ),
    }
    const carrier = await answerCodexToolCall(wrapped, {
      namespace: final.server,
      tool: 'ask_question',
      arguments: args,
    })
    expect(seen).toBeDefined()
    expect(carrier.success).toBe(true)
    expect(carrier.contentItems).toEqual([{ type: 'inputText', text: seen!.text }])
    return seen!
  }

  it.each([
    {
      shape: { who_answers: 'an-agent', agent: 'target' },
      problems: ['move_to: use who_answers a-person and leave options and agent out'],
    },
    {
      shape: { who_answers: 'a-person', options: [] },
      problems: ['move_to: use who_answers a-person and leave options and agent out'],
    },
    {
      shape: { who_answers: 'a-person', agent: 'target' },
      problems: [
        'move_to: use who_answers a-person and leave options and agent out',
        'agent: leave it out unless who_answers is an-agent',
      ],
    },
  ])(
    'final tool refuses malformed Move shape without proposing or moving',
    async ({ shape, problems }) => {
      const answered = await throughFinalTool({
        question: 'Fictional move?',
        move_to: target,
        ...shape,
      })
      expect(answered.structured).toMatchObject({
        outcome: 'refused',
        rail: 'malformed-request',
        detail: { problems },
      })
      for (const problem of problems) expect(answered.text).toContain(problem)
      expect(world.store.questionsRaisedIn(source).size).toBe(0)
      expect(world.store.theDecisionOn(source, 'unknown')).toBeNull()
      expect(world.store.messagesWaitingIn(target)).toHaveLength(0)
    },
  )

  it('the final tool offers the real card with one prose carrier', async () => {
    const answered = await throughFinalTool({
      question: 'Fictional move?',
      who_answers: 'a-person',
      move_to: target,
    })
    expect(answered.structured).toMatchObject({ outcome: 'ok', went_to: 'a-person' })
    expect(answered.text).toContain('The Move card is under Waiting on you.')
    expect(world.store.questionsRaisedIn(source).size).toBe(1)
    expect(targetWords()).toHaveLength(0)
  })

  const expectMoveRail = async (
    rail: string,
    permanence: string,
    retryable: boolean,
    remedy: string | null,
    moveTo: string,
  ) => {
    const callerWords = 'Fictional caller-only words: the secret kite is blue.'
    const before = world.ledger(source).filter((one) => one.type === 'tool_refused').length
    const routesBefore = world.store.routedRequestsOf(source)
    const decisionsBefore = world.ledger(source).filter((one) => one.type === 'user_decision')
    const answered = await throughFinalTool({
      question: callerWords,
      who_answers: 'a-person',
      move_to: moveTo,
    })
    const reason =
      rail === 'move-offer-is-held'
        ? 'This request is still being recorded, so it cannot be offered for a move yet.'
        : rail === 'move-offer-needs-a-person'
          ? 'That conversation is unavailable until a person restores it, so this request cannot be offered for a move.'
          : 'This request cannot be offered for a move.'
    expect(answered.structured).toEqual({
      outcome: 'refused',
      rail,
      permanence,
      retryable,
      remedy,
      reason,
      detail: {},
    })
    const prefix = `refused (${rail}): `
    expect(answered.text.startsWith(prefix + reason)).toBe(true)
    expect(answered.text).not.toContain(callerWords)
    const added = world
      .ledger(source)
      .filter((one) => one.type === 'tool_refused')
      .slice(before)
    expect(added).toEqual([
      {
        type: 'tool_refused',
        tool: 'ask_question',
        rail,
        permanence,
        retryable,
        remedy,
        told: { text: answered.text.slice(prefix.length), dropped: 0 },
      },
    ])
    expect(JSON.stringify(added)).not.toContain(callerWords)
    expect(world.store.questionsRaisedIn(source).size).toBe(0)
    expect(world.store.routedRequestsOf(source)).toEqual(routesBefore)
    expect(world.ledger(source).filter((one) => one.type === 'user_decision')).toEqual(
      decisionsBefore,
    )
    expect(world.store.messagesWaitingIn(target)).toHaveLength(0)
    expect(targetWords()).toHaveLength(0)
  }

  it.each(['permanent', 'person-change', 'held'] as const)(
    'the final %s refusal preserves every policy fact and app-only sentence',
    async (kind) => {
      let release: (() => void) | undefined
      let delivery: Promise<void> | undefined
      try {
        if (kind === 'person-change')
          expect((await host.archiveConversation(target)).done).toBe(true)
        if (kind === 'held') {
          await endFakeTurn(source)
          world.sendFinishesWait = new Promise<void>((resolve) => {
            release = resolve
          })
          delivery = host.send(source, 'The pending fictional request.', world.window)
          await expect.poll(() => world.sent.filter((one) => one.as === 'source').length).toBe(2)
        }
        await expectMoveRail(
          kind === 'permanent'
            ? 'move-offer-not-available'
            : kind === 'held'
              ? 'move-offer-is-held'
              : 'move-offer-needs-a-person',
          kind === 'permanent'
            ? 'permanent'
            : kind === 'held'
              ? 'while-this-holds'
              : 'until-a-person-changes-it',
          kind === 'held',
          kind === 'held' ? 'make-the-same-call-when-this-settles' : null,
          kind === 'permanent' ? source : target,
        )
      } finally {
        release?.()
        world.sendFinishesWait = null
        await delivery
      }
    },
  )

  it('provider-transcript stored words cannot be offered through the composed final tool', async () => {
    const read = world.store.eventsFrom
    world.store.eventsFrom = (id, from, limit) =>
      read(id, from, limit).map((one) =>
        one.event.type === 'user_turn'
          ? { ...one, event: { ...one.event, attribution: 'provider_transcript' } }
          : one,
      )
    try {
      await expectMoveRail('move-offer-not-available', 'permanent', false, null, target)
    } finally {
      world.store.eventsFrom = read
    }
  })

  it('the public IPC rejects a non-person channel without changing either conversation', async () => {
    const requestId = await offer()
    const command = {
      kind: 'decideMoveRequest' as const,
      sessionId: source,
      requestId,
      decision: 'move' as const,
    }
    const beforeSource = world.ledger(source)
    const beforeTarget = world.ledger(target)
    const sink = {
      ownerId: world.window.ownerId,
      alive: true,
      aPersonIsBehindIt: false,
      send: world.window.send.bind(world.window),
      sendLiveness: () => {},
    }
    await expect(executeRuntimeCommand(host, sink, command)).rejects.toThrow(MOVE_WORDS.personOnly)
    expect(world.ledger(source)).toEqual(beforeSource)
    expect(world.ledger(target)).toEqual(beforeTarget)
    expect(world.store.theDecisionOn(source, requestId)).toBeNull()
    expect(world.store.messagesWaitingIn(target)).toHaveLength(0)
    expect(targetWords()).toHaveLength(0)
    const accepted = await executeRuntimeCommand(host, world.window, command)
    expect(accepted).toMatchObject({ outcome: 'moved', sessionId: target })
    await expect.poll(() => targetWords().length).toBe(1)
  })

  it('a forged helper actor or changed offer binding records nothing', async () => {
    const requestId = await offer()
    const bound = world.store.questionsRaisedIn(source).get(requestId)!.move!
    expect(() =>
      recordMovedRequest(
        world.store,
        source,
        requestId,
        bound,
        'Source',
        [],
        { who: 'an-agent', agent: source },
        world.clock++,
      ),
    ).toThrow(MOVE_WORDS.personOnly)
    const changed: MoveOffer = { ...bound, destination: source }
    expect(() =>
      recordMovedRequest(
        world.store,
        source,
        requestId,
        changed,
        'Source',
        [],
        PERSON,
        world.clock++,
      ),
    ).toThrow(MOVE_WORDS.ended)
    expect(world.store.messagesWaitingIn(target)).toHaveLength(0)
  })

  describe('the agent a request is moved to is told the person chose to continue there', () => {
    /** One conversation's root, titled by its own agent, and its link as a sentence names it. */
    const titled = async (conversation: string, title: string): Promise<string> => {
      const updated = await host.updateWork(
        {
          piece: null,
          title,
          status: null,
          on: null,
          brief: null,
          close: false,
          resources: [],
        },
        { ownerId: agentCallerId(conversation) },
      )
      expect(updated.ok, JSON.stringify(updated)).toBe(true)
      const root = world.store.rootOf(conversation)
      if (root === null) throw new Error(`${conversation} holds no root`)
      return conversationLink(conversation, `${root.label} · ${title}`)
    }
    /** A line with each link's target taken out: the words a reader sees. */
    const withoutLinkTargets = (line: string): string =>
      line.replace(/\]\(brocrew:\/\/[^)]*\)/g, ']')
    /** The words each turn handed to the agent of `profile` held, oldest first. */
    const heardBy = (profile: string): string[] =>
      world.sent.filter((one) => one.as === profile).map((one) => one.words)
    /** How many turns handed to the agent of `profile` say a request was moved there. */
    const toldOfAMove = (profile: string): number =>
      heardBy(profile).filter((words) => words.includes('moved this request here from')).length
    const moved = async (from: string, requestId: string): Promise<void> => {
      expect(
        (
          await host.decideMoveRequest(
            { sessionId: from, requestId, decision: 'move' },
            world.window,
          )
        ).outcome,
      ).toBe('moved')
    }

    it('the moved turn says where it came from and that the person chose to continue here, once, in front of their words', async () => {
      const fromSource = await titled(source, 'Fictional release notes')
      await moved(source, await offer())
      await expect.poll(() => heardBy('target').length).toBe(1)
      const [words] = heardBy('target')
      const line = movedHereLine(fromSource)
      expect(line).toBe(
        `The person moved this request here from [W1 · Fictional release notes](brocrew://conversation/${encodeURIComponent(source)}). Continue here; don't offer to move it back.`,
      )
      // It names the source by its link, never by its id.
      expect(withoutLinkTargets(line)).not.toContain(source)
      expect(words).toContain(`${line}\n\n${ORIGINAL}`)
      expect(words?.split(line)).toHaveLength(2)
      // …and the person's own words, as the window shows them, carry no line of this app's.
      const turn = targetWords()[0]
      expect(turn?.type === 'user_turn' && turn.text).toBe(ORIGINAL)
      // An ordinary turn says nothing of a move: the source's own words, and the next ones here.
      expect(toldOfAMove('source')).toBe(0)
      await endFakeTurn(target)
      await host.send(target, 'And the fictional changelog too.', world.window)
      await expect.poll(() => heardBy('target').length).toBe(2)
      expect(toldOfAMove('target')).toBe(1)
    })

    it('moved to a conversation nothing runs, the turn its start sends says so, named by the work that names the source then', async () => {
      await titled(source, 'Fictional release notes')
      await host.close(target, world.window)
      const requestId = await offer()
      await moved(source, requestId)
      // Renamed while the request waits for its start: the line names the source as it is now.
      const now = await titled(source, 'Fictional release notes, checked')
      await expect.poll(() => heardBy('target').length).toBe(1)
      expect(heardBy('target')[0]).toContain(`${movedHereLine(now)}\n\n${ORIGINAL}`)
      expect(toldOfAMove('target')).toBe(1)
    })

    it('where the work that names the source cannot be read, the line names it as the move did, and the request still goes', async () => {
      await titled(source, 'Fictional release notes')
      await host.close(target, world.window)
      await moved(source, await offer())
      const queued = world
        .ledger(target)
        .find((one) => one.type === 'message_queued' && one.movedFrom !== undefined)
      const recorded = queued?.type === 'message_queued' ? queued.movedFrom?.name : undefined
      if (recorded === undefined) throw new Error('no moved request held for the target')
      const names = world.store.workThatNames.bind(world.store)
      world.store.workThatNames = (conversation, unread) => {
        if (conversation === source) throw new Error('the fictional disk could not be read')
        return names(conversation, unread)
      }
      try {
        await expect.poll(() => heardBy('target').length).toBe(1)
      } finally {
        world.store.workThatNames = names
      }
      expect(heardBy('target')[0]).toContain(
        `${movedHereLine(conversationLink(source, recorded))}\n\n${ORIGINAL}`,
      )
      expect(withoutLinkTargets(movedHereLine(conversationLink(source, recorded)))).not.toContain(
        source,
      )
    })

    it('a new conversation that gives work to an agent another conversation used gives it that agent’s memory and saved methods', async () => {
      world.anAgent('helper', 'nothing kept')
      const accepted = async (giver: string, title: string): Promise<string> => {
        const given = await world.gives(host, giver, 'helper', { title })
        if (!given.ok) throw new Error(given.refusal.reason)
        return given.owner
      }
      // The related conversation used the helper first; the new one gives it work after.
      const first = await accepted(target, 'Read the fictional changelog')
      const fromTheNewOne = await accepted(source, 'Check the fictional release notes')
      await expect.poll(() => world.startedAs.filter((as) => as === 'helper').length).toBe(2)
      // A conversation of its own, started by the new conversation…
      expect(fromTheNewOne).not.toBe(first)
      // …under the same agent, so its saved methods are read from the same folder at its start…
      expect([first, fromTheNewOne].map((one) => world.store.recordedOne(one)?.profileId)).toEqual([
        'helper',
        'helper',
      ])
      // …and in the same provider home, which holds the agent's memory.
      const homes = world.startedIn.filter((_, at) => world.startedAs[at] === 'helper')
      expect(homes).toHaveLength(2)
      expect(homes[1]).toBe(homes[0])
      expect(homes[0]?.replaceAll('\\', '/')).toMatch(/\/provider-homes\/helper\/claude$/)
    })

    it('moved back the other way, the request says so the other way', async () => {
      const fromSource = await titled(source, 'Fictional release notes')
      const fromTarget = await titled(target, 'Fictional changelog')
      await moved(source, await offer())
      await expect.poll(() => targetWords().length).toBe(1)
      const back = await host.raiseAQuestion(
        {
          piece: null,
          question: 'The source owns this subject.',
          options: [],
          who: 'a-person',
          agent: null,
          moveTo: source,
        },
        { ownerId: agentCallerId(target) },
      )
      if (!back.ok) throw new Error(back.refusal.reason)
      // The source's own turn ends, so what is moved back to it goes in.
      await endFakeTurn(source)
      await moved(target, back.question)
      await expect.poll(() => heardBy('source').length).toBe(2)
      expect(heardBy('source')[1]).toContain(`${movedHereLine(fromTarget)}\n\n${ORIGINAL}`)
      expect(heardBy('target')[0]).toContain(movedHereLine(fromSource))
      expect([toldOfAMove('source'), toldOfAMove('target')]).toEqual([1, 1])
    })

    it('a move the person turns down, or one that is refused, tells nobody of a move', async () => {
      const kept = await offer()
      expect(
        await host.decideMoveRequest(
          { sessionId: source, requestId: kept, decision: 'here' },
          world.window,
        ),
      ).toEqual({ outcome: 'here' })
      const refused = await offer()
      expect(
        (
          await host.decideMoveRequest(
            { sessionId: source, requestId: refused, decision: 'move' },
            byAgent(),
          )
        ).outcome,
      ).toBe('refused')
      await host.send(target, 'A fictional question of its own.', world.window)
      await expect.poll(() => heardBy('target').length).toBe(1)
      expect([toldOfAMove('source'), toldOfAMove('target')]).toEqual([0, 0])
    })
  })
})
