import {
  cpSync,
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { createHash } from 'node:crypto'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { assetNames, fileSeal, releasePlan, verifyAssets } from '../release-artifacts.mjs'
import { checkedArtifact, checkedRun, checkedTag } from '../lib/release-github.mjs'
import { publishSelection } from '../release-selection.mjs'
import { WINDOWS_PROOF_SOURCE } from '../lib/release-proofs.mjs'
import { windowsProofFixture } from './fixtures/release-proof.mjs'
import { macProofFixture } from './fixtures/release-mac-proof.mjs'

import { FICTIONAL_SIGNING_ENV } from './fixtures/mac-signing-identity.mjs'

const roots = []
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
  vi.unstubAllEnvs()
})

function publicationFixture() {
  for (const [name, value] of Object.entries(FICTIONAL_SIGNING_ENV)) vi.stubEnv(name, value)
  vi.stubEnv('GITHUB_REPOSITORY', 'brocrew/brocrew')
  const root = folder(),
    { path, manifest } = fixture()
  const source = 'a'.repeat(40),
    tree = 'b'.repeat(40),
    tagObject = 'c'.repeat(40)
  const digest = 'sha256:' + 'd'.repeat(64)
  Object.assign(manifest, {
    repository: 'brocrew/brocrew',
    source,
    tree,
    candidateTag: 'v0.2.12-candidate.1',
    candidateTagObject: tagObject,
    runId: 11,
    runAttempt: 1,
    macSigned: true,
    windowsSigned: true,
    origins: { macos: { artifactId: 41, digest }, windows: { artifactId: 42, digest } },
  })
  const bundle = join(root, 'bundle')
  mkdirSync(bundle)
  cpSync(path, join(bundle, 'assets'), { recursive: true })
  writeFileSync(join(bundle, 'build-manifest.json'), JSON.stringify(manifest))
  const artifactFolders = new Map([[40, bundle]])
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
      event: runId === 11 ? 'push' : 'workflow_dispatch',
      head_branch: manifest.candidateTag,
      workflow_id: workflow === 'upgrade-path.yml' ? 387765924 : 1,
      ...times,
    })
  }
  add(40, 11, source, 'candidate-release-1', 'release.yml')
  add(41, 11, source, 'release-macos', 'release.yml')
  add(42, 11, source, 'release-windows', 'release.yml')
  const proofs = ['mac-guided-upgrade', 'windows-clean', 'windows-upgrade'].map((kind, i) => {
    const artifactId = 50 + i,
      runId = 20 + i
    const proofFolder = join(root, kind)
    const mac = i === 0
    add(
      artifactId,
      runId,
      mac ? source : WINDOWS_PROOF_SOURCE,
      mac ? 'actual-signed-mac-upgrade-evidence' : 'windows-installed-plugin-upgrade-evidence',
      mac ? 'mac-signed-upgrade.yml' : 'upgrade-path.yml',
      {
        run_started_at: i === 2 ? '2026-11-08T01:00:00Z' : '2026-11-08T00:00:00Z',
        updated_at: '2026-11-08T00:30:00Z',
      },
    )
    let proof = { kind, artifactId, runId, runAttempt: 1, digest }
    if (mac) {
      proof.receiptFile = 'signed-upgrade-evidence/summary.json'
      macProofFixture(join(proofFolder, 'signed-upgrade-evidence'), manifest, proof)
    } else proof = { ...proof, ...windowsProofFixture(proofFolder, manifest, kind) }
    proof.receiptSha256 = fileSeal(join(proofFolder, proof.receiptFile)).sha256
    artifactFolders.set(artifactId, proofFolder)
    return proof
  })
  const notes = 'Mac releases are signed and notarized'
  const selection = {
    format: 1,
    repository: manifest.repository,
    source,
    tree,
    version: manifest.version,
    candidate: {
      runId: 11,
      runAttempt: 1,
      artifactId: 40,
      digest,
      manifestSha256: fileSeal(join(bundle, 'build-manifest.json')).sha256,
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
  }
  const asset = (name) => {
    const row = manifest.assets.find((row) => row.name === name)
    return { name, size: row.bytes, digest: `sha256:${row.sha256}` }
  }
  const client = {
    source: vi.fn((sha, shaTree) => {
      expect([sha, shaTree]).toEqual([source, tree])
    }),
    api(endpoint) {
      if (endpoint.startsWith('actions/runs/')) return runs.get(Number(endpoint.split('/')[2]))
      if (endpoint.startsWith('actions/artifacts/'))
        return artifacts.get(Number(endpoint.split('/')[2]))
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
      expect([sha, ref, id, attempt]).toEqual([source, manifest.candidateTag, 11, 1])
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
          state.release.assets.push(asset(file.split('/').at(-1)))
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
        'refs/tags/v0.2.12',
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
