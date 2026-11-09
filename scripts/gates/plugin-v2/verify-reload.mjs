// Check reload product results against the tested source SHA.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { demand, readFile } from './contract.mjs'
import { verifySource } from './source-binding.mjs'
import { verifyOperation } from './verify-operation.mjs'
import { assertMainAppBehavior } from './reload-source/contract.mjs'

export function verifyReload(sourceSha, catalogueBytes, bytes) {
  verifyOperation(sourceSha, catalogueBytes)
  const value = JSON.parse(bytes),
    observed = value.observedIdentity
  demand(
    observed?.platform === 'win32' &&
      observed.arch === 'x64' &&
      observed.appVersion === '0.1.8' &&
      observed.appSource === sourceSha,
  )
  const catalogue = JSON.parse(catalogueBytes)
  demand(JSON.stringify(observed) === JSON.stringify(catalogue.observedIdentity))
  demand(
    value.schema === 1 &&
      value.scope === 'controlled-main-app-reload' &&
      value.passed === true &&
      value.publicBinary === false &&
      value.publication === false,
  )
  demand(value.realSdk === null && value.final018Qualification === null)
  demand(value.cleanup?.directClosed === true && value.cleanup.twoEmptySamples === true)
  demand(/^[a-f0-9]{64}$/.test(value.packageSha256) && value.bundle?.controlledSdkRefusal === true)
  for (const name of ['mainSha256', 'preloadSha256'])
    demand(/^[a-f0-9]{64}$/.test(value.bundle[name]))
  const pins = JSON.parse(readFile(fileURLToPath(new URL('./reload-inputs.json', import.meta.url))))
  demand(
    value.moduleSource?.commit === pins.sourceCommit &&
      value.moduleSource.tree === pins.sourceTree &&
      value.moduleSource.manifestSha256 === pins.manifestSha256,
  )
  demand(
    JSON.stringify(value.moduleSource.files) ===
      JSON.stringify(pins.modules.map(({ name, sha256, bytes }) => ({ name, sha256, bytes }))),
  )
  assertMainAppBehavior(value.journey?.behavior)
  demand(value.journey.nativeDatabaseClosed === true && value.journey.nativeAppClosed === true)
  const ipc = value.journey.nativeIpc
  demand(
    ipc &&
      Object.keys(ipc).sort().join(',') ===
        'createdViaNormalPreload,sampledDistinctActualArrivals,threePendingBeforeExit,threeRealSends,threeResolvedAfterExit,unknownOperationRefused',
  )
  demand(Object.values(ipc).every((v) => v === true))
  return {
    accepted: true,
    scope: 'controlled-main-app-reload',
    publication: false,
    realSdk: null,
    final018Qualification: null,
  }
}
// Independent SDK-only acceptance: never borrows a catalogue or controlled-main-app PASS.
export function verifySdkReload(sourceSha, bytes) {
  const value = JSON.parse(bytes)
  verifySource(value.observedIdentity?.routeCommit, sourceSha)
  demand(
    value.schema === 1 &&
      value.scope === 'real-sdk-start-reload' &&
      value.passed === true &&
      !value.failure,
  )
  demand(
    value.publicBinary === false &&
      value.publication === false &&
      value.personalCutover === false &&
      value.final018Qualification === null &&
      value.sdkAppSource === sourceSha,
  )
  demand(
    value.startControl === true && value.reloadControl === true && value.fixtureClosed === true,
  )
  demand(value.cleanup?.directClosed === true && value.cleanup.twoEmptySamples === true)
  demand(
    value.sdk?.name === '@anthropic-ai/claude-agent-sdk' &&
      value.sdk.expectedVersion === '0.3.287' &&
      value.sdk.version === '0.3.287' &&
      /^[a-f0-9]{64}$/.test(value.sdk.entrySha256),
  )
  demand(
    value.cli?.expectedVersion === '2.1.290' &&
      value.cli.version === '2.1.290' &&
      /^[a-f0-9]{64}$/.test(value.cli.programSha256),
  )
  for (const key of ['manifestSha256', 'packageSha256', 'lockSha256'])
    demand(/^[a-f0-9]{64}$/.test(value.cli[key]))
  demand(
    value.cli.programIdentity &&
      ['dev', 'ino', 'birthtimeNs', 'size', 'nlink', 'mtimeNs', 'ctimeNs'].every((key) =>
        /^\d+$/.test(value.cli.programIdentity[key]),
      ),
  )
  demand(
    Object.keys(value.children ?? {})
      .sort()
      .join(',') === 'reload,start',
  )
  for (const child of Object.values(value.children)) {
    demand(Number.isSafeInteger(child.pid) && child.pid > 0 && child.exit !== null)
    demand(child.exit.code === null || Number.isInteger(child.exit.code))
    demand(child.exit.signal === null || /^SIG[A-Z0-9]+$/.test(child.exit.signal))
  }
  const ack = value.reloadAck
  demand(
    ack?.state === 'fulfilled' &&
      Number.isFinite(ack.latencyMs) &&
      ack.latencyMs >= 0 &&
      ack.latencyMs < 10000,
  )
  demand(ack.arrays === true && ack.errorCount === 0 && ack.ownedPlugin === true)
  demand(
    Object.keys(value.arms ?? {})
      .sort()
      .join(',') === 'reload,start',
  )
  for (const arm of ['start', 'reload'])
    demand(value.arms[arm]?.name === arm && value.arms[arm].executed === 1)
  return {
    accepted: true,
    scope: 'real-sdk-start-reload',
    sdk: '0.3.287',
    cli: '2.1.290',
    publication: false,
    final018Qualification: null,
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    if (process.argv[2] === 'sdk') {
      const [sourceSha, summary] = process.argv.slice(3)
      console.log(JSON.stringify(verifySdkReload(sourceSha, fs.readFileSync(summary))))
    } else {
      const [sourceSha, catSummary, reloadSummary] = process.argv.slice(2)
      console.log(
        JSON.stringify(
          verifyReload(sourceSha, fs.readFileSync(catSummary), fs.readFileSync(reloadSummary)),
        ),
      )
    }
  } catch (error) {
    console.error(error?.stack ?? String(error))
    process.exitCode = 1
  }
}
