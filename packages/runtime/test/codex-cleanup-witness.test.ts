import { afterEach, expect, it, vi } from 'vitest'
import { SpawnCodexTransport } from '../src/codex/codex-transport'

const peers = vi.hoisted(() => ({
  children: [] as { emit(event: string): boolean }[],
  treeQuiet: false,
}))
vi.mock('node:child_process', async () => {
  const { EventEmitter } = await import('node:events')
  const { PassThrough } = await import('node:stream')
  return {
    spawn: vi.fn(() => {
      const child = Object.assign(new EventEmitter(), {
        pid: 4811,
        stdin: new PassThrough(),
        stdout: new PassThrough(),
        stderr: new PassThrough(),
        kill: vi.fn(),
      })
      peers.children.push(child)
      return child
    }),
  }
})
vi.mock('../src/codex/windows-tree', async (original) => ({
  ...(await original<typeof import('../src/codex/windows-tree')>()),
  endTree: vi.fn(async () => peers.treeQuiet),
}))
afterEach(() => {
  vi.restoreAllMocks()
  vi.useRealTimers()
  peers.children.length = 0
})
it.skipIf(process.platform === 'win32')(
  'leader exit and a close deadline do not prove a busy group has quiesced',
  async () => {
    vi.useFakeTimers()
    let quiet = false
    const kill = vi.spyOn(process, 'kill').mockImplementation((pid, signal) => {
      if (pid === -4811 && signal === 0 && quiet)
        throw Object.assign(new Error('fictional gone'), { code: 'ESRCH' })
      return true
    })
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const transport = new SpawnCodexTransport('fictional-program', [], {
      env: {},
      exitGraceMs: 1,
      killGraceMs: 1,
    })
    expect(transport.quiesced).toBeDefined()
    let proved = false
    void transport.quiesced.then(() => {
      proved = true
    })
    peers.children[0]!.emit('exit')
    const closing = transport.close()
    await vi.advanceTimersByTimeAsync(100)
    await closing
    await transport.exited
    expect(proved).toBe(false)
    const signals = kill.mock.calls.filter(([, signal]) => signal !== 0).length
    quiet = true
    await vi.advanceTimersByTimeAsync(1100)
    await transport.quiesced
    expect(proved).toBe(true)
    expect(kill.mock.calls.filter(([, signal]) => signal !== 0)).toHaveLength(signals)
  },
)
it.skipIf(process.platform === 'win32')(
  'an unknown group reading cannot be promoted to proof',
  async () => {
    vi.useFakeTimers()
    let error = 'EINVAL'
    vi.spyOn(process, 'kill').mockImplementation(() => {
      throw Object.assign(new Error('fictional kernel reading'), { code: error })
    })
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const transport = new SpawnCodexTransport('fictional-program', [], {
      env: {},
      exitGraceMs: 1,
      killGraceMs: 1,
    })
    expect(transport.quiesced).toBeDefined()
    let proved = false
    void transport.quiesced.then(() => {
      proved = true
    })
    peers.children[0]!.emit('exit')
    const closing = transport.close()
    await vi.advanceTimersByTimeAsync(100)
    await closing
    expect(proved).toBe(false)
    error = 'ESRCH'
    await vi.advanceTimersByTimeAsync(1100)
    await transport.quiesced
  },
)
it.skipIf(process.platform !== 'win32')(
  'the Windows transport keeps an unknown tree cleanup unproved',
  async () => {
    peers.treeQuiet = false
    const transport = new SpawnCodexTransport('fictional-program', [], {
      env: {},
      exitGraceMs: 1,
      killGraceMs: 1,
    })
    expect(transport.quiesced).toBeDefined()
    let proved = false
    void transport.quiesced.then(() => {
      proved = true
    })
    peers.children[0]!.emit('exit')
    await transport.close()
    expect(proved).toBe(false)
  },
)
it.skipIf(process.platform !== 'win32')(
  'the Windows transport publishes positive tree cleanup',
  async () => {
    peers.treeQuiet = true
    const transport = new SpawnCodexTransport('fictional-program', [], {
      env: {},
      exitGraceMs: 1,
      killGraceMs: 1,
    })
    peers.children[0]!.emit('exit')
    await transport.close()
    await transport.quiesced
  },
)
