import { afterEach, describe, expect, it, vi } from 'vitest'
import { bootWitness, laterBoot, readBootWitness } from '../resources/plugin-host/boot-witness.mjs'

describe('native boot witnesses', () => {
  afterEach(() => vi.unstubAllEnvs())
  it('reads the macOS boot-session property with the system executable', async () => {
    const read = vi.fn(async () => 'ABCDEFAB-1234-1234-1234-ABCDEFABCDEF\n')
    expect(await readBootWitness({ platform: 'darwin', read })).toEqual({
      kind: 'darwin-boot-session-v1',
      value: 'abcdefab-1234-1234-1234-abcdefabcdef',
    })
    expect(read).toHaveBeenCalledExactlyOnceWith('/usr/sbin/sysctl', ['-n', 'kern.bootsessionuuid'])
  })
  it('invokes exact native Windows UInt64 ticks without a floating-point conversion', async () => {
    vi.stubEnv('SystemRoot', 'C:\\Windows')
    const read = vi.fn(async () => '18446744073709551615\r\n')
    expect(await readBootWitness({ platform: 'win32', read })).toEqual({
      kind: 'windows-tick64-v1',
      value: '18446744073709551615',
    })
    const [program, args] = read.mock.calls[0] as unknown as [string, string[]]
    expect(program).toMatch(/powershell.exe$/)
    const command = Buffer.from(args.at(-1)!, 'base64').toString('utf16le')
    expect(command).toContain('kernel32.dll')
    expect(command).toContain('extern UInt64 GetTickCount64()')
    expect(command).not.toContain('Environment.TickCount')
  })
  it.each(['-1', '1.5', '01', '18446744073709551616', '1\n2'])(
    'refuses malformed Windows ticks %s',
    (value) => {
      expect(bootWitness({ kind: 'windows-tick64-v1', value })).toBeNull()
    },
  )
  it('keeps 32-bit wrap, sleep and later uptime from becoming a reboot', () => {
    const before = { kind: 'windows-tick64-v1', value: '4294967295' }
    expect(laterBoot(before, { ...before, value: '4294967296' })).toBe(false)
    expect(laterBoot(before, before)).toBe(false)
    expect(laterBoot(before, { ...before, value: '4000' })).toBe(true)
  })
  it('fails closed on reader errors and unsupported platforms', async () => {
    expect(
      await readBootWitness({
        platform: 'darwin',
        read: async () => {
          throw new Error('fictional denied')
        },
      }),
    ).toBeNull()
    expect(await readBootWitness({ platform: 'linux' })).toBeNull()
  })
  it.runIf(process.platform === 'darwin' || process.platform === 'win32')(
    'obtains two well-formed native same-boot observations',
    async () => {
      const a = await readBootWitness(),
        b = await readBootWitness()
      expect(a).not.toBeNull()
      expect(b).not.toBeNull()
      expect(laterBoot(a, b)).toBe(false)
    },
  )
  it.runIf(process.platform === 'win32')(
    'gets native Windows ticks with no error stream from a fresh PowerShell process',
    async () => {
      let diagnostic: { code: string | number | null; stderr: string } = {
        code: 'not-started',
        stderr: '',
      }
      const value = await readBootWitness({
        read: async (program, args) => {
          try {
            const result = await promisify(execFile)(program, args, {
              timeout: 10_000,
              maxBuffer: 4096,
              windowsHide: true,
              encoding: 'utf8',
            })
            diagnostic = { code: null, stderr: result.stderr }
            if (result.stderr.trim()) throw new Error('Unexpected native error stream')
            return result.stdout
          } catch (error) {
            const failure = error as NodeJS.ErrnoException & { stderr?: string }
            if (diagnostic.code === 'not-started')
              diagnostic = { code: failure.code ?? 'unknown', stderr: failure.stderr ?? '' }
            throw error
          }
        },
      })
      expect({ diagnostic, nativeWitness: value?.kind }).toEqual({
        diagnostic: { code: null, stderr: '' },
        nativeWitness: 'windows-tick64-v1',
      })
    },
  )
})
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
