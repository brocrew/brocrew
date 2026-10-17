import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  theProgramStillSays,
  theSentenceCodexRefusesASignInWith,
} from '../lib/a-sentence-codex-says.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const read = (path) => readFileSync(join(ROOT, path), 'utf8')

/**
 * # The one sentence of Codex's the product matches is checked at every Codex update
 *
 * Codex gives a sign-in refused at workspace routing no type, so the product matches its sentence,
 * whole. `pnpm run protocol:check`, run at every Codex update, fails when the bundled program no
 * longer holds it. This file checks the reading of the constant and the search, on fictional bytes,
 * and that the check is wired in.
 */
describe('the sentence Codex refuses a sign-in with, checked at a Codex update', () => {
  it('🔒 is read from the constant the product matches with', () => {
    expect(
      theSentenceCodexRefusesASignInWith(read('packages/runtime/src/codex/auth-probe.ts')),
    ).toBe('workspace routing discovery unauthorized (401)')
    // ⛔ A file that no longer declares it there is an error, never an empty sentence.
    expect(() => theSentenceCodexRefusesASignInWith('export const SOMETHING_ELSE = 1\n')).toThrow()
  })

  it('🔴 a program that words it differently, or drops it, is told from one that holds it whole', () => {
    const sentence = 'workspace routing discovery unauthorized (401)'
    const holding = Buffer.concat([Buffer.from([0, 1, 2]), Buffer.from(sentence), Buffer.from([0])])
    expect(theProgramStillSays(holding, sentence)).toBe(true)
    expect(
      theProgramStillSays(Buffer.from('workspace routing discovery unauthorised (401)'), sentence),
    ).toBe(false)
    expect(
      theProgramStillSays(Buffer.from('workspace routing discovery unauthorized'), sentence),
    ).toBe(false)
    expect(theProgramStillSays(Buffer.alloc(0), sentence)).toBe(false)
  })

  it('🔒 the update check reads the constant and the bundled program, and fails without the sentence', () => {
    const check = read('scripts/check-protocol.mjs')
    expect(check).toContain("'packages/runtime/src/codex/auth-probe.ts'")
    expect(check).toMatch(
      /if \(!theProgramStillSays\(readFileSync\(codex\), sentence\)\) \{[\s\S]*?process\.exit\(1\)/,
    )
  })
})
