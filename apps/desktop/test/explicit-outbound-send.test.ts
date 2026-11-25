import { mkdirSync, readFileSync, readdirSync, unlinkSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { ResumeError, type SessionMachine } from '@brobot2/runtime'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { agentToolsFor, type ToolName } from '../src/main/runtime/agent-tools'
import type { RuntimeHost } from '../src/main/runtime/runtime-host'
import type { SendReceipt } from '../src/shared/tool-outcome'
import { theMessagesOf } from '../src/shared/runtime-ipc'
import { resourcesRoot } from '../src/main/resources/resources'
import { describeConversation } from '../src/main/runtime/conversation-address'
import { textOfTheKeptFile } from './lib/kept-file-named'
import { aServiceWorld, type AServiceWorld } from './helpers/a-service-world'
import { anOutboundWorld } from './helpers/an-outbound-world'
import { deferred } from './helpers/quit-open-list-cases'
import { theAsk } from './helpers/the-ask'
import { waitFor } from './lib/f093-host'
import { expectNoQuestionWake } from './lib/question-wake'
import { recordHistoricalReplacement } from './lib/historical-replacement'

describe('explicit outbound sends', () => {
  let world: AServiceWorld
  let host: RuntimeHost
  let sender: string
  let target: string

  beforeEach(async () => {
    world = aServiceWorld()
    ;({ host, sender, target } = await anOutboundWorld(world))
  })

  afterEach(async () => world.cleanUp())

  async function send(name: ToolName, args: Record<string, unknown>) {
    const tool = agentToolsFor(host, sender).tools.find((one) => one.name === name)
    if (tool === undefined) throw new Error(`Missing tool ${name}`)
    return tool.call(args)
  }

  it('delivers a self-addressed Message with its sender and action ID', async () => {
    const text = 'Read these notes in this conversation.'
    const sent = await send('message_agent', { agent: sender, text })
    const receipt = sent.structured?.receipt as SendReceipt
    expect(receipt.recipient).toMatchObject({ id: sender, state: { kind: 'started' } })
    expect(receipt.recorded.id).toBe(sent.structured?.messageAct)
    expect(world.ledger(sender)).toContainEqual(
      expect.objectContaining({
        type: 'message_sent',
        to: sender,
        messageAct: receipt.recorded.id,
      }),
    )
    const parts = world
      .ledger(sender)
      .flatMap((row) => (row.type === 'user_turn' ? theMessagesOf(row) : []))
    expect(parts).toContainEqual(expect.objectContaining({ text, relayedFrom: sender }))
  })

  it('keeps taskless Message attachments once in the app resource store', async () => {
    expect(world.store.piecesOwnedBy(sender)).toHaveLength(0)
    const attachment = join(world.folder, 'Appendix #1.txt')
    writeFileSync(attachment, 'The appendix.')
    const sentRoot = join(resourcesRoot(world.folder), 'sent')
    const workspaceCopies = () =>
      readdirSync(world.folder).filter((name) => name.startsWith('brocrew-'))
    expect(workspaceCopies()).toEqual([])
    const text = 'Details '.repeat(300) + 'last line'
    const args = { agent: target, text, resources: [attachment] }
    mkdirSync(dirname(sentRoot), { recursive: true })
    writeFileSync(sentRoot, 'A file is in the way.')
    const refused = await send('message_agent', args)
    expect(refused.structured?.rail).toBe('resource-could-not-be-kept')
    expect(world.ledger(sender).some((event) => event.type === 'message_sent')).toBe(false)
    expect(workspaceCopies()).toEqual([])
    unlinkSync(sentRoot)
    const sent = await send('message_agent', args)
    const receipt = sent.structured?.receipt as SendReceipt
    expect(receipt.recorded).toMatchObject({ kind: 'message', taskLabel: null })
    expect(receipt.recipient).toMatchObject({ id: target, state: { kind: 'started' } })
    const [copy, file] = receipt.attachments
    if (copy === undefined || !('path' in copy)) throw new Error('The attachment was not copied.')
    expect(dirname(dirname(copy.path))).toBe(sentRoot)
    expect(copy.name).toBe('Appendix #1.txt')
    expect(readFileSync(attachment, 'utf8')).toBe('The appendix.')
    expect(readFileSync(copy.path, 'utf8')).toBe('The appendix.')
    if (file === undefined || !('path' in file)) throw new Error('The complete text was not saved.')
    expect(dirname(dirname(file.path))).toBe(sentRoot)
    expect(readFileSync(file.path, 'utf8')).toBe(text)
    expect(sent.text).toContain(`Delivered to conversation ${receipt.recipient.address}`)
    expect(world.sent.find((one) => one.as === 'outbound-target')?.words).toContain(
      `The full text is saved at ${file.path}: read the file.`,
    )
    const repeated = await send('message_agent', args)
    expect(repeated.structured?.receipt).toMatchObject({ attachments: receipt.attachments })
    writeFileSync(attachment, 'Revised appendix.')
    const forwarded = await send('message_agent', { ...args, resources: [copy.path] })
    expect(forwarded.structured?.receipt).toMatchObject({ attachments: receipt.attachments })
    expect(readFileSync(copy.path, 'utf8')).toBe('The appendix.')
    expect(readdirSync(sentRoot)).toHaveLength(2)
    expect(workspaceCopies()).toEqual([])
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
      bodies.push(textOfTheKeptFile((await read.call({ resource: item.resource })).text))
    }
    expect(bodies[0]).toContain('A fictional test file.')
    expect(bodies[1]).toContain(text.trimEnd())

    await send('message_agent', { agent: target, piece: task.label, text, resources: [attachment] })
    for (const name of ['reference.md', 'text.txt']) {
      const copies = world.store.resourcesOf(task.piece).filter((file) => file.name === name)
      expect(copies).toHaveLength(2)
      expect(new Set(copies.map((file) => file.sha256)).size).toBe(2)
    }
  })

  it('records a busy Message and an Ask in order before either is delivered', async () => {
    const gate = deferred()
    const batch = deferred()
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
      expect(heldQuestion?.asks).toEqual(theAsk(world.store, sender, askReceipt.recorded.id))
      expectNoQuestionWake(world.ledger(target))
      world.turnsWait = batch.promise
      gate.resolve()
      const body = 'Then record this question?'
      const deliveredBatch = () =>
        world.sent.find((one) => one.as === 'outbound-target' && one.words.includes(body))
      await waitFor(() => deliveredBatch() !== undefined, 'the original Ask and held Message to go')
      const recipient = `conversation ${askReceipt.recipient.address} · ${askReceipt.recipient.title}`
      expect(deliveredBatch()?.words).toContain(`), in your ${recipient}.\n`)
      expect(deliveredBatch()?.words).toContain(
        `asks you ${askReceipt.recorded.id} in your ${recipient}.\n`,
      )
      expectNoQuestionWake(world.ledger(target))
    } finally {
      world.turnsWait = null
      gate.resolve()
      batch.resolve()
    }
  })

  it('starts the answerer’s next turn with an unanswered recorded question', async () => {
    const answerer = await world.aRecordedWorker(sender, 'outbound-target')
    await host.resumeSession(answerer, world.window)
    expect(world.store.rootOf(answerer)).toBeNull()
    expect(world.store.piecesOwnedBy(answerer)).toHaveLength(0)
    const question = 'Does the report cover the old routing? '.repeat(70).trimEnd()
    const asked = await send('ask_question', {
      who_answers: 'an-agent',
      agent: answerer,
      question,
    })
    const id = asked.structured?.question
    if (typeof id !== 'string') throw new Error('The question has no recorded id.')
    const [questionFile] = (asked.structured?.receipt as SendReceipt).attachments
    if (questionFile === undefined || !('path' in questionFile))
      throw new Error('Missing question file.')
    expect(questionFile.name).toBe('question.txt')
    expect(readFileSync(questionFile.path, 'utf8')).toBe(question)
    const received = () =>
      world.sent.filter((one) => one.as === 'outbound-target' && one.words.includes(id))
    await waitFor(() => received().length >= 2, 'the unanswered question to start the next turn')
    expect(received()[1]?.words).toContain(
      `using asked_by ${sender}, or give cannot_answer with your reason.`,
    )
    expect(world.store.routedRequestsOf(sender)).toEqual(
      expect.arrayContaining([expect.objectContaining({ requestId: id, state: 'open' })]),
    )
    const answer = agentToolsFor(host, answerer).tools.find((one) => one.name === 'answer_question')
    if (answer === undefined) throw new Error('The answer tool is missing.')
    const fullAnswer = 'Yes. '.repeat(500) + 'The last sentence.'
    const result = await answer.call({
      asked_by: sender,
      question: id,
      answers: [{ part: 'answer', answer: [fullAnswer] }],
    })
    expect(result.structured?.outcome).toBe('ok')
    const answerReceipt = result.structured?.receipt as SendReceipt
    const [answerFile] = answerReceipt.attachments
    expect(result.structured?.resources).toEqual(answerReceipt.attachments)
    if (answerFile === undefined || !('path' in answerFile)) throw new Error('Missing answer file.')
    expect(readFileSync(answerFile.path, 'utf8')).toBe(fullAnswer)
    expect(world.store.routedRequestsOf(sender).find((one) => one.requestId === id)?.state).toBe(
      'answered',
    )
  })

  it('moves an undelivered Ask with the same question and the successor’s receiver header', async () => {
    const successor = await world.aPersonOpens(host, 'outbound-target')
    const gate = deferred()
    world.turnsWait = gate.promise
    try {
      await host.send(target, 'Hold this conversation open.', world.window)
      const prompt = 'Which of these two plans applies?'
      const attachment = join(world.folder, 'plans.txt')
      writeFileSync(attachment, 'The two plans.')
      const result = await send('ask_question', {
        who_answers: 'an-agent',
        agent: target,
        question: prompt,
        options: ['Original', 'Revised'],
        resources: [attachment],
      })
      const receipt = result.structured?.receipt as SendReceipt
      expect(receipt.recipient).toMatchObject({ id: target, state: { kind: 'queued' } })
      const id = receipt.recorded.id
      const [copy] = receipt.attachments
      if (copy === undefined || !('path' in copy)) throw new Error('Missing question attachment.')
      const original = world.store
        .messagesWaitingIn(target)
        .find((row) => row.asks?.requestId === id)
      if (original === undefined) throw new Error('The queued Ask is missing.')
      await host.closeAll()
      unlinkSync(attachment)
      world.turnsWait = null
      gate.resolve()
      recordHistoricalReplacement(world.store, target, successor, world.clock++)
      host = world.aHost()
      const starting = host as unknown as {
        startForADelivery(id: string, window: null): Promise<string>
      }
      expect(await starting.startForADelivery(target, null)).toBe(successor)
      const delivered = () =>
        world
          .ledger(successor)
          .find((event) => event.type === 'user_turn' && event.text.includes(prompt))
      await waitFor(() => delivered() !== undefined, 'the moved Ask to reach the successor')
      const line = describeConversation(world.store, successor, false).line
      expect(delivered()).toMatchObject({
        text: expect.stringContaining(`asks you ${id} in your ${line}.`),
      })
      expect(original.asks).toEqual(theAsk(world.store, sender, id))
      expect(world.ledger(successor)).toContainEqual(
        expect.objectContaining({
          type: 'message_queued',
          asks: theAsk(world.store, sender, id),
        }),
      )
      expect(original.text).toContain(`in your conversation ${receipt.recipient.address} ·`)
      expect(delivered()).toMatchObject({ text: expect.stringContaining(copy.path) })
      expect(readFileSync(copy.path, 'utf8')).toBe('The two plans.')
      expect(world.store.questionsRaisedIn(sender).get(id)).toMatchObject({
        prompt,
        files: [copy],
        questions: [
          expect.objectContaining({ options: [{ label: 'Original' }, { label: 'Revised' }] }),
        ],
      })
    } finally {
      world.turnsWait = null
      gate.resolve()
    }
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
      world
        .ledger(target)
        .filter(
          (event) =>
            event.type === 'message_queued' && event.appNotice === 'an-answer-is-still-owed',
        )
    const notices = () =>
      world
        .ledger(sender)
        .filter(
          (event) =>
            event.type === 'user_turn' && event.appNotice === 'a-question-stayed-unanswered',
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
    const list = agentToolsFor(host, target).tools.find((one) => one.name === 'list_questions')
    if (list === undefined) throw new Error('The question list tool is missing.')
    const listed = await list.call({})
    expect(listed.structured?.questions).toContainEqual(
      expect.objectContaining({
        question: id,
        state: 'open',
        delivery: 'stalled after a reminder',
      }),
    )

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

  it.each(['codex', 'claude'] as const)(
    'folds the %s reminder from the first batched turn after reopen',
    async (provider) => {
      const profile = 'outbound-replay-target'
      world.anAgent(profile, 'normal', provider)
      const { sessionId } = await host.createSession(
        { provider, profileId: profile, cwd: world.folder, approvalMode: 'auto' },
        world.window,
      )
      const handle = world.handleOf(profile)
      const handover = vi.spyOn(handle, 'send')
      const initial = deferred()
      const replay = deferred()
      world.turnsWait = initial.promise
      try {
        const asked = await send('ask_question', {
          who_answers: 'an-agent',
          agent: sessionId,
          question: 'Is the earlier draft still needed?',
        })
        const id = asked.structured?.question
        if (typeof id !== 'string') throw new Error('The question has no recorded id.')
        expect(asked.structured?.receipt).toMatchObject({
          recipient: { id: sessionId, state: { kind: 'started' } },
        })
        const note = 'The appendix is ready in the same folder.'
        const held = await send('message_agent', { agent: sessionId, text: note })
        expect(held.structured?.delivery).toBe('queued')

        // Refuse the first batch before the provider takes either part.
        handover.mockRejectedValueOnce(new Error('The provider did not take the batch.'))
        world.turnsWait = null
        initial.resolve()
        await waitFor(
          () => handover.mock.calls.length === 2,
          'the first batch to reach the handover',
        )
        expect(handover.mock.calls[1]?.[0]).toContain(note)
        expect(handover.mock.calls[1]?.[0]).toContain(`Question ${id} from conversation`)
        const waiting = () => world.store.messagesWaitingIn(sessionId)
        const [heldNote, reminder] = waiting()
        if (reminder === undefined) throw new Error('The queued reminder is missing.')
        expect(heldNote?.text).toBe(note)
        expect(reminder).toMatchObject({
          asks: { asker: sender, requestId: id },
          authorship: { appNotice: 'an-answer-is-still-owed' },
        })
        const progress = () =>
          world.store.queuedPromptProgress(sessionId, reminder.messageId, 'an-answer-is-still-owed')
        expect(progress()).toBe('pending')
        await host.closeAll()
        expect(progress()).toBe('pending')
        expect(waiting().map((row) => row.messageId)).toEqual([
          heldNote?.messageId,
          reminder.messageId,
        ])

        host = world.aHost()
        await host.resumeSession(sender, world.window)
        const beforeReopen = world.ledger(sessionId).length
        world.turnsWait = replay.promise
        await host.resumeSession(sessionId, world.window)
        await waitFor(() => progress() === 'running', 'the reopened batch to have a recorded turn')
        expect(world.handleOf(profile)).not.toBe(handle)
        expect(world.store.recordedOne(sessionId)?.provider).toBe(provider)
        const firstTurn = world
          .ledger(sessionId)
          .slice(beforeReopen)
          .find((event) => event.type === 'user_turn')
        expect(firstTurn).toMatchObject({
          parts: [
            expect.objectContaining({ text: note }),
            expect.objectContaining({ text: reminder.text, appNotice: 'an-answer-is-still-owed' }),
          ],
        })
        const notices = () =>
          world
            .ledger(sender)
            .filter(
              (event) =>
                event.type === 'user_turn' && event.appNotice === 'a-question-stayed-unanswered',
            )
        expect(notices()).toHaveLength(0)
        world.turnsWait = null
        replay.resolve()
        await waitFor(() => progress() === 'turn-ended', 'the recorded reminder turn to close')
        await waitFor(() => notices().length === 1, 'one unanswered notice to reach the asker')
        expect(notices()[0]).toMatchObject({
          text: expect.stringContaining(`didn't answer question ${id} after a reminder.`),
        })
        expect(
          world
            .ledger(sessionId)
            .filter(
              (event) =>
                event.type === 'message_queued' && event.appNotice === 'an-answer-is-still-owed',
            ),
        ).toHaveLength(1)
        const question = world.store.routedRequestsOf(sender).find((row) => row.requestId === id)
        expect(question?.state).toBe('open')
      } finally {
        world.turnsWait = null
        initial.resolve()
        replay.resolve()
        handover.mockRestore()
      }
    },
  )

  it('delivers held messages even if the reminder read fails at the turn boundary', async () => {
    const handle = world.handleOf('outbound-target')
    const gate = deferred()
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const progress = vi.spyOn(world.store, 'queuedPromptProgress')
    world.turnsWait = gate.promise
    try {
      const question = await send('ask_question', {
        who_answers: 'an-agent',
        agent: target,
        question: 'Is this the final version?',
      })
      expect(question.structured?.outcome).toBe('ok')
      const text = 'Send this along after the question.'
      const message = await send('message_agent', { agent: target, text })
      expect(message.structured?.delivery).toBe('queued')
      const fault = 'The reminder progress could not be read.'
      progress.mockImplementationOnce(() => {
        throw new Error(fault)
      })
      world.turnsWait = null
      gate.resolve()
      await waitFor(
        () => world.sent.some((one) => one.as === 'outbound-target' && one.words.includes(text)),
        'the held message to go after the reminder read fails',
      )
      expect(progress).toHaveBeenCalledWith(target, expect.any(String), 'an-answer-is-still-owed')
      expect(warn).toHaveBeenCalledWith(expect.stringContaining(fault))
      const next = 'The same provider still takes new words.'
      await waitFor(() => handle.status() === 'idle', 'the held message’s turn to finish')
      await host.send(target, next, world.window)
      expect(world.handleOf('outbound-target')).toBe(handle)
      expect(
        world.sent.some((one) => one.as === 'outbound-target' && one.words.includes(next)),
      ).toBe(true)
    } finally {
      world.turnsWait = null
      gate.resolve()
      progress.mockRestore()
      warn.mockRestore()
    }
  })

  it.each([
    ['codex', 'completed'],
    ['claude', 'interrupted'],
  ] as const)(
    'notifies the asker once and keeps reminders off a %s turn the person stopped',
    async (provider, terminal) => {
      const profile = 'outbound-stop-target'
      world.anAgent(profile, 'normal', provider)
      const { sessionId } = await host.createSession(
        { provider, profileId: profile, cwd: world.folder, approvalMode: 'ask' },
        world.window,
      )
      const handle = world.handleOf(profile)
      const providerTurn = handle as unknown as {
        machine: SessionMachine
        driveTurn(text: string, turnId: number): Promise<void>
      }
      const drive = vi.spyOn(providerTurn, 'driveTurn').mockResolvedValue(undefined)
      // Drive the actual Stop through the host with the terminal each provider reports.
      const stopping = vi.spyOn(handle, 'interrupt').mockImplementationOnce(async () => {
        providerTurn.machine.completeTurn(terminal)
      })
      try {
        const asked = await send('ask_question', {
          who_answers: 'an-agent',
          agent: sessionId,
          question: 'Does this include the previous version?',
        })
        const id = asked.structured?.question
        if (typeof id !== 'string') throw new Error('The question has no recorded id.')
        await waitFor(() => handle.status() === 'working', 'the question turn to open')
        const mail = 'Keep this message for the next turn.'
        const queued = await send('message_agent', { agent: sessionId, text: mail })
        expect(queued.structured?.delivery).toBe('queued')
        const receipt = queued.structured?.receipt as SendReceipt
        expect(world.store.messagesWaitingIn(sessionId)).toContainEqual(
          expect.objectContaining({ messageId: receipt.recorded.id, text: mail }),
        )
        const beforeStop = world.ledger(sessionId).length
        await host.interrupt(sessionId, world.window)
        const stopRows = () => world.ledger(sessionId).slice(beforeStop)
        await waitFor(
          () => stopRows().some((event) => event.type === 'status' && event.state === 'idle'),
          'the stopped turn to send its terminal status',
        )
        expect(stopRows()).toEqual(
          expect.arrayContaining([
            expect.objectContaining({ type: 'work_interrupted', by: 'a-person' }),
            expect.objectContaining({ type: 'turn', state: terminal }),
          ]),
        )
        expect(world.store.lastEndedTurn(sessionId)?.who).toBe('a-person')
        const notices = () =>
          world
            .ledger(sender)
            .filter(
              (event) =>
                event.type === 'message_queued' && event.appNotice === 'an-answerer-was-stopped',
            )
        const deliveredNotices = () =>
          world
            .ledger(sender)
            .flatMap((row) =>
              row.type === 'user_turn'
                ? theMessagesOf(row).filter((part) => part.appNotice === 'an-answerer-was-stopped')
                : [],
            )
        await waitFor(
          () => deliveredNotices().length > 0,
          'the person Stop notice to reach the asker',
        )
        const { address, title } = describeConversation(world.store, sessionId, false)
        expect(deliveredNotices().map((part) => part.text)).toEqual([
          `Conversation ${address} · ${title} was stopped by the person before answering question ${id}.`,
        ])
        expect(notices()).toHaveLength(1)
        expect(
          world.store.routedRequestsOf(sender).find((one) => one.requestId === id)?.state,
        ).toBe('open')
        const reminders = () =>
          world
            .ledger(sessionId)
            .filter(
              (event) =>
                event.type === 'message_queued' && event.appNotice === 'an-answer-is-still-owed',
            )
        expect(reminders()).toHaveLength(0)
        expect(
          world.sent.filter((one) => one.as === profile && one.words.includes(id)),
        ).toHaveLength(1)
        await waitFor(
          () =>
            stopRows().some(
              (event) =>
                event.type === 'message_unqueued' &&
                event.messageId === receipt.recorded.id &&
                event.reason === 'sent',
            ),
          'the ordinary queued message to flush after Stop',
        )
        expect(
          world.sent.filter((one) => one.as === profile && one.words.includes(mail)),
        ).toHaveLength(1)
        expect(reminders()).toHaveLength(0)
        providerTurn.machine.completeTurn('completed')
        await waitFor(() => reminders().length === 1, 'a reminder after the next ordinary turn')
        await waitFor(() => handle.status() === 'working', 'the reminder turn to start')
        const reminderStop = world.ledger(sessionId).length
        stopping.mockImplementationOnce(async () => {
          providerTurn.machine.completeTurn(terminal)
        })
        await host.interrupt(sessionId, world.window)
        await waitFor(
          () =>
            world
              .ledger(sessionId)
              .slice(reminderStop)
              .some((event) => event.type === 'status' && event.state === 'idle'),
          'the reminder turn to stop',
        )
        expect(reminders()).toHaveLength(1)
        expect(notices()).toHaveLength(1)
      } finally {
        stopping.mockRestore()
        drive.mockRestore()
      }
    },
  )

  it('keeps the question open without a Stop notice after a person cancels an approval', async () => {
    await host.setApprovalMode(target, 'ask', world.window)
    const asked = await send('ask_question', {
      who_answers: 'an-agent',
      agent: target,
      question: 'Is a copy required?',
    })
    const id = asked.structured?.question
    if (typeof id !== 'string') throw new Error('The question has no recorded id.')
    const approval = () => world.ledger(target).find((event) => event.type === 'permission_request')
    await waitFor(() => approval() !== undefined, 'the answerer’s permission card')
    const card = approval()
    if (card === undefined || card.type !== 'permission_request') throw new Error('No card.')
    const beforeCancel = world.ledger(target).length
    await expect(
      host.respondPermission(target, card.id, { outcome: 'cancel' }, world.window),
    ).resolves.toEqual({ outcome: 'taken' })
    const cancelled = () => world.ledger(target).slice(beforeCancel)
    await waitFor(
      () => cancelled().some((event) => event.type === 'status' && event.state === 'idle'),
      'the cancelled turn to send its terminal status',
    )
    expect(cancelled()).toContainEqual(
      expect.objectContaining({
        type: 'user_decision',
        outcome: 'cancel',
        by: { who: 'a-person' },
      }),
    )
    expect(cancelled().some((event) => event.type === 'work_interrupted')).toBe(false)
    expect(world.store.lastEndedTurn(target)?.who).toBe('a-person')
    const route = world.store.routedRequestsOf(sender).find((one) => one.requestId === id)
    expect(route?.state).toBe('open')

    const message = agentToolsFor(host, target).tools.find((one) => one.name === 'message_agent')
    if (message === undefined) throw new Error('Missing Message tool.')
    const sent = await message.call({ agent: sender, text: 'A later message for the asker.' })
    expect(sent.structured?.receipt).toBeDefined()
    expectNoQuestionWake(world.ledger(sender))
    expectNoQuestionWake(cancelled())
  })

  it.each(['withdrawn', 'answered', 'answered after moving'] as const)(
    'retracts a rehydrated unanswered notice once the question is %s',
    async (ended) => {
      const gate = deferred()
      const keepBusy: (() => void)[] = []
      let receiver = sender
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
          world.store
            .messagesWaitingIn(receiver)
            .find((one) => one.authorship.appNotice === 'a-question-stayed-unanswered')
        await waitFor(() => pendingNotice() !== undefined, 'the asker note to queue')
        const queued = pendingNotice()
        if (queued === undefined) throw new Error('The notice is absent from the mailbox.')
        expect(queued.unansweredQuestion).toEqual({ asker: sender, requestId: id })
        expect(queued).not.toHaveProperty('asks')

        const firstAsker = world.handleOf('outbound-sender')
        if (ended === 'answered after moving') {
          receiver = await world.aPersonOpens(host, 'outbound-sender')
          await host.setApprovalMode(receiver, 'auto', world.window)
        }
        await host.closeAll()
        gate.resolve()
        if (receiver !== sender)
          recordHistoricalReplacement(world.store, sender, receiver, world.clock++)
        host = world.aHost()
        await host.resumeSession(target, world.window)
        world.onResumed = (profile, handle) => {
          if (profile !== 'outbound-sender') return
          const busy = vi.spyOn(handle, 'status').mockReturnValue('working')
          keepBusy.push(() => busy.mockRestore())
        }
        let noticeId = queued.messageId
        if (receiver !== sender) {
          const starting = host as unknown as {
            startForADelivery(id: string, window: null): Promise<string>
          }
          expect(await starting.startForADelivery(sender, null)).toBe(receiver)
          const moved = pendingNotice()
          if (moved === undefined) throw new Error('The moved notice is missing.')
          expect(moved.unansweredQuestion).toEqual(queued.unansweredQuestion)
          noticeId = moved.messageId
          keepBusy.pop()?.()
          await host.closeAll()
          host = world.aHost()
          await host.resumeSession(target, world.window)
        }
        await host.resumeSession(receiver, world.window)
        expect(world.handleOf('outbound-sender')).not.toBe(firstAsker)
        expect(pendingNotice()?.messageId).toBe(noticeId)
        expect(
          world.store.routedRequestsOf(sender).find((one) => one.requestId === id)?.state,
        ).toBe('open')

        if (ended === 'withdrawn') {
          const withdrawn = await send('withdraw_question', { question: id })
          expect(withdrawn.structured?.outcome).toBe('ok')
        } else {
          const answer = agentToolsFor(host, target).tools.find(
            (one) => one.name === 'answer_question',
          )
          if (answer === undefined) throw new Error('The answer tool is missing.')
          const answered = await answer.call({
            asked_by: sender,
            question: id,
            answers: [{ part: 'answer', answer: ['Yes.'] }],
            interrupt: false,
          })
          expect(answered.structured?.outcome).toBe('ok')
        }
        expect(
          world.store.routedRequestsOf(sender).find((one) => one.requestId === id)?.state,
        ).toBe(ended === 'withdrawn' ? 'withdrawn' : 'answered')
        keepBusy.pop()?.()
        await host.send(receiver, 'A new turn after the settlement.', world.window)
        await waitFor(
          () =>
            world
              .ledger(receiver)
              .some((event) => event.type === 'message_unqueued' && event.messageId === noticeId),
          'settlement to retract the held notice',
        )
        expect(world.ledger(receiver)).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              type: 'message_unqueued',
              messageId: noticeId,
              reason: 'retracted',
            }),
          ]),
        )
        const delivered = world
          .ledger(receiver)
          .flatMap((event) => (event.type === 'user_turn' ? theMessagesOf(event) : []))
        expect(delivered.some((part) => part.appNotice === 'a-question-stayed-unanswered')).toBe(
          false,
        )
      } finally {
        keepBusy.pop()?.()
        world.onResumed = null
        gate.resolve()
        world.turnsWait = null
      }
    },
  )

  it('keeps an unanswered notice in an archived asker’s mailbox until Restore', async () => {
    const gate = deferred()
    world.turnsWait = gate.promise
    try {
      const asked = await send('ask_question', {
        who_answers: 'an-agent',
        agent: target,
        question: 'Does the list include the earlier record?',
      })
      const id = asked.structured?.question
      if (typeof id !== 'string') throw new Error('The question has no recorded id.')
      expect(await host.archiveConversation(sender)).toMatchObject({ done: true })
      const archivedAt = host.whenItWasArchived(sender)
      expect(archivedAt).toEqual(expect.any(Number))
      const resumesBefore = world.resumesAsked
      world.turnsWait = null
      gate.resolve()
      const notice = () =>
        world.store
          .messagesWaitingIn(sender)
          .find((one) => one.authorship.appNotice === 'a-question-stayed-unanswered')
      await waitFor(() => notice() !== undefined, 'the unanswered notice to be kept')
      const queued = notice()
      expect(queued?.unansweredQuestion).toEqual({ asker: sender, requestId: id })

      await host.send(target, 'The answerer can take another turn.', world.window)
      expect(world.resumesAsked).toBe(resumesBefore)
      expect(host.whenItWasArchived(sender)).toBe(archivedAt)
      expect(notice()?.messageId).toBe(queued?.messageId)
      expect(host.restoreConversation(sender)).toMatchObject({ done: true })
      expect(host.whenItWasArchived(sender)).toBeNull()
      await waitFor(
        () => world.sent.some((one) => one.as === 'outbound-sender' && one.words.includes(id)),
        'the notice to go when Restore opens the asker',
      )
      expect(world.resumesAsked).toBe(resumesBefore + 1)
    } finally {
      world.turnsWait = null
      gate.resolve()
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

  it.each([false, true])(
    'shows the same Message disposition after waking a stopped recipient, sender closes: %s',
    async (senderCloses) => {
      await host.close(target, world.window)
      const gate = deferred()
      const resume = host.resumeSession.bind(host)
      const wake = vi.spyOn(host, 'resumeSession').mockImplementationOnce(async (...args) => {
        await gate.promise
        return resume(...args)
      })
      const text = 'Continue with these notes.'
      const sending = send('message_agent', { agent: target, text })
      let queuedId: string | undefined
      try {
        await waitFor(() => wake.mock.calls.length === 1, 'the recipient wake to be requested')
        expect(wake.mock.calls[0]?.[0]).toBe(target)
        const [queued] = world.store.messagesWaitingIn(target)
        expect(queued).toMatchObject({ text, messageId: expect.any(String) })
        queuedId = queued?.messageId
        if (senderCloses) {
          await host.close(sender, world.window)
          expect(host.sessionIds).not.toContain(sender)
        }
      } finally {
        gate.resolve()
        wake.mockRestore()
      }
      const sent = await sending
      const receipt = sent.structured?.receipt as SendReceipt
      const act = sent.structured?.messageAct
      expect(act).toEqual(expect.any(String))
      expect(receipt.recorded.id).toBe(queuedId)
      expect(receipt.recipient).toMatchObject({ id: target, state: { kind: 'started' } })
      expect(sent.text).toContain('Delivered to conversation')
      expect(world.ledger(target)).toContainEqual(
        expect.objectContaining({
          type: 'message_unqueued',
          messageId: queuedId,
          reason: 'sent',
        }),
      )
      expect(
        world
          .ledger(sender)
          .filter((event) => event.type === 'message_sent' && event.messageAct === act),
      ).toEqual([
        expect.objectContaining({
          delivery: 'sent',
          to: target,
          messageId: queuedId,
          onBehalfOfAPerson: true,
        }),
      ])
    },
  )

  it('keeps the same Message record after a failed wake and delivers it once on reopen', async () => {
    await host.close(target, world.window)
    const ref = world.store.find(target)?.ref
    if (ref === undefined) throw new Error('the stopped recipient has no provider reference')
    const wake = vi
      .spyOn(host, 'resumeSession')
      .mockRejectedValueOnce(
        new ResumeError(ref, 'the provider could not reopen this conversation'),
      )
    const text = 'Keep this message across the failed wake.'
    const sent = await send('message_agent', { agent: target, text })
    expect(wake).toHaveBeenCalledExactlyOnceWith(target, null, null, undefined, 'not-read')
    const receipt = sent.structured?.receipt as SendReceipt
    expect(receipt.recipient).toMatchObject({ id: target, state: { kind: 'cannot-run' } })
    const id = receipt.recorded.id
    expect(world.store.messagesWaitingIn(target)).toEqual([
      expect.objectContaining({ messageId: id, text }),
    ])
    expect(
      world
        .ledger(sender)
        .filter(
          (event) =>
            event.type === 'message_sent' && event.messageAct === sent.structured?.messageAct,
        ),
    ).toEqual([expect.objectContaining({ delivery: 'queued', to: target, messageId: id })])
    wake.mockRestore()
    await host.resumeSession(target, world.window)
    await waitFor(
      () =>
        world
          .ledger(target)
          .some(
            (event) =>
              event.type === 'message_unqueued' &&
              event.messageId === id &&
              event.reason === 'sent',
          ),
      'the recorded message to go after reopen',
    )
    expect(world.store.messagesWaitingIn(target)).toEqual([])
    expect(
      world.sent.filter((one) => one.as === 'outbound-target' && one.words.includes(text)),
    ).toHaveLength(1)
  })

  it.each(['own work', 'named work'])('returns person-request receipts on %s', async (work) => {
    expect(world.store.rootOf(sender)).toBeNull()
    const task = work === 'named work' ? await world.gives(host, target, 'outbound-sender') : null
    if (task?.ok === false) throw new Error('The parent did not give work.')
    if (task !== null) sender = task.owner
    const piece = task?.label
    const fullAction = 'Check the name. '.repeat(150)
    const action = await send('request_action', { piece, action: fullAction })
    expect(action.structured?.outcome).toBe('ok')
    expect(action.text).toContain('The to-do is under Waiting on you')
    expect(action.text).toContain('the full text is attached')
    const files = action.structured?.attachments
    expect(files).toEqual([
      expect.objectContaining({ resource: expect.any(String), name: 'action.txt' }),
    ])
    const actionId = action.structured?.question
    if (typeof actionId !== 'string') throw new Error('The to-do has no recorded id.')
    const recorded = world.store.questionsRaisedIn(sender).get(actionId)
    const expectedPiece = task?.piece ?? world.store.rootOf(sender)?.piece
    expect(expectedPiece).toEqual(expect.any(String))
    expect(recorded).toMatchObject({
      piece: expectedPiece,
      prompt: fullAction.slice(0, 2000),
      action: { files },
    })
    const asked = await send('ask_question', { who_answers: 'a-person', piece, question: 'Label?' })
    const id = asked.structured?.question
    expect(typeof id).toBe('string')
    expect(asked.text).toBe(
      `Question ${id} recorded for the person. The answer arrives as a message.`,
    )
  })
})
