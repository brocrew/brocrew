import { describe, expect, it } from 'vitest'
import { whoAskedClause, type StopReading } from '../src/shared/how-work-stopped'

describe('395 · the interruption that looks like a provider fault', () => {
  describe('§7 · the censuses', () => {
    it('⛔ the readings a surface gives are the ones this module exports — no second phrasing', () => {
      const reading: StopReading = { how: 'it-was-stopped', who: 'an-agent', asker: 'sess_9' }
      expect(whoAskedClause(reading)).toBe('sess_9')
      expect(whoAskedClause({ ...reading, asker: null })).toBe('an agent')
      expect(whoAskedClause({ ...reading, who: 'a-person', asker: null })).toBe('a person')
      expect(whoAskedClause({ how: 'it-finished', who: null, asker: null })).toBeNull()
    })
  })
})
