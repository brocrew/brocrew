// Real isolated observer/sync handlers with fictional streams; no child or native process.
import fs from 'node:fs'
import { EventEmitter } from 'node:events'
import { Writable } from 'node:stream'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'
import {
  runNativeCases,
  NativeFatalError,
} from '../../plugins/chrome/test/native-focus-contract.ts'
const source = fs.readFileSync(new URL('../native/focus-check.ts', import.meta.url), 'utf8')
const start = source.indexOf("  let observerError = ''")
const end = source.indexOf('  await syncClock()', start)
const js = ts.transpileModule(source.slice(start, end), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
}).outputText
const make = new Function(
  'watcher',
  'performance',
  'randomUUID',
  'bounded',
  'assertRunning',
  'calibrations',
  'syncs',
  'console',
  'observerWarnings',
  'observerIO',
  js + ';return syncClock',
)
function fixture(code = 'EPIPE') {
  const watcher = new EventEmitter()
  watcher.stdout = new EventEmitter()
  watcher.stderr = new EventEmitter()
  watcher.stdin = new Writable({
    write(_chunk, _encoding, callback) {
      queueMicrotask(() =>
        callback(Object.assign(new Error('fictional observer pipe failed'), { code })),
      )
    },
  })
  const calibrations = [],
    observerWarnings = [],
    syncs = new Map(),
    observerIO = { syncAvailable: true, outputAvailable: true }
  let token = 0,
    locked = false
  const sync = make(
    watcher,
    { now: () => 10 },
    () => String(++token),
    async (work) => {
      let timer
      try {
        return await Promise.race([
          work,
          new Promise((_, reject) => {
            timer = setTimeout(() => reject(new Error('fictional sync timeout')), 25)
          }),
        ])
      } finally {
        clearTimeout(timer)
      }
    },
    () => {
      if (locked) throw new NativeFatalError('screen-lock', 'fixture locked')
    },
    calibrations,
    syncs,
    { warn() {} },
    observerWarnings,
    observerIO,
  )
  return {
    watcher,
    sync,
    calibrations,
    syncs,
    observerWarnings,
    observerIO,
    lock() {
      locked = true
    },
  }
}
describe('observer stream failures are diagnostic', () => {
  it.each(['EPIPE', 'ERR_STREAM_DESTROYED'])(
    'continues all four cases after %s without an uncaught stream error',
    async (code) => {
      const f = fixture(code)
      // Fail before emitting on an old unhandled stream, so RED never crashes the test runner.
      expect(f.watcher.stdin.listenerCount('error')).toBeGreaterThan(0)
      const calls = []
      await runNativeCases(
        4,
        async (index) => {
          await f.sync()
          calls.push(index)
          return 'failed'
        },
        async () => 'unavailable',
      )
      expect(calls).toEqual([0, 1, 2, 3])
      expect(f.syncs.size).toBe(0)
      expect(f.calibrations).toHaveLength(4)
      expect(f.observerWarnings.length).toBeGreaterThan(0)
    },
  )
  it('settles every outstanding sync and marks broken stdout unavailable', async () => {
    const f = fixture()
    expect(f.watcher.stdin.listenerCount('error')).toBeGreaterThan(0)
    const pending = [f.sync(), f.sync()]
    f.watcher.stdout.emit('error', new Error('fictional read failure'))
    await Promise.all(pending)
    expect(f.syncs.size).toBe(0)
    expect(f.observerIO.outputAvailable).toBe(false)
  })
  it('handles parent exit and closed input diagnostically', async () => {
    const f = fixture()
    expect(f.watcher.stdin.listenerCount('error')).toBeGreaterThan(0)
    f.watcher.emit('exit', 0, null)
    f.watcher.stdin.emit('close')
    await f.sync()
    expect(f.syncs.size).toBe(0)
    expect(f.observerIO.syncAvailable).toBe(false)
    expect(f.observerIO.outputAvailable).toBe(false)
  })
  it('still propagates screen lock when stream failure is diagnosed', async () => {
    const f = fixture()
    expect(f.watcher.stdin.listenerCount('error')).toBeGreaterThan(0)
    f.lock()
    await expect(f.sync()).rejects.toBeInstanceOf(NativeFatalError)
    expect(f.syncs.size).toBe(0)
  })
})
