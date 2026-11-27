// Check reload product results against the tested source SHA.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { demand, readFile } from './contract.mjs'
import { verifyOperation } from './verify-operation.mjs'
import { assertMainAppBehavior } from './reload-source/contract.mjs'

export function verifyReload(sourceSha, catalogueBytes, bytes) {
  verifyOperation(sourceSha, catalogueBytes)
  const value = JSON.parse(bytes),
    observed = value.observedIdentity
  demand(
    observed?.platform === 'win32' && observed.arch === 'x64' && observed.routeCommit === sourceSha,
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
  demand(value.realSdk === null)
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
        'createdViaNormalPreload,originalPendingWhileHeld,threeRealSends,threeResolvedAfterExit,twoQueuedWhileHeld,unknownOperationRefused',
  )
  demand(Object.values(ipc).every((v) => v === true))
  return {
    accepted: true,
    scope: 'controlled-main-app-reload',
    publication: false,
    realSdk: null,
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    const [sourceSha, catSummary, reloadSummary] = process.argv.slice(2)
    console.log(
      JSON.stringify(
        verifyReload(sourceSha, fs.readFileSync(catSummary), fs.readFileSync(reloadSummary)),
      ),
    )
  } catch (error) {
    console.error(error?.stack ?? String(error))
    process.exitCode = 1
  }
}
