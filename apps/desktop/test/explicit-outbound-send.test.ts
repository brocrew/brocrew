import { readFileSync } from 'node:fs'
import { isAbsolute } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { agentToolsFor, type ToolName } from '../src/main/runtime/agent-tools'
import type { RuntimeHost } from '../src/main/runtime/runtime-host'
import type { SendReceipt } from '../src/shared/tool-outcome'
import { aServiceWorld, type AServiceWorld } from './helpers/a-service-world'
import { waitFor } from './lib/f093-host'

describe('explicit outbound sends', () => {
  let world: AServiceWorld
  let host: RuntimeHost
  let sender: string
  let target: string

  beforeEach(async () => {
    world = aServiceWorld()
    world.anAgent('giver', 'normal')
    world.anAgent('outbound-sender', 'normal')
    world.anAgent('outbound-target', 'normal')
    host = world.aHost()
    const giver = await world.aPersonOpens(host, 'giver')
    sender = await world.aRecordedWorker(giver, 'outbound-sender')
    await host.resumeSession(sender, world.window)
    target = await world.aPersonOpens(host, 'outbound-target')
  })

  afterEach(async () => world.cleanUp())

  async function send(name: ToolName, args: Record<string, unknown>) {
    const tool = agentToolsFor(host, sender).tools.find((one) => one.name === name)
    if (tool === undefined) throw new Error(`Missing tool ${name}`)
    return tool.call(args)
  }

  it('delivers a taskless message and keeps the full words in its sender’s folder', async () => {
    expect(world.store.piecesOwnedBy(sender)).toHaveLength(0)
    const text = 'Details '.repeat(300) + 'last line'
    const sent = await send('message_agent', { agent: target, text })
    const receipt = sent.structured?.receipt as SendReceipt
    expect(receipt.recorded).toMatchObject({ kind: 'message', taskLabel: null })
    expect(receipt.recipient).toMatchObject({ id: target, state: { kind: 'started' } })
    const [file] = receipt.attachments
    if (file === undefined || !('path' in file)) throw new Error('The complete text was not saved.')
    expect(isAbsolute(file.path)).toBe(true)
    expect(readFileSync(file.path, 'utf8')).toBe(text)
    expect(sent.text).toContain(`Delivered to conversation ${receipt.recipient.address}`)
    expect(world.sent.find((one) => one.as === 'outbound-target')?.words).toContain(
      `The full text is saved at ${file.path}: read the file.`,
    )
  })

  it('records a busy Message and an Ask in order before either is delivered', async () => {
    const gate = Promise.withResolvers<void>()
    world.turnsWait = gate.promise
    try {
      await host.send(target, 'Hold this turn open.', world.window)
      const message = await send('message_agent', { agent: target, text: 'Record this first.' })
      const question = await send('ask_question', {
        who_answers: 'an-agent',
        agent: target,
        question: 'Then record this question?',
      })
      const messageReceipt = message.structured?.receipt as SendReceipt
      expect(messageReceipt.recipient.state.kind).toBe('queued')
      expect(message.text).toBe(
        `Held for conversation ${messageReceipt.recipient.address} · ${messageReceipt.recipient.title}: it is working; it goes out when it is free.`,
      )
      const askReceipt = question.structured?.receipt as SendReceipt
      expect(askReceipt.recipient.state.kind).toBe('queued')
      expect(question.text).toBe(
        `Question ${askReceipt.recorded.id} queued for conversation ${askReceipt.recipient.address} · ${askReceipt.recipient.title}. The answer arrives as a message.`,
      )
      const [heldMessage, heldQuestion] = world.store.messagesWaitingIn(target)
      expect(heldMessage?.messageId).toBe(messageReceipt.recorded.id)
      expect(heldQuestion?.asks).toEqual({ asker: sender, requestId: askReceipt.recorded.id })
    } finally {
      gate.resolve()
    }
  })

  it('starts the answerer’s next turn with an unanswered recorded question', async () => {
    const asked = await send('ask_question', {
      who_answers: 'an-agent',
      agent: target,
      question: 'Does the report cover the old routing?',
    })
    const id = asked.structured?.question
    if (typeof id !== 'string') throw new Error('The question has no recorded id.')
    const received = () =>
      world.sent.filter((one) => one.as === 'outbound-target' && one.words.includes(id))
    await waitFor(() => received().length >= 2, 'the unanswered question to start the next turn')
    expect(received()[1]?.words).toContain(`Use asked_by ${sender} with this question id.`)
    expect(world.store.routedRequestsOf(sender)).toEqual(
      expect.arrayContaining([expect.objectContaining({ requestId: id, state: 'open' })]),
    )
    const answer = agentToolsFor(host, target).tools.find((one) => one.name === 'answer_question')
    if (answer === undefined) throw new Error('The answer tool is missing.')
    const result = await answer.call({
      asked_by: sender,
      question: id,
      answers: [{ part: 'answer', answer: ['Yes.'] }],
    })
    expect(result.structured?.outcome).toBe('ok')
    expect(world.store.routedRequestsOf(sender).find((one) => one.requestId === id)?.state).toBe(
      'answered',
    )
  })

  it('keeps an archived recipient archived and reports the first failed wake of a recorded question', async () => {
    expect(await host.archiveConversation(target)).toMatchObject({ done: true })
    const archivedAt = host.whenItWasArchived(target)
    expect(archivedAt).toEqual(expect.any(Number))
    await host.close(target, world.window)
    world.resumesFailFor = 'outbound-target'
    const asked = await send('ask_question', {
      who_answers: 'an-agent',
      agent: target,
      question: 'Does the recorded scope include this step?',
    })
    const receipt = asked.structured?.receipt as SendReceipt
    expect(asked.structured?.question).toBe(receipt.recorded.id)
    expect(receipt.recipient).toMatchObject({ id: target, state: { kind: 'cannot-run' } })
    expect(world.store.questionsRaisedIn(sender).has(receipt.recorded.id)).toBe(true)
    const held = world.store.messagesWaitingIn(target)
    expect(held.map((row) => row.text).join('\n')).toContain(
      `Use asked_by ${sender} with this question id.`,
    )
    expect(held.map((row) => row.text).join('\n')).toContain(receipt.recorded.id)
    expect(asked.text).toContain(`Question ${receipt.recorded.id} is recorded`)
    expect(host.whenItWasArchived(target)).toBe(archivedAt)
  })

  it('returns a short receipt for a question put in front of the person', async () => {
    const task = await world.gives(host, target, 'outbound-sender')
    if (!task.ok) throw new Error('The parent did not give work.')
    sender = task.owner
    const asked = await send('ask_question', {
      who_answers: 'a-person',
      piece: task.label,
      question: 'Do you want the short label?',
    })
    const id = asked.structured?.question
    expect(typeof id).toBe('string')
    expect(asked.text).toBe(`Question ${id} recorded for the person. The answer arrives as a message.`)
    const fullAction = 'Check the name. '.repeat(150)
    const action = await send('request_action', { piece: task.label, action: fullAction })
    expect(action.text).toContain('The to-do is under Waiting on you')
    expect(action.text).toContain('the full text is attached')
    expect(action.structured?.attachments).toEqual([
      expect.objectContaining({ resource: expect.any(String), name: 'action.txt' }),
    ])

  })
})
