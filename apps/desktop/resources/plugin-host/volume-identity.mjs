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
  // Foundation resolves the path's actual volume (including Data-volume firmlinks).
  // Fresh NSURL/process each time: no cached resource value survives an observation.
  // Only Foundation is used; no application/AppleEvents access. The path is argv data.
  const script =
    'ObjC.import("Foundation"); function run(argv) { var value = Ref(); ' +
    'if (argv.length !== 1 || !$.NSURL.fileURLWithPath(argv[0]).getResourceValueForKeyError(' +
    'value, $.NSURLVolumeUUIDStringKey, null)) throw Error("unavailable"); ' +
    'return ObjC.unwrap(value[0]); }'
  let value
  try {
    value = read('/usr/bin/osascript', ['-l', 'JavaScript', '-e', script, '--', file]).trim()
  } catch {
    throw new Error('Volume identity unavailable')
  }
  if (!uuid.test(value) || !/[1-9a-f]/i.test(value.replace(/-/g, '')))
    throw new Error('Volume identity unavailable')
  return `apfs:${value.toLowerCase()}`
}
