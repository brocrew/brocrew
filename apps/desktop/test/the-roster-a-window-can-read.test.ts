import { LEDGER_WALK_KINDS } from '../src/shared/question-contracts'
import type { LedgerWalkKind } from '../src/shared/question-contracts'
import { describe, expect, it } from 'vitest'
import { WALK_COVERS } from '../src/shared/questions'

/* ═════════════════ §6 · the vocabulary ═══════════════════════ */

describe('§6 · what the register says', () => {
  it('⚑ every walk has a sentence, and no two of them are the same string', () => {
    const said = LEDGER_WALK_KINDS.map((walk: LedgerWalkKind) => WALK_COVERS[walk])
    expect(said.every((sentence) => sentence.length > 0)).toBe(true)
    expect(new Set(said).size).toBe(LEDGER_WALK_KINDS.length)
  })
})
