import { createHash } from 'node:crypto'
import { cpSync, copyFileSync, mkdirSync, writeFileSync } from 'node:fs'
import { basename, join } from 'node:path'
import { WINDOWS_PROOF_DRIVER, WINDOWS_PROOF_SOURCE } from '../../lib/release-proofs.mjs'
import * as releaseProofs from '../../lib/release-proofs.mjs'
import { expect, vi } from 'vitest'
import { fileSeal } from '../../release-artifacts.mjs'
import * as releaseArtifacts from '../../release-artifacts.mjs'
import { publishSelection } from '../../release-selection.mjs'
import { macProofFixture } from './release-mac-proof.mjs'
import { FICTIONAL_SIGNING_ENV } from './mac-signing-identity.mjs'

// Fictional raw evidence, shaped from the installed-plugin driver's receipt contract.
export function windowsProofFixture(
  folder,
  manifest,
  kind,
  external = false,
  versions = { chrome: '0.1.11', whatsapp: '0.1.4' },
) {
  const proofRoot = external ? join(folder, 'driver') : folder
  mkdirSync(proofRoot, { recursive: true })
  const save = (name, value) =>
    writeFileSync(join(proofRoot, name), JSON.stringify(value, null, 2) + '\n')
  const clean = kind === 'windows-clean'
  const exe = manifest.assets.find((row) => row.name.endsWith('.exe'))
  const candidate = {
    version: manifest.version,
    sourceSha: manifest.source,
    sourceTree: manifest.tree,
    installer: {
      sha256: exe.sha256,
      bytes: exe.bytes,
      buildRunId: String(manifest.runId),
      artifactName: 'release-windows',
      artifactId: String(manifest.origins.windows.artifactId),
    },
  }
  const witness = { passed: true, ownerEpoch: 'fictional-epoch' }
  const cleanup = { forced: false, processes: [], owner: { phase: 'stopped' } }
  const pins = {
    chrome: {
      version: '0.1.9',
      sha256: '9f763685263abfde06f91aa1c26ae93a726a53b568719368650251874c84e57b',
      manifest: '0f13c23a672133fd5f6334230e8c5029f167e57320a6b29bd6a67585b2d8f20a',
    },
    whatsapp: {
      version: '0.1.4',
      sha256: '49497b4c15adffefdbc63f8490da542ebae78016975a72c6b55e4476aa3dc769',
      manifest: 'fe6f04050ac0ec9cc0b577de9d57dc249987d7d3a43cc7e16a9350e68ca83c8d',
    },
  }
  const reference = {
    kind,
    runId: clean ? 21 : 22,
    runAttempt: 1,
    carrierSha: external
      ? (releaseProofs.WINDOWS_CURRENT_SOURCE ?? WINDOWS_PROOF_SOURCE)
      : WINDOWS_PROOF_SOURCE,
    driverSha: external
      ? (releaseProofs.WINDOWS_CURRENT_DRIVER ?? WINDOWS_PROOF_DRIVER)
      : WINDOWS_PROOF_DRIVER,
    receiptFile: external ? 'driver/native-receipt.json' : 'native-receipt.json',
  }
  let publicCatalogue
  const packageFiles = [
    { path: 'server.mjs', type: 'file', sha256: 'f'.repeat(64), size: 12 },
    { path: 'helper.mjs', type: 'file', sha256: 'e'.repeat(64), size: 7 },
  ]
  const installedManifests = {}
  if (external) {
    const hash = (bytes) => createHash('sha256').update(bytes).digest('hex')
    const catalogue = { format: 2, entries: [] }
    const selected = {}
    for (const id of ['chrome', 'whatsapp']) {
      const plugin = {
        id,
        version: versions[id],
        platforms: [{ os: 'win32', cpu: 'x64' }],
        sourceCommit: (id === 'chrome' ? '1' : '2').repeat(40),
        files: packageFiles,
      }
      installedManifests[id] = plugin
      const target = {
        os: 'win32',
        cpu: 'x64',
        compression: 'tar.gz',
        bytes: 100,
        url: `https://github.com/brocrew/brocrew-plugin-${id}/releases/download/v${versions[id]}/${id}-win32-x64.tar.gz`,
        sha256: (id === 'chrome' ? '3' : '4').repeat(64),
        manifestSha256: hash(JSON.stringify(plugin)),
      }
      const entry = {
        id,
        version: plugin.version,
        sourceCommit: plugin.sourceCommit,
        targets: [target],
      }
      catalogue.entries.push(entry)
      selected[id] = {
        entrySha256: hash(JSON.stringify(entry)),
        targetSha256: hash(JSON.stringify(target)),
      }
      pins[id] = {
        version: plugin.version,
        bytes: target.bytes,
        sha256: target.sha256,
        manifest: target.manifestSha256,
        sourceCommit: plugin.sourceCommit,
        repo: `brocrew-plugin-${id}`,
        url: target.url,
      }
    }
    const raw = JSON.stringify(catalogue)
    publicCatalogue = {
      format: 'brocrew.public-plugin-catalogue.v1',
      url: 'https://raw.githubusercontent.com/brocrew/brocrew/main/plugins/catalogue-v2.json',
      sha256: hash(raw),
      bytes: Buffer.byteLength(raw),
      capturedAt: clean ? '2026-11-08T00:01:00.000Z' : '2026-11-08T01:01:00.000Z',
      origin: { runId: String(reference.runId), runAttempt: '1', carrierSha: reference.carrierSha },
      selected,
    }
    writeFileSync(join(proofRoot, 'public-catalogue-v2.json'), raw)
    save('public-catalogue-capture.json', publicCatalogue)
  }
  const phases = Array.from({ length: clean ? 3 : 5 }, (_, i) => ({
    name: `fictional phase ${i}`,
    passed: true,
    started: '2026-11-08T00:00:00Z',
    finished: '2026-11-08T00:00:01Z',
  }))
  const observer = {
    passed: true,
    failures: [],
    nativeWitness: witness,
    ownerEpoch: witness.ownerEpoch,
    cleanup: { routesReleased: true, personDetached: true, leaseClosed: true },
  }
  const service = {
    owner: { epoch: witness.ownerEpoch, phase: 'accepting' },
    service: { pid: 20 },
    entrySha256: 'c'.repeat(64),
    runtimeId: 'd'.repeat(64),
    launchConfigSha256: 'e'.repeat(64),
    runtime: { platform: 'win32', arch: 'x64' },
  }
  const live = [],
    receipts = []
  for (const [id, pin] of Object.entries(pins)) {
    const path = `C:\\fictional\\${id}\\process.json`
    const start = {
      pluginId: id,
      runId: `fictional-${id}`,
      releaseDigest: pin.sha256,
      guardianPid: 30,
      groups: [[31, '1000']],
    }
    receipts.push(
      { path, value: start },
      {
        path: path.replace('process.json', 'exit.json'),
        value: { ...start, exited: true, cause: 'stop' },
      },
    )
    live.push({
      id,
      path,
      receipt: start,
      ownerEpoch: witness.ownerEpoch,
      guardian: { ParentProcessId: 20 },
      groups: [{ pid: 31, birth: '1000' }],
      packageFiles: packageFiles.map(({ path, sha256, size }) => ({ path, sha256, bytes: size })),
    })
    if (external) {
      const bytes = JSON.stringify(installedManifests[id])
      for (const label of ['input', 'candidate-installed']) {
        writeFileSync(join(proofRoot, `${label}-${id}-plugin.json`), bytes)
        save(`${label}-${id}-manifest-extraction.json`, {
          status: 0,
          signal: null,
          stdinBytes: pin.bytes,
          stdinSha256: pin.sha256,
          stdoutBytes: Buffer.byteLength(bytes),
          stdoutSha256: pin.manifest,
        })
      }
      save(`public-${id}-release.json`, {
        draft: false,
        tag_name: `v${pin.version}`,
        assets: [
          {
            name: `${id}-win32-x64.tar.gz`,
            digest: `sha256:${pin.sha256}`,
            size: pin.bytes,
            browser_download_url: pin.url,
          },
        ],
      })
    } else
      save(`candidate-installed-${id}-plugin.json`, {
        files: packageFiles,
      })
  }
  const baseline = clean
    ? null
    : { cause: 'actual fictional baseline outcome', normalShutdown: true }
  const intake = {
    format: 1,
    carrierSha: reference.carrierSha,
    driverSha: reference.driverSha,
    candidate,
    proofStage: 'final-candidate',
  }
  const candidateInstalled = external
    ? {
        activation: {
          entries: Object.entries(pins).map(([id, pin]) => ({
            pluginId: id,
            phase: 'active',
            release: {
              version: pin.version,
              archiveSha256: pin.sha256,
              manifestSha256: pin.manifest,
            },
          })),
        },
        vault: Object.entries(pins).map(([id, pin]) => ({
          id,
          archiveSha256: pin.sha256,
          manifestSha256: pin.manifest,
          bytes: pin.bytes,
        })),
      }
    : null
  if (external) save('candidate-installed-state.json', candidateInstalled)
  const summary = {
    ...(external
      ? {
          publicCatalogue,
          candidateInstalled,
          started: clean ? '2026-11-08T00:02:00Z' : '2026-11-08T01:02:00Z',
        }
      : {}),
    passed: true,
    nativeExecuted: true,
    failures: [],
    transport: 'public delivery',
    intake,
    phases,
    candidateService: service,
    liveHosts: live,
    expected: pins,
    cleanup,
  }
  const native = {
    format: 'brocrew.windows-installed-plugin-proof.v1',
    carrierSha: reference.carrierSha,
    driverSha: reference.driverSha,
    candidate,
    testPath: external
      ? clean
        ? 'public-live-clean'
        : 'public-live-upgrade'
      : clean
        ? 'public-019-clean'
        : 'public-019-upgrade',
    proofStage: 'final-candidate',
    passed: true,
    failures: [],
    phases,
    observer: { exitCode: 0, signal: null, passed: true, nativeWitness: witness },
    shutdown: { quitCode: 0, forced: false, ownerPhase: 'stopped', remainingProcesses: [] },
    pluginPins: pins,
    ...(external ? { publicCatalogue } : {}),
    baseline,
    residualState: { beforeUpgrade: clean ? null : [], afterInstaller: clean ? null : [] },
  }
  for (const [name, value] of Object.entries({
    'native-receipt.json': native,
    'summary.json': summary,
    [`running-${manifest.version}.json`]: {
      app: { version: manifest.version, build: { commit: manifest.source, dirty: false } },
    },
    'observer-result.json': observer,
    'observer-exit.json': { code: 0, signal: null },
    'observer-native-witness.json': witness,
    'candidate-installed-service.json': service,
    'candidate-live-hosts.json': live,
    'pre-upgrade-host-receipts.json': [],
    'final-host-receipts.json': receipts,
    'cleanup.json': cleanup,
    'candidate-process-exit.json': { observed: true, code: 0, signal: null },
    'baseline-residual-state.json': [],
    'after-installer-residual-state.json': [],
    'beta-current-catalogue-baseline.json': baseline,
  }))
    save(name, value)
  return external
    ? reference
    : {
        kind,
        carrierSha: WINDOWS_PROOF_SOURCE,
        driverSha: WINDOWS_PROOF_DRIVER,
        receiptFile: 'native-receipt.json',
      }
}

export function publicationFixture(
  external = false,
  { folder, fixture, publication: PROOF_PUBLICATION },
) {
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
    apiCalls: [],
    listBefore: [],
    listExtra: [],
    listResponse: null,
    idResponse: null,
    publicResponse: null,
    idReads: 0,
    keepDraft: false,
    corruptReadback: false,
    corruptDraftReadback: false,
    movedTag: false,
    movedCarrier: false,
    movedStableTag: false,
  }
  const asset = (name) => {
    const row = manifest.assets.find((row) => row.name === name)
    return { name, size: row.bytes, digest: `sha256:${row.sha256}` }
  }
  const matchingRelease = (names = [], draft = true) => ({
    id: 99,
    tag_name: 'v0.2.12',
    body,
    draft,
    prerelease: false,
    assets: names.map(asset),
  })
  const client = {
    source: vi.fn((sha, shaTree) => {
      expect([sha, shaTree]).toEqual([source, tree])
      return external ? execution : null
    }),
    api(endpoint) {
      state.apiCalls.push(endpoint)
      if (endpoint.startsWith('releases?per_page=100&page=')) {
        const rows = [
          ...state.listBefore,
          ...(state.release ? [state.release] : []),
          ...state.listExtra,
        ]
        const page = Number(endpoint.split('page=').at(-1))
        const result = structuredClone(rows.slice((page - 1) * 100, page * 100))
        return state.listResponse ? state.listResponse(result, page) : result
      }
      if (endpoint === 'releases/99') {
        state.idReads++
        const result = structuredClone(state.release)
        return state.idResponse ? state.idResponse(result, state.idReads) : result
      }
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
      if (endpoint === 'releases/tags/v0.2.12') {
        const result = state.release?.draft ? null : structuredClone(state.release)
        return state.publicResponse ? state.publicResponse(result) : result
      }
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
      if (command === 'create') state.release = matchingRelease()
      else if (command === 'upload')
        for (const file of args.slice(3, args.indexOf('--repo')))
          state.release.assets.push(asset(basename(file)))
      else if (command === 'download') {
        const name = args[args.indexOf('--pattern') + 1],
          dest = args[args.indexOf('--dir') + 1]
        state.downloads.push({ name, dest })
        copyFileSync(join(path, name), join(dest, name))
        if (
          (state.corruptReadback && dest.endsWith('public-readback')) ||
          (state.corruptDraftReadback && dest.endsWith('draft-readback'))
        )
          writeFileSync(join(dest, name), 'changed by transport')
      } else if (command === 'edit') state.release.draft = state.keepDraft
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
    matchingRelease,
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
