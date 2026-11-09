import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

const read = (folder, name) => JSON.parse(readFileSync(join(folder, name), 'utf8'))
const empty = (value, label) => assert.deepEqual(value, [], label)
const directory = (path) => dirname(path.replaceAll('\\', '/'))
export const WINDOWS_PROOF_SOURCE = '23630fa39854dc068fde16557b5976b8cf10fd2f'
export const WINDOWS_CURRENT_SOURCE = 'a92e573cc19da7531eababa8d22c2c635dc42fa7'
export const WINDOWS_CURRENT_DRIVER =
  '21bf6c05f21bfe2eee255f21d3b7ca20dd4b161f1124a226369e31472b3cc085'
export const WINDOWS_PROOF_DRIVER =
  '1c3e0e317d110a1f7c59247660e77132286f80335ac2d3998e891401ffb36bf5'

const CATALOGUE_URL =
  'https://raw.githubusercontent.com/brocrew/brocrew/main/plugins/catalogue-v2.json'
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex')

function publicCatalogueProof(folder, reference, receipt) {
  const raw = readFileSync(join(folder, 'public-catalogue-v2.json'))
  const capture = read(folder, 'public-catalogue-capture.json')
  assert.deepEqual(receipt.publicCatalogue, capture)
  assert.equal(capture.format, 'brocrew.public-plugin-catalogue.v1')
  assert.equal(capture.url, CATALOGUE_URL)
  assert.equal(capture.sha256, sha256(raw))
  assert.equal(capture.bytes, raw.length)
  assert(Number.isFinite(Date.parse(capture.capturedAt)))
  assert.deepEqual(capture.origin, {
    runId: String(reference.runId),
    runAttempt: String(reference.runAttempt),
    carrierSha: reference.carrierSha,
  })
  assert.equal(capture.cleanProof, undefined)
  assert.deepEqual(Object.keys(capture.selected).sort(), ['chrome', 'whatsapp'])
  const catalogue = JSON.parse(raw.toString('utf8'))
  assert.equal(catalogue.format, 2)
  assert(Array.isArray(catalogue.entries))
  const expected = {}
  for (const id of ['chrome', 'whatsapp']) {
    const entries = catalogue.entries.filter((one) => one.id === id)
    assert.equal(entries.length, 1)
    const entry = entries[0]
    assert.match(entry.version, /^\d+\.\d+\.\d+$/)
    assert.match(entry.sourceCommit, /^[a-f0-9]{40}$/)
    const targets = entry.targets.filter((one) => one.os === 'win32' && one.cpu === 'x64')
    assert.equal(targets.length, 1)
    const target = targets[0]
    assert.equal(target.compression, 'tar.gz')
    assert(
      Number.isSafeInteger(target.bytes) && target.bytes > 0 && target.bytes <= 128 * 1024 * 1024,
    )
    assert.match(target.sha256, /^[a-f0-9]{64}$/)
    assert.match(target.manifestSha256, /^[a-f0-9]{64}$/)
    assert.equal(
      target.url,
      `https://github.com/brocrew/brocrew-plugin-${id}/releases/download/v${entry.version}/${id}-win32-x64.tar.gz`,
    )
    assert.deepEqual(capture.selected[id], {
      entrySha256: sha256(JSON.stringify(entry)),
      targetSha256: sha256(JSON.stringify(target)),
    })
    expected[id] = {
      version: entry.version,
      bytes: target.bytes,
      sha256: target.sha256,
      manifest: target.manifestSha256,
      sourceCommit: entry.sourceCommit,
      repo: `brocrew-plugin-${id}`,
      url: target.url,
    }
  }
  assert.deepEqual(receipt.pluginPins, expected)
  return expected
}

export function verifyWindowsProof(folder, reference, manifest, current = false) {
  const receipt = read(folder, 'native-receipt.json')
  const summary = read(folder, 'summary.json')
  const clean = reference.kind === 'windows-clean'
  assert.equal(receipt.format, 'brocrew.windows-installed-plugin-proof.v1')
  assert.equal(receipt.carrierSha, reference.carrierSha)
  assert.equal(receipt.driverSha, reference.driverSha)
  assert.equal(reference.carrierSha, current ? WINDOWS_CURRENT_SOURCE : WINDOWS_PROOF_SOURCE)
  assert.equal(reference.driverSha, current ? WINDOWS_CURRENT_DRIVER : WINDOWS_PROOF_DRIVER)
  assert.equal(receipt.proofStage, 'final-candidate')
  assert.equal(
    receipt.testPath,
    current
      ? clean
        ? 'public-live-clean'
        : 'public-live-upgrade'
      : clean
        ? 'public-019-clean'
        : 'public-019-upgrade',
  )
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
  if (current) {
    assert.deepEqual(summary.publicCatalogue, receipt.publicCatalogue)
    assert(Date.parse(receipt.publicCatalogue.capturedAt) <= Date.parse(summary.started))
  }
  const expectedPlugins = current
    ? publicCatalogueProof(folder, reference, receipt)
    : {
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
  for (const [plugin, expected] of Object.entries(expectedPlugins)) {
    for (const [key, value] of Object.entries(expected))
      assert.equal(receipt.pluginPins[plugin][key], value)
    if (current) {
      const release = read(folder, `public-${plugin}-release.json`)
      assert.equal(release.draft, false)
      assert.equal(release.tag_name, `v${expected.version}`)
      const assets = release.assets.filter((one) => one.name === `${plugin}-win32-x64.tar.gz`)
      assert.equal(assets.length, 1)
      assert.equal(assets[0].digest, `sha256:${expected.sha256}`)
      assert.equal(assets[0].size, expected.bytes)
      assert.equal(assets[0].browser_download_url, expected.url)
      for (const label of ['input', 'candidate-installed']) {
        const rawManifest = readFileSync(join(folder, `${label}-${plugin}-plugin.json`))
        const extraction = read(folder, `${label}-${plugin}-manifest-extraction.json`)
        assert.equal(extraction.status, 0)
        assert.equal(extraction.signal, null)
        assert.equal(extraction.errorCode, undefined)
        assert.equal(extraction.stdinBytes, expected.bytes)
        assert.equal(extraction.stdinSha256, expected.sha256)
        assert.equal(extraction.stdoutBytes, rawManifest.length)
        assert.equal(extraction.stdoutSha256, expected.manifest)
        assert.equal(sha256(rawManifest), expected.manifest)
        const one = JSON.parse(rawManifest)
        assert.equal(one.id, plugin)
        assert.equal(one.version, expected.version)
        assert.equal(one.sourceCommit, expected.sourceCommit)
        assert(one.platforms.some((target) => target.os === 'win32' && target.cpu === 'x64'))
      }
      const state = read(folder, 'candidate-installed-state.json')
      assert.deepEqual(summary.candidateInstalled, state)
      const entries = state.activation.entries.filter((one) => one.pluginId === plugin)
      assert.equal(entries.length, 1)
      assert.equal(entries[0].phase, 'active')
      assert.equal(entries[0].release.version, expected.version)
      assert.equal(entries[0].release.archiveSha256, expected.sha256)
      assert.equal(entries[0].release.manifestSha256, expected.manifest)
      assert.deepEqual(
        state.vault.filter((one) => one.id === plugin),
        [
          {
            id: plugin,
            archiveSha256: expected.sha256,
            manifestSha256: expected.manifest,
            bytes: expected.bytes,
          },
        ],
      )
    }
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
      if (current) {
        const rawManifest = readFileSync(join(folder, `candidate-installed-${plugin}-plugin.json`))
        assert.equal(sha256(rawManifest), expected.manifest)
        assert.equal(pluginManifest.id, plugin)
        assert.equal(pluginManifest.version, expected.version)
        assert.equal(pluginManifest.sourceCommit, expected.sourceCommit)
      }
      assert.deepEqual(
        observed.packageFiles.map((file) => ({
          path: file.path,
          type: 'file',
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
