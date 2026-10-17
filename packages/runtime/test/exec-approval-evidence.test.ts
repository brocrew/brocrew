import { describe, expect, it } from 'vitest'
import { executionEvidence, offers, type Frame } from '../smoke/exec-approval-evidence'

/**
 * 🔒 **`655` · the exec-permission probe's two judgments, held by `ci`** (`649` F7).
 *
 * ⛔ The probe claimed its only answer is the provider-offered `cancel` and that `/usr/bin/true`
 * never runs — and asserted neither. The probe's run checks them against the real provider; this
 * file checks that the JUDGMENTS are right, on both sides of each line, so a run cannot pass by
 * asking a question that could only answer yes.
 */

const item = (fields: Record<string, unknown>): Record<string, unknown> => ({
  type: 'commandExecution',
  id: 'call_495',
  command: '/bin/zsh -lc /usr/bin/true',
  processId: null,
  status: 'inProgress',
  exitCode: null,
  ...fields,
})
const started = (fields: Record<string, unknown>): Frame => ({
  method: 'item/started',
  params: { item: item(fields), threadId: 't', turnId: 'u' },
})
const completed = (fields: Record<string, unknown>): Frame => ({
  method: 'item/completed',
  params: { item: item(fields), threadId: 't', turnId: 'u', completedAtMs: 1 },
})

describe('655 · offers — only a decision the provider listed may be sent', () => {
  it('⚑ cancel is sendable when the raw request lists it', () => {
    expect(offers({ availableDecisions: ['accept', 'cancel'] }, 'cancel')).toBe(true)
  })

  it('⛔ and not when it does not — or when the list is absent, null or malformed', () => {
    expect(offers({ availableDecisions: ['accept'] }, 'cancel')).toBe(false)
    expect(offers({ availableDecisions: null }, 'cancel')).toBe(false)
    expect(offers({}, 'cancel')).toBe(false)
    expect(offers({ availableDecisions: 'cancel' }, 'cancel')).toBe(false)
    expect(offers(null, 'cancel')).toBe(false)
  })
})

describe('655 · executionEvidence — "did not run" read off the provider’s own record', () => {
  it('⚑ a declined item, or no command item at all, reports nothing that ran', () => {
    expect(executionEvidence([started({}), completed({ status: 'declined' })]).ranBecause).toEqual(
      [],
    )
    expect(executionEvidence([{ method: 'turn/completed', params: {} }]).ranBecause).toEqual([])
  })

  it('⛔ failed with no process and no exit code is not execution', () => {
    expect(executionEvidence([completed({ status: 'failed' })]).ranBecause).toEqual([])
  })

  it('🔴 each execution fact, alone, says it RAN', () => {
    expect(executionEvidence([completed({ status: 'completed' })]).ranBecause).toEqual([
      'item call_495 status completed',
    ])
    expect(executionEvidence([started({ processId: '4242' })]).ranBecause).toEqual([
      'item call_495 processId 4242',
    ])
    expect(executionEvidence([completed({ status: 'failed', exitCode: 1 })]).ranBecause).toEqual([
      'item call_495 exitCode 1',
    ])
    expect(
      executionEvidence([
        { method: 'item/commandExecution/outputDelta', params: { itemId: 'call_495', delta: 'x' } },
      ]).ranBecause,
    ).toEqual(['1 item/commandExecution/outputDelta frame(s)'])
  })

  it('🔴 a fact counts wherever it appears — a later frame that omits it cannot erase it', () => {
    // ⚑ `655` review: the first version kept only each item's last frame, so a processId on
    // item/started followed by a `declined` completion read as *did not run*.
    expect(
      executionEvidence([started({ processId: '4242' }), completed({ status: 'declined' })])
        .ranBecause,
    ).toEqual(['item call_495 processId 4242'])
    expect(
      executionEvidence([
        completed({ status: 'failed', exitCode: 2 }),
        completed({ status: 'failed' }),
      ]).ranBecause,
    ).toEqual(['item call_495 exitCode 2'])
  })

  it('⚠️ reads the LAST state of each item, so a start with no process then a decline stays clean', () => {
    const evidence = executionEvidence([started({}), completed({ status: 'declined' })])
    expect(evidence.items).toEqual([
      { id: 'call_495', status: 'declined', processId: null, exitCode: null },
    ])
  })

  it('⚑ ignores items that are not commands — a file change is not this probe’s question', () => {
    const fileChange: Frame = {
      method: 'item/completed',
      params: { item: { type: 'fileChange', id: 'f1', status: 'completed' } },
    }
    expect(executionEvidence([fileChange]).items).toEqual([])
  })
})
