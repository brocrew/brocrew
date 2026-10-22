import { constants } from 'node:fs'
import { lstat, readdir, rename, unlink } from 'node:fs/promises'
import { dirname, join } from 'node:path'
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
const Previous = z
  .string()
  .regex(/^[a-f0-9]{64}$/)
  .nullable()
const Revision = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER)
const Checkpoint = z
  .strictObject({
    format: z.literal(2),
    installId: z.uuid(),
    revision: Revision,
    previous: Previous,
  })
  .refine((value) => (value.revision === 0) === (value.previous === null))
const Intent = z.strictObject({
  format: z.union([z.literal(1), z.literal(2)]),
  installId: z.uuid(),
  revision: Revision.refine((value) => value > 0),
  previous: Previous,
  proposal: PluginProposal,
})
const TAIL_LIMIT = 16
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
  private async optionalFile(path: string, limit: number) {
    const bytes = await sourceBytes(path, limit).catch((error: NodeJS.ErrnoException) => {
      if (error.code === 'ENOENT') return null
      throw error
    })
    if (bytes) await verifyImmutableFile(path, bytes)
    return bytes
  }
  private async state(installId: string, create: boolean, allowV2 = true) {
    const location = await this.location(installId, create)
    if (!location)
      return { revision: 0, previous: null, location: null, hasV2: false, records: [] as string[] }
    const floorBytes = await this.optionalFile(join(location.parent, installId + '.floor'), 512)
    const legacyFloor = floorBytes && /^\d{1,4}$/.test(floorBytes.toString())
    const floor =
      floorBytes && !legacyFloor ? Checkpoint.parse(JSON.parse(floorBytes.toString('utf8'))) : null
    const checkpointBytes = await this.optionalFile(
      join(dirname(location.folder), 'checkpoint.json'),
      512,
    )
    if (!allowV2 && (floor || checkpointBytes)) return refuse()
    const checkpoint = checkpointBytes
      ? Checkpoint.parse(JSON.parse(checkpointBytes.toString('utf8')))
      : null
    if (
      (floor && floor.installId !== installId) ||
      (checkpoint &&
        (checkpoint.installId !== installId || !floor || floor.revision < checkpoint.revision))
    )
      return refuse()
    let previous: string | null = checkpoint?.previous ?? null,
      revision = checkpoint?.revision ?? 0
    let floorSeen = !floor || (floor.revision === revision && floor.previous === previous)
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
      .sort((a, b) => Number(a.slice(0, -5)) - Number(b.slice(0, -5)))
    if (names.length > 4096) return refuse()
    const seen = new Set<number>(),
      prefix: string[] = [],
      records: string[] = []
    for (const name of names) {
      const path = join(location.folder, name),
        bytes = await sourceBytes(path, 2048)
      await verifyImmutableFile(path, bytes)
      const intent = Intent.parse(JSON.parse(bytes.toString('utf8')))
      if (
        intent.installId !== installId ||
        seen.has(intent.revision) ||
        (intent.format === 1 && intent.revision > 4096) ||
        (intent.format === 2 && !floor) ||
        name !== String(intent.revision).padStart(intent.format === 1 ? 8 : 16, '0') + '.json'
      )
        return refuse()
      seen.add(intent.revision)
      const hash = digest(bytes)
      // A published checkpoint consumes its prefix even if a crash interrupted prefix deletion.
      if (checkpoint && intent.revision <= checkpoint.revision) {
        if (intent.revision === checkpoint.revision && hash !== checkpoint.previous) return refuse()
        prefix.push(name)
        continue
      }
      if (intent.revision !== revision + 1 || intent.previous !== previous) return refuse()
      revision = intent.revision
      records.push(name)
      previous = hash
      if (floor && floor.revision === revision && floor.previous === previous) floorSeen = true
    }
    if ((legacyFloor && Number(floorBytes) > revision) || !floorSeen) return refuse()
    if (prefix.length) await this.prune(location.folder, prefix)
    return { revision, previous, location, hasV2: Boolean(floor), records }
  }
  private async publishFloor(
    parent: string,
    installId: string,
    revision: number,
    previous: string | null,
    format: 1 | 2 = 2,
  ) {
    const stage = join(parent, '.floor-' + randomUUID()),
      pin = pinDirectory(parent)
    const bytes = Buffer.from(
      format === 1
        ? String(revision)
        : JSON.stringify(Checkpoint.parse({ format: 2, installId, revision, previous })),
    )
    try {
      await immutableFile(stage, bytes)
      await rename(stage, join(parent, installId + '.floor'))
      pin.sync()
    } finally {
      await unlink(stage).catch(() => undefined)
      pin.close()
    }
  }
  private async prune(folder: string, names: readonly string[]) {
    const pin = pinDirectory(folder)
    try {
      for (const name of names) await unlink(join(folder, name))
    } finally {
      try {
        pin.sync()
      } finally {
        pin.close()
      }
    }
  }
  private async publishCheckpoint(
    folder: string,
    parent: string,
    installId: string,
    revision: number,
    previous: string | null,
    records: readonly string[],
  ) {
    // A checkpoint can only consume a prefix already protected by its durable replay floor.
    await this.publishFloor(parent, installId, revision, previous)
    const directory = dirname(folder),
      pin = pinDirectory(directory),
      held = pin.held(),
      stage = join(directory, '.checkpoint-' + randomUUID())
    const bytes = Buffer.from(
      JSON.stringify(Checkpoint.parse({ format: 2, installId, revision, previous })),
    )
    try {
      await immutableFile(stage, bytes)
      const now = await lstat(directory, { bigint: true })
      if (now.dev !== held.dev || now.ino !== held.ino || now.isSymbolicLink()) return refuse()
      await rename(stage, join(directory, 'checkpoint.json'))
      pin.sync()
    } finally {
      await unlink(stage).catch(() => undefined)
      pin.close()
    }
    // Publication and directory sync precede every deletion. Interrupted pruning is resumable.
    await this.prune(folder, records)
  }
  async revision(installId: string, allowV2 = true): Promise<number> {
    return (await this.state(installId, false, allowV2)).revision
  }
  async reserve(
    installId: string,
    expected: number,
    input: unknown,
    format: 1 | 2 = 1,
  ): Promise<number> {
    if (!Number.isSafeInteger(expected) || expected < 0) return refuse()
    const proposal = PluginProposal.parse(input),
      state = await this.state(installId, true, format === 2)
    // Keep existing apps able to configure installations until the legacy history is exhausted.
    if (format === 2 && !state.hasV2 && expected < 4096) format = 1
    if (
      state.revision !== expected ||
      expected >= (format === 1 ? 4096 : Number.MAX_SAFE_INTEGER) ||
      !state.location
    )
      return refuse()
    const { folder, parent } = state.location
    if (format === 2) {
      // Existing v2 floors already fence old readers; only the initial upgrade needs this write.
      if (!state.hasV2) await this.publishFloor(parent, installId, expected, state.previous)
      // Compact a recovered full prefix before appending, including the old 4096-record format.
      if (state.records.length >= TAIL_LIMIT) {
        await this.publishCheckpoint(
          folder,
          parent,
          installId,
          expected,
          state.previous,
          state.records,
        )
        state.records.length = 0
      }
    }
    const revision = expected + 1
    const bytes = Buffer.from(
      JSON.stringify(
        Intent.parse({ format, installId, revision, previous: state.previous, proposal }),
      ),
    )
    const pin = pinDirectory(folder)
    const held = pin.held()
    const stage = join(folder, '.new-' + randomUUID()),
      name = String(revision).padStart(format === 1 ? 8 : 16, '0') + '.json'
    try {
      await immutableFile(stage, bytes)
      const now = await lstat(folder, { bigint: true })
      if (now.dev !== held.dev || now.ino !== held.ino || now.isSymbolicLink()) return refuse()
      await rename(stage, join(folder, name))
      pin.sync() // Positive durable intent BEFORE any downstream effect.
      await this.publishFloor(parent, installId, revision, digest(bytes), format)
      if (format === 2 && state.records.length + 1 >= TAIL_LIMIT)
        await this.publishCheckpoint(folder, parent, installId, revision, digest(bytes), [
          ...state.records,
          name,
        ])
    } finally {
      await unlink(stage).catch(() => undefined)
      pin.close()
    }
    return revision
  }
}
