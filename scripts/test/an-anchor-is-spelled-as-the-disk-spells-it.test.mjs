import { existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, sep } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { trustedAnchor } from '../lib/safe-remove.mjs'

/**
 * # ⛔ 351 M33 · the anchor's `real` is the folder as the DISK spells it, whatever case was typed
 *
 * ⚑ Since W4.124 the forbidden-root checks compare folders by device and inode, so a path typed in
 * another case no longer slips past them — but `trustedAnchor`'s `real` is still handed to the
 * liveness check (`brobot-liveness.mjs`), which looks for that spelling in a running BroBot's command
 * line. `realpathSync.native` gives the disk's own spelling; plain `realpathSync` gives back the case
 * that was typed, and a BroBot started on `/Users/alex/…` would not be recognised by `/users/alex/…`.
 *
 * ⚑ It is a fact of a case-INSENSITIVE volume (macOS by default), so it is skipped where the volume
 * is case-sensitive (CI's Linux runner) — said, not silently passed: the premise is checked first.
 */

const roots = []
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

function aFolderSpelled(name) {
  const root = mkdtempSync(join(tmpdir(), 'b351-case-'))
  roots.push(root)
  mkdirSync(join(root, name))
  return root
}

const scratch = (root) => ({ home: join(root, 'home'), env: {}, cwd: root })

describe('351 M33 · the anchor is spelled as the disk spells it', () => {
  it('🔴 a folder typed in another case anchors to its own spelling', (ctx) => {
    const root = aFolderSpelled('Kept')
    const typed = join(root, 'kept')
    ctx.skip(!existsSync(typed), 'this volume is case-sensitive: `kept` is not `Kept` here')

    const anchor = trustedAnchor(typed, scratch(root))
    expect(anchor.kind, anchor.why ?? '').toBe('trusted')
    expect(anchor.lexical).toBe(typed)
    // ⛔ Not the case that was typed: the one on disk.
    expect(anchor.real.endsWith(sep + 'Kept')).toBe(true)
    expect(anchor.real.endsWith(sep + 'kept')).toBe(false)
  })

  it('⚑ CONTROL · typed as the disk spells it, the two spellings agree', () => {
    const root = aFolderSpelled('Kept')
    const anchor = trustedAnchor(join(root, 'Kept'), scratch(root))
    expect(anchor.kind, anchor.why ?? '').toBe('trusted')
    expect(anchor.real.endsWith(sep + 'Kept')).toBe(true)
  })
})
