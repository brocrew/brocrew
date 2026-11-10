import { randomBytes } from 'node:crypto'
import { createFreshFile } from './internal/provider-home.ts'
import {
  closeSync,
  fchmodSync,
  fsyncSync,
  linkSync,
  openSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import * as nodeFs from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'

interface AtomicWriteHandle {
  writeFile(data: string | Uint8Array): Promise<void>
  sync(): Promise<void>
  close(): Promise<void>
}

export interface AtomicWriteFs {
  open(path: string, flags: string, mode?: number): Promise<AtomicWriteHandle>
  rename(from: string, to: string): Promise<void>
  rm(path: string, options: { force: boolean }): Promise<void>
}

export type AtomicWriteData =
  string | Uint8Array | ((append: (text: string) => Promise<void>) => Promise<void>)

/** The codes a file held briefly by another program gives, mostly antivirus and indexers on Windows. */
const BRIEFLY_HELD = new Set(['EBUSY', 'EPERM', 'EACCES'])

/** Whether `error` is one a file held briefly by another program gives. */
function isBrieflyHeld(error: unknown): boolean {
  const code = (error as NodeJS.ErrnoException | null)?.code
  return code !== undefined && BRIEFLY_HELD.has(code)
}

/** The waits between tries: ten tries over about two seconds. */
export const RETRY_DELAYS_MS: readonly number[] = [50, 100, 150, 200, 250, 300, 300, 300, 350]

export interface RetryOptions {
  readonly delays?: readonly number[]
  readonly sleep?: (ms: number) => Promise<void>
}

export async function retrying<T>(op: () => Promise<T>, options: RetryOptions = {}): Promise<T> {
  const delays = options.delays ?? RETRY_DELAYS_MS
  const sleep =
    options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)))
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await op()
    } catch (error) {
      const wait = delays[attempt]
      if (wait === undefined || !isBrieflyHeld(error)) throw error
      await sleep(wait)
    }
  }
}

function temporaryFile(path: string): string {
  // Leave room for the suffix when the destination already has a long filename.
  const name = Buffer.from(basename(path)).subarray(0, 200).toString('utf8')
  return join(dirname(path), `${name}.${randomBytes(6).toString('hex')}.tmp`)
}

export async function writeAtomically(
  path: string,
  data: AtomicWriteData,
  fs: AtomicWriteFs = nodeFs,
  platform: NodeJS.Platform = process.platform,
): Promise<void> {
  const temporary = temporaryFile(path)
  let handle: AtomicWriteHandle | null = null
  let created = false
  try {
    handle = await fs.open(temporary, 'wx', 0o600)
    created = true
    const opened = handle
    if (typeof data === 'function') await data((text) => opened.writeFile(text))
    else await handle.writeFile(data)
    await handle.sync()
    const written = handle
    handle = null
    await written.close()
    await retrying(() => fs.rename(temporary, path))
  } catch (error) {
    await handle?.close().catch(() => undefined)
    if (created) await fs.rm(temporary, { force: true }).catch(() => undefined)
    throw error
  }
  if (platform === 'win32') await flushFile(path, fs)
  else await syncFolder(dirname(path), fs, platform)
}

/** {@link writeAtomically} for a JSON value, two-space indented with a final newline. */
export async function writeJsonAtomically(
  path: string,
  value: unknown,
  fs: AtomicWriteFs = nodeFs,
): Promise<void> {
  await writeAtomically(path, `${JSON.stringify(value, null, 2)}\n`, fs)
}

export async function syncFolder(
  folder: string,
  fs: AtomicWriteFs = nodeFs,
  platform: NodeJS.Platform = process.platform,
): Promise<void> {
  if (platform === 'win32') return
  const handle = await fs.open(folder, 'r')
  try {
    await handle.sync()
  } finally {
    await handle.close()
  }
}

export async function flushFile(path: string, fs: AtomicWriteFs): Promise<void> {
  const handle = await retrying(() => fs.open(path, 'r+'))
  try {
    await handle.sync()
  } finally {
    await handle.close()
  }
}

function retryingSync<T>(op: () => T): T {
  for (let attempt = 0; ; attempt += 1) {
    try {
      return op()
    } catch (error) {
      const wait = RETRY_DELAYS_MS[attempt]
      if (wait === undefined || !isBrieflyHeld(error)) throw error
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, wait)
    }
  }
}

function syncAfterCommit(path: string): void {
  const fd = retryingSync(() =>
    openSync(
      process.platform === 'win32' ? path : dirname(path),
      process.platform === 'win32' ? 'r+' : 'r',
    ),
  )
  try {
    fsyncSync(fd)
  } finally {
    closeSync(fd)
  }
}

export interface AtomicWriteStage {
  readonly temporary: string
  commit(exclusive?: boolean): void
  discard(): void
}

// Two-phase callers check their current data before publication; all writes share the same flush and retry.
export function stageAtomicWriteSync(
  path: string,
  data: string | Uint8Array,
  mode = 0o600,
): AtomicWriteStage {
  const temporary = temporaryFile(path)
  let active = false
  const discard = (): void => {
    if (!active) return
    rmSync(temporary, { force: true })
    active = false
  }
  let fd: number | undefined
  try {
    fd = createFreshFile(temporary, mode)
    active = true
    writeFileSync(fd, data)
    fchmodSync(fd, mode)
    fsyncSync(fd)
    const written = fd
    fd = undefined
    closeSync(written)
  } catch (error) {
    if (fd !== undefined) {
      try {
        closeSync(fd)
      } catch {
        // Preserve the original failure.
      }
    }
    try {
      discard()
    } catch {
      // Preserve the original failure.
    }
    throw error
  }
  return {
    temporary,
    commit(exclusive = false) {
      if (!active) throw new Error(`${temporary}: already published or discarded`)
      if (exclusive) {
        retryingSync(() => linkSync(temporary, path))
        discard()
      } else {
        retryingSync(() => renameSync(temporary, path))
        active = false
      }
      syncAfterCommit(path)
    },
    discard,
  }
}

export function writeAtomicallySync(
  path: string,
  data: string | Uint8Array,
  options: { readonly mode?: number; readonly exclusive?: boolean } = {},
): void {
  const stage = stageAtomicWriteSync(path, data, options.mode)
  try {
    stage.commit(options.exclusive)
  } finally {
    try {
      stage.discard()
    } catch {
      // Preserve the original failure.
    }
  }
}
