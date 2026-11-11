import { describe, expect, it } from 'vitest'
import { createProviderBlockStore } from '../src/renderer/src/lib/provider-limit-facts'
import {
  mergeProviderBlock,
  providerLimitDisplay,
} from '../src/renderer/src/lib/provider-limit-status'
import type { LastKnownProviderBlock } from '../src/shared/runtime-ipc'

const AT = Date.UTC(2026, 9, 8, 21)
const history: LastKnownProviderBlock = {
  provider: 'claude',
  resetsAt: AT + 3 * 60 * 60_000,
  asOf: AT,
  displayUntil: AT + 3 * 60 * 60_000,
}
const unavailable = { providerBlockStatus: 'unavailable', providerBlockLastKnown: history } as const

describe('dated conversation history stays separate from current facts', () => {
  it('shows the original historical date beside an explicitly unavailable current status', () => {
    const shown = providerLimitDisplay(unavailable, { is: 'idle' }, AT + 60_000)
    expect(shown?.word).toBe('Current limit status unavailable')
    expect(shown?.short).toBe('Limit unavailable')
    expect(shown?.history).toMatch(/^Last known: stopped at Claude’s limit · as of /)
    expect(shown?.detail).toContain(shown!.history!)
    expect(
      providerLimitDisplay(unavailable, { is: 'scheduled', dueAt: AT + 120_000 }, AT + 60_000)
        ?.history,
    ).toBe(shown?.history)
  })

  it('current clear and active or human-wait states never acquire a historical stop override', () => {
    expect(
      providerLimitDisplay(
        { ...unavailable, providerBlockStatus: 'current', providerBlock: null },
        { is: 'idle' },
        AT + 1,
      ),
    ).toBeNull()
    expect(providerLimitDisplay(unavailable, { is: 'active' }, AT + 1)).toBeNull()
  })

  it('does not manufacture history from an older retained block without a validated date', () => {
    const kept = mergeProviderBlock(
      {
        providerBlockStatus: 'current',
        providerBlock: { provider: 'claude', resetsAt: history.resetsAt },
      },
      { providerBlockStatus: 'unavailable' },
    )
    const shown = providerLimitDisplay(kept, { is: 'idle' }, AT + 1)
    expect(shown?.word).toBe('Current limit status unavailable')
    expect(shown).not.toHaveProperty('history')
  })

  it('known reset and unknown five-minute deadlines retire only history', () => {
    expect(
      providerLimitDisplay(unavailable, { is: 'idle' }, history.resetsAt! - 1)?.history,
    ).toBeDefined()
    expect(
      providerLimitDisplay(unavailable, { is: 'idle' }, history.resetsAt!)?.history,
    ).toBeUndefined()
    const unknown = {
      ...unavailable,
      providerBlockLastKnown: { ...history, resetsAt: null, displayUntil: AT + 5 * 60_000 },
    }
    expect(
      providerLimitDisplay(unknown, { is: 'idle' }, AT + 5 * 60_000 - 1)?.history,
    ).toBeDefined()
    const expired = providerLimitDisplay(unknown, { is: 'idle' }, AT + 5 * 60_000)
    expect(expired?.word).toBe('Current limit status unavailable')
    expect(expired).not.toHaveProperty('history')
  })

  it('uses the supplied cutoff without deriving a duration from the reset or confirmation', () => {
    const supplied = { ...unavailable, providerBlockLastKnown: { ...history, displayUntil: AT + 7 } }
    expect(providerLimitDisplay(supplied, { is: 'idle' }, AT + 6)?.history).toBeDefined()
    expect(providerLimitDisplay(supplied, { is: 'idle' }, AT + 7)?.history).toBeUndefined()
  })

  it('older facts use only their explicit finite reset, leaving unknown history absent', () => {
    const older = { provider: history.provider, resetsAt: history.resetsAt, asOf: history.asOf }
    const known = { ...unavailable, providerBlockLastKnown: older }
    expect(providerLimitDisplay(known, { is: 'idle' }, older.resetsAt! - 1)?.history).toBeDefined()
    expect(providerLimitDisplay(known, { is: 'idle' }, older.resetsAt!)?.history).toBeUndefined()
    const unknown = { ...known, providerBlockLastKnown: { ...older, resetsAt: null } }
    const shown = providerLimitDisplay(unknown, { is: 'idle' }, AT + 1)
    expect(shown?.word).toBe('Current limit status unavailable')
    expect(shown).not.toHaveProperty('history')
  })

  it.each([NaN, Infinity])('an invalid supplied deadline shows no historical stop (%s)', (displayUntil) => {
    const invalid = { ...unavailable, providerBlockLastKnown: { ...history, displayUntil } }
    expect(providerLimitDisplay(invalid, { is: 'idle' }, AT + 1)?.history).toBeUndefined()
  })

  it.each([NaN, AT - 1])('an unverifiable history clock shows no stop (%s)', (now) => {
    expect(providerLimitDisplay(unavailable, { is: 'idle' }, now)).not.toHaveProperty('history')
  })

  it('a history-only null push retires the value and an older descriptor cannot revive it', () => {
    const store = createProviderBlockStore()
    try {
      store.accept('fictional', unavailable)
      const oldRead = store.beginRead()
      store.acceptMany([{ conversation: 'fictional', providerBlockLastKnown: null }])
      expect(store.get('fictional')).toMatchObject({
        providerBlockStatus: 'unavailable',
        providerBlockLastKnown: null,
      })
      store.acceptListed([{ sessionId: 'fictional', ...unavailable }], oldRead)
      expect(store.get('fictional')?.providerBlockLastKnown).toBeNull()
      store.accept('fictional', {})
      expect(store.get('fictional')?.providerBlockLastKnown).toBeNull()
      expect(
        providerLimitDisplay(store.get('fictional'), { is: 'idle' }, AT + 1),
      ).not.toHaveProperty('history')
    } finally {
      store.dispose()
    }
  })
})
