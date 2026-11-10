import { describe, expect, it } from 'vitest'
import { OPEN_THE_CONVERSATION } from '../src/renderer/src/lib/taking-over'
import { ANOTHER_CALLER_MAY_REACH_IN } from '../src/renderer/src/lib/standing-grants'

/** The words Info's commander paragraph and a conversation row's press say. */

describe('634 · three sentences that described an older app', () => {
  // ───────────────────────────────────────────────────────────────────────────────────────────
  // §2 · the commander sentences
  // ───────────────────────────────────────────────────────────────────────────────────────────

  describe('§2 · the paragraph behind Info’s commander row', () => {
    it('⛔ the paragraph answers the third question, which nothing answered before', () => {
      // ⚠️ **The PO asked three things**: whether the conversation will move, whether his own
      // messages compete, whether it matters. ⚑ This is the second, and it is on the paragraph
      // because that is where detail lives (`527`).
      expect(ANOTHER_CALLER_MAY_REACH_IN).toContain('Your own messages are unaffected')
      // ⛔ **The clauses `395` corrected are untouched**, so this is an addition and not a rewrite
      // of a sentence two dispatches already argued over.
      // ⚠️ **D-014 · one of them moved** — *"What it may do is a grant a person made"* went when
      // ending and stopping stopped reading a grant; *"It can go as far as"* is the clause that
      // still keeps the verbs from reading as a complete list. ⚑ **D-017 · *"and ending it"* went
      // with `end_agent`**: nothing ends a conversation, so the list is the two acts a caller has.
      expect(ANOTHER_CALLER_MAY_REACH_IN).toContain(
        'It can go as far as sending messages here and stopping what this conversation is doing.',
      )
      expect(ANOTHER_CALLER_MAY_REACH_IN).not.toMatch(/\bending it\b/)
    })
  })

  /** Every conversation opens in its one full view, so a row offers one press in one sentence. */
  describe('§3 · one press opens a conversation, and it is the one full view', () => {
    it('the label says OPEN', () => {
      expect(OPEN_THE_CONVERSATION).toBe('Open the conversation')
    })
  })
})
