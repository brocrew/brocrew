import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { powershellPath } from './process-groups.mjs'

const run = promisify(execFile)
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i
const uint64 = /^(0|[1-9][0-9]{0,19})$/
export function bootWitness(value) {
  if (!value || typeof value !== 'object' || typeof value.value !== 'string') return null
  if (
    value.kind === 'darwin-boot-session-v1' &&
    uuid.test(value.value) &&
    /[1-9a-f]/i.test(value.value)
  )
    return { kind: value.kind, value: value.value.toLowerCase() }
  if (
    value.kind === 'windows-tick64-v1' &&
    uint64.test(value.value) &&
    BigInt(value.value) <= 18446744073709551615n
  )
    return { kind: value.kind, value: value.value }
  return null
}
export function laterBoot(before, after) {
  before = bootWitness(before)
  after = bootWitness(after)
  if (!before || !after || before.kind !== after.kind) return false
  return before.kind === 'darwin-boot-session-v1'
    ? before.value !== after.value
    : BigInt(after.value) < BigInt(before.value)
}
/** Native boot evidence only. Calendar time and process uptime are never substitutes. */
export async function readBootWitness(options = {}) {
  const platform = options.platform ?? process.platform
  const read =
    options.read ??
    (async (file, args) =>
      (
        await run(file, args, {
          timeout: 10_000,
          maxBuffer: 4096,
          windowsHide: true,
          encoding: 'utf8',
        })
      ).stdout)
  try {
    if (platform === 'darwin') {
      const value = await read('/usr/sbin/sysctl', ['-n', 'kern.bootsessionuuid'])
      return bootWitness({ kind: 'darwin-boot-session-v1', value: value.trim() })
    }
    if (platform === 'win32') {
      const program = powershellPath()
      if (!program) return null
      const command = `Add-Type -TypeDefinition 'using System; using System.Runtime.InteropServices; public static class BroCrewBootWitness { [DllImport("kernel32.dll")] public static extern UInt64 GetTickCount64(); }'; [Console]::Out.WriteLine([BroCrewBootWitness]::GetTickCount64().ToString([Globalization.CultureInfo]::InvariantCulture))`
      const value = await read(program, [
        '-NoLogo',
        '-NoProfile',
        '-NonInteractive',
        '-EncodedCommand',
        Buffer.from(command, 'utf16le').toString('base64'),
      ])
      return bootWitness({ kind: 'windows-tick64-v1', value: value.trim() })
    }
  } catch {
    // Unavailable or unparseable native evidence keeps recovery refused.
  }
  return null
}
