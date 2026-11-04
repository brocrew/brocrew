import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { readVolumeIdentity as host } from '../resources/plugin-host/volume-identity.mjs'
import { readVolumeIdentity as chrome } from '../../../plugins/chrome/src/profiles/volumeIdentity'

describe.each([
  ['supervisor', host],
  ['standalone Chrome', chrome],
] as const)('%s native volume identity', (_name, readVolume) => {
  const volume = 'ABCDEF12-1111-4111-8111-111111111111'
  it('reads the persistent Foundation UUID with the path passed only as an argument', () => {
    const read = vi.fn(() => volume + '\n')
    const file = `/fictional/a folder'; throw Error("injected")`
    expect(readVolume(file, '17', { platform: 'darwin', read })).toBe(
      `apfs:${volume.toLowerCase()}`,
    )
    expect(read).toHaveBeenCalledTimes(1)
    const [program, args] = read.mock.calls[0] as unknown as [string, string[]]
    expect(program).toBe('/usr/bin/osascript')
    expect(args.slice(0, 3)).toEqual(['-l', 'JavaScript', '-e'])
    expect(args.slice(-2)).toEqual(['--', file])
    expect(args[3]).toContain('NSURLVolumeUUIDStringKey')
    expect(args[3]).not.toContain(file)
  })
  it.each([
    '',
    'undefined',
    'invalid',
    '00000000-0000-0000-0000-000000000000',
    `${volume}\n${volume}`,
    `<key>VolumeUUID</key><string>${volume}</string>`,
  ])('refuses absent or ambiguous native UUID evidence %j', (value) => {
    expect(() => readVolume('/fictional', '17', { platform: 'darwin', read: () => value })).toThrow(
      'Volume identity unavailable',
    )
  })
  it('keeps Windows volume serials stable across boots, while a different serial is a different volume', () => {
    const read = vi.fn(() => {
      throw new Error('must not launch a command')
    })
    expect(readVolume('C:\\fictional', '4294967295', { platform: 'win32', read })).toBe(
      'winvol:4294967295',
    )
    expect(readVolume('C:\\fictional', '4294967295', { platform: 'win32', read })).toBe(
      'winvol:4294967295',
    )
    expect(readVolume('C:\\fictional', '123', { platform: 'win32', read })).toBe('winvol:123')
    expect(read).not.toHaveBeenCalled()
    for (const serial of ['0', '-1', '4294967296', '01', 'unknown'])
      expect(() => readVolume('C:\\fictional', serial, { platform: 'win32', read })).toThrow()
  })
  it('does not claim a persistent identity on an unqualified platform', () => {
    expect(readVolume('/fictional', '17', { platform: 'linux' })).toBeUndefined()
  })
  it('keeps native failure text and file paths out of the error', () => {
    const read = () => {
      throw new Error('fictional private native output')
    }
    expect(() =>
      readVolume('/fictional/private-folder', '17', { platform: 'darwin', read }),
    ).toThrowError(new Error('Volume identity unavailable'))
  })
})

it.skipIf(process.platform !== 'darwin')(
  'reads the real persistent UUID on a new macOS directory without app automation',
  () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'fictional-native-volume-'))
    try {
      const device = String(fs.statSync(root).dev)
      const volume = host(root, device)
      expect(volume).toMatch(/^apfs:[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/)
      expect(chrome(root, device)).toBe(volume)
    } finally {
      fs.rmSync(root, { recursive: true, force: true })
    }
  },
)
