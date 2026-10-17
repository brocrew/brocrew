import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, vi } from 'vitest'
import { personalCodexAuthPath } from '@brobot2/runtime'

/** What the fictional home's own Codex sign-in holds: fictional, and recognisable in a diff. */
export const THE_FICTIONAL_HOMES_SIGN_IN = '{"tokens":{"access_token":"FICTIONAL-HOME-DECOY"}}'

/**
 * Runs the whole test file with HOME, USERPROFILE and CODEX_HOME in a fictional folder whose own
 * Codex sign-in is {@link THE_FICTIONAL_HOMES_SIGN_IN}. So code that reads this computer's Codex
 * sign-in by its default path, as a planted defect that drops a test's seam does, reads fictional
 * bytes and never the person's own. The file refuses to run if the default path is not inside it.
 */
export function aFictionalHome(): { readonly home: () => string } {
  let home = ''
  beforeAll(() => {
    home = mkdtempSync(join(tmpdir(), 'brobot2-fictional-home-'))
    mkdirSync(join(home, '.codex'), { mode: 0o700 })
    writeFileSync(join(home, '.codex', 'auth.json'), THE_FICTIONAL_HOMES_SIGN_IN, { mode: 0o600 })
    vi.stubEnv('HOME', home)
    vi.stubEnv('USERPROFILE', home)
    vi.stubEnv('CODEX_HOME', join(home, '.codex'))
    if (homedir() !== home || personalCodexAuthPath() !== join(home, '.codex', 'auth.json')) {
      throw new Error('the fictional home did not take: this file reads no sign-in until it does')
    }
  })
  afterAll(() => {
    vi.unstubAllEnvs()
    if (home !== '') rmSync(home, { recursive: true, force: true })
  })
  return { home: () => home }
}
