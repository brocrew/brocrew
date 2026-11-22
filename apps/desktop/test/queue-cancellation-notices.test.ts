import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { agentCallerId, THE_APP_ITSELF } from '../src/main/runtime/conversation-caller'
import { executeRuntimeCommand } from '../src/main/runtime/ipc'
import type { RuntimeHost } from '../src/main/runtime/runtime-host'
import { F093World, RecordingSink, waitFor } from './lib/f093-host'

const notice = 'a-queued-message-was-cancelled'
const heldText = 'Please include the index.'
const speakingAs = (sessionId: string) => ({ ownerId: agentCallerId(sessionId) })

describe('cancelling a held message', () => {
  let world: F093World
  let host: RuntimeHost

  beforeEach(() => {
    world = new F093World()
    host = world.buildHost(false, { startGapMs: 0 })
  })

  afterEach(async () => {
    await world.dispose()
  })

  const notices = (sender: string) =>
    world
      .ledger(sender)
      .flatMap((event) =>
        event.type === 'message_queued' && event.appNotice === notice ? [event.text] : [],
      )

  const expectCancellation = (target: string, messageId: string) => {
    const events = world.ledger(target)
    const endings = events.filter(
      (event) => event.type === 'message_unqueued' && event.messageId === messageId,
    )
    expect(endings).toMatchObject([{ reason: 'cancelled' }])
    expect(
      events.some((event) => event.type === 'user_turn' && event.text.includes(heldText)),
    ).toBe(false)
  }

  const parkedTarget = async (parent?: string) => {
    const { sessionId } = await host.createSession(
      { provider: 'claude', profileId: 'target', cwd: world.project, approvalMode: 'ask' },
      world.window,
      parent === undefined ? null : speakingAs(parent),
    )
    await host.send(sessionId, 'Finish the first turn.', world.window)
    await waitFor(() => world.countOf(sessionId, 'permission_request') === 1, 'the parked turn')
    return sessionId
  }

  const queue = async (
    target: string,
    caller: Parameters<RuntimeHost['queueMessage']>[2],
    text = heldText,
  ) => {
    const result = await host.queueMessage(target, text, caller)
    if (result.outcome !== 'queued') throw new Error('the target did not hold the message')
    return result.messageId
  }

  it.each(['cancelQueuedMessage', 'takeBackAndStop'] as const)(
    '%s cancels for the parent, another conversation and the sender without settling approval',
    async (verb) => {
      const sender = await world.open(host, 'claude', 'sender')
      const parent = await world.open(host, 'claude', 'parent')
      const observer = await world.open(host, 'claude', 'observer')
      const senderProvider = world.end.handed[0]!

      for (const actor of [observer, parent, sender]) {
        const target = await parkedTarget(parent)
        const messageId = await queue(target, speakingAs(sender))
        const takeBack = host[verb](target, messageId, speakingAs(actor))
        if (verb === 'takeBackAndStop') {
          await expect(takeBack).rejects.toThrow(/Message cancelled.*waiting for a person/)
        } else {
          await takeBack
        }
        expectCancellation(target, messageId)
        const events = world.ledger(target).map((event) => event.type)
        expect(events).not.toContain('work_interrupted')
        expect(events).not.toContain('request_interrupted')
        expect(world.end.newest().handle.status()).toBe('waiting_permission')
        expect(notices(sender).at(-1)).toContain(
          `${host.whatToCallTheConversation(actor)}, ${host.nameByItsWork(actor)}, cancelled`,
        )
      }

      const expected = notices(sender)
      expect(expected).toHaveLength(3)
      expect(expected.every((text) => text.endsWith('Reason: no reason given.'))).toBe(true)
      expect(senderProvider.sends).toHaveLength(0)
      expect(world.launchesOf(sender)).toHaveLength(1)

      await host.send(sender, 'Ordinary input.', world.window)
      await waitFor(() => senderProvider.handle.status() === 'idle', 'the sender’s next turn')
      await host.send(sender, 'Another input.', world.window)
      expect(senderProvider.sends).toHaveLength(2)
      for (const text of expected) {
        expect(senderProvider.sends[0]).toContain(text)
        expect(senderProvider.sends[1]).not.toContain(text)
      }
    },
  )

  it('the person can cancel from another window without waking a stopped sender', async () => {
    const sender = await world.open(host, 'claude', 'sender')
    const target = await parkedTarget()
    const messageId = await queue(target, speakingAs(sender))
    await host.close(sender, world.window)
    const otherWindow = new RecordingSink('webContents:2')
    await executeRuntimeCommand(host, otherWindow, {
      kind: 'cancelQueuedMessage',
      sessionId: target,
      messageId,
    })
    expectCancellation(target, messageId)
    expect(notices(sender)).toEqual([
      expect.stringMatching(/^A person cancelled .+ Reason: no reason given\.$/),
    ])
    expect(world.launchesOf(sender)).toHaveLength(1)
    expect(host.sessionIds).not.toContain(sender)

    await host.resumeSession(sender, world.window)
    await host.send(sender, 'Ordinary input after reopening.', world.window)
    expect(world.end.newest().sends).toEqual([expect.stringContaining(notices(sender)[0]!)])
  })

  it('a held item with no origin can be cancelled without a sender notice', async () => {
    const observer = await world.open(host, 'claude', 'observer')
    const target = await parkedTarget()
    const messageId = await queue(target, THE_APP_ITSELF)
    await host.cancelQueuedMessage(target, messageId, speakingAs(observer))
    expectCancellation(target, messageId)
    expect([...notices(observer), ...notices(target)]).toEqual([])
  })

  it('a recovered message can be cancelled without notifying the reconstructed sender', async () => {
    const sender = await world.open(host, 'claude', 'sender')
    const target = await parkedTarget()
    await queue(target, world.window, '/unknown-command holds the first restored turn')
    const messageId = await queue(target, speakingAs(sender))
    expect(world.store.messagesWaitingIn(target).at(-1)?.authorship).toMatchObject({
      relayedFrom: sender,
      says: 'note',
    })
    await host.closeAll()
    host = world.buildHost(false, { startGapMs: 0 })
    await host.resumeSession(target, world.window)
    await waitFor(
      () => world.countOf(target, 'permission_request') === 2,
      'the first restored turn',
    )
    await host.cancelQueuedMessage(target, messageId, speakingAs(sender))
    expectCancellation(target, messageId)
    expect(notices(sender)).toEqual([])
    expect(world.launchesOf(sender)).toHaveLength(1)
  })
})
