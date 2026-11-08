import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

const read = (folder, name) => JSON.parse(readFileSync(join(folder, name), 'utf8'))
const empty = (value, label) => assert.deepEqual(value, [], label)
const directory = (path) => dirname(path.replaceAll('\\', '/'))
export const WINDOWS_PROOF_SOURCE = '23630fa39854dc068fde16557b5976b8cf10fd2f'
export const WINDOWS_PROOF_DRIVER =
  '1c3e0e317d110a1f7c59247660e77132286f80335ac2d3998e891401ffb36bf5'

export function verifyWindowsProof(folder, reference, manifest) {
  const receipt = read(folder, 'native-receipt.json')
  const summary = read(folder, 'summary.json')
  const clean = reference.kind === 'windows-clean'
  assert.equal(receipt.format, 'brocrew.windows-installed-plugin-proof.v1')
  assert.equal(receipt.carrierSha, reference.carrierSha)
  assert.equal(receipt.driverSha, reference.driverSha)
  assert.equal(reference.carrierSha, WINDOWS_PROOF_SOURCE)
  assert.equal(reference.driverSha, WINDOWS_PROOF_DRIVER)
  assert.equal(receipt.proofStage, 'final-candidate')
  assert.equal(receipt.testPath, clean ? 'public-019-clean' : 'public-019-upgrade')
  assert.equal(receipt.passed, true)
  assert.equal(summary.passed, true)
  assert.equal(summary.nativeExecuted, true)
  assert.equal(summary.transport, 'public delivery')
  assert.equal(summary.customPlugins, undefined)
  empty(receipt.failures, 'native receipt failures')
  empty(summary.failures, 'raw summary failures')
  assert.deepEqual(receipt.phases, summary.phases)
  assert.equal(receipt.phases.length, clean ? 3 : 5)
  for (const phase of receipt.phases) {
    assert.equal(phase.passed, true)
    assert(
      Number.isFinite(Date.parse(phase.started)) &&
        Date.parse(phase.finished) >= Date.parse(phase.started),
    )
  }
  const candidate = receipt.candidate
  const installer = manifest.assets.find(
    (row) => row.name === `BroCrew-Setup-${manifest.version}-x64.exe`,
  )
  assert.deepEqual(candidate, {
    version: manifest.version,
    sourceSha: manifest.source,
    sourceTree: manifest.tree,
    installer: {
      sha256: installer.sha256,
      bytes: installer.bytes,
      buildRunId: String(manifest.runId),
      artifactName: 'release-windows',
      artifactId: String(manifest.origins.windows.artifactId),
    },
  })
  assert.deepEqual(summary.intake, {
    format: 1,
    carrierSha: receipt.carrierSha,
    driverSha: receipt.driverSha,
    candidate,
    proofStage: 'final-candidate',
  })
  const installed = read(folder, `running-${manifest.version}.json`)
  assert.equal(installed.app.version, manifest.version)
  assert.equal(installed.app.build.commit, manifest.source)
  assert.equal(installed.app.build.dirty, false)
  const observer = read(folder, 'observer-result.json')
  assert.equal(observer.passed, true)
  empty(observer.failures, 'observer failures')
  for (const key of ['routesReleased', 'personDetached', 'leaseClosed'])
    assert.equal(observer.cleanup[key], true)
  const exit = read(folder, 'observer-exit.json')
  assert.equal(exit.code, 0)
  assert.equal(exit.signal, null)
  assert.equal(receipt.observer.exitCode, exit.code)
  assert.equal(receipt.observer.signal, exit.signal)
  assert.equal(receipt.observer.passed, observer.passed)
  const witness = read(folder, 'observer-native-witness.json')
  assert.equal(witness.passed, true)
  assert.deepEqual(receipt.observer.nativeWitness, witness)
  assert.deepEqual(observer.nativeWitness, witness)
  assert.equal(observer.ownerEpoch, witness.ownerEpoch)
  const service = read(folder, 'candidate-installed-service.json')
  assert.equal(service.owner.epoch, witness.ownerEpoch)
  assert.equal(service.owner.phase, 'accepting')
  assert.deepEqual(summary.candidateService, service)
  assert.match(service.entrySha256, /^[0-9a-f]{64}$/)
  assert.match(service.runtimeId, /^[0-9a-f]{64}$/)
  assert.match(service.launchConfigSha256, /^[0-9a-f]{64}$/)
  assert.equal(service.runtime.platform, 'win32')
  assert.equal(service.runtime.arch, 'x64')
  const live = read(folder, 'candidate-live-hosts.json')
  assert.deepEqual(live, summary.liveHosts)
  const startsBefore = new Set(
    read(folder, 'pre-upgrade-host-receipts.json').map((row) => row.path),
  )
  const final = read(folder, 'final-host-receipts.json').filter(
    (row) => !startsBefore.has(row.path),
  )
  assert.deepEqual(receipt.pluginPins, summary.expected)
  for (const [plugin, expected] of Object.entries({
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
  })) {
    for (const [key, value] of Object.entries(expected))
      assert.equal(receipt.pluginPins[plugin][key], value)
    const starts = final.filter(
      (row) => row.path.endsWith('process.json') && row.value.pluginId === plugin,
    )
    assert(starts.length > 0, `${plugin}: no candidate native start`)
    for (const start of starts) {
      const stop = final.find(
        (row) => row.path.endsWith('exit.json') && directory(row.path) === directory(start.path),
      )
      assert(stop, `${plugin}: no paired stop`)
      assert.equal(stop.value.exited, true)
      assert.equal(stop.value.cause, 'stop')
      assert.equal(start.value.releaseDigest, expected.sha256)
      for (const key of ['runId', 'pluginId', 'releaseDigest', 'guardianPid', 'groups'])
        assert.deepEqual(stop.value[key], start.value[key])
      assert(start.value.groups.length > 0)
      const observed = live.find(
        (row) => row.id === plugin && row.receipt.runId === start.value.runId,
      )
      assert(observed, `${plugin}: no live OS witness`)
      assert.deepEqual(observed.receipt, start.value)
      assert.equal(observed.ownerEpoch, witness.ownerEpoch)
      assert.equal(observed.guardian.ParentProcessId, service.service.pid)
      assert.deepEqual(
        observed.groups.map((group) => [group.pid, group.birth]),
        start.value.groups,
      )
      assert(observed.packageFiles.length > 0)
      const pluginManifest = read(folder, `candidate-installed-${plugin}-plugin.json`)
      assert.deepEqual(
        observed.packageFiles.map((file) => ({
          path: file.path,
          sha256: file.sha256,
          size: file.bytes,
        })),
        pluginManifest.files,
      )
    }
  }
  const cleanup = read(folder, 'cleanup.json')
  assert.equal(cleanup.forced, false)
  empty(cleanup.processes, 'remaining owned processes')
  assert.equal(cleanup.owner.phase, 'stopped')
  assert.deepEqual(summary.cleanup, cleanup)
  const candidateExit = read(folder, 'candidate-process-exit.json')
  assert.equal(candidateExit.observed, true)
  assert.equal(candidateExit.code, 0)
  assert.equal(candidateExit.signal, null)
  assert.deepEqual(receipt.shutdown, {
    quitCode: 0,
    forced: false,
    ownerPhase: 'stopped',
    remainingProcesses: [],
  })
  if (!clean) {
    const before = read(folder, 'baseline-residual-state.json')
    const after = read(folder, 'after-installer-residual-state.json')
    assert.deepEqual(before, after)
    assert.deepEqual(receipt.residualState, { beforeUpgrade: before, afterInstaller: after })
    assert.deepEqual(receipt.baseline, read(folder, 'beta-current-catalogue-baseline.json'))
  }
  return receipt
}
