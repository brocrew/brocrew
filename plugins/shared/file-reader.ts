import type * as fs from 'node:fs'
import * as path from 'node:path'
import { Readable } from 'node:stream'

export function fileReader(
  io: Pick<typeof fs, 'closeSync' | 'read'>,
  fdFinal: number,
  size: number,
) {
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
    close,
  }
}

type ResolvedFileFs = Pick<
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

export function openResolvedFile(
  real: string,
  cfg: { maxBytes: number; beforeOpen?: () => void },
  io: ResolvedFileFs,
  win: boolean,
  FileError: new (message: string) => Error,
) {
  const P = win ? path.win32 : path.posix
  const realpath = (p: string): string => (win ? io.realpathSync.native(p) : io.realpathSync(p))
  function refuse(reason: string): never {
    throw new FileError(`This file cannot be used: ${reason}.`)
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
    throw error instanceof FileError
      ? error
      : new FileError('This file cannot be used: it cannot be read.')
  }
  const size = io.fstatSync(fd).size
  const fdFinal = fd
  const { stream, close } = fileReader(io, fdFinal, size)
  return {
    fd: fdFinal,
    size,
    realPath: real,
    name: P.basename(real),
    extension: P.extname(real).slice(1).toLowerCase(),
    stream,
    close,
  }
}
