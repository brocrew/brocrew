import { execFile } from 'node:child_process'
import { PS_MAX_BUFFER_BYTES } from '../../src/main/process-tree'
import {
  listProcesses,
  parseWindowsListing,
  WINDOWS_LISTING,
  type ListedProcess,
} from '../../src/main/runtime/process-listing'

export async function listProcessesSmoke(
  platform: NodeJS.Platform = process.platform,
): Promise<readonly ListedProcess[]> {
  if (platform !== 'win32') return listProcesses(platform)
  // This checks CIM availability; a shared runner may start PowerShell slowly.
  const output = await new Promise<string>((resolve, reject) => {
    execFile(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-Command', WINDOWS_LISTING],
      { timeout: 60_000, maxBuffer: PS_MAX_BUFFER_BYTES, encoding: 'utf8', windowsHide: true },
      (error, stdout) => (error ? reject(error) : resolve(stdout)),
    )
  })
  return parseWindowsListing(output)
}
