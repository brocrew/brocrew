import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  importCodexRollout,
  readCodexRolloutMeta,
} from '../src/main/providers/codex/import-transcript'

const here = dirname(fileURLToPath(import.meta.url))
const ROLLOUT_FIXTURE = join(here, 'fixtures/codex-rollout.jsonl')
const AT = 1_700_000_000_000

const lines = (path: string): string[] => readFileSync(path, 'utf8').split('\n')

describe('the Codex rollout parser', () => {
  it('reads a rollout into the same events the live stream produces', () => {
    const { entries, unreadable } = importCodexRollout(lines(ROLLOUT_FIXTURE), AT)
    expect(unreadable, 'the non-JSON line is reported, not hidden').toBe(1)
    expect(entries.map((e) => e.event.type)).toEqual([
      'user_turn',
      'thinking',
      'tool_call',
      'tool_result',
      'assistant_message',
    ])
  })

  it('unwraps the shapes Codex actually writes, rather than showing their JSON', () => {
    const { entries } = importCodexRollout(lines(ROLLOUT_FIXTURE), AT)
    const call = entries.find((e) => e.event.type === 'tool_call')?.event
    // `arguments` is a JSON STRING containing a command ARRAY — a row showing the raw JSON would
    // be technically true and unreadable.
    expect(call).toMatchObject({ name: 'shell', summary: 'bash -lc wc -l notes.txt' })
    const result = entries.find((e) => e.event.type === 'tool_result')?.event
    // `output` is itself a JSON string wrapping `{output}`.
    expect(result).toMatchObject({ id: 'call_ABC123', summary: '      12 notes.txt', ok: true })
  })

  it('reasoning with no readable words is redacted, not empty', () => {
    // 027's rule: "it thought and we cannot show you what" is a different fact from "it did not
    // think". `content` is null and `encrypted_content` is opaque by design.
    const { entries } = importCodexRollout(
      [
        '{"type":"response_item","timestamp":"2026-04-22T15:00:00Z","payload":{"type":"reasoning","summary":[],"content":null}}',
      ],
      AT,
    )
    expect(entries[0]?.event).toMatchObject({ type: 'thinking', phase: 'complete', redacted: true })
  })

  it('carries the provider’s own times, and falls back only when a file names none', () => {
    const { entries } = importCodexRollout(lines(ROLLOUT_FIXTURE), AT)
    expect(entries[0]?.at).toBe(Date.parse('2026-04-22T15:48:57.000Z'))
    const timeless = importCodexRollout(
      [
        '{"type":"response_item","payload":{"type":"message","role":"assistant","content":[{"type":"output_text","text":"hi"}]}}',
      ],
      AT,
    )
    expect(timeless.entries[0]?.at).toBe(AT)
  })

  it('names the thread it belongs to, without parsing the whole file', () => {
    const meta = readCodexRolloutMeta(lines(ROLLOUT_FIXTURE))
    expect(meta).toMatchObject({
      threadId: '019db5aa-6765-7d31-801f-bdceed422f03',
      cwd: '/tmp/scratch',
    })
  })
})
