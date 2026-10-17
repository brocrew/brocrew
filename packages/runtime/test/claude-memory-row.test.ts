import { mkdirSync, realpathSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { SDKMessage } from '@anthropic-ai/claude-agent-sdk'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { ClaudeMemoryStore } from '../src/claude/memory-store'
import { normalizeMessage } from '../src/claude/normalize'
import { MAX_MEMORY_PATH, runtimeEventSchema, type RuntimeEvent } from '../src/events'

/**
 * 330 · 🔴 **The row, as a real session builds it.**
 *
 * Use the three frame shapes captured from a live `2.1.218` child: `init` with
 * `memory_paths.auto`, an assistant message containing `Bash ls` and two `Write` tool uses,
 * and one shared registry across them. `ClaudeSessionHandle` retains the registry; rebuilding
 * it per frame cannot recognize the memory actions.
 */

let root = ''
let store = ''
let cwd = ''

function init(auto: string | undefined): SDKMessage {
  return {
    type: 'system',
    subtype: 'init',
    session_id: 's',
    ...(auto === undefined ? {} : { memory_paths: { auto: `${auto}/` } }),
  } as unknown as SDKMessage
}

function calls(blocks: Record<string, unknown>[]): SDKMessage {
  return {
    type: 'assistant',
    session_id: 's',
    parent_tool_use_id: null,
    message: { role: 'assistant', content: blocks },
  } as unknown as SDKMessage
}

/** The whole session through ONE registry, as the handle runs it. */
function rowsFor(auto: string | undefined, blocks: Record<string, unknown>[]): RuntimeEvent[] {
  const memory = new ClaudeMemoryStore()
  const out: RuntimeEvent[] = []
  for (const message of [init(auto), calls(blocks)]) {
    out.push(...normalizeMessage(message, undefined, undefined, undefined, undefined, memory))
  }
  return out
}

function toolCalls(events: RuntimeEvent[]): Extract<RuntimeEvent, { type: 'tool_call' }>[] {
  return events.filter(
    (e): e is Extract<RuntimeEvent, { type: 'tool_call' }> => e.type === 'tool_call',
  )
}

/** The three measured memory-action rows in capture order. */
function theCapture(): Record<string, unknown>[] {
  return [
    { type: 'tool_use', id: 't1', name: 'Bash', input: { command: `ls "${store}/" 2>/dev/null` } },
    {
      type: 'tool_use',
      id: 't2',
      name: 'Write',
      input: { file_path: join(store, 'user_name.md'), content: '…' },
    },
    {
      type: 'tool_use',
      id: 't3',
      name: 'Write',
      input: { file_path: join(store, 'MEMORY.md'), content: '…' },
    },
  ]
}

beforeEach(() => {
  // Real-pathed for `claude-memory-store.test.ts`' reason: a `/var` store whose real root is
  // `/private/var` fails every containment test for a reason no assertion here is about.
  root = join(
    realpathSync(tmpdir()),
    `brobot2-330-row-${process.pid}-${Math.random().toString(36).slice(2)}`,
  )
  store = join(root, 'home', 'memory')
  cwd = join(root, 'work')
  mkdirSync(store, { recursive: true })
  mkdirSync(cwd, { recursive: true })
})

afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

describe('330 · the memory write, as a row', () => {
  it('🔴 the two Writes say memory; the Bash beside them does not', () => {
    // ⛔ **§0, restated as an assertion.** Four rows, and *"nothing on any of those four rows says
    // memory"*. Now two of them do, and the one that must not still does not.
    const rows = toolCalls(rowsFor(store, theCapture()))
    expect(rows.map((r) => r.name)).toEqual(['Bash', 'Write', 'Write'])
    expect(rows.map((r) => r.memoryPath)).toEqual([undefined, 'user_name.md', 'MEMORY.md'])
  })

  it('⚠️ the whole path is still on the row — nothing was traded away for the label', () => {
    // 330 §3.5 asked for a readable path and NOT for a shorter record. `summary` is untouched, so
    // the absolute path is still what a copy-paste and the ledger carry.
    const [, write] = toolCalls(rowsFor(store, theCapture()))
    expect(write?.summary).toBe(join(store, 'user_name.md'))
    expect(write?.memoryPath).toBe('user_name.md')
  })

  it('⛔ the SAME frames, with no memory_paths on the wire, label nothing', () => {
    // ⚑ The pair that makes the assertion above about the FIELD rather than about the fixture.
    const rows = toolCalls(rowsFor(undefined, theCapture()))
    expect(rows.map((r) => r.name)).toEqual(['Bash', 'Write', 'Write'])
    expect(rows.every((r) => r.memoryPath === undefined)).toBe(true)
    expect(rows[1]?.summary).toBe(join(store, 'user_name.md'))
  })

  it('⛔ an ordinary write in the same turn is not a memory row', () => {
    const rows = toolCalls(
      rowsFor(store, [
        { type: 'tool_use', id: 't1', name: 'Write', input: { file_path: join(cwd, 'notes.md') } },
        {
          type: 'tool_use',
          id: 't2',
          name: 'Write',
          input: { file_path: join(store, 'notes.md') },
        },
      ]),
    )
    expect(rows.map((r) => r.memoryPath)).toEqual([undefined, 'notes.md'])
  })

  it('⚠️ a memory row keeps everything else a row carries', () => {
    // A conditional spread is easy to write in a way that drops what was already there.
    const rows = toolCalls(
      rowsFor(store, [
        { type: 'tool_use', id: 't1', name: 'Edit', input: { file_path: join(store, 'x.md') } },
      ]),
    )
    expect(rows[0]).toEqual({
      type: 'tool_call',
      id: 't1',
      name: 'Edit',
      summary: join(store, 'x.md'),
      memoryPath: 'x.md',
    })
  })

  it('⛔ the ledger refuses a memory target past its cap, and keeps an ordinary one', () => {
    // `MAX_MEMORY_PATH` is what stops a field from carrying four kilobytes into a one-line row. It is
    // a schema bound rather than a truncation, because a shortened relative path is a wrong path —
    // and the untruncated absolute path is on `summary` regardless.
    //
    // ⛔ **LITERALS, not `MAX_MEMORY_PATH ± 1`, and that is the whole point of this test.** A bound
    // expressed in terms of the constant moves WITH the constant: raise the cap to 64 KiB and an
    // assertion written as `repeat(MAX_MEMORY_PATH + 1)` goes on passing over a field that now
    // accepts sixty-four kilobytes. The number is what is being pinned, so the number is written.
    expect(MAX_MEMORY_PATH).toBe(512)
    const long = 'a'.repeat(513)
    expect(
      runtimeEventSchema.safeParse({
        type: 'tool_call',
        id: 't1',
        name: 'Write',
        summary: 's',
        memoryPath: long,
      }).success,
    ).toBe(false)
    expect(
      runtimeEventSchema.safeParse({
        type: 'tool_call',
        id: 't1',
        name: 'Write',
        summary: 's',
        memoryPath: 'a'.repeat(512),
      }).success,
    ).toBe(true)
  })

  it('⛔ an ordinary row carries no memoryPath KEY, not an undefined one', () => {
    // The absent-is-a-fact shape the neighbouring optional fields use — and the shape the ledger
    // round-trips. `toEqual` ignores an explicit `undefined`; `in` does not.
    const [row] = toolCalls(
      rowsFor(store, [
        { type: 'tool_use', id: 't1', name: 'Write', input: { file_path: join(cwd, 'x.md') } },
      ]),
    )
    expect(row && 'memoryPath' in row).toBe(false)
  })
})
