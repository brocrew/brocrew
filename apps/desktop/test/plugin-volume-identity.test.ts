import { describe, expect, it, vi } from 'vitest'
import { readVolumeIdentity as host } from '../resources/plugin-host/volume-identity.mjs'
import { readVolumeIdentity as chrome } from '../../../plugins/chrome/src/profiles/volumeIdentity'

describe.each([['supervisor', host], ['standalone Chrome', chrome]] as const)('%s native volume identity', (_name, readVolume) => {
  const volume = 'ABCDEF12-1111-4111-8111-111111111111'
  it('resolves a firmlink through its device and records only VolumeUUID', () => {
    const read = vi.fn((program: string) => program === '/bin/df'
      ? 'Filesystem 512-blocks Used Available Capacity Mounted on\n/dev/disk3s5 100 20 80 20% /System/Volumes/Data\n'
      : `<plist><dict><key>DiskUUID</key><string>other</string><key>VolumeUUID</key><string>${volume}</string></dict></plist>`)
    expect(readVolume('/fictional/a folder', '17', { platform: 'darwin', read })).toBe(`apfs:${volume.toLowerCase()}`)
    expect(read.mock.calls).toEqual([['/bin/df', ['-P', '/fictional/a folder']], ['/usr/sbin/diskutil', ['info', '-plist', '/dev/disk3s5']]])
  })
  it.each(['', '<key>DiskUUID</key><string>other</string>', '<key>VolumeUUID</key><string>invalid</string>', `<key>VolumeUUID</key><string>${volume}</string><key>VolumeUUID</key><string>${volume}</string>`])('refuses absent or ambiguous native UUID evidence %j', (plist) => {
    const read = (program: string) => program === '/bin/df' ? 'header\n/dev/disk3s5 100 20 80 20% /mount\n' : plist
    expect(() => readVolume('/fictional', '17', { platform: 'darwin', read })).toThrow('Volume identity unavailable')
  })
  it('keeps Windows volume serials stable across boots, while a different serial is a different volume', () => {
    const read = vi.fn(() => { throw new Error('must not launch a command') })
    expect(readVolume('C:\\fictional', '4294967295', { platform: 'win32', read })).toBe('winvol:4294967295')
    expect(readVolume('C:\\fictional', '4294967295', { platform: 'win32', read })).toBe('winvol:4294967295')
    expect(readVolume('C:\\fictional', '123', { platform: 'win32', read })).toBe('winvol:123')
    expect(read).not.toHaveBeenCalled()
    for (const serial of ['0', '-1', '4294967296', '01', 'unknown'])
      expect(() => readVolume('C:\\fictional', serial, { platform: 'win32', read })).toThrow()
  })
  it('does not claim a persistent identity on an unqualified platform', () => {
    expect(readVolume('/fictional', '17', { platform: 'linux' })).toBeUndefined()
  })
  it('keeps native failure text and file paths out of the error', () => {
    const read = () => { throw new Error('fictional private native output') }
    expect(() => readVolume('/fictional/private-folder', '17', { platform: 'darwin', read }))
      .toThrowError(new Error('Volume identity unavailable'))
  })
})
