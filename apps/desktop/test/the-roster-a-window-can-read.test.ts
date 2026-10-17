import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { LEDGER_WALK_KINDS, WALK_COVERS, type LedgerWalkKind } from '../src/shared/questions'
import { openWorkOf } from '../src/shared/tasks'

/**
 * 🔴 **467 · the roster a window can read** (HO-024 criterion 22's other half; `452` F1, band 2).
 *
 * ⚑ **D-016 took the roster out** — `conversationsInProject`, the project it was read for, and the
 * room that drew it — so every case about that read went with it. ⛔ **What it pinned that outlived
 * it** is kept: the one spelling of *what work is this conversation holding* (§5), and the register
 * the read added its words to (§6).
 */

const here = dirname(fileURLToPath(import.meta.url))
const HOST_SRC = join(here, '../src/main/runtime/runtime-host.ts')
const STORE_SRC = join(here, '../src/main/db/session-store.ts')

/** ⛔ **A census that reads prose reads code wrong** — a docblock quoting a call is not a call. */
function withoutProse(code: string): string {
  return code
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .split('\n')
    .filter((line) => !line.trim().startsWith('//'))
    .join('\n')
}

describe('§5 · one derivation of *what is this conversation holding*', () => {
  it('⛔ `openWorkOf` is the ONE spelling of the predicate, and both readers go through it', () => {
    // ⚠️ **`452` F7 found this function cited by a docblock and absent from the repo.** Now it is
    // the thing that note names — and the census is what stops the host quietly growing a second
    // copy of the filter, which is how a project's list and a person's queue come to disagree about
    // one conversation.
    const host = withoutProse(readFileSync(HOST_SRC, 'utf8'))
    // 🔴 **474 · the anchor MOVED and the rule did not** (`correct-a-stale-mutation-anchor-dont
    // -retire-it`). ⛔ This read `openWorkOf(this.deps.store.tasksOf(id))` until `474` put the
    // `tasksOf` read behind `oneTaskReadPerAnswer`, so that *what open work is this holding* and
    // *which of its work does this question name* fold ONE ledger read instead of two. ⚠️ Both
    // halves are still censused: the predicate is still spelled once, and the store call it folds
    // is one method away rather than gone. ⚑ **D-016 · re-anchored, not loosened**: the rows are
    // pieces (`piecesOwnedBy`), read once per answer by `onePieceReadPerAnswer`.
    expect(host).toContain('openWorkOf(pieces(id))')
    expect(host).toContain('this.deps.store.piecesOwnedBy(id)')
    // ⛔ **The hand-written copy, whatever its row is called.** This matched `(task)` only, which was
    // every copy there could be while the rows were tasks; D-016 renamed the rows, so the variable
    // is now any name — `(piece)`, `(child)`, `(one)` — and the census follows the SHAPE.
    //
    // ⚠️ **One projection is not a copy**: a PARENT per open piece — `childrenOpen`, *which of my
    // pieces has an open child* (D-016 · spec §2.2) — is a different question from *what am I holding*,
    // and `WorkInHand` carries no parent, so `openWorkOf` cannot answer it. It is the one map the
    // census lets through, named rather than widened.
    // ⚑ **D-033 · and a second, named the same way**: each open piece BY ITS ID, beside how a window
    // draws it (`howItsWorkIsDrawn`) — the host's comparison of one read with the last, which no
    // person reads as a list, and which `WorkInHand` cannot answer either: it carries no id and no
    // state.
    const TWO_STEPS = /\.filter\(\((\w+)\) => TASK_IS_OPEN\[\1\.state\]\)\s*\n\s*\.map\(([^\n]*)/g
    const A_PARENT = /^\((\w+)\) => \1\.parent\)/
    const BY_ITS_ID_AS_DRAWN = /^\((\w+)\) => \[\1\.piece, asItIsDrawn\(\1\)\] as const\)/
    const copiesIn = (code: string): string[] =>
      [...code.matchAll(TWO_STEPS)]
        .map((found) => found[2] ?? '')
        .filter((mapped) => !A_PARENT.test(mapped) && !BY_ITS_ID_AS_DRAWN.test(mapped))
    expect(copiesIn(host), 'the host spells `openWorkOf` a second time, by hand').toEqual([])
    // ⚑ **Two controls the negative needs.** The predicate is still read elsewhere in that file, so
    // a strip that deleted everything would fail the first; and the pattern matches the shape it
    // hunts, so *"nothing matched"* is not a statement about a regex that never fires.
    expect(host).toContain('TASK_IS_OPEN[')
    expect(
      copiesIn(
        '        .filter((child) => TASK_IS_OPEN[child.state])\n        .map((child) => child.label)',
      ),
    ).toEqual(['(child) => child.label)'])
    // ⚠️ …and the one exemption exempts a parent and nothing else.
    expect(
      copiesIn(
        '        .filter((one) => TASK_IS_OPEN[one.state])\n        .map((one) => one.parent),',
      ),
    ).toEqual([])
    // ⚠️ …and D-033's exempts a piece by its id beside how it is drawn, and not a label list.
    expect(
      copiesIn(
        '      .filter((piece) => TASK_IS_OPEN[piece.state])\n      .map((piece) => [piece.piece, asItIsDrawn(piece)] as const),',
      ),
    ).toEqual([])
    expect(
      copiesIn(
        '      .filter((piece) => TASK_IS_OPEN[piece.state])\n      .map((piece) => [piece.label, piece.state] as const),',
      ),
    ).toEqual(['(piece) => [piece.label, piece.state] as const),'])
    // ⚑ …and the store spells no copy either. ⚠️ **D-016 · re-aimed**: the store's own call —
    // `openWorkOf(tasksAssignedBySession(…))`, *is this conversation a worker* — went with `aWorker`,
    // and the store now filters by `TASK_IS_OPEN` twice BY DESIGN (spec §2.2–§2.3): `openPiecesOf`
    // answers ROWS, and `childrenOpen` a parent per open given piece. ⛔ Neither is the label list
    // `openWorkOf` answers, so the census the store still owes is the same one as the host's.
    //
    // ⚠️ **Asserted as the SHAPE and not as the whole line** — `a-source-census-that-pins-a-line
    // -kills-every-row-on-it`: a census quoting the argument list would kill every mutation on it.
    const ledger = withoutProse(readFileSync(STORE_SRC, 'utf8'))
    expect(ledger).toContain('TASK_IS_OPEN[')
    expect(copiesIn(ledger), 'the store spells `openWorkOf` a second time, by hand').toEqual([])
    // 🔴 **`stalled` is OPEN, which is the one reading a second hand-written filter would get
    // wrong** — the reason there is one spelling.
    expect(openWorkOf([])).toEqual([])
  })
})

/* ═════════════════ §6 · the vocabulary ═══════════════════════ */

describe('§6 · what the register says', () => {
  it('⚑ every walk has a sentence, and no two of them are the same string', () => {
    const said = LEDGER_WALK_KINDS.map((walk: LedgerWalkKind) => WALK_COVERS[walk])
    expect(said.every((sentence) => sentence.length > 0)).toBe(true)
    expect(new Set(said).size).toBe(LEDGER_WALK_KINDS.length)
  })
})
