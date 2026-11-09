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
const fixture = (kind = 'windows-clean', current = false, versions) => {
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
  const reference = windowsProofFixture(folder, manifest, kind, current, versions)
  return {
    folder: current ? join(folder, 'driver') : folder,
    manifest,
    reference,
  }
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

describe('one immutable public catalogue per Windows proof invocation', () => {
  it('accepts each run own original capture without fixing plugin versions across clean and upgrade', () => {
    const clean = fixture('windows-clean', true)
    const upgrade = fixture('windows-upgrade', true, { chrome: '0.1.11', whatsapp: '0.1.5' })
    expect(
      verifyWindowsProof(clean.folder, clean.reference, clean.manifest, true).pluginPins.whatsapp
        .version,
    ).toBe('0.1.4')
    expect(
      verifyWindowsProof(upgrade.folder, upgrade.reference, upgrade.manifest, true).pluginPins
        .whatsapp.version,
    ).toBe('0.1.5')
  })
  for (const [reason, file, mutate] of [
    [
      'user-selected version',
      'native-receipt.json',
      (x) => {
        x.pluginPins.chrome.version = '0.1.9'
      },
    ],
    [
      'user-selected manifest',
      'native-receipt.json',
      (x) => {
        x.pluginPins.chrome.manifest = '0'.repeat(64)
      },
    ],
    [
      'stale mode label',
      'native-receipt.json',
      (x) => {
        x.testPath = 'public-019-clean'
      },
    ],
    [
      'rewritten capture receipt',
      'public-catalogue-capture.json',
      (x) => {
        x.bytes++
      },
    ],
    [
      'wrong captured origin',
      'public-catalogue-capture.json',
      (x) => {
        x.origin.runId = 'different'
      },
    ],
    [
      'catalogue pin not derived from snapshot',
      'public-catalogue-capture.json',
      (x) => {
        x.selected.chrome.entrySha256 = '0'.repeat(64)
      },
    ],
    [
      'capture after native entry',
      'public-catalogue-capture.json',
      (x) => {
        x.capturedAt = '2026-11-08T00:03:00Z'
      },
    ],
    [
      'wrong capture URL',
      'public-catalogue-capture.json',
      (x) => {
        x.url = 'https://other.example/catalogue.json'
      },
    ],
    [
      'wrong public archive bytes',
      'public-chrome-release.json',
      (x) => {
        x.assets[0].size++
      },
    ],
    [
      'wrong extracted input archive',
      'input-chrome-manifest-extraction.json',
      (x) => {
        x.stdinSha256 = '0'.repeat(64)
      },
    ],
    [
      'failed installed manifest extraction',
      'candidate-installed-chrome-manifest-extraction.json',
      (x) => {
        x.status = 1
      },
    ],
    [
      'changed installed manifest',
      'candidate-installed-chrome-plugin.json',
      (x) => {
        x.version = '0.1.9'
      },
    ],
  ])
    it(`rejects ${reason}`, () => {
      const f = fixture('windows-clean', true)
      change(f.folder, file, mutate)
      if (file === 'public-catalogue-capture.json') {
        const capture = JSON.parse(readFileSync(join(f.folder, file), 'utf8'))
        change(f.folder, 'native-receipt.json', (native) => {
          native.publicCatalogue = capture
        })
        change(f.folder, 'summary.json', (summary) => {
          summary.publicCatalogue = capture
        })
      }
      expect(() => verifyWindowsProof(f.folder, f.reference, f.manifest, true)).toThrow()
    })
  it('rejects changed original catalogue bytes without refreshing the receipt hash', () => {
    const f = fixture('windows-clean', true)
    writeFileSync(join(f.folder, 'public-catalogue-v2.json'), '{"format":2,"entries":[]}')
    expect(() => verifyWindowsProof(f.folder, f.reference, f.manifest, true)).toThrow()
  })
})

describe('regular-file manifest rows in Windows proof', () => {
  for (const current of [false, true])
    for (const kind of ['windows-clean', 'windows-upgrade'])
      it(`accepts typed regular-file rows for ${current ? 'current' : 'legacy'} ${kind}`, () => {
        const f = fixture(kind, current)
        for (const id of ['chrome', 'whatsapp']) {
          const manifest = JSON.parse(
            readFileSync(join(f.folder, `candidate-installed-${id}-plugin.json`)),
          )
          expect(manifest.files).toHaveLength(2)
          expect(manifest.files.every((file) => file.type === 'file')).toBe(true)
          expect(new Set(manifest.files.map((file) => file.path)).size).toBe(2)
        }
        expect(verifyWindowsProof(f.folder, f.reference, f.manifest, current).passed).toBe(true)
      })

  for (const [reason, manifestChange, observedChange] of [
    [
      'missing manifest type',
      (files) => {
        delete files[0].type
      },
      null,
    ],
    [
      'symlink manifest type',
      (files) => {
        files[0].type = 'symlink'
      },
      null,
    ],
    [
      'directory manifest type',
      (files) => {
        files[0].type = 'directory'
      },
      null,
    ],
    [
      'unknown manifest type',
      (files) => {
        files[0].type = 'unknown'
      },
      null,
    ],
    [
      'different observed path',
      null,
      (files) => {
        files[0].path = 'another.mjs'
      },
    ],
    [
      'different observed hash',
      null,
      (files) => {
        files[0].sha256 = '0'.repeat(64)
      },
    ],
    [
      'different observed byte length',
      null,
      (files) => {
        files[0].bytes++
      },
    ],
    [
      'missing observed row',
      null,
      (files) => {
        files.pop()
      },
    ],
    [
      'extra observed row',
      null,
      (files) => {
        files.push({ path: 'extra.mjs', sha256: 'a'.repeat(64), bytes: 1 })
      },
    ],
    [
      'duplicate observed row',
      null,
      (files) => {
        files[1] = { ...files[0] }
      },
    ],
    [
      'reordered observed rows',
      null,
      (files) => {
        files.reverse()
      },
    ],
  ])
    it(`rejects ${reason} at the complete manifest-row comparison`, () => {
      const f = fixture()
      const manifestFile = 'candidate-installed-chrome-plugin.json'
      if (manifestChange) change(f.folder, manifestFile, (value) => manifestChange(value.files))
      if (observedChange) {
        change(f.folder, 'candidate-live-hosts.json', (hosts) =>
          observedChange(hosts[0].packageFiles),
        )
        const hosts = JSON.parse(readFileSync(join(f.folder, 'candidate-live-hosts.json')))
        change(f.folder, 'summary.json', (summary) => {
          summary.liveHosts = hosts
        })
      }
      const manifest = JSON.parse(readFileSync(join(f.folder, manifestFile)))
      let error
      try {
        verifyWindowsProof(f.folder, f.reference, f.manifest)
      } catch (caught) {
        error = caught
      }
      expect(error).toMatchObject({
        code: 'ERR_ASSERTION',
        operator: 'deepStrictEqual',
        expected: manifest.files,
      })
      expect(error.stack).toContain('at verifyWindowsProof')
    })
})
