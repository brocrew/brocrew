import fs from 'node:fs'
import path from 'node:path'
import { browserEnvironment } from './browser-environment.js'

export function chromeExecutable(
  env: NodeJS.ProcessEnv,
  platform: NodeJS.Platform = process.platform,
): string | undefined {
  if (env.BROCREW_CHROME_EXECUTABLE || platform !== 'win32') return env.BROCREW_CHROME_EXECUTABLE
  const account = browserEnvironment(env, platform)
  const drive = env.SystemDrive ?? path.win32.parse(account.HOME!).root
  const roots = [
    env.ProgramW6432 ?? env.ProgramFiles ?? path.win32.join(drive, 'Program Files'),
    env['ProgramFiles(x86)'] ?? path.win32.join(drive, 'Program Files (x86)'),
    account.LOCALAPPDATA!,
  ]
  for (const root of roots) {
    const candidate = path.win32.join(root, 'Google', 'Chrome', 'Application', 'chrome.exe')
    try {
      if (fs.statSync(candidate).isFile()) return candidate
    } catch {
      // Try the next installation location.
    }
  }
  return undefined
}
