import { closeSync, constants, fstatSync } from 'node:fs'
import { lstat, mkdir, realpath, rename, rm, readdir } from 'node:fs/promises'
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { createHash, randomUUID } from 'node:crypto'
import {
  createFileNotThroughALink,
  isInsideCheckedRoot,
  isPrivateEntry,
  isImmutableFile,
  immutableMode,
  openDirectoryNotThroughALink,
  openFileNotThroughALink,
  syncDirectory,
  syncDirectoryAt,
} from './private-files'

export class PluginHostError extends Error {
  constructor(
    readonly code: 'runtime' | 'paths' | 'package' | 'start' | 'ready' | 'cleanup' | 'unsupported',
  ) {
    super(`plugin-host-${code}`)
  }
}
export const digest = (value: Uint8Array): string =>
  createHash('sha256').update(value).digest('hex')
export async function privateRoot(path: string): Promise<string> {
  if (!isAbsolute(path)) throw new PluginHostError('paths')
  path = join(await realpath(dirname(resolve(path))), resolve(path).split(sep).at(-1)!)
  try {
    await mkdir(path, { mode: 0o700 })
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw new PluginHostError('paths')
  }
  await directory(path)
  if (!isInsideCheckedRoot(path)) throw new PluginHostError('paths')
  return path
}
async function directory(path: string): Promise<void> {
  const stat = await lstat(path)
  if (!stat.isDirectory() || stat.isSymbolicLink() || !isPrivateEntry(stat))
    throw new PluginHostError('paths')
}
export async function privateChild(root: string, path: string, create = true): Promise<string> {
  const parts = relative(root, resolve(root, path)).split(sep)
  if (
    parts.some((p) => !p || p === '.' || p === '..') ||
    isAbsolute(relative(root, resolve(root, path)))
  )
    throw new PluginHostError('paths')
  let current = root
  await directory(current)
  for (const part of parts) {
    current = join(current, part)
    if (create) {
      try {
        await mkdir(current, { mode: 0o700 })
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw new PluginHostError('paths')
      }
    }
    await directory(current)
  }
  return current
}
/** Publish only a fully written and verified private tree; never fill in a published tree. */
export async function publishPrivateDirectory(
  root: string,
  id: string,
  write: (stage: string) => Promise<void>,
  verify: (directory: string) => Promise<void>,
): Promise<string> {
  if (!/^[a-f0-9]{64}$/.test(id)) throw new PluginHostError('paths')
  await directory(root)
  const kept = join(root, id)
  const checked = async (path: string) => {
    await directory(path)
    await verify(path)
  }
  const exists = await lstat(kept).then(
    () => true,
    (error: NodeJS.ErrnoException) => {
      if (error.code === 'ENOENT') return false
      throw error
    },
  )
  if (exists) await checked(kept)
  else {
    const stage = await privateChild(root, `.stage-${randomUUID()}`)
    try {
      await write(stage)
      await checked(stage)
      await syncPrivateTree(stage)
      try {
        await rename(stage, kept)
      } catch (error) {
        if (!['EEXIST', 'ENOTEMPTY'].includes((error as NodeJS.ErrnoException).code ?? ''))
          throw error
        // Another complete publication won; mismatches still refuse without modifying it.
        await checked(kept)
      }
      await syncDirectoryAt(root)
    } finally {
      await rm(stage, { recursive: true, force: true })
    }
  }
  return kept
}
async function syncPrivateTree(path: string): Promise<void> {
  await directory(path)
  for (const entry of await readdir(path, { withFileTypes: true })) {
    if (entry.isSymbolicLink()) throw new PluginHostError('paths')
    if (entry.isDirectory()) await syncPrivateTree(join(path, entry.name))
  }
  await syncDirectoryAt(path)
}
export async function immutableFile(
  path: string,
  bytes: Uint8Array,
  executable = false,
): Promise<void> {
  let handle
  try {
    handle = await createFileNotThroughALink(path, immutableMode(executable))
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw new PluginHostError('paths')
    await verifyImmutableFile(path, bytes)
    return
  }
  try {
    await handle.writeFile(bytes)
    await handle.sync()
  } finally {
    await handle.close()
  }
}
export async function verifyImmutableFile(path: string, bytes: Uint8Array): Promise<void> {
  const existing = await openFileNotThroughALink(path, constants.O_RDONLY | constants.O_NONBLOCK)
  try {
    const stat = await existing.stat()
    if (
      !stat.isFile() ||
      stat.nlink !== 1 ||
      !isPrivateEntry(stat, 0) ||
      stat.size !== bytes.byteLength ||
      !isImmutableFile(stat) ||
      !Buffer.from(await existing.readFile()).equals(Buffer.from(bytes))
    )
      throw new PluginHostError('paths')
  } finally {
    await existing.close()
  }
}
export async function sourceBytes(path: string, limit: number): Promise<Buffer> {
  const handle = await openFileNotThroughALink(path, constants.O_RDONLY | constants.O_NONBLOCK)
  try {
    const stat = await handle.stat()
    if (!stat.isFile() || stat.size > limit || stat.size === 0) throw new PluginHostError('runtime')
    return await handle.readFile()
  } finally {
    await handle.close()
  }
}

/** Exact-run exit and lifecycle writer exclusion are caller obligations. Never target data. */
export async function removePrivateCode(
  root: string,
  digestName: string,
  options: {
    retirementId?: string
    verifyPublished?(directory: string): Promise<void>
  } = {},
): Promise<void> {
  if (
    !/^[a-f0-9]{64}$/.test(digestName) ||
    (options.retirementId !== undefined &&
      !/^[a-f0-9-]{36}-[a-f0-9-]{36}$/.test(options.retirementId))
  )
    throw new PluginHostError('paths')
  await directory(root)
  const parent = openDirectoryNotThroughALink(root)
  const pin = fstatSync(parent, { bigint: true })
  const checkParent = async () => {
    const now = await lstat(root, { bigint: true })
    if (now.dev !== pin.dev || now.ino !== pin.ino || now.isSymbolicLink())
      throw new PluginHostError('paths')
    await directory(root)
  }
  const published = join(root, digestName)
  const retiredName = `.retired-${options.retirementId ?? digestName}-${digestName}`
  const retired = join(root, retiredName)
  const stat = async (path: string) =>
    lstat(path, { bigint: true }).catch((error: NodeJS.ErrnoException) => {
      if (error.code === 'ENOENT') return null
      throw error
    })
  const audit = async (folder: string): Promise<void> => {
    await directory(folder)
    for (const entry of await readdir(folder, { withFileTypes: true })) {
      const path = join(folder, entry.name),
        held = await lstat(path)
      if (held.isSymbolicLink() || !isPrivateEntry(held, 0)) throw new PluginHostError('paths')
      if (held.isDirectory()) await audit(path)
      else if (!held.isFile() || held.nlink !== 1 || !isImmutableFile(held))
        throw new PluginHostError('paths')
    }
  }
  try {
    let final = await stat(published),
      trash = await stat(retired)
    if (final && trash) throw new PluginHostError('paths')
    if (final) {
      await privateChild(root, digestName, false)
      await options.verifyPublished?.(published)
      await audit(published)
      await checkParent()
      const again = await stat(published)
      if (!again || again.dev !== final.dev || again.ino !== final.ino || (await stat(retired)))
        throw new PluginHostError('paths')
      // One bounded move under the lifecycle writer fence. Published bytes stay intact until here.
      await rename(published, retired)
      trash = await stat(retired)
      if (!trash || trash.dev !== final.dev || trash.ino !== final.ino)
        throw new PluginHostError('paths')
      syncDirectory(parent) // Retirement is durable before recursive deletion may touch a file.
      final = null
    }
    if (trash) {
      syncDirectory(parent) // A retry also persists a prior rename whose first fsync may have failed.
      await privateChild(root, retiredName, false)
      await audit(retired) // Partial retirement is expected; links/foreign/writable files still refuse.
      await checkParent()
      const again = await stat(retired)
      if (!again || again.dev !== trash.dev || again.ino !== trash.ino)
        throw new PluginHostError('paths')
      await rm(retired, { recursive: true })
    }
    await checkParent()
    syncDirectory(parent)
  } finally {
    closeSync(parent)
  }
}
