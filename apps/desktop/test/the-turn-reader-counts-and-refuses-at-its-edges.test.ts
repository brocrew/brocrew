import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import type { Provider } from '@brobot2/shared'
import { readingATurn, type TurnAsked } from '../src/main/archive/turn-as-sent'
import type { TurnAsSent } from '../src/shared/turn-as-sent'

/**
 * # b9607dc1 · f5980ebc · 791f5ca9 · F093 R1 — the turn reader at its edges
 *
 * `turn-as-sent.test.ts` reads the two fixtures as they are: every Codex case asks for the first
 * message with its text, no Claude line carries `isMeta`, `isSidechain` or a text-only array, every
 * line names its conversation, and every unknown record is small. These are the reader's own edges:
 *
 *  - §1 · ⛔ Claude Code: the harness speaking in the person's name (`isMeta`), a compaction's
 *    summary, a sub-agent's message, text blocks alone or beside a tool's answer — never a message
 *    handed over; ⚑ text beside an image is.
 *  - §2 · ⚑ Claude Code: a record that names no conversation is not refused for it; one that names
 *    another is.
 *  - §3 · 🔴 Codex: the nth, by both kinds of text — asked for the second, the first is not it.
 *  - §4 · ⛔ Codex: a developer block with the same text is never the message; ⚑ a message read from
 *    the record is reported whole, as the record keeps it, not as the importer split it.
 *  - §5 · ⛔ Codex: the base prompt is this conversation's, never another thread's `session_meta`.
 *  - §6 · ⛔ a record too large to carry whole is cut at 20,000 characters, and one exactly that
 *    size is not.
 */

const here = dirname(fileURLToPath(import.meta.url))
const FIXTURES = join(here, 'fixtures', 'turn-as-sent')
const lines = (name: string): string[] =>
  readFileSync(join(FIXTURES, name), 'utf8')
    .split('\n')
    .filter((line) => line !== '')

/** Every line, until the reading has its turn. */
function read(provider: Provider, all: readonly string[], asked: TurnAsked): TurnAsSent {
  const reading = readingATurn(provider, asked)
  for (const line of all) if (reading.line(line) === 'done') break
  return reading.answer()
}

const FIRST = 'W4157-PERSON Please plan the next release.'
const NOTE = 'W4157-NOTE Should the notes cover the beta features?'

type Json = Record<string, unknown>
const isJson = (value: unknown): value is Json =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

/**
 * ⚑ A file's lines, the message carrying `words` given `to(text)` as its text instead — Claude
 * Code's `user` record, or Codex's user block — and every other line as it was.
 */
function rewritten(
  provider: Provider,
  all: readonly string[],
  words: string,
  to: (text: string) => string,
): string[] {
  return all.map((line) => {
    const record = JSON.parse(line) as unknown
    if (!isJson(record)) return line
    if (provider === 'claude') {
      const message = record['message']
      if (record['type'] !== 'user' || !isJson(message)) return line
      const content = message['content']
      if (typeof content !== 'string' || !content.includes(words)) return line
      return JSON.stringify({ ...record, message: { ...message, content: to(content) } })
    }
    const payload = record['payload']
    if (record['type'] !== 'response_item' || !isJson(payload) || payload['role'] !== 'user') {
      return line
    }
    const content = Array.isArray(payload['content']) ? (payload['content'] as unknown[]) : []
    let changed = false
    const blocks = content.map((block) => {
      if (!isJson(block) || block['type'] !== 'input_text') return block
      const text = block['text']
      if (typeof text !== 'string' || !text.includes(words)) return block
      changed = true
      return { ...block, text: to(text) }
    })
    return changed ? JSON.stringify({ ...record, payload: { ...payload, content: blocks } }) : line
  })
}

/** The text a fixture's message carrying `words` was handed over with, exactly. */
function sentIn(provider: Provider, all: readonly string[], words: string): string {
  let found: string | null = null
  rewritten(provider, all, words, (text) => {
    found ??= text
    return text
  })
  if (found === null) throw new Error(`no message carries ${words}`)
  return found
}

/** Where in a fixture the message carrying `words` is: Claude's `user` record, Codex's user message. */
function indexOfTheMessage(provider: Provider, all: readonly string[], words: string): number {
  const at = all.findIndex((line) => {
    const record = JSON.parse(line) as unknown
    if (!isJson(record)) return false
    if (provider === 'claude') {
      const message = record['message']
      const content = isJson(message) ? message['content'] : undefined
      return record['type'] === 'user' && typeof content === 'string' && content.includes(words)
    }
    const payload = record['payload']
    return (
      record['type'] === 'response_item' &&
      isJson(payload) &&
      payload['role'] === 'user' &&
      line.includes(words)
    )
  })
  if (at === -1) throw new Error(`no message carries ${words}`)
  return at
}

/** Which turn: the handed-over text, the first with it, in any conversation — unless told otherwise. */
const asked = (text: string, over: Partial<TurnAsked> = {}): TurnAsked => ({
  by: 'handed-over',
  text,
  // ⚑ W4.204 · no earlier message with this text: the first.
  before: [],
  life: null,
  ...over,
})

/** One Claude Code `user` record with this content, and `extra` beside it. */
const claudeUser = (content: unknown, extra: Json = {}): string =>
  JSON.stringify({ type: 'user', message: { role: 'user', content }, ...extra })

/** Claude Code's answer: the turn before it is whole. */
const CLAUDE_ANSWER = JSON.stringify({
  type: 'assistant',
  message: { role: 'assistant', content: [{ type: 'text', text: 'Noted.' }] },
})

const IMAGE = { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'AA' } }

/** One Codex `response_item` message in this role, one text block per text. */
const codexMessage = (role: string, ...texts: string[]): string =>
  JSON.stringify({
    type: 'response_item',
    payload: {
      type: 'message',
      role,
      content: texts.map((text) => ({
        type: role === 'assistant' ? 'output_text' : 'input_text',
        text,
      })),
    },
  })

const CODEX_ANSWER = codexMessage('assistant', 'Noted.')
const codexEvent = (kind: string): string =>
  JSON.stringify({ type: 'event_msg', payload: { type: kind } })
const codexMeta = (payload: Json): string => JSON.stringify({ type: 'session_meta', payload })

describe('§1 · ⛔ Claude Code: what is never a message handed over', () => {
  it('⛔ the harness in the person’s name, a compaction’s summary, a sub-agent’s message — ⚑ beside the same line plain, which is found', () => {
    // ⚑ The control: the same line with no flag is the message.
    const plain = read('claude', [claudeUser(FIRST), CLAUDE_ANSWER], asked(FIRST))
    expect(plain.found && plain.message).toBe(FIRST)
    for (const flag of ['isMeta', 'isCompactSummary', 'isSidechain']) {
      expect(
        read('claude', [claudeUser(FIRST, { [flag]: true }), CLAUDE_ANSWER], asked(FIRST)).found,
        flag,
      ).toBe(false)
    }
  })

  it('⛔ text blocks alone, or beside a tool’s answer, are not handed over — ⚑ text beside an image is', () => {
    // ⚑ The control: an image and its text, found by the text alone, the image named beside it.
    const withAnImage = read(
      'claude',
      [claudeUser([IMAGE, { type: 'text', text: FIRST }]), CLAUDE_ANSWER],
      asked(FIRST),
    )
    expect(withAnImage.found && withAnImage.message).toBe(`[an image]\n\n${FIRST}`)
    // ⛔ An array of text alone is the harness's, never a person's message.
    expect(
      read('claude', [claudeUser([{ type: 'text', text: FIRST }]), CLAUDE_ANSWER], asked(FIRST))
        .found,
    ).toBe(false)
    // ⛔ …and a tool's answer is not a message, though an image and the same text ride with it.
    const toolAnswer = { type: 'tool_result', tool_use_id: 'toolu_1', content: 'ok' }
    expect(
      read(
        'claude',
        [claudeUser([toolAnswer, IMAGE, { type: 'text', text: FIRST }]), CLAUDE_ANSWER],
        asked(FIRST),
      ).found,
    ).toBe(false)
  })
})

describe('§2 · ⚑ Claude Code: which conversation a record is in', () => {
  it('⚑ a record that names no conversation is not refused for it — ⛔ one that names another is', () => {
    // ⚑ No `sessionId` at all: read in the conversation asked for.
    const unnamed = read('claude', [claudeUser(FIRST), CLAUDE_ANSWER], asked(FIRST, { life: 'x' }))
    expect(unnamed.found && unnamed.message).toBe(FIRST)
    // ⚑ Named as that conversation: read.
    expect(
      read(
        'claude',
        [claudeUser(FIRST, { sessionId: 'x' }), CLAUDE_ANSWER],
        asked(FIRST, { life: 'x' }),
      ).found,
    ).toBe(true)
    // ⛔ Named as another: not this conversation's message.
    expect(
      read(
        'claude',
        [claudeUser(FIRST, { sessionId: 'y' }), CLAUDE_ANSWER],
        asked(FIRST, { life: 'x' }),
      ).found,
    ).toBe(false)
  })
})

describe('§3 · 🔴 Codex: the nth', () => {
  const codex = lines('codex-rollout.jsonl')

  it('🔴 a text handed over once is not found as its second — ⚑ handed over again, the second is the later turn’s', () => {
    const sent = sentIn('codex', codex, FIRST)
    // ⚑ The control: the first is found.
    expect(read('codex', codex, asked(sent)).found).toBe(true)
    // ⛔ There is no second.
    expect(read('codex', codex, asked(sent, { before: ['handed-over'] })).found).toBe(false)
    // ⚑ The same text handed over again, as a turn of its own after the last answer.
    const message = codex[indexOfTheMessage('codex', codex, FIRST)] ?? ''
    const twice = [
      ...codex,
      codexEvent('task_started'),
      message,
      CODEX_ANSWER,
      codexEvent('task_complete'),
    ]
    const second = read('codex', twice, asked(sent, { before: ['handed-over'] }))
    if (!second.found) throw new Error(second.why)
    expect(second.message).toBe(sent)
    // ⚑ The later turn's: nothing of the first turn's developer and environment blocks beside it.
    expect(second.parts.map((part) => part.author)).toEqual(['the-message'])
    const first = read('codex', twice, asked(sent))
    expect(first.found && first.parts).toHaveLength(6)
  })

  it('🔴 a turn read from the record: asked for its second, the first is not it', () => {
    // ⚑ The text the Codex importer took from the rollout (`import-codex.ts`), as §5 of
    // `turn-as-sent.test.ts` reads it.
    const said = sentIn('codex', codex, NOTE)
    const own = { by: 'its-own-record' } as const
    const first = read('codex', codex, asked(said, own))
    expect(first.found && first.message).toBe(said)
    expect(read('codex', codex, asked(said, { ...own, before: ['its-own-record'] })).found).toBe(
      false,
    )
  })
})

describe('§4 · Codex: which block is the message, and how it is reported', () => {
  it('⛔ a developer block with the same text is never the message — ⚑ the user’s block is', () => {
    const file = [
      codexMeta({ id: 't' }),
      codexEvent('task_started'),
      codexMessage('developer', 'T'),
      codexMessage('user', 'T'),
      CODEX_ANSWER,
    ]
    const turn = read('codex', file, asked('T'))
    if (!turn.found) throw new Error(turn.why)
    expect(turn.parts.map((part) => [part.author, part.role])).toEqual([
      ['the-provider', 'developer'],
      ['the-message', 'user'],
    ])
    expect(turn.message).toBe('T')
  })

  it('⚑ a message read from the record is reported whole, as the record keeps it — ⛔ never only as its split words', () => {
    // ⚑ Codex's own separator (`REQUEST_MARKER`, `codex-injected.ts`): the importer keeps what is
    // below it as the turn's words.
    const block = 'Context.\n\n## My request for Codex:\nhello'
    const file = [
      codexMeta({ id: 't' }),
      codexEvent('task_started'),
      codexMessage('user', block),
      CODEX_ANSWER,
    ]
    const turn = read('codex', file, asked('hello', { by: 'its-own-record' }))
    if (!turn.found) throw new Error(turn.why)
    expect(turn.message).toBe(block)
    expect(turn.parts).toEqual([
      { author: 'the-message', label: 'user', role: 'user', text: block, title: 'The message' },
    ])
    // ⛔ Handed over, the words alone are not the block…
    expect(read('codex', file, asked('hello')).found).toBe(false)
    // ⚑ …and the block's exact text is.
    expect(read('codex', file, asked(block)).found).toBe(true)
  })
})

describe('§5 · ⛔ Codex: the base prompt is this conversation’s', () => {
  it('⛔ another thread’s session_meta between this one’s and the message lends it no base prompt', () => {
    const codex = lines('codex-rollout.jsonl')
    const thread = /"id":"([^"]+)"/.exec(codex[0] ?? '')?.[1] ?? ''
    expect(thread, 'the premise: the fixture names its thread').not.toBe('')
    const file = [
      codex[0] ?? '',
      // Another thread's record, with a base prompt of its own…
      codexMeta({ id: 'other', base_instructions: { text: 'OTHER' } }),
      // …then this thread's again, naming no base prompt.
      codexMeta({ id: thread }),
      ...codex.slice(1),
    ]
    // ⚑ The control: the fixture as it is gives this thread's own base prompt.
    const plain = read('codex', codex, asked(sentIn('codex', codex, FIRST), { life: thread }))
    expect(plain.found && plain.standing[0]?.text).toMatch(/^You are Codex, a coding agent/)
    const turn = read('codex', file, asked(sentIn('codex', codex, FIRST), { life: thread }))
    // ⚑ The premise: the message is found in its own thread.
    if (!turn.found) throw new Error(turn.why)
    expect(turn.standing).toHaveLength(1)
    expect(turn.standing[0]?.text).toMatch(/^You are Codex, a coding agent/)
    expect(turn.standing.map((part) => part.text)).not.toContain('OTHER')
  })
})

describe('§6 · ⛔ a record too large to carry whole is cut, at 20,000 characters', () => {
  const CUT = 20_000

  it('⛔ Claude Code: a record past the cut is kept as its first 20,000 characters — ⚑ one of exactly 20,000, whole', () => {
    const claude = lines('claude-transcript.jsonl')
    const at = indexOfTheMessage('claude', claude, FIRST)
    const large = { type: 'brand_new_record', note: 'x'.repeat(30_000) }
    // ⚑ A record whose JSON is exactly the cut.
    const shell = JSON.stringify({ type: 'edge_record', note: '' }).length
    const edge = { type: 'edge_record', note: 'y'.repeat(CUT - shell) }
    expect(JSON.stringify(edge)).toHaveLength(CUT)
    const turn = read(
      'claude',
      [
        ...claude.slice(0, at + 1),
        JSON.stringify(large),
        JSON.stringify(edge),
        ...claude.slice(at + 1),
      ],
      asked(sentIn('claude', claude, FIRST)),
    )
    if (!turn.found) throw new Error(turn.why)
    expect(turn.records).toContainEqual({
      label: 'brand_new_record',
      kind: 'unknown',
      raw: { cutAt: CUT, start: JSON.stringify(large).slice(0, CUT) },
    })
    expect(turn.records).toContainEqual({ label: 'edge_record', kind: 'unknown', raw: edge })
  })

  it('⛔ Codex: a line that is not JSON, past the cut, is kept as its first 20,000 characters — ⚑ a short one whole', () => {
    const codex = lines('codex-rollout.jsonl')
    const at = indexOfTheMessage('codex', codex, NOTE)
    const torn = `{torn${'z'.repeat(30_000)}`
    const turn = read(
      'codex',
      [...codex.slice(0, at), torn, '{short', ...codex.slice(at)],
      asked(sentIn('codex', codex, NOTE)),
    )
    if (!turn.found) throw new Error(turn.why)
    expect(turn.records).toContainEqual({
      label: 'a line that is not JSON',
      kind: 'unknown',
      raw: { cutAt: CUT, start: torn.slice(0, CUT) },
    })
    expect(turn.records).toContainEqual({
      label: 'a line that is not JSON',
      kind: 'unknown',
      raw: '{short',
    })
  })
})
