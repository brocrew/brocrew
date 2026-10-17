import { describe, expect, it } from 'vitest'
import { attachmentsNotRestored, puttingItBack, withTheseToo } from '../src/renderer/src/lib/drafts'
import { MAX_HANDED_PATHS, type HandedPath } from '../src/shared/runtime-ipc'

/**
 * # 🔴 D-010 · *Put it back* appends — the words and the files
 *
 * ⚑ Several messages may wait for a busy conversation now, so a person can put back one while the
 * composer already holds words — another one put back, or the start of their next message. ⛔ The
 * pane set the draft to the returned words and staged the returned files in place of the staged
 * ones, which erased both. `dom/queued-restore.dom.test.ts` drives the pane; this pins the rule.
 */

const file = (name: string): HandedPath => ({
  path: `/work/${name}`,
  kind: 'file',
  outsideCwd: false,
})

describe('D-010 · the words', () => {
  it('🔴 after what is already there, a blank line between — never in its place', () => {
    expect(puttingItBack('half a thought', 'when you get a moment')).toBe(
      'half a thought\n\nwhen you get a moment',
    )
    // ⚑ Two put back in turn: both kept, in the order they came back.
    expect(puttingItBack(puttingItBack('', 'the first'), 'the second')).toBe(
      'the first\n\nthe second',
    )
  })

  it('⚑ an empty composer takes the words as they are; trailing space does not pile up blank lines', () => {
    expect(puttingItBack('', 'when you get a moment')).toBe('when you get a moment')
    expect(puttingItBack('  \n', 'when you get a moment')).toBe('when you get a moment')
    expect(puttingItBack('half a thought\n\n', 'more')).toBe('half a thought\n\nmore')
  })

  it('⛔ a message with no words leaves the draft as it was', () => {
    expect(puttingItBack('half a thought', '')).toBe('half a thought')
  })
})

describe('D-010 · the files', () => {
  it('🔴 join what is staged — what is staged stays first, and one already there is not added twice', () => {
    const merged = withTheseToo([file('a.md'), file('b.md')], [file('b.md'), file('c.md')])
    expect(merged.staged.map((one) => one.path)).toEqual(['/work/a.md', '/work/b.md', '/work/c.md'])
    expect(merged.didNotFit).toBe(0)
  })

  it('⛔ the ceiling binds, and what did not fit is COUNTED, with a sentence to say so', () => {
    const full = Array.from({ length: MAX_HANDED_PATHS }, (_, i) => file(`${String(i)}.md`))
    const merged = withTheseToo(full, [file('x.md'), file('y.md')])
    expect(merged.staged).toHaveLength(MAX_HANDED_PATHS)
    expect(merged.didNotFit).toBe(2)
    expect(attachmentsNotRestored(merged.didNotFit)).toContain('2 attachments')
  })
})
