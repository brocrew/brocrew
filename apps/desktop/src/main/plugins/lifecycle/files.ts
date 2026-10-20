import { constants } from 'node:fs'
import { lstat, rename, unlink, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import { privateChild } from '../node-host-files'
import {
  createFileNotThroughALink,
  isPrivateEntry,
  openFileNotThroughALink,
  pinDirectory,
} from '../private-files'
import { encodeState, decodeState } from '../state/format'
import { PluginSupervisorError } from '../supervisor/protocol'

export const Effect = z.strictObject({
  format: z.literal(1),
  operationId: z.uuid(),
  pluginId: z.string().regex(/^[a-z][a-z0-9-]{0,63}$/),
  installId: z.uuid(),
  action: z.enum(['install', 'update', 'uninstall']),
  phase: z.enum(['prepared', 'committed', 'aborted']),
  offlineCleanup: z.boolean(),
  compensates: z.uuid().nullable(),
})
export type Effect = z.infer<typeof Effect>
const refuse = (): never => {
  throw new PluginSupervisorError('cleanup-pending')
}
/** Kept-current operation completion markers; never part of an activation restore set. */
export class LifecycleEffects {
  private constructor(readonly folder: string) {}
  static async open(root: string, create: boolean): Promise<LifecycleEffects> {
    return new LifecycleEffects(await privateChild(root, 'lifecycle-effects', create))
  }
  async read(id: string): Promise<Effect | null> {
    if (!z.uuid().safeParse(id).success) return refuse()
    let handle
    try {
      handle = await openFileNotThroughALink(
        join(this.folder, id + '.json'),
        constants.O_RDONLY | constants.O_NONBLOCK,
      )
      const stat = await handle.stat()
      if (!stat.isFile() || stat.nlink !== 1 || !isPrivateEntry(stat) || stat.size > 128 * 1024)
        return refuse()
      return decodeState(await handle.readFile(), Effect)
    } catch (error) {
      if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return null
      return refuse()
    } finally {
      await handle?.close()
    }
  }
  async write(input: Effect): Promise<void> {
    const value = Effect.parse(input)
    const pin = pinDirectory(this.folder)
    const before = pin.held()
    const check = async () => {
      const now = await lstat(this.folder, { bigint: true })
      if (
        !now.isDirectory() ||
        now.isSymbolicLink() ||
        !isPrivateEntry(now) ||
        now.dev !== before.dev ||
        now.ino !== before.ino
      )
        refuse()
    }
    const temporary = join(this.folder, '.new-' + randomUUID()),
      path = join(this.folder, value.operationId + '.json')
    let handle
    try {
      await check()
      await this.read(value.operationId) // Refuse a linked/unreadable existing target.
      if ((await readdir(this.folder)).length >= 4096) refuse()
      handle = await createFileNotThroughALink(temporary, 0o600)
      await handle.writeFile(encodeState(value))
      await handle.sync()
      await handle.close()
      handle = undefined
      await check()
      await rename(temporary, path)
      pin.sync()
    } catch {
      return refuse()
    } finally {
      await handle?.close()
      await unlink(temporary).catch(() => undefined)
      pin.close()
    }
  }
}
