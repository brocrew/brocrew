import { openResolvedFile } from '../../shared/file-reader.js'
import * as fs from 'node:fs'
import * as path from 'node:path'
import type { Readable } from 'node:stream'
export class LocalFileGuardError extends Error {}
export interface LocalFileGuardConfig {
  roots: string[]
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
  close(): void
}
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
function refuse(reason: string): never {
  throw new LocalFileGuardError(`This file cannot be used: ${reason}.`)
}
export function openGuardedFile(input: unknown, cfg: LocalFileGuardConfig): GuardedFile {
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
  if (!P.isAbsolute(lead)) refuse('the path is not absolute')
  const requested = P.resolve(lead)
  let real: string
  try {
    real = realpath(requested)
  } catch {
    refuse('the file does not exist or cannot be read')
  }
  let matched = false
  for (const root of cfg.roots) {
    const hostRoot = P.resolve(root)
    let realRoot: string
    try {
      realRoot = realpath(hostRoot)
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
      `it is outside the allowed folder (${cfg.roots.join(', ')}), or a link points outside it`,
    )
  }
  return openResolvedFile(real, cfg, io, win, LocalFileGuardError)
}
