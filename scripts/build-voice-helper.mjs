import { spawnSync } from 'node:child_process'
import { mkdirSync, renameSync, rmSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
export function buildVoiceHelper(arch = process.arch) {
  if (process.platform !== 'darwin') throw new Error('The voice helper must be built on macOS.')
  if (!['arm64', 'x64'].includes(arch)) throw new Error('Unsupported voice helper architecture.')
  const native = join(ROOT, 'apps/desktop/native/voice')
  const output = join(ROOT, 'apps/desktop/resources/voice', arch, 'brocrew-voice')
  const temporary = `${output}.${process.pid}.tmp`
  mkdirSync(dirname(output), { recursive: true })
  const run = spawnSync(
    '/usr/bin/xcrun',
    [
      'swiftc',
      '-swift-version',
      '5',
      '-O',
      '-target',
      `${arch === 'x64' ? 'x86_64' : 'arm64'}-apple-macos12.0`,
      '-module-cache-path',
      join(ROOT, 'apps/desktop/out/voice-module-cache'),
      join(native, 'main.swift'),
      '-o',
      temporary,
      '-Xlinker',
      '-sectcreate',
      '-Xlinker',
      '__TEXT',
      '-Xlinker',
      '__info_plist',
      '-Xlinker',
      join(native, 'Info.plist'),
    ],
    { stdio: 'inherit' },
  )
  if (run.error || run.status !== 0) {
    rmSync(temporary, { force: true })
    throw new Error('The Mac voice helper did not compile.')
  }
  renameSync(temporary, output)
  return output
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  console.log(buildVoiceHelper(process.argv[2]))
}
