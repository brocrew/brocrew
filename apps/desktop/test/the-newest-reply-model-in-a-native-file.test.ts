import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { newestReplyModel } from '../src/main/archive/native-file'

/**
 * # 20f1a2a0 · feat(panel): who-called-whom says what each conversation last reported
 *
 * `newestReplyModel` reads a Claude transcript backwards, 64 KiB at a time, for the model on its
 * newest reply. The commit added it with no test of its own: `who-called-whom.test.ts` only
 * gains the key name `lastReported`, and no test writes a transcript for the host to read a model
 * from, so it is never run by the suite. ⚑ F099 (61630490) removed its companion `fileStamp`.
 * These are its edges:
 *
 *  - §1 · ⛔ Not every assistant line is the conversation's reply: a sub-agent's line
 *    (`isSidechain`), the CLI's own error reply (`<synthetic>`), an empty model, a `user` line
 *    or a broken line naming "model" are passed over — ⚑ and a plain newer reply wins.
 *  - §2 · ⚑ A reply split by a page edge is read whole: the bytes before a page's first line
 *    break are kept and joined to the page before. Pages are counted from the END of the file,
 *    so the edges sit at size − 64 KiB and size − 128 KiB, and a '€' (3 bytes) is put across one
 *    so a line read in halves, or a character decoded in halves, gives the wrong answer.
 *  - §3 · ⛔ The 4 MiB budget: a reply in a file of exactly 4 MiB is found; one byte more and
 *    it is not (the reader cannot see the line's start).
 *
 * ⛔ Every file is in a `mkdtemp` folder, removed after. No real home is read.
 */

let root: string

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'brobot2-newest-reply-model-'))
})

afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

const PAGE = 64 * 1024
const BUDGET = 4 * 1024 * 1024

/** One JSONL line, its newline included. */
const line = (entry: Record<string, unknown>): string => `${JSON.stringify(entry)}\n`

/** An assistant reply naming `model`, with any other fields given. */
const reply = (model: string, extra: Record<string, unknown> = {}): string =>
  line({ type: 'assistant', ...extra, message: { role: 'assistant', model } })

/** A transcript at a fresh path in the temp folder. */
let written = 0
const aTranscript = (text: string): string => {
  written += 1
  const path = join(root, `t${String(written)}.jsonl`)
  writeFileSync(path, text)
  return path
}

/** `user` lines that name no model, `total` bytes in all, each with its newline. */
const filler = (total: number): string => {
  const out: string[] = []
  let left = total
  while (left > 0) {
    const size = left >= 2048 ? 1024 : left
    // '{"type":"user","pad":"' is 22 bytes, '"}\n' is 3.
    out.push(`{"type":"user","pad":"${'x'.repeat(size - 25)}"}\n`)
    left -= size
  }
  return out.join('')
}

describe('§1 · ⛔ only the conversation’s own replies count', () => {
  it('⛔ a sub-agent’s newer line (isSidechain) is passed over — ⚑ the same line not on a side chain wins', () => {
    // ⚑ The control: newest first, so a plain newer reply is the answer.
    expect(newestReplyModel(aTranscript(reply('m1') + reply('m2', { isSidechain: false })))).toBe(
      'm2',
    )
    // ⛔ The same newer line from a sub-agent: the conversation's own reply is the older one.
    expect(newestReplyModel(aTranscript(reply('m1') + reply('m2', { isSidechain: true })))).toBe(
      'm1',
    )
  })

  it('⛔ the CLI’s own error reply (<synthetic>) is passed over — ⚑ a real newer reply is not', () => {
    expect(newestReplyModel(aTranscript(reply('m1') + reply('m2')))).toBe('m2')
    expect(newestReplyModel(aTranscript(reply('m1') + reply('<synthetic>')))).toBe('m1')
  })

  it('⛔ an empty model, a user line and a broken line naming "model" are passed over — ⚑ the reply before them is found', () => {
    const path = aTranscript(
      reply('m1') +
        reply('') +
        line({ type: 'user', message: { role: 'user', model: 'mu' } }) +
        '{"type":"assistant","message":{"model":"broken"\n',
    )
    expect(newestReplyModel(path)).toBe('m1')
    // ⛔ No reply at all: none — ⚑ beside an empty file, also none.
    expect(newestReplyModel(aTranscript(line({ type: 'user', message: { model: 'mu' } })))).toBe(
      null,
    )
    expect(newestReplyModel(aTranscript(''))).toBe(null)
  })

  it('⚑ the newest reply is found whether or not the file ends in a line break', () => {
    expect(newestReplyModel(aTranscript(reply('m1') + reply('m2')))).toBe('m2')
    expect(newestReplyModel(aTranscript(reply('m1') + reply('m2').trimEnd()))).toBe('m2')
  })
})

/**
 * An older reply (`m-old`), then a long newest reply whose model is `claude-€`, laid out so the
 * '€' starts one byte before the page edge `edge` bytes from the end of the file: its first byte
 * is in one page, its other two in the next. Read in halves, the long line fails to parse and
 * the reader falls back to `m-old`; decoded in halves, the '€' comes back as U+FFFD.
 */
const OLD = '{"type":"assistant","message":{"model":"m-old"}}\n'
const HEAD = '{"type":"assistant","message":{"model":"claude-'
const replyAcrossAnEdge = (edge: number, trailingBreak: boolean): string => {
  // Bytes from the '€' to the end: '€' (3) + '","content":"' (13) + pad + '"}}' (3) + break.
  const pad = edge + 1 - 3 - 13 - 3 - (trailingBreak ? 1 : 0)
  return `${OLD}${HEAD}€","content":"${'x'.repeat(pad)}"}}${trailingBreak ? '\n' : ''}`
}

describe('§2 · ⚑ a reply split by a page edge is read whole', () => {
  it('⚑ a 128 KiB reply across three pages, its € on the edge 128 KiB from the end, is found — ⛔ not the older reply', () => {
    const path = aTranscript(replyAcrossAnEdge(2 * PAGE, true))
    const bytes = readFileSync(path)
    const size = bytes.length
    // ⚑ The layout is what the test claims: the file is under three pages, the € straddles the
    // edge between the first and second page read back (size − 128 KiB), and the only breaks
    // are after the old reply and at the very end — so the middle page has none.
    expect(size).toBeGreaterThan(2 * PAGE)
    expect(size).toBeLessThan(3 * PAGE)
    expect(bytes[size - 2 * PAGE - 1]).toBe(0xe2)
    expect(bytes[size - 2 * PAGE]).toBe(0x82)
    expect(bytes[size - 2 * PAGE + 1]).toBe(0xac)
    expect(bytes.indexOf(0x0a)).toBe(Buffer.byteLength(OLD) - 1)
    expect(bytes.indexOf(0x0a, Buffer.byteLength(OLD))).toBe(size - 1)
    // ⚑ The fallback is real: the older reply alone is read.
    expect(newestReplyModel(aTranscript(OLD))).toBe('m-old')
    // ⛔ Not the older reply, and the € whole.
    expect(newestReplyModel(path)).toBe('claude-€')
  })

  it('⚑ a reply with no line break after it, its € on the edge 64 KiB from the end, is found — ⛔ not the older reply', () => {
    const path = aTranscript(replyAcrossAnEdge(PAGE, false))
    const bytes = readFileSync(path)
    const size = bytes.length
    expect(size).toBeGreaterThan(PAGE)
    expect(size).toBeLessThan(2 * PAGE)
    expect(bytes[size - 1]).not.toBe(0x0a)
    expect(bytes[size - PAGE - 1]).toBe(0xe2)
    expect(bytes[size - PAGE]).toBe(0x82)
    expect(bytes[size - PAGE + 1]).toBe(0xac)
    // ⚑ The control: the same reply short enough to sit in one page.
    expect(newestReplyModel(aTranscript(`${OLD}${HEAD}€"}}`))).toBe('claude-€')
    // ⛔ Split by the edge, still the newest and still whole.
    expect(newestReplyModel(path)).toBe('claude-€')
  })
})

describe('§3 · ⛔ the 4 MiB budget', () => {
  it('⚑ a reply in a file of exactly 4 MiB is found — ⛔ one byte more and it is not', () => {
    const first = reply('m1')
    const within = aTranscript(first + filler(BUDGET - Buffer.byteLength(first)))
    const beyond = aTranscript(first + filler(BUDGET - Buffer.byteLength(first) + 1))
    expect(statSync(within).size).toBe(BUDGET)
    expect(statSync(beyond).size).toBe(BUDGET + 1)
    expect(newestReplyModel(within)).toBe('m1')
    expect(newestReplyModel(beyond)).toBe(null)
  })
})
