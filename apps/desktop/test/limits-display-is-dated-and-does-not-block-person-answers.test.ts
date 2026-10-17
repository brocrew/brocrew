import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { runInNewContext } from 'node:vm'
import { describe, expect, it, vi } from 'vitest'
import type { LimitsDisplayAnswer, LimitsDisplayReading } from '../src/shared/limits-display'
import {
  limitsDisplayLabel,
  limitsDisplayLane,
  type LimitsDisplayState,
} from '../src/renderer/src/lib/limits-display'
import { providerLimitsView } from '../src/renderer/src/lib/persons-queue'
import { readProviderLimit } from '../src/shared/provider-limit'

const NOW = Date.UTC(2026, 9, 8, 22)
function answer(operation = 1, signInEpoch = 1): LimitsDisplayAnswer {
  const wall = readProviderLimit('claude is rate-limited (five_hour)', NOW)
  if (wall === null) throw new Error('fictional limit not recognized')
  return {
    is: 'read',
    reading: {
      operation,
      databaseEpoch: 1,
      signInEpoch,
      pinStartedAt: NOW,
      pinFinishedAt: NOW + 1,
      evaluatedAt: NOW + 2,
      usageAt: NOW - 10,
      finishedAt: NOW + 3,
      walked: {
        walk: 'every-provider-wall-recently-recorded',
        rows: [wall],
        ledgers: 1,
        rowsUnread: 0,
      },
    },
  }
}
function deferred<Value>() {
  let resolve!: (value: Value) => void
  return {
    promise: new Promise<Value>((done) => {
      resolve = done
    }),
    finish: (value: Value) => resolve(value),
  }
}
function fixture() {
  let state: LimitsDisplayState = { status: 'updating', reading: null }
  const lane = limitsDisplayLane((next) => {
    state = next
  })
  return { lane, state: () => state }
}

describe('the limits display retains dated evidence without current-state authority', () => {
  it('shows updating with the original date, then unavailable without restamping last good', async () => {
    const { lane, state } = fixture()
    await lane.refresh(async () => answer())
    const good = state().reading
    expect(good?.evaluatedAt).toBe(NOW + 2)
    const pending = deferred<LimitsDisplayAnswer | null>()
    const refresh = lane.refresh(() => pending.promise)
    expect(state()).toEqual({ status: 'updating', reading: good })
    pending.finish(null)
    await refresh
    expect(state()).toEqual({ status: 'unavailable', reading: good })
    expect(limitsDisplayLabel(state())).toBe('Limits unavailable')
  })

  it('reverse rounds cannot replace a newer reading or its date', async () => {
    const { lane, state } = fixture()
    const old = deferred<LimitsDisplayAnswer>()
    const pending = lane.refresh(() => old.promise)
    await lane.refresh(async () => answer(2))
    old.finish(answer(1))
    await pending
    expect(state().reading?.operation).toBe(2)
    expect(state().status).toBe('ready')
  })

  it('sign-in scope drops last good and rejects both old replies and older notifications', async () => {
    const { lane, state } = fixture()
    await lane.refresh(async () => answer())
    const old = deferred<LimitsDisplayAnswer>()
    const pending = lane.refresh(() => old.promise)
    lane.changed({ why: 'scope', databaseEpoch: 1, signInEpoch: 2 })
    expect(state()).toEqual({ status: 'unavailable', reading: null })
    old.finish(answer())
    await pending
    await lane.refresh(async () => answer(3, 2))
    lane.changed({ why: 'unavailable', databaseEpoch: 1, signInEpoch: 1 })
    expect(state().reading?.operation).toBe(3)
    expect(state().status).toBe('ready')
  })

  it('worker death preserves only dated history and quit prevents a late replacement', async () => {
    const { lane, state } = fixture()
    await lane.refresh(async () => answer())
    lane.changed({ why: 'unavailable', databaseEpoch: 1, signInEpoch: 1 })
    expect(state().status).toBe('unavailable')
    expect(state().reading?.operation).toBe(1)
    lane.changed({ why: 'closed', databaseEpoch: 1, signInEpoch: 1 })
    const read = vi.fn(async () => answer(2))
    await lane.refresh(read)
    expect(read).not.toHaveBeenCalled()
    expect(state()).toEqual({ status: 'unavailable', reading: null })
  })

  it('past reset formatting does not erase a historical wall or manufacture a current clear', () => {
    const read = answer()
    if (read.is !== 'read') throw new Error('fixture not a read')
    const dated: LimitsDisplayReading = {
      ...read.reading,
      walked: {
        ...read.reading.walked,
        rows: read.reading.walked.rows.map((wall) => ({ ...wall, resetsAt: NOW + 100 })),
      },
    }
    const display: LimitsDisplayState = { status: 'unavailable', reading: dated }
    const view = providerLimitsView(dated.walked, false, NOW + 1_000_000, display)
    expect(view?.walls).toHaveLength(1)
    expect(view?.unread).toBe(true)
    expect(view?.display?.reading?.evaluatedAt).toBe(NOW + 2)
    expect(limitsDisplayLabel(display)).toBe('Limits unavailable')
  })

  it('an unread empty population is unavailable rather than a no-limits statement', () => {
    const read = answer()
    if (read.is !== 'read') throw new Error('fixture not a read')
    const reading = { ...read.reading, walked: { ...read.reading.walked, rows: [], rowsUnread: 1 } }
    expect(limitsDisplayLabel({ status: 'ready', reading })).toBe('Limits unavailable')
    expect(
      limitsDisplayLabel({
        status: 'ready',
        reading: { ...reading, walked: { ...reading.walked, rowsUnread: 0 } },
      }),
    ).toMatch(/^No limits reported as of /)
  })

  it('partial replies preserve the last complete date and cannot invent a first stopped label', async () => {
    const { lane, state } = fixture()
    const read = answer()
    if (read.is !== 'read') throw new Error('fixture not a read')
    const partial: LimitsDisplayAnswer = {
      ...read,
      reading: {
        ...read.reading,
        operation: 2,
        evaluatedAt: NOW + 3,
        walked: { ...read.reading.walked, rowsUnread: 1 },
      },
    }
    await lane.refresh(async () => partial)
    expect(state()).toEqual({ status: 'unavailable', reading: null })
    await lane.refresh(async () => read)
    expect(state().reading?.operation).toBe(1)
    await lane.refresh(async () => partial)
    expect(state().status).toBe('unavailable')
    expect(state().reading?.operation).toBe(1)
    expect(state().reading?.evaluatedAt).toBe(NOW + 2)
  })
})

describe('the actual screen publishes actionables without awaiting the limits lane', () => {
  it('keeps ready answers live during a slow limits read and rejects an older actionable round', async () => {
    const source = readFileSync(
      fileURLToPath(new URL('../src/renderer/src/components/RuntimeScreen.vue', import.meta.url)),
      'utf8',
    )
    const start = source.indexOf('async function lookForWhatIsYours(')
    const end = source.indexOf('\n}\n', start)
    if (start < 0 || end < start) throw new Error('screen look missing')
    const first = deferred<object>()
    const slowLimits = deferred<void>()
    const fresh = { rows: ['fictional new question'], walk: 'fictional', ledgers: 1, rowsUnread: 0 }
    const refs = {
      escalated: { value: null },
      decided: { value: null },
      stalledWork: { value: null },
      instructionAsks: { value: null },
      waitingOnWhoWrote: { value: null },
      lastStallLookAnswered: { value: true },
      lastAskLookAnswered: { value: true },
      lastReplyLookAnswered: { value: true },
      mcpServerRequests: { value: null },
      lastServerRequestLookAnswered: { value: true },
      stoppedWork: { value: null },
      lastStopLookAnswered: { value: true },
      workIncidents: { value: null },
      lastIncidentLookAnswered: { value: true },
      lastLookAnswered: { value: {} },
    }
    const store = {
      questionsForAPerson: vi.fn().mockReturnValueOnce(first.promise).mockResolvedValue(fresh),
      decisionsForAPerson: vi.fn().mockResolvedValue(fresh),
      stalledWorkForAPerson: vi.fn().mockResolvedValue(fresh),
      instructionAsksForAPerson: vi.fn().mockResolvedValue([]),
      waitingOnWhoWroteForAPerson: vi.fn().mockResolvedValue(fresh),
      mcpServerRequestsForAPerson: vi.fn().mockResolvedValue([]),
      stoppedWorkForAPerson: vi.fn().mockResolvedValue(fresh),
      workIncidentsForAPerson: vi.fn().mockResolvedValue(fresh),
    }
    const refreshLimitsDisplay = vi.fn(() => slowLimits.promise)
    const look = runInNewContext(
      `${source.slice(start, end + 2).replace(': Promise<void>', '')}; lookForWhatIsYours`,
      {
        ...refs,
        store,
        refreshLimitsDisplay,
        actionableReadSequence: 0,
        actionableReadsClosed: false,
      },
    ) as () => Promise<void>
    const old = look()
    await look()
    expect(refs.escalated.value).toBe(fresh)
    expect(refreshLimitsDisplay).toHaveBeenCalledTimes(2)
    first.finish({ ...fresh, rows: ['older question'] })
    await old
    expect(refs.escalated.value).toBe(fresh)
    slowLimits.finish()
  })
})
