import { readFileSync } from 'node:fs'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { agentToolsFor } from '../src/main/runtime/agent-tools'
import { aServiceWorld, type AServiceWorld } from './helpers/a-service-world'

describe('Ask and Message use recorded addresses', () => {
  let world: AServiceWorld
  beforeEach(() => {
    world = aServiceWorld()
  })
  afterEach(async () => {
    await world.cleanUp()
  })

  async function conversations() {
    world.anAgent('first', 'normal')
    world.anAgent('second', 'normal')
    const host = world.aHost()
    const first = await world.aPersonOpens(host, 'first')
    const second = await world.aPersonOpens(host, 'second')
    const root = world.store.rootOf(first)!
    const other = world.store.rootOf(second)!
    function call(tool: string, input: Record<string, unknown>) {
      return agentToolsFor(host, first)
        .tools.find((one) => one.name === tool)!
        .call(input)
    }
    return { host, first, second, root, other, call }
  }

  it('routes a self Ask and retains the label of another conversation’s task', async () => {
    const { first, root, other, call } = await conversations()
    const sent = await call('ask_question', {
      who_answers: 'an-agent',
      agent: root.label,
      piece: other.label,
      question: 'Which outline should this task use?',
    })
    expect(sent.structured).toMatchObject({
      outcome: 'ok',
      question: expect.any(String),
      receipt: { recorded: { kind: 'question', taskLabel: other.label }, recipient: { id: first } },
    })
    const { question } = sent.structured as { question: string }
    expect(world.store.questionsRaisedIn(first).get(question)).toMatchObject({ piece: other.piece })
    expect(world.store.routedRequestsOf(first)).toContainEqual(
      expect.objectContaining({ requestId: question, parent: first }),
    )
  })

  it('records a known third-party task as Message context', async () => {
    const { first, second, other, call } = await conversations()
    const sent = await call('message_agent', {
      agent: second,
      piece: other.label,
      text: 'The notes are ready.',
    })
    expect(sent.structured).toMatchObject({
      outcome: 'ok',
      kind: 'note',
      label: other.label,
      receipt: { recorded: { kind: 'message', taskLabel: other.label }, recipient: { id: second } },
    })
    expect(first).not.toBe(second)
  })

  it('keeps taskless person requests on the root and overflowing choices selectable', async () => {
    const { host, first, root, call } = await conversations()
    const longQuestion = `Which choice? ${'Q'.repeat(2100)}`
    const longChoice = 'A'.repeat(2001)
    const asked = await call('ask_question', {
      who_answers: 'a-person',
      question: longQuestion,
      options: [longChoice, 'Use the shorter plan'],
    })
    expect(asked.structured).toMatchObject({
      outcome: 'ok',
      question: expect.any(String),
      attachments: [
        { resource: expect.any(String), name: 'question.txt', overflowField: 'question' },
        { resource: expect.any(String), name: 'options.txt', overflowField: 'options' },
      ],
    })
    const { question, attachments } = asked.structured as {
      question: string
      attachments: { resource: string }[]
    }
    const body = host.readResource(attachments[0]!.resource)
    const choices = host.readResource(attachments[1]!.resource)
    if (!body.ok || body.content.as !== 'file' || !choices.ok || choices.content.as !== 'file')
      throw new Error('An attached question file is unreadable')
    expect(readFileSync(body.content.path, 'utf8')).toBe(longQuestion)
    expect(readFileSync(choices.content.path, 'utf8')).toBe(
      `Option 1: ${longChoice}\n\nOption 2: Use the shorter plan`,
    )
    const recorded = world.store.questionsRaisedIn(first).get(question)
    expect(recorded).toMatchObject({
      piece: root.piece,
      files: attachments,
      questions: [{ options: [{ label: 'Option 1' }, { label: 'Option 2' }] }],
    })
    expect(recorded?.prompt).toContain('Which choice?')
    expect(recorded?.prompt).toContain('Read the full choices before answering.')
    expect(recorded?.prompt).not.toContain(longQuestion)
    for (const { resource } of attachments) expect(recorded?.prompt).not.toContain(resource)
    const answered = await host.respondUserInput(
      first,
      question,
      { kind: 'answer', answers: { answer: 'Option 2' } },
      world.window,
    )
    expect(answered.outcome).toBe('taken')
    const todo = await call('request_action', { action: 'Check the outline.' })
    expect(todo.structured).toMatchObject({ outcome: 'ok', question: expect.any(String) })
    const { question: actionId } = todo.structured as { question: string }
    expect(world.store.questionsRaisedIn(first).get(actionId)).toMatchObject({ piece: root.piece })
  })
})
