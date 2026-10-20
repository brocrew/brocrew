import { constants } from 'node:fs'
import { lstat, readdir, rename, unlink } from 'node:fs/promises'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import { PluginProposal } from './proposals'
import {
  digest,
  immutableFile,
  privateChild,
  publishPrivateDirectory,
  sourceBytes,
  verifyImmutableFile,
} from '../node-host-files'
import {
  isImmutableFile,
  isPrivateEntry,
  openFileNotThroughALink,
  pinDirectory,
} from '../private-files'
import { PluginSupervisorError } from '../supervisor/protocol'
const Intent = z.strictObject({
  format: z.literal(1),
  installId: z.uuid(),
  revision: z.number().int().min(1).max(4096),
  previous: z
    .string()
    .regex(/^[a-f0-9]{64}$/)
    .nullable(),
  proposal: PluginProposal,
})
const refuse = (): never => {
  throw new PluginSupervisorError('unavailable')
}
/** Owner's lifecycle exclusive gate is mandatory for every read/reserve. This kept-current journal
 * is excluded from workspace/global activation restores. A consumed intent is never auto-replayed.
 */
export class PluginProfileLedger {
  constructor(private readonly root: string) {}
  private async location(installId: string, create: boolean) {
    if (!z.uuid().safeParse(installId).success) return refuse()
    const parent = await privateChild(this.root, 'profile-apply')
    const name = digest(Buffer.from(installId)),
      kept = join(parent, name)
    const exists = await lstat(kept).then(
      () => true,
      (error: NodeJS.ErrnoException) => {
        if (error.code === 'ENOENT') return false
        throw error
      },
    )
    if (!exists) {
      const floor = await lstat(join(parent, installId + '.floor')).then(
        () => true,
        (error: NodeJS.ErrnoException) => {
          if (error.code === 'ENOENT') return false
          throw error
        },
      )
      if (floor) return refuse() // Never reset an installation whose committed ledger was removed.
      if (!create) return null
      if ((await readdir(parent)).length >= 12288) return refuse()
    }
    const verify = async (directory: string) => {
      await verifyImmutableFile(join(directory, 'birth'), Buffer.from(installId))
      await privateChild(directory, 'intents', false)
    }
    const directory = create
      ? await publishPrivateDirectory(
          parent,
          name,
          async (stage) => {
            await immutableFile(join(stage, 'birth'), Buffer.from(installId))
            await privateChild(stage, 'intents')
          },
          verify,
        )
      : await privateChild(parent, name, false)
    await verify(directory)
    const folder = await privateChild(directory, 'intents', false)
    return { parent, folder }
  }
  private async state(installId: string, create: boolean) {
    const location = await this.location(installId, create)
    if (!location) return { revision: 0, previous: null, location: null }
    for (const name of await readdir(location.folder)) {
      if (!/^\.new-[a-f0-9-]{36}$/.test(name)) continue
      const path = join(location.folder, name)
      const handle = await openFileNotThroughALink(path, constants.O_RDONLY | constants.O_NONBLOCK)
      try {
        const stat = await handle.stat()
        if (
          !stat.isFile() ||
          stat.nlink !== 1 ||
          !isPrivateEntry(stat, 0) ||
          !isImmutableFile(stat) ||
          stat.size > 2048
        )
          return refuse()
      } finally {
        await handle.close()
      }
      await unlink(path)
    }
    const names = (await readdir(location.folder))
      .filter((name) => !/^\.new-[a-f0-9-]{36}$/.test(name))
      .sort()
    if (names.length > 4096) return refuse()
    let previous: string | null = null,
      revision = 0
    for (const name of names) {
      if (name !== String(revision + 1).padStart(8, '0') + '.json') return refuse()
      const path = join(location.folder, name),
        bytes = await sourceBytes(path, 2048)
      await verifyImmutableFile(path, bytes)
      const intent = Intent.parse(JSON.parse(bytes.toString('utf8')))
      if (
        intent.installId !== installId ||
        intent.revision !== ++revision ||
        intent.previous !== previous
      )
        return refuse()
      previous = digest(bytes)
    }
    const floorPath = join(location.parent, installId + '.floor')
    const floor = await sourceBytes(floorPath, 16).catch((e: NodeJS.ErrnoException) => {
      if (e.code === 'ENOENT') return null
      throw e
    })
    if (floor) {
      await verifyImmutableFile(floorPath, floor)
      if (!/^\d{1,4}$/.test(floor.toString()) || Number(floor) > revision) return refuse()
    }
    return { revision, previous, location }
  }
  async revision(installId: string): Promise<number> {
    return (await this.state(installId, false)).revision
  }
  async reserve(installId: string, expected: number, input: unknown): Promise<number> {
    if (!Number.isSafeInteger(expected) || expected < 0) return refuse()
    const proposal = PluginProposal.parse(input),
      state = await this.state(installId, true)
    if (state.revision !== expected || expected >= 4096 || !state.location) return refuse()
    const revision = expected + 1
    const bytes = Buffer.from(
      JSON.stringify(
        Intent.parse({ format: 1, installId, revision, previous: state.previous, proposal }),
      ),
    )
    const { folder, parent } = state.location
    const pin = pinDirectory(folder)
    const held = pin.held()
    const stage = join(folder, '.new-' + randomUUID())
    try {
      await immutableFile(stage, bytes)
      const now = await lstat(folder, { bigint: true })
      if (now.dev !== held.dev || now.ino !== held.ino || now.isSymbolicLink()) return refuse()
      await rename(stage, join(folder, String(revision).padStart(8, '0') + '.json'))
      pin.sync() // Positive durable intent BEFORE any downstream effect.
      const floorStage = join(parent, '.floor-' + randomUUID()),
        parentPin = pinDirectory(parent)
      try {
        await immutableFile(floorStage, Buffer.from(String(revision)))
        await rename(floorStage, join(parent, installId + '.floor'))
        parentPin.sync()
      } finally {
        await unlink(floorStage).catch(() => undefined)
        parentPin.close()
      }
    } finally {
      await unlink(stage).catch(() => undefined)
      pin.close()
    }
    return revision
  }
}
