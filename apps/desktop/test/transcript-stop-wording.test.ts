import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { whoAskedClause, type StopReading } from '../src/shared/how-work-stopped'

const here = dirname(fileURLToPath(import.meta.url))

describe('395 · the interruption that looks like a provider fault', () => {
  describe('§7 · the censuses', () => {
    it('⛔ the readings a surface gives are the ones this module exports — no second phrasing', () => {
      // ⚠️ **`ending.ts`'s standing rule, applied to the actor**: *"neither is composed at a call
      // site — a surface that wanted its own phrasing would be the second vocabulary."*
      const reading: StopReading = { how: 'it-was-stopped', who: 'an-agent', asker: 'sess_9' }
      expect(whoAskedClause(reading)).toBe('sess_9')
      expect(whoAskedClause({ ...reading, asker: null })).toBe('an agent')
      expect(whoAskedClause({ ...reading, who: 'a-person', asker: null })).toBe('a person')
      expect(whoAskedClause({ how: 'it-finished', who: null, asker: null })).toBeNull()
      // 🔴 **737 · re-aimed, not stripped**: the transcript's ask no longer composes its own asker —
      // it hands its facts to `stop-unanswered.ts`, whose ONE naming function asks `stoppedBy` (the
      // category, or the name `agentName` gives it — never the handle).
      const transcript = readFileSync(
        join(here, '../src/renderer/src/lib/transcript-parts/events.ts'),
        'utf8',
      )
      expect(transcript).toContain('text: askedToStopSays(askedToStop, null),')
      expect(transcript).not.toMatch(/stoppedBy\(/)
      const words = readFileSync(join(here, '../src/renderer/src/lib/stop-unanswered.ts'), 'utf8')
      expect(words).toContain('return stoppedBy(fact.by, named)')
    })
  })
})
