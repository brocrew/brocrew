import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { WINDOWS_PROOF_DRIVER, WINDOWS_PROOF_SOURCE } from '../../lib/release-proofs.mjs'

// Fictional raw evidence, shaped from the installed-plugin driver's receipt contract.
export function windowsProofFixture(folder, manifest, kind) {
  mkdirSync(folder, { recursive: true })
  const save = (name, value) =>
    writeFileSync(join(folder, name), JSON.stringify(value, null, 2) + '\n')
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
      packageFiles: [{ path: 'server.mjs', sha256: 'f'.repeat(64), bytes: 12 }],
    })
    save(`candidate-installed-${id}-plugin.json`, {
      files: [{ path: 'server.mjs', sha256: 'f'.repeat(64), size: 12 }],
    })
  }
  const baseline = clean
    ? null
    : { cause: 'actual fictional baseline outcome', normalShutdown: true }
  const intake = {
    format: 1,
    carrierSha: WINDOWS_PROOF_SOURCE,
    driverSha: WINDOWS_PROOF_DRIVER,
    candidate,
    proofStage: 'final-candidate',
  }
  const summary = {
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
    carrierSha: WINDOWS_PROOF_SOURCE,
    driverSha: WINDOWS_PROOF_DRIVER,
    candidate,
    testPath: clean ? 'public-019-clean' : 'public-019-upgrade',
    proofStage: 'final-candidate',
    passed: true,
    failures: [],
    phases,
    observer: { exitCode: 0, signal: null, passed: true, nativeWitness: witness },
    shutdown: { quitCode: 0, forced: false, ownerPhase: 'stopped', remainingProcesses: [] },
    pluginPins: pins,
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
  return {
    kind,
    carrierSha: WINDOWS_PROOF_SOURCE,
    driverSha: WINDOWS_PROOF_DRIVER,
    receiptFile: 'native-receipt.json',
  }
}
