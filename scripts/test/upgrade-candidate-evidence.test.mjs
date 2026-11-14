import { createHash } from 'node:crypto'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { firstCopyPolicy, releaseAssetInventory } from '../lib/upgrade-candidate-evidence.mjs'
import {
  CHECKPOINT_LINE,
  READY_LINE,
  sha256,
  startOrder,
  verifyCheckpoint,
} from '../lib/upgrade-path.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const copy = (value) => structuredClone(value)
const firstStart = (log, extra = {}) => startOrder(log, { checkpoint: true, ...extra })

describe('the candidate’s first recovery copy', () => {
  const database = Buffer.from('the beta database')
  const drafts = Buffer.from('{"version":1,"drafts":[]}')
  const lineage = [{ createdAt: 1, hash: 'h1' }]
  const id = '1b4e28ba-2fa1-41d2-883f-0016d3cca427'
  const workspaceId = '9a8b7c6d-1e2f-4a3b-8c4d-5e6f7a8b9c0d'
  const manifest = {
    format: 'brobot-checkpoint',
    version: 1,
    id,
    workspaceId,
    createdAt: '2026-10-07T12:00:00.000Z',
    reason: 'first-start-of-release',
    madeBy: { appVersion: '0.1.0', build: 'abc' },
    database: {
      file: 'database.sqlite',
      bytes: database.length,
      sha256: sha256(database),
      migrations: lineage,
    },
    files: [
      { name: 'drafts.json', present: true, bytes: drafts.length, sha256: sha256(drafts) },
      { name: 'workspace.json', present: false },
    ],
  }
  const expected = {
    folder: id,
    workspaceId,
    reason: 'first-start-of-release',
    version: '0.1.0',
    build: 'abc',
    lineage,
    stateFiles: ['drafts.json', 'workspace.json'],
    state: { 'drafts.json': drafts },
  }
  const files = { 'database.sqlite': database, 'drafts.json': drafts }
  const fails = (words, change = {}, shape = (m) => m, onFiles = files) =>
    expect(() =>
      verifyCheckpoint(shape(copy(manifest)), onFiles, { ...expected, ...change }),
    ).toThrow(words)

  const policy = (
    copies,
    applied = lineage,
    built = [...lineage, { createdAt: 2_000_000_000_000, hash: 'h2' }],
  ) => firstCopyPolicy(applied, built, copies, { workspaceId, stateFiles: expected.stateFiles })
  const fallback = () => ({
    folder: id,
    manifest: copy(manifest),
    files: copy(files),
    unfinished: false,
  })

  it('requires completion before READY for every pending migration', () => {
    expect(policy([]).completion).toBe('before-ready')
    const selected = policy([fallback()])
    expect(selected.fallbacks).toEqual([id])
    expect(selected.rollbackLineage).toEqual(lineage)
    expect(selected.completion).toBe('before-ready')
    const log = `${READY_LINE}\n${CHECKPOINT_LINE}`
    const observation = {
      launched: 10,
      responsive: 20,
      absent: 21,
      completed: 50,
      manifestAbsent: true,
    }
    expect(() => firstStart(log, { completion: selected.completion, observation })).toThrow('before READY')
    expect(() => firstStart(log, { completion: policy([]).completion, observation })).toThrow(
      'before READY',
    )
    expect(() => firstStart(log, { completion: selected.completion })).toThrow(
      'before READY',
    )
    expect(policy([], lineage, lineage).completion).toBe('not-needed')
  })

  it('rejects incomplete, foreign-workspace, incompatible and unregistered fallbacks', () => {
    for (const change of [
      { unfinished: true },
      { manifest: null },
      { manifest: { ...manifest, workspaceId: '0a0b0c0d-1e2f-4a3b-8c4d-5e6f7a8b9c0d' } },
      {
        manifest: {
          ...manifest,
          database: { ...manifest.database, migrations: [{ createdAt: 1, hash: 'other' }] },
        },
      },
      {
        manifest: {
          ...manifest,
          files: [...manifest.files, { name: 'unknown.json', present: false }],
        },
      },
    ]) {
      expect(policy([{ ...fallback(), ...change }]).completion).toBe('before-ready')
    }
  })

  it('reports failed copy proof rather than inventing a missing fallback after hash corruption', () => {
    const corrupt = fallback()
    corrupt.files['database.sqlite'] = Buffer.from('the beta databasE')
    expect(() => policy([corrupt])).toThrow('not the one its manifest describes')
    const missing = fallback()
    delete missing.files['database.sqlite']
    expect(() => policy([missing])).toThrow('not the one its manifest describes')
  })

  it('uses the legacy rollback target for old prefixes and the applied target for newer prefixes', () => {
    const legacy = [...lineage, { createdAt: 2, hash: 'legacy' }]
    const built = [
      ...legacy,
      { createdAt: 2_000_000_000_000, hash: 'new' },
      { createdAt: 2_000_000_000_001, hash: 'next' },
    ]
    expect(policy([], lineage, built).rollbackLineage).toEqual(legacy)
    expect(policy([], built.slice(0, 3), built).rollbackLineage).toEqual(built.slice(0, 3))
  })

  it('is the candidate’s, for this workspace and this start, of exactly what the beta left', () => {
    expect(verifyCheckpoint(manifest, files, expected)).toEqual({
      id,
      workspaceId,
      reason: 'first-start-of-release',
      madeBy: { appVersion: '0.1.0', build: 'abc' },
    })
  })

  it('fails a copy for no workspace, for another one, or kept in a folder of another name', () => {
    fails('not this one', {}, (m) => ({ ...m, workspaceId: undefined }))
    fails('not this one', { workspaceId: '0a0b0c0d-1e2f-4a3b-8c4d-5e6f7a8b9c0d' })
    fails('not this one', { workspaceId: null })
    fails('says it is', { folder: '2c5e28ba-2fa1-41d2-883f-0016d3cca427' })
  })

  it('fails another maker, another reason and another lineage', () => {
    fails('not the candidate', { version: '0.0.0' })
    fails('not the candidate', { build: 'other' })
    fails('not before-migration', { reason: 'before-migration' })
    fails('lineage', { lineage: [{ createdAt: 1, hash: 'h2' }] })
  })

  it('fails a changed database, a changed draft, a missing entry and a file listed absent', () => {
    fails('is not the one its manifest describes', {}, (m) => m, {
      ...files,
      'database.sqlite': Buffer.from('the beta databasE'),
    })
    fails('changed drafts.json', { state: { 'drafts.json': Buffer.from('other') } })
    fails('registry is', {}, (m) => ({ ...m, files: m.files.slice(0, 1) }))
    fails('listed absent', {}, (m) => m, { ...files, 'workspace.json': Buffer.from('{}') })
    fails('the beta left it present', {
      state: { 'drafts.json': drafts, 'workspace.json': drafts },
    })
  })
})

describe('the original signed release file inventory', () => {
  it.each(['windows', 'mac'])('retains %s identities and failure receipts', (os) => {
    const folder = mkdtempSync(join(tmpdir(), 'reused-upgrade-assets-'))
    const names =
      os === 'windows'
        ? ['BroCrew-Setup-0.2.24-x64.exe']
        : ['BroCrew-0.2.24-arm64-mac.zip', 'BroCrew-0.2.24-arm64.dmg']
    const [installer] = names
    const bytes = Buffer.from('the original signed installer')
    const sha512 = createHash('sha512').update(bytes).digest('base64')
    const feedName = os === 'windows' ? 'latest.yml' : 'latest-mac.yml'
    const entries = names
      .map((name) => `  - url: ${name}\n    sha512: ${sha512}\n    size: ${bytes.length}`)
      .join('\n')
    const feed = `version: 0.2.24\nfiles:\n${entries}\npath: ${installer}\nsha512: ${sha512}\n`
    try {
      for (const name of names) {
        writeFileSync(join(folder, name), bytes)
        writeFileSync(join(folder, `${name}.blockmap`), 'original blockmap')
      }
      writeFileSync(join(folder, feedName), feed)
      const inventory = releaseAssetInventory(folder, '0.2.24', os)
      expect(inventory).toHaveLength(1 + names.length * 2)
      expect(inventory.find(({ name }) => name === installer)).toEqual({
        name: installer,
        bytes: bytes.length,
        sha256: sha256(bytes),
        sha512,
      })
      expect(() => releaseAssetInventory(folder, '0.2.25', os)).toThrow('candidate version')
      writeFileSync(join(folder, installer), 'changed installer')
      let retained = null
      expect(() =>
        releaseAssetInventory(folder, '0.2.24', os, (files) => {
          retained = files
        }),
      ).toThrow('feed size and SHA512')
      expect(retained.find(({ name }) => name === installer).sha256).toBe(
        sha256('changed installer'),
      )
      writeFileSync(join(folder, installer), bytes)
      writeFileSync(join(folder, 'unexpected.exe'), 'not an original file')
      expect(() => releaseAssetInventory(folder, '0.2.24', os)).toThrow('exactly its feed')
    } finally {
      rmSync(folder, { recursive: true, force: true })
    }
  })
})

describe('the existing workflow’s same-artifact route', () => {
  const appRequire = createRequire(new URL('../../apps/desktop/package.json', import.meta.url))
  const builderRequire = createRequire(appRequire.resolve('electron-builder/package.json'))
  const libRequire = createRequire(builderRequire.resolve('app-builder-lib/package.json'))
  const { load } = libRequire('js-yaml')
  const workflow = load(readFileSync(join(ROOT, '.github/workflows/upgrade-path.yml'), 'utf8'))
  const script = workflow.jobs.assets.steps[0].with.script
  const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor
  const source = 'a'.repeat(40)
  const predecessor = 'b'.repeat(40)
  const harness = 'c'.repeat(40)
  const env = {
    ORIGINAL_RUN: '100',
    WINDOWS_ARTIFACT: '101',
    MAC_ARTIFACT: '102',
    CANDIDATE_SOURCE: source,
    PREDECESSOR_SOURCE: predecessor,
    CANDIDATE_VERSION: '0.2.24',
    WINDOWS_BETA: 'v0.2.23',
    MAC_BETA: 'v0.2.23',
    RECOVERY_MODE: 'false',
  }
  async function bind({
    changed = {},
    original = {},
    artifact = {},
    old = predecessor,
    eventName = 'workflow_dispatch',
  } = {}) {
    let binding = null
    const github = {
      rest: {
        actions: {
          getWorkflowRun: async () => ({
            data: { head_sha: source, head_branch: 'v0.2.24', ...original },
          }),
          getArtifact: async ({ artifact_id }) => ({
            data: {
              id: artifact_id,
              name: artifact_id === 101 ? 'release-windows-1' : 'release-macos-1',
              expired: false,
              workflow_run: { id: 100, head_sha: source },
              ...artifact,
            },
          }),
        },
        repos: {
          getCommit: async () => ({ data: { sha: old } }),
          getReleaseByTag: async ({ tag }) => ({ data: { draft: false, tag_name: tag } }),
        },
      },
    }
    await new AsyncFunction('github', 'core', 'context', 'process', script)(
      github,
      {
        info() {},
        setOutput(name, value) {
          binding = { name, value: JSON.parse(value) }
        },
      },
      { sha: harness, repo: { owner: 'brocrew', repo: 'brocrew' }, eventName },
      { env: { ...env, ...changed } },
    )
    return binding
  }

  it('binds both original artifacts and predecessor independently of the harness head', async () => {
    const binding = await bind()
    expect(binding.name).toBe('binding')
    expect(binding.value).toMatchObject({
      harnessSource: harness,
      candidateSource: source,
      predecessorSource: predecessor,
    })
    expect(binding.value.artifacts.map(({ id }) => id)).toEqual([101, 102])
    for (const os of ['windows', 'mac']) {
      const steps = workflow.jobs[os].steps
      const download = steps.find((step) => step.uses === 'actions/download-artifact@v4')
      expect(download.with['run-id']).toContain('inputs.original_run_id')
      expect(download.with['github-token']).toBe('${{ github.token }}')
      expect(steps.find((step) => step.name?.startsWith('Build the candidate')).if).toContain(
        os === 'windows' ? '!inputs.windows_artifact_id' : '!inputs.original_run_id',
      )
    }
    expect(
      workflow.jobs.mac.steps.find((step) => step.name?.startsWith('Upgrade three workspaces')).run,
    ).toContain('--candidate-source "$CANDIDATE_SOURCE"')
  })

  it('selects Mac only explicitly while defaults and the reusable Windows caller keep their jobs', () => {
    expect(workflow.on.workflow_dispatch.inputs.mac_only).toMatchObject({
      type: 'boolean',
      default: false,
    })
    expect(workflow.on.workflow_call.inputs.mac_only).toBeUndefined()
    const selected = (job, inputs) =>
      Boolean(
        new Function('github', 'inputs', `return (${workflow.jobs[job].if})`)(
          { repository: 'brocrew/brocrew' },
          inputs,
        ),
      )
    const reuse = { original_run_id: '100', windows_artifact_id: '101' }
    for (const inputs of [{}, { mac_only: false }, reuse]) {
      expect(selected('windows', inputs)).toBe(true)
      expect(selected('mac', inputs)).toBe(true)
    }
    expect(selected('windows', { ...reuse, mac_only: true })).toBe(false)
    expect(selected('mac', { ...reuse, mac_only: true })).toBe(true)
    expect(selected('windows', { windows_artifact_id: '101' })).toBe(true)
    expect(selected('mac', { windows_artifact_id: '101' })).toBe(false)
  })

  it('refuses partial reuse, another run/source/version, mismatched predecessors and expired outputs', async () => {
    for (const change of [
      { changed: { ORIGINAL_RUN: '' } },
      { changed: { MAC_ARTIFACT: '' } },
      { changed: { CANDIDATE_SOURCE: 'short' } },
      { changed: { RECOVERY_MODE: 'true' } },
      { original: { head_sha: harness } },
      { original: { head_branch: 'v0.2.25' } },
      { artifact: { workflow_run: { id: 99, head_sha: source } } },
      { artifact: { name: 'an unrelated artifact' } },
      { artifact: { expired: true } },
      { old: harness },
    ])
      await expect(bind(change)).rejects.toThrow()
  })

  it('retains the original reusable same-run Windows caller and ordinary build mode', async () => {
    const cleared = {
      ORIGINAL_RUN: '',
      MAC_ARTIFACT: '',
      CANDIDATE_SOURCE: '',
      PREDECESSOR_SOURCE: '',
    }
    expect(await bind({ eventName: 'push', changed: cleared })).toBeNull()
    expect(await bind({ changed: { ...cleared, WINDOWS_ARTIFACT: '' } })).toBeNull()
  })
})
