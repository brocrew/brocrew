import { afterEach, expect, it, vi } from 'vitest'
import { createDatabaseWriteLog, type DatabaseWriteSummary } from '../src/main/logging/log'

afterEach(() => vi.useRealTimers())

it('emits one normal-log summary per active writer, not per transaction, and clears the minute', () => {
  vi.useFakeTimers()
  const lines: DatabaseWriteSummary[] = []
  let now = 100
  const logger = createDatabaseWriteLog(
    (line) => lines.push(line),
    () => now,
  )
  try {
    for (let i = 0; i < 10_000; i++)
      logger.record({ component: `store.writer${i % 4}`, rows: 2, ms: 3 }, new Set(['events']))
    logger.record({ component: 'store.writer0', rows: 1, ms: 7 }, new Set(['provider_session']))
    expect(lines).toEqual([])
    now += 65_000
    vi.advanceTimersByTime(60_000)
    expect(lines).toHaveLength(4)
    expect(lines.find((line) => line.component === 'store.writer0')).toEqual({
      component: 'store.writer0',
      tables: ['events', 'provider_session'],
      transactions: 2501,
      rows: 5001,
      ms: 7507,
      longestMs: 7,
      periodMs: 65_000,
    })
    now += 60_000
    vi.advanceTimersByTime(60_000)
    expect(lines).toHaveLength(4)
    logger.record({ component: 'store.writer1', rows: 1, ms: 2 }, new Set(['events']))
    now += 5
    logger.stop()
    expect(lines.at(-1)).toMatchObject({ transactions: 1, rows: 1, ms: 2, periodMs: 5 })
    vi.advanceTimersByTime(120_000)
    expect(lines).toHaveLength(5)
  } finally {
    logger.stop()
  }
})

it('a failed log write loses that minute without breaking a timer or replaying it', () => {
  vi.useFakeTimers()
  const write = vi.fn(() => {
    throw new Error('fictional file failure')
  })
  const logger = createDatabaseWriteLog(write)
  try {
    logger.record({ component: 'store.append', rows: 1, ms: 2 }, new Set(['events']))
    expect(() => vi.advanceTimersByTime(60_000)).not.toThrow()
    expect(write).toHaveBeenCalledTimes(1)
    vi.advanceTimersByTime(60_000)
    expect(write).toHaveBeenCalledTimes(1)
  } finally {
    logger.stop()
  }
})
