import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { BUILT_IN_THEME_IDS, HIDDEN_BASE_THEME_IDS } from '../../src/main/themes/defaults'
import { THEME_LIBRARY_FOLDER } from '../../src/main/themes/state'

/**
 * When the built-in themes folder can't be looked at or listed, the app treats every built-in it
 * knows of as one it couldn't read, so a theme built on one waits rather than being judged
 * invalid. That holds only if every built-in the app ships is one it knows of: each folder in
 * `resources/themes` that holds a theme.json is named in `BUILT_IN_THEME_IDS`. The ones shipped
 * only as a hidden base, and the ids known but not shipped yet, are named here too, so a change
 * to any side is made on purpose.
 */
const ROOT = join(__dirname, '../../resources/themes')
const SHIPPED = readdirSync(ROOT)
  .filter((name) => statSync(join(ROOT, name, 'theme.json'), { throwIfNoEntry: false })?.isFile())
  .sort()
const HIDDEN_BASES = ['brocrew']
const LISTED = SHIPPED.filter((id) => !HIDDEN_BASES.includes(id))
const KNOWN_NOT_SHIPPED = [
  'beach',
  'cartoon',
  'dbz',
  'e-ink',
  'kids',
  'luxury',
  'mario',
  'notebook',
  'sober',
  'valentine',
  'win95',
  'zen',
]

describe('every built-in the app ships is one it knows of', () => {
  it('the packaged built-ins folder is the one the store reads', () => {
    const builder = readFileSync(join(__dirname, '../../electron-builder.yml'), 'utf8')
    expect(builder).toMatch(
      new RegExp(`- from: resources/themes\\n\\s+to: ${THEME_LIBRARY_FOLDER}\\n`),
    )
  })

  it('each shipped theme folder is named in the known ids, under its own id', () => {
    expect(SHIPPED.length).toBeGreaterThan(0)
    for (const id of SHIPPED) {
      expect(BUILT_IN_THEME_IDS, `${id} ships but isn't a known built-in`).toContain(id)
      const theme = JSON.parse(readFileSync(join(ROOT, id, 'theme.json'), 'utf8')) as {
        id?: unknown
      }
      expect(theme.id).toBe(id)
    }
  })

  it('the hidden bases are named, and each one ships', () => {
    expect([...HIDDEN_BASE_THEME_IDS].sort()).toEqual(HIDDEN_BASES)
    for (const id of HIDDEN_BASES) expect(SHIPPED, `${id} is a hidden base`).toContain(id)
  })

  it('the known ids are exactly classic, the listed, the hidden and the not yet shipped', () => {
    expect([...BUILT_IN_THEME_IDS].sort()).toEqual(
      ['classic', ...LISTED, ...HIDDEN_BASES, ...KNOWN_NOT_SHIPPED].sort(),
    )
    expect(new Set(BUILT_IN_THEME_IDS).size).toBe(BUILT_IN_THEME_IDS.length)
  })
})
