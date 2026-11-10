import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, beforeAll, expect, it } from 'vitest'

/**
 * The Mac helper's transcript, compiled with a driver that feeds it recognition results in order.
 * Each step is the text of one result, whether it closes an utterance (a result after a pause
 * carries speech metadata; the final one after Stop), and the audio seconds its words span, which
 * the recognizer leaves at zero when it gives no timing.
 */
const NATIVE = fileURLToPath(new URL('../native/voice/transcript.swift', import.meta.url))
const DRIVER = `
var transcript = Transcript()
while let line = readLine() {
    let parts = line.components(separatedBy: "\\t")
    transcript.hear(
        parts[0], from: Double(parts[2]) ?? 0, to: Double(parts[3]) ?? 0,
        closesUtterance: parts[1] == "closes")
}
print(transcript.text)
`
const onMac = process.platform === 'darwin'
let dir = ''
let compiled: { status: number | null; stderr: string } = { status: null, stderr: '' }

// Compiled once. A failed compile fails each case by itself.
beforeAll(() => {
  if (!onMac) return
  dir = mkdtempSync(join(tmpdir(), 'voice-transcript-'))
  writeFileSync(join(dir, 'main.swift'), DRIVER)
  compiled = spawnSync(
    '/usr/bin/xcrun',
    [
      'swiftc',
      '-module-cache-path',
      join(dir, 'cache'),
      NATIVE,
      join(dir, 'main.swift'),
      '-o',
      join(dir, 'driver'),
    ],
    { encoding: 'utf8' },
  )
}, 120_000)

afterAll(() => {
  if (dir) rmSync(dir, { recursive: true, force: true })
})

type Step = [text: string, closes?: 'closes' | '', span?: [start: number, end: number]]

function heard(...steps: Step[]): string {
  const input = steps
    .map(([text, closes = '', [start, end] = [0, 0]]) => [text, closes, start, end].join('\t'))
    .join('\n')
  expect(compiled.status, compiled.stderr).toBe(0)
  const run = spawnSync(join(dir, 'driver'), [], { input: `${input}\n`, encoding: 'utf8' })
  expect(run.status, run.stderr).toBe(0)
  return run.stdout.trim()
}

it.runIf(onMac)('keeps the words when the silence stop ends on an empty result', () => {
  expect(heard(['Hello'], ['Hello can you'], ['Hello can you hear me'], ['', 'closes'])).toBe(
    'Hello can you hear me',
  )
})

it.runIf(onMac)('keeps every utterance when the recognizer starts over after a pause', () => {
  expect(
    heard(
      ['The purple robot'],
      ['The purple robot counts', 'closes', [0.5, 1.8]],
      ['seven'],
      ['seven paper stars', '', [3.1, 4.2]],
      ['', 'closes'],
    ),
  ).toBe('The purple robot counts seven paper stars')
})

it.runIf(onMac)('gives a manual stop its final words once', () => {
  expect(heard(['Hello can'], ['Hello can you hear me', 'closes', [0.4, 1.9]])).toBe(
    'Hello can you hear me',
  )
})

it.runIf(onMac)('does not repeat words a recognizer kept from the same audio', () => {
  expect(
    heard(
      ['Hello', 'closes', [0.4, 0.8]],
      ['Hello there', '', [0.4, 1.3]],
      ['Hello there friend', 'closes', [0.4, 1.7]],
    ),
  ).toBe('Hello there friend')
})

it.runIf(onMac)('keeps a new utterance that starts with the words before it', () => {
  expect(heard(['Hello', 'closes', [0.4, 0.8]], ['Hello there', 'closes', [2.2, 2.9]])).toBe(
    'Hello Hello there',
  )
  expect(heard(['Hello', 'closes'], ['Hello there', 'closes'])).toBe('Hello Hello there')
  expect(heard(['Hello', 'closes', [0.02, 0.8]], ['Hello there', 'closes'])).toBe(
    'Hello Hello there',
  )
})

it.runIf(onMac)('repeats only whole words', () => {
  expect(heard(['Go', 'closes', [0.4, 0.6]], ['Good morning', 'closes', [0.4, 1.2]])).toBe(
    'Go Good morning',
  )
})

it.runIf(onMac)('has nothing to deliver when nothing was said', () => {
  expect(heard(['', 'closes'])).toBe('')
})
