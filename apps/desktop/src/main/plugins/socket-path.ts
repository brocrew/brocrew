import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdirSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, isAbsolute, join } from 'node:path'

/** The longest socket file path accepted; macOS allows 103 bytes. */
export const SOCKET_PATH_BYTES = 100

const fits = (path: string) => Buffer.byteLength(path) <= SOCKET_PATH_BYTES
const underRoot = (root: string) => [
  join(root, 'supervisor', 'owner.sock'),
  join(root, 'person-control', 'person.sock'),
]

/** macOS's own layout for a user's temp folder: /var/folders/<two>/<unique>/T. */
const MACOS_TEMP_FOLDER = /^(\/private)?\/var\/folders\/[^/]+\/[^/]+\/T$/

/**
 * What the process already knows: macOS passes each app its temp folder as TMPDIR, beside the
 * user's cache folder (C). It counts only for macOS's own layout, so a custom TMPDIR never
 * stands in for the folder macOS names, and only if C is there.
 */
function cacheBesideTemp(): string | undefined {
  const temp = tmpdir().replace(/\/$/, '')
  if (!MACOS_TEMP_FOLDER.test(temp)) return undefined
  const folder = join(dirname(temp), 'C')
  try {
    return statSync(folder).isDirectory() ? folder : undefined
  } catch {
    return undefined
  }
}

/** Where this process found out, once: a failed or slow answer is remembered too. */
let userCache: { folder: string | undefined } | undefined
/**
 * The user's cache folder: private to the user, short, not cleared by age and the same in every
 * process. It comes from what the process already has, and only otherwise from macOS itself, with
 * one bounded wait for the whole process. No answer means no short folder: the socket stays under
 * the root and the refusal says the path is too long.
 */
function darwinUserCache(): string | undefined {
  // /private/var and /var are one folder; the short spelling keeps the socket paths within the limit.
  userCache ??= { folder: (cacheBesideTemp() ?? askMacOs())?.replace(/^\/private(?=\/var\/)/, '') }
  return userCache.folder
}
function askMacOs(): string | undefined {
  try {
    const folder = execFileSync('/usr/bin/getconf', ['DARWIN_USER_CACHE_DIR'], {
      encoding: 'utf8',
      timeout: 1000,
    }).trim()
    return isAbsolute(folder) ? folder : undefined
  } catch {
    return undefined
  }
}

/** Whether both plugin sockets for this root have a place on this computer. */
export function pluginSocketsPlaceable(
  root: string,
  platform: NodeJS.Platform = process.platform,
  cache: () => string | undefined = darwinUserCache,
): boolean {
  return underRoot(root).every(fits) || (platform === 'darwin' && cache() !== undefined)
}

/**
 * Where one of the plugin service's socket files lives: under the plugin root when that path
 * fits, as every version expects, otherwise in a folder for this root in the user's cache folder,
 * so a long home path still works. The app and the service both derive it from the root alone.
 */
export function pluginSocketPath(
  root: string,
  folder: 'supervisor' | 'person-control',
  name: 'owner.sock' | 'person.sock',
  platform: NodeJS.Platform = process.platform,
  cache: () => string | undefined = darwinUserCache,
): string {
  const usual = join(root, folder, name)
  const short = platform === 'darwin' && !fits(usual) ? cache() : undefined
  if (!short) return usual
  const id = createHash('sha256').update(root).digest('hex').slice(0, 16)
  return join(short, `brocrew-plugins-${id}`, name)
}

/** Creates the short socket folder when the socket is not under the root; its parent is private. */
export function ensureSocketFolder(root: string, socket: string): void {
  const folder = dirname(socket)
  if (dirname(folder) === root) return
  try {
    mkdirSync(folder, { mode: 0o700 })
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
  }
}
