import { execFileSync } from 'node:child_process'
import {
  cpSync,
  copyFileSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { createHash } from 'node:crypto'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { assetNames, fileSeal, releasePlan, verifyAssets } from '../release-artifacts.mjs'
import * as releaseArtifacts from '../release-artifacts.mjs'
import { checkedArtifact, checkedRun, checkedTag, github } from '../lib/release-github.mjs'
import { publishSelection } from '../release-selection.mjs'
import { WINDOWS_PROOF_SOURCE } from '../lib/release-proofs.mjs'
import { kind, publicationFixture as fixturePublication } from './fixtures/release-proof.mjs'

vi.mock('node:child_process', () => ({ execFileSync: vi.fn() }))
vi.mock('../release-artifacts.mjs', async (importOriginal) => {
  const actual = await importOriginal()
  return { ...actual, PROOF_PUBLICATION: { ...actual.PROOF_PUBLICATION } }
})
const PROOF_PUBLICATION = releaseArtifacts.PROOF_PUBLICATION ?? {
  repository: 'brocrew/brocrew',
  source: '90c4db564be21eb4fa22b7fba95c5d861ac95b29',
  tree: 'cf373e75a8fb2336fd92799fb003270257bb6c38',
  executionTag: 'v0.2.12-proof-carrier.4',
}

const actualMacWitnessSha256 = PROOF_PUBLICATION.macInstallWitnessSha256
const roots = []
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
  vi.restoreAllMocks()
  vi.unstubAllEnvs()
  PROOF_PUBLICATION.macInstallWitnessSha256 = actualMacWitnessSha256
})

const publicationFixture = (external = false) =>
  fixturePublication(external, { folder, fixture, publication: PROOF_PUBLICATION })

describe('publication of an immutable tested selection', () => {
  it('uploads exactly eight tested assets, reads all draft/public files and attests each readback', async () => {
    const f = publicationFixture()
    await expect(f.publish()).resolves.toMatchObject({
      publicReadback: true,
      selectionHash: f.selectionHash,
    })
    expect(f.state.release.assets.map((row) => row.name).sort()).toEqual(assetNames('0.2.12'))
    expect(f.state.downloads).toHaveLength(16)
    expect(f.state.attestations).toHaveLength(25)
    expect(f.state.calls.map(kind).filter((command) => command !== 'download')).toEqual([
      'create',
      ...Array(8).fill('upload'),
      'edit',
    ])
    expect(f.state.calls.flat()).not.toContain('--clobber')
    for (const name of assetNames('0.2.12'))
      expect(f.state.uploadTypes[name]).toBe(f.uploadType(name))
    expect(f.state.calls.filter((args) => args[0] === 'release').map(kind)).toEqual(
      Array(16).fill('download'),
    )
  })
  for (const draft of [true, false])
    it(`resumes a matching ${draft ? 'partial draft' : 'published release'} without replacing files`, async () => {
      const f = publicationFixture(),
        names = assetNames('0.2.12')
      f.state.release = {
        id: 99,
        tag_name: 'v0.2.12',
        body: f.body,
        draft,
        prerelease: false,
        assets: (draft ? names.slice(0, 3) : names).map(f.asset),
      }
      await f.publish()
      const uploads = f.state.calls.filter((args) => kind(args) === 'upload')
      expect(uploads.map((args) => basename(args[args.indexOf('--input') + 1]))).toEqual(
        draft ? names.slice(3) : [],
      )
      expect(f.state.calls.some((args) => kind(args) === 'create')).toBe(false)
    })
  for (const failure of [
    'receipt',
    'artifact-origin',
    'proof-failed',
    'clean-order',
    'manifest',
    'attestation',
    'existing-bytes',
    'existing-notes',
    'extra-asset',
  ])
    it(`refuses ${failure} before uploading or publishing`, async () => {
      const f = publicationFixture()
      if (failure === 'receipt') f.selection.proofs[0].receiptSha256 = '0'.repeat(64)
      if (failure === 'artifact-origin') f.artifacts.get(50).workflow_run.head_sha = '0'.repeat(40)
      if (failure === 'proof-failed') f.runs.get(20).conclusion = 'failure'
      if (failure === 'clean-order') f.runs.get(22).run_started_at = '2026-11-08T00:00:00Z'
      if (failure === 'manifest') f.selection.candidate.manifestSha256 = '0'.repeat(64)
      if (failure === 'attestation')
        f.client.attest.mockImplementation(() => {
          throw new Error('wrong attestation origin')
        })
      if (failure.startsWith('existing-') || failure === 'extra-asset') {
        const row = f.asset(assetNames('0.2.12')[0])
        if (failure === 'existing-bytes') row.digest = 'sha256:' + '0'.repeat(64)
        if (failure === 'extra-asset') row.name = 'unexpected.zip'
        f.state.release = {
          id: 99,
          tag_name: 'v0.2.12',
          body: failure === 'existing-notes' ? 'other notes' : f.body,
          draft: true,
          prerelease: false,
          assets: [row],
        }
      }
      await expect(f.publish()).rejects.toThrow()
      expect(f.state.calls.some((args) => ['upload', 'edit', 'create'].includes(kind(args)))).toBe(
        false,
      )
    })
  it('reports altered public bytes after publication without rewriting or deleting the release', async () => {
    const f = publicationFixture()
    f.state.corruptReadback = true
    await expect(f.publish()).rejects.toThrow('Uploaded release bytes differ')
    expect(f.state.release.draft).toBe(false)
    expect(f.state.calls.filter((args) => kind(args) === 'upload')).toHaveLength(8)
    expect(f.state.calls.flat()).not.toContain('delete')
  })
})

describe('draft-aware release discovery and immutable release identity', () => {
  it('discovers an unpublished draft by release ID while the tag endpoint remains published-only', async () => {
    const f = publicationFixture()
    const result = await f.publish()
    expect(result).toMatchObject({ releaseId: 99, publicReadback: true })
    expect(f.state.apiCalls.filter((path) => path === 'releases/tags/v0.2.12')).toHaveLength(1)
    expect(f.state.idReads).toBe(2)
    expect(f.state.calls.filter((args) => kind(args) === 'create')).toHaveLength(1)
    expect(f.state.downloads).toHaveLength(16)
  })
  for (const complete of [false, true])
    it(`resumes a matching ${complete ? 'complete' : 'empty'} draft through its ID`, async () => {
      const f = publicationFixture()
      f.state.release = f.matchingRelease(complete ? assetNames('0.2.12') : [])
      await f.publish()
      expect(f.state.calls.some((args) => kind(args) === 'create')).toBe(false)
      expect(f.state.calls.filter((args) => kind(args) === 'upload')).toHaveLength(complete ? 0 : 8)
      expect(f.state.calls.filter((args) => kind(args) === 'edit')).toHaveLength(1)
    })
  it('finds the target on a later release-list page without treating a draft as published', async () => {
    const f = publicationFixture()
    f.state.listBefore = Array.from({ length: 100 }, (_, i) => ({
      id: 1000 + i,
      tag_name: `v0.1.${i}`,
    }))
    f.state.release = f.matchingRelease()
    await f.publish()
    expect(f.state.apiCalls).toContain('releases?per_page=100&page=2')
    expect(f.state.calls.some((args) => kind(args) === 'create')).toBe(false)
  })
  for (const acrossPages of [false, true])
    it(`refuses duplicate target releases ${acrossPages ? 'across pages' : 'on one page'}`, async () => {
      const f = publicationFixture()
      f.state.release = f.matchingRelease()
      if (acrossPages)
        f.state.listBefore = Array.from({ length: 99 }, (_, i) => ({
          id: 1000 + i,
          tag_name: `v0.1.${i}`,
        }))
      f.state.listBefore.push({ ...f.matchingRelease(), id: 98 })
      await expect(f.publish()).rejects.toThrow('Multiple releases have the target tag')
      expect(f.state.calls).toEqual([])
    })
  for (const id of [0, -1, 1.5, '99'])
    it(`refuses a listed release ID ${JSON.stringify(id)} before metadata lookup or mutation`, async () => {
      const f = publicationFixture()
      f.state.release = { ...f.matchingRelease(), id }
      await expect(f.publish()).rejects.toThrow('Invalid release ID')
      expect(f.state.idReads).toBe(0)
      expect(f.state.calls).toEqual([])
    })
  for (const response of [null, {}])
    it(`refuses a non-list discovery response ${JSON.stringify(response)}`, async () => {
      const f = publicationFixture()
      f.state.listResponse = () => response
      await expect(f.publish()).rejects.toThrow('Invalid release listing')
      expect(f.state.calls).toEqual([])
    })
  for (const phase of ['list', 'ID'])
    it(`preserves ${phase} lookup errors instead of creating another draft`, async () => {
      const f = publicationFixture()
      f.state.release = f.matchingRelease()
      const fail = () => {
        throw new Error('permission denied')
      }
      if (phase === 'list') f.state.listResponse = fail
      else f.state.idResponse = fail
      await expect(f.publish()).rejects.toThrow('permission denied')
      expect(f.state.calls).toEqual([])
    })
  it('binds a created draft from its create response while the release listing lags behind', async () => {
    const f = publicationFixture()
    const result = await f.publish()
    expect(result).toMatchObject({ releaseId: 99, publicReadback: true })
    expect(f.state.calls.filter((args) => kind(args) === 'create')).toHaveLength(1)
    const afterCreate = f.state.apiCalls.slice(f.state.apiCallsAtCreate)
    expect(afterCreate.filter((path) => path.startsWith('releases?'))).toEqual([])
    expect(
      f.state.apiCalls.slice(f.state.apiCallsAtCreate, f.state.apiCallsAtFirstUpload),
    ).not.toContain('releases/99')
  })
  it('sends exactly the reviewed draft request once', async () => {
    const f = publicationFixture()
    await f.publish()
    expect(f.state.createRequest).toBe(
      JSON.stringify({
        tag_name: 'v0.2.12',
        name: 'BroCrew 0.2.12',
        body: f.body,
        draft: true,
        prerelease: false,
      }),
    )
  })
  for (const [label, change, message] of [
    ['ID 0', (row) => ({ ...row, id: 0 }), 'Invalid release ID'],
    ['ID -1', (row) => ({ ...row, id: -1 }), 'Invalid release ID'],
    ['ID 1.5', (row) => ({ ...row, id: 1.5 }), 'Invalid release ID'],
    ['ID "99"', (row) => ({ ...row, id: '99' }), 'Invalid release ID'],
    ['missing ID', (row) => ({ ...row, id: undefined }), 'Invalid release ID'],
    ['non-object response', () => null, 'Invalid release ID'],
    ['tag', (row) => ({ ...row, tag_name: 'v0.2.13' }), 'Existing release is not bound'],
    ['marker', (row) => ({ ...row, body: 'another selection' }), 'Existing release is not bound'],
  ])
    it(`refuses a created release with an invalid ${label} after one request`, async () => {
      const f = publicationFixture()
      f.state.createResponse = change
      await expect(f.publish()).rejects.toThrow(message)
      expect(f.state.calls.map(kind)).toEqual(['create'])
    })
  for (const command of ['create', 'upload', 'edit'])
    it(`propagates a ${command} transport error without retrying`, async () => {
      const f = publicationFixture()
      f.state.runFailure = (current) => {
        if (current === command) throw new Error(`${command} failed`)
      }
      await expect(f.publish()).rejects.toThrow(`${command} failed`)
      expect(f.state.calls.filter((args) => kind(args) === command)).toHaveLength(1)
      expect(f.state.calls.filter((args) => kind(args) === 'create')).toHaveLength(1)
      if (command === 'create')
        expect(f.state.apiCalls.filter((path) => path.startsWith('releases?'))).toHaveLength(1)
      if (command !== 'edit')
        expect(f.state.calls.some((args) => kind(args) === 'edit')).toBe(false)
    })
  for (const [phase, ordinal] of [
    ['discovery', 1],
    ['after upload', 2],
    ['after edit', 3],
  ])
    for (const [field, change] of [
      ['ID', (row) => ({ ...row, id: 98 })],
      ['tag', (row) => ({ ...row, tag_name: 'v0.2.13' })],
      ['notes or marker', (row) => ({ ...row, body: 'a different tested selection' })],
      ['prerelease', (row) => ({ ...row, prerelease: true })],
      ['draft shape', (row) => ({ ...row, draft: 'true' })],
      ['asset shape', (row) => ({ ...row, assets: null })],
      ['disappearance', () => null],
    ])
      it(`refuses ${field} drift at ${phase} without a later mutation`, async () => {
        const f = publicationFixture()
        f.state.release = f.matchingRelease()
        f.state.idResponse = (row, count) => (count === ordinal ? change(row) : row)
        await expect(f.publish()).rejects.toThrow('Existing release is not bound')
        expect(f.state.calls.filter((args) => kind(args) === 'create')).toHaveLength(0)
        expect(f.state.calls.filter((args) => kind(args) === 'upload')).toHaveLength(
          ordinal > 1 ? 8 : 0,
        )
        expect(f.state.calls.filter((args) => kind(args) === 'edit')).toHaveLength(
          ordinal > 2 ? 1 : 0,
        )
        expect(f.state.calls.flat()).not.toContain('delete')
      })
  for (const [label, change] of [
    ['missing asset', (assets) => assets.pop()],
    ['duplicate asset', (assets) => assets.push(assets[0])],
    [
      'foreign asset',
      (assets) => {
        assets[0].name = 'foreign.zip'
      },
    ],
    [
      'size',
      (assets) => {
        assets[0].size++
      },
    ],
    [
      'digest',
      (assets) => {
        assets[0].digest = 'sha256:' + '0'.repeat(64)
      },
    ],
  ])
    it(`refuses uploaded draft ${label} before publication`, async () => {
      const f = publicationFixture()
      f.state.release = f.matchingRelease()
      f.state.idResponse = (row, count) => {
        if (count === 2) change(row.assets)
        return row
      }
      await expect(f.publish()).rejects.toThrow()
      expect(f.state.calls.filter((args) => kind(args) === 'upload')).toHaveLength(8)
      expect(f.state.calls.some((args) => kind(args) === 'edit')).toBe(false)
    })
  it('refuses altered draft download bytes before publishing', async () => {
    const f = publicationFixture()
    f.state.corruptDraftReadback = true
    await expect(f.publish()).rejects.toThrow('Uploaded release bytes differ')
    expect(f.state.calls.some((args) => kind(args) === 'edit')).toBe(false)
  })
  it('refuses a draft readback attestation failure before publishing', async () => {
    const f = publicationFixture()
    const attest = f.client.attest.getMockImplementation()
    f.client.attest.mockImplementation((path, ...args) => {
      if (path.includes('/draft-readback/')) throw new Error('draft attestation differs')
      return attest(path, ...args)
    })
    await expect(f.publish()).rejects.toThrow('draft attestation differs')
    expect(f.state.calls.some((args) => kind(args) === 'edit')).toBe(false)
  })
  it('does not fill missing assets on an already published release', async () => {
    const f = publicationFixture()
    f.state.release = f.matchingRelease(assetNames('0.2.12').slice(0, 1), false)
    await expect(f.publish()).rejects.toThrow('Published release has missing assets')
    expect(f.state.calls.filter((args) => kind(args) !== 'download')).toEqual([])
  })
  it('does not claim publication when edit succeeds but the release remains a draft', async () => {
    const f = publicationFixture()
    f.state.keepDraft = true
    await expect(f.publish()).rejects.toThrow('Stable publication did not complete')
    expect(f.state.calls.filter((args) => kind(args) === 'edit')).toHaveLength(1)
  })
  for (const [label, change] of [
    ['ID', (row) => ({ ...row, id: 98 })],
    ['tag', (row) => ({ ...row, tag_name: 'v0.2.13' })],
    ['marker', (row) => ({ ...row, body: 'an older selection marker' })],
    ['prerelease', (row) => ({ ...row, prerelease: true })],
    ['absence', () => null],
    ['draft', (row) => ({ ...row, draft: true })],
  ])
    it(`refuses final published-tag ${label} mismatch without rewriting the release`, async () => {
      const f = publicationFixture()
      f.state.publicResponse = change
      await expect(f.publish()).rejects.toThrow()
      expect(f.state.calls.filter((args) => kind(args) === 'create')).toHaveLength(1)
      expect(f.state.calls.filter((args) => kind(args) === 'upload')).toHaveLength(8)
      expect(f.state.calls.filter((args) => kind(args) === 'edit')).toHaveLength(1)
      expect(f.state.calls.flat()).not.toContain('delete')
    })
})

const folder = () => {
  const path = mkdtempSync(join(tmpdir(), 'fictional-release-'))
  roots.push(path)
  return path
}
const fixture = () => {
  const path = folder(),
    version = '0.2.12'
  for (const name of assetNames(version)) writeFileSync(join(path, name), `final bytes for ${name}`)
  for (const [metadata, files] of [
    ['latest-mac.yml', ['BroCrew-0.2.12-arm64-mac.zip', 'BroCrew-0.2.12-arm64.dmg']],
    ['latest.yml', ['BroCrew-Setup-0.2.12-x64.exe']],
  ]) {
    const lines = [`version: ${version}`, 'files:']
    for (const file of files) {
      const seal = fileSeal(join(path, file))
      lines.push(`  - url: ${file}`, `    sha512: ${seal.sha512}`, `    size: ${seal.bytes}`)
    }
    lines.push(`path: ${files[0]}`, `sha512: ${fileSeal(join(path, files[0])).sha512}`, '')
    writeFileSync(join(path, metadata), lines.join('\n'))
  }
  return {
    path,
    manifest: {
      version,
      assets: assetNames(version).map((name) => ({ name, ...fileSeal(join(path, name)) })),
    },
  }
}

describe('honest publication execution source', () => {
  function executionFixture(change = {}) {
    const state = {
      head: 'e'.repeat(40),
      tree: 'f'.repeat(40),
      parent: PROOF_PUBLICATION.source,
      productTree: PROOF_PUBLICATION.tree,
      dirty: '',
      paths: 'scripts/release-selection.mjs\0',
      canonical: true,
      tagType: 'tag',
      tagTarget: 'e'.repeat(40),
      tagObject: 'd'.repeat(40),
      ...change,
    }
    vi.stubEnv('GITHUB_REF', `refs/tags/${PROOF_PUBLICATION.executionTag}`)
    vi.stubEnv('GITHUB_EVENT_NAME', 'workflow_dispatch')
    vi.stubEnv('GITHUB_SHA', 'e'.repeat(40))
    execFileSync.mockReset()
    execFileSync.mockImplementation((program, args) => {
      if (program === 'gh') {
        if (args[1].includes('/git/ref/tags/'))
          return JSON.stringify({ object: { type: state.tagType, sha: state.tagObject } })
        return JSON.stringify({
          object: { type: 'commit', sha: state.tagTarget },
          tagger: { name: 'BroCrew', email: '343827643+brocrew@users.noreply.github.com' },
        })
      }
      const command = args.slice(2).join(' ')
      if (command === 'rev-parse HEAD') return state.head
      if (command === 'rev-parse HEAD^{tree}') return state.tree
      if (command === `rev-parse ${PROOF_PUBLICATION.source}^{tree}`) return state.productTree
      if (command === 'show -s --format=%P ' + state.head) return state.parent
      if (command.startsWith('status ')) return state.dirty
      if (command.startsWith('diff --name-only ')) return state.paths
      if (command.startsWith('merge-base --is-ancestor ')) return ''
      if (command.startsWith('rev-list ')) return ''
      if (command.startsWith('show -s --format=%an'))
        return state.canonical
          ? 'BroCrew\n343827643+brocrew@users.noreply.github.com\nBroCrew\n343827643+brocrew@users.noreply.github.com'
          : 'foreign'
      throw new Error(`Unexpected source check: ${command}`)
    })
    const client = github(PROOF_PUBLICATION.repository, '/fictional/committed-carrier')
    return { state, check: () => client.source(PROOF_PUBLICATION.source, PROOF_PUBLICATION.tree) }
  }

  it('records actual execution source separately from the unchanged original product', () => {
    const f = executionFixture()
    expect(f.check()).toEqual({
      source: f.state.head,
      tree: f.state.tree,
      tag: PROOF_PUBLICATION.executionTag,
      tagObject: f.state.tagObject,
    })
    expect(process.env.GITHUB_SHA).toBe(f.state.head)
    expect(process.env.GITHUB_REF).toBe(`refs/tags/${PROOF_PUBLICATION.executionTag}`)
  })

  for (const [reason, change] of [
    ['wrong product tree', { productTree: '0'.repeat(40) }],
    ['wrong execution source', { head: '0'.repeat(40) }],
    ['product masquerading as carrier', { head: PROOF_PUBLICATION.source }],
    ['unreviewed ancestor chain', { parent: '0'.repeat(40) }],
    ['dirty tracked source', { dirty: ' M scripts/release-selection.mjs' }],
    ['changed product runtime', { paths: 'apps/desktop/src/main/runtime/runtime-host.ts\0' }],
    ['changed proof transport', { paths: 'scripts/mac-signed-upgrade-transport.mjs\0' }],
    ['empty carrier delta', { paths: '' }],
    ['foreign author', { canonical: false }],
    ['lightweight carrier tag', { tagType: 'commit' }],
    ['moved carrier tag', { tagTarget: '0'.repeat(40) }],
  ])
    it(`rejects ${reason}`, () => expect(executionFixture(change).check).toThrow())

  it('rejects a push event even at the reserved execution tag', () => {
    const f = executionFixture()
    vi.stubEnv('GITHUB_EVENT_NAME', 'push')
    expect(f.check).toThrow()
  })
})

describe('fixed 0.2.12 external publication execution', () => {
  it('only dispatches qualification/publication of the original targets and never builds', () => {
    const ref = 'refs/tags/v0.2.12-proof-carrier.4'
    expect(releasePlan(ref, 'workflow_dispatch', 'qualify')).toEqual({
      version: '0.2.12',
      tag: 'v0.2.12',
      build: false,
      qualify: true,
      publish: false,
      targetRef: 'refs/tags/v0.2.12-candidate.2',
      external: true,
    })
    expect(releasePlan(ref, 'workflow_dispatch', 'publish')).toEqual({
      version: '0.2.12',
      tag: 'v0.2.12',
      build: false,
      qualify: false,
      publish: true,
      targetRef: 'refs/tags/v0.2.12',
      external: true,
    })
    for (const [event, mode] of [
      ['push', ''],
      ['push', 'publish'],
      ['workflow_dispatch', 'build'],
      ['workflow_dispatch', ''],
    ])
      expect(() => releasePlan(ref, event, mode)).toThrow()
    for (const ref of [
      'refs/heads/main',
      'refs/tags/v0.2.13-proof-carrier.1',
      'refs/tags/v0.2.12-proof-carrier.1',
      'refs/tags/v0.2.12-proof-carrier.2',
      'refs/tags/v0.2.12-proof-carrier.3',
      'refs/tags/v0.2.12-proof-carrier.5',
    ])
      expect(() => releasePlan(ref, 'workflow_dispatch', 'publish')).toThrow()
  })

  it('publishes unchanged product bytes through the distinct pinned execution/proof sources', async () => {
    const f = publicationFixture(true)
    await expect(f.publish()).resolves.toMatchObject({ publicReadback: true })
    expect(f.selection.source).toBe(PROOF_PUBLICATION.source)
    expect(f.selection.execution.source).not.toBe(f.selection.source)
    expect(f.state.release.tag_name).toBe('v0.2.12')
    expect(f.state.calls.flat()).not.toContain('--clobber')
  })
  for (const reason of [
    'execution',
    'product',
    'tree',
    'candidate-run',
    'candidate-digest',
    'candidate-manifest',
    'windows-origin',
    'obsolete-guided-proof',
    'capture-origin',
    'capture-time',
    'clean-order',
    'carrier-tag',
    'stable-tag-object',
  ])
    it(`rejects external ${reason} mismatch before any release mutation`, async () => {
      const f = publicationFixture(true)
      if (reason === 'execution')
        f.selection.execution = { ...f.selection.execution, source: '0'.repeat(40) }
      if (reason === 'product') f.selection.source = '0'.repeat(40)
      if (reason === 'tree') f.selection.tree = '0'.repeat(40)
      if (reason === 'candidate-run') f.selection.candidate.runId++
      if (reason === 'candidate-digest') f.selection.candidate.digest = 'sha256:' + '0'.repeat(64)
      if (reason === 'candidate-manifest') f.selection.candidate.manifestSha256 = '0'.repeat(64)
      if (reason === 'windows-origin') f.runs.get(21).head_sha = WINDOWS_PROOF_SOURCE
      if (reason === 'obsolete-guided-proof')
        f.selection.proofs.push({ kind: 'mac-guided-upgrade' })
      if (reason === 'clean-order') f.runs.get(22).run_started_at = '2026-11-08T00:00:00Z'
      if (reason === 'carrier-tag') f.state.movedCarrier = true
      if (reason === 'stable-tag-object') f.state.movedStableTag = true
      if (reason === 'capture-origin' || reason === 'capture-time') {
        const folder = f.artifactFolders.get(51)
        const path = join(folder, 'driver', 'public-catalogue-capture.json')
        const capture = JSON.parse(readFileSync(path, 'utf8'))
        if (reason === 'capture-origin') capture.origin.runId = 'unrelated'
        else capture.capturedAt = '2026-11-07T00:00:00Z'
        writeFileSync(path, JSON.stringify(capture))
      }
      await expect(f.publish()).rejects.toThrow()
      expect(f.state.calls).toEqual([])
    })

  it('publishes the reviewed normal-install assessment with only the two hosted Windows proofs', async () => {
    const f = publicationFixture(true)
    const api = vi.spyOn(f.client, 'api')
    expect(f.selection.proofs.map((one) => one.kind)).toEqual(['windows-clean', 'windows-upgrade'])
    await expect(f.publish()).resolves.toMatchObject({ publicReadback: true })
    expect(api.mock.calls.flat()).not.toContain('actions/runs/20')
    expect(api.mock.calls.flat()).not.toContain('actions/artifacts/50')
  })

  it('keeps the actual operator assessment digest immutable outside fictional asset fixtures', async () => {
    const actual = await vi.importActual('../release-artifacts.mjs')
    expect(Object.isFrozen(actual.PROOF_PUBLICATION)).toBe(true)
    expect(actual.PROOF_PUBLICATION.macInstallWitnessSha256).toBe(
      '39ddf8f6048de189438487a9441bd955297cb7d505e9fbda1ea31af8fd8ad8e7',
    )
  })

  for (const reason of [
    'missing witness',
    'changed bytes',
    'changed digest',
    'self-consistent foreign witness',
  ])
    it(`rejects normal-install ${reason} before any release mutation`, async () => {
      const f = publicationFixture(true)
      if (reason === 'missing witness') delete f.selection.macInstallWitness
      else if (reason === 'changed bytes') f.selection.macInstallWitness.json += '\n'
      else if (reason === 'changed digest') f.selection.macInstallWitness.sha256 = '0'.repeat(64)
      else {
        f.selection.macInstallWitness.json = JSON.stringify({ source: 'foreign' })
        f.selection.macInstallWitness.sha256 = createHash('sha256')
          .update(f.selection.macInstallWitness.json)
          .digest('hex')
      }
      await expect(f.publish()).rejects.toThrow(
        'The pinned Mac normal-install operator assessment is required',
      )
      expect(f.state.calls).toEqual([])
    })

  for (const field of [
    'format',
    'repository',
    'source',
    'tree',
    'version',
    'candidateRunId',
    'candidateRunAttempt',
    'macArtifactId',
    'dmg',
  ])
    it(`rejects normal-install assessment ${field} mismatch before any release mutation`, async () => {
      const f = publicationFixture(true)
      const assessment = JSON.parse(f.selection.macInstallWitness.json)
      assessment[field] =
        field === 'dmg' ? { ...assessment.dmg, sha256: '0'.repeat(64) } : 'foreign'
      const json = JSON.stringify(assessment)
      const sha256 = createHash('sha256').update(json).digest('hex')
      f.selection.macInstallWitness = { json, sha256 }
      PROOF_PUBLICATION.macInstallWitnessSha256 = sha256
      await expect(f.publish()).rejects.toThrow(
        'Mac normal-install assessment differs from the original candidate',
      )
      expect(f.state.calls).toEqual([])
    })

  for (const reason of ['missing', 'duplicate'])
    it(`rejects ${reason} Windows normal-install proof before any release mutation`, async () => {
      const f = publicationFixture(true)
      if (reason === 'missing') f.selection.proofs.pop()
      else f.selection.proofs.push({ ...f.selection.proofs[0] })
      await expect(f.publish()).rejects.toThrow(
        'Each required native proof must be selected exactly once',
      )
      expect(f.state.calls).toEqual([])
    })

  it('retains the guided Mac proof requirement and origin on the legacy route', async () => {
    const f = publicationFixture()
    f.runs.get(20).head_sha = '0'.repeat(40)
    await expect(f.publish()).rejects.toThrow()
    expect(f.state.calls).toEqual([])
    f.runs.get(20).head_sha = f.selection.source
    f.selection.proofs = f.selection.proofs.filter((one) => one.kind !== 'mac-guided-upgrade')
    await expect(f.publish()).rejects.toThrow(
      'Each required native proof must be selected exactly once',
    )
    expect(f.state.calls).toEqual([])
  })

  it('reads original external Windows proof receipts and native evidence from exact driver subdirectories', async () => {
    const f = publicationFixture(true)
    for (const proof of f.selection.proofs.filter((one) => one.kind.startsWith('windows-'))) {
      const artifactRoot = f.artifactFolders.get(proof.artifactId)
      expect(proof.receiptFile).toBe('driver/native-receipt.json')
      expect(existsSync(join(artifactRoot, 'native-receipt.json'))).toBe(false)
      expect(existsSync(join(artifactRoot, 'driver', 'native-receipt.json'))).toBe(true)
      expect(existsSync(join(artifactRoot, 'driver', 'summary.json'))).toBe(true)
    }
    await expect(f.publish()).resolves.toMatchObject({ publicReadback: true })
  })

  for (const reason of [
    'flat receipt path',
    'different subdirectory',
    'parent traversal alias',
    'backslash path',
    'missing driver with flat fallback',
    'changed driver receipt bytes',
    'changed driver summary',
  ])
    it(`rejects external Windows ${reason} before any release mutation`, async () => {
      const f = publicationFixture(true)
      const proof = f.selection.proofs.find((one) => one.kind === 'windows-clean')
      const artifactRoot = f.artifactFolders.get(proof.artifactId)
      const driver = join(artifactRoot, 'driver')
      if (reason === 'flat receipt path') {
        copyFileSync(join(driver, 'native-receipt.json'), join(artifactRoot, 'native-receipt.json'))
        proof.receiptFile = 'native-receipt.json'
      }
      if (reason === 'different subdirectory') {
        cpSync(driver, join(artifactRoot, 'other'), { recursive: true })
        proof.receiptFile = 'other/native-receipt.json'
      }
      if (reason === 'parent traversal alias')
        proof.receiptFile = 'driver/../driver/native-receipt.json'
      if (reason === 'backslash path') proof.receiptFile = 'driver\\native-receipt.json'
      if (reason === 'missing driver with flat fallback') {
        for (const name of readdirSync(driver))
          copyFileSync(join(driver, name), join(artifactRoot, name))
        rmSync(driver, { recursive: true })
      }
      if (reason === 'changed driver receipt bytes')
        writeFileSync(
          join(driver, 'native-receipt.json'),
          readFileSync(join(driver, 'native-receipt.json'), 'utf8') + '\n',
        )
      if (reason === 'changed driver summary') {
        const file = join(driver, 'summary.json')
        const summary = JSON.parse(readFileSync(file, 'utf8'))
        summary.nativeExecuted = false
        writeFileSync(file, JSON.stringify(summary))
      }
      await expect(f.publish()).rejects.toThrow()
      expect(f.state.calls).toEqual([])
    })

  for (const [external, kind, wrongPath] of [
    [false, 'windows-clean', 'driver/native-receipt.json'],
    [false, 'mac-guided-upgrade', 'summary.json'],
  ])
    it(`keeps ${kind} legacy or Mac receipt paths strict (external=${external})`, async () => {
      const f = publicationFixture(external)
      f.selection.proofs.find((one) => one.kind === kind).receiptFile = wrongPath
      await expect(f.publish()).rejects.toThrow('The original native proof receipt is required')
      expect(f.state.calls).toEqual([])
    })

  it('does not accept an external selection through the stable-tag execution route', async () => {
    const f = publicationFixture()
    f.selection.format = 2
    await expect(f.publish()).rejects.toThrow('External selection cannot change publication routes')
    expect(f.state.calls).toEqual([])
  })
})

describe('release artifact selection', () => {
  it('cannot publish a proof-only newer version or publish from a candidate/branch ref', async () => {
    const client = { run: vi.fn(), api: vi.fn() }
    for (const ref of ['refs/tags/v0.2.12', 'refs/tags/v0.2.13-candidate.1', 'refs/heads/main']) {
      await expect(
        publishSelection({ version: '0.2.13' }, client, folder(), ref, 'a'.repeat(64)),
      ).rejects.toThrow()
    }
    expect(client.run).not.toHaveBeenCalled()
    expect(client.api).not.toHaveBeenCalled()
  })
  it('builds final-version bytes only on candidate pushes; stable pushes and publication dispatches cannot build', () => {
    expect(releasePlan('refs/tags/v0.2.12-candidate.1', 'push')).toMatchObject({
      version: '0.2.12',
      build: true,
      publish: false,
    })
    expect(releasePlan('refs/tags/v0.2.12', 'push')).toMatchObject({ build: false, publish: false })
    expect(releasePlan('refs/tags/v0.2.12', 'workflow_dispatch', 'publish')).toMatchObject({
      build: false,
      publish: true,
    })
    for (const [ref, mode] of [
      ['refs/heads/main', 'publish'],
      ['refs/tags/v0.2.12-candidate.1', 'publish'],
      ['refs/tags/v0.2.12', 'qualify'],
    ])
      expect(() => releasePlan(ref, 'workflow_dispatch', mode)).toThrow()
  })
  it('accepts exactly the eight sealed assets and complete updater references', () => {
    const { path, manifest } = fixture()
    expect(verifyAssets(path, manifest)).toBe(manifest)
  })
  for (const failure of [
    'missing',
    'tampered',
    'extra',
    'duplicate',
    'wrong-version',
    'wrong-reference',
    'stale-dmg-hash',
  ]) {
    it(`refuses ${failure} before publication`, () => {
      const { path, manifest } = fixture()
      const zip = join(path, 'BroCrew-0.2.12-arm64-mac.zip')
      if (failure === 'missing') rmSync(zip)
      if (failure === 'tampered') writeFileSync(zip, 'a substituted build')
      if (failure === 'extra')
        writeFileSync(join(path, 'BroCrew-0.2.13-arm64.dmg'), 'proof-only artifact')
      if (failure === 'duplicate') manifest.assets[0] = manifest.assets[1]
      if (failure === 'wrong-version') manifest.version = '0.2.13'
      if (failure === 'wrong-reference' || failure === 'stale-dmg-hash') {
        const metadata = join(path, 'latest-mac.yml')
        writeFileSync(
          metadata,
          readFileSync(metadata, 'utf8').replace(
            failure === 'wrong-reference' ? 'BroCrew-0.2.12-arm64-mac.zip' : 'sha512:',
            failure === 'wrong-reference' ? '../substitute.zip' : 'sha512: stale',
          ),
        )
        Object.assign(
          manifest.assets.find((row) => row.name === 'latest-mac.yml'),
          fileSeal(metadata),
        )
      }
      expect(() => verifyAssets(path, manifest)).toThrow()
    })
  }
  it('rejects wrong artifact origin, expired artifacts and unsuccessful proof attempts', () => {
    vi.stubEnv('GITHUB_REPOSITORY', 'brocrew/brocrew')
    const source = 'a'.repeat(40),
      digest = 'sha256:' + 'b'.repeat(64)
    const artifact = { id: 123, expired: false, digest, workflow_run: { id: 12, head_sha: source } }
    const native = {
      id: 12,
      run_attempt: 1,
      head_sha: source,
      path: '.github/workflows/release.yml',
      status: 'completed',
      conclusion: 'success',
      repository: { full_name: 'brocrew/brocrew' },
    }
    const client = { api: (path) => (path.includes('artifacts') ? artifact : native) }
    expect(checkedArtifact(client, { artifactId: 123, digest }, 12, source)).toBe(artifact)
    expect(checkedRun(client, 12, 1, source, 'release.yml')).toBe(native)
    artifact.expired = true
    expect(() => checkedArtifact(client, { artifactId: 123, digest }, 12, source)).toThrow()
    artifact.expired = false
    artifact.workflow_run.head_sha = 'c'.repeat(40)
    expect(() => checkedArtifact(client, { artifactId: 123, digest }, 12, source)).toThrow()
    native.conclusion = 'failure'
    expect(() => checkedRun(client, 12, 1, source, 'release.yml')).toThrow()
  })
  it('requires stable and candidate annotated tags to retain the tested SHA and canonical tagger', () => {
    const source = 'a'.repeat(40),
      tag = 'b'.repeat(40)
    const object = {
      object: { type: 'commit', sha: source },
      tagger: { name: 'BroCrew', email: '343827643+brocrew@users.noreply.github.com' },
    }
    const client = {
      api: (path) => (path.includes('/ref/') ? { object: { type: 'tag', sha: tag } } : object),
    }
    expect(checkedTag(client, 'v0.2.12', source)).toBe(tag)
    object.object.sha = 'c'.repeat(40)
    expect(() => checkedTag(client, 'v0.2.12', source)).toThrow()
    object.object.sha = source
    object.tagger.name = 'A different tagger'
    expect(() => checkedTag(client, 'v0.2.12', source)).toThrow()
  })
})
