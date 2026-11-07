import { closeSync, constants, fstatSync, lstatSync, type BigIntStats } from 'node:fs'
import { lstat, unlink } from 'node:fs/promises'
import { basename, join, resolve } from 'node:path'
import { z } from 'zod'
import { privateChild } from '../node-host-files'
import {
  createFileNotThroughALink,
  openDirectoryNotThroughALink,
  openFileNotThroughALink,
  syncDirectoryAt,
} from '../private-files'
import { OwnerDiagnostic, PluginSupervisorError, type OwnerRecord } from './protocol'

const advice = z.strictObject({
  format: z.literal(1),
  launch: z.uuid(),
  epoch: z.uuid(),
  diagnostic: OwnerDiagnostic.refine(
    (value) =>
      (value.phase === 'blocked' || value.phase === 'draining') &&
      value.stage === 'recovery' &&
      value.probe === 'no-answer' &&
      value.reason === 'restart-required',
  ),
})
const name = 'recovery-advice.json'

async function inLaunch<T>(root: string, directory: string, work: () => Promise<T>): Promise<T> {
  const launches = await privateChild(root, 'supervisor-launches', false)
  const id = z.uuid().parse(basename(directory))
  const own = await privateChild(launches, id, false)
  if (resolve(directory) !== own) throw new Error('Foreign launch advice')
  const pins: { path: string; fd: number; stat: BigIntStats }[] = []
  const check = () => {
    for (const pin of pins) {
      const now = lstatSync(pin.path, { bigint: true })
      const held = fstatSync(pin.fd, { bigint: true })
      if (
        !now.isDirectory() ||
        now.isSymbolicLink() ||
        now.dev !== pin.stat.dev ||
        now.ino !== pin.stat.ino ||
        held.dev !== pin.stat.dev ||
        held.ino !== pin.stat.ino
      )
        throw new Error('Changed launch advice directory')
    }
  }
  try {
    for (const path of [root, launches, own]) {
      const fd = openDirectoryNotThroughALink(path)
      try {
        pins.push({ path, fd, stat: fstatSync(fd, { bigint: true }) })
      } catch (error) {
        closeSync(fd)
        throw error
      }
    }
    check()
    const value = await work()
    check()
    return value
  } finally {
    for (const pin of pins.reverse()) closeSync(pin.fd)
  }
}

/** Advice is private to this launch and never authorizes cleanup or admission. */
export async function writeRecoveryAdvice(
  root: string,
  directory: string,
  previous: OwnerRecord,
): Promise<boolean> {
  try {
    return await inLaunch(root, directory, async () => {
      const value = advice.parse({
        format: 1,
        launch: basename(directory),
        epoch: previous.epoch,
        diagnostic: {
          phase: previous.phase,
          stage: 'recovery',
          probe: 'no-answer',
          reason: 'restart-required',
        },
      })
      const path = join(directory, name)
      const file = await createFileNotThroughALink(path, 0o600)
      let held: { dev: number; ino: number } | undefined
      try {
        held = await file.stat()
        await file.writeFile(JSON.stringify(value))
        await file.sync()
        await file.close()
        await syncDirectoryAt(directory)
      } catch (error) {
        await file.close().catch(() => {})
        const now = await lstat(path).catch(() => undefined)
        if (held && now?.dev === held.dev && now.ino === held.ino) await unlink(path)
        throw error
      }
      return true
    })
  } catch {
    return false
  }
}

/** Read only this invocation's bounded no-link receipt, matched to the current protected record. */
export async function readRecoveryAdvice(
  root: string,
  directory: string,
  current: () => OwnerRecord | null,
): Promise<PluginSupervisorError | undefined> {
  try {
    const value = await inLaunch(root, directory, async () => {
      const path = join(directory, name)
      const file = await openFileNotThroughALink(path, constants.O_RDONLY | constants.O_NONBLOCK)
      try {
        const before = await file.stat()
        if (
          !before.isFile() ||
          before.nlink !== 1 ||
          before.size < 1 ||
          before.size > 4096
        )
          return
        const bytes = Buffer.alloc(before.size + 1)
        let length = 0
        while (length < bytes.length) {
          const read = await file.read(bytes, length, bytes.length - length, length)
          if (!read.bytesRead) break
          length += read.bytesRead
        }
        const after = await file.stat(),
          named = await lstat(path)
        if (
          length !== before.size ||
          after.size !== before.size ||
          after.nlink !== 1 ||
          before.dev !== after.dev ||
          before.ino !== after.ino ||
          before.mtimeMs !== after.mtimeMs ||
          before.ctimeMs !== after.ctimeMs ||
          named.isSymbolicLink() ||
          named.nlink !== 1 ||
          named.dev !== after.dev ||
          named.ino !== after.ino
        )
          return
        return advice.parse(JSON.parse(bytes.subarray(0, length).toString('utf8')))
      } finally {
        await file.close()
      }
    })
    const record = current()
    if (
      !value ||
      value.launch !== basename(directory) ||
      !record ||
      value.epoch !== record.epoch ||
      value.diagnostic.phase !== record.phase
    )
      return
    return new PluginSupervisorError('cleanup-pending', {
      diagnostic: value.diagnostic,
      ownerEpoch: value.epoch,
    })
  } catch {
    return
  }
}
