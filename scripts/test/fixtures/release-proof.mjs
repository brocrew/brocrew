import { createHash } from 'node:crypto'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { WINDOWS_PROOF_DRIVER, WINDOWS_PROOF_SOURCE } from '../../lib/release-proofs.mjs'
import * as releaseProofs from '../../lib/release-proofs.mjs'

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
