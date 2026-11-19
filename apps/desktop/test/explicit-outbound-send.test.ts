import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { isAbsolute, join } from 'node:path'
import type { SessionMachine } from '@brobot2/runtime'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { agentToolsFor, type ToolName } from '../src/main/runtime/agent-tools'
import type { RuntimeHost } from '../src/main/runtime/runtime-host'
import type { SendReceipt } from '../src/shared/tool-outcome'
import { theMessagesOf } from '../src/shared/runtime-ipc'
import { resourcesRoot } from '../src/main/resources/resources'
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
    const attachment = join(world.folder, 'appendix.txt')
    writeFileSync(attachment, 'The appendix.')
    const tree = resourcesRoot(world.folder)
    const kept = () => existsSync(tree) ? readdirSync(tree).sort() : []
    const before = kept()
    const text = 'Details '.repeat(300) + 'last line'
    const sent = await send('message_agent', { agent: target, text, resources: [attachment] })
    const receipt = sent.structured?.receipt as SendReceipt
    expect(receipt.recorded).toMatchObject({ kind: 'message', taskLabel: null })
    expect(receipt.recipient).toMatchObject({ id: target, state: { kind: 'started' } })
    const [copy, file] = receipt.attachments
    if (copy === undefined || !('path' in copy)) throw new Error('The attachment was not copied.')
    expect(copy.path).not.toBe(attachment)
    expect(readFileSync(copy.path, 'utf8')).toBe('The appendix.')
    expect(kept()).toEqual(before)
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

    await send('message_agent', { agent: target, piece: task.label, text, resources: [attachment] })
    for (const name of ['reference.md', 'text.txt']) {
      const copies = world.store.resourcesOf(task.piece).filter((file) => file.name === name)
      expect(copies).toHaveLength(2)
      expect(new Set(copies.map((file) => file.sha256)).size).toBe(2)
    }
  })

  it('records a busy Message and an Ask in order before either is delivered', async () => {
    const gate = Promise.withResolvers<void>()
    const batch = Promise.withResolvers<void>()
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
      const reminderRows = () =>
        world.ledger(target).filter(
          (event) => event.type === 'message_queued' && event.appNotice === 'an-answer-is-still-owed',
        )
      expect(reminderRows()).toHaveLength(0)
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
      expect(reminderRows()).toHaveLength(0)
    } finally {
      world.turnsWait = null
      gate.resolve()
      batch.resolve()
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
    const list = agentToolsFor(host, target).tools.find((one) => one.name === 'list_questions')
    if (list === undefined) throw new Error('The question list tool is missing.')
    const listed = await list.call({})
    expect(listed.structured?.questions).toContainEqual(
      expect.objectContaining({ question: id, state: 'open', delivery: 'stalled after a reminder' }),
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
      const initial = Promise.withResolvers<void>()
      const replay = Promise.withResolvers<void>()
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
        await waitFor(() => handover.mock.calls.length === 2, 'the first batch to reach the handover')
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
          world.store.queuedPromptProgress(
            sessionId,
            reminder.messageId,
            'an-answer-is-still-owed',
          )
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
        const firstTurn = world.ledger(sessionId).slice(beforeReopen).find(
          (event) => event.type === 'user_turn',
        )
        expect(firstTurn).toMatchObject({
          parts: [
            expect.objectContaining({ text: note }),
            expect.objectContaining({ text: reminder.text, appNotice: 'an-answer-is-still-owed' }),
          ],
        })
        const notices = () =>
          world.ledger(sender).filter(
            (event) => event.type === 'user_turn' && event.appNotice === 'a-question-stayed-unanswered',
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
          world.ledger(sessionId).filter(
            (event) => event.type === 'message_queued' && event.appNotice === 'an-answer-is-still-owed',
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
    const gate = Promise.withResolvers<void>()
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
      expect(world.sent.some((one) => one.as === 'outbound-target' && one.words.includes(next))).toBe(
        true,
      )
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
    'keeps an unanswered question without waking a %s turn the person stopped',
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
        expect(world.store.routedRequestsOf(sender).find((one) => one.requestId === id)?.state).toBe(
          'open',
        )
        const reminders = () =>
          world.ledger(sessionId).filter(
            (event) => event.type === 'message_queued' && event.appNotice === 'an-answer-is-still-owed',
          )
        expect(reminders()).toHaveLength(0)
        expect(world.sent.filter((one) => one.as === profile && one.words.includes(id))).toHaveLength(1)
        await waitFor(
          () => stopRows().some(
            (event) =>
              event.type === 'message_unqueued' &&
              event.messageId === receipt.recorded.id &&
              event.reason === 'sent',
          ),
          'the ordinary queued message to flush after Stop',
        )
        expect(world.sent.filter((one) => one.as === profile && one.words.includes(mail))).toHaveLength(1)
        expect(reminders()).toHaveLength(0)
        providerTurn.machine.completeTurn('completed')
        await waitFor(() => reminders().length === 1, 'a reminder after the next ordinary turn')
      } finally {
        stopping.mockRestore()
        drive.mockRestore()
      }
    },
  )

  it.each(['withdrawn', 'answered'] as const)(
    'retracts a rehydrated unanswered notice once the question is %s',
    async (ended) => {
      host.claimSession(sender, world.window)
      const gate = Promise.withResolvers<void>()
      const keepBusy: (() => void)[] = []
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
        expect(queued.unansweredQuestion).toEqual({ asker: sender, requestId: id })
        expect(queued).not.toHaveProperty('asks')

        const firstAsker = world.handleOf('outbound-sender')
        await host.closeAll()
        gate.resolve()
        host = world.aHost()
        await host.resumeSession(target, world.window)
        world.onResumed = (profile, handle) => {
          if (profile !== 'outbound-sender') return
          const busy = vi.spyOn(handle, 'status').mockReturnValue('working')
          keepBusy.push(() => busy.mockRestore())
        }
        await host.resumeSession(sender, world.window)
        expect(world.handleOf('outbound-sender')).not.toBe(firstAsker)
        expect(pendingNotice()?.messageId).toBe(queued.messageId)
        expect(world.store.routedRequestsOf(sender).find((one) => one.requestId === id)?.state).toBe(
          'open',
        )

        if (ended === 'withdrawn') {
          const withdrawn = await send('withdraw_question', { question: id })
          expect(withdrawn.structured?.outcome).toBe('ok')
        } else {
          const answer = agentToolsFor(host, target).tools.find((one) => one.name === 'answer_question')
          if (answer === undefined) throw new Error('The answer tool is missing.')
          const answered = await answer.call({
            asked_by: sender,
            question: id,
            answers: [{ part: 'answer', answer: ['Yes.'] }],
            interrupt: false,
          })
          expect(answered.structured?.outcome).toBe('ok')
        }
        expect(world.store.routedRequestsOf(sender).find((one) => one.requestId === id)?.state).toBe(
          ended,
        )
        keepBusy.pop()?.()
        await host.send(sender, 'A new turn after the settlement.', world.window)
        await waitFor(
          () => world.ledger(sender).some(
            (event) => event.type === 'message_unqueued' && event.messageId === queued.messageId,
          ),
          'settlement to retract the held notice',
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
        const delivered = world.ledger(sender).flatMap(
          (event) => event.type === 'user_turn' ? theMessagesOf(event) : [],
        )
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

  it('keeps an unanswered notice in an archived asker’s mailbox until an explicit reopen', async () => {
    const gate = Promise.withResolvers<void>()
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
        world.store.messagesWaitingIn(sender).find(
          (one) => one.authorship.appNotice === 'a-question-stayed-unanswered',
        )
      await waitFor(() => notice() !== undefined, 'the unanswered notice to be kept')
      const queued = notice()
      expect(queued?.unansweredQuestion).toEqual({ asker: sender, requestId: id })

      await host.send(target, 'The answerer can take another turn.', world.window)
      expect(world.resumesAsked).toBe(resumesBefore)
      expect(host.whenItWasArchived(sender)).toBe(archivedAt)
      expect(notice()?.messageId).toBe(queued?.messageId)
      expect(host.restoreConversation(sender)).toMatchObject({ done: true })
      await host.resumeSession(sender, world.window)
      await waitFor(
        () => world.sent.some((one) => one.as === 'outbound-sender' && one.words.includes(id)),
        'the notice to go after an explicit reopen',
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

  it('keeps the same Message record after a failed wake and delivers it once on reopen', async () => {
    await host.close(target, world.window)
    world.resumesFailFor = 'outbound-target'
    const text = 'Keep this message across the failed wake.'
    const sent = await send('message_agent', { agent: target, text })
    const receipt = sent.structured?.receipt as SendReceipt
    expect(receipt.recipient).toMatchObject({ id: target, state: { kind: 'cannot-run' } })
    const id = receipt.recorded.id
    expect(world.store.messagesWaitingIn(target)).toEqual([
      expect.objectContaining({ messageId: id, text }),
    ])
    world.resumesFailFor = null
    await host.resumeSession(target, world.window)
    await waitFor(
      () => world.ledger(target).some(
        (event) => event.type === 'message_unqueued' && event.messageId === id && event.reason === 'sent',
      ),
      'the recorded message to go after reopen',
    )
    expect(world.store.messagesWaitingIn(target)).toEqual([])
    expect(world.sent.filter((one) => one.as === 'outbound-target' && one.words.includes(text))).toHaveLength(1)
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
