import { readFileSync } from 'node:fs'
import { z } from 'zod'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  agentToolsFor,
  refusalIn,
  refuseTool,
  type ToolName,
} from '../src/main/runtime/agent-tools'
import { answerInWords } from '../src/main/runtime/agent-tool-answer-words'
import { refuseReply } from '../src/main/runtime/reply-rails'
import type { RuntimeHost } from '../src/main/runtime/runtime-host'
import { aServiceWorld, type AServiceWorld } from './helpers/a-service-world'

const remedy =
  'Put the rest in a Markdown file, a page, an image, a PDF or any other file and name its path in resource_paths; the piece stays open. Nothing was shortened for you.'

describe('tool refusals name their limits and fields without keeping caller text', () => {
  let world: AServiceWorld
  let host: RuntimeHost
  let caller: string
  let worker: string
  let piece: string
  beforeEach(async () => {
    world = aServiceWorld()
    world.anAgent('caller', 'normal')
    world.anAgent('worker', 'normal')
    host = world.aHost()
    caller = await world.aPersonOpens(host, 'caller')
    const given = await world.gives(host, caller, 'worker')
    if (!given.ok) throw new Error('fictional give failed')
    worker = given.owner
    piece = given.piece
  })
  afterEach(async () => {
    await world.cleanUp()
  })
  const tool = (name: ToolName) =>
    agentToolsFor(host, worker).tools.find((one) => one.name === name)!
  const refusals = () => world.ledger(worker).filter((event) => event.type === 'tool_refused')

  it('publishes reply and question overflow and the choice limit', () => {
    expect(z.globalRegistry.get(tool('reply_to_parent').input.summary!)?.description).toBe(
      'What the conversation that gave you this needs to read. Anything over 2,000 characters arrives as a file the reader is pointed to.',
    )
    expect(z.globalRegistry.get(tool('ask_question').input.question!)?.description).toBe(
      'What you need answered, in your own words. Anything over 2,000 characters arrives as a file the reader is pointed to. It shows under Waiting on you with Markdown: **bold**, lists, `code` for ids and paths, and links to files.',
    )
    expect(z.globalRegistry.get(tool('request_action').input.action!)?.description).toBe(
      'What the person should do, in plain words. Anything over 2,000 characters arrives as a file the reader is pointed to.',
    )
    expect(z.globalRegistry.get(tool('ask_question').input.options!)?.description).toBe(
      'The choices you are offering, at most 2,000 characters in total. Leave it out for a free answer.',
    )
  })

  it('records a long reply once with the full summary attached', async () => {
    const summary = 'The first result. '.padEnd(2_000, 'x') + ' The final result.'
    const done = await tool('reply_to_parent').call({ piece, outcome: 'done', summary })
    expect(done.structured).toMatchObject({ outcome: 'ok', state: 'answered' })
    const [resource] = world.store.resourcesOf(piece)
    if (resource === undefined) throw new Error('the summary had no attachment')
    expect(done.text.match(/2,018/g)).toHaveLength(1)
    expect(done.text).toContain(`the full text is attached as summary.txt (${resource.resource})`)
    expect(done.text).not.toContain('The final result.')
    const read = host.readResource(resource.resource)
    if (!read.ok || read.content.as !== 'file')
      throw new Error('the summary attachment is unreadable')
    expect(readFileSync(read.content.path, 'utf8')).toBe(summary)
    const replies = world.ledger(worker).filter((event) => event.type === 'work_replied')
    expect(replies).toHaveLength(1)
    expect(replies[0]?.summary).toBe(
      `${summary.slice(0, 2_000)} The full text is attached as ${resource.resource}: read it with read_document.`,
    )
    expect(refusals()).toEqual([])
  })

  it('keeps a reply of exactly 2,000 UTF-16 code units inline', async () => {
    const summary = '🟩'.repeat(1_000)
    const yes = await tool('reply_to_parent').call({ piece, outcome: 'done', summary })
    expect(yes.structured).toMatchObject({ outcome: 'ok', resources: [] })
    const reply = world.ledger(worker).find((event) => event.type === 'work_replied')
    expect(reply?.summary).toBe(summary)
  })

  it('uses the shared-limit fallback when no measured length is available', () => {
    for (const was of [undefined, Number.NaN, Infinity, -1, 1.5]) {
      expect(
        refuseReply('summary-too-long', { ...(was === undefined ? {} : { was }) }).reason,
      ).toBe(`Not handed back: the summary exceeds 1,280 characters. ${remedy}`)
    }
  })

  it.each(['ask_question', 'request_action'] as const)(
    'keeps all long %s text in the file its recipient is shown',
    async (name) => {
      const intro = 'Please read this checklist. '
      const text = `${intro}${'a'.repeat(2_000)} The final item is in the file.`
      const args =
        name === 'ask_question'
          ? { piece, who_answers: 'a-person', question: text }
          : { piece, action: text }
      const sent = await tool(name).call(args)
      expect(sent.structured).toMatchObject({ outcome: 'ok' })
      const [resource] = world.store.resourcesOf(piece)
      if (resource === undefined) throw new Error('the long text had no attachment')
      expect(sent.text).toContain(
        `the full text is attached as ${resource.name} (${resource.resource})`,
      )
      const result = host.readResource(resource.resource)
      if (!result.ok || result.content.as !== 'file')
        throw new Error('the attachment is unreadable')
      expect(readFileSync(result.content.path, 'utf8')).toBe(text)

      const row = host
        .questionsForAPerson()
        .rows.find((one) => one.request.requestId === sent.structured?.question)
      expect(row?.asked?.prompt).toContain(intro)
      expect(row?.asked?.prompt).toContain(resource.resource)
      expect(row?.asked?.prompt).not.toContain('The final item is in the file.')
      if (name === 'request_action') {
        expect(row?.action?.files).toContainEqual({
          resource: resource.resource,
          name: resource.name,
        })
      }
    },
  )

  const problems: { name: string; args: Record<string, unknown>; expected: string }[] = [
    {
      name: 'unknown recipient',
      args: { who_answers: 'PRIVATE_RECIPIENT' },
      expected: 'who_answers: required; expected one of the-parent, a-person, an-agent',
    },
    {
      name: 'missing question',
      args: { question: undefined },
      expected: 'question: required; expected non-empty text',
    },
    { name: 'empty question', args: { question: '' }, expected: 'question: must not be empty' },
    {
      name: 'null question',
      args: { question: null },
      expected: 'question: expected text, got null',
    },
    {
      name: 'list question',
      args: { question: ['PRIVATE_VALUE'] },
      expected: 'question: expected text, got a list',
    },
    {
      name: 'number question',
      args: { question: 42 },
      expected: 'question: expected text, got a number',
    },
    {
      name: 'boolean question',
      args: { question: true },
      expected: 'question: expected text, got true or false',
    },
    {
      name: 'object question',
      args: { question: { PRIVATE_VALUE: 'hidden' } },
      expected: 'question: expected text, got an object',
    },
    { name: 'empty piece', args: { piece: '' }, expected: 'piece: must not be empty' },
    {
      name: 'wrong piece type',
      args: { piece: 42 },
      expected: 'piece: expected text, got a number',
    },
    {
      name: 'missing agent',
      args: { who_answers: 'an-agent' },
      expected: 'agent: required when who_answers is an-agent; expected non-empty text',
    },
    {
      name: 'empty agent',
      args: { who_answers: 'an-agent', agent: '' },
      expected: 'agent: must not be empty',
    },
    {
      name: 'wrong agent type',
      args: { who_answers: 'an-agent', agent: ['PRIVATE_VALUE'] },
      expected: 'agent: expected text, got a list',
    },
    {
      name: 'agent for another route',
      args: { agent: 'PRIVATE_AGENT' },
      expected: 'agent: leave it out unless who_answers is an-agent',
    },
    {
      name: 'choices as text',
      args: { options: 'PRIVATE_CHOICES' },
      expected: 'options: expected a list of text choices',
    },
    {
      name: 'nontext choice',
      args: { options: [{ PRIVATE_CHOICE: 'hidden' }] },
      expected: 'options: expected a list of text choices',
    },
    {
      name: 'long choices together',
      args: { options: ['x'.repeat(1000), 'y'.repeat(1001)] },
      expected: 'options: at most 2,000 characters in total; got 2,001',
    },
    {
      name: 'empty move target',
      args: { who_answers: 'a-person', move_to: '' },
      expected: 'move_to: expected non-empty text of at most 200 characters',
    },
    {
      name: 'wrong move type',
      args: { who_answers: 'a-person', move_to: ['PRIVATE_MOVE'] },
      expected: 'move_to: expected non-empty text of at most 200 characters',
    },
    {
      name: 'long move target',
      args: { who_answers: 'a-person', move_to: 'x'.repeat(201) },
      expected: 'move_to: expected non-empty text of at most 200 characters',
    },
    {
      name: 'move with wrong route',
      args: { move_to: 'PRIVATE_MOVE' },
      expected: 'move_to: use who_answers a-person and leave options and agent out',
    },
    {
      name: 'move with choices',
      args: { who_answers: 'a-person', move_to: 'PRIVATE_MOVE', options: ['yes'] },
      expected: 'move_to: use who_answers a-person and leave options and agent out',
    },
    {
      name: 'move with agent',
      args: { who_answers: 'a-person', move_to: 'PRIVATE_MOVE', agent: 'PRIVATE_AGENT' },
      expected: 'move_to: use who_answers a-person and leave options and agent out',
    },
  ]

  for (const one of problems) {
    it(`names the field and expectation for ${one.name}, retaining only app-composed words`, async () => {
      const before = world.store.piecesOwnedBy(worker)
      const sentBefore = world.sent.length
      const routedBefore = world
        .ledger(worker)
        .filter((event) => event.type === 'request_routed').length
      const no = await tool('ask_question').call({
        question: 'Which one?',
        who_answers: 'the-parent',
        ...one.args,
      })
      expect(no.structured).toMatchObject({
        outcome: 'refused',
        rail: 'malformed-request',
        retryable: false,
      })
      const detail = no.structured?.detail as { problems: string[] }
      expect(detail.problems).toContain(one.expected)
      expect(no.text).toContain(one.expected)
      const kept = refusals()[0]!
      expect(no.text).toMatch(/^Not sent: /)
      expect(kept.told?.text).toBe(no.text)
      expect(kept.told?.text).toContain(one.expected)
      expect(JSON.stringify(kept)).not.toContain('PRIVATE_')
      expect(world.store.piecesOwnedBy(worker)).toEqual(before)
      expect(world.sent).toHaveLength(sentBefore)
      expect(world.ledger(worker).filter((event) => event.type === 'request_routed')).toHaveLength(
        routedBefore,
      )
    })
  }

  it('keeps ignored unknown keys and caller values out of recorded diagnostics', async () => {
    const unknown = `PRIVATE_UNKNOWN_${'k'.repeat(200)}`
    const no = await tool('ask_question').call({
      question: ['PRIVATE_VALUE'],
      who_answers: 'the-parent',
      [unknown]: 'PRIVATE_EXTRA',
    })
    expect(no.text).toContain('question: expected text, got a list')
    for (const privateText of [unknown, 'PRIVATE_VALUE', 'PRIVATE_EXTRA']) {
      expect(no.text).not.toContain(privateText)
      expect(JSON.stringify(refusals())).not.toContain(privateText)
    }
    // An unmarked copy cannot turn caller-supplied problem words into an app-authored quote.
    const counterfeit = {
      ...refuseTool('malformed-request', { problems: [`${unknown}: PRIVATE_VALUE`] }),
    }
    const forged = answerInWords(
      {
        structured: counterfeit,
        text: `refused (malformed-request): ${counterfeit.reason}`,
      },
      { me: worker, addressOf: (conversation) => conversation, readAt: 0 },
    )
    expect(forged.text).toContain(`${unknown}: PRIVATE_VALUE`)
    expect(forged.text).toContain('This exact call can never succeed')
    expect(refusalIn('ask_question', counterfeit, forged.text)?.told?.text).toBe(counterfeit.reason)
    const yes = await tool('ask_question').call({
      question: 'Which one?',
      who_answers: 'the-parent',
      [unknown]: 'PRIVATE_EXTRA',
    })
    expect(yes.structured?.outcome).toBe('ok')
  })

  it('retains the conservative record for forbidden addressing names', async () => {
    const no = await tool('ask_question').call({
      question: 'Which one?',
      who_answers: 'the-parent',
      parentSessionId: 'PRIVATE_PARENT',
    })
    expect(no.structured?.rail).toBe('malformed-request')
    expect(no.text).toContain('parentSessionId is not an argument')
    expect(refusals()[0]!.told?.text).toBe(no.structured?.reason)
    expect(JSON.stringify(refusals())).not.toContain('parentSessionId')
    expect(JSON.stringify(refusals())).not.toContain('PRIVATE_PARENT')
  })

  it('accepts the exact question and combined-options bounds without ending assigned work', async () => {
    const yes = await tool('ask_question').call({
      question: 'x'.repeat(1280),
      options: ['y'.repeat(640), 'z'.repeat(640)],
      who_answers: 'the-parent',
    })
    expect(yes.structured?.outcome).toBe('ok')
    expect(world.store.piecesOwnedBy(worker).map((row) => row.piece)).toEqual([piece])
    expect(world.ledger(worker).some((event) => event.type === 'work_replied')).toBe(false)
    expect(refusals()).toEqual([])
  })
})
