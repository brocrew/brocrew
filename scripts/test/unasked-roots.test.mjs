import { mkdirSync, mkdtempSync, rmSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { writableUnasked } from '../lib/unasked-roots.mjs'

/**
 * ⚑ 738 · R96's re-aim rests on one question — *does Codex's `ask` write this path without a card?* —
 * so the answer is measured on the two ways it goes wrong: a target not written yet (its own
 * `realpath` throws) and a temporary folder whose spelling is not its real path (`/tmp`).
 *
 * ⚠️ Everything is built under the machine's temporary folder, so the cases about a folder OUTSIDE
 * name their own stand-in temporary folder (`temporary`) rather than writing anywhere else.
 */
const root = mkdtempSync(join(tmpdir(), 'brobot2-738-unasked-'))
const cwd = join(root, 'conversation')
const sibling = join(root, 'conversation-outside')
const standIn = { temporary: [join(root, 'the-temporary-folder')] }
mkdirSync(cwd, { recursive: true })
mkdirSync(sibling, { recursive: true })
afterAll(() => rmSync(root, { recursive: true, force: true }))

describe('738 · the folders `ask` writes unasked (R96)', () => {
  it('⚑ the conversation’s own folder, and a file not written in it yet', () => {
    expect(writableUnasked(cwd, cwd, standIn)).toBe(cwd)
    expect(writableUnasked(join(cwd, 'deep', 'not-yet.txt'), cwd, standIn)).toBe(cwd)
  })

  it('⚑ the machine’s temporary folders — by their real path, whatever the spelling', () => {
    const elsewhere = '/nonexistent-brobot2-738'
    expect(writableUnasked('/tmp/brobot2-738-not-yet/x.txt', elsewhere)).toBe('/tmp')
    // ⚠️ macOS's spelling: `/tmp` is a link to `/private/tmp` there, and `/private` does not exist on Linux
    if (process.platform === 'darwin') {
      expect(writableUnasked('/private/tmp/brobot2-738-not-yet/x.txt', elsewhere)).toBe('/tmp')
    }
    expect(writableUnasked(join(tmpdir(), 'not-yet.txt'), elsewhere)).toBe(tmpdir())
    // ⛔ the one-fact control: the same file, and nothing named temporary, is outside
    expect(writableUnasked('/tmp/brobot2-738-not-yet/x.txt', elsewhere, { temporary: [] })).toBe(
      null,
    )
  })

  it('⛔ a sibling of the folder is OUTSIDE — the target a step expects a card for', () => {
    expect(writableUnasked(join(sibling, 'ask.txt'), cwd, standIn)).toBeNull()
    // ⚠️ a name that merely STARTS with the folder's is not inside it
    expect(writableUnasked(join(`${cwd}-2`, 'ask.txt'), cwd, standIn)).toBeNull()
    expect(writableUnasked(join(root, 'the-temporary-folder', 'x.txt'), cwd, standIn)).toBe(
      standIn.temporary[0],
    )
  })

  it('⚠️ a link INTO the folder is inside it, read by where it leads', () => {
    const link = join(root, 'a-link')
    symlinkSync(cwd, link)
    expect(writableUnasked(join(link, 'x.txt'), cwd, standIn)).toBe(cwd)
  })
})
