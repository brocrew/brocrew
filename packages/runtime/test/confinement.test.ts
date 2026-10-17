import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { realpathSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { attestedRoot } from '../src/internal/confinement'

/**
 * The allowance predicates — the plan file and the memory directory (150, 153, 170, 183, 188, 197).
 *
 * ⚑ **`726` · R92 — no protected-path placement is tested here any more**: the scan it tested (071's
 * rule for 069 A1), its carve-outs (262) and `721`'s placement from the CLI's folder (R77) are gone.
 * What remains is what the adapter's ALLOWANCES stand on, which fail closed by withholding a grant.
 *
 * The geometry here is the app's real one, built on disk, because every interesting case in this
 * module is about what the filesystem says rather than about what a string looks like:
 *
 *     <userData>/brobot-workspace                              ← the session's cwd
 *     <userData>/provider-homes/default/default/claude         ← the session's own home
 *     <userData>/provider-homes/default/default/codex          ← a SIBLING, holding a credential
 *     <userData>/provider-homes/default/other/codex            ← another profile
 *     <userData>/brobot2.sqlite                                ← every archived conversation
 *
 * ⚠️ **No file here contains a credential, and no test reads one.** The `auth.json` fixtures hold a
 * marker string.
 */
describe('the allowance predicates (150, 170, 183, 188, 197)', () => {
  let userData: string
  let workspace: string
  let claudeHome: string
  let codexHome: string

  const NOT_A_CREDENTIAL = '{"marker":"a fixture, never a credential"}'

  beforeEach(() => {
    // `realpathSync` because macOS puts `tmpdir()` behind `/var` → `/private/var`, and a test whose
    // expected paths are the unresolved spelling would pass or fail on that symlink rather than on
    // the rule.
    userData = realpathSync(mkdtempSync(join(tmpdir(), 'brobot2-confine-')))
    workspace = join(userData, 'brobot-workspace')
    claudeHome = join(userData, 'provider-homes', 'default', 'default', 'claude')
    codexHome = join(userData, 'provider-homes', 'default', 'default', 'codex')
    for (const dir of [workspace, claudeHome, codexHome]) mkdirSync(dir, { recursive: true })
    mkdirSync(join(userData, 'provider-homes', 'default', 'other', 'codex'), { recursive: true })
    writeFileSync(join(codexHome, 'auth.json'), NOT_A_CREDENTIAL)
    writeFileSync(join(userData, 'provider-homes/default/other/codex/auth.json'), NOT_A_CREDENTIAL)
    writeFileSync(join(userData, 'brobot2.sqlite'), 'not really a database')
  })

  afterEach(() => {
    rmSync(userData, { recursive: true, force: true })
  })

  /**
   * ⚑ **728 · what is left here is the attestation the memory label stands on** (`memory-store.ts`).
   * ⛔ `writesOnlyWithin` and `plansDirectory` went with their only callers — R93 removed the plan
   * floor's plan-file exemption and the memory carve-out — and so did the fourteen tests that asked
   * them; `728`'s response names each. `attestedRoot`'s own two cases are kept, asked directly.
   */
  describe('the root a label is keyed on must be where the filesystem says it is (170, 183)', () => {
    it('⛔ a root that is a DANGLING link is not attested (182 H1)', () => {
      // ⚠️ **`attestedRoot`'s half of 182 H1.** 170 refused a root link whose target EXISTS; a root
      // link whose target does not threw from `realpathSync` exactly like a `memory/` nobody had
      // created yet, so the climb answered with the derived path, both sides agreed, and the root
      // was attested.
      const memory = join(claudeHome, 'memory')
      symlinkSync(join(claudeHome, 'CLAUDE.md'), memory)
      expect(attestedRoot(memory)).toBeNull()
    })

    it('⚑ …while a root that does not exist yet IS attested — the ordinary first write', () => {
      // ⛔ **The paired positive**, and the one that stops the rule above becoming "refuse anything
      // that is not already there". The first memory write is what creates the directory.
      const fresh = join(claudeHome, 'memory')
      expect(attestedRoot(fresh)).toBe(fresh)
    })

    it('⛔ …and a root that is a link to an EXISTING directory is not attested either (170 §1)', () => {
      const memory = join(claudeHome, 'memory')
      symlinkSync(claudeHome, memory)
      expect(attestedRoot(memory)).toBeNull()
    })
  })
})
