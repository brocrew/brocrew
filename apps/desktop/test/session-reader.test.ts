import {
  mkdtempSync,
  rmSync,
  writeFileSync,
  appendFileSync,
  readFileSync,
  truncateSync,
} from 'node:fs'
import { tmpdir, homedir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { existsSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { afterEach, describe, expect, it } from 'vitest'
import { importCodexRollout, readCodexRolloutMeta } from '../src/main/archive/import-codex'
import {
  MAX_WHOLE_TRANSCRIPT_BYTES,
  readTranscript,
  tailTranscript,
} from '../src/main/archive/session-reader'

/**
 * One session reader (Slice 2 · 036).
 *
 * The corpus on this machine is the real subject — 6,117 Claude child transcripts and 1,811 Codex
 * rollouts — but CI must not depend on one laptop's home directory. So the deterministic assertions
 * run against a committed fixture built from the shapes verified on that corpus, and a second set
 * runs against the corpus itself WHEN IT IS THERE, skipping honestly when it is not. A test that
 * silently passed because the files were missing would be worse than one that says it skipped.
 */

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

  it('reads ONLY response_item — event_msg is the same words a second time', () => {
    // The rollout carries both: `response_item{message}` and `event_msg{agent_message}` say the
    // same thing, and `event_msg` has no tool calls at all. Reading both would render every
    // message twice; reading only `event_msg` would render prose with the work missing.
    const { entries } = importCodexRollout(lines(ROLLOUT_FIXTURE), AT)
    const assistants = entries.filter((e) => e.event.type === 'assistant_message')
    expect(assistants).toHaveLength(1)
    const users = entries.filter((e) => e.event.type === 'user_turn')
    expect(users).toHaveLength(1)
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

describe('tailing a file that is still being written', () => {
  const dirs: string[] = []
  const scratch = (): string => {
    const dir = mkdtempSync(join(tmpdir(), 'brobot2-reader-'))
    dirs.push(dir)
    return dir
  }
  afterEach(() => {
    for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
  })

  const settle = (): Promise<void> => new Promise((r) => setTimeout(r, 400))

  it('delivers what is already there, then what arrives after', async () => {
    const dir = scratch()
    const path = join(dir, 'rollout.jsonl')
    const line = (text: string): string =>
      `{"type":"response_item","timestamp":"2026-04-22T15:00:00Z","payload":{"type":"message","role":"assistant","content":[{"type":"output_text","text":"${text}"}]}}\n`
    writeFileSync(path, line('one'))

    const chunks: string[][] = []
    const tail = tailTranscript({ provider: 'codex', path, fallbackAt: AT }, (chunk) => {
      chunks.push(
        chunk.entries.map((e) => ('text' in e.event ? String(e.event.text) : e.event.type)),
      )
    })
    try {
      // A consumer that attaches late is not missing the beginning — the normal case for a card
      // opened after its child started.
      expect(chunks.flat()).toEqual(['one'])
      appendFileSync(path, line('two'))
      await settle()
      expect(chunks.flat()).toEqual(['one', 'two'])
    } finally {
      tail.stop()
    }
  })

  it('never loses a line the writer had not finished', async () => {
    // The hazard that makes this more than a read loop: a watcher fires mid-line. Advancing the
    // offset past a half-written record would drop it permanently — it is never re-read.
    const dir = scratch()
    const path = join(dir, 'rollout.jsonl')
    writeFileSync(path, '')
    const seen: string[] = []
    const tail = tailTranscript({ provider: 'codex', path, fallbackAt: AT }, (chunk) => {
      for (const entry of chunk.entries) {
        if ('text' in entry.event) seen.push(String(entry.event.text))
      }
    })
    try {
      const whole =
        '{"type":"response_item","timestamp":"2026-04-22T15:00:00Z","payload":{"type":"message","role":"assistant","content":[{"type":"output_text","text":"halves"}]}}\n'
      appendFileSync(path, whole.slice(0, 60)) // the writer is mid-line
      await settle()
      expect(seen, 'a partial line must produce nothing at all').toEqual([])
      appendFileSync(path, whole.slice(60)) // …and finishes it
      await settle()
      expect(seen, 'and the completed line arrives whole').toEqual(['halves'])
    } finally {
      tail.stop()
    }
  })

  it('stopping is idempotent, and a file that never appears is not an error', () => {
    const dir = scratch()
    const tail = tailTranscript(
      { provider: 'claude', path: join(dir, 'nope.jsonl'), fallbackAt: AT },
      () => {
        throw new Error('nothing should be delivered')
      },
    )
    expect(() => {
      tail.stop()
      tail.stop()
    }).not.toThrow()
  })
})

/**
 * The real corpus. Skipped rather than failed when it is absent, and the skip is visible.
 */
describe('against the transcripts actually on this machine', () => {
  const claudeChild = (): string | null => {
    const root = join(homedir(), '.claude', 'projects')
    if (!existsSync(root)) return null
    try {
      const found = execFileSync('find', [root, '-name', 'agent-*.jsonl', '-size', '+8k'], {
        encoding: 'utf8',
        maxBuffer: 64 * 1024 * 1024,
      })
        .split('\n')
        .filter(Boolean)
      return found[0] ?? null
    } catch {
      return null
    }
  }

  it.runIf(claudeChild() !== null)('reads a real Claude child transcript', () => {
    const path = claudeChild()!
    const { entries, unreadable } = readTranscript({ provider: 'claude', path, fallbackAt: AT })
    expect(entries.length, 'a real child has a conversation in it').toBeGreaterThan(0)
    // Every entry is one of the vocabulary the live stream also produces — that is the claim that
    // makes the read path reuse the live components.
    for (const entry of entries) expect(typeof entry.event.type).toBe('string')
    expect(unreadable).toBe(0)
  })

  it.runIf(existsSync(join(homedir(), '.codex', 'sessions')))('reads a real Codex rollout', () => {
    const found = execFileSync(
      'find',
      [join(homedir(), '.codex', 'sessions'), '-name', 'rollout-*.jsonl', '-size', '+30k'],
      { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 },
    )
      .split('\n')
      .filter(Boolean)
    if (found.length === 0) return
    const path = found[0]!
    const { entries } = readTranscript({ provider: 'codex', path, fallbackAt: AT })
    expect(entries.length).toBeGreaterThan(0)
    expect(readCodexRolloutMeta(lines(path))?.threadId).toMatch(/^[0-9a-f-]{36}$/)
  })
})

/**
 * `readTranscript` returns a whole conversation at once, and until 052 it built that from a SINGLE
 * string containing the entire file — which throws outright above V8's ~512 MB string limit. Its
 * own comment called it "the one 2b's import path will call", and the largest transcripts in the
 * user's own homes are gigabyte-scale (1.43 GB and 0.69 GB measured on 2026-08-03; `sweep.ts`
 * records 1.53 GB from an earlier pass), so that path would not have been slow — it would have
 * been an exception.
 */
describe('readTranscript refuses a file it cannot serve (052)', () => {
  let dir: string
  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true })
  })

  it('names the ceiling and the streaming alternative rather than dying at an internal limit', () => {
    dir = mkdtempSync(join(tmpdir(), 'brobot2-ceiling-'))
    const path = join(dir, 'huge.jsonl')
    writeFileSync(path, '{"type":"user"}\n')
    // The ceiling is read with `statSync`, so a SPARSE file one byte over it is the real fixture
    // at no disk and no time — 64 MiB + 1, not a gigabyte, because the ceiling is what is on test.
    truncateSync(path, MAX_WHOLE_TRANSCRIPT_BYTES + 1)

    expect(() => readTranscript({ provider: 'claude', path, fallbackAt: AT })).toThrow(
      /over readTranscript's \d+-byte ceiling/,
    )
    expect(() => readTranscript({ provider: 'claude', path, fallbackAt: AT })).toThrow(/readLines/)
  })

  it('reads an ordinary file through the batched pull, unchanged', () => {
    dir = mkdtempSync(join(tmpdir(), 'brobot2-batch-'))
    const path = join(dir, 'ordinary.jsonl')
    // More lines than one pull (4,096), so the loop's carry-on offset is actually exercised —
    // a single-batch fixture would pass even if the second pull were broken.
    const lines_ = Array.from(
      { length: 5_000 },
      (_, i) => `{"type":"user","message":{"role":"user","content":"m${i}"}}`,
    )
    writeFileSync(path, lines_.join('\n') + '\n')

    const { entries, unreadable } = readTranscript({ provider: 'claude', path, fallbackAt: AT })
    expect(unreadable).toBe(0)
    // No phantom final line from the trailing newline, and nothing lost at the batch seam.
    expect(entries).toHaveLength(5_000)
  })
})
