import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { digest, ownedRoot, safeReport } from './contract.mjs'
const repository = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..')
function tools() {
  const app = createRequire(path.join(repository, 'apps/desktop/package.json'))
  const builder = createRequire(app.resolve('electron-builder/package.json'))
  const lib = createRequire(builder.resolve('app-builder-lib/package.json'))
  return { ...lib('@electron/fuses'), asar: lib('@electron/asar'), plist: lib('plist') }
}
export async function inspectBundle(app, expected) {
  const { getCurrentFuseWire, FuseV1Options, asar, plist } = tools()
  const resources = path.join(app, 'Contents/Resources')
  const archive = path.join(resources, 'app.asar')
  const headerHash = digest(asar.getRawHeader(archive).headerString)
  const info = plist.parse(fs.readFileSync(path.join(app, 'Contents/Info.plist'), 'utf8'))
  const recorded = info.ElectronAsarIntegrity?.['Resources/app.asar']
  if (recorded?.algorithm !== 'SHA256' || recorded.hash !== headerHash)
    throw new Error('ASAR integrity differs')
  const wire = await getCurrentFuseWire(app)
  if (wire.version !== '1') throw new Error('Unsupported fuse version')
  const facts = { headerMatches: true }
  for (const [name, index] of Object.entries(FuseV1Options).filter(
    ([, value]) => typeof value === 'number',
  )) {
    if (![48, 49].includes(wire[index])) throw new Error('Unsupported fuse state')
    facts[name] = wire[index] === 49
  }
  facts.unknownFuses = Object.keys(wire).filter(
    (key) => /^\d+$/.test(key) && !FuseV1Options[key],
  ).length
  const runtime = path.join(resources, 'plugin-node/node')
  const nodeHash = digest(fs.readFileSync(runtime))
  const descriptor = JSON.parse(fs.readFileSync(path.join(resources, 'plugin-node/runtime.json')))
  if (nodeHash !== descriptor.sha256) throw new Error('Pinned Node differs')
  facts.pinnedNodeMatches = true
  const stamp = { headerHash, archiveHash: digest(fs.readFileSync(archive)), nodeHash, wire }
  if (expected !== undefined && JSON.stringify(stamp) !== JSON.stringify(expected))
    throw new Error('Packaged bundle changed')
  return { facts, stamp }
}
export const integrityStages = [
  'afterPackage',
  'afterSourceRestore',
  'afterVerification',
  'afterFixtureWrite',
  'beforeLaunch',
]
const factNames = [
  'RunAsNode',
  'EnableCookieEncryption',
  'EnableNodeOptionsEnvironmentVariable',
  'EnableNodeCliInspectArguments',
  'EnableEmbeddedAsarIntegrityValidation',
  'OnlyLoadAppFromAsar',
  'LoadBrowserProcessSpecificV8Snapshot',
  'GrantFileProtocolExtraPrivileges',
]
function safeFacts(value) {
  return (
    value &&
    typeof value === 'object' &&
    Object.keys(value).sort().join(',') ===
      [...factNames, 'headerMatches', 'pinnedNodeMatches', 'unknownFuses'].sort().join(',') &&
    factNames.every((name) => typeof value[name] === 'boolean') &&
    value.headerMatches === true &&
    value.pinnedNodeMatches === true &&
    Number.isSafeInteger(value.unknownFuses) &&
    value.unknownFuses >= 0
  )
}
export function readIntegrity(root) {
  const fd = fs.openSync(
    path.join(root, 'integrity.json'),
    fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK,
  )
  try {
    const stat = fs.fstatSync(fd)
    if (
      !stat.isFile() ||
      stat.uid !== process.getuid() ||
      stat.mode & 0o077 ||
      stat.nlink !== 1 ||
      stat.size > 16384
    )
      throw new Error('Invalid integrity receipt')
    const value = JSON.parse(fs.readFileSync(fd))
    if (
      !safeReport(value) ||
      Object.entries(value).some(
        ([key, facts]) => !integrityStages.includes(key) || !safeFacts(facts),
      )
    )
      throw new Error('Invalid integrity receipt')
    return value
  } finally {
    fs.closeSync(fd)
  }
}
export async function integrityCheckpoint(root, app, stage, expected) {
  ownedRoot(root)
  if (
    !path.resolve(app).startsWith(root + '/') ||
    !integrityStages.includes(stage) ||
    (stage !== 'afterPackage' && !expected)
  )
    throw new Error('Invalid integrity checkpoint')
  const result = await inspectBundle(app, expected)
  let receipt = {}
  if (fs.existsSync(path.join(root, 'integrity.json'))) receipt = readIntegrity(root)
  if (stage !== 'afterPackage' && !receipt.afterPackage)
    throw new Error('Missing package checkpoint')
  receipt[stage] = result.facts
  const temporary = path.join(root, 'integrity-next.json')
  const fd = fs.openSync(
    temporary,
    fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_NOFOLLOW,
    0o600,
  )
  try {
    fs.writeFileSync(fd, JSON.stringify(receipt))
    fs.fsyncSync(fd)
  } finally {
    fs.closeSync(fd)
  }
  fs.renameSync(temporary, path.join(root, 'integrity.json'))
  return result.stamp
}
