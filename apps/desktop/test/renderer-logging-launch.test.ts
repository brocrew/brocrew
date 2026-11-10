import { spawnSync } from 'node:child_process'
import { afterEach, expect, it, vi } from 'vitest'
import { rendererLoggingProbe } from '../scripts/renderer-logging-probe.mjs'

vi.mock('electron', () => ({ default: 'fictional-electron' }))
vi.mock('esbuild', () => ({ build: vi.fn().mockResolvedValue(undefined) }))
vi.mock('node:child_process', () => ({
  spawnSync: vi.fn(() => ({ status: 0, stdout: '', stderr: '' })),
}))

const exitCode = process.exitCode

afterEach(() => {
  vi.unstubAllEnvs()
  vi.clearAllMocks()
  process.exitCode = exitCode
})

it.each([undefined, '', '1'])(
  'launches Electron with run-as-Node truly absent when inherited value is %s',
  async (value) => {
    vi.stubEnv('ELECTRON_RUN_AS_NODE', value)
    vi.stubEnv('BROCREW_LOG_PROBE_TEST', 'fictional inherited setting')
    vi.stubEnv('DISPLAY', 'fictional-display')
    await rendererLoggingProbe(['--brobot-hidden'])
    const [executable, , options] = vi.mocked(spawnSync).mock.calls[0]!
    expect(executable).toBe('fictional-electron')
    expect(options!.env).not.toHaveProperty('ELECTRON_RUN_AS_NODE')
    expect(options!.env!.BROCREW_LOG_PROBE_TEST).toBe('fictional inherited setting')
    expect(process.env.ELECTRON_RUN_AS_NODE).toBe(value)
    expect(process.env.BROCREW_LOG_PROBE_TEST).toBe('fictional inherited setting')
  },
)
