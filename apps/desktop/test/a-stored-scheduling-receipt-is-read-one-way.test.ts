import { describe, expect, it } from 'vitest'
import type { SessionStore } from '../src/main/db/session-store'
import { MAX_SCHEDULE_EVIDENCE_ROWS } from '../src/main/db/session-store-parts/session-store-rows'
import { recordedScheduleReceipt } from '../src/main/providers/worker-safe'
import { withAScheduleLedger } from './lib/scheduling-calls-fixture'

/**
 * **A stored scheduling receipt is read one way, by the ledger query and by the evidence alike.**
 * A row that names its action is read by its action, even if it also names a tool; an older row
 * that names only a tool is read as the action that tool's call was.
 */

const CONVERSATION = 'sess_stored'

describe('a stored receipt, decoded', () => {
  it('an older row’s tool is read as its action, and the tool is not kept', () => {
    expect(
      recordedScheduleReceipt({
        tool: 'CronDelete',
        toolUseId: 't',
        answeredAt: 1,
        input: { id: 'a' },
      }),
    ).toEqual({ action: 'cancel', toolUseId: 't', answeredAt: 1, input: { id: 'a' } })
    expect(recordedScheduleReceipt({ tool: 'CronCreate', toolUseId: 't', answeredAt: 1 })).toEqual({
      action: 'create',
      toolUseId: 't',
      answeredAt: 1,
    })
  })

  it('⚑ a row that names its action is read by it, whatever tool it also names', () => {
    const both = { action: 'list', tool: 'CronCreate', toolUseId: 't', answeredAt: 1 }
    expect(recordedScheduleReceipt(both)?.action).toBe('list')
  })

  it('⛔ a tool no build stored, or none, is no receipt', () => {
    expect(recordedScheduleReceipt({ tool: 'Bash', toolUseId: 't', answeredAt: 1 })).toBeUndefined()
    expect(recordedScheduleReceipt({ tool: 'constructor', toolUseId: 't' })).toBeUndefined()
    expect(recordedScheduleReceipt({ toolUseId: 't', answeredAt: 1 })).toBeUndefined()
  })
})

describe('the ledger query', () => {
  /** A ledger written receipt by receipt, a moment apart, and read back by the query. */
  const withAStore = (
    run: (
      put: (receipt: object) => void,
      read: () => ReturnType<SessionStore['scheduleEvidenceRows']>,
    ) => void,
  ) =>
    withAScheduleLedger(CONVERSATION, (put, store) => {
      let at = 1_000
      run(
        (receipt) =>
          put(
            'scheduled_work',
            { type: 'scheduled_work', receipt, source: 'hook/PostToolUse' },
            ++at,
          ),
        () => store.scheduleEvidenceRows(CONVERSATION),
      )
    })
  const idsOf = (read: { rows: readonly { payload: unknown }[] }) =>
    read.rows.map((one) => (one.payload as { receipt: { toolUseId: string } }).receipt.toolUseId)

  it('⚑ a row that names its action is kept or left out by it, as the evidence reads it', () => {
    withAStore((put, read) => {
      put({ action: 'list', tool: 'CronCreate', toolUseId: 'listed', answeredAt: 1 })
      put({ action: 'create', tool: 'CronList', toolUseId: 'made', answeredAt: 2 })
      put({ action: null, tool: 'CronCreate', toolUseId: 'unnamed', answeredAt: 3 })
      expect(idsOf(read())).toEqual(['made'])
    })
  })

  it('🔴 receipts that make or cancel a job count towards the cap in either shape; a listing’s or a wake-up’s in either shape do not', () => {
    withAStore((put, read) => {
      for (let i = 0; i < MAX_SCHEDULE_EVIDENCE_ROWS - 1; i += 1) {
        put(
          i % 2 === 0
            ? { tool: 'CronCreate', toolUseId: `old-${String(i)}`, answeredAt: i }
            : { action: 'cancel', toolUseId: `new-${String(i)}`, answeredAt: i },
        )
      }
      put({ tool: 'CronList', toolUseId: 'old-list', answeredAt: 1 })
      put({ tool: 'ScheduleWakeup', toolUseId: 'old-wake', answeredAt: 1 })
      put({ action: 'list', toolUseId: 'new-list', answeredAt: 1 })
      put({ action: 'wakeup', toolUseId: 'new-wake', answeredAt: 1 })
      const under = read()
      expect(under.rows).toHaveLength(MAX_SCHEDULE_EVIDENCE_ROWS - 1)
      expect(under.cut).toBe(false)

      put({ action: 'create', toolUseId: 'the-last', answeredAt: 1 })
      put({ tool: 'CronDelete', toolUseId: 'one-more', answeredAt: 1 })
      const over = read()
      expect(over.rows).toHaveLength(MAX_SCHEDULE_EVIDENCE_ROWS)
      expect(over.cut).toBe(true)
      expect(idsOf(over).slice(-2)).toEqual(['the-last', 'one-more'])
      expect(idsOf(over)).not.toContain('old-0')
    })
  })
})
