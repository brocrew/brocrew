import { execFileSync } from 'node:child_process'
import {
  cpSync,
  copyFileSync,
  existsSync,
  mkdirSync,
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
import * as releaseProofs from '../lib/release-proofs.mjs'
import { windowsProofFixture } from './fixtures/release-proof.mjs'
import { macProofFixture } from './fixtures/release-mac-proof.mjs'

import { FICTIONAL_SIGNING_ENV } from './fixtures/mac-signing-identity.mjs'

vi.mock('node:child_process', () => ({ execFileSync: vi.fn() }))
vi.mock('../release-artifacts.mjs', async (importOriginal) => {
  const actual = await importOriginal()
  return { ...actual, PROOF_PUBLICATION: { ...actual.PROOF_PUBLICATION } }
})
const PROOF_PUBLICATION = releaseArtifacts.PROOF_PUBLICATION ?? {
  repository: 'brocrew/brocrew',
  source: '90c4db564be21eb4fa22b7fba95c5d861ac95b29',
  tree: 'cf373e75a8fb2336fd92799fb003270257bb6c38',
  executionTag: 'v0.2.12-proof-carrier.2',
}

const actualMacWitnessSha256 = PROOF_PUBLICATION.macInstallWitnessSha256
const roots = []
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
  vi.restoreAllMocks()
  vi.unstubAllEnvs()
  PROOF_PUBLICATION.macInstallWitnessSha256 = actualMacWitnessSha256
})

function publicationFixture(external = false) {
  for (const [name, value] of Object.entries(FICTIONAL_SIGNING_ENV)) vi.stubEnv(name, value)
  vi.stubEnv('GITHUB_REPOSITORY', 'brocrew/brocrew')
  const root = folder(),
    { path, manifest } = fixture()
  const source = external ? PROOF_PUBLICATION.source : 'a'.repeat(40),
    tree = external ? PROOF_PUBLICATION.tree : 'b'.repeat(40),
    tagObject = external ? PROOF_PUBLICATION.candidateTagObject : 'c'.repeat(40)
  const buildRun = external ? PROOF_PUBLICATION.runId : 11
  const candidateArtifact = external ? PROOF_PUBLICATION.artifactId : 40
  const macArtifact = external ? 13626141790 : 41
  const windowsArtifact = external ? 13626011874 : 42
  const execution = {
    source: 'e'.repeat(40),
    tree: 'f'.repeat(40),
    tag: PROOF_PUBLICATION.executionTag,
    tagObject: 'd'.repeat(40),
  }
  if (external) {
    vi.stubEnv('GITHUB_REF', `refs/tags/${execution.tag}`)
    vi.stubEnv('GITHUB_SHA', execution.source)
    vi.stubEnv('GITHUB_EVENT_NAME', 'workflow_dispatch')
  }
  const digest = 'sha256:' + 'd'.repeat(64)
  Object.assign(manifest, {
    repository: 'brocrew/brocrew',
    source,
    tree,
    candidateTag: external ? PROOF_PUBLICATION.candidateTag : 'v0.2.12-candidate.1',
    candidateTagObject: tagObject,
    runId: buildRun,
    runAttempt: 1,
    macSigned: true,
    windowsSigned: true,
    origins: {
      macos: { artifactId: macArtifact, digest },
      windows: { artifactId: windowsArtifact, digest },
    },
  })
  const bundle = join(root, 'bundle')
  mkdirSync(bundle)
  cpSync(path, join(bundle, 'assets'), { recursive: true })
  writeFileSync(join(bundle, 'build-manifest.json'), JSON.stringify(manifest))
  const artifactFolders = new Map([[candidateArtifact, bundle]])
  const artifacts = new Map(),
    runs = new Map()
  const add = (id, runId, head, name, workflow, times = {}) => {
    artifacts.set(id, {
      id,
      name,
      digest,
      expired: false,
      workflow_run: { id: runId, head_sha: head },
    })
    runs.set(runId, {
      id: runId,
      run_attempt: 1,
      head_sha: head,
      repository: { full_name: 'brocrew/brocrew' },
      status: 'completed',
      conclusion: 'success',
      path: `.github/workflows/${workflow}`,
      event: runId === buildRun ? 'push' : 'workflow_dispatch',
      head_branch: manifest.candidateTag,
      workflow_id:
        workflow === 'upgrade-path.yml'
          ? 387765924
          : external && workflow === 'mac-signed-upgrade.yml'
            ? 410964307
            : 1,
      ...times,
    })
  }
  add(candidateArtifact, buildRun, source, 'candidate-release-1', 'release.yml')
  add(macArtifact, buildRun, source, 'release-macos', 'release.yml')
  add(windowsArtifact, buildRun, source, 'release-windows', 'release.yml')
  if (external) artifacts.get(candidateArtifact).digest = PROOF_PUBLICATION.digest
  const proofKinds = ['mac-guided-upgrade', 'windows-clean', 'windows-upgrade']
  const proofs = proofKinds
    .filter((kind) => !external || kind.startsWith('windows-'))
    .map((kind) => {
      const i = proofKinds.indexOf(kind)
      const artifactId = 50 + i,
        runId = 20 + i
      const proofFolder = join(root, kind)
      const mac = i === 0
      add(
        artifactId,
        runId,
        mac
          ? external
            ? releaseProofs.MAC_ARTIFACT_SOURCE
            : source
          : external
            ? releaseProofs.WINDOWS_CURRENT_SOURCE
            : WINDOWS_PROOF_SOURCE,
        mac ? 'actual-signed-mac-upgrade-evidence' : 'windows-installed-plugin-upgrade-evidence',
        mac ? 'mac-signed-upgrade.yml' : 'upgrade-path.yml',
        {
          run_started_at: i === 2 ? '2026-11-08T01:00:00Z' : '2026-11-08T00:00:00Z',
          updated_at: i === 2 ? '2026-11-08T01:30:00Z' : '2026-11-08T00:30:00Z',
        },
      )
      let proof = { kind, artifactId, runId, runAttempt: 1, digest }
      if (mac) {
        proof.receiptFile = 'signed-upgrade-evidence/summary.json'
        macProofFixture(join(proofFolder, 'signed-upgrade-evidence'), manifest, proof, external)
      } else
        proof = {
          ...proof,
          ...windowsProofFixture(proofFolder, manifest, kind, external, {
            chrome: '0.1.11',
            whatsapp: i === 2 ? '0.1.5' : '0.1.4',
          }),
        }
      proof.receiptSha256 = fileSeal(join(proofFolder, proof.receiptFile)).sha256
      artifactFolders.set(artifactId, proofFolder)
      return proof
    })
  let macInstallWitness
  if (external) {
    const dmg = manifest.assets.find((row) => row.name === 'BroCrew-0.2.12-arm64.dmg')
    const json =
      JSON.stringify({
        format: 'brocrew.mac-normal-install-operator-witness.v1',
        repository: manifest.repository,
        source,
        tree,
        version: manifest.version,
        candidateRunId: buildRun,
        candidateRunAttempt: 1,
        macArtifactId: macArtifact,
        dmg: { name: dmg.name, bytes: dmg.bytes, sha256: dmg.sha256 },
      }) + '\n'
    macInstallWitness = { json, sha256: createHash('sha256').update(json).digest('hex') }
    PROOF_PUBLICATION.macInstallWitnessSha256 = macInstallWitness.sha256
  }
  const notes = 'Mac releases are signed and notarized'
  const selection = {
    format: external ? 2 : 1,
    ...(external ? { execution, macInstallWitness } : {}),
    repository: manifest.repository,
    source,
    tree,
    version: manifest.version,
    candidate: {
      runId: buildRun,
      runAttempt: 1,
      artifactId: candidateArtifact,
      digest: external ? PROOF_PUBLICATION.digest : digest,
      manifestSha256: external
        ? PROOF_PUBLICATION.manifestSha256
        : fileSeal(join(bundle, 'build-manifest.json')).sha256,
    },
    proofs,
    notes,
    notesSha256: createHash('sha256').update(notes).digest('hex'),
  }
  const selectionHash = createHash('sha256').update(JSON.stringify(selection)).digest('hex')
  const body = `${notes}\n\n<!-- tested-selection-sha256:${selectionHash} -->\n`
  const state = {
    release: null,
    calls: [],
    attestations: [],
    downloads: [],
    corruptReadback: false,
    movedTag: false,
    movedCarrier: false,
    movedStableTag: false,
  }
  const asset = (name) => {
    const row = manifest.assets.find((row) => row.name === name)
    return { name, size: row.bytes, digest: `sha256:${row.sha256}` }
  }
  const client = {
    source: vi.fn((sha, shaTree) => {
      expect([sha, shaTree]).toEqual([source, tree])
      return external ? execution : null
    }),
    api(endpoint) {
      if (endpoint.startsWith('actions/runs/')) return runs.get(Number(endpoint.split('/')[2]))
      if (endpoint.startsWith('actions/artifacts/'))
        return artifacts.get(Number(endpoint.split('/')[2]))
      if (endpoint.startsWith('git/commits/')) {
        const sha = endpoint.split('/').at(-1)
        return {
          sha,
          tree: {
            sha:
              sha === releaseProofs.MAC_ARTIFACT_SOURCE
                ? releaseProofs.MAC_ARTIFACT_TREE
                : releaseProofs.WINDOWS_CURRENT_TREE,
          },
        }
      }
      if (external && endpoint === `git/ref/tags/${execution.tag}`)
        return { object: { type: 'tag', sha: execution.tagObject } }
      if (external && endpoint === `git/tags/${execution.tagObject}`)
        return {
          object: { type: 'commit', sha: state.movedCarrier ? '0'.repeat(40) : execution.source },
          tagger: { name: 'BroCrew', email: '343827643+brocrew@users.noreply.github.com' },
        }
      if (external && endpoint === 'git/ref/tags/v0.2.12')
        return {
          object: {
            type: 'tag',
            sha: state.movedStableTag ? '0'.repeat(40) : PROOF_PUBLICATION.stableTagObject,
          },
        }
      if (endpoint.startsWith('git/ref/'))
        return { object: { type: 'tag', sha: state.movedTag ? 'e'.repeat(40) : tagObject } }
      if (endpoint.startsWith('git/tags/'))
        return {
          object: { type: 'commit', sha: source },
          tagger: { name: 'BroCrew', email: '343827643+brocrew@users.noreply.github.com' },
        }
      if (endpoint === 'releases/tags/v0.2.12') return structuredClone(state.release)
      throw new Error(`Unexpected mock endpoint ${endpoint}`)
    },
    download: vi.fn(async (id, dest, pin) => {
      expect(pin).toBe(artifacts.get(id).digest)
      cpSync(artifactFolders.get(id), dest, { recursive: true })
    }),
    attest: vi.fn((file, sha, ref, id, attempt) => {
      expect([sha, ref, id, attempt]).toEqual([source, manifest.candidateTag, buildRun, 1])
      state.attestations.push(file)
    }),
    run(args) {
      state.calls.push(args)
      const command = args[1]
      if (command === 'create')
        state.release = {
          id: 99,
          tag_name: 'v0.2.12',
          body,
          draft: true,
          prerelease: false,
          assets: [],
        }
      else if (command === 'upload')
        for (const file of args.slice(3, args.indexOf('--repo')))
          state.release.assets.push(asset(basename(file)))
      else if (command === 'download') {
        const name = args[args.indexOf('--pattern') + 1],
          dest = args[args.indexOf('--dir') + 1]
        state.downloads.push({ name, dest })
        copyFileSync(join(path, name), join(dest, name))
        if (state.corruptReadback && dest.endsWith('public-readback'))
          writeFileSync(join(dest, name), 'changed by transport')
      } else if (command === 'edit') state.release.draft = false
      else throw new Error(`Unexpected mock mutation ${command}`)
    },
  }
  if (external) {
    const originalSeal = releaseArtifacts.fileSeal
    vi.spyOn(releaseArtifacts, 'fileSeal').mockImplementation((path) => {
      const seal = originalSeal(path)
      return basename(path) === 'build-manifest.json'
        ? { ...seal, sha256: PROOF_PUBLICATION.manifestSha256 }
        : seal
    })
  }
  return {
    root,
    manifest,
    selection,
    selectionHash,
    client,
    state,
    artifacts,
    runs,
    asset,
    body,
    artifactFolders,
    publish: () =>
      publishSelection(
        selection,
        client,
        join(folder(), 'candidate'),
        external ? `refs/tags/${execution.tag}` : 'refs/tags/v0.2.12',
        selectionHash,
      ),
  }
}

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
    expect(
      f.state.calls.map((args) => args[1]).filter((command) => command !== 'download'),
    ).toEqual(['create', 'upload', 'edit'])
    expect(f.state.calls.flat()).not.toContain('--clobber')
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
      const uploads = f.state.calls.filter((args) => args[1] === 'upload')
      expect(uploads).toHaveLength(draft ? 1 : 0)
      if (draft) expect(uploads[0].slice(3, uploads[0].indexOf('--repo'))).toHaveLength(5)
      expect(f.state.calls.some((args) => args[1] === 'create')).toBe(false)
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
      expect(f.state.calls.some((args) => ['upload', 'edit', 'create'].includes(args[1]))).toBe(
        false,
      )
    })
  it('reports altered public bytes after publication without rewriting or deleting the release', async () => {
    const f = publicationFixture()
    f.state.corruptReadback = true
    await expect(f.publish()).rejects.toThrow('Uploaded release bytes differ')
    expect(f.state.release.draft).toBe(false)
    expect(f.state.calls.filter((args) => args[1] === 'upload')).toHaveLength(1)
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
    const ref = 'refs/tags/v0.2.12-proof-carrier.2'
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
      'refs/tags/v0.2.12-proof-carrier.3',
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
