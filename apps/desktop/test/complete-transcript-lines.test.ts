import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { completeTranscriptLines } from '../src/main/providers/complete-transcript-lines'
import { childWorkRoot, readChild as claudeChild } from '../src/main/providers/claude/child-work'
import { readChild as codexChild } from '../src/main/providers/codex/child-work'
import { MAX_CHILD_WORK_BYTES } from '../src/main/child-work-file'
import type { ProviderChildWorkRequest } from '../src/main/providers/transcript-policy'

it.each([
  ['', false, []],
  ['', true, []],
  ['\n', false, ['']],
  ['\n\n', true, ['', '']],
  ['first\n\nsecond\n', false, ['first', '', 'second']],
  ['first\nsecond', false, ['first', 'second']],
  ['first\nsecond', true, ['first']],
  ['first\nsecond\n', true, ['first', 'second']],
  ['unfinished', true, []],
  ['first\r\nsecond\r\n', false, ['first\r', 'second\r']],
  ['first\r\nsecond\r', true, ['first\r']],
  ['first\n\nunfinished', true, ['first', '']],
] as const)('frames %j with truncated=%s', (text, truncated, expected) => {
  expect(completeTranscriptLines(text, truncated)).toEqual(expected)
})

const homes: string[] = []
afterEach(() => {
  for (const home of homes.splice(0)) rmSync(home, { recursive: true, force: true })
})

describe.each(['claude', 'codex'] as const)('%s child transcript framing', (provider) => {
  function frame(text: string): string {
    return JSON.stringify(
      provider === 'claude'
        ? { type: 'assistant', message: { content: [{ type: 'text', text }] } }
        : {
            type: 'response_item',
            payload: {
              type: 'message',
              role: 'assistant',
              content: [{ type: 'output_text', text }],
            },
          },
    )
  }

  it.each([
    'no-final-newline',
    'blank-record',
    'malformed-tail',
    'crlf',
    'cap-at-lf',
    'cap-in-record',
  ])('keeps native record order and diagnostics for %s', (ending) => {
    const first = frame('first')
    const second = frame('second')
    let raw = `${first}\n${second}`
    let unreadable = 0
    let truncated = false
    let words = ['first', 'second']
    switch (ending) {
      case 'blank-record':
        raw = `${first}\n\n${second}\n`
        unreadable = provider === 'claude' ? 1 : 0
        break
      case 'malformed-tail':
        raw += '\n{"unfinished"'
        unreadable = 1
        break
      case 'crlf':
        raw = `${first}\r\n${second}\r\n`
        break
      case 'cap-at-lf':
        raw = `${first}\n${second.padEnd(MAX_CHILD_WORK_BYTES - first.length - 2)}\n${frame('outside')}`
        truncated = true
        break
      case 'cap-in-record':
        raw = `${first}\n${frame('x'.repeat(MAX_CHILD_WORK_BYTES))}`
        words = ['first']
        truncated = true
        break
    }
    const home = mkdtempSync(join(tmpdir(), 'complete-child-lines-'))
    homes.push(home)
    const ref = { provider, sessionId: 'parent', cwd: home, rotation: 0 }
    const agent = 'child-framing'
    const path =
      provider === 'claude'
        ? join(childWorkRoot(home, ref), 'subagents', `agent-${agent}.jsonl`)
        : join(home, 'rollout.jsonl')
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(path, raw)
    const request: ProviderChildWorkRequest = {
      ref,
      agents: [agent],
      part: 'transcript',
      taskId: null,
      updatedAt: 1000,
      home: () => home,
      pathForChild: () => path,
    }
    const result = provider === 'claude' ? claudeChild(request) : codexChild(request)
    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error('Expected a readable synthetic child transcript')
    expect(result.entries).toEqual(words.map((text) => ({ type: 'assistant_message', text })))
    expect(result.unreadable).toBe(unreadable)
    expect(result.truncated).toBe(truncated)
    expect(result.bytes).toBe(Buffer.byteLength(raw))
    expect(result.text).toBe(raw.slice(0, MAX_CHILD_WORK_BYTES))
    expect(result.errorFacts).toHaveLength(words.length)
    if (provider === 'claude') expect(result.thinkingBlocks).toBe(0)
    else expect(result.thinkingBlocks).toBeUndefined()
  })
})
