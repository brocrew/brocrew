import { afterEach, describe, expect, it, vi } from 'vitest'
import { EventEmitter } from 'node:events'
import { PassThrough } from 'node:stream'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawn } from 'node:child_process'
import { runVoiceHelper, type VoiceSession } from '../src/main/voice/engine'
import { VoiceService } from '../src/main/voice/service'
import { appendDictation, isVoiceId, type VoiceResult } from '../src/shared/voice'

const ID = 'fictional-session-12345'
function deferred() {
  let resolve!: (result: VoiceResult) => void
  const result = new Promise<VoiceResult>((done) => {
    resolve = done
  })
  return { result, resolve }
}
function fakeChild() {
  const child = Object.assign(new EventEmitter(), {
    stdout: new PassThrough(),
    stderr: new PassThrough(),
    stdin: new PassThrough(),
    kill: vi.fn(() => true),
  })
  const states = vi.fn()
  const launch = vi.fn(() => child) as unknown as typeof spawn
  const session = runVoiceHelper('/fictional/voice', states, launch)
  const frame = (data: unknown): void => {
    child.stdout.write(JSON.stringify(data) + '\n')
  }
  return { child, session, frame, states, launch }
}
afterEach(() => {
  vi.useRealTimers()
})

describe('the core owns one recording', () => {
  it('refuses overlaps, sibling-window controls and wrong tokens until the child exits', async () => {
    const pending = deferred()
    const session: VoiceSession = { result: pending.result, stop: vi.fn(), cancel: vi.fn() }
    const engine = vi.fn(() => session)
    const service = new VoiceService(engine)
    const owner = {},
      sibling = {}
    const run = service.start(owner, ID, vi.fn())
    expect(await service.start(sibling, 'other-session-12345', vi.fn())).toEqual({
      ok: false,
      error: 'busy',
    })
    service.stop(sibling, ID)
    service.cancel(sibling, ID)
    service.stop(owner, 'wrong')
    expect(session.stop).not.toHaveBeenCalled()
    expect(session.cancel).not.toHaveBeenCalled()
    service.stop(owner, ID)
    expect(session.stop).toHaveBeenCalledOnce()
    service.cancel(owner, ID)
    expect(session.cancel).toHaveBeenCalledOnce()
    expect(await service.start(owner, ID, vi.fn())).toEqual({ ok: false, error: 'busy' })
    pending.resolve({ ok: false, error: 'cancelled' })
    await run
    await service.start(owner, ID, vi.fn())
    expect(engine).toHaveBeenCalledTimes(2)
  })
  it('rejects invalid ids before launching and turns launch errors into a plain result', async () => {
    const engine = vi.fn(() => {
      throw Error('private framework detail')
    })
    const service = new VoiceService(engine)
    expect(await service.start({}, '../outside', vi.fn())).toEqual({ ok: false, error: 'protocol' })
    expect(engine).not.toHaveBeenCalled()
    expect(await service.start({}, ID, vi.fn())).toEqual({ ok: false, error: 'unavailable' })
    expect(isVoiceId({})).toBe(false)
  })
})

describe('the native pipe', () => {
  it('inserts only a final result after the child closes and sends Stop on its own pipe', async () => {
    const { child, session, frame, states } = fakeChild()
    let settled = false
    void session.result.then(() => {
      settled = true
    })
    frame({ state: 'permission' })
    frame({ state: 'listening' })
    session.stop()
    expect(child.stdin.read().toString()).toBe('stop\n')
    frame({ state: 'transcribing' })
    frame({ text: 'Purple robot.' })
    await Promise.resolve()
    expect(settled).toBe(false)
    child.emit('close', 0)
    expect(await session.result).toEqual({ ok: true, text: 'Purple robot.' })
    expect(states.mock.calls.map(([phase]) => phase)).toEqual([
      'permission',
      'listening',
      'transcribing',
    ])
  })
  it.each(['microphone', 'speech', 'local', 'empty', 'recognition'] as const)(
    'keeps %s refusal plain',
    async (error) => {
      const { child, session, frame } = fakeChild()
      frame({ error })
      child.emit('close', 0)
      expect(await session.result).toEqual({ ok: false, error })
    },
  )
  it('discards a late final after cancel and keeps ownership until close', async () => {
    vi.useFakeTimers()
    const { child, session, frame } = fakeChild()
    frame({ state: 'permission' })
    session.cancel()
    frame({ state: 'listening' })
    frame({ text: 'must be discarded' })
    await vi.advanceTimersByTimeAsync(500)
    expect(child.kill).toHaveBeenCalledWith('SIGKILL')
    child.emit('close', null)
    expect(await session.result).toEqual({ ok: false, error: 'cancelled' })
  })
  it.each(['not json\n', JSON.stringify({ text: 'premature' }) + '\n', 'x'.repeat(32769)])(
    'rejects malformed or oversized data',
    async (payload) => {
      const { child, session } = fakeChild()
      child.stdout.write(payload)
      child.emit('close', null)
      expect(await session.result).toEqual({ ok: false, error: 'protocol' })
    },
  )
  it('bounds diagnostics without exposing them', async () => {
    const { child, session } = fakeChild()
    child.stderr.write('x'.repeat(32769))
    child.emit('close', null)
    expect(await session.result).toEqual({ ok: false, error: 'protocol' })
  })
  it('bounds permission wait and finalization independently', async () => {
    vi.useFakeTimers()
    for (const [phases, duration] of [
      [[], 120000],
      [['permission', 'listening', 'transcribing'], 15000],
    ] as const) {
      const { child, session, frame } = fakeChild()
      for (const state of phases) frame({ state })
      await vi.advanceTimersByTimeAsync(duration)
      expect(child.kill).toHaveBeenCalledWith('SIGTERM')
      child.emit('close', null)
      expect(await session.result).toEqual({ ok: false, error: 'timeout' })
    }
  })
  it('keeps a whole transcript however the helper exits afterwards', async () => {
    const { child, session, frame } = fakeChild()
    frame({ state: 'listening' })
    frame({ text: 'Purple robot.' })
    child.emit('close', 1)
    expect(await session.result).toEqual({ ok: true, text: 'Purple robot.' })
  })
  it('keeps the transcript when the helper is slow to exit, and stops the helper', async () => {
    vi.useFakeTimers()
    const { child, session, frame } = fakeChild()
    frame({ state: 'listening' })
    frame({ text: 'Purple robot.' })
    await vi.advanceTimersByTimeAsync(1_500)
    expect(child.kill).toHaveBeenCalledWith('SIGTERM')
    expect(child.kill).toHaveBeenCalledWith('SIGKILL')
    child.emit('close', null)
    expect(await session.result).toEqual({ ok: true, text: 'Purple robot.' })
  })
})

it('preserves draft whitespace and appends reviewed dictation', () => {
  expect(appendDictation('  Keep this', ' purple robot ')).toBe('  Keep this purple robot')
  expect(appendDictation('A\n', 'B')).toBe('A\nB')
  expect(appendDictation('A', ' ')).toBe('A')
})

it('runs an owned fake engine against the fictional WAV through the real child pipe', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'brocrew-voice-fake-'))
  const binary = join(directory, 'fake-voice')
  const fixture = fileURLToPath(new URL('./fixtures/voice/fictional.wav', import.meta.url))
  writeFileSync(
    binary,
    `#!${process.execPath}\nconst fs = require('node:fs');
const wave = fs.readFileSync(${JSON.stringify(fixture)});
if (wave.toString('ascii', 0, 4) !== 'RIFF' || wave.toString('ascii', 8, 12) !== 'WAVE') process.exit(1);
process.stdout.write('{"state":"permission"}\\n{"state":"listening"}\\n');
process.stdin.once('data', () => { process.stdout.write('{"state":"transcribing"}\\n{"text":"The purple robot counts seven paper stars."}\\n', () => process.exit(0)); });
`,
  )
  let session!: VoiceSession
  try {
    session = runVoiceHelper(
      binary,
      (state) => {
        if (state === 'listening') session.stop()
      },
      () => spawn(process.execPath, [binary], { stdio: ['pipe', 'pipe', 'pipe'] }),
    )
    expect(await session.result).toEqual({
      ok: true,
      text: 'The purple robot counts seven paper stars.',
    })
  } finally {
    session?.cancel()
    rmSync(directory, { recursive: true, force: true })
  }
})
