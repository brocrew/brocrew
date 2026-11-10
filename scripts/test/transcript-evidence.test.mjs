import { describe, expect, it, vi } from 'vitest'
import { activeTranscriptHistory, ACTIVE_TRANSCRIPT_HISTORY } from '../lib/transcript-evidence.mjs'

const page = (entries, more = {}) => ({
  entries,
  from: entries[0]?.ordinal ?? 0,
  hasOlder: false,
  ...more,
})
const documentFor = (id) => ({
  querySelector: vi.fn(() => (id === null ? null : { dataset: { sessionId: id } })),
})

describe('normal transcript observations for live probes', () => {
  it('does not invent counters or read a session before a normal conversation exists', async () => {
    const runtime = { latestHistory: vi.fn() }
    expect(await activeTranscriptHistory(runtime, documentFor(null))).toBeNull()
    expect(runtime.latestHistory).not.toHaveBeenCalled()
  })

  it('uses one bounded normal-history read and preserves actual ordering and completeness facts', async () => {
    const entries = [
      { ordinal: 71, event: { type: 'session', ref: { secret: 'not-observed' } } },
      { ordinal: 72, event: { type: 'turn', state: 'completed' } },
    ]
    const runtime = {
      latestHistory: vi.fn(async () => page(entries, { hasOlder: true })),
      onEvent: vi.fn(),
    }
    const result = await activeTranscriptHistory(runtime, documentFor('fictional-session'))
    expect(runtime.latestHistory).toHaveBeenCalledExactlyOnceWith({
      sessionId: 'fictional-session',
    })
    expect(runtime.onEvent).not.toHaveBeenCalled()
    expect(result).toEqual({
      sessionId: 'fictional-session',
      from: 71,
      hasOlder: true,
      entries: [
        { ordinal: 71, event: { type: 'session' } },
        { ordinal: 72, event: { type: 'turn' } },
      ],
    })
  })

  it('keeps only the fields existing probes assert, without copying bodies, arguments or replies', async () => {
    const canary = 'fictional-content-must-not-be-copied'
    const entries = [
      { ordinal: 0, event: { type: 'tool_call', name: 'Read', id: 'call1', arguments: canary } },
      { ordinal: 1, event: { type: 'tool_result', result: canary } },
      {
        ordinal: 2,
        event: {
          type: 'unknown',
          provider: 'codex',
          category: 'lifecycle',
          label: 'degraded:tool_call',
          raw: canary,
        },
      },
      {
        ordinal: 3,
        event: {
          type: 'user_command',
          command: 'changed_approval_mode',
          target: 'ask',
          text: canary,
        },
      },
      {
        ordinal: 4,
        event: {
          type: 'scheduled_work',
          jobs: [{ id: 'job1', schedule: '* * * * *', prompt: canary }],
        },
      },
    ]
    const result = await activeTranscriptHistory(
      { latestHistory: async () => page(entries) },
      documentFor('session1'),
    )
    expect(JSON.stringify(result)).not.toContain(canary)
    expect(result.entries[0].event).toEqual({ type: 'tool_call', name: 'Read', id: 'call1' })
    expect(result.entries[2].event.label).toBe('degraded:tool_call')
    expect(result.entries[4].event.jobs).toEqual([{ id: 'job1', schedule: '* * * * *' }])
  })

  it('does not mix two selected conversations across the IPC await', async () => {
    const doc = documentFor('first')
    const runtime = {
      latestHistory: async () => {
        doc.querySelector.mockReturnValue({ dataset: { sessionId: 'second' } })
        return page([])
      },
    }
    await expect(activeTranscriptHistory(runtime, doc)).rejects.toThrow(
      'selected conversation changed',
    )
  })

  it('fails on a missing page boundary instead of assuming the page is complete', async () => {
    await expect(
      activeTranscriptHistory(
        { latestHistory: async () => ({ entries: [] }) },
        documentFor('session1'),
      ),
    ).rejects.toThrow('page boundary')
  })

  it('the serialized CDP observer is executable and uses the same real normal-history boundary', async () => {
    const runtime = {
      latestHistory: vi.fn(async () => page([{ ordinal: 0, event: { type: 'turn' } }])),
    }
    const run = new Function(
      'window',
      'document',
      `return (async () => { return ${ACTIVE_TRANSCRIPT_HISTORY} })()`,
    )
    const result = await run({ api: { runtime } }, documentFor('session1'))
    expect(runtime.latestHistory).toHaveBeenCalledExactlyOnceWith({ sessionId: 'session1' })
    expect(result.entries).toEqual([{ ordinal: 0, event: { type: 'turn' } }])
  })
})
