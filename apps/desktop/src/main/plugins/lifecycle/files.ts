import { constants } from 'node:fs'
import { rename, unlink } from 'node:fs/promises'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import { privateChild } from '../node-host-files'
import {
  createFileNotThroughALink,
  openFileNotThroughALink,
  syncDirectoryAt,
} from '../private-files'
import { encodeState, decodeState } from '../state/format'
import { PluginSupervisorError } from '../supervisor/protocol'

export const Effect = z.strictObject({
  format: z.literal(1),
  operationId: z.uuid(),
  pluginId: z.string(),
  installId: z.uuid(),
  action: z.enum(['install', 'update', 'uninstall']),
  phase: z.enum(['prepared', 'committed', 'aborted']),
  offlineCleanup: z.boolean(),
  compensates: z.uuid().nullable(),
  previousVersion: z.string().optional(),
  previousDataSchema: z.number().int().nonnegative().safe().optional(),
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
      if (!stat.isFile()) return refuse()
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
    const temporary = join(this.folder, '.new-' + randomUUID()),
      path = join(this.folder, value.operationId + '.json')
    let handle
    try {
      handle = await createFileNotThroughALink(temporary, 0o600)
      await handle.writeFile(encodeState(value))
      await handle.sync()
      await handle.close()
      handle = undefined
      await rename(temporary, path)
      await syncDirectoryAt(this.folder)
    } catch {
      return refuse()
    } finally {
      await handle?.close()
      await unlink(temporary).catch(() => undefined)
    }
  }
}
