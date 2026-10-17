import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import type { AgentState } from '../src/shared/agent-state'
import type { QueuedMessageDisclosure } from '../src/shared/runtime-ipc'
import {
  messageLimitDisplay,
  mergeProviderBlock,
  mergeHeldMessages,
  providerLimitDisplay,
} from '../src/renderer/src/lib/provider-limit-status'
import {
  acceptProviderBlock,
  acceptLiveness,
  createSessionRecord,
} from '../src/renderer/src/lib/session-record'

import { createProviderBlockStore } from '../src/renderer/src/lib/provider-limit-facts'

const NOW = Date.UTC(2026, 9, 8, 14)
const current = {
  providerBlockStatus: 'current',
  providerBlock: { provider: 'claude', resetsAt: NOW + 3600000 },
} as const
const queued: QueuedMessageDisclosure = {
  id: 'held-recipe',
  kind: 'notice',
  text: 'Recipe update',
  since: NOW,
  holdReasonStatus: 'current',
  holdReason: { is: 'provider-limit', provider: 'claude', resetsAt: NOW + 3600000 },
}

describe('Only current host facts say a conversation stopped for its limit', () => {
  it.each<AgentState>([{ is: 'idle' }, { is: 'scheduled', dueAt: NOW + 1000 }])(
    'overrides $is without changing its arm',
    (state) => {
      expect(providerLimitDisplay(current, state, NOW)?.word).toMatch(
        /^Stopped: Claude’s limit · resets in/,
      )
      expect(state.is).not.toBe('provider-limit')
    },
  )
  const protectedStates: AgentState[] = [
    { is: 'active' },
    { is: 'needs-you' },
    { is: 'waiting-on-an-answer', from: 'Ayo' },
    { is: 'waiting-on-a-worker', on: ['Ayo'] },
    { is: 'in-the-background', what: 'build' },
    { is: 'owes-an-answer', to: ['Ayo'] },
  ]
  it.each(protectedStates.map((state) => ({ state })))(
    'keeps $state.is precedence',
    ({ state }) => {
      expect(providerLimitDisplay(current, state, NOW)).toBeNull()
    },
  )
  it('requires explicit current authority and a block; old writers remain ordinary', () => {
    for (const facts of [
      undefined,
      {},
      { providerBlock: current.providerBlock },
      { providerBlockStatus: 'current' as const, providerBlock: null },
    ]) {
      expect(providerLimitDisplay(facts, { is: 'idle' }, NOW)).toBeNull()
    }
  })
  it('unknown and passed resets retain the stop, without inventing a countdown or a clear', () => {
    for (const resetsAt of [null, NOW - 1000]) {
      const display = providerLimitDisplay(
        { ...current, providerBlock: { provider: 'claude', resetsAt } },
        { is: 'idle' },
        NOW,
      )
      expect(display).not.toBeNull()
      expect(display!.word).toBe('Stopped: Claude’s limit')
      expect(display!.detail.includes('(passed)')).toBe(resetsAt !== null)
    }
  })
  it('keeps unavailable words short only on compact surfaces', () => {
    const facts = { providerBlockStatus: 'unavailable' } as const
    expect(providerLimitDisplay(facts, { is: 'idle' }, NOW)?.short).toBe('Limit unavailable')
    const held = messageLimitDisplay({ ...queued, holdReasonStatus: 'unavailable' }, NOW)
    expect(held?.short).toBe('not sent · limit unavailable')
    expect(held?.heldShort).toBe('limit unavailable')
    expect(held?.word).toBe('not sent · limit status unavailable')
    expect(held?.heldWord).toBe('limit status unavailable')
  })

  it('unavailable invalidates the retained current reading; omission leaves it alone', () => {
    const omitted = mergeProviderBlock(current, {})
    expect(providerLimitDisplay(omitted, { is: 'idle' }, NOW)?.short).toBe('Claude limit')
    const unavailable = mergeProviderBlock(omitted, { providerBlockStatus: 'unavailable' })
    expect(unavailable.providerBlock).toEqual(current.providerBlock)
    const incompleteRenewal = mergeProviderBlock(unavailable, { providerBlockStatus: 'current' })
    expect(providerLimitDisplay(incompleteRenewal, { is: 'idle' }, NOW)?.word).toBe(
      'Current limit status unavailable',
    )
    expect(providerLimitDisplay(unavailable, { is: 'idle' }, NOW)?.word).toBe(
      'Current limit status unavailable',
    )
    expect(
      providerLimitDisplay(
        mergeProviderBlock(unavailable, { providerBlockStatus: 'current', providerBlock: null }),
        { is: 'idle' },
        NOW,
      ),
    ).toBeNull()
  })
  it('state pushes arriving before a descriptor are kept without synthesizing a session', () => {
    const record = createSessionRecord('recipe')
    acceptProviderBlock(record, current)
    expect(record.meta).toBeNull()
    expect(record.earlyProviderBlock).toEqual(current)
    acceptLiveness(record, {
      state: 'ended',
      since: NOW,
      providerBlockStatus: 'current',
      providerBlock: null,
    })
    expect(record.earlyProviderBlock?.providerBlock).toBeNull()
  })
})

describe('A held message has only its own live reason', () => {
  it('draws the current provider and exact reset; unknown time stays unknown', () => {
    expect(messageLimitDisplay(queued, NOW)?.word).toContain(
      'not sent · waiting for Claude’s limit to reset',
    )
    expect(
      messageLimitDisplay({ ...queued, holdReason: { ...queued.holdReason!, resetsAt: null } }, NOW)
        ?.word,
    ).not.toContain('resets in')
  })
  it('explicit exempt/null and missing old fields do not invent a hold', () => {
    expect(messageLimitDisplay(undefined, NOW)).toBeNull()
    expect(messageLimitDisplay({ ...queued, holdReason: null }, NOW)).toBeNull()
    expect(messageLimitDisplay({ ...queued, holdReasonStatus: undefined }, NOW)).toBeNull()
  })
  it('a failed read does not keep a known stale hold current', () => {
    expect(messageLimitDisplay({ ...queued, holdReasonStatus: 'unavailable' }, NOW)?.word).toBe(
      'not sent · limit status unavailable',
    )
  })
})

describe('Queue snapshots keep omitted facts only while that same ID remains', () => {
  const omitted = { id: queued.id, kind: queued.kind, text: 'Updated words', since: NOW + 1 }
  it('retains the reason through omitted fields, without retaining stale text', () => {
    const next = mergeHeldMessages([queued], [omitted])!
    expect(next[0]?.text).toBe('Updated words')
    expect(messageLimitDisplay(next[0], NOW)?.short).toBe('not sent · Claude limit')
  })
  it('retains unavailability through omission and refuses a status-only renewal', () => {
    const failed = mergeHeldMessages([queued], [{ ...omitted, holdReasonStatus: 'unavailable' }])!
    for (const update of [omitted, { ...omitted, holdReasonStatus: 'current' as const }]) {
      const next = mergeHeldMessages(failed, [update])!
      expect(messageLimitDisplay(next[0], NOW)?.word).toBe('not sent · limit status unavailable')
    }
  })
  it('a status-only reading cannot promote a retained reason that never had current authority', () => {
    const before = [{ ...queued, holdReasonStatus: undefined }]
    const incomplete = mergeHeldMessages(before, [{ ...omitted, holdReasonStatus: 'current' }])
    expect(incomplete[0]!.holdReasonStatus).toBeUndefined()
    expect(messageLimitDisplay(incomplete[0], NOW)).toBeNull()
    const explicit = mergeHeldMessages(incomplete, [
      { ...omitted, holdReasonStatus: 'current', holdReason: queued.holdReason },
    ])
    expect(messageLimitDisplay(explicit[0], NOW)?.short).toBe('not sent · Claude limit')
  })
  it.each([null, []])('full removal %j prevents an ID from reviving its old hold', (removal) => {
    const removed = mergeHeldMessages([queued], removal)
    expect(messageLimitDisplay(mergeHeldMessages(removed, [omitted])![0], NOW)).toBeNull()
  })
  it('a different ID never inherits the old hold; explicit null clears the same ID', () => {
    expect(
      messageLimitDisplay(mergeHeldMessages([queued], [{ ...omitted, id: 'new-recipe' }])![0], NOW),
    ).toBeNull()
    expect(
      messageLimitDisplay(
        mergeHeldMessages(
          [queued],
          [{ ...omitted, holdReasonStatus: 'current', holdReason: null }],
        )![0],
        NOW,
      ),
    ).toBeNull()
  })
})

describe('One ordered fact authority spans state, liveness, descriptors and lists', () => {
  it.each(['clear', 'unavailable'] as const)(
    'later liveness %s defeats a retained state push and an older list read',
    (change) => {
      const facts = createProviderBlockStore()
      facts.acceptMany([{ conversation: 'recipe', ...current }])
      const oldRead = facts.beginRead()
      facts.accept(
        'recipe',
        change === 'clear'
          ? { providerBlockStatus: 'current', providerBlock: null }
          : { providerBlockStatus: 'unavailable' },
      )
      facts.acceptListed([{ sessionId: 'recipe', ...current }], oldRead)
      expect(providerLimitDisplay(facts.get('recipe'), { is: 'idle' }, NOW)?.word ?? 'idle').toBe(
        change === 'clear' ? 'idle' : 'Current limit status unavailable',
      )
      expect(facts.snapshot().get('recipe')).toEqual(facts.get('recipe'))
    },
  )
  it('a later state push defeats liveness; a fresh list then supersedes both', () => {
    const facts = createProviderBlockStore()
    facts.accept('recipe', { providerBlockStatus: 'current', providerBlock: null })
    facts.acceptMany([{ conversation: 'recipe', ...current }])
    expect(
      providerLimitDisplay(facts.get('recipe'), { is: 'scheduled', dueAt: NOW }, NOW)?.short,
    ).toBe('Claude limit')
    const freshRead = facts.beginRead()
    facts.acceptListed(
      [{ sessionId: 'recipe', providerBlockStatus: 'current', providerBlock: null }],
      freshRead,
    )
    expect(providerLimitDisplay(facts.get('recipe'), { is: 'idle' }, NOW)).toBeNull()
  })
  it('a later requested read stays authoritative even when an older read resolves last', () => {
    const facts = createProviderBlockStore()
    const first = facts.beginRead(),
      second = facts.beginRead()
    facts.acceptListed([{ sessionId: 'recipe', providerBlockStatus: 'unavailable' }], second)
    facts.acceptListed([{ sessionId: 'recipe', ...current }], first)
    expect(providerLimitDisplay(facts.get('recipe'), { is: 'idle' }, NOW)?.word).toBe(
      'Current limit status unavailable',
    )
  })
  it('omitted fields do not clear or renew facts; different IDs stay independent', () => {
    const facts = createProviderBlockStore()
    facts.accept('recipe', current)
    facts.acceptMany([
      { conversation: 'recipe' },
      { conversation: 'oven', providerBlockStatus: 'unavailable' },
    ])
    expect(facts.get('recipe')).toEqual(current)
    expect(facts.get('oven')?.providerBlockStatus).toBe('unavailable')
  })
  it('disposed windows accept no late read or push', () => {
    const facts = createProviderBlockStore(),
      readAt = facts.beginRead()
    facts.accept('recipe', current)
    facts.dispose()
    facts.acceptListed([{ sessionId: 'recipe', ...current }], readAt)
    facts.accept('recipe', current)
    expect(facts.get('recipe')).toBeNull()
  })
})

describe('The root installs the ordered channel and passes its authority to both views', () => {
  it('uses the real root subscription helper and the same window-owned facts for rail and pane', () => {
    const source = readFileSync(
      new URL('../src/renderer/src/components/RuntimeScreen.vue', import.meta.url),
      'utf8',
    )
    expect(source).toContain(
      'stopHearingStates = listenProviderStates(window.api.runtime, store, (message) => {',
    )
    expect(source).toContain(':provider-blocks="store.providerBlocks"')
    expect(source).toContain(
      ':provider-block="active ? store.providerBlocks.get(active.sessionId) : null"',
    )
  })
})
