import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { verifyMacProof } from '../lib/release-mac-proof.mjs'
import { macProofFixture } from './fixtures/release-mac-proof.mjs'

import { FICTIONAL_SIGNING_ENV } from './fixtures/mac-signing-identity.mjs'

const roots = []
afterEach(() => {
  vi.unstubAllEnvs()
  for (const folder of roots.splice(0)) rmSync(folder, { recursive: true, force: true })
})
function fixture(external = false) {
  for (const [name, value] of Object.entries(FICTIONAL_SIGNING_ENV)) vi.stubEnv(name, value)
  const folder = mkdtempSync(join(tmpdir(), 'fictional-guided-proof-'))
  roots.push(folder)
  const manifest = {
    version: '0.2.12',
    source: 'a'.repeat(40),
    tree: 'b'.repeat(40),
    runId: 11,
    runAttempt: 1,
    origins: { macos: { artifactId: 41, digest: 'sha256:' + 'c'.repeat(64) } },
    assets: [
      'BroCrew-0.2.12-arm64.dmg',
      'BroCrew-0.2.12-arm64.dmg.blockmap',
      'BroCrew-0.2.12-arm64-mac.zip',
      'BroCrew-0.2.12-arm64-mac.zip.blockmap',
      'latest-mac.yml',
    ].map((name) => ({
      name,
      bytes: 12,
      sha256: 'd'.repeat(64),
      sha512: Buffer.alloc(64).toString('base64'),
    })),
  }
  const reference = { runId: 20, runAttempt: 1 }
  const summary = macProofFixture(folder, manifest, reference, external)
  return { folder, manifest, reference, summary }
}
describe('three-workspace guided Mac proof binding', () => {
  it('refuses missing or independently different configured identity despite a consistent artifact claim', () => {
    const f = fixture()
    vi.stubEnv('MAC_EXPECTED_TEAM_ID', '')
    expect(() => verifyMacProof(f.folder, f.reference, f.manifest)).toThrow(
      'Configured Mac signing',
    )
    vi.stubEnv('MAC_EXPECTED_TEAM_ID', 'OTHER12345')
    vi.stubEnv(
      'MAC_EXPECTED_SIGNING_AUTHORITY',
      'Developer ID Application: Other Developer (OTHER12345)',
    )
    expect(() => verifyMacProof(f.folder, f.reference, f.manifest)).toThrow(
      'Candidate signing team differs',
    )
  })
  it('accepts the actual contract shape with fictional sealed files and raw drains', () => {
    const f = fixture()
    expect(verifyMacProof(f.folder, f.reference, f.manifest).success).toBe(true)
  })
  for (const [reason, change] of [
    [
      'old or fabricated baseline',
      (x) => {
        x.baseline.source = '0'.repeat(40)
      },
    ],
    [
      'different build origin',
      (x) => {
        x.to.artifactId++
      },
    ],
    [
      'different installer bytes',
      (x) => {
        x.to.files[0].sha256 = '0'.repeat(64)
      },
    ],
    [
      'single workspace',
      (x) => {
        x.workspaces.pop()
      },
    ],
    [
      'two installs',
      (x) => {
        x.replacementCount = 2
      },
    ],
    [
      'dirty installed build',
      (x) => {
        x.concurrentSignedFirst[0].dirty = true
      },
    ],
    [
      'other installed app',
      (x) => {
        x.concurrentSignedFirst[0].command = '/other/BroCrew'
      },
    ],
    [
      'duplicate concurrent process',
      (x) => {
        x.concurrentSignedSecond[0].pid = x.concurrentSignedSecond[1].pid
      },
    ],
    [
      'changed workspace path',
      (x) => {
        x.concurrentSignedSecond[0].path = '/other/data'
      },
    ],
    [
      'lost credential',
      (x) => {
        x.workspaces[0].credential.inUse = false
      },
    ],
    [
      'cleanup failure',
      (x) => {
        x.cleanupFailure = 'fictional failure'
      },
    ],
    [
      'wrong signing team',
      (x) => {
        x.installedCandidate.signature = 'ad hoc'
      },
    ],
    [
      'missing transport success',
      (x) => {
        x.controlledTransport.failures.push('failed download')
      },
    ],
    [
      'automatic mode',
      (x) => {
        x.mode = 'automatic'
      },
    ],
  ])
    it(`rejects ${reason} despite success=true`, () => {
      const f = fixture()
      const summary = structuredClone(f.summary)
      change(summary)
      writeFileSync(join(f.folder, 'summary.json'), JSON.stringify(summary))
      expect(() => verifyMacProof(f.folder, f.reference, f.manifest)).toThrow()
    })
  for (const failure of ['drain', 'ciphertext', 'database'])
    it(`checks raw ${failure} evidence`, () => {
      const f = fixture()
      if (failure === 'drain')
        writeFileSync(
          join(f.folder, 'Default/stage-0.log'),
          'BroCrew failed to close its database: busy',
        )
      else {
        const path = join(f.folder, 'Default/b-first-data.json'),
          after = JSON.parse(readFileSync(path, 'utf8'))
        if (failure === 'ciphertext') after.provider_api_key[0].sealed = 're-saved-key'
        else after.events = []
        writeFileSync(path, JSON.stringify(after))
      }
      expect(() => verifyMacProof(f.folder, f.reference, f.manifest)).toThrow()
    })
})

describe('original-artifact Mac proof with honest external harness source', () => {
  it('accepts the pinned carrier while retaining original candidate source and sealed download', () => {
    const f = fixture(true)
    expect(verifyMacProof(f.folder, f.reference, f.manifest, true).success).toBe(true)
    expect(f.summary.harnessSource).not.toBe(f.summary.source)
  })
  for (const [reason, change] of [
    [
      'candidate impersonating the carrier',
      (x) => {
        x.harnessSource = x.source
      },
    ],
    [
      'different carrier',
      (x) => {
        x.harnessSource = '0'.repeat(40)
      },
    ],
    [
      'draft transport',
      (x) => {
        x.transport = 'controlled-draft-github'
      },
    ],
    [
      'draft release input',
      (x) => {
        x.to.releaseId = 101
      },
    ],
    [
      'different build attempt',
      (x) => {
        x.to.runAttempt = 2
      },
    ],
    [
      'missing original input attempt',
      (x) => {
        delete x.candidate.input.runAttempt
      },
    ],
    [
      'draft asset identifier',
      (x) => {
        x.candidate.files[0].assetId = 101
      },
    ],
    [
      'no sealed DMG download',
      (x) => {
        x.controlledTransport.requests = []
      },
    ],
    [
      'wrong original upstream',
      (x) => {
        x.controlledTransport.requests[0].upstream = 'draft'
      },
    ],
    [
      'unfinished download',
      (x) => {
        x.controlledTransport.requests[0].completed = false
      },
    ],
    [
      'wrong delivered bytes',
      (x) => {
        x.controlledTransport.requests[0].bytes++
      },
    ],
    [
      'wrong delivered hash',
      (x) => {
        x.controlledTransport.requests[0].sha256 = '0'.repeat(64)
      },
    ],
  ])
    it(`rejects ${reason} despite success=true`, () => {
      const f = fixture(true)
      const changed = structuredClone(f.summary)
      change(changed)
      writeFileSync(join(f.folder, 'summary.json'), JSON.stringify(changed))
      expect(() => verifyMacProof(f.folder, f.reference, f.manifest, true)).toThrow()
    })
})
