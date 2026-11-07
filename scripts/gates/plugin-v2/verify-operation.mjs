// Check the product result against the source SHA that was tested.
import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { demand, receipt, appSourceFor } from './contract.mjs'

import { verifySource } from './source-binding.mjs'

export function verifyOperation(sourceSha, summaryBytes) {
  const summary = JSON.parse(summaryBytes)
  const observed = summary.observedIdentity
  verifySource(observed?.routeCommit, sourceSha)
  demand(observed.appSource === appSourceFor(observed.appVersion, sourceSha))
  demand(summary.passed === true)
  receipt(summary)
  return {
    accepted: true,
    scope: 'synthetic-v2-review',
    publication: false,
    personalCutover: false,
    controlledOwnerCompatibility: summary.controlledOwnerCompatibility ?? null,
    final018Qualification: null,
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    const [sourceSha, summary] = process.argv.slice(2)
    const answer = verifyOperation(sourceSha, fs.readFileSync(summary))
    console.log(JSON.stringify(answer))
  } catch (error) {
    console.error(error?.stack ?? String(error))
    process.exitCode = 1
  }
}
