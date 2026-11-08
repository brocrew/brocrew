// One live response per native invocation. Installed Settings still uses public delivery.
import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { publicCatalogueProfile, publicCatalogueUrl, verifyCatalogueCapture } from './public-catalogue-profile.mjs'

const [evidence] = process.argv.slice(2)
assert(evidence)
const response = await fetch(publicCatalogueUrl, { signal: AbortSignal.timeout(30000) })
const bytes = Buffer.from(await response.arrayBuffer())
mkdirSync(evidence, { recursive: true })
writeFileSync(join(evidence, 'public-catalogue-v2.json'), bytes, { flag: 'wx' })
assert.equal(response.status, 200, publicCatalogueUrl)
const profile = publicCatalogueProfile(bytes)
const capture = { format: 'brocrew.public-plugin-catalogue.v1', ...profile.seal, capturedAt: new Date().toISOString(),
  origin: { runId: process.env.GITHUB_RUN_ID, runAttempt: process.env.GITHUB_RUN_ATTEMPT, carrierSha: process.env.GITHUB_SHA },
  selected: profile.selected }
verifyCatalogueCapture(bytes, capture, capture.origin)
writeFileSync(join(evidence, 'public-catalogue-capture.json'), JSON.stringify(capture, null, 2) + '\n', { flag: 'wx' })
writeFileSync(join(evidence, 'public-plugin-inputs.json'), JSON.stringify(profile.expected, null, 2) + '\n', { flag: 'wx' })
