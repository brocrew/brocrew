import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, beforeAll, expect, it } from 'vitest'

/**
 * The Mac helper's transcript, compiled with a driver that feeds it recognition results in order.
 * Each step is the text of one result and whether it closes an utterance: a result after a pause
 * (it carries speech metadata) or the final one after Stop.
 */
const NATIVE = fileURLToPath(new URL('../native/voice/transcript.swift', import.meta.url))
const DRIVER = `
var transcript = Transcript()
while let line = readLine() {
    let parts = line.components(separatedBy: "\\t")
    transcript.hear(parts[0], closesUtterance: parts.count > 1 && parts[1] == "closes")
}
print(transcript.text)
`
const onMac = process.platform === 'darwin'
let dir = ''
let compiled: { status: number | null; stderr: string } = { status: null, stderr: '' }

// Compiled once. A failed compile fails each case by itself, so the source check below still runs.
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

function heard(...steps: [text: string, closes?: 'closes'][]): string {
  const input = steps.map(([text, closes]) => (closes ? `${text}\tcloses` : text)).join('\n')
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
      ['The purple robot counts', 'closes'],
      ['seven'],
      ['seven paper stars'],
      ['', 'closes'],
    ),
  ).toBe('The purple robot counts seven paper stars')
})

it.runIf(onMac)('gives a manual stop its final words once', () => {
  expect(heard(['Hello can'], ['Hello can you hear me', 'closes'])).toBe('Hello can you hear me')
})

it.runIf(onMac)('does not repeat words a recognizer kept across the pause', () => {
  expect(heard(['Hello', 'closes'], ['hello there'], ['Hello there friend', 'closes'])).toBe(
    'Hello there friend',
  )
})

it.runIf(onMac)('has nothing to deliver when nothing was said', () => {
  expect(heard(['', 'closes'])).toBe('')
})

it('ends a recording with the kept transcript, not the last result alone', () => {
  const helper = readFileSync(
    fileURLToPath(new URL('../native/voice/main.swift', import.meta.url)),
    'utf8',
  )
  expect(helper).not.toContain('finish(text: result.bestTranscription.formattedString)')
  expect(helper).toContain('self.transcript.hear(')
  expect(helper).toContain('self.finish(text: self.transcript.text)')
})
