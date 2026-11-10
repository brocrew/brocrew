import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { codexAuthHealth } from '../src/codex/auth'

describe('a Windows child finds its system', () => {
  describe('Codex’s credential file', () => {
    let home: string
    afterEach(() => rmSync(home, { recursive: true, force: true }))

    it('on Windows a regular auth.json is enough — the system reports no owner-only mode', () => {
      home = mkdtempSync(join(tmpdir(), 'brobot-codex-'))
      writeFileSync(join(home, 'auth.json'), '{}')
      chmodSync(join(home, 'auth.json'), 0o644)
      expect(codexAuthHealth(home)).toEqual({ ok: true })
      // Elsewhere the same file is made 0600 again and used.
      expect(codexAuthHealth(home)).toEqual({ ok: true })
    })

    it('on Windows a missing file is still refused', () => {
      home = mkdtempSync(join(tmpdir(), 'brobot-codex-'))
      expect(codexAuthHealth(home)).toMatchObject({ ok: false })
    })
  })
})
