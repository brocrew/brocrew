import { execFileSync } from 'node:child_process'

const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i
/** Kept local because Chrome is exported as a standalone package. The app's supervisor has
 * the same native reader in resources/plugin-host/volume-identity.mjs. */
export function readVolumeIdentity(
  file: string,
  device: string,
  options: {
    platform?: NodeJS.Platform
    read?(program: string, args: string[]): string
  } = {},
): string | undefined {
  const platform = options.platform ?? process.platform
  // libuv's Windows st_dev is VolumeSerialNumber.LowPart, assigned at format time.
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
  let value: string
  try {
    value = read('/usr/bin/osascript', ['-l', 'JavaScript', '-e', script, '--', file]).trim()
  } catch {
    throw new Error('Volume identity unavailable')
  }
  if (!uuid.test(value) || !/[1-9a-f]/i.test(value.replace(/-/g, '')))
    throw new Error('Volume identity unavailable')
  return `apfs:${value.toLowerCase()}`
}
