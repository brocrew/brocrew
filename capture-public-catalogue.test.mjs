import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, existsSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
import { verifyCatalogueCapture } from './public-catalogue-profile.mjs'

const root = mkdtempSync(join(tmpdir(), 'catalogue-capture-control-'))
const body = readFileSync(new URL('./public-catalogue-profile.fixture.json', import.meta.url), 'utf8')
const script = fileURLToPath(new URL('./capture-public-catalogue.mjs', import.meta.url))
try {
  const execute = (name, status, responseBody, runId) => {
    const folder = join(root, name)
    const code = `import assert from 'node:assert/strict';let calls=0;
      globalThis.fetch=async url=>{calls++;assert.equal(url,'https://raw.githubusercontent.com/brocrew/brocrew/main/plugins/catalogue-v2.json');return new Response(${JSON.stringify(responseBody)},{status:${status}})};
      process.argv=[process.execPath,${JSON.stringify(script)},${JSON.stringify(folder)}];
      await import(${JSON.stringify(new URL('./capture-public-catalogue.mjs', import.meta.url).href)});assert.equal(calls,1);`
    return { folder, result: spawnSync(process.execPath, ['--input-type=module', '-e', code], { encoding: 'utf8',
      env: { ...process.env, GITHUB_RUN_ID: runId, GITHUB_RUN_ATTEMPT: '1', GITHUB_SHA: 'a'.repeat(40) } }) }
  }
  const clean = execute('clean', 200, body, '123')
  assert.equal(clean.result.status, 0, clean.result.stderr)
  const capture = JSON.parse(readFileSync(join(clean.folder, 'public-catalogue-capture.json')))
  assert.equal(capture.origin.runId, '123')
  assert.equal(capture.origin.carrierSha, 'a'.repeat(40))
  assert.deepEqual(readFileSync(join(clean.folder, 'public-catalogue-v2.json')), Buffer.from(body))
  verifyCatalogueCapture(Buffer.from(body), capture, { runId: '123', runAttempt: '1', carrierSha: 'a'.repeat(40) })
  const changed = JSON.parse(body), whatsapp = changed.entries.find(e => e.id === 'whatsapp')
  whatsapp.version = '0.1.5'
  for (const target of whatsapp.targets) target.url = target.url.replace('v0.1.4/', 'v0.1.5/')
  const upgrade = execute('upgrade', 200, JSON.stringify(changed), '124')
  assert.equal(upgrade.result.status, 0, upgrade.result.stderr)
  const upgradeCapture = JSON.parse(readFileSync(join(upgrade.folder, 'public-catalogue-capture.json')))
  assert.equal(upgradeCapture.origin.runId, '124')
  assert.notEqual(upgradeCapture.sha256, capture.sha256)
  assert.equal(JSON.parse(readFileSync(join(upgrade.folder, 'public-plugin-inputs.json'))).whatsapp.version, '0.1.5')
  const failed = execute('failed', 503, 'unavailable', '125')
  assert.equal(failed.result.status, 1)
  assert.equal(readFileSync(join(failed.folder, 'public-catalogue-v2.json'), 'utf8'), 'unavailable')
  assert(!existsSync(join(failed.folder, 'public-catalogue-capture.json')))
  console.log(JSON.stringify({ singleFetchPerInvocation: true, differingPerRunCaptures: true, failedAcquisitionRejected: true,
    scope: 'mocked fetch only; no network, plugin, installer or native proof' }))
} finally { rmSync(root, { recursive: true, force: true }) }
