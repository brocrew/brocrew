import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  countProviderBranches,
  findRatchetIncreases,
  scanProviderBranches,
} from '../lib/provider-logic-ratchet.mjs'

const root = fileURLToPath(new URL('../../', import.meta.url))

describe('provider logic ratchet', () => {
  it('counts executable dispatch without counting comments, prose or types', () => {
    expect(
      countProviderBranches(`
        // provider === 'codex'
        type Provider = 'claude' | 'codex';
        const prose = "provider === 'claude'";
        const first = provider === 'claude' ? one : two;
        const reversed = 'codex' !== provider;
        switch (provider) { case 'claude': break; }
        const enabled = ['codex'].includes(provider);
        const prefix = name.startsWith('claude');
        const suffix = name.endsWith('codex');
        const position = providers.indexOf('codex');
      `),
    ).toBe(7)
  })

  it('scans main and neutral runtime, and rejects a new main comparison', () => {
    const scratch = mkdtempSync(join(tmpdir(), 'provider-ratchet-'))
    const put = (file, source) => {
      const target = join(scratch, file)
      mkdirSync(join(target, '..'), { recursive: true })
      writeFileSync(target, source)
    }
    try {
      const file = 'apps/desktop/src/main/example.ts'
      put(file, 'export const value = true')
      put('packages/runtime/src/runtime.ts', "export const chosen = p === 'claude'")
      put('packages/runtime/src/claude/adapter.ts', "export const native = p === 'claude'")
      put('packages/runtime/src/codex/adapter.ts', "export const native = p === 'codex'")
      put('apps/desktop/src/main/providers/claude/native.ts', "const native = p === 'claude'")
      const before = scanProviderBranches(scratch)
      expect(before).toEqual({ 'packages/runtime/src/runtime.ts': 1 })
      put(file, "export const chosen = provider === 'codex'")
      expect(findRatchetIncreases(before, scanProviderBranches(scratch))).toEqual([
        { file, allowed: 0, actual: 1 },
      ])
    } finally {
      rmSync(scratch, { recursive: true, force: true })
    }
  })

  it('keeps permits with their file, allowing only reductions', () => {
    expect(findRatchetIncreases({ 'one.ts': 2 }, { 'one.ts': 1 })).toEqual([])
    expect(findRatchetIncreases({ 'one.ts': 2 }, { 'two.ts': 1 })).toEqual([
      { file: 'two.ts', allowed: 0, actual: 1 },
    ])
  })

  it('does not grow provider logic in the real main and neutral runtime trees', () => {
    const baseline = JSON.parse(readFileSync(join(root, 'scripts/provider-logic-baseline.json')))
    const current = scanProviderBranches(root)
    expect(findRatchetIncreases(baseline, current)).toEqual([])
    expect(current, 'remove unused permits when provider logic falls').toEqual(baseline)
  })
})
