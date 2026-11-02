import { spawnSync } from 'node:child_process'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const binary = join(root, 'apps/desktop/resources/voice', process.arch, 'brocrew-voice')
const fixture = join(root, 'apps/desktop/test/fixtures/voice/fictional.wav')
if (process.platform !== 'darwin') {
  console.log('SKIP: the Apple engine requires macOS.')
  process.exit(77)
}
const preflight = spawnSync(binary, ['--preflight'], {
  encoding: 'utf8',
  timeout: 10_000,
  maxBuffer: 32_768,
})
if (preflight.error || preflight.status !== 0)
  throw new Error('The voice helper preflight failed. Build it first.')
const capability = JSON.parse(preflight.stdout.trim())
if (capability.authorization !== 'authorized') {
  console.log(
    `SKIP: ${capability.error === 'local' ? 'local English recognition is unavailable' : 'speech permission has not already been granted'}; no permission requested.`,
  )
  process.exit(77)
}
const run = spawnSync(binary, ['--fixture', fixture], {
  encoding: 'utf8',
  timeout: 20_000,
  maxBuffer: 32_768,
})
if (run.error || run.status !== 0) throw new Error('Local fixture recognition failed.')
const result = run.stdout
  .trim()
  .split('\n')
  .map((line) => JSON.parse(line))
  .find((item) => typeof item.text === 'string')
if (!result || !/purple robot/i.test(result.text) || !/paper stars/i.test(result.text)) {
  throw new Error('The local fixture did not recognize the fictional phrase.')
}
console.log(
  'PASS: Apple on-device recognition transcribed the fictional WAV; no microphone opened.',
)
