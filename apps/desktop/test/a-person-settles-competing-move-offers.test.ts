import { describe, expect, it } from 'vitest'
import { archivedConversationsIn } from '../src/main/archived-file'
import { MOVE_WORDS } from '../src/shared/move-request'
import { agentCallerId } from '../src/main/runtime/agent-tools'
import { aMoveRequestFixture, ORIGINAL } from './helpers/move-request-world'

describe('a person settles competing move offers', () => {
  const move = aMoveRequestFixture()

  it('refuses self and unknown targets while allowing concurrent offers', async () => {
    const { world, host, source, target, offer } = move()
    for (const moveTo of [source, 'unknown-conversation']) {
      const result = await host.raiseAQuestion(
        { piece: null, question: 'Move?', options: [], who: 'a-person', agent: null, moveTo },
        { ownerId: agentCallerId(source) },
      )
      expect(result.ok).toBe(false)
    }
    const first = await offer()
    const otherTarget = await world.aPersonOpens(host, 'target')
    const second = await offer(otherTarget)
    const accepted = await host.decideMoveRequest(
      { sessionId: source, requestId: first, decision: 'move' },
      world.window,
    )
    expect(accepted).toMatchObject({ outcome: 'moved', sessionId: target })
    const sibling = world.store.routedRequestsOf(source).find((one) => one.requestId === second)
    expect(sibling?.state).not.toBe('open')
    const repeated = await host.decideMoveRequest(
      { sessionId: source, requestId: second, decision: 'move' },
      world.window,
    )
    expect(repeated).toEqual(accepted)
    const late = await host.raiseAQuestion(
      {
        piece: null,
        question: 'Move again?',
        options: [],
        who: 'a-person',
        agent: null,
        moveTo: target,
      },
      { ownerId: agentCallerId(source) },
    )
    expect(late).toMatchObject({ ok: false, refusal: { rail: 'move-offer-not-available' } })
    expect(
      world.ledger(otherTarget).some((event) => event.type === 'message_queued' && event.movedFrom),
    ).toBe(false)
    expect(
      world.ledger(target).filter((event) => event.type === 'message_queued' && event.movedFrom),
    ).toHaveLength(1)
  })

  it.each(['move', 'here'] as const)(
    'keeps the request here when a sibling offer is pressed with %s after Do it here',
    async (decision) => {
      const { world, host, source, target, offer, targetWords } = move()
      const first = await offer()
      const sibling = await offer()
      expect(
        await host.decideMoveRequest(
          { sessionId: source, requestId: first, decision: 'here' },
          world.window,
        ),
      ).toEqual({ outcome: 'here' })
      expect(world.store.theDecisionOn(source, first)?.outcome).toBe('answered')
      expect(world.store.theDecisionOn(source, sibling)?.outcome).toBe('rejected')
      expect(
        await host.decideMoveRequest(
          { sessionId: source, requestId: sibling, decision },
          world.window,
        ),
      ).toEqual({ outcome: 'here' })
      expect(world.store.messagesWaitingIn(target)).toHaveLength(0)
      expect(targetWords()).toHaveLength(0)
    },
  )

  it('rolls back Do it here when recording a sibling decision fails', async () => {
    const { world, host, source, target, offer, targetWords } = move()
    const first = await offer()
    const sibling = await offer()
    const append = world.store.append
    world.store.append = (id, ordinal, event, at) => {
      if (id === source && event.type === 'user_decision' && event.requestId === sibling) {
        throw new Error('fictional sibling decision write failed')
      }
      append(id, ordinal, event, at)
    }
    try {
      await expect(
        host.decideMoveRequest(
          { sessionId: source, requestId: first, decision: 'here' },
          world.window,
        ),
      ).rejects.toThrow('fictional sibling decision write failed')
    } finally {
      world.store.append = append
    }
    expect(world.store.theDecisionOn(source, first)).toBeNull()
    expect(world.store.theDecisionOn(source, sibling)).toBeNull()
    expect(world.store.messagesWaitingIn(target)).toHaveLength(0)
    expect(
      await host.decideMoveRequest(
        { sessionId: source, requestId: sibling, decision: 'move' },
        world.window,
      ),
    ).toMatchObject({ outcome: 'moved', sessionId: target })
    await expect.poll(() => targetWords().length).toBe(1)
  })

  it('brings a destination back from the archive only when the person presses Move', async () => {
    const { world, host, source, target, offer, targetWords } = move()
    expect((await host.archiveConversation(target)).done).toBe(true)
    const archivedAt = host.whenItWasArchived(target)
    expect(archivedAt).not.toBeNull()
    const requestId = await offer()
    expect(world.store.questionsRaisedIn(source).get(requestId)?.move?.destination).toBe(target)
    expect(host.whenItWasArchived(target)).toBe(archivedAt)
    expect(world.store.messagesWaitingIn(target)).toHaveLength(0)
    const accepted = await host.decideMoveRequest(
      { sessionId: source, requestId, decision: 'move' },
      world.window,
    )
    expect(accepted).toMatchObject({ outcome: 'moved', sessionId: target })
    expect(host.whenItWasArchived(target)).toBeNull()
    expect(archivedConversationsIn(world.db).has(target)).toBe(false)
    expect(world.store.theDecisionOn(source, requestId)?.movedTo).toMatchObject({
      sessionId: target,
    })
    await expect
      .poll(targetWords)
      .toMatchObject([{ text: ORIGINAL, movedFrom: { requestId, sessionId: source } }])
  })

  it('keeps the offer open if the archive change fails and moves it once the write works', async () => {
    const { world, host, source, target, offer, targetWords } = move()
    expect((await host.archiveConversation(target)).done).toBe(true)
    const requestId = await offer()
    const input = { sessionId: source, requestId, decision: 'move' as const }
    world.db.exec(`CREATE TEMP TRIGGER reject_archive_removal BEFORE DELETE ON archived_conversation
      BEGIN SELECT RAISE(ABORT, 'fixture refused archive removal'); END`)
    try {
      expect(await host.decideMoveRequest(input, world.window)).toEqual({
        outcome: 'refused',
        reason: MOVE_WORDS.notRecorded,
      })
      expect(host.whenItWasArchived(target)).not.toBeNull()
      expect(archivedConversationsIn(world.db).has(target)).toBe(true)
      expect(world.store.theDecisionOn(source, requestId)).toBeNull()
      expect(world.store.messagesWaitingIn(target)).toHaveLength(0)
      expect(targetWords()).toHaveLength(0)
    } finally {
      world.db.exec('DROP TRIGGER reject_archive_removal')
    }
    const moved = await host.decideMoveRequest(input, world.window)
    expect(moved).toMatchObject({ outcome: 'moved', sessionId: target })
    expect(await host.decideMoveRequest(input, world.window)).toEqual(moved)
    await expect.poll(targetWords).toHaveLength(1)
  })
})
