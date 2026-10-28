import path from 'node:path'
import { createHash } from 'node:crypto'
import { fileURLToPath } from 'node:url'

export const BASE = '04faa94c05f007f536b8499b984471bdf7a9080b'
export const BASE017 = 'a4dfcf611c244f8365d485022dc674309c2e7ae1'
export const LIST = '68c495035726241ddf6862567d932c0f3c8086969875cb06b07552aa573b9171'
export const V1 = '16d5c9f55779f85bc94f632812cf4ec7afd3585ca54ac5799c00263732aa9f93'
export const PUBLIC_V2 = '3f354f05c786f65ddaf4cdd51638051d69471e5f2ac91f008660f25bd1435482'
export const URL =
  'https://raw.githubusercontent.com/brocrew/brocrew/main/plugins/catalogue-v2.json'
export const MARKER = 'plugin-v2-review-gate-only'
export const hash = (bytes) => createHash('sha256').update(bytes).digest('hex')
export function demand(condition) {
  if (!condition) throw new Error('Plugin v2 gate refused')
}
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
export function appSourceFor(version, routeCommit) {
  demand(/^[a-f0-9]{40}$/.test(routeCommit) && ['0.1.7', '0.1.8'].includes(version))
  return version === '0.1.7' ? BASE017 : routeCommit
}
export function hostedRunner(env = process.env, platform = process.platform, arch = process.arch) {
  return (
    env.GITHUB_ACTIONS === 'true' &&
    (env.RUNNER_ENVIRONMENT === 'github-hosted' ||
      (env.RUNNER_ENVIRONMENT === 'self-hosted' && platform === 'darwin' && arch === 'arm64'))
  )
}
export function hosted(
  plan,
  version,
  env = process.env,
  platform = process.platform,
  arch = process.arch,
) {
  demand(hostedRunner(env, platform, arch))
  demand(plan?.schema === 2 && plan.scope === 'synthetic-v2-review')
  demand(
    env.GITHUB_REPOSITORY === 'brocrew/brocrew' && env.GITHUB_EVENT_NAME === 'workflow_dispatch',
  )
  const role = /^refs\/heads\/gate\/plugin-v2-(mac|windows)-[a-z0-9-]+$/.exec(
    env.GITHUB_REF ?? '',
  )?.[1]
  demand((platform === 'darwin' && arch === 'arm64') || (platform === 'win32' && arch === 'x64'))
  demand(role === (platform === 'darwin' ? 'mac' : 'windows'))
  demand(['0.1.7', '0.1.8'].includes(version))
  demand(Array.isArray(plan.appSources) && plan.appSources.length === 2)
  const oldApp = plan.appSources.find((one) => one.version === '0.1.7')
  const finalApp = plan.appSources.find((one) => one.version === '0.1.8')
  demand(
    oldApp &&
      Object.keys(oldApp).sort().join(',') === 'commit,version' &&
      oldApp.commit === BASE017,
  )
  demand(
    finalApp &&
      Object.keys(finalApp).sort().join(',') === 'source,version' &&
      finalApp.source === 'observed-route-head',
  )
  const appSource = appSourceFor(version, env.GITHUB_SHA)
  demand(plan.candidateSha256 === LIST && plan.base === BASE)
  demand(/^[a-f0-9]{64}$/.test(plan.routePolicySha256))
  demand(
    !Object.hasOwn(plan, 'routeCommit') &&
      !Object.hasOwn(plan, 'routeTree') &&
      !Object.hasOwn(plan, 'workflowSha256') &&
      !Object.hasOwn(plan, 'sourcePlanSha256'),
  )
  return {
    appSource,
    appVersion: version,
    role,
    workflow: role === 'mac' ? '.github/workflows/macos.yml' : '.github/workflows/windows.yml',
  }
}
export function networkReceipt(net) {
  demand(
    net &&
      Object.keys(net).sort().join(',') === 'archiveMeasurements,archives,hops,synthetic,v1,v2',
  )
  demand(net?.v1 === V1 && net.v2 === PUBLIC_V2 && net.archives === 2 && net.synthetic === false)
  const bytes = readFile(fileURLToPath(new globalThis.URL('./candidate.json', import.meta.url)))
  demand(hash(bytes) === LIST)
  const entries = JSON.parse(bytes).entries
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
    const entry = entries.find((e) => e.id === a.id),
      pin = entry?.targets.find((t) => t.os === a.os && t.cpu === a.cpu)
    demand(pin && a.version === entry.version && a.bytes === pin.bytes && a.sha256 === pin.sha256)
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
  demand(value.bundlePaths?.main === true && value.bundlePaths?.owner === true)
  demand(value.runtimePaths?.client === true && value.runtimePaths?.owner === true)
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
          'emptyManaged',
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
  demand(value.normalBuildRefused === true && value.normalOutputRefused === true)
  demand(value.plugins.whatsapp.bridgeObserved === true)
  return value
}
