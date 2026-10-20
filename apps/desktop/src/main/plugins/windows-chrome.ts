import { lstatSync, realpathSync } from 'node:fs'
import { win32 } from 'node:path'
import { isLocalDrivePath } from './private-files'

/**
 * Google Chrome's own executable on Windows, where its installers put it: for every user under
 * Program Files (64-bit, then 32-bit), or for this user under LocalAppData. Found once by the app,
 * from its own environment, and handed to the plugin, whose environment names none of these
 * folders; never looked up by name on a PATH. A candidate counts only as a drive-letter path whose
 * file is no link and whose real path, long names and all, is the one asked for. Null when Chrome
 * is not installed in any of them.
 */
export function installedChromeOnWindows(
  from: NodeJS.ProcessEnv = process.env,
  disk: { lstat: typeof lstatSync; realpath: (path: string) => string } = {
    lstat: lstatSync,
    realpath: realpathSync.native,
  },
): string | null {
  const roots = [from['ProgramW6432'] ?? from['ProgramFiles'], from['ProgramFiles(x86)']]
    .filter((root): root is string => typeof root === 'string')
    .map((root) => win32.join(root, 'Google', 'Chrome', 'Application', 'chrome.exe'))
  const local = from['LOCALAPPDATA']
  if (local) roots.push(win32.join(local, 'Google', 'Chrome', 'Application', 'chrome.exe'))
  for (const candidate of roots) {
    if (!win32.isAbsolute(candidate) || !isLocalDrivePath(candidate, 'win32')) continue
    try {
      const stat = disk.lstat(candidate)
      if (!stat.isFile() || stat.isSymbolicLink()) continue
      const real = disk.realpath(candidate)
      if (real.toLowerCase() === candidate.toLowerCase()) return real
    } catch {
      /* Not installed here. */
    }
  }
  return null
}
