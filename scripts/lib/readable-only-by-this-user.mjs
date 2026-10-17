// Who can open a file or folder, as each system keeps it: a mode on macOS and Linux, and on Windows,
// whose modes are only a read-only flag, the access list, by the accounts' SIDs.
import { execFileSync } from 'node:child_process'
import { statSync } from 'node:fs'

/** The accounts a Windows file may grant besides its owner: the system itself and administrators. */
export const THE_COMPUTER_ITSELF = ['S-1-5-18', 'S-1-5-32-544']

/**
 * Prints this process's own account and every account `path`'s access list allows anything, by
 * SID and name, as JSON. The path comes in through the environment, never inside the command.
 */
const ACCESS_COMMAND =
  '$me = [System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value; ' +
  '$allowed = @((Get-Acl -LiteralPath $env:BROBOT_ACCESS_OF).Access | ' +
  "Where-Object { $_.AccessControlType -eq 'Allow' } | ForEach-Object { " +
  '@{ sid = $_.IdentityReference.Translate([System.Security.Principal.SecurityIdentifier]).Value; ' +
  'name = $_.IdentityReference.Value } }); ' +
  '@{ me = $me; allowed = $allowed } | ConvertTo-Json -Compress -Depth 3'

/** This account's SID and the accounts `path`'s access list allows, read through PowerShell. */
export function windowsAccessOf(path) {
  const json = execFileSync(
    'powershell.exe',
    ['-NoProfile', '-NonInteractive', '-Command', ACCESS_COMMAND],
    {
      encoding: 'utf8',
      windowsHide: true,
      env: { ...process.env, BROBOT_ACCESS_OF: path },
    },
  )
  const read = JSON.parse(json)
  const allowed = Array.isArray(read.allowed) ? read.allowed : read.allowed ? [read.allowed] : []
  return {
    me: String(read.me),
    allowed: allowed.map((one) => ({ sid: String(one.sid), name: String(one.name) })),
  }
}

/**
 * The accounts in `access` other than this one, the system and administrators, compared by SID:
 * an account on another machine or domain with the same user name is another account.
 */
export function othersAllowed(access) {
  return access.allowed
    .filter((one) => one.sid !== access.me && !THE_COMPUTER_ITSELF.includes(one.sid))
    .map((one) => `${one.name} (${one.sid})`)
}

/**
 * Who besides this user can open `path`: on Windows the accounts its access list allows other than
 * this one, the system and administrators (the same reach root has over a 0600 file); elsewhere the
 * mode itself, against the owner-only `mode` expected. `[]` means only this user.
 */
export function whoElseCanOpen(path, mode) {
  if (process.platform !== 'win32') {
    const actual = statSync(path).mode & 0o777
    return actual === mode ? [] : [`mode ${actual.toString(8)}, not ${mode.toString(8)}`]
  }
  const access = windowsAccessOf(path)
  if (!access.allowed.some((one) => one.sid === access.me)) {
    return [`no entry for this account (${access.me})`]
  }
  return othersAllowed(access)
}
