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
  'Put the rest in a Markdown file, a page, an image or a PDF and name its path in resource_paths; the piece stays open. Nothing was shortened for you.'

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

  it('publishes the exact summary, question and combined-choice character limits', () => {
    expect(z.globalRegistry.get(tool('reply_to_parent').input.summary!)?.description).toBe(
      'What the conversation that gave you this needs to read — for work you took on for a person, what its record keeps as its last status line. At most 1,280 characters (UTF-16 code units). Put longer detail in a file listed in resource_paths. Nothing is shortened for you.',
    )
    expect(z.globalRegistry.get(tool('ask_question').input.question!)?.description).toBe(
      'What you need decided, in your own words, at most 1,280 characters (UTF-16 code units). Nothing is shortened for you.',
    )
    expect(z.globalRegistry.get(tool('ask_question').input.options!)?.description).toBe(
      'The choices you are offering, as a list of text choices with at most 1,280 characters in total (UTF-16 code units). Leave it out to ask for an answer in their own words.',
    )
  })

  it('says the measured summary length once, keeps the piece open, and accepts the exact bound', async () => {
    const before = world.store.piecesOwnedBy(worker)
    const summary = 'PRIVATE_SUMMARY_'.padEnd(1840, 'x')
    const no = await tool('reply_to_parent').call({ piece, outcome: 'done', summary })
    const reason = `Not handed back: the summary is 1,840 characters; the most is 1,280, so cut at least 560. ${remedy}`
    expect(no.structured).toMatchObject({
      outcome: 'refused',
      rail: 'summary-too-long',
      reason,
      permanence: 'while-this-holds',
      retryable: true,
      remedy: 'shorten-the-summary-and-attach-the-long-form',
      detail: { was: 1840, limit: 1280 },
    })
    expect(no.text.startsWith(`refused (summary-too-long): ${reason}`)).toBe(true)
    expect(no.text.match(/1,840/g)).toHaveLength(1)
    expect(no.text.match(/1,280/g)).toHaveLength(1)
    expect(no.text).not.toContain('It is ')
    expect(world.store.piecesOwnedBy(worker)).toEqual(before)
    expect(world.ledger(worker).some((event) => event.type === 'work_replied')).toBe(false)
    const kept = refusals()[0]!
    expect(kept.told?.text).toBe(no.text.slice('refused (summary-too-long): '.length))
    expect(JSON.stringify(kept)).not.toContain('PRIVATE_SUMMARY_')
    expect(JSON.stringify(kept)).not.toContain(piece)
    const yes = await tool('reply_to_parent').call({
      piece,
      outcome: 'done',
      summary: 'x'.repeat(1280),
    })
    expect(yes.structured?.outcome).toBe('ok')
  })

  it('counts UTF-16 code units without repeating the summary itself', async () => {
    const no = await tool('reply_to_parent').call({
      piece,
      outcome: 'done',
      summary: '🟩'.repeat(641),
    })
    expect(no.structured?.reason).toBe(
      `Not handed back: the summary is 1,282 characters; the most is 1,280, so cut at least 2. ${remedy}`,
    )
    expect(no.text).not.toContain('🟩')
    const yes = await tool('reply_to_parent').call({
      piece,
      outcome: 'done',
      summary: '🟩'.repeat(640),
    })
    expect(yes.structured?.outcome).toBe('ok')
  })

  it('uses the shared-limit fallback when no measured length is available', () => {
    for (const was of [undefined, Number.NaN, Infinity, -1, 1.5]) {
      expect(
        refuseReply('summary-too-long', { ...(was === undefined ? {} : { was }) }).reason,
      ).toBe(`Not handed back: the summary exceeds 1,280 characters. ${remedy}`)
    }
  })

  const problems: { name: string; args: Record<string, unknown>; expected: string }[] = [
    {
      name: 'missing recipient',
      args: { who_answers: undefined },
      expected: 'who_answers: required; expected one of the-parent, a-person, an-agent',
    },
    {
      name: 'unknown recipient',
      args: { who_answers: 'PRIVATE_RECIPIENT' },
      expected: 'who_answers: required; expected one of the-parent, a-person, an-agent',
    },
    {
      name: 'wrong recipient type',
      args: { who_answers: 42 },
      expected: 'who_answers: required; expected one of the-parent, a-person, an-agent',
    },
    {
      name: 'missing question',
      args: { question: undefined },
      expected: 'question: required; expected non-empty text',
    },
    { name: 'empty question', args: { question: '' }, expected: 'question: must not be empty' },
    {
      name: 'long question',
      args: { question: 'PRIVATE_QUESTION'.padEnd(1840, 'x') },
      expected: 'question: at most 1,280 characters; got 1,840',
    },
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
      args: { options: ['x'.repeat(1000), 'y'.repeat(840)] },
      expected: 'options: at most 1,280 characters in total; got 1,840',
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
      expect(kept.told?.text).toBe(no.text.slice('refused (malformed-request): '.length))
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
