import { afterEach, expect, it, vi } from 'vitest'
import { recoverWindowsJob } from '../resources/plugin-host/windows-job.mjs'

const native = vi.hoisted(() => ({
  error: null as Error | null,
  stdout: 'gone\n',
  stderr: '',
  exec: vi.fn(),
}))
vi.mock('node:child_process', async (original) => ({
  ...(await original<typeof import('node:child_process')>()),
  execFile: (
    program: string,
    args: string[],
    options: unknown,
    callback: (error: Error | null, stdout: string, stderr: string) => void,
  ) => {
    native.exec(program, args, options)
    callback(native.error, native.stdout, native.stderr)
  },
}))
afterEach(() => {
  vi.unstubAllEnvs()
  native.error = null
  native.stdout = 'gone\n'
  native.stderr = ''
  native.exec.mockClear()
})

it.each(['gone', 'alive', 'stderr', 'exit'])(
  'accepts only a successful empty-job observation: %s',
  async (result) => {
    vi.stubEnv('SystemRoot', 'C:\\Windows')
    if (result === 'alive') native.stdout = 'failed\n'
    if (result === 'stderr') native.stderr = 'Fictional native failure'
    if (result === 'exit') native.error = new Error('Fictional native nonzero exit')
    const name = 'Local\\BroCrew.Plugin.11111111-1111-4111-8111-111111111111'
    expect(await recoverWindowsJob(name, '/fictional/keeper')).toBe(result === 'gone')
    const [, args, options] = native.exec.mock.calls[0] as [
      string,
      string[],
      { env: Record<string, string> },
    ]
    const script = Buffer.from(args.at(-1)!, 'base64').toString('utf16le')
    expect(script).toContain('OpenJobObjectW')
    expect(options.env.BROCREW_PLUGIN_JOB_NAME).toBe(name)
    expect(options.env.BROCREW_PLUGIN_JOB_RECOVER).toBe('1')
  },
)
