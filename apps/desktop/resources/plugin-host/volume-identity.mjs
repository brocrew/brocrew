import { execFileSync } from 'node:child_process'

const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i
/** stat.dev is a mount assignment on macOS; on Windows libuv reports the formatted volume
 * serial (VolumeSerialNumber.LowPart). Never treat a changed Windows serial as renumbering.
 * This reader is also kept in the independently exported Chrome package. */
export function readVolumeIdentity(file, device, options = {}) {
  const platform = options.platform ?? process.platform
  if (platform === 'win32') {
    if (!/^[1-9][0-9]*$/.test(device) || BigInt(device) > 4294967295n)
      throw new Error('Volume identity unavailable')
    return `winvol:${device}`
  }
  if (platform !== 'darwin') return undefined
  const read =
    options.read ??
    ((program, args) =>
      execFileSync(program, args, {
        encoding: 'utf8',
        timeout: 2000,
        maxBuffer: 64 * 1024,
        env: { ...process.env, LC_ALL: 'C', LANG: 'C' },
        stdio: ['ignore', 'pipe', 'pipe'],
      }))
  const observe = (program, args) => {
    try {
      return read(program, args)
    } catch {
      throw new Error('Volume identity unavailable')
    }
  }
  // diskutil accepts a device or mount point, not an arbitrary directory. df resolves
  // firmlinks as well (e.g. /Users lives on the Data volume, not the sealed root volume).
  const rows = observe('/bin/df', ['-P', file]).trim().split(/\r?\n/)
  const disk = rows.length === 2 && /^(\/dev\/disk[0-9]+(?:s[0-9]+)+)\s/.exec(rows[1] ?? '')?.[1]
  if (!disk) throw new Error('Volume identity unavailable')
  const plist = observe('/usr/sbin/diskutil', ['info', '-plist', disk])
  const matches = [...plist.matchAll(/<key>VolumeUUID<\/key>\s*<string>([^<]+)<\/string>/g)]
  const value = matches.length === 1 ? (matches[0]?.[1] ?? '') : ''
  if (!uuid.test(value) || !/[1-9a-f]/i.test(value.replace(/-/g, '')))
    throw new Error('Volume identity unavailable')
  return `apfs:${value.toLowerCase()}`
}
