// The WhatsApp release for the hosted Windows gate, built on Linux as the plugin's own release
// workflow builds it: the standalone export of this commit, bound to the pinned source commit, with
// Node 22, locked installs and the pinned Go. Both archives must be the pinned bytes; the Windows
// archive and a one-entry list are left for the Windows job. Only public digests are written out.
import fs from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { fileURLToPath, pathToFileURL } from 'node:url'

const repository = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..')
const digest = (bytes) => createHash('sha256').update(bytes).digest('hex')

/** Whether every built target is exactly a pinned one, and every pinned target was built. */
export function matchesPin(pinned, built) {
  return (
    built.length === pinned.targets.length &&
    built.every((one) =>
      pinned.targets.some(
        (pin) =>
          pin.os === one.os &&
          pin.cpu === one.cpu &&
          pin.sha256 === one.sha256 &&
          pin.bytes === one.bytes &&
          pin.manifestSha256 === one.manifestSha256,
      ),
    )
  )
}

export function buildWhatsAppRelease(out, node22, go) {
  if (![out, node22, go].every(path.isAbsolute) || fs.existsSync(out))
    throw new Error('Supply a fresh output folder, Node 22 and Go')
  const pinned = JSON.parse(
    fs.readFileSync(path.join(repository, 'plugins/catalogue.json'), 'utf8'),
  ).entries.find((entry) => entry.id === 'whatsapp')
  const commit = pinned?.sourceCommit
  if (!/^[a-f0-9]{40}$/.test(commit ?? '')) throw new Error('Invalid pinned source commit')
  const scratch = fs.mkdtempSync(path.join(process.env.RUNNER_TEMP ?? '/tmp', 'whatsapp-release-'))
  const exported = path.join(scratch, 'source')
  const env = {
    ...process.env,
    PATH: [path.dirname(node22), path.dirname(go), process.env.PATH].join(path.delimiter),
    BROCREW_GO: go,
  }
  const npm = path.resolve(path.dirname(node22), '../lib/node_modules/npm/bin/npm-cli.js')
  const run = (args, cwd) => execFileSync(node22, args, { cwd, env, stdio: 'inherit' })
  run(['scripts/export-whatsapp-plugin.mjs', exported], repository)
  // A history-free export has no .git; built as the pinned commit, it must give the pinned bytes.
  const script = path.join(exported, 'scripts/release.mjs')
  const anchor = "execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim()"
  const text = fs.readFileSync(script, 'utf8')
  if (text.split(anchor).length !== 2) throw new Error('Export release anchor changed')
  fs.writeFileSync(script, text.replace(anchor, JSON.stringify(commit)))
  run([npm, 'ci', '--legacy-peer-deps', '--ignore-scripts', '--no-audit', '--no-fund'], exported)
  run(
    [npm, 'ci', '--ignore-scripts', '--no-audit', '--no-fund'],
    path.join(exported, 'plugins/whatsapp'),
  )
  const artifact = path.join(scratch, 'artifact')
  run(['scripts/release.mjs', artifact], exported)
  const entry = JSON.parse(fs.readFileSync(path.join(artifact, 'plugin-list-entry.json'), 'utf8'))
  const built = entry.targets.map((target) => {
    const bytes = fs.readFileSync(path.join(artifact, `whatsapp-${target.os}-${target.cpu}.tar.gz`))
    return {
      os: target.os,
      cpu: target.cpu,
      sha256: digest(bytes),
      bytes: bytes.length,
      manifestSha256: target.manifestSha256,
      listed: target.sha256 === digest(bytes) && target.bytes === bytes.length,
    }
  })
  const pinnedBytes =
    entry.sourceCommit === commit && built.every((one) => one.listed) && matchesPin(pinned, built)
  fs.mkdirSync(out, { recursive: true })
  fs.writeFileSync(
    path.join(out, 'archives.json'),
    JSON.stringify(
      {
        sourceCommit: commit,
        matchesPin: pinnedBytes,
        archives: built.map(({ os, cpu, sha256, bytes }) => ({ os, cpu, sha256, bytes })),
      },
      null,
      2,
    ) + '\n',
  )
  const windows = entry.targets.find((target) => target.os === 'win32' && target.cpu === 'x64')
  if (!pinnedBytes || !windows) return false
  fs.copyFileSync(
    path.join(artifact, 'whatsapp-win32-x64.tar.gz'),
    path.join(out, 'whatsapp-win32-x64.tar.gz'),
  )
  fs.writeFileSync(
    path.join(out, 'catalogue.json'),
    JSON.stringify({ format: 1, entries: [{ ...entry, targets: [windows] }] }),
  )
  return true
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const passed = buildWhatsAppRelease(
    path.resolve(process.argv[2] ?? ''),
    process.argv[3] ?? '',
    process.argv[4] ?? '',
  )
  console.log(fs.readFileSync(path.join(path.resolve(process.argv[2]), 'archives.json'), 'utf8'))
  process.exitCode = passed ? 0 : 1
}
