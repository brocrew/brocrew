import os from 'node:os'
import { privateFolder } from '../../privatePaths.js'
import path from 'node:path'
export class LaunchGuardError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'LaunchGuardError'
  }
}
export function defaultChromeDirs(
  home = os.userInfo().homedir,
  platform: NodeJS.Platform = process.platform,
  env: NodeJS.ProcessEnv = process.env,
): string[] {
  if (platform === 'darwin')
    return ['Chrome', 'Chrome Beta', 'Chrome Canary', 'Chromium'].map((n) =>
      path.join(
        home,
        'Library',
        'Application Support',
        n === 'Chromium' ? 'Chromium' : `Google/${n}`,
      ),
    )
  if (platform === 'win32') {
    const roots = new Set([path.win32.join(home, 'AppData', 'Local'), env.LOCALAPPDATA])
    return [...roots]
      .filter((root): root is string => !!root)
      .flatMap((local) => [
        path.win32.join(local, 'Google', 'Chrome'),
        path.win32.join(local, 'Chromium'),
        path.win32.join(local, 'Microsoft', 'Edge'),
      ])
  }
  // The host intentionally rewrites HOME/XDG_CONFIG_HOME for the plugin. Those
  // values may add a configured root, but must never hide the person's real root.
  const roots = new Set([path.join(home, '.config'), env.XDG_CONFIG_HOME])
  return [...roots]
    .filter((root): root is string => !!root)
    .flatMap((root) =>
      ['google-chrome', 'google-chrome-beta', 'chromium', 'microsoft-edge'].map((n) =>
        path.join(root, n),
      ),
    )
}
const isAbsolute = (p: string): boolean => path.isAbsolute(p) || path.win32.isAbsolute(p)
function inside(child: string, parent: string): boolean {
  const norm = (p: string): string =>
    p
      .replace(/[\\/]+$/, '')
      .replace(/\\/g, '/')
      .toLowerCase()
  const c = norm(child)
  const d = norm(parent)
  return c === d || c.startsWith(`${d}/`)
}
export function assertOwnProfileDir(
  opts: {
    profileDir?: unknown
    ignoreAllDefaultArgs?: unknown
    ignoreDefaultArgs?: unknown
    args?: readonly string[]
  },
  dirs: string[] = defaultChromeDirs(),
): void {
  const dir = opts.profileDir
  if (typeof dir !== 'string' || dir.trim() === '')
    throw new LaunchGuardError('refusing to start Chrome: no profile directory was given')
  if (!isAbsolute(dir))
    throw new LaunchGuardError(
      'refusing to start Chrome: the profile directory must be an absolute path',
    )
  if (dirs.some((d) => inside(dir, d) || inside(d, dir)))
    throw new LaunchGuardError(
      "refusing to start Chrome: that is the normal Chrome's own profile directory",
    )
  privateFolder(path.dirname(dir), dir)
  const ignore = opts.ignoreDefaultArgs
  if (
    ignore === true ||
    (Array.isArray(ignore) &&
      ignore.some((a) => typeof a === 'string' && /^--user-data-dir/.test(a)))
  ) {
    throw new LaunchGuardError(
      'refusing to start Chrome: ignoreDefaultArgs would drop --user-data-dir (Chrome would open the normal profile)',
    )
  }
  const userDataArgs = (opts.args ?? []).filter((arg) => /^--user-data-dir/.test(arg))
  if (opts.ignoreAllDefaultArgs === true) {
    if (userDataArgs.length !== 1 || userDataArgs[0] !== `--user-data-dir=${dir}`)
      throw new LaunchGuardError('Plugin unavailable. Try again.')
    return
  }
  for (const a of opts.args ?? []) {
    if (/^--user-data-dir/.test(a))
      throw new LaunchGuardError(
        'refusing to start Chrome: --user-data-dir must come from profileDir only',
      )
  }
}
