import { readFileSync, writeFileSync } from 'node:fs'
import { isAbsolute, join } from 'node:path'
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

  it('makes ordinary attachments and the full text readable by the recipient', async () => {
    const task = await world.gives(host, target, 'outbound-sender')
    if (!task.ok) throw new Error(task.refusal.reason)
    sender = task.owner
    const attachment = join(world.folder, 'reference.md')
    writeFileSync(attachment, '# Reference\nA fictional test file.\n')
    const text = 'The attachment is important. '.repeat(85)
    const message = await send('message_agent', {
      agent: target,
      piece: task.label,
      text,
      resources: [attachment],
    })
    const receipt = message.structured?.receipt as SendReceipt
    expect(receipt.recorded).toMatchObject({ kind: 'message', taskLabel: task.label })
    expect(receipt.attachments.map((file) => file.name)).toEqual(['reference.md', 'text.txt'])
    const read = agentToolsFor(host, target).tools.find((one) => one.name === 'read_document')
    if (read === undefined) throw new Error('The document tool is missing.')
    const bodies: string[] = []
    for (const item of receipt.attachments) {
      if (!('resource' in item)) throw new Error('The task attachment has no resource ID.')
      bodies.push((await read.call({ resource: item.resource })).text)
    }
    expect(bodies[0]).toContain('A fictional test file.')
    expect(bodies[1]).toContain(text.trimEnd())
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
    expect(received()[1]?.words).toContain(`using asked_by ${sender}, or give cannot_answer with your reason.`)
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

  it('sends one reminder and one notice to the asker while the original question stays open', async () => {
    const asked = await send('ask_question', {
      who_answers: 'an-agent',
      agent: target,
      question: 'Which checklist applies?',
    })
    const id = asked.structured?.question
    if (typeof id !== 'string') throw new Error('The question has no recorded id.')
    const reminders = () =>
      world.ledger(target).filter(
        (event) => event.type === 'message_queued' && event.appNotice === 'an-answer-is-still-owed',
      )
    const notices = () =>
      world.ledger(sender).filter(
        (event) => event.type === 'user_turn' && event.appNotice === 'a-question-stayed-unanswered',
      )
    await waitFor(() => notices().length === 1, 'the asker to receive the unanswered notice')
    expect(notices()[0]).toMatchObject({
      text: expect.stringContaining(`didn't answer question ${id} after a reminder.`),
    })
    expect(reminders()).toHaveLength(1)
    expect(storeQuestionState()).toBe('open')
    expect(host.agentCard(target, world.window, null)?.state).toMatchObject({
      is: 'owes-an-answer',
      stalledQuestion: id,
    })

    await host.closeAll()
    host = world.aHost()
    await host.resumeSession(sender, world.window)
    await host.resumeSession(target, world.window)
    const barrier = 'A new real turn after the reminder and restart.'
    await host.send(target, barrier, world.window)
    await waitFor(
      () => host.agentCard(target, world.window, null)?.state.is === 'owes-an-answer',
      'the answerer to finish another turn',
    )
    expect(world.ledger(target)).toEqual(
      expect.arrayContaining([expect.objectContaining({ type: 'user_turn', text: barrier })]),
    )
    expect(reminders()).toHaveLength(1)
    expect(notices()).toHaveLength(1)
    expect(storeQuestionState()).toBe('open')

    function storeQuestionState() {
      return world.store.routedRequestsOf(sender).find((one) => one.requestId === id)?.state
    }
  })

  it('retracts a held unanswered notice when the asker withdraws the original question', async () => {
    host.claimSession(sender, world.window)
    const gate = Promise.withResolvers<void>()
    world.turnsWait = gate.promise
    try {
      await host.send(sender, 'Hold the asker’s turn open.', world.window)
      world.turnsWait = null
      const asked = await send('ask_question', {
        who_answers: 'an-agent',
        agent: target,
        question: 'Is a printed copy required?',
      })
      const id = asked.structured?.question
      if (typeof id !== 'string') throw new Error('The question has no recorded id.')
      const pendingNotice = () =>
        world.store.messagesWaitingIn(sender).find(
          (one) => one.authorship.appNotice === 'a-question-stayed-unanswered',
        )
      await waitFor(() => pendingNotice() !== undefined, 'the asker note to queue')
      const queued = pendingNotice()
      if (queued === undefined) throw new Error('The notice is absent from the mailbox.')
      expect(queued.asks).toEqual({ asker: sender, requestId: id })

      const withdrawn = await send('withdraw_question', { question: id })
      expect(withdrawn.structured?.outcome).toBe('ok')
      gate.resolve()
      await waitFor(
        () => world.ledger(sender).some(
          (event) => event.type === 'message_unqueued' && event.messageId === queued.messageId,
        ),
        'withdrawal to retract the held notice',
      )
      expect(world.ledger(sender)).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            type: 'message_unqueued',
            messageId: queued.messageId,
            reason: 'retracted',
          }),
        ]),
      )
      expect(world.ledger(sender)).not.toEqual(
        expect.arrayContaining([
          expect.objectContaining({ type: 'user_turn', appNotice: 'a-question-stayed-unanswered' }),
        ]),
      )
    } finally {
      gate.resolve()
      world.turnsWait = null
    }
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
