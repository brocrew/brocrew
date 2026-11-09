import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { verifyMacNormalInstall, verifyMacProof } from '../lib/release-mac-proof.mjs'
import { candidateNames } from '../mac-signed-upgrade-contract.mjs'
import { fileSeal } from '../release-artifacts.mjs'
import {
  macNormalAssessment,
  macOriginalArtifactFixture,
  macProofFixture,
  macWitness,
} from './fixtures/release-mac-proof.mjs'

import { FICTIONAL_SIGNING_ENV } from './fixtures/mac-signing-identity.mjs'

const roots = []
afterEach(() => {
  vi.unstubAllEnvs()
  for (const folder of roots.splice(0)) rmSync(folder, { recursive: true, force: true })
})
function fixture() {
  for (const [name, value] of Object.entries(FICTIONAL_SIGNING_ENV)) vi.stubEnv(name, value)
  const folder = mkdtempSync(join(tmpdir(), 'fictional-guided-proof-'))
  roots.push(folder)
  const manifest = {
    version: '0.2.12',
    source: 'a'.repeat(40),
    tree: 'b'.repeat(40),
    runId: 11,
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
  const summary = macProofFixture(folder, manifest, reference)
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

function normalFixture() {
  for (const [name, value] of Object.entries(FICTIONAL_SIGNING_ENV)) vi.stubEnv(name, value)
  const root = mkdtempSync(join(tmpdir(), 'fictional-normal-install-'))
  roots.push(root)
  const assets = join(root, 'assets'),
    original = join(root, 'release-macos')
  mkdirSync(assets)
  const names = candidateNames('0.2.13')
  for (const name of names) writeFileSync(join(assets, name), `fictional signed ${name}`)
  const manifest = {
    repository: 'brocrew/brocrew',
    version: '0.2.13',
    source: 'a'.repeat(40),
    tree: 'b'.repeat(40),
    runId: 11,
    runAttempt: 1,
    origins: { macos: { artifactId: 41, digest: 'sha256:' + 'c'.repeat(64) } },
    assets: names.map((name) => ({ name, ...fileSeal(join(assets, name)) })),
  }
  const assessment = macNormalAssessment(
    manifest,
    macOriginalArtifactFixture(original, manifest, assets),
  )
  const verify = (value = assessment, witness = macWitness(value)) =>
    verifyMacNormalInstall(original, witness, manifest)
  return { original, manifest, assessment, verify }
}
const refusal = (check) => {
  try {
    check()
  } catch (error) {
    return error
  }
  throw new Error('expected a refusal')
}

describe('finite 0.2.13 Mac normal-install assessment', () => {
  it('accepts the reviewed headless assessment with the honest Keychain limitation', () => {
    const f = normalFixture()
    expect(f.verify().keychain).toMatchObject({ observed: false, disposition: 'cannot-show' })
  })
  it('accepts an actual Keychain observation only with its own sealed evidence role', () => {
    const f = normalFixture()
    const observed = structuredClone(f.assessment)
    observed.keychain = { observed: true, disposition: 'prompt-shown', detail: 'Operator saw it.' }
    expect(() => f.verify(observed)).toThrow()
    observed.evidence.push({
      role: 'keychain-observation',
      reference: 'fictional/keychain.json',
      bytes: 9,
      sha256: '9'.repeat(64),
    })
    expect(f.verify(observed).keychain.observed).toBe(true)
  })
  it('checks the original text hash before parsing the assessment', () => {
    const f = normalFixture()
    const witness = macWitness(f.assessment)
    expect(() => f.verify(f.assessment, { ...witness, json: '{not json' })).toThrow(
      'Mac normal-install assessment bytes differ',
    )
    expect(() => f.verify(f.assessment, { ...witness, json: witness.json + ' ' })).toThrow(
      'Mac normal-install assessment bytes differ',
    )
    for (const changed of [
      { json: witness.json },
      { ...witness, sha256: witness.sha256.toUpperCase() },
      { ...witness, accepted: true },
      { ...witness, json: JSON.parse(witness.json) },
    ])
      expect(() => f.verify(f.assessment, changed)).toThrow()
  })
  for (const [label, change] of [
    ['old version', (a) => (a.version = '0.2.12')],
    ['other source', (a) => (a.source = '0'.repeat(40))],
    ['other tree', (a) => (a.tree = '0'.repeat(40))],
    ['other run', (a) => a.candidate.runId++],
    ['other attempt', (a) => a.candidate.runAttempt++],
    ['other Mac artifact', (a) => a.candidate.macArtifactId++],
    [
      'other Mac artifact digest',
      (a) => (a.candidate.macArtifactDigest = 'sha256:' + '0'.repeat(64)),
    ],
    ['other DMG', (a) => (a.dmg.sha256 = '0'.repeat(64))],
    ['other signing receipt', (a) => a.signingReceipt.bytes++],
    ['other team', (a) => (a.signing.teamId = 'OTHER12345')],
    ['other authority', (a) => (a.signing.authority += ' copy')],
    ['other signing run', (a) => a.signing.runId++],
    ['missing signing job', (a) => (a.signing.jobId = 0)],
    ['rejected app notary', (a) => (a.signing.results.appNotary = 'Invalid')],
    ['rejected DMG notary', (a) => (a.signing.results.dmgNotary = 'Invalid')],
    ['failed Gatekeeper', (a) => (a.signing.results.gatekeeper = 'FAIL')],
    ['unstapled', (a) => (a.signing.results.stapler = 'FAIL')],
    ['ad hoc signature', (a) => (a.signing.results.codesign = 'ad-hoc')],
    ['unlabelled raw outputs', (a) => (a.signing.rawOutputs = 'summary only')],
    ['missing plugin', (a) => a.oldMac.plugins.pop()],
    ['stopped plugin', (a) => (a.oldMac.plugins[0].state = 'Stopped')],
    ['empty tools', (a) => (a.oldMac.plugins[1].tools = [])],
    ['repeated tool', (a) => a.oldMac.plugins[1].tools.push('list_chats')],
    ['tool count drift', (a) => a.oldMac.plugins[0].toolCount++],
    ['unpinned harness', (a) => (a.oldMac.harness.source = 'main')],
    ['other service resource', (a) => (a.oldMac.service.resource = 'entry.cjs')],
    ['reversed times', (a) => (a.oldMac.finished = '2026-11-08T01:00:00Z')],
    ['abnormal exit', (a) => (a.lifecycle.exit = { code: 1, signal: null })],
    ['signal exit', (a) => (a.lifecycle.exit = { code: null, signal: 'SIGTERM' })],
    ['timeout', (a) => (a.lifecycle.timedOut = true)],
    ['signal fallback', (a) => (a.lifecycle.signalFallback = true)],
    ['cleanup failure', (a) => a.lifecycle.cleanupFailures.push('owned child left running')],
    ['open lease', (a) => (a.lifecycle.leaseClosed = false)],
    ['attached image', (a) => (a.lifecycle.imageDetached = false)],
    ['changed DMG bytes', (a) => (a.lifecycle.dmgUnchanged = false)],
    ['missing evidence role', (a) => a.evidence.pop()],
    ['repeated evidence role', (a) => (a.evidence[1].role = a.evidence[0].role)],
    ['unsafe evidence reference', (a) => (a.evidence[0].reference = '../outside.json')],
    ['empty evidence', (a) => (a.evidence[0].bytes = 0)],
    ['GUI claim', (a) => (a.scope.notClaimed = ['finder', 'linked-accounts', 'soak'])],
    ['scripted copy as Finder', (a) => (a.normalInstall.scriptedCopyIsFinderDrag = true)],
    ['scheduled automatic updates', (a) => (a.automaticUpdates = 'included')],
    ['saved-key success claim', (a) => (a.keychain = { observed: true, detail: 'reused' })],
    ['empty Keychain detail', (a) => (a.keychain.detail = ' ')],
    ['historical record', (a) => (a.recordKind = 'copied-earlier-result')],
    ['catch-all success field', (a) => (a.success = true)],
    ['missing lifecycle', (a) => delete a.lifecycle],
  ])
    it(`refuses a coherently resealed assessment with ${label}`, () => {
      const f = normalFixture()
      const assessment = structuredClone(f.assessment)
      change(assessment)
      const error = refusal(() => f.verify(assessment))
      expect(error.code).toBe('ERR_ASSERTION')
      expect(error.message).not.toBe('Mac normal-install assessment bytes differ')
    })
  for (const [label, change, expected] of [
    [
      'altered DMG bytes',
      (f) => writeFileSync(join(f.original, 'BroCrew-0.2.13-arm64.dmg'), 'x'),
      { code: 'ERR_ASSERTION' },
    ],
    [
      'extra file',
      (f) => writeFileSync(join(f.original, 'notes.txt'), 'extra'),
      { code: 'ERR_ASSERTION' },
    ],
    [
      'missing receipt',
      (f) => rmSync(join(f.original, 'mac-signed-candidate.json')),
      { code: 'ERR_ASSERTION' },
    ],
    [
      'receipt team',
      (f) => {
        const path = join(f.original, 'mac-signed-candidate.json')
        const receipt = JSON.parse(readFileSync(path, 'utf8'))
        receipt.teamId = 'OTHER12345'
        writeFileSync(path, JSON.stringify(receipt))
        f.assessment.signingReceipt = (({ bytes, sha256 }) => ({ bytes, sha256 }))(fileSeal(path))
      },
      { message: 'Candidate signing team differs.' },
    ],
    [
      'receipt row',
      (f) => {
        const path = join(f.original, 'mac-signed-candidate.json')
        const receipt = JSON.parse(readFileSync(path, 'utf8'))
        receipt.files[0].size++
        writeFileSync(path, JSON.stringify(receipt))
        f.assessment.signingReceipt = (({ bytes, sha256 }) => ({ bytes, sha256 }))(fileSeal(path))
      },
      { code: 'ERR_ASSERTION' },
    ],
  ])
    it(`refuses an original Mac artifact with ${label}`, () => {
      const f = normalFixture()
      change(f)
      expect(refusal(() => f.verify())).toMatchObject(expected)
    })
})
