import type * as Fs from 'node:fs'
import { dirname, resolve } from 'node:path'

/**
 * `node:fs` with Windows' exclusive create, for a test on another system: there is no
 * `O_NOFOLLOW`, an open follows a link, and an exclusive create follows a link left at the name and
 * makes the file where it points. A test can also put a link at a name in the moment it is created,
 * and change what is at the name in the moment after. On Windows the system itself behaves so, and
 * only the moments are added.
 */
export interface WindowsCreates {
  /** Off Windows, behave as Windows does. */
  windows: boolean
  /** Run once, just before the first exclusive create `when` picks. */
  swap: null | { readonly when: (path: string) => boolean; run(path: string): void }
  /** Whether the swap has run. */
  swapped: boolean
  /** Run once, just after the first exclusive create `when` picks has opened its file. */
  afterCreate?: null | { readonly when: (path: string) => boolean; run(path: string): void }
}

export function asWindowsCreates(fs: typeof Fs, state: WindowsCreates): typeof Fs {
  const real = fs.constants
  const simulating = (): boolean => state.windows && process.platform !== 'win32'
  const constants = { ...real }
  Object.defineProperty(constants, 'O_NOFOLLOW', {
    enumerable: true,
    get: () => (simulating() ? undefined : real.O_NOFOLLOW),
  })
  const exclusive = (flags: unknown): boolean =>
    typeof flags === 'string'
      ? flags.includes('x')
      : typeof flags === 'number' && (flags & real.O_CREAT) !== 0 && (flags & real.O_EXCL) !== 0
  const atTheMoment = (path: unknown, flags: unknown): void => {
    const swap = state.swap
    if (swap === null || typeof path !== 'string' || !exclusive(flags) || !swap.when(path)) return
    state.swap = null
    swap.run(path)
    state.swapped = true
  }
  /** Where an exclusive create at `path` makes its file on Windows. */
  const followed = <T>(path: T): T | string => {
    if (!simulating() || typeof path !== 'string') return path
    try {
      if (!fs.lstatSync(path).isSymbolicLink()) return path
    } catch {
      return path
    }
    return resolve(dirname(path), fs.readlinkSync(path))
  }
  const asked = (flags: unknown): unknown =>
    simulating() && typeof flags === 'number' ? flags & ~real.O_NOFOLLOW : flags
  const openSync = ((path: Fs.PathLike, flags?: Fs.OpenMode, mode?: Fs.Mode | null) => {
    atTheMoment(path, flags)
    const at = exclusive(flags) ? followed(path) : path
    const fd = fs.openSync(at, (asked(flags) ?? 'r') as Fs.OpenMode, mode)
    const after = state.afterCreate
    if (after != null && typeof path === 'string' && exclusive(flags) && after.when(path)) {
      state.afterCreate = null
      after.run(path)
    }
    return fd
  }) as typeof fs.openSync
  const writeFileSync = ((
    file: Fs.PathOrFileDescriptor,
    data: string | NodeJS.ArrayBufferView,
    options?: Fs.WriteFileOptions,
  ) => {
    const flag = typeof options === 'object' && options !== null ? options.flag : undefined
    atTheMoment(file, flag)
    const at = flag !== undefined && exclusive(flag) ? followed(file) : file
    fs.writeFileSync(at, data, options)
  }) as typeof fs.writeFileSync
  const changed = { constants, openSync, writeFileSync }
  return { ...fs, ...changed, default: { ...fs, ...changed } } as typeof Fs
}
