import { describe, expect, it, vi } from 'vitest'
import { compactConversation } from '../src/main/runtime/compact-conversation'
import { boundStoredEvent } from '../src/main/db/stored-event-codec'
import type { TranscriptEvent } from '../src/shared/conversation-events'

describe('a compaction request without a provider', () => {
  const dependencies = () => ({
    currentConversation: (id: string) => id,
    running: () => null,
    recorded: () => true,
    display: () => 'conversation W1 · Plan',
    queue: vi.fn<() => 'queued' | 'empty' | false>(() => 'queued'),
    deferred: () => false,
    idle: () => true,
    checkSignIn: vi.fn(async () => {}),
    providerCommands: vi.fn(async () => null),
    request: vi.fn(async () => {}),
    reportFailure: vi.fn(),
  })

  it('accepts a never-started conversation without starting or queueing provider work', async () => {
    const deps = dependencies()
    deps.queue.mockReturnValue('empty')
    expect(await compactConversation({ conversation: 'target', agent: 'caller' }, deps)).toEqual({
      ok: true,
      empty: true,
      conversation: 'target',
      display: 'conversation W1 · Plan',
    })
    expect(deps.checkSignIn).not.toHaveBeenCalled()
    expect(deps.providerCommands).not.toHaveBeenCalled()
    expect(deps.request).not.toHaveBeenCalled()
  })

  it('reports a failed history write without acknowledging a queued request', async () => {
    const deps = dependencies()
    const failed = new Error('the history write failed')
    deps.queue.mockImplementation(() => {
      throw failed
    })
    expect(
      await compactConversation({ conversation: 'target', agent: 'caller' }, deps),
    ).toMatchObject({
      ok: false,
      refusal: 'compaction-request-failed',
    })
    expect(deps.reportFailure).toHaveBeenCalledWith('target', failed)
    expect(deps.request).not.toHaveBeenCalled()
  })

  it('keeps the accepted optional reason whole when recording and decoding', async () => {
    const deps = dependencies()
    const reason = 'Retain the plan. '.repeat(1000)
    await compactConversation({ conversation: 'target', agent: 'caller', reason }, deps)
    expect(deps.queue).toHaveBeenCalledWith('target', { agent: 'caller', reason })
    const row = { type: 'pending_compaction' as const, request: { agent: 'caller', reason } }
    expect(boundStoredEvent(row)).toEqual(row)
    expect(boundStoredEvent({ type: 'pending_compaction', request: null })).toEqual({
      type: 'pending_compaction',
      request: null,
    })
    expect(() =>
      boundStoredEvent({
        type: 'pending_compaction',
        request: { agent: null },
      } as unknown as TranscriptEvent),
    ).toThrow('a stored compaction request could not be read')
  })
})
