import { constants } from 'node:fs'
import { stat, mkdir, rename, rm, readdir } from 'node:fs/promises'
import { isAbsolute, join, relative, resolve, sep } from 'node:path'
import { createHash, randomUUID } from 'node:crypto'
import {
  createFileNotThroughALink,
  immutableMode,
  openFileNotThroughALink,
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
  path = resolve(path)
  await mkdir(path, { recursive: true, mode: 0o700 })
  await directory(path)
  return path
}
async function directory(path: string): Promise<void> {
  if (!(await stat(path)).isDirectory()) throw new PluginHostError('paths')
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
  const exists = await stat(kept).then(
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
    const info = await existing.stat()
    if (
      !info.isFile() ||
      info.size !== bytes.byteLength ||
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

/** Retire the selected code directory atomically before removal. Data is a separate root. */
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
  const published = join(root, digestName)
  const retired = join(root, `.retired-${options.retirementId ?? digestName}-${digestName}`)
  const exists = async (path: string) =>
    stat(path).then(
      () => true,
      (error: NodeJS.ErrnoException) => {
        if (error.code === 'ENOENT') return false
        throw error
      },
    )
  const final = await exists(published),
    trash = await exists(retired)
  if (final && trash) throw new PluginHostError('paths')
  if (final) {
    await options.verifyPublished?.(published)
    await rename(published, retired)
    await syncDirectoryAt(root)
  }
  if (final || trash) {
    await rm(retired, { recursive: true, force: true })
    await syncDirectoryAt(root)
  }
}
