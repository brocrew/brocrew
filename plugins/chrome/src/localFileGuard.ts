import { openResolvedFile } from '../../shared/file-reader.js'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import type { Readable } from 'node:stream'
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
  let matched = false
  for (const root of cfg.roots) {
    const hostRoot = P.resolve(expand(root, cfg.hostHome, P, win))
    let realRoot: string
    try {
      realRoot = realpath(toContainer(hostRoot, cfg, P, win))
    } catch {
      continue
    }
    if (below(real, realRoot, P.sep, win) !== null) {
      matched = true
      break
    }
  }
  if (!matched) {
    refuse(
      `it is outside the allowed folder (${cfg.roots.map((r) => r.replace(cfg.hostHome, '~')).join(', ')}), or a link points outside it`,
    )
  }
  const file = openResolvedFile(real, cfg, io, win, LocalFileGuardError)
  const { fd: fdFinal, size, close } = file
  return {
    ...file,
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
