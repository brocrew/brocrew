import assert from 'node:assert/strict'
import path from 'node:path'
import { createHash } from 'node:crypto'

export const hash = (bytes) => createHash('sha256').update(bytes).digest('hex')
export const demand = assert.ok
export const once = (text, before, after) => {
  demand(text.split(before).length === 2)
  return text.replace(before, after)
}
export { readOwnedFile } from './owned-files.mjs'
import { readOwnedFile } from './owned-files.mjs'
export const readFile = (file, maximum = 16 * 1024 * 1024) => readOwnedFile(file, maximum)
export function below(root, child) {
  const relative = path.relative(root, child)
  return (
    relative !== '' &&
    !path.isAbsolute(relative) &&
    relative !== '..' &&
    !relative.startsWith(`..${path.sep}`)
  )
}
// The tested commit is the app under test, built with its own version, on a hosted runner.
export function hosted(env = process.env, platform = process.platform, arch = process.arch) {
  demand(env.GITHUB_ACTIONS === 'true' && env.RUNNER_ENVIRONMENT === 'github-hosted')
  demand(
    env.GITHUB_REPOSITORY === 'brocrew/brocrew' &&
      ['push', 'workflow_dispatch'].includes(env.GITHUB_EVENT_NAME),
  )
  demand((platform === 'darwin' && arch === 'arm64') || (platform === 'win32' && arch === 'x64'))
  return {
    role: platform === 'darwin' ? 'mac' : 'windows',
    workflow: '.github/workflows/plugin-review.yml',
  }
}
export function networkReceipt(net) {
  demand(
    net &&
      Object.keys(net).sort().join(',') === 'archiveMeasurements,archives,hops,synthetic,v1,v2',
  )
  demand(/^[a-f0-9]{64}$/.test(net.v1) && /^[a-f0-9]{64}$/.test(net.v2))
  demand(net.archives === 2 && net.synthetic === false)
  demand(Array.isArray(net.archiveMeasurements) && net.archiveMeasurements.length === 2)
  demand(
    net.archiveMeasurements
      .map((a) => a.id)
      .sort()
      .join(',') === 'chrome,whatsapp',
  )
  let target
  for (const a of net.archiveMeasurements) {
    demand(Object.keys(a).sort().join(',') === 'bytes,cpu,id,os,sha256,version')
    demand(Number.isSafeInteger(a.bytes) && a.bytes > 0 && /^[a-f0-9]{64}$/.test(a.sha256))
    if (target) demand(target === a.os + '/' + a.cpu)
    target = a.os + '/' + a.cpu
  }
  demand(Array.isArray(net.hops) && net.hops.length >= 4 && net.hops.length <= 32)
  for (const hop of net.hops) {
    demand(Object.keys(hop).sort().join(',') === 'host,request,status')
    demand(['v1', 'v2', 'chrome', 'whatsapp'].includes(hop.request))
    demand(
      [
        'raw.githubusercontent.com',
        'github.com',
        'release-assets.githubusercontent.com',
        'objects.githubusercontent.com',
      ].includes(hop.host),
    )
    demand([200, 301, 302, 303, 307, 308].includes(hop.status))
  }
  for (const key of ['v1', 'v2', 'chrome', 'whatsapp'])
    demand(net.hops.filter((h) => h.request === key).at(-1)?.status === 200)
  return net
}
export function receipt(value) {
  demand(value?.schema === 1 && value.scope === 'synthetic-v2-review')
  demand(value.publicBinary === false && value.publication === false)
  demand(value.packageSha256 === null || /^[a-f0-9]{64}$/.test(value.packageSha256))
  demand(value.cleanup?.directClosed === true && value.cleanup?.twoEmptySamples === true)
  for (const id of ['chrome', 'whatsapp']) {
    const p = value.plugins?.[id]
    demand(
      p &&
        [
          'review',
          'cancelZeroInstalls',
          'staleRefused',
          'confirmed',
          'running',
          'configured',
          'removed',
          'nativeDetailsMatched',
        ].every((k) => p[k] === true),
    )
  }
  networkReceipt(value.unmodifiedNetwork)
  demand(
    value.unmodifiedNetwork.archiveMeasurements.every(
      (a) => a.os === value.measurement?.platform && a.cpu === value.measurement?.arch,
    ),
  )
  demand(value.platformMeasured === true && value.packageSha256 !== null)
  demand(value.plugins.whatsapp.bridgeObserved === true)
  return value
}
