import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { Readable } from 'node:stream'
export class LocalFileGuardError extends Error {}
export interface LocalFileGuardConfig {
  roots: string[]
  hostHome: string
  mount: string
  maxBytes: number
  beforeOpen?: () => void
  platform?: NodeJS.Platform
  fs?: GuardFs
}
export type GuardFs = Pick<
  typeof fs,
  | 'lstatSync'
  | 'fstatSync'
  | 'statSync'
  | 'openSync'
  | 'closeSync'
  | 'readSync'
  | 'read'
  | 'readlinkSync'
  | 'constants'
> & {
  realpathSync: Pick<typeof fs.realpathSync, 'native'> & ((p: string) => string)
}
export interface GuardedFile {
  fd: number
  size: number
  name: string
  extension: string
  realPath: string
  stream(): Readable
  readAll(): Buffer
  close(): void
}
export const DEFAULT_ROOTS = []
export const FALLBACK_ROOTS = []
export const DEFAULT_MAX_BYTES = 50 * 1024 * 1024
type PathApi = typeof path.posix
const pathFor = (platform: NodeJS.Platform): PathApi =>
  platform === 'win32' ? path.win32 : path.posix
const same = (a: string, b: string, win: boolean): boolean =>
  win ? a.toLowerCase() === b.toLowerCase() : a === b
function below(child: string, parent: string, sep: string, win: boolean): string | null {
  const n = parent.length
  if (child.length <= n || !same(child.slice(0, n), parent, win) || child[n] !== sep) return null
  return child.slice(n + 1)
}
export interface ConfigOpts {
  platform?: NodeJS.Platform
  homedir?: () => string
  exists?: (p: string) => boolean
}
function homeOf(env: NodeJS.ProcessEnv, opts: ConfigOpts, win: boolean): string {
  const home = env.HOST_HOME || (win ? '' : env.HOME) || (opts.homedir ?? os.homedir)()
  return home.replace(win ? /[\\/]+$/ : /\/+$/, '')
}
const mountOf = (env: NodeJS.ProcessEnv): string =>
  env.HOST_HOME_MOUNT !== undefined ? env.HOST_HOME_MOUNT : env.HOST_HOME ? '/host-home' : ''
export function defaultRoots(env: NodeJS.ProcessEnv = process.env): string[] {
  const chosen = env.LOCAL_FILE_WORKSPACE?.trim()
  return chosen ? [chosen] : []
}
export function defaultWorkspace(
  env: NodeJS.ProcessEnv = process.env,
  opts: ConfigOpts = {},
): string {
  const platform = opts.platform ?? process.platform
  const win = platform === 'win32'
  return pathFor(platform).resolve(
    expand(
      defaultRoots(env)[0] ??
        (() => {
          throw new LocalFileGuardError('No file root was configured')
        })(),
      homeOf(env, opts, win),
      pathFor(platform),
      win,
    ),
  )
}
export function configFromEnv(
  env: NodeJS.ProcessEnv = process.env,
  opts: ConfigOpts = {},
): LocalFileGuardConfig {
  const win = (opts.platform ?? process.platform) === 'win32'
  const maxMb = Number(env.LOCAL_FILE_MAX_MB)
  return {
    roots: env.LOCAL_FILE_ROOTS
      ? env.LOCAL_FILE_ROOTS.split(win ? ';' : ':').filter(Boolean)
      : defaultRoots(env),
    hostHome: homeOf(env, opts, win),
    mount: mountOf(env),
    maxBytes: Number.isFinite(maxMb) && maxMb > 0 ? maxMb * 1024 * 1024 : DEFAULT_MAX_BYTES,
  }
}
const expand = (p: string, home: string, P: PathApi, win: boolean): string =>
  p === '~'
    ? home
    : p.startsWith('~/') || (win && p.startsWith('~\\'))
      ? P.join(home, p.slice(2))
      : p
function toContainer(
  p: string,
  cfg: {
    hostHome: string
    mount: string
  },
  P: PathApi,
  win: boolean,
): string {
  if (!cfg.hostHome || !cfg.mount) return p
  return same(p, cfg.hostHome, win) || below(p, cfg.hostHome, P.sep, win) !== null
    ? P.join(cfg.mount, p.slice(cfg.hostHome.length))
    : p
}
const SECRET_PART =
  /(?:token|credential|secret|passw|cookie|session|service[-_ ]?account|keychain|\.sqlite3?$|\.db$|\.pem$|\.key$|\.p12$|\.pfx$|\.jks$|\.keystore$|\.kdbx$|\.ppk$|\.gpg$|\.asc$)/
const SECRET_SEGMENT =
  /^(?:profiles?|workspace|library|node_modules|id_(?:rsa|dsa|ecdsa|ed25519).*|id_.*|.*-auth|auth|authorized_keys|known_hosts)$/
export function blockedReason(
  relative: string,
  platform: NodeJS.Platform = process.platform,
): string | null {
  for (const raw of relative.split(platform === 'win32' ? /[\\/]/ : '/').filter(Boolean)) {
    const seg = raw.normalize('NFKC').toLowerCase()
    if (seg.startsWith('.')) return 'a hidden file or folder (dotfile)'
    if (SECRET_SEGMENT.test(seg)) return 'a profile, workspace, auth or key location'
    if (SECRET_PART.test(seg)) {
      return 'a name that looks like a credential, token, secret, cookie, session, key or database'
    }
  }
  return null
}
function refuse(reason: string): never {
  throw new LocalFileGuardError(`This file cannot be used: ${reason}.`)
}
export function openGuardedFile(
  input: unknown,
  cfg: LocalFileGuardConfig = configFromEnv(),
): GuardedFile {
  if (
    typeof input !== 'string' ||
    input.trim() === '' ||
    input.length > 1000 ||
    input.includes('\0')
  ) {
    refuse('the path is missing or invalid')
  }
  const platform = cfg.platform ?? process.platform
  const win = platform === 'win32'
  const P = pathFor(platform)
  const io: GuardFs = cfg.fs ?? fs
  const realpath = (p: string): string => (win ? io.realpathSync.native(p) : io.realpathSync(p))
  const lead = input.trim()
  if (/^[\\/]{2}/.test(lead))
    refuse(
      'network (UNC) and device paths such as \\\\server\\share, //server/share, \\\\?\\ and \\\\.\\ are not allowed',
    )
  if (win && input.slice(2).includes(':')) refuse('the path is missing or invalid')
  const requested = P.resolve(expand(input.trim(), cfg.hostHome, P, win))
  const mapped = toContainer(requested, cfg, P, win)
  let real: string
  try {
    real = realpath(mapped)
  } catch {
    refuse('the file does not exist or cannot be read')
  }
  let matched: {
    realRoot: string
    hostRoot: string
  } | null = null
  let realRel = ''
  for (const root of cfg.roots) {
    const hostRoot = P.resolve(expand(root, cfg.hostHome, P, win))
    let realRoot: string
    try {
      realRoot = realpath(toContainer(hostRoot, cfg, P, win))
    } catch {
      continue
    }
    const rest = below(real, realRoot, P.sep, win)
    if (rest !== null) {
      matched = { realRoot, hostRoot }
      realRel = rest
      break
    }
  }
  if (!matched) {
    refuse(
      `it is outside the allowed folder (${cfg.roots.map((r) => r.replace(cfg.hostHome, '~')).join(', ')}), or a link points outside it`,
    )
  }
  const hostRel = below(requested, matched.hostRoot, P.sep, win) ?? ''
  for (const rel of [hostRel, realRel]) {
    const why = blockedReason(rel, platform)
    if (why) refuse(`blocked name: its path goes through ${why}`)
  }
  let pre: fs.Stats
  try {
    pre = io.lstatSync(real)
  } catch {
    refuse('the file does not exist or cannot be read')
  }
  if (!pre.isFile()) refuse('it is not a regular file')
  cfg.beforeOpen?.()
  const { O_RDONLY, O_NOFOLLOW, O_NONBLOCK } = io.constants
  let flags = O_RDONLY
  if (!win) {
    if (typeof O_NOFOLLOW !== 'number' || typeof O_NONBLOCK !== 'number') {
      refuse('this system cannot open a file without following links, so no file is opened')
    }
    flags |= O_NOFOLLOW | O_NONBLOCK
  }
  let fd = -1
  try {
    fd = io.openSync(real, flags)
    const info = io.fstatSync(fd)
    if (!info.isFile()) refuse('it is not a regular file')
    if (info.dev !== pre.dev || info.ino !== pre.ino)
      refuse('the file changed while it was being opened')
    if (info.nlink > 1) refuse('it is a hard-linked file (it has more than one name)')
    if (info.size === 0) refuse('the file is empty')
    if (info.size > cfg.maxBytes) {
      refuse(`it is larger than the limit (${Math.round(cfg.maxBytes / 1048576)} MB)`)
    }
    let opened: string | null = null
    try {
      opened = io.readlinkSync(`/proc/self/fd/${fd}`) as string
    } catch {
      /* Continue without this optional result. */
    }
    if (opened !== null && opened !== real) refuse('the file changed while it was being opened')
    const now = io.statSync(real)
    if (realpath(real) !== real || now.ino !== info.ino || now.dev !== info.dev) {
      refuse('the file changed while it was being opened')
    }
  } catch (error) {
    if (fd >= 0) {
      try {
        io.closeSync(fd)
      } catch {
        /* Continue without this optional result. */
      }
    }
    throw error instanceof LocalFileGuardError
      ? error
      : new LocalFileGuardError('This file cannot be used: it cannot be read.')
  }
  const size = io.fstatSync(fd).size
  const fdFinal = fd
  let closed = false
  const close = (): void => {
    if (closed) return
    closed = true
    try {
      io.closeSync(fdFinal)
    } catch {
      /* Continue without this optional result. */
    }
  }
  return {
    fd: fdFinal,
    size,
    realPath: real,
    name: P.basename(real),
    extension: P.extname(real).slice(1).toLowerCase(),
    stream: () => {
      let position = 0
      return new Readable({
        read(): void {
          if (closed) {
            this.destroy(new Error('The file was closed before it was read.'))
            return
          }
          const length = Math.min(65536, size - position)
          if (length <= 0) {
            this.push(null)
            return
          }
          const chunk = Buffer.allocUnsafe(length)
          io.read(fdFinal, chunk, 0, length, position, (error, bytes) => {
            if (error) {
              this.destroy(error)
            } else if (bytes === 0) {
              this.push(null)
            } else {
              position += bytes
              this.push(chunk.subarray(0, bytes))
            }
          })
        },
      })
    },
    readAll: () => {
      try {
        const data = Buffer.alloc(size)
        let read = 0
        while (read < size) {
          const n = io.readSync(fdFinal, data, read, size - read, read)
          if (n === 0) break
          read += n
        }
        return data.subarray(0, read)
      } finally {
        close()
      }
    },
    close,
  }
}
