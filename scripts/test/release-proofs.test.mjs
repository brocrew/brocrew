import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { verifyWindowsProof } from '../lib/release-proofs.mjs'
import { windowsProofFixture } from './fixtures/release-proof.mjs'

const roots = []
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})
const fixture = (kind = 'windows-clean') => {
  const folder = mkdtempSync(join(tmpdir(), 'fictional-native-proof-'))
  roots.push(folder)
  const manifest = {
    version: '0.2.12',
    source: 'a'.repeat(40),
    tree: 'b'.repeat(40),
    runId: 11,
    assets: [{ name: 'BroCrew-Setup-0.2.12-x64.exe', bytes: 12, sha256: 'c'.repeat(64) }],
    origins: { windows: { artifactId: 41 } },
  }
  return { folder, manifest, reference: windowsProofFixture(folder, manifest, kind) }
}
const change = (folder, file, mutate) => {
  const value = JSON.parse(readFileSync(join(folder, file)))
  mutate(value)
  writeFileSync(join(folder, file), JSON.stringify(value))
}

describe('raw installed-plugin Windows proof', () => {
  for (const kind of ['windows-clean', 'windows-upgrade'])
    it(`accepts the complete fictional ${kind} raw contract`, () => {
      const { folder, reference, manifest } = fixture(kind)
      expect(verifyWindowsProof(folder, reference, manifest).passed).toBe(true)
    })
  for (const [file, mutate, reason] of [
    [
      'native-receipt.json',
      (x) => {
        x.proofStage = 'NONRUNTIME'
      },
      'nonruntime summary',
    ],
    [
      'native-receipt.json',
      (x) => {
        x.candidate.version = '0.2.11'
      },
      'old-version receipt',
    ],
    [
      'native-receipt.json',
      (x) => {
        x.candidate.installer.sha256 = '0'.repeat(64)
      },
      'different installer',
    ],
    [
      'summary.json',
      (x) => {
        x.nativeExecuted = false
      },
      'no native execution',
    ],
    [
      'summary.json',
      (x) => {
        x.customPlugins = {}
      },
      'custom plugin input',
    ],
    [
      'observer-exit.json',
      (x) => {
        x.code = 1
      },
      'observer failure',
    ],
    [
      'observer-result.json',
      (x) => {
        x.cleanup.routesReleased = false
      },
      'unreleased routes',
    ],
    [
      'observer-result.json',
      (x) => {
        x.ownerEpoch = 'another epoch'
      },
      'different owner epoch',
    ],
    [
      'cleanup.json',
      (x) => {
        x.forced = true
      },
      'forced process cleanup',
    ],
    [
      'candidate-process-exit.json',
      (x) => {
        x.observed = false
      },
      'unobserved app exit',
    ],
    [
      'final-host-receipts.json',
      (x) => {
        x[1].value.groups = []
      },
      'different stop process births',
    ],
    [
      'final-host-receipts.json',
      (x) => {
        x[1].value.cause = 'server-failed'
      },
      'failed server stop',
    ],
  ])
    it(`rejects ${reason} even with passed=true`, () => {
      const { folder, reference, manifest } = fixture()
      change(folder, file, mutate)
      expect(() => verifyWindowsProof(folder, reference, manifest)).toThrow()
    })
  it('rejects changed residual beta bytes on upgrade', () => {
    const { folder, reference, manifest } = fixture('windows-upgrade')
    change(folder, 'after-installer-residual-state.json', (x) =>
      x.push({ path: 'fictional.txt', sha256: 'changed' }),
    )
    expect(() => verifyWindowsProof(folder, reference, manifest)).toThrow()
  })
})
